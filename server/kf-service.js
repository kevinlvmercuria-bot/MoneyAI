'use strict';
const { randomUUID } = require('node:crypto');
const { transaction } = require('./db');
const { fail, uuid } = require('./wecom-service');
function createKfService(pool, client, { now = () => new Date() } = {}) {
    async function authorized(tx, account, id) {
        fail(uuid(id), '会话编号无效。');
        const row = (
            await tx.query('SELECT * FROM kfconversations WHERE id=$1', [id])
        ).rows[0];
        fail(
            row &&
                (account.role === 'owner' ||
                    (row.employee === account.employee &&
                        row.employee_username === account.username)),
            '无法访问此客服会话。',
            403,
        );
        if (account.role === 'employee')
            fail(
                (
                    await tx.query(
                        'SELECT 1 FROM teamcredentials WHERE employee=$1 AND username=$2',
                        [account.employee, account.username],
                    )
                ).rowCount,
                '员工账号已失效。',
                403,
            );
        return row;
    }
    async function accounts() {
        let offset = 0,
            items = [];
        while (true) {
            const result = await client.call('kf/account/list', {
                offset,
                limit: 100,
            });
            const list = result.account_list || [];
            items.push(...list);
            if (list.length < 100) break;
            offset += list.length;
        }
        await transaction(pool, async (tx) => {
            for (const item of items)
                await tx.query(
                    'INSERT INTO kfaccounts(open_kfid,name) VALUES($1,$2) ON CONFLICT(open_kfid) DO UPDATE SET name=excluded.name',
                    [item.open_kfid, item.name || item.open_kfid],
                );
        });
        return items;
    }
    async function conversations(account) {
        return (
            await pool.query(
                `SELECT c.*,a.name AS account_name FROM kfconversations c JOIN kfaccounts a USING(open_kfid)
            WHERE $1::boolean OR (c.employee=$2 AND c.employee_username=$3) ORDER BY c.updated_at DESC LIMIT 200`,
                [account.role === 'owner', account.employee, account.username],
            )
        ).rows;
    }
    async function messages(account, id) {
        await authorized(pool, account, id);
        const rows = (
            await pool.query(
                'SELECT * FROM (SELECT * FROM kfmessages WHERE conversation_id=$1 ORDER BY sent_at DESC,id DESC LIMIT 200) s ORDER BY sent_at,id',
                [id],
            )
        ).rows;
        const inbound = (
            await pool.query(
                "SELECT MAX(sent_at) AS latest FROM kfmessages WHERE conversation_id=$1 AND direction='inbound'",
                [id],
            )
        ).rows[0].latest;
        let remaining = 0;
        if (inbound && now() - inbound < 48 * 60 * 60 * 1000) {
            const used = (
                await pool.query(
                    "SELECT COUNT(*)::int AS n FROM kfmessages WHERE conversation_id=$1 AND direction='outbound' AND sent_at>=$2 AND status IN ('accepted','sending','unknown','received')",
                    [id, inbound],
                )
            ).rows[0].n;
            remaining = Math.max(0, 5 - used);
        }
        return {
            messages: rows.map((row) => ({
                ...row,
                payload: JSON.parse(row.payload),
            })),
            remaining,
            windowUntil: inbound
                ? new Date(
                      inbound.getTime() + 48 * 60 * 60 * 1000,
                  ).toISOString()
                : null,
        };
    }
    async function sync(openKfid) {
        const lock = await pool.connect();
        try {
            if (
                !(
                    await lock.query(
                        'SELECT pg_try_advisory_lock(73170423,hashtext($1)) AS locked',
                        [openKfid],
                    )
                ).rows[0].locked
            )
                return;
            let account = (
                await pool.query(
                    'SELECT * FROM kfaccounts WHERE open_kfid=$1',
                    [openKfid],
                )
            ).rows[0];
            if (!account) return;
            for (let page = 0; page < 30; page++) {
                const result = await client.call('kf/sync_msg', {
                    open_kfid: openKfid,
                    cursor: account.cursor,
                    limit: 1000,
                    ...(account.sync_token &&
                        account.token_at &&
                        now() - account.token_at < 9 * 60 * 1000 && {
                            token: account.sync_token,
                        }),
                });
                fail(
                    typeof result.next_cursor === 'string',
                    '微信客服未返回有效游标。',
                    502,
                );
                await transaction(pool, async (tx) => {
                    for (const message of result.msg_list || []) {
                        if (message.open_kfid && message.open_kfid !== openKfid)
                            continue;
                        const event = message.event;
                        if (event?.event_type === 'msg_send_fail') {
                            await tx.query(
                                "UPDATE kfmessages SET status='failed',payload=payload||$2::jsonb WHERE id=$1",
                                [
                                    event.fail_msgid,
                                    JSON.stringify({ failure: event }),
                                ],
                            );
                        }
                        const external =
                            message.external_userid || event?.external_userid;
                        if (
                            !external ||
                            !message.msgid ||
                            !Number.isFinite(message.send_time)
                        )
                            continue;
                        const conversation = (
                            await tx.query(
                                `INSERT INTO kfconversations(id,open_kfid,external_userid) VALUES($1,$2,$3)
                            ON CONFLICT(open_kfid,external_userid) DO UPDATE SET updated_at=CURRENT_TIMESTAMP RETURNING id`,
                                [randomUUID(), openKfid, external],
                            )
                        ).rows[0];
                        await tx.query(
                            `INSERT INTO kfmessages(id,conversation_id,direction,msgtype,payload,sent_at,status)
                            VALUES($1,$2,$3,$4,$5,$6,'received') ON CONFLICT(id) DO NOTHING`,
                            [
                                message.msgid,
                                conversation.id,
                                message.origin === 3
                                    ? 'inbound'
                                    : message.origin === 5
                                      ? 'outbound'
                                      : 'event',
                                message.msgtype,
                                JSON.stringify(message),
                                new Date(message.send_time * 1000),
                            ],
                        );
                    }
                    await tx.query(
                        "UPDATE kfaccounts SET cursor=$2,last_sync_at=CURRENT_TIMESTAMP,last_error='' WHERE open_kfid=$1",
                        [openKfid, result.next_cursor],
                    );
                });
                if (!result.has_more) break;
                fail(
                    result.next_cursor !== account.cursor,
                    '微信客服游标没有前进。',
                    502,
                );
                account.cursor = result.next_cursor;
            }
        } catch (e) {
            await pool.query(
                'UPDATE kfaccounts SET last_error=$2,last_sync_at=CURRENT_TIMESTAMP WHERE open_kfid=$1',
                [openKfid, e.apiStatus ? e.message : '客服消息同步暂未完成'],
            );
        } finally {
            await lock
                .query('SELECT pg_advisory_unlock(73170423,hashtext($1))', [
                    openKfid,
                ])
                .catch(() => {});
            lock.release();
        }
    }
    async function assign(account, { conversationId, employee, memberId }) {
        fail(account.role === 'owner', '仅老板娘可分配和绑定客服会话。', 403);
        await transaction(pool, async (tx) => {
            await authorized(tx, account, conversationId);
            const credential = (
                await tx.query(
                    "SELECT username FROM teamcredentials WHERE employee=$1 AND employee<>''",
                    [employee],
                )
            ).rows[0];
            fail(credential, '员工登录账号不存在。', 409);
            if (memberId) {
                const { loadTeamState } = require('./team-repository');
                const { createTeamStore } = require('../public/team-store');
                const snapshot = require('../data/team-data.json'),
                    { initialState, reminders } = await loadTeamState(tx);
                fail(
                    createTeamStore(snapshot, {
                        initialState,
                        careReminders: reminders,
                    })
                        .workspaceSnapshot()
                        .members.some((m) => m.member_id === memberId),
                    '会员不存在。',
                    404,
                );
            }
            fail(
                !(
                    await tx.query(
                        "SELECT 1 FROM kfmessages WHERE conversation_id=$1 AND status IN ('sending','unknown')",
                        [conversationId],
                    )
                ).rowCount,
                '会话有待核实的发送，暂不能改派。',
                409,
            );
            await tx.query(
                'UPDATE kfconversations SET employee=$2,member_id=$3,employee_username=$4,updated_at=CURRENT_TIMESTAMP WHERE id=$1',
                [
                    conversationId,
                    employee,
                    memberId || null,
                    credential.username,
                ],
            );
        });
    }
    async function send(account, { conversationId, message, idempotencyKey }) {
        fail(client.configured, '尚未配置微信客服接口。', 503);
        fail(
            uuid(idempotencyKey) &&
                typeof message === 'string' &&
                message.trim() &&
                Buffer.byteLength(message.trim()) <= 2048,
            '回复不能为空，且最多 2048 UTF-8 字节。',
        );
        const text = message.trim();
        // Serialize sends for this conversation across processes, without holding a SQL transaction over HTTP.
        const lock = await pool.connect();
        try {
            fail(
                (
                    await lock.query(
                        'SELECT pg_try_advisory_lock(73170424,hashtext($1)) AS locked',
                        [conversationId],
                    )
                ).rows[0].locked,
                '此会话正在发送，请稍后重试。',
                409,
            );
            let row = await authorized(pool, account, conversationId);
            const previous = (
                await pool.query(
                    'SELECT * FROM kfmessages WHERE created_by=$1 AND idempotency_key=$2',
                    [account.username, idempotencyKey],
                )
            ).rows[0];
            if (previous) {
                fail(
                    previous.conversation_id === conversationId &&
                        JSON.parse(previous.payload).text.content === text,
                    '同一提交编号的内容发生变化。',
                    409,
                );
                return { id: previous.id, status: previous.status };
            }
            await sync(row.open_kfid);
            const state = await client.call('kf/service_state/get', {
                open_kfid: row.open_kfid,
                external_userid: row.external_userid,
            });
            fail(
                [0, 1].includes(state.service_state),
                '该会话当前不允许接口回复；请检查是否已由企微人工接待或结束。',
                409,
            );
            const id = randomUUID().replaceAll('-', '');
            await transaction(pool, async (tx) => {
                row = await authorized(tx, account, conversationId);
                const eligibility = await messages(account, conversationId);
                fail(
                    eligibility.remaining > 0,
                    '客户回复窗口已结束或本轮回复额度已用完。',
                    409,
                );
                await tx.query(
                    `INSERT INTO kfmessages(id,conversation_id,direction,msgtype,payload,sent_at,status,created_by,idempotency_key)
                    VALUES($1,$2,'outbound','text',$3,$4,'sending',$5,$6)`,
                    [
                        id,
                        conversationId,
                        JSON.stringify({ text: { content: text } }),
                        now(),
                        account.username,
                        idempotencyKey,
                    ],
                );
            });
            try {
                await client.call('kf/send_msg', {
                    open_kfid: row.open_kfid,
                    touser: row.external_userid,
                    msgid: id,
                    msgtype: 'text',
                    text: { content: text },
                });
                await pool.query(
                    "UPDATE kfmessages SET status='accepted' WHERE id=$1 AND status='sending'",
                    [id],
                );
            } catch (e) {
                await pool.query(
                    'UPDATE kfmessages SET status=$2,payload=payload||$3::jsonb WHERE id=$1',
                    [
                        id,
                        e.uncertain ? 'unknown' : 'failed',
                        JSON.stringify({ error: e.message }),
                    ],
                );
            }
            return {
                id,
                status: (
                    await pool.query(
                        'SELECT status FROM kfmessages WHERE id=$1',
                        [id],
                    )
                ).rows[0].status,
            };
        } finally {
            await lock
                .query('SELECT pg_advisory_unlock(73170424,hashtext($1))', [
                    conversationId,
                ])
                .catch(() => {});
            lock.release();
        }
    }
    async function tick() {
        if (!client.configured) return;
        // A crash after reserving a message cannot trigger an automatic resend.
        await pool.query(
            "UPDATE kfmessages SET status='unknown' WHERE status='sending' AND sent_at<CURRENT_TIMESTAMP-interval '2 minutes'",
        );
        const rows = (
            await pool.query(
                "SELECT open_kfid FROM kfaccounts WHERE last_sync_at IS NULL OR last_sync_at<CURRENT_TIMESTAMP-interval '60 seconds' LIMIT 20",
            )
        ).rows;
        for (const row of rows) await sync(row.open_kfid);
    }
    return {
        client,
        accounts,
        conversations,
        messages,
        sync,
        assign,
        send,
        tick,
        authorized,
    };
}
module.exports = { createKfService };

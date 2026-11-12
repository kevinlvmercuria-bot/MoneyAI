'use strict';
const { randomUUID, createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { transaction } = require('./db');
const { createTeamStore } = require('../public/team-store');
const { loadTeamState, persistTeamState } = require('./team-repository');
const snapshotDefault = JSON.parse(
    readFileSync(path.join(__dirname, '../data/team-data.json'), 'utf8'),
);
const owner = { role: 'owner', employee: '' };
const fail = (condition, message, status = 400) => {
    if (!condition)
        throw Object.assign(new Error(message), { apiStatus: status });
};
const uuid = (value) =>
    typeof value === 'string' &&
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
function createWecomService(
    pool,
    client,
    { snapshot = snapshotDefault, now = () => new Date() } = {},
) {
    async function engineFor(tx) {
        const { initialState, reminders } = await loadTeamState(tx);
        const engine = createTeamStore(snapshot, {
            initialState,
            careReminders: reminders,
            now,
        });
        if (engine.refreshCareReminders())
            await persistTeamState(tx, engine, reminders);
        return { engine, reminders };
    }
    async function prepare(tx, account, items) {
        fail(
            account.role === 'employee',
            '请使用负责员工账号提交企微发送任务。',
            403,
        );
        fail(
            Array.isArray(items) && items.length > 0 && items.length <= 50,
            '每批请选择 1–50 条任务。',
        );
        fail(
            new Set(items.map((i) => i.taskId)).size === items.length,
            '同一任务不能重复选择。',
        );
        const { engine } = await engineFor(tx),
            state = engine.exportState(),
            data = engine.workspaceSnapshot();
        fail(
            state.accounts.some((a) => a.employee === account.employee),
            '员工账号已失效。',
            403,
        );
        const employee = (
            await tx.query(
                'SELECT userid FROM wecomemployees WHERE employee=$1',
                [account.employee],
            )
        ).rows[0];
        const rows = [];
        for (const item of items) {
            const task = state.tasks.find(
                (t) =>
                    t.task_id === item.taskId &&
                    t.assignee === account.employee && !t.employee_access_revoked,
            );
            const reasons = [];
            if (!task || task.status !== 'assigned' || task.withdrawn_at)
                reasons.push('不是当前账号负责的待联系任务');
            const member =
                task &&
                data.members.find((m) => m.member_id === task.member_id);
            if (member && (member.data_type ?? data.data_type) !== 'real')
                reasons.push('模拟会员不可发送真实消息');
            if (!member) reasons.push('会员资料不可用');
            if (task && member) reasons.push(...engine.contactReasons(task));
            if (!employee) reasons.push('员工尚未绑定企业微信');
            const binding =
                member &&
                (
                    await tx.query(
                        'SELECT external_userid FROM wecommembers WHERE member_id=$1',
                        [member.member_id],
                    )
                ).rows[0];
            if (!binding) reasons.push('会员尚未绑定企业微信客户');
            const message =
                typeof item.message === 'string' ? item.message.trim() : '';
            if (
                !message ||
                message.length > 1600 ||
                Buffer.byteLength(message) > 4000
            )
                reasons.push('话术需为 1–1600 字符且不超过 4000 UTF-8 字节');
            let image = null;
            if (item.imageProductId) {
                const value = state.images[item.imageProductId];
                if (
                    typeof value !== 'string' ||
                    !/^data:image\/jpeg;base64,\/9j\//.test(value)
                )
                    reasons.push('只能发送产品库中已上传的实拍图');
                else {
                    image = Buffer.from(value.split(',')[1], 'base64');
                    if (image.length > 2 * 1024 * 1024)
                        reasons.push('图片不得超过 2 MB');
                }
            }
            const active =
                task &&
                (
                    await tx.query(
                        "SELECT id FROM wecomdeliveries WHERE (member_id=$1 AND status IN ('prepared','creating','pending','unknown')) OR (task_id=$2 AND status<>'failed') LIMIT 1",
                        [task.member_id, task.task_id],
                    )
                ).rows[0];
            if (active)
                reasons.push(
                    '已有发送任务或此联系任务已经发送，请查看发送记录',
                );
            rows.push({
                taskId: item.taskId,
                memberId: member?.member_id,
                name: member?.display_name,
                reasons,
                message,
                image,
                imageProductId: item.imageProductId || null,
                employee: account.employee,
                userid: employee?.userid,
                external_userid: binding?.external_userid,
            });
        }
        return rows;
    }
    async function preflight(account, items) {
        const rows = await transaction(pool, (tx) =>
            prepare(tx, account, items),
        );
        for (const row of rows.filter((r) => !r.reasons.length)) {
            try {
                const customer = await client.customer(row.external_userid);
                if (!customer.follow_user?.some((u) => u.userid === row.userid))
                    row.reasons.push('会员与负责店员的企微好友关系已失效');
            } catch {
                row.reasons.push('暂时无法核实企微客户关系或接口尚未配置');
            }
        }
        return rows.map(({ image, userid, external_userid, ...row }) => ({
            ...row,
            hasImage: Boolean(image),
        }));
    }
    async function submit(account, { items, idempotencyKey }, { initiatedBy = account.username } = {}) {
        fail(client.configured, '企业微信尚未配置，不能真实发送。', 503);
        fail(uuid(idempotencyKey), '缺少有效的发送幂等编号。');
        const hash = createHash('sha256')
            .update(JSON.stringify(items))
            .digest('hex');
        return transaction(pool, async (tx) => {
            const previous = (
                await tx.query(
                    'SELECT id,request_hash FROM wecombatches WHERE submitted_by=$1 AND idempotency_key=$2',
                    [account.username, idempotencyKey],
                )
            ).rows[0];
            if (previous) {
                fail(
                    previous.request_hash === hash,
                    '同一提交编号的内容已变化。',
                    409,
                );
                return { batchId: previous.id, reused: true };
            }
            const rows = await prepare(tx, account, items);
            fail(
                rows.every((r) => !r.reasons.length),
                rows
                    .filter((r) => r.reasons.length)
                    .map(
                        (r) =>
                            (r.name || r.taskId) + '：' + r.reasons.join('；'),
                    )
                    .join('\n'),
                409,
            );
            const batchId = randomUUID(),
                groups = new Map();
            await tx.query(
                'INSERT INTO wecombatches(id,submitted_by,idempotency_key,request_hash,initiated_by) VALUES($1,$2,$3,$4,$5)',
                [batchId, account.username, idempotencyKey, hash, initiatedBy],
            );
            for (const row of rows) {
                const key = createHash('sha256')
                    .update(row.userid + '\0' + row.message)
                    .update(row.image || Buffer.alloc(0))
                    .digest('hex');
                if (!groups.has(key)) groups.set(key, randomUUID());
                await tx.query(
                    `INSERT INTO wecomdeliveries(id,batch_id,group_id,task_id,member_id,employee,userid,external_userid,message,image_data,image_type,status)
                    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'prepared')`,
                    [
                        randomUUID(),
                        batchId,
                        groups.get(key),
                        row.taskId,
                        row.memberId,
                        row.employee,
                        row.userid,
                        row.external_userid,
                        row.message,
                        row.image,
                        row.image ? 'image/jpeg' : null,
                    ],
                );
            }
            return { batchId };
        });
    }
    async function list(account) {
        const { rows } = await pool.query(
            `SELECT d.id,d.batch_id,d.task_id,d.member_id,d.employee,d.message,d.image_data IS NOT NULL AS has_image,
            d.status,d.detail,d.created_at,d.updated_at,d.sent_at,d.platform_id
            FROM wecomdeliveries d JOIN wecombatches b ON b.id=d.batch_id
            WHERE $1::boolean OR (d.employee=$2 AND b.submitted_by=$3) ORDER BY d.created_at DESC LIMIT 200`,
            [account.role === 'owner', account.employee, account.username],
        );
        return rows;
    }
    async function update(group, status, detail, platformId, body) {
        await pool.query(
            `UPDATE wecomdeliveries SET status=$2,detail=$3,platform_id=COALESCE($4,platform_id),
            platform_body=COALESCE($5::jsonb,platform_body),creation_attempt_at=CASE WHEN $2::text='creating' THEN CURRENT_TIMESTAMP ELSE creation_attempt_at END,
            updated_at=CURRENT_TIMESTAMP,next_poll_at=CURRENT_TIMESTAMP+interval '60 seconds'
            WHERE group_id=$1 AND status<>'sent'`,
            [
                group,
                status,
                detail,
                platformId || null,
                body ? JSON.stringify(body) : null,
            ],
        );
    }
    async function recordResult(row, result) {
        if (result.status === 1) {
            if (!Number.isFinite(result.send_time) || result.send_time <= 0)
                return;
            const sent_at = new Date(result.send_time * 1000).toISOString();
            await transaction(pool, async (tx) => {
                const { engine, reminders } = await engineFor(tx);
                engine.recordOutboundContact({
                    delivery_id: row.id,
                    task_id: row.task_id,
                    member_id: row.member_id,
                    sent_at,
                });
                await persistTeamState(tx, engine, reminders);
                await tx.query(
                    "UPDATE wecomdeliveries SET status='sent',sent_at=$2,detail='平台报告已发送',updated_at=CURRENT_TIMESTAMP WHERE id=$1",
                    [row.id, sent_at],
                );
            });
        } else if ([2, 3].includes(result.status))
            await pool.query(
                "UPDATE wecomdeliveries SET status='failed',detail=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$1",
                [
                    row.id,
                    result.status === 2
                        ? '客户已不是好友'
                        : '客户接收群发额度受限',
                ],
            );
    }
    async function eligible(rows) {
        return transaction(pool, async (tx) => {
            const { engine } = await engineFor(tx),
                state = engine.exportState();
            for (const row of rows) {
                const task = state.tasks.find((t) => t.task_id === row.task_id);
                if (
                    !task ||
                    task.assignee !== row.employee ||
                    task.employee_access_revoked ||
                    task.status !== 'assigned' ||
                    task.withdrawn_at ||
                    engine.contactReasons(task).length
                )
                    return false;
                const enabled = (
                    await tx.query(
                        'SELECT 1 FROM teamcredentials WHERE employee=$1',
                        [row.employee],
                    )
                ).rowCount;
                const employee = (
                    await tx.query(
                        'SELECT 1 FROM wecomemployees WHERE employee=$1 AND userid=$2',
                        [row.employee, row.userid],
                    )
                ).rowCount;
                const member = (
                    await tx.query(
                        'SELECT 1 FROM wecommembers WHERE member_id=$1 AND external_userid=$2',
                        [row.member_id, row.external_userid],
                    )
                ).rowCount;
                if (!enabled || !employee || !member) return false;
            }
            return true;
        });
    }
    async function processGroup(group) {
        const lock = await pool.connect();
        try {
            const locked = (
                await lock.query(
                    'SELECT pg_try_advisory_lock(73170422,hashtext($1)) AS locked',
                    [group],
                )
            ).rows[0].locked;
            if (!locked) return;
            let rows = (
                await pool.query(
                    "SELECT * FROM wecomdeliveries WHERE group_id=$1 AND status NOT IN ('sent','failed') ORDER BY id",
                    [group],
                )
            ).rows;
            if (!rows.length) return;
            let first = rows[0];
            if (first.status === 'creating') {
                await update(group, 'unknown', '进程中断，需核对平台记录');
                first.status = 'unknown';
            }
            if (first.status === 'prepared') {
                // Recheck both local policy and live friendship immediately before creation.
                if (!(await eligible(rows))) {
                    await update(group, 'failed', '任务归属或联系资格已变化');
                    return;
                }
                for (const row of rows) {
                    const customer = await client.customer(row.external_userid);
                    if (
                        !customer.follow_user?.some(
                            (u) => u.userid === row.userid,
                        )
                    ) {
                        await update(group, 'failed', '企微好友关系已失效');
                        return;
                    }
                }
                let media;
                try {
                    if (first.image_data)
                        media = await client.uploadImage(
                            first.image_data,
                            first.image_type,
                        );
                } catch (e) {
                    await update(
                        group,
                        'failed',
                        '图片上传失败，尚未创建发送任务',
                    );
                    return;
                }
                if (!(await eligible(rows))) {
                    await update(group, 'failed', '素材准备期间任务归属或联系资格已变化');
                    return;
                }
                const body = {
                    chat_type: 'single',
                    sender: first.userid,
                    allow_select: false,
                    external_userid: rows.map((r) => r.external_userid),
                    text: { content: first.message },
                    ...(media && {
                        attachments: [
                            { msgtype: 'image', image: { media_id: media } },
                        ],
                    }),
                };
                await update(group, 'creating', '正在创建企微任务', null, body);
                try {
                    const result = await client.create(body);
                    if (!result.msgid)
                        throw Object.assign(new Error('平台没有返回任务编号'), {
                            uncertain: true,
                        });
                    const failures = new Set(result.fail_list || []);
                    await update(
                        group,
                        'pending',
                        '待负责员工在企业微信确认发送',
                        result.msgid,
                    );
                    for (const row of rows.filter((r) =>
                        failures.has(r.external_userid),
                    ))
                        await pool.query(
                            "UPDATE wecomdeliveries SET status='failed',detail='平台未接受该客户' WHERE id=$1",
                            [row.id],
                        );
                } catch (e) {
                    await update(
                        group,
                        e.uncertain ? 'unknown' : 'failed',
                        e.message,
                    );
                }
                return;
            }
            if (first.status === 'unknown' && !first.platform_id) {
                const body = JSON.parse(first.platform_body || 'null');
                if (!body) return;
                const start =
                        Math.floor(
                            new Date(
                                first.creation_attempt_at || first.created_at,
                            ).getTime() / 1000,
                        ) - 60,
                    end = start + 3660;
                const records = await client.records(start, end),
                    matches = [];
                const attachmentKey = (value) =>
                    JSON.stringify(
                        (value || []).map((a) => ({
                            type: a.msgtype,
                            media: a.image?.media_id,
                        })),
                    );
                for (const record of records.filter(
                    (r) =>
                        r.text?.content === body.text.content &&
                        attachmentKey(r.attachments) ===
                            attachmentKey(body.attachments),
                )) {
                    const results = await client.results(
                        record.msgid,
                        first.userid,
                    );
                    const targets = results
                        .map((r) => r.external_userid)
                        .sort();
                    if (
                        JSON.stringify(targets) ===
                        JSON.stringify(
                            rows.map((r) => r.external_userid).sort(),
                        )
                    )
                        matches.push(record.msgid);
                }
                if (matches.length !== 1) {
                    await update(
                        group,
                        'unknown',
                        '未找到唯一匹配的企微记录，禁止自动重发',
                    );
                    return;
                }
                await update(
                    group,
                    'pending',
                    '已从平台记录核实任务',
                    matches[0],
                );
                first.platform_id = matches[0];
            }
            if (!first.platform_id) return;
            const results = await client.results(
                first.platform_id,
                first.userid,
            );
            for (const row of rows) {
                const result = results.find(
                    (r) =>
                        r.external_userid === row.external_userid &&
                        r.userid === row.userid,
                );
                if (result) await recordResult(row, result);
            }
            // If permissions or consent changed after creation, cancel unsent recipients.
            rows = (
                await pool.query(
                    "SELECT * FROM wecomdeliveries WHERE group_id=$1 AND status IN ('pending','unknown')",
                    [group],
                )
            ).rows;
            if (rows.length && !(await eligible(rows))) {
                await client.call('externalcontact/cancel_groupmsg_send', {
                    msgid: first.platform_id,
                });
                await update(
                    group,
                    'failed',
                    '任务资格已变化，已停止尚未发送的企微任务',
                );
            } else
                await pool.query(
                    "UPDATE wecomdeliveries SET next_poll_at=CURRENT_TIMESTAMP+interval '60 seconds' WHERE group_id=$1",
                    [group],
                );
        } catch (e) {
            await pool.query(
                "UPDATE wecomdeliveries SET detail=$2,next_poll_at=CURRENT_TIMESTAMP+interval '60 seconds' WHERE group_id=$1 AND status NOT IN ('sent','failed')",
                [group, e.apiStatus ? e.message : '查询暂未完成，请稍后刷新'],
            );
        } finally {
            await lock
                .query('SELECT pg_advisory_unlock(73170422,hashtext($1))', [
                    group,
                ])
                .catch(() => {});
            lock.release();
        }
    }
    let running = false;
    async function tick() {
        if (running || !client.configured) return;
        running = true;
        try {
            const { rows } = await pool.query(
                "SELECT DISTINCT group_id FROM wecomdeliveries WHERE status IN ('prepared','creating','pending','unknown') AND next_poll_at<=CURRENT_TIMESTAMP LIMIT 20",
            );
            for (const row of rows) await processGroup(row.group_id);
        } finally {
            running = false;
        }
    }
    return { preflight, submit, list, tick, processGroup, client, engineFor };
}
module.exports = { createWecomService, fail, uuid };

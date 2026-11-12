'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    randomUUID,
    randomBytes,
    createCipheriv,
    createHash,
} = require('node:crypto');
const { connect, transaction } = require('./db');
const { migrateTeam } = require('../database/migrations');
const { createApp } = require('./app');
const { authenticate } = require('./test-auth-client');
const { createTeamStore } = require('../public/team-store');
const { loadTeamState } = require('./team-repository');
const { createWecomClient } = require('./wecom-client');
const { decryptCallback } = require('./wecom-callback');
const baseSnapshot = require('../data/team-data.json');
async function environment(work) {
    const name = 'nailmate_integrations_' + randomBytes(8).toString('hex'),
        master = await connect('postgres');
    let pool, server;
    try {
        await master.query(`CREATE DATABASE "${name}"`);
        pool = await connect(name);
        await transaction(pool, migrateTeam);
        const snapshot = {
            ...baseSnapshot,
            members: baseSnapshot.members
                .slice(0, 6)
                .map((m, i) => ({
                    ...m,
                    data_type: i === 5 ? 'simulation' : 'real',
                    marketing_consent: true,
                    unresolved_complaint: false,
                    has_upcoming_appointment: false,
                    last_contact_date: '',
                    data_completeness: 1,
                })),
            orders: [],
            appointments: [],
            data_type: 'real',
        };
        let results = [],
            calls = [],
            createMode = 'ok',
            syncMessages = [];
        let currentTime = '2026-11-12T08:00:00Z';
        const now = () => new Date(currentTime);
        const client = {
            configured: true,
            employees: async () => ['wx-staff'],
            customers: async () =>
                snapshot.members.map((m) => 'external-' + m.member_id),
            customer: async (id) => ({
                external_contact: { name: id },
                follow_user: id === 'lost' ? [] : [{ userid: 'wx-staff' }],
            }),
            uploadImage: async () => {
                calls.push('image');
                return 'media-1';
            },
            create: async (body) => {
                calls.push(body);
                if (createMode === 'timeout')
                    throw Object.assign(new Error('模拟超时'), {
                        uncertain: true,
                    });
                return { msgid: 'platform-' + calls.length };
            },
            results: async () => results,
            records: async () => [],
            call: async () => ({}),
        };
        const kf = {
            configured: true,
            call: async (endpoint, body) => {
                if (endpoint === 'kf/account/list')
                    return {
                        account_list: [{ open_kfid: 'kf-1', name: '门店客服' }],
                    };
                if (endpoint === 'kf/sync_msg') {
                    const batch = syncMessages;
                    syncMessages = [];
                    return {
                        msg_list: batch,
                        next_cursor: randomUUID(),
                        has_more: 0,
                    };
                }
                if (endpoint === 'kf/service_state/get')
                    return { service_state: 0 };
                if (endpoint === 'kf/send_msg') {
                    calls.push(body);
                    return { msgid: body.msgid };
                }
                return {};
            },
        };
        const app = createApp(pool, {
            legacy: false,
            teamSnapshot: snapshot,
            teamNow: now,
            wecomClient: client,
            kfClient: kf,
        });
        server = app.listen(0, '127.0.0.1');
        await new Promise((resolve) => server.once('listening', resolve));
        const base = 'http://127.0.0.1:' + server.address().port,
            ownerRequest = await authenticate(base, 'setup');
        const post = (request, path, body) =>
            request(base + path, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
        const bootstrap = await (
            await post(ownerRequest, '/api/team', { action: 'bootstrap' })
        ).json();
        const employee = bootstrap.state.accounts[0].employee,
            credentials = {
                username: 'integration-staff',
                password: 'integration-password',
            };
        assert.equal(
            (
                await post(ownerRequest, '/api/team', {
                    action: 'employeeAccount',
                    employee,
                    ...credentials,
                })
            ).status,
            200,
        );
        const request = await authenticate(base, 'login', credentials),
            account = {
                role: 'employee',
                employee,
                username: credentials.username,
            };
        const tasks = snapshot.members.map((m) => ({
            member_id: m.member_id,
            objective: 'greeting',
            product_id: null,
            assignee: employee,
            message: '问候',
            note: '',
            reason: '',
        }));
        const assignment = await post(ownerRequest, '/api/team', {
            action: 'assign',
            tasks,
        });
        assert.equal(assignment.status, 200, await assignment.clone().text());
        const assigned = (await assignment.json()).state.tasks;
        await pool.query('INSERT INTO wecomemployees VALUES($1,$2)', [
            employee,
            'wx-staff',
        ]);
        for (const m of snapshot.members)
            await pool.query('INSERT INTO wecommembers VALUES($1,$2)', [
                m.member_id,
                'external-' + m.member_id,
            ]);
        await work({
            pool,
            app,
            client,
            kf,
            snapshot,
            now,
            employee,
            account,
            request,
            ownerRequest,
            base,
            post,
            tasks: assigned,
            calls,
            setResults: (value) => {
                results = value;
            },
            setCreateMode: (value) => {
                createMode = value;
            },
            pushMessages: (value) => {
                syncMessages.push(...value);
            },
            setNow: (value) => { currentTime = value; },
        });
    } finally {
        if (server) await new Promise((resolve) => server.close(resolve));
        await pool?.end();
        await master.query(`DROP DATABASE IF EXISTS "${name}" WITH(FORCE)`);
        await master.end();
    }
}
test(
    '企微发送：统一/个性化、图片、权限、幂等、平台结果和真实联系冷却',
    { timeout: 60000 },
    async () =>
        environment(async (c) => {
            const service = c.app.locals.wecom,
                items = c.tasks
                    .slice(0, 2)
                    .map((t) => ({ taskId: t.task_id, message: '统一问候' }));
            const photo = 'data:image/jpeg;base64,/9j/AA==';
            const product = c.snapshot.products[0].product_id;
            assert.equal(
                (
                    await c.post(c.ownerRequest, '/api/team', {
                        action: 'photo',
                        productId: product,
                        image: photo,
                    })
                ).status,
                200,
            );
            items.forEach((i) => (i.imageProductId = product));
            assert.ok(
                (await service.preflight(c.account, items)).every(
                    (i) => !i.reasons.length,
                ),
            );
            const idempotencyKey = randomUUID(),
                batch = await service.submit(c.account, {
                    items,
                    idempotencyKey,
                });
            assert.equal(
                (await service.submit(c.account, { items, idempotencyKey }))
                    .batchId,
                batch.batchId,
            );
            await assert.rejects(
                service.submit(c.account, {
                    items: [{ ...items[0], message: '不同' }],
                    idempotencyKey,
                }),
                /内容已变化/,
            );
            assert.equal(
                (
                    await c.post(c.ownerRequest, '/api/team', {
                        action: 'withdraw',
                        id: items[0].taskId,
                    })
                ).status,
                409,
            );
            const group = (
                await c.pool.query(
                    'SELECT group_id FROM wecomdeliveries LIMIT 1',
                )
            ).rows[0].group_id;
            await service.processGroup(group);
            assert.equal(
                c.calls.filter((x) => typeof x === 'object').length,
                1,
                '统一内容合并成一个平台任务',
            );
            assert.ok(c.calls.includes('image'));
            assert.ok(
                (await service.list(c.account)).every(
                    (r) => r.status === 'pending',
                ),
            );
            c.setResults(
                c.tasks
                    .slice(0, 2)
                    .map((t) => ({
                        external_userid: 'external-' + t.member_id,
                        userid: 'wx-staff',
                        status: 1,
                        send_time: Math.floor(c.now() / 1000),
                    })),
            );
            await service.processGroup(group);
            await service.processGroup(group);
            assert.ok(
                (await service.list(c.account)).every(
                    (r) => r.status === 'sent',
                ),
            );
            const state = (await transaction(c.pool, loadTeamState))
                .initialState;
            assert.equal(state.outboundContacts.length, 2);
            assert.equal(
                state.memberUpdates[c.tasks[0].member_id].last_contact_date,
                '2026-11-12',
            );
            assert.equal(state.tasks[0].result, null, '发送不伪造客户反馈');
            const restored = createTeamStore(c.snapshot, {
                initialState: state,
                now: c.now,
            });
            assert.ok(
                restored
                    .contactReasons(c.tasks[0])
                    .some((s) => s.includes('14 天')),
            );
            assert.equal(
                (
                    await service.list({
                        ...c.account,
                        employee: '其他店员',
                        username: 'other',
                    })
                ).length,
                0,
            );
            const personalized = c.tasks
                .slice(2, 4)
                .map((t, i) => ({ taskId: t.task_id, message: '个性化 ' + i }));
            const result = await service.submit(c.account, {
                items: personalized,
                idempotencyKey: randomUUID(),
            });
            assert.equal(
                (
                    await c.pool.query(
                        'SELECT COUNT(DISTINCT group_id)::int AS n FROM wecomdeliveries WHERE batch_id=$1',
                        [result.batchId],
                    )
                ).rows[0].n,
                2,
            );
            const blocked = await service.preflight(c.account, [
                { taskId: c.tasks[5].task_id, message: '不应发送模拟会员' },
            ]);
            assert.match(blocked[0].reasons.join(''), /模拟会员/);
            assert.equal(
                (
                    await c.post(c.ownerRequest, '/api/wecom/submit', {
                        items: personalized,
                        idempotencyKey: randomUUID(),
                    })
                ).status,
                403,
            );
            assert.equal(
                (await fetch(c.base + '/api/wecom/records')).status,
                401,
            );
        }),
);
test(
    '企微超时、重启恢复与并发：结果未知不重发，好友关系失效拒绝创建',
    { timeout: 60000 },
    async () =>
        environment(async (c) => {
            const service = c.app.locals.wecom;
            let items = [{ taskId: c.tasks[0].task_id, message: '待核实问候' }];
            c.setCreateMode('timeout');
            await service.submit(c.account, {
                items,
                idempotencyKey: randomUUID(),
            });
            const group = (
                await c.pool.query(
                    'SELECT group_id FROM wecomdeliveries LIMIT 1',
                )
            ).rows[0].group_id;
            await Promise.all([
                service.processGroup(group),
                service.processGroup(group),
            ]);
            assert.equal(c.calls.length, 1);
            assert.equal((await service.list(c.account))[0].status, 'unknown');
            const restored = require('./wecom-service').createWecomService(
                c.pool,
                c.client,
                { snapshot: c.snapshot, now: c.now },
            );
            await restored.processGroup(group);
            assert.equal(c.calls.length, 1, '重启后不得再次调用创建');
            await assert.rejects(
                service.submit(c.account, {
                    items,
                    idempotencyKey: randomUUID(),
                }),
                /已有发送任务/,
            );
            await c.pool.query(
                "UPDATE wecommembers SET external_userid='lost' WHERE member_id=$1",
                [c.tasks[1].member_id],
            );
            const pre = await service.preflight(c.account, [
                { taskId: c.tasks[1].task_id, message: '你好' },
            ]);
            assert.match(pre[0].reasons.join(''), /好友关系/);
            const long = await service.preflight(c.account, [
                { taskId: c.tasks[2].task_id, message: '中'.repeat(1500) },
            ]);
            assert.match(long[0].reasons.join(''), /4000/);
        }),
);
test(
    '逐人失败、上传失败与好友失效不会留下假成功，失败不改变联系时间',
    { timeout: 60000 },
    async () => environment(async c => {
        const service=c.app.locals.wecom;
        await service.submit(c.account,{items:c.tasks.slice(0,2).map(t=>({taskId:t.task_id,message:'统一通知'})),idempotencyKey:randomUUID()});
        const group=(await c.pool.query('SELECT group_id FROM wecomdeliveries LIMIT 1')).rows[0].group_id;
        await service.processGroup(group);
        c.setResults(c.tasks.slice(0,2).map((t,i)=>({external_userid:'external-'+t.member_id,userid:'wx-staff',status:i+2})));
        await service.processGroup(group);
        assert.ok((await service.list(c.account)).every(r=>r.status==='failed'));
        assert.equal((await transaction(c.pool,loadTeamState)).initialState.outboundContacts.length,0);
        const product=c.snapshot.products[0].product_id;
        await c.post(c.ownerRequest,'/api/team',{action:'photo',productId:product,image:'data:image/jpeg;base64,/9j/AA=='});
        c.client.uploadImage=async()=>{throw new Error('素材接口失败')};
        await service.submit(c.account,{items:[{taskId:c.tasks[2].task_id,message:'含图问候',imageProductId:product}],idempotencyKey:randomUUID()});
        const next=(await c.pool.query('SELECT group_id FROM wecomdeliveries WHERE task_id=$1',[c.tasks[2].task_id])).rows[0].group_id;
        await service.processGroup(next);
        assert.match((await service.list(c.account)).find(r=>r.task_id===c.tasks[2].task_id).detail,/图片上传失败/);
        assert.equal(c.calls.filter(x=>typeof x==='object').length,1);
        await c.pool.query("UPDATE wecommembers SET external_userid='lost' WHERE member_id=$1",[c.tasks[3].member_id]);
        await service.submit(c.account,{items:[{taskId:c.tasks[3].task_id,message:'检查好友'}],idempotencyKey:randomUUID()});
        const last=(await c.pool.query('SELECT group_id FROM wecomdeliveries WHERE task_id=$1',[c.tasks[3].task_id])).rows[0].group_id;
        await service.processGroup(last);
        assert.match((await service.list(c.account)).find(r=>r.task_id===c.tasks[3].task_id).detail,/好友关系/);
    }),
);
test(
    '微信客服：游标幂等接收、分配隔离、网页回复额度与失败事件',
    { timeout: 60000 },
    async () =>
        environment(async (c) => {
            const service = c.app.locals.kf;
            await service.accounts();
            const inbound = {
                msgid: 'in-1',
                open_kfid: 'kf-1',
                external_userid: 'kf-customer',
                origin: 3,
                msgtype: 'text',
                send_time: Math.floor(c.now() / 1000) - 10,
                text: { content: '想咨询一下' },
            };
            c.pushMessages([inbound, inbound]);
            await service.sync('kf-1');
            const owner = {
                role: 'owner',
                employee: '',
                username: 'test-owner',
            };
            const rows = await service.conversations(owner);
            assert.equal(rows.length, 1);
            assert.equal((await service.conversations(c.account)).length, 0);
            const id = rows[0].id;
            await assert.rejects(service.messages(c.account, id), /无法访问/);
            await service.assign(owner, {
                conversationId: id,
                employee: c.employee,
            });
            assert.equal(
                (await service.messages(c.account, id)).messages.length,
                1,
            );
            await assert.rejects(service.messages({...c.account,username:'rehired-account'},id),/无法访问/);
            const payload = {
                conversationId: id,
                message: '您好，可以为您介绍',
                idempotencyKey: randomUUID(),
            };
            const sent = await service.send(c.account, payload);
            assert.equal(sent.status, 'accepted');
            assert.equal((await service.send(c.account, payload)).id, sent.id);
            assert.equal(c.calls.length, 1);
            for (let i = 0; i < 4; i++)
                await service.send(c.account, {
                    ...payload,
                    idempotencyKey: randomUUID(),
                });
            assert.equal((await service.messages(c.account, id)).remaining, 0);
            await assert.rejects(
                service.send(c.account, {
                    ...payload,
                    idempotencyKey: randomUUID(),
                }),
                /额度/,
            );
            c.pushMessages([
                {
                    ...inbound,
                    msgid: 'failure-event',
                    origin: 4,
                    msgtype: 'event',
                    event: { event_type: 'msg_send_fail', fail_msgid: sent.id },
                },
            ]);
            await service.sync('kf-1');
            assert.equal(
                (await service.messages(c.account, id)).messages.find(
                    (m) => m.id === sent.id,
                ).status,
                'failed',
            );
            c.setNow('2026-11-15T08:00:00Z');
            assert.equal((await service.messages(c.account,id)).remaining,0);
            const deletion=await c.post(c.ownerRequest,'/api/team',{action:'deleteEmployeeAccount',employee:c.employee,username:c.account.username,replacement:''});
            assert.equal(deletion.status,200,await deletion.clone().text());
            assert.equal((await c.pool.query('SELECT 1 FROM wecomemployees WHERE employee=$1',[c.employee])).rowCount,0);
            assert.equal((await service.conversations(owner))[0].employee,null);
            await assert.rejects(service.messages(c.account,id),/无法访问/);
            assert.ok((await service.messages(owner,id)).messages.length>1,'离职后保留客服消息历史');
        }),
);
test('企业微信客户端令牌刷新、安全重试、网络超时；回调签名与 AES 解密', async () => {
    let tokens = 0,
        requests = 0;
    const client = createWecomClient({
        corpId: 'corp',
        secret: 'secret',
        fetchImpl: async (url) => {
            if (String(url).includes('gettoken'))
                return Response.json({
                    access_token: 'token-' + ++tokens,
                    expires_in: 7200,
                });
            if (++requests === 1) return Response.json({ errcode: 42001 });
            return Response.json({ errcode: 0, follow_user: ['staff'] });
        },
    });
    assert.deepEqual(await client.employees(), ['staff']);
    assert.equal(tokens, 2);
    const uncertain = createWecomClient({
        corpId: 'corp',
        secret: 'secret',
        fetchImpl: async (url) => {
            if (String(url).includes('gettoken'))
                return Response.json({ access_token: 'x' });
            throw new Error('timeout');
        },
    });
    await assert.rejects(uncertain.create({}), (e) => e.uncertain === true);
    const key = randomBytes(32),
        corpId = 'corp',
        token = 'callback-token',
        body = '<xml><Event><![CDATA[kf_msg_or_event]]></Event></xml>',
        length = Buffer.alloc(4);
    length.writeUInt32BE(Buffer.byteLength(body));
    let plain = Buffer.concat([
        randomBytes(16),
        length,
        Buffer.from(body),
        Buffer.from(corpId),
    ]);
    const pad = 32 - (plain.length % 32);
    plain = Buffer.concat([plain, Buffer.alloc(pad, pad)]);
    const cipher = createCipheriv('aes-256-cbc', key, key.subarray(0, 16));
    cipher.setAutoPadding(false);
    const encrypted = Buffer.concat([
        cipher.update(plain),
        cipher.final(),
    ]).toString('base64');
    const timestamp = '1794441600',
        nonce = 'nonce',
        signature = createHash('sha1')
            .update([token, timestamp, nonce, encrypted].sort().join(''))
            .digest('hex');
    const config = {
        corpId,
        token,
        key: key.toString('base64').replace(/=$/, ''),
    };
    assert.equal(
        decryptCallback({ encrypted, timestamp, nonce, signature }, config),
        body,
    );
    assert.throws(
        () =>
            decryptCallback(
                { encrypted, timestamp, nonce, signature: '0'.repeat(40) },
                config,
            ),
        /校验失败/,
    );
    assert.throws(
        () =>
            decryptCallback(
                { encrypted, timestamp, nonce, signature },
                { ...config, corpId: 'wrong' },
            ),
        /校验失败/,
    );
    assert.throws(()=>decryptCallback({encrypted,timestamp,nonce,signature:[signature]},config),/校验失败/);
    const secret='private-secret-must-not-appear';
    const rejected=createWecomClient({corpId:'corp',secret,fetchImpl:async()=>Response.json({errcode:40001,errmsg:'invalid secret '+secret})});
    await assert.rejects(rejected.verifyConnection(),error=>error.code===40001&&!error.message.includes(secret)&&error.message.includes('[已隐藏]'));
});

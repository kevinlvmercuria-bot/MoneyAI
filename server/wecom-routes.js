'use strict';
const express = require('express');
const { transaction } = require('./db');
const { fail } = require('./wecom-service');
function registerWecomRoutes(app, pool, auth, service, settings) {
    const router = express.Router();
    router.use(express.json({ limit: '128kb' }));
    router.use(async (req, _res, next) => {
        req.account = await auth.requireAccount(req);
        await settings?.ensure();
        next();
    });
    const owner = (req) =>
        fail(req.account.role === 'owner', '仅老板娘可以管理企微绑定。', 403);
    const text = (value) =>
        typeof value === 'string' &&
        value.trim().length > 0 &&
        value.length <= 200;
    router.get('/status', (req, res) =>
        res.json({
            configured: service.client.configured,
            textByteLimit: 4000,
            confirmationRequired: true,
            canManage: req.account.role === 'owner',
            verified: settings?.publicSettings().lastCheck?.ok || false,
        }),
    );
    router.get('/employees', async (req, res) => {
        owner(req);
        res.json({ userids: await service.client.employees() });
    });
    router.get('/customers', async (req, res) => {
        owner(req);
        fail(text(req.query.userid), '请选择企微员工。');
        res.json({
            externalUserids: await service.client.customers(req.query.userid),
        });
    });
    router.get('/customer', async (req, res) => {
        owner(req);
        fail(text(req.query.id), '请选择企微客户。');
        res.json(await service.client.customer(req.query.id));
    });
    router.get('/bindings', async (req, res) => {
        owner(req);
        res.json({
            employees: (
                await pool.query(
                    'SELECT * FROM wecomemployees ORDER BY employee',
                )
            ).rows,
            members: (
                await pool.query(
                    'SELECT * FROM wecommembers ORDER BY member_id',
                )
            ).rows,
        });
    });
    router.post('/bindings/employee', async (req, res) => {
        owner(req);
        const { employee, userid } = req.body;
        fail(text(employee) && text(userid), '请填写员工和企微 userid。');
        fail(
            (await service.client.employees()).includes(userid),
            '该 userid 没有客户联系权限。',
            409,
        );
        await transaction(pool, async (tx) => {
            fail(
                (
                    await tx.query(
                        "SELECT 1 FROM teamcredentials WHERE employee=$1 AND employee<>''",
                        [employee],
                    )
                ).rowCount,
                '员工登录账号尚未开通。',
                409,
            );
            fail(
                !(
                    await tx.query(
                        "SELECT 1 FROM wecomdeliveries WHERE employee=$1 AND status IN ('prepared','creating','pending','unknown')",
                        [employee],
                    )
                ).rowCount,
                '请先处理该员工未完成的发送记录。',
                409,
            );
            await tx.query(
                'INSERT INTO wecomemployees VALUES($1,$2) ON CONFLICT(employee) DO UPDATE SET userid=excluded.userid',
                [employee, userid],
            );
        });
        res.json({ saved: true });
    });
    router.post('/bindings/member', async (req, res) => {
        owner(req);
        const { memberId, externalUserid, employee } = req.body;
        fail(
            text(memberId) && text(externalUserid) && text(employee),
            '请选择会员、企微客户及负责员工。',
        );
        const mapping = (
            await pool.query(
                'SELECT userid FROM wecomemployees WHERE employee=$1',
                [employee],
            )
        ).rows[0];
        fail(mapping, '员工尚未绑定企微。', 409);
        const detail = await service.client.customer(externalUserid);
        fail(
            detail.follow_user?.some((u) => u.userid === mapping.userid),
            '客户不是所选员工的企微好友。',
            409,
        );
        await transaction(pool, async (tx) => {
            const { engine } = await service.engineFor(tx);
            fail(
                engine
                    .workspaceSnapshot()
                    .members.some((m) => m.member_id === memberId),
                '会员不存在。',
                404,
            );
            fail(
                !(
                    await tx.query(
                        "SELECT 1 FROM wecomdeliveries WHERE member_id=$1 AND status IN ('prepared','creating','pending','unknown')",
                        [memberId],
                    )
                ).rowCount,
                '请先处理该会员未完成的发送记录。',
                409,
            );
            await tx.query(
                'INSERT INTO wecommembers VALUES($1,$2) ON CONFLICT(member_id) DO UPDATE SET external_userid=excluded.external_userid',
                [memberId, externalUserid],
            );
        });
        res.json({ saved: true });
    });
    router.post('/preflight', async (req, res) =>
        res.json({
            items: await service.preflight(req.account, req.body.items),
        }),
    );
    router.post('/submit', async (req, res) =>
        res.status(202).json(await service.submit(req.account, req.body)),
    );
    router.get('/records', async (req, res) =>
        res.json({ records: await service.list(req.account) }),
    );
    router.post('/refresh', async (req, res) => {
        const records = await service.list(req.account);
        const ids = records
            .filter((r) => !['sent', 'failed'].includes(r.status))
            .map((r) => r.id);
        if (ids.length) {
            const groups = (
                await pool.query(
                    'SELECT DISTINCT group_id FROM wecomdeliveries WHERE id=ANY($1::uuid[])',
                    [ids],
                )
            ).rows;
            for (const group of groups)
                await service.processGroup(group.group_id);
        }
        res.json({ records: await service.list(req.account) });
    });
    app.use('/api/wecom', router);
}
module.exports = { registerWecomRoutes };

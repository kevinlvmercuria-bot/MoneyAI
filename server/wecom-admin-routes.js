'use strict';
const express = require('express');
const { randomUUID } = require('node:crypto');
const { transaction } = require('./db');
const { persistTeamState } = require('./team-repository');
const { fail, uuid } = require('./wecom-service');
function registerWecomAdminRoutes(app, pool, auth, settings, service) {
    const router = express.Router();
    router.use(express.json({ limit: '16kb' }));
    router.use(async (req, _res, next) => {
        req.account = await auth.requireAccount(req);
        fail(
            req.account.role === 'owner',
            '企微接入与真实测试仅限管理员操作。',
            403,
        );
        await settings.ensure();
        next();
    });
    router.get('/settings', (_req, res) => res.json(settings.publicSettings()));
    router.post('/settings', async (req, res) =>
        res.json(await settings.save(req.account, req.body)),
    );
    router.post('/check', async (req, res) =>
        res.json(await settings.check(req.body)),
    );
    router.get('/wizard', async (_req, res) => {
        const result = await transaction(pool, async (tx) => {
            const { engine } = await service.engineFor(tx),
                data = engine.workspaceSnapshot();
            return {
                employees: (
                    await tx.query(
                        "SELECT c.employee,c.username,w.userid FROM teamcredentials c LEFT JOIN wecomemployees w USING(employee) WHERE c.employee<>'' ORDER BY c.employee",
                    )
                ).rows,
                members: data.members
                    .filter((m) => (m.data_type ?? data.data_type) === 'real')
                    .map((m) => ({
                        memberId: m.member_id,
                        name: m.display_name,
                        phone: m.phone || '',
                        number: m.member_number || m.member_id,
                    })),
                bindings: (await tx.query('SELECT * FROM wecommembers')).rows,
            };
        });
        res.json(result);
    });
    async function preview(body) {
        const { employee, memberId, message } = body;
        fail(
            typeof employee === 'string' &&
                typeof memberId === 'string' &&
                typeof message === 'string' &&
                message.trim() &&
                message.length <= 1600 &&
                Buffer.byteLength(message.trim()) <= 4000,
            '请选择测试员工、真实会员并填写有效测试话术。',
        );
        const result = await transaction(pool, async (tx) => {
            const { engine } = await service.engineFor(tx),
                data = engine.workspaceSnapshot(),
                state = engine.exportState();
            const member = data.members.find((m) => m.member_id === memberId),
                credential = (
                    await tx.query(
                        "SELECT username FROM teamcredentials WHERE employee=$1 AND employee<>''",
                        [employee],
                    )
                ).rows[0];
            fail(
                member && (member.data_type ?? data.data_type) === 'real',
                '真实测试只能选择已导入或登记的真实会员。',
                409,
            );
            fail(credential, '所选员工尚未开通登录账号。', 409);
            const binding = (
                await tx.query(
                    'SELECT e.userid,m.external_userid FROM wecomemployees e CROSS JOIN wecommembers m WHERE e.employee=$1 AND m.member_id=$2',
                    [employee, memberId],
                )
            ).rows[0];
            fail(binding, '请先完成测试员工和会员的企微绑定。', 409);
            const active = state.tasks.find(
                (t) => t.member_id === memberId && t.status === 'assigned',
            );
            fail(
                !active ||
                    (active.assignee === employee &&
                        active.objective === 'greeting' &&
                        !active.employee_access_revoked),
                '该会员已有其他联系任务，请先处理或选择其他测试会员。',
                409,
            );
            const reasons = engine.contactReasons({
                member_id: memberId,
                objective: 'greeting',
                product_id: null,
            });
            fail(!reasons.length, reasons.join('；'), 409);
            return {
                employee,
                username: credential.username,
                memberId,
                name: member.display_name,
                userid: binding.userid,
                externalUserid: binding.external_userid,
                message: message.trim(),
                taskId: active?.task_id || null,
            };
        });
        const customer = await service.client.customer(result.externalUserid);
        fail(
            customer.follow_user?.some((u) => u.userid === result.userid),
            '测试客户与所选员工的好友关系已失效。',
            409,
        );
        return result;
    }
    router.post('/wizard/preview', async (req, res) =>
        res.json(await preview(req.body)),
    );
    router.post('/wizard/send', async (req, res) => {
        fail(
            req.body.confirmed === true,
            '请确认已与测试客户约定本次真实发送。',
        );
        fail(uuid(req.body.idempotencyKey), '缺少有效提交编号。');
        fail(
            settings.publicSettings().lastCheck?.ok,
            '请先完成当前配置的连接与权限检测。',
            409,
        );
        // A repeated confirmed request must return its existing batch, even after cooldown starts.
        const old = (
            await pool.query(
                'SELECT b.id,d.member_id,d.employee,d.message FROM wecombatches b JOIN wecomdeliveries d ON d.batch_id=b.id WHERE b.idempotency_key=$1 AND b.initiated_by=$2 LIMIT 1',
                [req.body.idempotencyKey, req.account.username],
            )
        ).rows[0];
        if (old) {
            fail(
                old.member_id === req.body.memberId &&
                    old.employee === req.body.employee &&
                    old.message === req.body.message?.trim(),
                '该测试编号已经用于其他接收人或话术，请重新预览。',
                409,
            );
            return res.status(202).json({ batchId: old.id, reused: true });
        }
        const item = await preview(req.body);
        const taskId = await transaction(pool, async (tx) => {
            const { engine, reminders } = await service.engineFor(tx);
            const active = engine
                .exportState()
                .tasks.find(
                    (t) =>
                        t.member_id === item.memberId &&
                        t.status === 'assigned',
                );
            if (active) {
                fail(
                    active.assignee === item.employee &&
                        active.objective === 'greeting' &&
                        !active.employee_access_revoked,
                    '任务已变化，请重新预览。',
                    409,
                );
                return active.task_id;
            }
            const result = engine.applyAction(req.account, {
                action: 'assign',
                tasks: [
                    {
                        member_id: item.memberId,
                        assignee: item.employee,
                        objective: 'greeting',
                        product_id: null,
                        message: item.message,
                        note: '经管理员确认的企微真实联调',
                        reason: '企微真实联调测试',
                    },
                ],
            });
            await persistTeamState(tx, engine, reminders);
            return result.taskIds[0];
        });
        const result = await service.submit(
            {
                role: 'employee',
                employee: item.employee,
                username: item.username,
            },
            {
                items: [{ taskId, message: item.message }],
                idempotencyKey: req.body.idempotencyKey,
            },
            { initiatedBy: req.account.username },
        );
        res.status(202).json(result);
    });
    app.use('/api/wecom/admin', router);
}
module.exports = { registerWecomAdminRoutes };

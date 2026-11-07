'use strict';

const path = require('node:path');
const express = require('express');
const { sql, connect, transaction } = require('./db');
const store = require('./store');
const { GOALS, SCENARIOS, MAX_TASKS_PER_ANALYSIS, DEMO_DATE, CARE_OUTCOMES, canContact, goalCandidates, buildReviewTask } = require('../public/rules');

function requireCondition(condition, status, message) {
    if (!condition) throw Object.assign(new Error(message), { apiStatus: status });
}

function createApp(pool) {
    const app = express();
    app.disable('x-powered-by');
    app.use('/api', express.json({ limit: '16kb' }));
    app.use('/api', (req, res, next) => {
        res.set('Cache-Control', 'no-store');
        requireCondition(req.method !== 'POST' || req.is('application/json'), 415, '请使用 application/json');
        next();
    });

    app.get('/api/state', async (_req, res) => {
        res.json(await transaction(pool, store.state, 'Shared'));
    });

    app.get('/api/members/:id/details', async (req, res) => {
        requireCondition(/^M\d{4}$/.test(req.params.id), 400, '会员编号无效');
        res.json(await transaction(pool, async (tx) => {
            const member = await tx.request().input('id', sql.VarChar(5), req.params.id)
                .query('SELECT id FROM dbo.Members WHERE id = @id');
            requireCondition(member.recordset.length, 404, '会员不存在');
            return store.memberDetails(tx, req.params.id);
        }, 'Shared'));
    });

    function mutate(work) {
        return async (req, res) => {
            const response = await transaction(pool, async (tx) => {
                const current = await store.state(tx);
                const extra = await work(req, tx, current);
                return { ...extra, state: await store.state(tx) };
            });
            res.json(response);
        };
    }

    app.post('/api/tasks', mutate(async (req, tx, { members, tasks, products }) => {
        const { goal, memberIds } = req.body ?? {};
        requireCondition(typeof goal === 'string' && (goal === 'general' || Object.hasOwn(GOALS, goal)) &&
            Array.isArray(memberIds) && memberIds.length > 0 && memberIds.length <= MAX_TASKS_PER_ANALYSIS &&
            memberIds.every((id) => typeof id === 'string' && /^M\d{4}$/.test(id)) &&
            new Set(memberIds).size === memberIds.length && (goal !== 'general' || memberIds.length === 1),
        400, '请选择有效的目标及会员，每批最多 5 人');

        const candidates = goal === 'general'
            ? members.filter((member) => member.id === memberIds[0] && canContact(member) &&
                !tasks.some((task) => task.memberId === member.id && task.status !== 'rejected'))
            : goalCandidates(members, tasks, goal, products);
        const selected = candidates.filter((member) => memberIds.includes(member.id));
        requireCondition(selected.length === memberIds.length, 409, '候选名单已变化，或会员不符合联系资格。请刷新后重试');
        for (const member of selected) {
            const task = buildReviewTask(member, null, goal, products);
            await store.insertTask(tx, task);
            await store.log(tx, 'create_review_task', `${member.id} · ${task.strategy} · 加入待审核`);
        }
        return { created: selected.length };
    }));

    function getTask(current, id, status) {
        const task = current.tasks.find((item) => item.id === id);
        requireCondition(task, 404, '任务不存在');
        requireCondition(task.status === status, 409, '任务状态已变化，请刷新后重试');
        return task;
    }

    function checkContact(current, task) {
        const member = current.members.find((item) => item.id === task.memberId);
        requireCondition(member && canContact(member), 409, '会员已不满足营销资格');
    }

    app.post('/api/tasks/:id/review', mutate(async (req, tx, current) => {
        const { decision, message } = req.body ?? {};
        requireCondition(decision === 'approve' || decision === 'reject', 400, '请选择通过或拒绝');
        const task = getTask(current, req.params.id, 'pending_review');
        if (decision === 'reject') {
            await store.updateTask(tx, task.id, 'rejected', '');
            await store.log(tx, 'reject_campaign', `${task.memberId} · ${task.strategy} · 审核拒绝`);
            return;
        }
        const edited = typeof message === 'string' ? message.trim() : '';
        requireCondition(edited && edited.length <= 1000, 400, '请输入 1 至 1000 字符的审核话术');
        checkContact(current, task);
        await store.updateTask(tx, task.id, 'approved', edited);
        await store.log(tx, 'approve_campaign', `${task.memberId} · ${task.strategy} · 审核通过`);
    }));

    app.post('/api/tasks/:id/execute', mutate(async (req, tx, current) => {
        const { scenario } = req.body ?? {};
        requireCondition(typeof scenario === 'string' && Object.hasOwn(SCENARIOS, scenario), 400, '请选择有效的模拟情景');
        const task = getTask(current, req.params.id, 'approved');
        checkContact(current, task);
        await store.updateTask(tx, task.id, 'executed_simulated', task.editedMessage, scenario);
        await store.log(tx, 'simulate_campaign_execution', `${task.memberId} · ${task.strategy} · ${SCENARIOS[scenario].label}`);
    }));

    app.post('/api/care-records', mutate(async (req, tx, current) => {
        const { memberId, outcome, note, owner, followUp = null } = req.body ?? {};
        requireCondition(typeof memberId === 'string' && /^M\d{4}$/.test(memberId) && CARE_OUTCOMES.includes(outcome),
            400, '请选择有效的会员和处理结果');
        const cleanNote = typeof note === 'string' ? note.trim() : '';
        const cleanOwner = typeof owner === 'string' ? owner.trim() : '';
        requireCondition(cleanNote.length > 0 && cleanNote.length <= 1000 && cleanOwner.length > 0 && cleanOwner.length <= 80,
            400, '请填写反馈或原因（最多 1000 字符）和负责人（最多 80 字符）');
        if (followUp !== null) {
            const validDate = typeof followUp === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(followUp) &&
                Number.isFinite(Date.parse(followUp)) && new Date(followUp).toISOString().slice(0, 10) === followUp;
            requireCondition(validDate && followUp > DEMO_DATE, 400, '请填写晚于演示基准日的有效跟进日期');
            requireCondition(!['推荐不合适', '不再营销'].includes(outcome), 400, '此处理结果不应安排再次联系');
            const earliest = new Date(DEMO_DATE);
            earliest.setUTCDate(earliest.getUTCDate() + 14);
            requireCondition(!['已沟通', '未回复'].includes(outcome) || followUp >= earliest.toISOString().slice(0, 10),
                400, '已联系会员的计划跟进至少间隔 14 天');
        }
        const member = current.members.find((item) => item.id === memberId);
        requireCondition(member, 404, '会员不存在');
        requireCondition(canContact(member) && !member.careHandled, 409, '会员已处理或当前不满足联系资格，请刷新后重试');
        await store.insertCareRecord(tx, {
            memberId, outcome, note: cleanNote, owner: cleanOwner, followUp, recordedAsOf: DEMO_DATE,
        });
        await store.log(tx, 'save_care_record', `${memberId} · ${outcome} · 负责人 ${cleanOwner}`);
    }));

    app.post('/api/reset', mutate(async (_req, tx) => {
        // 关怀限制由记录派生；清空记录后从基础会员资料恢复初始演示资格。
        await tx.request().query('DELETE FROM dbo.CareRecords;');
        const { members } = await store.state(tx);
        const demoMember = members.find((member) => member.id === 'M0001');
        requireCondition(demoMember, 409, '请先初始化演示会员');
        await tx.request().query('DELETE FROM dbo.OperationLogs; DELETE FROM dbo.Tasks;');
        await store.seedTask(tx, demoMember);
    }));

    app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在' }));
    app.use(express.static(path.join(__dirname, '..', 'public')));
    app.use((error, _req, res, _next) => {
        if (error.apiStatus) return res.status(error.apiStatus).json({ error: error.message });
        if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON 格式有误' });
        if (error.type === 'entity.too.large') return res.status(413).json({ error: '请求体过大' });
        console.error(error);
        return res.status(500).json({ error: '服务端出错，请检查 SQL Server 连接和初始化状态' });
    });
    return app;
}

async function start() {
    const pool = await connect();
    pool.on('error', (error) => console.error('数据库连接池错误：', error.message));
    try {
        const state = await transaction(pool, store.state, 'Shared');
        if (!state.members.length) throw new Error('会员数据为空，请先运行 npm run db:init');
    } catch (error) {
        await pool.close();
        throw new Error('数据库尚未就绪，请检查连接并运行 npm run db:init。' + error.message);
    }
    const server = createApp(pool).listen(Number(process.env.APP_PORT || 3000), '127.0.0.1', () => {
        console.log(`NailMate 已启动 http://127.0.0.1:${server.address().port}`);
    });
    server.once('error', async (error) => {
        console.error('HTTP 启动失败：', error.message);
        await pool.close();
        process.exitCode = 1;
    });
    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.once(signal, () => {
            server.close(async () => {
                await pool.close();
            });
        });
    }
}

if (require.main === module) {
    start().catch((error) => {
        console.error('启动失败：', error.message);
        process.exitCode = 1;
    });
}

module.exports = { createApp };

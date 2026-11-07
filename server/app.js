'use strict';
// 历史联调实现，由 app.test.js 使用；正式服务入口为 main.js。
const express = require('express');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createMemberRepository } = require('./members');
const { buildReviewTask, canContact, SCENARIOS, GOALS, DEMO_SERVICE_PRICE } = require('../public/rules');

class BusinessError extends Error {
    constructor(code, message) { super(message); this.code = code; }
}
function createApp({ mode = process.env.DB_MODE || 'mock', repository = createMemberRepository(mode) } = {}) {
    const app = express();
    let tasks = [];
    let logs = [];
    let nextId = 1;
    let initialized = false;
    const idPattern = /^M\d{4}$/;
    const validate = (condition, message) => { if (!condition) throw new BusinessError(-1001, message); };
    function addLog(name, desc) {
        logs.unshift({ time: new Date().toISOString(), name, desc });
    }
    async function state() {
        const members = await repository.list();
        if (!initialized) {
            initialized = true;
            const member = members.find((item) => item.id === 'M0001');
            if (member) tasks.push(buildReviewTask(member, 'T' + String(nextId++).padStart(4, '0'), 'wake'));
        }
        return { members, tasks, logs, memberSource: mode, mock: true };
    }
    function taskById(id) {
        const task = tasks.find((item) => item.id === id);
        if (!task) throw new BusinessError(-1004, '任务不存在');
        return task;
    }
    async function eligibleMember(id) {
        const member = await repository.find(id);
        if (!member) throw new BusinessError(-1004, '会员不存在');
        if (!canContact(member)) throw new BusinessError(-1005, '会员不满足联系条件');
        return member;
    }

    app.disable('x-powered-by');
    app.use('/api', (req, res, next) => {
        res.set('Cache-Control', 'no-store');
        res.set('X-Request-Id', randomUUID());
        const json = res.json.bind(res);
        res.json = (data) => json(data && typeof data.code === 'number' && typeof data.message === 'string'
            ? data : { code: 0, message: 'success', data: data ?? null });
        if (process.env.CORS_ORIGIN && req.headers.origin === process.env.CORS_ORIGIN) {
            res.set('Access-Control-Allow-Origin', process.env.CORS_ORIGIN);
            res.vary('Origin');
            res.set('Access-Control-Allow-Headers', 'Content-Type');
            res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        }
        if (req.method === 'OPTIONS') return res.json(null);
        next();
    });
    app.use(express.json({ limit: '64kb' }));

    app.get('/api/health', async (_req, res) => {
        await repository.find('M0001');
        res.json({ status: 'ok', memberSource: mode, workflowSource: 'mock' });
    });
    app.get('/api/members/:id', async (req, res) => {
        validate(idPattern.test(req.params.id), '会员编号格式为 M 加四位数字');
        const member = await repository.find(req.params.id);
        if (!member) throw new BusinessError(-1004, '会员不存在');
        res.json(member);
    });
    app.get('/api/state', async (_req, res) => res.json(await state()));
    app.get('/api/tasks', async (_req, res) => {
        await state();
        res.json({ mock: true, list: tasks });
    });
    app.post('/api/tasks', async (req, res) => {
        const { goal, memberIds } = req.body || {};
        validate(goal === 'general' || Object.hasOwn(GOALS, goal || ''), 'goal 不合法');
        validate(Array.isArray(memberIds) && memberIds.length > 0 && memberIds.length <= 20
            && memberIds.every((id) => typeof id === 'string' && idPattern.test(id)), 'memberIds 需包含 1–20 个合法会员编号');
        await state();
        const ids = [...new Set(memberIds)];
        // Validate the whole batch before changing any task state.
        const candidates = await Promise.all(ids.map(eligibleMember));
        const created = [];
        for (const member of candidates) {
            if (tasks.some((task) => task.memberId === member.id && task.status !== 'rejected')) continue;
            const task = buildReviewTask(member, 'T' + String(nextId++).padStart(4, '0'), goal);
            tasks.push(task);
            created.push(task.id);
        }
        addLog('create_tasks', `联调样例：创建 ${created.length} 条任务，未持久化`);
        res.json({ mock: true, created: created.length, taskIds: created, state: await state() });
    });
    app.post('/api/tasks/:id/review', async (req, res) => {
        const { decision, message } = req.body || {};
        validate(['approve', 'reject'].includes(decision), 'decision 必须为 approve 或 reject');
        validate(decision !== 'approve' || (typeof message === 'string' && message.trim().length > 0 && message.length <= 2000), '审核通过需提供 1–2000 字符 message');
        await state();
        const task = taskById(req.params.id);
        if (task.status !== 'pending_review') throw new BusinessError(-1005, '只有待审核任务可以审核');
        if (decision === 'approve') await eligibleMember(task.memberId);
        task.status = decision === 'approve' ? 'approved' : 'rejected';
        if (decision === 'approve') task.editedMessage = message.trim();
        addLog('review_task', `${task.id} ${task.status}（联调样例）`);
        res.json({ mock: true, task, state: await state() });
    });
    app.post('/api/tasks/:id/execute', async (req, res) => {
        const { scenario } = req.body || {};
        validate(typeof scenario === 'string' && Object.hasOwn(SCENARIOS, scenario), 'scenario 不合法');
        await state();
        const task = taskById(req.params.id);
        if (task.status !== 'approved') throw new BusinessError(-1005, '只有已通过任务可以模拟执行');
        await eligibleMember(task.memberId);
        task.result = { ...SCENARIOS[scenario], spending: SCENARIOS[scenario].visit ? DEMO_SERVICE_PRICE : 0 };
        task.status = 'executed_simulated';
        addLog('simulate_execution', `${task.id} ${scenario}，未发送真实消息`);
        res.json({ mock: true, task, state: await state() });
    });
    app.get('/api/reports/summary', async (_req, res) => {
        await state();
        const executed = tasks.filter((task) => task.status === 'executed_simulated');
        res.json({ mock: true, scope: 'current_process', tasks: tasks.length,
            approved: tasks.filter((task) => ['approved', 'executed_simulated'].includes(task.status)).length,
            contacted: executed.length,
            replied: executed.filter((task) => task.result.reply).length,
            booked: executed.filter((task) => task.result.booking).length,
            visited: executed.filter((task) => task.result.visit).length,
            simulatedSpending: executed.reduce((sum, task) => sum + task.result.spending, 0),
            currency: 'CNY', note: '联调样例，无真实触达、到店或收款，不代表增量收入' });
    });
    app.post('/api/reset', async (_req, res) => {
        tasks = []; logs = []; nextId = 1; initialized = false;
        res.json({ mock: true, state: await state() });
    });
    app.use('/api', (_req, res) => res.status(404).json({ code: -1004, message: '接口不存在', data: null }));
    app.use(express.static(path.join(__dirname, '..', 'public')));
    app.use((error, _req, res, _next) => {
        const code = error instanceof BusinessError ? error.code
            : ['entity.parse.failed', 'entity.too.large'].includes(error.type) ? -1001 : -2000;
        if (code === -2000) console.error('API error:', error.code || error.name);
        res.status(200).json({ code, message: code === -2000 ? '服务或数据库不可用，请检查配置' : code === -1001 && !(error instanceof BusinessError) ? 'JSON 请求格式错误或超过 64KB' : error.message, data: null });
    });
    app.locals.close = () => repository.close();
    return app;
}
module.exports = { createApp };

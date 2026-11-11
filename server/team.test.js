'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { authenticate } = require('./test-auth-client');
const snapshot = require('../data/team-data.json');
const { createTeamStore, teamBusinessClock, teamTodoReasons } = require('../public/team-store');
const { teamChartStages, teamChartTaskGroups, teamResultChart } = require('../public/team-chart');
const owner = { role: 'owner', employee: '' };
const eligible = snapshot.members.filter(m => m.marketing_consent && !m.unresolved_complaint && !m.has_upcoming_appointment && m.data_completeness >= .8 &&
    (!m.last_contact_date || (Date.parse(snapshot.as_of_date) - Date.parse(m.last_contact_date)) / 86400000 >= 14));
function assignment(engine, count = 1) {
    const assignee = engine.roster[0];
    return eligible.slice(0, count).map(m => ({ member_id: m.member_id, objective: 'greeting', product_id: null, assignee, message: '最近过得怎么样？', note: '', reason: '日常问候' }));
}

test('新版分派原子性、员工归属、沟通限制和刷新恢复', () => {
    const memory = new Map();
    const storage = { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) };
    const engine = createTeamStore(snapshot, { storage });
    const tasks = assignment(engine, 3);
    const employee = { role: 'employee', employee: tasks[0].assignee };
    const other = { role: 'employee', employee: engine.roster[1] };
    assert.throws(() => engine.applyAction(employee, { action: 'assign', tasks }), /权限/);
    assert.throws(() => engine.applyAction(owner, { action: 'assign', tasks: [tasks[0], tasks[0]] }), /负责/);
    assert.equal(engine.scopedState(owner).tasks.length, 0, '批次失败不得留下部分任务');
    const result = engine.applyAction(owner, { action: 'assign', tasks });
    const id = result.taskIds[0];
    assert.equal(engine.scopedState(other).tasks.length, 0);
    assert.throws(() => engine.applyAction(other, { action: 'result', id, outcome: '已预约', note: '', message: '' }), /没有找到/);
    engine.applyAction(employee, { action: 'result', id, outcome: '已预约', note: '周末方便', message: '' });
    engine.applyAction(employee, { action: 'result', id: result.taskIds[1], outcome: '暂不联系', note: '', message: '' });
    engine.applyAction(employee, { action: 'result', id: result.taskIds[2], outcome: '未回复', note: '', message: '' });
    assert.deepEqual(teamChartStages(engine.scopedState(owner).tasks).map(([, count]) => count), [3, 2, 1, 1, 0]);
    const restored = createTeamStore(snapshot, { storage });
    assert.equal(restored.scopedState(owner).tasks[0].result.note, '周末方便');
    assert.equal(restored.scopedState(owner).memberUpdates[tasks[0].member_id].appointment, true);
    assert.throws(() => restored.applyAction(employee, { action: 'result', id, outcome: '已预约', note: '', message: '' }), /已更新/);
    assert.throws(() => restored.applyAction(owner, { action: 'assign', tasks: [tasks[0]] }), /暂不可分派/);
});

test('后续反馈可修改，保留历史并按最新结果重算；冷却期不会拦截登记', () => {
    const engine = createTeamStore(snapshot, { now: () => new Date('2026-11-11T16:00:00Z') });
    const tasks = assignment(engine);
    const employee = { role: 'employee', employee: tasks[0].assignee };
    const { taskIds: [id] } = engine.applyAction(owner, { action: 'assign', tasks });
    const save = (outcome, revision, note = '') => engine.applyAction(employee, { action: 'result', id, outcome, note, message: '', expectedRevision: revision });
    save('未回复', 0, '上午未回');
    save('有意向', 1, '下午回复了，想看裸色款');
    assert.deepEqual(teamChartStages(engine.scopedState(owner).tasks).map(([, count]) => count), [1, 1, 1, 0, 0]);
    save('已预约', 2, '确认周六');
    const memberId = tasks[0].member_id;
    assert.equal(engine.scopedState(owner).memberUpdates[memberId].appointment, true);
    assert.throws(() => save('已沟通', 1, '过期的页面'), /已更新/);
    save('有意向', 3, '取消原预约，时间另约');
    assert.equal(engine.scopedState(owner).memberUpdates[memberId].appointment, undefined);
    assert.equal(engine.scopedState(owner).memberUpdates[memberId].contact_recorded_on, '2026-11-12');
    save('暂不联系', 4, '这几天忙');
    assert.equal(engine.scopedState(owner).memberUpdates[memberId].care_paused, true);
    assert.equal(engine.scopedState(owner).memberUpdates[memberId].contact_recorded_on, '2026-11-12', '更新暂不联系不得撤销已经发生的联系冷却');
    save('不再营销', 5, '修改登记');
    assert.equal(engine.scopedState(owner).memberUpdates[memberId].care_paused, undefined);
    assert.equal(engine.scopedState(owner).memberUpdates[memberId].consent, false);
    save('已沟通', 6, '更正：顾客没有取消授权');
    const state = engine.scopedState(owner);
    assert.equal(state.memberUpdates[memberId].consent, undefined);
    assert.equal(state.tasks[0].result_history.length, 7);
    assert.equal(state.tasks[0].result_history[0].note, '上午未回');
    assert.equal(state.care_records.length, 1, '修改反馈不会新增一条联系或重复累计图表');
    assert.equal(state.care_records[0].outcome, '已沟通');
    const restored = createTeamStore(snapshot, { initialState: engine.exportState() });
    assert.equal(restored.scopedState(employee).tasks[0].result_revision, 7);
    assert.equal(restored.scopedState(employee).tasks[0].result_history.length, 7);
    save('已沟通', 7, '更正：顾客没有取消授权');
    assert.equal(engine.scopedState(employee).tasks[0].result_revision, 7, '相同内容不重复写历史');
});

test('旧任务兼容后续修改；员工可读取负责顾客的完整新增备注', () => {
    const engine = createTeamStore(snapshot);
    const tasks = assignment(engine, 2);
    tasks[1].assignee = engine.roster[1];
    const employee = { role: 'employee', employee: tasks[0].assignee };
    const { taskIds: [id] } = engine.applyAction(owner, { action: 'assign', tasks });
    engine.applyAction(owner, { action: 'note', memberId: tasks[0].member_id, text: '偏好备注一', type: 'preference', pinned: true });
    engine.applyAction(owner, { action: 'note', memberId: tasks[0].member_id, text: '老板娘新补充的沟通细节', type: 'communication', pinned: false });
    engine.applyAction(owner, { action: 'note', memberId: tasks[1].member_id, text: '另一员工负责的顾客', type: 'communication', pinned: false });
    assert.equal(engine.scopedState(employee).notes.length, 2);
    assert.deepEqual(engine.scopedState(employee).notes.map(note => note.note_text), ['偏好备注一', '老板娘新补充的沟通细节']);
    const legacy = engine.exportState();
    Object.assign(legacy.tasks[0], { status: 'recorded', result: { outcome: '未回复', note: '旧记录', contacted: true, booked: false, recorded_on: snapshot.as_of_date } });
    legacy.memberUpdates[tasks[0].member_id] = { contact_recorded_on: snapshot.as_of_date, last_contact_date: snapshot.as_of_date };
    const restored = createTeamStore(snapshot, { initialState: legacy });
    const response = restored.applyAction(employee, { action: 'result', id, outcome: '已预约', note: '后来回复了', message: '', expectedRevision: 0 });
    assert.equal(response.state.tasks[0].result_history[0].note, '旧记录');
    assert.equal(response.state.tasks[0].result_history[1].note, '后来回复了');
    assert.throws(() => restored.scopedState({ role: 'guest' }), /先选择身份/);
});

test('业务日期按北京时间跨零点，冷却满 14 个自然日后解除，审计保存 UTC', () => {
    const member = eligible[0];
    const fixture = { ...snapshot, members: [{ ...member, last_contact_date: '2026-11-01' }], appointments: [] };
    let now = new Date('2026-11-14T15:59:59Z');
    assert.equal(teamBusinessClock(now).date, '2026-11-14');
    const engine = createTeamStore(fixture, { now: () => now });
    const tasks = assignment(engine);
    const assign = () => engine.applyAction(owner, { action: 'assign', tasks, workDate: '2100-01-01' });
    assert.throws(assign, /14 天内已联系/);
    now = new Date('2026-11-14T16:00:00Z');
    assert.deepEqual(teamBusinessClock(now), { date: '2026-11-15', local: '2026-11-15T00:00', utc: '2026-11-14T16:00:00.000Z' });
    const { taskIds: [id], state } = assign();
    assert.equal(state.workDate, '2026-11-15');
    assert.equal(state.tasks[0].assigned_on, '2026-11-15');
    assert.equal(state.tasks[0].assigned_at, '2026-11-14T16:00:00.000Z');
    const employee = { role: 'employee', employee: tasks[0].assignee };
    const result = engine.applyAction(employee, { action: 'result', id, outcome: '已沟通', note: '', message: '' }).state.tasks[0].result;
    assert.equal(result.recorded_on, '2026-11-15');
    assert.equal(result.recorded_at, '2026-11-14T16:00:00.000Z');
    now = new Date('2026-11-27T16:00:00Z');
    const restarted = createTeamStore(fixture, { now: () => now, initialState: engine.exportState() });
    assert.throws(() => restarted.applyAction(owner, { action: 'assign', tasks }), /14 天内已联系/);
    now = new Date('2026-11-28T16:00:00Z');
    assert.equal(restarted.applyAction(owner, { action: 'assign', tasks }).state.tasks[1].assigned_on, '2026-11-29');
});

test('旧反馈使用实际 UTC 审计时间恢复冷却口径，保留原始历史', () => {
    const engine = createTeamStore(snapshot, { now: () => new Date('2026-11-15T10:00:00Z') });
    const tasks = assignment(engine);
    engine.applyAction(owner, { action: 'assign', tasks });
    const saved = engine.exportState();
    const task = saved.tasks[0];
    task.status = 'recorded';
    task.result = { contacted: true, outcome: '已沟通', recorded_on: snapshot.as_of_date, updated_at: '2026-11-14T16:00:00.000Z' };
    const restarted = createTeamStore(snapshot, { now: () => new Date('2026-11-15T10:00:00Z'), initialState: saved });
    assert.equal(restarted.scopedState(owner).memberUpdates[task.member_id].contact_recorded_on, '2026-11-15');
    assert.equal(restarted.exportState().tasks[0].result.recorded_on, snapshot.as_of_date);
    assert.throws(() => restarted.applyAction(owner, { action: 'assign', tasks }), /14 天内已联系/);
});

test('护理回访满 21 个北京时间自然日到期，未分派时跨日保留', () => {
    const member = eligible[0];
    const earlier = { member_id: member.member_id, order_type: 'nail_service', order_date: '2026-10-21', order_id: 'order-early', data_type: 'simulation' };
    const recent = { ...earlier, order_date: '2026-10-22', order_id: 'order-recent' };
    const fixture = {
        ...snapshot,
        orders: [recent, earlier, { ...recent, order_type: 'care_product', order_date: '2026-11-01' }],
        member_care_profiles: [{ member_id: member.member_id, care_followup_opt_in: true }],
    };
    let now = new Date('2026-11-11T15:59:00Z');
    const engine = createTeamStore(fixture, { now: () => now });
    const [input] = assignment(engine);
    input.objective = 'care';
    input.service_order_id = recent.order_id;
    input.product_id = snapshot.products.find(product => product.is_active && product.product_type === 'care_service').product_id;
    const assign = () => engine.applyAction(owner, { action: 'assign', tasks: [input] });
    assert.throws(assign, /第 21 天/);

    now = new Date('2026-11-11T16:00:00Z');
    assert.equal(engine.refreshCareReminders(), true);
    assert.equal(engine.scopedState(owner).careReminders[0].status, 'pending');
    now = new Date('2026-11-12T16:00:00Z');
    assert.equal(engine.refreshCareReminders(), false);
    const { taskIds: [id] } = assign();
    const employee = { role: 'employee', employee: input.assignee };
    const result = engine.applyAction(employee, { action: 'result', id, outcome: '已沟通', note: '', message: '' });
    assert.equal(result.state.tasks[0].status, 'recorded');
    assert.equal(engine.scopedState(owner).careReminders[0].status, 'processed');
    assert.throws(assign, /第 21 天/);
});

test('真实顾客只有确认完成且带完成日的美甲服务可以产生回访', () => {
    const member = { ...eligible[0], data_type: 'real' };
    const service = { member_id: member.member_id, order_type: 'nail_service', data_type: 'real', order_date: '2026-10-01' };
    const fixture = { ...snapshot, data_type: 'real', members: [member], orders: [
        { ...service, order_id: 'unconfirmed' },
        { ...service, order_id: 'date-missing', status: 'completed' },
        { ...service, order_id: 'cancelled', status: 'cancelled', completed_on: '2026-10-01' },
        { ...service, order_id: 'simulation', data_type: 'simulation', status: 'completed', completed_on: '2026-10-01' },
        { ...service, order_id: 'care-only', order_type: 'care_service', status: 'completed', completed_on: '2026-10-01' },
    ], member_care_profiles: [{ member_id: member.member_id, care_followup_opt_in: true }] };
    const now = () => new Date('2026-11-22T04:00:00Z');
    const engine = createTeamStore(fixture, { now });
    assert.equal(engine.refreshCareReminders(), false);
    fixture.orders.push({ ...service, order_id: 'completed-service', status: 'completed', completed_on: '2026-11-01' });
    assert.equal(engine.refreshCareReminders(), true);
    assert.deepEqual(engine.scopedState(owner).careReminders.map(row => [row.service_order_id, row.data_type]), [
        ['completed-service', 'real'],
    ]);
});

test('北京时间待办、预约改期、到店结果与明细统计沿用同一任务', () => {
    let now = new Date('2026-11-10T16:15:00Z');
    const engine = createTeamStore(snapshot, { now: () => now });
    const tasks = assignment(engine);
    const employee = { role: 'employee', employee: tasks[0].assignee };
    const { taskIds: [id] } = engine.applyAction(owner, { action: 'assign', tasks });
    const getState = () => engine.scopedState(employee);
    const getTask = () => getState().tasks[0];
    const save = (outcome, expectedRevision, plan) => engine.applyAction(employee, {
        action: 'result', id, outcome, expectedRevision, note: '', message: '', ...plan,
    });
    assert.equal(getState().calendarDate, '2026-11-11');
    assert.deepEqual(teamTodoReasons(getTask(), getState().calendarDate), ['待联系']);
    assert.throws(() => save('未回复', 0, { followUpOn: '2026-11-31' }), /有效的跟进日期/);
    save('未回复', 0, { followUpOn: '2026-11-12', followUpNote: '再问哪天有空' });
    assert.deepEqual(teamTodoReasons(getTask(), getState().calendarDate), []);
    assert.equal(teamChartTaskGroups(getState().tasks).unanswered[0].result.follow_up_note, '再问哪天有空');
    now = new Date('2026-11-11T16:15:00Z');
    assert.deepEqual(teamTodoReasons(getTask(), getState().calendarDate), ['今天跟进']);
    save('已预约', 1, { followUpOn: '', followUpNote: '', appointmentAt: '2026-11-13T14:00' });
    assert.throws(() => save('已预约', 2, { appointmentStatus: 'visited' }), /预约时间到达/);
    assert.throws(() => save('已预约', 2, { appointmentStatus: 'rescheduled' }), /新的预约时间/);
    save('已预约', 2, { appointmentAt: '2026-11-14T14:00', appointmentStatus: 'rescheduled' });
    assert.equal(getTask().result.appointment_status, 'rescheduled');
    now = new Date('2026-11-14T07:00:00Z');
    assert.deepEqual(teamTodoReasons(getTask(), getState().calendarDate), ['今日预约']);
    save('已预约', 3, { appointmentStatus: 'no_show' });
    assert.deepEqual(teamTodoReasons(getTask(), getState().calendarDate), []);
    assert.equal(teamChartTaskGroups(getState().tasks).visited.length, 0);
    save('已预约', 4, { appointmentStatus: 'visited' });
    assert.deepEqual(teamChartStages(getState().tasks).map(([, count]) => count), [1, 1, 1, 1, 1]);
    assert.equal(getState().memberUpdates[tasks[0].member_id].appointment, undefined);
    assert.equal(getTask().result_history[1].appointment_at, '2026-11-13T14:00');
    assert.equal(engine.scopedState(owner).care_records.length, 1);
});

test('图表零数据和大数值、反馈口径、存储失败不伪报成功', () => {
    const empty = teamResultChart([]);
    assert.match(empty, /disabled/);
    assert.doesNotMatch(empty, /NaN|Infinity/);
    const tasks = ['未回复', '有意向', '已预约', '已沟通', '暂不联系', '不再营销'].map(outcome => ({ status: 'recorded', result: { outcome, contacted: outcome !== '暂不联系', booked: outcome === '已预约' } }));
    assert.deepEqual(teamChartStages(tasks).map(([, count]) => count), [6, 5, 4, 1, 0]);
    assert.doesNotMatch(teamResultChart(Array.from({ length: 2800 }, () => tasks[2])), /NaN|Infinity/);
    const engine = createTeamStore(snapshot, { storage: { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } } });
    assert.throws(() => engine.applyAction(owner, { action: 'assign', tasks: assignment(engine) }), /QuotaExceededError/);
    assert.equal(engine.scopedState(owner).tasks.length, 0);
});

test('SQL 护理回访补算、唯一性、原子分派及订单状态变更', { timeout: 90000 }, async () => {
    const { connect, transaction } = require('./db');
    const { initialize } = require('../database/setup');
    const { initializeTeamCareReminders } = require('./team-reminders');
    const { createApp } = require('./main');
    const database = 'NailMate_Care_' + randomBytes(8).toString('hex');
    const master = await connect('master');
    const [a, b, c] = eligible;
    const services = [a, b, c].map((member, index) => ({
        member_id: member.member_id, order_id: 'fixture-service-' + index, order_type: 'nail_service',
        completed_on: '2026-11-01', status: 'completed', data_type: 'simulation',
    }));
    const fixture = { ...snapshot, orders: [...services,
        ...['cancelled', 'pending'].map(status => ({ ...services[0], order_id: status, status, completed_on: '2026-11-18' })),
        { ...services[0], order_id: 'fixture-care-product', order_type: 'care_product', completed_on: '2026-11-18' },
    ], appointments: [{ member_id: c.member_id, status: 'scheduled', appointment_date: '2026-11-30' }],
    member_care_profiles: [a, b, c].map(member => ({ member_id: member.member_id, care_followup_opt_in: true })) };
    let now = new Date('2026-11-21T15:59:59Z');
    let created = false, pool, server, base;
    const postTo = request => body => request(base + '/api/team', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    try {
        await master.request().query(`CREATE DATABASE [${database}]`); created = true;
        pool = await connect(database);
        await assert.rejects(transaction(pool, async tx => {
            await initializeTeamCareReminders(tx);
            throw new Error('test migration rollback');
        }), /test migration rollback/);
        assert.equal((await pool.request().query("SELECT OBJECT_ID('dbo.TeamCareReminders') AS id")).recordset[0].id, null);
        await initialize(pool);
        await transaction(pool, initializeTeamCareReminders);
        const start = async () => {
            server = createApp(pool, { teamNow: () => now, teamSnapshot: fixture }).listen(0, '127.0.0.1');
            await new Promise(resolve => server.once('listening', resolve));
            base = 'http://127.0.0.1:' + server.address().port;
        };
        await start();
        let post = postTo(await authenticate(base, 'setup'));
        const read = async () => (await (await post({ action: 'bootstrap' })).json()).state;
        const before = await read();
        assert.deepEqual(before.careReminders, [], '第 20 天没有提醒');
        const employee = before.accounts[0].employee;
        const credentials = { username: 'care-worker', password: 'care-worker-fixture' };
        assert.equal((await post({ action: 'employeeAccount', employee, ...credentials })).status, 200);
        let employeePost = postTo(await authenticate(base, 'login', credentials));

        now = new Date('2026-11-21T16:00:00Z');
        const scans = await Promise.all([read(), read()]);
        assert.deepEqual(scans[0].careReminders, scans[1].careReminders);
        assert.equal(scans[0].careReminders.length, 3, '第 21 天到期，取消及未完成订单不会覆盖有效订单');
        assert.ok(scans[0].careReminders.every(row => row.due_on === '2026-11-22' && row.status === 'pending' && row.data_type === 'simulation'));
        const rows = () => pool.request().query('SELECT * FROM dbo.TeamCareReminders').then(result => result.recordset);
        assert.equal((await rows()).length, 3);
        await assert.rejects(pool.request().query(`
            INSERT dbo.TeamCareReminders
            SELECT TOP (1) member_id,service_order_id,completed_on,due_on,status,task_id,data_type,created_at,updated_at
            FROM dbo.TeamCareReminders`), /PRIMARY KEY|duplicate|重复/i);
        const employeeBefore = await (await employeePost({ action: 'bootstrap' })).json();
        assert.deepEqual(employeeBefore.state.tasks, []);
        assert.equal(employeeBefore.state.careReminders, undefined);

        await new Promise(resolve => server.close(resolve));
        server = null;
        now = new Date('2026-11-22T16:00:00Z');
        await start();
        post = postTo(await authenticate(base, 'login'));
        employeePost = postTo(await authenticate(base, 'login', credentials));
        assert.deepEqual((await read()).careReminders, scans[0].careReminders, '重启后第 22 天仍可分派');
        const product_id = fixture.products.find(product => product.is_active && product.product_type === 'care_service').product_id;
        const assign = (service, fields = {}) => ({ action: 'assign', tasks: [{
            member_id: service.member_id, objective: 'care', service_order_id: service.order_id,
            product_id, assignee: employee, message: '护理回访测试', note: '', reason: '', ...fields,
        }] });
        assert.equal((await post(assign(services[2]))).status, 409, '无关预约仍保留现有联系限制');
        assert.equal((await read()).careReminders.find(row => row.member_id === c.member_id).status, 'pending');
        const request = assign(services[0]);
        assert.equal((await post({ ...request, tasks: [...request.tasks, { ...request.tasks[0], member_id: 'missing' }] })).status, 400);
        assert.equal((await read()).careReminders.find(row => row.member_id === a.member_id).status, 'pending', '批次失败后可重试');
        const assigned = await Promise.all([post(request), post(request)]);
        assert.deepEqual(assigned.map(response => response.status).sort(), [200, 409]);
        const taskId = (await assigned.find(response => response.ok).json()).taskIds[0];
        const employeeAfter = (await (await employeePost({ action: 'bootstrap' })).json()).state;
        assert.deepEqual(employeeAfter.tasks.map(task => task.task_id), [taskId]);
        assert.equal((await employeePost({ action: 'result', id: taskId, outcome: '已预约',
            note: '对应维护预约', message: '', appointmentAt: '2026-11-23T12:00' })).status, 200);
        assert.equal((await read()).careReminders.find(row => row.member_id === a.member_id).status, 'booked');
        assert.equal((await post(request)).status, 409);

        services[1].completed_on = '2026-11-03';
        assert.equal((await read()).careReminders.find(row => row.member_id === b.member_id).due_on, '2026-11-24');
        assert.equal((await post(assign(services[1]))).status, 409);
        now = new Date('2026-11-23T16:00:00Z');
        const second = await (await post(assign(services[1]))).json();
        assert.equal(second.taskIds.length, 1);
        fixture.orders.push({ ...services[1], order_id: 'new-valid-service', completed_on: '2026-11-24' });
        const refreshed = await read();
        assert.equal(refreshed.careReminders.find(row => row.member_id === b.member_id).status, 'superseded');
        assert.equal(refreshed.tasks.find(task => task.task_id === second.taskIds[0]).status, 'archived');
        assert.equal((await employeePost({ action: 'result', id: second.taskIds[0], outcome: '已沟通', note: '', message: '' })).status, 409);
        now = new Date('2026-12-14T16:00:00Z');
        assert.equal((await read()).careReminders.find(row => row.service_order_id === 'new-valid-service').status, 'pending');
        assert.equal((await rows()).length, 4);
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        if (pool) await pool.close();
        if (created) await master.request().query(`ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${database}]`);
        await master.close();
    }
});

test('SQL 账号、员工资料隔离、反馈并发与持久化', { timeout: 90000 }, async () => {
    const { connect } = require('./db');
    const { initialize } = require('../database/setup');
    const { createApp } = require('./main');
    const database = 'NailMate_Team_' + randomBytes(8).toString('hex');
    const master = await connect('master');
    let pool, server, created = false;
    try {
        await master.request().query(`CREATE DATABASE [${database}]`); created = true;
        pool = await connect(database);
        await initialize(pool);
        let now = new Date('2026-11-11T15:59:59Z');
        const teamNow = () => now;
        server = createApp(pool, { teamNow }).listen(0, '127.0.0.1');
        await new Promise(resolve => server.once('listening', resolve));
        const base = 'http://127.0.0.1:' + server.address().port;
        const postTo = (request, url = base) => body => request(url + '/api/team', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        assert.equal((await postTo(fetch)({ account: owner, action: 'bootstrap' })).status, 401);
        assert.equal((await fetch(base + '/team-data.json')).status, 404);
        assert.equal((await fetch(base + '/api/state')).status, 401);
        const guest = await (await fetch(base + '/api/team/auth/session')).json();
        assert.deepEqual(guest, { user: null, setupRequired: true });
        const ownerRequest = await authenticate(base, 'setup');
        const post = postTo(ownerRequest);
        let response = await post({ action: 'bootstrap' });
        assert.equal(response.status, 200);
        const initial = await response.json();
        assert.equal(initial.state.tasks.length, 0);
        assert.equal(initial.snapshot.members.length, 2800);
        const poll = { action: 'state', revision: initial.state.revision, calendarDate: initial.state.calendarDate };
        assert.equal(initial.state.calendarDate, '2026-11-11');
        assert.equal((await post(poll)).status, 204);
        now = new Date('2026-11-11T16:00:00Z');
        const midnight = await (await post({ ...poll, now: '2100-01-01' })).json();
        assert.equal(midnight.state.calendarDate, '2026-11-12');
        assert.ok(midnight.state.revision >= initial.state.revision);
        const engine = createTeamStore(snapshot);
        const tasks = assignment(engine);
        const employee = tasks[0].assignee;
        const credentials = { username: 'test-employee', password: 'employee-password-one' };
        assert.equal((await post({ action: 'employeeAccount', employee, ...credentials })).status, 200);
        const employeeRequest = await authenticate(base, 'login', credentials);
        const employeePost = postTo(employeeRequest);
        const employeeInitial = await (await employeePost({ action: 'bootstrap' })).json();
        assert.deepEqual(employeeInitial.snapshot.members, []);
        assert.equal((await employeeRequest(base + '/api/state')).status, 403);
        assert.equal((await employeePost({ account: owner, action: 'assign', tasks })).status, 403);
        assert.equal((await employeePost({ action: 'state', revision: employeeInitial.state.revision, calendarDate: employeeInitial.state.calendarDate })).status, 204);
        const concurrent = await Promise.all([post({ action: 'assign', tasks }), post({ action: 'assign', tasks })]);
        assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 409]);
        const result = await concurrent.find(r => r.status === 200).json();
        const updated = await (await employeePost({ action: 'state', revision: employeeInitial.state.revision, calendarDate: employeeInitial.state.calendarDate })).json();
        assert.deepEqual(updated.snapshot.members.map(member => member.member_id), [tasks[0].member_id]);
        assert.ok(updated.snapshot.orders.every(order => order.member_id === tasks[0].member_id));
        assert.equal(updated.snapshot.contact_logs, undefined);
        assert.equal(updated.state.accounts.length, 0);
        response = await employeePost({ action: 'result', id: result.taskIds[0], outcome: '已预约', note: '周六', message: '' });
        assert.equal(response.status, 200);
        const saved = (await response.json()).state.tasks;
        assert.deepEqual(teamChartStages(saved).map(([, count]) => count), [1, 1, 1, 1, 0]);
        const updates = await Promise.all([
            employeePost({ action: 'result', id: result.taskIds[0], outcome: '有意向', note: '时间另约', message: '', expectedRevision: 1 }),
            employeePost({ action: 'result', id: result.taskIds[0], outcome: '未回复', note: '另一窗口的旧修改', message: '', expectedRevision: 1 }),
        ]);
        assert.deepEqual(updates.map(item => item.status).sort(), [200, 409], '并发修改不得静默覆盖');
        const latest = (await updates.find(item => item.status === 200).json()).state.tasks[0];
        const noteA = { action: 'note', memberId: tasks[0].member_id, type: 'care', text: '员工 A 顾客备注' };
        assert.equal((await post(noteA)).status, 200);
        const staffNote = { action: 'employeeNote', taskId: latest.task_id, type: 'service', text: '员工记录的服务细节' };
        assert.equal((await post(staffNote)).status, 403);
        response = await employeePost({ ...staffNote, memberId: eligible[4].member_id, author_name: '伪造作者' });
        assert.equal(response.status, 200);
        const originalStaffNote = (await response.json()).state.notes.find(note => note.author_role === 'employee');
        assert.equal(originalStaffNote.member_id, tasks[0].member_id);
        assert.equal(originalStaffNote.author_name, employee);
        assert.equal(originalStaffNote.can_edit, true);
        assert.equal(originalStaffNote.author_account_id, undefined);
        assert.equal((await post({ ...noteA, noteId: originalStaffNote.note_id })).status, 403);
        assert.equal((await post({ action: 'note', memberId: noteA.memberId, noteId: originalStaffNote.note_id, pinned: true })).status, 200);
        const staffEdit = { ...staffNote, noteId: originalStaffNote.note_id, text: '更新的服务细节', expectedRevision: 0 };
        const edits = await Promise.all([employeePost(staffEdit), employeePost(staffEdit)]);
        assert.deepEqual(edits.map(item => item.status).sort(), [200, 409]);
        const savedStaffEdit = (await edits.find(item => item.ok).json()).state.noteEdits[originalStaffNote.note_id];
        assert.equal(savedStaffEdit.note_text, staffEdit.text);
        assert.equal(savedStaffEdit.is_pinned, true);
        response = await post({ action: 'photo', productId: 'P001', image: 'data:image/jpeg;base64,/9j/' + 'A'.repeat(20000) });
        assert.equal(response.status, 200, '不得被旧 16 KB 请求体限制拦截');
        const reset = { ...credentials, password: 'employee-password-two' };
        assert.equal((await post({ action: 'employeeAccount', employee, ...reset })).status, 200);
        assert.equal((await employeePost({ action: 'state' })).status, 401);
        const resetRequest = await authenticate(base, 'login', reset);
        assert.equal((await resetRequest(base + '/api/team/auth/logout', { method: 'POST' })).status, 204);
        assert.equal((await postTo(resetRequest)({ action: 'state' })).status, 401);
        await new Promise(resolve => server.close(resolve));
        server = createApp(pool, { teamNow }).listen(0, '127.0.0.1');
        await new Promise(resolve => server.once('listening', resolve));
        const restartedBase = 'http://127.0.0.1:' + server.address().port;
        const restartedRequest = await authenticate(restartedBase, 'login');
        response = await postTo(restartedRequest, restartedBase)({ action: 'state' });
        const restoredState = (await response.json()).state;
        const restored = restoredState.tasks[0];
        assert.equal(restored.result.note, latest.result.note, '重新建立应用后仍从 SQL 读取');
        assert.equal(restored.result_history.length, 2);
        assert.ok(restoredState.notes.some(note => note.member_id === noteA.memberId && note.note_text === noteA.text));
        assert.equal(restoredState.noteEdits[originalStaffNote.note_id].note_text, staffEdit.text);
        response = await restartedRequest(restartedBase + '/api/team', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
        assert.equal(response.status, 400);

        const restartedPost = postTo(restartedRequest, restartedBase);
        const outgoingRequest = await authenticate(restartedBase, 'login', reset);
        const outgoingPost = postTo(outgoingRequest, restartedBase);
        const replacement = engine.roster[1];
        const receiver = { username: 'handoff-worker', password: 'handoff-worker-password' };
        assert.equal((await restartedPost({ action: 'employeeAccount', employee: replacement, ...receiver })).status, 200);
        const replacementRequest = await authenticate(restartedBase, 'login', receiver);
        const replacementPost = postTo(replacementRequest, restartedBase);
        const onlyB = { ...assignment(engine, 5)[4], assignee: replacement };
        const noteB = { action: 'note', memberId: onlyB.member_id, type: 'care', text: '员工 B 顾客备注' };
        assert.equal((await restartedPost(noteB)).status, 200);
        const bTask = (await (await restartedPost({ action: 'assign', tasks: [onlyB] })).json()).taskIds[0];
        const scopeA = await (await outgoingPost({ action: 'bootstrap', member_id: onlyB.member_id })).json();
        const scopeB = await (await replacementPost({ action: 'bootstrap', member_id: tasks[0].member_id })).json();
        assert.deepEqual(scopeA.snapshot.members.map(member => member.member_id), [tasks[0].member_id]);
        assert.deepEqual(scopeB.snapshot.members.map(member => member.member_id), [onlyB.member_id]);
        assert.deepEqual(scopeA.state.notes.map(note => note.note_text), [noteA.text, staffNote.text]);
        assert.deepEqual(scopeB.state.notes.map(note => note.note_text), [noteB.text]);
        assert.equal((await outgoingPost({ ...staffEdit, expectedRevision: 1, text: '重设密码后继续编辑' })).status, 200);
        assert.equal((await replacementPost(staffNote)).status, 404);
        assert.equal((await outgoingPost({ action: 'result', id: bTask, outcome: '已沟通', note: '', message: '' })).status, 404);
        assert.equal((await replacementPost({ action: 'result', id: result.taskIds[0], outcome: '已沟通', note: '', message: '' })).status, 404);
        assert.equal((await replacementPost({ action: 'reassign', id: result.taskIds[0], assignee: replacement, previous: employee })).status, 403);
        assert.equal((await outgoingRequest(restartedBase + '/api/members/' + onlyB.member_id + '/details')).status, 403);
        assert.equal((await replacementRequest(restartedBase + '/api/members/' + tasks[0].member_id + '/details')).status, 403);
        const session = await (await replacementRequest(restartedBase + '/api/team/auth/session', { headers: { 'X-NailMate-User': 'test-owner' } })).json();
        assert.equal(session.user.username, receiver.username);
        const forged = await replacementRequest(restartedBase + '/api/team', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-NailMate-User': 'test-owner' },
            body: JSON.stringify({ action: 'bootstrap' }),
        });
        assert.equal(forged.status, 401);
        assert.equal((await replacementPost({ action: 'result', id: bTask, outcome: '已沟通', note: '', message: '' })).status, 200);
        const pending = await (await restartedPost({ action: 'assign', tasks: assignment(engine, 4).slice(1) })).json();
        assert.equal(pending.taskIds.length, 3);
        const [appointmentId, followUpId, assignedId] = pending.taskIds;
        assert.equal((await outgoingPost({ action: 'result', id: appointmentId, outcome: '已预约', note: '预约待完成', message: '' })).status, 200);
        assert.equal((await outgoingPost({ action: 'result', id: followUpId, outcome: '未回复', note: '跟进待完成', message: '', followUpOn: pending.state.calendarDate })).status, 200);
        const handoffNote = { ...staffNote, taskId: followUpId, text: '交接后保留的员工备注' };
        const staffHandoff = await (await outgoingPost(handoffNote)).json();
        const handedNote = staffHandoff.state.notes.find(note => note.note_text === handoffNote.text);
        assert.ok(handedNote);
        const deletion = { action: 'deleteEmployeeAccount', employee, username: credentials.username };
        assert.equal((await outgoingPost({ ...deletion, replacement })).status, 403);
        assert.equal((await restartedPost(deletion)).status, 409);
        assert.equal((await restartedPost({ ...deletion, replacement: engine.roster[2] })).status, 409, '尚未开通登录的员工不能接手');
        assert.equal((await outgoingPost({ action: 'state' })).status, 200, '交接失败不得删除账号');
        response = await restartedPost({ ...deletion, replacement });
        assert.equal(response.status, 200);
        const removed = await response.json();
        assert.deepEqual(removed.taskIds, [appointmentId, followUpId, assignedId]);
        assert.equal(removed.state.tasks.find(task => task.task_id === result.taskIds[0]).assignee, employee);
        assert.equal(removed.state.care_records.find(record => record.task_id === appointmentId).owner, employee);
        assert.equal(removed.state.accounts.some(account => account.employee === employee), false);
        const preferredMember = snapshot.members.find(member => member.preferred_technician === employee);
        const afterDeletion = await (await restartedPost({ action: 'bootstrap' })).json();
        assert.equal(afterDeletion.snapshot.members.find(member => member.member_id === preferredMember.member_id).preferred_technician, employee);
        assert.equal((await restartedPost({ action: 'employeeAccount', employee, ...reset })).status, 400, '历史偏好技师不能被当作现有员工账号');
        assert.equal((await outgoingPost({ action: 'state' })).status, 401, '删除账号使旧会话失效');
        const departedLogin = await fetch(restartedBase + '/api/team/auth/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reset),
        });
        assert.equal(departedLogin.status, 401);
        const handedOff = await (await replacementPost({ action: 'bootstrap' })).json();
        assert.deepEqual(handedOff.state.tasks.map(task => task.task_id), [bTask, ...pending.taskIds]);
        assert.equal(handedOff.state.tasks.find(task => task.task_id === appointmentId).result_history[0].recorded_by, employee);
        assert.equal(handedOff.state.tasks.find(task => task.task_id === followUpId).result.follow_up_on, pending.state.calendarDate);
        assert.ok(handedOff.state.notes.some(note => note.note_id === handedNote.note_id && note.author_name === employee && !note.can_edit));
        assert.equal((await replacementPost({ ...handoffNote, noteId: handedNote.note_id, expectedRevision: 0 })).status, 404);
        response = await restartedPost({ action: 'deleteEmployeeAccount', employee: replacement, username: receiver.username, replacement: '' });
        assert.equal(response.status, 200, '最后一位员工也可删除，未完成任务留待交接');
        const unassigned = await response.json();
        assert.equal(unassigned.state.tasks.filter(task => !task.assignee).length, 3);
        assert.equal((await postTo(replacementRequest, restartedBase)({ action: 'state' })).status, 401);
        assert.equal((await restartedPost({ action: 'employeeAccount', newEmployee: employee, ...reset })).status, 200);
        response = await restartedPost({ action: 'reassign', id: followUpId, previous: '', assignee: employee });
        assert.equal(response.status, 200, '重新开通后可接手已登记反馈的待交接任务');
        const resumed = (await response.json()).state.tasks.find(task => task.task_id === followUpId);
        assert.equal(resumed.assignee, employee);
        assert.equal(resumed.result.follow_up_on, pending.state.calendarDate);
        const reopened = postTo(await authenticate(restartedBase, 'login', reset), restartedBase);
        const freshScope = await (await reopened({ action: 'bootstrap' })).json();
        assert.deepEqual(freshScope.state.tasks.map(task => task.task_id), [followUpId]);
        assert.ok(!freshScope.snapshot.members.some(member => member.member_id === noteA.memberId));
        assert.equal((await reopened({ ...handoffNote, noteId: handedNote.note_id, expectedRevision: 0 })).status, 404);
        assert.equal((await reopened({ action: 'result', id: result.taskIds[0], outcome: '已沟通', note: '', message: '', expectedRevision: 2 })).status, 404);
        const audit = await (await restartedPost({ action: 'bootstrap' })).json();
        assert.ok(audit.state.notes.some(note => note.note_text === noteA.text));
        assert.equal(audit.state.tasks.find(task => task.task_id === result.taskIds[0]).result_history.length, 2);
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        if (pool) await pool.close();
        if (created) await master.request().query(`ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${database}]`);
        await master.close();
    }
});

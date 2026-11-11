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

test('护理回访按最近一次美甲后的第 21 个北京时间日推荐，已分派任务可随后登记', () => {
    const member = eligible[0];
    const earlier = { member_id: member.member_id, order_type: 'nail_service', order_date: '2026-10-21' };
    const recent = { ...earlier, order_date: '2026-10-22' };
    const fixture = {
        ...snapshot,
        orders: [recent, earlier, { ...recent, order_type: 'care_product', order_date: '2026-11-01' }],
        member_care_profiles: [{ member_id: member.member_id, care_followup_opt_in: true }],
    };
    let now = new Date('2026-11-11T15:59:00Z');
    const engine = createTeamStore(fixture, { now: () => now });
    const [input] = assignment(engine);
    input.objective = 'care';
    input.product_id = snapshot.products.find(product => product.is_active && product.product_type === 'care_service').product_id;
    const assign = () => engine.applyAction(owner, { action: 'assign', tasks: [input] });
    assert.throws(assign, /第 21 天/);

    now = new Date('2026-11-11T16:00:00Z');
    const { taskIds: [id] } = assign();
    now = new Date('2026-11-12T16:00:00Z');
    const employee = { role: 'employee', employee: input.assignee };
    const result = engine.applyAction(employee, { action: 'result', id, outcome: '已沟通', note: '', message: '' });
    assert.equal(result.state.tasks[0].status, 'recorded');
    const fresh = createTeamStore(fixture, { now: () => now });
    assert.throws(() => fresh.applyAction(owner, { action: 'assign', tasks: [input] }), /第 21 天/);
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
        assert.equal(midnight.state.revision, initial.state.revision);
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
        const restored = (await response.json()).state.tasks[0];
        assert.equal(restored.result.note, latest.result.note, '重新建立应用后仍从 SQL 读取');
        assert.equal(restored.result_history.length, 2);
        response = await restartedRequest(restartedBase + '/api/team', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
        assert.equal(response.status, 400);

        const restartedPost = postTo(restartedRequest, restartedBase);
        const outgoingRequest = await authenticate(restartedBase, 'login', reset);
        const outgoingPost = postTo(outgoingRequest, restartedBase);
        const replacement = engine.roster[1];
        const receiver = { username: 'handoff-worker', password: 'handoff-worker-password' };
        assert.equal((await restartedPost({ action: 'employeeAccount', employee: replacement, ...receiver })).status, 200);
        const pending = await (await restartedPost({ action: 'assign', tasks: assignment(engine, 4).slice(1) })).json();
        assert.equal(pending.taskIds.length, 3);
        const [appointmentId, followUpId, assignedId] = pending.taskIds;
        assert.equal((await outgoingPost({ action: 'result', id: appointmentId, outcome: '已预约', note: '预约待完成', message: '' })).status, 200);
        assert.equal((await outgoingPost({ action: 'result', id: followUpId, outcome: '未回复', note: '跟进待完成', message: '', followUpOn: pending.state.calendarDate })).status, 200);
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
        const replacementRequest = await authenticate(restartedBase, 'login', receiver);
        const handedOff = await (await postTo(replacementRequest, restartedBase)({ action: 'bootstrap' })).json();
        assert.deepEqual(handedOff.state.tasks.map(task => task.task_id), pending.taskIds);
        assert.equal(handedOff.state.tasks[0].result_history[0].recorded_by, employee);
        assert.equal(handedOff.state.tasks[1].result.follow_up_on, pending.state.calendarDate);
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
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        if (pool) await pool.close();
        if (created) await master.request().query(`ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${database}]`);
        await master.close();
    }
});

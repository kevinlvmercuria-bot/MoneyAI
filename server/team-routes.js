'use strict';

const { readFileSync } = require('node:fs');
const path = require('node:path');
const { transaction } = require('./db');
const { createTeamStore } = require('../public/team-store');
const { saveCredentials } = require('./team-auth');
const { loadTeamState, persistTeamState, enabledEmployees, deleteEmployeeCredential } = require('./team-repository');
const defaultSnapshot = JSON.parse(readFileSync(path.join(__dirname, '../data/team-data.json'), 'utf8'));

function scopedSnapshot(account, tasks, snapshot) {
    if (account.role === 'owner') return snapshot;
    const allowed = new Set(tasks.map(task => task.member_id));
    const data = { as_of_date: snapshot.as_of_date, snapshot_id: snapshot.snapshot_id, data_type: snapshot.data_type, products: snapshot.products };
    for (const key of ['members', 'orders', 'appointments', 'member_notes', 'member_care_profiles']) {
        data[key] = snapshot[key].filter(row => allowed.has(row.member_id));
    }
    return data;
}

async function visibleResponse(tx, account, state, snapshot, includeSnapshot) {
    if (account.role === 'owner') {
        const enabled = await enabledEmployees(tx);
        state.accounts = state.accounts.map(row => ({ ...row, loginEnabled: enabled.has(row.employee) }));
    }
    return { state, ...(includeSnapshot && { snapshot: scopedSnapshot(account, state.tasks, snapshot) }) };
}

function registerTeamRoutes(app, pool, auth, { now, snapshot = defaultSnapshot } = {}) {
    // Register before the legacy 16 KB JSON parser: a compressed photo may be 1.4 MB.
    app.post('/api/team', require('express').json({ limit: '2mb' }), async (req, res, next) => {
        try {
            const { action, ...payload } = req.body || {};
            const readOnly = action === 'state' || action === 'bootstrap';
            const response = await transaction(pool, async tx => {
                const account = await auth.requireAccount(req, tx);
                const { initialState, reminders } = await loadTeamState(tx);
                const requestTime = now?.() ?? new Date();
                const engine = createTeamStore(snapshot, {
                    initialState,
                    careReminders: reminders,
                    now: () => requestTime,
                });
                if (account.role === 'employee' && !engine.listAccounts().some(item => item.employee === account.employee))
                    throw Object.assign(new Error('员工账号不存在，请重新选择身份。'), { apiStatus: 403 });
                if (readOnly) {
                    // Reads also catch up overdue orders after downtime. The
                    // SQL transaction lock serializes this with assignment.
                    if (engine.refreshCareReminders()) await persistTeamState(tx, engine, reminders);
                    const state = engine.scopedState(account);
                    if (action === 'state' && payload.revision === state.revision && payload.calendarDate === state.calendarDate
                        && (payload.catalogRevision ?? 0) === state.catalogRevision)
                        return null;
                    return visibleResponse(tx, account, state, engine.workspaceSnapshot(),
                        action === 'bootstrap' || account.role === 'employee' || payload.catalogRevision !== state.catalogRevision);
                }
                if (['reassign', 'withdraw', 'deleteEmployeeAccount'].includes(action)) {
                    const pending = await tx.query(`SELECT 1 FROM wecomdeliveries WHERE status IN ('prepared','creating','pending','unknown')
                        AND (($1::text IS NOT NULL AND task_id=$1) OR ($2::text IS NOT NULL AND employee=$2)) LIMIT 1`,
                    [action === 'deleteEmployeeAccount' ? null : payload.id, action === 'deleteEmployeeAccount' ? payload.employee : null]);
                    if (pending.rowCount) throw Object.assign(new Error('存在尚未完成的企微发送任务，请先核对发送记录后再撤回、改派或删除账号。'), { apiStatus: 409 });
                }
                const result = engine.applyAction(account, { ...payload, action });
                if (action === 'assign' || action === 'reassign') {
                    const targets = action === 'assign' ? payload.tasks.map(task => task.assignee) : [payload.assignee];
                    const enabled = await enabledEmployees(tx);
                    if (targets.some(employee => !enabled.has(employee)))
                        throw Object.assign(new Error('请先为负责员工设置登录密码，再分派任务。'), { apiStatus: 409 });
                }
                if (action === 'employeeAccount') {
                    const employee = payload.employee || payload.newEmployee.trim();
                    await saveCredentials(tx, employee, payload);
                    await tx.query('UPDATE kfconversations SET employee_username=$2 WHERE employee=$1', [employee, payload.username.trim().toLowerCase()]);
                }
                if (action === 'deleteEmployeeAccount') {
                    if (result.taskIds.length && payload.replacement && !(await enabledEmployees(tx)).has(payload.replacement))
                        throw Object.assign(new Error('接手员工的登录账号已变更，请重新选择。'), { apiStatus: 409 });
                    if (!(await deleteEmployeeCredential(tx, payload.employee, payload.username)))
                        throw Object.assign(new Error('该员工的登录账号已变更，请刷新后重试。'), { apiStatus: 409 });
                    await tx.query('DELETE FROM wecomemployees WHERE employee=$1', [payload.employee]);
                    await tx.query('UPDATE kfconversations SET employee=NULL,employee_username=NULL WHERE employee=$1', [payload.employee]);
                }
                await persistTeamState(tx, engine, reminders);
                return {
                    ...(await visibleResponse(tx, account, result.state, engine.workspaceSnapshot(),
                        account.role === 'employee' || payload.catalogRevision !== result.state.catalogRevision)),
                    taskIds: result.taskIds,
                    ...(result.memberId && { memberId: result.memberId }),
                };
            });
            if (!response) return res.status(204).end();
            res.set('Cache-Control', 'no-store').json(response);
        } catch (error) {
            if (error.status) error.apiStatus = error.status;
            next(error);
        }
    });
}

module.exports = { registerTeamRoutes };

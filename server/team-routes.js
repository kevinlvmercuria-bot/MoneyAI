'use strict';

const { readFileSync } = require('node:fs');
const path = require('node:path');
const { sql, transaction } = require('./db');
const { createTeamStore } = require('../public/team-store');
const { saveCredentials } = require('./team-auth');
const snapshot = JSON.parse(readFileSync(path.join(__dirname, '../data/team-data.json'), 'utf8'));

function scopedSnapshot(account, tasks) {
    if (account.role === 'owner') return snapshot;
    const allowed = new Set(tasks.map(task => task.member_id));
    const data = { as_of_date: snapshot.as_of_date, snapshot_id: snapshot.snapshot_id, products: snapshot.products };
    for (const key of ['members', 'orders', 'appointments', 'member_notes', 'member_care_profiles']) {
        data[key] = snapshot[key].filter(row => allowed.has(row.member_id));
    }
    return data;
}

async function visibleResponse(tx, account, state, includeSnapshot) {
    if (account.role === 'owner') {
        const enabled = await enabledEmployees(tx);
        state.accounts = state.accounts.map(row => ({ ...row, loginEnabled: enabled.has(row.employee) }));
    }
    return { state, ...(includeSnapshot && { snapshot: scopedSnapshot(account, state.tasks) }) };
}

async function enabledEmployees(tx) {
    const { recordset } = await tx.request().query("SELECT employee FROM dbo.TeamCredentials WHERE employee<>N'';");
    return new Set(recordset.map(row => row.employee));
}

function registerTeamRoutes(app, pool, auth, { now } = {}) {
    // Register before the legacy 16 KB JSON parser: a compressed photo may be 1.4 MB.
    app.post('/api/team', require('express').json({ limit: '2mb' }), async (req, res, next) => {
        try {
            const { action, ...payload } = req.body || {};
            const readOnly = action === 'state' || action === 'bootstrap';
            const response = await transaction(pool, async tx => {
                const account = await auth.requireAccount(req, tx);
                const row = await tx.request().query('SELECT payload FROM dbo.TeamDemoState WHERE id=1');
                const requestTime = now?.() ?? new Date();
                const engine = createTeamStore(snapshot, {
                    initialState: row.recordset[0] ? JSON.parse(row.recordset[0].payload) : null,
                    now: () => requestTime,
                });
                if (account.role === 'employee' && !engine.listAccounts().some(item => item.employee === account.employee))
                    throw Object.assign(new Error('员工账号不存在，请重新选择身份。'), { apiStatus: 403 });
                if (readOnly) {
                    const state = engine.scopedState(account);
                    if (action === 'state' && payload.revision === state.revision && payload.calendarDate === state.calendarDate)
                        return null;
                    return visibleResponse(tx, account, state, action === 'bootstrap' || account.role === 'employee');
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
                }
                if (action === 'deleteEmployeeAccount') {
                    if (result.taskIds.length && payload.replacement && !(await enabledEmployees(tx)).has(payload.replacement))
                        throw Object.assign(new Error('接手员工的登录账号已变更，请重新选择。'), { apiStatus: 409 });
                    const deleted = await tx.request().input('employee', sql.NVarChar(30), payload.employee)
                        .input('username', sql.VarChar(32), payload.username).query(`
                            DELETE FROM dbo.TeamCredentials WHERE employee=@employee AND employee<>N'' AND username=@username;
                        `);
                    if (deleted.rowsAffected[0] !== 1)
                        throw Object.assign(new Error('该员工的登录账号已变更，请刷新后重试。'), { apiStatus: 409 });
                }
                await tx.request().input('payload', sql.NVarChar(sql.MAX), JSON.stringify(engine.exportState())).query(`
                    IF EXISTS(SELECT 1 FROM dbo.TeamDemoState WHERE id=1)
                        UPDATE dbo.TeamDemoState SET payload=@payload, updated_at=SYSUTCDATETIME() WHERE id=1;
                    ELSE INSERT dbo.TeamDemoState(id,payload) VALUES(1,@payload);
                `);
                return { ...(await visibleResponse(tx, account, result.state, account.role === 'employee')), taskIds: result.taskIds };
            }, readOnly ? 'Shared' : 'Exclusive');
            if (!response) return res.status(204).end();
            res.set('Cache-Control', 'no-store').json(response);
        } catch (error) {
            if (error.status) error.apiStatus = error.status;
            next(error);
        }
    });
}

module.exports = { registerTeamRoutes };

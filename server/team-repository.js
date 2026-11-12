'use strict';

const { loadTeamCareReminders, saveTeamCareReminders } = require('./team-reminders');

async function loadTeamState(tx) {
    const row = await tx.query('SELECT payload FROM TeamDemoState WHERE id=1');
    return { initialState: row.rows[0] ? JSON.parse(row.rows[0].payload) : null,
        reminders: await loadTeamCareReminders(tx) };
}

async function enabledEmployees(tx) {
    const { rows } = await tx.query("SELECT employee FROM TeamCredentials WHERE employee<>'';");
    return new Set(rows.map(row => row.employee));
}

async function persistTeamState(tx, engine, previousReminders) {
    const { careReminders, ...state } = engine.exportState();
    await saveTeamCareReminders(tx, previousReminders, careReminders);
    await tx.query(`
        INSERT INTO TeamDemoState(id,payload) VALUES(1,$1)
        ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=CURRENT_TIMESTAMP;
    `, [JSON.stringify(state)]);
}

async function deleteEmployeeCredential(tx, employee, username) {
    const deleted = await tx.query(`
            DELETE FROM TeamCredentials WHERE employee=$1 AND employee<>'' AND username=$2;
        `, [employee, username]);
    return deleted.rowCount === 1;
}

module.exports = { loadTeamState, persistTeamState, enabledEmployees, deleteEmployeeCredential };

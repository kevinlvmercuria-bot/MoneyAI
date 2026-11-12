'use strict';
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { teamCareReminderKey } = require('../public/team-store');
function initializeTeamCareReminders(tx) {
    return tx.query(
        readFileSync(
            path.join(__dirname, '../database/team-care-reminders.sql'),
            'utf8',
        ),
    );
}
async function loadTeamCareReminders(tx) {
    const { rows } = await tx.query(
        'SELECT * FROM TeamCareReminders ORDER BY member_id,service_order_id',
    );
    return rows.map((row) => ({
        ...row,
        created_at: row.created_at.toISOString(),
        updated_at: row.updated_at.toISOString(),
    }));
}
async function saveTeamCareReminders(tx, previous, next) {
    const before = new Map(
        previous.map((row) => [teamCareReminderKey(row), JSON.stringify(row)]),
    );
    const changed = next.filter(
        (row) => before.get(teamCareReminderKey(row)) !== JSON.stringify(row),
    );
    if (!changed.length) return;
    await tx.query(
        `INSERT INTO TeamCareReminders
        SELECT member_id,service_order_id,completed_on,due_on,status,task_id,data_type,created_at,updated_at
        FROM jsonb_to_recordset($1::jsonb) AS r(member_id text,service_order_id text,completed_on date,due_on date,
            status text,task_id text,data_type text,created_at timestamptz,updated_at timestamptz)
        ON CONFLICT(member_id,service_order_id) DO UPDATE SET completed_on=excluded.completed_on,due_on=excluded.due_on,
            status=excluded.status,task_id=excluded.task_id,updated_at=excluded.updated_at`,
        [JSON.stringify(changed)],
    );
}
module.exports = {
    initializeTeamCareReminders,
    loadTeamCareReminders,
    saveTeamCareReminders,
};

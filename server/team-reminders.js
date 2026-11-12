'use strict';

const { readFileSync } = require('node:fs');
const path = require('node:path');
const { sql } = require('./db');
const { teamCareReminderKey } = require('../public/team-store');

const migration = readFileSync(path.join(__dirname, '../database/team-care-reminders.sql'), 'utf8');

function initializeTeamCareReminders(tx) {
    return tx.request().batch(migration);
}

async function loadTeamCareReminders(tx) {
    const { recordset } = await tx.request().query(`
        SELECT member_id, service_order_id, CONVERT(char(10), completed_on, 23) AS completed_on,
            CONVERT(char(10), due_on, 23) AS due_on, status, task_id, data_type,
            REPLACE(CONVERT(varchar(23), created_at, 121), ' ', 'T') + 'Z' AS created_at,
            REPLACE(CONVERT(varchar(23), updated_at, 121), ' ', 'T') + 'Z' AS updated_at
        FROM dbo.TeamCareReminders ORDER BY member_id, service_order_id;
    `);
    return recordset;
}

async function saveTeamCareReminders(tx, previous, next) {
    const before = new Map(previous.map(row => [teamCareReminderKey(row), JSON.stringify(row)]));
    const changed = next.filter(row => before.get(teamCareReminderKey(row)) !== JSON.stringify(row));
    if (!changed.length) return;
    await tx.request().input('changes', sql.NVarChar(sql.MAX), JSON.stringify(changed)).query(`
        DECLARE @rows TABLE (
            member_id nvarchar(64) COLLATE Latin1_General_100_BIN2, service_order_id nvarchar(128) COLLATE Latin1_General_100_BIN2,
            completed_on date, due_on date, status varchar(16), task_id varchar(32),
            data_type varchar(16), created_at datetime2(3), updated_at datetime2(3)
        );
        INSERT @rows
        SELECT member_id, service_order_id, completed_on, due_on, status, task_id, data_type,
            CAST(created_at AS datetime2(3)), CAST(updated_at AS datetime2(3))
        FROM OPENJSON(@changes) WITH (
            member_id nvarchar(64), service_order_id nvarchar(128), completed_on date, due_on date,
            status varchar(16), task_id varchar(32), data_type varchar(16),
            created_at datetimeoffset(3), updated_at datetimeoffset(3)
        );

        UPDATE target SET completed_on=source.completed_on, due_on=source.due_on,
            status=source.status, task_id=source.task_id, updated_at=source.updated_at
        FROM dbo.TeamCareReminders AS target JOIN @rows AS source
            ON target.member_id=source.member_id AND target.service_order_id=source.service_order_id;

        INSERT dbo.TeamCareReminders (member_id, service_order_id, completed_on, due_on, status, task_id, data_type, created_at, updated_at)
        SELECT member_id, service_order_id, completed_on, due_on, status, task_id, data_type, created_at, updated_at
        FROM @rows AS source
        WHERE NOT EXISTS (
            SELECT 1 FROM dbo.TeamCareReminders AS target
            WHERE target.member_id=source.member_id AND target.service_order_id=source.service_order_id
        );
    `);
}

module.exports = { initializeTeamCareReminders, loadTeamCareReminders, saveTeamCareReminders };

'use strict';

const { readFileSync } = require('node:fs');
const path = require('node:path');

async function migrateTeam(tx) {
    await tx.query(readFileSync(path.join(__dirname, 'team-state.sql'), 'utf8'));
    await require('../server/team-auth').initializeTeamAuth(tx);
    await require('../server/team-reminders').initializeTeamCareReminders(tx);
    await tx.query(readFileSync(path.join(__dirname, 'wecom.sql'), 'utf8'));
    await tx.query(readFileSync(path.join(__dirname, 'kf.sql'), 'utf8'));
    await tx.query(readFileSync(path.join(__dirname, 'integration-admin.sql'), 'utf8'));
}

async function migrate(tx) {
    await tx.query(readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    await migrateTeam(tx);
}

module.exports = { migrate, migrateTeam };

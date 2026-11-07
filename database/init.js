'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const sql = require('mssql');
const { getDbConfig } = require('../server/config');
const { members } = require('./demo-data');

async function initialize() {
    const database = process.env.DB_NAME || 'NailMate';
    if (!/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(database)) throw new Error('DB_NAME must contain letters, digits or underscores and start with a letter');
    let master;
    let pool;
    let transaction;
    let began = false;
    try {
        master = await new sql.ConnectionPool(getDbConfig('master')).connect();
        await master.request().input('database', sql.NVarChar(128), database)
            .query(`IF DB_ID(@database) IS NULL EXEC(N'CREATE DATABASE [${database}]')`);
        await master.close();
        pool = await new sql.ConnectionPool(getDbConfig(database)).connect();
        transaction = new sql.Transaction(pool);
        await transaction.begin();
        began = true;
        await new sql.Request(transaction).batch(await fs.readFile(path.join(__dirname, '001-schema.sql'), 'utf8'));
        // Insert missing demo records only; reruns never overwrite a teammate's edited data.
        await new sql.Request(transaction).input('members', sql.NVarChar(sql.MAX), JSON.stringify(members)).query(`
            INSERT INTO dbo.wg_member (member_id, days_since_visit, cycle_days, visits, total_spend,
                balance, style, secondary_style, contact_days, consent, complaint, appointment,
                ratio, lifecycle, last_visit, member_level)
            SELECT j.id, j.days, j.cycle, j.visits, j.spend, j.bal, j.style, j.secondary,
                j.contactDays, j.consent, j.complaint, j.appointment, j.ratio, j.lifecycle, j.lastVisit, j.level
            FROM OPENJSON(@members) WITH (
                id varchar(5), days int, cycle int, visits int, spend decimal(12,2), bal decimal(12,2),
                style nvarchar(40), secondary nvarchar(40), contactDays int, consent bit,
                complaint bit, appointment bit, ratio decimal(8,2), lifecycle varchar(20),
                lastVisit date, level nvarchar(40)
            ) j
            WHERE NOT EXISTS (SELECT 1 FROM dbo.wg_member m WHERE m.member_id = j.id);
        `);
        await transaction.commit();
        began = false;
        console.log(`Initialized ${database}.dbo.wg_member; ${members.length} demo members available (existing rows preserved).`);
    } finally {
        if (began) await transaction.rollback().catch(() => {});
        if (pool) await pool.close();
        if (master) await master.close();
    }
}
initialize().catch((error) => {
    console.error('Database initialization failed:', error.code || error.name,
        'Check SQL Server TCP/IP, credentials, CREATE DATABASE permission and compatibility level >= 130.');
    process.exitCode = 1;
});

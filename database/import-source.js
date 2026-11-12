'use strict';

const { readFileSync } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { connect, transaction } = require('../server/db');
const { DEMO_DATE } = require('../public/rules');

const SOURCE_PATH = path.join(__dirname, '..', 'data', 'nailmate.db');
const TABLES = ['members', 'orders', 'products', 'appointments', 'contact_logs', 'member_notes',
    'member_care_profiles', 'campaigns', 'campaign_tasks', 'execution_logs'];

function readSource(file = SOURCE_PATH) {
    const sourceHash = createHash('sha256').update(readFileSync(file)).digest('hex');
    const db = new DatabaseSync(file, { readOnly: true });
    try {
        if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) {
            throw new Error('来源数据库完整性检查未通过');
        }
        const rows = {};
        const sourceRecords = [];
        for (const table of TABLES) {
            rows[table] = db.prepare(`SELECT * FROM ${table}`).all();
            const key = db.prepare(`PRAGMA table_info(${table})`).all().find((column) => column.pk === 1).name;
            for (const row of rows[table]) {
                if (row.data_type !== 'simulation') throw new Error('仅允许导入 simulation 演示数据');
                sourceRecords.push([table, row[key], row.member_id || null, JSON.stringify(row)]);
            }
        }
        if (!rows.members.length || !rows.products.length || rows.campaigns.some((campaign) => campaign.as_of_date !== DEMO_DATE)) {
            throw new Error('来源数据为空或演示基准日不匹配');
        }
        return { sourceHash, rows, sourceRecords };
    } finally {
        db.close();
    }
}

function mapMembers(rows) {
    const contacts = new Map();
    for (const contact of rows.contact_logs) {
        if (contact.contact_date <= DEMO_DATE && contact.contact_date > (contacts.get(contact.member_id) || '')) {
            contacts.set(contact.member_id, contact.contact_date);
        }
    }
    const upcoming = new Set(rows.appointments.filter((item) => item.status === 'scheduled' && item.appointment_date >= DEMO_DATE).map((item) => item.member_id));
    return rows.members.map((row) => {
        const styles = row.preferred_styles.split('|').filter(Boolean);
        const lastContact = [row.last_contact_date, contacts.get(row.member_id)].filter(Boolean).sort().at(-1);
        return {
            id: row.member_id, displayName: row.display_name,
            days: row.days_since_last_visit, cycle: row.average_cycle_days, visits: row.visit_count,
            spend: row.total_spending, bal: row.stored_balance, style: styles[0] || '', secondary: styles[1] || '',
            contactDays: lastContact ? Math.max(0, Math.floor((Date.parse(DEMO_DATE) - Date.parse(lastContact)) / 86400000)) : 10000,
            consent: Boolean(row.marketing_consent), complaint: Boolean(row.unresolved_complaint),
            appointment: Boolean(row.has_upcoming_appointment) || upcoming.has(row.member_id),
            ratio: row.overdue_ratio, lifecycle: row.lifecycle, lastVisit: row.last_visit,
            level: row.membership_level, latestNote: row.latest_note, preferredTechnician: row.preferred_technician,
            cycleConfidence: row.cycle_confidence, source: 'sqlite_import', personality: row.personality || '',
        };
    });
}

function mapProducts(rows) {
    return rows.products.map((row) => ({
        id: row.product_id, name: row.product_name, style: row.style, price: row.price,
        type: row.product_type, isNew: Boolean(row.is_new), isActive: Boolean(row.is_active),
        launchDate: row.launch_date, description: row.description,
        imageStatus: row.image_status, imageAlt: row.image_alt,
    }));
}

async function importSource(pool, file = SOURCE_PATH) {
    const source = readSource(file);
    const counts = Object.fromEntries(TABLES.map((table) => [table, source.rows[table].length]));
    return transaction(pool, async (tx) => {
        const previous = await tx.query('SELECT source_hash FROM ImportRuns WHERE source_hash = $1', [source.sourceHash]);
        if (previous.rows.length) return { imported: false, counts, sourceHash: source.sourceHash };


        await tx.query('INSERT INTO MemberProfileBackups(source_hash,member_id,profile) SELECT $1,id,profile FROM Members',[source.sourceHash]);
        await tx.query(`INSERT INTO Members SELECT id,profile FROM jsonb_to_recordset($1::jsonb) AS r(id text,profile jsonb)
            ON CONFLICT(id) DO UPDATE SET profile=excluded.profile`,[JSON.stringify(mapMembers(source.rows).map(m=>({id:m.id,profile:m})))]);
        await tx.query('DELETE FROM MemberImportStage; DELETE FROM Products; DELETE FROM SourceRecords');
        await tx.query('INSERT INTO Products SELECT id,profile FROM jsonb_to_recordset($1::jsonb) AS r(id text,profile jsonb)',
            [JSON.stringify(mapProducts(source.rows).map(p=>({id:p.id,profile:p})))]);
        await tx.query(`INSERT INTO SourceRecords SELECT source_table,source_id,member_id,payload
            FROM jsonb_to_recordset($1::jsonb) AS r(source_table text,source_id text,member_id text,payload jsonb)`,
            [JSON.stringify(source.sourceRecords.map(([source_table,source_id,member_id,payload])=>({source_table,source_id:String(source_id),member_id,payload:JSON.parse(payload)})))]);
        await tx.query('INSERT INTO ImportRuns(source_hash,counts_json) VALUES($1,$2)',[source.sourceHash,JSON.stringify(counts)]);
        return { imported: true, counts, sourceHash: source.sourceHash };
    });
}

async function run() {
    const pool = await connect();
    try {
        await require('./setup').initialize(pool);
        console.log(await importSource(pool));
    } finally {
        await pool.end();
    }
}
if (require.main === module) run().catch((error) => { console.error('来源数据导入失败：', error.message); process.exitCode = 1; });

module.exports = { importSource, readSource, mapMembers, mapProducts };

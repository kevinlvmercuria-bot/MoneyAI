'use strict';
const sql = require('mssql');
const { getDbConfig } = require('./config');
const { members } = require('../database/demo-data');

function createMemberRepository(mode) {
    if (!['mock', 'mssql'].includes(mode)) throw new Error('DB_MODE must be mock or mssql');
    let poolPromise;
    async function pool() {
        if (!poolPromise) {
            const connection = new sql.ConnectionPool(getDbConfig());
            poolPromise = connection.connect().catch((error) => {
                poolPromise = undefined;
                throw error;
            });
        }
        return poolPromise;
    }
    const columns = `member_id AS id, days_since_visit AS days, cycle_days AS cycle,
        visits, total_spend AS spend, balance AS bal, style, secondary_style AS secondary,
        contact_days AS contactDays, consent, complaint, appointment, ratio, lifecycle,
        CONVERT(char(10), last_visit, 23) AS lastVisit, member_level AS level`;
    return {
        async list() {
            if (mode === 'mock') return structuredClone(members);
            return (await (await pool()).request().query(
                `SELECT ${columns} FROM dbo.wg_member WHERE deleted_at IS NULL ORDER BY member_id`,
            )).recordset;
        },
        async find(id) {
            if (mode === 'mock') return structuredClone(members.find((member) => member.id === id) || null);
            const result = await (await pool()).request().input('id', sql.VarChar(5), id).query(
                `SELECT ${columns} FROM dbo.wg_member WHERE member_id = @id AND deleted_at IS NULL`,
            );
            return result.recordset[0] || null;
        },
        async close() {
            if (poolPromise) await (await poolPromise).close();
        },
    };
}
module.exports = { createMemberRepository };

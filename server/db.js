'use strict';
const path = require('node:path');
const { existsSync } = require('node:fs');
const { Pool, types } = require('pg');
const envPath = path.join(__dirname, '..', '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);
// Keep the existing repository JSON decoding and date-only API independent of TZ.
types.setTypeParser(114, (value) => value);
types.setTypeParser(3802, (value) => value);
types.setTypeParser(1082, (value) => value);
async function connect(database) {
    if (!process.env.DATABASE_URL)
        throw new Error(
            '请配置 PostgreSQL DATABASE_URL；不会自动连接旧 SQL Server。',
        );
    const url = new URL(process.env.DATABASE_URL);
    if (database) url.pathname = '/' + database;
    const pool = new Pool({
        connectionString: url.toString(),
        max: 10,
        connectionTimeoutMillis: 10000,
    });
    try {
        await pool.query('SELECT 1');
        return pool;
    } catch (error) {
        await pool.end();
        throw error;
    }
}
async function transaction(pool, work, lockMode = 'Exclusive') {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout = '5s'");
        const lock =
            lockMode === 'Shared'
                ? 'pg_advisory_xact_lock_shared'
                : 'pg_advisory_xact_lock';
        await client.query(`SELECT ${lock}(73170421)`);
        const result = await work(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}
module.exports = { connect, transaction };

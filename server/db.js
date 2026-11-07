'use strict';

const path = require('node:path');
const { existsSync } = require('node:fs');

const envPath = path.join(__dirname, '..', '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

const windowsAuth = process.env.DB_AUTH === 'windows';
const sql = windowsAuth ? require('mssql/msnodesqlv8') : require('mssql');
const instance = process.env.DB_INSTANCE;

const config = {
    server: process.env.DB_SERVER || process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'NailMate',
    options: {
        encrypt: process.env.DB_ENCRYPT !== 'false',
        trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
    },
};

if (windowsAuth) {
    config.driver = process.env.DB_ODBC_DRIVER || 'ODBC Driver 18 for SQL Server';
    config.options.trustedConnection = true;
    if (instance) config.server += '\\' + instance;
} else {
    config.user = process.env.DB_USER;
    config.password = process.env.DB_PASSWORD;
    if (instance) config.options.instanceName = instance;
}
if (!instance && process.env.DB_PORT) config.port = Number(process.env.DB_PORT);

function connect(database = config.database) {
    return new sql.ConnectionPool({ ...config, database }).connect();
}

async function transaction(pool, work, lockMode = 'Exclusive') {
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
        // 同一演示数据库内，候选复核、写入和返回快照放在同一个事务。
        const lock = await tx.request().input('mode', sql.VarChar(32), lockMode).query(`
            DECLARE @result int;
            EXEC @result = sp_getapplock @Resource = 'NailMateDemo', @LockMode = @mode, @LockTimeout = 5000;
            SELECT @result AS result;
        `);
        if (lock.recordset[0].result < 0) throw new Error('演示数据库繁忙，请重试');
        const result = await work(tx);
        await tx.commit();
        return result;
    } catch (error) {
        await tx.rollback().catch(() => {});
        throw error;
    }
}

module.exports = { sql, connect, transaction };

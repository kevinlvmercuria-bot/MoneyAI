'use strict';
// Used only by the one-time migration tool. Application runtime uses pg.
const path = require('node:path');
const { existsSync } = require('node:fs');
const file = path.join(__dirname, '../.env');
if (existsSync(file)) process.loadEnvFile(file);
async function connectSource() {
    const value = (key) =>
        process.env['SQLSERVER_' + key] ?? process.env['DB_' + key];
    const windows = value('AUTH') === 'windows';
    const sql = windows ? require('mssql/msnodesqlv8') : require('mssql');
    let server = value('SERVER') || value('HOST') || 'localhost';
    if (value('INSTANCE')) server += '\\' + value('INSTANCE');
    const config = {
        server,
        database: value('NAME') || 'NailMate',
        options: {
            encrypt: value('ENCRYPT') !== 'false',
            trustServerCertificate:
                value('TRUST_SERVER_CERTIFICATE') === 'true',
            useUTC: true,
            ...(windows && { trustedConnection: true }),
        },
        ...(windows
            ? {
                  driver:
                      value('ODBC_DRIVER') || 'ODBC Driver 18 for SQL Server',
              }
            : { user: value('USER'), password: value('PASSWORD') }),
        ...(!value('INSTANCE') &&
            value('PORT') && { port: Number(value('PORT')) }),
    };
    return {
        sql,
        pool: await new sql.ConnectionPool(config).connect(),
        database: config.database,
    };
}
module.exports = { connectSource };

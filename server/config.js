'use strict';
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

function getDbConfig(database = process.env.DB_NAME || 'NailMate') {
    return {
        server: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT || 1433),
        database,
        user: process.env.DB_USER || 'sa',
        password: process.env.DB_PASSWORD || '',
        connectionTimeout: Number(process.env.DB_CONNECTION_TIMEOUT || 5000),
        options: {
            encrypt: process.env.DB_ENCRYPT !== 'false',
            trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
        },
        pool: { min: 0, max: 5, idleTimeoutMillis: 30000 },
    };
}
module.exports = { getDbConfig };

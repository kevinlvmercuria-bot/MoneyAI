'use strict';

const { connect, transaction } = require('../server/db');
const { migrate } = require('./setup');

async function run() {
    const pool = await connect();
    try {
        console.log(`升级数据库结构：${pool.config.server}/${pool.config.database}`);
        await transaction(pool, migrate);
        console.log('结构升级完成；未导入来源资料，未清空业务记录。');
    } finally {
        await pool.close();
    }
}

if (require.main === module) run().catch(error => {
    console.error('结构升级失败：', error.message);
    process.exitCode = 1;
});

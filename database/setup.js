'use strict';

const { readFileSync } = require('node:fs');
const path = require('node:path');
const { sql, connect, transaction } = require('../server/db');
const { seedTask } = require('../server/store');
const { members, demoMember } = require('./demo-data');

async function initialize(pool) {
    await transaction(pool, async (tx) => {
        await tx.request().batch(readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
        const { recordset } = await tx.request().query('SELECT COUNT(*) AS total FROM dbo.Members');
        if (recordset[0].total) {
            console.log('演示会员已存在，跳过初始化数据。');
            return;
        }
        const table = new sql.Table('dbo.Members');
        table.columns.add('id', sql.VarChar(5), { nullable: false });
        table.columns.add('profile', sql.NVarChar(sql.MAX), { nullable: false });
        for (const member of members) table.rows.add(member.id, JSON.stringify(member));
        await tx.request().bulk(table);
        await seedTask(tx, demoMember);
        console.log(`已初始化 ${members.length} 位虚拟会员和 1 条待审核任务。`);
    });
}

async function setup() {
    const pool = await connect();
    try {
        await initialize(pool);
        const result = await require('./import-source').importSource(pool);
        console.log(result.imported ? '来源数据库已导入。' : '来源数据库未变化，跳过导入。');
    } finally {
        await pool.close();
    }
}

if (require.main === module) {
    setup().catch((error) => {
        console.error('数据库初始化失败：', error.message);
        process.exitCode = 1;
    });
}

module.exports = { initialize };

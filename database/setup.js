'use strict';

const { connect, transaction } = require('../server/db');
const { seedTask } = require('../server/legacy/store');
const { members, demoMember } = require('./demo-data');

const { migrate } = require('./migrations');

async function initialize(pool) {
    await transaction(pool, async (tx) => {
        await migrate(tx);
        const { rows } = await tx.query('SELECT COUNT(*)::int AS total FROM Members');
        if (rows[0].total) {
            console.log('演示会员已存在，跳过初始化数据。');
            return;
        }
        await tx.query('INSERT INTO Members SELECT id,profile FROM jsonb_to_recordset($1::jsonb) AS r(id text,profile jsonb)',
            [JSON.stringify(members.map(member=>({id:member.id,profile:member})))]);
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
        await pool.end();
    }
}

if (require.main === module) {
    setup().catch((error) => {
        console.error('数据库初始化失败：', error.message);
        process.exitCode = 1;
    });
}

module.exports = { initialize, migrate };

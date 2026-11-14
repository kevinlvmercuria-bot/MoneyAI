'use strict';

const { connect, transaction } = require('../server/db');
const { migrateTeam } = require('../database/migrations');
const { saveCredentials } = require('../server/team-auth');
const { httpConfig } = require('../server/http-config');

async function run() {
    if (!httpConfig().origin) throw new Error('请配置 APP_PUBLIC_URL 或使用 Render Web Service。');
    if (!process.env.WECOM_SETTINGS_KEY) throw new Error('请配置稳定的 WECOM_SETTINGS_KEY。');
    // Fail before migrations if the simulation fixture is missing.
    const snapshot = require('../data/team-data.json');
    if (snapshot.data_type !== 'simulation') throw new Error('云端演示仅允许模拟资料。');
    const pool = await connect();
    try {
        await transaction(pool, async tx => {
            await migrateTeam(tx);
            const { rows } = await tx.query("SELECT 1 FROM TeamCredentials WHERE employee=''");
            if (!rows.length) {
                await saveCredentials(tx, '', {
                    username: process.env.DEMO_OWNER_USERNAME,
                    password: process.env.DEMO_OWNER_PASSWORD,
                });
                console.log('首次演示管理员已创建。');
            }
        });
    } finally { await pool.end(); }
    process.env.APP_HOST = '0.0.0.0';
    await require('../server/main').start({ legacy: false });
}

if (require.main === module) run().catch(error => {
    console.error('云端演示启动失败：', error.message);
    process.exitCode = 1;
});

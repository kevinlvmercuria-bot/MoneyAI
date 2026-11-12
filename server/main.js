'use strict';

const { connect, transaction } = require('./db');
const { createApp } = require('./app');

async function start({ legacy = process.env.ENABLE_LEGACY !== 'false' } = {}) {
    const pool = await connect();
    pool.on('error', (error) => console.error('数据库连接池错误：', error.message));
    try {
        if (legacy) {
            const state = await transaction(pool, require('./legacy/store').state, 'Shared');
            if (!state.members.length) throw new Error('旧版会员数据为空，请先运行 npm run db:init，或使用 npm run start:team');
        }
        const teamState = await pool.query("SELECT to_regclass('public.teamdemostate') AS id");
        if (!teamState.rows[0].id) throw new Error('账号版状态表尚未初始化，请运行 npm run db:init:team');
        const { rows } = await pool.query("SELECT to_regclass('public.teamcarereminders') AS id");
        if (!rows[0].id) throw new Error('护理回访表尚未初始化，请按 README 核对目标数据库和迁移步骤。');
        const integrations = await pool.query("SELECT to_regclass('public.wecomdeliveries') AS wecom, to_regclass('public.kfmessages') AS kf");
        if (!integrations.rows[0].wecom || !integrations.rows[0].kf)
            throw new Error('企微与客服表尚未初始化，请运行 npm run db:migrate。');
        await transaction(pool, require('./team-auth').initializeTeamAuth);
    } catch (error) {
        await pool.end();
        throw new Error('数据库尚未就绪，请检查连接及初始化状态。' + error.message);
    }
    const app = createApp(pool, { legacy });
    try { await app.locals.wecomSettings.ensure(); } catch (error) { await pool.end(); throw error; }
    const server = app.listen(Number(process.env.APP_PORT || 3000), process.env.APP_HOST || '127.0.0.1', () => {
        console.log(`NailMate 已启动 http://127.0.0.1:${server.address().port}`);
    });
    const worker = setInterval(() => app.locals.wecom.tick().catch(error => console.error('企微任务查询未完成：', error.message)), 15000);
    worker.unref();
    const kfWorker = setInterval(() => app.locals.kf.tick().catch(error => console.error('客服同步未完成：', error.message)), 15000);
    kfWorker.unref();
    app.locals.kf.tick().catch(error => console.error('客服恢复未完成：', error.message));
    app.locals.wecom.tick().catch(error => console.error('企微任务恢复未完成：', error.message));
    server.once('close', () => clearInterval(worker));
    server.once('close', () => clearInterval(kfWorker));
    server.once('error', async (error) => {
        console.error('HTTP 启动失败：', error.message);
        await pool.end();
        process.exitCode = 1;
    });
    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.once(signal, () => {
            server.close(async () => {
                await pool.end();
            });
        });
    }
}

if (require.main === module) {
    start().catch((error) => {
        console.error('启动失败：', error.message);
        process.exitCode = 1;
    });
}

module.exports = { createApp, start };

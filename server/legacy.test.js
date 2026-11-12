'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./app');
const { randomBytes } = require('node:crypto');
const { connect, transaction } = require('./db');
const { migrateTeam } = require('../database/migrations');
const { authenticate } = require('./test-auth-client');

test('独立账号版不暴露旧版入口与写接口，兼容版保留老板娘鉴权', async () => {
    for (const legacy of [false, true]) {
        // 无凭据的请求不应访问数据库；任何意外访问都会使本测试失败。
        const app = createApp({}, { legacy });
        const server = app.listen(0, '127.0.0.1');
        await new Promise(resolve => server.once('listening', resolve));
        const base = `http://127.0.0.1:${server.address().port}`;
        try {
            const page = await fetch(base);
            assert.equal(page.status, 200);
            assert.match(await page.text(), /app\/pages\/members.js/);
            assert.equal((await fetch(base + '/legacy.html')).status, legacy ? 401 : 404);
            assert.equal((await fetch(base + '/api/state')).status, legacy ? 401 : 404);
            assert.equal((await fetch(base + '/api/reset', { method: 'POST' })).status, legacy ? 401 : 404);
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
    }
});

test('独立账号版只依赖新版表，重复迁移后可登录和读取工作台', async () => {
    const database = 'NailMate_TeamOnly_' + randomBytes(8).toString('hex');
    const master = await connect('postgres');
    let pool, server, created = false;
    try {
        await master.query(`CREATE DATABASE "${database}"`);
        created = true;
        pool = await connect(database);
        await transaction(pool, migrateTeam);
        await transaction(pool, migrateTeam);
        const tables = (await pool.query("SELECT tablename AS name FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(row => row.name);
        assert.deepEqual(tables, ['kfaccounts','kfconversations','kfmessages','memberimports','teamcarereminders','teamcredentials','teamdemostate',
            'wecombatches','wecomdeliveries','wecomemployees','wecommembers','wecomsettings']);
        server = createApp(pool, { legacy: false }).listen(0, '127.0.0.1');
        await new Promise(resolve => server.once('listening', resolve));
        const base = `http://127.0.0.1:${server.address().port}`;
        const request = await authenticate(base, 'setup');
        const response = await request(base + '/api/team', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'bootstrap' }),
        });
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.state.tasks.length, 0);
        assert.equal(body.snapshot.members.length, 2800);
        assert.equal((await request(base + '/api/state')).status, 404);
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        if (pool) await pool.end();
        if (created) await master.query(`DROP DATABASE "${database}" WITH (FORCE)`);
        await master.end();
    }
});

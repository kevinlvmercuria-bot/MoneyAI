'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, scrypt } = require('node:crypto');
const { promisify } = require('node:util');
const { Pool } = require('pg');
const { resetPassword, run, checkPassword, Cancelled } = require('./reset-password');
const { transaction } = require('../server/db');
const { initializeTeamAuth, saveCredentials } = require('../server/team-auth');
const { registerTeamAuth } = require('../server/team-auth');
const express = require('express');

test('密码校验保留原始字符，拒绝短密码及两次输入不一致', () => {
    assert.throws(() => checkPassword('short', 'short'), /10–128/);
    assert.throws(() => checkPassword('a'.repeat(129), 'a'.repeat(129)), /10–128/);
    assert.throws(() => checkPassword('Example@2026', 'Different@2026'), /不一致/);
    assert.doesNotThrow(() => checkPassword(' 中文@ pass 2026 ', ' 中文@ pass 2026 '));
});

// Never fall back to the daily application's DATABASE_URL for a mutation test.
test('独立 PostgreSQL：重置、取消、错误账号、并发凭据保护、会话失效与其他数据保留', {
    skip: !process.env.RESET_TEST_DATABASE_URL, timeout: 30000,
}, async () => {
    const database = 'nailmate_password_test_' + randomBytes(8).toString('hex');
    const master = new Pool({ connectionString: process.env.RESET_TEST_DATABASE_URL });
    let pool, server;
    try {
        await master.query(`CREATE DATABASE "${database}"`);
        const url = new URL(process.env.RESET_TEST_DATABASE_URL); url.pathname = '/' + database;
        pool = new Pool({ connectionString: url.toString() });
        await transaction(pool, async tx => {
            await initializeTeamAuth(tx);
            await saveCredentials(tx, '', { username: 'reset-owner', password: 'Original@2026' });
            await saveCredentials(tx, '测试员工', { username: 'reset-worker', password: 'Worker@2026' });
            await tx.query("CREATE TABLE preserved_data(id integer PRIMARY KEY,value text); INSERT INTO preserved_data VALUES(1,'会员和任务标记')");
        });
        const app = express(); registerTeamAuth(app, pool);
        app.use((error, _req, res, _next) => res.status(error.apiStatus || 500).json({ error: error.message }));
        server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
        const base = 'http://127.0.0.1:' + server.address().port;
        const login = password => fetch(base + '/api/team/auth/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'reset-owner', password }),
        });
        const oldLogin = await login('Original@2026'); assert.equal(oldLogin.status, 200);
        const cookie = oldLogin.headers.get('set-cookie').split(';')[0];
        const before = (await pool.query('SELECT * FROM teamcredentials ORDER BY username')).rows;
        const owner = before.find(row => row.employee === '');
        await assert.rejects(resetPassword(pool, { username: 'missing', password: 'New@2026-test', expectedSalt: owner.salt }), /不存在/);
        await assert.rejects(resetPassword(pool, { username: owner.username, password: 'New@2026-test', expectedSalt: randomBytes(16) }), /凭据已变化/);

        const cancelledAnswers = ['', 'Cancelled@2026', 'Cancelled@2026', 'NO'];
        const fakePool = { query: pool.query.bind(pool), connect: pool.connect.bind(pool), end: async () => {} };
        const out = [];
        await assert.rejects(run({ connectDatabase: async () => fakePool, out: value => out.push(value),
            createPrompter: () => ({ ask: async () => cancelledAnswers.shift(), close() {} }),
        }), Cancelled);
        assert.deepEqual((await pool.query('SELECT * FROM teamcredentials ORDER BY username')).rows, before);

        const password = ' 新密码@2026 fixture ';
        const answers = ['', password, password, 'RESET'];
        await run({ connectDatabase: async () => fakePool, out: value => out.push(value),
            createPrompter: () => ({ ask: async () => answers.shift(), close() {} }),
        });
        assert.ok(!out.join('\n').includes(password), '输出中不得包含密码');
        const after = (await pool.query('SELECT * FROM teamcredentials ORDER BY username')).rows;
        assert.deepEqual(after.find(row => row.employee !== ''), before.find(row => row.employee !== ''));
        assert.equal(after.length, before.length);
        const updated = after.find(row => row.employee === '');
        assert.notDeepEqual(updated.salt, owner.salt);
        assert.deepEqual(updated.password_hash, await promisify(scrypt)(password, updated.salt, 64));
        assert.deepEqual((await pool.query('SELECT * FROM preserved_data')).rows, [{ id: 1, value: '会员和任务标记' }]);
        assert.equal((await login('Original@2026')).status, 401);
        assert.equal((await login(password)).status, 200);
        const session = await fetch(base + '/api/team/auth/session', { headers: { Cookie: cookie } });
        assert.equal((await session.json()).user, null, '重置后旧会话应失效');
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        await pool?.end();
        await master.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
        await master.end();
    }
});

'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./app');

test('page, M0001, validation and mock review/report workflow', async () => {
    const app = createApp({ mode: 'mock' });
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(route, body) {
        return (await fetch(base + route, body === undefined ? {} : {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        })).json();
    }
    try {
        assert.match(await (await fetch(base)).text(), /NailMate AI/);
        assert.equal((await fetch(base + '/app.js')).status, 200);
        const member = await request('/api/members/M0001');
        assert.equal(member.code, 0);
        assert.equal(member.data.bal, 420);
        assert.equal(member.data.consent, true);
        assert.equal((await request('/api/members/M9999')).code, -1004);
        assert.equal((await request('/api/members/invalid')).code, -1001);
        assert.equal((await request('/api/tasks', { goal: 'wake', memberIds: ['M0003'] })).code, -1005);
        assert.equal((await request('/api/tasks', { goal: 'constructor', memberIds: ['M0001'] })).code, -1001);
        assert.equal((await request('/api/tasks/T0001/execute', { scenario: 'visit' })).code, -1005);
        assert.equal((await request('/api/tasks/T0001/review', { decision: 'approve', message: '' })).code, -1001);
        const review = await request('/api/tasks/T0001/review', { decision: 'approve', message: '欢迎预约' });
        assert.equal(review.data.task.status, 'approved');
        assert.equal(review.data.mock, true);
        assert.equal((await request('/api/tasks/T0001/review', { decision: 'reject' })).code, -1005);
        assert.equal((await request('/api/tasks/T0001/execute', { scenario: 'visit' })).code, 0);
        assert.equal((await request('/api/tasks/T0001/execute', { scenario: 'visit' })).code, -1005);
        const report = (await request('/api/reports/summary')).data;
        assert.equal(report.visited, 1);
        assert.equal(report.simulatedSpending, 168);
        assert.equal(report.mock, true);
        assert.equal((await request('/api/reset', {})).data.state.tasks[0].status, 'pending_review');
        const invalidJson = await fetch(base + '/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
        assert.equal(invalidJson.status, 200);
        assert.equal((await invalidJson.json()).code, -1001);
        assert.equal((await fetch(base + '/api/missing')).status, 404);
    } finally {
        await new Promise((resolve) => server.close(resolve));
        await app.locals.close();
    }
});

test('mssql data-source failure is visible and never silently replaced by mock', async () => {
    const repository = { find: async () => { throw new Error('private connection details'); }, close: async () => {} };
    const app = createApp({ mode: 'mssql', repository });
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/members/M0001`);
        const body = await response.json();
        assert.equal(body.code, -2000);
        assert.equal(body.data, null);
        assert.ok(!JSON.stringify(body).includes('private connection details'));
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

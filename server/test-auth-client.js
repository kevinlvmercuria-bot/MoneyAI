'use strict';

const assert = require('node:assert/strict');
const ownerCredentials = { username: 'test-owner', password: 'test-owner-password' };

async function authenticate(base, action, credentials = ownerCredentials) {
    const response = await fetch(base + '/api/team/auth/' + action, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials),
    });
    assert.equal(response.status, 200, await response.clone().text());
    const cookie = response.headers.get('set-cookie').split(';', 1)[0];
    return (url, options = {}) => {
        const headers = new Headers(options.headers);
        headers.set('Cookie', cookie);
        return fetch(url, { ...options, headers });
    };
}

module.exports = { authenticate };

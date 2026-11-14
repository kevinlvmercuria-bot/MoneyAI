'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { httpConfig, checkRequest } = require('./http-config');

function request(host, { origin, method = 'POST', site, forwardedHost } = {}) {
    const headers = { host, origin, 'sec-fetch-site': site, 'x-forwarded-host': forwardedHost };
    return { method, protocol: 'http', hostname: host.split(':')[0], get: name => headers[name] };
}

test('默认仅本机访问，拒绝外部 Host 与跨站写入', () => {
    const config = httpConfig({});
    assert.doesNotThrow(() => checkRequest(request('localhost:3000', { origin: 'http://localhost:3000' }), config));
    assert.throws(() => checkRequest(request('attacker.example'), config), { apiStatus: 403 });
    assert.throws(() => checkRequest(request('localhost:3000', { origin: 'https://attacker.example' }), config), { apiStatus: 403 });
});

test('公网反向代理允许配置的 HTTPS 同源请求，不信任伪造域名', () => {
    const config = httpConfig({ RENDER_EXTERNAL_URL: 'https://nailmate-demo.onrender.com' });
    assert.doesNotThrow(() => checkRequest(request(config.host, { origin: config.origin }), config));
    assert.throws(() => checkRequest(request(config.host, { origin: 'https://attacker.example' }), config), { apiStatus: 403 });
    assert.throws(() => checkRequest(request('attacker.example', { forwardedHost: config.host }), config), { apiStatus: 403 });
    assert.throws(() => checkRequest(request(config.host, { origin: config.origin, site: 'cross-site' }), config), { apiStatus: 403 });
    assert.throws(() => httpConfig({ APP_PUBLIC_URL: 'http://public.example' }), /HTTPS/);
});

test('公网关闭浏览器首次注册，登录 Cookie 带 Secure', async () => {
    const previous = process.env.APP_PUBLIC_URL;
    process.env.APP_PUBLIC_URL = 'https://nailmate-demo.example';
    const routes = new Map();
    const middleware = [];
    const app = {
        use: (...args) => middleware.push(args),
        get: (path, ...handlers) => routes.set('GET ' + path, handlers),
        post: (path, ...handlers) => routes.set('POST ' + path, handlers),
    };
    try {
        const { registerTeamAuth, saveCredentials } = require('./team-auth');
        const credentials = await saveCredentials({ query: async () => ({ rows: [] }) }, '', {
            username: 'demo-owner', password: 'test-password-12345',
        });
        // Construct a stored credential using the same password hashing contract.
        const { scryptSync } = require('node:crypto');
        const row = { ...credentials, password_hash: scryptSync('test-password-12345', credentials.salt, 64) };
        registerTeamAuth(app, { query: async () => ({ rows: [row] }) });
        const setup = routes.get('POST /api/team/auth/setup').at(-1);
        await assert.rejects(() => setup({}, {}), { apiStatus: 403 });
        let options;
        const req = { socket: { remoteAddress: '127.0.0.1' }, body: { username: 'demo-owner', password: 'test-password-12345' }, get: () => undefined };
        await routes.get('POST /api/team/auth/login').at(-1)(req, {
            cookie: (_name, _value, config) => { options = config; }, json: () => {},
        });
        assert.equal(options.secure, true);
        assert.equal(options.httpOnly, true);
        assert.equal(options.sameSite, 'strict');
    } finally {
        if (previous === undefined) delete process.env.APP_PUBLIC_URL;
        else process.env.APP_PUBLIC_URL = previous;
    }
});

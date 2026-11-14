'use strict';

function httpConfig(env = process.env) {
    const value = env.APP_PUBLIC_URL || env.RENDER_EXTERNAL_URL;
    const origin = value ? new URL(value).origin : null;
    if (origin && !origin.startsWith('https://')) throw new Error('公网地址必须使用 HTTPS。');
    return { origin, host: origin ? new URL(origin).host : null };
}

// Compare the actual Host and Origin rather than trusting forwarded host headers.
function checkRequest(req, config) {
    const host = req.get('host');
    const allowed = config.origin
        ? host === config.host
        : ['localhost', '127.0.0.1'].includes(req.hostname);
    if (!allowed) throw Object.assign(new Error('访问域名未获允许。'), { apiStatus: 403 });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        const origin = req.get('origin');
        const expected = config.origin || `${req.protocol}://${host}`;
        if ((origin && origin !== expected) || req.get('sec-fetch-site') === 'cross-site')
            throw Object.assign(new Error('请求来源无效。'), { apiStatus: 403 });
    }
}

module.exports = { httpConfig, checkRequest };

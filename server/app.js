'use strict';

const path = require('node:path');
const express = require('express');

// 装配 HTTP 应用；默认保留本地旧版，通过 legacy:false 可独立运行账号版。
function createApp(pool, options = {}) {
    const app = express();
    app.disable('x-powered-by');
    app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    const auth = require('./team-auth').registerTeamAuth(app, pool);
    const wecomSettings = require('./wecom-settings').createWecomSettings(pool, {
        contactClient: options.wecomClient, kfClient: options.kfClient,
        ...(options.settingsOptions || {}),
    });
    const wecom = require('./wecom-service').createWecomService(pool,
        wecomSettings.contact,
        { now: options.teamNow, snapshot: options.teamSnapshot });
    const kf = require('./kf-service').createKfService(pool,
        wecomSettings.kf, { now: options.teamNow });
    require('./kf-routes').registerKfRoutes(app, pool, auth, kf, { callback: options.kfCallback || wecomSettings.callback, ensureConfig: wecomSettings.ensure });
    require('./wecom-admin-routes').registerWecomAdminRoutes(app, pool, auth, wecomSettings, wecom);
    require('./wecom-routes').registerWecomRoutes(app, pool, auth, wecom, wecomSettings);
    app.locals.wecom = wecom;
    app.locals.kf = kf;
    app.locals.wecomSettings = wecomSettings;
    app.locals.memberImport = require('./member-import-routes').registerMemberImportRoutes(app,pool,auth,{snapshot:options.teamSnapshot,now:options.teamNow});
    require('./team-routes').registerTeamRoutes(app, pool, auth, { now: options.teamNow, snapshot: options.teamSnapshot });
    if (options.legacy !== false) {
        app.use('/api', auth.ownerOnly);
        require('./legacy/review-routes').registerLegacyRoutes(app, pool, options);
        app.get('/legacy.html', auth.ownerOnly);
    } else {
        app.get('/legacy.html', (_req, res) => res.status(404).send('旧版工作台未启用'));
    }
    app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在' }));
    app.use(express.static(path.join(__dirname, '..', 'public')));
    app.use((error, _req, res, _next) => {
        if (error.apiStatus) return res.status(error.apiStatus).json({ error: error.message });
        if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON 格式有误' });
        if (error.type === 'entity.too.large') return res.status(413).json({ error: '请求体过大' });
        console.error(error);
        if (error.code === '23505') return res.status(409).json({ error: '记录已存在或已有未完成的发送任务，请刷新后核对。' });
        return res.status(500).json({ error: '服务端出错，请检查 PostgreSQL 连接和初始化状态' });
    });
    return app;
}

module.exports = { createApp };

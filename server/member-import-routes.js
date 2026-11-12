'use strict';
const express = require('express');
const { fail } = require('./wecom-service');
const { createMemberImport, template } = require('./member-import');
function registerMemberImportRoutes(app, pool, auth, options = {}) {
    const service = createMemberImport(pool, options),
        router = express.Router();
    router.use(async (req, _res, next) => {
        req.account = await auth.requireAccount(req);
        fail(
            req.account.role === 'owner',
            '仅管理员可以导入真实会员数据。',
            403,
        );
        next();
    });
    router.get('/template/:format', async (req, res) => {
        fail(['csv', 'xlsx'].includes(req.params.format), '模板格式无效。');
        res.attachment('member-import-template.' + req.params.format)
            .type(
                req.params.format === 'xlsx'
                    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                    : 'text/csv',
            )
            .send(await template(req.params.format));
    });
    router.post(
        '/inspect',
        express.raw({ type: 'application/octet-stream', limit: '5mb' }),
        async (req, res) => {
            const format = req.query.format;
            res.json(await service.inspect(req.account, req.body, format));
        },
    );
    router.use(express.json({ limit: '16kb' }));
    router.post('/preview', async (req, res) =>
        res.json(await service.preview(req.account, req.body)),
    );
    router.post('/commit', async (req, res) =>
        res.json(await service.commit(req.account, req.body)),
    );
    app.use('/api/team/import', router);
    return service;
}
module.exports = { registerMemberImportRoutes };

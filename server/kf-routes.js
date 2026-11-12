'use strict';
const express = require('express');
const { fail } = require('./wecom-service');
const { decryptCallback, xmlField } = require('./wecom-callback');
function registerKfRoutes(
    app,
    pool,
    auth,
    service,
    {
        ensureConfig = async () => {},
        callback = {
            token: process.env.WECOM_CALLBACK_TOKEN,
            key: process.env.WECOM_CALLBACK_AES_KEY,
            corpId: process.env.WECOM_CORP_ID,
        },
    } = {},
) {
    const callbackPath = '/api/wecom/kf/callback';
    const decrypt = (req, encrypted) =>
        decryptCallback(
            {
                signature: req.query.msg_signature,
                timestamp: req.query.timestamp,
                nonce: req.query.nonce,
                encrypted,
            },
            typeof callback === 'function' ? callback() : callback,
        );
    app.get(callbackPath, async (req, res) => {
        await ensureConfig();res.type('text/plain').send(decrypt(req, req.query.echostr));
    });
    app.post(
        callbackPath,
        express.text({ type: () => true, limit: '128kb' }),
        async (req, res) => {
            await ensureConfig();
            const xml = decrypt(req, xmlField(req.body, 'Encrypt'));
            fail(
                xmlField(xml, 'Event') === 'kf_msg_or_event',
                '不支持此回调事件。',
            );
            const openKfid = xmlField(xml, 'OpenKfId'),
                token = xmlField(xml, 'Token');
            fail(
                openKfid && openKfid.length <= 200 && token.length <= 128,
                '回调内容无效。',
            );
            await pool.query(
                `INSERT INTO kfaccounts(open_kfid,name,sync_token,token_at) VALUES($1,$1,$2,CURRENT_TIMESTAMP)
            ON CONFLICT(open_kfid) DO UPDATE SET sync_token=excluded.sync_token,token_at=excluded.token_at,last_sync_at=NULL`,
                [openKfid, token],
            );
            res.type('text/plain').send('success');
        },
    );
    const router = express.Router();
    router.use(express.json({ limit: '16kb' }));
    router.use(async (req, _res, next) => {
        req.account = await auth.requireAccount(req);
        await ensureConfig();
        next();
    });
    const owner = (req) =>
        fail(req.account.role === 'owner', '此操作仅限老板娘。', 403);
    router.get('/status', (_req, res) =>
        res.json({
            configured: service.client.configured,
            callbackConfigured: Boolean(
                (typeof callback === 'function' ? callback() : callback).token &&
                (typeof callback === 'function' ? callback() : callback).key &&
                (typeof callback === 'function' ? callback() : callback).corpId,
            ),
        }),
    );
    router.post('/accounts/sync', async (req, res) => {
        owner(req);
        res.json({ accounts: await service.accounts() });
    });
    router.get('/accounts', async (req, res) => {
        owner(req);
        res.json({
            accounts: (
                await pool.query(
                    'SELECT open_kfid,name,last_sync_at,last_error FROM kfaccounts ORDER BY name',
                )
            ).rows,
        });
    });
    router.post('/entry', async (req, res) => {
        owner(req);
        const { openKfid } = req.body;
        fail(typeof openKfid === 'string', '请选择客服账号。');
        fail(
            (
                await pool.query(
                    'SELECT 1 FROM kfaccounts WHERE open_kfid=$1',
                    [openKfid],
                )
            ).rowCount,
            '客服账号不存在。',
            404,
        );
        res.json(
            await service.client.call('kf/add_contact_way', {
                open_kfid: openKfid,
                scene: 'nailmate',
            }),
        );
    });
    router.get('/conversations', async (req, res) =>
        res.json({ conversations: await service.conversations(req.account) }),
    );
    router.get('/messages/:id', async (req, res) =>
        res.json(await service.messages(req.account, req.params.id)),
    );
    router.post('/assign', async (req, res) => {
        await service.assign(req.account, req.body);
        res.json({ saved: true });
    });
    router.post('/send', async (req, res) =>
        res.status(202).json(await service.send(req.account, req.body)),
    );
    router.post('/refresh', async (req, res) => {
        const row = await service.authorized(
            pool,
            req.account,
            req.body.conversationId,
        );
        await service.sync(row.open_kfid);
        res.json(await service.messages(req.account, row.id));
    });
    router.get('/image/:conversationId/:messageId', async (req, res) => {
        await service.authorized(pool, req.account, req.params.conversationId);
        const row = (
            await pool.query(
                "SELECT payload FROM kfmessages WHERE conversation_id=$1 AND id=$2 AND msgtype='image'",
                [req.params.conversationId, req.params.messageId],
            )
        ).rows[0];
        fail(row, '图片消息不存在。', 404);
        const mediaId = JSON.parse(row.payload).image?.media_id;
        fail(mediaId, '图片素材不可用。', 404);
        const media = await service.client.downloadImage(mediaId);
        res.set('Cache-Control', 'private, max-age=300')
            .set('X-Content-Type-Options', 'nosniff')
            .type(media.type)
            .send(media.data);
    });
    app.use('/api/wecom/kf', router);
}
module.exports = { registerKfRoutes };

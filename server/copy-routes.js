'use strict';

const express = require('express');
const { sql, transaction } = require('./db');
const store = require('./store');
const ai = require('./ai-copy');
const { resolveContext, generationCatalog } = require('./copy-context');
const { noProductObjective, canContactFor } = require('../public/rules');
const { canContact } = require('../public/rules');

function check(condition, status, message) {
    if (!condition) throw Object.assign(new Error(message), { apiStatus: status });
}

function registerImageRoutes(app, pool) {
    app.post(
        '/api/products/:id/image',
        express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '5mb' }),
        async (req, res) => {
            const data = req.body;
            const type = req.get('Content-Type')?.split(';')[0];
            check(Buffer.isBuffer(data) && data.length >= 16, 400, '请选择 PNG、JPEG 或 WebP 图片');
            const valid =
                type === 'image/png'
                    ? data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
                    : type === 'image/jpeg'
                      ? data[0] === 255 && data[1] === 216 && data[2] === 255
                      : type === 'image/webp' &&
                        data.toString('ascii', 0, 4) === 'RIFF' &&
                        data.toString('ascii', 8, 12) === 'WEBP';
            check(valid, 400, '图片格式与文件内容不匹配');
            const state = await transaction(pool, async (tx) => {
                const current = await store.state(tx);
                check(
                    current.products.some((product) => product.id === req.params.id),
                    404,
                    '产品不存在',
                );
                await tx
                    .request()
                    .input('productId', sql.VarChar(40), req.params.id)
                    .input('type', sql.VarChar(30), type)
                    .input('data', sql.VarBinary(sql.MAX), data)
                    .query(
                        'INSERT dbo.ProductImages (product_id, content_type, image_data) VALUES (@productId, @type, @data)',
                    );
                await store.log(tx, 'upload_product_image', `${req.params.id} · 上传产品图片`);
                return store.state(tx);
            });
            res.json({ state });
        },
    );
    app.get('/api/product-images/:id', async (req, res) => {
        check(/^[1-9]\d{0,8}$/.test(req.params.id), 400, '图片编号无效');
        const { recordset } = await pool
            .request()
            .input('id', sql.Int, Number(req.params.id))
            .query('SELECT content_type, image_data FROM dbo.ProductImages WHERE id = @id');
        check(recordset.length, 404, '图片不存在');
        const row = recordset[0];
        const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[
            row.content_type
        ];
        res.set('X-Content-Type-Options', 'nosniff');
        res.set('Cache-Control', 'private, max-age=86400');
        if (req.query.download === '1') res.attachment(`product-image-${req.params.id}.${ext}`);
        res.type(row.content_type).send(row.image_data);
    });
}

function registerCopyRoutes(app, pool, generate = ai.generateCopy) {
    let generating = false;
    app.post('/api/copy/generate', async (req, res) => {
        const {
            memberIds,
            model,
            style = ai.metadata().defaultStyle,
            context = null,
        } = req.body ?? {};
        check(
            Array.isArray(memberIds) &&
                memberIds.length > 0 &&
                memberIds.length <= 5 &&
                memberIds.every((id) => typeof id === 'string' && /^M\d{4}$/.test(id)) &&
                new Set(memberIds).size === memberIds.length,
            400,
            '请勾选 1 至 5 位不同会员',
        );
        check(
            ai.metadata().models.some((item) => item.id === model),
            400,
            '请选择可用模型',
        );
        check(
            ai.metadata().styles.some((item) => item.id === style),
            400,
            '请选择可用的文案风格',
        );
        check(!generating, 409, '已有一批文案正在生成，请稍后重试');
        generating = true;
        const items = [],
            errors = [];
        try {
            const initial = await transaction(pool, store.state, 'Shared');
            const selected = memberIds.map((id) =>
                initial.members.find((member) => member.id === id),
            );
            check(
                selected.every((member) => member && canContactFor(member, context?.objective)),
                409,
                '名单中存在不可联系的会员，请重新选择',
            );
            check(
                (context?.objective && noProductObjective(context.objective)) ||
                    ai.availableProducts(initial.products).length ||
                    context?.objective === 'preview',
                409,
                '当前没有可推荐的产品',
            );
            const contexts = new Map(
                selected.map((member) => [
                    member.id,
                    resolveContext(member, initial.products, context),
                ]),
            );
            // 网络请求在事务外执行，避免慢模型调用占用数据库锁。
            for (const member of selected) {
                try {
                    const resolved = contexts.get(member.id);
                    const generated = await generate({
                        member,
                        products: initial.products,
                        model,
                        style,
                        context: resolved,
                    });
                    const result = ai.parseResult(
                        JSON.stringify(generated),
                        generationCatalog(member, initial.products, resolved),
                        Boolean(resolved && noProductObjective(resolved.objective)),
                    );
                    const id = await transaction(pool, async (tx) => {
                        const current = await store.state(tx);
                        const latest = current.members.find((item) => item.id === member.id);
                        check(
                            latest &&
                                canContactFor(latest, resolved?.objective) &&
                                JSON.stringify(ai.memberFacts(latest)) ===
                                    JSON.stringify(ai.memberFacts(member)),
                            409,
                            '会员资料或联系资格已变化，请重新生成',
                        );
                        check(
                            JSON.stringify(resolveContext(latest, current.products, context)) ===
                                JSON.stringify(resolved),
                            409,
                            '沟通目的或回访计划已变化',
                        );
                        check(
                            result.productIds.every((productId) => {
                                const before = initial.products.find(
                                    (product) => product.id === productId,
                                );
                                const after = generationCatalog(
                                    latest,
                                    current.products,
                                    resolved,
                                ).find((product) => product.id === productId);
                                return (
                                    after &&
                                    before.name === after.name &&
                                    before.price === after.price
                                );
                            }),
                            409,
                            '产品目录已变化，请重新生成',
                        );
                        const inserted = await tx
                            .request()
                            .input('member', sql.VarChar(5), member.id)
                            .input('model', sql.NVarChar(100), model)
                            .input('message', sql.NVarChar(1000), result.message)
                            .input('reason', sql.NVarChar(500), result.reason)
                            .input('ids', sql.NVarChar(sql.MAX), JSON.stringify(result.productIds))
                            .input(
                                'context',
                                sql.NVarChar(sql.MAX),
                                resolved ? JSON.stringify({ ...resolved, style }) : null,
                            )
                            .query(`INSERT dbo.CopyDrafts (member_id, model, message, original_message, reason, product_ids, context_json)
                                OUTPUT INSERTED.id VALUES (@member, @model, @message, @message, @reason, @ids, @context)`);
                        await store.log(
                            tx,
                            'generate_copy',
                            `${member.id} · ${model} · 生成文案素材`,
                        );
                        return inserted.recordset[0].id;
                    });
                    items.push({ id, memberId: member.id });
                } catch (error) {
                    errors.push({
                        memberId: member.id,
                        error: error.apiStatus ? error.message : '生成未完成，请稍后重试',
                    });
                }
            }
            res.json({ items, errors, state: await transaction(pool, store.state, 'Shared') });
        } finally {
            generating = false;
        }
    });

    function draftAction(markCopied) {
        return async (req, res) => {
            check(/^[1-9]\d{0,8}$/.test(req.params.id), 400, '文案编号无效');
            const state = await transaction(pool, async (tx) => {
                const current = await store.state(tx);
                const { recordset } = await tx
                    .request()
                    .input('id', sql.Int, Number(req.params.id))
                    .query(
                        'SELECT member_id, message, product_ids, context_json FROM dbo.CopyDrafts WHERE id = @id',
                    );
                check(recordset.length, 404, '文案不存在');
                const member = current.members.find((item) => item.id === recordset[0].member_id);
                const savedContext = recordset[0].context_json
                    ? JSON.parse(recordset[0].context_json)
                    : null;
                check(
                    member && canContactFor(member, savedContext?.objective),
                    409,
                    '当前会员不满足联系资格',
                );
                resolveContext(member, current.products, savedContext);
                const catalog = new Set(
                    generationCatalog(member, current.products, savedContext).map(
                        (product) => product.id,
                    ),
                );
                check(
                    JSON.parse(recordset[0].product_ids).every((id) => catalog.has(id)),
                    409,
                    '推荐产品已不可用，请重新生成',
                );
                if (markCopied) {
                    check(typeof req.body?.message === 'string', 400, '请提交实际复制的文案内容');
                    check(
                        req.body.message === recordset[0].message,
                        409,
                        '文案已被修改，请刷新后重新核对并复制',
                    );
                    await tx
                        .request()
                        .input('id', sql.Int, Number(req.params.id))
                        .query(
                            'UPDATE dbo.CopyDrafts SET copied_at = SYSUTCDATETIME() WHERE id = @id',
                        );
                    await store.log(tx, 'copy_material', `${member.id} · 复制文案素材`);
                } else {
                    const message =
                        typeof req.body?.message === 'string' ? req.body.message.trim() : '';
                    check(
                        message.length > 0 && message.length <= 1000,
                        400,
                        '文案需为 1 至 1000 字符',
                    );
                    await tx
                        .request()
                        .input('id', sql.Int, Number(req.params.id))
                        .input('message', sql.NVarChar(1000), message)
                        .query(
                            'UPDATE dbo.CopyDrafts SET message = @message, copied_at = NULL WHERE id = @id',
                        );
                }
                return store.state(tx);
            });
            res.json({ state });
        };
    }
    app.post('/api/copy/:id/save', draftAction(false));
    app.post('/api/copy/:id/copied', draftAction(true));
    return { isGenerating: () => generating };
}

module.exports = { registerImageRoutes, registerCopyRoutes };

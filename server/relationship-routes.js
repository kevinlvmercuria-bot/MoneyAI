'use strict';
const { randomUUID } = require('node:crypto');
const { sql, transaction } = require('./db');
const store = require('./store');
const { canContactFor, buildOpportunityTask } = require('../public/rules');
const { resolveContext, generationCatalog } = require('./copy-context');
function check(condition, message, status = 400) {
    if (!condition) throw Object.assign(new Error(message), { apiStatus: status });
}
function registerRelationshipRoutes(app, pool) {
    app.post('/api/members/:id/notes', async (req, res) => {
        check(/^M\d{4}$/.test(req.params.id), '会员编号无效');
        const { noteId = null, type, text, pinned = false, author = '店主' } = req.body || {};
        check(
            ['preference', 'communication', 'service', 'care', 'appointment'].includes(type) &&
                typeof text === 'string' &&
                text.trim().length > 0 &&
                text.trim().length <= 1200 &&
                typeof pinned === 'boolean' &&
                typeof author === 'string' &&
                author.trim().length > 0 &&
                author.length <= 80,
            '请填写有效的备注内容和类型',
        );
        check(
            noteId === null || (typeof noteId === 'string' && noteId.length <= 100),
            '备注编号无效',
        );
        const response = await transaction(pool, async (tx) => {
            const current = await store.state(tx);
            check(
                current.members.some((member) => member.id === req.params.id),
                '会员不存在',
                404,
            );
            const details = await store.memberDetails(tx, req.params.id);
            check(
                noteId === null || details.notes.some((note) => note.note_id === noteId),
                '备注不存在或不属于该会员',
                404,
            );
            const id = noteId || 'LOCAL-' + randomUUID();
            await tx
                .request()
                .input('id', sql.NVarChar(100), id)
                .input('member', sql.VarChar(5), req.params.id)
                .input('type', sql.VarChar(20), type)
                .input('text', sql.NVarChar(1200), text.trim())
                .input('pinned', sql.Bit, pinned)
                .input('author', sql.NVarChar(80), author.trim()).query(`
                IF EXISTS(SELECT 1 FROM dbo.MemberNoteEdits WHERE note_id=@id)
                    UPDATE dbo.MemberNoteEdits SET note_type=@type,note_text=@text,is_pinned=@pinned,author_name=@author,updated_at=SYSUTCDATETIME() WHERE note_id=@id AND member_id=@member;
                ELSE INSERT dbo.MemberNoteEdits(note_id,member_id,note_type,note_text,is_pinned,author_name) VALUES(@id,@member,@type,@text,@pinned,@author);
            `);
            await store.log(tx, 'save_member_note', `${req.params.id} · 保存会员备注`);
            return {
                state: await store.state(tx),
                details: await store.memberDetails(tx, req.params.id),
            };
        });
        res.json(response);
    });
    app.post('/api/copy/manual', async (req, res) => {
        const { memberId, message, context } = req.body || {};
        check(
            typeof memberId === 'string' &&
                /^M\d{4}$/.test(memberId) &&
                typeof message === 'string' &&
                message.trim().length > 0 &&
                message.trim().length <= 1000,
            '请填写有效的会员和文案',
        );
        const response = await transaction(pool, async (tx) => {
            const current = await store.state(tx),
                member = current.members.find((member) => member.id === memberId);
            check(member, '会员不存在', 404);
            check(canContactFor(member, context?.objective), '会员不符合沟通资格', 409);
            const resolved = resolveContext(member, current.products, context);
            check(resolved, '请选择沟通目的');
            const task = buildOpportunityTask(member, resolved.objective, current.products);
            const result = await tx
                .request()
                .input('member', sql.VarChar(5), memberId)
                .input('message', sql.NVarChar(1000), message.trim())
                .input('reason', sql.NVarChar(500), task.reason)
                .input(
                    'ids',
                    sql.NVarChar(sql.MAX),
                    JSON.stringify(resolved.productId ? [resolved.productId] : []),
                )
                .input('context', sql.NVarChar(sql.MAX), JSON.stringify(resolved))
                .query(
                    `INSERT dbo.CopyDrafts(member_id,model,message,original_message,reason,product_ids,context_json) OUTPUT INSERTED.id VALUES(@member,N'店主手写',@message,@message,@reason,@ids,@context)`,
                );
            return { draftId: result.recordset[0].id, state: await store.state(tx) };
        });
        res.json(response);
    });
    app.post('/api/tasks/from-copy', async (req, res) => {
        const id = Number(req.body?.draftId);
        check(Number.isSafeInteger(id) && id > 0 && id <= 2147483647, '文案编号无效');
        const response = await transaction(pool, async (tx) => {
            const current = await store.state(tx);
            const { recordset } = await tx
                .request()
                .input('id', sql.Int, id)
                .query('SELECT * FROM dbo.CopyDrafts WHERE id=@id');
            check(recordset.length, '文案不存在', 404);
            const draft = recordset[0];
            check(
                req.body.message === undefined || req.body.message === draft.message,
                '文案已被其他操作修改，请重新核对',
                409,
            );
            const member = current.members.find((member) => member.id === draft.member_id);
            const context = draft.context_json ? JSON.parse(draft.context_json) : null;
            check(member && canContactFor(member, context?.objective), '会员已不符合沟通资格', 409);
            resolveContext(member, current.products, context);
            check(
                !current.tasks.some(
                    (task) =>
                        task.memberId === member.id &&
                        (context?.objective === 'scheduled'
                            ? ['pending_review', 'approved'].includes(task.status)
                            : task.status !== 'rejected'),
                ),
                '该会员已有任务，请先处理',
                409,
            );
            const ids = JSON.parse(draft.product_ids),
                catalog = generationCatalog(member, current.products, context);
            check(
                ids.every((id) => catalog.some((product) => product.id === id)),
                '推荐产品已变化，请重新生成',
                409,
            );
            const task = buildOpportunityTask(
                member,
                context?.objective || (member.lifecycle === 'dormant' ? 'wake' : 'repurchase'),
                current.products,
            );
            task.message = draft.message;
            task.reason = draft.reason.slice(0, 400);
            task.context = {
                ...task.context,
                ...context,
                productId: ids[0] || null,
                copyDraftId: id,
            };
            const taskId = await store.insertTask(tx, task);
            await store.log(tx, 'submit_copy_review', `${member.id} · AI 文案提交人工审核`);
            return { created: 1, taskId, state: await store.state(tx) };
        });
        res.json(response);
    });
}
module.exports = { registerRelationshipRoutes };

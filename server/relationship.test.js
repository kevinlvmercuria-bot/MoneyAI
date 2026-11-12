'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { connect, transaction, sql } = require('./db');
const store = require('./legacy/store');
const { createApp } = require('./main');
const { authenticate } = require('./test-auth-client');
const { initialize } = require('../database/setup');
const { importSource } = require('../database/import-source');
const rules = require('../public/rules');
const { resolveCommunication } = require('../public/communication');

test('关系经营版 API 与持久化验收', { timeout: 90000 }, async (t) => {
    const name = 'NailMate_Relationship_' + randomBytes(8).toString('hex'),
        master = await connect('postgres');
    let pool,
        server,
        created = false,
        calls = 0;
    const generationStyles = [];
    try {
        await master.query(`CREATE DATABASE "${name}"`);
        created = true;
        pool = await connect(name);
        await initialize(pool);
        await importSource(pool);
        server = createApp(pool, {
            generateCopy: async ({ member, context, products, style }) => {
                calls++;
                generationStyles.push({ member: member.id, style });
                return {
                    message: '你好，想先问问你的近况，需要的话随时和我们聊聊。',
                    reason: '依据当前沟通目的与已有资料，先询问本人意愿。',
                    productIds: context
                        ? context.productId
                            ? [context.productId]
                            : []
                        : [
                              products.find(
                                  (product) => product.style === member.style && !product.planned,
                              ).id,
                          ],
                };
            },
        }).listen(0, '127.0.0.1');
        await new Promise((resolve) => server.once('listening', resolve));
        const base = 'http://127.0.0.1:' + server.address().port;
        const request = await authenticate(base, 'setup');
        const post = (path, body) =>
            request(base + '/api' + path, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
        const snapshot = async () => (await request(base + '/api/state')).json();
        const free = (state) =>
            state.members.filter(
                (member) =>
                    rules.canContact(member) &&
                    !state.tasks.some(
                        (task) => task.memberId === member.id && task.status !== 'rejected',
                    ),
            );
        let previewMember, greetingMember, draftId;
        await t.test('迁移可重复，保留任务并增加真实订单回访事实', async () => {
            const before = await snapshot();
            await initialize(pool);
            const current = await snapshot();
            assert.deepEqual(current.tasks, before.tasks);
            assert.equal(current.products.filter((product) => product.planned).length, 1);
            const groups = rules.opportunityGroups(
                current.members,
                current.tasks,
                current.products,
            );
            assert.ok(
                groups.care.length > 0 && groups.preview.length > 0 && groups.greeting.length > 0,
            );
            assert.equal(groups.scheduled.length, 0);
            assert.ok(
                groups.care.every(
                    (member) =>
                        member.recentNailVisit.days === 21 &&
                        member.careProfile.optIn,
                ),
            );
            const picks = rules.opportunityPicks(
                current.members,
                current.tasks,
                'all',
                current.products,
                8,
            );
            assert.equal(new Set(picks.map((pick) => pick.member.id)).size, 8);
            assert.ok(new Set(picks.map((pick) => pick.objective)).size >= 3);
        });
        await t.test('新品预告生成与审核保留具体产品；失效窗口拒绝执行', async () => {
            const state = await snapshot();
            previewMember = free(state).find(
                (member) => rules.matchingPreviews(member, state.products).length,
            );
            const product = rules.matchingPreviews(previewMember, state.products)[0];
            const response = await post('/copy/generate', {
                memberIds: [previewMember.id],
                model: state.ai.defaultModel,
                style: 'caring',
                context: { objective: 'preview', productId: product.id },
            });
            assert.equal(response.status, 200);
            const result = await response.json();
            assert.equal(result.items.length, 1, JSON.stringify(result.errors));
            draftId = result.items[0].id;
            const draft = (await snapshot()).copyDrafts.find((draft) => draft.id === draftId);
            assert.equal(draft.context.objective, 'preview');
            assert.deepEqual(draft.productIds, [product.id]);
            await post('/copy/' + draftId + '/save', { message: '已核对的新品预告，不承诺现货。' });
            const submitted = await post('/tasks/from-copy', { draftId });
            assert.equal(submitted.status, 200);
            const taskId = (await submitted.json()).taskId;
            assert.equal((await post('/tasks/from-copy', { draftId })).status, 409);
            assert.equal(
                (
                    await post('/tasks/' + taskId + '/review', {
                        decision: 'approve',
                        message: '已核对的新品预告，不承诺现货。',
                    })
                ).status,
                200,
            );
            await transaction(pool, (tx) =>
                tx
                    .query("UPDATE Members SET profile=jsonb_set(profile,'{lifecycle}',to_jsonb('dormant'::text)) WHERE id=$1", [previewMember.id]),
            );
            assert.equal(
                (await post('/tasks/' + taskId + '/execute', { scenario: 'booking' })).status,
                409,
            );
            await transaction(pool, (tx) =>
                tx
                    .query("UPDATE Members SET profile=jsonb_set(profile,'{lifecycle}',to_jsonb('active'::text)) WHERE id=$1", [previewMember.id]),
            );
            assert.equal(
                (await post('/tasks/' + taskId + '/execute', { scenario: 'booking' })).status,
                200,
            );
        });
        await t.test('问候无需产品，手写文案保存复制后提交实际内容', async () => {
            const state = await snapshot();
            greetingMember = free(state).find((member) => member.lifecycle === 'active');
            const context = { objective: 'greeting', productId: null };
            const response = await post('/copy/generate', {
                memberIds: [greetingMember.id],
                model: state.ai.defaultModel,
                context,
            });
            assert.equal(response.status, 200);
            const result = await response.json();
            assert.equal(result.items.length, 1);
            assert.deepEqual(
                result.state.copyDrafts.find((draft) => draft.id === result.items[0].id).productIds,
                [],
            );
            const manual = await post('/copy/manual', {
                memberId: greetingMember.id,
                message: '店主手写问候 <核对>',
                context,
            });
            assert.equal(manual.status, 200);
            const draftId = (await manual.json()).draftId;
            assert.equal(
                (await post('/copy/' + draftId + '/copied', { message: '店主手写问候 <核对>' }))
                    .status,
                200,
            );
            const task = await post('/tasks/from-copy', { draftId });
            assert.equal(task.status, 200);
            const saved = (await snapshot()).tasks.find((task) => task.id);
            assert.ok(saved);
            assert.ok(
                (await snapshot()).tasks.some(
                    (task) =>
                        task.message === '店主手写问候 <核对>' &&
                        task.context.objective === 'greeting' &&
                        task.context.productId === null,
                ),
            );
            const count = calls;
            assert.equal(
                (
                    await post('/copy/generate', {
                        memberIds: [greetingMember.id],
                        model: state.ai.defaultModel,
                        context: { objective: 'made-up' },
                    })
                ).status,
                400,
            );
            assert.equal(calls, count);
        });
        await t.test('定时回访可承接已执行任务，只执行一次并保存后续反馈', async () => {
            let state = await snapshot();
            const member = free(state).find((member) => member.contactDays >= 14);
            await transaction(pool, async (tx) => {
                const id = await store.insertTask(tx, rules.buildReviewTask(member, null));
                await store.updateTask(tx, id, 'executed_simulated', '旧演示任务', 'reply');
                await tx
                    .query("UPDATE Tasks SET context_json=jsonb_set(context_json,'{executedOn}',to_jsonb('2026-10-01'::text)) WHERE id=$1", [Number(id.slice(1))]);
                await store.insertCareRecord(tx, {
                    memberId: member.id,
                    outcome: '暂不联系',
                    note: '约好下月再问',
                    owner: '旧店长',
                    followUp: '2026-11-01',
                    recordedAsOf: '2026-10-01',
                });
            });
            state = await snapshot();
            assert.ok(
                rules
                    .opportunityCandidates(state.members, state.tasks, 'scheduled', state.products)
                    .some((candidate) => candidate.id === member.id),
            );
            const response = await post('/tasks', {
                opportunity: 'scheduled',
                memberIds: [member.id],
            });
            assert.equal(response.status, 200);
            const task = (await response.json()).state.tasks.at(-1);
            assert.equal(task.context.followUp, '2026-11-01');
            assert.equal(
                (
                    await post('/tasks/' + task.id + '/review', {
                        decision: 'approve',
                        message: '按约好的日期问候，先听本人意愿。',
                    })
                ).status,
                200,
            );
            assert.equal(
                (await post('/tasks/' + task.id + '/execute', { scenario: 'reply' })).status,
                200,
            );
            assert.equal(
                (await post('/tasks', { opportunity: 'scheduled', memberIds: [member.id] })).status,
                409,
            );
            const cared = await post('/care-records', {
                memberId: member.id,
                outcome: '未回复',
                note: '按约定回访，暂未回复',
                owner: '新店长',
                followUp: '2026-11-21',
            });
            assert.equal(cared.status, 200);
            const careState = (await cared.json()).state;
            assert.equal(
                careState.careRecords.find((record) => record.memberId === member.id).owner,
                '新店长',
            );
            assert.equal(
                careState.careRecords.filter((record) => record.memberId === member.id).length,
                2,
            );
        });
        await t.test('近期已模拟触达的会员不会立刻进入到期回访', async () => {
            const state = await snapshot(),
                member = free(state).find((member) => member.contactDays >= 14);
            await transaction(pool, async (tx) => {
                const id = await store.insertTask(tx, rules.buildReviewTask(member, null));
                await store.updateTask(tx, id, 'executed_simulated', '本次刚联系', 'reply');
                await store.insertCareRecord(tx, {
                    memberId: member.id,
                    outcome: '暂不联系',
                    note: '旧计划到期',
                    owner: '店主',
                    followUp: '2026-11-01',
                    recordedAsOf: '2026-10-01',
                });
            });
            const after = await snapshot();
            assert.equal(after.members.find((item) => item.id === member.id).contactDays, 0);
            assert.ok(
                !rules
                    .opportunityCandidates(after.members, after.tasks, 'scheduled', after.products)
                    .some((item) => item.id === member.id),
            );
            assert.equal(
                (await post('/tasks', { opportunity: 'scheduled', memberIds: [member.id] })).status,
                409,
            );
        });

        await t.test('性格自动匹配与临时语气传到生成器，草稿及审核任务保留语气快照', async () => {
            const state = await snapshot();
            const member = free(state).find((member) => rules.matchesOpportunity(member, 'greeting', state.products));
            assert.ok(member);
            for (const choice of ['auto', 'direct']) {
                const response = await post('/copy/generate', {
                    memberIds: [member.id], model: state.ai.defaultModel, style: choice,
                    context: { objective: 'greeting', productId: null },
                });
                assert.equal(response.status, 200);
                const result = await response.json();
                assert.equal(result.items.length, 1);
                const draft = result.state.copyDrafts.find((draft) => draft.id === result.items[0].id);
                assert.equal(generationStyles.at(-1).style, resolveCommunication(member, choice).id);
                assert.equal(draft.context.styleChoice, choice);
                assert.equal(draft.context.style, resolveCommunication(member, choice).id);
                assert.equal(draft.context.personalitySnapshot, member.personality);
                assert.equal(result.state.members.find((item) => item.id === member.id).personality, member.personality);
                if (choice === 'direct') {
                    const submitted = await post('/tasks/from-copy', { draftId: draft.id });
                    assert.equal(submitted.status, 200);
                    const body = await submitted.json();
                    const task = body.state.tasks.find((task) => task.id === body.taskId);
                    assert.equal(task.context.styleChoice, 'direct');
                    assert.equal(task.context.style, 'direct');
                    assert.equal(task.context.personalitySnapshot, member.personality);
                }
            }
        });
        await t.test('会员备注可新增编辑置顶，覆盖层保留原始来源资料', async () => {
            const memberId = 'M0001';
            let response = await post('/members/' + memberId + '/notes', {
                type: 'preference',
                text: '偏好短甲',
                pinned: false,
            });
            assert.equal(response.status, 200);
            let body = await response.json();
            const note = body.details.notes.find((note) => note.note_text === '偏好短甲');
            assert.ok(note);
            response = await post('/members/' + memberId + '/notes', {
                noteId: note.note_id,
                type: 'preference',
                text: '偏好短方圆甲',
                pinned: true,
            });
            assert.equal(response.status, 200);
            body = await response.json();
            assert.equal(body.details.notes[0].note_text, '偏好短方圆甲');
            assert.equal(
                (
                    await post('/members/M0002/notes', {
                        noteId: note.note_id,
                        type: 'preference',
                        text: '越权修改',
                        pinned: true,
                    })
                ).status,
                404,
            );
            await initialize(pool);
            const details = await (
                await request(base + '/api/members/' + memberId + '/details')
            ).json();
            assert.ok(details.notes.some((note) => note.note_text === '偏好短方圆甲'));
            const source = await transaction(
                pool,
                (tx) =>
                    tx
                        .query("SELECT COUNT(*) AS count FROM SourceRecords WHERE source_table='member_notes'"),
                'Shared',
            );
            assert.ok(source.rows[0].count > 0);
        });
    } finally {
        if (server) {
            server.closeAllConnections();
            await new Promise((resolve) => server.close(resolve));
        }
        await pool?.end();
        try {
            if (created)
                await master
                    .query(`DROP DATABASE "${name}" WITH (FORCE)`);
        } finally {
            await master.end();
        }
    }
});

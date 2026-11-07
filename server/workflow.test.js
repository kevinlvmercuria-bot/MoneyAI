'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { connect, transaction } = require('./db');
const { createApp } = require('./main');
const { initialize } = require('../database/setup');
const { importSource, readSource, mapMembers } = require('../database/import-source');
const aiCopy = require('./ai-copy');
const store = require('./store');
const { goalCandidates, SCENARIOS, DEMO_SERVICE_PRICE, CARE_OUTCOMES, canContact, productFor } = require('../public/rules');

test('SQL Server 最小业务闭环验收', { timeout: 90000 }, async (t) => {
    // 仅创建和清理本次随机命名的测试库，避免重置日常演示库。
    const database = 'NailMate_Acceptance_' + randomBytes(8).toString('hex');
    const master = await connect('master');
    let pool;
    let server;
    let created = false;
    try {
        await master.request().query(`CREATE DATABASE [${database}]`);
        created = true;
        pool = await connect(database);
        await initialize(pool);
        let generatorMode = 'valid';
        let failedMember = '';
        const generate = async ({member, products}) => {
            if (generatorMode === 'partial' && member.id === failedMember) throw new Error('模拟上游失败');
            const product = aiCopy.availableProducts(products).find((product) => product.style === member.style);
            return {
                message: `你好，有一款「${product.name}」想邀请你看看，需要帮你了解款式吗？`,
                reason: `结合${member.style}偏好进行推荐`,
                productIds: generatorMode === 'invalid' ? ['UNKNOWN_PRODUCT'] : [product.id],
            };
        };
        server = createApp(pool, {generateCopy: generate}).listen(0, '127.0.0.1');
        await new Promise((resolve, reject) => {
            server.once('listening', resolve);
            server.once('error', reject);
        });
        const base = 'http://127.0.0.1:' + server.address().port;
        const post = (path, body) => fetch(base + '/api' + path, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        const state = async () => {
            const response = await fetch(base + '/api/state');
            assert.equal(response.status, 200);
            return response.json();
        };

        await t.test('初始化可重复，页面可访问', async () => {
            await initialize(pool);
            const current = await state();
            assert.equal(current.members.length, 2800);
            assert.equal(current.tasks.length, 1);
            const html = await (await fetch(base)).text();
            assert.match(html, /workspace.js/);
        });

        await t.test('三类目标话术、筛选和授权拦截', async () => {
            for (const goal of ['wake', 'balance', 'launch']) {
                const before = await state();
                const candidates = goalCandidates(before.members, before.tasks, goal);
                assert.ok(candidates.length > 0 && candidates.length <= 5);
                assert.ok(!candidates.some((member) => member.id === 'M0003'));
                const response = await post('/tasks', { goal, memberIds: [candidates[0].id] });
                assert.equal(response.status, 200);
                const after = (await response.json()).state;
                const task = after.tasks.at(-1);
                assert.equal(task.goal, goal);
                const expected = { wake: /换款的计划/, balance: /账户还有/, launch: /款式图/ };
                assert.match(task.message, expected[goal]);
            }
            const before = await state();
            assert.equal((await post('/tasks', {goal:'general', memberIds:['M0003']})).status, 409);
            assert.deepEqual((await state()).tasks, before.tasks);
        });

        await t.test('非法字段与混合批次失败时没有部分写入', async () => {
            const before = await state();
            const candidate = goalCandidates(before.members, before.tasks, 'balance')[0];
            assert.equal((await post('/tasks', {goal:'balance',memberIds:[candidate.id,'M0003']})).status, 409);
            assert.equal((await post('/tasks', {goal:'balance',memberIds:[candidate.id,candidate.id]})).status, 400);
            assert.equal((await post('/tasks', {goal:'unknown',memberIds:[candidate.id]})).status, 400);
            assert.equal((await post('/tasks', null)).status, 400);
            const malformed = await fetch(base + '/api/tasks', {
                method:'POST',headers:{'Content-Type':'application/json'},body:'{invalid',
            });
            assert.equal(malformed.status, 400);
            assert.deepEqual((await state()).tasks, before.tasks);
        });

        await t.test('两个客户端同时入队只产生一条任务', async () => {
            const before = await state();
            const candidate = goalCandidates(before.members, before.tasks, 'balance')[0];
            const responses = await Promise.all([1,2].map(() => post('/tasks', {
                goal:'balance',memberIds:[candidate.id],
            })));
            assert.deepEqual(responses.map((response) => response.status).sort(), [200,409]);
            assert.equal((await state()).tasks.length, before.tasks.length + 1);
        });

        await t.test('空话术被拒绝，拒绝任务不能执行且可以重新入队', async () => {
            const task = (await state()).tasks.find((task) => task.status === 'pending_review');
            assert.equal((await post('/tasks/'+task.id+'/review', {decision:'approve',message:'  '})).status, 400);
            assert.equal((await post('/tasks/'+task.id+'/execute', {scenario:'visit'})).status, 409);
            assert.equal((await post('/tasks/'+task.id+'/review', {decision:'reject'})).status, 200);
            assert.equal((await post('/tasks/'+task.id+'/execute', {scenario:'visit'})).status, 409);
            assert.equal((await post('/tasks', {goal:'general',memberIds:[task.memberId]})).status, 200);
        });

        await t.test('四种结果保存准确，重复执行不会累计', async () => {
            for (const [scenario, expected] of Object.entries(SCENARIOS)) {
                const before = await state();
                const candidate = goalCandidates(before.members, before.tasks, 'balance')[0];
                const queued = await post('/tasks', {goal:'balance',memberIds:[candidate.id]});
                assert.equal(queued.status, 200);
                const task = (await queued.json()).state.tasks.at(-1);
                const path = '/tasks/'+task.id;
                assert.equal((await post(path+'/review', {decision:'approve',message:'保留修改 <预约>'})).status, 200);
                assert.equal((await post(path+'/execute', {scenario})).status, 200);
                assert.equal((await post(path+'/execute', {scenario})).status, 409);
                const saved = (await state()).tasks.find((item) => item.id === task.id);
                assert.equal(saved.editedMessage, '保留修改 <预约>');
                assert.deepEqual(saved.result, {
                    reply:expected.reply,booking:expected.booking,visit:expected.visit,
                    spending:expected.visit ? DEMO_SERVICE_PRICE : 0,
                });
            }
        });

        await t.test('重建数据库连接后任务与日志仍在', async () => {
            const expected = await state();
            const otherPool = await connect(database);
            try {
                const actual = await transaction(otherPool, store.state, 'Shared');
                assert.deepEqual(actual.tasks, expected.tasks);
                assert.deepEqual(actual.logs, expected.logs);
            } finally {
                await otherPool.close();
            }
        });

        await t.test('关怀字段、日期和资格校验失败时不写入', async () => {
            const before = await state();
            const candidate = goalCandidates(before.members, before.tasks, 'balance')[0];
            const body = {memberId:candidate.id,outcome:'已沟通',note:'明确反馈',owner:'店长',followUp:null};
            for (const invalid of [
                {...body,note:' '}, {...body,owner:' '}, {...body,outcome:'未知'},
                {...body,followUp:'2026-11-08'}, {...body,followUp:'2026-02-30'},
                {...body,followUp:'2026-12-35'}, {...body,followUp:42},
                {...body,outcome:'不再营销',followUp:'2026-11-21'},
                {...body,outcome:'推荐不合适',followUp:'2026-11-21'},
            ]) {
                assert.equal((await post('/care-records', invalid)).status, 400);
            }
            assert.equal((await post('/care-records', {...body,memberId:'M0003'})).status,409);
            assert.deepEqual((await state()).careRecords, []);
        });

        await t.test('五种关怀结果与计划落库，处理后退出推荐', async () => {
            for (const outcome of CARE_OUTCOMES) {
                const before = await state();
                const candidate = goalCandidates(before.members,before.tasks,'balance')[0];
                const followUp = ['已沟通','未回复','暂不联系'].includes(outcome) ? '2026-11-21' : null;
                const body = {memberId:candidate.id,outcome,note:'本人反馈 <稍后联系>',owner:'验收店长',followUp};
                const responses = await Promise.all([1,2].map(() => post('/care-records',body)));
                assert.deepEqual(responses.map((response)=>response.status).sort(),[200,409]);
                const current = await state();
                const record = current.careRecords.find((record)=>record.memberId===candidate.id);
                assert.equal(record.note,body.note);
                assert.equal(record.owner,body.owner);
                assert.equal(record.followUp,followUp);
                const member = current.members.find((member)=>member.id===candidate.id);
                assert.equal(member.careHandled,true);
                assert.ok(!goalCandidates(current.members,current.tasks,'balance').some((member)=>member.id===candidate.id));
                if (['已沟通','未回复'].includes(outcome)) assert.equal(member.contactDays,0);
                if (outcome==='暂不联系') assert.equal(canContact(member),false);
                if (outcome==='不再营销') assert.equal(member.consent,false);
            }
            const expected = await state();
            const otherPool = await connect(database);
            try {
                const actual = await transaction(otherPool,store.state,'Shared');
                assert.deepEqual(actual.careRecords,expected.careRecords);
                assert.deepEqual(actual.members,expected.members);
            } finally {
                await otherPool.close();
            }
        });

        await t.test('新增关怀限制后，已批准任务也不能执行', async () => {
            const current = await state();
            const candidate = goalCandidates(current.members,current.tasks,'balance')[0];
            const queued = await post('/tasks',{goal:'balance',memberIds:[candidate.id]});
            const task = (await queued.json()).state.tasks.at(-1);
            assert.equal((await post('/tasks/'+task.id+'/review',{decision:'approve',message:'关怀后重新校验资格'})).status,200);
            assert.equal((await post('/care-records',{memberId:candidate.id,outcome:'不再营销',note:'明确拒绝营销',owner:'店长'})).status,200);
            assert.equal((await post('/tasks/'+task.id+'/execute',{scenario:'visit'})).status,409);
            const saved = (await state()).tasks.find((item)=>item.id===task.id);
            assert.equal(saved.result,null);
        });

        await t.test('重置恢复初始会员资格并清空关怀和任务记录', async () => {
            const before = await state();
            const affectedId = before.careRecords[0].memberId;
            assert.equal((await post('/reset', {})).status, 200);
            const current = await state();
            assert.equal(current.members.length, 2800);
            assert.equal(current.tasks.length, 1);
            assert.equal(current.tasks[0].status, 'pending_review');
            assert.equal(current.tasks[0].goal, 'general');
            assert.deepEqual(current.logs, []);
            assert.deepEqual(current.careRecords, []);
            const member = current.members.find((member)=>member.id===affectedId);
            assert.equal(member.careHandled,false);
            assert.equal(canContact(member),true);
        });

        await t.test('来源数据库完整导入，保留业务记录并备份会员', async () => {
            const before = await state();
            const candidate = goalCandidates(before.members, before.tasks, 'balance')[0];
            assert.equal((await post('/care-records', {
                memberId: candidate.id, outcome: '暂不联系', note: '导入前记录', owner: '店长', followUp: null,
            })).status, 200);
            const existing = await state();
            const result = await importSource(pool);
            assert.equal(result.imported, true);
            assert.equal(result.counts.members, 2800);
            assert.equal(result.counts.products, 24);
            const current = await state();
            assert.deepEqual(current.tasks, existing.tasks);
            assert.deepEqual(current.careRecords, existing.careRecords);
            assert.deepEqual(current.logs, existing.logs);
            assert.equal(current.products.length, 24);
            assert.equal(current.dataSource.kind, 'sqlite_import');
            const expected = mapMembers(readSource().rows).find((member) => member.id === 'M0001');
            const actual = current.members.find((member) => member.id === 'M0001');
            assert.equal(actual.latestNote, expected.latestNote);
            assert.equal(actual.contactDays, expected.contactDays);
            const backup = await pool.request().query('SELECT COUNT(*) AS total FROM dbo.MemberProfileBackups');
            assert.equal(backup.recordset[0].total, 2800);
            const archived = await pool.request().query('SELECT COUNT(*) AS total FROM dbo.SourceRecords');
            assert.equal(archived.recordset[0].total, Object.values(result.counts).reduce((sum, value) => sum + value, 0));
            const repeated = await importSource(pool);
            assert.equal(repeated.imported, false);
            assert.deepEqual((await state()).tasks, existing.tasks);
        });

        await t.test('会员历史接口及导入目录的新产品用于实际任务', async () => {
            const details = await fetch(base + '/api/members/M0001/details');
            assert.equal(details.status, 200);
            const history = await details.json();
            assert.ok(history.orders.length > 0 && history.orders.length <= 10);
            assert.ok(history.notes.length > 0);
            assert.equal(history.careProfile.member_id, 'M0001');
            assert.equal((await fetch(base + '/api/members/M9999/details')).status, 404);
            const current = await state();
            const candidate = goalCandidates(current.members, current.tasks, 'launch', current.products)[0];
            assert.ok(candidate);
            const product = productFor(candidate, current.products, true);
            assert.equal(product.isNew, true);
            assert.equal(product.isActive, true);
            assert.equal(product.type, 'nail_style');
            const response = await post('/tasks', {goal:'launch',memberIds:[candidate.id]});
            assert.equal(response.status, 200);
            const task = (await response.json()).state.tasks.at(-1);
            assert.ok(task.message.includes(product.name));
            assert.ok(task.reason.includes(product.name));
        });

        let copyMembers, draftId, imageUrl;
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1cAAAAASUVORK5CYII=', 'base64');
        await t.test('AI 名单与模型校验，密钥不出现在状态响应', async () => {
            const current = await state();
            copyMembers = current.members.filter((member) => canContact(member) && !member.careHandled).slice(0,2);
            const model = current.ai.defaultModel;
            assert.ok(copyMembers.length === 2);
            if (process.env.AI_API_KEY) assert.equal(JSON.stringify(current).includes(process.env.AI_API_KEY), false);
            assert.equal((await post('/copy/generate',{memberIds:[],model})).status,400);
            assert.equal((await post('/copy/generate',{memberIds:[copyMembers[0].id],model:'unknown'})).status,400);
            const blocked = current.members.find((member) => !canContact(member));
            assert.equal((await post('/copy/generate',{memberIds:[blocked.id],model})).status,409);
        });

        await t.test('批量生成独立文案并持久保存，非法产品不落库', async () => {
            const current = await state();
            const body = {memberIds:copyMembers.map((member)=>member.id),model:current.ai.defaultModel};
            const response = await post('/copy/generate',body);
            assert.equal(response.status,200);
            const result = await response.json();
            assert.equal(result.items.length,2);
            assert.deepEqual(result.errors,[]);
            draftId = result.items[0].id;
            const saved = (await state()).copyDrafts;
            assert.equal(saved.length,2);
            assert.ok(saved.every((draft)=>draft.productIds.length===1));
            generatorMode = 'invalid';
            const invalid = await (await post('/copy/generate',body)).json();
            assert.equal(invalid.items.length,0);
            assert.equal(invalid.errors.length,2);
            assert.equal((await state()).copyDrafts.length,2);
            assert.throws(()=>aiCopy.parseResult('null',current.products),{apiStatus:502});
            generatorMode = 'partial';
            failedMember = copyMembers[0].id;
            const partial = await (await post('/copy/generate',body)).json();
            assert.equal(partial.items.length,1);
            assert.equal(partial.errors.length,1);
            generatorMode = 'valid';
        });

        await t.test('产品图片绑定、下载与替换，拒绝伪装及超限图片', async () => {
            const draft = (await state()).copyDrafts.find((draft)=>draft.id===draftId);
            const productId = draft.productIds[0];
            const upload = (id,data=png) => fetch(base+'/api/products/'+id+'/image',{
                method:'POST',headers:{'Content-Type':'image/png'},body:data,
            });
            assert.equal((await upload(productId,Buffer.from('this is not a png image'))).status,400);
            assert.equal((await upload('unknown')).status,404);
            assert.equal((await upload(productId,Buffer.alloc(5*1024*1024+1))).status,413);
            assert.equal((await upload(productId)).status,200);
            imageUrl = (await state()).products.find((product)=>product.id===productId).imageUrl;
            const image = await fetch(base+imageUrl+'?download=1');
            assert.equal(image.status,200);
            assert.match(image.headers.get('content-disposition'),/attachment/);
            assert.deepEqual(Buffer.from(await image.arrayBuffer()),png);
            assert.equal((await upload(productId)).status,200);
            assert.notEqual((await state()).products.find((product)=>product.id===productId).imageUrl,imageUrl);
            assert.equal((await fetch(base+imageUrl)).status,200);
        });

        await t.test('修改与复制单独记录，不改变任务结果和联系冷却', async () => {
            const before = await state();
            assert.equal((await post('/copy/'+draftId+'/save',{message:' '})).status,400);
            assert.equal((await post('/copy/'+draftId+'/save',{message:'店主修改 <邀请看图>'})).status,200);
            assert.equal((await post('/copy/'+draftId+'/copied',{message:'过期文案'})).status,409);
            assert.equal((await post('/copy/'+draftId+'/copied',{message:'店主修改 <邀请看图>'})).status,200);
            const after = await state();
            const draft = after.copyDrafts.find((draft)=>draft.id===draftId);
            assert.equal(draft.message,'店主修改 <邀请看图>');
            assert.notEqual(draft.originalMessage,draft.message);
            assert.ok(draft.copiedAt);
            assert.deepEqual(after.tasks,before.tasks);
            assert.deepEqual(after.members,before.members);
            await post('/care-records',{memberId:copyMembers[0].id,outcome:'不再营销',note:'本人拒绝',owner:'店长'});
            assert.equal((await post('/copy/'+draftId+'/copied',{message:'店主修改 <邀请看图>'})).status,409);
            assert.equal((await post('/reset',{})).status,200);
            assert.deepEqual((await state()).copyDrafts,[]);
            assert.equal((await fetch(base+imageUrl)).status,200);
        });
    } finally {
        if (server) {
            server.closeAllConnections();
            await new Promise((resolve) => server.close(resolve));
        }
        await pool?.close();
        try {
            if (created) {
                // ODBC 可能仍保留空闲会话，仅断开本次创建的临时库连接。
                await master.request().query(`ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${database}]`);
            }
        } finally {
            await master.close();
        }
    }
});

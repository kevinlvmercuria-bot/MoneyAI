'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PERSONALITY_STYLES, resolveCommunication, isCopyStyle } = require('../public/communication');
const ai = require('./legacy/ai-copy');

test('四类性格自动匹配，缺失和未知标签回退自然亲切', () => {
    for (const style of PERSONALITY_STYLES) {
        const resolved = resolveCommunication({ personality: style.label });
        assert.equal(resolved.id, style.id);
        assert.equal(resolved.personality, style.label);
        assert.equal(resolved.automatic, true);
    }
    for (const personality of ['', null, undefined, '未知标签', '__proto__'])
        assert.equal(resolveCommunication({ personality }).id, 'friendly');
    assert.equal(ai.metadata().defaultStyle, 'auto');
    assert.deepEqual(ai.metadata().styles.map((style) => style.id), ['auto', 'cute', 'gentle', 'direct', 'elegant']);
});

test('临时调整优先于会员性格，旧表达选项兼容且非法值拒绝', () => {
    const member = { personality: '可爱风' };
    assert.equal(resolveCommunication(member, 'direct').id, 'direct');
    assert.equal(member.personality, '可爱风');
    for (const id of ['friendly', 'concise', 'caring', 'professional'])
        assert.equal(resolveCommunication(member, id).id, id);
    for (const invalid of ['bad', '__proto__', null, 1, {}]) {
        assert.equal(isCopyStyle(invalid), false);
        assert.throws(() => resolveCommunication(member, invalid));
    }
});

test('真实生成入口发出的指令使用单一语气，保留目的与产品约束（受控响应）', async (t) => {
    const previousKey = process.env.AI_API_KEY;
    process.env.AI_API_KEY = 'test-only-not-a-real-key';
    const bodies = [];
    t.mock.method(globalThis, 'fetch', async (_url, request) => {
        bodies.push(JSON.parse(request.body));
        return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ message: '最近过得怎么样？有需要可以和我们聊聊。', reason: '按本次目的与沟通语气准备。', productIds: [] }) }] }), { status: 200 });
    });
    const member = { id: 'M0001', personality: '可爱风', consent: true, contactDays: 60, days: 20, visits: 10, lifecycle: 'active' };
    try {
        await ai.generateCopy({ member, products: [], model: 'test', style: 'auto', context: { objective: 'greeting', productId: null } });
        await ai.generateCopy({ member, products: [], model: 'test', style: 'direct', context: { objective: 'greeting', productId: null } });
        assert.match(bodies[0].system, /本次沟通语气：可爱风/);
        assert.match(bodies[1].system, /本次沟通语气：直爽风/);
        assert.doesNotMatch(bodies[1].system, /本次沟通语气：可爱风|可少量使用语气词/);
        assert.match(bodies[1].system, /不使用表情/);
        assert.match(bodies[1].system, /productIds必须为空数组/);
        assert.equal(JSON.parse(bodies[1].messages[0].content).member.personality, '可爱风');
        const before = bodies.length;
        await assert.rejects(ai.generateCopy({ member, products: [], model: 'test', style: 'bad' }), { apiStatus: 400 });
        assert.equal(bodies.length, before);
    } finally {
        if (previousKey === undefined) delete process.env.AI_API_KEY;
        else process.env.AI_API_KEY = previousKey;
    }
});

// 前后端共享同一套性格与沟通语气，避免页面展示和模型指令不一致。
const NailMateCommunication = (() => {
    const PERSONALITY_STYLES = [
        { id: 'cute', label: '可爱风', description: '轻快自然，少量语气词，避免过度亲昵。', instruction: '建议60至120字，表达轻快自然，可少量使用语气词和至多一个简单表情，不用夸张称呼，不堆砌颜文字。' },
        { id: 'gentle', label: '温柔风', description: '温和关心，尊重意愿，不催促决定。', instruction: '建议60至120字，语气轻柔舒缓，先关心本人需求，尊重联系意愿，不催促，不假定顾客有具体护理问题。' },
        { id: 'direct', label: '直爽风', description: '简短明确，重点前置，减少修饰。', instruction: '建议30至60字，一到两句话，重点前置，直接表达本次目的，不绕弯子，不使用表情、颜文字或多余语气词。' },
        { id: 'elegant', label: '优雅风', description: '用词克制，描述具体特点，避免夸张。', instruction: '建议60至120字，用词克制清晰，有具体产品时准确介绍款式特点，不用网络用语、颜文字或夸大赞美，不承诺效果。' },
    ];
    // 保留旧接口的显式选项；新工作台使用上面的四类语气和自动匹配。
    const LEGACY_STYLES = [
        { id: 'friendly', label: '自然亲切', description: '自然友好，保持适当距离。', instruction: '建议60至120字，像店主日常私聊一样自然亲切，不使用过度熟悉的称呼，也不强推。' },
        { id: 'concise', label: '简洁直接', instruction: '建议30至60字，一到两句话，直接表达本次目的，不使用表情符号，不堆砌修饰。' },
        { id: 'caring', label: '温柔关怀', instruction: '建议60至120字，温和询问近况，尊重顾客需求和联系意愿，不假定顾客存在具体护理问题。' },
        { id: 'professional', label: '专业推荐', instruction: '建议60至150字，准确介绍产品款式特点，表达清晰克制，不承诺医疗或服务效果。' },
    ];
    const DEFAULT_STYLE = 'auto';
    const styles = [...PERSONALITY_STYLES, ...LEGACY_STYLES];

    function personalityStyle(personality) {
        return PERSONALITY_STYLES.find((style) => style.label === personality) || null;
    }
    function isCopyStyle(id) {
        return typeof id === 'string' && (id === DEFAULT_STYLE || styles.some((style) => style.id === id));
    }
    function resolveCommunication(member, requested = DEFAULT_STYLE) {
        if (!isCopyStyle(requested)) throw new Error('请选择可用的沟通语气');
        const personality = personalityStyle(member?.personality);
        const selected = requested === DEFAULT_STYLE
            ? personality || LEGACY_STYLES[0]
            : styles.find((style) => style.id === requested);
        return { ...selected, requested, automatic: requested === DEFAULT_STYLE, personality: personality?.label || '' };
    }
    function personalityNote(personality) {
        const style = personalityStyle(personality);
        if (!style) throw new Error('模拟资料中的性格标签无效');
        return `性格：${style.label}。沟通偏好：${style.description}（模拟资料，规则推断）`;
    }
    return { PERSONALITY_STYLES, DEFAULT_STYLE, isCopyStyle, personalityStyle, resolveCommunication, personalityNote };
})();

if (typeof module !== 'undefined') module.exports = NailMateCommunication;
else globalThis.NailMateCommunication = NailMateCommunication;

const NailMateRules = (() => {
    'use strict';

    const MAX_TASKS_PER_ANALYSIS = 5;
    const PRODUCTS = [
        { id: 'P001', name: '奶油法式·初雪', style: '法式', price: 168 },
        { id: 'P002', name: '晚樱裸透·温柔粉', style: '裸色', price: 148 },
        { id: 'P003', name: '月光磁吸·猫眼', style: '猫眼', price: 198 },
        { id: 'P004', name: '清雾渐变·晨光', style: '渐变', price: 178 },
        { id: 'P005', name: '丝绒纯色·莓果', style: '纯色', price: 128 },
        { id: 'P006', name: '玉兰新中式·雅韵', style: '新中式', price: 228 },
    ];

    function money(n) {
        return '¥' + Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 });
    }

    const GOALS = {
        wake: { label: '沉睡唤醒', sortBy: 'ratio' },
        balance: { label: '余额提醒', sortBy: 'bal' },
        launch: { label: '新品邀约', sortBy: 'ratio' },
    };
    const SCENARIOS = {
        noReply: { label: '未回复', reply: false, booking: false, visit: false },
        reply: { label: '已回复，未预约', reply: true, booking: false, visit: false },
        booking: { label: '已预约，待到店', reply: true, booking: true, visit: false },
        visit: { label: '已到店并消费', reply: true, booking: true, visit: true },
    };
    const DEMO_SERVICE_PRICE = 168;

    function canContact(member) {
        return member.consent && !member.complaint && !member.appointment && member.contactDays >= 14;
    }
    function priorityScore(m) {
        return Math.min(
            99,
            Math.round(
                0.3 * Math.min(100, m.spend / 38) +
                    0.3 * Math.min(100, (m.ratio / 3.5) * 100) +
                    0.25 * 88 +
                    0.15 * (canContact(m) ? 100 : 0),
            ),
        );
    }
    function productFor(m) {
        return PRODUCTS.find((product) => product.style === m.style);
    }
    function matchesGoal(member, goal) {
        switch (goal) {
            case 'wake': return member.lifecycle === 'dormant';
            case 'balance': return member.bal > 0 && member.days > member.cycle;
            case 'launch':
                return ['due', 'low_frequency'].includes(member.lifecycle) && Boolean(productFor(member));
            default: return false;
        }
    }

    function goalReason(member, goal) {
        const timing = `${member.days} 天未到店 · 平均周期 ${member.cycle} 天`;
        if (goal === 'balance') return `${timing} · 储值余额 ${money(member.bal)}`;
        if (goal === 'launch') return `${timing} · 偏好${member.style} · 匹配「${productFor(member).name}」`;
        return `${timing} · 偏离 ${member.ratio} 倍`;
    }

    function buildReviewTask(member, taskId, goal = 'general') {
        const product = productFor(member);
        let message = `你好呀，上次做的${member.style}款式还喜欢吗？如果最近想换个新造型，欢迎来看看～`;
        if (goal === 'wake') {
            message = `你好呀，上次做的${member.style}款式还喜欢吗？最近有想换款的计划吗？想做的话我可以帮你看看预约时间。`;
        } else if (goal === 'balance') {
            message = `你好呀，你的美甲账户还有 ${money(member.bal)} 余额。如果近期想来做美甲，需要我帮你看看预约时间吗？`;
        } else if (goal === 'launch') {
            message = `你好呀，记得你上次选了${member.style}款式。店里最近有一款「${product.name}」，你想先看看款式图吗？`;
        }
        return {
            id: taskId,
            memberId: member.id,
            status: 'pending_review',
            goal,
            strategy: GOALS[goal]?.label || '通用演示',
            priority: priorityScore(member),
            message,
            reason: goalReason(member, goal),
            editedMessage: '',
            result: null,
        };
    }

    function goalCandidates(members, tasks, goal) {
        const sortBy = GOALS[goal].sortBy;
        const occupied = new Set(tasks.filter((task) => task.status !== 'rejected').map((task) => task.memberId));
        return members
            .filter((member) => matchesGoal(member, goal) && canContact(member) && !occupied.has(member.id))
            .sort((a, b) => b[sortBy] - a[sortBy] || a.id.localeCompare(b.id))
            .slice(0, MAX_TASKS_PER_ANALYSIS);
    }

    return {
        PRODUCTS, GOALS, SCENARIOS, DEMO_SERVICE_PRICE, MAX_TASKS_PER_ANALYSIS,
        money, canContact, priorityScore, productFor, matchesGoal, goalReason, goalCandidates, buildReviewTask,
    };
})();

if (typeof module !== 'undefined') module.exports = NailMateRules;

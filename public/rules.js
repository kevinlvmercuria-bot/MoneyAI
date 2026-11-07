const NailMateRules = (() => {
    'use strict';

    const MAX_TASKS_PER_ANALYSIS = 5;
    const DEMO_DATE = '2026-11-07';
    const CARE_OUTCOMES = ['已沟通', '未回复', '暂不联系', '推荐不合适', '不再营销'];
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
    const OPPORTUNITIES = {
        all: { label: '全部机会' },
        wake: { label: '沉睡唤醒' },
        repurchase: { label: '到期复购' },
        balance: { label: '储值关怀' },
        care: { label: '护理回访' },
        preview: { label: '新品预告' },
        scheduled: { label: '定时回访' },
        greeting: { label: '日常问候' },
    };
    const SCENARIOS = {
        noReply: { label: '未回复', reply: false, booking: false, visit: false },
        reply: { label: '已回复，未预约', reply: true, booking: false, visit: false },
        booking: { label: '已预约，待到店', reply: true, booking: true, visit: false },
        visit: { label: '已到店并消费', reply: true, booking: true, visit: true },
    };
    const DEMO_SERVICE_PRICE = 168;

    function canContact(member) {
        return (
            member.consent &&
            !member.complaint &&
            !member.appointment &&
            !member.carePaused &&
            member.contactDays >= 14
        );
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
    function productFor(m, products = PRODUCTS, newOnly = false) {
        return products.find(
            (product) =>
                product.style === m.style &&
                product.isActive !== false &&
                (!product.type || product.type === 'nail_style') &&
                (!newOnly || product.isNew !== false) &&
                (!product.launchDate || product.launchDate <= DEMO_DATE),
        );
    }
    function matchesGoal(member, goal, products = PRODUCTS) {
        switch (goal) {
            case 'wake':
                return member.lifecycle === 'dormant';
            case 'balance':
                return member.bal > 0 && member.days > member.cycle;
            case 'launch':
                return (
                    ['due', 'low_frequency'].includes(member.lifecycle) &&
                    Boolean(productFor(member, products, true))
                );
            default:
                return false;
        }
    }

    function goalReason(member, goal, products = PRODUCTS) {
        const timing = `${member.days} 天未到店 · 平均周期 ${member.cycle} 天`;
        if (goal === 'balance') return `${timing} · 储值余额 ${money(member.bal)}`;
        if (goal === 'launch')
            return `${timing} · 偏好${member.style} · 匹配「${productFor(member, products, true).name}」`;
        return `${timing} · 偏离 ${member.ratio} 倍`;
    }

    function buildReviewTask(member, taskId, goal = 'general', products = PRODUCTS) {
        const product = productFor(member, products, goal === 'launch');
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
            reason: goalReason(member, goal, products),
            editedMessage: '',
            result: null,
        };
    }

    function goalCandidates(members, tasks, goal, products = PRODUCTS) {
        const sortBy = GOALS[goal].sortBy;
        const occupied = new Set(
            tasks.filter((task) => task.status !== 'rejected').map((task) => task.memberId),
        );
        return members
            .filter(
                (member) =>
                    matchesGoal(member, goal, products) &&
                    canContact(member) &&
                    !member.careHandled &&
                    !occupied.has(member.id),
            )
            .sort((a, b) => b[sortBy] - a[sortBy] || a.id.localeCompare(b.id))
            .slice(0, MAX_TASKS_PER_ANALYSIS);
    }

    const PLANNED_PRODUCTS = [
        {
            id: 'IDEA-SEA-SALT',
            name: '海盐冰气泡',
            type: 'nail_style',
            style: '清透灵感',
            description: '清透海盐蓝底色，搭配细小气泡与冰透光泽。',
            planned: true,
            isActive: true,
            launchDate: '2026-11-14',
            previewStyles: ['裸色'],
            price: null,
        },
    ];
    const OBJECTIVES = {
        wake: '个性化唤醒',
        repurchase: '复购邀请',
        balance: '储值关怀',
        launch: '新品推荐',
        care: '护理关怀',
        preview: '新品预告',
        scheduled: '定时回访',
        greeting: '日常问候',
    };
    const OPPORTUNITY_PRIORITY = [
        'scheduled',
        'preview',
        'greeting',
        'care',
        'wake',
        'repurchase',
        'balance',
    ];
    const daysBetween = (later, earlier) =>
        Math.floor((Date.parse(later) - Date.parse(earlier)) / 86400000);
    const noProductObjective = (objective) => ['scheduled', 'greeting'].includes(objective);
    function matchingPreviews(member, products) {
        if (member.lifecycle !== 'active') return [];
        return products
            .filter(
                (product) =>
                    product.isActive !== false &&
                    product.type === 'nail_style' &&
                    product.launchDate > DEMO_DATE &&
                    daysBetween(product.launchDate, DEMO_DATE) <= 14 &&
                    (product.previewStyles || [product.style]).some((style) =>
                        [member.style, member.secondary].includes(style),
                    ),
            )
            .sort((a, b) => a.launchDate.localeCompare(b.launchDate) || a.id.localeCompare(b.id));
    }
    function dueFollowup(member) {
        const record = member.followupRecord;
        return record?.followUp &&
            record.followUp <= DEMO_DATE &&
            ['已沟通', '未回复', '暂不联系'].includes(record.outcome) &&
            !member.executedFollowups?.includes(record.followUp)
            ? record
            : null;
    }
    function canContactFor(member, objective) {
        if (objective !== 'scheduled') return canContact(member);
        const due = dueFollowup(member);
        return Boolean(
            due &&
                member.consent &&
                !member.complaint &&
                !member.appointment &&
                member.contactDays >= 14 &&
                (!member.carePaused || due.outcome === '暂不联系'),
        );
    }
    function matchesOpportunity(member, opportunity, products = []) {
        if (opportunity === 'wake') return member.lifecycle === 'dormant';
        if (opportunity === 'repurchase')
            return ['due', 'low_frequency'].includes(member.lifecycle);
        if (opportunity === 'balance') return member.ratio > 1.15 && member.bal > 0;
        if (opportunity === 'care')
            return Boolean(
                member.recentNailVisit &&
                    member.recentNailVisit.days >= 1 &&
                    member.recentNailVisit.days <= 7 &&
                    member.careProfile?.optIn === true,
            );
        if (opportunity === 'preview') return matchingPreviews(member, products).length > 0;
        if (opportunity === 'greeting')
            return member.lifecycle === 'active' && member.visits >= 2 && member.contactDays >= 30;
        if (opportunity === 'scheduled') return Boolean(dueFollowup(member));
        return (
            opportunity === 'all' &&
            OPPORTUNITY_PRIORITY.some((key) => matchesOpportunity(member, key, products))
        );
    }
    function opportunityGroups(members, tasks, products = []) {
        const groups = Object.fromEntries(OPPORTUNITY_PRIORITY.map((key) => [key, []]));
        const occupied = new Set(
            tasks.filter((task) => task.status !== 'rejected').map((task) => task.memberId),
        );
        const active = new Set(
            tasks
                .filter((task) => ['pending_review', 'approved'].includes(task.status))
                .map((task) => task.memberId),
        );
        for (const member of members) {
            if (!active.has(member.id) && canContactFor(member, 'scheduled'))
                groups.scheduled.push(member);
            if (!canContact(member) || member.careHandled || occupied.has(member.id)) continue;
            for (const key of OPPORTUNITY_PRIORITY)
                if (key !== 'scheduled' && matchesOpportunity(member, key, products))
                    groups[key].push(member);
        }
        return groups;
    }
    function availableOpportunityMembers(members, tasks, products = []) {
        return [
            ...new Map(
                Object.values(opportunityGroups(members, tasks, products))
                    .flat()
                    .map((member) => [member.id, member]),
            ).values(),
        ];
    }
    function sortOpportunity(members, objective, products = []) {
        return [...members].sort((a, b) => {
            let rank;
            if (objective === 'scheduled')
                rank = dueFollowup(a).followUp.localeCompare(dueFollowup(b).followUp);
            else if (objective === 'care') rank = a.recentNailVisit.days - b.recentNailVisit.days;
            else if (objective === 'preview')
                rank =
                    matchingPreviews(a, products)[0].launchDate.localeCompare(
                        matchingPreviews(b, products)[0].launchDate,
                    ) || a.days - b.days;
            else if (objective === 'greeting')
                rank = b.contactDays - a.contactDays || b.visits - a.visits;
            else
                rank =
                    priorityScore(b) - priorityScore(a) ||
                    Math.min(b.ratio, 4) - Math.min(a.ratio, 4);
            return rank || a.id.localeCompare(b.id);
        });
    }
    function opportunityPicks(members, tasks, opportunity, products = [], limit = 8) {
        const groups = opportunityGroups(members, tasks, products);
        if (opportunity !== 'all')
            return sortOpportunity(groups[opportunity] || [], opportunity, products)
                .slice(0, limit)
                .map((member) => ({ member, objective: opportunity }));
        const seen = new Set();
        const queues = OPPORTUNITY_PRIORITY.map((objective) =>
            sortOpportunity(groups[objective], objective, products)
                .filter((member) => {
                    if (seen.has(member.id)) return false;
                    seen.add(member.id);
                    return true;
                })
                .map((member) => ({ member, objective })),
        );
        const picks = [];
        for (let offset = 0; offset < limit; offset++) {
            for (const queue of queues) {
                if (queue[offset]) picks.push(queue[offset]);
                if (picks.length === limit) return picks;
            }
        }
        return picks;
    }
    function opportunityCandidates(members, tasks, opportunity, products = []) {
        return opportunityPicks(members, tasks, opportunity, products).map((pick) => pick.member);
    }
    function opportunityFor(member, opportunity, products = []) {
        return opportunity !== 'all'
            ? opportunity
            : OPPORTUNITY_PRIORITY.find(
                  (key) => canContactFor(member, key) && matchesOpportunity(member, key, products),
              ) || 'repurchase';
    }
    function workbenchProducts(member, objective, products) {
        if (noProductObjective(objective)) return [];
        if (objective === 'preview') return matchingPreviews(member, products);
        const available = products.filter(
            (product) =>
                !product.planned &&
                product.isActive !== false &&
                (!product.launchDate || product.launchDate <= DEMO_DATE),
        );
        if (objective === 'care')
            return available
                .filter((product) => ['care_service', 'care_product'].includes(product.type))
                .sort(
                    (a, b) =>
                        Number(b.name === member.careProfile?.preferredService) -
                        Number(a.name === member.careProfile?.preferredService),
                );
        return available
            .filter(
                (product) =>
                    (!product.type || product.type === 'nail_style') &&
                    (!['launch'].includes(objective) || product.isNew !== false),
            )
            .sort((a, b) => Number(b.style === member.style) - Number(a.style === member.style));
    }
    function opportunityProduct(member, opportunity, products = PRODUCTS) {
        return workbenchProducts(
            member,
            opportunityFor(member, opportunity, products),
            products,
        )[0];
    }
    function opportunityEvidence(member, objective, product) {
        const record = dueFollowup(member);
        if (objective === 'scheduled')
            return record
                ? `计划回访日期 ${record.followUp} · 负责人 ${record.owner} · 先确认上次反馈是否还需要协助`
                : '暂无到期且符合联系间隔的计划';
        if (objective === 'preview')
            return product
                ? `活跃会员 · 偏好匹配 · 「${product.name}」演示计划于 ${product.launchDate} 上架，先询问是否想看款`
                : '没有匹配且临近上架的预告款式';
        if (objective === 'greeting')
            return `活跃会员 · 历史到店 ${member.visits} 次 · ${member.contactDays >= 10000 ? '暂无主动联系记录' : `距上次联系 ${member.contactDays} 天`} · 简短问候，听听近况`;
        if (objective === 'care') {
            const visit = member.recentNailVisit;
            return visit
                ? `${visit.date} 做了「${visit.name}」 · 已过 ${visit.days} 天 · 已同意回访，先询问佩戴体验`
                : '暂无服务后 1–7 天的美甲订单';
        }
        if (objective === 'balance')
            return `${member.days} 天未到店 · 储值余额 ${money(member.bal)} · 先提醒已有权益`;
        return `${member.days} 天未到店 · 平均周期 ${member.cycle} 天 · 偏离 ${member.ratio} 倍 · 偏好${member.style}`;
    }
    function opportunityAction(member, objective, product) {
        if (objective === 'scheduled') return '按计划回访，确认上次反馈';
        if (objective === 'greeting') return '发一句亲切问候，听听近况';
        if (objective === 'preview')
            return product ? `分享「${product.name}」预告` : '先确认想看的款式';
        if (objective === 'care') return '先询问美甲后的佩戴体验';
        if (objective === 'balance') return `可用余额 ${money(member.bal)}`;
        return product ? `推荐 ${product.name}` : '先了解需求';
    }
    function buildOpportunityTask(member, opportunity, products = PRODUCTS) {
        const selected = opportunityFor(member, opportunity, products),
            product = opportunityProduct(member, selected, products);
        const task = buildReviewTask(
            member,
            null,
            ['wake', 'balance'].includes(selected) ? selected : 'general',
            products,
        );
        task.strategy = OPPORTUNITIES[selected]?.label || OBJECTIVES[selected];
        task.reason = opportunityEvidence(member, selected, product);
        task.context = {
            objective: selected,
            productId: product?.id || null,
            followUp: dueFollowup(member)?.followUp || null,
        };
        if (selected === 'repurchase')
            task.message = `你好呀，记得你喜欢${member.style}款式，近期想换个新款吗？${product ? `有一款「${product.name}」，想先看看图吗？` : '想先了解一下你最近喜欢的款式。'}`;
        if (selected === 'care')
            task.message =
                '你好呀，想问问这次美甲佩戴是否舒服，甲面和甲缘状态怎么样？如有需要，可以告诉我们，一起看看如何护理。';
        if (selected === 'greeting')
            task.message =
                '你好呀，最近过得怎么样？想到你就来问候一下，有什么美甲方面想了解的，随时和我们说就好。';
        if (selected === 'scheduled')
            task.message =
                '你好呀，按之前约好的时间来问候一下，上次聊到的事情，现在还需要我们帮忙吗？';
        if (selected === 'preview')
            task.message = `你好呀，有一款「${product?.name || '新款'}」计划在 ${product?.launchDate || '近期'} 上架，感觉和你喜欢的风格挺搭，想先看看示意图吗？`;
        return task;
    }

    return {
        PRODUCTS,
        GOALS,
        SCENARIOS,
        DEMO_SERVICE_PRICE,
        MAX_TASKS_PER_ANALYSIS,
        DEMO_DATE,
        CARE_OUTCOMES,
        money,
        canContact,
        priorityScore,
        productFor,
        matchesGoal,
        goalReason,
        goalCandidates,
        buildReviewTask,
        PLANNED_PRODUCTS,
        OBJECTIVES,
        OPPORTUNITY_PRIORITY,
        noProductObjective,
        matchingPreviews,
        dueFollowup,
        canContactFor,
        opportunityGroups,
        opportunityPicks,
        workbenchProducts,
        opportunityEvidence,
        opportunityAction,
        OPPORTUNITIES,
        availableOpportunityMembers,
        matchesOpportunity,
        opportunityCandidates,
        opportunityFor,
        opportunityProduct,
        buildOpportunityTask,
    };
})();

if (typeof module !== 'undefined') module.exports = NailMateRules;
else globalThis.NailMateRules = NailMateRules;

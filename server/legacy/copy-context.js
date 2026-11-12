'use strict';
const {
    OBJECTIVES,
    DEMO_DATE,
    canContact,
    canContactFor,
    matchesOpportunity,
    dueFollowup,
    noProductObjective,
    workbenchProducts,
} = require('../../public/rules');

function fail(condition, message, status = 409) {
    if (!condition) throw Object.assign(new Error(message), { apiStatus: status });
}

function resolveContext(member, products, context) {
    if (context === undefined || context === null) return null;
    fail(
        context &&
            typeof context === 'object' &&
            !Array.isArray(context) &&
            typeof context.objective === 'string' &&
            Object.hasOwn(OBJECTIVES, context.objective),
        '请选择有效的沟通目的',
        400,
    );
    const objective = context.objective;
    fail(canContactFor(member, objective), '当前会员不符合本次沟通资格');
    if (['care', 'preview', 'scheduled'].includes(objective))
        fail(
            matchesOpportunity(member, objective, products),
            '当前会员不符合该目的的资格或时间窗口',
        );
    if (objective === 'scheduled' && context.followUp !== undefined)
        fail(context.followUp === dueFollowup(member).followUp, '回访计划已变化，请重新准备');
    const catalog = workbenchProducts(member, objective, products);
    let productId = context.productId ?? null;
    fail(productId === null || typeof productId === 'string', '产品编号无效', 400);
    if (noProductObjective(objective)) fail(productId === null, '问候或定时回访无需绑定产品', 400);
    else {
        productId = productId || catalog[0]?.id;
        fail(
            catalog.some((product) => product.id === productId),
            '所选产品已不可用或不符合本次目的',
        );
    }
    return {
        objective,
        productId,
        followUp: objective === 'scheduled' ? dueFollowup(member).followUp : null,
    };
}

function generationCatalog(member, products, context) {
    if (!context)
        return products.filter(
            (product) =>
                product.isActive !== false &&
                !product.planned &&
                (!product.launchDate || product.launchDate <= DEMO_DATE),
        );
    if (noProductObjective(context.objective)) return [];
    return workbenchProducts(member, context.objective, products).filter(
        (product) => product.id === context.productId,
    );
}
module.exports = { resolveContext, generationCatalog };

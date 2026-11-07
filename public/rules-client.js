// 共用规则保留后端 CommonJS 契约，浏览器只在此处读取兼容导出。
import './rules.js';

export const {
    GOALS,
    SCENARIOS,
    DEMO_SERVICE_PRICE,
    money,
    canContact,
    priorityScore,
    productFor,
    matchesGoal,
    goalReason,
    goalCandidates,
    buildReviewTask,
    DEMO_DATE,
    CARE_OUTCOMES,
} = globalThis.NailMateRules;

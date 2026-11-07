'use strict';

const { PRODUCTS, DEMO_DATE } = require('../public/rules');
const STYLES = PRODUCTS.map((product) => product.style);



// 固定种子让每次打开页面时都能复现同一批会员。
let seed = 20261107;
function nextRandom() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
}
function randomInt(min, max) {
    return min + Math.floor(nextRandom() * (max - min + 1));
}
function dateBeforeDemo(days) {
    const date = new Date(DEMO_DATE);
    date.setUTCDate(date.getUTCDate() - days);
    return date.toISOString().slice(0, 10);
}
function classifyLifecycle(ratio) {
    if (ratio <= 1.15) return 'active';
    if (ratio <= 1.65) return 'due';
    if (ratio <= 2.4) return 'low_frequency';
    return 'dormant';
}

const members = [];
for (let i = 1; i <= 2800; i++) {
    const cycle = randomInt(19, 44),
        days = randomInt(2, 173),
        visits = randomInt(1, 15),
        spend = visits * randomInt(95, 220),
        bal = nextRandom() < 0.32 ? randomInt(1, 12) * 50 : 0,
        style = STYLES[randomInt(0, 5)],
        contactDays = randomInt(0, 85),
        consent = nextRandom() > 0.09,
        complaint = nextRandom() < 0.035,
        appointment = nextRandom() < 0.078,
        ratio = +(days / Math.max(cycle, 14)).toFixed(2);
    const m = {
        id: 'M' + String(i).padStart(4, '0'),
        days,
        cycle,
        visits,
        spend,
        bal,
        style,
        secondary: STYLES[(STYLES.indexOf(style) + 1) % 6],
        contactDays,
        consent,
        complaint,
        appointment,
        ratio,
        lifecycle: classifyLifecycle(ratio),
        lastVisit: dateBeforeDemo(days),
        level: spend >= 1800 ? '金卡会员' : spend >= 900 ? '银卡会员' : '普通会员',
    };
    members.push(m);
}
// 首位会员用于固定的展位演示流程。
const demoMember = members[0];
Object.assign(demoMember, {
    days: 96,
    cycle: 31,
    visits: 8,
    spend: 2460,
    bal: 420,
    style: '法式',
    secondary: '裸色',
    contactDays: 40,
    consent: true,
    complaint: false,
    appointment: false,
    ratio: 3.1,
    lifecycle: 'dormant',
    lastVisit: dateBeforeDemo(96),
    level: '金卡会员',
});
// 固定候选覆盖三种策略，并提供一个因未授权被拦截的样本。
Object.assign(members[1], demoMember, { id: 'M0002', bal: 880 });
Object.assign(members[2], demoMember, { id: 'M0003', bal: 980, consent: false });
Object.assign(members[3], demoMember, {
    id: 'M0004', days: 42, cycle: 30, ratio: 1.4,
    lifecycle: 'due', style: '猫眼', bal: 0, lastVisit: dateBeforeDemo(42),
});
Object.assign(members[4], demoMember, {
    id: 'M0005', days: 200, cycle: 19, ratio: 10.53,
    bal: 0, lastVisit: dateBeforeDemo(200),
});

module.exports = { members, demoMember };

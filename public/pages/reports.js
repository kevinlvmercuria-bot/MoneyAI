import { state } from '../state.js';
import { GOALS, money } from '../rules-client.js';
import { escapeHtml, head, icon, num } from '../components.js';

function reports() {
    const scopedTasks =
        state.reportGoal === 'all'
            ? state.tasks
            : state.tasks.filter((task) => (task.goal || 'general') === state.reportGoal);
    const tabs = [
        ['all', '全部目标'],
        ...Object.entries(GOALS).map(([key, goal]) => [key, goal.label]),
        ['general', '通用演示'],
    ]
        .map(
            ([key, label]) =>
                `<button class="filterbtn ${state.reportGoal === key ? 'active' : ''}" aria-pressed="${state.reportGoal === key}" data-report-goal="${key}">${label}</button>`,
        )
        .join('');
    const sent = scopedTasks.filter((t) => t.status === 'executed_simulated'),
        reply = sent.filter((t) => t.result.reply).length,
        booked = sent.filter((t) => t.result.booking).length,
        visited = sent.filter((t) => t.result.visit).length,
        amt = sent.reduce((s, t) => s + t.result.spending, 0),
        stat = [
            ['模拟触达', sent.length],
            ['模拟回复', reply],
            ['模拟预约', booked],
            ['模拟到店', visited],
            ['模拟消费', money(amt)],
        ],
        entries = [
            ['创建任务', scopedTasks.length],
            [
                '审核通过',
                scopedTasks.filter((t) => ['approved', 'executed_simulated'].includes(t.status)).length,
            ],
            ['模拟触达', sent.length],
            ['模拟回复', reply],
            ['模拟预约', booked],
            ['模拟到店', visited],
        ];
    return `${head('经营效果复盘', 'PERFORMANCE & INSIGHTS', '每一步都有记录：从会员分析、审核到模拟触达与效果追踪。', `<button class="btn outline" data-action="reset">${icon('clock')} 重置演示</button>`)}<div class="alert">注意：以下转化、到店及消费数据仅由演示情景规则模拟，不代表真实营销效果、真实收入或经过验证的增量。未设置对照组。</div><div class="goal-tabs" aria-label="复盘经营目标">${tabs}</div><div class="report-row">${stat.map(([l, v]) => `<div class="rep-stat"><span>${l}</span><b>${typeof v === 'number' ? num(v) : v}</b></div>`).join('')}</div><div class="dashboard-grid"><div class="panel"><div class="panel-head"><h3>经营漏斗 · 演示场景</h3><span>会员人数 / 任务数</span></div>${entries.map(([l, n]) => `<div class="statbar"><label>${l}</label><div><div style="width:${Math.round((n / Math.max(1, scopedTasks.length)) * 100)}%"></div></div><strong>${num(n)}</strong></div>`).join('')}<p class="notice">按所选经营目标统计任务；触达及后续阶段仅统计已模拟执行的任务。</p></div><div class="panel"><div class="panel-head"><h3>模拟操作记录</h3><span>记录演示数据库中的操作</span></div><div class="logs">${state.logs.length ? state.logs.map((l) => `<div class="logitem"><b>[${escapeHtml(l.time)}] ${escapeHtml(l.name)}</b><br/>${escapeHtml(l.desc)}</div>`).join('') : '尚未执行任何页面操作。试着点击「运行模拟经营分析」。'}</div><div class="separator"></div><div class="care-card" style="min-height:130px;padding:18px"><h3 style="font-size:16px">如何理解经营增量？</h3><p>真正的增量消费需要与未触达的对照组比较；储值余额消费也不等于新增现金流。</p></div></div></div>`;
}

export { reports };

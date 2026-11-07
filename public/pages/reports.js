import { state } from '../state.js';
import { GOALS, money } from '../rules-client.js';
import { escapeHtml, num, planProgress } from '../components.js';
import { careHistory } from './care.js';

function reports() {
    const scoped = state.tasks;
    const sent = scoped.filter((task) => task.status === 'executed_simulated');
    const stages = [
        ['已模拟触达', sent.length],
        ['有回复', sent.filter((task) => task.result.reply).length],
        ['有预约', sent.filter((task) => task.result.booking).length],
        ['已到店', sent.filter((task) => task.result.visit).length],
    ];
    const amount = sent.reduce((sum, task) => sum + task.result.spending, 0);
    return `<div class="growth-result-heading"><h2>问候之后，有没有再回来？</h2><p>只统计已人工批准并模拟执行的任务。模拟结果不是实际转化，也不能证明营销带来了增量。</p></div>${planProgress(state.tasks)}
        <div class="growth-result-funnel">${stages.map(([label, n], i) => `<div class="rep-stat"><span>${label}</span><b>${num(n)}</b><small>${i ? '顾客反应 · 模拟情景' : '已人工批准并模拟执行'}</small></div>`).join('')}</div><section class="growth-consumption"><div class="rep-stat"><span>模拟到店消费</span><b>${money(amount)}</b></div><p>只有「已到店并消费」情景计入模拟消费。储值余额本身不计为收入；未设置对照组，不展示未经验证的增量。</p></section>
        <section class="section-spacer"><h3 class="growth-member-results">每位会员，跟到下一步</h3>${
            sent.length
                ? `<div class="table-wrap"><table><thead><tr><th>会员</th><th>沟通目标</th><th>模拟进展</th><th>模拟消费</th><th>下一步</th></tr></thead><tbody>${sent
                      .map((task) => {
                          const member = state.members.find(
                                  (member) => member.id === task.memberId,
                              ),
                              result = task.result;
                          const next = result.visit
                              ? '记录服务体验与后续护理'
                              : result.booking
                                ? '确认方便的时间，不重复营销'
                                : result.reply
                                  ? '了解需求，记录顾客明确反馈'
                                  : '等待回复，遵守联系间隔';
                          return `<tr><td>${escapeHtml(member?.displayName || task.memberId)}<br><small>${task.memberId}</small></td><td>${escapeHtml(task.strategy)}</td><td>${result.visit ? '已到店' : result.booking ? '已预约' : result.reply ? '已回复' : '暂未回复'}</td><td>${money(result.spending)}</td><td class="wrap">${next}<br><button data-action="prepare-care" data-id="${task.memberId}">记录反馈</button></td></tr>`;
                      })
                      .join('')}</tbody></table></div>`
                : '<div class="empty">还没有执行结果。先完成「生成计划 → 人工审核 → 模拟触达」。<p><button data-view="dashboard">去准备复购计划</button><button data-view="campaigns">去任务审核</button></p></div>'
        }</section>
        <section class="section-spacer"><h3>哪一种沟通更适合继续验证？</h3><div class="table-wrap"><table><thead><tr><th>沟通策略</th><th>已创建</th><th>模拟触达</th><th>模拟预约</th><th>模拟消费</th></tr></thead><tbody>${[
            ...new Set(state.tasks.map((task) => task.strategy)),
        ]
            .map((strategy) => {
                const list = state.tasks.filter((task) => task.strategy === strategy);
                return `<tr><td>${escapeHtml(strategy)}</td><td>${list.length}</td><td>${list.filter((task) => task.status === 'executed_simulated').length}</td><td>${list.filter((task) => task.result?.booking).length}</td><td>${money(list.reduce((sum, task) => sum + (task.result?.spending || 0), 0))}</td></tr>`;
            })
            .join(
                '',
            )}</tbody></table></div><p class="helper">结果均为手动选择的模拟情景，不代表真实营销效果或经过验证的增量。</p></section>
        <section class="section-spacer"><h3>顾客反馈与后续计划</h3>${careHistory()}</section>`;
}

export { reports };

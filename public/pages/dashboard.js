import { state } from '../state.js';
import {
    OPPORTUNITIES,
    OBJECTIVES,
    opportunityGroups,
    opportunityPicks,
    opportunityProduct,
    opportunityEvidence,
    opportunityAction,
} from '../rules-client.js';
import { LIFECYCLE_LABELS, escapeHtml, num, planProgress } from '../components.js';

export function dashboard() {
    const groups = opportunityGroups(state.members, state.tasks, state.products);
    const total = new Set(
        Object.values(groups)
            .flat()
            .map((member) => member.id),
    ).size;
    const picks = opportunityPicks(
        state.members,
        state.tasks,
        state.selectedOpportunity,
        state.products,
        state.planLimit,
    );
    const count =
        state.selectedOpportunity === 'all' ? total : groups[state.selectedOpportunity].length;
    const careMode = state.selectedOpportunity === 'care',
        followMode = careMode || state.selectedOpportunity === 'scheduled';
    return `<section class="growth-intro"><div><h2>${picks.length ? `今天，先${followMode ? '回访' : '联系'}这 ${picks.length} 位会员。` : '暂无符合条件的待联系会员。'}</h2><p>从 <strong>${num(state.members.length)}</strong> 位会员中，${careMode ? '按美甲服务订单筛选服务后第 1–7 天、已同意回访的顾客。<br>先问佩戴体验，审核后再联系。' : '按上架计划、顾客偏好、回访日期和到店情况准备。<br>每位会员都有一条联系理由和一个建议行动，审核后再联系。'}</p></div><div class="glass-track"><aside class="growth-daily-note glass-tilt glass-surface"><p><strong>${num(count)}</strong> 位${followMode ? '待回访' : '待经营'} · 本次安排 ${picks.length} 人</p><small>已排除联系限制、已排队和本次已处理的会员</small><button class="primary" data-action="queue-goal" ${picks.length ? '' : 'disabled'}>${careMode ? '生成护理回访计划' : '生成本次联系计划'} · ${picks.length} 人</button><small>规则草稿经人工审核后模拟执行；工作台支持真实 AI</small></aside></div></section>${planProgress(state.tasks)}
        <section class="growth-opportunities"><div class="growth-section-title"><h2 class="atelier-heading">经营机会</h2><p>同一会员可能符合多个机会，人数不相加。</p></div><div class="opportunity-scroll"><div class="growth-opportunity-tabs" role="group" aria-label="选择经营机会" style="--opportunity-count:${Object.keys(OPPORTUNITIES).length};--opportunity-index:${Object.keys(OPPORTUNITIES).indexOf(state.selectedOpportunity)}"><span class="opportunity-highlight" aria-hidden="true"></span>${Object.entries(
            OPPORTUNITIES,
        )
            .map(
                ([key, item]) =>
                    `<button data-opportunity="${key}" aria-pressed="${state.selectedOpportunity === key}"><span>${item.label}</span><b>${num(key === 'all' ? total : groups[key].length)}</b></button>`,
            )
            .join('')}</div></div></section>
        <section class="growth-priority" id="goal-panel"><div class="section-head"><div><h2 id="goal-heading" class="atelier-heading">${state.selectedOpportunity === 'all' ? '今日优先联系' : OPPORTUNITIES[state.selectedOpportunity].label + ' · 优先名单'}</h2><p class="muted">${careMode ? '最近一次美甲服务后第 1–7 天 · 先回访最近做过美甲的顾客。' : '从不同机会里挑选适合联系的人，再决定这次怎么聊。'}</p></div><div class="count-control"><label for="plan-limit">本次安排</label><select id="plan-limit">${[3, 4, 5, 8].map((n) => `<option ${state.planLimit === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div></div>
        ${picks.length ? `<div class="care-row-tools"><span class="care-row-label">${picks.length} 张便签 · 顶部对齐 · 横向单排</span><div class="care-row-arrows" hidden><button type="button" aria-label="向左查看便签" aria-controls="care-wall">←</button><button type="button" aria-label="向右查看便签" aria-controls="care-wall">→</button></div></div><div id="care-wall" class="care-wall-single-row" style="--care-count:${picks.length}" role="region" tabindex="0" aria-label="优先联系便签，可横向滚动">${picks.map(card).join('')}</div>` : `<div class="empty atelier-empty"><p>${state.selectedOpportunity === 'scheduled' ? '暂无已到期且符合联系间隔的回访计划。' : '这类机会暂时没有待处理会员，请切换机会或先完成已有任务。'}</p><button data-view="studio">去工作台准备沟通</button></div>`}
        <p class="care-note">${careMode ? '按最近一次美甲服务日期排序；同一天按会员编号排序。' : '名单按已有规则优先级排列；评分不由模型计算。余额是服务权益，不作为新增收入。'}</p></section><section class="growth-bottom"><div><h3>剩下的事，让流程接住</h3><p>在工作台调整沟通目的、产品与话术；准备好的文案集中审核。完成联系后，记录反馈与负责人，再回来看预约、到店和消费。</p><div class="button-row"><button data-view="campaigns">查看待审核任务</button><button data-view="reports">查看复购结果</button></div></div></section>`;
}

function card({ member, objective }, index) {
    const product = opportunityProduct(member, objective, state.products),
        visit = objective === 'care' ? member.recentNailVisit : null;
    const name = escapeHtml(member.displayName || member.id),
        contextual = ['preview', 'scheduled', 'greeting'].includes(objective);
    const timing =
        objective === 'preview'
            ? `演示预告 · ${product?.launchDate || '日期待确认'}`
            : objective === 'scheduled'
              ? member.followupRecord?.followUp
              : '有多次到店记录';
    return `<article class="hanger glass-track ${index === 0 ? 'selected' : ''}" data-candidate="${member.id}" data-objective="${objective}"><div class="cord" aria-hidden="true"></div><div class="tilt glass-tilt"><div class="card"><div class="face front glass-surface" aria-hidden="false"><div class="meta">${member.id} / ${visit ? '美甲后回访' : LIFECYCLE_LABELS[member.lifecycle]}</div><div class="monogram" aria-hidden="true">${escapeHtml((member.displayName || member.id)[0])}</div><h3>${name}</h3>${contextual ? `<div class="growth-card-context"><strong>${objective === 'preview' ? '偏好匹配' : objective === 'scheduled' ? '计划到期' : '保持联系'}</strong><span>${escapeHtml(timing)}</span></div>` : `<div class="days"><b>${visit ? visit.days : member.days}</b><span>${visit ? '天前做过美甲' : '天未到店'}</span></div><p class="cycle">${visit ? escapeHtml(visit.date + ' · ' + visit.name) : `个人周期 ${member.cycle} 天 · 偏离 ${member.ratio} 倍`}</p>`}<p class="growth-card-goal">${OBJECTIVES[objective]}</p><p class="growth-card-product">${escapeHtml(opportunityAction(member, objective, product))}</p><div class="actions"><button data-action="flip" data-id="${member.id}" data-flip="${member.id}" aria-expanded="false">查看依据 ↻</button><button class="primary" data-action="studio-member" data-id="${member.id}" data-objective="${objective}">准备沟通 →</button></div></div>
        <div class="face back glass-surface" inert aria-hidden="true"><div class="meta">${member.id} / ${OBJECTIVES[objective]}</div><h3>${name}</h3><h4>为什么先联系她</h4><p>${escapeHtml(opportunityEvidence(member, objective, product))}</p><h4>本次行动</h4><p>${escapeHtml(opportunityAction(member, objective, product))}</p><p class="quiet">${escapeHtml(member.latestNote || '先了解本人需求，再决定这次怎么聊。')}</p><div class="actions"><button class="primary" data-action="studio-member" data-id="${member.id}" data-objective="${objective}">打开沟通准备 →</button><button data-action="flip" data-id="${member.id}" data-unflip="${member.id}">返回 ↶</button></div></div></div></div></article>`;
}

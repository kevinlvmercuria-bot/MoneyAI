import { state } from '../state.js';
import {
    OPPORTUNITIES,
    availableOpportunityMembers,
    matchesOpportunity,
    opportunityCandidates,
    opportunityFor,
    opportunityProduct,
    buildOpportunityTask,
    money,
} from '../rules-client.js';
import { LIFECYCLE_LABELS, escapeHtml, num, planProgress } from '../components.js';

function dashboard() {
    const available = availableOpportunityMembers(state.members, state.tasks);
    const counts = Object.fromEntries(
        Object.keys(OPPORTUNITIES).map((key) => [
            key,
            available.filter((member) => matchesOpportunity(member, key)).length,
        ]),
    );
    const picks = opportunityCandidates(
        state.members,
        state.tasks,
        state.selectedOpportunity,
    ).slice(0, state.planLimit);
    const pending = state.tasks.filter((task) => task.status === 'pending_review').length;
    return `<section class="growth-intro"><div><h2>${picks.length ? `今天，先联系这 ${picks.length} 位会员。` : '这类机会，暂时没有待处理会员。'}</h2><p>从 <strong>${num(state.members.length)}</strong> 位会员中，按周期、偏好和联系资格准备。<br>每人一份理由，审核后再安排联系。</p></div><aside class="growth-daily-note"><p><strong>${num(counts[state.selectedOpportunity])}</strong> 位待经营 · 本次安排 ${picks.length} 人</p><small>已排除联系限制、已排队和本次已处理的会员</small><button class="primary" data-action="queue-goal" ${picks.length ? '' : 'disabled'}>生成本次复购计划 · 加入待审核</button><small>使用规则草稿；真实 AI 文案可到话术工作台生成</small></aside></section>
        ${planProgress(state.tasks)}
        <section class="growth-opportunities"><div class="growth-section-title"><h2>先解决哪一种机会？</h2><p>同一会员可能符合多个机会，人数不相加。</p></div><div class="growth-opportunity-tabs" role="group" aria-label="选择经营机会">${Object.entries(
            OPPORTUNITIES,
        )
            .map(
                ([key, goal]) =>
                    `<button data-opportunity="${key}" aria-pressed="${state.selectedOpportunity === key}"><span>${goal.label}</span><b>${num(counts[key])}</b></button>`,
            )
            .join('')}</div></section>
        <section class="growth-priority goal-panel" id="goal-panel" aria-labelledby="goal-heading"><div class="section-head"><div><h2 id="goal-heading">${state.selectedOpportunity === 'all' ? '今日优先联系' : OPPORTUNITIES[state.selectedOpportunity].label + ' · 优先名单'}</h2><p class="muted">先看谁需要回来，再决定聊什么。</p></div><div class="count-control"><label for="plan-limit">本次安排</label><select id="plan-limit">${[3, 4, 5].map((n) => `<option ${state.planLimit === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div></div>
        ${picks.length ? `<div id="care-wall" aria-label="今日优先联系会员">${picks.map(candidateCard).join('')}</div>` : '<div class="empty">已排除未授权、有投诉、有未来预约、联系间隔不足及已有任务的会员。可切换经营目标，或先完成已有审核任务。<p><button data-view="campaigns">查看已有任务</button></p></div>'}
        <p class="care-note">勾选名单后再加入待审核，每次最多 5 人。名单按现有优先级、周期偏离和会员编号排序；评分不由模型计算。余额是已有权益，不计为新增收入。</p></section>
        <section class="growth-bottom"><div><h3>剩下的事，让流程接住</h3><p>打开会员的工作台准备 AI 文案，或记录反馈、负责人和跟进日期。完成审核与模拟执行后，回来看预约、到店和消费。</p><div class="button-row"><button data-view="campaigns">查看 ${pending} 条待审核任务</button><button data-view="reports">查看复购结果</button></div></div></section>`;
}

function candidateCard(member, index) {
    const draft = buildOpportunityTask(member, state.selectedOpportunity, state.products);
    const selected = opportunityFor(member, state.selectedOpportunity);
    const product = opportunityProduct(member, state.selectedOpportunity, state.products);
    const name = escapeHtml(member.displayName || member.id);
    return `<article class="hanger" data-candidate="${member.id}" style="--drop:${index % 2 ? 22 : 8}px"><div class="cord" aria-hidden="true"></div><div class="tilt"><div class="card">
        <div class="face front" aria-hidden="false"><div class="meta">${member.id} / ${LIFECYCLE_LABELS[member.lifecycle]}</div><div class="monogram" aria-hidden="true">${escapeHtml((member.displayName || member.id).slice(0, 1))}</div><h3>${name}</h3><div class="days"><b>${member.days}</b><span>天未到店</span></div><p class="cycle">个人周期 ${member.cycle} 天 · 偏离 ${member.ratio} 倍</p><p class="growth-card-goal">${OPPORTUNITIES[selected].label}</p><p class="growth-card-product">${selected === 'balance' ? `可用余额 ${money(member.bal)}` : `推荐 ${escapeHtml(product?.name || '先了解本人需求')}`}</p><label class="card-check"><input type="checkbox" name="candidate" value="${member.id}" checked>加入本次名单</label><div class="actions"><button data-action="flip" data-id="${member.id}" aria-label="查看 ${member.id} 推荐依据">查看依据 ↻</button><button class="primary" data-action="studio-member" data-id="${member.id}">准备沟通 →</button></div></div>
        <div class="face back" inert aria-hidden="true"><div class="meta">${member.id} / ${OPPORTUNITIES[selected].label}</div><h3>${name}</h3><h4>为什么先联系她</h4><p>${escapeHtml(draft.reason)}</p><h4>本次规则草稿</h4><p>${escapeHtml(draft.message)}</p><p class="quiet">${escapeHtml(member.latestNote || `偏好${member.style} · 已通过联系资格检查`)}</p><div class="actions"><button class="primary" data-action="prepare-care" data-id="${member.id}">记录沟通反馈</button><button data-action="flip" data-id="${member.id}" aria-label="返回 ${member.id} 正面">返回 ↶</button></div></div>
    </div></div></article>`;
}

// 在渲染后绑定当前卡片；桌面跟随鼠标轻微倾斜，触屏和减少动态效果设置下不启用。
function setupCardTilt() {
    document.querySelectorAll('#care-wall .hanger').forEach((hanger) => {
        const tilt = hanger.querySelector('.tilt');
        const card = hanger.querySelector('.card');
        let frame = null;
        hanger.onpointermove = (event) => {
            if (
                matchMedia('(prefers-reduced-motion: reduce)').matches ||
                event.pointerType === 'touch' ||
                document.hidden ||
                frame !== null
            )
                return;
            const rect = tilt.getBoundingClientRect();
            const x = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width) * 2 - 1));
            const y = Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height) * 2 - 1));
            frame = requestAnimationFrame(() => {
                frame = null;
                if (!tilt.isConnected) return;
                tilt.style.transform = `rotateX(${-y * 2}deg) rotateY(${x * 3}deg)`;
                card.style.setProperty('--shine-x', `${(x + 1) * 50}%`);
                card.style.setProperty('--shine-y', `${(y + 1) * 50}%`);
            });
        };
        hanger.onpointerleave = () => {
            if (frame !== null) cancelAnimationFrame(frame);
            frame = null;
            tilt.style.transform = '';
        };
    });
}

export { dashboard, setupCardTilt };

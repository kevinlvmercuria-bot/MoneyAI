import { state } from '../state.js';
import { GOALS, buildReviewTask, canContact, goalCandidates } from '../rules-client.js';
import { LIFECYCLE_LABELS, escapeHtml, icon, metric, num } from '../components.js';

function metrics() {
    const counts = Object.fromEntries(
        ['active', 'due', 'low_frequency', 'dormant'].map((s) => [
            s,
            state.members.filter((m) => m.lifecycle === s).length,
        ]),
    );
    return {
        counts,
        eligibleDormant: state.members.filter((m) => m.lifecycle === 'dormant' && canContact(m)).length,
        balanced: state.members.filter((m) => m.bal > 0).length,
        high: state.members.filter((m) => m.spend >= 1800).length,
        pending: state.tasks.filter((t) => t.status === 'pending_review').length,
        executed: state.tasks.filter((t) => t.status === 'executed_simulated').length,
    };
}

function goalPanel() {
    const candidates = goalCandidates(state.members, state.tasks, state.selectedGoal, state.products);
    const tabs = Object.entries(GOALS)
        .map(
            ([key, goal]) =>
                `<button class="filterbtn ${state.selectedGoal === key ? 'active' : ''}" aria-pressed="${state.selectedGoal === key}" data-goal="${key}">${goal.label}</button>`,
        )
        .join('');
    const cards = candidates
        .map((member, index) => {
            const draft = buildReviewTask(member, null, state.selectedGoal, state.products);
            return `<article class="hanger" data-candidate="${member.id}" style="--drop:${index % 2 ? 22 : 8}px">
                <div class="cord" aria-hidden="true"></div><div class="tilt"><div class="card">
                    <div class="face front" aria-hidden="false">
                        <div class="meta">${member.id} / ${LIFECYCLE_LABELS[member.lifecycle]}</div>
                        <div class="monogram" aria-hidden="true">${member.id.slice(-2)}</div>
                        <h3>${member.style} · ${member.level}</h3>
                        <div class="days"><b>${member.days}</b><span>天未到店</span></div>
                        <p class="cycle">个人周期 ${member.cycle} 天 · 偏离 ${member.ratio} 倍</p>
                        <p class="reason" title="${escapeHtml(draft.reason)}">${escapeHtml(draft.reason)}</p>
                        <div class="actions">
                            <button data-action="flip" data-id="${member.id}" aria-label="查看 ${member.id} 摘要">摘要 ↻</button>
                            <label class="card-check"><input type="checkbox" name="candidate" value="${member.id}" checked>加入名单</label>
                        </div>
                    </div>
                    <div class="face back" inert aria-hidden="true">
                        <div class="meta">${member.id} / 沟通准备</div>
                        <h3>${GOALS[state.selectedGoal].label}</h3>
                        <h4>规则生成的邀约</h4><p>${escapeHtml(draft.message)}</p>
                        <p class="quiet">入队后由店主修改并审核。</p>
                        <div class="actions">
                            <button data-action="prepare-care" data-id="${member.id}">沟通准备 ↓</button>
                            <button data-action="flip" data-id="${member.id}" aria-label="返回 ${member.id} 正面">返回 ↶</button>
                        </div>
                    </div>
                </div></div>
            </article>`;
        })
        .join('');
    return `<section class="goal-panel" id="goal-panel" aria-labelledby="goal-heading">
            <div class="section-head"><div><p class="eyebrow">PERSONAL TOUCH / 今日计划</p><h2 id="goal-heading">给每次联系，一个合适的理由。</h2></div></div>
            <div class="goal-tabs" aria-label="经营目标">${tabs}</div>
            <p class="care-note">${candidates.length ? `推荐 ${candidates.length} 人，每次最多加入 5 人。翻到背面查看沟通摘要，勾选后加入待审核。` : '当前没有可入队的会员。会员需命中目标、通过联系资格检查且没有有效任务。'}</p>
            <div id="care-wall" aria-label="推荐会员关怀卡">${cards}</div>
            <div class="workspace-actions"><button class="btn" data-action="queue-goal" ${candidates.length ? '' : 'disabled'}>加入待审核</button></div>
        </section>`;
}

function dashboard() {
    const stats = metrics();
    const distribution = Object.entries(stats.counts)
        .map(
            ([lifecycle, count], i) =>
                `<div class="life-row"><span>${LIFECYCLE_LABELS[lifecycle]}</span><div class="track"><span style="width:${(count / Math.max(1, state.members.length)) * 100}%;background:${['#a7c5b0', '#ddba88', '#cd9bb2', '#95657f'][i]}"></span></div><strong>${num(count)}</strong></div>`,
        )
        .join('');
    return `<section class="welcome"><div><h1>不只记得款式，<br>也记得每位顾客的小细节。</h1>
            <p>从会员复购节奏、消费偏好和护理档案，找到合适的关怀机会。</p>
            <button class="btn" data-action="analyze">${icon('spark')}运行经营分析</button></div>
            <div class="welcome-aside"><strong>今天，从一次自然的问候开始。</strong><p>挑选会员，准备文案和产品图，再由店主决定怎样联系。</p></div></section>
            <section class="metrics">${metric('会员总数', state.members.length, '数据库中的虚拟会员档案')}${metric('可联系沉睡会员', stats.eligibleDormant, '已过滤联系资格限制')}${metric('持有储值余额', stats.balanced, '权益提醒不等于新增收入')}${metric('待审核任务', stats.pending, '由店主做最后决定')}</section>
            <div class="dash-grid"><section class="panel"><div class="panel-head"><h2>会员生命周期</h2><button class="text-btn" data-view="members">查看会员 ↗</button></div>${distribution}</section>
            <section class="panel"><div class="panel-head"><h2>把了解变成下一步</h2></div>
            ${[
                ['users', '会员档案', '查看偏好、消费和历史备注。', 'members'],
                ['heart', '护理跟进', '记录本人反馈与后续计划。', 'care'],
                ['spark', '话术工作台', '为选中会员生成文案与产品配图。', 'studio'],
            ]
                .map(
                    ([ico, title, text, target]) =>
                        `<div class="recommend-row"><div class="recommend-icon">${icon(ico)}</div><div><h3>${title}</h3><p>${text}</p></div><button class="text-btn" data-view="${target}" aria-label="打开${title}">↗</button></div>`,
                )
                .join('')}
            </section></div>${goalPanel()}`;
}

export { dashboard };

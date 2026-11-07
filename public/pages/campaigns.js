import { state } from '../state.js';
import { chip, escapeHtml, head, headModal, icon, modal, toast } from '../components.js';
import { DEMO_SERVICE_PRICE, SCENARIOS, money } from '../rules-client.js';

function campaigns() {
    let list = state.tasks.filter((t) => state.taskFilter === 'all' || t.status === state.taskFilter),
        ct = (s) => state.tasks.filter((t) => t.status === s).length;
    return `${head('AI 营销任务审核', 'CAMPAIGN REVIEW', '先有数据依据，再生成话术；每一条触达都须由人亲自审核。', `<button class="btn" data-action="analyze">${icon('spark')} 查看经营目标</button>`)}<div class="task-summary"><div class="summary-box"><b>${state.tasks.length}</b><span>全部任务</span></div><div class="summary-box"><b>${ct('pending_review')}</b><span>待审核</span></div><div class="summary-box"><b>${ct('approved')}</b><span>已批准待执行</span></div><div class="summary-box"><b>${ct('executed_simulated')}</b><span>已模拟触达</span></div></div><div class="panel"><div class="panel-head" style="margin-bottom:16px"><h3>任务中心</h3><div class="tabs">${[
        ['all', '全部'],
        ['pending_review', '待审核'],
        ['approved', '已批准'],
        ['executed_simulated', '已执行'],
        ['rejected', '已拒绝'],
    ]
        .map(
            ([s, t]) =>
                `<button class="filterbtn ${state.taskFilter === s ? 'active' : ''}" data-task-filter="${s}">${t}</button>`,
        )
        .join('')}</div></div>${
        list.length
            ? list
                  .map((t) => {
                      return `<div class="taskrow"><div class="task-avatar">${t.memberId.slice(-2)}</div><div class="task-center"><h4>${t.memberId} · ${escapeHtml(t.strategy)} ${chip(t.status)}</h4><p>${escapeHtml(t.reason)}</p></div><div class="task-meta"><span style="color:#a5939b;font-size:11px">优先级 ${t.priority}</span>${t.status === 'pending_review' ? `<button class="btn small" data-task="${t.id}">审核话术 →</button>` : t.status === 'approved' ? `<button class="btn green small" data-execute="${t.id}">模拟执行 →</button>` : `<button class="btn outline small" data-task="${t.id}">查看详情</button>`}</div></div>`;
                  })
                  .join('')
            : `<div class="empty"><div class="emptyicon">✧</div><strong>这个分类暂时没有任务</strong><p>点击「查看经营目标」，试试会员分析到人工审核的流程。</p></div>`
    }<div class="notice">此为前端演示：任务与审核记录保存到演示数据库，所有触达均为模拟。</div></div>`;
}

function taskModal(id) {
    const t = state.tasks.find((t) => t.id === id);
    if (!t) return;
    const m = state.members.find((x) => x.id === t.memberId);
    modal(
        `${headModal('HUMAN REVIEW · SIMULATION', t.memberId + ' · ' + t.strategy)}<div style="display:flex;gap:8px;align-items:center">${chip(t.status)}<span class="tiny-note">优先级 ${t.priority} / 100 · ${m.style}偏好</span></div><div class="sectlabel">推荐依据</div><div class="quote">${escapeHtml(t.reason)}。<br/>营销授权：${m.consent ? '允许' : '拒绝'} / 距上次联系：${m.contactDays} 天。</div><div class="sectlabel">拟发送话术 ${t.status === 'pending_review' ? '<span style="color:#b7a9af;font-weight:500">（可修改后审核）</span>' : ''}</div>${t.status === 'pending_review' ? `<textarea class="textarea" id="edit-message">${escapeHtml(t.editedMessage || t.message)}</textarea>` : `<div class="quote">${escapeHtml(t.editedMessage || t.message)}</div>`}${t.result ? `<div class="sectlabel">模拟触达结果</div><div class="quote">模拟回复：${t.result.reply ? '是' : '否'} · 模拟预约：${t.result.booking ? '是' : '否'} · 模拟到店：${t.result.visit ? '是' : '否'} · 模拟消费：${money(t.result.spending)}</div>` : ''}<div class="modal-actions"><button class="btn outline" data-action="close">关闭</button>${t.status === 'pending_review' ? `<button class="btn secondary" data-action="reject" data-id="${t.id}">拒绝</button><button class="btn" data-action="approve" data-id="${t.id}">✓ 审核通过</button>` : t.status === 'approved' ? `<button class="btn green" data-execute="${t.id}">模拟执行</button>` : ''}</div>`,
    );
}

function chooseScenario(id) {
    const task = state.tasks.find((task) => task.id === id);
    if (task?.status !== 'approved') return toast('只有已审核通过且未执行的任务可以执行');

    const options = Object.entries(SCENARIOS)
        .map(
            ([key, scenario]) =>
                `<label class="scenario-option"><input type="radio" name="scenario" value="${key}"> ${scenario.label}</label>`,
        )
        .join('');
    modal(`${headModal('SIMULATION', `${task.memberId} · 选择模拟结果`)}
            <fieldset class="quote"><legend>本次触达的模拟情景</legend>${options}</fieldset>
            <p class="notice">模拟到店消费按 ${money(DEMO_SERVICE_PRICE)} 演示。此操作仅更新演示数据。</p>
            <div class="modal-actions">
                <button class="btn outline" data-task="${task.id}">返回任务</button>
                <button class="btn green" data-action="confirm-execution" data-id="${task.id}">确认模拟执行</button>
            </div>`);
}

export { campaigns, taskModal, chooseScenario };

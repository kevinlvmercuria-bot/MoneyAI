import { productPhoto, productCredit } from '../components.js';
import { state } from '../state.js';
import { TASK_STATUS_LABELS, chip, escapeHtml, headModal, modal, toast } from '../components.js';
import { DEMO_SERVICE_PRICE, SCENARIOS, canContact, money } from '../rules-client.js';

function campaigns() {
    const list = state.tasks.filter(
        (task) => state.taskFilter === 'all' || task.status === state.taskFilter,
    );
    if (!list.some((task) => task.id === state.selectedTaskId))
        state.selectedTaskId = list[0]?.id || null;
    const selected = list.find((task) => task.id === state.selectedTaskId);
    const filters = [['all', '全部任务'], ...Object.entries(TASK_STATUS_LABELS)];
    return `<div class="workflow"><span>01 查看依据</span><span>02 编辑草稿</span><strong>03 人工审核</strong><span>04 模拟执行 ↗</span></div>
        <div class="review-layout"><section><label for="task-filter">任务状态</label><select id="task-filter">${filters.map(([key, label]) => `<option value="${key}" ${state.taskFilter === key ? 'selected' : ''}>${label}</option>`).join('')}</select><p class="helper">${list.length} 条任务 · 共 ${state.tasks.length} 条</p><div class="task-list">${
            list
                .map((task) => {
                    const member = state.members.find((member) => member.id === task.memberId);
                    return `<button data-task="${task.id}" aria-pressed="${task.id === state.selectedTaskId}">${escapeHtml(member?.displayName || task.memberId)} · ${escapeHtml(task.strategy)}<small>${task.memberId} / ${TASK_STATUS_LABELS[task.status]}</small></button>`;
                })
                .join('') || '<p class="empty">当前分类没有任务。</p>'
        }</div><button data-view="dashboard">去准备复购计划 →</button></section><section>${selected ? taskDetail(selected) : '<div class="empty">选择其他状态，或先在今日复购计划准备待审核任务。</div>'}</section></div>`;
}

function taskDetail(task) {
    const member = state.members.find((member) => member.id === task.memberId);
    const blocked = !canContact(member) && task.context?.objective !== 'scheduled';
    const product = state.products.find((product) => product.id === task.context?.productId);
    return `<div class="detail-head"><h2>${escapeHtml(member.displayName || member.id)} · ${escapeHtml(task.strategy)}</h2>${chip(task.status)}</div><p class="helper">${task.id} / ${task.memberId}</p>
        <p class="eligibility ${blocked ? 'blocked' : ''}">${blocked ? '当前存在联系限制，请查看会员档案。服务端将在审核和执行时再次检查。' : '已通过联系资格检查 · 已授权、无投诉、无近期联系或未来预约'}</p>
        <section class="growth-task-context"><h3>这份计划为什么给她？</h3><p>${escapeHtml(task.reason)}</p>${product ? `<div class="growth-task-product">${productPhoto(product)}<div><h4>${escapeHtml(product.name)}</h4><p>${escapeHtml(product.description)}</p>${productCredit(product)}</div></div>` : ''}<p class="growth-note-reference"><b>会员档案参考</b>${escapeHtml(member.latestNote || `偏好${member.style} · ${member.days} 天未到店 · 平均周期 ${member.cycle} 天`)}</p><button data-member="${member.id}">查看完整会员档案</button></section>
        <div class="form-panel"><label for="edit-message">规则生成的沟通草稿 · 可修改后审核</label><textarea id="edit-message" maxlength="1000" ${task.status !== 'pending_review' ? 'readonly' : ''}>${escapeHtml(task.editedMessage || task.message)}</textarea><p class="helper">请核对事实与语气，不编造优惠或预约时段。审核通过后，仍需选择模拟情景才会记录结果。</p><div class="button-row">${task.status === 'pending_review' ? `<button class="primary" data-action="approve" data-id="${task.id}">审核通过</button><button data-action="reject" data-id="${task.id}">拒绝任务</button>` : task.status === 'approved' ? `<button class="primary" data-execute="${task.id}">执行模拟触达</button>` : ''}</div></div>
        ${task.result ? `<p class="eligibility">模拟结果：回复 ${task.result.reply ? '是' : '否'} / 预约 ${task.result.booking ? '是' : '否'} / 到店 ${task.result.visit ? '是' : '否'} / 消费 ${money(task.result.spending)}。未发送真实消息。</p>` : ''}`;
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

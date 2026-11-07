import { state } from '../state.js';
import {
    LIFECYCLE_LABELS,
    NOTE_LABELS,
    escapeHtml,
    head,
    productPhoto,
    productCredit,
} from '../components.js';
import {
    OBJECTIVES,
    DEMO_DATE,
    canContactFor,
    matchesOpportunity,
    noProductObjective,
    workbenchProducts,
    opportunityEvidence,
    opportunityAction,
    money,
} from '../rules-client.js';
import { careFollowup, careHistory } from './care.js';

export function studioContext() {
    const member =
        state.members.find((member) => member.id === state.studioMemberId) || state.members[0];
    if (!member) return null;
    state.studioMemberId = member.id;
    const objective = state.studioObjective;
    const products = workbenchProducts(member, objective, state.products);
    if (!products.some((product) => product.id === state.studioProductId))
        state.studioProductId = products[0]?.id || null;
    const product = products.find((product) => product.id === state.studioProductId) || null;
    const key = [member.id, objective, product?.id || 'none'].join(':');
    const draft = state.copyDrafts.find(
        (draft) =>
            draft.memberId === member.id &&
            (draft.context
                ? draft.context.objective === objective &&
                  draft.context.productId === (product?.id || null)
                : objective === 'wake'),
    );
    const allowed =
        canContactFor(member, objective) &&
        (!['care', 'preview', 'scheduled'].includes(objective) ||
            matchesOpportunity(member, objective, state.products));
    return { member, objective, products, product, key, draft, allowed };
}

export function studioPage() {
    const current = studioContext();
    if (!current) return '<div class="empty">暂无会员资料。</div>';
    const { member, objective, products, product, key, draft, allowed } = current;
    const message = draft
        ? (state.copyEdits.get(String(draft.id)) ?? draft.message)
        : state.manualDrafts.get(key) || '';
    const notes = state.memberDetailsCache.get(member.id)?.notes;
    const noProduct = noProductObjective(objective),
        needsProduct = !noProduct && !product;
    const info = objective === 'care' ? member.recentNailVisit : null;
    const productLabel = product?.planned
        ? `演示预告 · ${product.launchDate}`
        : money(product?.price);
    return `${head('把了解，变成一段自然的沟通。', 'PERSONAL NOTES', '先看会员档案与店主备注，再选沟通目的、准备话术。聊完之后，也在这里记下下一步。', '<button data-view="products">打开产品与图片库</button>')}
        <div class="wb-layout"><aside class="wb-context"><h3>这次，为谁准备？</h3><div class="wb-field"><label for="studio-member">选择会员</label><select id="studio-member">${state.members.map((person) => `<option value="${person.id}" ${person.id === member.id ? 'selected' : ''}>${person.id} · ${escapeHtml(person.displayName || person.id)} · ${LIFECYCLE_LABELS[person.lifecycle]}</option>`).join('')}</select></div>
        <div class="wb-member"><span class="member-avatar">${escapeHtml((member.displayName || member.id)[0])}</span><div><h3>${escapeHtml(member.displayName || member.id)}</h3><p>${member.id} · ${escapeHtml(member.level)} · ${LIFECYCLE_LABELS[member.lifecycle]}</p></div></div>
        <dl class="wb-facts">${info ? `<div><dt>最近美甲</dt><dd><strong>${info.days} 天前</strong><small>${escapeHtml(info.date)}</small></dd></div><div><dt>美甲项目</dt><dd>${escapeHtml(info.name)}</dd></div>` : noProduct || objective === 'preview' ? `<div><dt>${objective === 'scheduled' ? '计划回访' : objective === 'preview' ? '预告款式' : '上次联系'}</dt><dd>${objective === 'scheduled' ? escapeHtml(member.followupRecord?.followUp || '暂无到期计划') : objective === 'preview' ? product?.launchDate || '暂无匹配款式' : member.contactDays >= 10000 ? '暂无记录' : member.contactDays + ' 天前'}</dd></div>` : `<div><dt>未到店</dt><dd><strong>${member.days} 天</strong><small>最近到店 ${escapeHtml(member.lastVisit)}</small></dd></div><div><dt>个人周期</dt><dd><strong>${member.cycle} 天</strong> · 当前 ${member.ratio} 倍</dd></div>`}<div><dt>偏好风格</dt><dd>${escapeHtml(member.style)} / ${escapeHtml(member.secondary)}</dd></div><div><dt>护理需求</dt><dd>${escapeHtml(member.careProfile?.tags || '待本人确认')}</dd></div></dl>
        <section class="wb-note-section"><h3>老板娘补充的细节</h3><div id="studio-notes" data-id="${member.id}">${notes ? `<ul class="wb-notes">${notes.map((note) => `<li><small>${note.is_pinned ? '置顶 · ' : ''}${escapeHtml(NOTE_LABELS[note.note_type] || note.note_type)}</small>${escapeHtml(note.note_text)}</li>`).join('')}</ul>` : `<p>${escapeHtml(member.latestNote || '暂无记录，可以先到会员档案补充。')}</p>`}</div><button data-view="members" data-profile-id="${member.id}">查看或补充会员备注</button></section>
        <details class="wb-preparation" open><summary>沟通准备 · 先了解，再推荐</summary><h4>为什么值得关注</h4><p>${escapeHtml(opportunityEvidence(member, objective, product))}</p><h4>待本人确认</h4><p>${objective === 'care' ? '这次佩戴是否舒服，甲面和甲缘状态如何，是否需要护理建议。' : noProduct ? '听听顾客近况，确认是否需要协助，以及什么时候方便再联系。' : '近期是否有需求、喜欢什么款式；未到店原因需听本人表达。'}</p><h4>这次的小目标</h4><p>${escapeHtml(opportunityAction(member, objective, product))}</p></details></aside>
        <section class="wb-output"><header class="wb-output-header"><div><h3>沟通草稿</h3><p>给 ${escapeHtml(member.displayName || member.id)} · ${OBJECTIVES[objective]}</p></div><span class="pill">真实 AI · 人工核对</span></header>
        <div class="wb-control-grid"><div class="wb-field"><label for="studio-objective">这次想聊什么？</label><select id="studio-objective">${Object.entries(
            OBJECTIVES,
        )
            .map(
                ([id, label]) =>
                    `<option value="${id}" ${objective === id ? 'selected' : ''}>${label}</option>`,
            )
            .join(
                '',
            )}</select></div><div class="wb-field"><label for="copy-style">表达方式</label><select id="copy-style">${(state.aiConfig.styles || [{ id: 'friendly', label: '自然亲切' }]).map((style) => `<option value="${style.id}" ${style.id === state.selectedCopyStyle ? 'selected' : ''}>${style.label}</option>`).join('')}</select></div></div>
        ${noProduct ? `<p class="wb-action-note"><b>本次行动</b> · ${escapeHtml(opportunityAction(member, objective, product))}</p>` : `<div class="wb-field"><label for="studio-product">${objective === 'preview' ? '本次预告的款式' : '本次推荐的产品 / 服务'}</label><select id="studio-product">${products.map((item) => `<option value="${item.id}" ${item.id === product?.id ? 'selected' : ''}>${escapeHtml(item.name)} · ${item.planned ? '演示预告 ' + item.launchDate : money(item.price)}</option>`).join('')}</select></div>`}
        ${product ? `<div class="wb-product">${productPhoto(product)}<div><h4>${escapeHtml(product.name)}</h4><p>${escapeHtml(product.description)}</p><div class="wb-price">${productLabel}</div>${productCredit(product)}<button data-action="bind-product-image" data-id="${product.id}">更换产品图</button></div></div>` : noProduct ? '' : '<p class="empty">暂无可用的款式或服务，请调整沟通目的。</p>'}
        <div class="studio-ai-controls"><div><label for="ai-model">生成模型</label><select id="ai-model">${state.aiConfig.models.map((model) => `<option value="${model.id}" ${model.id === state.selectedModel ? 'selected' : ''}>${escapeHtml(model.label)}</option>`).join('')}</select></div><button class="primary" data-action="generate-copy" ${allowed && !needsProduct && state.aiConfig.configured ? '' : 'disabled'}>${draft ? '重新生成 AI 话术' : '生成 AI 话术'}</button></div>
        <p id="ai-generation-status" role="status"></p>${!allowed ? '<p class="wb-restrictions">当前不满足联系资格或本次目的的时间窗口，可查看资料，暂不能生成、复制或提交任务。</p>' : ''}${state.generationErrors
            .filter((item) => item.memberId === member.id)
            .map((item) => `<p class="alert">${escapeHtml(item.error)}</p>`)
            .join('')}
        <section id="copy-results" aria-label="当前会员文案"><article class="copy-result" ${draft ? `data-copy-result="${draft.id}"` : ''}><div class="wb-draft-label"><label for="message-draft">话术内容 · 可以直接修改</label><small id="draft-count">${message.length} / 1000</small></div><textarea id="message-draft" maxlength="1000" ${draft ? `data-copy-edit="${draft.id}"` : `data-manual-copy="${key}"`} placeholder="点击生成 AI 话术，或直接写下你想说的话。">${escapeHtml(message)}</textarea>
        <div class="wb-customer-preview"><h4>顾客沟通预览</h4><p>这里只展示顾客会看到的内容，内部备注和经营数据留在店内。</p><div class="wb-chat-message" data-chat-preview="${draft?.id || 'manual'}">${escapeHtml(message || '话术准备好后，会在这里显示顾客看到的消息。')}</div>${product ? `<div class="wb-chat-product">${productPhoto(product)}<div><strong>${escapeHtml(product.name)}</strong><p>${productLabel}</p></div></div>` : ''}</div>
        <div class="wb-actions"><button data-action="${draft ? 'copy-message' : 'manual-copy'}" data-id="${draft?.id || ''}" data-requires-message data-contact-allowed="${allowed && !needsProduct}" ${message.trim() && allowed && !needsProduct ? '' : 'disabled'}>复制话术</button><button data-action="download-card" data-requires-message data-contact-allowed="true" ${message.trim() ? '' : 'disabled'}>下载图文卡片</button><button class="primary" data-action="${draft ? 'submit-copy' : 'manual-submit'}" data-id="${draft?.id || ''}" data-requires-message data-contact-allowed="${allowed && !needsProduct}" ${message.trim() && allowed && !needsProduct ? '' : 'disabled'}>提交人工审核</button><button data-action="${draft ? 'save-copy' : 'manual-save'}" data-id="${draft?.id || ''}" data-requires-message data-contact-allowed="${allowed && !needsProduct}" ${message.trim() && allowed && !needsProduct ? '' : 'disabled'}>保存修改</button></div><p class="wb-note">话术与门店图片保存至数据库，店主自行发送；审核通过后可模拟执行。</p>${draft ? `<details><summary>本次推荐依据</summary><p>${escapeHtml(draft.reason)}</p><small>生成模型：${escapeHtml(draft.model)}</small></details>` : ''}</article></section>${careFollowup(member)}</section></div>${careHistory()}`;
}

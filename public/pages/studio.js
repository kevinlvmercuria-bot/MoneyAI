import { state } from '../state.js';
import { LIFECYCLE_LABELS, escapeHtml, head, productCredit } from '../components.js';
import { canContact, money } from '../rules-client.js';
import { productImage } from '../product-images.js';
import { careFollowup, careHistory } from './care.js';

// 只展示当前会员最近保存的一条文案；历史记录继续由数据库保留。
export function studioPage() {
    const member =
        state.members.find((member) => member.id === state.studioMemberId) || state.members[0];
    if (!member) return '<div class="empty">暂无会员资料，请先检查数据连接。</div>';
    state.studioMemberId = member.id;
    const draft = state.copyDrafts.find((draft) => draft.memberId === member.id);
    const allowed = canContact(member);
    return `${head('把了解，变成一段自然的沟通。', 'PERSONAL NOTES', '先看会员档案与店主备注，再准备一段适合她的话。', '<button data-view="products">打开产品与图片库</button>')}
        <div class="wb-layout studio-single"><aside class="wb-context">
            <h3>这次，为谁准备？</h3><div class="wb-field"><label for="studio-member">选择会员</label><select id="studio-member">${state.members.map((person) => `<option value="${person.id}" ${person.id === member.id ? 'selected' : ''}>${person.id} · ${escapeHtml(person.displayName || person.id)} · ${LIFECYCLE_LABELS[person.lifecycle]}</option>`).join('')}</select></div>
            <div class="wb-member"><span class="member-avatar">${escapeHtml((member.displayName || member.id).slice(0, 1))}</span><div><h3>${escapeHtml(member.displayName || member.id)}</h3><p>${member.id} · ${escapeHtml(member.level)}</p></div></div>
            <dl class="wb-facts"><div><dt>未到店</dt><dd><strong>${member.days} 天</strong></dd></div><div><dt>个人周期</dt><dd><strong>${member.cycle} 天</strong> · 当前 ${member.ratio} 倍</dd></div><div><dt>偏好风格</dt><dd>${escapeHtml(member.style)} / ${escapeHtml(member.secondary)}</dd></div><div><dt>护理需求</dt><dd>${escapeHtml(member.careProfile?.tags || '待本人确认')}</dd></div></dl>
            <section class="wb-note-section"><h3>老板娘补充的细节</h3><p>${escapeHtml(member.latestNote || '暂无记录，先了解本人意愿再推荐。')}</p><button data-view="members" data-profile-id="${member.id}">查看会员档案</button></section>
        </aside><section class="wb-output">
            <div class="wb-output-header"><div><h3>沟通草稿</h3><p>给 ${escapeHtml(member.displayName || member.id)} · ${member.id}</p></div><span class="pill">AI 辅助 · 人工核对</span></div>
            ${allowed ? '' : '<p class="wb-restrictions">当前会员未通过联系资格检查，可查看已有文案，暂不能生成或复制。</p>'}
            <div class="studio-ai-controls"><div><label for="ai-model">生成模型</label><select id="ai-model" ${state.aiConfig.models.length ? '' : 'disabled'}>${state.aiConfig.models.map((model) => `<option value="${escapeHtml(model.id)}" ${model.id === state.selectedModel ? 'selected' : ''}>${escapeHtml(model.label)}</option>`).join('')}</select></div><div class="studio-style-control"><label for="copy-style">文案风格</label><select id="copy-style">${(state.aiConfig.styles || [{ id: 'friendly', label: '自然亲切' }]).map((style) => `<option value="${escapeHtml(style.id)}" ${style.id === state.selectedCopyStyle ? 'selected' : ''}>${escapeHtml(style.label)}</option>`).join('')}</select></div><button class="primary" data-action="generate-copy" ${allowed && state.aiConfig.configured && state.selectedModel ? '' : 'disabled'}>${draft ? '重新生成话术' : '生成 AI 话术'}</button></div>
            <p id="ai-generation-status" role="status"></p>
            ${state.aiConfig.configured ? '' : '<p class="helper">AI 服务尚未配置，请检查服务端配置。</p>'}
            <section id="copy-results" aria-label="当前会员文案">${state.generationErrors
                .filter((item) => item.memberId === member.id)
                .map((item) => `<p class="alert">${escapeHtml(item.error)}</p>`)
                .join(
                    '',
                )}${draft ? currentDraft(draft, allowed) : '<div class="empty studio-empty">为这位会员生成话术后，可以在这里修改、预览和复制。匹配产品图会一起显示。</div>'}</section>
            ${careFollowup(member)}
        </section></div>${careHistory()}`;
}

function currentDraft(draft, allowed) {
    const message = state.copyEdits.get(String(draft.id)) ?? draft.message;
    const products = draft.productIds
        .map((id) => state.products.find((product) => product.id === id))
        .filter(Boolean);
    return `<article class="copy-result" data-copy-result="${draft.id}">
        <details class="studio-reason"><summary>本次推荐依据</summary><p>${escapeHtml(draft.reason)}</p><p class="helper">生成模型：${escapeHtml(state.aiConfig.models.find((model) => model.id === draft.model)?.label || draft.model)}</p></details>
        <label for="copy-message-${draft.id}">话术内容 · 可以直接修改</label><textarea id="copy-message-${draft.id}" data-copy-edit="${draft.id}" maxlength="1000">${escapeHtml(message)}</textarea>
        <div class="copy-products">${products
            .map((product) => {
                const image = productImage(product);
                return `<div class="copy-product">${image ? `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(product.name)}" loading="lazy">` : '<div class="image-placeholder">待补图</div>'}<div class="copy-product-info"><strong>${escapeHtml(product.name)}</strong><span>${money(product.price)}</span>${productCredit(product)}${image ? `<a href="${escapeHtml(image.url)}?download=1" download>下载图片</a>` : `<button data-action="bind-product-image" data-id="${product.id}">上传门店图</button>`}</div></div>`;
            })
            .join('')}</div>
        <details class="wb-customer-preview"><summary>顾客沟通预览</summary><div class="wb-chat-message" data-chat-preview="${draft.id}">${escapeHtml(message)}</div></details>
        <div class="wb-actions"><button class="primary" data-action="copy-message" data-id="${draft.id}" ${allowed ? '' : 'disabled'}>复制话术</button><button data-action="save-copy" data-id="${draft.id}">保存修改</button></div><p class="wb-note">${draft.copiedAt ? '已复制素材' : '尚未复制'} · 图片需单独下载后发送 · 修改保存至数据库</p>
    </article>`;
}

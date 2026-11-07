import { state } from '../state.js';
import { escapeHtml, head, headModal, modal } from '../components.js';
import { canContact, money } from '../rules-client.js';
import { productImage } from '../product-images.js';
import { productPhoto, productCredit } from '../components.js';
import { imageUpload } from './products.js';

function studioPage() {
    const contexts = [...state.selectedMembers]
        .map((id) => state.members.find((member) => member.id === id))
        .filter(Boolean);
    return `${head('把了解，变成一句自然的沟通。', 'STUDIO', '选择会员与模型，生成每人专属的文案和产品配图。', '<button class="btn outline" data-action="catalog">产品与图片库</button>')}
            <div class="studio-grid wb-layout"><section class="studio-context wb-context">
                <section class="context-panel"><div class="panel-head"><h3>这次，为谁准备？</h3><button class="text-btn" data-view="members">挑选会员 ↗</button></div>
                ${contexts.map((member) => `<div class="context-list"><div class="wb-member"><span class="member-avatar">${escapeHtml((member.displayName || member.id).slice(0, 1))}</span><div><h3>${escapeHtml(member.displayName || member.id)}</h3><p>${member.id} · ${escapeHtml(member.level)}</p></div></div><dl class="wb-facts"><div><dt>未到店</dt><dd><strong>${member.days} 天</strong></dd></div><div><dt>个人周期</dt><dd><strong>${member.cycle} 天</strong> · 当前 ${member.ratio} 倍</dd></div><div><dt>偏好风格</dt><dd>${escapeHtml(member.style)} / ${escapeHtml(member.secondary)}</dd></div><div><dt>护理需求</dt><dd>${escapeHtml(member.careProfile?.tags || '暂无明确记录')}</dd></div></dl><section class="wb-note-section"><h3>老板娘补充的细节</h3><p>${escapeHtml(member.latestNote || '暂无记录，先了解本人意愿再推荐。')}</p><button data-member="${member.id}">查看完整会员档案</button></section></div>`).join('') || '<p class="helper">先到会员档案勾选，或从档案中为单人准备话术。</p>'}</section>${aiPanel()}</section>
                <section class="studio-output wb-output"><div class="output-header wb-output-header"><div><h3>沟通草稿与配图</h3><p>核对、修改，再复制给客户。</p></div><span class="pill">AI 辅助 · 人工核对</span></div><div class="output-body">${copyResults()}</div></section></div>`;
}

function catalogModal() {
    modal(
        `${headModal('THE COLLECTION', '产品与图片库')}<p>查看门店产品，上传图片会保存在数据库。</p><button class="primary" data-view="products" data-action="close">打开完整产品库 →</button><div class="catalog-modal-list">${state.products.map((product) => `<article class="wb-product">${productPhoto(product)}<div><h4>${escapeHtml(product.name)}</h4><p>${money(product.price)} · ${escapeHtml(product.style)}</p>${productCredit(product)}<button data-action="bind-product-image" data-id="${escapeHtml(product.id)}">绑定图片</button></div></article>`).join('')}</div>`,
    );
}

function aiPanel() {
    const selected = [...state.selectedMembers]
        .map(
            (id) =>
                `<button class="filterbtn" data-action="remove-selected" data-id="${id}" aria-label="取消选择 ${id}">${id} ×</button>`,
        )
        .join('');
    return `<section class="panel ai-tools" aria-label="个性化文案">
            <div class="panel-head"><h3>为选中会员生成文案与配图</h3><span>每批最多 5 人 · 店主自行复制发送</span></div>
            <p class="helper">先按活跃度或风格筛选，勾选会员后生成。每位会员分别匹配产品，生成结果供店主核对和修改。</p>
            <div class="ai-controls">
                <label for="ai-model">生成模型</label>
                <select id="ai-model">${state.aiConfig.models.map((model) => `<option value="${escapeHtml(model.id)}" ${model.id === state.selectedModel ? 'selected' : ''}>${escapeHtml(model.label)}</option>`).join('')}</select>
                <button class="btn" data-action="generate-copy" ${state.selectedMembers.size && state.aiConfig.configured ? '' : 'disabled'}>生成选中会员文案</button>
                <button class="btn outline" data-action="clear-selected">清空选择</button>
            </div>
            <div id="selected-members" class="goal-tabs">${selected || '<span class="helper">尚未勾选会员，可跨页选择。</span>'}</div>
            <p id="ai-generation-status" role="status"></p>
            ${state.aiConfig.configured ? '' : '<p class="notice">请在后端配置 AI_API_KEY 并重启服务。</p>'}
            ${imageUpload()}
        </section>`;
}

function copyResults() {
    const cards = state.copyDrafts.map((draft) => {
        const member = state.members.find((member) => member.id === draft.memberId);
        const pictures = draft.productIds
            .map((id) => {
                const product = state.products.find((product) => product.id === id);
                if (!product)
                    return `<p class="notice">产品 ${escapeHtml(id)} 已从目录移除，请重新生成。</p>`;
                const image = productImage(product);
                return `<div class="copy-product">
                    ${
                        image
                            ? `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(product.name)}" loading="lazy">
                        <a class="filterbtn" href="${escapeHtml(image.url)}?download=1" download>下载图片</a>`
                            : '<div class="image-placeholder">该产品待补图</div>'
                    }
                    <strong>${escapeHtml(product.name)}</strong><span>${money(product.price)}</span>${productCredit(product)}
                </div>`;
            })
            .join('');
        return `<article class="copy-result" data-copy-result="${draft.id}">
                <div class="panel-head"><h3>${member?.displayName ? escapeHtml(member.displayName) + ' · ' : ''}${draft.memberId} · 个性化文案</h3><span>${escapeHtml(draft.model)}</span></div>
                <p class="helper">${escapeHtml(draft.reason)}</p>
                <label for="copy-message-${draft.id}">发送前核对并修改文案</label>
                <textarea id="copy-message-${draft.id}" data-copy-edit="${draft.id}" maxlength="1000">${escapeHtml(state.copyEdits.get(String(draft.id)) ?? draft.message)}</textarea>
                <div class="channel-preview wb-customer-preview"><div class="chat-head"><span class="avatar">店</span>顾客沟通预览</div><div class="chat-bubble wb-chat-message" data-chat-preview="${draft.id}">${escapeHtml(state.copyEdits.get(String(draft.id)) ?? draft.message)}</div></div><div class="copy-products">${pictures}</div>
                <div class="button-row">
                    <button class="btn" data-action="copy-message" data-id="${draft.id}" ${member && canContact(member) ? '' : 'disabled'}>复制文案</button>
                    <button class="btn outline" data-action="save-copy" data-id="${draft.id}">保存修改</button>
                    <button class="btn outline" data-action="regenerate-copy" data-id="${draft.id}" ${member && canContact(member) ? '' : 'disabled'}>重新生成</button>
                </div>
                <p class="helper">${draft.copiedAt ? '已复制素材' : '尚未复制'} · 图片需单独下载后发送</p>
                <details><summary>查看 AI 原始文案</summary><p>${escapeHtml(draft.originalMessage)}</p></details>
            </article>`;
    });
    return `<section id="copy-results" class="section-spacer" aria-label="文案生成结果">
            <h2>文案与配图</h2>
            ${state.generationErrors.map((item) => `<p class="alert">${item.memberId}：${escapeHtml(item.error)}</p>`).join('')}
            ${cards.slice(0, 5).join('') || '<p class="helper">生成结果会保存在这里，刷新后可继续编辑和复制。</p>'}
            ${cards.length > 5 ? `<details><summary>更早的文案 · ${cards.length - 5} 条</summary>${cards.slice(5).join('')}</details>` : ''}
        </section>`;
}

export { studioPage, catalogModal };

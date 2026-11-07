import { state } from '../state.js';
import { escapeHtml, head, productCredit, productPhoto } from '../components.js';
import { money } from '../rules-client.js';
import { productImage } from '../product-images.js';

const TYPES = {
    nail_style: '美甲款式',
    care_product: '护理产品',
    care_service: '护理服务',
};

export function imageUpload() {
    return `<details id="product-upload"><summary>上传产品图并绑定产品</summary><p class="helper">支持 PNG、JPEG、WebP，单张最多 5 MB。门店上传图保存至数据库，优先替换网络参考图。</p><div class="ai-controls"><label for="image-product">产品</label><select id="image-product">${state.products.map((product) => `<option value="${escapeHtml(product.id)}">${escapeHtml(product.name)} · ${product.imageUrl ? '已有门店图' : '待上传门店图'}</option>`).join('')}</select><input type="file" id="product-image-file" accept="image/png,image/jpeg,image/webp" aria-label="选择产品图片"><button class="btn outline" data-action="upload-product-image">上传并绑定</button></div></details>`;
}

export function productsPage() {
    const query = state.productSearch.trim().toLowerCase();
    const products = state.products.filter(
        (product) =>
            (state.productFilter === 'all' || product.type === state.productFilter) &&
            (!state.productsWithoutImage || !productImage(product)) &&
            (!query ||
                `${product.id} ${product.name} ${product.style} ${product.description}`
                    .toLowerCase()
                    .includes(query)),
    );
    const pages = Math.max(1, Math.ceil(products.length / 8));
    state.productPage = Math.max(1, Math.min(state.productPage, pages));
    const choices = [['all', '全部'], ...Object.entries(TYPES)];
    return `${head('让每一款，都有一张好看的图。', 'THE COLLECTION', '按已有门店产品展示参考图，随时替换成自己的实拍。', '<button data-view="members">回到会员档案</button>')}
        <div class="catalog-tools"><div class="catalog-tabs">${choices.map(([key, label]) => `<button data-product-filter="${key}" aria-pressed="${state.productFilter === key}">${label} <small>${state.products.filter((product) => key === 'all' || product.type === key).length}</small></button>`).join('')}</div><div class="catalog-search"><label for="product-search">查找产品或款式</label><input id="product-search" type="search" value="${escapeHtml(state.productSearch)}" placeholder="例如：法式、护理油"></div></div>
        <div class="catalog-status"><span>找到 ${products.length} 项 · 共 ${state.products.length} 项门店产品</span><label class="check-label"><input id="products-without-image" type="checkbox" ${state.productsWithoutImage ? 'checked' : ''}>只看无图项目</label></div>
        <div class="catalog-grid">${
            products
                .slice((state.productPage - 1) * 8, state.productPage * 8)
                .map((product) => {
                    const image = productImage(product);
                    return `<article class="catalog-product"><div class="catalog-product-image">${productPhoto(product)}<span class="catalog-product-type">${TYPES[product.type] || '门店产品'}</span>${image?.reference ? '<span class="catalog-reference-badge">网络参考图</span>' : ''}</div><div class="catalog-product-body"><div class="catalog-product-title"><h3>${escapeHtml(product.name)}</h3><strong>${money(product.price)}</strong></div><p class="catalog-product-description">${escapeHtml(product.description || product.style)}</p><p class="catalog-product-meta">${escapeHtml(product.id)} · ${escapeHtml(product.style)}</p>${productCredit(product)}<div class="catalog-product-footer"><small>${image?.reference ? '参考图 · 可替换' : image ? '门店上传图' : '实拍待补充'}</small><button data-action="bind-product-image" data-id="${escapeHtml(product.id)}">${product.imageUrl ? '更换图片' : '上传门店图'}</button></div></div></article>`;
                })
                .join('') || '<div class="empty">没有符合条件的产品，请调整筛选。</div>'
        }</div>
        <div class="catalog-pagination"><button data-action="product-prev" ${state.productPage <= 1 ? 'disabled' : ''}>上一页</button><span>${state.productPage} / ${pages}</span><button data-action="product-next" ${state.productPage >= pages ? 'disabled' : ''}>下一页</button></div>
        ${imageUpload()}<p class="catalog-disclaimer">参考图来自你提供的 UI 附件，每张图片保留原始来源，仅用于款式沟通参考；门店上传图优先展示。产品名称与编号对应时才使用参考图，价格与在售目录始终读取现有数据库。</p>`;
}

import { money } from './rules-client.js';
import { productImage } from './product-images.js';

let toastTimer;

const LIFECYCLE_LABELS = {
        active: '活跃',
        due: '待复购',
        low_frequency: '低频',
        dormant: '沉睡',
    },
    TASK_STATUS_LABELS = {
        pending_review: '待审核',
        approved: '已通过',
        rejected: '已拒绝',
        executed_simulated: '已模拟执行',
    };

function escapeHtml(s) {
    return String(s ?? '').replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
}

function num(n) {
    return Number(n).toLocaleString('zh-CN');
}

const ICONS = {
    home: '<path d="m3 10 9-7 9 7v10H3z"/><path d="M9 20v-7h6v7"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    tasks: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    chart: '<path d="M3 3v18h18"/><path d="m7 16 4-5 3 2 5-7"/>',
    spark: '<path d="m12 3 1.9 6.1L20 11l-6.1 1.9L12 19l-1.9-6.1L4 11l6.1-1.9z"/><path d="m20 18 .6 1.4L22 20l-1.4.6L20 22l-.6-1.4L18 20l1.4-.6z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/>',
    send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
    check: '<path d="m20 6-11 11-5-5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
    database:
        '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 2 4 3 9 3s9-1 9-3V5M3 12c0 2 4 3 9 3s9-1 9-3"/>',
    arrow: '<path d="m5 12 14 0m-6-6 6 6-6 6"/>',
    filter: '<path d="M4 7h16M7 12h10M10 17h4"/>',
    shield: '<path d="M12 2 4 6v6c0 5 3 8 8 10 5-2 8-5 8-10V6z"/><path d="m8 12 3 3 5-5"/>',
    file: '<path d="M5 2h9l5 5v15H5zM14 2v5h5M8 12h8M8 16h8"/>',
};

function icon(k) {
    return `<svg class="ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k] || ICONS.spark}</svg>`;
}

function chip(s) {
    return `<span class="chip ${escapeHtml(s)}">${escapeHtml(TASK_STATUS_LABELS[s] || LIFECYCLE_LABELS[s] || s)}</span>`;
}

function toast(txt) {
    const el = document.getElementById('toaster');
    el.innerHTML = `<div class="toast" role="status">${escapeHtml(txt)}</div>`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        el.innerHTML = '';
    }, 3200);
}

function head(title, kicker, sub, right = '') {
    return `<div class="wb-heading page-head"><div><h2>${title}</h2><p>${sub}</p></div>${right ? `<div class="button-row">${right}</div>` : ''}</div>`;
}

function planProgress(tasks) {
    const count = (status) => tasks.filter((task) => task.status === status).length;
    return `<div class="growth-process" aria-label="复购行动进度"><div><span>发现机会</span><b>名单已准备</b></div><span aria-hidden="true">→</span><button data-view="campaigns"><span>人工审核</span><b>${count('pending_review')} 条待确认</b></button><span aria-hidden="true">→</span><button data-view="campaigns"><span>模拟触达</span><b>${count('approved')} 条待执行</b></button><span aria-hidden="true">→</span><button data-view="reports"><span>追踪复购</span><b>${count('executed_simulated')} 条已有结果</b></button></div>`;
}

function productPhoto(product) {
    const image = productImage(product);
    return `<div class="wb-product-photo">${image ? `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(product.name)}${image.reference ? ' · 网络参考图' : ' · 门店上传图'}" loading="lazy">` : '<span>产品实拍<br>待上传</span>'}</div>`;
}

function productCredit(product) {
    const image = productImage(product);
    return image?.reference
        ? `<a class="catalog-photo-credit" href="${escapeHtml(image.sourceUrl)}" target="_blank" rel="noopener noreferrer">网络参考图来源 · ${escapeHtml(new URL(image.sourceUrl).hostname.replace(/^www\./, ''))} ↗</a>`
        : `<span class="helper">${image ? '门店上传图' : '产品实拍待上传'}</span>`;
}

function metric(label, value, meta) {
    return `<div class="metric"><label>${label}</label><strong>${num(value)}</strong><small>${meta}</small></div>`;
}

function modal(html) {
    document.getElementById('overlay').innerHTML =
        `<div class="modal-mask" data-action="close-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-label="详情">${html}</div></div>`;
}

function closeModal() {
    document.getElementById('overlay').innerHTML = '';
}

function headModal(kicker, title) {
    return `<div class="modal-head"><div><p class="kicker">${kicker}</p><h2>${title}</h2></div><button class="modal-close" data-action="close" aria-label="关闭">×</button></div>`;
}

function sourceHistory(details) {
    const sections = [
        [
            '最近消费记录',
            details.orders.map((row) => [
                row.order_date,
                row.style,
                money(row.amount),
                row.technician,
            ]),
        ],
        ['会员备注', details.notes.map((row) => [row.created_at, row.note_text, row.author_name])],
        [
            '历史联系',
            details.contacts.map((row) => [
                row.contact_date,
                row.channel,
                row.outcome,
                row.staff_name,
            ]),
        ],
        [
            '预约记录',
            details.appointments.map((row) => [row.appointment_date, row.status, row.technician]),
        ],
    ];
    let html = sections
        .map(
            ([title, rows]) => `<details><summary>${title} · 最近 ${rows.length} 条</summary>
            ${rows.length ? `<ul class="source-history">${rows.map((cells) => `<li>${cells.map(escapeHtml).join(' · ')}</li>`).join('')}</ul>` : '<p class="helper">暂无来源记录。</p>'}</details>`,
        )
        .join('');
    const profile = details.careProfile;
    if (profile)
        html += `<details><summary>护理档案</summary>
            <p>最近服务：${escapeHtml(profile.last_service_type)}</p>
            <p>需求标签：${escapeHtml(profile.care_need_tags)}</p>
            <p>建议服务：${escapeHtml(profile.preferred_care_service)}</p>
            <p>${escapeHtml(profile.care_guidance)}</p>
            <p class="helper">来源计划日期：${escapeHtml(profile.recommended_followup_date)} · 状态 ${escapeHtml(profile.care_followup_status)}</p>
        </details>`;
    return html;
}

export {
    escapeHtml,
    num,
    icon,
    chip,
    toast,
    head,
    metric,
    modal,
    closeModal,
    headModal,
    sourceHistory,
    LIFECYCLE_LABELS,
    TASK_STATUS_LABELS,
    planProgress,
    productPhoto,
    productCredit,
};

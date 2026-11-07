import { state } from '../state.js';
import { canContact, money, productFor } from '../rules-client.js';
import {
    LIFECYCLE_LABELS,
    chip,
    escapeHtml,
    head,
    headModal,
    icon,
    modal,
    num,
    sourceHistory,
} from '../components.js';
import { api } from '../api.js';

function membersPage() {
    const filtered = state.members.filter(
        (member) =>
            (state.filter === 'all' ||
                member.lifecycle === state.filter ||
                (state.filter === 'high' && member.spend >= 1800) ||
                (state.filter === 'balance' && member.bal > 0) ||
                (state.filter === 'contactable' && canContact(member))) &&
            (!state.search ||
                `${member.id} ${member.displayName || ''} ${member.style} ${member.latestNote || ''}`
                    .toLowerCase()
                    .includes(state.search.toLowerCase())),
    );
    const perPage = 10,
        pages = Math.max(1, Math.ceil(filtered.length / perPage));
    state.page = Math.max(1, Math.min(state.page, pages));
    if (!state.members.some((member) => member.id === state.profileMemberId))
        state.profileMemberId = state.members[0]?.id;
    const visible = filtered.slice((state.page - 1) * perPage, state.page * perPage);
    return `${head(
        '会员档案',
        'MEMBERS',
        '消费记录、偏好和沟通细节，让每一次联系都有依据。',
        `<button class="btn" data-view="studio">打开话术工作台 · 已选 ${state.selectedMembers.size} 人</button>`,
    )}
            <div class="member-layout"><section class="member-column">
                <div class="toolbar"><label class="search">${icon('search')}<input id="member-search" placeholder="搜索编号、姓名、风格或历史备注" value="${escapeHtml(state.search)}" aria-label="搜索会员"></label></div>
                <div class="tabs">${[
                    ['all', '全部'],
                    ['active', '活跃'],
                    ['dormant', '沉睡'],
                    ['due', '待复购'],
                    ['low_frequency', '低频'],
                    ['high', '高价值'],
                    ['balance', '有余额'],
                    ['contactable', '可联系'],
                ]
                    .map(
                        ([value, label]) =>
                            `<button data-filter="${value}" class="${state.filter === value ? 'active' : ''}">${label}</button>`,
                    )
                    .join('')}</div>
                <div class="member-list">${
                    visible
                        .map(
                            (
                                member,
                            ) => `<div class="member-row ${state.profileMemberId === member.id ? 'active' : ''}">
                    <input type="checkbox" data-select-member="${member.id}" aria-label="选择 ${member.id}" ${state.selectedMembers.has(member.id) ? 'checked' : ''} ${canContact(member) ? '' : 'disabled title="未通过联系资格"'}>
                    <button class="profile-open" data-action="focus-member" data-id="${member.id}">
                        <span class="avatar">${escapeHtml((member.displayName || member.id).slice(0, 1))}</span>
                        <span><strong>${escapeHtml(member.displayName || member.id)}</strong> ${chip(member.lifecycle)}
                        <small>${member.id} · ${escapeHtml(member.style)}<br>${member.days} 天未到店 · ${money(member.spend)}</small></span>
                    </button></div>`,
                        )
                        .join('') || '<div class="empty">没有找到符合条件的会员</div>'
                }</div>
                <div class="list-foot"><span>共 ${num(filtered.length)} 位 · 已勾选 ${state.selectedMembers.size} 位</span><div class="pagination"><button class="btn outline small" data-action="prev" ${state.page <= 1 ? 'disabled' : ''}>上一页</button><span>${state.page}/${pages}</span><button class="btn outline small" data-action="next" ${state.page >= pages ? 'disabled' : ''}>下一页</button></div></div>
                <p class="helper">复选框用于挑选 AI 文案名单，最多 5 人；点击姓名查看档案。</p>
            </section>${memberProfile(state.members.find((member) => member.id === state.profileMemberId))}</div>`;
}

function memberProfile(member) {
    if (!member) return '<section class="panel empty">暂无会员资料</section>';
    const care = member.careProfile;
    return `<section class="panel detail-panel"><div class="profile-head">
            <span class="avatar">${escapeHtml((member.displayName || member.id).slice(0, 1))}</span>
            <div><h2>${escapeHtml(member.displayName || member.id)}</h2>${chip(member.lifecycle)}<p>${member.id} · ${escapeHtml(member.level)}</p></div>
            <button class="text-btn" data-member="${member.id}">完整档案 ↗</button></div>
            <div class="profile-metrics">${[
                ['最近到店', member.days + ' 天前'],
                ['累计消费', money(member.spend)],
                ['储值余额', money(member.bal)],
                ['历史消费', member.visits + ' 次'],
            ]
                .map(([label, value]) => `<div><small>${label}</small><strong>${value}</strong></div>`)
                .join('')}</div>
            <section class="detail-section"><div class="section-label"><h3>个人复购节奏</h3><span class="pill">平均 ${member.cycle} 天</span></div>
                <div class="cycle-bar"><span style="width:${Math.min(100, (member.days / Math.max(1, member.cycle)) * 30)}%"></span></div>
                <div class="cycle-caption"><span>距离上次到店 ${member.days} 天</span><strong>${member.ratio} 倍偏离</strong></div></section>
            <section class="detail-section detail-two"><div><h3>偏好与权益</h3><p>${escapeHtml(member.style)} / ${escapeHtml(member.secondary)}<br>储值余额是已有权益。</p></div>
                <div><h3>联系资格</h3><p class="pill ${canContact(member) ? 'green' : 'orange'}">${canContact(member) ? '已通过联系资格检查' : '存在联系限制，请查看完整档案'}</p></div></section>
            <section class="detail-section"><div class="section-label"><h3>老板娘备注</h3><span class="pill gray">历史记录</span></div><p>${escapeHtml(member.latestNote || '暂无历史备注。')}</p></section>
            <section class="detail-section"><h3>护理线索</h3><p>${escapeHtml(care?.tags || '可在完整档案中查看服务历史。')}</p>
                ${care ? `<p class="muted">建议服务：${escapeHtml(care.preferredService)} · 来源计划日期 ${escapeHtml(care.followupDate)}</p>` : ''}</section>
            <div id="member-profile-extra" data-id="${member.id}">${state.memberDetailsCache.has(member.id) ? sourceHistory(state.memberDetailsCache.get(member.id)) : '<p class="helper">正在读取历史资料…</p>'}</div>
            <div class="button-row" style="margin-top:20px"><button class="btn" data-action="studio-member" data-id="${member.id}" ${canContact(member) ? '' : 'disabled'}>为这位会员准备话术</button>
                <button class="btn outline" data-action="prepare-care" data-id="${member.id}" ${!canContact(member) || member.careHandled ? 'disabled' : ''}>沟通准备</button></div></section>`;
}

async function loadMemberExtra(id) {
    if (!id || state.memberDetailsCache.has(id) || state.memberDetailsLoading.has(id)) return;
    state.memberDetailsLoading.add(id);
    try {
        const details = await api(`/members/${id}/details`);
        state.memberDetailsCache.set(id, details);
        const container = document.getElementById('member-profile-extra');
        if (container?.dataset.id === id) container.innerHTML = sourceHistory(details);
    } catch (error) {
        const container = document.getElementById('member-profile-extra');
        if (container?.dataset.id === id)
            container.innerHTML = `<p class="helper">历史资料加载失败。${escapeHtml(error.message)}</p><button class="btn outline small" data-action="retry-member" data-id="${id}">重新加载</button>`;
    } finally {
        state.memberDetailsLoading.delete(id);
    }
}

async function memberModal(id) {
    const m = state.members.find((m) => m.id === id);
    if (!m) return;
    const p = productFor(m, state.products);
    modal(
        `${headModal('MEMBER PROFILE · DEMO', m.id + ' · 会员详情')}<div style="display:flex;gap:9px;align-items:center">${chip(m.lifecycle)}<span class="tiny-note">${m.level} · ${m.style} / ${m.secondary}</span></div><div class="detailgrid"><div class="detailitem"><small>距离最近到店</small><strong>${m.days} 天</strong></div><div class="detailitem"><small>平均复购周期</small><strong>${m.cycle} 天</strong></div><div class="detailitem"><small>复购偏离</small><strong>${m.ratio} ×</strong></div><div class="detailitem"><small>累计消费</small><strong>${money(m.spend)}</strong></div><div class="detailitem"><small>储值余额</small><strong>${money(m.bal)}</strong></div><div class="detailitem"><small>历史消费次数</small><strong>${m.visits} 次</strong></div></div><div class="sectlabel">经营判断与数据依据</div><div class="quote">${m.days} 天未到店，平均 ${m.cycle} 天到店一次；当前分类为「${LIFECYCLE_LABELS[m.lifecycle]}」。${canContact(m) ? '已通过初步营销资格过滤，可考虑人工审核后进行个性化关怀。' : !m.consent ? '未获营销授权，已从经营目标候选中排除。' : '当前存在营销资格限制，暂不应营销触达。'}<br/>授权：${m.consent ? '已同意' : '未同意'} · 近期联系：${m.contactDays} 天前 · 未处理投诉：${m.complaint ? '有' : '无'} · 未来预约：${m.appointment ? '有' : '无'}</div><div class="sectlabel">匹配产品参考</div><div class="quote">${p ? `${p.name} · ${p.style} · ${money(p.price)}（演示产品目录）` : '暂无匹配款式'}</div><div id="member-source-details" data-id="${m.id}">正在加载历史记录…</div><div class="modal-actions"><button class="btn outline" data-action="close">关闭</button><button class="btn outline" data-action="prepare-care" data-id="${m.id}" ${!canContact(m) || m.careHandled ? 'disabled' : ''}>沟通准备</button><button class="btn" data-action="newtask" data-id="${m.id}" ${!canContact(m) ? 'disabled title="未通过营销资格"' : ''}>加入待审核任务</button></div>`,
    );
    try {
        const details = await api(`/members/${id}/details`);
        const container = document.getElementById('member-source-details');
        if (container?.dataset.id === id) container.innerHTML = sourceHistory(details);
    } catch (error) {
        const container = document.getElementById('member-source-details');
        if (container?.dataset.id === id) container.textContent = '历史资料加载失败：' + error.message;
    }
}

export { membersPage, loadMemberExtra, memberModal };

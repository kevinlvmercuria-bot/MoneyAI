import { state } from '../state.js';
import { CARE_OUTCOMES, DEMO_DATE, canContact } from '../rules-client.js';
import { LIFECYCLE_LABELS, escapeHtml, head, headModal, icon, modal, num } from '../components.js';

function carePreparation() {
    const member = state.members.find((member) => member.id === state.careMemberId);
    if (!member || !canContact(member) || member.careHandled) return '';
    const draft = state.careDrafts.get(member.id) || {};
    const earliest = new Date(DEMO_DATE);
    earliest.setUTCDate(earliest.getUTCDate() + 14);
    const options = CARE_OUTCOMES.map(
        (outcome) =>
            `<option ${outcome === (draft.outcome || '已沟通') ? 'selected' : ''}>${outcome}</option>`,
    ).join('');
    return `<section id="care-preparation" class="section-spacer" aria-label="沟通准备单">
            <div class="detail-head"><div><p class="eyebrow">PREPARE TO CONNECT / ${member.id}</p>
                <h2 tabindex="-1">${member.id} · 沟通准备单</h2></div><span class="pill">${LIFECYCLE_LABELS[member.lifecycle]}</span></div>
            <div class="detail-grid">
                <div class="facts"><h3>已知事实 / 为什么值得关注</h3>
                    <p>距上次到店 ${member.days} 天，个人周期 ${member.cycle} 天，偏离 ${member.ratio} 倍。<br>最近到店 ${escapeHtml(member.lastVisit)}；偏好 ${escapeHtml(member.style)} / ${escapeHtml(member.secondary)}。</p>
                    <h3>待确认的问题</h3><p>近期是否有美甲需求、上次体验如何、未到店原因，均待本人确认。</p>
                    <h3>可参考的开场</h3><p class="quote">最近还会想做美甲吗？如果暂时不需要也没关系，有什么希望我们改进的地方，也想听听你的想法。</p>
                    <h3>这次沟通的小目标</h3><p>了解本人明确表达的需求，或确认希望怎样被联系。</p>
                    <button class="btn outline" data-member="${member.id}">查看会员详情</button>
                </div>
                <form id="care-form" class="form-panel" data-member-id="${member.id}">
                    <h3>聊完，留下下一步</h3>
                    <div class="field"><label for="care-outcome">处理结果</label><select id="care-outcome" name="outcome">${options}</select></div>
                    <div class="field"><label for="care-note">顾客明确反馈 / 处理原因</label><textarea id="care-note" name="note" required maxlength="1000" placeholder="记录本人表达的需求；未回复时说明联系情况。">${escapeHtml(draft.note || '')}</textarea></div>
                    <div class="field"><label for="care-owner">跟进负责人</label><input id="care-owner" name="owner" required maxlength="80" autocomplete="off" value="${escapeHtml(draft.owner || '')}"></div>
                    <div class="field"><label class="check-label"><input id="care-follow" type="checkbox" name="follow" ${draft.follow ? 'checked' : ''}>记录后续跟进计划</label>
                        <label for="care-date">计划日期 · 基准日 ${DEMO_DATE}</label><input type="date" id="care-date" name="date" value="${escapeHtml(draft.date || earliest.toISOString().slice(0, 10))}" ${draft.follow ? '' : 'disabled'}>
                    </div>
                    <p class="helper">已沟通或未回复的跟进日期至少间隔 14 天。推荐不合适、不再营销不能安排跟进。计划供店主查看。</p>
                    <p class="helper">本次保存的是模拟沟通记录，不计入营销复盘消费。</p>
                    <button class="btn" type="submit">保存关怀记录</button>
                </form>
            </div>
        </section>`;
}

function careHistory() {
    const rows = state.careRecords
        .map(
            (record) => `<tr>
            <td>${record.memberId}</td><td>${record.outcome}</td>
            <td class="wrap">${escapeHtml(record.note)}</td><td>${escapeHtml(record.owner)}</td>
            <td>${record.followUp || '未安排'}</td><td>${record.recordedAsOf}</td>
        </tr>`,
        )
        .join('');
    return `<details id="care-history" ${state.careRecords.length ? 'open' : ''}>
            <summary>关怀记录与后续计划 · ${state.careRecords.length} 条</summary>
            ${rows ? `<div class="table-wrap"><table><thead><tr><th>会员</th><th>处理结果</th><th>反馈 / 原因</th><th>负责人</th><th>计划跟进</th><th>记录基准日</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="helper">还没有关怀记录。</p>'}
            <p class="helper">记录保存至数据库。已处理会员在本轮演示中不再推荐；计划仅供查看，不自动提醒或重新入队。重置演示会清空记录。</p>
        </details>`;
}

function carePage() {
    const records = new Map(state.careRecords.map((record) => [record.memberId, record]));
    const status = (member) =>
        !records.has(member.id)
            ? 'pending'
            : records.get(member.id).outcome === '暂不联系'
              ? 'snoozed'
              : 'done';
    const queue = state.members
        .filter(
            (member) =>
                member.careHandled ||
                (member.careProfile
                    ? member.careProfile.status !== 'not_due' &&
                      member.careProfile.tags !== '无明确护理需求'
                    : canContact(member) && member.ratio > 1.15),
        )
        .sort((a, b) =>
            a.id === 'M0001'
                ? -1
                : b.id === 'M0001'
                  ? 1
                  : (a.careProfile?.followupDate || '').localeCompare(b.careProfile?.followupDate || ''),
        );
    const counts = { pending: 0, done: 0, snoozed: 0 };
    queue.forEach((member) => counts[status(member)]++);
    const visible = queue.filter(
        (member) =>
            (state.careFilter === 'all' || status(member) === state.careFilter) &&
            (!state.careSearch ||
                `${member.id} ${member.displayName || ''} ${member.careProfile?.tags || ''}`
                    .toLowerCase()
                    .includes(state.careSearch.toLowerCase())),
    );
    return `${head('护理后的关怀，也值得被记住。', 'CARE', '根据服务档案准备关怀，记录本人反馈与下一步计划。', '<button class="btn outline" data-action="catalog">查看产品与图片库</button>')}
            <div class="care-summary">${[
                ['pending', '待处理'],
                ['done', '已记录关怀'],
                ['snoozed', '以后再看'],
            ]
                .map(
                    ([value, label]) =>
                        `<div><strong>${num(counts[value])}</strong><span>${label}</span></div>`,
                )
                .join('')}</div>
            <div class="toolbar"><label class="search">${icon('search')}<input id="care-search" aria-label="搜索护理会员" placeholder="搜索会员或护理标签" value="${escapeHtml(state.careSearch)}"></label></div>
            <div class="tabs">${[
                ['pending', '待处理'],
                ['done', '已记录关怀'],
                ['snoozed', '以后再看'],
                ['all', '全部'],
            ]
                .map(
                    ([value, label]) =>
                        `<button class="${state.careFilter === value ? 'active' : ''}" data-action="care-filter" data-id="${value}">${label}</button>`,
                )
                .join('')}</div>
            <section class="care-list">${
                visible
                    .slice(0, state.careLimit)
                    .map((member) => {
                        const record = records.get(member.id);
                        return `<article class="care-row">
                <div class="care-person"><span class="avatar">${escapeHtml((member.displayName || member.id).slice(0, 1))}</span><div><button class="member-link" data-member="${member.id}">${escapeHtml(member.displayName || member.id)} · ${member.id}</button><small>上次服务：${escapeHtml(member.careProfile?.lastService || '查看档案')}</small><small>来源跟进日期：${escapeHtml(member.careProfile?.followupDate || '未安排')}</small></div></div>
                <div class="care-info"><h3>${escapeHtml(member.careProfile?.tags || member.style + '偏好')}</h3><p>${record ? escapeHtml(record.outcome + ' · ' + record.note) : canContact(member) ? '已通过联系资格，可准备关怀。' : '存在联系限制，请先查看档案。'}</p></div>
                <div class="care-actions">${record ? '<button class="btn outline small" data-action="care-history">查看关怀记录</button>' : `<button class="btn secondary small" data-action="prepare-care" data-id="${member.id}" ${canContact(member) ? '' : 'disabled'}>记录关怀与跟进</button>`}
                <button class="btn outline small" data-action="studio-member" data-id="${member.id}" ${canContact(member) ? '' : 'disabled'}>准备话术</button></div></article>`;
                    })
                    .join('') || '<div class="empty">当前分类暂无会员</div>'
            }</section>
            <div class="list-foot"><span>展示 ${Math.min(state.careLimit, visible.length)} / ${num(visible.length)} 位</span><button class="btn outline small" data-action="more-care" ${state.careLimit >= visible.length ? 'disabled' : ''}>再看 15 位</button></div>
            ${carePreparation()}${careHistory()}`;
}

function careModal() {
    modal(
        `${headModal('AFTERCARE · PRODUCT IDEA', '美甲后护理与维护建议')}<p class="sub" style="margin-bottom:18px">这是一项可加入未来版本的服务策略，不应机械地按天数向所有会员发送消息。</p>${[
            ['做完后的日常护理', '提供甲周保湿、减少碰撞、不要自行撕甲的建议。'],
            ['约 1–2 周后按需关怀', '若获得联系授权，可询问是否出现翘边、脱落或不适；优先处理售后。'],
            [
                '约 2–3 周结合服务类型提示维护',
                '按甲油胶、延长甲等实际项目和顾客反馈，考虑卸甲或补甲预约。',
            ],
            ['顾客决定再做时推荐新品', '结合其历史偏好和真实产品清单，不虚构折扣或库存。'],
        ]
            .map(
                ([h, b], i) =>
                    `<div class="recommend"><div class="r-ico" style="font-size:15px;font-weight:800">0${i + 1}</div><div><h4>${h}</h4><p>${b}</p></div></div>`,
            )
            .join(
                '',
            )}<p class="notice">护理或健康信息应避免当作诊断。所有主动营销依然遵守授权、联系冷却期和人工审核规则。</p><div class="modal-actions"><button class="btn" data-action="close">知道啦</button></div>`,
    );
}

export { carePage, careModal };

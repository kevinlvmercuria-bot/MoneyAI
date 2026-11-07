(() => {
    'use strict';
    const {
        GOALS,
        SCENARIOS,
        DEMO_SERVICE_PRICE,
        money,
        canContact,
        priorityScore,
        productFor,
        goalReason,
        goalCandidates,
        buildReviewTask,
        DEMO_DATE,
        CARE_OUTCOMES,
    } = NailMateRules;
    const LIFECYCLE_LABELS = { active: '活跃', due: '待复购', low_frequency: '低频', dormant: '沉睡' },
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

    let members = [];
    let tasks = [];
    let logs = [];
    let careRecords = [];
    let products = [];
    let dataSource = {};
    let careMemberId = null;
    const careDrafts = new Map();
    let saving = false;
    let copyDrafts = [];
    let aiConfig = { models: [], configured: false };
    let selectedModel = '';
    const selectedMembers = new Set();
    const copyEdits = new Map();
    let generationErrors = [];

    async function api(path, body) {
        const options =
            body instanceof Blob
                ? {
                      method: 'POST',
                      headers: { 'Content-Type': body.type },
                      body,
                  }
                : body === undefined
                  ? {}
                  : {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body),
                    };
        const response = await fetch('/api' + path, options);
        const payload = await response.json();
        if (!response.ok) {
            throw Object.assign(new Error(payload.error || '请求失败'), { status: response.status });
        }
        return payload;
    }

    function applyState(state) {
        const previousSource = dataSource.sourceHash;
        ({
            members,
            tasks,
            logs,
            careRecords = [],
            products = [],
            dataSource = {},
            copyDrafts = [],
            ai: aiConfig = { models: [], configured: false },
        } = state);
        if (previousSource !== dataSource.sourceHash) memberDetailsCache.clear();
        if (!aiConfig.models.some((model) => model.id === selectedModel))
            selectedModel = aiConfig.defaultModel || '';
        for (const id of selectedMembers) {
            if (!members.some((member) => member.id === id && canContact(member)))
                selectedMembers.delete(id);
        }
    }

    async function save(path, body, onSuccess) {
        if (saving) return;
        saving = true;
        const controls = Array.from(
            document.querySelectorAll(
                'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)',
            ),
        );
        controls.forEach((control) => {
            control.disabled = true;
        });
        document.getElementById('app').setAttribute('aria-busy', 'true');
        toast(path === '/copy/generate' ? 'AI 正在生成文案，请稍候…' : '正在保存，请稍候…');
        if (path === '/copy/generate') {
            const status = document.getElementById('ai-generation-status');
            if (status) status.textContent = '正在逐位生成，请等待本批完成。';
        }
        try {
            const response = await api(path, body);
            applyState(response.state);
            await onSuccess(response);
        } catch (error) {
            if (error.status === 409) {
                try {
                    applyState(await api('/state'));
                    closeModal();
                    render();
                } catch {
                    toast('同步失败，请检查服务连接后刷新页面');
                    return;
                }
            }
            toast(error.message || '连接服务器失败');
        } finally {
            saving = false;
            controls.forEach((control) => {
                if (control.isConnected) control.disabled = false;
            });
            document.getElementById('app').removeAttribute('aria-busy');
            const status = document.getElementById('ai-generation-status');
            if (status) status.textContent = '';
        }
    }

    let view = 'dashboard',
        filter = 'all',
        search = '',
        page = 1,
        taskFilter = 'all';
    let profileMemberId = 'M0001';
    let careFilter = 'pending';
    let careSearch = '';
    let careLimit = 15;
    const memberDetailsCache = new Map();
    const memberDetailsLoading = new Set();
    let selectedGoal = 'wake';
    let reportGoal = 'all';
    let toastTimer;

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
    function setView(v) {
        view = v;
        document.body.classList.remove('menu-open');
        document.getElementById('menu-toggle')?.setAttribute('aria-expanded', 'false');
        page = 1;
        render();
        window.scrollTo(0, 0);
    }
    function head(title, kicker, sub, right = '') {
        return `<header class="page-head"><div><h1>${title}</h1><p>${sub}</p></div>${right ? `<div class="button-row">${right}</div>` : ''}</header>`;
    }

    function metrics() {
        const counts = Object.fromEntries(
            ['active', 'due', 'low_frequency', 'dormant'].map((s) => [
                s,
                members.filter((m) => m.lifecycle === s).length,
            ]),
        );
        return {
            counts,
            eligibleDormant: members.filter((m) => m.lifecycle === 'dormant' && canContact(m)).length,
            balanced: members.filter((m) => m.bal > 0).length,
            high: members.filter((m) => m.spend >= 1800).length,
            pending: tasks.filter((t) => t.status === 'pending_review').length,
            executed: tasks.filter((t) => t.status === 'executed_simulated').length,
        };
    }
    function metric(label, value, meta) {
        return `<div class="metric"><label>${label}</label><strong>${num(value)}</strong><small>${meta}</small></div>`;
    }

    function goalPanel() {
        const candidates = goalCandidates(members, tasks, selectedGoal, products);
        const tabs = Object.entries(GOALS)
            .map(
                ([key, goal]) =>
                    `<button class="filterbtn ${selectedGoal === key ? 'active' : ''}" aria-pressed="${selectedGoal === key}" data-goal="${key}">${goal.label}</button>`,
            )
            .join('');
        const cards = candidates
            .map((member, index) => {
                const draft = buildReviewTask(member, null, selectedGoal, products);
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
                        <h3>${GOALS[selectedGoal].label}</h3>
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

    function prepareCare(id) {
        const member = members.find((member) => member.id === id);
        if (!member || !canContact(member) || member.careHandled)
            return toast('会员已处理或不满足联系资格');
        careMemberId = id;
        closeModal();
        if (view !== 'care') setView('care');
        else render();
        const section = document.getElementById('care-preparation');
        section.scrollIntoView({ block: 'start' });
        section.querySelector('h2').focus({ preventScroll: true });
    }

    function carePreparation() {
        const member = members.find((member) => member.id === careMemberId);
        if (!member || !canContact(member) || member.careHandled) return '';
        const draft = careDrafts.get(member.id) || {};
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
        const rows = careRecords
            .map(
                (record) => `<tr>
            <td>${record.memberId}</td><td>${record.outcome}</td>
            <td class="wrap">${escapeHtml(record.note)}</td><td>${escapeHtml(record.owner)}</td>
            <td>${record.followUp || '未安排'}</td><td>${record.recordedAsOf}</td>
        </tr>`,
            )
            .join('');
        return `<details id="care-history" ${careRecords.length ? 'open' : ''}>
            <summary>关怀记录与后续计划 · ${careRecords.length} 条</summary>
            ${rows ? `<div class="table-wrap"><table><thead><tr><th>会员</th><th>处理结果</th><th>反馈 / 原因</th><th>负责人</th><th>计划跟进</th><th>记录基准日</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="helper">还没有关怀记录。</p>'}
            <p class="helper">记录保存至数据库。已处理会员在本轮演示中不再推荐；计划仅供查看，不自动提醒或重新入队。重置演示会清空记录。</p>
        </details>`;
    }

    function saveCare(form) {
        const data = new FormData(form);
        const memberId = form.dataset.memberId;
        return save(
            '/care-records',
            {
                memberId,
                outcome: data.get('outcome'),
                note: data.get('note'),
                owner: data.get('owner'),
                followUp: data.has('follow') ? data.get('date') : null,
            },
            () => {
                careDrafts.delete(memberId);
                careMemberId = null;
                render();
                document.getElementById('care-history').scrollIntoView({ block: 'nearest' });
                toast('关怀记录与后续计划已保存');
            },
        );
    }

    function flipCard(id) {
        const hanger = document.querySelector(`[data-candidate="${id}"]`);
        if (!hanger) return;
        const card = hanger.querySelector('.card');
        const flipped = card.classList.toggle('flipped');
        const front = card.querySelector('.front');
        const back = card.querySelector('.back');
        front.inert = flipped;
        back.inert = !flipped;
        front.setAttribute('aria-hidden', String(flipped));
        back.setAttribute('aria-hidden', String(!flipped));
        (flipped ? back : front).querySelector('[data-action="flip"]').focus({ preventScroll: true });
    }

    function dashboard() {
        const stats = metrics();
        const distribution = Object.entries(stats.counts)
            .map(
                ([lifecycle, count], i) =>
                    `<div class="life-row"><span>${LIFECYCLE_LABELS[lifecycle]}</span><div class="track"><span style="width:${(count / Math.max(1, members.length)) * 100}%;background:${['#a7c5b0', '#ddba88', '#cd9bb2', '#95657f'][i]}"></span></div><strong>${num(count)}</strong></div>`,
            )
            .join('');
        return `<section class="welcome"><div><h1>不只记得款式，<br>也记得每位顾客的小细节。</h1>
            <p>从会员复购节奏、消费偏好和护理档案，找到合适的关怀机会。</p>
            <button class="btn" data-action="analyze">${icon('spark')}运行经营分析</button></div>
            <div class="welcome-aside"><strong>今天，从一次自然的问候开始。</strong><p>挑选会员，准备文案和产品图，再由店主决定怎样联系。</p></div></section>
            <section class="metrics">${metric('会员总数', members.length, '数据库中的虚拟会员档案')}${metric('可联系沉睡会员', stats.eligibleDormant, '已过滤联系资格限制')}${metric('持有储值余额', stats.balanced, '权益提醒不等于新增收入')}${metric('待审核任务', stats.pending, '由店主做最后决定')}</section>
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

    function membersPage() {
        const filtered = members.filter(
            (member) =>
                (filter === 'all' ||
                    member.lifecycle === filter ||
                    (filter === 'high' && member.spend >= 1800) ||
                    (filter === 'balance' && member.bal > 0) ||
                    (filter === 'contactable' && canContact(member))) &&
                (!search ||
                    `${member.id} ${member.displayName || ''} ${member.style} ${member.latestNote || ''}`
                        .toLowerCase()
                        .includes(search.toLowerCase())),
        );
        const perPage = 10,
            pages = Math.max(1, Math.ceil(filtered.length / perPage));
        page = Math.max(1, Math.min(page, pages));
        if (!members.some((member) => member.id === profileMemberId)) profileMemberId = members[0]?.id;
        const visible = filtered.slice((page - 1) * perPage, page * perPage);
        return `${head(
            '会员档案',
            'MEMBERS',
            '消费记录、偏好和沟通细节，让每一次联系都有依据。',
            `<button class="btn" data-view="studio">打开话术工作台 · 已选 ${selectedMembers.size} 人</button>`,
        )}
            <div class="member-layout"><section class="member-column">
                <div class="toolbar"><label class="search">${icon('search')}<input id="member-search" placeholder="搜索编号、姓名、风格或历史备注" value="${escapeHtml(search)}" aria-label="搜索会员"></label></div>
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
                            `<button data-filter="${value}" class="${filter === value ? 'active' : ''}">${label}</button>`,
                    )
                    .join('')}</div>
                <div class="member-list">${
                    visible
                        .map(
                            (
                                member,
                            ) => `<div class="member-row ${profileMemberId === member.id ? 'active' : ''}">
                    <input type="checkbox" data-select-member="${member.id}" aria-label="选择 ${member.id}" ${selectedMembers.has(member.id) ? 'checked' : ''} ${canContact(member) ? '' : 'disabled title="未通过联系资格"'}>
                    <button class="profile-open" data-action="focus-member" data-id="${member.id}">
                        <span class="avatar">${escapeHtml((member.displayName || member.id).slice(0, 1))}</span>
                        <span><strong>${escapeHtml(member.displayName || member.id)}</strong> ${chip(member.lifecycle)}
                        <small>${member.id} · ${escapeHtml(member.style)}<br>${member.days} 天未到店 · ${money(member.spend)}</small></span>
                    </button></div>`,
                        )
                        .join('') || '<div class="empty">没有找到符合条件的会员</div>'
                }</div>
                <div class="list-foot"><span>共 ${num(filtered.length)} 位 · 已勾选 ${selectedMembers.size} 位</span><div class="pagination"><button class="btn outline small" data-action="prev" ${page <= 1 ? 'disabled' : ''}>上一页</button><span>${page}/${pages}</span><button class="btn outline small" data-action="next" ${page >= pages ? 'disabled' : ''}>下一页</button></div></div>
                <p class="helper">复选框用于挑选 AI 文案名单，最多 5 人；点击姓名查看档案。</p>
            </section>${memberProfile(members.find((member) => member.id === profileMemberId))}</div>`;
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
            <div id="member-profile-extra" data-id="${member.id}">${memberDetailsCache.has(member.id) ? sourceHistory(memberDetailsCache.get(member.id)) : '<p class="helper">正在读取历史资料…</p>'}</div>
            <div class="button-row" style="margin-top:20px"><button class="btn" data-action="studio-member" data-id="${member.id}" ${canContact(member) ? '' : 'disabled'}>为这位会员准备话术</button>
                <button class="btn outline" data-action="prepare-care" data-id="${member.id}" ${!canContact(member) || member.careHandled ? 'disabled' : ''}>沟通准备</button></div></section>`;
    }

    async function loadMemberExtra(id) {
        if (!id || memberDetailsCache.has(id) || memberDetailsLoading.has(id)) return;
        memberDetailsLoading.add(id);
        try {
            const details = await api(`/members/${id}/details`);
            memberDetailsCache.set(id, details);
            const container = document.getElementById('member-profile-extra');
            if (container?.dataset.id === id) container.innerHTML = sourceHistory(details);
        } catch (error) {
            const container = document.getElementById('member-profile-extra');
            if (container?.dataset.id === id)
                container.innerHTML = `<p class="helper">历史资料加载失败。${escapeHtml(error.message)}</p><button class="btn outline small" data-action="retry-member" data-id="${id}">重新加载</button>`;
        } finally {
            memberDetailsLoading.delete(id);
        }
    }

    function carePage() {
        const records = new Map(careRecords.map((record) => [record.memberId, record]));
        const status = (member) =>
            !records.has(member.id)
                ? 'pending'
                : records.get(member.id).outcome === '暂不联系'
                  ? 'snoozed'
                  : 'done';
        const queue = members
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
                      : (a.careProfile?.followupDate || '').localeCompare(
                            b.careProfile?.followupDate || '',
                        ),
            );
        const counts = { pending: 0, done: 0, snoozed: 0 };
        queue.forEach((member) => counts[status(member)]++);
        const visible = queue.filter(
            (member) =>
                (careFilter === 'all' || status(member) === careFilter) &&
                (!careSearch ||
                    `${member.id} ${member.displayName || ''} ${member.careProfile?.tags || ''}`
                        .toLowerCase()
                        .includes(careSearch.toLowerCase())),
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
            <div class="toolbar"><label class="search">${icon('search')}<input id="care-search" aria-label="搜索护理会员" placeholder="搜索会员或护理标签" value="${escapeHtml(careSearch)}"></label></div>
            <div class="tabs">${[
                ['pending', '待处理'],
                ['done', '已记录关怀'],
                ['snoozed', '以后再看'],
                ['all', '全部'],
            ]
                .map(
                    ([value, label]) =>
                        `<button class="${careFilter === value ? 'active' : ''}" data-action="care-filter" data-id="${value}">${label}</button>`,
                )
                .join('')}</div>
            <section class="care-list">${
                visible
                    .slice(0, careLimit)
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
            <div class="list-foot"><span>展示 ${Math.min(careLimit, visible.length)} / ${num(visible.length)} 位</span><button class="btn outline small" data-action="more-care" ${careLimit >= visible.length ? 'disabled' : ''}>再看 15 位</button></div>
            ${carePreparation()}${careHistory()}`;
    }

    function studioPage() {
        const contexts = [...selectedMembers]
            .map((id) => members.find((member) => member.id === id))
            .filter(Boolean);
        return `${head('把了解，变成一句自然的沟通。', 'STUDIO', '选择会员与模型，生成每人专属的文案和产品配图。', '<button class="btn outline" data-action="catalog">产品与图片库</button>')}
            <div class="studio-grid"><section class="studio-context">
                <section class="panel"><div class="panel-head"><h2>本次沟通名单</h2><button class="text-btn" data-view="members">挑选会员 ↗</button></div>
                ${contexts.map((member) => `<div class="context-list"><div><dt>${escapeHtml(member.displayName || member.id)} · ${member.id}</dt><dd>${member.days} 天未到店 · 平均 ${member.cycle} 天<br>${escapeHtml(member.style)} / ${escapeHtml(member.secondary)}</dd></div></div>`).join('') || '<p class="helper">先到会员档案勾选，或从档案中为单人准备话术。</p>'}</section>${aiPanel()}</section>
                <section class="studio-output"><div class="output-header"><div><h2>沟通草稿与配图</h2><p>核对、修改，再复制给客户。</p></div><span class="pill">AI 辅助 · 人工核对</span></div><div class="output-body">${copyResults()}</div></section></div>`;
    }

    function catalogModal() {
        modal(
            `${headModal('PRODUCT LIBRARY', '产品与图片库')}<div class="catalog-grid">${products.map((product) => `<article class="product-tile"><div class="product-image">${product.imageUrl ? `<img src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.name)}" loading="lazy">` : '<small>产品实拍待上传</small>'}</div><div class="product-tile-body"><h3>${escapeHtml(product.name)}</h3><p>${escapeHtml(product.description || product.style)}</p><div class="product-tile-footer"><strong>${money(product.price)}</strong><button class="btn outline small" data-action="bind-product-image" data-id="${escapeHtml(product.id)}">绑定图片</button></div></div></article>`).join('')}</div>`,
        );
    }

    function aiPanel() {
        const selected = [...selectedMembers]
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
                <select id="ai-model">${aiConfig.models.map((model) => `<option value="${escapeHtml(model.id)}" ${model.id === selectedModel ? 'selected' : ''}>${escapeHtml(model.label)}</option>`).join('')}</select>
                <button class="btn" data-action="generate-copy" ${selectedMembers.size && aiConfig.configured ? '' : 'disabled'}>生成选中会员文案</button>
                <button class="btn outline" data-action="clear-selected">清空选择</button>
            </div>
            <div id="selected-members" class="goal-tabs">${selected || '<span class="helper">尚未勾选会员，可跨页选择。</span>'}</div>
            <p id="ai-generation-status" role="status"></p>
            ${aiConfig.configured ? '' : '<p class="notice">请在后端配置 AI_API_KEY 并重启服务。</p>'}
            <details><summary>上传产品图并绑定产品</summary>
                <p class="helper">支持 PNG、JPEG、WebP，单张最多 5 MB。上传后该产品使用最新图片。</p>
                <div class="ai-controls">
                    <label for="image-product">产品</label>
                    <select id="image-product">${products.map((product) => `<option value="${escapeHtml(product.id)}">${escapeHtml(product.name)} · ${product.imageUrl ? '已有图片' : '待补图'}</option>`).join('')}</select>
                    <input type="file" id="product-image-file" accept="image/png,image/jpeg,image/webp" aria-label="选择产品图片">
                    <button class="btn outline" data-action="upload-product-image">上传并绑定</button>
                </div>
            </details>
        </section>`;
    }

    function copyResults() {
        const cards = copyDrafts.map((draft) => {
            const member = members.find((member) => member.id === draft.memberId);
            const pictures = draft.productIds
                .map((id) => {
                    const product = products.find((product) => product.id === id);
                    if (!product)
                        return `<p class="notice">产品 ${escapeHtml(id)} 已从目录移除，请重新生成。</p>`;
                    return `<div class="copy-product">
                    ${
                        product.imageUrl
                            ? `<img src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.name)}" loading="lazy">
                        <a class="filterbtn" href="${escapeHtml(product.imageUrl)}?download=1" download>下载图片</a>`
                            : '<div class="image-placeholder">该产品待补图</div>'
                    }
                    <strong>${escapeHtml(product.name)}</strong><span>${money(product.price)}</span>
                </div>`;
                })
                .join('');
            return `<article class="panel copy-result" data-copy-result="${draft.id}">
                <div class="panel-head"><h3>${member?.displayName ? escapeHtml(member.displayName) + ' · ' : ''}${draft.memberId} · 个性化文案</h3><span>${escapeHtml(draft.model)}</span></div>
                <p class="helper">${escapeHtml(draft.reason)}</p>
                <label for="copy-message-${draft.id}">发送前核对并修改文案</label>
                <textarea id="copy-message-${draft.id}" data-copy-edit="${draft.id}" maxlength="1000">${escapeHtml(copyEdits.get(String(draft.id)) ?? draft.message)}</textarea>
                <div class="channel-preview"><div class="chat-head"><span class="avatar">店</span>顾客沟通预览</div><div class="chat-bubble" data-chat-preview="${draft.id}">${escapeHtml(copyEdits.get(String(draft.id)) ?? draft.message)}</div></div><div class="copy-products">${pictures}</div>
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
            ${generationErrors.map((item) => `<p class="alert">${item.memberId}：${escapeHtml(item.error)}</p>`).join('')}
            ${cards.slice(0, 5).join('') || '<p class="helper">生成结果会保存在这里，刷新后可继续编辑和复制。</p>'}
            ${cards.length > 5 ? `<details><summary>更早的文案 · ${cards.length - 5} 条</summary>${cards.slice(5).join('')}</details>` : ''}
        </section>`;
    }

    function generateFor(memberIds, model = selectedModel) {
        if (!memberIds.length) return toast('请先勾选会员');
        return save('/copy/generate', { memberIds, model }, ({ items, errors }) => {
            generationErrors = errors;
            items.forEach((item) => selectedMembers.delete(item.memberId));
            render();
            document.getElementById('copy-results').scrollIntoView({ block: 'start' });
            toast(
                `已生成 ${items.length} 套文案${errors.length ? `，${errors.length} 位未完成，可查看原因后重试` : ''}`,
            );
        });
    }

    function uploadProductImage() {
        const file = document.getElementById('product-image-file').files[0];
        const productId = document.getElementById('image-product').value;
        if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
            return toast('请选择 PNG、JPEG 或 WebP 图片');
        if (file.size > 5 * 1024 * 1024) return toast('图片不能超过 5 MB');
        return save(`/products/${encodeURIComponent(productId)}/image`, file, () => {
            render();
            toast('产品图片已绑定，已有文案也可下载该图');
        });
    }

    function saveCopy(id, copy = false) {
        const message = document.getElementById('copy-message-' + id)?.value.trim();
        if (!message) return toast('请填写文案');
        return save(`/copy/${id}/save`, { message }, async () => {
            copyEdits.delete(String(id));
            if (copy) {
                try {
                    await navigator.clipboard.writeText(message);
                } catch {
                    const field = document.getElementById('copy-message-' + id);
                    field.disabled = false;
                    field.focus();
                    field.select();
                    const copied = document.execCommand('copy');
                    field.disabled = true;
                    if (!copied) throw new Error('浏览器未允许复制，请手动复制已选中的文案');
                }
                const response = await api(`/copy/${id}/copied`, { message });
                applyState(response.state);
            }
            render();
            toast(copy ? '文案已复制，可粘贴给客户' : '修改已保存');
        });
    }

    function campaigns() {
        let list = tasks.filter((t) => taskFilter === 'all' || t.status === taskFilter),
            ct = (s) => tasks.filter((t) => t.status === s).length;
        return `${head('AI 营销任务审核', 'CAMPAIGN REVIEW', '先有数据依据，再生成话术；每一条触达都须由人亲自审核。', `<button class="btn" data-action="analyze">${icon('spark')} 查看经营目标</button>`)}<div class="task-summary"><div class="summary-box"><b>${tasks.length}</b><span>全部任务</span></div><div class="summary-box"><b>${ct('pending_review')}</b><span>待审核</span></div><div class="summary-box"><b>${ct('approved')}</b><span>已批准待执行</span></div><div class="summary-box"><b>${ct('executed_simulated')}</b><span>已模拟触达</span></div></div><div class="panel"><div class="panel-head" style="margin-bottom:16px"><h3>任务中心</h3><div class="tabs">${[
            ['all', '全部'],
            ['pending_review', '待审核'],
            ['approved', '已批准'],
            ['executed_simulated', '已执行'],
            ['rejected', '已拒绝'],
        ]
            .map(
                ([s, t]) =>
                    `<button class="filterbtn ${taskFilter === s ? 'active' : ''}" data-task-filter="${s}">${t}</button>`,
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
    function reports() {
        const scopedTasks =
            reportGoal === 'all'
                ? tasks
                : tasks.filter((task) => (task.goal || 'general') === reportGoal);
        const tabs = [
            ['all', '全部目标'],
            ...Object.entries(GOALS).map(([key, goal]) => [key, goal.label]),
            ['general', '通用演示'],
        ]
            .map(
                ([key, label]) =>
                    `<button class="filterbtn ${reportGoal === key ? 'active' : ''}" aria-pressed="${reportGoal === key}" data-report-goal="${key}">${label}</button>`,
            )
            .join('');
        const sent = scopedTasks.filter((t) => t.status === 'executed_simulated'),
            reply = sent.filter((t) => t.result.reply).length,
            booked = sent.filter((t) => t.result.booking).length,
            visited = sent.filter((t) => t.result.visit).length,
            amt = sent.reduce((s, t) => s + t.result.spending, 0),
            stat = [
                ['模拟触达', sent.length],
                ['模拟回复', reply],
                ['模拟预约', booked],
                ['模拟到店', visited],
                ['模拟消费', money(amt)],
            ],
            entries = [
                ['创建任务', scopedTasks.length],
                [
                    '审核通过',
                    scopedTasks.filter((t) => ['approved', 'executed_simulated'].includes(t.status))
                        .length,
                ],
                ['模拟触达', sent.length],
                ['模拟回复', reply],
                ['模拟预约', booked],
                ['模拟到店', visited],
            ];
        return `${head('经营效果复盘', 'PERFORMANCE & INSIGHTS', '每一步都有记录：从会员分析、审核到模拟触达与效果追踪。', `<button class="btn outline" data-action="reset">${icon('clock')} 重置演示</button>`)}<div class="alert">注意：以下转化、到店及消费数据仅由演示情景规则模拟，不代表真实营销效果、真实收入或经过验证的增量。未设置对照组。</div><div class="goal-tabs" aria-label="复盘经营目标">${tabs}</div><div class="report-row">${stat.map(([l, v]) => `<div class="rep-stat"><span>${l}</span><b>${typeof v === 'number' ? num(v) : v}</b></div>`).join('')}</div><div class="dashboard-grid"><div class="panel"><div class="panel-head"><h3>经营漏斗 · 演示场景</h3><span>会员人数 / 任务数</span></div>${entries.map(([l, n]) => `<div class="statbar"><label>${l}</label><div><div style="width:${Math.round((n / Math.max(1, scopedTasks.length)) * 100)}%"></div></div><strong>${num(n)}</strong></div>`).join('')}<p class="notice">按所选经营目标统计任务；触达及后续阶段仅统计已模拟执行的任务。</p></div><div class="panel"><div class="panel-head"><h3>模拟操作记录</h3><span>记录演示数据库中的操作</span></div><div class="logs">${logs.length ? logs.map((l) => `<div class="logitem"><b>[${escapeHtml(l.time)}] ${escapeHtml(l.name)}</b><br/>${escapeHtml(l.desc)}</div>`).join('') : '尚未执行任何页面操作。试着点击「运行模拟经营分析」。'}</div><div class="separator"></div><div class="care-card" style="min-height:130px;padding:18px"><h3 style="font-size:16px">如何理解经营增量？</h3><p>真正的增量消费需要与未触达的对照组比较；储值余额消费也不等于新增现金流。</p></div></div></div>`;
    }
    function render() {
        const pages = {
            dashboard: ['经营驾驶舱', 'home', dashboard],
            members: ['会员档案', 'users', membersPage],
            care: ['护理跟进', 'heart', carePage],
            studio: ['话术工作台', 'spark', studioPage],
            campaigns: ['任务审核', 'tasks', campaigns],
            reports: ['效果复盘', 'chart', reports],
        };
        document.getElementById('content').innerHTML = pages[view][2]();
        document.getElementById('page-title').textContent = pages[view][0];
        const pending = tasks.filter((task) => task.status === 'pending_review').length;
        document.querySelector('#sidebar .nav').innerHTML = Object.entries(pages)
            .map(
                ([key, [label, ico]]) =>
                    `<button data-view="${key}" class="${view === key ? 'active' : ''}" ${view === key ? 'aria-current="page"' : ''}>${icon(ico)}<span class="nav-label">${label}</span>${key === 'campaigns' && pending ? `<span class="nav-count">${pending}</span>` : ''}</button>`,
            )
            .join('');
        document.querySelectorAll('[data-member-count]').forEach((element) => {
            element.textContent = num(members.length);
        });
        document.getElementById('data-origin').textContent =
            dataSource.kind === 'sqlite_import'
                ? `来源数据已导入 · ${products.length} 项产品`
                : '固定生成的演示资料';
        document.getElementById('logs').innerHTML = logs.length
            ? logs
                  .map((entry) => `<li>[${escapeHtml(entry.time)}] ${escapeHtml(entry.desc)}</li>`)
                  .join('')
            : '<li>暂无操作记录。</li>';
        if (view === 'members') loadMemberExtra(profileMemberId);
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
    async function memberModal(id) {
        const m = members.find((m) => m.id === id);
        if (!m) return;
        const p = productFor(m, products);
        modal(
            `${headModal('MEMBER PROFILE · DEMO', m.id + ' · 会员详情')}<div style="display:flex;gap:9px;align-items:center">${chip(m.lifecycle)}<span class="tiny-note">${m.level} · ${m.style} / ${m.secondary}</span></div><div class="detailgrid"><div class="detailitem"><small>距离最近到店</small><strong>${m.days} 天</strong></div><div class="detailitem"><small>平均复购周期</small><strong>${m.cycle} 天</strong></div><div class="detailitem"><small>复购偏离</small><strong>${m.ratio} ×</strong></div><div class="detailitem"><small>累计消费</small><strong>${money(m.spend)}</strong></div><div class="detailitem"><small>储值余额</small><strong>${money(m.bal)}</strong></div><div class="detailitem"><small>历史消费次数</small><strong>${m.visits} 次</strong></div></div><div class="sectlabel">经营判断与数据依据</div><div class="quote">${m.days} 天未到店，平均 ${m.cycle} 天到店一次；当前分类为「${LIFECYCLE_LABELS[m.lifecycle]}」。${canContact(m) ? '已通过初步营销资格过滤，可考虑人工审核后进行个性化关怀。' : !m.consent ? '未获营销授权，已从经营目标候选中排除。' : '当前存在营销资格限制，暂不应营销触达。'}<br/>授权：${m.consent ? '已同意' : '未同意'} · 近期联系：${m.contactDays} 天前 · 未处理投诉：${m.complaint ? '有' : '无'} · 未来预约：${m.appointment ? '有' : '无'}</div><div class="sectlabel">匹配产品参考</div><div class="quote">${p ? `${p.name} · ${p.style} · ${money(p.price)}（演示产品目录）` : '暂无匹配款式'}</div><div id="member-source-details" data-id="${m.id}">正在加载历史记录…</div><div class="modal-actions"><button class="btn outline" data-action="close">关闭</button><button class="btn outline" data-action="prepare-care" data-id="${m.id}" ${!canContact(m) || m.careHandled ? 'disabled' : ''}>沟通准备</button><button class="btn" data-action="newtask" data-id="${m.id}" ${!canContact(m) ? 'disabled title="未通过营销资格"' : ''}>加入待审核任务</button></div>`,
        );
        try {
            const details = await api(`/members/${id}/details`);
            const container = document.getElementById('member-source-details');
            if (container?.dataset.id === id) container.innerHTML = sourceHistory(details);
        } catch (error) {
            const container = document.getElementById('member-source-details');
            if (container?.dataset.id === id)
                container.textContent = '历史资料加载失败：' + error.message;
        }
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
    function taskModal(id) {
        const t = tasks.find((t) => t.id === id);
        if (!t) return;
        const m = members.find((x) => x.id === t.memberId);
        modal(
            `${headModal('HUMAN REVIEW · SIMULATION', t.memberId + ' · ' + t.strategy)}<div style="display:flex;gap:8px;align-items:center">${chip(t.status)}<span class="tiny-note">优先级 ${t.priority} / 100 · ${m.style}偏好</span></div><div class="sectlabel">推荐依据</div><div class="quote">${escapeHtml(t.reason)}。<br/>营销授权：${m.consent ? '允许' : '拒绝'} / 距上次联系：${m.contactDays} 天。</div><div class="sectlabel">拟发送话术 ${t.status === 'pending_review' ? '<span style="color:#b7a9af;font-weight:500">（可修改后审核）</span>' : ''}</div>${t.status === 'pending_review' ? `<textarea class="textarea" id="edit-message">${escapeHtml(t.editedMessage || t.message)}</textarea>` : `<div class="quote">${escapeHtml(t.editedMessage || t.message)}</div>`}${t.result ? `<div class="sectlabel">模拟触达结果</div><div class="quote">模拟回复：${t.result.reply ? '是' : '否'} · 模拟预约：${t.result.booking ? '是' : '否'} · 模拟到店：${t.result.visit ? '是' : '否'} · 模拟消费：${money(t.result.spending)}</div>` : ''}<div class="modal-actions"><button class="btn outline" data-action="close">关闭</button>${t.status === 'pending_review' ? `<button class="btn secondary" data-action="reject" data-id="${t.id}">拒绝</button><button class="btn" data-action="approve" data-id="${t.id}">✓ 审核通过</button>` : t.status === 'approved' ? `<button class="btn green" data-execute="${t.id}">模拟执行</button>` : ''}</div>`,
        );
    }
    // 任务需要通过营销资格检查，同一会员只能有一条有效任务。
    function addMemberTask(memberId) {
        return save('/tasks', { goal: 'general', memberIds: [memberId] }, () => {
            closeModal();
            taskFilter = 'pending_review';
            setView('campaigns');
            toast('已加入待审核任务');
        });
    }

    function runAnalysis() {
        if (view !== 'dashboard') setView('dashboard');
        document.getElementById('goal-panel').scrollIntoView({ block: 'start' });
    }

    function queueGoalTasks() {
        const memberIds = Array.from(
            document.querySelectorAll('#goal-panel input[name="candidate"]:checked'),
            (input) => input.value,
        );
        if (!memberIds.length) return toast('请先勾选要加入待审核的会员');
        return save('/tasks', { goal: selectedGoal, memberIds }, ({ created }) => {
            taskFilter = 'pending_review';
            setView('campaigns');
            toast(`已加入 ${created} 条待审核任务`);
        });
    }

    function approve(id) {
        const message = document.getElementById('edit-message')?.value.trim();
        if (!message) return toast('请输入审核后的话术');
        return save(`/tasks/${id}/review`, { decision: 'approve', message }, () => {
            closeModal();
            render();
            toast('审核通过！可点击「模拟执行」体验下一步');
        });
    }

    function reject(id) {
        return save(`/tasks/${id}/review`, { decision: 'reject' }, () => {
            closeModal();
            render();
            toast('已拒绝任务，无法模拟执行');
        });
    }

    function chooseScenario(id) {
        const task = tasks.find((task) => task.id === id);
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

    function execute(id) {
        const scenario = document.querySelector('#overlay input[name="scenario"]:checked')?.value;
        if (!Object.hasOwn(SCENARIOS, scenario)) return toast('请先选择一个模拟情景');
        return save(`/tasks/${id}/execute`, { scenario }, () => {
            closeModal();
            render();
            toast('模拟触达已完成，已更新经营复盘');
        });
    }

    function careModal() {
        modal(
            `${headModal('AFTERCARE · PRODUCT IDEA', '美甲后护理与维护建议')}<p class="sub" style="margin-bottom:18px">这是一项可加入未来版本的服务策略，不应机械地按天数向所有会员发送消息。</p>${[
                ['做完后的日常护理', '提供甲周保湿、减少碰撞、不要自行撕甲的建议。'],
                [
                    '约 1–2 周后按需关怀',
                    '若获得联系授权，可询问是否出现翘边、脱落或不适；优先处理售后。',
                ],
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
    function reset() {
        if (!window.confirm('重置会清空演示任务、关怀记录、AI 文案和操作日志。确定继续吗？')) return;
        return save('/reset', {}, () => {
            filter = 'all';
            search = '';
            page = 1;
            taskFilter = 'all';
            selectedGoal = 'wake';
            reportGoal = 'all';
            careMemberId = null;
            careFilter = 'pending';
            careSearch = '';
            careLimit = 15;
            careDrafts.clear();
            copyEdits.clear();
            selectedMembers.clear();
            generationErrors = [];
            closeModal();
            render();
            toast('已重置为初始演示场景');
        });
    }

    // 整页会重新渲染，统一在 document 上处理按钮事件。
    const controlSelector =
        '[data-view], [data-task-filter], [data-filter], [data-member], [data-task], [data-execute], [data-goal], [data-report-goal], [data-action]';

    document.addEventListener('click', (event) => {
        const control = event.target.closest(controlSelector);
        if (!control || control.disabled || saving) return;

        const {
            view: targetView,
            taskFilter: status,
            filter: memberFilter,
            member,
            task,
            execute: approvedTask,
            goal,
            reportGoal: targetReportGoal,
            action,
            id,
        } = control.dataset;

        if (targetView) return setView(targetView);
        if (status) {
            taskFilter = status;
            return render();
        }
        if (memberFilter) {
            filter = memberFilter;
            return setView('members');
        }
        if (member) return memberModal(member);
        if (task) return taskModal(task);
        if (approvedTask) return chooseScenario(approvedTask);
        if (goal) {
            selectedGoal = goal;
            render();
            document.querySelector(`[data-goal="${goal}"]`).focus({ preventScroll: true });
            return;
        }
        if (targetReportGoal) {
            reportGoal = targetReportGoal;
            render();
            document
                .querySelector(`[data-report-goal="${targetReportGoal}"]`)
                .focus({ preventScroll: true });
            return;
        }

        switch (action) {
            case 'focus-member':
                profileMemberId = id;
                return render();
            case 'retry-member':
                return loadMemberExtra(id);
            case 'care-filter':
                careFilter = id;
                careLimit = 15;
                return render();
            case 'more-care':
                careLimit += 15;
                return render();
            case 'care-history':
                document.getElementById('care-history').open = true;
                return document.getElementById('care-history').scrollIntoView({ block: 'start' });
            case 'studio-member':
                if (!members.some((member) => member.id === id && canContact(member)))
                    return toast('会员未通过联系资格检查');
                if (!selectedMembers.has(id) && selectedMembers.size >= 5)
                    return toast('每批最多 5 位会员，请先调整名单');
                selectedMembers.add(id);
                return setView('studio');
            case 'catalog':
                return catalogModal();
            case 'bind-product-image':
                closeModal();
                setView('studio');
                document.querySelector('.ai-tools details').open = true;
                document.getElementById('image-product').value = id;
                return document.getElementById('product-image-file').scrollIntoView({ block: 'center' });
            case 'generate-copy':
                return generateFor([...selectedMembers]);
            case 'clear-selected':
                selectedMembers.clear();
                return render();
            case 'remove-selected':
                selectedMembers.delete(id);
                return render();
            case 'upload-product-image':
                return uploadProductImage();
            case 'save-copy':
                return saveCopy(id);
            case 'copy-message':
                return saveCopy(id, true);
            case 'regenerate-copy': {
                const draft = copyDrafts.find((draft) => String(draft.id) === id);
                if (draft) return generateFor([draft.memberId], draft.model);
                return;
            }
            case 'menu': {
                const open = document.body.classList.toggle('menu-open');
                control.setAttribute('aria-expanded', String(open));
                return;
            }
            case 'prepare-care':
                return prepareCare(id);
            case 'flip':
                return flipCard(id);
            case 'close':
                return closeModal();
            case 'close-backdrop':
                if (event.target === control) closeModal();
                break;
            case 'analyze':
                return runAnalysis();
            case 'queue-goal':
                return queueGoalTasks();
            case 'confirm-execution':
                return execute(id);
            case 'reset':
                return reset();
            case 'care':
                return careModal();
            case 'newtask':
                return addMemberTask(id);
            case 'approve':
                return approve(id);
            case 'reject':
                return reject(id);
            case 'next':
            case 'prev':
                page += action === 'next' ? 1 : -1;
                return render();
        }
    });

    function rememberCareDraft(form) {
        const values = Object.fromEntries(new FormData(form));
        const date = form.querySelector('[name="date"]').value;
        careDrafts.set(form.dataset.memberId, { ...values, date });
    }

    document.addEventListener('submit', (event) => {
        if (event.target.id !== 'care-form') return;
        event.preventDefault();
        if (!saving) saveCare(event.target);
    });

    document.addEventListener('change', (event) => {
        const input = event.target;
        if (input.dataset.selectMember) {
            if (input.checked && selectedMembers.size >= 5) {
                input.checked = false;
                return toast('每批最多选择 5 位会员');
            }
            if (input.checked) selectedMembers.add(input.dataset.selectMember);
            else selectedMembers.delete(input.dataset.selectMember);
            render();
            return;
        }
        if (input.id === 'ai-model') selectedModel = input.value;
    });

    document.addEventListener('change', (event) => {
        const form = event.target.closest('#care-form');
        if (!form) return;
        if (event.target.id === 'care-follow') {
            form.querySelector('#care-date').disabled = !event.target.checked;
        }
        rememberCareDraft(form);
    });

    document.addEventListener('input', (event) => {
        const input = event.target;
        if (input.dataset.copyEdit) {
            copyEdits.set(input.dataset.copyEdit, input.value);
            const preview = document.querySelector(`[data-chat-preview="${input.dataset.copyEdit}"]`);
            if (preview) preview.textContent = input.value;
        }
        const careForm = input.closest('#care-form');
        if (careForm) rememberCareDraft(careForm);
        if (!['member-search', 'care-search'].includes(input.id)) return;
        if (input.id === 'member-search') search = input.value;
        else careSearch = input.value;
        page = 1;
        const { selectionStart, selectionEnd } = input;
        render();

        // 重绘会替换搜索框，需要恢复焦点和光标位置。
        const searchInput = document.getElementById(input.id);
        searchInput.focus();
        searchInput.setSelectionRange(selectionStart, selectionEnd);
    });
    document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') {
            closeModal();
            document.body.classList.remove('menu-open');
            document.getElementById('menu-toggle')?.setAttribute('aria-expanded', 'false');
        }
    });
    api('/state')
        .then((state) => {
            applyState(state);
            render();
        })
        .catch((error) => {
            document.getElementById('content').innerHTML =
                `<p class="alert">加载演示数据失败：${escapeHtml(error.message)}</p><button class="btn" id="retry-load">重试</button>`;
            document.getElementById('retry-load').addEventListener('click', () => location.reload());
        });
})();

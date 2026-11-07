(() => {
    'use strict';
    const { GOALS, SCENARIOS, DEMO_SERVICE_PRICE, money, canContact, priorityScore, productFor, goalReason, goalCandidates } = NailMateRules;
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
    let saving = false;

    async function api(path, body) {
        const options = body === undefined ? {} : {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        };
        const response = await fetch('/api' + path, options);
        const payload = await response.json();
        if (!response.ok) {
            throw Object.assign(new Error(payload.error || '请求失败'), { status: response.status });
        }
        return payload;
    }

    function applyState(state) {
        ({ members, tasks, logs } = state);
    }

    async function save(path, body, onSuccess) {
        if (saving) return;
        saving = true;
        const buttons = Array.from(document.querySelectorAll('button:not(:disabled)'));
        buttons.forEach((button) => { button.disabled = true; });
        document.getElementById('app').setAttribute('aria-busy', 'true');
        toast('正在保存，请稍候…');
        try {
            const response = await api(path, body);
            applyState(response.state);
            onSuccess(response);
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
            buttons.forEach((button) => { if (button.isConnected) button.disabled = false; });
            document.getElementById('app').removeAttribute('aria-busy');
        }
    }

    let view = 'dashboard',
        filter = 'all',
        search = '',
        page = 1,
        taskFilter = 'all';
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
        return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k] || ICONS.spark}</svg>`;
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
        page = 1;
        render();
        window.scrollTo(0, 0);
    }
    function sidebar() {
        return `<aside class="sidebar"><div class="brand"><div class="brandmark">N</div><div class="brandname">NailMate<small>AI STUDIO</small></div></div><div class="sidecaption">WORKSPACE / 工作空间</div><nav class="nav" aria-label="主导航">${[
            ['dashboard', 'home', '经营驾驶舱'],
            ['members', 'users', '会员智能分析'],
            ['campaigns', 'tasks', '营销审核中心'],
            ['reports', 'chart', '经营效果复盘'],
        ]
            .map(
                ([id, ico, t]) =>
                    `<button class="navbtn ${view === id ? 'active' : ''}" data-view="${id}">${icon(ico)}${t}${id === 'campaigns' && tasks.some((x) => x.status === 'pending_review') ? `<span class="count">${tasks.filter((x) => x.status === 'pending_review').length}</span>` : ''}</button>`,
            )
            .join(
                '',
            )}</nav><div class="sidebottom"><div class="support"><strong>✦ 温柔唤醒计划</strong><br/>让每一次关怀，都有恰好的时机。<br/><span style="color:#ab979f;font-size:10px">本版本仅用于虚拟数据演示</span></div><div class="sidefoot"><span class="avatar">店</span><span>店主体验模式<br/><small>DEMO WORKSPACE</small></span></div></div></aside>`;
    }
    function topbar() {
        return `<div class="topbar"><div class="breadcrumb">NailMate AI / <b>${{ dashboard: '经营驾驶舱', members: '会员智能分析', campaigns: '营销审核中心', reports: '经营效果复盘' }[view]}</b></div><div class="topright"><span class="demo-pill">● SIMULATION</span><span class="timepill">演示基准日 2026.11.07</span><button class="circlebtn" title="查看模拟操作记录" data-view="reports">${icon('bell')}</button><span class="avatar">店</span></div></div>`;
    }
    function head(title, kicker, sub, right = '') {
        return `<div class="pagehead"><div><p class="kicker">${kicker}</p><h1>${title}</h1><p class="sub">${sub}</p></div>${right}</div>`;
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
    function metric(label, value, meta, ico = 'users') {
        return `<div class="metric"><div class="metric-head"><label>${label}</label><span class="mini-ico">${icon(ico)}</span></div><div class="metric-number">${num(value)}<small>人${label.includes('任务') ? ' / 项' : ''}</small></div><div class="metric-meta">${meta}</div></div>`;
    }

    function goalPanel() {
        const candidates = goalCandidates(members, tasks, selectedGoal);
        const tabs = Object.entries(GOALS).map(([key, goal]) =>
            `<button type="button" class="filterbtn ${selectedGoal === key ? 'active' : ''}" aria-pressed="${selectedGoal === key}" data-goal="${key}">${goal.label}</button>`
        ).join('');
        const cards = candidates.map((member) => `
            <div class="candidate-card">
                <label><input type="checkbox" name="candidate" value="${member.id}" checked> ${member.id}</label>
                <p>${goalReason(member, selectedGoal)}</p>
                <button type="button" class="filterbtn" data-member="${member.id}">查看会员详情</button>
            </div>`
        ).join('');
        return `<section class="panel goal-panel" id="goal-panel" aria-labelledby="goal-heading">
            <div class="panel-head"><h3 id="goal-heading">今日复购计划</h3><span>规则筛选 · 虚拟会员</span></div>
            <div class="goal-tabs" aria-label="经营目标">${tabs}</div>
            <p class="sub">${candidates.length ? `推荐 ${candidates.length} 人，每次最多加入 5 人。` : '当前没有可入队的会员。会员需命中目标、通过联系资格检查且没有有效任务。'}</p>
            <div class="candidate-list">${cards}</div>
            <div class="modal-actions"><button class="btn" data-action="queue-goal" ${candidates.length ? '' : 'disabled'}>加入待审核</button></div>
        </section>`;
    }

    function dashboard() {
        let a = metrics(),
            total = members.length;
        const lifeColors = {
            active: '#a5c6b0',
            due: '#e9bf86',
            low_frequency: '#cf9bb2',
            dormant: '#986680',
        };
        return `${head('早上好，店主 ✳', 'GOOD MORNING · YOUR BUSINESS COPILOT', '你的会员经营概况已准备好。今天，让每一次联系都更有温度。', `<button class="btn outline" data-action="reset">${icon('clock')} 重置演示</button>`)}<section class="hero"><div class="herocontent"><span class="eyebrow">NAILMATE AI · PERSONALIZED CARE</span><h2>把每一次回访，<br/>变成恰到好处的关怀。</h2><p>从 2,800 位虚拟会员中发现机会，生成个性化经营建议。</p><button class="btn" data-action="analyze">${icon('spark')} 运行模拟经营分析 <span style="margin-left:6px">→</span></button></div><div class="heroart"><div class="bigcircle"></div><div class="circleline"></div><div class="nailcard"><div class="nail"></div><div class="nail"></div><div class="nail"></div></div><div class="flower">✿</div></div></section>${goalPanel()}<div class="metrics">${metric('会员总数', total, '可复现的虚拟会员档案', 'users')}${metric('可联系沉睡会员', a.eligibleDormant, '已过滤营销授权等限制', 'clock')}${metric('持有储值余额', a.balanced, '权益提醒不等于新增收入', 'heart')}${metric('待审核任务', a.pending, '必须由人工批准后才能模拟执行', 'tasks')}</div><div class="dashboard-grid"><section class="panel"><div class="panel-head"><h3>会员生命周期分布</h3><button class="textlink" data-view="members">查看全部会员 →</button></div>${Object.entries(
            a.counts,
        )
            .map(
                ([s, n]) =>
                    `<div class="life-row"><label>${LIFECYCLE_LABELS[s]}</label><div class="track"><div class="fill" style="width:${Math.max(1, (n / total) * 100)}%;background:${lifeColors[s]}"></div></div><strong>${num(n)}</strong></div>`,
            )
            .join(
                '',
            )}<div class="legend">依据个人历史复购周期的偏离程度进行启发式分类 · 演示数据</div></section><section class="panel"><div class="panel-head"><h3>今日经营建议</h3><span>规则演示 · 非真实模型调用</span></div><div class="recommend"><div class="r-ico">${icon('clock')}</div><div><h4>优先关注超过复购周期的会员</h4><p>共有 ${num(a.eligibleDormant)} 位符合初步营销资格的沉睡会员，可进一步筛选。</p></div><button class="r-link" data-filter="dormant">›</button></div><div class="recommend"><div class="r-ico">${icon('heart')}</div><div><h4>护理提醒也可以是一种关怀</h4><p>可根据上次服务类型，提供卸甲、补甲或甲周护理提示。</p></div></div><div class="recommend"><div class="r-ico">${icon('shield')}</div><div><h4>人审后才执行模拟触达</h4><p>所有消息都先进入审核任务中心，未获批准不得执行。</p></div><button class="r-link" data-view="campaigns">›</button></div></section></div><div class="bottom-grid"><section class="panel"><div class="panel-head"><h3>值得优先了解的会员</h3><button class="textlink" data-view="members">会员中心 →</button></div><table class="mini-table"><thead><tr><th>会员</th><th>上次到店</th><th>偏离倍数</th><th>状态</th><th></th></tr></thead><tbody>${[
            members[0],
            ...members
                .filter((m) => m.id !== 'M0001' && canContact(m) && m.lifecycle === 'dormant')
                .sort((x, y) => priorityScore(y) - priorityScore(x))
                .slice(0, 4),
        ]
            .map(
                (m) =>
                    `<tr><td><b>${m.id}</b><div class="rowmeta">${m.style} / ${m.level}</div></td><td>${m.days} 天前</td><td>${m.ratio}×</td><td>${chip(m.lifecycle)}</td><td><button class="member-link" data-member="${m.id}">查看 →</button></td></tr>`,
            )
            .join(
                '',
            )}</tbody></table></section><section class="care-card"><p class="kicker" style="color:#ab8a75;margin-bottom:12px">AFTERCARE JOURNEY</p><h3>不只复购，更懂护理</h3><p>美甲之后的养护、到期前的维护、卸甲与甲面休息，也能成为温柔的会员服务。</p><button class="btn secondary small" data-action="care">看看护理服务建议 →</button></section></div><p class="footnote">所有会员、交易、互动和复盘结果均为模拟演示数据。未接入真实企业微信或大模型 API。</p>`;
    }
    function membersPage() {
        const ff = (m) =>
            filter === 'all' ||
            m.lifecycle === filter ||
            (filter === 'high' && m.spend >= 1800) ||
            (filter === 'balance' && m.bal > 0) ||
            (filter === 'contactable' && canContact(m));
        const arr = members.filter(
            (m) =>
                ff(m) &&
                (!search ||
                    m.id.toLowerCase().includes(search.toLowerCase()) ||
                    m.style.includes(search)),
        );
        const per = 12,
            pages = Math.max(1, Math.ceil(arr.length / per));
        page = Math.max(1, Math.min(page, pages));
        const showing = arr.slice((page - 1) * per, page * per);
        return `${head('会员智能分析', 'MEMBER INTELLIGENCE', '不只看顾客多久没来，更关注她自己的复购节奏与服务偏好。', `<button class="btn" data-action="analyze">${icon('spark')} 查看经营目标</button>`)}<div class="alert">数据说明：此页面使用数据库中的 2,800 位虚拟会员；生命周期分类、得分和筛选均在本地演示计算，没有接入真实会员系统。</div><div class="toolbar"><div class="searchbox">${icon('search')}<input id="member-search" placeholder="搜索会员编号 / 美甲风格" value="${escapeHtml(search)}" aria-label="搜索会员"/></div>${[
            ['all', '全部'],
            ['active', '活跃'],
            ['due', '待复购'],
            ['low_frequency', '低频'],
            ['dormant', '沉睡'],
            ['high', '高价值'],
            ['balance', '有余额'],
            ['contactable', '可联系'],
        ]
            .map(
                ([v, t]) =>
                    `<button class="filterbtn ${filter === v ? 'active' : ''}" data-filter="${v}">${t}</button>`,
            )
            .join(
                '',
            )}</div><div class="contentpanel"><div class="panel-head" style="margin-bottom:7px"><h3>会员列表 <span style="font-weight:500">（${num(arr.length)} 位）</span></h3><span>点击会员编号查看数据与个性化建议</span></div><div class="tablewrap"><table class="data-table"><thead><tr><th>会员编号</th><th>最近到店</th><th>历史消费</th><th>平均复购周期</th><th>偏离倍数</th><th>风格偏好</th><th>生命周期</th><th>操作</th></tr></thead><tbody>${showing.map((m) => `<tr><td><button class="member-link" data-member="${m.id}">${m.id}</button><div class="rowmeta">${m.level}</div></td><td>${m.days} 天前</td><td>${money(m.spend)}</td><td>${m.cycle} 天</td><td><span class="highlight">${m.ratio}×</span></td><td>${m.style}</td><td>${chip(m.lifecycle)}</td><td><button class="btn outline small" data-member="${m.id}">查看详情</button></td></tr>`).join('')}</tbody></table></div>${arr.length ? `<div class="listfoot"><span>第 ${(page - 1) * per + 1}–${Math.min(page * per, arr.length)} 条 · 共 ${num(arr.length)} 条</span><div class="pagination"><button data-action="prev" ${page <= 1 ? 'disabled' : ''}>上一页</button><span>${page} / ${pages}</span><button data-action="next" ${page >= pages ? 'disabled' : ''}>下一页</button></div></div>` : '<div class="empty">没有找到符合条件的会员</div>'}</div>`;
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
        const scopedTasks = reportGoal === 'all' ? tasks : tasks.filter((task) => (task.goal || 'general') === reportGoal);
        const tabs = [['all', '全部目标'], ...Object.entries(GOALS).map(([key, goal]) => [key, goal.label]), ['general', '通用演示']]
            .map(([key, label]) => `<button class="filterbtn ${reportGoal === key ? 'active' : ''}" aria-pressed="${reportGoal === key}" data-report-goal="${key}">${label}</button>`).join('');
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
                    scopedTasks.filter((t) => ['approved', 'executed_simulated'].includes(t.status)).length,
                ],
                ['模拟触达', sent.length],
                ['模拟回复', reply],
                ['模拟预约', booked],
                ['模拟到店', visited],
            ];
        return `${head('经营效果复盘', 'PERFORMANCE & INSIGHTS', '每一步都有记录：从会员分析、审核到模拟触达与效果追踪。', `<button class="btn outline" data-action="reset">${icon('clock')} 重置演示</button>`)}<div class="alert">注意：以下转化、到店及消费数据仅由演示情景规则模拟，不代表真实营销效果、真实收入或经过验证的增量。未设置对照组。</div><div class="goal-tabs" aria-label="复盘经营目标">${tabs}</div><div class="report-row">${stat.map(([l, v]) => `<div class="rep-stat"><span>${l}</span><b>${typeof v === 'number' ? num(v) : v}</b></div>`).join('')}</div><div class="dashboard-grid"><div class="panel"><div class="panel-head"><h3>经营漏斗 · 演示场景</h3><span>会员人数 / 任务数</span></div>${entries.map(([l, n]) => `<div class="statbar"><label>${l}</label><div><div style="width:${Math.round((n / Math.max(1, scopedTasks.length)) * 100)}%"></div></div><strong>${num(n)}</strong></div>`).join('')}<p class="notice">按所选经营目标统计任务；触达及后续阶段仅统计已模拟执行的任务。</p></div><div class="panel"><div class="panel-head"><h3>模拟操作记录</h3><span>记录演示数据库中的操作</span></div><div class="logs">${logs.length ? logs.map((l) => `<div class="logitem"><b>[${escapeHtml(l.time)}] ${escapeHtml(l.name)}</b><br/>${escapeHtml(l.desc)}</div>`).join('') : '尚未执行任何页面操作。试着点击「运行模拟经营分析」。'}</div><div class="separator"></div><div class="care-card" style="min-height:130px;padding:18px"><h3 style="font-size:16px">如何理解经营增量？</h3><p>真正的增量消费需要与未触达的对照组比较；储值余额消费也不等于新增现金流。</p></div></div></div>`;
    }
    function render() {
        document.getElementById('app').innerHTML =
            `<div class="shell">${sidebar()}<main class="main">${topbar()}${{ dashboard, members: membersPage, campaigns, reports }[view]()}<p class="footnote">NAILMATE AI · HACKATHON CONCEPT PREVIEW · 100% SIMULATION</p></main></div>`;
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
    function memberModal(id) {
        const m = members.find((m) => m.id === id);
        if (!m) return;
        let p = productFor(m);
        modal(
            `${headModal('MEMBER PROFILE · DEMO', m.id + ' · 会员详情')}<div style="display:flex;gap:9px;align-items:center">${chip(m.lifecycle)}<span class="tiny-note">${m.level} · ${m.style} / ${m.secondary}</span></div><div class="detailgrid"><div class="detailitem"><small>距离最近到店</small><strong>${m.days} 天</strong></div><div class="detailitem"><small>平均复购周期</small><strong>${m.cycle} 天</strong></div><div class="detailitem"><small>复购偏离</small><strong>${m.ratio} ×</strong></div><div class="detailitem"><small>累计消费</small><strong>${money(m.spend)}</strong></div><div class="detailitem"><small>储值余额</small><strong>${money(m.bal)}</strong></div><div class="detailitem"><small>历史消费次数</small><strong>${m.visits} 次</strong></div></div><div class="sectlabel">经营判断与数据依据</div><div class="quote">${m.days} 天未到店，平均 ${m.cycle} 天到店一次；当前分类为「${LIFECYCLE_LABELS[m.lifecycle]}」。${canContact(m) ? '已通过初步营销资格过滤，可考虑人工审核后进行个性化关怀。' : !m.consent ? '未获营销授权，已从经营目标候选中排除。' : '当前存在营销资格限制，暂不应营销触达。'}<br/>授权：${m.consent ? '已同意' : '未同意'} · 近期联系：${m.contactDays} 天前 · 未处理投诉：${m.complaint ? '有' : '无'} · 未来预约：${m.appointment ? '有' : '无'}</div><div class="sectlabel">新品推荐参考</div><div class="quote">${p ? `${p.name} · ${p.style} · ${money(p.price)}（虚拟产品库）` : '暂无匹配款式'}</div><div class="modal-actions"><button class="btn outline" data-action="close">关闭</button><button class="btn" data-action="newtask" data-id="${m.id}" ${!canContact(m) ? 'disabled title="未通过营销资格"' : ''}>加入待审核任务</button></div>`,
        );
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
            document.querySelectorAll('#goal-panel input[name="candidate"]:checked'), (input) => input.value,
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

        const options = Object.entries(SCENARIOS).map(([key, scenario]) =>
            `<label class="scenario-option"><input type="radio" name="scenario" value="${key}"> ${scenario.label}</label>`
        ).join('');
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
        if (!window.confirm('重置会清空共享演示任务和操作记录。确定继续吗？')) return;
        return save('/reset', {}, () => {
            filter = 'all';
            search = '';
            page = 1;
            taskFilter = 'all';
            selectedGoal = 'wake';
            reportGoal = 'all';
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
        if (!control || control.disabled) return;

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
            document.querySelector(`[data-report-goal="${targetReportGoal}"]`).focus({ preventScroll: true });
            return;
        }

        switch (action) {
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

    document.addEventListener('input', (event) => {
        const input = event.target;
        if (input.id !== 'member-search') return;

        search = input.value;
        page = 1;
        const { selectionStart, selectionEnd } = input;
        render();

        // 重绘会替换搜索框，需要恢复焦点和光标位置。
        const searchInput = document.getElementById('member-search');
        searchInput.focus();
        searchInput.setSelectionRange(selectionStart, selectionEnd);
    });
    document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') closeModal();
    });
    api('/state').then((state) => {
        applyState(state);
        render();
    }).catch((error) => {
        document.getElementById('app').innerHTML = `<main class="main"><p class="alert">加载演示数据失败：${escapeHtml(error.message)}</p><button class="btn" id="retry-load">重试</button></main>`;
        document.getElementById('retry-load').addEventListener('click', () => location.reload());
    });
})();

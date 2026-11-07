import { applyState, state } from './state.js';
import { closeModal, escapeHtml, num, toast } from './components.js';
import { api } from './api.js';
import { SCENARIOS, canContact } from './rules-client.js';
import { dashboard, setupCardTilt } from './pages/dashboard.js';
import { loadMemberExtra, memberModal, membersPage } from './pages/members.js';
import { studioPage } from './pages/studio.js';
import { campaigns, chooseScenario, taskModal } from './pages/campaigns.js';
import { reports } from './pages/reports.js';
import { productsPage } from './pages/products.js';

async function save(path, body, onSuccess) {
    if (state.saving) return;
    state.saving = true;
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
        if (status) status.textContent = '正在为当前会员准备话术，请稍候。';
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
        state.saving = false;
        controls.forEach((control) => {
            if (control.isConnected) control.disabled = false;
        });
        document.getElementById('app').removeAttribute('aria-busy');
        const status = document.getElementById('ai-generation-status');
        if (status) status.textContent = '';
    }
}

function setView(v) {
    closeModal();
    state.view = v;
    document.body.classList.remove('menu-open');
    document.getElementById('menu-toggle')?.setAttribute('aria-expanded', 'false');
    state.page = 1;
    render();
    window.scrollTo(0, 0);
}

function prepareCare(id) {
    const member = state.members.find((member) => member.id === id);
    if (!member) return;
    const recorded = state.careRecords.some((record) => record.memberId === id);
    if (!recorded && (!canContact(member) || member.careHandled))
        return toast('会员已处理或不满足联系资格');
    state.studioMemberId = id;
    setView('studio');
    const section = document.getElementById('workbench-followup');
    section.open = true;
    section.scrollIntoView({ block: 'start' });
    section.querySelector('summary').focus({ preventScroll: true });
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
            state.careDrafts.delete(memberId);
            render();
            const section = document.getElementById('workbench-followup');
            section.open = true;
            section.scrollIntoView({ block: 'nearest' });
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

function generateFor(memberId = state.studioMemberId) {
    if (!memberId) return toast('请先选择会员');
    if (!state.aiConfig.configured) return toast('请先检查服务端 AI 配置');
    if (!state.aiConfig.models.some((model) => model.id === state.selectedModel))
        return toast('请选择可用模型');
    return save(
        '/copy/generate',
        { memberIds: [memberId], model: state.selectedModel, style: state.selectedCopyStyle },
        ({ items, errors }) => {
            state.generationErrors = errors;
            render();
            document.getElementById('copy-results').scrollIntoView({ block: 'start' });
            toast(
                items.length
                    ? 'AI 话术与匹配产品已生成，请核对后发送'
                    : '生成未完成，请查看原因后重试',
            );
        },
    );
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
        state.copyEdits.delete(String(id));
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

function render() {
    const pages = {
        dashboard: [
            '今日复购计划',
            'THE STUDIO',
            dashboard,
            '今天联系谁，带什么款式，接下来怎么跟。',
        ],
        members: ['会员档案', 'OUR MEMBERS', membersPage, '记得她的偏爱，也关心她的近况。'],
        campaigns: ['任务审核', 'PERSONAL TOUCH', campaigns, '先确认人和话术，再安排一次联系。'],
        reports: ['复购结果', 'STUDIO JOURNAL', reports, '从一条问候，到一次预约，再到真正到店。'],
        products: ['产品库', 'THE COLLECTION', productsPage, '把喜欢的款式，收进门店的灵感册。'],
        studio: ['话术工作台', 'PERSONAL NOTES', studioPage, '把了解，变成一段自然的沟通。'],
    };
    document.getElementById('content').innerHTML = pages[state.view][2]();
    document.getElementById('page-title').textContent = pages[state.view][0];
    document.getElementById('page-motto').textContent = pages[state.view][3];
    document.getElementById('edition-name').textContent = pages[state.view][1];
    document.getElementById('page-index').textContent =
        `${String(Object.keys(pages).indexOf(state.view) + 1).padStart(2, '0')} / 工作空间`;
    const pending = state.tasks.filter((task) => task.status === 'pending_review').length;
    document.querySelector('#sidebar .nav').innerHTML = Object.entries(pages)
        .map(
            ([key, [label]], index) =>
                `<button data-view="${key}" class="${state.view === key ? 'active' : ''}" ${state.view === key ? 'aria-current="page"' : ''}>${String(index + 1).padStart(2, '0')}<span>${label}</span>${key === 'campaigns' && pending ? `<span id="pending-badge">${pending}</span>` : ''}</button>`,
        )
        .join('');
    document.querySelectorAll('[data-member-count]').forEach((element) => {
        element.textContent = num(state.members.length);
    });
    document.getElementById('data-origin').textContent =
        state.dataSource.kind === 'sqlite_import'
            ? `来源数据已导入 · ${state.products.length} 项产品`
            : '固定生成的演示资料';
    document.getElementById('logs').innerHTML = state.logs.length
        ? state.logs
              .map((entry) => `<li>[${escapeHtml(entry.time)}] ${escapeHtml(entry.desc)}</li>`)
              .join('')
        : '<li>暂无操作记录。</li>';
    if (state.view === 'dashboard') setupCardTilt();
    if (state.view === 'members') loadMemberExtra(state.profileMemberId);
}

function runAnalysis() {
    if (state.view !== 'dashboard') setView('dashboard');
    document.getElementById('goal-panel').scrollIntoView({ block: 'start' });
}

function queueGoalTasks() {
    const memberIds = Array.from(
        document.querySelectorAll('#goal-panel input[name="candidate"]:checked'),
        (input) => input.value,
    );
    if (!memberIds.length) return toast('请先勾选要加入待审核的会员');
    return save('/tasks', { opportunity: state.selectedOpportunity, memberIds }, ({ created }) => {
        state.taskFilter = 'pending_review';
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

function execute(id) {
    const scenario = document.querySelector('#overlay input[name="scenario"]:checked')?.value;
    if (!Object.hasOwn(SCENARIOS, scenario)) return toast('请先选择一个模拟情景');
    return save(`/tasks/${id}/execute`, { scenario }, () => {
        closeModal();
        render();
        toast('模拟触达已完成，已更新经营复盘');
    });
}

function reset() {
    if (!window.confirm('重置会清空演示任务、关怀记录、AI 文案和操作日志。确定继续吗？')) return;
    return save('/reset', {}, () => {
        state.filter = 'all';
        state.search = '';
        state.page = 1;
        state.taskFilter = 'all';
        state.selectedOpportunity = 'all';
        state.reportGoal = 'all';
        state.planLimit = 3;
        state.selectedTaskId = null;
        state.productSearch = '';
        state.productFilter = 'all';
        state.productPage = 1;
        state.productsWithoutImage = false;
        state.careDrafts.clear();
        state.copyEdits.clear();
        state.studioMemberId = state.members[0]?.id || null;
        state.generationErrors = [];
        closeModal();
        render();
        toast('已重置为初始演示场景');
    });
}

const controlSelector =
    '[data-view], [data-product-filter], [data-task-filter], [data-filter], [data-member], [data-task], [data-execute], [data-opportunity], [data-report-goal], [data-action]';

document.addEventListener('click', (event) => {
    const control = event.target.closest(controlSelector);
    if (!control || control.disabled || state.saving) return;

    const {
        view: targetView,
        taskFilter: status,
        filter: memberFilter,
        member,
        task,
        execute: approvedTask,
        opportunity,
        reportGoal: targetReportGoal,
        action,
        id,
    } = control.dataset;

    if (targetView) {
        if (control.dataset.profileId) {
            state.profileMemberId = control.dataset.profileId;
            state.filter = 'all';
            state.search = '';
        }
        return setView(targetView);
    }
    if (status) {
        state.taskFilter = status;
        return render();
    }
    if (memberFilter) {
        state.filter = memberFilter;
        return setView('members');
    }
    if (member) return memberModal(member);
    if (task) {
        if (state.view !== 'campaigns') return taskModal(task);
        closeModal();
        state.selectedTaskId = task;
        return render();
    }
    if (control.dataset.productFilter) {
        state.productFilter = control.dataset.productFilter;
        state.productPage = 1;
        return render();
    }
    if (approvedTask) return chooseScenario(approvedTask);
    if (opportunity) {
        state.selectedOpportunity = opportunity;
        render();
        document
            .querySelector(`[data-opportunity="${opportunity}"]`)
            .focus({ preventScroll: true });
        return;
    }
    if (targetReportGoal) {
        state.reportGoal = targetReportGoal;
        render();
        document
            .querySelector(`[data-report-goal="${targetReportGoal}"]`)
            .focus({ preventScroll: true });
        return;
    }

    switch (action) {
        case 'focus-member':
            state.profileMemberId = id;
            return render();
        case 'retry-member':
            return loadMemberExtra(id);
        case 'studio-member':
            if (!state.members.some((member) => member.id === id)) return;
            state.studioMemberId = id;
            return setView('studio');
        case 'bind-product-image':
            closeModal();
            setView('products');
            document.getElementById('product-upload').open = true;
            document.getElementById('image-product').value = id;
            return document
                .getElementById('product-image-file')
                .scrollIntoView({ block: 'center' });
        case 'generate-copy':
            return generateFor();
        case 'upload-product-image':
            return uploadProductImage();
        case 'save-copy':
            return saveCopy(id);
        case 'copy-message':
            return saveCopy(id, true);
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
        case 'approve':
            return approve(id);
        case 'reject':
            return reject(id);
        case 'next':
        case 'prev':
            state.page += action === 'next' ? 1 : -1;
            return render();
        case 'product-next':
        case 'product-prev':
            state.productPage += action === 'product-next' ? 1 : -1;
            return render();
    }
});

function rememberCareDraft(form) {
    const values = Object.fromEntries(new FormData(form));
    const date = form.querySelector('[name="date"]').value;
    state.careDrafts.set(form.dataset.memberId, { ...values, date });
}

document.addEventListener('submit', (event) => {
    if (event.target.id !== 'care-form') return;
    event.preventDefault();
    if (!state.saving) saveCare(event.target);
});

document.addEventListener('change', (event) => {
    const input = event.target;
    if (input.id === 'studio-member') {
        state.studioMemberId = input.value;
        render();
    }
    if (input.id === 'ai-model') state.selectedModel = input.value;
    if (input.id === 'copy-style') {
        state.selectedCopyStyle = input.value;
        toast('文案风格已选择，点击生成按钮后生效');
    }
    if (input.id === 'plan-limit') {
        state.planLimit = Number(input.value);
        render();
    }
    if (input.id === 'task-filter') {
        state.taskFilter = input.value;
        state.selectedTaskId = null;
        render();
    }
    if (input.id === 'products-without-image') {
        state.productsWithoutImage = input.checked;
        state.productPage = 1;
        render();
    }
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
        state.copyEdits.set(input.dataset.copyEdit, input.value);
        const preview = document.querySelector(`[data-chat-preview="${input.dataset.copyEdit}"]`);
        if (preview) preview.textContent = input.value;
    }
    const careForm = input.closest('#care-form');
    if (careForm) rememberCareDraft(careForm);
    if (!['member-search', 'product-search'].includes(input.id)) return;
    if (input.id === 'member-search') state.search = input.value;
    else {
        state.productSearch = input.value;
        state.productPage = 1;
    }
    state.page = 1;
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

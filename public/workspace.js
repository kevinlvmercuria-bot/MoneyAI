import { applyState, state, resetInterfaceState } from './state.js';
import { closeModal, escapeHtml, num, toast } from './components.js';
import { api } from './api.js';
import { SCENARIOS, canContact } from './rules-client.js';
import { dashboard } from './pages/dashboard.js';
import { loadMemberExtra, memberModal, membersPage } from './pages/members.js';
import { studioPage, studioContext } from './pages/studio.js';
import { campaigns, chooseScenario, taskModal } from './pages/campaigns.js';
import { reports } from './pages/reports.js';
import { createMessageCard } from './download-card.js';
import { productsPage } from './pages/products.js';
import { beforeRender, enhanceUI, closeChoices } from './effects.js';
import {
    OBJECTIVES,
    noProductObjective,
    workbenchProducts,
    canContactFor,
    buildOpportunityTask,
} from './rules-client.js';

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
    front.querySelector('[data-action="flip"]').setAttribute('aria-expanded', String(flipped));
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
        {
            memberIds: [memberId],
            model: state.selectedModel,
            style: state.selectedCopyStyle,
            context: { objective: state.studioObjective, productId: state.studioProductId },
        },
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

function saveCopy(id, copy = false, submit = false) {
    const message = (
        document.getElementById('copy-message-' + id) || document.getElementById('message-draft')
    )?.value.trim();
    if (!message) return toast('请填写文案');
    return save(`/copy/${id}/save`, { message }, async () => {
        state.copyEdits.delete(String(id));
        if (copy) {
            try {
                await navigator.clipboard.writeText(message);
            } catch {
                const field =
                    document.getElementById('copy-message-' + id) ||
                    document.getElementById('message-draft');
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
        if (submit) {
            const response = await api('/tasks/from-copy', { draftId: Number(id), message });
            applyState(response.state);
            state.selectedTaskId = response.taskId;
            state.taskFilter = 'pending_review';
            setView('campaigns');
            toast('当前文案已提交人工审核');
            return;
        }
        render();
        toast(copy ? '文案已复制，可粘贴给客户' : '修改已保存');
    });
}

async function writeClipboard(message) {
    try {
        await navigator.clipboard.writeText(message);
    } catch {
        const field = document.getElementById('message-draft');
        field.disabled = false;
        field.focus();
        field.select();
        const copied = document.execCommand('copy');
        field.disabled = true;
        if (!copied) throw new Error('浏览器未允许复制，请手动复制已选中的文案');
    }
}
function saveManual(action) {
    const current = studioContext(),
        message = document.getElementById('message-draft')?.value.trim();
    if (!message || !current) return toast('请填写文案');
    return save(
        '/copy/manual',
        {
            memberId: current.member.id,
            message,
            context: { objective: current.objective, productId: current.product?.id || null },
        },
        async ({ draftId }) => {
            state.manualDrafts.delete(current.key);
            if (action === 'manual-copy') {
                await writeClipboard(message);
                const response = await api(`/copy/${draftId}/copied`, { message });
                applyState(response.state);
            }
            if (action === 'manual-submit') {
                const response = await api('/tasks/from-copy', { draftId, message });
                applyState(response.state);
                state.selectedTaskId = response.taskId;
                state.taskFilter = 'pending_review';
                setView('campaigns');
                toast('文案已提交人工审核');
                return;
            }
            render();
            toast(action === 'manual-copy' ? '文案已复制' : '手写文案已保存');
        },
    );
}
async function downloadCard() {
    const current = studioContext(),
        message = document.getElementById('message-draft')?.value.trim();
    if (!current || !message) return toast('请先准备文案');
    try {
        await createMessageCard(message, current.product);
        toast('图文卡片已下载');
    } catch (error) {
        toast(error.message);
    }
}
function saveNote(form) {
    const values = Object.fromEntries(new FormData(form));
    return save(
        `/members/${form.dataset.memberId}/notes`,
        {
            noteId: state.editNoteId,
            type: values.type,
            text: values.text,
            pinned: values.pinned === 'on',
        },
        ({ details }) => {
            state.memberDetailsCache.set(form.dataset.memberId, details);
            state.editNoteId = null;
            state.noteDrafts.delete(form.dataset.memberId);
            render();
            toast('会员备注已保存');
        },
    );
}
function pinNote(id) {
    const details = state.memberDetailsCache.get(state.profileMemberId),
        note = details?.notes.find((note) => note.note_id === id);
    if (!note) return;
    return save(
        `/members/${state.profileMemberId}/notes`,
        {
            noteId: id,
            type: note.note_type,
            text: note.note_text,
            pinned: !note.is_pinned,
            author: note.author_name || '店主',
        },
        ({ details }) => {
            state.memberDetailsCache.set(state.profileMemberId, details);
            render();
            toast('备注置顶状态已更新');
        },
    );
}

function render() {
    beforeRender();
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
    document.querySelectorAll('.atelier-dock [data-view]').forEach((button) => {
        if (button.dataset.view === state.view) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
    });
    const badge = document.getElementById('pending-badge');
    badge.textContent = pending;
    badge.hidden = !pending;
    document.querySelectorAll('[data-member-count]').forEach((element) => {
        element.textContent = num(state.members.length);
    });
    document.getElementById('logs').innerHTML = state.logs.length
        ? state.logs
              .map((entry) => `<li>[${escapeHtml(entry.time)}] ${escapeHtml(entry.desc)}</li>`)
              .join('')
        : '<li>暂无操作记录。</li>';
    enhanceUI();
    if (state.view === 'members') loadMemberExtra(state.profileMemberId);
    if (state.view === 'studio') loadMemberExtra(state.studioMemberId);
}

function runAnalysis() {
    if (state.view !== 'dashboard') setView('dashboard');
    document.getElementById('goal-panel').scrollIntoView({ block: 'start' });
}

function queueGoalTasks() {
    const memberIds = Array.from(
        document.querySelectorAll('#care-wall [data-candidate]'),
        (card) => card.dataset.candidate,
    );
    if (!memberIds.length) return toast('当前没有可加入的候选会员');
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
        resetInterfaceState();
        closeModal();
        document.getElementById('demo-tools').open = false;
        render();
        window.scrollTo(0, 0);
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
            state.editNoteId = null;
            state.profileMemberId = id;
            return render();
        case 'retry-member':
            return loadMemberExtra(id);
        case 'studio-member':
            if (!state.members.some((member) => member.id === id)) return;
            state.studioMemberId = id;
            state.studioObjective = control.dataset.objective || state.studioObjective;
            state.studioProductId = null;
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
        case 'submit-copy':
            return saveCopy(id, false, true);
        case 'manual-save':
        case 'manual-copy':
        case 'manual-submit':
            return saveManual(action);
        case 'download-card':
            return downloadCard();
        case 'edit-note':
            state.editNoteId = id;
            state.noteDrafts.delete(state.profileMemberId);
            return render();
        case 'cancel-note':
            state.editNoteId = null;
            return render();
        case 'pin-note':
            return pinNote(id);
        case 'reset-interface':
            beforeRender();
            closeModal();
            document.getElementById('demo-tools').open = false;
            resetInterfaceState();
            render();
            window.scrollTo(0, 0);
            toast('界面已重置，已保存记录与图片保留');
            return;

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
    if (event.target.id === 'member-note-form') {
        event.preventDefault();
        if (!state.saving) saveNote(event.target);
        return;
    }
    if (event.target.id !== 'care-form') return;
    event.preventDefault();
    if (!state.saving) saveCare(event.target);
});

document.addEventListener('change', (event) => {
    const input = event.target;
    if (input.id === 'studio-member') {
        state.studioMemberId = input.value;
        state.studioProductId = null;
        render();
    }
    if (input.id === 'studio-objective') {
        state.studioObjective = input.value;
        state.studioProductId = null;
        render();
    }
    if (input.id === 'studio-product') {
        state.studioProductId = input.value;
        render();
    }
    const noteForm = input.closest('#member-note-form');
    if (noteForm)
        state.noteDrafts.set(noteForm.dataset.memberId, Object.fromEntries(new FormData(noteForm)));
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
    if (input.dataset.manualCopy) {
        state.manualDrafts.set(input.dataset.manualCopy, input.value);
        const preview = document.querySelector('[data-chat-preview]');
        if (preview) preview.textContent = input.value;
    }
    if (input.id === 'message-draft') {
        const count = document.getElementById('draft-count');
        if (count) count.textContent = input.value.length + ' / 1000';
        document.querySelectorAll('[data-requires-message]').forEach((button) => {
            button.disabled = !input.value.trim() || button.dataset.contactAllowed !== 'true';
        });
    }
    const noteForm = input.closest('#member-note-form');
    if (noteForm)
        state.noteDrafts.set(noteForm.dataset.memberId, Object.fromEntries(new FormData(noteForm)));
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
        closeChoices();
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

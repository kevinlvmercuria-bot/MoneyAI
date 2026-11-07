import { state } from './state.js';
import { escapeHtml as escape } from './components.js';
const content = document.getElementById('content');
const CARE_FOLLOWUP_DAYS = 7;
const hoverMotion = matchMedia(
    '(any-hover: hover) and (any-pointer: fine) and (prefers-reduced-motion: no-preference)',
);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const dock = document.querySelector('.atelier-dock');
let lastRenderedPage, pageMotion, careRowObserver;

function setupCareRow() {
    const wall = content.querySelector('.care-wall-single-row');
    if (!wall) return;
    const arrows = content.querySelector('.care-row-arrows');
    const [left, right] = arrows.querySelectorAll('button');
    const label = content.querySelector('.care-row-label');
    const count = wall.childElementCount;

    function updateArrows() {
        const remaining = wall.scrollWidth - wall.clientWidth;
        const hideArrows = remaining <= 1;
        if (arrows.hidden !== hideArrows) {
            arrows.hidden = hideArrows;
            label.textContent = `${count} 张便签 · 顶部对齐 · 横向单排${hideArrows ? '' : ' · 左右滑动查看'}`;
        }
        left.disabled = wall.scrollLeft <= 1;
        right.disabled = wall.scrollLeft >= remaining - 1;
    }
    function moveRow(direction) {
        const [first, second] = wall.children;
        const step = second ? second.offsetLeft - first.offsetLeft : wall.clientWidth;
        wall.scrollBy({
            left: direction * step,
            behavior: reducedMotion.matches ? 'auto' : 'smooth',
        });
        updateArrows();
    }
    left.addEventListener('click', () => moveRow(-1));
    right.addEventListener('click', () => moveRow(1));
    wall.addEventListener('scroll', updateArrows, { passive: true });
    careRowObserver = new ResizeObserver(updateArrows);
    careRowObserver.observe(wall);
    updateArrows();
}

function animatePageChange() {
    if (lastRenderedPage && lastRenderedPage !== state.view) {
        pageMotion?.cancel();
        if (!reducedMotion.matches && typeof content.animate === 'function') {
            pageMotion = content.animate(
                [
                    { opacity: 0.55, transform: 'translateY(6px)' },
                    { opacity: 1, transform: 'translateY(0)' },
                ],
                { duration: 210, easing: 'cubic-bezier(.2,.65,.25,1)' },
            );
        }
    }
    lastRenderedPage = state.view;
}

function syncDockHover(event) {
    dock.toggleAttribute(
        'data-hover',
        event.pointerType === 'mouse' || event.pointerType === 'pen',
    );
}
dock.addEventListener('pointerenter', syncDockHover);
dock.addEventListener('pointermove', syncDockHover);
dock.addEventListener('pointerleave', () => dock.removeAttribute('data-hover'));
dock.addEventListener('pointercancel', () => dock.removeAttribute('data-hover'));

function setupGlass(root) {
    root.querySelectorAll('.glass-track').forEach((track) => {
        bindGlass(track, track.querySelector('.glass-tilt'), 2.6);
    });
}

const choicePopover = document.getElementById('choice-popover');
if (typeof choicePopover.showPopover === 'function') choicePopover.hidden = false;
const choiceOptions = document.getElementById('choice-options');
const choiceSearch = choicePopover.querySelector('.choice-search');
const choiceEmpty = choicePopover.querySelector('.choice-empty');
const choiceFields = new WeakMap();
const taskChoiceTones = {
    全部: 'all',
    待审核: 'pending',
    已通过: 'approved',
    已拒绝: 'rejected',
    已模拟执行: 'executed',
};
const objectiveChoiceHints = {
    wake: '问候一段时间没来的会员',
    repurchase: '询问是否想换款或预约',
    balance: '提醒店内可用余额',
    launch: '分享符合她偏好的新款',
    care: `美甲后第 1–${CARE_FOLLOWUP_DAYS} 天，问佩戴体验`,
    preview: '分享快要上架、顾客可能喜欢的款式',
    scheduled: '按店主记下的日期回访',
    greeting: '聊近况，维护日常关系',
};
let openChoice = null;

function setupChoiceFields(root) {
    if (typeof choicePopover.showPopover !== 'function') return;
    root.querySelectorAll('select:not(.choice-native)').forEach((select) => {
        const label = select.labels[0];
        const name = select.getAttribute('aria-label') || label?.textContent.trim() || '选择选项';
        if (!select.id) select.id = `choice-${select.name}`;
        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.id = `${select.id}-picker`;
        trigger.className = 'choice-trigger';
        trigger.setAttribute('aria-haspopup', 'listbox');
        trigger.setAttribute('aria-controls', 'choice-options');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.innerHTML =
            '<span class="choice-trigger-value"></span><span class="choice-chevron" aria-hidden="true"></span>';
        function syncTrigger() {
            const text = select.selectedOptions[0]?.text || '暂无可选项';
            trigger.querySelector('.choice-trigger-value').textContent = text;
            trigger.setAttribute('aria-label', `${name} ${text}`);
            trigger.disabled = select.disabled || !select.options.length;
        }
        syncTrigger();
        select.addEventListener('change', syncTrigger);
        if (label) label.htmlFor = trigger.id;
        choiceFields.set(trigger, { select, name });
        select.classList.add('choice-native');
        select.hidden = true;
        select.after(trigger);
    });
}

function positionChoicePopover() {
    if (!openChoice) return;
    const { trigger, select } = openChoice;
    const rect = trigger.getBoundingClientRect();
    const margin = 8,
        gap = 6;
    if (!trigger.isConnected || rect.bottom <= 0 || rect.top >= innerHeight) {
        closeChoicePopover();
        return;
    }
    const minWidth =
        select.id === 'care-limit'
            ? 90
            : select.id === 'studio-objective' || !choiceSearch.hidden
              ? 270
              : 150;
    const width = Math.min(innerWidth - 2 * margin, Math.max(rect.width, minWidth));
    choicePopover.style.width = `${width}px`;
    choicePopover.style.left = `${Math.min(Math.max(margin, rect.left), innerWidth - margin - width)}px`;
    const above = rect.top - gap - margin,
        below = innerHeight - rect.bottom - gap - margin;
    const desired = Math.min(
        370,
        choiceOptions.scrollHeight + (choiceSearch.hidden ? 0 : choiceSearch.offsetHeight + 5) + 12,
    );
    const opensUp = below < desired && above > below;
    choicePopover.style.maxHeight = `${Math.max(0, Math.min(370, opensUp ? above : below))}px`;
    choicePopover.style.top = `${opensUp ? rect.top - gap - choicePopover.offsetHeight : rect.bottom + gap}px`;
}

function showChoicePopover(trigger) {
    if (openChoice?.trigger === trigger) {
        closeChoicePopover();
        return;
    }
    closeChoicePopover();
    const { select, name } = choiceFields.get(trigger);
    const options = [...select.options];
    choiceOptions.setAttribute('aria-label', name);
    choiceSearch.hidden = options.length <= 30;
    choiceSearch.value = '';
    choiceEmpty.hidden = true;
    choiceOptions.innerHTML = options
        .map((option, index) => {
            const hint = select.id === 'studio-objective' ? objectiveChoiceHints[option.value] : '';
            const tone = select.id === 'task-filter' ? taskChoiceTones[option.value] : '';
            return `<button type="button" class="choice-option" role="option" tabindex="-1" data-choice-index="${index}" aria-selected="${option.selected}" ${option.disabled ? 'disabled' : ''}>
        ${tone ? `<span class="choice-dot choice-dot-${tone}" aria-hidden="true"></span>` : ''}<span class="choice-copy"><strong>${escape(option.text)}</strong>${hint ? `<small>${escape(hint)}</small>` : ''}</span><span class="choice-check" aria-hidden="true">✓</span>
      </button>`;
        })
        .join('');
    openChoice = { trigger, select };
    trigger.setAttribute('aria-expanded', 'true');
    choicePopover.showPopover();
    choiceOptions.scrollTop = 0;
    positionChoicePopover();
    const first =
        choiceOptions.querySelector('[aria-selected=true]:not(:disabled)') ||
        choiceOptions.querySelector('button:not(:disabled)');
    if (!choiceSearch.hidden) choiceSearch.focus({ preventScroll: true });
    else first?.focus({ preventScroll: true });
    first?.scrollIntoView({ block: 'nearest' });
}

function closeChoicePopover(restoreFocus = false) {
    if (!openChoice) return;
    const { trigger } = openChoice;
    openChoice = null;
    trigger.setAttribute('aria-expanded', 'false');
    if (choicePopover.matches(':popover-open')) choicePopover.hidePopover();
    if (restoreFocus) trigger.focus({ preventScroll: true });
}

function chooseOption(button) {
    if (!openChoice || button.disabled) return;
    const { select, trigger } = openChoice;
    const index = Number(button.dataset.choiceIndex);
    closeChoicePopover();
    if (index !== select.selectedIndex) {
        select.selectedIndex = index;
        select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    document.getElementById(trigger.id)?.focus({ preventScroll: true });
}

choicePopover.addEventListener('toggle', (event) => {
    if (event.newState === 'closed' && !choicePopover.matches(':popover-open'))
        closeChoicePopover();
});
choicePopover.addEventListener('click', (event) => {
    const option = event.target.closest('[data-choice-index]');
    if (option) chooseOption(option);
});
choiceSearch.addEventListener('input', () => {
    const query = choiceSearch.value.trim().toLocaleLowerCase();
    let matches = 0;
    for (const button of choiceOptions.children) {
        const match = button
            .querySelector('strong')
            .textContent.toLocaleLowerCase()
            .includes(query);
        button.hidden = !match;
        if (match) matches++;
    }
    choiceEmpty.hidden = matches > 0;
    choiceOptions.scrollTop = 0;
    positionChoicePopover();
});
choicePopover.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' || event.key === 'Tab') {
        closeChoicePopover(true);
        if (event.key === 'Escape') event.preventDefault();
        return;
    }
    const searching = event.target === choiceSearch;
    if (
        !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) &&
        !(searching && event.key === 'Enter')
    )
        return;
    if (searching && ['Home', 'End'].includes(event.key)) return;
    const options = [...choiceOptions.querySelectorAll('button:not([hidden]):not(:disabled)')];
    if (!options.length) return;
    event.preventDefault();
    const index = options.indexOf(event.target);
    if (searching && event.key === 'Enter') {
        chooseOption(options[0]);
        return;
    }
    const last = options.length - 1;
    const next =
        event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : event.key === 'ArrowDown'
                ? (index + 1) % options.length
                : index <= 0
                  ? last
                  : index - 1;
    options[next].focus();
});
choiceOptions.addEventListener('pointermove', (event) => {
    if (!hoverMotion.matches || event.pointerType === 'touch') return;
    const button = event.target.closest('.choice-option');
    if (!button) return;
    const rect = button.getBoundingClientRect();
    button.style.setProperty('--choice-x', `${event.clientX - rect.left}px`);
    button.style.setProperty('--choice-y', `${event.clientY - rect.top}px`);
});
window.addEventListener('resize', positionChoicePopover);
document.addEventListener(
    'scroll',
    (event) => {
        if (!choicePopover.contains(event.target)) positionChoicePopover();
    },
    true,
);

function setupGlassControls(root) {
    const selectors =
        '.atelier-dock button,.care-row-arrows button,.growth-opportunity-tabs button,[data-flip],[data-unflip],#care-wall [data-open],summary,.choice-trigger';
    root.querySelectorAll(selectors).forEach((control) => {
        if (control.classList.contains('glass-control')) return;
        const face = document.createElement('span');
        face.className = 'glass-control-face glass-surface glass-tilt';
        face.setAttribute('aria-hidden', 'true');
        const icon = control.querySelector('.dock-icon');
        if (icon) face.append(icon);
        control.classList.add('glass-control');
        control.prepend(face);
        bindGlass(control, face, control.closest('.glass-track') ? 1.3 : 3.6);
    });
}

function bindGlass(track, surface, maxAngle) {
    let frame = null,
        pointer;
    function resetGlass() {
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null;
        track.classList.remove('is-lit');
        surface.style.removeProperty('--glass-turn');
    }
    function moveGlass(event) {
        if (!hoverMotion.matches || event.pointerType === 'touch' || document.hidden) return;
        pointer = { x: event.clientX, y: event.clientY };
        if (frame !== null) return;
        frame = requestAnimationFrame(() => {
            frame = null;
            if (!track.isConnected || !hoverMotion.matches) return;
            if (track.matches(':disabled')) {
                resetGlass();
                return;
            }
            // Measure the stationary track so the tilt cannot move the pointer's origin.
            const bounds = track.getBoundingClientRect(),
                height = surface.offsetHeight;
            if (!bounds.width || !height) return;
            const x = Math.min(1, Math.max(0, (pointer.x - bounds.left) / bounds.width));
            const y = Math.min(1, Math.max(0, 1 + (pointer.y - bounds.bottom) / height));
            const dx = x * 2 - 1,
                dy = y * 2 - 1,
                distance = Math.hypot(dx, dy);
            const angle = Math.min(1, distance) * maxAngle;
            surface.style.setProperty('--glass-x', `${x * 100}%`);
            surface.style.setProperty('--glass-y', `${y * 100}%`);
            surface.style.setProperty('--glass-mirror-x', `${(1 - x) * 100}%`);
            surface.style.setProperty(
                '--glass-turn',
                distance ? `rotate3d(${-dy / distance}, ${dx / distance}, 0, ${angle}deg)` : 'none',
            );
            track.classList.add('is-lit');
        });
    }
    track.addEventListener('pointerenter', moveGlass);
    track.addEventListener('pointermove', moveGlass);
    track.addEventListener('pointerleave', resetGlass);
    track.addEventListener('pointercancel', resetGlass);
}

document.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (button && !button.disabled && !state.saving && choiceFields.has(button))
        showChoicePopover(button);
});
export function beforeRender() {
    closeChoicePopover();
    careRowObserver?.disconnect();
    careRowObserver = null;
}
export function enhanceUI() {
    setupGlass(content);
    setupChoiceFields(content);
    setupGlassControls(document);
    setupCareRow();
    animatePageChange();
}
export function closeChoices() {
    closeChoicePopover();
}

export function enhanceFragment(root) {
    setupChoiceFields(root);
    setupGlassControls(root);
}

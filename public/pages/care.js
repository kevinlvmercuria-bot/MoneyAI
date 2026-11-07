import { state } from '../state.js';
import { CARE_OUTCOMES, DEMO_DATE, canContact } from '../rules-client.js';
import { escapeHtml } from '../components.js';

export function careFollowup(member) {
    const record = state.careRecords.find((record) => record.memberId === member.id);
    const draft = state.careDrafts.get(member.id) || {};
    const earliest = new Date(DEMO_DATE);
    earliest.setUTCDate(earliest.getUTCDate() + 14);
    const content = record
        ? `<h4>本次关怀已保存</h4><p>${escapeHtml(record.outcome)} · ${escapeHtml(record.owner)}</p><p>${escapeHtml(record.note)}</p><p class="helper">${record.followUp ? '计划跟进 ' + escapeHtml(record.followUp) : '未安排后续跟进'}。</p>`
        : !canContact(member)
          ? '<p class="helper">当前会员存在联系限制，暂不能保存新的沟通记录。</p>'
          : `<form id="care-form" data-member-id="${member.id}">
                <div class="field"><label for="care-outcome">处理结果</label><select id="care-outcome" name="outcome">${CARE_OUTCOMES.map((outcome) => `<option ${outcome === (draft.outcome || '已沟通') ? 'selected' : ''}>${outcome}</option>`).join('')}</select></div>
                <div class="field"><label for="care-note">顾客明确反馈 / 处理原因</label><textarea id="care-note" name="note" required maxlength="1000" placeholder="记录本人表达的需求，不推测原因。">${escapeHtml(draft.note || '')}</textarea></div>
                <div class="field"><label for="care-owner">跟进负责人</label><input id="care-owner" name="owner" required maxlength="80" autocomplete="off" value="${escapeHtml(draft.owner || '')}"></div>
                <div class="field"><label class="check-label"><input id="care-follow" type="checkbox" name="follow" ${draft.follow ? 'checked' : ''}>记录后续跟进计划</label><label for="care-date">计划日期 · 基准日 ${DEMO_DATE}</label><input id="care-date" name="date" type="date" value="${escapeHtml(draft.date || earliest.toISOString().slice(0, 10))}" ${draft.follow ? '' : 'disabled'}></div>
                <p class="helper">已沟通或未回复至少间隔 14 天。计划供查看，不自动发送消息、预约或计入消费。</p><button class="primary" type="submit">保存关怀记录</button>
            </form>`;
    return `<details id="workbench-followup" class="wb-followup"><summary>聊完，记录下一步 <small>${record ? '本次已有记录' : '反馈、负责人和跟进计划'}</small></summary>${content}</details>`;
}

export function careHistory() {
    return `<details id="care-history"><summary>关怀记录与后续计划 · ${state.careRecords.length} 条</summary>${state.careRecords.length ? `<div class="table-wrap"><table><thead><tr><th>会员</th><th>处理结果</th><th>反馈 / 原因</th><th>负责人</th><th>计划跟进</th></tr></thead><tbody>${state.careRecords.map((record) => `<tr><td>${escapeHtml(record.memberId)}</td><td>${escapeHtml(record.outcome)}</td><td class="wrap">${escapeHtml(record.note)}</td><td>${escapeHtml(record.owner)}</td><td>${escapeHtml(record.followUp || '未安排')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="helper">还没有关怀记录。</p>'}</details>`;
}

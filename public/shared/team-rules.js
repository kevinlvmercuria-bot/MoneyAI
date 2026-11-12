'use strict';

// 业务日期、联系资格、回访窗口及档案合并；不访问 DOM、数据库或浏览器存储。
(function () {
const teamCalendarFormatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

const TEAM_APPOINTMENT_LABELS = {
    scheduled: '待到店', rescheduled: '已改期', visited: '已到店', no_show: '未到店',
};

const TEAM_CARE_START_DAY = 7;
const TEAM_CARE_LAST_NURSING_DAY = 28;
const TEAM_CARE_LAST_DAY = 45;

function teamCareFollowupDate(visitDate) {
    if (!teamValidDate(visitDate)) return '';
    return new Date(Date.parse(visitDate) + TEAM_CARE_START_DAY * 86400000).toISOString().slice(0, 10);
}

function teamCarePhase(days) {
    if (!Number.isFinite(days) || days < TEAM_CARE_START_DAY || days > TEAM_CARE_LAST_DAY) return null;
    return days <= TEAM_CARE_LAST_NURSING_DAY ? 'care' : 'removal';
}

function teamCareProductMatches(product, phase) {
    const removal = product?.product_type === 'care_service' && product.product_name?.includes('卸甲');
    return phase === 'removal' ? Boolean(removal) : Boolean(product && product.product_type !== 'nail_style' && !removal);
}

function teamLatestCompletedNails(snapshot, date) {
    const memberTypes = new Map(snapshot.members.map(row => [row.member_id, row.data_type]));
    const latest = new Map();
    for (const order of snapshot.orders) {
        if (order.order_type !== 'nail_service' || typeof order.order_id !== 'string' || !order.order_id.trim()
            || order.order_id.length > 128 || memberTypes.get(order.member_id) !== order.data_type) continue;
        const simulation = snapshot.data_type === 'simulation' && order.data_type === 'simulation';
        // Historical rows in the bundled simulation have an order date but no
        // status. Real records must come from a source with explicit completion.
        if (order.status !== 'completed' && !(simulation && order.status == null)) continue;
        if (!simulation && !(order.data_type === 'real' && (snapshot.data_type !== 'simulation' || order.manual_entry === true))) continue;
        const completed = order.completed_on ?? (simulation && order.order_date <= snapshot.as_of_date ? order.order_date : null);
        if (!teamValidDate(completed) || completed > date) continue;
        const previous = latest.get(order.member_id);
        if (!previous || completed > previous.completed_on
            || (completed === previous.completed_on && order.order_id > previous.order_id))
            latest.set(order.member_id, { ...order, completed_on: completed });
    }
    return latest;
}

function teamCareReminderKey(row) {
    return JSON.stringify([row.member_id, row.service_order_id]);
}

function teamCalendarTime(now = new Date()) {
    return teamCalendarFormatter.format(now).replace(' ', 'T');
}

function teamBusinessClock(now = new Date()) {
    const local = teamCalendarTime(now);
    return { date: local.slice(0, 10), local, utc: now.toISOString() };
}

function teamDaysBetween(later, earlier) {
    return (Date.parse(later) - Date.parse(earlier)) / 86400000;
}

function teamMemberRecency(member, date) {
    const elapsed = teamValidDate(member.last_visit) ? teamDaysBetween(date, member.last_visit) : NaN;
    const days = Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null;
    const cycle = member.average_cycle_days;
    if (days === null || !Number.isFinite(cycle) || cycle <= 0)
        return { days, ratio: null, lifecycle: 'unknown' };

    const ratio = Number((days / cycle).toFixed(2));
    const lifecycle = ratio <= 1.15 ? 'active' : ratio <= 1.65 ? 'due' : ratio <= 2.4 ? 'low_frequency' : 'dormant';
    return { days, ratio, lifecycle };
}

function teamHasRecentContact(date, lastContact) {
    return Boolean(lastContact && teamDaysBetween(date, lastContact) < 14);
}

function teamContactBlockers(member, objective, serviceOrderId) {
    const care = objective === 'care';
    return [
        (!care || !member.manual_entry) && !member.consent && '未获得营销授权',
        care && !member.careOptIn && '未同意护理跟进',
        care && member.optedOut && '顾客已选择不再营销',
        member.complaint && '有未解决投诉',
        member.recent && !(care && serviceOrderId) && '14 天内已联系',
        member.appointment && '已有未来预约',
        member.care_paused && '已标记暂不联系',
        member.data_completeness < .8 && '档案完整度不足',
    ].filter(Boolean);
}

function teamNextMemberNumber(snapshotMembers, manualMembers) {
    let highest = 0;
    for (const members of [snapshotMembers, manualMembers]) {
        for (const member of members) {
            const match = /^M(\d+)$/.exec(member.member_number || member.member_id);
            if (match) highest = Math.max(highest, Number(match[1]));
        }
    }
    return highest + 1;
}

function teamFormatMemberNumber(number) {
    return 'M' + String(number).padStart(4, '0');
}

function teamWorkspaceSnapshot(snapshot, { manualMembers, manualServices, profileEdits }) {
    if (!manualMembers.length && !manualServices.length && !Object.keys(profileEdits).length) return snapshot;
    const dates = new Map();
    for (const order of manualServices) {
        if (!dates.has(order.member_id)) dates.set(order.member_id, new Set());
        dates.get(order.member_id).add(order.completed_on);
    }
    const registered = manualMembers.slice().reverse().map(member => {
        const visits = [...(dates.get(member.member_id) || [])].sort();
        const last = visits.at(-1) || '';
        return {
            last_visit: last, visit_count: visits.length, total_spending: null, stored_balance: null,
            average_cycle_days: visits.length > 1 ? Math.max(1, Math.round(teamDaysBetween(last, visits[0]) / (visits.length - 1))) : null,
            cycle_confidence: 'low', membership_level: '普通会员', preferred_styles: '', preferred_technician: '',
            last_contact_date: '', unresolved_complaint: false, priority_score: 0, data_completeness: 1,
            care_need_tags: '', preferred_care_service: '', ...member,
        };
    });
    const existing = snapshot.members.map(member => {
        const visits = [...(dates.get(member.member_id) || [])].filter(date => date > (member.last_visit || '')).sort();
        return visits.length ? { ...member, visit_count: member.visit_count + visits.length } : member;
    });
    const profiles = new Map(snapshot.member_care_profiles.map(row => [row.member_id, row]));
    const members = [...registered, ...existing].map(member => {
        const edit = profileEdits[member.member_id];
        if (member.manual_entry || edit) {
            const details = { ...member, ...edit };
            const previous = profiles.get(member.member_id);
            profiles.set(member.member_id, {
                member_id: member.member_id, data_type: member.data_type, ...previous,
                care_followup_opt_in: details.care_followup_opt_in ?? previous?.care_followup_opt_in ?? false,
                care_need_tags: details.care_need_tags ?? previous?.care_need_tags,
                preferred_care_service: details.preferred_care_service ?? previous?.preferred_care_service,
                ...(edit && (edit.care_need_tags !== undefined || edit.preferred_care_service !== undefined) && { care_need_source: 'owner_note' }),
            });
        }
        if (!member.manual_entry && !edit && !dates.has(member.member_id)) return member;
        const details = { ...member, ...edit };
        const visits = [...(dates.get(member.member_id) || []), details.profile_last_visit || member.last_visit || ''].sort();
        return {
            ...details, last_visit: visits.at(-1), average_cycle_days: details.profile_cycle_days ?? member.average_cycle_days,
            cycle_confidence: details.profile_cycle_days ? 'manual' : member.cycle_confidence,
        };
    });
    return {
        ...snapshot, members, orders: [...snapshot.orders, ...manualServices], member_care_profiles: [...profiles.values()],
    };
}

function teamLatestScheduledAppointments(appointments) {
    const dates = new Map();
    for (const appointment of appointments || []) {
        if (appointment.status === 'scheduled' && teamValidDate(appointment.appointment_date)
            && appointment.appointment_date > (dates.get(appointment.member_id) || ''))
            dates.set(appointment.member_id, appointment.appointment_date);
    }
    return dates;
}

function teamAppointmentPending(result) {
    return result?.booked && !['visited', 'no_show'].includes(result.appointment_status);
}

function teamTaskNeedsHandoff(task) {
    if (task.status === 'assigned') return true;
    if (task.status !== 'recorded') return false;
    const result = task.result;
    return Boolean(teamAppointmentPending(result) || (result?.follow_up_on && result.outcome !== '不再营销'));
}

function teamTaskBelongsTo(task, employee) {
    return task.assignee === employee && !task.employee_access_revoked;
}

function teamValidDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function teamTodoReasons(task, date) {
    if (task.status === 'assigned') return ['待联系'];
    if (task.status !== 'recorded' || !task.result) return [];
    const { result } = task;
    const reasons = [];
    if (result.follow_up_on && result.follow_up_on <= date && result.outcome !== '不再营销')
        reasons.push(result.follow_up_on === date ? '今天跟进' : '跟进已逾期');
    if (teamAppointmentPending(result) && result.appointment_at && result.appointment_at.slice(0, 10) <= date)
        reasons.push(result.appointment_at.startsWith(date) ? '今日预约' : '待登记到店结果');
    return reasons;
}


const rules = { teamCalendarFormatter, TEAM_APPOINTMENT_LABELS, TEAM_CARE_START_DAY, TEAM_CARE_LAST_NURSING_DAY, TEAM_CARE_LAST_DAY, teamCareFollowupDate, teamCarePhase, teamCareProductMatches, teamLatestCompletedNails, teamCareReminderKey, teamCalendarTime, teamBusinessClock, teamDaysBetween, teamMemberRecency, teamHasRecentContact, teamContactBlockers, teamNextMemberNumber, teamFormatMemberNumber, teamWorkspaceSnapshot, teamLatestScheduledAppointments, teamAppointmentPending, teamTaskNeedsHandoff, teamTaskBelongsTo, teamValidDate, teamTodoReasons };
if (typeof module !== 'undefined') module.exports = rules;
else globalThis.NailMateTeamRules = rules;
})();

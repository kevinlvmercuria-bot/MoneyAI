'use strict';

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

  function createTeamStore(snapshot, options = {}){
    const roster = [...new Set(snapshot.members.map(row => row.preferred_technician).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    const products = new Map(snapshot.products.map(row => [row.product_id, row]));
    products.set('IDEA-SEA-SALT', { product_type: 'nail_style', launch_date: '2026-11-14', style: '裸色' });
    const objectives = new Map(Object.entries({ repurchase: '复购邀请', balance: '储值关怀', new_product: '新品推荐', care: '护理关怀', preview: '新品预告', greeting: '日常问候' }));
    const outcomes = ['未回复', '有意向', '已预约', '已沟通', '暂不联系', '不再营销'];
    const noteTypes = ['preference', 'communication', 'service', 'care', 'appointment'];
    const snapshotNotes = new Map(snapshot.member_notes.map(row => [row.note_id, row]));
    const scheduledAppointments = teamLatestScheduledAppointments(snapshot.appointments);
    // Single-file preview. All fixture data and actions stay in this browser.
    const storageKey = 'nailmate-wechat-preview-v1-' + snapshot.snapshot_id;
    const clockNow = () => teamBusinessClock(options.now?.());
    let store = {
      accounts: roster.map((employee, index) => ({ employee, username: 'staff' + String(index + 1).padStart(2, '0'), role: 'employee' })),
      tasks: [], notes: [], noteEdits: {}, images: {}, memberUpdates: {}, care_records: [], careReminders: [], logs: [], revision: 0,
      manualMembers: [], manualServices: [], profileEdits: {}, catalogRevision: 0,
    };
    try {
      const saved = options.initialState || (options.storage ? JSON.parse(options.storage.getItem(storageKey) || 'null') : null);
      if (saved && Array.isArray(saved.accounts) && Array.isArray(saved.tasks)) store = { ...store, ...saved };
    } catch {}
    // Older deletions left a blank login name behind in the employee list.
    store.accounts = store.accounts.filter(account => account.username);
    if (options.careReminders) store.careReminders = options.careReminders;
    let memberNumbersChanged = store.manualMembers.some(member => !member.member_number);
    if (memberNumbersChanged) {
      let nextNumber = teamNextMemberNumber(snapshot.members, store.manualMembers);
      store.manualMembers = store.manualMembers.map(member => member.member_number
        ? member : { ...member, member_number: teamFormatMemberNumber(nextNumber++) });
      store.catalogRevision++;
    }
    let workspace, members, careProfiles;
    function indexWorkspace(updated) {
      workspace = updated;
      members = new Map(workspace.members.map(row => [row.member_id, row]));
      careProfiles = new Map(workspace.member_care_profiles.map(row => [row.member_id, row]));
    }
    indexWorkspace(teamWorkspaceSnapshot(snapshot, store));
    for (const id of new Set(store.tasks.filter(task => task.result).map(task => task.member_id)))
      rebuildMemberUpdates(store, id);
    const staff = () => store.accounts.map(account => account.employee);
    function commit(next, updatedWorkspace) {
      next.revision = store.revision + 1;
      // Persist first: a full storage device must not look like a successful save.
      if (options.storage) options.storage.setItem(storageKey, JSON.stringify(next));
      store = next;
      memberNumbersChanged = false;
      if (updatedWorkspace) indexWorkspace(updatedWorkspace);
    }

    function requireCondition(condition, status, message) {
      if (!condition) throw Object.assign(new Error(message), { status });
    }

    function field(value, max, required = false) {
      requireCondition(typeof value === 'string' && value.length <= max && (!required || value.trim()), 400, '请检查填写内容和长度。');
      return value.trim();
    }

    function profileFields(body, date) {
      const details = { display_name: field(body.name, 40, true) };
      requireCondition(typeof body.marketingConsent === 'boolean' && typeof body.careOptIn === 'boolean', 400, '请确认顾客的联系授权。');
      Object.assign(details, { marketing_consent: body.marketingConsent, care_followup_opt_in: body.careOptIn });
      for (const [key, value, limit] of [
        ['membership_level', body.membershipLevel, 30], ['preferred_styles', body.styles, 120],
        ['preferred_technician', body.technician, 40], ['care_need_tags', body.careTags, 120],
        ['preferred_care_service', body.careService, 60],
      ]) {
        if (value === undefined) continue;
        const text = field(value, limit, key === 'membership_level');
        details[key] = ['preferred_styles', 'care_need_tags'].includes(key)
          ? [...new Set(text.split(/[|、，,]/).map(tag => tag.trim()).filter(Boolean))].join('|') : text;
      }
      for (const [key, value] of [['created_date', body.joinedOn], ['profile_last_visit', body.lastVisit]]) {
        if (value === undefined) continue;
        requireCondition(value === '' || (teamValidDate(value) && value >= '0001-01-01' && value <= date),
          400, '入会和到店日期应为今天或更早。');
        details[key] = value || null;
      }
      for (const [key, value] of [['total_spending', body.totalSpending], ['stored_balance', body.balance]]) {
        if (value === undefined) continue;
        requireCondition(value === '' || /^\d{1,8}(?:\.\d{1,2})?$/.test(String(value)), 400, '请填写非负金额，最多保留两位小数。');
        details[key] = value === '' ? null : Number(value);
      }
      if (body.cycle !== undefined) {
        requireCondition(body.cycle === '' || (/^\d+$/.test(String(body.cycle)) && Number(body.cycle) >= 1 && Number(body.cycle) <= 3650),
          400, '请填写 1–3650 天的个人周期，留空则按记录计算。');
        details.profile_cycle_days = body.cycle === '' ? null : Number(body.cycle);
      }
      if (body.complaint !== undefined) {
        requireCondition(typeof body.complaint === 'boolean', 400, '请检查投诉状态。');
        details.unresolved_complaint = body.complaint;
      }
      return details;
    }

    function manualId(prefix, requestId) {
      requireCondition(typeof requestId === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(requestId),
        400, '请重新打开录入表单后再保存。');
      return prefix + requestId.toLowerCase();
    }

    function scopedState(account, clock = clockNow()) {
      requireCondition(['owner', 'employee'].includes(account.role), 403, '请先选择身份登录。');
      const owner = account.role === 'owner';
      const tasks = owner ? store.tasks : store.tasks.filter(task => teamTaskBelongsTo(task, account.employee));
      const allowed = new Set(tasks.map(task => task.member_id));
      const employeeId = !owner && store.accounts.find(row => row.employee === account.employee)?.account_id;
      const notes = store.notes.filter(note => owner || allowed.has(note.member_id)).map(({ author_account_id, ...note }) => ({
        ...note,
        ...(employeeId && author_account_id === employeeId && { can_edit: true }),
      }));
      const noteEdits = owner ? store.noteEdits : Object.fromEntries(Object.entries(store.noteEdits).filter(([id]) =>
        allowed.has(snapshotNotes.get(id)?.member_id) || notes.some(note => note.note_id === id)));
      return {
        tasks, notes, noteEdits, images: store.images, revision: store.revision, catalogRevision: store.catalogRevision, employeeNotesEnabled: true,
        workDate: clock.date, calendarDate: clock.date,
        memberUpdates: owner ? store.memberUpdates : Object.fromEntries(Object.entries(store.memberUpdates).filter(([id]) => allowed.has(id))),
        logs: owner ? store.logs : [],
        ...(owner && { careReminders: store.careReminders }),
        care_records: owner ? store.care_records : [],
        accounts: owner ? store.accounts.filter(account => account.role === 'employee').map(({ employee, username }) => ({ employee, username })) : [],
      };
    }

    function reconcileCareReminders(next, clock, catalog = workspace) {
      const latest = teamLatestCompletedNails(catalog, clock.date);
      const profiles = catalog === workspace ? careProfiles : new Map(catalog.member_care_profiles.map(row => [row.member_id, row]));
      const keys = new Set(next.careReminders.map(teamCareReminderKey));
      const tasks = new Map(next.tasks.map(task => [task.task_id, task]));
      let changed = false;
      for (const reminder of next.careReminders) {
        if (['processed', 'booked'].includes(reminder.status)) continue;
        const order = latest.get(reminder.member_id);
        const current = order?.order_id === reminder.service_order_id;
        const due = current ? teamCareFollowupDate(order.completed_on) : reminder.due_on;
        const completed = current ? order.completed_on : reminder.completed_on;
        let status = reminder.status;
        if (!current) status = 'superseded';
        else if (status === 'assigned' && due > clock.date) status = 'pending';
        else if (status !== 'assigned') status = teamDaysBetween(clock.date, completed) > TEAM_CARE_LAST_DAY ? 'expired' : 'pending';
        if (status === reminder.status && completed === reminder.completed_on && due === reminder.due_on) continue;
        const task = tasks.get(reminder.task_id);
        if (reminder.status === 'assigned' && task) {
          if (status !== 'assigned') {
            task.status = 'archived';
            task.history.push(`${current ? '服务完成日期已更正，等待重新到期' : '对应服务已失效或有更新的美甲完成记录'} · ${clock.date}`);
          } else {
            task.care_due_on = due;
            task.history.push(`已更新本次回访的开始日期 · ${clock.date}`);
          }
        }
        if (status === 'pending' || status === 'expired') reminder.task_id = null;
        Object.assign(reminder, { status, due_on: due, completed_on: completed, updated_at: clock.utc });
        changed = true;
      }
      for (const order of latest.values()) {
        if (!profiles.get(order.member_id)?.care_followup_opt_in) continue;
        const due = teamCareFollowupDate(order.completed_on);
        if (!teamCarePhase(teamDaysBetween(clock.date, order.completed_on))) continue;
        const identity = { member_id: order.member_id, service_order_id: order.order_id };
        if (keys.has(teamCareReminderKey(identity))) continue;
        next.careReminders.push({ ...identity, completed_on: order.completed_on, due_on: due, status: 'pending',
          task_id: null, data_type: order.data_type, created_at: clock.utc, updated_at: clock.utc });
        changed = true;
      }
      return changed;
    }

    function refreshCareReminders(clock = clockNow()) {
      const next = structuredClone(store);
      const remindersChanged = reconcileCareReminders(next, clock);
      if (!remindersChanged && !memberNumbersChanged) return false;
      commit(next);
      return true;
    }

    function feedbackDate(result) {
      const stamp = result.recorded_at || result.updated_at;
      if (stamp && Number.isFinite(Date.parse(stamp))) return teamBusinessClock(new Date(stamp)).date;
      return result.recorded_on === snapshot.as_of_date ? undefined : result.recorded_on;
    }

    // Rebuild the derived fields from feedback, including older records with
    // a UTC audit timestamp and a demo date in recorded_on.
    // Rebuild them after a correction so an old appointment/pause does not linger.
    function rebuildMemberUpdates(next, memberId) {
      const update = { ...next.memberUpdates[memberId] };
      for (const key of ['last_contact_date', 'contact_recorded_on', 'last_handled_on', 'appointment', 'consent', 'care_paused']) delete update[key];
      const memberTasks = next.tasks.filter(task => task.member_id === memberId);
      const results = memberTasks.filter(task => task.status === 'recorded' && task.result).map(task => task.result);
      // Updating a later pause/appointment cannot undo a contact that already happened.
      const histories = memberTasks.filter(task => task.result)
        .map(task => task.result_history?.length ? task.result_history : [task.result]);
      const latestContact = histories.map(history => history.find(result => result.contacted))
        .filter(Boolean).map(result => result.contacted_on || feedbackDate(result)).filter(Boolean).sort().at(-1);
      const latestHandled = histories.map(history => feedbackDate(history[0])).filter(Boolean).sort().at(-1);
      if (latestContact) {
        update.contact_recorded_on = latestContact;
        update.last_contact_date = [latestContact, members.get(memberId)?.last_contact_date].filter(Boolean).sort().at(-1);
      }
      if (latestHandled) update.last_handled_on = latestHandled;
      if (results.some(teamAppointmentPending)) update.appointment = true;
      if (results.some(result => result.outcome === '不再营销')) update.consent = false;
      if (results.some(result => result.outcome === '暂不联系')) update.care_paused = true;
      next.memberUpdates[memberId] = update;
    }

    function resultPlan(body, previous, { local: now, date }) {
      const followUpOn = body.followUpOn ?? previous?.follow_up_on ?? '';
      const followUpNote = field(body.followUpNote ?? previous?.follow_up_note ?? '', 180);
      requireCondition(followUpOn === '' || teamValidDate(followUpOn), 400, '请选择有效的跟进日期。');
      requireCondition(!followUpOn || followUpOn >= date || followUpOn === previous?.follow_up_on,
        400, '新的跟进日期不能早于今天。');

      let appointmentAt = '';
      let appointmentStatus = '';
      if (body.outcome === '已预约') {
        appointmentAt = body.appointmentAt ?? previous?.appointment_at ?? '';
        appointmentStatus = body.appointmentStatus || previous?.appointment_status || 'scheduled';
        requireCondition(Object.hasOwn(TEAM_APPOINTMENT_LABELS, appointmentStatus), 400, '请选择有效的到店状态。');
        requireCondition(appointmentAt === '' || (typeof appointmentAt === 'string'
          && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(appointmentAt)
          && teamValidDate(appointmentAt.slice(0, 10))), 400, '请填写有效的预约日期和时间。');
        const oldTime = previous?.appointment_at;
        if (appointmentStatus === 'visited' || appointmentStatus === 'no_show') {
          requireCondition(appointmentAt && appointmentAt <= now, 400, '预约时间到达后才能登记到店结果。');
        } else {
          requireCondition(!appointmentAt || appointmentAt.slice(0, 10) >= date || appointmentAt === oldTime,
            400, '新的预约日期不能早于今天。');
          if (oldTime && appointmentAt && appointmentAt !== oldTime) appointmentStatus = 'rescheduled';
          if (appointmentStatus === 'rescheduled') {
            requireCondition(appointmentAt && (oldTime && appointmentAt !== oldTime || previous?.appointment_status === 'rescheduled'),
              400, '改期时请选择新的预约时间。');
          }
        }
      }
      return {
        follow_up_on: body.outcome === '不再营销' ? '' : followUpOn,
        follow_up_note: body.outcome === '不再营销' ? '' : followUpNote,
        appointment_at: appointmentAt,
        appointment_status: appointmentStatus,
      };
    }

    function checkContact(next, id, objective, productId, date, serviceOrderId) {
      const m = members.get(id);
      const update = next.memberUpdates[id] || {};
      const product = products.get(productId);
      const reasons = teamContactBlockers({
        consent: update.consent ?? m.marketing_consent,
        manual_entry: m.manual_entry,
        careOptIn: careProfiles.get(id)?.care_followup_opt_in,
        optedOut: update.consent === false,
        complaint: m.unresolved_complaint,
        recent: teamHasRecentContact(date, update.last_contact_date ?? m.last_contact_date),
        appointment: update.appointment || (scheduledAppointments.get(id) || '') >= date,
        care_paused: update.care_paused,
        data_completeness: m.data_completeness,
      }, objective, serviceOrderId);
      if (objective === 'preview') {
        const untilLaunch = teamDaysBetween(product?.launch_date, date);
        const { lifecycle } = teamMemberRecency({ ...m, ...update }, date);
        if (lifecycle !== 'active' || product?.product_type !== 'nail_style' || !(untilLaunch >= 1 && untilLaunch <= 14)
          || !m.preferred_styles.split('|').includes(product.style)) reasons.push('不符合新品预告条件');
      }
      return reasons;
    }

    function applyAction(account, body) {
      const action = body.action;
      requireCondition(account.role === (['result', 'employeeNote'].includes(action) ? 'employee' : 'owner'), 403, '当前账号没有这项操作权限。');
      const next = structuredClone(store);
      const clock = clockNow();
      const { date, utc } = clock;
      reconcileCareReminders(next, clock);
      let taskIds = [];
      let memberId, updatedWorkspace;
      switch (action) {
        case 'registerMember': {
          const details = profileFields(body, date);
          memberId = body.memberId ?? manualId('C-', body.requestId);
          const record = members.get(memberId);
          const current = { ...record, care_followup_opt_in: Boolean(careProfiles.get(memberId)?.care_followup_opt_in) };
          const changes = Object.entries(details).filter(([key, value]) => current[key] !== value);
          if (record && !changes.length)
            return { state: scopedState(account, clock), taskIds, memberId };
          if (body.memberId != null) {
            requireCondition(record, 404, '没有找到这位顾客。');
            const revision = record.profile_revision ?? record.revision ?? 0;
            requireCondition(revision === (body.expectedRevision ?? 0), 409, '顾客资料已更新，请关闭后重新打开。');
            next.profileEdits[memberId] = { ...next.profileEdits[memberId], ...Object.fromEntries(changes), profile_revision: revision + 1 };
            next.logs.push(`已更新顾客档案 ${record.member_number || memberId} · ${date}`);
          } else {
            requireCondition(!record, 409, '录入请求已使用，请重新打开表单。');
            const memberNumber = teamFormatMemberNumber(teamNextMemberNumber(snapshot.members, next.manualMembers));
            next.manualMembers.push({ member_id: memberId, member_number: memberNumber, created_date: date, ...details, manual_entry: true,
              revision: 1, data_type: options.storage ? 'simulation' : 'real' });
          }
          updatedWorkspace = teamWorkspaceSnapshot(snapshot, next);
          break;
        }
        case 'registerService': {
          memberId = body.memberId;
          const customer = members.get(memberId);
          requireCondition(customer, 404, '没有找到这位顾客。');
          requireCondition(teamValidDate(body.completedOn) && body.completedOn >= '0001-01-01' && body.completedOn <= date,
            400, '请选择今天或更早的实际服务完成日期。');
          const orderId = body.orderId ?? manualId('S-', body.requestId);
          const order = next.manualServices.find(row => row.order_id === orderId);
          if (order?.member_id === memberId && order.completed_on === body.completedOn)
            return { state: scopedState(account, clock), taskIds, memberId };
          if (body.orderId != null) {
            requireCondition(order?.member_id === memberId, 404, '没有找到这条手工服务记录。');
            requireCondition(order.completed_on === body.expectedCompletedOn, 409, '服务日期已更新，请关闭后重新打开。');
          } else {
            requireCondition(!workspace.orders.some(row => row.order_id === orderId), 409, '录入请求已使用，请重新打开表单。');
          }
          requireCondition(!next.manualServices.some(row => row.order_id !== orderId && row.member_id === memberId && row.completed_on === body.completedOn),
            409, '这位顾客当天已登记美甲完成。可在档案中更正原记录。');
          if (order) {
            Object.assign(order, { completed_on: body.completedOn, order_date: body.completedOn, updated_at: utc });
          } else {
            next.manualServices.push({ order_id: orderId, member_id: memberId, order_type: 'nail_service', status: 'completed',
              completed_on: body.completedOn, order_date: body.completedOn, data_type: customer.data_type, manual_entry: true,
              style: '手工登记美甲', created_at: utc, updated_at: utc });
          }
          updatedWorkspace = teamWorkspaceSnapshot(snapshot, next);
          break;
        }
        case 'employeeAccount': {
          const known = staff();
          let employee = body.employee;
          if (employee) requireCondition(known.includes(employee), 400, '请选择员工。');
          else {
            employee = field(body.newEmployee, 30, true);
            requireCondition(!/[\p{Cc}\p{Zl}\p{Zp}]/u.test(employee), 400, '请输入有效的员工姓名。');
            requireCondition(!known.includes(employee), 409, '这位员工已存在，请在列表中选择。');
            // A new account can reuse a display name, but ownership of a
            // departed employee's history must not follow that name.
            for (const task of next.tasks)
              if (task.assignee === employee) task.employee_access_revoked = true;
          }
          const username = field(body.username, 32, true).toLowerCase();
          requireCondition(/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username), 400, '请填写 3–32 位的演示账号。');
          requireCondition(!next.accounts.some(account => account.username === username && account.employee !== employee), 409, '这个账号名已被使用。');
          const existing = next.accounts.find(account => account.employee === employee);
          next.accounts = next.accounts.filter(account => account !== existing);
          next.accounts.push({ ...existing, employee, username, role: 'employee' });
          break;
        }
        case 'deleteEmployeeAccount': {
          const employee = body.employee;
          const removed = next.accounts.find(item => item.role === 'employee' && item.employee === employee);
          requireCondition(removed?.username && removed.username === body.username, 409, '该员工账号已变更，请刷新后重试。');
          const pending = next.tasks.filter(task => teamTaskBelongsTo(task, employee) && teamTaskNeedsHandoff(task));
          if (pending.length) {
            requireCondition(typeof body.replacement === 'string', 409, '请选择如何交接未完成任务。');
            const replacement = body.replacement;
            if (replacement) {
              requireCondition(replacement !== employee && next.accounts.some(item => item.role === 'employee' && item.username && item.employee === replacement),
                409, '请为未完成任务选择另一位已开通账号的员工。');
            }
            for (const task of pending) {
              if (task.result && !task.result.recorded_by) task.result.recorded_by = employee;
              for (const result of task.result_history || []) result.recorded_by ||= employee;
              task.assignee = replacement;
              const handoff = replacement ? `转交给 ${replacement}` : '退回待交接';
              task.history.push(`老板娘删除 ${employee} 的账号，未完成任务${handoff} · ${date}`);
              taskIds.push(task.task_id);
            }
          }
          for (const task of next.tasks)
            if (task.assignee === employee) task.employee_access_revoked = true;
          next.accounts = next.accounts.filter(item => item !== removed);
          next.logs.push(`老板娘删除 ${employee} 的登录账号，${pending.length} 项任务${body.replacement ? '已转交' : '待交接'}。`);
          break;
        }
        case 'assign': {
          requireCondition(Array.isArray(body.tasks) && body.tasks.length >= 1 && body.tasks.length <= 100, 400, '每次请选择 1–100 位顾客。');
          for (const input of body.tasks) {
            requireCondition(input && members.has(input.member_id) && objectives.has(input.objective), 400, '请选择有效的顾客和沟通目的。');
            requireCondition(staff().includes(input.assignee), 400, '请选择已开通账号的员工。');
            const active = next.tasks.find(task => task.member_id === input.member_id && task.status === 'assigned');
            requireCondition(!active, 409, active?.assignee ? `这位顾客已由 ${active.assignee} 负责。` : '这位顾客已有待交接任务。');
            const productId = input.product_id || null;
            const product = products.get(productId);
            requireCondition(input.objective === 'greeting' ? productId === null : Boolean(product && (input.objective === 'preview' || product.is_active)), 400, '请选择有效的产品。');
            const reminder = input.objective === 'care' ? next.careReminders.find(row =>
              row.member_id === input.member_id && row.service_order_id === input.service_order_id) : null;
            const carePhase = reminder && teamCarePhase(teamDaysBetween(date, reminder.completed_on));
            if (input.objective === 'care') {
              requireCondition(reminder?.status === 'pending' && carePhase,
                409, '护理回访仅限服务完成后第 7–45 天且仍待分派，请刷新回访名单。');
              requireCondition((input.care_action == null || input.care_action === carePhase) && teamCareProductMatches(product, carePhase),
                409, '当前回访阶段与所选服务不符，请刷新并按最新建议重新选择。');
            }
            const reasons = checkContact(next, input.member_id, input.objective, productId, date, reminder?.service_order_id);
            if (next.memberUpdates[input.member_id]?.last_handled_on === date) reasons.push('今天已有沟通记录');
            requireCondition(!reasons.length, 409, `暂不可分派：${reasons.join('、')}。`);
            const id = 'T' + String(next.tasks.length + 1).padStart(4, '0');
            next.tasks.push({ task_id: id, member_id: input.member_id, objective: input.objective, strategy: objectives.get(input.objective),
              ...(reminder && { care_service_order_id: reminder.service_order_id, care_due_on: reminder.due_on, care_action: carePhase }),
              assignee: input.assignee, product_id: productId, assigned_on: date, assigned_at: utc, assigned_by: account.username || '老板娘',
              note: field(input.note, 180), reason: field(input.reason, 1200),
              message: field(input.message, 1600, true), status: 'assigned', result: null, history: [`老板娘分派给 ${input.assignee} · ${date}`],
              data_type: reminder?.data_type || members.get(input.member_id).data_type || 'simulation' });
            if (reminder) Object.assign(reminder, { status: 'assigned', task_id: id, updated_at: utc });
            taskIds.push(id);
          }
          next.logs.push(`分派 ${taskIds.length} 项联系任务。`);
          break;
        }
        case 'reassign': {
          const task = next.tasks.find(task => task.task_id === body.id);
          requireCondition(task && (task.status === 'assigned' || (!task.assignee && teamTaskNeedsHandoff(task))),
            409, '仅待联系或待交接任务可以改派。');
          requireCondition(task.assignee === body.previous, 409, '负责人已变更，请刷新后再改派。');
          requireCondition(staff().includes(body.assignee), 400, '请选择已开通账号的员工。');
          if (task.assignee !== body.assignee) {
            task.history.push(`老板娘将任务由 ${task.assignee || '待交接'} 改派给 ${body.assignee} · ${date}`);
            task.assignee = body.assignee;
            delete task.employee_access_revoked;
          }
          break;
        }
        case 'withdraw': {
          const task = next.tasks.find(item => item.task_id === body.id);
          if (task?.withdrawn_at) return { state: scopedState(account, clock), taskIds };
          requireCondition(task?.status === 'assigned' && !task.result, 409, '仅尚未登记反馈的待联系任务可以撤回。');
          requireCondition(task.assignee === body.previous, 409, '负责人已变更，请刷新后再撤回。');
          Object.assign(task, { status: 'archived', withdrawn_at: utc, employee_access_revoked: true });
          task.history.push(`${account.username || '老板娘'} 撤回误派 · ${date}`);
          const reminder = task.care_service_order_id && next.careReminders.find(row => row.task_id === task.task_id && row.status === 'assigned');
          if (reminder) {
            Object.assign(reminder, { status: 'pending', task_id: null, updated_at: utc });
            reconcileCareReminders(next, clock);
          }
          next.logs.push(`已撤回联系任务 ${task.task_id}。`);
          break;
        }
        case 'result': {
          const task = next.tasks.find(task => task.task_id === body.id && teamTaskBelongsTo(task, account.employee));
          requireCondition(task, 404, '没有找到你的这项任务。');
          requireCondition(['assigned', 'recorded'].includes(task.status), 409, '当前任务不可修改反馈。');
          const previous = task.result;
          const revision = task.result_revision || 0;
          requireCondition((body.expectedRevision ?? 0) === revision, 409, '反馈已更新，请刷新任务后再修改。');
          requireCondition(outcomes.includes(body.outcome), 400, '请选择沟通结果。');
          // Editing a record is not a new outbound contact: its own cooldown,
          // appointment or pause must not prevent a later reply being recorded.
          if (!previous) {
            const reasons = checkContact(next, task.member_id, task.objective, task.product_id, date, task.care_service_order_id);
            requireCondition(!reasons.length || body.outcome === '暂不联系', 409, '当前有联系限制，请选择「暂不联系」。');
          }
          const note = field(body.note, 500);
          const contacted = body.outcome !== '暂不联系';
          const message = field(body.message, 1600) || task.message;
          const plan = resultPlan(body, previous, clock);
          const oldStatus = previous?.appointment_status || (previous?.booked ? 'scheduled' : '');
          const samePlan = (previous?.follow_up_on || '') === plan.follow_up_on
            && (previous?.follow_up_note || '') === plan.follow_up_note
            && (previous?.appointment_at || '') === plan.appointment_at && oldStatus === plan.appointment_status;
          if (previous && previous.outcome === body.outcome && previous.note === note && task.message === message && samePlan)
            return { state: scopedState(account, clock), taskIds: [] };
          task.result_history ||= previous ? [{ ...previous, revision, message: task.message }] : [];
          task.message = message;
          task.status = 'recorded';
          task.result_revision = revision + 1;
          const firstFeedback = task.result_history[0];
          const firstContact = task.result_history.find(entry => entry.contacted);
          task.result = { outcome: body.outcome, note, contacted, booked: body.outcome === '已预约',
            ...plan, recorded_on: (firstFeedback && feedbackDate(firstFeedback)) || date,
            recorded_at: firstFeedback ? firstFeedback.recorded_at || firstFeedback.updated_at : utc,
            contacted_on: contacted ? (firstContact && (firstContact.contacted_on || feedbackDate(firstContact))) || date : undefined,
            updated_at: utc, recorded_by: account.employee };
          task.result_history.push({ ...task.result, revision: task.result_revision, message });
          task.history.push(`${account.employee} ${previous ? `将「${previous.outcome}」更新为` : '记录'}「${body.outcome}」 · ${date} · 第 ${task.result_revision} 次保存`);
          const reminder = task.care_service_order_id && next.careReminders.find(row => row.task_id === task.task_id);
          if (reminder && (body.outcome !== '暂不联系' || reminder.status === 'booked')) {
            const booked = task.result.booked && plan.appointment_status !== 'no_show';
            Object.assign(reminder, { status: booked ? 'booked' : 'processed', updated_at: utc });
          }
          const record = { task_id: task.task_id, member_id: task.member_id, outcome: body.outcome, note, owner: account.employee, recorded_as_of: task.result.recorded_on, data_type: task.data_type || 'simulation' };
          const recordIndex = next.care_records.findIndex(item => item.task_id === task.task_id);
          if (recordIndex < 0) next.care_records.push(record);
          else next.care_records[recordIndex] = record;
          rebuildMemberUpdates(next, task.member_id);
          break;
        }
        case 'note': {
          requireCondition(members.has(body.memberId), 400, '会员不存在。');
          const previous = body.noteId && (snapshotNotes.get(body.noteId) || next.notes.find(note => note.note_id === body.noteId));
          requireCondition(!body.noteId || previous?.member_id === body.memberId, 400, '备注不存在。');
          const changes = { is_pinned: Boolean(body.pinned), updated_at: utc };
          if (body.text !== undefined) {
            requireCondition(previous?.author_role !== 'employee', 403, '员工备注由原作者修改。');
            requireCondition(noteTypes.includes(body.type), 400, '请选择备注类型。');
            Object.assign(changes, { note_text: field(body.text, 1200, true), note_type: body.type });
          }
          if (previous) next.noteEdits[previous.note_id] = { ...next.noteEdits[previous.note_id], ...changes };
          else {
            requireCondition(changes.note_text, 400, '请填写备注。');
            next.notes.push({ ...changes, note_id: 'NOTE-' + crypto.randomUUID(), member_id: body.memberId, author_name: '店主', author_role: 'owner', created_at: changes.updated_at });
          }
          break;
        }
        case 'employeeNote': {
          const task = next.tasks.find(task => task.task_id === body.taskId && teamTaskBelongsTo(task, account.employee));
          requireCondition(task && ['assigned', 'recorded'].includes(task.status), 404, '没有找到可以备注的任务。');
          const employee = next.accounts.find(row => row.employee === account.employee);
          requireCondition(employee, 403, '员工账号不存在。');
          const text = field(body.text, 1200, true);
          requireCondition(noteTypes.includes(body.type), 400, '请选择备注类型。');
          const changes = { note_text: text, note_type: body.type, updated_at: utc };
          if (body.noteId !== undefined) {
            const previous = next.notes.find(note => note.note_id === body.noteId && note.member_id === task.member_id);
            requireCondition(previous?.author_role === 'employee' && employee.account_id
              && previous.author_account_id === employee.account_id, 404, '没有找到你可以修改的备注。');
            const overlay = next.noteEdits[previous.note_id];
            const revision = overlay?.revision || 0;
            requireCondition(body.expectedRevision === revision, 409, '备注已更新，请先复制草稿，再刷新并重新编辑。');
            next.noteEdits[previous.note_id] = { ...overlay, ...changes, revision: revision + 1 };
          } else {
            employee.account_id ||= crypto.randomUUID();
            next.notes.push({ ...changes, note_id: 'NOTE-' + crypto.randomUUID(), member_id: task.member_id,
              author_name: employee.employee, author_role: 'employee', author_account_id: employee.account_id,
              is_pinned: false, created_at: utc });
          }
          break;
        }
        case 'photo':
          requireCondition(products.has(body.productId) && typeof body.image === 'string' && body.image.length <= 1400000
            && /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]+={0,2}$/.test(body.image), 400, '请上传有效的产品图片。');
          next.images[body.productId] = body.image;
          break;
        default:
          requireCondition(false, 400, '未知操作。');
      }
      if (updatedWorkspace) {
        next.catalogRevision++;
        reconcileCareReminders(next, clock, updatedWorkspace);
      }
      commit(next, updatedWorkspace);
      return { state: scopedState(account, clock), taskIds, ...(memberId && { memberId }) };
    }

    return { roster, scopedState, applyAction, refreshCareReminders, workspaceSnapshot: () => workspace,
      listAccounts: () => store.accounts.map(({ employee, username }) => ({ employee, username })), exportState: () => structuredClone(store) };
  }

if (typeof module !== 'undefined') module.exports = { createTeamStore, teamBusinessClock, teamCalendarTime, teamTodoReasons, teamAppointmentPending, teamTaskNeedsHandoff, teamCareReminderKey, teamMemberRecency, teamCarePhase };

'use strict';

const teamCalendarFormatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

const TEAM_APPOINTMENT_LABELS = {
    scheduled: '待到店', rescheduled: '已改期', visited: '已到店', no_show: '未到店',
};

const TEAM_CARE_FOLLOWUP_DAY = 21;

function teamCareFollowupDue(visitDate, calendarDate) {
    return Boolean(calendarDate && teamCareFollowupDate(visitDate) === calendarDate);
}

function teamCareFollowupDate(visitDate) {
    if (!teamValidDate(visitDate)) return '';
    return new Date(Date.parse(visitDate) + TEAM_CARE_FOLLOWUP_DAY * 86400000).toISOString().slice(0, 10);
}

function teamCalendarTime(now = new Date()) {
    return teamCalendarFormatter.format(now).replace(' ', 'T');
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
    const members = new Map(snapshot.members.map(row => [row.member_id, row]));
    const roster = [...new Set(snapshot.members.map(row => row.preferred_technician).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    const products = new Map(snapshot.products.map(row => [row.product_id, row]));
    products.set('IDEA-SEA-SALT', { product_type: 'nail_style', launch_date: '2026-11-14', style: '裸色' });
    const objectives = new Map(Object.entries({ repurchase: '复购邀请', balance: '储值关怀', new_product: '新品推荐', care: '护理关怀', preview: '新品预告', greeting: '日常问候' }));
    const outcomes = ['未回复', '有意向', '已预约', '已沟通', '暂不联系', '不再营销'];
    const noteTypes = ['preference', 'communication', 'service', 'care', 'appointment'];
    const careProfiles = new Map(snapshot.member_care_profiles.map(row => [row.member_id, row]));
    const snapshotNotes = new Map(snapshot.member_notes.map(row => [row.note_id, row]));
    const recentNails = new Map();
    for (const order of snapshot.orders) {
      if (order.order_type !== 'nail_service' || order.order_date > snapshot.as_of_date) continue;
      const previous = recentNails.get(order.member_id);
      if (!previous || order.order_date > previous) recentNails.set(order.member_id, order.order_date);
    }

    // Single-file preview. All fixture data and actions stay in this browser.
    const storageKey = 'nailmate-wechat-preview-v1-' + snapshot.snapshot_id;
    const today = () => snapshot.as_of_date;
    const calendarTime = () => teamCalendarTime(options.now?.());
    const daysBetween = (later, earlier) => (Date.parse(later) - Date.parse(earlier)) / 86400000;
    let store = {
      accounts: roster.map((employee, index) => ({ employee, username: 'staff' + String(index + 1).padStart(2, '0'), role: 'employee' })),
      tasks: [], notes: [], noteEdits: {}, images: {}, memberUpdates: {}, care_records: [], logs: [], revision: 0,
    };
    try {
      const saved = options.initialState || (options.storage ? JSON.parse(options.storage.getItem(storageKey) || 'null') : null);
      if (saved && Array.isArray(saved.accounts) && Array.isArray(saved.tasks)) store = { ...store, ...saved };
    } catch {}
    // Older deletions left a blank login name behind in the employee list.
    store.accounts = store.accounts.filter(account => account.username);
    const staff = () => store.accounts.map(account => account.employee);
    function commit(next) {
      next.revision = store.revision + 1;
      // Persist first: a full storage device must not look like a successful save.
      if (options.storage) options.storage.setItem(storageKey, JSON.stringify(next));
      store = next;
    }

    function requireCondition(condition, status, message) {
      if (!condition) throw Object.assign(new Error(message), { status });
    }

    function field(value, max, required = false) {
      requireCondition(typeof value === 'string' && value.length <= max && (!required || value.trim()), 400, '请检查填写内容和长度。');
      return value.trim();
    }

    function scopedState(account) {
      requireCondition(['owner', 'employee'].includes(account.role), 403, '请先选择身份登录。');
      const owner = account.role === 'owner';
      const tasks = owner ? store.tasks : store.tasks.filter(task => task.assignee === account.employee);
      const allowed = new Set(tasks.map(task => task.member_id));
      const notes = owner ? store.notes : store.notes.filter(note => allowed.has(note.member_id));
      const noteEdits = owner ? store.noteEdits : Object.fromEntries(Object.entries(store.noteEdits).filter(([id]) =>
        allowed.has(snapshotNotes.get(id)?.member_id) || notes.some(note => note.note_id === id)));
      return {
        tasks, notes, noteEdits, images: store.images, revision: store.revision,
        workDate: today(), calendarDate: calendarTime().slice(0, 10),
        memberUpdates: owner ? store.memberUpdates : Object.fromEntries(Object.entries(store.memberUpdates).filter(([id]) => allowed.has(id))),
        logs: owner ? store.logs : [],
        care_records: owner ? store.care_records : [],
        accounts: owner ? store.accounts.filter(account => account.role === 'employee').map(({ employee, username }) => ({ employee, username })) : [],
      };
    }

    // These five fields are derived exclusively from recorded task results.
    // Rebuild them after a correction so an old appointment/pause does not linger.
    function rebuildMemberUpdates(next, memberId) {
      const update = { ...next.memberUpdates[memberId] };
      for (const key of ['last_contact_date', 'contact_recorded_on', 'appointment', 'consent', 'care_paused']) delete update[key];
      const memberTasks = next.tasks.filter(task => task.member_id === memberId);
      const results = memberTasks.filter(task => task.status === 'recorded' && task.result).map(task => task.result);
      // Updating a later pause/appointment cannot undo a contact that already happened.
      const contacts = memberTasks.flatMap(task => task.result_history?.length ? task.result_history : task.result ? [task.result] : []);
      const latestContact = contacts.filter(result => result.contacted).map(result => result.recorded_on).sort().at(-1);
      if (latestContact) Object.assign(update, { last_contact_date: latestContact, contact_recorded_on: latestContact });
      if (results.some(teamAppointmentPending)) update.appointment = true;
      if (results.some(result => result.outcome === '不再营销')) update.consent = false;
      if (results.some(result => result.outcome === '暂不联系')) update.care_paused = true;
      next.memberUpdates[memberId] = update;
    }

    function resultPlan(body, previous) {
      const now = calendarTime();
      const date = now.slice(0, 10);
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

    function checkContact(next, id, objective, productId, workDate, newAssignment) {
      const m = members.get(id);
      const update = next.memberUpdates[id] || {};
      const product = products.get(productId);
      const recent = update.contact_recorded_on
        ? daysBetween(workDate, update.contact_recorded_on) < 14
        : m.last_contact_date && daysBetween(snapshot.as_of_date, m.last_contact_date) < 14;
      const reasons = [
        !(update.consent ?? m.marketing_consent) && '未获得营销授权',
        m.unresolved_complaint && '有未解决投诉',
        recent && '14 天内已联系',
        (update.appointment ?? m.has_upcoming_appointment) && '已有未来预约',
        update.care_paused && '已标记暂不联系',
        m.data_completeness < .8 && '档案完整度不足',
      ].filter(Boolean);
      if (objective === 'care') {
        if (!careProfiles.get(id)?.care_followup_opt_in) reasons.push('未同意护理跟进');
        if (newAssignment && !teamCareFollowupDue(recentNails.get(id), calendarTime().slice(0, 10)))
            reasons.push(`仅在最近一次美甲服务后第 ${TEAM_CARE_FOLLOWUP_DAY} 天进入护理回访推荐`);
      }
      if (objective === 'preview') {
        const untilLaunch = daysBetween(product?.launch_date, workDate);
        if (m.lifecycle !== 'active' || product?.product_type !== 'nail_style' || !(untilLaunch >= 1 && untilLaunch <= 14)
          || !m.preferred_styles.split('|').includes(product.style)) reasons.push('不符合新品预告条件');
      }
      return reasons;
    }

    function applyAction(account, body) {
      const action = body.action;
      requireCondition(account.role === (action === 'result' ? 'employee' : 'owner'), 403, '当前账号没有这项操作权限。');
      const next = structuredClone(store);
      const date = today();
      let taskIds = [];
      switch (action) {
        case 'employeeAccount': {
          const known = staff();
          let employee = body.employee;
          if (employee) requireCondition(known.includes(employee), 400, '请选择员工。');
          else {
            employee = field(body.newEmployee, 30, true);
            requireCondition(!/[\p{Cc}\p{Zl}\p{Zp}]/u.test(employee), 400, '请输入有效的员工姓名。');
            requireCondition(!known.includes(employee), 409, '这位员工已存在，请在列表中选择。');
          }
          const username = field(body.username, 32, true).toLowerCase();
          requireCondition(/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username), 400, '请填写 3–32 位的演示账号。');
          requireCondition(!next.accounts.some(account => account.username === username && account.employee !== employee), 409, '这个账号名已被使用。');
          next.accounts = next.accounts.filter(account => account.employee !== employee);
          next.accounts.push({ employee, username, role: 'employee' });
          break;
        }
        case 'deleteEmployeeAccount': {
          const employee = body.employee;
          const removed = next.accounts.find(item => item.role === 'employee' && item.employee === employee);
          requireCondition(removed?.username && removed.username === body.username, 409, '该员工账号已变更，请刷新后重试。');
          const pending = next.tasks.filter(task => task.assignee === employee && teamTaskNeedsHandoff(task));
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
              task.history.push(`老板娘删除 ${employee} 的账号，未完成任务${handoff} · ${calendarTime().slice(0, 10)}`);
              taskIds.push(task.task_id);
            }
          }
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
            const reasons = checkContact(next, input.member_id, input.objective, productId, date, true);
            if (next.care_records.some(record => record.member_id === input.member_id && record.recorded_as_of === date)) reasons.push('今天已有沟通记录');
            requireCondition(!reasons.length, 409, `暂不可分派：${reasons.join('、')}。`);
            const id = 'T' + String(next.tasks.length + 1).padStart(4, '0');
            next.tasks.push({ task_id: id, member_id: input.member_id, objective: input.objective, strategy: objectives.get(input.objective),
              assignee: input.assignee, product_id: productId, assigned_on: date, note: field(input.note, 180), reason: field(input.reason, 1200),
              message: field(input.message, 1600, true), status: 'assigned', result: null, history: [`老板娘分派给 ${input.assignee} · ${date}`], data_type: 'simulation' });
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
          }
          break;
        }
        case 'result': {
          const task = next.tasks.find(task => task.task_id === body.id && task.assignee === account.employee);
          requireCondition(task, 404, '没有找到你的这项任务。');
          requireCondition(['assigned', 'recorded'].includes(task.status), 409, '当前任务不可修改反馈。');
          const previous = task.result;
          const revision = task.result_revision || 0;
          requireCondition((body.expectedRevision ?? 0) === revision, 409, '反馈已更新，请刷新任务后再修改。');
          requireCondition(outcomes.includes(body.outcome), 400, '请选择沟通结果。');
          // Editing a record is not a new outbound contact: its own cooldown,
          // appointment or pause must not prevent a later reply being recorded.
          if (!previous) {
            const reasons = checkContact(next, task.member_id, task.objective, task.product_id, date);
            requireCondition(!reasons.length || body.outcome === '暂不联系', 409, '当前有联系限制，请选择「暂不联系」。');
          }
          const note = field(body.note, 500);
          const contacted = body.outcome !== '暂不联系';
          const message = field(body.message, 1600) || task.message;
          const plan = resultPlan(body, previous);
          const oldStatus = previous?.appointment_status || (previous?.booked ? 'scheduled' : '');
          const samePlan = (previous?.follow_up_on || '') === plan.follow_up_on
            && (previous?.follow_up_note || '') === plan.follow_up_note
            && (previous?.appointment_at || '') === plan.appointment_at && oldStatus === plan.appointment_status;
          if (previous && previous.outcome === body.outcome && previous.note === note && task.message === message && samePlan)
            return { state: scopedState(account), taskIds: [] };
          task.result_history ||= previous ? [{ ...previous, revision, message: task.message }] : [];
          task.message = message;
          task.status = 'recorded';
          task.result_revision = revision + 1;
          task.result = { outcome: body.outcome, note, contacted, booked: body.outcome === '已预约',
            ...plan, recorded_on: previous?.recorded_on || date, updated_at: new Date().toISOString(), recorded_by: account.employee };
          task.result_history.push({ ...task.result, revision: task.result_revision, message });
          task.history.push(`${account.employee} ${previous ? `将「${previous.outcome}」更新为` : '记录'}「${body.outcome}」 · ${date} · 第 ${task.result_revision} 次保存`);
          const record = { task_id: task.task_id, member_id: task.member_id, outcome: body.outcome, note, owner: account.employee, recorded_as_of: task.result.recorded_on, data_type: 'simulation' };
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
          const changes = { is_pinned: Boolean(body.pinned), updated_at: new Date().toISOString() };
          if (body.text !== undefined) {
            requireCondition(noteTypes.includes(body.type), 400, '请选择备注类型。');
            Object.assign(changes, { note_text: field(body.text, 1200, true), note_type: body.type });
          }
          if (previous) next.noteEdits[previous.note_id] = { ...next.noteEdits[previous.note_id], ...changes };
          else {
            requireCondition(changes.note_text, 400, '请填写备注。');
            next.notes.push({ ...changes, note_id: 'NOTE-' + (crypto.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2)), member_id: body.memberId, author_name: '店主', author_role: 'owner', created_at: changes.updated_at });
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
      commit(next);
      return { state: scopedState(account), taskIds };
    }

    return { roster, scopedState, applyAction, listAccounts: () => store.accounts.map(({ employee, username }) => ({ employee, username })), exportState: () => structuredClone(store) };
  }

if (typeof module !== 'undefined') module.exports = { createTeamStore, teamCalendarTime, teamTodoReasons, teamAppointmentPending, teamTaskNeedsHandoff };

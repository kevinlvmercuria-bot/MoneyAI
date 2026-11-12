'use strict';

// app 提供共享状态的实时访问和跨页面操作；本模块保留自己的事件与局部状态。
(globalThis.NailMateApp ||= {}).createState = function (app) {
  function indexSnapshot(data) {
    app.DATA=data;
    app.baseMembers=data.members.map(m=>({...m,name:m.display_name,cycle:m.average_cycle_days,
      spending:m.total_spending,balance:m.stored_balance,preference:m.preferred_styles.replaceAll('|',' / ')||'偏好待补',
      consent:m.marketing_consent,complaint:m.unresolved_complaint,appointment:m.has_upcoming_appointment}));
    app.memberNoteIndex=app.bucketMemberRows(data.member_notes);
    app.scheduledAppointments=teamLatestScheduledAppointments(data.appointments);
    app.memberOrderIndex=app.bucketMemberRows(data.orders);
    app.servicesByMember=app.bucketMemberRows(data.orders.filter(order=>order.order_type==='nail_service'));
    app.memberCareIndex=new Map(data.member_care_profiles.map(row=>[row.member_id,row]));
    app.memberProductIndex=new Map(data.products.map(row=>[row.product_id,row]));
  }
  indexSnapshot(app.DATA);
  function emptyState(){return {members:[],tasks:[],notes:[],noteEdits:{},images:{},memberUpdates:{},accounts:[],logs:[],care_records:[],workDate:app.AS_OF,revision:0};}
  let state=emptyState();
  function applyState(shared,snapshot){
    if(app.serverMode&&(shared.revision<state.revision
      || (shared.revision===state.revision&&shared.calendarDate<state.calendarDate)))return false;
    if(snapshot)indexSnapshot(snapshot);
    // Older account servers supply simulation rows without the snapshot marker
    // in the employee response. The server still validates all assignments.
    app.recentNailVisits=teamLatestCompletedNails({...app.DATA,data_type:app.DATA.data_type??'simulation'},shared.calendarDate);
    app.pendingCare=new Map((shared.careReminders||[])
      .filter(row=>row.status==='pending'&&teamCarePhase(app.daysBetween(shared.calendarDate,row.completed_on)))
      .map(row=>[row.member_id,row]));
    const ids=new Set(shared.tasks.map(task=>task.member_id));
    const visibleMembers=app.USER.role==='employee'?app.baseMembers.filter(m=>ids.has(m.member_id)):app.baseMembers;
    app.WORK_DATE=shared.workDate;
    const members=visibleMembers.map(base=>{
      const m={...base,...shared.memberUpdates[base.member_id]};
      Object.assign(m,teamMemberRecency(m,app.WORK_DATE));
      m.recent=teamHasRecentContact(app.WORK_DATE,m.last_contact_date);
      m.appointment=Boolean(shared.memberUpdates[base.member_id]?.appointment
        || (app.scheduledAppointments.get(m.member_id)||'')>=app.WORK_DATE);
      return m;
    });
    state={...shared,members};
    if(app.USER.role==='owner')app.sharedAccounts=shared.accounts;
    app.STAFF.splice(0,app.STAFF.length,...shared.accounts.map(account=>account.employee).sort((a,b)=>a.localeCompare(b,'zh-CN')));
    return true;
  }
  if(app.serverMode) {
    if(app.initial)applyState(app.initial.state);
  } else {
    app.sharedAccounts=app.preview.listAccounts();
    if(app.USER.role!=='guest')applyState(app.previewState(app.USER),app.preview.workspaceSnapshot());
  }

  return {
    emptyState,
    get state() { return state; },
    set state(value) { state = value; },
    applyState,
  };
};

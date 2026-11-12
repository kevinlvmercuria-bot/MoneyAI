'use strict';
(async () => {
  const serverMode = document.documentElement.dataset.persistence === 'server';
  const { fetchJson, requestState } = NailMateApp.createApi(() => identityHeader);
  const sessionKey='nailmate-demo-identity-v1';
  const authInfo=serverMode?await fetchJson('/api/team/auth/session'):null;
  let savedIdentity;
  if(!serverMode) {
    try { savedIdentity=JSON.parse(sessionStorage.getItem(sessionKey)); } catch {}
    if(!['owner','employee'].includes(savedIdentity?.role) || typeof savedIdentity.employee!=='string')savedIdentity=null;
  }
  const USER=(serverMode?authInfo.user:savedIdentity)||{role:'guest',employee:''};
  const identityHeader=serverMode&&USER.username?{'X-NailMate-User':USER.username}:{};
  let identityRevision=0;
  let pendingWrites=0;
  let sharedAccounts=[];
  const initial=serverMode&&USER.role!=='guest'?await requestState('bootstrap'):null;
  let DATA=serverMode?initial?.snapshot||{as_of_date:'',members:[],orders:[],products:[],member_notes:[],member_care_profiles:[]}
    :JSON.parse(document.getElementById('nailmate-data').textContent);
  const PRODUCT_IMAGES=serverMode?(initial?await fetchJson('/team-product-images.json'):{}):JSON.parse(document.getElementById('nailmate-product-images').textContent);
  const preview=serverMode?null:createTeamStore(DATA,{persistence:NailMatePersistence.createPreviewPersistence(DATA.snapshot_id,localStorage)});
  function previewState(account){
    preview.refreshCareReminders();
    return preview.scopedState(account);
  }
  const PREVIEW_ROLE=document.getElementById('preview-role');
  const STAFF=[];
  const employeePages=['campaigns','products','studio'];
  const homePage=()=>USER.role==='owner'?'dashboard':'campaigns';
  function allowedPage(page){return USER.role==='owner'||employeePages.includes(page)?page:'campaigns'}
  const AS_OF = DATA.as_of_date;
  let WORK_DATE=AS_OF;
  const daysBetween=teamDaysBetween;
  const LABELS = {active:'活跃',due:'待复购',low_frequency:'低频',dormant:'沉睡',unknown:'待确认'};
  const STATUSES = {assigned:'待联系',recorded:'已记录',archived:'已归档',executed_simulated:'历史模拟记录'};
  const OUTCOMES = ['未回复','有意向','已预约','已沟通','暂不联系','不再营销'];
  let baseMembers,memberNoteIndex,memberOrderIndex,servicesByMember,memberCareIndex,memberProductIndex,scheduledAppointments;
  let recentNailVisits=new Map(),pendingCare=new Map();
  const pages = {};
  // 页面通过同一个上下文读取最新状态，避免刷新后仍持有旧快照。
  const app = {
    get AS_OF() { return AS_OF; },
    get ATELIER_NOTE() { return pages['dashboard'].ATELIER_NOTE; },
    get CARE_SOURCE_LABELS() { return CARE_SOURCE_LABELS; },
    get CATALOG_IDEAS() { return pages['products'].CATALOG_IDEAS; },
    get DATA() { return DATA; },
    set DATA(value) { DATA = value; },
    get LABELS() { return LABELS; },
    get MEMBER_PAGE_SIZE() { return MEMBER_PAGE_SIZE; },
    get NOTE_LABELS() { return NOTE_LABELS; },
    get OUTCOMES() { return OUTCOMES; },
    get PREVIEW_ROLE() { return PREVIEW_ROLE; },
    get PRODUCT_IMAGES() { return PRODUCT_IMAGES; },
    get STAFF() { return STAFF; },
    get STATUSES() { return STATUSES; },
    get USER() { return USER; },
    get WB_OBJECTIVES() { return pages['studio'].WB_OBJECTIVES; },
    get WORK_DATE() { return WORK_DATE; },
    set WORK_DATE(value) { WORK_DATE = value; },
    get activeTask() { return pages['dashboard'].activeTask; },
    get apiAction() { return apiAction; },
    get applyState() { return pages['state'].applyState; },
    get appointmentLabel() { return pages['tasks'].appointmentLabel; },
    get appointmentTime() { return pages['tasks'].appointmentTime; },
    get assignableStaff() { return assignableStaff; },
    get authInfo() { return authInfo; },
    get baseMembers() { return baseMembers; },
    set baseMembers(value) { baseMembers = value; },
    get bucketMemberRows() { return bucketMemberRows; },
    get buildWorkbenchMessage() { return pages['studio'].buildWorkbenchMessage; },
    get careActionLabel() { return careActionLabel; },
    get careFollowupVisit() { return careFollowupVisit; },
    get careReady() { return careReady; },
    get careRecords() { return careRecords; },
    get catalogPhoto() { return pages['products'].catalogPhoto; },
    get catalogPhotoLabel() { return pages['products'].catalogPhotoLabel; },
    get catalogReference() { return pages['products'].catalogReference; },
    get catalogSwatch() { return pages['products'].catalogSwatch; },
    get content() { return content; },
    get daysBetween() { return daysBetween; },
    get employeeOptions() { return employeeOptions; },
    get emptyState() { return pages['state'].emptyState; },
    get entryDialog() { return pages['members'].entryDialog; },
    get escape() { return escape; },
    get focusDispatch() { return pages['dashboard'].focusDispatch; },
    get homePage() { return homePage; },
    get identityHeader() { return identityHeader; },
    get identityRevision() { return identityRevision; },
    set identityRevision(value) { identityRevision = value; },
    get initial() { return initial; },
    get isNoProductObjective() { return pages['dashboard'].isNoProductObjective; },
    get matchingPreviews() { return pages['dashboard'].matchingPreviews; },
    get member() { return member; },
    get memberBlockers() { return memberBlockers; },
    get memberCareIndex() { return memberCareIndex; },
    set memberCareIndex(value) { memberCareIndex = value; },
    get memberCode() { return memberCode; },
    get memberNoteIndex() { return memberNoteIndex; },
    set memberNoteIndex(value) { memberNoteIndex = value; },
    get memberOrderIndex() { return memberOrderIndex; },
    set memberOrderIndex(value) { memberOrderIndex = value; },
    get memberProductIndex() { return memberProductIndex; },
    set memberProductIndex(value) { memberProductIndex = value; },
    get money() { return money; },
    get notify() { return notify; },
    get offerLabel() { return pages['dashboard'].offerLabel; },
    get offerProduct() { return pages['dashboard'].offerProduct; },
    get openWorkbench() { return pages['studio'].openWorkbench; },
    get opportunityAction() { return pages['dashboard'].opportunityAction; },
    get opportunityEvidence() { return pages['dashboard'].opportunityEvidence; },
    get options() { return options; },
    get pendingCare() { return pendingCare; },
    set pendingCare(value) { pendingCare = value; },
    get preview() { return preview; },
    get previewState() { return previewState; },
    get profileCheck() { return profileCheck; },
    get profileMoney() { return profileMoney; },
    get profileNoteItem() { return pages['members'].profileNoteItem; },
    get profileNotes() { return profileNotes; },
    get profileProductChoices() { return pages['members'].profileProductChoices; },
    get profileState() { return profileState; },
    get recentNailVisits() { return recentNailVisits; },
    set recentNailVisits(value) { recentNailVisits = value; },
    get reducedMotion() { return pages['effects'].reducedMotion; },
    get render() { return render; },
    get scheduledAppointments() { return scheduledAppointments; },
    set scheduledAppointments(value) { scheduledAppointments = value; },
    get selectProfile() { return selectProfile; },
    get serverMode() { return serverMode; },
    get servicesByMember() { return servicesByMember; },
    set servicesByMember(value) { servicesByMember = value; },
    get sessionKey() { return sessionKey; },
    get setupCareRow() { return pages['effects'].setupCareRow; },
    get setupChoiceFields() { return pages['effects'].setupChoiceFields; },
    get setupGlass() { return pages['effects'].setupGlass; },
    get setupGlassControls() { return pages['effects'].setupGlassControls; },
    get sharedAccounts() { return sharedAccounts; },
    set sharedAccounts(value) { sharedAccounts = value; },
    get showPage() { return showPage; },
    get stagePick() { return pages['dashboard'].stagePick; },
    get state() { return pages['state'].state; },
    set state(value) { pages['state'].state = value; },
    get storeProductPhoto() { return pages['members'].storeProductPhoto; },
    get suggestedEmployee() { return suggestedEmployee; },
    get summaryCards() { return pages['dashboard'].summaryCards; },
    get table() { return table; },
    get taskContactBlockers() { return pages['dashboard'].taskContactBlockers; },
    get taskOwners() { return taskOwners; },
    get taskStatus() { return taskStatus; },
    get taskSummary() { return pages['dashboard'].taskSummary; },
    get todoReasons() { return pages['tasks'].todoReasons; },
    get ui() { return ui; },
    get visibleTasks() { return visibleTasks; },
    get workbenchCarePhase() { return workbenchCarePhase; },
    get workbenchDrafts() { return pages['studio'].workbenchDrafts; },
    get workbenchPhoto() { return pages['studio'].workbenchPhoto; },
    get workbenchProducts() { return pages['studio'].workbenchProducts; },
  };

  pages['state'] = NailMateApp.createState(app);

  const pageNames=['dashboard','members','campaigns','reports','products','studio','accounts'];
  const requestedPage=serverMode?new URLSearchParams(location.search).get('view'):null;
  const ui={memberPage:1,memberFilter:'all',editNote:null,noteDrafts:{},employeeNoteDrafts:{},composer:null,
    page:allowedPage(pageNames.includes(requestedPage)?requestedPage:homePage()),
    limit:3,picks:new Map(),bulkEmployee:'',flips:{},member:'M0001',employee:USER.employee,task:null,
    taskFilter:USER.employee?'今日待办':'全部',employeeFilter:'',reportStage:'booked',query:'',lifecycle:'全部',tag:'全部',taskDrafts:{}};
  const content = document.getElementById('content');
  const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const money = value => '¥' + Number(value).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
  const profileMoney = value => value==null?'未录入':money(value).replace('.00','');
  const member = id => pages['state'].state.members.find(m => m.member_id === id);
  const memberCode = m => m.member_number||m.member_id;
  const memberCodeForId = id => member(id)?.member_number||id;
  const taskStatus = task => task.withdrawn_at?'已撤回':STATUSES[task.status];
  function notify(message, error=false) {
    const node = document.getElementById('notice');
    node.textContent = message; node.hidden = false; node.className = error ? 'error' : '';
    if(error) node.scrollIntoView({block:'nearest'});
  }
  async function apiAction(action,payload){
    if(USER.role==='guest')throw new Error('请先选择身份登录。');
    pendingWrites++;
    try {
      const result=serverMode ? await requestState(action,{...payload,catalogRevision:pages['state'].state.catalogRevision}) : preview.applyAction(USER,{action,...payload});
      const snapshot=serverMode?result.snapshot:result.state.catalogRevision!==pages['state'].state.catalogRevision?preview.workspaceSnapshot():undefined;
      pages['state'].applyState(result.state,snapshot);
      return result;
    } finally { pendingWrites--; }
  }
  function visibleTasks() {
    return ui.employee ? pages['state'].state.tasks.filter(t=>t.assignee===ui.employee) : pages['state'].state.tasks;
  }
  function updateChrome() {
    if(!serverMode) {
      document.getElementById('preview-identity-switch').hidden=false;
      PREVIEW_ROLE.innerHTML='<option value="">老板娘</option>'+sharedAccounts.map(account=>`<option value="${escape(account.employee)}">员工 · ${escape(account.employee)}</option>`).join('');
      PREVIEW_ROLE.value=ui.employee;
    }
    document.getElementById('preview-accounts').hidden=Boolean(ui.employee);
    document.getElementById('account-menu').hidden=false;
    document.getElementById('signed-out-label').hidden=true;
    document.getElementById('account-name').textContent=ui.employee || '老板娘';
    document.querySelector('.atelier-dock').hidden=false;
    document.querySelector('footer').hidden=false;
    const meta = {
      dashboard:['01','今日联系计划','挑出今天值得联系的顾客，把任务交给合适的人。','THE STUDIO'],
      members:['02','会员档案','记得她的偏爱，也关心她的近况。','OUR MEMBERS'],
      campaigns:['03',ui.employee?'我的联系任务':'联系任务',ui.employee?'看清沟通重点，联系后记下顾客反馈。':'查看每项任务的负责人、沟通重点与最新结果。','PERSONAL TOUCH'],
      reports:['04','联系进度','查看分派、回复、预约和到店情况。','STUDIO JOURNAL'],
      products:['05','产品库','把喜欢的款式，收进门店的灵感册。','THE COLLECTION'],
      studio:['06','话术工作台','把了解，变成一段自然的沟通。','PERSONAL NOTES'],
      accounts:['07','员工账号',serverMode?'为员工开通独立账号或重设密码。':'预览员工账号管理页面。','TEAM ACCESS']
    }[ui.page];
    document.getElementById('page-title').textContent = meta[1];
    document.getElementById('page-motto').textContent = meta[2];
    document.getElementById('page-index').textContent = `${meta[0]} / 工作空间`;
    document.getElementById('edition-name').textContent = meta[3];
    document.querySelectorAll('[data-page]').forEach(node => {
      if(node.dataset.page === ui.page) node.setAttribute('aria-current','page'); else node.removeAttribute('aria-current');
    });
    document.querySelectorAll('nav [data-page]').forEach(node=>{node.hidden=Boolean(ui.employee)&&!employeePages.includes(node.dataset.page)});
    const pending = visibleTasks().filter(task => ui.employee ? pages['tasks'].todoReasons(task).length : task.status==='assigned').length;
    const badge=document.getElementById('pending-badge'), taskButton=badge.closest('button');
    const taskLabel=ui.employee?'我的联系任务':'联系任务';
    const taskNavigationLabel=pending?`${taskLabel} · ${pending} 条${ui.employee?'待办':'待联系'}`:taskLabel;
    badge.hidden=!pending;
    taskButton.setAttribute('aria-label',taskNavigationLabel);
    taskButton.querySelector('.dock-tip').textContent=taskNavigationLabel;
    document.getElementById('owner-footer').hidden=Boolean(ui.employee);
    document.getElementById('logs').innerHTML = pages['state'].state.logs.length ? pages['state'].state.logs.map(log => {
      const text=log.replace(/^(已更新顾客档案 )(\S+)(?= · )/,(_,prefix,id)=>prefix+memberCodeForId(id));
      return `<li>${escape(text)}</li>`;
    }).join('') : '<li>暂无操作记录。</li>';
  }
  function table(headers, rows) {
    return `<div class="table-wrap"><table><thead><tr>${headers.map(h => `<th scope="col">${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  }
  function options(values, selected) { return values.map(v => `<option ${v === selected ? 'selected' : ''}>${escape(v)}</option>`).join(''); }
  function careRecords() {
    const records = pages['state'].state.care_records || [];
    const hasHistoricalDates = records.some(record=>record.follow_up);
    const headers = ['会员','处理结果','反馈 / 原因','负责人'];
    if(hasHistoricalDates)headers.push('历史计划日期');
    return `<details ${records.length ? 'open' : ''}><summary>关怀记录 · ${records.length} 条</summary>${records.length ? table(headers, records.map(r => `<tr><td>${escape(memberCodeForId(r.member_id))}</td><td>${escape(r.outcome)}</td><td class="wrap">${escape(r.note)}</td><td>${escape(r.owner)}</td>${hasHistoricalDates?`<td>${escape(r.follow_up || '—')}</td>`:''}</tr>`)) : '<p class="helper">还没有关怀记录。</p>'}<p class="helper">重置演示数据会清空本地记录。</p></details>`;
  }
  // Membership uses the reviewed CSV snapshot; edits stay in this browser.
  const NOTE_LABELS={preference:'款式偏好',communication:'沟通习惯',service:'服务细节',care:'护理需求',appointment:'预约习惯'};
  const MEMBER_PAGE_SIZE=8;
  const CARE_SOURCE_LABELS={owner_note:'店主备注',customer_report:'顾客反馈',service_history:'历史服务记录'};
  function suggestedEmployee(m){
    const candidates=assignableStaff();
    let latest;
    for(const order of servicesByMember.get(m.member_id)||[]){
      if(candidates.includes(order.technician)&&(!latest||order.order_date>latest.order_date))latest=order;
    }
    return latest?.technician || (candidates.includes(m.preferred_technician)?m.preferred_technician:'');
  }
  function assignableStaff() {
    return serverMode?pages['state'].state.accounts.filter(account=>account.loginEnabled).map(account=>account.employee):STAFF;
  }
  function taskOwners(tasks=pages['state'].state.tasks) {
    return [...new Set([...STAFF,...tasks.map(task=>task.assignee).filter(Boolean)])].sort((a,b)=>a.localeCompare(b,'zh-CN'));
  }
  function employeeOptions(value,placeholder,forAssignment=false) {
    return `<option value="">${placeholder}</option>`+options(forAssignment?assignableStaff():taskOwners(),value);
  }
  function careFollowupVisit(m) {
    const visit=recentNailVisits.get(m.member_id);
    if(!visit)return null;
    const days=daysBetween(pages['state'].state.calendarDate,visit.completed_on);
    return {date:visit.completed_on,days,phase:teamCarePhase(days),
      name:visit.manual_entry?'美甲服务':memberProductIndex.get(visit.product_id)?.product_name||visit.style||'美甲服务'};
  }
  function careReady(m) {
    return Array.isArray(pages['state'].state.careReminders) ? pendingCare.has(m.member_id)
      : Boolean(careFollowupVisit(m)?.phase);
  }
  function careActionLabel(phase){return phase==='removal'?'建议卸甲':phase==='care'?'建议护理':'护理关怀'}
  function workbenchCarePhase(m){
    const task=ui.employee&&pages['dashboard'].activeTask(m.member_id);
    return task?.objective==='care'?task.care_action:careFollowupVisit(m)?.phase;
  }
  function bucketMemberRows(rows){const map=new Map();for(const row of rows){if(!map.has(row.member_id))map.set(row.member_id,[]);map.get(row.member_id).push(row)}return map}
  function profileNotes(id){
    return [...(memberNoteIndex.get(id)||[]),...(pages['state'].state.notes||[]).filter(n=>n.member_id===id)]
      .map(note=>({...note,...(pages['state'].state.noteEdits[note.note_id]||{})}))
      .sort((a,b)=>Number(b.is_pinned)-Number(a.is_pinned)||String(b.updated_at||b.created_at).localeCompare(String(a.updated_at||a.created_at)));
  }
  function profileState(m){return `<span class="member-state ${escape(m.lifecycle)}">${LABELS[m.lifecycle]}</span>`}
  function profileCheck(ok,text){return `<li class="${ok?'':'blocked'}"><svg viewBox="0 0 20 20" aria-hidden="true">${ok?'<path d="m4 10 4 4 8-9"/>':'<path d="m5 5 10 10M15 5 5 15"/>'}</svg><span>${escape(text)}</span></li>`}
  function memberBlockers(m,objective,task){
    const serviceOrderId=task?.care_service_order_id||(!task&&pendingCare.get(m.member_id)?.service_order_id);
    const rows=teamContactBlockers({...m,careOptIn:memberCareIndex.get(m.member_id)?.care_followup_opt_in,
      optedOut:pages['state'].state.memberUpdates[m.member_id]?.consent===false},objective,serviceOrderId);
    if(objective==='care'&&!task&&!careReady(m))rows.push('暂无到期且待分派的护理回访');
    if(objective==='preview'&&!pages['dashboard'].matchingPreviews(m).length)rows.push('需要匹配偏好的活跃会员及 14 天内计划上架的款式');
    return rows;
  }
  function selectProfile(id){if(ui.member!==id){ui.editNote=null;ui.composer=null}ui.member=id}
  pages['members'] = NailMateApp.createMembers(app);

  pages['products'] = NailMateApp.createProducts(app);

  // Ported from the enhanced preview: member context, rules demo, image card and review.
  pages['studio'] = NailMateApp.createStudio(app);

  // A daily operating plan, calculated from the reviewed snapshot; no model or message service.
  pages['dashboard'] = NailMateApp.createDashboard(app);

  pages['tasks'] = NailMateApp.createTasks(app);

  pages['reports'] = NailMateApp.createReports(app);

  content.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    try {
      if(button.hasAttribute('data-replay-team-chart'))replayReportChart();
      if(button.dataset.reportStage){
        ui.reportStage=button.dataset.reportStage;
        content.querySelectorAll('[data-report-stage]').forEach(control=>control.setAttribute('aria-pressed',String(control===button)));
        const details=document.getElementById('report-stage-details');
        details.innerHTML=pages['reports'].reportStageDetails(pages['reports'].reportTasks());
        details.focus({preventScroll:true});
        details.scrollIntoView({block:'nearest'});
      }
      if(button.dataset.taskView){ui.taskFilter=button.dataset.taskView;render();}
      if(button.dataset.withdrawTask){pages['tasks'].openWithdrawTask(visibleTasks().find(task=>task.task_id===button.dataset.withdrawTask));return}
      if(button.dataset.employeeNoteEdit||button.hasAttribute('data-employee-note-cancel')){
        const task=visibleTasks().find(item=>item.task_id===ui.task);
        if(!task)return;
        if(button.dataset.employeeNoteEdit){
          const note=profileNotes(task.member_id).find(item=>item.note_id===button.dataset.employeeNoteEdit&&item.can_edit);
          if(!note)return;
          ui.employeeNoteDrafts[task.task_id]={noteId:note.note_id,text:note.note_text,type:note.note_type,expectedRevision:note.revision||0};
        } else delete ui.employeeNoteDrafts[task.task_id];
        render();
        document.getElementById('employee-note-text')?.focus();
      }
      if(button.dataset.opportunity)pages['dashboard'].selectOpportunity(button);
      if(button.dataset.careQueuePage){pages['dashboard'].careQueuePage=Number(button.dataset.careQueuePage);render();}
      if(button.id==='jump-dispatch')pages['dashboard'].focusDispatch();
      if(button.dataset.pick){
        const id=button.dataset.pick;
        if(ui.picks.has(id))ui.picks.delete(id);
        else {
          const pick=ui.opportunity==='care'&&pendingCare.has(id)?{m:member(id),objective:'care'}
            :pages['dashboard'].careRecommendations().find(({m})=>m.member_id===id);
          if(!pick)throw new Error('会员已不在当前推荐列表。');
          pages['dashboard'].stagePick(pick.m,pick.objective);
        }
        pages['dashboard'].refreshPicks();
      }
      if(button.dataset.removePick){
        ui.picks.delete(button.dataset.removePick);
        pages['dashboard'].refreshPicks();
        document.getElementById('dispatch-queue').focus({preventScroll:true});
      }
      if(button.hasAttribute('data-apply-employee')){
        if(!assignableStaff().includes(ui.bulkEmployee))throw new Error('请先选择批量分派的员工。');
        ui.picks.forEach(pick=>{pick.assignee=ui.bulkEmployee});
        pages['dashboard'].refreshPicks();
        content.querySelector('[data-apply-employee]').focus({preventScroll:true});
      }
      if(button.dataset.taskStudio&&ui.employee){
        const task=visibleTasks().find(task=>task.task_id===button.dataset.taskStudio);
        if(task)pages['studio'].openWorkbench(task.member_id,task.objective);
      }
      if(button.dataset.viewTask&&!ui.employee){
        ui.task=button.dataset.viewTask;
        ui.employeeFilter='';
        ui.taskFilter='全部';
        showPage('campaigns');
      }
      if(button.dataset.staffProgress){
        ui.employeeFilter=button.dataset.staffProgress;
        ui.taskFilter='全部';
        showPage('campaigns');
      }
      if(button.hasAttribute('data-copy-task'))pages['studio'].copyMessage(document.getElementById('task-message')).catch(error=>notify(error.message,true));
    } catch(error){notify(error.message,true)}
  });
  function render() {
    const opportunityScroll=content.querySelector('.opportunity-scroll')?.scrollLeft||0;
    pages['effects'].closeChoicePopover();
    cleanupReportChart();
    pages['effects'].careRowObserver?.disconnect();
    pages['effects'].careRowObserver=null;
    if(USER.role==='guest') { pages['auth'].renderSignedOut(); return; }
    ({dashboard: pages['dashboard'].dashboard,members:pages['members'].membersPage,campaigns:pages['tasks'].campaignsPage,reports:pages['reports'].reportsPage,products:pages['products'].productsPage,studio:pages['studio'].studioPage,accounts:pages['accounts'].accountsPage})[ui.page]();
    if(['studio','campaigns','accounts'].includes(ui.page))pages['wecom'].mount();
    const scroll=content.querySelector('.opportunity-scroll');
    if(scroll)scroll.scrollLeft=opportunityScroll;
    if(ui.page==='reports')mountReportChart();
    pages['effects'].setupChoiceFields(content);
    pages['effects'].setupGlassControls(content);
    updateChrome();
    if(serverMode) {
      const url=new URL(location.href);
      if(ui.page===homePage())url.searchParams.delete('view');
      else url.searchParams.set('view',ui.page);
      if(url.href!==location.href)history.replaceState(null,'',url);
    }
    pages['effects'].animatePageChange();
  }
  pages['task-actions'] = NailMateApp.createTaskActions(app);

  pages['accounts'] = NailMateApp.createAccounts(app);
  pages['wecom'] = NailMateApp.createWecom(app);
  pages['wecom-admin'] = NailMateApp.createWecomAdmin(app,pages['wecom']);
  pages['member-import'] = NailMateApp.createMemberImportUI(app,pages['wecom']);
  pages['kf'] = NailMateApp.createKf(app,pages['wecom']);

  pages['effects'] = NailMateApp.createEffects(app);

  function showPage(page){
    document.getElementById('account-menu').open=false;
    ui.page=allowedPage(pageNames.includes(page)?page:homePage());
    document.getElementById('notice').hidden=true;
    render();
    document.getElementById('main').focus({preventScroll:true});
    window.scrollTo(0,0);
  }
  pages['auth'] = NailMateApp.createAuth(app);

  let synchronizing=false;
  function editingPage() {
    return pages['effects'].openChoice || document.querySelector('dialog[open]')
      || document.activeElement?.matches('input,textarea,select,[contenteditable="true"]')
      || content.querySelector('#employee-account-form[data-dirty]');
  }
  async function refreshShared(force=false) {
    if(USER.role==='guest'||(!force&&(synchronizing||pendingWrites||document.hidden||editingPage())))return;
    if(!serverMode) { pages['state'].applyState(previewState(USER)); render(); return; }
    synchronizing=true;
    try {
      const update=await requestState('state',{catalogRevision:pages['state'].state.catalogRevision,...(!force&&{revision:pages['state'].state.revision,calendarDate:pages['state'].state.calendarDate})});
      if(!update||(!force&&(pendingWrites||editingPage()))||!pages['state'].applyState(update.state,update.snapshot))return;
      if(force) {
        for(const task of pages['state'].state.tasks) {
          const draft=ui.taskDrafts[task.task_id];
          if(draft?.expectedRevision!==undefined&&Number(draft.expectedRevision)!==(task.result_revision||0))
            delete ui.taskDrafts[task.task_id];
          const noteDraft=ui.employeeNoteDrafts[task.task_id];
          if(noteDraft?.noteId&&noteDraft.expectedRevision!==(pages['state'].state.noteEdits[noteDraft.noteId]?.revision||0))
            delete ui.employeeNoteDrafts[task.task_id];
        }
      }
      render();
    } finally { synchronizing=false; }
  }
  content.addEventListener('click',async event=>{
    const button=event.target.closest('[data-refresh-team]');
    if(!button)return;
    button.disabled=true;
    try { await refreshShared(true); notify('任务与备注已刷新。'); }
    catch(error) { notify(error.message,true); }
    finally { if(button.isConnected)button.disabled=false; }
  });
  document.addEventListener('click',event=>{
    const menu=document.getElementById('account-menu');
    if(!menu.contains(event.target))menu.open=false;
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape')document.getElementById('account-menu').open=false;
  });
  document.addEventListener('click', event => {
    const button=event.target.closest('button');if(!button) return;
    try {
      if(pages['effects'].choiceFields.has(button)) {
        pages['effects'].showChoicePopover(button);
      } else if(button.dataset.deleteEmployee&&USER.role==='owner'&&serverMode) {
        pages['accounts'].confirmEmployeeDeletion(button.dataset.deleteEmployee);
      } else if(button.dataset.page) {
        if(button.dataset.page==='campaigns'){ui.employeeFilter='';ui.taskFilter=ui.employee?'今日待办':'全部'}
        showPage(button.dataset.page);
      } else if(button.dataset.flip) pages['effects'].flipCard(button.dataset.flip,true);
      else if(button.dataset.unflip) pages['effects'].flipCard(button.dataset.unflip,false);
      else if(button.dataset.memberDetail) {selectProfile(button.dataset.memberDetail);pages['members'].memberResults();document.getElementById('member-detail').scrollIntoView({block:'start'});}
      else if(button.dataset.task) {ui.task=button.dataset.task;render();}
    } catch(error) {notify(error.message,true);}
  });
  function setOutcomeError(select, show) {
    const picker=document.getElementById('task-outcome-picker');
    select.form.querySelector('#task-outcome-error').hidden=!show;
    for(const field of [select,picker].filter(Boolean)){
      field.setAttribute('aria-invalid',String(show));
      if(show)field.setAttribute('aria-describedby','task-outcome-error');
      else field.removeAttribute('aria-describedby');
    }
    if(show)(picker||select).focus();
  }
  content.addEventListener('invalid',event=>{
    if(event.target.id!=='task-outcome'||!event.target.validity.valueMissing)return;
    event.preventDefault();
    setOutcomeError(event.target,true);
  },true);
  content.addEventListener('change',event => {
    const target=event.target;
    if(target.id==='task-outcome'){
      const form=target.form;
      if(target.value)setOutcomeError(target,false);
      form.querySelector('[data-appointment-fields]').hidden=target.value!=='已预约';
      form.querySelector('[data-follow-up-fields]').hidden=target.value==='不再营销';
    }
    if(target.id==='care-limit') {ui.limit=Number(target.value);pages['dashboard'].careQueuePage=1;render();}
    if(target.id==='member-lifecycle') {ui.lifecycle=target.value;ui.memberPage=1;pages['members'].memberResults();}
    if(target.id==='member-tag') {ui.tag=target.value;ui.memberPage=1;pages['members'].memberResults();}
    if(target.id==='task-filter') {ui.taskFilter=target.value;render();}
    if(target.id==='employee-filter') {ui.employeeFilter=target.value;render();}
    if(target.id==='account-employee'){
      document.getElementById('account-new-name-field').hidden=Boolean(target.value);
      document.getElementById('account-new-name').value='';
      document.getElementById('account-username').value=pages['state'].state.accounts.find(account=>account.employee===target.value)?.username||'';
      const password=document.getElementById('account-password');
      if(password)password.value='';
      target.form.dataset.dirty='true';
    }
    if(target.id==='bulk-employee')ui.bulkEmployee=target.value;
    if(target.dataset.pickEmployee)ui.picks.get(target.dataset.pickEmployee).assignee=target.value;
    rememberDraft(target);
  });
  function rememberDraft(target) {
    const form=target.closest('#task-result-form');
    if(form)ui.taskDrafts[form.dataset.task]=Object.fromEntries(new FormData(form));
    const noteForm=target.closest('#employee-note-form');
    if(noteForm){
      const id=noteForm.dataset.task;
      ui.employeeNoteDrafts[id]={...ui.employeeNoteDrafts[id],...Object.fromEntries(new FormData(noteForm))};
    }
    if(target.dataset.pickNote)ui.picks.get(target.dataset.pickNote).note=target.value;
  }
  content.addEventListener('input',event => {
    if(event.target.id==='member-query') {ui.query=event.target.value;ui.memberPage=1;pages['members'].memberResults();}
    const accountForm=event.target.closest('#employee-account-form');
    if(accountForm)accountForm.dataset.dirty='true';
    rememberDraft(event.target);
  });
  content.addEventListener('submit',async event=>{
    const form=event.target,id=form.dataset.task;
    if(!['dispatch-form','reassign-form','task-result-form','employee-account-form','employee-note-form'].includes(form.id))return;
    event.preventDefault();
    const data=new FormData(form),button=event.submitter;
    if(form.id==='task-result-form'&&!data.get('outcome')){
      setOutcomeError(form.elements.outcome,true);
      return;
    }
    if(button?.disabled)return;
    if(button)button.disabled=true;
    try{
      if(form.id==='dispatch-form')await pages['dashboard'].assignSelected();
      if(form.id==='reassign-form')await pages['task-actions'].reassignTask(id,data);
      if(form.id==='task-result-form')await pages['task-actions'].saveTaskResult(id,data);
      if(form.id==='employee-note-form'){
        const {noteId,expectedRevision}=ui.employeeNoteDrafts[id]||{};
        await apiAction('employeeNote',{taskId:id,noteId,expectedRevision,text:data.get('text'),type:data.get('type')});
        delete ui.employeeNoteDrafts[id];
        render();notify('员工备注已保存。');
      }
      if(form.id==='employee-account-form'){
        await apiAction('employeeAccount',Object.fromEntries(data));
        render();notify('员工账号已保存。');
      }
    }catch(error){notify(error.message,true)}
    finally{if(button?.isConnected)button.disabled=false}
  });
  pages['effects'].setupGlassControls(pages['effects'].dock);
  pages['effects'].setupGlassControls(document.querySelector('footer'));
  render();
  if(!serverMode||USER.role!=='guest') {
    const sync=()=>{
      if(USER.role!=='guest'&&(serverMode||teamBusinessClock().date!==pages['state'].state.calendarDate))refreshShared().catch(()=>{});
    };
    setInterval(sync,5000);
    document.addEventListener('visibilitychange',sync);
    window.addEventListener('pageshow',event=>{if(event.persisted)sync();});
  }
})().catch(error => {
  const notice=document.getElementById('notice');
  notice.hidden=false; notice.className='error'; notice.textContent=error.message;
});

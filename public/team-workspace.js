'use strict';
(async () => {
  const serverMode = document.documentElement.dataset.persistence === 'server';
  const fetchJson = async (url, options) => {
    const response = await fetch(url, options);
    if (!response.ok) throw new Error('演示资料加载失败，请刷新重试。');
    return response.json();
  };
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
  async function requestState(action, payload={}) {
    const response=await fetch('/api/team', {
      method:'POST', headers:{...identityHeader,'Content-Type':'application/json'},
      body:JSON.stringify({ action, ...payload })
    });
    if(response.status===204)return null;
    if(response.status===401) {
      location.reload();
      throw new Error('请重新登录。');
    }
    const result=await response.json();
    if(!response.ok) throw new Error(result.error || '操作未完成，请重试。');
    return result;
  }
  const initial=serverMode&&USER.role!=='guest'?await requestState('bootstrap'):null;
  let DATA=serverMode?initial?.snapshot||{as_of_date:'',members:[],orders:[],products:[],member_notes:[],member_care_profiles:[]}
    :JSON.parse(document.getElementById('nailmate-data').textContent);
  const PRODUCT_IMAGES=serverMode?(initial?await fetchJson('/team-product-images.json'):{}):JSON.parse(document.getElementById('nailmate-product-images').textContent);
  const preview=serverMode?null:createTeamStore(DATA,{storage:localStorage});
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
  const LABELS = {active:'活跃',due:'待复购',low_frequency:'低频',dormant:'沉睡'};
  const STATUSES = {assigned:'待联系',recorded:'已记录',archived:'已归档',executed_simulated:'历史模拟记录'};
  const OUTCOMES = ['未回复','有意向','已预约','已沟通','暂不联系','不再营销'];
  let baseMembers,memberNoteIndex,memberOrderIndex,servicesByMember,memberCareIndex,memberProductIndex,scheduledAppointments;
  let recentNailVisits=new Map(),pendingCare=new Map();
  function indexSnapshot(data) {
    DATA=data;
    baseMembers=data.members.map(m=>({...m,name:m.display_name,cycle:m.average_cycle_days,
      days:m.days_since_last_visit,spending:m.total_spending,balance:m.stored_balance,
      ratio:m.overdue_ratio,preference:m.preferred_styles.replaceAll('|',' / '),
      consent:m.marketing_consent,complaint:m.unresolved_complaint,appointment:m.has_upcoming_appointment}));
    memberNoteIndex=bucketMemberRows(data.member_notes);
    scheduledAppointments=teamLatestScheduledAppointments(data.appointments);
    memberOrderIndex=bucketMemberRows(data.orders);
    servicesByMember=bucketMemberRows(data.orders.filter(order=>order.order_type==='nail_service'));
    memberCareIndex=new Map(data.member_care_profiles.map(row=>[row.member_id,row]));
    memberProductIndex=new Map(data.products.map(row=>[row.product_id,row]));
  }
  indexSnapshot(DATA);
  function emptyState(){return {members:[],tasks:[],notes:[],noteEdits:{},images:{},memberUpdates:{},accounts:[],logs:[],care_records:[],workDate:AS_OF,revision:0};}
  let state=emptyState();
  function applyState(shared,snapshot){
    if(serverMode&&(shared.revision<state.revision
      || (shared.revision===state.revision&&shared.calendarDate<state.calendarDate)))return false;
    if(snapshot)indexSnapshot(snapshot);
    // Older account servers supply simulation rows without the snapshot marker
    // in the employee response. The server still validates all assignments.
    recentNailVisits=teamLatestCompletedNails({...DATA,data_type:DATA.data_type??'simulation'},shared.calendarDate);
    pendingCare=new Map((shared.careReminders||[])
      .filter(row=>row.status==='pending'&&row.due_on<=shared.calendarDate)
      .map(row=>[row.member_id,row]));
    const ids=new Set(shared.tasks.map(task=>task.member_id));
    const visibleMembers=USER.role==='employee'?baseMembers.filter(m=>ids.has(m.member_id)):baseMembers;
    WORK_DATE=shared.workDate;
    const members=visibleMembers.map(base=>{
      const m={...base,...shared.memberUpdates[base.member_id]};
      m.recent=teamHasRecentContact(WORK_DATE,m.last_contact_date);
      m.appointment=Boolean(shared.memberUpdates[base.member_id]?.appointment
        || (scheduledAppointments.get(m.member_id)||'')>=WORK_DATE);
      return m;
    });
    state={...shared,members};
    if(USER.role==='owner')sharedAccounts=shared.accounts;
    STAFF.splice(0,STAFF.length,...shared.accounts.map(account=>account.employee).sort((a,b)=>a.localeCompare(b,'zh-CN')));
    return true;
  }
  if(serverMode) {
    if(initial)applyState(initial.state);
  } else {
    sharedAccounts=preview.listAccounts();
    if(USER.role!=='guest')applyState(previewState(USER));
  }
  const pageNames=['dashboard','members','campaigns','reports','products','studio','accounts'];
  const requestedPage=serverMode?new URLSearchParams(location.search).get('view'):null;
  const ui={memberPage:1,memberFilter:'all',editNote:null,noteDrafts:{},employeeNoteDrafts:{},composer:null,
    page:allowedPage(pageNames.includes(requestedPage)?requestedPage:homePage()),
    limit:3,picks:new Map(),bulkEmployee:'',flips:{},member:'M0001',employee:USER.employee,task:null,
    taskFilter:USER.employee?'今日待办':'全部',employeeFilter:'',reportStage:'booked',query:'',lifecycle:'全部',tag:'全部',taskDrafts:{}};
  const content = document.getElementById('content');
  const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const money = value => '¥' + Number(value).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
  const member = id => state.members.find(m => m.member_id === id);
  const blockers = m => [!m.consent && '未获得营销授权',m.complaint && '有未解决投诉',m.recent && '14 天内已联系',m.appointment && '已有未来预约',m.care_paused && '店主已选择暂不联系'].filter(Boolean);
  function notify(message, error=false) {
    const node = document.getElementById('notice');
    node.textContent = message; node.hidden = false; node.className = error ? 'error' : '';
    if(error) node.scrollIntoView({block:'nearest'});
  }
  async function apiAction(action,payload){
    if(USER.role==='guest')throw new Error('请先选择身份登录。');
    pendingWrites++;
    try {
      const result=serverMode ? await requestState(action,payload) : preview.applyAction(USER,{action,...payload});
      applyState(result.state,result.snapshot);
      return result;
    } finally { pendingWrites--; }
  }
  function visibleTasks() {
    return ui.employee ? state.tasks.filter(t=>t.assignee===ui.employee) : state.tasks;
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
    const pending = visibleTasks().filter(task => ui.employee ? todoReasons(task).length : task.status==='assigned').length;
    const badge=document.getElementById('pending-badge'), taskButton=badge.closest('button');
    const taskLabel=ui.employee?'我的联系任务':'联系任务';
    const taskNavigationLabel=pending?`${taskLabel} · ${pending} 条${ui.employee?'待办':'待联系'}`:taskLabel;
    badge.hidden=!pending;
    taskButton.setAttribute('aria-label',taskNavigationLabel);
    taskButton.querySelector('.dock-tip').textContent=taskNavigationLabel;
    document.getElementById('owner-footer').hidden=Boolean(ui.employee);
    document.getElementById('logs').innerHTML = state.logs.length ? state.logs.map(log => `<li>${escape(log)}</li>`).join('') : '<li>暂无操作记录。</li>';
  }
  function table(headers, rows) {
    return `<div class="table-wrap"><table><thead><tr>${headers.map(h => `<th scope="col">${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  }
  function options(values, selected) { return values.map(v => `<option ${v === selected ? 'selected' : ''}>${escape(v)}</option>`).join(''); }
  function careRecords() {
    const records = state.care_records || [];
    const hasHistoricalDates = records.some(record=>record.follow_up);
    const headers = ['会员','处理结果','反馈 / 原因','负责人'];
    if(hasHistoricalDates)headers.push('历史计划日期');
    return `<details ${records.length ? 'open' : ''}><summary>关怀记录 · ${records.length} 条</summary>${records.length ? table(headers, records.map(r => `<tr><td>${escape(r.member_id)}</td><td>${escape(r.outcome)}</td><td class="wrap">${escape(r.note)}</td><td>${escape(r.owner)}</td>${hasHistoricalDates?`<td>${escape(r.follow_up || '—')}</td>`:''}</tr>`)) : '<p class="helper">还没有关怀记录。</p>'}<p class="helper">重置演示数据会清空本地记录。</p></details>`;
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
    return serverMode?state.accounts.filter(account=>account.loginEnabled).map(account=>account.employee):STAFF;
  }
  function taskOwners(tasks=state.tasks) {
    return [...new Set([...STAFF,...tasks.map(task=>task.assignee).filter(Boolean)])].sort((a,b)=>a.localeCompare(b,'zh-CN'));
  }
  function employeeOptions(value,placeholder,forAssignment=false) {
    return `<option value="">${placeholder}</option>`+options(forAssignment?assignableStaff():taskOwners(),value);
  }
  function careFollowupVisit(m) {
    const visit=recentNailVisits.get(m.member_id);
    if(!visit)return null;
    return {date:visit.completed_on,days:daysBetween(state.calendarDate,visit.completed_on),
      name:memberProductIndex.get(visit.product_id)?.product_name||visit.style||'美甲服务'};
  }
  function careReady(m) {
    return Array.isArray(state.careReminders) ? pendingCare.has(m.member_id)
      : teamCareFollowupDate(recentNailVisits.get(m.member_id)?.completed_on)===state.calendarDate;
  }
  function bucketMemberRows(rows){const map=new Map();for(const row of rows){if(!map.has(row.member_id))map.set(row.member_id,[]);map.get(row.member_id).push(row)}return map}
  function profileNotes(id){
    return [...(memberNoteIndex.get(id)||[]),...(state.notes||[]).filter(n=>n.member_id===id)]
      .map(note=>({...note,...(state.noteEdits[note.note_id]||{})}))
      .sort((a,b)=>Number(b.is_pinned)-Number(a.is_pinned)||String(b.updated_at||b.created_at).localeCompare(String(a.updated_at||a.created_at)));
  }
  function profileState(m){return `<span class="member-state ${escape(m.lifecycle)}">${LABELS[m.lifecycle]}</span>`}
  function profileCheck(ok,text){return `<li class="${ok?'':'blocked'}"><svg viewBox="0 0 20 20" aria-hidden="true">${ok?'<path d="m4 10 4 4 8-9"/>':'<path d="m5 5 10 10M15 5 5 15"/>'}</svg><span>${escape(text)}</span></li>`}
  function memberBlockers(m,objective,assigned=false){
    const rows=blockers(m);
    if(m.data_completeness<.8)rows.push('档案完整度不足');
    if(objective==='care'){
      if(!memberCareIndex.get(m.member_id)?.care_followup_opt_in)rows.push('未同意护理跟进');
      if(!assigned&&!careReady(m))rows.push('暂无到期且待分派的护理回访');
    }
    if(objective==='preview'&&!matchingPreviews(m).length)rows.push('需要匹配偏好的活跃会员及 14 天内计划上架的款式');
    return rows;
  }
  function selectProfile(id){if(ui.member!==id){ui.editNote=null;ui.composer=null}ui.member=id}
  function filteredMembers(){
    const query=ui.query.trim().toLowerCase();
    return state.members.filter(m=>{
      const notes=profileNotes(m.member_id);
      if(query&&!(m.member_id+m.name+m.preference+m.care_need_tags+notes.map(n=>n.note_text).join(' ')).toLowerCase().includes(query))return false;
      if(ui.lifecycle!=='全部'&&LABELS[m.lifecycle]!==ui.lifecycle)return false;
      if(ui.tag==='可联系'&&memberBlockers(m).length||ui.tag==='有余额'&&m.balance<=0||ui.tag==='高价值'&&m.spending<2000)return false;
      return ui.memberFilter==='all'||ui.memberFilter==='dormant'&&m.lifecycle==='dormant'||ui.memberFilter==='due'&&m.lifecycle==='due'||ui.memberFilter==='notes'&&notes.length>0||ui.memberFilter==='care'&&Boolean(m.care_need_tags);
    });
  }
  function membersPage(){
    content.innerHTML=`<div class="member-index"><aside class="member-directory" aria-label="会员查找与列表">
      <label class="member-search-label" for="member-query">查找会员</label><input id="member-query" type="search" value="${escape(ui.query)}" placeholder="搜索全名、编号、款式或备注" autocomplete="off">
      <div class="member-filter-row"><div><label for="member-lifecycle">生命周期</label><select id="member-lifecycle">${options(['全部',...Object.values(LABELS)],ui.lifecycle)}</select></div><div><label for="member-tag">附加筛选</label><select id="member-tag">${options(['全部','可联系','有余额','高价值'],ui.tag)}</select></div></div>
      <div class="member-tabs" aria-label="会员快捷筛选">${[['all','全部'],['dormant','沉睡'],['due','待复购'],['notes','有备注'],['care','有护理需求']].map(([value,label])=>`<button data-member-filter="${value}" aria-pressed="${ui.memberFilter===value}">${label}</button>`).join('')}</div><div id="member-results"></div>
      </aside><div id="member-detail" tabindex="-1" aria-label="当前会员完整档案"></div></div>`;
    memberResults();
  }
  function memberResults(){
    const rows=filteredMembers(),pages=Math.max(1,Math.ceil(rows.length/MEMBER_PAGE_SIZE));
    ui.memberPage=Math.max(1,Math.min(ui.memberPage,pages));
    const pageRows=rows.slice((ui.memberPage-1)*MEMBER_PAGE_SIZE,ui.memberPage*MEMBER_PAGE_SIZE);
    if(!rows.some(m=>m.member_id===ui.member))selectProfile(pageRows[0]?.member_id||null);
    document.getElementById('member-results').innerHTML=`<p class="member-found" role="status">找到 ${rows.length.toLocaleString('zh-CN')} 位 · 共 ${state.members.length.toLocaleString('zh-CN')} 位会员</p>
      ${pageRows.length?`<div class="member-directory-list">${pageRows.map(m=>`<button class="member-row" data-member-detail="${m.member_id}" aria-pressed="${m.member_id===ui.member}" aria-label="打开 ${escape(m.name)} ${m.member_id} 的档案"><span class="member-avatar" aria-hidden="true">${escape(m.name[0])}</span><span class="member-row-info"><span class="member-row-title"><strong>${escape(m.name)}</strong>${profileState(m)}</span><small>${m.member_id} · ${escape(m.preference)}<br>${profileNotes(m.member_id).length} 条备注</small></span><span class="member-row-days">${m.days} 天<small>未到店</small></span></button>`).join('')}</div>
      <div class="member-pagination"><button data-member-page="${ui.memberPage-1}" ${ui.memberPage<=1?'disabled':''}>上一页</button><span>${ui.memberPage} / ${pages}</span><button data-member-page="${ui.memberPage+1}" ${ui.memberPage>=pages?'disabled':''}>下一页</button></div>`:'<div class="empty">没有找到符合条件的会员。<p><button data-member-clear>清空筛选</button></p></div>'}`;
    document.querySelectorAll('[data-member-filter]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.memberFilter===ui.memberFilter)));
    const detail=document.getElementById('member-detail');
    detail.innerHTML=ui.member?completeProfile(member(ui.member)):'<div class="profile-empty">调整左侧条件后，即可查看会员档案。</div>';
    setupChoiceFields(detail);
    setupGlassControls(detail);
  }
  function completeProfile(m){
    const care=memberCareIndex.get(m.member_id),notes=profileNotes(m.member_id),restrictions=memberBlockers(m);
    const assigned=activeTask(m.member_id);
    const careSource=CARE_SOURCE_LABELS[care.care_need_source]||'待确认';
    const scale=Math.max(m.cycle*3.6,m.days+10),averagePosition=Math.max(12,Math.min(82,m.cycle/scale*100));
    const confidence={high:'高置信度',medium:'中等置信度',low:'历史记录较少'}[m.cycle_confidence]||'参考周期';
    return `<article class="member-sheet"><header class="profile-topline"><div class="profile-identity"><span class="member-avatar" aria-hidden="true">${escape(m.name[0])}</span><div><div class="profile-name"><h2>${escape(m.name)}</h2>${profileState(m)}</div><p class="profile-subtitle">${m.member_id} · ${escape(m.membership_level)} · 档案完整度 ${Math.round(m.data_completeness*100)}%</p></div></div><button class="member-text-button" data-member-history="${m.member_id}">查看消费记录</button></header>
      <div class="profile-metrics"><div><span>最近到店</span><strong>${m.days} 天前</strong></div><div><span>累计消费</span><strong>${money(m.spending).replace('.00','')}</strong></div><div><span>储值余额</span><strong>${money(m.balance).replace('.00','')}</strong></div><div><span>历史消费</span><strong>${m.visit_count} 次</strong></div></div>
      <section class="profile-section"><div class="profile-section-head"><h3>个人复购周期</h3><span class="member-state active">${confidence}</span></div><div class="cycle-labels"><span>最近到店 ${escape(m.last_visit)}</span><b>今天 · ${m.days} 天</b></div><div class="personal-cycle" style="--cycle:${averagePosition}%" role="img" aria-label="个人平均周期 ${m.cycle} 天，距最近到店 ${m.days} 天，为平均周期的 ${m.ratio} 倍"><div class="personal-cycle-fill" style="width:${Math.min(100,m.days/scale*100)}%"></div><span class="personal-cycle-marker" data-label="平均 ${m.cycle} 天"></span></div><p>当前为个人平均复购周期的 <b>${m.ratio} 倍</b>，状态为“${LABELS[m.lifecycle]}”。${m.visit_count<2?'历史到店间隔不足，先使用参考周期。':'根据历史到店间隔计算，备注不直接改变周期判定。'}</p></section>
      <section class="profile-section profile-duo"><div><h3>偏好与权益</h3><dl class="profile-preferences"><dt>偏好款式</dt><dd>${escape(m.preference)}</dd><dt>偏好技师</dt><dd>${escape(m.preferred_technician||'暂无记录')}</dd><dt>储值权益</dt><dd>余额 ${money(m.balance).replace('.00','')}，不作为新增营收计算</dd><dt>加入会员</dt><dd>${escape(m.created_date)}</dd></dl></div><div><h3>营销资格检查</h3><ul class="profile-checks">${profileCheck(m.consent,m.consent?'已获得营销授权':'未获得营销授权')}${profileCheck(!m.recent,m.recent?'14 天内已有联系':'14 天内无触达')}${profileCheck(!m.complaint,m.complaint?'有未解决投诉':'无未解决投诉')}${profileCheck(!m.appointment,m.appointment?'已有未来预约':'无未来预约')}${m.care_paused?profileCheck(false,'店主已选择暂不联系'):''}</ul></div></section>
      <section class="profile-section"><div class="profile-section-head"><h3>客户备注</h3><small>${notes.length} 条 · 门店内可见</small></div>${notes.length?notes.map(note=>profileNoteItem(note,'owner')).join(''):'<p class="profile-empty">还没有备注，可以记下她喜欢的款式和沟通习惯。</p>'}${noteEditor(m.member_id)}</section>
      <section class="profile-section"><div class="profile-section-head"><h3>护理需求</h3><button class="member-text-button" data-member-compose="care">准备护理沟通</button></div>${m.care_need_tags?`<div class="profile-care-tags">${m.care_need_tags.split('|').map(tag=>`<span>${escape(tag)}</span>`).join('')}</div><p>建议服务：${escape(m.preferred_care_service||'到店后确认')}<br>需求来源：${escape(careSource)} · 美甲后回访日 ${escape(teamCareFollowupDate(recentNailVisits.get(m.member_id)?.completed_on)||'待确认')}</p>`:'<p class="profile-empty">暂无明确护理需求，先询问本人意愿，再推荐合适服务。</p>'}<p class="muted">${escape(care.care_guidance)} ${care.care_followup_opt_in?'已同意护理跟进。':'尚未同意护理跟进，当前只能预览沟通草稿。'}</p></section>
      ${assigned?`<p class="profile-qualification">已有待联系任务 · 负责人 ${escape(assigned.assignee)} <button data-view-task="${assigned.task_id}">查看任务</button></p>`:''}
      ${restrictions.length?`<p class="profile-qualification">当前联系限制：${escape(restrictions.join('、'))}。可准备草稿，暂不可创建触达任务。</p>`:''}<div class="profile-actions"><button data-member-history="${m.member_id}">完整消费记录</button><button class="primary" data-member-compose="repurchase">根据档案准备话术</button></div></article>`;
  }
  function profileNoteItem(note,controls){
    const employee=note.author_role==='employee';
    const author=employee?`员工 · ${note.author_name}`:note.author_name||'老板娘';
    const stamp=String(note.updated_at||note.created_at||'');
    const date=stamp.endsWith('Z')&&Number.isFinite(Date.parse(stamp))?teamBusinessClock(new Date(stamp)).date:stamp.slice(0,10);
    const pin=controls==='owner'?`<button type="button" class="member-text-button" data-note-pin="${escape(note.note_id)}" aria-pressed="${Boolean(note.is_pinned)}">${note.is_pinned?'取消置顶':'置顶'}</button>`:'';
    const edit=controls==='owner'&&!employee?`<button type="button" class="member-text-button" data-note-edit="${escape(note.note_id)}">编辑</button>`
      :controls==='employee'&&note.can_edit?`<button type="button" class="member-text-button" data-employee-note-edit="${escape(note.note_id)}">编辑</button>`:'';
    return `<article class="profile-note"><div class="profile-note-meta"><span>${note.is_pinned?'<b class="note-pinned">置顶 · </b>':''}${escape(NOTE_LABELS[note.note_type]||note.note_type)} · ${escape(author)}${date?' · '+escape(date):''}</span>${pin}${edit}</div><p>${escape(note.note_text)}</p></article>`;
  }
  function noteEditor(id){
    const editing=ui.editNote&&profileNotes(id).find(n=>n.note_id===ui.editNote);
    const draft=ui.noteDrafts[id]||(editing?{text:editing.note_text,type:editing.note_type,pinned:editing.is_pinned}:{text:'',type:'preference',pinned:false});
    return `<form class="profile-note-form" id="member-note-form" data-member="${id}"><label for="member-note-text">${editing?'编辑这条备注':'补充一条备注'}</label><textarea id="member-note-text" name="text" maxlength="1200" required placeholder="例如：喜欢短方圆甲，通勤时偏好低饱和色。">${escape(draft.text)}</textarea><div class="profile-note-toolbar"><select name="type" aria-label="备注类型">${Object.entries(NOTE_LABELS).map(([value,label])=>`<option value="${value}" ${draft.type===value?'selected':''}>${label}</option>`).join('')}</select><label><input type="checkbox" name="pinned" ${draft.pinned?'checked':''}>置顶</label>${editing?'<button type="button" data-note-cancel>取消编辑</button>':''}<button class="primary" type="submit">${editing?'保存修改':'保存备注'}</button></div><p class="helper">仅供店内参考，不会直接发给顾客，也不会写回原数据库。</p></form>`;
  }
  async function saveProfileNote(form){
    const id=form.dataset.member,values=new FormData(form),noteId=ui.editNote;
    await apiAction('note',{memberId:id,noteId,text:String(values.get('text')||''),type:values.get('type'),pinned:values.has('pinned')});
    ui.editNote=null;delete ui.noteDrafts[id];render();notify('备注已保存。');
  }
  function showMemberOrders(id){
    const m=member(id),orders=[...(memberOrderIndex.get(id)||[])].sort((a,b)=>b.order_date.localeCompare(a.order_date));
    document.getElementById('member-orders-dialog')?.remove();
    const dialog=document.createElement('dialog');dialog.id='member-orders-dialog';dialog.className='member-dialog';dialog.setAttribute('aria-labelledby','member-orders-title');
    const types={care:'护理消费',nail_service:'美甲服务',care_service:'护理服务',care_product:'护理产品',service:'到店服务',recharge:'储值充值'};
    dialog.innerHTML=`<header><h2 id="member-orders-title">${escape(m.name)} · 消费记录</h2><form method="dialog"><button>关闭</button></form></header><p>${id} · 共 ${orders.length} 条来自模拟数据库的记录 · 累计 ${money(m.spending)}</p>${orders.length?table(['日期','产品 / 服务','类型','金额','技师'],orders.map(order=>`<tr><td>${escape(order.order_date)}</td><td class="wrap">${escape(memberProductIndex.get(order.product_id)?.product_name||order.product_id)}</td><td>${escape(types[order.order_type]||order.order_type)}</td><td>${money(order.amount)}</td><td>${escape(order.technician)}</td></tr>`)):'<div class="empty">这位会员暂时没有消费记录。</div>'}<p>数据为已确认的模拟快照；储值余额展示可用权益。</p>`;
    document.body.append(dialog);dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close()}});dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();
  }
  function profileProductChoices(m,objective){
    const care=objective==='care',notes=profileNotes(m.member_id).map(n=>n.note_text).join(' ');
    const score=p=>(m.preferred_styles.split('|').includes(p.style)?5:0)+(p.is_new?2:0)+(/裸色|低饱和/.test(notes)&&/奶油|裸色|浅/.test(p.product_name)?4:0)+(p.product_name===m.preferred_care_service?8:0);
    return DATA.products.filter(p=>p.is_active&&(care?p.product_type!=='nail_style':p.product_type==='nail_style')).sort((a,b)=>score(b)-score(a)||a.product_id.localeCompare(b.product_id));
  }
  function openProfileComposer(objective){openWorkbench(ui.member,objective)}
  async function storeProductPhoto(file,productId){
    if(!file)return;if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('请选择 PNG、JPG 或 WebP 格式的产品图。');
    if(file.size>10*1024*1024)throw new Error('图片请小于 10 MB。');
    const source=URL.createObjectURL(file);
    try{const image=new Image();image.src=source;await image.decode();const ratio=Math.min(1,1000/Math.max(image.width,image.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*ratio));canvas.height=Math.max(1,Math.round(image.height*ratio));const ctx=canvas.getContext('2d');ctx.fillStyle='#fffcf9';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);await apiAction('photo',{productId,image:canvas.toDataURL('image/jpeg',.82)})}
    finally{URL.revokeObjectURL(source)}
  }
  content.addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button)return;
    try{
      if(button.dataset.openProfile){ui.page='members';ui.query='';ui.lifecycle='全部';ui.tag='全部';ui.memberFilter='all';ui.memberPage=Math.floor(state.members.findIndex(m=>m.member_id===button.dataset.openProfile)/MEMBER_PAGE_SIZE)+1;selectProfile(button.dataset.openProfile);render();document.getElementById('member-detail').scrollIntoView({block:'start'});return}
      if(button.hasAttribute('data-member-clear')){ui.query='';ui.lifecycle='全部';ui.tag='全部';ui.memberFilter='all';ui.memberPage=1;render();return}
      if(button.dataset.memberPage){ui.memberPage=Number(button.dataset.memberPage);selectProfile(null);memberResults();return}
      if(button.dataset.memberFilter){ui.memberFilter=button.dataset.memberFilter;ui.memberPage=1;memberResults();return}
      if(button.dataset.memberHistory){showMemberOrders(button.dataset.memberHistory);return}
      if(button.dataset.noteEdit){ui.editNote=button.dataset.noteEdit;delete ui.noteDrafts[ui.member];memberResults();document.getElementById('member-note-text').focus({preventScroll:true});return}
      if(button.hasAttribute('data-note-cancel')){ui.editNote=null;delete ui.noteDrafts[ui.member];memberResults();return}
      if(button.dataset.notePin){const note=profileNotes(ui.member).find(n=>n.note_id===button.dataset.notePin);await apiAction('note',{memberId:ui.member,noteId:note.note_id,pinned:!note.is_pinned});render();notify(note.is_pinned?'已取消置顶。':'备注已置顶。');return}
      if(button.dataset.memberCompose){openProfileComposer(button.dataset.memberCompose);return}
    }catch(error){notify(error.message||'操作未完成，请重新尝试。',true)}
  });
  function rememberProfileDraft(target){
    const form=target.closest('#member-note-form');if(form){const values=new FormData(form);ui.noteDrafts[form.dataset.member]={text:String(values.get('text')||''),type:String(values.get('type')),pinned:values.has('pinned')}}
  }
  content.addEventListener('input',event=>rememberProfileDraft(event.target));
  content.addEventListener('change',event=>rememberProfileDraft(event.target));
  content.addEventListener('submit',event=>{if(event.target.id!=='member-note-form')return;event.preventDefault();saveProfileNote(event.target).catch(error=>notify(error.message,true))});

  // The library includes existing products plus an explicitly unlisted style idea.
  const CATALOG_TYPES={nail_style:'美甲款式',care_product:'护理产品',care_service:'护理服务'};
  const CATALOG_IDEAS=[{product_id:'IDEA-SEA-SALT',product_name:'海盐冰气泡',product_type:'nail_style',style:'清透灵感',description:'清透海盐蓝底色，搭配细小气泡与冰透光泽。',image_plan:'清透海盐蓝 · 气泡点缀 · 短椭圆甲',planned:true,launch_date:'2026-11-14',preview_styles:['裸色']}];
  const CATALOG_PAGE_SIZE=8;
  Object.assign(ui,{catalogFilter:'all',catalogQuery:'',catalogPage:1,catalogPending:false,catalogUpload:null});
  function catalogEntries(){return [...CATALOG_IDEAS,...DATA.products.filter(p=>p.is_active)]}
  function catalogCustomPhoto(p){const photo=state.images[p.product_id];return typeof photo==='string'&&/^data:image\/(png|jpeg|webp);base64,/.test(photo)?photo:null}
  function catalogPhoto(p){return catalogCustomPhoto(p)||PRODUCT_IMAGES[p.product_id]?.src||null}
  function catalogDefaultImage(p){return catalogCustomPhoto(p)?null:PRODUCT_IMAGES[p.product_id]||null}
  function catalogReference(p){const image=catalogDefaultImage(p);return image?.source_url?image:null}
  function catalogSwatch(p){return catalogDefaultImage(p)?.kind==='generated_nail_swatch'}
  function catalogPhotoLabel(p){return catalogSwatch(p)?'AI 甲片示意图':catalogReference(p)?'网络参考图':'店主上传实拍图'}
  function catalogPhotoCredit(p){const reference=catalogReference(p);return reference?`<a class="catalog-photo-credit" href="${escape(reference.source_url)}" target="_blank" rel="noopener noreferrer">参考图来源 · ${escape(new URL(reference.source_url).hostname.replace(/^www\./,''))}</a>`:''}
  function catalogImagePlan(p){
    if(p.image_plan)return p.image_plan;
    if(p.product_type==='care_product')return '瓶身主图 · 滴管细节 · 素色背景，清晰展示标签';
    if(p.product_type==='care_service')return '手部护理过程 · 工具或操作细节 · 干净的工作台';
    return p.description.replace(/[。！？]+$/,'');
  }
  function catalogFiltered(){const query=ui.catalogQuery.trim().toLowerCase();return catalogEntries().filter(p=>(ui.catalogFilter==='all'||p.product_type===ui.catalogFilter)&&(!ui.catalogPending||!catalogPhoto(p))&&(!query||(p.product_name+p.product_id+p.style+p.description+(p.suitable_care_tags||'')).toLowerCase().includes(query)))}
  function productsPage(){
    const entries=catalogEntries(),categories=[['all','全部'],...Object.entries(CATALOG_TYPES)];
    content.innerHTML=`<section aria-label="门店产品图片库"><div class="catalog-heading"><div><h2>让每一款，都有一张好看的图。</h2><p>美甲款式用白底五枚甲片展示颜色和工艺。护理项目附参考图，图片可替换成门店实拍。</p></div><div class="catalog-heading-actions"><div class="catalog-swatch-strip" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>${ui.employee?'<button data-page="studio">打开话术工作台</button>':'<button data-page="members">回到会员档案</button>'}</div></div><div class="catalog-tools"><div class="catalog-tabs" aria-label="产品分类">${categories.map(([value,label])=>`<button data-catalog-filter="${value}" aria-pressed="${ui.catalogFilter===value}">${label}<span>${value==='all'?entries.length:entries.filter(p=>p.product_type===value).length}</span></button>`).join('')}</div><div class="catalog-search"><label for="catalog-search">查找产品或款式</label><input type="search" id="catalog-search" value="${escape(ui.catalogQuery)}" placeholder="例如：海盐、法式、护理油" autocomplete="off"></div></div><div class="catalog-status"><p id="catalog-count" role="status"></p><label><input type="checkbox" id="catalog-pending" ${ui.catalogPending?'checked':''}>只看无图项目</label></div><div id="catalog-results"></div><p class="catalog-footnote">美甲甲片图为 AI 生成的款式示意图，成品颜色与工艺以门店实作为准。护理项目的网络参考图可查看来源。<br>「海盐冰气泡」为未上架灵感。示意图和参考图随 HTML 内嵌；老板娘上传的实拍图会在产品库和话术预览中优先显示。</p><input class="catalog-file" type="file" id="catalog-upload" accept="image/png,image/jpeg,image/webp" aria-label="上传所选产品图片"></section>`;
    catalogResults();
  }
  function catalogResults(){
    const rows=catalogFiltered(),pages=Math.max(1,Math.ceil(rows.length/CATALOG_PAGE_SIZE));ui.catalogPage=Math.max(1,Math.min(ui.catalogPage,pages));
    document.getElementById('catalog-count').textContent=`找到 ${rows.length} 项 · ${DATA.products.filter(p=>p.is_active).length} 项门店产品 + ${CATALOG_IDEAS.length} 款待确认灵感`;
    document.querySelectorAll('[data-catalog-filter]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.catalogFilter===ui.catalogFilter)));
    const results=document.getElementById('catalog-results');
    results.innerHTML=rows.length?`<div class="catalog-grid">${rows.slice((ui.catalogPage-1)*CATALOG_PAGE_SIZE,ui.catalogPage*CATALOG_PAGE_SIZE).map(catalogProductCard).join('')}</div><div class="catalog-pagination"><button data-catalog-page="${ui.catalogPage-1}" ${ui.catalogPage<=1?'disabled':''}>上一页</button><span>${ui.catalogPage} / ${pages}</span><button data-catalog-page="${ui.catalogPage+1}" ${ui.catalogPage>=pages?'disabled':''}>下一页</button></div>`:'<div class="empty">没有找到符合条件的产品。<p><button data-catalog-clear>清空筛选</button></p></div>';
    setupGlass(results);
  }
  function catalogProductCard(p){
    const photo=catalogPhoto(p),reference=catalogReference(p),swatch=catalogSwatch(p),custom=Boolean(catalogCustomPhoto(p)),kind=p.planned?'待确认灵感':CATALOG_TYPES[p.product_type];
    return `<div class="glass-track"><article class="catalog-product glass-tilt glass-surface" data-product-id="${p.product_id}"><div class="catalog-image ${p.product_type==='nail_style'?'catalog-image-nail':'catalog-image-care'}${swatch?' catalog-image-swatch':''}"><span class="catalog-image-kind">${kind}</span>${photo?`<img src="${escape(photo)}" alt="${escape(p.product_name)}的${catalogPhotoLabel(p)}">`:`<div class="catalog-placeholder"><strong>${escape(p.product_name)}</strong><span>${escape(catalogImagePlan(p))}</span><small>4:5 主图 · 预留实拍位置</small></div>`}${reference?'<span class="catalog-image-reference">网络参考图</span>':''}</div><div class="catalog-product-body"><div class="catalog-product-title"><h3>${escape(p.product_name)}</h3>${p.planned?'':`<span class="catalog-product-price">${money(p.price).replace('.00','')}</span>`}</div><p class="catalog-product-description">${escape(p.description)}</p><p class="catalog-product-meta">${p.planned?`暂未上架 · ${escape(offerLabel(p))}`:escape(p.product_id+' · '+p.style+(p.service_duration_minutes?' · 约 '+p.service_duration_minutes+' 分钟':''))}</p>${catalogPhotoCredit(p)}<div class="catalog-product-footer"><span class="catalog-image-state ${custom?'uploaded':''}">${custom?'已上传实拍':swatch?'AI 甲片示意图 · 可替换':photo?'参考图 · 可替换':'等待补充图片'}</span>${ui.employee?'':`<button data-catalog-upload="${p.product_id}" aria-label="${photo?'更换':'上传'}${escape(p.product_name)}的产品图">${photo?'更换图片':'上传图片'}</button>`}</div></div></article></div>`;
  }
  content.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.dataset.catalogFilter){ui.catalogFilter=button.dataset.catalogFilter;ui.catalogPage=1;catalogResults()}
    if(button.dataset.catalogPage){ui.catalogPage=Number(button.dataset.catalogPage);catalogResults();document.getElementById('catalog-results').scrollIntoView({block:'start'})}
    if(button.hasAttribute('data-catalog-clear')){ui.catalogFilter='all';ui.catalogQuery='';ui.catalogPending=false;ui.catalogPage=1;productsPage()}
    if(!ui.employee&&button.dataset.catalogUpload){ui.catalogUpload=button.dataset.catalogUpload;const input=document.getElementById('catalog-upload');input.value='';input.click()}
  });
  content.addEventListener('input',event=>{if(event.target.id==='catalog-search'){ui.catalogQuery=event.target.value;ui.catalogPage=1;catalogResults()}});
  content.addEventListener('change',async event=>{
    if(event.target.id==='catalog-pending'){ui.catalogPending=event.target.checked;ui.catalogPage=1;catalogResults()}
    if(event.target.id==='catalog-upload'&&event.target.files[0]){
      const productId=ui.catalogUpload;if(!catalogEntries().some(p=>p.product_id===productId))return;
      try{await storeProductPhoto(event.target.files[0],productId);if(ui.page==='products')catalogResults();notify('图片已补入产品库，同款产品预览也会使用这张图。')}
      catch(error){notify(error.message||'图片无法读取，请换一张有效图片。',true)}
    }
  });

  // Ported from the enhanced preview: member context, rules demo, image card and review.
  const WB_OBJECTIVES={repurchase:'复购邀请',balance:'储值关怀',new_product:'新品推荐',care:'护理关怀',preview:'新品预告',greeting:'日常问候'};
  const workbenchDrafts={};
  ui.workbench={member_id:ui.employee?null:'M0001',objective:'repurchase',tone:'friendly',product_id:'',draft:'',loadedKey:null,revision:0};
  function workbenchProducts(m,objective){
    if(isNoProductObjective(objective))return [];
    if(objective==='preview')return matchingPreviews(m);
    let products=profileProductChoices(m,objective);
    const notes=profileNotes(m.member_id).map(n=>n.note_text).join(' '),care=memberCareIndex.get(m.member_id);
    if(objective==='new_product')products=products.filter(p=>p.is_new);
    if(objective==='care')products=products.map(p=>({p,score:(p.product_name===care.preferred_care_service?40:0)+(care.care_need_tags||'').split('|').filter(tag=>tag&&p.suitable_care_tags.includes(tag)).length*30})).sort((a,b)=>b.score-a.score).map(x=>x.p);
    if(/不喜欢黑色/.test(notes))products=products.filter(p=>!p.product_name.includes('黑'));
    return products;
  }
  function workbenchKey(){const w=ui.workbench;return [w.member_id,w.objective,w.tone,w.product_id].join(':')}
  function ensureWorkbench(){
    const w=ui.workbench;
    if(!member(w.member_id)){
      const task=ui.employee&&visibleTasks().find(t=>t.status==='assigned');
      setWorkbenchMember(task?.member_id||state.members[0]?.member_id,task?.objective||'repurchase');
    }
    const m=member(w.member_id);
    if(!m)throw new Error('收到联系任务后，即可为负责的顾客准备话术。');
    const products=workbenchProducts(m,w.objective);
    if(!products.some(p=>p.product_id===w.product_id))w.product_id=products[0]?.product_id||'';
    const key=workbenchKey();
    if(key!==w.loadedKey){
      const task=ui.employee&&visibleTasks().findLast(t=>t.member_id===m.member_id&&t.objective===w.objective&&t.product_id===(w.product_id||null));
      w.draft=workbenchDrafts[key]??(task?(ui.taskDrafts[task.task_id]?.message??task.message):'');
      w.loadedKey=key;
    }
    const assigned=activeTask(m.member_id)?.objective===w.objective;
    return {m,products,p:offerProduct(w.product_id),reasons:memberBlockers(m,w.objective,assigned)};
  }
  function saveWorkbenchDraft(){
    const w=ui.workbench;
    if(w.loadedKey)workbenchDrafts[w.loadedKey]=w.draft;
  }
  function setWorkbenchMember(id,objective){
    const task=ui.employee&&visibleTasks().findLast(t=>t.member_id===id&&(t.status==='assigned'||t.status==='recorded'));
    const purpose=objective||task?.objective||'repurchase';
    Object.assign(ui.workbench,{member_id:id,objective:purpose,product_id:task?.product_id||'',loadedKey:null});
  }
  function openWorkbench(id,objective){
    if(!member(id))throw new Error('当前账号无法查看该会员。');
    saveWorkbenchDraft();
    setWorkbenchMember(id,objective);
    showPage('studio');
  }
  function workbenchPhoto(p){const photo=catalogPhoto(p);return `<div class="wb-product-photo${catalogSwatch(p)?' swatch-photo':''}">${photo?`<img src="${escape(photo)}" alt="${escape(p.product_name)}的${catalogPhotoLabel(p)}">`:'<span>产品实拍<br>待补充</span>'}</div>`}
  function studioPage(){
    if(!state.members.length){
      content.innerHTML='<div class="empty atelier-empty"><p>收到联系任务后，就可以在这里为自己负责的顾客准备话术。</p><p><button data-page="campaigns">查看我的联系任务</button></p></div>';
      return;
    }
    const {m,products,p,reasons}=ensureWorkbench(),w=ui.workbench,notes=profileNotes(m.member_id);
    const careMode=w.objective==='care',visit=careMode?careFollowupVisit(m):null,noProduct=isNoProductObjective(w.objective),needsOffer=!noProduct&&!p;
    const relationship=w.objective==='preview'||noProduct,assigned=activeTask(m.member_id);
    const contextFact=w.objective==='preview'?['预告款式',p?offerLabel(p):'暂无匹配款式']:['上次联系',m.last_contact_date||'暂无记录'];
    content.innerHTML=`<div class="wb-heading"><div><h2>把了解，变成一段自然的沟通。</h2><p>${ui.employee?'参考客户备注和产品信息，为自己负责的顾客准备话术。':'先看会员档案与客户备注，再准备参考话术，加入分派清单。'}</p></div><button data-page="products">打开产品与图片库</button></div>
      <div class="wb-layout"><aside class="wb-context"><h3>这次，为谁准备？</h3><div class="wb-field"><label for="studio-member">选择会员</label><select id="studio-member">${state.members.map(person=>`<option value="${person.member_id}" ${person.member_id===m.member_id?'selected':''}>${person.member_id} · ${escape(person.name)} · ${LABELS[person.lifecycle]}</option>`).join('')}</select></div>
      <div class="wb-member"><span class="member-avatar" aria-hidden="true">${escape(m.name[0])}</span><div><h3>${escape(m.name)}</h3><p>${m.member_id} · ${escape(m.membership_level)} · ${LABELS[m.lifecycle]}</p></div></div>
      <dl class="wb-facts">${careMode?(visit?`<div><dt>最近美甲</dt><dd><strong>${visit.days} 天前</strong><small>${escape(visit.date)}</small></dd></div><div><dt>美甲项目</dt><dd>${escape(visit.name)}</dd></div>`:'<div><dt>近期美甲</dt><dd>暂无美甲服务记录</dd></div>'):relationship?`<div><dt>${contextFact[0]}</dt><dd>${escape(contextFact[1])}</dd></div>`:`<div><dt>未到店</dt><dd><strong>${m.days} 天</strong><small>最近到店 ${escape(m.last_visit)}</small></dd></div><div><dt>个人周期</dt><dd><strong>${m.cycle} 天</strong> · 当前 ${m.ratio} 倍</dd></div>`}<div><dt>偏好风格</dt><dd>${escape(m.preference)}</dd></div><div><dt>护理需求</dt><dd>${escape((m.care_need_tags||'待本人确认').replaceAll('|',' / '))}</dd></div></dl>
      <section class="wb-note-section"><h3>客户备注</h3>${notes.length?`<ul class="wb-notes">${notes.map(note=>`<li><small>${note.is_pinned?'置顶 · ':''}${escape(NOTE_LABELS[note.note_type]||'备注')} · ${escape(note.author_name||'老板娘')}</small>${escape(note.note_text)}</li>`).join('')}</ul>`:'<p class="helper">暂时没有备注，可以先到会员档案补充。</p>'}${ui.employee?'':`<button data-open-profile="${m.member_id}">查看或补充会员备注</button>`}</section>
      <details class="wb-preparation" open><summary>沟通准备 · 先了解，再推荐</summary><h4>为什么值得关注</h4><p>${careMode||noProduct||w.objective==='preview'?escape(opportunityEvidence(m,w.objective,p)):`当前为个人复购周期的 <b>${m.ratio} 倍</b>，状态为“${LABELS[m.lifecycle]}”。历史偏好与客户备注是沟通参考。`}</p><h4>待本人确认</h4><p>${noProduct?'听听顾客近况，确认是否需要协助，以及什么时候方便再联系。':w.objective==='preview'?'确认是否想看这款的配色或效果。':careMode?'这次佩戴是否舒服，甲面和甲缘状态如何，是否需要护理建议。':'近期是否仍有美甲或护理需求、上次体验如何、希望怎样被联系；未到店原因需听本人表达。'}</p><h4>这次的小目标</h4><p>${noProduct||w.objective==='preview'?escape(opportunityAction(m,w.objective,p)):w.objective==='care'?'先询问甲周、甲面及日常护理需求，确认意愿后再介绍合适服务。':'了解一条顾客明确表达的需求，或确认她喜欢的款式和方便沟通的方式。'}</p></details>
      </aside><section class="wb-output"><header class="wb-output-header"><div><h3>沟通草稿</h3><p>给 ${escape(m.name)} · ${WB_OBJECTIVES[w.objective]}</p></div><span class="pill">规则演示 · 未调用模型</span></header>
      <div class="wb-control-grid"><div class="wb-field"><label for="objective">这次想聊什么？</label><select id="objective">${Object.entries(WB_OBJECTIVES).map(([value,label])=>`<option value="${value}" ${w.objective===value?'selected':''}>${label}</option>`).join('')}</select></div><div class="wb-field"><label for="tone">表达方式</label><select id="tone"><option value="friendly" ${w.tone==='friendly'?'selected':''}>自然亲切</option><option value="brief" ${w.tone==='brief'?'selected':''}>简洁直接</option></select></div></div>
      ${noProduct?`<p class="wb-action-note"><b>本次行动</b> · ${escape(opportunityAction(m,w.objective,p))}</p>`:`<div class="wb-field"><label for="studio-product">${w.objective==='preview'?'本次预告的款式':'本次推荐的产品 / 服务'}</label><select id="studio-product">${products.map(product=>`<option value="${product.product_id}" ${p&&product.product_id===p.product_id?'selected':''}>${escape(product.product_name)} · ${escape(offerLabel(product))}</option>`).join('')}</select></div>`}
      ${p?`<div class="wb-product">${workbenchPhoto(p)}<div><h4>${escape(p.product_name)}</h4><p>${escape(p.description)}</p><div class="wb-price">${escape(offerLabel(p))}</div>${catalogSwatch(p)?'<p class="helper">AI 甲片示意图 · 款式参考</p>':catalogReference(p)?'<p class="helper">网络参考图 · 可在产品库查看来源</p>':''}${ui.employee?'':`<button data-wb-upload="${p.product_id}">${catalogPhoto(p)?'更换产品图':'上传产品实拍'}</button>`}</div></div>`:noProduct?'':`<p class="empty">${w.objective==='preview'?'暂无符合条件的预告款式。':'暂时没有匹配的在售产品，请先到产品库补充。'}</p>`}
      <div class="wb-generate-row"><p>参考 ${notes.length} 条客户备注${noProduct?'与联系记录':'与款式或服务信息'}</p><button class="primary" data-wb-generate ${reasons.length||needsOffer?'disabled':''}>生成演示话术</button></div>
      ${reasons.length?`<div class="wb-restrictions">暂不适合主动联系：${escape(reasons.join('；'))}。当前仅供内部参考。</div>`:''}
      <div class="wb-draft-label"><label for="message-draft">话术内容 · 可以直接修改</label><small id="wb-draft-count">${w.draft.length} / 1600</small></div><textarea id="message-draft" maxlength="1600" placeholder="点击“生成演示话术”，或直接写下你想说的话。">${escape(w.draft)}</textarea>
      <div class="wb-customer-preview"><h4>顾客沟通预览</h4><p>这里只展示顾客会看到的内容，内部备注和经营数据留在店内。</p><div class="wb-chat-message" id="chat-message">${escape(w.draft||'话术准备好后，会在这里显示顾客看到的消息。')}</div>${p?`<div class="wb-chat-product">${workbenchPhoto(p)}<div><strong>${escape(p.product_name)}</strong><p>${escape(offerLabel(p))}</p></div></div>`:''}</div>
      ${assigned?`<p class="wb-action-note">已有待联系任务 · 负责人 ${escape(assigned.assignee)} <button data-view-task="${assigned.task_id}">查看任务</button></p>`:''}
      <div class="wb-actions"><button data-wb-copy ${!w.draft.trim()||ui.employee&&reasons.length?'disabled':''}>复制话术</button><button data-wb-download ${!w.draft.trim()||!p||ui.employee&&reasons.length?'disabled':''}>下载图文卡片</button>${ui.employee?`<button class="primary" data-wb-use ${!assigned||!w.draft.trim()||reasons.length?'disabled':''}>将话术带回任务</button>`:`<button class="primary" data-wb-submit ${assigned||reasons.length||needsOffer?'disabled':''}>加入分派清单</button>`}</div><p class="wb-note">${ui.employee?'话术可复制或带回任务，保存联系结果时会一并保存。':'可以先准备话术，也可以直接加入分派清单。'}</p>
      </section></div>${ui.employee?'':careRecords()}<input class="wb-file" id="wb-image-upload" type="file" accept="image/png,image/jpeg,image/webp" aria-label="上传工作台产品实拍图">`;
  }
  function buildWorkbenchMessage(m,p,settings=ui.workbench){
    const w=settings,notes=profileNotes(m.member_id).map(n=>n.note_text).join(' '),soft=/不喜欢.*促销|不要强推/.test(notes),shape=notes.includes('短方圆')?'短方圆甲型搭起来也很自然，':'';
    const opening=w.tone==='brief'?`${m.name}你好～`:`${m.name}，最近还好吗？`;
    if(w.objective==='greeting')return opening+'今天想到你，想跟你打个招呼。最近过得怎么样？有空再聊，祝你这周顺顺利利。';
    if(w.objective==='preview')return opening+`想先给你看看一款在准备的「${p.product_name}」。我想到你之前喜欢偏清透、柔和的款式；如果想看颜色和效果，我可以先发张款式图给你。`;
    if(w.objective==='balance')return opening+`你在店里还有 ${money(m.balance).replace('.00','')} 的可用余额，想做美甲或护理时可以按门店规则使用。`+`这款「${p.product_name}」和你之前喜欢的${m.preferred_styles.replaceAll('|','、')}比较接近，${shape}有兴趣的话我发图给你看看。`+'不用急着决定，想来时我们再一起确认服务和时间。';
    if(w.objective==='care'){
      const visit=careFollowupVisit(m),tags=memberCareIndex.get(m.member_id)?.care_need_tags||'';
      let text=opening+(visit?`想问问你前几天做的「${visit.name}」，这几天佩戴还舒服吗？甲周和甲面状态怎么样？`:'想问问你上次做完美甲之后，甲周和甲面状态怎么样？');
      text+=/干燥|保湿/.test(tags)?'平时可以留意一下甲缘的保湿。':tags.includes('翘边')?'如果有翘边或破损，可以先发张照片给我们看看，别自己撕扯。':tags.includes('卸甲')?'如果最近想卸甲或让甲面休息，可以先和我说说你的安排。':'有需要维护的地方，随时和我说。';
      return text+`店里有「${p.product_name}」`+(soft?'，需要时我再给你介绍。':'，如果需要，可以一起看看是否适合。');
    }
    let text=opening+(w.objective==='new_product'?'给你看看店里最近的款式。':m.lifecycle==='dormant'?'好久没见，想给你分享一个你可能会喜欢的款式。':'最近有想换个款式吗？');
    text+=`「${p.product_name}」是${p.style}风格，${shape}和你之前喜欢的${m.preferred_styles.replaceAll('|','、')}比较接近。`;
    text+=w.tone==='brief'?'有兴趣的话我发图给你看看。':soft?'有兴趣就看看图，想来时再告诉我，我们一起看合适的时间。':'我把产品信息放在下面了，想来换款的话告诉我，我帮你看看合适的时间。';
    return text+(w.revision%2===0?' 有想调整的颜色或细节，也可以直接告诉我。':'');
  }
  function generateWorkbenchMessage(){
    const {p,m,reasons}=ensureWorkbench(),w=ui.workbench;
    if(reasons.length)throw new Error('请先查看当前联系限制。');
    if(!p&&!isNoProductObjective(w.objective))throw new Error('请先选择款式或服务。');
    w.revision++;w.draft=buildWorkbenchMessage(m,p);
    saveWorkbenchDraft();render();notify('参考话术已准备好。');
  }
  function updateWorkbenchPreview(){
    const w=ui.workbench,node=document.getElementById('message-draft');if(!node)return;w.draft=node.value;
    document.getElementById('chat-message').textContent=w.draft||'话术准备好后，会在这里显示顾客看到的消息。';document.getElementById('wb-draft-count').textContent=w.draft.length+' / 1600';
    const empty=!w.draft.trim(),{p,reasons}=ensureWorkbench(),assigned=activeTask(w.member_id);
    document.querySelector('[data-wb-copy]').disabled=empty||Boolean(ui.employee&&reasons.length);
    document.querySelector('[data-wb-download]').disabled=empty||!p||Boolean(ui.employee&&reasons.length);
    const use=document.querySelector('[data-wb-use]');
    if(use)use.disabled=empty||!assigned||reasons.length>0;
    const submit=document.querySelector('[data-wb-submit]');
    if(submit)submit.disabled=Boolean(assigned)||(!p&&!isNoProductObjective(w.objective))||reasons.length>0;
    saveWorkbenchDraft();
  }
  function addWorkbenchPick(){
    const {m,p}=ensureWorkbench(),w=ui.workbench;
    stagePick(m,w.objective,{product_id:p?.product_id||null,message:w.draft.trim()});
    ui.page='dashboard';
    render();
    focusDispatch();
    notify('已加入待分派清单。');
  }
  function useWorkbenchDraft(){
    const {m,reasons}=ensureWorkbench();
    const task=activeTask(m.member_id);
    if(!ui.employee||task?.assignee!==ui.employee||reasons.length)throw new Error('该任务当前不可使用话术。');
    ui.taskDrafts[task.task_id]={...ui.taskDrafts[task.task_id],message:ui.workbench.draft};
    ui.task=task.task_id;
    ui.taskFilter='全部';
    showPage('campaigns');
    notify('话术已带回本次任务。');
  }
  async function copyMessage(area){
    const text=area.value.trim();
    if(!text)throw new Error('请先准备话术。');
    try{await navigator.clipboard.writeText(text)}
    catch{area.focus();area.select();if(!document.execCommand('copy'))throw new Error('已选中草稿，请按 Ctrl+C 复制。')}
    notify('话术已复制。');
  }
  function wrapWorkbenchText(ctx,text,width){const lines=[];let line='';for(const ch of text){if(ch==='\n'){lines.push(line);line='';continue}if(ctx.measureText(line+ch).width>width){lines.push(line);line=ch}else line+=ch}if(line)lines.push(line);return lines}
  async function downloadWorkbenchCard(){
    const {p}=ensureWorkbench(),text=ui.workbench.draft.trim();if(!p||!text)throw new Error('请先准备话术并选择产品。');
    const canvas=document.createElement('canvas');canvas.width=800;const ctx=canvas.getContext('2d');ctx.font='21px "Microsoft YaHei",sans-serif';const lines=wrapWorkbenchText(ctx,text,690);canvas.height=Math.max(1100,730+lines.length*36);
    ctx.fillStyle='#faf7f3';ctx.fillRect(0,0,800,canvas.height);ctx.fillStyle='#442d38';ctx.font='italic 36px Georgia';ctx.fillText('nailmate',48,67);ctx.font='18px "Microsoft YaHei",sans-serif';ctx.fillStyle='#74666d';ctx.fillText('为你挑选的一份灵感',48,106);ctx.fillStyle='#f3e9e7';ctx.fillRect(48,140,704,375);
    const photo=catalogPhoto(p);if(photo){const image=new Image();image.src=photo;await image.decode();const scale=Math.min(704/image.width,375/image.height),width=image.width*scale,height=image.height*scale;ctx.drawImage(image,48+(704-width)/2,140+(375-height)/2,width,height)}
    else{ctx.fillStyle='#97516c';ctx.textAlign='center';ctx.font='25px "Microsoft YaHei",sans-serif';ctx.fillText(p.product_name,400,316);ctx.font='18px "Microsoft YaHei",sans-serif';ctx.fillText('产品实拍图待补充',400,355);ctx.textAlign='left'}
    ctx.fillStyle='#392e34';ctx.font='bold 28px "Microsoft YaHei",sans-serif';ctx.fillText(p.product_name,48,570);ctx.fillStyle='#97516c';ctx.font='26px "Microsoft YaHei",sans-serif';ctx.fillText(offerLabel(p),48,613);ctx.fillStyle='#392e34';ctx.font='21px "Microsoft YaHei",sans-serif';lines.forEach((line,i)=>ctx.fillText(line,48,675+i*36));ctx.fillStyle='#74666d';ctx.font='16px sans-serif';ctx.fillText(catalogSwatch(p)?'Nailmate · AI 甲片示意图 · SIMULATION':catalogReference(p)?'NailMate · 网络参考图 · '+new URL(catalogReference(p).source_url).hostname.replace(/^www\\./,'')+' · SIMULATION':'NailMate · 沟通卡片 · SIMULATION',48,canvas.height-45);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('卡片导出失败，请重试。');const link=document.createElement('a'),url=URL.createObjectURL(blob);link.href=url;link.download='NailMate_'+p.product_id+'_沟通卡片.png';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('图文卡片已导出。');
  }
  content.addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button)return;
    try{if(button.hasAttribute('data-wb-generate'))generateWorkbenchMessage();if(button.hasAttribute('data-wb-submit'))addWorkbenchPick();if(button.hasAttribute('data-wb-use'))useWorkbenchDraft();if(button.hasAttribute('data-wb-copy'))await copyMessage(document.getElementById('message-draft'));if(button.hasAttribute('data-wb-download'))await downloadWorkbenchCard();if(!ui.employee&&button.dataset.wbUpload){const input=document.getElementById('wb-image-upload');input.value='';input.click()}}
    catch(error){notify(error.message||'操作未完成，请重试。',true)}
  });
  content.addEventListener('input',event=>{if(event.target.id==='message-draft')updateWorkbenchPreview()});
  content.addEventListener('change',async event=>{
    const target=event.target;if(ui.page!=='studio')return;
    try{
      if(['studio-member','objective','tone','studio-product'].includes(target.id)){saveWorkbenchDraft();const w=ui.workbench;if(target.id==='studio-member')setWorkbenchMember(target.value);if(target.id==='objective'){w.objective=target.value;w.product_id=''}if(target.id==='tone')w.tone=target.value;if(target.id==='studio-product')w.product_id=target.value;w.loadedKey=null;render()}
      if(target.id==='wb-image-upload'&&target.files[0]){const productId=ui.workbench.product_id;await storeProductPhoto(target.files[0],productId);if(ui.page==='studio'&&ui.workbench.product_id===productId)render();notify('产品实拍图已更新，产品库与沟通预览共享这张图。')}
    }catch(error){notify(error.message||'操作未完成，请重试。',true)}
  });

  // A daily operating plan, calculated from the reviewed snapshot; no model or message service.
  const ATELIER_NOTE=`<svg class="atelier-note-art" aria-hidden="true" focusable="false" viewBox="0 0 56 54">
    <rect x="13" y="11" width="34" height="37" rx="6" fill="#ecd6df" opacity=".7" transform="rotate(10 30 29)"/>
    <path d="M12 6h23l8 8v28a5 5 0 0 1-5 5H12a5 5 0 0 1-5-5V11a5 5 0 0 1 5-5Z" fill="#fffaf4" stroke="#d9b8c5" transform="rotate(-8 25 26)"/>
    <path d="M35 6v7a1 1 0 0 0 1 1h7" fill="#f0d6df" stroke="#d9b8c5" transform="rotate(-8 25 26)"/>
    <path d="m18 29 5 5 10-12" fill="none" stroke="#a0647d" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  const OPPORTUNITIES={
    all:{label:'全部机会'},repurchase:{label:'复购机会'},
    balance:{label:'储值关怀'},care:{label:'护理回访'},preview:{label:'新品预告'},
    greeting:{label:'日常问候'}
  };
  const OPPORTUNITY_PRIORITY=['preview','greeting','care','repurchase','balance'];
  ui.opportunity='all';

  function activeTask(id){return state.tasks.find(t=>t.member_id===id&&t.status==='assigned')}
  function isNoProductObjective(objective){return objective==='greeting'}
  function offerProduct(id){return memberProductIndex.get(id)||CATALOG_IDEAS.find(p=>p.product_id===id)}
  function offerLabel(p){return p.planned||p.launch_date>WORK_DATE?`演示预告 · ${p.launch_date||'日期待确认'}`:money(p.price).replace('.00','')}
  function matchingPreviews(m) {
    if(m.lifecycle!=='active')return [];
    const styles=m.preferred_styles.split('|');
    return [...CATALOG_IDEAS,...DATA.products]
      .filter(p=>p.product_type==='nail_style'&&p.launch_date>WORK_DATE&&daysBetween(p.launch_date,WORK_DATE)<=14
        &&(p.preview_styles||[p.style]).some(style=>styles.includes(style)))
      .sort((a,b)=>a.launch_date.localeCompare(b.launch_date)||a.product_id.localeCompare(b.product_id));
  }
  function matchesOpportunity(m,key){
    if(key==='repurchase')return ['due','low_frequency','dormant'].includes(m.lifecycle);
    if(key==='balance')return m.ratio>1.15&&m.balance>0;
    if(key==='care')return Boolean(memberCareIndex.get(m.member_id)?.care_followup_opt_in&&careReady(m));
    if(key==='preview')return matchingPreviews(m).length>0;
    if(key==='greeting')return m.lifecycle==='active'&&m.visit_count>=2&&(!m.last_contact_date||daysBetween(WORK_DATE,m.last_contact_date)>=30);
    return false;
  }
  function opportunityGroups() {
    const groups=Object.fromEntries(OPPORTUNITY_PRIORITY.map(key=>[key,[]]));
    const queued=new Set(state.tasks.filter(t=>t.status==='assigned').map(t=>t.member_id));
    for(const m of state.members) {
      if(m.last_handled_on===WORK_DATE||queued.has(m.member_id)||memberBlockers(m).length)continue;
      for(const key of OPPORTUNITY_PRIORITY)if(matchesOpportunity(m,key))groups[key].push(m);
    }
    return groups;
  }
  function sortOpportunity(members,objective){
    return [...members].sort((a,b)=>{
      let rank;
      if(objective==='preview')rank=matchingPreviews(a)[0].launch_date.localeCompare(matchingPreviews(b)[0].launch_date)||a.days-b.days;
      else if(objective==='greeting')rank=(a.last_contact_date||'').localeCompare(b.last_contact_date||'')||b.visit_count-a.visit_count;
      else if(objective==='care')rank=careFollowupVisit(a).days-careFollowupVisit(b).days;
      else rank=b.priority_score-a.priority_score||Math.min(b.ratio,4)-Math.min(a.ratio,4);
      return rank||a.member_id.localeCompare(b.member_id);
    });
  }
  function careRecommendations(groups=opportunityGroups()){
    const selected=ui.opportunity;
    if(selected!=='all')return sortOpportunity(groups[selected],selected).slice(0,ui.limit).map(m=>({m,objective:selected}));
    const seen=new Set();
    const queues=OPPORTUNITY_PRIORITY.map(objective=>sortOpportunity(groups[objective],objective).filter(m=>{
      if(seen.has(m.member_id))return false;
      seen.add(m.member_id);return true;
    }).map(m=>({m,objective})));
    const picks=[];
    for(let offset=0;offset<ui.limit;offset++) {
      for(const queue of queues) {
        if(queue[offset])picks.push(queue[offset]);
        if(picks.length===ui.limit)return picks;
      }
    }
    return picks;
  }
  function opportunityEvidence(m,objective,p){
    if(objective==='preview') {
      const match=p||matchingPreviews(m)[0];
      const preferred=(match?.preview_styles||[match?.style]).filter(style=>m.preferred_styles.split('|').includes(style)).join('、');
      return match?`活跃会员，档案偏好「${preferred}」；「${match.product_name}」演示计划于 ${match.launch_date} 上架，可以先分享灵感、询问是否想看款。`:'当前没有匹配且临近上架的款式预告。';
    }
    if(objective==='greeting')return m.last_contact_date?`活跃会员，上次主动联系是 ${m.last_contact_date}。可以发一条简短问候，听听近况。`:'活跃会员，有多次到店记录；当前没有近期联系记录，可以发一条简短问候。';
    if(objective==='balance')return `已有 ${money(m.balance).replace('.00','')} 可用余额，${m.days} 天未到店。先提醒已有权益，再询问是否想换款。`;
    if(objective==='care'){
      const visit=careFollowupVisit(m);
      return visit
        ? `${visit.date} 做了「${visit.name}」，已过 ${visit.days} 天。先确认佩戴是否舒服、甲面和甲缘状态如何，再按反馈提供护理建议。`
        : '暂无美甲服务记录。';
    }
    return `${m.days} 天未到店，个人周期 ${m.cycle} 天，已到 ${m.ratio} 倍。${m.cycle_confidence==='low'?'历史较少，周期仅供参考。':'先了解近期需求，不推测未到店原因。'}`;
  }
  function opportunityProduct(m,objective){return workbenchProducts(m,objective)[0]}
  function opportunityAction(m,objective,p){
    if(objective==='scheduled')return '历史回访计划';
    if(objective==='greeting')return '发一句亲切问候，听听近况';
    if(objective==='preview')return p?`分享「${p.product_name}」预告`:'先确认想看的款式';
    if(objective==='balance')return '可用余额 '+money(m.balance).replace('.00','');
    if(objective==='care')return '先询问美甲后的佩戴体验';
    return '推荐 '+(p?.product_name||'先了解需求');
  }
  function taskContactBlockers(task) {
    const m=member(task.member_id),rows=memberBlockers(m,task.objective,task.status==='assigned');
    if(task.objective==='preview'&&!matchingPreviews(m).some(p=>p.product_id===task.product_id))rows.push('所选款式已超出预告窗口或偏好已变化');
    return rows;
  }
  function careCards(rows){
    const title=ui.opportunity==='all'?'今日优先联系':OPPORTUNITIES[ui.opportunity].label+'优先名单';
    const rowTools=`<div class="care-row-tools"><span class="care-row-label">${rows.length} 张便签 · 挑选今天联系的顾客</span><div class="care-row-arrows" hidden><button type="button" aria-label="向左查看便签" aria-controls="care-wall">←</button><button type="button" aria-label="向右查看便签" aria-controls="care-wall">→</button></div></div>`;
    return `${rowTools}<div id="care-wall" class="care-wall-single-row" style="--care-count:${rows.length}" role="region" tabindex="0" aria-label="${escape(title)}，可横向滚动">${rows.map(({m,objective})=>{
      const p=opportunityProduct(m,objective),flipped=Boolean(ui.flips[m.member_id]),note=profileNotes(m.member_id)[0];
      const visit=objective==='care'?careFollowupVisit(m):null;
      const action=opportunityAction(m,objective,p);
      const contextual=isNoProductObjective(objective)||objective==='preview';
      const timing=objective==='preview'?(p?offerLabel(p):'日期待确认'):(m.last_contact_date?`上次联系 ${m.last_contact_date}`:'有多次到店记录');
      return `<article class="hanger glass-track ${ui.picks.has(m.member_id)?'selected':''}" data-member="${m.member_id}"><div class="cord" aria-hidden="true"></div><div class="tilt glass-tilt"><div class="card ${flipped?'flipped':''}">
        <div class="face front glass-surface" ${flipped?'inert aria-hidden="true"':'aria-hidden="false"'}><div class="meta">${m.member_id} / ${visit?'美甲后回访':LABELS[m.lifecycle]}</div><div class="monogram" aria-hidden="true">${escape(m.name[0])}</div><h3>${escape(m.name)}</h3>${contextual?`<div class="growth-card-context"><strong>${objective==='preview'?'偏好匹配':'保持联系'}</strong><span>${escape(timing)}</span></div>`:`<div class="days"><b>${visit?visit.days:m.days}</b><span>${visit?'天前做过美甲':'天未到店'}</span></div><p class="cycle">${visit?`${escape(visit.date)} · ${escape(visit.name)}`:`个人周期 ${m.cycle} 天 · 偏离 ${m.ratio} 倍${m.cycle_confidence==='low'?'<br>历史较少 · 参考周期':''}`}</p>`}<p class="growth-card-goal">${WB_OBJECTIVES[objective]}</p><p class="growth-card-product">${escape(action)}</p><div class="actions"><button data-flip="${m.member_id}" aria-expanded="false" aria-label="查看 ${m.member_id} 推荐依据">查看依据 ↻</button><button class="primary" data-pick="${m.member_id}" aria-pressed="${ui.picks.has(m.member_id)}"><span class="pick-label">${ui.picks.has(m.member_id)?'已选 · 移除':'加入清单'}</span></button></div></div>
        <div class="face back glass-surface" ${flipped?'aria-hidden="false"':'inert aria-hidden="true"'}><div class="meta">${m.member_id} / ${WB_OBJECTIVES[objective]}</div><h3>${escape(m.name)}</h3><h4>为什么先联系她</h4><p>${escape(opportunityEvidence(m,objective,p))}</p><h4>本次行动</h4><p>${escape(action)}</p><p class="quiet">${note?'参考客户备注：'+escape(note.note_text.slice(0,78)+(note.note_text.length>78?'…':'')):'偏好 '+escape(m.preference)+' · 已通过联系资格检查'}</p><div class="actions"><button class="primary" data-pick="${m.member_id}" aria-pressed="${ui.picks.has(m.member_id)}"><span class="pick-label">${ui.picks.has(m.member_id)?'已选 · 移除':'加入清单'}</span></button><button data-unflip="${m.member_id}">返回 ↶</button></div></div>
      </div></div></article>`;
    }).join('')}</div>`;
  }
  function taskSummary(tasks) {
    const groups=teamChartTaskGroups(tasks);
    return {assigned:tasks.length,pending:tasks.filter(task=>task.status==='assigned').length,
      contacted:groups.contacted.length,booked:groups.booked.length,visited:groups.visited.length};
  }
  function summaryCards(stats) {
    return `<div class="task-overview"><div>已分派<strong>${stats.assigned}</strong></div><div>待联系<strong>${stats.pending}</strong></div><div>已联系<strong>${stats.contacted}</strong></div><div>已预约<strong>${stats.booked}</strong></div><div>已到店<strong>${stats.visited}</strong></div></div>`;
  }
  function stagePick(m,objective,details={}) {
    if(ui.employee)throw new Error('只有老板娘账号可以分派任务。');
    const existing=activeTask(m.member_id);
    if(existing)throw new Error(`${m.name} 已由 ${existing.assignee} 负责。请在联系任务中改派。`);
    const reasons=memberBlockers(m,objective);
    if(reasons.length)throw new Error(`${m.name} 暂不可联系：${reasons.join('、')}。`);
    const previous=ui.picks.get(m.member_id);
    const serviceOrderId=objective==='care'?pendingCare.get(m.member_id)?.service_order_id:undefined;
    const pick={member_id:m.member_id,objective,service_order_id:serviceOrderId,
      assignee:previous?.assignee??suggestedEmployee(m),note:previous?.note||'',...details};
    ui.picks.set(m.member_id,pick);
  }
  function dispatchPanel() {
    const picks=[...ui.picks.values()];
    if(!assignableStaff().length)return '<h2 class="atelier-heading">待分派清单</h2><p class="muted">请先开通至少一位员工的登录账号，再确认分派。</p><button data-page="accounts">开通员工账号</button>';
    if(!picks.length)return '<h2 class="atelier-heading">待分派清单</h2><p class="muted">从上面的推荐名单选人。切换经营机会时，已选顾客会留在这张清单里。</p>';
    return `<h2 class="atelier-heading">待分派清单 · ${picks.length} 位</h2><p class="muted">默认建议最近服务过该会员的员工。可以改选负责人，也可以补充这次沟通的重点。</p>
      <form id="dispatch-form">
        <div class="dispatch-toolbar"><div class="field"><label for="bulk-employee">批量分派给</label><select id="bulk-employee">${employeeOptions(ui.bulkEmployee,'选择员工',true)}</select></div><button type="button" data-apply-employee>应用到全部</button></div>
        <ul class="dispatch-list">${picks.map(pick=>{
          const m=member(pick.member_id),id=m.member_id,existing=activeTask(id);
          return `<li class="dispatch-row">
            <div><strong>${escape(m.name)}</strong><small>${id} · ${WB_OBJECTIVES[pick.objective]}</small>${existing?`<small>已有负责人 ${escape(existing.assignee)}</small>`:''}</div>
            <div class="field"><label for="assignee-${id}">负责人</label><select id="assignee-${id}" data-pick-employee="${id}">${employeeOptions(pick.assignee||suggestedEmployee(m),'选择员工',true)}</select></div>
            <div class="field dispatch-note"><label for="note-${id}">沟通重点 <small>选填</small></label><input id="note-${id}" data-pick-note="${id}" maxlength="180" value="${escape(pick.note)}" placeholder="比如先问她是否想换短甲"></div>
            <button type="button" data-remove-pick="${id}" aria-label="移除 ${escape(m.name)}">移除</button>
          </li>`;
        }).join('')}</ul>
        <button type="submit" class="primary">确认并分派 · ${picks.length} 位</button>
      </form>`;
  }
  function refreshPicks() {
    const panel=document.getElementById('dispatch-queue');
    panel.innerHTML=dispatchPanel();
    setupChoiceFields(panel);
    setupGlassControls(panel);
    document.getElementById('pick-count').textContent=ui.picks.size;
    content.querySelectorAll('[data-pick]').forEach(button=>{
      const selected=ui.picks.has(button.dataset.pick);
      button.setAttribute('aria-pressed',String(selected));
      button.querySelector('.pick-label').textContent=selected?'已选 · 移除':'加入清单';
      button.closest('.hanger')?.classList.toggle('selected',selected);
    });
  }
  function focusDispatch(){
    const panel=document.getElementById('dispatch-queue');
    panel.focus({preventScroll:true});
    panel.scrollIntoView({block:'start'});
  }
  let careQueuePage=1;
  function careQueue() {
    const rows=[...pendingCare.values()].sort((a,b)=>a.due_on.localeCompare(b.due_on)||a.member_id.localeCompare(b.member_id));
    if(!rows.length)return '<div class="empty atelier-empty"><p>暂无到期且待分派的护理回访。</p></div>';
    const pageSize=12,pages=Math.ceil(rows.length/pageSize);
    careQueuePage=Math.min(careQueuePage,pages);
    const visible=rows.slice((careQueuePage-1)*pageSize,careQueuePage*pageSize);
    const body=visible.map(row=>{
      const m=member(row.member_id),selected=ui.picks.has(row.member_id);
      const reasons=memberBlockers(m,'care');
      if(activeTask(m.member_id))reasons.push('已有待联系任务');
      if(m.last_handled_on===WORK_DATE)reasons.push('今天已有沟通记录');
      return `<tr><td>${escape(m.name)}<br><small>${escape(row.member_id)}${row.data_type==='simulation'?' · 模拟':''}</small></td>
        <td>${escape(row.completed_on)}</td><td>${escape(row.due_on)}</td>
        <td class="wrap">${reasons.length?escape(reasons.join('、')):'可分派'}</td>
        <td><button type="button" data-pick="${escape(row.member_id)}" aria-pressed="${selected}" ${reasons.length&&!selected?'disabled':''}><span class="pick-label">${selected?'已选 · 移除':'加入清单'}</span></button></td></tr>`;
    });
    return table(['顾客','服务完成日','回访到期日','联系资格','操作'],body)+
      (pages>1?`<div class="button-row" aria-label="回访待办分页"><button data-care-queue-page="${careQueuePage-1}" ${careQueuePage===1?'disabled':''}>上一页</button><span>${careQueuePage} / ${pages}</span><button data-care-queue-page="${careQueuePage+1}" ${careQueuePage===pages?'disabled':''}>下一页</button></div>`:'');
  }
  function dashboard(){
    const careMode=ui.opportunity==='care';
    const queuedCare=careMode&&Array.isArray(state.careReminders);
    const groups=opportunityGroups(),picks=careRecommendations(groups);
    const total=new Set(Object.values(groups).flat().map(m=>m.member_id)).size;
    const eligible=queuedCare?pendingCare.size:ui.opportunity==='all'?total:groups[ui.opportunity].length;
    content.innerHTML=`<section class="growth-intro"><div><h2>今天，联系哪些顾客？</h2><p>从 <strong>${state.members.length.toLocaleString('zh-CN')}</strong> 位会员中，${queuedCare?'查看满 21 天的护理回访，逾期待办仍可分派。':careMode?`筛选最近一次美甲服务后第 ${TEAM_CARE_FOLLOWUP_DAY} 天、已同意护理跟进的顾客。`:'按个人复购周期、到店情况、顾客偏好和上架计划找出联系机会。'}先选人，再交给合适的员工。</p></div><div class="glass-track"><aside class="growth-daily-note glass-tilt glass-surface"><p><strong>${eligible.toLocaleString('zh-CN')}</strong> 位符合当前机会</p><small>${queuedCare?'有联系限制的待办会保留，并显示原因。':'已排除有联系限制、已有待联系任务和今天已处理的顾客'}</small><button class="primary" id="jump-dispatch">查看待分派清单 · <span id="pick-count">${ui.picks.size}</span> 位</button></aside></div></section>
      <section class="growth-opportunities"><div class="growth-section-title"><h2 class="atelier-heading">经营机会</h2><p>同一会员可能符合多个机会，人数不相加。</p></div><div class="opportunity-scroll"><div class="growth-opportunity-tabs" role="group" aria-label="选择经营机会" style="--opportunity-count:${Object.keys(OPPORTUNITIES).length};--opportunity-index:${Object.keys(OPPORTUNITIES).indexOf(ui.opportunity)}"><span class="opportunity-highlight" aria-hidden="true"></span>${Object.entries(OPPORTUNITIES).map(([key,item])=>`<button data-opportunity="${key}" aria-pressed="${ui.opportunity===key}"><span>${item.label}</span><b>${(key==='all'?total:key==='care'&&Array.isArray(state.careReminders)?pendingCare.size:groups[key].length).toLocaleString('zh-CN')}</b></button>`).join('')}</div></div></section>
      ${queuedCare?`<section class="growth-priority"><div class="section-head"><h2 class="atelier-heading">护理回访待分派</h2></div>${careQueue()}</section>`:`<section class="growth-priority"><div class="section-head"><div><h2 class="atelier-heading">${ui.opportunity==='all'?'今日优先联系':OPPORTUNITIES[ui.opportunity].label+' · 优先名单'}</h2><p class="muted">${careMode?`按北京时间，在最近一次美甲服务满 3 周当天推荐。`:ui.opportunity==='repurchase'?'按距上次到店的天数与个人复购周期的比值，筛选待复购、低频和沉睡会员。':ui.opportunity==='all'?'从不同机会里挑选适合联系的人，再决定这次怎么聊。':'按会员档案、偏好和联系资格筛选，带着具体理由联系。'}</p></div><div class="count-control"><label for="care-limit">显示推荐</label><select id="care-limit">${options([3,4,5,8],ui.limit)}</select></div></div>
      ${picks.length?careCards(picks):`<div class="empty atelier-empty">${ATELIER_NOTE}<p>${careMode?'暂无符合条件的待回访会员。':'这类机会暂时没有符合条件的会员，可以切换其他经营机会。'}</p><p><button data-page="campaigns">查看已有任务</button></p></div>`}<p class="care-note">${careMode?'同一天的顾客按会员编号排序。':'名单按已有规则优先级排列；评分不由模型计算。余额是服务权益，不作为新增收入或排序加分。'}</p></section>`}
      <section class="dispatch-panel" id="dispatch-queue" tabindex="-1" aria-label="待分派清单">${dispatchPanel()}</section>`;
    setupGlass(content);
    setupCareRow();
  }
  function selectOpportunity(button) {
    const previous=button.parentElement.querySelector('.opportunity-highlight');
    const from=getComputedStyle(previous).transform;
    ui.opportunity=button.dataset.opportunity;
    ui.flips={};
    render();

    const rail=content.querySelector('.growth-opportunity-tabs');
    rail.querySelector('[aria-pressed=true]').focus({preventScroll:true});
    const highlight=rail.querySelector('.opportunity-highlight');
    const to=getComputedStyle(highlight).transform;
    if(!reducedMotion.matches && typeof highlight.animate==='function' && from!==to) {
      highlight.animate([{transform:from},{transform:to}],
        {duration:220,easing:'cubic-bezier(.2,.7,.25,1)'});
    }
  }
  async function assignSelected() {
    if(ui.employee||!ui.picks.size)throw new Error('请先选择本次要分派的顾客。');
    const tasks=[...ui.picks.values()].map(pick=>{
      const m=member(pick.member_id);
      const existing=activeTask(m.member_id);
      if(existing)throw new Error(`${m.name} 已由 ${existing.assignee} 负责。请从清单中移除，或到联系任务中改派。`);
      const assignee=pick.assignee||suggestedEmployee(m);
      if(!assignableStaff().includes(assignee))throw new Error(`请为 ${m.name} 选择已开通账号的负责人。`);
      const p=pick.product_id?offerProduct(pick.product_id):opportunityProduct(m,pick.objective);
      const task={member_id:m.member_id,objective:pick.objective,
        product_id:p?.product_id||null,service_order_id:pick.service_order_id,assignee,note:pick.note.trim()};
      const reasons=taskContactBlockers(task);
      if(m.last_handled_on===WORK_DATE)reasons.push('今天已有沟通记录');
      if(pick.service_order_id&&pendingCare.get(m.member_id)?.service_order_id!==pick.service_order_id)reasons.push('对应服务已变化，请重新选择');
      if(!p&&!isNoProductObjective(pick.objective))reasons.push('暂缺匹配款式或服务');
      if(reasons.length)throw new Error(`${m.name} 暂不可分派：${reasons.join('、')}。`);
      task.reason=opportunityEvidence(m,pick.objective,p);
      task.message=pick.message||buildWorkbenchMessage(m,p,{objective:pick.objective,tone:'friendly',revision:1});
      return task;
    });
    const {taskIds}=await apiAction('assign',{tasks});
    ui.picks.clear();
    ui.bulkEmployee='';
    ui.task=taskIds[0];
    ui.taskFilter='全部';
    ui.employeeFilter='';
    showPage('campaigns');
    notify(`已分派 ${tasks.length} 项联系任务。${serverMode?'员工登录后可以查看待办。':'切换到对应员工的预览身份可查看待办。'}`);
  }
  function taskContext(task){
    const m=member(task.member_id),p=offerProduct(task.product_id);
    const restrictions=task.status==='assigned'?taskContactBlockers(task):[];
    const reason=task.reason||opportunityEvidence(m,task.objective||'repurchase',p);
    return `${restrictions.length?`<p class="eligibility blocked">当前联系限制：${escape(restrictions.join('、'))}</p>`:''}
      <section class="growth-task-context"><h3>为什么联系</h3><p>${escape(reason)}</p>
      <p class="task-action-note"><b>沟通目标</b> · ${escape(opportunityAction(m,task.objective,p))}</p>
      <p class="helper">最近到店 ${escape(m.last_visit)} · 上次联系 ${escape(m.last_contact_date||'暂无记录')} · 偏好 ${escape(m.preference)}</p>
      ${p?`<div class="growth-task-product">${workbenchPhoto(p)}<div><h4>${escape(p.product_name)}</h4><p>${escape(p.description)}</p><strong>${escape(offerLabel(p))}</strong></div></div>`:''}</section>`;
  }
  function taskMemberNotes(task) {
    const notes=profileNotes(task.member_id);
    const ownerNotes=notes.filter(note=>note.author_role!=='employee');
    const employeeNotes=notes.filter(note=>note.author_role==='employee');
    const editable=ui.employee&&state.employeeNotesEnabled&&['assigned','recorded'].includes(task.status);
    return `<details class="task-owner-notes"><summary>老板娘备注 · ${ownerNotes.length} 条</summary>
      ${ownerNotes.length?ownerNotes.map(note=>profileNoteItem(note)).join(''):'<p class="helper">暂无老板娘备注。</p>'}</details>
      ${editable||employeeNotes.length?`<details class="task-owner-notes" open><summary>员工备注 · ${employeeNotes.length} 条</summary>
        ${employeeNotes.map(note=>profileNoteItem(note,editable?'employee':undefined)).join('')}
        ${editable?employeeNoteEditor(task):''}</details>`:''}`;
  }
  function employeeNoteEditor(task){
    const draft=ui.employeeNoteDrafts[task.task_id]||{text:'',type:'service'};
    return `<form id="employee-note-form" class="profile-note-form" data-task="${task.task_id}">
      <label for="employee-note-text">${draft.noteId?'编辑我的备注':'添加员工备注'}</label>
      <textarea id="employee-note-text" name="text" maxlength="1200" required placeholder="例如：喜欢短圆甲，下次希望保留长度。">${escape(draft.text)}</textarea>
      <div class="profile-note-toolbar"><select name="type" aria-label="员工备注类型">${Object.entries(NOTE_LABELS).map(([value,label])=>`<option value="${value}" ${draft.type===value?'selected':''}>${label}</option>`).join('')}</select>
      ${draft.noteId?'<button type="button" data-employee-note-cancel>取消编辑</button>':''}
      <button class="primary" type="submit">${draft.noteId?'保存修改':'保存员工备注'}</button></div>
      <p class="helper">老板娘和有权查看该客户的员工可见。</p></form>`;
  }
  function todoReasons(task) {
    return teamTodoReasons(task,state.calendarDate);
  }
  function awaitingHandoff(task) {
    return !task.assignee && teamTaskNeedsHandoff(task);
  }
  function appointmentLabel(result) {
    return TEAM_APPOINTMENT_LABELS[result?.appointment_status] || '待到店';
  }
  function appointmentTime(result) {
    return result?.appointment_at?.replace('T',' ') || '预约时间待补';
  }
  function taskPlan(result) {
    if(!result || !(result.follow_up_on || result.follow_up_note || result.booked))return '';
    return `<dl class="task-plan">
      ${result.follow_up_on||result.follow_up_note?`<div><dt>下一步</dt><dd>${escape([result.follow_up_on,result.follow_up_note].filter(Boolean).join(' · '))}</dd></div>`:''}
      ${result.booked?`<div><dt>预约</dt><dd>${escape(appointmentTime(result))} · ${escape(appointmentLabel(result))}</dd></div>`:''}</dl>`;
  }
  function taskOutcome(task) {
    const result=task.result;
    if(!result)return '';
    if(task.status==='executed_simulated')return `<p class="helper">历史模拟记录 · ${result.visited?'已到店':result.booked?'已预约':result.replied?'已回复':'未回复'} · ${money(result.amount||0)}</p>`;
    return `<div class="eligibility"><b>${escape(result.outcome)}</b>${result.booked?` · ${escape(appointmentLabel(result))}`:''} · ${escape(result.recorded_on)}${result.note?`<p class="task-note">${escape(result.note)}</p>`:''}</div>`;
  }
  function employeeTaskForm(task){
    const editing=task.status==='recorded';
    const previous=task.result;
    const draft={outcome:previous?.outcome,note:previous?.note,followUpOn:previous?.follow_up_on,
      followUpNote:previous?.follow_up_note,appointmentAt:previous?.appointment_at,
      appointmentStatus:previous?.appointment_status||'scheduled',...ui.taskDrafts[task.task_id]};
    const canContact=!taskContactBlockers(task).length;
    const outcomes=editing||canContact?OUTCOMES:['暂不联系'];
    const revision=task.result_revision||0;
    const draftRevision=Number(draft.expectedRevision??revision);
    return `<form id="task-result-form" class="form-panel" data-task="${task.task_id}">
      <input type="hidden" name="expectedRevision" value="${draftRevision}">
      ${draftRevision!==revision?'<p class="eligibility blocked">这条任务有较新的反馈。可先复制当前草稿，再点击「刷新任务与备注」载入最新内容。</p>':''}
      <div class="field"><label for="task-message">参考话术 · 可修改</label><textarea id="task-message" name="message" maxlength="1600">${escape(draft.message??task.message)}</textarea></div>
      <p class="helper">${editing?'顾客后来回复或改变计划时，可以更新这项任务。历史反馈会保留，修改记录不代表再次联系。':'请用门店常用渠道联系顾客，联系后在这里登记反馈。'}</p>
      <div class="button-row"><button type="button" data-copy-task ${canContact?'':'disabled'}>复制话术</button><button type="button" data-task-studio="${task.task_id}">到话术工作台</button></div>
      <div class="field"><label for="task-outcome">沟通结果</label><select id="task-outcome" name="outcome"><option value="">选择结果</option>${options(outcomes,draft.outcome)}</select></div>
      <div class="field"><label for="task-result-note">顾客反馈 <small>选填</small></label><textarea id="task-result-note" name="note" maxlength="500" placeholder="例如想周末来做裸色款，已确认时间">${escape(draft.note||'')}</textarea></div>
      <section class="task-form-plan" data-follow-up-fields ${draft.outcome==='不再营销'?'hidden':''}>
        <h3>下一步</h3>
        <div class="task-form-grid"><div class="field"><label for="task-follow-up-on">下次跟进日期 <small>选填</small></label><input type="date" id="task-follow-up-on" name="followUpOn" value="${escape(draft.followUpOn||'')}"></div>
        <div class="field"><label for="task-follow-up-note">跟进事项 <small>选填</small></label><input id="task-follow-up-note" name="followUpNote" maxlength="180" placeholder="例如周五问问下周哪天方便" value="${escape(draft.followUpNote||'')}"></div></div>
        <p class="helper">到期会出现在今日待办。跟进完成后可以清空日期并保存。</p>
      </section>
      <section class="task-form-plan" data-appointment-fields ${draft.outcome==='已预约'?'':'hidden'}>
        <h3>${task.care_service_order_id?'本次回访预约与到店':'预约与到店'}</h3>
        <div class="task-form-grid"><div class="field"><label for="task-appointment-at">预约时间 <small>选填 · 北京时间</small></label><input type="datetime-local" id="task-appointment-at" name="appointmentAt" value="${escape(draft.appointmentAt||'')}"></div>
        <div class="field"><label for="task-appointment-status">到店状态</label><select id="task-appointment-status" name="appointmentStatus">${Object.entries(TEAM_APPOINTMENT_LABELS).map(([key,label])=>`<option value="${key}" ${key===draft.appointmentStatus?'selected':''}>${key==='rescheduled'?'改期':label}</option>`).join('')}</select></div></div>
        <p class="helper">改期时填写新时间。预约时间到达后可登记已到店或未到店。</p>
      </section>
      <button type="submit" class="primary">${editing?'更新联系结果':'保存联系结果'}</button>
    </form>`;
  }
  function campaignsPage(){
    const visible=visibleTasks();
    const current=visible.filter(t=>t.status==='assigned'||t.status==='recorded');
    const filters=['全部',STATUSES.assigned,STATUSES.recorded];
    if(ui.employee)filters.unshift('今日待办');
    if(!ui.employee&&current.some(awaitingHandoff))filters.splice(1,0,'待交接');
    if(!ui.employee)for(const status of ['archived','executed_simulated'])if(visible.some(t=>t.status===status))filters.push(STATUSES[status]);
    if(!filters.includes(ui.taskFilter))ui.taskFilter='全部';
    const todos=current.filter(task=>todoReasons(task).length);
    const todayOnly=ui.taskFilter==='今日待办';
    const tasks=todayOnly ? todos : visible.filter(task=>(!ui.employeeFilter||task.assignee===ui.employeeFilter)
      &&(ui.taskFilter==='全部'||STATUSES[task.status]===ui.taskFilter||(ui.taskFilter==='待交接'&&awaitingHandoff(task))));
    if(!tasks.some(t=>t.task_id===ui.task))ui.task=(tasks.find(t=>t.status==='assigned')||tasks[0])?.task_id||null;
    const task=tasks.find(t=>t.task_id===ui.task);
    const ownerFilter=ui.employee?'':`<div class="field"><label for="employee-filter">负责人</label><select id="employee-filter">${employeeOptions(ui.employeeFilter,'全部员工')}</select></div>`;
    const title=ui.employee?`${escape(ui.employee)}的任务`:'门店联系任务';
    content.innerHTML=`<div class="section-head"><div><h2 class="atelier-heading">${title}</h2><p class="muted">${ui.employee?'查看客户备注、补充员工备注并登记反馈。':'按员工或状态查看任务，尚未联系的任务可以改派。'}</p></div><div class="button-row"><button type="button" data-refresh-team>刷新任务与备注</button>${ui.employee?'':'<button data-page="dashboard">去选客分派</button>'}</div></div>
      ${ui.employee?`<section class="task-agenda" aria-label="今日待办"><div><h3>今日待办 <strong>${todos.length}</strong></h3><p>${escape(state.calendarDate)} · 待联系、到期跟进和待登记到店结果</p></div><div class="button-row"><button type="button" data-task-view="今日待办" aria-pressed="${todayOnly}">查看待办</button><button type="button" data-task-view="全部" aria-pressed="${ui.taskFilter==='全部'}">全部任务</button></div></section>`:summaryCards(taskSummary(current))}
      <div class="review-layout"><section aria-label="联系任务列表">${ownerFilter}<div class="field"><label for="task-filter">任务状态</label><select id="task-filter">${options(filters,ui.taskFilter)}</select></div>
        <p class="helper">${tasks.length} 项任务</p><div class="task-list">${tasks.map(t=>`<button data-task="${t.task_id}" aria-pressed="${ui.task===t.task_id}">${escape(member(t.member_id).name)} · ${escape(t.strategy)}<small>${awaitingHandoff(t)?'待交接':`${escape(t.assignee||'历史任务')} · ${escape(todoReasons(t).join(' · ')||STATUSES[t.status])}`}</small></button>`).join('')}</div>
      </section><section class="task-detail" aria-label="联系任务详情">${task?`
        <div class="detail-head"><h2>${escape(member(task.member_id).name)} · ${escape(task.strategy)}</h2><span class="pill">${awaitingHandoff(task)?'待交接':STATUSES[task.status]}</span></div>
        <p class="helper">${task.task_id} · 负责人 ${escape(task.assignee||'—')}${task.assigned_on?' · '+escape(task.assigned_on):''}</p>
        ${task.note?`<aside class="task-instruction" aria-label="老板娘本次交代"><h3>老板娘本次交代</h3><p>${escape(task.note)}</p></aside>`:''}
        ${taskPlan(task.result)}
        ${taskContext(task)}
        ${['assigned','recorded'].includes(task.status)&&ui.employee?employeeTaskForm(task):`<details><summary>查看沟通话术</summary><p class="task-note">${escape(task.message||'暂无话术')}</p></details>`}
        ${!ui.employee&&(task.status==='assigned'||awaitingHandoff(task))?`<form id="reassign-form" class="form-panel" data-task="${task.task_id}"><div class="dispatch-toolbar"><div class="field"><label for="new-assignee">改派负责人</label><select id="new-assignee" name="assignee">${employeeOptions(task.assignee,'选择员工',true)}</select></div><button type="submit">确认改派</button></div></form>`:''}
        ${taskOutcome(task)}
        ${taskMemberNotes(task)}
        ${task.result_history?.length?`<details><summary>反馈修改记录 · ${task.result_history.length} 次</summary><ol class="task-result-history">${task.result_history.map(result=>`<li><strong>${escape(result.outcome)}</strong> <small>第 ${result.revision} 次保存 · ${escape(result.recorded_by||task.assignee)} · ${escape(result.updated_at?new Date(result.updated_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):result.recorded_on)}</small><p>${escape(result.note||'未填写顾客反馈')}</p>${taskPlan(result)}</li>`).join('')}</ol></details>`:''}
        <details><summary>任务记录</summary><ul>${task.history.map(h=>`<li>${escape(h)}</li>`).join('')}</ul></details>`:
        `<div class="empty atelier-empty">${ATELIER_NOTE}<p>${todayOnly?'今天没有待办。查看全部任务可以查找未来安排。':ui.employee?'当前没有符合条件的任务。分派给你的客户会显示在这里。':'当前没有符合条件的任务，可以调整筛选或去今日联系计划选客。'}</p></div>`}</section></div>`;
  }
  function reportTasks() {
    return state.tasks.filter(task=>task.status==='assigned'||task.status==='recorded');
  }
  function reportStageDetails(tasks) {
    const stage=ui.reportStage;
    const labels=Object.fromEntries(TEAM_CHART_STAGES);
    const label=stage==='unanswered'?'未回复':labels[stage];
    const rows=[...teamChartTaskGroups(tasks)[stage]];
    const dueCount=rows.filter(task=>task.result?.follow_up_on && task.result.follow_up_on<=state.calendarDate).length;
    if(stage==='unanswered')rows.sort((a,b)=>(a.result.follow_up_on||'9999').localeCompare(b.result.follow_up_on||'9999'));
    if(stage==='booked'||stage==='visited')rows.sort((a,b)=>(a.result.appointment_at||'9999').localeCompare(b.result.appointment_at||'9999'));
    return `<h3>${label}明细 · ${rows.length} 条</h3>
      ${stage==='unanswered'?`<p class="helper">${dueCount} 条已到跟进日，按跟进日期排列。</p>`:''}
      ${rows.length?`<ul class="report-stage-list">${rows.map(task=>{
        const result=task.result;
        const timing=result?.booked?`${appointmentTime(result)} · ${appointmentLabel(result)}`:
          result?.follow_up_on?`跟进 ${result.follow_up_on}${result.follow_up_on<=state.calendarDate?' · 已到跟进日':''}`:'未安排跟进时间';
        return `<li><div><strong>${escape(member(task.member_id).name)}</strong><small>${escape(task.assignee||'待交接')} · ${escape(result?.outcome||'待联系')}</small></div><div class="report-stage-timing">${escape(timing)}${result?.follow_up_note?`<small>${escape(result.follow_up_note)}</small>`:''}</div><button type="button" data-view-task="${escape(task.task_id)}" aria-label="查看 ${escape(member(task.member_id).name)} 的任务">查看任务</button></li>`;
      }).join('')}</ul>`:'<p class="muted">这个阶段暂时没有任务。</p>'}`;
  }
  function reportsPage(){
    const tasks=reportTasks();
    const results=tasks.filter(task=>task.status==='recorded');
    content.innerHTML=`<div class="growth-result-heading"><h2>分派进度</h2><p>按全部分派任务的最新结果统计。</p></div>
      ${summaryCards(taskSummary(tasks))}
      ${teamResultChart(tasks,ui.reportStage)}
      <section class="report-stage-details" id="report-stage-details" tabindex="-1" aria-label="联系进度明细">${reportStageDetails(tasks)}</section>
      <section class="team-overview"><h2 class="atelier-heading">按员工查看</h2>${table(['员工','已分派','待联系','已联系','已预约','已到店'],taskOwners(tasks).map(name=>{
        const stats=taskSummary(tasks.filter(t=>t.assignee===name));
        return `<tr><td><button data-staff-progress="${escape(name)}">${escape(name)}${STAFF.includes(name)?'':' · 历史'}</button></td><td>${stats.assigned}</td><td>${stats.pending}</td><td>${stats.contacted}</td><td>${stats.booked}</td><td>${stats.visited}</td></tr>`;
      }))}</section>
      <section class="section-spacer"><h3>沟通结果</h3>${results.length?table(['会员','负责人','沟通结果','顾客反馈'],results.map(t=>`<tr><td>${escape(member(t.member_id).name)}</td><td>${escape(t.assignee)}</td><td>${escape(t.result.outcome)}${t.result.booked?' · '+escape(appointmentLabel(t.result)):''}</td><td class="wrap">${escape(t.result.note||'—')}</td></tr>`)):'<p class="helper">员工记录沟通结果后会显示在这里。</p>'}</section>
      <section class="section-spacer"><h3>顾客反馈记录</h3>${careRecords()}</section>`;
  }
  content.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    try {
      if(button.hasAttribute('data-replay-team-chart'))replayReportChart();
      if(button.dataset.reportStage){
        ui.reportStage=button.dataset.reportStage;
        content.querySelectorAll('[data-report-stage]').forEach(control=>control.setAttribute('aria-pressed',String(control===button)));
        const details=document.getElementById('report-stage-details');
        details.innerHTML=reportStageDetails(reportTasks());
        details.focus({preventScroll:true});
        details.scrollIntoView({block:'nearest'});
      }
      if(button.dataset.taskView){ui.taskFilter=button.dataset.taskView;render();}
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
      if(button.dataset.opportunity)selectOpportunity(button);
      if(button.dataset.careQueuePage){careQueuePage=Number(button.dataset.careQueuePage);render();}
      if(button.id==='jump-dispatch')focusDispatch();
      if(button.dataset.pick){
        const id=button.dataset.pick;
        if(ui.picks.has(id))ui.picks.delete(id);
        else {
          const pick=ui.opportunity==='care'&&pendingCare.has(id)?{m:member(id),objective:'care'}
            :careRecommendations().find(({m})=>m.member_id===id);
          if(!pick)throw new Error('会员已不在当前推荐列表。');
          stagePick(pick.m,pick.objective);
        }
        refreshPicks();
      }
      if(button.dataset.removePick){
        ui.picks.delete(button.dataset.removePick);
        refreshPicks();
        document.getElementById('dispatch-queue').focus({preventScroll:true});
      }
      if(button.hasAttribute('data-apply-employee')){
        if(!assignableStaff().includes(ui.bulkEmployee))throw new Error('请先选择批量分派的员工。');
        ui.picks.forEach(pick=>{pick.assignee=ui.bulkEmployee});
        refreshPicks();
        content.querySelector('[data-apply-employee]').focus({preventScroll:true});
      }
      if(button.dataset.taskStudio&&ui.employee){
        const task=visibleTasks().find(task=>task.task_id===button.dataset.taskStudio);
        if(task)openWorkbench(task.member_id,task.objective);
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
      if(button.hasAttribute('data-copy-task'))copyMessage(document.getElementById('task-message')).catch(error=>notify(error.message,true));
    } catch(error){notify(error.message,true)}
  });
  function render() {
    const opportunityScroll=content.querySelector('.opportunity-scroll')?.scrollLeft||0;
    closeChoicePopover();
    cleanupReportChart();
    careRowObserver?.disconnect();
    careRowObserver=null;
    if(USER.role==='guest') { renderSignedOut(); return; }
    ({dashboard,members:membersPage,campaigns:campaignsPage,reports:reportsPage,products:productsPage,studio:studioPage,accounts:accountsPage})[ui.page]();
    const scroll=content.querySelector('.opportunity-scroll');
    if(scroll)scroll.scrollLeft=opportunityScroll;
    if(ui.page==='reports')mountReportChart();
    setupChoiceFields(content);
    setupGlassControls(content);
    updateChrome();
    if(serverMode) {
      const url=new URL(location.href);
      if(ui.page===homePage())url.searchParams.delete('view');
      else url.searchParams.set('view',ui.page);
      if(url.href!==location.href)history.replaceState(null,'',url);
    }
    animatePageChange();
  }
  async function reassignTask(id,data){
    const previous=state.tasks.find(t=>t.task_id===id)?.assignee;
    const assignee=data.get('assignee');
    await apiAction('reassign',{id,previous,assignee});
    ui.employeeFilter='';
    render();
    notify(`已改派给 ${assignee}。`);
  }
  async function saveTaskResult(id,data){
    const {expectedRevision,...fields}=Object.fromEntries(data);
    await apiAction('result',{id,...fields,expectedRevision:Number(expectedRevision)});
    delete ui.taskDrafts[id];
    const task=state.tasks.find(item=>item.task_id===id);
    if(ui.taskFilter!=='今日待办'||!todoReasons(task).length)ui.taskFilter='全部';
    render();
    notify('最新联系结果已保存，历史反馈保留，联系进度已同步更新。');
  }
  function accountsPage(){
    const team=STAFF;
    const accounts=new Map(state.accounts.map(account=>[account.employee,account]));
    const columns=serverMode?['员工','账号','登录状态','操作']:['员工','账号'];
    const rows=team.map(name=>{
      const account=accounts.get(name);
      const cells=`<td>${escape(name)}</td><td>${escape(account?.username||'待开通')}</td>`;
      if(!serverMode)return `<tr>${cells}</tr>`;
      const remove=account?.loginEnabled?`<button type="button" class="account-delete" data-delete-employee="${escape(name)}" aria-label="删除 ${escape(name)} 的账号">删除账号</button>`:'';
      return `<tr>${cells}<td>${account?.loginEnabled?'已开通':'待设密码'}</td><td>${remove}</td></tr>`;
    });
    content.innerHTML=`<section class="team-overview"><h2 class="atelier-heading">员工登录账号</h2><p class="muted">${serverMode?'选择现有员工设置或重设密码，也可以新增员工。':'可以添加演示员工或修改演示账号名。请使用虚构信息。'}</p>
      ${table(columns,rows)}
      <form class="form-panel account-form" id="employee-account-form">
        <div class="field"><label for="account-employee">选择员工</label><select id="account-employee" name="employee"><option value="">新增员工</option>${options(team,'')}</select></div>
        <div class="field" id="account-new-name-field"><label for="account-new-name">新员工姓名</label><input id="account-new-name" name="newEmployee" maxlength="30" autocomplete="off"></div>
        <div class="field"><label for="account-username">${serverMode?'登录账号':'演示账号'}</label><input id="account-username" name="username" required minlength="3" maxlength="32" autocomplete="off" placeholder="例如 staff01"></div>
        ${serverMode?'<div class="field"><label for="account-password">新密码</label><input id="account-password" name="password" type="password" minlength="10" maxlength="128" autocomplete="new-password" required></div>':''}
        <p class="helper">账号使用字母、数字、点、下划线或连字符。${serverMode?'密码至少 10 位，重设密码后员工需要重新登录。':''}</p>
        <button type="submit" class="primary">保存员工账号</button>
      </form></section>`;
  }
  function confirmEmployeeDeletion(employee) {
    const account=state.accounts.find(item=>item.employee===employee&&item.loginEnabled);
    if(!account)return;
    const pending=state.tasks.filter(task=>task.assignee===employee&&teamTaskNeedsHandoff(task));
    const recipients=assignableStaff().filter(name=>name!==employee);
    const dialog=document.createElement('dialog');
    dialog.className='member-dialog employee-delete-dialog';
    dialog.setAttribute('aria-labelledby','employee-delete-title');
    dialog.innerHTML=`<h2 id="employee-delete-title">删除 ${escape(employee)} 的账号</h2>
      <p>${escape(employee)} 将从员工账号列表移除，账号 ${escape(account.username)} 将无法登录。客户档案里的偏好技师和历史反馈会保留。</p>
      <form>
        ${pending.length?`<div class="field"><label for="employee-handoff">${pending.length} 项未完成任务的交接方式</label>
          <select name="replacement" id="employee-handoff"><option value="">暂留待交接</option>${options(recipients,'')}</select></div>
          <p class="helper">选择暂留待交接后，可在「联系任务 → 待交接」重新分派。</p>`:''}
        <p class="eligibility blocked" role="alert" hidden></p>
        <div class="button-row"><button type="button" data-cancel-deletion autofocus>取消</button><button type="submit" class="primary">确认删除</button></div>
      </form>`;
    const form=dialog.querySelector('form');
    const cancel=dialog.querySelector('[data-cancel-deletion]');
    const submit=form.querySelector('[type=submit]');
    cancel.addEventListener('click',()=>dialog.close());
    dialog.addEventListener('cancel',event=>{if(cancel.disabled)event.preventDefault();});
    dialog.addEventListener('close',()=>dialog.remove(),{once:true});
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      if(submit.disabled)return;
      const replacement=new FormData(form).get('replacement');
      const errorMessage=form.querySelector('[role=alert]');
      errorMessage.hidden=true;
      submit.disabled=cancel.disabled=true;
      try {
        const result=await apiAction('deleteEmployeeAccount',{employee,username:account.username,replacement});
        dialog.close();
        render();
        const count=result.taskIds.length;
        notify(`${employee} 的登录账号已删除。${count?`${count} 项未完成任务${replacement?'已转交':'已移入待交接'}。`:''}`);
      } catch(error) {
        errorMessage.textContent=error.message;
        errorMessage.hidden=false;
      } finally { submit.disabled=cancel.disabled=false; }
    });
    document.body.append(dialog);
    dialog.showModal();
  }
  function flipCard(id, flipped) {
    ui.flips[id]=flipped;
    const hanger=content.querySelector(`[data-member="${id}"].hanger`);
    if(!hanger) return;
    hanger.querySelector('.card').classList.toggle('flipped',flipped);
    const front=hanger.querySelector('.front'), back=hanger.querySelector('.back');
    front.inert=flipped;back.inert=!flipped;
    front.setAttribute('aria-hidden',String(flipped));back.setAttribute('aria-hidden',String(!flipped));
    hanger.querySelector('[data-flip]').setAttribute('aria-expanded',String(flipped));
    hanger.querySelector(flipped ? '[data-unflip]' : '[data-flip]').focus({preventScroll:true});
  }
  const hoverMotion=matchMedia('(any-hover: hover) and (any-pointer: fine) and (prefers-reduced-motion: no-preference)');
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  const dock=document.querySelector('.atelier-dock');
  let lastRenderedPage, pageMotion, careRowObserver;

  function setupCareRow() {
    const wall=content.querySelector('.care-wall-single-row');
    if(!wall) return;
    const arrows=content.querySelector('.care-row-arrows');
    const [left,right]=arrows.querySelectorAll('button');
    const label=content.querySelector('.care-row-label');
    const count=wall.childElementCount;

    function updateArrows() {
      const remaining=wall.scrollWidth-wall.clientWidth;
      const hideArrows=remaining<=1;
      if(arrows.hidden!==hideArrows) {
        arrows.hidden=hideArrows;
        label.textContent=`${count} 张便签 · 挑选今天联系的顾客${hideArrows?'':' · 左右滑动查看'}`;
      }
      left.disabled=wall.scrollLeft<=1;
      right.disabled=wall.scrollLeft>=remaining-1;
    }
    function moveRow(direction) {
      const [first,second]=wall.children;
      const step=second ? second.offsetLeft-first.offsetLeft : wall.clientWidth;
      wall.scrollBy({left:direction*step,behavior:reducedMotion.matches?'auto':'smooth'});
      updateArrows();
    }
    left.addEventListener('click',() => moveRow(-1));
    right.addEventListener('click',() => moveRow(1));
    wall.addEventListener('scroll',updateArrows,{passive:true});
    careRowObserver=new ResizeObserver(updateArrows);
    careRowObserver.observe(wall);
    updateArrows();
  }

  function animatePageChange() {
    if(lastRenderedPage && lastRenderedPage!==ui.page) {
      pageMotion?.cancel();
      if(!reducedMotion.matches && typeof content.animate==='function') {
        pageMotion=content.animate(
          [{opacity:.55, transform:'translateY(6px)'}, {opacity:1, transform:'translateY(0)'}],
          {duration:210, easing:'cubic-bezier(.2,.65,.25,1)'}
        );
      }
    }
    lastRenderedPage=ui.page;
  }

  function syncDockHover(event) {
    dock.toggleAttribute('data-hover',event.pointerType==='mouse'||event.pointerType==='pen');
  }
  dock.addEventListener('pointerenter',syncDockHover);
  dock.addEventListener('pointermove',syncDockHover);
  dock.addEventListener('pointerleave',() => dock.removeAttribute('data-hover'));
  dock.addEventListener('pointercancel',() => dock.removeAttribute('data-hover'));

  function setupGlass(root) {
    root.querySelectorAll('.glass-track').forEach(track => {
      bindGlass(track,track.querySelector('.glass-tilt'),2.6);
    });
  }

  const choicePopover=document.getElementById('choice-popover');
  if(typeof choicePopover.showPopover==='function')choicePopover.hidden=false;
  const choiceOptions=document.getElementById('choice-options');
  const choiceSearch=choicePopover.querySelector('.choice-search');
  const choiceEmpty=choicePopover.querySelector('.choice-empty');
  const choiceFields=new WeakMap();
  const taskChoiceTones={'全部':'all','待联系':'pending','已记录':'executed','已归档':'rejected','历史模拟记录':'executed'};
  const objectiveChoiceHints={
    repurchase:'询问是否想换款或预约',
    balance:'提醒店内可用余额',
    new_product:'分享符合她偏好的新款',
    care:`最近一次美甲后第 ${TEAM_CARE_FOLLOWUP_DAY} 天提醒`,
    preview:'分享快要上架、顾客可能喜欢的款式',
    greeting:'聊近况，维护日常关系'
  };
  let openChoice=null;

  function setupChoiceFields(root) {
    if(typeof choicePopover.showPopover!=='function')return;
    root.querySelectorAll('select:not(.choice-native)').forEach(select=>{
      const label=select.labels[0];
      const name=select.getAttribute('aria-label')||label?.textContent.trim()||'选择选项';
      if(!select.id)select.id=`choice-${select.name}`;
      const trigger=document.createElement('button');
      trigger.type='button';
      trigger.id=`${select.id}-picker`;
      trigger.className='choice-trigger';
      trigger.setAttribute('aria-haspopup','listbox');
      trigger.setAttribute('aria-controls','choice-options');
      trigger.setAttribute('aria-expanded','false');
      trigger.innerHTML='<span class="choice-trigger-value"></span><span class="choice-chevron" aria-hidden="true"></span>';
      function syncTrigger() {
        const text=select.selectedOptions[0]?.text||'暂无可选项';
        trigger.querySelector('.choice-trigger-value').textContent=text;
        trigger.setAttribute('aria-label',`${name} ${text}`);
        trigger.disabled=select.disabled||!select.options.length;
      }
      syncTrigger();
      select.addEventListener('change',syncTrigger);
      if(label)label.htmlFor=trigger.id;
      choiceFields.set(trigger,{select,name});
      select.classList.add('choice-native');
      select.hidden=true;
      select.after(trigger);
    });
  }

  function positionChoicePopover() {
    if(!openChoice)return;
    const {trigger,select}=openChoice;
    const rect=trigger.getBoundingClientRect();
    const margin=8,gap=6;
    if(!trigger.isConnected||rect.bottom<=0||rect.top>=innerHeight){closeChoicePopover();return}
    const minWidth=select.id==='care-limit'?90:select.id==='objective'||!choiceSearch.hidden?270:150;
    const width=Math.min(innerWidth-2*margin,Math.max(rect.width,minWidth));
    choicePopover.style.width=`${width}px`;
    choicePopover.style.left=`${Math.min(Math.max(margin,rect.left),innerWidth-margin-width)}px`;
    const above=rect.top-gap-margin,below=innerHeight-rect.bottom-gap-margin;
    const desired=Math.min(370,choiceOptions.scrollHeight+(choiceSearch.hidden?0:choiceSearch.offsetHeight+5)+12);
    const opensUp=below<desired&&above>below;
    choicePopover.style.maxHeight=`${Math.max(0,Math.min(370,opensUp?above:below))}px`;
    choicePopover.style.top=`${opensUp?rect.top-gap-choicePopover.offsetHeight:rect.bottom+gap}px`;
  }

  function showChoicePopover(trigger) {
    if(openChoice?.trigger===trigger){closeChoicePopover();return}
    closeChoicePopover();
    const {select,name}=choiceFields.get(trigger);
    const options=[...select.options];
    choiceOptions.setAttribute('aria-label',name);
    choiceSearch.hidden=options.length<=30;
    choiceSearch.value='';
    choiceEmpty.hidden=true;
    choiceOptions.innerHTML=options.map((option,index)=>{
      const hint=select.id==='objective'?objectiveChoiceHints[option.value]:'';
      const tone=select.id==='task-filter'?taskChoiceTones[option.value]:'';
      return `<button type="button" class="choice-option" role="option" tabindex="-1" data-choice-index="${index}" aria-selected="${option.selected}" ${option.disabled?'disabled':''}>
        ${tone?`<span class="choice-dot choice-dot-${tone}" aria-hidden="true"></span>`:''}<span class="choice-copy"><strong>${escape(option.text)}</strong>${hint?`<small>${escape(hint)}</small>`:''}</span><span class="choice-check" aria-hidden="true">✓</span>
      </button>`;
    }).join('');
    openChoice={trigger,select};
    trigger.setAttribute('aria-expanded','true');
    choicePopover.showPopover();
    choiceOptions.scrollTop=0;
    positionChoicePopover();
    const first=choiceOptions.querySelector('[aria-selected=true]:not(:disabled)')||choiceOptions.querySelector('button:not(:disabled)');
    if(!choiceSearch.hidden)choiceSearch.focus({preventScroll:true});
    else first?.focus({preventScroll:true});
    first?.scrollIntoView({block:'nearest'});
  }

  function closeChoicePopover(restoreFocus=false) {
    if(!openChoice)return;
    const {trigger}=openChoice;
    openChoice=null;
    trigger.setAttribute('aria-expanded','false');
    if(choicePopover.matches(':popover-open'))choicePopover.hidePopover();
    if(restoreFocus)trigger.focus({preventScroll:true});
  }

  function chooseOption(button) {
    if(!openChoice||button.disabled)return;
    const {select,trigger}=openChoice;
    const index=Number(button.dataset.choiceIndex);
    closeChoicePopover();
    if(index!==select.selectedIndex) {
      select.selectedIndex=index;
      select.dispatchEvent(new Event('change',{bubbles:true}));
    }
    document.getElementById(trigger.id)?.focus({preventScroll:true});
  }

  choicePopover.addEventListener('toggle',event=>{
    if(event.newState==='closed'&&!choicePopover.matches(':popover-open'))closeChoicePopover();
  });
  choicePopover.addEventListener('click',event=>{
    const option=event.target.closest('[data-choice-index]');
    if(option)chooseOption(option);
  });
  choiceSearch.addEventListener('input',()=>{
    const query=choiceSearch.value.trim().toLocaleLowerCase();
    let matches=0;
    for(const button of choiceOptions.children) {
      const match=button.querySelector('strong').textContent.toLocaleLowerCase().includes(query);
      button.hidden=!match;
      if(match)matches++;
    }
    choiceEmpty.hidden=matches>0;
    choiceOptions.scrollTop=0;
    positionChoicePopover();
  });
  choicePopover.addEventListener('keydown',event=>{
    if(event.key==='Escape'||event.key==='Tab') {
      closeChoicePopover(true);
      if(event.key==='Escape')event.preventDefault();
      return;
    }
    const searching=event.target===choiceSearch;
    if(!['ArrowUp','ArrowDown','Home','End'].includes(event.key) && !(searching&&event.key==='Enter'))return;
    if(searching&&['Home','End'].includes(event.key))return;
    const options=[...choiceOptions.querySelectorAll('button:not([hidden]):not(:disabled)')];
    if(!options.length)return;
    event.preventDefault();
    const index=options.indexOf(event.target);
    if(searching&&event.key==='Enter'){chooseOption(options[0]);return}
    const last=options.length-1;
    const next=event.key==='Home'?0:event.key==='End'?last:
      event.key==='ArrowDown'?(index+1)%options.length:(index<=0?last:index-1);
    options[next].focus();
  });
  choiceOptions.addEventListener('pointermove',event=>{
    if(!hoverMotion.matches||event.pointerType==='touch')return;
    const button=event.target.closest('.choice-option');
    if(!button)return;
    const rect=button.getBoundingClientRect();
    button.style.setProperty('--choice-x',`${event.clientX-rect.left}px`);
    button.style.setProperty('--choice-y',`${event.clientY-rect.top}px`);
  });
  window.addEventListener('resize',positionChoicePopover);
  document.addEventListener('scroll',event=>{
    if(!choicePopover.contains(event.target))positionChoicePopover();
  },true);

  function setupGlassControls(root) {
    const selectors='.atelier-dock button,.care-row-arrows button,.growth-opportunity-tabs button,[data-flip],[data-unflip],#care-wall [data-pick],summary,.choice-trigger';
    root.querySelectorAll(selectors).forEach(control => {
      if(control.classList.contains('glass-control'))return;
      const face=document.createElement('span');
      face.className='glass-control-face glass-surface glass-tilt';
      face.setAttribute('aria-hidden','true');
      const icon=control.querySelector('.dock-icon');
      if(icon)face.append(icon);
      control.classList.add('glass-control');
      control.prepend(face);
      bindGlass(control,face,control.closest('.glass-track')?1.3:3.6);
    });
  }

  function bindGlass(track,surface,maxAngle) {
    let frame=null, pointer;
    function resetGlass() {
      if(frame!==null)cancelAnimationFrame(frame);
      frame=null;
      track.classList.remove('is-lit');
      surface.style.removeProperty('--glass-turn');
    }
    function moveGlass(event) {
      if(!hoverMotion.matches || event.pointerType==='touch' || document.hidden) return;
      pointer={x:event.clientX,y:event.clientY};
      if(frame!==null)return;
      frame=requestAnimationFrame(() => {
        frame=null;
        if(!track.isConnected || !hoverMotion.matches)return;
        if(track.matches(':disabled')){resetGlass();return}
        // Measure the stationary track so the tilt cannot move the pointer's origin.
        const bounds=track.getBoundingClientRect(), height=surface.offsetHeight;
        if(!bounds.width || !height)return;
        const x=Math.min(1,Math.max(0,(pointer.x-bounds.left)/bounds.width));
        const y=Math.min(1,Math.max(0,1+(pointer.y-bounds.bottom)/height));
        const dx=x*2-1, dy=y*2-1, distance=Math.hypot(dx,dy);
        const angle=Math.min(1,distance)*maxAngle;
        surface.style.setProperty('--glass-x',`${x*100}%`);
        surface.style.setProperty('--glass-y',`${y*100}%`);
        surface.style.setProperty('--glass-mirror-x',`${(1-x)*100}%`);
        surface.style.setProperty('--glass-turn',distance
          ? `rotate3d(${-dy/distance}, ${dx/distance}, 0, ${angle}deg)`
          : 'none');
        track.classList.add('is-lit');
      });
    }
    track.addEventListener('pointerenter',moveGlass);
    track.addEventListener('pointermove',moveGlass);
    track.addEventListener('pointerleave',resetGlass);
    track.addEventListener('pointercancel',resetGlass);
  }
  function showPage(page){
    document.getElementById('account-menu').open=false;
    ui.page=allowedPage(pageNames.includes(page)?page:homePage());
    document.getElementById('notice').hidden=true;
    render();
    document.getElementById('main').focus({preventScroll:true});
    window.scrollTo(0,0);
  }
  function saveIdentity() {
    try { sessionStorage.setItem(sessionKey,JSON.stringify(USER)); } catch {}
  }
  function resetIdentityDrafts(employee) {
    Object.assign(ui,{employee,task:null,taskFilter:employee?'今日待办':'全部',employeeFilter:'',reportStage:'booked',taskDrafts:{},noteDrafts:{},employeeNoteDrafts:{},editNote:null,composer:null,flips:{},bulkEmployee:''});
    ui.picks.clear();
    for(const key of Object.keys(workbenchDrafts))delete workbenchDrafts[key];
    Object.assign(ui.workbench,{member_id:employee?null:'M0001',objective:'repurchase',tone:'friendly',product_id:'',draft:'',loadedKey:null,revision:0});
    document.getElementById('logs').replaceChildren();
  }
  function renderSignedOut() {
    document.getElementById('account-menu').hidden=true;
    document.getElementById('signed-out-label').hidden=false;
    document.querySelector('.atelier-dock').hidden=true;
    document.querySelector('footer').hidden=true;
    document.getElementById('page-title').textContent='欢迎回到 NailMate';
    document.getElementById('page-motto').textContent=serverMode?'使用门店账号进入工作台。':'选择门店身份，继续今天的联系计划。';
    document.getElementById('page-index').textContent='工作空间';
    document.getElementById('edition-name').textContent='THE STUDIO';
    if(serverMode) {
      const setup=authInfo.setupRequired;
      const heading=setup?'创建老板娘账号':'登录工作台';
      content.innerHTML=`<section class="login-panel" aria-label="登录工作台"><h2>${heading}</h2>${setup?'<p class="muted">首次使用请设置老板娘的登录账号，之后可在员工账号管理中设置员工密码。</p>':''}
        <form id="identity-login-form">
          <div class="field"><label for="login-username">账号</label><input id="login-username" name="username" maxlength="32" autocomplete="username" required></div>
          <div class="field"><label for="login-password">密码${setup?'（至少 10 位）':''}</label><input id="login-password" name="password" type="password" minlength="${setup?10:1}" maxlength="128" autocomplete="${setup?'new-password':'current-password'}" required></div>
          <button type="submit" class="primary">${setup?'创建并登录':'登录'}</button>
        </form></section>`;
    } else {
      content.innerHTML=`<section class="login-panel" aria-label="登录工作台"><h2>进入工作台</h2><form id="identity-login-form"><label for="login-role">选择身份</label><select id="login-role"><option value="">老板娘</option>${sharedAccounts.map(account=>`<option value="${escape(account.employee)}">员工 · ${escape(account.employee)}</option>`).join('')}</select><button type="submit" class="primary">进入工作台</button></form><p class="helper">分享预览通过选择身份进入。</p></section>`;
    }
  }
  async function switchIdentity(employee) {
    if(serverMode)return;
    PREVIEW_ROLE.disabled=true;
    const previous={...USER},revision=++identityRevision;
    Object.assign(USER,{employee,role:employee?'employee':'owner'});
    try {
      const shared=previewState(USER);
      if(revision!==identityRevision)return;
      resetIdentityDrafts(employee);
      applyState(shared);
      saveIdentity();
      showPage(homePage());
      document.getElementById('main').focus({preventScroll:true});
    } catch(error) {
      if(revision!==identityRevision)return;
      Object.assign(USER,previous); ui.employee=previous.employee;
      PREVIEW_ROLE.value=previous.employee;
      render(); notify(error.message,true);
    } finally { PREVIEW_ROLE.disabled=false; }
  }
  async function logout() {
    if(serverMode) {
      try {
        const response=await fetch('/api/team/auth/logout',{method:'POST',headers:identityHeader});
        if(response.ok||response.status===401)location.reload();
        else throw new Error('退出失败，请重试。');
      } catch(error) { notify(error.message,true); }
      return;
    }
    identityRevision++;
    Object.assign(USER,{role:'guest',employee:''});
    saveIdentity();
    resetIdentityDrafts('');
    state=emptyState();
    document.getElementById('account-menu').open=false;
    document.getElementById('notice').hidden=true;
    document.querySelectorAll('.member-dialog').forEach(dialog=>dialog.remove());
    render();
    window.scrollTo(0,0);
    document.getElementById('login-role').focus({preventScroll:true});
  }
  PREVIEW_ROLE.addEventListener('change',()=>switchIdentity(PREVIEW_ROLE.value));
  document.getElementById('logout-button').addEventListener('click',logout);
  content.addEventListener('submit',async event=>{
    if(event.target.id!=='identity-login-form')return;
    event.preventDefault();
    const button=event.submitter;
    if(button?.disabled)return;
    if(button)button.disabled=true;
    try {
      if(!serverMode) {
        await switchIdentity(document.getElementById('login-role').value);
        return;
      }
      const action=authInfo.setupRequired?'setup':'login';
      const response=await fetch(`/api/team/auth/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(event.target)))});
      if(response.ok||response.status===409)location.reload();
      else throw new Error((await response.json()).error||'登录失败，请重试。');
    } catch(error) { notify(error.message,true); }
    finally { if(button?.isConnected)button.disabled=false; }
  });
  let synchronizing=false;
  function editingPage() {
    return openChoice || document.querySelector('dialog[open]')
      || document.activeElement?.matches('input,textarea,select,[contenteditable="true"]')
      || content.querySelector('#employee-account-form[data-dirty]');
  }
  async function refreshShared(force=false) {
    if(USER.role==='guest'||(!force&&(synchronizing||pendingWrites||document.hidden||editingPage())))return;
    if(!serverMode) { applyState(previewState(USER)); render(); return; }
    synchronizing=true;
    try {
      const update=await requestState('state',force?{}:{revision:state.revision,calendarDate:state.calendarDate});
      if(!update||(!force&&(pendingWrites||editingPage()))||!applyState(update.state,update.snapshot))return;
      if(force) {
        for(const task of state.tasks) {
          const draft=ui.taskDrafts[task.task_id];
          if(draft?.expectedRevision!==undefined&&Number(draft.expectedRevision)!==(task.result_revision||0))
            delete ui.taskDrafts[task.task_id];
          const noteDraft=ui.employeeNoteDrafts[task.task_id];
          if(noteDraft?.noteId&&noteDraft.expectedRevision!==(state.noteEdits[noteDraft.noteId]?.revision||0))
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
      if(choiceFields.has(button)) {
        showChoicePopover(button);
      } else if(button.dataset.deleteEmployee&&USER.role==='owner'&&serverMode) {
        confirmEmployeeDeletion(button.dataset.deleteEmployee);
      } else if(button.dataset.page) {
        if(button.dataset.page==='campaigns'){ui.employeeFilter='';ui.taskFilter=ui.employee?'今日待办':'全部'}
        showPage(button.dataset.page);
      } else if(button.dataset.flip) flipCard(button.dataset.flip,true);
      else if(button.dataset.unflip) flipCard(button.dataset.unflip,false);
      else if(button.dataset.memberDetail) {selectProfile(button.dataset.memberDetail);memberResults();document.getElementById('member-detail').scrollIntoView({block:'start'});}
      else if(button.dataset.task) {ui.task=button.dataset.task;render();}
    } catch(error) {notify(error.message,true);}
  });
  content.addEventListener('change',event => {
    const target=event.target;
    if(target.id==='task-outcome'){
      const form=target.form;
      form.querySelector('[data-appointment-fields]').hidden=target.value!=='已预约';
      form.querySelector('[data-follow-up-fields]').hidden=target.value==='不再营销';
    }
    if(target.id==='care-limit') {ui.limit=Number(target.value);render();}
    if(target.id==='member-lifecycle') {ui.lifecycle=target.value;ui.memberPage=1;memberResults();}
    if(target.id==='member-tag') {ui.tag=target.value;ui.memberPage=1;memberResults();}
    if(target.id==='task-filter') {ui.taskFilter=target.value;render();}
    if(target.id==='employee-filter') {ui.employeeFilter=target.value;render();}
    if(target.id==='account-employee'){
      document.getElementById('account-new-name-field').hidden=Boolean(target.value);
      document.getElementById('account-new-name').value='';
      document.getElementById('account-username').value=state.accounts.find(account=>account.employee===target.value)?.username||'';
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
    if(event.target.id==='member-query') {ui.query=event.target.value;ui.memberPage=1;memberResults();}
    const accountForm=event.target.closest('#employee-account-form');
    if(accountForm)accountForm.dataset.dirty='true';
    rememberDraft(event.target);
  });
  content.addEventListener('submit',async event=>{
    const form=event.target,id=form.dataset.task;
    if(!['dispatch-form','reassign-form','task-result-form','employee-account-form','employee-note-form'].includes(form.id))return;
    event.preventDefault();
    const data=new FormData(form),button=event.submitter;
    if(button?.disabled)return;
    if(button)button.disabled=true;
    try{
      if(form.id==='dispatch-form')await assignSelected();
      if(form.id==='reassign-form')await reassignTask(id,data);
      if(form.id==='task-result-form')await saveTaskResult(id,data);
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
  setupGlassControls(dock);
  setupGlassControls(document.querySelector('footer'));
  render();
  if(serverMode&&USER.role!=='guest') {
    const sync=()=>refreshShared().catch(()=>{});
    setInterval(sync,5000);
    document.addEventListener('visibilitychange',sync);
    window.addEventListener('pageshow',event=>{if(event.persisted)sync();});
  }
})().catch(error => {
  const notice=document.getElementById('notice');
  notice.hidden=false; notice.className='error'; notice.textContent=error.message;
});

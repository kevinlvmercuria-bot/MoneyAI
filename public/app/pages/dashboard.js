'use strict';

// app 提供共享状态的实时访问和跨页面操作；本模块保留自己的事件与局部状态。
(globalThis.NailMateApp ||= {}).createDashboard = function (app) {
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
  app.ui.opportunity='all';

  function activeTask(id){return app.state.tasks.find(t=>t.member_id===id&&t.status==='assigned')}
  function isNoProductObjective(objective){return objective==='greeting'}
  function offerProduct(id){return app.memberProductIndex.get(id)||app.CATALOG_IDEAS.find(p=>p.product_id===id)}
  function offerLabel(p){return p.planned||p.launch_date>app.WORK_DATE?`演示预告 · ${p.launch_date||'日期待确认'}`:app.money(p.price).replace('.00','')}
  function matchingPreviews(m) {
    if(m.lifecycle!=='active')return [];
    const styles=m.preferred_styles.split('|');
    return [...app.CATALOG_IDEAS,...app.DATA.products]
      .filter(p=>p.product_type==='nail_style'&&p.launch_date>app.WORK_DATE&&app.daysBetween(p.launch_date,app.WORK_DATE)<=14
        &&(p.preview_styles||[p.style]).some(style=>styles.includes(style)))
      .sort((a,b)=>a.launch_date.localeCompare(b.launch_date)||a.product_id.localeCompare(b.product_id));
  }
  function matchesOpportunity(m,key){
    if(key==='repurchase')return ['due','low_frequency','dormant'].includes(m.lifecycle);
    if(key==='balance')return m.ratio>1.15&&m.balance>0;
    if(key==='care')return Boolean(app.memberCareIndex.get(m.member_id)?.care_followup_opt_in&&app.careReady(m));
    if(key==='preview')return matchingPreviews(m).length>0;
    if(key==='greeting')return m.lifecycle==='active'&&m.visit_count>=2&&(!m.last_contact_date||app.daysBetween(app.WORK_DATE,m.last_contact_date)>=30);
    return false;
  }
  function opportunityGroups() {
    const groups=Object.fromEntries(OPPORTUNITY_PRIORITY.map(key=>[key,[]]));
    const queued=new Set(app.state.tasks.filter(t=>t.status==='assigned').map(t=>t.member_id));
    for(const m of app.state.members) {
      if(m.last_handled_on===app.WORK_DATE||queued.has(m.member_id))continue;
      for(const key of OPPORTUNITY_PRIORITY)if(matchesOpportunity(m,key)&&!app.memberBlockers(m,key).length)groups[key].push(m);
    }
    return groups;
  }
  function sortOpportunity(members,objective){
    return [...members].sort((a,b)=>{
      let rank;
      if(objective==='preview')rank=matchingPreviews(a)[0].launch_date.localeCompare(matchingPreviews(b)[0].launch_date)||a.days-b.days;
      else if(objective==='greeting')rank=(a.last_contact_date||'').localeCompare(b.last_contact_date||'')||b.visit_count-a.visit_count;
      else if(objective==='care')rank=app.careFollowupVisit(a).days-app.careFollowupVisit(b).days;
      else rank=b.priority_score-a.priority_score||Math.min(b.ratio,4)-Math.min(a.ratio,4);
      return rank||a.member_id.localeCompare(b.member_id);
    });
  }
  function careRecommendations(groups=opportunityGroups()){
    const selected=app.ui.opportunity;
    if(selected!=='all')return sortOpportunity(groups[selected],selected).slice(0,app.ui.limit).map(m=>({m,objective:selected}));
    const seen=new Set();
    const queues=OPPORTUNITY_PRIORITY.map(objective=>sortOpportunity(groups[objective],objective).filter(m=>{
      if(seen.has(m.member_id))return false;
      seen.add(m.member_id);return true;
    }).map(m=>({m,objective})));
    const picks=[];
    for(let offset=0;offset<app.ui.limit;offset++) {
      for(const queue of queues) {
        if(queue[offset])picks.push(queue[offset]);
        if(picks.length===app.ui.limit)return picks;
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
    if(objective==='balance')return `已有 ${app.money(m.balance).replace('.00','')} 可用余额。${m.days===null?'':m.days+' 天未到店。'}先提醒已有权益，再询问是否想换款。`;
    if(objective==='care'){
      const visit=app.careFollowupVisit(m);
      if(!visit)return '暂无美甲服务记录。';
      const advice=visit.phase ? opportunityAction(m,'care',p,visit.phase) : '当前不在服务完成后第 7–45 天的回访窗口。';
      return `${visit.date} 做了「${visit.name}」，已过 ${visit.days} 天。${advice}`;
    }
    if(m.days===null)return '最近到店日期待确认。';
    if(m.ratio===null)return `${m.days} 天未到店，个人复购周期待确认。`;
    return `${m.days} 天未到店，个人周期 ${m.cycle} 天，已到 ${m.ratio} 倍。${m.cycle_confidence==='low'?'历史较少，周期仅供参考。':'先了解近期需求，不推测未到店原因。'}`;
  }
  function opportunityProduct(m,objective){return app.workbenchProducts(m,objective)[0]}
  function opportunityAction(m,objective,p,carePhase){
    if(objective==='scheduled')return '历史回访计划';
    if(objective==='greeting')return '发一句亲切问候，听听近况';
    if(objective==='preview')return p?`分享「${p.product_name}」预告`:'先确认想看的款式';
    if(objective==='balance')return '可用余额 '+app.money(m.balance).replace('.00','');
    if(objective==='care')return (carePhase??app.careFollowupVisit(m)?.phase)==='removal'
      ? '先确认是否已经卸甲，仍在佩戴时再询问是否需要预约卸甲。'
      : '先询问佩戴体验和甲周状态，再按需要给出护理建议。';
    return '推荐 '+(p?.product_name||'先了解需求');
  }
  function taskContactBlockers(task) {
    const m=app.member(task.member_id),rows=app.memberBlockers(m,task.objective,task.task_id?task:undefined);
    if(task.objective==='preview'&&!matchingPreviews(m).some(p=>p.product_id===task.product_id))rows.push('所选款式已超出预告窗口或偏好已变化');
    return rows;
  }
  function careCards(rows){
    const title=app.ui.opportunity==='all'?'今日优先联系':OPPORTUNITIES[app.ui.opportunity].label+'优先名单';
    const rowTools=`<div class="care-row-tools"><span class="care-row-label">${rows.length} 张便签 · 挑选今天联系的顾客</span><div class="care-row-arrows" hidden><button type="button" aria-label="向左查看便签" aria-controls="care-wall">←</button><button type="button" aria-label="向右查看便签" aria-controls="care-wall">→</button></div></div>`;
    return `${rowTools}<div id="care-wall" class="care-wall-single-row" style="--care-count:${rows.length}" role="region" tabindex="0" aria-label="${app.escape(title)}，可横向滚动">${rows.map(({m,objective,reminder})=>{
      const p=opportunityProduct(m,objective),flipped=Boolean(app.ui.flips[m.member_id]),note=app.profileNotes(m.member_id)[0];
      const visit=objective==='care'?app.careFollowupVisit(m):null;
      const action=opportunityAction(m,objective,p);
      const cardAction=reminder?(visit?.phase==='removal'?'先确认是否已卸甲':'先了解佩戴和甲周状态'):action;
      const contextual=isNoProductObjective(objective)||objective==='preview';
      const timing=objective==='preview'?(p?offerLabel(p):'日期待确认'):(m.last_contact_date?`上次联系 ${m.last_contact_date}`:'有多次到店记录');
      const selected=app.ui.picks.has(m.member_id),reasons=reminder?careReminderBlockers(m):[];
      const blocked=reasons.length>0;
      const pickButton=`<button class="primary" data-pick="${m.member_id}" aria-pressed="${selected}" ${blocked?'data-pick-blocked':''} ${blocked&&!selected?'disabled':''}><span class="pick-label">${selected?'已选 · 移除':blocked?'暂不可分派':'加入清单'}</span></button>`;
      const goal=objective==='care'?app.careActionLabel(visit?.phase):app.WB_OBJECTIVES[objective];
      const meta=reminder?`美甲后回访${reminder.data_type==='simulation'?' · 模拟':''}`:visit?'美甲后回访':app.LABELS[m.lifecycle];
      const days=reminder?app.daysBetween(app.state.calendarDate,reminder.completed_on):visit?visit.days:m.days;
      const cycle=reminder?`美甲完成 ${app.escape(reminder.completed_on)}`:visit?`${app.escape(visit.date)} · ${app.escape(visit.name)}`
        :`个人周期 ${m.cycle} 天 · 偏离 ${m.ratio} 倍${m.cycle_confidence==='low'?'<br>历史较少 · 参考周期':''}`;
      const evidence=reminder?`美甲完成于 ${reminder.completed_on}，至今 ${days} 天。${m.last_contact_date?' 上次联系 '+m.last_contact_date+'。':''}`:opportunityEvidence(m,objective,p);
      return `<article class="hanger glass-track ${selected?'selected':''}" data-member="${m.member_id}"><div class="cord" aria-hidden="true"></div><div class="tilt glass-tilt"><div class="card ${flipped?'flipped':''}">
        <div class="face front glass-surface" ${flipped?'inert aria-hidden="true"':'aria-hidden="false"'}><div class="meta">${app.memberCode(m)} / ${meta}</div><div class="monogram" aria-hidden="true">${app.escape(m.name[0])}</div><h3>${app.escape(m.name)}</h3>${contextual?`<div class="growth-card-context"><strong>${objective==='preview'?'偏好匹配':'保持联系'}</strong><span>${app.escape(timing)}</span></div>`:`<div class="days"><b>${days}</b><span>${reminder||visit?'天前做过美甲':'天未到店'}</span></div><p class="cycle">${cycle}</p>`}<p class="growth-card-goal">${goal}</p><p class="growth-card-product">${app.escape(blocked?'联系受限 · 翻牌查看':cardAction)}</p><div class="actions"><button data-flip="${m.member_id}" aria-expanded="${flipped}" aria-label="查看 ${app.memberCode(m)} 推荐依据">查看依据 ↻</button>${pickButton}</div></div>
        <div class="face back glass-surface" ${flipped?'aria-hidden="false"':'inert aria-hidden="true"'}><div class="meta">${app.memberCode(m)} / ${goal}</div><h3>${app.escape(m.name)}</h3><h4>${reminder?'回访依据':'为什么先联系她'}</h4><p>${app.escape(evidence)}</p><h4>${blocked?'联系限制':'本次行动'}</h4><p>${app.escape(blocked?reasons.join('、'):action)}</p>${reminder?'':`<p class="quiet">${note?'参考客户备注：'+app.escape(note.note_text.slice(0,78)+(note.note_text.length>78?'…':'')):'偏好 '+app.escape(m.preference)+' · 已通过联系资格检查'}</p>`}<div class="actions">${pickButton}<button data-unflip="${m.member_id}">返回 ↶</button></div></div>
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
    if(app.ui.employee)throw new Error('只有老板娘账号可以分派任务。');
    const existing=activeTask(m.member_id);
    if(existing)throw new Error(`${m.name} 已由 ${existing.assignee} 负责。请在联系任务中改派。`);
    const reasons=app.memberBlockers(m,objective);
    if(reasons.length)throw new Error(`${m.name} 暂不可联系：${reasons.join('、')}。`);
    const previous=app.ui.picks.get(m.member_id);
    const serviceOrderId=objective==='care'?app.pendingCare.get(m.member_id)?.service_order_id:undefined;
    const pick={member_id:m.member_id,objective,service_order_id:serviceOrderId,care_action:objective==='care'?app.careFollowupVisit(m)?.phase:undefined,
      assignee:previous?.assignee??app.suggestedEmployee(m),note:previous?.note||'',...details};
    app.ui.picks.set(m.member_id,pick);
  }
  function dispatchPanel() {
    const picks=[...app.ui.picks.values()];
    if(!app.assignableStaff().length)return '<h2 class="atelier-heading">待分派清单</h2><p class="muted">请先开通至少一位员工的登录账号，再确认分派。</p><button data-page="accounts">开通员工账号</button>';
    if(!picks.length)return '<h2 class="atelier-heading">待分派清单</h2><p class="muted">从上面的推荐名单选人。切换经营机会时，清单会保留已选顾客及沟通目的。</p>';
    return `<h2 class="atelier-heading">待分派清单 · ${picks.length} 位</h2><p class="muted">默认建议最近服务过该会员的员工。可以改选负责人，也可以补充这次沟通的重点。</p>
      <form id="dispatch-form">
        <div class="dispatch-toolbar"><div class="field"><label for="bulk-employee">批量分派给</label><select id="bulk-employee">${app.employeeOptions(app.ui.bulkEmployee,'选择员工',true)}</select></div><button type="button" data-apply-employee>应用到全部</button></div>
        <ul class="dispatch-list">${picks.map(pick=>{
          const m=app.member(pick.member_id),id=m.member_id,existing=activeTask(id);
          return `<li class="dispatch-row">
            <div><strong>${app.escape(m.name)}</strong><small>${app.memberCode(m)} · ${pick.care_action?app.careActionLabel(pick.care_action):app.WB_OBJECTIVES[pick.objective]}</small>${existing?`<small>已有负责人 ${app.escape(existing.assignee)}</small>`:''}</div>
            <div class="field"><label for="assignee-${id}">负责人</label><select id="assignee-${id}" data-pick-employee="${id}">${app.employeeOptions(pick.assignee||app.suggestedEmployee(m),'选择员工',true)}</select></div>
            <div class="field dispatch-note"><label for="note-${id}">沟通重点 <small>选填</small></label><input id="note-${id}" data-pick-note="${id}" maxlength="180" value="${app.escape(pick.note)}" placeholder="比如先问她是否想换短甲"></div>
            <button type="button" data-remove-pick="${id}" aria-label="移除 ${app.escape(m.name)}">移除</button>
          </li>`;
        }).join('')}</ul>
        <button type="submit" class="primary">确认并分派 · ${picks.length} 位</button>
      </form>`;
  }
  function refreshPicks() {
    const panel=document.getElementById('dispatch-queue');
    panel.innerHTML=dispatchPanel();
    app.setupChoiceFields(panel);
    app.setupGlassControls(panel);
    document.getElementById('pick-count').textContent=app.ui.picks.size;
    app.content.querySelectorAll('[data-pick]').forEach(button=>{
      const selected=app.ui.picks.has(button.dataset.pick);
      const blocked=button.hasAttribute('data-pick-blocked');
      button.setAttribute('aria-pressed',String(selected));
      button.disabled=blocked&&!selected;
      button.querySelector('.pick-label').textContent=selected?'已选 · 移除':blocked?'暂不可分派':'加入清单';
      button.closest('.hanger')?.classList.toggle('selected',selected);
    });
  }
  function focusDispatch(){
    const panel=document.getElementById('dispatch-queue');
    panel.focus({preventScroll:true});
    panel.scrollIntoView({block:'start'});
  }
  let careQueuePage=1;
  function careReminderBlockers(m) {
    const reasons=app.memberBlockers(m,'care');
    if(activeTask(m.member_id))reasons.push('已有待联系任务');
    if(m.last_handled_on===app.WORK_DATE)reasons.push('今天已有沟通记录');
    return reasons;
  }
  function careQueue() {
    const rows=[...app.pendingCare.values()].sort((a,b)=>Number(b.data_type==='real')-Number(a.data_type==='real')||a.due_on.localeCompare(b.due_on)||a.member_id.localeCompare(b.member_id));
    const pages=Math.max(1,Math.ceil(rows.length/app.ui.limit));
    careQueuePage=Math.max(1,Math.min(careQueuePage,pages));
    const picks=rows.slice((careQueuePage-1)*app.ui.limit,careQueuePage*app.ui.limit)
      .map(reminder=>({m:app.member(reminder.member_id),objective:'care',reminder}));
    return {picks,pages};
  }
  function dashboard(){
    const careMode=app.ui.opportunity==='care';
    const queuedCare=careMode&&Array.isArray(app.state.careReminders);
    const groups=opportunityGroups(),queue=queuedCare?careQueue():null,picks=queue?.picks??careRecommendations(groups);
    const pagination=queue?.pages>1?`<nav class="care-queue-pagination" aria-label="护理回访分页">
      <button type="button" data-care-queue-page="${careQueuePage-1}" ${careQueuePage===1?'disabled':''}>上一页</button>
      <span aria-label="第 ${careQueuePage} 页，共 ${queue.pages} 页">${careQueuePage} / ${queue.pages}</span>
      <button type="button" data-care-queue-page="${careQueuePage+1}" ${careQueuePage===queue.pages?'disabled':''}>下一页</button></nav>`:'';
    const total=new Set(Object.values(groups).flat().map(m=>m.member_id)).size;
    const eligible=queuedCare?app.pendingCare.size:app.ui.opportunity==='all'?total:groups[app.ui.opportunity].length;
    app.content.innerHTML=`<section class="growth-intro"><div><h2>今天，联系哪些顾客？</h2><p>从 <strong>${app.state.members.length.toLocaleString('zh-CN')}</strong> 位会员中，${careMode?'最近一次美甲完成后，第 7–28 天建议护理，第 29–45 天建议卸甲。':'按个人复购周期、到店情况、顾客偏好和上架计划找出联系机会。'}先选人，再交给合适的员工。</p></div><div class="glass-track"><aside class="growth-daily-note glass-tilt glass-surface"><p><strong>${eligible.toLocaleString('zh-CN')}</strong> 位符合当前机会</p><small>${queuedCare?'有联系限制的待办会保留，并显示原因。':'已排除有联系限制、已有待联系任务和今天已处理的顾客'}</small><button class="primary" id="jump-dispatch">查看待分派清单 · <span id="pick-count">${app.ui.picks.size}</span> 位</button></aside></div></section>
      <section class="growth-opportunities"><div class="growth-section-title"><h2 class="atelier-heading">经营机会</h2><p>同一会员可能出现在多个机会中，分派清单每人只保留一条。</p></div><div class="opportunity-scroll"><div class="growth-opportunity-tabs" role="group" aria-label="选择经营机会" style="--opportunity-count:${Object.keys(OPPORTUNITIES).length};--opportunity-index:${Object.keys(OPPORTUNITIES).indexOf(app.ui.opportunity)}"><span class="opportunity-highlight" aria-hidden="true"></span>${Object.entries(OPPORTUNITIES).map(([key,item])=>`<button data-opportunity="${key}" aria-pressed="${app.ui.opportunity===key}"><span>${item.label}</span><b>${(key==='all'?total:key==='care'&&Array.isArray(app.state.careReminders)?app.pendingCare.size:groups[key].length).toLocaleString('zh-CN')}</b></button>`).join('')}</div></div></section>
      <section class="growth-priority"><div class="section-head"><div><h2 class="atelier-heading">${app.ui.opportunity==='all'?'今日优先联系':OPPORTUNITIES[app.ui.opportunity].label+' · 优先名单'}</h2><p class="muted">${careMode?'按最近一次美甲的完成日期安排护理或卸甲。':app.ui.opportunity==='repurchase'?'按距上次到店的天数与个人复购周期的比值，筛选待复购、低频和沉睡会员。':app.ui.opportunity==='all'?'从不同机会里挑选适合联系的人，再决定这次怎么聊。':'按会员档案、偏好和联系资格筛选，带着具体理由联系。'}</p></div><div class="count-control"><label for="care-limit">显示推荐</label><select id="care-limit">${app.options([3,4,5,8],app.ui.limit)}</select></div></div>
      ${picks.length?careCards(picks):`<div class="empty atelier-empty">${ATELIER_NOTE}<p>${careMode?'暂无符合条件的待回访会员。':'这类机会暂时没有符合条件的会员，可以切换其他经营机会。'}</p><p><button data-page="campaigns">查看已有任务</button></p></div>`}<div class="opportunity-footer"><p class="care-note">${careMode?'有联系限制的顾客可翻牌查看原因。':'名单按已有规则优先级排列；评分不由模型计算。余额是服务权益，不作为新增收入或排序加分。'}</p>${pagination}</div></section>
      <section class="dispatch-panel" id="dispatch-queue" tabindex="-1" aria-label="待分派清单">${dispatchPanel()}</section>`;
    app.setupGlass(app.content);
    app.setupCareRow();
  }
  function selectOpportunity(button) {
    const previous=button.parentElement.querySelector('.opportunity-highlight');
    const from=getComputedStyle(previous).transform;
    app.ui.opportunity=button.dataset.opportunity;
    app.ui.flips={};
    app.render();

    const rail=app.content.querySelector('.growth-opportunity-tabs');
    rail.querySelector('[aria-pressed=true]').focus({preventScroll:true});
    const highlight=rail.querySelector('.opportunity-highlight');
    const to=getComputedStyle(highlight).transform;
    if(!app.reducedMotion.matches && typeof highlight.animate==='function' && from!==to) {
      highlight.animate([{transform:from},{transform:to}],
        {duration:220,easing:'cubic-bezier(.2,.7,.25,1)'});
    }
  }
  async function assignSelected() {
    if(app.ui.employee||!app.ui.picks.size)throw new Error('请先选择本次要分派的顾客。');
    const tasks=[...app.ui.picks.values()].map(pick=>{
      const m=app.member(pick.member_id);
      const existing=activeTask(m.member_id);
      if(existing)throw new Error(`${m.name} 已由 ${existing.assignee} 负责。请从清单中移除，或到联系任务中改派。`);
      const assignee=pick.assignee||app.suggestedEmployee(m);
      if(!app.assignableStaff().includes(assignee))throw new Error(`请为 ${m.name} 选择已开通账号的负责人。`);
      const p=pick.product_id?offerProduct(pick.product_id):opportunityProduct(m,pick.objective);
      const task={member_id:m.member_id,objective:pick.objective,
        product_id:p?.product_id||null,service_order_id:pick.service_order_id,care_action:pick.care_action,assignee,note:pick.note.trim()};
      const reasons=taskContactBlockers(task);
      if(m.last_handled_on===app.WORK_DATE)reasons.push('今天已有沟通记录');
      if(pick.service_order_id&&app.pendingCare.get(m.member_id)?.service_order_id!==pick.service_order_id)reasons.push('对应服务已变化，请重新选择');
      if(pick.objective==='care'&&pick.care_action!==app.careFollowupVisit(m)?.phase)reasons.push('回访阶段已变化，请移除后重新选择');
      if(!p&&!isNoProductObjective(pick.objective))reasons.push('暂缺匹配款式或服务');
      if(reasons.length)throw new Error(`${m.name} 暂不可分派：${reasons.join('、')}。`);
      task.reason=opportunityEvidence(m,pick.objective,p);
      task.message=pick.message||app.buildWorkbenchMessage(m,p,{objective:pick.objective,tone:'friendly',revision:1});
      return task;
    });
    const {taskIds}=await app.apiAction('assign',{tasks});
    app.ui.picks.clear();
    app.ui.bulkEmployee='';
    app.ui.task=taskIds[0];
    app.ui.taskFilter='全部';
    app.ui.employeeFilter='';
    app.showPage('campaigns');
    app.notify(`已分派 ${tasks.length} 项联系任务。${app.serverMode?'员工登录后可以查看待办。':'切换到对应员工的预览身份可查看待办。'}`);
  }

  return {
    ATELIER_NOTE,
    activeTask,
    isNoProductObjective,
    offerProduct,
    offerLabel,
    matchingPreviews,
    careRecommendations,
    opportunityEvidence,
    opportunityAction,
    taskContactBlockers,
    taskSummary,
    summaryCards,
    stagePick,
    refreshPicks,
    focusDispatch,
    get careQueuePage() { return careQueuePage; },
    set careQueuePage(value) { careQueuePage = value; },
    dashboard,
    selectOpportunity,
    assignSelected,
  };
};

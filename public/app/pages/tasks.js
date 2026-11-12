'use strict';

// app 提供共享状态的实时访问和跨页面操作；本模块保留自己的事件与局部状态。
(globalThis.NailMateApp ||= {}).createTasks = function (app) {
  function taskContext(task){
    const m=app.member(task.member_id),p=app.offerProduct(task.product_id);
    const restrictions=task.status==='assigned'?app.taskContactBlockers(task):[];
    const reason=task.reason||app.opportunityEvidence(m,task.objective||'repurchase',p);
    return `${restrictions.length?`<p class="eligibility blocked">当前联系限制：${app.escape(restrictions.join('、'))}</p>`:''}
      <section class="growth-task-context"><h3>为什么联系</h3><p>${app.escape(reason)}</p>
      <p class="task-action-note"><b>沟通目标</b> · ${app.escape(app.opportunityAction(m,task.objective,p,task.care_action||'care'))}</p>
      <p class="helper">最近到店 ${app.escape(m.last_visit)} · 上次联系 ${app.escape(m.last_contact_date||'暂无记录')} · 偏好 ${app.escape(m.preference)}</p>
      ${p?`<div class="growth-task-product">${app.workbenchPhoto(p)}<div><h4>${app.escape(p.product_name)}</h4><p>${app.escape(p.description)}</p><strong>${app.escape(app.offerLabel(p))}</strong></div></div>`:''}</section>`;
  }
  function taskMemberNotes(task) {
    const notes=app.profileNotes(task.member_id);
    const ownerNotes=notes.filter(note=>note.author_role!=='employee');
    const employeeNotes=notes.filter(note=>note.author_role==='employee');
    const editable=app.ui.employee&&app.state.employeeNotesEnabled&&['assigned','recorded'].includes(task.status);
    return `<details class="task-owner-notes"><summary>老板娘备注 · ${ownerNotes.length} 条</summary>
      ${ownerNotes.length?ownerNotes.map(note=>app.profileNoteItem(note)).join(''):'<p class="helper">暂无老板娘备注。</p>'}</details>
      ${editable||employeeNotes.length?`<details class="task-owner-notes" open><summary>员工备注 · ${employeeNotes.length} 条</summary>
        ${employeeNotes.map(note=>app.profileNoteItem(note,editable?'employee':undefined)).join('')}
        ${editable?employeeNoteEditor(task):''}</details>`:''}`;
  }
  function employeeNoteEditor(task){
    const draft=app.ui.employeeNoteDrafts[task.task_id]||{text:'',type:'service'};
    return `<form id="employee-note-form" class="profile-note-form" data-task="${task.task_id}">
      <label for="employee-note-text">${draft.noteId?'编辑我的备注':'添加员工备注'}</label>
      <textarea id="employee-note-text" name="text" maxlength="1200" required placeholder="例如：喜欢短圆甲，下次希望保留长度。">${app.escape(draft.text)}</textarea>
      <div class="profile-note-toolbar"><select name="type" aria-label="员工备注类型">${Object.entries(app.NOTE_LABELS).map(([value,label])=>`<option value="${value}" ${draft.type===value?'selected':''}>${label}</option>`).join('')}</select>
      ${draft.noteId?'<button type="button" data-employee-note-cancel>取消编辑</button>':''}
      <button class="primary" type="submit">${draft.noteId?'保存修改':'保存员工备注'}</button></div>
      <p class="helper">老板娘和有权查看该客户的员工可见。</p></form>`;
  }
  function todoReasons(task) {
    return teamTodoReasons(task,app.state.calendarDate);
  }
  function awaitingHandoff(task) {
    return !task.assignee && teamTaskNeedsHandoff(task);
  }
  function openWithdrawTask(task){
    if(!task||task.status!=='assigned'||task.result)throw new Error('仅尚未登记反馈的待联系任务可以撤回。');
    app.entryDialog('撤回误派',`<p>请确认员工还没有联系「${app.escape(app.member(task.member_id).name)}」。撤回后，任务会移出员工待办，老板娘仍可查看记录。</p>`,
      '确认撤回',async ()=>{
        await app.apiAction('withdraw',{id:task.task_id,previous:task.assignee});
        return ()=>{app.ui.task=task.task_id;app.ui.taskFilter='已撤回';app.render();app.notify('误派已撤回。')};
      });
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
      ${result.follow_up_on||result.follow_up_note?`<div><dt>下一步</dt><dd>${app.escape([result.follow_up_on,result.follow_up_note].filter(Boolean).join(' · '))}</dd></div>`:''}
      ${result.booked?`<div><dt>预约</dt><dd>${app.escape(appointmentTime(result))} · ${app.escape(appointmentLabel(result))}</dd></div>`:''}</dl>`;
  }
  function taskOutcome(task) {
    const result=task.result;
    if(!result)return '';
    if(task.status==='executed_simulated')return `<p class="helper">历史模拟记录 · ${result.visited?'已到店':result.booked?'已预约':result.replied?'已回复':'未回复'} · ${app.money(result.amount||0)}</p>`;
    return `<div class="eligibility"><b>${app.escape(result.outcome)}</b>${result.booked?` · ${app.escape(appointmentLabel(result))}`:''} · ${app.escape(result.recorded_on)}${result.note?`<p class="task-note">${app.escape(result.note)}</p>`:''}</div>`;
  }
  function employeeTaskForm(task){
    const editing=task.status==='recorded';
    const previous=task.result;
    const draft={outcome:previous?.outcome,note:previous?.note,followUpOn:previous?.follow_up_on,
      followUpNote:previous?.follow_up_note,appointmentAt:previous?.appointment_at,
      appointmentStatus:previous?.appointment_status||'scheduled',...app.ui.taskDrafts[task.task_id]};
    const canContact=!app.taskContactBlockers(task).length;
    const outcomes=editing||canContact?app.OUTCOMES:['暂不联系'];
    const revision=task.result_revision||0;
    const draftRevision=Number(draft.expectedRevision??revision);
    return `<form id="task-result-form" class="form-panel" data-task="${task.task_id}">
      <input type="hidden" name="expectedRevision" value="${draftRevision}">
      ${draftRevision!==revision?'<p class="eligibility blocked">这条任务有较新的反馈。可先复制当前草稿，再点击「刷新任务与备注」载入最新内容。</p>':''}
      <div class="field"><label for="task-message">参考话术 · 可修改</label><textarea id="task-message" name="message" maxlength="1600">${app.escape(draft.message??task.message)}</textarea></div>
      <p class="helper">${editing?'顾客后来回复或改变计划时，可以更新这项任务。历史反馈会保留，修改记录不代表再次联系。':'请用门店常用渠道联系顾客，联系后在这里登记反馈。'}</p>
      <div class="button-row"><button type="button" data-copy-task ${canContact?'':'disabled'}>复制话术</button><button type="button" data-task-studio="${task.task_id}">到话术工作台</button></div>
      <div class="field"><label for="task-outcome">沟通结果 <span class="task-field-required" aria-hidden="true">*</span></label><select id="task-outcome" name="outcome" aria-label="沟通结果（必填）" required><option value="">选择结果</option>${app.options(outcomes,draft.outcome)}</select><p class="task-field-error" id="task-outcome-error" role="alert" hidden>请选择沟通结果后再保存。</p></div>
      <div class="field"><label for="task-result-note">顾客反馈 <small>选填</small></label><textarea id="task-result-note" name="note" maxlength="500" placeholder="例如想周末来做裸色款，已确认时间">${app.escape(draft.note||'')}</textarea></div>
      <section class="task-form-plan" data-follow-up-fields ${draft.outcome==='不再营销'?'hidden':''}>
        <h3>下一步</h3>
        <div class="task-form-grid"><div class="field"><label for="task-follow-up-on">下次跟进日期 <small>选填</small></label><input type="date" id="task-follow-up-on" name="followUpOn" value="${app.escape(draft.followUpOn||'')}"></div>
        <div class="field"><label for="task-follow-up-note">跟进事项 <small>选填</small></label><input id="task-follow-up-note" name="followUpNote" maxlength="180" placeholder="例如周五问问下周哪天方便" value="${app.escape(draft.followUpNote||'')}"></div></div>
        <p class="helper">到期会出现在今日待办。跟进完成后可以清空日期并保存。</p>
      </section>
      <section class="task-form-plan" data-appointment-fields ${draft.outcome==='已预约'?'':'hidden'}>
        <h3>${task.care_service_order_id?'本次回访预约与到店':'预约与到店'}</h3>
        <div class="task-form-grid"><div class="field"><label for="task-appointment-at">预约时间 <small>选填 · 北京时间</small></label><input type="datetime-local" id="task-appointment-at" name="appointmentAt" value="${app.escape(draft.appointmentAt||'')}"></div>
        <div class="field"><label for="task-appointment-status">到店状态</label><select id="task-appointment-status" name="appointmentStatus">${Object.entries(TEAM_APPOINTMENT_LABELS).map(([key,label])=>`<option value="${key}" ${key===draft.appointmentStatus?'selected':''}>${key==='rescheduled'?'改期':label}</option>`).join('')}</select></div></div>
        <p class="helper">改期时填写新时间。预约时间到达后可登记已到店或未到店。</p>
      </section>
      <button type="submit" class="primary">${editing?'更新联系结果':'保存联系结果'}</button>
    </form>`;
  }
  function campaignsPage(){
    const visible=app.visibleTasks();
    const current=visible.filter(t=>t.status==='assigned'||t.status==='recorded');
    const filters=['全部',app.STATUSES.assigned,app.STATUSES.recorded];
    if(app.ui.employee)filters.unshift('今日待办');
    if(!app.ui.employee&&current.some(awaitingHandoff))filters.splice(1,0,'待交接');
    if(!app.ui.employee)for(const status of ['已撤回',app.STATUSES.archived,app.STATUSES.executed_simulated])if(visible.some(t=>app.taskStatus(t)===status))filters.push(status);
    if(!filters.includes(app.ui.taskFilter))app.ui.taskFilter='全部';
    const todos=current.filter(task=>todoReasons(task).length);
    const todayOnly=app.ui.taskFilter==='今日待办';
    const tasks=todayOnly ? todos : visible.filter(task=>(!app.ui.employeeFilter||task.assignee===app.ui.employeeFilter)
      &&(app.ui.taskFilter==='全部'||app.taskStatus(task)===app.ui.taskFilter||(app.ui.taskFilter==='待交接'&&awaitingHandoff(task))));
    if(!tasks.some(t=>t.task_id===app.ui.task))app.ui.task=(tasks.find(t=>t.status==='assigned')||tasks[0])?.task_id||null;
    const task=tasks.find(t=>t.task_id===app.ui.task);
    const ownerFilter=app.ui.employee?'':`<div class="field"><label for="employee-filter">负责人</label><select id="employee-filter">${app.employeeOptions(app.ui.employeeFilter,'全部员工')}</select></div>`;
    const title=app.ui.employee?`${app.escape(app.ui.employee)}的任务`:'门店联系任务';
    app.content.innerHTML=`<div class="section-head"><div><h2 class="atelier-heading">${title}</h2><p class="muted">${app.ui.employee?'查看客户备注、补充员工备注并登记反馈。':'按员工或状态查看任务，尚未联系的任务可以改派。'}</p></div><div class="button-row"><button type="button" data-refresh-team>刷新任务与备注</button>${app.ui.employee?'':'<button data-page="dashboard">去选客分派</button>'}</div></div>
      ${app.ui.employee?`<section class="task-agenda" aria-label="今日待办"><div><h3>今日待办 <strong>${todos.length}</strong></h3><p>${app.escape(app.state.calendarDate)} · 待联系、到期跟进和待登记到店结果</p></div><div class="button-row"><button type="button" data-task-view="今日待办" aria-pressed="${todayOnly}">查看待办</button><button type="button" data-task-view="全部" aria-pressed="${app.ui.taskFilter==='全部'}">全部任务</button></div></section>`:app.summaryCards(app.taskSummary(current))}
      <div class="review-layout"><section aria-label="联系任务列表">${ownerFilter}<div class="field"><label for="task-filter">任务状态</label><select id="task-filter">${app.options(filters,app.ui.taskFilter)}</select></div>
        <p class="helper">${tasks.length} 项任务</p><div class="task-list">${tasks.map(t=>`<button data-task="${t.task_id}" aria-pressed="${app.ui.task===t.task_id}">${app.escape(app.member(t.member_id).name)} · ${app.escape(t.strategy)}<small>${awaitingHandoff(t)?'待交接':`${app.escape(t.assignee||'历史任务')} · ${app.escape(todoReasons(t).join(' · ')||app.taskStatus(t))}`}</small></button>`).join('')}</div>
      </section><section class="task-detail" aria-label="联系任务详情">${task?`
        <div class="detail-head"><h2>${app.escape(app.member(task.member_id).name)} · ${app.escape(task.strategy)}</h2><span class="pill">${awaitingHandoff(task)?'待交接':app.taskStatus(task)}</span></div>
        <p class="helper">${task.task_id} · 负责人 ${app.escape(task.assignee||'—')}${task.assigned_on?' · '+app.escape(task.assigned_on):''}</p>
        ${task.note?`<aside class="task-instruction" aria-label="老板娘本次交代"><h3>老板娘本次交代</h3><p>${app.escape(task.note)}</p></aside>`:''}
        ${taskPlan(task.result)}
        ${taskContext(task)}
        ${['assigned','recorded'].includes(task.status)&&app.ui.employee?employeeTaskForm(task):`<details><summary>查看沟通话术</summary><p class="task-note">${app.escape(task.message||'暂无话术')}</p></details>`}
        ${!app.ui.employee&&(task.status==='assigned'||awaitingHandoff(task))?`<form id="reassign-form" class="form-panel" data-task="${task.task_id}"><div class="dispatch-toolbar"><div class="field"><label for="new-assignee">改派负责人</label><select id="new-assignee" name="assignee">${app.employeeOptions(task.assignee,'选择员工',true)}</select></div><div class="button-row"><button type="submit">确认改派</button>${task.status==='assigned'&&!task.result?`<button type="button" data-withdraw-task="${task.task_id}">撤回误派</button>`:''}</div></div></form>`:''}
        ${taskOutcome(task)}
        ${taskMemberNotes(task)}
        ${task.result_history?.length?`<details><summary>反馈修改记录 · ${task.result_history.length} 次</summary><ol class="task-result-history">${task.result_history.map(result=>`<li><strong>${app.escape(result.outcome)}</strong> <small>第 ${result.revision} 次保存 · ${app.escape(result.recorded_by||task.assignee)} · ${app.escape(result.updated_at?new Date(result.updated_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):result.recorded_on)}</small><p>${app.escape(result.note||'未填写顾客反馈')}</p>${taskPlan(result)}</li>`).join('')}</ol></details>`:''}
        <details><summary>任务记录</summary><ul>${task.history.map(h=>`<li>${app.escape(h)}</li>`).join('')}</ul></details>`:
        `<div class="empty atelier-empty">${app.ATELIER_NOTE}<p>${todayOnly?'今天没有待办。查看全部任务可以查找未来安排。':app.ui.employee?'当前没有符合条件的任务。分派给你的客户会显示在这里。':'当前没有符合条件的任务，可以调整筛选或去今日联系计划选客。'}</p></div>`}</section></div>`;
  }

  return {
    todoReasons,
    openWithdrawTask,
    appointmentLabel,
    appointmentTime,
    campaignsPage,
  };
};

'use strict';

// app 提供共享状态的实时访问和跨页面操作；本模块保留自己的事件与局部状态。
(globalThis.NailMateApp ||= {}).createReports = function (app) {
  function reportTasks() {
    return app.state.tasks.filter(task=>task.status==='assigned'||task.status==='recorded');
  }
  function reportStageDetails(tasks) {
    const stage=app.ui.reportStage;
    const labels=Object.fromEntries(TEAM_CHART_STAGES);
    const label=stage==='unanswered'?'未回复':labels[stage];
    const rows=[...teamChartTaskGroups(tasks)[stage]];
    const dueCount=rows.filter(task=>task.result?.follow_up_on && task.result.follow_up_on<=app.state.calendarDate).length;
    if(stage==='unanswered')rows.sort((a,b)=>(a.result.follow_up_on||'9999').localeCompare(b.result.follow_up_on||'9999'));
    if(stage==='booked'||stage==='visited')rows.sort((a,b)=>(a.result.appointment_at||'9999').localeCompare(b.result.appointment_at||'9999'));
    return `<h3>${label}明细 · ${rows.length} 条</h3>
      ${stage==='unanswered'?`<p class="helper">${dueCount} 条已到跟进日，按跟进日期排列。</p>`:''}
      ${rows.length?`<ul class="report-stage-list">${rows.map(task=>{
        const result=task.result;
        const timing=result?.booked?`${app.appointmentTime(result)} · ${app.appointmentLabel(result)}`:
          result?.follow_up_on?`跟进 ${result.follow_up_on}${result.follow_up_on<=app.state.calendarDate?' · 已到跟进日':''}`:'未安排跟进时间';
        return `<li><div><strong>${app.escape(app.member(task.member_id).name)}</strong><small>${app.escape(task.assignee||'待交接')} · ${app.escape(result?.outcome||'待联系')}</small></div><div class="report-stage-timing">${app.escape(timing)}${result?.follow_up_note?`<small>${app.escape(result.follow_up_note)}</small>`:''}</div><button type="button" data-view-task="${app.escape(task.task_id)}" aria-label="查看 ${app.escape(app.member(task.member_id).name)} 的任务">查看任务</button></li>`;
      }).join('')}</ul>`:'<p class="muted">这个阶段暂时没有任务。</p>'}`;
  }
  function reportsPage(){
    const tasks=reportTasks();
    const results=tasks.filter(task=>task.status==='recorded');
    app.content.innerHTML=`<div class="growth-result-heading"><h2>分派进度</h2><p>按全部分派任务的最新结果统计。</p></div>
      ${app.summaryCards(app.taskSummary(tasks))}
      ${teamResultChart(tasks,app.ui.reportStage)}
      <section class="report-stage-details" id="report-stage-details" tabindex="-1" aria-label="联系进度明细">${reportStageDetails(tasks)}</section>
      <section class="team-overview"><h2 class="atelier-heading">按员工查看</h2>${app.table(['员工','已分派','待联系','已联系','已预约','已到店'],app.taskOwners(tasks).map(name=>{
        const stats=app.taskSummary(tasks.filter(t=>t.assignee===name));
        return `<tr><td><button data-staff-progress="${app.escape(name)}">${app.escape(name)}${app.STAFF.includes(name)?'':' · 历史'}</button></td><td>${stats.assigned}</td><td>${stats.pending}</td><td>${stats.contacted}</td><td>${stats.booked}</td><td>${stats.visited}</td></tr>`;
      }))}</section>
      <section class="section-spacer"><h3>沟通结果</h3>${results.length?app.table(['会员','负责人','沟通结果','顾客反馈'],results.map(t=>`<tr><td>${app.escape(app.member(t.member_id).name)}</td><td>${app.escape(t.assignee)}</td><td>${app.escape(t.result.outcome)}${t.result.booked?' · '+app.escape(app.appointmentLabel(t.result)):''}</td><td class="wrap">${app.escape(t.result.note||'—')}</td></tr>`)):'<p class="helper">员工记录沟通结果后会显示在这里。</p>'}</section>
      <section class="section-spacer"><h3>顾客反馈记录</h3>${app.careRecords()}</section>`;
  }

  return {
    reportTasks,
    reportStageDetails,
    reportsPage,
  };
};

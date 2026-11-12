'use strict';

// app 提供共享状态的实时访问和跨页面操作；本模块保留自己的事件与局部状态。
(globalThis.NailMateApp ||= {}).createAccounts = function (app) {
  function accountsPage(){
    const team=app.STAFF;
    const accounts=new Map(app.state.accounts.map(account=>[account.employee,account]));
    const columns=app.serverMode?['员工','账号','登录状态','操作']:['员工','账号'];
    const rows=team.map(name=>{
      const account=accounts.get(name);
      const cells=`<td>${app.escape(name)}</td><td>${app.escape(account?.username||'待开通')}</td>`;
      if(!app.serverMode)return `<tr>${cells}</tr>`;
      const remove=account?.loginEnabled?`<button type="button" class="account-delete" data-delete-employee="${app.escape(name)}" aria-label="删除 ${app.escape(name)} 的账号">删除账号</button>`:'';
      return `<tr>${cells}<td>${account?.loginEnabled?'已开通':'待设密码'}</td><td>${remove}</td></tr>`;
    });
    app.content.innerHTML=`<section class="team-overview"><h2 class="atelier-heading">员工登录账号</h2><p class="muted">${app.serverMode?'选择现有员工设置或重设密码，也可以新增员工。':'可以添加演示员工或修改演示账号名。请使用虚构信息。'}</p>
      ${app.table(columns,rows)}
      <form class="form-panel account-form" id="employee-account-form">
        <div class="field"><label for="account-employee">选择员工</label><select id="account-employee" name="employee"><option value="">新增员工</option>${app.options(team,'')}</select></div>
        <div class="field" id="account-new-name-field"><label for="account-new-name">新员工姓名</label><input id="account-new-name" name="newEmployee" maxlength="30" autocomplete="off"></div>
        <div class="field"><label for="account-username">${app.serverMode?'登录账号':'演示账号'}</label><input id="account-username" name="username" required minlength="3" maxlength="32" autocomplete="off" placeholder="例如 staff01"></div>
        ${app.serverMode?'<div class="field"><label for="account-password">新密码</label><input id="account-password" name="password" type="password" minlength="10" maxlength="128" autocomplete="new-password" required></div>':''}
        <p class="helper">账号使用字母、数字、点、下划线或连字符。${app.serverMode?'密码至少 10 位，重设密码后员工需要重新登录。':''}</p>
        <button type="submit" class="primary">保存员工账号</button>
      </form></section>`;
  }
  function confirmEmployeeDeletion(employee) {
    const account=app.state.accounts.find(item=>item.employee===employee&&item.loginEnabled);
    if(!account)return;
    const pending=app.state.tasks.filter(task=>task.assignee===employee&&teamTaskNeedsHandoff(task));
    const recipients=app.assignableStaff().filter(name=>name!==employee);
    const dialog=document.createElement('dialog');
    dialog.className='member-dialog employee-delete-dialog';
    dialog.setAttribute('aria-labelledby','employee-delete-title');
    dialog.innerHTML=`<h2 id="employee-delete-title">删除 ${app.escape(employee)} 的账号</h2>
      <p>${app.escape(employee)} 将从员工账号列表移除，账号 ${app.escape(account.username)} 将无法登录。客户档案里的偏好技师和历史反馈会保留。</p>
      <form>
        ${pending.length?`<div class="field"><label for="employee-handoff">${pending.length} 项未完成任务的交接方式</label>
          <select name="replacement" id="employee-handoff"><option value="">暂留待交接</option>${app.options(recipients,'')}</select></div>
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
        const result=await app.apiAction('deleteEmployeeAccount',{employee,username:account.username,replacement});
        dialog.close();
        app.render();
        const count=result.taskIds.length;
        app.notify(`${employee} 的登录账号已删除。${count?`${count} 项未完成任务${replacement?'已转交':'已移入待交接'}。`:''}`);
      } catch(error) {
        errorMessage.textContent=error.message;
        errorMessage.hidden=false;
      } finally { submit.disabled=cancel.disabled=false; }
    });
    document.body.append(dialog);
    dialog.showModal();
  }

  return {
    accountsPage,
    confirmEmployeeDeletion,
  };
};

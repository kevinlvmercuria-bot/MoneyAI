'use strict';

// app 提供共享状态的实时访问和跨页面操作；本模块保留自己的事件与局部状态。
(globalThis.NailMateApp ||= {}).createAuth = function (app) {
  function saveIdentity() {
    try { sessionStorage.setItem(app.sessionKey,JSON.stringify(app.USER)); } catch {}
  }
  function resetIdentityDrafts(employee) {
    Object.assign(app.ui,{employee,task:null,taskFilter:employee?'今日待办':'全部',employeeFilter:'',reportStage:'booked',taskDrafts:{},noteDrafts:{},employeeNoteDrafts:{},editNote:null,composer:null,flips:{},bulkEmployee:''});
    app.ui.picks.clear();
    for(const key of Object.keys(app.workbenchDrafts))delete app.workbenchDrafts[key];
    Object.assign(app.ui.workbench,{member_id:employee?null:'M0001',objective:'repurchase',tone:'friendly',product_id:'',draft:'',loadedKey:null,revision:0});
    document.getElementById('logs').replaceChildren();
  }
  function renderSignedOut() {
    document.getElementById('account-menu').hidden=true;
    document.getElementById('signed-out-label').hidden=false;
    document.querySelector('.atelier-dock').hidden=true;
    document.querySelector('footer').hidden=true;
    document.getElementById('page-title').textContent='欢迎回到 NailMate';
    document.getElementById('page-motto').textContent=app.serverMode?'使用门店账号进入工作台。':'选择门店身份，继续今天的联系计划。';
    document.getElementById('page-index').textContent='工作空间';
    document.getElementById('edition-name').textContent='THE STUDIO';
    if(app.serverMode) {
      const setup=app.authInfo.setupRequired;
      const heading=setup?'创建老板娘账号':'登录工作台';
      app.content.innerHTML=`<section class="login-panel" aria-label="登录工作台"><h2>${heading}</h2>${setup?'<p class="muted">首次使用请设置老板娘的登录账号，之后可在员工账号管理中设置员工密码。</p>':''}
        <form id="identity-login-form">
          <div class="field"><label for="login-username">账号</label><input id="login-username" name="username" maxlength="32" autocomplete="username" required></div>
          <div class="field"><label for="login-password">密码${setup?'（至少 10 位）':''}</label><input id="login-password" name="password" type="password" minlength="${setup?10:1}" maxlength="128" autocomplete="${setup?'new-password':'current-password'}" required></div>
          <button type="submit" class="primary">${setup?'创建并登录':'登录'}</button>
        </form></section>`;
    } else {
      app.content.innerHTML=`<section class="login-panel" aria-label="登录工作台"><h2>进入工作台</h2><form id="identity-login-form"><label for="login-role">选择身份</label><select id="login-role"><option value="">老板娘</option>${app.sharedAccounts.map(account=>`<option value="${app.escape(account.employee)}">员工 · ${app.escape(account.employee)}</option>`).join('')}</select><button type="submit" class="primary">进入工作台</button></form><p class="helper">分享预览通过选择身份进入。</p></section>`;
    }
  }
  async function switchIdentity(employee) {
    if(app.serverMode)return;
    app.PREVIEW_ROLE.disabled=true;
    const previous={...app.USER},revision=++app.identityRevision;
    Object.assign(app.USER,{employee,role:employee?'employee':'owner'});
    try {
      const shared=app.previewState(app.USER);
      if(revision!==app.identityRevision)return;
      resetIdentityDrafts(employee);
      app.applyState(shared,app.preview.workspaceSnapshot());
      saveIdentity();
      app.showPage(app.homePage());
      document.getElementById('main').focus({preventScroll:true});
    } catch(error) {
      if(revision!==app.identityRevision)return;
      Object.assign(app.USER,previous); app.ui.employee=previous.employee;
      app.PREVIEW_ROLE.value=previous.employee;
      app.render(); app.notify(error.message,true);
    } finally { app.PREVIEW_ROLE.disabled=false; }
  }
  async function logout() {
    if(app.serverMode) {
      try {
        const response=await fetch('/api/team/auth/logout',{method:'POST',headers:app.identityHeader});
        if(response.ok||response.status===401)location.reload();
        else throw new Error('退出失败，请重试。');
      } catch(error) { app.notify(error.message,true); }
      return;
    }
    app.identityRevision++;
    Object.assign(app.USER,{role:'guest',employee:''});
    saveIdentity();
    resetIdentityDrafts('');
    app.state=app.emptyState();
    document.getElementById('account-menu').open=false;
    document.getElementById('notice').hidden=true;
    document.querySelectorAll('.member-dialog').forEach(dialog=>dialog.remove());
    app.render();
    window.scrollTo(0,0);
    document.getElementById('login-role').focus({preventScroll:true});
  }
  app.PREVIEW_ROLE.addEventListener('change',()=>switchIdentity(app.PREVIEW_ROLE.value));
  document.getElementById('logout-button').addEventListener('click',logout);
  app.content.addEventListener('submit',async event=>{
    if(event.target.id!=='identity-login-form')return;
    event.preventDefault();
    const button=event.submitter;
    if(button?.disabled)return;
    if(button)button.disabled=true;
    try {
      if(!app.serverMode) {
        await switchIdentity(document.getElementById('login-role').value);
        return;
      }
      const action=app.authInfo.setupRequired?'setup':'login';
      const response=await fetch(`/api/team/auth/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(event.target)))});
      if(response.ok||response.status===409)location.reload();
      else throw new Error((await response.json()).error||'登录失败，请重试。');
    } catch(error) { app.notify(error.message,true); }
    finally { if(button?.isConnected)button.disabled=false; }
  });

  return {
    renderSignedOut,
  };
};

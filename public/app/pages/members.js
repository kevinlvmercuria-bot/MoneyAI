'use strict';

// app 提供共享状态的实时访问和跨页面操作；本模块保留自己的事件与局部状态。
(globalThis.NailMateApp ||= {}).createMembers = function (app) {
  function filteredMembers(){
    const query=app.ui.query.trim().toLowerCase();
    return app.state.members.filter(m=>{
      const notes=app.profileNotes(m.member_id);
      if(query&&!(m.member_id+app.memberCode(m)+m.name+(m.phone||'')+m.preference+m.care_need_tags+notes.map(n=>n.note_text).join(' ')).toLowerCase().includes(query))return false;
      if(app.ui.lifecycle!=='全部'&&app.LABELS[m.lifecycle]!==app.ui.lifecycle)return false;
      if(app.ui.tag==='可联系'&&app.memberBlockers(m).length||app.ui.tag==='有余额'&&m.balance<=0||app.ui.tag==='高价值'&&m.spending<2000)return false;
      return app.ui.memberFilter==='all'||app.ui.memberFilter==='dormant'&&m.lifecycle==='dormant'||app.ui.memberFilter==='due'&&m.lifecycle==='due'||app.ui.memberFilter==='notes'&&notes.length>0||app.ui.memberFilter==='care'&&Boolean(m.care_need_tags);
    });
  }
  function membersPage(){
    app.content.innerHTML=`<div class="member-index"><aside class="member-directory" aria-label="会员查找与列表">
      <div class="button-row"><button type="button" class="primary" data-register-member>新增顾客</button><button type="button" data-member-import>导入真实会员</button></div>
      <label class="member-search-label" for="member-query">查找会员</label><input id="member-query" type="search" value="${app.escape(app.ui.query)}" placeholder="搜索全名、编号、款式或备注" autocomplete="off">
      <div class="member-filter-row"><div><label for="member-lifecycle">生命周期</label><select id="member-lifecycle">${app.options(['全部',...Object.values(app.LABELS)],app.ui.lifecycle)}</select></div><div><label for="member-tag">附加筛选</label><select id="member-tag">${app.options(['全部','可联系','有余额','高价值'],app.ui.tag)}</select></div></div>
      <div class="member-tabs" aria-label="会员快捷筛选">${[['all','全部'],['dormant','沉睡'],['due','待复购'],['notes','有备注'],['care','有护理需求']].map(([value,label])=>`<button data-member-filter="${value}" aria-pressed="${app.ui.memberFilter===value}">${label}</button>`).join('')}</div><div id="member-results"></div>
      </aside><div id="member-detail" tabindex="-1" aria-label="当前会员完整档案"></div></div>`;
    memberResults();
  }
  function memberResults(){
    const rows=filteredMembers(),pages=Math.max(1,Math.ceil(rows.length/app.MEMBER_PAGE_SIZE));
    app.ui.memberPage=Math.max(1,Math.min(app.ui.memberPage,pages));
    const pageRows=rows.slice((app.ui.memberPage-1)*app.MEMBER_PAGE_SIZE,app.ui.memberPage*app.MEMBER_PAGE_SIZE);
    if(!rows.some(m=>m.member_id===app.ui.member))app.selectProfile(pageRows[0]?.member_id||null);
    document.getElementById('member-results').innerHTML=`<p class="member-found" role="status">找到 ${rows.length.toLocaleString('zh-CN')} 位 · 共 ${app.state.members.length.toLocaleString('zh-CN')} 位会员</p>
      ${pageRows.length?`<div class="member-directory-list">${pageRows.map(m=>`<button class="member-row" data-member-detail="${m.member_id}" aria-pressed="${m.member_id===app.ui.member}" aria-label="打开 ${app.escape(m.name)} ${app.memberCode(m)} 的档案"><span class="member-avatar" aria-hidden="true">${app.escape(m.name[0])}</span><span class="member-row-info"><span class="member-row-title"><strong>${app.escape(m.name)}</strong>${app.profileState(m)}</span><small>${app.memberCode(m)} · ${app.escape(m.preference)}<br>${app.profileNotes(m.member_id).length} 条备注</small></span><span class="member-row-days">${m.days===null?'—<small>日期待确认</small>':m.days+' 天<small>未到店</small>'}</span></button>`).join('')}</div>
      <div class="member-pagination"><button data-member-page="${app.ui.memberPage-1}" ${app.ui.memberPage<=1?'disabled':''}>上一页</button><span>${app.ui.memberPage} / ${pages}</span><button data-member-page="${app.ui.memberPage+1}" ${app.ui.memberPage>=pages?'disabled':''}>下一页</button></div>`:'<div class="empty">没有找到符合条件的会员。<p><button data-member-clear>清空筛选</button></p></div>'}`;
    document.querySelectorAll('[data-member-filter]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.memberFilter===app.ui.memberFilter)));
    const detail=document.getElementById('member-detail');
    detail.innerHTML=app.ui.member?completeProfile(app.member(app.ui.member)):'<div class="profile-empty">调整左侧条件后，即可查看会员档案。</div>';
    app.setupChoiceFields(detail);
    app.setupGlassControls(detail);
  }
  function completeProfile(m){
    const care=app.memberCareIndex.get(m.member_id)||{},notes=app.profileNotes(m.member_id),restrictions=app.memberBlockers(m);
    const assigned=app.activeTask(m.member_id);
    const careSource=app.CARE_SOURCE_LABELS[care.care_need_source]||'待确认';
    const careStart=teamCareFollowupDate(app.recentNailVisits.get(m.member_id)?.completed_on);
    const confidence={high:'高置信度',medium:'中等置信度',low:'历史记录较少',manual:'已设定周期'}[m.cycle_confidence]||'参考周期';
    const latestVisit=m.days===null?'日期待确认':m.days===0?'今天':`${m.days} 天前`;
    return `<article class="member-sheet"><header class="profile-topline"><div class="profile-identity"><span class="member-avatar" aria-hidden="true">${app.escape(m.name[0])}</span><div><div class="profile-name"><h2>${app.escape(m.name)}</h2>${app.profileState(m)}</div><p class="profile-subtitle">${app.memberCode(m)} · ${app.escape(m.membership_level)}${m.data_type==='simulation'?' · 模拟':''}</p></div></div><div class="button-row"><button type="button" class="member-text-button" data-edit-member="${m.member_id}">编辑档案</button><button type="button" class="primary" data-register-service="${m.member_id}">登记美甲完成</button></div></header>
      ${m.phone?`<p class="profile-subtitle">联系电话：${app.escape(m.phone)}</p>`:''}
      <div class="profile-metrics"><div><span>最近到店</span><strong>${latestVisit}</strong></div><div><span>累计消费</span><strong>${app.profileMoney(m.spending)}</strong></div><div><span>储值余额</span><strong>${app.profileMoney(m.balance)}</strong></div><div><span>到店次数</span><strong>${m.visit_count} 次</strong></div></div>
      ${manualServiceRecords(m)}
      <section class="profile-section"><div class="profile-section-head"><h3>个人复购周期</h3><span class="member-state active">${confidence}</span></div>${profileCycle(m)}</section>
      <section class="profile-section profile-duo"><div><h3>偏好与权益</h3><dl class="profile-preferences"><dt>偏好款式</dt><dd>${app.escape(m.preference)}</dd><dt>偏好技师</dt><dd>${app.escape(m.preferred_technician||'暂无记录')}</dd><dt>储值权益</dt><dd>${app.profileMoney(m.balance)}</dd><dt>加入会员</dt><dd>${app.escape(m.created_date||'日期待确认')}</dd></dl></div><div><h3>营销资格检查</h3><ul class="profile-checks">${app.profileCheck(m.consent,m.consent?'已获得营销授权':'未获得营销授权')}${app.profileCheck(!m.recent,m.recent?'14 天内已有联系':'14 天内无触达')}${app.profileCheck(!m.complaint,m.complaint?'有未解决投诉':'无未解决投诉')}${app.profileCheck(!m.appointment,m.appointment?'已有未来预约':'无未来预约')}${m.care_paused?app.profileCheck(false,'店主已选择暂不联系'):''}</ul></div></section>
      <section class="profile-section"><div class="profile-section-head"><h3>客户备注</h3><small>${notes.length} 条 · 门店内可见</small></div>${notes.length?notes.map(note=>profileNoteItem(note,'owner')).join(''):'<p class="profile-empty">还没有备注，可以记下她喜欢的款式和沟通习惯。</p>'}${noteEditor(m.member_id)}</section>
      <section class="profile-section"><div class="profile-section-head"><h3>护理需求</h3><button class="member-text-button" data-member-compose="care">准备护理沟通</button></div>${m.care_need_tags?`<div class="profile-care-tags">${m.care_need_tags.split('|').map(tag=>`<span>${app.escape(tag)}</span>`).join('')}</div>`:''}${m.care_need_tags||m.preferred_care_service?`<p>建议服务：${app.escape(m.preferred_care_service||'到店后确认')} · 需求来源：${app.escape(careSource)}</p>`:'<p class="profile-empty">暂无明确护理需求，先询问本人意愿，再推荐合适服务。</p>'}${careStart?`<p class="muted">回访开始日 ${app.escape(careStart)}</p>`:''}<p class="muted">${app.escape(care.care_guidance)} ${care.care_followup_opt_in?'已同意护理跟进。':'尚未同意护理跟进，当前只能预览沟通草稿。'}</p></section>
      ${assigned?`<p class="profile-qualification">已有待联系任务 · 负责人 ${app.escape(assigned.assignee)} <button data-view-task="${assigned.task_id}">查看任务</button></p>`:''}
      ${restrictions.length?`<p class="profile-qualification">营销联系限制 · ${app.escape(restrictions.join('、'))}</p>`:''}<div class="profile-actions"><button data-member-history="${m.member_id}">完整消费记录</button><button class="primary" data-member-compose="repurchase">根据档案准备话术</button></div></article>`;
  }
  function profileCycle(m){
    if(m.ratio===null)return '<p>补齐最近到店日期和个人平均周期后，可查看复购进度。</p>';
    const scale=Math.max(m.cycle*3.6,m.days+10);
    const averagePosition=Math.max(12,Math.min(82,m.cycle/scale*100));
    return `<div class="cycle-labels"><span>最近到店 ${app.escape(m.last_visit)}</span><b>今天 · ${m.days} 天</b></div><div class="personal-cycle" style="--cycle:${averagePosition}%" role="img" aria-label="个人平均周期 ${m.cycle} 天，距最近到店 ${m.days} 天，为平均周期的 ${m.ratio} 倍"><div class="personal-cycle-fill" style="width:${Math.min(100,m.days/scale*100)}%"></div><span class="personal-cycle-marker" data-label="平均 ${m.cycle} 天"></span></div><p>当前为个人平均复购周期的 <b>${m.ratio} 倍</b>，状态为“${app.LABELS[m.lifecycle]}”。${m.profile_cycle_days?'当前周期由老板娘设定。':m.visit_count<2?'历史到店间隔不足，先使用参考周期。':'个人平均周期根据历史到店间隔计算。'}</p>`;
  }
  function profileNoteItem(note,controls){
    const employee=note.author_role==='employee';
    const author=employee?`员工 · ${note.author_name}`:note.author_name||'老板娘';
    const stamp=String(note.updated_at||note.created_at||'');
    const date=stamp.endsWith('Z')&&Number.isFinite(Date.parse(stamp))?teamBusinessClock(new Date(stamp)).date:stamp.slice(0,10);
    const pin=controls==='owner'?`<button type="button" class="member-text-button" data-note-pin="${app.escape(note.note_id)}" aria-pressed="${Boolean(note.is_pinned)}">${note.is_pinned?'取消置顶':'置顶'}</button>`:'';
    const edit=controls==='owner'&&!employee?`<button type="button" class="member-text-button" data-note-edit="${app.escape(note.note_id)}">编辑</button>`
      :controls==='employee'&&note.can_edit?`<button type="button" class="member-text-button" data-employee-note-edit="${app.escape(note.note_id)}">编辑</button>`:'';
    return `<article class="profile-note"><div class="profile-note-meta"><span>${note.is_pinned?'<b class="note-pinned">置顶 · </b>':''}${app.escape(app.NOTE_LABELS[note.note_type]||note.note_type)} · ${app.escape(author)}${date?' · '+app.escape(date):''}</span>${pin}${edit}</div><p>${app.escape(note.note_text)}</p></article>`;
  }
  function noteEditor(id){
    const editing=app.ui.editNote&&app.profileNotes(id).find(n=>n.note_id===app.ui.editNote);
    const draft=app.ui.noteDrafts[id]||(editing?{text:editing.note_text,type:editing.note_type,pinned:editing.is_pinned}:{text:'',type:'preference',pinned:false});
    return `<form class="profile-note-form" id="member-note-form" data-member="${id}"><label for="member-note-text">${editing?'编辑这条备注':'补充一条备注'}</label><textarea id="member-note-text" name="text" maxlength="1200" required placeholder="例如：喜欢短方圆甲，通勤时偏好低饱和色。">${app.escape(draft.text)}</textarea><div class="profile-note-toolbar"><select name="type" aria-label="备注类型">${Object.entries(app.NOTE_LABELS).map(([value,label])=>`<option value="${value}" ${draft.type===value?'selected':''}>${label}</option>`).join('')}</select><label><input type="checkbox" name="pinned" ${draft.pinned?'checked':''}>置顶</label>${editing?'<button type="button" data-note-cancel>取消编辑</button>':''}<button class="primary" type="submit">${editing?'保存修改':'保存备注'}</button></div><p class="helper">仅供店内参考，不会直接发给顾客，也不会写回原数据库。</p></form>`;
  }
  async function saveProfileNote(form){
    const id=form.dataset.member,values=new FormData(form),noteId=app.ui.editNote;
    await app.apiAction('note',{memberId:id,noteId,text:String(values.get('text')||''),type:values.get('type'),pinned:values.has('pinned')});
    app.ui.editNote=null;delete app.ui.noteDrafts[id];app.render();app.notify('备注已保存。');
  }
  function entryDialog(title, fields, submitLabel, save){
    const dialog=document.createElement('dialog');
    dialog.className='member-dialog member-form-dialog';
    dialog.setAttribute('aria-labelledby','entry-dialog-title');
    dialog.innerHTML=`<form><h2 id="entry-dialog-title">${app.escape(title)}</h2>${fields}
      <p class="entry-error" role="alert" hidden></p><div class="button-row">
      <button type="button" data-close-entry>取消</button><button type="submit" class="primary">${app.escape(submitLabel)}</button></div></form>`;
    const form=dialog.querySelector('form'),cancel=dialog.querySelector('[data-close-entry]'),submit=form.querySelector('[type=submit]');
    cancel.addEventListener('click',()=>dialog.close());
    dialog.addEventListener('cancel',event=>{if(submit.disabled)event.preventDefault()});
    dialog.addEventListener('close',()=>dialog.remove());
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      if(submit.disabled)return;
      const error=form.querySelector('.entry-error');
      error.hidden=true;
      cancel.disabled=submit.disabled=true;
      try {
        const onSaved=await save(new FormData(form));
        dialog.close();
        onSaved();
      } catch(failure){
        error.textContent=failure.message||'保存失败，请重试。';
        error.hidden=false;
      } finally {cancel.disabled=submit.disabled=false}
    });
    document.body.append(dialog);
    dialog.showModal();
  }
  function openMemberEntry(m){
    const requestId=m?undefined:crypto.randomUUID();
    const care=m&&app.memberCareIndex.get(m.member_id);
    const input=(name,label,value,attributes='')=>`<div class="field"><label for="entry-member-${name}">${label}</label><input id="entry-member-${name}" name="${name}" value="${app.escape(value)}" ${attributes}></div>`;
    const dateInput=`type="date" max="${app.escape(app.state.calendarDate)}"`;
    entryDialog(m?'编辑顾客档案':'新增顾客',`
      ${!app.serverMode?'<p>演示资料仅保存在当前浏览器，请使用模拟姓名。</p>':''}
      <div class="form-row">${input('name','顾客姓名或称呼',m?.name,'required maxlength="40" autofocus')}
      ${input('membershipLevel','会员等级',m?.membership_level||'普通会员','required maxlength="30"')}</div>
      ${input('phone','联系电话',m?.phone||'','type="tel" maxlength="40" autocomplete="tel"')}
      <div class="form-row">${input('joinedOn','入会日期',m?m.created_date:app.state.calendarDate,dateInput)}
      ${input('lastVisit','补录最近到店日期',m?.profile_last_visit,dateInput)}</div>
      <p class="profile-form-help">${m?.last_visit?'当前最近到店 '+app.escape(m.last_visit)+'。':''}到店日期用于复购，美甲回访按服务完成记录计算。</p>
      <div class="form-row">${input('totalSpending','累计消费（元）',m?.spending,'type="number" min="0" max="99999999.99" step="0.01"')}
      ${input('balance','储值余额（元）',m?.balance,'type="number" min="0" max="99999999.99" step="0.01"')}</div>
      <div class="form-row">${input('cycle','个人复购周期（天）',m?.profile_cycle_days,'type="number" min="1" max="3650" step="1" placeholder="留空按记录计算"')}
      ${input('technician','偏好技师',m?.preferred_technician,'maxlength="40"')}</div>
      ${input('styles','偏好款式',m?.preferred_styles?.replaceAll('|','、'),'maxlength="120" placeholder="例如：法式、裸色"')}
      <div class="form-row">${input('careTags','护理需求',m?.care_need_tags?.replaceAll('|','、'),'maxlength="120" placeholder="例如：日常保湿、到期卸甲"')}
      ${input('careService','偏好护理项目',m?.preferred_care_service,'maxlength="60"')}</div>
      <label class="check-label"><input type="checkbox" name="complaint" ${m?.complaint?'checked':''}>有未解决投诉</label>
      <label class="check-label"><input type="checkbox" name="care" ${care?.care_followup_opt_in?'checked':''}>顾客已同意护理回访</label>
      <label class="check-label"><input type="checkbox" name="marketing" ${m?.marketing_consent?'checked':''}>顾客已同意接收营销消息</label>`,
    '保存档案',async data=>{
      const {care,marketing,complaint,...fields}=Object.fromEntries(data);
      const {memberId}=await app.apiAction('registerMember',{...fields,requestId,memberId:m?.member_id,
        expectedRevision:m?.profile_revision??m?.revision??0,careOptIn:Boolean(care),marketingConsent:Boolean(marketing),complaint:Boolean(complaint)});
      return ()=>{
        if(!m||app.ui.query||app.ui.memberFilter!=='all'||app.ui.lifecycle!=='全部'||app.ui.tag!=='全部')
          Object.assign(app.ui,{query:'',lifecycle:'全部',tag:'全部',memberFilter:'all',memberPage:m?Math.floor(app.state.members.findIndex(row=>row.member_id===memberId)/app.MEMBER_PAGE_SIZE)+1:1});
        app.selectProfile(memberId);app.render();
        document.getElementById('member-detail')?.focus();
        app.notify(m?'顾客档案已更新。':'已新增顾客，可以在档案里登记美甲完成。');
      };
    });
  }
  function manualServiceRecords(m){
    const orders=(app.servicesByMember.get(m.member_id)||[]).filter(order=>order.manual_entry)
      .sort((a,b)=>b.completed_on.localeCompare(a.completed_on));
    if(!m.manual_entry&&!orders.length)return '';
    return `<section class="profile-section"><div class="profile-section-head"><h3>美甲完成记录</h3></div>
      ${orders.length?orders.map(order=>`<div class="profile-section-head"><span>${app.escape(order.completed_on)} · 美甲完成</span>
        <button type="button" class="member-text-button" data-edit-service="${app.escape(order.order_id)}">更正日期</button></div>`).join('')
        :'<p class="profile-empty">顾客做完美甲后，登记一次实际完成日期。</p>'}</section>`;
  }
  function openServiceEntry(m,order){
    if(!m)throw new Error('请先选择顾客。');
    const requestId=order?undefined:crypto.randomUUID();
    entryDialog(order?'更正完成日期':'登记美甲完成',`
      <p>${app.escape(m.name)}${m.data_type==='simulation'?' · 模拟顾客':''}</p>
      <div class="field"><label for="entry-completed-on">美甲完成日期</label><input id="entry-completed-on" type="date" name="completedOn" required
        max="${app.escape(app.state.calendarDate)}" value="${app.escape(order?.completed_on||app.state.calendarDate)}" autofocus></div>`,
    order?'保存更正':'保存服务',async data=>{
      await app.apiAction('registerService',{memberId:m.member_id,requestId,orderId:order?.order_id,expectedCompletedOn:order?.completed_on,
        completedOn:data.get('completedOn')});
      return ()=>{app.render();app.notify(order?'服务完成日期已更正。':'已登记美甲完成。')};
    });
  }
  function showMemberOrders(id){
    const m=app.member(id),orders=[...(app.memberOrderIndex.get(id)||[])].sort((a,b)=>b.order_date.localeCompare(a.order_date));
    document.getElementById('member-orders-dialog')?.remove();
    const dialog=document.createElement('dialog');dialog.id='member-orders-dialog';dialog.className='member-dialog';dialog.setAttribute('aria-labelledby','member-orders-title');
    const types={care:'护理消费',nail_service:'美甲服务',care_service:'护理服务',care_product:'护理产品',service:'到店服务',recharge:'储值充值'};
    dialog.innerHTML=`<header><h2 id="member-orders-title">${app.escape(m.name)} · 服务与消费记录</h2><form method="dialog"><button>关闭</button></form></header><p>${app.memberCode(m)} · 共 ${orders.length} 条记录${m.data_type==='simulation'?' · 模拟':''}</p>${orders.length?app.table(['日期','产品 / 服务','类型','金额','技师'],orders.map(order=>`<tr><td>${app.escape(order.order_date)}</td><td class="wrap">${app.escape(order.manual_entry?'手工登记美甲':app.memberProductIndex.get(order.product_id)?.product_name||order.product_id)}</td><td>${app.escape(types[order.order_type]||order.order_type)}</td><td>${order.amount==null?'—':app.money(order.amount)}</td><td>${app.escape(order.technician||'—')}</td></tr>`)):'<div class="empty">这位会员暂时没有服务或消费记录。</div>'}`;
    document.body.append(dialog);dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close()}});dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();
  }
  function profileProductChoices(m,objective){
    const care=objective==='care',notes=app.profileNotes(m.member_id).map(n=>n.note_text).join(' ');
    const score=p=>(m.preferred_styles.split('|').includes(p.style)?5:0)+(p.is_new?2:0)+(/裸色|低饱和/.test(notes)&&/奶油|裸色|浅/.test(p.product_name)?4:0)+(p.product_name===m.preferred_care_service?8:0);
    return app.DATA.products.filter(p=>p.is_active&&(care?p.product_type!=='nail_style':p.product_type==='nail_style')).sort((a,b)=>score(b)-score(a)||a.product_id.localeCompare(b.product_id));
  }
  function openProfileComposer(objective){app.openWorkbench(app.ui.member,objective)}
  async function storeProductPhoto(file,productId){
    if(!file)return;if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('请选择 PNG、JPG 或 WebP 格式的产品图。');
    if(file.size>10*1024*1024)throw new Error('图片请小于 10 MB。');
    const source=URL.createObjectURL(file);
    try{const image=new Image();image.src=source;await image.decode();const ratio=Math.min(1,1000/Math.max(image.width,image.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*ratio));canvas.height=Math.max(1,Math.round(image.height*ratio));const ctx=canvas.getContext('2d');ctx.fillStyle='#fffcf9';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);await app.apiAction('photo',{productId,image:canvas.toDataURL('image/jpeg',.82)})}
    finally{URL.revokeObjectURL(source)}
  }
  app.content.addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button)return;
    try{
      if(button.dataset.openProfile){app.ui.page='members';app.ui.query='';app.ui.lifecycle='全部';app.ui.tag='全部';app.ui.memberFilter='all';app.ui.memberPage=Math.floor(app.state.members.findIndex(m=>m.member_id===button.dataset.openProfile)/app.MEMBER_PAGE_SIZE)+1;app.selectProfile(button.dataset.openProfile);app.render();document.getElementById('member-detail').scrollIntoView({block:'start'});return}
      if(button.hasAttribute('data-member-clear')){app.ui.query='';app.ui.lifecycle='全部';app.ui.tag='全部';app.ui.memberFilter='all';app.ui.memberPage=1;app.render();return}
      if(button.dataset.memberPage){app.ui.memberPage=Number(button.dataset.memberPage);app.selectProfile(null);memberResults();return}
      if(button.dataset.memberFilter){app.ui.memberFilter=button.dataset.memberFilter;app.ui.memberPage=1;memberResults();return}
      if(button.hasAttribute('data-register-member')){openMemberEntry();return}
      if(button.dataset.editMember){openMemberEntry(app.member(button.dataset.editMember));return}
      if(button.dataset.registerService){openServiceEntry(app.member(button.dataset.registerService));return}
      if(button.dataset.editService){
        const order=(app.servicesByMember.get(app.ui.member)||[]).find(item=>item.order_id===button.dataset.editService&&item.manual_entry);
        if(!order)throw new Error('服务记录已更新，请刷新档案。');
        openServiceEntry(app.member(app.ui.member),order);return;
      }
      if(button.dataset.memberHistory){showMemberOrders(button.dataset.memberHistory);return}
      if(button.dataset.noteEdit){app.ui.editNote=button.dataset.noteEdit;delete app.ui.noteDrafts[app.ui.member];memberResults();document.getElementById('member-note-text').focus({preventScroll:true});return}
      if(button.hasAttribute('data-note-cancel')){app.ui.editNote=null;delete app.ui.noteDrafts[app.ui.member];memberResults();return}
      if(button.dataset.notePin){const note=app.profileNotes(app.ui.member).find(n=>n.note_id===button.dataset.notePin);await app.apiAction('note',{memberId:app.ui.member,noteId:note.note_id,pinned:!note.is_pinned});app.render();app.notify(note.is_pinned?'已取消置顶。':'备注已置顶。');return}
      if(button.dataset.memberCompose){openProfileComposer(button.dataset.memberCompose);return}
    }catch(error){app.notify(error.message||'操作未完成，请重新尝试。',true)}
  });
  function rememberProfileDraft(target){
    const form=target.closest('#member-note-form');if(form){const values=new FormData(form);app.ui.noteDrafts[form.dataset.member]={text:String(values.get('text')||''),type:String(values.get('type')),pinned:values.has('pinned')}}
  }
  app.content.addEventListener('input',event=>rememberProfileDraft(event.target));
  app.content.addEventListener('change',event=>rememberProfileDraft(event.target));
  app.content.addEventListener('submit',event=>{if(event.target.id!=='member-note-form')return;event.preventDefault();saveProfileNote(event.target).catch(error=>app.notify(error.message,true))});

  // The library includes existing products plus an explicitly unlisted style idea.

  return {
    membersPage,
    memberResults,
    profileNoteItem,
    entryDialog,
    profileProductChoices,
    storeProductPhoto,
  };
};

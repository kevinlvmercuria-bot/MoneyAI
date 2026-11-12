'use strict';

// app 提供共享状态的实时访问和跨页面操作；本模块保留自己的事件与局部状态。
(globalThis.NailMateApp ||= {}).createStudio = function (app) {
  const WB_OBJECTIVES={repurchase:'复购邀请',balance:'储值关怀',new_product:'新品推荐',care:'护理关怀',preview:'新品预告',greeting:'日常问候'};
  const WB_TONES={
    friendly:{style:'friendly',label:'自然风',greeting:'，最近还好吗？',checkIn:'今天想到你，来打个招呼。祝你这周顺顺利利。',offer:'有兴趣的话，我可以发图给你看看。',care:'有什么需要维护的地方，随时和我说。'},
    cute:{style:'cute',greeting:'你好呀～',checkIn:'今天想起来跟你打个招呼，最近过得怎么样呀？',offer:'想看看图的话，我发给你呀。',care:'有想调整的地方，随时跟我说呀。'},
    gentle:{style:'gentle',greeting:'，最近过得好吗？',checkIn:'想来问候一下你，有空的时候再聊就好。',offer:'如果你想看看，我可以发图，你有空慢慢挑。',care:'想调整或维护的话，等你方便时和我说就好。'},
    brief:{style:'concise',label:'简洁风',greeting:'，你好。',checkIn:'最近过得怎么样？',offer:'想看图的话告诉我。',care:'需要维护的话，可以和我说。'},
    elegant:{style:'elegant',greeting:'，你好。',checkIn:'想问候一下你的近况，祝你这周顺利。',offer:'若你有兴趣，我可以发款式图供你参考。',care:'如需安排维护，可以告诉我方便的时间。'},
  };
  const WB_TONE_LABELS=Object.fromEntries(Object.entries(WB_TONES).map(([id,tone])=>[
    id,tone.label||globalThis.NailMateCommunication.resolveCommunication(null,tone.style).label,
  ]));
  const workbenchDrafts={};
  app.ui.workbench={member_id:app.ui.employee?null:'M0001',objective:'repurchase',tone:'friendly',product_id:'',draft:'',loadedKey:null,revision:0};
  function workbenchProducts(m,objective){
    if(app.isNoProductObjective(objective))return [];
    if(objective==='preview')return app.matchingPreviews(m);
    let products=app.profileProductChoices(m,objective);
    const notes=app.profileNotes(m.member_id).map(n=>n.note_text).join(' '),care=app.memberCareIndex.get(m.member_id);
    if(objective==='new_product')products=products.filter(p=>p.is_new);
    if(objective==='care'){
      const phase=app.workbenchCarePhase(m);
      if(phase)products=products.filter(p=>teamCareProductMatches(p,phase));
      products=products.map(p=>({p,score:(p.product_name===care?.preferred_care_service?40:0)+(care?.care_need_tags||'').split('|').filter(tag=>tag&&p.suitable_care_tags?.includes(tag)).length*30})).sort((a,b)=>b.score-a.score).map(x=>x.p);
    }
    if(/不喜欢黑色/.test(notes))products=products.filter(p=>!p.product_name.includes('黑'));
    return products;
  }
  function workbenchKey(){const w=app.ui.workbench;return [w.member_id,w.objective,w.tone,w.product_id].join(':')}
  function ensureWorkbench(){
    const w=app.ui.workbench;
    if(!app.member(w.member_id)){
      const task=app.ui.employee&&app.visibleTasks().find(t=>t.status==='assigned');
      setWorkbenchMember(task?.member_id||app.state.members[0]?.member_id,task?.objective||'repurchase');
    }
    const m=app.member(w.member_id);
    if(!m)throw new Error('收到联系任务后，即可为负责的顾客准备话术。');
    const products=workbenchProducts(m,w.objective);
    if(!products.some(p=>p.product_id===w.product_id))w.product_id=products[0]?.product_id||'';
    const key=workbenchKey();
    if(key!==w.loadedKey){
      const task=app.ui.employee&&app.visibleTasks().findLast(t=>t.member_id===m.member_id&&t.objective===w.objective&&t.product_id===(w.product_id||null));
      w.draft=workbenchDrafts[key]??(task?(app.ui.taskDrafts[task.task_id]?.message??task.message):'');
      w.loadedKey=key;
    }
    const active=app.activeTask(m.member_id);
    const assigned=active?.objective===w.objective?active:undefined;
    return {m,products,p:app.offerProduct(w.product_id),reasons:app.memberBlockers(m,w.objective,assigned)};
  }
  function saveWorkbenchDraft(){
    const w=app.ui.workbench;
    if(w.loadedKey)workbenchDrafts[w.loadedKey]=w.draft;
  }
  function setWorkbenchMember(id,objective){
    const task=app.ui.employee&&app.visibleTasks().findLast(t=>t.member_id===id&&(t.status==='assigned'||t.status==='recorded'));
    const purpose=objective||task?.objective||'repurchase';
    Object.assign(app.ui.workbench,{member_id:id,objective:purpose,product_id:task?.product_id||'',loadedKey:null});
  }
  function openWorkbench(id,objective){
    if(!app.member(id))throw new Error('当前账号无法查看该会员。');
    saveWorkbenchDraft();
    setWorkbenchMember(id,objective);
    app.showPage('studio');
  }
  function workbenchPhoto(p){const photo=app.catalogPhoto(p);return `<div class="wb-product-photo${app.catalogSwatch(p)?' swatch-photo':''}">${photo?`<img src="${app.escape(photo)}" alt="${app.escape(p.product_name)}的${app.catalogPhotoLabel(p)}">`:'<span>产品实拍<br>待补充</span>'}</div>`}
  function studioPage(){
    if(!app.state.members.length){
      app.content.innerHTML='<div class="empty atelier-empty"><p>收到联系任务后，就可以在这里为自己负责的顾客准备话术。</p><p><button data-page="campaigns">查看我的联系任务</button></p></div>';
      return;
    }
    const {m,products,p,reasons}=ensureWorkbench(),w=app.ui.workbench,notes=app.profileNotes(m.member_id);
    const careMode=w.objective==='care',visit=careMode?app.careFollowupVisit(m):null,noProduct=app.isNoProductObjective(w.objective),needsOffer=!noProduct&&!p;
    const relationship=w.objective==='preview'||noProduct,assigned=app.activeTask(m.member_id);
    const contextFact=w.objective==='preview'?['预告款式',p?app.offerLabel(p):'暂无匹配款式']:['上次联系',m.last_contact_date||'暂无记录'];
    app.content.innerHTML=`<div class="wb-heading"><div><h2>把了解，变成一段自然的沟通。</h2><p>${app.ui.employee?'参考客户备注和产品信息，为自己负责的顾客准备话术。':'先看会员档案与客户备注，再准备参考话术，加入分派清单。'}</p></div><button data-page="products">打开产品与图片库</button></div>
      <div class="wb-layout"><aside class="wb-context"><h3>这次，为谁准备？</h3><div class="wb-field"><label for="studio-member">选择会员</label><select id="studio-member">${app.state.members.map(person=>`<option value="${person.member_id}" ${person.member_id===m.member_id?'selected':''}>${app.escape(app.memberCode(person))} · ${app.escape(person.name)} · ${app.LABELS[person.lifecycle]}</option>`).join('')}</select></div>
      <div class="wb-member"><span class="member-avatar" aria-hidden="true">${app.escape(m.name[0])}</span><div><h3>${app.escape(m.name)}</h3><p>${app.memberCode(m)} · ${app.escape(m.membership_level)} · ${app.LABELS[m.lifecycle]}</p></div></div>
      <dl class="wb-facts">${careMode?(visit?`<div><dt>最近美甲</dt><dd><strong>${visit.days} 天前</strong><small>${app.escape(visit.date)}</small></dd></div><div><dt>美甲项目</dt><dd>${app.escape(visit.name)}</dd></div>`:'<div><dt>近期美甲</dt><dd>暂无美甲服务记录</dd></div>'):relationship?`<div><dt>${contextFact[0]}</dt><dd>${app.escape(contextFact[1])}</dd></div>`:`<div><dt>未到店</dt><dd><strong>${m.days===null?'日期待确认':m.days+' 天'}</strong>${m.days===null?'':`<small>最近到店 ${app.escape(m.last_visit)}</small>`}</dd></div><div><dt>个人周期</dt><dd>${m.ratio===null?'周期待确认':`<strong>${m.cycle} 天</strong> · 当前 ${m.ratio} 倍`}</dd></div>`}<div><dt>偏好风格</dt><dd>${app.escape(m.preference)}</dd></div><div><dt>护理需求</dt><dd>${app.escape((m.care_need_tags||'待本人确认').replaceAll('|',' / '))}</dd></div></dl>
      <section class="wb-note-section"><h3>客户备注</h3>${notes.length?`<ul class="wb-notes">${notes.map(note=>`<li><small>${note.is_pinned?'置顶 · ':''}${app.escape(app.NOTE_LABELS[note.note_type]||'备注')} · ${app.escape(note.author_name||'老板娘')}</small>${app.escape(note.note_text)}</li>`).join('')}</ul>`:'<p class="helper">暂时没有备注，可以先到会员档案补充。</p>'}${app.ui.employee?'':`<button data-open-profile="${m.member_id}">查看或补充会员备注</button>`}</section>
      <details class="wb-preparation" open><summary>沟通准备 · 先了解，再推荐</summary><h4>为什么值得关注</h4><p>${careMode||noProduct||m.ratio===null||w.objective==='preview'?app.escape(app.opportunityEvidence(m,w.objective,p)):`当前为个人复购周期的 <b>${m.ratio} 倍</b>，状态为“${app.LABELS[m.lifecycle]}”。历史偏好与客户备注是沟通参考。`}</p><h4>待本人确认</h4><p>${noProduct?'听听顾客近况，确认是否需要协助，以及什么时候方便再联系。':w.objective==='preview'?'确认是否想看这款的配色或效果。':careMode?'先确认现在的佩戴情况，再听听顾客想怎么处理。':'近期是否仍有美甲或护理需求、上次体验如何、希望怎样被联系；未到店原因需听本人表达。'}</p><h4>这次的小目标</h4><p>${noProduct||w.objective==='preview'?app.escape(app.opportunityAction(m,w.objective,p)):careMode?app.escape(app.opportunityAction(m,'care',p,app.workbenchCarePhase(m))):'了解一条顾客明确表达的需求，或确认她喜欢的款式和方便沟通的方式。'}</p></details>
      </aside><section class="wb-output"><header class="wb-output-header"><div><h3>沟通草稿</h3><p>给 ${app.escape(m.name)} · ${WB_OBJECTIVES[w.objective]}</p></div><span class="pill">规则演示 · 未调用模型</span></header>
      <div class="wb-control-grid"><div class="wb-field"><label for="objective">这次想聊什么？</label><select id="objective">${Object.entries(WB_OBJECTIVES).map(([value,label])=>`<option value="${value}" ${w.objective===value?'selected':''}>${label}</option>`).join('')}</select></div><div class="wb-field"><label for="tone">表达方式</label><select id="tone">${Object.entries(WB_TONE_LABELS).map(([value,label])=>`<option value="${value}" ${w.tone===value?'selected':''}>${label}</option>`).join('')}</select></div></div>
      ${noProduct?`<p class="wb-action-note"><b>本次行动</b> · ${app.escape(app.opportunityAction(m,w.objective,p))}</p>`:`<div class="wb-field"><label for="studio-product">${w.objective==='preview'?'本次预告的款式':'本次推荐的产品 / 服务'}</label><select id="studio-product">${products.map(product=>`<option value="${product.product_id}" ${p&&product.product_id===p.product_id?'selected':''}>${app.escape(product.product_name)} · ${app.escape(app.offerLabel(product))}</option>`).join('')}</select></div>`}
      ${p?`<div class="wb-product">${workbenchPhoto(p)}<div><h4>${app.escape(p.product_name)}</h4><p>${app.escape(p.description)}</p><div class="wb-price">${app.escape(app.offerLabel(p))}</div>${app.catalogSwatch(p)?'<p class="helper">AI 甲片示意图 · 款式参考</p>':app.catalogReference(p)?'<p class="helper">网络参考图 · 可在产品库查看来源</p>':''}${app.ui.employee?'':`<button data-wb-upload="${p.product_id}">${app.catalogPhoto(p)?'更换产品图':'上传产品实拍'}</button>`}</div></div>`:noProduct?'':`<p class="empty">${w.objective==='preview'?'暂无符合条件的预告款式。':'暂时没有匹配的在售产品，请先到产品库补充。'}</p>`}
      <div class="wb-generate-row"><p>参考 ${notes.length} 条客户备注${noProduct?'与联系记录':'与款式或服务信息'}</p><button class="primary" data-wb-generate ${reasons.length||needsOffer?'disabled':''}>生成演示话术</button></div>
      ${reasons.length?`<div class="wb-restrictions">暂不适合主动联系：${app.escape(reasons.join('；'))}。当前仅供内部参考。</div>`:''}
      <div class="wb-draft-label"><label for="message-draft">话术内容 · 可以直接修改</label><small id="wb-draft-count">${w.draft.length} / 1600</small></div><textarea id="message-draft" maxlength="1600" placeholder="点击“生成演示话术”，或直接写下你想说的话。">${app.escape(w.draft)}</textarea>
      <div class="wb-customer-preview"><h4>顾客沟通预览</h4><p>这里只展示顾客会看到的内容，内部备注和经营数据留在店内。</p><div class="wb-chat-message" id="chat-message">${app.escape(w.draft||'话术准备好后，会在这里显示顾客看到的消息。')}</div>${p?`<div class="wb-chat-product">${workbenchPhoto(p)}<div><strong>${app.escape(p.product_name)}</strong><p>${app.escape(app.offerLabel(p))}</p></div></div>`:''}</div>
      ${assigned?`<p class="wb-action-note">已有待联系任务 · 负责人 ${app.escape(assigned.assignee)} <button data-view-task="${assigned.task_id}">查看任务</button></p>`:''}
      <div class="wb-actions" data-wecom-actions>${app.ui.employee?'':`<button class="primary" data-wb-submit ${assigned||reasons.length||needsOffer?'disabled':''}>加入分派清单</button>`}</div>${app.ui.employee?'':'<p class="wb-note">可以先准备话术，也可以直接加入分派清单。</p>'}
      </section></div>${app.ui.employee?'':app.careRecords()}<input class="wb-file" id="wb-image-upload" type="file" accept="image/png,image/jpeg,image/webp" aria-label="上传工作台产品实拍图">`;
  }
  function buildWorkbenchMessage(m,p,settings=app.ui.workbench){
    const w=settings,notes=app.profileNotes(m.member_id).map(n=>n.note_text).join(' '),soft=/不喜欢.*促销|不要强推/.test(notes),shape=notes.includes('短方圆')?'短方圆甲型搭起来也很自然，':'';
    const tone=WB_TONES[w.tone]||WB_TONES.friendly,brief=w.tone==='brief';
    const opening=m.name+tone.greeting;
    if(w.objective==='greeting')return opening+tone.checkIn;
    if(w.objective==='preview'){
      const preview=`「${p.product_name}」正在准备。`;
      return opening+preview+(brief?'':`这款和你之前偏好的风格比较接近。`)+tone.offer;
    }
    if(w.objective==='balance'){
      const balance=`你在店里还有 ${app.money(m.balance).replace('.00','')} 的可用余额。`;
      const product=brief||!m.preferred_styles?`想看看「${p.product_name}」吗？`:`「${p.product_name}」和你之前喜欢的${m.preferred_styles.replaceAll('|','、')}比较接近。`;
      return opening+balance+product+tone.offer;
    }
    if(w.objective==='care'){
      const visit=app.careFollowupVisit(m),tags=app.memberCareIndex.get(m.member_id)?.care_need_tags||'';
      const service=visit?`上次做的「${visit.name}」`:'上次做的美甲';
      const phase=app.workbenchCarePhase(m);
      if(phase==='removal')return opening+`${service}现在还在戴吗？如果已经卸了就好。如果还在戴、想安排卸甲，我可以帮你看看什么时候方便。`;
      if(brief)return opening+`${service}现在戴着还舒服吗？`+tone.care;
      let text=opening+`想问问${service}现在佩戴还舒服吗？甲周和甲面状态怎么样？`;
      if(/干燥|保湿/.test(tags))text+='平时可以留意一下甲缘的保湿。';
      else if(tags.includes('翘边'))text+='如果有翘边或破损，可以先发张照片给我们看看，别自己撕扯。';
      return text+tone.care+`店里有「${p.product_name}」`+(soft?'，需要时我再给你介绍。':'，如果需要，可以一起看看是否适合。');
    }
    if(brief)return opening+`可以看看「${p.product_name}」这款${p.style}美甲。`+tone.offer;
    let text=opening+(w.objective==='new_product'?'给你看看店里最近的款式。':m.lifecycle==='dormant'?'好久没见，想给你分享一个你可能会喜欢的款式。':'最近有想换个款式吗？');
    text+=`「${p.product_name}」是${p.style}风格`+(m.preferred_styles?`，${shape}和你之前喜欢的${m.preferred_styles.replaceAll('|','、')}比较接近。`:'。');
    text+=tone.offer;
    return text+(w.revision%2===0?' 有想调整的颜色或细节，也可以直接告诉我。':'');
  }
  function generateWorkbenchMessage(){
    const {p,m,reasons}=ensureWorkbench(),w=app.ui.workbench;
    if(reasons.length)throw new Error('请先查看当前联系限制。');
    if(!p&&!app.isNoProductObjective(w.objective))throw new Error('请先选择款式或服务。');
    w.revision++;w.draft=buildWorkbenchMessage(m,p);
    saveWorkbenchDraft();app.render();app.notify('参考话术已准备好。');
  }
  function updateWorkbenchPreview(){
    const w=app.ui.workbench,node=document.getElementById('message-draft');if(!node)return;w.draft=node.value;
    document.getElementById('chat-message').textContent=w.draft||'话术准备好后，会在这里显示顾客看到的消息。';document.getElementById('wb-draft-count').textContent=w.draft.length+' / 1600';
    const {p,reasons}=ensureWorkbench(),assigned=app.activeTask(w.member_id);
    const submit=document.querySelector('[data-wb-submit]');
    if(submit)submit.disabled=Boolean(assigned)||(!p&&!app.isNoProductObjective(w.objective))||reasons.length>0;
    saveWorkbenchDraft();
  }
  function addWorkbenchPick(){
    const {m,p}=ensureWorkbench(),w=app.ui.workbench;
    app.stagePick(m,w.objective,{product_id:p?.product_id||null,message:w.draft.trim()});
    app.ui.page='dashboard';
    app.render();
    app.focusDispatch();
    app.notify('已加入待分派清单。');
  }
  async function copyMessage(area){
    const text=area.value.trim();
    if(!text)throw new Error('请先准备话术。');
    try{await navigator.clipboard.writeText(text)}
    catch{area.focus();area.select();if(!document.execCommand('copy'))throw new Error('已选中草稿，请按 Ctrl+C 复制。')}
    app.notify('话术已复制。');
  }
  app.content.addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button)return;
    try{if(button.hasAttribute('data-wb-generate'))generateWorkbenchMessage();if(button.hasAttribute('data-wb-submit'))addWorkbenchPick();if(!app.ui.employee&&button.dataset.wbUpload){const input=document.getElementById('wb-image-upload');input.value='';input.click()}}
    catch(error){app.notify(error.message||'操作未完成，请重试。',true)}
  });
  app.content.addEventListener('input',event=>{if(event.target.id==='message-draft')updateWorkbenchPreview()});
  app.content.addEventListener('change',async event=>{
    const target=event.target;if(app.ui.page!=='studio')return;
    try{
      if(['studio-member','objective','tone','studio-product'].includes(target.id)){saveWorkbenchDraft();const w=app.ui.workbench;if(target.id==='studio-member')setWorkbenchMember(target.value);if(target.id==='objective'){w.objective=target.value;w.product_id=''}if(target.id==='tone')w.tone=target.value;if(target.id==='studio-product')w.product_id=target.value;w.loadedKey=null;app.render()}
      if(target.id==='wb-image-upload'&&target.files[0]){const productId=app.ui.workbench.product_id;await app.storeProductPhoto(target.files[0],productId);if(app.ui.page==='studio'&&app.ui.workbench.product_id===productId)app.render();app.notify('产品实拍图已更新，产品库与沟通预览共享这张图。')}
    }catch(error){app.notify(error.message||'操作未完成，请重试。',true)}
  });


  return {
    WB_OBJECTIVES,
    workbenchDrafts,
    workbenchProducts,
    openWorkbench,
    workbenchPhoto,
    studioPage,
    buildWorkbenchMessage,
    copyMessage,
  };
};

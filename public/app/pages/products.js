'use strict';

// app 提供共享状态的实时访问和跨页面操作；本模块保留自己的事件与局部状态。
(globalThis.NailMateApp ||= {}).createProducts = function (app) {
  const CATALOG_TYPES={nail_style:'美甲款式',care_product:'护理产品',care_service:'护理服务'};
  const CATALOG_IDEAS=[{product_id:'IDEA-SEA-SALT',product_name:'海盐冰气泡',product_type:'nail_style',style:'清透灵感',description:'清透海盐蓝底色，搭配细小气泡与冰透光泽。',image_plan:'清透海盐蓝 · 气泡点缀 · 短椭圆甲',planned:true,launch_date:'2026-11-14',preview_styles:['裸色']}];
  const CATALOG_PAGE_SIZE=8;
  Object.assign(app.ui,{catalogFilter:'all',catalogQuery:'',catalogPage:1,catalogPending:false,catalogUpload:null});
  function catalogEntries(){return [...CATALOG_IDEAS,...app.DATA.products.filter(p=>p.is_active)]}
  function catalogCustomPhoto(p){const photo=app.state.images[p.product_id];return typeof photo==='string'&&/^data:image\/(png|jpeg|webp);base64,/.test(photo)?photo:null}
  function catalogPhoto(p){return catalogCustomPhoto(p)||app.PRODUCT_IMAGES[p.product_id]?.src||null}
  function catalogDefaultImage(p){return catalogCustomPhoto(p)?null:app.PRODUCT_IMAGES[p.product_id]||null}
  function catalogReference(p){const image=catalogDefaultImage(p);return image?.source_url?image:null}
  function catalogSwatch(p){return catalogDefaultImage(p)?.kind==='generated_nail_swatch'}
  function catalogPhotoLabel(p){return catalogSwatch(p)?'AI 甲片示意图':catalogReference(p)?'网络参考图':'店主上传实拍图'}
  function catalogPhotoCredit(p){const reference=catalogReference(p);return reference?`<a class="catalog-photo-credit" href="${app.escape(reference.source_url)}" target="_blank" rel="noopener noreferrer">参考图来源 · ${app.escape(new URL(reference.source_url).hostname.replace(/^www\./,''))}</a>`:''}
  function catalogImagePlan(p){
    if(p.image_plan)return p.image_plan;
    if(p.product_type==='care_product')return '瓶身主图 · 滴管细节 · 素色背景，清晰展示标签';
    if(p.product_type==='care_service')return '手部护理过程 · 工具或操作细节 · 干净的工作台';
    return p.description.replace(/[。！？]+$/,'');
  }
  function catalogFiltered(){const query=app.ui.catalogQuery.trim().toLowerCase();return catalogEntries().filter(p=>(app.ui.catalogFilter==='all'||p.product_type===app.ui.catalogFilter)&&(!app.ui.catalogPending||!catalogPhoto(p))&&(!query||(p.product_name+p.product_id+p.style+p.description+(p.suitable_care_tags||'')).toLowerCase().includes(query)))}
  function productsPage(){
    const entries=catalogEntries(),categories=[['all','全部'],...Object.entries(CATALOG_TYPES)];
    app.content.innerHTML=`<section aria-label="门店产品图片库"><div class="catalog-heading"><div><h2>让每一款，都有一张好看的图。</h2><p>美甲款式用白底五枚甲片展示颜色和工艺。护理项目附参考图，图片可替换成门店实拍。</p></div><div class="catalog-heading-actions"><div class="catalog-swatch-strip" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>${app.ui.employee?'<button data-page="studio">打开话术工作台</button>':'<button data-page="members">回到会员档案</button>'}</div></div><div class="catalog-tools"><div class="catalog-tabs" aria-label="产品分类">${categories.map(([value,label])=>`<button data-catalog-filter="${value}" aria-pressed="${app.ui.catalogFilter===value}">${label}<span>${value==='all'?entries.length:entries.filter(p=>p.product_type===value).length}</span></button>`).join('')}</div><div class="catalog-search"><label for="catalog-search">查找产品或款式</label><input type="search" id="catalog-search" value="${app.escape(app.ui.catalogQuery)}" placeholder="例如：海盐、法式、护理油" autocomplete="off"></div></div><div class="catalog-status"><p id="catalog-count" role="status"></p><label><input type="checkbox" id="catalog-pending" ${app.ui.catalogPending?'checked':''}>只看无图项目</label></div><div id="catalog-results"></div><p class="catalog-footnote">美甲甲片图为 AI 生成的款式示意图，成品颜色与工艺以门店实作为准。护理项目的网络参考图可查看来源。<br>「海盐冰气泡」为未上架灵感。示意图和参考图随 HTML 内嵌；老板娘上传的实拍图会在产品库和话术预览中优先显示。</p><input class="catalog-file" type="file" id="catalog-upload" accept="image/png,image/jpeg,image/webp" aria-label="上传所选产品图片"></section>`;
    catalogResults();
  }
  function catalogResults(){
    const rows=catalogFiltered(),pages=Math.max(1,Math.ceil(rows.length/CATALOG_PAGE_SIZE));app.ui.catalogPage=Math.max(1,Math.min(app.ui.catalogPage,pages));
    document.getElementById('catalog-count').textContent=`找到 ${rows.length} 项 · ${app.DATA.products.filter(p=>p.is_active).length} 项门店产品 + ${CATALOG_IDEAS.length} 款待确认灵感`;
    document.querySelectorAll('[data-catalog-filter]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.catalogFilter===app.ui.catalogFilter)));
    const results=document.getElementById('catalog-results');
    results.innerHTML=rows.length?`<div class="catalog-grid">${rows.slice((app.ui.catalogPage-1)*CATALOG_PAGE_SIZE,app.ui.catalogPage*CATALOG_PAGE_SIZE).map(catalogProductCard).join('')}</div><div class="catalog-pagination"><button data-catalog-page="${app.ui.catalogPage-1}" ${app.ui.catalogPage<=1?'disabled':''}>上一页</button><span>${app.ui.catalogPage} / ${pages}</span><button data-catalog-page="${app.ui.catalogPage+1}" ${app.ui.catalogPage>=pages?'disabled':''}>下一页</button></div>`:'<div class="empty">没有找到符合条件的产品。<p><button data-catalog-clear>清空筛选</button></p></div>';
    app.setupGlass(results);
  }
  function catalogProductCard(p){
    const photo=catalogPhoto(p),reference=catalogReference(p),swatch=catalogSwatch(p),custom=Boolean(catalogCustomPhoto(p)),kind=p.planned?'待确认灵感':CATALOG_TYPES[p.product_type];
    return `<div class="glass-track"><article class="catalog-product glass-tilt glass-surface" data-product-id="${p.product_id}"><div class="catalog-image ${p.product_type==='nail_style'?'catalog-image-nail':'catalog-image-care'}${swatch?' catalog-image-swatch':''}"><span class="catalog-image-kind">${kind}</span>${photo?`<img src="${app.escape(photo)}" alt="${app.escape(p.product_name)}的${catalogPhotoLabel(p)}">`:`<div class="catalog-placeholder"><strong>${app.escape(p.product_name)}</strong><span>${app.escape(catalogImagePlan(p))}</span><small>4:5 主图 · 预留实拍位置</small></div>`}${reference?'<span class="catalog-image-reference">网络参考图</span>':''}</div><div class="catalog-product-body"><div class="catalog-product-title"><h3>${app.escape(p.product_name)}</h3>${p.planned?'':`<span class="catalog-product-price">${app.money(p.price).replace('.00','')}</span>`}</div><p class="catalog-product-description">${app.escape(p.description)}</p><p class="catalog-product-meta">${p.planned?`暂未上架 · ${app.escape(app.offerLabel(p))}`:app.escape(p.product_id+' · '+p.style+(p.service_duration_minutes?' · 约 '+p.service_duration_minutes+' 分钟':''))}</p>${catalogPhotoCredit(p)}<div class="catalog-product-footer"><span class="catalog-image-state ${custom?'uploaded':''}">${custom?'已上传实拍':swatch?'AI 甲片示意图 · 可替换':photo?'参考图 · 可替换':'等待补充图片'}</span>${app.ui.employee?'':`<button data-catalog-upload="${p.product_id}" aria-label="${photo?'更换':'上传'}${app.escape(p.product_name)}的产品图">${photo?'更换图片':'上传图片'}</button>`}</div></div></article></div>`;
  }
  app.content.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.dataset.catalogFilter){app.ui.catalogFilter=button.dataset.catalogFilter;app.ui.catalogPage=1;catalogResults()}
    if(button.dataset.catalogPage){app.ui.catalogPage=Number(button.dataset.catalogPage);catalogResults();document.getElementById('catalog-results').scrollIntoView({block:'start'})}
    if(button.hasAttribute('data-catalog-clear')){app.ui.catalogFilter='all';app.ui.catalogQuery='';app.ui.catalogPending=false;app.ui.catalogPage=1;productsPage()}
    if(!app.ui.employee&&button.dataset.catalogUpload){app.ui.catalogUpload=button.dataset.catalogUpload;const input=document.getElementById('catalog-upload');input.value='';input.click()}
  });
  app.content.addEventListener('input',event=>{if(event.target.id==='catalog-search'){app.ui.catalogQuery=event.target.value;app.ui.catalogPage=1;catalogResults()}});
  app.content.addEventListener('change',async event=>{
    if(event.target.id==='catalog-pending'){app.ui.catalogPending=event.target.checked;app.ui.catalogPage=1;catalogResults()}
    if(event.target.id==='catalog-upload'&&event.target.files[0]){
      const productId=app.ui.catalogUpload;if(!catalogEntries().some(p=>p.product_id===productId))return;
      try{await app.storeProductPhoto(event.target.files[0],productId);if(app.ui.page==='products')catalogResults();app.notify('图片已补入产品库，同款产品预览也会使用这张图。')}
      catch(error){app.notify(error.message||'图片无法读取，请换一张有效图片。',true)}
    }
  });


  return {
    CATALOG_IDEAS,
    catalogPhoto,
    catalogReference,
    catalogSwatch,
    catalogPhotoLabel,
    productsPage,
  };
};

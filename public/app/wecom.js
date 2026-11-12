'use strict';
(globalThis.NailMateApp ||= {}).createWecom = function (app) {
  const labels = {
    prepared: '准备发送',
    creating: '正在创建',
    pending: '待企微确认',
    unknown: '结果待核实',
    sent: '平台报告已发送',
    failed: '未发送 / 失败',
  };
  const esc = app.escape;
  let connectionStatus = null;
  async function updateStatus() {
    if (!app.serverMode) return;
    const status = await api('status');
    connectionStatus = status;
    app.content.querySelectorAll('[data-wecom-compose]').forEach((button) => {
      button.textContent = status.configured
        ? '通过企业微信发送'
        : '尚未配置，前往接入设置';
    });
    return status;
  }
  async function api(route, body) {
    if (!app.serverMode) throw new Error('分享版仅演示界面，不发送真实消息。');
    const response = await fetch('/api/wecom/' + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...app.identityHeader, 'Content-Type': 'application/json' },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '企微操作未完成。');
    return result;
  }
  function dialog(title) {
    const node = document.createElement('dialog');
    node.className = 'member-dialog wecom-dialog';
    node.innerHTML = `<header><h2>${esc(title)}</h2><button type="button" data-close>关闭</button></header><p data-error role="alert" class="eligibility blocked" hidden></p><div data-body></div>`;
    document.body.append(node);
    node.querySelector('[data-close]').onclick = () => node.close();
    node.addEventListener('close', () => node.remove(), { once: true });
    node.showModal();
    return node;
  }
  function error(node, e) {
    const out = node.querySelector('[data-error]');
    out.hidden = false;
    out.textContent = e.message;
  }
  async function records() {
    const node = dialog('企业微信发送记录'),
      body = node.querySelector('[data-body]');
    if (!app.serverMode) {
      body.textContent = '分享版不调用企业微信接口。';
      return;
    }
    async function load(refresh = false) {
      const result = await api(
        refresh ? 'refresh' : 'records',
        refresh ? {} : undefined,
      );
      body.innerHTML =
        `<p>“已发送”依据平台结果，不代表客户已读。客户回复请在企业微信查看。</p><button type="button" data-refresh>刷新平台结果</button>` +
          result.records
            .map(
              (row) =>
                `<article class="form-panel"><b>${esc(app.member(row.member_id)?.name || row.member_id)} · ${esc(labels[row.status] || row.status)}</b><p>${esc(row.employee)} · ${esc(row.detail)}</p><p class="wecom-message">${esc(row.message)}</p><small>${esc(new Date(row.created_at).toLocaleString('zh-CN'))}${row.has_image ? ' · 含产品图片' : ''}</small></article>`,
            )
            .join('') || '<p>暂无发送记录。</p>';
      body.querySelector('[data-refresh]').onclick = () =>
        load(true).catch((e) => error(node, e));
    }
    try {
      await load();
      const timer = setInterval(() => {
        if (node.open) load().catch((e) => error(node, e));
      }, 5000);
      node.addEventListener('close', () => clearInterval(timer), {
        once: true,
      });
    } catch (e) {
      error(node, e);
    }
  }
  async function compose(taskId) {
    const node = dialog('准备企业微信发送'),
      body = node.querySelector('[data-body]');
    if (!app.serverMode) {
      body.innerHTML =
        '<p>分享版仅供演示。正式账号版可选会员、逐人编辑文字和实拍图，并提交企业微信确认发送。</p><button disabled>提交企微发送任务</button>';
      return;
    }
    const tasks = app
      .visibleTasks()
      .filter((t) => t.status === 'assigned' && !t.withdrawn_at);
    if (!tasks.length) {
      body.textContent = '当前没有自己负责的待联系任务。';
      return;
    }
    const productOptions =
      '<option value="">不附图片</option>' +
      app.DATA.products
        .filter((p) => app.state.images[p.product_id])
        .map(
          (p) =>
            `<option value="${esc(p.product_id)}">${esc(p.product_name)}</option>`,
        )
        .join('');
    body.innerHTML = `<p>提交后需到企业微信确认；每批最多 50 人。只发送真实会员，客户回复仍在企微处理。</p>
      <label>编辑方式 <select data-mode><option value="individual">每人独立话术</option><option value="shared">多人统一内容</option></select></label>
      <section data-shared hidden><label>统一话术<textarea data-shared-message maxlength="1600"></textarea></label><label>统一产品图片<select data-shared-image>${productOptions}</select></label></section>
      <button type="button" data-generate>为所选会员生成规则演示话术</button>
      ${tasks
        .map((t) => {
          const m = app.member(t.member_id),
            draft =
              t.task_id === taskId && app.ui.page === 'studio'
                ? app.ui.workbench.draft
                : (app.ui.taskDrafts[t.task_id]?.message ?? t.message);
          return `<article class="form-panel" data-item="${esc(t.task_id)}"><label><input type="checkbox" data-selected ${t.task_id === taskId ? 'checked' : ''}> ${esc(m?.name || t.member_id)} · ${esc(app.memberCode(m || { member_id: t.member_id }))}</label><div data-individual><label>话术<textarea data-message maxlength="1600">${esc(draft)}</textarea></label><label>产品实拍图<select data-image>${productOptions}</select></label></div></article>`;
        })
        .join('')}
      <div class="button-row"><button type="button" data-preflight>检查并逐人预览</button><button type="button" class="primary" data-submit disabled>提交企微发送任务</button></div><div data-preview></div>`;
    let frozen = null,
      key = null,
      submitted = false;
    const submit = body.querySelector('[data-submit]'),
      mode = body.querySelector('[data-mode]');
    function collect() {
      return [...body.querySelectorAll('[data-item]')]
        .filter((row) => row.querySelector('[data-selected]').checked)
        .map((row) => ({
          taskId: row.dataset.item,
          message: (mode.value === 'shared'
            ? body.querySelector('[data-shared-message]')
            : row.querySelector('[data-message]')
          ).value,
          imageProductId:
            (mode.value === 'shared'
              ? body.querySelector('[data-shared-image]')
              : row.querySelector('[data-image]')
            ).value || null,
        }));
    }
    function invalidate() {
      if (submitted) return;
      frozen = null;
      key = null;
      submit.disabled = true;
      body.querySelector('[data-preview]').replaceChildren();
    }
    body.addEventListener('input', invalidate);
    body.addEventListener('change', () => {
      invalidate();
      body.querySelector('[data-shared]').hidden = mode.value !== 'shared';
      body
        .querySelectorAll('[data-individual]')
        .forEach((row) => (row.hidden = mode.value === 'shared'));
    });
    body.querySelector('[data-generate]').onclick = () => {
      if (mode.value === 'shared') {
        error(
          node,
          new Error('统一内容请手工编辑；个性化生成会分别写入每位会员的草稿。'),
        );
        return;
      }
      for (const row of body.querySelectorAll('[data-item]'))
        if (row.querySelector('[data-selected]').checked) {
          const task = tasks.find((t) => t.task_id === row.dataset.item),
            member = app.member(task.member_id),
            product = app.offerProduct(task.product_id);
          row.querySelector('[data-message]').value = app.buildWorkbenchMessage(
            member,
            product,
            { objective: task.objective, tone: 'friendly' },
          );
        }
      invalidate();
    };
    body.querySelector('[data-preflight]').onclick = async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const items = collect(),
          result = await api('preflight', { items });
        body.querySelector('[data-preview]').innerHTML = result.items
          .map(
            (row, i) =>
              `<article class="form-panel"><h3>${esc(row.name || row.taskId)}</h3><p class="wecom-message">${esc(row.message)}</p>${row.hasImage ? `<img class="wecom-preview" src="${esc(app.state.images[items[i].imageProductId])}" alt="将发送的产品实拍图">` : ''}<p>${esc(row.reasons.join('；') || '检查通过，可提交')}</p></article>`,
          )
          .join('');
        if (result.items.every((row) => !row.reasons.length)) {
          frozen = structuredClone(items);
          key = crypto.randomUUID();
          submit.disabled = false;
        }
      } catch (e) {
        error(node, e);
      } finally {
        button.disabled = false;
      }
    };
    submit.onclick = async () => {
      if (!frozen || submitted) return;
      submit.disabled = true;
      try {
        await api('submit', { items: frozen, idempotencyKey: key });
        submitted = true;
        node.close();
        await records();
      } catch (e) {
        error(node, e);
        submit.disabled = false;
      }
    };
  }
  async function bindings() {
    const node = dialog('企微员工与会员绑定'),
      body = node.querySelector('[data-body]');
    if (!app.serverMode) {
      body.textContent = '分享版不保存真实企微绑定。';
      return;
    }
    try {
      const [status, current] = await Promise.all([
        api('status'),
        api('bindings'),
      ]);
      body.innerHTML = `<p>${status.configured ? '接口凭据已配置' : '服务端尚未配置 WECOM_CORP_ID / WECOM_CONTACT_SECRET'}</p><p>候选客户来自企业微信，请核对身份后绑定。同名客户不会自动匹配。</p>
        <section class="form-panel"><h3>员工绑定</h3><label>本地员工<select data-employee>${app.STAFF.map((name) => `<option>${esc(name)}</option>`).join('')}</select></label><button type="button" data-load-users>读取企微员工</button><label>企微 userid<select data-userid></select></label><button type="button" data-save-employee>保存员工绑定</button></section>
        <section class="form-panel"><h3>会员绑定</h3><label>本地会员<select data-member>${app.state.members.map((m) => `<option value="${esc(m.member_id)}">${esc(app.memberCode(m))} · ${esc(m.name)}</option>`).join('')}</select></label><label>负责员工<select data-owner>${current.employees.map((e) => `<option value="${esc(e.employee)}" data-userid="${esc(e.userid)}">${esc(e.employee)} · ${esc(e.userid)}</option>`).join('')}</select></label><button type="button" data-load-customers>读取该员工企微客户</button><label>企微客户<select data-customer></select></label><p data-customer-detail></p><button type="button" data-save-member>确认身份并保存会员绑定</button></section>
        <h3>现有绑定</h3>${current.employees.map((e) => `<p>${esc(e.employee)} → ${esc(e.userid)}</p>`).join('')}${current.members.map((m) => `<p>${esc(m.member_id)} → ${esc(m.external_userid)}</p>`).join('')}`;
      const run = (selector, work) =>
        (body.querySelector(selector).onclick = async (event) => {
          const button = event.currentTarget;
          button.disabled = true;
          try {
            await work();
          } catch (e) {
            error(node, e);
          } finally {
            button.disabled = false;
          }
        });
      run('[data-load-users]', async () => {
        body.querySelector('[data-userid]').innerHTML = (
          await api('employees')
        ).userids
          .map((id) => `<option>${esc(id)}</option>`)
          .join('');
      });
      run('[data-save-employee]', async () => {
        await api('bindings/employee', {
          employee: body.querySelector('[data-employee]').value,
          userid: body.querySelector('[data-userid]').value,
        });
        node.close();
        await bindings();
      });
      let verified = null;
      run('[data-load-customers]', async () => {
        const option = body.querySelector('[data-owner]').selectedOptions[0];
        if (!option) throw new Error('请先绑定员工。');
        body.querySelector('[data-customer]').innerHTML = (
          await api(
            'customers?userid=' + encodeURIComponent(option.dataset.userid),
          )
        ).externalUserids
          .map((id) => `<option>${esc(id)}</option>`)
          .join('');
        await inspect();
      });
      async function inspect() {
        verified = null;
        const id = body.querySelector('[data-customer]').value;
        if (!id) return;
        const result = await api('customer?id=' + encodeURIComponent(id));
        body.querySelector('[data-customer-detail]').textContent = [
          result.external_contact?.name,
          id,
        ]
          .filter(Boolean)
          .join(' · ');
        verified = id;
      }
      body.querySelector('[data-customer]').onchange = () =>
        inspect().catch((e) => error(node, e));
      body.querySelector('[data-owner]').onchange = () => {
        verified = null;
        body.querySelector('[data-customer]').replaceChildren();
        body.querySelector('[data-customer-detail]').textContent = '';
      };
      run('[data-save-member]', async () => {
        if (!verified) throw new Error('请先读取并核对企微客户。');
        await api('bindings/member', {
          memberId: body.querySelector('[data-member]').value,
          employee: body.querySelector('[data-owner]').value,
          externalUserid: verified,
        });
        app.notify('会员企微绑定已保存。');
        node.close();
      });
    } catch (e) {
      error(node, e);
    }
  }
  function mount() {
    const bar = document.createElement('div');
    bar.className = 'button-row wecom-toolbar';
    bar.innerHTML = `${app.ui.employee && ['studio', 'campaigns'].includes(app.ui.page) ? `<button type="button" ${app.ui.page === 'studio' ? 'class="primary"' : ''} data-wecom-compose>${connectionStatus?.configured === false ? '尚未配置，前往接入设置' : '通过企业微信发送'}</button>` : ''}<button type="button" data-wecom-records>企微发送记录</button>${app.USER.role === 'owner' ? '<button type="button" data-wecom-settings>企微接入设置</button>' : ''}<button type="button" data-kf-open>微信客服会话</button>`;
    const studioActions =
      app.ui.page === 'studio' &&
      app.content.querySelector('[data-wecom-actions]');
    if (studioActions) studioActions.append(...bar.children);
    else app.content.prepend(bar);
    updateStatus().catch(() => {});
  }
  app.content.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-wecom-compose')) {
      const task = app.activeTask(app.ui.workbench?.member_id);
      (async () => {
        const status = app.serverMode
          ? await updateStatus()
          : { configured: true };
        if (!status.configured) {
          window.dispatchEvent(new Event('nailmate-open-wecom-settings'));
          return;
        }
        await compose(task?.task_id);
      })().catch((e) => app.notify(e.message, true));
    }
    if (button.hasAttribute('data-wecom-records'))
      records().catch((e) => app.notify(e.message, true));
    if (button.hasAttribute('data-wecom-bindings'))
      bindings().catch((e) => app.notify(e.message, true));
  });
  window.addEventListener('nailmate-wecom-config-changed', () =>
    updateStatus().catch(() => {}),
  );
  window.addEventListener('focus', () => {
    if (!document.hidden) updateStatus().catch(() => {});
  });
  return {
    mount,
    compose,
    records,
    bindings,
    dialog,
    error,
    api,
    updateStatus,
  };
};

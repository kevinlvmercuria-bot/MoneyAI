'use strict';
(globalThis.NailMateApp ||= {}).createWecomAdmin = function (app, wecom) {
  const esc = app.escape,
    api = (route, body) => wecom.api('admin/' + route, body);
  function checksHTML(check) {
    return check
      ? `<p>${check.ok ? '基础检测通过' : '检测未通过'} · ${esc(new Date(check.checkedAt).toLocaleString('zh-CN'))}</p><ul>${check.checks.map((item) => `<li><strong>${esc(item.label)}</strong>：${esc({ passed: '通过', failed: '失败', pending: '待检测' }[item.status])} · ${esc(item.detail)}${item.code ? `（错误码 ${esc(item.code)}）` : ''}</li>`).join('')}</ul>`
      : '<p>尚未检测。保存配置后，请运行连接与权限检测。</p>';
  }
  async function settings() {
    const node = wecom.dialog('企微接入设置'),
      body = node.querySelector('[data-body]');
    if (!app.serverMode) {
      body.textContent = '分享版不保存真实密钥，请进入正式账号工作台配置。';
      return;
    }
    if (app.USER.role !== 'owner') {
      body.textContent =
        '尚未配置企业微信。请联系老板娘或管理员，在“员工账号管理 → 企微接入设置”完成配置。店员无需填写或查看密钥。';
      return;
    }
    try {
      let current = await api('settings');
      body.innerHTML = `<form data-settings-form><label>企业 ID（CorpID）<input data-corp-id required autocomplete="off" value="${esc(current.corpId)}"></label><label>客户联系应用密钥（Secret）<input data-contact-secret type="password" autocomplete="new-password" placeholder="${current.contactConfigured ? '已保存，留空保持不变' : '请输入应用密钥'}"></label>
    <details><summary>微信客服与回调设置（选填）</summary><label>微信客服应用密钥<input data-kf-secret type="password" autocomplete="new-password" placeholder="留空保持原设置"></label><label>回调 Token<input data-callback-token type="password" autocomplete="new-password" placeholder="留空保持原设置"></label><label>EncodingAESKey<input data-callback-key type="password" autocomplete="new-password" placeholder="43 位回调加密密钥"></label><p>客服回调地址：<code>${esc(location.origin)}/api/wecom/kf/callback</code></p></details>
    <p class="helper">密钥加密保存，不回显。保存后立即应用；应用可见范围、客户联系可调用应用和可信 IP 需在企微后台配置。</p><button class="primary" type="submit">保存并应用</button><p data-save-result role="status"></p></form>
    <section class="form-panel"><h3>连接与权限检测</h3><button type="button" data-check>运行检测</button><div data-checks>${checksHTML(current.lastCheck)}</div></section>
    <section class="form-panel"><h3>真实测试向导</h3><p>按顺序绑定测试员工与真实客户，预览测试话术，提交并核对企微确认发送结果。</p><button type="button" data-wizard>开始真实测试向导</button><button type="button" data-bindings>管理已有企微绑定</button></section>`;
      body.querySelector('[data-settings-form]').onsubmit = async (event) => {
        event.preventDefault();
        const button = event.submitter;
        button.disabled = true;
        try {
          current = await api('settings', {
            corpId: body.querySelector('[data-corp-id]').value,
            contactSecret: body.querySelector('[data-contact-secret]').value,
            kfSecret: body.querySelector('[data-kf-secret]').value,
            callbackToken: body.querySelector('[data-callback-token]').value,
            callbackKey: body.querySelector('[data-callback-key]').value,
          });
          body
            .querySelectorAll('input[type="password"]')
            .forEach((input) => (input.value = ''));
          body.querySelector('[data-contact-secret]').placeholder =
            '已保存，留空保持不变';
          body.querySelector('[data-save-result]').textContent =
            '已保存并应用。请继续运行连接与权限检测。';
          body.querySelector('[data-checks]').innerHTML = checksHTML(null);
          window.dispatchEvent(new Event('nailmate-wecom-config-changed'));
        } catch (error) {
          wecom.error(node, error);
        } finally {
          button.disabled = false;
        }
      };
      body.querySelector('[data-check]').onclick = async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        body.querySelector('[data-checks]').textContent =
          '正在核实密钥、接口权限和应用范围…';
        try {
          body.querySelector('[data-checks]').innerHTML = checksHTML(
            await api('check', {}),
          );
        } catch (error) {
          wecom.error(node, error);
        } finally {
          button.disabled = false;
        }
      };
      body.querySelector('[data-wizard]').onclick = () => {
        node.close();
        wizard().catch((error) => app.notify(error.message, true));
      };
      body.querySelector('[data-bindings]').onclick = () => {
        node.close();
        wecom.bindings().catch((error) => app.notify(error.message, true));
      };
    } catch (error) {
      wecom.error(node, error);
    }
  }
  async function wizard() {
    const node = wecom.dialog('企微真实测试向导'),
      body = node.querySelector('[data-body]');
    if (!app.serverMode || app.USER.role !== 'owner') {
      body.textContent = '真实测试需由正式账号版的管理员操作。';
      return;
    }
    try {
      const config = await api('settings');
      if (!config.contactConfigured) {
        body.innerHTML =
          '<p>请先填写并保存企微接入配置。</p><button type="button" data-settings>前往接入设置</button>';
        body.querySelector('[data-settings]').onclick = () => {
          node.close();
          settings();
        };
        return;
      }
      const [data, remote] = await Promise.all([
        api('wizard'),
        wecom.api('employees'),
      ]);
      body.innerHTML = `<section class="form-panel"><h3>1. 检查接入</h3><button type="button" data-check>连接与权限检测</button><div data-checks>${checksHTML(config.lastCheck)}</div></section>
    <section class="form-panel"><h3>2. 绑定测试员工和客户</h3>${!data.employees.length ? '<p>请先为测试员工开通工作台账号。</p>' : ''}${!data.members.length ? '<p>当前没有真实会员，请先导入或登记测试客户。</p><button type="button" data-import>导入真实会员</button>' : ''}
    <label>本地员工<select data-local-employee>${data.employees.map((e) => `<option value="${esc(e.employee)}">${esc(e.employee)}</option>`).join('')}</select></label><label>对应企微员工<select data-remote-employee>${remote.userids.map((id) => `<option>${esc(id)}</option>`).join('')}</select></label>
    <label>真实会员<select data-local-member>${data.members.map((m) => `<option value="${esc(m.memberId)}">${esc(m.number)} · ${esc(m.name)}${m.phone ? ' · ' + esc(m.phone) : ''}</option>`).join('')}</select></label>
    <button type="button" data-load-customers>读取企微测试客户</button><label>对应企微客户<select data-remote-customer></select></label><p data-customer-name></p><button type="button" data-save-bindings>保存测试绑定</button><p data-binding-result role="status"></p></section>
    <section class="form-panel"><h3>3. 预览并提交真实测试</h3><p>仅限已获得营销联系授权的真实客户；不会绕过冷却、投诉或已有任务限制。提交后仍需店员在企业微信确认。</p><label>测试话术<textarea data-message maxlength="1600">您好，这是门店联系系统的一次连接测试，请忽略。如有打扰请告诉我们。</textarea></label><button type="button" data-preview>预览并校验测试发送</button><div data-preview-result></div><label><input type="checkbox" data-confirm>已与这位测试客户约定，并核对以上接收人和话术</label><button type="button" class="primary" data-send disabled>提交这一次真实测试</button></section>
    <section class="form-panel"><h3>4. 确认发送并核对结果</h3><p>请负责员工在企微确认发送，再刷新核对。只有平台报告已发送才标记测试完成。</p><button type="button" data-refresh disabled>刷新并核对结果</button><div data-results></div></section>`;
      const get = (selector) => body.querySelector(selector),
        state = {
          preview: null,
          key: null,
          batch: null,
          verifiedCustomer: null,
        };
      const run = (selector, fn) =>
        (get(selector).onclick = async (event) => {
          const button = event.currentTarget;
          button.disabled = true;
          try {
            await fn();
          } catch (error) {
            wecom.error(node, error);
          } finally {
            if (button.isConnected) button.disabled = false;
          }
        });
      const payload = () => ({
        employee: get('[data-local-employee]').value,
        memberId: get('[data-local-member]').value,
        message: get('[data-message]').value,
      });
      function invalidate() {
        state.preview = null;
        state.key = null;
        get('[data-send]').disabled = true;
        get('[data-preview-result]').replaceChildren();
        get('[data-confirm]').checked = false;
      }
      for (const selector of [
        '[data-local-employee]',
        '[data-remote-employee]',
        '[data-local-member]',
        '[data-remote-customer]',
        '[data-message]',
      ])
        get(selector).addEventListener('change', invalidate);
      get('[data-message]').addEventListener('input', invalidate);
      const mapping = data.employees.find(
        (e) => e.employee === get('[data-local-employee]').value,
      );
      if (mapping?.userid) get('[data-remote-employee]').value = mapping.userid;
      async function check() {
        const result = await api('check', {
          userid: get('[data-remote-employee]').value || undefined,
        });
        get('[data-checks]').innerHTML = checksHTML(result);
        return result;
      }
      run('[data-check]', check);
      async function inspectCustomer() {
        state.verifiedCustomer = null;
        const id = get('[data-remote-customer]').value;
        if (!id) return;
        const result = await wecom.api('customer?id=' + encodeURIComponent(id));
        if (get('[data-remote-customer]').value !== id) return;
        get('[data-customer-name]').textContent = [
          result.external_contact?.name,
          id,
        ]
          .filter(Boolean)
          .join(' · ');
        state.verifiedCustomer = id;
      }
      run('[data-load-customers]', async () => {
        const result = await wecom.api(
          'customers?userid=' +
            encodeURIComponent(get('[data-remote-employee]').value),
        );
        get('[data-remote-customer]').innerHTML = result.externalUserids
          .map((id) => `<option>${esc(id)}</option>`)
          .join('');
        await inspectCustomer();
      });
      get('[data-remote-customer]').addEventListener('change', () =>
        inspectCustomer().catch((error) => wecom.error(node, error)),
      );
      for (const selector of [
        '[data-local-employee]',
        '[data-remote-employee]',
      ])
        get(selector).addEventListener('change', () => {
          state.verifiedCustomer = null;
          get('[data-remote-customer]').replaceChildren();
          get('[data-customer-name]').textContent = '';
        });
      run('[data-save-bindings]', async () => {
        if (!state.verifiedCustomer)
          throw new Error('请先读取并核对企微客户。');
        await wecom.api('bindings/employee', {
          employee: get('[data-local-employee]').value,
          userid: get('[data-remote-employee]').value,
        });
        await wecom.api('bindings/member', {
          memberId: get('[data-local-member]').value,
          employee: get('[data-local-employee]').value,
          externalUserid: state.verifiedCustomer,
        });
        get('[data-binding-result]').textContent = '测试绑定已保存。';
        await check();
      });
      run('[data-preview]', async () => {
        const result = await api('wizard/preview', payload());
        state.preview = payload();
        state.key = crypto.randomUUID();
        get('[data-preview-result]').innerHTML =
          `<p><b>${esc(result.name)}</b> · 负责员工 ${esc(result.employee)}</p><p class="wecom-message">${esc(result.message)}</p>`;
        get('[data-send]').disabled = !get('[data-confirm]').checked;
      });
      get('[data-confirm]').onchange = () =>
        (get('[data-send]').disabled =
          !state.preview || !get('[data-confirm]').checked);
      get('[data-send]').onclick = async () => {
        if (!state.preview || !get('[data-confirm]').checked) return;
        get('[data-send]').disabled = true;
        try {
          const result = await api('wizard/send', {
            ...state.preview,
            idempotencyKey: state.key,
            confirmed: true,
          });
          state.batch = result.batchId;
          get('[data-refresh]').disabled = false;
          get('[data-results]').textContent =
            '已提交，等待企微创建任务并由负责员工确认。';
        } catch (error) {
          wecom.error(node, error);
          get('[data-send]').disabled = false;
        }
      };
      run('[data-refresh]', async () => {
        const result = await wecom.api('refresh', {}),
          rows = result.records.filter((r) => r.batch_id === state.batch);
        get('[data-results]').innerHTML =
          rows
            .map(
              (r) =>
                `<p>${r.status === 'sent' ? '测试完成：平台报告已发送' : esc({ prepared: '准备发送', creating: '正在创建', pending: '待店员企微确认', unknown: '结果待核实，禁止重发', failed: '测试失败' }[r.status] || r.status)} · ${esc(r.detail)}</p>`,
            )
            .join('') || '<p>尚未查到结果，请稍后刷新。</p>';
      });
      if (get('[data-import]'))
        get('[data-import]').onclick = () => {
          node.close();
          window.dispatchEvent(new Event('nailmate-open-member-import'));
        };
    } catch (error) {
      wecom.error(node, error);
    }
  }
  app.content.addEventListener('click', (event) => {
    if (event.target.closest('[data-wecom-settings]'))
      settings().catch((error) => app.notify(error.message, true));
  });
  window.addEventListener('nailmate-open-wecom-settings', () =>
    settings().catch((error) => app.notify(error.message, true)),
  );
  return { settings, wizard };
};

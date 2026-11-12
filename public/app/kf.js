'use strict';
(globalThis.NailMateApp ||= {}).createKf = function (app, wecom) {
  const esc = app.escape;
  async function api(route, body) {
    const response = await fetch('/api/wecom/kf/' + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...app.identityHeader, 'Content-Type': 'application/json' },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '客服操作未完成。');
    return result;
  }
  async function open() {
    const node = wecom.dialog('微信客服会话'),
      body = node.querySelector('[data-body]');
    if (!app.serverMode) {
      body.textContent =
        '分享版不连接真实客服。正式版通过微信客服入口接待咨询，与企微好友聊天分别管理。';
      return;
    }
    let conversationId = null,
      timer,
      sending = false;
    const drafts = new Map();
    node.addEventListener('close', () => clearInterval(timer), { once: true });
    try {
      const status = await api('status');
      body.innerHTML = `<p>这里接收微信客服渠道的咨询。原企微好友聊天请继续在企业微信处理。${status.configured ? '' : '服务端尚未配置 WECOM_KF_SECRET。'}</p>
        ${app.USER.role === 'owner' ? '<button type="button" data-accounts>读取客服账号 / 获取咨询入口</button><div data-accounts-panel></div>' : ''}
        <button type="button" data-list-refresh>刷新会话列表</button><label>客服会话<select data-conversations><option value="">选择会话</option></select></label>
        <div data-assignment></div><div data-messages aria-live="polite"></div>
        <form data-reply><p data-eligibility></p><label>回复内容<textarea maxlength="1600" required data-message></textarea></label><button type="submit" disabled data-send>发送客服回复</button></form>`;
      const select = body.querySelector('[data-conversations]'),
        area = body.querySelector('[data-message]'),
        send = body.querySelector('[data-send]');
      let conversations = [];
      function remember() {
        if (conversationId) drafts.set(conversationId, area.value);
      }
      async function list() {
        conversations = (await api('conversations')).conversations;
        select.innerHTML =
          '<option value="">选择会话</option>' +
          conversations
            .map(
              (c) =>
                `<option value="${esc(c.id)}">${esc(c.account_name)} · ${esc(app.member(c.member_id)?.name || c.external_userid)} · ${esc(c.employee || '待分配')}</option>`,
            )
            .join('');
        select.value = conversationId || '';
      }
      async function messages() {
        if (!conversationId || !node.open) return;
        const id = conversationId,
          result = await api('messages/' + id);
        if (id !== conversationId) return;
        body.querySelector('[data-messages]').innerHTML = result.messages
          .map(
            (row) =>
              `<article class="kf-message ${row.direction === 'outbound' ? 'outbound' : ''}"><small>${esc(row.direction === 'inbound' ? '客户' : row.direction === 'outbound' ? '门店' : '事件')} · ${esc(new Date(row.sent_at).toLocaleString('zh-CN'))} · ${esc({ accepted: '平台已受理（非送达确认）', received: '已同步', sending: '正在发送', unknown: '结果待核实，禁止自动重发', failed: '发送失败' }[row.status] || row.status)}</small><p class="wecom-message">${esc(row.payload.text?.content || (row.msgtype === 'event' ? '会话事件' : `[${row.msgtype}消息]`))}</p>${row.msgtype === 'image' ? `<img loading="lazy" class="wecom-preview" src="/api/wecom/kf/image/${encodeURIComponent(id)}/${encodeURIComponent(row.id)}" alt="客户发送的图片">` : ''}${row.payload.failure || row.payload.error ? '<p>平台报告异常，请核对后处理。</p>' : ''}</article>`,
          )
          .join('');
        body.querySelector('[data-eligibility]').textContent = result.remaining
          ? `本轮剩余 ${result.remaining} 条；回复窗口至 ${new Date(result.windowUntil).toLocaleString('zh-CN')}。平台还会复核会话状态。`
          : '当前无可用回复额度，请等待客户再次发起咨询。';
        send.disabled = sending || !result.remaining;
      }
      select.onchange = async () => {
        remember();
        conversationId = select.value;
        area.value = drafts.get(conversationId) || '';
        const row = conversations.find((c) => c.id === conversationId),
          assignment = body.querySelector('[data-assignment]');
        assignment.replaceChildren();
        body.querySelector('[data-messages]').replaceChildren();
        send.disabled = true;
        if (row && app.USER.role === 'owner') {
          assignment.innerHTML = `<label>负责员工<select data-employee>${app.STAFF.map((name) => `<option ${name === row.employee ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select></label><label>关联会员（人工核对）<select data-member><option value="">暂不关联</option>${app.state.members.map((m) => `<option value="${esc(m.member_id)}" ${m.member_id === row.member_id ? 'selected' : ''}>${esc(app.memberCode(m))} · ${esc(m.name)}</option>`).join('')}</select></label><button type="button" data-assign>保存分配与会员关联</button>`;
          assignment.querySelector('[data-assign]').onclick = async () => {
            try {
              await api('assign', {
                conversationId,
                employee: assignment.querySelector('[data-employee]').value,
                memberId:
                  assignment.querySelector('[data-member]').value || null,
              });
              await list();
              app.notify('客服会话分配已保存。');
            } catch (e) {
              wecom.error(node, e);
            }
          };
        }
        messages().catch((e) => wecom.error(node, e));
      };
      let pending = null;
      area.oninput = () => {
        remember();
        if (pending && pending.message !== area.value) pending = null;
      };
      body.querySelector('[data-reply]').onsubmit = async (event) => {
        event.preventDefault();
        if (!conversationId || sending) return;
        remember();
        if (
          !pending ||
          pending.conversationId !== conversationId ||
          pending.message !== area.value
        )
          pending = {
            conversationId,
            message: area.value,
            idempotencyKey: crypto.randomUUID(),
          };
        sending = true;
        send.disabled = true;
        try {
          const result = await api('send', pending);
          if (['accepted', 'sending', 'unknown'].includes(result.status)) {
            area.value = '';
            drafts.delete(conversationId);
            pending = null;
          }
          if (result.status === 'failed') {
            pending = null;
            wecom.error(node, new Error('平台明确拒绝了本次回复，请核对消息记录中的原因后重试。'));
          }
          await messages();
        } catch (e) {
          wecom.error(node, e);
        } finally {
          sending = false;
          await messages().catch((e) => wecom.error(node, e));
        }
      };
      body.querySelector('[data-list-refresh]').onclick = () =>
        list()
          .then(messages)
          .catch((e) => wecom.error(node, e));
      if (app.USER.role === 'owner')
        body.querySelector('[data-accounts]').onclick = async () => {
          try {
            await api('accounts/sync', {});
            const accounts = (await api('accounts')).accounts,
              panel = body.querySelector('[data-accounts-panel]');
            panel.innerHTML = accounts
              .map(
                (a) =>
                  `<p>${esc(a.name)} · ${esc(a.last_error || '同步正常')} <button type="button" data-entry="${esc(a.open_kfid)}">生成客户咨询入口</button></p>`,
              )
              .join('');
            panel.querySelectorAll('[data-entry]').forEach(
              (button) =>
                (button.onclick = async () => {
                  try {
                    const entry = await api('entry', {
                      openKfid: button.dataset.entry,
                    });
                    const url = new URL(entry.url);
                    if (url.protocol !== 'https:')
                      throw new Error('客服入口链接无效。');
                    const anchor = document.createElement('a');
                    anchor.href = url.href;
                    anchor.target = '_blank';
                    anchor.rel = 'noopener noreferrer';
                    anchor.textContent = '打开客服咨询入口（可复制链接给会员）';
                    button.after(anchor);
                  } catch (e) {
                    wecom.error(node, e);
                  }
                }),
            );
          } catch (e) {
            wecom.error(node, e);
          }
        };
      await list();
      timer = setInterval(
        () => messages().catch((e) => wecom.error(node, e)),
        5000,
      );
    } catch (e) {
      wecom.error(node, e);
    }
  }
  app.content.addEventListener('click', (event) => {
    if (event.target.closest('[data-kf-open]'))
      open().catch((e) => app.notify(e.message, true));
  });
  return { open };
};

'use strict';
(globalThis.NailMateApp ||= {}).createMemberImportUI = function (app, wecom) {
  const esc = app.escape;
  async function api(route, body, raw = false) {
    const response = await fetch('/api/team/import/' + route, {
      method: 'POST',
      headers: {
        ...app.identityHeader,
        'Content-Type': raw ? 'application/octet-stream' : 'application/json',
      },
      body: raw ? body : JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '导入未完成。');
    return result;
  }
  async function open() {
    const node = wecom.dialog('导入真实会员'),
      body = node.querySelector('[data-body]');
    if (!app.serverMode || app.USER.role !== 'owner') {
      body.textContent = '真实会员导入仅限正式账号版的管理员使用。';
      return;
    }
    body.innerHTML = `<p>支持 Excel（.xlsx）和 CSV，每批最多 500 位、文件不超过 5 MB。姓名和手机号必填，只新增，不覆盖已有会员。</p><p><a href="/api/team/import/template/xlsx" download>下载 Excel 模板</a> · <a href="/api/team/import/template/csv" download>下载 CSV 模板</a></p>
   <label>1. 选择文件<input type="file" accept=".xlsx,.csv" data-file></label><button type="button" data-inspect>读取文件</button><section data-mapping></section><section data-preview></section>`;
    let upload = null,
      preview = null,
      generation = 0;
    const get = (selector) => body.querySelector(selector);
    get('[data-file]').onchange = () => {
      generation++;
      upload = null;
      preview = null;
      get('[data-mapping]').replaceChildren();
      get('[data-preview]').replaceChildren();
    };
    get('[data-inspect]').onclick = async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      const requestVersion = ++generation;
      try {
        const file = get('[data-file]').files[0];
        if (!file) throw new Error('请选择 Excel 或 CSV 文件。');
        const format = file.name.split('.').at(-1).toLowerCase();
        if (!['xlsx', 'csv'].includes(format))
          throw new Error('仅支持 .xlsx 或 .csv。');
        if (file.size > 5 * 1024 * 1024) throw new Error('文件不能超过 5 MB。');
        const inspected = await api(
          'inspect?format=' + format,
          await file.arrayBuffer(),
          true,
        );
        if (requestVersion !== generation) return;
        upload = inspected;
        preview = null;
        get('[data-mapping]').innerHTML =
          `<h3>2. 匹配字段 · ${upload.rowCount} 行会员</h3><p>确认每个字段对应的文件列；不需要的可留空。</p>${upload.fields.map((field) => `<label>${esc(field.label)}${field.required ? '（必填）' : ''}<select data-field="${field.key}"><option value="">不导入此字段</option>${upload.headers.map((header, index) => `<option value="${index}" ${upload.mapping[field.key] === index ? 'selected' : ''}>${esc(header)}</option>`).join('')}</select></label>`).join('')}<button type="button" data-validate>预览并校验</button>`;
        get('[data-mapping]').onchange = () => {
          generation++;
          preview = null;
          get('[data-preview]').replaceChildren();
        };
        get('[data-validate]').onclick = async (event) => {
          const button = event.currentTarget;
          button.disabled = true;
          const previewVersion = generation;
          try {
            const mapping = Object.fromEntries(
              [...body.querySelectorAll('[data-field]')].map((select) => [
                select.dataset.field,
                select.value === '' ? null : Number(select.value),
              ]),
            );
            const result = await api('preview', {
              uploadId: upload.uploadId,
              mapping,
            });
            if (previewVersion !== generation) return;
            preview = result;
            get('[data-preview]').innerHTML =
              `<h3>3. 核对并导入</h3><p>${esc(preview.warning)}</p>${preview.alreadyImported ? `<p>这份数据已经导入过 ${preview.alreadyImported.imported} 位会员，不会重复新增。</p>` : `<p>${preview.rowCount} 行，发现 ${preview.errorCount} 个问题。${preview.rows.length < preview.rowCount ? '下方展示前 100 行。' : ''}</p>`}
     ${preview.errors.length ? `<ul class="eligibility blocked">${preview.errors.map((error) => `<li>第 ${error.row} 行 ${esc(error.name)}：${esc(error.issues.join('；'))}</li>`).join('')}</ul>` : ''}
     <div class="import-table"><table><thead><tr><th>姓名</th><th>手机号</th><th>等级</th><th>余额</th><th>营销授权</th><th>护理授权</th></tr></thead><tbody>${preview.rows.map((row) => `<tr><td>${esc(row.name)}</td><td>${esc(row.phone)}</td><td>${esc(row.membershipLevel)}</td><td>${esc(row.balance || '未填写')}</td><td>${row.marketingConsent ? '是' : '否'}</td><td>${row.careOptIn ? '是' : '否'}</td></tr>`).join('')}</tbody></table></div>
     <label><input type="checkbox" data-confirm-import>已核对预览数据</label><button type="button" class="primary" data-commit disabled>确认导入 ${preview.rowCount} 位真实会员</button>`;
            get('[data-confirm-import]').onchange = () =>
              (get('[data-commit]').disabled =
                !get('[data-confirm-import]').checked ||
                preview.errorCount > 0 ||
                Boolean(preview.alreadyImported));
            get('[data-commit]').onclick = async () => {
              get('[data-commit]').disabled = true;
              const controls = [
                ...body.querySelectorAll(
                  '[data-file],[data-field],[data-inspect],[data-validate]',
                ),
              ];
              controls.forEach((control) => (control.disabled = true));
              try {
                const result = await api('commit', {
                  uploadId: preview.uploadId,
                  revision: preview.revision,
                });
                await app.apiAction('bootstrap', {});
                node.close();
                Object.assign(app.ui, {
                  query: '',
                  lifecycle: '全部',
                  tag: '全部',
                  memberFilter: 'all',
                  memberPage: 1,
                });
                if (result.memberIds[0]) app.selectProfile(result.memberIds[0]);
                app.showPage('members');
                app.notify(`已导入 ${result.imported} 位真实会员。`);
              } catch (error) {
                wecom.error(node, error);
                get('[data-commit]').disabled = false;
              } finally {
                controls.forEach((control) => (control.disabled = false));
              }
            };
          } catch (error) {
            wecom.error(node, error);
          } finally {
            button.disabled = false;
          }
        };
      } catch (error) {
        wecom.error(node, error);
      } finally {
        button.disabled = false;
      }
    };
  }
  app.content.addEventListener('click', (event) => {
    if (event.target.closest('[data-member-import]'))
      open().catch((error) => app.notify(error.message, true));
  });
  window.addEventListener('nailmate-open-member-import', () =>
    open().catch((error) => app.notify(error.message, true)),
  );
  return { open };
};

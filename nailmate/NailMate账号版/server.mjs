import { createServer } from 'node:http';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.NAILMATE_PORT || 8787);
const dataDir = process.env.NAILMATE_DATA_DIR || join(root, 'data');
const storePath = join(dataDir, 'store.json');
const template = readFileSync(join(root, 'app.html'), 'utf8');
const dataBlock = /(<script id="nailmate-data" type="application\/json">)([\s\S]*?)(<\/script>)/;
const snapshot = JSON.parse(template.match(dataBlock)[2]);
const members = new Map(snapshot.members.map(row => [row.member_id, row]));
const roster = [...new Set(snapshot.members.map(row => row.preferred_technician).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
const products = new Map(snapshot.products.map(row => [row.product_id, row]));
products.set('IDEA-SEA-SALT', { product_type: 'nail_style', launch_date: '2026-11-14', style: '裸色' });
const objectives = new Map(Object.entries({ repurchase: '复购邀请', balance: '储值关怀', new_product: '新品推荐', care: '护理关怀', preview: '新品预告', greeting: '日常问候' }));
const outcomes = ['未回复', '有意向', '已预约', '已沟通', '暂不联系', '不再营销'];
const noteTypes = ['preference', 'communication', 'service', 'care', 'appointment'];
const careProfiles = new Map(snapshot.member_care_profiles.map(row => [row.member_id, row]));
const snapshotNotes = new Map(snapshot.member_notes.map(row => [row.note_id, row]));
const recentNails = new Map();
for (const order of snapshot.orders) {
  if (order.order_type !== 'nail_service' || order.order_date > snapshot.as_of_date) continue;
  const previous = recentNails.get(order.member_id);
  if (!previous || order.order_date > previous) recentNails.set(order.member_id, order.order_date);
}

mkdirSync(dataDir, { recursive: true });
let store = { accounts: [], tasks: [], notes: [], noteEdits: {}, images: {}, memberUpdates: {}, care_records: [], logs: [], revision: 0 };
try {
  store = JSON.parse(readFileSync(storePath, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const sessions = new Map();
const loginAttempts = new Map();
const sessionTime = 8 * 60 * 60 * 1000;
const cookieName = 'nailmate_session';
const day = 86400000;
const today = () => [snapshot.as_of_date, new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })].sort().at(-1);
const daysBetween = (later, earlier) => (Date.parse(later) - Date.parse(earlier)) / day;
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const embed = value => JSON.stringify(value).replaceAll('<', '\\u003c');
const staff = () => store.accounts.filter(account => account.role === 'employee').map(account => account.employee);

function requireCondition(condition, status, message) {
  if (!condition) throw Object.assign(new Error(message), { status });
}

function field(value, max, required = false) {
  requireCondition(typeof value === 'string' && value.length <= max && (!required || value.trim()), 400, '请检查填写内容和长度。');
  return value.trim();
}

function commit(next) {
  next.revision = store.revision + 1;
  const temporary = join(dataDir, 'store.tmp');
  writeFileSync(temporary, JSON.stringify(next), { mode: 0o600 });
  renameSync(temporary, storePath);
  store = next;
}

function accountFor(request) {
  const token = request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  const session = sessions.get(token);
  if (!session || session.expires <= Date.now()) {
    if (token) sessions.delete(token);
    return {};
  }
  return { account: store.accounts.find(account => account.id === session.id && account.salt === session.salt), token };
}

function sessionCookie(account) {
  for (const [key, session] of sessions) if (session.expires <= Date.now()) sessions.delete(key);
  const token = randomBytes(32).toString('hex');
  sessions.set(token, { id: account.id, salt: account.salt, expires: Date.now() + sessionTime });
  return `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionTime / 1000}`;
}

function createCredentials(next, body, role, employee = '') {
  const username = field(body.username, 32, true).toLowerCase();
  requireCondition(/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username), 400, '账号须为 3–32 位字母、数字、点、下划线或连字符。');
  requireCondition(typeof body.password === 'string' && body.password.length >= 10 && body.password.length <= 128, 400, '密码长度须为 10–128 位。');
  const previous = next.accounts.find(account => role === 'employee' && account.employee === employee);
  requireCondition(!next.accounts.some(account => account.username === username && account.id !== previous?.id), 409, '这个账号名已被使用。');
  const salt = randomBytes(16).toString('hex');
  const account = { id: previous?.id || randomUUID(), username, role, employee, salt, hash: scryptSync(body.password, salt, 64).toString('hex') };
  if (previous) next.accounts[next.accounts.indexOf(previous)] = account;
  else next.accounts.push(account);
  return account;
}

function verifyLogin(body, request) {
  const username = field(body.username, 32).toLowerCase();
  const address = request.socket.remoteAddress;
  const time = Date.now();
  const attempt = loginAttempts.get(address) || { count: 0, expires: 0 };
  if (attempt.expires <= time) { attempt.count = 0; attempt.expires = time + 5 * 60 * 1000; }
  requireCondition(attempt.count < 12, 429, '尝试次数过多，请稍后再试。');
  const account = store.accounts.find(account => account.username === username);
  const password = typeof body.password === 'string' && body.password.length <= 128 ? body.password : '';
  const actual = scryptSync(password, account?.salt || 'nailmate-unused-login-salt', 64);
  if (!timingSafeEqual(actual, Buffer.from(account?.hash || '0'.repeat(128), 'hex')) || !account) {
    attempt.count += 1;
    loginAttempts.set(address, attempt);
    requireCondition(false, 401, '账号或密码不正确。');
  }
  loginAttempts.delete(address);
  return account;
}

function scopedState(account) {
  const owner = account.role === 'owner';
  const tasks = owner ? store.tasks : store.tasks.filter(task => task.assignee === account.employee);
  const allowed = new Set(tasks.map(task => task.member_id));
  const notes = owner ? store.notes : store.notes.filter(note => allowed.has(note.member_id));
  const noteEdits = owner ? store.noteEdits : Object.fromEntries(Object.entries(store.noteEdits).filter(([id]) =>
    allowed.has(snapshotNotes.get(id)?.member_id) || notes.some(note => note.note_id === id)));
  return {
    tasks, notes, noteEdits, images: store.images, revision: store.revision, workDate: today(),
    memberUpdates: owner ? store.memberUpdates : Object.fromEntries(Object.entries(store.memberUpdates).filter(([id]) => allowed.has(id))),
    logs: owner ? store.logs : [],
    care_records: owner ? store.care_records : [],
    accounts: owner ? store.accounts.filter(account => account.role === 'employee').map(({ employee, username }) => ({ employee, username })) : [],
  };
}

function appPage(account) {
  const state = scopedState(account);
  let page = template;
  if (account.role === 'employee') {
    const allowed = new Set(state.tasks.map(task => task.member_id));
    const scoped = { ...snapshot };
    for (const key of ['members', 'orders', 'member_notes', 'member_care_profiles']) {
      scoped[key] = snapshot[key].filter(row => allowed.has(row.member_id));
    }
    for (const key of ['contact_logs', 'appointments', 'campaign_tasks']) delete scoped[key];
    page = page.replace(dataBlock, (_, start, data, end) => start + embed(scoped) + end);
  }
  const boot = { user: { username: account.username, role: account.role, employee: account.employee }, state, roster: account.role === 'owner' ? roster : [] };
  return page.replace('<!-- NAILMATE_BOOT -->', () => `<script id="nailmate-boot" type="application/json">${embed(boot)}</script>`);
}

function checkContact(next, id, objective, productId, workDate) {
  const m = members.get(id);
  const update = next.memberUpdates[id] || {};
  const product = products.get(productId);
  const recent = update.contact_recorded_on
    ? daysBetween(workDate, update.contact_recorded_on) < 14
    : m.last_contact_date && daysBetween(snapshot.as_of_date, m.last_contact_date) < 14;
  const reasons = [
    !(update.consent ?? m.marketing_consent) && '未获得营销授权',
    m.unresolved_complaint && '有未解决投诉',
    recent && '14 天内已联系',
    (update.appointment ?? m.has_upcoming_appointment) && '已有未来预约',
    update.care_paused && '已标记暂不联系',
    m.data_completeness < .8 && '档案完整度不足',
  ].filter(Boolean);
  if (objective === 'care') {
    const elapsed = daysBetween(snapshot.as_of_date, recentNails.get(id));
    if (!careProfiles.get(id)?.care_followup_opt_in || !(elapsed >= 1 && elapsed <= 7)) reasons.push('不符合护理回访条件');
  }
  if (objective === 'preview') {
    const untilLaunch = daysBetween(product?.launch_date, workDate);
    if (m.lifecycle !== 'active' || product?.product_type !== 'nail_style' || !(untilLaunch >= 1 && untilLaunch <= 14)
      || !m.preferred_styles.split('|').includes(product.style)) reasons.push('不符合新品预告条件');
  }
  return reasons;
}

function applyAction(account, body) {
  const action = body.action;
  requireCondition(account.role === (action === 'result' ? 'employee' : 'owner'), 403, '当前账号没有这项操作权限。');
  const next = structuredClone(store);
  const date = today();
  let taskIds = [];
  switch (action) {
    case 'employeeAccount': {
      const known = [...roster, ...staff()];
      let employee = body.employee;
      if (employee) requireCondition(known.includes(employee), 400, '请选择员工。');
      else {
        employee = field(body.newEmployee, 30, true);
        requireCondition(!/[\p{Cc}\p{Zl}\p{Zp}]/u.test(employee), 400, '请输入有效的员工姓名。');
        requireCondition(!known.includes(employee), 409, '这位员工已存在，请在列表中选择。');
      }
      createCredentials(next, body, 'employee', employee);
      break;
    }
    case 'assign': {
      requireCondition(Array.isArray(body.tasks) && body.tasks.length >= 1 && body.tasks.length <= 100, 400, '每次请选择 1–100 位顾客。');
      for (const input of body.tasks) {
        requireCondition(input && members.has(input.member_id) && objectives.has(input.objective), 400, '请选择有效的顾客和沟通目的。');
        requireCondition(staff().includes(input.assignee), 400, '请选择已开通账号的员工。');
        const active = next.tasks.find(task => task.member_id === input.member_id && task.status === 'assigned');
        requireCondition(!active, 409, `这位顾客已由 ${active?.assignee} 负责。`);
        const productId = input.product_id || null;
        const product = products.get(productId);
        requireCondition(input.objective === 'greeting' ? productId === null : Boolean(product && (input.objective === 'preview' || product.is_active)), 400, '请选择有效的产品。');
        const reasons = checkContact(next, input.member_id, input.objective, productId, date);
        if (next.care_records.some(record => record.member_id === input.member_id && record.recorded_as_of === date)) reasons.push('今天已有沟通记录');
        requireCondition(!reasons.length, 409, `暂不可分派：${reasons.join('、')}。`);
        const id = 'T' + String(next.tasks.length + 1).padStart(4, '0');
        next.tasks.push({ task_id: id, member_id: input.member_id, objective: input.objective, strategy: objectives.get(input.objective),
          assignee: input.assignee, product_id: productId, assigned_on: date, note: field(input.note, 180), reason: field(input.reason, 1200),
          message: field(input.message, 1600, true), status: 'assigned', result: null, history: [`老板娘分派给 ${input.assignee} · ${date}`], data_type: 'simulation' });
        taskIds.push(id);
      }
      next.logs.push(`分派 ${taskIds.length} 项联系任务。`);
      break;
    }
    case 'reassign': {
      const task = next.tasks.find(task => task.task_id === body.id);
      requireCondition(task?.status === 'assigned', 409, '仅待联系任务可以改派。');
      requireCondition(task.assignee === body.previous, 409, '负责人已变更，请刷新后再改派。');
      requireCondition(staff().includes(body.assignee), 400, '请选择已开通账号的员工。');
      if (task.assignee !== body.assignee) {
        task.history.push(`老板娘将任务由 ${task.assignee} 改派给 ${body.assignee} · ${date}`);
        task.assignee = body.assignee;
      }
      break;
    }
    case 'result': {
      const task = next.tasks.find(task => task.task_id === body.id && task.assignee === account.employee);
      requireCondition(task, 404, '没有找到你的这项任务。');
      requireCondition(task.status === 'assigned', 409, '任务已记录，请刷新查看。');
      requireCondition(outcomes.includes(body.outcome), 400, '请选择沟通结果。');
      const reasons = checkContact(next, task.member_id, task.objective, task.product_id, date);
      requireCondition(!reasons.length || body.outcome === '暂不联系', 409, '当前有联系限制，请选择「暂不联系」。');
      const note = field(body.note, 500);
      const contacted = body.outcome !== '暂不联系';
      task.message = field(body.message, 1600) || task.message;
      task.status = 'recorded';
      task.result = { outcome: body.outcome, note, contacted, booked: body.outcome === '已预约', recorded_on: date };
      task.history.push(`${account.employee} 记录「${body.outcome}」 · ${date}`);
      next.care_records.push({ task_id: task.task_id, member_id: task.member_id, outcome: body.outcome, note, owner: account.employee, recorded_as_of: date, data_type: 'simulation' });
      const update = next.memberUpdates[task.member_id] ||= {};
      if (contacted) Object.assign(update, { last_contact_date: date, contact_recorded_on: date });
      if (task.result.booked) update.appointment = true;
      if (body.outcome === '不再营销') update.consent = false;
      if (body.outcome === '暂不联系') update.care_paused = true;
      break;
    }
    case 'note': {
      requireCondition(members.has(body.memberId), 400, '会员不存在。');
      const previous = body.noteId && (snapshotNotes.get(body.noteId) || next.notes.find(note => note.note_id === body.noteId));
      requireCondition(!body.noteId || previous?.member_id === body.memberId, 400, '备注不存在。');
      const changes = { is_pinned: Boolean(body.pinned), updated_at: new Date().toISOString() };
      if (body.text !== undefined) {
        requireCondition(noteTypes.includes(body.type), 400, '请选择备注类型。');
        Object.assign(changes, { note_text: field(body.text, 1200, true), note_type: body.type });
      }
      if (previous) next.noteEdits[previous.note_id] = { ...next.noteEdits[previous.note_id], ...changes };
      else {
        requireCondition(changes.note_text, 400, '请填写备注。');
        next.notes.push({ ...changes, note_id: 'NOTE-' + randomUUID(), member_id: body.memberId, author_name: '店主', author_role: 'owner', created_at: changes.updated_at });
      }
      break;
    }
    case 'photo':
      requireCondition(products.has(body.productId) && typeof body.image === 'string' && body.image.length <= 1400000
        && /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]+={0,2}$/.test(body.image), 400, '请上传有效的产品图片。');
      next.images[body.productId] = body.image;
      break;
    default:
      requireCondition(false, 400, '未知操作。');
  }
  commit(next);
  return { state: scopedState(account), taskIds };
}

function loginPage(setup, error = '') {
  const heading = setup ? '创建老板娘账号' : '登录门店工作台';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${heading} · NailMate</title>
    <style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#f4ebe8;color:#392e34;font:16px/1.6 system-ui,sans-serif}main{background:#fffbf8;border:1px solid #dfc8cc;border-radius:20px;padding:clamp(22px,5vw,42px);width:min(100%,460px)}.brand{font:italic 33px Georgia;color:#743952}h1{font-size:26px;margin:15px 0 4px}p{color:#66535b;margin:0 0 20px}label{display:block;margin:12px 0 5px}input,button{width:100%;padding:11px 12px;font:inherit;border-radius:8px;border:1px solid #bc96a4}input{background:#fff}button{background:#743952;color:#fff;margin-top:22px;cursor:pointer}.error{background:#f9e4e6;padding:8px;border-radius:8px}</style></head>
    <body><main><div class="brand">Nailmate ✧</div><h1>${heading}</h1><p>${setup ? '首次使用请设置店主账号。登录后可在「员工账号」为员工开通权限。' : '使用店主或员工账号登录。'}</p>
    ${error ? `<p class="error" role="alert">${escape(error)}</p>` : ''}
    <form method="post" action="${setup ? '/setup' : '/login'}"><label for="username">账号</label><input id="username" name="username" autocomplete="username" maxlength="32" required autofocus>
    <label for="password">密码${setup ? '（至少 10 位）' : ''}</label><input id="password" name="password" type="password" autocomplete="${setup ? 'new-password' : 'current-password'}" minlength="${setup ? 10 : 1}" maxlength="128" required>
    <button type="submit">${setup ? '创建并登录' : '登录'}</button></form></main></body></html>`;
}

async function readBody(request, limit, form = false) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    requireCondition(size <= limit, 413, '提交内容过大。');
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString('utf8');
  if (form) return Object.fromEntries(new URLSearchParams(body));
  try {
    const parsed = JSON.parse(body);
    requireCondition(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 400, '提交内容无效。');
    return parsed;
  } catch {
    throw Object.assign(new Error('提交内容无效。'), { status: 400 });
  }
}

const server = createServer(async (request, response) => {
  const host = request.headers.host;
  const path = request.url?.split('?')[0];
  const send = (status, body = '', type = 'text/html; charset=utf-8', headers = {}) => {
    response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      ...headers });
    response.end(body);
  };
  const json = (status, data) => send(status, JSON.stringify(data), 'application/json; charset=utf-8');
  const redirect = cookie => send(303, '', 'text/plain', { Location: '/', ...(cookie && { 'Set-Cookie': cookie }) });
  try {
    requireCondition(host === `127.0.0.1:${port}` || host === `localhost:${port}`, 403, '请使用本机地址访问。');
    const { account, token } = accountFor(request);
    const viewer = request.headers['x-nailmate-user'];
    if (viewer) requireCondition(account?.username === viewer, 401, '请重新登录。');
    if (request.method === 'GET' && path === '/') return send(200, account ? appPage(account) : loginPage(!store.accounts.length));
    if (request.method === 'GET' && path === '/api/state') {
      requireCondition(account, 401, '请重新登录。');
      const query = new URL(request.url, `http://${host}`).searchParams;
      if (query.get('revision') === String(store.revision) && query.get('date') === today()) return send(204);
      return json(200, scopedState(account));
    }
    requireCondition(request.method === 'POST' && ['/login', '/setup', '/logout', '/api/action'].includes(path), 404, '页面不存在。');
    requireCondition((!request.headers.origin || request.headers.origin === `http://${host}`) && request.headers['sec-fetch-site'] !== 'cross-site', 403, '请求来源无效。');
    if (path === '/logout') {
      sessions.delete(token);
      return redirect(`${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    }
    if (path === '/setup' || path === '/login') {
      const body = await readBody(request, 4096, true);
      let authenticated;
      if (path === '/setup') {
        requireCondition(!store.accounts.length, 409, '老板娘账号已创建，请登录。');
        const next = structuredClone(store);
        authenticated = createCredentials(next, body, 'owner');
        commit(next);
      } else authenticated = verifyLogin(body, request);
      if (token) sessions.delete(token);
      return redirect(sessionCookie(authenticated));
    }
    requireCondition(account, 401, '请重新登录。');
    requireCondition(request.headers['content-type']?.startsWith('application/json'), 415, '请求格式无效。');
    const body = await readBody(request, 1500000);
    const current = accountFor(request).account;
    requireCondition(current && (!viewer || current.username === viewer), 401, '请重新登录。');
    return json(200, applyAction(current, body));
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error(error);
    const message = error.status ? error.message : '保存或读取失败，请稍后重试。';
    if (path?.startsWith('/api/')) return json(status, { error: message });
    return send(status, loginPage(!store.accounts.length, message));
  }
});
server.listen(port, '127.0.0.1', () => console.log(`NailMate 已启动。请打开 http://127.0.0.1:${port}/`));

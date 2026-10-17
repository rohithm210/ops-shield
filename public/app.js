'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dt = d => d ? new Date(d).toLocaleString() : '—';
const tm = d => d ? new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
const dOnly = d => d ? new Date(d).toLocaleDateString('en-GB', { timeZone: 'UTC' }) : '—';
const money = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const pill = t => `<span class="pill ${String(t).toLowerCase()}">${esc(t)}</span>`;
const CHILD = { CEO: 'Manager', Manager: 'Admin', Admin: 'Staff' };
const LOGO = '/img/logo.png';

let token = localStorage.getItem('ops_token') || '', me = null, company = null;
let timer = null, beat = null, badgeT = null, alertT = null, setupToken = null;
let code = (new URLSearchParams(location.search).get('c') || localStorage.getItem('ops_code') || '').toUpperCase();
if (code) localStorage.setItem('ops_code', code);

function toast(m, bad) {
  const t = $('#toast'); t.textContent = m; t.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(t._h); t._h = setTimeout(() => t.className = '', 3500);
}

async function api(p, method = 'GET', body) {
  const r = await fetch('/api' + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), 'x-tz': String(-new Date().getTimezoneOffset()) },
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401 && token && !p.startsWith('/auth/')) localLogout();
    throw new Error(j.error || 'Request failed');
  }
  return j;
}

function stopTimers() { clearInterval(timer); clearInterval(beat); clearInterval(badgeT); clearInterval(alertT); }
function localLogout() { token = ''; localStorage.removeItem('ops_token'); stopTimers(); me = null; const a = $('#alerts'); if (a) a.remove(); showLogin(); }
async function logout() { try { await api('/auth/logout', 'POST'); } catch {} localLogout(); }

/* ================= LOGIN ================= */
async function showLogin() {
  let c = null;
  if (code) { try { c = await api('/company/' + encodeURIComponent(code)); } catch {} }
  $('#app').innerHTML = `<div class="login-wrap"><div class="login-card">
    <div class="logo-chip big"><img src="${LOGO}" alt="OPS SHIELD"></div>
    <h2>${c ? (c.Logo ? `<img class="clogo" src="${c.Logo}"> ` : '') + esc(c.Name) : 'Welcome'}</h2>
    <p class="muted">Secure sign-in portal</p>
    <div id="lf">
      ${c ? '' : '<label>Company code</label><input id="lc" placeholder="e.g. NOVA">'}
      <label>Email</label><input id="le" type="email" autocomplete="username">
      <label>Password / Company API key</label><input id="lp" type="password" autocomplete="current-password">
      <button class="btn" id="lb">Sign in</button>
    </div>
    <div class="msg" id="lm"></div>
    <p><a href="#" id="fg">Forgot password or lost API key?</a></p></div></div>`;
  const go = async () => {
    const cc = (code || ($('#lc') && $('#lc').value) || '').trim().toUpperCase();
    try {
      const r = await api('/auth/login', 'POST', { code: cc, email: $('#le').value, secret: $('#lp').value });
      code = cc; localStorage.setItem('ops_code', cc);
      if (r.needsPassword) { setupToken = r.setupToken; showSetPassword(); }
      else { token = r.token; localStorage.setItem('ops_token', token); boot(); }
    } catch (e) { $('#lm').textContent = e.message; }
  };
  $('#lb').onclick = go;
  $('#fg').onclick = e => { e.preventDefault(); showTicket(); };
  $('#lp').onkeydown = e => { if (e.key === 'Enter') go(); };
}

function showSetPassword() {
  $('#lf').innerHTML = `<div class="note">First sign-in: create your own password.</div>
    <label>New password (min 8 characters)</label><input id="p1" type="password">
    <label>Confirm password</label><input id="p2" type="password">
    <button class="btn" id="pb">Save password &amp; continue</button>`;
  $('#pb').onclick = async () => {
    if ($('#p1').value !== $('#p2').value) { $('#lm').textContent = 'Passwords do not match'; return; }
    try {
      const r = await api('/auth/setpassword', 'POST', { setupToken, password: $('#p1').value });
      token = r.token; localStorage.setItem('ops_token', token); boot();
    } catch (e) { $('#lm').textContent = e.message; }
  };
}

/* ---- forgot password / lost key ticket ---- */
function showTicket() {
  $('#lf').innerHTML = `${code ? '' : '<label>Company code</label><input id="tkc">'}
    <label>Your email</label><input id="tke" type="email">
    <label>Problem</label><select id="tkt"><option value="PASSWORD">Forgot password</option><option value="API_KEY">Lost company API key</option></select>
    <label>Message (optional)</label><textarea id="tkm" rows="3"></textarea>
    <button class="btn" id="tkb">Raise ticket</button> <button class="btn ghost" id="tkx">Back</button>`;
  $('#tkx').onclick = showLogin;
  $('#tkb').onclick = async () => {
    try {
      await api('/tickets', 'POST', { code: code || $('#tkc').value, email: $('#tke').value, type: $('#tkt').value, message: $('#tkm').value });
      $('#lf').innerHTML = '<div class="note">Ticket raised. Your admin or CEO will contact you.</div><button class="btn ghost" id="tkx">Back to sign-in</button>';
      $('#tkx').onclick = showLogin;
    } catch (e) { $('#lm').textContent = e.message; }
  };
}

/* ---- security alert popups ---- */
const shown = new Set();
function popup(a) {
  if (!$('#alerts')) document.body.insertAdjacentHTML('beforeend', '<div id="alerts"></div>');
  const d = document.createElement('div');
  d.className = 'alert-pop ' + a.Level;
  d.innerHTML = `<b>${a.Level === 'red' ? '🚨' : '⚠️'} ${esc(a.Level.toUpperCase())} security alert</b><div>${esc(a.Message)}</div><small>${dt(a.CreatedAt)}</small>
    <div style="margin-top:8px"><button class="btn sm" data-a>Acknowledge</button> <button class="btn sm ghost" data-x>Dismiss</button></div>`;
  d.querySelector('[data-a]').onclick = async () => { try { await api('/alerts/' + a.Id + '/ack', 'POST'); d.remove(); } catch (e) { toast(e.message, 1); } };
  d.querySelector('[data-x]').onclick = () => d.remove();
  $('#alerts').appendChild(d);
}
async function pollAlerts() {
  if (!me || !['Admin', 'Manager', 'CEO'].includes(me.role)) return;
  try { (await api('/alerts')).forEach(a => { if (!shown.has(a.Id)) { shown.add(a.Id); popup(a); } }); } catch {}
}

/* ================= BOOT ================= */
async function boot() {
  try { const r = await api('/me'); me = r.user; company = r.company; }
  catch { if (token) localLogout(); else showLogin(); return; }
  if (me.status !== 'Approved') return showPending();
  showApp();
}

function showPending() {
  const who = me.role === 'Admin' ? 'your Manager' : 'the CEO';
  $('#app').innerHTML = `<div class="login-wrap"><div class="login-card center">
    <div class="logo-chip big"><img src="${LOGO}"></div>
    <h2>${me.status === 'Denied' ? 'Access denied' : 'Waiting for approval'}</h2>
    <p>${me.status === 'Denied' ? `Access was denied by ${who}.` : `An access request was sent to ${who}'s inbox. This page opens automatically once it is approved.`}</p>
    <button class="btn ghost" id="lo">Sign out</button></div></div>`;
  $('#lo').onclick = logout;
  stopTimers();
  timer = setInterval(async () => {
    try {
      const r = await api('/me'); company = r.company;
      if (r.user.status === 'Approved') { clearInterval(timer); me = r.user; showApp(); }
      else if (r.user.status !== me.status) { me = r.user; showPending(); }
    } catch {}
  }, 5000);
  beat = setInterval(() => api('/ping', 'POST').catch(() => {}), 30000);
}

const NAV = {
  CEO: [['dash', '📈 Dashboard'], ['accounts', '💰 Accounts'], ['team', '👔 Managers'], ['mail', '✉️ Mail'], ['tasks', '🗂 Task Overview'], ['servers', '🖥 Servers'], ['tickets', '🎫 Alerts & Tickets'], ['company', '🏢 Company'], ['help', '🛟 Help & Contact']],
  Manager: [['servers', '🖥 Server Health'], ['tasks', '🗂 Admin Work'], ['team', '🛡 Admins'], ['mail', '✉️ Mail'], ['tickets', '🎫 Alerts & Tickets'], ['help', '🛟 Help & Contact']],
  Admin: [['attendance', '🕒 Staff Attendance'], ['team', '🔑 Staff & Passwords'], ['tasks', '🗂 Work Status'], ['mail', '✉️ Mail'], ['servers', '🖥 Servers'], ['tickets', '🎫 Alerts & Tickets']],
  Staff: [['tasks', '🗂 My Work'], ['mail', '✉️ Mail']]
};

function showApp() {
  stopTimers();
  $('#app').innerHTML = `<div class="shell"><aside class="side">
    <div class="brand"><div class="logo-chip"><img src="${LOGO}" alt="OPS SHIELD"></div></div>
    <nav class="nav">${NAV[me.role].map(([k, l]) => `<button data-v="${k}">${l}${k === 'mail' ? '<span id="badge" class="badge" hidden></span>' : ''}</button>`).join('')}</nav>
    <div class="side-foot">OPS SHIELD<br><small style="color:#e7dfff">Secure • Monitor • Protect</small></div></aside>
    <main><header class="top">
      <div class="co">${company.Logo ? `<img src="${company.Logo}">` : ''}<div><b>${esc(company.Name)}</b><small>Registered ${dt(company.CreatedAt)}</small></div></div>
      <div class="who"><div><b>${esc(me.name)}</b><small>${me.role}</small></div><button class="btn ghost sm" id="out">Sign out</button></div>
    </header><section id="view"></section></main></div>`;
  document.querySelectorAll('.nav button').forEach(b => b.onclick = () => go(b.dataset.v));
  $('#out').onclick = logout;
  beat = setInterval(() => api('/ping', 'POST').catch(() => {}), 30000);
  const badge = async () => {
    try {
      const r = await api('/mail/unread'); const b = $('#badge');
      if (b) { b.hidden = !r.count; b.textContent = r.count; }
    } catch {}
  };
  badge(); badgeT = setInterval(badge, 8000);
  shown.clear(); pollAlerts(); alertT = setInterval(pollAlerts, 8000);
  go(NAV[me.role][0][0]);
}

async function go(v) {
  clearInterval(timer);
  document.querySelectorAll('.nav button').forEach(b => b.classList.toggle('active', b.dataset.v === v));
  const view = views[v];
  $('#view').innerHTML = '';
  try { await view.init(); await view.refresh(); } catch (e) { toast(e.message, 1); }
  if (view.every) timer = setInterval(() => view.refresh().catch(() => {}), view.every);
}

/* ================= helpers ================= */
const tbl = (heads, rows) => rows.length
  ? `<div class="tw"><table><thead><tr>${heads.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
  : '<div class="empty">Nothing here yet.</div>';

const attTable = rows => tbl(['Name', 'Role', 'First login', 'Last logout', 'Sessions', 'Status'],
  rows.map(r => [esc(r.FullName), r.Role, tm(r.FirstLogin), r.IsOnline ? '—' : tm(r.LastLogout), r.Sessions, r.IsOnline ? pill('Online') : r.Sessions ? pill('Present') : pill('Absent')]));

const logTable = log => tbl(['Name', 'Role', 'Login time', 'Logout time'],
  log.map(l => [esc(l.FullName), l.Role, dt(l.LoginAt), l.LogoutAt ? dt(l.LogoutAt) : pill('Online')]));

function drawChart(cv, pts) {
  const dpr = window.devicePixelRatio || 1, ctx = cv.getContext('2d');
  const w = cv.width = cv.clientWidth * dpr, h = cv.height = cv.clientHeight * dpr;
  ctx.clearRect(0, 0, w, h); if (pts.length < 2) return;
  const min = Math.min(...pts), max = Math.max(...pts), pad = 22 * dpr;
  const x = i => pad + i * (w - 2 * pad) / (pts.length - 1), y = v => h - pad - (v - min) / ((max - min) || 1) * (h - 2 * pad);
  const up = pts[pts.length - 1] >= pts[0];
  ctx.strokeStyle = 'rgba(123,94,198,.15)'; ctx.lineWidth = 1 * dpr;
  for (let i = 0; i < 5; i++) { const yy = pad + i * (h - 2 * pad) / 4; ctx.beginPath(); ctx.moveTo(pad, yy); ctx.lineTo(w - pad, yy); ctx.stroke(); }
  ctx.lineWidth = 2.5 * dpr; ctx.strokeStyle = up ? '#2e9e6a' : '#d64565'; ctx.beginPath();
  pts.forEach((v, i) => i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))); ctx.stroke();
  ctx.lineTo(x(pts.length - 1), h - pad); ctx.lineTo(x(0), h - pad); ctx.closePath();
  ctx.fillStyle = up ? 'rgba(46,158,106,.12)' : 'rgba(214,69,101,.12)'; ctx.fill();
}

/* ================= VIEWS ================= */
const views = {};

/* ---- CEO dashboard ---- */
views.dash = {
  every: 5000,
  async init() {
    $('#view').innerHTML = `
    <div class="grid4">
      <div class="card stat"><small>Company stock price</small><h3 id="sp">—</h3><span id="sc"></span></div>
      <div class="card stat"><small>Attendance today</small><h3 id="at">—</h3><small id="ac"></small></div>
      <div class="card stat"><small>Revenue (last 30 entries)</small><h3 id="rv">—</h3></div>
      <div class="card stat"><small>Net profit</small><h3 id="np">—</h3></div>
    </div>
    <div class="card"><div class="row between"><h3>Company wealth: market price</h3><span id="mood" class="pill">—</span></div>
      <canvas id="cv"></canvas><small class="muted">Simulated live market feed, refreshes every 5 seconds.</small></div>
    <div class="card"><h3>Staff attendance today (from login times)</h3><div id="att"></div></div>
    <div class="card"><h3>Recent logins and logouts</h3><div id="lg"></div></div>`;
  },
  async refresh() {
    const [s, a, ac] = await Promise.all([api('/stock'), api('/attendance'), api('/accounts')]);
    $('#sp').textContent = money(s.price);
    $('#sc').innerHTML = `<b class="${s.change >= 0 ? 'up' : 'down'}">${s.change >= 0 ? '▲' : '▼'} ${Math.abs(s.change).toFixed(2)} (${s.pct >= 0 ? '+' : ''}${s.pct.toFixed(2)}%)</b>`;
    $('#mood').textContent = s.mood; $('#mood').className = 'pill ' + s.mood.toLowerCase();
    drawChart($('#cv'), s.hist);
    $('#at').textContent = a.summary.percent + '%';
    $('#ac').textContent = `${a.summary.present} of ${a.summary.total} present`;
    const rev = ac.rows.reduce((t, r) => t + Number(r.Revenue), 0), exp = ac.rows.reduce((t, r) => t + Number(r.Expense), 0);
    $('#rv').textContent = money(rev); $('#np').textContent = money(rev - exp);
    $('#att').innerHTML = attTable(a.rows); $('#lg').innerHTML = logTable(a.log);
  }
};

/* ---- CEO accounts ---- */
views.accounts = {
  every: 10000,
  async init() {
    $('#view').innerHTML = `<div class="card"><h3>Add daily account entry</h3><div class="row">
      <input id="ad" type="date" value="${new Date().toISOString().slice(0, 10)}"><input id="ade" placeholder="Description">
      <input id="ar" type="number" min="0" placeholder="Revenue"><input id="ax" type="number" min="0" placeholder="Expense">
      <button class="btn" id="aadd">Add entry</button></div></div>
      <div class="card"><h3>Company accounts: day to day</h3><div id="alist"></div></div>`;
    $('#aadd').onclick = async () => {
      try {
        await api('/accounts', 'POST', { entryDate: $('#ad').value, description: $('#ade').value, revenue: $('#ar').value, expense: $('#ax').value });
        $('#ade').value = $('#ar').value = $('#ax').value = ''; toast('Entry added'); views.accounts.refresh();
      } catch (e) { toast(e.message, 1); }
    };
  },
  async refresh() {
    const { rows } = await api('/accounts');
    $('#alist').innerHTML = tbl(['Date', 'Description', 'Revenue', 'Expense', 'Net'],
      rows.map(r => [dOnly(r.EntryDate), esc(r.Description), money(r.Revenue), money(r.Expense), `<b class="${r.Revenue - r.Expense >= 0 ? 'up' : 'down'}">${money(r.Revenue - r.Expense)}</b>`]));
  }
};

/* ---- team: CEO->Managers, Manager->Admins, Admin->Staff ---- */
views.team = {
  every: 6000,
  async init() {
    const label = CHILD[me.role];
    $('#view').innerHTML = `<div class="card"><h3>Add ${label}</h3><div class="row">
      <input id="tn" placeholder="Full name"><input id="te" type="email" placeholder="Email address">
      <button class="btn" id="tadd">Create ${label}</button></div><div id="tnote"></div></div>
      <div class="card"><h3>${label} accounts</h3><div id="tlist"></div></div>`;
    $('#tadd').onclick = async () => {
      try {
        const r = await api('/team', 'POST', { fullName: $('#tn').value, email: $('#te').value });
        $('#tnote').innerHTML = `<div class="note">Account created. Temporary password: <b>${esc(r.tempPassword)}</b><br><small>Give this to the user. They create their own password at first sign-in${r.role === 'Staff' ? '' : ' and then wait for your approval'}.</small></div>`;
        $('#tn').value = $('#te').value = ''; views.team.refresh();
      } catch (e) { toast(e.message, 1); }
    };
  },
  async refresh() {
    if (document.querySelector('.pw.shown')) return;
    const { users } = await api('/team');
    const isAdmin = me.role === 'Admin', canApprove = me.role !== 'Admin';
    const heads = ['Name', 'Email', 'Access', 'Last login', 'Now'].concat(isAdmin ? ['Password'] : [], canApprove ? ['Actions'] : []);
    $('#tlist').innerHTML = tbl(heads, users.map(u => {
      const row = [esc(u.FullName), esc(u.Email), pill(u.Status), dt(u.LastLogin), u.IsOnline ? pill('Online') : pill('Offline')];
      if (isAdmin) row.push(`<span class="pw" data-p="${esc(u.Password || '')}">••••••••</span><button class="link" data-show>Show</button>${u.Temporary ? '<small> (temporary)</small>' : ''}`);
      if (canApprove) {
        const b = (s, l, c = '') => `<button class="btn sm ${c}" data-id="${u.Id}" data-s="${s}">${l}</button> `;
        row.push(u.Status === 'Approved' ? b('Denied', 'Revoke', 'danger') : u.Status === 'Pending' ? b('Approved', 'Approve') + b('Denied', 'Deny', 'danger') : b('Approved', 'Approve'));
      }
      return row;
    }));
    document.querySelectorAll('#tlist [data-s]').forEach(b => b.onclick = async () => {
      try { await api('/team/' + b.dataset.id + '/status', 'POST', { status: b.dataset.s }); toast('Updated'); views.team.refresh(); } catch (e) { toast(e.message, 1); }
    });
    document.querySelectorAll('#tlist [data-show]').forEach(b => b.onclick = () => {
      const s = b.previousElementSibling, on = s.classList.toggle('shown');
      s.textContent = on ? (s.dataset.p || 'not set') : '••••••••'; b.textContent = on ? 'Hide' : 'Show';
    });
  }
};

/* ---- mail ---- */
let folder = 'inbox', mails = [];
views.mail = {
  every: 8000,
  async init() {
    folder = 'inbox';
    $('#view').innerHTML = `<div class="mailbox"><div class="mail-left card">
      <div class="tabs"><button data-f="inbox" class="on">Inbox</button><button data-f="sent">Sent</button></div>
      <button class="btn sm wide" id="cmp">✏️ Compose</button><div id="mlist"></div></div>
      <div class="mail-right card" id="mdetail"><p class="muted">Select a message to read it.</p></div></div>`;
    document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
      folder = b.dataset.f; document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b)); views.mail.refresh();
    });
    $('#cmp').onclick = compose;
  },
  async refresh() {
    mails = await api('/mail/' + folder);
    $('#mlist').innerHTML = mails.length ? mails.map((m, i) => `<div class="mitem ${!m.IsRead && folder === 'inbox' ? 'unread' : ''}" data-i="${i}">
      <b>${esc(m.Subject)}</b>${m.Type === 'TASK' ? '<span class="tag">Task</span>' : m.Type === 'ACCESS_REQUEST' ? '<span class="tag">Access request</span>' : ''}
      <small>${folder === 'inbox' ? 'From ' + esc(m.FromName) : 'To ' + esc(m.ToName)} • ${dt(m.CreatedAt)}</small></div>`).join('') : '<div class="empty">No messages.</div>';
    document.querySelectorAll('.mitem').forEach(el => el.onclick = () => openMail(+el.dataset.i));
  }
};

function openMail(i) {
  const m = mails[i]; if (!m) return;
  const who = folder === 'inbox' ? `From: ${esc(m.FromName)} (${m.FromRole})` : `To: ${esc(m.ToName)} (${m.ToRole})`;
  let act = '';
  if (folder === 'inbox' && m.Type === 'ACCESS_REQUEST')
    act = m.ActionStatus ? `<p>Decision: ${pill(m.ActionStatus)}</p>` : `<button class="btn" id="mok">✔ Grant permission</button> <button class="btn danger" id="mno">✖ Deny</button>`;
  if (m.Type === 'TASK') act += '<p><small>This message was assigned as a work task. Track it in the work page.</small></p>';
  $('#mdetail').innerHTML = `<h3>${esc(m.Subject)}</h3><small>${who} • ${dt(m.CreatedAt)}</small><div class="mbody">${esc(m.Body)}</div>${act}`;
  if (folder === 'inbox' && !m.IsRead) { m.IsRead = true; api('/mail/' + m.Id + '/read', 'POST').catch(() => {}); }
  const decide = a => async () => {
    try { await api('/mail/' + m.Id + '/action', 'POST', { action: a }); toast(a === 'approve' ? 'Permission granted' : 'Request denied'); await views.mail.refresh(); const j = mails.findIndex(x => x.Id === m.Id); if (j >= 0) openMail(j); }
    catch (e) { toast(e.message, 1); }
  };
  if ($('#mok')) { $('#mok').onclick = decide('approve'); $('#mno').onclick = decide('deny'); }
}

async function compose() {
  const users = await api('/users');
  if (!users.length) { $('#mdetail').innerHTML = '<p class="muted">No other approved users in your company yet.</p>'; return; }
  const child = CHILD[me.role];
  $('#mdetail').innerHTML = `<h3>New message</h3>
    <label>To</label><select id="mt">${users.map(u => `<option value="${u.Id}" data-r="${u.Role}">${esc(u.FullName)} — ${u.Role} (${esc(u.Email)})</option>`).join('')}</select>
    <label>Subject</label><input id="ms"><label>Message</label><textarea id="mb" rows="8"></textarea>
    ${child ? '<label class="chk" id="tk"><input type="checkbox" id="mtask"> Assign as work task (status: Active)</label>' : ''}
    <button class="btn" id="msend" style="margin-top:12px">Send</button>`;
  if (child) {
    const sync = () => { const r = $('#mt').selectedOptions[0].dataset.r; $('#tk').style.display = r === child ? '' : 'none'; if (r !== child) $('#mtask').checked = false; };
    $('#mt').onchange = sync; sync();
  }
  $('#msend').onclick = async () => {
    try {
      await api('/mail/send', 'POST', { toUserId: $('#mt').value, subject: $('#ms').value, body: $('#mb').value, asTask: !!($('#mtask') && $('#mtask').checked) });
      toast('Message sent'); $('#mdetail').innerHTML = '<p class="muted">Message sent.</p>'; views.mail.refresh();
    } catch (e) { toast(e.message, 1); }
  };
}

/* ---- tasks ---- */
views.tasks = {
  every: 6000,
  async init() { $('#view').innerHTML = '<div id="tmine"></div><div id="tasg"></div>'; },
  async refresh() {
    const t = await api('/tasks');
    const cnt = a => `${a.filter(x => x.Status === 'Active').length} active • ${a.filter(x => x.Status === 'Finished').length} finished`;
    $('#tmine').innerHTML = me.role === 'CEO' ? '' : `<div class="card"><h3>Work assigned to me</h3><small>${cnt(t.mine)}</small>${tbl(['Title', 'Details', 'From', 'Status', 'Assigned', 'Action'],
      t.mine.map(r => [esc(r.Title), esc(r.Description || '').slice(0, 120), esc(r.AssignedByName), pill(r.Status), dt(r.CreatedAt),
        r.Status === 'Active' ? `<button class="btn sm" data-fin="${r.Id}">Mark finished</button>` : dt(r.FinishedAt)]))}</div>`;
    const title = { CEO: 'All assigned work', Manager: 'Work assigned to Admins', Admin: 'Work assigned to Staff' }[me.role];
    $('#tasg').innerHTML = title ? `<div class="card"><h3>${title}</h3><small>${cnt(t.assigned)}</small>${tbl(['Title', 'Assigned to', 'Role', 'By', 'Status', 'Assigned', 'Finished'],
      t.assigned.map(r => [esc(r.Title), esc(r.AssignedToName), r.AssignedToRole, esc(r.AssignedByName), pill(r.Status), dt(r.CreatedAt), r.FinishedAt ? dt(r.FinishedAt) : '—']))}</div>` : '';
    document.querySelectorAll('[data-fin]').forEach(b => b.onclick = async () => {
      try { await api('/tasks/' + b.dataset.fin + '/finish', 'POST'); toast('Marked as finished'); views.tasks.refresh(); } catch (e) { toast(e.message, 1); }
    });
  }
};

/* ---- servers ---- */
views.servers = {
  every: 5000,
  async init() {
    const add = ['CEO', 'Admin'].includes(me.role) ? `<div class="card"><h3>Register a server</h3><div class="row"><input id="sn" placeholder="Server name"><input id="si" placeholder="IP address"><button class="btn" id="sadd">Add server</button></div></div>` : '';
    $('#view').innerHTML = add + `<div class="card"><h3>${esc(company.Name)}: server health</h3><div id="slist"></div></div>`;
    if (add) $('#sadd').onclick = async () => {
      try { await api('/servers', 'POST', { name: $('#sn').value, ip: $('#si').value }); $('#sn').value = $('#si').value = ''; toast('Server added'); views.servers.refresh(); } catch (e) { toast(e.message, 1); }
    };
  },
  async refresh() {
    const rows = await api('/servers');
    const bar = v => `<span class="bar"><i class="${v >= 85 ? 'hot' : ''}" style="width:${v}%"></i></span>${v}%`;
    $('#slist').innerHTML = tbl(['Server', 'IP address', 'Status', 'CPU', 'Memory', 'Last check'],
      rows.map(r => [esc(r.Name), esc(r.IpAddress), pill(r.Status), bar(r.Cpu), bar(r.Mem), dt(r.CheckedAt)]));
  }
};

/* ---- admin attendance ---- */
views.attendance = {
  every: 5000,
  async init() {
    $('#view').innerHTML = `<div class="grid4"><div class="card stat"><small>Staff present today</small><h3 id="ap">—</h3></div>
      <div class="card stat"><small>Attendance</small><h3 id="apc">—</h3></div></div>
      <div class="card"><h3>Staff attendance today</h3><div id="att"></div></div>
      <div class="card"><h3>Login / logout history</h3><div id="lg"></div></div>`;
  },
  async refresh() {
    const a = await api('/attendance');
    $('#ap').textContent = `${a.summary.present} / ${a.summary.total}`; $('#apc').textContent = a.summary.percent + '%';
    $('#att').innerHTML = attTable(a.rows); $('#lg').innerHTML = logTable(a.log);
  }
};

/* ---- CEO company settings ---- */
views.company = {
  async init() {
    $('#view').innerHTML = `<div class="card"><h3>Company profile</h3>
      <p><small>Company code:</small> <b>${esc(company.Code)}</b> &nbsp; <small>Registered:</small> <b>${dt(company.CreatedAt)}</b></p>
      <p><small>Staff sign-in URL:</small> <b>${esc(location.origin)}/?c=${esc(company.Code)}</b></p>
      <label>Company name</label><input id="cn" value="${esc(company.Name)}">
      <label>Company logo (PNG / JPG / SVG, max 1.5 MB)</label><input id="cl" type="file" accept="image/*">
      <p><img id="lp" src="${company.Logo || ''}" style="max-height:90px;border-radius:10px;${company.Logo ? '' : 'display:none'}"></p>
      <button class="btn" id="csave">Save company</button></div>`;
    let logo = null;
    $('#cl').onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      if (f.size > 1.5 * 1024 * 1024) { toast('Logo must be under 1.5 MB', 1); return; }
      const r = new FileReader(); r.onload = () => { logo = r.result; $('#lp').src = logo; $('#lp').style.display = 'block'; }; r.readAsDataURL(f);
    };
    $('#csave').onclick = async () => {
      try { await api('/company', 'POST', { name: $('#cn').value, logo }); const r = await api('/me'); company = r.company; toast('Company saved'); showApp(); go('company'); }
      catch (e) { toast(e.message, 1); }
    };
  },
  async refresh() {}
};

/* ---- alerts & tickets ---- */
views.tickets = {
  every: 6000,
  async init() {
    $('#view').innerHTML = `<div id="tkn"></div><div class="card"><h3>Open security alerts</h3><div id="sal"></div></div>
      <div class="card"><h3>Password tickets from ${CHILD[me.role]} accounts</h3><div id="tkl"></div></div>`;
  },
  async refresh() {
    const [al, tk] = await Promise.all([api('/alerts'), api('/tickets')]);
    $('#sal').innerHTML = tbl(['Level', 'Alert', 'Time', 'Action'], al.map(a => [pill(a.Level), esc(a.Message), dt(a.CreatedAt),
      `<button class="btn sm" data-ack="${a.Id}">Acknowledge</button>` + (me.role === 'CEO' ? ` <button class="btn sm danger" data-unl="${a.Id}">Unlock account</button>` : '')]));
    $('#tkl').innerHTML = tbl(['Name', 'Email', 'Message', 'Raised', 'Action'], tk.map(t => [esc(t.FullName), esc(t.Email), esc(t.Message || ''), dt(t.CreatedAt),
      `<button class="btn sm" data-res="${t.Id}">Reset password</button>`]));
    const act = (sel, path, done) => document.querySelectorAll(sel).forEach(b => b.onclick = async () => {
      try { const r = await api(path(b), 'POST'); if (done) done(r); toast('Done'); views.tickets.refresh(); } catch (e) { toast(e.message, 1); }
    });
    act('[data-ack]', b => `/alerts/${b.dataset.ack}/ack`);
    act('[data-unl]', b => `/alerts/${b.dataset.unl}/unlock`);
    act('[data-res]', b => `/tickets/${b.dataset.res}/resolve`, r => {
      $('#tkn').innerHTML = `<div class="note">Temporary password: <b>${esc(r.tempPassword)}</b><br><small>Give it to the user. They create their own password at next sign-in.</small></div>`;
    });
  }
};

/* ---- help (CEO + Manager) ---- */
views.help = {
  async init() {
    const info = await api('/help/info');
    $('#view').innerHTML = `<div class="card help"><div class="logo-chip big"><img src="${LOGO}"></div><div>
      <h2>OPS SHIELD Support</h2><p>Secure • Monitor • Protect. Our team helps CEOs and Managers with access, security and server questions.</p>
      <p>✉️ <a href="mailto:${esc(info.email)}">${esc(info.email)}</a></p><p>📞 <a href="tel:${esc(info.phone.replace(/\s/g, ''))}">${esc(info.phone)}</a></p>
      <small>Available to CEO and Manager accounts only.</small></div></div>
      <div class="card"><h3>Send a help request</h3><label>Subject</label><input id="hs"><label>Message</label><textarea id="hm" rows="6"></textarea>
      <button class="btn" id="hsend" style="margin-top:12px">Send request</button></div>`;
    $('#hsend').onclick = async () => {
      try {
        const s = $('#hs').value, m = $('#hm').value;
        await api('/help', 'POST', { subject: s, message: m });
        toast('Request saved');
        location.href = `mailto:${info.email}?subject=${encodeURIComponent('[' + company.Name + '] ' + s)}&body=${encodeURIComponent(m + '\n\n— ' + me.name + ' (' + me.role + ')')}`;
        $('#hs').value = $('#hm').value = '';
      } catch (e) { toast(e.message, 1); }
    };
  },
  async refresh() {}
};

/* ================= START ================= */
token ? boot() : showLogin();
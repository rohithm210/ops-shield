const express = require('express'), path = require('path'), crypto = require('crypto');
const bcrypt = require('bcryptjs'), jwt = require('jsonwebtoken');
const cfg = require('./config');
const { q } = require('./db');

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const CHILD = { CEO: 'Manager', Manager: 'Admin', Admin: 'Staff' };
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const wrap = fn => (req, res) => fn(req, res).catch(e => { console.error(e); res.status(500).json({ error: 'Server error' }); });

/* ---------- reversible encryption (only used so an Admin can view Staff passwords) ---------- */
const KEY = crypto.createHash('sha256').update(cfg.encKey).digest();
function enc(t) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const e = Buffer.concat([c.update(t, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), e].map(b => b.toString('base64')).join('.');
}
function dec(s) {
  try {
    const [iv, tag, e] = s.split('.').map(x => Buffer.from(x, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', KEY, iv); d.setAuthTag(tag);
    return Buffer.concat([d.update(e), d.final()]).toString('utf8');
  } catch { return null; }
}

/* ---------- auth ---------- */
function auth(needApproved = true) {
  return async (req, res, next) => {
    try {
      const h = req.headers.authorization || '';
      const p = jwt.verify(h.startsWith('Bearer ') ? h.slice(7) : '', cfg.jwtSecret);
      if (!p.sid) throw new Error('no session');
      const [u] = await q('SELECT Id,CompanyId,Email,FullName,Role,Status,CreatedBy FROM Users WHERE Id=@id', { id: p.uid });
      if (!u) throw new Error('no user');
      if (needApproved && u.Status !== 'Approved') return res.status(403).json({ error: 'Access not approved yet' });
      req.user = u; req.sid = p.sid; req.tz = parseInt(req.headers['x-tz']) || 0;
      next();
    } catch { res.status(401).json({ error: 'Please sign in again' }); }
  };
}
const only = (...r) => (req, res, next) => r.includes(req.user.Role) ? next() : bad(res, 'Not allowed for your role', 403);

async function ensureAccessRequest(u) {
  let to = u.CreatedBy;
  if (!to) { const [c] = await q("SELECT TOP 1 Id FROM Users WHERE CompanyId=@c AND Role='CEO'", { c: u.CompanyId }); to = c.Id; }
  const open = await q("SELECT 1 x FROM Emails WHERE Type='ACCESS_REQUEST' AND RefUserId=@r AND ActionStatus IS NULL", { r: u.Id });
  if (open.length) return;
  await q("INSERT INTO Emails(CompanyId,FromUserId,ToUserId,Subject,Body,Type,RefUserId) VALUES(@c,@f,@t,@s,@b,'ACCESS_REQUEST',@r)", {
    c: u.CompanyId, f: u.Id, t: to, r: u.Id,
    s: `Access request: ${u.FullName} (${u.Role})`,
    b: `${u.FullName} (${u.Email}) signed in and is waiting for permission to open the ${u.Role} portal.\n\nPlease approve or deny this request.`
  });
}

async function createSession(u, ip) {
  const [l] = await q('INSERT INTO LoginLog(UserId,CompanyId,LoginAt,LastSeen,Ip) OUTPUT INSERTED.Id VALUES(@u,@c,SYSUTCDATETIME(),SYSUTCDATETIME(),@ip)',
    { u: u.Id, c: u.CompanyId, ip: String(ip || '').slice(0, 60) });
  if (u.Status === 'Pending' && (u.Role === 'Manager' || u.Role === 'Admin')) await ensureAccessRequest(u);
  return jwt.sign({ uid: u.Id, sid: l.Id }, cfg.jwtSecret, { expiresIn: '12h' });
}

async function setAccess(targetId, status, approver) {
  const [t] = await q('SELECT Id,Role,CompanyId FROM Users WHERE Id=@id', { id: targetId });
  if (!t || t.CompanyId !== approver.CompanyId || CHILD[approver.Role] !== t.Role) return false;
  await q('UPDATE Users SET Status=@s WHERE Id=@id', { s: status, id: t.Id });
  await q("UPDATE Emails SET ActionStatus=@s WHERE Type='ACCESS_REQUEST' AND RefUserId=@id AND ActionStatus IS NULL", { s: status, id: t.Id });
  return true;
}

/* ---------- public + login ---------- */
app.get('/api/company/:code', wrap(async (req, res) => {
  const [c] = await q('SELECT Code,Name,Logo FROM Companies WHERE Code=@c', { c: String(req.params.code).toUpperCase() });
  if (!c) return bad(res, 'Company not found', 404);
  res.json(c);
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const { code, email, secret } = req.body || {};
  if (!code || !email || !secret) return bad(res, 'Company code, email and password are required');
  const [u] = await q('SELECT u.* FROM Users u JOIN Companies c ON c.Id=u.CompanyId WHERE c.Code=@code AND u.Email=@e',
    { code: String(code).toUpperCase(), e: String(email).trim().toLowerCase() });
  if (!u || !(await bcrypt.compare(String(secret).trim(), u.PasswordHash))) return bad(res, 'Invalid email or password', 401);
  if (u.MustSetPassword) return res.json({ needsPassword: true, setupToken: jwt.sign({ uid: u.Id, purpose: 'setup' }, cfg.jwtSecret, { expiresIn: '15m' }) });
  res.json({ token: await createSession(u, req.ip) });
}));

app.post('/api/auth/setpassword', wrap(async (req, res) => {
  const { setupToken, password } = req.body || {};
  let p; try { p = jwt.verify(setupToken, cfg.jwtSecret); } catch { return bad(res, 'Setup expired, please sign in again', 401); }
  if (p.purpose !== 'setup') return bad(res, 'Invalid token', 401);
  const pw = String(password || '').trim();
  if (pw.length < 8) return bad(res, 'Password must be at least 8 characters');
  const [u] = await q('SELECT * FROM Users WHERE Id=@id', { id: p.uid });
  if (!u || !u.MustSetPassword) return bad(res, 'Password already created, please sign in', 400);
  await q('UPDATE Users SET PasswordHash=@h,PasswordEnc=@e,MustSetPassword=0 WHERE Id=@id',
    { h: await bcrypt.hash(pw, 10), e: u.Role === 'CEO' ? null : enc(pw), id: u.Id });
  res.json({ token: await createSession(u, req.ip) });
}));

app.post('/api/auth/logout', auth(false), wrap(async (req, res) => {
  await q('UPDATE LoginLog SET LogoutAt=SYSUTCDATETIME() WHERE Id=@s AND LogoutAt IS NULL', { s: req.sid });
  res.json({ ok: true });
}));

app.post('/api/ping', auth(false), wrap(async (req, res) => {
  await q('UPDATE LoginLog SET LastSeen=SYSUTCDATETIME(),LogoutAt=NULL WHERE Id=@s', { s: req.sid });
  res.json({ ok: true });
}));

app.get('/api/me', auth(false), wrap(async (req, res) => {
  const u = req.user;
  const [c] = await q('SELECT Id,Code,Name,Logo,CreatedAt FROM Companies WHERE Id=@c', { c: u.CompanyId });
  res.json({ user: { id: u.Id, email: u.Email, name: u.FullName, role: u.Role, status: u.Status }, company: c });
}));

app.get('/api/users', auth(), wrap(async (req, res) => {
  res.json(await q("SELECT Id,FullName,Email,Role FROM Users WHERE CompanyId=@c AND Status='Approved' AND Id<>@me ORDER BY Role,FullName",
    { c: req.user.CompanyId, me: req.user.Id }));
}));

/* ---------- team (CEO->Managers, Manager->Admins, Admin->Staff) ---------- */
app.get('/api/team', auth(), only('CEO', 'Manager', 'Admin'), wrap(async (req, res) => {
  const role = CHILD[req.user.Role];
  const rows = await q(`SELECT u.Id,u.FullName,u.Email,u.Status,u.MustSetPassword,u.PasswordEnc,u.CreatedAt,
      (SELECT MAX(LoginAt) FROM LoginLog WHERE UserId=u.Id) LastLogin,
      (SELECT COUNT(*) FROM LoginLog WHERE UserId=u.Id AND LogoutAt IS NULL) OnlineCount
    FROM Users u WHERE u.CompanyId=@c AND u.Role=@r ORDER BY u.FullName`, { c: req.user.CompanyId, r: role });
  res.json({
    role,
    users: rows.map(r => ({
      Id: r.Id, FullName: r.FullName, Email: r.Email, Status: r.Status, Temporary: !!r.MustSetPassword,
      CreatedAt: r.CreatedAt, LastLogin: r.LastLogin, IsOnline: r.OnlineCount > 0,
      Password: req.user.Role === 'Admin' && r.PasswordEnc ? dec(r.PasswordEnc) : undefined
    }))
  });
}));

app.post('/api/team', auth(), only('CEO', 'Manager', 'Admin'), wrap(async (req, res) => {
  const nm = String((req.body || {}).fullName || '').trim();
  const em = String((req.body || {}).email || '').trim().toLowerCase();
  if (!nm || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return bad(res, 'Enter a valid name and email');
  const ex = await q('SELECT 1 x FROM Users WHERE CompanyId=@c AND Email=@e', { c: req.user.CompanyId, e: em });
  if (ex.length) return bad(res, 'That email already exists');
  const temp = 'Tmp-' + crypto.randomBytes(5).toString('hex');
  const role = CHILD[req.user.Role];
  await q('INSERT INTO Users(CompanyId,Email,FullName,Role,PasswordHash,PasswordEnc,MustSetPassword,Status,CreatedBy) VALUES(@c,@e,@n,@r,@h,@enc,1,@s,@by)', {
    c: req.user.CompanyId, e: em, n: nm, r: role, h: await bcrypt.hash(temp, 10), enc: enc(temp),
    s: role === 'Staff' ? 'Approved' : 'Pending', by: req.user.Id
  });
  res.json({ tempPassword: temp, role });
}));

app.post('/api/team/:id/status', auth(), only('CEO', 'Manager'), wrap(async (req, res) => {
  const s = (req.body || {}).status;
  if (!['Approved', 'Denied', 'Pending'].includes(s)) return bad(res, 'Invalid status');
  if (!(await setAccess(parseInt(req.params.id), s, req.user))) return bad(res, 'You cannot manage this user', 403);
  res.json({ ok: true });
}));

/* ---------- mail ---------- */
app.get('/api/mail/inbox', auth(), wrap(async (req, res) => {
  res.json(await q(`SELECT TOP 200 e.Id,e.Subject,e.Body,e.Type,e.ActionStatus,e.IsRead,e.CreatedAt,u.FullName FromName,u.Role FromRole
    FROM Emails e JOIN Users u ON u.Id=e.FromUserId WHERE e.ToUserId=@me ORDER BY e.Id DESC`, { me: req.user.Id }));
}));
app.get('/api/mail/sent', auth(), wrap(async (req, res) => {
  res.json(await q(`SELECT TOP 200 e.Id,e.Subject,e.Body,e.Type,e.ActionStatus,e.IsRead,e.CreatedAt,u.FullName ToName,u.Role ToRole
    FROM Emails e JOIN Users u ON u.Id=e.ToUserId WHERE e.FromUserId=@me AND e.Type<>'ACCESS_REQUEST' ORDER BY e.Id DESC`, { me: req.user.Id }));
}));
app.get('/api/mail/unread', auth(false), wrap(async (req, res) => {
  const [r] = await q('SELECT COUNT(*) n FROM Emails WHERE ToUserId=@me AND IsRead=0', { me: req.user.Id });
  res.json({ count: r.n });
}));
app.post('/api/mail/:id/read', auth(), wrap(async (req, res) => {
  await q('UPDATE Emails SET IsRead=1 WHERE Id=@id AND ToUserId=@me', { id: parseInt(req.params.id), me: req.user.Id });
  res.json({ ok: true });
}));
app.post('/api/mail/:id/action', auth(), only('CEO', 'Manager'), wrap(async (req, res) => {
  const a = req.body.action === 'approve' ? 'Approved' : req.body.action === 'deny' ? 'Denied' : null;
  if (!a) return bad(res, 'Invalid action');
  const [m] = await q("SELECT * FROM Emails WHERE Id=@id AND ToUserId=@me AND Type='ACCESS_REQUEST'", { id: parseInt(req.params.id), me: req.user.Id });
  if (!m) return bad(res, 'Request not found', 404);
  if (!(await setAccess(m.RefUserId, a, req.user))) return bad(res, 'You cannot manage this user', 403);
  res.json({ ok: true });
}));
app.post('/api/mail/send', auth(), wrap(async (req, res) => {
  const { toUserId, subject, body, asTask } = req.body || {};
  const [to] = await q("SELECT Id,Role FROM Users WHERE Id=@id AND CompanyId=@c AND Status='Approved'", { id: parseInt(toUserId), c: req.user.CompanyId });
  if (!to) return bad(res, 'Recipient not found');
  const s = String(subject || '').trim(), b = String(body || '').trim();
  if (!s || !b) return bad(res, 'Subject and message are required');
  if (asTask && CHILD[req.user.Role] !== to.Role) return bad(res, 'You can only assign work to ' + (CHILD[req.user.Role] || 'nobody') + ' accounts');
  await q('INSERT INTO Emails(CompanyId,FromUserId,ToUserId,Subject,Body,Type) VALUES(@c,@f,@t,@s,@b,@ty)',
    { c: req.user.CompanyId, f: req.user.Id, t: to.Id, s: s.slice(0, 200), b, ty: asTask ? 'TASK' : 'MAIL' });
  if (asTask) await q("INSERT INTO Tasks(CompanyId,Title,Description,AssignedTo,AssignedBy,Status) VALUES(@c,@t,@d,@to,@by,'Active')",
    { c: req.user.CompanyId, t: s.slice(0, 200), d: b, to: to.Id, by: req.user.Id });
  res.json({ ok: true });
}));

/* ---------- tasks ---------- */
app.get('/api/tasks', auth(), wrap(async (req, res) => {
  const base = `SELECT t.Id,t.Title,t.Description,t.Status,t.CreatedAt,t.FinishedAt,a.FullName AssignedToName,a.Role AssignedToRole,b.FullName AssignedByName
    FROM Tasks t JOIN Users a ON a.Id=t.AssignedTo JOIN Users b ON b.Id=t.AssignedBy WHERE t.CompanyId=@c`;
  const c = req.user.CompanyId;
  const mine = req.user.Role === 'CEO' ? [] : await q(base + ' AND t.AssignedTo=@me ORDER BY t.Id DESC', { c, me: req.user.Id });
  let assigned = [];
  if (req.user.Role === 'CEO') assigned = await q(base + ' ORDER BY t.Id DESC', { c });
  else if (CHILD[req.user.Role]) assigned = await q(base + ' AND a.Role=@r ORDER BY t.Id DESC', { c, r: CHILD[req.user.Role] });
  res.json({ mine, assigned });
}));
app.post('/api/tasks/:id/finish', auth(), wrap(async (req, res) => {
  await q("UPDATE Tasks SET Status='Finished',FinishedAt=SYSUTCDATETIME() WHERE Id=@id AND AssignedTo=@me", { id: parseInt(req.params.id), me: req.user.Id });
  res.json({ ok: true });
}));

/* ---------- attendance (from login method) ---------- */
app.get('/api/attendance', auth(), only('CEO', 'Manager', 'Admin'), wrap(async (req, res) => {
  const roles = { CEO: "'Manager','Admin','Staff'", Manager: "'Admin','Staff'", Admin: "'Staff'" }[req.user.Role];
  const rows = await q(`SELECT u.Id,u.FullName,u.Role,MIN(l.LoginAt) FirstLogin,MAX(l.LogoutAt) LastLogout,COUNT(l.Id) Sessions,
      MAX(CASE WHEN l.LogoutAt IS NULL AND l.Id IS NOT NULL THEN 1 ELSE 0 END) IsOnline
    FROM Users u LEFT JOIN LoginLog l ON l.UserId=u.Id
      AND CAST(DATEADD(MINUTE,@tz,l.LoginAt) AS DATE)=CAST(DATEADD(MINUTE,@tz,SYSUTCDATETIME()) AS DATE)
    WHERE u.CompanyId=@c AND u.Status='Approved' AND u.Role IN (${roles})
    GROUP BY u.Id,u.FullName,u.Role ORDER BY u.Role,u.FullName`, { c: req.user.CompanyId, tz: req.tz });
  const log = await q(`SELECT TOP 40 u.FullName,u.Role,l.LoginAt,l.LogoutAt FROM LoginLog l JOIN Users u ON u.Id=l.UserId
    WHERE l.CompanyId=@c AND u.Role IN (${roles}) ORDER BY l.Id DESC`, { c: req.user.CompanyId });
  const present = rows.filter(r => r.Sessions > 0).length;
  res.json({ summary: { total: rows.length, present, percent: rows.length ? Math.round(present * 100 / rows.length) : 0 }, rows, log });
}));

/* ---------- servers ---------- */
app.get('/api/servers', auth(), only('CEO', 'Manager', 'Admin'), wrap(async (req, res) => {
  res.json(await q('SELECT Id,Name,IpAddress,Status,Cpu,Mem,CheckedAt FROM Servers WHERE CompanyId=@c ORDER BY Name', { c: req.user.CompanyId }));
}));
app.post('/api/servers', auth(), only('CEO', 'Admin'), wrap(async (req, res) => {
  const n = String((req.body || {}).name || '').trim(), ip = String((req.body || {}).ip || '').trim();
  if (!n || !ip) return bad(res, 'Server name and IP are required');
  await q("INSERT INTO Servers(CompanyId,Name,IpAddress,Status,Cpu,Mem) VALUES(@c,@n,@ip,'Online',20,30)", { c: req.user.CompanyId, n: n.slice(0, 80), ip: ip.slice(0, 60) });
  res.json({ ok: true });
}));

/* ---------- stock market (simulated) ---------- */
const market = {}; let mood = 0;
async function initMarket() {
  (await q('SELECT Id FROM Companies')).forEach((c, i) => ensureStock(c.Id, i));
  for (let i = 0; i < 40; i++) tickMarket();
  Object.values(market).forEach(m => { m.open = m.hist[0]; });
}
function ensureStock(id, i = Object.keys(market).length) {
  if (!market[id]) { const base = 1000 + i * 350; market[id] = { open: base, price: base, hist: [base] }; }
}
function tickMarket() {
  mood = Math.max(-1, Math.min(1, mood + (Math.random() - 0.5) * 0.4));
  for (const m of Object.values(market)) {
    m.price = Math.max(50, +(m.price * (1 + mood * 0.003 + (Math.random() - 0.5) * 0.006)).toFixed(2));
    m.hist.push(m.price); if (m.hist.length > 60) m.hist.shift();
  }
}
app.get('/api/stock', auth(), only('CEO'), wrap(async (req, res) => {
  ensureStock(req.user.CompanyId);
  const m = market[req.user.CompanyId];
  res.json({ price: m.price, open: m.open, change: m.price - m.open, pct: (m.price - m.open) / m.open * 100, hist: m.hist,
    mood: mood > 0.25 ? 'Bullish' : mood < -0.25 ? 'Bearish' : 'Stable' });
}));

/* ---------- accounts, company, help ---------- */
app.get('/api/accounts', auth(), only('CEO'), wrap(async (req, res) => {
  res.json({ rows: await q('SELECT TOP 30 Id,EntryDate,Description,Revenue,Expense FROM Accounts WHERE CompanyId=@c ORDER BY EntryDate DESC,Id DESC', { c: req.user.CompanyId }) });
}));
app.post('/api/accounts', auth(), only('CEO'), wrap(async (req, res) => {
  const { entryDate, description, revenue, expense } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate || '') || !String(description || '').trim()) return bad(res, 'Date and description are required');
  const r = Number(revenue || 0), x = Number(expense || 0);
  if (!isFinite(r) || !isFinite(x) || r < 0 || x < 0) return bad(res, 'Amounts must be positive numbers');
  await q('INSERT INTO Accounts(CompanyId,EntryDate,Description,Revenue,Expense) VALUES(@c,@d,@t,@r,@x)',
    { c: req.user.CompanyId, d: entryDate, t: String(description).trim().slice(0, 200), r, x });
  res.json({ ok: true });
}));
app.post('/api/company', auth(), only('CEO'), wrap(async (req, res) => {
  const { name, logo } = req.body || {};
  const nm = String(name || '').trim();
  if (!nm) return bad(res, 'Company name is required');
  if (logo && !/^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,/.test(logo)) return bad(res, 'Logo must be a PNG, JPG, WEBP or SVG image');
  await q('UPDATE Companies SET Name=@n,Logo=ISNULL(@l,Logo) WHERE Id=@c', { n: nm.slice(0, 120), l: logo || null, c: req.user.CompanyId });
  res.json({ ok: true });
}));
app.get('/api/help/info', auth(), only('CEO', 'Manager'), (req, res) => res.json(cfg.help));
app.post('/api/help', auth(), only('CEO', 'Manager'), wrap(async (req, res) => {
  const s = String((req.body || {}).subject || '').trim(), m = String((req.body || {}).message || '').trim();
  if (!s || !m) return bad(res, 'Subject and message are required');
  await q('INSERT INTO HelpRequests(CompanyId,UserId,Subject,Message) VALUES(@c,@u,@s,@m)', { c: req.user.CompanyId, u: req.user.Id, s: s.slice(0, 200), m });
  res.json({ ok: true });
}));

/* ---------- background jobs ---------- */
let ticks = 0;
setInterval(async () => {
  tickMarket();
  try {
    await q(`UPDATE Servers SET Cpu=15+ABS(CHECKSUM(NEWID()))%80, Mem=25+ABS(CHECKSUM(NEWID()))%70, CheckedAt=SYSUTCDATETIME();
             UPDATE Servers SET Status=CASE WHEN Cpu>=90 THEN 'Offline' WHEN Cpu>=80 THEN 'Warning' ELSE 'Online' END`);
    if (++ticks % 12 === 0) for (const [id, m] of Object.entries(market)) await q('INSERT INTO StockPrices(CompanyId,Price) VALUES(@c,@p)', { c: +id, p: m.price });
  } catch (e) { console.error('job error:', e.message); }
}, 5000);
setInterval(() => q('UPDATE LoginLog SET LogoutAt=LastSeen WHERE LogoutAt IS NULL AND LastSeen<DATEADD(MINUTE,-3,SYSUTCDATETIME())').catch(() => {}), 60000);

(async () => {
  await initMarket();
  app.listen(cfg.port, () => console.log(`OPS SHIELD running on http://localhost:${cfg.port}`));
})().catch(e => { console.error('Could not start:', e.message); process.exit(1); });
const bcrypt = require('bcryptjs'), crypto = require('crypto');
const { q } = require('./db');
const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const grp = () => Array.from(crypto.randomBytes(4), b => A[b % A.length]).join('');
(async () => {
  const [cmd, code] = process.argv.slice(2);
  if (cmd === 'tickets') {
    console.table(await q(`SELECT t.Id,c.Code,t.Type,t.Email,t.Message,t.CreatedAt FROM Tickets t JOIN Companies c ON c.Id=t.CompanyId
      WHERE t.Status='Open' AND (t.Type='API_KEY' OR EXISTS(SELECT 1 FROM Users u WHERE u.CompanyId=t.CompanyId AND u.Email=t.Email AND u.Role='CEO')) ORDER BY t.Id`));
  } else if (cmd === 'resetkey' && code) {
    const [c] = await q('SELECT Id FROM Companies WHERE Code=@c', { c: code.toUpperCase() });
    if (!c) throw new Error('Company not found');
    const key = `OPS-${grp()}-${grp()}-${grp()}-${grp()}`, h = await bcrypt.hash(key, 10);
    await q('UPDATE Companies SET ApiKeyHash=@h WHERE Id=@id', { h, id: c.Id });
    await q("UPDATE Users SET PasswordHash=@h,PasswordEnc=NULL,MustSetPassword=1 WHERE CompanyId=@id AND Role='CEO'", { h, id: c.Id });
    await q('DELETE FROM FailedLogins WHERE CompanyId=@id', { id: c.Id });
    await q("UPDATE Tickets SET Status='Resolved',ResolvedAt=SYSUTCDATETIME() WHERE CompanyId=@id AND Status='Open' AND (Type='API_KEY' OR Email IN (SELECT Email FROM Users WHERE CompanyId=@id AND Role='CEO'))", { id: c.Id });
    console.log(`New first-time password for ${code.toUpperCase()}: ${key}`);
  } else console.log('Usage: node owner.js tickets   |   node owner.js resetkey NOVA');
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
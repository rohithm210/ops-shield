const fs = require('fs'), crypto = require('crypto'), bcrypt = require('bcryptjs');
const cfg = require('./config');
const { connect } = require('./db');

const DDL = [
`IF OBJECT_ID('Companies') IS NULL CREATE TABLE Companies(
  Id INT IDENTITY PRIMARY KEY, Code NVARCHAR(20) NOT NULL UNIQUE, Name NVARCHAR(120) NOT NULL,
  Logo NVARCHAR(MAX) NULL, ApiKeyHash NVARCHAR(100) NOT NULL, CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME())`,
`IF OBJECT_ID('Users') IS NULL CREATE TABLE Users(
  Id INT IDENTITY PRIMARY KEY, CompanyId INT NOT NULL REFERENCES Companies(Id),
  Email NVARCHAR(150) NOT NULL, FullName NVARCHAR(120) NOT NULL,
  Role NVARCHAR(10) NOT NULL CHECK(Role IN('CEO','Manager','Admin','Staff')),
  PasswordHash NVARCHAR(100) NOT NULL, PasswordEnc NVARCHAR(500) NULL,
  MustSetPassword BIT NOT NULL DEFAULT 1, Status NVARCHAR(10) NOT NULL DEFAULT 'Pending',
  CreatedBy INT NULL, CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_User UNIQUE(CompanyId, Email))`,
`IF OBJECT_ID('LoginLog') IS NULL CREATE TABLE LoginLog(
  Id INT IDENTITY PRIMARY KEY, UserId INT NOT NULL REFERENCES Users(Id), CompanyId INT NOT NULL,
  LoginAt DATETIME2 NOT NULL, LastSeen DATETIME2 NOT NULL, LogoutAt DATETIME2 NULL, Ip NVARCHAR(60) NULL)`,
`IF OBJECT_ID('Servers') IS NULL CREATE TABLE Servers(
  Id INT IDENTITY PRIMARY KEY, CompanyId INT NOT NULL REFERENCES Companies(Id),
  Name NVARCHAR(80) NOT NULL, IpAddress NVARCHAR(60) NOT NULL, Status NVARCHAR(12) NOT NULL DEFAULT 'Online',
  Cpu INT NOT NULL DEFAULT 0, Mem INT NOT NULL DEFAULT 0,
  CheckedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(), CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME())`,
`IF OBJECT_ID('Emails') IS NULL CREATE TABLE Emails(
  Id INT IDENTITY PRIMARY KEY, CompanyId INT NOT NULL, FromUserId INT NOT NULL REFERENCES Users(Id),
  ToUserId INT NOT NULL REFERENCES Users(Id), Subject NVARCHAR(200) NOT NULL, Body NVARCHAR(MAX) NOT NULL,
  Type NVARCHAR(20) NOT NULL DEFAULT 'MAIL', RefUserId INT NULL, ActionStatus NVARCHAR(10) NULL,
  IsRead BIT NOT NULL DEFAULT 0, CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME())`,
`IF OBJECT_ID('Tasks') IS NULL CREATE TABLE Tasks(
  Id INT IDENTITY PRIMARY KEY, CompanyId INT NOT NULL, Title NVARCHAR(200) NOT NULL, Description NVARCHAR(MAX) NULL,
  AssignedTo INT NOT NULL REFERENCES Users(Id), AssignedBy INT NOT NULL REFERENCES Users(Id),
  Status NVARCHAR(10) NOT NULL DEFAULT 'Active', CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(), FinishedAt DATETIME2 NULL)`,
`IF OBJECT_ID('Accounts') IS NULL CREATE TABLE Accounts(
  Id INT IDENTITY PRIMARY KEY, CompanyId INT NOT NULL REFERENCES Companies(Id), EntryDate DATE NOT NULL,
  Description NVARCHAR(200) NOT NULL, Revenue DECIMAL(14,2) NOT NULL DEFAULT 0, Expense DECIMAL(14,2) NOT NULL DEFAULT 0)`,
`IF OBJECT_ID('StockPrices') IS NULL CREATE TABLE StockPrices(
  Id INT IDENTITY PRIMARY KEY, CompanyId INT NOT NULL, Price DECIMAL(12,2) NOT NULL, At DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME())`,
`IF OBJECT_ID('HelpRequests') IS NULL CREATE TABLE HelpRequests(
  Id INT IDENTITY PRIMARY KEY, CompanyId INT NOT NULL, UserId INT NOT NULL, Subject NVARCHAR(200) NOT NULL,
  Message NVARCHAR(MAX) NOT NULL, CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME())`,
`IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE name='IX_Login' AND object_id=OBJECT_ID('LoginLog'))
  CREATE INDEX IX_Login ON LoginLog(CompanyId, LoginAt)`,
`IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE name='IX_MailTo' AND object_id=OBJECT_ID('Emails'))
  CREATE INDEX IX_MailTo ON Emails(ToUserId, Id)`
];

const COMPANIES = [
  { code: 'NOVA', name: 'Nova Technologies', ceo: 'ceo@novatech.com', ceoName: 'Nova CEO' },
  { code: 'ZEN',  name: 'Zenith Logistics',  ceo: 'ceo@zenithlog.com', ceoName: 'Zenith CEO' },
  { code: 'ORB',  name: 'Orbit Finance',     ceo: 'ceo@orbitfin.com', ceoName: 'Orbit CEO' }
];

const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const grp = () => Array.from(crypto.randomBytes(4), b => A[b % A.length]).join('');
const genKey = () => `OPS-${grp()}-${grp()}-${grp()}-${grp()}`;
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

(async () => {
  const master = await connect('master');
  await master.request().batch(`IF DB_ID('${cfg.db.database}') IS NULL CREATE DATABASE [${cfg.db.database}]`);
  await master.close();

  const db = await connect(cfg.db.database);
  for (const s of DDL) await db.request().batch(s);

  const lines = [];
  for (const [i, c] of COMPANIES.entries()) {
    const ex = await db.request().input('c', c.code).query('SELECT Id FROM Companies WHERE Code=@c');
    if (ex.recordset.length) { lines.push(`${c.code}: already exists (its key was shown when it was first created)`); continue; }

    const key = genKey();
    const hash = await bcrypt.hash(key, 10);
    const co = await db.request().input('c', c.code).input('n', c.name).input('h', hash)
      .query('INSERT INTO Companies(Code,Name,ApiKeyHash) OUTPUT INSERTED.Id VALUES(@c,@n,@h)');
    const id = co.recordset[0].Id;

    await db.request().input('c', id).input('e', c.ceo).input('n', c.ceoName).input('h', hash)
      .query("INSERT INTO Users(CompanyId,Email,FullName,Role,PasswordHash,MustSetPassword,Status) VALUES(@c,@e,@n,'CEO',@h,1,'Approved')");

    for (const [j, n] of ['WEB-01', 'APP-01', 'DB-01', 'MAIL-01'].entries()) {
      await db.request().input('c', id).input('n', n).input('ip', `10.${i + 1}.0.${10 + j}`).input('cpu', rnd(20, 70)).input('mem', rnd(30, 80))
        .query("INSERT INTO Servers(CompanyId,Name,IpAddress,Status,Cpu,Mem) VALUES(@c,@n,@ip,'Online',@cpu,@mem)");
    }
    for (let d = 6; d >= 0; d--) {
      const date = new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
      await db.request().input('c', id).input('d', date).input('r', rnd(80000, 200000)).input('x', rnd(40000, 120000))
        .query("INSERT INTO Accounts(CompanyId,EntryDate,Description,Revenue,Expense) VALUES(@c,@d,'Daily sales and expenses',@r,@x)");
    }
    lines.push(`${c.name}\n   URL      : http://localhost:${cfg.port}/?c=${c.code}\n   CEO email: ${c.ceo}\n   API key  : ${key}   (use this as the first-time password)\n`);
  }

  const text = lines.join('\n');
  console.log('\n==== OPS SHIELD SETUP COMPLETE ====\n' + text);
  if (text.includes('API key')) fs.writeFileSync('company_keys.txt', text);
  await db.close();
  process.exit(0);
})().catch(e => { console.error('SETUP FAILED:', e.message); process.exit(1); });
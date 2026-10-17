const cfg = require('./config').db;
const sql = cfg.mode === 'windows' ? require('mssql/msnodesqlv8') : require('mssql');

function makeConfig(database) {
  if (cfg.mode === 'windows') {
    return {
      connectionString: `Driver={${cfg.odbcDriver}};Server=${cfg.server};Database=${database};Trusted_Connection=Yes;TrustServerCertificate=Yes;`,
      pool: { max: 100, min: 0 }
    };
  }
  return {
    server: cfg.server, database, user: cfg.user, password: cfg.password,
    pool: { max: 100, min: 0, idleTimeoutMillis: 30000 },
    options: { encrypt: true, trustServerCertificate: true }
  };
}

async function connect(database) {
  const pool = new sql.ConnectionPool(makeConfig(database));
  await pool.connect();
  return pool;
}

let main;
async function getPool() {
  if (!main) main = await connect(cfg.database);
  return main;
}

async function q(text, params = {}) {
  const pool = await getPool();
  const r = pool.request();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) r.input(k, v);
  const res = await r.query(text);
  return res.recordset || [];
}

module.exports = { sql, connect, getPool, q };
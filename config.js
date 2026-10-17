const e = process.env;

const cfg = {
  port: e.PORT || 3000,
  jwtSecret: e.JWT_SECRET,
  encKey: e.ENC_KEY,
  help: { email: 'rohithm208lax@gmail.com', phone: '+91 9535336206' },
  db: {
    mode: e.DB_MODE || 'windows',
    server: e.DB_SERVER || 'localhost',
    database: e.DB_NAME || 'OpsShield',
    odbcDriver: 'ODBC Driver 18 for SQL Server',
    user: e.DB_USER || 'opsadmin',
    password: e.DB_PASSWORD
  }
};

if (!cfg.jwtSecret || !cfg.encKey || cfg.jwtSecret.length < 32 || cfg.encKey.length < 32) {
  console.error('Set JWT_SECRET and ENC_KEY (32+ random characters) before starting.');
  process.exit(1);
}

module.exports = cfg;
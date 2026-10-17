# OPS SHIELD

Multi-company operations dashboard (Node.js, Express, SQL Server).

## Requirements
- Node.js 18+
- SQL Server (local, Windows authentication) with ODBC Driver 18

## Setup
1. `npm install`
2. Copy `start.example.ps1` to `start.ps1` and fill in `JWT_SECRET` and `ENC_KEY` (32+ random characters each). Never change `ENC_KEY` after data exists.
3. Set the same two variables in your shell, then run `npm run setup`. This creates the database and three companies, and writes first-time API keys to `company_keys.txt`.
4. Run `.\start.ps1` and open `http://localhost:3000/?c=NOVA`.

## Notes
- `start.ps1` and `company_keys.txt` are git-ignored. Do not commit them.
- Environment variables: `PORT`, `JWT_SECRET`, `ENC_KEY`, `DB_MODE` (`windows` or `sql`), `DB_SERVER`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`.

## Status
Running locally on Windows with SQL Server.

## Security alerts
- Failed sign-ins are counted per user over 30 minutes. 2 attempts raise a yellow alert, 5 an orange alert, and 10 a red alert with an inbox mail to the CEO. At 10 the account is locked for 30 minutes.
- Users can raise "forgot password" tickets from the login page. Admins, Managers and the CEO reset passwords for the role below them under Alerts & Tickets.
- Lost API keys and CEO password tickets are handled by the platform owner with `node owner.js tickets` and `node owner.js resetkey CODE`.
- Run `npm run setup` after updating, so the new tables are created.

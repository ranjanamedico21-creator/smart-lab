/**
 * Reuse your EXISTING mysql2/promise pool here instead of creating a new
 * one. This file is a thin re-export stub — point it at your existing
 * connection module, e.g.:
 *
 *   module.exports = require('../../../config/database'); // your existing pool
 *
 * Shown here as a standalone example for completeness:
 */

// Loads .env into process.env. Safe to call more than once (idempotent —
// it never overwrites a variable that's already set), so this stays here
// even if your real entry file also calls dotenv.config() itself. Without
// this, every process.env.DB_* read below silently comes back undefined
// and mysql2 connects as user '' with no password — which is exactly the
// "Access denied for user ''@'localhost'" error this fixes.
const dotenvResult = require('dotenv').config();

const mysql = require('mysql2/promise');

// Always print what actually got loaded — never fail silently. If you see
// "DB_USER: (not set)" below, dotenv did not find/parse your .env file:
// check (a) you're running node from the same folder the .env file is in
// — run `pwd` and `ls -la` to confirm — and (b) the file is really named
// `.env`, not `.env.txt` (a common Finder/text-editor default on macOS
// that hides the real extension).
// eslint-disable-next-line no-console
console.log('[config/db.js] dotenv loaded from:', dotenvResult.error ? `FAILED — ${dotenvResult.error.message}` : (dotenvResult.parsed ? Object.keys(dotenvResult.parsed).join(', ') : '(no .env file found)'));
// eslint-disable-next-line no-console
console.log('[config/db.js] Resolved connection config:', {
  host: process.env.DB_HOST || 'localhost (default)',
  user: process.env.DB_USER || '(not set)',
  password: process.env.DB_PASSWORD ? `set (${process.env.DB_PASSWORD.length} chars)` : '(not set)',
  database: process.env.DB_NAME || '(not set)',
});

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

module.exports = pool;

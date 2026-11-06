// config/DBConnection.js — SmartLab
// SECURITY PATCH (2026-10-25) — changes marked ★
require("dotenv").config();
const mysql = require("mysql2");

const IS_PROD = process.env.NODE_ENV === "production";

// ★ The password was hard-coded as "" — works on the local Mac, but production must use its own.
//   Set DBPASSWORD in .env (local) and in cPanel → Setup Node.js App (production).
const password = process.env.DBPASSWORD || "";
if (IS_PROD && !password) {
  console.error("[security] DBPASSWORD is empty in production — set it in cPanel → Setup Node.js App.");
}

const pool = mysql.createPool({
  host: process.env.HOST,
  port: Number(process.env.DBPORT) || 3306,
  user: process.env.DBUSERNAME,
  password,
  database: process.env.DATABASE,
  charset: "utf8mb4_general_ci",   // ★ same collation as your tables (the #1267 "Illegal mix of collations" family)
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL_SIZE) || 10,
  queueLimit: 0,
  enableKeepAlive: true,
  // ★ was true. With it ON, any SQL-injection bug anywhere in the app becomes "…; DROP TABLE PatientDetails"
  //   or "…; UPDATE PatientDetails SET DuesAmount = 0". The app's queries run one statement each.
  multipleStatements: false,
});

// ★ Same clock for MySQL and Node. NOW() / CURDATE() ran on the DB server's zone (often UTC) while the app
//   uses India time → rows written with NOW() between 00:00 and 05:30 IST got YESTERDAY's date
//   (Referrals.RegisteredOn, sessions, …) and dropped out of "today" reports. DATETIME columns already saved
//   are not changed by this. Set DB_TIME_ZONE='' to turn it off.
const DB_TIME_ZONE = process.env.DB_TIME_ZONE === undefined ? "+05:30" : process.env.DB_TIME_ZONE;
if (DB_TIME_ZONE) {
  pool.on("connection", (conn) => {
    conn.query("SET time_zone = ?", [DB_TIME_ZONE], (err) => {
      if (err) console.error("[db] could not set time_zone:", err.code || err.message);
    });
  });
}

// Promise-based pool
const promisePool = pool.promise();

/**
 * UNIVERSAL EXPORT
 * Supports:
 *  db.execute()
 *  db.promise().execute()
 *  db.connection.promise().execute()
 */
module.exports = {
  execute:     (...args) => promisePool.execute(...args),
  query:       (...args) => promisePool.query(...args),
  promise:     () => promisePool,
  getConnection: () => promisePool.getConnection(),
  connection:  pool,
  pool
};
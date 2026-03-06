require("dotenv").config();
const mysql = require("mysql2");

const pool = mysql.createPool({
  host: process.env.HOST,
  user: process.env.DBUSERNAME,
  password: "",
  database: process.env.DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  multipleStatements: true
});

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
  execute: (...args) => promisePool.execute(...args),
  query: (...args) => promisePool.query(...args),
  promise: () => promisePool,
  connection: pool,
  pool
};

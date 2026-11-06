const dbConnection = require("../config/DBConnection");

/**
 * AuthorizationModel
 * ------------------
 * The ONLY place that talks to the authorization tables. Pure data access —
 * no policy decisions (those live in AuthorizationService). Keeping SQL here
 * means the resolution logic is unit-testable against a fake model, and the
 * queries are in one auditable place.
 *
 * Assumes dbConnection.connection is a mysql2 pool exposed via .promise()
 * (matches the rest of SmartLab, e.g. Pathology.js getConnection()).
 */
const db = () => dbConnection.connection.promise();

/**
 * Single-round-trip decision inputs for (userId, slug).
 * Anchored on Users so IsItAdmin is always returned even when the function
 * slug is unregistered (functionId then comes back NULL -> default deny).
 *
 * Returns one aggregated row:
 *   { isAdmin, functionId, userDeny, userAllow, roleAllow }
 */
const getDecisionInputs = async (userId, slug) => {
  const sql = `
    SELECT
      u.IsItAdmin                                              AS isAdmin,
      f.Id                                                     AS functionId,
      MAX(CASE WHEN fau.Effect = 'deny'  THEN 1 ELSE 0 END)    AS userDeny,
      MAX(CASE WHEN fau.Effect = 'allow' THEN 1 ELSE 0 END)    AS userAllow,
      MAX(CASE WHEN far.Id IS NOT NULL   THEN 1 ELSE 0 END)    AS roleAllow
    FROM Users u
    LEFT JOIN Functions f
      ON TRIM(REPLACE(REPLACE(f.FunctionSlug, '\r', ''), '\n', '')) = ?
    LEFT JOIN FunctionsAuthorisedToUser fau
      ON fau.FunctionId = f.Id AND fau.UserId = u.Id
    LEFT JOIN UserRoles ur
      ON ur.UserId = u.Id
    LEFT JOIN FunctionsAuthorisedToRole far
      ON far.FunctionId = f.Id AND (far.RoleId = ur.RoleId OR far.RoleId = u.RoleId)  -- FIX: Users.RoleId counts too
    WHERE u.Id = ?
    GROUP BY u.IsItAdmin, f.Id
    LIMIT 1`;
  const [rows] = await db().query(sql, [slug, userId]);
  return rows[0] || null;
};

/**
 * Full effective-permission map for a user, with the SOURCE of each decision.
 * Powers the authorization screen ("allowed via Lab Technician role" /
 * "denied — per-user override"). One row per registered Function.
 */
const getEffectivePermissions = async (userId) => {
  const sql = `
    SELECT
      f.Id                                                  AS FunctionId,
      f.FunctionName,
      f.FunctionSlug,
      f.FunctionGroup,
      MAX(CASE WHEN fau.Effect = 'deny'  THEN 1 ELSE 0 END) AS userDeny,
      MAX(CASE WHEN fau.Effect = 'allow' THEN 1 ELSE 0 END) AS userAllow,
      MAX(CASE WHEN far.Id IS NOT NULL   THEN 1 ELSE 0 END) AS roleAllow,
      GROUP_CONCAT(DISTINCT r.Name ORDER BY r.Name SEPARATOR ', ') AS GrantingRoles
    FROM Functions f
    LEFT JOIN FunctionsAuthorisedToUser fau
      ON fau.FunctionId = f.Id AND fau.UserId = ?
    LEFT JOIN UserRoles ur
      ON ur.UserId = ?
    LEFT JOIN Users uu
      ON uu.Id = ?
    LEFT JOIN FunctionsAuthorisedToRole far
      ON far.FunctionId = f.Id AND (far.RoleId = ur.RoleId OR far.RoleId = uu.RoleId)
    LEFT JOIN Roles r
      ON r.Id = far.RoleId
    GROUP BY f.Id, f.FunctionName, f.FunctionSlug, f.FunctionGroup
    ORDER BY f.FunctionGroup, f.FunctionName`;
  const [rows] = await db().query(sql, [userId, userId, userId]);
  return rows;
};

/* ===================== MANAGEMENT (for the admin UI) ===================== */

const getUserRoles = async (userId) => {
  const [rows] = await db().query(
    `SELECT r.Id, r.Name
     FROM UserRoles ur JOIN Roles r ON r.Id = ur.RoleId
     WHERE ur.UserId = ? ORDER BY r.Name`, [userId]);
  return rows;
};

const setUserRoles = async (userId, roleIds = []) => {
  const conn = await db().getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`DELETE FROM UserRoles WHERE UserId = ?`, [userId]);
    if (roleIds.length) {
      const values = roleIds.map(rid => [userId, rid]);
      await conn.query(`INSERT INTO UserRoles (UserId, RoleId) VALUES ?`, [values]);
    }
    await conn.commit();
    return true;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

const getRoleFunctions = async (roleId) => {
  const [rows] = await db().query(
    `SELECT FunctionId FROM FunctionsAuthorisedToRole WHERE RoleId = ?`, [roleId]);
  return rows.map(r => r.FunctionId);
};

const setRoleFunctions = async (roleId, functionIds = []) => {
  const conn = await db().getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`DELETE FROM FunctionsAuthorisedToRole WHERE RoleId = ?`, [roleId]);
    if (functionIds.length) {
      const values = functionIds.map(fid => [roleId, fid]);
      await conn.query(`INSERT INTO FunctionsAuthorisedToRole (RoleId, FunctionId) VALUES ?`, [values]);
    }
    await conn.commit();
    return true;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

/**
 * Set (or clear) a per-user override for one function.
 * Enforces a single override row per (user, function): an 'allow' and a 'deny'
 * for the same pair would be contradictory, so we replace.
 *   effect: 'allow' | 'deny' | null  (null removes the override)
 */
const setUserOverride = async (userId, functionId, effect) => {
  const conn = await db().getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `DELETE FROM FunctionsAuthorisedToUser WHERE UserId = ? AND FunctionId = ?`,
      [userId, functionId]);
    if (effect === 'allow' || effect === 'deny') {
      await conn.query(
        `INSERT INTO FunctionsAuthorisedToUser (UserId, FunctionId, Effect) VALUES (?, ?, ?)`,
        [userId, functionId, effect]);
    }
    await conn.commit();
    return true;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

const getAllFunctions = async () => {
  const [rows] = await db().query(
    `SELECT Id, FunctionName, FunctionSlug, FunctionGroup
     FROM Functions ORDER BY FunctionGroup, FunctionName`);
  return rows;
};

const getAllRoles = async () => {
  const [rows] = await db().query(`SELECT Id, Name FROM Roles ORDER BY Name`);
  return rows;
};

/** Lightweight user list for the authorization screen's user picker. */
const getAllUsers = async () => {
  const [rows] = await dbConnection.connection.promise().execute(
      `SELECT
          u.Id,
          CONCAT(u.FirstName, ' ', u.LastName) AS FullName,
          u.IsItAdmin,
          u.SignaturePath,
          u.Qualification,
          r.Name AS PrimaryRole
       FROM Users u
       LEFT JOIN Roles r ON r.Id = u.RoleId
       ORDER BY u.FirstName, u.LastName`
  );
  return rows;
};

/** One user's basic record (for the page header). */
const getUserById = async (userId) => {
  const [rows] = await db().query(
    `SELECT u.Id,
            TRIM(CONCAT(COALESCE(u.FirstName,''),' ',COALESCE(u.LastName,''))) AS FullName,
            u.IsItAdmin,
            r.Name AS PrimaryRole
     FROM Users u
     LEFT JOIN Roles r ON r.Id = u.RoleId
     WHERE u.Id = ? LIMIT 1`, [userId]);
  return rows[0] || null;
};
const saveUserSignature = async (userId, sigPath, qualification) => {
  await dbConnection.connection.promise().execute(
      `UPDATE Users
       SET SignaturePath       = ?,
           SignatureUploadedAt = NOW(),
           Qualification       = ?
       WHERE Id = ?`,
      [sigPath || null, qualification || null, userId]
  );
};
module.exports = {
  getDecisionInputs,
  getEffectivePermissions,
  getUserRoles,
  setUserRoles,
  getRoleFunctions,
  setRoleFunctions,
  setUserOverride,
  getAllFunctions,
  getAllRoles,
  getAllUsers,
  getUserById,
  saveUserSignature
};
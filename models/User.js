'use strict';
/**
 * models/User.js — SmartLab users, login helpers, permissions, leave
 *
 * SECURITY PATCH (2026-10-25) — every fix marked ★
 *  ★1  changePassword never checked the result of comparePassword → the password could be changed
 *      WITHOUT knowing the current one (any open, logged-in PC = account takeover).
 *  ★2  changePassword / updateUserPassword never answered when the new passwords did not match or the
 *      UPDATE failed → the request hung; a DB error inside the callback crashed the whole server.
 *  ★3  Password hashes travelled everywhere: req.user (and res.locals.user in every view) held the
 *      Password column; getMarketingPersonList / isAdmin returned or logged full Users rows.
 *  ★4  Deactivated users (IsActive = 0) stayed logged in and kept every permission.
 *  ★5  checkLoggedOut rendered "home" AND called next() → "headers already sent" errors.
 *  ★6  checkAuthorisation compared req.path, which holds real ids (/edit/57) → slugs for routes with
 *      parameters never matched and non-admins were refused; DB error text was shown on screen.
 *  ★7  createNewUser logged the full INSERT (with the password hash) to the console; no password rules;
 *      " A@x.com" and "a@x.com" were two different accounts; an invalid joining date became 'Invalid date'.
 *  ★8  getUserName crashed for an unknown id; isAdmin returned undefined instead of false.
 *  ★9  Permission assignment accepted any value / duplicates; SQL with ids was printed to the log.
 */

const dbConnection = require("./../config/DBConnection");
const bcrypt = require("bcrypt");
const moment = require('moment');

const db = () => (dbConnection.pool || dbConnection.connection).promise();

const userError = (msg) => { const e = new Error(msg); e.isUserError = true; return e; };
const toId = (v) => { const n = parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : null; };
const normEmail = (v) => String(v == null ? '' : v).trim().toLowerCase();

/** ★3 never let the hash leave the model (sessions, views, JSON) */
const safeUser = (u) => { if (!u) return u; const { Password, password, ...rest } = u; return rest; };

/** ★4 only an explicit 0 / '0' / false means inactive (old rows may have NULL) */
const isInactive = (u) => !!u && (u.IsActive === 0 || u.IsActive === '0' || u.IsActive === false);

// ★7 password rules
const PASSWORD_MIN = 8;
const passwordProblem = (pw, user = {}) => {
  const p = String(pw || '');
  if (p.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters.`;
  if (p.length > 72) return 'Password is too long (max 72 characters).';            // bcrypt ignores the rest
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return 'Password must contain letters and numbers.';
  const lower = p.toLowerCase();
  if (['password1', '12345678a', 'smartlab1', 'admin123', 'welcome1'].includes(lower)) return 'This password is too common. Choose another.';
  if (user.Email && lower.includes(normEmail(user.Email).split('@')[0]) && normEmail(user.Email).split('@')[0].length >= 4) return 'Password must not contain your email name.';
  return null;
};

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRATION / LOOKUP
// ─────────────────────────────────────────────────────────────────────────────

const createNewUser = async (userDetails) => {
  const email = normEmail(userDetails.Email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw userError('Enter a valid email address.');
  const pwProblem = passwordProblem(userDetails.Password, { Email: email });
  if (pwProblem) throw userError(pwProblem);
  const doj = moment(userDetails.DateOfJoining, ['DD-MM-YYYY', 'YYYY-MM-DD'], true);
  if (!doj.isValid()) throw userError('Enter a valid date of joining (dd-mm-yyyy).');

  if (await checkExistEmail(email)) {
    throw userError(`This email "${email}" already exists. Please choose another one.`);
  }

  const hashedPassword = await bcrypt.hash(String(userDetails.Password), 10);
  try {
    // ★7 the old code printed this whole statement (incl. the hash) with console.log
    await db().execute(
      `INSERT INTO Users (FirstName, LastName, Email, DateOfJoining, Password, PhoneNumber, Gender)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [String(userDetails.FirstName || '').trim(), String(userDetails.LastName || '').trim(), email,
       doj.format('YYYY-MM-DD'), hashedPassword, String(userDetails.PhoneNumber || '').trim(), userDetails.Gender]
    );
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw userError(`This email "${email}" already exists. Please choose another one.`);
    throw e;
  }
  return "You have successfully registered. Please login.";
};

const checkExistEmail = async (email) => {
  const [rows] = await db().execute("SELECT Id FROM Users WHERE LOWER(TRIM(Email)) = ? LIMIT 1", [normEmail(email)]);
  return rows.length > 0;
};

/** Used by the login strategy — this one MUST include the Password hash (for bcrypt.compare). */
const findUserByEmail = async (email) => {
  const [users] = await db().execute("SELECT * FROM `Users` WHERE LOWER(TRIM(`Email`)) = ? LIMIT 1", [normEmail(email)]);
  return users.length > 0 ? users[0] : false;
};

/**
 * Used by passport.deserializeUser on every request → becomes req.user and res.locals.user.
 * ★3 returned without the Password hash.
 */
const findUserById = async (id) => {
  const [rows] = await db().execute("SELECT * FROM `Users` WHERE `Id` = ? LIMIT 1", [id]);
  return safeUser(rows[0]);
};

const comparePassword = async (password, userObject) => {
  if (!userObject || !userObject.Password || password == null) return false;
  return bcrypt.compare(String(password), userObject.Password);
};

// Helper function for error notifications
const createNotification = (type, messages, icon) => ({ type, messages, icon });

/** passport 0.6+ logout(cb) is async; 0.5 logout() is sync and never calls a callback. */
const safeLogout = (req, done) => {
  try {
    if (typeof req.logout === 'function' && req.logout.length >= 1) return req.logout(() => done());
    if (typeof req.logout === 'function') req.logout();
  } catch (_) { /* already logged out */ }
  return done();
};

const wantsJson = (req) => req.xhr || (req.get('Accept') || '').includes('application/json');

const checkLoggedIn = (req, res, next) => {
  if (!req.isAuthenticated()) {
    if (wantsJson(req)) return res.status(401).json({ success: false, message: 'Your session has expired. Please log in again.' });
    const notifications = [createNotification("danger", "Please login to  access all the features.", "#check-circle-fill")];
    return res.status(401).render("login", { notifications, title: 'Login', BRAND_NAME: process.env.BRAND_NAME });
  }
  // ★4 a user switched off by the admin is logged out on his next click
  if (isInactive(req.user)) {
    return safeLogout(req, () => {
      if (wantsJson(req)) return res.status(401).json({ success: false, message: 'Your account has been deactivated.' });
      const notifications = [createNotification("danger", "Your account has been deactivated. Contact the administrator.", "bi-exclamation-triangle-fill")];
      return res.status(401).render("login", { notifications, title: 'Login', BRAND_NAME: process.env.BRAND_NAME });
    });
  }
  next();
};

/** ★5 logged-in users visiting the login page go home — once (it used to answer twice). */
const checkLoggedOut = (req, res, next) => {
  if (req.isAuthenticated() && !isInactive(req.user)) return res.redirect('/');
  next();
};

// ─────────────────────────────────────────────────────────────────────────────
// PASSWORD CHANGE  ★1 ★2
// ─────────────────────────────────────────────────────────────────────────────

/** Resolves with a success message; rejects with a user-readable Error. Never hangs. */
const changePassword = async (req /*, res */) => {
  if (!req.user || !req.user.Id) throw userError('Please log in again.');
  const { Password: current, newPassword, confirmNewPassword } = req.body || {};

  // the hash is NOT in req.user any more (★3) — read it fresh
  const [[row]] = await db().execute('SELECT Id, Email, Password FROM Users WHERE Id = ? LIMIT 1', [req.user.Id]);
  if (!row) throw userError('Account not found. Please log in again.');

  if (!(await comparePassword(current, row))) throw userError('Your current password is not correct.');
  if (String(newPassword || '') !== String(confirmNewPassword || '')) throw userError('New password and confirmation do not match.');
  if (await bcrypt.compare(String(newPassword || ''), row.Password)) throw userError('The new password must be different from the current one.');
  const problem = passwordProblem(newPassword, row);
  if (problem) throw userError(problem);

  await updateUserPassword({ newPassword }, req.user.Id);
  return 'User Password change has been done successfully';
};

const updateUserPassword = async (body, userId) => {
  const hash = await bcrypt.hash(String(body.newPassword), 10);
  const [r] = await db().execute("UPDATE `Users` SET `Password` = ? WHERE `Id` = ?", [hash, userId]);
  if (!r.affectedRows) throw userError('Password was not changed — account not found.');
  return true;
};

// ─────────────────────────────────────────────────────────────────────────────
// USERS & PERMISSIONS
// ─────────────────────────────────────────────────────────────────────────────

const getUserList = async () => {
  // admins are left out — they already have access to every function
  const [users] = await db().execute(
    `SELECT Id, FirstName, LastName, Email, PhoneNumber, IsActive,
            DATE_FORMAT(DateOfJoining,'%d-%m-%y') as DateOfJoining
     FROM Users WHERE COALESCE(IsItAdmin, 0) != 1`
  );
  return users;
};

const getAllUnAuthorisedFunctionList = async (userId) => {
  const [functions] = await db().execute(
    `SELECT f.FunctionName, f.Id as FunctionId, f.FunctionGroup
     FROM Functions f
     LEFT JOIN FunctionsAuthorisedToUser fa ON f.Id = fa.FunctionId AND fa.UserId = ?
     WHERE fa.FunctionId IS NULL
     ORDER BY f.FunctionName`, [userId]);
  return functions;
};

const getAlreadyAuthorisedFunctions = async (userId) => {
  const [rows] = await db().execute(
    `SELECT FunctionName, FunctionSlug, FunctionId, FunctionsAuthorisedToUser.Id
     FROM FunctionsAuthorisedToUser JOIN Functions ON Functions.Id = FunctionsAuthorisedToUser.FunctionId
     WHERE FunctionsAuthorisedToUser.UserId = ?`, [userId]);
  return rows;
};

/** ★9 only real function ids, no duplicates, nothing granted twice. Call only from an admin-only route. */
const authoriseUserToFunction = async (selectedFunctions, userId) => {
  const uid = toId(userId);
  if (!uid) throw userError('Select a user.');
  const ids = [...new Set((Array.isArray(selectedFunctions) ? selectedFunctions : [selectedFunctions]).map(toId).filter(Boolean))];
  if (!ids.length) throw userError('Select at least one function.');

  const [[user]] = await db().query('SELECT Id FROM Users WHERE Id = ? LIMIT 1', [uid]);
  if (!user) throw userError('User not found.');
  const [valid] = await db().query('SELECT Id FROM Functions WHERE Id IN (?)', [ids]);
  const [have]  = await db().query('SELECT FunctionId FROM FunctionsAuthorisedToUser WHERE UserId = ? AND FunctionId IN (?)', [uid, ids]);
  const already = new Set(have.map(r => Number(r.FunctionId)));
  const toAdd = valid.map(r => Number(r.Id)).filter(id => !already.has(id));
  if (!toAdd.length) return 'These functions were already assigned.';
  await db().query('INSERT INTO FunctionsAuthorisedToUser (UserId, FunctionId) VALUES ?', [toAdd.map(f => [uid, f])]);
  return `${toAdd.length} function${toAdd.length > 1 ? 's' : ''} assigned successfully`;
};

const removeAuthorisation = async (userId, functionId) => {
  const [r] = await db().execute("DELETE FROM FunctionsAuthorisedToUser WHERE UserId = ? AND FunctionId = ?", [toId(userId), toId(functionId)]);
  if (!r.affectedRows) throw userError('This permission was not assigned (maybe already removed).');
  return 'Authorisation successfully removed.';
};

/**
 * ★6 Route permission check.
 * Accepts the slug saved in any of these forms:
 *   "/cancelPatient"   "/patient/cancelPatient"   "/edit/:id"   "/test/edit/:id"
 * (req.path holds the real id, e.g. "/edit/57", which never matched a slug saved as "/edit/:id").
 */
/**
 * Decide access for a user against one or more candidate slugs.
 * FIX (2026-10-27): the old check only looked at FunctionsAuthorisedToUser, so
 *   - role grants (FunctionsAuthorisedToRole) were ignored — giving the
 *     Reception role a function did nothing;
 *   - a per-user DENY row (Effect = 'deny') was treated as ALLOW.
 * Now the same rules as AuthorizationService apply: deny override > allow
 * override > any role grant (UserRoles or Users.RoleId) > default deny.
 * Slugs are compared after stripping stray spaces/CR/LF (one row was saved
 * as "\r\n/schedule/team" and could never match).
 */
const decideFunctionAccess = async (userId, slugs) => {
  const list = [...new Set(slugs.filter(Boolean))];
  if (!list.length) return false;
  const [rows] = await db().query(`
      SELECT f.Id,
             MAX(CASE WHEN fau.Effect = 'deny'  THEN 1 ELSE 0 END) AS userDeny,
             MAX(CASE WHEN fau.Effect = 'allow' OR (fau.Id IS NOT NULL AND fau.Effect IS NULL) THEN 1 ELSE 0 END) AS userAllow,
             MAX(CASE WHEN far.Id IS NOT NULL THEN 1 ELSE 0 END) AS roleAllow
      FROM Functions f
      LEFT JOIN FunctionsAuthorisedToUser fau ON fau.FunctionId = f.Id AND fau.UserId = ?
      LEFT JOIN FunctionsAuthorisedToRole far ON far.FunctionId = f.Id AND far.RoleId IN (
             SELECT ur.RoleId FROM UserRoles ur WHERE ur.UserId = ?
             UNION SELECT u.RoleId FROM Users u WHERE u.Id = ? AND u.RoleId IS NOT NULL)
      WHERE TRIM(REPLACE(REPLACE(f.FunctionSlug, '\r', ''), '\n', '')) IN (?)
      GROUP BY f.Id`, [userId, userId, userId, list]);
  if (!rows.length) return false;
  if (rows.some(r => Number(r.userDeny) === 1)) return false;
  return rows.some(r => Number(r.userAllow) === 1 || Number(r.roleAllow) === 1);
};

/** true if the logged-in user is admin or holds any of the slugs (for use inside controllers). */
const hasFunction = async (req, slugs) => {
  if (!req.user || !req.user.Id) return false;
  const [[user]] = await db().query('SELECT IsItAdmin, IsActive FROM Users WHERE Id = ? LIMIT 1', [req.user.Id]);
  if (!user || isInactive(user)) return false;
  if (Number(user.IsItAdmin) === 1) return true;
  return decideFunctionAccess(req.user.Id, Array.isArray(slugs) ? slugs : [slugs]);
};

const checkAuthorisation = async (req, res, next) => {
  try {
    if (!req.user || !req.user.Id) return renderUnauthorizedPage(req, res);

    const [[user]] = await db().query('SELECT IsItAdmin, IsActive FROM Users WHERE Id = ? LIMIT 1', [req.user.Id]);
    if (!user || isInactive(user)) return renderUnauthorizedPage(req, res);
    if (Number(user.IsItAdmin) === 1) return next();

    const base = req.baseUrl || '';
    const candidates = new Set([req.path, base + req.path]);
    if (req.route && typeof req.route.path === 'string') { candidates.add(req.route.path); candidates.add(base + req.route.path); }

    if (await decideFunctionAccess(req.user.Id, [...candidates])) return next();
    return renderUnauthorizedPage(req, res);
  } catch (error) {
    console.error('Authorization error:', error.code || '', error.message);
    return renderUnauthorizedPage(req, res, 'Could not check your permission right now. Please try again.');
  }
};

/** Guard a route by explicit slug(s) — for routes whose own path isn't a registered function. */
const checkFunction = (slugs) => async (req, res, next) => {
  try {
    if (await hasFunction(req, slugs)) return next();
    return renderUnauthorizedPage(req, res);
  } catch (error) {
    console.error('Authorization error:', error.code || '', error.message);
    return renderUnauthorizedPage(req, res, 'Could not check your permission right now. Please try again.');
  }
};

/** ★6 403 status; never shows raw DB errors; JSON for AJAX calls. */
const renderUnauthorizedPage = (req, res, message = null) => {
  const text = 'Sorry, you are not authorized to access this page.';
  if (req && wantsJson(req)) return res.status(403).json({ allowed: false, success: false, message: message || 'You do not have permission for this action.' });
  const notifications = [];
  if (message) notifications.push(createNotification("danger", String(message), "bi-exclamation-triangle-fill"));
  notifications.push(createNotification("danger", text, "bi-exclamation-triangle-fill"));
  return res.status(403).render("home", { title: 'Home', notifications, BRAND_NAME: process.env.BRAND_NAME, layout: 'loggedInLayout' });
};

const checkAdmin = async (req, res, next) => {
  try {
    if (!req.user || !req.user.Id) return renderUnauthorizedPage(req, res, "Please log in.");
    const [rows] = await db().execute('SELECT IsItAdmin, IsActive FROM Users WHERE Id = ? LIMIT 1', [req.user.Id]);
    if (rows.length > 0 && Number(rows[0].IsItAdmin) === 1 && !isInactive(rows[0])) return next();
    return renderUnauthorizedPage(req, res, "Only an administrator can do this.");
  } catch (error) {
    console.error("Error in checkAdmin middleware:", error.code || '', error.message);
    return renderUnauthorizedPage(req, res, "Could not verify admin status. Please try again.");
  }
};

const getRoles = async () => {
  const [roles] = await db().execute('SELECT * FROM Roles');
  return roles;
};

const assignRole = async (userId, roleId) => {
  const uid = toId(userId), rid = toId(roleId);
  if (!uid || !rid) throw userError('Select a user and a role.');
  const [[role]] = await db().query('SELECT Id FROM Roles WHERE Id = ? LIMIT 1', [rid]);
  if (!role) throw userError('This role does not exist.');
  const [result] = await db().execute("UPDATE Users SET RoleId = ? WHERE Id = ?", [rid, uid]);
  return result.affectedRows > 0;
};

/** Marketing persons (RoleId 5). ★3 no more SELECT * (it sent every password hash to the clinic page). */
const getMarketingPersonList = async () => {
  const [result] = await db().execute(
    `SELECT Id, FirstName, LastName, Email, PhoneNumber, RoleId, IsActive
     FROM Users WHERE RoleId = 5`);
  return result;
};

// ─────────────────────────────────────────────────────────────────────────────
// LEAVE
// ─────────────────────────────────────────────────────────────────────────────

const getLeaveTypes = async () => {
  const [leaveTypes] = await db().query("SELECT Id, Name FROM LeaveTypes");
  return leaveTypes;
};

const applyLeave = async (startDate, endDate, reason, userId, leaveTypeId) => {
  await db().query(
    `INSERT INTO LeaveApplications (UserId, StartDate, EndDate, Reason, LeaveTypeId) VALUES (?, ?, ?, ?, ?)`,
    [userId, startDate, endDate, String(reason || '').slice(0, 1000), leaveTypeId]
  );
};

/** (errors were swallowed → the page showed "no leaves" when the DB failed) */
const getLeave = async (userId) => {
  const [leaves] = await db().query(
    `SELECT la.*, lt.Name
     FROM LeaveApplications la JOIN LeaveTypes lt ON la.LeaveTypeId = lt.Id
     WHERE la.UserId = ? ORDER BY la.CreatedAt DESC`, [userId]);
  return leaves;
};

const getUserLeaveRequests = async () => {
  const [leaveRequests] = await db().query(`
      SELECT L.*, CONCAT(U.FirstName, ' ', U.LastName) AS UserName
      FROM LeaveApplications L JOIN Users U ON L.UserId = U.Id
      WHERE L.Status = 'Pending' OR L.Status = 'SentBack'
      ORDER BY L.CreatedAt DESC`);
  return leaveRequests;
};

const actionOnLeave = async (status, remarks, leaveId) => {
  const id = toId(leaveId);
  if (!id) throw userError('Leave application not found.');
  if (!String(status || '').trim() || String(status).length > 30) throw userError('Invalid leave action.');
  const [rows] = await db().query(
    `UPDATE LeaveApplications SET Status = ?, AdminRemarks = ? WHERE Id = ?`,
    [String(status).trim(), String(remarks || '').slice(0, 1000), id]);
  return rows;
};

/** Role 1 (or the IsItAdmin flag) = admin. ★8 always a boolean; ★3 no row logging. */
const isAdmin = async (userId) => {
  const [users] = await db().execute(
    'SELECT 1 FROM Users WHERE Id = ? AND (RoleId = 1 OR IsItAdmin = 1) LIMIT 1', [userId]);
  return users.length > 0;
};

/** ★8 '' instead of a crash for an unknown user. Returns the full name as a string. */
const getUserName = async (userId) => {
  const [result] = await db().query(
    `SELECT CONCAT(COALESCE(FirstName,''), ' ', COALESCE(LastName,'')) AS fullName FROM Users WHERE Id = ? LIMIT 1`, [userId]);
  return result[0] ? result[0].fullName.trim() : '';
};

const hasFunctionOrAdmin = async (userId, slug) => {
  const [adminRows] = await db().execute('SELECT IsItAdmin, IsActive FROM Users WHERE Id = ? LIMIT 1', [userId]);
  if (!adminRows.length || isInactive(adminRows[0])) return false;
  if (Number(adminRows[0].IsItAdmin) === 1) return true;
  const [rows] = await db().execute(
    `SELECT 1 FROM FunctionsAuthorisedToUser FA JOIN Functions F ON F.Id = FA.FunctionId
     WHERE FA.UserId = ? AND F.FunctionSlug = ? LIMIT 1`, [userId, slug]);
  return rows.length > 0;
};

const canEditFinalReport = async (userId) => {
  try { return await hasFunctionOrAdmin(userId, 'EDIT_FINAL_REPORT'); }
  catch (error) { console.error("Permission check failed:", error.message); return false; }
};

/** (functionSlug was ignored before and is still ignored — the check is always EDIT_REPORT) */
const canEditReport = async (userId /*, functionSlug */) => {
  try { return await hasFunctionOrAdmin(userId, 'EDIT_REPORT'); }
  catch (error) { console.error("canEditReport error:", error.message); return false; }
};

// Admin OR Reception role (cancel patient auth, dues collection, staff filter …)
const getUserWithReceptionPrivilege = async () => {
  const [rows] = await db().execute(`
      SELECT DISTINCT u.Id, u.FirstName, u.LastName, r.Name AS RoleName
      FROM Users u
      JOIN UserRoles ur ON ur.UserId = u.Id
      JOIN Roles r      ON r.Id      = ur.RoleId
      WHERE LOWER(r.Name) IN ('admin', 'reception')
      ORDER BY CASE WHEN LOWER(r.Name) = 'admin' THEN 0 ELSE 1 END, u.FirstName, u.LastName`);
  return rows;
};

const getUserRolesAndRooms = async (userId) => {
  const [rows] = await db().execute(
    `SELECT r.Id AS RoleId, r.Name AS RoleName, r.RoomCode
     FROM UserRoles ur JOIN Roles r ON r.Id = ur.RoleId
     WHERE ur.UserId = ?`, [userId]);
  return { roles: rows.map(r => r.RoleName), roomCodes: rows.filter(r => r.RoomCode).map(r => r.RoomCode) };
};

/** Deactivated users are logged out on their next request (checkLoggedIn ★4). */
const toggleUserActiveStatus = async (userId, isActive) => {
  const [result] = await db().execute('UPDATE Users SET IsActive = ? WHERE Id = ?', [isActive ? 1 : 0, userId]);
  return result.affectedRows > 0;
};

module.exports = {
  findUserByEmail, findUserById, createNewUser, checkLoggedIn, checkLoggedOut, comparePassword,
  changePassword, getUserList, getAllUnAuthorisedFunctionList, getAlreadyAuthorisedFunctions,
  authoriseUserToFunction, removeAuthorisation, checkAuthorisation, checkFunction, hasFunction, userHasAnyFunction: decideFunctionAccess, checkAdmin, getRoles, assignRole,
  getMarketingPersonList, applyLeave, getLeave, getLeaveTypes, getUserLeaveRequests, actionOnLeave,
  isAdmin, getUserName, canEditReport, canEditFinalReport, getUserWithReceptionPrivilege,
  getUserRolesAndRooms, toggleUserActiveStatus,
  // new helpers
  safeUser, passwordProblem, isInactive,
};
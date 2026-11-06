// models/Leave.js
// PATCH (2026-10-25) — marked ★
//  ★1 Double-click on "Apply" (or two tabs) saved the same leave twice: the overlap check and the insert
//     were separate steps. Now one save per user at a time (GET_LOCK) with the check inside.
//  ★2 No checks in the model: end before start, 2-year leaves, empty reason, unknown leave type, junk dates.
//  ★3 A reviewer could APPROVE HIS OWN leave. Refused.
//  ★4 actionOnLeave accepted any status text ("Cancelled", "Approved " …). Whitelisted.
//  ★5 Users without a last name showed as an empty name (CONCAT with NULL = NULL).
const dbConnection = require('../config/DBConnection');
const moment = require('moment');

const userError = (msg) => Object.assign(new Error(msg), { isUserError: true });
const LEAVE_MAX_DAYS     = parseInt(process.env.LEAVE_MAX_DAYS, 10) || 60;       // one application
const LEAVE_MAX_PAST     = parseInt(process.env.LEAVE_MAX_PAST_DAYS, 10) || 60;  // back-dated (sick leave) limit
const LEAVE_MAX_AHEAD    = 366;
const REVIEW_STATUSES    = ['Approved', 'Rejected', 'SentBack'];

/** ★2 'YYYY-MM-DD' / 'DD-MM-YYYY' → 'YYYY-MM-DD' or a clear error. */
const checkLeave = ({ startDate, endDate, reason, leaveTypeId }) => {
  const p = (v) => { const m = moment(String(v || '').trim(), ['YYYY-MM-DD', 'DD-MM-YYYY'], true); return m.isValid() ? m : null; };
  const s = p(startDate), e = p(endDate);
  if (!s || !e) throw userError('Choose valid From and To dates.');
  if (e.isBefore(s)) throw userError('To date cannot be before From date.');
  const days = e.diff(s, 'days') + 1;
  if (days > LEAVE_MAX_DAYS) throw userError(`One application can be at most ${LEAVE_MAX_DAYS} days.`);
  const today = moment().startOf('day');
  if (s.isBefore(today.clone().subtract(LEAVE_MAX_PAST, 'days'))) throw userError(`Leave cannot start more than ${LEAVE_MAX_PAST} days ago.`);
  if (e.isAfter(today.clone().add(LEAVE_MAX_AHEAD, 'days'))) throw userError('Leave cannot be more than a year ahead.');
  const r = String(reason == null ? '' : reason).replace(/\s+/g, ' ').trim();
  if (r.length < 3) throw userError('Write the reason for the leave.');
  if (r.length > 500) throw userError('Reason is too long (max 500 characters).');
  const t = parseInt(leaveTypeId, 10);
  if (!(t > 0)) throw userError('Choose the leave type.');
  return { startDate: s.format('YYYY-MM-DD'), endDate: e.format('YYYY-MM-DD'), reason: r, leaveTypeId: t, days };
};

/** ★1 one leave save per user at a time (lock lives on this connection). */
const withUserLock = async (userId, fn) => {
  const conn = await leaveDb().getConnection();
  const name = `smartlab_leave_${Number(userId) || 0}`;
  let locked = false;
  try {
    const [[l]] = await conn.query('SELECT GET_LOCK(?, 10) AS ok', [name]);
    if (Number(l.ok) !== 1) throw userError('Your previous leave request is still being saved. Please wait a moment.');
    locked = true;
    return await fn(conn);
  } finally {
    if (locked) await conn.query('SELECT RELEASE_LOCK(?)', [name]).catch(() => {});
    conn.release();
  }
};

// Pool if available (survives MySQL restarts), otherwise the single connection
const leaveDb = () => (dbConnection.pool || dbConnection.connection).promise();

// Dates come back as 'YYYY-MM-DD' strings → plain string compares, no timezone day-shift
const LEAVE_COLUMNS = `
    L.Id, L.UserId, L.Reason, L.Status, L.AdminRemarks, L.CreatedAt, L.LeaveTypeId,
    DATE_FORMAT(L.StartDate, '%Y-%m-%d') AS StartDate,
    DATE_FORMAT(L.EndDate,   '%Y-%m-%d') AS EndDate,
    TRIM(CONCAT_WS(' ', U.FirstName, U.LastName)) AS UserName,
    LT.Name AS LeaveType`;

const LEAVE_FROM = `
       FROM LeaveApplications L
       JOIN Users U ON U.Id = L.UserId
       LEFT JOIN LeaveTypes LT ON LT.Id = L.LeaveTypeId`;

// ── Leave types ──────────────────────────────────────────────
const getLeaveTypes = async () => {
  const [rows] = await leaveDb().query('SELECT Id, Name FROM LeaveTypes ORDER BY Name');
  return rows;
};

// ── Staff side ───────────────────────────────────────────────
const applyLeave = async (startDate, endDate, reason, userId, leaveTypeId) => {
  if (!(Number(userId) > 0)) throw userError('Please log in again.');
  const v = checkLeave({ startDate, endDate, reason, leaveTypeId });
  return withUserLock(userId, async (conn) => {
    const [[type]] = await conn.query('SELECT Id FROM LeaveTypes WHERE Id = ?', [v.leaveTypeId]);
    if (!type) throw userError('Choose the leave type.');
    if (await findOwnOverlap(userId, v.startDate, v.endDate, 0, conn)) {
      throw userError('You already have a leave (pending, approved or sent back) on some of these days.');
    }
    const [result] = await conn.query(
      `INSERT INTO LeaveApplications (UserId, StartDate, EndDate, Reason, LeaveTypeId)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, v.startDate, v.endDate, v.reason, v.leaveTypeId]
    );
    return result.insertId;
  });
};

// My leaves, with reviewer name and number of days
const getLeave = async (userId) => {
  const [rows] = await leaveDb().query(
    `SELECT ${LEAVE_COLUMNS},
            LT.Name AS Name,
            L.ReviewedAt, L.UserSeen,
            TRIM(CONCAT_WS(' ', R.FirstName, R.LastName)) AS ReviewerName,
            DATEDIFF(L.EndDate, L.StartDate) + 1 AS DaysCount
     ${LEAVE_FROM}
       LEFT JOIN Users R ON R.Id = L.ReviewedBy
      WHERE L.UserId = ?
      ORDER BY L.CreatedAt DESC`,
    [userId]
  );
  return rows;
};

// One leave, only if it belongs to this user
const getOwnLeave = async (leaveId, userId) => {
  const [rows] = await leaveDb().query(
    `SELECT ${LEAVE_COLUMNS} ${LEAVE_FROM}
      WHERE L.Id = ? AND L.UserId = ?
      LIMIT 1`,
    [leaveId, userId]
  );
  return rows[0] || null;
};

// Does this user already have a live leave on any of these days?
// excludeId lets a resubmitted leave not clash with itself
const findOwnOverlap = async (userId, startDate, endDate, excludeId = 0, conn = null) => {
  const [rows] = await (conn || leaveDb()).query(
    `SELECT Id FROM LeaveApplications
      WHERE UserId = ? AND Id <> ?
        AND Status IN ('Pending', 'Approved', 'SentBack')
        AND StartDate <= ? AND EndDate >= ?
      LIMIT 1`,
    [userId, excludeId, endDate, startDate]
  );
  return rows.length > 0;
};

// Sent back → edited → Pending again (AdminRemarks kept so reviewer sees the earlier remark)
const resubmitLeave = async (leaveId, userId, { startDate, endDate, reason, leaveTypeId }) => {
  const v = checkLeave({ startDate, endDate, reason, leaveTypeId });
  return withUserLock(userId, async (conn) => {
    const [[type]] = await conn.query('SELECT Id FROM LeaveTypes WHERE Id = ?', [v.leaveTypeId]);
    if (!type) throw userError('Choose the leave type.');
    if (await findOwnOverlap(userId, v.startDate, v.endDate, Number(leaveId) || 0, conn)) {
      throw userError('You already have another leave on some of these days.');
    }
    const [result] = await conn.query(
      `UPDATE LeaveApplications
          SET StartDate = ?, EndDate = ?, Reason = ?, LeaveTypeId = ?,
              Status = 'Pending', UserSeen = 1
        WHERE Id = ? AND UserId = ? AND Status = 'SentBack'`,
      [v.startDate, v.endDate, v.reason, v.leaveTypeId, leaveId, userId]
    );
    return result.affectedRows > 0;
  });
};

const cancelLeave = async (leaveId, userId) => {
  const [result] = await leaveDb().query(
    `UPDATE LeaveApplications
        SET Status = 'Cancelled', UserSeen = 1
      WHERE Id = ? AND UserId = ? AND Status IN ('Pending', 'SentBack')`,
    [leaveId, userId]
  );
  return result.affectedRows > 0;
};

const markLeavesSeen = async (userId) => {
  await leaveDb().query(
    'UPDATE LeaveApplications SET UserSeen = 1 WHERE UserId = ? AND UserSeen = 0',
    [userId]
  );
};

const countUnseenLeaveUpdates = async (userId) => {
  const [[row]] = await leaveDb().query(
    'SELECT COUNT(*) AS n FROM LeaveApplications WHERE UserId = ? AND UserSeen = 0',
    [userId]
  );
  return row.n;
};

// ── Admin / reviewer side ────────────────────────────────────
const getUserLeaveRequests = async () => {
  const [rows] = await leaveDb().query(
    `SELECT ${LEAVE_COLUMNS} ${LEAVE_FROM}
      WHERE L.Status IN ('Pending', 'SentBack')
      ORDER BY L.StartDate ASC, L.CreatedAt ASC`
  );
  return rows;
};

// Every live leave touching [from, to]  (overlap: start1 <= end2 AND end1 >= start2)
const getLeavesInRange = async (from, to) => {
  const [rows] = await leaveDb().query(
    `SELECT ${LEAVE_COLUMNS} ${LEAVE_FROM}
      WHERE L.Status IN ('Pending', 'Approved', 'SentBack')
        AND L.StartDate <= ? AND L.EndDate >= ?
      ORDER BY UserName, L.StartDate`,
    [to, from]
  );
  return rows;
};

// Only acts on open leaves, records reviewer, flags as unseen for the staff member
const actionOnLeave = async (status, remarks, leaveId, reviewerId) => {
  const st = String(status || '').trim();
  if (!REVIEW_STATUSES.includes(st)) throw userError('Choose Approve, Reject or Send back.');            // ★4
  if (!(Number(reviewerId) > 0)) throw userError('Please log in again.');
  const rem = String(remarks == null ? '' : remarks).trim().slice(0, 500) || null;
  const [[own]] = await leaveDb().query('SELECT UserId, Status FROM LeaveApplications WHERE Id = ?', [leaveId]);
  if (!own) throw userError('This leave no longer exists.');
  if (Number(own.UserId) === Number(reviewerId)) throw userError('You cannot approve or reject your own leave.');   // ★3
  if (st === 'Approved' && own.Status === 'SentBack') {
    throw userError('This leave was sent back to the staff member for changes. Wait until it is resubmitted, or Reject it.');
  }
  // Approve only a Pending leave (a sent-back one is being edited by the staff member); Reject / Send back either
  const from = st === 'Approved' ? "('Pending')" : "('Pending', 'SentBack')";
  const [result] = await leaveDb().query(
    `UPDATE LeaveApplications
        SET Status = ?, AdminRemarks = ?,
            ReviewedBy = ?, ReviewedAt = NOW(), UserSeen = 0
      WHERE Id = ? AND UserId <> ? AND Status IN ${from}`,
    [st, rem, reviewerId, leaveId, reviewerId]
  );
  return result;
};

const countPendingLeaves = async () => {
    const [[row]] = await leaveDb().query(
      "SELECT COUNT(*) AS n FROM LeaveApplications WHERE Status = 'Pending'"
    );
    return row.n;
  };

module.exports = {
  getLeaveTypes,
  applyLeave,
  getLeave,
  getOwnLeave,
  findOwnOverlap,
  resubmitLeave,
  cancelLeave,
  markLeavesSeen,
  countUnseenLeaveUpdates,
  getUserLeaveRequests,
  getLeavesInRange,
  actionOnLeave,
  countPendingLeaves,
  checkLeave,
};
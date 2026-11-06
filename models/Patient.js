'use strict';

/**
 * Patient.js — Production-grade Patient Model for SmartLab
 *
 * IMPROVEMENTS OVER ORIGINAL:
 *  1. Single connection style throughout: pool.promise() — no more 3-way mixing
 *  2. All dead code (8 Old/Old2/Oldy functions, 3 old cancel variants) removed
 *  3. SQL injection fixed in viewThanksPaidPatientList
 *  4. markArrived fixed: was using undefined `db`, now uses dbConnection
 *  5. getDuesReceived fixed: was using undefined dbConnection.execute
 *  6. getOnlinePaymentSources fixed: was using callback dbConnection.query
 *  7. logPatientChanges fixed: Discount block referenced out-of-scope variables
 *  8. updatePatientSubTest fixed: was doing subTest.SubTestId on a primitive (raw ID)
 *  9. insertPatientHistory fixed: array INSERT now uses bulk VALUES ? correctly
 * 10. patientPaymentDetails fixed: callback never resolved on empty — now async/await
 * 11. getDailyDuesReceivedData fixed: throw inside callback does not reject Promise
 * 12. All production console.log(PII/full rows) removed — structured log helper used
 * 13. N+1 in updatPatientTestTable and updatePatientSubTest replaced with batch queries
 * 14. require() inside loop moved to top of file
 * 15. calculateThanks duplicate (old async DB version) removed
 * 16. module.exports = { calculateThanks } mid-file removed — was wiping all exports
 * 17. INNER JOIN → LEFT JOIN for doctor/user in getPatientListWithDoctorDetail
 * 18. getTestsWithDeliverables: removed JSON.stringify(rows) log on every call
 * 19. markDeliverableGenerated: removed mysql.format log on every call
 * 20. collectDues: removed full row/patient logs
 *
 * SECURITY PATCH (2026-10-24) — see SECURITY_REVIEW for the full list:
 *  S1  Double registration: one-time form token (IdempotencyKeys) + MySQL GET_LOCK per mobile
 *      + normalised name in the same-day duplicate check.
 *  S2  Sub-tests can no longer be dropped from the bill by editing the hidden JSON.
 *  S3  Strict money parsing (no negatives, "1e9", "Infinity", "12abc"); change-to-return cap.
 *  S4  collectDues: negative cash + online trick, missing online source, double-click guard,
 *      no more "arrived" side-effect when balance is paid before the appointment day.
 *  S5  Edit: lost-update protection (bill version token) — a stale form can no longer wipe
 *      dues collected in the meantime; old bills keep their original prices (price snapshot).
 *  S6  Cancel: authorisation re-checked inside the locked transaction; waiting queue entries
 *      removed; DB errors no longer shown to the user.
 *  S7  Legacy updateDuesAmount now goes through collectDues (money trail, ShiftDate, settlement).
 *  S8  Access control helper for reporting-doctor logins (role 2) — detail/invoice/edit/search.
 *  S9  Deliverables: ownership + component checks; delivery blocked while dues are pending.
 */

// ─────────────────────────────────────────────────────────────────────────────
// IMPORTS
// ─────────────────────────────────────────────────────────────────────────────

const dbConnection            = require('../config/DBConnection');
const currDateAndTime         = require('../helper/helper');
const mysql                   = require('mysql2');
const Clinic                  = require('../models/Clinic');
const Doctor                  = require('../models/Doctor');
const PatientQueue             = require('../models/PatientQueue');
const moment                  = require('moment');
const crypto                  = require('crypto');

// Moved out of the test loop — requiring inside a loop re-evaluates on every iteration
const DepartmentResolverService = require('../services/DepartmentResolverService');
const SpecimenService           = require('../services/SpecimenService');
const PatientAudit              = require('../services/PatientAuditService');

// ─────────────────────────────────────────────────────────────────────────────
// CONNECTION HELPERS
// Single style throughout: pool.promise()
// Using pool (not the raw connection) gives proper connection management,
// automatic re-use, and prevents "too many connections" on shared hosting.
// ─────────────────────────────────────────────────────────────────────────────

/** Shorthand for pool promise — used everywhere except inside open transactions */
const db = () => dbConnection.pool.promise();

/**
 * Get a dedicated connection for multi-statement transactions.
 * Always paired with conn.release() in a finally block.
 */
const getConnection = () => dbConnection.pool.promise().getConnection();

/**
 * Execute a query on a dedicated connection (inside a transaction).
 * Returns the result object directly — insertId, affectedRows, etc.
 */
const queryConn = (conn, sql, params) =>
    conn.query(sql, params).then(([result]) => result);

// ─────────────────────────────────────────────────────────────────────────────
// TYPE HELPERS  (safe coercion — no crashes on undefined/null input)
// ─────────────────────────────────────────────────────────────────────────────

// FIX S3: parseFloat('Infinity') is Infinity and slipped through "|| 0"
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const str = (v) => (v !== undefined && v !== null ? String(v).trim() : '');
const isPositiveInt = (v) => Number.isInteger(Number(v)) && Number(v) > 0;
/** Patient name exactly as stored and compared everywhere (single spaces). */
const cleanName = (v) => str(v).replace(/\s+/g, ' ');

// ─────────────────────────────────────────────────────────────────────────────
// LOGGING HELPER
// Structured, non-PII logs.  In production set LOG_LEVEL=error to suppress info.
// ─────────────────────────────────────────────────────────────────────────────

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

const log = {
    info:  (...a) => LOG_LEVEL === 'info'  && console.log ('[Patient]', ...a),
    warn:  (...a) =>                          console.warn ('[Patient]', ...a),
    error: (...a) =>                          console.error('[Patient]', ...a),
};

// ─────────────────────────────────────────────────────────────────────────────
// DATE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** "dd-mm-yyyy" → "yyyy-mm-dd" */
const parseInputDate = (s) => {
    if (!s) return moment().format('YYYY-MM-DD');   // local date, not UTC
    const parts = str(s).split('-');
    if (parts.length !== 3) return moment().format('YYYY-MM-DD');
    const [d, m, y] = parts;
    return `${y}-${m}-${d}`;
};

/** "dd-mm-yyyy" → "yyyy-mm-dd"; anything invalid → today (never the string 'Invalid date'). */
const dmyOrToday = (s) => {
    const m = moment(str(s), ['DD-MM-YYYY', 'D-M-YYYY', 'YYYY-MM-DD'], true);
    return (m.isValid() ? m : moment()).format('YYYY-MM-DD');
};

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — PATIENT LIST & SEARCH
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns today's patient list with doctor details.
 * FIX: Changed INNER JOIN → LEFT JOIN so patients with null DoctorId
 *      (edge case / data issue) are not silently excluded from the list.
 */
const getPatientListWithDoctorDetail = async (req) => {
    const date             = currDateAndTime.getCurrentDateAndTime()[0];
    const currentUserId    = req.user.Id;
    const currentUserRoleId = req.user.RoleId;

    const sql = `
        SELECT
            p.Id AS PatientId, p.Status, p.IsAdvanceBooking,
            DATE_FORMAT(p.AdvanceBookingDate, '%d-%m-%y') AS AdvanceBookingDate,
            p.AdvancePaid, p.BookingStatus, p.ChangeToReturn,
            p.ChangeReturnedAt, p.ChangeReturnedBy, p.Title, p.Name,
            p.Age, p.YMD, p.Gender, p.PhoneNumber, p.ActualAmount,
            p.GrossAmount,
            DATE_FORMAT(p.RegisteredOn, '%d-%m-%y') AS RegisteredOn,
            p.RegisteredTime, p.DuesAmount, p.DoctorId,

            d.FirstName AS DoctorFirstName, d.LastName AS DoctorLastName,
            CONCAT(
                COALESCE(d.FirstName, ''), ' ', COALESCE(d.LastName, '')
            ) AS DoctorName,
            d.Degree1, d.Degree2, d.Degree3, d.Degree4,
            d.SpecialistIn AS DoctorSpecialistIn,

            u.FirstName AS UserFirstName, u.LastName AS UserLastName,

            COALESCE(pt.TestNames,      '')     AS TestNames,
            COALESCE(pt.TotalTests,     0)      AS TotalTests,
            COALESCE(pt.ReportsReady,   0)      AS ReportsReady,
            COALESCE(pt.TestsCompleted, 0)      AS TestsCompleted,
            COALESCE(pt.ReportState,    'none') AS ReportState

        FROM PatientDetails p
        LEFT JOIN DoctorDetails d ON p.DoctorId = d.Id
        LEFT JOIN Users         u ON u.Id        = p.RegisteredBy
        LEFT JOIN (
            SELECT
                r.PatientId,
                GROUP_CONCAT(DISTINCT m.TestName ORDER BY m.TestName SEPARATOR ', ') AS TestNames,
                COUNT(DISTINCT r.Id)                                                  AS TotalTests,
                COALESCE(SUM(r.ReportReady = 1), 0)                                  AS ReportsReady,
                COALESCE(SUM(r.TestStatus = 'Completed'), 0)                         AS TestsCompleted,
                CASE
                    WHEN COUNT(DISTINCT r.Id) = 0                              THEN 'none'
                    WHEN SUM(r.ReportReady = 1) = COUNT(DISTINCT r.Id)         THEN 'all'
                    WHEN SUM(r.ReportReady = 1) > 0                            THEN 'partial'
                    ELSE 'none'
                END AS ReportState
            FROM PatientTestRefference r
            LEFT JOIN MainTestTable m ON r.TestId = m.Id
            GROUP BY r.PatientId
        ) pt ON pt.PatientId = p.Id

        WHERE (
            (p.IsAdvanceBooking = 0 AND DATE(p.RegisteredOn) = ?)
            OR (p.IsAdvanceBooking = 1 AND p.BookingStatus = 'advance_booked' AND DATE(p.AdvanceBookingDate) = ?)
            OR (p.IsAdvanceBooking = 0 AND p.BookingStatus = 'arrived'        AND DATE(p.UpdatedOn)          = ?)
        )
        AND (
            (? = 2 AND (
                EXISTS (SELECT 1 FROM ReferDoctorReportingDoctor rr WHERE rr.ReferDoctorId = d.Id AND rr.ReportingDoctorId = ?)
                OR NOT EXISTS (SELECT 1 FROM ReferDoctorReportingDoctor rr WHERE rr.ReferDoctorId = d.Id)
            ))
            OR ? <> 2
        )
        ORDER BY
            CASE WHEN p.BookingStatus = 'advance_booked' THEN 0 ELSE 1 END,
            p.Id DESC
    `;

    const [rows] = await db().execute(sql, [
        date, date, date,
        currentUserRoleId, currentUserId, currentUserRoleId,
    ]);
    return rows;
};

/**
 * Paginated patient search.
 * Unchanged logic — only added error propagation fix and removed dead branches.
 */
const searchPatient = async (req) => {
    const conn = await db().getConnection();
    try {
        const limit  = parseInt(req.pagination?.limit,  10) || 20;
        const offset = parseInt(req.pagination?.offset, 10) || 0;

        let fromDate = req.body?.FromDate || moment().format('DD-MM-YYYY');
        let toDate   = req.body?.ToDate   || moment().format('DD-MM-YYYY');
        fromDate = currDateAndTime.parseDate(fromDate);
        toDate   = currDateAndTime.parseDate(toDate);

        if (!currDateAndTime.compareDateForSearch(fromDate, toDate)) {
            throw new Error('Invalid date range. "From Date" must be ≤ "To Date".');
        }

        const showAdvance = req.body.showAdvanceBookings == 1;
        const whereArr    = [];
        const queryParams = [];

        if (req.body.BillNo) {
            whereArr.push('PatientDetails.Id = ?');
            queryParams.push(req.body.BillNo);
        }
        if (req.body.Name) {
            whereArr.push('PatientDetails.Name LIKE ?');
            queryParams.push(`%${req.body.Name}%`);
        }
        if (req.body.Doctor) {
            whereArr.push('PatientDetails.DoctorId = ?');
            queryParams.push(req.body.Doctor);
        }
        if (req.patientWithOnlyDuesAmount) {
            whereArr.push('PatientDetails.DuesAmount > 0');
        }
        if (req.body.Status) {
            whereArr.push('PatientDetails.Status = ?');
            queryParams.push(req.body.Status);
        }
        if (req.body.MainCategory) {
            whereArr.push('ptr.TestId IN (SELECT Id FROM MainTestTable WHERE CategoryId = ?)');
            queryParams.push(req.body.MainCategory);
        }
        // S8: the today-list hides other doctors' patients from reporting-doctor logins, but search showed all
        if (req.user && Number(req.user.RoleId) === 2) {
            whereArr.push(`(EXISTS (SELECT 1 FROM ReferDoctorReportingDoctor rr WHERE rr.ReferDoctorId = PatientDetails.DoctorId AND rr.ReportingDoctorId = ?)
                           OR NOT EXISTS (SELECT 1 FROM ReferDoctorReportingDoctor rr WHERE rr.ReferDoctorId = PatientDetails.DoctorId))`);
            queryParams.push(req.user.Id);
        }

        whereArr.push(`(
            (PatientDetails.IsAdvanceBooking = 0 AND PatientDetails.BookingStatus != 'arrived' AND PatientDetails.RegisteredOn BETWEEN ? AND ?)
            OR (PatientDetails.IsAdvanceBooking = 1 AND PatientDetails.BookingStatus = 'advance_booked' AND PatientDetails.AdvanceBookingDate BETWEEN ? AND ?)
            OR (PatientDetails.IsAdvanceBooking = 1 AND PatientDetails.BookingStatus = 'arrived'        AND DATE(PatientDetails.UpdatedOn) BETWEEN ? AND ?)
            OR (PatientDetails.IsAdvanceBooking = 0 AND PatientDetails.BookingStatus = 'arrived'        AND DATE(PatientDetails.UpdatedOn) BETWEEN ? AND ?)
            ${showAdvance ? 'OR (PatientDetails.IsAdvanceBooking = 1 AND PatientDetails.BookingStatus = \'advance_booked\' AND PatientDetails.RegisteredOn BETWEEN ? AND ?)' : ''}
        )`);
        queryParams.push(fromDate, toDate, fromDate, toDate, fromDate, toDate, fromDate, toDate);
        if (showAdvance) queryParams.push(fromDate, toDate);

        const whereStr = `WHERE ${whereArr.join(' AND ')}`;

        const countSQL = `
            SELECT COUNT(DISTINCT PatientDetails.Id) AS total
            FROM PatientDetails
            INNER JOIN DoctorDetails ON PatientDetails.DoctorId = DoctorDetails.Id
            LEFT  JOIN PatientTestRefference ptr ON ptr.PatientId = PatientDetails.Id
            ${whereStr}
        `;
        const [countRows] = await conn.execute(countSQL, queryParams);
        const total = countRows[0]?.total || 0;

        const dataSQL = `
            SELECT
                PatientDetails.Id                                   AS PatientId,
                PatientDetails.Title, PatientDetails.Name,
                PatientDetails.Age, PatientDetails.YMD, PatientDetails.Gender,
                PatientDetails.PhoneNumber, PatientDetails.ActualAmount,
                PatientDetails.GrossAmount, PatientDetails.DuesAmount,
                PatientDetails.AdvancePaid, PatientDetails.ChangeToReturn,
                PatientDetails.ChangeReturnedAt, PatientDetails.Status,
                PatientDetails.BookingStatus, PatientDetails.IsAdvanceBooking,
                DATE_FORMAT(PatientDetails.RegisteredOn,       '%d-%m-%y') AS RegisteredOn,
                DATE_FORMAT(PatientDetails.AdvanceBookingDate, '%d-%m-%y') AS AdvanceBookingDate,
                DoctorDetails.FirstName AS DoctorFirstName, DoctorDetails.LastName AS DoctorLastName,
                DoctorDetails.Degree1, DoctorDetails.Degree2, DoctorDetails.Degree3,
                DoctorDetails.Degree4, DoctorDetails.SpecialistIn AS DoctorSpecialistIn,
                COALESCE(PatientTests.TestNames, '')                AS TestNames,
                COUNT(DISTINCT ptr.Id)                              AS TotalTests,
                SUM(ptr.ReportReady = 1)                            AS ReportsReady,
                CASE
                    WHEN COUNT(DISTINCT ptr.Id) = 0                         THEN 'none'
                    WHEN SUM(ptr.ReportReady = 1) = COUNT(DISTINCT ptr.Id)  THEN 'all'
                    WHEN SUM(ptr.ReportReady = 1) > 0                       THEN 'partial'
                    ELSE 'none'
                END AS ReportState,
                CASE WHEN DATE(PatientDetails.RegisteredOn) < CURDATE() THEN 1 ELSE 0 END AS CrossDayCancellation
            FROM PatientDetails
            INNER JOIN DoctorDetails ON PatientDetails.DoctorId = DoctorDetails.Id
            LEFT JOIN (
                SELECT ptref.PatientId,
                       GROUP_CONCAT(mtt.TestName ORDER BY mtt.TestName SEPARATOR ', ') AS TestNames
                FROM PatientTestRefference ptref
                LEFT JOIN MainTestTable mtt ON ptref.TestId = mtt.Id
                GROUP BY ptref.PatientId
            ) AS PatientTests ON PatientDetails.Id = PatientTests.PatientId
            LEFT JOIN PatientTestRefference ptr ON ptr.PatientId = PatientDetails.Id
            ${whereStr}
            GROUP BY
                PatientDetails.Id, PatientDetails.Title, PatientDetails.Name,
                PatientDetails.Age, PatientDetails.YMD, PatientDetails.Gender,
                PatientDetails.PhoneNumber, PatientDetails.ActualAmount,
                PatientDetails.GrossAmount, PatientDetails.DuesAmount,
                PatientDetails.AdvancePaid, PatientDetails.ChangeToReturn,
                PatientDetails.ChangeReturnedAt, PatientDetails.Status,
                PatientDetails.BookingStatus, PatientDetails.IsAdvanceBooking,
                PatientDetails.RegisteredOn, PatientDetails.AdvanceBookingDate,
                PatientDetails.UpdatedOn,
                DoctorDetails.FirstName, DoctorDetails.LastName,
                DoctorDetails.Degree1, DoctorDetails.Degree2, DoctorDetails.Degree3,
                DoctorDetails.Degree4, DoctorDetails.SpecialistIn,
                PatientTests.TestNames
            ORDER BY
                CASE WHEN PatientDetails.BookingStatus = 'advance_booked' THEN 0 ELSE 1 END,
                PatientDetails.Id DESC
            LIMIT ${limit} OFFSET ${offset}
        `;
        const [rows] = await conn.execute(dataSQL, queryParams);
        return { rows, total };

    } finally {
        conn.release();
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — PATIENT DETAIL
// ─────────────────────────────────────────────────────────────────────────────

const getPatientDetails = async (patientId) => {
    const sql = `
        SELECT P.*, P.Id AS PatientId,
               DATE_FORMAT(P.RegisteredOn, '%d-%m-%y') AS RegisteredOn,
               D.Id AS DoctorId, D.FirstName AS DoctorFirstName, D.LastName AS DoctorLastName,
               D.Degree1 AS DoctorDegree1, D.Degree2 AS DoctorDegree2,
               D.Degree3 AS DoctorDegree3, D.Degree4 AS DoctorDegree4,
               D.SpecialistIn AS DoctorSpecialistIn,
               (
                   SELECT GROUP_CONCAT(DISTINCT MT.TestName ORDER BY MT.TestName SEPARATOR ', ')
                   FROM PatientTestRefference PTR
                   JOIN MainTestTable MT ON PTR.TestId = MT.Id
                   WHERE PTR.PatientId = P.Id
               ) AS TestNames
        FROM PatientDetails P
        LEFT JOIN DoctorDetails D ON P.DoctorId = D.Id
        WHERE P.Id = ?
    `;
    const [rows] = await db().execute(sql, [patientId]);
    return rows;
};


/* ============================================================================
 *  models/Patient.js  —  REPLACE your existing getPatientTestDetail with this.
 *
 *  Adds, for pathology tests (CategoryId = 2), the latest specimen status and
 *  the latest pathology report, so the patient-details page can:
 *    - Bug 3: show "Rejected + reason" (no Report button) when the specimen was rejected
 *    - Bug 2: show a PDF download when the pathology report is approved/delivered
 *  Non-pathology rows are unaffected (the LEFT JOINs just return NULL for them).
 * ========================================================================== */

const getPatientTestDetail = async (patientId) => {
    const [rows] = await db().query(`
        SELECT MT.*, MT.Id AS TestId, C.Name AS categoryName,
               PTR.Id AS PatientTestRefferenceId,
               PTR.ReportReady, PTR.TestStatus,
               ps.Status          AS SpecimenStatus,
               ps.RejectionReason AS SpecimenRejectionReason,
               pr.Id              AS PathoReportId,
               pr.Status          AS PathoReportStatus
        FROM MainTestTable MT
        INNER JOIN PatientTestRefference PTR ON MT.Id = PTR.TestId
        INNER JOIN Category C ON MT.CategoryId = C.Id
        LEFT JOIN Patho_Specimen ps
               ON ps.Id = (SELECT s.Id FROM Patho_Specimen s
                            WHERE s.PatientTestRefferenceId = PTR.Id
                            ORDER BY s.Id DESC LIMIT 1)
        LEFT JOIN Patho_Report pr
               ON pr.Id = (SELECT r.Id FROM Patho_Report r
                            WHERE r.PatientTestRefferenceId = PTR.Id AND r.DeletedAt IS NULL
                            ORDER BY r.Id DESC LIMIT 1)
        WHERE PTR.PatientId = ?
    `, [patientId]);
    return rows;
};
/*const getPatientTestDetail = async (patientId) => {
    const [rows] = await db().query(`
        SELECT MT.*, MT.Id AS TestId, C.Name AS categoryName,
               PTR.ReportReady, PTR.TestStatus
        FROM MainTestTable MT
        INNER JOIN PatientTestRefference PTR ON MT.Id = PTR.TestId
        INNER JOIN Category C ON MT.CategoryId = C.Id
        WHERE PTR.PatientId = ?
    `, [patientId]);
    return rows;
};
*/
const getPatientSubTestDetail = async (patientId) => {
    const [rows] = await db().query(`
        SELECT pstr.SubTestId, st.Name AS SubTestName, st.Price,
               pstr.Discount, mstr.MainTestId AS parentTestId
        FROM PatientSubTestRefference  pstr
        JOIN SubTestTable              st   ON st.Id          = pstr.SubTestId
        JOIN MainTestSubTestReference mstr ON mstr.SubTestId = pstr.SubTestId
        WHERE pstr.PatientId = ?
        ORDER BY mstr.MainTestId, st.Name
    `, [patientId]);
    return rows;
};

/**
 * FIX: Removed console.log(JSON.stringify(rows)) — was serializing the entire
 * result set on every call in production, wasting CPU and leaking PII to logs.
 */
const getTestsWithDeliverables = async (patientId) => {
    const [rows] = await db().query(`
        SELECT
            ptr.Id                                               AS PatientTestRefId,
            ptr.TestId, ptr.TestStatus, ptr.ReportReady,
            ptr.Discount, ptr.CompletedOn,
            t.TestName, t.ReportingTime, t.IsReportRequired,
            c.Name                                               AS categoryName,
            td.Id                                                AS DeliverableId,
            td.ComponentType, td.IsGenerated, td.IsDelivered,
            td.GeneratedOn, td.DeliveredOn, td.DeliveredTo,
            DATE_FORMAT(td.GeneratedOn, '%d %b %Y, %h:%i %p')   AS GeneratedOnFormatted,
            DATE_FORMAT(td.DeliveredOn, '%d %b %Y, %h:%i %p')   AS DeliveredOnFormatted,
            CONCAT(ug.FirstName,' ',ug.LastName)                 AS GeneratedByName,
            CONCAT(ud.FirstName,' ',ud.LastName)                 AS DeliveredByName
        FROM PatientTestRefference ptr
        JOIN MainTestTable         t   ON t.Id  = ptr.TestId
        LEFT JOIN Category         c   ON c.Id  = t.CategoryId
        LEFT JOIN TestDeliverables td  ON td.PatientTestReferenceId = ptr.Id
        LEFT JOIN Users            ug  ON ug.Id = td.GeneratedBy
        LEFT JOIN Users            ud  ON ud.Id = td.DeliveredBy
        WHERE ptr.PatientId = ?
        ORDER BY ptr.Id, td.ComponentType
    `, [patientId]);

    const grouped = {};
    for (const row of rows) {
        if (!grouped[row.PatientTestRefId]) {
            grouped[row.PatientTestRefId] = {
                PatientTestRefId: row.PatientTestRefId,
                TestId:           row.TestId,
                TestName:         row.TestName,
                TestStatus:       row.TestStatus,
                ReportReady:      row.ReportReady,
                ReportingTime:    row.ReportingTime,
                IsReportRequired: row.IsReportRequired,
                categoryName:     row.categoryName,
                CompletedOn:      row.CompletedOn,
                Components:       [],
            };
        }
        if (row.DeliverableId) {
            grouped[row.PatientTestRefId].Components.push({
                DeliverableId:        row.DeliverableId,
                PatientTestRefId:     row.PatientTestRefId,
                ComponentType:        row.ComponentType,
                IsGenerated:          row.IsGenerated,
                IsDelivered:          row.IsDelivered,
                GeneratedOn:          row.GeneratedOn,
                DeliveredOn:          row.DeliveredOn,
                DeliveredTo:          row.DeliveredTo,
                GeneratedOnFormatted: row.GeneratedOnFormatted,
                DeliveredOnFormatted: row.DeliveredOnFormatted,
                GeneratedByName:      row.GeneratedByName,
                DeliveredByName:      row.DeliveredByName,
            });
        }
    }
    return Object.values(grouped);
};

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — PAYMENT DETAILS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * FIX: Was callback-based and never resolved on empty result — hung indefinitely.
 * Now async/await with proper empty-result handling.
 */
const patientPaymentDetails = async (patientId) => {
    const [rows] = await db().execute(
        `SELECT DuesAmount, CashPayment, OnlinePayment, Status,
                DATE_FORMAT(RegisteredOn, '%Y-%m-%d') AS RegisteredOn
         FROM PatientDetails WHERE Id = ?`,
        [patientId]
    );
    return rows;
};

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — REGISTRATION, BILLING & COMMISSION
//
// SECURITY RULE: the browser only says WHICH tests and HOW MUCH discount.
// Prices, totals, dues and doctor commission are always recalculated here
// from the database. (Before, grossAmount / Price came from hidden inputs —
// anyone could bill an MRI for ₹1 by editing the form.)
// ─────────────────────────────────────────────────────────────────────────────

/** Error whose messages are safe to show to the user. */
const userError = (messages) => {
    const list = Array.isArray(messages) ? messages : [messages];
    const err  = new Error(list.join(' '));
    err.isUserError  = true;
    err.userMessages = list;
    return err;
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const toId   = (v) => { const n = parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : null; };

/** How many days ahead an advance booking may be made. */
/**
 * FIX: the history table was written as "PatientDetailsHistory" in one place and "patientdetailshistory"
 * in others. A Mac ignores the case, the Linux server does not → registration (or edit/cancel) failed live.
 * The real name is looked up once and reused.
 */
let historyTableName = null;
const historyTable = async (q) => {
    if (historyTableName) return historyTableName;
    try {
        const [[row]] = await q.query(`
            SELECT TABLE_NAME AS t FROM information_schema.tables
            WHERE table_schema = DATABASE() AND LOWER(TABLE_NAME) = 'patientdetailshistory' LIMIT 1`);
        historyTableName = row ? row.t : 'patientdetailshistory';
    } catch (_) { historyTableName = 'patientdetailshistory'; }
    return historyTableName;
};

const MAX_ADVANCE_DAYS = 90;

// ── S3: money input ─────────────────────────────────────────────────────────
const MAX_MONEY = 1000000;                                                 // ₹10,00,000 per entry
/** Cash received above the bill that may be handed back as change (typo guard: 45000 for 450). */
const MAX_CHANGE_RETURN = Number(process.env.MAX_CHANGE_RETURN) > 0 ? Number(process.env.MAX_CHANGE_RETURN) : 2000;

/** '', null → 0. Only plain amounts: 500 / 499.5 / 499.50. Rejects -100, 1e5, Infinity, 12abc. */
const parseMoney = (v, label) => {
    if (typeof v === 'number') v = String(v);
    const s = str(v);
    if (s === '') return 0;
    if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) throw userError(`${label} must be a plain amount like 500 or 499.50 (no minus sign).`);
    const n = round2(Number(s));
    if (n > MAX_MONEY) throw userError(`${label} (₹${n}) looks too high. Check the amount.`);
    return n;
};

// ── S1/S4: one-time request tokens ──────────────────────────────────────────
// Table from migrations/2026-10-24_patient_security.sql. Without it the code still works
// (token check skipped, warned once) so the app does not break before the migration is run.
let idemWarned = false;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * Claim a token inside the caller's transaction (call it as the FIRST statement).
 * A second request with the same token waits for the first one's commit, then gets
 * { claimed:false, resultRef } — so a double click / refresh / back-and-resubmit is caught.
 * If the first request rolls back (validation error) the token is free again.
 */
const claimToken = async (conn, scope, token, userId) => {
    const t = str(token);
    if (!t) return { claimed: true, skipped: true };
    if (!TOKEN_RE.test(t)) throw userError('This form has expired. Please reload the page and try again.');
    try {
        await conn.query('INSERT INTO IdempotencyKeys (Scope, TokenKey, UserId, CreatedAt) VALUES (?, ?, ?, NOW())', [scope, t, userId || null]);
        return { claimed: true };
    } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') {
            const [[r]] = await conn.query('SELECT ResultRef FROM IdempotencyKeys WHERE Scope = ? AND TokenKey = ? LOCK IN SHARE MODE', [scope, t]);
            return { claimed: false, resultRef: r ? r.ResultRef : null };
        }
        if (e.code === 'ER_NO_SUCH_TABLE') {
            if (!idemWarned) { idemWarned = true; log.warn('IdempotencyKeys table missing — run migrations/2026-10-24_patient_security.sql'); }
            return { claimed: true, skipped: true };
        }
        throw e;
    }
};
const setTokenResult = async (conn, scope, token, resultRef, claim) => {
    if (!claim || claim.skipped || !str(token)) return;
    await conn.query('UPDATE IdempotencyKeys SET ResultRef = ? WHERE Scope = ? AND TokenKey = ?', [String(resultRef), scope, str(token)]);
};

/** New random token for a form (registration page / dues modal). */
const newFormToken = () => crypto.randomBytes(18).toString('base64url');

// ── S1: serialise registrations for the same mobile number ──────────────────
const lockName = (phone) => `smartlab_reg_${String(phone).replace(/\D/g, '').slice(0, 15)}`;
const acquireRegLock = async (conn, phone) => {
    const [[r]] = await conn.query('SELECT GET_LOCK(?, 8) AS ok', [lockName(phone)]);
    if (!r || Number(r.ok) !== 1) throw userError('Another registration for this mobile number is being saved right now. Wait a few seconds and check the patient list before trying again.');
};
const releaseRegLock = (conn, phone) => conn.query('SELECT RELEASE_LOCK(?)', [lockName(phone)]).catch(() => {});

// ── S5: price snapshot (PatientTestRefference.Price / PatientSubTestRefference.Price) ──
let snapCache = { value: false, at: 0 };
const hasPriceSnapshot = async () => {
    if (snapCache.value) return true;
    if (Date.now() - snapCache.at < 60000) return false;          // re-check every minute until migrated
    try {
        const [[r]] = await db().query(`
            SELECT COUNT(*) AS n FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'Price'
              AND LOWER(TABLE_NAME) IN ('patienttestrefference', 'patientsubtestrefference')`);
        snapCache = { value: Number(r.n) >= 2, at: Date.now() };
    } catch (_) { snapCache = { value: false, at: Date.now() }; }
    return snapCache.value;
};

/**
 * The price each EXISTING item of a bill was sold at.
 *   • snapshot column filled  → that price
 *   • old rows (no snapshot)  → today's price, scaled so the old items still add up to the
 *     GrossAmount stored on the bill (otherwise editing only the name of a patient re-priced
 *     the whole old bill at today's rates and created or wiped dues).
 * Returns { test: Map(TestId → ₹), sub: Map(SubTestId → ₹) }.
 */
const loadEffectivePrices = async (q, patientId, storedGross) => {
    const snap = await hasPriceSnapshot();
    const [tRows] = await q.query(
        `SELECT ptr.TestId AS id, t.Price AS cur${snap ? ', ptr.Price AS snap' : ''}
         FROM PatientTestRefference ptr JOIN MainTestTable t ON t.Id = ptr.TestId
         WHERE ptr.PatientId = ? ORDER BY ptr.Id`, [patientId]);
    const [sRows] = await q.query(
        `SELECT pstr.SubTestId AS id, st.Price AS cur${snap ? ', pstr.Price AS snap' : ''}
         FROM PatientSubTestRefference pstr JOIN SubTestTable st ON st.Id = pstr.SubTestId
         WHERE pstr.PatientId = ? ORDER BY pstr.Id`, [patientId]);

    const items = [
        ...tRows.map(r => ({ kind: 'test', id: Number(r.id), cur: round2(num(r.cur)), snap: r.snap == null ? null : round2(num(r.snap)) })),
        ...sRows.map(r => ({ kind: 'sub',  id: Number(r.id), cur: round2(num(r.cur)), snap: r.snap == null ? null : round2(num(r.snap)) })),
    ];
    items.forEach(i => { i.price = i.snap != null ? i.snap : i.cur; });

    const legacy = items.filter(i => i.snap == null);
    if (legacy.length && storedGross != null) {
        const snapSum   = round2(items.filter(i => i.snap != null).reduce((a, i) => a + i.snap, 0));
        const legacyCur = round2(legacy.reduce((a, i) => a + i.cur, 0));
        const target    = round2(num(storedGross) - snapSum);
        if (legacyCur > 0 && target > 0 && Math.abs(target - legacyCur) > 0.5) {
            let acc = 0;
            legacy.forEach((i, k) => {
                if (k < legacy.length - 1) { i.price = round2(i.cur * target / legacyCur); acc = round2(acc + i.price); }
                else i.price = round2(target - acc);                         // last item takes the rounding
            });
        }
    }
    return {
        test: new Map(items.filter(i => i.kind === 'test').map(i => [i.id, i.price])),
        sub:  new Map(items.filter(i => i.kind === 'sub').map(i => [i.id, i.price])),
    };
};

// ── S5: bill version — detects that someone else changed the bill after the form was opened ──
const loadBillVersion = async (q, patientId) => {
    const [[row]] = await q.query(`
        SELECT CONCAT_WS('|', p.Status, p.BookingStatus, p.Name, p.PhoneNumber, p.Age, p.YMD,
                   p.GrossAmount, p.Discount, p.ActualAmount, p.CashPayment, p.OnlinePayment,
                   p.DuesAmount, p.ChangeToReturn, p.DoctorId, p.ClinicId,
                   COALESCE((SELECT GROUP_CONCAT(CONCAT(r.Id, ':', r.TestId, ':', COALESCE(r.Discount, 0)) ORDER BY r.Id)
                               FROM PatientTestRefference r WHERE r.PatientId = p.Id), ''),
                   COALESCE((SELECT GROUP_CONCAT(CONCAT(s.SubTestId, ':', COALESCE(s.Discount, 0)) ORDER BY s.SubTestId, s.Discount)
                               FROM PatientSubTestRefference s WHERE s.PatientId = p.Id), '')) AS v
        FROM PatientDetails p WHERE p.Id = ?`, [patientId]);
    return row ? crypto.createHash('sha256').update(String(row.v)).digest('hex').slice(0, 32) : null;
};

/**
 * Test thanks + sub-test thanks ADD UP (e.g. CT ₹500 + Contrast ₹200 = ₹700).
 * Set to true to go back to the old rule (a paid sub-test replaces its parent test's thanks).
 */
const SUBTEST_REPLACES_TEST_THANKS = false;

/** Category-% commission is calculated on the test price before discount
 *  (same as Test.registerTest → handleDoctorCommissions). Set true to use price − discount. */
const CATEGORY_RATE_ON_NET_PRICE = false;

const parseJsonArray = (raw, label) => {
    if (Array.isArray(raw)) return raw;
    try {
        const v = JSON.parse(raw || '[]');
        if (!Array.isArray(v)) throw new Error('not array');
        return v;
    } catch (_) {
        throw userError(`${label} data is invalid. Please reload the page and add the tests again.`);
    }
};

const ddmmyyyyToISO = (s) => {
    const m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(str(s));
    if (!m) return null;
    // FIX: built local midnight then compared with the UTC date → on an IST server every
    // date became "yesterday" and was rejected ("Select a valid advance booking date").
    const dd = +m[1], mm = +m[2], yy = +m[3];
    const d  = new Date(Date.UTC(yy, mm - 1, dd));
    if (d.getUTCFullYear() !== yy || d.getUTCMonth() !== mm - 1 || d.getUTCDate() !== dd) return null;  // 31-02 etc.
    return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
};

/**
 * Build the bill from DB prices.
 * body.selectedTestDetails    = [{ TestId, Discount }]
 * body.selectedSubTestDetails = [{ SubTestId, mainTestId, Discount }]
 */
/**
 * Options:
 *   allowInactiveTestIds — tests already on the bill may stay even if deactivated since
 *   priceOverride        — { test: Map, sub: Map } original prices of items already on the bill (edit)
 *   requireAllSubsFor    — test ids whose linked sub-tests MUST all be on the bill (S2: the form always
 *                          adds them; before, removing them from the hidden JSON billed MRI without contrast)
 *   requiredSubKeys      — "mainTestId:subTestId" pairs that must stay (sub-tests already on an edited bill)
 */
const buildBill = async (conn, body, { allowInactiveTestIds = [], priceOverride = null, requireAllSubsFor = null, requiredSubKeys = null } = {}) => {
    const rawTests = parseJsonArray(body.selectedTestDetails, 'Test');
    const rawSubs  = parseJsonArray(body.selectedSubTestDetails, 'Sub-test');
    const errors   = [];

    const tests = [];
    const seenT = new Set();
    for (const t of rawTests) {
        const id = toId(t && t.TestId);
        if (!id) throw userError('A test in the list is invalid. Please remove it and add again.');
        if (seenT.has(id)) continue;
        seenT.add(id);
        tests.push({ TestId: id, Discount: round2(num(t.Discount)) });
    }
    if (!tests.length) throw userError('Please add at least one test.');
    if (tests.length > 50) throw userError('Too many tests in one bill (maximum 50).');

    const [rows] = await conn.query(
        'SELECT Id, TestName, Price, Status, CategoryId FROM MainTestTable WHERE Id IN (?)',
        [tests.map(t => t.TestId)]
    );
    const byId          = new Map(rows.map(r => [Number(r.Id), r]));
    const allowInactive = new Set(allowInactiveTestIds.map(Number));

    for (const t of tests) {
        const r = byId.get(t.TestId);
        if (!r) { errors.push(`Test #${t.TestId} no longer exists. Remove it from the list.`); continue; }
        if (Number(r.Status) !== 1 && !allowInactive.has(t.TestId))
            errors.push(`"${r.TestName}" is inactive and cannot be billed.`);
        t.TestName   = r.TestName;
        t.Price      = priceOverride && priceOverride.test.has(t.TestId) ? priceOverride.test.get(t.TestId) : round2(num(r.Price));
        t.CategoryId = r.CategoryId;
        if (t.Discount < 0)       errors.push(`Discount on "${r.TestName}" cannot be negative.`);
        if (t.Discount > t.Price) errors.push(`Discount on "${r.TestName}" (₹${t.Discount}) is more than its price (₹${t.Price}).`);
    }

    const subs = [];
    const needSubs = (requireAllSubsFor && requireAllSubsFor.size) || (requiredSubKeys && requiredSubKeys.size);
    if (rawSubs.length || needSubs) {
        const [links] = await conn.query(
            `SELECT mstr.MainTestId, st.Id AS SubTestId, st.Name, st.Price
             FROM MainTestSubTestReference mstr
             JOIN SubTestTable st ON st.Id = mstr.SubTestId
             WHERE mstr.MainTestId IN (?)`,
            [tests.map(t => t.TestId)]
        );
        const linkMap = new Map(links.map(l => [`${l.MainTestId}:${l.SubTestId}`, l]));
        const seenS   = new Set();

        for (const s of rawSubs) {
            const sid = toId(s && s.SubTestId);
            const mid = toId(s && (s.mainTestId ?? s.MainTestId ?? s.parentTestId));
            const l   = sid && mid ? linkMap.get(`${mid}:${sid}`) : null;
            if (!l) { errors.push('A sub-test does not belong to its test any more. Remove that test and add it again.'); continue; }
            const key = `${mid}:${sid}`;
            if (seenS.has(key)) continue;
            seenS.add(key);
            const price = priceOverride && priceOverride.sub.has(sid) && requiredSubKeys && requiredSubKeys.has(key)
                ? priceOverride.sub.get(sid) : round2(num(l.Price));
            const disc  = round2(num(s.Discount));
            if (disc < 0)     errors.push(`Discount on sub-test "${l.Name}" cannot be negative.`);
            if (disc > price) errors.push(`Discount on sub-test "${l.Name}" is more than its price.`);
            subs.push({ SubTestId: sid, mainTestId: mid, Name: l.Name, Price: price, Discount: disc });
        }

        // S2: every linked sub-test of a newly added test, and every sub-test already on the bill, must be present
        const testName = new Map(tests.map(t => [t.TestId, t.TestName || `Test #${t.TestId}`]));
        const missing  = [];
        links.forEach(l => {
            const key = `${l.MainTestId}:${l.SubTestId}`;
            const required = (requireAllSubsFor && requireAllSubsFor.has(Number(l.MainTestId))) || (requiredSubKeys && requiredSubKeys.has(key));
            if (required && !seenS.has(key)) missing.push(`"${l.Name}" (part of ${testName.get(Number(l.MainTestId))})`);
        });
        if (missing.length) errors.push(`Sub-test${missing.length > 1 ? 's' : ''} ${missing.join(', ')} cannot be left out of the bill. Give a discount instead, or remove and add the test again.`);
    }

    if (errors.length) throw userError(errors);

    const gross    = round2(tests.reduce((a, t) => a + t.Price, 0) + subs.reduce((a, s) => a + s.Price, 0));
    const discount = round2(tests.reduce((a, t) => a + t.Discount, 0) + subs.reduce((a, s) => a + s.Discount, 0));
    return { tests, subs, gross, discount, net: round2(gross - discount) };
};

/** The form shows totals; if they differ from the DB the price list changed (or the form was tampered). */
const assertTotalsMatch = (bill, body) => {
    const fGross = round2(num(body.grossAmount));
    const fDisc  = round2(num(body.finalDiscount));
    if (Math.abs(fGross - bill.gross) > 0.5 || Math.abs(fDisc - bill.discount) > 0.5) {
        throw userError(
            `The bill on screen (₹${fGross}, discount ₹${fDisc}) does not match current prices ` +
            `(₹${bill.gross}, discount ₹${bill.discount}). Test prices may have changed — ` +
            'please remove and add the tests again.'
        );
    }
};

/**
 * Payment check + split into cash kept / online / dues / change.
 *
 * Edit options (all optional, registration passes nothing):
 *   alreadyReturned — change ALREADY handed back on this bill. FIX: it used to be treated as if it were
 *                     still in the drawer — bill 1200, paid 2000, change 800, then a 500 test added →
 *                     dues 0 and a fake "₹500 change not needed" cash receipt. Change given is gone;
 *                     only change handed back NOW is new.
 *   before          — { discount, approver, online } of the saved bill. FIX: editing only the address of
 *                     an old bill failed with "Enter who approved the discount" / "Select the bank" when
 *                     those were never recorded. Now they are required only when that part changes.
 */
const validatePayment = async (conn, bill, body, { alreadyReturned = 0, before = null } = {}) => {
    const errors = [];
    const cash   = parseMoney(body.cashPayment,   'Cash payment');            // S3: was parseFloat → "-500"/"1e9"/"12abc" accepted
    const online = parseMoney(body.onlinePayment, 'Online payment');
    const srcId  = toId(body.onlinePaymentMethod);
    const given  = round2(Math.max(0, num(alreadyReturned)));

    if (online > bill.net) errors.push(`Online payment (₹${online}) cannot be more than the bill (₹${bill.net}). Return change only for cash.`);
    if (cash < given) errors.push(`Cash received (₹${cash}) cannot be less than the change already handed back (₹${given}). ` +
                                  'To refund money, reduce the cash by the refund amount only.');

    const kept      = round2(Math.max(0, cash - given) + online);          // money the centre really has for this bill
    const newChange = round2(Math.max(0, kept - bill.net));                 // to hand back NOW
    if (newChange > MAX_CHANGE_RETURN) {
        errors.push(`Cash received is ₹${newChange} more than the bill (₹${bill.net}). Check the amount — ` +
                    `more than ₹${MAX_CHANGE_RETURN} change is not allowed.` + (before ? ' To refund on an edited bill, reduce the Cash amount instead.' : ''));
    }

    const approver     = str(body.discountApprovedBy);
    const discountUp   = !before || bill.discount > round2(num(before.discount)) + 0.005;
    const approverEdit = before && approver !== str(before.approver);
    if (bill.discount > 0 && !approver && (discountUp || approverEdit)) errors.push('Enter who approved the discount.');
    if (approver.length > 100) errors.push('"Approved by" is too long.');

    const onlineUp = !before || online > round2(num(before.online)) + 0.005;
    if (online > 0 && (srcId || onlineUp)) {
        if (!srcId) errors.push('Select the bank / UPI source for the online payment.');
        else {
            const [src] = await conn.query('SELECT Id FROM OnlinePaymentSources WHERE Id = ? LIMIT 1', [srcId]);
            if (!src.length) errors.push('The selected online payment source no longer exists.');
        }
    }
    if (errors.length) throw userError(errors);

    return {
        cash, online,
        paid:           round2(cash + online),
        kept,
        onlineSourceId: online > 0 ? srcId : null,
        dues:           round2(Math.max(0, bill.net - kept)),
        newChange,
        change:         round2(given + newChange),     // total change on this bill (stored in ChangeToReturn)
    };
};

/** Clinic & doctor must exist; a NEW doctor/clinic pair must be linked (Clinic → Doctors page). */
const validateClinicDoctor = async (conn, clinicId, doctorId, { requireLink = true } = {}) => {
    const errors = [];
    const [[clinic]] = await conn.query('SELECT Id FROM Clinics WHERE Id = ? LIMIT 1', [clinicId]);
    const [[doctor]] = await conn.query('SELECT Id FROM DoctorDetails WHERE Id = ? LIMIT 1', [doctorId]);
    if (!clinic) errors.push('The selected clinic no longer exists.');
    if (!doctor) errors.push('The selected doctor no longer exists.');
    if (clinic && doctor && requireLink) {
        const [[link]] = await conn.query(
            'SELECT 1 AS ok FROM ClinicAndDoctorAssociation WHERE ClinicId = ? AND DoctorId = ? LIMIT 1',
            [clinicId, doctorId]
        );
        if (!link) errors.push('This doctor is not attached to the selected clinic. Attach the doctor from Clinic → Doctors first.');
    }
    if (errors.length) throw userError(errors);
};

const insertTestRows = async (conn, patientId, tests) => {
    const [meta] = await conn.query('SELECT Id, NoOfFilm FROM MainTestTable WHERE Id IN (?)', [tests.map(t => t.TestId)]);
    const films  = new Map(meta.map(m => [Number(m.Id), Number(m.NoOfFilm) || 0]));
    const pathologyRefs = [];
    const snap   = await hasPriceSnapshot();

    for (const test of tests) {
        // S5: the price the test was sold at is kept on the row (later price-list changes don't re-price old bills)
        const [r] = snap
            ? await conn.query('INSERT INTO PatientTestRefference (PatientId, TestId, Discount, Price) VALUES (?, ?, ?, ?)',
                               [patientId, test.TestId, test.Discount, test.Price])
            : await conn.query('INSERT INTO PatientTestRefference (PatientId, TestId, Discount) VALUES (?, ?, ?)',
                               [patientId, test.TestId, test.Discount]);
        test.PatientTestRefId = r.insertId;

        const deliverables = [[r.insertId, patientId, 'Report']];
        if (films.get(test.TestId) > 0) deliverables.push([r.insertId, patientId, 'Film']);
        await conn.query(
            'INSERT IGNORE INTO TestDeliverables (PatientTestReferenceId, PatientId, ComponentType) VALUES ?',
            [deliverables]
        );

        const dept = await DepartmentResolverService.resolve(test.TestId, conn);
        if (dept && dept.IsPathology) pathologyRefs.push({ patientTestRefferenceId: r.insertId, testId: test.TestId });
    }
    return pathologyRefs;
};

const insertSubRows = async (conn, patientId, subs) => {
    if (!subs.length) return;
    if (await hasPriceSnapshot()) {
        await conn.query('INSERT INTO PatientSubTestRefference (PatientId, SubTestId, Discount, Price) VALUES ?',
            [subs.map(s => [patientId, s.SubTestId, s.Discount, s.Price])]);
    } else {
        await conn.query('INSERT INTO PatientSubTestRefference (PatientId, SubTestId, Discount) VALUES ?',
            [subs.map(s => [patientId, s.SubTestId, s.Discount])]);
    }
};

/**
 * Specimen rows are created AFTER commit: SpecimenService uses its own DB
 * connection, and inside our open transaction it waited on the uncommitted
 * PatientTestRefference row (lock wait → pathology registrations hung ~50 s).
 */
const createSpecimensAfterCommit = async (refs, createdBy, ip, userAgent) => {
    const failed = [];
    for (const ref of refs) {
        try {
            await SpecimenService.autoCreateFromBooking({ ...ref, createdBy, ipAddress: ip, userAgent });
        } catch (e) {
            log.error('specimen create failed:', ref.patientTestRefferenceId, e.message);
            failed.push(ref.testId);
        }
    }
    return failed;
};

const createQueueItemsForPatient = async (conn, patientId, tests, referredDoctorId, isEmergency) => {
    for (const test of tests) {
        const [catRows] = await conn.query(
            'SELECT c.RoomCode FROM Category c JOIN MainTestTable t ON t.CategoryId = c.Id WHERE t.Id = ?',
            [test.TestId]
        );
        const [q] = await conn.query(
            `INSERT INTO PatientQueue (PatientId, PatientTestId, RoomCode, TestName, ReferredDoctorId, IsEmergency, Status, ArrivalTime)
             VALUES (?, ?, ?, ?, ?, ?, 'Waiting', NOW())`,
            [patientId, test.PatientTestRefId, catRows[0]?.RoomCode || null, test.TestName, referredDoctorId || null, isEmergency ? 1 : 0]
        );
        await conn.query(
            "UPDATE PatientTestRefference SET QueueItemId = ?, TestStatus = 'Waiting' WHERE Id = ?",
            [q.insertId, test.PatientTestRefId]
        );
    }
};

/**
 * Advance bookings do NOT enter the test queue (or pathology sample list) when
 * they are booked — only when the patient actually arrives. Called inside the
 * arrival transaction. Idempotent: only tests without a queue item are added.
 * Returns pathology refs so samples can be created after commit.
 */
const enqueueOnArrival = async (conn, patientId) => {
    const [[p]] = await conn.query('SELECT DoctorId FROM PatientDetails WHERE Id = ?', [patientId]);
    const [rows] = await conn.query(`
        SELECT r.Id AS PatientTestRefId, r.TestId, m.TestName
        FROM PatientTestRefference r JOIN MainTestTable m ON m.Id = r.TestId
        WHERE r.PatientId = ? AND r.QueueItemId IS NULL`, [patientId]);
    if (!rows.length) return [];
    await createQueueItemsForPatient(conn, patientId, rows, p && p.DoctorId, false);
    const pathologyRefs = [];
    for (const t of rows) {
        const dept = await DepartmentResolverService.resolve(t.TestId, conn);
        if (dept && dept.IsPathology) pathologyRefs.push({ patientTestRefferenceId: t.PatientTestRefId, testId: t.TestId });
    }
    return pathologyRefs;
};

/**
 * One money movement = one row. PaymentMode says which drawer it touched:
 *   cash   → counts in the receptionist's cash handover
 *   online → goes to the bank, never part of the cash handover
 * Credits infer the mode; debits (refund / change) must pass it.
 */
const writeTx = async (conn, { userId, patientId, type, cash = 0, online = 0, debit = 0, sourceId = null, note, mode, shiftDate = null }) => {
    const m = mode || (online > 0 ? 'online' : 'cash');
    await conn.query(
        `INSERT INTO TransactionTable (UserId, PatientId, TransactionType, CreditCash, CreditOnline, Debit, PaymentMode, OnlineSourceId, ShiftDate, Notes, TransactedOn)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURDATE()), ?, NOW())`,
        [userId, patientId, type, cash, online, debit, m, sourceId, shiftDate, note]
    );
};

/** Same name + phone already registered today (catches double-click / refresh duplicates). */
const findSameDayDuplicate = async (conn, body) => {
    // FIX S1: "Ram  Kumar" (two spaces) used to pass as a different patient; old rows may still hold
    // double spaces, so both sides are normalised.
    const [[row]] = await conn.query(
        `SELECT Id FROM PatientDetails
         WHERE PhoneNumber = ? AND Status = 1
           AND LOWER(TRIM(REPLACE(REPLACE(REPLACE(Name, '   ', ' '), '  ', ' '), '  ', ' '))) = LOWER(?)
           AND (DATE(RegisteredOn) = CURDATE() OR (IsAdvanceBooking = 1 AND BookingStatus = 'advance_booked'))
         ORDER BY Id DESC LIMIT 1`,
        [str(body.phoneNumber), cleanName(body.patientName)]
    );
    return row ? row.Id : null;
};

// ── Register ────────────────────────────────────────────────────────────────

const registerPatient = async (body, registeredBy, ip, userAgent) => {
    const v = validateRegistration(body);
    if (!v.valid) return { success: false, message: v.errors.join(' '), errors: v.errors };

    const isAdvance = body.isAdvanceBooking == 1;
    let advanceBookingDate = null;
    if (isAdvance) {
        advanceBookingDate = ddmmyyyyToISO(body.advanceBookingDate) || (/^\d{4}-\d{2}-\d{2}$/.test(str(body.advanceBookingDate)) ? str(body.advanceBookingDate) : null);
        const today = moment().format('YYYY-MM-DD');
        const max   = moment().add(MAX_ADVANCE_DAYS, 'days').format('YYYY-MM-DD');
        if (!advanceBookingDate)                 return fail(['Select a valid advance booking date.']);
        if (advanceBookingDate <= today)         return fail(['Advance booking date must be after today. For today, register normally.']);
        if (advanceBookingDate > max)            return fail([`Advance booking can be at most ${MAX_ADVANCE_DAYS} days ahead.`]);
    }

    const clinicId    = toId(body.clinic);
    const doctorId    = toId(body.doctor);
    const patientName = cleanName(body.patientName);
    const phone       = str(body.phoneNumber);
    const conn        = await getConnection();
    let pathologyRefs = [];
    let locked        = false;

    try {
        // S1: two tabs / two receptionists / a double click for the same mobile are handled one at a time
        await acquireRegLock(conn, phone);
        locked = true;
        await conn.beginTransaction();

        // S1: one-time form token — refresh, back + resubmit and double submit return the first bill
        const claim = await claimToken(conn, 'register', body.formToken, registeredBy);
        if (!claim.claimed) {
            await conn.rollback();
            return { success: false, alreadySaved: true, patientId: toId(claim.resultRef),
                     errors: ['This registration was already saved.'] };
        }

        const dup = await findSameDayDuplicate(conn, body);
        if (dup && body.confirmDuplicate != 1) {
            await conn.rollback();
            return {
                success: false, duplicateOf: dup,
                errors: [`${patientName} (${phone}) is already registered today or has an open advance booking — Bill No ${dup}. ` +
                         'For an advance booking use "Mark arrived" on that bill. Tick "Register anyway" only if this is a new visit.'],
            };
        }

        await validateClinicDoctor(conn, clinicId, doctorId, { requireLink: true });
        const requestedIds = new Set(parseJsonArray(body.selectedTestDetails, 'Test').map(t => toId(t && t.TestId)).filter(Boolean));
        const bill = await buildBill(conn, body, { requireAllSubsFor: requestedIds });
        assertTotalsMatch(bill, body);
        const pay  = await validatePayment(conn, bill, body);

        const registeredTime = moment().format('hh:mm:ss A');   // server clock, never the browser's
        const bookingStatus  = isAdvance ? 'advance_booked' : 'registered';
        const isEmergency    = body.isEmergency == 1;

        // 1. Patient
        const [pr] = await conn.query(
            `INSERT INTO PatientDetails (
                Title, Name, Age, YMD, Gender, PhoneNumber, Address,
                GrossAmount, Discount, DiscountApprovedBy, ActualAmount,
                CashPayment, OnlinePayment, DuesAmount, ChangeToReturn,
                ClinicId, DoctorId, RegisteredOn, RegisteredTime, RegisteredBy,
                Status, BookingStatus, IsAdvanceBooking, AdvanceBookingDate, AdvancePaid
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), ?, ?, 1, ?, ?, ?, ?)`,
            [
                str(body.title), patientName, parseInt(body.age, 10), str(body.ymd), str(body.gender),
                phone, str(body.patientAddress),
                bill.gross, bill.discount, str(body.discountApprovedBy), bill.net,
                pay.cash, pay.online, pay.dues, pay.change,
                clinicId, doctorId, registeredTime, registeredBy,
                // FIX: AdvancePaid included the change handed back (paid 500 for 450 → "advance ₹500")
                bookingStatus, isAdvance ? 1 : 0, advanceBookingDate, isAdvance ? pay.kept : 0,
            ]
        );
        const patientId = pr.insertId;
        await setTokenResult(conn, 'register', body.formToken, patientId, claim);

        // 2. Tests, deliverables, sub-tests
        pathologyRefs = await insertTestRows(conn, patientId, bill.tests);
        await insertSubRows(conn, patientId, bill.subs);

        // 3. Doctor commission (test-wise rate, else category %, sub-test rate)
        const referral = await processReferral(conn, {
            doctorId, patientId, registeredBy,
            testIds: bill.tests.map(t => t.TestId), subTests: bill.subs, bill,
        });

        // 4. Money trail
        const note = (label) => isAdvance ? `Advance ${label} — appt ${advanceBookingDate}` : `${label} at registration`;
        if (pay.cash   > 0) await writeTx(conn, { userId: registeredBy, patientId, type: 'payment', cash: pay.cash, note: note('Cash payment') });
        if (pay.online > 0) await writeTx(conn, { userId: registeredBy, patientId, type: 'payment', online: pay.online, sourceId: pay.onlineSourceId, note: note('Online payment') });
        if (pay.change > 0) await writeTx(conn, { userId: registeredBy, patientId, type: 'change_returned', debit: pay.change, mode: 'cash', note: `Change returned ₹${pay.change}` });

        // 5. History snapshot
        await conn.query(
            `INSERT INTO ${await historyTable(conn)} (
                PatientId, Title, Name, Age, YMD, Gender, PhoneNumber, Address,
                ActualAmount, GrossAmount, Discount, DiscountApprovedBy,
                ClinicId, DoctorId, CashPayment, OnlinePayment, DuesAmount,
                Status, BookingStatus, IsAdvanceBooking, AdvanceBookingDate,
                AdvancePaid, ChangeToReturn, ModifiedBy, ChangeType
            ) SELECT Id, Title, Name, Age, YMD, Gender, PhoneNumber, Address,
                     ActualAmount, GrossAmount, Discount, DiscountApprovedBy,
                     ClinicId, DoctorId, CashPayment, OnlinePayment, DuesAmount,
                     Status, BookingStatus, IsAdvanceBooking, AdvanceBookingDate,
                     AdvancePaid, ChangeToReturn, ?, 'insert'
              FROM PatientDetails WHERE Id = ?`,
            [registeredBy, patientId]
        );

        // 6. Daily settlement
        const netCash = round2(pay.cash - pay.change);
        await conn.query(
            `INSERT INTO DailySettlement (
                SettlementDate, UserId, CashCollected, OnlineCollected, CashChangeReturned,
                NetCash, NetOnline, TotalPatients, AdvanceBookings, TotalToHandOver, Status
            ) VALUES (CURDATE(), ?, ?, ?, ?, ?, ?, 1, ?, ?, 'open')
            ON DUPLICATE KEY UPDATE
                CashCollected      = CashCollected      + VALUES(CashCollected),
                OnlineCollected    = OnlineCollected    + VALUES(OnlineCollected),
                CashChangeReturned = CashChangeReturned + VALUES(CashChangeReturned),
                NetCash            = NetCash            + VALUES(NetCash),
                NetOnline          = NetOnline          + VALUES(NetOnline),
                TotalPatients      = TotalPatients      + 1,
                AdvanceBookings    = AdvanceBookings    + VALUES(AdvanceBookings),
                TotalToHandOver    = TotalToHandOver    + VALUES(TotalToHandOver)`,
            [registeredBy, pay.cash, pay.online, pay.change, netCash, pay.online, isAdvance ? 1 : 0, netCash]
        );

        // 7. Queue — advance bookings join the queue only when they arrive (see enqueueOnArrival)
        if (!isAdvance) await createQueueItemsForPatient(conn, patientId, bill.tests, doctorId, isEmergency);

        // 8. Audit — signed snapshot of the ORIGINAL bill (baseline for every later edit)
        {
            const after = PatientAudit.money({ gross: bill.gross, discount: bill.discount, net: bill.net,
                                               cash: pay.cash, change: pay.change, online: pay.online, dues: pay.dues });
            const reasons = [];
            if (str(body.discountApprovedBy)) reasons.push(`Discount approved by ${str(body.discountApprovedBy)}`);
            if (dup) reasons.push(`Registered anyway although Bill No ${dup} exists for the same name and mobile`);   // S1: override is on record
            const ev = PatientAudit.event(conn, { patientId, action: 'REGISTER', actorId: registeredBy, ip, userAgent,
                                                  reason: reasons.join('. ') });
            bill.tests.forEach(t => ev.testAdded(t.TestName, t.Price));
            bill.subs.forEach(s => ev.subTestAdded(s.Name, s.Price));
            if (bill.discount > 0) ev.add('payment', 'Discount', 'Discount', '—', `₹${bill.discount}`);
            if (pay.cash > 0)   ev.add('payment', 'Cash Payment', 'CashPayment', '—', `₹${pay.cash}`);
            if (pay.online > 0) ev.add('payment', 'Online Payment', 'OnlinePayment', '—', `₹${pay.online}`);
            if (pay.dues > 0)   ev.add('payment', 'Dues', 'DuesAmount', '—', `₹${pay.dues}`);
            ev.setMoney(null, after)
              .setExtra({ doctorId, clinicId, isAdvance, advanceBookingDate, thanks: referral && referral.thanks, duplicateOf: dup || null })
              .setRisk(PatientAudit.evaluateRisk('REGISTER', { after }));
            await ev.save();
        }

        await conn.commit();

        const failedSpecimens = isAdvance ? [] : await createSpecimensAfterCommit(pathologyRefs, registeredBy, ip, userAgent);
        const warnings = [];
        if (pay.change > 0) warnings.push(`Return change ₹${pay.change} to the patient.`);
        if (failedSpecimens.length) warnings.push('Sample collection entries could not be created for some pathology tests — please add them from the specimen screen.');

        return {
            success: true, patientId, billNo: patientId,
            duesAmount: pay.dues, changeToReturn: pay.change,
            referral, warnings,
            message: isAdvance
                ? `Advance booking saved for ${moment(advanceBookingDate).format('DD-MM-YYYY')}. Bill No ${patientId}.`
                : `Patient registered. Bill No ${patientId}.` + (pay.dues > 0 ? ` Dues ₹${pay.dues}.` : ''),
        };
    } catch (err) {
        await conn.rollback().catch(() => {});
        if (err.isUserError) return fail(err.userMessages);
        log.error('registerPatient error:', err.code || '', err.message);
        return fail([friendlyDbMessage(err, 'Registration')]);
    } finally {
        if (locked) await releaseRegLock(conn, phone);
        conn.release();
    }
};

function fail(errors) { return { success: false, message: errors.join(' '), errors }; }

function friendlyDbMessage(err, action) {
    switch (err && err.code) {
        case 'ER_NO_REFERENCED_ROW':
        case 'ER_NO_REFERENCED_ROW_2': return `${action} failed: a selected test, doctor or clinic no longer exists. Refresh the page and try again.`;
        case 'ER_LOCK_WAIT_TIMEOUT':
        case 'ER_LOCK_DEADLOCK':       return `${action} failed because the database was busy. Please click save again.`;
        case 'ER_DATA_TOO_LONG':       return `${action} failed: one of the values is too long.`;
        case 'ECONNREFUSED':
        case 'PROTOCOL_CONNECTION_LOST': return `${action} failed: cannot reach the database server.`;
        default: return `${action} failed. Please try again.` + (process.env.NODE_ENV === 'production' ? '' : ` (${err.message})`);
    }
}

// ── Edit page data ──────────────────────────────────────────────────────────

const getEditPatientPageData = async (patientId) => {
    const pool = db();
    const [[patientRows], [testRows], [subTestRows]] = await Promise.all([
        pool.query(`
            SELECT pd.*, DATE_FORMAT(pd.RegisteredOn, '%d-%m-%Y') AS RegisteredOnFormatted,
                   (SELECT tt.OnlineSourceId FROM TransactionTable tt
                     WHERE tt.PatientId = pd.Id AND tt.CreditOnline > 0 AND tt.OnlineSourceId IS NOT NULL
                     ORDER BY tt.Id DESC LIMIT 1) AS OnlineSourceId
            FROM PatientDetails pd
            WHERE pd.Id = ? LIMIT 1
        `, [patientId]),
        pool.query(`
            SELECT ptr.TestId, t.TestName, t.Price, COALESCE(ptr.Discount,0) AS Discount, t.CategoryId,
                   ptr.ReportReady, ptr.TestStatus
            FROM PatientTestRefference ptr
            JOIN MainTestTable t ON t.Id = ptr.TestId
            WHERE ptr.PatientId = ?
            ORDER BY ptr.Id
        `, [patientId]),
        pool.query(`
            SELECT pstr.SubTestId, st.Name AS Name, st.Price, COALESCE(pstr.Discount,0) AS Discount,
                   MIN(mstr.MainTestId) AS mainTestId
            FROM PatientSubTestRefference pstr
            JOIN SubTestTable             st   ON st.Id = pstr.SubTestId
            JOIN MainTestSubTestReference mstr ON mstr.SubTestId = pstr.SubTestId
            JOIN PatientTestRefference    ptr  ON ptr.PatientId = pstr.PatientId AND ptr.TestId = mstr.MainTestId
            WHERE pstr.PatientId = ?
            GROUP BY pstr.Id, pstr.SubTestId, st.Name, st.Price, pstr.Discount
        `, [patientId]),
    ]);

    if (!patientRows.length) return null;

    // S5: show the prices the bill was made with (the server uses the same ones on save)
    const [prices, billVersion] = await Promise.all([
        loadEffectivePrices(pool, patientId, patientRows[0].GrossAmount),
        loadBillVersion(pool, patientId),
    ]);
    testRows.forEach(t => { if (prices.test.has(Number(t.TestId))) t.Price = prices.test.get(Number(t.TestId)); });
    subTestRows.forEach(s => { if (prices.sub.has(Number(s.SubTestId))) s.Price = prices.sub.get(Number(s.SubTestId)); });

    return {
        patientDetails:        patientRows[0],
        patientTestDetails:    JSON.stringify(testRows),
        patientSubTestDetails: JSON.stringify(subTestRows),
        tests:                 testRows,
        subTests:              subTestRows,
        billVersion,
    };
};

/** Clinic → doctor ids, so the form can filter doctors without an AJAX call. */
const getClinicDoctorMap = async () => {
    const [rows] = await db().query('SELECT ClinicId, DoctorId FROM ClinicAndDoctorAssociation');
    const map = {};
    rows.forEach(r => { (map[r.ClinicId] = map[r.ClinicId] || []).push(r.DoctorId); });
    return map;
};

// ── Update ──────────────────────────────────────────────────────────────────

const LOCKED_TEST_STATUSES = ['InProgress', 'Completed'];

const updatePatientDetails = async (patientId, body, updatedBy, ip, userAgent) => {
    const v = validateRegistration(body);
    if (!v.valid) return { success: false, message: v.errors.join(' '), errors: v.errors };

    const clinicId = toId(body.clinic);
    const doctorId = toId(body.doctor);
    const conn     = await getConnection();
    let pathologyRefs = [];

    try {
        await conn.beginTransaction();

        const [beforeRows] = await conn.query(`
            SELECT pd.*, CONCAT(d.FirstName,' ',d.LastName) AS DoctorName, cl.Name AS ClinicName
            FROM PatientDetails pd
            LEFT JOIN DoctorDetails d  ON d.Id  = pd.DoctorId
            LEFT JOIN Clinics       cl ON cl.Id = pd.ClinicId
            WHERE pd.Id = ? FOR UPDATE
        `, [patientId]);
        if (!beforeRows.length) throw userError('Patient not found.');
        const before = beforeRows[0];
        if (Number(before.Status) === 0) throw userError('This patient is cancelled and cannot be edited.');

        // S5: lost-update guard. Form opened at 10:00 shows Cash ₹500; at 10:05 dues ₹300 are collected;
        // at 10:10 the old form is saved → used to write Cash ₹500 back and book a ₹300 "refund".
        const currentVersion = await loadBillVersion(conn, patientId);
        if (!str(body.billVersion) || str(body.billVersion) !== currentVersion) {
            throw userError('This bill was changed by someone else (payment, tests or details) after you opened it. ' +
                            'Your changes were NOT saved. Open the bill again and redo the change.');
        }

        const [oldRefs] = await conn.query(`
            SELECT ptr.Id, ptr.TestId, ptr.Discount, ptr.ReportReady, ptr.TestStatus, t.TestName
            FROM PatientTestRefference ptr JOIN MainTestTable t ON t.Id = ptr.TestId
            WHERE ptr.PatientId = ? FOR UPDATE
        `, [patientId]);

        // Only a CHANGED clinic/doctor pair must be linked (old data stays editable)
        const pairChanged = String(clinicId) !== String(before.ClinicId) || String(doctorId) !== String(before.DoctorId);
        await validateClinicDoctor(conn, clinicId, doctorId, { requireLink: pairChanged });

        // S5: items already on the bill keep the price they were sold at
        const priceOverride = await loadEffectivePrices(conn, patientId, before.GrossAmount);
        // S2: new tests bring all their sub-tests; sub-tests already on the bill stay while their test stays
        const requestedIds = new Set(parseJsonArray(body.selectedTestDetails, 'Test').map(t => toId(t && t.TestId)).filter(Boolean));
        const oldTestIds   = new Set(oldRefs.map(r => Number(r.TestId)));
        const addedIdsReq  = new Set([...requestedIds].filter(id => !oldTestIds.has(id)));
        const keptIdsReq   = [...requestedIds].filter(id => oldTestIds.has(id));
        const [oldSubIdRows] = await conn.query('SELECT DISTINCT SubTestId FROM PatientSubTestRefference WHERE PatientId = ?', [patientId]);
        let requiredSubKeys = new Set();
        if (oldSubIdRows.length && keptIdsReq.length) {
            const [keptLinks] = await conn.query(
                'SELECT MainTestId, SubTestId FROM MainTestSubTestReference WHERE SubTestId IN (?) AND MainTestId IN (?)',
                [oldSubIdRows.map(r => r.SubTestId), keptIdsReq]);
            requiredSubKeys = new Set(keptLinks.map(l => `${l.MainTestId}:${l.SubTestId}`));
        }

        const bill = await buildBill(conn, body, {
            allowInactiveTestIds: oldRefs.map(r => r.TestId),
            priceOverride, requireAllSubsFor: addedIdsReq, requiredSubKeys,
        });
        assertTotalsMatch(bill, body);
        const pay  = await validatePayment(conn, bill, body, {
            alreadyReturned: before.ChangeToReturn,
            before: { discount: before.Discount, approver: before.DiscountApprovedBy, online: before.OnlinePayment },
        });

        // ── Tests: diff instead of delete-all (keeps reports, queue, deliverables, specimens) ──
        const newIds   = new Set(bill.tests.map(t => t.TestId));
        const oldById  = new Map(oldRefs.map(r => [Number(r.TestId), r]));
        const removed  = oldRefs.filter(r => !newIds.has(Number(r.TestId)));
        const added    = bill.tests.filter(t => !oldById.has(t.TestId));
        const kept     = bill.tests.filter(t =>  oldById.has(t.TestId));

        // Authorised person (Admin / "Change bill after test done") may remove a test that is in progress
        // or completed. A test whose REPORT is ready is never removed (the report would be lost) —
        // give a discount on it instead.
        const canEditLocked = await PatientAudit.canEditLockedBill(conn, updatedBy);
        const locked = removed.filter(r => r.ReportReady == 1 || (!canEditLocked && LOCKED_TEST_STATUSES.includes(r.TestStatus)));
        if (locked.length) {
            throw userError(locked.map(r => r.ReportReady == 1
                ? `"${r.TestName}" cannot be removed — its report is ready. Keep the test and give a discount on it instead.`
                : `"${r.TestName}" cannot be removed — it is ${String(r.TestStatus).toLowerCase()}. Only an Admin or an authorised person can do this.`));
        }

        // ── Audit guard: who may reduce this bill? (runs BEFORE anything is changed) ──
        const [oldSubs] = await conn.query(`
            SELECT pstr.SubTestId, st.Name, st.Price, COALESCE(pstr.Discount,0) AS Discount
            FROM PatientSubTestRefference pstr JOIN SubTestTable st ON st.Id = pstr.SubTestId
            WHERE pstr.PatientId = ?`, [patientId]);
        const newSubIds   = new Set(bill.subs.map(s => Number(s.SubTestId)));
        const oldSubIds   = new Set(oldSubs.map(s => Number(s.SubTestId)));
        const removedSubs = oldSubs.filter(s => !newSubIds.has(Number(s.SubTestId)));
        const addedSubs   = bill.subs.filter(s => !oldSubIds.has(Number(s.SubTestId)));

        const auditCtx    = await PatientAudit.loadContext(conn, patientId);
        const stateByRef  = new Map(auditCtx.tests.map(t => [Number(t.refId), t]));
        const removedInfo = removed.map(r => ({ ...(stateByRef.get(Number(r.Id)) || {}), name: r.TestName, price: round2(num((stateByRef.get(Number(r.Id)) || {}).price)) }));
        const moneyBefore = PatientAudit.moneyFromRow(before);
        const moneyAfter  = PatientAudit.money({ gross: bill.gross, discount: bill.discount, net: bill.net,
                                                 cash: pay.cash, change: pay.change, online: pay.online, dues: pay.dues });
        const doctorChanged = String(doctorId) !== String(before.DoctorId);
        const clinicChanged = String(clinicId) !== String(before.ClinicId);
        const editReason    = str(body.editReason);

        const guard = await PatientAudit.guardEdit(conn, {
            actorId: updatedBy, ctx: auditCtx, before: moneyBefore, after: moneyAfter,
            removedTests: removedInfo, removedSubs: removedSubs.map(s => ({ name: s.Name })),
            addedTests: added.map(t => ({ name: t.TestName })), addedSubs: addedSubs.map(s => ({ name: s.Name })),
            testDiscountChanged: kept.some(t => round2(num(oldById.get(t.TestId).Discount)) !== t.Discount),
            doctorChanged, clinicChanged, reason: editReason, canEditLocked,
        });
        if (guard.errors.length) throw userError(guard.errors);

        if (removed.length) {
            const ids = removed.map(r => r.Id);
            await conn.query('DELETE FROM TestDeliverables WHERE PatientTestReferenceId IN (?)', [ids]);
            await conn.query('DELETE FROM PatientQueue WHERE PatientTestId IN (?)', [ids]);
            await conn.query('DELETE FROM PatientTestRefference WHERE Id IN (?)', [ids]);
        }
        const snapOn = await hasPriceSnapshot();
        for (const t of kept) {
            const ref = oldById.get(t.TestId);
            t.PatientTestRefId = ref.Id;
            if (snapOn) {
                // also fills the price snapshot of old rows (lazy back-fill)
                await conn.query('UPDATE PatientTestRefference SET Discount = ?, Price = ? WHERE Id = ?', [t.Discount, t.Price, ref.Id]);
            } else if (round2(num(ref.Discount)) !== t.Discount) {
                await conn.query('UPDATE PatientTestRefference SET Discount = ? WHERE Id = ?', [t.Discount, ref.Id]);
            }
        }
        if (added.length) {
            pathologyRefs = await insertTestRows(conn, patientId, added);
            if (before.BookingStatus === 'advance_booked') {
                pathologyRefs = [];          // queue + samples are created when the patient arrives
            } else {
                const [[em]] = await conn.query('SELECT COALESCE(MAX(IsEmergency),0) AS e FROM PatientQueue WHERE PatientId = ?', [patientId]);
                await createQueueItemsForPatient(conn, patientId, added, doctorId, em && em.e == 1);
            }
        }

        // Sub-tests have no dependents → replace
        await conn.query('DELETE FROM PatientSubTestRefference WHERE PatientId = ?', [patientId]);
        await insertSubRows(conn, patientId, bill.subs);

        // ── Patient row ──
        // FIX: AdvancePaid was never updated when an advance booking was edited
        const advancePaid = before.BookingStatus === 'advance_booked' ? pay.kept : num(before.AdvancePaid);
        await conn.query(`
            UPDATE PatientDetails SET
                Title=?, Name=?, Age=?, YMD=?, Gender=?, PhoneNumber=?, Address=?,
                GrossAmount=?, Discount=?, DiscountApprovedBy=?, ActualAmount=?,
                CashPayment=?, OnlinePayment=?, DuesAmount=?, ChangeToReturn=?, AdvancePaid=?,
                ClinicId=?, DoctorId=?, UpdatedBy=?, UpdatedOn=CURDATE()
            WHERE Id=?`,
            [
                str(body.title), cleanName(body.patientName), parseInt(body.age, 10), str(body.ymd), str(body.gender),
                str(body.phoneNumber), str(body.patientAddress),
                bill.gross, bill.discount, str(body.discountApprovedBy), bill.net,
                pay.cash, pay.online, pay.dues, pay.change, advancePaid,
                clinicId, doctorId, updatedBy, patientId,
            ]
        );

        // ── History + audit ──
        await conn.query(`
            INSERT INTO ${await historyTable(conn)} 
                (PatientId,Title,Name,Age,YMD,Gender,PhoneNumber,Address,
                 ActualAmount,GrossAmount,Discount,DiscountApprovedBy,
                 ClinicId,DoctorId,CashPayment,OnlinePayment,DuesAmount,
                 Status,ModifiedBy,ChangeType,CreatedAt)
            SELECT Id,Title,Name,Age,YMD,Gender,PhoneNumber,Address,
                   ActualAmount,GrossAmount,Discount,DiscountApprovedBy,
                   ClinicId,DoctorId,CashPayment,OnlinePayment,DuesAmount,
                   Status,?,'update',NOW()
            FROM PatientDetails WHERE Id=?`, [updatedBy, patientId]);

        let newDoctorName = before.DoctorName, newClinicName = before.ClinicName;
        if (String(doctorId) !== String(before.DoctorId)) {
            const [[d]] = await conn.query("SELECT CONCAT(FirstName,' ',LastName) AS Name FROM DoctorDetails WHERE Id=?", [doctorId]);
            newDoctorName = d ? d.Name : doctorId;
        }
        if (String(clinicId) !== String(before.ClinicId)) {
            const [[c]] = await conn.query('SELECT Name FROM Clinics WHERE Id=?', [clinicId]);
            newClinicName = c ? c.Name : clinicId;
        }

        // ── Audit event (signed; replaces the old unsigned PatientAuditLog rows) ──
        const ev = PatientAudit.event(conn, { patientId, action: 'EDIT', actorId: updatedBy, ip, userAgent,
                                              reason: editReason, authorisedAs: guard.usedPermission ? 'editBillAfterTest' : null });
        const G = { 1: 'Male', 2: 'Female', 3: 'Other' };
        ev.change('info',    'Title',            'Title',         before.Title,        str(body.title));
        ev.change('info',    'Patient Name',     'Name',          before.Name,         cleanName(body.patientName));
        ev.change('info',    'Age',              'Age',           `${before.Age} ${before.YMD}`, `${parseInt(body.age, 10)} ${str(body.ymd)}`);
        ev.change('info',    'Gender',           'Gender',        G[before.Gender] || before.Gender, G[str(body.gender)] || str(body.gender));
        ev.change('info',    'Phone Number',     'PhoneNumber',   before.PhoneNumber,  str(body.phoneNumber));
        ev.change('info',    'Address',          'Address',       before.Address,      str(body.patientAddress));
        if (doctorChanged) ev.add('doctor', 'Referring Doctor', 'DoctorId', before.DoctorName || before.DoctorId || '—', newDoctorName || doctorId);
        if (clinicChanged) ev.add('clinic', 'Clinic',           'ClinicId', before.ClinicName || before.ClinicId || '—', newClinicName || clinicId);
        removed.forEach(r => {
            const st = stateByRef.get(Number(r.Id)) || {};
            ev.testRemoved(r.TestName, st.price, st.started ? 'patient had entered room' : '');
        });
        added.forEach(t => ev.testAdded(t.TestName, t.Price));
        removedSubs.forEach(s => ev.subTestRemoved(s.Name, round2(num(s.Price))));
        addedSubs.forEach(s => ev.subTestAdded(s.Name, s.Price));
        kept.forEach(t => {
            const oldDisc = round2(num(oldById.get(t.TestId).Discount));
            if (oldDisc !== t.Discount) ev.add('payment', `Discount — ${t.TestName}`, 'TestDiscount', `₹${oldDisc}`, `₹${t.Discount}`);
        });
        const rupee = (v) => `₹${round2(v)}`;
        ev.change('payment', 'Gross Amount',     'GrossAmount',   rupee(before.GrossAmount),   rupee(bill.gross));
        ev.change('payment', 'Discount',         'Discount',      rupee(before.Discount),      rupee(bill.discount));
        ev.change('payment', 'Net Amount',       'ActualAmount',  rupee(before.ActualAmount),  rupee(bill.net));
        ev.change('payment', 'Cash Payment',     'CashPayment',   rupee(before.CashPayment),   rupee(pay.cash));
        ev.change('payment', 'Change Returned',  'ChangeToReturn',rupee(before.ChangeToReturn),rupee(pay.change));
        ev.change('payment', 'Online Payment',   'OnlinePayment', rupee(before.OnlinePayment), rupee(pay.online));
        ev.change('payment', 'Dues',             'DuesAmount',    rupee(before.DuesAmount),    rupee(pay.dues));
        ev.change('payment', 'Discount Approved By', 'DiscountApprovedBy', before.DiscountApprovedBy, str(body.discountApprovedBy));

        // ── Money trail for payment corrections (was missing → cash reports didn't tally) ──
        const cashDelta   = round2(pay.cash   - num(before.CashPayment));
        const onlineDelta = round2(pay.online - num(before.OnlinePayment));
        if (cashDelta > 0)   await writeTx(conn, { userId: updatedBy, patientId, type: 'payment', cash: cashDelta, note: 'Cash added on edit' });
        if (cashDelta < 0)   await writeTx(conn, { userId: updatedBy, patientId, type: 'refund',  debit: -cashDelta, mode: 'cash', note: 'Cash reduced on edit' });
        if (onlineDelta > 0) await writeTx(conn, { userId: updatedBy, patientId, type: 'payment', online: onlineDelta, sourceId: pay.onlineSourceId, note: 'Online added on edit' });
        if (onlineDelta < 0) await writeTx(conn, { userId: updatedBy, patientId, type: 'refund',  debit: -onlineDelta, mode: 'online', note: 'Online reduced on edit' });
        // change handed back is cash leaving the drawer — was not recorded on edit before
        const changeDelta = round2(pay.change - num(before.ChangeToReturn));
        if (changeDelta > 0) await writeTx(conn, { userId: updatedBy, patientId, type: 'change_returned', debit: changeDelta, mode: 'cash', note: `Change returned ₹${changeDelta} (edit)` });
        if (changeDelta < 0) await writeTx(conn, { userId: updatedBy, patientId, type: 'payment', cash: -changeDelta, note: `Change not needed any more ₹${-changeDelta} (edit)` });
        const netCashDelta = round2(cashDelta - changeDelta);

        if (netCashDelta !== 0 || onlineDelta !== 0) {
            await conn.query(`
                INSERT INTO DailySettlement (SettlementDate,UserId,CashCollected,OnlineCollected,NetCash,NetOnline,TotalPatients,TotalToHandOver,Status)
                VALUES (CURDATE(),?,?,?,?,?,0,?,'open')
                ON DUPLICATE KEY UPDATE
                    CashCollected=CashCollected+VALUES(CashCollected),
                    OnlineCollected=OnlineCollected+VALUES(OnlineCollected),
                    NetCash=NetCash+VALUES(NetCash),
                    NetOnline=NetOnline+VALUES(NetOnline),
                    TotalToHandOver=TotalToHandOver+VALUES(TotalToHandOver)`,
                [updatedBy, cashDelta, onlineDelta, netCashDelta, onlineDelta, netCashDelta]);
        }

        // ── Commission: recalculated for the new tests; old doctor reversed if changed ──
        if (before.DoctorId && String(before.DoctorId) !== String(doctorId)) {
            await reverseReferral(conn, { patientId, doctorId: before.DoctorId, reversedBy: updatedBy, reversalReason: 'Referring doctor changed on edit' });
        }
        const referral = await processReferral(conn, {
            doctorId, patientId, registeredBy: updatedBy,
            testIds: bill.tests.map(t => t.TestId), subTests: bill.subs, bill,
        });

        let auditSaved = null;
        if (ev.changeCount) {
            ev.setMoney(moneyBefore, moneyAfter)
              .setExtra({ thanksAfter: referral && referral.thanks, quickFix: guard.quickFix, billLocked: guard.locked, usedPermission: guard.usedPermission,
                          receiptsPrinted: auditCtx.receipt.count, minutesSinceReg: auditCtx.minutesSinceReg })
              .setRisk(PatientAudit.evaluateRisk('EDIT', {
                  before: moneyBefore, after: moneyAfter, ctx: auditCtx, actorId: updatedBy,
                  removedTests: removedInfo, removedSubs: removedSubs.map(s => ({ name: s.Name })), doctorChanged, guard,
              }));
            auditSaved = await ev.save();
        }

        await conn.commit();

        const failed = await createSpecimensAfterCommit(pathologyRefs, updatedBy, ip, userAgent);
        const warnings = [];
        if (pay.newChange > 0) warnings.push(`Hand back ₹${pay.newChange} to the patient.`);
        if (pay.dues > num(before.DuesAmount) + 0.005) warnings.push(`Collect ₹${round2(pay.dues - num(before.DuesAmount))} more from the patient (dues now ₹${pay.dues}).`);
        if (failed.length) warnings.push('Sample collection entries could not be created for the newly added pathology tests.');
        if (auditSaved && guard.reductions.length && auditCtx.receipt.count > 0)
            warnings.push('Bill changed after the receipt was printed — print a new receipt and take the old one back from the patient.');
        // Thanks recorded for the OLD doctor stays on the bill — the person who received it must return it
        if (doctorChanged && before.ThanksGivenTo && num(before.ThanksAmount) > 0)
            warnings.push(`Thanks of ₹${round2(num(before.ThanksAmount))} was already given to ${before.ThanksGivenTo} for the old doctor. Recover it and correct the thanks entry.`);

        return {
            success: true, patientId, referral, warnings,
            changesCount: ev.changeCount,
            audit: auditSaved,
            message: ev.changeCount
                ? `Patient ${cleanName(body.patientName)} updated (${ev.changeCount} change${ev.changeCount > 1 ? 's' : ''}).`
                : 'No changes were made.',
        };
    } catch (err) {
        await conn.rollback().catch(() => {});
        if (err.isUserError) return fail(err.userMessages);
        log.error('updatePatientDetails error:', err.code || '', err.message);
        return fail([friendlyDbMessage(err, 'Update')]);
    } finally {
        conn.release();
    }
};


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6 — CANCEL PATIENT
// ─────────────────────────────────────────────────────────────────────────────

const cancelPatient = async ({ patientId, cancelledBy, cancelReason, path, ip = null, userAgent = null }) => {
    if (!isPositiveInt(patientId)) return { success: false, message: 'Invalid patient ID.' };
    if (!cancelledBy)              return { success: false, message: 'Session expired. Please login again.' };

    const conn = await getConnection();
    try {
        await conn.beginTransaction();

        const [[patient]] = await conn.query(
            'SELECT * FROM PatientDetails WHERE Id = ? FOR UPDATE',
            [patientId]
        );
        if (!patient || Number(patient.Status) === 0) {
            await conn.rollback();
            return { success: false, message: 'Patient not found or already cancelled.' };
        }

        // S6: checked AFTER the row is locked. Before, it ran first — a report marked ready (or thanks
        // paid) between the check and the cancel let a normal user cancel + refund a done test.
        const auth = await checkCancelAuthorisation(patientId, cancelledBy, path, conn);
        if (!auth.allowed) {
            await conn.rollback();
            return { success: false, message: auth.message, authError: true };
        }

        // BUG FIX: CashPayment is the cash handed over (incl. change already given back).
        // Refunding it in full returned the change twice.
        const cashRefund   = round2(Math.max(0, num(patient.CashPayment) - num(patient.ChangeToReturn)));
        const onlineRefund = round2(num(patient.OnlinePayment));
        const refundAmount = round2(cashRefund + onlineRefund);
        const shiftDate    = moment().format('YYYY-MM-DD');
        const reason       = str(cancelReason) || 'No reason given';
        const auditCtx     = await PatientAudit.loadContext(conn, patientId);   // before anything changes
        const moneyBefore  = PatientAudit.moneyFromRow(patient);

        await conn.query(`
            UPDATE PatientDetails SET Status=0, BookingStatus='cancelled',
                CancelledAt=NOW(), CancelledBy=?, CancelReason=?, UpdatedBy=?, UpdatedOn=CURDATE()
            WHERE Id=?
        `, [cancelledBy, reason, cancelledBy, patientId]);

        if (patient.DoctorId) {
            await reverseReferral(conn, { patientId, doctorId: patient.DoctorId, reversedBy: cancelledBy, reversalReason: reason });
        }

        // S6: a cancelled patient stayed in the technician's waiting list (room screens kept calling him)
        const cancelWarnings = [];
        try {
            await conn.query(`
                UPDATE PatientTestRefference SET QueueItemId = NULL
                WHERE PatientId = ? AND QueueItemId IN (
                    SELECT Id FROM PatientQueue WHERE PatientId = ? AND Status = 'Waiting' AND EntryTime IS NULL)`, [patientId, patientId]);
            await conn.query("DELETE FROM PatientQueue WHERE PatientId = ? AND Status = 'Waiting' AND EntryTime IS NULL", [patientId]);
        } catch (e) {
            log.error('cancelPatient queue cleanup:', e.code || '', e.message);
            cancelWarnings.push('Remove this patient from the room queue by hand — the waiting entry could not be removed automatically.');
        }

        if (refundAmount > 0) {
            const note = `Refund on cancellation — ${reason}`;
            if (cashRefund > 0)   await writeTx(conn, { userId: cancelledBy, patientId, type: 'refund', debit: cashRefund,   mode: 'cash',   shiftDate, note });
            if (onlineRefund > 0) await writeTx(conn, { userId: cancelledBy, patientId, type: 'refund', debit: onlineRefund, mode: 'online', shiftDate, note: note + ' (online)' });

            await conn.query(`
                INSERT INTO DailySettlement (SettlementDate,UserId,CashRefunded,NetCash,NetOnline,Cancellations,TotalToHandOver,Status)
                VALUES (?,?,?,?,?,1,?,'open')
                ON DUPLICATE KEY UPDATE
                    CashRefunded=CashRefunded+VALUES(CashRefunded),
                    NetCash=NetCash+VALUES(NetCash),
                    NetOnline=NetOnline+VALUES(NetOnline),
                    Cancellations=Cancellations+1,
                    TotalToHandOver=TotalToHandOver+VALUES(TotalToHandOver)
            `, [shiftDate, cancelledBy, cashRefund, -cashRefund, -onlineRefund, -cashRefund]);
        }

        await conn.query(`
            INSERT INTO ${await historyTable(conn)} 
                (PatientId,Title,Name,Age,YMD,Gender,PhoneNumber,Address,
                 ActualAmount,GrossAmount,Discount,DiscountApprovedBy,
                 ClinicId,DoctorId,CashPayment,OnlinePayment,DuesAmount,Status,CancelReason,ModifiedBy,ChangeType)
            SELECT Id,Title,Name,Age,YMD,Gender,PhoneNumber,Address,
                   ActualAmount,GrossAmount,Discount,DiscountApprovedBy,
                   ClinicId,DoctorId,CashPayment,OnlinePayment,DuesAmount,0,?,?,'delete'
            FROM PatientDetails WHERE Id=?
        `, [reason, cancelledBy, patientId]);

        {
            const ev = PatientAudit.event(conn, { patientId, action: 'CANCEL', actorId: cancelledBy, ip, userAgent,
                                                  reason, authorisedAs: auth.reason });
            ev.add('cancel', 'Status', 'Status', 'Active', 'Cancelled');
            if (cashRefund > 0)   ev.add('cancel', 'Cash Refund',   'CashRefund',   '—', `₹${cashRefund}`);
            if (onlineRefund > 0) ev.add('cancel', 'Online Refund', 'OnlineRefund', '—', `₹${onlineRefund}`);
            auditCtx.tests.forEach(t => ev.add('tests', 'Test Cancelled', 'TestCancelled', `${t.name}${t.delivered ? ' [delivered]' : t.reported ? ' [reported]' : t.done ? ' [done]' : t.started ? ' [in room]' : ''}`, '—'));
            if (auth.info && auth.info.thanksPaid)
                ev.add('cancel', 'Thanks to recover', 'ThanksOnCancel', `${patient.ThanksGivenTo} / ₹${round2(num(patient.ThanksAmount))}`, 'to recover');
            ev.setMoney(moneyBefore, PatientAudit.money({ gross: moneyBefore.gross, discount: moneyBefore.discount, net: moneyBefore.net }))
              .setExtra({ refund: refundAmount, cashRefund, onlineRefund, crossDay: auditCtx.crossDay, receiptsPrinted: auditCtx.receipt.count })
              .setRisk(PatientAudit.evaluateRisk('CANCEL', { ctx: auditCtx, actorId: cancelledBy, refund: refundAmount }));
            await ev.save();
        }

        await conn.commit();
        return {
            success:      true,
            message:      refundAmount > 0
                ? (auth.info && auth.info.crossDay
                    ? `Patient ${patient.Name} cancelled. Refund ₹${refundAmount.toFixed(2)} is deducted from today's collection.`
                    : `Patient ${patient.Name} cancelled. ₹${refundAmount.toFixed(2)} removed from today's collection.`)
                : `Patient ${patient.Name} cancelled.`,
            warnings:     [...(auth.info && auth.info.thanksWarning ? [auth.info.thanksWarning] : []), ...cancelWarnings],
            refundAmount,
        };

    } catch (err) {
        await conn.rollback().catch(() => {});
        if (err.isUserError) return { success: false, message: err.userMessages.join(' ') };
        log.error('cancelPatient error:', err.code || '', err.message);
        return { success: false, message: friendlyDbMessage(err, 'Cancellation') };   // S6: no raw SQL errors on screen
    } finally {
        conn.release();
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7 — DUES & PAYMENTS
// ─────────────────────────────────────────────────────────────────────────────

const getDuesPatientListWithDoctorDetails = async () => {
    const [rows] = await db().query(`
        SELECT PD.Id, PD.Title, PD.Name, PD.Age, PD.YMD, PD.Gender, PD.PhoneNumber,
               PD.ActualAmount, PD.GrossAmount,
               DATE_FORMAT(PD.RegisteredOn, '%d-%m-%y') AS RegisteredOn,
               PD.DuesAmount,
               DD.FirstName AS DoctorFirstName, DD.LastName AS DoctorLastName,
               DD.Degree1, DD.Degree2, DD.Degree3, DD.Degree4, DD.SpecialistIn,
               GROUP_CONCAT(DISTINCT MT.TestName ORDER BY MT.TestName SEPARATOR ', ') AS TestNames
        FROM PatientDetails PD
        INNER JOIN DoctorDetails DD ON PD.DoctorId = DD.Id
        LEFT JOIN PatientTestRefference PTR ON PD.Id = PTR.PatientId
        LEFT JOIN MainTestTable MT ON PTR.TestId = MT.Id
        WHERE PD.DuesAmount > 0 AND PD.Status = 1
        GROUP BY PD.Id ORDER BY PD.Id DESC
    `);
    return rows;
};

/**
 * Legacy dues modal.
 * S7: used to (1) read the bill OUTSIDE the transaction and write absolute totals back (lost update
 * with a parallel collection), (2) insert TransactionTable rows without TransactionType / PaymentMode /
 * ShiftDate (invisible in the daily cash report), (3) skip DailySettlement. Now it is collectDues.
 * The extra parameters are ignored and kept only so old callers don't break.
 */
const updateDuesAmount = async (req, patientId /*, updatedCash, updatedOnline, remainingDues, RegisteredOn */) => {
    const result = await collectDues({
        patientId:      toId(patientId),
        cashAmount:     req.body.cashPayment,
        onlineAmount:   req.body.onlinePayment,
        onlineSourceId: req.body.onlinePaymentMethod || req.body.onlineSourceId,
        collectedBy:    req.user.Id,
        notes:          'Dues received (old screen)',
        ip:             req.ip,
        userAgent:      req.headers && req.headers['user-agent'],
        requireSource:  false,          // the old modal has no bank/UPI picker
    });
    if (!result.success) throw userError(result.message);
    return result.message;
};

const updateAmountInPatientDetailsTable = async (conn, cashPayment, onlinePayment, remainingDues, currDate, currTime, userId, patientId) => {
    await conn.execute(`
        UPDATE PatientDetails SET CashPayment=?, OnlinePayment=?, DuesAmount=?, UpdatedOn=?, UpdateTime=?, UpdatedBy=?
        WHERE Id=?
    `, [cashPayment, onlinePayment, remainingDues, currDate, currTime, userId, patientId]);
};

const updateDailyDuesReceived = async (conn, patientId, userId, currDate, cashPayment, onlinePayment) => {
    await conn.execute(
        'INSERT INTO DailyDuesReceived SET PatientId=?, DuesReceivedBy=?, ReceivedOn=?, CashPayment=?, OnlinePayment=?',
        [patientId, userId, currDate, cashPayment, onlinePayment]
    );
};

const updateTransactionTable = async (conn, userId, cashPayment, onlinePayment, creditedAmount, patientId, currDate) => {
    await conn.query('INSERT INTO TransactionTable SET ?', [{
        UserId:       userId,
        PatientId:    patientId,
        CreditCash:   cashPayment,
        CreditOnline: onlinePayment,
        Debit:        creditedAmount,
        TransactedOn: currDate,
    }]);
};

/**
 * FIX: Was using callback-based dbConnection.connection.execute inside a
 * Promise constructor — throwing inside a callback does NOT reject the Promise.
 * Rewrote as async/await.
 */
const getDailyDuesReceivedData = async (req) => {
    let fromDate, toDate;

    if (!req.body.FromDate || req.body.FromDate === '') {
        fromDate = currDateAndTime.getCurrentDateAndTime()[0];
        toDate   = currDateAndTime.getCurrentDateAndTime()[0];
    } else {
        fromDate = currDateAndTime.parseDate(req.body.FromDate);
        toDate   = currDateAndTime.parseDate(req.body.ToDate);
    }

    const [rows] = await db().execute(`
        SELECT DDR.PatientId, DDR.DuesReceivedBy, U.FirstName AS FName, U.LastName AS LName,
               DATE_FORMAT(DDR.ReceivedOn, '%d-%m-%y') AS ReceivedOn,
               DDR.CashPayment, DDR.OnlinePayment,
               PD.title, PD.Name,
               DATE_FORMAT(PD.RegisteredOn, '%d-%m-%y') AS RegisteredOn,
               PD.DoctorId, DD.FirstName, DD.LastName
        FROM PatientDetails PD
        JOIN DoctorDetails DD ON DD.Id = PD.DoctorId
        JOIN DailyDuesReceived DDR ON DDR.PatientId = PD.Id
        JOIN Users U ON U.Id = DDR.DuesReceivedBy
        WHERE DDR.ReceivedOn BETWEEN ? AND ?
    `, [fromDate, toDate]);
    return rows;
};

/**
 * FIX: Was using dbConnection.query callback style (incorrect — dbConnection has no .query method directly).
 * Now uses pool.promise() correctly.
 */
const getOnlinePaymentSources = async () => {
    const [rows] = await db().query(
        'SELECT Id, Name, ShortCode FROM OnlinePaymentSources WHERE IsActive = 1 ORDER BY SortOrder ASC'
    );
    return rows;
};

const searchPatientsWithDues = async (body) => {
    try {
        const from = dmyOrToday(body?.FromDate);   // FIX: 'Invalid date' went into SQL
        const to   = dmyOrToday(body?.ToDate);

        const where  = ['pd.Status = 1', 'pd.DuesAmount > 0'];
        const params = [];

        where.push(`(
            (pd.IsAdvanceBooking = 0 AND pd.RegisteredOn BETWEEN ? AND ?)
            OR (pd.IsAdvanceBooking = 1 AND pd.BookingStatus = 'advance_booked' AND pd.AdvanceBookingDate BETWEEN ? AND ?)
            OR (pd.IsAdvanceBooking = 0 AND pd.BookingStatus = 'arrived' AND DATE(pd.UpdatedOn) BETWEEN ? AND ?)
        )`);
        params.push(from, to, from, to, from, to);

        if (body?.BillNo)  { where.push('pd.Id = ?');          params.push(body.BillNo); }
        if (body?.Name)    { where.push('pd.Name LIKE ?');      params.push(`%${body.Name}%`); }
        if (body?.Doctor)  { where.push('pd.DoctorId = ?');     params.push(body.Doctor); }

        const [rows] = await db().execute(`
            SELECT pd.Id AS PatientId, pd.Title, pd.Name, pd.PhoneNumber,
                   pd.GrossAmount, pd.ActualAmount, pd.CashPayment, pd.OnlinePayment,
                   pd.DuesAmount, pd.IsAdvanceBooking, pd.BookingStatus,
                   DATE_FORMAT(pd.RegisteredOn,       '%d-%m-%Y') AS RegisteredOn,
                   DATE_FORMAT(pd.AdvanceBookingDate, '%d-%m-%Y') AS AdvanceBookingDate,
                   d.FirstName AS DoctorFirstName, d.LastName AS DoctorLastName,
                   GROUP_CONCAT(m.TestName ORDER BY m.TestName SEPARATOR ', ') AS TestNames
            FROM PatientDetails pd
            INNER JOIN DoctorDetails d ON d.Id = pd.DoctorId
            LEFT  JOIN PatientTestRefference ptr ON ptr.PatientId = pd.Id
            LEFT  JOIN MainTestTable m ON m.Id = ptr.TestId
            WHERE ${where.join(' AND ')}
            GROUP BY pd.Id ORDER BY pd.DuesAmount DESC
        `, params);
        return { success: true, patients: rows };

    } catch (err) {
        log.error('searchPatientsWithDues:', err.message);
        return { success: false, message: 'Search failed. Please try again.', patients: [] };
    }
};

/**
 * FIX: Removed console.log(mysql.format + full row objects) — PII leak + log noise.
 */
/**
 * Collect (part of) the dues.
 *   markArrival   — true only from "Mark arrived". FIX S4: paying the balance of an advance booking
 *                   two days early used to mark the patient arrived and push his tests into TODAY's queue.
 *   requestToken  — optional one-time token from the dues modal (double-click proof).
 *   requireSource — online money must say which bank / UPI it went to (false only for the old modal).
 */
const DUPLICATE_WINDOW_SECONDS = 20;

const collectDues = async ({ patientId, cashAmount, onlineAmount, onlineSourceId, collectedBy, notes, ip = null, userAgent = null,
                             markArrival = false, requestToken = null, requireSource = true }) => {
    const auditMeta = { ip, userAgent };
    if (!isPositiveInt(patientId)) return { success: false, message: 'Invalid patient.' };
    if (!collectedBy)              return { success: false, message: 'Your session has expired. Please log in again.' };

    // S4: strict amounts. Before: cash -100 + online 200 = "₹100 collected", dues −100,
    // CashPayment silently reduced by ₹100 with no refund entry → ₹100 could leave the drawer unseen.
    let cash, online;
    try {
        cash   = parseMoney(cashAmount,   'Cash amount');
        online = parseMoney(onlineAmount, 'Online amount');
    } catch (e) { return { success: false, message: e.userMessages.join(' ') }; }
    const total = round2(cash + online);
    if (total <= 0) return { success: false, message: 'Enter an amount to collect.' };
    const srcId = toId(onlineSourceId);

    const conn = await getConnection();
    try {
        await conn.beginTransaction();

        const claim = await claimToken(conn, 'dues', requestToken, collectedBy);
        if (!claim.claimed) { await conn.rollback(); return { success: false, duplicate: true, message: 'This payment was already recorded (button pressed twice).' }; }

        const [[patient]] = await conn.query(
            'SELECT * FROM PatientDetails WHERE Id = ? FOR UPDATE',
            [patientId]
        );
        if (!patient) {
            await conn.rollback();
            return { success: false, message: 'Patient not found.' };
        }
        if (Number(patient.Status) === 0) {
            await conn.rollback();
            return { success: false, message: 'This patient is cancelled.' };
        }

        if (online > 0) {
            if (!srcId && requireSource) { await conn.rollback(); return { success: false, message: 'Select the bank / UPI source for the online amount.' }; }
            if (srcId) {
                const [src] = await conn.query('SELECT Id FROM OnlinePaymentSources WHERE Id = ? AND IsActive = 1 LIMIT 1', [srcId]);
                if (!src.length) { await conn.rollback(); return { success: false, message: 'The selected bank / UPI source does not exist.' }; }
            }
        }

        const currentDues = round2(num(patient.DuesAmount));
        if (total > currentDues) { await conn.rollback(); return { success: false, message: `Amount ₹${total} exceeds outstanding dues ₹${currentDues}.` }; }

        // S4: without a token from the screen, the same amount by the same user for the same patient
        // within a few seconds is treated as a double click.
        if (claim.skipped) {
            const [[recent]] = await conn.query(`
                SELECT Id FROM TransactionTable
                WHERE PatientId = ? AND UserId = ? AND TransactionType = 'balance_collected'
                  AND ((? > 0 AND CreditCash = ?) OR (? > 0 AND CreditOnline = ?))
                  AND TransactedOn >= NOW() - INTERVAL ${DUPLICATE_WINDOW_SECONDS} SECOND
                LIMIT 1`, [patientId, collectedBy, cash, cash, online, online]);
            if (recent) {
                await conn.rollback();
                return { success: false, duplicate: true, message: `The same amount was recorded for this patient a few seconds ago. If this really is a second payment, wait ${DUPLICATE_WINDOW_SECONDS} seconds and try again.` };
            }
        }

        if (markArrival && patient.BookingStatus !== 'advance_booked') {
            await conn.rollback();
            return { success: false, message: `Patient is already ${patient.BookingStatus}.` };
        }

        const newDues          = round2(currentDues - total);
        const today            = moment().format('YYYY-MM-DD');
        const shiftDate        = today;
        const isSameDay        = moment(patient.RegisteredOn).format('YYYY-MM-DD') === today;
        const isAdvanceArrival = !!markArrival && patient.IsAdvanceBooking == 1 && patient.BookingStatus === 'advance_booked';
        const newBookingStatus = isAdvanceArrival ? 'arrived' : patient.BookingStatus;

        // FIX: balance paid BEFORE the appointment day is advance money too — AdvancePaid stayed at the
        // first payment, so the "advance collected" figures in the reports were short.
        const advanceAdd = (!isAdvanceArrival && patient.BookingStatus === 'advance_booked') ? total : 0;
        await conn.query(`
            UPDATE PatientDetails SET DuesAmount=?, CashPayment=CashPayment+?, OnlinePayment=OnlinePayment+?,
                AdvancePaid=COALESCE(AdvancePaid,0)+?,
                BookingStatus=?, IsAdvanceBooking=CASE WHEN ?=1 THEN 0 ELSE IsAdvanceBooking END,
                UpdatedBy=?, UpdatedOn=CURDATE(), UpdateTime=NOW()
            WHERE Id=?
        `, [newDues, cash, online, advanceAdd, newBookingStatus, isAdvanceArrival ? 1 : 0, collectedBy, patientId]);

        const txNote = notes || (isAdvanceArrival ? 'Balance on arrival' : isSameDay ? 'Same-day dues' : 'Cross-day dues');

        if (cash > 0)   await conn.query('INSERT INTO TransactionTable (UserId,PatientId,TransactionType,CreditCash,CreditOnline,Debit,PaymentMode,OnlineSourceId,ShiftDate,Notes,TransactedOn) VALUES (?,?,\'balance_collected\',?,0,0,\'cash\',NULL,?,?,NOW())', [collectedBy, patientId, cash, shiftDate, txNote]);
        if (online > 0) await conn.query('INSERT INTO TransactionTable (UserId,PatientId,TransactionType,CreditCash,CreditOnline,Debit,PaymentMode,OnlineSourceId,ShiftDate,Notes,TransactedOn) VALUES (?,?,\'balance_collected\',0,?,0,\'online\',?,?,?,NOW())', [collectedBy, patientId, online, srcId || null, shiftDate, txNote]);

        if (!isSameDay) {
            if (cash > 0)   await conn.query('INSERT INTO DuesCollectionLog (PatientId,AmountCollected,PaymentMode,OnlineSourceId,CollectedBy,CollectedAt,ShiftDate,Notes) VALUES (?,?,\'cash\',NULL,?,NOW(),?,?)', [patientId, cash, collectedBy, shiftDate, txNote]);
            if (online > 0) await conn.query('INSERT INTO DuesCollectionLog (PatientId,AmountCollected,PaymentMode,OnlineSourceId,CollectedBy,CollectedAt,ShiftDate,Notes) VALUES (?,?,\'online\',?,?,NOW(),?,?)', [patientId, online, srcId || null, collectedBy, shiftDate, txNote]);
        }

        await conn.query(`
            INSERT INTO DailySettlement (SettlementDate,UserId,CashCollected,OnlineCollected,NetCash,NetOnline,BalanceCollected,TotalToHandOver,Status)
            VALUES (?,?,?,?,?,?,?,?,'open')
            ON DUPLICATE KEY UPDATE
                CashCollected=CashCollected+VALUES(CashCollected), OnlineCollected=OnlineCollected+VALUES(OnlineCollected),
                NetCash=NetCash+VALUES(NetCash), NetOnline=NetOnline+VALUES(NetOnline),
                BalanceCollected=BalanceCollected+VALUES(BalanceCollected), TotalToHandOver=TotalToHandOver+VALUES(TotalToHandOver)
        `, [shiftDate, collectedBy, cash, online, cash, online, total, cash]);

        {
            const mb = PatientAudit.moneyFromRow(patient);
            const ma = PatientAudit.money({ ...mb, cash: mb.cash + cash, online: mb.online + online, dues: newDues });
            const ev = PatientAudit.event(conn, { patientId, action: isAdvanceArrival ? 'ARRIVED' : 'DUES_COLLECT', actorId: collectedBy,
                                                  ip: auditMeta.ip, userAgent: auditMeta.userAgent, reason: txNote });
            ev.add('payment', 'Dues', 'DuesAmount', `₹${round2(currentDues)}`, `₹${round2(newDues)}`);
            if (cash > 0)   ev.add('payment', 'Cash Collected',   'CashCollected',   '—', `₹${round2(cash)}`);
            if (online > 0) ev.add('payment', 'Online Collected', 'OnlineCollected', '—', `₹${round2(online)}`);
            if (isAdvanceArrival) ev.add('info', 'Booking Status', 'BookingStatus', 'advance_booked', 'arrived');
            ev.setMoney(mb, ma).setExtra({ onlineSourceId: srcId || null, sameDay: isSameDay, sourceMissing: online > 0 && !srcId });
            await ev.save();
        }

        const arrivalRefs = isAdvanceArrival ? await enqueueOnArrival(conn, patientId) : [];
        await setTokenResult(conn, 'dues', requestToken, patientId, claim);

        await conn.commit();
        if (arrivalRefs.length) await createSpecimensAfterCommit(arrivalRefs, collectedBy);

        const message = isAdvanceArrival
            ? (newDues > 0 ? `${patient.Name} marked arrived. ₹${total} collected. Remaining: ₹${newDues}` : `${patient.Name} marked arrived. All dues cleared.`)
            : (newDues > 0 ? `₹${total} collected. Remaining dues: ₹${newDues}` : `₹${total} collected. All dues cleared for ${patient.Name}.`);

        return { success: true, message, newDues, isAdvanceArrival, bookingStatus: newBookingStatus, wasFullyCleared: newDues === 0 };

    } catch (err) {
        await conn.rollback().catch(() => {});
        if (err.isUserError) return { success: false, message: err.userMessages.join(' ') };
        log.error('collectDues:', err.code || '', err.message);
        return { success: false, message: friendlyDbMessage(err, 'Collection') };
    } finally {
        conn.release();
    }
};

const getPatientDuesDetail = async (patientId) => {
    try {
        const [[patient]] = await db().execute(`
            SELECT pd.Id AS PatientId, pd.Name, pd.PhoneNumber, pd.GrossAmount, pd.ActualAmount,
                   pd.DuesAmount, pd.CashPayment, pd.OnlinePayment, pd.IsAdvanceBooking, pd.BookingStatus,
                   DATE_FORMAT(pd.RegisteredOn, '%d-%m-%Y') AS RegisteredOn,
                   pd.RegisteredOn AS RegisteredOnRaw,
                   (
                       SELECT JSON_ARRAYAGG(JSON_OBJECT('amount',dl.AmountCollected,'mode',dl.PaymentMode,'collectedAt',DATE_FORMAT(dl.CollectedAt,'%d-%m-%Y %H:%i'),'collectedBy',u.FirstName))
                       FROM DuesCollectionLog dl JOIN Users u ON u.Id = dl.CollectedBy WHERE dl.PatientId = pd.Id
                   ) AS CollectionHistory
            FROM PatientDetails pd WHERE pd.Id = ?
        `, [patientId]);

        if (!patient) return { success: false, message: 'Patient not found.' };
        const h = patient.CollectionHistory;
        patient.CollectionHistory = !h ? [] : (typeof h === 'string' ? JSON.parse(h) : h);   // mysql2 may already parse JSON
        patient.isSameDay = moment(patient.RegisteredOnRaw).format('YYYY-MM-DD') === moment().format('YYYY-MM-DD');
        patient.requestToken = newFormToken();       // one-time token for the "collect" button of this modal
        return { success: true, patient };

    } catch (err) {
        log.error('getPatientDuesDetail:', err.message);
        return { success: false, message: 'Could not load the dues detail. Please try again.' };
    }
};

const getDuesReceived = async (body) => {
    try {
        const from = dmyOrToday(body?.FromDate);   // FIX: 'Invalid date' went into SQL
        const to   = dmyOrToday(body?.ToDate);

        const where  = ['DATE(dl.ShiftDate) BETWEEN ? AND ?'];
        const params = [from, to];

        if (body?.Name)        { where.push('pd.Name LIKE ?');       params.push(`%${body.Name}%`); }
        if (body?.CollectedBy) { where.push('dl.CollectedBy = ?');   params.push(body.CollectedBy); }

        // FIX: was `dbConnection.execute` (undefined) — now pool.promise().execute
        const [rows] = await db().execute(`
            SELECT dl.Id, dl.PatientId, dl.AmountCollected, dl.PaymentMode,
                   DATE_FORMAT(dl.ShiftDate,   '%d-%m-%Y')       AS ShiftDate,
                   DATE_FORMAT(dl.CollectedAt, '%d-%m-%Y %H:%i') AS CollectedAt,
                   pd.Name AS PatientName, pd.PhoneNumber, pd.GrossAmount, pd.IsAdvanceBooking,
                   DATE_FORMAT(pd.RegisteredOn, '%d-%m-%Y') AS RegisteredOn,
                   d.FirstName AS DoctorFirstName, d.LastName AS DoctorLastName, d.SpecialistIn AS DoctorSpecialistIn,
                   ops.Name AS OnlineSource, ops.ShortCode AS OnlineSourceCode,
                   dl.CollectedBy, CONCAT(u.FirstName,' ',u.LastName) AS CollectedByName
            FROM DuesCollectionLog dl
            JOIN PatientDetails        pd  ON pd.Id  = dl.PatientId
            JOIN DoctorDetails         d   ON d.Id   = pd.DoctorId
            JOIN Users                 u   ON u.Id   = dl.CollectedBy
            LEFT JOIN OnlinePaymentSources ops ON ops.Id = dl.OnlineSourceId
            WHERE ${where.join(' AND ')}
            ORDER BY dl.CollectedAt DESC
        `, params);
        return { success: true, duesReceived: rows };

    } catch (err) {
        log.error('getDuesReceived:', err.message);
        return { success: false, message: 'Search failed. Please try again.', duesReceived: [] };
    }
};

/**
 * FIX: Was using undefined `db.connection` — now uses dbConnection.connection correctly.
 */
/**
 * Advance-booked patient has come in.
 * • With a payment → collectDues() (records money, marks arrived, joins queue).
 * • Without a payment → marked arrived even if a balance is still due
 *   (FIX: before, a pending balance with ₹0 paid failed with "Enter an amount to collect").
 * Either way the tests now enter the queue and pathology samples are created.
 */
const markArrived = async ({ patientId, cashAmount, onlineAmount, onlineSourceId, collectedBy, ip = null, userAgent = null, requestToken = null }) => {
    if (!isPositiveInt(patientId)) return { success: false, message: 'Invalid patient.' };
    let cash, online;
    try {
        cash   = parseMoney(cashAmount,   'Cash amount');
        online = parseMoney(onlineAmount, 'Online amount');
    } catch (e) { return { success: false, message: e.userMessages.join(' ') }; }
    if (online > 0 && !toId(onlineSourceId)) return { success: false, message: 'Select the online payment source.' };

    if (cash + online > 0) {
        // booking status is re-checked inside collectDues while the row is locked
        return collectDues({ patientId, cashAmount: cash, onlineAmount: online, onlineSourceId: toId(onlineSourceId), collectedBy,
                             notes: 'Balance on arrival', ip, userAgent, markArrival: true, requestToken });
    }

    const conn = await getConnection();
    let refs = [];
    try {
        await conn.beginTransaction();
        const [[patient]] = await conn.query(
            'SELECT * FROM PatientDetails WHERE Id = ? FOR UPDATE', [patientId]);
        if (!patient)                               { await conn.rollback(); return { success: false, message: 'Patient not found.' }; }
        if (Number(patient.Status) === 0)           { await conn.rollback(); return { success: false, message: 'This patient is cancelled.' }; }
        if (patient.BookingStatus !== 'advance_booked') { await conn.rollback(); return { success: false, message: `Patient is already ${patient.BookingStatus}.` }; }

        await conn.query(`
            UPDATE PatientDetails SET BookingStatus='arrived', IsAdvanceBooking=0,
                UpdatedBy=?, UpdatedOn=CURDATE(), UpdateTime=NOW() WHERE Id=?`, [collectedBy, patientId]);
        refs = await enqueueOnArrival(conn, patientId);
        {
            const m  = PatientAudit.moneyFromRow(patient);
            const ev = PatientAudit.event(conn, { patientId, action: 'ARRIVED', actorId: collectedBy, ip, userAgent, reason: 'Arrived — no payment at arrival' });
            ev.add('info', 'Booking Status', 'BookingStatus', 'advance_booked', 'arrived');
            await ev.setMoney(m, m).save();
        }
        await conn.commit();

        if (refs.length) await createSpecimensAfterCommit(refs, collectedBy);
        const dues = num(patient.DuesAmount);
        return { success: true, message: dues > 0
            ? `${patient.Name} marked as arrived. ₹${dues} is still due.`
            : `${patient.Name} marked as arrived. No balance due.` };
    } catch (err) {
        await conn.rollback().catch(() => {});
        log.error('markArrived:', err.code || '', err.message);
        return { success: false, message: friendlyDbMessage(err, 'Mark arrived') };
    } finally {
        conn.release();
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8 — DELIVERABLES & QUEUE
// ─────────────────────────────────────────────────────────────────────────────

const setFilmOrReportCreatedStatus = async (patientTestRefId, userId, componentType) => {
    const [result] = await db().query(
        'UPDATE TestDeliverables SET IsGenerated=1, GeneratedBy=?, GeneratedOn=NOW() WHERE PatientTestReferenceId=? AND ComponentType=?',
        [userId, patientTestRefId, componentType]
    );
    return result;
};

const setFilmOrReportDeliveredStatus = async (patientTestRefId, userId, componentType) => {
    // FIX S9: a report could be marked delivered before it was generated, and delivered again
    const [result] = await db().query(
        'UPDATE TestDeliverables SET IsDelivered=1, DeliveredBy=?, DeliveredOn=NOW() WHERE PatientTestReferenceId=? AND ComponentType=? AND IsGenerated=1 AND IsDelivered=0',
        [userId, patientTestRefId, componentType]
    );
    return result;
};

const DELIVERABLE_TYPES = ['Report', 'Film'];
const DELIVER_WITH_DUES_SLUGS = ['/deliverWithDues', 'deliverWithDues'];

/**
 * S9: who owns this test line, and may it be handed over?
 * Returns { ok, message, patientId } — checks the line belongs to the patient in the form,
 * the component type is real, the patient is not cancelled, and (for delivery) no dues are pending
 * unless the user is admin or has the "deliverWithDues" function.
 */
const checkDeliverable = async ({ patientTestRefId, patientId, componentType, userId, forDelivery }) => {
    const refId = toId(patientTestRefId), pid = toId(patientId);
    if (!refId || !pid) return { ok: false, message: 'Required details are missing. Reload the page.' };
    if (!DELIVERABLE_TYPES.includes(str(componentType))) return { ok: false, message: 'Unknown item (only Report or Film).' };
    const [[row]] = await db().query(`
        SELECT ptr.PatientId, pd.Status, pd.DuesAmount, pd.BookingStatus
        FROM PatientTestRefference ptr JOIN PatientDetails pd ON pd.Id = ptr.PatientId
        WHERE ptr.Id = ? LIMIT 1`, [refId]);
    if (!row || Number(row.PatientId) !== pid) return { ok: false, message: 'This test does not belong to this patient.' };
    if (Number(row.Status) === 0)               return { ok: false, message: 'This patient is cancelled.' };
    if (forDelivery && num(row.DuesAmount) > 0) {
        const user = await loadUserForAuth(userId);
        const allowed = (user && user.isAdmin) || await userHasFunction(userId, { slugs: DELIVER_WITH_DUES_SLUGS });
        if (!allowed) return { ok: false, message: `₹${round2(num(row.DuesAmount))} dues are pending. Collect the dues before handing over the ${str(componentType).toLowerCase()}, or ask an authorised person.` };
    }
    return { ok: true, patientId: pid };
};

/**
 * S8: reporting-doctor logins (RoleId 2) only see patients of the referring doctors linked to them
 * (same rule as the patient list). Everyone else: any patient.
 */
const canUserAccessPatient = async (user, patientId) => {
    if (!user) return false;
    if (Number(user.RoleId) !== 2) return true;
    const pid = toId(patientId);
    if (!pid) return false;
    const [[row]] = await db().query(`
        SELECT 1 AS ok FROM PatientDetails p
        WHERE p.Id = ? AND (
            EXISTS (SELECT 1 FROM ReferDoctorReportingDoctor rr WHERE rr.ReferDoctorId = p.DoctorId AND rr.ReportingDoctorId = ?)
            OR NOT EXISTS (SELECT 1 FROM ReferDoctorReportingDoctor rr WHERE rr.ReferDoctorId = p.DoctorId)
        ) LIMIT 1`, [pid, user.Id]);
    return !!row;
};

/**
 * FIX: Removed console.log(mysql.format(...)) on every call — PII + log noise.
 */
const markDeliverableGenerated = async (patientTestRefId, componentType, generatedBy) => {
    const [result] = await db().query(`
        UPDATE TestDeliverables SET IsGenerated=1, GeneratedOn=NOW(), GeneratedBy=?
        WHERE PatientTestReferenceId=? AND ComponentType=? AND IsGenerated=0
    `, [generatedBy, patientTestRefId, componentType]);
    return result.affectedRows > 0;
};

const markDeliverableDelivered = async (patientTestRefId, componentType, deliveredBy, deliveredTo) => {
    if (!deliveredTo?.trim()) throw new Error('Please enter the name of the person collecting the ' + componentType);
    const [result] = await db().query(`
        UPDATE TestDeliverables SET IsDelivered=1, DeliveredOn=NOW(), DeliveredBy=?, DeliveredTo=?
        WHERE PatientTestReferenceId=? AND ComponentType=? AND IsGenerated=1 AND IsDelivered=0
    `, [deliveredBy, deliveredTo.trim(), patientTestRefId, componentType]);
    return result.affectedRows > 0;
};

const isPatientEneterdForTest = async (patientId) => {
    try {
        const [[row]] = await db().query(
            'SELECT EntryTime, ExitTime, Status, IsEmergency, ArrivalTime FROM PatientQueue WHERE PatientId=? LIMIT 1',
            [patientId]
        );
        if (!row) return { isEntered: false, isExited: false, isIncomplete: false, status: null, entryTime: null, exitTime: null, arrivalTime: null, isEmergency: false };
        return {
            isEntered:    row.EntryTime !== null,
            isExited:     row.ExitTime  !== null,
            isIncomplete: row.Status === 'Aborted',
            status:       row.Status,
            entryTime:    row.EntryTime   || null,
            exitTime:     row.ExitTime    || null,
            arrivalTime:  row.ArrivalTime || null,
            isEmergency:  row.IsEmergency == 1,
        };
    } catch (err) {
        log.error('isPatientEneterdForTest:', err.message);
        return { isEntered: false, isExited: false, isIncomplete: false, status: null, entryTime: null, exitTime: null, arrivalTime: null, isEmergency: false };
    }
};

const markTestsCompleted = async (patientId, testIds) => {
    const pid = toId(patientId);
    if (!pid) throw userError('Invalid patient.');
    testIds = (Array.isArray(testIds) ? testIds : [testIds]).map(toId).filter(Boolean);
    if (!testIds.length) throw userError('No tests selected.');
    if (testIds.length > 50) throw userError('Too many tests selected.');

    // FIX: tests of a cancelled patient, or of an advance booking that has not arrived, could be completed
    const [[p]] = await db().query('SELECT Status, BookingStatus FROM PatientDetails WHERE Id = ?', [pid]);
    if (!p)                                   throw userError('Patient not found.');
    if (Number(p.Status) === 0)               throw userError('This patient is cancelled.');
    if (p.BookingStatus === 'advance_booked') throw userError('This is an advance booking — mark the patient arrived first.');
    patientId = pid;

    const isEntered = await isPatientEneterdForTest(patientId);
    
   // if (!isEntered.isEntered) await PatientQueue.markEntry(patientId);
   if (!isEntered.isEntered) await PatientQueue.markPatientEntry(patientId);

    const placeholders = testIds.map(() => '?').join(',');
    await db().query(
        `UPDATE PatientTestRefference SET TestStatus='Completed', CompletedOn=NOW() WHERE PatientId=? AND TestId IN (${placeholders})`,
        [patientId, ...testIds]
    );
    return true;
};

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9 — HISTORY & AUDIT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * FIX: Original used mysql.format('INSERT ... set ?', patientData) where patientData
 * was an array — mysql2 generates multiple INSERT statements but only first executes.
 * Now inserts as bulk VALUES correctly.
 */
const insertPatientHistory = async (conn, patientId, userId) => {
    const [[rows]] = await conn.execute(`
        SELECT Id AS PatientId, Title, Name, Age, YMD, Gender, PhoneNumber, Address,
               ActualAmount, GrossAmount, Discount, DiscountApprovedBy,
               ClinicId, DoctorId, CashPayment, OnlinePayment, DuesAmount, Status
        FROM PatientDetails WHERE Id = ?
    `, [patientId]);

    if (!rows) return;  // defensive: patient might not exist yet in edge cases

    await conn.execute(`
        INSERT INTO ${await historyTable(conn)} 
            (PatientId, Title, Name, Age, YMD, Gender, PhoneNumber, Address,
             ActualAmount, GrossAmount, Discount, DiscountApprovedBy,
             ClinicId, DoctorId, CashPayment, OnlinePayment, DuesAmount, Status, ModifiedBy, ChangeType)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'insert')
    `, [
        rows.PatientId, rows.Title, rows.Name, rows.Age, rows.YMD, rows.Gender,
        rows.PhoneNumber, rows.Address, rows.ActualAmount, rows.GrossAmount,
        rows.Discount, rows.DiscountApprovedBy, rows.ClinicId, rows.DoctorId,
        rows.CashPayment, rows.OnlinePayment, rows.DuesAmount, rows.Status, userId,
    ]);
};

const getPatientHistory = async (patientId) => {
    const pool = db();
    const [[auditRows], [currentRow]] = await Promise.all([
        pool.query(`
            SELECT pal.Id, pal.EventGroup, pal.Category, pal.FieldLabel, pal.ChangedField,
                   pal.OldDisplay, pal.NewDisplay, pal.ChangeReason, pal.AuthorisedAs, pal.ChangedAt,
                   DATE_FORMAT(pal.ChangedAt, '%d %b %Y, %h:%i %p') AS DisplayAt,
                   CONCAT(u.FirstName,' ',u.LastName) AS ChangedByName, u.RoleId AS ChangedByRole
            FROM PatientAuditLog pal LEFT JOIN Users u ON u.Id = pal.ChangedBy
            WHERE pal.PatientId = ? ORDER BY pal.ChangedAt ASC, pal.Id ASC
        `, [patientId]),
        pool.query(`
            SELECT pd.*, DATE_FORMAT(pd.RegisteredOn, '%d %b %Y') AS RegDate,
                   CONCAT(ur.FirstName,' ',ur.LastName) AS RegisteredByName,
                   r.Name AS RegisteredByRole, cl.Name AS ClinicName,
                   CONCAT(d.FirstName,' ',d.LastName)  AS DoctorName
            FROM PatientDetails pd
            LEFT JOIN Users        ur ON ur.Id = pd.RegisteredBy
            LEFT JOIN Roles        r  ON r.Id  = ur.RoleId
            LEFT JOIN Clinics      cl ON cl.Id = pd.ClinicId
            LEFT JOIN DoctorDetails d ON d.Id  = pd.DoctorId
            WHERE pd.Id = ? LIMIT 1
        `, [patientId]),
    ]);

    const groupMap = new Map();
    auditRows.forEach(row => {
        const key = row.EventGroup || `solo_${row.Id}`;
        if (!groupMap.has(key)) {
            groupMap.set(key, { eventGroup: key, timestamp: row.ChangedAt, displayAt: row.DisplayAt, actor: row.ChangedByName || 'System', role: row.ChangedByRole || '', authorisedAs: row.AuthorisedAs || null, changes: [] });
        }
        groupMap.get(key).changes.push({
            category: row.Category || 'info', field: row.ChangedField,
            fieldLabel: row.FieldLabel || row.ChangedField,
            oldDisplay: row.OldDisplay || '—', newDisplay: row.NewDisplay || '—',
            reason: row.ChangeReason || '',
        });
    });

    return {
        patient:  currentRow[0] || null,
        timeline: Array.from(groupMap.values()).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)),
    };
};

const getPatientTimeLineData = async (patientId) => {
    const [rows] = await db().query(
        'SELECT ChangedField, OldValue, NewValue, ChangedAt, ChangedBy FROM PatientAuditLog WHERE PatientId=? ORDER BY ChangedAt DESC',
        [patientId]
    );
    return rows;
};

/**
 * logPatientChanges
 * FIX: Original referenced `oldClinicDetails.Discount` and `newClinicDetails.Discount`
 * inside the Discount check block — those variables were declared in the ClinicId block
 * above and are out of scope here — caused ReferenceError crash on every discount change.
 * Fixed by using oldPatientDetails.Discount and newPatientDetails.Discount directly.
 */
const logPatientChanges = async (req) => {
    try {
        let patientId = req.query.id;
        const newPatientDetails = extractPatientDetailsFromUserInput(req, false, true);
        const newSelectedTests  = req.body.selectedTestDetails ? JSON.parse(req.body.selectedTestDetails) : [];

        let oldPatientDetails    = await getPatientDetails(patientId);
        oldPatientDetails        = oldPatientDetails[0];
        const oldPatientTestDetails = await getPatientTestDetail(patientId);
        const oldPatientTestIds  = oldPatientTestDetails.map(t => t.Id);
        const newTestIds         = newSelectedTests.map(t => t.TestId);

        const addedTests   = newSelectedTests.filter(t => !oldPatientTestIds.includes(t.TestId));
        const removedTests = oldPatientTestDetails.filter(t => !newTestIds.includes(t.Id));

        const changes = [];
        const now     = moment().format('YYYY-MM-DD HH:mm:ss');
        const actor   = req.user.Email;

        addedTests.forEach(t => changes.push({
            PatientId: patientId, ChangedField: 'Test Added',
            OldValue: 'N/A', NewValue: `${t.TestName} (₹${t.Price})`, ChangedAt: now, ChangedBy: actor,
        }));
        removedTests.forEach(t => changes.push({
            PatientId: patientId, ChangedField: 'Test Removed',
            OldValue: `${t.TestName} (₹${t.Price})`, NewValue: 'N/A', ChangedAt: now, ChangedBy: actor,
        }));

        if (Number(oldPatientDetails.DoctorId) !== Number(newPatientDetails.DoctorId)) {
            const oldDoctorName = `${oldPatientDetails.FirstName} ${oldPatientDetails.LastName}`;
            const newDoctorName = await Doctor.getDoctorName(newPatientDetails.DoctorId) || 'Unknown Doctor';
            changes.push({ PatientId: patientId, ChangedField: 'Doctor', OldValue: oldDoctorName, NewValue: newDoctorName, ChangedAt: now, ChangedBy: actor });
        }

        if (Number(oldPatientDetails.ClinicId) !== Number(newPatientDetails.ClinicId)) {
            const oldClinic = await Clinic.findClinicById(Number(oldPatientDetails.ClinicId)) || { Name: 'Unknown Clinic' };
            const newClinic = await Clinic.findClinicById(Number(newPatientDetails.ClinicId)) || { Name: 'Unknown Clinic' };
            changes.push({ PatientId: patientId, ChangedField: 'Clinic', OldValue: oldClinic.Name, NewValue: newClinic.Name, ChangedAt: now, ChangedBy: actor });
        }

        // FIX: was `oldClinicDetails.Discount` (ReferenceError) — now uses correct variable
        if (Number(oldPatientDetails.Discount) !== Number(newPatientDetails.Discount)) {
            changes.push({
                PatientId: patientId, ChangedField: 'Discount',
                OldValue: oldPatientDetails.Discount,
                NewValue: newPatientDetails.Discount,
                ChangedAt: now, ChangedBy: actor,
            });
        }

        const excludedFields = ['DoctorId', 'ClinicId', 'Discount'];
        Object.keys(newPatientDetails).forEach(field => {
            if (excludedFields.includes(field)) return;
            if (oldPatientDetails[field] !== newPatientDetails[field]) {
                changes.push({ PatientId: patientId, ChangedField: field, OldValue: oldPatientDetails[field], NewValue: newPatientDetails[field], ChangedAt: now, ChangedBy: actor });
            }
        });

        if (changes.length > 0) {
            const sql    = `INSERT INTO PatientAuditLog (PatientId,ChangedField,OldValue,NewValue,ChangedAt,ChangedBy) VALUES ${changes.map(() => '(?,?,?,?,?,?)').join(',')}`;
            const values = changes.flatMap(c => [c.PatientId, c.ChangedField, c.OldValue, c.NewValue, c.ChangedAt, c.ChangedBy]);
            await db().query(sql, values);
        }

        return { success: true, message: 'Audit log updated' };

    } catch (err) {
        log.error('logPatientChanges:', err.message);
        return { success: false, error: err.message };
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 10 — THANKS / COMMISSION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Record, correct or remove the "thanks" handed over for a patient.
 *   body.thanksAction = 'save' (default) | 'remove'
 * First save sets ThanksGivenOn; later corrections keep the original date
 * (so the thanks-paid report does not move) and are written to PatientAuditLog.
 */
/**
 * "Thanks asked by" — OUR person (MR / staff / partner) who told us to pay this thanks.
 * Column from migrations/2026-10-25_thanks_requested_by.sql. Checked once a minute until it exists,
 * so the app keeps working (field simply not saved) before the patch is run.
 */
let reqByCache = { value: false, at: 0 };
const hasThanksRequestedBy = async (q) => {
    if (reqByCache.value) return true;
    if (Date.now() - reqByCache.at < 60000) return false;
    try {
        const [[r]] = await (q || db()).query(`
            SELECT COUNT(*) AS n FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'patientdetails' AND COLUMN_NAME = 'ThanksRequestedBy'`);
        reqByCache = { value: Number(r.n) > 0, at: Date.now() };
    } catch (_) { reqByCache = { value: false, at: Date.now() }; }
    return reqByCache.value;
};

/** Names already used in "Thanks asked by" (for the suggestion list, so the same person is always spelt the same way). */
const getThanksRequesterNames = async () => {
    if (!(await hasThanksRequestedBy())) return [];
    const [rows] = await db().query(`
        SELECT ThanksRequestedBy AS name, COUNT(*) AS n FROM PatientDetails
        WHERE ThanksRequestedBy IS NOT NULL AND ThanksRequestedBy <> '' AND ThanksGivenOn >= CURDATE() - INTERVAL 365 DAY
        GROUP BY ThanksRequestedBy ORDER BY n DESC, name LIMIT 200`);
    return rows.map(r => r.name);
};

const thanks = async (req) => {
    const patientId = toId(req.query.patientId || req.body.patientId);
    const action    = str(req.body.thanksAction) === 'remove' ? 'remove' : 'save';
    const userId    = req.user && req.user.Id;
    if (!patientId) throw userError('Invalid patient.');
    if (!userId)    throw userError('Your session has expired. Please log in again.');
    const ip        = req.ip || null;
    const userAgent = (req.headers && req.headers['user-agent']) || null;

    const conn = await getConnection();
    try {
        await conn.beginTransaction();
        const reqByOn = await hasThanksRequestedBy(conn);
        const [[p]] = await conn.query(
            `SELECT Status, DoctorId, ActualAmount, ThanksGivenTo, ThanksGivenToMobile, ThanksAmount, ThanksGivenOn${reqByOn ? ', ThanksRequestedBy' : ''}
             FROM PatientDetails WHERE Id = ? FOR UPDATE`,
            [patientId]);
        if (!p)                     throw userError('Patient not found.');
        if (Number(p.Status) === 0) throw userError('Cannot change thanks for a cancelled patient.');
        const hadThanks = !!p.ThanksGivenTo;
        const reason = str(req.body.thanksChangeReason).slice(0, 200);
        const oldAskedBy = str(p.ThanksRequestedBy);
        const oldText = hadThanks ? `${p.ThanksGivenTo} / ${p.ThanksGivenToMobile} / ₹${round2(num(p.ThanksAmount))}${oldAskedBy ? ` (asked by ${oldAskedBy})` : ''}` : '—';

        if (action === 'remove') {
            if (!hadThanks) throw userError('No thanks is recorded for this patient.');
            if (reason.length < 3) throw userError('Write a reason for removing the thanks.');
            await conn.query(`UPDATE PatientDetails SET ThanksGivenTo=NULL, ThanksGivenBy=NULL, ThanksGivenOn=NULL, ThanksGivenToMobile=NULL, ThanksAmount=NULL${reqByOn ? ', ThanksRequestedBy=NULL' : ''} WHERE Id=?`, [patientId]);
            const ev = PatientAudit.event(conn, { patientId, action: 'THANKS_REMOVE', actorId: userId, ip, userAgent, reason });
            ev.add('thanks', 'Thanks', 'Thanks', oldText, '—')
              .setRisk(PatientAudit.evaluateRisk('THANKS_REMOVE', { thanks: { detail: oldText } }));
            await ev.save();
            await conn.commit();
            return 'Thanks entry removed.';
        }

        const name   = str(req.body.thanksGivenTo);
        const mobile = str(req.body.thanksPaidMobile).replace(/\D/g, '').slice(-10);
        const amount = parseMoney(req.body.thanksAmount, 'Thanks amount');      // S3: was parseFloat ("12abc" → 12)
        const askedBy = str(req.body.thanksRequestedBy).replace(/\s+/g, ' ');
        const errors = [];
        if (reqByOn && (askedBy.length < 2 || askedBy.length > 100))
            errors.push('Enter who asked us to pay this thanks (our MR / staff name).');
        if (name.length < 2 || name.length > 100) errors.push('Enter the name of the person who received the thanks.');
        if (!/^[6-9]\d{9}$/.test(mobile))         errors.push('Enter a valid 10-digit mobile number.');
        if (!(amount > 0))                        errors.push('Thanks amount must be more than ₹0.');
        if (amount > num(p.ActualAmount))         errors.push(`Thanks (₹${amount}) cannot be more than the bill amount (₹${num(p.ActualAmount)}).`);
        if (hadThanks && reason.length < 3)       errors.push('Write a reason for changing the thanks.');
        if (errors.length) throw userError(errors);

        if (hadThanks && p.ThanksGivenTo === name && p.ThanksGivenToMobile === mobile && round2(num(p.ThanksAmount)) === amount
            && (!reqByOn || oldAskedBy === askedBy)) {
            await conn.rollback();
            return 'Nothing changed.';
        }
        await conn.query(
            `UPDATE PatientDetails SET ThanksGivenTo=?, ThanksGivenBy=?, ThanksGivenOn=COALESCE(ThanksGivenOn, CURDATE()), ThanksGivenToMobile=?, ThanksAmount=?${reqByOn ? ', ThanksRequestedBy=?' : ''} WHERE Id=?`,
            reqByOn ? [name, userId, mobile, amount, askedBy, patientId] : [name, userId, mobile, amount, patientId]);

        // commission the system calculated for this doctor (to catch inflated thanks)
        const [[ref]] = await conn.query(
            "SELECT Thanks FROM Referrals WHERE PatientId = ? AND DoctorId = ? AND Status = 'active' LIMIT 1", [patientId, p.DoctorId || 0]);
        const calculated = ref ? round2(num(ref.Thanks)) : null;

        const ev = PatientAudit.event(conn, { patientId, action: 'THANKS_SAVE', actorId: userId, ip, userAgent,
                                              reason: hadThanks ? reason : 'Thanks recorded' });
        if (hadThanks) {
            ev.change('thanks', 'Thanks Given To', 'ThanksGivenTo',       p.ThanksGivenTo, name);
            ev.change('thanks', 'Receiver Mobile', 'ThanksGivenToMobile', p.ThanksGivenToMobile, mobile);
            ev.change('thanks', 'Thanks Amount',   'ThanksAmount',        `₹${round2(num(p.ThanksAmount))}`, `₹${amount}`);
            if (reqByOn) ev.change('thanks', 'Thanks Asked By', 'ThanksRequestedBy', oldAskedBy, askedBy);
        } else {
            ev.add('thanks', 'Thanks', 'Thanks', '—', `${name} / ${mobile} / ₹${amount}`);
            if (reqByOn) ev.add('thanks', 'Thanks Asked By', 'ThanksRequestedBy', '—', askedBy);
        }
        if (calculated != null) ev.add('thanks', 'Calculated Commission', 'CalculatedThanks', '—', `₹${calculated}`);
        ev.setExtra({ calculated, amount })
          .setRisk(PatientAudit.evaluateRisk('THANKS_SAVE', { thanks: { amount, calculated, hadThanks, detail: `${oldText} → ${name} / ${mobile} / ₹${amount}${askedBy ? ` (asked by ${askedBy})` : ''}` } }));
        await ev.save();

        await conn.commit();
        return hadThanks ? `Thanks updated to ₹${amount}.` : `Thanks of ₹${amount} recorded.`;
    } catch (e) {
        try { await conn.rollback(); } catch (_) {}
        throw e;
    } finally {
        conn.release();
    }
};


/**
 * FIX: SQL injection — Name and DoctorId were interpolated directly into the query string.
 * Now uses parameterised placeholders throughout.
 */
/**
 * Thanks-paid list.
 * Filters (body or query): FromDate, ToDate (D MMM YYYY | DD-MM-YYYY | YYYY-MM-DD), Name,
 *   Doctor (id), ThanksGivenTo (text), DateBasis = 'paid' (default) | 'registered',
 *   Status = '' | 'active' | 'cancelled'.
 * FIXES: the form sends "Doctor" but this read "doctorId" (doctor filter never worked);
 * INNER JOINs hid patients without a doctor / with a deleted user; view read
 * patient.title but the column is Title; GET (commission) crashed without doctorDetails.
 * Returns { rows, filters, totals, byReceiver, byDoctor }.
 */
const THANKS_DATE_FORMATS = ['D MMM YYYY', 'DD MMM YYYY', 'DD-MM-YYYY', 'D-M-YYYY', 'YYYY-MM-DD', 'DD/MM/YYYY'];
const viewThanksPaidPatientList = async (req) => {
    const src = { ...(req.query || {}), ...(req.body || {}) };
    const parse = (v, fallback) => {
        const s = str(v);
        if (!s) return fallback.clone();
        const m = moment(s, THANKS_DATE_FORMATS, true);
        if (!m.isValid()) throw userError(`"${s}" is not a valid date.`);
        return m;
    };
    const today = moment().startOf('day');
    let from = parse(src.FromDate, today.clone().startOf('month'));
    let to   = parse(src.ToDate, today);
    if (from.isAfter(to)) [from, to] = [to, from];
    if (to.diff(from, 'days') > 366) throw userError('Please choose a range of at most one year.');

    const basis    = src.DateBasis === 'registered' ? 'registered' : 'paid';
    const dateCol  = basis === 'registered' ? 'pd.RegisteredOn' : 'pd.ThanksGivenOn';
    const where    = ['pd.ThanksAmount > 0', 'pd.ThanksGivenTo IS NOT NULL', `${dateCol} >= ?`, `${dateCol} < ? + INTERVAL 1 DAY`];
    const params   = [from.format('YYYY-MM-DD'), to.format('YYYY-MM-DD')];
    const doctorId = toId(src.Doctor || src.doctorId);
    const name     = str(src.Name).slice(0, 80);
    const receiver = str(src.ThanksGivenTo).slice(0, 80);
    const reqByOn  = await hasThanksRequestedBy();
    const askedBy  = reqByOn ? str(src.RequestedBy).slice(0, 80) : '';
    const status   = ['active', 'cancelled'].includes(src.Status) ? src.Status : '';

    if (name)     { where.push('(pd.Name LIKE ? OR pd.PhoneNumber LIKE ? OR pd.Id = ?)'); params.push(`%${name}%`, `%${name}%`, toId(name) || 0); }
    if (doctorId) { where.push('pd.DoctorId = ?'); params.push(doctorId); }
    if (receiver) { where.push('(pd.ThanksGivenTo LIKE ? OR pd.ThanksGivenToMobile LIKE ?)'); params.push(`%${receiver}%`, `%${receiver}%`); }
    if (askedBy)  { where.push('pd.ThanksRequestedBy LIKE ?'); params.push(`%${askedBy}%`); }
    if (status === 'active')    where.push('pd.Status = 1');
    if (status === 'cancelled') where.push('pd.Status = 0');

    const [rows] = await db().query(`
        SELECT pd.Id, pd.Title, pd.Name, pd.Age, pd.YMD, pd.Gender, pd.PhoneNumber, pd.Status,
               pd.GrossAmount, pd.ActualAmount, pd.DuesAmount,
               DATE_FORMAT(pd.RegisteredOn,  '%d-%m-%Y') AS RegisteredOn,
               DATE_FORMAT(pd.ThanksGivenOn, '%d-%m-%Y') AS ThanksGivenOn,
               pd.ThanksGivenTo, pd.ThanksGivenToMobile, pd.ThanksAmount,
               ${reqByOn ? 'pd.ThanksRequestedBy' : 'NULL'} AS ThanksRequestedBy,
               DATEDIFF(pd.ThanksGivenOn, pd.RegisteredOn) AS DaysToPay,
               pd.DoctorId,
               d.FirstName AS docFirstName, d.LastName AS docLastName, d.SpecialistIn AS docSpecialist,
               CONCAT_WS(', ', NULLIF(d.Degree1,''), NULLIF(d.Degree2,''), NULLIF(d.Degree3,''), NULLIF(d.Degree4,'')) AS docDegrees,
               cl.Name AS ClinicName,
               r.Thanks AS CalculatedThanks,
               TRIM(CONCAT(COALESCE(ub.FirstName,''),' ',COALESCE(ub.LastName,''))) AS PaidByName,
               TRIM(CONCAT(COALESCE(ur.FirstName,''),' ',COALESCE(ur.LastName,''))) AS RegisteredByName,
               (SELECT GROUP_CONCAT(m.TestName ORDER BY m.TestName SEPARATOR ', ')
                  FROM PatientTestRefference ptr JOIN MainTestTable m ON m.Id = ptr.TestId
                 WHERE ptr.PatientId = pd.Id) AS TestNames
        FROM PatientDetails pd
        LEFT JOIN DoctorDetails d ON d.Id  = pd.DoctorId
        LEFT JOIN Clinics      cl ON cl.Id = pd.ClinicId
        LEFT JOIN Referrals     r ON r.PatientId = pd.Id AND r.DoctorId = pd.DoctorId
        LEFT JOIN Users        ub ON ub.Id = pd.ThanksGivenBy
        LEFT JOIN Users        ur ON ur.Id = pd.RegisteredBy
        WHERE ${where.join(' AND ')}
        ORDER BY ${dateCol} DESC, pd.Id DESC
        LIMIT 2000`, params);

    const totals = { count: 0, amount: 0, billed: 0, calculated: 0, comparedPaid: 0, comparedCount: 0, cancelledCount: 0, cancelledAmount: 0, overPaid: 0 };
    const byReceiver = new Map(), byDoctor = new Map(), byRequester = new Map();
    rows.forEach(r => {
        const amt = round2(num(r.ThanksAmount));
        r.ThanksAmount = amt;
        r.CalculatedThanks = r.CalculatedThanks == null ? null : round2(num(r.CalculatedThanks));
        r.Difference = r.CalculatedThanks == null ? null : round2(amt - r.CalculatedThanks);
        r.DoctorName = r.docFirstName ? `Dr. ${r.docFirstName} ${r.docLastName || ''}`.trim() : '';
        r.GenderLabel = r.Gender == 1 ? 'Male' : r.Gender == 2 ? 'Female' : (r.Gender ? 'Other' : '');
        totals.count++; totals.amount += amt; totals.billed += num(r.GrossAmount);
        if (r.CalculatedThanks != null) { totals.calculated += r.CalculatedThanks; totals.comparedPaid += amt; totals.comparedCount++; }
        if (r.Difference > 0) totals.overPaid += r.Difference;
        if (Number(r.Status) === 0) { totals.cancelledCount++; totals.cancelledAmount += amt; }

        const rk = `${String(r.ThanksGivenTo || '').trim().toLowerCase()}|${r.ThanksGivenToMobile || ''}`;
        if (!byReceiver.has(rk)) byReceiver.set(rk, { name: r.ThanksGivenTo, mobile: r.ThanksGivenToMobile, count: 0, amount: 0 });
        const rv = byReceiver.get(rk); rv.count++; rv.amount += amt;

        const qk = String(r.ThanksRequestedBy || '').trim().toLowerCase() || '(not recorded)';
        if (!byRequester.has(qk)) byRequester.set(qk, { name: String(r.ThanksRequestedBy || '').trim() || 'Not recorded', count: 0, amount: 0 });
        const qv = byRequester.get(qk); qv.count++; qv.amount += amt;

        const dk = String(r.DoctorId || 0);
        if (!byDoctor.has(dk)) byDoctor.set(dk, { id: r.DoctorId, name: r.DoctorName || 'No doctor', count: 0, amount: 0, billed: 0 });
        const dv = byDoctor.get(dk); dv.count++; dv.amount += amt; dv.billed += num(r.GrossAmount);
    });
    Object.keys(totals).forEach(k => { totals[k] = round2(totals[k]); });
    const sortAmt = (m) => [...m.values()].map(v => (v.billed != null ? { ...v, amount: round2(v.amount), billed: round2(v.billed) } : { ...v, amount: round2(v.amount) }))
                                          .sort((a, b) => b.amount - a.amount);
    return {
        rows,
        truncated: rows.length === 2000,
        totals,
        byReceiver: sortAmt(byReceiver),
        byDoctor:   sortAmt(byDoctor),
        byRequester: sortAmt(byRequester),
        filters: {
            FromDate: from.format('D MMM YYYY'), ToDate: to.format('D MMM YYYY'),
            Name: name, Doctor: doctorId || '', ThanksGivenTo: receiver, RequestedBy: askedBy, DateBasis: basis, Status: status,
        },
    };
};

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 11 — CANCEL AUTHORISATION
// FIX: the permission was looked up by req.path, which is "/checkCancelAuth"
// in the AJAX check but "/cancelPatient" in the real cancel → an authorised
// user passed one check and failed the other. Now always the same function.
// ─────────────────────────────────────────────────────────────────────────────

const CANCEL_PATIENT_FUNCTION_ID    = 10;
const CANCEL_PATIENT_FUNCTION_SLUGS = ['/cancelPatient', 'cancelPatient', '/patient/cancelPatient', '/checkCancelAuth'];

/**
 * Extra permission needed (besides admin) to cancel a patient whose doctor
 * "thanks" has already been handed over. Add this slug to your Functions table
 * and give it to the users who may do this (see migration file).
 */
const CANCEL_THANKS_PAID_SLUGS = ['/cancelThanksPaidPatient', 'cancelThanksPaidPatient'];

const reportExistsForPatient = async (patientId, q = null) => {
    const [[row]] = await (q || db()).query(
        'SELECT Id FROM PatientReports WHERE PatientId=? AND ReportReady=1 LIMIT 1',
        [patientId]
    );
    return !!row;
};

/** Admin flag — your Users table uses IsItAdmin (older code used IsAdmin); accept either. */
const loadUserForAuth = async (userId) => {
    const [[u]] = await db().query('SELECT * FROM Users WHERE Id=? LIMIT 1', [userId]);
    if (!u) return null;
    return {
        id: u.Id,
        isAdmin: Number(u.IsItAdmin) === 1 || Number(u.IsAdmin) === 1,
        active:  u.Status === undefined || u.Status === null || Number(u.Status) === 1,
    };
};

// FIX (2026-10-27): shared check -> honours role grants and per-user DENY.
// The `ids` option is ignored on purpose: CANCEL_PATIENT_FUNCTION_ID = 10 is
// "Packet Delivery" in the Functions table, so packet staff could cancel patients.
const userHasFunction = async (userId, { slugs = [] } = {}) =>
    require('./User').userHasAnyFunction(userId, slugs);

/**
 * Who may cancel this patient?
 *   • nothing special          → anyone who can open the cancel screen
 *   • report already ready     → admin, or user with the Cancel Patient function (Id 10)
 *   • thanks already paid      → admin, or user with the "cancelThanksPaidPatient" function
 *   • both                     → admin, or a user who has BOTH permissions
 * Returns { allowed, reason, message, warning, info } — `warning` is shown in the
 * cancel dialog (thanks paid, cross-day refund) even when the user is allowed.
 */
const checkCancelAuthorisation = async (patientId, userId, _path = null, q = null) => {
    if (!isPositiveInt(patientId)) return { allowed: false, message: 'Invalid patient.' };
    const dbq = q || db();      // inside cancelPatient: the locked transaction connection

    const [[p]] = await dbq.query(
        `SELECT Status, Name, CashPayment, OnlinePayment, ChangeToReturn,
                ThanksGivenTo, ThanksAmount,
                CASE WHEN DATE(RegisteredOn) < CURDATE() THEN 1 ELSE 0 END AS CrossDay,
                DATE_FORMAT(RegisteredOn, '%d-%m-%Y') AS RegisteredOnFmt
         FROM PatientDetails WHERE Id=? LIMIT 1`, [patientId]);
    if (!p)                     return { allowed: false, message: 'Patient not found.' };
    if (Number(p.Status) === 0) return { allowed: false, message: 'This patient is already cancelled.' };

    const thanksPaid = !!p.ThanksGivenTo && num(p.ThanksAmount) > 0;
    // "report" now also means: test done in the room / report ready / film or report generated.
    // (FIX: a patient could be cancelled + refunded after the scan was done but before the report was typed)
    const testStates = await PatientAudit.loadTestStates(dbq, patientId);
    const testsDone  = testStates.filter(t => t.done || t.reported || t.delivered);
    const hasReport  = testsDone.length > 0 || await reportExistsForPatient(patientId, dbq);
    const refund     = round2(Math.max(0, num(p.CashPayment) - num(p.ChangeToReturn)) + num(p.OnlinePayment));

    const warnings = [];
    const thanksWarning = thanksPaid ? `Thanks of ₹${num(p.ThanksAmount)} was already given to ${p.ThanksGivenTo}. Recover it from them.` : null;
    if (thanksWarning) warnings.push(thanksWarning);
    if (Number(p.CrossDay) === 1 && refund > 0) warnings.push(`Registered on ${p.RegisteredOnFmt}: the refund of ₹${refund} will be deducted from TODAY's collection.`);
    else if (refund > 0) warnings.push(`Same-day cancellation: ₹${refund} is removed from today's collection.`);
    const info = { thanksPaid, thanksWarning, hasReport, crossDay: Number(p.CrossDay) === 1, refund };
    const done = (o) => ({ ...o, info, warning: warnings.join(' ') || null });

    if (!hasReport && !thanksPaid) return done({ allowed: true, reason: 'no_report' });

    const user = await loadUserForAuth(userId);
    if (!user || !user.active) return done({ allowed: false, message: 'User not found or inactive.' });
    if (user.isAdmin)          return done({ allowed: true, reason: 'admin' });

    const missing = [];
    if (hasReport && !(await userHasFunction(userId, { ids: [CANCEL_PATIENT_FUNCTION_ID], slugs: CANCEL_PATIENT_FUNCTION_SLUGS })))
        missing.push(testsDone.length ? `${testsDone.map(t => t.name).join(', ')} is already done/reported` : 'a report is already ready');
    if (thanksPaid && !(await userHasFunction(userId, { slugs: CANCEL_THANKS_PAID_SLUGS })))
        missing.push(`thanks of ₹${num(p.ThanksAmount)} is already paid to ${p.ThanksGivenTo}`);

    if (!missing.length) return done({ allowed: true, reason: thanksPaid ? 'authorised_thanks_paid' : 'authorised' });
    return done({
        allowed: false,
        message: `This patient cannot be cancelled by you because ${missing.join(' and ')}. Only an Admin or a user with permission can cancel.`,
    });
};

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 12 — REFERRAL / DOCTOR COMMISSION ("thanks")
//
// Rate priority for each item:
//   main test : DoctorTestCommission (fixed ₹ for that doctor+test)
//               → else DoctorCategoryCommission % of the test price
//   sub-test  : DoctorSubTestCommission (fixed ₹ for that doctor+sub-test)
//               → else SubTestTable.ThanksAmount (default for all doctors)
//
// FIX: before, only DoctorTestCommission was read. A doctor added AFTER a test
// was created has no row there → ₹0 commission even with a category rate.
// FIX: a sub-test shared by two tests (e.g. CONTRAST under CT and MRI) used to
// cancel the commission of BOTH parents; parent is now taken from the booking.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pure calculation — no DB.
 * items: tests [{TestId, Price, Discount, CategoryId}], subs [{SubTestId, mainTestId, Price, Discount}]
 * rates: testRates Map(TestId→₹), categoryRates Map(CategoryId→%), subRates Map(SubTestId→₹), subDefaults Map(SubTestId→₹)
 */
const calculateThanks = ({ tests = [], subs = [], testRates, categoryRates, subRates, subDefaults }) => {
    const breakdown = [];
    let total = 0;
    const parentsWithPaidSub = new Set();

    for (const s of subs) {
        let amount = subRates.get(Number(s.SubTestId));
        let source = 'subtest-rate';
        if (amount === undefined) { amount = subDefaults.get(Number(s.SubTestId)) || 0; source = 'subtest-default'; }
        amount = round2(amount);
        if (amount > 0) {
            breakdown.push({ type: 'subtest', id: s.SubTestId, parentTestId: s.mainTestId, name: s.Name, amount, source });
            total += amount;
            parentsWithPaidSub.add(Number(s.mainTestId));
        }
    }

    for (const t of tests) {
        if (SUBTEST_REPLACES_TEST_THANKS && parentsWithPaidSub.has(Number(t.TestId))) continue;
        let amount = testRates.get(Number(t.TestId));
        let source = 'test-rate';
        if (amount === undefined) {
            const pct  = categoryRates.get(Number(t.CategoryId)) || 0;
            const base = CATEGORY_RATE_ON_NET_PRICE ? (num(t.Price) - num(t.Discount)) : num(t.Price);
            amount = (base * pct) / 100;
            source = pct ? `category-${pct}%` : 'none';
        }
        amount = round2(amount);
        if (amount > 0) { breakdown.push({ type: 'test', id: t.TestId, name: t.TestName, amount, source }); total += amount; }
    }
    return { total: round2(total), breakdown };
};

const upsertReferral = async (conn, { doctorId, patientId, registeredBy, thanks, breakdown }) => {
    await conn.query(`
        INSERT INTO Referrals (DoctorId, PatientId, RegisteredOn, RegisteredBy, ModifiedOn, ModifiedBy, Thanks, ThanksBreakdown)
        VALUES (?, ?, NOW(), ?, NOW(), ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            Thanks = VALUES(Thanks), ThanksBreakdown = VALUES(ThanksBreakdown),
            ModifiedOn = NOW(), ModifiedBy = VALUES(ModifiedBy),
            Status = 'active', ReversedOn = NULL, ReversedBy = NULL, ReversalReason = NULL
    `, [doctorId, patientId, registeredBy, registeredBy, thanks, JSON.stringify(breakdown)]);
};

/**
 * Calculates and saves the doctor's commission for a patient.
 * Pass `bill` (from buildBill) when you have it; otherwise prices are loaded from testIds/subTests.
 */
const processReferral = async (conn, { doctorId, patientId, registeredBy, testIds = [], subTestIds = [], subTests = null, bill = null }) => {
    if (!doctorId) return { thanks: 0, breakdown: [] };

    let tests = bill ? bill.tests : [];
    let subs  = bill ? bill.subs  : (subTests || []);
    if (!bill) {
        if (testIds.length) {
            const [rows] = await conn.query('SELECT Id AS TestId, TestName, Price, CategoryId FROM MainTestTable WHERE Id IN (?)', [testIds]);
            tests = rows.map(r => ({ ...r, Discount: 0 }));
        }
        if (!subs.length && subTestIds.length) {
            const [rows] = await conn.query(
                'SELECT mstr.MainTestId AS mainTestId, st.Id AS SubTestId, st.Name, st.Price FROM MainTestSubTestReference mstr JOIN SubTestTable st ON st.Id = mstr.SubTestId WHERE mstr.SubTestId IN (?) AND mstr.MainTestId IN (?)',
                [subTestIds, testIds.length ? testIds : [0]]
            );
            subs = rows;
        }
    }

    if (!tests.length && !subs.length) return { thanks: 0, breakdown: [] };

    const tIds   = tests.map(t => t.TestId);
    const cIds   = [...new Set(tests.map(t => t.CategoryId).filter(Boolean))];
    const sIds   = [...new Set(subs.map(s => s.SubTestId))];
    const none   = Promise.resolve([[]]);

    const [[tr], [cr], [sr], [sd]] = await Promise.all([
        tIds.length ? conn.query('SELECT TestId, Commission FROM DoctorTestCommission WHERE DoctorId = ? AND TestId IN (?)', [doctorId, tIds]) : none,
        cIds.length ? conn.query('SELECT CategoryId, CommissionRate FROM DoctorCategoryCommission WHERE DoctorId = ? AND CategoryId IN (?)', [doctorId, cIds]) : none,
        // a doctor row with Thanks NULL only changes discount / report display → he gets the default thanks
        sIds.length ? conn.query('SELECT SubTestId, Thanks FROM DoctorSubTestCommission WHERE DoctorId = ? AND SubTestId IN (?) AND Thanks IS NOT NULL', [doctorId, sIds]) : none,
        sIds.length ? conn.query('SELECT Id AS SubTestId, ThanksAmount FROM SubTestTable WHERE Id IN (?)', [sIds]) : none,
    ]);

    const { total, breakdown } = calculateThanks({
        tests, subs,
        testRates:     new Map(tr.map(r => [Number(r.TestId),     num(r.Commission)])),
        categoryRates: new Map(cr.map(r => [Number(r.CategoryId), num(r.CommissionRate)])),
        subRates:      new Map(sr.map(r => [Number(r.SubTestId),  num(r.Thanks)])),
        subDefaults:   new Map(sd.map(r => [Number(r.SubTestId),  num(r.ThanksAmount)])),
    });

    if (total > 0) {
        await upsertReferral(conn, { doctorId, patientId, registeredBy, thanks: total, breakdown });
    } else {
        // Tests changed to ones without commission → don't leave the old amount behind
        await conn.query(
            "UPDATE Referrals SET Thanks = 0, ThanksBreakdown = '[]', ModifiedOn = NOW(), ModifiedBy = ? WHERE PatientId = ? AND DoctorId = ?",
            [registeredBy, patientId, doctorId]
        );
    }
    return { thanks: total, breakdown };
};

const reverseReferral = async (conn, { patientId, doctorId, reversedBy, reversalReason }) => {
    await conn.query(`
        UPDATE Referrals SET Status='reversed', ReversedOn=NOW(), ReversedBy=?, ReversalReason=?, ModifiedOn=NOW(), ModifiedBy=?
        WHERE PatientId=? AND DoctorId=? AND Status='active'
    `, [reversedBy, reversalReason, reversedBy, patientId, doctorId]);
};


/**
 * Doctor thanks report (preview + PDF).
 * Each test / sub-test line carries the thanks it earned (from Referrals.ThanksBreakdown, i.e. the amount
 * actually given on the day of registration — later rate changes do not alter old reports).
 * Sub-tests that earned ₹0 are left out, unless the doctor wants them:
 *   DoctorSubTestCommission.ShowInReport (1 show / 0 hide) for that sub-test, else DoctorDetails.ShowZeroThanksSubTests.
 * Old referrals without a breakdown keep showing all their sub-tests (amount unknown).
 */
const getReferralReportData = async ({ fromDate, toDate, doctorId = null }) => {
    const params       = [fromDate, toDate];
    const doctorFilter = doctorId ? 'AND r.DoctorId = ?' : '';
    if (doctorId) params.push(doctorId);

    const [rows] = await db().query(`
        SELECT r.DoctorId, CONCAT('Dr. ',dd.FirstName,' ',dd.LastName) AS DoctorName,
               dd.Degree1, dd.Degree2, dd.Degree3, dd.Degree4, dd.SpecialistIn,
               r.PatientId, CONCAT(pd.Title,' ',pd.Name) AS PatientName,
               pd.PhoneNumber, pd.Age, pd.YMD,
               DATE_FORMAT(pd.RegisteredOn,'%d-%m-%Y') AS RegisteredOn,
               pd.GrossAmount, pd.Discount, pd.ActualAmount,
               (pd.CashPayment+pd.OnlinePayment) AS TotalPaid, pd.DuesAmount,
               r.Thanks, r.ThanksBreakdown
        FROM Referrals r
        JOIN PatientDetails pd ON pd.Id = r.PatientId
        JOIN DoctorDetails  dd ON dd.Id = r.DoctorId
        WHERE pd.Status = 1 AND r.Status = 'active' AND DATE(pd.RegisteredOn) BETWEEN ? AND ? ${doctorFilter}
        ORDER BY r.DoctorId, pd.RegisteredOn, pd.Id
    `, params);

    if (!rows.length) return [];

    const patientIds = [...new Set(rows.map(r => r.PatientId))];
    const doctorIds  = [...new Set(rows.map(r => r.DoctorId))];

    // settings are optional (columns added by migrations/2026-10-17_subtest_doctor_rates.sql)
    const optional = (p) => p.catch(e => { if (e.code === 'ER_BAD_FIELD_ERROR') return [[]]; throw e; });
    const [[testRows], [subTestRows], [docRows], [ruleRows]] = await Promise.all([
        db().query(`SELECT ptr.PatientId, ptr.TestId AS ItemId, t.TestName AS Name, t.Price, COALESCE(ptr.Discount,0) AS TestDiscount, 'test' AS ItemType
                    FROM PatientTestRefference ptr JOIN MainTestTable t ON t.Id = ptr.TestId
                    WHERE ptr.PatientId IN (?) ORDER BY ptr.PatientId, ptr.Id`, [patientIds]).catch(e => {
            if (e.code !== 'ER_BAD_FIELD_ERROR') throw e;          // PatientTestRefference without Id column
            return db().query(`SELECT ptr.PatientId, ptr.TestId AS ItemId, t.TestName AS Name, t.Price, COALESCE(ptr.Discount,0) AS TestDiscount, 'test' AS ItemType
                               FROM PatientTestRefference ptr JOIN MainTestTable t ON t.Id = ptr.TestId WHERE ptr.PatientId IN (?)`, [patientIds]);
        }),
        db().query(`SELECT pstr.PatientId, pstr.SubTestId AS ItemId, st.Name, st.Price, COALESCE(pstr.Discount,0) AS TestDiscount, 'subtest' AS ItemType
                    FROM PatientSubTestRefference pstr JOIN SubTestTable st ON st.Id = pstr.SubTestId
                    WHERE pstr.PatientId IN (?)`, [patientIds]),
        optional(db().query('SELECT Id, ShowZeroThanksSubTests FROM DoctorDetails WHERE Id IN (?)', [doctorIds])),
        optional(db().query('SELECT DoctorId, SubTestId, ShowInReport FROM DoctorSubTestCommission WHERE DoctorId IN (?) AND ShowInReport IS NOT NULL', [doctorIds])),
    ]);

    const showZeroDoctor = new Map(docRows.map(d => [Number(d.Id), Number(d.ShowZeroThanksSubTests) === 1]));
    const rule = new Map(ruleRows.map(r => [`${r.DoctorId}:${r.SubTestId}`, Number(r.ShowInReport) === 1]));

    const itemsByPatient = {};
    for (const t of [...testRows, ...subTestRows]) (itemsByPatient[t.PatientId] = itemsByPatient[t.PatientId] || []).push(t);

    /** thanks earned per item for one referral, from the saved breakdown → { test: Map, subtest: Map } or null */
    const readBreakdown = (raw) => {
        if (raw == null) return null;
        let list = raw;
        if (typeof raw === 'string') { try { list = JSON.parse(raw); } catch (_) { return null; } }
        if (!Array.isArray(list)) return null;
        const out = { test: new Map(), subtest: new Map() };
        list.forEach(b => {
            const m = b && (b.type === 'subtest' ? out.subtest : b.type === 'test' ? out.test : null);
            if (m) m.set(Number(b.id), round2((m.get(Number(b.id)) || 0) + num(b.amount)));
        });
        return out;
    };

    const doctorMap = new Map();
    for (const row of rows) {
        if (!doctorMap.has(row.DoctorId)) {
            doctorMap.set(row.DoctorId, {
                doctorId: row.DoctorId, doctorName: row.DoctorName,
                degrees: [row.Degree1, row.Degree2, row.Degree3, row.Degree4].filter(Boolean), specialistIn: row.SpecialistIn,
                showZeroSubTests: showZeroDoctor.get(Number(row.DoctorId)) || false,
                dates: new Map(), totalThanks: 0, totalPatients: 0, hiddenSubTests: 0,
            });
        }
        const doctor = doctorMap.get(row.DoctorId);
        const bd = readBreakdown(row.ThanksBreakdown);
        const tests = [];
        for (const it of itemsByPatient[row.PatientId] || []) {
            const thanks = bd ? (bd[it.ItemType].get(Number(it.ItemId)) || 0) : null;
            if (it.ItemType === 'subtest' && bd && thanks <= 0) {
                const own = rule.get(`${row.DoctorId}:${it.ItemId}`);
                const show = own !== undefined ? own : doctor.showZeroSubTests;
                if (!show) { doctor.hiddenSubTests += 1; continue; }
            }
            tests.push({
                ItemType: it.ItemType, Name: it.Name, Price: num(it.Price), TestDiscount: num(it.TestDiscount),
                Thanks: thanks, ThanksAmount: thanks == null ? 0 : thanks,
            });
        }
        const dateKey = row.RegisteredOn;
        if (!doctor.dates.has(dateKey)) doctor.dates.set(dateKey, { date: dateKey, patients: [], dayThanks: 0, dayGross: 0, dayDiscount: 0, dayDues: 0 });
        const day = doctor.dates.get(dateKey);
        const patient = {
            patientId: row.PatientId, name: row.PatientName, phone: row.PhoneNumber, age: `${row.Age} ${row.YMD}`,
            gross: num(row.GrossAmount), discount: num(row.Discount), actual: num(row.ActualAmount),
            totalPaid: num(row.TotalPaid), dues: num(row.DuesAmount), thanks: num(row.Thanks), tests,
        };
        day.patients.push(patient);
        day.dayThanks += patient.thanks; day.dayGross += patient.gross; day.dayDiscount += patient.discount; day.dayDues += patient.dues;
        doctor.totalThanks += patient.thanks; doctor.totalPatients += 1;
    }
    return Array.from(doctorMap.values()).map(d => ({ ...d, dates: Array.from(d.dates.values()) }));
};

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 13 — MISC (unchanged business logic, internal use)
// ─────────────────────────────────────────────────────────────────────────────

const isPatientWithTestExist = async (patientId, testId) => {
    const [[row]] = await db().execute(
        'SELECT Id FROM PatientTestRefference WHERE PatientId=? AND TestId=? LIMIT 1',
        [patientId, testId]
    );
    return !!row;
};

const isPatientReportExist = async (patientId, testId) => {
    const [rows] = await db().query(
        'SELECT * FROM PatientReports WHERE PatientId=? AND TestId=? LIMIT 1',
        [patientId, testId]
    );
    return rows;
};

const getDailyReport = async ({ date, userId }) => {
    try {
        const reportDate = date || moment().format('YYYY-MM-DD');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) return { success: false, message: 'Invalid date format.' };

        const uf  = userId ? 'AND t.UserId = ?'        : '';
        const upd = userId ? 'AND pd.RegisteredBy = ?'  : '';
        const uca = userId ? 'AND pd.CancelledBy = ?'   : '';
        const udc = userId ? 'AND d.CollectedBy = ?'    : '';
        const p   = (...extra) => userId ? [reportDate, userId, ...extra] : [reportDate, ...extra];

        const [summary, onlineBreakdown, advanceBookings, cancellations, duesReceived] = await Promise.all([
            db().query(`SELECT t.UserId, SUM(CASE WHEN t.TransactionType IN ('payment','balance_collected') AND t.CreditCash>0 THEN t.CreditCash ELSE 0 END) AS CashIn, SUM(CASE WHEN t.TransactionType IN ('payment','balance_collected') AND t.CreditOnline>0 THEN t.CreditOnline ELSE 0 END) AS OnlineIn, SUM(CASE WHEN t.TransactionType IN ('refund','change_returned') THEN t.Debit ELSE 0 END) AS TotalOut FROM TransactionTable t WHERE t.ShiftDate=? ${uf} GROUP BY t.UserId`, p()).then(([r]) => r),
            db().query(`SELECT t.UserId, ops.Name AS SourceName, ops.ShortCode, SUM(t.CreditOnline) AS Amount, COUNT(*) AS TxCount FROM TransactionTable t JOIN OnlinePaymentSources ops ON t.OnlineSourceId=ops.Id WHERE t.ShiftDate=? AND t.CreditOnline>0 ${uf} GROUP BY t.UserId, t.OnlineSourceId ORDER BY t.UserId, ops.SortOrder`, p()).then(([r]) => r),
            db().query(`SELECT pd.Id, pd.Name, pd.PhoneNumber, pd.GrossAmount, pd.ActualAmount, pd.CashPayment, pd.OnlinePayment, pd.DuesAmount, pd.AdvanceBookingDate, pd.BookingStatus FROM PatientDetails pd WHERE pd.RegisteredOn=? AND pd.IsAdvanceBooking=1 ${upd} ORDER BY pd.Id DESC`, p()).then(([r]) => r),
            db().query(`SELECT pd.Id, pd.Name, pd.PhoneNumber, pd.GrossAmount, pd.CashPayment, pd.OnlinePayment, pd.CancelledBy, pd.CancelReason, pd.CancelledAt FROM PatientDetails pd WHERE pd.BookingStatus='cancelled' AND DATE(pd.CancelledAt)=? ${uca} ORDER BY pd.CancelledAt DESC`, userId ? [reportDate, userId] : [reportDate]).then(([r]) => r),
            db().query(`SELECT d.PatientId, pd.Name, pd.PhoneNumber, d.AmountCollected, d.PaymentMode, ops.Name AS OnlineSource, d.CollectedAt, d.CollectedBy FROM DuesCollectionLog d JOIN PatientDetails pd ON d.PatientId=pd.Id LEFT JOIN OnlinePaymentSources ops ON d.OnlineSourceId=ops.Id WHERE d.ShiftDate=? ${udc} ORDER BY d.CollectedAt DESC`, p()).then(([r]) => r),
        ]);

        return { success: true, date: reportDate, summary, onlineBreakdown, advanceBookings, cancellations, duesReceived };

    } catch (err) {
        log.error('getDailyReport:', err.message);
        return { success: false, message: `Report failed: ${err.message}` };
    }
};

const extractPatientDetailsFromUserInput = (req, isItCalledFromUpdate, isItForPatientHistoryLog = false) => {
    const cashPayment   = parseInt(req.body.cashPayment   || 0, 10);
    const onlinePayment = parseInt(req.body.onlinePayment || 0, 10);
    const grossAmount   = parseInt(req.body.grossAmount   || 0, 10);
    const [currDate, currTime] = currDateAndTime.getCurrentDateAndTime();

    const patientDetails = {
        Title:               req.body.title,
        Name:                req.body.patientName,
        Age:                 req.body.age,
        YMD:                 req.body.ymd,
        Gender:              req.body.gender,
        PhoneNumber:         req.body.phoneNumber,
        Address:             req.body.patientAddress,
        ActualAmount:        parseInt(req.body.grossAmount, 10) + parseInt(req.body.finalDiscount, 10),
        GrossAmount:         grossAmount,
        Discount:            req.body.finalDiscount,
        DiscountApprovedBy:  req.body.discountApprovedBy,
        ClinicId:            req.body.clinic,
        DoctorId:            req.body.doctor,
        CashPayment:         cashPayment,
        OnlinePayment:       onlinePayment,
        DuesAmount:          grossAmount - cashPayment - onlinePayment,
        Status:              1,
    };

    if (isItForPatientHistoryLog) return patientDetails;
    if (isItCalledFromUpdate) {
        patientDetails.UpdatedBy  = req.user.Id;
        patientDetails.UpdatedOn  = currDate;
        patientDetails.UpdateTime = currTime;
    } else {
        patientDetails.RegisteredBy   = req.user.Id;
        patientDetails.RegisteredOn   = currDate;
        patientDetails.RegisteredTime = currTime;
    }
    return patientDetails;
};

const getCreditedAmountForThePatient = async (conn, patientId) => {
    const [[row]] = await conn.execute(
        'SELECT CashPayment, OnlinePayment FROM PatientDetails WHERE Id=?', [patientId]
    );
    return row ? parseInt(row.CashPayment, 10) + parseInt(row.OnlinePayment, 10) : 0;
};

const registerDeliverablesForTests = async (testRefList, conn) => {
    for (const ref of testRefList) {
        const [[testMeta]] = await conn.query('SELECT CategoryId FROM MainTestTable WHERE Id=?', [ref.TestId]);
        if (!testMeta) { log.warn(`No Category found for TestId: ${ref.TestId}`); continue; }
        const [components] = await conn.query('SELECT ComponentType FROM CategoryComponents WHERE CategoryId=?', [testMeta.CategoryId]);
        if (components.length > 0) {
            await conn.query(
                'INSERT INTO TestDeliverables (PatientTestReferenceId, ComponentType) VALUES ?',
                [components.map(c => [ref.Id, c.ComponentType])]
            );
        }
    }
};

const VALID_TITLES = ['Dr.', 'Mr.', 'Mrs.', 'Miss', 'Master', 'Baby Of'];
const AGE_LIMITS   = { Years: 120, Months: 240, Days: 400 };

/** Patient fields only — prices/payments are checked in buildBill / validatePayment. */
const validateRegistration = (body) => {
    const errors = [];
    if (!VALID_TITLES.includes(str(body.title))) errors.push('Select a title (Mr., Mrs., …).');

    const name = str(body.patientName).replace(/\s+/g, ' ');
    if (name.length < 2)                       errors.push('Patient name must be at least 2 characters.');
    else if (name.length > 100)                errors.push('Patient name is too long (max 100 characters).');
    else if (!/^[\p{L}\p{M}\s.'\-()]+$/u.test(name)) errors.push('Patient name can contain only letters, spaces, dot, apostrophe and hyphen.');

    const ageStr = str(body.age), ymd = str(body.ymd), age = Number(ageStr);
    if (!AGE_LIMITS[ymd])                                  errors.push('Select the age unit (Years / Months / Days).');
    if (ageStr === '' || !Number.isInteger(age) || age < 0) errors.push('Age must be a whole number.');
    else if (AGE_LIMITS[ymd] && age > AGE_LIMITS[ymd])     errors.push(`Age cannot be more than ${AGE_LIMITS[ymd]} ${ymd.toLowerCase()}.`);
    else if (age === 0 && ymd === 'Years')                 errors.push('For babies under 1 year, enter age in Months or Days.');

    if (!['1', '2', '3'].includes(str(body.gender))) errors.push('Select gender.');

    const phone = str(body.phoneNumber);
    if (!/^[6-9]\d{9}$/.test(phone))  errors.push('Phone number must be a valid 10-digit mobile number.');
    else if (/^(\d)\1{9}$/.test(phone)) errors.push('Phone number is not valid.');

    if (str(body.patientAddress).length > 255) errors.push('Address is too long (max 255 characters).');
    if (!isPositiveInt(body.clinic)) errors.push('Select a clinic.');
    if (!isPositiveInt(body.doctor)) errors.push('Select the referring doctor.');

    return errors.length === 0 ? { valid: true } : { valid: false, errors };
};


// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// All public functions exported here. No mid-file module.exports assignments.
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
    getThanksRequesterNames,
    getPatientListWithDoctorDetail,
    getPatientDetails,
    searchPatient,
    patientPaymentDetails,
    updateDuesAmount,
    getDuesPatientListWithDoctorDetails,
    updatePatientDetails,
    getPatientTestDetail,
    getDailyDuesReceivedData,
    thanks,
    viewThanksPaidPatientList,
    isPatientWithTestExist,
    logPatientChanges,
    getPatientTimeLineData,
    setFilmOrReportCreatedStatus,
    setFilmOrReportDeliveredStatus,
    isPatientEneterdForTest,
    markTestsCompleted,
    registerPatient,
    collectDues,
    cancelPatient,
    getDailyReport,
    getOnlinePaymentSources,
    markArrived,
    searchPatientsWithDues,
    getPatientDuesDetail,
    getDuesReceived,
    checkCancelAuthorisation,
    getReferralReportData,
    getEditPatientPageData,
    getPatientHistory,
    getPatientSubTestDetail,
    markDeliverableDelivered,
    markDeliverableGenerated,
    getTestsWithDeliverables,
    isPatientReportExist,
    validateRegistration,
    extractPatientDetailsFromUserInput,
    getCreditedAmountForThePatient,
    registerDeliverablesForTests,
    calculateThanks,
    processReferral,
    reverseReferral,
    // new
    getClinicDoctorMap,
    buildBill,
    userError,
    // security patch
    newFormToken,
    parseMoney,
    canUserAccessPatient,
    checkDeliverable,
    loadEffectivePrices,
    loadBillVersion,
};
'use strict';

/**
 * patientController.js
 * Production-grade controller for all patient-related routes in SmartLab.
 *
 * Key design decisions:
 *  - Every exported function is wrapped in asyncHandler() so unhandled promise
 *    rejections never crash the process; they fall through to Express error middleware.
 *  - Notification objects are created by a single factory (mkNote).
 *  - View render calls are centralised (renderPatientList, renderHome) so
 *    a template rename only needs one edit.
 *  - All parallel I/O uses Promise.all / Promise.allSettled.
 *  - "throw string" is replaced with "throw new Error(string)" everywhere so
 *    stack traces are always available.
 *  - Flash messages use a single key 'flash' with a consistent shape
 *    { type, messages, icon } – matching the rest of the app.
 *
 * SECURITY PATCH (2026-10-24):
 *  - Registration form carries a one-time token; a repeated submit opens the bill already saved.
 *  - Edit form carries the bill version; a stale form cannot overwrite newer payments.
 *  - Every POST that changes data redirects afterwards (refresh no longer repeats a payment).
 *  - Reporting-doctor logins (role 2) can open only their own patients (detail, invoice, edit, dues…).
 *  - Cancel no longer redirects to any URL found in the Referer header (open redirect).
 *  - Edit-history / timeline pages need the same audit permission as the audit page.
 *  - Search results on the edit-history and dues pages were an object, not a list (page showed nothing).
 *  - ?message= in the URL is no longer shown as a green "success" box (fake-message links).
 */

const Clinic   = require('../models/Clinic');
const Category = require('../models/Category');
const Doctor   = require('../models/Doctor');
const Test     = require('../models/Test');
const User     = require('../models/User');
const Patient  = require('../models/Patient');
const PatientAudit = require('../services/PatientAuditService');
const moment   = require('moment');
require('dotenv').config();

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const BRAND = () => process.env.BRAND_NAME;   // lazy so .env changes are picked up
const PAGE_LIMIT = () => parseInt(process.env.PAGE_LIMIT, 10) || 20;

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY – asyncHandler
// Wraps async route handlers so any thrown error is forwarded to next()
// instead of leaving an unhandled rejection.  Use with Express error middleware.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {Function} fn  async (req, res, next) handler
 * @returns {Function}   Express-compatible middleware
 */
const asyncHandler = fn => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY – notification factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {'success'|'danger'|'warning'|'info'} type
 * @param {string|Error} messages
 * @param {string} icon  Bootstrap icon class
 * @param {boolean} [dismissible=true]
 */
const mkNote = (type, messages, icon, dismissible = true) => {
    let text;
    if (!messages)                       text = '';
    else if (messages instanceof Error)  text = messages.message;
    else if (typeof messages === 'object') text = messages.message || messages.msg || JSON.stringify(messages);
    else                                 text = String(messages);
    return { type, messages: text, icon, alertDismissible: dismissible };
};

const noteOk   = (msg)  => mkNote('success', msg,  'bi-check-circle-fill');
const noteBad  = (msg)  => mkNote('danger',  msg,  'bi-exclamation-triangle-fill');
const noteWarn = (msg)  => mkNote('warning', msg,  'bi-exclamation-triangle-fill');

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY – flash helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Read flash messages stored as a single object under key 'flash'. */
const readFlash = req => {
    const msgs = req.flash('flash') || [];
    return Array.isArray(msgs) ? msgs : [msgs];
};

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY – shared render helpers
// Centralise view names so a rename is a one-line change.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Render the patient list view.
 * Fetches all required data then renders.  All parameters are optional;
 * pass what you already have to avoid redundant DB calls.
 */
const renderPatientList = async (req, res, {
    notifications = [],
    patientDetails = null,
    doctorDetails  = null,
    categories     = null,
    onlineSources  = null,
    extra          = {},   // any extra template variables (doctorId, Status, etc.)
} = {}) => {
    const [pd, dd, cats, os] = await Promise.all([
        patientDetails ?? Patient.getPatientListWithDoctorDetail(req),
        doctorDetails  ?? Doctor.getDoctorList(),
        categories     ?? Category.getCategoryList(),
        onlineSources  ?? Patient.getOnlinePaymentSources(),
    ]);

    return res.render('Patient/getPatientListView', {
        patientDetails: pd,
        doctorDetails:  dd,
        categories:     cats,
        onlineSources:  os,
        notifications,
        title:      'Patient List',
        BRAND_NAME: BRAND(),
        layout:     'loggedInLayout',
        ...extra,
    });
};

/**
 * Render the home page with error notifications.
 * Kept as an explicit fallback for the rare case where a controller catches
 * an error internally and wants to render home directly (rather than calling next(err)).
 * In most cases asyncHandler + errorMiddleware handles this automatically.
 */
const renderHome = (res, error = null, customMessage = null) => {
    const notes = [];
    if (customMessage) notes.push(noteBad(customMessage));
    if (error)         notes.push(noteBad(error));

    return res.render('home', {
        notifications: notes,
        title:      'Home',
        BRAND_NAME: BRAND(),
        layout:     'loggedInLayout',
    });
};

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY – common data fetchers
// ─────────────────────────────────────────────────────────────────────────────

/** All dropdown/lookup data needed for registration & edit forms. */
const fetchRegistrationDropdowns = (clinicId = null) => Promise.all([
    Clinic.getClinicList(),
    Category.getCategoryList(),
    clinicId ? Doctor.getAttachedDoctorList(clinicId) : Doctor.getDoctorList(),
    Test.getTestDetails(),
    Test.getSubTestMap(),
    Test.getSubTestDetails(),
    Patient.getOnlinePaymentSources(),
]);

/** All data needed for the edit patient form (requires patientId). */
const fetchEditFormData = async (clinicId, patientId) => {
    const [clinics, categories, doctors, testDetails,
           patientTestDetails, subTestDetails, patientSubTestDetails] = await Promise.all([
        Clinic.getClinicList(),
        Category.getCategoryList(),
        Doctor.getAttachedDoctorList(clinicId),
        Test.getTestDetails(),
        Test.getPatientTestDetails(patientId),
        Test.getSubTestDetails(),
        Test.getPatientSubTestDetail(patientId),
    ]);

    return {
        clinics,
        categories,
        doctors,
        testDetails,
        subTestDetails,
        patientTestDetails:    JSON.stringify(patientTestDetails),
        patientSubTestDetails: JSON.stringify(patientSubTestDetails),
    };
};

/** Group sub-tests by parent TestId (used in getPatientDetail). */
const groupSubsByParent = (subTestDetails = []) => {
    return subTestDetails.reduce((map, s) => {
        if (!map[s.parentTestId]) map[s.parentTestId] = [];
        map[s.parentTestId].push(s);
        return map;
    }, {});
};

// ─────────────────────────────────────────────────────────────────────────────
// CONTROLLERS
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// REGISTER / EDIT — shared form  (views/Patient/patientForm.ejs)
// ─────────────────────────────────────────────────────────────────────────────

const flash = (req, type, message) => {
    if (typeof req.flash !== 'function') return;
    const text = Array.isArray(message) ? message.join('\n') : String(message || '');
    const icon = { success: 'bi-check-circle-fill', warning: 'bi-exclamation-triangle-fill', danger: 'bi-exclamation-triangle-fill', info: 'bi-info-circle-fill' }[type];
    req.flash('flash', { type, messages: text, icon });
};

const takeFlash = (req) => readFlash(req).filter(m => m && m.type).map(m => mkNote(m.type, m.messages, m.icon));

const toId = (v) => { const n = parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : null; };
const DETAIL_URL = (id) => `/patient/getPatientDetail?patientId=${encodeURIComponent(id)}`;
const LIST_URL   = '/patient/getPatientListView';

/** Only a same-site path we expect — never whatever the Referer header says (open redirect). */
const safeBack = (req, allowedPath, fallback) => {
    try {
        const u = new URL(req.get('Referer') || '', `${req.protocol}://${req.get('host')}`);
        if (u.host === req.get('host') && u.pathname === allowedPath) return u.pathname + u.search;
    } catch (_) { /* bad header */ }
    return fallback;
};

/** S8: false → flash + redirect already done, caller must return. */
const ensurePatientAccess = async (req, res, patientId, { json = false } = {}) => {
    if (await Patient.canUserAccessPatient(req.user, patientId)) return true;
    if (json) { res.status(403).json({ success: false, message: 'You do not have access to this patient.' }); return false; }
    flash(req, 'danger', 'You do not have access to this patient.');
    res.redirect(LIST_URL);
    return false;
};

/** Only ids and discounts from the browser — names and prices come from the test master again. */
const cleanTests = (raw) => safeJsonArray(raw).map(t => ({ TestId: toId(t && t.TestId), Discount: Number(t && t.Discount) || 0 })).filter(t => t.TestId);
const cleanSubs  = (raw) => safeJsonArray(raw).map(s => ({
    SubTestId: toId(s && s.SubTestId), mainTestId: toId(s && (s.mainTestId || s.MainTestId)), Discount: Number(s && s.Discount) || 0,
})).filter(s => s.SubTestId && s.mainTestId);

const FORM_FIELDS = ['title', 'patientName', 'gender', 'age', 'ymd', 'phoneNumber', 'patientAddress',
    'clinic', 'doctor', 'discountApprovedBy', 'cashPayment', 'onlinePayment', 'onlinePaymentMethod',
    'isEmergency', 'isAdvanceBooking', 'advanceBookingDate', 'editReason',
    'formToken', 'billVersion'];

const valuesFromBody = (b = {}) => {
    const v = {};
    FORM_FIELDS.forEach(k => { v[k] = b[k] === undefined || b[k] === null ? '' : String(b[k]); });
    return v;
};

const valuesFromPatient = (p, billVersion = '') => ({
    billVersion,
    title: p.Title || '', patientName: p.Name || '', gender: String(p.Gender || ''), age: p.Age ?? '',
    ymd: p.YMD || 'Years', phoneNumber: p.PhoneNumber || '', patientAddress: p.Address || '',
    clinic: p.ClinicId || '', doctor: p.DoctorId || '', discountApprovedBy: p.DiscountApprovedBy || '',
    cashPayment: p.CashPayment ?? 0, onlinePayment: p.OnlinePayment ?? 0, onlinePaymentMethod: p.OnlineSourceId || '',
    isEmergency: '', isAdvanceBooking: String(p.IsAdvanceBooking || 0), advanceBookingDate: '', editReason: '',
});

const safeJsonArray = (raw) => { try { const a = JSON.parse(raw || '[]'); return Array.isArray(a) ? a : []; } catch (_) { return []; } };

const loadFormData = async () => {
    const [clinics, doctors, clinicDoctorMap, categories, testDetails, subTestMap, onlineSources] = await Promise.all([
        Clinic.getClinicList(),
        Doctor.getDoctorList(),
        Patient.getClinicDoctorMap(),
        Category.getCategoryList(),
        Test.getTestDetails(),
        Test.getSubTestMap(),
        Patient.getOnlinePaymentSources(),
    ]);
    return {
        clinics: clinics || [], doctors: doctors || [], clinicDoctorMap: clinicDoctorMap || {},
        categories: categories || [], onlineSources: onlineSources || [], subTestMap: subTestMap || {},
        testDetails: (testDetails || []).filter(t => String(t.Status) === '1'),
    };
};

const renderPatientForm = async (res, {
    mode, patientId = null, patient = null, values, initialTests = [], initialSubTests = [],
    errors = [], warnings = [], notifications = [], status = 200,
}) => {
    const data = await loadFormData();
    res.status(status);
    return res.render('Patient/patientForm', {
        ...data, mode, patientId, patient, values, initialTests, initialSubTests,
        errors, warnings, notifications,
        maxChangeReturn: Number(process.env.MAX_CHANGE_RETURN) > 0 ? Number(process.env.MAX_CHANGE_RETURN) : 2000,
        title: mode === 'edit' ? 'Edit Patient' : 'Register Patient',
        BRAND_NAME: BRAND(), layout: 'loggedInLayout',
    });
};

const getPatientRegistrationPage = asyncHandler(async (req, res) => {
    return renderPatientForm(res, {
        mode: 'create',
        values: { ...valuesFromBody({}), ymd: 'Years', cashPayment: 0, onlinePayment: 0, formToken: Patient.newFormToken() },
        notifications: takeFlash(req),
    });
});

const registerPatientDetails = asyncHandler(async (req, res) => {
    const result = await Patient.registerPatient(req.body, req.user.Id, req.ip, req.headers['user-agent']);

    // Same form submitted twice (double click, refresh, back + submit) → open the bill saved the first time
    if (result.alreadySaved) {
        if (result.patientId) {
            flash(req, 'info', `This registration was already saved — Bill No ${result.patientId}. Nothing was registered twice.`);
            return res.redirect(DETAIL_URL(result.patientId));
        }
        flash(req, 'warning', 'This form was already submitted. Check the patient list before registering again.');
        return res.redirect(LIST_URL);
    }

    if (!result.success) {
        const values = valuesFromBody(req.body);
        if (!values.formToken) values.formToken = Patient.newFormToken();      // old cached page without a token
        return renderPatientForm(res, {
            mode: 'create',
            values,
            initialTests:    cleanTests(req.body.selectedTestDetails),
            initialSubTests: cleanSubs(req.body.selectedSubTestDetails),
            errors:  result.errors || [result.message || 'Registration failed.'],
            warnings: result.duplicateOf ? ['duplicate'] : [],
            status: 422,
        });
    }

    flash(req, 'success', result.message);
    (result.warnings || []).forEach(w => flash(req, 'warning', w));
    // PRG: refresh can no longer register the same patient twice
    return res.redirect(DETAIL_URL(result.patientId));
});

// ── Patient list view ────────────────────────────────────────────────────────


const getPatientListView = asyncHandler(async (req, res) => {
    const flashMsgs   = readFlash(req);
    const notifications = flashMsgs
        .filter(m => m && m.type)
        .map(m => mkNote(m.type, m.messages, m.icon));

    return renderPatientList(req, res, { notifications });
});

// ── Search patients (POST) ───────────────────────────────────────────────────

const searchPatient = asyncHandler(async (req, res) => {
    const notifications = [];

    const {
        FromDate              = moment().format('DD-MM-YYYY'),
        ToDate                = moment().format('DD-MM-YYYY'),
        BillNo                = '',
        Name                  = '',
        Doctor: doctorId      = '',
        Status                = '',
        MainCategory: categoryId = '',
        showAdvanceBookings   = '',
        page                  = '1',
        patientWithOnlyDuesAmount = '',
    } = req.body || {};

    const currentPage = Math.max(1, parseInt(page, 10) || 1);
    const limit       = PAGE_LIMIT();
    const offset      = (currentPage - 1) * limit;

    const [drResult, catResult, onlineSources] = await Promise.all([
        Promise.allSettled([Doctor.getDoctorList()]).then(r => r[0]),
        Promise.allSettled([Category.getCategoryList()]).then(r => r[0]),
        Patient.getOnlinePaymentSources(),
    ]);

    const doctorDetails = drResult.status  === 'fulfilled' ? drResult.value  : [];
    const categories    = catResult.status === 'fulfilled' ? catResult.value : [];

    if (drResult.status  === 'rejected') notifications.push(noteBad('Unable to load doctor list.'));
    if (catResult.status === 'rejected') notifications.push(noteBad('Unable to load category list.'));

    let patientDetails = [];
    let totalRecords   = 0;

    try {
        req.patientWithOnlyDuesAmount = (patientWithOnlyDuesAmount === '1');
        req.pagination = { limit, offset };

        const result   = await Patient.searchPatient(req);
        patientDetails = result.rows  || [];
        totalRecords   = result.total || 0;

        if (patientDetails.length === 0) {
            notifications.push(noteWarn('No patients found. Please adjust your search filters.'));
        }
    } catch (err) {
        console.error('searchPatient DB error:', err);
        notifications.push(noteBad(err.message || 'Search failed.'));
    }

    const totalPages = Math.max(1, Math.ceil(totalRecords / limit));

    return res.render('Patient/getPatientListView', {
        patientDetails,
        onlineSources,
        doctorDetails,
        categories,
        notifications,
        doctorId,
        Status,
        categoryId,
        Name,
        FromDate,
        ToDate,
        BillNo,
        showAdvanceBookings: (showAdvanceBookings === '1'),
        onlyDues:            (patientWithOnlyDuesAmount === '1'),   // keeps "Only dues" on while paging
        pagination: {
            currentPage,
            totalPages,
            totalRecords,
            pageLimit:   limit,
            hasNextPage: currentPage < totalPages,
            hasPrevPage: currentPage > 1,
            offset,
        },
        title:      'Patient List',
        BRAND_NAME: BRAND(),
        layout:     'loggedInLayout',
    });
});

// ── Edit patient (GET) ────────────────────────────────────────────────────────

// ── Edit patient (GET) — both old and new route names use the same handler ──

const getEditPatientPage = asyncHandler(async (req, res) => {
    const patientId = parseInt(req.query.id || req.query.patientId || req.params.id, 10);
    if (!Number.isInteger(patientId) || patientId <= 0) {
        flash(req, 'danger', 'Invalid patient ID.');
        return res.redirect('/patient/getPatientListView');
    }

    if (!(await ensurePatientAccess(req, res, patientId))) return;
    const data = await Patient.getEditPatientPageData(patientId);
    if (!data) {
        flash(req, 'danger', `Patient with Bill No ${patientId} not found.`);
        return res.redirect('/patient/getPatientListView');
    }
    if (Number(data.patientDetails.Status) === 0) {
        flash(req, 'danger', 'This patient is cancelled and cannot be edited.');
        return res.redirect(`/patient/getPatientDetail?patientId=${patientId}`);
    }

    const canEditLocked = await PatientAudit.canEditLockedBill(null, req.user.Id).catch(() => false);
    res.set('Cache-Control', 'no-store');      // back button must not show an old bill version
    return renderPatientForm(res, {
        mode: 'edit', patientId, patient: data.patientDetails,
        values: valuesFromPatient(data.patientDetails, data.billVersion),
        initialTests: data.tests.map(t => testLockFlags(t, canEditLocked)),
        initialSubTests: data.subTests,
        notifications: [...takeFlash(req), ...(await billLockNotice(patientId, req.user.Id))],
    });
});

/** Warns on the edit page when the bill is locked because a test is already done. */
const billLockNotice = async (patientId, userId) => {
    try {
        const lock = await PatientAudit.billLockStatus(patientId, userId);
        if (!lock.locked) return [];
        return [lock.canEdit
            ? mkNote('info', `${lock.tests.join(', ')} already done. You are authorised to change this bill — your name and reason will be saved in the audit log.`, 'bi-shield-check', false)
            : mkNote('warning', `${lock.tests.join(', ')} already done — the bill is locked. You can correct name, age, phone and address only. Ask an authorised person to change tests or amounts.`, 'bi-lock-fill', false)];
    } catch (e) { console.error('[Audit] lock status:', e.message); return []; }
};

/** Which tests the edit form must not let this user remove. */
const testLockFlags = (t, canEditLocked) => {
    const reported = t.ReportReady == 1;
    const started  = ['InProgress', 'Completed'].includes(t.TestStatus);
    return {
        TestId: t.TestId, TestName: t.TestName, Price: t.Price, Discount: t.Discount,
        locked: reported || (!canEditLocked && started),
        lockReason: reported ? 'Report ready' : (started ? t.TestStatus : ''),
    };
};

const editPatientDetails = getEditPatientPage;

// ── Update patient (POST) ────────────────────────────────────────────────────

const postUpdatePatientDetails = asyncHandler(async (req, res) => {
    const patientId = parseInt(req.query.id || req.query.patientId || req.params.id, 10);
    if (!Number.isInteger(patientId) || patientId <= 0) {
        flash(req, 'danger', 'Invalid patient ID.');
        return res.redirect('/patient/getPatientListView');
    }

    if (!(await ensurePatientAccess(req, res, patientId))) return;
    const result = await Patient.updatePatientDetails(patientId, req.body, req.user.Id, req.ip, req.headers['user-agent']);

    if (!result.success) {
        // Re-render with what the user typed (redirect lost all edits before,
        // and redirected to ?patientId= which the GET handler did not read)
        const data = await Patient.getEditPatientPageData(patientId);
        if (!data) {
            flash(req, 'danger', result.message);
            return res.redirect('/patient/getPatientListView');
        }
        const locked = new Map(data.tests.map(t => [String(t.TestId), t]));
        const canEditLocked = await PatientAudit.canEditLockedBill(null, req.user.Id).catch(() => false);
        return renderPatientForm(res, {
            mode: 'edit', patientId, patient: data.patientDetails,
            values: valuesFromBody(req.body),
            // names/prices from the bill (old tests) or the test master (new ones) — never from the browser
            initialTests: cleanTests(req.body.selectedTestDetails).map(t => {
                const old = locked.get(String(t.TestId));
                return { ...t, ...(old ? { ...testLockFlags(old, canEditLocked), Discount: t.Discount } : {}) };
            }),
            initialSubTests: cleanSubs(req.body.selectedSubTestDetails).map(s => {
                const old = data.subTests.find(x => Number(x.SubTestId) === s.SubTestId);
                return old ? { ...s, Name: old.Name, Price: old.Price } : s;
            }),
            errors: result.errors || [result.message],
            status: 422,
        });
    }

    flash(req, result.changesCount ? 'success' : 'info', result.message);
    (result.warnings || []).forEach(w => flash(req, 'warning', w));
    return res.redirect(`/patient/getPatientDetail?patientId=${patientId}`);
});


// ── Patient detail view ──────────────────────────────────────────────────────

const getPatientDetail = asyncHandler(async (req, res) => {
    const patientId = parseInt(req.query.patientId, 10);

    if (!Number.isInteger(patientId) || patientId <= 0) {
        flash(req, 'danger', 'Invalid patient ID.');
        return res.redirect('/patient/getPatientListView');
    }
    if (!(await ensurePatientAccess(req, res, patientId))) return;
    const exists = await Patient.getPatientDetails(patientId);
    if (!exists || !exists.length) {
        flash(req, 'danger', `Patient with Bill No ${patientId} not found.`);
        return res.redirect('/patient/getPatientListView');
    }

    const [
        patientDetail,
        patientTestDetailRaw,
        testsWithComponents,
        queueInfo,
        patientSubTestDetail,
    ] = await Promise.all([
        Patient.getPatientDetails(patientId),
        Patient.getPatientTestDetail(patientId),
        Patient.getTestsWithDeliverables(patientId),
        Patient.isPatientEneterdForTest(patientId),
        Patient.getPatientSubTestDetail(patientId),
    ]);

    // Attach sub-tests to parent tests
    const subsByParent    = groupSubsByParent(patientSubTestDetail);
    const patientTestDetail = patientTestDetailRaw.map(t => ({
        ...t,
        subTests: subsByParent[t.TestId] || [],
    }));

    const allTestsCompleted = patientTestDetail.every(t => t.TestStatus === 'Completed');

    // Build notifications
    // FIX: ?message=… from the URL was shown as a green success box — anyone could send a link like
    // "?patientId=12&message=Refund approved, call 98xxxxxx". Messages now come from flash only.
    const notifications = [];

    readFlash(req).forEach(m => {
        if (m && m.type) notifications.push(mkNote(m.type, m.messages, m.icon));
    });

    if (Number(patientDetail[0]?.Status) === 0) {
        notifications.push(mkNote('warning', 'This patient has been cancelled.', 'bi-exclamation-triangle-fill', false));
    }

    // Defensive defaults — queueInfo always has all keys (model returns safe
    // defaults on error), but guard here too so the EJS view never crashes
    // with "X is not defined" even if the model is changed in future.
    const safeQueue = queueInfo || {};

    return res.render('Patient/getPatientDetails', {
        patientId,
        testList:          testsWithComponents,
        notifications,
        patientDetail,
        allTestsCompleted,
        patientTestDetail,
        isPatientEntered:  safeQueue.isEntered    ?? false,
        isPatientExited:   safeQueue.isExited      ?? false,
        isTestIncomplete:  safeQueue.isIncomplete  ?? false,
        queueStatus:       safeQueue.status        ?? null,
        queueEntryTime:    safeQueue.entryTime      ?? null,
        queueExitTime:     safeQueue.exitTime       ?? null,
        isEmergency:       safeQueue.isEmergency    ?? false,
        title:      'Patient Test Detail',
        BRAND_NAME: BRAND(),
        layout:     'loggedInLayout',
    });
});

// ── Invoice ──────────────────────────────────────────────────────────────────

const getInvoice = asyncHandler(async (req, res) => {
    const patientId = toId(req.query.id);
    if (!patientId) throw new Error('Patient ID is required.');
    if (!(await ensurePatientAccess(req, res, patientId))) return;

    const [patientDetails, testDetails, subTestDetails] = await Promise.all([
        Patient.getPatientDetails(patientId),
        Test.getPatientTestDetails(patientId),
        Patient.getPatientSubTestDetail(patientId),
    ]);

    if (!patientDetails?.length) throw new Error('Patient not found.');

    const pd = patientDetails[0];
    pd.AmountPaid = parseFloat(pd.CashPayment || 0) + parseFloat(pd.OnlinePayment || 0);

    // Registered-by user name (non-fatal if missing)
    let registeredByName = 'Staff';
    try {
        // FIX: getUserName returns a string, so "u.fullName" was always undefined → every receipt said "Staff"
        const u = await User.getUserName(pd.RegisteredBy);
        const name = typeof u === 'string' ? u : (u && u.fullName);
        if (name && name.trim()) registeredByName = name.trim();
    } catch (_) { /* non-critical */ }

    // Attach sub-tests to parent tests
    const subsByParent  = groupSubsByParent(subTestDetails);
    const testsWithSubs = testDetails.map(t => ({
        ...t,
        subTests: subsByParent[t.TestId] || [],
    }));

    // Every print is recorded with the amounts on it (receipt-vs-bill fraud check).
    // Never block the print if logging fails.
    let receiptInfo = null;
    try {
        receiptInfo = await PatientAudit.logReceiptPrint({
            patientId: pd.PatientId || pd.Id, userId: req.user && req.user.Id, ip: req.ip, pd, tests: testDetails,
        });
    } catch (e) { console.error('[Audit] receipt print log failed:', e.message); }

    res.set('Cache-Control', 'no-store');
    return res.render('partials/downloadPatientBillingInvoice', {
        BRAND_NAME:                   process.env.BRAND_NAME,
        BRAND_QUOTE:                  process.env.BRAND_QUOTE,
        BRAND_SUB_QUOTE:              process.env.BRAND_SUB_QUOTE,
        BRAND_ADDRESS:                process.env.BRAND_ADDRESS,
        LANDMARK:                     process.env.LANDMARK,
        BRAND_CONTACT_NO:             process.env.BRAND_CONTACT_NO,
        BRAND_SECONDARY_CONTACT_N0:   process.env.BRAND_SECONDARY_CONTACT_N0,
        patientDetails,
        testDetails:    testsWithSubs,
        registeredByName,
        isCancelled:    Number(pd.Status) === 0,      // FIX: cancelled is Status 0 (was checking 2)
        receiptInfo,                                   // { printNo, isReprint, previous, changedSincePrevious }
        Discount:       pd.Discount  || 0,
        DuesAmount:     pd.DuesAmount || 0,
        layout:         false,
    });
});

// ── Cancel patient ───────────────────────────────────────────────────────────

const cancelPatient = asyncHandler(async (req, res) => {
    const patientId = parseInt(req.body?.cancelPatientId, 10);
    const reason    = String(req.body?.reason || '').trim();

    if (!patientId) {
        flash(req, 'danger', 'Patient ID not found. Please try again.');
    } else if (!(await Patient.canUserAccessPatient(req.user, patientId))) {
        flash(req, 'danger', 'You do not have access to this patient.');
    } else if (reason.length < 5) {
        flash(req, 'danger', 'Please write a proper reason for cancellation (at least 5 characters).');
    } else if (reason.length > 500) {
        flash(req, 'danger', 'Cancellation reason is too long (max 500 characters).');
    } else {
        // FIX: result object was always shown as a GREEN message, even when cancellation failed
        const result = await Patient.cancelPatient({ patientId, cancelledBy: req.user.Id, cancelReason: reason, path: req.path,
                                                     ip: req.ip, userAgent: req.headers['user-agent'] });
        flash(req, result.success ? 'success' : 'danger', result.message);
        if (result.success && result.warnings && result.warnings.length) flash(req, 'warning', result.warnings);
    }
    // FIX: the old regex accepted "https://evil.site/patient/getPatientDetail" from the Referer header
    return res.redirect(safeBack(req, '/patient/getPatientDetail', LIST_URL));
});


// ── Dues views ───────────────────────────────────────────────────────────────

const getDuesView = asyncHandler(async (req, res) => {
    const body = {
        FromDate: moment().format('DD-MM-YYYY'),
        ToDate:   moment().format('DD-MM-YYYY'),
    };

    const [result, onlineSources, doctorDetails] = await Promise.all([
        Patient.searchPatientsWithDues(body),
        Patient.getOnlinePaymentSources(),
        Doctor.getDoctorList(),
    ]);

    return res.render('Patient/trackDuesAmount', {
        patients:     result.patients,
        onlineSources,
        doctorDetails,
        FromDate:     body.FromDate,
        ToDate:       body.ToDate,
        title:        'Patients with Dues',
        BRAND_NAME:   BRAND(),
        layout:       'loggedInLayout',
    });
});

const searchDues = asyncHandler(async (req, res) => {
    const [result, onlineSources, doctorDetails] = await Promise.all([
        Patient.searchPatientsWithDues(req.body),
        Patient.getOnlinePaymentSources(),
        Doctor.getDoctorList(),
    ]);

    return res.render('Patient/trackDuesAmount', {
        patients:     result.patients,
        onlineSources,
        doctorDetails,
        FromDate:     req.body.FromDate,
        ToDate:       req.body.ToDate,
        Name:         req.body.Name,
        BillNo:       req.body.BillNo,
        Doctor:       req.body.Doctor,
        title:        'Patient List With Dues',
        BRAND_NAME:   BRAND(),
        layout:       'loggedInLayout',
    });
});

// ── Collect dues (AJAX / JSON) ───────────────────────────────────────────────

const collectDues = asyncHandler(async (req, res) => {
    const { patientId, cashAmount, onlineAmount, onlineSourceId, requestToken } = req.body;
    const pid = toId(patientId);
    if (!pid) return res.status(400).json({ success: false, message: 'Invalid patient.' });
    if (!(await ensurePatientAccess(req, res, pid, { json: true }))) return;

    // amounts go to the model as typed — it rejects "-100", "1e5", "12abc" instead of silently using parseFloat
    const result = await Patient.collectDues({
        patientId:      pid,
        cashAmount, onlineAmount,
        onlineSourceId: toId(onlineSourceId),
        requestToken,
        collectedBy:    req.user.Id,
        ip:             req.ip,
        userAgent:      req.headers['user-agent'],
    });

    return res.json(result);          // status stays 200 — the dues screen reads result.success
});

const getPatientDuesDetail = asyncHandler(async (req, res) => {
    const pid = toId(req.query.patientId);
    if (!pid) return res.status(400).json({ success: false, message: 'Invalid patient.' });
    if (!(await ensurePatientAccess(req, res, pid, { json: true }))) return;
    res.set('Cache-Control', 'no-store');
    return res.json(await Patient.getPatientDuesDetail(pid));
});

// ── Update dues (legacy modal) ───────────────────────────────────────────────
// FIX: read the bill outside any lock, wrote absolute totals back, booked money without ShiftDate /
// type (missing from the cash report), and re-rendered the detail page after POST (refresh = pay twice).
// Now it is the same locked collectDues as the new screen, followed by a redirect.

const updateDuesAmount = asyncHandler(async (req, res) => {
    const pid = toId(req.query.patientId || req.body.patientId);
    if (!pid) { flash(req, 'danger', 'Invalid patient.'); return res.redirect(LIST_URL); }
    if (!(await ensurePatientAccess(req, res, pid))) return;

    const result = await Patient.collectDues({
        patientId:      pid,
        cashAmount:     req.body.cashPayment,
        onlineAmount:   req.body.onlinePayment,
        onlineSourceId: toId(req.body.onlinePaymentMethod || req.body.onlineSourceId),
        requestToken:   req.body.requestToken,
        collectedBy:    req.user.Id,
        notes:          'Dues received (old screen)',
        ip:             req.ip,
        userAgent:      req.headers['user-agent'],
        requireSource:  false,
    });
    flash(req, result.success ? 'success' : 'danger', result.message);
    return res.redirect(DETAIL_URL(pid));
});

// ── Dues received view ───────────────────────────────────────────────────────

const getDuesReceivedView = asyncHandler(async (req, res) => {
    const body = Object.keys(req.body || {}).length
        ? req.body
        : { FromDate: moment().format('DD-MM-YYYY'), ToDate: moment().format('DD-MM-YYYY') };

    const [result, staffList] = await Promise.all([
        Patient.getDuesReceived(body),
        User.getUserWithReceptionPrivilege(),
    ]);

    return res.render('Patient/getDailyDuesReceived', {
        duesReceived: result.duesReceived,
        staffList,
        FromDate:    body.FromDate,
        ToDate:      body.ToDate,
        Name:        body.Name,
        CollectedBy: body.CollectedBy,
        title:       'Daily Dues Received',
        BRAND_NAME:  BRAND(),
        layout:      'loggedInLayout',
    });
});

const searchDuesReceived = asyncHandler(async (req, res) => {
    const [result, staffList] = await Promise.all([
        Patient.getDuesReceived(req.body),
        User.getUserWithReceptionPrivilege(),
    ]);

    return res.render('Patient/getDailyDuesReceived', {
        duesReceived: result.duesReceived,
        staffList,
        FromDate:    req.body.FromDate,
        ToDate:      req.body.ToDate,
        Name:        req.body.Name,
        CollectedBy: req.body.CollectedBy,
        title:       'Daily Dues Received',
        BRAND_NAME:  BRAND(),
        layout:      'loggedInLayout',
    });
});

// ── Mark arrived / advance booking payment ───────────────────────────────────

const markArrived = asyncHandler(async (req, res) => {
    const { patientId, cashAmount, onlineAmount, onlineSourceId, requestToken } = req.body;
    const pid = toId(patientId);
    if (pid && !(await ensurePatientAccess(req, res, pid))) return;

    const result = await Patient.markArrived({
        patientId:      pid,
        cashAmount, onlineAmount,                     // validated strictly in the model
        onlineSourceId: toId(onlineSourceId),
        requestToken,
        collectedBy:    req.user.Id,
        ip:             req.ip,
        userAgent:      req.headers['user-agent'],
    });

    req.flash('flash', result.success
        ? { type: 'success', messages: result.message,  icon: 'bi-check-circle-fill' }
        : { type: 'danger',  messages: result.message,  icon: 'bi-exclamation-triangle-fill' });

    return res.redirect('/patient/getPatientListView');
});

// ── Deliverable: mark generated / delivered ──────────────────────────────────

/**
 * All four deliverable handlers: the test line must belong to the patient in the form, the item must be
 * Report/Film, the patient must be active, and delivery needs dues cleared (or an authorised user).
 * FIX: the two old handlers re-rendered the page after POST and accepted any patientTestRefId /
 * componentType; the redirect URL was built from an unchecked body value.
 */
const deliverableAction = (kind) => asyncHandler(async (req, res) => {
    const { patientTestRefId, componentType, patientId, deliveredTo } = req.body;
    const pid = toId(patientId);
    if (!pid) { flash(req, 'danger', 'Required details are missing. Reload the page.'); return res.redirect(LIST_URL); }
    if (!(await ensurePatientAccess(req, res, pid))) return;

    const forDelivery = kind === 'deliver' || kind === 'deliverOld';
    const check = await Patient.checkDeliverable({ patientTestRefId, patientId: pid, componentType, userId: req.user.Id, forDelivery });
    if (!check.ok) { flash(req, 'danger', check.message); return res.redirect(DETAIL_URL(pid)); }

    const item = String(componentType);
    try {
        if (kind === 'generate' || kind === 'generateOld') {
            const updated = await Patient.markDeliverableGenerated(toId(patientTestRefId), item, req.user.Id);
            flash(req, updated ? 'success' : 'warning', updated ? `${item} marked as generated.` : `${item} was already generated.`);
        } else if (kind === 'deliver') {
            const updated = await Patient.markDeliverableDelivered(toId(patientTestRefId), item, req.user.Id, String(deliveredTo || '').slice(0, 100));
            flash(req, updated ? 'success' : 'warning', updated
                ? `${item} marked as delivered to ${String(deliveredTo).trim()}.`
                : `Could not mark delivered — the ${item.toLowerCase()} must be generated first (or it is already delivered).`);
        } else {
            const r = await Patient.setFilmOrReportDeliveredStatus(toId(patientTestRefId), req.user.Id, item);
            flash(req, r.affectedRows ? 'success' : 'warning', r.affectedRows ? `${item} marked as delivered.` : `${item} must be generated first (or it is already delivered).`);
        }
    } catch (err) {
        // markDeliverableDelivered throws when "delivered to" is empty — used to end on the error page
        flash(req, 'danger', err.message || 'Could not update.');
    }
    return res.redirect(DETAIL_URL(pid));
});

const filmOrReportGenerated = deliverableAction('generateOld');
const fimOrReportDelivered  = deliverableAction('deliverOld');
const postMarkGenerated     = deliverableAction('generate');
const postMarkDelivered     = deliverableAction('deliver');

// ── Mark tests completed ─────────────────────────────────────────────────────

const markTestCompleted = asyncHandler(async (req, res) => {
    const pid = toId(req.params.patientId);
    if (!pid) { flash(req, 'danger', 'Invalid patient.'); return res.redirect(LIST_URL); }
    if (!(await ensurePatientAccess(req, res, pid))) return;
    const { selectedTests } = req.body;

    if (!selectedTests || !selectedTests.length) {
        flash(req, 'warning', 'Please select at least one test.');
        return res.redirect(DETAIL_URL(pid));
    }

    try {
        await Patient.markTestsCompleted(pid, selectedTests);
        flash(req, 'success', 'Selected tests marked as completed.');
    } catch (err) {
        if (!err.isUserError) console.error('markTestCompleted:', err);
        flash(req, 'danger', err.userMessages || 'Could not mark the tests completed. Please try again.');
    }
    return res.redirect(DETAIL_URL(pid));
});

// ── Check cancel authorisation (AJAX) ────────────────────────────────────────

const checkCancelAuthorisation = asyncHandler(async (req, res) => {
    const pid = toId(req.body.patientId);
    if (!pid) return res.json({ allowed: false, message: 'Invalid patient.' });
    if (!(await ensurePatientAccess(req, res, pid, { json: true }))) return;
    const result = await Patient.checkCancelAuthorisation(pid, req.user.Id, req.path);
    return res.json(result);
});

// ── Doctor list for clinic (AJAX) ────────────────────────────────────────────

const getListOfAttachedDoctorToClinic = asyncHandler(async (req, res) => {
    const doctors = await Doctor.getAttachedDoctorList(req.body.clinicId);
    return res.json(doctors);
});

// ── Patient history / timeline ───────────────────────────────────────────────

const getPatientTimeLine = asyncHandler(async (req, res) => {
    const patientId = toId(req.params.patientId);
    if (!patientId) { flash(req, 'danger', 'Invalid patient ID.'); return res.redirect(LIST_URL); }
    // FIX: the audit page needs the "patientAudit" permission, but this timeline showed the same audit rows to anyone
    if (!(await PatientAudit.userCan(req.user.Id, 'view'))) {
        flash(req, 'danger', 'You do not have permission to view the patient audit history.');
        return res.redirect(DETAIL_URL(patientId));
    }
    if (!(await ensurePatientAccess(req, res, patientId))) return;
    const data = await Patient.getPatientTimeLineData(patientId);

    const groupedLogs = data.reduce((acc, log) => {
        const key = moment(log.ChangedAt).format('YYYY-MM-DD HH:mm');
        if (!acc[key]) acc[key] = [];
        acc[key].push(log);
        return acc;
    }, {});

    return res.render('getPatientTimeLine', {
        groupedEntries: Object.entries(groupedLogs),
        moment,
        title:      'Patient Timeline',
        BRAND_NAME: BRAND(),
        layout:     'loggedInLayout',
    });
});

const getPatientHistoryPage = asyncHandler(async (req, res) => {
    const patientId = parseInt(req.query.patientId || req.params.patientId, 10);

    if (!Number.isInteger(patientId) || patientId <= 0) {
        flash(req, 'danger', 'Invalid patient ID.');
        return res.redirect('/patient/getPatientListView');
    }
    // Only Admin or users with the "patientAudit" permission may see the audit trail
    if (!(await PatientAudit.userCan(req.user.Id, 'view'))) {
        flash(req, 'danger', 'You do not have permission to view the patient audit history.');
        return res.redirect(`/patient/getPatientDetail?patientId=${patientId}`);
    }
    if (!(await ensurePatientAccess(req, res, patientId))) return;

    const view = await PatientAudit.getPatientAuditView(patientId);
    if (!view) {
        flash(req, 'danger', `Patient with Bill No ${patientId} not found.`);
        return res.redirect('/patient/getPatientListView');
    }

    res.set('Cache-Control', 'no-store');
    return res.render('Patient/patientDetailsChangedHistory', {
        patientId,
        ...view,
        canReview:     await PatientAudit.userCan(req.user.Id, 'review'),
        currentUserId: req.user.Id,
        notifications: takeFlash(req),
        title:      `Audit — ${view.patient.Name} (Bill ${patientId})`,
        BRAND_NAME: BRAND(),
        layout:     'loggedInLayout',
    });
});

/** Edit-history list pages: same permission as the audit page (they lead to it). */
const ensureAuditViewer = async (req, res) => {
    if (await PatientAudit.userCan(req.user.Id, 'view')) return true;
    flash(req, 'danger', 'You do not have permission to view the patient edit history.');
    res.redirect(LIST_URL);
    return false;
};

const getPatientHistory = asyncHandler(async (req, res) => {
    if (!(await ensureAuditViewer(req, res))) return;
    const [patientDetails, doctorDetails, categories] = await Promise.all([
        Patient.getPatientListWithDoctorDetail(req),
        Doctor.getDoctorList(),
        Category.getCategoryList(),
    ]);

    return res.render('getPatientDetailsChangeHistory', {
        patientDetails,
        categories,
        doctorDetails,
        title:      'Patient Edit History',
        BRAND_NAME: BRAND(),
        layout:     'loggedInLayout',
    });
});

const getSearchedPatientList = asyncHandler(async (req, res) => {
    const {
        FromDate = moment().format('DD-MM-YYYY'),
        ToDate   = moment().format('DD-MM-YYYY'),
        BillNo   = '',
        Name     = '',
        Doctor: doctorId    = '',
        Status               = '',
        MainCategory: categoryId = '',
    } = req.body || {};

    if (!(await ensureAuditViewer(req, res))) return;
    const notifications = [];

    const [drResult, catResult] = await Promise.allSettled([
        Doctor.getDoctorList(),
        Category.getCategoryList(),
    ]);

    const doctorDetails = drResult.status  === 'fulfilled' ? drResult.value  : [];
    const categories    = catResult.status === 'fulfilled' ? catResult.value : [];

    if (drResult.status  === 'rejected') notifications.push(noteBad('Unable to load doctor list.'));
    if (catResult.status === 'rejected') notifications.push(noteBad('Unable to load category list.'));

    let patientDetails = [];
    try {
        req.patientWithOnlyDuesAmount = false;
        req.pagination = { limit: 500, offset: 0 };
        // FIX: searchPatient returns { rows, total } — the page got an object and always said "No patients found"
        patientDetails = (await Patient.searchPatient(req)).rows || [];

        if (!patientDetails.length) {
            notifications.push(noteWarn('No patients found with the given search parameters.'));
        }
    } catch (err) {
        console.error('getSearchedPatientList:', err);
        notifications.push(noteBad('Search failed. Please try again.'));
    }

    // Single render call (original had two, causing "headers already sent")
    return res.render('getPatientDetailsChangeHistory', {
        patientDetails,
        doctorId,
        Status,
        categories,
        categoryId,
        Name,
        FromDate,
        ToDate,
        BillNo,
        doctorDetails,
        notifications,
        title:      'Patient List',
        BRAND_NAME: BRAND(),
        layout:     'loggedInLayout',
    });
});

// ── Thanks / commission ──────────────────────────────────────────────────────

const thanks = asyncHandler(async (req, res) => {
    const patientId = parseInt(req.query.patientId || req.body.patientId, 10);
    if (patientId && !(await ensurePatientAccess(req, res, patientId))) return;
    try {
        flash(req, 'success', await Patient.thanks(req));
    } catch (err) {
        if (!err.isUserError) console.error('thanks:', err);
        flash(req, 'danger', err.userMessages || ['Could not save the thanks. Please try again.']);
    }
    return res.redirect(`/patient/getPatientDetail?patientId=${patientId || ''}`);
});


/**
 * Thanks-paid list — GET (first load, defaults to this month), POST search,
 * and the old "commission" route all use this one handler.
 * FIX: "commission" rendered the page without doctorDetails/fromDate → crashed.
 */
const renderThanksPaidList = async (req, res) => {
    const notifications = takeFlash(req);
    const doctorDetails = await Doctor.getDoctorList();
    let data;
    try {
        data = await Patient.viewThanksPaidPatientList(req);
    } catch (err) {
        if (!err.isUserError) console.error('thanksPaidList:', err);
        notifications.push(mkNote('danger', err.userMessages || err.message || 'Could not load the list.', 'bi-exclamation-triangle-fill'));
        data = await Patient.viewThanksPaidPatientList({ body: {} });
    }
    if (!data.rows.length) notifications.push(mkNote('info', 'No thanks payments found for these filters.', 'bi-info-circle-fill'));
    if (data.truncated)    notifications.push(mkNote('warning', 'Showing the latest 2,000 entries only. Narrow the date range to see all.', 'bi-exclamation-circle-fill'));

    res.set('Cache-Control', 'no-store');
    return res.render('viewThanksPaidList', {
        ...data,
        patientsList: data.rows,              // older name, kept for compatibility
        doctorDetails,
        notifications,
        fromDate: data.filters.FromDate, toDate: data.filters.ToDate,
        Name: data.filters.Name, doctorId: data.filters.Doctor,
        title:      'Thanks Paid Patients',
        BRAND_NAME: BRAND(),
        layout:     'loggedInLayout',
    });
};

const viewThanksPaidPatientList = asyncHandler(renderThanksPaidList);
const commission               = asyncHandler(renderThanksPaidList);

// ── Misc ─────────────────────────────────────────────────────────────────────

const reportpatient = (req, res) => {
    return res.render('reporting', { title: 'Patient Report Detail', BRAND_NAME: BRAND() });
};

const dailyDuesReceived = asyncHandler(async (req, res) => {
    const { FromDate, ToDate } = req.body;
    const duesReceivedDetails = await Patient.getDailyDuesReceivedData(req);

    return res.render('Patient/getDailyDuesReceived', {
        duesReceivedDetails,
        FromDate,
        ToDate,
        title:      'Daily Dues Received',
        BRAND_NAME: BRAND(),
        layout:     'loggedInLayout',
    });
});

const searchPatientWithDuesAmount = asyncHandler(async (req, res) => {
    req.patientWithOnlyDuesAmount = true;
    req.body.Status = 1;  // only active patients with dues

    req.pagination = { limit: 500, offset: 0 };
    const [[searchResult, doctorDetails], onlineSources] = await Promise.all([
        Promise.all([
            Patient.searchPatient(req),
            Doctor.getDoctorList(),
        ]),
        Patient.getOnlinePaymentSources(),
    ]);
    const patientDetails = (searchResult && searchResult.rows) || [];   // FIX: was the { rows, total } object

    return res.render('Patient/trackDuesAmount', {
        patientDetails,   // original template uses patientDetails (not patients)
        onlineSources,
        doctorId:  req.body.Doctor,
        Name:      req.body.Name,
        FromDate:  req.body.FromDate,
        ToDate:    req.body.ToDate,
        BillNo:    req.body.BillNo,
        doctorDetails,
        title:      'Patient List',
        BRAND_NAME: BRAND(),
        layout:     'loggedInLayout',
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS  – all names kept identical to original router bindings
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
    getPatientRegistrationPage,
    getListOfAttachedDoctorToClinic,
    registerPatientDetails,
    getInvoice,
    getPatientListView,
    searchPatient,
    editPatientDetails,
    updateDuesAmount,
    getPatientDetail,
    reportpatient,
    dailyDuesReceived,
    cancelPatient,
    searchPatientWithDuesAmount,
    thanks,
    commission,
    viewThanksPaidPatientList,
    getPatientTimeLine,
    getPatientHistory,
    getSearchedPatientList,
    fimOrReportDelivered,
    filmOrReportGenerated,
    markTestCompleted,
    markArrived,
    getDuesView,
    searchDues,
    collectDues,
    getPatientDuesDetail,
    searchDuesReceived,
    getDuesReceivedView,
    checkCancelAuthorisation,
    postUpdatePatientDetails,
    getEditPatientPage,
    getPatientHistoryPage,
    postMarkGenerated,
    postMarkDelivered,
};
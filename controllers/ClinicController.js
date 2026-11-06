'use strict';

/**
 * controllers/clinicController.js — SmartLab clinic controller
 *
 * Fixes in this version:
 *  - Validation never ran: `req.validationErrors || []` is a FUNCTION in old
 *    express-validator (length 0) / undefined in new → every form passed.
 *    Validation now lives in the model and returns clear messages.
 *  - updateClinicDetails threw BEFORE its try/catch → unhandled rejection,
 *    browser kept loading forever. Also used undefined variable `id`.
 *  - Edit without uploading a new image crashed on `req.files.clinicPrescription`
 *    AFTER the clinic was already saved → user saw an error for a successful save.
 *  - Register used multer API (`req.files.x[0]`), update used express-fileupload
 *    API (`.mv()`): one of them always failed. Both are supported now.
 *  - fs.rename callback pushed notifications after the page was already sent
 *    (message lost); rename across disks fails with EXDEV. Now awaited + atomic.
 *  - Image file name came from the clinic name → path traversal / overwrite.
 *  - Attach/detach showed "[object Object]" (model returned objects).
 *  - Detach was a GET link → link prefetchers / crawlers could remove doctors.
 *    It is now POST.
 *  - Clinic list with zero clinics sent the user to Home with an error;
 *    now shows an empty state with a "Register clinic" button.
 *  - After POST the page was rendered directly → refresh re-submitted the form
 *    (duplicate clinics). Now Post-Redirect-Get with flash messages.
 *  - Notifications received raw Error objects.
 */

const multer = require('multer');
const Clinic = require('../models/Clinic');
const Doctor = require('../models/Doctor');
const User   = require('../models/User');

const LIST_URL   = '/clinic/getClinicListView';
const NEW_URL    = '/clinic/registerClinic';
const EDIT_URL   = (id) => `/clinic/updateClinicDetails/${id}`;
const DOCS_URL   = (id) => `/clinic/attachDoctor/${id}`;
const IS_PROD    = process.env.NODE_ENV === 'production';
const MAX_HEADER = 5 * 1024 * 1024;

const ICONS = {
    success: 'bi-check-circle-fill',
    danger:  'bi-exclamation-triangle-fill',
    warning: 'bi-exclamation-circle-fill',
    info:    'bi-info-circle-fill',
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const createNotification = (type, messages, icon) => ({
    type,
    messages: messages instanceof Error ? messages.message : (Array.isArray(messages) ? messages.join('\n') : String(messages || '')),
    icon: icon || ICONS[type],
});

const flash = (req, type, message) => {
    if (typeof req.flash === 'function')
        req.flash('flash', { type, messages: Array.isArray(message) ? message.join('\n') : String(message), icon: ICONS[type] });
};

const takeFlash = (req) => {
    if (typeof req.flash !== 'function') return [];
    const raw = req.flash('flash') || [];
    return (Array.isArray(raw) ? raw : [raw]).filter(m => m && m.type).map(m => createNotification(m.type, m.messages, m.icon));
};

const render = (res, view, data) => res.render(view, { BRAND_NAME: process.env.BRAND_NAME, layout: 'loggedInLayout', ...data });

const friendlyErrors = (err) => {
    if (err && err.isUserError) return err.userMessages;
    switch (err && err.code) {
        case 'ER_DUP_ENTRY':           return ['This record already exists (duplicate email, phone or doctor link).'];
        case 'ER_DATA_TOO_LONG':       return ['One of the values is too long. Please shorten it and try again.'];
        case 'ER_NO_REFERENCED_ROW':
        case 'ER_NO_REFERENCED_ROW_2': return ['A selected item (user / doctor) no longer exists. Refresh the page and try again.'];
        case 'ER_LOCK_WAIT_TIMEOUT':
        case 'ER_LOCK_DEADLOCK':       return ['The database is busy. Please try again.'];
        case 'ECONNREFUSED':
        case 'PROTOCOL_CONNECTION_LOST':
        case 'ETIMEDOUT':              return ['Cannot reach the database server. Please check the server and try again.'];
        case 'LIMIT_FILE_SIZE':        return ['The prescription header image is larger than 5 MB.'];
        default:
            return ['Something went wrong.' + (IS_PROD ? ' Please try again.' : ' (' + ((err && err.message) || err) + ')')];
    }
};

const logError = (where, err) => {
    if (err && err.isUserError) return;
    console.error(`[clinicController] ${where}:`, err && err.code, (err && err.stack) || err);
};

const userName = (u) => [u.FirstName, u.LastName].filter(Boolean).join(' ') || u.Email || `User #${u.Id}`;

// ─────────────────────────────────────────────────────────────────────────────
// UPLOAD — works with multer OR a global express-fileupload middleware
// ─────────────────────────────────────────────────────────────────────────────

const headerParser = multer({
    storage: multer.memoryStorage(),
    limits:  { fileSize: MAX_HEADER, files: 1, fields: 40, fieldSize: 64 * 1024 },
}).single('clinicPrescription');

/** Parse multipart only if nothing upstream already did it. */
const parseClinicForm = (backUrl) => (req, res, next) => {
    const alreadyParsed = req.files || (req.body && Object.keys(req.body).length);
    if (alreadyParsed || !req.is('multipart/form-data')) return next();
    headerParser(req, res, (err) => {
        if (!err) return next();
        flash(req, 'danger', err.code === 'LIMIT_FILE_SIZE'
            ? 'The prescription header image is larger than 5 MB. Crop a smaller area and try again.'
            : 'Upload failed: ' + err.message);
        return res.redirect(typeof backUrl === 'function' ? backUrl(req) : backUrl);
    });
};

/** Returns the uploaded header as a Buffer (or null), whatever upload library is in use. */
const readHeaderUpload = async (req) => {
    const fsp = require('fs/promises');
    let f = req.file || (req.files && req.files.clinicPrescription);
    if (Array.isArray(f)) f = f[0];                     // multer .fields()
    if (!f) return null;

    const size = f.size || (f.data && f.data.length) || 0;
    if (size > MAX_HEADER) throw Clinic.userError('The prescription header image is larger than 5 MB.');

    if (f.buffer)                     return f.buffer;                       // multer memory
    if (f.data && f.data.length)      return f.data;                         // express-fileupload (memory)
    const p = f.path || f.tempFilePath;                                      // disk storage
    if (p) { try { return await fsp.readFile(p); } finally { fsp.unlink(p).catch(() => {}); } }
    return null;
};

// ─────────────────────────────────────────────────────────────────────────────
// FORM (shared by register + update)
// ─────────────────────────────────────────────────────────────────────────────

const EMPTY = {
    ClinicName: '', Email: '', PhoneNumber: '', SecondaryNumber: '', Address: '', AdditionalAddress: '',
    KeyArea: '', Pincode: '', City: '', State: 'Bihar', LandMark: '', AssignedId: '',
};

const valuesFromClinic = (c) => ({
    ClinicName: c.Name || '', Email: c.Email || '', PhoneNumber: c.PhoneNumber || '',
    SecondaryNumber: c.SecondaryNumber || '', Address: c.Address || '', AdditionalAddress: c.AdditionalAddress || '',
    KeyArea: c.KeyArea || '', Pincode: c.Pincode || '', City: c.City || '', State: c.State || '',
    LandMark: c.LandMark || '', AssignedId: c.AssignedTo || '',
});

const valuesFromBody = (b = {}) => {
    const v = { ...EMPTY };
    Object.keys(EMPTY).forEach(k => { if (b[k] !== undefined) v[k] = String(b[k]); });
    return v;
};

const renderForm = async (res, { mode, clinicId = null, values, errors = [], notifications = [], hasHeader = false, status = 200 }) => {
    const users = await User.getUserList();
    res.status(status);
    return render(res, 'Clinic/clinicForm', {
        title: mode === 'edit' ? 'Update Clinic' : 'Register Clinic',
        mode, clinicId, values, errors, notifications, hasHeader, users: users || [],
    });
};

const validUserIdSet = async () => new Set((await User.getUserList() || []).map(u => Number(u.Id)));

// ─────────────────────────────────────────────────────────────────────────────
// PAGES
// ─────────────────────────────────────────────────────────────────────────────

const getHomePage = (req, res) => render(res, 'home', { title: 'Home', user: req.user, notifications: takeFlash(req) });

const getClinicListView = asyncHandler(async (req, res) => {
    const [clinics, users] = await Promise.all([Clinic.getClinicList(), User.getUserList()]);
    const names = new Map((users || []).map(u => [String(u.Id), userName(u)]));
    const clinicDetails = clinics.map(c => ({
        ...c,
        AssignedName: names.get(String(c.AssignedTo)) || '—',
        HasHeader:    !!Clinic.findHeaderFile(c),
    }));
    return render(res, 'getClinicListView', {
        title: 'Clinics', clinicDetails, notifications: takeFlash(req),
    });
});

const getClinicRegistrationPage = asyncHandler(async (req, res) => {
    const users = await User.getUserList();
    if (!users || !users.length) {
        flash(req, 'warning', 'Create at least one staff user first — every clinic needs a marketing person.');
        return res.redirect(LIST_URL);
    }
    return renderForm(res, { mode: 'create', values: { ...EMPTY }, notifications: takeFlash(req) });
});

const registerClinic = [
    parseClinicForm(NEW_URL),
    async (req, res, next) => {
        try {
            const header = await readHeaderUpload(req);               // validate file BEFORE inserting
            const { clinicId, name } = await Clinic.createClinic(req.body, req.user.Id, await validUserIdSet());

            let note = '';
            if (header) {
                try { await Clinic.saveHeader({ Id: clinicId, Name: name }, header); }
                catch (e) { logError('saveHeader', e); note = ' But the prescription header could not be saved — upload it again from Edit.'; }
            }
            flash(req, note ? 'warning' : 'success', `Clinic "${name}" registered.${note}`);
            return res.redirect(DOCS_URL(clinicId));                   // next natural step: attach doctors
        } catch (err) {
            logError('registerClinic', err);
            try {
                return await renderForm(res, {
                    mode: 'create', values: valuesFromBody(req.body),
                    errors: friendlyErrors(err), status: err.isUserError ? 422 : 500,
                });
            } catch (e) { return next(e); }
        }
    },
];

const getupdateClinicDetailsPage = asyncHandler(async (req, res) => {
    const id = req.query.id || req.params.id;
    const clinic = await Clinic.findClinicById(id);
    if (!clinic) {
        flash(req, 'danger', 'Clinic not found — it may have been deleted.');
        return res.redirect(LIST_URL);
    }
    return renderForm(res, {
        mode: 'edit', clinicId: clinic.Id, values: valuesFromClinic(clinic),
        hasHeader: !!Clinic.findHeaderFile(clinic), notifications: takeFlash(req),
    });
});

const updateClinicDetails = [
    parseClinicForm(req => EDIT_URL(req.query.id || req.params.id)),
    async (req, res, next) => {
        const id = req.query.id || req.params.id;
        let clinic = null;
        try {
            clinic = await Clinic.findClinicById(id);
            if (!clinic) {
                flash(req, 'danger', 'Clinic not found — it may have been deleted.');
                return res.redirect(LIST_URL);
            }

            const header = await readHeaderUpload(req);
            const { name } = await Clinic.updateClinic(clinic.Id, req.body, req.user.Id, await validUserIdSet());

            let note = '';
            if (header) {
                try { await Clinic.saveHeader(clinic, header); }      // old Name → removes legacy file too
                catch (e) { logError('saveHeader', e); note = ' But the new prescription header could not be saved — please upload again.'; }
            } else if (req.body.removeHeader === '1') {
                await Clinic.deleteHeader(clinic).catch(e => logError('deleteHeader', e));
            }

            flash(req, note ? 'warning' : 'success', `Clinic "${name}" updated.${note}`);
            return res.redirect(LIST_URL);
        } catch (err) {
            logError('updateClinicDetails', err);
            try {
                if (!clinic) { flash(req, 'danger', friendlyErrors(err)); return res.redirect(LIST_URL); }
                return await renderForm(res, {
                    mode: 'edit', clinicId: clinic.Id, values: valuesFromBody(req.body),
                    hasHeader: !!Clinic.findHeaderFile(clinic),
                    errors: friendlyErrors(err), status: err.isUserError ? 422 : 500,
                });
            } catch (e) { return next(e); }
        }
    },
];

/** Streams the header image (auth-protected by the route). */
const getClinicHeader = asyncHandler(async (req, res) => {
    const clinic = await Clinic.findClinicById(req.params.id);
    const file   = clinic && Clinic.findHeaderFile(clinic);
    if (!file) return res.status(404).send('No header image');
    res.set('Cache-Control', 'private, no-cache');
    return res.sendFile(file);
});

// ─────────────────────────────────────────────────────────────────────────────
// DOCTORS
// ─────────────────────────────────────────────────────────────────────────────

const renderDoctorsPage = async (req, res, clinicId) => {
    const clinic = await Clinic.findClinicById(clinicId);
    if (!clinic) {
        flash(req, 'danger', 'Clinic not found — it may have been deleted.');
        return res.redirect(LIST_URL);
    }
    const [unAttachedDoctorList, attachedDoctorList] = await Promise.all([
        Doctor.getdoctorListNotattachedToclinic(clinic.Id),
        Doctor.getAttachedDoctorList(clinic.Id),
    ]);
    return render(res, 'Clinic/attachDoctorToClinic', {
        title: 'Clinic Doctors',
        clinicDetails: clinic,
        unAttachedDoctorList: unAttachedDoctorList || [],
        attachedDoctorList:   attachedDoctorList   || [],
        notifications: takeFlash(req),
    });
};

const attachDoctorWithClinic = asyncHandler(async (req, res) =>
    renderDoctorsPage(req, res, req.params.clinicId || req.query.clinicId));

const attachDoctorToClinic = async (req, res) => {
    const clinicId = req.query.clinicId || req.params.clinicId;
    try {
        const result = await Clinic.attachDoctors(clinicId, req.body.doctor, req.user.Id);
        flash(req, result.type, result.message);
    } catch (err) {
        logError('attachDoctorToClinic', err);
        flash(req, 'danger', friendlyErrors(err));
    }
    return res.redirect(DOCS_URL(parseInt(clinicId, 10) || ''));
};

const detachDoctorFromClinic = async (req, res) => {
    const { clinicId, doctorId } = req.params;
    try {
        flash(req, 'success', await Clinic.detachDoctor(clinicId, doctorId, req.user.Id));
    } catch (err) {
        logError('detachDoctorFromClinic', err);
        flash(req, 'danger', friendlyErrors(err));
    }
    return res.redirect(DOCS_URL(parseInt(clinicId, 10) || ''));
};

module.exports = {
    getClinicRegistrationPage,
    getHomePage,
    getClinicListView,
    registerClinic,                // middleware array
    getupdateClinicDetailsPage,
    updateClinicDetails,           // middleware array
    getClinicHeader,
    attachDoctorWithClinic,
    attachDoctorToClinic,
    detachDoctorFromClinic,
};
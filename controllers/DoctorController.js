'use strict';

/**
 * DoctorController.js
 *
 * FIXES OVER THE OLD VERSION
 *  - Register / Update rendered the doctor list as the reply to the POST → pressing Refresh (or Back)
 *    registered the doctor AGAIN. Now: save → redirect (flash message) → doctor page.
 *  - A validation error re-opened an EMPTY register form (and the edit form with the old DB values)
 *    → everything typed was lost. Now the form comes back exactly as typed, errors next to the fields.
 *  - Errors were pushed as Error objects / arrays → "[object Object]" in the alert. Now plain text.
 *  - updateTestWiseThanksForADoctor rendered with an undefined variable "successes" → every
 *    successful save showed an error page.
 *  - updateReportingDoctor read req.params.reffereingDoctorId (typo) → doctor id could be undefined.
 *  - "No preference" / "No person assigned" could not be saved (always "nothing selected").
 *  - getPreselectedMarketingPerson bug (model) → the doctor page never showed the current MR.
 *  - PDF downloads: crashed when there were no patients (doctorThanksData[0]), left Chrome
 *    running after any error, and "Dues" / "Gender" totals were always empty (wrong column names).
 *  - searchDoctor never answered on error (request hung). console.log(req) etc. removed.
 *
 * NEW
 *  - One form for Register and Edit (views/Doctor/doctorForm.ejs).
 *  - GET /doctor/api/check-duplicate → the form warns live when the mobile number / name already exists.
 */

const Doctor    = require('../models/Doctor');
const User      = require('../models/User');
const Test      = require('../models/Test');
const ejs       = require('ejs');
const puppeteer = require('puppeteer');
const path      = require('path');
const moment    = require('moment');
require('dotenv').config();

const LIST_URL   = '/doctor/getDoctorListView';
const DETAIL_URL = (id) => `/doctor/getDoctorDetail?doctorId=${encodeURIComponent(id)}`;
const ICONS = { success: 'bi-check-circle-fill', danger: 'bi-exclamation-triangle-fill', warning: 'bi-exclamation-triangle-fill', info: 'bi-info-circle-fill' };

// ── helpers ──────────────────────────────────────────────────────────────────

const toText = (m) => {
    if (!m) return '';
    if (m instanceof Error) return m.isUserError ? m.message : 'Something went wrong. Please try again.';
    if (Array.isArray(m)) return m.map(toText).filter(Boolean).join(' ');
    if (typeof m === 'object') return m.msg || m.message || '';
    return String(m);
};
const createNotification = (type, messages, icon) => ({ type, messages: toText(messages), icon: icon || ICONS[type] || ICONS.info });
const flash = (req, type, msg) => { if (typeof req.flash === 'function') req.flash('flash', createNotification(type, msg)); };
const readFlash = (req) => {
    if (typeof req.flash !== 'function') return [];
    const m = req.flash('flash') || [];
    return (Array.isArray(m) ? m : [m]).filter(n => n && n.type);
};
const page = (res, view, data, status = 200) =>
    res.status(status).render(view, { BRAND_NAME: process.env.BRAND_NAME, layout: 'loggedInLayout', ...data });
const logErr = (where, err) => { if (!err || !err.isUserError) console.error(`[DoctorController] ${where}:`, err); };

/** Go to the home page with an error (for unexpected failures). */
const renderHomeWithError = (res, error, customMessage = '') => {
    const notifications = [];
    if (customMessage) notifications.push(createNotification('danger', customMessage));
    if (error) notifications.push(createNotification('danger', error));
    return page(res, 'home', { notifications, title: 'Home' });
};

/** Render the first view that exists (updateThanks lives in different folders in different installs). */
const renderFirst = (res, views, data) => {
    const [view, ...rest] = views;
    res.render(view, { BRAND_NAME: process.env.BRAND_NAME, layout: 'loggedInLayout', ...data }, (err, html) => {
        if (!err) return res.send(html);
        if (rest.length && /Failed to lookup view/.test(err.message)) return renderFirst(res, rest, data);
        console.error('[DoctorController] render:', err);
        return renderHomeWithError(res, err);
    });
};

const htmlToPdf = async (html, pdfOptions) => {
    const browser = await puppeteer.launch();
    try {
        const pg = await browser.newPage();
        await pg.setContent(html, { waitUntil: 'domcontentloaded' });
        return await pg.pdf({ format: 'A4', printBackground: true, ...pdfOptions });
    } finally {
        await browser.close().catch(() => {});        // never leave Chrome running
    }
};
const sendPdf = (res, buffer, filename) => {
    const safe = filename.replace(/[^\w .-]+/g, '').trim() || 'report';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safe}.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}.pdf`);
    return res.send(buffer);
};

// ── Register / Edit form ─────────────────────────────────────────────────────

/**
 * Renders views/Doctor/doctorForm.ejs.
 * values   → what is shown in the fields
 * original → saved values (edit) to mark changed thanks % before saving
 */
const renderDoctorForm = async (req, res, { mode, doctorId = null, values = null, original = null, errors = [], duplicates = [], status = 200 }) => {
    const [categories, lookups] = await Promise.all([Test.getTestCategories(), Doctor.getFormLookups()]);
    const errs = errors.slice();
    if (!categories.length) errs.push({ field: 'commission', msg: 'No test categories exist yet. Create the categories first, then register doctors.' });
    return page(res, 'Doctor/doctorForm', {
        mode, doctorId,
        v: values || { schedules: [], commission: {} },
        original: original || null,
        errors: errs, duplicates,
        testCategoriesList: categories,
        lookups,
        notifications: readFlash(req),
        title: mode === 'edit' ? 'Edit Doctor' : 'Register Doctor',
    }, status);
};

const getDoctorRegistrationPage = async (req, res) => {
    try {
        return await renderDoctorForm(req, res, { mode: 'register' });
    } catch (error) {
        logErr('getDoctorRegistrationPage', error);
        return renderHomeWithError(res, error, 'Could not open the Register Doctor page. Please try again.');
    }
};

const registerDoctor = async (req, res) => {
    try {
        const categories = await Test.getTestCategories();
        const form = Doctor.readDoctorForm(req.body, categories);
        let duplicates = [];
        if (!form.errors.length) {
            duplicates = await Doctor.findDuplicates({
                firstName: form.data.FirstName, lastName: form.data.LastName,
                mobiles: [form.data.MobileNumberFirst, form.data.MobileNumberSecond],
            });
            if (duplicates.length && !form.values.confirmDuplicate) form.errors.push({ field: 'duplicate', msg: Doctor.describeDuplicates(duplicates) });
        }
        if (form.errors.length) {
            return renderDoctorForm(req, res, { mode: 'register', values: form.values, errors: form.errors, duplicates, status: 422 });
        }
        const { doctorId, message } = await Doctor.registerDoctor(req, { form, categories });
        flash(req, 'success', message);
        return res.redirect(303, DETAIL_URL(doctorId));
    } catch (error) {
        logErr('registerDoctor', error);
        try {
            return await renderDoctorForm(req, res, {
                mode: 'register', values: Doctor.readDoctorForm(req.body, []).values, status: error.isUserError ? 422 : 500,
                errors: [{ field: 'form', msg: error.isUserError ? error.message : 'The doctor was NOT saved because of a server error. Your entries are still here — please try again.' }],
            });
        } catch (e2) { return renderHomeWithError(res, error, 'The doctor was not registered.'); }
    }
};

const getEditDoctorPage = async (req, res) => {
    try {
        const found = await Doctor.getDoctorFormData(req.params.doctorId);
        if (!found) { flash(req, 'danger', 'Doctor not found.'); return res.redirect(LIST_URL); }
        const notes = [];
        if (found.values.legacyFlatDiscount) notes.push({ field: 'flatDiscount', msg: 'Flat discount was saved as 1% by the old form (its "0%" option saved 1). It is shown as 0% — save to correct it.', warn: true });
        return await renderDoctorForm(req, res, { mode: 'edit', doctorId: found.doctor.Id, values: found.values, original: found.values, errors: notes });
    } catch (error) {
        logErr('getEditDoctorPage', error);
        return renderHomeWithError(res, error, 'Could not open the Edit Doctor page.');
    }
};

const updateDoctor = async (req, res) => {
    const doctorId = req.params.doctorId;
    try {
        const found = await Doctor.getDoctorFormData(doctorId);
        if (!found) { flash(req, 'danger', 'Doctor not found. He may have been deleted.'); return res.redirect(LIST_URL); }
        const categories = await Test.getTestCategories();
        const form = Doctor.readDoctorForm(req.body, categories);
        let duplicates = [];
        if (!form.errors.length) {
            // only what was CHANGED is checked — a number shared on purpose is not asked about on every edit
            const o = found.doctor, low = (x) => String(x || '').trim().toLowerCase(), l10 = (x) => String(x || '').replace(/\D/g, '').slice(-10);
            const nameChanged = low(o.FirstName) !== low(form.data.FirstName) || low(o.LastName) !== low(form.data.LastName);
            const oldNums = [l10(o.MobileNumberFirst), l10(o.MobileNumberSecond)];
            const newNums = [form.data.MobileNumberFirst, form.data.MobileNumberSecond].filter(m => m && !oldNums.includes(l10(m)));
            if (nameChanged || newNums.length) {
                duplicates = await Doctor.findDuplicates({
                    firstName: nameChanged ? form.data.FirstName : '', lastName: nameChanged ? form.data.LastName : '', mobiles: newNums,
                }, o.Id);
            }
            if (duplicates.length && !form.values.confirmDuplicate) form.errors.push({ field: 'duplicate', msg: Doctor.describeDuplicates(duplicates) });
        }
        if (form.errors.length) {
            return renderDoctorForm(req, res, { mode: 'edit', doctorId: found.doctor.Id, values: form.values, original: found.values, errors: form.errors, duplicates, status: 422 });
        }
        const { message } = await Doctor.updateDoctor(req, { form, categories, doctorId: found.doctor.Id });
        flash(req, 'success', message);
        return res.redirect(303, DETAIL_URL(found.doctor.Id));
    } catch (error) {
        logErr('updateDoctor', error);
        try {
            const found = await Doctor.getDoctorFormData(doctorId);
            if (!found) return renderHomeWithError(res, error);
            return await renderDoctorForm(req, res, {
                mode: 'edit', doctorId: found.doctor.Id, values: Doctor.readDoctorForm(req.body, []).values, original: found.values,
                status: error.isUserError ? 422 : 500,
                errors: [{ field: 'form', msg: error.isUserError ? error.message : 'Changes were NOT saved because of a server error. Your entries are still here — please try again.' }],
            });
        } catch (e2) { return renderHomeWithError(res, error, 'The doctor was not updated.'); }
    }
};

/** GET /doctor/api/check-duplicate?firstName=&lastName=&mobile=&mobile2=&excludeId= */
const checkDuplicate = async (req, res) => {
    try {
        const q = req.query || {};
        const matches = await Doctor.findDuplicates({
            firstName: q.firstName, lastName: q.lastName, mobiles: [q.mobile, q.mobile2],
        }, q.excludeId);
        return res.json({ success: true, matches });
    } catch (error) {
        logErr('checkDuplicate', error);
        return res.status(500).json({ success: false, matches: [] });
    }
};

// ── Lists / details ──────────────────────────────────────────────────────────

const searchDoctor = async (req, res) => {
    try {
        return res.send(await Doctor.getDoctorList(req));
    } catch (error) {
        logErr('searchDoctor', error);
        return res.status(500).json({ success: false, message: 'Could not load doctors.' });
    }
};

const getDoctorListView = async (req, res) => {
    try {
        const doctorDetails = await Doctor.getDoctorList();
        return page(res, 'Doctor/getDoctorListView', {
            title: 'Doctor List', doctorDetails, totalCount: doctorDetails.length,
            numPerPage: parseInt(process.env.PAGINATION_LIMIT, 10) || 10, notifications: readFlash(req),
        });
    } catch (error) {
        logErr('getDoctorListView', error);
        return renderHomeWithError(res, error, 'Could not load the doctor list.');
    }
};

/** Doctor page: profile, thanks, reporting doctor, marketing person. */
const loadDoctorPage = async (doctorId) => {
    const [thanksData, reportingDoctors, reportingDoctorId, marketingPersonId, marketingPersons, visitingSchedule] = await Promise.all([
        fetchThanksData(doctorId),
        Doctor.getReportingDoctorList(),
        Doctor.getPreselectedReportingDoctor(doctorId),
        Doctor.getPreselectedMarketingPerson(doctorId),
        User.getMarketingPersonList(),
        Doctor.getVisitingSchedule(doctorId),
    ]);
    return { ...thanksData, reportingDoctors: reportingDoctors || [], reportingDoctorId, marketingPersonId, marketingPersons: marketingPersons || [], visitingSchedule };
};

const getDoctorDetailView = async (req, res) => {
    const doctorId = req.query.doctorId;
    try {
        const data = await loadDoctorPage(doctorId);
        if (!data.doctorDetails) { flash(req, 'danger', 'Doctor not found.'); return res.redirect(LIST_URL); }
        const notifications = readFlash(req);
        if (!data.marketingPersons.length) notifications.push(createNotification('warning', 'The marketing person list is empty — no user is set up as a marketing person (User.getMarketingPersonList returned nothing).'));
        if (!data.reportingDoctors.length) notifications.push(createNotification('warning', 'The reporting doctor list is empty — no user has RoleId 2.'));
        return page(res, 'Doctor/getDoctorDetails', { ...data, notifications, title: 'Doctor Details' });
    } catch (error) {
        logErr('getDoctorDetailView', error);
        return renderHomeWithError(res, error, 'Could not open the doctor page.');
    }
};

/** POST /doctor/associateReportingDoctor/:id  — 0 = "No preference". */
const updateReportingDoctor = async (req, res) => {
    const doctorId = req.params.reffereingDoctorId || req.params.refferingDoctorId || req.params.doctorId || Object.values(req.params || {})[0];
    try {
        if (!(Number(doctorId) > 0)) throw Object.assign(new Error('Doctor not found.'), { isUserError: true });
        const rid = Number(req.body.reportingDoctor) || 0;
        if (rid > 0) { await Doctor.setReportingDoctor(doctorId, rid); flash(req, 'success', 'Reporting doctor saved.'); }
        else         { await Doctor.clearReportingDoctor(doctorId);    flash(req, 'success', 'Reporting doctor removed (no preference).'); }
    } catch (error) {
        logErr('updateReportingDoctor', error);
        flash(req, 'danger', error.isUserError ? error.message : 'Could not save the reporting doctor. Please try again.');
    }
    return res.redirect(303, Number(doctorId) > 0 ? DETAIL_URL(doctorId) : LIST_URL);
};

/** POST /doctor/associateMarketingPersonForDoctor/:id  — 0 = un-assign. */
const updateMarketingPerson = async (req, res) => {
    const doctorId = req.params.refferingDoctorId || req.params.reffereingDoctorId || req.params.doctorId || Object.values(req.params || {})[0];
    try {
        if (!(Number(doctorId) > 0)) throw Object.assign(new Error('Doctor not found.'), { isUserError: true });
        const r = await Doctor.updateMarketingPerson(req.body.marketingPerson, doctorId);
        flash(req, 'success', r === 'removed' ? 'Marketing person removed from this doctor.'
                            : r === 'unchanged' ? 'This marketing person is already assigned.'
                            : 'Marketing person assigned. The doctor now shows on his "My visits" page.');
    } catch (error) {
        logErr('updateMarketingPerson', error);
        flash(req, 'danger', error.isUserError ? error.message : 'Could not save the marketing person. Please try again.');
    }
    return res.redirect(303, Number(doctorId) > 0 ? DETAIL_URL(doctorId) : LIST_URL);
};

// ── Thanks (commission) pages ────────────────────────────────────────────────

const fetchThanksData = async (doctorId) => {
    const [doctorDetails, categoryCommissionDetail, testWiseCommissionDetails] = await Promise.all([
        Doctor.getDoctorDetail(doctorId),
        Doctor.getCategoryWiseCommission(doctorId),
        Doctor.getTestWiseCommissionDetails(doctorId),
    ]);
    return { doctorDetails, categoryCommissionDetail, testWiseCommissionDetails };
};
const THANKS_VIEWS = ['updateThanks', 'Doctor/updateThanks'];

const updateDoctorThanks = async (req, res) => {
    try {
        const thanksData = await fetchThanksData(req.query.doctorId);
        if (!thanksData.doctorDetails) { flash(req, 'danger', 'Doctor not found.'); return res.redirect(LIST_URL); }
        return renderFirst(res, THANKS_VIEWS, { ...thanksData, notifications: readFlash(req), title: 'Update doctor thanks' });
    } catch (error) {
        logErr('updateDoctorThanks', error);
        return renderHomeWithError(res, error);
    }
};

const updateThanks = async (req, res) => {
    const notifications = [];
    try {
        notifications.push(createNotification('success', await Doctor.updateThanks(req)));
    } catch (error) {
        logErr('updateThanks', error);
        notifications.push(createNotification('danger', error));
    }
    try {
        const thanksData = await fetchThanksData(req.body.doctorId);
        return renderFirst(res, THANKS_VIEWS, { notifications, ...thanksData, title: 'Update doctor thanks' });
    } catch (error) {
        logErr('updateThanks/render', error);
        return renderHomeWithError(res, error);
    }
};

const updateTestWiseThanksForADoctor = async (req, res) => {
    const notifications = [];
    try {
        notifications.push(createNotification('success', await Doctor.updateDoctorsThankTestWise(req)));
    } catch (error) {
        logErr('updateTestWiseThanksForADoctor', error);
        notifications.push(createNotification('danger', error));
    }
    try {
        const [testDetails, thanksData] = await Promise.all([Test.searchTestForUpdatingThanks(req), fetchThanksData(req.body.doctorId)]);
        return renderFirst(res, THANKS_VIEWS, {
            notifications, testDetails, ...thanksData,
            categoryId: req.body.SelectDoctorThanksCategorySearch, searchedTest: req.body.searchTest,
            title: 'Update doctor thanks',
        });
    } catch (error) {
        logErr('updateTestWiseThanksForADoctor/render', error);
        return renderHomeWithError(res, error);
    }
};

const getDoctorWiseThanks = async (req, res) => {
    try {
        const today = moment().format('YYYY-MM-DD');
        const [doctorDetails, doctorThanksData] = await Promise.all([Doctor.getDoctorList(), Doctor.getDoctorWiseThanks(today, today)]);
        const d = moment().format('DD-MM-YYYY');
        return page(res, 'Doctor/displayDoctorThanks', { FromDate: d, ToDate: d, doctorDetails, doctorThanksData, notifications: readFlash(req), title: 'Doctor thanks list' });
    } catch (error) {
        logErr('getDoctorWiseThanks', error);
        return renderHomeWithError(res, error);
    }
};

const getDoctorThanks = async (req, res) => {
    try {
        const { from, to } = Doctor.readRange(req.body || {});
        const doctorId = req.body && req.body.Doctor ? req.body.Doctor : undefined;
        const [doctorDetails, doctorThanksData] = await Promise.all([Doctor.getDoctorList(), Doctor.getDoctorWiseThanks(from, to, doctorId)]);
        return page(res, 'Doctor/displayDoctorThanks', {
            doctorDetails, doctorId, doctorThanksData, title: 'Doctor thanks list',
            FromDate: moment(from).format('DD-MM-YYYY'), ToDate: moment(to).format('DD-MM-YYYY'),
        });
    } catch (error) {
        logErr('getDoctorThanks', error);
        return renderHomeWithError(res, error);
    }
};

/** PDF of one doctor's thanks (called from the patient list). */
const downloadIndividualDoctorThanks = async (req, res) => {
    try {
        const rows = await Doctor.getIndividualDoctorThanks(req);
        if (!rows.length) {
            return res.status(404).send('<p style="font-family:sans-serif;padding:24px">No patients for this doctor in the selected dates. <a href="javascript:history.back()">Go back</a></p>');
        }
        const sum = (k) => rows.reduce((t, r) => t + Number(r[k] || 0), 0);
        const html = await ejs.renderFile(path.join(__dirname, '../views/partials/thanksReport.ejs'), {
            patients: rows, totalGrossFee: sum('GrossAmount'), totalThanks: sum('TotalThanks'),
            totalDues: sum('DuesAmount'), totalDiscount: sum('Discount'),
        });
        const pdf = await htmlToPdf(html);
        return sendPdf(res, pdf, `Dr. ${rows[0].DoctorFirstName || ''} ${rows[0].DoctorLastName || ''}`.trim());
    } catch (error) {
        logErr('downloadIndividualDoctorThanks', error);
        return res.status(error.isUserError ? 400 : 500).send(error.isUserError ? error.message : 'An error occurred while generating the PDF.');
    }
};

/** PDF of all doctors' thanks. */
const downloadAllDoctorThanks = async (req, res) => {
    try {
        const rows = await Doctor.downloadAllDoctorThanks(req);
        if (!rows.length) {
            return res.status(404).send('<p style="font-family:sans-serif;padding:24px">No patients in the selected dates. <a href="javascript:history.back()">Go back</a></p>');
        }
        const doctors = {};
        rows.forEach(row => {
            if (!doctors[row.doctorId]) {
                doctors[row.doctorId] = {
                    DoctorFirstName: row.DoctorFirstName, DoctorLastName: row.DoctorLastName,
                    Degree1: row.Degree1, Degree2: row.Degree2, Degree3: row.Degree3, Degree4: row.Degree4,
                    SpecialistIn: row.SpecialistIn, patients: [],
                };
            }
            doctors[row.doctorId].patients.push({
                PatientName: row.Name, Tests: row.TestNames, Subtest: row.SubTestNames,
                Thanks: row.Thanks, GrossAmount: row.GrossAmount, Discount: row.Discount,
                DuesAmount: row.DuesAmount, Age: row.Age, YMD: row.YMD, Gender: row.Gender, RegisteredOn: row.RegisteredOn,
            });
        });
        Object.values(doctors).forEach(d => {
            const sum = (k) => d.patients.reduce((t, p) => t + Number(p[k] || 0), 0);
            d.TotalGrossFee = sum('GrossAmount'); d.TotalThanks = sum('Thanks'); d.TotalDues = sum('DuesAmount'); d.TotalDiscount = sum('Discount');
        });
        const html = await ejs.renderFile(path.join(__dirname, '../views/partials/downloadAllDoctorThanks.ejs'), { doctors });
        const pdf = await htmlToPdf(html, {
            displayHeaderFooter: true, headerTemplate: '<div></div>',
            footerTemplate: '<div style="font-size:10px;width:100%;text-align:center;color:#555;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
            margin: { bottom: '10mm' },
        });
        return sendPdf(res, pdf, 'AllDoctorsThanks');
    } catch (error) {
        logErr('downloadAllDoctorThanks', error);
        return res.status(error.isUserError ? 400 : 500).send(error.isUserError ? error.message : 'An error occurred while generating the PDF.');
    }
};

module.exports = {
    getDoctorRegistrationPage, registerDoctor, getEditDoctorPage, updateDoctor, checkDuplicate,
    searchDoctor, getDoctorListView, getDoctorDetailView,
    updateDoctorThanks, updateThanks, updateTestWiseThanksForADoctor,
    getDoctorWiseThanks, getDoctorThanks, downloadIndividualDoctorThanks, downloadAllDoctorThanks,
    updateReportingDoctor, updateMarketingPerson,
    createNotification,
};
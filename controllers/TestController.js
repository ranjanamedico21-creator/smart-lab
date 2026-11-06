'use strict';

/**
 * controllers/testController.js — SmartLab Test controller
 *
 * Changes in this version (see chat for the full bug list):
 *  - Create + Edit share ONE view: views/Test/testForm.ejs
 *  - registerTestWithFlash removed: asyncHandler swallowed the error into a
 *    no-op next() → the request hung forever on any validation error.
 *  - On a failed save the form is re-rendered WITH the user's input
 *    (incl. converted templates) and a list of clear error messages.
 *  - Successful create / update / activate use Post-Redirect-Get
 *    (refreshing the page no longer creates duplicate tests).
 *  - Forms are parsed with multer.none() + 25 MB field limit
 *    (template HTML with images exceeded the 1 MB / 100 KB body limits).
 *  - previewTemplate always answers JSON (multer errors used to return an
 *    HTML error page → "Unexpected token <" in the browser).
 *  - .docx check by extension too (Windows often sends application/octet-stream);
 *    .doc rejected with a clear message (mammoth can't read it).
 *  - editTestForm now reads flash messages (they used to leak onto other pages).
 *  - View path case fixed: 'Test/...' everywhere ('test/editTest' fails on Linux).
 *  - Excel export respects the current filters.
 *  - Sub-tests: create / update redirect (no double insert on refresh), the form comes back with the
 *    typed values on an error, a wrong ?SubTestId goes back to the list instead of crashing.
 *  - New: doctor-wise sub-test thanks / discount / thanks-report display page + JSON for the patient form.
 *  - Test form: "Test Duration (minutes)" → TimeToComplete (was wrongly in ReportingDay via "Day"),
 *    new Reporting Day select → ReportingDay. DEFAULT_VALUES lists both, so a failed save keeps them.
 */

const path      = require('path');
const fs        = require('fs');
const os        = require('os');
const ExcelJS   = require('exceljs');
const mammoth   = require('mammoth');
const multer    = require('multer');
const Category  = require('../models/Category');
const Doctor    = require('../models/Doctor');
const Test      = require('../models/Test');
const Pathology = require('../models/Pathology');

const LIST_URL   = '/test/getTestListView';
const CREATE_URL = '/test/createTest';
const EDIT_URL   = (id) => `/test/edit/${id}`;
const IS_PROD    = process.env.NODE_ENV === 'production';

const ICONS = {
    success: 'bi-check-circle-fill',
    danger:  'bi-exclamation-triangle-fill',
    warning: 'bi-exclamation-circle-fill',
    info:    'bi-info-circle-fill',
};

// ─────────────────────────────────────────────────────────────────────────────
// UPLOADS
// ─────────────────────────────────────────────────────────────────────────────

const DOCX_MIMES = new Set([
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/octet-stream',
    'application/zip',
    'application/x-zip-compressed',
]);

const docxUpload = multer({
    dest: path.join(os.tmpdir(), 'smartlab-uploads'),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
        const ext = path.extname(file.originalname || '').toLowerCase();
        if (ext === '.doc') return cb(Object.assign(new Error('Old .doc files are not supported. Open it in Word and "Save As" .docx.'), { code: 'BAD_TYPE' }));
        if (ext !== '.docx' || !DOCX_MIMES.has(file.mimetype)) return cb(Object.assign(new Error('Only .docx (Word) files are accepted.'), { code: 'BAD_TYPE' }));
        cb(null, true);
    },
}).single('docxFile');

// Text-only multipart parser for the Create/Edit forms.
// Templates are already converted to HTML in the browser and arrive as text fields.
const formParser = multer({
    limits: { fieldSize: 25 * 1024 * 1024, fields: 200, files: 0 },
}).none();

const uploadErrorMessage = (err) => {
    switch (err && err.code) {
        case 'LIMIT_FILE_SIZE':       return 'The file is larger than 10 MB. Reduce image sizes in the Word file and try again.';
        case 'LIMIT_FIELD_VALUE':     return 'The report template is too large (over 25 MB). Compress the images in the Word file and try again.';
        case 'LIMIT_FILE_COUNT':
        case 'LIMIT_UNEXPECTED_FILE': return 'Unexpected file in the form. Please reload the page and try again.';
        case 'BAD_TYPE':              return err.message;
        default:                      return 'Upload failed: ' + ((err && err.message) || 'unknown error');
    }
};

const parseForm = (backUrl) => (req, res, next) => {
    formParser(req, res, (err) => {
        if (!err) return next();
        flash(req, 'danger', uploadErrorMessage(err));
        return res.redirect(typeof backUrl === 'function' ? backUrl(req) : backUrl);
    });
};

const safeUnlink = (filePath) => {
    if (!filePath) return;
    fs.unlink(filePath, () => {});   // async, never throws
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const createNotification = (type, messages, icon, alertDismissible = true) => ({
    type,
    messages: messages instanceof Error ? messages.message : (Array.isArray(messages) ? messages.join('\n') : String(messages || '')),
    icon: icon || ICONS[type],
    alertDismissible,
});

const flash = (req, type, message) => {
    if (typeof req.flash === 'function')
        req.flash('flash', { type, messages: Array.isArray(message) ? message.join('\n') : String(message), icon: ICONS[type] });
};

const takeFlash = (req) => {
    if (typeof req.flash !== 'function') return [];
    const raw = req.flash('flash') || [];
    return (Array.isArray(raw) ? raw : [raw])
        .filter(m => m && m.type)
        .map(m => createNotification(m.type, m.messages, m.icon));
};

const render = (res, viewName, data) => res.render(viewName, {
    BRAND_NAME: process.env.BRAND_NAME,
    layout:     'loggedInLayout',
    ...data,
});

const renderHomeWithError = (res, error, customMessage = '') => {
    const notifications = [];
    if (customMessage) notifications.push(createNotification('danger', customMessage));
    if (error)         notifications.push(createNotification('danger', error));
    return render(res, 'home', { notifications, title: 'Home' });
};

/** Turn any error into messages that are safe and useful for the user. */
const friendlyErrors = (err) => {
    if (err && err.isUserError) return err.userMessages;
    switch (err && err.code) {
        case 'ER_DUP_ENTRY':
            return ['A record with the same name already exists.'];
        case 'ER_DATA_TOO_LONG':
            return ['A value is too long for the database. This is usually the report template (large images). ' +
                    'Reduce image sizes in the Word file, or change the template columns to MEDIUMTEXT.'];
        case 'ER_NO_REFERENCED_ROW':
        case 'ER_NO_REFERENCED_ROW_2':
            return ['One of the selected options (category / film / specimen / container) no longer exists. Refresh the page and select again.'];
        case 'ER_LOCK_WAIT_TIMEOUT':
        case 'ER_LOCK_DEADLOCK':
            return ['The database is busy right now. Please click save again.'];
        case 'ECONNREFUSED':
        case 'PROTOCOL_CONNECTION_LOST':
        case 'ETIMEDOUT':
            return ['Cannot reach the database server. Check the server / network and try again.'];
        case 'ER_BAD_FIELD_ERROR':
        case 'ER_NO_SUCH_TABLE':
            return ['Database structure mismatch: ' + err.sqlMessage + '. Please run the latest DB migration.'];
        default:
            return ['Something went wrong while saving.' + (IS_PROD ? ' Please try again.' : ' (' + ((err && err.message) || err) + ')')];
    }
};

const logError = (where, err) => {
    if (err && err.isUserError) return;
    console.error(`[testController] ${where}:`, (err && (err.code || '')) , (err && err.stack) || err);
};

// ─────────────────────────────────────────────────────────────────────────────
// FORM (shared by Create + Edit)
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_VALUES = {
    MainCategory: '', Name: '', Price: '', TimeTakenForReporting: '', TimeToComplete: '', ReportingDay: 0,
    FilmType: '', NoOfFilms: 0, reportRequired: false, Description: '',
    Type: 1, Parameter: 1, MinAmountOfBlood: '', MaxAmountOfBlood: '',
    SpecimenTypeId: '', ContainerTypeId: '', Inversion: 0, FastingRequired: 0,
    templateMode: 'common', templateCommon: '', templateMale: '', templateFemale: '',
};

const pick = (v, fallback = '') => (v === undefined || v === null) ? fallback : v;


const valuesFromTest = (t, spec) => {
    const hasM = !!(t.TemplateMale || t.TemplateFemale);
    const hasC = !!t.TemplateCommon;
    let templateMode = 'common';
    if (t.IsReportRequired == 1) templateMode = hasM ? 'separate' : (hasC ? 'common' : 'later');
 
    return {
        ...DEFAULT_VALUES,
        MainCategory:          t.CategoryId,
        Name:                  pick(t.TestName),
        Price:                 pick(t.Price),
        TimeTakenForReporting: pick(t.TimeTakenForReporting),
        TimeToComplete:        pick(t.TimeToComplete),                       // Test Duration (minutes)
        ReportingDay:          t.ReportingDay == null ? 0 : t.ReportingDay,  // Reporting Day select (0 = same day)
        FilmType:              pick(t.FilmTypeId),
        NoOfFilms:             pick(t.NoOfFilm, 0),
        reportRequired:        t.IsReportRequired == 1,
        Description:           pick(t.Description),
        Type:                  pick(t.Type, 1),
        FastingRequired:       pick(t.FastingRequired, 0),
        Parameter:             t.NoOfParameter || 1,
        // Specimen requirement table wins; fall back to legacy MainTestTable columns
        MinAmountOfBlood:      pick(spec && spec.MinVolume       != null ? spec.MinVolume       : t.MinAmountOfBlood),
        MaxAmountOfBlood:      pick(spec && spec.MaxVolume       != null ? spec.MaxVolume       : t.MaxAmountOfBlood),
        Inversion:             pick(spec && spec.Inversions      != null ? spec.Inversions      : t.Inversion, 0),
        SpecimenTypeId:        pick(spec && spec.SpecimenTypeId  != null ? spec.SpecimenTypeId  : t.SpecimenType),
        ContainerTypeId:       pick(spec && spec.ContainerTypeId != null ? spec.ContainerTypeId : t.SampleContainer),
        templateMode,
        templateCommon:        pick(t.TemplateCommon),
        templateMale:          pick(t.TemplateMale),
        templateFemale:        pick(t.TemplateFemale),
    };
};

const valuesFromBody = (b = {}) => {
    const v = { ...DEFAULT_VALUES };
    Object.keys(DEFAULT_VALUES).forEach(k => { if (b[k] !== undefined) v[k] = b[k]; });
    v.reportRequired = !!b.reportRequired;
    return v;
};

const loadFormLookups = async () => {
    const [categories, filmTypes, specimenTypes, containers] = await Promise.all([
        Test.getAllCategories(),
        Test.getAllFilmTypes(),
        Pathology.findAllSpecimenTypes(),
        Pathology.findAllContainerTypes(),
    ]);
    return {
        categories:    (categories || []).map(c => ({ ...c, bucket: Test.categoryBucket(c.Name) })),
        filmTypes:     filmTypes     || [],
        specimenTypes: specimenTypes || [],
        containers:    containers    || [],
    };
};

const renderForm = async (res, { mode, testId = null, values, errors = [], notifications = [], status = 200 }) => {
    const lookups = await loadFormLookups();

    let lockedCategory = null;
    if (mode === 'edit') {
        lockedCategory = lookups.categories.find(c => String(c.Id) === String(values.MainCategory))
            || { Id: values.MainCategory, Name: 'Unknown category', bucket: 'other' };
    }

    res.status(status);
    return render(res, 'Test/testForm', {
        title: mode === 'edit' ? 'Edit Test' : 'Create Test',
        mode, testId, values, errors, notifications, lockedCategory,
        ...lookups,
    });
};

// ─────────────────────────────────────────────────────────────────────────────
// CREATE
// ─────────────────────────────────────────────────────────────────────────────

const getTestRegistrationPage = asyncHandler(async (req, res) => {
    const categories = await Test.getAllCategories();
    if (!categories.length) {
        return renderHomeWithError(res, 'No categories found. Please create a category first.');
    }
    return renderForm(res, { mode: 'create', values: { ...DEFAULT_VALUES }, notifications: takeFlash(req) });
});

const registerTest = [
    parseForm(CREATE_URL),
    async (req, res, next) => {
        try {
            const result = await Test.registerTest(req);
            flash(req, result.templatePending ? 'warning' : 'success', result.message);
            return res.redirect(LIST_URL);
        } catch (err) {
            logError('registerTest', err);
            try {
                return await renderForm(res, {
                    mode: 'create',
                    values: valuesFromBody(req.body),
                    errors: friendlyErrors(err),
                    status: err.isUserError ? 422 : 500,
                });
            } catch (renderErr) { return next(renderErr); }
        }
    },
];

// ─────────────────────────────────────────────────────────────────────────────
// EDIT / UPDATE
// ─────────────────────────────────────────────────────────────────────────────

const editTestForm = asyncHandler(async (req, res) => {
    const testId = parseInt(req.params.id, 10);
    if (!Number.isInteger(testId) || testId <= 0) {
        flash(req, 'danger', 'Invalid test ID.');
        return res.redirect(LIST_URL);
    }

    const [test, spec] = await Promise.all([
        Test.getTestById(testId),
        Test.getTestSpecimenRequirement(testId).catch(err => { logError('getTestSpecimenRequirement', err); return null; }),
    ]);

    if (!test) {
        flash(req, 'danger', 'Test not found — it may have been deleted.');
        return res.redirect(LIST_URL);
    }
    return renderForm(res, { mode: 'edit', testId, values: valuesFromTest(test, spec), notifications: takeFlash(req) });
});

const updateTest = [
    parseForm(req => EDIT_URL(req.params.id)),
    async (req, res, next) => {
        const testId = parseInt(req.params.id, 10);
        try {
            const result = await Test.updateTest(testId, req.body, req.user);
            flash(req, result.templatePending ? 'warning' : 'success', result.message);
            return res.redirect(LIST_URL);
        } catch (err) {
            logError('updateTest', err);
            try {
                const test = await Test.getTestById(testId);
                if (!test) {
                    flash(req, 'danger', 'Test not found — it may have been deleted.');
                    return res.redirect(LIST_URL);
                }
                const values = { ...valuesFromBody(req.body), MainCategory: test.CategoryId }; // category is locked
                return await renderForm(res, {
                    mode: 'edit', testId, values,
                    errors: friendlyErrors(err),
                    status: err.isUserError ? 422 : 500,
                });
            } catch (renderErr) { return next(renderErr); }
        }
    },
];

// ─────────────────────────────────────────────────────────────────────────────
// TEMPLATE PREVIEW (AJAX) — always returns JSON
// ─────────────────────────────────────────────────────────────────────────────

const convertDocxToHtml = async (filePath) => {
    const result = await mammoth.convertToHtml(
        { path: filePath },
        {
            styleMap: [
                "p[style-name='Heading 1'] => h3:fresh",
                "p[style-name='Heading 2'] => h4:fresh",
                'b => strong', 'i => em',
            ],
            convertImage:           mammoth.images.dataUri,
            includeDefaultStyleMap: true,
        }
    );
    return (result.value || '')
        .replace(/<table>/gi, '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:12px">')
        .replace(/<td>/gi,    '<td style="border:1px solid #d1d5db;padding:5px 10px;vertical-align:top">')
        .replace(/<th>/gi,    '<th style="border:1px solid #d1d5db;padding:5px 10px;background:#f3f4f6;font-weight:600">')
        .replace(/<p>/gi,     '<p style="margin:3px 0;line-height:1.6">');
};

const previewTemplate = [
    (req, res, next) => docxUpload(req, res, (err) => {
        if (!err) return next();
        return res.status(400).json({ success: false, message: uploadErrorMessage(err) });
    }),
    async (req, res) => {
        const filePath = req.file && req.file.path;
        try {
            if (!req.file) return res.status(400).json({ success: false, message: 'No file received. Please choose a .docx file.' });

            const html = await convertDocxToHtml(filePath);
            if (!html.replace(/<[^>]*>/g, '').trim() && !/<img/i.test(html)) {
                return res.status(422).json({ success: false, message: 'The Word file looks empty. Please check the document and upload again.' });
            }
            return res.json({ success: true, html, sizeKb: Math.round(Buffer.byteLength(html) / 1024) });
        } catch (err) {
            logError('previewTemplate', err);
            const corrupt = /zip|central directory|end of data/i.test(err.message || '');
            return res.status(422).json({
                success: false,
                message: corrupt
                    ? 'This file is not a valid .docx (it may be corrupted or renamed). Open it in Word and save it again as .docx.'
                    : 'Could not read the Word file: ' + err.message,
            });
        } finally {
            safeUnlink(filePath);
        }
    },
];

// ─────────────────────────────────────────────────────────────────────────────
// LIST / STATUS / EXCEL
// ─────────────────────────────────────────────────────────────────────────────

const readFilters = (req) => {
    const src = { ...(req.query || {}), ...(req.body || {}) };
    return {
        category: src.category || src.categoryId || null,
        testName: (src.testName || '').toString().trim(),
        status:   src.status || null,
    };
};

const getTestListView = asyncHandler(async (req, res) => {
    const filters = readFilters(req);
    const [testDetails, categories] = await Promise.all([
        Test.getSearchedTestDetails(filters),
        Category.getCategoryList(),
    ]);

    return render(res, 'Test/getTestListView', {
        title:         'Test List View',
        categoryId:    filters.category,
        testName:      filters.testName,
        status:        filters.status,
        categories:    categories || [],
        testDetails:   testDetails || [],
        notifications: takeFlash(req),
    });
});

const changeStatus = (fnName) => async (req, res) => {
    try {
        if (!req.query.testId) throw Test.userError('Missing test ID.');
        const message = await Test[fnName](req.query.testId);
        flash(req, 'success', message);
    } catch (err) {
        logError(fnName, err);
        flash(req, 'danger', friendlyErrors(err));
    }
    // Return to the list (keep filters if user came from a filtered list).
    // FIX: back.includes('/getTestListView') also accepted https://evil.site/getTestListView (open redirect)
    let back = LIST_URL;
    try {
        const u = new URL(req.get('Referer') || '', `${req.protocol}://${req.get('host')}`);
        if (u.host === req.get('host') && u.pathname === LIST_URL) back = u.pathname + u.search;
    } catch (_) { /* bad header → list */ }
    return res.redirect(back);
};

const makeTestActive   = changeStatus('makeTestActive');
const makeTestInActive = changeStatus('makeTestInActive');

const downloadTestInExcel = asyncHandler(async (req, res) => {
    const testDetails = await Test.getSearchedTestDetails(readFilters(req));

    const workbook  = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Tests');
    worksheet.columns = [
        { header: 'Category',  key: 'Category', width: 24 },
        { header: 'Test Name', key: 'TestName', width: 40 },
        { header: 'Price (₹)', key: 'Price',    width: 14 },
        { header: 'Status',    key: 'Status',   width: 12 },
        { header: 'Report',    key: 'Report',   width: 20 },
    ];
    worksheet.getRow(1).font = { bold: true };
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];

    testDetails.forEach(t => worksheet.addRow({
        Category: t.Name,
        TestName: t.TestName,
        Price:    Number(t.Price) || 0,
        Status:   t.Status == 1 ? 'Active' : 'Inactive',
        Report:   t.IsReportRequired == 1 ? (t.HasTemplate ? 'Template ready' : 'Template pending') : 'Not required',
    }));
    worksheet.getColumn('Price').numFmt = '#,##0.00';

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Test_Details_${new Date().toISOString().slice(0, 10)}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
});

// ─────────────────────────────────────────────────────────────────────────────
// SUB TESTS
// ─────────────────────────────────────────────────────────────────────────────

const renderAddSubTest = async (res, testId, notifications = []) => {
    const [testDetails, attachedTestLists, testToBeAttahcedList] = await Promise.all([
        Test.getSelectedTestDetail(testId),
        Test.getAttachedTestlist(testId),
        Test.getAllUnattachedTestList(testId),
    ]);
    return render(res, 'Test/addSubTest', {
        notifications, attachedTestLists, testDetails, testToBeAttahcedList,
        title: 'Add Sub Test List View',
    });
};

const attachTest = asyncHandler(async (req, res) => {
    if (!req.query.testId) throw new Error('Missing testId in request.');
    return renderAddSubTest(res, req.query.testId);
});

const attachSubTestToTest = asyncHandler(async (req, res) => {
    const message = await Test.attachSubTestToTest(req);
    return renderAddSubTest(res, req.query.testId, [createNotification('success', message)]);
});

const detachSubTest = asyncHandler(async (req, res) => {
    const message = await Test.detachSubTest(req);
    return renderAddSubTest(res, req.query.testId, [createNotification('success', message)]);
});

// Sub-test pages.  ⚠ If your sub-test list lives at another URL, change it here.
const SUBTEST_LIST_URL = '/test/getSubTestListView';

const renderSubTestForm = async (res, { subTestId = null, values = {}, errors = [], notifications = [], status = 200 }) => {
    const [categories, doctorRules] = await Promise.all([
        Test.getTestCategories(),
        subTestId ? Test.getSubTestDoctorRules(subTestId) : Promise.resolve([]),
    ]);
    res.status(status);
    return render(res, 'Test/createSubTest', {
        title: subTestId ? 'Edit Sub Test' : 'Create Sub Test',
        categories, values, errors, notifications, subTestId, doctorRules,
        // old variable kept for any other view that still reads it
        subTestDetails: subTestId ? [{ Id: subTestId, CategoryId: values.MainCategory, Name: values.Name, Price: values.Price, Discount: values.Discount, ThanksAmount: values.Thanks }] : undefined,
    });
};
const subTestValues = (st) => ({ MainCategory: st.CategoryId, Name: st.Name, Price: st.Price, Discount: st.Discount, Thanks: st.ThanksAmount });
const subTestBody = (b = {}) => ({ MainCategory: b.MainCategory || '', Name: b.Name || '', Price: b.Price ?? '', Discount: b.Discount ?? '', Thanks: b.Thanks ?? '' });

/** GET create page */
const registerSubTest = asyncHandler(async (req, res) => {
    const categories = await Test.getTestCategories();
    if (!categories.length) return renderHomeWithError(res, 'No categories found. Create a category first.');
    return renderSubTestForm(res, { values: { Discount: 0, Thanks: 0 }, notifications: takeFlash(req) });
});

/** POST create → list (refresh cannot create it twice) */
const createSubTest = async (req, res, next) => {
    try {
        const { message } = await Test.CreateSubTest(req);
        flash(req, 'success', message);
        return res.redirect(303, SUBTEST_LIST_URL);
    } catch (err) {
        logError('createSubTest', err);
        try { return await renderSubTestForm(res, { values: subTestBody(req.body), errors: friendlyErrors(err), status: err.isUserError ? 422 : 500 }); }
        catch (e2) { return next(e2); }
    }
};

const getSubTestListView = asyncHandler(async (req, res) => {
    const SubTestLists = await Test.getSubTestList();
    return render(res, 'Test/getSubTestListView', { SubTestLists, notifications: takeFlash(req), title: 'Sub Test List View' });
});

/** GET edit page — a wrong id goes back to the list (used to crash on subTestDetails[0]) */
const editSubTest = asyncHandler(async (req, res) => {
    const id = parseInt(req.query.SubTestId || req.query.subTestId, 10);
    const rows = Number.isInteger(id) && id > 0 ? await Test.getSubTestDetail(id) : [];
    if (!rows.length) { flash(req, 'danger', 'Sub-test not found.'); return res.redirect(SUBTEST_LIST_URL); }
    return renderSubTestForm(res, { subTestId: id, values: subTestValues(rows[0]), notifications: takeFlash(req) });
});

const updateSubTest = async (req, res, next) => {
    const id = parseInt(req.query.subTestId || req.params.subTestId, 10);
    try {
        const message = await Test.updateSubTest(req);
        flash(req, 'success', message);
        return res.redirect(303, SUBTEST_LIST_URL);
    } catch (err) {
        logError('updateSubTest', err);
        try {
            const rows = Number.isInteger(id) && id > 0 ? await Test.getSubTestDetail(id) : [];
            if (!rows.length) { flash(req, 'danger', 'Sub-test not found.'); return res.redirect(SUBTEST_LIST_URL); }
            return await renderSubTestForm(res, { subTestId: id, values: subTestBody(req.body), errors: friendlyErrors(err), status: err.isUserError ? 422 : 500 });
        } catch (e2) { return next(e2); }
    }
};

// ── Doctor-wise sub-test thanks / discount / report display ──────────────────

/** GET /test/doctorSubTestRates/:doctorId */
const doctorSubTestRatesPage = asyncHandler(async (req, res) => {
    const data = await Test.getDoctorSubTestRates(req.params.doctorId);
    if (!data) { flash(req, 'danger', 'Doctor not found.'); return res.redirect('/doctor/getDoctorListView'); }
    return render(res, 'Test/doctorSubTestRates', { ...data, errors: [], notifications: takeFlash(req), title: 'Doctor sub-test thanks' });
});

/** POST /test/doctorSubTestRates/:doctorId */
const saveDoctorSubTestRates = async (req, res, next) => {
    const doctorId = req.params.doctorId;
    try {
        const message = await Test.saveDoctorSubTestRates(doctorId, req.body, req.user && req.user.Id);
        flash(req, 'success', message);
        return res.redirect(303, `/test/doctorSubTestRates/${encodeURIComponent(doctorId)}`);
    } catch (err) {
        logError('saveDoctorSubTestRates', err);
        try {
            const data = await Test.getDoctorSubTestRates(doctorId);
            if (!data) { flash(req, 'danger', 'Doctor not found.'); return res.redirect('/doctor/getDoctorListView'); }
            return render(res.status(err.isUserError ? 422 : 500), 'Test/doctorSubTestRates', {
                ...data, posted: req.body, errors: friendlyErrors(err), notifications: [], title: 'Doctor sub-test thanks',
            });
        } catch (e2) { return next(e2); }
    }
};

/** GET /test/api/doctorSubTestDiscounts/:doctorId → { success, discounts: { subTestId: ₹ } } (patient form) */
const apiDoctorSubTestDiscounts = async (req, res) => {
    try {
        return res.json({ success: true, discounts: await Test.getDoctorSubTestDiscounts(req.params.doctorId) });
    } catch (err) {
        logError('apiDoctorSubTestDiscounts', err);
        return res.status(500).json({ success: false, discounts: {} });
    }
};

const searchTestForUpdatingThanks = asyncHandler(async (req, res) => {
    const [testDetails, doctorDetails, categoryCommissionDetail, testWiseCommissionDetails] = await Promise.all([
        Test.searchTestForUpdatingThanks(req),
        Doctor.getDoctorDetail(req.body.doctorId),
        Doctor.getCategoryWiseCommission(req.body.doctorId),
        Doctor.getTestWiseCommissionDetails(req.body.doctorId),
    ]);
    return render(res, 'updateThanks', {
        categoryId:   req.body.SelectDoctorThanksCategorySearch,
        searchedTest: req.body.searchTest,
        testDetails, doctorDetails, categoryCommissionDetail, testWiseCommissionDetails,
        title: 'Update Doctor Thanks',
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUB PARAMETERS (unchanged behaviour)
// ─────────────────────────────────────────────────────────────────────────────

const mapSabParameterDetails = (list) => (list || []).reduce((acc, row) => {
    const { SubParameterId, SubParameterName, Unit, Header, AgeMin, AgeMax, MinVal, MaxVal, Gender, AgeUnit } = row;
    if (!acc[SubParameterId]) acc[SubParameterId] = { SubParameterId, SubParameterName, Unit, Header, Ranges: [] };
    acc[SubParameterId].Ranges.push({ AgeMin, AgeMax, AgeUnit, MinVal, MaxVal, Gender });
    return acc;
}, {});

const renderSubParameterView = async (res) => {
    const mappedSubParameterDetails = mapSabParameterDetails(await Test.getSubParameterDetail());
    return render(res, 'Test/getSubParameterView', { mappedSubParameterDetails, title: 'Sub Parameter View' });
};

const getSubParameterPage = (req, res) =>
    render(res, 'createSubParamaterForPathology', { editMode: false, title: 'Create Sub Parameter' });

const createSubparameter = asyncHandler(async (req, res) => {
    await Test.createSubParameterForPathology(req.body);
    return renderSubParameterView(res);
});

const getSubParamaterView = asyncHandler(async (req, res) => renderSubParameterView(res));

const editSubParameter = asyncHandler(async (req, res) => {
    const { subParameterId } = req.params;
    const mappedSubParameterDetails = mapSabParameterDetails(await Test.getSubParameterDetail(true, subParameterId));
    return render(res, 'Test/createSubParamaterForPathology', {
        editMode: true, mappedSubParameterDetails, subParameterId, title: 'Sub Parameter Edit View',
    });
});

const updateSubParameter = asyncHandler(async (req, res) => {
    await Test.updateSubParameter(req.body, req.query.subId);
    return renderSubParameterView(res);
});

const renderAttachSubParameter = async (res, testId) => {
    const [testData, attachedSubParameterLists, unAttachedSubParameterLists] = await Promise.all([
        Test.getTestData(testId),
        Test.getAttachedSubParameterLists(testId),
        Test.getUnAttachedSubParameterLists(testId),
    ]);
    return render(res, 'attachSubParameter', {
        testData, attachedSubParameterLists, unAttachedSubParameterLists, title: 'Attach Sub Parameter',
    });
};

const getAttachSubParameterPage = asyncHandler(async (req, res) => renderAttachSubParameter(res, req.params.testId));

const attachSubParameter = asyncHandler(async (req, res) => {
    await Test.attachSubParameterToTest(req.params.testId, req.body.subParameter, req.user.Id);
    return renderAttachSubParameter(res, req.params.testId);
});

const detachSubParameter = asyncHandler(async (req, res) => {
    await Test.detachSubParameterFromTest(req.params.testId, req.params.subParameterId);
    return renderAttachSubParameter(res, req.params.testId);
});

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS — same names as before, so routes don't change
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
    getTestRegistrationPage,
    registerTest,          // now a middleware array [parseForm, handler]
    getTestListView,
    createSubTest,
    makeTestActive,
    makeTestInActive,
    attachTest,
    downloadTestInExcel,
    attachSubTestToTest,
    registerSubTest,
    getSubTestListView,
    detachSubTest,
    editSubTest,
    updateSubTest,
    searchTestForUpdatingThanks,
    getSubParameterPage,
    createSubparameter,
    getSubParamaterView,
    editSubParameter,
    updateSubParameter,
    getAttachSubParameterPage,
    attachSubParameter,
    detachSubParameter,
    updateTest,            // middleware array [parseForm, handler]
    previewTemplate,       // middleware array [upload, handler]
    editTestForm,
    doctorSubTestRatesPage,
    saveDoctorSubTestRates,
    apiDoctorSubTestDiscounts,
};
'use strict';

/**
 * models/Test.js — SmartLab Test model
 *
 * Changes in this version (see chat for the full bug list):
 *  - Pathology is decided from the CATEGORY NAME, not from "FilmType is empty"
 *    (USG / Other tests were silently treated as pathology and lost templates).
 *  - Specimen requirement is written on the SAME transaction connection as the
 *    test insert (it used a separate connection → FK lock wait / orphan rows).
 *  - updateTest runs in a transaction on the pool (no un-awaited
 *    loadPathologyCategoryId, no single shared `dbConnection.connection`).
 *  - Templates support 3 modes: 'common' | 'separate' | 'later' (add later).
 *  - Default templates in ReportTemplates are synced with SELECT → UPDATE/INSERT
 *    (ON DUPLICATE KEY never fires when DoctorId is NULL → duplicate rows).
 *  - Validation returns a list of friendly messages instead of one long string.
 *  - Duplicate test-name check per category.
 *  - updateSubTest: `SET ?` does not work with execute() → switched to query().
 *  - attachSubTestToTest: table name case fixed (MainTestSubTestReference).
 *  - attachSubParameterToTest: single checkbox (string) no longer crashes .map().
 *  - Sub-tests: validated (price / discount / thanks, duplicate name), no longer copied into a
 *    DoctorSubTestCommission row for every doctor (that froze the default for old doctors);
 *    doctor-wise thanks / discount / report display (getDoctorSubTestRates / saveDoctorSubTestRates).
 *  - Test Duration (minutes) is saved in TimeToComplete (create AND update); it used to go into
 *    ReportingDay from the old "Day" field. ReportingDay now comes from the Reporting Day select.
 *  - Empty Description is saved as '' (column is NOT NULL).
 *
 * SECURITY PATCH (2026-10-25):
 *  - Report templates are cleaned on the server (sanitize-html). The template arrives as a plain text
 *    field, so anyone allowed to edit tests could post <script> / onerror=… instead of a converted
 *    Word file; it then ran in the browser of every doctor who opened a report (stored XSS).
 *  - Changing a test price did not touch DoctorTestCommission → doctors kept thanks on the old price.
 *    Amounts that came from the doctor's category % now follow the new price; hand-set amounts are kept.
 *  - Commission amounts rounded to paise (were long floats like 166.666666).
 *  - Attaching sub-tests / sub-parameters: ids checked, duplicates and other-category sub-tests refused.
 *  - Sub-parameter ranges validated (numbers, min ≤ max) before saving.
 *
 * Needs once:  npm install sanitize-html@2
 */

const dbConnection    = require('../config/DBConnection');
const currDateAndTime = require('../helper/helper');
const Doctor          = require('./Doctor');
const sanitizeHtml    = require('sanitize-html');

// ─────────────────────────────────────────────────────────────────────────────
// CONNECTION HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const db      = () => dbConnection.pool.promise();
const getConn = () => dbConnection.pool.promise().getConnection();

const log = {
    warn:  (...a) => console.warn('[Test]', ...a),
    error: (...a) => console.error('[Test]', ...a),
};

// ─────────────────────────────────────────────────────────────────────────────
// SMALL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Error whose messages are safe to show to the user. */
const userError = (messages) => {
    const list = Array.isArray(messages) ? messages : [messages];
    const err  = new Error(list.join('; '));
    err.isUserError  = true;
    err.userMessages = list;
    return err;
};

const str     = (v) => (v === undefined || v === null) ? '' : String(v).trim();
const toNum   = (v) => { const s = str(v); if (s === '') return null; const n = Number(s); return Number.isFinite(n) ? n : NaN; };
const toInt   = (v) => { const n = toNum(v); return (n === null || Number.isNaN(n)) ? n : Math.trunc(n); };
const idOrNull = (v) => { const n = toInt(v); return (n && n > 0) ? n : null; };
const hasText = (v) => typeof v === 'string' && v.trim().length > 0;

const round2  = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ── Report template HTML: only what a converted Word file contains ─────────────
const SAFE_STYLE = [/^[^()<>]*$/];                                  // no url(...), expression(...)
const TEMPLATE_STYLES = ['width', 'height', 'max-width', 'border', 'border-collapse', 'border-top', 'border-bottom', 'border-left', 'border-right',
    'border-color', 'border-width', 'border-style', 'padding', 'padding-left', 'padding-right', 'padding-top', 'padding-bottom',
    'margin', 'margin-left', 'margin-right', 'margin-top', 'margin-bottom', 'font-size', 'font-weight', 'font-style', 'font-family',
    'text-align', 'vertical-align', 'line-height', 'color', 'background', 'background-color', 'text-decoration', 'text-transform', 'white-space'];
const TEMPLATE_SANITIZE = {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'span', 'u', 's', 'sup', 'sub', 'font', 'center']),
    allowedAttributes: {
        '*':  ['style', 'class', 'align'],
        img:  ['src', 'alt', 'width', 'height'],
        td:   ['colspan', 'rowspan', 'width', 'valign'], th: ['colspan', 'rowspan', 'width', 'valign'],
        table:['width', 'border', 'cellpadding', 'cellspacing'],
        a:    ['href'], font: ['color', 'size', 'face'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['data', 'http', 'https'] },        // Word images arrive as data: URIs
    allowedStyles: { '*': Object.fromEntries(TEMPLATE_STYLES.map(p => [p, SAFE_STYLE])) },
};
/** Cleans template HTML; {{PatientName}}-style placeholders are plain text and stay untouched. */
const cleanTemplate = (html) => (hasText(html) ? sanitizeHtml(html, TEMPLATE_SANITIZE).trim() : '');

const IMAGING_BUCKETS = ['radiology', 'ct', 'mri', 'mammography', 'opg'];

/**
 * Single source of truth for category behaviour — used by controller AND views.
 * Word boundaries matter: plain includes('ct') matched "ElectroCardiogram",
 * "Doctor Consultation", etc. and made film type mandatory for them.
 */
const categoryBucket = (name) => {
    const n = str(name).toLowerCase();
    if (/patho/.test(n))                                     return 'pathology';
    if (/\bmri\b/.test(n))                                   return 'mri';
    if (/\busg\b|ultrasound|ultra sound|sonograph|doppler|echo/.test(n)) return 'usg';
    if (/mammo/.test(n))                                     return 'mammography';
    if (/\bopg\b/.test(n))                                   return 'opg';
    if (/\b(ct|cect|ncct|hrct)\b|ct[\s-]?scan|computed tomo/.test(n)) return 'ct';
    if (/x[\s-]?ray|radiolog|\bcr\b/.test(n))                return 'radiology';
    return 'other';
};

const isImagingBucket   = (b) => IMAGING_BUCKETS.includes(b);
const isPathologyBucket = (b) => b === 'pathology';

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION — returns an array of user-friendly messages
// ─────────────────────────────────────────────────────────────────────────────

const validateTestDetails = (b, bucket) => {
    const e = [];
    const isPath    = isPathologyBucket(bucket);
    const isImaging = isImagingBucket(bucket);

    // Basic
    if (!hasText(b.Name))                    e.push('Test name is required.');
    else if (str(b.Name).length > 200)       e.push('Test name is too long (max 200 characters).');

    const price = toNum(b.Price);
    if (price === null)                      e.push('Price is required.');
    else if (Number.isNaN(price) || price < 0) e.push('Price must be a valid number (0 or more).');
    else if (price > 1000000)                e.push('Price looks too high (max ₹10,00,000).');

    if (!hasText(b.TimeTakenForReporting))   e.push('Reporting time is required (e.g. "Same day").');
    else if (str(b.TimeTakenForReporting).length > 100) e.push('Reporting time is too long (max 100 characters).');

    const TimeToComplete = toInt(b.TimeToComplete);
    if (TimeToComplete === null)                        e.push('Test duration (minutes) is required.');
    else if (Number.isNaN(TimeToComplete) || TimeToComplete < 1)   e.push('Test duration must be at least 1 minute.');
    else if (TimeToComplete > 1440)                     e.push('Test duration cannot exceed 1440 minutes (24 hours).');

    const reportingDay = toInt(b.ReportingDay);
    if (reportingDay === null)                          e.push('Reporting day is required.');
    else if (Number.isNaN(reportingDay) || reportingDay < 0 || reportingDay > 365)
                                                        e.push('Reporting day must be between 0 (same day) and 365 days.');

    if (str(b.Description).length > 1000)    e.push('Description is too long (max 1000 characters).');

    // Film (only mandatory for imaging categories)
    if (isImaging && !idOrNull(b.FilmType))  e.push('Film type is required for imaging tests.');
    const films = toInt(b.NoOfFilms);
    if (films !== null && (Number.isNaN(films) || films < 0 || films > 50)) e.push('Number of films must be between 0 and 50.');

    // Pathology
    if (isPath) {
        if (!idOrNull(b.SpecimenTypeId))  e.push('Specimen type is required for pathology tests.');
        if (!idOrNull(b.ContainerTypeId)) e.push('Sample container is required for pathology tests.');

        const min = toNum(b.MinAmountOfBlood);
        const max = toNum(b.MaxAmountOfBlood);
        if (min === null || max === null)        e.push('Minimum and maximum sample volume are required.');
        else if (Number.isNaN(min) || Number.isNaN(max)) e.push('Sample volume must be a number.');
        else {
            if (min < 0 || max < 0)     e.push('Sample volume cannot be negative.');
            if (min > 100 || max > 100) e.push('Sample volume cannot exceed 100 ml.');
            if (min > max)              e.push('Minimum sample volume cannot be more than maximum.');
        }

        const params = toInt(b.Parameter);
        if (params === null || Number.isNaN(params) || params < 1 || params > 500)
            e.push('Number of parameters must be between 1 and 500.');

        const inv = toInt(b.Inversion);
        if (inv !== null && (Number.isNaN(inv) || inv < 0 || inv > 50))
            e.push('Inversions must be between 0 and 50.');
    }

    // Templates (never for pathology)
    if (!isPath && b.reportRequired) {
        const mode = str(b.templateMode) || 'common';
        if (!['common', 'separate', 'later'].includes(mode)) {
            e.push('Invalid template option.');
        } else if (mode === 'common' && !hasText(b.templateCommon)) {
            e.push('Upload the common report template, or choose "Add template later".');
        } else if (mode === 'separate' && !hasText(b.templateMale) && !hasText(b.templateFemale)) {
            e.push('Upload at least one gender template, or choose "Add template later".');
        }
    }

    return e;
};

/**
 * Decide what template columns to write.
 *  touch=false → leave existing template columns untouched (edit only)
 */
const resolveTemplates = (b, bucket, isEdit) => {
    const none = { touch: !isEdit, mode: 'none', common: null, male: null, female: null };
    if (isPathologyBucket(bucket) || !b.reportRequired) return none;

    const mode = str(b.templateMode) || 'common';
    if (mode === 'later')
        return { touch: !isEdit, mode, common: null, male: null, female: null };
    // ★ server-side cleaning — the browser only ever sends text, so it must never be trusted as HTML
    if (mode === 'common') {
        const common = cleanTemplate(b.templateCommon);
        if (!common) throw userError('The common template is empty after removing unsafe content. Upload the Word file again.');
        return { touch: true, mode, common, male: null, female: null };
    }
    const male = cleanTemplate(b.templateMale) || null, female = cleanTemplate(b.templateFemale) || null;
    if (!male && !female) throw userError('The gender templates are empty after removing unsafe content. Upload the Word files again.');
    return { touch: true, mode, common: null, male, female };
};

// ─────────────────────────────────────────────────────────────────────────────
// LOOKUPS
// ─────────────────────────────────────────────────────────────────────────────

const getCategoryById = async (categoryId, conn = null) => {
    const id = idOrNull(categoryId);
    if (!id) return null;
    const [rows] = await (conn || db()).execute('SELECT Id, Name FROM Category WHERE Id = ? LIMIT 1', [id]);
    return rows[0] || null;
};

const assertUniqueName = async (conn, name, categoryId, excludeId) => {
    const [rows] = await conn.execute(
        `SELECT Id FROM MainTestTable
         WHERE LOWER(TRIM(TestName)) = LOWER(TRIM(?)) AND CategoryId = ? AND Id <> ?
         LIMIT 1`,
        [name, categoryId, excludeId || 0]
    );
    if (rows.length) throw userError(`A test named "${str(name)}" already exists in this category.`);
};

// ─────────────────────────────────────────────────────────────────────────────
// SPECIMEN REQUIREMENT (pathology) — always on the caller's connection
// ─────────────────────────────────────────────────────────────────────────────

const upsertTestSpecimenRequirement = async (conn, testId, data) => {
    const params = [
        data.SpecimenTypeId         || null,
        data.ContainerTypeId        || null,
        data.MinVolume              ?? null,
        data.MaxVolume              ?? null,
        data.Inversions             || 0,
        data.CollectionInstructions || null,
        data.DepartmentId           || null,
    ];

    const [existing] = await conn.execute(
        `SELECT Id FROM Patho_TestSpecimenRequirement
         WHERE MainTestId = ? AND IsDefault = 1 AND DeletedAt IS NULL
         LIMIT 1`,
        [testId]
    );

    if (existing.length) {
        await conn.execute(
            `UPDATE Patho_TestSpecimenRequirement SET
                SpecimenTypeId = ?, ContainerTypeId = ?, MinVolume = ?, MaxVolume = ?,
                Inversions = ?, CollectionInstructions = ?, DepartmentId = ?,
                Status = 'active', UpdatedAt = NOW()
             WHERE Id = ?`,
            [...params, existing[0].Id]
        );
    } else {
        await conn.execute(
            `INSERT INTO Patho_TestSpecimenRequirement
               (MainTestId, SpecimenTypeId, ContainerTypeId, MinVolume, MaxVolume,
                Inversions, CollectionInstructions, DepartmentId, IsDefault, Status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'active')`,
            [testId, ...params]
        );
    }
};

const specimenDataFromBody = (b, user) => ({
    SpecimenTypeId:         idOrNull(b.SpecimenTypeId),
    ContainerTypeId:        idOrNull(b.ContainerTypeId),
    MinVolume:              toNum(b.MinAmountOfBlood),
    MaxVolume:              toNum(b.MaxAmountOfBlood),
    Inversions:             toInt(b.Inversion) || 0,
    CollectionInstructions: str(b.CollectionInstructions) || null,
    DepartmentId:           idOrNull(b.DepartmentId) || (user && user.DepartmentId) || null,
});

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT TEMPLATES (ReportTemplates) — SELECT then UPDATE/INSERT
// ─────────────────────────────────────────────────────────────────────────────

const syncDefaultTemplates = async (conn, { testId, testName, tpl, userId }) => {
    const genders = [['common', tpl.common], ['male', tpl.male], ['female', tpl.female]];
    const label   = { common: 'Common', male: 'Male', female: 'Female' };

    for (const [gender, content] of genders) {
        const [rows] = await conn.execute(
            `SELECT Id FROM ReportTemplates
             WHERE TestId = ? AND DoctorId IS NULL AND TemplateType = 'test_default' AND GenderType = ?
             ORDER BY Id DESC LIMIT 1`,
            [testId, gender]
        );

        if (content) {
            if (rows.length) {
                await conn.execute(
                    `UPDATE ReportTemplates
                     SET Name = ?, Content = ?, IsActive = 1, UpdatedAt = CURRENT_TIMESTAMP
                     WHERE Id = ?`,
                    [`${testName} - ${label[gender]}`, content, rows[0].Id]
                );
            } else {
                await conn.execute(
                    `INSERT INTO ReportTemplates (Name, DoctorId, TestId, GenderType, Content, TemplateType, IsActive, CreatedBy)
                     VALUES (?, NULL, ?, ?, ?, 'test_default', 1, ?)`,
                    [`${testName} - ${label[gender]}`, testId, gender, content, userId]
                );
            }
        } else if (rows.length) {
            // Template removed / mode switched → deactivate, keep history
            await conn.execute(
                `UPDATE ReportTemplates SET IsActive = 0, UpdatedAt = CURRENT_TIMESTAMP
                 WHERE TestId = ? AND DoctorId IS NULL AND TemplateType = 'test_default' AND GenderType = ?`,
                [testId, gender]
            );
        }
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// REGISTER TEST
// ─────────────────────────────────────────────────────────────────────────────

const registerTest = async (req) => {
    const b = req.body || {};

    const category = await getCategoryById(b.MainCategory);
    if (!category) throw userError('Please select a valid category (it may have been deleted — refresh the page).');

    const bucket = categoryBucket(category.Name);
    const isPath = isPathologyBucket(bucket);

    const errors = validateTestDetails(b, bucket);
    if (errors.length) throw userError(errors);

    const tpl  = resolveTemplates(b, bucket, false);
    const spec = specimenDataFromBody(b, req.user);
    const now  = currDateAndTime.getCurrentDateAndTime()[0];

    const d = {
        TestName:              str(b.Name),
        CategoryId:            category.Id,
        TimeTakenForReporting: str(b.TimeTakenForReporting),
        Description:           str(b.Description) || '',          // column is NOT NULL
        TestCreatedOn:         now,
        ReportingDay:          toInt(b.ReportingDay) || 0,        // Reporting Day select (0 = same day)
        ReportingTime:         str(b.TimeTakenForReporting),
        TestCreatedBy:         req.user.Id,
        Price:                 round2(toNum(b.Price)),
        TemplateCommon:        tpl.common,
        TemplateMale:          tpl.male,
        TemplateFemale:        tpl.female,
        Status:                1,
        IsReportRequired:      b.reportRequired ? 1 : 0,
        FilmTypeId:            isPath ? null : idOrNull(b.FilmType),
        NoOfFilm:              isPath ? 0 : (toInt(b.NoOfFilms) || 0),
        Type:                  isPath ? (toInt(b.Type) || 1) : 1,
        SampleContainer:       isPath ? spec.ContainerTypeId : null,
        FastingRequired:       isPath ? (toInt(b.FastingRequired) || 0) : 0,
        SpecimenType:          isPath ? spec.SpecimenTypeId : null,
        MinAmountOfBlood:      isPath ? spec.MinVolume : 0,
        MaxAmountOfBlood:      isPath ? spec.MaxVolume : 0,
        Inversion:             isPath ? spec.Inversions : 0,
        NoOfParameter:         isPath ? (toInt(b.Parameter) || 1) : 0,
        TimeToComplete:        toInt(b.TimeToComplete) || 30,     // Test Duration (minutes)
    };

    const conn = await getConn();
    try {
        await conn.beginTransaction();
        await assertUniqueName(conn, d.TestName, d.CategoryId, null);

        const [result] = await conn.query(
            `INSERT INTO MainTestTable (
                TestName, CategoryId, TimeTakenForReporting, Description,
                TestCreatedOn, ReportingDay, ReportingTime, TestCreatedBy,
                Price, TemplateCommon, TemplateMale, TemplateFemale,
                Status, IsReportRequired, FilmTypeId, NoOfFilm,
                Type, SampleContainer, FastingRequired, SpecimenType,
                MinAmountOfBlood, MaxAmountOfBlood, Inversion, NoOfParameter, TimeToComplete
            ) VALUES (?,?,?,?, ?,?,?,?, ?,?,?,?, ?,?,?,?, ?,?,?,?, ?,?,?,?,?)`,
            [
                d.TestName, d.CategoryId, d.TimeTakenForReporting, d.Description,
                d.TestCreatedOn, d.ReportingDay, d.ReportingTime, d.TestCreatedBy,
                d.Price, d.TemplateCommon, d.TemplateMale, d.TemplateFemale,
                d.Status, d.IsReportRequired, d.FilmTypeId, d.NoOfFilm,
                d.Type, d.SampleContainer, d.FastingRequired, d.SpecimenType,
                d.MinAmountOfBlood, d.MaxAmountOfBlood, d.Inversion, d.NoOfParameter, d.TimeToComplete,
            ]
        );
        const testId = result.insertId;

        if (isPath) await upsertTestSpecimenRequirement(conn, testId, spec);

        if (tpl.common || tpl.male || tpl.female) {
            await syncDefaultTemplates(conn, { testId, testName: d.TestName, tpl, userId: req.user.Id });
        }

        await handleDoctorCommissions(d.CategoryId, d.Price, testId, conn);

        await conn.commit();

        const pending = d.IsReportRequired && !isPath && tpl.mode === 'later';
        return {
            testId,
            templatePending: pending,
            message: pending
                ? `Test "${d.TestName}" created. Report template is pending — upload it from Edit Test before reporting.`
                : `Test "${d.TestName}" created successfully.`,
        };
    } catch (err) {
        await conn.rollback().catch(() => {});
        if (!err.isUserError) log.error('registerTest failed:', err.code || '', err.message);
        throw err;
    } finally {
        conn.release();
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE TEST
// ─────────────────────────────────────────────────────────────────────────────

const updateTest = async (testId, body, user) => {
    const b  = body || {};
    const id = idOrNull(testId);
    if (!id) throw userError('Invalid test ID.');

    const conn = await getConn();
    try {
        await conn.beginTransaction();

        const [found] = await conn.execute('SELECT * FROM MainTestTable WHERE Id = ? FOR UPDATE', [id]);
        const existing = found[0];
        if (!existing) throw userError('This test no longer exists.');

        // Category is locked after creation — always use the stored one
        const category = await getCategoryById(existing.CategoryId, conn);
        const bucket   = categoryBucket(category ? category.Name : '');
        const isPath   = isPathologyBucket(bucket);

        const errors = validateTestDetails(b, bucket);
        if (errors.length) throw userError(errors);

        await assertUniqueName(conn, b.Name, existing.CategoryId, id);

        const tpl  = resolveTemplates(b, bucket, true);
        const spec = specimenDataFromBody(b, user);

        const fields = {
            TestName:              str(b.Name),
            TimeTakenForReporting: str(b.TimeTakenForReporting),
            ReportingTime:         str(b.TimeTakenForReporting),
            ReportingDay:          toInt(b.ReportingDay) || 0,                              // Reporting Day select
            TimeToComplete:        toInt(b.TimeToComplete) || existing.TimeToComplete || 30, // Test Duration (minutes)
            Description:           str(b.Description) || '',                                // column is NOT NULL
            Price:                 round2(toNum(b.Price)),
            IsReportRequired:      b.reportRequired ? 1 : 0,
            FilmTypeId:            isPath ? null : idOrNull(b.FilmType),
            NoOfFilm:              isPath ? 0 : (toInt(b.NoOfFilms) || 0),
            UpdatedAt:             new Date(),
            UpdatedBy:             user.Id,
        };

        if (isPath) Object.assign(fields, {
            Type:             toInt(b.Type) || 1,
            FastingRequired:  toInt(b.FastingRequired) || 0,
            NoOfParameter:    toInt(b.Parameter) || 1,
            MinAmountOfBlood: spec.MinVolume,
            MaxAmountOfBlood: spec.MaxVolume,
            Inversion:        spec.Inversions,
            SpecimenType:     spec.SpecimenTypeId,
            SampleContainer:  spec.ContainerTypeId,
        });

        if (tpl.touch) Object.assign(fields, {
            TemplateCommon: tpl.common,
            TemplateMale:   tpl.male,
            TemplateFemale: tpl.female,
        });

        const cols = Object.keys(fields);   // keys are hard-coded above → no column injection
        await conn.execute(
            `UPDATE MainTestTable SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE Id = ?`,
            [...cols.map(c => fields[c]), id]
        );

        if (isPath) await upsertTestSpecimenRequirement(conn, id, spec);
        if (tpl.touch) await syncDefaultTemplates(conn, { testId: id, testName: fields.TestName, tpl, userId: user.Id });

        // ★ price changed → thanks that came from the doctor's category % follow the new price.
        // Amounts set by hand for a doctor + test (≠ old price × his %) are negotiated and stay.
        let commissionNote = '';
        const oldPrice = round2(existing.Price);
        if (oldPrice !== fields.Price) {
            const [r] = await conn.query(`
                UPDATE DoctorTestCommission dtc
                JOIN DoctorCategoryCommission dcc ON dcc.DoctorId = dtc.DoctorId AND dcc.CategoryId = ?
                SET dtc.Commission = ROUND(? * dcc.CommissionRate / 100, 2)
                WHERE dtc.TestId = ? AND ABS(dtc.Commission - ROUND(? * dcc.CommissionRate / 100, 2)) < 0.02`,
                [existing.CategoryId, fields.Price, id, oldPrice]);
            const [[k]] = await conn.query(`
                SELECT COUNT(*) AS n FROM DoctorTestCommission dtc
                LEFT JOIN DoctorCategoryCommission dcc ON dcc.DoctorId = dtc.DoctorId AND dcc.CategoryId = ?
                WHERE dtc.TestId = ? AND (dcc.DoctorId IS NULL OR ABS(dtc.Commission - ROUND(? * dcc.CommissionRate / 100, 2)) >= 0.02)`,
                [existing.CategoryId, id, fields.Price]);
            commissionNote = ` Price ₹${oldPrice} → ₹${fields.Price}: thanks re-calculated for ${r.affectedRows || 0} doctor(s)` +
                             (Number(k.n) ? `; ${k.n} doctor-specific amount(s) kept — check them on the doctors' thanks page.` : '.');
        }

        await conn.commit();

        const pending = fields.IsReportRequired && !isPath &&
            !(tpl.touch ? (tpl.common || tpl.male || tpl.female)
                        : (existing.TemplateCommon || existing.TemplateMale || existing.TemplateFemale));
        return {
            templatePending: !!pending,
            message: (pending
                ? `Test "${fields.TestName}" updated. Report template is still pending.`
                : `Test "${fields.TestName}" updated successfully.`) + commissionNote,
        };
    } catch (err) {
        await conn.rollback().catch(() => {});
        if (!err.isUserError) log.error('updateTest failed:', err.code || '', err.message);
        throw err;
    } finally {
        conn.release();
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// TEST QUERIES
// ─────────────────────────────────────────────────────────────────────────────

const LIST_COLUMNS = `
    UPPER(m.TestName) AS TestName, m.Price, m.Status, m.Id, m.CategoryId, c.Name,
    m.IsReportRequired,
    (COALESCE(NULLIF(TRIM(m.TemplateCommon), ''), NULLIF(TRIM(m.TemplateMale), ''), NULLIF(TRIM(m.TemplateFemale), '')) IS NOT NULL) AS HasTemplate
`;

const getTestDetails = async () => {
    const [rows] = await db().execute(`
        SELECT ${LIST_COLUMNS}
        FROM MainTestTable m
        JOIN Category c ON m.CategoryId = c.Id
        ORDER BY c.Name, m.TestName
    `);
    return rows || [];
};

/** Accepts either `req` (old callers) or a plain filters object. */
const getSearchedTestDetails = async (reqOrFilters) => {
    const f = (reqOrFilters && reqOrFilters.body !== undefined && reqOrFilters.method)
        ? (reqOrFilters.body || {})
        : (reqOrFilters || {});
    const { category, testName, status } = f;

    const where = [], params = [];
    if (category && category != 0)  { where.push('m.CategoryId = ?');  params.push(category); }
    if (str(testName))              { where.push('m.TestName LIKE ?'); params.push(`%${str(testName)}%`); }
    if (status && status != 0)      { where.push('m.Status = ?');      params.push(status); }

    const [rows] = await db().execute(`
        SELECT ${LIST_COLUMNS}
        FROM MainTestTable m
        JOIN Category c ON m.CategoryId = c.Id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY c.Name, m.TestName
    `, params);
    return rows || [];
};

const getIndividualTestDetails = async (testId) => {
    const [rows] = await db().query('SELECT * FROM MainTestTable WHERE Id = ?', [testId]);
    return rows[0] || null;
};

const getTestById = async (testId) => {
    const [rows] = await db().execute('SELECT * FROM MainTestTable WHERE Id = ? LIMIT 1', [testId]);
    return rows[0] || null;
};

const getPatientTestDetails = async (patientId) => {
    const [rows] = await db().execute(`
        SELECT m.IsReportRequired, m.TestName, m.Price, ptr.TestId, ptr.Discount
        FROM MainTestTable m
        JOIN PatientTestRefference ptr ON m.Id = ptr.TestId
        WHERE ptr.PatientId = ?
    `, [patientId]);
    return rows || [];
};

const getFilmType = async () => {
    const [rows] = await db().query('SELECT * FROM FilmType ORDER BY Name');
    return rows || [];
};

const getTestCategories = async () => {
    const [rows] = await db().query('SELECT Id, Name FROM Category');
    return rows || [];
};

const getAllCategories = async () => {
    const [rows] = await db().execute('SELECT Id, Name FROM Category ORDER BY Name');
    return rows || [];
};

const getAllFilmTypes = async () => {
    const [rows] = await db().execute('SELECT Id, Name FROM FilmType ORDER BY Name');
    return rows || [];
};

const getTestData = async (testId) => {
    const [rows] = await db().execute('SELECT * FROM MainTestTable WHERE Id = ?', [testId]);
    return rows || [];
};

const getTestSpecimenRequirement = async (testId) => {
    const [rows] = await db().execute(
        `SELECT
            tsr.Id, tsr.MainTestId, tsr.SpecimenTypeId, tsr.ContainerTypeId,
            tsr.MinVolume, tsr.MaxVolume, tsr.Inversions, tsr.CollectionInstructions,
            tsr.IsDefault, tsr.DepartmentId,
            st.TypeName      AS SpecimenTypeName,
            ct.ContainerName AS ContainerTypeName,
            ct.CapColor      AS ContainerCapColor
         FROM Patho_TestSpecimenRequirement tsr
         LEFT JOIN Patho_SpecimenType  st ON st.Id = tsr.SpecimenTypeId
         LEFT JOIN Patho_ContainerType ct ON ct.Id = tsr.ContainerTypeId
         WHERE tsr.MainTestId = ? AND tsr.IsDefault = 1
           AND tsr.Status = 'active' AND tsr.DeletedAt IS NULL
         LIMIT 1`,
        [testId]
    );
    return rows[0] || null;
};

// ─────────────────────────────────────────────────────────────────────────────
// ACTIVATE / DEACTIVATE
// ─────────────────────────────────────────────────────────────────────────────

const checkTestExist = async (testId) => {
    const [rows] = await db().execute('SELECT Id FROM MainTestTable WHERE Id = ?', [testId]);
    return rows.length > 0;
};

const setTestStatus = async (testId, status) => {
    const id = idOrNull(testId);
    if (!id || !(await checkTestExist(id))) throw userError('Test not found — it may have been deleted.');
    await db().execute('UPDATE MainTestTable SET Status = ? WHERE Id = ?', [status, id]);
};

const makeTestActive = async (testId) => {
    await setTestStatus(testId, 1);
    return 'Test activated — it is now available for patient registration.';
};

const makeTestInActive = async (testId) => {
    await setTestStatus(testId, 2);
    return 'Test deactivated — it will no longer appear during patient registration.';
};

// ─────────────────────────────────────────────────────────────────────────────
// SUB-TESTS
// ─────────────────────────────────────────────────────────────────────────────

const getSubTestDetails = async () => {
    const [rows] = await db().query(`
        SELECT mstr.MainTestId AS mainTestId, st.Id AS subTestId, st.Name, st.Price, st.Discount
        FROM SubTestTable st
        JOIN MainTestSubTestReference mstr ON mstr.SubTestId = st.Id
        ORDER BY mstr.MainTestId, st.Name
    `);
    return rows || [];
};

/** Sub-test list for the list page (LEFT JOIN: a sub-test never disappears if its category is gone). */
const getSubTestList = async () => {
    const [rows] = await db().query(`
        SELECT st.Id AS SubTestId, st.CategoryId, st.ThanksAmount, st.Discount, st.Price, st.Name,
               c.Name AS categoryName,
               (SELECT COUNT(*) FROM MainTestSubTestReference m WHERE m.SubTestId = st.Id)  AS AttachedCount,
               (SELECT GROUP_CONCAT(mt.TestName ORDER BY mt.TestName SEPARATOR ', ')
                  FROM MainTestSubTestReference m JOIN MainTestTable mt ON mt.Id = m.MainTestId
                 WHERE m.SubTestId = st.Id)                                                 AS AttachedTo,
               (SELECT COUNT(*) FROM DoctorSubTestCommission d WHERE d.SubTestId = st.Id)  AS DoctorRules
        FROM SubTestTable st
        LEFT JOIN Category c ON c.Id = st.CategoryId
        ORDER BY c.Name, st.Name
    `);
    return rows || [];
};

const getSubTestDetail = async (subTestId) => {
    const [rows] = await db().execute('SELECT * FROM SubTestTable WHERE Id = ?', [subTestId]);
    return rows || [];
};

const getAttachedTestlist = async (testId) => {
    const [rows] = await db().execute(`
        SELECT st.Id AS subTestId, st.Name, st.Price, st.Discount
        FROM SubTestTable st
        JOIN MainTestSubTestReference mstr ON mstr.SubTestId = st.Id
        WHERE mstr.MainTestId = ?
    `, [testId]);
    return rows || [];
};

const getSelectedTestDetail = async (testId) => {
    const [rows] = await db().execute('SELECT * FROM MainTestTable WHERE Id = ?', [testId]);
    return rows || [];
};

const getAllUnattachedTestList = async (testId) => {
    const testDetails = await getSelectedTestDetail(testId);
    if (!testDetails.length) throw userError(`Test ${testId} not found.`);

    const [rows] = await db().execute(`
        SELECT st.Id AS SubTestId, st.CategoryId, st.ThanksAmount,
               st.Discount, st.Price, st.Name, c.Name AS categoryName
        FROM SubTestTable st
        JOIN Category c ON c.Id = st.CategoryId
        WHERE st.Id NOT IN (SELECT SubTestId FROM MainTestSubTestReference WHERE MainTestId = ?)
          AND st.CategoryId = ?
    `, [testId, testDetails[0].CategoryId]);
    return rows || [];
};

const attachSubTestToTest = async (req) => {
    const date   = currDateAndTime.getCurrentDateAndTime()[0];
    const testId = idOrNull(req.query.testId);
    const raw    = req.body.subTest;
    const ids    = [...new Set((Array.isArray(raw) ? raw : [raw]).map(idOrNull).filter(Boolean))];
    if (!testId)     throw userError('Missing test ID.');
    if (!ids.length) throw userError('Select at least one sub test to attach.');

    const conn = await getConn();
    try {
        await conn.beginTransaction();
        // ★ lock the test row: two tabs attaching at once cannot create duplicate links
        const [[test]] = await conn.query('SELECT Id, CategoryId FROM MainTestTable WHERE Id = ? FOR UPDATE', [testId]);
        if (!test) throw userError('Test not found.');
        // ★ only real sub-tests of the SAME category (the list page shows only those; the form could be edited)
        const [subs]  = await conn.query('SELECT Id, CategoryId FROM SubTestTable WHERE Id IN (?)', [ids]);
        const okIds   = subs.filter(s => Number(s.CategoryId) === Number(test.CategoryId)).map(s => Number(s.Id));
        if (!okIds.length) throw userError('The selected sub-test(s) do not belong to this test\'s category.');
        const [have]  = await conn.query('SELECT SubTestId FROM MainTestSubTestReference WHERE MainTestId = ? AND SubTestId IN (?)', [testId, okIds]);
        const already = new Set(have.map(r => Number(r.SubTestId)));
        const toAdd   = okIds.filter(id => !already.has(id));
        if (!toAdd.length) { await conn.rollback(); return 'The selected sub-test(s) were already attached.'; }
        // FIX: table name case — was "MaintestSubTestReference" (fails on Linux MySQL)
        await conn.query('INSERT INTO MainTestSubTestReference (MainTestId, SubTestId, LinkedOn, LinkedBy) VALUES ?',
            [toAdd.map(sid => [testId, sid, date, req.user.Id])]);
        await conn.commit();
        const skipped = ids.length - toAdd.length;
        return `${toAdd.length} sub test(s) attached successfully.` + (skipped ? ` ${skipped} skipped (already attached or other category).` : '');
    } catch (err) {
        await conn.rollback().catch(() => {});
        throw err;
    } finally {
        conn.release();
    }
};

const detachSubTest = async (req) => {
    const [result] = await db().execute(
        'DELETE FROM MainTestSubTestReference WHERE MainTestId = ? AND SubTestId = ?',
        [idOrNull(req.query.testId), idOrNull(req.query.subTestId)]
    );
    if (result.affectedRows > 0) return 'Sub test detached successfully.';
    throw userError('Sub test was not attached to this test.');
};

/**
 * Sub-test form → { data, errors }. Price / Discount / Thanks are whole rupees (INT columns).
 * Thanks 0 = this sub-test gives no thanks (unless a doctor has his own amount).
 */
const readSubTestForm = (b = {}) => {
    const e = [];
    const name = str(b.Name).replace(/\s+/g, ' ');
    const categoryId = idOrNull(b.MainCategory);
    const rupees = (v, label, { required = true } = {}) => {
        const n = toNum(v);
        if (n === null) { if (required) e.push(`${label} is required (0 if none).`); return 0; }
        if (Number.isNaN(n) || n < 0) { e.push(`${label} must be a number of 0 or more.`); return 0; }
        if (n > 1000000) { e.push(`${label} looks too high.`); return 0; }
        return Math.round(n);
    };
    if (!categoryId)        e.push('Choose the category.');
    if (!name)              e.push('Sub-test name is required.');
    else if (name.length > 45) e.push('Sub-test name is too long (max 45 characters).');
    const price    = rupees(b.Price, 'Price');
    const discount = rupees(b.Discount, 'Default discount', { required: false });
    const thanks   = rupees(b.Thanks, 'Default thanks');
    if (discount > price) e.push(`Default discount (₹${discount}) cannot be more than the price (₹${price}).`);
    return { errors: e, data: { CategoryId: categoryId, Name: name, Price: price, Discount: discount, ThanksAmount: thanks } };
};

const assertUniqueSubTest = async (conn, name, categoryId, excludeId) => {
    const [rows] = await conn.query(
        'SELECT Id FROM SubTestTable WHERE LOWER(TRIM(Name)) = LOWER(?) AND CategoryId = ? AND Id <> ? LIMIT 1',
        [name, categoryId, excludeId || 0]);
    if (rows.length) throw userError(`A sub-test named "${name}" already exists in this category.`);
};

/**
 * New sub-test. Does NOT copy the thanks into a row for every doctor any more:
 * doctors without their own row simply get the sub-test default, so changing the default later works.
 */
const CreateSubTest = async (req) => {
    const { data, errors } = readSubTestForm(req.body);
    if (errors.length) throw userError(errors);
    const conn = await getConn();
    try {
        await conn.beginTransaction();
        const cat = await getCategoryById(data.CategoryId, conn);
        if (!cat) throw userError('The selected category no longer exists. Refresh the page.');
        await assertUniqueSubTest(conn, data.Name, data.CategoryId, null);
        const [result] = await conn.query('INSERT INTO SubTestTable SET ?', [{
            ...data, CreatedBy: String(req.user.Id), CreatedOn: currDateAndTime.getCurrentDateAndTime()[0],
        }]);
        await conn.commit();
        return { id: result.insertId, message: `Sub-test "${data.Name}" created. Attach it to its tests from the Test list (Add sub test).` };
    } catch (err) {
        await conn.rollback().catch(() => {});
        if (!err.isUserError) log.error('CreateSubTest error:', err.message);
        throw err;
    } finally {
        conn.release();
    }
};

/** Doctor-wise rows are kept — only the defaults change. */
const updateSubTest = async (req) => {
    const id = idOrNull(req.query.subTestId || req.params.subTestId);
    if (!id) throw userError('Sub-test not found.');
    const { data, errors } = readSubTestForm(req.body);
    if (errors.length) throw userError(errors);
    const conn = await getConn();
    try {
        await conn.beginTransaction();
        const [[cur]] = await conn.query('SELECT * FROM SubTestTable WHERE Id = ? FOR UPDATE', [id]);
        if (!cur) throw userError('Sub-test not found. It may have been deleted.');
        if (Number(cur.CategoryId) !== data.CategoryId) {
            const [[att]] = await conn.query('SELECT COUNT(*) AS n FROM MainTestSubTestReference WHERE SubTestId = ?', [id]);
            if (Number(att.n)) throw userError(`This sub-test is attached to ${att.n} test(s) of its current category. Detach it first, then change the category.`);
        }
        await assertUniqueSubTest(conn, data.Name, data.CategoryId, id);
        await conn.query('UPDATE SubTestTable SET ? WHERE Id = ?', [data, id]);
        // a doctor row that now equals the new default carries no meaning any more
        await conn.query(`UPDATE DoctorSubTestCommission SET Thanks = NULL WHERE SubTestId = ? AND Thanks = ?`, [id, data.ThanksAmount]);
        await conn.query(`UPDATE DoctorSubTestCommission SET Discount = NULL WHERE SubTestId = ? AND Discount = ?`, [id, data.Discount]);
        await conn.query(`DELETE FROM DoctorSubTestCommission WHERE SubTestId = ? AND Thanks IS NULL AND Discount IS NULL AND ShowInReport IS NULL`, [id]);
        await conn.commit();
        return `Sub-test "${data.Name}" updated. Doctors without their own setting now get ₹${data.ThanksAmount} thanks and ₹${data.Discount} discount.`;
    } catch (err) {
        await conn.rollback().catch(() => {});
        if (!err.isUserError) log.error('updateSubTest error:', err.message);
        throw err;
    } finally {
        conn.release();
    }
};

/** Doctors who have their own setting for a sub-test (edit page). */
const getSubTestDoctorRules = async (subTestId) => {
    const [rows] = await db().query(`
        SELECT d.DoctorId, CONCAT_WS(' ', dd.FirstName, dd.LastName) AS DoctorName, d.Thanks, d.Discount, d.ShowInReport
        FROM DoctorSubTestCommission d JOIN DoctorDetails dd ON dd.Id = d.DoctorId
        WHERE d.SubTestId = ? ORDER BY dd.FirstName, dd.LastName`, [subTestId]);
    return rows || [];
};

// ─────────────────────────────────────────────────────────────────────────────
// DOCTOR-WISE SUB-TEST SETTINGS (thanks ₹ / discount ₹ / show in thanks report)
// ─────────────────────────────────────────────────────────────────────────────

/** Every sub-test with its default and this doctor's own setting (null = default). */
const getDoctorSubTestRates = async (doctorId) => {
    const id = idOrNull(doctorId);
    if (!id) return null;
    const [[doctor]] = await db().query('SELECT * FROM DoctorDetails WHERE Id = ?', [id]);
    if (!doctor) return null;
    const [rows] = await db().query(`
        SELECT st.Id AS SubTestId, st.Name, st.Price, st.Discount AS DefaultDiscount, st.ThanksAmount AS DefaultThanks,
               c.Name AS CategoryName,
               (SELECT GROUP_CONCAT(mt.TestName ORDER BY mt.TestName SEPARATOR ', ')
                  FROM MainTestSubTestReference m JOIN MainTestTable mt ON mt.Id = m.MainTestId WHERE m.SubTestId = st.Id) AS AttachedTo,
               d.Thanks AS OwnThanks, d.Discount AS OwnDiscount, d.ShowInReport
        FROM SubTestTable st
        LEFT JOIN Category c ON c.Id = st.CategoryId
        LEFT JOIN DoctorSubTestCommission d ON d.SubTestId = st.Id AND d.DoctorId = ?
        ORDER BY c.Name, st.Name`, [id]);
    return { doctor, rows: rows || [] };
};

/**
 * body: thanks_<subTestId>, discount_<subTestId> ('' = default), show_<subTestId> ('auto' | '1' | '0'),
 *       showZeroSubTests ('1' = list sub-tests with 0 thanks in this doctor's report)
 */
const saveDoctorSubTestRates = async (doctorId, body = {}, userId) => {
    const id = idOrNull(doctorId);
    if (!id) throw userError('Doctor not found.');
    const conn = await getConn();
    try {
        await conn.beginTransaction();
        const [[doctor]] = await conn.query('SELECT Id FROM DoctorDetails WHERE Id = ? FOR UPDATE', [id]);
        if (!doctor) throw userError('Doctor not found.');
        const [subs] = await conn.query('SELECT Id, Name, Price, Discount, ThanksAmount FROM SubTestTable');
        const errors = [], upserts = [], clears = [];
        const today = currDateAndTime.getCurrentDateAndTime()[0];
        for (const st of subs) {
            const k = st.Id;
            if (body[`thanks_${k}`] === undefined && body[`discount_${k}`] === undefined && body[`show_${k}`] === undefined) continue;
            const t = toNum(body[`thanks_${k}`]), dsc = toNum(body[`discount_${k}`]);
            const show = str(body[`show_${k}`]);
            if (t !== null && (Number.isNaN(t) || t < 0))   { errors.push(`${st.Name}: thanks must be 0 or more.`); continue; }
            if (dsc !== null && (Number.isNaN(dsc) || dsc < 0)) { errors.push(`${st.Name}: discount must be 0 or more.`); continue; }
            if (dsc !== null && dsc > Number(st.Price))      { errors.push(`${st.Name}: discount ₹${dsc} is more than the price ₹${st.Price}.`); continue; }
            // same as the default → no own value
            const thanks   = t === null || Math.round(t) === Number(st.ThanksAmount) ? null : Math.round(t);
            const discount = dsc === null || Math.round(dsc) === Number(st.Discount) ? null : Math.round(dsc);
            const showVal  = show === '1' ? 1 : show === '0' ? 0 : null;
            if (thanks === null && discount === null && showVal === null) clears.push(k);
            else upserts.push([id, k, thanks, discount, showVal, today, today, userId || null]);
        }
        if (errors.length) throw userError(errors);
        if (clears.length) await conn.query('DELETE FROM DoctorSubTestCommission WHERE DoctorId = ? AND SubTestId IN (?)', [id, clears]);
        if (upserts.length) {
            await conn.query(`
                INSERT INTO DoctorSubTestCommission (DoctorId, SubTestId, Thanks, Discount, ShowInReport, RegisteredOn, ModifiedOn, ModifiedBy)
                VALUES ? ON DUPLICATE KEY UPDATE Thanks = VALUES(Thanks), Discount = VALUES(Discount),
                         ShowInReport = VALUES(ShowInReport), ModifiedOn = VALUES(ModifiedOn), ModifiedBy = VALUES(ModifiedBy)`, [upserts]);
        }
        if (body.showZeroSubTests !== undefined || body.hasShowZero !== undefined) {
            await conn.query('UPDATE DoctorDetails SET ShowZeroThanksSubTests = ? WHERE Id = ?', [str(body.showZeroSubTests) === '1' ? 1 : 0, id]);
        }
        await conn.commit();
        return `Saved. ${upserts.length} sub-test${upserts.length === 1 ? ' has' : 's have'} this doctor's own setting; the rest use the defaults.`;
    } catch (err) {
        await conn.rollback().catch(() => {});
        if (!err.isUserError) log.error('saveDoctorSubTestRates:', err.message);
        throw err;
    } finally {
        conn.release();
    }
};

/** { SubTestId: discount ₹ } for this doctor's own discounts — the patient form pre-fills them. */
const getDoctorSubTestDiscounts = async (doctorId) => {
    const id = idOrNull(doctorId);
    if (!id) return {};
    const [rows] = await db().query('SELECT SubTestId, Discount FROM DoctorSubTestCommission WHERE DoctorId = ? AND Discount IS NOT NULL', [id]);
    const out = {};
    rows.forEach(r => { out[r.SubTestId] = Number(r.Discount) || 0; });
    return out;
};

// ─────────────────────────────────────────────────────────────────────────────
// COMMISSIONS — sequential on the transaction connection
// (Promise.all on one connection just queues anyway and hides the real error)
// ─────────────────────────────────────────────────────────────────────────────

const handleDoctorCommissions = async (categoryId, testPrice, testId, conn) => {
    const [doctors] = await conn.execute(
        'SELECT DoctorId, CommissionRate FROM DoctorCategoryCommission WHERE CategoryId = ?',
        [categoryId]
    );
    for (const { DoctorId, CommissionRate } of doctors) {
        await conn.execute(
            'INSERT INTO DoctorTestCommission (DoctorId, TestId, Commission) VALUES (?,?,?)',
            [DoctorId, testId, round2((Number(testPrice) * Number(CommissionRate || 0)) / 100)]   // ★ paise, not 166.666666
        );
    }
};

const getAllDoctorCommissionRateBasedOnCategory = async (categoryId) => {
    const [rows] = await db().execute(
        'SELECT DoctorId, CommissionRate FROM DoctorCategoryCommission WHERE CategoryId = ?',
        [categoryId]
    );
    return rows || [];
};

// ─────────────────────────────────────────────────────────────────────────────
// PATIENT SUB-TESTS / MAP / THANKS
// ─────────────────────────────────────────────────────────────────────────────

const getPatientSubTestDetail = async (patientId) => {
    const [rows] = await db().execute(`
        SELECT psr.Id AS PatientSubTestRefId, psr.SubTestId, psr.PatientId,
               st.Id AS SubTestId, st.Price, st.Discount, st.Name AS TestName
        FROM PatientSubTestRefference psr
        INNER JOIN SubTestTable st ON psr.SubTestId = st.Id
        WHERE psr.PatientId = ?
    `, [patientId]);
    return rows || [];
};

const getSubTestMap = async () => {
    const [rows] = await db().execute(`
        SELECT msr.MainTestId, st.Id AS SubTestId, st.Name AS SubTestName, st.Price, st.Discount
        FROM MainTestSubTestReference msr
        JOIN SubTestTable st ON st.Id = msr.SubTestId
        ORDER BY msr.MainTestId ASC, st.Id ASC
    `);
    const map = {};
    for (const row of rows) {
        (map[row.MainTestId] = map[row.MainTestId] || []).push({
            SubTestId:   row.SubTestId,
            SubTestName: row.SubTestName,
            Price:       parseFloat(row.Price)    || 0,
            Discount:    parseFloat(row.Discount) || 0,
        });
    }
    return map;
};

const searchTestForUpdatingThanks = async (req) => {
    const { doctorId, SelectDoctorThanksCategorySearch: categoryId, searchTest: testName } = req.body;
    const [rows] = await db().execute(`
        SELECT mt.TestName, mt.Id, dtc.Commission
        FROM DoctorTestCommission dtc
        JOIN MainTestTable mt ON dtc.TestId = mt.Id
        WHERE mt.CategoryId = ? AND mt.TestName LIKE ? AND dtc.DoctorId = ?
    `, [categoryId, `%${testName || ''}%`, doctorId]);
    return rows || [];
};

// ─────────────────────────────────────────────────────────────────────────────
// SUB-PARAMETERS (Pathology)
// ─────────────────────────────────────────────────────────────────────────────

const asArray = (v) => (v === undefined || v === null) ? [] : (Array.isArray(v) ? v : [v]);

const changeSubParameterRanges = async (conn, dataObject, subParameterId) => {
    const age_min   = asArray(dataObject.age_min);
    const age_max   = asArray(dataObject.age_max);
    const min_value = asArray(dataObject.min_value);
    const max_value = asArray(dataObject.max_value);
    const gender    = asArray(dataObject.gender);
    const age_unit  = asArray(dataObject.age_unit);

    if (!age_min.length) return;
    if ([age_max, min_value, max_value, gender].some(a => a.length !== age_min.length))
        throw userError('Every reference range row must have age min/max, value min/max and gender.');
    if (age_min.length > 50) throw userError('Too many reference range rows (max 50).');

    // ★ wrong ranges print wrong "normal / abnormal" on patient reports
    const errs = [];
    const ranges = age_min.map((_, i) => {
        const aMin = toNum(age_min[i]), aMax = toNum(age_max[i]), vMin = toNum(min_value[i]), vMax = toNum(max_value[i]);
        const row = `Range row ${i + 1}`;
        if ([aMin, aMax, vMin, vMax].some(n => n === null || Number.isNaN(n))) errs.push(`${row}: ages and values must be numbers.`);
        else {
            if (aMin < 0 || aMin > aMax) errs.push(`${row}: age min must be 0 or more and not more than age max.`);
            if (vMin > vMax)             errs.push(`${row}: value min cannot be more than value max.`);
        }
        if (!str(gender[i]) || str(gender[i]).length > 20) errs.push(`${row}: select the gender.`);
        return [subParameterId, aMin, aMax, str(age_unit[i]).slice(0, 20) || null, vMin, vMax, str(gender[i])];
    });
    if (errs.length) throw userError(errs);
    await conn.query(
        'INSERT INTO SubParameterRanges (SubParameterId, AgeMin, AgeMax, AgeUnit, MinVal, MaxVal, Gender) VALUES ?',
        [ranges]
    );
};

const readSubParameter = (d = {}) => {
    const name = str(d.subParameter).replace(/\s+/g, ' '), unit = str(d.unit), header = str(d.subParameterHeader);
    const e = [];
    if (!name)              e.push('Enter the sub parameter name.');
    if (name.length > 150)  e.push('Sub parameter name is too long (max 150).');
    if (unit.length > 50)   e.push('Unit is too long (max 50).');
    if (header.length > 150) e.push('Header is too long (max 150).');
    if (e.length) throw userError(e);
    return { name, unit, header };
};

const createSubParameterForPathology = async (dataObject) => {
    const sp = readSubParameter(dataObject);
    const conn = await getConn();
    try {
        await conn.beginTransaction();
        const [result] = await conn.execute(
            'INSERT INTO TestSubParametersForPathology (SubParameterName, Unit, Header) VALUES (?,?,?)',
            [sp.name, sp.unit, sp.header]
        );
        await changeSubParameterRanges(conn, dataObject, result.insertId);
        await conn.commit();
    } catch (err) {
        await conn.rollback().catch(() => {});
        log.error('createSubParameterForPathology:', err.message);
        throw err;
    } finally {
        conn.release();
    }
};

const getSubParameterDetail = async (isItEdit = false, subParameterId = null) => {
    let query = `
        SELECT sp.Id AS SubParameterId, sp.SubParameterName, sp.Unit, sp.Header,
               sr.AgeMin, sr.AgeMax, sr.MinVal, sr.MaxVal, sr.Gender, sr.AgeUnit
        FROM TestSubParametersForPathology sp
        LEFT JOIN SubParameterRanges sr ON sp.Id = sr.SubParameterId
    `;
    const params = [];
    if (isItEdit && subParameterId) { query += ' WHERE sp.Id = ?'; params.push(subParameterId); }
    const [rows] = await db().query(query, params);
    return rows || [];
};

const updateSubParameter = async (dataObject, subParameterId) => {
    const sp = readSubParameter(dataObject);
    const id = idOrNull(subParameterId);
    if (!id) throw userError('Sub parameter not found.');
    const conn = await getConn();
    try {
        await conn.beginTransaction();
        const [u] = await conn.execute(
            'UPDATE TestSubParametersForPathology SET SubParameterName=?, Unit=?, Header=? WHERE Id=?',
            [sp.name, sp.unit, sp.header, id]
        );
        if (!u.affectedRows) throw userError('Sub parameter not found.');
        subParameterId = id;
        await conn.execute('DELETE FROM SubParameterRanges WHERE SubParameterId=?', [subParameterId]);
        await changeSubParameterRanges(conn, dataObject, subParameterId);
        await conn.commit();
    } catch (err) {
        await conn.rollback().catch(() => {});
        log.error('updateSubParameter:', err.message);
        throw err;
    } finally {
        conn.release();
    }
};

const getAttachedSubParameterLists = async (testId) => {
    const [rows] = await db().execute(`
        SELECT * FROM PathoTestLinkedWithParameters
        JOIN TestSubParametersForPathology ON PathoTestLinkedWithParameters.SubParameterId = TestSubParametersForPathology.Id
        JOIN MainTestTable ON MainTestTable.Id = PathoTestLinkedWithParameters.TestId
        WHERE PathoTestLinkedWithParameters.TestId = ?
    `, [testId]);
    return rows || [];
};

const getUnAttachedSubParameterLists = async (testId) => {
    const [rows] = await db().execute(`
        SELECT * FROM TestSubParametersForPathology
        WHERE Id NOT IN (SELECT SubParameterId FROM PathoTestLinkedWithParameters WHERE TestId = ?)
    `, [testId]);
    return rows || [];
};

const attachSubParameterToTest = async (testId, subParameter, userId) => {
    const tid = idOrNull(testId);
    const ids = [...new Set(asArray(subParameter).map(idOrNull).filter(Boolean))];   // single checkbox arrives as a string
    if (!tid)        throw userError('Test not found.');
    if (!ids.length) throw userError('Select at least one sub parameter to attach.');
    // ★ only real sub-parameters, never twice (refresh after POST used to insert the same rows again)
    const [real] = await db().query('SELECT Id FROM TestSubParametersForPathology WHERE Id IN (?)', [ids]);
    const [have] = await db().query('SELECT SubParameterId FROM PathoTestLinkedWithParameters WHERE TestId = ? AND SubParameterId IN (?)', [tid, ids]);
    const already = new Set(have.map(r => Number(r.SubParameterId)));
    const toAdd = real.map(r => Number(r.Id)).filter(id => !already.has(id));
    if (!toAdd.length) return;
    await db().query(
        'INSERT INTO PathoTestLinkedWithParameters (TestId, SubParameterId, LinkedBy) VALUES ?',
        [toAdd.map(p => [tid, p, userId])]
    );
};

const detachSubParameterFromTest = async (testId, subParameterId) => {
    await db().execute(
        'DELETE FROM PathoTestLinkedWithParameters WHERE TestId = ? AND SubParameterId = ?',
        [testId, subParameterId]
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
    // helpers used by controller / views
    categoryBucket,
    isImagingBucket,
    isPathologyBucket,
    userError,

    registerTest,
    updateTest,
    getTestDetails,
    getSearchedTestDetails,
    getPatientTestDetails,
    makeTestActive,
    makeTestInActive,
    getSubTestDetails,
    getTestCategories,
    getAttachedTestlist,
    getAllUnattachedTestList,
    getSelectedTestDetail,
    attachSubTestToTest,
    CreateSubTest,
    getSubTestList,
    detachSubTest,
    getSubTestDetail,
    updateSubTest,
    getPatientSubTestDetail,
    searchTestForUpdatingThanks,
    createSubParameterForPathology,
    getSubParameterDetail,
    updateSubParameter,
    getAttachedSubParameterLists,
    getUnAttachedSubParameterLists,
    getTestData,
    attachSubParameterToTest,
    detachSubParameterFromTest,
    getIndividualTestDetails,
    getFilmType,
    getSubTestMap,
    readSubTestForm,
    getSubTestDoctorRules,
    getDoctorSubTestRates,
    saveDoctorSubTestRates,
    getDoctorSubTestDiscounts,
    getTestById,
    getAllCategories,
    getAllFilmTypes,
    getCategoryById,
    getTestSpecimenRequirement,
    getAllDoctorCommissionRateBasedOnCategory,
};
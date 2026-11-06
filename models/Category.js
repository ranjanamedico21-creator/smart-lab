'use strict';

/**
 * Category.js — test categories (MRI, CT, Pathology …) and document categories.
 *
 * FIXES OVER THE OLD VERSION
 *  1. updateCategory CAUGHT its own errors and returned { success:false } → the controller showed
 *     "[object Object]" as a SUCCESS message. Errors are thrown now.
 *  2. Renaming a category to a name that already exists was allowed → two "CT SCAN" categories.
 *  3. Duplicate check compared raw text: "CT  Scan" (two spaces) or " ct scan" got through.
 *     Names are trimmed, spaces collapsed, upper-cased, then compared.
 *  4. Default thanks was not validated: "abc" / "" / 500 went to the database (SQL error or nonsense %).
 *  5. getCategoryList used JOIN Users → a category created by a deleted user disappeared from every
 *     page that lists categories (patient list filters, doctor form …). Now LEFT JOIN.
 *  6. CreatedOn used MySQL NOW() (server clock may be UTC → wrong date/time). Node time (IST) now.
 *  7. module.exports was assigned twice; dead createCategoryols removed.
 *
 * NEW
 *  - Default thanks can be changed later, optionally applied to every doctor (re-prices their tests
 *    of this category in one transaction).
 *  - getCategoryStats: tests / doctors per category for the list page.
 *  - getCategoryDefaults: default thanks used to pre-fill the Register Doctor form.
 *
 * SECURITY PATCH (2026-10-25):
 *  - Renaming a category could silently change how ALL its tests behave: SmartLab decides
 *    pathology / USG / CT / MRI from the category NAME (Test.categoryBucket). "PATHOLOGY" → "LAB"
 *    turned every blood test into a non-pathology test (no specimen, template required).
 *    A rename that changes the type is now refused.
 *  - "Apply to every doctor" overwrote every doctor's own % AND every negotiated ₹ per test of the
 *    category in one click. Only an admin may do it now, and doctor-specific test amounts that were
 *    not the old default are kept (only amounts that came from the old % are re-calculated).
 */

const dbConnection = require('../config/DBConnection');
const moment       = require('moment');

const db      = () => (dbConnection.pool || dbConnection.connection).promise();
const getConn = () => db().getConnection();
const nowStr  = () => moment().format('YYYY-MM-DD HH:mm:ss');
const userError = (msg, field) => { const e = new Error(msg); e.isUserError = true; if (field) e.field = field; return e; };

const NAME_MAX = 50;
/** SQL: the stored name normalized the same way (old rows may have double spaces / lower case). */
const NAME_SQL = "UPPER(TRIM(REPLACE(REPLACE(REPLACE(Name, '   ', ' '), '  ', ' '), '  ', ' ')))";
const NAME_RE  = /^[A-Z0-9][A-Z0-9 &()\/.,+'-]*$/;

/**
 * Which optional columns the Category table has (CommissionRate = default thanks, CreatedOn, CreatedBy).
 * Older databases may not have CommissionRate — then the default % is only given to the doctors
 * and not stored on the category. Cached once found.
 */
let colCache = null;
const categoryColumns = async () => {
    if (colCache) return colCache;
    const [rows] = await db().query(`SELECT COLUMN_NAME AS c FROM INFORMATION_SCHEMA.COLUMNS
                                     WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'category'`);
    const has = (n) => rows.some(r => String(r.c).toLowerCase() === n.toLowerCase());
    colCache = { rate: has('CommissionRate'), createdOn: has('CreatedOn'), createdBy: has('CreatedBy') };
    return colCache;
};

/** "  ct   scan " → "CT SCAN" */
const normalizeName = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().toUpperCase();

/**
 * Reads + checks the category form. Returns { name, thanks, errors: { field: msg } }.
 * requireThanks: create page (true) / edit page (only if a value was sent).
 */
const readCategoryForm = (body = {}, { requireThanks = true } = {}) => {
    const errors = {};
    const name = normalizeName(body.category);
    if (!name)                       errors.category = 'Enter the category name.';
    else if (name.length > NAME_MAX) errors.category = `Category name is too long (max ${NAME_MAX} characters).`;
    else if (!NAME_RE.test(name))    errors.category = 'Use letters, numbers, spaces and & ( ) / . , + - only.';

    const raw = String(body.thanks == null ? '' : body.thanks).trim().replace('%', '');
    let thanks = null;
    if (raw === '') { if (requireThanks) errors.thanks = 'Enter the default thanks % (0 if none).'; }
    else {
        thanks = Number(raw);
        if (!Number.isFinite(thanks) || thanks < 0 || thanks > 100) { errors.thanks = 'Default thanks must be a number from 0 to 100.'; thanks = null; }
        else thanks = Math.round(thanks * 100) / 100;
    }
    return { name, thanks, errors };
};

/** Old API kept: returns [{ msg }]. */
const validateUserInput = (req) => Object.values(readCategoryForm(req.body || {}, { requireThanks: false }).errors).map(msg => ({ msg }));

/**
 * Existing category with the same (normalized) name, or null.
 * excludeId → the category being edited.
 */
const findCategory = async (categoryName, tableName = 'Category', excludeId = null) => {
    const allowed = ['DocumentCategory', 'Category'];
    if (!allowed.includes(tableName)) throw new Error('Invalid table name.');
    const name = normalizeName(categoryName);
    let sql = `SELECT * FROM ?? WHERE ${NAME_SQL} = ?`;
    const params = [tableName, name];
    if (excludeId) { sql += ' AND Id <> ?'; params.push(excludeId); }
    const [rows] = await db().query(sql + ' LIMIT 1', params);
    return rows.length ? rows : null;
};

/** Number of doctors (each new category gets a thanks row for every doctor). */
const getDoctorCount = async () => {
    const [[r]] = await db().query('SELECT COUNT(*) AS n FROM DoctorDetails');
    return Number(r.n) || 0;
};

/**
 * Creates the category and gives every existing doctor the default thanks % for it.
 * → { id, message }
 */
const createCategory = async (req) => {
    if (!req.user || !req.user.Id) throw userError('Please log in again.');
    const form = readCategoryForm(req.body || {});
    const first = Object.values(form.errors)[0];
    if (first) throw userError(first);

    const conn = await getConn();
    try {
        await conn.beginTransaction();
        // duplicate check inside the transaction; FOR UPDATE makes a double click wait for the first insert
        const [dup] = await conn.query(`SELECT Id FROM Category WHERE ${NAME_SQL} = ? LIMIT 1 FOR UPDATE`, [form.name]);
        if (dup.length) throw userError(`Category "${form.name}" already exists.`, 'category');

        const ts = nowStr();
        const cols = await categoryColumns();
        const row = { Name: form.name };
        if (cols.createdOn) row.CreatedOn = ts;
        if (cols.createdBy) row.CreatedBy = req.user.Id;
        if (cols.rate)      row.CommissionRate = form.thanks;
        const [ins] = await conn.query('INSERT INTO Category SET ?', [row]);
        const [doc] = await conn.query(`
            INSERT INTO DoctorCategoryCommission (DoctorId, CategoryId, CommissionRate, CreatedAt, UpdatedAt, CreatedBy)
            SELECT Id, ?, ?, ?, ?, ? FROM DoctorDetails`, [ins.insertId, form.thanks, ts, ts, req.user.Id]);
        await conn.commit();
        const n = doc.affectedRows || 0;
        return {
            id: ins.insertId,
            message: `Category "${form.name}" created. Default thanks ${form.thanks}% set for ${n} doctor${n === 1 ? '' : 's'}. Add tests to it from the Test page.`,
        };
    } catch (e) {
        await conn.rollback().catch(() => {});
        throw e;
    } finally {
        conn.release();
    }
};

/**
 * Rename and / or change the default thanks.
 * opts.thanks         → new default % (null = keep)
 * opts.applyToDoctors → also set that % for EVERY doctor and re-calculate their tests of this category
 * Throws on error (old version returned an object).
 */
const updateCategory = async (categoryName, categoryId, opts = {}) => {
    const id = parseInt(categoryId, 10);
    if (!Number.isInteger(id) || id <= 0) throw userError('Category not found.');
    const form = readCategoryForm({ category: categoryName, thanks: opts.thanks }, { requireThanks: !!opts.applyToDoctors });
    const first = Object.values(form.errors)[0];
    if (first) throw userError(first);

    const conn = await getConn();
    try {
        await conn.beginTransaction();
        const cols = await categoryColumns();
        const [[cur]] = await conn.query('SELECT * FROM Category WHERE Id = ? FOR UPDATE', [id]);
        if (!cur) throw userError('Category not found. It may have been deleted.');
        const [dup] = await conn.query(`SELECT Id FROM Category WHERE ${NAME_SQL} = ? AND Id <> ? LIMIT 1`, [form.name, id]);
        if (dup.length) throw userError(`Another category is already named "${form.name}".`, 'category');

        // the category TYPE comes from its name — a rename must not turn e.g. pathology into "other"
        const { categoryBucket } = require('./Test');          // lazy: avoids a circular require at start-up
        const oldType = categoryBucket(cur.Name), newType = categoryBucket(form.name);
        if (normalizeName(cur.Name) !== form.name && oldType !== newType) {
            throw userError(`Renaming "${cur.Name}" to "${form.name}" would change how all its tests work ` +
                            `(type "${oldType}" → "${newType}"). Keep a word like ${oldType === 'other' ? 'the current name' : `"${oldType.toUpperCase()}"`} in the name.`, 'category');
        }

        if (opts.applyToDoctors && form.thanks != null) {
            const [[me]] = await conn.query('SELECT IsItAdmin FROM Users WHERE Id = ? LIMIT 1', [opts.userId || 0]);
            if (!me || Number(me.IsItAdmin) !== 1) throw userError('Only an administrator can apply the default thanks to every doctor.');
        }

        const parts = [];
        if (normalizeName(cur.Name) !== form.name) parts.push(`renamed to "${form.name}"`);
        const sets = ['Name = ?'], params = [form.name];
        if (cols.rate && form.thanks != null && Number(cur.CommissionRate) !== form.thanks) {
            sets.push('CommissionRate = ?'); params.push(form.thanks);
            parts.push(`default thanks ${cur.CommissionRate == null ? '—' : Number(cur.CommissionRate) + '%'} → ${form.thanks}%`);
        }
        await conn.query(`UPDATE Category SET ${sets.join(', ')} WHERE Id = ?`, [...params, id]);

        if (opts.applyToDoctors && form.thanks != null) {
            const ts = nowStr();
            // Test amounts that a doctor got from his OLD % are re-calculated; amounts typed by hand for a
            // doctor + test (not equal to price × old %) are negotiated deals and are kept.
            const [t] = await conn.query(`
                UPDATE DoctorTestCommission dtc
                JOIN MainTestTable mt ON mt.Id = dtc.TestId
                JOIN DoctorCategoryCommission dcc ON dcc.DoctorId = dtc.DoctorId AND dcc.CategoryId = mt.CategoryId
                SET dtc.Commission = ROUND(mt.Price * ? / 100, 2)
                WHERE mt.CategoryId = ? AND ABS(dtc.Commission - ROUND(mt.Price * dcc.CommissionRate / 100, 2)) < 0.02`, [form.thanks, id]);
            const [[kept]] = await conn.query(`
                SELECT COUNT(*) AS n FROM DoctorTestCommission dtc
                JOIN MainTestTable mt ON mt.Id = dtc.TestId
                WHERE mt.CategoryId = ? AND ABS(dtc.Commission - ROUND(mt.Price * ? / 100, 2)) >= 0.02`, [id, form.thanks]);
            const [u] = await conn.query('UPDATE DoctorCategoryCommission SET CommissionRate = ?, UpdatedAt = ? WHERE CategoryId = ?', [form.thanks, ts, id]);
            const [add] = await conn.query(`
                INSERT INTO DoctorCategoryCommission (DoctorId, CategoryId, CommissionRate, CreatedAt, UpdatedAt, CreatedBy)
                SELECT d.Id, ?, ?, ?, ?, ? FROM DoctorDetails d
                WHERE NOT EXISTS (SELECT 1 FROM DoctorCategoryCommission c WHERE c.DoctorId = d.Id AND c.CategoryId = ?)`,
                [id, form.thanks, ts, ts, opts.userId || null, id]);
            const [tAdd] = await conn.query(`
                INSERT INTO DoctorTestCommission (DoctorId, TestId, Commission)
                SELECT d.Id, mt.Id, ROUND(mt.Price * ? / 100, 2) FROM DoctorDetails d JOIN MainTestTable mt ON mt.CategoryId = ?
                WHERE NOT EXISTS (SELECT 1 FROM DoctorTestCommission x WHERE x.DoctorId = d.Id AND x.TestId = mt.Id)`, [form.thanks, id]);
            const docs = (u.affectedRows || 0) + (add.affectedRows || 0);
            parts.push(`${form.thanks}% applied to ${docs} doctor${docs === 1 ? '' : 's'} (${(t.affectedRows || 0) + (tAdd.affectedRows || 0)} test thanks re-calculated` +
                       (Number(kept.n) ? `; ${kept.n} doctor-specific test amount${Number(kept.n) === 1 ? '' : 's'} kept — change them on the doctor's thanks page` : '') + ')');
        }
        await conn.commit();
        return parts.length ? `Category ${parts.join('; ')}.` : 'No changes — the category is the same as before.';
    } catch (e) {
        await conn.rollback().catch(() => {});
        throw e;
    } finally {
        conn.release();
    }
};

/** Category list with who created it (same shape as before, LEFT JOIN so nothing disappears). */
const getCategoryList = async () => {
    const [rows] = await db().query(`
        SELECT Category.*, Users.FirstName, Users.LastName,
               DATE_FORMAT(Category.CreatedOn, '%d-%m-%Y %H:%i:%s') AS CreatedOn
        FROM Category LEFT JOIN Users ON Users.Id = Category.CreatedBy
        ORDER BY Category.Id DESC`);
    return rows || [];
};

/** { categoryId: { tests, activeTests, doctors, minRate, maxRate } } for the list page. */
const getCategoryStats = async () => {
    const [[tests], [docs]] = await Promise.all([
        db().query('SELECT CategoryId, COUNT(*) AS n FROM MainTestTable GROUP BY CategoryId'),
        db().query(`SELECT CategoryId, COUNT(DISTINCT DoctorId) AS n, MIN(CommissionRate) AS mn, MAX(CommissionRate) AS mx
                    FROM DoctorCategoryCommission GROUP BY CategoryId`),
    ]);
    const out = {};
    const get = (id) => (out[id] = out[id] || { tests: 0, doctors: 0, minRate: null, maxRate: null });
    tests.forEach(r => { get(r.CategoryId).tests = Number(r.n) || 0; });
    docs.forEach(r => Object.assign(get(r.CategoryId), { doctors: Number(r.n) || 0, minRate: r.mn == null ? null : Number(r.mn), maxRate: r.mx == null ? null : Number(r.mx) }));
    return out;
};

/** { 'c<id>': default % } — pre-fills the thanks step of Register Doctor. */
const getCategoryDefaults = async () => {
    if (!(await categoryColumns()).rate) return {};
    const [rows] = await db().query('SELECT Id, CommissionRate FROM Category');
    const out = {};
    rows.forEach(r => { if (r.CommissionRate != null) out['c' + r.Id] = String(Number(r.CommissionRate)); });
    return out;
};

const getCategoryById = async (categoryId) => {
    const [rows] = await db().query('SELECT * FROM Category WHERE Id = ?', [categoryId]);
    return rows[0];
};

// ── document categories (clinic documents: registrations, renewals …) ──────────

const createDocumentCategory = async (req) => {
    if (!req.user || !req.user.Id) throw userError('Please log in again.');
    const name = String(req.body.category || '').replace(/\s+/g, ' ').trim();
    if (!name) throw userError('Enter the document category name.');
    if (name.length > NAME_MAX) throw userError(`Name is too long (max ${NAME_MAX} characters).`);
    if (await findCategory(name, 'DocumentCategory')) throw userError(`Document category "${name}" already exists.`);
    const [r] = await db().query('INSERT INTO DocumentCategory SET ?', [{ Name: name, CreatedOn: nowStr(), CreatedBy: req.user.Id }]);
    if (!r.affectedRows) throw new Error('Document category creation failed.');
    return `Document category "${name}" created.`;
};

const getDocumentCategoryList = async () => {
    const [rows] = await db().query(`
        SELECT DocumentCategory.*, Users.FirstName, Users.LastName,
               DATE_FORMAT(DocumentCategory.CreatedOn, '%d-%m-%Y %H:%i:%s') AS CreatedOn
        FROM DocumentCategory LEFT JOIN Users ON Users.Id = DocumentCategory.CreatedBy
        ORDER BY DocumentCategory.Id DESC`);
    return rows || [];
};

const getDocumentCategoryById = async (id) => {
    const [rows] = await db().query('SELECT * FROM DocumentCategory WHERE Id = ?', [id]);
    return rows[0];
};

const updateDocumentCategory = async (documentCategoryName, documentCategoryId) => {
    const name = String(documentCategoryName || '').replace(/\s+/g, ' ').trim();
    if (!name) throw userError('Document category name is missing.');
    if (name.length > NAME_MAX) throw userError(`Name is too long (max ${NAME_MAX} characters).`);
    if (await findCategory(name, 'DocumentCategory', documentCategoryId)) throw userError(`Another document category is already named "${name}".`);
    const [r] = await db().query('UPDATE DocumentCategory SET Name = ? WHERE Id = ?', [name, documentCategoryId]);
    if (!r.affectedRows) throw userError('Document category not found.');
    return 'Document category updated.';
};

module.exports = {
    categoryColumns, normalizeName, readCategoryForm, validateUserInput, findCategory, getDoctorCount,
    createCategory, updateCategory, getCategoryList, getCategoryStats, getCategoryDefaults, getCategoryById,
    createDocumentCategory, getDocumentCategoryList, getDocumentCategoryById, updateDocumentCategory,
};
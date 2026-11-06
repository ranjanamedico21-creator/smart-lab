'use strict';

/**
 * CategoryController.js — test categories + document categories.
 *
 * FIXES OVER THE OLD VERSION
 *  - createCategory: on a validation error it rendered the page but did NOT return → the code went on,
 *    rendered a second time → "Cannot set headers after they are sent" (server error in the log,
 *    sometimes a crash). Same in createDocumentCategory.
 *  - Saving rendered the list as the reply to the POST → Refresh re-sent the form →
 *    "category already exists" error. Now save → redirect (flash message) → list.
 *  - Errors were stored with req.flash and then the page was rendered (message shown on some LATER page),
 *    or flashed under the wrong key ("message") with error.msg (undefined).
 *  - getEditCategoryPage / getDocumentCategoryList used an undeclared `notifications` in catch →
 *    ReferenceError inside the catch → the request never answered (page kept loading).
 *    Opening /category/editCategory/<wrong id> hung for that reason (categoryDetails.length on undefined).
 *  - updateCategory showed the model's { success:false } object as a GREEN success message.
 *  - Error objects were shown as "[object Object]"; user mistakes and server errors were mixed.
 *  - console.log of the whole category list on every page load removed.
 */

const Category = require('../models/Category');
require('dotenv').config();

const LIST_URL     = '/category/getCategoryListView';
const DOC_LIST_URL = '/category/getDocumentCategoryList';
const ICONS = { success: 'bi-check-circle-fill', danger: 'bi-exclamation-triangle-fill', warning: 'bi-exclamation-triangle-fill', info: 'bi-info-circle-fill' };

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
    return (Array.isArray(m) ? m : [m]).filter(n => n && n.type).map(n => createNotification(n.type, n.messages, n.icon));
};
const page = (res, view, data, status = 200) =>
    res.status(status).render(view, { BRAND_NAME: process.env.BRAND_NAME, layout: 'loggedInLayout', ...data });
const logErr = (where, err) => { if (!err || !err.isUserError) console.error(`[CategoryController] ${where}:`, err); };
/** For unexpected errors: a plain sentence + the database's reason (staff-only app, helps fixing it). */
const serverMsg = (error, text) => text + (error && error.sqlMessage ? ` (Database said: ${error.sqlMessage})` : '');
const homeWithError = (res, error, text) => page(res, 'home', { title: 'Home', notifications: [createNotification('danger', text || error)] });

// ── Test categories ──────────────────────────────────────────────────────────

/** Names already used — the form warns while typing. */
const existingNames = async (exceptId) => (await Category.getCategoryList())
    .filter(c => String(c.Id) !== String(exceptId || '')).map(c => Category.normalizeName(c.Name));

const renderCreate = async (req, res, { values = {}, errors = {}, notifications = [], status = 200 } = {}) => {
    const [doctorCount, names] = await Promise.all([Category.getDoctorCount(), existingNames()]);
    return page(res, 'Category/createCategory', {
        title: 'Create Category', values, errors, doctorCount, existingNames: names,
        notifications: [...readFlash(req), ...notifications],
        // old variable names, in case another view uses them
        category: values.category || '', thanks: values.thanks || '',
    }, status);
};

const getCategoryRegistrationPage = async (req, res) => {
    try {
        return await renderCreate(req, res);
    } catch (error) {
        logErr('getCategoryRegistrationPage', error);
        return homeWithError(res, error, 'Could not open the Create Category page.');
    }
};

const getHomePage = (req, res) => page(res, 'home', { title: 'Home', notifications: readFlash(req) });

const createCategory = async (req, res) => {
    const values = { category: req.body.category || '', thanks: req.body.thanks || '' };
    try {
        const form = Category.readCategoryForm(req.body);
        if (!form.errors.category && await Category.findCategory(form.name, 'Category')) {
            form.errors.category = `Category "${form.name}" already exists. Use another name, or edit the existing one.`;
        }
        if (Object.keys(form.errors).length) {
            return await renderCreate(req, res, { values, errors: form.errors, status: 422 });
        }
        const { message } = await Category.createCategory(req);
        flash(req, 'success', message);
        return res.redirect(303, LIST_URL);
    } catch (error) {
        logErr('createCategory', error);
        try {
            const errors = error.isUserError && error.field ? { [error.field]: error.message } : {};
            return await renderCreate(req, res, {
                values, errors, status: error.isUserError ? 422 : 500,
                notifications: errors[error.field] ? [] : [createNotification('danger', error.isUserError ? error.message : serverMsg(error, 'The category was NOT created because of a server error.'))],
            });
        } catch (e2) { return homeWithError(res, error, 'The category was not created.'); }
    }
};

const getCategoryListView = async (req, res) => {
    try {
        const [categoryDetails, stats] = await Promise.all([Category.getCategoryList(), Category.getCategoryStats()]);
        return page(res, 'Category/categoryListView', {
            title: 'Category List View', categoryDetails, stats, notifications: readFlash(req),
        });
    } catch (error) {
        logErr('getCategoryListView', error);
        return homeWithError(res, error, 'Could not load the category list. Please try again.');
    }
};

const renderEdit = async (req, res, { categoryDetails, values, errors = {}, notifications = [], status = 200 }) => {
    const [doctorCount, stats, names] = await Promise.all([Category.getDoctorCount(), Category.getCategoryStats(), existingNames(categoryDetails.Id)]);
    return page(res, 'Category/editCategory', {
        title: 'Edit Category', categoryDetails, values, errors, doctorCount,
        stat: stats[categoryDetails.Id] || { tests: 0, doctors: 0, minRate: null, maxRate: null },
        existingNames: names, notifications: [...readFlash(req), ...notifications],
    }, status);
};

const getEditCategoryPage = async (req, res) => {
    try {
        const categoryDetails = await Category.getCategoryById(req.params.categoryId);
        if (!categoryDetails) { flash(req, 'danger', 'Category not found.'); return res.redirect(LIST_URL); }
        return await renderEdit(req, res, {
            categoryDetails,
            values: { category: categoryDetails.Name || '', thanks: categoryDetails.CommissionRate == null ? '' : String(Number(categoryDetails.CommissionRate)), applyToDoctors: false },
        });
    } catch (error) {
        logErr('getEditCategoryPage', error);
        return homeWithError(res, error, 'Could not open the Edit Category page.');
    }
};

const updateCategory = async (req, res) => {
    const categoryId = req.params.categoryId;
    const values = { category: req.body.category || '', thanks: req.body.thanks == null ? '' : String(req.body.thanks), applyToDoctors: req.body.applyToDoctors === '1' };
    let categoryDetails;
    try {
        categoryDetails = await Category.getCategoryById(categoryId);
        if (!categoryDetails) { flash(req, 'danger', 'Category not found. It may have been deleted.'); return res.redirect(LIST_URL); }

        const form = Category.readCategoryForm(req.body, { requireThanks: values.applyToDoctors });
        if (!form.errors.category && await Category.findCategory(form.name, 'Category', categoryDetails.Id)) {
            form.errors.category = `Another category is already named "${form.name}".`;
        }
        if (Object.keys(form.errors).length) return await renderEdit(req, res, { categoryDetails, values, errors: form.errors, status: 422 });

        const message = await Category.updateCategory(form.name, categoryDetails.Id, {
            thanks: form.thanks, applyToDoctors: values.applyToDoctors, userId: req.user && req.user.Id,
        });
        flash(req, message.startsWith('No changes') ? 'info' : 'success', message);
        return res.redirect(303, LIST_URL);
    } catch (error) {
        logErr('updateCategory', error);
        if (!categoryDetails) return homeWithError(res, error, 'The category was not updated.');
        try {
            const errors = error.isUserError && error.field ? { [error.field]: error.message } : {};
            return await renderEdit(req, res, {
                categoryDetails, values, errors, status: error.isUserError ? 422 : 500,
                notifications: errors[error.field] ? [] : [createNotification('danger', error.isUserError ? error.message : serverMsg(error, 'Changes were NOT saved because of a server error.'))],
            });
        } catch (e2) { return homeWithError(res, error, 'The category was not updated.'); }
    }
};

// ── Document categories ──────────────────────────────────────────────────────

const getCreateDocumentCategoryPage = (req, res) =>
    page(res, 'createDocumentCategory', { title: 'Create Document Category', notifications: readFlash(req) });

const createDocumentCategory = async (req, res) => {
    try {
        const message = await Category.createDocumentCategory(req);
        flash(req, 'success', message);
        return res.redirect(303, DOC_LIST_URL);
    } catch (error) {
        logErr('createDocumentCategory', error);
        return page(res, 'createDocumentCategory', {
            title: 'Create Document Category', category: req.body.category || '',
            notifications: [createNotification('danger', error.isUserError ? error.message : 'The document category was not created. Please try again.')],
        }, error.isUserError ? 422 : 500);
    }
};

const getDocumentCategoryList = async (req, res) => {
    try {
        const DocumentCategoryDetails = await Category.getDocumentCategoryList();
        return page(res, 'getDocumentCategoryList', { DocumentCategoryDetails, title: 'Document Category List', notifications: readFlash(req) });
    } catch (error) {
        logErr('getDocumentCategoryList', error);
        return homeWithError(res, error, 'Could not load the document categories.');
    }
};

const editDcoumentCategoryPage = async (req, res) => {
    try {
        const documentCategoryDetails = await Category.getDocumentCategoryById(req.params.documentCategoryId);
        if (!documentCategoryDetails) { flash(req, 'danger', 'Document category not found.'); return res.redirect(DOC_LIST_URL); }
        return page(res, 'editDocumentcategory', { documentCategoryDetails, title: 'Edit document category', notifications: readFlash(req) });
    } catch (error) {
        logErr('editDcoumentCategoryPage', error);
        return homeWithError(res, error, 'Could not open the document category.');
    }
};

const updateDocumentCategory = async (req, res) => {
    const id = req.params.documentCategoryId;
    try {
        const message = await Category.updateDocumentCategory(req.body.documentCategory, id);
        flash(req, 'success', message);
        return res.redirect(303, DOC_LIST_URL);
    } catch (error) {
        logErr('updateDocumentCategory', error);
        try {
            const documentCategoryDetails = await Category.getDocumentCategoryById(id);
            if (!documentCategoryDetails) { flash(req, 'danger', 'Document category not found.'); return res.redirect(DOC_LIST_URL); }
            return page(res, 'editDocumentcategory', {
                documentCategoryDetails: { ...documentCategoryDetails, Name: req.body.documentCategory || documentCategoryDetails.Name },
                title: 'Edit document category',
                notifications: [createNotification('danger', error.isUserError ? error.message : 'Changes were not saved. Please try again.')],
            }, error.isUserError ? 422 : 500);
        } catch (e2) { return homeWithError(res, error); }
    }
};

module.exports = {
    getCategoryRegistrationPage, getHomePage, createCategory, getCategoryListView,
    getCreateDocumentCategoryPage, createDocumentCategory, getDocumentCategoryList,
    getEditCategoryPage, updateCategory, editDcoumentCategoryPage, updateDocumentCategory,
    createNotification,
};
'use strict';

/**
 * functionAccessController.js — "User access" page.
 *   GET  /user/access/:userId              page (grouped functions, toggles, history)
 *   POST /user/access/:userId              save grants + revokes together (Post/Redirect/Get)
 *   GET  /user/access/:userId/grants.json  ids granted to a user (for "copy from another user")
 */

const FunctionAccess = require('../models/FunctionAccess');

const BRAND = () => process.env.BRAND_NAME;
const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const ICON = { success: 'bi-check-circle-fill', info: 'bi-info-circle-fill', warning: 'bi-exclamation-triangle-fill', danger: 'bi-exclamation-triangle-fill' };

const flash = (req, type, messages) => {
    if (typeof req.flash === 'function') req.flash('flash', { type, messages, icon: ICON[type] });
};
const takeFlash = (req) => {
    if (typeof req.flash !== 'function') return [];
    const m = req.flash('flash') || [];
    return (Array.isArray(m) ? m : [m]).filter(x => x && x.type)
        .map(x => ({ type: x.type, messages: x.messages, icon: x.icon || ICON[x.type], alertDismissible: true }));
};
const userIdParam = (req) => { const n = parseInt(req.params.userId, 10); return n > 0 ? n : null; };
const USER_LIST = '/user/getUserList';      // ← change if your user-list page has another URL

const page = asyncHandler(async (req, res) => {
    const userId = userIdParam(req);
    if (!userId) { flash(req, 'danger', 'Invalid user.'); return res.redirect(USER_LIST); }

    const auth = await FunctionAccess.canManage(req.user.Id, userId);
    if (!auth.ok) { flash(req, 'danger', auth.message); return res.redirect(USER_LIST); }

    const data = await FunctionAccess.getPageData(userId, auth.isAdmin);
    if (!data) { flash(req, 'danger', `User #${userId} not found.`); return res.redirect(USER_LIST); }

    res.set('Cache-Control', 'no-store');
    return res.render('userFunctionAccess', {
        ...data,
        actorIsAdmin: auth.isAdmin,
        notifications: takeFlash(req),
        userListUrl: USER_LIST,
        title: `Access — ${data.user.name}`,
        BRAND_NAME: BRAND(),
        layout: 'loggedInLayout',
    });
});

const save = asyncHandler(async (req, res) => {
    const userId = userIdParam(req);
    if (!userId) { flash(req, 'danger', 'Invalid user.'); return res.redirect(USER_LIST); }
    const b = req.body || {};
    const result = await FunctionAccess.save({
        userId,
        grant:  b.grant  ?? b['grant[]'],
        revoke: b.revoke ?? b['revoke[]'],
        reason: b.reason,
        expectedVersion: b.version,
        actorId: req.user.Id,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
    });
    flash(req, result.success ? (result.granted || result.revoked ? 'success' : 'info') : (result.stale ? 'warning' : 'danger'), result.message);
    return res.redirect(`/user/access/${userId}`);      // PRG: refresh never re-submits
});

const grantsJson = asyncHandler(async (req, res) => {
    const userId = userIdParam(req);
    const auth = await FunctionAccess.canManage(req.user.Id, null);
    if (!auth.ok) return res.status(403).json({ success: false, message: auth.message });
    if (!userId) return res.status(400).json({ success: false, message: 'Invalid user.' });
    res.set('Cache-Control', 'no-store');
    return res.json({ success: true, ids: await FunctionAccess.grantIds(userId) });
});

module.exports = { page, save, grantsJson };

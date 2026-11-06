'use strict';

const PatientAudit = require('../services/PatientAuditService');

/** Blocks the route unless the user is Admin or has the audit permission. key = 'view' | 'review' */
const requireAudit = (key = 'view') => async (req, res, next) => {
    try {
        if (!req.user || !req.user.Id) return res.redirect('/');
        if (await PatientAudit.userCan(req.user.Id, key)) return next();
        const msg = key === 'review' ? 'You do not have permission to review audit events.' : 'You do not have permission to open the Audit Center.';
        if (req.xhr || (req.headers.accept || '').includes('application/json')) return res.status(403).json({ success: false, message: msg });
        if (typeof req.flash === 'function') req.flash('flash', { type: 'danger', messages: msg, icon: 'bi-shield-lock-fill' });
        return res.redirect(req.get('Referer') || '/');
    } catch (e) { return next(e); }
};

/**
 * Puts res.locals.auditAlert = { high, outside, total } for users who can view the audit.
 * Use it in your nav:  <% if (locals.auditAlert && auditAlert.total) { %> badge <% } %>
 * Cheap: one cached query per minute for the whole app.
 */
const auditAlertBadge = async (req, res, next) => {
    res.locals.auditAlert = null;
    try {
        if (req.user && req.user.Id && await PatientAudit.userCan(req.user.Id, 'view')) {
            res.locals.auditAlert = await PatientAudit.getAlertCount();
        }
    } catch (_) { /* never break a page for a badge */ }
    next();
};

module.exports = { requireAudit, auditAlertBadge };

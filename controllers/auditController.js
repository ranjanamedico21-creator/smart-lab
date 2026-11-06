'use strict';

/**
 * auditController.js — Audit Center (admin / authorised users only).
 *   GET  /audit                 dashboard: tabs events | staff | receipts | outside
 *   GET  /audit/export.csv      events for current filters as CSV (Excel friendly)
 *   POST /audit/review          mark one or many events OK / explained / suspicious / fraud
 *   GET  /audit/verify/:id      JSON integrity check for one patient
 *   POST /audit/verify-range    integrity check for all patients with events in the date range
 */

const PatientAudit = require('../services/PatientAuditService');
const cfg          = require('../config/auditConfig');

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const BRAND = () => process.env.BRAND_NAME;

const flash = (req, type, message) => {
    if (typeof req.flash !== 'function') return;
    const icon = { success: 'bi-check-circle-fill', warning: 'bi-exclamation-triangle-fill', danger: 'bi-exclamation-triangle-fill', info: 'bi-info-circle-fill' }[type];
    req.flash('flash', { type, messages: Array.isArray(message) ? message.join('\n') : String(message || ''), icon });
};
const takeFlash = (req) => {
    if (typeof req.flash !== 'function') return [];
    const m = req.flash('flash') || [];
    return (Array.isArray(m) ? m : [m]).filter(x => x && x.type)
        .map(x => ({ type: x.type, messages: x.messages, icon: x.icon, alertDismissible: true }));
};

const TABS = ['events', 'staff', 'receipts', 'outside'];

const dashboard = asyncHandler(async (req, res) => {
    const f   = PatientAudit.normaliseFilters(req.query);
    const tab = TABS.includes(req.query.tab) ? req.query.tab : 'events';

    const [kpis, actors, canReview] = await Promise.all([
        PatientAudit.getKpis(f),
        PatientAudit.getActors(),
        PatientAudit.userCan(req.user.Id, 'review'),
    ]);

    let events = { rows: [], total: 0, pages: 1 }, staff = [], receipts = [], outside = [];
    if (tab === 'events')   events   = await PatientAudit.searchEvents(f);
    if (tab === 'staff')    staff    = await PatientAudit.getStaffSummary(f);
    if (tab === 'receipts') receipts = await PatientAudit.getReceiptMismatches(f);
    if (tab === 'outside')  outside  = await PatientAudit.getUnattributedChanges(f);

    res.set('Cache-Control', 'no-store');
    return res.render('Audit/auditDashboard', {
        f, tab, kpis, actors, canReview, currentUserId: req.user.Id,
        events, staff, receipts, outside,
        actions: PatientAudit.ACTIONS, verdicts: PatientAudit.VERDICTS, rules: cfg.rules, historyUrl: cfg.patientHistoryUrl,
        notifications: takeFlash(req),
        title: 'Audit Center', BRAND_NAME: BRAND(), layout: 'loggedInLayout',
    });
});

const csvCell = (v) => {
    let s = v === undefined || v === null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;                 // block Excel formula injection
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const exportCsv = asyncHandler(async (req, res) => {
    const f = PatientAudit.normaliseFilters(req.query);
    const { rows } = await PatientAudit.searchEvents(f, { all: true });
    const head = ['Event Id', 'Time', 'Bill No', 'Patient', 'Phone', 'Action', 'Done By', 'Role', 'Risk Score', 'Risk Level', 'Flags',
                  'Net Before', 'Net After', 'Cash Before', 'Cash After', 'Online Before', 'Online After', 'Dues Before', 'Dues After',
                  'Amount Impact', 'Reason', 'Review', 'Review Note', 'Reviewed By', 'IP'];
    const lines = [head.map(csvCell).join(',')];
    rows.forEach(r => lines.push([
        r.Id, r.DisplayAt, r.PatientId, `${r.Title || ''} ${r.PatientName || ''}`.trim(), r.PhoneNumber, r.ActionLabel,
        r.ActorName, r.ActorRole, r.RiskScore, r.RiskLevel, r.Flags.map(x => x.label).join(' | '),
        r.NetBefore, r.NetAfter, r.CashBefore, r.CashAfter, r.OnlineBefore, r.OnlineAfter, r.DuesBefore, r.DuesAfter,
        r.AmountImpact, r.Reason, r.Verdict ? PatientAudit.VERDICTS[r.Verdict] : 'Not reviewed', r.ReviewNote, r.ReviewedByName, r.IpAddress,
    ].map(csvCell).join(',')));
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="patient-audit_${f.from}_to_${f.to}.csv"`);
    res.set('Cache-Control', 'no-store');
    return res.send('﻿' + lines.join('\r\n'));          // BOM so Excel shows ₹ correctly
});

const safeBack = (req, fallback) => {
    const back = String(req.body.back || req.get('Referer') || '');
    return /^\/(audit|patient\/)/.test(back.replace(/^https?:\/\/[^/]+/, '')) ? back.replace(/^https?:\/\/[^/]+/, '') : fallback;
};

const review = asyncHandler(async (req, res) => {
    const ids = req.body.eventIds || req.body['eventIds[]'] || req.body.eventId;
    const result = await PatientAudit.addReview({
        eventIds: ids, verdict: String(req.body.verdict || ''), note: req.body.note, reviewerId: req.user.Id,
    });
    if (req.xhr || (req.headers.accept || '').includes('application/json')) return res.status(result.success ? 200 : 422).json(result);
    flash(req, result.success ? 'success' : 'danger', result.message);
    return res.redirect(safeBack(req, '/audit'));
});

const verifyPatient = asyncHandler(async (req, res) => {
    const id = parseInt(req.params.patientId, 10);
    if (!(id > 0)) return res.status(400).json({ ok: false, problems: ['Invalid patient id.'] });
    return res.json(await PatientAudit.verifyPatient(id));
});

const verifyRange = asyncHandler(async (req, res) => {
    const f = PatientAudit.normaliseFilters(req.body);
    const r = await PatientAudit.verifyRange(f);
    if (!r.failed.length) {
        flash(req, 'success', `Integrity OK — ${r.checked} patient audit trail(s) checked between ${f.from} and ${f.to}. No tampering found.` +
                              (r.capped ? ' (First 1500 patients only — narrow the dates to check the rest.)' : ''));
    } else {
        flash(req, 'danger', [`TAMPERING DETECTED in ${r.failed.length} of ${r.checked} patient(s):`,
            ...r.failed.slice(0, 20).map(x => `Bill ${x.patientId}: ${x.problems[0]}`)]);
    }
    return res.redirect(`/audit?from=${f.from}&to=${f.to}`);
});

module.exports = { dashboard, exportCsv, review, verifyPatient, verifyRange };

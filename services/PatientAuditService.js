'use strict';

/**
 * PatientAuditService.js — tamper-evident patient audit trail + fraud rules for SmartLab.
 *
 *  • event()            build one audit event inside the caller's transaction and save it
 *  • loadContext()      everything the risk rules need (receipt prints, room entry, edit count …)
 *  • guardEdit()        PREVENTS unauthorised bill reductions (throws nothing, returns errors)
 *  • evaluateRisk()     scores an action with the rules in config/auditConfig.js
 *  • logReceiptPrint()  records every invoice print with the amounts printed on it
 *  • verifyPatient()    re-checks the HMAC hash chain → detects edits/deletes done in the DB
 *  • dashboard queries  events, staff summary, receipt mismatches, outside-app changes
 *
 * Every event is chained per patient:  Hash = HMAC(AUDIT_HMAC_KEY, PrevHash + "\n" + Payload)
 * Someone with only database access cannot re-sign rows without the key in the server env.
 */

const crypto       = require('crypto');
const moment       = require('moment');
const dbConnection = require('../config/DBConnection');
const cfg          = require('../config/auditConfig');

const db     = () => dbConnection.pool.promise();
const num    = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const str    = (v) => (v === undefined || v === null ? '' : String(v).trim());
const rs     = (n) => '₹' + round2(n).toLocaleString('en-IN');
const EPS    = 0.5;

const LEVEL_ORDER = ['none', 'low', 'medium', 'high', 'critical'];
const ACTIONS = {
    REGISTER: 'Registered', EDIT: 'Edited', CANCEL: 'Cancelled', DUES_COLLECT: 'Dues collected',
    ARRIVED: 'Marked arrived', THANKS_SAVE: 'Thanks saved', THANKS_REMOVE: 'Thanks removed',
};

// ─────────────────────────────────────────────────────────────────────────────
// SIGNING
// ─────────────────────────────────────────────────────────────────────────────

const HMAC_KEY = process.env.AUDIT_HMAC_KEY || '';
if (!HMAC_KEY) {
    console.warn('[Audit] AUDIT_HMAC_KEY is not set — audit chain uses plain SHA-256 (detects edits, but a DB user could re-compute hashes). Set it in cPanel → Setup Node.js App.');
}
const currentAlgo = () => (HMAC_KEY ? 'hmac' : 'sha256');
const genesis = (patientId) => crypto.createHash('sha256').update(`SMARTLAB-GENESIS:${patientId}`).digest('hex');
const sign = (algo, prev, payload) => {
    const data = `${prev}\n${payload}`;
    if (algo === 'hmac') {
        if (!HMAC_KEY) return null;                 // cannot verify without key
        return crypto.createHmac('sha256', HMAC_KEY).update(data).digest('hex');
    }
    return crypto.createHash('sha256').update(data).digest('hex');
};

// ─────────────────────────────────────────────────────────────────────────────
// USERS & PERMISSIONS
// ─────────────────────────────────────────────────────────────────────────────

const isAdminUser = (u) => {
    if (!u) return false;
    if (Number(u.IsItAdmin) === 1 || Number(u.IsAdmin) === 1 || Number(u.isAdmin) === 1) return true;
    if ((cfg.adminRoleIds || []).map(Number).includes(Number(u.RoleId))) return true;
    const rn = str(u.RoleName).toLowerCase();
    return !!rn && (cfg.adminRoleNames || []).map(x => String(x).toLowerCase()).includes(rn);
};

const loadActor = async (q, userId) => {
    if (!userId) return { id: null, name: 'System', role: '', isAdmin: false, active: true };
    let rows;
    try {
        [rows] = await q.query(`SELECT u.*, r.Name AS RoleName FROM Users u LEFT JOIN Roles r ON r.Id = u.RoleId WHERE u.Id = ? LIMIT 1`, [userId]);
    } catch (e) {                                   // Roles table missing / named differently
        if (e.code !== 'ER_NO_SUCH_TABLE' && e.code !== 'ER_BAD_FIELD_ERROR') throw e;
        [rows] = await q.query('SELECT u.* FROM Users u WHERE u.Id = ? LIMIT 1', [userId]);
    }
    const u = rows[0];
    if (!u) return { id: userId, name: `User #${userId}`, role: '', isAdmin: false, active: false };
    return {
        id: u.Id,
        name: `${str(u.FirstName)} ${str(u.LastName)}`.trim() || u.Email || `User #${u.Id}`,
        role: str(u.RoleName),
        isAdmin: isAdminUser(u),
        active: u.Status === undefined || u.Status === null || Number(u.Status) === 1,
    };
};

/** Admin or "Change bill after test done" permission (fresh check, no cache). */
const canEditLockedBill = (q, userId) => hasPermission(q || db(), userId, 'editLockedBill');

/** key = 'view' | 'review' | 'editLockedBill' (see auditConfig.permissions) */
const hasPermission = async (q, userId, key) => {
    if (!userId) return false;
    const actor = await loadActor(q, userId);
    if (!actor.active) return false;
    if (actor.isAdmin) return true;
    const slugs = cfg.permissions[key] || [];
    if (!slugs.length) return false;
    return require('../models/User').userHasAnyFunction(userId, slugs);   // roles + deny honoured
};

// 60-second cache for page/menu checks (not used for money decisions)
const permCache = new Map();
const userCan = async (userId, key) => {
    const k = `${userId}:${key}`;
    const hit = permCache.get(k);
    if (hit && hit.exp > Date.now()) return hit.val;
    const val = await hasPermission(db(), userId, key).catch(() => false);
    permCache.set(k, { val, exp: Date.now() + cfg.alertCacheSeconds * 1000 });
    return val;
};

/** Forget cached permission answers (called after permissions are changed). */
const clearPermCache = (userId) => {
    if (userId == null) return permCache.clear();
    for (const k of [...permCache.keys()]) if (k.startsWith(`${userId}:`)) permCache.delete(k);
};

// ─────────────────────────────────────────────────────────────────────────────
// MONEY SNAPSHOTS
// ─────────────────────────────────────────────────────────────────────────────

const money = ({ gross = 0, discount = 0, net = 0, cash = 0, change = 0, online = 0, dues = 0 } = {}) => ({
    gross: round2(gross), discount: round2(discount), net: round2(net),
    cash: round2(cash), change: round2(change), cashKept: round2(num(cash) - num(change)),
    online: round2(online), dues: round2(dues),
});

const moneyFromRow = (p) => money({
    gross: num(p.GrossAmount), discount: num(p.Discount), net: num(p.ActualAmount),
    cash: num(p.CashPayment), change: num(p.ChangeToReturn), online: num(p.OnlinePayment), dues: num(p.DuesAmount),
});

// ─────────────────────────────────────────────────────────────────────────────
// CONTEXT for rules
// ─────────────────────────────────────────────────────────────────────────────

const parseRegisteredAt = (regDate, regTime) => {
    if (!regDate) return null;
    const m = moment(`${regDate} ${str(regTime)}`, ['YYYY-MM-DD hh:mm:ss A', 'YYYY-MM-DD h:mm:ss A', 'YYYY-MM-DD HH:mm:ss', 'YYYY-MM-DD HH:mm'], true);
    return m.isValid() ? m : moment(regDate, 'YYYY-MM-DD').startOf('day');
};

/** Test-level state: entered room / done / reported / delivered. Works with any query object. */
const loadTestStates = async (q, patientId) => {
    const [rows] = await q.query(`
        SELECT ptr.Id AS RefId, ptr.TestId, m.TestName, m.Price, ptr.TestStatus, ptr.ReportReady,
               qq.EntryTime, qq.ExitTime,
               (SELECT MAX(td.IsGenerated) FROM TestDeliverables td WHERE td.PatientTestReferenceId = ptr.Id) AS IsGen,
               (SELECT MAX(td.IsDelivered) FROM TestDeliverables td WHERE td.PatientTestReferenceId = ptr.Id) AS IsDel
        FROM PatientTestRefference ptr
        JOIN MainTestTable m ON m.Id = ptr.TestId
        LEFT JOIN (
            SELECT PatientTestId, MAX(EntryTime) AS EntryTime, MAX(ExitTime) AS ExitTime
            FROM PatientQueue WHERE PatientId = ? GROUP BY PatientTestId
        ) qq ON qq.PatientTestId = ptr.Id
        WHERE ptr.PatientId = ?`, [patientId, patientId]);
    return rows.map(r => {
        const started = !!r.EntryTime || ['InProgress', 'Completed'].includes(r.TestStatus) || Number(r.ReportReady) === 1 || Number(r.IsGen) === 1;
        const done    = !!r.ExitTime  || r.TestStatus === 'Completed' || Number(r.ReportReady) === 1;
        return { refId: r.RefId, testId: r.TestId, name: r.TestName, price: round2(r.Price),
                 started, done, reported: Number(r.ReportReady) === 1, delivered: Number(r.IsDel) === 1 };
    });
};

const anyTestStarted = async (q, patientId) => (await loadTestStates(q, patientId)).some(t => t.started);

const loadContext = async (q, patientId) => {
    const [[p]] = await q.query(`
        SELECT Id, Status, RegisteredBy, DoctorId, ThanksGivenTo, ThanksAmount, BookingStatus,
               DATE_FORMAT(RegisteredOn, '%Y-%m-%d') AS RegDate, RegisteredTime
        FROM PatientDetails WHERE Id = ? LIMIT 1`, [patientId]);
    if (!p) return null;

    const [[[rc]], [[lastPrint]], [[edits]], tests] = await Promise.all([
        q.query('SELECT COUNT(*) AS c, MAX(NetAmount) AS maxNet, MAX(PaidAmount) AS maxPaid FROM PatientReceiptPrint WHERE PatientId = ?', [patientId]),
        q.query(`SELECT PrintNo, NetAmount, PaidAmount, TestSignature, DATE_FORMAT(PrintedAt, '%d-%m-%Y %h:%i %p') AS At
                 FROM PatientReceiptPrint WHERE PatientId = ? ORDER BY PrintNo DESC LIMIT 1`, [patientId]),
        q.query(`SELECT COUNT(DISTINCT EventGroup) AS c FROM PatientAuditLog WHERE PatientId = ? AND EventGroup LIKE 'edit\\_%'`, [patientId]),
        loadTestStates(q, patientId),
    ]);

    const regAt  = parseRegisteredAt(p.RegDate, p.RegisteredTime);
    const now    = moment();
    return {
        patientId,
        status: Number(p.Status),
        registeredBy: p.RegisteredBy,
        regDate: p.RegDate,
        registeredAt: regAt ? regAt.format('YYYY-MM-DD HH:mm:ss') : null,
        minutesSinceReg: regAt ? Math.max(0, now.diff(regAt, 'minutes')) : null,
        crossDay: !!p.RegDate && p.RegDate !== now.format('YYYY-MM-DD'),
        thanksPaid: !!p.ThanksGivenTo && num(p.ThanksAmount) > 0,
        thanksAmount: round2(p.ThanksAmount),
        receipt: {
            count: Number(rc.c) || 0,
            maxNet: rc.maxNet == null ? null : round2(rc.maxNet),
            maxPaid: rc.maxPaid == null ? null : round2(rc.maxPaid),
            last: lastPrint ? { no: lastPrint.PrintNo, net: round2(lastPrint.NetAmount), paid: round2(lastPrint.PaidAmount), sig: lastPrint.TestSignature, at: lastPrint.At } : null,
        },
        priorEdits: Number(edits.c) || 0,
        tests,
        anyStarted:   tests.some(t => t.started),
        anyDone:      tests.some(t => t.done),
        anyReported:  tests.some(t => t.reported),
        anyDelivered: tests.some(t => t.delivered),
    };
};

// ─────────────────────────────────────────────────────────────────────────────
// PREVENTION — after a test is done, only an authorised person may change the bill
// ─────────────────────────────────────────────────────────────────────────────

const names = (list) => list.map(t => t.name || t.TestName || t.Name).join(', ');

/** Changes that lower money. */
const reductionsOf = ({ before, after, removedTests = [], removedSubs = [] }) => {
    const r = [];
    if (after.net < before.net - EPS)           r.push(`bill ${rs(before.net)} → ${rs(after.net)}`);
    if (after.cashKept < before.cashKept - EPS) r.push(`cash ${rs(before.cashKept)} → ${rs(after.cashKept)}`);
    if (after.online < before.online - EPS)     r.push(`online ${rs(before.online)} → ${rs(after.online)}`);
    if (after.discount > before.discount + EPS) r.push(`discount ${rs(before.discount)} → ${rs(after.discount)}`);
    if (removedTests.length) r.push(`removed ${names(removedTests)}`);
    if (removedSubs.length)  r.push(`removed sub-test ${names(removedSubs)}`);
    return r;
};

/** Every change to the bill (up or down): tests, amounts, payment, discount, referring doctor. */
const billChangesOf = ({ before, after, removedTests = [], removedSubs = [], addedTests = [], addedSubs = [], doctorChanged = false, testDiscountChanged = false }) => {
    const c = [];
    const diff = (k) => Math.abs(num(after[k]) - num(before[k])) > EPS;
    if (diff('net') || diff('gross'))  c.push(`bill ${rs(before.net)} → ${rs(after.net)}`);
    if (diff('discount') || testDiscountChanged) c.push(`discount ${rs(before.discount)} → ${rs(after.discount)}`);
    if (diff('cashKept')) c.push(`cash ${rs(before.cashKept)} → ${rs(after.cashKept)}`);
    if (diff('online'))   c.push(`online ${rs(before.online)} → ${rs(after.online)}`);
    if (removedTests.length) c.push(`removed ${names(removedTests)}`);
    if (addedTests.length)   c.push(`added ${names(addedTests)}`);
    if (removedSubs.length)  c.push(`removed sub-test ${names(removedSubs)}`);
    if (addedSubs.length)    c.push(`added sub-test ${names(addedSubs)}`);
    if (doctorChanged)       c.push('referring doctor changed');
    return [...new Set(c)];
};

/** Tests that make the bill "locked" for reception (see auditConfig.lockWhen). */
const lockingTests = (ctx) => (ctx.tests || []).filter(t =>
    cfg.lockWhen === 'started' ? (t.started || t.done) : (t.done || t.reported || t.delivered));

/** Same user, same day, minutes after registration, before print & room → risk is scaled down (never blocks). */
const isQuickFix = (ctx, actorId) =>
    String(ctx.registeredBy) === String(actorId) && !ctx.crossDay &&
    ctx.minutesSinceReg != null && ctx.minutesSinceReg <= cfg.quickFixMinutes &&
    ctx.receipt.count === 0 && !ctx.anyStarted;

/**
 * Call BEFORE changing anything. Returns { errors[], reductions[], billChanges[], locked, sensitive, usedPermission, quickFix }.
 * Caller throws userError(errors) when errors.length.
 */
const guardEdit = async (conn, {
    actorId, ctx, before, after, removedTests = [], removedSubs = [], addedTests = [], addedSubs = [],
    doctorChanged = false, clinicChanged = false, testDiscountChanged = false, reason = '', canEditLocked = null,
}) => {
    const reductions  = reductionsOf({ before, after, removedTests, removedSubs });
    const billChanges = billChangesOf({ before, after, removedTests, removedSubs, addedTests, addedSubs, doctorChanged, testDiscountChanged });
    const sensitive   = reductions.length > 0 || doctorChanged || clinicChanged;
    const errors      = [];
    let usedPermission = false;

    if (cfg.requireReasonForSensitiveEdit && sensitive && str(reason).length < cfg.minReasonLength) {
        const what = [...reductions, ...(doctorChanged ? ['referring doctor changed'] : []), ...(clinicChanged ? ['clinic changed'] : [])];
        errors.push(`Write the reason for this change (at least ${cfg.minReasonLength} characters). Changed: ${what.join('; ')}.`);
    }

    const locking = lockingTests(ctx);
    const scope   = cfg.lockScope === 'reductions' ? reductions : billChanges;
    const locked  = !!cfg.lockBillAfterTestDone && locking.length > 0;
    if (locked && scope.length) {
        if (canEditLocked === true || (canEditLocked == null && await hasPermission(conn, actorId, 'editLockedBill'))) usedPermission = true;
        else errors.push(
            `${names(locking)} ${locking.length > 1 ? 'are' : 'is'} already done, so the bill is locked (${scope.join('; ')}). ` +
            'Only an Admin or an authorised person ("Change bill after test" permission) can change it now. ' +
            'Name, age, phone and address can still be corrected.');
    }
    if (str(reason).length > 500) errors.push('Reason is too long (max 500 characters).');
    return { errors, reductions, billChanges, locked, sensitive, usedPermission, quickFix: isQuickFix(ctx, actorId) };
};

/** For the edit page: is this bill locked for this user? → { locked, tests[], canEdit } */
const billLockStatus = async (patientId, userId) => {
    const ctx = await loadContext(db(), patientId);
    if (!ctx || !cfg.lockBillAfterTestDone) return { locked: false, tests: [], canEdit: true };
    const locking = lockingTests(ctx);
    if (!locking.length) return { locked: false, tests: [], canEdit: true };
    return { locked: true, tests: locking.map(t => t.name), canEdit: await hasPermission(db(), userId, 'editLockedBill') };
};

// ─────────────────────────────────────────────────────────────────────────────
// RISK RULES
// ─────────────────────────────────────────────────────────────────────────────

const levelFor = (score) => (cfg.levels.find(l => score >= l.min) || { level: 'none' }).level;

const isOffHours = (m = moment()) => {
    const t = m.format('HH:mm');
    return t < cfg.businessHours.start || t > cfg.businessHours.end;
};

/**
 * data: { before, after, ctx, actorId, removedTests, removedSubs, doctorChanged, guard,
 *         refund, thanks: { amount, calculated, hadThanks } }
 */
const evaluateRisk = (action, data = {}) => {
    const flags = [];
    const flag = (code, detail = '', pointsOverride) => {
        const rule = cfg.rules[code];
        if (!rule) return;
        const points = pointsOverride ?? rule.points;
        if (!points && code !== 'PERMISSION_USED' && code !== 'IN_GRACE') return;   // rule switched off
        flags.push({ code, label: rule.label, points, detail });
    };
    const { before, after, ctx, actorId } = data;
    let impact = 0;

    if (action === 'EDIT' && before && after && ctx) {
        const netDrop   = round2(before.net - after.net);
        const cashDrop  = round2(before.cashKept - after.cashKept);
        const onlDrop   = round2(before.online - after.online);
        const paidBefore = before.cashKept + before.online, paidAfter = after.cashKept + after.online;
        const reductions = reductionsOf(data);

        if (netDrop > EPS) flag('BILL_REDUCED', `${rs(before.net)} → ${rs(after.net)} (−${rs(netDrop)})`);
        if (cashDrop > EPS && -onlDrop > EPS) {
            flag('CASH_TO_ONLINE', `cash −${rs(cashDrop)}, online +${rs(-onlDrop)}`);
            if (cashDrop - (-onlDrop) > EPS) flag('CASH_TAKEN_BACK', `−${rs(cashDrop + onlDrop)} not moved to online`);
        } else if (cashDrop > EPS) flag('CASH_TAKEN_BACK', `${rs(before.cashKept)} → ${rs(after.cashKept)}`);
        if (onlDrop > EPS && -cashDrop > EPS) flag('ONLINE_TO_CASH', `online −${rs(onlDrop)}, cash +${rs(-cashDrop)}`);
        else if (onlDrop > EPS) flag('ONLINE_REDUCED', `${rs(before.online)} → ${rs(after.online)}`);
        if (after.dues < before.dues - EPS && paidAfter <= paidBefore + EPS)
            flag('DUES_WRITTEN_OFF', `dues ${rs(before.dues)} → ${rs(after.dues)} with no new payment`);
        if (after.discount > before.discount + EPS) flag('DISCOUNT_ADDED_LATER', `${rs(before.discount)} → ${rs(after.discount)}`);

        if (reductions.length && ctx.receipt.count > 0) {
            const shown = ctx.receipt.maxNet != null ? ctx.receipt.maxNet : before.net;
            flag('AFTER_RECEIPT', `${ctx.receipt.count} receipt(s) printed, highest shows ${rs(shown)}; bill now ${rs(after.net)}`);
        }
        const removed = data.removedTests || [];
        if (removed.length) {
            const pts = Math.min(cfg.rules.TEST_REMOVED.points * removed.length, cfg.rules.TEST_REMOVED.points * 2);
            flag('TEST_REMOVED', removed.map(t => t.name).join(', '), pts);
            const started = removed.filter(t => t.started);
            if (started.length) flag('TEST_REMOVED_AFTER_START', started.map(t => t.name).join(', '));
        }
        if (reductions.length && ctx.anyDone) flag('PATIENT_ALREADY_SEEN', ctx.tests.filter(t => t.done).map(t => t.name).join(', '));
        if (reductions.length && ctx.crossDay) flag('CROSS_DAY', `registered ${moment(ctx.regDate).format('DD-MM-YYYY')}`);
        else if (reductions.length && ctx.minutesSinceReg != null && ctx.minutesSinceReg > cfg.lateEditMinutes)
            flag('LATE_EDIT', `${ctx.minutesSinceReg} min after registration`);
        if (reductions.length && String(ctx.registeredBy) !== String(actorId)) flag('OTHER_USER');
        if (data.doctorChanged) {
            flag('DOCTOR_CHANGED');
            if (ctx.thanksPaid) flag('DOCTOR_CHANGED_THANKS_PAID', `thanks ${rs(ctx.thanksAmount)} already paid`);
        }
        if (ctx.priorEdits >= cfg.repeatEditHigh)      flag('REPEAT_EDITS_HIGH', `${ctx.priorEdits + 1}th edit`);
        else if (ctx.priorEdits >= cfg.repeatEditWarn) flag('REPEAT_EDITS', `${ctx.priorEdits + 1}th edit`);
        if (data.guard && data.guard.usedPermission) flag('PERMISSION_USED');
        if (data.guard && data.guard.quickFix && reductions.length) {
            const k = Number(cfg.quickFixRiskFactor);
            flags.forEach(fl => { fl.points = Math.round(fl.points * (Number.isFinite(k) ? k : 1)); });
            flag('IN_GRACE', `${ctx.minutesSinceReg} min after registration, receipt not printed`);
        }
        impact = Math.max(0, netDrop, round2(paidBefore - paidAfter));
        if (reductions.length && isOffHours()) flag('OFF_HOURS', moment().format('hh:mm A'));
    }

    if (action === 'CANCEL' && ctx) {
        impact = round2(data.refund || 0);
        if (ctx.anyDelivered)     flag('CANCEL_AFTER_DELIVERY', ctx.tests.filter(t => t.delivered).map(t => t.name).join(', '));
        else if (ctx.anyDone || ctx.anyReported) flag('CANCEL_AFTER_TEST_DONE', ctx.tests.filter(t => t.done || t.reported).map(t => t.name).join(', '));
        else if (ctx.anyStarted)  flag('CANCEL_AFTER_TEST_DONE', 'patient had entered the room', Math.round(cfg.rules.CANCEL_AFTER_TEST_DONE.points / 2));
        if (ctx.receipt.count > 0) flag('CANCEL_AFTER_RECEIPT', `${ctx.receipt.count} receipt(s) printed`);
        if (ctx.crossDay)          flag('CANCEL_CROSS_DAY', `registered ${moment(ctx.regDate).format('DD-MM-YYYY')}`);
        if (ctx.thanksPaid)        flag('CANCEL_THANKS_PAID', `${rs(ctx.thanksAmount)} paid`);
        if (String(ctx.registeredBy) !== String(actorId)) flag('OTHER_USER');
        if (isOffHours()) flag('OFF_HOURS', moment().format('hh:mm A'));
    }

    if ((action === 'THANKS_SAVE' || action === 'THANKS_REMOVE') && data.thanks) {
        const t = data.thanks;
        if (action === 'THANKS_SAVE') {
            impact = round2(t.amount);
            if (t.calculated != null && t.amount > t.calculated + cfg.thanksTolerance)
                flag('THANKS_ABOVE_CALCULATED', `paid ${rs(t.amount)}, calculated ${rs(t.calculated)}`);
            if (t.calculated == null && t.amount > 0)
                flag('THANKS_ABOVE_CALCULATED', `paid ${rs(t.amount)}, no commission calculated for this doctor`, Math.round(cfg.rules.THANKS_ABOVE_CALCULATED.points / 2));
            if (t.hadThanks) flag('THANKS_CHANGED', t.detail || '');
        } else {
            flag('THANKS_REMOVED', t.detail || '');
        }
        if (isOffHours()) flag('OFF_HOURS', moment().format('hh:mm A'));
    }

    if (action === 'REGISTER' && after) {
        impact = round2(after.discount);
        const pct = after.gross > 0 ? (after.discount / after.gross) * 100 : 0;
        if (pct >= cfg.veryHighDiscountPct)  flag('VERY_HIGH_DISCOUNT', `${pct.toFixed(0)}% (${rs(after.discount)})`);
        else if (pct >= cfg.highDiscountPct) flag('HIGH_DISCOUNT', `${pct.toFixed(0)}% (${rs(after.discount)})`);
    }

    if (impact >= cfg.largeAmount && flags.some(f => f.points > 0)) flag('LARGE_AMOUNT', rs(impact));

    const score = Math.min(999, flags.reduce((a, f) => a + f.points, 0));
    return { score, level: levelFor(score), flags, impact: round2(impact) };
};

// ─────────────────────────────────────────────────────────────────────────────
// EVENT BUILDER
// ─────────────────────────────────────────────────────────────────────────────

class AuditEvent {
    constructor(conn, { patientId, action, actorId = null, ip = null, userAgent = null, reason = '', authorisedAs = null }) {
        if (!ACTIONS[action]) throw new Error(`Unknown audit action ${action}`);
        this.conn = conn;
        this.patientId = Number(patientId);
        this.action = action;
        this.actorId = actorId || null;
        this.ip = ip ? String(ip).slice(0, 64) : null;
        this.userAgent = userAgent ? String(userAgent).slice(0, 255) : null;
        this.reason = str(reason).slice(0, 500);
        this.authorisedAs = authorisedAs ? String(authorisedAs).slice(0, 64) : null;
        this.changes = [];
        this.before = null;
        this.after = null;
        this.risk = { score: 0, level: 'none', flags: [], impact: 0 };
        this.extra = {};
    }

    /** Records a field change only if the value really changed. */
    change(category, label, field, oldVal, newVal) {
        const o = oldVal === undefined || oldVal === null ? '' : String(oldVal);
        const n = newVal === undefined || newVal === null ? '' : String(newVal);
        if (o === n) return this;
        return this.add(category, label, field, o || '—', n || '—');
    }
    /** Always records (used for added/removed items). */
    add(category, label, field, oldDisplay, newDisplay) {
        this.changes.push({
            category: String(category).slice(0, 20), label: String(label).slice(0, 100), field: String(field).slice(0, 64),
            old: String(oldDisplay ?? '—').slice(0, 500), new: String(newDisplay ?? '—').slice(0, 500),
        });
        return this;
    }
    testAdded(name, price)      { return this.add('tests', 'Test Added', 'TestAdded', '—', price != null ? `${name} (${rs(price)})` : name); }
    testRemoved(name, price, note = '') {
        return this.add('tests', 'Test Removed', 'TestRemoved', `${price != null ? `${name} (${rs(price)})` : name}${note ? ` [${note}]` : ''}`, '—');
    }
    subTestAdded(name, price)   { return this.add('tests', 'Sub-test Added', 'SubTestAdded', '—', price != null ? `${name} (${rs(price)})` : name); }
    subTestRemoved(name, price) { return this.add('tests', 'Sub-test Removed', 'SubTestRemoved', price != null ? `${name} (${rs(price)})` : name, '—'); }

    setMoney(before, after) { this.before = before || null; this.after = after || null; return this; }
    setRisk(risk)  { if (risk) this.risk = risk; return this; }
    setExtra(obj)  { Object.assign(this.extra, obj || {}); return this; }
    get changeCount() { return this.changes.length; }

    /** Writes event + detail rows + chain head. Must run inside the caller's open transaction. */
    async save() {
        const conn  = this.conn;
        const actor = await loadActor(conn, this.actorId);

        // Lock the chain head for this patient (record lock only — no gap-lock deadlocks)
        await conn.query('INSERT INTO PatientAuditHead (PatientId, EventCount) VALUES (?, 0) ON DUPLICATE KEY UPDATE EventCount = EventCount', [this.patientId]);
        const [[head]] = await conn.query('SELECT LastHash, EventCount FROM PatientAuditHead WHERE PatientId = ? FOR UPDATE', [this.patientId]);
        const prev = (head && head.LastHash) || genesis(this.patientId);

        const eventGroup = `${this.action.toLowerCase()}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        const payload = JSON.stringify({
            v: 1,
            eventGroup,
            patientId: this.patientId,
            action: this.action,
            at: new Date().toISOString(),
            actor: { id: actor.id, name: actor.name, role: actor.role },
            reason: this.reason,
            authorisedAs: this.authorisedAs,
            ip: this.ip,
            ua: this.userAgent,
            before: this.before,
            after: this.after,
            changes: this.changes,
            risk: { score: this.risk.score, level: this.risk.level, impact: this.risk.impact, flags: this.risk.flags },
            extra: this.extra,
        });
        const algo = currentAlgo();
        const hash = sign(algo, prev, payload);
        const b = this.before || {}, a = this.after || {};
        const dec = (v) => (v === undefined || v === null ? null : round2(v));

        const [res] = await conn.query(`
            INSERT INTO PatientAuditEvent
                (EventGroup, PatientId, Action, ActorId, ActorName, ActorRole, Reason, AuthorisedAs,
                 RiskScore, RiskLevel, RiskFlags,
                 NetBefore, NetAfter, CashBefore, CashAfter, OnlineBefore, OnlineAfter, DuesBefore, DuesAfter,
                 AmountImpact, ChangeCount, IpAddress, UserAgent, Payload, HashAlgo, PrevHash, Hash)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [eventGroup, this.patientId, this.action, actor.id, actor.name.slice(0, 120), actor.role.slice(0, 60),
             this.reason || null, this.authorisedAs,
             this.risk.score, this.risk.level, this.risk.flags.map(f => f.code).join(',').slice(0, 500) || null,
             dec(b.net), dec(a.net), dec(b.cashKept), dec(a.cashKept), dec(b.online), dec(a.online), dec(b.dues), dec(a.dues),
             round2(this.risk.impact), this.changes.length, this.ip, this.userAgent, payload, algo, prev, hash]);

        if (this.changes.length) {
            const why = this.reason || ACTIONS[this.action];
            await conn.query(`
                INSERT INTO PatientAuditLog
                    (PatientId, ChangedField, OldValue, NewValue, ChangedBy, ChangeReason, AuthorisedAs,
                     EventGroup, Category, FieldLabel, OldDisplay, NewDisplay)
                VALUES ?`,
                [this.changes.map(c => [this.patientId, c.field, c.old, c.new, actor.id, why.slice(0, 255), this.authorisedAs,
                                        eventGroup, c.category, c.label, c.old, c.new])]);
        }

        await conn.query('UPDATE PatientAuditHead SET LastHash = ?, EventCount = EventCount + 1, LastEventId = ? WHERE PatientId = ?',
            [hash, res.insertId, this.patientId]);

        alertCache.exp = 0;   // refresh admin badge
        return { id: res.insertId, eventGroup, level: this.risk.level, score: this.risk.score };
    }
}

const event = (conn, opts) => new AuditEvent(conn, opts);

// ─────────────────────────────────────────────────────────────────────────────
// RECEIPT PRINTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * pd = PatientDetails row, tests = [{TestId, TestName}]
 * Returns { printNo, isReprint, previous, changedSincePrevious, firstPrintedAt }
 */
const logReceiptPrint = async ({ patientId, userId, ip, pd, tests = [] }) => {
    const sig   = tests.map(t => Number(t.TestId)).filter(Boolean).sort((x, y) => x - y).join(',').slice(0, 500);
    const names = tests.map(t => t.TestName).filter(Boolean).join(', ').slice(0, 1000);
    const paid  = round2(num(pd.CashPayment) + num(pd.OnlinePayment));
    const vals  = [patientId, userId || null, round2(pd.GrossAmount), round2(pd.Discount), round2(pd.ActualAmount),
                   paid, round2(pd.DuesAmount), sig, names, Number(pd.Status), ip ? String(ip).slice(0, 64) : null, patientId];

    let insertId = null;
    for (let attempt = 0; attempt < 3 && !insertId; attempt++) {
        try {
            const [r] = await db().query(`
                INSERT INTO PatientReceiptPrint
                    (PatientId, PrintNo, PrintedBy, GrossAmount, Discount, NetAmount, PaidAmount, DuesAmount, TestSignature, TestNames, PatientStatus, IpAddress)
                SELECT ?, COALESCE(MAX(PrintNo), 0) + 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
                FROM PatientReceiptPrint WHERE PatientId = ?`, vals);
            insertId = r.insertId;
        } catch (e) {
            if (e.code !== 'ER_DUP_ENTRY' || attempt === 2) throw e;
        }
    }
    const [rows] = await db().query(`
        SELECT PrintNo, NetAmount, PaidAmount, TestSignature, DATE_FORMAT(PrintedAt, '%d-%m-%Y %h:%i %p') AS At
        FROM PatientReceiptPrint WHERE PatientId = ? ORDER BY PrintNo`, [patientId]);
    const cur  = rows[rows.length - 1];
    const prev = rows.length > 1 ? rows[rows.length - 2] : null;
    return {
        printNo: cur ? cur.PrintNo : 1,
        isReprint: rows.length > 1,
        firstPrintedAt: rows.length ? rows[0].At : null,
        previous: prev ? { printNo: prev.PrintNo, at: prev.At, net: round2(prev.NetAmount), paid: round2(prev.PaidAmount) } : null,
        changedSincePrevious: !!prev && (Math.abs(num(prev.NetAmount) - num(cur.NetAmount)) > EPS ||
                                         Math.abs(num(prev.PaidAmount) - num(cur.PaidAmount)) > EPS ||
                                         prev.TestSignature !== cur.TestSignature),
    };
};

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRITY
// ─────────────────────────────────────────────────────────────────────────────

const verifyPatient = async (patientId, q = db()) => {
    const [[events], [[head]]] = await Promise.all([
        q.query('SELECT * FROM PatientAuditEvent WHERE PatientId = ? ORDER BY Id', [patientId]),
        q.query('SELECT * FROM PatientAuditHead WHERE PatientId = ?', [patientId]),
    ]);
    const problems = [];
    let unverifiable = 0;

    let detailMap = new Map();
    if (events.length) {
        const [details] = await q.query(
            'SELECT EventGroup, ChangedField, OldDisplay, NewDisplay FROM PatientAuditLog WHERE PatientId = ? AND EventGroup IN (?) ORDER BY Id',
            [patientId, events.map(e => e.EventGroup)]);
        details.forEach(d => { if (!detailMap.has(d.EventGroup)) detailMap.set(d.EventGroup, []); detailMap.get(d.EventGroup).push(d); });
    }

    let prev = genesis(patientId);
    events.forEach((e, i) => {
        const tag = `Event #${i + 1} (${e.Action}, id ${e.Id})`;
        if (e.PrevHash !== prev) problems.push(`${tag}: chain broken — an earlier event was changed or deleted.`);
        const expected = sign(e.HashAlgo, e.PrevHash, e.Payload);
        if (expected === null) unverifiable++;
        else if (expected !== e.Hash) problems.push(`${tag}: content does not match its signature — row edited in database.`);

        let p = null;
        try { p = JSON.parse(e.Payload); } catch (_) { problems.push(`${tag}: payload unreadable.`); }
        if (p) {
            if (Number(p.patientId) !== Number(e.PatientId) || p.action !== e.Action || p.eventGroup !== e.EventGroup)
                problems.push(`${tag}: patient/action columns were altered.`);
            if (String(p.actor && p.actor.id) !== String(e.ActorId))
                problems.push(`${tag}: "who did it" was altered.`);
            if (p.risk && (p.risk.level !== e.RiskLevel || Number(p.risk.score) !== Number(e.RiskScore) || Math.abs(num(p.risk.impact) - num(e.AmountImpact)) > 0.01))
                problems.push(`${tag}: risk level / amount was altered.`);
            const rows = detailMap.get(e.EventGroup) || [];
            const want = p.changes || [];
            if (rows.length !== want.length) problems.push(`${tag}: ${want.length} change line(s) signed, ${rows.length} found.`);
            else want.forEach((c, k) => {
                const r = rows[k];
                if (r.ChangedField !== c.field || String(r.OldDisplay) !== String(c.old) || String(r.NewDisplay) !== String(c.new))
                    problems.push(`${tag}: change line "${c.label}" was altered.`);
            });
        }
        prev = e.Hash;
    });

    if (events.length || head) {
        if (!head) problems.push('Chain head missing.');
        else {
            if (Number(head.EventCount) !== events.length) problems.push(`Expected ${head.EventCount} events, found ${events.length} — event(s) deleted.`);
            if (events.length && head.LastHash !== prev) problems.push('Latest event does not match chain head — newest event deleted or replaced.');
        }
    }
    return {
        ok: problems.length === 0,
        checked: events.length,
        unverifiable,
        problems,
        note: unverifiable ? `${unverifiable} event(s) are HMAC-signed but AUDIT_HMAC_KEY is not set on this server — cannot verify those.` : null,
    };
};

const verifyRange = async ({ from, to }) => {
    const [ids] = await db().query(
        `SELECT DISTINCT PatientId FROM PatientAuditEvent WHERE CreatedAt >= ? AND CreatedAt < ? + INTERVAL 1 DAY ORDER BY PatientId LIMIT 1500`, [from, to]);
    const failed = [];
    for (const { PatientId } of ids) {
        const r = await verifyPatient(PatientId);
        if (!r.ok) failed.push({ patientId: PatientId, problems: r.problems });
    }
    return { checked: ids.length, failed, capped: ids.length === 1500 };
};

// ─────────────────────────────────────────────────────────────────────────────
// QUERIES — patient history page
// ─────────────────────────────────────────────────────────────────────────────

const parseJson = (s, fallback) => { try { return JSON.parse(s); } catch (_) { return fallback; } };

const getPatientAuditView = async (patientId) => {
    const q = db();
    const [[[patient]], [events], [details], [prints], [raw], tests] = await Promise.all([
        q.query(`
            SELECT pd.*, DATE_FORMAT(pd.RegisteredOn, '%d %b %Y') AS RegDate,
                   CONCAT_WS(' ', ur.FirstName, ur.LastName) AS RegisteredByName,
                   r.Name AS RegisteredByRole, cl.Name AS ClinicName,
                   CONCAT_WS(' ', d.FirstName, d.LastName) AS DoctorName
            FROM PatientDetails pd
            LEFT JOIN Users ur ON ur.Id = pd.RegisteredBy
            LEFT JOIN Roles r ON r.Id = ur.RoleId
            LEFT JOIN Clinics cl ON cl.Id = pd.ClinicId
            LEFT JOIN DoctorDetails d ON d.Id = pd.DoctorId
            WHERE pd.Id = ? LIMIT 1`, [patientId]),
        q.query(`
            SELECT e.Id, e.EventGroup, e.Action, e.ActorId, e.ActorName, e.ActorRole, e.Reason, e.AuthorisedAs,
                   e.RiskScore, e.RiskLevel, e.AmountImpact, e.IpAddress, e.UserAgent, e.Payload, e.CreatedAt,
                   DATE_FORMAT(e.CreatedAt, '%d %b %Y, %h:%i:%s %p') AS DisplayAt,
                   rv.Verdict, rv.Note AS ReviewNote, DATE_FORMAT(rv.ReviewedAt, '%d %b %Y, %h:%i %p') AS ReviewedAt,
                   CONCAT_WS(' ', ru.FirstName, ru.LastName) AS ReviewedByName
            FROM PatientAuditEvent e
            LEFT JOIN PatientAuditReview rv ON rv.Id = (SELECT MAX(r2.Id) FROM PatientAuditReview r2 WHERE r2.EventId = e.Id)
            LEFT JOIN Users ru ON ru.Id = rv.ReviewedBy
            WHERE e.PatientId = ? ORDER BY e.Id`, [patientId]),
        q.query(`
            SELECT pal.Id, pal.EventGroup, pal.Category, pal.ChangedField,
                   COALESCE(pal.FieldLabel, pal.ChangedField) AS FieldLabel,
                   COALESCE(pal.OldDisplay, pal.OldValue) AS OldDisplay,
                   COALESCE(pal.NewDisplay, pal.NewValue) AS NewDisplay,
                   pal.ChangeReason, pal.AuthorisedAs, pal.ChangedAt,
                   DATE_FORMAT(pal.ChangedAt, '%d %b %Y, %h:%i:%s %p') AS DisplayAt,
                   pal.ChangedBy, CONCAT_WS(' ', u.FirstName, u.LastName) AS ChangedByName, rr.Name AS RoleName
            FROM PatientAuditLog pal
            LEFT JOIN Users u ON u.Id = pal.ChangedBy
            LEFT JOIN Roles rr ON rr.Id = u.RoleId
            WHERE pal.PatientId = ? ORDER BY pal.ChangedAt, pal.Id`, [patientId]),
        q.query(`
            SELECT p.*, DATE_FORMAT(p.PrintedAt, '%d %b %Y, %h:%i:%s %p') AS DisplayAt,
                   CONCAT_WS(' ', u.FirstName, u.LastName) AS PrintedByName
            FROM PatientReceiptPrint p LEFT JOIN Users u ON u.Id = p.PrintedBy
            WHERE p.PatientId = ? ORDER BY p.PrintNo`, [patientId]),
        q.query(`
            SELECT r.*, DATE_FORMAT(r.ChangedAt, '%d %b %Y, %h:%i:%s %p') AS DisplayAt
            FROM PatientRawChangeLog r
            WHERE r.PatientId = ?
              AND NOT EXISTS (SELECT 1 FROM PatientAuditEvent e WHERE e.PatientId = r.PatientId
                              AND e.CreatedAt BETWEEN r.ChangedAt - INTERVAL 120 SECOND AND r.ChangedAt + INTERVAL 120 SECOND)
            ORDER BY r.Id`, [patientId]).catch(e => (e.code === 'ER_NO_SUCH_TABLE' ? [[]] : Promise.reject(e))),
        loadTestStates(q, patientId),
    ]);
    if (!patient) return null;

    const detailsByGroup = new Map();
    details.forEach(d => {
        const key = d.EventGroup || `solo_${d.Id}`;
        if (!detailsByGroup.has(key)) detailsByGroup.set(key, []);
        detailsByGroup.get(key).push(d);
    });
    const toChange = (d) => ({ category: d.Category || 'info', field: d.ChangedField, fieldLabel: d.FieldLabel, oldDisplay: d.OldDisplay ?? '—', newDisplay: d.NewDisplay ?? '—' });

    const items = [];
    const eventGroups = new Set();
    events.forEach(e => {
        eventGroups.add(e.EventGroup);
        const p = parseJson(e.Payload, {});
        items.push({
            kind: 'event', id: e.Id, at: new Date(e.CreatedAt), displayAt: e.DisplayAt,
            action: e.Action, actionLabel: ACTIONS[e.Action] || e.Action, actorId: e.ActorId,
            actor: e.ActorName || 'System', role: e.ActorRole || '', reason: e.Reason || '', authorisedAs: e.AuthorisedAs,
            risk: { score: e.RiskScore, level: e.RiskLevel, flags: (p.risk && p.risk.flags) || [], impact: round2(e.AmountImpact) },
            before: p.before || null, after: p.after || null, extra: p.extra || {},
            changes: (detailsByGroup.get(e.EventGroup) || []).map(toChange),
            ip: e.IpAddress, ua: e.UserAgent,
            review: e.Verdict ? { verdict: e.Verdict, note: e.ReviewNote, at: e.ReviewedAt, by: e.ReviewedByName } : null,
        });
    });
    detailsByGroup.forEach((rows, key) => {
        if (eventGroups.has(key)) return;
        const f = rows[0];
        items.push({
            kind: 'legacy', at: new Date(f.ChangedAt), displayAt: f.DisplayAt,
            action: 'LEGACY', actionLabel: 'Change (before audit upgrade)',
            actor: f.ChangedByName || 'System', role: f.RoleName || '', reason: f.ChangeReason || '', authorisedAs: f.AuthorisedAs,
            risk: { score: 0, level: 'none', flags: [], impact: 0 }, changes: rows.map(toChange),
        });
    });
    prints.forEach(p => items.push({
        kind: 'print', at: new Date(p.PrintedAt), displayAt: p.DisplayAt, actor: p.PrintedByName || 'System',
        print: { no: p.PrintNo, net: round2(p.NetAmount), paid: round2(p.PaidAmount), dues: round2(p.DuesAmount), tests: p.TestNames, gross: round2(p.GrossAmount), discount: round2(p.Discount) },
    }));
    raw.forEach(r => items.push({
        kind: 'raw', at: new Date(r.ChangedAt), displayAt: r.DisplayAt, actor: r.DbUser || 'unknown',
        raw: { table: r.TableName, op: r.Op, columns: r.ColumnsChanged, old: parseJson(r.OldValues, {}), neu: parseJson(r.NewValues, {}) },
    }));
    items.sort((x, y) => x.at - y.at);

    // Original bill = REGISTER snapshot (or first history row for old patients)
    let original = null;
    const reg = items.find(i => i.kind === 'event' && i.action === 'REGISTER');
    if (reg && reg.after) original = { ...reg.after, source: 'registration audit' };
    if (!original) {
        try {
            const [[h]] = await q.query(
                `SELECT * FROM patientdetailshistory WHERE PatientId = ? AND ChangeType = 'insert' ORDER BY Id LIMIT 1`, [patientId]);
            if (h) original = { ...moneyFromRow(h), source: 'registration history' };
        } catch (_) { /* table name differs — ignore */ }
    }

    const current = moneyFromRow(patient);
    const maxPrinted = prints.length ? Math.max(...prints.map(p => num(p.NetAmount))) : null;
    const integrity = await verifyPatient(patientId, q);

    return {
        patient, items, tests, original, current, integrity,
        prints: prints.length,
        receiptMismatch: maxPrinted != null && Number(patient.Status) === 1 && maxPrinted > current.net + EPS
            ? { printed: round2(maxPrinted), now: current.net, diff: round2(maxPrinted - current.net) } : null,
        summary: {
            events: events.length + items.filter(i => i.kind === 'legacy').length,
            edits: events.filter(e => e.Action === 'EDIT').length,
            highRisk: events.filter(e => ['high', 'critical'].includes(e.RiskLevel)).length,
            unreviewed: events.filter(e => !e.Verdict && LEVEL_ORDER.indexOf(e.RiskLevel) >= 2).length,
            outside: raw.length,
            maxScore: events.reduce((m, e) => Math.max(m, e.RiskScore), 0),
        },
    };
};

// ─────────────────────────────────────────────────────────────────────────────
// QUERIES — Audit Center
// ─────────────────────────────────────────────────────────────────────────────

const ymd = (v, fallback) => {
    const m = moment(str(v), ['YYYY-MM-DD', 'DD-MM-YYYY', 'D MMM YYYY'], true);
    return m.isValid() ? m.format('YYYY-MM-DD') : fallback;
};

const normaliseFilters = (src = {}) => {
    const today = moment().format('YYYY-MM-DD');
    let from = ymd(src.from, moment().subtract(cfg.defaultRangeDays - 1, 'days').format('YYYY-MM-DD'));
    let to   = ymd(src.to, today);
    if (from > to) [from, to] = [to, from];
    const q = str(src.q).slice(0, 60);
    if (!q && moment(to).diff(moment(from), 'days') > 366) from = moment(to).subtract(366, 'days').format('YYYY-MM-DD');
    return {
        from, to,
        level:   LEVEL_ORDER.includes(src.level) ? src.level : '',
        review:  ['unreviewed', 'reviewed', 'flagged', 'all'].includes(src.review) ? src.review : 'all',
        actorId: parseInt(src.actorId, 10) > 0 ? parseInt(src.actorId, 10) : '',
        action:  ACTIONS[src.action] ? src.action : '',
        q,
        page:    Math.max(1, parseInt(src.page, 10) || 1),
    };
};

const eventsWhere = (f) => {
    const where = ['e.CreatedAt >= ?', 'e.CreatedAt < ? + INTERVAL 1 DAY'];
    const params = [f.from, f.to];
    if (f.level)   { where.push(`FIELD(e.RiskLevel, 'none','low','medium','high','critical') >= ?`); params.push(LEVEL_ORDER.indexOf(f.level) + 1); }
    if (f.actorId) { where.push('e.ActorId = ?'); params.push(f.actorId); }
    if (f.action)  { where.push('e.Action = ?'); params.push(f.action); }
    if (f.q) {
        if (/^\d+$/.test(f.q)) { where.push('(e.PatientId = ? OR pd.PhoneNumber LIKE ?)'); params.push(Number(f.q), `%${f.q}%`); }
        else { where.push('pd.Name LIKE ?'); params.push(`%${f.q}%`); }
    }
    if (f.review === 'unreviewed') where.push('rv.Id IS NULL');
    if (f.review === 'reviewed')   where.push('rv.Id IS NOT NULL');
    if (f.review === 'flagged')    where.push(`rv.Verdict IN ('suspicious','fraud')`);
    return { sql: where.join(' AND '), params };
};

const EVENTS_FROM = `
    FROM PatientAuditEvent e
    LEFT JOIN PatientDetails pd ON pd.Id = e.PatientId
    LEFT JOIN PatientAuditReview rv ON rv.Id = (SELECT MAX(r2.Id) FROM PatientAuditReview r2 WHERE r2.EventId = e.Id)
    LEFT JOIN Users ru ON ru.Id = rv.ReviewedBy`;

const searchEvents = async (f, { limit = cfg.pageSize, all = false } = {}) => {
    const w = eventsWhere(f);
    const [[{ total }]] = await db().query(`SELECT COUNT(*) AS total ${EVENTS_FROM} WHERE ${w.sql}`, w.params);
    const lim = all ? 10000 : limit;
    const off = all ? 0 : (f.page - 1) * limit;
    const [rows] = await db().query(`
        SELECT e.Id, e.PatientId, e.Action, e.ActorId, e.ActorName, e.ActorRole, e.Reason, e.RiskScore, e.RiskLevel, e.RiskFlags,
               e.NetBefore, e.NetAfter, e.CashBefore, e.CashAfter, e.OnlineBefore, e.OnlineAfter, e.DuesBefore, e.DuesAfter,
               e.AmountImpact, e.ChangeCount, e.IpAddress,
               DATE_FORMAT(e.CreatedAt, '%d-%m-%Y %h:%i %p') AS DisplayAt, e.CreatedAt,
               pd.Title, pd.Name AS PatientName, pd.PhoneNumber, pd.Status AS PatientStatus,
               rv.Verdict, rv.Note AS ReviewNote, CONCAT_WS(' ', ru.FirstName, ru.LastName) AS ReviewedByName
        ${EVENTS_FROM}
        WHERE ${w.sql}
        ORDER BY e.RiskScore DESC, e.Id DESC
        LIMIT ${Number(lim)} OFFSET ${Number(off)}`, w.params);
    const labels = Object.fromEntries(Object.entries(cfg.rules).map(([k, v]) => [k, v.label]));
    rows.forEach(r => {
        r.Flags = str(r.RiskFlags).split(',').filter(Boolean).map(c => ({ code: c, label: labels[c] || c }));
        r.ActionLabel = ACTIONS[r.Action] || r.Action;
    });
    return { rows, total: Number(total), pages: Math.max(1, Math.ceil(total / limit)) };
};

const getKpis = async (f) => {
    const p = [f.from, f.to];
    const [[[k]], [[rm]], [[out]]] = await Promise.all([
        db().query(`
            SELECT COUNT(*) AS events,
                   SUM(e.Action = 'REGISTER') AS registrations,
                   SUM(e.Action = 'EDIT') AS edits,
                   SUM(e.RiskLevel IN ('high','critical')) AS highRisk,
                   SUM(e.RiskLevel IN ('high','critical') AND NOT EXISTS (SELECT 1 FROM PatientAuditReview r WHERE r.EventId = e.Id)) AS highUnreviewed,
                   COALESCE(SUM(CASE WHEN e.Action = 'EDIT' AND e.NetAfter < e.NetBefore THEN e.NetBefore - e.NetAfter END), 0) AS billCut,
                   COALESCE(SUM(CASE WHEN e.Action = 'EDIT' AND e.CashAfter < e.CashBefore THEN e.CashBefore - e.CashAfter END), 0) AS cashBack,
                   SUM(e.Action = 'CANCEL') AS cancels,
                   COALESCE(SUM(CASE WHEN e.Action = 'CANCEL' THEN e.AmountImpact END), 0) AS cancelRefund
            FROM PatientAuditEvent e WHERE e.CreatedAt >= ? AND e.CreatedAt < ? + INTERVAL 1 DAY`, p),
        db().query(`
            SELECT COUNT(*) AS c, COALESCE(SUM(x.MaxNet - pd.ActualAmount), 0) AS amount
            FROM (SELECT PatientId, MAX(NetAmount) AS MaxNet FROM PatientReceiptPrint
                  WHERE PrintedAt >= ? AND PrintedAt < ? + INTERVAL 1 DAY GROUP BY PatientId) x
            JOIN PatientDetails pd ON pd.Id = x.PatientId
            WHERE pd.Status = 1 AND x.MaxNet > pd.ActualAmount + 0.5`, p),
        db().query(`
            SELECT COUNT(*) AS c FROM PatientRawChangeLog r
            WHERE r.ChangedAt >= ? AND r.ChangedAt < ? + INTERVAL 1 DAY
              AND NOT EXISTS (SELECT 1 FROM PatientAuditEvent e WHERE e.PatientId = r.PatientId
                              AND e.CreatedAt BETWEEN r.ChangedAt - INTERVAL 120 SECOND AND r.ChangedAt + INTERVAL 120 SECOND)`, p)
            .catch(e => (e.code === 'ER_NO_SUCH_TABLE' ? [[{ c: 0 }]] : Promise.reject(e))),
    ]);
    const n = (v) => round2(v);
    return {
        events: n(k.events), registrations: n(k.registrations), edits: n(k.edits),
        highRisk: n(k.highRisk), highUnreviewed: n(k.highUnreviewed),
        billCut: n(k.billCut), cashBack: n(k.cashBack), cancels: n(k.cancels), cancelRefund: n(k.cancelRefund),
        receiptMismatch: n(rm.c), receiptMismatchAmount: n(rm.amount), outside: n(out.c),
    };
};

const getStaffSummary = async (f) => {
    const p = [f.from, f.to];
    const [[rows], [removed]] = await Promise.all([
        db().query(`
            SELECT e.ActorId, MAX(e.ActorName) AS ActorName, MAX(e.ActorRole) AS ActorRole,
                   SUM(e.Action = 'REGISTER') AS registrations,
                   COALESCE(SUM(CASE WHEN e.Action = 'REGISTER' THEN e.NetAfter END), 0) AS registeredValue,
                   COALESCE(SUM(CASE WHEN e.Action = 'REGISTER' THEN e.AmountImpact END), 0) AS discountGiven,
                   SUM(e.Action = 'EDIT') AS edits,
                   SUM(e.Action = 'EDIT' AND e.NetAfter < e.NetBefore - 0.5) AS billCuts,
                   COALESCE(SUM(CASE WHEN e.Action = 'EDIT' AND e.NetAfter < e.NetBefore THEN e.NetBefore - e.NetAfter END), 0) AS billCutAmount,
                   COALESCE(SUM(CASE WHEN e.Action = 'EDIT' AND e.CashAfter < e.CashBefore THEN e.CashBefore - e.CashAfter END), 0) AS cashBack,
                   SUM(e.Action = 'CANCEL') AS cancels,
                   COALESCE(SUM(CASE WHEN e.Action = 'CANCEL' THEN e.AmountImpact END), 0) AS cancelRefund,
                   SUM(e.RiskLevel IN ('high','critical')) AS highRisk,
                   SUM(e.RiskScore) AS totalScore,
                   SUM(EXISTS (SELECT 1 FROM PatientAuditReview r WHERE r.Id = (SELECT MAX(r2.Id) FROM PatientAuditReview r2 WHERE r2.EventId = e.Id) AND r.Verdict IN ('suspicious','fraud'))) AS flagged
            FROM PatientAuditEvent e
            WHERE e.CreatedAt >= ? AND e.CreatedAt < ? + INTERVAL 1 DAY
            GROUP BY e.ActorId
            ORDER BY totalScore DESC, billCutAmount DESC`, p),
        // Removed tests are counted from the signed payload of each EDIT event — no text join
        // to the old PatientAuditLog table (that join failed on MySQL 8 with mixed collations).
        db().query(`
            SELECT e.ActorId, e.Payload
            FROM PatientAuditEvent e
            WHERE e.Action = 'EDIT' AND e.CreatedAt >= ? AND e.CreatedAt < ? + INTERVAL 1 DAY
              AND e.Payload LIKE '%Removed%'`, p),
    ]);
    const rem = new Map();
    removed.forEach(r => {
        const pl = parseJson(r.Payload, {});
        const c = (pl.changes || []).filter(x => x.field === 'TestRemoved' || x.field === 'SubTestRemoved').length;
        if (c) rem.set(String(r.ActorId), (rem.get(String(r.ActorId)) || 0) + c);
    });
    return rows.map(r => {
        const out = {};
        Object.keys(r).forEach(k => { out[k] = ['ActorName', 'ActorRole', 'ActorId'].includes(k) ? r[k] : round2(r[k]); });
        out.testsRemoved = rem.get(String(r.ActorId)) || 0;
        out.cutRate = out.registrations ? round2((out.billCuts / out.registrations) * 100) : (out.billCuts ? 100 : 0);
        out.discountRate = out.registeredValue + out.discountGiven > 0 ? round2((out.discountGiven / (out.registeredValue + out.discountGiven)) * 100) : 0;
        return out;
    });
};

const getReceiptMismatches = async (f) => {
    const [rows] = await db().query(`
        SELECT x.PatientId, pd.Title, pd.Name, pd.PhoneNumber, pd.Status,
               pd.ActualAmount AS CurrentNet, (pd.CashPayment + pd.OnlinePayment) AS CurrentPaid,
               x.MaxNet, x.MaxPaid, x.Prints,
               DATE_FORMAT(x.FirstPrint, '%d-%m-%Y %h:%i %p') AS FirstPrint,
               DATE_FORMAT(x.LastPrint,  '%d-%m-%Y %h:%i %p') AS LastPrint,
               CONCAT_WS(' ', u.FirstName, u.LastName) AS RegisteredByName,
               (SELECT e.ActorName FROM PatientAuditEvent e WHERE e.PatientId = x.PatientId AND e.Action IN ('EDIT','CANCEL')
                ORDER BY e.Id DESC LIMIT 1) AS LastChangedBy
        FROM (SELECT PatientId, MAX(NetAmount) AS MaxNet, MAX(PaidAmount) AS MaxPaid, COUNT(*) AS Prints,
                     MIN(PrintedAt) AS FirstPrint, MAX(PrintedAt) AS LastPrint
              FROM PatientReceiptPrint WHERE PrintedAt >= ? AND PrintedAt < ? + INTERVAL 1 DAY GROUP BY PatientId) x
        JOIN PatientDetails pd ON pd.Id = x.PatientId
        LEFT JOIN Users u ON u.Id = pd.RegisteredBy
        WHERE x.MaxNet > pd.ActualAmount + 0.5
           OR x.MaxPaid > (pd.CashPayment + pd.OnlinePayment) + 0.5
           OR pd.Status = 0
        ORDER BY (x.MaxNet - pd.ActualAmount) DESC, x.PatientId DESC
        LIMIT 500`, [f.from, f.to]);
    return rows.map(r => ({
        ...r,
        CurrentNet: round2(r.CurrentNet), CurrentPaid: round2(r.CurrentPaid), MaxNet: round2(r.MaxNet), MaxPaid: round2(r.MaxPaid),
        Diff: round2(Number(r.Status) === 0 ? r.MaxPaid : Math.max(r.MaxNet - r.CurrentNet, r.MaxPaid - r.CurrentPaid)),
        Kind: Number(r.Status) === 0 ? 'cancelled' : 'reduced',
    }));
};

const getUnattributedChanges = async (f) => {
    const [rows] = await db().query(`
        SELECT r.*, DATE_FORMAT(r.ChangedAt, '%d-%m-%Y %h:%i:%s %p') AS DisplayAt, pd.Name, pd.Title
        FROM PatientRawChangeLog r
        LEFT JOIN PatientDetails pd ON pd.Id = r.PatientId
        WHERE r.ChangedAt >= ? AND r.ChangedAt < ? + INTERVAL 1 DAY
          AND NOT EXISTS (SELECT 1 FROM PatientAuditEvent e WHERE e.PatientId = r.PatientId
                          AND e.CreatedAt BETWEEN r.ChangedAt - INTERVAL 120 SECOND AND r.ChangedAt + INTERVAL 120 SECOND)
        ORDER BY r.Id DESC LIMIT 500`, [f.from, f.to]).catch(e => (e.code === 'ER_NO_SUCH_TABLE' ? [[]] : Promise.reject(e)));
    return rows.map(r => ({ ...r, old: parseJson(r.OldValues, {}), neu: parseJson(r.NewValues, {}) }));
};

const getActors = async () => {
    const [rows] = await db().query(`SELECT DISTINCT ActorId, ActorName FROM PatientAuditEvent WHERE ActorId IS NOT NULL ORDER BY ActorName`);
    const seen = new Map();
    rows.forEach(r => { if (!seen.has(r.ActorId)) seen.set(r.ActorId, r.ActorName); });
    return [...seen].map(([id, name]) => ({ id, name }));
};

// ── Review ───────────────────────────────────────────────────────────────────
const VERDICTS = { ok: 'OK — genuine', explained: 'Explained', suspicious: 'Suspicious', fraud: 'Fraud confirmed' };

const addReview = async ({ eventIds, verdict, note, reviewerId }) => {
    const ids = [...new Set((Array.isArray(eventIds) ? eventIds : [eventIds]).map(v => parseInt(v, 10)).filter(v => v > 0))].slice(0, 500);
    const text = str(note).slice(0, 1000);
    if (!ids.length) return { success: false, message: 'Select at least one event.' };
    if (!VERDICTS[verdict]) return { success: false, message: 'Choose a verdict.' };
    if (verdict !== 'ok' && text.length < 5) return { success: false, message: 'Write a note (at least 5 characters) for this verdict.' };
    const [found] = await db().query('SELECT Id, ActorId FROM PatientAuditEvent WHERE Id IN (?)', [ids]);
    if (found.length !== ids.length) return { success: false, message: 'Some events no longer exist.' };
    if (found.some(e => String(e.ActorId) === String(reviewerId)))
        return { success: false, message: 'You cannot review your own actions. Ask another admin.' };
    await db().query('INSERT INTO PatientAuditReview (EventId, Verdict, Note, ReviewedBy) VALUES ?',
        [ids.map(id => [id, verdict, text || null, reviewerId])]);
    alertCache.exp = 0;
    return { success: true, message: `${ids.length} event${ids.length > 1 ? 's' : ''} marked "${VERDICTS[verdict]}".` };
};

// ── Alert badge count (cached) ───────────────────────────────────────────────
const alertCache = { exp: 0, val: { high: 0, outside: 0, total: 0 } };
const getAlertCount = async () => {
    if (alertCache.exp > Date.now()) return alertCache.val;
    try {
        const [[[a]], [[b]]] = await Promise.all([
            db().query(`
                SELECT COUNT(*) AS c FROM PatientAuditEvent e
                WHERE e.CreatedAt >= NOW() - INTERVAL 30 DAY AND e.RiskLevel IN ('high','critical')
                  AND NOT EXISTS (SELECT 1 FROM PatientAuditReview r WHERE r.EventId = e.Id)`),
            db().query(`
                SELECT COUNT(*) AS c FROM PatientRawChangeLog r
                WHERE r.ChangedAt >= NOW() - INTERVAL 7 DAY
                  AND NOT EXISTS (SELECT 1 FROM PatientAuditEvent e WHERE e.PatientId = r.PatientId
                                  AND e.CreatedAt BETWEEN r.ChangedAt - INTERVAL 120 SECOND AND r.ChangedAt + INTERVAL 120 SECOND)`)
                .catch(() => [[{ c: 0 }]]),
        ]);
        alertCache.val = { high: Number(a.c) || 0, outside: Number(b.c) || 0, total: (Number(a.c) || 0) + (Number(b.c) || 0) };
    } catch (e) {
        console.error('[Audit] alert count:', e.message);
    }
    alertCache.exp = Date.now() + cfg.alertCacheSeconds * 1000;
    return alertCache.val;
};

module.exports = {
    ACTIONS, VERDICTS, LEVEL_ORDER,
    event, money, moneyFromRow, loadContext, loadTestStates, anyTestStarted,
    guardEdit, evaluateRisk, reductionsOf, billChangesOf, billLockStatus,
    loadActor, hasPermission, userCan, clearPermCache, canEditLockedBill, isAdminUser,
    logReceiptPrint, verifyPatient, verifyRange,
    getPatientAuditView, normaliseFilters, searchEvents, getKpis, getStaffSummary,
    getReceiptMismatches, getUnattributedChanges, getActors, addReview, getAlertCount,
};

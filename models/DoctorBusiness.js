'use strict';

/**
 * DoctorBusiness.js — "Doctor Business Tracker" for the marketing team.
 *
 * One page that answers the questions a marketing head asks every week:
 *   - How much business (patients, tests, revenue, thanks) did each doctor send, month by month?
 *   - Who is growing, who is slipping, who has stopped, who is new?
 *   - Which doctors never referred (prospects)? Which send USG but never CT (cross-sell)?
 *   - How is each MR doing — their doctors' business vs. the visits they made?
 *
 * Definitions (also shown on the page):
 *   - Patient   = a registration with Status = 1 (cancelled ones are not counted).
 *   - Revenue   = PatientDetails.ActualAmount (what the patient was billed after discount). When a
 *                 patient has tests of several categories, the bill is split by each category's share of the
 *                 gross price (tests + sub-tests), so category numbers always add up to the total.
 *   - Thanks    = Referrals.Thanks (active referrals only). With a category filter, the saved
 *                 ThanksBreakdown decides which part belongs to which category.
 *   - MR        = the doctor's CURRENT marketing person (latest MarketingDoctorAssociation row).
 *   - Same days = compare only day 1..N of every month (fair comparison with the running month).
 *
 * PATCH (2026-10-25) — marked ★
 *  ★1 First days of a month: the running month was projected (×30 on day 1) → on the 1st–6th almost
 *     every doctor showed "At risk: on track for 0" or "Growing" from one patient. While the running
 *     month has fewer than MIN_PROJECT_DAYS days, the trend uses the last FULL month instead.
 *  ★2 Revenue split by category used TODAY's test price for old bills → splits changed after every
 *     price change. Uses the price saved on the bill (PatientTestRefference.Price / PatientSubTestRefference.Price)
 *     when those columns exist (patient-security migration), otherwise today's price as before.
 *  ★3 Thanks of a patient whose tests are gone were dropped from the totals → now under "No test".
 *  ★4 ?cat=1&cat=2&… with hundreds of values → capped at 50.
 *
 * Tables used: PatientDetails, PatientTestRefference, MainTestTable, PatientSubTestRefference, SubTestTable,
 * Category, Referrals, DoctorDetails, Users, and — when present — MarketingDoctorAssociation,
 * VisitLog, DoctorVisitingSchedule. A missing optional table only hides that part of the page.
 */

const dbConnection = require('../config/DBConnection');
const moment       = require('moment');

const db = () => (dbConnection.pool || dbConnection.connection).promise();

const MAX_MONTHS   = 24;
const LOST_DAYS    = 60;   // no referral for more than this → "Lost"
const RISK_DAYS    = 30;   // no referral for more than this → "At risk"
const DROP_RATIO   = 0.5;  // latest month below 50 % of the doctor's usual → "At risk"
const GROW_RATIO   = 1.25; // latest month 25 % above usual → "Growing"
const CROSS_MIN    = 5;    // doctors with at least this many patients are checked for cross-sell
const NO_VISIT_DAYS = 30;  // top doctors not visited for this long are flagged
const MIN_PROJECT_DAYS = 7; // ★1 running month counts for trends only after this many days

const OPTIONAL = new Set(['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR']);
const optional = async (promise, fallback) => {
    try { return await promise; } catch (e) { if (OPTIONAL.has(e.code)) return fallback; throw e; }
};
const num  = (v) => Number(v) || 0;
const r2   = (v) => Math.round(num(v) * 100) / 100;
const pad  = (n) => String(n).padStart(2, '0');
const fullName = (d) => [d.FirstName, d.LastName].map(s => (s || '').trim()).filter(Boolean).join(' ').replace(/^dr\.?\s+/i, '');

// ─────────────────────────────────────────────────────────────────────────────
// Filters
// ─────────────────────────────────────────────────────────────────────────────

/** Month dropdown: last 36 months, newest first. */
const monthOptions = (now = moment()) => {
    const out = [];
    for (let i = 0; i < 36; i++) {
        const m = now.clone().startOf('month').subtract(i, 'months');
        out.push({ key: m.format('YYYY-MM'), label: m.format('MMM YYYY') });
    }
    return out;
};

/** Indian financial year (April–March) that contains `m`. */
const fyStart = (m) => (m.month() >= 3 ? m.clone().month(3) : m.clone().subtract(1, 'year').month(3)).startOf('month');

const presets = (now = moment()) => {
    const cur = now.clone().startOf('month');
    const fy  = fyStart(now);
    return [
        { id: 'm1',  label: 'This month',     from: cur.format('YYYY-MM'), to: cur.format('YYYY-MM') },
        { id: 'm3',  label: 'Last 3 months',  from: cur.clone().subtract(2, 'months').format('YYYY-MM'),  to: cur.format('YYYY-MM') },
        { id: 'm6',  label: 'Last 6 months',  from: cur.clone().subtract(5, 'months').format('YYYY-MM'),  to: cur.format('YYYY-MM') },
        { id: 'm12', label: 'Last 12 months', from: cur.clone().subtract(11, 'months').format('YYYY-MM'), to: cur.format('YYYY-MM') },
        { id: 'fy',  label: `FY ${fy.format('YY')}-${fy.clone().add(1, 'year').format('YY')}`, from: fy.format('YYYY-MM'), to: cur.format('YYYY-MM') },
        { id: 'lfy', label: `FY ${fy.clone().subtract(1, 'year').format('YY')}-${fy.format('YY')}`,
          from: fy.clone().subtract(1, 'year').format('YYYY-MM'), to: fy.clone().subtract(1, 'month').format('YYYY-MM') },
    ];
};

const toArray = (v) => (v == null || v === '' ? [] : Array.isArray(v) ? v : String(v).split(','));

/**
 * Reads ?from=YYYY-MM&to=YYYY-MM&cat=1&cat=3&mr=11|none&cutoff=0..31.
 * Bad values fall back to defaults instead of failing.
 */
const readFilters = (q = {}, now = moment()) => {
    const thisMonth = now.clone().startOf('month');
    const parseM = (s) => { const m = moment(String(s || ''), 'YYYY-MM', true); return m.isValid() ? m.startOf('month') : null; };

    let to = parseM(q.to) || thisMonth.clone();
    if (to.isAfter(thisMonth)) to = thisMonth.clone();               // no future months
    let from = parseM(q.from) || to.clone().subtract(5, 'months');
    if (from.isAfter(thisMonth)) from = thisMonth.clone();
    if (from.isAfter(to)) [from, to] = [to.clone(), from.clone()];
    const oldest = thisMonth.clone().subtract(35, 'months');          // same 36 months as the dropdown
    if (from.isBefore(oldest)) from = oldest.clone();
    if (to.isBefore(oldest)) to = oldest.clone();
    if (to.diff(from, 'months') >= MAX_MONTHS) from = to.clone().subtract(MAX_MONTHS - 1, 'months');

    let cutoff = parseInt(q.cutoff, 10);
    if (!(cutoff >= 1 && cutoff <= 31)) cutoff = 0;           // 0 = full month

    const cats = [...new Set(toArray(q.cat).slice(0, 200).map(x => parseInt(x, 10)).filter(x => x > 0 && x < 1e9))].slice(0, 50);   // ★4
    const mrRaw = String(q.mr == null ? '' : q.mr).trim();
    const mr = mrRaw === 'none' ? 'none' : (parseInt(mrRaw, 10) > 0 ? parseInt(mrRaw, 10) : '');

    return { from, to, cutoff, cats, mr, now: now.clone() };
};

/** Months of the range, with how complete each one is (the running month is partial). */
const buildMonths = (f) => {
    const out = [];
    const today = f.now.clone().startOf('day');
    for (const m = f.from.clone(); m.isSameOrBefore(f.to); m.add(1, 'month')) {
        const dim      = m.daysInMonth();
        const expected = f.cutoff ? Math.min(f.cutoff, dim) : dim;      // days that SHOULD be in this column
        let covered    = expected;
        if (m.isSame(today, 'month')) covered = Math.min(expected, today.date());
        out.push({
            key: m.format('YYYY-MM'), label: m.format('MMM YY'),
            partial: covered < expected, covered, expected,
            factor: covered > 0 ? expected / covered : 1,              // run-rate projection for the running month
        });
    }
    return out;
};

/** [start, endExclusive) of the range, never beyond tomorrow. */
const rangeOf = (from, to, now) => {
    const start = from.clone().startOf('month');
    let end     = to.clone().add(1, 'month').startOf('month');
    const tomorrow = now.clone().startOf('day').add(1, 'day');
    if (end.isAfter(tomorrow)) end = tomorrow;
    return { start: start.format('YYYY-MM-DD'), end: end.format('YYYY-MM-DD'), asOf: end.clone().subtract(1, 'day') };
};

// ─────────────────────────────────────────────────────────────────────────────
// Facts: one entry per patient with business per category
// ─────────────────────────────────────────────────────────────────────────────

let itemCatCache = null, itemCatAt = 0;
/** test id → category, sub-test id → category (for the thanks breakdown). Cached for a minute. */
const itemCategories = async () => {
    if (itemCatCache && Date.now() - itemCatAt < 60000) return itemCatCache;
    const [[tests], subs] = await Promise.all([
        db().query('SELECT Id, CategoryId FROM MainTestTable'),
        optional(db().query('SELECT Id, CategoryId FROM SubTestTable').then(r => r[0]), []),
    ]);
    itemCatCache = { test: new Map(tests.map(t => [t.Id, t.CategoryId])), subtest: new Map(subs.map(s => [s.Id, s.CategoryId])) };
    itemCatAt = Date.now();
    return itemCatCache;
};

// ★2 does the bill store its own prices? (columns added by 2026-10-24_patient_security.sql)
let snap = null;
const priceSnapshots = async () => {
    if (snap) return snap;
    const [rows] = await db().query(`SELECT TABLE_NAME AS t FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'Price' AND TABLE_NAME IN ('PatientTestRefference', 'PatientSubTestRefference')`);
    const has = new Set(rows.map(r => r.t));
    snap = { test: has.has('PatientTestRefference') ? 'COALESCE(ptr.Price, mt.Price, 0)' : 'COALESCE(mt.Price, 0)',
             sub:  has.has('PatientSubTestRefference') ? 'COALESCE(ps.Price, st.Price, 0)' : 'COALESCE(st.Price, 0)' };
    return snap;
};

const readBreakdown = (v) => {
    if (!v) return null;
    if (Array.isArray(v)) return v;
    try { const x = JSON.parse(v); return Array.isArray(x) ? x : null; } catch (e) { return null; }
};

/**
 * Loads patients of [start, end) (optionally day 1..cutoff only, one doctor only, or a set of doctors).
 * Returns [{ pid, did, mk, day, cats: Map(catId → { n, gross, net, thanks }) }].
 * With `cats` only those categories are kept and patients without them are dropped.
 */
const loadFacts = async ({ start, end, cutoff = 0, cats = [], doctorId = null }) => {
    const where = ['p.Status = 1', 'p.RegisteredOn >= ?', 'p.RegisteredOn < ?'];
    const params = [start, end];
    if (cutoff) { where.push('DAY(p.RegisteredOn) <= ?'); params.push(cutoff); }
    if (doctorId) { where.push('p.DoctorId = ?'); params.push(doctorId); }
    const W = where.join(' AND ');
    const price = await priceSnapshots();

    const [[patients], [tests], subs, refs, itemCats] = await Promise.all([
        db().query(`SELECT p.Id, p.DoctorId, DATE_FORMAT(p.RegisteredOn, '%Y-%m') AS mk, p.ActualAmount, p.GrossAmount
                    FROM PatientDetails p WHERE ${W}`, params),
        db().query(`SELECT ptr.PatientId AS pid, mt.CategoryId AS cid, COUNT(*) AS n,
                           SUM(${price.test}) AS gross, SUM(COALESCE(ptr.Discount, 0)) AS disc
                    FROM PatientDetails p
                    JOIN PatientTestRefference ptr ON ptr.PatientId = p.Id
                    JOIN MainTestTable mt ON mt.Id = ptr.TestId
                    WHERE ${W} GROUP BY ptr.PatientId, mt.CategoryId`, params),
        optional(db().query(`SELECT ps.PatientId AS pid, st.CategoryId AS cid, COUNT(*) AS n,
                           SUM(${price.sub}) AS gross, SUM(COALESCE(ps.Discount, 0)) AS disc
                    FROM PatientDetails p
                    JOIN PatientSubTestRefference ps ON ps.PatientId = p.Id
                    JOIN SubTestTable st ON st.Id = ps.SubTestId
                    WHERE ${W} GROUP BY ps.PatientId, st.CategoryId`, params).then(r => r[0]), []),
        optional(db().query(`SELECT r.PatientId AS pid, r.Thanks, r.ThanksBreakdown
                    FROM PatientDetails p JOIN Referrals r ON r.PatientId = p.Id AND r.DoctorId = p.DoctorId
                    WHERE ${W} AND r.Status = 'active'`, params).then(r => r[0]),
                 null),
        itemCategories(),
    ]);

    // Referrals without a Status column (older schema) → read again without it
    let referrals = refs;
    if (referrals === null) {
        referrals = await optional(db().query(`SELECT r.PatientId AS pid, r.Thanks, r.ThanksBreakdown
                    FROM PatientDetails p JOIN Referrals r ON r.PatientId = p.Id AND r.DoctorId = p.DoctorId
                    WHERE ${W}`, params).then(r => r[0]), []);
    }

    const byPid = new Map();
    for (const p of patients) {
        byPid.set(p.Id, { pid: p.Id, did: p.DoctorId || 0, mk: p.mk, actual: p.ActualAmount, grossBill: num(p.GrossAmount), items: new Map() });
    }
    const addItem = (row, isTest) => {
        const f = byPid.get(row.pid); if (!f) return;
        const c = f.items.get(row.cid) || { n: 0, tests: 0, gross: 0, disc: 0, thanks: 0 };
        c.n += isTest ? num(row.n) : 0;          // "tests" counts main tests only; sub-tests are add-ons
        c.gross += num(row.gross); c.disc += num(row.disc);
        f.items.set(row.cid, c);
    };
    tests.forEach(r => addItem(r, true));
    subs.forEach(r => addItem(r, false));

    // thanks per category
    for (const r of referrals) {
        const f = byPid.get(r.pid); if (!f) continue;
        const total = num(r.Thanks);
        if (!total) continue;
        const bd = readBreakdown(r.ThanksBreakdown);
        let placed = 0;
        if (bd && bd.length) {
            for (const it of bd) {
                const cid = (it.type === 'subtest' ? itemCats.subtest : itemCats.test).get(Number(it.id));
                const amt = num(it.amount);
                if (cid == null || !amt) continue;
                const c = f.items.get(cid) || { n: 0, gross: 0, disc: 0, thanks: 0 };
                c.thanks += amt; placed += amt; f.items.set(cid, c);
            }
        }
        const rest = total - placed;   // no breakdown (old rows) or rounding → split by gross share
        if (Math.abs(rest) > 0.009) {
            const g = [...f.items.values()].reduce((a, c) => a + c.gross, 0);
            const list = [...f.items.values()];
            if (!list.length) {                       // ★3 no tests left → keep the thanks under "No test"
                f.items.set(0, { n: 0, tests: 0, gross: 0, disc: 0, thanks: rest });
                continue;
            }
            list.forEach(c => { c.thanks += g > 0 ? rest * c.gross / g : rest / list.length; });
        }
    }

    // bill (after all discounts) split by gross share
    const catSet = cats.length ? new Set(cats) : null;
    const out = [];
    for (const f of byPid.values()) {
        const gross = [...f.items.values()].reduce((a, c) => a + c.gross, 0);
        const itemNet = gross - [...f.items.values()].reduce((a, c) => a + c.disc, 0);
        const bill = f.actual == null ? itemNet : num(f.actual);
        const res = new Map();
        for (const [cid, c] of f.items) {
            if (catSet && !catSet.has(cid)) continue;
            const share = gross > 0 ? c.gross / gross : 1 / f.items.size;
            res.set(cid, { n: c.n, gross: c.gross, net: bill * share, thanks: c.thanks });
        }
        if (!f.items.size && !catSet) res.set(0, { n: 0, gross: 0, net: num(f.actual), thanks: 0 });  // bill without items
        else if (res.has(0) && gross <= 0 && f.items.size === 1) res.get(0).net = num(f.actual);
        if (!res.size) continue;
        out.push({ pid: f.pid, did: f.did, mk: f.mk, cats: res });
    }
    return out;
};

// ─────────────────────────────────────────────────────────────────────────────
// Reference data
// ─────────────────────────────────────────────────────────────────────────────

const getCategories = async () => (await db().query('SELECT Id, Name FROM Category ORDER BY Name'))[0];

const getDoctors = async () => {
    const [rows] = await db().query('SELECT * FROM DoctorDetails');
    return rows.map(d => ({
        id: d.Id, name: fullName(d) || `Doctor #${d.Id}`,
        spec: d.SpecialistIn || '', phone: String(d.MobileNumberFirst || '').replace(/\D/g, ''),
        createdOn: d.CreatedOn ? moment(d.CreatedOn).format('YYYY-MM-DD') : null,
    }));
};

/** doctorId → current MR id (0 = none). Latest row by Id wins (same rule as the doctor page). */
const getAssignments = async () => {
    const rows = await optional(db().query(`
        SELECT m.DoctorId, m.MarketingPersonId FROM MarketingDoctorAssociation m
        JOIN (SELECT DoctorId, MAX(Id) AS Id FROM MarketingDoctorAssociation GROUP BY DoctorId) l ON l.Id = m.Id`).then(r => r[0]), []);
    return new Map(rows.map(r => [r.DoctorId, num(r.MarketingPersonId)]));
};

const getAreas = async () => {
    const rows = await optional(db().query(`
        SELECT DoctorId, GROUP_CONCAT(DISTINCT NULLIF(TRIM(Area), '') ORDER BY Area SEPARATOR ', ') AS Areas
        FROM DoctorVisitingSchedule GROUP BY DoctorId`).then(r => r[0]), []);
    return new Map(rows.map(r => [r.DoctorId, r.Areas || '']));
};

const getUsers = async (ids) => {
    if (!ids.length) return new Map();
    const [rows] = await db().query('SELECT Id, FirstName, LastName FROM Users WHERE Id IN (?)', [ids]);
    return new Map(rows.map(u => [u.Id, fullName(u) || `User #${u.Id}`]));
};

/** Visits in the range per doctor+MR, and the last visit per doctor up to the end of the range. */
const getVisits = async (start, end) => {
    const [inRange, last] = await Promise.all([
        optional(db().query(`SELECT DoctorId, MarketingPersonId, COUNT(*) AS n FROM VisitLog
                             WHERE VisitedOn >= ? AND VisitedOn < ? AND (ReviewStatus IS NULL OR ReviewStatus <> 'rejected')
                             GROUP BY DoctorId, MarketingPersonId`, [start, end]).then(r => r[0]),
                 null),
        optional(db().query(`SELECT DoctorId, DATE_FORMAT(MAX(VisitedOn), '%Y-%m-%d') AS lastOn FROM VisitLog
                             WHERE VisitedOn < ? AND (ReviewStatus IS NULL OR ReviewStatus <> 'rejected') GROUP BY DoctorId`, [end]).then(r => r[0]),
                 null),
    ]);
    if (inRange === null) {   // VisitLog without ReviewStatus → plain counts
        const a = await optional(db().query(`SELECT DoctorId, MarketingPersonId, COUNT(*) AS n FROM VisitLog WHERE VisitedOn >= ? AND VisitedOn < ? GROUP BY DoctorId, MarketingPersonId`, [start, end]).then(r => r[0]), []);
        const b = await optional(db().query(`SELECT DoctorId, DATE_FORMAT(MAX(VisitedOn), '%Y-%m-%d') AS lastOn FROM VisitLog WHERE VisitedOn < ? GROUP BY DoctorId`, [end]).then(r => r[0]), []);
        return { available: a.length > 0 || b.length > 0, rows: a, last: new Map(b.map(r => [r.DoctorId, r.lastOn])) };
    }
    return { available: true, rows: inRange, last: new Map((last || []).map(r => [r.DoctorId, r.lastOn])) };
};

/** First and last referral of every doctor up to the end of the range (same category filter). */
const getLifetime = async (end, cats) => {
    let sql = `SELECT p.DoctorId, DATE_FORMAT(MIN(p.RegisteredOn), '%Y-%m-%d') AS firstOn,
                      DATE_FORMAT(MAX(p.RegisteredOn), '%Y-%m-%d') AS lastOn, COUNT(*) AS n
               FROM PatientDetails p WHERE p.Status = 1 AND p.DoctorId IS NOT NULL AND p.DoctorId > 0 AND p.RegisteredOn < ?`;
    const params = [end];
    if (cats.length) {
        sql += ` AND (EXISTS (SELECT 1 FROM PatientTestRefference ptr JOIN MainTestTable mt ON mt.Id = ptr.TestId
                              WHERE ptr.PatientId = p.Id AND mt.CategoryId IN (?)))`;
        params.push(cats);
    }
    sql += ' GROUP BY p.DoctorId';
    const [rows] = await db().query(sql, params);
    return new Map(rows.map(r => [r.DoctorId, r]));
};

// ─────────────────────────────────────────────────────────────────────────────
// The report
// ─────────────────────────────────────────────────────────────────────────────

const Z = () => [0, 0, 0, 0];                // [patients, tests, revenue, thanks]
const addTo = (acc, c, countPatient) => { if (countPatient) acc[0] += 1; acc[1] += c.n; acc[2] += c.net; acc[3] += c.thanks; };
const sumCats = (cats) => { const s = { n: 0, net: 0, thanks: 0 }; cats.forEach(c => { s.n += c.n; s.net += c.net; s.thanks += c.thanks; }); return s; };
const round = (a) => [a[0], a[1], Math.round(a[2]), Math.round(a[3])];

const totalsOf = (facts, keep) => {
    const t = Z(); const docs = new Set(); let walkin = 0;
    for (const f of facts) {
        if (!keep(f.did)) continue;
        addTo(t, sumCats(f.cats), true);
        if (f.did) docs.add(f.did); else walkin++;
    }
    return { patients: t[0], tests: t[1], revenue: Math.round(t[2]), thanks: Math.round(t[3]), doctors: docs.size, walkin };
};

const getReport = async (query = {}, now = moment()) => {
    const f      = readFilters(query, now);
    const months = buildMonths(f);
    const R      = rangeOf(f.from, f.to, f.now);
    const nM     = months.length;
    const mIdx   = new Map(months.map((m, i) => [m.key, i]));

    // previous period of the same length (for the KPI arrows)
    const pTo   = f.from.clone().subtract(1, 'month');
    const pFrom = pTo.clone().subtract(nM - 1, 'months');
    const P     = rangeOf(pFrom, pTo, f.now);

    const [categories, doctors, assign, areas, facts, prevFacts, lifetime, visits] = await Promise.all([
        getCategories(), getDoctors(), getAssignments(), getAreas(),
        loadFacts({ start: R.start, end: R.end, cutoff: f.cutoff, cats: f.cats }),
        loadFacts({ start: P.start, end: P.end, cutoff: f.cutoff, cats: f.cats }),
        getLifetime(R.end, f.cats),
        getVisits(R.start, R.end),
    ]);

    const mrOf = (did) => assign.get(did) || 0;
    const keep = (did) => {
        if (f.mr === '') return true;
        if (!did) return false;                                  // walk-ins have no MR
        return f.mr === 'none' ? mrOf(did) === 0 : mrOf(did) === f.mr;
    };

    // ── aggregate ──
    const D = new Map();       // did → { m: [[4]...], cats: {cid: [4]}, tot: [4] }
    const monthTot = months.map(Z), walkinM = months.map(Z);
    const catM = new Map();    // cid → months [[4]]
    for (const fa of facts) {
        if (!keep(fa.did)) continue;
        const i = mIdx.get(fa.mk); if (i == null) continue;
        const s = sumCats(fa.cats);
        addTo(monthTot[i], s, true);
        for (const [cid, c] of fa.cats) {
            if (!catM.has(cid)) catM.set(cid, months.map(Z));
            addTo(catM.get(cid)[i], c, true);
        }
        if (!fa.did) { addTo(walkinM[i], s, true); continue; }
        let d = D.get(fa.did);
        if (!d) D.set(fa.did, d = { m: months.map(Z), cats: {}, tot: Z() });
        addTo(d.m[i], s, true); addTo(d.tot, s, true);
        for (const [cid, c] of fa.cats) addTo(d.cats[cid] = d.cats[cid] || Z(), c, true);
    }

    // ── visits ──
    const visitsByDoc = new Map(), visitsByMr = new Map(), docsVisitedByMr = new Map();
    for (const v of visits.rows) {
        visitsByDoc.set(v.DoctorId, (visitsByDoc.get(v.DoctorId) || 0) + num(v.n));
        const mr = num(v.MarketingPersonId);
        visitsByMr.set(mr, (visitsByMr.get(mr) || 0) + num(v.n));
        if (!docsVisitedByMr.has(mr)) docsVisitedByMr.set(mr, new Set());
        docsVisitedByMr.get(mr).add(v.DoctorId);
    }

    const asOf = R.asOf.clone();
    const daysSince = (d) => (d ? asOf.diff(moment(d, 'YYYY-MM-DD'), 'days') : null);
    const docById = new Map(doctors.map(d => [d.id, d]));

    // MR names
    const mrIds = new Set([...assign.values()].filter(Boolean));
    visits.rows.forEach(v => { if (num(v.MarketingPersonId)) mrIds.add(num(v.MarketingPersonId)); });
    if (typeof f.mr === 'number') mrIds.add(f.mr);
    const users = await getUsers([...mrIds]);
    const mrName = (id) => (id ? users.get(id) || `User #${id}` : '');

    // ── doctor rows: everyone with business in the range + recently lost ones ──
    const startM = moment(R.start);
    const rows = [];
    const consider = new Set([...D.keys()]);
    for (const [did, lt] of lifetime) {
        if (!keep(did)) continue;
        if (daysSince(lt.lastOn) <= 365) consider.add(did);     // stopped within the last year → show as lost
    }
    for (const did of consider) {
        const doc = docById.get(did) || { id: did, name: `Doctor #${did}`, spec: '', phone: '' };
        const d   = D.get(did) || { m: months.map(Z), cats: {}, tot: Z() };
        const lt  = lifetime.get(did) || {};
        const series = d.m.map((v, i) => v[0] * months[i].factor);   // patients, running month projected
        // ★1 a running month with < MIN_PROJECT_DAYS days is too short to project → compare the last full month
        const cut    = nM > 1 && months[nM - 1].partial && months[nM - 1].covered < MIN_PROJECT_DAYS ? nM - 1 : nM;
        const lastI  = cut - 1;
        const last   = series[lastI];
        const prior  = series.slice(0, lastI);
        const usual  = prior.length ? prior.reduce((a, b) => a + b, 0) / prior.length : null;
        const ds     = daysSince(lt.lastOn);
        const isNew  = lt.firstOn && moment(lt.firstOn).isSameOrAfter(startM);

        let seg = 'steady', why = '';
        if (ds != null && ds > LOST_DAYS) { seg = 'lost'; why = `No patient for ${ds} days`; }
        else if (ds != null && ds > RISK_DAYS) { seg = 'risk'; why = `No patient for ${ds} days`; }
        else if (usual != null && usual >= 2 && last < usual * DROP_RATIO) {
            seg = 'risk'; why = `${months[lastI].partial ? 'On track for' : 'Sent'} ${Math.round(last)} in ${months[lastI].label}, usually ${Math.round(usual)}`;
        }
        else if (isNew) { seg = 'new'; why = `First patient on ${moment(lt.firstOn).format('D MMM')}`; }
        else if (usual != null && ((usual > 0 && last >= usual * GROW_RATIO && last - usual >= 2) || (usual === 0 && last >= 3))) {
            seg = 'growing'; why = `${Math.round(last)} in ${months[lastI].label} vs usual ${Math.round(usual)}`;
        }

        const mr = mrOf(did);
        rows.push({
            id: did, name: doc.name, spec: doc.spec, phone: doc.phone, area: areas.get(did) || '',
            mrId: mr, mr: mrName(mr),
            m: d.m.map(round), tot: round(d.tot),
            cats: Object.fromEntries(Object.entries(d.cats).map(([k, v]) => [k, round(v)])),
            firstOn: lt.firstOn || null, lastOn: lt.lastOn || null, daysSince: ds,
            usual: usual == null ? null : r2(usual), latest: r2(last),
            trend: usual ? Math.round((last - usual) / usual * 100) : null,
            seg, why,
            visits: visitsByDoc.get(did) || 0,
            lastVisit: visits.last.get(did) || null,
            daysSinceVisit: daysSince(visits.last.get(did)),
        });
    }

    // ABC class by revenue (A = doctors making the first 70 % of revenue, B = next 20 %, C = rest)
    const revTotal = rows.reduce((a, r) => a + r.tot[2], 0);
    let cum = 0;
    [...rows].sort((a, b) => b.tot[2] - a.tot[2]).forEach(r => {
        const before = cum; cum += r.tot[2];
        r.abc = r.tot[2] <= 0 ? 'C' : (revTotal && before / revTotal < 0.7 ? 'A' : (revTotal && before / revTotal < 0.9 ? 'B' : 'C'));
    });
    rows.sort((a, b) => b.tot[2] - a.tot[2] || b.tot[0] - a.tot[0] || a.name.localeCompare(b.name));

    // ── prospects: doctors who never referred (or not in over a year) ──
    const prospects = [];
    for (const doc of doctors) {
        if (consider.has(doc.id) || !keep(doc.id)) continue;
        const lt = lifetime.get(doc.id);
        const mr = mrOf(doc.id);
        prospects.push({
            id: doc.id, name: doc.name, spec: doc.spec, phone: doc.phone, area: areas.get(doc.id) || '',
            mrId: mr, mr: mrName(mr),
            lastOn: lt ? lt.lastOn : null, everReferred: !!lt,
            visits: visitsByDoc.get(doc.id) || 0, lastVisit: visits.last.get(doc.id) || null,
            createdOn: doc.createdOn,
        });
    }
    prospects.sort((a, b) => b.visits - a.visits || a.name.localeCompare(b.name));

    // ── cross-sell: categories most active doctors send, but this doctor never does ──
    const crossSell = [];
    if (!f.cats.length) {
        // Compared with doctors of the SAME speciality when there are enough of them (a gynaecologist is
        // compared with gynaecologists), otherwise with all active doctors. A category is suggested when at
        // least half of those peers send it and this doctor sent none.
        const big = rows.filter(r => r.tot[0] >= CROSS_MIN);
        const catName = new Map(categories.map(c => [String(c.Id), c.Name]));
        const sends = (r, c) => r.cats[c] && r.cats[c][0] > 0;
        const specKey = (r) => (r.spec || '').trim().toUpperCase();
        big.forEach(r => {
            let peers = big.filter(p => p !== r && specKey(p) && specKey(p) === specKey(r));
            let peerLabel = r.spec ? `other ${r.spec}s` : 'other doctors';
            if (peers.length < 2) { peers = big.filter(p => p !== r); peerLabel = 'other active doctors'; }
            if (peers.length < 2) return;
            const missing = [];
            categories.forEach(c => {
                const k = String(c.Id);
                if (sends(r, k)) return;
                const n = peers.filter(p => sends(p, k)).length;
                if (n / peers.length >= 0.5) missing.push({ name: c.Name, share: Math.round(n / peers.length * 100), peers: peers.length });
            });
            if (!missing.length) return;
            missing.sort((a, b) => b.share - a.share);
            crossSell.push({
                id: r.id, name: r.name, spec: r.spec, phone: r.phone, mr: r.mr, mrId: r.mrId, patients: r.tot[0], peerLabel,
                sends: Object.keys(r.cats).filter(c => sends(r, c)).sort((a, b) => r.cats[b][0] - r.cats[a][0]).map(c => catName.get(c) || 'Other'),
                missing: missing.slice(0, 3),
            });
        });
        crossSell.sort((a, b) => b.patients - a.patients);
    }

    // ── MR team ──
    const mrRows = new Map();
    const mrRow = (id) => {
        if (!mrRows.has(id)) mrRows.set(id, { id, name: id ? mrName(id) : 'Not assigned', assigned: 0, active: 0, tot: Z(), visits: 0, visited: 0, segs: { lost: 0, risk: 0, new: 0, growing: 0 }, prospects: 0 });
        return mrRows.get(id);
    };
    for (const [did, mr] of assign) { if (docById.has(did) && keep(did)) mrRow(mr).assigned++; }
    doctors.forEach(d => { if (!assign.has(d.id) && keep(d.id)) mrRow(0).assigned++; });
    rows.forEach(r => {
        const m = mrRow(r.mrId);
        if (r.tot[0] > 0) m.active++;
        r.tot.forEach((v, i) => { m.tot[i] += v; });
        if (m.segs[r.seg] != null) m.segs[r.seg]++;
    });
    prospects.forEach(p => { mrRow(p.mrId).prospects++; });
    for (const [mr, n] of visitsByMr) {
        if (f.mr !== '' && !(f.mr === mr || (f.mr === 'none' && mr === 0))) continue;
        const m = mrRow(mr); m.visits += n; m.visited += docsVisitedByMr.get(mr).size;
    }
    const mrList = [...mrRows.values()].map(m => ({ ...m, tot: round(m.tot) }))
        .sort((a, b) => (a.id === 0) - (b.id === 0) || b.tot[2] - a.tot[2]);

    // ── categories ──
    const catName = new Map(categories.map(c => [c.Id, c.Name]));
    const catRows = [...catM.entries()].map(([cid, m]) => {
        const tot = Z(); m.forEach(v => v.forEach((x, i) => { tot[i] += x; }));
        return { id: cid, name: cid ? (catName.get(cid) || `Category #${cid}`) : 'No test', m: m.map(round), tot: round(tot) };
    }).sort((a, b) => b.tot[2] - a.tot[2]);

    // ── KPIs ──
    const cur  = totalsOf(facts, keep);
    const prev = totalsOf(prevFacts, keep);
    cur.newDoctors = rows.filter(r => r.firstOn && moment(r.firstOn).isSameOrAfter(startM)).length;

    const mrOptions = [...users.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));

    return {
        filters: {
            from: f.from.format('YYYY-MM'), to: f.to.format('YYYY-MM'), cutoff: f.cutoff, cats: f.cats, mr: f.mr,
            today: f.now.date(), asOf: asOf.format('YYYY-MM-DD'),
            rangeLabel: `${f.from.format('MMM YYYY')} – ${f.to.format('MMM YYYY')}${f.cutoff ? ` (day 1–${f.cutoff} of each month)` : ''}`,
            prevLabel: `${pFrom.format('MMM YY')} – ${pTo.format('MMM YY')}`,
        },
        months, categories: categories.map(c => ({ id: c.Id, name: c.Name })),
        monthOptions: monthOptions(f.now), presets: presets(f.now), mrOptions,
        kpi: { cur, prev },
        monthTotals: monthTot.map(round), walkinMonths: walkinM.map(round),
        doctors: rows, prospects, crossSell, mrs: mrList, catRows,
        visitsAvailable: visits.available,
        trendMonth: months.length ? months[(months.length > 1 && months[months.length - 1].partial && months[months.length - 1].covered < MIN_PROJECT_DAYS) ? months.length - 2 : months.length - 1].label : '',
        rules: { MIN_PROJECT_DAYS, LOST_DAYS, RISK_DAYS, DROP: Math.round(DROP_RATIO * 100), GROW: Math.round((GROW_RATIO - 1) * 100), NO_VISIT_DAYS, CROSS_MIN },
    };
};

// ─────────────────────────────────────────────────────────────────────────────
// One doctor: month × category and the latest patients
// ─────────────────────────────────────────────────────────────────────────────

const getDoctorDetail = async (doctorId, query = {}, now = moment()) => {
    const id = parseInt(doctorId, 10);
    if (!(id > 0)) { const e = new Error('Doctor not found.'); e.isUserError = true; throw e; }
    const f = readFilters(query, now);
    const months = buildMonths(f);
    const R = rangeOf(f.from, f.to, f.now);
    const mIdx = new Map(months.map((m, i) => [m.key, i]));

    const where = ['p.Status = 1', 'p.DoctorId = ?', 'p.RegisteredOn >= ?', 'p.RegisteredOn < ?'];
    const params = [id, R.start, R.end];
    if (f.cutoff) { where.push('DAY(p.RegisteredOn) <= ?'); params.push(f.cutoff); }
    if (f.cats.length) {
        where.push(`EXISTS (SELECT 1 FROM PatientTestRefference x JOIN MainTestTable xm ON xm.Id = x.TestId WHERE x.PatientId = p.Id AND xm.CategoryId IN (?))`);
        params.push(f.cats);
    }

    const [categories, facts, [recent]] = await Promise.all([
        getCategories(),
        loadFacts({ start: R.start, end: R.end, cutoff: f.cutoff, cats: f.cats, doctorId: id }),
        db().query(`
            SELECT p.Id, p.Name, DATE_FORMAT(p.RegisteredOn, '%d-%m-%Y') AS Date, p.ActualAmount,
                   (SELECT GROUP_CONCAT(mt.TestName ORDER BY ptr.Id SEPARATOR ', ')
                      FROM PatientTestRefference ptr JOIN MainTestTable mt ON mt.Id = ptr.TestId WHERE ptr.PatientId = p.Id) AS Tests
            FROM PatientDetails p WHERE ${where.join(' AND ')}
            ORDER BY p.RegisteredOn DESC, p.Id DESC LIMIT 30`, params),
    ]);
    let thanks = [];
    if (recent.length) {
        const ids = recent.map(r => r.Id);
        thanks = await optional(db().query(`SELECT PatientId, Thanks FROM Referrals WHERE DoctorId = ? AND PatientId IN (?) AND Status = 'active'`, [id, ids]).then(r => r[0]), null);
        if (thanks === null) thanks = await optional(db().query(`SELECT PatientId, Thanks FROM Referrals WHERE DoctorId = ? AND PatientId IN (?)`, [id, ids]).then(r => r[0]), []);
    }
    const thanksBy = new Map(thanks.map(t => [t.PatientId, num(t.Thanks)]));

    const catName = new Map(categories.map(c => [c.Id, c.Name]));
    const grid = new Map();
    for (const fa of facts) {
        const i = mIdx.get(fa.mk); if (i == null) continue;
        for (const [cid, c] of fa.cats) {
            if (!grid.has(cid)) grid.set(cid, months.map(Z));
            addTo(grid.get(cid)[i], c, true);
        }
    }
    return {
        months,
        rows: [...grid.entries()].map(([cid, m]) => ({ id: cid, name: cid ? catName.get(cid) || `Category #${cid}` : 'No test', m: m.map(round) }))
                                 .sort((a, b) => b.m.reduce((s, v) => s + v[2], 0) - a.m.reduce((s, v) => s + v[2], 0)),
        recent: recent.map(r => ({ id: r.Id, name: r.Name, date: r.Date, tests: r.Tests || '', amount: Math.round(num(r.ActualAmount)), thanks: Math.round(thanksBy.get(r.Id) || 0) })),
    };
};

module.exports = { getReport, getDoctorDetail, readFilters, buildMonths };
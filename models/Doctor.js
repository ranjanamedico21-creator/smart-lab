'use strict';

/**
 * Doctor.js — referring doctors: register / edit, commissions (thanks), visiting schedule,
 * MR + reporting-doctor links, thanks reports.
 *
 * FIXES OVER THE OLD VERSION (real-life problems)
 *  Register / Edit
 *   1. Degree 3 / Degree 4 / Worked At were REQUIRED on the server although the form says optional
 *      → a doctor with only "MBBS" could never be registered.
 *   2. Editing a doctor (even only his phone) re-calculated EVERY test's thanks from the category %
 *      → custom test-wise thanks were silently wiped. Now only categories whose % really changed
 *      are re-priced; new tests that have no thanks row yet are added.
 *   3. Edit relied on ON DUPLICATE KEY without a unique key → duplicate commission rows each save,
 *      and wrote CreatedBy = UpdatedBy. Now explicit update / insert.
 *   4. A blank schedule row was saved as an empty schedule. Blank rows are ignored; half-filled
 *      rows, end-before-start, overlapping times on the same day are rejected with a clear message.
 *      (The old time check built "10:00:00:00Z" for saved times → Invalid Date → never caught anything.)
 *   5. Commission % came from req.body[<category name>] — breaks for names with [ ] and is
 *      not validated (any number, empty → SQL error "VALUES ()" ). Now commission[c<categoryId>],
 *      0–100, every category required.
 *   6. Duplicate doctors: same mobile number / same name is detected (the form warns live,
 *      the server asks for confirmation).
 *   7. "Dr." typed in the first name is removed; names are stored in Title Case; phone numbers
 *      are stored without spaces/dashes.
 *  Other
 *   8. getPreselectedMarketingPerson returned rows[0].ReportingDoctorId → always undefined.
 *   9. updateMarketingPerson never set AssociatedOn and could not un-assign.
 *  10. getDoctorName read result[0].DoctorName from [rows, fields] → always undefined.
 *  11. updateDoctorsThankTestWise used the callback API inside Promise.all → nothing awaited,
 *      errors returned as a "success" message. Now one transaction, errors thrown.
 *  12. Thanks reports used "RegisteredOn BETWEEN '2026-10-17' AND '2026-10-17'" → with a DATETIME
 *      column the last day (and "today") was always empty. Now >= from AND < to + 1 day.
 *  13. downloadAllDoctorThanks read query.FromDate but then parsed body.FromDate.
 *
 * SECURITY / MONEY PATCH (2026-10-25) — every change marked ★
 *  ★1  Double-click on "Register" (or two receptionists at once) created the same doctor twice:
 *      the duplicate check ran before the insert with nothing in between. Now one save at a time
 *      (GET_LOCK) and the check is repeated inside; same name AND same mobile can never be confirmed.
 *  ★2  Thanks reports counted REVERSED referrals (patient cancelled / moved to another doctor) →
 *      the old doctor was paid thanks for patients he no longer has. Only active referrals of the
 *      patient's current doctor, active patients.
 *  ★3  Individual report used SUM(DISTINCT Thanks) → two equal amounts counted once (only bites if the
 *      Referrals (DoctorId, PatientId) unique key is ever missing — fixed anyway).
 *  ★4  Test-wise thanks: no upper limit (₹5,000 thanks on a ₹800 test), tests without a thanks row
 *      reported "updated" but nothing was saved, junk test ids → SQL error. Now ≤ test price, upsert.
 *  ★5  Changing a category % (edit form or Update Thanks page) overwrote custom (negotiated) test
 *      thanks. Now only thanks that came from the old % are re-calculated (same rule as Category / Test).
 *  ★6  Update Thanks for a category the doctor had no % row for → % never saved, tests re-priced anyway.
 *  ★7  No audit at all for money settings: who changed a doctor's thanks / MR / reporting doctor / phone,
 *      when, from what to what. Now DoctorAuditLog (works without the table, with a warning).
 *  ★8  Two people editing the same doctor: the later save silently undid the earlier one.
 *      formVersion check (when the form sends it).
 *  ★9  Numbers: "0x10" was accepted as 16 %, "1e1" as 10 years; 1000 schedule rows = server hang.
 *  ★10 Any user id could be set as reporting doctor / MR; doctor id not checked (orphan rows).
 *  ★11 "ENT" / "DGO" in speciality became "Ent" / "Dgo".
 *  ★12 Report date range unlimited (10-year PDF = server out of memory). Max 366 days.
 */

const dbConnection    = require('../config/DBConnection');
const currDateAndTime = require('../helper/helper');
const Category        = require('../models/Category');
const moment          = require('moment');

const db      = () => (dbConnection.pool || dbConnection.connection).promise();
const getConn = () => db().getConnection();

const crypto          = require('crypto');

const userError = (msg, field) => { const e = new Error(msg); e.isUserError = true; if (field) e.field = field; return e; };
const nowStr    = () => moment().format('YYYY-MM-DD HH:mm:ss');
const createdOn = () => { try { return currDateAndTime.getCurrentDateAndTime()[0]; } catch (_) { return moment().format('YYYY-MM-DD'); } };

// ─────────────────────────────────────────────────────────────────────────────
// Form reading + validation (used by register AND edit)
// ─────────────────────────────────────────────────────────────────────────────

const SCHEDULE_DAYS  = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'AllDay'];
const FLAT_DISCOUNTS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 50];
const MAX_RATE       = 100;
const PHONE_RE       = /^\+?\d{10,15}$/;

const clean     = (v) => (v == null ? '' : String(Array.isArray(v) ? v[0] : v)).replace(/\s+/g, ' ').trim();
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s.'-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
// ★11 keeps short ALL-CAPS words (ENT, DGO, MD, ICU) as typed; everything else Title Case
const titleKeepAbbr = (s) => s.split(' ').map(w => (/^[A-Z&]{2,4}$/.test(w) ? w : titleCase(w))).join(' ');
// ★9 plain decimal numbers only ("0x10", "1e1", " 5 " tricks refused)
const DEC_RE   = /^\d{1,6}(\.\d{1,2})?$/;
const INT_RE   = /^\d{1,3}$/;
const MAX_SCHEDULES = 20;
const MAX_REPORT_DAYS = 366;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const toId = (v) => { const s2 = String(v == null ? '' : v).trim(); return /^\d{1,10}$/.test(s2) && Number(s2) > 0 ? Number(s2) : null; };
const stripDr   = (s) => s.replace(/^(dr\.?\s+|dr\.)+/i, '').trim();
const cleanPhone = (s) => clean(s).replace(/[\s\-().]/g, '');
const last10    = (p) => String(p || '').replace(/\D/g, '').slice(-10);

/** body['days'] or body['days[]'] (works with extended and simple body parsers), always an array. */
const arr = (body, name) => {
    let v = body[name];
    if (v === undefined) v = body[name + '[]'];
    if (v === undefined || v === null) return [];
    return Array.isArray(v) ? v : [v];
};

/** "14:30", "14:30:00", "2:30 PM" → minutes since midnight, or null. */
const toMinutes = (t) => {
    const s = String(t || '').trim().toUpperCase();
    let m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
    if (m) { const h = +m[1], mi = +m[2]; return h < 24 && mi < 60 ? h * 60 + mi : null; }
    m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/.exec(s);
    if (m) { let h = +m[1] % 12; const mi = +m[2]; if (m[3] === 'PM') h += 12; return mi < 60 && +m[1] <= 12 ? h * 60 + mi : null; }
    return null;
};
const hhmm  = (min) => String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
const h12   = (min) => moment().startOf('day').add(min, 'minutes').format('h:mm A');
const dayLabel = (d) => (d === 'AllDay' ? 'All days' : d);

/** Commission % sent for a category: commission[c<id>] (new form) or <category name> (old form). */
const readRate = (body, cat) => {
    const key = 'c' + cat.Id;
    if (body.commission && typeof body.commission === 'object' && body.commission[key] !== undefined) return body.commission[key];
    if (body[`commission[${key}]`] !== undefined) return body[`commission[${key}]`];
    return body[cat.Name];
};

/**
 * Reads and checks the doctor form.
 * Returns { data (DoctorDetails columns), schedules, commissions, values (to refill the form), errors [{field,msg}] }.
 */
const readDoctorForm = (body = {}, categories = []) => {
    const errors = [];
    const err = (field, msg) => errors.push({ field, msg });

    const v = {
        firstName:  stripDr(clean(body.firstName)),
        lastName:   clean(body.lastName),
        degree1:    clean(body.degree1), degree2: clean(body.degree2), degree3: clean(body.degree3), degree4: clean(body.degree4),
        specialistIn: clean(body.specialistIn),
        workedAt:   clean(body.workedAt),
        yearOfExperience: clean(body.yearOfExperience),
        registration: clean(body.registration),
        award:      clean(body.award),
        instruction: clean(body.instruction),
        mobileNumberFirst:  cleanPhone(body.mobileNumberFirst),
        mobileNumberSecond: cleanPhone(body.mobileNumberSecond),
        authorizeForBloodTest: clean(body.authorizeForBloodTest),
        flatDiscount: clean(body.flatDiscount),
        confirmDuplicate: clean(body.confirmDuplicate) === '1',
        schedules: [], commission: {},
    };

    // ── doctor details ──
    const NAME_RE = /^[A-Za-z][A-Za-z .'-]*$/;
    if (!v.firstName)                       err('firstName', 'Enter the first name.');
    else if (!NAME_RE.test(v.firstName))    err('firstName', 'First name can have letters, spaces, dot and hyphen only.');
    else if (v.firstName.length > 50)       err('firstName', 'First name is too long (max 50).');
    if (v.lastName && !NAME_RE.test(v.lastName)) err('lastName', 'Last name can have letters, spaces, dot and hyphen only.');
    else if (v.lastName.length > 50)        err('lastName', 'Last name is too long (max 50).');
    if (!v.degree1)                         err('degree1', 'Enter at least one degree (e.g. MBBS).');
    ['degree1', 'degree2', 'degree3', 'degree4'].forEach(k => {
        if (v[k].length > 20) err(k, 'Degree is too long (max 20).');
        else if (v[k] && !/^[A-Za-z0-9 .,()&'\/-]+$/.test(v[k])) err(k, 'Degree can have letters, numbers, dot, comma, brackets and hyphen only.');
    });
    ['workedAt', 'award'].forEach(k => { if (v[k].length > 255) err(k, `${k === 'award' ? 'Award' : 'Worked at'} is too long (max 255).`); });
    if (!v.specialistIn)                    err('specialistIn', 'Enter the speciality (e.g. Physician).');
    else if (v.specialistIn.length > 50)    err('specialistIn', 'Speciality is too long (max 50).');

    const yoe = INT_RE.test(v.yearOfExperience) ? Number(v.yearOfExperience) : NaN;   // ★9
    if (v.yearOfExperience === '')                          err('yearOfExperience', 'Enter years of experience (0 if new).');
    else if (!Number.isInteger(yoe) || yoe < 0 || yoe > 70) err('yearOfExperience', 'Years of experience must be a whole number from 0 to 70.');

    if (!v.mobileNumberFirst)                       err('mobileNumberFirst', 'Enter the mobile number.');
    else if (!PHONE_RE.test(v.mobileNumberFirst))   err('mobileNumberFirst', 'Mobile number must be 10–15 digits (e.g. 9876543210 or +919876543210).');
    if (v.mobileNumberSecond && !PHONE_RE.test(v.mobileNumberSecond)) err('mobileNumberSecond', 'Second mobile number must be 10–15 digits.');
    else if (v.mobileNumberSecond && last10(v.mobileNumberSecond) === last10(v.mobileNumberFirst)) err('mobileNumberSecond', 'Second number is the same as the first one.');

    if (!['1', '2'].includes(v.authorizeForBloodTest)) err('authorizeForBloodTest', 'Choose whether the doctor is authorised for blood tests.');
    if (!INT_RE.test(v.flatDiscount) || !FLAT_DISCOUNTS.includes(Number(v.flatDiscount))) err('flatDiscount', 'Choose the flat discount.');
    if (v.instruction.length > 255) err('instruction', 'Instruction is too long (max 255).');
    if (v.registration.length > 50) err('registration', 'Registration number is too long (max 50).');

    // ── visiting schedule ──
    const areas = arr(body, 'area'), days = arr(body, 'days'), starts = arr(body, 'startTimes'), ends = arr(body, 'endTimes');
    const n = Math.min(Math.max(areas.length, days.length, starts.length, ends.length), 200);
    const schedules = [];
    for (let i = 0; i < n; i++) {
        const row = { area: clean(areas[i]), day: clean(days[i]), start: clean(starts[i]), end: clean(ends[i]) };
        if (!row.area && !row.day && !row.start && !row.end) continue;          // blank row → ignore
        const idx = v.schedules.length;
        v.schedules.push(row);
        const sMin = toMinutes(row.start), eMin = toMinutes(row.end);
        const label = `Schedule ${idx + 1}`;
        if (!row.area)                          err(`schedule.${idx}`, `${label}: enter the area.`);
        else if (row.area.length > 60)          err(`schedule.${idx}`, `${label}: area is too long (max 60).`);
        if (!SCHEDULE_DAYS.includes(row.day))   err(`schedule.${idx}`, `${label}: choose the day.`);
        if (sMin == null || eMin == null)       err(`schedule.${idx}`, `${label}: choose start and end time.`);
        else if (eMin <= sMin)                  err(`schedule.${idx}`, `${label}: end time must be after start time.`);
        if (row.area && SCHEDULE_DAYS.includes(row.day) && sMin != null && eMin != null && eMin > sMin) {
            schedules.push({ idx, area: titleKeepAbbr(row.area), day: row.day, startMin: sMin, endMin: eMin });
        }
    }
    if (!v.schedules.length) err('schedule', 'Add at least one visiting schedule (area, day and time).');
    if (v.schedules.length > MAX_SCHEDULES) { err('schedule', `At most ${MAX_SCHEDULES} visiting schedules.`); schedules.length = 0; }   // ★9
    // same day (or "All days") with overlapping times → he cannot be at two places
    for (let a = 0; a < schedules.length; a++) {
        for (let b = a + 1; b < schedules.length; b++) {
            const x = schedules[a], y = schedules[b];
            const sameDay = x.day === y.day || x.day === 'AllDay' || y.day === 'AllDay';
            if (sameDay && x.startMin < y.endMin && y.startMin < x.endMin) {
                err(`schedule.${y.idx}`, `Schedule ${y.idx + 1} overlaps schedule ${x.idx + 1} (${dayLabel(x.day)} ${h12(x.startMin)}–${h12(x.endMin)}).`);
            }
        }
    }

    // ── commission % per category ──
    const commissions = [];
    categories.forEach(cat => {
        const raw = clean(readRate(body, cat));
        v.commission['c' + cat.Id] = raw;
        const rate = DEC_RE.test(raw) ? Number(raw) : NaN;    // ★9
        if (raw === '')                                              err(`commission.c${cat.Id}`, `Choose the thanks % for ${cat.Name}.`);
        else if (!Number.isFinite(rate) || rate < 0 || rate > MAX_RATE) err(`commission.c${cat.Id}`, `Thanks % for ${cat.Name} must be 0 to ${MAX_RATE}.`);
        else commissions.push({ categoryId: Number(cat.Id), name: cat.Name, rate });
    });
    if (!categories.length) err('commission', 'No test categories exist yet. Create the categories first.');

    const data = {
        FirstName: titleCase(v.firstName),
        LastName: v.lastName ? titleCase(v.lastName) : '',
        Degree1: v.degree1, Degree2: v.degree2, Degree3: v.degree3, Degree4: v.degree4,
        SpecialistIn: v.specialistIn ? titleKeepAbbr(v.specialistIn) : '',
        WorkedAt: v.workedAt,
        YearOfExperience: Number.isInteger(yoe) ? yoe : 0,
        Registration: v.registration,
        AuthorizedForBloodTest: Number(v.authorizeForBloodTest) || 2,
        Award: v.award,
        Instruction: v.instruction,
        FlatDiscount: Number(v.flatDiscount) || 0,
        MobileNumberFirst: v.mobileNumberFirst,
        MobileNumberSecond: v.mobileNumberSecond,
    };
    return {
        data, commissions, errors, values: v,
        schedules: schedules.map(s => ({ area: s.area, day: s.day, start: hhmm(s.startMin), end: hhmm(s.endMin) })),
    };
};

/** Old API kept for other callers: returns [{ msg }]. */
const validateUserInput = (req) => readDoctorForm(req.body || {}, []).errors
    .filter(e => !e.field.startsWith('commission'))
    .map(e => ({ msg: e.msg }));

/** Values for the edit form from the saved doctor. */
const toFormValues = (doctor, schedules = [], categoryRates = []) => {
    const t = (x) => (x == null ? '' : String(x).slice(0, 5));
    let flat = doctor.FlatDiscount == null ? '' : String(Number(doctor.FlatDiscount));
    let legacyFlatDiscount = false;
    if (flat === '1') { flat = '0'; legacyFlatDiscount = true; }     // old edit form saved "0%" as 1
    const commission = {};
    categoryRates.forEach(r => { commission['c' + r.CategoryId] = r.CommissionRate == null ? '' : String(Number(r.CommissionRate)); });
    return {
        firstName: doctor.FirstName || '', lastName: doctor.LastName || '',
        degree1: doctor.Degree1 || '', degree2: doctor.Degree2 || '', degree3: doctor.Degree3 || '', degree4: doctor.Degree4 || '',
        specialistIn: doctor.SpecialistIn || '', workedAt: doctor.WorkedAt || '',
        yearOfExperience: doctor.YearOfExperience == null ? '' : String(doctor.YearOfExperience),
        registration: doctor.Registration || '', award: doctor.Award || '', instruction: doctor.Instruction || '',
        mobileNumberFirst: doctor.MobileNumberFirst || '', mobileNumberSecond: doctor.MobileNumberSecond || '',
        authorizeForBloodTest: doctor.AuthorizedForBloodTest == null ? '' : String(doctor.AuthorizedForBloodTest),
        flatDiscount: flat, legacyFlatDiscount,
        schedules: schedules.map(s => ({ area: s.Area || '', day: s.DayOfWeek || '', start: t(s.StartTime), end: t(s.EndTime) })),
        commission,
    };
};

/** Doctor + schedule + category % for the edit page (null if the doctor does not exist). */
const getDoctorFormData = async (doctorId) => {
    const id = parseInt(doctorId, 10);
    if (!Number.isInteger(id) || id <= 0) return null;
    const [[docRows], [schedules], [rates]] = await Promise.all([
        db().query('SELECT * FROM DoctorDetails WHERE Id = ?', [id]),
        db().query('SELECT * FROM DoctorVisitingSchedule WHERE DoctorId = ? ORDER BY Id', [id]),
        db().query('SELECT CategoryId, CommissionRate FROM DoctorCategoryCommission WHERE DoctorId = ?', [id]),
    ]);
    if (!docRows.length) return null;
    return { doctor: docRows[0], values: toFormValues(docRows[0], schedules, rates), originalRates: rates,
             version: formVersion(docRows[0], schedules, rates) };
};

/**
 * ★8 Fingerprint of what the edit form showed (doctor + schedules + category %).
 * The form sends it back as hidden "formVersion"; if the doctor changed meanwhile the save is refused.
 */
function formVersion(doctor, schedules = [], rates = []) {
    const pickDoc = {};
    Object.keys(doctor || {}).sort().forEach(k => { const x = doctor[k]; pickDoc[k] = x instanceof Date ? x.toISOString() : x == null ? null : String(x); });
    const sch = schedules.map(r => [r.DayOfWeek, String(r.StartTime).slice(0, 5), String(r.EndTime).slice(0, 5), r.Area]).sort();
    const rt  = rates.map(r => [Number(r.CategoryId), Number(r.CommissionRate)]).sort((a, b) => a[0] - b[0]);
    return crypto.createHash('sha1').update(JSON.stringify([pickDoc, sch, rt])).digest('hex').slice(0, 16);
}

const loadVersion = async (conn, doctorId) => {
    const [[docRows], [schedules], [rates]] = await Promise.all([
        conn.query('SELECT * FROM DoctorDetails WHERE Id = ?', [doctorId]),
        conn.query('SELECT * FROM DoctorVisitingSchedule WHERE DoctorId = ? ORDER BY Id', [doctorId]),
        conn.query('SELECT CategoryId, CommissionRate FROM DoctorCategoryCommission WHERE DoctorId = ?', [doctorId]),
    ]);
    return docRows.length ? formVersion(docRows[0], schedules, rates) : null;
};

// ★7 audit — DoctorAuditLog (see 2026-10-25_doctor_security.sql). Never blocks the save if the table is missing.
let auditWarned = false;
const audit = async (exec, rows) => {
    const list = (Array.isArray(rows) ? rows : [rows]).filter(Boolean);
    if (!list.length) return;
    try {
        await exec.query(`INSERT INTO DoctorAuditLog (DoctorId, Action, CategoryId, TestId, OldValue, NewValue, Detail, ChangedBy, ChangedAt) VALUES ?`,
            [list.map(r => [r.doctorId, r.action, r.categoryId || null, r.testId || null,
                r.oldValue == null ? null : String(r.oldValue).slice(0, 255), r.newValue == null ? null : String(r.newValue).slice(0, 255),
                r.detail ? JSON.stringify(r.detail).slice(0, 60000) : null, r.by || null, nowStr()])]);
    } catch (e) {
        if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
        if (!auditWarned) { auditWarned = true; console.warn('[Doctor] DoctorAuditLog table missing — run 2026-10-25_doctor_security.sql (changes are not audited).'); }
    }
};

/** ★1 one doctor save at a time (GET_LOCK is per connection → same conn for the whole save). */
const withSaveLock = async (fn) => {
    const conn = await getConn();
    let locked = false;
    try {
        const [[l]] = await conn.query("SELECT GET_LOCK('smartlab_doctor_save', 15) AS ok");
        if (Number(l.ok) !== 1) throw userError('Another doctor is being saved right now. Please press Save again.');
        locked = true;
        return await fn(conn);
    } finally {
        if (locked) await conn.query("SELECT RELEASE_LOCK('smartlab_doctor_save')").catch(() => {});
        conn.release();
    }
};

/** Suggestions for the form (areas / specialities / degrees already used) — keeps names consistent. */
const getFormLookups = async () => {
    const pick = (rows, k) => rows.map(r => r[k]).filter(Boolean).map(String);
    const [[areas], [specs], [degs]] = await Promise.all([
        db().query(`SELECT DISTINCT TRIM(Area) AS v FROM DoctorVisitingSchedule WHERE Area IS NOT NULL AND TRIM(Area) <> '' ORDER BY v LIMIT 300`),
        db().query(`SELECT DISTINCT TRIM(SpecialistIn) AS v FROM DoctorDetails WHERE SpecialistIn IS NOT NULL AND TRIM(SpecialistIn) <> '' ORDER BY v LIMIT 200`),
        db().query(`SELECT v FROM (SELECT TRIM(Degree1) AS v FROM DoctorDetails UNION SELECT TRIM(Degree2) FROM DoctorDetails
                    UNION SELECT TRIM(Degree3) FROM DoctorDetails UNION SELECT TRIM(Degree4) FROM DoctorDetails) x
                    WHERE v IS NOT NULL AND v <> '' ORDER BY v LIMIT 200`),
    ]);
    const common = ['MBBS', 'MD', 'MS', 'DNB', 'DM', 'MCh', 'BDS', 'MDS', 'BAMS', 'BHMS', 'BUMS', 'DGO', 'DCH', 'DA', 'DMRD', 'FRCS', 'MRCP'];
    const uniq = (list) => [...new Map(list.map(x => [x.toLowerCase(), x])).values()];
    return { areas: uniq(pick(areas, 'v')), specialities: uniq(pick(specs, 'v')), degrees: uniq([...common, ...pick(degs, 'v')]) };
};

/**
 * Other doctors with the same mobile number (any of the two) or the same full name.
 * excludeId → the doctor being edited.
 */
const findDuplicates = async ({ firstName, lastName, mobiles = [] }, excludeId, exec = null) => {
    const nums = [...new Set(mobiles.map(last10).filter(x => x.length === 10))];
    const fn = clean(stripDr(clean(firstName))).toLowerCase(), ln = clean(lastName).toLowerCase();
    const conds = [], params = [];
    const digits = (col) => `RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(${col},''),' ',''),'-',''),'+',''),'(',''),')',''), 10)`;
    if (nums.length) { conds.push(`${digits('MobileNumberFirst')} IN (?) OR ${digits('MobileNumberSecond')} IN (?)`); params.push(nums, nums); }
    if (fn) { conds.push(`(LOWER(TRIM(FirstName)) = ? AND LOWER(TRIM(COALESCE(LastName,''))) = ?)`); params.push(fn, ln); }
    if (!conds.length) return [];
    let sql = `SELECT Id, FirstName, LastName, SpecialistIn, MobileNumberFirst, MobileNumberSecond FROM DoctorDetails WHERE (${conds.join(' OR ')})`;
    const ex = parseInt(excludeId, 10);
    if (Number.isInteger(ex) && ex > 0) { sql += ' AND Id <> ?'; params.push(ex); }
    const [rows] = await (exec || db()).query(sql + ' ORDER BY Id DESC LIMIT 5', params);
    return rows.map(r => {
        const samePhone = nums.length && [last10(r.MobileNumberFirst), last10(r.MobileNumberSecond)].some(x => nums.includes(x));
        const sameName = fn && String(r.FirstName || '').trim().toLowerCase() === fn && String(r.LastName || '').trim().toLowerCase() === ln;
        return {
            id: r.Id, name: `Dr. ${[r.FirstName, r.LastName].filter(Boolean).join(' ')}`.trim(), spec: r.SpecialistIn || '',
            mobile: r.MobileNumberFirst || '', reason: samePhone && sameName ? 'same name and mobile' : samePhone ? 'same mobile number' : 'same name',
            exact: !!(samePhone && sameName),
        };
    });
};

/** ★1 same name AND same mobile = the same doctor → can never be "confirmed" (stops double-click duplicates). */
const exactDuplicateMessage = (dups) => {
    const d = dups.find(x => x.exact);
    return d ? `${d.name} with mobile ${d.mobile} is already registered (doctor #${d.id}). Open his page instead of registering again.` : '';
};

const describeDuplicates = (dups) =>
    `Already registered: ${dups.map(d => `${d.name} (${d.reason}${d.mobile ? ', ' + d.mobile : ''})`).join('; ')}. ` +
    'If this is a different doctor, tick "This is a different doctor" and save again.';

// ─────────────────────────────────────────────────────────────────────────────
// Register / update
// ─────────────────────────────────────────────────────────────────────────────

const insertSchedules = async (conn, doctorId, schedules) => {
    if (!schedules.length) return;
    await conn.query('INSERT INTO DoctorVisitingSchedule (DoctorId, DayOfWeek, StartTime, EndTime, Area) VALUES ?',
        [schedules.map(s => [doctorId, s.day, s.start, s.end, s.area])]);
};

/** Thanks rows for tests of this category that the doctor does not have yet (new tests). */
const addMissingTestThanks = async (conn, doctorId, categoryId, rate) => {
    const [r] = await conn.query(`
        INSERT INTO DoctorTestCommission (DoctorId, TestId, Commission)
        SELECT ?, t.Id, ROUND(t.Price * ? / 100, 2) FROM MainTestTable t
        WHERE t.CategoryId = ? AND NOT EXISTS (SELECT 1 FROM DoctorTestCommission x WHERE x.DoctorId = ? AND x.TestId = t.Id)`,
        [doctorId, rate, categoryId, doctorId]);
    return r.affectedRows || 0;
};

/**
 * ★5 Re-price the doctor's thanks of one category from oldRate → newRate.
 * Only rows that still equal price × oldRate (i.e. never customised) change; custom amounts are kept.
 * oldRate null (unknown) → nothing is re-priced, only missing tests are added.
 */
const repriceCategory = async (conn, doctorId, categoryId, oldRate, newRate) => {
    if (oldRate == null) return { repriced: 0, kept: 0 };
    const [u] = await conn.query(`
        UPDATE DoctorTestCommission dtc JOIN MainTestTable t ON t.Id = dtc.TestId
        SET dtc.Commission = ROUND(t.Price * ? / 100, 2)
        WHERE dtc.DoctorId = ? AND t.CategoryId = ? AND ABS(dtc.Commission - ROUND(t.Price * ? / 100, 2)) < 0.02`,
        [newRate, doctorId, categoryId, oldRate]);
    const [[k]] = await conn.query(`
        SELECT COUNT(*) AS n FROM DoctorTestCommission dtc JOIN MainTestTable t ON t.Id = dtc.TestId
        WHERE dtc.DoctorId = ? AND t.CategoryId = ? AND ABS(dtc.Commission - ROUND(t.Price * ? / 100, 2)) >= 0.02`,
        [doctorId, categoryId, newRate]);
    return { repriced: u.changedRows != null ? u.changedRows : (u.affectedRows || 0), kept: Number(k.n) || 0 };
};

/**
 * registerDoctor(req)                     — old call, reads + validates req.body itself
 * registerDoctor(req, { form, categories }) — controller already validated
 * → { doctorId, message }
 */
const registerDoctor = async (req, opts = {}) => {
    const categories = opts.categories || await Category.getCategoryList();
    const form = opts.form || readDoctorForm(req.body || {}, categories);
    if (form.errors.length) throw userError(form.errors.map(e => e.msg).join(' '));
    const userId = req.user && req.user.Id;
    if (!userId) throw userError('Please log in again.');

    return withSaveLock(async (conn) => {
        // ★1 checked again INSIDE the lock — the first click's doctor is visible to the second click now
        const dups = await findDuplicates({ firstName: form.data.FirstName, lastName: form.data.LastName,
            mobiles: [form.data.MobileNumberFirst, form.data.MobileNumberSecond] }, null, conn);
        const exact = exactDuplicateMessage(dups);
        if (exact) throw Object.assign(userError(exact), { duplicates: dups });
        if (dups.length && !form.values.confirmDuplicate) throw Object.assign(userError(describeDuplicates(dups)), { duplicates: dups });

        try {
            await conn.beginTransaction();
            const [ins] = await conn.query('INSERT INTO DoctorDetails SET ?', [{ ...form.data, CreatedOn: createdOn(), CreatedBy: userId }]);
            const doctorId = ins.insertId;

            const ts = createdOn();
            if (form.commissions.length) {
                await conn.query('INSERT INTO DoctorCategoryCommission (DoctorId, CategoryId, CommissionRate, CreatedAt, UpdatedAt, CreatedBy) VALUES ?',
                    [form.commissions.map(c => [doctorId, c.categoryId, c.rate, ts, ts, userId])]);
            }

            // thanks for every test = test price × category %
            const [tc] = await conn.query(`
                INSERT INTO DoctorTestCommission (DoctorId, TestId, Commission)
                SELECT ?, t.Id, ROUND(t.Price * c.CommissionRate / 100, 2)
                FROM MainTestTable t JOIN DoctorCategoryCommission c ON c.CategoryId = t.CategoryId AND c.DoctorId = ?`,
                [doctorId, doctorId]);

            await insertSchedules(conn, doctorId, form.schedules);
            await audit(conn, { doctorId, action: 'REGISTER', by: userId,
                detail: { ...form.data, thanksPct: Object.fromEntries(form.commissions.map(c => [c.name, c.rate])),
                          confirmedDuplicateOf: dups.map(d => d.id) } });
            await conn.commit();
            const name = `Dr. ${[form.data.FirstName, form.data.LastName].filter(Boolean).join(' ')}`;
            return { doctorId, message: `${name} is registered. Thanks set for ${tc.affectedRows || 0} tests. Now assign the marketing person below.` };
        } catch (e) {
            await conn.rollback().catch(() => {});
            throw e;
        }
    });
};

/**
 * updateDoctor(req)                                  — old call
 * updateDoctor(req, { form, categories, doctorId })  — controller already validated
 * Only categories whose % changed are re-priced, so custom test-wise thanks survive other edits.
 * → { doctorId, message }
 */
const DETAIL_FIELDS = ['FirstName', 'LastName', 'Degree1', 'Degree2', 'Degree3', 'Degree4', 'SpecialistIn', 'WorkedAt', 'YearOfExperience',
    'Registration', 'AuthorizedForBloodTest', 'Award', 'Instruction', 'FlatDiscount', 'MobileNumberFirst', 'MobileNumberSecond'];
const same = (a, b) => String(a == null ? '' : a).trim() === String(b == null ? '' : b).trim()
    || (a !== '' && b !== '' && a != null && b != null && !isNaN(a) && !isNaN(b) && Number(a) === Number(b));

const updateDoctor = async (req, opts = {}) => {
    const doctorId = toId(opts.doctorId || req.params.doctorId);
    if (!doctorId) throw userError('Doctor not found.');
    const categories = opts.categories || await Category.getCategoryList();
    const form = opts.form || readDoctorForm(req.body || {}, categories);
    if (form.errors.length) throw userError(form.errors.map(e => e.msg).join(' '));
    const userId = req.user && req.user.Id;
    if (!userId) throw userError('Please log in again.');
    const expected = opts.version != null ? opts.version : (req.body && req.body.formVersion);

    return withSaveLock(async (conn) => {
      try {
        await conn.beginTransaction();
        const [[found]] = await conn.query('SELECT * FROM DoctorDetails WHERE Id = ? FOR UPDATE', [doctorId]);
        if (!found) throw userError('Doctor not found. He may have been deleted.');

        // ★8 somebody saved this doctor after this form was opened
        if (expected && String(expected) !== await loadVersion(conn, doctorId)) {
            throw Object.assign(userError('This doctor was changed by someone else after you opened the form. Your changes were NOT saved — open Edit again and re-enter them.'), { stale: true });
        }

        // ★1 a changed name / mobile is checked again inside the lock (exact duplicates never allowed)
        const l10 = (x) => String(x || '').replace(/\D/g, '').slice(-10);
        const nameChanged = !same(found.FirstName, form.data.FirstName) || !same(found.LastName, form.data.LastName);
        const newNums = [form.data.MobileNumberFirst, form.data.MobileNumberSecond].filter(m => m && ![l10(found.MobileNumberFirst), l10(found.MobileNumberSecond)].includes(l10(m)));
        if (nameChanged || newNums.length) {
            const dups = await findDuplicates({ firstName: form.data.FirstName, lastName: form.data.LastName,
                mobiles: [form.data.MobileNumberFirst, form.data.MobileNumberSecond] }, doctorId, conn);
            const exact = exactDuplicateMessage(dups);
            if (exact) throw Object.assign(userError(exact), { duplicates: dups });
        }

        const changes = {};
        DETAIL_FIELDS.forEach(k => { if (k in form.data && !same(found[k], form.data[k])) changes[k] = [found[k], form.data[k]]; });
        await conn.query('UPDATE DoctorDetails SET ? WHERE Id = ?', [form.data, doctorId]);

        const [existing] = await conn.query('SELECT CategoryId, CommissionRate FROM DoctorCategoryCommission WHERE DoctorId = ? FOR UPDATE', [doctorId]);
        const old = new Map(existing.map(r => [Number(r.CategoryId), Number(r.CommissionRate)]));
        const ts = createdOn();
        const changed = [], fresh = [], auditRows = []; let repriced = 0, kept = 0, added = 0;
        for (const c of form.commissions) {
            if (!old.has(c.categoryId)) {
                await conn.query('INSERT INTO DoctorCategoryCommission (DoctorId, CategoryId, CommissionRate, CreatedAt, UpdatedAt, CreatedBy) VALUES (?, ?, ?, ?, ?, ?)',
                    [doctorId, c.categoryId, c.rate, ts, ts, userId]);
                fresh.push(c);
                auditRows.push({ doctorId, action: 'CATEGORY_THANKS', categoryId: c.categoryId, oldValue: null, newValue: c.rate, by: userId });
            } else if (round2(old.get(c.categoryId)) !== round2(c.rate)) {
                await conn.query('UPDATE DoctorCategoryCommission SET CommissionRate = ?, UpdatedAt = ? WHERE DoctorId = ? AND CategoryId = ?',
                    [c.rate, ts, doctorId, c.categoryId]);
                const r = await repriceCategory(conn, doctorId, c.categoryId, old.get(c.categoryId), c.rate);   // ★5
                repriced += r.repriced; kept += r.kept;
                changed.push(c);
                auditRows.push({ doctorId, action: 'CATEGORY_THANKS', categoryId: c.categoryId, oldValue: old.get(c.categoryId), newValue: c.rate, by: userId,
                                 detail: { testsRecalculated: r.repriced, customKept: r.kept } });
            }
            added += await addMissingTestThanks(conn, doctorId, c.categoryId, c.rate);
        }

        const [oldSch] = await conn.query('SELECT DayOfWeek, StartTime, EndTime, Area FROM DoctorVisitingSchedule WHERE DoctorId = ? ORDER BY Id', [doctorId]);
        await conn.query('DELETE FROM DoctorVisitingSchedule WHERE DoctorId = ?', [doctorId]);
        await insertSchedules(conn, doctorId, form.schedules);
        const schKey = (list) => JSON.stringify(list.map(x => [x.day || x.DayOfWeek, String(x.start || x.StartTime).slice(0, 5), String(x.end || x.EndTime).slice(0, 5), x.area || x.Area]).sort());
        if (schKey(oldSch) !== schKey(form.schedules)) changes.Schedule = [schKey(oldSch), schKey(form.schedules)];

        if (Object.keys(changes).length) auditRows.unshift({ doctorId, action: 'UPDATE', by: userId, detail: changes });
        await audit(conn, auditRows);
        await conn.commit();

        const name = `Dr. ${[form.data.FirstName, form.data.LastName].filter(Boolean).join(' ')}`;
        let message = `${name} is updated.`;
        if (changed.length) message += ` Thanks % changed for ${changed.map(c => `${c.name} (${c.rate}%)`).join(', ')} — ${repriced} test${repriced === 1 ? '' : 's'} re-calculated.`;
        if (kept) message += ` ${kept} test${kept === 1 ? ' has' : 's have'} a custom thanks amount and ${kept === 1 ? 'was' : 'were'} not changed.`;
        if (fresh.length) message += ` Thanks % set for ${fresh.map(c => `${c.name} (${c.rate}%)`).join(', ')}.`;
        if (added) message += ` Thanks added for ${added} test${added === 1 ? '' : 's'} that had none.`;
        return { doctorId, message };
      } catch (e) {
        await conn.rollback().catch(() => {});
        throw e;
      }
    });
};

// ─────────────────────────────────────────────────────────────────────────────
// Lists / details
// ─────────────────────────────────────────────────────────────────────────────

const getDoctorList = async () => {
    const [doctors] = await db().query('SELECT * FROM DoctorDetails ORDER BY Id DESC');
    return doctors;
};

const getdoctorListNotattachedToclinic = async (clinicId) => {
    const [rows] = await db().query(
        'SELECT * FROM DoctorDetails WHERE Id NOT IN (SELECT DoctorId FROM ClinicAndDoctorAssociation WHERE ClinicId = ?) ORDER BY Id DESC', [clinicId]);
    return rows;
};

const getAttachedDoctorList = async (clinicId) => {
    const [rows] = await db().query(
        'SELECT * FROM DoctorDetails WHERE Id IN (SELECT DoctorId FROM ClinicAndDoctorAssociation WHERE ClinicId = ?)', [clinicId]);
    return rows;
};

const getDoctorDetail = async (doctorId) => {
    const [rows] = await db().query('SELECT * FROM DoctorDetails WHERE Id = ?', [doctorId]);
    return rows[0];
};

const getCategoryWiseCommission = async (doctorId) => {
    const [rows] = await db().query(`
        SELECT Category.Id, Category.Name, DoctorCategoryCommission.CommissionRate
        FROM Category JOIN DoctorCategoryCommission ON DoctorCategoryCommission.CategoryId = Category.Id
        WHERE DoctorCategoryCommission.DoctorId = ?
        ORDER BY Category.Name`, [doctorId]);
    return rows;
};

/** NOTE: returns only the FIRST row (kept as before because existing views rely on it). */
const getTestWiseCommissionDetails = async (doctorId) => {
    const [rows] = await db().query(`
        SELECT MainTestTable.Id AS TestId, TestName, Commission
        FROM MainTestTable JOIN DoctorTestCommission ON DoctorTestCommission.TestId = MainTestTable.Id
        WHERE DoctorTestCommission.DoctorId = ?`, [doctorId]);
    return rows[0];
};

/** Category % + re-price that category's tests (custom test amounts are kept — ★5). */
const updateThanks = async (req) => {
    const b = req.body || {};
    const doctorId = toId(b.doctorId), categoryId = toId(b.doctorThanksCategory);
    const raw = clean(b.doctorCategoryThanks);
    const rate = DEC_RE.test(raw) ? Number(raw) : NaN;
    if (!doctorId) throw userError('Doctor not found.');
    if (!categoryId) throw userError('Choose the category.');
    if (!Number.isFinite(rate) || rate < 0 || rate > MAX_RATE) throw userError(`Thanks % must be a number from 0 to ${MAX_RATE}.`);
    const userId = req.user && req.user.Id;
    const conn = await getConn();
    try {
        await conn.beginTransaction();
        const [[doc]] = await conn.query('SELECT Id FROM DoctorDetails WHERE Id = ? FOR UPDATE', [doctorId]);
        if (!doc) throw userError('Doctor not found.');
        const [[cat]] = await conn.query('SELECT Id, Name FROM Category WHERE Id = ?', [categoryId]);
        if (!cat) throw userError('Category not found.');
        const [[cur]] = await conn.query('SELECT CommissionRate FROM DoctorCategoryCommission WHERE DoctorId = ? AND CategoryId = ? FOR UPDATE', [doctorId, categoryId]);
        const ts = createdOn();
        let r = { repriced: 0, kept: 0 };
        if (!cur) {          // ★6 the % row was missing → create it
            await conn.query('INSERT INTO DoctorCategoryCommission (DoctorId, CategoryId, CommissionRate, CreatedAt, UpdatedAt, CreatedBy) VALUES (?, ?, ?, ?, ?, ?)',
                [doctorId, categoryId, rate, ts, ts, userId || null]);
        } else if (round2(cur.CommissionRate) !== round2(rate)) {
            await conn.query('UPDATE DoctorCategoryCommission SET CommissionRate = ?, UpdatedAt = ? WHERE DoctorId = ? AND CategoryId = ?', [rate, ts, doctorId, categoryId]);
            r = await repriceCategory(conn, doctorId, categoryId, Number(cur.CommissionRate), rate);
        }
        const added = await addMissingTestThanks(conn, doctorId, categoryId, rate);
        if (!cur || round2(cur.CommissionRate) !== round2(rate)) {
            await audit(conn, { doctorId, action: 'CATEGORY_THANKS', categoryId, oldValue: cur ? Number(cur.CommissionRate) : null, newValue: rate,
                                by: userId, detail: { testsRecalculated: r.repriced, customKept: r.kept, testsAdded: added } });
        }
        await conn.commit();
        let msg = cur && round2(cur.CommissionRate) === round2(rate)
            ? `${cat.Name} thanks is already ${rate}% — nothing changed.`
            : `${cat.Name} thanks set to ${rate}%. ${r.repriced} test${r.repriced === 1 ? '' : 's'} re-calculated.`;
        if (r.kept) msg += ` ${r.kept} test${r.kept === 1 ? ' has' : 's have'} a custom amount and ${r.kept === 1 ? 'was' : 'were'} kept (change those test-wise).`;
        if (added) msg += ` Thanks added for ${added} new test${added === 1 ? '' : 's'}.`;
        return msg;
    } catch (error) {
        await conn.rollback().catch(() => {});
        throw error;
    } finally {
        conn.release();
    }
};

/** Test-wise thanks: newThanks_<testId> for each selectedTests[].  ★4 ≤ test price, rows created when missing, audited. */
const MAX_TESTS_PER_SAVE = 500;
const updateDoctorsThankTestWise = async (req) => {
    const b = req.body || {};
    const doctorId = toId(b.doctorId);
    if (!doctorId) throw userError('Doctor not found.');
    const selected = [...new Set(arr(b, 'selectedTests').map(toId).filter(Boolean))];
    if (selected.length > MAX_TESTS_PER_SAVE) throw userError(`Update at most ${MAX_TESTS_PER_SAVE} tests at a time.`);
    const wanted = new Map();
    for (const testId of selected) {
        const raw = clean(b[`newThanks_${testId}`]);
        if (raw === '') continue;
        if (!DEC_RE.test(raw)) throw userError('Thanks must be a plain amount like 150 or 150.50.');
        wanted.set(testId, round2(raw));
    }
    if (!wanted.size) throw userError('Select at least one test and enter the new thanks.');
    const userId = req.user && req.user.Id;

    const conn = await getConn();
    try {
        await conn.beginTransaction();
        const [[doc]] = await conn.query('SELECT Id FROM DoctorDetails WHERE Id = ? FOR UPDATE', [doctorId]);
        if (!doc) throw userError('Doctor not found.');
        const ids = [...wanted.keys()];
        const [tests] = await conn.query('SELECT Id, TestName, Price FROM MainTestTable WHERE Id IN (?)', [ids]);
        const testBy = new Map(tests.map(t => [Number(t.Id), t]));
        const missing = ids.filter(id => !testBy.has(id));
        if (missing.length) throw userError(`Test${missing.length > 1 ? 's' : ''} not found: #${missing.join(', #')}.`);
        const tooHigh = ids.filter(id => wanted.get(id) > round2(testBy.get(id).Price));
        if (tooHigh.length) {
            throw userError('Thanks cannot be more than the test price: ' +
                tooHigh.slice(0, 5).map(id => `${testBy.get(id).TestName} (price ₹${round2(testBy.get(id).Price)}, thanks ₹${wanted.get(id)})`).join(', ') + '.');
        }
        const [cur] = await conn.query('SELECT TestId, Commission FROM DoctorTestCommission WHERE DoctorId = ? AND TestId IN (?) FOR UPDATE', [doctorId, ids]);
        const curBy = new Map(cur.map(r => [Number(r.TestId), round2(r.Commission)]));
        const auditRows = [];
        let changedN = 0;
        for (const id of ids) {
            const val = wanted.get(id);
            if (curBy.has(id)) {
                if (curBy.get(id) === val) continue;
                await conn.query('UPDATE DoctorTestCommission SET Commission = ? WHERE DoctorId = ? AND TestId = ?', [val, doctorId, id]);
            } else {
                await conn.query('INSERT INTO DoctorTestCommission (DoctorId, TestId, Commission) VALUES (?, ?, ?)', [doctorId, id, val]);
            }
            changedN++;
            auditRows.push({ doctorId, action: 'TEST_THANKS', testId: id, oldValue: curBy.has(id) ? curBy.get(id) : null, newValue: val, by: userId });
        }
        await audit(conn, auditRows);
        await conn.commit();
        if (!changedN) return 'Nothing changed — the thanks were already these amounts.';
        return `Thanks updated for ${changedN} test${changedN === 1 ? '' : 's'}.`;
    } catch (e) {
        await conn.rollback().catch(() => {});
        throw e;
    } finally {
        conn.release();
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// Thanks reports  (date range: >= from AND < to + 1 day → works for DATE and DATETIME)
// ─────────────────────────────────────────────────────────────────────────────

const readRange = (src = {}) => {
    const today = moment().format('YYYY-MM-DD');
    const parse = (v) => { const m = moment(String(v || ''), ['DD-MM-YYYY', 'YYYY-MM-DD', 'D MMM YYYY'], true); return m.isValid() ? m.format('YYYY-MM-DD') : null; };
    const from = parse(src.FromDate) || today, to = parse(src.ToDate) || today;
    if (moment(from).isAfter(moment(to))) throw userError('Start Date cannot be after End Date.');
    if (moment(to).diff(moment(from), 'days') >= MAX_REPORT_DAYS) throw userError(`Choose at most ${MAX_REPORT_DAYS} days.`);   // ★12
    return { from, to };
};

// ★2 only money that is really owed: active referral, of the patient's CURRENT doctor, patient not cancelled
let referralStatusCol = null;
const activeReferral = async (alias) => {
    if (referralStatusCol === null) {
        try {
            const [r] = await db().query("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Referrals' AND COLUMN_NAME = 'Status'");
            referralStatusCol = r.length > 0;
        } catch (_) { referralStatusCol = false; }
    }
    return referralStatusCol ? ` AND ${alias}.Status = 'active'` : '';
};

const getDoctorWiseThanks = async (FromDate, ToDate, doctorId) => {
    const { from, to } = readRange({ FromDate, ToDate });
    let sql = `
        SELECT DoctorDetails.FirstName, DoctorDetails.LastName, Referrals.DoctorId, Referrals.PatientId, SUM(Referrals.Thanks) AS Thanks
        FROM Referrals
        JOIN DoctorDetails  ON Referrals.DoctorId = DoctorDetails.Id
        JOIN PatientDetails p ON p.Id = Referrals.PatientId AND p.DoctorId = Referrals.DoctorId AND p.Status = 1
        WHERE Referrals.RegisteredOn >= ? AND Referrals.RegisteredOn < DATE_ADD(?, INTERVAL 1 DAY)${await activeReferral('Referrals')}`;
    const params = [from, to];
    const did = toId(doctorId);
    if (doctorId && !did) return [];
    if (did) { sql += ' AND DoctorDetails.Id = ?'; params.push(did); }
    sql += ' GROUP BY Referrals.DoctorId, DoctorDetails.FirstName, DoctorDetails.LastName, Referrals.PatientId';
    const [rows] = await db().query(sql, params);
    return rows;
};

const getIndividualDoctorThanks = async (req) => {
    const doctorId = toId(req.query.doctorId);
    if (!doctorId) throw userError('Choose the doctor.');
    const { from, to } = readRange(req.query);
    const act = await activeReferral('r');
    const [rows] = await db().query(`
        SELECT p.Name, p.Age, p.Gender, p.YMD, p.Discount, p.DuesAmount, p.RegisteredOn, p.GrossAmount,
               d.FirstName AS DoctorFirstName, d.LastName AS DoctorLastName,
               d.Degree1, d.Degree2, d.Degree3, d.Degree4, d.SpecialistIn, d.WorkedAt,
               (SELECT COALESCE(SUM(r.Thanks), 0) FROM Referrals r WHERE r.DoctorId = d.Id AND r.PatientId = p.Id${act}) AS TotalThanks,
               GROUP_CONCAT(DISTINCT mt.TestName ORDER BY mt.TestName ASC SEPARATOR ', ') AS TestNames,
               GROUP_CONCAT(DISTINCT stt.Name ORDER BY stt.Name ASC SEPARATOR ', ') AS SubTestNames
        FROM PatientDetails p
        JOIN DoctorDetails d ON p.DoctorId = d.Id
        JOIN PatientTestRefference ptr ON ptr.PatientId = p.Id
        JOIN MainTestTable mt ON mt.Id = ptr.TestId
        LEFT JOIN PatientSubTestRefference pst ON pst.PatientId = p.Id
        LEFT JOIN MainTestSubTestReference mtst ON mtst.MainTestId = mt.Id
        LEFT JOIN SubTestTable stt ON stt.Id = pst.SubtestId AND mtst.SubTestId = stt.Id
        WHERE d.Id = ? AND p.Status = 1 AND p.RegisteredOn >= ? AND p.RegisteredOn < DATE_ADD(?, INTERVAL 1 DAY)
        GROUP BY p.Id, p.Name, p.Age, p.Gender, p.YMD, p.RegisteredOn, p.GrossAmount, p.Discount, p.DuesAmount,
                 d.Id, d.FirstName, d.LastName, d.Degree1, d.Degree2, d.Degree3, d.Degree4, d.SpecialistIn, d.WorkedAt
        ORDER BY p.RegisteredOn`, [doctorId, from, to]);
    return rows;
};

const downloadAllDoctorThanks = async (req) => {
    const src = { ...(req.body || {}), ...(req.query || {}) };
    const { from, to } = readRange(src);
    const act = await activeReferral('r');
    const [rows] = await db().query(`
        SELECT p.Name, p.Age, p.Gender, p.YMD, p.RegisteredOn, p.Discount, p.DuesAmount, p.GrossAmount,
               d.FirstName AS DoctorFirstName, d.LastName AS DoctorLastName, d.Id AS doctorId,
               d.Degree1, d.Degree2, d.Degree3, d.Degree4, d.SpecialistIn, d.WorkedAt,
               (SELECT COALESCE(SUM(r.Thanks), 0) FROM Referrals r WHERE r.DoctorId = d.Id AND r.PatientId = p.Id${act}) AS Thanks,
               GROUP_CONCAT(DISTINCT mt.TestName ORDER BY mt.TestName ASC SEPARATOR ', ') AS TestNames,
               GROUP_CONCAT(DISTINCT stt.Name ORDER BY stt.Name ASC SEPARATOR ', ') AS SubTestNames
        FROM PatientDetails p
        JOIN DoctorDetails d ON p.DoctorId = d.Id
        JOIN PatientTestRefference ptr ON ptr.PatientId = p.Id
        JOIN MainTestTable mt ON mt.Id = ptr.TestId
        LEFT JOIN PatientSubTestRefference pst ON pst.PatientId = p.Id
        LEFT JOIN MainTestSubTestReference mtst ON mtst.MainTestId = mt.Id
        LEFT JOIN SubTestTable stt ON stt.Id = pst.SubtestId AND mtst.SubTestId = stt.Id
        WHERE p.Status = 1 AND p.RegisteredOn >= ? AND p.RegisteredOn < DATE_ADD(?, INTERVAL 1 DAY)
        GROUP BY p.Id, p.Name, p.Age, p.Gender, p.YMD, p.RegisteredOn, p.GrossAmount, p.Discount, p.DuesAmount,
                 d.Id, d.FirstName, d.LastName, d.Degree1, d.Degree2, d.Degree3, d.Degree4, d.SpecialistIn, d.WorkedAt
        ORDER BY d.FirstName, d.LastName, p.RegisteredOn`, [from, to]);
    return rows;
};

// ─────────────────────────────────────────────────────────────────────────────
// Schedule, names, misc
// ─────────────────────────────────────────────────────────────────────────────

const getVisitingSchedule = async (doctorId) => {
    const [rows] = await db().query(`
        SELECT * FROM DoctorVisitingSchedule WHERE DoctorId = ?
        ORDER BY FIELD(DayOfWeek,'Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday','AllDay'), StartTime`, [doctorId]);
    return rows;
};
const getDoctorVisitingSchedule = getVisitingSchedule;

const getDoctorName = async (doctorId) => {
    const [rows] = await db().query("SELECT CONCAT_WS(' ', FirstName, LastName) AS DoctorName FROM DoctorDetails WHERE Id = ?", [doctorId]);
    return rows.length ? rows[0].DoctorName : `Unknown (${doctorId})`;
};

/** Called from cancelPatient in the Patient model. Pass the cancel transaction's conn so a rolled-back cancel keeps the thanks. */
const setThanksToZero = async (patientId, conn = null) => {
    await (conn || db()).query('UPDATE Referrals SET Thanks = ? WHERE PatientId = ?', [0, patientId]);
};

const getDoctorsCategoryWiseThanks = async (doctorId) => {
    const [rows] = await db().query('SELECT * FROM DoctorCategoryCommission WHERE DoctorId = ?', [doctorId]);
    return rows;
};

// ─────────────────────────────────────────────────────────────────────────────
// Reporting doctor + marketing person (MR)
// ─────────────────────────────────────────────────────────────────────────────

/** Users with RoleId 2 are reporting (signing) doctors. */
const getReportingDoctorList = async () => {
    const [rows] = await db().query('SELECT Id, FirstName, LastName FROM Users WHERE RoleId = 2 ORDER BY FirstName, LastName');
    return rows;
};

const doctorExists = async (id) => { const [r] = await db().query('SELECT Id FROM DoctorDetails WHERE Id = ?', [id]); return r.length > 0; };

/** ★10 only an existing referring doctor + an existing reporting-doctor user (RoleId 2). changedBy → audit. */
const setReportingDoctor = async (refferingDoctorId, reportingDoctorId, changedBy = null) => {
    const did = toId(refferingDoctorId), rid = toId(reportingDoctorId);
    if (!did || !(await doctorExists(did))) throw userError('Doctor not found.');
    const [u] = await db().query('SELECT Id FROM Users WHERE Id = ? AND RoleId = 2', [rid || 0]);
    if (!u.length) throw userError('Choose a reporting doctor from the list.');
    const before = await getPreselectedReportingDoctor(did);
    const [result] = await db().execute(`
        INSERT INTO ReferDoctorReportingDoctor (ReferDoctorId, ReportingDoctorId) VALUES (?, ?)
        ON DUPLICATE KEY UPDATE ReportingDoctorId = VALUES(ReportingDoctorId)`, [did, rid]);
    if (Number(before) !== rid) await audit(db(), { doctorId: did, action: 'REPORTING_DOCTOR', oldValue: before, newValue: rid, by: changedBy });
    return result;
};

/** "No preference" on the doctor page. */
const clearReportingDoctor = async (refferingDoctorId, changedBy = null) => {
    const did = toId(refferingDoctorId);
    if (!did) throw userError('Doctor not found.');
    const before = await getPreselectedReportingDoctor(did);
    await db().execute('DELETE FROM ReferDoctorReportingDoctor WHERE ReferDoctorId = ?', [did]);
    if (before) await audit(db(), { doctorId: did, action: 'REPORTING_DOCTOR', oldValue: before, newValue: null, by: changedBy });
};

const getPreselectedReportingDoctor = async (refferingDoctorId) => {
    const [rows] = await db().execute('SELECT ReportingDoctorId FROM ReferDoctorReportingDoctor WHERE ReferDoctorId = ? LIMIT 1', [refferingDoctorId]);
    return rows.length ? rows[0].ReportingDoctorId : null;
};

/**
 * MarketingDoctorAssociation keeps history: the doctor's CURRENT MR is his latest row
 * (the same rule the MR "My visits" page uses). marketingPersonId 0/empty → un-assign.
 */
const updateMarketingPerson = async (marketingPersonId, doctorId, changedBy = null) => {
    const mr = parseInt(marketingPersonId, 10) || 0;
    const id = toId(doctorId);
    if (!id || !(await doctorExists(id))) throw userError('Doctor not found.');          // ★10
    const before = Number(await getPreselectedMarketingPerson(id)) || 0;
    if (!mr) {
        if (!before) return 'unchanged';
        await db().query('DELETE FROM MarketingDoctorAssociation WHERE DoctorId = ?', [id]);
        await audit(db(), { doctorId: id, action: 'MR_ASSIGN', oldValue: before, newValue: null, by: changedBy });
        return 'removed';
    }
    // ★10 must be an active marketing person (RoleId 5, same list as the dropdown)
    const [u] = await db().query('SELECT Id FROM Users WHERE Id = ? AND RoleId = 5 AND (IsActive IS NULL OR IsActive = 1)', [mr])
        .catch(e => (e.code === 'ER_BAD_FIELD_ERROR' ? db().query('SELECT Id FROM Users WHERE Id = ? AND RoleId = 5', [mr]) : Promise.reject(e)));
    if (!u.length) throw userError('Choose a marketing person from the list.');
    if (before === mr) return 'unchanged';
    // works whether or not DoctorId has a unique key (with one: updates the row; without: adds a history row)
    await db().query(`
        INSERT INTO MarketingDoctorAssociation (DoctorId, MarketingPersonId, AssociatedOn) VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE MarketingPersonId = VALUES(MarketingPersonId), AssociatedOn = VALUES(AssociatedOn)`,
        [id, mr, nowStr()]);
    await audit(db(), { doctorId: id, action: 'MR_ASSIGN', oldValue: before || null, newValue: mr, by: changedBy });
    return 'assigned';
};

const getPreselectedMarketingPerson = async (refferingDoctorId) => {
    const [rows] = await db().execute(
        'SELECT MarketingPersonId FROM MarketingDoctorAssociation WHERE DoctorId = ? ORDER BY Id DESC LIMIT 1', [refferingDoctorId]);
    return rows.length ? rows[0].MarketingPersonId : null;
};

/** Audit rows for one doctor (newest first) — for the doctor page. [] when the table does not exist. */
const getDoctorAudit = async (doctorId, limit = 50) => {
    const id = toId(doctorId);
    if (!id) return [];
    try {
        const [rows] = await db().query(`
            SELECT a.Id, a.Action, a.CategoryId, c.Name AS CategoryName, a.TestId, t.TestName, a.OldValue, a.NewValue, a.Detail,
                   DATE_FORMAT(a.ChangedAt, '%d %b %Y, %h:%i %p') AS ChangedAt,
                   TRIM(CONCAT_WS(' ', u.FirstName, u.LastName)) AS ChangedBy
            FROM DoctorAuditLog a
            LEFT JOIN Users u ON u.Id = a.ChangedBy
            LEFT JOIN Category c ON c.Id = a.CategoryId
            LEFT JOIN MainTestTable t ON t.Id = a.TestId
            WHERE a.DoctorId = ? ORDER BY a.Id DESC LIMIT ?`, [id, Math.min(Number(limit) || 50, 500)]);
        return rows;
    } catch (e) { if (e.code === 'ER_NO_SUCH_TABLE') return []; throw e; }
};

module.exports = {
    // register / edit
    readDoctorForm, validateUserInput, toFormValues, getDoctorFormData, getFormLookups,
    findDuplicates, describeDuplicates, exactDuplicateMessage, registerDoctor, updateDoctor, formVersion, getDoctorAudit,
    SCHEDULE_DAYS, FLAT_DISCOUNTS,
    // lists / details
    getDoctorList, getAttachedDoctorList, getdoctorListNotattachedToclinic, getDoctorDetail,
    getCategoryWiseCommission, getTestWiseCommissionDetails, updateThanks, updateDoctorsThankTestWise,
    getDoctorWiseThanks, getIndividualDoctorThanks, downloadAllDoctorThanks, readRange,
    getVisitingSchedule, getDoctorName, setThanksToZero, getDoctorsCategoryWiseThanks, getDoctorVisitingSchedule,
    // reporting doctor / MR
    getReportingDoctorList, setReportingDoctor, clearReportingDoctor, getPreselectedReportingDoctor,
    updateMarketingPerson, getPreselectedMarketingPerson,
};
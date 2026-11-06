'use strict';

/**
 * Schedule.js — field visits for the marketing team (MRs).
 *
 * Flow on the MR's phone, at every doctor:
 *   PUNCH IN  (live photo + several GPS readings) → meet the doctor →
 *   PUNCH OUT (outcome + notes + GPS).
 * Admin / authorised user then reviews each visit (Verify / Reject).
 *
 * How we know he was really there
 *   1. GPS distance to the doctor's approved clinic pin (DoctorVisitLocation).
 *   2. Live photo taken at punch-in (camera, server time stamp).
 *   3. Fake-GPS signs — a website cannot ask the phone "is this location mocked?",
 *      but mock-location apps leave patterns we can detect on the server:
 *        • gps_static      several readings over ~5 s are IDENTICAL (real GPS always drifts)
 *        • reused_location exact same coordinates as an earlier visit (never happens with real GPS)
 *        • fast_travel     impossible speed between two visits
 *        • checkout_far    punched out somewhere else than he punched in
 *   4. Human review of every visit by an admin / authorised user.
 *
 * ONE clock for everything: Node's (IST). MySQL NOW()/CURDATE() are never used,
 * so a MySQL server running in UTC cannot shift times by 5½ hours.
 */

const fs           = require('fs');
const path         = require('path');
const dbConnection = require('../config/DBConnection');
const moment       = require('moment');

const db      = () => (dbConnection.pool || dbConnection.connection).promise();
const getConn = () => dbConnection.pool.promise().getConnection();

const DAYS            = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const WEAK_GPS_M      = 150;     // accuracy worse than this → "weak GPS"
const DEFAULT_RADIUS  = 150;     // metres around the clinic that count as "there"
const FAST_KMPH       = 80;      // faster than this between two stops in town → flag
const CHECKOUT_FAR_M  = 500;     // punched out far away from where he punched in → flag
const OUTCOMES        = ['met', 'not_available', 'left_material', 'follow_up', 'other'];
const PHOTO_MODES     = ['required', 'optional', 'off'];
// used only until an admin saves the setting on the Team page (or if AppSettings does not exist yet)
const PHOTO_MODE_ENV  = PHOTO_MODES.includes(process.env.FIELD_PHOTO_MODE) ? process.env.FIELD_PHOTO_MODE
                      : (process.env.FIELD_PHOTO_REQUIRED === '0' ? 'optional' : 'required');
const PHOTO_MAX_BYTES = 1.5 * 1024 * 1024;
const PHOTO_DIR       = process.env.FIELD_PHOTO_DIR || path.join(__dirname, '..', 'uploads', 'visits');

const nowStr   = () => moment().format('YYYY-MM-DD HH:mm:ss');
const todayStr = () => moment().format('YYYY-MM-DD');

const userError = (msg) => { const e = new Error(msg); e.isUserError = true; return e; };
const str  = (v) => (v == null ? '' : String(v).trim());
const toId = (v) => { const n = parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : null; };
const fullName = (a) => `TRIM(CONCAT(COALESCE(${a}.FirstName,''),' ',COALESCE(${a}.LastName,'')))`;

/** Great-circle distance in metres. */
const distanceM = (lat1, lng1, lat2, lng2) => {
    const R = 6371000, rad = (d) => (d * Math.PI) / 180;
    const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(a)));
};

const round7 = (v) => Math.round(Number(v) * 1e7) / 1e7;   // DECIMAL(10,7)

/**
 * Position from the phone. Accepts either a single { lat, lng, acc } or
 * samples: [{ lat, lng, acc }, …] (several readings over a few seconds).
 * Returns { lat, lng, acc, samples, spreadM, static } — null when nothing was sent.
 */
const readPosition = (src = {}) => {
    let list = Array.isArray(src.samples) ? src.samples.slice(0, 15) : [];
    if (!list.length && src.lat != null) list = [{ lat: src.lat, lng: src.lng, acc: src.acc }];
    const pts = [];
    for (const s of list) {
        const lat = Number(s && s.lat), lng = Number(s && s.lng), acc = Math.round(Number(s && s.acc));
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) throw userError('The location from your phone is not valid. Please try again.');
        pts.push({ lat: round7(lat), lng: round7(lng), acc: Number.isFinite(acc) && acc >= 0 ? Math.min(acc, 100000) : null });
    }
    if (!pts.length) return null;
    const best = pts.reduce((a, b) => ((b.acc ?? 1e9) < (a.acc ?? 1e9) ? b : a), pts[0]);
    let spread = 0;
    for (const p of pts) spread = Math.max(spread, distanceM(best.lat, best.lng, p.lat, p.lng));
    const identical = pts.length >= 3 && pts.every(p => p.lat === pts[0].lat && p.lng === pts[0].lng && p.acc === pts[0].acc);
    return { ...best, samples: pts.length, spreadM: spread, static: identical };
};

/** Live photo from the phone: data URL or base64 JPEG/PNG/WebP. Returns { buf, ext } or null. */
const readPhoto = (src = {}) => {
    const raw = str(src.photo);
    if (!raw) return null;
    const b64 = raw.replace(/^data:image\/[a-z]+;base64,/i, '');
    if (!/^[A-Za-z0-9+/=\s]+$/.test(b64)) throw userError('The photo could not be read. Please take it again.');
    const buf = Buffer.from(b64, 'base64');
    if (buf.length < 2000)          throw userError('The photo is empty. Please take it again.');
    if (buf.length > PHOTO_MAX_BYTES) throw userError('The photo is too large. Please take it again.');
    const ext = (buf[0] === 0xff && buf[1] === 0xd8) ? 'jpg'
              : (buf.slice(0, 8).toString('hex') === '89504e470d0a1a0a') ? 'png'
              : (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') ? 'webp' : null;
    if (!ext) throw userError('Only camera photos are allowed.');
    return { buf, ext };
};

// ─────────────────────────────────────────────────────────────────────────────
// Settings (admin can change from the Team page)
// ─────────────────────────────────────────────────────────────────────────────

const GLOBAL_PHOTO_KEY = 'field.photoMode';
const USER_PHOTO_PREFIX = 'field.photoMode.user.';
const userPhotoKey = (userId) => USER_PHOTO_PREFIX + Number(userId);
const photoModeCache = new Map();               // key → { value, at }; value null = "no row"

/** Raw value of one settings key (null if missing / invalid), cached 30 s. */
const readModeKey = async (key) => {
    const hit = photoModeCache.get(key);
    if (hit && Date.now() - hit.at < 30000) return hit.value;
    let value = null;
    try {
        const [[row]] = await db().query(`SELECT SettingValue FROM AppSettings WHERE SettingKey = ? LIMIT 1`, [key]);
        if (row && PHOTO_MODES.includes(row.SettingValue)) value = row.SettingValue;
    } catch (e) {
        if (e.code !== 'ER_NO_SUCH_TABLE') throw e;      // table not created yet → use .env / default
    }
    photoModeCache.set(key, { value, at: Date.now() });
    return value;
};

/** Default for everyone: 'required' | 'optional' | 'off'. */
const getDefaultPhotoMode = async () => (await readModeKey(GLOBAL_PHOTO_KEY)) || PHOTO_MODE_ENV;

/**
 * Photo mode for one officer: his own setting if the admin gave him one,
 * otherwise the default. Called without userId → the default.
 */
const getPhotoMode = async (userId) => {
    if (userId) {
        const own = await readModeKey(userPhotoKey(userId));
        if (own) return own;
    }
    return getDefaultPhotoMode();
};

const setPhotoMode = async (mode, adminId) => {
    if (!PHOTO_MODES.includes(mode)) throw userError('Choose Required, Optional or Off.');
    try {
        await db().query(`
            INSERT INTO AppSettings (SettingKey, SettingValue, UpdatedBy, UpdatedAt) VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE SettingValue = VALUES(SettingValue), UpdatedBy = VALUES(UpdatedBy), UpdatedAt = VALUES(UpdatedAt)`,
            [GLOBAL_PHOTO_KEY, mode, adminId, nowStr()]);
    } catch (e) {
        if (e.code === 'ER_NO_SUCH_TABLE') throw userError('Run the settings SQL file first (AppSettings table is missing).');
        throw e;
    }
    photoModeCache.set(GLOBAL_PHOTO_KEY, { value: mode, at: Date.now() });
    return { off: 'Default: photo is turned off — officers punch in with GPS only.',
             optional: 'Default: photo is optional — officers can skip it (marked "No photo").',
             required: 'Default: photo is required — officers must take a photo to punch in.' }[mode]
        + ' Officers with their own setting are not changed.';
};

/** mode = 'required' | 'optional' | 'off' | 'default' ('default' removes his own setting). */
const setUserPhotoMode = async (targetUserId, mode, adminId) => {
    const uid = Number(targetUserId);
    if (!Number.isInteger(uid) || uid <= 0) throw userError('Choose an officer.');
    if (mode !== 'default' && !PHOTO_MODES.includes(mode)) throw userError('Choose Default, Required, Optional or Off.');
    const [[u]] = await db().query(`SELECT Id, ${fullName('u')} AS Name FROM Users u WHERE u.Id = ? LIMIT 1`, [uid]);
    if (!u) throw userError('Officer not found.');
    const key = userPhotoKey(uid);
    try {
        if (mode === 'default') {
            await db().query(`DELETE FROM AppSettings WHERE SettingKey = ?`, [key]);
        } else {
            await db().query(`
                INSERT INTO AppSettings (SettingKey, SettingValue, UpdatedBy, UpdatedAt) VALUES (?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE SettingValue = VALUES(SettingValue), UpdatedBy = VALUES(UpdatedBy), UpdatedAt = VALUES(UpdatedAt)`,
                [key, mode, adminId, nowStr()]);
        }
    } catch (e) {
        if (e.code === 'ER_NO_SUCH_TABLE') throw userError('Run the settings SQL file first (AppSettings table is missing).');
        throw e;
    }
    photoModeCache.delete(key);
    const name = (u.Name || '').trim() || `User ${uid}`;
    if (mode === 'default') return `${name} now follows the default (${await getDefaultPhotoMode()}).`;
    return `${name}: photo ${mode === 'off' ? 'turned off' : mode}.`;
};

const getSettings = async () => {
    let updated = null;
    let overrides = [];
    try {
        const [[row]] = await db().query(`
            SELECT DATE_FORMAT(s.UpdatedAt, '%d %b %Y, %h:%i %p') AS UpdatedAt, ${fullName('u')} AS ByName
            FROM AppSettings s LEFT JOIN Users u ON u.Id = s.UpdatedBy WHERE s.SettingKey = ?`, [GLOBAL_PHOTO_KEY]);
        if (row && row.UpdatedAt) updated = row;
        [overrides] = await db().query(`
            SELECT CAST(SUBSTRING(s.SettingKey, ?) AS UNSIGNED) AS UserId, s.SettingValue AS Mode,
                   DATE_FORMAT(s.UpdatedAt, '%d %b %Y') AS UpdatedAt, ${fullName('b')} AS ByName
            FROM AppSettings s LEFT JOIN Users b ON b.Id = s.UpdatedBy
            WHERE s.SettingKey LIKE 'field.photoMode.user.%'`, [USER_PHOTO_PREFIX.length + 1]);
    } catch (e) { if (e.code !== 'ER_NO_SUCH_TABLE') throw e; }

    // Officers = anyone who logged a visit in the last 90 days + anyone with his own setting.
    const since = moment().subtract(90, 'days').format('YYYY-MM-DD');
    const [active] = await db().query(`SELECT DISTINCT MarketingPersonId AS UserId FROM VisitLog WHERE VisitedOn >= ? AND MarketingPersonId IS NOT NULL`, [since]);
    const ids = [...new Set([...active.map(r => Number(r.UserId)), ...overrides.map(r => Number(r.UserId))])].filter(Boolean);
    const byId = new Map(overrides.map(r => [Number(r.UserId), r]));
    let officers = [];
    if (ids.length) {
        const [users] = await db().query(`SELECT u.Id, ${fullName('u')} AS Name FROM Users u WHERE u.Id IN (?)`, [ids]);
        officers = users.map(u => {
            const o = byId.get(Number(u.Id));
            return { Id: u.Id, Name: (u.Name || '').trim() || `User ${u.Id}`, mode: o && PHOTO_MODES.includes(o.Mode) ? o.Mode : 'default',
                     UpdatedAt: o ? o.UpdatedAt : null, ByName: o ? o.ByName : null };
        }).sort((a, b) => a.Name.localeCompare(b.Name));
    }
    const [allUsers] = await db().query(`SELECT u.Id, ${fullName('u')} AS Name FROM Users u ORDER BY Name`);
    const listed = new Set(officers.map(o => Number(o.Id)));
    return {
        photoMode: await getDefaultPhotoMode(), photoModeUpdated: updated, officers,
        otherUsers: allUsers.filter(u => !listed.has(Number(u.Id))).map(u => ({ Id: u.Id, Name: (u.Name || '').trim() || `User ${u.Id}` })),
    };
};

// ─────────────────────────────────────────────────────────────────────────────
// MR: my day
// ─────────────────────────────────────────────────────────────────────────────

const getOpenVisit = async (userId) => {
    const [[row]] = await db().query(`
        SELECT vl.Id, vl.DoctorId, vl.CheckInAt, vl.LocationStatus, vl.DistanceM,
               ${fullName('d')} AS DoctorName
        FROM VisitLog vl JOIN DoctorDetails d ON d.Id = vl.DoctorId
        WHERE vl.MarketingPersonId = ? AND vl.CheckInAt IS NOT NULL AND vl.CheckOutAt IS NULL
        ORDER BY vl.CheckInAt DESC LIMIT 1`, [userId]);
    return row || null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Which doctor belongs to which MR — found from your own tables
// ─────────────────────────────────────────────────────────────────────────────

/*
 * Doctors are assigned to an MR in MarketingDoctorAssociation (Id, DoctorId, MarketingPersonId, AssociatedOn),
 * filled from the Doctor details page. The doctor's CURRENT MR is his LATEST row (highest Id);
 * older rows are history. Team → Doctors adds a new row when the MR changes.
 * Fallbacks (only if that table does not exist): FIELD_DOCTOR_ASSIGN_COLUMN=Table.Column in .env,
 * or an MR column such as AssignedTo in DoctorDetails / DoctorVisitingSchedule.
 * Visiting-time columns on DoctorVisitingSchedule (if you have them) are found the same way.
 */
const ASSIGN_COLS = ['AssignedTo', 'AssignedMRId', 'AssignedMR', 'MarketingPersonId', 'MarketingPerson', 'MRId', 'MrId', 'AssignedId', 'AssignedUserId'];
const FROM_COLS   = ['FromTime', 'TimeFrom', 'StartTime', 'VisitFrom', 'VisitTimeFrom', 'StartsAt'];
const TO_COLS     = ['ToTime', 'TimeTo', 'EndTime', 'VisitTo', 'VisitTimeTo', 'EndsAt'];
const TIME_COLS   = ['Timing', 'Timings', 'VisitTime', 'VisitingTime', 'Time'];
const SAFE_IDENT  = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
let schemaCache = null;

const getSchemaInfo = async () => {
    if (schemaCache && (schemaCache.assign || Date.now() - schemaCache.at < 60000)) return schemaCache;
    const [cols] = await db().query(`
        SELECT TABLE_NAME AS t, COLUMN_NAME AS c, DATA_TYPE AS type FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) IN ('doctordetails', 'doctorvisitingschedule', 'marketingdoctorassociation')`);
    const has = (table, names) => {
        for (const n of names) {
            const hit = cols.find(x => x.t.toLowerCase() === table.toLowerCase() && x.c.toLowerCase() === n.toLowerCase());
            if (hit) return { table: hit.t, column: hit.c };
        }
        return null;
    };
    let assign = null;
    // Your link table: MarketingDoctorAssociation (Id, DoctorId, MarketingPersonId, AssociatedOn).
    // The doctor's CURRENT MR = his latest row (AssociatedOn, then Id); older rows are history.
    const lDoc = has('MarketingDoctorAssociation', ['DoctorId']), lMr = has('MarketingDoctorAssociation', ['MarketingPersonId']);
    if (lDoc && lMr && !str(process.env.FIELD_DOCTOR_ASSIGN_COLUMN)) {
        const on = has('MarketingDoctorAssociation', ['AssociatedOn']), idc = has('MarketingDoctorAssociation', ['Id']);
        const onType = on && (cols.find(x => x.t === on.table && x.c === on.column) || {}).type;
        assign = { link: true, table: lDoc.table, column: lMr.column, docCol: lDoc.column,
                   onCol: on && on.column, onIsDate: onType === 'date', idCol: idc && idc.column };
    }
    const env = str(process.env.FIELD_DOCTOR_ASSIGN_COLUMN);
    if (env) {
        const [t, c] = env.split('.');
        if (SAFE_IDENT.test(t || '') && SAFE_IDENT.test(c || '')) assign = has(t, [c]);
        if (!assign) console.warn(`FIELD_DOCTOR_ASSIGN_COLUMN=${env} was not found in the database.`);
    }
    if (!assign) assign = has('DoctorDetails', ASSIGN_COLS) || has('DoctorVisitingSchedule', ASSIGN_COLS);
    if (assign && !assign.link) assign.onSchedule = assign.table.toLowerCase() === 'doctorvisitingschedule';
    const from = has('DoctorVisitingSchedule', FROM_COLS), to = has('DoctorVisitingSchedule', TO_COLS), one = has('DoctorVisitingSchedule', TIME_COLS);
    schemaCache = { at: Date.now(), assign, timeFrom: from && from.column, timeTo: to && to.column, timeText: one && one.column };
    return schemaCache;
};

/** SQL expression: the current MR (user id) of doctor `dd`, or NULL. */
const mrExpr = (info) => {
    const a = info.assign; if (!a) return 'NULL';
    if (a.link) {
        // newest row first: Id (insert order) is reliable even when old rows have no AssociatedOn
        const order = [a.idCol && `m.\`${a.idCol}\` DESC`, a.onCol && `m.\`${a.onCol}\` DESC`].filter(Boolean).join(', ');
        return `(SELECT m.\`${a.column}\` FROM \`${a.table}\` m WHERE m.\`${a.docCol}\` = dd.Id${order ? ' ORDER BY ' + order : ''} LIMIT 1)`;
    }
    return a.onSchedule
        ? `(SELECT MAX(x.\`${a.column}\`) FROM DoctorVisitingSchedule x WHERE x.DoctorId = dd.Id)`
        : `dd.\`${a.column}\``;
};

/** SQL condition "this doctor (alias dd) is assigned to ?" — or null when assignment is not set up. */
const assignedCond = (info, how) => {
    if (!info.assign) return null;
    const col = mrExpr(info);
    return how === 'unassigned' ? `(${col} IS NULL OR ${col} = 0)` : `${col} = ?`;
};

const isAssignedTo = async (doctorId, userId) => {
    const info = await getSchemaInfo();
    if (!info.assign) return true;                                   // not set up → everyone covers everyone
    const [[r]] = await db().query(`SELECT 1 AS ok FROM DoctorDetails dd WHERE dd.Id = ? AND ${assignedCond(info)} LIMIT 1`, [doctorId, userId]);
    return !!r;
};

const fmtSlotTime = (v) => {
    if (v == null || v === '') return '';
    const m = moment(String(v), ['HH:mm:ss', 'HH:mm', 'h:mm A', 'h:mmA', 'hA'], true);
    return m.isValid() ? m.format('h:mm A') : String(v).slice(0, 30);
};

/**
 * Everything the MR page needs, for ALL of his doctors and ALL their visiting days —
 * the page filters day / area / search / "due" instantly on the phone without reloading.
 *
 * scope (only for admin / authorised users; an MR always gets his own doctors):
 *   'mine' | 'all' | 'unassigned' | <MR user id>
 */
const getMyDay = async (userId, filters = {}) => {
    const today   = moment().format('dddd');
    const day     = filters.day === 'all' ? 'all' : (DAYS.includes(filters.day) ? filters.day : today);
    const info    = await getSchemaInfo();
    const canTeam = await canViewTeam(userId);

    // ── whose doctors? ──
    let scope = 'all';
    if (info.assign) {
        const want = str(filters.scope);
        if (!canTeam) scope = 'mine';
        else if (want === 'all' || want === 'unassigned' || want === 'mine') scope = want;
        else if (toId(want)) scope = String(toId(want));
        else scope = 'auto';
    }
    const runQuery = async (sc) => {
        const where = [], params = [];
        if (sc === 'mine')            { where.push(assignedCond(info)); params.push(userId); }
        else if (sc === 'unassigned') { where.push(assignedCond(info, 'unassigned')); }
        else if (toId(sc))            { where.push(assignedCond(info)); params.push(toId(sc)); }
        const assignSel = mrExpr(info);
        const timeSel = [
            info.timeFrom ? `dvs.\`${info.timeFrom}\` AS TFrom` : 'NULL AS TFrom',
            info.timeTo   ? `dvs.\`${info.timeTo}\` AS TTo`     : 'NULL AS TTo',
            info.timeText ? `dvs.\`${info.timeText}\` AS TText` : 'NULL AS TText',
        ].join(', ');
        const [docRows] = await db().query(`
            SELECT dd.Id, dd.FirstName, dd.LastName, dd.SpecialistIn,
                   CONCAT_WS(', ', NULLIF(dd.Degree1,''), NULLIF(dd.Degree2,'')) AS Degrees,
                   ${assignSel} AS AssignedTo
            FROM DoctorDetails dd
            JOIN DoctorVisitingSchedule dvs ON dvs.DoctorId = dd.Id
            ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
            GROUP BY dd.Id, dd.FirstName, dd.LastName, dd.SpecialistIn, dd.Degree1, dd.Degree2
            ORDER BY dd.FirstName, dd.LastName`, params);
        return { docRows, timeSel };
    };

    let { docRows, timeSel } = await runQuery(scope === 'auto' ? 'mine' : scope);
    if (scope === 'auto') {                     // admin with no doctors of his own → show everybody
        if (docRows.length) scope = 'mine';
        else { scope = 'all'; ({ docRows, timeSel } = await runQuery('all')); }
    }

    const ids = docRows.map(r => r.Id);
    const stats = new Map(ids.map(id => [id, { slots: [] }]));
    if (ids.length) {
        const [[slots], [visits], [locs], [refs], [follow]] = await Promise.all([
            db().query(`SELECT dvs.DoctorId, dvs.DayOfWeek, dvs.Area, ${timeSel}
                        FROM DoctorVisitingSchedule dvs WHERE dvs.DoctorId IN (?) ORDER BY dvs.Id`, [ids]),
            db().query(`
                SELECT DoctorId,
                       SUM(VisitedOn >= ?)                                AS MonthVisits,
                       MAX(VisitedOn)                                     AS LastVisit,
                       SUM(DATE(VisitedOn) = ? AND MarketingPersonId = ?) AS VisitedTodayByMe
                FROM VisitLog WHERE DoctorId IN (?) GROUP BY DoctorId`,
                [moment().startOf('month').format('YYYY-MM-DD'), todayStr(), userId, ids]),
            db().query(`SELECT DoctorId, SUM(Status='approved') AS Approved, SUM(Status='pending') AS Pending
                        FROM DoctorVisitLocation WHERE DoctorId IN (?) GROUP BY DoctorId`, [ids]),
            db().query(`SELECT DoctorId, COUNT(*) AS Patients, COALESCE(SUM(GrossAmount),0) AS Billed
                        FROM PatientDetails WHERE DoctorId IN (?) AND Status = 1 AND RegisteredOn >= ?
                        GROUP BY DoctorId`, [ids, moment().subtract(30, 'days').format('YYYY-MM-DD')]),
            // follow-up date promised at the latest visit
            db().query(`SELECT v.DoctorId, v.NextVisitOn FROM VisitLog v
                        JOIN (SELECT DoctorId, MAX(Id) AS Id FROM VisitLog WHERE DoctorId IN (?) AND CheckOutAt IS NOT NULL GROUP BY DoctorId) l ON l.Id = v.Id
                        WHERE v.NextVisitOn IS NOT NULL`, [ids]),
        ]);
        slots.forEach(s => {
            const dayName = s.DayOfWeek === 'AllDay' ? 'AllDay' : (DAYS.find(d => d.toLowerCase() === String(s.DayOfWeek || '').toLowerCase()) || null);
            if (!dayName) return;
            const time = s.TText ? String(s.TText).slice(0, 30) : [fmtSlotTime(s.TFrom), fmtSlotTime(s.TTo)].filter(Boolean).join(' – ');
            stats.get(s.DoctorId).slots.push({ day: dayName, area: str(s.Area), time });
        });
        visits.forEach(v => Object.assign(stats.get(v.DoctorId), { monthVisits: Number(v.MonthVisits) || 0, lastVisit: v.LastVisit, visitedTodayByMe: Number(v.VisitedTodayByMe) > 0 }));
        locs.forEach(l => Object.assign(stats.get(l.DoctorId), { locApproved: Number(l.Approved) || 0, locPending: Number(l.Pending) || 0 }));
        refs.forEach(r => Object.assign(stats.get(r.DoctorId), { refPatients: Number(r.Patients) || 0, refBilled: Number(r.Billed) || 0 }));
        follow.forEach(f => Object.assign(stats.get(f.DoctorId), { nextVisitOn: f.NextVisitOn }));
    }

    // names of the MRs the doctors belong to (admin view)
    const mrIds = [...new Set(docRows.map(r => Number(r.AssignedTo)).filter(Boolean))];
    const mrNames = new Map();
    if (mrIds.length) {
        const [us] = await db().query(`SELECT u.Id, ${fullName('u')} AS Name FROM Users u WHERE u.Id IN (?)`, [mrIds]);
        us.forEach(u => mrNames.set(Number(u.Id), u.Name));
    }

    const startToday = moment().startOf('day');
    const doctors = docRows.map(r => {
        const s = stats.get(r.Id) || { slots: [] };
        const next = s.nextVisitOn ? moment(s.nextVisitOn).startOf('day') : null;
        const allDay = s.slots.some(x => x.day === 'AllDay');
        return {
            id: r.Id, first: r.FirstName || '', last: r.LastName || '', spec: r.SpecialistIn || '', degrees: r.Degrees || '',
            slots: s.slots,
            days: allDay ? DAYS.slice() : [...new Set(s.slots.map(x => x.day))].sort((a, b) => DAYS.indexOf(a) - DAYS.indexOf(b)),
            allDay,
            areas: [...new Set(s.slots.map(x => x.area).filter(Boolean))],
            monthVisits: s.monthVisits || 0,
            lastVisit: s.lastVisit ? moment(s.lastVisit).format('DD MMM') : null,
            daysSinceVisit: s.lastVisit ? startToday.diff(moment(s.lastVisit).startOf('day'), 'days') : null,
            visitedTodayByMe: !!s.visitedTodayByMe,
            hasLocation: (s.locApproved || 0) > 0, locationPending: (s.locPending || 0) > 0,
            refPatients: s.refPatients || 0, refBilled: Math.round(s.refBilled || 0),
            followUp: next ? next.format('DD MMM') : null,
            followUpDue: !!(next && !next.isAfter(startToday)),
            assignedTo: Number(r.AssignedTo) || null,
            assignedName: mrNames.get(Number(r.AssignedTo)) || null,
        };
    });

    const dayCounts = {};
    DAYS.forEach(d => { dayCounts[d] = doctors.filter(x => x.days.includes(d)).length; });

    const [openVisit, [myToday]] = await Promise.all([
        getOpenVisit(userId),
        db().query(`
            SELECT vl.Id, vl.DoctorId, ${fullName('d')} AS DoctorName,
                   DATE_FORMAT(vl.CheckInAt, '%h:%i %p') AS InAt, DATE_FORMAT(vl.CheckOutAt, '%h:%i %p') AS OutAt,
                   TIMESTAMPDIFF(MINUTE, vl.CheckInAt, COALESCE(vl.CheckOutAt, ?)) AS Minutes,
                   vl.LocationStatus, vl.DistanceM, vl.Outcome, vl.ReviewStatus
            FROM VisitLog vl JOIN DoctorDetails d ON d.Id = vl.DoctorId
            WHERE vl.MarketingPersonId = ? AND DATE(vl.VisitedOn) = ?
            ORDER BY vl.VisitedOn`, [nowStr(), userId, todayStr()]),
    ]);

    // MR list for the admin's "whose doctors" picker
    let mrOptions = [];
    if (canTeam && info.assign) {
        const [us] = await db().query(`SELECT u.Id, ${fullName('u')} AS Name FROM Users u ORDER BY Name`);
        mrOptions = us.map(u => ({ Id: u.Id, Name: (u.Name || '').trim() || `User ${u.Id}` }));
    }

    const photoMode = await getPhotoMode(userId);
    return {
        day, today, area: str(filters.area).slice(0, 60), name: str(filters.name).slice(0, 60),
        doctors, dayCounts, openVisit, myToday, photoMode, photoRequired: photoMode === 'required',
        scope, canViewTeam: canTeam, assignReady: !!info.assign, mrOptions,
        summary: {
            planned: day === 'all' ? doctors.length : dayCounts[day] || 0,
            visited: myToday.length ? new Set(myToday.map(v => v.DoctorId)).size : 0,
            verified: myToday.filter(v => v.LocationStatus === 'verified').length,
        },
    };
};

/** Team page "Doctors" tab: every doctor with his days, areas and MR. */
const getAssignmentBoard = async () => {
    const info = await getSchemaInfo();
    const assignSel = mrExpr(info);
    const [rows] = await db().query(`
        SELECT dd.Id, ${fullName('dd')} AS Name, dd.SpecialistIn,
               GROUP_CONCAT(DISTINCT dvs.DayOfWeek SEPARATOR '|') AS Days,
               GROUP_CONCAT(DISTINCT NULLIF(dvs.Area,'') SEPARATOR '|') AS Areas,
               ${assignSel} AS AssignedTo
        FROM DoctorDetails dd LEFT JOIN DoctorVisitingSchedule dvs ON dvs.DoctorId = dd.Id
        GROUP BY dd.Id, dd.FirstName, dd.LastName, dd.SpecialistIn
        ORDER BY dd.FirstName, dd.LastName`);
    const [users] = await db().query(`SELECT u.Id, ${fullName('u')} AS Name FROM Users u ORDER BY Name`);
    const names = new Map(users.map(u => [Number(u.Id), (u.Name || '').trim() || `User ${u.Id}`]));
    const doctors = rows.map(r => {
        const days = r.Days ? r.Days.split('|') : [];
        return {
            id: r.Id, name: r.Name, spec: r.SpecialistIn || '',
            days: days.includes('AllDay') ? ['All days'] : DAYS.filter(d => days.includes(d)).map(d => d.slice(0, 3)),
            areas: r.Areas ? r.Areas.split('|') : [],
            assignedTo: Number(r.AssignedTo) || null, assignedName: names.get(Number(r.AssignedTo)) || null,
        };
    });
    const perMr = {};
    doctors.forEach(d => { if (d.assignedTo) perMr[d.assignedTo] = (perMr[d.assignedTo] || 0) + 1; });
    return {
        ready: !!info.assign, column: info.assign ? (info.assign.link ? `${info.assign.table} (latest row per doctor)` : `${info.assign.table}.${info.assign.column}`) : null,
        doctors, users: users.map(u => ({ Id: u.Id, Name: names.get(Number(u.Id)), count: perMr[u.Id] || 0 })),
        unassigned: doctors.filter(d => !d.assignedTo).length,
    };
};

/** Give doctors to an MR (mrId) or take them away (mrId empty). */
const assignDoctors = async (doctorIds, mrId) => {
    const info = await getSchemaInfo();
    if (!info.assign) throw userError('Doctor assignment is not set up yet (MarketingDoctorAssociation table not found).');
    const ids = [...new Set([].concat(doctorIds || []).map(toId).filter(Boolean))].slice(0, 500);
    if (!ids.length) throw userError('Select at least one doctor.');
    const uid = mrId === '' || mrId == null || mrId === 'none' ? null : toId(mrId);
    let name = null;
    if (mrId && mrId !== 'none' && !uid) throw userError('Choose a marketing officer.');
    if (uid) {
        const [[u]] = await db().query(`SELECT ${fullName('u')} AS Name FROM Users u WHERE u.Id = ?`, [uid]);
        if (!u) throw userError('Marketing officer not found.');
        name = (u.Name || '').trim() || `User ${uid}`;
    }
    const a = info.assign;
    let r;
    if (a.link) {
        // only doctors whose current MR really changes get a new row (keeps the history clean)
        const [cur] = await db().query(`SELECT dd.Id, ${mrExpr(info)} AS Mr FROM DoctorDetails dd WHERE dd.Id IN (?)`, [ids]);
        const exists = new Set(cur.map(c => Number(c.Id)));
        if (exists.size !== ids.length) throw userError('Some doctors were not found. Reload the page.');
        const change = cur.filter(c => (Number(c.Mr) || null) !== uid).map(c => Number(c.Id));
        if (change.length && uid) {
            const when = a.onIsDate ? todayStr() : nowStr();
            const colsSql = [a.docCol, a.column, a.onCol].filter(Boolean).map(c => `\`${c}\``).join(', ');
            const rows = change.map(id => a.onCol ? [id, uid, when] : [id, uid]);
            await db().query(`INSERT INTO \`${a.table}\` (${colsSql}) VALUES ?`, [rows]);
        } else if (change.length) {
            // un-assign: remove the doctor's association rows, so no MR is current
            await db().query(`DELETE FROM \`${a.table}\` WHERE \`${a.docCol}\` IN (?)`, [change]);
        }
        r = { affectedRows: change.length };
    } else {
        const idCol = a.onSchedule ? 'DoctorId' : 'Id';
        [r] = await db().query(`UPDATE \`${a.table}\` SET \`${a.column}\` = ? WHERE \`${idCol}\` IN (?)`, [uid, ids]);
    }
    const n = ids.length;
    return { changed: r.affectedRows, message: uid ? `${n} doctor${n > 1 ? 's' : ''} assigned to ${name}.` : `${n} doctor${n > 1 ? 's' : ''} un-assigned.` };
};

/** Last visits for one doctor (history sheet). */
const getDoctorVisits = async (doctorId, limit = 20) => {
    const id = toId(doctorId);
    if (!id) throw userError('Invalid doctor.');
    const [rows] = await db().query(`
        SELECT vl.Id, DATE_FORMAT(vl.VisitedOn, '%d %b %Y, %h:%i %p') AS VisitedAt, vl.Notes, vl.Outcome,
               vl.LocationStatus, vl.DistanceM, vl.ReviewStatus, DATE_FORMAT(vl.NextVisitOn, '%d %b %Y') AS NextVisitOn,
               TIMESTAMPDIFF(MINUTE, vl.CheckInAt, vl.CheckOutAt) AS Minutes, ${fullName('u')} AS ByName
        FROM VisitLog vl LEFT JOIN Users u ON u.Id = vl.MarketingPersonId
        WHERE vl.DoctorId = ? ORDER BY vl.VisitedOn DESC LIMIT ?`, [id, Math.min(Number(limit) || 20, 100)]);
    return rows;
};

// ─────────────────────────────────────────────────────────────────────────────
// MR: punch in / punch out at a doctor
// ─────────────────────────────────────────────────────────────────────────────

/** Last point of this MR today — for the travel-speed check. */
const lastPointToday = async (conn, userId) => {
    const [[v]] = await conn.query(`
        SELECT COALESCE(CheckOutLat, CheckInLat) AS lat, COALESCE(CheckOutLng, CheckInLng) AS lng,
               COALESCE(CheckOutAt, CheckInAt) AS at
        FROM VisitLog
        WHERE MarketingPersonId = ? AND DATE(VisitedOn) = ? AND CheckInLat IS NOT NULL
        ORDER BY COALESCE(CheckOutAt, CheckInAt) DESC LIMIT 1`, [userId, todayStr()]);
    return v && v.lat != null ? { lat: Number(v.lat), lng: Number(v.lng), at: v.at } : null;
};

const punchIn = async (userId, body = {}) => {
    const doctorId = toId(body.doctorId);
    if (!doctorId) throw userError('Choose a doctor.');
    const pos = readPosition(body);
    if (!pos) throw userError('Allow location on your phone to punch in. Without it the visit cannot be verified.');
    const photoMode = await getPhotoMode(userId);                       // his own setting, else the default
    const photo = photoMode === 'off' ? null : readPhoto(body);          // when off, a photo is ignored
    if (!photo && photoMode === 'required') throw userError('Take a photo at the clinic to punch in.');

    const conn = await getConn();
    let photoFile = null;
    try {
        await conn.beginTransaction();
        // serialise this MR's punches: a double-tap waits here, then sees the first visit as open
        await conn.query('SELECT Id FROM Users WHERE Id = ? FOR UPDATE', [userId]);
        const [[open]] = await conn.query(`
            SELECT vl.Id, ${fullName('d')} AS DoctorName FROM VisitLog vl JOIN DoctorDetails d ON d.Id = vl.DoctorId
            WHERE vl.MarketingPersonId = ? AND vl.CheckInAt IS NOT NULL AND vl.CheckOutAt IS NULL LIMIT 1`, [userId]);
        if (open) throw userError(`You are still punched in at Dr. ${open.DoctorName}. Punch out there first.`);

        const [[doc]] = await conn.query(`SELECT Id, ${fullName('d')} AS Name FROM DoctorDetails d WHERE d.Id = ?`, [doctorId]);
        if (!doc) throw userError('Doctor not found.');
        doc.Name = String(doc.Name || '').toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());

        // ── distance to the doctor's clinic pin ──
        const [locs] = await conn.query(`SELECT Id, Lat, Lng, RadiusM, Status FROM DoctorVisitLocation WHERE DoctorId = ? AND Status IN ('approved','pending')`, [doctorId]);
        const withDist = locs.map(l => ({ ...l, d: distanceM(pos.lat, pos.lng, Number(l.Lat), Number(l.Lng)) })).sort((a, b) => a.d - b.d);
        const approved = withDist.filter(l => l.Status === 'approved');
        const pending  = withDist.filter(l => l.Status === 'pending');
        const ts = nowStr();

        let status, locationId = null, dist = null, message;
        const slack = Math.min(pos.acc || 0, 100);
        if (approved.length) {
            const best = approved[0]; locationId = best.Id; dist = best.d;
            if (dist <= (best.RadiusM || DEFAULT_RADIUS) + slack) { status = 'verified'; message = `Punched in at Dr. ${doc.Name} ✓ location matches the clinic.`; }
            else { status = 'far'; message = `Punched in, but you are ${dist >= 1000 ? (dist / 1000).toFixed(1) + ' km' : dist + ' m'} from the clinic. This will be reviewed.`; }
        } else if (pending.length && pending[0].d <= DEFAULT_RADIUS + slack) {
            locationId = pending[0].Id; dist = pending[0].d; status = 'new_location';
            message = `Punched in at Dr. ${doc.Name}. Clinic location is waiting for admin approval.`;
        } else {
            const [ins] = await conn.query(`INSERT INTO DoctorVisitLocation (DoctorId, Lat, Lng, RadiusM, Status, CreatedBy, CreatedAt) VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
                [doctorId, pos.lat, pos.lng, DEFAULT_RADIUS, userId, ts]);
            locationId = ins.insertId; dist = 0; status = 'new_location';
            message = `Punched in at Dr. ${doc.Name}. First visit with GPS — clinic location saved for admin approval.`;
        }
        if (pos.acc != null && pos.acc > WEAK_GPS_M && status === 'verified') {
            status = 'weak_gps'; message = `Punched in at Dr. ${doc.Name}, but GPS was weak (±${pos.acc} m).`;
        }

        // ── fake-GPS signs ──
        const flags = [];
        if (pos.static) flags.push('gps_static');
        const [[reused]] = await conn.query(
            'SELECT Id FROM VisitLog WHERE CheckInLat = ? AND CheckInLng = ? LIMIT 1', [pos.lat, pos.lng]);
        if (reused) flags.push('reused_location');
        const prev = await lastPointToday(conn, userId);
        if (prev && prev.at) {
            const km  = distanceM(prev.lat, prev.lng, pos.lat, pos.lng) / 1000;
            const hrs = Math.max(moment().diff(moment(prev.at), 'seconds') / 3600, 1 / 60);
            if (km > 2 && km / hrs > FAST_KMPH) flags.push('fast_travel');
        }
        if (!photo && photoMode !== 'off') flags.push('no_photo');
        else if (photo && Number(body.photoAgeSec) > 180) flags.push('old_photo');   // phone says the picture is older than 3 min
        if (photo && body.photoSource !== 'live') flags.push('photo_file');            // picked from files/gallery, not the live camera
        if (!(await isAssignedTo(doctorId, userId))) flags.push('not_assigned');       // covering another MR's doctor

        const [r] = await conn.query(`
            INSERT INTO VisitLog (DoctorId, MarketingPersonId, VisitedOn, Notes,
                                  CheckInAt, CheckInLat, CheckInLng, CheckInAcc, GpsSamples, GpsSpreadM,
                                  LocationId, DistanceM, LocationStatus, Flags, ReviewStatus)
            VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
            [doctorId, userId, ts, ts, pos.lat, pos.lng, pos.acc, pos.samples, pos.spreadM, locationId, dist, status, flags.join(',') || null]);

        if (photo) {
            fs.mkdirSync(PHOTO_DIR, { recursive: true });
            photoFile = path.join(PHOTO_DIR, `visit_${r.insertId}.${photo.ext}`);
            fs.writeFileSync(photoFile, photo.buf);
            await conn.query('UPDATE VisitLog SET PhotoPath = ? WHERE Id = ?', [path.basename(photoFile), r.insertId]);
        }
        await conn.commit();
        const warn = flags.filter(f => !['no_photo', 'not_assigned', 'photo_file'].includes(f));
        return { visitId: r.insertId, status, distanceM: dist, flags: warn,
                 message: message + (warn.length ? ' Your location looks unusual and will be checked.' : '') };
    } catch (e) {
        try { await conn.rollback(); } catch (_) {}
        if (photoFile) fs.promises.unlink(photoFile).catch(() => {});
        throw e;
    } finally {
        conn.release();
    }
};

const punchOut = async (userId, body = {}) => {
    const visitId = toId(body.visitId);
    const notes   = str(body.notes).slice(0, 2000);
    const outcome = OUTCOMES.includes(body.outcome) ? body.outcome : null;
    const errs = [];
    if (!visitId)         errs.push('Visit not found.');
    if (!outcome)         errs.push('Choose how the visit went.');
    if (notes.length < 3) errs.push('Write a short note about the visit.');
    let next = null;
    if (str(body.nextVisitOn)) {
        const m = moment(str(body.nextVisitOn), ['YYYY-MM-DD', 'DD-MM-YYYY'], true);
        if (!m.isValid() || m.isBefore(moment().startOf('day'))) errs.push('Next visit date must be today or later.');
        else next = m.format('YYYY-MM-DD');
    }
    if (errs.length) throw userError(errs.join(' '));
    const pos = readPosition(body);

    const [[v]] = await db().query('SELECT Id, CheckInLat, CheckInLng, CheckOutAt, Flags FROM VisitLog WHERE Id = ? AND MarketingPersonId = ?', [visitId, userId]);
    if (!v)           throw userError('Visit not found.');
    if (v.CheckOutAt) throw userError('You already punched out from this visit.');

    const flags = v.Flags ? v.Flags.split(',') : [];
    if (!pos) flags.push('checkout_no_gps');
    else if (v.CheckInLat != null && distanceM(Number(v.CheckInLat), Number(v.CheckInLng), pos.lat, pos.lng) > CHECKOUT_FAR_M) flags.push('checkout_far');
    if (pos && pos.static && !flags.includes('gps_static')) flags.push('gps_static');

    await db().query(`
        UPDATE VisitLog SET CheckOutAt = ?, CheckOutLat = ?, CheckOutLng = ?, Notes = ?, Outcome = ?, NextVisitOn = ?, Flags = ?
        WHERE Id = ? AND CheckOutAt IS NULL`,
        [nowStr(), pos ? pos.lat : null, pos ? pos.lng : null, notes, outcome, next, [...new Set(flags)].join(',') || null, visitId]);
    const [[d]] = await db().query('SELECT TIMESTAMPDIFF(MINUTE, CheckInAt, CheckOutAt) AS m FROM VisitLog WHERE Id = ?', [visitId]);
    return { message: `Punched out after ${d ? d.m : 0} min.` + (next ? ` Next visit: ${moment(next).format('DD MMM')}.` : '') };
};

/** Old "Log visit" form (no GPS, no photo) — still accepted, clearly marked. */
const updateVisitingLogs = async (doctorId, notes, userId) => {
    const id = toId(doctorId), text = str(notes).slice(0, 2000);
    if (!id)             throw userError('Choose a doctor.');
    if (text.length < 3) throw userError('Write a short note about the visit.');
    const [[doc]] = await db().query('SELECT Id FROM DoctorDetails WHERE Id = ?', [id]);
    if (!doc) throw userError('Doctor not found.');
    const ts = nowStr();
    await db().query(`INSERT INTO VisitLog (DoctorId, MarketingPersonId, VisitedOn, Notes, CheckInAt, CheckOutAt, LocationStatus, Flags, ReviewStatus)
                      VALUES (?, ?, ?, ?, ?, ?, 'no_gps', 'no_photo', 'pending')`, [id, userId, ts, text, ts, ts]);
    return 'Visit saved without location — it will be reviewed.';
};

// ─────────────────────────────────────────────────────────────────────────────
// Admin / authorised user
// ─────────────────────────────────────────────────────────────────────────────

const canViewTeam = async (userId) => {
    const [[u]] = await db().query('SELECT * FROM Users WHERE Id = ? LIMIT 1', [userId]);
    if (!u) return false;
    if (Number(u.IsItAdmin) === 1 || Number(u.IsAdmin) === 1) return true;
    return require('./User').userHasAnyFunction(userId, ['/schedule/team', '/team']);   // roles + deny honoured
};

/** Visits for one day (or one MR / only "needs review"), grouped by MR. */
const getTeamDay = async ({ date, userId, onlyReview } = {}) => {
    const m = moment(str(date), ['YYYY-MM-DD', 'DD-MM-YYYY', 'D MMM YYYY'], true);
    const day = (m.isValid() ? m : moment()).format('YYYY-MM-DD');
    const uid = toId(userId);
    const where = ['vl.VisitedOn >= ?', 'vl.VisitedOn < ? + INTERVAL 1 DAY'], params = [day, day];
    if (uid) { where.push('vl.MarketingPersonId = ?'); params.push(uid); }
    if (onlyReview) where.push(`vl.ReviewStatus = 'pending'`);

    const [visits] = await db().query(`
        SELECT vl.Id, vl.MarketingPersonId AS UserId, ${fullName('u')} AS MRName,
               vl.DoctorId, ${fullName('d')} AS DoctorName, d.SpecialistIn,
               DATE_FORMAT(vl.CheckInAt, '%h:%i %p') AS InAt, DATE_FORMAT(vl.CheckOutAt, '%h:%i %p') AS OutAt,
               TIMESTAMPDIFF(MINUTE, vl.CheckInAt, vl.CheckOutAt) AS Minutes,
               vl.LocationStatus, vl.DistanceM, vl.CheckInAcc, vl.CheckInLat, vl.CheckInLng, vl.CheckOutLat, vl.CheckOutLng,
               vl.GpsSamples, vl.GpsSpreadM, vl.PhotoPath IS NOT NULL AS HasPhoto,
               vl.Outcome, vl.Notes, vl.Flags, DATE_FORMAT(vl.NextVisitOn, '%d %b') AS NextVisitOn,
               vl.ReviewStatus, vl.ReviewNote, ${fullName('rv')} AS ReviewedByName
        FROM VisitLog vl
        JOIN DoctorDetails d ON d.Id = vl.DoctorId
        LEFT JOIN Users u  ON u.Id  = vl.MarketingPersonId
        LEFT JOIN Users rv ON rv.Id = vl.ReviewedBy
        WHERE ${where.join(' AND ')}
        ORDER BY vl.MarketingPersonId, vl.VisitedOn`, params);

    const mrs = new Map();
    visits.forEach(v => {
        if (!mrs.has(v.UserId)) mrs.set(v.UserId, { userId: v.UserId, name: v.MRName || 'User #' + v.UserId, visits: [], verified: 0, far: 0, noGps: 0, suspicious: 0, pending: 0, minutes: 0 });
        const r = mrs.get(v.UserId);
        v.flagList = v.Flags ? v.Flags.split(',').filter(Boolean) : [];
        v.suspicious = v.LocationStatus === 'far' || v.flagList.some(f => ['gps_static', 'reused_location', 'fast_travel', 'checkout_far', 'old_photo'].includes(f));
        r.visits.push(v);
        if (v.LocationStatus === 'verified') r.verified++;
        else if (v.LocationStatus === 'far') r.far++;
        else if (v.LocationStatus === 'no_gps') r.noGps++;
        if (v.suspicious) r.suspicious++;
        if (v.ReviewStatus === 'pending') r.pending++;
        r.minutes += Number(v.Minutes) || 0;
    });
    mrs.forEach(r => { r.firstIn = r.visits[0] && r.visits[0].InAt; const last = r.visits[r.visits.length - 1]; r.lastOut = last && last.OutAt; });

    const weekday = moment(day).format('dddd');
    const [[plan]] = await db().query(`SELECT COUNT(DISTINCT DoctorId) AS Planned FROM DoctorVisitingSchedule WHERE DayOfWeek = ? OR DayOfWeek = 'AllDay'`, [weekday]);
    const since = moment().subtract(60, 'days').format('YYYY-MM-DD');
    const [users] = await db().query(`
        SELECT DISTINCT u.Id, ${fullName('u')} AS Name FROM Users u
        WHERE u.Id IN (SELECT MarketingPersonId FROM VisitLog WHERE VisitedOn >= ?) ORDER BY Name`, [since]);

    return {
        date: day, dateLabel: moment(day).format('dddd, D MMM YYYY'), weekday, userId: uid, onlyReview: !!onlyReview,
        team: [...mrs.values()].sort((a, b) => a.name.localeCompare(b.name)),
        summary: {
            mrs: mrs.size, visits: visits.length, planned: Number(plan.Planned) || 0,
            visitedDoctors: new Set(visits.map(v => v.DoctorId)).size,
            verified: visits.filter(v => v.LocationStatus === 'verified').length,
            suspicious: visits.filter(v => v.suspicious).length,
            pendingReview: visits.filter(v => v.ReviewStatus === 'pending').length,
        },
        users,
    };
};

/** Admin decision on one visit. */
const reviewVisit = async (visitId, decision, note, adminId) => {
    const id = toId(visitId);
    if (!id) throw userError('Visit not found.');
    if (!['approved', 'rejected'].includes(decision)) throw userError('Choose Verify or Reject.');
    const n = str(note).slice(0, 250);
    if (decision === 'rejected' && n.length < 3) throw userError('Write why the visit is rejected.');
    const [r] = await db().query('UPDATE VisitLog SET ReviewStatus = ?, ReviewedBy = ?, ReviewedAt = ?, ReviewNote = ? WHERE Id = ?',
        [decision, adminId, nowStr(), n || null, id]);
    if (!r.affectedRows) throw userError('Visit not found.');
    return decision === 'approved' ? 'Visit verified.' : 'Visit rejected.';
};

/** Absolute path of a visit photo — only for the MR who took it or a reviewer. */
const getVisitPhoto = async (visitId, userId) => {
    const id = toId(visitId);
    if (!id) return null;
    const [[v]] = await db().query('SELECT PhotoPath, MarketingPersonId FROM VisitLog WHERE Id = ?', [id]);
    if (!v || !v.PhotoPath) return null;
    if (Number(v.MarketingPersonId) !== Number(userId) && !(await canViewTeam(userId))) return null;
    const file = path.join(PHOTO_DIR, path.basename(v.PhotoPath));
    return fs.existsSync(file) ? file : null;
};

const getPendingLocations = async () => {
    const [rows] = await db().query(`
        SELECT l.Id, l.DoctorId, ${fullName('d')} AS DoctorName, l.Lat, l.Lng,
               DATE_FORMAT(l.CreatedAt, '%d %b, %h:%i %p') AS CreatedAt, ${fullName('u')} AS ByName,
               (SELECT GROUP_CONCAT(DISTINCT NULLIF(s.Area,'') SEPARATOR ', ') FROM DoctorVisitingSchedule s WHERE s.DoctorId = l.DoctorId) AS Areas,
               (SELECT v.Id FROM VisitLog v WHERE v.LocationId = l.Id AND v.PhotoPath IS NOT NULL ORDER BY v.Id LIMIT 1) AS PhotoVisitId
        FROM DoctorVisitLocation l
        JOIN DoctorDetails d ON d.Id = l.DoctorId
        LEFT JOIN Users u ON u.Id = l.CreatedBy
        WHERE l.Status = 'pending' ORDER BY l.CreatedAt DESC LIMIT 200`);
    return rows;
};

/** Approving a pin also upgrades the visits made at it from 'new_location' to 'verified'. */
const decideLocation = async (locationId, approve, adminId) => {
    const id = toId(locationId);
    if (!id) throw userError('Location not found.');
    const [r] = await db().query(`UPDATE DoctorVisitLocation SET Status = ?, ApprovedBy = ?, ApprovedAt = ? WHERE Id = ? AND Status = 'pending'`,
        [approve ? 'approved' : 'rejected', adminId, nowStr(), id]);
    if (!r.affectedRows) throw userError('This location was already decided.');
    await db().query(`UPDATE VisitLog SET LocationStatus = ? WHERE LocationId = ? AND LocationStatus = 'new_location'`, [approve ? 'verified' : 'far', id]);
    return approve ? 'Clinic location approved. Future visits will be checked against it.' : 'Location rejected. Those visits are marked for review.';
};

/** Visits vs business per doctor. */
const getDoctorROI = async ({ from, to } = {}) => {
    const parse = (v, def) => { const m = moment(str(v), ['YYYY-MM-DD', 'DD-MM-YYYY', 'D MMM YYYY'], true); return (m.isValid() ? m : def).format('YYYY-MM-DD'); };
    let f = parse(from, moment().subtract(29, 'days')), t = parse(to, moment());
    if (f > t) [f, t] = [t, f];
    const [rows] = await db().query(`
        SELECT d.Id, ${fullName('d')} AS DoctorName, d.SpecialistIn,
               COALESCE(v.Visits, 0) AS Visits, COALESCE(v.Verified, 0) AS Verified, v.LastVisit,
               COALESCE(p.Patients, 0) AS Patients, COALESCE(p.Billed, 0) AS Billed
        FROM DoctorDetails d
        LEFT JOIN (SELECT DoctorId, COUNT(*) AS Visits, SUM(ReviewStatus='approved' OR LocationStatus='verified') AS Verified, MAX(VisitedOn) AS LastVisit
                   FROM VisitLog WHERE VisitedOn >= ? AND VisitedOn < ? + INTERVAL 1 DAY GROUP BY DoctorId) v ON v.DoctorId = d.Id
        LEFT JOIN (SELECT DoctorId, COUNT(*) AS Patients, SUM(GrossAmount) AS Billed
                   FROM PatientDetails WHERE Status = 1 AND RegisteredOn >= ? AND RegisteredOn < ? + INTERVAL 1 DAY GROUP BY DoctorId) p ON p.DoctorId = d.Id
        WHERE v.Visits IS NOT NULL OR p.Patients IS NOT NULL
        ORDER BY COALESCE(p.Billed,0) DESC, COALESCE(v.Visits,0) DESC LIMIT 500`, [f, t, f, t]);
    return { from: f, to: t, rows: rows.map(r => ({ ...r, Billed: Math.round(Number(r.Billed) || 0), LastVisit: r.LastVisit ? moment(r.LastVisit).format('DD MMM') : null })) };
};

module.exports = {
    DAYS, OUTCOMES, distanceM, readPosition, readPhoto,
    getMyDay, getDoctorVisits, getOpenVisit,
    punchIn, punchOut, updateVisitingLogs,
    canViewTeam, getTeamDay, reviewVisit, getVisitPhoto,
    getSchemaInfo, isAssignedTo, getAssignmentBoard, assignDoctors,
    PHOTO_MODES, getPhotoMode, getDefaultPhotoMode, setPhotoMode, setUserPhotoMode, getSettings,
    getPendingLocations, decideLocation, getDoctorROI,
    // older names kept so nothing else breaks
    checkIn: punchIn, checkOut: punchOut,
    getTodaysDoctorListToBeVisted: async (area) => (await getMyDay(0, { area })).doctors,
};
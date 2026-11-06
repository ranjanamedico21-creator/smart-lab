'use strict';
/**
 * models/Packet.js — packet upload, assignment, delivery, return, verification.
 *
 * SECURITY / DATA PATCH (2026-10-25) — every fix is marked ★ in the code.
 *  ★1  ANY logged-in user could mark ANY packet delivered (no "is it assigned to you" check) —
 *      including packets of other agents, un-assigned and returned ones — and choose the delivery time.
 *  ★2  Assigning / re-assigning a DELIVERED packet set it back to ASSIGNED (the delivery row stayed) →
 *      delivered packets re-appeared as pending and the delivery credit moved to another agent.
 *  ★3  "5" !== 5 → every assignment counted as a re-assignment; first assignments saved no AssignedBy /
 *      AssignedAt and no audit row; re-assign saved ChangedBy = NULL (controller never passed it) →
 *      those audit rows were hidden by the JOIN; the reason was thrown away.
 *  ★4  Audit tab only listed Action 'CREATED' / 'UPDATED' — the code writes 'DELIVERED' / 'RETURNED' →
 *      no delivery and no return ever appeared in the audit log. Pagination ignored the page number.
 *  ★5  returnPacket's catch used `res` (undefined here) → every error became a ReferenceError and the
 *      request hung. assignBulk threw `error` (undefined) → same.
 *  ★6  Double-click / two phones: delivery, return and assignment had no row locks → double deliveries,
 *      return of a packet being delivered at the same moment.
 *  ★7  Re-uploading a sheet over-wrote the Name of DELIVERED packets and moved old packets into the new
 *      batch → "Delete batch" deleted packets of an earlier upload.
 *  ★8  Auto-assign could give packets to staff who have left (de-activated users).
 *  ★9  Times: DeliveredAt was written in UTC (toISOString) while everything else is India time → early
 *      morning deliveries landed on the previous day; calendar shifted every day by one (Date → ISO).
 *  ★10 No limits: 100,000-row sheets, 10,000 deliveries in one POST, 5 MB receiver names, any month text.
 *  ★12 (2026-11-03) DISABLED packets, per-permission assigning, reports. A code re-used in a later month
 *      was treated as "already uploaded" and never inserted; agents never saw their returned packets.
 *  ★11 The model required '../routes/packet' (circular require → half-loaded exports depending on
 *      load order) and logged every SQL query. ~1,000 lines of dead / broken code removed.
 */

const fs           = require('fs');
const moment       = require('moment');
const ExcelJS      = require('exceljs');
const dbConnection = require('../config/DBConnection');

const db = () => (dbConnection.pool || dbConnection.connection).promise();
const getConn = () => db().getConnection();

// ─────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────
const userError = (msg) => Object.assign(new Error(msg), { isUserError: true });
const MONTH_RE  = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_RE    = /^\d{4}-\d{2}-\d{2}$/;
const TYPE_RE   = /^[A-Za-z0-9_-]{1,20}$/;
const MAX_ROWS        = parseInt(process.env.PACKET_MAX_ROWS, 10) || 5000;
const MAX_PER_REQUEST = 500;
const MAX_DELIVERIES  = 200;
const MAX_BACKDATE_H  = 7 * 24;        // offline deliveries synced up to 7 days later keep their time

const currentMonth = () => moment().format('YYYY-MM');                 // ★9 local time, not UTC
const nowLocal     = () => moment().format('YYYY-MM-DD HH:mm:ss');
const toId = (v) => { const s = String(v == null ? '' : v).trim(); return /^\d{1,10}$/.test(s) && Number(s) > 0 ? Number(s) : null; };
const cleanText = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const monthOr = (m) => { const s = String(m || '').trim(); return MONTH_RE.test(s) ? s : currentMonth(); };
const checkMonth = (m) => { const s = String(m || '').trim(); if (!MONTH_RE.test(s)) throw userError('Choose a valid month.'); return s; };
const idList = (v) => {
    const arr = Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]);
    if (arr.some(x => !toId(x))) throw userError('Invalid packet selection.');
    return [...new Set(arr.map(toId))];
};

const colCache = new Map();
const hasColumn = async (table, col) => {
    const k = `${table}.${col}`;
    if (!colCache.has(k)) {
        try {
            const [r] = await db().query('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [table, col]);
            colCache.set(k, r.length > 0);
        } catch (_) { colCache.set(k, false); }
    }
    return colCache.get(k);
};

const activeUser = async (exec, userId) => {
    const id = toId(userId);
    if (!id) return null;
    const [[u]] = await exec.query('SELECT Id, FirstName, LastName, IsActive FROM Users WHERE Id = ?', [id]);
    if (!u || (u.IsActive != null && Number(u.IsActive) === 0)) return null;
    return u;
};

// ─────────────────────────────────────────────────────────────────────────────
// Upload
// ─────────────────────────────────────────────────────────────────────────────
const normalizeCell = (val) => {
    if (val === null || val === undefined) return null;
    if (typeof val === 'object') {
        if (val.text) return String(val.text).trim();
        if (val.richText) return val.richText.map(rt => rt.text).join('').trim();
        if (val.result != null) return String(val.result).trim();
        if (val instanceof Date) return moment(val).format('YYYY-MM-DD');
        return null;
    }
    const str = String(val).trim();
    return str === '' ? null : str;
};

const uploadPackets = async (filePath, userId, type, month, fileName) => {
    if (!toId(userId)) throw userError('Please log in again.');
    const t = String(type || '').trim();
    if (!TYPE_RE.test(t)) throw userError('Choose the packet type.');                       // ★10
    const resolvedMonth = monthOr(month);

    const workbook = new ExcelJS.Workbook();
    try { await workbook.xlsx.readFile(filePath); }
    catch (e) { throw userError('This file could not be read. Upload an Excel (.xlsx) file.'); }
    const worksheet = workbook.worksheets[0];
    if (!worksheet) throw userError('The Excel file has no sheet.');
    if (worksheet.actualRowCount > MAX_ROWS + 1) throw userError(`The sheet has ${worksheet.actualRowCount - 1} rows. Upload at most ${MAX_ROWS} at a time.`);

    const rows = new Map();          // packetCode → row  (★10 same code twice in a sheet → first one kept)
    const skipped = [];
    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const code = normalizeCell(row.getCell(1).value);
        const name = normalizeCell(row.getCell(2).value);
        const flag = (normalizeCell(row.getCell(3).value) || '').toLowerCase();
        if (!code && !name && !flag) return;
        if (!code) { skipped.push({ rowNumber, reason: 'Missing packet code' }); return; }
        if (flag !== 'y') { skipped.push({ rowNumber, reason: 'Upload flag is not Y' }); return; }
        const cleanCode = cleanText(code, 60);
        if (!/^[A-Za-z0-9 ._\/-]+$/.test(cleanCode)) { skipped.push({ rowNumber, reason: 'Packet code has unusual characters' }); return; }
        const fullCode = `${cleanCode}-${t}`;
        if (rows.has(fullCode)) { skipped.push({ rowNumber, reason: 'Same packet code twice in this sheet' }); return; }
        rows.set(fullCode, [fullCode, cleanText(name, 150) || null, '', 'UPLOADED', userId, resolvedMonth, t]);
    });
    if (!rows.size) throw userError('No valid rows found in the Excel file (column C must be Y).');

    const conn = await getConn();
    try {
        await conn.beginTransaction();
        const codes = [...rows.keys()];
        const [existing] = await conn.query('SELECT PacketCode, Status FROM Packets WHERE PacketCode IN (?) AND Month = ? FOR UPDATE', [codes, resolvedMonth]);
        const existingSet = new Set(existing.map(r => r.PacketCode));
        const fresh = codes.filter(c => !existingSet.has(c));

        const [batchResult] = await conn.query(
            'INSERT INTO PacketUploadBatches (UploadedBy, Month, Type, FileName, RowCount) VALUES (?, ?, ?, ?, ?)',
            [userId, resolvedMonth, t, cleanText(fileName, 200) || null, fresh.length]);
        const batchId = batchResult.insertId;

        if (fresh.length) {
            await conn.query(`INSERT INTO Packets (PacketCode, Name, Address, Status, CreatedBy, Month, Type, BatchId) VALUES ?`,
                [fresh.map(c => [...rows.get(c), batchId])]);
        }
        // ★7 packets that already exist: only the name of a not-yet-delivered packet is refreshed;
        //    they stay in their own batch (so deleting THIS batch never removes them)
        let refreshed = 0;
        for (const r of existing) {
            if (r.Status === 'DELIVERED' || r.Status === 'RETURNED') continue;
            const [u] = await conn.query('UPDATE Packets SET Name = ? WHERE PacketCode = ? AND Month = ? AND Status IN (\'UPLOADED\', \'ASSIGNED\')',
                [rows.get(r.PacketCode)[1], r.PacketCode, resolvedMonth]);
            refreshed += u.changedRows || 0;
        }

        const autoAssigned = await autoAssignFromHistory(conn, resolvedMonth, userId, 1);
        await conn.query('UPDATE PacketUploadBatches SET AutoAssignedCount = ? WHERE Id = ?', [autoAssigned, batchId]);
        await conn.commit();
        return {
            message: 'Upload successful', batchId,
            inserted: fresh.length, alreadyThere: existing.length, refreshed,
            autoAssigned, skipped: skipped.length, skippedDetails: skipped.slice(0, 50),
        };
    } catch (err) {
        await conn.rollback().catch(() => {});
        if (err && err.code === 'ER_DUP_ENTRY') throw userError('Some packet codes in this sheet already exist in another month and the database does not allow them twice. Nothing was saved.');
        throw err;
    } finally {
        conn.release();
    }
};

/**
 * Assigns this month's UPLOADED, un-assigned packets to the agent who delivered that Name most often
 * (ties → most recent). ★8 only to ACTIVE users. Expects an open transaction on `connection`.
 */
const autoAssignFromHistory = async (connection, month, assignedBy, minConfidence = 2) => {
    const [result] = await connection.query(`
        INSERT INTO PacketAssignments (PacketId, UserId, AssignedBy, AssignedAt)
        SELECT p.Id, best.UserId, ?, ?
        FROM Packets p
        JOIN (
          SELECT ranked.Name, ranked.UserId, ranked.cnt FROM (
            SELECT TRIM(UPPER(pk.Name)) AS Name, d.DeliveredBy AS UserId, COUNT(*) AS cnt,
                   ROW_NUMBER() OVER (PARTITION BY TRIM(UPPER(pk.Name)) ORDER BY COUNT(*) DESC, MAX(d.DeliveredAt) DESC) AS rn
            FROM Deliveries d JOIN Packets pk ON pk.Id = d.PacketId
            GROUP BY TRIM(UPPER(pk.Name)), d.DeliveredBy
          ) ranked
          WHERE ranked.rn = 1 AND ranked.cnt >= ?
        ) best ON best.Name = TRIM(UPPER(p.Name))
        JOIN Users u ON u.Id = best.UserId AND COALESCE(u.IsActive, 1) = 1
        LEFT JOIN PacketAssignments pa ON pa.PacketId = p.Id
        WHERE p.Status = 'UPLOADED' AND p.Month = ? AND pa.Id IS NULL`,
        [assignedBy, nowLocal(), minConfidence, month]);

    if (result.affectedRows > 0) {
        await connection.query(`
            UPDATE Packets p JOIN PacketAssignments pa ON pa.PacketId = p.Id
            SET p.Status = 'ASSIGNED' WHERE p.Status = 'UPLOADED' AND p.Month = ?`, [month]);
    }
    return result.affectedRows;
};

const runAutoAssign = async (month, userId, minConfidence = 1) => {
    const m = checkMonth(month);
    const conn = await getConn();
    try {
        await conn.beginTransaction();
        const count = await autoAssignFromHistory(conn, m, userId, minConfidence);
        await conn.commit();
        return count;
    } catch (err) {
        await conn.rollback().catch(() => {});
        throw err;
    } finally {
        conn.release();
    }
};

const getUploadBatches = async (month) => {
    const [rows] = await db().query(`
        SELECT b.Id, b.Month, b.Type, b.FileName, b.RowCount, b.AutoAssignedCount, b.CreatedAt, u.FirstName, u.LastName,
               COALESCE(SUM(p.Status = 'DELIVERED'), 0) AS deliveredCount,
               COALESCE(SUM(p.Status = 'RETURNED'), 0)  AS returnedCount,
               COALESCE(SUM(p.Status = 'DISABLED'), 0)  AS disabledCount,
               COUNT(p.Id) AS currentPacketCount
        FROM PacketUploadBatches b
        LEFT JOIN Users u ON u.Id = b.UploadedBy
        LEFT JOIN Packets p ON p.BatchId = b.Id
        WHERE b.Month = ? AND b.Deleted = 0
        GROUP BY b.Id ORDER BY b.CreatedAt DESC`, [checkMonth(month)]);
    return rows;
};

/** Delete an upload batch — only if none of its packets was delivered / returned. Locks the packets first (★6). */
const deleteBatch = async (batchId, requestedBy) => {
    const id = toId(batchId);
    if (!id) throw userError('Choose the upload to delete.');
    const conn = await getConn();
    try {
        await conn.beginTransaction();
        const [[batch]] = await conn.query('SELECT Id, Deleted FROM PacketUploadBatches WHERE Id = ? FOR UPDATE', [id]);
        if (!batch || Number(batch.Deleted) === 1) throw userError('Upload not found or already deleted.');
        const [packets] = await conn.query('SELECT Id, Status FROM Packets WHERE BatchId = ? FOR UPDATE', [id]);
        const packetIds = packets.map(p => p.Id);
        if (packetIds.length) {
            const [[worked]] = await conn.query(`
                SELECT (SELECT COUNT(*) FROM Deliveries WHERE PacketId IN (?)) + (SELECT COUNT(*) FROM PacketReturns WHERE PacketId IN (?)) AS n`,
                [packetIds, packetIds]);
            const blocked = packets.filter(p => p.Status === 'DELIVERED' || p.Status === 'RETURNED').length;
            if (blocked || Number(worked.n)) {
                throw userError(`Cannot delete — ${blocked || worked.n} packet(s) of this upload were already delivered or returned. Only untouched uploads can be deleted.`);
            }
            await conn.query('DELETE FROM PacketAssignmentAudit WHERE PacketId IN (?)', [packetIds]);
            await conn.query('DELETE FROM DeliveryAudit WHERE PacketId IN (?)', [packetIds]);
            await conn.query('DELETE FROM PacketDisableLog WHERE PacketId IN (?)', [packetIds]);
            await conn.query('DELETE FROM PacketAssignments WHERE PacketId IN (?)', [packetIds]);
            await conn.query('DELETE FROM Packets WHERE Id IN (?)', [packetIds]);
        }
        const extra = (await hasColumn('PacketUploadBatches', 'DeletedBy')) ? ', DeletedBy = ?, DeletedAt = ?' : '';
        await conn.query(`UPDATE PacketUploadBatches SET Deleted = 1${extra} WHERE Id = ?`, extra ? [requestedBy || null, nowLocal(), id] : [id]);
        await conn.commit();
        return { deletedPackets: packetIds.length };
    } catch (err) {
        await conn.rollback().catch(() => {});
        throw err;
    } finally {
        conn.release();
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// Calendar
// ─────────────────────────────────────────────────────────────────────────────
const getCalendarSummary = async (month) => {
    const m = checkMonth(month);
    // ★9 the day is formatted by MySQL — a JS Date of local midnight turned into the PREVIOUS day by toISOString()
    // Every event counts on the day it happened, so a month shown in the calendar is complete
    // even when the packet belongs to the previous upload month.
    const from = `${m}-01`, to = moment(from, 'YYYY-MM-DD').add(1, 'month').format('YYYY-MM-DD');
    const q = (sql) => db().query(sql, [from, to]).then(r => r[0]);
    const [uploaded, assigned, delivered] = await Promise.all([
        q(`SELECT DATE_FORMAT(CreatedAt, '%Y-%m-%d') AS day, COUNT(*) AS cnt FROM Packets WHERE CreatedAt >= ? AND CreatedAt < ? GROUP BY day`),
        q(`SELECT DATE_FORMAT(AssignedAt, '%Y-%m-%d') AS day, COUNT(*) AS cnt FROM PacketAssignments WHERE AssignedAt >= ? AND AssignedAt < ? GROUP BY day`),
        q(`SELECT DATE_FORMAT(DeliveredAt, '%Y-%m-%d') AS day, COUNT(*) AS cnt FROM Deliveries WHERE DeliveredAt >= ? AND DeliveredAt < ? GROUP BY day`),
    ]);
    const merged = {};
    const addTo = (rows, key) => rows.forEach(r => {
        if (!r.day) return;
        if (!merged[r.day]) merged[r.day] = { uploaded: 0, assigned: 0, delivered: 0 };
        merged[r.day][key] = Number(r.cnt);
    });
    addTo(uploaded, 'uploaded'); addTo(assigned, 'assigned'); addTo(delivered, 'delivered');
    return merged;
};

const getPacketsByDay = async (day, type) => {
    if (!DAY_RE.test(String(day || '')) || !moment(day, 'YYYY-MM-DD', true).isValid()) throw userError('Invalid day.');
    const cfg = {
        uploaded:  { table: 'Packets p', col: 'p.CreatedAt' },
        assigned:  { table: 'Packets p JOIN PacketAssignments pa ON pa.PacketId = p.Id', col: 'pa.AssignedAt' },
        delivered: { table: 'Packets p JOIN Deliveries d ON d.PacketId = p.Id', col: 'd.DeliveredAt' },
    }[type];
    if (!cfg) throw userError('Invalid type.');
    const next = moment(day, 'YYYY-MM-DD').add(1, 'day').format('YYYY-MM-DD');
    const [rows] = await db().query(
        `SELECT p.Id, p.PacketCode, p.Name, p.Status FROM ${cfg.table} WHERE ${cfg.col} >= ? AND ${cfg.col} < ? ORDER BY p.Id DESC LIMIT 1000`,
        [day, next]);
    return rows;
};

// ─────────────────────────────────────────────────────────────────────────────
// Assignment (one engine for single / bulk / re-assign)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * opts.selfOnly      → (non-admin) may only take UN-assigned packets for himself
 * opts.mustBeAssigned → re-assign: packet must currently be assigned to someone else
 * → { assigned, unchanged }
 */
const assignCore = async (packetIdsIn, toUserId, byUserId, opts = {}) => {
    const packetIds = idList(packetIdsIn);
    if (!packetIds.length) throw userError('No packets selected.');
    if (packetIds.length > MAX_PER_REQUEST) throw userError(`Assign at most ${MAX_PER_REQUEST} packets at a time.`);
    const by = toId(byUserId);
    if (!by) throw userError('Please log in again.');
    const reason = cleanText(opts.reason, 255) || null;
    const hasReason = await hasColumn('PacketAssignmentAudit', 'Reason');

    const conn = await getConn();
    try {
        await conn.beginTransaction();
        const target = await activeUser(conn, toUserId);
        if (!target) throw userError('Choose an active staff member to assign to.');
        const to = Number(target.Id);
        if (opts.selfOnly && to !== by) throw userError('You can only take packets for yourself.');

        // ★6 lock the packets, then their assignments
        const [pk] = await conn.query('SELECT Id, PacketCode, Status FROM Packets WHERE Id IN (?) ORDER BY Id FOR UPDATE', [packetIds]);
        const found = new Map(pk.map(p => [Number(p.Id), p]));
        const missing = packetIds.filter(id => !found.has(id));
        if (missing.length) throw userError(`Packet${missing.length > 1 ? 's' : ''} not found: #${missing.slice(0, 10).join(', #')}.`);
        const off = pk.filter(p => p.Status === 'DISABLED');
        if (off.length) throw userError(`Disabled — enable it first: ${off.slice(0, 10).map(p => p.PacketCode).join(', ')}.`);
        if (opts.onlyStatuses) {
            const bad = pk.filter(p => !opts.onlyStatuses.includes(p.Status));
            if (bad.length) throw userError(`You are not allowed to assign these (${bad[0].Status.toLowerCase()}): ${bad.slice(0, 10).map(p => p.PacketCode).join(', ')}.`);
        }
        if (opts.exceptStatuses) {
            const bad = pk.filter(p => opts.exceptStatuses.includes(p.Status));
            if (bad.length) throw userError(`Returned packets can only be re-assigned by the admin or an authorised person: ${bad.slice(0, 10).map(p => p.PacketCode).join(', ')}.`);
        }
        const delivered = pk.filter(p => p.Status === 'DELIVERED');
        if (delivered.length) throw userError(`Already delivered — cannot be assigned again: ${delivered.slice(0, 10).map(p => p.PacketCode).join(', ')}.`);   // ★2

        const [cur] = await conn.query('SELECT PacketId, UserId FROM PacketAssignments WHERE PacketId IN (?) FOR UPDATE', [packetIds]);
        const owner = new Map(cur.map(r => [Number(r.PacketId), Number(r.UserId)]));
        if (opts.selfOnly) {
            const notFree = pk.filter(p => p.Status !== 'UPLOADED' && p.Status !== 'ASSIGNED');
            if (notFree.length) throw userError(`Ask the admin to assign: ${notFree.slice(0, 10).map(p => p.PacketCode).join(', ')}.`);
            const taken = packetIds.filter(id => owner.has(id) && owner.get(id) !== by);
            if (taken.length) throw userError(`Already assigned to someone else: ${taken.slice(0, 10).map(id => found.get(id).PacketCode).join(', ')}. Ask the admin.`);
        }
        if (opts.mustBeAssigned) {
            const id = packetIds[0];
            if (!owner.has(id)) throw userError('This packet is not assigned to anyone — use Assign.');
            if (owner.get(id) === to) throw userError('The packet is already assigned to this person.');
        }

        let assigned = 0, unchanged = 0;
        const now = nowLocal();
        for (const id of packetIds) {
            const old = owner.has(id) ? owner.get(id) : null;
            if (old === to) {                                     // ★3 compare numbers, not "5" vs 5
                unchanged++;
                if (found.get(id).Status !== 'ASSIGNED') await conn.query("UPDATE Packets SET Status = 'ASSIGNED' WHERE Id = ?", [id]);
                continue;
            }
            if (old === null) {
                await conn.query('INSERT INTO PacketAssignments (PacketId, UserId, AssignedBy, AssignedAt) VALUES (?, ?, ?, ?)', [id, to, by, now]);
            } else {
                await conn.query('UPDATE PacketAssignments SET UserId = ?, AssignedBy = ?, AssignedAt = ? WHERE PacketId = ?', [to, by, now, id]);
            }
            // ★3 every (re)assignment is audited with who did it (first assignment: OldUserId NULL)
            await conn.query(
                `INSERT INTO PacketAssignmentAudit (PacketId, OldUserId, NewUserId, ChangedBy, ChangedAt${hasReason ? ', Reason' : ''}) VALUES (?, ?, ?, ?, ?${hasReason ? ', ?' : ''})`,
                hasReason ? [id, old, to, by, now, reason] : [id, old, to, by, now]);
            await conn.query("UPDATE Packets SET Status = 'ASSIGNED' WHERE Id = ? AND Status IN ('UPLOADED', 'RETURNED', 'ASSIGNED')", [id]);
            assigned++;
        }
        await conn.commit();
        return { assigned, unchanged, success: true, message: `${assigned} packet(s) assigned${unchanged ? `, ${unchanged} already with this person` : ''}.` };
    } catch (err) {
        await conn.rollback().catch(() => {});
        throw err;
    } finally {
        conn.release();
    }
};

const assignPackets = async ({ userId, packetIds, assignedBy, selfOnly = false, ...opts }) => assignCore(packetIds, userId, assignedBy, { selfOnly, ...opts });
const assignSingle  = async (packetId, assignedId, adminId) => assignCore([packetId], assignedId, adminId);
const assignBulk    = async (packetIds, userId, adminId, opts = {}) => assignCore(packetIds, userId, adminId, opts);
const reassign      = async (packetId, newUserId, reason, loggedinUserId) => {
    if (!toId(packetId) || !toId(newUserId)) throw userError('Choose the packet and the new person.');
    return assignCore([packetId], newUserId, loggedinUserId, { mustBeAssigned: true, reason });
};

// ─────────────────────────────────────────────────────────────────────────────
// Lists
// ─────────────────────────────────────────────────────────────────────────────
const getAssignedPackets = async (userId, isAdminUser = null) => {
    const admin = isAdminUser != null ? isAdminUser : await require('./User').isAdmin(userId);
    const [rows] = admin
        ? await db().query(`SELECT p.Id, p.PacketCode, p.Name, p.Address FROM Packets p JOIN PacketAssignments pa ON pa.PacketId = p.Id WHERE p.Status = 'ASSIGNED' ORDER BY p.Id`)
        : await db().query(`SELECT p.Id, p.PacketCode, p.Name, p.Address FROM Packets p JOIN PacketAssignments pa ON pa.PacketId = p.Id WHERE pa.UserId = ? AND p.Status = 'ASSIGNED' ORDER BY p.Id`, [userId]);
    return rows;
};

const LAST_RETURN = `
        LEFT JOIN (SELECT PacketId, MAX(Id) AS LastId, COUNT(*) AS Times FROM PacketReturns GROUP BY PacketId) lrx ON lrx.PacketId = p.Id
        LEFT JOIN PacketReturns lr ON lr.Id = lrx.LastId
        LEFT JOIN Users ru ON ru.Id = lr.ReturnedBy`;
const LAST_DISABLE = `
        LEFT JOIN (SELECT PacketId, MAX(Id) AS LastId FROM PacketDisableLog WHERE Action = 'DISABLED' GROUP BY PacketId) ldx ON ldx.PacketId = p.Id AND p.Status = 'DISABLED'
        LEFT JOIN PacketDisableLog ld ON ld.Id = ldx.LastId
        LEFT JOIN Users lu ON lu.Id = ld.DoneBy`;

/** The assign board. { month } or { fromDate, toDate } (YYYY-MM-DD); onlyFree = only un-assigned, no receiver data. Max 5000 rows. */
const getPacketList = async ({ fromDate, toDate, month, onlyFree = false } = {}) => {
    let sql = `
        SELECT p.Id, p.PacketCode, p.Name, p.Address, p.Status, p.CreatedAt, p.Type, p.Month,
               u.Id AS assignedUserId, TRIM(CONCAT_WS(' ', u.FirstName, u.LastName)) AS assignedUser,
               ${onlyFree ? 'NULL AS ReceiverName, NULL AS ReceiverPhone, NULL AS DeliveredAt' : 'd.ReceiverName, d.ReceiverPhone, d.DeliveredAt'},
               lr.Reason AS returnReason, lr.Note AS returnNote, TRIM(CONCAT_WS(' ', ru.FirstName, ru.LastName)) AS returnedByName,
               ld.Reason AS disabledReason, TRIM(CONCAT_WS(' ', lu.FirstName, lu.LastName)) AS disabledByName
        FROM Packets p
        LEFT JOIN PacketAssignments pa ON pa.PacketId = p.Id
        LEFT JOIN Users u ON pa.UserId = u.Id
        LEFT JOIN Deliveries d ON d.PacketId = p.Id
        ${LAST_RETURN}
        ${LAST_DISABLE}
        WHERE 1=1`;
    const params = [];
    if (onlyFree) sql += " AND p.Status = 'UPLOADED' AND pa.Id IS NULL";
    if (month && MONTH_RE.test(month)) { sql += ' AND p.Month = ?'; params.push(month); }
    else {
        if (fromDate && DAY_RE.test(fromDate)) { sql += ' AND p.CreatedAt >= ?'; params.push(fromDate + ' 00:00:00'); }
        if (toDate && DAY_RE.test(toDate))     { sql += ' AND p.CreatedAt <= ?'; params.push(toDate + ' 23:59:59'); }
    }
    const [rows] = await db().query(sql + ' ORDER BY p.Id DESC LIMIT 5000', params);
    return rows;
};

const PAGE_SIZE = 30;
const adminList = async (selectedMonth, pageNo = 1) => {
    const month = monthOr(selectedMonth);
    const auditPage = Math.max(1, Math.min(parseInt(pageNo, 10) || 1, 100000));
    const offset = (auditPage - 1) * PAGE_SIZE;
    const hasReason = await hasColumn('PacketAssignmentAudit', 'Reason');

    const [packets] = await db().query(`
        SELECT p.Id, p.PacketCode, p.Name, p.Address, p.Status, p.Month, p.Type, p.CreatedAt, p.Verified, p.VerifiedAt,
               u.Id AS assignedUserId, TRIM(CONCAT_WS(' ', u.FirstName, u.LastName)) AS assignedUser,
               d.ReceiverName, d.ReceiverPhone, d.DeliveredAt, d.Latitude, d.Longitude,
               du.FirstName AS deliveredByName,
               lr.Reason AS returnReason, lr.Note AS returnNote, TRIM(CONCAT_WS(' ', ru.FirstName, ru.LastName)) AS returnedByName,
               ld.Reason AS disabledReason, TRIM(CONCAT_WS(' ', lu.FirstName, lu.LastName)) AS disabledByName
        FROM Packets p
        LEFT JOIN PacketAssignments pa ON pa.PacketId = p.Id
        LEFT JOIN Users u  ON u.Id = pa.UserId
        LEFT JOIN Deliveries d ON d.PacketId = p.Id
        LEFT JOIN Users du ON du.Id = d.DeliveredBy
        ${LAST_RETURN}
        ${LAST_DISABLE}
        WHERE p.Month = ?
        ORDER BY p.Id DESC`, [month]);

    // ★4 assignments + deliveries + returns, newest first, real paging
    const [auditEvents] = await db().query(`
        SELECT * FROM (
          SELECT 'REASSIGN' AS eventType, a.ChangedAt AS eventAt, p.PacketCode, p.Name AS packetName,
                 old_u.FirstName AS oldUser, new_u.FirstName AS newUser, changer.FirstName AS doneBy,
                 NULL AS receiverName, NULL AS receiverPhone, ${hasReason ? 'a.Reason' : 'NULL'} AS reason
          FROM PacketAssignmentAudit a
          JOIN Packets p ON p.Id = a.PacketId AND p.Month = ?
          LEFT JOIN Users old_u   ON old_u.Id   = a.OldUserId
          LEFT JOIN Users new_u   ON new_u.Id   = a.NewUserId
          LEFT JOIN Users changer ON changer.Id = a.ChangedBy
          UNION ALL
          SELECT 'DELIVERY', da.CreatedAt, p.PacketCode, p.Name, NULL, u.FirstName, u.FirstName, da.NewReceiverName, da.NewPhone, NULL
          FROM DeliveryAudit da
          JOIN Packets p ON p.Id = da.PacketId AND p.Month = ?
          LEFT JOIN Users u ON u.Id = da.DoneBy
          WHERE da.Action IN ('DELIVERED', 'CREATED', 'UPDATED')
          UNION ALL
          SELECT 'RETURN', pr.ReturnedAt, p.PacketCode, p.Name, NULL, NULL, u.FirstName, NULL, NULL,
                 CONCAT(pr.Reason, IF(pr.Note IS NULL OR pr.Note = '', '', CONCAT(' — ', pr.Note)))
          FROM PacketReturns pr
          JOIN Packets p ON p.Id = pr.PacketId AND p.Month = ?
          LEFT JOIN Users u ON u.Id = pr.ReturnedBy
          UNION ALL
          SELECT IF(dl.Action = 'DISABLED', 'DISABLE', 'ENABLE'), dl.DoneAt, p.PacketCode, p.Name, NULL, NULL, u.FirstName, NULL, NULL, dl.Reason
          FROM PacketDisableLog dl
          JOIN Packets p ON p.Id = dl.PacketId AND p.Month = ?
          LEFT JOIN Users u ON u.Id = dl.DoneBy
        ) ev
        ORDER BY eventAt DESC
        LIMIT ? OFFSET ?`, [month, month, month, month, PAGE_SIZE, offset]);

    const [[{ auditTotal }]] = await db().query(`
        SELECT (SELECT COUNT(*) FROM PacketAssignmentAudit a JOIN Packets p ON p.Id = a.PacketId AND p.Month = ?)
             + (SELECT COUNT(*) FROM DeliveryAudit da JOIN Packets p ON p.Id = da.PacketId AND p.Month = ? WHERE da.Action IN ('DELIVERED', 'CREATED', 'UPDATED'))
             + (SELECT COUNT(*) FROM PacketReturns pr JOIN Packets p ON p.Id = pr.PacketId AND p.Month = ?)
             + (SELECT COUNT(*) FROM PacketDisableLog dl JOIN Packets p ON p.Id = dl.PacketId AND p.Month = ?) AS auditTotal`,
        [month, month, month, month]);
    const total = Number(auditTotal) || 0;
    return { packets, month, auditEvents, auditTotal: total, auditPages: Math.ceil(total / PAGE_SIZE) || 1, auditPage };
};

const myPackets = async (userId, month) => {
    const m = monthOr(month);
    const [packets] = await db().query(`
        SELECT p.Id, p.PacketCode, p.Name, p.Address, p.Status, p.Month,
               d.ReceiverName, d.ReceiverPhone, DATE_FORMAT(d.DeliveredAt, '%d %b %Y, %h:%i %p') AS DeliveredAt, d.Latitude, d.Longitude,
               lr.Reason AS returnReason, lr.Note AS returnNote,
               agg.candidates AS suggestedCandidatesRaw
        FROM Packets p
        LEFT JOIN PacketAssignments pa ON pa.PacketId = p.Id
        LEFT JOIN Deliveries d ON d.PacketId = p.Id
        ${LAST_RETURN}
        LEFT JOIN (
          SELECT Name, JSON_ARRAYAGG(JSON_OBJECT('name', ReceiverName, 'phone', ReceiverPhone, 'count', cnt, 'lastDeliveredAt', lastDeliveredAt)) AS candidates
          FROM (
            SELECT Name, ReceiverName, ReceiverPhone, cnt, lastDeliveredAt FROM (
              SELECT p2.Name, d2.ReceiverName, d2.ReceiverPhone, COUNT(*) AS cnt, MAX(d2.DeliveredAt) AS lastDeliveredAt,
                     ROW_NUMBER() OVER (PARTITION BY p2.Name ORDER BY COUNT(*) DESC, MAX(d2.DeliveredAt) DESC) AS rn
              FROM Deliveries d2 JOIN Packets p2 ON p2.Id = d2.PacketId
              GROUP BY p2.Name, d2.ReceiverName, d2.ReceiverPhone
            ) ranked WHERE rn <= 2
          ) top2 GROUP BY Name
        ) agg ON agg.Name = p.Name
        WHERE p.Month = ? AND ((pa.UserId = ? AND p.Status <> 'DISABLED') OR (p.Status = 'RETURNED' AND lr.ReturnedBy = ?))
        ORDER BY CASE p.Status WHEN 'ASSIGNED' THEN 0 ELSE 1 END, p.Id ASC`, [m, userId, userId]);
    return packets.map(r => {
        let candidates = [];
        try { candidates = r.suggestedCandidatesRaw ? (typeof r.suggestedCandidatesRaw === 'string' ? JSON.parse(r.suggestedCandidatesRaw) : r.suggestedCandidatesRaw) : []; }
        catch (_) { candidates = []; }
        const { suggestedCandidatesRaw, ...rest } = r;
        return { ...rest, suggestedCandidates: Array.isArray(candidates) ? candidates : [] };
    });
};

// ─────────────────────────────────────────────────────────────────────────────
// Delivery
// ─────────────────────────────────────────────────────────────────────────────
/** Checks one item from the browser. → { item } or { error } */
const readDelivery = (raw) => {
    if (!raw || typeof raw !== 'object') return { error: 'Invalid delivery data.' };
    const packetId = toId(raw.packetId);
    if (!packetId) return { error: 'Packet ID is missing.' };
    const name = cleanText(raw.receiverName, 100).toUpperCase();
    if (name.length < 2) return { packetId, error: `Receiver name is missing for packet #${packetId}.` };
    if (!/^[\p{L}\p{M} .'-]+$/u.test(name)) return { packetId, error: `Receiver name for packet #${packetId} can have letters, space, dot and hyphen only.` };
    const phone = String(raw.receiverPhone == null ? '' : raw.receiverPhone).replace(/\D/g, '').slice(-10);
    if (!/^[6-9]\d{9}$/.test(phone)) return { packetId, error: `Invalid mobile number for packet #${packetId}. Enter a 10-digit mobile number.` };
    const lat = Number(raw.gps && raw.gps.lat), lng = Number(raw.gps && raw.gps.lng);
    const gpsOk = raw.gps && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
    // ★1 the time comes from the phone: never in the future, at most 7 days back (offline sync); else server time
    const now = moment();
    let at = raw.timestamp ? moment(raw.timestamp, moment.ISO_8601, true) : null;
    if (!at || !at.isValid() || at.isAfter(now) || now.diff(at, 'hours') > MAX_BACKDATE_H) at = now;
    return { item: {
        packetId, name, phone, comment: cleanText(raw.comment, 255) || null,
        lat: gpsOk ? Math.round(lat * 1e7) / 1e7 : null, lng: gpsOk ? Math.round(lng * 1e7) / 1e7 : null,
        at: at.format('YYYY-MM-DD HH:mm:ss'),                    // ★9 local time
    } };
};

/**
 * deliveries: [{ packetId, receiverName, receiverPhone, comment, gps:{lat,lng}, timestamp }]
 * opts.isAdmin → may deliver packets assigned to others (delivery panel for admin).
 * → { success, deliveredNow:[ids], alreadyDelivered:[ids], rejected:[{packetId, reason}] }
 */
const deliverPackets = async (userId, deliveries, opts = {}) => {
    const uid = toId(userId);
    if (!uid) throw userError('Please log in again.');
    if (!Array.isArray(deliveries) || !deliveries.length) throw userError('No delivery data received.');
    if (deliveries.length > MAX_DELIVERIES) throw userError(`Send at most ${MAX_DELIVERIES} deliveries at a time.`);   // ★10

    const items = new Map(), rejected = [];
    for (const raw of deliveries) {
        const r = readDelivery(raw);
        if (r.error) { rejected.push({ packetId: r.packetId || null, reason: r.error }); continue; }
        if (!items.has(r.item.packetId)) items.set(r.item.packetId, r.item);   // same packet twice in one batch → once
    }
    const deliveredNow = [], alreadyDelivered = [];
    if (!items.size) return { success: false, deliveredNow, alreadyDelivered, rejected };

    const conn = await getConn();
    try {
        await conn.beginTransaction();
        const ids = [...items.keys()];
        // ★6 lock the packets: a second click / second phone waits here and then sees DELIVERED
        const [pk] = await conn.query('SELECT Id, PacketCode, Status FROM Packets WHERE Id IN (?) ORDER BY Id FOR UPDATE', [ids]);
        const pkBy = new Map(pk.map(p => [Number(p.Id), p]));
        const [asg] = await conn.query('SELECT PacketId, UserId FROM PacketAssignments WHERE PacketId IN (?)', [ids]);
        const asgBy = new Map(asg.map(a => [Number(a.PacketId), Number(a.UserId)]));
        const [ex] = await conn.query('SELECT PacketId, ReceiverName, ReceiverPhone FROM Deliveries WHERE PacketId IN (?)', [ids]);
        const exBy = new Map(ex.map(e => [Number(e.PacketId), e]));

        const toInsert = [], audit = [];
        for (const it of items.values()) {
            const p = pkBy.get(it.packetId);
            if (!p) { rejected.push({ packetId: it.packetId, reason: `Packet #${it.packetId} not found.` }); continue; }
            const prev = exBy.get(it.packetId);
            if (prev || p.Status === 'DELIVERED') {
                alreadyDelivered.push(it.packetId);
                audit.push([it.packetId, 'SKIPPED_ALREADY_DELIVERED', prev ? prev.ReceiverName : null, it.name, prev ? prev.ReceiverPhone : null, it.phone, it.lat, it.lng, uid]);
                continue;
            }
            if (p.Status === 'DISABLED') { rejected.push({ packetId: it.packetId, reason: `${p.PacketCode} was withdrawn by the admin — do not deliver it.` }); continue; }
            // ★1 must be ASSIGNED, and to this user (admin: to anyone)
            if (p.Status !== 'ASSIGNED' || !asgBy.has(it.packetId)) {
                rejected.push({ packetId: it.packetId, reason: `${p.PacketCode} is not assigned to anyone (${p.Status}) — it cannot be delivered.` }); continue;
            }
            if (asgBy.get(it.packetId) !== uid && !opts.isAdmin) {
                rejected.push({ packetId: it.packetId, reason: `${p.PacketCode} is assigned to someone else.` }); continue;
            }
            toInsert.push([it.packetId, uid, it.name, it.phone, it.comment, it.lat, it.lng, it.at]);
            audit.push([it.packetId, 'DELIVERED', null, it.name, null, it.phone, it.lat, it.lng, uid]);
        }

        if (toInsert.length) {
            await conn.query('INSERT INTO Deliveries (PacketId, DeliveredBy, ReceiverName, ReceiverPhone, Comment, Latitude, Longitude, DeliveredAt) VALUES ?', [toInsert]);
            await conn.query("UPDATE Packets SET Status = 'DELIVERED' WHERE Id IN (?)", [toInsert.map(r => r[0])]);
            toInsert.forEach(r => deliveredNow.push(r[0]));
        }
        if (audit.length) {
            await conn.query('INSERT INTO DeliveryAudit (PacketId, Action, OldReceiverName, NewReceiverName, OldPhone, NewPhone, Latitude, Longitude, DoneBy) VALUES ?', [audit]);
        }
        await conn.commit();
        return { success: deliveredNow.length > 0 || (alreadyDelivered.length > 0 && !rejected.length), deliveredNow, alreadyDelivered, rejected };
    } catch (err) {
        await conn.rollback().catch(() => {});
        throw err;
    } finally {
        conn.release();
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// Return / verify
// ─────────────────────────────────────────────────────────────────────────────
const returnPacket = async (userId, packetId, reason, note) => {
    const pid = toId(packetId), uid = toId(userId);
    const why = cleanText(reason, 100);
    if (!pid || !why) throw userError('Choose the packet and the reason for returning it.');
    if (!uid) throw userError('Please log in again.');
    const conn = await getConn();
    try {
        await conn.beginTransaction();
        // ★6 lock the packet: a return and a delivery of the same packet at the same moment → one wins
        const [[row]] = await conn.query(`
            SELECT p.Id, p.Status, pa.UserId FROM Packets p LEFT JOIN PacketAssignments pa ON pa.PacketId = p.Id
            WHERE p.Id = ? FOR UPDATE`, [pid]);
        if (!row || row.Status !== 'ASSIGNED' || Number(row.UserId) !== uid) throw userError('This packet is not with you any more (already delivered, returned or re-assigned).');
        await conn.query('INSERT INTO PacketReturns (PacketId, ReturnedBy, Reason, Note, ReturnedAt) VALUES (?, ?, ?, ?, ?)', [pid, uid, why, cleanText(note, 255) || null, nowLocal()]);
        await conn.query('DELETE FROM PacketAssignments WHERE PacketId = ?', [pid]);
        await conn.query("UPDATE Packets SET Status = 'RETURNED' WHERE Id = ?", [pid]);
        await conn.query("INSERT INTO DeliveryAudit (PacketId, Action, DoneBy) VALUES (?, 'RETURNED', ?)", [pid, uid]);
        await conn.commit();
        return true;
    } catch (err) {
        await conn.rollback().catch(() => {});        // ★5 was: return res.redirect(...) → ReferenceError, request hung
        throw err;
    } finally {
        conn.release();
    }
};

/** Return several: each one on its own, one failure does not undo the others. → { returned, failed:[reason] } */
const returnPackets = async (userId, packetIdsIn, reason, note) => {
    const ids = idList(packetIdsIn);
    if (!ids.length) throw userError('Choose the packet and the reason for returning it.');
    if (ids.length > MAX_PER_REQUEST) throw userError(`Return at most ${MAX_PER_REQUEST} packets at a time.`);
    let returned = 0; const failed = [];
    for (const id of ids) {
        try { await returnPacket(userId, id, reason, note); returned++; }
        catch (e) { if (!e.isUserError) throw e; failed.push(`#${id}: ${e.message}`); }
    }
    return { returned, failed };
};

// ─────────────────────────────────────────────────────────────────────────────
// Disable / enable (wrong upload). Nothing is deleted; the agent loses the packet at once.
// ─────────────────────────────────────────────────────────────────────────────
const disableCore = async (conn, ids, why, by) => {
    const [pk] = await conn.query('SELECT Id, PacketCode, Status FROM Packets WHERE Id IN (?) ORDER BY Id FOR UPDATE', [ids]);
    const [cur] = await conn.query('SELECT PacketId, UserId FROM PacketAssignments WHERE PacketId IN (?) FOR UPDATE', [ids]);
    const owner = new Map(cur.map(r => [Number(r.PacketId), Number(r.UserId)]));
    const now = nowLocal();
    const out = { disabled: 0, delivered: [], already: 0 };
    for (const p of pk) {
        if (p.Status === 'DELIVERED') { out.delivered.push(p.PacketCode); continue; }
        if (p.Status === 'DISABLED') { out.already++; continue; }
        await conn.query('INSERT INTO PacketDisableLog (PacketId, Action, Reason, PrevStatus, PrevUserId, DoneBy, DoneAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [p.Id, 'DISABLED', why, p.Status, owner.get(Number(p.Id)) || null, by, now]);
        await conn.query('DELETE FROM PacketAssignments WHERE PacketId = ?', [p.Id]);
        await conn.query("UPDATE Packets SET Status = 'DISABLED' WHERE Id = ?", [p.Id]);
        out.disabled++;
    }
    return out;
};
const disableMessage = (r) => [
    `${r.disabled} packet(s) disabled.`,
    r.already ? `${r.already} already disabled.` : '',
    r.delivered.length ? `Not changed, already delivered: ${r.delivered.slice(0, 10).join(', ')}.` : '',
].filter(Boolean).join(' ');

const inTx = async (fn) => {
    const conn = await getConn();
    try {
        await conn.beginTransaction();
        const r = await fn(conn);
        await conn.commit();
        return r;
    } catch (err) {
        await conn.rollback().catch(() => {});
        throw err;
    } finally {
        conn.release();
    }
};

const disablePackets = async (packetIdsIn, reason, byUserId) => {
    const ids = idList(packetIdsIn), by = toId(byUserId), why = cleanText(reason, 255);
    if (!ids.length) throw userError('No packets selected.');
    if (ids.length > MAX_PER_REQUEST) throw userError(`Disable at most ${MAX_PER_REQUEST} packets at a time.`);
    if (!by) throw userError('Please log in again.');
    if (why.length < 3) throw userError('Write why the packet is being disabled.');
    const r = await inTx(conn => disableCore(conn, ids, why, by));
    return { ...r, message: disableMessage(r) };
};

/** Whole upload: everything not yet delivered. */
const disableBatch = async (batchId, reason, byUserId) => {
    const id = toId(batchId), by = toId(byUserId), why = cleanText(reason, 255);
    if (!id) throw userError('Choose the upload.');
    if (!by) throw userError('Please log in again.');
    if (why.length < 3) throw userError('Write why the upload is being disabled.');
    const r = await inTx(async (conn) => {
        const [rows] = await conn.query('SELECT Id FROM Packets WHERE BatchId = ?', [id]);
        if (!rows.length) throw userError('This upload has no packets.');
        return disableCore(conn, rows.map(x => x.Id), why, by);
    });
    return { ...r, message: disableMessage(r) };
};

/** Back to where it was: same person if still active, otherwise un-assigned. */
const enablePackets = async (packetIdsIn, byUserId) => {
    const ids = idList(packetIdsIn), by = toId(byUserId);
    if (!ids.length) throw userError('No packets selected.');
    if (ids.length > MAX_PER_REQUEST) throw userError(`Enable at most ${MAX_PER_REQUEST} packets at a time.`);
    if (!by) throw userError('Please log in again.');
    const r = await inTx(async (conn) => {
        const [pk] = await conn.query('SELECT Id, Status FROM Packets WHERE Id IN (?) ORDER BY Id FOR UPDATE', [ids]);
        const out = { enabled: 0, toPerson: 0, skipped: 0 };
        const now = nowLocal();
        for (const p of pk) {
            if (p.Status !== 'DISABLED') { out.skipped++; continue; }
            const [[log]] = await conn.query("SELECT PrevStatus, PrevUserId FROM PacketDisableLog WHERE PacketId = ? AND Action = 'DISABLED' ORDER BY Id DESC LIMIT 1", [p.Id]);
            let status = log && log.PrevStatus === 'RETURNED' ? 'RETURNED' : 'UPLOADED';
            if (log && log.PrevStatus === 'ASSIGNED' && log.PrevUserId && await activeUser(conn, log.PrevUserId)) {
                await conn.query('INSERT INTO PacketAssignments (PacketId, UserId, AssignedBy, AssignedAt) VALUES (?, ?, ?, ?)', [p.Id, log.PrevUserId, by, now]);
                status = 'ASSIGNED'; out.toPerson++;
            }
            await conn.query('UPDATE Packets SET Status = ? WHERE Id = ?', [status, p.Id]);
            await conn.query('INSERT INTO PacketDisableLog (PacketId, Action, PrevStatus, DoneBy, DoneAt) VALUES (?, ?, ?, ?, ?)', [p.Id, 'ENABLED', 'DISABLED', by, now]);
            out.enabled++;
        }
        return out;
    });
    return { ...r, message: `${r.enabled} packet(s) enabled${r.toPerson ? `, ${r.toPerson} back with the same person` : ''}.${r.skipped ? ` ${r.skipped} were not disabled.` : ''}` };
};

// ─────────────────────────────────────────────────────────────────────────────
// Report
// ─────────────────────────────────────────────────────────────────────────────
const REPORT_PAGE = 100;
const REPORT_EXPORT_MAX = 20000;
const REPORT_STATUSES = ['UPLOADED', 'ASSIGNED', 'DELIVERED', 'RETURNED', 'DISABLED', 'EVER_RETURNED'];
const DATE_BASIS = {
    uploaded: 'p.CreatedAt', assigned: 'pa.AssignedAt', delivered: 'd.DeliveredAt',
    returned: 'lr.ReturnedAt',
};
const REPORT_FROM = `
    FROM Packets p
    LEFT JOIN PacketAssignments pa ON pa.PacketId = p.Id
    LEFT JOIN Users au ON au.Id = pa.UserId
    LEFT JOIN Deliveries d ON d.PacketId = p.Id
    LEFT JOIN Users du ON du.Id = d.DeliveredBy
    ${LAST_RETURN}
    ${LAST_DISABLE}`;
const validDay = (v) => DAY_RE.test(String(v || '')) && moment(v, 'YYYY-MM-DD', true).isValid();
const likeEscape = (v) => v.replace(/[\\%_]/g, (c) => '\\' + c);

/** Cleans what came from the URL. A bad value is dropped, never an error. forUser forces one person (own report). */
const reportFilters = (raw = {}, forUser = null) => {
    const f = { month: '', from: '', to: '', dateBy: 'uploaded', status: '', type: '', q: '', userId: null };
    let from = validDay(raw.from) ? raw.from : '', to = validDay(raw.to) ? raw.to : '';
    if (from && !to) to = from;
    if (to && !from) from = to;
    if (from > to) [from, to] = [to, from];
    f.from = from; f.to = to;
    f.month = from ? '' : monthOr(raw.month);
    if (DATE_BASIS[raw.dateBy]) f.dateBy = raw.dateBy;
    if (REPORT_STATUSES.includes(raw.status)) f.status = raw.status;
    if (TYPE_RE.test(String(raw.type || ''))) f.type = String(raw.type);
    f.q = cleanText(raw.q, 80);
    f.userId = forUser ? toId(forUser) : toId(raw.userId);
    return f;
};

const reportWhere = (f) => {
    const w = [], a = [];
    if (f.from) {
        const next = moment(f.to, 'YYYY-MM-DD').add(1, 'day').format('YYYY-MM-DD');
        w.push(`${DATE_BASIS[f.dateBy]} >= ? AND ${DATE_BASIS[f.dateBy]} < ?`); a.push(f.from, next);
    } else { w.push('p.Month = ?'); a.push(f.month); }
    if (f.status === 'EVER_RETURNED') w.push('lrx.LastId IS NOT NULL');
    else if (f.status) { w.push('p.Status = ?'); a.push(f.status); }
    if (f.type) { w.push('p.Type = ?'); a.push(f.type); }
    if (f.userId) {
        w.push('(pa.UserId = ? OR d.DeliveredBy = ? OR EXISTS (SELECT 1 FROM PacketReturns r WHERE r.PacketId = p.Id AND r.ReturnedBy = ?))');
        a.push(f.userId, f.userId, f.userId);
    }
    if (f.q) {
        const like = `%${likeEscape(f.q)}%`;
        w.push('(p.PacketCode LIKE ? OR p.Name LIKE ? OR d.ReceiverName LIKE ? OR d.ReceiverPhone LIKE ?)');
        a.push(like, like, like, like);
    }
    return { where: 'WHERE ' + w.join(' AND '), args: a };
};

const REPORT_COLS = `
    p.Id, p.PacketCode, p.Name, p.Type, p.Month, p.Status,
    DATE_FORMAT(p.CreatedAt, '%d %b %Y') AS UploadedOn,
    TRIM(CONCAT_WS(' ', au.FirstName, au.LastName)) AS AssignedTo,
    DATE_FORMAT(pa.AssignedAt, '%d %b %Y %h:%i %p') AS AssignedOn,
    TRIM(CONCAT_WS(' ', du.FirstName, du.LastName)) AS DeliveredBy,
    d.DeliveredBy AS DeliveredById,
    d.ReceiverName, d.ReceiverPhone,
    DATE_FORMAT(d.DeliveredAt, '%d %b %Y %h:%i %p') AS DeliveredOn,
    TRIM(CONCAT_WS(' ', ru.FirstName, ru.LastName)) AS ReturnedBy,
    DATE_FORMAT(lr.ReturnedAt, '%d %b %Y %h:%i %p') AS ReturnedOn,
    lr.Reason AS ReturnReason, lr.Note AS ReturnNote, COALESCE(lrx.Times, 0) AS TimesReturned,
    ld.Reason AS DisabledReason, TRIM(CONCAT_WS(' ', lu.FirstName, lu.LastName)) AS DisabledBy`;

const packetReport = async (f, pageNo = 1) => {
    const { where, args } = reportWhere(f);
    const [[sum]] = await db().query(`
        SELECT COUNT(*) AS total, COALESCE(SUM(p.Status = 'UPLOADED'), 0) AS uploaded, COALESCE(SUM(p.Status = 'ASSIGNED'), 0) AS assigned,
               COALESCE(SUM(p.Status = 'DELIVERED'), 0) AS delivered, COALESCE(SUM(p.Status = 'RETURNED'), 0) AS returned,
               COALESCE(SUM(p.Status = 'DISABLED'), 0) AS disabled
        ${REPORT_FROM} ${where}`, args);
    Object.keys(sum).forEach(k => { sum[k] = Number(sum[k]) || 0; });
    const pages = Math.max(1, Math.ceil(sum.total / REPORT_PAGE));
    const page = Math.max(1, Math.min(parseInt(pageNo, 10) || 1, pages));
    const [rows] = await db().query(`SELECT ${REPORT_COLS} ${REPORT_FROM} ${where} ORDER BY p.Id DESC LIMIT ? OFFSET ?`, [...args, REPORT_PAGE, (page - 1) * REPORT_PAGE]);
    // Each packet is counted once, under the person who holds / delivered / returned it now.
    const [people] = await db().query(`
        SELECT x.PersonId, TRIM(CONCAT_WS(' ', u.FirstName, u.LastName)) AS name, x.pending, x.delivered, x.returned
        FROM (
          SELECT CASE p.Status WHEN 'DELIVERED' THEN d.DeliveredBy WHEN 'RETURNED' THEN lr.ReturnedBy ELSE pa.UserId END AS PersonId,
                 SUM(p.Status = 'ASSIGNED') AS pending, SUM(p.Status = 'DELIVERED') AS delivered, SUM(p.Status = 'RETURNED') AS returned
          ${REPORT_FROM} ${where}
          GROUP BY PersonId
        ) x JOIN Users u ON u.Id = x.PersonId
        ORDER BY name`, args);
    return {
        rows, summary: sum, page, pages, pageSize: REPORT_PAGE,
        people: people.map(r => ({ id: r.PersonId, name: r.name, pending: Number(r.pending) || 0, delivered: Number(r.delivered) || 0, returned: Number(r.returned) || 0 })),
    };
};

const packetReportExport = async (f) => {
    const { where, args } = reportWhere(f);
    const [rows] = await db().query(`SELECT ${REPORT_COLS} ${REPORT_FROM} ${where} ORDER BY p.Id DESC LIMIT ?`, [...args, REPORT_EXPORT_MAX]);
    return rows;
};

const getPacketTypes = async () => {
    const [rows] = await db().query("SELECT DISTINCT Type FROM Packets WHERE Type IS NOT NULL AND Type <> '' ORDER BY Type");
    return rows.map(r => r.Type);
};

/** Atomic: only a delivered, not-yet-verified packet. → true if this call verified it. */
const verifyDelivery = async (packetId, adminId = null) => {
    const pid = toId(packetId);
    if (!pid) throw userError('Choose the packet.');
    const by = (await hasColumn('Packets', 'VerifiedBy')) ? ', VerifiedBy = ?' : '';
    const [r] = await db().query(
        `UPDATE Packets SET Verified = 1, VerifiedAt = ?${by} WHERE Id = ? AND Status = 'DELIVERED' AND COALESCE(Verified, 0) = 0`,
        by ? [nowLocal(), adminId, pid] : [nowLocal(), pid]);
    return r.affectedRows > 0;
};

const checkIsDeliveryVerified = async (packetId) => {
    const [rows] = await db().query('SELECT Verified FROM Packets WHERE Id = ?', [toId(packetId) || 0]);
    return rows.length ? Number(rows[0].Verified) || 0 : 0;
};

const checkPacketIsDelivered = async (packetId) => {
    const [rows] = await db().query("SELECT 1 FROM Packets WHERE Id = ? AND Status = 'DELIVERED' LIMIT 1", [toId(packetId) || 0]);
    return rows.length > 0;
};

module.exports = {
    uploadPackets, assignPackets, deliverPackets, getAssignedPackets, getPacketList, adminList,
    reassign, assignSingle, assignBulk, myPackets, returnPacket, verifyDelivery,
    checkIsDeliveryVerified, checkPacketIsDelivered, runAutoAssign, getUploadBatches, deleteBatch,
    getCalendarSummary, getPacketsByDay,
    returnPackets, disablePackets, disableBatch, enablePackets,
    reportFilters, packetReport, packetReportExport, getPacketTypes, REPORT_STATUSES,
    // helpers for the controller
    currentMonth, monthOr, MONTH_RE, readDelivery,
};
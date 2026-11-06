'use strict';
/**
 * controllers/PacketController.js
 *
 * SECURITY PATCH (2026-10-25) — marked ★
 *  ★1  Admin-only actions had no admin check in the code: any logged-in user could open the admin panel
 *      (all receivers' phone numbers), delete whole uploads, run auto-assign, re-assign / bulk-assign
 *      packets to anyone, read the calendar. Now admin only (403 / message otherwise).
 *  ★2  Non-admins could assign ANY packet to ANY person (incl. taking packets away from other agents).
 *      Now a non-admin may only take un-assigned packets for himself.
 *  ★3  8 handlers hung the browser forever on any error (`throw error` in an async handler / empty catch /
 *      `month` not defined in assignSingle / no response in packetDeliverable).
 *  ★4  Offline sync (JSON array body) always failed on the server (JSON.parse(undefined)) but the browser
 *      got a redirect = "200 OK" and DELETED its offline queue → deliveries made offline were lost.
 *      JSON requests now get a JSON answer listing what was saved; the page keeps the rest.
 *  ★5  Success / error messages of assign, re-assign and verify were stored under key 'message' — the
 *      admin page only reads 'flash' → never shown.
 *  ★6  ?month=';alert(1)// went straight into a <script> on the admin page (reflected XSS). Months are
 *      validated everywhere; views get safeJson() for data inside <script>.
 *  ★7  Upload: the uploaded Excel stayed on disk forever (patient/receiver data piling up in uploads/),
 *      month computed in UTC (wrong month from 00:00 to 05:30 IST on the 1st).
 *  ★8  Re-assign never passed the admin id (ChangedBy NULL → audit row invisible), reason lost.
 *  ★9  Error pages showed raw database messages. console.log(users) on every admin page view removed.
 */
/*
 * PERMISSIONS (2026-11-03) — admin has all of them; everyone else needs the row granted on the Authorise page:
 *   /packet/assign          assign + re-assign packets to any staff member
 *   /packet/assignReturned  re-assign packets that came back
 *   /packet/disable         disable / enable a wrongly uploaded packet
 *   /packet/reportAll       report of every staff member (everyone always has his own)
 *   /packet/upload          upload the Excel sheet
 */
require('dotenv').config();
const fs     = require('fs');
const Packet = require('../models/Packet');
const User   = require('../models/User');

const ICON = { success: 'bi-check-circle-fill', danger: 'bi-exclamation-triangle-fill', warning: 'bi-exclamation-triangle-fill', info: 'bi-info-circle-fill' };
const createNotification = (type, messages, icon, alertDismissible = true) => ({ type, messages, icon: icon || ICON[type] || ICON.info, alertDismissible });

// ── helpers ──────────────────────────────────────────────────────────────────
/** ★6 JSON that is safe inside <script>: "</script>" in a receiver name can no longer end the script. */
const safeJson = (v) => JSON.stringify(v === undefined ? null : v)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const render = (res, view, data) => res.render(view, {
    title: 'Packets', BRAND_NAME: process.env.BRAND_NAME, layout: 'loggedInLayout', safeJson, ...data,
});
const userMsg = (e, fallback = 'Something went wrong. Please try again.') => (e && e.isUserError ? e.message : fallback);   // ★9
const logErr  = (where, e) => { if (!e || !e.isUserError) console.error(`[Packet] ${where}:`, e); };
const flash   = (req, type, text) => { if (typeof req.flash === 'function') req.flash('flash', createNotification(type, text)); };
const monthOf = (...vals) => { for (const v of vals) if (Packet.MONTH_RE.test(String(v || ''))) return String(v); return Packet.currentMonth(); };
const adminUrl = (month) => `/packet/adminPacket?month=${encodeURIComponent(monthOf(month))}`;
const wantsJson = (req) => (req.is && req.is('application/json')) || /json/.test(req.get ? (req.get('accept') || '') : '') || req.xhr;

const isAdmin = async (req) => {
    if (!req.user) return false;
    if (req._isAdmin === undefined) req._isAdmin = await User.isAdmin(req.user.Id);
    return req._isAdmin;
};
const SLUG = {
    assign: ['/packet/assign'], assignReturned: ['/packet/assignReturned'], disable: ['/packet/disable'],
    reportAll: ['/packet/reportAll'], board: ['/packets', '/packet/packets'],
};
/** What this person may do. Asked once per request. */
const permsOf = async (req) => {
    if (req._packetPerms) return req._packetPerms;
    const admin = await isAdmin(req);
    const has = async (slugs) => admin || !!(req.user && await User.hasFunction(req, slugs));
    const [assign, assignReturned, disable, reportAll] = await Promise.all([has(SLUG.assign), has(SLUG.assignReturned), has(SLUG.disable), has(SLUG.reportAll)]);
    req._packetPerms = { isAdmin: admin, assign, assignReturned, disable, reportAll, manage: assign || assignReturned || disable };
    return req._packetPerms;
};
const boardUrl = (month) => `/packet/packets?month=${encodeURIComponent(monthOf(month))}`;
const backUrl = (req, perms) => {
    const month = req.body && req.body.month;
    return perms.isAdmin && req.body && req.body.from !== 'board' ? adminUrl(month) : boardUrl(month);
};
const denied = (msg = 'You do not have permission for this.') => Object.assign(new Error(msg), { isUserError: true, status: 403 });
/** Which packets this person may hand out; null = not allowed to hand out at all. */
const assignScope = (perms) => {
    if (perms.assign && perms.assignReturned) return {};
    if (perms.assign) return { exceptStatuses: ['RETURNED'] };
    if (perms.assignReturned) return { onlyStatuses: ['RETURNED'] };
    return null;
};

/** ★1 wraps a handler: admin only. */
const adminOnly = (fn) => async (req, res, next) => {
    try {
        if (await isAdmin(req)) return await fn(req, res, next);
        if (wantsJson(req) || req.method === 'GET' && /calendar|uploadBatches/.test(req.path || '')) {
            return res.status(403).json({ success: false, error: 'Only an admin can do this.' });
        }
        flash(req, 'danger', 'Only an admin can do this.');
        return res.redirect(303, '/packet/myPackets');
    } catch (e) {
        logErr('adminOnly', e);
        return res.status(500).send('Something went wrong.');
    }
};

const userOptions = async () => (await User.getUserList())
    .filter(u => u.IsActive == null || Number(u.IsActive) === 1)          // only staff who still work here
    .map(u => ({ id: u.Id, name: [u.FirstName, u.LastName].filter(Boolean).join(' ').trim() }));

const flashList = (req) => {
    if (typeof req.flash !== 'function') return [];
    const out = [];
    (req.flash('flash') || []).forEach(m => {
        if (!m) return;
        const type = m.type || 'info', icon = m.icon || ICON[type];
        (Array.isArray(m.messages) ? m.messages : [m.messages]).filter(Boolean).forEach(t => out.push(createNotification(type, t, icon)));
    });
    (req.flash('message') || []).forEach(t => out.push(createNotification('info', t)));   // old key, still shown
    return out;
};
const initials = (n) => (!n || typeof n !== 'string') ? '?' : n.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

/** Assign board. Someone with no assign permission sees only free packets and can take them for himself. */
const renderBoard = async (req, res, month, notifications) => {
    const perms = await permsOf(req);
    const [packets, users] = await Promise.all([Packet.getPacketList({ month, onlyFree: !perms.manage }), userOptions()]);
    const me = Number(req.user.Id);
    return render(res, 'Packet/packetView', {
        packets, month, notifications, perms, me, title: 'Assign packets',
        users: assignScope(perms) ? users : users.filter(u => Number(u.id) === me),
    });
};

// ── Upload ───────────────────────────────────────────────────────────────────
const uploadPacketView = async (req, res) => render(res, 'Packet/packetUpload', { title: 'Upload packets', month: Packet.currentMonth(), notifications: flashList(req) });

const uploadPacket = async (req, res) => {
    const filePath = req.file && req.file.path;
    const month = monthOf(req.query.month, req.body && req.body.month);          // ★7 local month
    try {
        if (!filePath) throw Object.assign(new Error('Choose the Excel file to upload.'), { isUserError: true });
        if (!/\.xlsx$/i.test(req.file.originalname || '')) throw Object.assign(new Error('Upload an Excel .xlsx file.'), { isUserError: true });
        const r = await Packet.uploadPackets(filePath, req.user.Id, req.body.type, month, req.file.originalname);
        const parts = [`Uploaded ${r.inserted} new packet(s).`];
        if (r.alreadyThere) parts.push(`${r.alreadyThere} were already uploaded earlier (kept as they are${r.refreshed ? `, ${r.refreshed} name(s) updated` : ''}).`);
        if (r.autoAssigned) parts.push(`${r.autoAssigned} auto-assigned from delivery history.`);
        if (r.skipped) parts.push(`${r.skipped} row(s) skipped (e.g. row ${r.skippedDetails.slice(0, 3).map(s => `${s.rowNumber}: ${s.reason}`).join('; ')}).`);
        flash(req, 'success', parts.join(' '));
        return res.redirect(303, boardUrl(month));                                  // refresh must not upload again
    } catch (error) {
        logErr('uploadPacket', error);
        flash(req, 'danger', userMsg(error, 'The upload failed. Nothing was saved.'));
        return res.redirect(303, '/packet/uploadExcelView');
    } finally {
        if (filePath) fs.unlink(filePath, () => {});                               // ★7 don't keep the sheet on disk
    }
};

const getAllPacket = async (req, res) => {
    try {
        return await renderBoard(req, res, monthOf(req.body && req.body.month, req.query.month), flashList(req));
    } catch (error) {
        logErr('getAllPacket', error);
        return res.status(500).send('Could not load the packets.');
    }
};

// ── Assign ───────────────────────────────────────────────────────────────────
/** One engine: person with permission → any allowed packet to anyone; otherwise only free packets for himself. */
const doAssign = async (req, ids, opts = {}) => {
    const perms = await permsOf(req);
    const scope = assignScope(perms);
    const { userId, reason } = req.body;
    if (!userId) throw Object.assign(new Error('Choose the person to assign to.'), { isUserError: true });
    return scope
        ? Packet.assignBulk(ids, userId, req.user.Id, { ...scope, reason, ...opts })
        : Packet.assignPackets({ userId, packetIds: ids, assignedBy: req.user.Id, selfOnly: true });
};
const answer = async (req, res, fn) => {
    const perms = await permsOf(req);
    try {
        const r = await fn(perms);
        if (wantsJson(req)) { flash(req, 'success', r.message); return res.json({ success: true, ...r }); }
        flash(req, 'success', r.message);
    } catch (error) {
        logErr('packet action', error);
        if (wantsJson(req)) return res.status(error.status || (error.isUserError ? 400 : 500)).json({ success: false, error: userMsg(error) });
        flash(req, 'danger', userMsg(error));
    }
    return res.redirect(303, backUrl(req, perms));
};
const idsFrom = (b) => b.packetIds || b['packetIds[]'] || b.packetId;

const assignPackets = (req, res) => answer(req, res, () => doAssign(req, idsFrom(req.body)));
const assignBulk = assignPackets;
const assignSingle = assignPackets;

const reassign = (req, res) => answer(req, res, async (perms) => {
    if (!perms.assign) throw denied('Only the admin or an authorised person can re-assign.');
    const { packetId, newUserId, reason } = req.body;
    await Packet.reassign(packetId, newUserId, reason, req.user.Id);           // ★8 who + reason saved
    return { message: 'Packet re-assigned.' };
});

const disablePackets = (req, res) => answer(req, res, async (perms) => {
    if (!perms.disable) throw denied('Only the admin or an authorised person can disable packets.');
    return Packet.disablePackets(idsFrom(req.body), req.body.reason, req.user.Id);
});
const enablePackets = (req, res) => answer(req, res, async (perms) => {
    if (!perms.disable) throw denied('Only the admin or an authorised person can enable packets.');
    return Packet.enablePackets(idsFrom(req.body), req.user.Id);
});
const disableBatch = (req, res) => answer(req, res, async (perms) => {
    if (!perms.disable) throw denied('Only the admin or an authorised person can disable packets.');
    return Packet.disableBatch(req.body.batchId, req.body.reason, req.user.Id);
});

// ── Delivery agent ───────────────────────────────────────────────────────────
const packetDeliverable = async (req, res) => {
    try {
        const packets = await Packet.getAssignedPackets(req.user.Id, await isAdmin(req));
        return render(res, 'Packet/deliveryPanel', { packets, title: 'Delivery Panel' });
    } catch (error) {
        logErr('packetDeliverable', error);
        return res.status(500).send('Could not load your packets.');            // ★3 was: no answer at all
    }
};

/**
 * Form POST (deliveries = JSON string) → flash + redirect.
 * JSON body (array, offline sync / delivery panel) → JSON { success, deliveredNow, alreadyDelivered, rejected }.  ★4
 */
const deliverPacket = async (req, res) => {
    const json = Array.isArray(req.body) || wantsJson(req);
    const back = `/packet/myPackets?month=${encodeURIComponent(monthOf(req.body && req.body.month))}`;
    try {
        let deliveries = Array.isArray(req.body) ? req.body : req.body.deliveries;
        if (typeof deliveries === 'string') {
            try { deliveries = JSON.parse(deliveries); } catch (_) { deliveries = null; }
        }
        if (deliveries && !Array.isArray(deliveries) && typeof deliveries === 'object') deliveries = [deliveries];
        if (!Array.isArray(deliveries) || !deliveries.length) throw Object.assign(new Error('No delivery data received.'), { isUserError: true });

        const r = await Packet.deliverPackets(req.user.Id, deliveries, { isAdmin: await isAdmin(req) });
        if (json) return res.status(r.deliveredNow.length || r.alreadyDelivered.length ? 200 : 422).json(r);

        if (r.deliveredNow.length) flash(req, 'success', `${r.deliveredNow.length} packet(s) delivered.`);
        if (r.alreadyDelivered.length) flash(req, 'warning', `${r.alreadyDelivered.length} packet(s) were already delivered — not changed.`);
        if (r.rejected.length) flash(req, 'danger', r.rejected.map(x => x.reason).join(' '));
    } catch (error) {
        logErr('deliverPacket', error);
        if (json) return res.status(error.isUserError ? 400 : 500).json({ success: false, error: userMsg(error, 'Delivery failed — please try again.'), deliveredNow: [], alreadyDelivered: [], rejected: [] });
        flash(req, 'danger', userMsg(error, 'Delivery failed — please try again.'));
    }
    return res.redirect(303, back);
};

const myPackets = async (req, res) => {
    try {
        const month = monthOf(req.body && req.body.month, req.query.month);
        const [packets, userName] = await Promise.all([Packet.myPackets(req.user.Id, month), User.getUserName(req.user.Id)]);
        return render(res, 'Packet/userPanel', { packets, month, userName, initials, perms: await permsOf(req), notifications: flashList(req), title: 'My packets' });
    } catch (error) {
        logErr('myPackets', error);
        return res.status(500).send('Could not load your packets.');            // ★3 was: throw → hang
    }
};

/** ★ PRG: refresh after a return no longer re-posts it. */
const returnPacket = async (req, res) => {
    const month = monthOf(req.body.month, req.query.month);
    try {
        const r = await Packet.returnPackets(req.user.Id, idsFrom(req.body), req.body.reason, req.body.note);
        if (r.returned) flash(req, 'success', `${r.returned} packet(s) returned to the admin.`);
        if (r.failed.length) flash(req, 'danger', r.failed.slice(0, 5).join(' '));
    } catch (error) {
        logErr('returnPacket', error);
        flash(req, 'danger', userMsg(error, 'The packet was NOT returned — please try again.'));
    }
    return res.redirect(303, `/packet/myPackets?month=${encodeURIComponent(month)}`);
};

// ── Report ───────────────────────────────────────────────────────────────────
/** Everyone: his own. /packet/reportAll or admin: anyone. Without the right, ?userId= in the URL is ignored. */
const report = async (req, res) => {
    try {
        const perms = await permsOf(req);
        const filters = Packet.reportFilters(req.query, perms.reportAll ? null : req.user.Id);
        // A packet he returned may later be delivered by a colleague: that receiver's phone is not his to see.
        const mask = (rows) => {
            if (!perms.reportAll) rows.forEach(r => { if (r.DeliveredOn && Number(r.DeliveredById) !== Number(req.user.Id)) { r.ReceiverName = 'Delivered by a colleague'; r.ReceiverPhone = ''; } });
            return rows;
        };
        if (req.query.format === 'csv') {
            const rows = mask(await Packet.packetReportExport(filters));
            const cols = ['PacketCode', 'Name', 'Type', 'Month', 'Status', 'UploadedOn', 'AssignedTo', 'AssignedOn', 'DeliveredBy', 'ReceiverName', 'ReceiverPhone', 'DeliveredOn', 'ReturnedBy', 'ReturnedOn', 'ReturnReason', 'ReturnNote', 'TimesReturned', 'DisabledReason', 'DisabledBy'];
            const cell = (v) => { let t = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return `"${t.replace(/"/g, '""')}"`; };
            const csv = '\uFEFF' + [cols.join(','), ...rows.map(r => cols.map(c => cell(r[c])).join(','))].join('\r\n');
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="packet-report-${filters.from ? `${filters.from}_${filters.to}` : filters.month}.csv"`);
            return res.send(csv);
        }
        const [result, types, users] = await Promise.all([
            Packet.packetReport(filters, req.query.page), Packet.getPacketTypes(), perms.reportAll ? userOptions() : Promise.resolve([]),
        ]);
        mask(result.rows);
        const qs = new URLSearchParams();
        Object.entries(filters).forEach(([k, v]) => { if (v && !(k === 'userId' && !perms.reportAll)) qs.set(k, v); });
        return render(res, 'Packet/report', { ...result, filters, types, users, perms, qs: qs.toString(), notifications: flashList(req), title: 'Packet report' });
    } catch (error) {
        logErr('report', error);
        return res.status(500).send('Could not load the report.');
    }
};

// ── Admin ────────────────────────────────────────────────────────────────────
const adminList = adminOnly(async (req, res) => {
    try {
        const month = monthOf(req.body && req.body.month, req.query.month);
        const { packets, auditEvents, auditTotal, auditPages, auditPage } = await Packet.adminList(month, req.query.auditPage);
        const [userName, users] = await Promise.all([User.getUserName(req.user.Id), userOptions()]);
        const data = Array.isArray(packets) ? packets : [];
        const count = (s) => data.filter(p => (p.Status || '').trim() === s).length;
        const disabled = count('DISABLED');
        const total = data.length - disabled, delivered = count('DELIVERED');   // disabled packets do not lower the delivery rate
        const agentMap = {};
        data.forEach(p => {
            if (!p.assignedUserId) return;
            const a = agentMap[p.assignedUserId] || (agentMap[p.assignedUserId] = { id: p.assignedUserId, name: p.assignedUser || 'Unknown', assigned: 0, delivered: 0 });
            a.assigned++;
            if ((p.Status || '').trim() === 'DELIVERED') a.delivered++;
        });
        return render(res, 'Packet/adminPanel', {
            notifications: flashList(req), packets: data, userName, curMonth: month, month, initials,
            auditPage, auditPages, auditEvents, auditTotal, users, agents: Object.values(agentMap),
            total, delivered, assigned: count('ASSIGNED'), uploaded: count('UPLOADED'), returned: count('RETURNED'), disabled, perms: await permsOf(req),
            rate: total ? Math.round(delivered * 100 / total) : 0,
            withGPS: data.filter(p => p.Status === 'DELIVERED' && p.Latitude).length,
            withoutGPS: data.filter(p => p.Status === 'DELIVERED' && !p.Latitude).length,
            title: 'Packets — Admin',
        });
    } catch (error) {
        logErr('adminList', error);
        return res.status(500).send('Could not load the admin panel.');
    }
});

const verifyPacket = adminOnly(async (req, res) => {
    try {
        if (!(await Packet.checkPacketIsDelivered(req.body.packetId))) throw Object.assign(new Error('This packet is not delivered yet.'), { isUserError: true });
        const ok = await Packet.verifyDelivery(req.body.packetId, req.user.Id);       // atomic: two clicks → one verify
        flash(req, ok ? 'success' : 'warning', ok ? 'Delivery verified.' : 'This delivery was already verified.');
    } catch (error) { logErr('verifyPacket', error); flash(req, 'danger', userMsg(error)); }
    return res.redirect(303, adminUrl(req.body.month));
});

const runAutoAssign = adminOnly(async (req, res) => {
    const month = monthOf(req.body.month);
    try {
        const count = await Packet.runAutoAssign(month, req.user.Id);
        flash(req, 'success', `Auto-assign complete — ${count} packet(s) assigned from delivery history.`);
    } catch (error) { logErr('runAutoAssign', error); flash(req, 'danger', userMsg(error, 'Auto-assign failed.')); }
    return res.redirect(303, adminUrl(month));
});

const listUploadBatches = adminOnly(async (req, res) => {
    try { return res.json({ success: true, batches: await Packet.getUploadBatches(monthOf(req.query.month)) }); }
    catch (error) { logErr('listUploadBatches', error); return res.status(500).json({ success: false, error: userMsg(error, 'Failed to load uploads.') }); }
});

const deleteBatch = adminOnly(async (req, res) => {
    try { return res.json({ success: true, ...(await Packet.deleteBatch(req.body.batchId, req.user.Id)) }); }
    catch (error) { logErr('deleteBatch', error); return res.status(400).json({ success: false, error: userMsg(error, 'Delete failed.') }); }
});

const calendarSummary = adminOnly(async (req, res) => {
    try { return res.json({ success: true, summary: await Packet.getCalendarSummary(monthOf(req.query.month)) }); }
    catch (error) { logErr('calendarSummary', error); return res.status(500).json({ success: false, error: userMsg(error) }); }
});

const calendarDay = adminOnly(async (req, res) => {
    try { return res.json({ success: true, packets: await Packet.getPacketsByDay(req.query.day, req.query.type) }); }
    catch (error) { logErr('calendarDay', error); return res.status(400).json({ success: false, error: userMsg(error) }); }
});

module.exports = {
    uploadPacketView, uploadPacket, getAllPacket, assignPackets, packetDeliverable, deliverPacket, adminList,
    disablePackets, enablePackets, disableBatch, report,
    reassign, assignSingle, assignBulk, myPackets, returnPacket, verifyPacket, runAutoAssign,
    listUploadBatches, deleteBatch, calendarSummary, calendarDay,
    assignPacketsBulk: assignBulk,          // the packet list page calls /packet/assignPacketsBulk
    safeJson,
};
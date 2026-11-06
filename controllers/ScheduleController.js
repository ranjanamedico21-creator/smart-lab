'use strict';

/**
 * ScheduleController.js — marketing team field visits.
 *
 * Pages
 *   GET|POST /schedule/getSchedule        MR: my doctors, punch in / out at each one (mobile first)
 *   GET      /schedule/team               Admin / authorised user: review visits, clinic pins, visits vs business
 * JSON (from the phone)
 *   POST /schedule/api/punch-in    { doctorId, samples:[{lat,lng,acc}], photo, photoAgeSec }
 *   POST /schedule/api/punch-out   { visitId, outcome, notes, nextVisitOn, samples }
 *   GET  /schedule/api/doctor-visits/:doctorId
 *   GET  /schedule/api/visit-photo/:id        (the MR himself or a reviewer)
 *   POST /schedule/api/review/:id   { decision: approved|rejected, note }   (reviewer)
 *   POST /schedule/api/location/:id { approve: 1|0 }                         (reviewer)
 *   POST /schedule/api/settings     { photoMode: required|optional|off }     (reviewer) — default for all
 *   POST /schedule/api/settings/user/:id { photoMode: default|required|optional|off } (reviewer) — one officer
 *   POST /schedule/api/assign       { doctorIds:[..], mrId | '' }             (reviewer) — doctors → MR
 * Legacy
 *   POST /schedule/visiting-logs   (manual log, no GPS / photo)
 */

const Schedule = require('../models/Schedule');
require('dotenv').config();

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const createNotification = (type, messages, icon) => ({ type, messages, icon });
const flash = (req, type, messages) => typeof req.flash === 'function' && req.flash('flash', {
    type, messages, icon: type === 'success' ? 'bi-check-circle-fill' : 'bi-exclamation-triangle-fill' });
const takeFlash = (req) => (typeof req.flash === 'function' ? [].concat(req.flash('flash') || []).filter(n => n && n.type) : []);
const page = (res, view, data) => res.render(view, { BRAND_NAME: process.env.BRAND_NAME, layout: 'loggedInLayout', ...data });
const denied = () => { const e = new Error('Only an admin or an authorised user can do this.'); e.isUserError = true; return e; };

/** JSON helper: user mistakes → 400 with message; anything else → 500, logged. */
const api = (fn) => async (req, res) => {
    try {
        const out = await fn(req, res);
        return res.json({ success: true, ...out });
    } catch (err) {
        if (!err.isUserError) console.error('schedule api:', err);
        return res.status(err.isUserError ? 400 : 500).json({ success: false, message: err.isUserError ? err.message : 'Something went wrong. Please try again.' });
    }
};

// ── Pages ────────────────────────────────────────────────────────────────────

const getTodaysScheduleForVisitingDoctors = asyncHandler(async (req, res) => {
    const src = { ...(req.query || {}), ...(req.body || {}) };
    const data = await Schedule.getMyDay(req.user.Id, {
        day: src.dayOfWeek || src.day, area: src.area, name: src.doctorName || src.q, scope: src.scope,
    });
    res.set('Cache-Control', 'no-store');
    return page(res, 'Doctor/getDoctorsSchedule', { ...data, notifications: takeFlash(req), title: 'My Visits' });
});

const getTeamView = asyncHandler(async (req, res) => {
    if (!(await Schedule.canViewTeam(req.user.Id))) {
        flash(req, 'danger', 'You do not have permission to see the team report.');
        return res.redirect('/schedule/getSchedule');
    }
    const [day, pending, roi, settings, board] = await Promise.all([
        Schedule.getTeamDay({ date: req.query.date, userId: req.query.userId, onlyReview: req.query.review === '1' }),
        Schedule.getPendingLocations(),
        Schedule.getDoctorROI({ from: req.query.from, to: req.query.to }),
        Schedule.getSettings(),
        req.query.tab === 'doctors' ? Schedule.getAssignmentBoard() : null,
    ]);
    res.set('Cache-Control', 'no-store');
    return page(res, 'Doctor/teamVisits', { ...day, pending, roi, settings, board, tab: req.query.tab || 'day', notifications: takeFlash(req), title: 'Team Visits' });
});

// ── JSON ─────────────────────────────────────────────────────────────────────

const punchIn      = api((req) => Schedule.punchIn(req.user.Id, req.body));
const punchOut     = api((req) => Schedule.punchOut(req.user.Id, req.body));
const doctorVisits = api(async (req) => ({ visits: await Schedule.getDoctorVisits(req.params.doctorId) }));

const reviewVisit = api(async (req) => {
    if (!(await Schedule.canViewTeam(req.user.Id))) throw denied();
    return { message: await Schedule.reviewVisit(req.params.id, req.body.decision, req.body.note, req.user.Id) };
});

const decideLocation = api(async (req) => {
    if (!(await Schedule.canViewTeam(req.user.Id))) throw denied();
    return { message: await Schedule.decideLocation(req.params.id, String(req.body.approve) === '1', req.user.Id) };
});

const saveSettings = api(async (req) => {
    if (!(await Schedule.canViewTeam(req.user.Id))) throw denied();
    return { message: await Schedule.setPhotoMode(String(req.body.photoMode || ''), req.user.Id) };
});

const saveUserSettings = api(async (req) => {
    if (!(await Schedule.canViewTeam(req.user.Id))) throw denied();
    return { message: await Schedule.setUserPhotoMode(req.params.id, String(req.body.photoMode || ''), req.user.Id) };
});

const assignDoctors = api(async (req) => {
    if (!(await Schedule.canViewTeam(req.user.Id))) throw denied();
    return Schedule.assignDoctors(req.body.doctorIds, req.body.mrId);
});

const visitPhoto = asyncHandler(async (req, res) => {
    const file = await Schedule.getVisitPhoto(req.params.id, req.user.Id);
    if (!file) return res.status(404).send('Photo not found.');
    res.set('Cache-Control', 'private, max-age=86400');
    res.set('X-Content-Type-Options', 'nosniff');
    return res.sendFile(file);
});

// ── Manual log (no GPS / photo) ──────────────────────────────────────────────

const updateVisitingLogs = asyncHandler(async (req, res) => {
    try {
        flash(req, 'success', await Schedule.updateVisitingLogs(req.body.doctorId, req.body.notes, req.user.Id));
    } catch (err) {
        if (!err.isUserError) console.error('updateVisitingLogs:', err);
        flash(req, 'danger', err.isUserError ? err.message : 'Could not save the visit. Please try again.');
    }
    return res.redirect('/schedule/getSchedule');   // PRG: refresh can't log the same visit twice
});

module.exports = {
    getTodaysScheduleForVisitingDoctors, updateVisitingLogs, getTeamView,
    punchIn, punchOut, doctorVisits, visitPhoto, reviewVisit, decideLocation, saveSettings, saveUserSettings, assignDoctors,
    // older names
    checkIn: punchIn, checkOut: punchOut,
    createNotification,
};
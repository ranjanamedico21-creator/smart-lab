// controllers/LeaveController.js
// PATCH (2026-10-25) — marked ★
//  ★1 Open redirect: returnTo "/\evil.com" passed the check (browsers read "/\" as "//") → after approving
//     a leave the reviewer could be sent to any website. Now only /user/... pages.
//  ★2 Database errors were shown to the user as-is (table / column names, SQL). Now a plain message;
//     details stay in the server log.
//  ★3 The review page offered Approve on the reviewer's OWN request (the model now refuses it) → r.isOwn
//     lets the view hide the buttons.
//  ★4 Reason was not checked (empty / 5,000 characters saved). Remarks limited to 500.
require('dotenv').config();
const moment = require('moment');
const Leave = require('../models/Leave');

const MY_LEAVES_URL = '/user/myLeaves';
const LEAVE_REVIEW_URL = '/user/leaveReview';
const LEAVE_ACTIONS = ['Approved', 'Rejected', 'SentBack'];

const createNotification = (type, messages, icon) => ({ type, messages, icon });
// ★2 only messages written for users are shown; anything else (DB / code errors) becomes a plain sentence
const userMsg = (error, fallback = 'Something went wrong. Please try again.') =>
  (error && (error.isUserError || error.leaveUser) ? error.message : fallback);
const uErr = (msg) => Object.assign(new Error(msg), { leaveUser: true });
// ★1 back to a SmartLab /user/... page only
const safeReturn = (v) => (typeof v === 'string' && /^\/user\/[A-Za-z0-9_\-\/?=&.%]*$/.test(v) && !v.includes('//') ? v : LEAVE_REVIEW_URL);
const okNote = (m) => createNotification('success', m, 'bi-check-circle-fill');
const errNote = (m) => createNotification('danger', m, 'bi-exclamation-triangle-fill');

const leaveView = (extra) => ({
  moment,
  BRAND_NAME: process.env.BRAND_NAME,
  layout: 'loggedInLayout',
  ...extra,
});

// ═══════════════════════ STAFF SIDE ═══════════════════════

const leaveFormValues = (src = {}) => ({
  leaveTypeId: Number(src.leaveTypeId || src.LeaveTypeId) || '',
  startDate: src.startDate || src.StartDate || '',
  endDate: src.endDate || src.EndDate || '',
  reason: src.reason ?? src.Reason ?? '',
});

// Shared by apply and resubmit; throws a message the user can read
const validateLeaveInput = async (userId, body, excludeId = 0) => {
  const { startDate, endDate } = body;
  const leaveTypeId = Number(body.leaveTypeId);
  const reason = (body.reason || '').trim();
  const s = moment(startDate, 'YYYY-MM-DD', true);
  const e = moment(endDate, 'YYYY-MM-DD', true);

  if (!leaveTypeId) throw uErr('Please select a leave type.');
  if (!s.isValid() || !e.isValid()) throw uErr('Please enter valid dates.');
  if (e.isBefore(s)) throw uErr('End date cannot be before the start date.');
  if (reason.length < 3) throw uErr('Please write the reason for the leave.');               // ★4
  if (reason.length > 500) throw uErr('Reason is too long (max 500 characters).');
  if (await Leave.findOwnOverlap(userId, startDate, endDate, excludeId)) {
    throw uErr('You already have a leave application covering some of these dates.');
  }
  return { startDate, endDate, reason, leaveTypeId };
};

const renderLeaveForm = async (res, { editing = null, values = {}, notifications = [] } = {}) => {
  const leaveTypes = await Leave.getLeaveTypes();
  res.render('Leave/leaveApplication', leaveView({
    title: editing ? 'Edit & Resubmit Leave' : 'Leave Application',
    leaveTypes,
    editing,
    values: leaveFormValues(values),
    notifications,
  }));
};

// GET /user/applyLeave
const applyLeavePage = async (req, res) => {
  try {
    await renderLeaveForm(res);
  } catch (error) {
    console.error('applyLeavePage:', error);
    req.flash('myLeaveError', 'Could not open the leave form.');
    res.redirect(MY_LEAVES_URL);
  }
};

// POST /user/applyLeave
const applyLeave = async (req, res) => {
  try {
    const input = await validateLeaveInput(req.user.Id, req.body);
    await Leave.applyLeave(input.startDate, input.endDate, input.reason, req.user.Id, input.leaveTypeId);
    req.flash('myLeaveSuccess', 'Leave applied. You will see the decision here once it is reviewed.');
    res.redirect(MY_LEAVES_URL);
  } catch (error) {
    console.error('applyLeave:', error);
    await renderLeaveForm(res, { values: req.body, notifications: [errNote(userMsg(error, 'The leave was NOT saved because of a server error. Please try again.'))] })
      .catch(() => res.redirect(MY_LEAVES_URL));
  }
};

// GET /user/myLeaves
const myLeavePage = async (req, res) => {
  try {
    const leaves = await Leave.getLeave(req.user.Id); // still has UserSeen=0 → "New update" badges
    await Leave.markLeavesSeen(req.user.Id);           // clear for next visit
    const notifications = [
      ...req.flash('myLeaveSuccess').map(okNote),
      ...req.flash('myLeaveError').map(errNote),
    ];
    res.locals.leaveUpdates = 0;
    res.render('Leave/myLeave', leaveView({ title: 'My Leaves', leaves, notifications }));
  } catch (error) {
    console.error('myLeavePage:', error);
    res.render('home', leaveView({ title: 'Home', notifications: [errNote('Could not load your leaves.')] }));
  }
};

// GET /user/leaves/edit/:id
const editLeavePage = async (req, res) => {
  try {
    const leave = await Leave.getOwnLeave(Number(req.params.id), req.user.Id);
    if (!leave || leave.Status !== 'SentBack') {
      req.flash('myLeaveError', 'Only leaves that were sent back can be edited.');
      return res.redirect(MY_LEAVES_URL);
    }
    await renderLeaveForm(res, { editing: leave, values: leave });
  } catch (error) {
    console.error('editLeavePage:', error);
    req.flash('myLeaveError', 'Could not open this leave.');
    res.redirect(MY_LEAVES_URL);
  }
};

// POST /user/leaves/resubmit
const resubmitLeave = async (req, res) => {
  const leaveId = Number(req.body.leaveId);
  let leave = null;
  try {
    leave = await Leave.getOwnLeave(leaveId, req.user.Id);
    if (!leave || leave.Status !== 'SentBack') throw uErr('Only leaves that were sent back can be resubmitted.');

    const input = await validateLeaveInput(req.user.Id, req.body, leaveId);
    if (!(await Leave.resubmitLeave(leaveId, req.user.Id, input))) throw uErr('This leave could not be resubmitted — it may have been reviewed meanwhile.');

    req.flash('myLeaveSuccess', 'Leave resubmitted for approval.');
    res.redirect(MY_LEAVES_URL);
  } catch (error) {
    console.error('resubmitLeave:', error);
    if (!leave || leave.Status !== 'SentBack') {
      req.flash('myLeaveError', userMsg(error));
      return res.redirect(MY_LEAVES_URL);
    }
    await renderLeaveForm(res, { editing: leave, values: req.body, notifications: [errNote(userMsg(error))] })
      .catch(() => res.redirect(MY_LEAVES_URL));
  }
};

// POST /user/leaves/cancel
const cancelLeave = async (req, res) => {
  try {
    const ok = await Leave.cancelLeave(Number(req.body.leaveId), req.user.Id);
    if (!ok) throw uErr('This leave can no longer be cancelled. It may already have been decided.');
    req.flash('myLeaveSuccess', 'Leave application cancelled.');
  } catch (error) {
    console.error('cancelLeave:', error);
    req.flash('myLeaveError', userMsg(error));
  }
  res.redirect(MY_LEAVES_URL);
};

// ═══════════════════════ ADMIN / REVIEWER SIDE ═══════════════════════

const isLive = (l) => l.Status !== 'SentBack';                     // sent-back leaves don't count as "away"
const covers = (l, key) => l.StartDate <= key && l.EndDate >= key; // 'YYYY-MM-DD' strings

const buildLeaveReviewData = async (monthParam, viewerId = 0) => {
  const requests = await Leave.getUserLeaveRequests();

  let month = moment(monthParam, 'YYYY-MM', true);
  if (!month.isValid()) month = moment();
  const from = month.clone().startOf('month');
  const to = month.clone().endOf('month').startOf('day');
  const fromKey = from.format('YYYY-MM-DD');
  const toKey = to.format('YYYY-MM-DD');
  const todayKey = moment().format('YYYY-MM-DD');

  const monthLeaves = await Leave.getLeavesInRange(fromKey, toKey);

  // One column per day
  const days = [];
  for (let d = from.clone(); d.isSameOrBefore(to, 'day'); d.add(1, 'day')) {
    const key = d.format('YYYY-MM-DD');
    const away = monthLeaves.filter((l) => isLive(l) && covers(l, key));
    days.push({
      key,
      date: d.date(),
      dow: d.format('dd'),
      isSunday: d.day() === 0,
      isToday: key === todayKey,
      offCount: new Set(away.map((l) => l.UserId)).size,
      names: [...new Set(away.map((l) => l.UserName))],
    });
  }

  // One row per staff member with leave this month
  const byUser = new Map();
  monthLeaves.forEach((l) => {
    if (!byUser.has(l.UserId)) byUser.set(l.UserId, { userId: l.UserId, name: l.UserName, leaves: [] });
    byUser.get(l.UserId).leaves.push(l);
  });
  const timeline = [...byUser.values()].map((u) => ({
    ...u,
    cells: days.map((d) => {
      const l = u.leaves.find((x) => covers(x, d.key));
      if (!l) return null;
      const clash = isLive(l) && d.offCount > 1;
      return {
        status: l.Status,
        start: l.StartDate === d.key || d.key === fromKey,
        end: l.EndDate === d.key || d.key === toKey,
        clash,
        title: `${u.name} · ${l.LeaveType || 'Leave'} · ${moment(l.StartDate).format('DD MMM')}–${moment(l.EndDate).format('DD MMM')} · ${l.Status}`
          + (clash ? `\nAlso away ${moment(d.key).format('DD MMM')}: ${d.names.filter((n) => n !== u.name).join(', ')}` : ''),
      };
    }),
  }));

  // For each open request: who else is away on its days (any month)
  let pool = [];
  if (requests.length) {
    const minStart = requests.reduce((m, r) => (r.StartDate < m ? r.StartDate : m), requests[0].StartDate);
    const maxEnd = requests.reduce((m, r) => (r.EndDate > m ? r.EndDate : m), requests[0].EndDate);
    pool = await Leave.getLeavesInRange(minStart, maxEnd);
  }
  requests.forEach((r) => {
    r.isOwn = Number(r.UserId) === Number(viewerId);   // ★3 view: hide Approve / Reject when true
    r.days = moment(r.EndDate).diff(moment(r.StartDate), 'days') + 1;
    r.month = moment(r.StartDate).format('YYYY-MM');
    r.clashes = pool.filter((l) =>
      l.UserId !== r.UserId && isLive(l) && l.StartDate <= r.EndDate && l.EndDate >= r.StartDate);
  });

  return {
    requests,
    timeline,
    days,
    monthLabel: month.format('MMMM YYYY'),
    prevMonth: month.clone().subtract(1, 'month').format('YYYY-MM'),
    nextMonth: month.clone().add(1, 'month').format('YYYY-MM'),
    thisMonth: moment().format('YYYY-MM'),
    clashDays: days.filter((d) => d.offCount > 1).length,
    peakOff: days.reduce((m, d) => Math.max(m, d.offCount), 0),
  };
};

// GET /user/leaveReview?month=YYYY-MM
const LeaveReviewPageForAdmin = async (req, res) => {
  try {
    const data = await buildLeaveReviewData(req.query.month, req.user && req.user.Id);
    const notifications = [
      ...req.flash('leaveSuccess').map(okNote),
      ...req.flash('leaveError').map(errNote),
    ];
    res.render('Admin/Leave/leaveReview', leaveView({
      ...data,
      notifications,
      reviewUrl: safeReturn(req.originalUrl),
      title: 'Leave Review',
    }));
  } catch (error) {
    console.error('LeaveReviewPageForAdmin:', error);
    res.render('home', leaveView({ title: 'Home', notifications: [errNote('Could not load leave requests.')] }));
  }
};

// POST /user/leaveAction  (body: leaveId, status, remarks, returnTo)
const adminActionOnLeave = async (req, res) => {
  const back = safeReturn(req.body.returnTo);       // ★1

  try {
    const { status } = req.body;
    const remarks = (req.body.remarks || '').trim();
    const leaveId = Number(req.body.leaveId);

    if (!leaveId) throw uErr('Invalid leave.');
    if (!LEAVE_ACTIONS.includes(status)) throw uErr('Invalid action.');
    if (status !== 'Approved' && !remarks) {
      throw uErr('Please write a remark when rejecting or sending back a leave, so the staff member knows why.');
    }
    if (remarks.length > 500) throw uErr('Remark is too long (max 500 characters).');   // ★4

    const result = await Leave.actionOnLeave(status, remarks || null, leaveId, req.user.Id);
    if (!result.affectedRows) throw uErr('This leave was already processed.');

    const word = { Approved: 'approved', Rejected: 'rejected', SentBack: 'sent back' }[status];
    req.flash('leaveSuccess', `Leave has been ${word}.`);
  } catch (error) {
    console.error('adminActionOnLeave:', error);
    req.flash('leaveError', userMsg(error));
  }
  res.redirect(back);
};

// ═══════════════════════ NAVBAR BADGE MIDDLEWARE ═══════════════════════
// app.js, after passport.session():  app.use(require('./controllers/LeaveController').leaveUpdatesBadge);
const leaveUpdatesBadge = async (req, res, next) => {
    res.locals.leaveUpdates = 0;
    res.locals.pendingLeaves = 0;
    if (req.user && req.user.Id) {
      try {
        res.locals.leaveUpdates = await Leave.countUnseenLeaveUpdates(req.user.Id);
        if (Number(req.user.IsItAdmin) === 1) {
          res.locals.pendingLeaves = await Leave.countPendingLeaves();
        }
      } catch (e) { /* badges are optional */ }
    }
    next();
  };
module.exports = {
  applyLeavePage,
  applyLeave,
  myLeavePage,
  editLeavePage,
  resubmitLeave,
  cancelLeave,
  LeaveReviewPageForAdmin,
  adminActionOnLeave,
  leaveUpdatesBadge,
};
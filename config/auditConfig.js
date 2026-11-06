'use strict';

/**
 * auditConfig.js — every tunable number of the patient audit / fraud system lives here.
 * Change values, restart the app. Nothing else needs editing.
 */
module.exports = {

    // ── Who can do what (FunctionSlug values in your Functions table) ──────────
    // Admins (Users.IsItAdmin = 1) always pass every check.
    permissions: {
        view:            ['/patientAudit', 'patientAudit'],                  // open Audit Center + patient history
        review:          ['/patientAuditReview', 'patientAuditReview'],      // mark events OK / suspicious / fraud
        editLockedBill:  ['/editBillAfterTest', 'editBillAfterTest',         // change a bill after a test is done
                          '/approveBillReduction', 'approveBillReduction'],
    },

    // Who counts as Admin (always allowed everything). A user is Admin if ANY of these match:
    //   Users.IsItAdmin = 1  ·  Users.IsAdmin = 1  ·  RoleId in adminRoleIds  ·  role name in adminRoleNames
    adminRoleIds:   [],                    // e.g. [1]
    adminRoleNames: ['admin', 'administrator', 'super admin', 'superadmin', 'owner'],

    // ── Prevention ─────────────────────────────────────────────────────────────
    // Before any test of the patient is done → anyone at reception may change the bill
    //   (every change is logged and risk-scored; no time limit, receipt print does not matter).
    // After a test is done → only Admin or a user with "editBillAfterTest" may change the bill.
    lockBillAfterTestDone: true,
    // When does a test count as "done"?
    //   'done'    = patient came out of the room / marked Completed / report ready   (default)
    //   'started' = as soon as the patient enters the room
    lockWhen: 'done',
    // What is locked for reception after that?
    //   'all'        = any bill change: tests, amounts, payment, discount, referring doctor  (default)
    //   'reductions' = only changes that lower money (adding a test / taking more payment still allowed)
    // Name, age, phone and address can always be corrected.
    lockScope: 'all',

    // Risk scoring only (never blocks): a quick self-correction — same user, same day, within
    // quickFixMinutes, before receipt print and before the room — scores quickFixRiskFactor of normal points.
    quickFixMinutes: 15,
    quickFixRiskFactor: 0.4,

    // A reason must be written for every sensitive edit (reduction, doctor/clinic change).
    requireReasonForSensitiveEdit: true,
    minReasonLength: 8,

    // ── Detection thresholds ───────────────────────────────────────────────────
    businessHours: { start: '07:30', end: '21:30' },   // edits outside this get flagged
    largeAmount: 2000,              // ₹ — money impact at/above this adds points
    highDiscountPct: 25,            // registration discount % that gets flagged
    veryHighDiscountPct: 50,
    lateEditMinutes: 60,            // reductions this long after registration get flagged
    repeatEditWarn: 2,              // earlier edits on same bill before this one
    repeatEditHigh: 4,
    thanksTolerance: 1,             // ₹ — thanks above calculated by more than this is flagged

    // Risk level from total points
    levels: [
        { min: 70, level: 'critical' },
        { min: 40, level: 'high' },
        { min: 20, level: 'medium' },
        { min: 1,  level: 'low' },
    ],

    // Points + text for every rule. Set points to 0 to switch a rule off.
    rules: {
        BILL_REDUCED:              { points: 25, label: 'Bill amount reduced' },
        CASH_TAKEN_BACK:           { points: 35, label: 'Cash taken back from the bill' },
        ONLINE_REDUCED:            { points: 15, label: 'Online payment reduced' },
        CASH_TO_ONLINE:            { points: 30, label: 'Cash changed to online — verify in bank statement' },
        ONLINE_TO_CASH:            { points: 10, label: 'Online changed to cash' },
        DUES_WRITTEN_OFF:          { points: 30, label: 'Dues reduced without any payment' },
        DISCOUNT_ADDED_LATER:      { points: 20, label: 'Discount increased after registration' },
        AFTER_RECEIPT:             { points: 40, label: 'Changed after receipt was printed — patient holds a higher receipt' },
        TEST_REMOVED:              { points: 10, label: 'Test removed' },
        TEST_REMOVED_AFTER_START:  { points: 50, label: 'Test removed after patient entered the room' },
        PATIENT_ALREADY_SEEN:      { points: 20, label: 'Reduced after patient finished a test' },
        CROSS_DAY:                 { points: 20, label: 'Changed on a later day' },
        LATE_EDIT:                 { points: 10, label: 'Reduced long after registration' },
        OTHER_USER:                { points: 5,  label: 'Changed by a different user than who registered' },
        DOCTOR_CHANGED:            { points: 15, label: 'Referring doctor changed' },
        DOCTOR_CHANGED_THANKS_PAID:{ points: 30, label: 'Doctor changed after thanks was paid' },
        REPEAT_EDITS:              { points: 10, label: 'Bill edited many times' },
        REPEAT_EDITS_HIGH:         { points: 20, label: 'Bill edited very many times' },
        OFF_HOURS:                 { points: 10, label: 'Done outside business hours' },
        LARGE_AMOUNT:              { points: 15, label: 'Large amount involved' },
        HIGH_DISCOUNT:             { points: 15, label: 'High discount at registration' },
        VERY_HIGH_DISCOUNT:        { points: 30, label: 'Very high discount at registration' },
        PERMISSION_USED:           { points: 0,  label: 'Changed by authorised person after test was done' },
        IN_GRACE:                  { points: 0,  label: 'Quick self-correction (same user, minutes after registration)' },
        CANCEL_AFTER_TEST_DONE:    { points: 50, label: 'Cancelled after test was done / reported' },
        CANCEL_AFTER_DELIVERY:     { points: 60, label: 'Cancelled after report/film was delivered' },
        CANCEL_AFTER_RECEIPT:      { points: 15, label: 'Cancelled after receipt printed — collect original receipt' },
        CANCEL_CROSS_DAY:          { points: 20, label: 'Cancelled on a later day' },
        CANCEL_THANKS_PAID:        { points: 20, label: 'Cancelled after doctor thanks was paid' },
        THANKS_ABOVE_CALCULATED:   { points: 30, label: 'Thanks paid is more than calculated commission' },
        THANKS_CHANGED:            { points: 15, label: 'Thanks amount/receiver changed' },
        THANKS_REMOVED:            { points: 10, label: 'Thanks entry removed' },
    },

    // Dashboard
    // URL of the per-patient audit page in YOUR routes (the route that calls getPatientHistoryPage)
    patientHistoryUrl: '/patient/getPatientHistoryPage?patientId=',
    pageSize: 50,
    alertCacheSeconds: 60,
    defaultRangeDays: 7,
};

const { authorize, authorizeAny } = require("./authorize");

/**
 * Pathology authorization — now just a thin adapter over the project-wide
 * engine in middleware/authorize.js + services/AuthorizationService.js.
 * There is ONE authorization system; this file only exposes pathology's slugs
 * and the helper names the pathology router already uses.
 */

const SLUGS = {
  SPECIMEN: "/pathology/specimens",
  ENTRY:    "/pathology/view/entry",
  VERIFY:   "/pathology/view/verify",
  APPROVE:  "/pathology/view/approve",
  QUEUE:    "/pathology/view/queues",
  ADMIN:    "/pathology/admin"
};

// Names used by routes/pathology.js — delegate straight to the central engine.
const requireFunction    = (slug, opts = {}) => authorize(slug, opts);
const requireAnyFunction = (slugs, opts = {}) => authorizeAny(slugs, opts);

/* Backward-compatible shims for any older pathology code. */
const ACTION_SLUGS = {
  complete: SLUGS.ENTRY, verify: SLUGS.VERIFY, reject: SLUGS.VERIFY,
  approve: SLUGS.APPROVE, deliver: SLUGS.APPROVE
};
const ROLE_SLUGS = { "master:view": SLUGS.ADMIN, "specimen:reject": SLUGS.SPECIMEN };

const requireReportAction = (action) => authorize(ACTION_SLUGS[action] || SLUGS.QUEUE, { json: true });
const requireRole = (perm) => (req, res, next) =>
  authorize(ROLE_SLUGS[perm] || SLUGS.ADMIN, { json: req.method !== "GET" })(req, res, next);

module.exports = {
  SLUGS,
  requireFunction,
  requireAnyFunction,
  requireReportAction,
  requireRole
};
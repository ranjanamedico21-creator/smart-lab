const AuthorizationService = require("../services/AuthorizationService");

/**
 * authorize — project-wide authorization enforcement middleware.
 * Thin enforcement over AuthorizationService (which owns the policy).
 *
 * THREE WAYS TO USE IT:
 *
 *  1) Auto (drop-in replacement for your old checkAuthorisation):
 *       app.get('/registerPatient', authorize(), controller.register)
 *     Derives the slug from req.path — identical behaviour to your existing
 *     middleware for flat, non-parameterized routes.
 *
 *  2) Explicit slug (required for mounted/parameterized routes like pathology,
 *     where req.path carries a live :id and won't match a static slug):
 *       router.post('/reports/:id/verify', authorize('/pathology/view/verify', { json:true }), ctrl.verify)
 *
 *  3) Any-of (shared resources reachable by several functions):
 *       router.get('/reports/:id', authorizeAny([ENTRY, VERIFY, APPROVE], { json:true }), ctrl.get)
 *
 * options.json = true  -> respond 401/403 as JSON (API/AJAX routes)
 * options.json = false -> render the unauthorized page (navigable views, default)
 */

const wantsJson = (req, opts) => {
  if (opts && typeof opts.json === "boolean") return opts.json;
  // Heuristic fallback if not specified: treat XHR / Accept: application/json as JSON.
  return req.xhr || (req.headers.accept || "").indexOf("application/json") !== -1;
};

const denyResponse = (req, res, decision, asJson) => {
  if (!req.user || !req.user.Id) {
    // Not logged in at all.
    if (asJson) return res.status(401).json({ success: false, message: "Authentication required" });
    return res.redirect("/login");
  }
  if (asJson) {
    return res.status(403).json({
      success: false,
      message: "You are not authorized to perform this action.",
      reason: decision ? decision.source : undefined
    });
  }
  return res.status(403).render("error", {
    message: "You are not authorized to access this function. Please contact your administrator.",
    title: "Unauthorized",
    BRAND_NAME: process.env.BRAND_NAME,
    layout: "loggedInLayout"
  });
};

/** Guard against a single slug (or auto-derive from req.path when slug omitted). */
const authorize = (slug = null, options = {}) => {
  return async (req, res, next) => {
    const asJson = wantsJson(req, options);
    const userId = req.user ? req.user.Id : null;
    if (!userId) return denyResponse(req, res, null, asJson);

    const targetSlug = slug || req.path; // auto mode mirrors legacy checkAuthorisation
    const decision = await AuthorizationService.resolve(userId, targetSlug);

    if (decision.allowed) {
      res.locals.authzDecision = decision; // available to downstream/logging
      return next();
    }
    return denyResponse(req, res, decision, asJson);
  };
};

/** Guard if the user can access ANY of the slugs. */
const authorizeAny = (slugs = [], options = {}) => {
  return async (req, res, next) => {
    const asJson = wantsJson(req, options);
    const userId = req.user ? req.user.Id : null;
    if (!userId) return denyResponse(req, res, null, asJson);

    const decision = await AuthorizationService.resolveAny(userId, slugs);
    if (decision.allowed) {
      res.locals.authzDecision = decision;
      return next();
    }
    return denyResponse(req, res, decision, asJson);
  };
};

/**
 * Legacy alias. Your existing routes call checkAuthorisation directly:
 *   app.get('/x', checkAuthorisation, controller)
 * It now runs through the new engine in auto mode with zero code changes.
 */
const checkAuthorisation = authorize();

module.exports = { authorize, authorizeAny, checkAuthorisation };
const AuthorizationModel = require("../models/Authorize");

/**
 * AuthorizationService
 * --------------------
 * The single source of truth for "can user X access function Y?" for the WHOLE
 * project. Policy lives here; SQL lives in AuthorizationModel; enforcement lives
 * in middleware/authorize.js. Nothing else should re-implement this decision.
 *
 * Resolution order (highest precedence first):
 *   1. Admin (IsItAdmin=1)          -> allow  (source: 'admin')
 *   2. Function not registered      -> deny   (source: 'unregistered') + warn
 *   3. Per-user DENY override        -> deny   (source: 'user-deny')
 *   4. Per-user ALLOW override       -> allow  (source: 'user-allow')
 *   5. Any of the user's roles grants -> allow (source: 'role-allow')
 *   6. Otherwise                     -> deny   (source: 'default-deny')
 *
 * A short-TTL cache keeps hot paths off the DB. Permissions change rarely but
 * are read on nearly every request, so this is the right trade-off. After any
 * permission edit, call invalidate(userId) (or invalidateAll()) for immediate
 * consistency; otherwise stale entries expire within TTL.
 */

const CACHE_TTL_MS = parseInt(process.env.AUTHZ_CACHE_TTL_MS || "60000", 10); // 60s
const _cache = new Map(); // key `${userId}:${slug}` -> { decision, expires }

const _cacheGet = (key) => {
  const hit = _cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) { _cache.delete(key); return null; }
  return hit.decision;
};
const _cacheSet = (key, decision) => {
  _cache.set(key, { decision, expires: Date.now() + CACHE_TTL_MS });
};

/**
 * Resolve a full decision for (userId, slug).
 * @returns {Promise<{allowed:boolean, source:string, reason:string}>}
 */
const resolve = async (userId, slug) => {
  if (!userId) {
    return { allowed: false, source: "unauthenticated", reason: "No authenticated user." };
  }
  const key = `${userId}:${slug}`;
  const cached = _cacheGet(key);
  if (cached) return cached;

  let decision;
  try {
    const row = await AuthorizationModel.getDecisionInputs(userId, slug);

    if (!row) {
      decision = { allowed: false, source: "unknown-user", reason: "User not found." };
    } else if (Number(row.isAdmin) === 1) {
      decision = { allowed: true, source: "admin", reason: "User is an administrator." };
    } else if (row.functionId == null) {
      // Slug isn't in the Functions table. Default-deny, but log loudly: this
      // usually means a route was guarded with a slug nobody registered.
      console.warn(`[authz] Unregistered function slug "${slug}" — denying by default. Add it to the Functions table.`);
      decision = { allowed: false, source: "unregistered", reason: `Function "${slug}" is not registered.` };
    } else if (Number(row.userDeny) === 1) {
      decision = { allowed: false, source: "user-deny", reason: "Explicitly denied for this user." };
    } else if (Number(row.userAllow) === 1) {
      decision = { allowed: true, source: "user-allow", reason: "Explicitly granted to this user." };
    } else if (Number(row.roleAllow) === 1) {
      decision = { allowed: true, source: "role-allow", reason: "Granted via one of the user's roles." };
    } else {
      decision = { allowed: false, source: "default-deny", reason: "No grant for this user or their roles." };
    }
  } catch (err) {
    // Fail CLOSED: on any error, deny. Never fail open on authorization.
    console.error("[authz] resolution error:", err);
    return { allowed: false, source: "error", reason: "Authorization check failed." };
  }

  _cacheSet(key, decision);
  return decision;
};

/** Boolean convenience wrapper. */
const can = async (userId, slug) => (await resolve(userId, slug)).allowed;

/** Allow if the user can access ANY of the given slugs (shared reads). */
const canAny = async (userId, slugs = []) => {
  for (const slug of slugs) {
    if (await can(userId, slug)) return true;
  }
  return false;
};

/** Same, returning the winning decision (for explainability/logging). */
const resolveAny = async (userId, slugs = []) => {
  let last = { allowed: false, source: "default-deny", reason: "No matching grant." };
  for (const slug of slugs) {
    const d = await resolve(userId, slug);
    if (d.allowed) return { ...d, slug };
    last = d;
  }
  return last;
};

/** Full permission map with sources — for the admin UI. */
const getEffectivePermissions = (userId) => AuthorizationModel.getEffectivePermissions(userId);

/* ----------------------------- cache control ----------------------------- */
const invalidate = (userId) => {
  const prefix = `${userId}:`;
  for (const key of _cache.keys()) if (key.startsWith(prefix)) _cache.delete(key);
};
const invalidateAll = () => _cache.clear();

module.exports = {
  resolve,
  can,
  canAny,
  resolveAny,
  getEffectivePermissions,
  invalidate,
  invalidateAll,
  CACHE_TTL_MS
};
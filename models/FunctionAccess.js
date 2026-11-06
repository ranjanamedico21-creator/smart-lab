'use strict';

/**
 * FunctionAccess.js — who may use which SmartLab function.
 *
 *   getPageData(userId)          everything the permission page needs (grouped functions, grants, history)
 *   save({ userId, grant, revoke, reason, actorId, ip, userAgent, expectedVersion })
 *                                grants + revokes in ONE transaction, every change logged
 *   canManage(actorId, target)   who may change whose permissions
 *   grantIds(userId)             for "copy permissions from another user"
 *
 * Rules
 *   • Admin (Users.IsItAdmin = 1) or a user with the "/manageUserAccess" function may manage access.
 *   • Nobody (except Admin) changes their OWN permissions — no self-promotion.
 *   • Only Admin may change an Admin's permissions or hand out "/manageUserAccess".
 *   • Sensitive functions (money / cancellation / audit) need a written reason.
 *   • If someone else changed the same user's access after you opened the page, your save is
 *     refused instead of silently overwriting their work.
 */

const crypto       = require('crypto');
const dbConnection = require('../config/DBConnection');

const db  = () => dbConnection.pool.promise();
const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
const toIds = (v) => {
    const arr = Array.isArray(v) ? v : (v === undefined || v === null || v === '' ? [] : [v]);
    return [...new Set(arr.map(x => parseInt(x, 10)).filter(x => Number.isInteger(x) && x > 0))];
};

const MANAGE_SLUGS = ['/manageUserAccess', 'manageUserAccess'];

/** Functions that move money, cancel bills or control auditing — highlighted and need a reason. */
const SENSITIVE_SLUGS = [
    '/manageUserAccess', '/editBillAfterTest', '/approveBillReduction',
    '/cancelPatient', 'cancelPatient', '/patient/cancelPatient', '/cancelThanksPaidPatient',
    '/patientAudit', '/patientAuditReview', '/thanks', '/commission',
];
const isSensitive = (slug) => SENSITIVE_SLUGS.includes(str(slug));

const fullName = (u) => `${str(u.FirstName)} ${str(u.LastName)}`.trim() || str(u.Email) || `User #${u.Id}`;
// Same Admin rule as the audit (IsItAdmin / IsAdmin / admin role) — see config/auditConfig.js
let auditCfg = {};
try { auditCfg = require('../config/auditConfig'); } catch (_) { /* audit not installed */ }
const isAdminRow = (u) => {
    if (!u) return false;
    if (Number(u.IsItAdmin) === 1 || Number(u.IsAdmin) === 1) return true;
    if ((auditCfg.adminRoleIds || []).map(Number).includes(Number(u.RoleId))) return true;
    const rn = str(u.RoleName).toLowerCase();
    return !!rn && (auditCfg.adminRoleNames || ['admin', 'administrator']).map(x => String(x).toLowerCase()).includes(rn);
};
const isActiveRow = (u) => !!u && (u.Status === undefined || u.Status === null || Number(u.Status) === 1);

/** Fingerprint of a user's current grants — detects "someone else saved in between". */
const versionOf = (ids) => crypto.createHash('sha1').update(ids.map(Number).sort((a, b) => a - b).join(',')).digest('hex').slice(0, 16);

// ─────────────────────────────────────────────────────────────────────────────

const getUser = async (q, userId) => {
    const [[u]] = await q.query(
        'SELECT u.*, r.Name AS RoleName FROM Users u LEFT JOIN Roles r ON r.Id = u.RoleId WHERE u.Id = ? LIMIT 1', [userId]);
    if (!u) return null;
    return { Id: u.Id, name: fullName(u), email: str(u.Email), role: str(u.RoleName), isAdmin: isAdminRow(u), active: isActiveRow(u) };
};

const hasManageFunction = async (q, userId) => {
    const [[row]] = await q.query(`
        SELECT 1 AS ok FROM FunctionsAuthorisedToUser fa JOIN Functions f ON f.Id = fa.FunctionId
        WHERE fa.UserId = ? AND f.FunctionSlug IN (?) LIMIT 1`, [userId, MANAGE_SLUGS]);
    return !!row;
};

/** → { ok, isAdmin, message } */
const canManage = async (actorId, targetUserId, q = db()) => {
    const actor = await getUser(q, actorId);
    if (!actor || !actor.active) return { ok: false, message: 'Your account is not active.' };
    const isAdmin = actor.isAdmin;
    if (!isAdmin && !(await hasManageFunction(q, actorId)))
        return { ok: false, message: 'You do not have permission to manage user access.' };
    if (targetUserId != null) {
        if (!isAdmin && String(actorId) === String(targetUserId))
            return { ok: false, message: 'You cannot change your own permissions. Ask an Admin.' };
        const target = await getUser(q, targetUserId);
        if (!target) return { ok: false, message: 'User not found.' };
        if (target.isAdmin && !isAdmin) return { ok: false, message: 'Only an Admin can change the permissions of an Admin.' };
    }
    return { ok: true, isAdmin };
};

const grantIds = async (userId, q = db()) => {
    const [rows] = await q.query('SELECT DISTINCT FunctionId FROM FunctionsAuthorisedToUser WHERE UserId = ?', [userId]);
    return rows.map(r => Number(r.FunctionId));
};

const getHistory = async (userId, limit = 50) => {
    const [rows] = await db().query(`
        SELECT l.*, DATE_FORMAT(l.ChangedAt, '%d-%m-%Y %h:%i %p') AS DisplayAt
        FROM FunctionAccessLog l WHERE l.UserId = ? ORDER BY l.Id DESC LIMIT ?`, [userId, limit])
        .catch(e => (e.code === 'ER_NO_SUCH_TABLE' ? [[]] : Promise.reject(e)));
    return rows;
};

const getPageData = async (userId, actorIsAdmin) => {
    const q = db();
    const [user, [functions], ids, [lastGrant], history, [users]] = await Promise.all([
        getUser(q, userId),
        q.query('SELECT Id, FunctionName, FunctionGroup, FunctionSlug FROM Functions ORDER BY FunctionGroup, FunctionName'),
        grantIds(userId, q),
        q.query(`
            SELECT l.FunctionId, l.ChangedByName, DATE_FORMAT(l.ChangedAt, '%d-%m-%Y') AS On_
            FROM FunctionAccessLog l
            JOIN (SELECT FunctionId, MAX(Id) AS MaxId FROM FunctionAccessLog WHERE UserId = ? AND Action = 'grant' GROUP BY FunctionId) m
              ON m.MaxId = l.Id`, [userId]).catch(e => (e.code === 'ER_NO_SUCH_TABLE' ? [[]] : Promise.reject(e))),
        getHistory(userId, 50),
        q.query('SELECT u.*, r.Name AS RoleName FROM Users u LEFT JOIN Roles r ON r.Id = u.RoleId ORDER BY u.FirstName, u.LastName'),
    ]);
    if (!user) return null;

    const granted = new Set(ids);
    const by = new Map(lastGrant.map(r => [Number(r.FunctionId), { name: r.ChangedByName, on: r.On_ }]));
    const groupMap = new Map();
    functions.forEach(f => {
        const g = str(f.FunctionGroup) || 'Other';
        if (!groupMap.has(g)) groupMap.set(g, []);
        const slug = str(f.FunctionSlug);
        groupMap.get(g).push({
            Id: Number(f.Id), name: str(f.FunctionName) || slug || `Function #${f.Id}`, slug,
            granted: granted.has(Number(f.Id)),
            sensitive: isSensitive(slug),
            lockedForActor: !actorIsAdmin && MANAGE_SLUGS.includes(slug),   // only Admin hands out "manage access"
            grantedBy: by.get(Number(f.Id)) || null,
        });
    });
    const groups = [...groupMap.entries()]
        .sort((a, b) => (a[0] === 'Other') - (b[0] === 'Other') || a[0].localeCompare(b[0]))
        .map(([name, fns]) => ({
        name, functions: fns, granted: fns.filter(x => x.granted).length,
    }));
    // grants pointing at a function that no longer exists (old data)
    const known = new Set(functions.map(f => Number(f.Id)));
    const orphans = ids.filter(id => !known.has(id));

    return {
        user, groups, orphans,
        total: functions.length, grantedCount: ids.filter(id => known.has(id)).length,
        version: versionOf(ids), history,
        users: users.filter(u => isActiveRow(u) && String(u.Id) !== String(userId))
                    .map(u => ({ Id: u.Id, name: fullName(u), role: str(u.RoleName) })),
    };
};

/**
 * One transaction: grant + revoke + log. Returns { success, message, granted, revoked, errors? }
 */
const save = async ({ userId, grant, revoke, reason, actorId, ip, userAgent, expectedVersion }) => {
    const target = parseInt(userId, 10);
    if (!(target > 0)) return { success: false, message: 'Invalid user.' };
    let g = toIds(grant), r = toIds(revoke);
    r = r.filter(id => !g.includes(id));                    // same id in both → ignore the revoke
    const why = str(reason).slice(0, 500);
    if (!g.length && !r.length) return { success: false, message: 'Nothing to save — no permission was changed.' };
    if (g.length + r.length > 500) return { success: false, message: 'Too many changes in one save.' };

    const conn = await db().getConnection();
    try {
        await conn.beginTransaction();

        const auth = await canManage(actorId, target, conn);
        if (!auth.ok) { await conn.rollback(); return { success: false, message: auth.message }; }

        // lock this user's grant rows, then make sure nobody changed them since the page was opened
        const [cur] = await conn.query('SELECT FunctionId FROM FunctionsAuthorisedToUser WHERE UserId = ? FOR UPDATE', [target]);
        const current = [...new Set(cur.map(x => Number(x.FunctionId)))];
        if (expectedVersion && expectedVersion !== versionOf(current)) {
            await conn.rollback();
            return { success: false, stale: true, message: 'Someone else changed this user\'s permissions after you opened the page. The page has been reloaded — please check and save again.' };
        }

        const ids = [...g, ...r];
        const [fns] = await conn.query('SELECT Id, FunctionName, FunctionSlug FROM Functions WHERE Id IN (?)', [ids]);
        const fnById = new Map(fns.map(f => [Number(f.Id), f]));
        const missing = ids.filter(id => !fnById.has(id) && !current.includes(id));
        if (missing.length) { await conn.rollback(); return { success: false, message: 'Some functions no longer exist. Reload the page.' }; }

        g = g.filter(id => !current.includes(id));            // already granted → skip
        r = r.filter(id => current.includes(id));             // not granted → skip
        if (!g.length && !r.length) { await conn.rollback(); return { success: true, message: 'No changes — permissions were already like that.', granted: 0, revoked: 0 }; }

        const slugOf = (id) => str((fnById.get(id) || {}).FunctionSlug);
        if (!auth.isAdmin && [...g, ...r].some(id => MANAGE_SLUGS.includes(slugOf(id)))) {
            await conn.rollback(); return { success: false, message: 'Only an Admin can give or take away "Manage user access".' };
        }
        const needsReason = r.length > 0 || g.some(id => isSensitive(slugOf(id)));
        if (needsReason && why.length < 5) {
            await conn.rollback();
            return { success: false, message: 'Write a reason (at least 5 characters) — needed when removing a permission or giving a sensitive one.' };
        }

        if (g.length) await conn.query('INSERT IGNORE INTO FunctionsAuthorisedToUser (UserId, FunctionId) VALUES ?', [g.map(id => [target, id])]);
        if (r.length) await conn.query('DELETE FROM FunctionsAuthorisedToUser WHERE UserId = ? AND FunctionId IN (?)', [target, r]);

        const actor = await getUser(conn, actorId);
        const rows = [
            ...g.map(id => [target, id, slugOf(id), str((fnById.get(id) || {}).FunctionName), 'grant']),
            ...r.map(id => [target, id, slugOf(id), str((fnById.get(id) || {}).FunctionName) || `#${id}`, 'revoke']),
        ].map(x => [...x, actorId, actor ? actor.name.slice(0, 120) : null, why || null, ip ? String(ip).slice(0, 64) : null, userAgent ? String(userAgent).slice(0, 255) : null]);
        await conn.query(`
            INSERT INTO FunctionAccessLog (UserId, FunctionId, FunctionSlug, FunctionName, Action, ChangedBy, ChangedByName, Reason, IpAddress, UserAgent)
            VALUES ?`, [rows]);

        await conn.commit();
        clearPermissionCaches(target);
        const parts = [];
        if (g.length) parts.push(`${g.length} permission${g.length > 1 ? 's' : ''} given`);
        if (r.length) parts.push(`${r.length} removed`);
        return { success: true, message: `Saved: ${parts.join(', ')}.`, granted: g.length, revoked: r.length };
    } catch (e) {
        await conn.rollback().catch(() => {});
        console.error('[FunctionAccess] save failed:', e.code || '', e.message);
        return { success: false, message: 'Could not save permissions. Please try again.' };
    } finally {
        conn.release();
    }
};

/** Permission checks elsewhere are cached for up to 60 s — clear them so the change works at once. */
const clearPermissionCaches = (userId) => {
    try { const a = require('../services/PatientAuditService'); if (a.clearPermCache) a.clearPermCache(userId); } catch (_) { /* module not installed */ }
    try { process.emit('smartlab:permissions-changed', userId); } catch (_) { /* nobody listening */ }
};

module.exports = { getPageData, save, canManage, grantIds, getHistory, versionOf, isSensitive, MANAGE_SLUGS, SENSITIVE_SLUGS };

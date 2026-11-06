const AuthorizationModel = require("../models/Authorize");
const AuthorizationService = require("../services/AuthorizationService");

/**
 * AuthorizationController
 * Screens for managing project-wide access:
 *   GET  /authorize                     -> pick a user
 *   GET  /authorize/user/:userId         -> manage that user's roles + overrides
 *   POST /authorize/user/:userId/roles   -> save the user's roles
 *   POST /authorize/user/:userId/override-> set/clear one function override
 *   GET  /authorize/role/:roleId         -> manage a role's baseline functions
 *   POST /authorize/role/:roleId         -> save a role's functions
 *
 * Every mutation invalidates the relevant cache so changes take effect instantly.
 */

const wantsJson = (req) =>
  req.xhr || (req.headers.accept || "").indexOf("application/json") !== -1;

/** Build the effective-permission view-model with a derived state + source. */
const decorate = (perms) =>
  perms.map((p) => {
    const userDeny = Number(p.userDeny) === 1;
    const userAllow = Number(p.userAllow) === 1;
    const roleAllow = Number(p.roleAllow) === 1;

    let state, source, override;
    if (userDeny) { state = "denied"; source = "Per-user override (deny)"; override = "deny"; }
    else if (userAllow) { state = "allowed"; source = "Per-user override (allow)"; override = "allow"; }
    else if (roleAllow) { state = "allowed"; source = `Role: ${p.GrantingRoles || "—"}`; override = "inherit"; }
    else { state = "denied"; source = "No grant (default deny)"; override = "inherit"; }

    return {
      FunctionId: p.FunctionId,
      FunctionName: p.FunctionName,
      FunctionGroup: p.FunctionGroup,
      FunctionSlug: p.FunctionSlug,
      GrantingRoles: p.GrantingRoles || null,
      roleAllow,
      state,         // 'allowed' | 'denied'
      source,        // human-readable reason
      override       // current per-user override selection: 'allow' | 'deny' | 'inherit'
    };
  });

/* ------------------------------- USER PICKER ------------------------------- */
exports.renderUserPicker = async (req, res) => {
  try {
    const users = await AuthorizationModel.getAllUsers();
    res.render("Authorization/user-picker", {
      users,
      title: "Access Control",
      BRAND_NAME: process.env.BRAND_NAME,
      layout: "loggedInLayout"
    });
  } catch (e) {
    console.error(e);
    res.status(500).render("error", { message: e.message, title: "Error", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout" });
  }
};

/* --------------------------- USER AUTHORIZATION --------------------------- */
exports.renderUserAuthorization = async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    const user = await AuthorizationModel.getUserById(userId);
    if (!user) {
      return res.redirect("/authorize?toast=" + encodeURIComponent("User not found") + "&type=error");
    }

    const [allRoles, userRoles, perms] = await Promise.all([
      AuthorizationModel.getAllRoles(),
      AuthorizationModel.getUserRoles(userId),
      AuthorizationModel.getEffectivePermissions(userId)
    ]);

    const userRoleIds = userRoles.map((r) => r.Id);
    const functions = decorate(perms);

    // Group functions for the accordion (matches your existing UI pattern).
    const groups = {};
    functions.forEach((f) => {
      (groups[f.FunctionGroup] = groups[f.FunctionGroup] || []).push(f);
    });

    res.render("Authorization/user-authorization", {
      user,
      allRoles,
      userRoleIds,
      groups,
      isAdmin: Number(user.IsItAdmin) === 1,
      title: `Access — ${user.FullName || "User #" + userId}`,
      BRAND_NAME: process.env.BRAND_NAME,
      layout: "loggedInLayout"
    });
  } catch (e) {
    console.error(e);
    res.status(500).render("error", { message: e.message, title: "Error", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout" });
  }
};

exports.updateUserRoles = async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    let roleIds = req.body.roleIds || [];
    if (!Array.isArray(roleIds)) roleIds = [roleIds]; // single checkbox posts a scalar
    roleIds = roleIds.map((n) => parseInt(n, 10)).filter((n) => !isNaN(n));

    await AuthorizationModel.setUserRoles(userId, roleIds);
    AuthorizationService.invalidate(userId);

    if (wantsJson(req)) return res.json({ success: true, message: "Roles updated" });
    res.redirect(`/authorize/user/${userId}?toast=` + encodeURIComponent("Roles updated") + "&type=success");
  } catch (e) {
    console.error(e);
    if (wantsJson(req)) return res.status(500).json({ success: false, message: e.message });
    res.redirect(`/authorize/user/${req.params.userId}?toast=` + encodeURIComponent(e.message) + "&type=error");
  }
};

/** AJAX: set one function override to allow / deny / inherit (clear). */
exports.updateUserOverride = async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    const functionId = parseInt(req.body.functionId, 10);
    let effect = req.body.effect; // 'allow' | 'deny' | 'inherit'

    if (isNaN(userId) || isNaN(functionId)) {
      return res.status(400).json({ success: false, message: "Invalid user or function" });
    }
    if (!["allow", "deny", "inherit"].includes(effect)) {
      return res.status(400).json({ success: false, message: "Invalid effect" });
    }
    if (effect === "inherit") effect = null; // null clears the override

    await AuthorizationModel.setUserOverride(userId, functionId, effect);
    AuthorizationService.invalidate(userId);

    // Return the re-resolved state for this one function so the UI can update live.
    const perms = await AuthorizationModel.getEffectivePermissions(userId);
    const updated = decorate(perms).find((f) => f.FunctionId === functionId);
    res.json({ success: true, message: "Override updated", function: updated });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: e.message });
  }
};

/* --------------------------- ROLE AUTHORIZATION --------------------------- */
exports.renderRoleAuthorization = async (req, res) => {
  try {
    const roleId = parseInt(req.params.roleId, 10);
    const [allRoles, allFunctions, roleFnIds] = await Promise.all([
      AuthorizationModel.getAllRoles(),
      AuthorizationModel.getAllFunctions(),
      AuthorizationModel.getRoleFunctions(roleId)
    ]);
    const role = allRoles.find((r) => r.Id === roleId);
    if (!role) return res.redirect("/authorize?toast=" + encodeURIComponent("Role not found") + "&type=error");

    const groups = {};
    allFunctions.forEach((f) => {
      (groups[f.FunctionGroup] = groups[f.FunctionGroup] || []).push(f);
    });

    res.render("Authorization/role-authorization", {
      role,
      allRoles,
      groups,
      roleFnIds,
      title: `Role Access — ${role.Name}`,
      BRAND_NAME: process.env.BRAND_NAME,
      layout: "loggedInLayout"
    });
  } catch (e) {
    console.error(e);
    res.status(500).render("error", { message: e.message, title: "Error", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout" });
  }
};

exports.updateRoleFunctions = async (req, res) => {
  try {
    const roleId = parseInt(req.params.roleId, 10);
    let functionIds = req.body.functionIds || [];
    if (!Array.isArray(functionIds)) functionIds = [functionIds];
    functionIds = functionIds.map((n) => parseInt(n, 10)).filter((n) => !isNaN(n));

    await AuthorizationModel.setRoleFunctions(roleId, functionIds);
    // A role change can affect many users; clear the whole cache.
    AuthorizationService.invalidateAll();

    if (wantsJson(req)) return res.json({ success: true, message: "Role functions updated" });
    res.redirect(`/authorize/role/${roleId}?toast=` + encodeURIComponent("Role functions updated") + "&type=success");
  } catch (e) {
    console.error(e);
    if (wantsJson(req)) return res.status(500).json({ success: false, message: e.message });
    res.redirect(`/authorize/role/${req.params.roleId}?toast=` + encodeURIComponent(e.message) + "&type=error");
  }
};

const path = require('path');
const fs   = require('fs');

exports.uploadUserSignature = async (req, res) => {
    const userId = parseInt(req.params.userId, 10);
    if (!userId) return res.json({ success: false, message: 'Invalid user ID.' });

    try {
        const qualification = (req.body.qualification || '').trim();
        const newFile       = req.file;   // set by multer, undefined if no file uploaded

        // ── Fetch current signature path so we can delete old file ──
        const currentUser = await AuthorizationModel.getUserById(userId);

        if (newFile) {
            // Delete old signature from disk if it exists
            if (currentUser && currentUser.SignaturePath) {
                try {
                    const oldAbs = path.resolve(currentUser.SignaturePath);
                    if (fs.existsSync(oldAbs)) fs.unlinkSync(oldAbs);
                } catch (_) { /* old file missing — ignore */ }
            }
        }

        // ── Determine the path to save in DB ────────────────────────
        // If a new file was uploaded use it; otherwise keep existing path
        const sigPath = newFile
            ? newFile.path.replace(/\\/g, '/')   // normalise Windows backslashes
            : (currentUser ? currentUser.SignaturePath : null);

        // ── Persist to DB ────────────────────────────────────────────
        await AuthorizationModel.saveUserSignature(userId, sigPath, qualification);

        // ── Build public URL for the browser to show thumbnail ───────
        // Assumes Express serves ./uploads as /uploads
        const signatureUrl = sigPath
            ? '/uploads/signatures/' + path.basename(sigPath)
            : null;

        return res.json({
            success:       true,
            signaturePath: sigPath,
            signatureUrl,
            qualification,
            message:       'Saved successfully.'
        });

    } catch (err) {
        console.error('[uploadUserSignature]', err);
        // Clean up uploaded file if DB write failed
        if (req.file) {
            try { fs.unlinkSync(req.file.path); } catch (_) {}
        }
        return res.json({ success: false, message: err.message });
    }
};
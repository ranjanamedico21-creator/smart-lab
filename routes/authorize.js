const express = require("express");
const router = express.Router();
const AuthorizationController = require("../controllers/AuthorizationController");
const { authorize } = require("../middleware/authorize");

/*
 * Access-control management screens. These are themselves guarded by the
 * '/authz' function — register it in Functions and grant it only to admins
 * (admins bypass anyway via IsItAdmin, so this mainly governs non-admin
 * "user managers" you may create later).
 *
 *   INSERT INTO Functions (Id, FunctionName, FunctionSlug, FunctionGroup)
 *   VALUES (200, 'Access Control', '/authz', 'Administration');
 */
const guard = authorize("/authorize");                 // page mode
const guardJson = authorize("/authorize", { json: true }); // AJAX mode

// User picker + per-user authorization
router.get("/", guard, AuthorizationController.renderUserPicker);
router.get("/user/:userId", guard, AuthorizationController.renderUserAuthorization);
router.post("/user/:userId/roles", guard, AuthorizationController.updateUserRoles);
router.post("/user/:userId/override", guardJson, AuthorizationController.updateUserOverride);

// Per-role baseline functions
router.get("/role/:roleId", guard, AuthorizationController.renderRoleAuthorization);
router.post("/role/:roleId", guard, AuthorizationController.updateRoleFunctions);


const multer = require('multer');
const fs     = require('fs');
const path   = require('path');

const sigStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = './uploads/signatures';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: function (req, file, cb) {
        const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
        cb(null, 'sig_' + req.params.userId + '_' + Date.now() + ext);
    }
});

const sigUpload = multer({
    storage: sigStorage,
    limits:  { fileSize: 2 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Only image files are allowed.'));
    }
});

router.post('/user/:userId/signature', guard,sigUpload.single('signature'),AuthorizationController.uploadUserSignature);

module.exports = router;
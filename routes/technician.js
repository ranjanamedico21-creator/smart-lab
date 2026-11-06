// ═══════════════════════════════════════════════════════════════════
// routes/technician.js
// ═══════════════════════════════════════════════════════════════════
const express              = require('express');
const router               = express.Router();
const TechnicianController = require('../controllers/TechnicianController');

const checkLoggedIn = (req, res, next) => {
    if (req.isAuthenticated()) return next();
    return res.redirect('/user/login');
};

const isTechnician = (req, res, next) => {
    const techRoles = ['CT Technician','MRI Technician','Xray Technician','Lab Technician','Admin'];
    if (req.user?.roles?.some(r => techRoles.includes(r))) return next();
    req.flash('message', JSON.stringify({
        type:'danger', msg:'Access denied.', icon:'bi-shield-exclamation'
    }));
    return res.redirect('/home');
};

router.get('/dashboard',     checkLoggedIn, isTechnician, TechnicianController.getDashboard);
router.post('/startTest',    checkLoggedIn, isTechnician, TechnicianController.startTest);
router.post('/completeTest', checkLoggedIn, isTechnician, TechnicianController.completeTest);
router.post('/abortTest',    checkLoggedIn, isTechnician, TechnicianController.abortTest);
router.post('/moveUp',       checkLoggedIn, isTechnician, TechnicianController.moveUp);
router.post('/saveOrder',    checkLoggedIn, isTechnician, TechnicianController.saveOrder);

module.exports = router;

// ── Queue view — reception, marketing, admin, technicians ─────────
const canPrioritise = (req, res, next) => {
    const allowed = ['Admin','Reception','Marketing',
                     'CT Technician','MRI Technician','Xray Technician','Lab Technician'];
    if (req.user?.roles?.some(r => allowed.includes(r))) return next();
    return res.status(403).json({ success:false, message:'Access denied.' });
};

router.get('/queueView',   checkLoggedIn, canPrioritise, TechnicianController.getQueueView);
router.post('/prioritise', checkLoggedIn, canPrioritise, TechnicianController.prioritisePatient);

router.post('/moveToPosition', checkLoggedIn, canPrioritise, TechnicianController.moveToPosition);
'use strict';

/**
 * Mount AFTER your login middleware, e.g. in app.js:
 *   const auditRoutes = require('./routes/auditRoutes');
 *   app.use('/audit', ensureAuthenticated, auditRoutes);
 */
const express = require('express');
const router  = express.Router();
const audit   = require('../controllers/auditController');
const { requireAudit } = require('../middleware/auditAccess');

router.get('/',               requireAudit('view'),   audit.dashboard);
router.get('/export.csv',     requireAudit('view'),   audit.exportCsv);
router.get('/verify/:patientId', requireAudit('view'), audit.verifyPatient);
router.post('/verify-range',  requireAudit('view'),   audit.verifyRange);
router.post('/review',        requireAudit('review'), audit.review);

module.exports = router;

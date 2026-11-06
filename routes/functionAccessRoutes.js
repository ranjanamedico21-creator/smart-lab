'use strict';

/**
 * Mounted in app.js (the installer adds it):
 *   app.use('/user/access', require('./routes/functionAccessRoutes'));
 * Every handler re-checks permission itself (Admin or "/manageUserAccess").
 */
const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/functionAccessController');

const mustLogin = (req, res, next) => (req.user && req.user.Id ? next() : res.redirect('/'));

router.get('/:userId',             mustLogin, ctrl.page);
router.post('/:userId',            mustLogin, ctrl.save);
router.get('/:userId/grants.json', mustLogin, ctrl.grantsJson);

module.exports = router;

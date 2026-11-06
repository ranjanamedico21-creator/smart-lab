// routes/scheduleRoutes.js — mount with: app.use('/schedule', require('./routes/scheduleRoutes'));
const express  = require('express');
const router   = express.Router();
const User     = require('../models/User');
const Schedule = require('../controllers/ScheduleController');

const auth      = [User.checkLoggedIn];
const json      = express.json({ limit: '20kb' });
const jsonPhoto = express.json({ limit: '3mb' });   // punch-in carries the compressed photo

// Pages
router.get ('/getSchedule',   auth, Schedule.getTodaysScheduleForVisitingDoctors);
router.post('/getSchedule',   auth, Schedule.getTodaysScheduleForVisitingDoctors);
router.get ('/team',          auth, Schedule.getTeamView);           // admin / '/schedule/team' permission checked inside
router.post('/visiting-logs', auth, Schedule.updateVisitingLogs);   // manual log, no GPS

// Phone + reviewer actions
router.post('/api/punch-in',                auth, jsonPhoto, Schedule.punchIn);
router.post('/api/punch-out',               auth, json,      Schedule.punchOut);
router.get ('/api/doctor-visits/:doctorId', auth,            Schedule.doctorVisits);
router.get ('/api/visit-photo/:id',         auth,            Schedule.visitPhoto);
router.post('/api/review/:id',              auth, json,      Schedule.reviewVisit);
router.post('/api/location/:id',            auth, json,      Schedule.decideLocation);
router.post('/api/settings',                auth, json,      Schedule.saveSettings);      // default for everyone
router.post('/api/settings/user/:id',       auth, json,      Schedule.saveUserSettings);  // one officer

router.post('/api/assign',                  auth, json,      Schedule.assignDoctors);      // doctors → MR

module.exports = router;
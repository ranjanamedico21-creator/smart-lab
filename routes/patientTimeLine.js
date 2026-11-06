const express = require('express');
const router = express.Router();
//const controller = require('../controllers/patientTimeLineController');
const PatientTimeLineController= require("../controllers/PatientTimeLineController")
const User = require("../models/User");

// Add a custom timeline event
router.post('/add',User.checkLoggedIn, PatientTimeLineController.addEvent);

// Get full timeline for a patient
router.get('/:patientId', User.checkLoggedIn,PatientTimeLineController.getPatientTimeline);

module.exports = router;

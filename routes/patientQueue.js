const express = require('express');
const router = express.Router();
const PatientQueueController = require('../controllers/PatientQueueController');
const User = require("../models/User");

router.get('/', User.checkLoggedIn,PatientQueueController.getQueue);
router.post('/add', User.checkLoggedIn,PatientQueueController.addToQueue);
router.get('/predict',User.checkLoggedIn, PatientQueueController.predictTimes);
router.post('/acknowledge',User.checkLoggedIn, PatientQueueController.acknowledge);
// Quick mark entry
router.post('/mark-entry/:patientId', User.checkLoggedIn,PatientQueueController.markEntry);
// Quick mark entry
router.post('/mark-exit/:patientId', User.checkLoggedIn,PatientQueueController.markExit);


module.exports = router;
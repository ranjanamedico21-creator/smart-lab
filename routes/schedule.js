const express = require("express");
const router = express.Router();
//const passport = require("passport");
//const User = require("../models/User");
const ScheduleController= require("../controllers/ScheduleController");
//check for logged in user and authorization

//registration page
router.get("/getSchedule",ScheduleController.getTodaysScheduleForVisitingDoctors);

router.post("/visiting-logs",ScheduleController.updateVisitingLogs);

router.post("/getSchedule",ScheduleController.getTodaysScheduleForVisitingDoctors);

//router.post("/getSchedule",User.checkLoggedIn,ReportController.isPatientWithTestExist,ReportController.submitPatientData);



//export router
module.exports = router;

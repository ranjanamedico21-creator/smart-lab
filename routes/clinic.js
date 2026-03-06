const express = require("express");
const router = express.Router();
const passport = require("passport");
const User = require("../models/User");
const ClinicController= require("../controllers/ClinicController")
const validateClinicData = require("../middleware/validateClinic.js"); 

//registration page
router.get("/registerClinic",User.checkLoggedIn,User.checkAuthorisation, ClinicController.getClinicRegistrationPage);

//By default redirect to home page
router.get("/", User.checkLoggedIn,ClinicController.getHomePage);


//display all clinic with details
router.get("/getClinicListView",User.checkLoggedIn,User.checkAuthorisation,ClinicController.getClinicListView)

//registration process
router.post("/registerClinic",User.checkLoggedIn,User.checkAuthorisation,validateClinicData,ClinicController.registerClinic);

//get update clinic details page
router.get("/updateClinicDetails/:id", User.checkLoggedIn,User.checkAuthorisation,ClinicController.getupdateClinicDetailsPage)


// update clinic details
router.post("/updateClinicDetails",User.checkLoggedIn,User.checkAuthorisation,validateClinicData, ClinicController.updateClinicDetails)


//get attach doctor page with clinic
router.get("/attachDoctor/:clinicId", User.checkLoggedIn,User.checkAuthorisation,ClinicController.attachDoctorWithClinic)

//attach doctor with clinic
router.post("/attachDoctorToClinic", User.checkLoggedIn,User.checkAuthorisation,ClinicController.attachDoctorToClinic)

//remove doctor from clinic
router.get("/detachDoctor/:doctorId/:clinicId",User.checkLoggedIn,User.checkAuthorisation, ClinicController.detachDoctorFromClinic)


//export router
module.exports = router;

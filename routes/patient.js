const express = require("express");
const router = express.Router();
const passport = require("passport");
const User = require("../models/User");
const PatientController= require("../controllers/PatientController")
const validateUserInput = require("../middleware/validatePatientDetails")
const { requireAudit } = require('../middleware/auditAccess');

//registration page
router.get("/registerPatient",User.checkLoggedIn,User.checkAuthorisation, PatientController.getPatientRegistrationPage);

//Get List of Registered Patient
router.get("/getPatientListView",User.checkLoggedIn,User.checkAuthorisation, PatientController.getPatientListView)

//Get List of Registered Patient
router.get("/getPatientDetail", User.checkLoggedIn,User.checkAuthorisation,PatientController.getPatientDetail)

//get patient invoices
router.get("/invoices",User.checkLoggedIn,User.checkAuthorisation, PatientController.getInvoice);

//track patient pending amount
router.get("/trackDuesAmount",User.checkLoggedIn, User.checkAuthorisation,PatientController.getDuesView);


router.get("/report", User.checkLoggedIn,User.checkAuthorisation,PatientController.reportpatient);

//router.get("/dailyDuesReceived", User.checkLoggedIn,User.checkAuthorisation,PatientController.dailyDuesReceived);

router.get("/viewThanksPaidPatientList", User.checkLoggedIn,User.checkAuthorisation,PatientController.viewThanksPaidPatientList);


//search  patient  
router.post("/searchPatient", User.checkLoggedIn,User.checkAuthorisation,PatientController.searchPatient);

//update dues  payment 
router.post("/updateDuesAmount", User.checkLoggedIn,User.checkAuthorisation,validateUserInput,PatientController.updateDuesAmount);


//register patient into database
router.post("/registerPatient",User.checkLoggedIn,User.checkAuthorisation,validateUserInput, PatientController.registerPatientDetails)

router.post("/dailyDuesReceived",User.checkLoggedIn,User.checkAuthorisation, PatientController.searchDuesReceived)

router.post("/cancelPatient",User.checkLoggedIn,User.checkAuthorisation, PatientController.cancelPatient)

router.post("/searchPatientWithDuesAmount", User.checkLoggedIn,User.checkAuthorisation,PatientController.searchDues)//searchPatientWithDuesAmount

router.get("/duesDetail", User.checkLoggedIn,User.checkAuthorisation,PatientController.getPatientDuesDetail);

router.post("/thanks",User.checkLoggedIn,User.checkAuthorisation, PatientController.thanks)

router.post("/searchThanksPaidPatient",User.checkLoggedIn, User.checkAuthorisation,PatientController.viewThanksPaidPatientList)

//Get List of ttached doctor to clinic through ajax call from patient registration page
router.post("/getListOfAttachedDoctorToClinic",User.checkLoggedIn, User.checkAuthorisation,PatientController.getListOfAttachedDoctorToClinic)

//Get List of Registered Patient
router.get("/patientTimeLine/:patientId", User.checkLoggedIn,User.checkAuthorisation,PatientController.getPatientTimeLine)

//router.get("/patientHistory/", User.checkLoggedIn,User.checkAuthorisation,PatientController.getPatientHistory)

//router.post("/patientHistory/", User.checkLoggedIn,User.checkAuthorisation,PatientController.getSearchedPatientList)

router.post("/markTestCompleted/:patientId", User.checkLoggedIn,User.checkAuthorisation,PatientController.markTestCompleted)

// routes/patientRoutes.js
router.post("/markArrived",User.checkLoggedIn,User.checkAuthorisation, PatientController.markArrived);

// routes/patientRoutes.js
router.post("/collectDues",User.checkLoggedIn,User.checkAuthorisation, PatientController.collectDues);

router.get( "/dailyDuesReceived", User.checkLoggedIn, User.checkAuthorisation,      PatientController.getDuesReceivedView);
// GET  — render the edit form
router.get("/editPatientDetails", User.checkLoggedIn,User.checkAuthorisation, PatientController.getEditPatientPage);
 
// POST — process the update
router.post("/updatePatientDetails", User.checkLoggedIn,User.checkAuthorisation, PatientController.postUpdatePatientDetails);

//router.get("/patientHistory", User.checkLoggedIn, PatientController.getPatientHistoryPage);
router.get('/getPatientHistoryPage',User.checkLoggedIn,User.checkAuthorisation, requireAudit('view'), PatientController.getPatientHistoryPage);
 
// router.post("/dues/received",        patientController.searchDuesReceived);
// router.get( "/dues/detail",          patientController.getPatientDuesDetail);

// route: POST /patient/checkCancelAuth
router.post('/checkCancelAuth', User.checkLoggedIn,User.checkAuthorisation,PatientController.checkCancelAuthorisation)

// route: POST /patient/checkCancelAuth
//router.post('/mark-generated', User.checkLoggedIn,PatientController.markFilmGenerated)

router.post('/markGenerated', User.checkLoggedIn,User.checkAuthorisation, PatientController.postMarkGenerated);

router.post('/markDelivered', User.checkLoggedIn,User.checkAuthorisation, PatientController.postMarkDelivered);
 
module.exports= router;

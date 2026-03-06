const express = require("express");
const router = express.Router();
const passport = require("passport");
const User = require("../models/User");
const PatientController= require("../controllers/PatientController")
const validateUserInput = require("../middleware/validatePatientDetails")

//registration page
router.get("/registerPatient",User.checkLoggedIn,User.checkAuthorisation, PatientController.getPatientRegistrationPage);

//Get List of Registered Patient
router.get("/getPatientListView",User.checkLoggedIn,User.checkAuthorisation, PatientController.getPatientListView)

//Get List of Registered Patient
router.get("/getPatientDetail", User.checkLoggedIn,User.checkAuthorisation,PatientController.getPatientDetail)

//get patient invoices
router.get("/invoices",User.checkLoggedIn, PatientController.getInvoice);

//track patient pending amount
router.get("/trackDuesAmount",User.checkLoggedIn, User.checkAuthorisation,PatientController.trackDuesAmount);

//edit  patient 
router.get("/editPatientDetails",User.checkLoggedIn,User.checkAuthorisation, PatientController.editPatientDetails);

router.get("/report", User.checkLoggedIn,User.checkAuthorisation,PatientController.reportpatient);

router.get("/dailyDuesReceived", User.checkLoggedIn,User.checkAuthorisation,PatientController.dailyDuesReceived);

router.get("/viewThanksPaidPatientList", User.checkLoggedIn,User.checkAuthorisation,PatientController.viewThanksPaidPatientList);

//router.get("/getPatientEditedHistory", User.checkLoggedIn,User.checkAuthorisation,PatientController.getPatientEditedHistory);

//edit patient  
router.post("/updatePatientDetails",User.checkLoggedIn,User.checkAuthorisation, validateUserInput,PatientController.updatePatientDetails);

//search  patient  
router.post("/searchPatient", User.checkLoggedIn,User.checkAuthorisation,PatientController.searchPatient);

//12 march 2025
//router.post("/searchEditedPatient", User.checkLoggedIn,User.checkAuthorisation,PatientController.searchEditedPatient);

//update dues  payment 
router.post("/updateDuesAmount", User.checkLoggedIn,User.checkAuthorisation,validateUserInput,PatientController.updateDuesAmount);


//register patient into database
router.post("/registerPatient",User.checkLoggedIn,User.checkAuthorisation,validateUserInput, PatientController.registerPatientDetails)

router.post("/dailyDuesReceived",User.checkLoggedIn,User.checkAuthorisation, PatientController.dailyDuesReceived)

router.post("/cancelPatient",User.checkLoggedIn,User.checkAuthorisation, PatientController.cancelPatient)

router.post("/searchPatientWithDuesAmount", User.checkLoggedIn,User.checkAuthorisation,PatientController.searchPatientWithDuesAmount)//searchPatientWithDuesAmount

router.post("/thanks",User.checkLoggedIn, PatientController.thanks)

router.post("/searchThanksPaidPatient",User.checkLoggedIn, User.checkAuthorisation,PatientController.viewThanksPaidPatientList)

//Get List of ttached doctor to clinic through ajax call from patient registration page
router.post("/getListOfAttachedDoctorToClinic",User.checkLoggedIn, User.checkAuthorisation,PatientController.getListOfAttachedDoctorToClinic)

//Get List of Registered Patient
router.get("/patientTimeLine/:patientId", User.checkLoggedIn,User.checkAuthorisation,PatientController.getPatientTimeLine)

router.get("/patientHistory/", User.checkLoggedIn,User.checkAuthorisation,PatientController.getPatientHistory)

router.post("/patientHistory/", User.checkLoggedIn,User.checkAuthorisation,PatientController.getSearchedPatientList)

router.post("/markTestCompleted/:patientId", User.checkLoggedIn,User.checkAuthorisation,PatientController.markTestCompleted)

module.exports= router;

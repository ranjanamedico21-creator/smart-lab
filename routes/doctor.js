const express = require("express");
const router = express.Router();
//const passport = require("passport");
const DoctorController = require("../controllers/DoctorController");
const User = require("../models/User");

//get doctor registration page
router.get("/registerDoctor",User.checkLoggedIn,User.checkAuthorisation, DoctorController.getDoctorRegistrationPage)

//Search doctor details
router.get("/getDoctorListView",User.checkLoggedIn,User.checkAuthorisation, DoctorController.getDoctorListView)

router.get("/getDoctorDetail",User.checkLoggedIn,User.checkAuthorisation,DoctorController.getDoctorDetailView)

router.get("/updateDoctorThanks",User.checkLoggedIn,User.checkAuthorisation, DoctorController.updateDoctorThanks)

router.get("/getDoctorWiseThanks",User.checkLoggedIn,User.checkAuthorisation, DoctorController.getDoctorWiseThanks)

router.get("/downloadIndividualDoctorThanks",User.checkAuthorisation, DoctorController.downloadIndividualDoctorThanks)

router.get("/downloadAllDoctorThanks/:FromDate/:ToDate",User.checkAuthorisation, DoctorController.downloadAllDoctorThanks)


router.post("/updateThanks",User.checkLoggedIn,User.checkAuthorisation, DoctorController.updateThanks)

router.post("/getDoctorThanks",User.checkLoggedIn,User.checkAuthorisation, DoctorController.getDoctorThanks)

//get doctor registration page
router.post("/registerDoctor",User.checkLoggedIn,User.checkAuthorisation,DoctorController.registerDoctor);

//Search doctor details
router.post("/searchDoctor",User.checkLoggedIn,User.checkAuthorisation, DoctorController.searchDoctor)

router.post("/updateTestWiseThanksForADoctor",User.checkLoggedIn,User.checkAuthorisation, DoctorController.updateTestWiseThanksForADoctor)

router.get("/editDoctor/:doctorId",User.checkLoggedIn,User.checkAuthorisation, DoctorController.getEditDoctorPage)

router.post("/updateDoctor/:doctorId",User.checkLoggedIn,User.checkAuthorisation, DoctorController.updateDoctor)

router.post("/associateReportingDoctor/:reffereingDoctorId",User.checkLoggedIn,User.checkAuthorisation, DoctorController.updateReportingDoctor)

router.post("/associateMarketingPersonForDoctor/:refferingDoctorId",User.checkLoggedIn,User.checkAuthorisation, DoctorController.updateMarketingPerson)













module.exports = router;
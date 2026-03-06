const express = require("express");
const router = express.Router();
const passport = require("passport");
const User = require("../models/User");
const ReportController= require("../controllers/ReportController")
//check for logged in user and authorization

//registration page
router.get("/viewCollection",User.checkLoggedIn,User.checkAuthorisation,ReportController.viewCollection);

router.get("/createReport",User.checkLoggedIn,User.checkAuthorisation,ReportController.createReport);

router.get("/downloadReportAsPdf",User.checkLoggedIn,User.checkAuthorisation,ReportController.downloadReportAsPdf);

router.get("/downloadReportAsDoc",User.checkLoggedIn,User.checkAuthorisation,ReportController.downloadReportAsDoc);

router.post("/saveReport",User.checkLoggedIn,User.checkAuthorisation,ReportController.saveReport);

router.post("/viewCollection",User.checkLoggedIn,User.checkAuthorisation,ReportController.viewCollection);

router.get("/getDiscountReport",User.checkLoggedIn,User.checkAuthorisation,ReportController.getDiscountReport);

router.post("/getDiscountReport",User.checkLoggedIn,User.checkAuthorisation,ReportController.getDiscountReport);

router.get("/getDocumentUploadForm",User.checkLoggedIn,User.checkAuthorisation,ReportController.getDocumentUploadForm);

router.get("/downloadwReportFromLink/:token",ReportController.downloadReportAsPdfFromLink);

router.get("/generateLinkForReportDownload",User.checkLoggedIn,User.checkAdmin,ReportController.generateLinkForReportDownload);


router.get("/displayDocumentDetails",User.checkLoggedIn,User.checkAuthorisation,ReportController.displayDocumentDetails);

router.post("/deleteDocument",User.checkLoggedIn,User.checkAuthorisation,ReportController.deleteDocument);

router.post("/uploadDocument",User.checkLoggedIn,User.checkAuthorisation,ReportController.uploadDocument);

router.get("/pathologyReport/:patientId/:testId",User.checkLoggedIn,ReportController.isPatientWithTestExist,ReportController.getPathologyReportingPage);

router.get("/viewPathologyReport/:patientId/:testId",User.checkLoggedIn,ReportController.isPatientWithTestExist,ReportController.viewPathologyReport);

router.get("/downloadPathologyReportAsPdf/:patientId/:testId",User.checkLoggedIn,ReportController.downloadPathologyReportAsPdf);

//router.get("/patientHistory/",User.checkLoggedIn,ReportController.patientHistory);


router.post("/submitPatientData/:patientId/:testId",User.checkLoggedIn,ReportController.isPatientWithTestExist,ReportController.submitPatientData);

router.post("/searchDocument",User.checkLoggedIn,ReportController.searchDocument);

router.get("/getCategoryWiseCollection/",User.checkLoggedIn,ReportController.getCategoryWiseCollectionPage);

router.get("/getTestWiseCollection/:CategoryId/:FromDate/:ToDate",User.checkLoggedIn,ReportController.getTestWiseCollection);

router.get("/doctorPatientServiceReport",User.checkLoggedIn,ReportController.getDoctorPatientServiceReportPage);

router.post("/doctorPatientServiceReport",User.checkLoggedIn,ReportController.getDoctorPatientServiceData);

router.get("/downloadDoctorPatientServiceRepoertInExcel/:categoryId/:startDate/:endDate",User.checkLoggedIn,ReportController.downloadDoctorPatientServiceRepoertInExcel);






//export router
module.exports = router;
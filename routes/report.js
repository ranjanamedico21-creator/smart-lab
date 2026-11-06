const express = require("express");
const router = express.Router();
const passport = require("passport");
const User = require("../models/User");
const ReportController= require("../controllers/ReportController")
//check for logged in user and authorization

//registration page
router.get("/viewCollection",User.checkLoggedIn,User.checkAuthorisation,ReportController.getSettlementView);

//",User.checkLoggedIn,User.checkAuthorisation,ReportController.createReportView);

//router.get("/downloadReportAsPdf",User.checkLoggedIn,User.checkAuthorisation,ReportController.downloadReportAsPdf);

//router.get("/downloadReportAsDoc",User.checkLoggedIn,User.checkAuthorisation,ReportController.downloadReportAsDoc);

//router.post("/saveReport",User.checkLoggedIn,User.checkAuthorisation,ReportController.saveReport);

//router.post("/signOff",User.checkLoggedIn,User.checkAuthorisation,ReportController.finalizeReport);

// FIX: the date form (and Today/Yesterday buttons) POST here. This used to call
// getSettlementView, which reads only the URL query, so every search showed today.
router.post("/viewCollection",User.checkLoggedIn,User.checkAuthorisation,ReportController.searchSettlement);

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

router.get("/getTestWiseCollectionJson/:CategoryId/:FromDate/:ToDate",User.checkLoggedIn,ReportController.getTestWiseCollectionJson);



// FIX: these showed the full collection to ANY logged-in user; now same permission as View Collection.
router.post("/settlement/search",User.checkLoggedIn, User.checkFunction("/viewCollection"), ReportController.searchSettlement);
router.get( "/settlement/json", User.checkLoggedIn, User.checkFunction("/viewCollection"), ReportController.getSettlementJson);


// ── Template management ──
router.get ("/templates",              User.checkLoggedIn, ReportController.templateList);
router.get ("/templates/new",          User.checkLoggedIn, ReportController.templateForm);
router.get ("/templates/:id/edit",     User.checkLoggedIn, ReportController.templateForm);
router.post("/templates/preview",      User.checkLoggedIn, ...ReportController.previewDocx);
router.post("/templates/save",         User.checkLoggedIn, ...ReportController.saveTemplate);
router.post("/templates/delete",       User.checkLoggedIn, ReportController.deleteTemplate);

// ── Report creation ──
router.get ("/create",                 User.checkLoggedIn, ReportController.createReportView);
router.get ("/template-preview/:templateId", User.checkLoggedIn, ReportController.loadTemplatePreview);
router.post("/save",                   User.checkLoggedIn, ReportController.saveReport);

// ── Doctor Patient Reference Report ──
router.get("/doctorPatientServiceReport",User.checkLoggedIn,ReportController.getDoctorPatientReportView);

router.post("/doctorPatientServiceReport",User.checkLoggedIn,ReportController.generateDoctorPatientReport);

// ── Excel download ──
router.get("/downloadDoctorPatientReportExcel/:categoryId/:startDate/:endDate/:mode/:periodEnd",
    User.checkLoggedIn,
    ReportController.downloadDoctorPatientReportExcel
);


// routes/referralReport.js
// ─────────────────────────────────────────────────────────────────────────────
//  GET  /report/referral         → search page
//  POST /report/referral/preview → HTML report page (client generates PDF)
//
//  Zero server-side dependencies — no pdfkit, no puppeteer.
//  PDF is generated in the browser using jsPDF + autoTable from CDN.
// ─────────────────────────────────────────────────────────────────────────────


// ── GET: search page ──────────────────────────────────────────────────────────
router.get("/referral", User.checkLoggedIn,ReportController.getRefferalPage)


// ── POST: generate HTML report (PDF built client-side) ────────────────────────
router.post("/referral/preview",User.checkLoggedIn,ReportController.getRefferalPreview)
// routes/reportRoutes.js (or wherever your report routes are)

// Get report editor page
router.get('/createReport', User.checkLoggedIn, ReportController.getReportPage);
 
// Save report content (called via fetch from Jodit editor — returns JSON)
router.post('/saveReport', User.checkLoggedIn, ReportController.saveReport);

// Switch template (AJAX - load different template)
router.post('/switchTemplate', User.checkLoggedIn, ReportController.switchTemplate);

// Finalize — locks report (fetch JSON)
router.post('/finalizeReport', User.checkLoggedIn, ReportController.finalizeReport);

// Un-finalize — unlocks report for re-editing (fetch JSON)
router.post('/unfinalizeReport', User.checkLoggedIn, ReportController.unfinalizeReport);
 
// Downloads — only work after report is saved (finalize not required for PDF/Word)
router.get('/downloadPdf', User.checkLoggedIn, ReportController.downloadPdf);
router.get('/downloadDoc', User.checkLoggedIn, ReportController.downloadDoc);
router.post('/saveAsDefaultTemplate', User.checkLoggedIn, ReportController.saveAsDefaultTemplate);
router.get('/downloadPdfPrint', User.checkLoggedIn, ReportController.downloadPdfPrint);

const DoctorBusiness = require('../controllers/DoctorBusinessController');
router.get('/doctorBusiness', User.checkLoggedIn, DoctorBusiness.getDoctorBusinessPage);
router.get('/api/doctorBusiness/:doctorId', User.checkLoggedIn, DoctorBusiness.getDoctorBusinessDetail);
 
module.exports = router;
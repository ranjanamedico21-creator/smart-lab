//const PatientController = require("../controllers/PatientController");
const Patient=require("../models/Patient");
//const Doctor=require("../models/Doctor");
const Test=require("../models/Test");
const {readFileSync}= require('fs');
const Report = require("../models/Report");
let ejs = require('ejs');
const convertPdf= require('../views/partials/htmlToPdf');
const fs = require('fs');
const html_to_docx = require('html-to-docx');
const Doctor = require("../models/Doctor");
const Category=require("../models/Category");
const moment= require('moment');
const Billing = require("../models/Billing");
const templateService = require("../helper/templateService");
const multer          = require("multer");
const path            = require("path");
const {
    buildHtmlLayout,
    buildDocxHtml,
    safeName,
    generatePdfWithPuppeteer,
    USE_PUPPETEER,
    BRAND,
    imageToBase64,
    cleanReportHtml,
} = require('../helper/reportBuilder');

const { buildHtmlWithHeaderFooter } = require('../helper/reportBuilderWithHeader');
const dbc = require('../config/DBConnection');
const db  = () => (dbc.pool || dbc.connection).promise();   // pool: survives MySQL restarts / idle timeouts
const User = require("../models/User");
const { cleanHtml } = require('../helper/htmlSanitizer');

/* ═════════════════════════════════════════════════════════════════════════════
 * SECURITY PATCH (2026-10-25) — changes marked ★ (full list in SECURITY_REVIEW_reports.md)
 * ═════════════════════════════════════════════════════════════════════════════ */
const IS_PROD = process.env.NODE_ENV === 'production';
const toId    = (v) => { const n = parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : null; };

/** ★ reporting-doctor logins (role 2) only see their own doctors' patients — same rule as the patient pages */
const canAccess = async (req, patientId) =>
    typeof Patient.canUserAccessPatient === 'function' ? Patient.canUserAccessPatient(req.user, patientId) : true;

/** User-facing text for an error; DB / code errors never shown raw (they leaked SQL + table names). */
const errText = (err, fallback = 'Something went wrong. Please try again.') =>
    (err && err.isUserError) ? err.message : (IS_PROD ? fallback : `${fallback} (${err && err.message})`);

/** JSON error answer for the report editor (status stays 200 — the page reads success:false). */
const jsonFail = (res, err, fallback) => {
    if (!(err && err.isUserError)) console.error('[Report]', err);
    return res.json({ success: false, message: errText(err, fallback) });
};

/** Report the request is about, with the checks every editor action needs. testRefId comes from the DB, never the browser. */
const editableTarget = async (req, { allowFinalized = false } = {}) => {
    let { patientId, testId } = req.body || {};
    if ((!patientId || !testId) && toId(req.body && req.body.testRefId)) {
        // older buttons (un-finalize) send only testRefId → find patient + test from it, never trust it further
        const [[r]] = await db().query('SELECT PatientId, TestId FROM PatientTestRefference WHERE Id = ? LIMIT 1', [toId(req.body.testRefId)]);
        if (r) { patientId = r.PatientId; testId = r.TestId; }
    }
    const t = await Report.loadReportTarget(patientId, testId);
    if (!(await canAccess(req, t.PatientId)))  throw Object.assign(new Error('You do not have access to this patient.'), { isUserError: true });
    if (Number(t.PatientStatus) === 0)          throw Object.assign(new Error('This patient is cancelled.'), { isUserError: true });
    if (!Number(t.IsReportRequired))            throw Object.assign(new Error('This test does not need a report.'), { isUserError: true });
    if (t.TestStatus !== 'Completed')           throw Object.assign(new Error('This test is not completed yet. Complete the test first.'), { isUserError: true });
    if (!allowFinalized && Number(t.IsFinalized) === 1)
        throw Object.assign(new Error('Report is finalized. Un-finalize before editing.'), { isUserError: true });
    return t;
};

/** Same flash shape the rest of the app uses (partials/messages). */
const flash = (req, type, messages) => req.flash('flash', {
    type, messages,
    icon: type === 'success' ? 'bi-check-circle-fill' : type === 'warning' ? 'bi-exclamation-circle-fill' : 'bi-exclamation-triangle-fill',
});

//req.flash('flash', { type: 'danger', messages: result.message, icon: 'bi-exclamation-triangle-fill' });

//req.flash('flash', { type: 'success', messages: result.message, icon: 'bi-check-circle-fill' });


//utility function
 // Function to handle rendering the home page with errors
 const renderHomeWithError = (res, error, customMessage = '') => {
  let notifications=[]
  if (customMessage) {
      notifications.push(createNotification('danger', customMessage, 'bi-exclamation-triangle-fill'));
  }
  if (error) {
      // ★ Error objects were shown as-is → SQL text / table names on screen. Only safe text now.
      const safe = typeof error === 'string' ? error
                 : (error.isUserError || /not found|access|cancelled|dues|finaliz|Missing|valid|upload|file|category|date/i.test(error.message || ''))
                   ? error.message : 'Something went wrong. Please try again.';
      if (typeof error !== 'string' && !error.isUserError) console.error('[Report]', error);
      notifications.push(createNotification('danger', safe, 'bi-exclamation-triangle-fill'));
  }
  res.status(400);
  res.render('home', {notifications,title: 'Home',BRAND_NAME: process.env.BRAND_NAME,layout: 'loggedInLayout'});
};



/**
 * Old entry point (GET /report/createReport?patientId=&testId=).
 * FIX: it used an undefined `errors` variable and Report.getGenderOfPatientForReport /
 * getTemplateDataForTest / getSavedReportData, which no longer exist → crashed.
 * Now it simply opens the current report editor.
 */
let createReport = async (req, res) => getReportPage(req, res);

 /**
  * 
  * @param {*} req 
  * @param {*} res 
  * @returns 
  * This function is used if admin send this link to the any user to download the report even if patient has not paid the 
  * Full Amount or it is in Dues.
  * Here we will check token 
  */
 // Controller to download PDF using token
 // ═══════════════════════════════════════════════════════════
// Add to ReportController.js
// Route already exists:
//   GET /downloadwReportFromLink/:token  (no login required)
//
// Flow:
//   1. Validate token from TemporaryLinks table
//   2. Get patientId + testId from token row
//   3. Fetch report data + all reporting doctors
//   4. If USE_PUPPETEER=true  → Puppeteer generates real PDF binary
//   5. If USE_PUPPETEER=false → html2pdf.js in browser (send HTML)
// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
// Add to ReportController.js
// Route: GET /downloadReportFromLink/:token
// No login required — token verified against TemporaryLinks table
// Uses Puppeteer or html2pdf based on USE_PUPPETEER env flag
// ═══════════════════════════════════════════════════════════

const downloadReportAsPdfFromLink = async (req, res) => {
    try {
        // 1. Verify token
        const result = await Report.checkToken(req);
        if (!result || result.length === 0) {
            return res.status(404).send('Link not found or expired.');
        }

        const { PatientId: patientId, TestId: testId } = result[0];

        // 2. Fetch report data — same as downloadPdf
        const rawData = await Report.getFinalizedReport(patientId, testId);
        if (!rawData) {
            return res.status(404).send('Report not found.');
        }
        // ★ public page (no login): only a FINALIZED report of an active patient. Before, a report that was
        //   only "ready" (still being edited) or a CANCELLED patient's report stayed downloadable.
        if (Number(rawData.IsFinalized) !== 1 || Number(rawData.PatientStatus) === 0) {
            return res.status(404).send('This link is invalid or has expired.');
        }

        rawData.doctors = await Report.getAllReportingDoctors();
        res.set('Cache-Control', 'no-store');
        res.set('X-Robots-Tag', 'noindex, nofollow');

        // 3. Generate PDF — Puppeteer or html2pdf based on env
        if (USE_PUPPETEER) {
            // Puppeteer: returns PDF buffer — send directly as file download
            const pdfBuffer = await generatePdfWithPuppeteer(rawData);
            const filename  = `Report_${safeName(rawData.Name)}_${safeName(rawData.TestName)}.pdf`;
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            return res.send(pdfBuffer);
        }

        // html2pdf: send HTML page — browser generates and downloads PDF
        const html = buildHtmlWithHeaderFooter(rawData, BRAND);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(html);

    } catch (error) {
        console.error('[downloadReportAsPdfFromLink]', error);
        // If token not found (reject from checkToken), show clean message
        if (error.status === 404) {
            return res.status(404).send('This link is invalid or has expired.');
        }
        return res.status(500).send('Something went wrong. Please try again.');
    }
};

/**
 * GET /report/generateLinkForReportDownload?patientId=&testId=
 * Creates an expiring download link and opens WhatsApp to the patient's number.
 */
const generateLinkForReportDownload = async (req, res) => {
    const patientId = parseInt(req.query.patientId, 10);
    const testId    = parseInt(req.query.testId, 10);
    const back      = patientId ? `/patient/getPatientDetail?patientId=${patientId}` : '/patient/getPatientListView';
    try {
        if (!patientId || !testId) throw new Error('Missing patient or test.');
        if (!(await canAccess(req, patientId))) throw new Error('You do not have access to this patient.');

        const report = await Report.getFinalizedReport(patientId, testId);
        if (!report)             throw new Error('Report not found for this test.');
        if (Number(report.IsFinalized) !== 1) throw new Error('Finalize the report before sharing it.');
        // ★ dues pending → only admin / "deliverWithDues" may send the report out
        const hand = await Report.checkHandOver(req.user.Id, await Report.loadReportTarget(patientId, testId));
        if (!hand.ok) throw new Error(hand.message);

        const token   = await Report.createReportLinkToken(patientId, testId);
        const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
        const link    = `${baseUrl}${process.env.REPORT_LINK_PATH || '/downloadReportFromLink/'}${token}`;
        const hours   = parseInt(process.env.REPORT_LINK_HOURS, 10) || 72;
        const brand   = process.env.BRAND_NAME || 'our centre';
        const text    = `Dear ${[report.Title, report.Name].filter(Boolean).join(' ')}, your ${report.TestName} report from ${brand} is ready.\n` +
                        `Download: ${link}\n(This link works for ${hours} hours.)`;

        const phone = String(report.PhoneNumber || '').replace(/\D/g, '').slice(-10);
        const wa    = /^[6-9]\d{9}$/.test(phone)
            ? `https://wa.me/91${phone}?text=${encodeURIComponent(text)}`
            : `https://wa.me/?text=${encodeURIComponent(text)}`;   // no valid number → let staff pick the chat
        return res.redirect(wa);
    } catch (error) {
        console.error('generateLinkForReportDownload:', error.message);
        flash(req, 'danger', error.message || 'Could not create the report link.');
        return res.redirect(back);
    }
};

/**
 * 
 * @param {not working till now } req 
 * @param {*} res 
 */


const getDiscountReport = async (req, res) => {
    let notifications = [];

    try {
        // Extracting request body parameters with default values
        const Name = req.body?.Name || '';
        const doctorId = req.body?.Doctor || '';
        const FromDate = req.body?.FromDate || moment().format('DD-MM-YYYY');
        const ToDate = req.body?.ToDate || moment().format('DD-MM-YYYY');

    

        // Fetch discount report & doctor list in parallel for performance optimization
        const [discountReportDetails, doctorDetails] = await Promise.all([
            Report.getDiscountReport(req),
            Doctor.getDoctorList(),
        ]);

        // Check if no discount records exist
        if (discountReportDetails.length === 0) {
            notifications.push(
                createNotification('warning', 'No patient with discount available.', 'bi-exclamation-triangle-fill')
            );
        }

        // Check if no doctors exist
        if (doctorDetails.length === 0) {
            notifications.push(
                createNotification('warning', 'No doctor available in the system. Register doctors.', 'bi-exclamation-triangle-fill')
            );
        }


        // Render the discount report view with data
        res.render('getDiscountReport', {
            notifications,
            doctorDetails,
            Name,
            doctorId,
            FromDate,
            ToDate,
            discountReportDetails,
            title: 'Discount Report',
            BRAND_NAME: process.env.BRAND_NAME,
            layout: 'loggedInLayout',
        });

    } catch (error) {
        console.error("Error fetching discount report:", error);
        return renderHomeWithError(res, error);
    }
};
  

let getDocumentUploadForm = async(req,res)=>{
  let notifications=[]
   try {
      let DocumentCategoryDetails= await Category.getDocumentCategoryList();
        //console.log(DocumentCategoryDetails)
        res.render('uploadDocument',{DocumentCategoryDetails,title: ' Document Category List' ,BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
 
   } catch (error) {
   // notifications.push(createNotification('danger',error,'bi-excalamation-triangle-fill'))
    return renderHomeWithError(res, error);
   }
}

let uploadDocument= async(req,res)=>{
  let notifications=[]  
   try {
      let message = await Report.uploadDocument(req);
          notifications.push(createNotification('success',message,'bi-check-circle-fill'))
      let DocumentCategoryDetails= await Category.getDocumentCategoryList();
      let documentDetails= await Report.getDocumentDetails()
      res.render(`displayDocumentDetails`,{documentDetails,notifications,DocumentCategoryDetails,title: ' Document List' ,BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
   } catch (error) {
   // notifications.push(createNotification('danger',error,'bi-excalamation-triangle-fill'))
    return renderHomeWithError(res, error);
   }
}

let displayDocumentDetails= async(req,res)=>{
  let notifications=[]
   try {
      //res.send('hi ')
      //let message = await Report.uploadDocument(req);
      let DocumentCategoryDetails= await Category.getDocumentCategoryList();
      let documentDetails= await Report.getDocumentDetails()
      res.render('displayDocumentDetails',{documentDetails,DocumentCategoryDetails,title: ' Document List' ,BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
   } catch (error) {
   // notifications.push(createNotification('danger',error,'bi-excalamation-triangle-fill'))
    return renderHomeWithError(res, error);
   }
}

const deleteDocument = async (req, res) => {
  const notifications = [];
  
  try {
    const documentId = req.body?.deleteDocumentId ?? "";
    if(!documentId)
        throw new Error('DocumentId is not found.')
    const documentName = await Report.getDocumentName(documentId);
    const message = await Report.deleteDocument(documentId, documentName);
    
    notifications.push(createNotification('success', message, 'bi-check-circle-fill'));
  } catch (error) {
  //  notifications.push(createNotification('danger', error, 'bi-exclamation-triangle-fill'));
    return renderHomeWithError(res, error); // Return early to prevent further execution
  }

  try {
    const DocumentCategoryDetails = await Category.getDocumentCategoryList();
    const documentDetails = await Report.getDocumentDetails();

    res.render('displayDocumentDetails', {
      notifications,
      documentDetails,
      DocumentCategoryDetails,
      title: 'Document List',
      BRAND_NAME: process.env.BRAND_NAME,
      layout: 'loggedInLayout',
    });
  } catch (error) {
   // notifications.push(createNotification('danger',error, 'bi-exclamation-triangle-fill'));
    return renderHomeWithError(res, error);
  }
};

const getPathologyReportingPage = async (req, res) => {

   let patientDetail = null;
   let savedData=null;
   let groupedResults=null;
   let notifications=[]
   try {
       const patientId = req.params.patientId;
       const testId = req.params.testId;

             patientDetail = await fetchPatientDetails(patientId);
             groupedResults = await fetchReportData(patientDetail, testId);
             savedData = await Report.getPatientPathoTestData(patientId, testId);

       renderReportPage(res, 'createPathoReport', {
           title: 'Pathology Report',
           savedData,
           patientDetail,
           testId,
           groupedResults
       });
   } catch (error) {
       console.error("Error fetching pathology reporting page:", error);
       notifications.push(createNotification('danger',error,'bi-exclamation-triangle-fill'))
       renderReportPage(res, 'createPathoReport', {
           title: 'Pathology Report',
           savedData,
           patientDetail,
           testId,
           groupedResults,
          notifications
       });
   }
};

const submitPatientData = async (req, res) => {
   let patientDetail = null;
   let savedData=null;
   let groupedResults=null;
   let notifications=[]

   try {
       const patientId = req.params.patientId;
       const testId = req.params.testId;

       if (!(await canAccess(req, patientId))) throw new Error('You do not have access to this patient.');
       let serializedData;
       try { serializedData = JSON.parse(req.body.serializedData || '{}'); }
       catch (_) { throw new Error('The values could not be read. Please reload the page and try again.'); }
       const response = await Report.insertPathologicalData(patientId, serializedData, testId);
       notifications.push(createNotification('success',response,'bi-check-circle-fill'))

       patientDetail = await fetchPatientDetails(patientId);
             groupedResults = await fetchReportData(patientDetail, testId);
             savedData = await Report.getPatientPathoTestData(patientId, testId);

       renderReportPage(res, 'displayPathoReport', {
           title: 'Pathological Report',
           savedData,
           patientDetail,
           testId,
           groupedResults,
           notifications
       });
   } catch (error) {
       console.error("Error submitting patient data:", error.message);
       notifications.push(createNotification('danger', error.isUserError || /access|cancelled|values|parameter|finalized|patient/i.test(error.message) ? error.message : 'Could not save the values. Please try again.', 'bi-exclamation-triangle-fill'))
       renderReportPage(res, 'createPathoReport', {
           title: 'CBC Report',
           notifications,
           patientDetail,
           savedData,
           groupedResults,
           testId
       });
   }
};

const viewPathologyReport = async (req, res) => {
   try {
       const patientId = req.params.patientId;
       const testId = req.params.testId;

       const patientDetail = await fetchPatientDetails(patientId);
       const groupedResults = await fetchReportData(patientDetail, testId);
       const savedData = await Report.getPatientPathoTestData(patientId, testId);

       renderReportPage(res, 'displayPathoReport', {
           title: 'Pathological Report',
           savedData,
           patientDetail,
           testId,
           groupedResults
       });
   } catch (error) {
       console.error("Error viewing pathology report:", error);
       return renderHomeWithError(res, error, 'Some Error Occurred while trying to get Data.');
   }
};

// Utility: Fetch patient details and ensure existence
const fetchPatientDetails = async (patientId) => {
   const patientDetail = await Patient.getPatientDetails(patientId);
   if (!patientDetail || patientDetail.length === 0) {
       throw new Error("Patient details not found.");
   }
   return patientDetail;
};

// Utility: Fetch grouped report data
const fetchReportData = async (patientDetail, testId) => {
   const rows = await Report.getdataForPathologyReport(
       patientDetail[0].Id,
       testId,
       patientDetail[0].Age,
       patientDetail[0].YMD,
       patientDetail[0].Gender
   );
   return groupResultsByHeader(rows);
};

// Utility: Render a report page
const renderReportPage = (res, view, options) => {
  // FIX: ignored options.notifications and always pushed two empty alerts
  const notifications = (options.notifications || []).map(n =>
      n && n.messages instanceof Error ? { ...n, messages: n.messages.message } : n);
  if (options.successes) notifications.push(createNotification('success', options.successes, 'bi-check-circle-fill'));
  if (options.errors)    notifications.push(createNotification('danger',  options.errors,    'bi-exclamation-triangle-fill'));
   res.render(view, {
       title: options.title,
       savedData: options.savedData || null,
       patientDetail: options.patientDetail || null,
       testId: options.testId || null,
       groupedResults: options.groupedResults || null,
       notifications,
       BRAND_NAME: process.env.BRAND_NAME,
       layout: 'loggedInLayout'
   });
};

// Utility function to group results by headers
function groupResultsByHeader(rows) {
   return rows.reduce((acc, row) => {
       if (!acc[row.Header]) {
           acc[row.Header] = []; // Initialize array for new header
       }
       acc[row.Header].push({
           SubParameterId: row.SubParameterId,
           SubParameterName: row.SubParameterName,
           Unit: row.Unit,
           AgeMin: row.AgeMin,
           AgeMax: row.AgeMax,
           MinVal: row.MinVal,
           MaxVal: row.MaxVal,
           Gender: row.Gender,
           AgeUnit: row.AgeUnit,
           HeaderOrder: row.HeaderOrder,
           SubParameterOrder: row.SubParameterOrder
       });
       return acc;
   }, {});
}

const isPatientWithTestExist= async(req,res,next)=>{
   try {
      const patientId = req.params.patientId;
      const testId = req.params.testId;
      const isPatientWithTestExist= await Patient.isPatientWithTestExist(patientId,testId)
         if (!isPatientWithTestExist) throw new Error(" There is no patient with this test.Kindly try again.");
         // ★ same patient-access rule as the patient pages (pathology routes used no other check)
         if (!(await canAccess(req, patientId))) throw new Error('You do not have access to this patient.');
         next();
   } catch (error) {
      return renderHomeWithError(res, error, 'Some Error Occurred.');
   }
}

 /**
  * 
  * @param {*} req 
  * @param {*} res 
  * @returns 
  * This is used for downloading pathology report.
  */
const downloadPathologyReportAsPdf= async(req,res)=>{
   try {
      const patientId= req.params.patientId;
      const testId= req.params.testId;
      if (!(await canAccess(req, patientId))) throw new Error('You do not have access to this patient.');
      // ★ the pathology PDF is the report hand-over too: no cancelled patients, no pending dues (unless authorised)
      const hand = await Report.checkHandOver(req.user && req.user.Id, await Report.loadReportTarget(patientId, testId));
      if (!hand.ok) throw new Error(hand.message);
      const {html,patientDetails}= await getHtmlContentForPathologyReport(patientId,testId)
      await serveReportAsPdf(html,true,patientDetails,res);
   } catch (error) {
      return renderHomeWithError(res, error, 'Some Error Occurred while downloading the pathology report.');
   }
}
/**
 * 
 * @param {*} patientId 
 * @param {*} testId 
 * @returns 
 * This is used to get html content of report for downloading 
 * This is ude for Pathology report
 */
 const getHtmlContentForPathologyReport = async (patientId, testId) => {
   try {
    // const reportData = await Report.getReportData(patientId, testId);
    const patientDetails = await fetchPatientDetails(patientId);
    const groupedResults = await fetchReportData(patientDetails, testId);
    const savedData = await Report.getPatientPathoTestData(patientId, testId);

     //const patientDetails = await Patient.getPatientDetails(patientId);
 
     if (!savedData || !patientDetails) {
       throw new Error('Report or patient details not found');
     }
 
     const html = await ejs.renderFile('./views/partials/pathologyReport.ejs', { groupedResults, patientDetails , savedData});
     return { html, patientDetails };
   } catch (error) {
     console.error('Error generating report content:', error);

     throw error;
   }
 };

 
 
 const searchDocument = async (req, res) => {
  let notifications=[]
  try {
      const documentCategoryId = req.body?.documentCategory ?? '';
      const documentName = req.body?.searchDocumentName ?? '';

      // Fetch category list (for dropdowns or filters)
      const DocumentCategoryDetails = await Category.getDocumentCategoryList();

      // Search documents dynamically
      const documentDetails = await Report.getDocumentDetails(documentCategoryId, documentName);

      res.render('displayDocumentDetails', {
          documentDetails,
          DocumentCategoryDetails,
          documentCategoryId,
          documentName,
          title: 'Search Document List',
          BRAND_NAME: process.env.BRAND_NAME,
          layout: 'loggedInLayout'
      });

  } catch (error) {
      console.error("Error in searchDocument:", error);
      notifications.push(createNotification('danger',error,'bi-exclamation-triangle-fill'))
      // Show an error message on the same page
      res.render('displayDocumentDetails', {
          documentDetails: [],
          DocumentCategoryDetails: await Category.getDocumentCategoryList(),
          documentCategoryId: req.body?.documentCategory ?? '',
          documentName: req.body?.searchDocumentName ?? '',
          title: 'Search Document List',
          BRAND_NAME: process.env.BRAND_NAME,
          layout: 'loggedInLayout',
          notifications// errorMessage: error.message || 'An unexpected error occurred. Please try again.'
      });
  }
};

/**
 * 
 * @param {*} req 
 * @param {*} res 
 * This function generates count of test which has done for the patient within a time range.
 * it will give count based on category
 * like MRi --3
 * Pathology---1
 */
const getCategoryWiseCollectionPage= async(req,res)=>{
  let notifications=[]
  try {
   
    //by default set todays date
    //result at the first time will come from todays dates
    const FromDate= req.query?.FromDate || moment().format('DD-MM-YYYY')
    const ToDate= req.query?.ToDate || moment().format('DD-MM-YYYY')
    if (!moment(FromDate, 'DD-MM-YYYY', true).isValid() || !moment(ToDate, 'DD-MM-YYYY', true).isValid())
       throw new Error('Dates must be in DD-MM-YYYY format.')
    if (!moment(FromDate, 'DD-MM-YYYY', true).isSameOrBefore(moment(ToDate, 'DD-MM-YYYY', true)))
       throw new Error('From Date should be less than or equal to To Date.')
     // notifications.push(createNotification('danger',))
     
    const categoryWiseCollections= await Report.getCategoryWisePatient(req)
    res.render('categoryWiseCollection', {
      title: 'Category wise collection',
      categoryWiseCollections,
      FromDate,
      ToDate,
      BRAND_NAME: process.env.BRAND_NAME,
      layout: 'loggedInLayout'
  });
  } catch (error) {
    console.log(error)
    renderHomeWithError(res, error.message || error)
  }

}
// GET /report/getTestWiseCollectionJson/:categoryId/:fromDate/:toDate
const getTestWiseCollectionJson = async (req, res) => {
    try {
        const { CategoryId, FromDate, ToDate } = req.params;
        const tests = await Report.getTestWiseCollection(CategoryId, FromDate, ToDate);
        return res.json({ success: true, tests });
    } catch (err) {
        return res.json({ success: false, tests: [], message: errText(err, 'Could not load the tests.') });
    }
};

// ─────────────────────────────────────────────────────────────
// VIEW COLLECTION / DAILY SETTLEMENT
//   GET  /report/settlement                       → today
//   GET  /report/settlement?FromDate=..&ToDate=.. → bookmarkable / shareable
//   POST /report/settlement/search                → form
// FIXES: getMasterSettlement returned {success:false} on error and the page then
// crashed on undefined data; redirects went to "/" and a non-existent "/settlement";
// req.flash('error') never showed; full patient data was console.logged.
// ─────────────────────────────────────────────────────────────
const SETTLEMENT_VIEW = 'viewCollection';
// Function that lets a non-admin open any date other than today (Users → Authorize).
const PAST_COLLECTION_SLUG = '/viewCollection/pastDates';

/** Non-admins without the past-dates function are kept on today's collection. */
const limitToToday = async (req, src) => {
    const today = moment().format('YYYY-MM-DD');
    let range;
    try { range = Report.parseSettlementRange ? Report.parseSettlementRange(src) : null; } catch (e) { return { src, blocked: false }; }
    const isTodayOnly = range ? (range.from === today && range.to === today) : !(src.FromDate || src.ToDate || src.from || src.to);
    if (isTodayOnly) return { src, blocked: false };
    if (await require('../models/User').hasFunction(req, PAST_COLLECTION_SLUG)) return { src, blocked: false };
    return { src: {}, blocked: true };
};

const renderSettlement = async (req, res, src) => {
    const notifications = [];
    const lim = await limitToToday(req, src || {});
    src = lim.src;
    if (lim.blocked) notifications.push(createNotification('warning',
        'You can only view today\'s collection. Ask the admin for "View Collection - Past Dates" access.', 'bi-lock-fill'));
    let data;
    try {
        data = await Report.getMasterSettlement({ body: src });
    } catch (err) {
        if (!err.isUserError) console.error('settlement:', err);
        notifications.push(createNotification('danger',
            err.isUserError ? err.message : 'Could not load the collection for those dates. Showing today instead.',
            'bi-exclamation-triangle-fill'));
        data = await Report.getMasterSettlement({ body: {} });   // today — if this fails too, the error handler takes it
    }
    if (!data.userWise.length && !data.cancellations.length && !data.duesReceived.length) {
        notifications.push(createNotification('info', 'No registrations or payments in this period.', 'bi-info-circle-fill'));
    }
    res.set('Cache-Control', 'no-store');   // money page: never show a stale copy from the back button
    return res.render(SETTLEMENT_VIEW, {
        ...data,
        notifications,
        FromDate: data.dateRange.from,
        ToDate:   data.dateRange.to,
        title: 'View Collection', BRAND_NAME: process.env.BRAND_NAME, layout: 'loggedInLayout',
    });
};

const getSettlementView = async (req, res, next) => {
    try { return await renderSettlement(req, res, req.query || {}); }
    catch (err) { console.error('getSettlementView:', err); return next(err); }
};

const searchSettlement = async (req, res, next) => {
    try { return await renderSettlement(req, res, req.body || {}); }
    catch (err) { console.error('searchSettlement:', err); return next(err); }
};

// JSON API (dashboard widgets): GET /report/settlementJson?FromDate=&ToDate=
const getSettlementJson = async (req, res) => {
    try {
        const lim = await limitToToday(req, { ...(req.body || {}), ...(req.query || {}) });
        if (lim.blocked) return res.status(403).json({ success: false, message: 'You can only view today\'s collection.' });
        const data = await Report.getMasterSettlement({ body: lim.src });
        res.set('Cache-Control', 'no-store');
        return res.json(data);
    } catch (err) {
        if (!err.isUserError) console.error('getSettlementJson:', err);
        return res.status(err.isUserError ? 400 : 500).json({ success: false, message: err.isUserError ? err.message : 'Could not load the collection.' });
    }
};


// Multer — store temporarily in /tmp, we move it after validation
const upload = multer({
    dest: "tmp/",
    fileFilter: (req, file, cb) => {
        if (file.originalname.endsWith(".docx")) {
            cb(null, true);
        } else {
            cb(new Error("Only .docx files are allowed."), false);
        }
    },
    limits: { fileSize: 10 * 1024 * 1024 }  // 10MB max
});


// ─────────────────────────────────────────────────────────────
// TEMPLATE LIST
// GET /report/templates
// ─────────────────────────────────────────────────────────────
const templateList = async (req, res) => {
    try {
        // ★ getAllTemplates() needs doctor/test/gender — called without them it always failed
        const templates = await Report.getTemplateList();
        return res.render("Report/templateList", { templates,title:'View Collection',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout' });
    } catch (err) {
        console.error("templateList:", err);
        flash(req, 'danger', 'Could not load the templates.');
        return res.redirect("/");
    }
};


// ─────────────────────────────────────────────────────────────
// TEMPLATE FORM — new or edit
// GET /report/templates/new
// GET /report/templates/:id/edit
// ─────────────────────────────────────────────────────────────
const templateForm = async (req, res) => {
    try {
        const templateId = req.params.id ? parseInt(req.params.id) : null;

        const [doctors, tests] = await Promise.all([
            Doctor.getDoctorList(),
            Test.getTestDetails(),
        ]);

        const template = templateId
            ? await Report.getTemplateById(templateId)
            : null;

        return res.render("Report/templateForm", {
            template,
            doctors,
            tests,
            isEdit: !!templateId,
             title:'Template',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'
        });

    } catch (err) {
        console.error("templateForm:", err);
        flash(req, 'danger', 'Could not open the template.');
        return res.redirect("/report/templates");
    }
};


// ─────────────────────────────────────────────────────────────
// PREVIEW DOCX — AJAX
// POST /report/templates/preview
// Returns { success, html }
// ─────────────────────────────────────────────────────────────
const previewDocx = [
    upload.single("docxFile"),
    async (req, res) => {
        try {
            if (!req.file) {
                return res.json({ success: false, message: "No file uploaded." });
            }

            const html = cleanHtml(await templateService.docxToHtml(req.file.path));   // ★ preview shows cleaned HTML

            // Clean up temp file
            fs.unlinkSync(req.file.path);

            return res.json({ success: true, html });

        } catch (err) {
            console.error("previewDocx:", err);
            if (req.file?.path && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
            return res.json({ success: false, message: 'Could not read the Word file. Save it again as .docx and retry.' });
        }
    }
];


// ─────────────────────────────────────────────────────────────
// SAVE TEMPLATE
// POST /report/templates/save
// ─────────────────────────────────────────────────────────────
// POST /report/templates/save
// Handles: common (1 file) OR separate (2 files — male + female)
const saveTemplate = [
  upload.fields([
      { name: "commonFile", maxCount: 1 },
      { name: "maleFile",   maxCount: 1 },
      { name: "femaleFile", maxCount: 1 },
  ]),
  async (req, res) => {
      try {
          const { id, genderMode } = req.body;
          const templateId = id ? toId(id) : null;
          // ★ testId / doctorId went straight into templateService.saveUploadedFile(file, testId, …) — a
          //   value like "../../views" could steer the file path. Only positive integers now.
          const testId   = req.body.testId   ? toId(req.body.testId)   : null;
          const doctorId = req.body.doctorId ? toId(req.body.doctorId) : null;
          const name     = String(req.body.name || '').replace(/[<>]/g, '').trim().slice(0, 150);
          if ((req.body.testId && !testId) || (req.body.doctorId && !doctorId)) throw Object.assign(new Error('Invalid test or doctor.'), { isUserError: true });

          // ── Common mode ──────────────────────────────────
          if (genderMode === "common") {
              const file = req.files?.commonFile?.[0];
              if (!templateId && !file) {
                  flash(req, 'danger', "Please upload a .docx file.");
                  return res.redirect("/report/templates/new");
              }

              let filePath, originalName;

              if (file) {
                  // Delete old if editing
                  if (templateId) {
                      const old = await Report.getTemplateById(templateId);
                      if (old?.FilePath) templateService.deleteFile(old.FilePath);
                  }
                  filePath     = templateService.saveUploadedFile(file, testId || "notest", "common");
                  originalName = file.originalname;
              } else {
                  const old    = await Report.getTemplateById(templateId);
                  if (!old) throw Object.assign(new Error('Template not found.'), { isUserError: true });
                  filePath     = old.FilePath;
                  originalName = old.OriginalName;
              }

              await Report.saveTemplate({
                  id:          templateId,
                  name:        name || "Common Template",
                  doctorId:    doctorId || null,
                  testId:      testId   || null,
                  genderType:  "common",
                  filePath,
                  originalName,
                  createdBy:   req.user.Id,
              });

          // ── Separate mode — save male + female ───────────
          } else if (genderMode === "separate") {
              const maleFile   = req.files?.maleFile?.[0];
              const femaleFile = req.files?.femaleFile?.[0];

              // For create — at least one file required
              if (!templateId && !maleFile && !femaleFile) {
                  flash(req, 'danger', "Please upload at least one .docx file.");
                  return res.redirect("/report/templates/new");
              }

              // ── Save male ──
              if (maleFile) {
                  // Check if male template exists for this test+doctor
                  const [existingMale] = await db().execute(
                      `SELECT Id, FilePath FROM ReportTemplates
                       WHERE TestId=? AND DoctorId<=> ? AND GenderType='male' LIMIT 1`,
                      [testId || null, doctorId || null]
                  );
                  if (existingMale.length) {
                      templateService.deleteFile(existingMale[0].FilePath);
                  }
                  await Report.saveTemplate({
                      id:          existingMale[0]?.Id || null,
                      name:        `${name} — Male`,
                      doctorId:    doctorId || null,
                      testId:      testId   || null,
                      genderType:  "male",
                      filePath:    templateService.saveUploadedFile(maleFile, testId || "notest", "male"),
                      originalName: maleFile.originalname,
                      createdBy:   req.user.Id,
                  });
              }

              // ── Save female ──
              if (femaleFile) {
                  const [existingFemale] = await db().execute(
                      `SELECT Id, FilePath FROM ReportTemplates
                       WHERE TestId=? AND DoctorId<=> ? AND GenderType='female' LIMIT 1`,
                      [testId || null, doctorId || null]
                  );
                  if (existingFemale.length) {
                      templateService.deleteFile(existingFemale[0].FilePath);
                  }
                  await Report.saveTemplate({
                      id:          existingFemale[0]?.Id || null,
                      name:        `${name} — Female`,
                      doctorId:    doctorId || null,
                      testId:      testId   || null,
                      genderType:  "female",
                      filePath:    templateService.saveUploadedFile(femaleFile, testId || "notest", "female"),
                      originalName: femaleFile.originalname,
                      createdBy:   req.user.Id,
                  });
              }
          }

          flash(req, 'success', 'Template saved successfully.');
          return res.redirect("/report/templates");

      } catch (err) {
          console.error("saveTemplate:", err);
          // Clean up any uploaded temp files
          ["commonFile","maleFile","femaleFile"].forEach(key => {
              req.files?.[key]?.[0] && fs.existsSync(req.files[key][0].path) &&
                  fs.unlinkSync(req.files[key][0].path);
          });
          flash(req, 'danger', errText(err, 'Could not save the template.'));
          const back = toId(req.body.id);
          return res.redirect(back ? `/report/templates/${back}/edit` : "/report/templates/new");
      }
  }
];

// ─────────────────────────────────────────────────────────────
// DELETE TEMPLATE — AJAX
// POST /report/templates/delete
// ─────────────────────────────────────────────────────────────
const deleteTemplate = async (req, res) => {
    try {
        const id = toId(req.body.id);
        if (!id) return res.json({ success: false, message: 'Template not found.' });
        const result = await Report.deleteTemplate(id);
        return res.json(result);
    } catch (err) {
        return jsonFail(res, err, 'Could not delete the template.');
    }
};


// ─────────────────────────────────────────────────────────────
// CREATE REPORT VIEW
// GET /report/create?patientId=X&testId=Y
// ─────────────────────────────────────────────────────────────
/**
 * ★ Old editor (GET /report/create). It could not work any more: resolveTemplate() returns
 * { content, templateId } now (not { mode, template }), and the "existing report" check destructured a
 * row instead of an array, so it always re-loaded the template OVER a saved report.
 * It now opens the current editor, which has all the checks.
 */
const createReportView = async (req, res) => getReportPage(req, res);


// ─────────────────────────────────────────────────────────────
// LOAD TEMPLATE PREVIEW — AJAX (for "both" mode chooser)
// GET /report/template-preview/:templateId?patientId=X&testId=Y
// ─────────────────────────────────────────────────────────────
const loadTemplatePreview = async (req, res) => {
    try {
        const templateId        = parseInt(req.params.templateId);
        const patientId         = parseInt(req.query.patientId);
        const testId            = parseInt(req.query.testId);
        const reportingDoctorId = req.user.Id;

        if (!(await canAccess(req, patientId))) return res.json({ success: false, message: 'You do not have access to this patient.' });
        const [template, context] = await Promise.all([
          Report.getTemplateById(templateId),
          Report.getPatientReportContext(patientId, testId, reportingDoctorId),
        ]);

        if (!template || !context) {
            return res.json({ success: false, message: "Not found." });
        }

        const absPath  = templateService.getAbsolutePath(template.FilePath);
        const filled   = await templateService.fillDocxTemplate(absPath, context);
        const result   = await require("mammoth").convertToHtml({ buffer: filled });

        return res.json({ success: true, html: cleanHtml(result.value), templateId });

    } catch (err) {
        return jsonFail(res, err, 'Could not load the template.');
    }
};


// ─────────────────────────────────────────────────────────────
// GET — initial page load (no report data yet)
// GET /report/doctorPatientServiceReport
// ─────────────────────────────────────────────────────────────
const getDoctorPatientReportView = async (req, res) => {
    try {
        const categories = await Category.getCategoryList();

        return res.render("Report/doctorPatientServiceReport", {
            categories,
            reportData: undefined,   // undefined = form not yet submitted
            months:     [],
            mode:       "month",
            categoryId: "",
            startDate:  "",
            endDate:    "",
            periodEnd:  "10",
            title: 'Doctor Patient Refference',
            BRAND_NAME: process.env.BRAND_NAME,
            layout: 'loggedInLayout'
        });

    } catch (err) {
        console.error("getDoctorPatientReportView:", err);
        req.flash("error", "Failed to load report page.");
        return res.redirect("/user/home");
    }
};


// ─────────────────────────────────────────────────────────────
// POST — generate report
// POST /report/doctorPatientServiceReport
// ─────────────────────────────────────────────────────────────
const generateDoctorPatientReport = async (req, res) => {
    const { categoryId, startDate, endDate, mode, periodEnd } = req.body;

    // Always load categories for the dropdown
    let categories = [];
    try {
        categories = await Category.getCategoryList();
    } catch (err) {
        console.error("getCategories error:", err);
    }

    // ── Validation ────────────────────────────────────────────
    if (!categoryId || !startDate || !endDate) {
        req.flash("error", "Please fill in all required fields.");
        return res.render("Report/doctorPatientServiceReport", {
            categories,
            reportData: undefined,
            months:    [],
            mode:      mode || "month",
            categoryId: categoryId || "",
            startDate:  startDate  || "",
            endDate:    endDate    || "",
            periodEnd:  periodEnd  || "10",
            title: 'Doctor Patient Refference',
            BRAND_NAME: process.env.BRAND_NAME,
            layout: 'loggedInLayout'
        });
    }

    // ── Date format validation ────────────────────────────────
    const dateRegex = /^\d{2}-\d{2}-\d{4}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
        req.flash("error", "Dates must be in DD-MM-YYYY format.");
        return res.render("Report/doctorPatientServiceReport", {
            categories,
            reportData: undefined,
            months:    [],
            mode:      mode || "month",
            categoryId, startDate, endDate,
            periodEnd: periodEnd || "10",
            title: 'Doctor Patient Refference',
            BRAND_NAME: process.env.BRAND_NAME,
            layout: 'loggedInLayout'
        });
    }

    // ── Convert and validate date range ──────────────────────
    const parseDMY = (str) => {
        const [d, m, y] = str.split("-");
        return new Date(`${y}-${m}-${d}`);
    };
    if (parseDMY(startDate) > parseDMY(endDate)) {
        req.flash("error", "Start date cannot be after end date.");
        return res.render("Report/doctorPatientServiceReport", {
            categories,
            reportData: undefined,
            months:    [],
            mode:      mode || "month",
            categoryId, startDate, endDate,
            periodEnd: periodEnd || "10",
            title: 'Doctor Patient Refference',
            BRAND_NAME: process.env.BRAND_NAME,
            layout: 'loggedInLayout'
        });
    }

    // ── Fetch report data ─────────────────────────────────────
    try {
        let reportData = [];
        let months     = [];

        if (mode === "period") {
            const result = await Report.getPeriodWiseReport(
                categoryId,
                startDate,
                endDate,
                periodEnd || "10"
            );
            reportData = result.reportData;
            months     = result.months;
        } else {
            // Default: month-wise
            const result = await Report.getMonthWiseReport(
                categoryId,
                startDate,
                endDate
            );
            reportData = result.reportData;
            months     = result.months;
        }

        return res.render("Report/doctorPatientServiceReport", {
            categories,
            reportData,
            months,
            mode:       mode || "month",
            categoryId: parseInt(categoryId),
            startDate,
            endDate,
            periodEnd:  periodEnd || "10",
            title: 'Doctor Patient Refference',
            BRAND_NAME: process.env.BRAND_NAME,
            layout: 'loggedInLayout'
        });

    } catch (err) {
        console.error("generateDoctorPatientReport:", err);
        req.flash("error", errText(err, "Failed to generate report."));
        return res.render("Report/doctorPatientServiceReport", {
            categories,
            reportData: undefined,
            months:    [],
            mode:      mode || "month",
            categoryId, startDate, endDate,
            periodEnd: periodEnd || "10",
            title: 'Doctor Patient Refference',
            BRAND_NAME: process.env.BRAND_NAME,
            layout: 'loggedInLayout'
        });
    }
};


// ─────────────────────────────────────────────────────────────
// GET — download as Excel
// GET /report/downloadDoctorPatientReportExcel/:categoryId/:startDate/:endDate/:mode/:periodEnd
// ─────────────────────────────────────────────────────────────
const downloadDoctorPatientReportExcel = async (req, res) => {
    try {
        const { startDate, endDate } = req.params;
        const categoryId = toId(req.params.categoryId);
        const mode       = req.params.mode === 'period' ? 'period' : 'month';
        const periodEnd  = String(Math.min(31, Math.max(1, parseInt(req.params.periodEnd, 10) || 10)));
        if (!categoryId || !/^\d{2}-\d{2}-\d{4}$/.test(startDate) || !/^\d{2}-\d{2}-\d{4}$/.test(endDate))
            return res.status(400).send('Invalid category or dates (use DD-MM-YYYY).');

        let result;
        if (mode === "period") {
            result = await Report.getPeriodWiseReport(
                categoryId, startDate, endDate, periodEnd || "10"
            );
        } else {
            result = await Report.getMonthWiseReport(
                categoryId, startDate, endDate
            );
        }

        const { reportData, months } = result;

        if (!reportData.length) {
            return res.status(404).send("No data to export.");
        }

        // Build CSV (works without xlsx library)
        // If you have xlsx installed, replace with XLSX.utils.json_to_sheet
        const headers = ["#", "Doctor Name", "Specialist", "Trend", ...months, "Total"];

        const getTrend = (doc) => {
            const vals  = months.map(m => doc[m] || 0);
            const half  = Math.ceil(vals.length / 2);
            const avg1  = vals.slice(0, half).reduce((a,b)=>a+b,0) / half;
            const avg2  = vals.slice(Math.floor(vals.length/2)).reduce((a,b)=>a+b,0) / Math.ceil(vals.length/2);
            const pct   = avg1 > 0 ? Math.round(((avg2-avg1)/avg1)*100) : 0;
            if (pct > 5)  return `Increasing (+${pct}%)`;
            if (pct < -5) return `Decreasing (${pct}%)`;
            return "Stable";
        };

        const csv = (v) => {
            let t = String(v == null ? '' : v);
            if (/^[=+\-@]/.test(t)) t = "'" + t;                 // CSV-injection guard
            return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
        };
        const rows = reportData.map((doc, i) => {
            const vals  = months.map(m => doc[m] || 0);
            const total = vals.reduce((a,b) => a+b, 0);
            return [
                i + 1,
                `Dr. ${doc.DoctorName}`,
                doc.SpecialistIn || "",
                getTrend(doc),
                ...vals,
                total
            ].map(csv).join(",");
        });

        const csvContent = '\ufeff' + [headers.map(csv).join(","), ...rows].join("\r\n");   // BOM → Excel shows ₹ / Hindi names
        const filename   = `doctor_report_${String(startDate).replace(/[^0-9-]/g, '')}_${String(endDate).replace(/[^0-9-]/g, '')}.csv`;

        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        return res.send(csvContent);

    } catch (err) {
        console.error("downloadDoctorPatientReportExcel:", err);
        return res.status(500).send(errText(err, 'Export failed.'));
    }
};
const getRefferalPage = async(req,res)=>{
    try {
      const doctors = await Doctor.getDoctorList()
              res.render("Report/referralReport", {
                  doctors,
                  FromDate:       "",
                  ToDate:         "",
                  selectedDoctor: "",
                  title: 'Doctor Patient Refference',
                  BRAND_NAME: process.env.BRAND_NAME,
                  layout: 'loggedInLayout'
              });
          } catch (err) {
              console.error("referralReport GET:", err);
              res.status(500).send("Error loading page.");
          }
}


const parseFlat = (str) => {
    if (!str) return moment().format("YYYY-MM-DD");

    // Try each format in order — moment strict mode stops wrong matches
    const formats = ["DD MMM YYYY", "DD-MM-YYYY", "YYYY-MM-DD", "D-M-YYYY"];
    for (const fmt of formats) {
        const m = moment(str, fmt, true);  // true = strict
        if (m.isValid()) return m.format("YYYY-MM-DD");
    }

    // Last resort — let moment guess (may warn in console)
    console.warn("parseFlat: unrecognised date format:", str);
    return moment(str).format("YYYY-MM-DD");
};

const getRefferalPreview = async(req,res)=>{
        try {
            const fromDate    = parseFlat(req.body.FromDate);
            const toDate      = parseFlat(req.body.ToDate);
            const doctorId    = parseInt(req.body.doctorId) || null;
            const fromDisplay = req.body.FromDate || fromDate;
            const toDisplay   = req.body.ToDate   || toDate;

            const doctors = await Patient.getReferralReportData({ fromDate, toDate, doctorId });
    
            if (!doctors.length) {
                flash(req, 'warning', 'No referral data found for the selected period.');
                return res.redirect("/report/referral");
            }
    
            res.render("report/referralReportPreview", {
                doctors,
                fromDate:  fromDisplay,
                toDate:    toDisplay,
                clinicName: req.session?.clinic?.Name || "Clinic",
                generatedAt: moment().format("DD MMM YYYY, hh:mm A"),
                title:'Refferal',
                BRAND_NAME:process.env.BRAND_NAME,
                layout: 'loggedInLayout'
            });
    
        } catch (err) {
            console.error("referralReport POST:", err);
            res.status(500).send(errText(err, 'Report generation failed.'));
        }
}



/*const viewReport = async (req, res) => {
    const { patientId, testId } = req.query;
    try {
        const rawData = await Report.getFinalizedReport(patientId, testId);
        if (!rawData) return res.status(404).send('Report not found.');
        
        const html = buildHtmlLayout(rawData, false);
        res.setHeader('Content-Type', 'text/html');
        res.send(html);
    } catch (err) {
        res.status(500).send('Error: ' + err.message);
    }
};
*/

// ═══════════════════════════════════════════════════════════
// REPORT CONTROLLER — PATCHED FUNCTIONS
// Replace these functions in your existing ReportController
// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
// getReportPage — fixed: passes flat allTemplates array,
// passes patientGenderKey (string) not integer
// ═══════════════════════════════════════════════════════════
const getReportPage = async (req, res) => {
    const patientId = toId(req.query.patientId);
    const testId    = toId(req.query.testId);

    if (!patientId || !testId) {
        flash(req, 'danger', 'Missing patient or test.');
        return res.redirect('/patient/getPatientListView');
    }

    try {
        // ★ reporting-doctor logins only open their own doctors' patients
        if (!(await canAccess(req, patientId))) {
            flash(req, 'danger', 'You do not have access to this patient.');
            return res.redirect('/patient/getPatientListView');
        }
        const data = await Report.getReportPageData(patientId, testId);

        if (!data) {
            flash(req, 'danger', 'Patient or test not found.');
            return res.redirect('/patient/getPatientListView');
        }
        if (data.Status == 0) {
            flash(req, 'danger', 'Cannot create report for a cancelled patient.');
            return res.redirect(`/patient/getPatientDetail?patientId=${patientId}`);
        }
        if (!data.IsReportRequired) {
            flash(req, 'danger', 'This test does not require a report.');
            return res.redirect(`/patient/getPatientDetail?patientId=${patientId}`);
        }
        if (data.TestStatus !== 'Completed') {
            flash(req, 'danger', 'This test is not completed.First complete the test.');
            return res.redirect(`/patient/getPatientDetail?patientId=${patientId}`);
        }

        // ── gender as string key ──
        const genderKey = data.Gender == 1 ? 'male'
                        : data.Gender == 2 ? 'female'
                        : 'common';

        // ── flat array — works with new EJS dropdown ──
        const allTemplates = await Report.getAllTemplates(data.DoctorId || null, testId, genderKey);

        // ── resolve content ──
        let reportContent = '';
        let templateId    = null;
        let templateType  = 'manual';

        if (data.ExistingReport) {
            reportContent = data.ExistingReport;
            templateId    = data.TemplateId;
            templateType  = data.TemplateType || 'manual';
        } else if (data.ExistingReportLegacy) {
            reportContent = data.ExistingReportLegacy;
            templateType  = 'manual';
        } else {
            const templateResult = await Report.resolveTemplate(data.DoctorId || null, testId, genderKey);
            reportContent = fillPlaceholders(templateResult.content, reportContext(data, req.user, genderKey));
            templateId    = templateResult.templateId;
            templateType  = templateResult.templateType;
        }

        res.set('Cache-Control', 'no-store');
        return res.render('Report/createReport', {
            patientId,
            testId,
            testRefId:        data.TestRefId,
            patientName:      data.PatientName,
            testName:         data.TestName,
            categoryName:     data.CategoryName    || '',
            reportContent:    cleanHtml(reportContent),       // ★ old reports saved before the patch are cleaned on display
            templateId,
            templateType,
            currentUserQual: req.user?.Qualification || '',
            allDoctors:        await Report.getAllReportingDoctors(),
            finalizedByUserId: data.FinalizedBy || '',         // (was never selected → always '')
            allTemplates,                          // flat array now
            isReportReady:    data.ReportReady     == 1,
            isFinalized:      data.IsFinalized     == 1,
            finalizedAt:      data.FinalizedAt     || null,
            finalizedByName:  data.FinalizedByName || '',
            patientAge:       data.Age             || '',
            patientYMD:       data.YMD             || '',
            patientGender:    data.Gender          || '',    // integer (1/2) for display
            patientGenderKey: genderKey,                    // string for JS logic
            doctorName:       data.DoctorName      || '',
            registeredOn:     data.RegisteredOn    || null,
            title:            `Report — ${data.TestName}`,
            layout:           'loggedInLayout',
            BRAND_NAME:       process.env.BRAND_NAME,
        });

    } catch (err) {
        console.error('getReportPage error:', err);
        flash(req, 'danger', 'Failed to load the report page. Please try again.');
        return res.redirect('/patient/getPatientListView');
    }
};

/**
 * Placeholder values for a template.
 * ★ "ReportingDoctor" was filled with the REFERRING doctor's name — reports said the referring doctor
 *   had reported the scan. It is now the logged-in reporting doctor.
 */
const reportContext = (data, user, genderKey) => ({
    PatientName:           data.PatientName,
    Age:                   data.Age          || '',
    YMD:                   data.YMD          || '',
    Gender:                genderKey,
    Date:                  new Date().toLocaleDateString('en-IN'),
    TestName:              data.TestName,
    DoctorName:            data.DoctorName   || '',
    ReportingDoctor:       user ? [user.FirstName, user.LastName].filter(Boolean).join(' ') : '',
    ReportingDoctorDegree: (user && user.Qualification) || '',
});


// ═══════════════════════════════════════════════════════════
// switchTemplate — accepts templateId (number) OR templateType string.
// ★ It REPLACED the report text and set it back to draft even when the report was FINALIZED,
//   and wrote to whatever testRefId the browser sent.
// ═══════════════════════════════════════════════════════════
const switchTemplate = async (req, res) => {
    const { templateId, templateType: requestedType } = req.body;
    const userId = req.user?.Id;

    if (!templateId && !requestedType) {
        return res.json({ success: false, message: 'No template specified.' });
    }

    try {
        const target = await editableTarget(req);       // ★ finalized → refused; testRefId from the DB
        const data   = await Report.getReportPageData(target.PatientId, target.TestId);
        if (!data) return res.json({ success: false, message: 'Patient not found.' });
        const genderKey = data.Gender == 1 ? 'male' : data.Gender == 2 ? 'female' : 'common';

        let newContent      = '';
        let newTemplateId   = null;
        let newTemplateType = 'manual';

        if (templateId && templateId !== 'null') {
            const tpl = await Report.getTemplateById(toId(templateId));
            if (!tpl) return res.json({ success: false, message: 'Template not found.' });
            // ★ only templates offered for THIS test / doctor / gender (any template id was accepted)
            const offered = await Report.getAllTemplates(data.DoctorId || null, target.TestId, genderKey);
            if (!offered.some(t => Number(t.Id) === Number(tpl.Id)))
                return res.json({ success: false, message: 'This template is not for this test.' });
            newContent      = tpl.Content;
            newTemplateId   = tpl.Id;
            newTemplateType = tpl.TemplateType;
        } else {
            const allTemplates = await Report.getAllTemplates(data.DoctorId || null, target.TestId, genderKey);
            const found = allTemplates.find(t => t.TemplateType === requestedType);
            if (!found) return res.json({ success: false, message: 'Template type not available.' });
            newContent      = found.Content;
            newTemplateId   = found.Id;
            newTemplateType = found.TemplateType;
        }

        newContent = cleanHtml(fillPlaceholders(newContent, reportContext(data, req.user, genderKey)));

        await Report.saveReport({
            PatientId:     target.PatientId,
            TestRefId:     target.TestRefId,
            TestId:        target.TestId,
            DoctorId:      userId,
            TemplateId:    newTemplateId,
            TemplateType:  newTemplateType,
            ReportContent: newContent,
            ReportReady:   0,
            CreatedBy:     userId,
        });
        await Report.markReportDraft(target.PatientId, target.TestId, target.TestRefId);

        return res.json({ success: true, message: 'Template loaded.', content: newContent, templateId: newTemplateId, templateType: newTemplateType });

    } catch (err) {
        return jsonFail(res, err, 'Could not load the template.');
    }
};


// ═══════════════════════════════════════════════════════════
// saveReport
// ★ Finalize lock was checked on the browser's testRefId but the report was saved by patientId+testId →
//   a finalized report could be overwritten. Content is cleaned (stored XSS); "generated" is only set
//   when the report is marked READY (a draft counted as generated → could be marked delivered).
// ═══════════════════════════════════════════════════════════
const saveReport = async (req, res) => {
    const { report, finalize, templateId, templateType } = req.body;
    const userId = req.user?.Id;

    if (!report || !String(report).trim()) {
        return res.json({ success: false, message: 'Report content is empty.' });
    }
    if (String(report).length > 15 * 1024 * 1024) {
        return res.json({ success: false, message: 'The report is too large (images over 15 MB). Use smaller images.' });
    }

    try {
        const target = await editableTarget(req);
        const ready  = finalize === '1' || finalize === 1 || finalize === true;

        await Report.saveReport({
            PatientId:     target.PatientId,
            TestRefId:     target.TestRefId,
            TestId:        target.TestId,
            DoctorId:      userId,
            TemplateId:    toId(templateId),
            TemplateType:  ['doctor_test', 'doctor_default', 'test_default', 'system_default', 'manual'].includes(templateType) ? templateType : 'manual',
            ReportContent: report,
            ReportReady:   ready ? 1 : 0,
            CreatedBy:     userId,
        });

        if (ready) {
            await Report.markReportReady(target.PatientId, target.TestId, target.TestRefId);
            await Report.markReportGenerated(target.PatientId, target.TestId, userId);
        } else {
            await Report.markReportDraft(target.PatientId, target.TestId, target.TestRefId);
        }

        return res.json({ success: true, message: ready ? 'Report marked as ready.' : 'Draft saved.' });

    } catch (err) {
        return jsonFail(res, err, 'Could not save the report.');
    }
};


// ═══════════════════════════════════════════════════════════
// finalizeReport
// ★ Finalizing prints the finalizer's name + SIGNATURE on the report → doctors / admins only.
// ═══════════════════════════════════════════════════════════
const finalizeReport = async (req, res) => {
    const userId = req.user?.Id;
    try {
        const target = await editableTarget(req, { allowFinalized: true });
        if (Number(target.IsFinalized) === 1) return res.json({ success: false, message: 'Report is already finalized.' });
        if (!(await Report.isReportingDoctor(userId)))
            return res.json({ success: false, message: 'Only a reporting doctor (or admin) can finalize — the report carries the finalizer\'s signature.' });

        const done = await Report.finalizeReport(target.PatientId, target.TestId, target.TestRefId, userId);
        if (!done) {
            return res.json({ success: false, message: 'Report already finalized or not yet ready.' });
        }
        return res.json({ success: true, message: 'Report finalized successfully.' });
    } catch (err) {
        return jsonFail(res, err, 'Could not finalize the report.');
    }
};


// ═══════════════════════════════════════════════════════════
// unfinalizeReport
// ★ Anyone could unlock a signed report, change it and finalize again — no permission, no trace.
//   Now: admin or "EDIT_FINAL_REPORT" permission, a reason, and the signed text saved in ReportHistory.
// ═══════════════════════════════════════════════════════════
const unfinalizeReport = async (req, res) => {
    const userId = req.user?.Id;
    const reason = String(req.body.reason || req.body.unfinalizeReason || '').trim();
    try {
        const target = await editableTarget(req, { allowFinalized: true });
        if (!(await User.canEditFinalReport(userId)))
            return res.json({ success: false, message: 'You are not allowed to un-finalize reports. Ask an admin or an authorised doctor.' });
        if (reason.length < 5)
            return res.json({ success: false, message: 'Write the reason for un-finalizing (at least 5 characters). It is saved in the report history.' });

        const changed = await Report.unfinalizeReport(target.TestRefId, { patientId: target.PatientId, testId: target.TestId, userId, reason });
        if (!changed) return res.json({ success: false, message: 'This report is not finalized.' });
        return res.json({ success: true, message: 'Report un-finalized. You can now edit it. The signed version is kept in the history.' });
    } catch (err) {
        return jsonFail(res, err, 'Could not un-finalize the report.');
    }
};


// ═══════════════════════════════════════════════════════════
// saveAsDefaultTemplate — saves the current report as the doctor's template for this test + gender
// ★ The report text holds THIS patient's details → saving it as a template showed one patient's name /
//   phone on every later patient's report. Such content is refused now; it is also cleaned.
// ═══════════════════════════════════════════════════════════
const saveAsDefaultTemplate = async (req, res) => {
    const { content } = req.body;
    const userId = req.user?.Id;

    if (!req.body.testId || !content || !userId) {
        return res.json({ success: false, message: 'Missing required data.' });
    }

    try {
        const testId = toId(req.body.testId);
        if (!testId) return res.json({ success: false, message: 'Invalid test.' });

        let genderType = 'common';
        if (req.body.patientId) {
            const target = await Report.loadReportTarget(req.body.patientId, testId);
            if (!(await canAccess(req, target.PatientId))) return res.json({ success: false, message: 'You do not have access to this patient.' });
            const data = await Report.getReportPageData(target.PatientId, testId);
            if (data) genderType = data.Gender == 1 ? 'male' : data.Gender == 2 ? 'female' : 'common';

            const text = String(content).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').toLowerCase();
            const name = String(target.Name || '').trim().toLowerCase();
            const phone = String(target.PhoneNumber || '').replace(/\D/g, '');
            if ((name.length >= 3 && text.includes(name)) || (phone.length >= 10 && text.replace(/\D/g, '').includes(phone)))
                return res.json({ success: false, message: 'This text still contains the patient\'s name or phone number. Remove patient details before saving it as a template.' });
        }

        const [testRows] = await db().execute(`SELECT TestName FROM MainTestTable WHERE Id = ? LIMIT 1`, [testId]);
        if (!testRows.length) return res.json({ success: false, message: 'Test not found.' });
        const testName = testRows[0].TestName || 'Report';

        const [existing] = await db().execute(
            `SELECT Id, TemplateType FROM ReportTemplates
             WHERE DoctorId = ? AND TestId = ? AND GenderType = ? AND IsActive = 1
             LIMIT 1`,
            [userId, testId, genderType]
        );
        if (existing.length > 0) {
            return res.json({ success: false, message: `You already have a ${genderType} template for this test. Switch templates to use it.` });
        }

        await Report.saveDoctorTestTemplate(userId, testId, content, genderType, testName);

        return res.json({
            success: true,
            message: `Saved as your ${genderType} template for ${testName}. It will load automatically next time.`,
            genderType,
        });

    } catch (err) {
        return jsonFail(res, err, 'Could not save the template.');
    }
};




// ═══════════════════════════════════════════════════════════
// Replace downloadPdf and downloadDoc in ReportController.js
// ═══════════════════════════════════════════════════════════

//const { buildHtmlLayout, buildDocxHtml, safeName } = require('../helper/reportBuilder');
//const html_to_docx = require('html-to-docx');

// ── PDF ────────────────────────────────────────────────────
const downloadPdfOld = async (req, res) => {
    const { patientId, testId } = req.query;
    try {
        const rawData = await Report.getFinalizedReport(patientId, testId);
        if (!rawData)             return res.status(404).send('Report not found.');
        if (!rawData.ReportReady) return res.status(400).send('Report not yet finalized.');

        // Fetch ALL reporting doctors (role = doctor)
        rawData.doctors = await Report.getAllReportingDoctors();

        const html = buildHtmlLayout(rawData, true);  // true = auto-download PDF
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);

    } catch (err) {
        console.error('[downloadPdf]', err);
        res.status(500).send('Failed to generate report: ' + err.message);
    }
};

// ── DOCX ────────────────────────────────────────────────────
const downloadDocOld = async (req, res) => {
    const { patientId, testId } = req.query;
    try {
        const rawData = await Report.getFinalizedReport(patientId, testId);
        if (!rawData)             return res.status(404).send('Report not found.');
        if (!rawData.ReportReady) return res.status(400).send('Report not yet finalized.');

        // Fetch doctors for DOCX (shows only finalizing doctor)
        rawData.doctors = await Report.getAllReportingDoctors();

        const htmlContent = buildDocxHtml(rawData);
        const buffer      = await html_to_docx(htmlContent, null, {
            table:  { row: { cantSplit: true } },
            footer: false,
            header: false,
        });

        const filename = `Report_${safeName(rawData.Name)}_${safeName(rawData.TestName)}.docx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);

    } catch (err) {
        console.error('[downloadDoc]', err);
        res.status(500).send('Failed to generate DOCX: ' + err.message);
    }
};

// ═══════════════════════════════════════════════════════════
// In ReportController.js — update fillPlaceholders function
// Replace existing fillPlaceholders with this version
// ═══════════════════════════════════════════════════════════

function fillPlaceholders(html, context) {
    if (!html) return '';
    let filled = html;

    // {{testName}} → bold H1 heading (SONOGRAPHY OF TEST NAME)
    if (context.TestName) {
        filled = filled.replace(/\{\{testName\}\}/gi,
            `<h1 style="font-size:13pt;font-weight:700;color:#1a3a6e;text-align:center;` +
            `text-transform:uppercase;letter-spacing:0.5px;margin:6px 0 4px;">` +
            `SONOGRAPHY OF ${context.TestName.toUpperCase()}</h1>`
        );
    }

    // {{age}} → age + YMD string
    const ageStr = context.Age
        ? `${context.Age}${context.YMD ? ' ' + context.YMD : ' Years'}`
        : '';
    if (ageStr) {
        filled = filled.replace(/\{\{age\}\}/gi, ageStr);
    }

    // Keep other placeholders as-is for future use
    // {{patientName}}, {{gender}}, {{date}}, {{referredBy}} etc
    // can be added here later without changing templates

    return filled;
}

const downloadPdfPrintOld = async (req, res) => {
    const { patientId, testId } = req.query;
    try {
        const rawData = await Report.getFinalizedReport(patientId, testId);
        if (!rawData)             return res.status(404).send('Report not found.');
        if (!rawData.ReportReady) return res.status(400).send('Report not yet finalized.');
        rawData.doctors = await Report.getAllReportingDoctors();
        const { buildHtmlLayout } = require('../helper/reportBuilder');
        // printMode=true → no header/footer, narrow margins
        const html = buildHtmlLayout(rawData, true, true);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (err) {
        console.error('[downloadPdfPrint]', err);
        res.status(500).send('Failed: ' + err.message);
    }
};

/**
 * ★ Every staff download (PDF / print / Word) goes through here:
 *   access to the patient · patient not cancelled · report FINALIZED (signed) · dues cleared or authorised.
 * Before: any logged-in user, any patientId in the URL, unsigned drafts that were only "ready",
 * cancelled patients, and reports with dues pending (bypassing the hand-over rule) could be downloaded.
 * Returns the report data, or null after sending the answer.
 */
const loadForDownload = async (req, res) => {
    const patientId = toId(req.query.patientId), testId = toId(req.query.testId);
    if (!patientId || !testId) { res.status(400).send('Missing patient or test.'); return null; }
    if (!(await canAccess(req, patientId))) { res.status(403).send('You do not have access to this patient.'); return null; }
    const rawData = await Report.getFinalizedReport(patientId, testId);
    if (!rawData)                                 { res.status(404).send('Report not found.'); return null; }
    if (Number(rawData.IsFinalized) !== 1)        { res.status(400).send('Report is not finalized yet — finalize (sign) it before printing or downloading.'); return null; }
    const hand = await Report.checkHandOver(req.user && req.user.Id, await Report.loadReportTarget(patientId, testId));
    if (!hand.ok)                                 { res.status(403).send(hand.message); return null; }
    rawData.doctors = await Report.getAllReportingDoctors();
    res.set('Cache-Control', 'no-store');
    return rawData;
};

const downloadPdf = async (req, res) => {
    try {
        const rawData = await loadForDownload(req, res);
        if (!rawData) return;

        if (USE_PUPPETEER) {
            const pdfBuffer = await generatePdfWithPuppeteer(rawData);
            const filename  = `Report_${safeName(rawData.Name)}_${safeName(rawData.TestName)}.pdf`;
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            return res.send(pdfBuffer);
        }

        // BRAND, imageToBase64, cleanReportHtml all come from reportBuilder.js
        const html = buildHtmlWithHeaderFooter(rawData, BRAND, imageToBase64, cleanReportHtml);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);

    } catch (err) {
        console.error('[downloadPdf]', err);
        res.status(500).send(errText(err, 'Failed to generate the report.'));
    }
};

// ── PDF WITHOUT header/footer — print on physical letterhead pad ──
const downloadPdfPrint = async (req, res) => {
    try {
        const rawData = await loadForDownload(req, res);
        if (!rawData) return;

        // Always use browser builder for print mode —
        // print mode just removes header/footer stamps,
        // @page margins still match physical letterhead dimensions
        const html = buildHtmlLayout(rawData, 'print');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);

    } catch (err) {
        console.error('[downloadPdfPrint]', err);
        res.status(500).send(errText(err, 'Failed to generate the print PDF.'));
    }
};

// ── DOCX ──────────────────────────────────────────────────────
const downloadDoc = async (req, res) => {
    try {
        const rawData = await loadForDownload(req, res);
        if (!rawData) return;

        const htmlContent = buildDocxHtml(rawData);
        const filename    = `Report_${safeName(rawData.Name)}_${safeName(rawData.TestName)}.doc`;

        res.setHeader('Content-Type', 'application/msword');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(htmlContent);

    } catch (err) {
        console.error('[downloadDoc]', err);
        res.status(500).send(errText(err, 'Failed to generate the document.'));
    }
};


//module.exports = { downloadPdf, downloadDoc };
/**
 * 
 * @param {*} type 
 * @param {*} messages 
 * @param {*} icon 
 * @returns 
 */
// Centralized notification creation
const createNotification = (type, messages, icon) => ({type,messages,icon,});
//export all the function for global variable
module.exports = {
  // viewCollection: viewCollection,
   //lizeReport:finalizeReport,
   // downloadReportAsPdf:downloadReportAsPdf,
   // downloadReportAsDoc:downloadReportAsDoc,
    getDiscountReport:getDiscountReport,
    getDocumentUploadForm:getDocumentUploadForm,
    uploadDocument:uploadDocument,
    displayDocumentDetails:displayDocumentDetails,
    deleteDocument:deleteDocument,
    getPathologyReportingPage:getPathologyReportingPage,
    generateLinkForReportDownload:generateLinkForReportDownload,
    downloadReportAsPdfFromLink:downloadReportAsPdfFromLink,
    submitPatientData:submitPatientData,
    viewPathologyReport:viewPathologyReport,
    isPatientWithTestExist:isPatientWithTestExist,
    downloadPathologyReportAsPdf:downloadPathologyReportAsPdf,
   // patientHistory:patientHistory,
    searchDocument:searchDocument,
    getCategoryWiseCollectionPage:getCategoryWiseCollectionPage,
    getTestWiseCollectionJson:getTestWiseCollectionJson,
    getSettlementView:getSettlementView,
    searchSettlement:searchSettlement,
    getSettlementJson:getSettlementJson,
    templateForm:templateForm, 
   // saveTemplateController:saveTemplateController,
    templateList:templateList,
    templateForm:templateForm,
    previewDocx:previewDocx,
    saveTemplate:saveTemplate,
    deleteTemplate:deleteTemplate,
    createReportView:createReportView,
    loadTemplatePreview:loadTemplatePreview,
    getDoctorPatientReportView:getDoctorPatientReportView,
    generateDoctorPatientReport:generateDoctorPatientReport,
    downloadDoctorPatientReportExcel:downloadDoctorPatientReportExcel,
    getRefferalPage:getRefferalPage,
    getRefferalPreview:getRefferalPreview,
   // create test for patient
   // finalizeReport:finalizeReport,
    getReportPage:getReportPage,
    //saveReport:saveReport,
    switchTemplate:switchTemplate,
    finalizeReport:finalizeReport,
    unfinalizeReport:unfinalizeReport,
    downloadPdf:downloadPdf,
    downloadDoc:downloadDoc,
    createReportView:createReportView,
    createReport:createReport,
    saveReport:saveReport,
    saveAsDefaultTemplate:saveAsDefaultTemplate,
    downloadPdfPrint:downloadPdfPrint

  };
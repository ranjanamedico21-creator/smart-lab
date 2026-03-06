const PatientController = require("../controllers/PatientController");
const Patient=require("../models/Patient");
const {readFileSync}= require('fs');
const Report = require("../models/Report");
let ejs = require('ejs');
const convertPdf= require('../views/partials/htmlToPdf');
const fs = require('fs');
const html_to_docx = require('html-to-docx');
const Doctor = require("../models/Doctor");
const Category=require("../models/Category");
const moment= require('moment');
const { start } = require("repl");
const Billing = require("../models/Billing");

//utility function
 // Function to handle rendering the home page with errors
 const renderHomeWithError = (res, error, customMessage = '') => {
  let notifications=[]
  if (customMessage) {
      notifications.push(createNotification('danger', customMessage, 'bi-exclamation-triangle-fill'));
  }
  if(error)
      notifications.push(createNotification('danger', error, 'bi-exclamation-triangle-fill'));
  res.render('home', {notifications,title: 'Home',BRAND_NAME: process.env.BRAND_NAME,layout: 'loggedInLayout'});
};

/**
 * 
 * @param {*} req 
 * @param {*} res 
 */
let viewCollection=async (req,res)=>{
   try {
      const collections= await Report.viewCollection(req)
      const totalCollection=await Report.totalCollection(req)
      const cancelledPatientDetails= await Report.getCancelledPatientDetails(req);
      // Calculate total sum from the fetched data
      const totalAmountReturned = cancelledPatientDetails.reduce((sum, patient) => 
        sum + Number(patient.TotalPaymentReturned), 0
    );

      const totalDuesReceived= await Report.totalDuesReceived(req)
      const FromDate=req.body.FromDate || moment().format('DD-MM-YYYY')
      const ToDate= req.body.ToDate || moment().format('DD-MM-YYYY')
      res.render('viewCollection',{FromDate,ToDate,totalCollection,totalDuesReceived,collections,totalAmountReturned,title:'View Collection',BRAND_NAME:process.env.BRAND_NAME,cancelledPatientDetails,layout: 'loggedInLayout' })

   } catch (error) {
    console.log(error)
     renderHomeWithError(res,error)
   }
   
}

let createReport= async (req,res)=>{
  
   let testId=req.query.testId;
   let patientId=req.query.patientId
   let patientDetail= await Patient.getPatientDetails(patientId)
   let patientTestDetail=await Patient.getPatientTestDetail(patientId)
   if(patientDetail[0].Status==2){
      errors.push({msg:'Sorry this patient is cancelled so we dont need report.'})
      return res.render('getPatientDetails',{patientId,errors,patientDetail,patientTestDetail,title:'Patient Test Detail',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
   
   }
       //add code for logged in id to be doctor to create report.
   const gender= await Report.getGenderOfPatientForReport(patientId)
   
   let data= await Report.getTemplateDataForTest(testId,gender);
      data=data[0].Template
      // add code for cancelled patient then dont show the report 


   //get saved data from patient report if some report has been saved
   let savedData= await Report.getSavedReportData(patientId,testId);

   console.log(savedData);
      if(savedData[0].Report && typeof savedData[0].Report !=undefined)
            data=savedData[0].Report;
            res.render('createReport',{patientDetail,data,testId,patientId,title:'Create Report',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout' })
}


let saveReport= async(req,res)=>{
      try {
        // console.log(' i am here ')
         let result= await Report.saveReport(req);
            req.query.message=result
            PatientController.getPatientDetail(req,res)
      } catch (error) {
        console.log(error)
         //handle error appropriately
         //redirect to home page
         renderHomeWithError(res,error)
      }
}



const downloadReportAsPdf = async (req, res) => {
   try {
     const { patientId, testId, header: headerFooter } = req.query;
     if (!patientId || !testId) {
       return res.status(400).json({ success: false, message: 'Patient ID and Test ID are required' });
     }
 
     // Get HTML content and patient details
     const {html,patientDetails} = await getHtmlContentForReport(patientId, testId, res);
 
     // Serve PDF
     await serveReportAsPdf(html, headerFooter, patientDetails, res);
   } catch (error) {
     console.error('Error in downloading report:', error);
     return res.status(500).json({ success: false, message: 'Internal server error' });
   }
 };

 /**
  * 
  * @param {*} patientId 
  * @param {*} testId 
  * @returns object containing html data and pataientDetails object
  * This is used for downloading usg,xray,Ct scan,MRI,
  * This is not used for pathology Report
  */
 // Utility function to get report content
 const getHtmlContentForReport = async (patientId, testId , res) => {
   try {
     const getReport = await Report.getReportData(patientId, testId);
     const patientDetails = await Patient.getPatientDetails(patientId);
     if (!getReport || !patientDetails) {
       throw new Error('Report or patient details not found');
     }
 
     const html = await ejs.renderFile('./views/partials/report.ejs', { getReport, patientDetails });
     return { html, patientDetails };
   } catch (error) {
     console.error('Error generating report content:', error);
     renderHomeWithError(res,error)
   }
 };
 
 /**
  * 
  * @param {*} html 
  * @param {*} headerFooter 
  * @param {*} patientDetails 
  * @param {*} res 
  * This will help us to download the report in pdf format through browser
  */
 // Serve PDF response
 const serveReportAsPdf = async (html, headerFooter, patientDetails, res) => {
   try {
     // Normalize headerFooter value
     const includeHeaderFooter = headerFooter === undefined || headerFooter === 'true';
 
     // Read header and footer images
     const headerImage = fs.readFileSync('./images/JpHeaderF.jpg').toString('base64');
     const footerImage = fs.readFileSync('./images/JpFooter.jpg').toString('base64');
 
     const options = {
       format: 'A4',
       displayHeaderFooter: includeHeaderFooter,
       printBackground: true,
       headerTemplate: includeHeaderFooter ? `
         <div style="text-align: center;">
           <img src="data:image/jpeg;base64,${headerImage}" alt="Header" />
         </div>` : '',
       footerTemplate: includeHeaderFooter ? `
         <div style="text-align: center; position: absolute; bottom: 0;">
           <img src="data:image/jpeg;base64,${footerImage}" alt="Footer" />
         </div>` : '',
       margin: { top: '180px', bottom: '100px', right: '10px', left: '10px' },
     };
 
     // Convert HTML to PDF
     const pdfBuffer = await convertPdf.htmlToPdf(html, options);
 
     // Serve PDF
     const patientName = patientDetails[0]?.Name || 'Report';
     res.setHeader('Content-Type', 'application/pdf');
     res.setHeader('Content-Disposition', `attachment; filename="${patientName}_report.pdf"`);
     res.send(pdfBuffer);
   } catch (error) {
     console.error('Error in serving PDF:', error);
    // res.status(500).json({ success: false, message: 'Error generating PDF' });

    renderHomeWithError(res,error,'Error generating PDF')
   }
 };
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
 const downloadReportAsPdfFromLink = async (req, res) => {
   try {
     const result = await Report.checkToken(req);
 
     if (!result || result.length === 0) {
       return res.status(404).json({ success: false, message: 'Token not found' });
     }
 
     const { PatientId: patientId, TestId: testId } = result[0];
     const data = await getHtmlContentForReport(patientId, testId ,res);
 
     await serveReportAsPdf(data.html, true, data.patientDetails, res);
   } catch (error) {
    // console.error('Error in downloading report:', error);
    // const status = error.status || 500;
    // const message = error.message || 'Internal server error';
     renderHomeWithError(res,error)
    // return res.status(status).json({ success: false, message });
   }
 };

/**
 * 
 * @param {not working till now } req 
 * @param {*} res 
 */

let downloadReportAsDoc = async(req,res)=>{
         let patientId= req.query.patientId;
         let testId=req.query.testId;
         let getReport= await Report.getReportData(patientId,testId)
         console.log(getReport)

         console.log('*********get Report************')
         let patientDetails= await Patient.getPatientDetails(patientId)
         const htmlTable = `
            <table border="1" style="width:100%; border-collapse:collapse;">
                <tr>
                    <td>Patient Name : ${patientDetails[0].FirstName}</td>
                    <td>Data 1</td>
                </tr>
                <tr>
                    <td>Data 1</td>
                    <td>Data 2</td>
                </tr>
            </table>
            <br/>
            ${getReport[0].Report}
        `;
         const filename = `${patientDetails[0].FirstName}-${patientDetails[0].LastName}.docx`;
         const buffer= await html_to_docx(htmlTable)
         res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
         res.send(buffer);
    }


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
  
          console.log("Discount Report Details:", discountReportDetails);
  
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
      console.log('hi hi ')
      console.log(req)
      let message = await Report.uploadDocument(req);
          notifications.push(createNotification('success',message,'bi-check-circle-fill'))
      let DocumentCategoryDetails= await Category.getDocumentCategoryList();
      console.log(DocumentCategoryDetails);
      let documentDetails= await Report.getDocumentDetails()
      console.log(documentDetails);
      res.render(`displayDocumentDetails`,{documentDetails,notifications,DocumentCategoryDetails,title: ' Document List' ,BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
   } catch (error) {
   // notifications.push(createNotification('danger',error,'bi-excalamation-triangle-fill'))
    return renderHomeWithError(res, error);
   }
}

let displayDocumentDetails= async(req,res)=>{
  let notifications=[]
   try {
      console.log('hi hi ')
      console.log(req)
      //res.send('hi ')
      //let message = await Report.uploadDocument(req);
      let DocumentCategoryDetails= await Category.getDocumentCategoryList();
      console.log(DocumentCategoryDetails)
      let documentDetails= await Report.getDocumentDetails()
      console.log(documentDetails)
      console.log(' i am at bototom')
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




const generateLinkForReportDownload = async (req, res) => {
  let notifications=[]
  try {
    // Extract patientId and testId from request
    const { patientId, testId } = req.query;

    if (!patientId || !testId) {
      throw new Error('Missing patientId or testId')
     // return res.status(400).send(');
    }

    // Generate the WhatsApp link
    const theMessageLink = await Report.generateLink(patientId, testId);

    // Redirect the user to the WhatsApp link
    res.redirect(theMessageLink);
  } catch (error) {
   // console.error(error);
   // notifications.push(createNotification('danger',error,'bi-exclamation-triangle-fill'))
    renderHomeWithError(res,error)
  }
};







 /*const generateLinkForReport= async(req,res)=>{
   try {
      await Report.generateLink(req);
   } catch (error) {
      
   }
   //res.render('kft',{title: 'KFT Report' ,BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})





   
 
 }*/
/*const generateLinkForReportDownload= async(req,res)=>{
   try {
      const theMessageLink= await  Report.generateLink(req,res)
      res.redirect(theMessageLink)
   } catch (error) {
      
   }
 }
const downloadReportAsPdfFromLink = async(req,res)=>{
   try {
      let result= await Report.checkToken(req)
      await serveReportAsPdf(true,result[0].PatientId,result[0].TestId,res)
   } catch (error) {
      //here 
   }
      
}*/



//  /*let getPathologyReportingPage= async(req,res)=>{

//    const patientId= req.params.patientId;
//    console.log(patientId)
//    const patientDetail= await Patient.getPatientDetails(patientId)
//    console.log(patientDetail);
//    const testId=req.params.testId
//    console.log('in sapna')
//        const rows= await Report.getdataForPathologyReport(patientDetail[0].Id,testId,patientDetail[0].Age,patientDetail[0].YMD,patientDetail[0].Gender)
//        const savedData= await Report.getPatientPathoTestData(patientId,testId)
//        const groupedResults = groupResultsByHeader(rows);
//        console.log('out sapna')
//      console.log(groupedResults)
   
//    res.render('createPathoReport',{title: 'Pathology Report',savedData,patientDetail,testId,groupedResults,BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
 
//  }
//  const submitPatientData = async (req, res) => {
//    let patientDetail = null; // Initialize to null for use in the catch block

//    try {
//        const patientId = req.params.patientId;
//        const testId = req.params.testId;

//        // Parse serialized data from the request body
//        const serializedData = JSON.parse(req.body.serializedData);

//        // Insert data into the database
//        const response = await Report.insertPathologicalData(patientId, serializedData, testId);

//        // Fetch patient details
//        patientDetail = await Patient.getPatientDetails(patientId);
//       /* if (!patientDetail || patientDetail.length === 0) {
//            throw new Error("Patient details not found.");
//        }*/

//        // Fetch report data and saved data
//        const rows = await Report.getdataForPathologyReport(
//            patientDetail[0].Id, testId, patientDetail[0].Age, patientDetail[0].YMD, patientDetail[0].Gender
//        );
//        const savedData = await Report.getPatientPathoTestData(patientId, testId);

//        // Group results by headers
//        const groupedResults = groupResultsByHeader(rows);

//        // Render the pathological report
//        res.render('displayPathoReport', {
//            title: 'Pathological Report',
//            savedData,
//            patientDetail,
//            groupedResults,
//            successes: [{ msg: response }],
//            BRAND_NAME: process.env.BRAND_NAME,
//            layout: 'loggedInLayout'
//        });
//    } catch (error) {
//        // Handle errors and render the CBC Report page with error details
//        console.error("Error submitting patient data:", error);

//        res.render('createPathoReport', {
//            title: 'CBC Report',
//            errors: [{ msg: error.message }],
//            savedData: null,
//            patientDetail, // Include patientDetail if it was fetched
//            testId: req.params.testId,
//            groupedResults: null,
//            BRAND_NAME: process.env.BRAND_NAME,
//            layout: 'loggedInLayout'
//        });
//    }
// };

// const viewPathologyReport= async(req,res)=>{
//    try {
//          const patientId = req.params.patientId;
//          const testId = req.params.testId;
//       // Fetch patient details
//       patientDetail = await Patient.getPatientDetails(patientId);
//       // Fetch report data and saved data
//       const rows = await Report.getdataForPathologyReport(
//          patientDetail[0].Id, testId, patientDetail[0].Age, patientDetail[0].YMD, patientDetail[0].Gender
//      );
//      const savedData = await Report.getPatientPathoTestData(patientId, testId);

//      // Group results by headers
//      const groupedResults = groupResultsByHeader(rows);

//        // Render the pathological report
//        res.render('displayPathoReport', {
//          title: 'Pathological Report',
//          savedData,
//          patientDetail,
//          groupedResults,
//          successes: [{ msg: response }],
//          BRAND_NAME: process.env.BRAND_NAME,
//          layout: 'loggedInLayout'
//      });
//    } catch (error) {
//       //redirect to home page
//    }
// }
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

       const serializedData = JSON.parse(req.body.serializedData);
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
       console.error("Error submitting patient data:", error);
       notifications.push(createNotification('danger',error,'bi-exclamation-triangle-fill'))
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
  let notifications=[]
  notifications.push(createNotification('success',options.successes,'bi-check-circle-fill'))
  notifications.push(createNotification('danger',options.errors,'bi-exclamation-triangle-fill'))
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
         if(isPatientWithTestExist)
               next()
         else 
               throw new Error(" There is no patient with this test.Kindly try again.");
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
    const FromDate= req.query?.FromDate ?? moment().format('DD-MM-YYYY')
    const ToDate= req.query?.ToDate ?? moment().format('DD-MM-YYYY')
    if (!moment(FromDate, 'DD-MM-YYYY', true).isSameOrBefore(moment(ToDate, 'DD-MM-YYYY', true))) 
       throw new Error('From Date should be less than or equal to To Date.','bi-exclamation-triangle-fill')
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
    notifications.push(createNotification('danger',error,'bi-exclamation-triangle-fill'))
    renderHomeWithError(res,notifications)
  }

}
const getTestWiseCollection= async(req,res)=>{
  let notifications=[]
  try {
    const CategoryId=req.params.CategoryId;
    let FromDate= req.params?.FromDate || moment().format('DD-MM-YYYY')
    let ToDate=req.params?.ToDate || moment().format('DD-MM-YYYY')
    if (!moment(FromDate, 'DD-MM-YYYY', true).isSameOrBefore(moment(ToDate, 'DD-MM-YYYY', true))) 
      throw new Error('From Date should be less than or equal to To Date.')
    if(!CategoryId)
        throw new Error ('No CategoryId found.')
    const categoryWiseCollections= await Report.getCategoryWisePatient(req)
    const testWiseCollections = await Report.getTestWiseCollection(CategoryId,FromDate,ToDate)
     

    res.render('categoryWiseCollection', {
      title: 'Category wise collection',
      categoryWiseCollections,
      FromDate,
      ToDate,
      testWiseCollections,
      BRAND_NAME: process.env.BRAND_NAME,
      layout: 'loggedInLayout'
  });
  } catch (error) {
    console.log(error)
    notifications.push(createNotification('danger',error,'bi-exclamation-triangle-fill'))
    renderHomeWithError(res,notifications)
  }
}

const getDoctorPatientServiceReportPage= async(req,res)=>{

  try {

    const categories= await Category.getCategoryList();
    const reportData={}
    res.render('doctorServiceReport', {
      title: 'Doctor Patient Refference',
      categories,
      reportData,
      BRAND_NAME: process.env.BRAND_NAME,
      layout: 'loggedInLayout'
  });
  } catch (error) {
    
  }
}

const getDoctorPatientServiceData = async (req, res) => {
  try {
    const { categoryId, startDate, endDate } = req.body;

    const data = await Report.getDoctorPatientServiceReportWithMonthlyBreakdown(categoryId, startDate, endDate);

   // console.log(reportData)
    const categories = await Category.getCategoryList();

   // console.log(reportData);

    res.render('doctorServiceReport', {
      title: 'Doctor Patient Reference',
      categories,
      reportData:data.reportData,
      months:data.months,
      categoryId,     // Pass this to maintain selected state
      startDate,
      endDate,
      BRAND_NAME: process.env.BRAND_NAME,
      layout: 'loggedInLayout'
    });

  } catch (error) {
    console.error("Error generating report:", error);
    res.status(500).send("Internal Server Error");
  }
};



const downloadDoctorPatientServiceRepoertInExcel = async (req, res) => {
  const { startDate, endDate, categoryId } = req.params;

  try {
    // Step 1: Fetch report data
    const {
      months,       // e.g., ['April-24', 'May-24', 'June-24']
      reportData    // e.g., [{ DoctorName, April-24: 3, May-24: 5, ... }]
    } = await Report.getDoctorPatientServiceReportWithMonthlyBreakdown(categoryId, startDate, endDate);

    // Step 2: Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Doctor Patient Report");

    // Step 3: Add header row
    const headerRow = ["#", "Doctor Name", ...months, "Total"];
    worksheet.addRow(headerRow);

    // Step 4: Add data rows
    reportData.forEach((doc, index) => {
      const row = [
        index + 1,
        doc.DoctorName,
        ...months.map(month => doc[month] || 0),
        months.reduce((sum, m) => sum + (doc[m] || 0), 0)
      ];
      worksheet.addRow(row);
    });

    // Step 5: Formatting
    worksheet.columns.forEach(col => {
      col.width = 15;
    });

    worksheet.getRow(1).font = { bold: true };

    // Step 6: Send file
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=DoctorPatientReport.xlsx");

    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    console.error("Excel Export Error:", error);
    res.status(500).send("Failed to generate Excel");
  }
};

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
   viewCollection: viewCollection,
    createReport:createReport,
    saveReport:saveReport,
    downloadReportAsPdf:downloadReportAsPdf,
    downloadReportAsDoc:downloadReportAsDoc,
    getDiscountReport:getDiscountReport,
    getDocumentUploadForm:getDocumentUploadForm,
    uploadDocument:uploadDocument,
    displayDocumentDetails:displayDocumentDetails,
    deleteDocument:deleteDocument,
    getPathologyReportingPage:getPathologyReportingPage,
   // generateLinkForReport:generateLinkForReport,
    generateLinkForReportDownload:generateLinkForReportDownload,
    downloadReportAsPdfFromLink:downloadReportAsPdfFromLink,
    submitPatientData:submitPatientData,
    viewPathologyReport:viewPathologyReport,
    isPatientWithTestExist:isPatientWithTestExist,
    downloadPathologyReportAsPdf:downloadPathologyReportAsPdf,
   // patientHistory:patientHistory,
    searchDocument:searchDocument,
    getCategoryWiseCollectionPage:getCategoryWiseCollectionPage,
    getTestWiseCollection:getTestWiseCollection,
    getDoctorPatientServiceReportPage:getDoctorPatientServiceReportPage,
    getDoctorPatientServiceData:getDoctorPatientServiceData,
    downloadDoctorPatientServiceRepoertInExcel:downloadDoctorPatientServiceRepoertInExcel
  };
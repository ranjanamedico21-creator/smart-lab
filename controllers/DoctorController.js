//const { promiseImpl } = require("ejs");
const Doctor = require("../models/Doctor");
const User = require("../models/User");
const Test = require("../models/Test");
//const convertPdf= require('../views/partials/htmlToPdf');
let ejs = require('ejs');
const puppeteer =require("puppeteer");
const path = require('path');
const moment = require('moment'); // Ensure moment is imported
//const { thanks } = require("./PatientController");
require("dotenv").config();

const getDoctorRegistrationPage = async(req,res)=>{

  try {
    let testCategoriesList= await Test.getTestCategories()
        if(!testCategoriesList.length > 0)
            throw new Error('Categories are missing.First create the category,then add the test.')
         res.render("registerDoctor",{title:'Register Doctor',testCategoriesList,BRAND_NAME:process.env.BRAND_NAME,layout:'loggedInLayout'});
       //
  } catch (error) {
   // res.render('home',{title:'Home',error,BRAND_NAME:process.env.BRAND_NAME,layout:'loggedInLayout'})
   return renderHomeWithError(res, error, 'Some Error Occurred. Please retry to register the patient.');
  }
}

const registerDoctor = async (req, res) => {
  let notifications=[]
  try {
      // Validate input
      let error = Doctor.validateUserInput(req);
      let testCategoriesList = await Test.getTestCategories();

      // If validation errors exist, render the form again
      if (error.length > 0) {
        notifications.push(createNotification('danger',error,'bi-exclamation-triangle-fill'))
          return res.render('registerDoctor', {
              notifications,
              title: 'Register Doctor',
              testCategoriesList,
              BRAND_NAME: process.env.BRAND_NAME,
              layout: 'loggedInLayout',
          });
      }

      // Register the doctor
      let result = await Doctor.registerDoctor(req);
     notifications.push(createNotification('success',result,'bi-check-circle-fill'))

      // Fetch doctor list to display
      let doctorDetails = await Doctor.getDoctorList();
      let numPerPage = parseInt(process.env.PAGINATION_LIMIT, 10) || 10; // Fallback to 10 if limit is undefined
      let totalCount = doctorDetails.length;

      // Render doctor list view
      return res.render('getDoctorListView', {
          notifications,
          doctorDetails,
          numPerPage,
          totalCount,
          title: 'Doctor List',
          BRAND_NAME: process.env.BRAND_NAME,
          layout: 'loggedInLayout',
      });
  } catch (error) {
      // Log the error for debugging purposes
      console.error('Error in registerDoctor:', error);
      notifications.push(createNotification('danger',error,'bi-exclamation-triangle-fill'))

      // Render appropriate error response
      return res.render('home', {
          notifications,
          title: 'Error',
          BRAND_NAME: process.env.BRAND_NAME,
          layout: 'loggedInLayout',
      });
  }
};

const getEditDoctorPage = async (req, res) => {
  let notifications = [];
  try {
    const doctorId = req.params?.doctorId;
    if (!doctorId) throw new Error('No doctor ID found in request.');

    // Fetch all data concurrently for better performance
    const [
      doctorDetails,
      doctorsCategoryWiseThanks,
      doctorVisitingSchedules,
      testCategoriesList
    ] = await Promise.all([
      Doctor.getDoctorDetail(doctorId),
      Doctor.getDoctorsCategoryWiseThanks(doctorId),
      Doctor.getDoctorVisitingSchedule(doctorId),
      Test.getTestCategories()
    ]);

    // Validate fetched data before rendering
    if (!doctorDetails) throw new Error('Doctor details not found.');
    if (!testCategoriesList.length) throw new Error('Test categories not available.');

    // Debugging logs for better visibility
    console.log(`\n[INFO] Editing Doctor ID: ${doctorId}`);
    console.table(doctorDetails);
    console.log(`[INFO] Visiting Schedules: ${doctorVisitingSchedules.length}`);
    console.log(`[INFO] Category-wise Commission: ${doctorsCategoryWiseThanks.length}`);

    // Render edit doctor page with fetched data
    res.render('editDoctor', {
      doctorDetails,
      doctorVisitingSchedules,
      doctorsCategoryWiseThanks,
      testCategoriesList,
      title: 'Edit Doctor',
      BRAND_NAME: process.env.BRAND_NAME,
      layout: 'loggedInLayout'
    });

  } catch (error) {
    console.error(`[ERROR] getEditDoctorPage: ${error.message}`);
    notifications.push(createNotification('danger', error.message, 'bi-exclamation-triangle-fill'));
    res.render('home', {
      notifications,
      title: 'Home',
      BRAND_NAME: process.env.BRAND_NAME,
      layout: 'loggedInLayout'
    });
  }
};



const updateDoctor= async(req,res)=>{
  let notifications=[]
  try {
    let error = Doctor.validateUserInput(req);
    const doctorId= req.params.doctorId;
     // let testCategoriesList = await Test.getTestCategories();

      // If validation errors exist, render the form again
      if (error.length > 0) {
        notifications.push(createNotification('danger',error,'bi-exclamation-triangle-fill'))
        // Fetch all data concurrently for better performance
        const [
          doctorDetails,
          doctorsCategoryWiseThanks,
          doctorVisitingSchedules,
          testCategoriesList
        ] = await Promise.all([
          Doctor.getDoctorDetail(doctorId),
          Doctor.getDoctorsCategoryWiseThanks(doctorId),
          Doctor.getDoctorVisitingSchedule(doctorId),
          Test.getTestCategories()
        ]);
          return res.render('editDoctor', {
              notifications,
              doctorDetails,
              doctorsCategoryWiseThanks,
              doctorVisitingSchedules,
              title: 'Edit Doctor',
              testCategoriesList,
              BRAND_NAME: process.env.BRAND_NAME,
              layout: 'loggedInLayout',
          });
      }

      // Register the doctor
      const result = await Doctor.updateDoctor(req);
      console.log(result)
      notifications.push(createNotification('success',result,'bi-check-circle-fill'))

      // Fetch doctor list to display
      let doctorDetails = await Doctor.getDoctorList();
      let numPerPage = parseInt(process.env.PAGINATION_LIMIT, 10) || 10; // Fallback to 10 if limit is undefined
      let totalCount = doctorDetails.length;

      // Render doctor list view
      return res.render('getDoctorListView', {
          notifications,
          doctorDetails,
          numPerPage,
          totalCount,
          title: 'Doctor List',
          BRAND_NAME: process.env.BRAND_NAME,
          layout: 'loggedInLayout',
      });
  } catch (error) {
    console.log(error)
   // notifications.push(createNotification('danger',error,'bi-exclamation-triangle-fill'))
    renderHomeWithError(res,error)
  }
}
//check it from where it is getting called
let searchDoctor = async (req,res)=>{
    try {
        let doctorDetails = await  Doctor.getDoctorList(req)
        res.send(doctorDetails);
    } catch (error) {
        
    }
   
}

//get doctor list
let getDoctorListView=async (req,res)=>{
    try {
        let doctorDetails = await Doctor.getDoctorList();
            let numPerPage = process.env.PAGINATION_LIMIT;
            let totalCount=doctorDetails.length;
        res.render('getDoctorListView',{title:'Doctor List',doctorDetails,numPerPage,totalCount,title:'Doctor List',BRAND_NAME:process.env.BRAND_NAME,layout:'loggedInLayout'})
    } catch (error) {
        res.render('home',{error,title:'Home',BRAND_NAME:process.env.BRAND_NAME,layout:'loggedInLayout'})
    }
}

let getDoctorDetailView = async(req,res)=>{
  let notifications=[]
    try {
      /*  let doctorDetails = await Doctor.getDoctorDetail(req.query.doctorId)
        let categoryCommissionDetail= await Doctor.getCategoryWiseCommission(req.query.doctorId)
        let testWiseCommissionDetails = await Doctor.getTestWiseCommissionDetails(req.query.doctorId)*/

        const refferingDoctorId= req.query.doctorId;
        const thanksData= await fetchThanksData(refferingDoctorId)
        const reportingDoctors= await Doctor.getReportingDoctorList()
        const reportingDoctorId= await Doctor.getPreselectedReportingDoctor(refferingDoctorId)
        const marketingPersonId= await Doctor.getPreselectedMarketingPerson(refferingDoctorId)
       // const marketingPersonId= await Doctor.getPreAssignedMarketingPerson(refferingDoctorId);
        const marketingPersons= await User.getMarketingPersonList()
        console.log(reportingDoctorId);
        console.log('**********i am here *************')
        console.log(thanksData)
        const visitingSchedule= await Doctor.getVisitingSchedule(refferingDoctorId)
        res.render('getDoctorDetails',{...thanksData,marketingPersonId,marketingPersons,reportingDoctorId,reportingDoctors,visitingSchedule,title:'Doctor Details',BRAND_NAME:process.env.BRAND_NAME,layout:'loggedInLayout'})
    } catch (error) {
        let errors=[]
        notifications.push(createNotification('danger',error,'bi-exclamation-triangle-fill'))
           // errors.push({msg:error})
            res.render('home',{title:'Home',notifications,BRAND_NAME:process.env.BRAND_NAME,layout:'loggedInLayout'})
    }
}
let updateDoctorThanks = async(req,res)=>{
  let notifications=[]
    try {
       // let doctorDetails = await Doctor.getDoctorDetail(req.query.doctorId)
       // let categoryCommissionDetail= await Doctor.getCategoryWiseCommission(req.query.doctorId)
       // let testWiseCommissionDetails = await Doctor.getTestWiseCommissionDetails(req.query.doctorId)
       // let testDetails=[]
        const thanksData= await fetchThanksData(req.query.doctorId)
        res.render('updateThanks',{...thanksData,title:'update Doctor thanks',BRAND_NAME:process.env.BRAND_NAME,layout:'loggedInLayout'})

    } catch (error) {
        //let errors=[]
            //errors.push({msg:error})
            notifications.push(createNotification('danger',error,'bi-exclamation-triangle-fill'))
            res.render('home',{title:'Home',notifications,BRAND_NAME:process.env.BRAND_NAME,layout:'loggedInLayout'})
    }
}
let updateThanks= async(req,res)=>{
  let notifications=[]
    try {
            let message= await  Doctor.updateThanks(req)
            //let successes=[]
            //let testDetails=[]
            const thanksData= await fetchThanksData(req.body.doctorId)
                notifications.push(createNotification('success',message,'bi-check-circle-fill'))
                res.render('updateThanks',{notifications,...thanksData,title:'update Doctor thanks',BRAND_NAME:process.env.BRAND_NAME,layout:'loggedInLayout'})

    } catch (error) {
        //let errors=[]
        notifications.push(createNotification('danger',error,'bi-exclamation-triangle-fill'))
        res.render('home',{title:'Home',notifications,BRAND_NAME:process.env.BRAND_NAME,layout:'loggedInLayout'})
}
}

const fetchThanksData = async (doctorId) => {
        const [doctorDetails,categoryCommissionDetail,testWiseCommissionDetails]=await Promise.all([
                Doctor.getDoctorDetail(doctorId),
                Doctor.getCategoryWiseCommission(doctorId),
                Doctor.getTestWiseCommissionDetails(doctorId)
            ])
    return {
            doctorDetails,
            categoryCommissionDetail,
            testWiseCommissionDetails

    };
};
const updateTestWiseThanksForADoctor =async(req,res)=>{
  let notifications=[]

    try {
        let message = await Doctor.updateDoctorsThankTestWise(req);
       // let successes=[];
          //  successes.push({msg:message})
            notifications.push(createNotification('success',message,'bi-check-circle-fill'))
        let testDetails= await Test.searchTestForUpdatingThanks(req)
        const thanksData = await fetchThanksData(req.body.doctorId)
       // let doctorDetails = await Doctor.getDoctorDetail(req.body.doctorId)
        let categoryId= req.body.SelectDoctorThanksCategorySearch
        let searchedTest= req.body.searchTest
         res.render('updateThanks',{successes,categoryId,searchedTest,testDetails,...thanksData,title:'update Doctor thanks',BRAND_NAME:process.env.BRAND_NAME,layout:'loggedInLayout'})

    } catch (error) {
       
        notifications.push(createNotification('danger',error,'bi-exclamation-triangle-fill'))
        res.render('home',{title:'Home',notifications,BRAND_NAME:process.env.BRAND_NAME,layout:'loggedInLayout'})

    }
}

const getDoctorWiseThanks= async(req,res)=>{
  let notifications=[]
    try {
        const doctorDetails= await Doctor.getDoctorList()
       // console.log(doctorDetails)
//This is get method after clicking on Thanks detail link here from date and to date will todays date
      let FromDate=moment().format('YYYY-MM-DD')
      let ToDate=moment().format('YYYY-MM-DD')

        const doctorThanksData = await Doctor.getDoctorWiseThanks(FromDate,ToDate)
      //make sure to change dte as DD-MM-YYYY
       FromDate=moment().format('DD-MM-YYYY')
       ToDate=moment().format('DD-MM-YYYY')
      //  console.log(doctorThanksData)
        res.render('displayDoctorThanks',{FromDate,ToDate,doctorDetails,doctorThanksData,title:'Doctor thanks list',BRAND_NAME:process.env.BRAND_NAME,layout:'loggedInLayout'})

    } catch (error) {
      
        notifications.push(createNotification('danger',error,'bi-exclamation-triangle-fill'))
        res.render('home',{title:'Home',notifications,BRAND_NAME:process.env.BRAND_NAME,layout:'loggedInLayout'})
        }

}



/**
 * 
 * @param {*} req 
 * @param {*} res 
 * 
 * This function is used for generating invoices or biil
 * it is called from patient list view page
 */
const downloadIndividualDoctorThanks = async (req, res) => {
    try {
      // Fetch doctor thanks data
      const doctorThanksData = await Doctor.getIndividualDoctorThanks(req);
      let totalGrossFee = 0;
      let totalThanks = 0;
      let totalDues=0;
      let totalDiscount=0;
  
      // Calculate totals
      doctorThanksData.forEach((row) => {
        totalGrossFee += Number(row.GrossAmount || 0); // Ensure we don't sum undefined values
        totalThanks += Number(row.TotalThanks || 0); // Ensure we don't sum undefined values
        totalDues += Number(row.Dues || 0); // Ensure we don't sum undefined values
        totalDiscount += Number(row.Discount || 0); // Ensure we don't sum undefined values
      });
  
      // Log the fetched data
      console.log('Doctor Thanks Data:', doctorThanksData);
      console.log('Total Gross Fee:', totalGrossFee);
      console.log('Total Thanks:', totalThanks);
  
      // Render the EJS template
      const templatePath = path.join(__dirname, '../views/partials/thanksReport.ejs');
    // console.log('EJS Template Path:', templatePath);
  
      // Use await to ensure the template is rendered with the provided data
      const html = await ejs.renderFile(templatePath, {
        patients: doctorThanksData,
        totalGrossFee: totalGrossFee,
        totalThanks: totalThanks,
        totalDues:totalDues,
        totalDiscount:totalDiscount
      });
  
      console.log('Rendered HTML:', html); // Log the rendered HTML
  
      // Launch Puppeteer to create the PDF
      const browser = await puppeteer.launch();
      const page = await browser.newPage();
  
      // Set the content of the page to the rendered HTML
      await page.setContent(html, {
        waitUntil: 'domcontentloaded',
      });
  
      // Generate the PDF from the page content
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
      });
  
      // Close the Puppeteer browser
      await browser.close();
  
      // Set response headers for downloading the PDF
      res.setHeader('Content-Disposition', 'attachment; filename= Dr. ' + doctorThanksData[0].DoctorFirstName + ' ' +doctorThanksData[0].DoctorLastName + '.pdf');
      res.setHeader('Content-Type', 'application/pdf');
  
      // Send the PDF as a response
      res.send(pdfBuffer);
    } catch (error) {
      console.error('Error generating the PDF:', error);
      res.status(500).send('An error occurred while generating the PDF');
    }
  };

  /*const getDoctorThanks= async(req,res)=>{
    try {
        
        const doctorDetails= await Doctor.getDoctorList()
        const FromDate=req.body.FromDate
        const ToDate= req.body.ToDate

        const {results:doctorThanksData,doctorId}= await Doctor.getDoctorWiseThanks(req)
        res.render('displayDoctorThanks',{doctorDetails,doctorId,FromDate,ToDate,doctorThanksData,title:'Doctor thanks list',BRAND_NAME:process.env.BRAND_NAME,layout:'loggedInLayout'})

    } catch (error) {
        
       // let errors=[]
        notifications.push(createNotification('danger',error,'bi-exclamation-triangle-fill'))
        res.render('home',{title:'Home',notifications,BRAND_NAME:process.env.BRAND_NAME,layout:'loggedInLayout'})
        }

  }*/
       

const getDoctorThanks = async (req, res) => {
  try {

    console.log(req);
      const defaultDate = moment().format('YYYY-MM-DD'); // Current date in YYYY-MM-DD

      // Extract and format FromDate & ToDate
      let FromDate = req?.body?.FromDate ? moment(req.body.FromDate, 'DD-MM-YYYY').format('YYYY-MM-DD') : defaultDate;
      let ToDate = req?.body?.ToDate ? moment(req.body.ToDate, 'DD-MM-YYYY').format('YYYY-MM-DD') : defaultDate;

      let doctorId = req?.body?.Doctor;

      // Ensure FromDate is not after ToDate
      if (moment(FromDate).isAfter(moment(ToDate))) {
          throw new Error('Start Date cannot be after End Date.');
      }

      // Fetch doctor list & thanks data
      const doctorDetails = await Doctor.getDoctorList();
      const doctorThanksData = await Doctor.getDoctorWiseThanks(FromDate, ToDate, doctorId);

      // Convert dates back to DD-MM-YYYY for UI display
      FromDate = moment(FromDate, 'YYYY-MM-DD').format('DD-MM-YYYY');
      ToDate = moment(ToDate, 'YYYY-MM-DD').format('DD-MM-YYYY');

      res.render('displayDoctorThanks', {
          doctorDetails,
          doctorId,
          FromDate,
          ToDate,
          doctorThanksData,
          title: 'Doctor thanks list',
          BRAND_NAME: process.env.BRAND_NAME,
          layout: 'loggedInLayout'
      });

  } catch (error) {
      const notifications = [
          createNotification('danger', error.message || 'An error occurred', 'bi-exclamation-triangle-fill')
      ];

      res.render('home', {
          title: 'Home',
          notifications,
          BRAND_NAME: process.env.BRAND_NAME,
          layout: 'loggedInLayout'
      });
  }
};
      

        
  const downloadAllDoctorThanks= async(req,res)=>{
    try {
        const DoctorsWithThanksList = await Doctor.downloadAllDoctorThanks(req)
  //console.log(DoctorsWithThanksList)
  // Group data by doctor
  const groupedData = DoctorsWithThanksList.reduce((acc, row) => {
    // Check if the doctor already exists in the accumulator
    if (!acc[row.doctorId]) {
      // If not, initialize the doctor entry with the first name, last name, degrees, and an empty patients array
      acc[row.doctorId] = {
        DoctorFirstName: row.DoctorFirstName,
        DoctorLastName: row.DoctorLastName,
        Degree1: row.Degree1,
        Degree2: row.Degree2,
        Degree3: row.Degree3,
        Degree4: row.Degree4,
        SpecialistIn: row.SpecialistIn,
        patients: []  // Array to store patients for this doctor
      };
    }
  
    // Add the patient data for this doctor
    acc[row.doctorId].patients.push({
      PatientName: row.Name,
      Tests: row.TestNames,
      Subtest: row.SubTestNames,
      Thanks: row.Thanks,
      GrossAmount: row.GrossAmount,
      Discount: row.Discount,
      DuesAmount: row.Dues,
      Age:row.Age,
      YMD:row.YMD,
      Gender:row.gender,
      RegisteredOn:row.RegisteredOn
    });
  
    return acc;
  }, {});
  
 // Calculate totals


// Loop through each doctor in groupedData
for (const doctorId in groupedData) {
  const doctor = groupedData[doctorId];
  // Initialize totals
    let totalGrossFee = 0;
    let totalThanks = 0;
    let totalDues = 0;
    let totalDiscount = 0;
  // Loop through each patient for the current doctor
  doctor.patients.forEach(patient => {
    // Accumulate the values for each patient
    totalGrossFee += Number(patient.GrossAmount || 0);   // Summing gross amount
    totalThanks += Number(patient.Thanks || 0);          // Summing thanks amount
    totalDues += Number(patient.Dues || 0);              // Summing dues
    totalDiscount += Number(patient.Discount || 0);      // Summing discount
  });
  doctor.TotalGrossFee=totalGrossFee,
  doctor.TotalThanks=totalThanks,
  doctor.TotalDues=totalDues,
  doctor.TotalDiscount=totalDiscount
  
  // Debug log to see the sums for each doctor
  console.log(`Doctor: ${doctor.DoctorFirstName} ${doctor.DoctorLastName}`);
  console.log(`Total Gross Fee: ${totalGrossFee}`);
  console.log(`Total Thanks: ${totalThanks}`);
  console.log(`Total Dues: ${totalDues}`);
  console.log(`Total Discount: ${totalDiscount}`);
}

  
      // Render the EJS template
      const templatePath = path.join(__dirname, '../views/partials/downloadAllDoctorThanks.ejs');
    // console.log('EJS Template Path:', templatePath);
  
      // Use await to ensure the template is rendered with the provided data
      const html = await ejs.renderFile(templatePath, {
        doctors: groupedData
      });
  
      //console.log('Rendered HTML:', html); // Log the rendered HTML
  
      // Launch Puppeteer to create the PDF
      const browser = await puppeteer.launch();
      const page = await browser.newPage();
  
      // Set the content of the page to the rendered HTML
      await page.setContent(html, {
        waitUntil: 'domcontentloaded',
      });
  
      // Generate the PDF from the page content
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
      
        displayHeaderFooter: true, // Enable header and footer
        footerTemplate: `
          <div style="font-size: 10px; width: 100%; text-align: center; color: #555;">
            Page <span class="pageNumber"></span> of <span class="totalPages"></span>
          </div>
        `,
        headerTemplate: "<div></div>", // Empty header
        margin: {
         
          bottom: "10mm", // Make room for the footer
        }
      });
  
      // Close the Puppeteer browser
      await browser.close();
  
      // Set response headers for downloading the PDF
      res.setHeader('Content-Disposition', 'attachment; filename= AllDoctorsThanks.pdf');
      res.setHeader('Content-Type', 'application/pdf');
  
      // Send the PDF as a response
      res.send(pdfBuffer);
    } catch (error) {
      console.error('Error generating the PDF:', error);
      res.status(500).send('An error occurred while generating the PDF');
    }
  };

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

  const updateReportingDoctor = async (req, res) => {
    let notifications = [];
  
    try {
      const refferingDoctorId = req.params.reffereingDoctorId; // ✅ Check: typo in `reffereing`
      const reportingDoctorId = req.body.reportingDoctor;
      const marketingPersonId = req.body.marketingPerson;
  
      const marketingPersons = await User.getMarketingPersonList();
  
      // ✅ Validation
      if (Number(reportingDoctorId) > 0 && Number(refferingDoctorId) > 0) {
        await Doctor.setReportingDoctor(refferingDoctorId, reportingDoctorId);
        notifications.push(createNotification('success', 'Reporting doctor updated successfully.', 'bi-check-circle-fill'));
      } else {
        notifications.push(createNotification('danger', 'No Reporting Doctor Selected.', 'bi-exclamation-triangle-fill'));
      }
  
      // Fetch doctor details
      const thanksData = await fetchThanksData(refferingDoctorId);
      const reportingDoctors = await Doctor.getReportingDoctorList();
      const visitingSchedule = await Doctor.getVisitingSchedule(refferingDoctorId);
  
      res.render('getDoctorDetails', {
        ...thanksData,
        marketingPersonId,
        notifications,
        marketingPersons,
        reportingDoctorId,
        reportingDoctors,
        visitingSchedule,
        title: 'Doctor Details',
        BRAND_NAME: process.env.BRAND_NAME,
        layout: 'loggedInLayout'
      });
  
    } catch (error) {
      console.error('Error updating reporting doctor:', error);
      notifications.push(createNotification('danger', 'Something went wrong. Please try again.', 'bi-exclamation-triangle-fill'));
  
      res.render('home', {
        title: 'Home',
        notifications,
        BRAND_NAME: process.env.BRAND_NAME,
        layout: 'loggedInLayout'
      });
    }
  };
  

const updateMarketingPerson = async (req, res) => {
  let notifications=[]
  try {
    const marketingPersonId = req.body.marketingPerson;
    const reportingDoctorId = req.body.reportingDoctor|| '';
    const refferingDoctorId = req.params.refferingDoctorId; // ❗ Fixed typo: req.paramas ➜ req.params

    
     // ✅ Validation
     if (Number(marketingPersonId) > 0 && Number(refferingDoctorId) > 0) {
      // Update doctor with new marketing person
      const result = await Doctor.updateMarketingPerson(marketingPersonId, refferingDoctorId);
      notifications.push(createNotification('success', 'Marketing person updated successfully.', 'bi-check-circle-fill'));
    } else {
      notifications.push(createNotification('danger', 'No Marketing person Selected.', 'bi-exclamation-triangle-fill'));
    }

    // Fetch required data
    const marketingPersons = await User.getMarketingPersonList();
    const thanksData = await fetchThanksData(refferingDoctorId);
    const reportingDoctors = await Doctor.getReportingDoctorList();
    const visitingSchedule = await Doctor.getVisitingSchedule(refferingDoctorId);

    // Render doctor detail page
    res.render('getDoctorDetails', {
      ...thanksData,
      reportingDoctorId,
      marketingPersons,
      marketingPersonId,
      reportingDoctors,
      notifications,
      visitingSchedule,
      title: 'Doctor Details',
      BRAND_NAME: process.env.BRAND_NAME,
      layout: 'loggedInLayout'
    });

  } catch (error) {
    console.error('Error updating marketing person for doctor:', error);
   // res.status(500).send('Something went wrong while updating the doctor.');
   notifications.push(createNotification('danger',error,'bi-exclamation-triangle-fill'))
   // errors.push({msg:error})
   res.render('home', {
    title: 'Home',
    notifications,
    BRAND_NAME: process.env.BRAND_NAME,
    layout: 'loggedInLayout'
  });

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
module.exports ={
    getDoctorRegistrationPage:getDoctorRegistrationPage,
    registerDoctor:registerDoctor,
    searchDoctor:searchDoctor,
    getDoctorListView:getDoctorListView,
    getDoctorDetailView:getDoctorDetailView,
    updateDoctorThanks:updateDoctorThanks,
    updateThanks:updateThanks,
    updateTestWiseThanksForADoctor:updateTestWiseThanksForADoctor,
    getDoctorWiseThanks:getDoctorWiseThanks,
    downloadIndividualDoctorThanks:downloadIndividualDoctorThanks,
    getDoctorThanks:getDoctorThanks,
    downloadAllDoctorThanks:downloadAllDoctorThanks,
    getEditDoctorPage:getEditDoctorPage,
    updateDoctor:updateDoctor,
    updateReportingDoctor:updateReportingDoctor,
    updateMarketingPerson:updateMarketingPerson
}
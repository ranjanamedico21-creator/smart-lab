const Clinic = require("../models/Clinic");
const Category = require("../models/Category");
const Doctor= require("../models/Doctor");
const Test= require("../models/Test");
const Patient= require("../models/Patient");
const convertPdf= require('../views/partials/htmlToPdf');
let ejs = require('ejs');
const path= require('path')
const moment = require('moment');
require("dotenv").config();

/**
 * 
 * @param {*} req 
 * @param {*} res 
 */
let getPatientRegistrationPage =( async(req,res)=>{
    try {
console.log(req.path)
        let [clinics, categories, testDetails, subTestDetails] = await Promise.all([
            Clinic.getClinicList(),
            Category.getCategoryList(),
            Test.getTestDetails(),
            Test.getSubTestDetails()
        ]);
          // Check if any required list is empty
          let errors= await checkRequiredData(clinics,categories,testDetails)
          console.log(errors)
            if(errors.length>0)
                return renderHomeWithError(res,errors);
        
        let patientDetails= {};//A dummy variable which is required after client side validation of patient registration user input.
        let doctorId='';//A dummy variable which is required after client side validation of patient registration user input.
        let doctors=[{}];//A dummy variable which is required after client side validation of patient registration user input.
        res.render('patientRegistration',{subTestDetails,clinics,categories,doctorId,doctors,testDetails,patientDetails,title:'Patient Registration',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
    } catch (error) {
        console.log(error)
        return renderHomeWithError(res,error, 'Some Error Occurred. Please retry to edit the patient.');
    }

});
/**
 * 
 * @param {*} clinics 
 * @param {*} categories 
 * @param {*} testDetails 
 * @returns 
 * This is validation table used for validate use input and basic requirement to start the 
 * code setup
 */
const checkRequiredData= async(clinics,categories,testDetails)=>{
    let errors=[]

    try {
        if(!clinics.length)
            errors.push({message:'Required Data. Clinic has not been created.First register clinic.Then create doctors.'})
        if(!categories.length)
            errors.push({message:'Required Data. Test category has not been created.First register category.Then create test.'})
        if(!testDetails.length)
            errors.push({message:'Required Data. Test  has not been created.First create a test.'})
            return errors;

    } catch (error) {
        
        throw error
    }
}

/**
 * 
 * @param {*} req 
 * @param {*} res 
 * Use to register Patient in database
 */

const registerPatientDetails = async (req, res) => {
    const notifications = [];
    if (req.validationErrors) {
        notifications.push(createNotification('danger',req.validationErrors, 'bi-exclamation-triangle-fill'))
    }
    //const validationErrors = res.validationErrors || [];
    const { clinic, doctor, selectedTestDetails,selectedSubTestDetails, ...patientDetails } = req.body;
    if (notifications.length > 0) {
      // If there are validation errors, render the form with error messages
      return handleValidationErrors(req, res, notifications, clinic, patientDetails,selectedSubTestDetails, selectedTestDetails, doctor);
    }
  
    try {
      // Register patient details and fetch updated lists
      const message = await Patient.registerPatientDetails(req);
     // successes.push({ message });
      notifications.push(createNotification('success',message, 'bi-check-circle-fill'))
      
      const [patientDetailsList, doctorDetails,categories] = await Promise.all([
        Patient.getPatientListWithDoctorDetail(req),
        Doctor.getDoctorList(),
        Category.getCategoryList()
      ]);
  
      // Render the patient list view
      res.render('getPatientListView', {
        patientDetails: patientDetailsList,
        doctorDetails,
        notifications,
        categories,
        title: 'Patient List',
        BRAND_NAME: process.env.BRAND_NAME,
        layout: 'loggedInLayout'
      });
    } catch (error) {
        console.log(error)
      // Handle errors and render the home page with error messages
      renderHomeWithError(res, error);
    }
  };
  
  /**
 * 
 * @param {*} req 
 * @param {*} res 
 * 
 * This patient is called from patient list view page when you click on edit button
 */
const editPatientDetails = async (req, res) => {
    try {
        const patientId = req.query.id;
        if(!patientId)
            throw new Error('Patient Id doesnt exist.')
        let patientDetails = await Patient.getPatientDetails(patientId);
            if(patientDetails.length==0)
                throw new Error(`Sorry patient with Id ${patientId} does not exist.`)
            patientDetails = patientDetails[0]; //  first result is the one we want
        // If the patient is active (status = 1), proceed with fetching the required data
        if (patientDetails.Status === 1) {
            console.log(' in patient edit place')
             return renderEditPatientView(res,patientDetails);
        }
        // If the patient is already cancelled, return an error
        return renderPatientListView(req,res,false,'Patient is already cancelled, so you cannot edit this patient.');
        
    } catch (error) {
       // console.error(error);
        return renderPatientListView(req,res,false,'An error occurred while fetching patient details.Kindly try Again.');
    }
};
/**
 * 
 * @param {*} res 
 * @param {*} patientDetails 
 * @param {*} notifications 
 * @param {*} customError 
 */
const renderEditPatientView = async (res,patientDetails,notifications=[],customError='')=>{

    const { ClinicId: clinicId,Id:patientId } = patientDetails; // Extract clinicId from patientDetails
   // const { Id: patientId } = patientDetails;
    const patientData = await fetchPatientDataForEdit(clinicId, patientId);
       // notifications.push(createNotification('danger',customError,'bi-exclamation-traingle-fill'))
    // Render the edit page with all the fetched data
     res.render('editPatientDetail', {
        ...patientData,
        patientDetails,
        patientId,
        title: 'Update Patient Details',
        notifications,
        BRAND_NAME: process.env.BRAND_NAME,
        layout: 'loggedInLayout'
    });

}
// Utility function to fetch data required for rendering patient-related views
const fetchPatientDataForEdit = async (clinicId, patientId) => {
    const [clinics, categories, doctors, testDetails, patientTestDetails, subTestDetails,patientSubTestDetails] = await Promise.all([
        Clinic.getClinicList(),
        Category.getCategoryList(),
        Doctor.getAttachedDoctorList(clinicId),
        Test.getTestDetails(),
        Test.getPatientTestDetails(patientId),
        Test.getSubTestDetails(),
        Test.getPatientSubTestDetail(patientId)
    ]);
    return {
        clinics,
        categories,
        doctors,
        testDetails,
        subTestDetails,
        patientTestDetails: JSON.stringify(patientTestDetails),
        patientSubTestDetails:JSON.stringify(patientSubTestDetails)

    };
};


// Utility function to render the patient list view with or without  an error
const renderPatientListView = async (req,res,isItSuccess,customMessage='',error='') => {

    console.log(isItSuccess)
    let notifications = [];
       // errors.push({ msg: error })
        notifications.push(createNotification('danger',error,'bi-exclamation-triangle-fill'))
    if (customMessage) {
            if(isItSuccess)
                notifications.push(createNotification('success',customMessage,'bi-check-circle-fill'))
            else
                notifications.push(createNotification('danger',customMessage,'bi-exclamation-triangle-fill'))
      }

      console.log(notifications)

      //console.log('*************')
      //console.log(errors)
    const [patientDetails, doctorDetails,categories] = await Promise.all([Patient.getPatientListWithDoctorDetail(req), Doctor.getDoctorList(),Category.getCategoryList()]);
    console.log('alert')
    return res.render('getPatientListView', {
        patientDetails,
        doctorDetails,
        notifications,
        categories,
        title: 'Patient List',
        BRAND_NAME: process.env.BRAND_NAME,
        layout: 'loggedInLayout'
    });
};


let updatePatientDetails =async (req,res)=>{
    let notifications=[]
    const validationErrors = req.validationErrors || []
    const patientId=req.query.id;

    if( validationErrors.length >0){
        try {
            
          notifications.push(createNotification('danger',validationErrors,'bi-exclamation-triangle-fill'))
            let patientDetails= await Patient.getPatientDetails(patientId);
                patientDetails= patientDetails[0];
               return  renderEditPatientView(res,patientDetails,notifications)
           
            } catch (error) {
                return renderHomeWithError(res, error, 'Some Error o909090ccurred. Please retry to edit the patient.');
        }
       
    }
    else
    {
        try {
            let patientDetails= await Patient.getPatientDetails(patientId);
            console.log(patientDetails)
                if(patientDetails[0].length==0)
                        throw new Error(`Patient with Id ${patientId} not found.`)
                if(Number(patientDetails[0].Status)!==1)
                        throw new Error(`Patient with Id ${patientId} is already cancelled.`)
            await Patient.logPatientChanges(req)
            let message= await Patient.updatePatientDetails(req);
            //true is used for success message
            // return renderPatientListView(res,true,message);
               // req.flash('message',message);//setting this message and retrieveing in getPatientDetail function
               req.query.message=message;
               req.query.patientId=patientId
              // res.redirect(`/patient/getPatientDetail/?patientId=${patientId}`)
              return getPatientDetail(req, res);
    
        } catch (error) {
            // false is used for displaying  error or danger  message css on front end error message
                    console.log(error)
                    return renderPatientListView(req,res,false,'',error);
        }
    }
}

  // Function to handle validation errors and render the registration form
 // return handleValidationErrors(req, res, validationErrors, clinic, patientDetails,selectedSubTestDetails, selectedTestDetails, doctor);
  const handleValidationErrors = async (req, res, notifications, clinicId, patientDetails,selectedSubTestDetails, selectedTestDetails, doctorId) => {
    try {
      // Fetch necessary lists for rendering the form
      const [clinics, categories, doctors, testDetails, subTestDetails] = await Promise.all([
        Clinic.getClinicList(),
        Category.getCategoryList(),
        Doctor.getAttachedDoctorList(clinicId),
        Test.getTestDetails(),
        Test.getSubTestDetails()
      ]);

      // Render the patient registration form with errors
      res.render('patientRegistration', {
        clinics,
        clinicId,
        categories,
        doctors,
        subTestDetails,
        testDetails,
        notifications,
        patientDetails,
        patientTestDetails: JSON.stringify(JSON.parse(selectedTestDetails)),
        patientSubTestDetails: JSON.stringify(JSON.parse(selectedSubTestDetails)),
        doctorId,
        title: 'Patient Registration',
        BRAND_NAME: process.env.BRAND_NAME,
        layout: 'loggedInLayout'
      });
    } catch (error) {
      return renderHomeWithError(res, error, 'Some error occurred. Please retry to register the patient.');
    }
  };
  
  // Function to handle rendering the home page with errors
  const renderHomeWithError = (res, error = '', customMessage = '') => {
    let notifications = [];
    if (customMessage) {
        notifications.push(createNotification('danger', customMessage, 'bi-exclamation-triangle-fill'));
    }
    if (error) {
        notifications.push(createNotification('danger', error, 'bi-exclamation-triangle-fill'));
    }

    res.render('home', {
        notifications,
        title: 'Home',
        BRAND_NAME: process.env.BRAND_NAME,
        layout: 'loggedInLayout'
    });
};

  
/**
 * 
 * @param {*} req 
 * @param {*} res 
 * This will use to send doctor list which are attached to particular clinic 
 */
let getListOfAttachedDoctorToClinic=( async(req,res)=>{
    try {
       let doctors= await Doctor.getAttachedDoctorList(req.body.clinicId)
            res.send(doctors);
    } catch (error) {
            res.send(error);
    }
});
/**
 * 
 * @param {*} req 
 * @param {*} res 
 * 
 * This function is used for generating invoices or biil
 * it is called from patient list view page
 */


let getInvoice = async (req, res) => {
    try {
        const patientId = req.query.id;
        if (!patientId) {
            //return res.status(400).json({ error: "Patient ID is required" });
            throw new Error("Patient ID is required");
        }

        // Fetch patient details
        const patientDetails = await Patient.getPatientDetails(patientId);
        if (!patientDetails || patientDetails.length === 0) {
            //return res.status(404).json({ error: "Patient not found" });
            throw new Error("Patient not found");
        }
        
       
        const { Name, CashPayment = 0, OnlinePayment = 0 ,Discount=0,DuesAmount=0} = patientDetails[0];  
        patientDetails[0].AmountPaid = parseInt(CashPayment) + parseInt(OnlinePayment);
        const isCancelled = patientDetails[0].Status === 2;

        // Fetch test details
        const testDetails = await Test.getPatientTestDetails(patientId);
        console.log(testDetails)

        // Render EJS template
        const templatePath = path.join(__dirname, '../views/partials/downloadPatientBillingInvoice.ejs');
        console.log('EJS Template Path:', templatePath);

        const html = await ejs.renderFile(templatePath, {  BRAND_NAME: process.env.BRAND_NAME,
            BRAND_QUOTE: process.env.BRAND_QUOTE,
            BRAND_SUB_QUOTE: process.env.BRAND_SUB_QUOTE,
            BRAND_ADDRESS: process.env.BRAND_ADDRESS,
            LANDMARK: process.env.LANDMARK,
            BRAND_CONTACT_NO: process.env.BRAND_CONTACT_NO,
            BRAND_SECONDARY_CONTACT_N0: process.env.BRAND_SECONDARY_CONTACT_N0,patientDetails, testDetails ,isCancelled,Discount,DuesAmount});

           return res.send(html)

        // Convert to PDF
        const pdfBuffer = await convertPdf.htmlToPdf(html);
        
        // Set response headers and send the PDF
        res.setHeader('Content-Disposition', `attachment; filename=${Name}.pdf`);
        res.contentType('application/pdf');
        res.send(pdfBuffer);

    } catch (error) {
        console.error("Error generating invoice:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
};



/**
 * 
 * @param {*} req 
 * @param {*} res 
 * This function is used for getting patient list view
 */
let getPatientListView = async(req,res)=>{
    //let errors=[];
    try {
        const [patientDetails, doctorDetails,categories] = await Promise.all([
            Patient.getPatientListWithDoctorDetail(req),
            Doctor.getDoctorList(),Category.getCategoryList()
        ]);
        console.log(patientDetails);
        res.render('getPatientListView',{patientDetails,categories,doctorDetails,title:'Patient List',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
    } catch (error) {
        return renderHomeWithError(res, error, 'Some error o9090ccurred. Please retry to edit the patient.');
    }
        
}

/**
 * 
 * @param {*} req 
 * @param {*} res 
 * This function is used to track Dues Amount of Patient
 */
let trackDuesAmount = async(req,res)=>{
    let notifications=[]
    try {
//only those patient list will come who have dues and not cancelled.
        let [patientDetails, doctorDetails] = await Promise.all([
            Patient.getDuesPatientListWithDoctorDetails(req),
            Doctor.getDoctorList()
        ]);
       // let patientDetails= await Patient.getDuesPatientListWithDoctorDetails(req);
      //  let doctorDetails= await Doctor.getDoctorList();
        let FromDate=req.body.FromDate ||moment().format('DD-MM-YYYY');
        let ToDate=req.body.ToDate || moment().format('DD-MM-YYYY');
        if(patientDetails.length>0)
            res.render('trackDuesAmount',{notifications,patientDetails,FromDate,ToDate,doctorDetails,title:'Patient Dues',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
        else {  
            patientDetails=[]
            notifications.push(createNotification('danger',`No Patient with dues amount exist in the system within date ${FromDate} And ${ToDate}`,'bi-check-circle-fill'))
            res.render('trackDuesAmount',{patientDetails,FromDate,ToDate,doctorDetails,title:'Patient Dues',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
        }
    } catch (error) {
        return renderHomeWithError(res, error, 'Some error occurred dues. Please retry to edit the patient.');

    }
}
/**
 * 
 * @param {*} req 
 * @param {*} res 
 * search patient with only dues Amount
 * same function is used as used for searching the patient in patient list view
 * here we will pas an extra variable so that patient with only dues amount is displayed
 */
let searchPatientWithDuesAmount=async(req,res)=>{
    try {
        req.patientWithOnlyDuesAmount=true;  
       // let patientDetails= await Patient.searchPatient(req);
       // let doctorDetails= await Doctor.getDoctorList();
    //setting a staus variable as 1 so that only active patient with dues will be displayed
        req.body.Status=1;
        const [patientDetails, doctorDetails] = await Promise.all([
            Patient.searchPatient(req),
            Doctor.getDoctorList()
        ]);
        let FromDate=req.body.FromDate;;
        let ToDate=req.body.ToDate
        let BillNo=req.body.BillNo
        let Name=req.body.Name
        let doctorId=req.body.Doctor;
        res.render('trackDuesAmount',{patientDetails,doctorId,Name,FromDate,ToDate,BillNo,doctorDetails,title:'Patient List',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})

    } catch (error) {
       // let errors=[];
       // errors.push({msg:error})
       return  renderHomeWithError(res, error, 'Some error occurred search. Please retry to edit the patient.');
       // res.render('home',{errors,title:'Home',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
    }
}
/**
 * 
 * @param {*} req 
 * @param {*} res 
 * This function is called from patient list view
 */

const searchPatient = async (req, res) => {
    const notifications = [];

    // Extract and sanitize input
    const {
        FromDate = moment().format('DD-MM-YYYY'),
        ToDate = moment().format('DD-MM-YYYY'),
        BillNo = '',
        Name = '',
        Doctor: doctorId = '',
        Status = '',
        MainCategory: categoryId = ''
    } = req.body || {};

    let doctorDetails = [];
    let categories = [];
    let patientDetails = [];

    // Load doctors and categories in parallel
    const results = await Promise.allSettled([
        Doctor.getDoctorList(),
        Category.getCategoryList()
    ]);

    if (results[0].status === 'fulfilled') {
        doctorDetails = results[0].value;
    } else {
        console.error('Error fetching doctor list:', results[0].reason);
        notifications.push(createNotification('danger', 'Unable to load doctors list.', 'bi-exclamation-triangle-fill'));
    }

    if (results[1].status === 'fulfilled') {
        categories = results[1].value;
    } else {
        console.error('Error fetching category list:', results[1].reason);
        notifications.push(createNotification('danger', 'Unable to load category list.', 'bi-exclamation-triangle-fill'));
    }

    // Search patients
    try {
        req.patientWithOnlyDuesAmount = false;
        patientDetails = await Patient.searchPatient(req);

        if (patientDetails.length === 0) {
            notifications.push(
                createNotification(
                    'warning',
                    'No patients found with the given search parameters. Please try again.',
                    'bi-exclamation-triangle-fill'
                )
            );
        }
    } catch (error) {
        console.error('Error searching patient:', error);
        notifications.push(
            createNotification(
                'danger',
                'An error occurred while searching for patients. Please try again later.',
                'bi-exclamation-triangle-fill'
            )
        );
    }

    // Render response
    res.render('getPatientListView', {
        patientDetails,
        doctorId,
        Status,
        categories,
        categoryId,
        Name,
        FromDate,
        ToDate,
        BillNo,
        doctorDetails,
        title: 'Patient List',
        BRAND_NAME: process.env.BRAND_NAME,
        layout: 'loggedInLayout',
        notifications,
    });
};


const updateDuesAmount = async (req, res) => {
    const patientId = req.query.patientId;
    const cashPayment = parseInt(req.body.cashPayment, 10) || 0;
    const onlinePayment = parseInt(req.body.onlinePayment, 10) || 0;

    console.log(onlinePayment);
    console.log('I am in online');

    let notifications = [];

    try {
        // Fetch patient payment details
        const patientPaymentDetails = await Patient.patientPaymentDetails(patientId);

        // Ensure patientPaymentDetails exists before destructuring
        if (!patientPaymentDetails || patientPaymentDetails.length === 0) {
            notifications.push(createNotification('danger', 'Patient details not found.', 'bi-exclamation-triangle-fill'));
            return res.render('trackDuesAmount', {
                notifications, title: 'Patient Dues', BRAND_NAME: process.env.BRAND_NAME, layout: 'loggedInLayout'
            });
        }

        const { Status: status, CashPayment: cashPaid, OnlinePayment: onlinePaid, DuesAmount: duesAmount, RegisteredOn } = patientPaymentDetails[0];

        // Calculate total payment
        const payment = cashPayment + onlinePayment;

        // **Validations**
        if (!status) {
            notifications.push(createNotification('danger', 'You cannot edit a cancelled patient.', 'bi-exclamation-triangle-fill'));
        }
        if (payment > duesAmount) {
            notifications.push(createNotification('danger', 'Payment is more than dues amount. Kindly check the payment and try again.', 'bi-exclamation-triangle-fill'));
        }
        if (payment <= 0 || cashPayment < 0 || onlinePayment < 0) {
            notifications.push(createNotification('danger', 'Invalid payment amounts. Kindly check and try again.', 'bi-exclamation-triangle-fill'));
        }

        // If any errors found, render the view
        if (notifications.length > 0) {
            const [patientDetails, doctorDetails] = await Promise.all([
                Patient.getDuesPatientListWithDoctorDetails(),
                Doctor.getDoctorList()
            ]);
            return res.render('trackDuesAmount', {
                notifications, doctorDetails, patientDetails, title: 'Patient Dues', BRAND_NAME: process.env.BRAND_NAME, layout: 'loggedInLayout'
            });
        }

        // **Update Dues**
        const remainingDues = duesAmount - payment;
        const updatedCashPayment = cashPaid + cashPayment;
        const updatedOnlinePayment = onlinePaid + onlinePayment;

        const result = await Patient.updateDuesAmount(req, patientId, updatedCashPayment, updatedOnlinePayment, remainingDues, RegisteredOn);

        // **After Successful Update, Fetch Updated Details**
        req.query.message = result;
        console.log('Dues updated successfully.');
        return getPatientDetail(req, res);

    } catch (error) {
        console.error('Error updating dues:', error);
        notifications.push(createNotification('danger', error.message || 'An unexpected error occurred.', 'bi-exclamation-triangle-fill'));

        try {
            const [patientDetails, doctorDetails] = await Promise.all([
                Patient.getDuesPatientListWithDoctorDetails(),
                Doctor.getDoctorList()
            ]);
            return res.render('trackDuesAmount', {
                notifications, doctorDetails, patientDetails, title: 'Patient Dues', BRAND_NAME: process.env.BRAND_NAME, layout: 'loggedInLayout'
            });
        } catch (error) {
            console.error('Error while fetching details:', error);
            return renderHomeWithError(res, error);
        }
    }
};



const getPatientDetail=async (req,res)=>{
        let patientId=req.query.patientId;
       // console.log('hi n patiri')
        let notifications=[];
       // console.log('individual patient iid')
        try {
            let patientDetail=await Patient.getPatientDetails(patientId)
            let patientTestDetail=await Patient.getPatientTestDetail(patientId)
            let testsWithComponents= await Patient.testsWithComponents(patientId)
            const isPatientEntered= await Patient.isPatientEneterdForTest(patientId);

           // Group them by PatientTestRefId and TestName
const grouped = {};
testsWithComponents.forEach(row => {
  if (!grouped[row.PatientTestRefId]) {
    grouped[row.PatientTestRefId] = {
      TestName: row.TestName,
      Components: []
    };
  }
  grouped[row.PatientTestRefId].Components.push({
    ComponentType: row.ComponentType,
    IsGenerated: row.IsGenerated,
    IsDelivered: row.IsDelivered,
    DeliveredOn: row.DeliveredOn,
    GeneratedOn: row.GeneratedOn,
    PatientTestRefId:row.PatientTestRefId
  });
});
const testList = Object.values(grouped);
            console.log(testList)

            console.log('bunb')

            console.log(patientTestDetail)

            console.log(req.query.message)
            
//coming from updateDuesAmount
            if(req.query.message)
                notifications.push(createNotification('success',req.query.message,'bi-check-circle-fill'))
                //setting one warning messsage for the user if patient has been cancelled
                console.log(notifications);
                 // 🔥 Collect flash messages
    const flashMessages = req.flash('success');
    flashMessages.forEach(msg => {
      notifications.push(createNotification('success', msg, 'bi-check-circle-fill'));
    });

    console.log(notifications);

                console.log('i m in that notifications comng from mark ')
                if(patientDetail[0].Status==2)
                     notifications.push(createNotification('warning','This patient has been cancelled.','bi-exclamation-triangle-fill',false))
            res.render('getPatientDetails',{patientId,isPatientEntered,testList,notifications,patientDetail,patientTestDetail,title:'Patient Test Detail',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
   
        } catch (error) {
            return renderHomeWithError(res, error, 'Some error occurred. Please retry.');
        }
       
       
}
let reportpatient= (req,res)=>{
    res.render('reporting',{title:'Patient Report Detail',BRAND_NAME:process.env.BRAND_NAME})
   
}


let dailyDuesReceived= async (req,res)=>{
    console.log('in dues received')
        try {
            let FromDate= req.body.FromDate;
            let ToDate= req.body.ToDate

            console.log(req.body)
            let duesReceivedDetails= await Patient.getDailyDuesReceivedData(req);
            res.render('getDailyDuesReceived',{duesReceivedDetails,FromDate,ToDate,title:'Daily Dues Received.',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})

        } catch (error) {
            return renderHomeWithError(res, error, 'Some error occurred. Please retry.');

        }
}
/**
 * 
 * @param {*} req 
 * @param {*} res 
 * This function is used to cancel the patient 
 */
const cancelPatient = async (req, res) => {
    let { FromDate, ToDate, BillNo, Name, Doctor: doctorId, Status} = req.body;  // Destructuring req.body

    console.log(req.body)
    let notifications = [];
   

    try {
        // Cancel the patient and fetch patient details concurrently
        const cancelResult = await Patient.cancelPatient(req)
        const patientDetails = await Patient.searchPatient(req)

        // Fetch doctor list
        const doctorDetails = await Doctor.getDoctorList();
        const categories= await Category.getCategoryList();

        // Add success message
        notifications.push(createNotification('success',cancelResult,'bi-check-circle-fill'));

        // Render patient list view
        res.render('getPatientListView', {
            patientDetails,
            FromDate,
            ToDate,
            BillNo,
            Name,
            doctorId,
            Status,
            notifications,
            doctorDetails,
            categories,
            title: 'Patient List',
            BRAND_NAME: process.env.BRAND_NAME,
            layout: 'loggedInLayout'
        });
        
    } catch (error) {
        // In case of an error, get patient and doctor list concurrently
        const [patientDetails, doctorDetails] = await Promise.all([
            Patient.getPatientListWithDoctorDetail(req),
            Doctor.getDoctorList()
        ]);

        // Add error message
        notifications.push(createNotification('danger',error,'bi-exclamation-triangle-fill'));

        // Render error view with the same template
        res.render('getPatientListView', {
            patientDetails,
            notifications,
            doctorDetails,
            title: 'Patient List',
            BRAND_NAME: process.env.BRAND_NAME,
            layout: 'loggedInLayout'
        });
    }
};


let thanks= async(req,res)=>{
    let notifications=[]
    try {
   
        let patientId=req.query.patientId
        const [result,patientDetail,patientTestDetail] =await Promise.all([Patient.thanks(req),Patient.getPatientDetails(patientId),Patient.getPatientTestDetail(patientId)])
            notifications.push(createNotification('success',result,'bi-check-circle-fill'))
        res.render('getPatientDetails',{patientId,notifications,patientDetail,patientTestDetail,title:'Patient Test Detail',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
   
    } catch (error) {
        return renderHomeWithError(res, error, 'Some error occurred. Please retry.');

    }
}
let commission= async(req,res)=>{

    try {
        let patientsList= await Patient.viewThanksPaidPatientList(req);
            res.render('viewThanksPaidList',{patientsList,title:'Thanks Paid Patients Detail',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
    } catch (error) {
       // let errors=[];
          //  error.push({msg:'Some error occured.Please try again.'})
           // res.render('home',{errors,title:'Home',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
            return renderHomeWithError(res, error, 'Some error occurred. Please try again.');

    }
}
let viewThanksPaidPatientList= async(req,res)=>{
   
    try {
        const [patientsList,doctorDetails] = await Promise.all([Patient.viewThanksPaidPatientList(req),Doctor.getDoctorList()])

        //let patientsList= await Patient.viewThanksPaidPatientList(req);
       // let doctorDetails= await Doctor.getDoctorList();
        let fromDate='';
        let toDate=''
        if(typeof req.body.FromDate !== "undefined")
            fromDate=req.body.FromDate
        if(typeof req.body.ToDate !== "undefined")
            toDate=req.body.ToDate
        let Name=req.body.Name
        res.render('viewThanksPaidList',{patientsList,fromDate,toDate,doctorDetails,Name,title:'Thanks Paid Patients Detail',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
    } catch (error) {
        return renderHomeWithError(res, error, 'Some error occurred. Please retry to see the thanks list.');
    }
}


const getPatientTimeLine= async(req,res)=>{

    try {
        const patientId= req.params.patientId
        const patientTimeLineData= await Patient.getPatientTimeLineData(patientId)
        const groupedLogs = {}; 
        patientTimeLineData.forEach(log => {
          const timeKey = moment(log.ChangedAt).format('YYYY-MM-DD HH:mm'); // Group by minute
          if (!groupedLogs[timeKey]) groupedLogs[timeKey] = [];
          groupedLogs[timeKey].push(log);
        });
      
        const groupedEntries = Object.entries(groupedLogs);
        console.log('i m in timeline')
        res.render('getPatientTimeLine',{groupedEntries,moment,title:'Patient Time Line',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
    } catch (error) {
        
    }
}

const getPatientHistory = async(req,res)=>{

    try {
//console.log('i am here')
    const [patientDetails, doctorDetails,categories] = await Promise.all([
    Patient.getPatientListWithDoctorDetail(req),
    Doctor.getDoctorList(),Category.getCategoryList()
]);
        res.render('getPatientDetailsChangeHistory',{patientDetails,categories,doctorDetails,title:'Patient Test Detail',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'})
    } catch (error) {
        
    }
}


const getSearchedPatientList = async (req, res) => {
    const {
        FromDate = moment().format('DD-MM-YYYY'),
        ToDate = moment().format('DD-MM-YYYY'),
        BillNo = '',
        Name = '',
        Doctor: doctorId = '',
        Status = '',
        MainCategory: categoryId = ''
    } = req.body || {};

    let doctorDetails = [];
    let categories = [];
    let patientDetails = [];
    const notifications = [];

    try {
        // Load doctors and categories in parallel
        const [doctorResult, categoryResult] = await Promise.allSettled([
            Doctor.getDoctorList(),
            Category.getCategoryList()
        ]);

        if (doctorResult.status === 'fulfilled') {
            doctorDetails = doctorResult.value;
        } else {
            console.error('Error fetching doctor list:', doctorResult.reason);
            notifications.push(createNotification('danger', 'Unable to load doctors list.', 'bi-exclamation-triangle-fill'));
        }

        if (categoryResult.status === 'fulfilled') {
            categories = categoryResult.value;
        } else {
            console.error('Error fetching category list:', categoryResult.reason);
            notifications.push(createNotification('danger', 'Unable to load category list.', 'bi-exclamation-triangle-fill'));
        }

        // Patient search
        req.patientWithOnlyDuesAmount = false; // Add this only if your logic needs it
        patientDetails = await Patient.searchPatient(req);

        if (!patientDetails || patientDetails.length === 0) {
            notifications.push(
                createNotification(
                    'warning',
                    'No patients found with the given search parameters. Please try again.',
                    'bi-exclamation-triangle-fill'
                )
            );
        }

        res.render('getPatientDetailsChangeHistory', {
            patientDetails,
            doctorId,
            Status,
            categories,
            categoryId,
            Name,
            FromDate,
            ToDate,
            BillNo,
            doctorDetails,
            title: 'Patient List',
            BRAND_NAME: process.env.BRAND_NAME,
            layout: 'loggedInLayout',
            notifications,
        });

    } catch (error) {
        console.error('Error searching patient:', error);
        notifications.push(
            createNotification(
                'danger',
                'An unexpected error occurred while processing the patient search.',
                'bi-exclamation-triangle-fill'
            )
        );
    }

    res.render('getPatientDetailsChangeHistory', {
        patientDetails,
        doctorId,
        Status,
        categories,
        categoryId,
        Name,
        FromDate,
        ToDate,
        BillNo,
        doctorDetails,
        title: 'Patient List',
        BRAND_NAME: process.env.BRAND_NAME,
        layout: 'loggedInLayout',
        notifications,
    });
};

const filmOrReportGenerated= async(req,res)=>{
    try {
//console.log(' i m in film generation')
  //      console.log(req.body)
    //    console.log('film generated nad will be generated')
        const patientId= req.body.patientId;
        const componentType=req.body.componentType;
        const patientTestRefId=req.body.patientTestRefId
           
        if(!patientId || !patientTestRefId)
            throw 'Sorry some parameter has been missing.Kindly try again.'
        const result= await Patient.setFilmOrReportCreatedStatus(patientTestRefId,req.user.Id,componentType);
        //passing patientId and message in req query as patient details function require them like that
        req.query.patientId= patientId
        req.query.message=`${componentType} created status updated sucessfully.`
        return getPatientDetail(req, res);
    } catch (error) {
        return renderHomeWithError(res,error, 'Some error occurred. Please retry to change the patient.');
    }
}

/**
 * @function fimOrReportDelivered
 * @async
 * @description
 * Handles updating the delivery status of a film or report component for a patient.
 * Validates required parameters, calls the model to update the status, 
 * and then calls the `getPatientDetail` function to reload the patient detail page
 * with a success message. In case of errors, it renders the home page with an error message.
 *
 * @param {Object} req - Express request object
 * @param {Object} req.body - Request body containing necessary parameters
 * @param {string|number} req.body.patientId - ID of the patient
 * @param {string} req.body.componentType - Type of the component (e.g., 'X-ray', 'Report', 'MRI Film')
 * @param {string|number} req.body.patientTestRefId - Reference ID of the patient test/component
 * @param {Object} req.user - Currently logged-in user object
 * @param {string|number} req.user.Id - ID of the logged-in user (used for audit)
 * @param {Object} res - Express response object
 * 
 * @returns {Promise<void>} Calls `getPatientDetail` on success to render patient details,
 * or calls `renderHomeWithError` if an error occurs.
 * 
 * @throws Will throw an error if `patientId` or `patientTestRefId` is missing in the request body.
 * 
 * @example
 * // POST /patient/mark-delivered
 * // body: { patientId: 123, componentType: 'X-ray', patientTestRefId: 456 }
 * fimOrReportDelivered(req, res);
 */
const fimOrReportDelivered = async (req, res) => {
    try {
        const patientId = req.body.patientId;
        const componentType = req.body.componentType;
        const patientTestRefId = req.body.patientTestRefId;

        if (!patientId || !patientTestRefId) {
            throw 'Sorry, some parameter is missing. Kindly try again.';
        }

        const result = await Patient.setFilmOrReportDeliveredStatus(patientTestRefId, req.user.Id, componentType);

        // passing patientId and message in req query as getPatientDetail requires them
        req.query.patientId = patientId;
        req.query.message = `${componentType} delivered status updated successfully.`;

        return getPatientDetail(req, res);
    } catch (error) {
        return renderHomeWithError(res, error, 'Some error occurred. Please retry to change the patient status.');
    }
};


/**
 * @function markTestCompleted
 * @async
 * @description
 * Handles marking selected tests for a patient as completed. 
 * This controller validates the selected tests, calls the model to update the database,
 * and sets appropriate flash messages before redirecting back to the patient detail page.
 *
 * @param {Object} req - Express request object
 * @param {Object} req.params - Route parameters
 * @param {string} req.params.patientId - The ID of the patient whose tests are being updated
 * @param {Object} req.body - Request body containing selected tests
 * @param {Array.<string|number>} req.body.selectedTests - Array of Test IDs that are selected to mark as completed
 * @param {Object} res - Express response object
 * 
 * @returns {void} Redirects the user to the patient detail page with flash messages
 * 
 * @throws Will redirect with an error flash message if:
 *  - No tests are selected
 *  - Any error occurs during database update
 *
 * @example
 * // POST /tests/markCompleted/123
 * // body: { selectedTests: [1, 2, 5] }
 * markTestCompleted(req, res);
 */
const markTestCompleted = async (req, res) => {
    const patientId = req.params.patientId;
    const selectedTests = req.body.selectedTests; // array of TestId
  
    try {
      if (!selectedTests || selectedTests.length === 0) {
        // Show warning modal/message
        req.flash('error', 'Please select at least one test before completing.');
        return res.redirect(`/patient/getPatientDetail?patientId=${patientId}`);
      }
  
      // Call model to update DB
      await Patient.markTestsCompleted(patientId, selectedTests);
  
      // Success message
      req.flash('success', 'Selected tests marked as completed successfully.');
      return res.redirect(`/patient/getPatientDetail?patientId=${patientId}`);
    } catch (err) {
      console.error(err);
      req.flash('error', 'Something went wrong while marking tests.');
      return res.redirect(`/patient/getPatientDetail?patientId=${patientId}`);
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
const createNotification = (type, messages, icon, alertDismissible=true) => ({type,messages,icon,alertDismissible});
module.exports={
    getPatientRegistrationPage:getPatientRegistrationPage,
    getListOfAttachedDoctorToClinic:getListOfAttachedDoctorToClinic,
    registerPatientDetails:registerPatientDetails,
    getInvoice:getInvoice,
    getPatientListView:getPatientListView,
    trackDuesAmount:trackDuesAmount,
    searchPatient:searchPatient,
    editPatientDetails:editPatientDetails,
    updateDuesAmount:updateDuesAmount,
    updatePatientDetails:updatePatientDetails,
    getPatientDetail:getPatientDetail,
    reportpatient:reportpatient,
    dailyDuesReceived:dailyDuesReceived,
    cancelPatient:cancelPatient,
    searchPatientWithDuesAmount:searchPatientWithDuesAmount,
    thanks:thanks,
    commission:commission,
    viewThanksPaidPatientList:viewThanksPaidPatientList,
  //  searchEditedPatient:searchEditedPatient,
   // getPatientEditedHistory:getPatientEditedHistory,
    getPatientTimeLine:getPatientTimeLine,
    getPatientHistory:getPatientHistory,
    getSearchedPatientList:getSearchedPatientList,
    fimOrReportDelivered:fimOrReportDelivered,
    filmOrReportGenerated:filmOrReportGenerated,
    markTestCompleted:markTestCompleted
}
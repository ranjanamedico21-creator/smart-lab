
const Billing = require("../models/Billing");
const Clinic = require("../models/Clinic");
const Doctor = require("../models/Doctor");
const User = require("../models/User");
const moment = require('moment');
const {validationResult } = require('express-validator');
const fs = require('fs');
const path = require('path');


// get Clinic RegistrationPage
let getClinicRegistrationPage = async(req, res) => {
  try {
    const users= await User.getUserList();//to assign marketing person to clinic 
      if(! users.length>0)
          throw new Error('Create user to assign to clinic.As of now there is only admin.')
        res.render("registerClinic",{ users,title: 'Register Clinic',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout' });
  } catch (error) {
     let notifications=[]
     notifications.push(createNotification('danger', error, 'bi-exclamation-triangle-fill'))
     res.render("home",{notifications, title: 'Home',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'});
    
  }
};

//getHomePage
let getHomePage = (req, res) => {
  res.render("home",{ title: 'Home',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'});
};

//get Clinic List view
let getClinicListView = async (req, res) => {
  let notifications=[]
  try {
      const clinicDetails= await Clinic.getClinicList();
        if(!clinicDetails.length>0)
          throw new Error('No clinic exist.Kindly add clinic to get the list.')
      res.render("getClinicListView", {title: 'Clinic List View',BRAND_NAME:process.env.BRAND_NAME,clinicDetails,notifications,layout: 'loggedInLayout'});
  } catch (error) {
    notifications.push(createNotification('danger', error, 'bi-exclamation-triangle-fill'));
    res.render("home", {  title: 'Home',BRAND_NAME:process.env.BRAND_NAME,notifications,layout: 'loggedInLayout' });
  }
};

//register clinic into database
let registerClinic = async (req, res) => {

  const {ClinicName,Email,PhoneNumber,SecondaryNumber,Address,AdditionalAddress,KeyArea, Pincode,City,State, LandMark,AssignedId} = req.body;
  let notifications=[]
  const errors = req.validationErrors || []
  const users= await User.getUserList();

  if (errors.length > 0) {
      notifications.push(createNotification('danger', errors, 'bi-exclamation-triangle-fill'));
      res.render("registerClinic", {users,notifications,ClinicName,Email,PhoneNumber,SecondaryNumber,Address,AdditionalAddress,KeyArea,Pincode,City,State,LandMark,AssignedId,layout: 'loggedInLayout',title: 'Clinic List View',BRAND_NAME:process.env.BRAND_NAME
    });
  } else {
    //validation passed
    //create a new Clinic
    const date = moment().format('YYYY-MM-DD');
    let newClinic = {ClinicName: req.body.ClinicName,Email: req.body.Email,PhoneNumber: req.body.PhoneNumber,SecondaryNumber: req.body.SecondaryNumber,
                    Address: req.body.Address,AdditionalAddress: req.body.AdditionalAddress,KeyArea: req.body.KeyArea,Pincode: req.body.Pincode,
                    City: req.body.City,State: req.body.State,LandMark: req.body.LandMark,CreatedOn: date,CreatedBy: req.user.Id,AssignedTo:req.body.AssignedId
    };

    try {
      const clinicDetails = await Clinic.createNewClinic(newClinic, req);
           const clinicPrescription = req.files.clinicPrescription;
            const clinicName = req.body.ClinicName;
            const uploadDir = path.join(process.cwd(), 'prescriptions');

            // Ensure the directory exists
            if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir, { recursive: true });
            }

            const fileName = `${clinicName}_${clinicDetails.insertedId}.jpg`;
            const uploadPath = path.join(uploadDir, fileName);

           
            clinicPrescription.mv(uploadPath, function (error) {
                if (error) {
                    notifications.push(createNotification('danger', error.message, 'bi-exclamation-triangle-fill'));
                } else {
                    notifications.push(createNotification('success', 'Prescription uploaded successfully', 'bi-check-circle-fill'));
                }
            });
          notifications.push(createNotification('success', "Clinic is Successfully Registered.", 'bi-check-circle-fill'));
          res.render("getClinicListView", { title: 'Clinic List View',BRAND_NAME:process.env.BRAND_NAME,notifications, clinicDetails,layout: 'loggedInLayout' });
    } catch (error) {
         // errors.push({ msg: err });
          notifications.push(createNotification('danger', error, 'bi-exclamation-triangle-fill'));
          res.render("registerClinic", {notifications,users,
          ClinicName,Email,PhoneNumber,SecondaryNumber,Address,AdditionalAddress,KeyArea,Pincode,City,State,LandMark,AssignedId,
          title: 'Register Clinic',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'
      });
    }
  }
};



const getupdateClinicDetailsPage = async (req, res) => {
  let notifications = [];
  let clinicData = {}; // Stores clinic details to pass to the view
  let users={}//to assign clinic to marketing person

  try {
      // Ensure an ID is provided
      if (!req.query.id) {
          throw new Error("Clinic ID is required.");
      }

      // Fetch clinic details
      const clinic = await Clinic.findClinicById(req.query.id);
      if (!clinic) {
          throw new Error(`Clinic with ID ${req.query.id} not found.`);
      }
       users= await User.getUserList();//to assign marketing person to clinic 
      if(! users.length>0)
          throw new Error('Create user to assign to clinic.As of now there is only admin.')

      // Assign fetched clinic data
      clinicData = {
          ClinicName: clinic.Name,
          Email: clinic.Email,
          PhoneNumber: clinic.PhoneNumber,
          SecondaryNumber: clinic.SecondaryNumber,
          Address: clinic.Address,
          AdditionalAddress: clinic.AdditionalAddress,
          KeyArea: clinic.KeyArea,
          Pincode: clinic.Pincode,
          City: clinic.City,
          State: clinic.State,
          LandMark: clinic.LandMark,
          clinicId: req.query.id,
          AssignedTo:clinic.AssignedTo
      };

  } catch (error) {
      notifications.push(createNotification('danger', error.message, 'bi-exclamation-triangle-fill'));

      // Return an error page if clinic data is missing
      return res.render("updateClinicDetails", {
          notifications,
          users,
          ...clinicData, // Will be empty if error occurs
          title: 'Update Clinic Details',
          BRAND_NAME: process.env.BRAND_NAME,
          layout: 'loggedInLayout'
      });
  }

  // Render the page with clinic details
  res.render("updateClinicDetails", {
      notifications,
      users,
      ...clinicData,
      title: 'Update Clinic Details',
      BRAND_NAME: process.env.BRAND_NAME,
      layout: 'loggedInLayout'
  });
};



const updateClinicDetails = async (req, res) => {
  let notifications = [];
  let users = [];
  //const id = req.body.id || req.query.id; // Ensure ID is always available
  const clinicId= req.query.id
    if(!clinicId)
        throw new Error(`No clinic found with Id ${clinicId}`)

  try {
      // Fetch users list (moved inside try-catch)
      users = await User.getUserList();

      // Extract form data
      const { ClinicName, Email, PhoneNumber, SecondaryNumber, Address, AdditionalAddress, KeyArea, Pincode, City, State, LandMark, AssignedId } = req.body;

      // Handle validation errors
      const errors = req.validationErrors || []
      if (errors.length > 0) {
          notifications.push(createNotification('danger', errors, 'bi-exclamation-triangle-fill'));
          return res.render("updateClinicDetails", {
              notifications, users, ClinicName, Email, PhoneNumber, SecondaryNumber, Address, AdditionalAddress, KeyArea, Pincode, City, State, LandMark, id, AssignedTo: AssignedId,
              title: 'Update Clinic Details', BRAND_NAME: process.env.BRAND_NAME, layout: 'loggedInLayout'
          });
      }

      // Prepare updated clinic data
      const updatedClinic = {
          Name: ClinicName,
          Email,
          PhoneNumber,
          SecondaryNumber,
          Address,
          AdditionalAddress,
          KeyArea,
          Pincode,
          City,
          State,
          LandMark,
          CreatedOn: new Date(),
          CreatedBy: req.user.Id,
          clinicId,
          AssignedTo: AssignedId
      };

          // Update clinic details
          const clinicDetails = await Clinic.updateExistingClinic(updatedClinic, req);
          //upload image if exist previously then delete and reupload
            const clinicPrescription = req.files.clinicPrescription;
            const clinicName = req.body.ClinicName;
            const uploadDir = path.join(process.cwd(), 'prescriptions');

            // Ensure the directory exists
            if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir, { recursive: true });
            }

            const fileName = `${clinicName}_${clinicId}.jpg`;
            const uploadPath = path.join(uploadDir, fileName);

            // Check if the file already exists and delete it
            if (fs.existsSync(uploadPath)) {
                fs.unlinkSync(uploadPath);
            }

            clinicPrescription.mv(uploadPath, function (error) {
                if (error) {
                    notifications.push(createNotification('danger', error.message, 'bi-exclamation-triangle-fill'));
                } else {
                    notifications.push(createNotification('success', 'Prescription uploaded successfully', 'bi-check-circle-fill'));
                }
            });

      // Render updated clinic list
      return res.render("getClinicListView", { notifications, clinicDetails, title: 'Clinic List', BRAND_NAME: process.env.BRAND_NAME, layout: 'loggedInLayout' });

  } catch (error) {
      console.error("Error updating clinic:", error);

      // Error notification
      notifications.push(createNotification('danger', error, 'bi exclamation-triangle-fill'));

      return res.render("updateClinicDetails", {
          notifications, users, ClinicName: req.body.ClinicName, Email: req.body.Email, PhoneNumber: req.body.PhoneNumber, SecondaryNumber: req.body.SecondaryNumber,
          Address: req.body.Address, AdditionalAddress: req.body.AdditionalAddress, KeyArea: req.body.KeyArea, Pincode: req.body.Pincode, City: req.body.City,
          State: req.body.State, LandMark: req.body.LandMark, clinicId, AssignedTo: req.body.AssignedId,
          title: 'Update Clinic Details', BRAND_NAME: process.env.BRAND_NAME, layout: 'loggedInLayout'
      });
  }
};

let attachDoctorWithClinic = async (req, res) => {
  let notifications = [];
  let clinicDetails = [];
  let unAttachedDoctorList = [];
  let attachedDoctorList = [];

  try {
    const clinicId = parseInt(req.params.clinicId);
    clinicDetails = await Clinic.findClinicById(clinicId);

    if (clinicDetails.length === 0) {
      notifications.push(createNotification('danger', 'Clinic does not exist. Kindly try again.', 'bi-exclamation-triangle-fill'));
    }

    unAttachedDoctorList = await Doctor.getdoctorListNotattachedToclinic(clinicId);

    if (unAttachedDoctorList.length === 0) {
      notifications.push(createNotification('danger', 'No doctor available to attach to this clinic.', 'bi-exclamation-triangle-fill'));
    }

    attachedDoctorList = await Doctor.getAttachedDoctorList(clinicId);
  } catch (error) {
    console.error("Error fetching clinic details:", error);

    try {
      // If an error occurs, get the list of clinics as a fallback
      clinicDetails = await Clinic.getClinicList();
    } catch (fallbackError) {
      console.error("Error fetching clinic list:", fallbackError);
      notifications.push(createNotification('danger', 'Unable to fetch clinic list.', 'bi-exclamation-triangle-fill'));
    }

    return res.render("getClinicListView", {
      title: 'Clinic List View',
      BRAND_NAME: process.env.BRAND_NAME,
      clinicDetails,
      notifications,
      layout: 'loggedInLayout'
    });
  }

  res.render("attachDoctorToClinic", {
    title: 'Attach Doctor To Clinic',
    BRAND_NAME: process.env.BRAND_NAME,
    clinicDetails,
    notifications,
    unAttachedDoctorList,
    attachedDoctorList,
    layout: 'loggedInLayout'
  });
};

/**
 * 
 * @param {*} clinicId 
 * @returns 
 * helper function for the attached doctor and detaching doctor which are the below
 */
let getClinicDetails = async (clinicId) => {
  return {
      clinicDetails: await Clinic.findClinicById(clinicId),
      unAttachedDoctorList: await Doctor.getdoctorListNotattachedToclinic(clinicId),
      attachedDoctorList: await Doctor.getAttachedDoctorList(clinicId),
  };
};

let attachDoctorToClinic = async (req, res) => {
  let notifications = [];
  const clinicId = parseInt(req.query.clinicId);
  

  try {

      const message = await Clinic.attachDoctorToClinic(req);
      notifications.push(createNotification('success', message, 'bi-check-circle-fill'));
  } catch (error) {
      notifications.push(createNotification('danger', error.message || 'An error occurred', 'bi-exclamation-triangle-fill'));
  }

  // Fetch clinic details and render the page (for both success & error cases)
  const data = await getClinicDetails(clinicId);
  res.render("attachDoctorToClinic", { 
      title: 'Attach Doctor To Clinic',
      BRAND_NAME: process.env.BRAND_NAME,
      ...data,
      notifications,
      layout: 'loggedInLayout' 
  });
};

let detachDoctorFromClinic = async (req, res) => {
  let notifications = [];
  const clinicId = parseInt(req.params.clinicId);

  try {
      const message = await Clinic.detachDoctorFromClinic(req);
      notifications.push(createNotification('success', message, 'bi-check-circle-fill'));
  } catch (error) {
      notifications.push(createNotification('danger', error.message || 'An error occurred', 'bi-exclamation-triangle-fill'));
  }

  // Fetch clinic details and render the page (for both success & error cases)
  const data = await getClinicDetails(clinicId);
  res.render("attachDoctorToClinic", { 
      title: 'Attach Doctor To Clinic',
      BRAND_NAME: process.env.BRAND_NAME,
      ...data,
      notifications,
      layout: 'loggedInLayout' 
  });
};

/**
 * 
 * @param {*} type 
 * @param {*} messages 
 * @param {*} icon 
 * @returns object
 */
const createNotification = (type, messages, icon) => ({type,messages,icon,});
//export all the function for global variable
module.exports = {
  getClinicRegistrationPage: getClinicRegistrationPage,
  getHomePage: getHomePage,
  getClinicListView: getClinicListView,
  registerClinic: registerClinic,
  getupdateClinicDetailsPage: getupdateClinicDetailsPage,
  updateClinicDetails: updateClinicDetails,
  attachDoctorWithClinic: attachDoctorWithClinic,
  attachDoctorToClinic: attachDoctorToClinic,
  detachDoctorFromClinic:detachDoctorFromClinic
};

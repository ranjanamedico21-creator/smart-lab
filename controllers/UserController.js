const passport = require("passport");
const User = require("../models/User");
const {validationResult } = require('express-validator');
require("dotenv").config();
const fs = require('fs');
const path = require('path');
const htmlToDocx = require('html-to-docx');
const ejs = require('ejs');
const convertPdf= require('../views/partials/htmlToPdf');
const e = require("connect-flash");
const moment =require('moment');



// Helper function for error notifications
const createNotification = (type, messages, icon) => ({type, messages,icon,});

//get home page if user is looged in
let getHomePage = (req, res) => {
  const activeParent='dashboard'
  res.render("home",{layout: 'loggedInLayout' ,activeParent,title:'Home',BRAND_NAME:process.env.BRAND_NAME});
};

//get login page
let getLoginPage = (req, res) => {
   const messageArray =req.flash("message")
   const notifications=[createNotification("danger",messageArray[0] , "bi-exclamation-triangle-fill")]
   res.render("login",{notifications,title:'Login',BRAND_NAME:process.env.BRAND_NAME});
};

//get user registration page
let getUserRegistrationPage = (req, res) => {
  res.render("registerUser",{title:'User Registration',BRAND_NAME:process.env.BRAND_NAME});
};


let registerUser = async (req, res) => {
  const { FirstName, LastName, Email, Password, PhoneNumber, Gender , JoiningDate} = req.body;
  let notifications = [];

  // Validate request
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
     notifications.push(createNotification("danger", errors.array(), "bi-exclamation-triangle-fill"));
    return res.render("registerUser", {
      notifications,
      FirstName,
      LastName,
      Email,
      PhoneNumber,
      Gender,
      JoiningDate,
      title: "Register User",
      BRAND_NAME: process.env.BRAND_NAME,
    });
  }

  try {

    
    let newUser = {
      FirstName,
      LastName,
      Email,
      DateOfJoining: JoiningDate,
      Password,
      PhoneNumber,
      Gender
    };

    let result = await User.createNewUser(newUser);
     notifications= [createNotification("success", result, "bi-check-circle-fill"),];
    res.render("login", {
      notifications,
      title: "Register User",
      BRAND_NAME: process.env.BRAND_NAME,
      layout: "layout",
    });
  } catch (err) {
   notifications= [createNotification("danger", err , "bi-exclamation-triangle-fill"),];
  console.log(notifications)
    res.render("registerUser", {
      notifications,
      FirstName,
      LastName,
      Email,
      PhoneNumber,
      JoiningDate,
      Gender,
      title: "Register User",
      BRAND_NAME: process.env.BRAND_NAME,
    });
  }
};



let login = (req, res, next) => {
  passport.authenticate("local", (err, user, info) => {
   
    if (err) {

      return next(err); // Pass error to Express error handler
    }
    if (!user) {
      req.flash("message",info.message)
      return res.redirect("/user/login?=9"); // Redirect to login if authentication fails
    }
    req.logIn(user, (err) => {
      if (err) {
        return next(err);
      }
      return res.redirect("/user/home");
    });
  })(req, res, next);
};

//get Change password page
let getChangePasswordPage = (req, res) => {
  res.render("changePassword",{title:'Change Password',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'});
};

//change Password
let changePassword = async (req, res) => {
  let notifications=[]
  try {
    let message = await User.changePassword(req, res);
     notifications = [createNotification("success", message, "bi-check-circle-fill"),];
    res.render("home", { notifications,title:'Home',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout' });
  } catch (error) {
     notifications = [createNotification("danger", error.message , "bi-exclamation-triangle-fill"),];
    res.render("changePassword", { notifications ,title:'Change Password',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout'});
  }
};

let postLogOut = (req, res) => {
     req.session.destroy(function (err) {
     res.render("login",{title:'Login',BRAND_NAME:process.env.BRAND_NAME,layout: 'layout'});
  });
}
/*const getUserList = async (req, res) => {
  try {
    const users = await User.getUserList();
    const roles= await User.getRoles()
    console.log('roles')
    console.log(roles)
    // Render the users on the page with title and brand name
    res.render('displayUserList', {
                                  users,                      // User data
                                  roles,                      //Roles Data
                                  title: 'User List',          // Page title
                                  BRAND_NAME: process.env.BRAND_NAME, // Environment brand name
                                  layout: 'loggedInLayout'             // Layout to use
                                });
  } catch (error) {
    // Catch errors and handle them by rendering a different page with error messages
      const notifications = [createNotification("danger", error.message , "#exclamation-triangle-fill"),];
    // Render the home page with error messages and environment variables
    res.render('home', {
                notifications,                       // Pass errors to display on the home page
                layout: 'loggedInLayout',     // Use the logged-in layout
                title: 'Home',                // Page title
                BRAND_NAME: process.env.BRAND_NAME // Brand name
              });
  }
};*/
/**
 * 
 * @param {*} req 
 * @param {*} res 
 * updated on june 25 2025
 */
const getUserList = async (req, res) => {
  try {
    await renderUserListPage(res);
  } catch (error) {
    const notifications = [createNotification("Danger", error.message, "bi-exclamation-triangle-fill")];
    res.render('home', {
      notifications,
      layout: 'loggedInLayout',
      title: 'Home',
      BRAND_NAME: process.env.BRAND_NAME
    });
  }
};
const renderUserListPage = async (res, notifications = []) => {
  const users = await User.getUserList();
  const roles = await User.getRoles();

  res.render('displayUserList', {
    users,
    roles,
    notifications,
    title: 'User List',
    BRAND_NAME: process.env.BRAND_NAME,
    layout: 'loggedInLayout',
  });
};

const getAssignAuthorisationPage = async (req, res) => {
  let notifications=[]
  try {
      const userId = req.params.userId;

      // Validate userId
      if (!userId) {
         notifications = [createNotification("danger", 'Invalid User Id' , "bi-exclamation-triangle-fill"),];
         // Call the model function to get users
    const users = await User.getUserList();

    // Render the users on the page with title and brand name
    return res.render('displayUserList', {
                                          users,
                                          notifications,                      // User data
                                          title: 'User List',          // Page title
                                          BRAND_NAME: process.env.BRAND_NAME, // Environment brand name
                                          layout: 'loggedInLayout'             // Layout to use
                                        });
    }

      // Fetch already authorized and unauthorized functions
      const authorisedFunctions = await User.getAlreadyAuthorisedFunctions(userId);
      const unAuthorisedFunctionLists = await User.getAllUnAuthorisedFunctionList(userId);

      // Render the authorisation page
      res.render('authoriseFunctionToUser', {
          authorisedFunctions,
          userId,
          unAuthorisedFunctionLists,
          layout: 'loggedInLayout', // Use the logged-in layout
          title: 'User Authorisation Page', // Page title
          BRAND_NAME: process.env.BRAND_NAME // Brand name from environment
      });
  } catch (error) {
      console.error('Error fetching authorisation data:', error);
      const users = await User.getUserList();
            notifications = [createNotification("danger", 'An error occurred while loading the authorisation page' , "bi-exclamation-triangle-fill"),];
         return  res.status(500).render('displayUserList', {
            users,
            notifications,                      // User data
            title: 'User List',          // Page title
            BRAND_NAME: process.env.BRAND_NAME, // Environment brand name
            layout: 'loggedInLayout'             // Layout to use
          });
     
  }
};


const authoriseAccess = async (req, res) => {

  let notifications=[]
  try {
      const userId = req.params.userId;
      const selectedFunctions = req.body.selectedFunctions;

      // Validate userId and selectedFunctions
      if (!userId || !Array.isArray(selectedFunctions) || selectedFunctions.length === 0) {
        const users = await User.getUserList();
             notifications = [createNotification("danger", 'An error occurred while loading the authorisation page' , "bi-exclamation-triangle-fill"),];
           return res.status(500).render('displayUserList', {
              users,
              notifications,                      // User data
              title: 'User List',          // Page title
              BRAND_NAME: process.env.BRAND_NAME, // Environment brand name
              layout: 'loggedInLayout'             // Layout to use
            });
      }

      // Authorise user to selected functions
      await User.authoriseUserToFunction(selectedFunctions, userId);

      // Fetch updated authorised and unauthorised function lists after assigning
      const authorisedFunctions = await User.getAlreadyAuthorisedFunctions(userId);
      const unAuthorisedFunctionLists = await User.getAllUnAuthorisedFunctionList(userId);

      // Render the authorisation page again with updated data
      res.render('authoriseFunctionToUser', {
          authorisedFunctions,
          userId,
          unAuthorisedFunctionLists,
          layout: 'loggedInLayout',
          title: 'User Authorisation Page',
          BRAND_NAME: process.env.BRAND_NAME
      });
  } catch (error) {
      console.error('Error authorising user access:', error);
      const users = await User.getUserList();
       notifications = [createNotification("danger", 'An error occurred while loading the authorisation page' , "bi-exclamation-triangle-fill"),];
          res.status(500).render('displayUserList', {
            users,
            notifications,                      // User data
            title: 'User List',          // Page title
            BRAND_NAME: process.env.BRAND_NAME, // Environment brand name
            layout: 'loggedInLayout'             // Layout to use
          });
  }
};

const removeAuthorisation = async (req, res) => {

  let notifications=[]
  try {
    const userId = parseInt(req.params.userId, 10);
    const functionId = parseInt(req.params.functionId, 10);
    // Validate IDs
    if (isNaN(userId) || isNaN(functionId)) {
     notifications = [createNotification("danger", 'Invalid User ID or Function ID' , "bi-exclamation-triangle-fill"),];
      return res.render('authoriseFunctionToUser', {
        authorisedFunctions: [],
        unAuthorisedFunctionLists: [],
        notifications,
        userId: userId || null,
        layout: 'loggedInLayout',
        title: 'User Authorisation Page',
        BRAND_NAME: process.env.BRAND_NAME
      });
    }

    // Remove authorisation
    const message = await User.removeAuthorisation(userId, functionId);

    // Fetch updated lists in parallel
    const [authorisedFunctions, unAuthorisedFunctionLists] = await Promise.all([
      User.getAlreadyAuthorisedFunctions(userId),
      User.getAllUnAuthorisedFunctionList(userId)
    ]);
       notifications = [createNotification("success", message, "bi-check-circle-fill"),];
    // Render the page with success message
    res.render('authoriseFunctionToUser', {
      authorisedFunctions,
      unAuthorisedFunctionLists,
      notifications,
      userId,
      layout: 'loggedInLayout',
      title: 'User Authorisation Page',
      BRAND_NAME: process.env.BRAND_NAME
    });
  } catch (error) {
    console.error('Error removing authorisation:', error);
     notifications = [createNotification("danger", 'Failed to remove authorisation. Please try again.' , "bi-exclamation-triangle-fill"),];
    // Render with an error message
    res.render('authoriseFunctionToUser', {
      authorisedFunctions: [],
      unAuthorisedFunctionLists: [],
      notifications,
      userId: req.params.userId || null,
      layout: 'loggedInLayout',
      title: 'User Authorisation Page',
      BRAND_NAME: process.env.BRAND_NAME
    });
  }
};

/*const assignRole = async(req,res)=>{
  try {
    console.log(req.body)
    const userId= req.body.UserId;
    const roleId= req.body.Role;
    const roleAssigned= User.assignRole(userId,roleId)
    if(roleAssigned){
      const users = await User.getUserList();
    const roles= await User.getRoles()
    console.log('roles')
    console.log(roles)
    const notifications=[createNotification("Success","Role is successfully assigned to user" , "bi-check-circle-fill")]
    // Render the users on the page with title and brand name
    res.render('displayUserList', {
                                  users,                      // User data
                                  roles,                      //Roles Data
                                  notifications,
                                  title: 'User List',          // Page title
                                  BRAND_NAME: process.env.BRAND_NAME, // Environment brand name
                                  layout: 'loggedInLayout'             // Layout to use
                                });
    }

  } catch (error) {
    
    const users = await User.getUserList();
    const roles= await User.getRoles()
    console.log('roles')
    console.log(roles)
    const notifications=[createNotification("Danger","Role is successfully assigned to user" , "bi-excalamation-triangle-fill")]
    // Render the users on the page with title and brand name
    res.render('displayUserList', {
                                  users,                      // User data
                                  roles,                      //Roles Data
                                  title: 'User List',          // Page title
                                  BRAND_NAME: process.env.BRAND_NAME, // Environment brand name
                                  layout: 'loggedInLayout'             // Layout to use
                                });
  }
}*/

const assignRole = async (req, res) => {
  try {
    const userId = req.body.UserId;
    const roleId = req.body.Role;
    const roleAssigned = await User.assignRole(userId, roleId);

    const notifications = roleAssigned
      ? [createNotification("Success", "Role successfully assigned to user", "bi-check-circle-fill")]
      : [createNotification("Warning", "No changes made. Role may already be assigned.", "bi-exclamation-circle-fill")];

    await renderUserListPage(res, notifications);
  } catch (error) {
    const notifications = [createNotification("Danger", "Failed to assign role: " + error.message, "bi-exclamation-triangle-fill")];
    await renderUserListPage(res, notifications);
  }
};
/**
 * 
 * @param {*} req 
 * @param {*} res 
 * 
 * user leave application system
 */
const applyLeavePage= async(req,res)=>{

  try {
    const leaveTypes= await User.getLeaveTypes();
    res.render('Leave/leaveApplication', {
      leaveTypes,
      title: 'Leave Application',          // Page title
      BRAND_NAME: process.env.BRAND_NAME, // Environment brand name
      layout: 'loggedInLayout'             // Layout to use
    });
  } catch (error) {
    
  }
}

const applyLeave= async(req,res)=>{

  try {
    //console.log(req);
    const { startDate, endDate, reason } = req.body;
    const leaveTypeId = Number(req.body.leaveTypeId);

    console.log(req.body)
    const userId = req.user.Id; // logged-in user
    const result=await User.applyLeave(startDate,endDate,reason,userId,leaveTypeId)
    const leaves= await User.getLeave(userId)
    console.log(leaves)
    res.render('Leave/myLeave', {
      title: 'My Leaves',  
      leaves,        // Page title
      moment,
      BRAND_NAME: process.env.BRAND_NAME, // Environment brand name
      layout: 'loggedInLayout'             // Layout to use
    });
  } catch (error) {
    
  }
}

const myLeavePage= async(req,res)=>{

  try {
    const userId= req.user.Id
    const leaves= await User.getLeave(userId)
    console.log(leaves)
    res.render('Leave/myLeave', {
      title: 'My Leaves',  
      leaves,        // Page title
      moment,
      BRAND_NAME: process.env.BRAND_NAME, // Environment brand name
      layout: 'loggedInLayout'             // Layout to use
    });
  } catch (error) {
    
  }
}

const LeaveReviewPageForAdmin= async(req,res)=>{

  try {

    console.log('i m in leave review page')
    const leaveRequests= await User.getUserLeaveRequests()
    console.log(leaveRequests);
    console.log('in ladmib leave request')
    res.render('Admin/Leave/leaveReview', {
      title: 'My Leaves',  
      leaveRequests,        // Page title
      moment,
      BRAND_NAME: process.env.BRAND_NAME, // Environment brand name
      layout: 'loggedInLayout'             // Layout to use
    });
    
  } catch (error) {
    
  }
}
const adminActionOnLeave= async(req,res)=>{

  try {
    let notifications=[]
    console.log(req.body)
    const { status, remarks } = req.body;
    const leaveId = req.params.Id;

    console.log('i m in adminAction on Leave.')
    const result= await User.actionOnLeave(status,remarks,leaveId)
    const leaveRequests= await User.getUserLeaveRequests()
    // Add success notification
    notifications = [
      createNotification("success", `Leave has been ${status} successfully.`, "bi-check-circle-fill"),
    ];

    res.render('Admin/Leave/leaveReview', {
      title: 'My Leaves',  
      leaveRequests,        // Page title
      moment,
      notifications,
      BRAND_NAME: process.env.BRAND_NAME, // Environment brand name
      layout: 'loggedInLayout'             // Layout to use
    });
  } catch (error) {
    console.log(error)
  }
}
//export all the function
module.exports = {
  getHomePage: getHomePage,
  getLoginPage: getLoginPage,
  getUserRegistrationPage: getUserRegistrationPage,
  registerUser: registerUser,
  login: login,
  getChangePasswordPage: getChangePasswordPage,
  changePassword: changePassword,
  postLogOut:postLogOut,
  getUserList:getUserList,
  getAssignAuthorisationPage:getAssignAuthorisationPage,
  authoriseAccess:authoriseAccess,
  removeAuthorisation:removeAuthorisation,
  assignRole:assignRole,
  applyLeavePage:applyLeavePage,
  applyLeave:applyLeave,
  myLeavePage:myLeavePage,
  LeaveReviewPageForAdmin:LeaveReviewPageForAdmin,
  adminActionOnLeave:adminActionOnLeave
};

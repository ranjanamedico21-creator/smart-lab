const express = require("express");
const router = express.Router();
const User = require("../models/User");
const UserController = require("../controllers/UserController");
//const validateUserData = require("../middleware/validateUserRegistrationInput")
const validateUserData = require("../middleware/validateUserRegistrationInput"); 

//redirect user to home page
router.get("/home", User.checkLoggedIn, UserController.getHomePage);

//redirect user to login page if he is not logged in
router.get("/login", User.checkLoggedOut, UserController.getLoginPage);

//registration
router.get("/registerUser", UserController.getUserRegistrationPage);

//registration process
router.post("/userRegistration",validateUserData, UserController.registerUser);

// Login
router.post("/login", UserController.login);

//logout
router.get("/logout", UserController.postLogOut);

//logout
router.get("/changePassword",User.checkLoggedIn, UserController.getChangePasswordPage);

//user list
router.get("/getUserList",User.checkLoggedIn,User.checkAuthorisation, UserController.getUserList);

//assign authorisation

router.get("/assignAuthorisation/:userId",User.checkLoggedIn,UserController.getAssignAuthorisationPage);

//change user password
router.post("/changePassword", User.checkLoggedIn,UserController.changePassword);

//give user access to new function
router.post("/authoriseAccess/:userId",User.checkLoggedIn,User.checkAdmin,UserController.authoriseAccess);

router.get("/removeAuthorisation/:userId/:functionId",User.checkLoggedIn,User.checkAdmin,UserController.removeAuthorisation);

router.get("/applyLeave",User.checkLoggedIn,UserController.applyLeavePage);

router.post("/applyLeave",User.checkLoggedIn,UserController.applyLeave);

router.post("/assignRole",UserController.assignRole);

router.get("/myLeave",User.checkLoggedIn,UserController.myLeavePage);

router.get("/adminLeaveReview",User.checkLoggedIn,UserController.LeaveReviewPageForAdmin);

router.post("/adminActionOnLeave/:Id",User.checkLoggedIn,UserController.adminActionOnLeave);

module.exports = router;

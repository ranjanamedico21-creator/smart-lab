const express = require("express");
const router = express.Router();
const User = require("../models/User");
const UserController = require("../controllers/UserController");
const LeaveController = require("../controllers/LeaveController");
const validateUserData = require("../middleware/validateUserRegistrationInput");

//redirect user to home page
router.get("/home", User.checkLoggedIn, UserController.getHomePage);

//redirect user to login page if he is not logged in
router.get("/login", User.checkLoggedOut, UserController.getLoginPage);

//registration
router.get("/registerUser", UserController.getUserRegistrationPage);

//registration process
router.post("/userRegistration", validateUserData, UserController.registerUser);

// Login
router.post("/login", UserController.login);

//logout
router.get("/logout", UserController.postLogOut);

//change password page
router.get("/changePassword", User.checkLoggedIn, UserController.getChangePasswordPage);

//change user password
router.post("/changePassword", User.checkLoggedIn, UserController.changePassword);

//user list
router.get("/getUserList", User.checkLoggedIn, User.checkAuthorisation, UserController.getUserList);

//assign authorisation
router.get("/assignAuthorisation/:userId", User.checkLoggedIn, User.checkAdmin, UserController.getAssignAuthorisationPage);

//give user access to new function
router.post("/authoriseAccess/:userId", User.checkLoggedIn, User.checkAdmin, UserController.authoriseAccess);

router.get("/removeAuthorisation/:userId/:functionId", User.checkLoggedIn, User.checkAdmin, UserController.removeAuthorisation);

// was open to anyone (no login check) — now admin only
router.post("/assignRole", User.checkLoggedIn, User.checkAdmin, UserController.assignRole);

router.post("/toggleStatus/:userId/:status", User.checkLoggedIn, User.checkAdmin, UserController.toggleUserStatus);

// ── Leave: staff ─────────────────────────────────────────────
router.get("/applyLeave", User.checkLoggedIn, LeaveController.applyLeavePage);
router.post("/applyLeave", User.checkLoggedIn, LeaveController.applyLeave);
router.get("/myLeaves", User.checkLoggedIn, LeaveController.myLeavePage);
router.get("/leaves/edit/:id", User.checkLoggedIn, LeaveController.editLeavePage);
router.post("/leaves/resubmit", User.checkLoggedIn, LeaveController.resubmitLeave);
router.post("/leaves/cancel", User.checkLoggedIn, LeaveController.cancelLeave);

// ── Leave: admin or authorised reviewer ──────────────────────
// checkAuthorisation lets admins through AND anyone given the
// '/leaveReview' and '/leaveAction' functions on the authorisation page.
router.get("/leaveReview", User.checkLoggedIn, User.checkAuthorisation, LeaveController.LeaveReviewPageForAdmin);
router.post("/leaveAction", User.checkLoggedIn, User.checkAuthorisation, LeaveController.adminActionOnLeave);

module.exports = router;
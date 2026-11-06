const express = require("express");
const router = express.Router();
const User = require("../models/User");
const ActivityController = require("../controllers/ActivityController")

//Category create  page
//router.get("/userActivity", User.checkLoggedIn,CategoryController.getCategoryRegistrationPage);

//By default redirect to home page
router.get("/userActivity", User.checkLoggedIn,User.checkAuthorisation,ActivityController.getUserActivity);

//router.get("/createDocumentCategory", User.checkLoggedIn,CategoryController.getCreateDocumentCategoryPage);

module.exports = router;

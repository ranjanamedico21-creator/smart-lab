const express = require("express");
const router = express.Router();
const User = require("../models/User");
const CategoryController= require("../controllers/CategoryController")

//By default redirect to home page
router.get("/", User.checkLoggedIn,CategoryController.getHomePage);


//Category create  page
router.get("/createCategory", User.checkLoggedIn,User.checkAuthorisation,CategoryController.getCategoryRegistrationPage);
//category registration process
router.post("/createCategory",User.checkLoggedIn,User.checkAuthorisation,CategoryController.createCategory);
//display all clinic with details
router.get("/getCategoryListView",User.checkLoggedIn,User.checkAuthorisation,CategoryController.getCategoryListView)
//edit category
router.get("/editCategory/:categoryId",User.checkLoggedIn,User.checkAuthorisation,CategoryController.getEditCategoryPage);
//update category
router.post("/updateCategory/:categoryId",User.checkLoggedIn,User.checkAuthorisation,CategoryController.updateCategory);

//create docume t category page
router.get("/createDocumentCategory", User.checkLoggedIn,User.checkAuthorisation,CategoryController.getCreateDocumentCategoryPage);
//register documet category to database
router.post("/createDocumentCategory", User.checkLoggedIn,User.checkAuthorisation,CategoryController.createDocumentCategory);
//get document category list
router.get("/getDocumentCategoryList", User.checkLoggedIn,User.checkAuthorisation,CategoryController.getDocumentCategoryList);
//get edit document category page
router.get("/editDocumentCategory/:documentCategoryId", User.checkLoggedIn,User.checkAuthorisation,CategoryController.editDcoumentCategoryPage);
//update document category
router.post("/updateDocumentCategory/:documentCategoryId", User.checkLoggedIn,User.checkAuthorisation,CategoryController.updateDocumentCategory);





//
//get update clinic details page
//router.get("/updateClinicDetails/:id", User.checkLoggedIn,ClinicController.getupdateClinicDetailsPage)

// update clinic details
//router.post("/updateClinicDetails",User.checkLoggedIn, ClinicController.updateClinicDetails)

//export router
module.exports = router;

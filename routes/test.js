const express = require("express");
const router = express.Router();
const User = require("../models/User");
const TestController= require("../controllers/TestController")

//Test Creation Page
router.get("/createTest",User.checkLoggedIn,User.checkAuthorisation,TestController.getTestRegistrationPage);

//get All the test list 
router.get("/getTestListView",User.checkLoggedIn,User.checkAuthorisation,TestController.getTestListView);

router.get("/editTest/:testId",User.checkLoggedIn,User.checkAuthorisation,TestController.editTest);

router.post("/updateTest/:testId",User.checkLoggedIn,User.checkAuthorisation,TestController.updateTest);

router.get("/makeTestActive",User.checkLoggedIn,User.checkAuthorisation,TestController.makeTestActive);

router.get("/makeTestInActive",User.checkLoggedIn,User.checkAuthorisation,TestController.makeTestInActive);

router.get("/attachTest",User.checkLoggedIn,User.checkAuthorisation,TestController.attachTest);

//insert test data in database
router.post("/registerTest",User.checkLoggedIn,User.checkAuthorisation,TestController.registerTest);

//search for particular test 
router.post("/getTestListView",User.checkLoggedIn,User.checkAuthorisation,TestController.getTestListView);

router.get("/downloadTestInExcel",User.checkLoggedIn,User.checkAuthorisation,TestController.downloadTestInExcel);


//router.post("/attachTest",User.checkLoggedIn,User.checkAuthorisation,TestController.attachSubTestToTest);

router.get("/registerSubTest",User.checkLoggedIn,User.checkAuthorisation,TestController.registerSubTest);

router.post("/registerSubTest",User.checkLoggedIn,User.checkAuthorisation,TestController.createSubTest);

router.get("/getSubTestListView",User.checkLoggedIn,User.checkAuthorisation,TestController.getSubTestListView);

router.get("/detachSubTest",User.checkLoggedIn,User.checkAuthorisation,TestController.detachSubTest);

router.get("/getSubParamaterView",TestController.getSubParamaterView);

router.get("/getSubParameterPage",TestController.getSubParameterPage);

router.get("/editSubTest",User.checkLoggedIn,User.checkAuthorisation,TestController.editSubTest);

router.post("/updateSubTest",User.checkLoggedIn,User.checkAuthorisation,TestController.updateSubTest);

router.post("/searchTest",User.checkLoggedIn,TestController.searchTestForUpdatingThanks);

router.post("/createSubparameter",TestController.createSubparameter);

router.get("/editSubParameter/:subParameterId",TestController.editSubParameter)

router.post("/editSubParameter",TestController.updateSubParameter)

router.get("/attachSubParameter/:testId/:categoryId",TestController.getAttachSubParameterPage)

router.post("/attachSubParameter/:testId",TestController.attachSubParameter)

router.get("/detachSubParameter/:testId/:subParameterId",TestController.detachSubParameter)




//registerSubTest



//export router
module.exports = router;
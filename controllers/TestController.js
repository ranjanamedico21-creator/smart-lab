const Category = require("../models/Category");
const Doctor = require("../models/Doctor");
const Test = require("../models/Test");
const ExcelJS = require('exceljs');
const fs = require('fs');


/**
 * 
 * @param {*} req 
 * @param {*} res 
 * if error comes then send user to home page with error notifications
 */
const renderHomeWithError = (res, error, customMessage = '') => {
  const notifications = [];  // Declare notifications array inside the function

  if(customMessage)
      notifications.push({
          type: 'danger', // Error notification type
          messages: customMessage,
          icon: 'bi-exclamation-triangle-fill' // Error icon
      });
  if(error)
      notifications.push({
          type: 'danger', // Error notification type
          messages: error,
          icon: 'bi-exclamation-triangle-fill' // Error icon
      });

  console.error("Error:", error); // Log the error stack for debugging
  
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
 * This will help us to get test registration Page
 */
let getTestRegistrationPage = async (req, res) => {
  let notifications = [];

  try {
      console.log("Fetching test registration page...");

      // Get categories
      let categories = await Category.getCategoryList() || [];
      let filmTypes= await Test.getFilmType()

      // If no categories exist, redirect
      if (categories.length === 0) {
          console.warn("No categories found. Redirecting...");
            renderHomeWithError(res,error) // Redirect to a meaningful page
      }

      // Render the test registration page
      res.render("createTest", {
          title: 'Create Test',
          filmTypes,
          categories,
          BRAND_NAME: process.env.BRAND_NAME,
          categories,
          layout: 'loggedInLayout'
      });

  } catch (error) {
      console.error("Error in getTestRegistrationPage:", error);
      // Render the page again with an error message
            renderHomeWithError(res,error) // Redirect to a meaningful page
  }
};


/**
 * 
 * @param {*} req 
 * @param {*} res 
 * to register test in database
 */

let registerTest = async (req, res) => {
  let notifications = [];

  try {
      console.log("Registering new test:", req.body);

      // Validate required fields
      if (!req.body.Name || !req.body.MainCategory) {
          throw new Error("Missing required test details.");
      }

      // Register the test
      let result = await Test.registerTest(req);

      // Fetch updated test details and categories
      let testDetails = await Test.getTestDetails() || [];
      let categories = await Category.getCategoryList() || [];

      // If no data is found, redirect instead of rendering an empty page
      if (categories.length === 0 && testDetails.length === 0) {
          console.warn("No categories or test details found. Redirecting...");
         // notifications.push(createNotification('danger','No categories or test details found. Redirected..','bi-exclamation-triangle-fill'))
          renderHomeWithError(res,'No categories or test details found. Redirected..')// Redirect to a meaningful page
      }

      // Success notification
      notifications.push(createNotification('success', result, 'bi-check-circle-fill'));

      // Render the updated view
      res.render("getTestListView", {
          notifications,
          categories,
          testDetails,
          title: 'Test List View',
          BRAND_NAME: process.env.BRAND_NAME,
          layout: 'loggedInLayout'
      });

  } catch (error) {
      console.error("Error in registerTest:", error);

      // Instead of rendering an empty page, send a JSON response or redirect
      renderHomeWithError(res,error)
  }
};


/**
 * 
 * @param {*} req 
 * @param {*} res 
 * ame method is used for getting test list and search the test 
 * it comes from 
 */

let getTestListView = async (req, res) => {
  let notifications = [];

  try {
      console.log("Fetching test list view with filters:", req.body);

      // Extract parameters with default values
      let categoryId = req.body.category || null;
      let testName = req.body.testName || "";
      let status = req.body.status || null;

      // Fetch test details and category list
      let testDetails = await Test.getSearchedTestDetails(req) || [];
      let categories = await Category.getCategoryList() || [];

      // If no data is found, redirect instead of rendering an empty page
      if (categories.length === 0 && testDetails.length === 0) {
          console.warn("No categories or test details found. Redirecting...");
          // Push error notification
     // notifications.push(createNotification('danger', 'No categories or test details found. Redirected', 'bi-exclamation-triangle-fill'));

      // Instead of rendering an empty page, send a JSON response or redirect
      renderHomeWithError(res,'No categories or test details found.') // Redirect to a meaningful page
      }

      // Render the test list view with fetched data
      res.render("getTestListView", {
          categoryId,
          testName,
          status,
          categories,
          testDetails,
          title: 'Test List View',
          BRAND_NAME: process.env.BRAND_NAME,
          layout: 'loggedInLayout'
      });

  } catch (error) {
      console.error("Error in getTestListView:", error)
      // Instead of rendering an empty page, send a JSON response or redirect
      renderHomeWithError(res,error)
  }
};

/**
 * 
 * @param {*} req 
 * @param {*} res 
 */
let makeTestActive = async (req, res) => {
  let notifications = [];

  try {
      console.log("Activating test, testId:", req.query.testId);

      // Validate testId
      if (!req.query.testId) {
          throw new Error("Missing testId in request.");
      }

      // Activate the test
      let result = await Test.makeTestActive(req.query.testId);
      
      // Fetch updated test details and categories
      let testDetails = await Test.getTestDetails(req) || [];
      let categories = await Category.getCategoryList() || [];

      // If there are no categories and no test details, redirect instead
      if (categories.length === 0 && testDetails.length === 0) {
          console.warn("No categories or test details found. Redirecting...");
           // Push error notification
      notifications.push(createNotification('danger', 'No categories or test details found. Redirected', 'bi-exclamation-triangle-fill'));
         // return res.redirect("/dashboard"); // Redirect to a meaningful page
         renderHomeWithError(res,'No categories or test details found.')// Redirect to a meaningful page
      }

      // Success notification
      notifications.push(createNotification('success', result, 'bi-check-circle-fill'));

      // Render the updated view
      res.render("getTestListView", {
          notifications,
          categories,
          testDetails,
          title: 'Test List View',
          BRAND_NAME: process.env.BRAND_NAME,
          layout: 'loggedInLayout'
      });

  } catch (error) {
      console.error("Error in makeTestActive:", error);

      // Instead of rendering an empty page, send a home response or redirect
      renderHomeWithError(res,error)
  }
};

/**
 * 
 * @param {*} req 
 * @param {*} res 
 */
let makeTestInActive = async (req, res) => {
  let notifications = [];

  try {
      console.log("Making test inactive, testId:", req.query.testId);

      // Validate testId
      if (!req.query.testId) {
          throw new Error("Missing testId in request.");
      }

      // Deactivate test
      let result = await Test.makeTestInActive(req.query.testId);
      
      // Fetch updated test details and categories
      let testDetails = await Test.getTestDetails(req) || [];
      let categories = await Category.getCategoryList() || [];

      // Success notification
      notifications.push(createNotification('success', result, 'bi-check-circle-fill'));

      // Render the updated view
      res.render("getTestListView", {
          notifications,
          categories,
          testDetails,
          title: 'Test List View',
          BRAND_NAME: process.env.BRAND_NAME,
          layout: 'loggedInLayout'
      });

  } catch (error) {
      console.error("Error in makeTestInActive:", error);
      // Re-render the home view with an error message
      renderHomeWithError(res,error)
  }
};
/**
 * 
 * @param {*} req 
 * @param {*} res 
 */
const editTest = async (req, res) => {
  try {
    const testId = req.params.testId;
    if (!testId) {
      throw new Error("Test Id is required.");
    }

    const testDetails = await Test.getIndividualTestDetails(testId);
    console.log(testDetails)
    if (!testDetails || Object.keys(testDetails).length === 0) {
      throw new Error(`No Test with test Id ${testId} found. Kindly retry.`);
    }

    // Get categories
    const categories = (await Category.getCategoryList())
    if (!categories || Object.keys(categories).length === 0) {
      throw new Error(`No categories found for test. Kindly retry.` );
    }
    const filmTypes= await Test.getFilmType();
      if(!filmTypes || filmTypes.length===0)
          throw new Error('Film types not found.')

    
    // Render the updated view
    res.render("editTest", {
      testDetails,
      testId,
      categories,
      filmTypes,
      title: "Edit Test View",
      BRAND_NAME: process.env.BRAND_NAME,
      layout: "loggedInLayout",
    });

  } catch (error) {
    console.error("Error in editTest:", error);
    renderHomeWithError(res, error.message || "An unexpected error occurred.");
  }
};


let attachTest = async (req, res) => {
  let notifications = [];

  try {
      console.log("Attaching test, received request:", req.body);

      // Validate testId
      if (!req.query.testId) {
          throw new Error("Missing testId in request.");
      }

      // Fetch test details
      let testDetails = await Test.getSelectedTestDetail(req.query.testId);
      let attachedTestLists = await Test.getAttachedTestlist(req.query.testId) || [];
      let testToBeAttahcedList = await Test.getAllUnattachedTestList(req.query.testId) || [];

      // Render page with data
      res.render("addSubTest", {
          attachedTestLists,
          testDetails,
          testToBeAttahcedList,
          title: "Add Sub Test List View",
          BRAND_NAME: process.env.BRAND_NAME,
          layout: "loggedInLayout"
      });
  } catch (error) {
      console.error("Error in attachTest:", error);
      renderHomeWithError(res,error)
  }
};


/*

let attachSubTestToTest = async(req,res)=>{
  let notifications=[]
    try {
     let message= await Test.attachSubTestToTest(req)
     notifications.push(createNotification('success',message,'bi-check-circle-fill'))
      let testDetails = await Test.getSelectedTestDetail(req.query.testId);
          console.log(testDetails)
            //console.log(testDetails)
          //show already attached test 
          let attachedTestLists= await Test.getAttachedTestlist(req.query.testId)
          //console.log(attachedTestLists)
          let testToBeAttahcedList= await Test.getAllUnattachedTestList(req.query.testId)
          //console.log(testToBeAttahcedList)
          res.render("addSubTest", {notifications,attachedTestLists,testDetails,testToBeAttahcedList,title:'Add Sub Test List View',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout' });
    } catch (error) {
        notifications.push(createNotification('danger',error,'bi-exclamation-triangle-fill'))
        renderHomeWithError(res,notifications)
    }
}
*/


let downloadTestInExcel = async (req, res) => {
    let notifications = [];

    try {
        console.log("Downloading test details in Excel...");

        // Assign query params to request body for consistent processing
        req.body.category = req.query.categoryId;
        req.body.status = req.query.status;

        let testDetails = await Test.getTestDetails(req);
        testDetails = testDetails || []; // Ensure it's always an array

        console.log(`Fetched ${testDetails.length} test records.`);

        // Create a new Excel workbook and worksheet
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Test Data');

        // Define columns in Excel (adjust as per your data)
        worksheet.columns = [
            { header: 'Category', key: 'Category', width: 30 },
            { header: 'Test Name', key: 'TestName', width: 30 },
            { header: 'Test Price', key: 'Price', width: 30 },
            { header: 'Status', key: 'Status', width: 30 }
        ];
        worksheet.getRow(1).font = { bold: true, size: 14 };
        // Add rows to the worksheet from testDetails
        testDetails.forEach(test => {
            worksheet.addRow({Category:test.Name, TestName: test.TestName, Price: test.Price ,Status:test.Status});
        });

        // Set HTTP headers for file download
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=Test_Details.xlsx');

        // Write workbook to response
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        console.error("Error generating Excel file:", error);
        // Send a JSON response with error details instead of calling an undefined function
        renderHomeWithError(res,error)
    }
};


/**
 * 
 * @param {*} req 
 * @param {*} res 
 */
let registerSubTest = async (req, res) => {
  let notifications = [];

  try {
      console.log("Fetching sub-test registration page...");

      // Get categories
      let categories = await Test.getTestCategories() || [];

      // If no categories exist, redirect
      if (categories.length === 0) {
          console.warn("No categories found. Redirecting...");
         // notifications.push(createNotification('danger',  Redirected', 'bi-exclamation-triangle-fill'));

      // Render the page again with an error message
      renderHomeWithError(res,'No categories found.') // Redirect to a meaningful page
      }

      // Render the sub-test registration page
      res.render('createSubTest', {
          categories,
          title: 'Create Sub Test List',
          BRAND_NAME: process.env.BRAND_NAME,
          layout: 'loggedInLayout'
      });

  } catch (error) {
      console.error("Error in registerSubTest:", error);

      // Render the page again with an error message
      renderHomeWithError(res,error)
  }
};

let createSubTest = async(req,res)=>{
  let notifications=[]
    try {
        let result= await Test.CreateSubTest(req);
              notifications.push(createNotification('success',result,'bi-check-circle-fill'))
        let SubTestLists= await Test.getSubTestList()
        res.render('getSubTestListView',{notifications,SubTestLists,title:'Sub Test List View',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout' })
    } catch (error) {
     // notifications.push(createNotification('danger',error,'bi-exclamation-triangle-fill'))
      renderHomeWithError(res,error)
    }
}
let getSubTestListView = async(req,res)=>{
let notifications=[]
  try {
    let SubTestLists= await Test.getSubTestList()
        res.render('getSubTestListView',{SubTestLists,title:'Sub Test List View',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout' })
  } catch (error) {
     // notifications.push(createNotification('danger',error,'bi-exclamation-triangle-fill'))
      renderHomeWithError(res,error)
  }
}

let detachSubTest= async(req,res)=>{
  let notifications=[]
  try {
    let message= await Test.detachSubTest(req)
    notifications.push(createNotification('success',message,'bi-check-circle-fill'))
     let testDetails = await Test.getSelectedTestDetail(req.query.testId);
         console.log(testDetails)
           //console.log(testDetails)
         //show already attached test 
         let attachedTestLists= await Test.getAttachedTestlist(req.query.testId)
         //console.log(attachedTestLists)
         let testToBeAttahcedList= await Test.getAllUnattachedTestList(req.query.testId)
         //console.log(testToBeAttahcedList)
         res.render("addSubTest", {notifications,attachedTestLists,testDetails,testToBeAttahcedList,title:'Add Sub Test List View',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout' });


  } catch (error) {
      //notifications.push(createNotification('danger',error,'bi-exclamation-triangle-fill'))
      renderHomeWithError(res,error)
  }
}

let editSubTest = async(req,res)=>{

  let notifications=[]
  try {
    let subTestDetails= await Test.getSubTestDetail(req.query.SubTestId);
    let categories= await Test.getTestCategories()
    res.render('createSubTest',{subTestDetails,categories,title:'Create Sub Test List',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout' })

  } catch (error) {
   // notifications.push(createNotification('danger',error,'bi-exclamation-triangle-fill'))
      renderHomeWithError(res,error)
  }
}

let updateSubTest =async(req,res)=>{
  let notifications=[]
    try {
      let message= await Test.updateSubTest(req);
      notifications.push(createNotification('success',message,'bi-check-circle-fill'))
      let SubTestLists= await Test.getSubTestList()
          res.render('getSubTestListView',{successes,SubTestLists,title:'Sub Test List View',BRAND_NAME:process.env.BRAND_NAME,layout: 'loggedInLayout' })
    
      
    } catch (error) {
      console.log(error)
     // notifications.push(createNotification('danger',error,'bi-exclamation-triangle-fill'))
      renderHomeWithError(res,error)
    }
  
}

let searchTestForUpdatingThanks =async(req,res)=>{
  let notifications=[]
  try {
    console.log('i m in ')
    let testDetails= await Test.searchTestForUpdatingThanks(req)
    console.log(testDetails)
    let doctorDetails = await Doctor.getDoctorDetail(req.body.doctorId)

    let categoryId= req.body.SelectDoctorThanksCategorySearch
    let searchedTest= req.body.searchTest

    console.log(doctorDetails);
    let categoryCommissionDetail= await Doctor.getCategoryWiseCommission(req.body.doctorId)

    console.log(categoryCommissionDetail);
    let testWiseCommissionDetails = await Doctor.getTestWiseCommissionDetails(req.body.doctorId)

    console.log(testWiseCommissionDetails)
    res.render('updateThanks',{categoryId,searchedTest,testDetails,doctorDetails,categoryCommissionDetail,testWiseCommissionDetails,title:'update Doctor thanks',BRAND_NAME:process.env.BRAND_NAME,layout:'loggedInLayout'})

  } catch (error) {
     // notifications.push(createNotification('danger',error,'bi-exclamation-triangle-fill'))
      renderHomeWithError(res,error)
  }
}

const getSubParameterPage= async(req,res)=>{

  const editMode= false;

  console.log('in the right place ')

  res.render('createSubParamaterForPathology',{editMode,title:'Create  Sub Paramater ',BRAND_NAME:process.env.BRAND_NAME,layout:'loggedInLayout'})
  //res.render('createSubParamaterForPathology',)
}//export all the function for global variable

const createSubparameter=async(req,res)=>{
  let notifications=[]
  try {
        await Test.createSubParameterForPathology(req.body)
        const SubParameterTestLists= await Test.getSubParameterDetail()
        const mappedSubParameterDetails=mapSabParameterDetails(SubParameterTestLists)

        res.render('getSubParameterView',{mappedSubParameterDetails,title:'sub parameter view',BRAND_NAME:process.env.BRAND_NAME,layout:'loggedInLayout'})
  } catch (error) {
     // notifications.push(createNotification('danger',error,'bi-exclamation-triangle-fill'))
      renderHomeWithError(res,error)
  }
}
const getSubParamaterView = async(req,res)=>{
  let notifications=[]
  try {

    const SubParameterTestLists= await Test.getSubParameterDetail()
    const mappedSubParameterDetails=mapSabParameterDetails(SubParameterTestLists)

    console.log(mappedSubParameterDetails)

    console.log('SubParameterTestLists');
    res.render('getSubParameterView',{mappedSubParameterDetails,title:'sub parameter view',BRAND_NAME:process.env.BRAND_NAME,layout:'loggedInLayout'})
  } catch (error) {
     // notifications.push(createNotification('danger',error,'bi-exclamation-triangle-fill'))
      renderHomeWithError(res,error)
  }
}

const mapSabParameterDetails = (subParameterList)=>{

  // Group the results by subparameter name

  console.log(subParameterList)
  const groupedSubparameters = subParameterList.reduce((acc, row) => {

    console.log(acc);
    console.log(row)
    const { SubParameterId, SubParameterName, Unit, Header, AgeMin, AgeMax, MinVal, MaxVal, Gender,AgeUnit } = row;
    
    if (!acc[SubParameterId]) {
      acc[SubParameterId] = {
        SubParameterId,
        SubParameterName,
        Unit,
        Header,
        Ranges: []
      };
    }

    acc[SubParameterId].Ranges.push({
      AgeMin, 
      AgeMax, 
      AgeUnit,
      MinVal, 
      MaxVal,
      Gender
    });

    return acc;
  }, {});

 return groupedSubparameters;
}

const editSubParameter= async(req,res)=>{
  let notifications=[]
  try {
    const subParameterId= req.params.subParameterId;
    const editMode=true
    const SubParameterTestLists=  await Test.getSubParameterDetail(true,subParameterId)
    const mappedSubParameterDetails=mapSabParameterDetails(SubParameterTestLists)

    console.log(mappedSubParameterDetails);
    res.render('createSubParamaterForPathology',{editMode,mappedSubParameterDetails,subParameterId,title:'sub parameter Edit view',BRAND_NAME:process.env.BRAND_NAME,layout:'loggedInLayout'})
  } catch (error) {
     // notifications.push(createNotification('danger',error,'bi-exclamation-triangle-fill'))
      renderHomeWithError(res,error)
  }
}

const updateSubParameter = async(req,res)=>{
  let notifications=[]
  try {
   const subParameterId= req.query.subId
    console.log(subParameterId);
    console.log('i m here')
    console.log(req.body)
    await Test.updateSubParameter(req.body,subParameterId)
    const SubParameterTestLists= await Test.getSubParameterDetail()
    const mappedSubParameterDetails=mapSabParameterDetails(SubParameterTestLists)

    console.log(mappedSubParameterDetails)

    console.log('SubParameterTestLists');
    res.render('getSubParameterView',{mappedSubParameterDetails,title:'sub parameter view',BRAND_NAME:process.env.BRAND_NAME,layout:'loggedInLayout'})
  } catch (error) {
    //notifications.push(createNotification('danger',error,'bi-exclamation-triangle-fill'))
      renderHomeWithError(res,error)
  }
}

const getAttachSubParameterPage= async(req,res)=>{

  let notifications=[]
  try {
        const testId= req.params.testId;
       // const categoryId= req.params.categoryId;
        const testData= await Test.getTestData(testId)

        console.log(testId);
      //  console.log(categoryId)

        console.log('in rig place')
        const attachedSubParameterLists= await Test.getAttachedSubParameterLists(testId)

        //console.log(attachedSubParameterLists)

//console.log('got to know')
        const unAttachedSubParameterLists= await Test.getUnAttachedSubParameterLists(testId)

        //console.log(unAttachedSubParameterLists);
        res.render('attachSubParameter',{testData,attachedSubParameterLists,unAttachedSubParameterLists,title:'Attach sub parameter ',BRAND_NAME:process.env.BRAND_NAME,layout:'loggedInLayout'})

  } catch (error) {
      //notifications.push(createNotification('danger',error,'bi-exclamation-triangle-fill'))
      renderHomeWithError(res,error)
  }
}
const attachSubParameter = async(req,res)=>{
let notifications=[];
  try {
    const testId= req.params.testId;
    const subParameter= req.body.subParameter;
    await Test.attachSubParameterToTest(testId,subParameter,req.user.Id)

    const testData= await Test.getTestData(testId)
    const attachedSubParameterLists= await Test.getAttachedSubParameterLists(testId)
    const unAttachedSubParameterLists= await Test.getUnAttachedSubParameterLists(testId)

    res.render('attachSubParameter',{testData,attachedSubParameterLists,unAttachedSubParameterLists,title:'Attach sub parameter ',BRAND_NAME:process.env.BRAND_NAME,layout:'loggedInLayout'})

  } catch (error) {
    //notifications.push(createNotification('danger',error,'bi-exclamation-triangle-fill'))
    renderHomeWithError(res,error)
  }
}

const detachSubParameter = async(req,res)=>{
   let notifications=[]

  try {
    const testId= req.params.testId;
    const subParameterId=req.params.subParameterId
   // console.log(testId);
   // console.log(subParameterId);
   // console.log('i m sexy s')
    await Test.detachSubParameterFromTest(testId,subParameterId)
    const testData= await Test.getTestData(testId)
    const attachedSubParameterLists= await Test.getAttachedSubParameterLists(testId)
    const unAttachedSubParameterLists= await Test.getUnAttachedSubParameterLists(testId)
 
    res.render('attachSubParameter',{testData,attachedSubParameterLists,unAttachedSubParameterLists,title:'Attach sub parameter ',BRAND_NAME:process.env.BRAND_NAME,layout:'loggedInLayout'})

  } catch (error) {
    //notifications.push(createNotification('danger',error,'bi-exclamation-triangle-fill'))
    renderHomeWithError(res,error)
  }
}

const updateTest= async(req,res)=>{
  let notifications=[]

  try {
    const message= await Test.updateTest(req);
          // Fetch updated test details and categories
      const testDetails = await Test.getTestDetails();
      const categories = await Category.getCategoryList() 

      // Success notification
      notifications.push(createNotification('success', message, 'bi-check-circle-fill'));

      // Render the updated view
      res.render("getTestListView", {
          notifications,
          categories,
          testDetails,
          title: 'Test List View',
          BRAND_NAME: process.env.BRAND_NAME,
          layout: 'loggedInLayout'
      });
  } catch (error) {
    console.log(error);
    renderHomeWithError(res,error)
  }
}

/**
 * 
 * @param {*} type 
 * @param {*} messages 
 * @param {*} icon 
 * @returns 
 */
// Centralized notification creation
const createNotification = (type, messages, icon, alertDismissible=true) => ({type,messages,icon,alertDismissible});

module.exports = {
  getTestRegistrationPage: getTestRegistrationPage,
  registerTest: registerTest,
  getTestListView: getTestListView,
  createSubTest:createSubTest,
  editTest:editTest,
  makeTestActive:makeTestActive,
  makeTestInActive:makeTestInActive,
  attachTest:attachTest,
  downloadTestInExcel:downloadTestInExcel,
  //attachSubTestToTest:attachSubTestToTest,
  registerSubTest:registerSubTest,
  createSubTest:createSubTest,
  getSubTestListView:getSubTestListView,
  detachSubTest:detachSubTest,
  editSubTest:editSubTest,
  updateSubTest:updateSubTest,
  searchTestForUpdatingThanks:searchTestForUpdatingThanks,
  getSubParameterPage:getSubParameterPage,
  createSubparameter:createSubparameter,
  getSubParamaterView:getSubParamaterView,
  editSubParameter:editSubParameter,
  updateSubParameter:updateSubParameter,
  getAttachSubParameterPage:getAttachSubParameterPage,
  attachSubParameter:attachSubParameter,
  detachSubParameter:detachSubParameter,
  updateTest:updateTest
};

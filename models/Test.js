//const { promiseImpl } = require("ejs");
//const { ConsoleMessage } = require("puppeteer");
const dbConnection = require("../config/DBConnection");
const currDateAndTime = require("../helper/helper");
const Doctor = require("./Doctor");
const mysql = require('mysql2'); // Ensure you have mysql2 package
const { connection } = require("../config/DBConnection");

let registerTest = async (req) => {
  const connection = await dbConnection.pool.getConnection();
  
  try {
    // Validate input data
    validateTestDetails(req.body);
    
    const date = currDateAndTime.getCurrentDateAndTime()[0];
    const testDetails = {
      TestName: req.body.Name,
      CategoryId: req.body.MainCategory,
      TimeTakenForReporting: req.body.TimeTakenForReporting,
      MinAmountOfBlood: req.body.MinAmountOfBlood,
      MaxAmountOfBlood: req.body.MaxAmountOfBlood,
      Description: req.body.Description,
      TestCreatedOn: date,
      ReportingDay: req.body.Day,
      ReportingTime: req.body.TimeTakenForReporting,
      TestCreatedBy: req.user.Id,
      Price: req.body.Price,
      Inversion: req.body.Inversion,
      MaleTemplate: req.body.templateForMale,
      FemaleTemplate: req.body.templateForFemale,
      Status: 1,
      IsReportRequired: req.body.reportRequired,
      FilmTypeId:req.body.FilmType,
      NoOfFilm:req.body.NoOfFilms,
      NoOfParameter:req.body.Parameter|| 0
    };

    await connection.beginTransaction();

    // Insert test details into the main test table
    const testId = await insertTestDetails(connection, testDetails);

    // Handle doctor commissions
    await handleDoctorCommissions(testDetails.CategoryId, testDetails.Price, testId, connection);

    // Commit the transaction
    await connection.commit();

    return "Test is successfully registered into the system.";
  } catch (error) {
    // Rollback the transaction in case of error
    if (connection) {
      await connection.rollback();
    }
    console.error("Transaction failed: ", error);
    throw error;
  } finally {
    // Ensure the connection is released even if an error occurs
    if (connection) {
      connection.release();
    }
  }
};

// Helper function to validate test details
const validateTestDetails = (details) => {
  const requiredFields = ['Name', 'MainCategory', 'TimeTakenForReporting', 'Price'];
  
  requiredFields.forEach(field => {
    if (!details[field]) {
      throw new Error(`Missing required field: ${field}`);
    }
  });
  
  // Further validation can be added here (e.g., data type checks)
};

// Helper function to insert test details into the database
const insertTestDetails = async (connection, testDetails) => {
  console.log(' i m here in insert tet')
  try {

    const insertQuery = connection.format("INSERT INTO MainTestTable SET ?", [testDetails]);
//console.log(query);  // This will print the actual SQL query being run
    const [result] = await connection.query("INSERT INTO MainTestTable SET ?", [testDetails]);
    
    if (result.affectedRows <= 0) {
      throw new Error("Test creation failed.");
    }
    
    return result.insertId; // Return the generated testId
  } catch (error) {
    console.error("Error inserting test details: ", error);
    throw error;
  }
};

// Helper function to handle doctor commissions
const handleDoctorCommissions = async (categoryId, testPrice, testId, connection) => {
  try {
    const doctors = await getAllDoctorCommissionRateBasedOnCategory(categoryId);

    // Process commissions concurrently using Promise.all
    const commissionPromises = doctors.map((doctor) => {
      const { DoctorId, CommissionRate } = doctor;
      const testCommission = (testPrice * CommissionRate) / 100;

      return insertDoctorTestCommission(DoctorId, testId, testCommission, connection);
    });

    const results = await Promise.all(commissionPromises);

    // Check if all commissions were successfully inserted
    if (results.includes(false)) {
      throw new Error('Some thanks failed to insert.');
    }
  } catch (error) {
    console.error("Error handling doctor thanks: ", error);
    throw error;
  }
};

// Helper function to insert doctor test commission into the database
let insertDoctorTestCommission = async (doctorId, testId, commission, connection) => {
  try {
    const [result] = await connection.execute(
      "INSERT INTO DoctorTestCommission (DoctorId, TestId, Commission) VALUES (?, ?, ?)",
      [doctorId, testId, commission]
    );

    if (result.affectedRows > 0) {
      return true;
    } else {
      throw new Error(`Failed to insert commission for Doctor ID ${doctorId}`);
    }
  } catch (error) {
    console.error(`Error inserting doctor commission: ${error.message}`);
    return false;
  }
};

/**
 * 
 * @returns object
 * This is to get all the film type existing in database like 8 * 10,10*12,14*17
 */
const getFilmType= async()=>{

  try {
    const [filmTypes]= await dbConnection.connection.promise().query('select * from FilmType')
    return filmTypes
  } catch (error) {
    console.log(error)
    throw error
  }
}
/**
 *
 * @param {*} req
 * @returns
 * This function is used in register patient view to get the test details.
 */
let getTestDetails = async ()=>{
    try {
      const query = `SELECT UPPER(MainTestTable.TestName) as TestName, MainTestTable.Price, MainTestTable.Status, 
                            MainTestTable.Id, MainTestTable.CategoryId, Category.Name
                            FROM MainTestTable
                            JOIN Category ON MainTestTable.CategoryId = Category.Id `

      const[test]= await dbConnection.connection.promise().execute(query)
      return test || [];
      
    } catch (error) {
      console.log(error)
      throw error
    }
  }

const getIndividualTestDetails= async(testId)=>{

  try {
    const [individualTestDetails]= await dbConnection.connection.promise().query('select * from MainTestTable where Id=?',[testId])
    return individualTestDetails[0]
  } catch (error) {
    console.log(error)
    throw error
  }
}
/**
 *
 * @param {*} req
 * @returns
 *
 * This function is used for search test in test list view
 */

const getSearchedTestDetails = (req) => {
  return new Promise((resolve, reject) => {
    try {
      const { category, testName, status } = req.body || {};
      let whereArr = [];
      let params = [];
      if (category && category != 0) {
        whereArr.push(`MainTestTable.CategoryId = ?`);
        params.push(category);
      }

      if (testName && testName.trim() !== "") {
        whereArr.push(`MainTestTable.TestName LIKE ?`);
        params.push(`%${testName}%`);
      }

      if (status && status != 0) {
        whereArr.push(`MainTestTable.Status = ?`);
        params.push(status);
      }

      const whereClause = whereArr.length > 0 ? `WHERE ${whereArr.join(" AND ")}` : "";

      console.log(whereClause)

      const query = `
        SELECT UPPER(MainTestTable.TestName) as TestName, MainTestTable.Price, MainTestTable.Status, 
        MainTestTable.Id, MainTestTable.CategoryId, Category.Name
        FROM MainTestTable
        JOIN Category ON MainTestTable.CategoryId = Category.Id
        ${whereClause}`;

        //console.log(query);

      dbConnection.connection.execute(query, params, (error, tests) => {
        if (error) {
          return reject(error);
        }
        resolve(tests);
      });
      
    } catch (error) {
      reject(error);
    }
  });
};



const  getPatientTestDetails = (patientId) => {
  return new Promise(async (resolve, reject) => {
    try {
      let sql =
        "select MainTestTable.IsReportRequired, MainTestTable.TestName,MainTestTable.Price,PatientTestRefference.TestId,PatientTestRefference.Discount from MainTestTable join PatientTestRefference on MainTestTable.Id= PatientTestRefference.TestId  Where PatientTestRefference.TestId   IN (select testId From PatientTestRefference where patientId=?) And PatientTestRefference.PatientId=? ";
      let c = dbConnection.connection.query(
        sql,
        [patientId, patientId],
        function (error, patientTestDetails) {
         // console.log(c.sql);
         // console.log(rows);
         if(error) throw error;
          if (patientTestDetails.length > 0) {
            resolve(patientTestDetails);
          }
        }
      );
    } catch (error) {
      reject(error);
    }
  });
  //select *,PatientTestRefference.Id,PatientTestRefference.ReportDeliveryTime,PatientTestRefference.ReportCreatedBy,PatientTestRefference.ReportDeliveredBy from `MainTestTable` ,`PatientTestRefference` Where MainTestTable.Id=PatientTestRefference.TestId and MainTestTable.Id IN (select testId From `PatientTestRefference` where patientId=1);
};

let makeTestActive = (testId) => {
  return new Promise(async (resolve, reject) => {
    try {
      let isTestExist = await checkTestExist(testId);
      if (isTestExist) {
        dbConnection.connection.query(
          "update MainTestTable set Status=1 where Id=?",
          testId,
          function (error, result) {
            if (error) throw error;
            if (result.affectedRows > 0)
              resolve("Test has been successfully updated as Active.");
          }
        );
      }
    } catch (error) {
      reject(error);
    }
  });
};

let makeTestInActive = (testId) => {
  return new Promise(async (resolve, reject) => {
    try {
      // testId=
      let isTestExist = await checkTestExist(testId);
      console.log(isTestExist);
      if (isTestExist) {
        dbConnection.connection.query(
          "update MainTestTable set Status=2 where Id=?",
          testId,
          function (error, result) {
           // console.log(z.sql);
            console.log(result);
            if (error) throw error;
            if (result.affectedRows > 0)
              resolve("Test has been successfully updated as InActive.");
          }
        );
      }
    } catch (error) {
      reject(error);
    }
  });
};

let checkTestExist = async (testId) => {
  return new Promise((resolve, reject) => {
    try {
      dbConnection.connection.query(
        "select Id from MainTestTable where Id=?",
        testId,
        function (error, result) {
         // console.log(x.sql);
          console.log(result);
          if (error) throw error;
          if (result.length > 0) resolve(true);
        }
      );
    } catch (error) {
      reject(false);
    }
  });
};

let getSubTestDetails = async() => {
 
    try {
      const query="select mainTestId,subTestId,Discount,Name,Price from  SubTestTable join MainTestSubTestReference on MainTestSubTestReference.subTestId=SubTestTable.Id";
      const [subTestDetails]= await dbConnection.connection.promise().query(query)
      return subTestDetails || []
    } catch (error) {
      console.log(error)
      throw error
    }
  }


let getTestCategories = async () => {
    try {
      const [testCategories]= await dbConnection.connection.promise().query("select Id,Name from Category");
      return testCategories || []
    } catch (error) {
      console.log(error);
      throw error;
      
    }
  }

let getAttachedTestlist = async(testId) => {

    try {
      const query="select SubTestTable.Id as subTestId,Name,Price,Discount from SubTestTable Join  MainTestSubTestReference on MainTestSubTestReference.SubTestId=SubTestTable.Id where MainTestSubTestReference.MainTestId=?"
      const [attachedTestLists] = await dbConnection.connection.promise().execute(query,[testId])
      return attachedTestLists || []
    } catch (error) {
      console.log(error);
      throw error
    }
  }

let getAllUnattachedTestList = (testId) => {
  return new Promise(async (resolve, reject) => {
    try {
        const testDetails= await getSelectedTestDetail(testId)
       // console.log(testDetails)
       // console.log('testDetails')
      /* console.log(mysql.format(`select SubTestTable.Id as SubTestId,CategoryId,ThanksAmount ,Discount,Price,SubTestTable.Name ,Category.Name as categoryName from SubTestTable JOIN Category on Category.Id=SubTestTable.CategoryId where SubTestTable.Id Not In(select SubTestId From MainTestSubTestReference where MainTestId=?) And SubTestTable.CategoryId=?;`,
       [testId,testDetails[0].CategoryId]))*/
       dbConnection.connection.execute(`select SubTestTable.Id as SubTestId,CategoryId,ThanksAmount ,Discount,Price,SubTestTable.Name ,Category.Name as categoryName from SubTestTable JOIN Category on Category.Id=SubTestTable.CategoryId where SubTestTable.Id Not In(select SubTestId From MainTestSubTestReference where MainTestId=?) And SubTestTable.CategoryId=?;`,
        [testId,testDetails[0].CategoryId],
        function (error, result) {
          //console.log(z.sql);
          if (error) throw error;
          if (result.length >= 0) resolve(result);
        }
      );
    } catch (error) {
      reject(error);
    }
  });
};

let getSelectedTestDetail = async (testId) => {
  return new Promise((resolve, reject) => {
    try {
      var z = dbConnection.connection.execute(
        "select * from MainTestTable where Id=?",[testId],
        function (error, result) {
          console.log(z.sql);
          if (error) throw error;
          if (result.length > 0) resolve(result);
        }
      );
    } catch (error) {
      reject(error);
    }
  });
};

let attachSubTestToTest = async (req) => {
  return new Promise(async (resolve, reject) => {
    try {
      var date = currDateAndTime.getCurrentDateAndTime()[0];
      let testId = parseInt(req.query.testId);
      let userId = req.user.Id;
      let subTestIds = JSON.parse(JSON.stringify(req.body)).subTest;
      //console.log(req.body)
      if (!Array.isArray(subTestIds)) {
        subTestIds = [subTestIds];
      }
   
     
      
      // Step 1: Create the array of values
      const values = subTestIds.map((subTestId) => [
        testId,
        subTestId,
        date,
        userId
      ]);
      
      console.log(values);
      
      // Step 2: Dynamically build the placeholders for each row
      const placeholders = values.map(() => '(?,?,?,?)').join(',');
      
      // Step 3: Flatten the values array
      const flattenedValues = values.flat();
      
      console.log("executing yuu:", mysql.format(
        `INSERT INTO MaintestSubTestReference (MainTestId, SubTestId, LinkedOn, LinkedBy) VALUES ${placeholders}`,
        flattenedValues
      ));
      
      console.log('I am in test sub test addition');
      
      // Step 4: Execute the query with the flattened values
      dbConnection.connection.execute(
        `INSERT INTO MaintestSubTestReference (MainTestId, SubTestId, LinkedOn, LinkedBy) VALUES ${placeholders}`,
        flattenedValues,
        function (error, rows) {
          if (error) throw error;
          if (rows.affectedRows > 0) {
            resolve("Test Attached Successfully");
          }
        }
      );
      
    } catch (error) {
      reject(error);
    }
  });
};


let CreateSubTest = async (req) => {
  const connection = await dbConnection.pool.getConnection(); // Establish connection
  try {
    // Begin transaction
    await connection.beginTransaction();

    // Define sub-test details
    const subTestDetails = {
      CategoryId: req.body.MainCategory,
      Discount: req.body.Discount,
      Name: req.body.Name,
      Price: req.body.Price,
      CreatedBy: req.user.Id,
      CreatedOn: currDateAndTime.getCurrentDateAndTime()[0],
      ThanksAmount: req.body.Thanks,
    };

    // Insert into SubTestTable
    const [result] = await connection.query(`INSERT INTO SubTestTable SET ?`, [subTestDetails]);
    const subTestId = result.insertId;  // Fetch the inserted sub-test ID

    console.log(`SubTest inserted with ID: ${subTestId}`);

    // Get doctors list
    const doctors = await Doctor.getDoctorList();

    // Insert commission for each doctor
    const commissionPromises = doctors.map((doctor) => {
      return insertDoctorSubTestCommission(
        doctor.Id,
        subTestId,
        subTestDetails.ThanksAmount,
        subTestDetails.CreatedOn,
        subTestDetails.CreatedBy,
        connection
      );
    });

    const commissionResults = await Promise.all(commissionPromises);

    // If any commission insertion failed, rollback transaction
    if (commissionResults.includes(false)) {
      throw new Error("Some commission entries failed. Rolling back transaction.");
    }

    // Commit transaction if all succeeded
    await connection.commit();
    console.log("SubTest and commissions inserted successfully.");
    
    return "Sub Test Created Successfully.";
  } catch (error) {
    // Rollback transaction in case of error
    console.error("Error creating sub-test: ", error.message);
    await connection.rollback();
    throw error;  // Propagate error to the calling function
  } finally {
    // Release connection in any case
    connection.release();
  }
};

// Helper function to insert doctor commission
let insertDoctorSubTestCommission = async (doctorId, subTestId, thanks, registeredOn, registeredBy, connection) => {
  try {
    console.log(
      `Inserting commission for Doctor ID: ${doctorId} and SubTest ID: ${subTestId}`
    );

    const [result] = await connection.execute(
      `INSERT INTO DoctorSubTestCommission (DoctorId, SubTestId, Thanks, RegisteredOn, ModifiedBy) 
      VALUES (?, ?, ?, ?, ?)`,
      [doctorId, subTestId, thanks, registeredOn, registeredBy]
    );

    if (result.affectedRows > 0) {
      return true;
    } else {
      throw new Error(`Failed to insert commission for Doctor ID ${doctorId}`);
    }
  } catch (error) {
    console.error(`Error inserting commission for Doctor ID ${doctorId}: ${error.message}`);
    return false;
  }
};

let getSubTestList = async () => {
  return new Promise((resolve, reject) => {
    try {
      dbConnection.connection.execute(
        "select SubTestTable.Id as SubTestId,CategoryId,ThanksAmount ,Discount,Price,SubTestTable.Name ,Category.Name as categoryName from SubTestTable JOIN Category on Category.Id=SubTestTable.CategoryId;",
        function (error, result) {
          if (error) throw error;
          if (result.length > 0) resolve(result);
        }
      );
    } catch (error) {
      reject(error);
    }
  });
};



let detachSubTest = async (req) => {
  return new Promise((resolve, reject) => {
    try {
      console.log("in delete test");
      var k = dbConnection.connection.execute(
        `delete from MainTestSubTestReference where MainTestId=? And SubTestId=?`,
        [req.query.testId, req.query.subTestId],
        function (error, result) {
          console.log(k.sql);
          if (error) throw error;

          console.log(result);
          if (result.affectedRows > 0)
            resolve("Sub Test Detached From Test Successfully.");
        }
      );
    } catch (error) {
      reject(
        "Sub Test did not Detach From Test Successfully.Some Error occured."
      );
    }
  });
};


let getSubTestDetail = async (subTestId) => {
  return new Promise((resolve, reject) => {
    try {
      dbConnection.connection.execute(
        "select * From SubTestTable where Id= ?",
        [subTestId],
        function (error, subTestDetail) {
         // console.log(z.sql);
          if (error) throw error;
          if (subTestDetail.length >= 0) resolve(subTestDetail);
        }
      );
    } catch (error) {
      reject(error);
    }
  });
};


let updateSubTest = async (req) => {
  return new Promise((resolve, reject) => {
    try {
      let subTestDetails = {
        CategoryId: req.body.MainCategory,
        Discount: req.body.Discount,
        Name: req.body.Name,
        Price: req.body.Price,
        CreatedBy: req.user.Id,
        CreatedOn: currDateAndTime.getCurrentDateAndTime()[0],
        ThanksAmount: req.body.Thanks,
      };
      let subTestId = req.query.subTestId;
      var z = dbConnection.connection.execute(
        `update SubTestTable set ? where Id=?`,
        [subTestDetails, subTestId],
        function (error, result) {
          console.log(z.sql);
          if (error) throw error;
          if (result.affectedRows >= 1)
            resolve("Sub test updated successfully.");
        }
      );
    } catch (error) {
      reject("Due to some error,sub test can not be edited.Kindly try again.");
    }
  });
};


let getAllDoctorCommissionRateBasedOnCategory = async (categoryId) => {
  return new Promise((resolve, reject) => {
    try {
      var x = dbConnection.connection.execute(
        "SELECT DoctorId, CommissionRate FROM DoctorCategoryCommission WHERE CategoryId = ?",
        [categoryId],
        function (error, result) {
          //console.log(x.sql)
          console.log(result);
          if (error) throw error;
          if (result.length >= 0) return resolve(result);
        }
      );
    } catch (error) {
      reject(error);
    }
  });
};




let getPatientSubTestDetail = async(patientId)=>{
  return new Promise((resolve,reject)=>{
    try { 
      dbConnection.connection.execute(
              `SELECT 
              psr.Id AS PatientSubTestRefId,
              psr.SubTestId,
              psr.PatientId,
              st.Id AS SubTestId,
              st.Price,
              st.Discount,
              st.Name As TestName
          FROM 
              PatientSubTestRefference psr
              
          INNER JOIN 
              subTestTable st 
          ON 
              psr.SubTestId = st.Id
          WHERE 
              psr.PatientId = ?`,
        [patientId],
        function (error, patientSubTestDetail){
          if (error) throw error;
          if (patientSubTestDetail.length >= 0) return resolve(patientSubTestDetail);
        });
    } catch (error) {
        reject(error)
    }

  })
}

const searchTestForUpdatingThanks = async (req) => {

  return new Promise((resolve,reject)=>{

    try {
      // Extract doctorId, categoryId, and testName from req (assuming they are part of the request body)
      const { doctorId,SelectDoctorThanksCategorySearch:categoryId,searchTest:testName } = req.body;
   
      // Define the query to retrieve the test details and commission
      const testSearchQuery = `
        SELECT 
          mt.TestName,
          mt.Id, 
          dtc.Commission 
        FROM 
          DoctorTestCommission dtc
        JOIN 
          MainTestTable mt 
          ON dtc.TestId = mt.Id 
        WHERE 
          mt.CategoryId = ?  
        AND 
          mt.TestName LIKE ?
        AND 
          dtc.DoctorId = ?`;
  
      // Set the values to be used in the query
      const values = [categoryId, `%${testName}%`, doctorId];
      console.log('Executing Query in search:', mysql.format(testSearchQuery,values));
  
      //  searchTest doctorId
  
      // Execute the query using dbConnection (assuming connection is properly set up)
       dbConnection.connection.execute(testSearchQuery,values,function(error,searchedTestResult){
        if(error)
          throw error
          resolve(searchedTestResult)

      });
    } catch (error) {
      // Handle any errors and rethrow them so they can be caught by the caller
     reject(`Error retrieving test details: ${error.message}`);
    }

  })
  
  
};

const createSubParameterForPathology = async (dataObject) => {
  const connection = await dbConnection.pool.getConnection();
  try {
    await connection.beginTransaction();

    const { subParameter, unit, subParameterHeader, age_min } = dataObject;

    const sqlInsertSubParameter = `INSERT INTO TestSubParametersForPathology (SubParameterName, Unit, Header) VALUES (?, ?, ?)`;
    const [subParamResult] = await connection.execute(sqlInsertSubParameter, [subParameter, unit, subParameterHeader]);

    const subParameterId = subParamResult.insertId;

    await changeSubParameterRanges(connection, dataObject, age_min, subParameterId);

    await connection.commit();
    console.log("Transaction committed successfully");

  } catch (error) {
    console.error("Transaction failed, rolling back:", error);
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const getSubParameterDetail = async (isItEdit = false, subParameterId = null) => {
  try {
    let query = `
      SELECT 
        sp.Id AS SubParameterId, sp.SubParameterName, sp.Unit,sp.Header,
        sr.AgeMin, sr.AgeMax, sr.MinVal, sr.MaxVal, sr.Gender,sr.AgeUnit
      FROM TestSubParametersForPathology sp
      LEFT JOIN SubParameterRanges sr ON sp.Id = sr.SubParameterId
    `;

    if (isItEdit && subParameterId) {
      query += ' WHERE sp.Id = ?';
    }

    console.log(query)
    const [subParameterList] = await dbConnection.connection.promise().query(query, isItEdit ? [subParameterId] : []);
    return subParameterList;
  } catch (error) {
    console.log(error);
    throw error;
  }
};

const updateSubParameter = async (dataObject, subParameterId) => {
  const connection = await dbConnection.pool.getConnection();
  try {
    const { subParameter, unit, subParameterHeader, age_min } = dataObject;
    await connection.beginTransaction();

    let updateQuery = 'UPDATE TestSubParametersForPathology SET SubParameterName = ?, Unit = ?, Header = ? WHERE Id = ?';
    console.log(mysql.format(updateQuery, [subParameter, unit, subParameterHeader, subParameterId]));
    await connection.execute(updateQuery, [subParameter, unit, subParameterHeader, subParameterId]);

    // Uncomment and define deleteQuery if needed
    let deleteQuery=`delete from SubParameterRanges where SubParameterId=?`
     await connection.execute(deleteQuery, [subParameterId]);

    await changeSubParameterRanges(connection, dataObject, age_min, subParameterId);
    await connection.commit();
  } catch (error) {
    console.log(error);
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const changeSubParameterRanges = async (connection, dataObject, age_min, subParameterId) => {
  try {
    const { age_max, min_value, max_value, gender ,age_unit } = dataObject;

    // Validate that all arrays are of the same length
    if (age_min.length !== age_max.length || age_min.length !== min_value.length || age_min.length !== max_value.length || age_min.length !== gender.length) {
      throw new Error('Input arrays must have the same length');
    }

    const ranges = age_min.map((_, index) => [
      subParameterId,
      age_min[index],
      age_max[index],
      age_unit[index],
      min_value[index],
      max_value[index],
      gender[index],
    ]);
    
    const sqlInsertRanges = `INSERT INTO SubParameterRanges (SubParameterId, AgeMin, AgeMax,AgeUnit, MinVal, MaxVal, Gender) VALUES ?`;
   // console.log(mysql.format(sqlInsertRanges,[ranges]));
    //connection.release()
    await connection.query(sqlInsertRanges, [ranges]);
  } catch (error) {
    console.error("Failed to change subparameter ranges:", error);
    throw error;
  }
};

const getAttachedSubParameterLists = async(testId)=>{
  try {
     let query = `select * from PathoTestLinkedWithParameters JOIN TestSubParametersForPathology 
                  ON PathoTestLinkedWithParameters.SubParameterId = TestSubParametersForPathology.Id JOIN MainTestTable ON
                  MainTestTable.Id=  PathoTestLinkedWithParameters.TestId where 
                  PathoTestLinkedWithParameters.TestId=?`
         const [result]  =  await dbConnection.connection.promise().execute(query,[testId])
          return result
  } catch (error) {
     throw error
  }
}


const getUnAttachedSubParameterLists = async (testId) => {
  try {
    const query = `
                  SELECT * 
                  FROM TestSubParametersForPathology 
                  WHERE TestSubParametersForPathology.Id NOT IN (
                      SELECT SubParameterId 
                      FROM PathoTestLinkedWithParameters 
                      WHERE PathoTestLinkedWithParameters.TestId = ?)`

    console.log(mysql.format(query, [testId])); // Debug logging
    const [unAttachedParameterList] = await dbConnection.connection.promise().execute(query, [testId]);
    return unAttachedParameterList || []
  } catch (error) {
    console.error("Error in getUnAttachedSubParameterLists:", error); // Detailed error logging
    throw error;
  }
};


const getTestData =async(testId)=>{
  try {
       const [testData]= await dbConnection.connection.promise().execute('select * from MainTestTable where Id=?',[testId])
       return testData || []
  } catch (error) {
      throw error
  }
}

const attachSubParameterToTest = async (testId, subParameter, userId) => {
  try {
    let query = `INSERT INTO PathoTestLinkedWithParameters (TestId, SubParameterId, LinkedBy) VALUES ?`;
    
    // Map through subParameter and create an array of arrays with the required values
    const data = subParameter.map((param) => [testId, param, userId]);

    // Execute the query with prepared data array
    await dbConnection.connection.promise().query(query, [data]);

    // Log for debugging
    console.log('Data inserted:', data);
  } catch (error) {
    console.error('Error inserting data:', error);
    throw error;
  }
};


const detachSubParameterFromTest= async(testId,subParameterId)=>{
  try {
    let query=`Delete from PathoTestLinkedWithParameters where TestId=? And SubParameterId=?`
    console.log(mysql.format(query,[testId,subParameterId]))
    await dbConnection.connection.promise().execute(query,[testId,subParameterId])
  } catch (error) {
    throw error
  }
}

//const mysql = require("mysql2"); // Ensure you have mysql2 imported

const updateTest = async (req) => {
  const connection = await dbConnection.pool.getConnection(); // Fix: Await the connection
  try {
    const testDetails = {
      TestName: req.body.Name,
      CategoryId: req.body.MainCategory,
      TimeTakenForReporting: req.body.TimeTakenForReporting,
      MinAmountOfBlood: req.body.MinAmountOfBlood,
      MaxAmountOfBlood: req.body.MaxAmountOfBlood,
      Description: req.body.Description,
      ReportingDay: req.body.Day,
      ReportingTime: req.body.TimeTakenForReporting,
      Price: req.body.Price,
      Inversion: req.body.Inversion,
      MaleTemplate: req.body.templateForMale,
      FemaleTemplate: req.body.templateForFemale,
      Status: 1,
      IsReportRequired: req.body.reportRequired,
      FilmTypeId: req.body.FilmType,
      NoOfFilm: req.body.NoOfFilms,
      NoOfParameter: req.body.Parameter,
    };



    const testId = req.params.testId;
    if (!testId) {
      throw new Error("Test ID is required");
    }

    await connection.beginTransaction();
   // console.log(mysql.query("UPDATE MainTestTable SET ? WHERE Id = ?", [testDetails, testId]))

    const [result] = await connection.query("UPDATE MainTestTable SET ? WHERE Id = ?", [testDetails, testId]);

    if (result.affectedRows === 0) {
      throw new Error("No record updated. Invalid test ID?");
    }

    await connection.commit(); // Fix: Commit the transaction
    return "Test updated successfully."
  } catch (error) {
    console.error("Error updating test details:", error);
    await connection.rollback(); // Fix: Rollback only on error
    throw error
  } finally {
    connection.release(); // Fix: Ensure connection is released
  }
};

// Function to get pathology report data

//export all the function
module.exports = {
  registerTest: registerTest,
  getTestDetails: getTestDetails,
  getPatientTestDetails: getPatientTestDetails,
  makeTestActive: makeTestActive,
  makeTestInActive: makeTestInActive,
  getSubTestDetails: getSubTestDetails,
  getTestCategories: getTestCategories,
  getAttachedTestlist: getAttachedTestlist,
  getAllUnattachedTestList: getAllUnattachedTestList,
  getSelectedTestDetail: getSelectedTestDetail,
  attachSubTestToTest: attachSubTestToTest,
  CreateSubTest: CreateSubTest,
  getSubTestList: getSubTestList,
  detachSubTest: detachSubTest,
  getSubTestDetail: getSubTestDetail,
  updateSubTest: updateSubTest,
  getSearchedTestDetails:getSearchedTestDetails,
  getPatientSubTestDetail:getPatientSubTestDetail,
  searchTestForUpdatingThanks:searchTestForUpdatingThanks,
  createSubParameterForPathology:createSubParameterForPathology,
  getSubParameterDetail:getSubParameterDetail,
  updateSubParameter:updateSubParameter,
  getAttachedSubParameterLists:getAttachedSubParameterLists,
  getUnAttachedSubParameterLists:getUnAttachedSubParameterLists,
  getTestData:getTestData,
  attachSubParameterToTest:attachSubParameterToTest,
  detachSubParameterFromTest:detachSubParameterFromTest,
  getIndividualTestDetails:getIndividualTestDetails,
  getFilmType:getFilmType,
  updateTest:updateTest
  //getdataForPathologyReport:getdataForPathologyReport
  
};

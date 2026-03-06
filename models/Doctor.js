const { ConsoleMessage } = require("puppeteer");
const dbConnection = require("../config/DBConnection");
const currDateAndTime = require("../helper/helper");
const Category = require("../models/Category");
const mysql = require("mysql2"); // Ensure you have mysql2 package
const moment= require('moment');

const registerDoctor = async (req) => {
  const connection = await dbConnection.pool.getConnection();
  try {
    console.log("Registering doctor...");
    console.log(req.body);

    // Validate input
    const errors = validateUserInput(req);
    console.log(errors);
    if (errors.length > 0) {
      throw new Error(errors.map((err) => err.msg).join("; "));
    }

    // Extract visiting schedule
    const { days, startTimes, endTimes, area } = req.body;

    console.log(days);

    // Get current date and time
    const currDate = currDateAndTime.getCurrentDateAndTime()[0];

    // Prepare doctor details
    const doctorDetails = {
      FirstName: req.body.firstName,
      LastName: req.body.lastName,
      Degree1: req.body.degree1,
      Degree2: req.body.degree2,
      Degree3: req.body.degree3,
      Degree4: req.body.degree4,
      SpecialistIn: req.body.specialistIn,
      WorkedAt: req.body.workedAt,
      YearOfExperience: req.body.yearOfExperience,
      Registration: req.body.registration,
      CreatedOn: currDate,
      CreatedBy: req.user.Id,
      AuthorizedForBloodTest: req.body.authorizeForBloodTest,
      Award: req.body.award,
      Instruction: req.body.instruction,
      FlatDiscount: req.body.flatDiscount,
      MobileNumberFirst: req.body.mobileNumberFirst,
      MobileNumberSecond: req.body.mobileNumberSecond,
    };
    console.log(doctorDetails);
    // Begin transaction
    await connection.beginTransaction();

    // Insert doctor details
    console.log(
      mysql.format("INSERT INTO DoctorDetails SET ?", [doctorDetails])
    );
    const [insertDoctorResult] = await connection.query(
      "INSERT INTO DoctorDetails SET ?",
      [doctorDetails]
    );

    console.log(insertDoctorResult);
    if (insertDoctorResult.affectedRows === 0) {
      throw new Error("Failed to insert DoctorDetails.");
    }

    const doctorId = insertDoctorResult.insertId;

    console.log(doctorId);

    // Parse and insert thanksDetails
    const categories = await Category.getCategoryList();
    //const thanksDetailsCategoryWise = JSON.parse(req.body.thanksDetails);
    let commissionValues = []; /*categories.map((thanksDetail) => [
      doctorId,
      thanksDetail.Id,
      req.body.tha.thanks,
      currDate,
      currDate,
      req.user.Id,
    ]);*/

    // Loop through categories dynamically and check req.body
    categories.forEach((category) => {
      if (req.body[category.Name]) {
        // Check if this category exists in req.body
        commissionValues.push([
          doctorId,
          category.Id, // Get category ID
          req.body[category.Name], // Get value from req.body dynamically
          currDate,
          currDate,
          req.user.Id,
        ]);
      }
    });

    console.log(commissionValues);
    console.log("i m in commission values");

    const commissionSql =
      "INSERT INTO DoctorCategoryCommission (DoctorId, CategoryId, CommissionRate, CreatedAt, UpdatedAt, CreatedBy) VALUES ?";

    console.log(mysql.format(commissionSql, [commissionValues]));
    const [insertCommissionResult] = await connection.query(commissionSql, [
      commissionValues,
    ]);
    if (insertCommissionResult.affectedRows === 0) {
      throw new Error("Failed to insert DoctorCategoryCommission.");
    }
    console.log(mysql.format(commissionSql, [commissionValues]));
    // Fetch commissions for the doctor
    const [commissionRows] = await connection.query(
      "SELECT * FROM DoctorCategoryCommission WHERE DoctorId = ?",
      [doctorId]
    );
    if (commissionRows.length === 0) {
      throw new Error("No categories found for the doctor.");
    }
    console.log(commissionRows);
    // Insert test commissions
    for (const row of commissionRows) {
      const { CategoryId, CommissionRate } = row;

      console.log(row);
      console.log("i m in wo");

      // Fetch tests for the category
      const [testRows] = await connection.query(
        "SELECT Id, Price FROM MainTestTable WHERE CategoryId = ?",
        [CategoryId]
      );
      console.log(testRows);
      if (testRows.length > 0) {
        const testCommissions = testRows.map((test) => [
          doctorId,
          test.Id,
          (test.Price * CommissionRate) / 100,
        ]);

        const testCommissionSql =
          "INSERT INTO DoctorTestCommission (DoctorId, TestId, Commission) VALUES ?";

        console.log(mysql.format(testCommissionSql, [testCommissions]));
        const [testCommissionInserted] = await connection.query(
          testCommissionSql,
          [testCommissions]
        );
        if (testCommissionInserted.affectedRows === 0) {
          throw new Error("Failed to insert test commissions.");
        }
      }
    }

    // Validate and insert visiting schedule
    const visitingSchedule = days.map((day, i) => {
      if (
        new Date(`1970-01-01T${startTimes[i]}:00Z`) >=
        new Date(`1970-01-01T${endTimes[i]}:00Z`)
      ) {
        throw new Error(`Start time must be before end time for ${day}.`);
      }
      return [doctorId, day, startTimes[i], endTimes[i], area[i]];
    });
    console.log("in testing mode");
    const scheduleSql =
      "INSERT INTO DoctorVisitingSchedule (DoctorId, DayOfWeek, StartTime, EndTime,Area) VALUES ?";

    console.log(mysql.format(scheduleSql, [visitingSchedule]));
    const [insertScheduleResult] = await connection.query(scheduleSql, [
      visitingSchedule,
    ]);
    if (insertScheduleResult.affectedRows === 0) {
      throw new Error("Failed to insert Doctor Visiting Schedule.");
    }

    // Commit transaction
    await connection.commit();
    console.log("Doctor registered successfully.");
    return "Doctor is successfully registered into the system.";
  } catch (error) {
    // Rollback transaction on error
    if (connection) await connection.rollback();
    console.error("Error registering doctor:", error.message);
    throw new Error(error.message || "Transaction failed.");
  } finally {
    // Always release connection
    if (connection) connection.release();
  }
};

// Validation Function
const validateUserInput = (req) => {
  const errors = [];

  // Check required fields

  //!req.body.firstName ||
  //     !req.body.lastName ||
  //     !req.body.degree1 ||
  //     !req.body.specialistIn ||
  //     !req.body.workedAt ||
  //     !req.body.yearOfExperience ||
  //     !req.body.authorizeForBloodTest ||
  //     !req.body.instruction ||
  //     !req.body.degree2 ||
  //     !req.body.degree3 ||
  //     !req.body.degree4
  const requiredFields = [
    "firstName",
    "lastName",
    "degree1",
    "degree2",
    "degree3",
    "degree4",
    "specialistIn",
    "workedAt",
    "yearOfExperience",
    "authorizeForBloodTest",
    "days",
    "area",
    "startTimes",
    "endTimes",
  ];
  for (const field of requiredFields) {
    if (!req.body[field]) {
      errors.push({ msg: `Field '${field}' is required.` });
    }
  }

  // Validate schedule input
  const { days, startTimes, endTimes } = req.body;
  if (days && startTimes && endTimes) {
    if (days.length !== startTimes.length || days.length !== endTimes.length) {
      errors.push({
        msg: "Schedule data is inconsistent. Ensure days, start times, and end times match.",
      });
    }
  }

  return errors;
};

let getDoctorList = async () => {
  try {
    let sql = "select * from DoctorDetails order by Id desc";
    const [doctors] = await dbConnection.connection.promise().query(sql);
    return doctors;
  } catch (error) {
    throw error;
  }
};

let getdoctorListNotattachedToclinic = async (clinicId) => {
  try {
    let sql =
      "select * from DoctorDetails where Id NOT IN (select DoctorId as Id from ClinicAndDoctorAssociation where ClinicId=?) order by Id desc";
    const [unAttachedDoctors] = await dbConnection.connection
      .promise()
      .query(sql, clinicId);
    return unAttachedDoctors;
  } catch (error) {
    throw error;
  }
};

let getAttachedDoctorList = async (clinicId) => {
  try {
    const [attachedDoctorList] = await dbConnection.connection
      .promise()
      .query(
        "select * from DoctorDetails where Id IN( select doctorId as Id from ClinicAndDoctorAssociation where  ClinicId= ?)",
        [clinicId]
      );
    return attachedDoctorList;
  } catch (error) {
    throw error;
  }
};
let getDoctorDetail = async (doctorId) => {
  try {
    const [doctorDetails] = await dbConnection.connection
      .promise()
      .query("select * from DoctorDetails Where Id =?", [doctorId]);
    return doctorDetails[0];
  } catch (error) {
    throw error;
  }
};

let getCategoryWiseCommission = async (doctorId) => {
  try {
    const [CategoryCommission] = await dbConnection.connection
      .promise()
      .query(
        "select Category.Id, Name,CommissionRate from Category Join DoctorCategoryCommission on DoctorCategoryCommission.categoryId = Category.Id where DoctorCategoryCommission.DoctorId =?",
        [doctorId]
      );
    return CategoryCommission;
  } catch (error) {
    throw error;
  }
};

let getTestWiseCommissionDetails = async (doctorId) => {
  try {
    const [testWiseCommission] = await dbConnection.connection
      .promise()
      .query(
        `select MainTestTable.Id as TestId,TestName,Commission From MainTestTable Join DoctorTestCommission on DoctorTestCommission.TestId = MainTestTable.Id where DoctorTestCommission.doctorId=?`,
        [doctorId]
      );
    return testWiseCommission[0];
  } catch (error) {
    throw error;
  }
};
/**
 * update category Commission
 * update category matched test commission
 */
const updateThanks = async (req) => {
  const connection = await dbConnection.pool.getConnection();
  const {
    doctorThanksCategory: categoryId,
    doctorId,
    doctorCategoryThanks: commissionRate,
  } = req.body;

  try {
    await connection.beginTransaction();
    await connection.execute(
      "UPDATE DoctorCategoryCommission SET CommissionRate = ? WHERE DoctorId = ? AND CategoryId = ?",
      [commissionRate, doctorId, categoryId]
    );
    await connection.execute(
      `UPDATE DoctorTestCommission AS dtc
       JOIN MainTestTable AS t ON dtc.TestId = t.Id
       SET dtc.Commission = (t.price * ? / 100)
       WHERE dtc.DoctorId = ? AND t.categoryId = ?`,
      [commissionRate, doctorId, categoryId]
    );

    // Commit the transaction if everything is successful
    await connection.commit();
    return "Thanks updated successfully.";
  } catch (error) {
    // Rollback the transaction in case of an error
    await connection.rollback();
    throw error;
  } finally {
    // Ensure the connection is released back to the pool
    connection.release();
  }
};

const updateDoctorsThankTestWise = async (req) => {
  const selectedTests = req.body.selectedTests; // Array of selected test IDs

  //console.log(selectedTests)

  //console.log('seelcted test')
  const doctorId = req.body.doctorId;
  const updatedThanks = {};

  // Iterate over selected tests and collect the new "Thanks" values
  if (Array.isArray(selectedTests)) {
    selectedTests.forEach((testId) => {
      const newThanksValue = req.body[`newThanks_${testId}`];
      if (newThanksValue) {
        updatedThanks[testId] = newThanksValue; // Store the new value in the object
      }
    });
  }

  console.log(updatedThanks);
  console.log("i m here in up");
  // Prepare SQL query for updating each selected test
  const updatePromises = [];
  for (const testId in updatedThanks) {
    const newThanksValue = updatedThanks[testId];
    // Update the 'commission' or 'thanks' column for each selected test
    const query = `UPDATE DoctorTestCommission SET Commission = ? WHERE TestId = ? AND DoctorId=?`;

    // Execute the query for each test (asynchronous operation)
    updatePromises.push(
      dbConnection.connection.execute(query, [newThanksValue, testId, doctorId])
    );
  }

  try {
    console.log(updatePromises);
    // Execute all queries asynchronously
    await Promise.all(updatePromises);

    // On success, send a success response or redirect to a success page
    //res.send('Thanks values updated successfully!');
    return "Thanks values updated successfully!";
  } catch (error) {
    // console.error('Error updating tests:', error);
    // Handle the error, send a failure response, or show an error message
    return "An error occurred while updating the data.";
  }
};

const getDoctorWiseThanks = async (FromDate,ToDate,doctorId) => {
  const connection = await dbConnection.pool.getConnection();
  try {
    
    // SQL Query
    let doctorThanksQuery = `SELECT 
                                    DoctorDetails.FirstName, 
                                    DoctorDetails.LastName, 
                                    Referrals.DoctorId, 
                                    Referrals.PatientId, 
                                    SUM(Referrals.Thanks) AS Thanks 
                                  FROM 
                                    Referrals 
                                  JOIN 
                                    DoctorDetails 
                                  ON 
                                    Referrals.DoctorId = DoctorDetails.Id
                                  WHERE 
                                    Referrals.RegisteredOn BETWEEN ? AND ?`;

    // Query parameters
    const queryParams = [FromDate, ToDate];

    // Add Doctor filter if provided
    if (doctorId) {
      doctorThanksQuery += ` AND DoctorDetails.Id = ?`;
      queryParams.push(doctorId);
    }

    // Group by DoctorId
    doctorThanksQuery += ` GROUP BY Referrals.DoctorId`;
    console.log("Executing query:", mysql.format(doctorThanksQuery, queryParams));

    // Execute the query
    const [results] = await connection.execute(doctorThanksQuery, queryParams);
    return  results ;

  } catch (error) {
    console.error("Error executing query:", error.message);
    throw error;
  } finally {
    if (connection) connection.release();
  }
};


const getIndividualDoctorThanks = async (req) => {
  const connection = await dbConnection.pool.getConnection();
  try {
    // Fetch data from the url
    const doctorId = req.query.doctorId;
   // const defaultDate= moment().format('YYYY-MM-DD')
   const defaultDate = moment().format('YYYY-MM-DD'); // Current date in YYYY-MM-DD
   
         // Extract and format FromDate & ToDate
         let FromDate = req?.query?.FromDate ? moment(req.query.FromDate, 'DD-MM-YYYY').format('YYYY-MM-DD') : defaultDate;
         let ToDate = req?.query?.ToDate ? moment(req.query.ToDate, 'DD-MM-YYYY').format('YYYY-MM-DD') : defaultDate;
        if (moment(FromDate).isAfter(moment(ToDate))) {
                 throw new Error('Start Date cannot be after End Date.');
             }
    // Fetch data from the database
    const query = `SELECT 
                            p.Name, 
                            p.Age,
                            P.Gender,
                            P.YMD,
                            P.Discount,
                            P.DuesAmount,
                            p.RegisteredOn, 
                            P.GrossAmount, 
                            d.FirstName AS DoctorFirstName, 
                            d.LastName AS DoctorLastName,
                            d.Degree1,
                            d.Degree2,
                            d.Degree3,
                            d.Degree4,
                            d.SpecialistIn,
                            d.WorkedAt,
                            -- Subquery to calculate the distinct total thanks per doctor
                            (
                                SELECT SUM(DISTINCT r.Thanks)
                                FROM Referrals r
                                WHERE r.DoctorId = d.Id AND r.PatientId = p.Id
                            ) AS TotalThanks,
                            -- Concatenate all tests for the patient
                            GROUP_CONCAT(DISTINCT mt.TestName ORDER BY mt.TestName ASC SEPARATOR ', ') AS TestNames,
                            -- Concatenate all subtests for the patient, grouped by test
                            GROUP_CONCAT(DISTINCT stt.Name ORDER BY stt.Name ASC SEPARATOR ', ') AS SubTestNames,
                            P.Discount
                        FROM 
                            PatientDetails p
                        JOIN 
                            DoctorDetails d ON p.DoctorId = d.Id
                        JOIN 
                            PatientTestRefference ptr ON ptr.PatientId = p.Id
                        JOIN
                            MainTestTable mt ON mt.Id = ptr.TestId
                        LEFT JOIN 
                            PatientSubTestRefference pst ON pst.PatientId = p.Id
                        LEFT JOIN 
                            MainTestSubTestReference mtst ON mtst.MainTestId = mt.Id
                        LEFT JOIN
                            SubTestTable stt ON stt.Id = pst.SubtestId AND mtst.SubTestId = stt.Id
                        WHERE
                            d.Id = ? AND 
                            P.RegisteredOn BETWEEN ? AND ?
                        GROUP BY
                            p.Name, p.Age, P.Gender, P.YMD, p.RegisteredOn, P.GrossAmount, d.FirstName, d.LastName, d.Degree1, d.Degree2, d.Degree3, d.Degree4, d.SpecialistIn, d.WorkedAt, P.Discount;`
    console.log( "execting com query:",mysql.format(query, [doctorId, FromDate, ToDate]));

    const [doctorsCommissionDetails] = await connection.execute(query, [doctorId,FromDate,ToDate,
    ]);
    return doctorsCommissionDetails;
  } catch (error) {
    throw error;
  } finally {
    connection.release();
  }
};

const downloadAllDoctorThanks = async (req) => {
  const connection = await dbConnection.pool.getConnection();
  try {
    const defaultDate= moment().format('YYYY-MM-DD')
     // Extract and format FromDate & ToDate
          let FromDate = req?.query?.FromDate ? moment(req.body.FromDate, 'DD-MM-YYYY').format('YYYY-MM-DD') : defaultDate;
          let ToDate = req?.query?.ToDate ? moment(req.body.ToDate, 'DD-MM-YYYY').format('YYYY-MM-DD') : defaultDate;
          let query = `SELECT 
                        p.Name, 
                        p.Age,
                        p.Gender,
                        p.YMD,
                        p.RegisteredOn,
                        p.Discount,
                        p.DuesAmount,
                        P.GrossAmount, 
                        d.FirstName AS DoctorFirstName, 
                        d.LastName AS DoctorLastName,
                        d.Id As doctorId,
                        d.Degree1,
                        d.Degree2,
                        d.Degree3,
                        d.Degree4,
                        d.SpecialistIn,
                        d.WorkedAt,
                        -- Subquery to calculate the distinct total thanks per doctor
                        (
                            SELECT r.Thanks
                            FROM Referrals r
                            WHERE r.DoctorId = d.Id AND r.PatientId = p.Id
                        )AS Thanks ,
                        -- Concatenate all tests for the patient
                        GROUP_CONCAT(DISTINCT mt.TestName ORDER BY mt.TestName ASC SEPARATOR ', ') AS TestNames,
                        -- Concatenate all subtests for the patient, grouped by test
                        GROUP_CONCAT(DISTINCT stt.Name ORDER BY stt.Name ASC SEPARATOR ', ') AS SubTestNames,
                        P.Discount
                    FROM 
                        PatientDetails p
                    JOIN 
                        DoctorDetails d ON p.DoctorId = d.Id
                    JOIN 
                        PatientTestRefference ptr ON ptr.PatientId = p.Id
                    JOIN
                        MainTestTable mt ON mt.Id = ptr.TestId
                    LEFT JOIN 
                        PatientSubTestRefference pst ON pst.PatientId = p.Id
                    LEFT JOIN 
                        MainTestSubTestReference mtst ON mtst.MainTestId = mt.Id
                    LEFT JOIN
                        SubTestTable stt ON stt.Id = pst.SubtestId AND mtst.SubTestId = stt.Id
                    WHERE 
                        P.Status=1 AND
                        P.RegisteredOn BETWEEN ? AND ?
                    GROUP BY
                        p.Name, p.Age, P.Gender, P.YMD, p.RegisteredOn, P.GrossAmount, d.FirstName, d.LastName, d.Degree1, d.Degree2, d.Degree3, d.Degree4, d.SpecialistIn, d.WorkedAt, P.Discount`;

    console.log(mysql.format(query, [FromDate, ToDate]));
    const [doctorsCommissionDetails] = await connection.execute(query, [FromDate,ToDate]);
    return doctorsCommissionDetails;
  } catch (error) {
    throw error;
  } finally {
    connection.release();
  }
};
/**
 *
 * @param {*} doctorId
 * @returns visting Schedule of a particular doctor
 */
const getVisitingSchedule = async (doctorId) => {
  try {
    // Define the query
    const visitingScheduleQuery =
      "SELECT * FROM DoctorVisitingSchedule WHERE DoctorId = ?";

    // Execute the query and get results
    const [visitingSchedule] = await dbConnection.connection
      .promise()
      .execute(visitingScheduleQuery, [doctorId]);

    // Return the visiting schedule
    return visitingSchedule;
  } catch (error) {
    // Log the error for debugging purposes
    console.error(
      `Error fetching visiting schedule for DoctorId ${doctorId}:`,
      error
    );

    // Rethrow the error so it can be handled by the caller if needed
    throw new Error(
      "Failed to fetch visiting schedule. Please try again later."
    );
  }
};
const getDoctorName = async (doctorId) => {
  const result = await dbConnection.connection.promise().query(
      "SELECT CONCAT(FirstName, ' ', LastName) AS DoctorName FROM DoctorDetails WHERE Id = ?",
      [doctorId]
    );
  return result.length ? result[0].DoctorName : `Unknown (${doctorId})`;
};
/**
 *
 * @param {*} patientId
 * called from cancelPatient In Patient model
 */
const setThanksToZero = async (patientId) => {
  try {
    console.log( mysql.format("UPDATE Referrals SET Thanks=? Where PatientId=?", [0, patientId,])
    );
    console.log("i m in set thanks to zero to test");
    await dbConnection.connection.promise().query("UPDATE Referrals SET Thanks=? Where PatientId=?", [0, patientId]);
  } catch (error) {
    console.log(error);
    throw error;
  }
};
/**
 *
 * @param {*} doctorId
 * @returns  object
 * used to edit doctor detail commission
 */
const getDoctorsCategoryWiseThanks = async (doctorId) => {
  try {
    const [rows] = await dbConnection.connection.promise().query("select * from DoctorCategoryCommission where DoctorId=?", [
        doctorId,
      ]);
    return rows;
  } catch (error) {
    console.log(error);
    throw error;
  }
};
/**
 *
 * @param {*} doctorId
 * @returns object
 * used of edit doctor
 */
const getDoctorVisitingSchedule = async (doctorId) => {
  try {
    const [rows] = await dbConnection.connection
      .promise()
      .query("select * from DoctorVisitingSchedule where DoctorId=?", [
        doctorId,
      ]);
    return rows;
  } catch (error) {
    console.log(error);
    throw error;
  }
};

/*const updateDoctor = async (req) => {
  let notifications = [];
  const connection = await dbConnection.pool.getConnection();
  try {
    console.log("update doctor...");
    console.log(req.body);
    console.log("req.body");

    // Validate input
    const errors = validateUserInput(req);
    console.log(errors);
    if (errors.length > 0) {
      throw new Error(errors.map((err) => err.msg).join("; "));
    }

    // Extract visiting schedule
    const { days, startTimes, endTimes, area } = req.body;

    console.log(days);

    // Prepare doctor details
    const doctorDetails = {
      FirstName: req.body.firstName,
      LastName: req.body.lastName,
      Degree1: req.body.degree1,
      Degree2: req.body.degree2,
      Degree3: req.body.degree3,
      Degree4: req.body.degree4,
      SpecialistIn: req.body.specialistIn,
      WorkedAt: req.body.workedAt,
      YearOfExperience: req.body.yearOfExperience,
      Registration: req.body.registration,
      // CreatedOn: currDate,
      CreatedBy: req.user.Id,
      AuthorizedForBloodTest: req.body.authorizeForBloodTest,
      Award: req.body.award,
      Instruction: req.body.instruction,
      FlatDiscount: req.body.flatDiscount,
      MobileNumberFirst: req.body.mobileNumberFirst,
      MobileNumberSecond: req.body.mobileNumberSecond,
    };

    console.log(doctorDetails);
    console.log("update doctor details");
    // Begin transaction
    await connection.beginTransaction();

    // update doctor details
    // **Fix: Properly construct the UPDATE query**
    const updateQuery = `UPDATE DoctorDetails 
                      SET FirstName = ?, LastName = ?, Degree1 = ?, Degree2 = ?, Degree3 = ?, Degree4 = ?, 
                          SpecialistIn = ?, WorkedAt = ?, YearOfExperience = ?, Registration = ?, CreatedBy = ?, 
                          AuthorizedForBloodTest = ?, Award = ?, Instruction = ?, FlatDiscount = ?, 
                          MobileNumberFirst = ?, MobileNumberSecond = ? 
                      WHERE DoctorId = ?
                    `;

    // **Prepare values in the correct order**
    const values = [
      doctorDetails.FirstName,
      doctorDetails.LastName,
      doctorDetails.Degree1,
      doctorDetails.Degree2,
      doctorDetails.Degree3,
      doctorDetails.Degree4,
      doctorDetails.SpecialistIn,
      doctorDetails.WorkedAt,
      doctorDetails.YearOfExperience,
      doctorDetails.Registration,
      doctorDetails.CreatedBy,
      doctorDetails.AuthorizedForBloodTest,
      doctorDetails.Award,
      doctorDetails.Instruction,
      doctorDetails.FlatDiscount,
      doctorDetails.MobileNumberFirst,
      doctorDetails.MobileNumberSecond,
      doctorId,
    ];
    // Execute query
    console.log("Executing Query:", mysql.format(updateQuery, values));
    console.log("update doctor details query");
    const [updateDoctorResult] = await connection.query(updateQuery, values);

    // Get all categories
const categories = await Category.getCategoryList();
let commissionValues = [];

// Loop through categories dynamically and check req.body
categories.forEach((category) => {
  if (req.body[category.Name]) {  
    commissionValues.push({
      categoryId: category.Id, // Assuming `Id` is the primary key of Category
      commissionRate: req.body[category.Name], // Commission rate from form
      updatedAt: currDate,
      updatedBy: req.user.Id
    });
  }
});

console.log("Commission Values:", commissionValues);
console.log("I am in commission values");

// **Step 1: Get existing commission rates**
const [existingCommissions] = await connection.query(
  "SELECT CategoryId, CommissionRate FROM DoctorCategoryCommission WHERE DoctorId = ?",
  [doctorId]
);

const existingCommissionSet = new Set(existingCommissions.map(c => `${c.CategoryId}-${c.CommissionRate}`));
const newCommissionSet = new Set(commissionValues.map(c => `${c.categoryId}-${c.commissionRate}`));

// **Step 2: Identify commissions to delete**
const commissionsToDelete = existingCommissions.filter(c => 
  !newCommissionSet.has(`${c.CategoryId}-${c.CommissionRate}`)
);

// **Step 3: Identify commissions to insert or update**
const commissionsToUpsert = commissionValues.filter(c => 
  !existingCommissionSet.has(`${c.categoryId}-${c.commissionRate}`)
);

// **Step 4: Perform Delete**
if (commissionsToDelete.length > 0) {
  for (const commission of commissionsToDelete) {
    await connection.query(
      "DELETE FROM DoctorCategoryCommission WHERE DoctorId = ? AND CategoryId = ?",
      [doctorId, commission.CategoryId]
    );
  }
  console.log("Deleted old commissions:", commissionsToDelete);
}

// **Step 5: Perform Insert or Update**
for (const commission of commissionsToUpsert) {
  await connection.query(
    `INSERT INTO DoctorCategoryCommission (DoctorId, CategoryId, CommissionRate,CreatedAt, UpdatedAt, CreatedBy)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE CommissionRate = VALUES(CommissionRate), UpdatedAt = VALUES(UpdatedAt), UpdatedBy = VALUES(UpdatedBy)`,
    [doctorId, commission.categoryId, commission.commissionRate,commission.updatedAt, commission.updatedAt, commission.updatedBy]
  );
}
console.log("Doctor commission rates updated successfully.");

  //  console.log(mysql.format(commissionSql, [commissionValues]));
    // Fetch commissions for the doctor
    const [commissionRows] = await connection.query(
      "SELECT * FROM DoctorCategoryCommission WHERE DoctorId = ?",
      [doctorId]
    );
    if (commissionRows.length === 0) {
      throw new Error("No categories found for the doctor.");
    }
    console.log(commissionRows);
    // Insert test commissions
    for (const row of commissionRows) {
      const { CategoryId, CommissionRate } = row;

      console.log(row);
      console.log("i m in wo");

      // Fetch tests for the category
      const [testRows] = await connection.query(
        "SELECT Id, Price FROM MainTestTable WHERE CategoryId = ?",
        [CategoryId]
      );
      console.log(testRows);
      if (testRows.length > 0) {
        const testCommissions = testRows.map((test) => [
          doctorId,
          test.Id,
          (test.Price * CommissionRate) / 100,
        ]);

        const testCommissionSql =
          "INSERT INTO DoctorTestCommission (DoctorId, TestId, Commission) VALUES ?";

        console.log(mysql.format(testCommissionSql, [testCommissions]));
        const [testCommissionInserted] = await connection.query(
          testCommissionSql,
          [testCommissions]
        );
        if (testCommissionInserted.affectedRows === 0) {
          throw new Error("Failed to insert test commissions.");
        }
      }
    }

    // Validate and prepare visiting schedule
    const visitingSchedule = days.map((day, i) => {
      if (
        new Date(`1970-01-01T${startTimes[i]}:00Z`) >=
        new Date(`1970-01-01T${endTimes[i]}:00Z`)
      ) {
        throw new Error(`Start time must be before end time for ${day}.`);
      }
      return {
        doctorId: doctorId,
        dayOfWeek: day,
        startTime: startTimes[i],
        endTime: endTimes[i],
        area: area[i],
      };
    });

    console.log("In testing mode");

    // **Step 1: Get existing schedules from DB**
    const [existingSchedules] = await connection.query(
      "SELECT DayOfWeek, StartTime, EndTime, Area FROM DoctorVisitingSchedule WHERE DoctorId = ?",
      [doctorId]
    );

    const existingSet = new Set(
      existingSchedules.map(
        (s) => `${s.DayOfWeek}-${s.StartTime}-${s.EndTime}-${s.Area}`
      )
    );
    const newSet = new Set(
      visitingSchedule.map(
        (s) => `${s.dayOfWeek}-${s.startTime}-${s.endTime}-${s.area}`
      )
    );

    // **Step 2: Identify schedules to delete**
    const schedulesToDelete = existingSchedules.filter(
      (s) => !newSet.has(`${s.DayOfWeek}-${s.StartTime}-${s.EndTime}-${s.Area}`)
    );

    // **Step 3: Identify schedules to insert**
    const schedulesToInsert = visitingSchedule.filter(
      (s) =>
        !existingSet.has(`${s.dayOfWeek}-${s.startTime}-${s.endTime}-${s.area}`)
    );

    // **Step 4: Perform Delete**
    if (schedulesToDelete.length > 0) {
      for (const schedule of schedulesToDelete) {
        await connection.query(
          "DELETE FROM DoctorVisitingSchedule WHERE DoctorId = ? AND DayOfWeek = ? AND StartTime = ? AND EndTime = ? AND Area = ?",
          [
            doctorId,
            schedule.DayOfWeek,
            schedule.StartTime,
            schedule.EndTime,
            schedule.Area,
          ]
        );
      }
      console.log("Deleted old schedules:", schedulesToDelete);
    }

    // **Step 5: Perform Insert**
    if (schedulesToInsert.length > 0) {
      const insertSql = `
    INSERT INTO DoctorVisitingSchedule (DoctorId, DayOfWeek, StartTime, EndTime, Area) 
    VALUES ?
  `;
      const insertValues = schedulesToInsert.map((s) => [
        s.doctorId,
        s.dayOfWeek,
        s.startTime,
        s.endTime,
        s.area,
      ]);

      await connection.query(insertSql, [insertValues]);
      console.log("Inserted new schedules:", schedulesToInsert);
    }

    console.log("Doctor visiting schedule updated successfully.");

    // Commit transaction
    await connection.commit();
    console.log("Doctor updated successfully.");
    return "Doctor is successfully updated into the system.";
  } catch (error) {}
};*/

const updateDoctor = async (req) => {
  let notifications = [];
  const connection = await dbConnection.pool.getConnection();
  
  try {
    console.log("Updating doctor...");
    
    // Extract doctorId
    const doctorId = req.params.doctorId;
    if (!doctorId) throw new Error("Doctor ID is required.");

    console.log("Received Data:", req.body);

    // Validate input
    const errors = validateUserInput(req);
    if (errors.length > 0) {
      throw new Error(errors.map((err) => err.msg).join("; "));
    }

    // Begin transaction
    await connection.beginTransaction();

    // ✅ **1. Update Doctor Details**
    const doctorDetails = {
      FirstName: req.body.firstName,
      LastName: req.body.lastName,
      Degree1: req.body.degree1,
      Degree2: req.body.degree2,
      Degree3: req.body.degree3,
      Degree4: req.body.degree4,
      SpecialistIn: req.body.specialistIn,
      WorkedAt: req.body.workedAt,
      YearOfExperience: req.body.yearOfExperience,
      Registration: req.body.registration,
      AuthorizedForBloodTest: req.body.authorizeForBloodTest,
      Award: req.body.award,
      Instruction: req.body.instruction,
      FlatDiscount: req.body.flatDiscount,
      MobileNumberFirst: req.body.mobileNumberFirst,
      MobileNumberSecond: req.body.mobileNumberSecond,
    };

    const updateQuery = `UPDATE DoctorDetails SET ?  WHERE Id = ?`;
    await connection.query(updateQuery, [doctorDetails, doctorId]);
    console.log("Doctor details updated.");

    // ✅ **2. Update Category Commissions**
    const categories = await Category.getCategoryList();
    let commissionValues = categories
      .filter((category) => req.body[category.Name])
      .map((category) => [
        doctorId,
        category.Id,
        req.body[category.Name],
        new Date(),
        req.user.Id,
      ]);

    if (commissionValues.length > 0) {
      const commissionSql = `INSERT 
                                  INTO DoctorCategoryCommission (DoctorId, CategoryId, CommissionRate, UpdatedAt, UpdatedBy)
                                  VALUES ?
                                  ON DUPLICATE KEY UPDATE 
                                    CommissionRate = VALUES(CommissionRate), 
                                    UpdatedAt = VALUES(UpdatedAt), 
                                    CreatedBy = VALUES(UpdatedBy)
                                `;
      await connection.query(commissionSql, [commissionValues]);
      console.log("Doctor commission rates updated.");
    }

    // ✅ **3. Update Test Commissions**
    const [commissionRows] = await connection.query(
      "SELECT CategoryId, CommissionRate FROM DoctorCategoryCommission WHERE DoctorId = ?",
      [doctorId]
    );

    if (commissionRows.length === 0) {
      throw new Error("No categories found for the doctor.");
    }

    for (const row of commissionRows) {
      const { CategoryId, CommissionRate } = row;

      const [testRows] = await connection.query(
        "SELECT Id, Price FROM MainTestTable WHERE CategoryId = ?",
        [CategoryId]
      );

      if (testRows.length > 0) {
        const testCommissions = testRows.map((test) => [
          doctorId,
          test.Id,
          (test.Price * CommissionRate) / 100,
        ]);

        const testCommissionSql = `INSERT INTO DoctorTestCommission (DoctorId, TestId, Commission) 
                                    VALUES ? 
                                    ON DUPLICATE KEY UPDATE Commission = VALUES(Commission)
                                  `;
        await connection.query(testCommissionSql, [testCommissions]);
      }
    }
    console.log("Doctor test commissions updated.");

    // ✅ **4. Update Visiting Schedule**
    const { days, startTimes, endTimes, area } = req.body;

    const visitingSchedule = days.map((day, i) => {
      if (
        new Date(`1970-01-01T${startTimes[i]}:00Z`) >=
        new Date(`1970-01-01T${endTimes[i]}:00Z`)
      ) {
        throw new Error(`Start time must be before end time for ${day}.`);
      }
      return [doctorId, day, startTimes[i], endTimes[i], area[i]];
    });

    // **Delete schedules that are not in the new request**
    await connection.query(
      "DELETE FROM DoctorVisitingSchedule WHERE DoctorId = ?",
      [doctorId]
    );

    // **Insert new schedules**
    if (visitingSchedule.length > 0) {
      const insertSql = `
        INSERT INTO DoctorVisitingSchedule (DoctorId, DayOfWeek, StartTime, EndTime, Area) 
        VALUES ?
      `;
      await connection.query(insertSql, [visitingSchedule]);
      console.log("Doctor visiting schedule updated.");
    }

    // ✅ **5. Commit Transaction**
    await connection.commit();
    console.log("Doctor updated successfully.");
    return "Doctor updated successfully.";
  } catch (error) {
    await connection.rollback();
    console.error("Error updating doctor:", error.message);
    throw new Error(error.message);
  } finally {
    connection.release();
  }
};
/**
 * This will give user list of doctors
 * RoleId for doctors are 2 
 * Table name is users.
 */
const getReportingDoctorList = async () => {
  try {
    const queryForReportingDoctorList = "SELECT Id, FirstName, LastName FROM Users WHERE RoleId = 2";
    const [rows] = await dbConnection.connection.promise().query(queryForReportingDoctorList);
    return rows;
  } catch (error) {
    console.error("Error fetching reporting doctor list:", error);
    throw error; // Rethrow so calling functions can handle it
  }
};
/**
 * 
 * @param {*} refferingDoctorId 
 * @param {*} reportingDoctorId 
 * @returns 
 */
const setReportingDoctor = async (refferingDoctorId, reportingDoctorId) => {
  try {
    const query = `
      INSERT INTO ReferDoctorReportingDoctor (ReferDoctorId, ReportingDoctorId)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE ReportingDoctorId = VALUES(ReportingDoctorId)
    `;
    const [result] = await dbConnection.connection.promise().execute(query, [refferingDoctorId, reportingDoctorId]);
    return result;
  } catch (error) {
    console.error('Error in setReportingDoctor:', error);
    throw error;
  }
};
/**
 * 
 * @param {*} refferingDoctorId 
 * @returns preselected reportingDoctor or null;
 */
const getPreselectedReportingDoctor = async (refferingDoctorId) => {
  try {
    const query = 'SELECT ReportingDoctorId FROM ReferDoctorReportingDoctor WHERE ReferDoctorId = ?';
    const [rows] = await dbConnection.connection.promise().execute(query, [refferingDoctorId]);

    console.log(rows)
    return rows.length > 0 ? rows[0].ReportingDoctorId : null; // Return the first match or null if not found
  } catch (error) {
    console.log(error)
    console.error('Error in getPreselectedReportingDoctor:', error);
    throw error;
  }
};

const updateMarketingPerson = async (marketingPersonId, doctorId) => {
  try {
    const query = `
                  INSERT INTO MarketingDoctorAssociation (DoctorId, MarketingPersonId)
                  VALUES (?, ?)
                  ON DUPLICATE KEY UPDATE MarketingPersonId = VALUES(MarketingPersonId)

                  `
    await dbConnection.connection.promise().query(query, [doctorId, marketingPersonId]);

    console.log(mysql.format(query, [doctorId, marketingPersonId]))
    console.log('Marketing person updated successfully.');
  } catch (error) {
    console.error('Error updating marketing person:', error);
    throw error;
  }
};
const getPreselectedMarketingPerson = async(refferingDoctorId)=>{

  try {
    const query ="select MarketingPersonId from MarketingDoctorAssociation where DoctorId=?"
    const [rows] = await dbConnection.connection.promise().execute(query, [refferingDoctorId]);

    console.log(rows)
    return rows.length > 0 ? rows[0].ReportingDoctorId : null; // Return the first match or null if not found
  } catch (error) {
    console.log(error)
    console.error('Error in getPreselectedReportingDoctor:', error);
    throw error;
  }
};

//export all the function
module.exports = {
  registerDoctor: registerDoctor,
  getDoctorList: getDoctorList,
  validateUserInput: validateUserInput,
  getAttachedDoctorList: getAttachedDoctorList,
  getdoctorListNotattachedToclinic: getdoctorListNotattachedToclinic,
  getDoctorDetail: getDoctorDetail,
  getCategoryWiseCommission: getCategoryWiseCommission,
  getTestWiseCommissionDetails: getTestWiseCommissionDetails,
  updateThanks: updateThanks,
  updateDoctorsThankTestWise: updateDoctorsThankTestWise,
  getDoctorWiseThanks: getDoctorWiseThanks,
  getIndividualDoctorThanks: getIndividualDoctorThanks,
  downloadAllDoctorThanks: downloadAllDoctorThanks,
  getVisitingSchedule: getVisitingSchedule,
  getDoctorName: getDoctorName,
  setThanksToZero: setThanksToZero,
  getDoctorsCategoryWiseThanks: getDoctorsCategoryWiseThanks,
  getDoctorVisitingSchedule: getDoctorVisitingSchedule,
  updateDoctor: updateDoctor,
  getReportingDoctorList:getReportingDoctorList,
  setReportingDoctor:setReportingDoctor,
  getPreselectedReportingDoctor:getPreselectedReportingDoctor,
  updateMarketingPerson:updateMarketingPerson,
  getPreselectedMarketingPerson:getPreselectedMarketingPerson
  //getDoctorCommissionRateBasedOnCategory:getDoctorCommissionRateBasedOnCategory
};

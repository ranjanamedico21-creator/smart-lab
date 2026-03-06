const dbConnection = require("../config/DBConnection");
const currDateAndTime = require("../helper/helper");
const mysql = require('mysql2'); // Ensure you have mysql2 package
//const {connection} = require("../config/DBConnection");
const Clinic = require("../models/Clinic");
const Doctor = require("../models/Doctor");
const PatientQueue=require("../models/PatientQueue");
const moment= require('moment')

const registerPatientDetails = async (req) => {
    const connection = await dbConnection.pool.promise().getConnection();
    try {
        const patientDetails = extractPatientDetailsFromUserInput(req, false)
        await connection.beginTransaction();

        // Log the query for PatientDetails
        const insertPatientQuery = "INSERT INTO PatientDetails SET ?";

        console.log('query1')
         console.log('Executing Query:', mysql.format(insertPatientQuery, [patientDetails]));

        const [newPatient] = await connection.query(insertPatientQuery, [patientDetails]);
        if (newPatient.affectedRows === 0) {
            throw new Error('Patient registration failed.');
        }

        const generatedPatientId = newPatient.insertId;
        // console.log(generatedPatientId)
        // console.log('generatedPatientId')
        const selectedTestDetails = JSON.parse(req.body.selectedTestDetails);

        console.log('selected test details');

        console.log(selectedTestDetails)
        const values = selectedTestDetails.map(patientTest => [generatedPatientId,patientTest.TestId,patientTest.Discount]);
    
        const selectedSubTestDetails = JSON.parse(req.body.selectedSubTestDetails);

        const subTest = selectedSubTestDetails.map(patientTest => [generatedPatientId, patientTest.SubTestId]); 

        if (subTest.length > 0) {
            // insert into patient test refference
            const insertSubTestRefferenceQuery = "INSERT INTO PatientSubTestRefference(PatientId,SubTestId) Values ?"

            console.log('query2')
            console.log('Executing Query:', mysql.format(insertSubTestRefferenceQuery, [subTest]));

            const [insertSubTestRefference] = await connection.query(insertSubTestRefferenceQuery, [subTest]);
            if (insertSubTestRefference.affectedRows === 0) {
                throw new Error('Sub Test reference registration failed.');
            }
        }


        // Log the query for PatientTestRefference
        const insertTestReferenceQuery = "INSERT INTO PatientTestRefference (PatientId, TestId, Discount) VALUES ?";

        console.log('query3')
        console.log('Executing Query:', mysql.format(insertTestReferenceQuery, [values]));
        const [testInsertResult] = await connection.query(insertTestReferenceQuery, [values]);
        if (testInsertResult.affectedRows === 0) {
            throw new Error('Test reference registration failed.');
        }
        // After testInsertResult
        const [testRefIds] = await getPatientTestIds(generatedPatientId,connection)
        // Now pass testRefIds instead of testList
       await  registerDeliverablesForTests(testRefIds, connection)

        const transactionDetails = {
            UserId: req.user.Id,
            PatientId: generatedPatientId,
            CreditCash: patientDetails.CashPayment,
            CreditOnline: patientDetails.OnlinePayment,
            Debit: 0,
            TransactedOn: patientDetails.RegisteredOn
        };

        // Log the query for TransactionTable
        const insertTransactionQuery = 'INSERT INTO TransactionTable SET ?';

        console.log('query4')
         console.log('Executing Query:', mysql.format(insertTransactionQuery, [transactionDetails]));

        const [transactionResult] = await connection.query(insertTransactionQuery, [transactionDetails]);
        if (transactionResult.affectedRows === 0) {
            throw new Error('Transaction registration failed.');
        }

/**
 * both these variable selectedTest and selectedSubvTest are used for calculating of commission
 * 
 */
        const selectedTest= selectedTestDetails.map(patientTest=>[patientTest.TestId])
        const selectedSubTest=selectedSubTestDetails.map(patientSubTest=>[patientSubTest.SubTestId])
        const thanks = await calculateThanks(patientDetails.DoctorId,selectedTest,selectedSubTest,connection)
                       await insertDoctorThanks(patientDetails,generatedPatientId,thanks,connection)
        // 5. Patient Queue + Prediction
        // 👉 calculate total test time
        let totalTestTime = 0;
        const [testTimes] = await connection.query(
            "SELECT TimeToComplete FROM mainTestTable WHERE Id IN (?)",
            [selectedTestDetails.map(t => t.TestId)]
        );
        testTimes.forEach(row => totalTestTime += row.AvgTimeMinutes);

        // 👉 get last patient's predicted end time
        const [lastPatient] = await connection.query(`
            SELECT PredictedEndTime FROM PatientQueue
            WHERE PredictedEndTime IS NOT NULL
            ORDER BY PredictedEndTime DESC
            LIMIT 1
        `);

        const startTime = lastPatient.length
            ? moment(lastPatient[0].PredictedEndTime).add(1, "minutes")
            : moment();

        const endTime = moment(startTime).add(totalTestTime, "minutes");

        // 👉 insert into PatientQueue
        const insertQueueQuery = `INSERT INTO PatientQueue 
                            (PatientId, PredictedStartTime, PredictedEndTime, Status, IsEmergency)
                            VALUES (?, ?, ?, 'Waiting', ?)`;
        await connection.query(insertQueueQuery, [
            generatedPatientId,
            startTime.format("YYYY-MM-DD HH:mm:ss"),
            endTime.format("YYYY-MM-DD HH:mm:ss"),
            req.body.emergency || false
        ]);

         // 👉 optionally log timeline event
       /*  await connection.query(
            "INSERT INTO PatientTimeline (PatientId, EventType, CreatedBy) VALUES (?, 'registered', ?)",
            [generatedPatientId, req.user.Id]
        );*/

        await connection.commit();
        return "Patient is successfully registered into the system.";

    } catch (error) {
        console.log(error)
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};
/**
 * 
 * @param {*} testRefList 
 * @param {*} userId 
 * @param {*} connection 
 */
const registerDeliverablesForTests = async (testRefList, connection) => {
    for (const ref of testRefList) {
      const testId = ref.TestId;
      const testRefId = ref.Id;
      console.log(testId)
  
      const [[testMeta]] = await connection.query(
        'SELECT CategoryId FROM MainTestTable WHERE Id = ?',
        [testId]
      );

     // console.log('test meta ')

      console.log(testMeta)
  
      if (!testMeta) {
        console.warn(`No Category found for TestId: ${testId}`);
        continue;
      }
  
      const categoryId = testMeta.CategoryId;
  
      const [components] = await connection.query(
        'SELECT ComponentType FROM CategoryComponents WHERE CategoryId = ?',
        [categoryId]
      );
 // console.log('components');
  console.log(components)
      for (const row of components) {
        await connection.query(
          `INSERT INTO TestDeliverables (PatientTestReferenceId, ComponentType)
           VALUES (?, ?)`,
          [testRefId, row.ComponentType]
        );
      }
    }
  };

  /**
   * 
   * @param {*} patientId 
   * @param {*} connection 
   * @returns 
   */
const getPatientTestIds = async (patientId, connection) => {
    try {
        const rows = await connection.query(
            `SELECT Id, TestId FROM PatientTestRefference WHERE PatientId = ?`,
            [patientId]
        );
        return rows;
    } catch (error) {
        console.error('Error in getPatientTestIds:', error.message);
        throw error;
    }
};

const calculateThanks = async(DoctorId,selectedTestIds,selectedSubTestIds,connection)=>{

    return new Promise(async(resolve,reject)=>{
        try {
            let subTestIds
                subTestIds = selectedSubTestIds.length > 0 ? selectedSubTestIds : [-1]; // Use -1 as a dummy value if empty

        console.log("query:1",mysql.format(`select sum(commission) as TestThanks
                                            from DoctorTestCommission where DoctorId=? And TestId In(${selectedTestIds})`,[DoctorId]))

         console.log("query 2:",mysql.format(`select sum(Thanks) as subTestThanks from DoctorSubTestCommission where DoctorId=?
                                            And SubTestId IN (${selectedSubTestIds})`,[DoctorId]))

         const [testThanksResult] = await connection.execute(`select sum(commission) as TestThanks from DoctorTestCommission 
                                                                where DoctorId=? And TestId In(${selectedTestIds})`, [DoctorId]);     
                                                                                                
         const [subTestThanksResult] = await connection.execute(`select sum(Thanks) as Thanks from DoctorSubTestCommission 
                                                             where DoctorId=? And SubTestId IN (${subTestIds})`, [DoctorId]);
     
     // Get the values from the results and convert them to integers
     const testThanks = parseInt(testThanksResult[0].TestThanks) || 0; 
     const subTestThanks = parseInt(subTestThanksResult[0].Thanks) || 0;
     
     // Sum both outcomes
     const totalThanks = testThanks + subTestThanks;
     
                                        console.log(testThanks)
                                        console.log('testThanks')
                                        console.log(subTestThanks)
                                        console.log('subTestThanks')

                                      resolve(totalThanks)
        } catch (error) {
            reject(error)
        }
    })

}


const insertDoctorThanks = async (patientDetails,generatedPatientId, thanks, connection) => {
    try {
        // Define the SQL query for inserting into Referrals
        const referralThanksQuery = `INSERT INTO Referrals (DoctorId, PatientId, RegisteredOn, RegisteredBy, Thanks) 
                                     VALUES (?, ?, ?, ?, ?)`;

        // Prepare and log the query with parameter substitution (for debugging only, avoid in production)
        console.log('Thanks update query:', mysql.format(referralThanksQuery, [
            patientDetails.DoctorId, 
            generatedPatientId, 
            patientDetails.RegisteredOn, 
            patientDetails.RegisteredBy, 
            thanks
        ]));
        if(patientDetails.DoctorId<=0)
            throw "There is error while selecting a reffering doctor.Kindly retry."
console.log('query5')
        // Execute the query with values
        const [thanksUpdated] = await connection.execute(referralThanksQuery, [
            patientDetails.DoctorId, 
            generatedPatientId, 
            patientDetails.RegisteredOn, 
            patientDetails.RegisteredBy, 
            thanks
        ]);

        return thanksUpdated; // Return the result if needed for further logic

    } catch (error) {
        // Catch and log any errors during the query execution
        console.error('Error inserting doctor thanks:', error);
        throw error; // Re-throw the error after logging it
    }
};

/**
 * 
 * @param {*} patientDetails 
 * @param {*} thanks 
 * @param {*} connection 
 */
const updateDoctorThanks = async (patientDetails, thanks, patientId, connection) => {
    try {
        // Ensure required fields are present
        if (!patientDetails || !patientDetails.UpdatedOn || !patientDetails.UpdatedBy || !patientDetails.DoctorId) {
            throw new Error('Missing required patient details');
        }

        // Define the SQL query for updating the Referrals table
        const referralThanksQuery = `UPDATE Referrals 
                                            SET 
                                                ModifiedOn = ?, ModifiedBy = ?, Thanks = ? 
                                            WHERE 
                                                PatientId = ? AND DoctorId = ?`;

        // Log the query with substituted parameters for debugging purposes
        console.log('Thanks update query:', mysql.format(referralThanksQuery, [
            patientDetails.UpdatedOn, 
            patientDetails.UpdatedBy, 
            thanks, 
            patientId, 
            patientDetails.DoctorId
        ]));

        // Execute the query with values
        const [thanksUpdated] = await connection.execute(referralThanksQuery, [
            patientDetails.UpdatedOn, 
            patientDetails.UpdatedBy, 
            thanks, 
            patientId, 
            patientDetails.DoctorId
        ]);

        return thanksUpdated; // Return the result if you need to verify the update

    } catch (error) {
        // Handle and log any errors
        console.error('Error updating doctor thanks:', error);
        throw error; // Re-throw the error to handle it in the calling code
    }
};

/*let getPatientListWithDoctorDetail = () => {
    return new Promise((resolve, reject) => {
        let date = currDateAndTime.getCurrentDateAndTime()[0];
        try {
           // const getPatientListWithDoctorDetail = `SELECT PatientDetails.Id,Status,Title, Name, Age, YMD, Gender, PhoneNumber, ActualAmount, GrossAmount,DATE_FORMAT(RegisteredOn,'%d-%m-%y')as RegisteredOn,DuesAmount,Status,DoctorId, DoctorDetails.FirstName,DoctorDetails.LastName,DoctorDetails.Degree1,DoctorDetails.Degree2,DoctorDetails.Degree3,DoctorDetails.Degree4 FROM PatientDetails INNER JOIN DoctorDetails ON PatientDetails.DoctorId=DoctorDetails.Id where RegisteredOn=?`
                const getPatientListWithDoctorDetail=`SELECT 
                                                            PatientDetails.Id AS PatientId,
                                                            PatientDetails.Status,
                                                            PatientDetails.Title, 
                                                            PatientDetails.Name, 
                                                            PatientDetails.Age, 
                                                            PatientDetails.YMD, 
                                                            PatientDetails.Gender, 
                                                            PatientDetails.PhoneNumber, 
                                                            PatientDetails.ActualAmount, 
                                                            PatientDetails.GrossAmount, 
                                                            DATE_FORMAT(PatientDetails.RegisteredOn, '%d-%m-%y') AS RegisteredOn,
                                                            PatientDetails.RegisteredTime, 
                                                            PatientDetails.DuesAmount, 
                                                            PatientDetails.Status, 
                                                            PatientDetails.DoctorId, 
                                                            DoctorDetails.FirstName As DoctorFirstName,
                                                            DoctorDetails.LastName AS DoctorLastName,
                                                            DoctorDetails.Degree1 AS DoctorDegree1,
                                                            DoctorDetails.Degree2 As DoctorDegree2, 
                                                            DoctorDetails.Degree3 AS DoctorDegree3,
                                                            DoctorDetails.Degree4 As DoctorDegree4,
                                                            DoctorDetails.SpecialistIn As DoctorSpecialistIn,
                                                            GROUP_CONCAT(MainTestTable.TestName SEPARATOR ', ') AS TestNames,
                                                            Users.FirstName as UserFirstName,
                                                            Users.LastName as UserLastName
                                                        FROM 
                                                            PatientDetails
                                                        INNER JOIN 
                                                            DoctorDetails ON PatientDetails.DoctorId = DoctorDetails.Id
                                                        LEFT JOIN 
                                                            PatientTestRefference ON PatientDetails.Id = PatientTestRefference.PatientId
                                                        LEFT JOIN 
                                                            MainTestTable ON PatientTestRefference.TestId = MainTestTable.Id
                                                        JOIN
                                                            Users ON Users.Id = PatientDetails.RegisteredBy
                                                        WHERE 
                                                            PatientDetails.RegisteredOn = ?
                                                        GROUP BY 
                                                            PatientDetails.Id, DoctorDetails.Id;
            `
            // console.log('Executing Query:', mysql.format(getPatientListWithDoctorDetail, [date]));

            dbConnection.connection.execute(getPatientListWithDoctorDetail, [date], function (error, patientListWithDoctorDetail) {
                if (error) 
                    throw error
                
                if (patientListWithDoctorDetail.length >= 0) {
                    resolve(patientListWithDoctorDetail);
                }
            });
        } catch (error) {
            reject(error);
        }
    });
};26-08-25*/

/*let getPatientListWithDoctorDetail = () => {
    return new Promise((resolve, reject) => {
      const date = currDateAndTime.getCurrentDateAndTime()[0]; // 'YYYY-MM-DD'
      try {
        const sql = `
          SELECT 
            p.Id AS PatientId,
            p.Status,
            p.Title,
            p.Name,
            p.Age,
            p.YMD,
            p.Gender,
            p.PhoneNumber,
            p.ActualAmount,
            p.GrossAmount,
            DATE_FORMAT(p.RegisteredOn, '%d-%m-%y') AS RegisteredOn,
            p.RegisteredTime,
            p.DuesAmount,
            p.DoctorId,
  
            d.FirstName AS DoctorFirstName,
            d.LastName  AS DoctorLastName,
            CONCAT(
              COALESCE(d.FirstName, ''),
              CASE WHEN d.FirstName IS NOT NULL AND d.LastName IS NOT NULL THEN ' ' ELSE '' END,
              COALESCE(d.LastName, '')
            ) AS DoctorName,
  
            d.Degree1 AS DoctorDegree1,
            d.Degree2 AS DoctorDegree2,
            d.Degree3 AS DoctorDegree3,
            d.Degree4 AS DoctorDegree4,
            d.SpecialistIn AS DoctorSpecialistIn,
  
            GROUP_CONCAT(m.TestName ORDER BY m.TestName SEPARATOR ', ') AS TestNames,
  
            u.FirstName AS UserFirstName,
            u.LastName  AS UserLastName
  
          FROM PatientDetails p
          INNER JOIN DoctorDetails d ON p.DoctorId = d.Id
          LEFT JOIN PatientTestRefference r ON p.Id = r.PatientId
          LEFT JOIN MainTestTable m ON r.TestId = m.Id
          INNER JOIN Users u ON u.Id = p.RegisteredBy
          WHERE p.RegisteredOn = ?
          GROUP BY p.Id, d.Id;
        `;
  
        dbConnection.connection.execute(sql, [date], (error, rows) => {
          if (error) return reject(error);
          resolve(rows);
        });
      } catch (err) {
        reject(err);
      }
    });
  };*/


  const getPatientListWithDoctorDetail = async (req) => {
    const date = currDateAndTime.getCurrentDateAndTime()[0]; // 'YYYY-MM-DD'
    const currentUserId= req.user.Id;
    const currentUserRoleId= req.user.RoleId
    
    const sql = `
      SELECT 
          p.Id AS PatientId,
          p.Status,
          p.Title,
          p.Name,
          p.Age,
          p.YMD,
          p.Gender,
          p.PhoneNumber,
          p.ActualAmount,
          p.GrossAmount,
          DATE_FORMAT(p.RegisteredOn, '%d-%m-%y') AS RegisteredOn,
          p.RegisteredTime,
          p.DuesAmount,
          p.DoctorId,
  
          d.FirstName AS DoctorFirstName,
          d.LastName  AS DoctorLastName,
          CONCAT(
              COALESCE(d.FirstName, ''),
              CASE WHEN d.FirstName IS NOT NULL AND d.LastName IS NOT NULL THEN ' ' ELSE '' END,
              COALESCE(d.LastName, '')
          ) AS DoctorName,
  
          d.Degree1, d.Degree2, d.Degree3, d.Degree4, d.SpecialistIn,
  
          GROUP_CONCAT(m.TestName ORDER BY m.TestName SEPARATOR ', ') AS TestNames,
  
          u.FirstName AS UserFirstName,
          u.LastName  AS UserLastName
  
      FROM PatientDetails p
      INNER JOIN DoctorDetails d ON p.DoctorId = d.Id
      LEFT JOIN PatientTestRefference r ON p.Id = r.PatientId
      LEFT JOIN MainTestTable m ON r.TestId = m.Id
      INNER JOIN Users u ON u.Id = p.RegisteredBy
      LEFT JOIN ReferDoctorReportingDoctor rr ON rr.ReferDoctorId = d.Id
  
      WHERE DATE(p.RegisteredOn) = ?
        AND (
              (? = 2 AND (rr.ReportingDoctorId = ? OR rr.ReportingDoctorId IS NULL))
              OR ? <> 2
            )
  
      GROUP BY p.Id, d.Id;
    `;
  
    try {
      const [rows] = await dbConnection.connection.promise().execute(sql, [
        date,
        currentUserRoleId,
        currentUserId,
        currentUserRoleId
      ]);
  
      return rows;
    } catch (err) {
      throw err;
    }
  };
  
  


let getDuesPatientListWithDoctorDetails = async(req) => {
        let date =moment().format("YYYY-MM-DD HH:mm:ss") //currDateAndTime.getCurrentDateAndTime()[0];
        try {
            const duesPatientListWithDoctorDetailsQuery = `SELECT 
                            PD.Id,
                            PD.Title,
                            PD.Name,
                            PD.Age,
                            PD.YMD,
                            PD.Gender,
                            PD.PhoneNumber,
                            PD.ActualAmount,
                            PD.GrossAmount,
                            DATE_FORMAT(PD.RegisteredOn, '%d-%m-%y') AS RegisteredOn,
                            PD.DuesAmount,
                            DD.FirstName AS DoctorFirstName,
                            DD.LastName AS DoctorLastName,
                            DD.Degree1 As DoctorDegree1,
                            DD.Degree2 As DoctorDegree2,
                            DD.Degree3 As DoctorDegree3,
                            DD.Degree4 AS DoctorDegree4,
                            DD.SpecialistIn As DoctorSpecialistIn,
                            GROUP_CONCAT(DISTINCT MT.TestName ORDER BY MT.TestName SEPARATOR ', ') AS TestNames
                        FROM PatientDetails PD
                        INNER JOIN DoctorDetails DD ON PD.DoctorId = DD.Id
                        LEFT JOIN PatientTestRefference PTR ON PD.Id = PTR.PatientId
                        LEFT JOIN MainTestTable MT ON PTR.TestId = MT.Id
                        WHERE PD.DuesAmount > 0 AND PD.Status = 1
                        GROUP BY PD.Id
                        ORDER BY PD.Id DESC;`
            let [rows] = await dbConnection.connection.promise().query(duesPatientListWithDoctorDetailsQuery)
                return rows
                    
        } catch (error) {
            throw error
        }
};

/**
 *
 * @param {*} patientId
 * @returns detail of particular patient
 *
 */

const getPatientDetails = async(patientId) => {
        try {
            let sql = `SELECT 
                        PatientDetails.*, 
                        PatientDetails.Id as PatientId,
                        DATE_FORMAT(PatientDetails.RegisteredOn, '%d-%m-%y') AS RegisteredOn,
                        DoctorDetails.Id as DoctorId,
                        DoctorDetails.FirstName as DoctorFirstName,
                        DoctorDetails.LastName as DoctorLastName,
                        DoctorDetails.Degree1 As DoctorDegree1,
                        DoctorDetails.Degree2 AS DoctorDegree2,
                        DoctorDetails.Degree3 AS DoctorDegree3,
                        DoctorDetails.Degree4 AS DoctorDegree4,
                        DoctorDetails.SpecialistIn As DoctorSpecialistIn,
                        GROUP_CONCAT(MainTestTable.TestName SEPARATOR ', ') AS TestNames
                    FROM 
                        PatientDetails
                    JOIN 
                        DoctorDetails ON PatientDetails.DoctorId = DoctorDetails.Id
                    LEFT JOIN 
                        PatientTestRefference ON PatientDetails.Id = PatientTestRefference.PatientId
                    LEFT JOIN 
                        MainTestTable ON PatientTestRefference.TestId = MainTestTable.Id
                    WHERE 
                        PatientDetails.Id = ? 
                    GROUP BY 
                        PatientDetails.Id;`

       const [patientDetails]=await dbConnection.connection.promise().query(sql, [patientId]) 
       return patientDetails;

        } catch (error) {
            console.log(error)
            throw error
        }
}
/**
 * 
 * @param {*} req 
 * @returns 
 * This function is also used for patient with only dues Amount
 * for this to work we are setting a variable in req object with name as patientWithOnlyDuesAmount as true and false
 * this function is called from searchPatient And Search Patient with dues Amount
 * 
 * */
const searchPatient = async (req) => {
    const connection = await dbConnection.pool.promise().getConnection();
    try {
        let fromDate = req.body?.FromDate || moment().format('DD-MM-YYYY');
        let toDate = req.body?.ToDate || moment().format('DD-MM-YYYY');
        fromDate = currDateAndTime.parseDate(fromDate);
        toDate = currDateAndTime.parseDate(toDate);

        if (!currDateAndTime.compareDateForSearch(fromDate, toDate)) {
            throw new Error(`Invalid date range. "From Date" should be less than or equal to "To Date".`);
        }

        let whereArr = [];
        let queryParams = [];

        if (req.body.BillNo) {
            whereArr.push(`PatientDetails.Id = ?`);
            queryParams.push(req.body.BillNo);
        }

        if (req.body.Name) {
            whereArr.push(`PatientDetails.Name LIKE ?`);
            queryParams.push(`%${req.body.Name}%`);
        }

        if (req.body.Doctor) {
            whereArr.push(`PatientDetails.DoctorId = ?`);
            queryParams.push(req.body.Doctor);
        }

        if (req.patientWithOnlyDuesAmount) {
            whereArr.push(`PatientDetails.DuesAmount > 0`);
        }

        if (fromDate && toDate) {
            whereArr.push(`PatientDetails.RegisteredOn BETWEEN ? AND ?`);
            queryParams.push(fromDate, toDate);
        }

        if (req.body.Status) {
            whereArr.push(`PatientDetails.Status = ?`);
            queryParams.push(req.body.Status);
        }

        // 🔍 Filter by CategoryId
        if (req.body.MainCategory) {
            whereArr.push(`MainTestTable.CategoryId = ?`);
            queryParams.push(req.body.MainCategory);
        }

        const whereStr = whereArr.length > 0 ? `WHERE ${whereArr.join(' AND ')}` : '';

        const query = `
            SELECT 
                PatientDetails.Id AS PatientId,
                Title, 
                Name, 
                Age, 
                YMD, 
                Gender, 
                PhoneNumber, 
                ActualAmount, 
                GrossAmount, 
                DATE_FORMAT(RegisteredOn, '%d-%m-%y') AS RegisteredOn, 
                DuesAmount, 
                PatientDetails.Status, 
                DoctorDetails.FirstName AS DoctorFirstName,
                DoctorDetails.LastName AS DoctorLastName,
                DoctorDetails.Degree1 AS DoctorDegree1,
                DoctorDetails.Degree2 AS DoctorDegree2,
                DoctorDetails.Degree3 AS DoctorDegree3,
                DoctorDetails.Degree4 AS DoctorDegree4,
                DoctorDetails.SpecialistIn AS DoctorSpecialistIn
            FROM 
                PatientDetails
            INNER JOIN 
                DoctorDetails ON PatientDetails.DoctorId = DoctorDetails.Id
            LEFT JOIN 
                PatientTestRefference ON PatientDetails.Id = PatientTestRefference.PatientId
            LEFT JOIN 
                MainTestTable ON PatientTestRefference.TestId = MainTestTable.Id
            ${whereStr}
            GROUP BY PatientDetails.Id
        `;

        const [rows] = await connection.execute(query, queryParams);
        return rows;

    } catch (error) {
        throw error;
    } finally {
        connection.release();
    }
};



/**
 * 
 * @param {*} req 
 * @returns dailyDuesReceived object
 * used for get and post method of dailyDuesReceived
 * When we click on side bar daily dues received link default date will be today Date
 * Hence Checking for req.body object is empty or not 
 */

let getDailyDuesReceivedData = async (req) => { // Set default fromDate and toDate if no request body is provided
    let fromDate,
        toDate;

    // if (Object.keys(req.body).length === 0) {
    if (typeof req.body.FromDate == 'undefined' || req.body.FromDate == '') {
        fromDate = currDateAndTime.getCurrentDateAndTime()[0];
        toDate = currDateAndTime.getCurrentDateAndTime()[0];
    } else {
        fromDate = currDateAndTime.parseDate(req.body.FromDate);
        toDate = currDateAndTime.parseDate(req.body.ToDate);
    }

    return new Promise((resolve, reject) => {
        try {
            const query = `
              SELECT 
                  DailyDuesReceived.PatientId,
                  DailyDuesReceived.DuesReceivedBy,
                  Users.FirstName AS FName,
                  Users.LastName AS LName,
                  DATE_FORMAT(DailyDuesReceived.ReceivedOn, '%d-%m-%y') AS ReceivedOn,
                  DailyDuesReceived.CashPayment,
                  DailyDuesReceived.OnlinePayment,
                  PatientDetails.title,
                  PatientDetails.Name,
                  DATE_FORMAT(PatientDetails.RegisteredOn, '%d-%m-%y') AS RegisteredOn,
                  PatientDetails.DoctorId,
                  DoctorDetails.FirstName,
                  DoctorDetails.LastName 
              FROM 
                  PatientDetails 
              JOIN 
                  DoctorDetails ON DoctorDetails.Id = PatientDetails.DoctorId 
              JOIN 
                  DailyDuesReceived ON DailyDuesReceived.PatientId = PatientDetails.Id 
              JOIN 
                  Users ON Users.Id = DailyDuesReceived.DuesReceivedBy 
              WHERE 
                  DailyDuesReceived.ReceivedOn BETWEEN ? AND ?
          `;
          //  console.log('daily dues received :', mysql.format(query, [fromDate, toDate]))
            // console.log('Executing Query:', mysql.format(insertTransactionQuery, [transactionDetails]));
            dbConnection.connection.execute(query, [
                fromDate, toDate
            ], (error, result) => {
                if (error) {
                    throw error;
                }
                resolve(result);
            });
        } catch (error) {
            reject(error);
        }
    });
};

const patientPaymentDetails = (patientId) => {
    let sql = "select DuesAmount,CashPayment,OnlinePayment,Status,DATE_FORMAT(RegisteredOn,'%Y-%m-%d')as RegisteredOn from PatientDetails where Id=?";
    return new Promise((resolve, reject) => {
        try {
            dbConnection.connection.execute(sql, [patientId], function (error, patientPaymentDetails) { // console.log(c.sql);
                if (error) 
                    throw error
                
                if (patientPaymentDetails.length > 0) { // connection.end();
                    resolve(patientPaymentDetails);
                }
            });
        } catch (error) { // connection.end();
            reject(error);
        }
    });
};


const updateDuesAmount = async (req, patientId, updatedCashPayment, updatedOnlinePayment, remainingDues, RegisteredOn) => {
    let connection;

    try {
        const userId = req.user.Id;
        const cashPayment = parseInt(req.body.cashPayment || 0);
        const onlinePayment = parseInt(req.body.onlinePayment || 0);
        const [currDate, currTime] = currDateAndTime.getCurrentDateAndTime(); // Optimized repeated call
        //if user is registered today and he clears the dues on same day then we dont need to insert it into 
        //daily dues received table
        const canWeUpdateDuesTable = currDateAndTime.compareDate(RegisteredOn);

        connection = await dbConnection.pool.promise().getConnection();
        await connection.beginTransaction();

        //log patient change detail

        // Insert patient history to removed and replaced by different 12 march 2025
        await insertPatientHistory(connection, patientId, userId);

        // Update patient details table
        await updateAmountInPatientDetailsTable(connection, updatedCashPayment, updatedOnlinePayment, remainingDues, currDate, currTime, userId, patientId);

        // Update transaction table for crdit and debit detail
        await updateTransactionTable(connection, userId, cashPayment, onlinePayment, 0, patientId, currDate);

        // Conditionally update the daily dues table if patient is created today and pays the dues today 
        //then no need to update dues received table else we have to update dues has been received
        if (canWeUpdateDuesTable) {
            await updateDailyDuesReceived(connection, patientId, userId, currDate, cashPayment, onlinePayment);
        }

            await connection.commit();// Commit transaction
            return "Dues Received Successfully."
    } catch (error) {
        // Rollback transaction in case of error
        if (connection) 
            await connection.rollback();
            return error;
    } finally {
        if (connection) 
                connection.release(); // Release the connection back to the pool
    }
};

const updateDailyDuesReceived = async (connection, patientId, userId, currDate, cashPayment, onlinePayment) => {
    const insertTestReferenceQuery = `insert into DailyDuesReceived set PatientId=?,DuesReceivedBy=?,ReceivedOn=?,CashPayment=?, OnlinePayment=?`
    // console.log('Executing Query uodate daily dues  rece:', mysql.format(insertTestReferenceQuery,  [cashPayment,onlinePayment,remainingDues,currDate,currTime,userId,patientId]));

    await connection.execute(`insert into DailyDuesReceived set 
                                                        PatientId=?,
                                                        DuesReceivedBy=?,
                                                        ReceivedOn=?,
                                                        CashPayment=?,
                                                        OnlinePayment=?`, [
                                                        patientId,
                                                        userId,
                                                        currDate,
                                                        cashPayment,
                                                        onlinePayment
    ])
}
const updateAmountInPatientDetailsTable = async (connection, cashPayment, onlinePayment, remainingDues, currDate, currTime, userId, patientId) => {
    const insertTestReferenceQuery = `UPDATE PatientDetails SET CashPayment = ?,OnlinePayment = ?,DuesAmount = ?, UpdatedOn = ?, UpdateTime = ?, UpdatedBy = ?  WHERE Id = ?`
   console.log('Executing Query uodate amount patient detail:', mysql.format(insertTestReferenceQuery, [
        cashPayment,
        onlinePayment,
        remainingDues,
        currDate,
        currTime,
        userId,
        patientId
    ]));

    await connection.execute(`UPDATE PatientDetails 
                            SET CashPayment = ?, 
                                OnlinePayment = ?, 
                                DuesAmount = ?, 
                                UpdatedOn = ?, 
                                UpdateTime = ?, 
                                UpdatedBy = ? 
                            WHERE Id = ?`, [
                                            cashPayment,
                                            onlinePayment,
                                            remainingDues,
                                            currDate,
                                            currTime,
                                            userId,
                                            patientId
    ]);
}
/**
 * 
 * @param {*} req 
 * @returns 
 */
const logPatientChanges = async (req) => {
    try {
        console.log("Request Received:", req.query.id);
        
        let patientId = req.query.id;
        const newPatientDetails = extractPatientDetailsFromUserInput(req, false, true);
        const newSelectedTests = req.body.selectedTestDetails 
            ? JSON.parse(req.body.selectedTestDetails) 
            : [];
        
        let oldPatientDetails = await getPatientDetails(patientId);
        oldPatientDetails = oldPatientDetails[0];

        const oldPatientTesDetails = await getPatientTestDetail(patientId);
        const oldPatientTestIds = oldPatientTesDetails.map(test => test.Id);
        const newTestIds = newSelectedTests.map(test => test.TestId);

        // Find added and removed tests
        const addedTests = newSelectedTests.filter(test => !oldPatientTestIds.includes(test.TestId));
        const removedTests = oldPatientTesDetails.filter(test => !newTestIds.includes(test.Id));

        console.log("Tests Added:", addedTests);
        console.log("Tests Removed:", removedTests);

        const changes = [];

        // Log added tests
        addedTests.forEach(test => {
            changes.push({
                PatientId: patientId,
                ChangedField: "Test Added",
                OldValue: "N/A",
                NewValue: `${test.TestName} (₹${test.Price})`,
                ChangedAt: moment().format('YYYY-MM-DD HH:mm:ss'),
                ChangedBy: req.user.Email
            });
        });

        // Log removed tests
        removedTests.forEach(test => {
            changes.push({
                PatientId: patientId,
                ChangedField: "Test Removed",
                OldValue: `${test.TestName} (₹${test.Price})`,
                NewValue: "N/A",
                ChangedAt: moment().format('YYYY-MM-DD HH:mm:ss'),
                ChangedBy: req.user.Email
            });
        });

        const excludedFields = ["DoctorId", "ClinicId","Discount"];

        // Check DoctorId
        if (Number(oldPatientDetails.DoctorId) !== Number(newPatientDetails.DoctorId)) {
            const oldDoctorName = oldPatientDetails.FirstName + " " + oldPatientDetails.LastName;
            const newDoctorName = await Doctor.getDoctorName(newPatientDetails.DoctorId) || "Unknown Doctor";

            changes.push({
                PatientId: patientId,
                ChangedField: "Doctor",
                OldValue: oldDoctorName,
                NewValue: newDoctorName,
                ChangedAt: moment().format('YYYY-MM-DD HH:mm:ss'),
                ChangedBy: req.user.Email
            });
        }

        // Check ClinicId
        if (Number(oldPatientDetails.ClinicId) !== Number(newPatientDetails.ClinicId)) {
            const oldClinicDetails = await Clinic.findClinicById(Number(oldPatientDetails.ClinicId)) || { Name: "Unknown Clinic" };
            const newClinicDetails = await Clinic.findClinicById(Number(newPatientDetails.ClinicId)) || { Name: "Unknown Clinic" };

            changes.push({
                PatientId: patientId,
                ChangedField: "Clinic",
                OldValue: oldClinicDetails.Name,
                NewValue: newClinicDetails.Name,
                ChangedAt:moment().format('YYYY-MM-DD HH:mm:ss'),
                ChangedBy: req.user.Email
            });
        }
         // Check Discount
         if (Number(oldPatientDetails.Discount) !== Number(newPatientDetails.Discount)) {
    
            changes.push({
                PatientId: patientId,
                ChangedField: "Discount",
                OldValue: oldClinicDetails.Discount,
                NewValue: newClinicDetails.Discount,
                ChangedAt:moment().format('YYYY-MM-DD HH:mm:ss'),
                ChangedBy: req.user.Email
            });
        }

        // Loop through all fields except the ones checked separately
        Object.keys(newPatientDetails).forEach(field => {
            if (excludedFields.includes(field)) return;

            if (oldPatientDetails[field] !== newPatientDetails[field]) {
                changes.push({
                    PatientId: patientId,
                    ChangedField: field,
                    OldValue: oldPatientDetails[field],
                    NewValue: newPatientDetails[field],
                    ChangedAt:moment().format('YYYY-MM-DD HH:mm:ss'),
                    ChangedBy: req.user.Email
                });
            }
        });

        // Save changes to the database
        if (changes.length > 0) {
            const patientAuditLogQuery = `
                INSERT INTO PatientAuditLog (PatientId, ChangedField, OldValue, NewValue, ChangedAt, ChangedBy) 
                VALUES ${changes.map(() => "(?, ?, ?, ?, ?, ?)").join(", ")}
            `;
            const values = changes.flatMap(change => 
                [change.PatientId, change.ChangedField, change.OldValue, change.NewValue, change.ChangedAt, change.ChangedBy]
            );

            console.log("SQL Query:", mysql.format(patientAuditLogQuery, values));

            await dbConnection.connection.promise().query(patientAuditLogQuery, values);
        }

        return { success: true, message: "Audit log updated" };

    } catch (error) {
        console.error("Error in logPatientChanges:", error);
        return { success: false, error: error.message };
    }
};


/**
 * 
 * @param {*} req 
 * @param {*} res 
 * @returns 
 * This function is used to update the patient details while update 
 */
let updatePatientDetails = async (req, res) => { // console.log('i m in update patient')
   

        let patientId = req.query.id;
        if(!patientId)
            return reject(new Error('Patient Id is missing. Kindly try again.'));

        const newPatientDetails = extractPatientDetailsFromUserInput(req, true)
        const connection = await dbConnection.pool.promise().getConnection();
        try {

            let existingPatientDetails = await isPatientExist(connection, patientId);//patientExist is a patientDetailObject
            if (!existingPatientDetails) {  // ✅ Properly checks if patient exists
                return reject(new Error("This patient does not exist. Kindly choose another patient."));
            }
                await connection.beginTransaction();
            let selectedTestDetails=req.body.selectedTestDetails;
           //15 march  let creditedAmount = await getCreditedAmountForThePatient(connection, patientId);
                    selectedTestDetails = JSON.parse(selectedTestDetails);
          
                    //i am not able to check selectedTestDetail is empty or not hence this method is used
                    //here we are adding two hidden field in patient registration page and edit patient page and setting 
                    //them while adding or removing the test
            const isTestExist =    parseInt(req.body.testLength)
            const isSubTestExist = parseInt(req.body.subTestLength);

            if(isTestExist===0)
               throw new Error(" Sorry you have not selected any test.")

            let selectedSubTestDetails = req.body.selectedSubTestDetails
                if (typeof selectedSubTestDetails != 'undefined' && selectedSubTestDetails !== '') 
                        selectedSubTestDetails = JSON.parse(selectedSubTestDetails);

                await insertPatientHistory(connection, patientId, req.user.Id)
                //whatever field changed should be logged into database 
               // await updatePatientAuditLogTable(connection,patientDetails,req.user.Id)
                // get credit amount before updating the new test and amount for the transaction table
                await updatePatientDetailsTable(connection, newPatientDetails, patientId)
                // delete frpm patient sub test refference table we have to check this one
                // Step 1: Get old test map so that we can check for added test for test deliverable
                const [oldTests] = await connection.query(
                                `SELECT ptr.Id as RefId, ptr.TestId FROM PatientTestRefference ptr WHERE ptr.PatientId = ?`,
                                [patientId]
                            );
                 //we have to update Test deliverable tables according to that
                 const oldTestMap = new Map(oldTests.map(row => [row.TestId, row.RefId]));
                 // Step 2: Get new test IDs
                 const newTestIds = selectedTestDetails.map(t => t.TestId);
                 const oldTestIds = Array.from(oldTestMap.keys());
                 const addedTestIds = newTestIds.filter(id => !oldTestIds.includes(id));
                 const removedTestIds = oldTestIds.filter(id => !newTestIds.includes(id));
                 
                 // Step 3: Delete deliverables for removed tests
                 for (const testId of removedTestIds) {
                     const testRefId = oldTestMap.get(testId);
                     await connection.query(
                     `DELETE FROM TestDeliverables WHERE PatientTestReferenceId = ?`,
                     [testRefId]
                     );
                 }
                 
                 // Step 4: Reuse registerDeliverablesForTests() for added tests
                 if (addedTestIds.length > 0) {
                     const [newTestRefs] = await connection.query(
                     `SELECT Id, TestId FROM PatientTestRefference WHERE PatientId = ? AND TestId IN (?)`,
                     [patientId, addedTestIds]
                     );
                 
                     await registerDeliverablesForTests(newTestRefs, connection);
                 }
                // update patient test refference table add code for this
                await updatPatientTestTable(connection, selectedTestDetails, patientId, req.user.Id)
                await updatePatientSubTest(connection, selectedSubTestDetails, patientId, req.user.Id,isSubTestExist) 
  
               //here is the bug we must insert only diff amount of cash and online 
                const cashPayment=Number(newPatientDetails.CashPayment) - Number(existingPatientDetails.CashPayment)
                const onlinePayment=Number(newPatientDetails.OnlinePayment)- Number(existingPatientDetails.OnlinePayment)
                await updateTransactionTable(connection, req.user.Id, cashPayment, onlinePayment, 0, patientId, newPatientDetails.UpdatedOn)
                const selectedTest= selectedTestDetails.map(patientTest=>[patientTest.TestId])
                const selectedSubTest=selectedSubTestDetails.map(patientSubTest=>[patientSubTest.SubTestId])
                const thanks = await calculateThanks(newPatientDetails.DoctorId,selectedTest,selectedSubTest,connection)
                       await updateDoctorThanks(newPatientDetails,thanks,patientId,connection)

               // const [thanks]= await calculateThanks(DoctorId,selectedTestIds,selectedSubTestIds,connection)
                await connection.commit();
                return "Patient is successfully Updated."
            
        } catch (error) {
            await connection.rollback();
            throw error
        } finally {
            connection.release()
        }
};


/**
 * 
 * @param {*} connection 
 * @param {*} userId 
 * @param {*} cashPayment 
 * @param {*} onlinePayment 
 * @param {*} creditedAmount 
 * @param {*} patientId 
 * @param {*} currDate 
 * This information is required
 * 12 march 2025
 */
// updateTransactionTable(connection,req.user.Id,,,patientId,currDate)
let updateTransactionTable = async (connection, userId, cashPayment, onlinePayment, creditedAmount, patientId, currDate) => {
    let transactionDetails = {
        UserId: userId,
        PatientId: patientId,
        CreditCash: cashPayment,
        CreditOnline: onlinePayment,
        Debit: creditedAmount,
        TransactedOn: currDate
    }
    // console.log(transactionDetails)
    // console.log('transaction')
    let query = mysql.format(`insert into TransactionTable set ?`, [transactionDetails])
    await connection.query(query)
}

let getCreditedAmountForThePatient = async (connection, patientId) => {
    const insertPatientQuery = `select CashPayment,OnlinePayment from PatientDetails where Id=?`
  //  console.log('Executing Query:', mysql.format(insertPatientQuery, [patientId]));
    const amount = await connection.execute(`select CashPayment,OnlinePayment from PatientDetails where Id=?`, [patientId])
  //  console.log(amount)
 //   console.log(amount[0][0].CashPayment)
    if (amount.length >= 0) {
        let creditedAmount = parseInt(amount[0][0].CashPayment) + parseInt(amount[0][0].OnlinePayment);
       // console.log(creditedAmount);
      //  console.log('hihhi im nin hji89')
        return parseInt(creditedAmount)
    }
}

let getPatientTestDetail = async (patientId) => {

        try {
            let getPatientTestDetailQuery = `SELECT MainTestTable.*,MainTestTable.Id As TestId, Category.Name As categoryName,PatientTestRefference.ReportReady,PatientTestRefference.TestStatus
                                                FROM
                                                    MainTestTable
                                            INNER JOIN 
                                                    PatientTestRefference 
                                            INNER JOIN 
                                                    Category 
                                            ON 
                                                MainTestTable.CategoryId = Category.Id 
                                            where 
                                                MainTestTable.Id=PatientTestRefference.TestId And PatientTestRefference.PatientId=?`;

                                                console.log(mysql.format(getPatientTestDetailQuery, [patientId]))
            const [result] = await dbConnection.connection.promise().query(getPatientTestDetailQuery, [patientId]);

         //   console.log(result)
         //   console.log('i m ')
            return result
        } catch (error) { // connection.end();
            throw error;
        }

};
/**
 * 
 * @param {*} connection 
 * @param {*} patientId 
 * @returns object || []
 * used only in Patient
 */
let isPatientExist = async (connection, patientId) => {

   try {
    const [patientDetails] = await connection.execute("select * from PatientDetails where PatientDetails.Id=?", [patientId]);
    return patientDetails.length > 0 ? patientDetails[0] : null; // ✅ Returns patient details if found, otherwise null
   } catch (error) {
    console.log(error)
        throw error
   }
    
};


let updatePatientDetailsTable = async (connection, patientDetails, patientId) => {

    let query = `UPDATE PatientDetails SET ? where Id= ${patientId}`
        query = mysql.format(query, [patientDetails]);
        await connection.query(query)
}


let updatePatientSubTest = async (connection, selectedSubTestDetails, patientId, userId,isSubTestExist) => {
    const [existingSubTests] = await connection.query(`SELECT SubTestId FROM PatientSubTestRefference WHERE PatientId = ?`, [patientId]);
    const existingSubTestIds = existingSubTests.map((test) => test.SubTestId);
   
    // 2. Extract new sub test IDs from the incoming data
    let newSubTestIds=[]
         newSubTestIds = selectedSubTestDetails.map((test) => test.SubTestId) ;
    
        
    // 3. Find Added and Removed sub  Test IDs
    const addedSubTestIds = newSubTestIds.filter((SubTestId) => ! existingSubTestIds.includes(SubTestId));
    const removedSubTestIds = existingSubTestIds.filter((SubTestId) => ! newSubTestIds.includes(SubTestId));

    if(removedSubTestIds.length>0){
        for (const subTest of removedSubTestIds) {
            // Log the sub-test removal
            await connection.query(`INSERT INTO PatientSubTestRefferenceHistory (Patientid,SubTestId,ChangeType,ModifiedBy) VALUES (?, ?, 'remove', ?)`, [patientId, subTest.SubTestId, userId]);
    
            // Delete the sub-test from patientSubTest
            await connection.query(`DELETE FROM PatientSubTestRefference WHERE SubTestId = ? AND PatientId=?`, [subTest.SubTestId, patientId]);
        }
    }
    
    if(addedSubTestIds.length>0){
        for (const subTest of addedSubTestIds) {
            // Log the sub-test removal
            await connection.query(`INSERT INTO PatientSubTestRefferenceHistory (Patientid,SubTestId,ChangeType,ModifiedBy) VALUES (?, ?, 'add', ?)`, [patientId, subTest.SubTestId, userId]);

            // Delete the sub-test from patientSubTest
            await connection.query(`INSERT INTO PatientSubTestRefference (Patientid,SubTestId) VALUES (?, ?, 'remove', ?)`, [patientId,subTest.SubTestId]);
        }
    }
   
};


let updatPatientTestTable = async (connection, selectedTestDetails, patientId, userId) => {

    // 1. Fetch existing tests
    const [existingTests] = await connection.query(`SELECT TestId FROM PatientTestRefference WHERE PatientId = ?`, [patientId]);
    const existingTestIds = existingTests.map(test => test.TestId);
//console.log(selectedTestDetails);
//console.log('selectedTestDetails')
    // 2. Extract new test IDs from the incoming data
    const newTestIds = selectedTestDetails.map(test => test.TestId);

    // 3. Find Added and Removed Test IDs
    const addedTestIds = newTestIds.filter(testId => ! existingTestIds.includes(testId));
    const removedTestIds = existingTestIds.filter(testId => ! newTestIds.includes(testId));

    // 4. Handle Added Tests
    for (const test of selectedTestDetails) {
        if (addedTestIds.includes(test.TestId)) {
            // Log the addition
            await connection.query(`INSERT INTO PatientTestRefferenceHistory (PatientId,TestId,ChangeType,ModifiedBy) VALUES (?, ?, 'add', ?)`, [patientId, test.TestId, userId]);
            // Insert the new test
            await connection.query(`INSERT INTO PatientTestRefference (PatientId,TestId,ReportReady,Discount) VALUES (?,?,?,?)`, [patientId,test.TestId,0,test.Discount])
        }
    }

    // 5. Handle Removed Tests
    for (const testId of removedTestIds) {
        // Log the removal
        await connection.query(`INSERT INTO PatientTestRefferenceHistory (PatientId,TestId, ChangeType, ModifiedBy) VALUES (?, ?, 'remove', ?)`, [patientId, testId, userId]);
        // Remove the test
        await connection.query(`DELETE FROM PatientTestRefference WHERE TestId = ? AND PatientId = ?`, [testId, patientId]);
    }

}


let thanks = async (req) => {
    return new Promise((resolve, reject) => {
        try {
            let currDate = currDateAndTime.getCurrentDateAndTime()[0]
            let x = dbConnection.connection.execute(`update PatientDetails set ThanksGivenTo=? ,ThanksGivenBy=?,ThanksGivenOn=?,ThanksGivenToMobile=?,ThanksAmount=? where Id=?`, [
                req.body.thanksGivenTo,
                req.user.Id,
                currDate,
                req.body.thanksPaidMobile,
                req.body.thanksAmount,
                req.query.patientId
            ], function (error, result) {
                // console.log(x.sql)
                // console.log(result)
                if (error) 
                    throw error

                

                if (result.affectedRows > 0) 
                    resolve('Thanks Successfully Updated.')
                 else 
                    reject('Some error occured.Kindly try again.')

            })
        } catch (error) {
            reject(error)
        }
    })
}
let viewThanksPaidPatientList = async (req) => {
    return new Promise((resolve, reject) => {
        try { /**
       * when coming from url there will not be from date and to date 
       * it will be undefined or we can say its get method hesnce search data will be missiing here
       */
            let fromDate = ''
            let toDate = ''
            if (typeof req.body.FromDate !== "undefined") 
                fromDate = currDateAndTime.parseDate(req.body.FromDate)
             else 
                fromDate = currDateAndTime.getCurrentDateAndTime()[0]

            

            if (typeof req.body.ToDate !== "undefined") 
                toDate = currDateAndTime.parseDate(req.body.ToDate);
             else 
                toDate = currDateAndTime.getCurrentDateAndTime()[0]

            

            if (currDateAndTime.compareDateForSearch(fromDate, toDate)) {
                let whereArr = [];
                // whereArr.push('')
                // if (typeof req.body.BillNo != "undefined" && req.body.BillNo != "") whereArr.push(`PatientDetails.Id = "${req.body.BillNo}"`);
                if (typeof req.body.Name != "undefined" && req.body.Name != "") 
                    whereArr.push(`Name LIKE "%${
                        req.body.Name
                    }%"`);
                

                if (typeof req.body.doctorId != "undefined" && req.body.doctorId != "") 
                    whereArr.push(`DoctorId = "${
                        req.body.doctorId
                    }"`);
                

                whereArr.push(`PatientDetails.ThanksAmount > 0 `)
                if ((typeof fromDate != "undefined" && fromDate != "") && (typeof toDate != "undefined" && toDate != '')) 
                    whereArr.push(`ThanksGivenOn between "${fromDate}" AND "${toDate}"`);
                

                let whereStr = whereArr.join(" AND ");
                // console.log(whereStr)
                let sqlquery = `SELECT Users.FirstName as userName,Users.LastName as userLastName,Users.Email as userEmail,ThanksGivenTo,ThanksGivenBy,DATE_FORMAT(ThanksGivenOn,'%d-%m-%y')as ThanksGivenOn ,ThanksAmount,ThanksGivenToMobile,PatientDetails.Id,Status,Title, Name, Age, YMD, PatientDetails.Gender, PatientDetails.PhoneNumber, ActualAmount, GrossAmount,DATE_FORMAT(RegisteredOn,'%d-%m-%y')as RegisteredOn,DuesAmount,Status, DoctorDetails.FirstName as docFirstName,DoctorDetails.LastName as docLastName,DoctorDetails.Degree1,DoctorDetails.Degree2,DoctorDetails.Degree3,DoctorDetails.Degree4 FROM PatientDetails INNER JOIN DoctorDetails ON PatientDetails.DoctorId=DoctorDetails.Id INNER join Users on Users.Id = PatientDetails.RegisteredBy where ${whereStr};`
                let c = dbConnection.connection.execute(sqlquery, function (errors, rows) { // console.log(c.sql)
                    if (rows.length >= 0) {
                        resolve(rows);
                    }
                });

            }

            //
        } catch (error) {

            throw error
        }
    })
}




/**
 * 
 * @param {*} req 
 * @returns string
 * This function is used to cancel the patient.it is called from one place in patient controller 
 * that is   Function
 * patient detail table will be updated
 * patient detail history table will be updated
 * if patient is not created today then patient data will be inserted into cancel patient table
 */

let cancelPatient = async (req) => {
   
        const connection = await dbConnection.pool.promise().getConnection();
        let currDate = moment().format("YYYY-MM-DD HH:mm:ss");

        try {
            await connection.beginTransaction();
            const cancelPatientId = req.body?.cancelPatientId ?? [];
            if(!cancelPatientId)
                    throw new Error("We didnt find any patient Id. Kindly try again.")
            // Check if patient exists
            const patientDetails = await isPatientExist(connection, cancelPatientId);
            if (!patientDetails) {  
                throw new Error("This patient does not exist. Kindly choose another patient.");
            }

            // Check if patient is already cancelled
            if (patientDetails.Status == 2) {
                throw new Error("Patient is already cancelled.");
            }

            // Check if patient’s report or film is ready
            const patientTestDetails = await checkWhetherPatientTestHasBeenDone(connection,cancelPatientId);
            if (patientTestDetails?.ReportReady || patientTestDetails?.FilmReady) {
                throw new Error("Sorry, Patient Report or Film has already been created. Kindly ask the admin to cancel.");
            }

            // Calculate refund amount
            const amountToBeReturned = parseInt(patientDetails.CashPayment) + parseInt(patientDetails.OnlinePayment);

            // Insert into TransactionTable
            await insertTransaction(connection, req, amountToBeReturned, currDate);

            // Insert into PatientDetailsHistory
            await insertPatientHistory(connection, cancelPatientId, req.user.Id);

            // Update PatientDetails status to cancelled
            await updatePatientStatus(connection, req.body.cancelPatientId);

            // Check if the patient was registered today
            let isPatientRegisteredToday = currDateAndTime.isItTodayDate(patientDetails.RegisteredOn);

            // If patient was not registered today, insert into CancelledPatientList
            if (!isPatientRegisteredToday) {
                await insertCancelledPatient(connection, req, currDate);
            }
            //update doctor commission to zero  as patient is cancelled
            await Doctor.setThanksToZero(cancelPatientId)
            console.log('in cacel set thanks ')

            await connection.commit();
            return `Patient Cancelled Successfully. Kindly Refund the amount Rs. ${amountToBeReturned}.`;

        } catch (error) {
            console.error(error);
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }

};



// Helper function to get payment details
const getPaymentDetails = (patientId) => {
    return new Promise((resolve, reject) => {
        try {
            dbConnection.connection.execute(`SELECT CashPayment, OnlinePayment FROM PatientDetails WHERE Id = ?`, [patientId], (error, result) => {
                if (error) 
                    return reject(error);
                

                if (result.length > 0) 
                    return resolve(result[0]);
                

                resolve(null);
            });
        } catch (error) {
            reject(error)
        }
    });
};

// Helper function to insert into TransactionTable
const insertTransaction = async (connection, req, amountToBeReturned, currDate) => {
    await connection.execute('INSERT INTO TransactionTable SET UserId = ?, PatientId = ?, Debit = ?, TransactedOn = ?', [req.user.Id, req.body.cancelPatientId, amountToBeReturned, currDate]);
};

// Helper function to insert into PatientDetailsHistory
const insertPatientHistory = async (connection, patientId, userId) => {
    let patientData = await connection.execute(`SELECT Id as PatientId,Title,Name,Age,YMD,Gender,PhoneNumber,Address,ActualAmount,
                                                GrossAmount,Discount,DiscountApprovedBy,ClinicId,DoctorId,CashPayment,OnlinePayment,DuesAmount,
                                                Status FROM PatientDetails WHERE Id = ?`, [patientId])
    patientData = patientData[0]
    patientData.forEach(item => {
        item.ModifiedBy = userId 
        item.ChangeType = 'insert';
        // Adding a new field called 'Notes'
    });
   // console.log('Executing Query for patient test :', mysql.format('INSERT INTO PatientDetailsHistory set ?', patientData));
let insertQuery= mysql.format('INSERT INTO PatientDetailsHistory set ?', patientData)
    await connection.execute(insertQuery)
};

// Helper function to update PatientDetails status
const updatePatientStatus = async (connection, patientId) => {
    await connection.execute('UPDATE PatientDetails SET Status = ? WHERE Id = ?', [2, patientId]);
};

// Helper function to insert into CancelledPatientList
const insertCancelledPatient = async (connection, req, currDate) => {
    let cancelledPatientDetails = {
        PatientId: req.body.cancelPatientId,
        CancelledBy: req.user.Id,
        CancelledOn: currDate,
        Reason: req.body.reason
    };
    const formattedQuery=mysql.format('INSERT INTO CancelledPatientList SET ?', cancelledPatientDetails)
    await connection.query(formattedQuery);
};



/**
 * 
 * @param {*} req 
 * @param {*} isItCalledFromUpdate boolean
 * @returns object
 * it is called from register patient and update patient
 */
const extractPatientDetailsFromUserInput = (req, isItCalledFromUpdate,isItForPatientHistoryLog=false) => {
    const ActualAmount = parseInt(req.body.grossAmount) + parseInt(req.body.finalDiscount);
    const cashPayment = parseInt(req.body.cashPayment || 0);
    const onlinePayment = parseInt(req.body.onlinePayment || 0);
    const grossAmount = parseInt(req.body.grossAmount || 0);
    const DuesAmount = grossAmount - cashPayment - onlinePayment;
    const [currDate, currTime] = currDateAndTime.getCurrentDateAndTime();

    const patientDetails = {
        Title: req.body.title,
        Name: req.body.patientName,
        Age: req.body.age,
        YMD: req.body.ymd,
        Gender: req.body.gender,
        PhoneNumber: req.body.phoneNumber,
        Address: req.body.patientAddress,
        ActualAmount: ActualAmount,
        GrossAmount: grossAmount,
        Discount: req.body.finalDiscount,
        DiscountApprovedBy: req.body.discountApprovedBy,
        ClinicId: req.body.clinic,
        DoctorId: req.body.doctor,
        CashPayment: cashPayment,
        OnlinePayment: onlinePayment,
        DuesAmount: DuesAmount,
        Status: 1
    };
    if(isItForPatientHistoryLog)
            return patientDetails;
    if (isItCalledFromUpdate) {
        patientDetails.UpdatedBy = req.user.Id, // Adding a new field called 'AppointmentDate'
        patientDetails.UpdatedOn = currDate,
        patientDetails.UpdateTime = currTime
    } else {
        patientDetails.RegisteredBy = req.user.Id,
        patientDetails.RegisteredOn = currDate,
        patientDetails.RegisteredTime = currTime
    }
    console.log(req.body);
    console.log('tesdty ')
    return patientDetails;

}
let checkWhetherPatientTestHasBeenDone = async (connection, patientId) => {
    let patientTestDetail = await connection.execute('SELECT * FROM `PatientTestRefference` WHERE PatientId=?', [patientId])
    return patientTestDetail;
}



const isPatientWithTestExist = async (patientId, testId) => {
    try {
        const query = `SELECT * FROM PatientTestRefference WHERE PatientId = ? AND TestId = ?`;
        const [rows] = await dbConnection.connection.promise().execute(query, [patientId, testId]);

        // Return true if a record exists, false otherwise
        return rows.length > 0;
    } catch (error) {
        console.error(`Error checking if patient ${patientId} with test ${testId} exists:`, error);
        throw new Error("Database query failed while checking patient-test existence.");
    }
};

const getPatientTimeLineData = async(patientId)=>{

    try {
        const patientTimeLine = `SELECT ChangedField, OldValue, NewValue, ChangedAt, ChangedBy 
                                        FROM 
                                            PatientAuditLog 
                                        WHERE 
                                            PatientId = ? 
                                        ORDER BY 
                                            ChangedAt DESC
                                    `;

        const [logs] = await dbConnection.connection.promise().query(patientTimeLine, [patientId]);

       // console.log(logs)
        return logs
        
    } catch (error) {
        throw error
    }
}


/*const setFilmCreatedStatus = async (patientTestRefId, userId) => {
    try {
        const values = [
            [patientTestRefId, 'FILM', 1, userId]  // ComponentType = 'FILM', IsGenerated = 1
        ];

        const query = `
            INSERT INTO TestDeliverables 
            (PatientTestReferenceId, ComponentType, IsGenerated, GeneratedBy) 
            VALUES ?
        `;

        const [result] = await dbConnection.connection.promise().query(query, [values]);
        return result;
    } catch (error) {
        console.error('Error setting film created status:', error);
        throw error;
    }
};


const setFilmDeliveredStatus = async (patientTestRefId, userId) => {
    try {
        const values = [
            [patientTestRefId, 'FILM', 1, userId]  // ComponentType = 'FILM', IsGenerated = 1
        ];
//must check patient dues if user tries to give  the film.
        const query = `
            INSERT INTO TestDeliverables 
            (PatientTestReferenceId, ComponentType, IsDelivered, DeliveredBy) 
            VALUES ?
        `;

        const [result] = await dbConnection.connection.promise().query(query, [values]);
        return result;
    } catch (error) {
        console.error('Error setting film delivered status:', error);
        throw error;
    }
};*/
/**
 * 
 * @param {*} patientTestRefId 
 * @param {*} userId 
 * @returns 
 */
const setFilmOrReportCreatedStatus = async (patientTestRefId, userId,componentType) => {
    const query = `
        UPDATE TestDeliverables
        SET IsGenerated = 1,
            GeneratedBy = ?,
            GeneratedOn = NOW()
        WHERE PatientTestReferenceId = ? AND ComponentType =?
    `;
    const [result] = await dbConnection.connection.promise().query(query, [
        userId,patientTestRefId,componentType
    ]);
    return result;
};

/**
 * 
 * @param {*} patientTestRefId 
 * @param {*} userId 
 * @returns 
 */
const setFilmOrReportDeliveredStatus = async (patientTestRefId, userId,componentType) => {
    const query = `
        UPDATE TestDeliverables
        SET IsDelivered = 1,
            DeliveredBy = ?,
            DeliveredOn = NOW()
        WHERE PatientTestReferenceId = ? AND ComponentType = ?
    `;
    const [result] = await dbConnection.connection.promise().query(query, [
        userId,patientTestRefId,componentType
    ]);
    return result;
};


const testsWithComponents= async(patientId)=>{

    try {
        const query=`SELECT 
                            ptr.Id AS PatientTestRefId,
                            mt.TestName,
                            c.Name AS CategoryName,
                            cc.ComponentType,
                            td.IsGenerated,
                            td.GeneratedOn,
                            td.GeneratedBy,
                            td.IsDelivered,
                            td.DeliveredOn,
                            td.DeliveredBy
                            FROM PatientTestRefference ptr
                            JOIN PatientDetails p ON p.Id = ptr.PatientId
                            JOIN MainTestTable mt ON ptr.TestId = mt.Id
                            JOIN Category c ON mt.CategoryId = c.Id
                            JOIN CategoryComponents cc ON cc.CategoryId = mt.CategoryId
                            LEFT JOIN TestDeliverables td 
                            ON td.PatientTestReferenceId = ptr.Id 
                            AND td.ComponentType = cc.ComponentType
                            WHERE p.Id = ?
                            ORDER BY ptr.Id, cc.ComponentType;;
                    `
        const [rows]= await dbConnection.connection.promise().query(query,[patientId])
        return rows;

    } catch (error) {

        console.log(error)
        throw error;
        
    }
}
/**
 * 
 * @param {*} patientId 
 * @returns boolean
 */
const isPatientEneterdForTest = async (patientId) => {
    try {
      const query = `SELECT EntryTime FROM PatientQueue WHERE PatientId = ? LIMIT 1`;
      const [rows] = await dbConnection.connection.promise().query(query, [patientId]);
  
      // return true if at least one row exists and EntryTime is not null
      return rows.length > 0 && rows[0].EntryTime !== null;
    } catch (error) {
      console.error("Error checking patient entry:", error);
      return false; // fallback to false if error occurs
    }
  };
  
/**
 * Marks the selected tests as completed for a given patient.
 * Updates the `TestStatus` to 1 and sets `CompletedOn` to the current timestamp.
 *
 * @async
 * @function markTestsCompleted
 * @param {number|string} patientId - The ID of the patient whose tests are being marked completed.
 * @param {Array<number|string>|number|string} testIds - Array of Test IDs or a single Test ID to mark as completed.
 * @throws {Error} Throws an error if `testIds` is empty or null.
 * @throws {Error} Throws an error if there is a database query failure.
 * @returns {Promise<boolean>} Returns `true` if the operation succeeds.
 *
 * @example
 * // Mark multiple tests as completed
 * await markTestsCompleted(101, [5, 7, 9]);
 *
 * @example
 * // Mark a single test as completed
 * await markTestsCompleted(101, 5);
 */
const markTestsCompleted = async (patientId, testIds) => {
    if (!testIds || testIds.length === 0) {
        throw new Error("No tests selected");
    }

    try {
        //check whether patient is entered for the test or not 
       const isPatientEntered = await isPatientEneterdForTest(patientId);
       if(!isPatientEntered)
            await PatientQueue.markEntry(patientId)
        // Convert single ID to array if needed
        if (!Array.isArray(testIds)) testIds = [testIds];
        // Prepare placeholders for query
        const placeholders = testIds.map(() => '?').join(',');

        const query = `UPDATE PatientTestRefference
                        SET TestStatus = 1, CompletedOn = NOW()
                        WHERE PatientId = ? AND TestId IN (${placeholders})
                        `;

        await dbConnection.connection.promise().query(query, [patientId, ...testIds]);
        return true;
    } catch (err) {
        console.error("Error in markTestsCompleted:", err);
        throw err;
    }
};

// export all the function
module.exports = {
    registerPatientDetails: registerPatientDetails,
    getPatientListWithDoctorDetail: getPatientListWithDoctorDetail,
    getPatientDetails: getPatientDetails,
    searchPatient: searchPatient,
    patientPaymentDetails: patientPaymentDetails,
    updateDuesAmount: updateDuesAmount,
    getDuesPatientListWithDoctorDetails: getDuesPatientListWithDoctorDetails,
    updatePatientDetails: updatePatientDetails,
    getPatientTestDetail: getPatientTestDetail,
    getDailyDuesReceivedData: getDailyDuesReceivedData,
    cancelPatient: cancelPatient,
    thanks: thanks,
    viewThanksPaidPatientList: viewThanksPaidPatientList,
   // getPatientDetailHistory: getPatientDetailHistory,
   // getPatientTestHistoryDetail: getPatientTestHistoryDetail,
    isPatientWithTestExist:isPatientWithTestExist,
    logPatientChanges:logPatientChanges,
    getPatientTimeLineData:getPatientTimeLineData,
    setFilmOrReportCreatedStatus:setFilmOrReportCreatedStatus,
    testsWithComponents:testsWithComponents,
    setFilmOrReportDeliveredStatus:setFilmOrReportDeliveredStatus,
    isPatientEneterdForTest:isPatientEneterdForTest,
    markTestsCompleted:markTestsCompleted

};


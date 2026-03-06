//const { promiseImpl } = require("ejs");
const dbConnection = require("../config/DBConnection");
const currDateAndTime = require("../helper/helper");
const moment =require('moment');
const fs = require('fs');
//const { resolve } = require("path");
const bcrypt = require("bcrypt");
const mysql = require('mysql2'); 

const viewCollection=async(req)=>{
    
      
        const fromDate = moment(req.body?.FromDate ?? moment().format('DD-MM-YYYY'), 'DD-MM-YYYY').format('YYYY-MM-DD');
        const toDate = moment(req.body?.ToDate ?? moment().format('DD-MM-YYYY'), 'DD-MM-YYYY').format('YYYY-MM-DD');
        
         //let indiviualcollectionQuery=` select Users.FirstName,Users.LastName,PatientDetails.RegisteredBy,sum(PatientDetails.ActualAmount) as ActualAmount,sum(PatientDetails.GrossAmount)as GrossAmount,sum(PatientDetails.CashPayment) as CashPayment,sum(PatientDetails.OnlinePayment) as OnlinePayment,sum(PatientDetails.DuesAmount) as DuesAmount, sum(PatientDetails.Discount) as discount from PatientDetails JOIN USERS on Users.Id =PatientDetails.RegisteredBy and PatientDetails.Status < 2 WHERE PatientDetails.RegisteredBy IN(SELECT DISTINCT PatientDetails.RegisteredBy where PatientDetails.RegisteredOn between "${fromDate}" And "${toDate}") GROUP BY PatientDetails.RegisteredBy`;
         const indiviualcollectionQuery=`select UserId,sum(CreditCash) as cashPayment,sum(CreditOnline) 
                                        as onlinePayment,sum(Debit) as Debit ,Users.FirstName,
                                        Users.LastName from TransactionTable JOIN Users ON 
                                        Users.Id= TransactionTable.UserId 
                                        where TransactionTable.transactedOn 
                                        between  "${fromDate}" And "${toDate}" Group By Users.Id;`
            console.log(indiviualcollectionQuery);
            console.log('omg so much big makri ')
        //let totalCollectionQuery=``;
        // let registeredOn=currDateAndTime.getCurrentDateAndTime()[0]
       // from Transactiontable where Transactiontable.UserId IN(SELECT DISTINCT TransactionTable.UserID where TransactionTable.TransactedOn between "${fromDate}" And "${toDate}") GROUP BY TransactionTable.UserId;`
        try {
            const [individualCollection]  = await dbConnection.connection.promise().query(indiviualcollectionQuery)
            return individualCollection
        } catch (error) {
            console.log(error)
            throw error
        }
            
}

/**
 * 
 * @param {*} req 
 * @returns totalCollectionObject
 */
const totalCollection =async(req)=>{
   
        try {
                   /* if(Object.keys(req.body).length === 0){
                        fromDate=currDateAndTime.getCurrentDateAndTime()[0]
                        toDate=currDateAndTime.getCurrentDateAndTime()[0]
                }else{
                        fromDate=currDateAndTime.parseDate(req.body.FromDate);
                        toDate=currDateAndTime.parseDate(req.body.ToDate)
                }*/
        const fromDate = moment(req.body?.FromDate ?? moment().format('DD-MM-YYYY'), 'DD-MM-YYYY').format('YYYY-MM-DD');
        const toDate = moment(req.body?.ToDate ?? moment().format('DD-MM-YYYY'), 'DD-MM-YYYY').format('YYYY-MM-DD');
        
         let totalCollectionQuery=`select sum(ActualAmount) as ActualAmount,sum(DuesAmount) as DuesAmount,sum(Discount) as Discount, sum(CashPayment) as cashPayment,sum(OnlinePayment) as onlinePayment from PatientDetails where Status = 1 And RegisteredOn between "${fromDate}" And "${toDate}";`
         //console.log(totalCollection);
            const [totalCollection]= await dbConnection.connection.promise().query(totalCollectionQuery)
            return totalCollection
   }catch(error){
    console.log(error)
    throw error
   }
}
/**
 * 
 * @param {*} req 
 * @returns 
 */
const totalDuesReceived = async(req)=>{
    
        try {
            /*if(Object.keys(req.body).length === 0){
                fromDate=currDateAndTime.getCurrentDateAndTime()[0]
                toDate=currDateAndTime.getCurrentDateAndTime()[0]
        }else{
                fromDate=currDateAndTime.parseDate(req.body.FromDate);
                toDate=currDateAndTime.parseDate(req.body.ToDate)
        }*/
        const fromDate = moment(req.body?.FromDate ?? moment().format('DD-MM-YYYY'), 'DD-MM-YYYY').format('YYYY-MM-DD');
        const toDate = moment(req.body?.ToDate ?? moment().format('DD-MM-YYYY'), 'DD-MM-YYYY').format('YYYY-MM-DD');
        
          let totalDuesCollectionQuery=  `select sum(CashPayment) As duesReceivedAsCash,sum(OnlinePayment) As duesReceivedAsOnline from DailyDuesReceived where ReceivedOn between "${fromDate}" And "${toDate}";`
          console.log(totalDuesCollectionQuery);
          console.log('totalDuesCollectionQuery')
            const [totalDuesReceived]= await dbConnection.connection.promise().query(totalDuesCollectionQuery)
            return totalDuesReceived
                                                       
        } catch (error) {
            console.log(error)
            throw error
        }
    }
/**
 * 
 * @returns 
 * This will give cancelled patient Details.
 * it is called from Patient.js
 */
const getCancelledPatientDetails= async(req)=>{
    try {
        //const = req.body.FromDatemoment().format('YYYY-MM-DD')
       // const = req,body.
        const startDateRange = moment(req.body?.FromDate ?? moment().format('DD-MM-YYYY'), 'DD-MM-YYYY').format('YYYY-MM-DD');
        const endDateRange = moment(req.body?.ToDate ?? moment().format('DD-MM-YYYY'), 'DD-MM-YYYY').format('YYYY-MM-DD');
        
        const cancelledPatientQuery=`SELECT 
                                            pd.Name,
                                            pd.Id,
                                            SUM(pd.CashPayment + pd.OnlinePayment) AS TotalPaymentReturned,
                                            DATE_FORMAT(pd.RegisteredOn, '%d-%m-%Y') AS RegisteredOn,
                                            DATE_FORMAT(cpl.CancelledOn, '%d-%m-%Y') AS CancelledOn
                                        FROM 
                                            PatientDetails pd
                                        JOIN 
                                            CancelledPatientList cpl ON pd.Id = cpl.PatientId
                                        WHERE 
                                            cpl.CancelledOn BETWEEN ? AND ?
                                        GROUP BY 
                                            pd.Name, pd.Id, pd.RegisteredOn, cpl.CancelledOn;`
        const [cancelledPatientDetails]= await dbConnection.connection.promise().query(cancelledPatientQuery,[startDateRange,endDateRange])
        return cancelledPatientDetails || []
    } catch (error) {
        console.log(error)
        throw error
    }
}
let getTemplateDataForTest=async (testId,gender)=>{
        return new Promise((resolve,reject)=>{
            try {
                let template=gender[0].Gender+'Template'
                var x= dbConnection.connection.execute(`select ?  as Template from MainTestTable where Id=?`,[template,testId],function(error,result){
                 if(error)
                    throw error
                   // console.log(x.sql)
                if(result.length >=0 )
                    resolve(result);
                })
            } catch (error) {
    
    }})
}
let getGenderOfPatientForReport= async(patientId)=>{
    return new Promise((resolve,reject)=>{
        try {
               //we have to get to know whether patient is male or female ,based on gender template will be loaded
               var z= dbConnection.connection.execute("select Gender from PatientDetails where Id=?",[patientId],function(error,gender){
                if(error) throw error
                if(gender.length>=0)
                    resolve(gender)
            })
        } catch (error) {
            reject(error)
        }
    })
}
let getSavedReportData= async(patientId,testId)=>{
    return new Promise((resolve,reject)=>{
        try {
           var x=  dbConnection.connection.execute( "select Report from PatientTestRefference where PatientId=? and TestId=?",[patientId,testId],function(error,result){
                if(error)
                    throw error
                if(result.length>=0)
                    resolve(result);
            })
        } catch (error) {
            reject(error)
        }
    })
   }
/**
 * 
 * @param {*} req 
 * @returns 
 */
const saveReport = async (req) => {
    try {
      const { patientId, testId } = req.query;
      const report = req.body.patientReport;
  
      if (!patientId || !testId || !report) {
        throw new Error('Missing patientId, testId, or report.');
      }
  
      const [result] = await dbConnection.connection.promise().execute(
        "UPDATE PatientTestRefference SET Report = ?, ReportReady = 1 WHERE PatientId = ? AND TestId = ?",
        [report, patientId, testId]
      );
  
      if (result.affectedRows > 0) {
        return 'Final Report has been saved.';
      } else {
        throw new Error('No record updated. Check PatientId and TestId.');
      }
    } catch (error) {
      throw error;
    }
  };
  

   let getReportData =async(patientId,testId)=>{
        return new Promise((resolve,reject)=>{
            try {
                var x= dbConnection.connection.execute("select Report from PatientTestRefference where ReportReady=1 and PatientId=? and TestId=?",[patientId,testId],function(error,result){
                   // console.log(result)
                    if(error)
                        throw error;
                    if(result.length>0)
                        resolve(result)
                })
            } catch (error) {
                reject(error)
            }
                
        })
    }

/*let getDiscountReport = async(req)=>{
    return new Promise((resolve,reject)=>{
        try {
            console.log('in report model')
          let fromDate=''
          let toDate=''
           if(typeof req.body.FromDate != "undefined")
                    fromDate=currDateAndTime.parseDate(req.body.FromDate);
            else 
                    fromDate=currDateAndTime.getCurrentDateAndTime()[0]
            
            if(typeof req.body.ToDate != "undefined")
                    toDate=currDateAndTime.parseDate(req.body.ToDate);
            else 
                    toDate=currDateAndTime.getCurrentDateAndTime()[0]
          // let fromDate = currDateAndTime.parseDate();
           //let toDate = currDateAndTime.parseDate(req.body.ToDate);
console.log('hi i i ')
            let whereArr = [];
                whereArr.push('PatientDetails.Discount>0')
            if (typeof req.body.Name!= "undefined" && req.body.Name != "") whereArr.push(`PatientDetails.Name  LIKE "%${req.body.Name}%"`);
            if (typeof req.body.Doctor != "undefined" && req.body.Doctor != "") whereArr.push(`DoctorId = "${req.body.Doctor}"`);
            if ((typeof fromDate!= "undefined" && fromDate != "") && (typeof toDate != undefined && toDate !=''))
                    whereArr.push(`PatientDetails.RegisteredOn between "${fromDate}" AND "${toDate}"`)
            
                    let  whereStr = whereArr.join(" AND ");



            var k= dbConnection.connection.execute(`select Title,Age,DuesAmount,ActualAmount,GrossAmount,PatientDetails.Id,Name,Discount,DiscountApprovedBy,DATE_FORMAT(RegisteredOn,'%d-%m-%y')as RegisteredOn,DoctorId,FirstName,LastName from PatientDetails Join DoctorDetails on PatientDetails.DoctorId= DoctorDetails.Id where ${whereStr}`,function(error,result){
                
                console.log(k.sql)
                
                if(error)
                    throw error
                if(result.length>=0)
                    resolve(result)   
            })
        } catch (error) {
            reject(error)
        }
    })
}*/
/**
 * 
 * @param {*} req 
 * @returns 
 * Improved Version
 */
let getDiscountReport = async (req) => {
    return new Promise((resolve, reject) => {
        try {
            console.log('in report model');

            let fromDate = req.body.FromDate ? currDateAndTime.parseDate(req.body.FromDate) : currDateAndTime.getCurrentDateAndTime()[0];
            let toDate = req.body.ToDate ? currDateAndTime.parseDate(req.body.ToDate) : currDateAndTime.getCurrentDateAndTime()[0];

            let whereArr = [];
            whereArr.push('PatientDetails.Discount > 0');

            if (req.body.Name) whereArr.push(`PatientDetails.Name LIKE "%${req.body.Name}%"`);
            if (req.body.Doctor) whereArr.push(`DoctorId = "${req.body.Doctor}"`);
            if (fromDate && toDate) whereArr.push(`PatientDetails.RegisteredOn BETWEEN "${fromDate}" AND "${toDate}"`);

            let whereStr = whereArr.join(" AND ");

            var query = `
                        SELECT 
                            PatientDetails.Title, 
                            PatientDetails.Age, 
                            PatientDetails.YMD, 
                            PatientDetails.PhoneNumber, 
                            PatientDetails.DuesAmount, 
                            PatientDetails.ActualAmount,
                            PatientDetails.Status, 
                            PatientDetails.GrossAmount, 
                            PatientDetails.Id AS PatientId,
                            PatientDetails.DiscountApprovedBy,
                            PatientDetails.DuesAmount,
                            PatientDetails.Name, 
                            PatientDetails.Discount, 
                            PatientDetails.DiscountApprovedBy, 
                            DATE_FORMAT(PatientDetails.RegisteredOn, '%d-%m-%y') AS RegisteredOn, 
                            PatientDetails.DoctorId As DoctorId,
                            DoctorDetails.FirstName AS DoctorFirstName,
                            DoctorDetails.LastName AS DoctorLastName,
                            DoctorDetails.Degree1 AS DoctorDegree1,
                            DoctorDetails.Degree2 AS DoctorDegree2,
                            DoctorDetails.Degree3 AS DoctorDegree3,
                            DoctorDetails.SpecialistIn AS DoctorSpecialistIn,
                            GROUP_CONCAT(MainTestTable.TestName SEPARATOR ', ') AS TestNames
                        FROM PatientDetails
                        JOIN DoctorDetails ON PatientDetails.DoctorId = DoctorDetails.Id
                        LEFT JOIN PatientTestRefference ON PatientDetails.Id = PatientTestRefference.PatientId
                        LEFT JOIN MainTestTable ON PatientTestRefference.TestId = MainTestTable.Id
                        WHERE ${whereStr}
                        GROUP BY PatientDetails.Id
            `;

            dbConnection.connection.execute(query, function (error, result) {
                console.log(query); // Debugging: Logs the query
                if (error) throw error;
                if (result.length >= 0) resolve(result);
            });

        } catch (error) {
            reject(error);
        }
    });
};

/**
 * 
 * @param {*} req 
 * @returns 
 * This is a process of uploading document so that different certificate can have 
 * the time line and user can see them and re apply for them.
 */
let uploadDocument = async (req) => {
    try {
        if (!req.files || Object.keys(req.files).length === 0) {
            console.log('No files uploaded');
            throw new Error('No files have been uploaded.');
        }

        // Validate required fields
        if (!req.body.validFrom || !req.body.validUpto) {
            throw new Error('Both validFrom and validUpto are required.');
        }

        let validFrom, validUpto;

        // Convert 'DD-MM-YYYY' to 'YYYY-MM-DD' using moment.js
        if (moment(req.body.validFrom, 'DD-MM-YYYY', true).isValid()) {
            validFrom = moment(req.body.validFrom, 'DD-MM-YYYY').format('YYYY-MM-DD');
        } else {
            throw new Error('Invalid date format for validFrom. Expected format: DD-MM-YYYY');
        }

        if (moment(req.body.validUpto, 'DD-MM-YYYY', true).isValid()) {
            validUpto = moment(req.body.validUpto, 'DD-MM-YYYY').format('YYYY-MM-DD');
        } else {
            throw new Error('Invalid date format for validUpto. Expected format: DD-MM-YYYY');
        }

        //let fileToBeUploaded = req.files.documentUpload;
         // Ensure the specific file field exists
         let fileToBeUploaded = req.files.documentUpload;
         if (!fileToBeUploaded) {
             throw new Error('No document file found in the request.');
         }
        let fileName = `${Date.now()}-${fileToBeUploaded.name}`;
        let uploadPath = `./uploads/${fileName}`;

        let documentDetails = {
            CategoryId: req.body.documentCategory,
            ValidFrom: validFrom,
            ValidUpto: validUpto,
            DocumentName: fileName,
            UploadedBy: req.user.Id,
            UploadedOn: moment().format('YYYY-MM-DD HH:mm:ss') // Correct format for timestamps
        };

        console.log('Document details:', documentDetails);

        // Insert document details into the database
        await dbConnection.connection.promise().query('INSERT INTO Document SET ?', documentDetails);

        // Move the uploaded file
        await fileToBeUploaded.mv(uploadPath);

        console.log('Document uploaded successfully.');
        return 'Document uploaded successfully.';
        
    } catch (error) {
        console.error('Upload failed:', error.message);
        throw error;
    }
};

let getDocumentDetails = async(documentCategoryId='',documentName='')=>{     
    let query = `
        SELECT
            Document.Id,
            Document.CategoryId,
            Document.DocumentName,
            DATE_FORMAT(Document.ValidFrom, '%d-%m-%y') AS ValidFrom,
            DATE_FORMAT(Document.ValidUpto, '%d-%m-%y') AS ValidUpto,
            Document.UploadedBy,
            DATE_FORMAT(Document.UploadedOn, '%d-%m-%y') AS UploadedOn,
            DocumentCategory.Name,
            Users.FirstName,
            Users.LastName
        FROM
            Document
        JOIN
            DocumentCategory ON DocumentCategory.Id = Document.CategoryId
        JOIN
            Users ON Users.Id = Document.UploadedBy
    `;

    let conditions = [];
    let values = [];

    // Add conditions dynamically
    if (documentName) {
        conditions.push("Document.DocumentName LIKE ?");
        values.push(`%${documentName}%`); // Using wildcard for partial matches
    }
    if (documentCategoryId) {
        conditions.push("Document.CategoryId = ?");
        values.push(documentCategoryId);
    }
                            
    // Append WHERE clause only if there are conditions
    if (conditions.length > 0) {
        query += " WHERE " + conditions.join(" AND ");
    }

    try {
        const [results] = await dbConnection.connection.promise().query(query, values);
        console.log(results)
        console.log('ioiioioioioioi')
        return results;
    } catch (error) {
        console.error("Database Query Error:", error);
        throw error;
    }
     
 }

/**
 * 
 * @param {*} documentId 
 * @param {*} document 
 * @returns 
 * This deletes the document which are uploaded
 */

let deleteDocument = async (documentId, document) => {
    try {
        // Execute delete query
        const [result] = await dbConnection.connection.promise().execute(
            `DELETE FROM Document WHERE Id = ?`,
            [documentId]
        );

        // Check if any document was actually deleted
        if (result.affectedRows === 0) {
            return 'Either document does not exist or has already been deleted.';
        }

        // Construct file path
        const filePath = `./uploads/${document.DocumentName}`;

        try {
            // Remove file from server
            fs.unlink(filePath).catch((fsError) => {
                console.error('File deletion error:', fsError);
                throw fsError
            });
            return 'Document is successfully deleted.';
        } catch (fsError) {
            console.error('File deletion error:', fsError);
            return 'File removed from Database, but could not be deleted from server.';
        }
    } catch (error) {
        console.error('Database error:', error);
        throw error;
    }
};


let getDocumentName = async (documentId) => {
    try {
        const [rows] = await dbConnection.connection.promise().query(
            `SELECT DocumentName FROM Document WHERE Id = ?`,
            [documentId]  // Ensure documentId is passed as an array
        );
        
        return rows.length > 0 ? rows[0].DocumentName : null;  // Handle empty result set
    } catch (error) {
        console.error("Error fetching document name:", error);
        throw error;
    }
};

const generateLink = async(patientId,testId)=>{
    return new Promise((resolve,reject)=>{
        try {
           
            const randomNum = Math.random();
            const expiresAt = new Date(Date.now() + process.env.EXPIRES_AT * 60 * 60 * 1000); // Link valid for 1 hour
            const query = 'INSERT INTO TemporaryLinks (TestId,PatientId, Token, ExpiresAt) VALUES (?, ?, ?, ?)';
          //  console.log(mysql.format(query,[testId, patientId, randomNum, expiresAt]));
            dbConnection.connection.query(query, [testId, patientId, randomNum, expiresAt], (err, result) => {
               if (err) throw err
               // Create the link (replace baseUrl with your actual domain)
                const baseUrl = 'http://localhost:8000';
                const link = `${baseUrl}/report/downloadwReportFromLink/${randomNum}`
                const encodedMessage = encodeURIComponent(`Here is your report link: ${link}`);
                const whatsappLink = `https://web.whatsapp.com/send?phone=${process.env.PHONENUMBER}&text=${encodedMessage}`;
                console.log(link)
    // Send the WhatsApp link back to the client or use in another communication method
                resolve ( whatsappLink );   
            })
        } catch (error) {

            reject(error)
        }

    })
}

/*const checkToken= async(req,res)=>{
    return new Promise((resolve,reject)=>{

        try {
    const token = req.params.token
    let query = "select * from TemporaryLinks where token =?"
    console.log(mysql.format(query,[token]))
    dbConnection.connection.execute(query,[token],function(error,result){
        if(error) throw error

        console.log(result)
        if(result.length>0)
            resolve(result)

            const { report_id, expires_at } = result[0];
            const now = new Date();
        
            // Check if the link has expired
            if (now > expires_at) {
              return res.status(403).send('Link expired');
            }
        
    })
        } catch (error) {
            
        }

    })
    
}*/

const checkToken = async (req, res) => {
    return new Promise((resolve, reject) => {
      try {
        const token = req.params.token;
        let query = "SELECT * FROM TemporaryLinks WHERE token = ?";
        
        dbConnection.connection.execute(query, [token], (error, result) => {
          if (error) {
            console.error("Database query error:", error);
            reject({ status: 500, message: "Internal server error" });
            return;
          }
  
          if (result.length > 0) {
            console.log(result);
            resolve(result);
          } else {
            reject({ status: 404, message: "Token not found" });
          }
        });
      } catch (error) {
        console.error("Unexpected error:", error);
        reject({ status: 500, message: "Internal server error" });
      }
    });
  };
  
  const getdataForPathologyReport = async (patientId,testId,age,ageUnit,gender) => {
    const sql = `
                SELECT 
                tsp.Header,
                tsp.HeaderOrder,
                tsp.Id AS SubParameterId,
                tsp.SubParameterName,
                tsp.SubParameterOrder,
                tsp.Unit,
                spr.AgeMin,
                spr.AgeMax,
                spr.MinVal,
                spr.MaxVal,
                spr.Gender,
                spr.AgeUnit,
                ppd.Value AS currentValue,         -- Existing patient value if present
                ppd.StatusSymbol AS statusSymbol   -- Existing status symbol if present
            FROM 
                TestSubParametersForPathology tsp
            JOIN 
                PathoTestLinkedWithParameters ptlp ON tsp.Id = ptlp.SubParameterId
            LEFT JOIN 
                SubParameterRanges spr ON tsp.Id = spr.SubParameterId
            LEFT JOIN 
                PatientPathologicalData ppd ON tsp.Id = ppd.SubParameterId 
                    AND ppd.PatientId = ? 
                    AND ppd.TestId = ?
            WHERE 
                ptlp.TestId = ?
                AND (spr.AgeMin <= ? AND spr.AgeMax >= ?)
                AND (spr.Gender = ?)
                AND (spr.AgeUnit = ?)
            ORDER BY 
                tsp.HeaderOrder, tsp.SubParameterOrder;
            `
    try {

        console.log(mysql.format(sql,[patientId,testId,testId, age, age, gender, ageUnit]))
        console.log('in mic tes')
        const [results] = await dbConnection.connection.promise().execute(sql, [patientId,testId,testId, age, age, gender, ageUnit]);
        return results;
    } catch (error) {
        console.error("Error fetching pathology report data:", error);
        throw new Error("Failed to retrieve pathology report data");
    }
  };

  /*const insertPathologicalData = async (patientId, patientData, testId) => {
    const connection = dbConnection.connection.promise(); // Simplify connection access
    try {
        // Start transaction
        await connection.beginTransaction();

        // Construct the values for bulk insert
        const values = Object.entries(patientData).map(([id, { value, status }]) => [
            patientId, testId, id, value, status
        ]);

        // Debugging logs
        console.log("Preparing to insert bulk values...");
        console.log(
            mysql.format(
                `INSERT INTO PatientPathologicalData (PatientId, TestId, SubParameterId, Value, StatusSymbol) VALUES ?`,
                [values]
            )
        );

        // Execute the bulk insert
        const insertQuery =  `INSERT INTO PatientPathologicalData (PatientId, TestId, SubParameterId, Value, StatusSymbol) VALUES ?`
        await connection.query(insertQuery, [values]);

        // Commit transaction if successful
        await connection.commit();
        console.log("Data inserted successfully and transaction committed.");
        
        // Return success message
        return  "Pathological data inserted successfully." ;
    } catch (error) {
        // Roll back if there was an error
        console.error("Error inserting data into PatientPathologicalData:", error);
        await connection.rollback();
        
        // Return error message
        throw error;
    }
};*/
/**
 * 
 * @param {*} patientId 
 * @param {*} patientData 
 * @param {*} testId 
 * @returns 
 * This function update if key found else insert pathological data
 */
const insertPathologicalData = async (patientId, patientData, testId) => {
    const connection = dbConnection.connection.promise(); // Simplify connection access
    try {
        // Start transaction
        await connection.beginTransaction();

        // Construct the values for bulk upsert
        const values = Object.entries(patientData).map(([id, { value, status }]) => [
            patientId, testId, id, value, status
        ]);

        // Debugging logs
        console.log("Preparing to upsert bulk values...");
        console.log(
            mysql.format(
                `INSERT INTO PatientPathologicalData 
                (PatientId, TestId, SubParameterId, Value, StatusSymbol) 
                VALUES ? 
                ON DUPLICATE KEY UPDATE 
                Value = VALUES(Value), 
                StatusSymbol = VALUES(StatusSymbol)`,
                [values]
            )
        );

        // Execute the bulk upsert
        const upsertQuery = `
            INSERT INTO PatientPathologicalData 
            (PatientId, TestId, SubParameterId, Value, StatusSymbol) 
            VALUES ? 
            ON DUPLICATE KEY UPDATE 
            Value = VALUES(Value), 
            StatusSymbol = VALUES(StatusSymbol)`;
        await connection.query(upsertQuery, [values]);

        // Commit transaction if successful
        await connection.commit();
        console.log("Data upserted successfully and transaction committed.");
        
        // Return success message
        return "Pathological data upserted successfully.";
    } catch (error) {
        // Roll back if there was an error
        console.error("Error upserting data into PatientPathologicalData:", error);
        await connection.rollback();
        
        // Return error message
        throw error;
    }
};

const  getPatientPathoTestData= async(patientId, testId)=>{

    console.log('i m in patho')
    const query = `
                    SELECT 
                            SubParameterId, Value, StatusSymbol
                    FROM 
                            PatientpathologicalData
                    WHERE 
                            PatientId = ? AND TestId = ?
                `;

    try {
console.log('hjihhihihih')
        console.log(mysql.format(query,[patientId,testId]))
        const [rows] = await dbConnection.connection.promise().execute(query, [patientId, testId]);
        console.log(rows)

        // If no data is found, return an empty object
        if (rows.length === 0) {
            return {}; // Empty object means no saved data yet
        }

        // Transform rows into a key-value object based on sub_parameter_id
        const savedData = {};
        rows.forEach(row => {
            savedData[row.SubParameterId] = {
                value: row.Value || null,  // Null if no value exists
                status: row.StatusSymbol || '↔'  // Default to '↔' if no status exists
            };
        });

        return savedData;
    } catch (error) {
        console.error('Error fetching patient test data:', error);
        throw error;
    }
}
/*const getPatientHistory = async()=>{
    try {
        const patientHistoryQuery=`SELECT 
                                        pdh.Id AS ChangeID,
                                        pdh.Title AS ChangedField,
                                        pdh.Name AS PatientName,
                                        pdh.Age AS Age,
                                        pdh.YMD AS YMD,
                                        pdh.Gender AS Gender,
                                        pdh.PhoneNumber AS PhoneNumber,
                                        pdh.ActualAmount AS ActualAmount,
                                        pdh.GrossAmount AS GrossAmount,
                                        pdh.Discount AS DiscountValue,
                                        pdh.DiscountApprovedBy AS DiscountApprovedBy,
                                        pdh.ClinicId AS ClinicId,
                                        pdh.DoctorId AS DoctorId,
                                        pdh.DuesAmount AS DueAmount,
                                        pdh.cashPayment AS CashPayment,
                                        pdh.onlinePayment AS OnlinePayment,
                                        DATE_FORMAT(pdh.changeTime, '%Y-%m-%d') AS ChangeTimestamp,
                                        pdh.ModifiedBy AS ModifiedByUser,
                                        pdh.ChangeType AS TypeOfChange
                                    FROM 
                                        PatientDetailsHistory pdh
                                    LEFT JOIN 
                                        PatientDetails pd ON pd.Id = pdh.Id
                                    ORDER BY 
                                        pdh.changeTime DESC;`
        
        const [patientHistoryResult]=await dbConnection.connection.promise().query(patientHistoryQuery)
            return patientHistoryResult
    } catch (error) {
        console.error("Error fetching patient history:", error.message, error.stack);
        throw new Error("Some error occurred while fetching patient history details.");
    }
}*/

const searchDocumentDetails= async(documentCategoryId,documentName)=>{
    try {
        const documentDetails= await dbConnection.connection.promise().query()
    } catch (error) {
        
    }

}

const getCategoryWisePatient= async(req)=>{

    try {
        // Extract and format FromDate & ToDate
        // Use query first, fallback to params, then default to today
        let FromDate = req.query?.FromDate || req.params?.FromDate || moment().format('DD-MM-YYYY');
        let ToDate = req.query?.ToDate || req.params?.ToDate || moment().format('DD-MM-YYYY');

        //convert it to YYYY-MM-DD
        FromDate= moment(FromDate,'DD-MM-YYYY').format('YYYY-MM-DD')
        ToDate= moment(ToDate,'DD-MM-YYYY').format('YYYY-MM-DD')

             const categoryWisePatientListQuery=`SELECT 
                                                        c.Name AS CategoryName,
                                                        c.Id as CategoryId,
                                                        COUNT(*) AS TestCount,
                                                        SUM(mt.Price) AS TotalPrice,
                                                        SUM(ptr.Discount) AS TotalDiscount
                                                    FROM 
                                                        PatientDetails pd
                                                    JOIN 
                                                        PatientTestRefference ptr ON pd.Id = ptr.PatientId
                                                    JOIN 
                                                        MainTestTable mt ON ptr.TestId = mt.Id
                                                    JOIN 
                                                        Category c ON mt.CategoryId = c.Id
                                                    WHERE 
                                                        pd.RegisteredOn BETWEEN ? AND ?   -- Provide date range here
                                                        AND pd.Status = 1                 -- Only active patients
                                                    GROUP BY 
                                                        c.Id, c.Name;
                                                    `
             console.log(mysql.format(categoryWisePatientListQuery,[FromDate,ToDate]))
             const [categoryWisePatientList]=await dbConnection.connection.promise().query(categoryWisePatientListQuery,[FromDate,ToDate])
             console.log(categoryWisePatientList); 
             return categoryWisePatientList;
       
    } catch (error) {
        console.log(error)
        throw error
    }
}
/**
 * 
 * @param {*} CategoryId 
 * @param {*} FromDate is in DD-MM-YYYY
 * @param {*} ToDate  is in DD-MM-YYYY
 * @returns 
 */
const getTestWiseCollection= async(CategoryId,FromDate,ToDate)=>{

    try {
        //convert it from dd-mm-yyy to yyyy-dd-mm
        const fromDate= moment(FromDate,'DD-MM-YYYY').format('YYYY-MM-DD')
        const toDate= moment(ToDate,'DD-MM-YYYY').format('YYYY-MM-DD')
            const query=`SELECT 
                                mt.TestName AS TestName,
                                COUNT(*) AS TestCount,
                                SUM(mt.Price) AS TotalPrice,
                                SUM(ptr.Discount) AS TotalDiscount
                            FROM 
                                PatientDetails pd
                            JOIN 
                                PatientTestRefference ptr ON pd.Id = ptr.PatientId
                            JOIN 
                                MainTestTable mt ON ptr.TestId = mt.Id
                            JOIN 
                                Category c ON mt.CategoryId = c.Id
                            WHERE 
                                pd.RegisteredOn BETWEEN ? AND ?         -- Date range
                                AND mt.CategoryId = ?                   -- Filter by category
                                AND pd.Status = 1
                            GROUP BY 
                                mt.Id, mt.TestName
                            ORDER BY 
                                TotalPrice DESC;`
                                console.log(mysql.format(query,[fromDate,toDate,CategoryId]))
            const [rows]= await dbConnection.connection.promise().query(query,[fromDate,toDate,CategoryId])
            console.log(rows)
            return rows || []
    } catch (error) {
        
        console.log(error)
        throw error
    }

}



const getDoctorPatientServiceReportWithMonthlyBreakdown = async (categoryId, fromDate, toDate) => {
  const startDate = moment(fromDate, 'DD-MM-YYYY').startOf('month');
  const endDate = moment(toDate, 'DD-MM-YYYY').endOf('month');

  // 1. Generate month keys and labels (e.g., '2024-04' => 'April-24')
  const monthKeys = [];
  const monthLabels = [];

  const tempDate = moment(startDate);

  while (tempDate.isSameOrBefore(endDate)) {
    monthKeys.push(tempDate.format('YYYY-MM'));
    monthLabels.push(tempDate.format('MMMM-YY')); // e.g., April-24
    tempDate.add(1, 'month');
  }

  // 2. Main query: doctor, month, patient count
  const query = `
    SELECT 
      d.Id AS DoctorId,
      CONCAT(d.FirstName, ' ', d.LastName, ' ', IFNULL(d.Degree1, '')) AS DoctorName,
      DATE_FORMAT(p.RegisteredOn, '%Y-%m') AS MonthKey,
      COUNT(DISTINCT p.Id) AS PatientCount
    FROM PatientDetails p
    JOIN DoctorDetails d ON p.DoctorId = d.Id
    JOIN PatientTestRefference ptr ON ptr.PatientId = p.Id
    JOIN MainTestTable mtt ON ptr.TestId = mtt.Id
    WHERE mtt.CategoryId = ?
      AND DATE(p.RegisteredOn) BETWEEN ? AND ?
    GROUP BY d.Id, MonthKey
    ORDER BY d.Id;
  `;

  try {
    const [rows] = await dbConnection.connection
      .promise()
      .query(query, [categoryId, startDate.format('YYYY-MM-DD'), endDate.format('YYYY-MM-DD')]);

    // 3. Organize rows doctor-wise and fill 0 where no data
    const doctorMap = new Map();

    for (const row of rows) {
      const doctorId = row.DoctorId;
      if (!doctorMap.has(doctorId)) {
        doctorMap.set(doctorId, {
          DoctorId: doctorId,
          DoctorName: row.DoctorName,
          MonthlyCounts: {}
        });
      }

      doctorMap.get(doctorId).MonthlyCounts[row.MonthKey] = row.PatientCount;
    }

    // 4. Format final result
    const finalReport = [];

    for (const [_, doctor] of doctorMap) {
      const row = {
        DoctorId: doctor.DoctorId,
        DoctorName: doctor.DoctorName
      };

      monthKeys.forEach((key, idx) => {
        row[monthLabels[idx]] = doctor.MonthlyCounts[key] || 0;
      });

      finalReport.push(row);
    }

    return {
      months: monthLabels,
      reportData: finalReport
    };

  } catch (error) {
    console.error("Error generating monthly report:", error);
    throw error;
  }
};

  
//export all the function
module.exports = {
    viewCollection: viewCollection,
    getTemplateDataForTest:getTemplateDataForTest,
    getSavedReportData:getSavedReportData,
    saveReport:saveReport,
    getReportData:getReportData,
    totalCollection:totalCollection,
    getGenderOfPatientForReport:getGenderOfPatientForReport,
    getDiscountReport:getDiscountReport,
    uploadDocument:uploadDocument,
    getDocumentDetails:getDocumentDetails,
    deleteDocument:deleteDocument,
    getDocumentName:getDocumentName,
    totalDuesReceived:totalDuesReceived,
    generateLink:generateLink,
    checkToken:checkToken,
    getdataForPathologyReport:getdataForPathologyReport,
    insertPathologicalData:insertPathologicalData,
    getPatientPathoTestData:getPatientPathoTestData,
   // getPatientHistory:getPatientHistory,
    getCancelledPatientDetails:getCancelledPatientDetails,
    searchDocumentDetails:searchDocumentDetails,
    getCategoryWisePatient:getCategoryWisePatient,
    getTestWiseCollection:getTestWiseCollection,
    getDoctorPatientServiceReportWithMonthlyBreakdown:getDoctorPatientServiceReportWithMonthlyBreakdown
   
  };
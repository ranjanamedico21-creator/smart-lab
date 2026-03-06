const currDateAndTime = require("../helper/helper");
const mysql = require('mysql2/promise'); // Use mysql2/promise for async/await support
const dbConnection = require("../config/DBConnection");

const getPatientEditHistory = async () => {
    const connection = await dbConnection.pool.getConnection();
  
    try {
      // Get the current date
      let date = currDateAndTime.getCurrentDateAndTime()[0];

      console.log(dbConnection)
      
      // Execute the first query to get patient IDs
      let queryForPatientIds = `SELECT Id FROM PatientDetails WHERE RegisteredOn=?`;
      const [rows] = await connection.execute(queryForPatientIds,[date]);

      console.log(rows)
      
      // Extract patient IDs from the result
      const patientIds = rows.map(row => row.Id);
      
      if (patientIds.length === 0) {
        return resolve([]); // No patients found for the given date
      }

      // Use the patientIds array in the next query for PatientDetailsHistory
      let queryForPatientDetailsHistory = `SELECT *, DATE_FORMAT(ChangeTime, '%d-%m-%y') AS changedTime 
        FROM PatientDetailsHistory
        JOIN DoctorDetails ON PatientDetailsHistory.DoctorId = DoctorDetails.Id 
        WHERE PatientDetailsHistory.PatientId IN (${patientIds.map(() => '?').join(',')}) 
        AND PatientDetailsHistory.ChangeTime = ?`;

      const [patientDetailsHistory] = await connection.execute(queryForPatientDetailsHistory, [...patientIds, date]);

      console.log(patientDetailsHistory)

      // Resolve the result
      return patientDetailsHistory;
      
    } catch (error) {
        //console.log(error)
      return error
    }

};

module.exports = {
  getPatientEditHistory:getPatientEditHistory
};

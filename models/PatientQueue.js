const dbConnection = require("../config/DBConnection");
const mysql = require("mysql2");

/**
 * Fetches all patients currently in the queue along with their details.
 *
 * - Joins PatientQueue with PatientDetails and Doctors.
 * - Formats time fields (Entry, Exit, PredictedEntry, PredictedExit).
 * - Orders results by creation time (oldest first).
 *
 * @returns {Promise<Array>} Array of patients in the queue with details.
 * @throws {Error} If the query fails.
 */
const getAllQueuePatients = async () => {
  try {
    const query = `
      SELECT 
        q.Id,
        q.PatientId,
        p.Name AS PatientName,
        p.Age,
        p.Gender,
        d.Name AS DoctorName,
        q.Status,
        TIME_FORMAT(q.PredictedEntryTime, '%H:%i') AS PredictedEntryTime,
        TIME_FORMAT(q.PredictedExitTime, '%H:%i') AS PredictedExitTime,
        TIME_FORMAT(q.EntryTime, '%H:%i') AS EntryTime,
        TIME_FORMAT(q.ExitTime, '%H:%i') AS ExitTime,
        q.CreatedAt,
        q.UpdatedAt
      FROM PatientQueue q
      JOIN PatientDetails p ON q.PatientId = p.Id
      LEFT JOIN Doctors d ON p.DoctorId = d.DoctorId
      ORDER BY q.CreatedAt ASC
    `;
    const [rows] = await dbConnection.connection.promise().query(query);
    return rows;
  } catch (error) {
    console.error("Error fetching patient queue:", error);
    throw error;
  }
};

/**
 * Inserts a new patient into the queue.
 *
 * @param {object} data - Patient queue data (e.g., PatientId, Status, etc.).
 * @returns {Promise<number>} The ID of the newly inserted queue record.
 * @throws {Error} If the query fails.
 */
const addPatientToQueue = async (data) => {
  try {
    const query = `INSERT INTO PatientQueue SET ?`;
    const [result] = await dbConnection.connection.promise().query(query, data);
    return result.insertId;
  } catch (error) {
    throw error;
  }
};

/**
 * Updates predicted start and end times for a patient in the queue.
 *
 * @param {number} queueId - The ID of the patient in the queue.
 * @param {string} start - Predicted start time (HH:mm:ss).
 * @param {string} end - Predicted end time (HH:mm:ss).
 * @returns {Promise<object>} Result of the update query.
 * @throws {Error} If the query fails.
 */
const updatePrediction = async (queueId, start, end) => {
  try {
    const query = `
      UPDATE PatientQueue 
      SET PredictedStartTime=?, PredictedEndTime=? 
      WHERE QueueId=?
    `;
    const [result] = await dbConnection.connection.promise().query(query, [
      start,
      end,
      queueId,
    ]);
    return result;
  } catch (error) {
    throw error;
  }
};

/**
 * Marks a patient as acknowledged by a user.
 *
 * - Sets Acknowledged flag to true.
 * - Records timestamp and user who acknowledged.
 *
 * @param {number} queueId - Queue ID of the patient.
 * @param {number} userId - ID of the user acknowledging the patient.
 * @returns {Promise<object>} Result of the update query.
 * @throws {Error} If the query fails.
 */
const acknowledgePatient = async (queueId, userId) => {
  try {
    const now = new Date();
    const query = `
      UPDATE PatientQueue 
      SET Acknowledged=1, AcknowledgedAt=?, AcknowledgedBy=? 
      WHERE QueueId=?
    `;
    const [result] = await dbConnection.connection.promise().query(query, [
      now,
      userId,
      queueId,
    ]);
    return result;
  } catch (error) {
    throw error;
  }
};

/**
 * Marks a patient as entered into the test room.
 *
 * - Updates EntryTime to NOW() in PatientQueue.
 *
 * @param {number} patientId - ID of the patient.
 * @returns {Promise<object>} Result of the update query.
 * @throws {Error} If the query fails.
 */
const markEntry = async (patientId) => {
  try {
    const query = "UPDATE PatientQueue SET EntryTime = NOW() WHERE PatientId = ?";
    const [rows] = await dbConnection.connection.promise().query(query, [patientId]);
    return rows;
  } catch (error) {
    console.error("Error in markEntry:", error);
    throw error;
  }
};

/**
 * Marks a patient as exited from the test room (test completed).
 *
 * - Updates ExitTime to NOW() in PatientQueue.
 *
 * @param {number} patientId - ID of the patient.
 * @returns {Promise<object>} Result of the update query.
 * @throws {Error} If the query fails.
 */
const markExit = async (patientId) => {
  try {
    const query = "UPDATE PatientQueue SET ExitTime = NOW() WHERE PatientId = ?";
    const [rows] = await dbConnection.connection.promise().query(query, [patientId]);
    return rows;
  } catch (error) {
    console.error("Error in markExit:", error);
    throw error;
  }
};


module.exports = {
  getAllQueuePatients:getAllQueuePatients,
  addPatientToQueue:addPatientToQueue,
  updatePrediction:updatePrediction,
  acknowledgePatient:acknowledgePatient,
  markEntry:markEntry,
  markExit:markExit
};

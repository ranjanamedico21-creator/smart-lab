const dbConnection = require("../config/DBConnection");
const moment = require('moment');
const mysql = require('mysql2/promise'); // Use mysql2/promise for async/await support

/**
 * Insert a timeline event for a patient
 * @param {number} patientId - Patient ID
 * @param {string} eventType - Event type (e.g. "Entered", "TestStarted")
 * @param {number} userId - ID of the user creating the event
 * @param {string|null} notes - Optional notes for the event
 * @returns {Promise<number>} Inserted event ID
 */
const insertTimelineEvent = async (patientId, eventType, userId, notes = null) => {
  try {
    const query = `
      INSERT INTO PatientTimeline (PatientId, EventType, CreatedBy, Notes)
      VALUES (?, ?, ?, ?)
    `;
    const [result] = await dbConnection.connection
      .promise()
      .query(query, [patientId, eventType, userId, notes]);
    return result.insertId;
  } catch (error) {
    console.error("Error in insertTimelineEvent:", error);
    throw error;
  }
};

/**
 * Get all timeline events for a patient
 * @param {number} patientId - Patient ID
 * @returns {Promise<Array>} List of timeline events
 */
const getTimelineByPatient = async (patientId) => {
  try {
    const query = `SELECT * FROM PatientTimeline WHERE PatientId = ? ORDER BY EventTime ASC`;
    const [rows] = await dbConnection.connection.promise().query(query, [patientId]);
    return rows;
  } catch (error) {
    console.error("Error in getTimelineByPatient:", error);
    throw error;
  }
};

/**
 * Mark entry event
 */
const markEntry = async (patientId, userId) => {
  try {
    return await insertTimelineEvent(patientId, 'Entered', userId);
  } catch (error) {
    console.error("Error in markEntry:", error);
    throw error;
  }
};

/**
 * Mark test start event
 */
const markTestStart = async (patientId, userId) => {
  try {
    return await insertTimelineEvent(patientId, 'TestStarted', userId);
  } catch (error) {
    console.error("Error in markTestStart:", error);
    throw error;
  }
};

/**
 * Mark test completion event
 */
const markTestComplete = async (patientId, userId) => {
  try {
    return await insertTimelineEvent(patientId, 'TestCompleted', userId);
  } catch (error) {
    console.error("Error in markTestComplete:", error);
    throw error;
  }
};

/**
 * Mark report ready event
 */
const markReportReady = async (patientId, userId) => {
  try {
    return await insertTimelineEvent(patientId, 'ReportReady', userId);
  } catch (error) {
    console.error("Error in markReportReady:", error);
    throw error;
  }
};

/**
 * Mark report delivered event
 */
const markReportDelivered = async (patientId, userId) => {
  try {
    return await insertTimelineEvent(patientId, 'ReportDelivered', userId);
  } catch (error) {
    console.error("Error in markReportDelivered:", error);
    throw error;
  }
};

module.exports = {
  insertTimelineEvent,
  getTimelineByPatient,
  markEntry,
  markTestStart,
  markTestComplete,
  markReportReady,
  markReportDelivered
};

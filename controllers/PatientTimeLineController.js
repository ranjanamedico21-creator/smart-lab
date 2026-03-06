const PatientTimeLineModel = require("../models/PatientTimeline");

/**
 * Adds a timeline event manually for a patient.
 *
 * Steps:
 * 1. Extracts patientId, eventType, and notes from request body.
 * 2. Uses the logged-in user's ID from req.user.
 * 3. Inserts a timeline event via PatientTimeLineModel.insertTimelineEvent().
 * 4. Returns a success JSON response if inserted successfully.
 *
 * @param {object} req - Express request object (expects patientId, eventType, notes in body, and user in req.user).
 * @param {object} res - Express response object used to return JSON response.
 */
const addEvent = async (req, res) => {
    try {
        const { patientId, eventType, notes } = req.body;
        const userId = req.user.Id; // Logged-in user

        await PatientTimeLineModel.insertTimelineEvent(patientId, eventType, userId, notes);

        res.status(200).json({ message: "Event added successfully" });
    } catch (error) {
        console.error("Error in addEvent:", error);
        res.status(500).json({ message: "Failed to add event" });
    }
};

/**
 * Fetches the timeline history of a specific patient.
 *
 * Steps:
 * 1. Extracts patientId from request params.
 * 2. Retrieves timeline events using PatientTimeLineModel.getTimelineByPatient().
 * 3. Returns the timeline as JSON response.
 *
 * @param {object} req - Express request object (expects patientId in params).
 * @param {object} res - Express response object used to return JSON response.
 */
const getPatientTimeline = async (req, res) => {
    try {
        const { patientId } = req.params;

        const timeline = await PatientTimeLineModel.getTimelineByPatient(patientId);

        res.status(200).json(timeline);
    } catch (error) {
        console.error("Error in getPatientTimeline:", error);
        res.status(500).json({ message: "Failed to fetch timeline" });
    }
};

/**
 * Marks patient entry into the test room as a quick action.
 *
 * Steps:
 * 1. Extracts patientId from request body.
 * 2. Uses logged-in user's ID from req.user.
 * 3. Calls PatientTimeLineModel.markEntry() to log entry event.
 * 4. Returns success JSON response.
 *
 * @param {object} req - Express request object (expects patientId in body and user in req.user).
 * @param {object} res - Express response object used to return JSON response.
 */
const markEntry = async (req, res) => {
    try {
        const { patientId } = req.body;
        const userId = req.user.Id;

        await PatientTimeLineModel.markEntry(patientId, userId);

        res.status(200).json({ message: "Entry marked successfully" });
    } catch (error) {
        console.error("Error in markEntry:", error);
        res.status(500).json({ message: "Failed to mark entry" });
    }
};


module.exports = { 
    addEvent:addEvent, 
    getPatientTimeline:getPatientTimeline, 
    markEntry:markEntry 
};

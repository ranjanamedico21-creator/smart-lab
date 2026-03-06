
const PatientQueue= require("../models/PatientQueue");
const axios = require('axios');
  
  /**
 * Retrieves the list of patients in the queue (with predictions if available).
 *
 * Steps:
 * 1. Calls PatientQueue.getAllQueuePatients() to fetch all patients in queue.
 * 2. Returns the list as a JSON response.
 * 3. If any error occurs, logs it and sends a 500 error response.
 *
 * @param {object} req - Express request object.
 * @param {object} res - Express response object used to return JSON response.
 */
const getQueue = async (req, res) => {
    try {
        // ✅ Fetch patients in queue
        const patients = await PatientQueue.getAllQueuePatients();

        // ✅ Return as JSON
        res.json(patients);
    } catch (err) {
        console.error("Error in getQueue:", err);
        res.status(500).json({ error: err.message });
    }
};

/**
 * Adds a new patient to the queue.
 *
 * Steps:
 * 1. Extracts patient data from request body.
 * 2. Calls PatientQueue.addPatientToQueue() to insert patient into queue table.
 * 3. Returns a JSON response with success status and new queueId.
 * 4. If any error occurs, logs it and sends a 500 error response.
 *
 * @param {object} req - Express request object (expects patient details in body).
 * @param {object} res - Express response object used to return JSON response.
 */
const addToQueue = async (req, res) => {
    try {
        // ✅ Add patient to queue
        const queueId = await PatientQueue.addPatientToQueue(req.body);

        // ✅ Return success response
        res.json({ success: true, queueId });
    } catch (err) {
        console.error("Error in addToQueue:", err);
        res.status(500).json({ error: err.message });
    }
};

  /**
 * Runs prediction for patient queue times using an external Python ML service.
 *
 * Steps:
 * 1. Fetches all patients currently in the queue from the database.
 * 2. Sends patient data to the ML service (`http://127.0.0.1:5000/predict`) via POST request.
 * 3. Receives predictions (start and end times) from the ML service.
 * 4. Updates each patient's prediction in the database using updatePrediction().
 * 5. Returns JSON response with success status and predictions.
 *
 * @param {object} req - Express request object.
 * @param {object} res - Express response object used to return JSON response.
 */
const predictTimes = async (req, res) => {
    try {
        // ✅ Get patients in queue
        const patients = await PatientQueue.getAllQueuePatients();

        // ✅ Call external ML service
        const response = await axios.post("http://127.0.0.1:5000/predict", { patients });

        // ✅ Update predictions in DB
        for (let p of response.data.predictions) {
            await updatePrediction(p.QueueId, p.PredictedStartTime, p.PredictedEndTime);
        }

        // ✅ Return predictions as JSON
        res.json({ success: true, predictions: response.data.predictions });
    } catch (err) {
        console.error("Error in predictTimes:", err);
        res.status(500).json({ error: err.message });
    }
};

/**
 * Acknowledges a patient in the queue by a specific user.
 *
 * Steps:
 * 1. Extracts queueId and userId from request body.
 * 2. Calls PatientQueue.acknowledgePatient(queueId, userId) to update status in DB.
 * 3. Returns a success message as JSON.
 * 4. If any error occurs, logs it and returns a 500 JSON response.
 *
 * @param {object} req - Express request object (expects queueId and userId in body).
 * @param {object} res - Express response object used to return JSON response.
 */
const acknowledge = async (req, res) => {
    try {
        const { queueId, userId } = req.body;

        // ✅ Update patient as acknowledged
        await PatientQueue.acknowledgePatient(queueId, userId);

        // ✅ Return success response
        res.json({ success: true, message: "Patient acknowledged" });
    } catch (err) {
        console.error("Error in acknowledge:", err);
        res.status(500).json({ error: err.message });
    }
};

  
/**
 * Fetches and displays the list of patients currently in the queue.
 *
 * Steps:
 * 1. Calls PatientQueue.getAllQueuePatients() to retrieve all patients in the queue.
 * 2. Renders the 'patientQueue' view with:
 *    - The list of patients in the queue.
 *    - Page title and brand name.
 *    - Logged-in user layout.
 * 3. If any error occurs, logs it and sends a 500 response.
 *
 * @param {object} req - Express request object.
 * @param {object} res - Express response object used to render the view or send error response.
 */
const listQueue = async (req, res) => {
    try {
        // ✅ Get all patients currently in queue
        const patientInQueue = await PatientQueue.getAllQueuePatients();

        // ✅ Render the queue view with required data
        res.render('patientQueue', {
            queue: patientInQueue,
            title: 'Patient Queue List',
            BRAND_NAME: process.env.BRAND_NAME,
            layout: 'loggedInLayout'
        });
    } catch (error) {
        console.error("Error loading patient queue:", error);

        // ✅ Send server error response
        res.status(500).send("Failed to load patient queue.");
    }
};

/**
 * Marks a patient as entered into the room (test starts now).
 *
 * Steps:
 * 1. Extracts patientId from request parameters.
 * 2. Validates that patientId exists.
 * 3. Calls PatientQueue.markEntry(patientId) to update entry status in DB.
 * 4. On success, sets a success message and redirects to patient detail page.
 * 5. On error, logs the issue, sets error message, and redirects back.
 *
 * @param {object} req - Express request object (expects patientId in params).
 * @param {object} res - Express response object used to redirect with query params.
 */
const markEntry = async (req, res) => {
    try {
        const patientId = req.params.patientId;

        // ✅ Validate Patient Id
        if (!patientId) {
            throw new Error("Patient Id is missing.");
        }

        // ✅ Mark patient as entered in database
        await PatientQueue.markEntry(patientId);

        // ✅ Add success message & redirect
        // ✅ Set a flash message
        req.flash('success', 'Patient is successfully marked as entered.');
        res.redirect(`/patient/getPatientDetail/?patientId=${patientId}`);
    } catch (error) {
        console.error("Error in markEntry:", error);

        // ✅ Add error flash message & redirect
        req.flash('danger',error);
        res.redirect(`/patient/getPatientDetail/?patientId=${patientId}`);
    }
};


/**
 * Marks a patient as exited from the queue.
 *
 * Steps:
 * 1. Extracts patientId from request parameters.
 * 2. Validates that patientId exists.
 * 3. Calls PatientQueue.markExit(patientId) to update exit status in DB.
 * 4. On success, sets a success message and redirects to patient detail page.
 * 5. On error, logs the issue, sets error message, and redirects back.
 *
 * @param {object} req - Express request object (expects patientId in params).
 * @param {object} res - Express response object used to redirect with query params.
 */
const markExit = async (req, res) => {
    let patientId;
    try {
        patientId = req.params.patientId;

        // ✅ Validate Patient Id
        if (!patientId) {
            throw new Error("Patient Id is missing.");
        }

        // ✅ Mark patient as exit in database
        await PatientQueue.markExit(patientId);

         // ✅ Add success message & redirect
        // ✅ Set a flash message
        req.flash('success', 'Patient is successfully marked as exit.');
        res.redirect(`/patient/getPatientDetail/?patientId=${patientId}`);
    } catch (error) {
        console.error("Error in markExit:", error);
        patientId= req.params.patientId;
        // ✅ Add error message & redirect
        req.flash('danger',error );
        res.redirect(`/patient/getPatientDetail/?patientId=${patientId}`);
    }
};


  //export all the function
module.exports = {
    acknowledge: acknowledge,
    predictTimes: predictTimes,
    addToQueue: addToQueue,
    getQueue: getQueue,
    listQueue:listQueue,
    markEntry:markEntry,
    markExit:markExit
  };
  
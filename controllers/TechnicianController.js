// ═══════════════════════════════════════════════════════════════════
// controllers/TechnicianController.js
// ═══════════════════════════════════════════════════════════════════
const Technician = require('../models/Technician');

const ALL_ROOM_CODES = ['USG', 'CT', 'MRI', 'XRAY', 'PATH'];

const getDashboard = async (req, res) => {
    try {
        const roomCodes = req.user.roles.includes('Admin')
            ? ALL_ROOM_CODES
            : req.user.roomCodes;

        if (!roomCodes.length) {
            return res.render('Technician/dashboard', {
                queue: [], roomCodes: [],
                error: 'Your account is not assigned to any room. Contact admin.',
                layout: 'loggedInLayout', title: 'Room Dashboard',
                BRAND_NAME: process.env.BRAND_NAME
            });
        }

        const queue = await Technician.getRoomDashboardQueue(roomCodes);

        res.render('Technician/dashboard', {
            queue, roomCodes,
            layout: 'loggedInLayout',
            title:  'Room Dashboard',
            BRAND_NAME: process.env.BRAND_NAME
        });

    } catch (err) {
        console.error('getDashboard error:', err);
        res.status(500).send('Error loading dashboard: ' + err.message);
    }
};

const startTest = async (req, res) => {
    try {
        await Technician.updateTestStatus(req.body.patientTestId, 'InProgress', req.user.Id);
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
};

const completeTest = async (req, res) => {
    try {
        const result = await Technician.updateTestStatus(req.body.patientTestId, 'Completed', req.user.Id);
        res.json({ success: true, allDone: result.allDone });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
};

const abortTest = async (req, res) => {
    try {
        await Technician.updateTestStatus(req.body.patientTestId, 'Aborted', req.user.Id, req.body.note);
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
};

const moveUp = async (req, res) => {
    try {
        const { queueId, roomCode } = req.body;
        const result = await Technician.movePatientUp(queueId, roomCode);
        res.json(result);
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
};

const saveOrder = async (req, res) => {
    try {
        const { orderedQueueIds } = req.body;
        if (!Array.isArray(orderedQueueIds) || !orderedQueueIds.length) {
            return res.json({ success: false, message: 'Invalid order data.' });
        }
        const result = await Technician.saveQueueOrder(orderedQueueIds);
        res.json(result);
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
};

const getQueueView = async (req, res) => {
    try {
        const techRoles = ['CT Technician','MRI Technician','Xray Technician','Lab Technician'];
        const isTech    = req.user.roles.some(r => techRoles.includes(r));
        const roomCodes = (isTech && !req.user.roles.includes('Admin'))
            ? req.user.roomCodes
            : ['USG','CT','MRI','XRAY','PATH'];

        const queue = await Technician.getRoomDashboardQueue(roomCodes);

        res.render('Technician/queueView', {
            queue, roomCodes,
            layout:     'loggedInLayout',
            title:      'Patient Queue',
            BRAND_NAME: process.env.BRAND_NAME
        });
    } catch (err) {
        console.error('getQueueView error:', err);
        res.status(500).send('Error: ' + err.message);
    }
};

const prioritisePatient = async (req, res) => {
    try {
        const { queueId, roomCode, note } = req.body;
        if (!note || !note.trim()) {
            return res.json({ success: false, message: 'Please enter a reason for prioritising.' });
        }
        const result = await Technician.prioritisePatient(queueId, roomCode, note.trim(), req.user.Id);
        res.json(result);
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
};

const moveToPosition = async (req, res) => {
    try {
        const { queueId, beforeQueueId, roomCode, note } = req.body;
        if (!note || !note.trim()) {
            return res.json({ success: false, message: 'Please enter a reason.' });
        }
        const result = await Technician.movePatientToPosition(
            queueId, beforeQueueId || null, roomCode, note.trim(), req.user.Id
        );
        res.json(result);
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
};


module.exports = { getDashboard, startTest, completeTest, abortTest, moveUp, saveOrder, getQueueView, prioritisePatient, moveToPosition };

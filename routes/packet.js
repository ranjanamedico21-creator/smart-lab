const express = require("express");
const router = express.Router();
const User = require("../models/User");
const PacketController = require("../controllers/PacketController")
const multer = require('multer');

// Excel only, 5 MB. A refused file comes back to the upload page with the reason.
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /\.xlsx$/i.test(file.originalname || '')),
});
const uploadSheet = (req, res, next) => upload.single('file')(req, res, (err) => {
  if (!err) return next();
  if (typeof req.flash === 'function') req.flash('flash', { type: 'danger', messages: 'The file must be an Excel .xlsx of at most 5 MB.', icon: 'bi-exclamation-triangle-fill' });
  return res.redirect(303, '/packet/uploadExcelView');
});

const canUpload = User.checkFunction(['/packet/upload']);
// Whoever may open the assign page. What he may do there is decided in the controller.
const canOpenBoard = User.checkFunction(['/packets', '/packet/packets', '/packet/assign', '/packet/assignReturned', '/packet/disable']);

// Upload
router.get("/uploadExcelView", User.checkLoggedIn, canUpload, PacketController.uploadPacketView);
router.post("/uploadExcel", User.checkLoggedIn, canUpload, uploadSheet, PacketController.uploadPacket);

// Assign page (admin + authorised people; others only take free packets for themselves)
router.get("/packets", User.checkLoggedIn, canOpenBoard, PacketController.getAllPacket);
router.post("/packets", User.checkLoggedIn, canOpenBoard, PacketController.getAllPacket);
router.post("/assignPackets", User.checkLoggedIn, PacketController.assignPackets);
router.post("/assignPacketsBulk", User.checkLoggedIn, PacketController.assignBulk);
router.post("/assignBulk", User.checkLoggedIn, PacketController.assignBulk);
router.post("/reassign", User.checkLoggedIn, PacketController.reassign);

// Disable / enable a wrongly uploaded packet (permission checked in the controller)
router.post("/disablePackets", User.checkLoggedIn, PacketController.disablePackets);
router.post("/enablePackets", User.checkLoggedIn, PacketController.enablePackets);
router.post("/disableBatch", User.checkLoggedIn, PacketController.disableBatch);

// Report: everyone sees his own, /packet/reportAll sees everyone
router.get("/report", User.checkLoggedIn, PacketController.report);

// Delivery
router.post("/deliverPacket", User.checkLoggedIn, PacketController.deliverPacket);
router.get("/myPackets", User.checkLoggedIn, User.checkAuthorisation, PacketController.myPackets);
router.post("/myPackets", User.checkLoggedIn, User.checkAuthorisation, PacketController.myPackets);
router.post("/returnPacket", User.checkLoggedIn, User.checkAuthorisation, PacketController.returnPacket);

// Admin
router.get("/adminPacket", User.checkLoggedIn, User.checkAdmin, PacketController.adminList);
router.post("/adminPacket", User.checkLoggedIn, User.checkAdmin, PacketController.adminList);
router.post("/verifyPacket", User.checkLoggedIn, User.checkAdmin, PacketController.verifyPacket);
router.post("/runAutoAssign", User.checkLoggedIn, User.checkAdmin, PacketController.runAutoAssign);
router.get("/uploadBatches", User.checkLoggedIn, User.checkAdmin, PacketController.listUploadBatches);
router.post("/deleteBatch", User.checkLoggedIn, User.checkAdmin, PacketController.deleteBatch);
router.get("/calendarSummary", User.checkLoggedIn, User.checkAdmin, PacketController.calendarSummary);
router.get("/calendarDay", User.checkLoggedIn, User.checkAdmin, PacketController.calendarDay);

module.exports = router;
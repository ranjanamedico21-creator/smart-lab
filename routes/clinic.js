const express = require("express");
const router = express.Router();
const User = require("../models/User");
const ClinicController = require("../controllers/ClinicController");

/*
 * NOTE
 *  - No multer / validateClinicData here any more:
 *      • ClinicController parses the upload itself (in memory, 5 MB limit, JPEG/PNG checked by bytes)
 *        — the old diskStorage kept every file in uploads/ forever and used the user's file name.
 *      • Validation is done in models/Clinic.js with clear messages; validateClinicData would
 *        reject/redirect before the controller could keep the user's typed data.
 *  - Short helpers so every protected route uses the same guards.
 */
const auth  = [User.checkLoggedIn, User.checkAuthorisation];

// Home (unchanged behaviour)
router.get("/", User.checkLoggedIn, ClinicController.getHomePage);

// List
router.get("/getClinicListView", ...auth, ClinicController.getClinicListView);

// Register
router.get("/registerClinic",  ...auth, ClinicController.getClinicRegistrationPage);
router.post("/registerClinic", ...auth, ClinicController.registerClinic);

// Edit — /updateClinicDetails/5  (old ?id=5 links still work)
router.get("/updateClinicDetails/:id",  ...auth, ClinicController.getupdateClinicDetailsPage);
router.get("/updateClinicDetails",      ...auth, ClinicController.getupdateClinicDetailsPage);
router.post("/updateClinicDetails/:id", ...auth, ClinicController.updateClinicDetails);
router.post("/updateClinicDetails",     ...auth, ClinicController.updateClinicDetails);

// Prescription header image (served only to logged-in staff, never from a public folder)
router.get("/header/:id", ...auth, ClinicController.getClinicHeader);

// Doctors of a clinic
router.get("/attachDoctor/:clinicId",  ...auth, ClinicController.attachDoctorWithClinic);
router.post("/attachDoctorToClinic",   ...auth, ClinicController.attachDoctorToClinic);   // ?clinicId=5

// Remove doctor — POST only (a GET link can be triggered by browser prefetch / crawlers)
router.post("/detachDoctor/:doctorId/:clinicId", ...auth, ClinicController.detachDoctorFromClinic);
// Old GET links (bookmarks) just open the doctors page instead of deleting anything
router.get("/detachDoctor/:doctorId/:clinicId", ...auth, (req, res) =>
  res.redirect(`/clinic/attachDoctor/${parseInt(req.params.clinicId, 10) || ""}`)
);

module.exports = router;
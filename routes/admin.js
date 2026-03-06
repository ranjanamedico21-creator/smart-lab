const express = require("express");
const router = express.Router();
const User = require("../models/User");

const AdminController = require("../controllers/AdminController")

//By default redirect to home page
//router.get("/updateCarryForward",User.checkLoggedIn,User.checkAdmin,AdminController.updateCarryForwardTable);
//router.get("/updateCarryForwardForSupplier",User.checkLoggedIn,User.checkAdmin,AdminController.updateCarryForwardForSupplier);


module.exports = router;

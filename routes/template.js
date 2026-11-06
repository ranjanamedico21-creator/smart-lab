
const express = require("express");
const router = express.Router();
const passport = require("passport");
const User = require("../models/User");
const TemplateController= require("../controllers/TemplateController")
//check for logged in user and authorization

router.get ("/list",       User.checkLoggedIn, TemplateController.list);
router.get ("/new",        User.checkLoggedIn, TemplateController.form);
router.get ("/:id/edit",   User.checkLoggedIn, TemplateController.form);
router.post("/preview",    User.checkLoggedIn, ...TemplateController.previewDocx);
router.post("/save",       User.checkLoggedIn, ...TemplateController.save);
router.post("/delete",     User.checkLoggedIn, TemplateController.deleteTemplate);

module.exports = router;
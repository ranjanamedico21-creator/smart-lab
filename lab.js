
const express = require("express");
const app = express();
const path = require("path");
const passport = require("passport");
const flash = require("connect-flash");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const fileUpload = require("express-fileupload");
const cors = require("cors");
const layout = require("express-ejs-layouts");
require("./config/passport")(passport); // Passport Config

// Environment Variables
require("dotenv").config();

// Middleware
app.use(express.urlencoded({ extended: true })); // Form data
app.use(express.json()); // JSON data
app.use(cookieParser());
app.use(cors());
//app.use(fileUpload({ limits: { fileSize: 50 * 1024 * 1024 } }));

// Static Files
const staticDirs = ["js", "css", "images", "uploads", "prescriptions"];
staticDirs.forEach(dir => app.use(express.static(path.join(__dirname, dir))));
app.use('/froalacss', express.static(path.join(__dirname, 'node_modules/froala-editor/css/froala_editor.pkgd.min.css')));
app.use('/froalajs', express.static(path.join(__dirname, 'node_modules/froala-editor/js/froala_editor.pkgd.min.js')));

// View Engine
app.set("view engine", "ejs");
app.use(layout);

// Session Configuration
app.use(
  session({
    secret: process.env.SESSION_SECRET || "secret",
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }, // 1 day
  })
);

// Passport Middleware
app.use(passport.initialize());
app.use(passport.session());

// Flash Messages
app.use(flash());

// Global Variables
app.use((req, res, next) => {
  res.locals.user = req.user || null;
  next();
});

// Routes
const routes = [
  { path: "/user", route: require("./routes/user") },
  { path: "/clinic", route: require("./routes/clinic") },
  { path: "/doctor", route: require("./routes/doctor") },
  { path: "/category", route: require("./routes/category") },
  { path: "/test", route: require("./routes/test") },
  { path: "/patient", route: require("./routes/patient") },
  { path: "/report", route: require("./routes/report") },
  { path: "/activity", route: require("./routes/activity") },
  { path: "/schedule", route: require("./routes/schedule") },
  { path: "/billing", route: require("./routes/billing") },
  { path: "/admin", route: require("./routes/admin") },
  { path: "/patientQueue", route: require("./routes/patientQueue") },
];
routes.forEach(r => app.use(r.path, r.route));

// Individual Routes
app.get('/aboutUs', (req, res) => {
  res.render('aboutUs', { title: 'About Us', BRAND_NAME: process.env.BRAND_NAME });
});

app.get('/*', (req, res) => {
  const active='dashboard'
  res.render('home', { title: 'Home', BRAND_NAME: process.env.BRAND_NAME,active, layout: 'loggedInLayout' });
});

// Start Server
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`Server started at Port ${PORT}`));



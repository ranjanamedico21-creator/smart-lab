// ─────────────────────────────────────────────────────────────────────────────
// app.js — SmartLab
// SECURITY PATCH (2026-10-24) — every change is marked ★ with the reason.
// ─────────────────────────────────────────────────────────────────────────────

// ★ dotenv FIRST: it was loaded after ./config/Passport, so anything that reads process.env
//   while Passport config loads got empty values.
require("dotenv").config();

const express = require("express");
const app = express();
const path = require("path");
const crypto = require("crypto");
const passport = require("passport");
const flash = require("connect-flash");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const fileUpload = require("express-fileupload");
const layout = require("express-ejs-layouts");
require("./config/Passport")(passport); // Passport Config

const IS_PROD = process.env.NODE_ENV === "production";

// ★ Behind cPanel/Passenger (Apache proxy) req.ip was always 127.0.0.1 — every audit log,
//   receipt-print log and cancel log recorded the proxy, not the receptionist's PC.
app.set("trust proxy", 1);
// ★ Don't advertise "X-Powered-By: Express"
app.disable("x-powered-by");

// ★ Basic security headers (no extra npm package needed)
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");         // no MIME sniffing of uploads
  res.setHeader("X-Frame-Options", "SAMEORIGIN");              // no click-jacking inside other sites
  res.setHeader("Referrer-Policy", "same-origin");             // patient URLs never leak to other sites
  if (IS_PROD && req.secure) res.setHeader("Strict-Transport-Security", "max-age=15552000");
  next();
});

// Middleware
app.use(express.urlencoded({ extended: true })); // Form data
app.use(express.json()); // JSON data
app.use(cookieParser());
// ★ cors() removed: it allowed every website to call this app's URLs from the browser.
//   SmartLab pages are served from the same site, so no CORS is needed.
//   If some outside tool really needs it, allow only that origin:
//   app.use(require("cors")({ origin: ["https://your-other-site.example"] }));
//app.use(fileUpload({ limits: { fileSize: 50 * 1024 * 1024 } }));

// Public static files (login page needs these before login)
const staticDirs = ["js", "css", "images"];
staticDirs.forEach(dir => app.use(express.static(path.join(__dirname, dir))));

// View Engine
app.set("view engine", "ejs");
app.use(layout);

// Session Configuration
// ★ secret: the fallback "secret" meant anyone could forge a logged-in session cookie if the
//   env var was ever missing. Now a random secret is used instead (everyone just logs in again).
let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret || sessionSecret === "secret" || sessionSecret.length < 32) {
  console.error("[security] SESSION_SECRET is missing or too short — set a 32+ character value in cPanel → Setup Node.js App. Using a random one for now.");
  sessionSecret = sessionSecret && sessionSecret.length >= 32 ? sessionSecret : crypto.randomBytes(48).toString("hex");
}
// ★ Sessions in MySQL (table `sessions`, created automatically on first start).
//   The default MemoryStore lost every login on restart and does not work when Passenger runs
//   more than one process (random logouts, flash messages that never appear).
//   Needs once on the server:  npm install express-mysql-session@3
const SESSION_MAX_AGE = 12 * 60 * 60 * 1000;     // 12 h — one working day
const MySQLStore = require("express-mysql-session")(session);
const sessionStore = new MySQLStore({
  createDatabaseTable: true,
  clearExpired: true,
  checkExpirationInterval: 15 * 60 * 1000,        // remove expired logins every 15 min
  expiration: SESSION_MAX_AGE,
}, require("./config/DBConnection").promise());   // reuses the app's pool (no extra connections)
sessionStore.onReady().catch(err => console.error("[session] store not ready:", err.code || "", err.message));

app.use(
  session({
    name: "smartlab.sid",                         // ★ not the default "connect.sid"
    store: sessionStore,
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,                     // ★ no session row for every bot / unauthenticated hit
    cookie: {
      maxAge: SESSION_MAX_AGE,                    // ★ 12 h (one working day) instead of 24 h
      httpOnly: true,                             // ★ page scripts cannot read the cookie
      sameSite: "lax",                            // ★ other websites cannot POST with this cookie (CSRF)
      secure: process.env.COOKIE_SECURE === "true", // ★ set COOKIE_SECURE=true once the site is on https
    },
  })
);

// Passport Middleware
app.use(passport.initialize());
app.use(passport.session());

// ★ Prescriptions and uploads (doctor SIGNATURES) were public: anyone with the URL could download
//   patient prescriptions or a doctor's signature image without logging in.
const requireLogin = (req, res, next) => {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).send("Please log in.");
};
const privateStatic = (dir) => express.static(path.join(__dirname, dir), {
  dotfiles: "deny", index: false,
  // ★ anything that is not an image / PDF is downloaded, never opened as a page of this site
  //   (an old .html / .svg upload would otherwise run its script with the viewer's login)
  setHeaders: (res, filePath) => {
    if (!/\.(jpe?g|png|gif|webp|pdf)$/i.test(filePath)) res.setHeader("Content-Disposition", "attachment");
    if (/\.svg$/i.test(filePath)) res.setHeader("Content-Security-Policy", "script-src 'none'");
  },
});
app.use("/uploads", requireLogin, privateStatic("uploads"));
// prescriptions were served from the web root (e.g. /<file>.jpg) — keep the same URLs, but logged-in only
app.use((req, res, next) => {
  if (!/\.(jpe?g|png|gif|webp|pdf)$/i.test(req.path)) return next();
  return requireLogin(req, res, () => privateStatic("prescriptions")(req, res, next));
});

app.use(require('./controllers/LeaveController').leaveUpdatesBadge);

// Flash Messages
app.use(flash());

// ★ CSRF: a POST from another website must not act as the logged-in receptionist.
//   sameSite=lax already blocks this in modern browsers; this check covers older ones.
//   Requests that carry no Origin/Referer at all (server-to-server tools, scripts) are not affected.
const CSRF_EXEMPT = (process.env.CSRF_EXEMPT_PATHS || "").split(",").map(s => s.trim()).filter(Boolean);
app.use((req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (CSRF_EXEMPT.some(p => req.path.startsWith(p))) return next();
  const source = req.get("origin") || req.get("referer");
  if (!source) return next();
  let host;
  try { host = new URL(source).host; } catch (_) { host = null; }
  if (host && host === req.get("host")) return next();
  console.warn(`[security] blocked cross-site ${req.method} ${req.originalUrl} from ${source}`);
  return res.status(403).send("Blocked: this request did not come from SmartLab.");
});

// Global Variables
app.use((req, res, next) => {
  res.locals.user = req.user || null;
  // ★ BUG: the next line used to be  res.locals.user = req.user?.isAdmin;
  //   which overwrote the user with undefined (the column is IsItAdmin) on every page.
  res.locals.isAdmin = Number(req.user?.IsItAdmin) === 1;  // IsItAdmin matches your DB column
  next();
});

// Routes
const routes = [
  { path: "/user/access", route: require("./routes/functionAccessRoutes") },
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
  { path: "/packet", route: require("./routes/packet") },
  { path: "/template", route: require("./routes/template") },
  { path: "/pathology", route: require("./routes/pathology") },
  { path: "/authorize", route: require("./routes/authorize") },
  { path: "/technician", route: require("./routes/technician") },
  { path: "/mrStockIssue", route: require("./routes/mrStockIssue") },
  { path: "/audit", route: require("./routes/auditRoutes") },
];

routes.forEach(r => app.use(r.path, r.route));

// Individual Routes
app.get('/aboutUs', (req, res) => {
  res.render('aboutUs', { title: 'About Us', BRAND_NAME: process.env.BRAND_NAME });
});

app.get('/*', (req, res) => {
  res.render('home', { title: 'Home', BRAND_NAME: process.env.BRAND_NAME, layout: 'loggedInLayout' });
});


const { errorHandler } = require('./middleware/errorMiddleware');
app.use(errorHandler);

// Start Server
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`Server started at Port ${PORT}`));
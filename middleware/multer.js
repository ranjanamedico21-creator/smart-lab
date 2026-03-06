const multer = require("multer");
const path = require("path");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/pdf");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + ".pdf");   // force .pdf
  }
});

const upload = multer({
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      return cb(new Error("Only PDF allowed"));
    }
    cb(null, true);
  },
  storage
});

module.exports = upload;

// services/templateService.js
// Handles: .docx upload, mammoth preview, docxtemplater injection

const mammoth       = require("mammoth");
const PizZip        = require("pizzip");
const Docxtemplater = require("docxtemplater");
const fs            = require("fs");
const path          = require("path");

const UPLOAD_DIR = path.join(__dirname, "../uploads/templates");

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });


// ── Convert .docx → HTML for browser preview ──────────────────
const docxToHtml = async (filePath) => {
    const result = await mammoth.convertToHtml(
        { path: filePath },
        {
            styleMap: [
                "p[style-name='Heading 1'] => h3:fresh",
                "p[style-name='Heading 2'] => h4:fresh",
                "b => strong",
                "i => em",
            ],
            convertImage: mammoth.images.dataUri,
            includeDefaultStyleMap: true,
        }
    );

    // Clean up and add basic styles
    let html = result.value
        .replace(/<table>/gi,
            `<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:12px">`)
        .replace(/<td>/gi,
            `<td style="border:1px solid #d1d5db;padding:5px 10px;vertical-align:top">`)
        .replace(/<th>/gi,
            `<th style="border:1px solid #d1d5db;padding:5px 10px;background:#f3f4f6;font-weight:600">`)
        .replace(/<p>/gi,
            `<p style="margin:3px 0;line-height:1.6">`);

    return html;
};


// ── Inject patient data into .docx using docxtemplater ─────────
// placeholders in Word doc: {patient_name} {age} {gender} etc.
const fillDocxTemplate = async (filePath, data) => {
    const content = fs.readFileSync(filePath, "binary");
    const zip     = new PizZip(content);

    const doc = new Docxtemplater(zip, {
        paragraphLoop:  true,
        linebreaks:     true,
        errorLogging:   false,
    });

    doc.render(data);

    return doc.getZip().generate({ type: "nodebuffer" });
};


// ── Save uploaded .docx file ───────────────────────────────────
const saveUploadedFile = (file, testId, genderType) => {
    const timestamp = Date.now();
    const safeName  = `${timestamp}_test${testId}_${genderType}.docx`;
    const destPath  = path.join(UPLOAD_DIR, safeName);
    fs.renameSync(file.path, destPath);
    return `uploads/templates/${safeName}`;  // relative path stored in DB
};


// ── Delete .docx file from disk ────────────────────────────────
const deleteFile = (filePath) => {
    const fullPath = path.join(__dirname, "..", filePath);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
};


// ── Get absolute path from stored relative path ───────────────
const getAbsolutePath = (relativePath) => {
    return path.join(__dirname, "..", relativePath);
};


module.exports = {
    docxToHtml,
    fillDocxTemplate,
    saveUploadedFile,
    deleteFile,
    getAbsolutePath,
    UPLOAD_DIR,
};
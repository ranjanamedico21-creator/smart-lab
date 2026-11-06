// controllers/templateController.js
const Template = require("../models/Template");
const Doctor = require("../models/Doctor");
const Test     = require("../models/Test");
const mammoth       = require("mammoth");
const multer        = require("multer");
const fs            = require("fs");


const upload = multer({
    dest: "tmp/",
    fileFilter: (req, file, cb) => {
        if (file.originalname.endsWith(".docx")) cb(null, true);
        else cb(new Error("Only .docx files allowed."), false);
    },
    limits: { fileSize: 10 * 1024 * 1024 }
});

// ═══════════════════════════════════════════════════════════
// HELPER: Check if user is admin
// ═══════════════════════════════════════════════════════════
const isAdmin = (user) => {
    return user.RoleId === 1 || user.IsItAdmin === 1;
};

// ═══════════════════════════════════════════════════════════
// HELPER: Convert DOCX to HTML
// ═══════════════════════════════════════════════════════════
const convertDocxToHtml = async (filePath) => {
    const result = await mammoth.convertToHtml(
        { path: filePath },
        {
            styleMap: [
                "p[style-name='Heading 1'] => h3:fresh",
                "p[style-name='Heading 2'] => h4:fresh",
                "b => strong", "i => em",
            ],
            convertImage: mammoth.images.dataUri,
            includeDefaultStyleMap: true,
        }
    );

    const html = result.value
        .replace(/<table>/gi, `<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:12px">`)
        .replace(/<td>/gi, `<td style="border:1px solid #d1d5db;padding:5px 10px;vertical-align:top">`)
        .replace(/<th>/gi, `<th style="border:1px solid #d1d5db;padding:5px 10px;background:#f3f4f6;font-weight:600">`)
        .replace(/<p>/gi, `<p style="margin:3px 0;line-height:1.6">`);

    return html;
};

// ═══════════════════════════════════════════════════════════
// LIST
// GET /template/list
// ═══════════════════════════════════════════════════════════
const list = async (req, res) => {
    try {
        const userId   = req.user.Id;
        const templates = await Template.getAllByDoctor(userId);
        
        return res.render("Template/list", { 
            templates,
            title: 'Template List',
            BRAND_NAME: process.env.BRAND_NAME,
            layout: 'loggedInLayout'
         });
    } catch (err) {
        console.error("template.list:", err);
        req.flash("error", err.message);
        return res.redirect("/user/home");
    }
};

// ═══════════════════════════════════════════════════════════
// FORM — new or edit
// GET /template/new
// GET /template/:id/edit
// ═══════════════════════════════════════════════════════════
const form = async (req, res) => {
    try {
        const templateId = req.params.id ? parseInt(req.params.id) : null;
        const userId     = req.user.Id;
        const user       = req.user;
        const isUserAdmin= isAdmin(user)

        const tests = await Test.getTestDetails();

        let template = null;
        if (templateId) {
            if (isUserAdmin) {
                template = await Template.getByIdAdmin(templateId);
            } else {
                template = await Template.getById(templateId, userId);
            }
        }

        // Get all doctors (only for admin)
        let doctors = [];
        if (isUserAdmin) {
            doctors = await Template.getAllDoctors();
        }

        return res.render("Template/form", {
            template,
            tests,
            doctors,
            isEdit: !!templateId,
            title: 'Template Form',
            isUserAdmin,
            BRAND_NAME: process.env.BRAND_NAME,
            layout: 'loggedInLayout'
        });

    } catch (err) {
        console.error("template.form:", err);
        req.flash("error", err.message);
        return res.redirect("/template/list");
    }
};

// ═══════════════════════════════════════════════════════════
// PREVIEW DOCX — AJAX
// POST /template/preview
// ═══════════════════════════════════════════════════════════
const previewDocx = [
    upload.single("docxFile"),
    async (req, res) => {
        try {
            if (!req.file) {
                return res.json({ success: false, message: "No file uploaded." });
            }

            const html = await convertDocxToHtml(req.file.path);
            fs.unlinkSync(req.file.path);
            
            return res.json({ success: true, html });

        } catch (err) {
            console.error("template.previewDocx:", err);
            if (req.file?.path && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
            return res.json({ success: false, message: err.message });
        }
    }
];

// ═══════════════════════════════════════════════════════════
// SAVE
// POST /template/save
// ═══════════════════════════════════════════════════════════
const save = [
    upload.fields([
        { name: "fileCommon", maxCount: 1 },
        { name: "fileMale",   maxCount: 1 },
        { name: "fileFemale", maxCount: 1 },
    ]),
    async (req, res) => {
        try {
            const { id, name, testId, genderMode, htmlContent, assignToDoctorId } = req.body;
            const userId     = req.user.Id;
            const user       = req.user;
            const isUserAdmin= isAdmin(user)
            const templateId = id ? parseInt(id) : null;

            // Determine target doctor
            let targetDoctorId = userId; // Default: current user
            
            // If admin and assignToDoctorId is provided, use that
            if (isUserAdmin && assignToDoctorId) {
                targetDoctorId = parseInt(assignToDoctorId);
            }

            // ── COMMON MODE ──
            if (genderMode === "common") {
                const fileCommon = req.files?.fileCommon?.[0];
                let content = htmlContent;

                if (fileCommon) {
                    content = await convertDocxToHtml(fileCommon.path);
                    fs.unlinkSync(fileCommon.path);
                }

                if (!content && !templateId) {
                    req.flash("error", "Please upload a template file.");
                    return res.redirect("/template/new");
                }

                if (content) {
                    if (templateId) {
                        await Template.update(templateId, {
                            name, testId,isUserAdmin, genderType: "common", content,
                            title: 'Template List',
                            BRAND_NAME: process.env.BRAND_NAME,
                            layout: 'loggedInLayout'
                        });
                    } else {
                        await Template.create({
                            name, 
                            doctorId: targetDoctorId, 
                            testId, 
                            genderType: "common", 
                            content,
                            isUserAdmin,
                            createdBy: userId,
                            title: 'Template List',
                            BRAND_NAME: process.env.BRAND_NAME,
                            layout: 'loggedInLayout'
                        });
                    }
                }
            }

            // ── SEPARATE MODE (male + female) ──
            else if (genderMode === "separate") {
                const fileMale   = req.files?.fileMale?.[0];
                const fileFemale = req.files?.fileFemale?.[0];

                if (!fileMale && !fileFemale && !templateId) {
                    req.flash("error", "Please upload at least one template file.");
                    return res.redirect("/template/new");
                }

                // Save Male Template
                if (fileMale) {
                    const contentMale = await convertDocxToHtml(fileMale.path);
                    fs.unlinkSync(fileMale.path);
                    
                    const existing = await Template.checkExisting(targetDoctorId, testId, 'male');

                    if (existing) {
                        await Template.updateContent(existing.Id, `${name} — Male`, contentMale);
                    } else {
                        await Template.create({
                            name: `${name} — Male`, 
                            doctorId: targetDoctorId, 
                            testId, 
                            genderType: "male",
                            content: contentMale, 
                            createdBy: userId
                        });
                    }
                }

                // Save Female Template
                if (fileFemale) {
                    const contentFemale = await convertDocxToHtml(fileFemale.path);
                    fs.unlinkSync(fileFemale.path);
                    
                    const existing = await Template.checkExisting(targetDoctorId, testId, 'female');

                    if (existing) {
                        await Template.updateContent(existing.Id, `${name} — Female`, contentFemale);
                    } else {
                        await Template.create({
                            name: `${name} — Female`, 
                            doctorId: targetDoctorId, 
                            testId, 
                            genderType: "female",
                            content: contentFemale, 
                            createdBy: userId
                        });
                    }
                }
            }

            req.flash("success", "Template(s) saved successfully.");
            return res.redirect("/template/list");

        } catch (err) {
            console.error("template.save:", err);
            // Clean up uploaded files
            ["fileCommon", "fileMale", "fileFemale"].forEach(key => {
                if (req.files?.[key]?.[0]?.path && fs.existsSync(req.files[key][0].path)) {
                    fs.unlinkSync(req.files[key][0].path);
                }
            });
            req.flash("error", err.message);
            return res.redirect(req.body.id ? `/template/${req.body.id}/edit` : "/template/new");
        }
    }
];

// ═══════════════════════════════════════════════════════════
// DELETE — AJAX
// POST /template/delete
// ═══════════════════════════════════════════════════════════
const deleteTemplate = async (req, res) => {
    try {
        const userId = req.user.Id;
        await Template.softDelete(req.body.id, userId);
        return res.json({ success: true });
    } catch (err) {
        console.error("template.delete:", err);
        return res.json({ success: false, message: err.message });
    }
};

module.exports = {
    list,
    form,
    previewDocx,
    save,
    deleteTemplate
};
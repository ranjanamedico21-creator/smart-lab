//const { promiseImpl } = require("ejs");
const dbConnection = require("../config/DBConnection");
const currDateAndTime = require("../helper/helper");
const moment =require('moment');
const fs = require('fs');
//const { resolve } = require("path");
const bcrypt = require("bcrypt");
const mysql = require('mysql2'); 
const User = require("../models/User");
const path = require('path');
const crypto = require('crypto');

/**
 * All queries go through the POOL. The old single `dbConnection.connection`
 * dies after MySQL's wait_timeout / a restart ("Can't add new command when
 * connection is in closed state") and then every report page fails until the
 * app is restarted. It also cannot run two transactions at once.
 */
const db      = () => (dbConnection.pool || dbConnection.connection).promise();
const getConn = () => dbConnection.pool
    ? dbConnection.pool.promise().getConnection()
    : Promise.resolve(Object.assign(db(), { release: () => {} }));

/* ═════════════════════════════════════════════════════════════════════════════
 * SECURITY PATCH (2026-10-25) — helpers used below (changes marked ★)
 * ═════════════════════════════════════════════════════════════════════════════ */
const { cleanHtml, plainText } = require('../helper/htmlSanitizer');

const reportError = (msg, status = 400) => { const e = new Error(msg); e.isUserError = true; e.status = status; return e; };
const toId = (v) => { const n = parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : null; };

/** Optional column check (cached once true, re-checked every minute until it exists). */
const colCache = new Map();
const hasColumn = async (table, column) => {
    const k = `${table}.${column}`.toLowerCase();
    const c = colCache.get(k);
    if (c && (c.ok || Date.now() - c.at < 60000)) return c.ok;
    let ok = false;
    try {
        const [[r]] = await db().query(`SELECT COUNT(*) AS n FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = LOWER(?) AND LOWER(COLUMN_NAME) = LOWER(?)`, [table, column]);
        ok = Number(r.n) > 0;
    } catch (_) { ok = false; }
    colCache.set(k, { ok, at: Date.now() });
    return ok;
};

/**
 * ★ The ONE way to find the report a request is about.
 * The browser used to send patientId, testId AND testRefId; the finalize lock was checked on testRefId
 * but the report was saved by patientId + testId → sending the testRefId of an unfinished test let
 * anyone overwrite a FINALIZED (signed) report. testRefId is now always looked up here.
 */
const loadReportTarget = async (patientId, testId, q = null) => {
    const pid = toId(patientId), tid = toId(testId);
    if (!pid || !tid) throw reportError('Missing patient or test.');
    const [[t]] = await (q || db()).query(`
        SELECT ptr.Id AS TestRefId, ptr.TestStatus, COALESCE(ptr.IsFinalized, 0) AS IsFinalized, ptr.FinalizedBy,
               pd.Id AS PatientId, pd.Status AS PatientStatus, pd.BookingStatus, pd.DuesAmount, pd.DoctorId,
               pd.Name, pd.Title, pd.PhoneNumber, pd.Age,
               t.Id AS TestId, t.TestName, t.IsReportRequired
        FROM PatientTestRefference ptr
        JOIN PatientDetails pd ON pd.Id = ptr.PatientId
        JOIN MainTestTable  t  ON t.Id  = ptr.TestId
        WHERE ptr.PatientId = ? AND ptr.TestId = ?
        ORDER BY ptr.Id LIMIT 1`, [pid, tid]);
    if (!t) throw reportError('This patient does not have this test.', 404);
    return t;
};

/**
 * ★ Report history (medico-legal): every change to a report that was ready / finalized keeps the
 * previous text, who changed it and why. Table from migrations/2026-10-25_report_security.sql;
 * without the table the app keeps working and logs a warning once.
 */
let histWarned = false;
const writeReportHistory = async ({ patientId, testId, testRefId, action, content, userId, reason = null }, q = null) => {
    try {
        await (q || db()).query(
            `INSERT INTO ReportHistory (PatientId, TestId, TestRefId, Action, Content, ChangedBy, ChangedAt, Reason)
             VALUES (?, ?, ?, ?, ?, ?, NOW(), ?)`,
            [patientId, testId, testRefId, action, content == null ? null : String(content), userId || null, reason ? String(reason).slice(0, 500) : null]);
    } catch (e) {
        if (e.code === 'ER_NO_SUCH_TABLE') { if (!histWarned) { histWarned = true; console.warn('[Report] ReportHistory table missing — run migrations/2026-10-25_report_security.sql'); } return; }
        throw e;
    }
};

/** Admin, or a user holding one of these function slugs. Inactive users never. */
const userHasAny = async (userId, slugs) => {
    const [[u]] = await db().query('SELECT IsItAdmin, IsActive FROM Users WHERE Id = ? LIMIT 1', [userId || 0]);
    if (!u || u.IsActive === 0 || u.IsActive === '0') return false;
    if (Number(u.IsItAdmin) === 1) return true;
    if (!slugs.length) return false;
    return require('./User').userHasAnyFunction(userId, slugs);   // roles + deny honoured
};

/** ★ Finalizing puts the finalizer's NAME + SIGNATURE on the report → only doctors (role "doctor") or admins. */
const isReportingDoctor = async (userId) => {
    const [[r]] = await db().query(`
        SELECT 1 AS ok FROM Users u LEFT JOIN Roles ro ON ro.Id = u.RoleId
        WHERE u.Id = ? AND COALESCE(u.IsActive, 1) <> 0 AND (u.IsItAdmin = 1 OR LOWER(ro.Name) = 'doctor') LIMIT 1`, [userId || 0]);
    return !!r;
};

/**
 * ★ May this report leave the centre (download / print / WhatsApp link)?
 * Not for cancelled patients; not while dues are pending unless admin / "deliverWithDues".
 */
const DELIVER_WITH_DUES_SLUGS = ['/deliverWithDues', 'deliverWithDues'];
const checkHandOver = async (userId, target) => {
    if (Number(target.PatientStatus) === 0) return { ok: false, message: 'This patient is cancelled — the report cannot be given out.' };
    const dues = Math.round(Number(target.DuesAmount || 0) * 100) / 100;
    if (dues > 0 && !(await userHasAny(userId, DELIVER_WITH_DUES_SLUGS)))
        return { ok: false, message: `₹${dues} dues are pending. Collect the dues before giving out the report, or ask an authorised person.` };
    return { ok: true };
};

/**
 * 
 * @param {*} req 
 * @returns 
 * Improved Version
 */
let getDiscountReport = async (req) => {
    // FIX: Name / Doctor / dates were pasted into the SQL (SQL injection), and
    // `throw` inside the mysql callback crashed the whole Node process.
    const b = req.body || {};
    const toSql = (v) => {
        const m = moment(String(v || ''), ['DD-MM-YYYY', 'D MMM YYYY', 'DD MMM YYYY', 'YYYY-MM-DD'], true);
        return m.isValid() ? m.format('YYYY-MM-DD') : moment().format('YYYY-MM-DD');
    };
    let from = toSql(b.FromDate), to = toSql(b.ToDate);
    if (from > to) [from, to] = [to, from];

    const where = ['pd.Discount > 0', 'pd.RegisteredOn >= ?', 'pd.RegisteredOn < ? + INTERVAL 1 DAY'];
    const vals  = [from, to];
    if (b.Name)   { where.push('pd.Name LIKE ?'); vals.push('%' + String(b.Name).trim() + '%'); }
    if (b.Doctor) { where.push('pd.DoctorId = ?'); vals.push(parseInt(b.Doctor, 10) || 0); }

    const [rows] = await db().query(`
        SELECT pd.Title, pd.Age, pd.YMD, pd.PhoneNumber, pd.DuesAmount, pd.ActualAmount, pd.Status,
               pd.GrossAmount, pd.Id AS PatientId, pd.Name, pd.Discount, pd.DiscountApprovedBy,
               DATE_FORMAT(pd.RegisteredOn, '%d-%m-%y') AS RegisteredOn,
               pd.DoctorId,
               d.FirstName AS DoctorFirstName, d.LastName AS DoctorLastName,
               d.Degree1 AS DoctorDegree1, d.Degree2 AS DoctorDegree2, d.Degree3 AS DoctorDegree3,
               d.SpecialistIn AS DoctorSpecialistIn,
               GROUP_CONCAT(m.TestName ORDER BY m.TestName SEPARATOR ', ') AS TestNames
        FROM PatientDetails pd
        LEFT JOIN DoctorDetails d          ON d.Id = pd.DoctorId
        LEFT JOIN PatientTestRefference r  ON r.PatientId = pd.Id
        LEFT JOIN MainTestTable m          ON m.Id = r.TestId
        WHERE ${where.join(' AND ')}
        GROUP BY pd.Id
        ORDER BY pd.Id DESC`, vals);
    return rows;
};

/**
 * 
 * @param {*} req 
 * @returns 
 * This is a process of uploading document so that different certificate can have 
 * the time line and user can see them and re apply for them.
 */
let uploadDocument = async (req) => {
    try {
        if (!req.files || Object.keys(req.files).length === 0) {
            console.log('No files uploaded');
            throw new Error('No files have been uploaded.');
        }

        // Validate required fields
        if (!req.body.validFrom || !req.body.validUpto) {
            throw new Error('Both validFrom and validUpto are required.');
        }

        let validFrom, validUpto;

        // Convert 'DD-MM-YYYY' to 'YYYY-MM-DD' using moment.js
        if (moment(req.body.validFrom, 'DD-MM-YYYY', true).isValid()) {
            validFrom = moment(req.body.validFrom, 'DD-MM-YYYY').format('YYYY-MM-DD');
        } else {
            throw new Error('Invalid date format for validFrom. Expected format: DD-MM-YYYY');
        }

        if (moment(req.body.validUpto, 'DD-MM-YYYY', true).isValid()) {
            validUpto = moment(req.body.validUpto, 'DD-MM-YYYY').format('YYYY-MM-DD');
        } else {
            throw new Error('Invalid date format for validUpto. Expected format: DD-MM-YYYY');
        }

        //let fileToBeUploaded = req.files.documentUpload;
         // Ensure the specific file field exists
         let fileToBeUploaded = req.files.documentUpload;
         if (Array.isArray(fileToBeUploaded)) fileToBeUploaded = fileToBeUploaded[0];
         if (!fileToBeUploaded) {
             throw new Error('No document file found in the request.');
         }
         // ★ only document / image types. An uploaded .html / .svg / .js was served from /uploads as a page
         //   of THIS site → its script ran with the viewer's login (stored XSS).
         const ALLOWED_DOC_EXT = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.doc', '.docx', '.xls', '.xlsx'];
         const upExt = path.extname(String(fileToBeUploaded.name || '')).toLowerCase();
         if (!ALLOWED_DOC_EXT.includes(upExt)) throw new Error(`Only ${ALLOWED_DOC_EXT.join(', ')} files can be uploaded.`);
         if (Number(fileToBeUploaded.size) > 15 * 1024 * 1024) throw new Error('The file is larger than 15 MB.');
         const [[cat]] = await db().query('SELECT Id FROM DocumentCategory WHERE Id = ? LIMIT 1', [toId(req.body.documentCategory) || 0]);
         if (!cat) throw new Error('Please choose a valid document category.');
        // FIX: the user's file name went straight into the path ("../../x.js" could escape ./uploads)
        const ext = path.extname(String(fileToBeUploaded.name || '')).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10);
        const base = path.basename(String(fileToBeUploaded.name || 'document'), path.extname(String(fileToBeUploaded.name || '')))
                         .replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 60) || 'document';
        let fileName = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}-${base}${ext}`;
        let uploadPath = path.join(__dirname, '..', 'uploads', fileName);
        if (!req.body.documentCategory) throw new Error('Please choose a document category.');
        if (moment(validUpto).isBefore(moment(validFrom))) throw new Error('Valid upto date cannot be before valid from date.');

        let documentDetails = {
            CategoryId: cat.Id,
            ValidFrom: validFrom,
            ValidUpto: validUpto,
            DocumentName: fileName,
            UploadedBy: req.user.Id,
            UploadedOn: moment().format('YYYY-MM-DD HH:mm:ss') // Correct format for timestamps
        };


        // Move the file FIRST — a DB row without a file is a broken link in the list
        await fileToBeUploaded.mv(uploadPath);
        try {
            await db().query('INSERT INTO Document SET ?', documentDetails);
        } catch (e) {
            fs.promises.unlink(uploadPath).catch(() => {});
            throw e;
        }

        console.log('Document uploaded successfully.');
        return 'Document uploaded successfully.';
        
    } catch (error) {
        console.error('Upload failed:', error.message);
        throw error;
    }
};

let getDocumentDetails = async(documentCategoryId='',documentName='')=>{     
    let query = `
        SELECT
            Document.Id,
            Document.CategoryId,
            Document.DocumentName,
            DATE_FORMAT(Document.ValidFrom, '%d-%m-%y') AS ValidFrom,
            DATE_FORMAT(Document.ValidUpto, '%d-%m-%y') AS ValidUpto,
            Document.UploadedBy,
            DATE_FORMAT(Document.UploadedOn, '%d-%m-%y') AS UploadedOn,
            DocumentCategory.Name,
            Users.FirstName,
            Users.LastName
        FROM
            Document
        JOIN
            DocumentCategory ON DocumentCategory.Id = Document.CategoryId
        JOIN
            Users ON Users.Id = Document.UploadedBy
    `;

    let conditions = [];
    let values = [];

    // Add conditions dynamically
    if (documentName) {
        conditions.push("Document.DocumentName LIKE ?");
        values.push(`%${documentName}%`); // Using wildcard for partial matches
    }
    if (documentCategoryId) {
        conditions.push("Document.CategoryId = ?");
        values.push(documentCategoryId);
    }
                            
    // Append WHERE clause only if there are conditions
    if (conditions.length > 0) {
        query += " WHERE " + conditions.join(" AND ");
    }

    try {
        const [results] = await db().query(query, values);
        return results;
    } catch (error) {
        console.error("Database Query Error:", error);
        throw error;
    }
     
 }

/**
 * 
 * @param {*} documentId 
 * @param {*} document 
 * @returns 
 * This deletes the document which are uploaded
 */

let deleteDocument = async (documentId, document) => {
    try {
        // Execute delete query
        const [result] = await db().execute(
            `DELETE FROM Document WHERE Id = ?`,
            [documentId]
        );

        // Check if any document was actually deleted
        if (result.affectedRows === 0) {
            return 'Either document does not exist or has already been deleted.';
        }

        // FIX: `document` is the NAME string (controller passes getDocumentName()), and
        // fs.unlink without a callback threw → "deleted" rows still showed an error page.
        const docName  = typeof document === 'string' ? document : document && document.DocumentName;
        if (!docName) return 'Document is successfully deleted.';
        const filePath = path.join(__dirname, '..', 'uploads', path.basename(docName));
        try {
            await fs.promises.unlink(filePath);
            return 'Document is successfully deleted.';
        } catch (fsError) {
            if (fsError.code === 'ENOENT') return 'Document is successfully deleted.';
            console.error('File deletion error:', fsError);
            return 'Document removed from the list, but the file could not be deleted from the server.';
        }
    } catch (error) {
        console.error('Database error:', error);
        throw error;
    }
};


let getDocumentName = async (documentId) => {
    try {
        const [rows] = await db().query(
            `SELECT DocumentName FROM Document WHERE Id = ?`,
            [documentId]  // Ensure documentId is passed as an array
        );
        
        return rows.length > 0 ? rows[0].DocumentName : null;  // Handle empty result set
    } catch (error) {
        console.error("Error fetching document name:", error);
        throw error;
    }
};

/*const generateLink = async(patientId,testId)=>{
    return new Promise((resolve,reject)=>{
        try {
           
            const randomNum = Math.random();
            const expiresAt = new Date(Date.now() + process.env.EXPIRES_AT * 60 * 60 * 1000); // Link valid for 1 hour
            const query = 'INSERT INTO TemporaryLinks (TestId,PatientId, Token, ExpiresAt) VALUES (?, ?, ?, ?)';
          //  console.log(mysql.format(query,[testId, patientId, randomNum, expiresAt]));
            dbConnection.connection.query(query, [testId, patientId, randomNum, expiresAt], (err, result) => {
               if (err) throw err
               // Create the link (replace baseUrl with your actual domain)
                const baseUrl = 'http://localhost:8000';
                const link = `${baseUrl}/report/downloadwReportFromLink/${randomNum}`
                const encodedMessage = encodeURIComponent(`Here is your report link: ${link}`);
                const whatsappLink = `https://web.whatsapp.com/send?phone=${process.env.PHONENUMBER}&text=${encodedMessage}`;
                console.log(link)
    // Send the WhatsApp link back to the client or use in another communication method
                resolve ( whatsappLink );   
            })
        } catch (error) {

            reject(error)
        }

    })
}*/

// ═══════════════════════════════════════════════════════════
// Add to ReportController.js
// Route: POST /generateReportLink
// Only admin or authorized users can call this
// Generates a token, saves to TemporaryLinks, returns shareable URL
// ═══════════════════════════════════════════════════════════

const REPORT_LINK_HOURS = parseInt(process.env.REPORT_LINK_HOURS, 10) || 72;

/** Create a one-off download token for a patient's report. Returns the token. */
const createReportLinkToken = async (patientId, testId) => {
    const pid = parseInt(patientId, 10), tid = parseInt(testId, 10);
    if (!pid || !tid) throw new Error('patientId and testId are required.');
    // ★ a public link only for a FINALIZED report of an active patient (drafts / cancelled bills were shareable)
    const target = await loadReportTarget(pid, tid);
    if (Number(target.PatientStatus) === 0) throw reportError('This patient is cancelled — no report link can be made.');
    if (Number(target.IsFinalized) !== 1)   throw reportError('Finalize the report before sharing it.');
    const token = crypto.randomBytes(32).toString('hex');
    await db().query('INSERT INTO TemporaryLinks (token, PatientId, TestId, CreatedAt) VALUES (?, ?, ?, NOW())', [token, pid, tid]);
    return token;
};

/** JSON endpoint kept for existing callers (POST /generateReportLink). */
const generateReportLink = async (req, res) => {
    try {
        const { patientId, testId } = req.body;
        if (!patientId || !testId) {
            return res.status(400).json({ success: false, message: 'patientId and testId are required.' });
        }
        // ★ same rules as the WhatsApp button: dues cleared (or authorised), access to this patient
        const target = await loadReportTarget(patientId, testId);
        const Patient = require('./Patient');
        if (Patient.canUserAccessPatient && !(await Patient.canUserAccessPatient(req.user, target.PatientId)))
            return res.status(403).json({ success: false, message: 'You do not have access to this patient.' });
        const hand = await checkHandOver(req.user && req.user.Id, target);
        if (!hand.ok) return res.status(403).json({ success: false, message: hand.message });
        const token   = await createReportLinkToken(patientId, testId);
        const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
        const link    = `${baseUrl}${process.env.REPORT_LINK_PATH || '/downloadReportFromLink/'}${token}`;
        return res.json({ success: true, link, token, expiresInHours: REPORT_LINK_HOURS });
    } catch (error) {
        if (error.isUserError) return res.status(error.status || 400).json({ success: false, message: error.message });
        console.error('[generateReportLink]', error);
        return res.status(500).json({ success: false, message: 'Failed to generate link.' });
    }
};

/**
 * FIX: links never expired — anyone with an old WhatsApp message could download
 * the report forever. Now valid for REPORT_LINK_HOURS (default 72) after creation.
 */
const checkToken = async (req) => {
    const token = String(req.params.token || '');
    if (!/^[a-f0-9]{16,128}$/i.test(token)) throw { status: 404, message: 'Token not found' };
    const [rows] = await db().query(
        'SELECT * FROM TemporaryLinks WHERE token = ? AND CreatedAt >= NOW() - INTERVAL ? HOUR LIMIT 1',
        [token, REPORT_LINK_HOURS]);
    if (!rows.length) throw { status: 404, message: 'Token not found' };
    return rows;
};

  const getdataForPathologyReport = async (patientId,testId,age,ageUnit,gender) => {
    const sql = `
                SELECT 
                tsp.Header,
                tsp.HeaderOrder,
                tsp.Id AS SubParameterId,
                tsp.SubParameterName,
                tsp.SubParameterOrder,
                tsp.Unit,
                spr.AgeMin,
                spr.AgeMax,
                spr.MinVal,
                spr.MaxVal,
                spr.Gender,
                spr.AgeUnit,
                ppd.Value AS currentValue,         -- Existing patient value if present
                ppd.StatusSymbol AS statusSymbol   -- Existing status symbol if present
            FROM 
                TestSubParametersForPathology tsp
            JOIN 
                PathoTestLinkedWithParameters ptlp ON tsp.Id = ptlp.SubParameterId
            LEFT JOIN 
                SubParameterRanges spr ON tsp.Id = spr.SubParameterId
            LEFT JOIN 
                PatientPathologicalData ppd ON tsp.Id = ppd.SubParameterId 
                    AND ppd.PatientId = ? 
                    AND ppd.TestId = ?
            WHERE 
                ptlp.TestId = ?
                AND (spr.AgeMin <= ? AND spr.AgeMax >= ?)
                AND (spr.Gender = ?)
                AND (spr.AgeUnit = ?)
            ORDER BY 
                tsp.HeaderOrder, tsp.SubParameterOrder;
            `
    try {

        const [results] = await db().execute(sql, [patientId,testId,testId, age, age, gender, ageUnit]);
        return results;
    } catch (error) {
        console.error("Error fetching pathology report data:", error);
        throw new Error("Failed to retrieve pathology report data");
    }
  };

  
/**
 * 
 * @param {*} patientId 
 * @param {*} patientData 
 * @param {*} testId 
 * @returns 
 * This function update if key found else insert pathological data
 */
const PATHO_STATUS = ['↑', '↓', '↔', 'H', 'L', 'N', '*', ''];

const insertPathologicalData = async (patientId, patientData, testId) => {
    // FIX: beginTransaction() ran on the ONE shared connection — any other user's
    // query in that moment became part of this transaction (and was rolled back with it).
    const entries = Object.entries(patientData && typeof patientData === 'object' ? patientData : {});
    if (!entries.length) throw new Error('No values to save.');
    if (entries.length > 300) throw reportError('Too many values in one save.');

    // ★ the patient must have this test, be active, and every key must be a parameter OF THIS TEST
    //   (any id was accepted → junk rows; values like <script> were printed on the report)
    const target = await loadReportTarget(patientId, testId);
    if (Number(target.PatientStatus) === 0) throw reportError('This patient is cancelled.');
    if (Number(target.IsFinalized) === 1)   throw reportError('This report is finalized. Un-finalize it before changing values.');
    const [linked] = await db().query('SELECT SubParameterId FROM PathoTestLinkedWithParameters WHERE TestId = ?', [target.TestId]);
    const allowed = new Set(linked.map(r => Number(r.SubParameterId)));
    const values = [];
    for (const [id, v] of entries) {
        const sid = toId(id);
        if (!sid || !allowed.has(sid)) throw reportError('A value belongs to a parameter that is not part of this test. Reload the page.');
        const val = v && v.value != null ? plainText(v.value, 100) : null;
        let status = v && v.status != null ? String(v.status).trim().slice(0, 5) : null;
        if (status && !PATHO_STATUS.includes(status)) status = null;
        values.push([target.PatientId, target.TestId, sid, val, status]);
    }

    const conn = await getConn();
    try {
        await conn.beginTransaction();
        await conn.query(`
            INSERT INTO PatientPathologicalData (PatientId, TestId, SubParameterId, Value, StatusSymbol)
            VALUES ?
            ON DUPLICATE KEY UPDATE Value = VALUES(Value), StatusSymbol = VALUES(StatusSymbol)`, [values]);
        await conn.commit();
        return 'Pathological data saved successfully.';
    } catch (error) {
        try { await conn.rollback(); } catch (_) {}
        console.error('insertPathologicalData:', error.message);
        throw error;
    } finally {
        conn.release();
    }
};

const  getPatientPathoTestData= async(patientId, testId)=>{

    const query = `
                    SELECT 
                            SubParameterId, Value, StatusSymbol
                    FROM 
                            PatientPathologicalData
                    WHERE 
                            PatientId = ? AND TestId = ?
                `;

    try {
        const [rows] = await db().execute(query, [patientId, testId]);

        // If no data is found, return an empty object
        if (rows.length === 0) {
            return {}; // Empty object means no saved data yet
        }

        // Transform rows into a key-value object based on sub_parameter_id
        const savedData = {};
        rows.forEach(row => {
            savedData[row.SubParameterId] = {
                value: row.Value || null,  // Null if no value exists
                status: row.StatusSymbol || '↔'  // Default to '↔' if no status exists
            };
        });

        return savedData;
    } catch (error) {
        console.error('Error fetching patient test data:', error);
        throw error;
    }
}


/** (was an empty stub that called db().query() with no SQL and swallowed the error) */
const searchDocumentDetails = async (documentCategoryId, documentName) => getDocumentDetails(documentCategoryId, documentName);

/** dd-mm-yyyy → yyyy-mm-dd, strictly; anything else is a user error. */
const dmyStrict = (v) => {
    const m = moment(String(v || ''), ['DD-MM-YYYY', 'D-M-YYYY', 'YYYY-MM-DD'], true);
    if (!m.isValid()) throw reportError(`"${String(v || '')}" is not a valid date (dd-mm-yyyy).`);
    return m.format('YYYY-MM-DD');
};
/**
 * ★ Collection reports summed TODAY's test price for every old bill → wrong totals after any price
 * change. With the price snapshot column (patient security migration) the billed price is used.
 */
const billedPriceExpr = async () => (await hasColumn('PatientTestRefference', 'Price')) ? 'COALESCE(ptr.Price, mt.Price)' : 'mt.Price';

const getCategoryWisePatient= async(req)=>{

    try {
        // Extract and format FromDate & ToDate
        // Use query first, fallback to params, then default to today
        let FromDate = req.query?.FromDate || req.params?.FromDate || moment().format('DD-MM-YYYY');
        let ToDate = req.query?.ToDate || req.params?.ToDate || moment().format('DD-MM-YYYY');

        //convert it to YYYY-MM-DD (strict: an invalid date used to become the text 'Invalid date' in SQL)
        FromDate = dmyStrict(FromDate)
        ToDate   = dmyStrict(ToDate)
        const PRICE = await billedPriceExpr();

             const categoryWisePatientListQuery=`SELECT 
                                                        c.Name AS CategoryName,
                                                        c.Id as CategoryId,
                                                        COUNT(*) AS TestCount,
                                                        SUM(${PRICE}) AS TotalPrice,
                                                        SUM(ptr.Discount) AS TotalDiscount
                                                    FROM 
                                                        PatientDetails pd
                                                    JOIN 
                                                        PatientTestRefference ptr ON pd.Id = ptr.PatientId
                                                    JOIN 
                                                        MainTestTable mt ON ptr.TestId = mt.Id
                                                    JOIN 
                                                        Category c ON mt.CategoryId = c.Id
                                                    WHERE 
                                                        pd.RegisteredOn BETWEEN ? AND ?   -- Provide date range here
                                                        AND pd.Status = 1                 -- Only active patients
                                                    GROUP BY 
                                                        c.Id, c.Name;
                                                    `
             const [categoryWisePatientList]=await db().query(categoryWisePatientListQuery,[FromDate,ToDate])
             return categoryWisePatientList;
       
    } catch (error) {
        console.log(error)
        throw error
    }
}
/**
 * 
 * @param {*} CategoryId 
 * @param {*} FromDate is in DD-MM-YYYY
 * @param {*} ToDate  is in DD-MM-YYYY
 * @returns 
 */
const getTestWiseCollection= async(CategoryId,FromDate,ToDate)=>{

    try {
        //convert it from dd-mm-yyy to yyyy-dd-mm
        const fromDate = dmyStrict(FromDate)
        const toDate   = dmyStrict(ToDate)
        const PRICE    = await billedPriceExpr();
            const query=`SELECT 
                                mt.TestName AS TestName,
                                COUNT(*) AS TestCount,
                                SUM(${PRICE}) AS TotalPrice,
                                SUM(ptr.Discount) AS TotalDiscount
                            FROM 
                                PatientDetails pd
                            JOIN 
                                PatientTestRefference ptr ON pd.Id = ptr.PatientId
                            JOIN 
                                MainTestTable mt ON ptr.TestId = mt.Id
                            JOIN 
                                Category c ON mt.CategoryId = c.Id
                            WHERE 
                                pd.RegisteredOn BETWEEN ? AND ?         -- Date range
                                AND mt.CategoryId = ?                   -- Filter by category
                                AND pd.Status = 1
                            GROUP BY 
                                mt.Id, mt.TestName
                            ORDER BY 
                                TotalPrice DESC;`
            const [rows]= await db().query(query,[fromDate,toDate,toId(CategoryId) || 0])
            return rows || []
    } catch (error) {
        
        console.log(error)
        throw error
    }

}



const getDoctorPatientServiceReportWithMonthlyBreakdown = async (categoryId, fromDate, toDate) => {
  const startDate = moment(fromDate, 'DD-MM-YYYY').startOf('month');
  const endDate = moment(toDate, 'DD-MM-YYYY').endOf('month');

  // 1. Generate month keys and labels (e.g., '2024-04' => 'April-24')
  const monthKeys = [];
  const monthLabels = [];

  const tempDate = moment(startDate);

  while (tempDate.isSameOrBefore(endDate)) {
    monthKeys.push(tempDate.format('YYYY-MM'));
    monthLabels.push(tempDate.format('MMMM-YY')); // e.g., April-24
    tempDate.add(1, 'month');
  }

  // 2. Main query: doctor, month, patient count
  const query = `
    SELECT 
      d.Id AS DoctorId,
      CONCAT(d.FirstName, ' ', d.LastName, ' ', IFNULL(d.Degree1, '')) AS DoctorName,
      DATE_FORMAT(p.RegisteredOn, '%Y-%m') AS MonthKey,
      COUNT(DISTINCT p.Id) AS PatientCount
    FROM PatientDetails p
    JOIN DoctorDetails d ON p.DoctorId = d.Id
    JOIN PatientTestRefference ptr ON ptr.PatientId = p.Id
    JOIN MainTestTable mtt ON ptr.TestId = mtt.Id
    WHERE mtt.CategoryId = ?
      AND DATE(p.RegisteredOn) BETWEEN ? AND ?
    GROUP BY d.Id, MonthKey
    ORDER BY d.Id;
  `;

  try {
    const [rows] = await db()
      .query(query, [categoryId, startDate.format('YYYY-MM-DD'), endDate.format('YYYY-MM-DD')]);

    // 3. Organize rows doctor-wise and fill 0 where no data
    const doctorMap = new Map();

    for (const row of rows) {
      const doctorId = row.DoctorId;
      if (!doctorMap.has(doctorId)) {
        doctorMap.set(doctorId, {
          DoctorId: doctorId,
          DoctorName: row.DoctorName,
          MonthlyCounts: {}
        });
      }

      doctorMap.get(doctorId).MonthlyCounts[row.MonthKey] = row.PatientCount;
    }

    // 4. Format final result
    const finalReport = [];

    for (const [_, doctor] of doctorMap) {
      const row = {
        DoctorId: doctor.DoctorId,
        DoctorName: doctor.DoctorName
      };

      monthKeys.forEach((key, idx) => {
        row[monthLabels[idx]] = doctor.MonthlyCounts[key] || 0;
      });

      finalReport.push(row);
    }

    return {
      months: monthLabels,
      reportData: finalReport
    };

  } catch (error) {
    console.error("Error generating monthly report:", error);
    throw error;
  }
};


// ═════════════════════════════════════════════════════════════════════════════
// DAILY SETTLEMENT / VIEW COLLECTION
//
// Source of truth: TransactionTable (every rupee in or out) + PatientDetails.
//
// Rules:
//   • Net cash hand-over = cash received − cash refunds − change returned.
//     Online money is already in the bank → shown, never handed over.
//   • Dues (today)       = unpaid at the END of the registration day, for live
//     patients registered in the range. Cleared the same day → ₹0.
//   • Old dues collected = money received for a patient registered on an
//     EARLIER day (incl. balance on arrival of advance bookings). Already part
//     of cash/online, also listed separately.
//   • Every receptionist who registered, collected or cancelled gets a card —
//     even if every bill was left fully on dues.
//
// Fixes over the previous version:
//   • Agent with only "all dues" patients was missing (query started from transactions).
//   • Net hand-over included online money.
//   • Same-day dues payments were shown as "dues collected".
//   • TotalPendingDues / AdvanceMoney were multiplied by the number of transaction
//     rows per patient (SUM over a JOIN) → wrong totals.
//   • Cancellations counted refund ROWS, not patients; refund = cash+online
//     ignored change already returned.
//   • Advance bookings disappeared after arrival (IsAdvanceBooking reset to 0).
//   • Outstanding dues dropped patients without a doctor (INNER JOIN).
//   • Flatpickr "16 Oct 2026" was parsed as DD-MM-YYYY → "Invalid date" in SQL.
//   • DATE(t.ShiftDate) prevented index use.
// ═════════════════════════════════════════════════════════════════════════════

const SETTLEMENT_DATE_FORMATS = ['D MMM YYYY', 'DD MMM YYYY', 'DD-MM-YYYY', 'D-M-YYYY', 'YYYY-MM-DD', 'DD/MM/YYYY'];
const SETTLEMENT_MAX_DAYS     = 366;
const OUTSTANDING_LIMIT       = 500;

const sNum = (v) => Number(v) || 0;
const sR2  = (v) => Math.round(sNum(v) * 100) / 100;

const settlementError = (msg) => { const e = new Error(msg); e.isUserError = true; return e; };

/** Accepts body/query { FromDate, ToDate } in any of the formats above. Defaults to today. */
const parseRange = (src = {}) => {
    const parse = (v) => {
        const s = String(v || '').trim();
        if (!s) return null;
        const m = moment(s, SETTLEMENT_DATE_FORMATS, true);
        if (!m.isValid()) throw settlementError(`"${s}" is not a valid date.`);
        return m.startOf('day');
    };
    let from = parse(src.FromDate || src.from);
    let to   = parse(src.ToDate   || src.to);
    const today = moment().startOf('day');
    if (!from && !to) from = to = today;
    if (!from) from = to.clone();
    if (!to)   to   = from.clone();
    if (from.isAfter(to)) [from, to] = [to, from];
    if (to.diff(from, 'days') >= SETTLEMENT_MAX_DAYS) throw settlementError(`Please choose a range of at most ${SETTLEMENT_MAX_DAYS} days.`);
    return { from: from.format('YYYY-MM-DD'), to: to.format('YYYY-MM-DD') };
};

/** Mode of a ledger row; rows written before PaymentMode existed fall back sensibly. */
const TX_MODE   = `COALESCE(t.PaymentMode, CASE WHEN t.CreditOnline > 0 OR t.Notes LIKE 'Online reduced%' THEN 'online' ELSE 'cash' END)`;
const TX_CREDIT = `t.TransactionType IN ('payment','balance_collected')`;
const TX_OLD    = `t.ShiftDate > DATE(pd.RegisteredOn)`;
/**
 * Registered and cancelled on the SAME day → the patient never counts: the money
 * that came in and the refund that went out that day are both left out.
 * Cancelled on a LATER day → the original day keeps its collection (it was
 * handed over), and the refund is a cash-out on the day of cancellation.
 */
const SAME_DAY_CANCEL = `(pd.Status = 0 AND DATE(pd.CancelledAt) = DATE(pd.RegisteredOn))`;
const TX_COUNTED      = `NOT (${SAME_DAY_CANCEL} AND t.ShiftDate = DATE(pd.RegisteredOn))`;
const USER_NAME = (a) => `TRIM(CONCAT(COALESCE(${a}.FirstName,''),' ',COALESCE(${a}.LastName,'')))`;

// 1. Money per receptionist (ledger)
const qMoneyByUser = (R) => db().query(`
    SELECT t.UserId,
        SUM(CASE WHEN ${TX_CREDIT} THEN t.CreditCash   ELSE 0 END)                    AS CashIn,
        SUM(CASE WHEN ${TX_CREDIT} THEN t.CreditOnline ELSE 0 END)                    AS OnlineIn,
        SUM(CASE WHEN ${TX_CREDIT} AND ${TX_OLD} THEN t.CreditCash   ELSE 0 END)      AS OldDuesCash,
        SUM(CASE WHEN ${TX_CREDIT} AND ${TX_OLD} THEN t.CreditOnline ELSE 0 END)      AS OldDuesOnline,
        SUM(CASE WHEN t.TransactionType = 'refund' AND ${TX_MODE} = 'cash'   THEN t.Debit ELSE 0 END) AS CashRefund,
        SUM(CASE WHEN t.TransactionType = 'refund' AND ${TX_MODE} = 'online' THEN t.Debit ELSE 0 END) AS OnlineRefund,
        SUM(CASE WHEN t.TransactionType = 'change_returned' THEN t.Debit ELSE 0 END)  AS ChangeReturned
    FROM TransactionTable t
    JOIN PatientDetails pd ON pd.Id = t.PatientId
    WHERE t.ShiftDate BETWEEN ? AND ? AND ${TX_COUNTED}
    GROUP BY t.UserId`, R).then(([r]) => r);

// 2. Registrations per receptionist — billed, and dues left at the end of that day
const qRegistrationsByUser = (R) => db().query(`
    SELECT x.RegisteredBy AS UserId,
           SUM(CASE WHEN x.SameDayCancel = 0 THEN 1 ELSE 0 END)                             AS TotalPatients,
           SUM(CASE WHEN x.Status = 1 THEN 1 ELSE 0 END)                                    AS ActivePatients,
           SUM(x.SameDayCancel)                                                             AS SameDayCancelled,
           SUM(CASE WHEN x.SameDayCancel = 0 THEN x.GrossAmount ELSE 0 END)                 AS Billed,
           SUM(CASE WHEN x.SameDayCancel = 0 THEN GREATEST(0, x.GrossAmount - x.NetAmount) ELSE 0 END) AS Discount,
           SUM(CASE WHEN x.SameDayCancel = 0 THEN x.NetAmount ELSE 0 END)                   AS NetBilled,
           SUM(CASE WHEN x.SameDayCancel = 0 THEN GREATEST(0, x.NetAmount - x.SameDayNet) ELSE 0 END) AS NewDues,
           SUM(CASE WHEN x.Status = 1 THEN x.DuesAmount  ELSE 0 END)                        AS NewDuesStillOpen,
           SUM(CASE WHEN x.AdvanceBookingDate IS NOT NULL AND x.SameDayCancel = 0 THEN 1 ELSE 0 END) AS AdvanceBookings
    FROM (
        SELECT pd.Id, pd.RegisteredBy, pd.Status, pd.GrossAmount, pd.DuesAmount, pd.AdvanceBookingDate,
               COALESCE(pd.ActualAmount, pd.GrossAmount - COALESCE(pd.Discount, 0)) AS NetAmount,
               CASE WHEN ${SAME_DAY_CANCEL} THEN 1 ELSE 0 END AS SameDayCancel,
               COALESCE((
                   SELECT SUM(CASE WHEN ${TX_CREDIT} THEN t.CreditCash + t.CreditOnline
                                   WHEN t.TransactionType IN ('refund','change_returned') THEN -t.Debit
                                   ELSE 0 END)
                   FROM TransactionTable t
                   WHERE t.PatientId = pd.Id AND t.ShiftDate = DATE(pd.RegisteredOn)
               ), 0) AS SameDayNet
        FROM PatientDetails pd
        WHERE pd.RegisteredOn >= ? AND pd.RegisteredOn < ? + INTERVAL 1 DAY
    ) x
    GROUP BY x.RegisteredBy`, R).then(([r]) => r);

// 3. Cancellations per receptionist
const qCancelsByUser = (R) => db().query(`
    SELECT pd.CancelledBy AS UserId, COUNT(*) AS Cancellations
    FROM PatientDetails pd
    WHERE pd.Status = 0 AND pd.CancelledAt >= ? AND pd.CancelledAt < ? + INTERVAL 1 DAY
    GROUP BY pd.CancelledBy`, R).then(([r]) => r);

// ─────────────────────────────────────────────────────────────
// ONLINE SOURCE BREAKDOWN — per user per source (PhonePe, HDFC…)
// ─────────────────────────────────────────────────────────────
const getOnlineSourceBreakdown = async (req) => {
    const { from, to } = parseRange(req.body);
    const [rows] = await db().query(`
        SELECT t.UserId, ${USER_NAME('u')} AS UserName,
               ops.Name AS SourceName, COALESCE(ops.ShortCode, ops.Name, 'Online') AS SourceCode,
               SUM(t.CreditOnline) AS Amount, COUNT(*) AS TxCount
        FROM TransactionTable t
        JOIN PatientDetails pd ON pd.Id = t.PatientId
        LEFT JOIN Users u ON u.Id = t.UserId
        LEFT JOIN OnlinePaymentSources ops ON ops.Id = t.OnlineSourceId
        WHERE t.ShiftDate BETWEEN ? AND ? AND ${TX_CREDIT} AND t.CreditOnline > 0 AND ${TX_COUNTED}
        GROUP BY t.UserId, t.OnlineSourceId, ops.Name, ops.ShortCode, u.FirstName, u.LastName
        ORDER BY t.UserId, Amount DESC`, [from, to]);
    return rows.map(r => ({ ...r, Amount: sR2(r.Amount) }));
};

// ─────────────────────────────────────────────────────────────
// CANCELLED PATIENTS IN RANGE (by cancel date)
// ─────────────────────────────────────────────────────────────
const getCancelledPatients = async (req) => {
    const { from, to } = parseRange(req.body);
    const [rows] = await db().query(`
        SELECT pd.Id AS PatientId, pd.Name, pd.PhoneNumber, pd.GrossAmount, pd.CancelReason,
               DATE_FORMAT(pd.RegisteredOn, '%d-%m-%Y')          AS RegisteredOn,
               DATE_FORMAT(pd.CancelledAt, '%d-%m-%Y %h:%i %p')  AS CancelledAt,
               CASE WHEN DATE(pd.RegisteredOn) < DATE(pd.CancelledAt) THEN 1 ELSE 0 END AS CrossDayCancellation,
               CASE WHEN DATE(pd.RegisteredOn) < DATE(pd.CancelledAt) THEN 1 ELSE 0 END AS AffectsCollection,
               pd.ThanksGivenTo, pd.ThanksAmount,
               CASE WHEN EXISTS (SELECT 1 FROM PatientTestRefference r WHERE r.PatientId = pd.Id AND r.ReportReady = 1) THEN 1 ELSE 0 END AS HadReport,
               ${USER_NAME('ur')} AS RegisteredByName,
               ${USER_NAME('uc')} AS CancelledByName,
               COALESCE(rf.Cash, 0)   AS RefundCash,
               COALESCE(rf.Online, 0) AS RefundOnline,
               COALESCE(rf.Total, 0)  AS TotalRefunded
        FROM PatientDetails pd
        LEFT JOIN Users ur ON ur.Id = pd.RegisteredBy
        LEFT JOIN Users uc ON uc.Id = pd.CancelledBy
        LEFT JOIN (
            SELECT t.PatientId,
                   SUM(CASE WHEN ${TX_MODE} = 'cash'   THEN t.Debit ELSE 0 END) AS Cash,
                   SUM(CASE WHEN ${TX_MODE} = 'online' THEN t.Debit ELSE 0 END) AS Online,
                   SUM(t.Debit) AS Total
            FROM TransactionTable t
            WHERE t.TransactionType = 'refund' AND t.Notes LIKE 'Refund on cancellation%'
            GROUP BY t.PatientId
        ) rf ON rf.PatientId = pd.Id
        WHERE pd.Status = 0 AND pd.CancelledAt >= ? AND pd.CancelledAt < ? + INTERVAL 1 DAY
        ORDER BY pd.CancelledAt DESC`, [from, to]);
    return rows;
};

// ─────────────────────────────────────────────────────────────
// ADVANCE BOOKINGS MADE IN RANGE (stay listed after arrival)
// ─────────────────────────────────────────────────────────────
const getAdvanceBookings = async (req) => {
    const { from, to } = parseRange(req.body);
    const [rows] = await db().query(`
        SELECT pd.Id AS PatientId, pd.Name, pd.PhoneNumber, pd.Status, pd.BookingStatus, pd.GrossAmount,
               DATE_FORMAT(pd.RegisteredOn,       '%d-%m-%Y') AS BookedOn,
               DATE_FORMAT(pd.AdvanceBookingDate, '%d-%m-%Y') AS AppointmentDate,
               pd.AdvancePaid, pd.DuesAmount AS BalancePending,
               ${USER_NAME('u')} AS RegisteredBy
        FROM PatientDetails pd
        LEFT JOIN Users u ON u.Id = pd.RegisteredBy
        WHERE pd.AdvanceBookingDate IS NOT NULL AND pd.RegisteredOn >= ? AND pd.RegisteredOn < ? + INTERVAL 1 DAY
        ORDER BY pd.AdvanceBookingDate, pd.Id`, [from, to]);
    return rows;
};

// ─────────────────────────────────────────────────────────────
// DUES OF THE SELECTED DATES — bills registered in the range that are still unpaid.
// (Before: every unpaid bill in the system up to the end date — mixed old and new.)
// ─────────────────────────────────────────────────────────────
const getOutstandingDues = async (req) => {
    const { from, to } = parseRange(req.body);
    const [rows] = await db().query(`
        SELECT pd.Id AS PatientId, pd.Title, pd.Name, pd.PhoneNumber, pd.GrossAmount, pd.ActualAmount,
               pd.DuesAmount AS PendingDues, pd.BookingStatus,
               DATE_FORMAT(pd.RegisteredOn, '%d-%m-%Y') AS RegisteredOn,
               DATEDIFF(CURDATE(), pd.RegisteredOn)     AS DaysPending,
               ${USER_NAME('u')} AS RegisteredBy, pd.RegisteredBy AS RegisteredById,
               d.FirstName AS DoctorFirstName, d.LastName AS DoctorLastName
        FROM PatientDetails pd
        LEFT JOIN Users u         ON u.Id = pd.RegisteredBy
        LEFT JOIN DoctorDetails d ON d.Id = pd.DoctorId
        WHERE pd.Status = 1 AND pd.DuesAmount > 0
          AND pd.RegisteredOn >= ? AND pd.RegisteredOn < ? + INTERVAL 1 DAY
        ORDER BY pd.RegisteredOn DESC, pd.Id DESC
        LIMIT ${OUTSTANDING_LIMIT}`, [from, to]);
    const [[tot]] = await db().query(`
        SELECT COALESCE(SUM(DuesAmount),0) AS Total, COUNT(*) AS Cnt FROM PatientDetails
        WHERE Status = 1 AND DuesAmount > 0 AND RegisteredOn >= ? AND RegisteredOn < ? + INTERVAL 1 DAY`, [from, to]);
    rows.forEach(r => { r.PendingDues = sR2(r.PendingDues); });
    rows.total = sR2(tot.Total);
    rows.count = sNum(tot.Cnt);
    return rows;
};

/** Every unpaid bill in the system up to the end date — shown only as a small reminder line. */
const getAllPendingDues = async (req) => {
    const { to } = parseRange(req.body);
    const [[tot]] = await db().query(
        'SELECT COALESCE(SUM(DuesAmount),0) AS Total, COUNT(*) AS Cnt FROM PatientDetails WHERE Status = 1 AND DuesAmount > 0 AND RegisteredOn < ? + INTERVAL 1 DAY', [to]);
    return { total: sR2(tot.Total), count: sNum(tot.Cnt) };
};

// ─────────────────────────────────────────────────────────────
// OLD DUES RECEIVED IN RANGE (patient registered on an earlier day)
// ─────────────────────────────────────────────────────────────
const getDuesReceived = async (req) => {
    const { from, to } = parseRange(req.body);
    const [rows] = await db().query(`
        SELECT t.Id, t.PatientId, pd.Name, pd.PhoneNumber,
               CASE WHEN t.CreditOnline > 0 THEN 'online' ELSE 'cash' END AS PaymentMode,
               ops.Name AS OnlineSource,
               (t.CreditCash + t.CreditOnline) AS AmountCollected,
               DATE_FORMAT(t.TransactedOn, '%d-%m-%Y %h:%i %p') AS CollectedAt,
               DATE_FORMAT(pd.RegisteredOn, '%d-%m-%Y')         AS RegisteredOn,
               ${USER_NAME('u')} AS CollectedBy
        FROM TransactionTable t
        JOIN PatientDetails pd ON pd.Id = t.PatientId
        LEFT JOIN Users u ON u.Id = t.UserId
        LEFT JOIN OnlinePaymentSources ops ON ops.Id = t.OnlineSourceId
        WHERE t.ShiftDate BETWEEN ? AND ? AND ${TX_CREDIT} AND ${TX_OLD}
          AND (t.CreditCash + t.CreditOnline) > 0
        ORDER BY t.TransactedOn DESC`, [from, to]);
    return rows;
};

// ─────────────────────────────────────────────────────────────
// USER-WISE COLLECTION — one card per receptionist
// ─────────────────────────────────────────────────────────────
const getUserWiseCollection = async (req) => {
    const { from, to } = parseRange(req.body);
    const R = [from, to];
    const [money, regs, cancels] = await Promise.all([qMoneyByUser(R), qRegistrationsByUser(R), qCancelsByUser(R)]);

    const byUser = new Map();
    const get = (id) => {
        const k = String(id == null ? 0 : id);
        if (!byUser.has(k)) byUser.set(k, {
            UserId: id, TotalPatients: 0, ActivePatients: 0, SameDayCancelled: 0, Billed: 0, Discount: 0, NetBilled: 0, NewDues: 0, NewDuesStillOpen: 0,
            AdvanceBookings: 0, Cancellations: 0, CashCollected: 0, OnlineCollected: 0,
            OldDuesCash: 0, OldDuesOnline: 0, CashRefund: 0, OnlineRefund: 0, ChangeReturned: 0,
        });
        return byUser.get(k);
    };
    money.forEach(r => Object.assign(get(r.UserId), {
        CashCollected: sR2(r.CashIn), OnlineCollected: sR2(r.OnlineIn),
        OldDuesCash: sR2(r.OldDuesCash), OldDuesOnline: sR2(r.OldDuesOnline),
        CashRefund: sR2(r.CashRefund), OnlineRefund: sR2(r.OnlineRefund), ChangeReturned: sR2(r.ChangeReturned),
    }));
    regs.forEach(r => Object.assign(get(r.UserId), {
        TotalPatients: sNum(r.TotalPatients), ActivePatients: sNum(r.ActivePatients), SameDayCancelled: sNum(r.SameDayCancelled),
        Billed: sR2(r.Billed), Discount: sR2(r.Discount), NetBilled: sR2(r.NetBilled), NewDues: sR2(r.NewDues),
        NewDuesStillOpen: sR2(r.NewDuesStillOpen), AdvanceBookings: sNum(r.AdvanceBookings),
    }));
    cancels.forEach(r => { get(r.UserId).Cancellations = sNum(r.Cancellations); });

    const ids = [...byUser.values()].map(u => u.UserId).filter(id => id != null);
    const [users] = ids.length ? await db().query('SELECT Id, FirstName, LastName FROM Users WHERE Id IN (?)', [ids]) : [[]];
    const names = new Map(users.map(u => [String(u.Id), u]));

    return [...byUser.values()].map(u => {
        const nm = names.get(String(u.UserId)) || {};
        return {
            ...u,
            FirstName:      nm.FirstName || (u.UserId ? 'User #' + u.UserId : 'Unknown'),
            LastName:       nm.LastName  || '',
            DuesCollected:  sR2(u.OldDuesCash + u.OldDuesOnline),
            NewPatientCash: sR2(u.CashCollected - u.OldDuesCash),
            TotalRefunded:  sR2(u.CashRefund + u.OnlineRefund),
            NetToHandOver:  sR2(u.CashCollected - u.CashRefund - u.ChangeReturned),   // CASH ONLY
            NetOnline:      sR2(u.OnlineCollected - u.OnlineRefund),
        };
    }).sort((a, b) => b.Billed - a.Billed || b.CashCollected - a.CashCollected);
};

// ─────────────────────────────────────────────────────────────
// PATIENT COUNT PER USER (kept for older callers)
// ─────────────────────────────────────────────────────────────
const getPatientCountPerUser = async (req) =>
    (await getUserWiseCollection(req)).filter(u => u.TotalPatients > 0).map(u => ({
        UserId: u.UserId, FirstName: u.FirstName, LastName: u.LastName,
        TotalPatients: u.TotalPatients, ActivePatients: u.ActivePatients,
        CancelledPatients: u.TotalPatients - u.ActivePatients + u.SameDayCancelled, AdvancePatients: u.AdvanceBookings,
        TotalGross: u.Billed, TotalDiscount: u.Discount,
    }));

const buildSummary = (userWise, outstandingDues, advanceBookings) => {
    const sum = (k) => sR2(userWise.reduce((a, u) => a + sNum(u[k]), 0));
    return {
        TotalPatients:         sum('TotalPatients'),
        TotalBilled:           sum('Billed'),
        TotalNetBilled:        sum('NetBilled'),
        TotalCollected:        sR2(sum('CashCollected') + sum('OnlineCollected')),   // money actually received
        TotalDiscount:         sum('Discount'),
        TotalCash:             sum('CashCollected'),
        TotalOnline:           sum('OnlineCollected'),
        NewPatientCash:        sum('NewPatientCash'),
        CashRefunded:          sum('CashRefund'),
        OnlineRefunded:        sum('OnlineRefund'),
        TotalRefunded:         sum('TotalRefunded'),
        ChangeReturned:        sum('ChangeReturned'),
        DuesCollectedToday:    sum('DuesCollected'),
        OldDuesCash:           sum('OldDuesCash'),
        OldDuesOnline:         sum('OldDuesOnline'),
        NewDues:               sum('NewDues'),
        NewDuesStillOpen:      sum('NewDuesStillOpen'),
        NetHandover:           sum('NetToHandOver'),
        NetOnline:             sum('NetOnline'),
        TotalCancellations:    sum('Cancellations'),
        SameDayCancelled:      sum('SameDayCancelled'),
        TotalPendingDues:      outstandingDues.total != null ? outstandingDues.total : sR2(outstandingDues.reduce((a, d) => a + sNum(d.PendingDues), 0)),
        PendingDuesPatients:   outstandingDues.count != null ? outstandingDues.count : outstandingDues.length,
        AdvanceMoneyCollected: sR2(advanceBookings.filter(a => Number(a.Status) !== 0).reduce((a, b) => a + sNum(b.AdvancePaid), 0)),
    };
};

/** Top cards only (kept for older callers / dashboard widgets). */
const getTotalCollection = async (req) => {
    const [userWise, outstandingDues, advanceBookings] = await Promise.all([
        getUserWiseCollection(req), getOutstandingDues(req), getAdvanceBookings(req)]);
    return buildSummary(userWise, outstandingDues, advanceBookings);
};

// ─────────────────────────────────────────────────────────────
// BILL REGISTER — every bill of the selected dates, grouped by the user who made it.
// Each bill: Gross − Discount = Net;  Net − paid at registration = dues left that day.
// Flags anything that does not add up so the owner can check bill by bill.
// ─────────────────────────────────────────────────────────────
const getBillRegister = async (req) => {
    const { from, to } = parseRange(req.body);
    const [rows] = await db().query(`
        SELECT pd.Id AS BillNo, pd.Title, pd.Name, pd.PhoneNumber, pd.RegisteredBy AS UserId,
               DATE_FORMAT(pd.RegisteredOn, '%d-%m-%Y') AS RegDate, pd.RegisteredTime,
               pd.Status, pd.BookingStatus, pd.DiscountApprovedBy,
               DATE_FORMAT(pd.CancelledAt, '%d-%m-%Y') AS CancelledOn,
               CASE WHEN ${SAME_DAY_CANCEL} THEN 1 ELSE 0 END AS SameDayCancel,
               pd.GrossAmount AS Gross,
               COALESCE(pd.ActualAmount, pd.GrossAmount - COALESCE(pd.Discount, 0)) AS Net,
               pd.DuesAmount AS DuesNow,
               TRIM(CONCAT(COALESCE(d.FirstName,''),' ',COALESCE(d.LastName,''))) AS Doctor,
               (SELECT GROUP_CONCAT(m.TestName ORDER BY m.TestName SEPARATOR ', ')
                  FROM PatientTestRefference r JOIN MainTestTable m ON m.Id = r.TestId
                 WHERE r.PatientId = pd.Id) AS Tests,
               COALESCE(m.RegCashIn, 0) AS RegCashIn, COALESCE(m.RegCashOut, 0) AS RegCashOut,
               COALESCE(m.RegOnlineIn, 0) AS RegOnlineIn, COALESCE(m.RegOnlineOut, 0) AS RegOnlineOut,
               COALESCE(m.PaidAll, 0) AS PaidAll
        FROM PatientDetails pd
        LEFT JOIN DoctorDetails d ON d.Id = pd.DoctorId
        LEFT JOIN (
            SELECT t.PatientId,
                   SUM(CASE WHEN t.ShiftDate = DATE(p2.RegisteredOn) AND ${TX_CREDIT} THEN t.CreditCash ELSE 0 END) AS RegCashIn,
                   SUM(CASE WHEN t.ShiftDate = DATE(p2.RegisteredOn) AND (t.TransactionType = 'change_returned'
                             OR (t.TransactionType = 'refund' AND ${TX_MODE} = 'cash')) THEN t.Debit ELSE 0 END)  AS RegCashOut,
                   SUM(CASE WHEN t.ShiftDate = DATE(p2.RegisteredOn) AND ${TX_CREDIT} THEN t.CreditOnline ELSE 0 END) AS RegOnlineIn,
                   SUM(CASE WHEN t.ShiftDate = DATE(p2.RegisteredOn) AND t.TransactionType = 'refund' AND ${TX_MODE} = 'online'
                            THEN t.Debit ELSE 0 END) AS RegOnlineOut,
                   SUM(CASE WHEN ${TX_CREDIT} THEN t.CreditCash + t.CreditOnline
                            WHEN t.TransactionType IN ('refund','change_returned') THEN -t.Debit ELSE 0 END) AS PaidAll
            FROM TransactionTable t
            JOIN PatientDetails p2 ON p2.Id = t.PatientId
            WHERE p2.RegisteredOn >= ? AND p2.RegisteredOn < ? + INTERVAL 1 DAY
            GROUP BY t.PatientId
        ) m ON m.PatientId = pd.Id
        WHERE pd.RegisteredOn >= ? AND pd.RegisteredOn < ? + INTERVAL 1 DAY
        ORDER BY pd.RegisteredBy, pd.Id`, [from, to, from, to]);

    // bills that were edited after registration (needs the patient-audit tables; skipped if not installed)
    const edited = new Map();
    if (rows.length) {
        try {
            const [ev] = await db().query(`
                SELECT PatientId, COUNT(*) AS Edits, MAX(RiskLevel IN ('high','critical')) AS Risky
                FROM PatientAuditEvent WHERE Action = 'EDIT' AND PatientId IN (?) GROUP BY PatientId`, [rows.map(r => r.BillNo)]);
            ev.forEach(e => edited.set(Number(e.PatientId), { edits: sNum(e.Edits), risky: sNum(e.Risky) === 1 }));
        } catch (e) { if (e.code !== 'ER_NO_SUCH_TABLE') throw e; }
    }

    return rows.map(r => {
        const gross = sR2(r.Gross), net = sR2(r.Net);
        const cash = sR2(r.RegCashIn - r.RegCashOut), online = sR2(r.RegOnlineIn - r.RegOnlineOut);
        const paidAtReg = sR2(cash + online);
        const duesNow = sR2(r.DuesNow);
        const expectedDues = sR2(Math.max(0, net - sNum(r.PaidAll)));
        const flags = [];
        if (Number(r.Status) === 1 && Math.abs(expectedDues - duesNow) > 0.5)
            flags.push(`Dues saved as ₹${duesNow} but bill − payments = ₹${expectedDues}`);
        if (sNum(r.PaidAll) > net + 0.5 && Number(r.Status) === 1)
            flags.push(`Paid ₹${sR2(r.PaidAll)} is more than the bill ₹${net}`);
        if (gross - net > 0.5 && !String(r.DiscountApprovedBy || '').trim())
            flags.push('Discount given without "approved by"');
        const ed = edited.get(Number(r.BillNo));
        if (ed) flags.push(`Edited ${ed.edits} time${ed.edits > 1 ? 's' : ''} after registration${ed.risky ? ' — high risk' : ''}`);
        return {
            BillNo: r.BillNo, UserId: r.UserId, Title: r.Title, Name: r.Name, PhoneNumber: r.PhoneNumber,
            RegDate: r.RegDate, RegisteredTime: r.RegisteredTime, Doctor: r.Doctor, Tests: r.Tests || '',
            Status: Number(r.Status), SameDayCancel: sNum(r.SameDayCancel) === 1, CancelledOn: r.CancelledOn,
            BookingStatus: r.BookingStatus, DiscountApprovedBy: r.DiscountApprovedBy,
            Gross: gross, Discount: sR2(Math.max(0, gross - net)), Net: net,
            Cash: cash, Online: online, PaidAtReg: paidAtReg,
            DuesLeft: sR2(Math.max(0, net - paidAtReg)),   // unpaid at the end of the registration day
            DuesNow: Number(r.Status) === 1 ? duesNow : 0,
            Edited: ed ? ed.edits : 0, flags,
        };
    });
};

// ─────────────────────────────────────────────────────────────
// CASH BOOK — every rupee in or out in the selected dates, per user, in time order.
// Its cash total is exactly the amount to hand over.
// ─────────────────────────────────────────────────────────────
const getCashBook = async (req) => {
    const { from, to } = parseRange(req.body);
    const [rows] = await db().query(`
        SELECT t.Id, t.UserId, t.PatientId AS BillNo, pd.Title, pd.Name, t.TransactionType, t.Notes,
               t.CreditCash, t.CreditOnline, t.Debit, ${TX_MODE} AS Mode,
               COALESCE(ops.ShortCode, ops.Name) AS Source,
               DATE_FORMAT(t.TransactedOn, '%d-%m-%Y %h:%i %p') AS At,
               CASE WHEN ${TX_OLD} THEN 1 ELSE 0 END AS IsOld,
               DATE_FORMAT(pd.RegisteredOn, '%d-%m-%Y') AS RegDate
        FROM TransactionTable t
        JOIN PatientDetails pd ON pd.Id = t.PatientId
        LEFT JOIN OnlinePaymentSources ops ON ops.Id = t.OnlineSourceId
        WHERE t.ShiftDate BETWEEN ? AND ? AND ${TX_COUNTED}
        ORDER BY t.UserId, t.TransactedOn, t.Id`, [from, to]);
    return rows.map(r => {
        const credit = ['payment', 'balance_collected'].includes(r.TransactionType);
        const isRefund = r.TransactionType === 'refund', isChange = r.TransactionType === 'change_returned';
        const kind = credit ? (sNum(r.IsOld) ? 'Old dues received' : 'Payment on new bill')
                   : isRefund ? 'Refund' : isChange ? 'Change returned' : r.TransactionType;
        return {
            Id: r.Id, UserId: r.UserId, BillNo: r.BillNo, Title: r.Title, Name: r.Name, At: r.At, RegDate: r.RegDate,
            Kind: kind, IsOld: sNum(r.IsOld) === 1, Note: r.Notes || '', Source: r.Source || '',
            CashIn:    credit ? sR2(r.CreditCash) : 0,
            OnlineIn:  credit ? sR2(r.CreditOnline) : 0,
            CashOut:   (isChange || (isRefund && r.Mode === 'cash'))   ? sR2(r.Debit) : 0,
            OnlineOut: (isRefund && r.Mode === 'online') ? sR2(r.Debit) : 0,
        };
    }).filter(r => r.CashIn || r.OnlineIn || r.CashOut || r.OnlineOut);
};

const sumBy = (arr, k) => sR2(arr.reduce((a, x) => a + sNum(x[k]), 0));

/** Per-user statement: bills + cash book + the two equations the owner checks. */
const buildSettlementUsers = (userWise, bills, cashbook, onlineSources) => {
    const map = new Map(userWise.map(u => [String(u.UserId == null ? 0 : u.UserId), {
        ...u, Name: `${u.FirstName || ''} ${u.LastName || ''}`.trim() }]));
    const ensure = (id) => {
        const k = String(id == null ? 0 : id);
        if (!map.has(k)) map.set(k, { UserId: id, Name: id ? `User #${id}` : 'Unknown' });
        return map.get(k);
    };
    bills.forEach(b => ensure(b.UserId));
    cashbook.forEach(c => ensure(c.UserId));

    return [...map.values()].map(u => {
        const myBills = bills.filter(b => String(b.UserId) === String(u.UserId));
        const counted = myBills.filter(b => !b.SameDayCancel);
        const myBook  = cashbook.filter(c => String(c.UserId) === String(u.UserId));
        const billTotals = {
            Count: counted.length, Cancelled: myBills.length - counted.length,
            Gross: sumBy(counted, 'Gross'), Discount: sumBy(counted, 'Discount'), Net: sumBy(counted, 'Net'),
            Cash: sumBy(counted, 'Cash'), Online: sumBy(counted, 'Online'), PaidAtReg: sumBy(counted, 'PaidAtReg'),
            DuesLeft: sumBy(counted, 'DuesLeft'), DuesNow: sumBy(counted, 'DuesNow'),
            Flagged: counted.filter(b => b.flags.length).length,
        };
        const newBill = myBook.filter(c => c.Kind === 'Payment on new bill');
        const old     = myBook.filter(c => c.Kind === 'Old dues received');
        const cashTotals = {
            NewBillCash: sumBy(newBill, 'CashIn'), NewBillOnline: sumBy(newBill, 'OnlineIn'),
            OldDuesCash: sumBy(old, 'CashIn'),     OldDuesOnline: sumBy(old, 'OnlineIn'),
            RefundCash:  sumBy(myBook.filter(c => c.Kind === 'Refund'), 'CashOut'),
            ChangeReturned: sumBy(myBook.filter(c => c.Kind === 'Change returned'), 'CashOut'),
            OnlineOut: sumBy(myBook, 'OnlineOut'),
            CashIn: sumBy(myBook, 'CashIn'), CashOut: sumBy(myBook, 'CashOut'),
            OnlineIn: sumBy(myBook, 'OnlineIn'),
        };
        cashTotals.HandOver  = sR2(cashTotals.CashIn - cashTotals.CashOut);
        cashTotals.NetOnline = sR2(cashTotals.OnlineIn - cashTotals.OnlineOut);
        return {
            UserId: u.UserId, Name: u.Name || (u.UserId ? `User #${u.UserId}` : 'Unknown'),
            bills: myBills, billTotals, cashbook: myBook, cashTotals,
            online: onlineSources.filter(o => String(o.UserId) === String(u.UserId)),
            Cancellations: sNum(u.Cancellations),
        };
    }).filter(u => u.bills.length || u.cashbook.length || u.Cancellations)
      .sort((a, b) => b.billTotals.Net - a.billTotals.Net || b.cashTotals.HandOver - a.cashTotals.HandOver);
};

// ─────────────────────────────────────────────────────────────
// MASTER SETTLEMENT — one call, everything the page needs.
// Throws (err.isUserError = true for bad input) — the controller decides what to show.
// ─────────────────────────────────────────────────────────────
const getMasterSettlement = async (req) => {
    const { from, to } = parseRange(req.body);       // validates before any query runs
    const r = { body: { FromDate: from, ToDate: to } };
    const [userWise, onlineSources, cancellations, advanceBookings, outstandingDues, duesReceived, bills, cashbook, allPendingDues] = await Promise.all([
        getUserWiseCollection(r), getOnlineSourceBreakdown(r), getCancelledPatients(r),
        getAdvanceBookings(r),    getOutstandingDues(r),       getDuesReceived(r),
        getBillRegister(r),       getCashBook(r),              getAllPendingDues(r),
    ]);
    const users = buildSettlementUsers(userWise, bills, cashbook, onlineSources);
    const T = (k) => sR2(users.reduce((a, u) => a + sNum(u.billTotals[k]), 0));
    const C = (k) => sR2(users.reduce((a, u) => a + sNum(u.cashTotals[k]), 0));
    const grand = {
        Bills: T('Count'), Cancelled: T('Cancelled'), Gross: T('Gross'), Discount: T('Discount'), Net: T('Net'),
        Cash: T('Cash'), Online: T('Online'), PaidAtReg: T('PaidAtReg'), DuesLeft: T('DuesLeft'), DuesNow: T('DuesNow'),
        Flagged: T('Flagged'),
        NewBillCash: C('NewBillCash'), NewBillOnline: C('NewBillOnline'), OldDuesCash: C('OldDuesCash'), OldDuesOnline: C('OldDuesOnline'),
        RefundCash: C('RefundCash'), ChangeReturned: C('ChangeReturned'), OnlineOut: C('OnlineOut'),
        HandOver: C('HandOver'), NetOnline: C('NetOnline'),
    };
    return {
        success: true,
        from, to,
        dateRange: {
            from: moment(from).format('D MMM YYYY'),
            to:   moment(to).format('D MMM YYYY'),
            same: from === to,
            isToday: from === to && to === moment().format('YYYY-MM-DD'),
        },
        summary: { ...buildSummary(userWise, outstandingDues, advanceBookings),
                   AllPendingDues: allPendingDues.total, AllPendingDuesPatients: allPendingDues.count },
        users, grand, allPendingDues,
        userWise, onlineSources, cancellations, advanceBookings, outstandingDues, duesReceived,
        patientCounts: userWise.filter(u => u.TotalPatients > 0),
        outstandingTruncated: outstandingDues.count > outstandingDues.length,
        generatedAt: moment().format('DD MMM YYYY, hh:mm A'),
    };
};

const templateService = require("../helper/templateService");

/*const getTemplateById = async (id) => {
    const [rows] = await db().execute(
        `SELECT rt.*, m.TestName,
                CONCAT(d.FirstName,' ',d.LastName) AS DoctorName
         FROM ReportTemplates rt
         LEFT JOIN MainTestTable  m ON m.Id = rt.TestId
         LEFT JOIN DoctorDetails  d ON d.Id = rt.DoctorId
         WHERE rt.Id = ? LIMIT 1`,
        [id]
    );
    return rows[0] || null;
};*/


const getTemplatesForTest = async (testId) => {
    const [rows] = await db().execute(`
        SELECT Id, Name, GenderType, FilePath, OriginalName, TemplateType
        FROM ReportTemplates
        WHERE TestId = ? AND DoctorId IS NULL AND IsActive = 1
        ORDER BY FIELD(GenderType,'common','male','female')
    `, [testId]);

    // Return as { common, male, female }
    const result = { common: null, male: null, female: null };
    rows.forEach(r => { result[r.GenderType] = r; });
    return result;
};


const saveTemplate = async ({
    id, name, doctorId, testId, genderType,
    filePath, originalName, createdBy
}) => {
    // Auto-derive type
    let templateType = "system_default";
    if (doctorId && testId)  templateType = "doctor_test";
    else if (doctorId)       templateType = "doctor_default";
    else if (testId)         templateType = "test_default";

    if (id) {
        await db().execute(`
            UPDATE ReportTemplates
            SET Name=?, DoctorId=?, TestId=?, GenderType=?,
                FilePath=?, OriginalName=?, TemplateType=?, UpdatedAt=NOW()
            WHERE Id=?`,
            [name, doctorId||null, testId||null, genderType,
             filePath, originalName, templateType, id]
        );
        return { success: true, id };
    }

    const [r] = await db().execute(`
        INSERT INTO ReportTemplates
            (Name, DoctorId, TestId, GenderType,
             FilePath, OriginalName, TemplateType, CreatedBy)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [name, doctorId||null, testId||null, genderType,
         filePath, originalName, templateType, createdBy]
    );
    return { success: true, id: r.insertId };
};


const deleteTemplate = async (id) => {
    const template = await getTemplateById(id);
    if (!template) return { success: false, message: "Not found." };

    // Delete file from disk
    templateService.deleteFile(template.FilePath);

    await db().execute(
        `UPDATE ReportTemplates SET IsActive=0 WHERE Id=?`, [id]
    );
    return { success: true };
};


// ── 2. Resolve the best template for a given doctor + test + gender ───────────
//
// Priority order (handled by TemplateType column):
//   1. doctor_test    — specific to this doctor AND this test
//   2. doctor_default — this doctor's default (any test)
//   3. test_default   — default for this test (any doctor)
//   4. system_default — global fallback
//
// Within each priority, gender-specific beats 'common'.
//
// Returns one of:
//   { mode: 'both', doctor: row, test: row }  — show both side by side
//   { mode: 'auto', template: row }            — single best template
//   { mode: 'none', template: null }           — no template found, blank editor
 
// ── 2. Resolve best template from ReportTemplates table ───────────────────────
const resolveTemplateOld = async (doctorId, testId, genderKey) => {
    const safeGender = ['male', 'female'].includes(genderKey) ? genderKey : 'common';
 
    const [rows] = await db().execute(`
        SELECT Id, Name, Content, GenderType, TemplateType, DoctorId, TestId
        FROM ReportTemplates
        WHERE IsActive = 1
          AND (
              (DoctorId = ? AND TestId = ? AND GenderType IN (?, 'common'))
           OR (DoctorId = ? AND TestId IS NULL  AND GenderType IN (?, 'common'))
           OR (DoctorId IS NULL AND TestId = ?  AND GenderType IN (?, 'common'))
           OR (DoctorId IS NULL AND TestId IS NULL AND GenderType = 'common')
          )
        ORDER BY
            CASE TemplateType
                WHEN 'doctor_test'    THEN 1
                WHEN 'doctor_default' THEN 2
                WHEN 'test_default'   THEN 3
                WHEN 'system_default' THEN 4
            END,
            CASE GenderType WHEN ? THEN 1 ELSE 2 END
    `, [
        doctorId, testId, safeGender,
        doctorId,         safeGender,
        testId,           safeGender,
        safeGender
    ]);
 
    const best = {};
    rows.forEach(r => { if (!best[r.TemplateType]) best[r.TemplateType] = r; });
 
    const doctorTemplate = best['doctor_test']  || best['doctor_default'] || null;
    const testTemplate   = best['test_default'] || best['system_default'] || null;
 
    if (doctorTemplate && testTemplate && doctorTemplate.Id !== testTemplate.Id) {
        return { mode: 'both', doctor: doctorTemplate, test: testTemplate };
    }
    if (doctorTemplate) return { mode: 'auto', template: doctorTemplate };
    if (testTemplate)   return { mode: 'auto', template: testTemplate   };
    return { mode: 'none', template: null };
};

// ─────────────────────────────────────────────────────────────
// PATIENT CONTEXT (for placeholder injection)
// ─────────────────────────────────────────────────────────────

const getPatientReportContext = async (patientId, testId, reportingDoctorId) => {
    const [rows] = await db().execute(`
        SELECT
            pd.Id          AS PatientId,
            pd.Title, pd.Name, pd.Age, pd.YMD, pd.Gender,
            pd.PhoneNumber, pd.Address,
            DATE_FORMAT(pd.RegisteredOn,'%d-%m-%Y') AS Date,
            CONCAT('Dr. ',rd.FirstName,' ',rd.LastName)  AS DoctorName,
            m.TestName,
            ptr.Id         AS TestRefId,
            ptr.ReportReady,
            CONCAT(ru.FirstName,' ',ru.LastName)          AS ReportingDoctor,
            CONCAT_WS(', ',
                NULLIF(rdd.Degree1,''), NULLIF(rdd.Degree2,''),
                NULLIF(rdd.Degree3,''), NULLIF(rdd.Degree4,'')
            )                                             AS ReportingDoctorDegree
        FROM PatientDetails pd
        JOIN DoctorDetails rd      ON rd.Id  = pd.DoctorId
        JOIN PatientTestRefference ptr
                                   ON ptr.PatientId = pd.Id AND ptr.TestId = ?
        JOIN MainTestTable m        ON m.Id   = ptr.TestId
        JOIN Users ru               ON ru.Id  = ?
        LEFT JOIN DoctorDetails rdd ON rdd.Id = ?
        WHERE pd.Id = ?
        LIMIT 1
    `, [testId, reportingDoctorId, reportingDoctorId, patientId]);

    if (!rows.length) return null;
    const row = rows[0];

    return {
        ...row,
        patient_name:    `${row.Title || ""} ${row.Name}`.trim(),
        age:             `${row.Age} ${row.YMD}`,
        gender:          row.Gender == 1 ? "Male" : "Female",
        genderKey:       row.Gender == 1 ? "male" : "female",
        test_name:       row.TestName,
        doctor_name:     row.DoctorName,
        date:            row.Date,
        phone_number:    row.PhoneNumber || "",
        address:         row.Address    || "",
        reporting_doctor:        row.ReportingDoctor        || "",
        reporting_doctor_degree: row.ReportingDoctorDegree  || "",
    };
};


// ─────────────────────────────────────────────────────────────
// PATIENT REPORT SAVE
// ─────────────────────────────────────────────────────────────

const savePatientReport = async ({
    patientId, testId, testRefId, reportingDoctorId,
    templateId, templateType, content, markReady, userId
}) => {
    const [existing] = await db().execute(
        `SELECT Id FROM PatientReports WHERE PatientId=? AND TestId=? LIMIT 1`,
        [patientId, testId]
    );

    const readyAt = markReady
        ? require("moment-timezone")().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss")
        : null;

    let reportId;
    if (existing.length) {
        reportId = existing[0].Id;
        await db().execute(
            `UPDATE PatientReports
             SET ReportContent=?, ReportReady=?, ReadyAt=?, UpdatedAt=NOW()
             WHERE Id=?`,
            [content, markReady ? 1 : 0, readyAt, reportId]
        );
    } else {
        const [r] = await db().execute(
            `INSERT INTO PatientReports
                (PatientId,TestRefId,TestId,DoctorId,TemplateId,
                 TemplateType,ReportContent,ReportReady,ReadyAt,CreatedBy)
             VALUES (?,?,?,?,?,?,?,?,?,?)`,
            [patientId, testRefId, testId, reportingDoctorId,
             templateId||null, templateType||"manual",
             content, markReady?1:0, readyAt, userId]
        );
        reportId = r.insertId;
    }

    if (markReady) {
        await db().execute(
            `UPDATE PatientTestRefference SET ReportReady=1
             WHERE PatientId=? AND TestId=?`,
            [patientId, testId]
        );
    }

    return { success: true, reportId };
};
// models/doctorReportModel.js
// All database queries for doctor patient reference report

// ─────────────────────────────────────────────────────────────
// HELPER — parse DD-MM-YYYY → YYYY-MM-DD for MySQL
// ─────────────────────────────────────────────────────────────
const parseDate = (ddmmyyyy) => {
    // ★ strict: "31-02-2026" or text from a crafted URL used to go straight into the SQL / period loop
    if (!ddmmyyyy) return null;
    const m = moment(String(ddmmyyyy), 'DD-MM-YYYY', true);
    return m.isValid() ? m.format('YYYY-MM-DD') : null;
};
const MAX_REPORT_MONTHS = 36;
const assertMonthRange = (fromSql, toSql) => {
    if (fromSql > toSql) throw reportError('Start date cannot be after end date.');
    if (moment(toSql).diff(moment(fromSql), 'months') >= MAX_REPORT_MONTHS)
        throw reportError(`Please choose at most ${MAX_REPORT_MONTHS} months.`);   // one SQL column per month/period
};


// ─────────────────────────────────────────────────────────────
// HELPER — generate month labels between two dates
// Returns: [ { label:'Dec 25', year:2025, month:12 }, ... ]
// ─────────────────────────────────────────────────────────────
const generateMonthRange = (fromSql, toSql) => {
    const months = [];
    const [fy, fm] = fromSql.split("-").map(Number);
    const [ty, tm] = toSql.split("-").map(Number);

    let cur = new Date(fy, fm - 1, 1);
    const end = new Date(ty, tm - 1, 1);

    while (cur <= end) {
        months.push({
            label: cur.toLocaleString("en-IN", {
                month: "short",
                year:  "2-digit"
            }),
            year:  cur.getFullYear(),
            month: cur.getMonth() + 1,
        });
        cur.setMonth(cur.getMonth() + 1);
    }
    return months;
};


// ─────────────────────────────────────────────────────────────
// HELPER — generate period ranges (1–10, 1–15 etc.)
// Returns: [ { label:'1-10 Dec 25', fromDate:'2025-12-01', toDate:'2025-12-10' }, ... ]
// ─────────────────────────────────────────────────────────────
const generatePeriodRange = (fromSql, toSql, periodEndDay) => {
    const end_day = parseInt(periodEndDay) || 10;
    const periods = [];

    const [fy, fm] = fromSql.split("-").map(Number);
    const [ty, tm] = toSql.split("-").map(Number);

    let cur = new Date(fy, fm - 1, 1);
    const endDate = new Date(ty, tm - 1, 1);

    while (cur <= endDate) {
        const year     = cur.getFullYear();
        const month    = cur.getMonth() + 1;
        const mm       = String(month).padStart(2, "0");
        const lastDay  = new Date(year, month, 0).getDate();
        const actualEnd = Math.min(end_day, lastDay);

        const monthLabel = cur.toLocaleString("en-IN", { month: "short" });
        const yearLabel  = String(year).slice(2);

        periods.push({
            label:    `1-${actualEnd} ${monthLabel} ${yearLabel}`,
            fromDate: `${year}-${mm}-01`,
            toDate:   `${year}-${mm}-${String(actualEnd).padStart(2, "0")}`,
        });
        cur.setMonth(cur.getMonth() + 1);
    }
    return periods;
};



// ─────────────────────────────────────────────────────────────
// GET MONTH-WISE REPORT
// Returns pivoted data: each row = one doctor with monthly counts
// ─────────────────────────────────────────────────────────────
const getMonthWiseReport = async (categoryId, startDate, endDate) => {
    try {
        const fromSql = parseDate(startDate);
        const toSql   = parseDate(endDate);

        if (!fromSql || !toSql) {
            throw reportError("Invalid date format. Use DD-MM-YYYY.");
        }
        assertMonthRange(fromSql, toSql);
        categoryId = toId(categoryId) || 0;

        // Build month range for column labels
        const monthRange = generateMonthRange(fromSql, toSql);

        // Fetch raw counts grouped by doctor + year + month
        const [rows] = await db().execute(`
            SELECT
                d.Id                                        AS DoctorId,
                CONCAT(d.FirstName, ' ', d.LastName)        AS DoctorName,
                d.SpecialistIn,
                YEAR(p.RegisteredOn)                        AS Year,
                MONTH(p.RegisteredOn)                       AS Month,
                COUNT(DISTINCT p.Id)                        AS PatientCount
            FROM PatientDetails p
            JOIN DoctorDetails d ON d.Id = p.DoctorId
            JOIN PatientTestRefference ptr ON ptr.PatientId = p.Id
            JOIN MainTestTable m ON m.Id = ptr.TestId
            JOIN Category c ON c.Id = m.CategoryId
            WHERE DATE(p.RegisteredOn) BETWEEN ? AND ?
              AND c.Id = ?
              AND p.Status = 1
            GROUP BY
                d.Id, d.FirstName, d.LastName, d.SpecialistIn,
                YEAR(p.RegisteredOn), MONTH(p.RegisteredOn)
            ORDER BY
                d.FirstName, d.LastName,
                YEAR(p.RegisteredOn), MONTH(p.RegisteredOn)
        `, [fromSql, toSql, categoryId]);

        // Pivot — build one row per doctor
        const doctorMap = {};

        rows.forEach(row => {
            if (!doctorMap[row.DoctorId]) {
                doctorMap[row.DoctorId] = {
                    DoctorId:    row.DoctorId,
                    DoctorName:  row.DoctorName,
                    SpecialistIn: row.SpecialistIn || "",
                };
                // Initialise all months to 0
                monthRange.forEach(m => {
                    doctorMap[row.DoctorId][m.label] = 0;
                });
            }

            // Match this row to a month label
            const match = monthRange.find(
                m => m.year === row.Year && m.month === row.Month
            );
            if (match) {
                doctorMap[row.DoctorId][match.label] = row.PatientCount;
            }
        });

        return {
            reportData: Object.values(doctorMap),
            months:     monthRange.map(m => m.label),
        };

    } catch (err) {
        console.error("getMonthWiseReport:", err);
        throw err;
    }
};


// ─────────────────────────────────────────────────────────────
// GET PERIOD-WISE REPORT
// e.g. 1–10 of each month across date range
// ─────────────────────────────────────────────────────────────
const getPeriodWiseReport = async (categoryId, startDate, endDate, periodEndDay) => {
    try {
        const fromSql = parseDate(startDate);
        const toSql   = parseDate(endDate);

        if (!fromSql || !toSql) {
            throw reportError("Invalid date format. Use DD-MM-YYYY.");
        }
        assertMonthRange(fromSql, toSql);
        categoryId = toId(categoryId) || 0;

        const periods = generatePeriodRange(fromSql, toSql, periodEndDay);

        if (!periods.length) {
            return { reportData: [], months: [] };
        }

        // Build dynamic CASE expressions — one per period
        const caseStatements = periods.map((p, i) =>
            `SUM(CASE
                WHEN DATE(p.RegisteredOn) BETWEEN '${p.fromDate}' AND '${p.toDate}'
                THEN 1 ELSE 0
             END) AS \`period_${i}\``
        ).join(",\n            ");

        const [rows] = await db().execute(`
            SELECT
                d.Id                                     AS DoctorId,
                CONCAT(d.FirstName, ' ', d.LastName)     AS DoctorName,
                d.SpecialistIn,
                ${caseStatements}
            FROM PatientDetails p
            JOIN DoctorDetails d ON d.Id = p.DoctorId
            JOIN PatientTestRefference ptr ON ptr.PatientId = p.Id
            JOIN MainTestTable m ON m.Id = ptr.TestId
            JOIN Category c ON c.Id = m.CategoryId
            WHERE DATE(p.RegisteredOn) BETWEEN ? AND ?
              AND c.Id = ?
              AND p.Status = 1
            GROUP BY
                d.Id, d.FirstName, d.LastName, d.SpecialistIn
            ORDER BY
                d.FirstName, d.LastName
        `, [
            periods[0].fromDate,
            periods[periods.length - 1].toDate,
            categoryId
        ]);

        // Map period_0 → label etc.
        const reportData = rows.map(row => {
            const doc = {
                DoctorId:     row.DoctorId,
                DoctorName:   row.DoctorName,
                SpecialistIn: row.SpecialistIn || "",
            };
            periods.forEach((p, i) => {
                doc[p.label] = parseInt(row[`period_${i}`]) || 0;
            });
            return doc;
        });

        return {
            reportData,
            months: periods.map(p => p.label),
        };

    } catch (err) {
        console.error("getPeriodWiseReport:", err);
        throw err;
    }
};


/**
 * 
 * This section is for patient report creataion
 */

// ═══════════════════════════════════════════════════════════
// 1. GET COMPREHENSIVE REPORT PAGE DATA
// ═══════════════════════════════════════════════════════════
const getReportPageData = async (patientId, testId) => {
    const [[row]] = await db().query(`
        SELECT
            pd.Id                                     AS PatientId,
            CONCAT(pd.Title, ' ', pd.Name)            AS PatientName,
            pd.Age,
            pd.YMD,
            pd.Gender,
            pd.Status,
            pd.DoctorId,
            pd.RegisteredOn,
            CONCAT(d.FirstName, ' ', d.LastName)      AS DoctorName,
            CONCAT(d.Degree1, ' ',d.Degree2, ' ', d.Degree3)                               AS DoctorDegree,
            t.Id                                      AS TestId,
            t.TestName,
            t.IsReportRequired,
            c.Name                                    AS CategoryName,
            ptr.Id                                    AS TestRefId,
            ptr.Report                                AS ExistingReportLegacy,
            ptr.ReportReady                           AS ReportReadyLegacy,
            ptr.IsFinalized,
            ptr.FinalizedAt,
            ptr.FinalizedBy,
            ptr.TestStatus,
            CONCAT(u.FirstName, ' ', u.LastName)      AS FinalizedByName,
            pr.ReportContent                          AS ExistingReport,
            pr.ReportReady,
            pr.TemplateId,
            pr.TemplateType,
            pr.ReadyAt
        FROM PatientDetails        pd
        JOIN PatientTestRefference ptr ON ptr.PatientId = pd.Id
                                      AND ptr.TestId    = ?
        JOIN MainTestTable         t   ON t.Id          = ptr.TestId
        LEFT JOIN Category         c   ON c.Id          = t.CategoryId
        LEFT JOIN DoctorDetails    d   ON d.Id          = pd.DoctorId
        LEFT JOIN Users            u   ON u.Id          = ptr.FinalizedBy
        LEFT JOIN PatientReports    pr  ON pr.PatientId  = pd.Id 
                                      AND pr.TestId     = t.Id
        WHERE pd.Id = ?
        LIMIT 1
    `, [testId, patientId]);
 
    return row || null;
};

// ═══════════════════════════════════════════════════════════
// 2. RESOLVE TEMPLATE (Priority: Doctor Test → Doctor Default → Test Default)
// ═══════════════════════════════════════════════════════════
const resolveTemplate = async (doctorId, testId, gender) => {
    const genderKey = gender.toLowerCase() === 'male' ? 'male' : 'female';
    
    // 1. Try doctor's test-specific template
    const [doctorTestTemplates] = await db().execute(
        `SELECT Id, Content, GenderType 
         FROM ReportTemplates 
         WHERE DoctorId = ? AND TestId = ? AND IsActive = 1 
         AND GenderType IN (?, 'common')
         ORDER BY FIELD(GenderType, ?, 'common')
         LIMIT 1`,
        [doctorId, testId, genderKey, genderKey]
    );
    
    if (doctorTestTemplates.length > 0) {
        return {
            templateId: doctorTestTemplates[0].Id,
            templateType: 'doctor_test',
            content: doctorTestTemplates[0].Content
        };
    }
    
    // 2. Try doctor's default template
    const [doctorDefaultTemplates] = await db().execute(
        `SELECT Id, Content 
         FROM ReportTemplates 
         WHERE DoctorId = ? AND TestId IS NULL AND IsActive = 1 
         AND GenderType IN (?, 'common')
         ORDER BY FIELD(GenderType, ?, 'common')
         LIMIT 1`,
        [doctorId, genderKey, genderKey]
    );
    
    if (doctorDefaultTemplates.length > 0) {
        return {
            templateId: doctorDefaultTemplates[0].Id,
            templateType: 'doctor_default',
            content: doctorDefaultTemplates[0].Content
        };
    }
    
    // 3. Fallback to test default template
    const [testData] = await db().execute(
        `SELECT TemplateCommon, TemplateMale, TemplateFemale 
         FROM MainTestTable 
         WHERE Id = ? LIMIT 1`,
        [testId]
    );
    
    if (testData.length > 0) {
        let template = testData[0].TemplateCommon;
        
        if (genderKey === 'male' && testData[0].TemplateMale) {
            template = testData[0].TemplateMale;
        } else if (genderKey === 'female' && testData[0].TemplateFemale) {
            template = testData[0].TemplateFemale;
        }
        
        if (template) {
            return {
                templateId: null,
                templateType: 'test_default',
                content: template
            };
        }
    }
    
    // 4. No template found
    return {
        templateId: null,
        templateType: 'manual',
        content: '<p>No template available. Please create report content.</p>'
    };
};

// ═══════════════════════════════════════════════════════════
// 3. GET ALL AVAILABLE TEMPLATES (For Template Selector)
// ═══════════════════════════════════════════════════════════
/*const getAllTemplates = async (doctorId, testId, gender) => {
    const genderKey = gender.toLowerCase() === 'male' ? 'male' : 'female';
    
    const templates = {
        doctorTest: null,
        doctorDefault: null,
        testDefault: null
    };
    
    // Get doctor's test-specific template
    const [doctorTestTemplates] = await db().execute(
        `SELECT Id, Content FROM ReportTemplates 
         WHERE DoctorId = ? AND TestId = ? AND IsActive = 1 
         AND GenderType IN (?, 'common')
         ORDER BY FIELD(GenderType, ?, 'common')
         LIMIT 1`,
        [doctorId, testId, genderKey, genderKey]
    );
    
    if (doctorTestTemplates.length > 0) {
        templates.doctorTest = {
            id: doctorTestTemplates[0].Id,
            content: doctorTestTemplates[0].Content
        };
    }
    
    // Get doctor's default template
    const [doctorDefaultTemplates] = await db().execute(
        `SELECT Id, Content FROM ReportTemplates 
         WHERE DoctorId = ? AND TestId IS NULL AND IsActive = 1 
         AND GenderType IN (?, 'common')
         ORDER BY FIELD(GenderType, ?, 'common')
         LIMIT 1`,
        [doctorId, genderKey, genderKey]
    );
    
    if (doctorDefaultTemplates.length > 0) {
        templates.doctorDefault = {
            id: doctorDefaultTemplates[0].Id,
            content: doctorDefaultTemplates[0].Content
        };
    }
    
    // Get test default template
    const [testData] = await db().execute(
        `SELECT TemplateCommon, TemplateMale, TemplateFemale 
         FROM MainTestTable WHERE Id = ? LIMIT 1`,
        [testId]
    );
    
    if (testData.length > 0) {
        let template = testData[0].TemplateCommon;
        
        if (genderKey === 'male' && testData[0].TemplateMale) {
            template = testData[0].TemplateMale;
        } else if (genderKey === 'female' && testData[0].TemplateFemale) {
            template = testData[0].TemplateFemale;
        }
        
        if (template) {
            templates.testDefault = {
                id: null,
                content: template
            };
        }
    }
    
    return templates;
};
*/
// ═══════════════════════════════════════════════════════════
// 4. CREATE OR UPDATE REPORT IN PatientReport TABLE
// ═══════════════════════════════════════════════════════════
const saveReport = async (reportData) => {
    // ★ stored XSS: the editor posts raw HTML; it is shown to doctors and on the PUBLIC link page
    reportData = { ...reportData, ReportContent: cleanHtml(reportData.ReportContent) };
    if (!reportData.ReportContent) throw reportError('Report content is empty (after removing unsafe content).');

    // Check if report exists
    const [existing] = await db().execute(
        `SELECT Id, ReportContent, ReportReady FROM PatientReports WHERE PatientId = ? AND TestId = ? LIMIT 1`,
        [reportData.PatientId, reportData.TestId]
    );
    
    if (existing.length > 0) {
        // ★ a report that was READY keeps its previous text in the history before being changed
        if (Number(existing[0].ReportReady) === 1 && existing[0].ReportContent !== reportData.ReportContent) {
            await writeReportHistory({ patientId: reportData.PatientId, testId: reportData.TestId, testRefId: reportData.TestRefId,
                                       action: 'EDIT_AFTER_READY', content: existing[0].ReportContent, userId: reportData.CreatedBy });
        }
        // Update existing
        await db().execute(
            `UPDATE PatientReports 
             SET ReportContent = ?, TemplateId = ?, TemplateType = ?, ReportReady = ?
             WHERE PatientId = ? AND TestId = ?`,
            [
                reportData.ReportContent,
                reportData.TemplateId,
                reportData.TemplateType,
                reportData.ReportReady || 0,
                reportData.PatientId,
                reportData.TestId
            ]
        );
        return existing[0].Id;
    } else {
        // Insert new
        const [result] = await db().execute(
            `INSERT INTO PatientReports
             (PatientId, TestRefId, TestId, DoctorId, TemplateId, TemplateType, ReportContent, ReportReady, CreatedBy)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                reportData.PatientId,
                reportData.TestRefId,
                reportData.TestId,
                reportData.DoctorId,
                reportData.TemplateId,
                reportData.TemplateType,
                reportData.ReportContent,
                reportData.ReportReady || 0,
                reportData.CreatedBy
            ]
        );
        return result.insertId;
    }
};

// ═══════════════════════════════════════════════════════════
// 5. MARK REPORT AS READY (Updates both tables)
// ═══════════════════════════════════════════════════════════
const markReportReady = async (patientId, testId, testRefId) => {
    // Update PatientReport
    await db().execute(
        `UPDATE PatientReports 
         SET ReportReady = 1, ReadyAt = NOW() 
         WHERE PatientId = ? AND TestId = ?`,
        [patientId, testId]
    );
    
    // Update PatientTestRefference
    await db().execute(
        `UPDATE PatientTestRefference 
         SET ReportReady = 1, ReadyAt = NOW() 
         WHERE Id = ?`,
        [testRefId]
    );
};

// ═══════════════════════════════════════════════════════════
// 6. MARK REPORT AS DRAFT (Un-ready)
// ═══════════════════════════════════════════════════════════
const markReportDraft = async (patientId, testId, testRefId) => {
    // Update PatientReport
    await db().execute(
        `UPDATE PatientReports 
         SET ReportReady = 0, ReadyAt = NULL 
         WHERE PatientId = ? AND TestId = ?`,
        [patientId, testId]
    );
    
    // Update PatientTestRefference
    await db().execute(
        `UPDATE PatientTestRefference 
         SET ReportReady = 0
         WHERE Id = ?`,
        [testRefId]
    );
};

// ═══════════════════════════════════════════════════════════
// 7. FINALIZE REPORT (Lock from editing)
// ═══════════════════════════════════════════════════════════
const finalizeReport = async (patientId, testId, testRefId, finalizedBy) => {
    // Must have content before finalizing
    const [[pr]] = await db().query(
        `SELECT ReportContent, ReportReady FROM PatientReports
         WHERE PatientId = ? AND TestId = ? LIMIT 1`,
        [patientId, testId]
    );
 
    if (!pr) throw new Error('Report record not found.');
    if (!pr.ReportReady) throw new Error('Mark report as ready before finalizing.');
    if (!pr.ReportContent?.trim()) throw new Error('Report content is empty.');
 
    // Update PatientTestRefference to finalize
    const [result] = await db().query(
        `UPDATE PatientTestRefference
         SET IsFinalized = 1, FinalizedAt = NOW(),TestStatus= 'Completed',CompletedOn= NOW(), FinalizedBy = ?
         WHERE Id = ? AND PatientId = ? AND TestId = ? AND COALESCE(IsFinalized, 0) = 0`,
        [finalizedBy, testRefId, patientId, testId]
    );
    if (result.affectedRows > 0) {
        // ★ exactly what was signed, by whom, when
        await writeReportHistory({ patientId, testId, testRefId, action: 'FINALIZE', content: pr.ReportContent, userId: finalizedBy });
    }
    return result.affectedRows > 0;
};

// ═══════════════════════════════════════════════════════════
// 8. UN-FINALIZE REPORT (Allow editing)
// ═══════════════════════════════════════════════════════════
/**
 * ★ Un-finalizing a signed report used to leave no trace (anyone could unlock → change → re-sign).
 * Now: a reason is required, the signed text + who/when go to ReportHistory first.
 * Permission is checked in the controller (User.canEditFinalReport).
 */
const unfinalizeReport = async (testRefId, { patientId = null, testId = null, userId = null, reason = '' } = {}) => {
    const [[ref]] = await db().query(
        `SELECT ptr.Id, ptr.PatientId, ptr.TestId, ptr.IsFinalized, pr.ReportContent
         FROM PatientTestRefference ptr
         LEFT JOIN PatientReports pr ON pr.PatientId = ptr.PatientId AND pr.TestId = ptr.TestId
         WHERE ptr.Id = ? LIMIT 1`, [testRefId]);
    if (!ref) throw reportError('Report not found.', 404);
    if ((patientId && Number(ref.PatientId) !== Number(patientId)) || (testId && Number(ref.TestId) !== Number(testId)))
        throw reportError('This report does not belong to this patient / test.');
    if (Number(ref.IsFinalized) !== 1) return false;
    await writeReportHistory({ patientId: ref.PatientId, testId: ref.TestId, testRefId: ref.Id, action: 'UNFINALIZE',
                               content: ref.ReportContent, userId, reason });
    await db().query(
        `UPDATE PatientTestRefference
         SET IsFinalized = 0, FinalizedAt = NULL, FinalizedBy = NULL
         WHERE Id = ?`,
        [testRefId]
    );
    return true;
};

// ═══════════════════════════════════════════════════════════
// 9. MARK REPORT AS GENERATED IN TestDeliverables
// ═══════════════════════════════════════════════════════════
const markReportGenerated = async (patientId, testId, generatedBy) => {
    await db().query(`
        UPDATE TestDeliverables td
        JOIN   PatientTestRefference ptr ON ptr.Id = td.PatientTestReferenceId
        SET    td.IsGenerated = 1, td.GeneratedOn = NOW(), td.GeneratedBy = ?
        WHERE  ptr.PatientId    = ?
          AND  ptr.TestId       = ?
          AND  td.ComponentType = 'Report'
          AND  td.IsGenerated   = 0
    `, [generatedBy, patientId, testId]);
};


// ═══════════════════════════════════════════════════════════
// CHECK IF REPORT IS FINALIZED
// ═══════════════════════════════════════════════════════════
const isReportFinalized = async (testRefId) => {
    const [[row]] = await db().query(
        `SELECT IsFinalized FROM PatientTestRefference WHERE Id = ? LIMIT 1`,
        [testRefId]
    );
    
    return row ? row.IsFinalized === 1 : false;
};


// ═══════════════════════════════════════════════════════════
// SAVE TEMPLATES
// ═══════════════════════════════════════════════════════════
/*const saveDoctorTestTemplate = async (doctorId, testId, content) => {
    await db().execute(
        `INSERT INTO ReportTemplates (DoctorId, TestId, Content, CreatedBy)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE Content = VALUES(Content), UpdatedAt = NOW()`,
        [doctorId, testId, content, doctorId]
    );
};*/

/*const saveDoctorDefaultTemplate = async (doctorId, content) => {
    await db().execute(
        `INSERT INTO ReportTemplates (DoctorId, TestId, Content, CreatedBy)
         VALUES (?, NULL, ?, ?)
         ON DUPLICATE KEY UPDATE Content = VALUES(Content), UpdatedAt = NOW()`,
        [doctorId, content, doctorId]
    );
};*/

/*const saveTestDefaultTemplate = async (testId, content) => {
    // Determine gender from content or save to TemplateCommon
    await db().execute(
        `UPDATE MainTestTable SET TemplateCommon = ? WHERE Id = ?`,
        [content, testId]
    );
};*/

/**13 june 2026
 * Get templates for the report screen.
 * Returns: { primary: {...}, alternatives: [...] }
 *
 * Priority:
 *   1. Doctor's own template for this test+gender  → primary
 *   2. test_default for this test+gender           → primary (if no doctor template)
 *   3. Everything else                             → alternatives dropdown
 */
const getTemplatesForReport = async (testId, patientGender, doctorId) => {
    // patientGender: 'male' | 'female'
    // We fetch: doctor's own + test_default for (exact gender OR common)
  
    const sql = `
      SELECT 
        Id, Name, GenderType, TemplateType, Content, DoctorId,
        CASE
          WHEN TemplateType = 'doctor_test' AND DoctorId = ? THEN 1
          WHEN TemplateType = 'test_default' AND GenderType = ?  THEN 2
          WHEN TemplateType = 'test_default' AND GenderType = 'common' THEN 3
          ELSE 4
        END AS Priority
      FROM ReportTemplates
      WHERE 
        TestId    = ?
        AND IsActive = 1
        AND (
          (TemplateType = 'doctor_test'  AND DoctorId = ?)
          OR
          (TemplateType = 'test_default' AND GenderType IN (?, 'common'))
        )
      ORDER BY Priority ASC
    `;
  
    const [rows] = await db().query(sql, [
      doctorId,       // for CASE priority
      patientGender,  // for CASE priority
      testId,         // WHERE TestId
      doctorId,       // WHERE doctor_test condition
      patientGender,  // WHERE test_default gender condition
    ]);
  
    if (rows.length === 0) {
      return { primary: null, alternatives: [] };
    }
  
    const primary      = rows[0];           // highest priority = loads in editor
    const alternatives = rows.slice(1);     // rest = dropdown options
  
    return { primary, alternatives };
  };
  


// ═══════════════════════════════════════════════════════════
// getAllTemplates — returns flat array with Id, Name, type
// Used by EJS dropdown. One call, one query.
// ═══════════════════════════════════════════════════════════
const getAllTemplates = async (doctorId, testId, gender) => {
    const genderKey = gender === 'male' ? 'male' : gender === 'female' ? 'female' : 'common';

    const sql = `
        SELECT
            rt.Id,
            rt.Name,
            rt.GenderType,
            rt.TemplateType,
            rt.Content,
            rt.DoctorId,
            CASE
                WHEN rt.TemplateType = 'doctor_test'    AND rt.DoctorId = ? THEN 1
                WHEN rt.TemplateType = 'doctor_default' AND rt.DoctorId = ? THEN 2
                WHEN rt.TemplateType = 'test_default'   AND rt.GenderType = ?  THEN 3
                WHEN rt.TemplateType = 'test_default'   AND rt.GenderType = 'common' THEN 4
                ELSE 5
            END AS Priority
        FROM ReportTemplates rt
        WHERE
            rt.TestId   = ?
            AND rt.IsActive = 1
            AND (
                (rt.TemplateType IN ('doctor_test','doctor_default') AND rt.DoctorId = ?)
                OR
                (rt.TemplateType = 'test_default' AND rt.GenderType IN (?, 'common'))
            )
        ORDER BY Priority ASC
    `;

    const [rows] = await db().query(sql, [
        doctorId,    // CASE doctor_test
        doctorId,    // CASE doctor_default
        genderKey,   // CASE test_default gender match
        testId,      // WHERE TestId
        doctorId,    // WHERE doctor condition
        genderKey,   // WHERE test_default gender
    ]);

    // Also check MainTestTable for test_default (backward compat until migration done)
    const [testRows] = await db().execute(
        `SELECT TemplateCommon, TemplateMale, TemplateFemale, TestName FROM MainTestTable WHERE Id = ? LIMIT 1`,
        [testId]
    );

    const hasTestDefaultInRT = rows.some(r => r.TemplateType === 'test_default');

    if (!hasTestDefaultInRT && testRows.length > 0) {
        const t = testRows[0];
        let content = t.TemplateCommon;
        let matchedGender = 'common';

        if (genderKey === 'male' && t.TemplateMale) {
            content = t.TemplateMale;
            matchedGender = 'male';
        } else if (genderKey === 'female' && t.TemplateFemale) {
            content = t.TemplateFemale;
            matchedGender = 'female';
        }

        if (content) {
            rows.push({
                Id:           null,
                Name:         `${t.TestName} — Default`,
                GenderType:   matchedGender,
                TemplateType: 'test_default',
                Content:      content,
                DoctorId:     null,
                Priority:     matchedGender === 'common' ? 4 : 3,
            });
        }
    }

    return rows; // flat array, sorted by Priority
};


// ═══════════════════════════════════════════════════════════
// saveDoctorTestTemplate — fixed: includes Name, GenderType, TemplateType
// auto-detects gender from patientGender param
// ═══════════════════════════════════════════════════════════
const saveDoctorTestTemplate = async (doctorId, testId, content, genderType = 'common', testName = 'Report') => {
    content = cleanHtml(content);                                   // ★ no scripts in templates
    if (!content) throw reportError('Template content is empty.');
    genderType = ['male', 'female'].includes(genderType) ? genderType : 'common';
    const name = `${testName} — ${genderType.charAt(0).toUpperCase() + genderType.slice(1)} (Dr. Custom)`;

    await db().execute(
        `INSERT INTO ReportTemplates
            (Name, DoctorId, TestId, GenderType, Content, TemplateType, IsActive, CreatedBy)
         VALUES (?, ?, ?, ?, ?, 'doctor_test', 1, ?)
         ON DUPLICATE KEY UPDATE
            Content   = VALUES(Content),
            Name      = VALUES(Name),
            UpdatedAt = CURRENT_TIMESTAMP`,
        [name, doctorId, testId, genderType, content, doctorId]
    );
};


// ═══════════════════════════════════════════════════════════
// saveDoctorDefaultTemplate — fixed: includes Name, GenderType, TemplateType
// ═══════════════════════════════════════════════════════════
const saveDoctorDefaultTemplate = async (doctorId, content, genderType = 'common') => {
    content = cleanHtml(content);                                   // ★ no scripts in templates
    if (!content) throw reportError('Template content is empty.');
    genderType = ['male', 'female'].includes(genderType) ? genderType : 'common';
    const name = `Doctor Default — ${genderType.charAt(0).toUpperCase() + genderType.slice(1)}`;

    await db().execute(
        `INSERT INTO ReportTemplates
            (Name, DoctorId, TestId, GenderType, Content, TemplateType, IsActive, CreatedBy)
         VALUES (?, ?, NULL, ?, ?, 'doctor_default', 1, ?)
         ON DUPLICATE KEY UPDATE
            Content   = VALUES(Content),
            Name      = VALUES(Name),
            UpdatedAt = CURRENT_TIMESTAMP`,
        [name, doctorId, genderType, content, doctorId]
    );
};


// ═══════════════════════════════════════════════════════════
// saveTestDefaultTemplate — fixed: saves to ReportTemplates NOT MainTestTable
// ═══════════════════════════════════════════════════════════
const saveTestDefaultTemplate = async (testId, content, genderType = 'common', createdBy = 1) => {
    content = cleanHtml(content);                                   // ★ no scripts in templates
    if (!content) throw reportError('Template content is empty.');
    genderType = ['male', 'female'].includes(genderType) ? genderType : 'common';
    // Fetch test name for a readable label
    const [rows] = await db().execute(
        `SELECT TestName FROM MainTestTable WHERE Id = ? LIMIT 1`,
        [testId]
    );
    const testName = rows[0]?.TestName || 'Test';
    const name     = `${testName} — ${genderType.charAt(0).toUpperCase() + genderType.slice(1)} Default`;

    await db().execute(
        `INSERT INTO ReportTemplates
            (Name, DoctorId, TestId, GenderType, Content, TemplateType, IsActive, CreatedBy)
         VALUES (?, NULL, ?, ?, ?, 'test_default', 1, ?)
         ON DUPLICATE KEY UPDATE
            Content   = VALUES(Content),
            Name      = VALUES(Name),
            UpdatedAt = CURRENT_TIMESTAMP`,
        [name, testId, genderType, content, createdBy]
    );
};


// ═══════════════════════════════════════════════════════════
// getTemplateById — fetches single template by Id
// Used by switchTemplate when called with a numeric Id
// ═══════════════════════════════════════════════════════════
const getTemplateById = async (id) => {
    const [rows] = await db().execute(
        `SELECT rt.Id, rt.Name, rt.Content, rt.GenderType, rt.TemplateType, rt.DoctorId,
                m.TestName
         FROM ReportTemplates rt
         LEFT JOIN MainTestTable m ON m.Id = rt.TestId
         WHERE rt.Id = ? AND rt.IsActive = 1
         LIMIT 1`,
        [id]
    );
    return rows[0] || null;
};

// ═══════════════════════════════════════════════════════════
// ADD to Report.js model
// ═══════════════════════════════════════════════════════════

// Fetch all users with Doctor role — for report signature block
const getAllReportingDoctors = async () => {
    const [rows] = await db().execute(`
        SELECT
            u.Id,
            u.FirstName,
            u.LastName,
            u.Qualification,
            u.SignaturePath
        FROM Users u
        JOIN Roles r ON r.Id = u.RoleId
        WHERE LOWER(r.Name) = 'doctor'
        ORDER BY u.FirstName, u.LastName
    `);
    return rows;
};

// ═══════════════════════════════════════════════════════════
// 10. GET FINALIZED REPORT FOR DOWNLOAD
// ═══════════════════════════════════════════════════════════

// ── 2. MODEL: getFinalizedReport — replace in Report.js ────────
// Adds: ReportingDoctorDegree, ReportingDoctorSigPath
// from the DoctorDetails row of the user who finalized the report.
 
const getFinalizedReport = async (patientId, testId) => {
    const [[row]] = await db().query(`
        SELECT
            pd.Id                                               AS PatientId,
            pd.Title,
            pd.Name,
            pd.Age,
            pd.YMD,
            pd.Gender,
            pd.PhoneNumber,
            pd.RegisteredOn,
            t.TestName,
            c.Name                                              AS CategoryName,
            CONCAT(d.FirstName, ' ', d.LastName)               AS DoctorName,
            d.SpecialistIn                                      AS DoctorSpeciality,
            pr.ReportContent                                    AS Report,
            pr.ReportReady,
            pd.Status                                           AS PatientStatus,
            pd.DuesAmount,
            ptr.IsFinalized,
            ptr.FinalizedBy                                     AS finalizedById,
            DATE_FORMAT(ptr.FinalizedAt, '%d %b %Y, %h:%i %p') AS FinalizedAtFormatted,
            CONCAT(u.FirstName, ' ', u.LastName)               AS FinalizedByName,
            u.SignaturePath                                     AS ReportingDoctorSigPath,
            u.Qualification                                     AS ReportingDoctorDegree
        FROM PatientDetails        pd
        JOIN PatientTestRefference ptr ON ptr.PatientId = pd.Id
                                      AND ptr.TestId    = ?
        JOIN MainTestTable         t   ON t.Id          = ptr.TestId
        LEFT JOIN Category         c   ON c.Id          = t.CategoryId
        LEFT JOIN DoctorDetails    d   ON d.Id          = pd.DoctorId
        LEFT JOIN Users            u   ON u.Id          = ptr.FinalizedBy
        LEFT JOIN PatientReports   pr  ON pr.PatientId  = pd.Id
                                      AND pr.TestId     = t.Id
        WHERE pd.Id = ?
        LIMIT 1
    `, [testId, patientId]);

    return row || null;
};

/** All active templates for the Templates page (getAllTemplates() needs a doctor/test/gender → always failed there). */
const getTemplateList = async () => {
    const [rows] = await db().query(`
        SELECT rt.Id, rt.Name, rt.GenderType, rt.TemplateType, rt.DoctorId, rt.TestId, rt.FilePath, rt.OriginalName,
               m.TestName, CONCAT(d.FirstName, ' ', d.LastName) AS DoctorName
        FROM ReportTemplates rt
        LEFT JOIN MainTestTable m ON m.Id = rt.TestId
        LEFT JOIN DoctorDetails d ON d.Id = rt.DoctorId
        WHERE rt.IsActive = 1
        ORDER BY m.TestName, rt.TemplateType, rt.GenderType`);
    return rows;
};

/** ReportHistory rows for one report (newest first) — for an audit view. */
const getReportHistory = async (patientId, testId) => {
    try {
        const [rows] = await db().query(`
            SELECT h.Id, h.Action, h.Reason, DATE_FORMAT(h.ChangedAt, '%d %b %Y, %h:%i %p') AS ChangedAt,
                   TRIM(CONCAT(COALESCE(u.FirstName,''), ' ', COALESCE(u.LastName,''))) AS ChangedBy, h.Content
            FROM ReportHistory h LEFT JOIN Users u ON u.Id = h.ChangedBy
            WHERE h.PatientId = ? AND h.TestId = ? ORDER BY h.Id DESC`, [patientId, testId]);
        return rows;
    } catch (e) { if (e.code === 'ER_NO_SUCH_TABLE') return []; throw e; }
};

//export all the function
module.exports = {
    // security patch
    loadReportTarget, checkHandOver, isReportingDoctor, userHasAny, writeReportHistory,
    getTemplateList, getReportHistory,
    getDiscountReport:getDiscountReport,
    uploadDocument:uploadDocument,
    getDocumentDetails:getDocumentDetails,
    deleteDocument:deleteDocument,
    getDocumentName:getDocumentName,
    //generateLink:generateLink,
    generateReportLink:generateReportLink,
    createReportLinkToken:createReportLinkToken,
    checkToken:checkToken,
    getdataForPathologyReport:getdataForPathologyReport,
    insertPathologicalData:insertPathologicalData,
    getPatientPathoTestData:getPatientPathoTestData,
    searchDocumentDetails:searchDocumentDetails,
    getCategoryWisePatient:getCategoryWisePatient,
    getTestWiseCollection:getTestWiseCollection,
    getDoctorPatientServiceReportWithMonthlyBreakdown:getDoctorPatientServiceReportWithMonthlyBreakdown,
    getTotalCollection:getTotalCollection,
    getUserWiseCollection:getUserWiseCollection,
    getOnlineSourceBreakdown:getOnlineSourceBreakdown,
    getCancelledPatients:getCancelledPatients,
    getAdvanceBookings:getAdvanceBookings,
    getOutstandingDues:getOutstandingDues,
    getDuesReceived:getDuesReceived,
    getPatientCountPerUser:getPatientCountPerUser,
    getMasterSettlement:getMasterSettlement,
    getBillRegister:getBillRegister,
    getCashBook:getCashBook,
    getAllPendingDues:getAllPendingDues,
    parseSettlementRange:parseRange,
   // getTemplateById:getTemplateById,
    getTemplateById:getTemplateById,
    getTemplatesForTest:getTemplatesForTest,
    saveTemplate:saveTemplate,
    deleteTemplate:deleteTemplate,
    getPatientReportContext:getPatientReportContext,
    savePatientReport:savePatientReport,
    getMonthWiseReport:getMonthWiseReport,
    getPeriodWiseReport:getPeriodWiseReport,
    parseDate:parseDate,
    getReportPageData:getReportPageData,
    resolveTemplate:resolveTemplate,
    getAllTemplates:getAllTemplates,
    saveReport:saveReport,
    markReportReady:markReportReady,
    markReportDraft:markReportDraft,
    finalizeReport:finalizeReport,
    unfinalizeReport:unfinalizeReport,
    markReportGenerated:markReportGenerated,
    getFinalizedReport:getFinalizedReport,
    isReportFinalized:isReportFinalized,
    saveDoctorTestTemplate:saveDoctorTestTemplate,
    saveDoctorDefaultTemplate:saveDoctorDefaultTemplate,
    saveTestDefaultTemplate:saveTestDefaultTemplate,
    getTemplatesForReport:getTemplatesForReport,
    getAllReportingDoctors:getAllReportingDoctors
   
  };
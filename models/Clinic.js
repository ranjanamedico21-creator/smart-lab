'use strict';

/**
 * models/Clinic.js — SmartLab clinic model
 *
 * Fixes in this version:
 *  - checkClinicExist: `throw errror` (typo) → ReferenceError hid every DB error.
 *  - detachDoctorFromClinic used pool.getConnection() WITHOUT .promise()
 *    → `await` got undefined → detaching a doctor ALWAYS failed.
 *  - attach/detach returned { message } objects → UI showed "[object Object]".
 *  - Update did not check duplicate Email/Phone against OTHER clinics.
 *  - History insert + update were not in one transaction (half-saved edits).
 *  - Attaching an already-attached doctor created duplicate rows / crashed.
 *  - Everything uses the pool (the single shared `connection` blocks under load
 *    and dies permanently if MySQL restarts).
 *  - Header image file name no longer built from the clinic name
 *    (path traversal: a clinic named "../../app" could overwrite server files).
 *
 * SECURITY PATCH (2026-10-25):
 *  - Create/update: the duplicate email/phone check was not locked → two quick saves created the
 *    same clinic twice. Saves are now serialised with a MySQL named lock.
 *  - attachDoctors accepted any doctor id (deleted / made-up ids became orphan links that made the
 *    patient form offer doctors that don't exist). Ids are checked; attaches per clinic are serialised.
 *  - Header image: max 2 MB (a huge upload filled the hosting disk).
 */

const fs           = require('fs');
const fsp          = require('fs/promises');
const path         = require('path');
const dbConnection = require('../config/DBConnection');

const db      = () => dbConnection.pool.promise();
const getConn = () => dbConnection.pool.promise().getConnection();

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const userError = (messages) => {
    const list = Array.isArray(messages) ? messages : [messages];
    const err  = new Error(list.join('; '));
    err.isUserError  = true;
    err.userMessages = list;
    return err;
};

const str     = (v) => (v === undefined || v === null) ? '' : String(v).trim();
const toId    = (v) => { const n = parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : null; };
const today   = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };   // local date (toISOString is UTC → wrong before 5:30 AM IST)

/** Keep last 10 digits of an Indian mobile/landline ("+91 98765-43210" → "9876543210"). */
const normalizePhone = (v) => {
    let d = str(v).replace(/\D/g, '');
    if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
    if (d.length === 11 && d.startsWith('0'))  d = d.slice(1);
    return d;
};

/** Trim + normalise the posted form into DB-shaped data. */
const normalizeClinic = (b = {}) => ({
    Name:              str(b.ClinicName).replace(/\s+/g, ' '),
    Email:             str(b.Email).toLowerCase(),
    PhoneNumber:       normalizePhone(b.PhoneNumber),
    SecondaryNumber:   normalizePhone(b.SecondaryNumber) || null,
    Address:           str(b.Address),
    AdditionalAddress: str(b.AdditionalAddress) || null,
    KeyArea:           str(b.KeyArea),
    Pincode:           str(b.Pincode).replace(/\s/g, ''),
    City:              str(b.City),
    State:             str(b.State),
    LandMark:          str(b.LandMark),
    AssignedTo:        toId(b.AssignedId),
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[1-9]\d{9}$/;                  // 10 digits after removing +91 / leading 0
const PIN_RE   = /^[1-9]\d{5}$/;
const NAME_RE  = /^[\p{L}\s.'-]+$/u;              // city / state: letters only

const validateClinic = (c, validUserIds = null) => {
    const e = [];
    const max = (v, n, label) => { if (v && v.length > n) e.push(`${label} is too long (max ${n} characters).`); };

    if (!c.Name)                       e.push('Clinic name is required.');
    max(c.Name, 150, 'Clinic name');

    if (!c.Email)                      e.push('Email is required.');
    else if (!EMAIL_RE.test(c.Email))  e.push('Enter a valid email address (e.g. clinic@example.com).');
    max(c.Email, 150, 'Email');

    if (!c.PhoneNumber)                e.push('Phone number is required.');
    else if (!PHONE_RE.test(c.PhoneNumber)) e.push('Phone number must be 10 digits (e.g. 9876543210).');

    if (c.SecondaryNumber) {
        if (!PHONE_RE.test(c.SecondaryNumber))  e.push('Secondary number must be 10 digits.');
        else if (c.SecondaryNumber === c.PhoneNumber) e.push('Secondary number cannot be the same as the phone number.');
    }

    if (!c.Address)                    e.push('Address line 1 is required.');
    max(c.Address, 255, 'Address line 1');
    max(c.AdditionalAddress, 255, 'Address line 2');

    if (!c.City)                       e.push('City is required.');
    else if (!NAME_RE.test(c.City))    e.push('City should contain letters only.');
    max(c.City, 100, 'City');

    if (!c.State)                      e.push('State is required.');
    else if (!NAME_RE.test(c.State))   e.push('State should contain letters only.');
    max(c.State, 100, 'State');

    if (!c.Pincode)                    e.push('Pincode is required.');
    else if (!PIN_RE.test(c.Pincode))  e.push('Pincode must be 6 digits and cannot start with 0.');

    if (!c.LandMark)                   e.push('Landmark is required.');
    max(c.LandMark, 150, 'Landmark');

    if (!c.KeyArea)                    e.push('Key area is required.');
    max(c.KeyArea, 150, 'Key area');

    if (!c.AssignedTo)                 e.push('Select the marketing person for this clinic.');
    else if (validUserIds && !validUserIds.has(c.AssignedTo))
                                       e.push('The selected marketing person no longer exists. Please select again.');
    return e;
};

/** Friendly duplicate check — tells the user WHICH clinic already uses the email/phone. */
const assertNoDuplicate = async (conn, c, excludeId = 0) => {
    const phones = [c.PhoneNumber, c.SecondaryNumber].filter(Boolean);
    const [rows] = await conn.query(
        `SELECT Id, Name, Email, PhoneNumber, SecondaryNumber FROM Clinics
         WHERE Id <> ? AND (LOWER(Email) = ? OR PhoneNumber IN (?) OR SecondaryNumber IN (?))
         LIMIT 5`,
        [excludeId, c.Email, phones, phones]
    );
    if (!rows.length) return;

    const msgs = [];
    rows.forEach(r => {
        if ((r.Email || '').toLowerCase() === c.Email) msgs.push(`Email "${c.Email}" is already used by clinic "${r.Name}".`);
        phones.forEach(p => {
            if (normalizePhone(r.PhoneNumber) === p || normalizePhone(r.SecondaryNumber) === p)
                msgs.push(`Phone ${p} is already used by clinic "${r.Name}".`);
        });
    });
    throw userError(msgs.length ? [...new Set(msgs)] : 'Another clinic already uses this email or phone number.');
};

/** One clinic save at a time — makes the duplicate check above reliable. */
const SAVE_LOCK = 'smartlab_clinic_save';
const withSaveLock = async (conn, fn) => {
    const [[r]] = await conn.query('SELECT GET_LOCK(?, 8) AS ok', [SAVE_LOCK]);
    if (!r || Number(r.ok) !== 1) throw userError('Another clinic is being saved right now. Please try again in a few seconds.');
    try { return await fn(); }
    finally { await conn.query('SELECT RELEASE_LOCK(?)', [SAVE_LOCK]).catch(() => {}); }
};

// ─────────────────────────────────────────────────────────────────────────────
// QUERIES
// ─────────────────────────────────────────────────────────────────────────────

const getClinicList = async () => {
    const [rows] = await db().query(`
        SELECT c.*,
               (SELECT COUNT(*) FROM ClinicAndDoctorAssociation a WHERE a.ClinicId = c.Id) AS DoctorCount
        FROM Clinics c
        ORDER BY c.Id DESC
    `);
    return rows || [];
};

const findClinicById = async (clinicId) => {
    const id = toId(clinicId);
    if (!id) return null;
    const [rows] = await db().query('SELECT * FROM Clinics WHERE Id = ? LIMIT 1', [id]);
    return rows[0] || null;
};

/** Kept for old callers. */
const checkClinicExist = async (Email, PhoneNumber) => {
    const [rows] = await db().query(
        'SELECT Id FROM Clinics WHERE LOWER(Email) = LOWER(?) OR PhoneNumber = ? LIMIT 1',
        [str(Email), normalizePhone(PhoneNumber)]
    );
    return rows.length > 0;
};

// ─────────────────────────────────────────────────────────────────────────────
// CREATE / UPDATE
// ─────────────────────────────────────────────────────────────────────────────

const createClinic = async (body, userId, validUserIds) => {
    const c = normalizeClinic(body);
    const errors = validateClinic(c, validUserIds);
    if (errors.length) throw userError(errors);

    const conn = await getConn();
    try {
        return await withSaveLock(conn, async () => {
            await conn.beginTransaction();
            await assertNoDuplicate(conn, c);

            const [result] = await conn.query('INSERT INTO Clinics SET ?', [{
                ...c, CreatedOn: today(), CreatedBy: userId,
            }]);

            await conn.commit();
            return { clinicId: result.insertId, name: c.Name };
        });
    } catch (err) {
        await conn.rollback().catch(() => {});
        throw err;
    } finally {
        conn.release();
    }
};

const updateClinic = async (clinicId, body, userId, validUserIds) => {
    const id = toId(clinicId);
    if (!id) throw userError('Invalid clinic ID.');

    const c = normalizeClinic(body);
    const errors = validateClinic(c, validUserIds);
    if (errors.length) throw userError(errors);

    const conn = await getConn();
    try {
      return await withSaveLock(conn, async () => {
        await conn.beginTransaction();

        const [found] = await conn.query('SELECT * FROM Clinics WHERE Id = ? FOR UPDATE', [id]);
        const old = found[0];
        if (!old) throw userError('This clinic no longer exists.');

        await assertNoDuplicate(conn, c, id);

        // Snapshot the old values (same columns your ClinicHistory table already uses)
        await conn.execute(
            `INSERT INTO ClinicHistory
               (Id, Name, Email, PhoneNumber, SecondaryNumber, Address, AdditionalAddress,
                KeyArea, Pincode, City, State, LandMark, UpdatedOn, UpdatedBy)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [old.Id, old.Name, old.Email, old.PhoneNumber, old.SecondaryNumber, old.Address,
             old.AdditionalAddress, old.KeyArea, old.Pincode, old.City, old.State, old.LandMark,
             today(), userId]
        );

        await conn.query('UPDATE Clinics SET ? WHERE Id = ?', [c, id]);

        await conn.commit();
        return { clinicId: id, name: c.Name, marketingChanged: Number(old.AssignedTo) !== Number(c.AssignedTo) };
      });
    } catch (err) {
        await conn.rollback().catch(() => {});
        throw err;
    } finally {
        conn.release();
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// DOCTOR ↔ CLINIC
// ─────────────────────────────────────────────────────────────────────────────

const attachDoctors = async (clinicId, doctorIds, userId) => {
    const id = toId(clinicId);
    if (!id) throw userError('Invalid clinic ID.');

    const ids = [...new Set((Array.isArray(doctorIds) ? doctorIds : [doctorIds]).map(toId).filter(Boolean))];
    if (!ids.length) throw userError('Select at least one doctor to attach.');

    const conn = await getConn();
    try {
        await conn.beginTransaction();

        // FOR UPDATE: two people attaching to the same clinic at once wait for each other (no duplicate rows)
        const [clinic] = await conn.query('SELECT Id FROM Clinics WHERE Id = ? LIMIT 1 FOR UPDATE', [id]);
        if (!clinic.length) throw userError('This clinic no longer exists.');

        // only doctors that really exist
        const [real] = await conn.query('SELECT Id FROM DoctorDetails WHERE Id IN (?)', [ids]);
        const realIds = new Set(real.map(r => Number(r.Id)));
        const unknown = ids.filter(d => !realIds.has(d));
        if (unknown.length === ids.length) throw userError('The selected doctor(s) no longer exist. Refresh the page.');

        const [already] = await conn.query(
            'SELECT DoctorId FROM ClinicAndDoctorAssociation WHERE ClinicId = ? AND DoctorId IN (?)',
            [id, ids]
        );
        const skip  = new Set(already.map(r => Number(r.DoctorId)));
        const toAdd = ids.filter(d => realIds.has(d) && !skip.has(d));

        if (toAdd.length) {
            await conn.query(
                'INSERT INTO ClinicAndDoctorAssociation (ClinicId, DoctorId, AssociatedOn, AssociatedBy) VALUES ?',
                [toAdd.map(d => [id, d, today(), userId])]
            );
        }
        await conn.commit();

        if (!toAdd.length) return { type: 'warning', message: 'The selected doctor(s) were already attached to this clinic.' };
        return {
            type: 'success',
            message: `${toAdd.length} doctor${toAdd.length > 1 ? 's' : ''} attached successfully.` +
                     (skip.size ? ` ${skip.size} already attached (skipped).` : '') +
                     (unknown.length ? ` ${unknown.length} no longer exist (skipped).` : ''),
        };
    } catch (err) {
        await conn.rollback().catch(() => {});
        throw err;
    } finally {
        conn.release();
    }
};

const detachDoctor = async (clinicId, doctorId, userId) => {
    const cid = toId(clinicId), did = toId(doctorId);
    if (!cid || !did) throw userError('Invalid clinic or doctor.');

    const conn = await getConn();     // FIX: promise connection (was callback API → always failed)
    try {
        await conn.beginTransaction();

        const [del] = await conn.execute(
            'DELETE FROM ClinicAndDoctorAssociation WHERE ClinicId = ? AND DoctorId = ?',
            [cid, did]
        );
        if (!del.affectedRows) throw userError('This doctor is not attached to the clinic (maybe already removed).');

        await conn.execute(
            `INSERT INTO ClinicAndDoctorHistoryDissasociation (ClinicId, DoctorId, DisassociatedOn, DisassociatedBy)
             VALUES (?, ?, ?, ?)`,
            [cid, did, today(), userId]
        );

        await conn.commit();
        return 'Doctor removed from this clinic.';
    } catch (err) {
        await conn.rollback().catch(() => {});
        throw err;
    } finally {
        conn.release();
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// PRESCRIPTION HEADER IMAGE
// Saved as  prescriptions/clinic_<Id>.jpg|png  (never from user-typed names)
// ─────────────────────────────────────────────────────────────────────────────

const HEADER_DIR = path.join(process.cwd(), 'prescriptions');
const HEADER_EXT = ['.jpg', '.png'];

const insideHeaderDir = (p) => {
    const rel = path.relative(HEADER_DIR, p);
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
};

/** Detect real file type from bytes (don't trust the browser's mimetype). */
const sniffImage = (buf) => {
    if (!buf || buf.length < 8) return null;
    if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return '.jpg';
    if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return '.png';
    return null;
};

/**
 * Returns the absolute path of a clinic's header image or null.
 * Also finds files saved by the OLD code ("<ClinicName>_<Id>.jpg").
 * ► Use this in your report/print code instead of building the name yourself.
 */
const findHeaderFile = (clinic) => {
    if (!clinic || !clinic.Id) return null;
    const candidates = HEADER_EXT.map(ext => path.join(HEADER_DIR, `clinic_${clinic.Id}${ext}`));
    if (clinic.Name) HEADER_EXT.forEach(ext => candidates.push(path.join(HEADER_DIR, `${clinic.Name}_${clinic.Id}${ext}`)));
    return candidates.find(p => insideHeaderDir(p) && fs.existsSync(p)) || null;
};

const HEADER_MAX_BYTES = 2 * 1024 * 1024;

const saveHeader = async (clinic, buffer) => {
    if (!clinic || !toId(clinic.Id)) throw userError('Clinic not found.');
    if (!buffer || !buffer.length) throw userError('Choose an image file.');
    if (buffer.length > HEADER_MAX_BYTES) throw userError('The header image is larger than 2 MB. Save it smaller (e.g. 1600 px wide JPEG) and upload again.');
    const ext = sniffImage(buffer);
    if (!ext) throw userError('The prescription header must be a JPEG or PNG image.');

    await fsp.mkdir(HEADER_DIR, { recursive: true });
    const finalPath = path.join(HEADER_DIR, `clinic_${clinic.Id}${ext}`);
    const tmpPath   = finalPath + '.' + process.pid + '.tmp';

    await fsp.writeFile(tmpPath, buffer);
    await fsp.rename(tmpPath, finalPath);                 // atomic replace — never a half-written image

    // Remove other copies (other extension / legacy name-based files)
    const stale = HEADER_EXT.filter(e => e !== ext).map(e => path.join(HEADER_DIR, `clinic_${clinic.Id}${e}`));
    if (clinic.Name) HEADER_EXT.forEach(e => stale.push(path.join(HEADER_DIR, `${clinic.Name}_${clinic.Id}${e}`)));
    await Promise.all(stale.filter(insideHeaderDir).map(p => fsp.unlink(p).catch(() => {})));

    return finalPath;
};

const deleteHeader = async (clinic) => {
    const stale = HEADER_EXT.map(e => path.join(HEADER_DIR, `clinic_${clinic.Id}${e}`));
    if (clinic.Name) HEADER_EXT.forEach(e => stale.push(path.join(HEADER_DIR, `${clinic.Name}_${clinic.Id}${e}`)));
    await Promise.all(stale.filter(insideHeaderDir).map(p => fsp.unlink(p).catch(() => {})));
};

module.exports = {
    userError,
    normalizeClinic,
    validateClinic,
    getClinicList,
    findClinicById,
    checkClinicExist,
    createClinic,
    updateClinic,
    attachDoctors,
    detachDoctor,
    findHeaderFile,
    saveHeader,
    deleteHeader,
};
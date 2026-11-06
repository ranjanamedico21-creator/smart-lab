// models/ReportTemplate.js
// ─────────────────────────────────────────────────────────────────────────────
// All DB queries for report template management.
// ─────────────────────────────────────────────────────────────────────────────
const dbConnection = require("../config/DBConnection");
const mysql = require('mysql2'); 
const moment= require('moment');
// models/templateModel.js
//const db = require("../config/db");

// ═══════════════════════════════════════════════════════════
// TEMPLATE CRUD
// ═══════════════════════════════════════════════════════════

const getAllByDoctor = async (doctorId) => {
    const [rows] = await dbConnection.connection.promise().execute(`
        SELECT rt.*, m.TestName
        FROM ReportTemplates rt
        JOIN MainTestTable m ON m.Id = rt.TestId
        WHERE rt.DoctorId = ? AND rt.IsActive = 1
        ORDER BY m.TestName, rt.GenderType
    `, [doctorId]);
    return rows;
};

const getById = async (templateId, doctorId) => {
    const [rows] = await dbConnection.connection.promise().execute(
        `SELECT * FROM ReportTemplates
         WHERE Id = ? AND DoctorId = ? LIMIT 1`,
        [templateId, doctorId]
    );
    return rows[0] || null;
};

const getByIdAdmin = async (templateId) => {
    const [rows] = await dbConnection.connection.promise().execute(
        `SELECT * FROM ReportTemplates WHERE Id = ? LIMIT 1`,
        [templateId]
    );
    return rows[0] || null;
};

const create = async (data) => {
    const { name, doctorId, testId, genderType, content, createdBy } = data;
    
    const [result] = await dbConnection.connection.promise().execute(
        `INSERT INTO ReportTemplates
            (Name, DoctorId, TestId, GenderType, Content, CreatedBy)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            Content=VALUES(Content), Name=VALUES(Name), UpdatedAt=NOW()`,
        [name, doctorId, testId, genderType, content, createdBy]
    );
    return { success: true, id: result.insertId };
};

const update = async (templateId, data) => {
    const { name, testId, genderType, content } = data;
    
    await dbConnection.connection.promise().execute(
        `UPDATE ReportTemplates
         SET Name=?, TestId=?, GenderType=?, Content=?, UpdatedAt=NOW()
         WHERE Id=?`,
        [name, testId, genderType, content, templateId]
    );
    return { success: true };
};

const updateContent = async (templateId, name, content) => {
    await dbConnection.connection.promise().execute(
        `UPDATE ReportTemplates
         SET Name=?, Content=?, UpdatedAt=NOW()
         WHERE Id=?`,
        [name, content, templateId]
    );
    return { success: true };
};

const softDelete = async (templateId, doctorId) => {
    await dbConnection.connection.promise().execute(
        `UPDATE ReportTemplates SET IsActive=0
         WHERE Id=? AND DoctorId=?`,
        [templateId, doctorId]
    );
    return { success: true };
};

const checkExisting = async (doctorId, testId, genderType) => {
    const [rows] = await dbConnection.connection.promise().execute(
        `SELECT Id FROM ReportTemplates
         WHERE DoctorId=? AND TestId=? AND GenderType=? AND IsActive=1 LIMIT 1`,
        [doctorId, testId, genderType]
    );
    return rows[0] || null;
};
/**
 * 
 * @returns 
 * 
 * only reporting doctyor for template generation
 * all reporting doctor are users of the system hence they exist in user table
 */
const getAllDoctors = async () => {
    const [rows] = await dbConnection.connection.promise().execute(`
                        SELECT 
                    u.Id AS UserId,
                    u.FirstName,
                    u.LastName
                FROM Users u
                WHERE u.RoleId = 2
                ORDER BY u.FirstName, u.LastName;
    `);
    return rows;
};

module.exports = {
    getAllByDoctor,
    getById,
    getByIdAdmin,
    create,
    update,
    updateContent,
    softDelete,
    checkExisting,
    getAllDoctors,
};
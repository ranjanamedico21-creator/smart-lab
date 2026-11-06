const dbConnection = require("../config/DBConnection");

/**
 * Pathology Repository (Model)
 * All database queries only. Zero business logic.
 * PascalCase columns matching DB convention.
 */

const getConnection = async () => dbConnection.connection.promise().getConnection();
const release = (conn) => { if (conn) conn.release(); };

// ==================== SPECIMEN TYPE MASTER ====================

let findAllSpecimenTypes = async (activeOnly = true) => {
  let sql = "SELECT * FROM Patho_SpecimenType WHERE DeletedAt IS NULL";
  if (activeOnly) sql += " AND Status = 'active'";
  sql += " ORDER BY DisplayOrder, TypeName";
  const [rows] = await dbConnection.connection.promise().query(sql);
  return rows;
};

let findSpecimenTypeById = async (id) => {
  const [rows] = await dbConnection.connection.promise().query(
    "SELECT * FROM Patho_SpecimenType WHERE Id = ? AND DeletedAt IS NULL",
    [id]
  );
  return rows[0] || null;
};

let createSpecimenType = async (data) => {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      "INSERT INTO Patho_SpecimenType (TypeCode, TypeName, Description, ColorCode, DisplayOrder, Status) VALUES (?, ?, ?, ?, ?, ?)",
      [
        data.TypeCode,
        data.TypeName,
        data.Description,
        data.ColorCode || "#cbd5e1",
        data.DisplayOrder || 0,
        data.Status || "active"
      ]
    );
    await conn.commit();
    return result.insertId;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    release(conn);
  }
};

// ==================== CONTAINER TYPE MASTER ====================

let findAllContainerTypes = async (specimenTypeId = null, activeOnly = true) => {
  let sql = `SELECT c.*, s.TypeName AS SpecimenTypeName FROM Patho_ContainerType c
             JOIN Patho_SpecimenType s ON c.SpecimenTypeId = s.Id
             WHERE c.DeletedAt IS NULL`;
  const params = [];
  if (activeOnly) sql += " AND c.Status = 'active'";
  if (specimenTypeId) {
    sql += " AND c.SpecimenTypeId = ?";
    params.push(specimenTypeId);
  }
  sql += " ORDER BY c.DisplayOrder, c.ContainerName";
  const [rows] = await dbConnection.connection.promise().query(sql, params);
  return rows;
};

let findContainerTypeById = async (id) => {
  const [rows] = await dbConnection.connection.promise().query(
    "SELECT * FROM Patho_ContainerType WHERE Id = ? AND DeletedAt IS NULL",
    [id]
  );
  return rows[0] || null;
};

let createContainerType = async (data) => {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      "INSERT INTO Patho_ContainerType (ContainerCode, ContainerName, SpecimenTypeId, ColorCode, CapColor, Description, DisplayOrder, Status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        data.ContainerCode,
        data.ContainerName,
        data.SpecimenTypeId,
        data.ColorCode || "#94a3b8",
        data.CapColor,
        data.Description,
        data.DisplayOrder || 0,
        data.Status || "active"
      ]
    );
    await conn.commit();
    return result.insertId;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    release(conn);
  }
};

// ==================== TEST SPECIMEN REQUIREMENT ====================

let findTestSpecimenRequirement = async (mainTestId, activeOnly = true) => {
  let sql = `SELECT r.*, s.TypeName AS SpecimenTypeName, s.TypeCode AS SpecimenTypeCode,
                    c.ContainerName, c.ContainerCode, c.CapColor, c.ColorCode AS ContainerColorCode
             FROM Patho_TestSpecimenRequirement r
             JOIN Patho_SpecimenType s ON r.SpecimenTypeId = s.Id
             JOIN Patho_ContainerType c ON r.ContainerTypeId = c.Id
             WHERE r.MainTestId = ? AND r.DeletedAt IS NULL`;
  const params = [mainTestId];
  if (activeOnly) sql += " AND r.Status = 'active'";
  sql += " ORDER BY r.IsDefault DESC, r.Id LIMIT 1";
  const [rows] = await dbConnection.connection.promise().query(sql, params);
  return rows[0] || null;
};

let findAllTestSpecimenRequirements = async (filters = {}) => {
  let sql = `SELECT r.*, s.TypeName, c.ContainerName, mt.TestName, d.DepartmentName
             FROM Patho_TestSpecimenRequirement r
             JOIN Patho_SpecimenType s ON r.SpecimenTypeId = s.Id
             JOIN Patho_ContainerType c ON r.ContainerTypeId = c.Id
             JOIN MainTestTable mt ON r.MainTestId = mt.Id
             LEFT JOIN Patho_Department d ON r.DepartmentId = d.Id
             WHERE r.DeletedAt IS NULL`;
  const params = [];
  if (filters.mainTestId) {
    sql += " AND r.MainTestId = ?";
    params.push(filters.mainTestId);
  }
  if (filters.activeOnly !== false) sql += " AND r.Status = 'active'";
  sql += " ORDER BY mt.TestName, r.DisplayOrder";
  const [rows] = await dbConnection.connection.promise().query(sql, params);
  return rows;
};

let createTestSpecimenRequirement = async (data) => {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO Patho_TestSpecimenRequirement 
       (MainTestId, SpecimenTypeId, ContainerTypeId, MinVolume, MaxVolume, Inversions, CollectionInstructions, IsDefault, DepartmentId, Status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.MainTestId,
        data.SpecimenTypeId,
        data.ContainerTypeId,
        data.MinVolume,
        data.MaxVolume,
        data.Inversions || 0,
        data.CollectionInstructions,
        data.IsDefault !== false,
        data.DepartmentId,
        data.Status || "active"
      ]
    );
    await conn.commit();
    return result.insertId;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    release(conn);
  }
};

// ==================== DEPARTMENTS ====================

let findAllDepartments = async (activeOnly = true) => {
  let sql = "SELECT * FROM Patho_Department WHERE DeletedAt IS NULL";
  if (activeOnly) sql += " AND Status = 'active'";
  sql += " ORDER BY DisplayOrder, DepartmentName";
  const [rows] = await dbConnection.connection.promise().query(sql);
  return rows;
};

let findDepartmentById = async (id) => {
  const [rows] = await dbConnection.connection.promise().query(
    "SELECT * FROM Patho_Department WHERE Id = ? AND DeletedAt IS NULL",
    [id]
  );
  return rows[0] || null;
};

let findDepartmentByCode = async (code) => {
  const [rows] = await dbConnection.connection.promise().query(
    "SELECT * FROM Patho_Department WHERE DepartmentCode = ? AND DeletedAt IS NULL",
    [code]
  );
  return rows[0] || null;
};

let createDepartment = async (data) => {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      "INSERT INTO Patho_Department (DepartmentName, DepartmentCode, Description, DisplayOrder, Status) VALUES (?, ?, ?, ?, ?)",
      [data.DepartmentName, data.DepartmentCode, data.Description, data.DisplayOrder || 0, data.Status || "active"]
    );
    await conn.commit();
    return result.insertId;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    release(conn);
  }
};

let softDeleteDepartment = async (id) => {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("UPDATE Patho_Department SET DeletedAt = NOW(), Status = 'inactive' WHERE Id = ?", [id]);
    await conn.commit();
    return true;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    release(conn);
  }
};

// ==================== PARAMETERS ====================

let findAllParameters = async (filters = {}) => {
  let sql = "SELECT * FROM Patho_Parameter WHERE DeletedAt IS NULL";
  const params = [];
  if (filters.search) {
    sql += " AND (ParameterName LIKE ? OR ShortName LIKE ?)";
    params.push(`%${filters.search}%`, `%${filters.search}%`);
  }
  if (filters.resultType) {
    sql += " AND ResultType = ?";
    params.push(filters.resultType);
  }
  if (filters.activeOnly !== false) sql += " AND ActiveStatus = 'active'";
  sql += " ORDER BY ParameterName";
  const [rows] = await dbConnection.connection.promise().query(sql, params);
  return rows;
};

let findParameterById = async (id) => {
  const [rows] = await dbConnection.connection.promise().query(
    "SELECT * FROM Patho_Parameter WHERE Id = ? AND DeletedAt IS NULL",
    [id]
  );
  return rows[0] || null;
};

let findParametersByIds = async (ids) => {
  if (!ids || !ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  const [rows] = await dbConnection.connection.promise().query(
    `SELECT * FROM Patho_Parameter WHERE Id IN (${placeholders}) AND DeletedAt IS NULL`,
    ids
  );
  return rows;
};

let createParameter = async (data) => {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO Patho_Parameter (ParameterName, ShortName, Unit, Method, LoincCode, DecimalPrecision,
        IsCalculated, CalculationFormula, FormulaDependencies, ResultType, SelectOptions, DefaultValue, ActiveStatus)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.ParameterName,
        data.ShortName,
        data.Unit,
        data.Method,
        data.LoincCode,
        data.DecimalPrecision || 2,
        data.IsCalculated || 0,
        data.CalculationFormula,
        data.FormulaDependencies ? JSON.stringify(data.FormulaDependencies) : null,
        data.ResultType || "numeric",
        data.SelectOptions ? JSON.stringify(data.SelectOptions) : null,
        data.DefaultValue,
        data.ActiveStatus || "active"
      ]
    );
    await conn.commit();
    return result.insertId;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    release(conn);
  }
};

let softDeleteParameter = async (id) => {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("UPDATE Patho_Parameter SET DeletedAt = NOW(), ActiveStatus = 'inactive' WHERE Id = ?", [id]);
    await conn.commit();
    return true;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    release(conn);
  }
};

// ==================== TEST PROFILE ====================

let findTestProfile = async (mainTestId) => {
  const [rows] = await dbConnection.connection.promise().query(
    `SELECT tp.*, d.DepartmentName FROM Patho_TestProfile tp
     JOIN Patho_Department d ON tp.DepartmentId = d.Id
     WHERE tp.MainTestId = ? AND tp.ActiveStatus = 'active'`,
    [mainTestId]
  );
  return rows[0] || null;
};

let createTestProfile = async (data) => {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO Patho_TestProfile (MainTestId, DepartmentId, SpecimenType, IsPathology, ReportTemplateId, TatHours, ActiveStatus)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE DepartmentId = VALUES(DepartmentId), SpecimenType = VALUES(SpecimenType),
       IsPathology = VALUES(IsPathology), ReportTemplateId = VALUES(ReportTemplateId), TatHours = VALUES(TatHours), ActiveStatus = VALUES(ActiveStatus)`,
      [
        data.MainTestId,
        data.DepartmentId,
        data.SpecimenType,
        data.IsPathology !== false,
        data.ReportTemplateId || null,
        data.TatHours || 24.0,
        data.ActiveStatus || "active"
      ]
    );
    await conn.commit();
    return result.insertId || result.affectedRows;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    release(conn);
  }
};

let findAllTestProfiles = async () => {
  const [rows] = await dbConnection.connection.promise().query(
    `SELECT tp.*, d.DepartmentName, d.DepartmentCode, mt.TestName 
     FROM Patho_TestProfile tp
     JOIN Patho_Department d ON tp.DepartmentId = d.Id
     JOIN MainTestTable mt ON tp.MainTestId = mt.Id
     WHERE tp.ActiveStatus = 'active' AND d.DeletedAt IS NULL
     ORDER BY mt.TestName`
  );
  return rows;
};

let findTestsWithoutProfile = async () => {
  const [rows] = await dbConnection.connection.promise().query(
    `SELECT mt.Id, mt.TestName 
     FROM MainTestTable mt
     LEFT JOIN Patho_TestProfile tp ON mt.Id = tp.MainTestId AND tp.ActiveStatus = 'active'
     WHERE mt.Status = 1 AND mt.CategoryId = 2 AND tp.Id IS NULL
     ORDER BY mt.TestName`
  );
  return rows;
};

// ==================== TEST PARAMETER MAPPING ====================

let findTestParameters = async (testId, departmentId = null) => {
  let sql = `SELECT m.*, p.ParameterName, p.ShortName, p.Unit, p.Method, p.ResultType, p.IsCalculated, p.DecimalPrecision, p.SelectOptions
    FROM Patho_TestParameterMapping m JOIN Patho_Parameter p ON m.ParameterId = p.Id
    WHERE m.DeletedAt IS NULL AND p.DeletedAt IS NULL AND p.ActiveStatus = 'active'`;
  const params = [];
  if (testId) {
    sql += " AND m.TestId = ?";
    params.push(testId);
  }
  if (departmentId) {
    sql += " AND (m.DepartmentId = ? OR m.DepartmentId IS NULL)";
    params.push(departmentId);
  }
  sql += " ORDER BY m.DisplayOrder, p.ParameterName";
  const [rows] = await dbConnection.connection.promise().query(sql, params);
  return rows;
};

let findDepartmentByTestId = async (testId) => {
  const [rows] = await dbConnection.connection.promise().query(
    `SELECT DISTINCT DepartmentId FROM Patho_TestParameterMapping WHERE TestId = ? AND DeletedAt IS NULL LIMIT 1`,
    [testId]
  );
  return rows[0] || null;
};

/**
 * Last-resort department resolver used by DepartmentResolverService when a test
 * has neither an active Patho_TestProfile nor a parameter mapping. If the test
 * is in the pathology category (CategoryId = 2) it is still treated as pathology
 * and pointed at a sensible department so a report can still be created; returns
 * null for non-pathology tests.
 *
 * FIX: this function was called by the resolver but was missing from the model,
 * so registering a bill that contained ANY pathology test crashed with
 * "Pathology.findPathologyTestFallback is not a function" and rolled back the
 * whole (multi-category) registration.
 */
let findPathologyTestFallback = async (testId) => {
  const [t] = await dbConnection.connection.promise().query(
    "SELECT CategoryId FROM MainTestTable WHERE Id = ? LIMIT 1",
    [testId]
  );
  if (!t[0] || Number(t[0].CategoryId) !== 2) return null;   // not a pathology test

  // Prefer a department already linked through this test's parameter mapping.
  const [m] = await dbConnection.connection.promise().query(
    `SELECT d.Id AS DepartmentId, d.DepartmentName
       FROM Patho_TestParameterMapping tpm
       JOIN Patho_Department d ON d.Id = tpm.DepartmentId AND d.DeletedAt IS NULL
      WHERE tpm.TestId = ? AND tpm.DeletedAt IS NULL
      LIMIT 1`,
    [testId]
  );
  let dept = m[0];
  if (!dept) {
    const [d] = await dbConnection.connection.promise().query(
      "SELECT Id AS DepartmentId, DepartmentName FROM Patho_Department WHERE Status = 'active' AND DeletedAt IS NULL ORDER BY DisplayOrder, Id LIMIT 1"
    );
    dept = d[0];
  }
  return {
    DepartmentId: dept ? dept.DepartmentId : null,
    DepartmentName: dept ? dept.DepartmentName : null,
    IsPathology: true,
    SpecimenType: null,
    Source: 'fallback'
  };
};

let assignTestParameter = async (testId, parameterId, departmentId, data) => {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO Patho_TestParameterMapping (TestId, ParameterId, DepartmentId, DisplayOrder, IsRequired, IsDefaultSelected, SectionHeader, HelpText)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE DepartmentId = VALUES(DepartmentId), DisplayOrder = VALUES(DisplayOrder),
       IsRequired = VALUES(IsRequired), SectionHeader = VALUES(SectionHeader), HelpText = VALUES(HelpText), DeletedAt = NULL`,
      [
        testId,
        parameterId,
        departmentId,
        data.DisplayOrder || 0,
        data.IsRequired !== false,
        data.IsDefaultSelected !== false,
        data.SectionHeader || null,
        data.HelpText || null
      ]
    );
    await conn.commit();
    return true;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    release(conn);
  }
};

let removeTestParameter = async (testId, parameterId) => {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      "UPDATE Patho_TestParameterMapping SET DeletedAt = NOW() WHERE TestId = ? AND ParameterId = ?",
      [testId, parameterId]
    );
    await conn.commit();
    return true;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    release(conn);
  }
};

let updateTestParameterOrder = async (testId, parameterId, displayOrder) => {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      "UPDATE Patho_TestParameterMapping SET DisplayOrder = ? WHERE TestId = ? AND ParameterId = ?",
      [displayOrder, testId, parameterId]
    );
    await conn.commit();
    return true;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    release(conn);
  }
};

let findAllParametersWithMapping = async (testId, departmentId) => {
  const [rows] = await dbConnection.connection.promise().query(
    `SELECT p.*, CASE WHEN m.Id IS NOT NULL THEN 1 ELSE 0 END AS IsMapped,
      m.DisplayOrder AS MapOrder, m.IsRequired AS MapRequired, m.SectionHeader AS MapSection
    FROM Patho_Parameter p
    LEFT JOIN Patho_TestParameterMapping m ON m.ParameterId = p.Id AND m.TestId = ? AND m.DepartmentId = ? AND m.DeletedAt IS NULL
    WHERE p.DeletedAt IS NULL AND p.ActiveStatus = 'active'
    ORDER BY COALESCE(m.DisplayOrder, 999), p.ParameterName`,
    [testId, departmentId]
  );
  return rows;
};

let findMainTests = async () => {
  const [rows] = await dbConnection.connection.promise().query(
    "SELECT Id, TestName FROM MainTestTable WHERE Status = 1 AND CategoryId = 2 ORDER BY TestName"
  );
  return rows;
};

// ==================== REFERENCE RANGES ====================

let findReferenceRanges = async (filters = {}) => {
  let sql = `SELECT rr.*, p.ParameterName, d.DepartmentName FROM Patho_ReferenceRange rr
    JOIN Patho_Parameter p ON rr.ParameterId = p.Id LEFT JOIN Patho_Department d ON rr.DepartmentId = d.Id
    WHERE rr.DeletedAt IS NULL`;
  const params = [];
  if (filters.departmentId) {
    sql += " AND rr.DepartmentId = ?";
    params.push(filters.departmentId);
  }
  if (filters.parameterId) {
    sql += " AND rr.ParameterId = ?";
    params.push(filters.parameterId);
  }
  if (filters.gender) {
    sql += " AND (rr.Gender = ? OR rr.Gender = 'all')";
    params.push(filters.gender);
  }
  sql += " ORDER BY p.ParameterName, rr.Priority DESC";
  const [rows] = await dbConnection.connection.promise().query(sql, params);
  return rows;
};

let findReferenceRangesByParameterId = async (parameterId) => {
  const [rows] = await dbConnection.connection.promise().query(
    "SELECT * FROM Patho_ReferenceRange WHERE ParameterId = ? AND DeletedAt IS NULL ORDER BY Priority DESC",
    [parameterId]
  );
  return rows;
};

let findReferenceRangesByParameterIds = async (parameterIds) => {
  if (!parameterIds || !parameterIds.length) return [];
  const placeholders = parameterIds.map(() => "?").join(",");
  const [rows] = await dbConnection.connection.promise().query(
    `SELECT * FROM Patho_ReferenceRange WHERE ParameterId IN (${placeholders}) AND ActiveStatus = 'active' AND DeletedAt IS NULL`,
    parameterIds
  );
  return rows;
};

let createReferenceRange = async (data) => {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO Patho_ReferenceRange (ParameterId, DepartmentId, Method, Gender, AgeFrom, AgeTo, AgeUnit,
        MinValue, MaxValue, CriticalLow, CriticalHigh, InterpretationNormal, InterpretationAbnormal, Priority)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.ParameterId,
        data.DepartmentId,
        data.Method,
        data.Gender,
        data.AgeFrom,
        data.AgeTo,
        data.AgeUnit,
        data.MinValue,
        data.MaxValue,
        data.CriticalLow,
        data.CriticalHigh,
        data.InterpretationNormal,
        data.InterpretationAbnormal,
        data.Priority || 0
      ]
    );
    await conn.commit();
    return result.insertId;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    release(conn);
  }
};

let softDeleteReferenceRange = async (id) => {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("UPDATE Patho_ReferenceRange SET DeletedAt = NOW() WHERE Id = ?", [id]);
    await conn.commit();
    return true;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    release(conn);
  }
};

// ==================== SPECIMEN ====================

let findSpecimenById = async (id) => {
  const [rows] = await dbConnection.connection.promise().query(
    "SELECT * FROM Patho_Specimen WHERE Id = ? ORDER BY Id DESC LIMIT 1",
    [id]
  );
  return rows[0] || null;
};

let findSpecimenByPTR = async (patientTestRefferenceId) => {
  const [rows] = await dbConnection.connection.promise().query(
    "SELECT * FROM Patho_Specimen WHERE PatientTestRefferenceId = ? ORDER BY Id DESC LIMIT 1",
    [patientTestRefferenceId]
  );
  return rows[0] || null;
};

let createSpecimen = async (data) => {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO Patho_Specimen 
       (PatientTestRefferenceId, SpecimenTypeId, SpecimenType, ContainerTypeId, ContainerType, Barcode, Status, CollectedAt, ReceivedAt, AcceptedBy, AcceptedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.PatientTestRefferenceId,
        data.SpecimenTypeId,
        data.SpecimenType,
        data.ContainerTypeId,
        data.ContainerType,
        data.Barcode || null,
        data.Status || "collected",
        data.CollectedAt,
        data.ReceivedAt,
        data.AcceptedBy || null,
        data.AcceptedAt || null
      ]
    );
    await conn.commit();
    return result.insertId;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    release(conn);
  }
};

let updateSpecimenStatus = async (specimenId, status, data = {}) => {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    const fields = ["Status = ?"];
    const values = [status];

    const timestampMap = {
      collected: "CollectedAt",
      received: "ReceivedAt",
      accepted: "AcceptedAt",
      rejected: "RejectedAt"
    };
    const userMap = {
      accepted: "AcceptedBy",
      rejected: "RejectedBy"
    };

    if (timestampMap[status]) fields.push(`${timestampMap[status]} = NOW()`);
    if (userMap[status] && data.userId) {
      fields.push(`${userMap[status]} = ?`);
      values.push(data.userId);
    }
    if (data.qualityCheckNotes !== undefined) {
      fields.push("QualityCheckNotes = ?");
      values.push(data.qualityCheckNotes);
    }
    if (data.rejectionReason !== undefined) {
      fields.push("RejectionReason = ?");
      values.push(data.rejectionReason);
    }
    if (data.rejectionReasonCategory !== undefined) {
      fields.push("RejectionReasonCategory = ?");
      values.push(data.rejectionReasonCategory);
    }
    if (data.recollectedFromId !== undefined) {
      fields.push("RecollectedFromId = ?");
      values.push(data.recollectedFromId);
    }
    if (data.barcode !== undefined) {
      fields.push("Barcode = ?");
      values.push(data.barcode);
    }

    values.push(specimenId);
    await conn.query(`UPDATE Patho_Specimen SET ${fields.join(", ")} WHERE Id = ?`, values);
    await conn.commit();
    return true;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    release(conn);
  }
};

// ==================== SPECIMEN AUDIT LOG ====================

let createSpecimenAuditLog = async (data) => {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO Patho_SpecimenAuditLog 
       (SpecimenId, Action, StatusFrom, StatusTo, PerformedBy, PerformedByRole, PerformedAt, IpAddress, UserAgent, Remarks, Location)
       VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?)`,
      [
        data.SpecimenId,
        data.Action,
        data.StatusFrom || null,
        data.StatusTo,
        data.PerformedBy,
        data.PerformedByRole || null,
        data.IpAddress || null,
        data.UserAgent || null,
        data.Remarks || null,
        data.Location || null
      ]
    );
    await conn.commit();
    return result.insertId;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    release(conn);
  }
};

let findSpecimenAuditLog = async (specimenId) => {
  const [rows] = await dbConnection.connection.promise().query(
    `SELECT al.*, CONCAT(u.FirstName,' ',u.LastName) AS PerformedByName 
     FROM Patho_SpecimenAuditLog al
     LEFT JOIN Users u ON al.PerformedBy = u.Id
     WHERE al.SpecimenId = ? ORDER BY al.PerformedAt DESC`,
    [specimenId]
  );
  return rows;
};

// ==================== REPORTS ====================

let findReportById = async (id) => {
  const [rows] = await dbConnection.connection.promise().query(
    `SELECT r.*, d.DepartmentName FROM Patho_Report r
     JOIN Patho_Department d ON r.DepartmentId = d.Id WHERE r.Id = ? AND r.DeletedAt IS NULL`,
    [id]
  );
  return rows[0] || null;
};

let findReportByPatientTestReferenceId = async (patientTestRefferenceId) => {
  const [rows] = await dbConnection.connection.promise().query(
    "SELECT * FROM Patho_Report WHERE PatientTestRefferenceId = ? AND DeletedAt IS NULL AND Status != 'cancelled' ORDER BY Id DESC LIMIT 1",
    [patientTestRefferenceId]
  );
  return rows[0] || null;
};

let findReportWithResults = async (id) => {
  const report = await findReportById(id);
  if (!report) return null;
  const [results] = await dbConnection.connection.promise().query(
    `SELECT rr.*, p.ParameterName, p.ShortName, p.Unit AS ParamUnit, p.ResultType, p.DecimalPrecision, p.IsCalculated
     FROM Patho_ReportResult rr JOIN Patho_Parameter p ON rr.ParameterId = p.Id
     WHERE rr.ReportId = ? AND rr.DeletedAt IS NULL ORDER BY rr.Id`,
    [id]
  );
  return { ...report, results };
};

/**
 * FIX: Removed gender/age normalization from DB layer.
 * Controllers/presenters now own data transformation.
 */
let findReportWithPatient = async (id) => {
  const [rows] = await dbConnection.connection.promise().query(
    `SELECT r.*, d.DepartmentName, pt.Name AS PatientName, pt.Age AS PatientAge, pt.YMD AS PatientAgeUnit,
            pt.Gender AS PatientGender, pt.Id AS PatientId, CONCAT(dd.FirstName,' ',dd.LastName) AS ReferringDoctor
     FROM Patho_Report r
     JOIN Patho_Department d ON r.DepartmentId = d.Id
     JOIN PatientTestRefference ptr ON r.PatientTestRefferenceId = ptr.Id
     JOIN PatientDetails pt ON ptr.PatientId = pt.Id
     JOIN DoctorDetails dd ON dd.Id = pt.DoctorId
     WHERE r.Id = ? AND r.DeletedAt IS NULL`,
    [id]
  );
  return rows[0] || null;
};

/**
 * FIX: Optimized JOINs. Removed unnecessary nested subqueries by selecting TestId
 * via a correlated subquery against Patho_Report + PatientTestRefference.
 */
let findReportResults = async (id) => {
  const [rows] = await dbConnection.connection.promise().query(
    `SELECT 
        rr.*, 
        p.ParameterName, 
        p.ShortName, 
        p.Unit AS ParamUnit, 
        p.ResultType, 
        p.DecimalPrecision, 
        p.IsCalculated, 
        p.SelectOptions,
        m.SectionHeader,
        m.DisplayOrder
     FROM Patho_ReportResult rr
     JOIN Patho_Parameter p ON rr.ParameterId = p.Id
     LEFT JOIN Patho_TestParameterMapping m 
        ON m.ParameterId = p.Id 
        AND m.TestId = (
            SELECT ptr.TestId 
            FROM Patho_Report r
            JOIN PatientTestRefference ptr ON r.PatientTestRefferenceId = ptr.Id
            WHERE r.Id = ?
            LIMIT 1
        )
        AND m.DeletedAt IS NULL
     WHERE rr.ReportId = ? AND rr.DeletedAt IS NULL 
     ORDER BY COALESCE(m.DisplayOrder, 999), p.ParameterName`,
    [id, id]
  );
  return rows;
};

let createReport = async (data) => {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO Patho_Report (PatientTestRefferenceId, SpecimenId, ReportNumber, DepartmentId, Status, ReportType, Urgency,
        Remarks, ClinicalHistory, SpecimenDetails, CreatedBy, CreatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        data.PatientTestRefferenceId,
        data.SpecimenId || null,
        data.ReportNumber,
        data.DepartmentId,
        data.Status || "draft",
        data.ReportType || "routine",
        data.Urgency || "normal",
        data.Remarks,
        data.ClinicalHistory,
        data.SpecimenDetails,
        data.CreatedBy
      ]
    );
    await conn.commit();
    return result.insertId;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    release(conn);
  }
};

let updateReportStatus = async (id, status, userId, extra = {}) => {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    const fields = ["Status = ?"];
    const values = [status];
    const timestampMap = {
      completed: "CompletedAt",
      verified: "VerifiedAt",
      approved: "ApprovedAt",
      rejected: "RejectedAt",
      delivered: "DeliveredAt"
    };
    const userMap = {
      completed: "CompletedBy",
      verified: "VerifiedBy",
      approved: "ApprovedBy",
      rejected: "RejectedBy",
      delivered: "DeliveredBy"
    };
    if (timestampMap[status]) fields.push(`${timestampMap[status]} = NOW()`);
    if (userMap[status]) {
      fields.push(`${userMap[status]} = ?`);
      values.push(userId);
    }
    if (extra.Remarks !== undefined) {
      fields.push("Remarks = ?");
      values.push(extra.Remarks);
    }
    if (extra.Reason !== undefined) {
      fields.push("RejectionReason = ?");
      values.push(extra.Reason);
    }
    if (extra.DeliveryMethod !== undefined) {
      fields.push("DeliveryMethod = ?");
      values.push(extra.DeliveryMethod);
    }
    values.push(id);
    await conn.query(`UPDATE Patho_Report SET ${fields.join(", ")} WHERE Id = ?`, values);
    await conn.commit();
    return true;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    release(conn);
  }
};

let createReportResult = async (data) => {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO Patho_ReportResult (ReportId, ParameterId, ResultValue, NumericValue, TextValue, Unit, Method,
        Flag, FlagSymbol, ReferenceRangeUsed, ReferenceRangeId, Interpretation, Comment, IsCalculated, CalculatedFrom)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
       ResultValue = VALUES(ResultValue), NumericValue = VALUES(NumericValue), TextValue = VALUES(TextValue),
       Unit = VALUES(Unit), Method = VALUES(Method), Flag = VALUES(Flag), FlagSymbol = VALUES(FlagSymbol),
       ReferenceRangeUsed = VALUES(ReferenceRangeUsed), ReferenceRangeId = VALUES(ReferenceRangeId),
       Interpretation = VALUES(Interpretation), Comment = VALUES(Comment), IsCalculated = VALUES(IsCalculated),
       CalculatedFrom = VALUES(CalculatedFrom), UpdatedAt = NOW(), DeletedAt = NULL`,
      [
        data.ReportId,
        data.ParameterId,
        data.ResultValue !== undefined ? data.ResultValue : "",
        data.NumericValue !== undefined ? data.NumericValue : null,
        data.TextValue !== undefined ? data.TextValue : null,
        data.Unit,
        data.Method,
        data.Flag || null,
        data.FlagSymbol || null,
        data.ReferenceRangeUsed || null,
        data.ReferenceRangeId || null,
        data.Interpretation || null,
        data.Comment || null,
        data.IsCalculated || 0,
        data.CalculatedFrom ? JSON.stringify(data.CalculatedFrom) : null
      ]
    );
    await conn.commit();
    return true;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    release(conn);
  }
};

let updateReportResult = async (reportId, parameterId, data) => {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    const fields = [];
    const values = [];
    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined) {
        if (key === "CalculatedFrom" && value !== null) {
          fields.push(`${key} = ?`);
          values.push(JSON.stringify(value));
        } else {
          fields.push(`${key} = ?`);
          values.push(value);
        }
      }
    });
    if (!fields.length) throw new Error("No fields to update");
    values.push(reportId, parameterId);
    await conn.query(
      `UPDATE Patho_ReportResult SET ${fields.join(", ")} WHERE ReportId = ? AND ParameterId = ?`,
      values
    );
    await conn.commit();
    return true;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    release(conn);
  }
};

let getEmptyRequiredResults = async (reportId) => {
  const [rows] = await dbConnection.connection.promise().query(
    `SELECT rr.*, p.ParameterName
     FROM Patho_ReportResult rr
     JOIN Patho_Parameter p ON rr.ParameterId = p.Id
     LEFT JOIN Patho_TestParameterMapping m ON m.ParameterId = p.Id
       AND m.TestId = (SELECT TestId FROM PatientTestRefference WHERE Id =
         (SELECT PatientTestRefferenceId FROM Patho_Report WHERE Id = ?))
     WHERE rr.ReportId = ? AND (rr.ResultValue IS NULL OR rr.ResultValue = '')
       AND COALESCE(m.IsRequired, TRUE) = TRUE AND rr.DeletedAt IS NULL`,
    [reportId, reportId]
  );
  return rows;
};

let getReportResultsByParameterIds = async (reportId, parameterIds) => {
  if (!parameterIds || !parameterIds.length) return [];
  const placeholders = parameterIds.map(() => "?").join(",");
  const [rows] = await dbConnection.connection.promise().query(
    `SELECT * FROM Patho_ReportResult WHERE ReportId = ? AND ParameterId IN (${placeholders}) AND DeletedAt IS NULL`,
    [reportId, ...parameterIds]
  );
  return rows;
};

// ==================== REPORT AUDIT & VERIFICATION ====================

let createAuditLog = async (data) => {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO Patho_ReportAuditLog (ReportId, Action, StatusFrom, StatusTo, PerformedBy, PerformedByRole,
        IpAddress, UserAgent, SessionId, Details, OldValues, NewValues)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.ReportId,
        data.Action,
        data.StatusFrom || null,
        data.StatusTo || null,
        data.PerformedBy,
        data.PerformedByRole || null,
        data.IpAddress || null,
        data.UserAgent || null,
        data.SessionId || null,
        data.Details ? JSON.stringify(data.Details) : null,
        data.OldValues ? JSON.stringify(data.OldValues) : null,
        data.NewValues ? JSON.stringify(data.NewValues) : null
      ]
    );
    await conn.commit();
    return result.insertId;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    release(conn);
  }
};

let findAuditByReportId = async (reportId, limit = 100) => {
  const [rows] = await dbConnection.connection.promise().query(
    `SELECT al.*, CONCAT(u.FirstName,' ', u.LastName) AS PerformedByName FROM Patho_ReportAuditLog al
     LEFT JOIN Users u ON al.PerformedBy = u.Id
     WHERE al.ReportId = ? ORDER BY al.PerformedAt DESC LIMIT ?`,
    [reportId, limit]
  );
  return rows;
};

let createReportVerification = async (data) => {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO Patho_ReportVerification 
       (ReportId, VerificationLevel, Action, StatusFrom, StatusTo, PerformedBy, PerformedByRole, PerformedAt, IpAddress, UserAgent, Remarks, RejectionReason, SignatureData)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?)`,
      [
        data.ReportId,
        data.VerificationLevel,
        data.Action,
        data.StatusFrom || null,
        data.StatusTo,
        data.PerformedBy,
        data.PerformedByRole || null,
        data.IpAddress || null,
        data.UserAgent || null,
        data.Remarks || null,
        data.RejectionReason || null,
        data.SignatureData || null
      ]
    );
    await conn.commit();
    return result.insertId;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    release(conn);
  }
};

let findReportVerifications = async (reportId) => {
  const [rows] = await dbConnection.connection.promise().query(
    `SELECT v.*, u.Name AS PerformedByName 
     FROM Patho_ReportVerification v
     LEFT JOIN Users u ON v.PerformedBy = u.Id
     WHERE v.ReportId = ? ORDER BY v.PerformedAt DESC`,
    [reportId]
  );
  return rows;
};

// ==================== QUEUES & DASHBOARDS ====================

let findDepartmentQueue = async (departmentId, status = null, page = 1, limit = 50) => {
  let sql = `SELECT r.*, d.DepartmentName, pt.Name AS PatientName, pt.Age, pt.Gender, mt.TestName
    FROM Patho_Report r JOIN Patho_Department d ON r.DepartmentId = d.Id
    JOIN PatientTestRefference ptr ON r.PatientTestRefferenceId = ptr.Id
    JOIN PatientDetails pt ON ptr.PatientId = pt.Id
    JOIN MainTestTable mt ON ptr.TestId = mt.Id
    WHERE r.DepartmentId = ? AND r.DeletedAt IS NULL`;
  const params = [departmentId];
  if (status) {
    sql += " AND r.Status = ?";
    params.push(status);
  }
  sql += " ORDER BY r.Urgency DESC, r.CreatedAt DESC LIMIT ? OFFSET ?";
  params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

  const [rows] = await dbConnection.connection.promise().query(sql, params);

  let countSql = `SELECT COUNT(*) AS Total FROM Patho_Report WHERE DepartmentId = ? AND DeletedAt IS NULL`;
  const countParams = [departmentId];
  if (status) {
    countSql += " AND Status = ?";
    countParams.push(status);
  }
  const [countRows] = await dbConnection.connection.promise().query(countSql, countParams);

  return {
    data: rows,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total: countRows[0].Total,
      totalPages: Math.ceil(countRows[0].Total / parseInt(limit))
    }
  };
};

let findDashboardStats = async (departmentId = null) => {
  let sql = `SELECT Status, COUNT(*) AS Count, SUM(CASE WHEN Urgency = 'urgent' THEN 1 ELSE 0 END) AS Urgent
    FROM Patho_Report WHERE DeletedAt IS NULL`;
  const params = [];
  if (departmentId) {
    sql += " AND DepartmentId = ?";
    params.push(departmentId);
  }
  sql += " GROUP BY Status";
  const [rows] = await dbConnection.connection.promise().query(sql, params);
  return rows;
};

let findAllDepartmentsWithQueue = async () => {
  const [depts] = await dbConnection.connection.promise().query(
    "SELECT * FROM Patho_Department WHERE Status = 'active' AND DeletedAt IS NULL ORDER BY DisplayOrder"
  );
  return depts;
};

let findRecentReportsByDepartment = async (departmentId, limit = 5) => {
  const [rows] = await dbConnection.connection.promise().query(
    `SELECT r.*, pt.Name AS PatientName, mt.TestName FROM Patho_Report r
     JOIN PatientTestRefference ptr ON r.PatientTestRefferenceId = ptr.Id
     JOIN PatientDetails pt ON ptr.PatientId = pt.Id
     JOIN MainTestTable mt ON ptr.TestId = mt.Id
     WHERE r.DepartmentId = ? AND r.DeletedAt IS NULL ORDER BY r.CreatedAt DESC LIMIT ?`,
    [departmentId, limit]
  );
  return rows;
};

let countPendingByDepartment = async (departmentId) => {
  const [rows] = await dbConnection.connection.promise().query(
    `SELECT COUNT(*) AS Count FROM Patho_Report WHERE DepartmentId = ? AND Status IN ('draft','completed','verified') AND DeletedAt IS NULL`,
    [departmentId]
  );
  return rows[0].Count;
};

// ==================== DYNAMIC UPDATE HELPERS (Mass-Assignment Protection) ====================

const ALLOWED_DEPT_FIELDS = [
  "DepartmentName",
  "DepartmentCode",
  "Description",
  "DisplayOrder",
  "Status"
];
const ALLOWED_PARAM_FIELDS = [
  "ParameterName",
  "ShortName",
  "Unit",
  "Method",
  "LoincCode",
  "DecimalPrecision",
  "IsCalculated",
  "CalculationFormula",
  "FormulaDependencies",
  "ResultType",
  "SelectOptions",
  "DefaultValue",
  "ActiveStatus"
];
const ALLOWED_RANGE_FIELDS = [
  "ParameterId",
  "DepartmentId",
  "Method",
  "Gender",
  "AgeFrom",
  "AgeTo",
  "AgeUnit",
  "MinValue",
  "MaxValue",
  "CriticalLow",
  "CriticalHigh",
  "InterpretationNormal",
  "InterpretationAbnormal",
  "Priority",
  "ActiveStatus"
];
const ALLOWED_TEST_SPECIMEN_FIELDS = [
  "MainTestId",
  "SpecimenTypeId",
  "ContainerTypeId",
  "MinVolume",
  "MaxVolume",
  "Inversions",
  "CollectionInstructions",
  "IsDefault",
  "DepartmentId",
  "Status"
];

const buildUpdateFields = (data, allowedFields) => {
  const fields = [];
  const values = [];
  Object.entries(data).forEach(([key, value]) => {
    if (allowedFields.includes(key) && value !== undefined) {
      if (["FormulaDependencies", "SelectOptions", "CalculatedFrom"].includes(key) && value !== null) {
        fields.push(`${key} = ?`);
        values.push(typeof value === "string" ? value : JSON.stringify(value));
      } else {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }
  });
  return { fields, values };
};

let updateDepartment = async (id, data) => {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    const { fields, values } = buildUpdateFields(data, ALLOWED_DEPT_FIELDS);
    if (!fields.length) throw new Error("No valid fields to update");
    values.push(id);
    await conn.query(`UPDATE Patho_Department SET ${fields.join(", ")} WHERE Id = ?`, values);
    await conn.commit();
    return true;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    release(conn);
  }
};

let updateParameter = async (id, data) => {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    const { fields, values } = buildUpdateFields(data, ALLOWED_PARAM_FIELDS);
    if (!fields.length) throw new Error("No valid fields to update");
    values.push(id);
    await conn.query(`UPDATE Patho_Parameter SET ${fields.join(", ")} WHERE Id = ?`, values);
    await conn.commit();
    return true;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    release(conn);
  }
};

let updateReferenceRange = async (id, data) => {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    const { fields, values } = buildUpdateFields(data, ALLOWED_RANGE_FIELDS);
    if (!fields.length) throw new Error("No valid fields to update");
    values.push(id);
    await conn.query(`UPDATE Patho_ReferenceRange SET ${fields.join(", ")} WHERE Id = ?`, values);
    await conn.commit();
    return true;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    release(conn);
  }
};

let updateTestSpecimenRequirement = async (id, data) => {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    const { fields, values } = buildUpdateFields(data, ALLOWED_TEST_SPECIMEN_FIELDS);
    if (!fields.length) throw new Error("No valid fields to update");
    values.push(id);
    await conn.query(`UPDATE Patho_TestSpecimenRequirement SET ${fields.join(", ")} WHERE Id = ?`, values);
    await conn.commit();
    return true;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    release(conn);
  }
};

// ==================== SPECIMEN DASHBOARD QUERIES ====================

let findPendingSpecimens = async () => {
  const [rows] = await dbConnection.connection.promise().query(`
    SELECT 
      ptr.Id AS PatientTestRefferenceId,
      ptr.TestId,
      pt.Name AS PatientName,
      pt.Age AS PatientAge,
      pt.YMD AS PatientAgeUnit,
      pt.Gender AS PatientGender,
      mt.TestName,
      tp.SpecimenType AS DefaultSpecimenType,
      ps.Id AS SpecimenId,
      ps.Status AS SpecimenStatus,
      ps.SpecimenType AS ActualSpecimenType,
      ps.ContainerType AS ActualContainerType,
      ps.Barcode,
      ps.CollectedAt,
      ps.ReceivedAt,
      ps.AcceptedBy,
      CONCAT(u.FirstName,' ',u.LastName) AS AcceptedByName
    FROM PatientTestRefference ptr
    JOIN PatientDetails pt ON ptr.PatientId = pt.Id
    JOIN MainTestTable mt ON ptr.TestId = mt.Id
    LEFT JOIN Patho_TestProfile tp ON mt.Id = tp.MainTestId AND tp.ActiveStatus = 'active'
    LEFT JOIN Patho_Specimen ps ON ptr.Id = ps.PatientTestRefferenceId
    LEFT JOIN Users u ON ps.AcceptedBy = u.Id
    WHERE mt.CategoryId = 2
      AND ptr.Status = 1
      AND (ps.Id IS NULL OR ps.Status != 'accepted')
    ORDER BY ptr.Id DESC
  `);
  return rows;
};

let findAcceptedSpecimens = async (limit = 20) => {
  const [rows] = await dbConnection.connection.promise().query(
    `
    SELECT 
      ptr.Id AS PatientTestRefferenceId,
      ptr.TestId,
      pt.Name AS PatientName,
      mt.TestName,
      ps.SpecimenType,
      ps.ContainerType,
      ps.Status,
      ps.Barcode,
      ps.CollectedAt,
      ps.CreatedAt,
      ps.AcceptedAt,
      CONCAT(u.FirstName,' ',u.LastName) AS AcceptedByName,
      r.Id AS ReportId,
      r.Status AS ReportStatus
    FROM Patho_Specimen ps
    JOIN PatientTestRefference ptr ON ps.PatientTestRefferenceId = ptr.Id
    JOIN PatientDetails pt ON ptr.PatientId = pt.Id
    JOIN MainTestTable mt ON ptr.TestId = mt.Id
    LEFT JOIN Users u ON ps.AcceptedBy = u.Id
    LEFT JOIN Patho_Report r ON ps.Id = r.SpecimenId AND r.DeletedAt IS NULL
    WHERE ps.Status = 'accepted'
    ORDER BY ps.AcceptedAt DESC
    LIMIT ?
  `,
    [limit]
  );
  return rows;
};

let acceptSpecimenByPTR = async (
  patientTestRefferenceId,
  specimenType,
  containerType,
  userId,
  specimenTypeId,
  containerTypeId
) => {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    const [existing] = await conn.query(
      "SELECT * FROM Patho_Specimen WHERE PatientTestRefferenceId = ? ORDER BY Id DESC LIMIT 1",
      [patientTestRefferenceId]
    );

    if (existing.length > 0) {
      await conn.query(
        `UPDATE Patho_Specimen 
         SET Status = 'accepted', AcceptedBy = ?, SpecimenType = ?, ContainerType = ?, 
             SpecimenTypeId = ?, ContainerTypeId = ?, ReceivedAt = NOW(), AcceptedAt = NOW() 
         WHERE Id = ?`,
        [userId, specimenType, containerType, specimenTypeId, containerTypeId, existing[0].Id]
      );
      await conn.commit();
      return { updated: true, id: existing[0].Id };
    } else {
      const [result] = await conn.query(
        `INSERT INTO Patho_Specimen 
         (PatientTestRefferenceId, SpecimenType, ContainerType, SpecimenTypeId, ContainerTypeId, Status, AcceptedBy, CollectedAt, ReceivedAt, AcceptedAt) 
         VALUES (?, ?, ?, ?, ?, 'accepted', ?, NOW(), NOW(), NOW())`,
        [patientTestRefferenceId, specimenType, containerType, specimenTypeId, containerTypeId, userId]
      );
      await conn.commit();
      return { created: true, id: result.insertId };
    }
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    release(conn);
  }
};

let rejectSpecimenById = async (specimenId, reason, userId, reasonCategory) => {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `UPDATE Patho_Specimen SET Status = 'rejected', RejectedBy = ?, RejectedAt = NOW(), RejectionReason = ?, RejectionReasonCategory = ? WHERE Id = ?`,
      [userId, reason, reasonCategory || "other", specimenId]
    );
    await conn.commit();
    return true;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    release(conn);
  }
};

/**
 * FIX: Date filtering now includes patient tests without specimens (ps.CreatedAt IS NULL).
 * Added search filter. Fixed status='not_collected' to use ps.Id IS NULL.
 */
let findSpecimensByFilter = async (dateFrom, dateTo, status, search, limit = 100) => {
  let sql = `
    SELECT 
      ptr.Id AS PatientTestRefferenceId,
      ptr.TestId,
      pt.Name AS PatientName,
      pt.Id as PatientId,
      pt.Age AS PatientAge,
      pt.YMD AS PatientAgeUnit,
      pt.Gender AS PatientGender,
      mt.TestName,
      st.TypeName AS SpecimenTypeName,
      ct.ContainerName,
      ct.CapColor,
      ps.Id AS SpecimenId,
      ps.Barcode,
      ps.SpecimenType,
      ps.ContainerType,
      ps.Status,
      ps.QualityCheckNotes,
      ps.RejectionReason,
      ps.RejectionReasonCategory,
      ps.CollectedAt,
      ps.ReceivedAt,
      ps.AcceptedAt,
      ps.CreatedAt,
      CONCAT(u.FirstName,' ',u.LastName) AS AcceptedByName,
      r.Id AS ReportId,
      r.Status AS ReportStatus
    FROM PatientTestRefference ptr
    JOIN PatientDetails pt ON ptr.PatientId = pt.Id
    JOIN MainTestTable mt ON ptr.TestId = mt.Id
    LEFT JOIN Patho_Specimen ps ON ptr.Id = ps.PatientTestRefferenceId
    LEFT JOIN Patho_SpecimenType st ON ps.SpecimenTypeId = st.Id
    LEFT JOIN Patho_ContainerType ct ON ps.ContainerTypeId = ct.Id
    LEFT JOIN Users u ON ps.AcceptedBy = u.Id
    LEFT JOIN Patho_Report r ON ps.Id = r.SpecimenId AND r.DeletedAt IS NULL
    WHERE mt.CategoryId = 2
  `;
  const params = [];

  if (dateFrom && dateTo) {
    sql += " AND (ps.CreatedAt IS NULL OR DATE(ps.CreatedAt) BETWEEN ? AND ?)";
    params.push(dateFrom, dateTo);
  } else if (dateFrom) {
    sql += " AND (ps.CreatedAt IS NULL OR DATE(ps.CreatedAt) >= ?)";
    params.push(dateFrom);
  } else if (dateTo) {
    sql += " AND (ps.CreatedAt IS NULL OR DATE(ps.CreatedAt) <= ?)";
    params.push(dateTo);
  }

  if (status && status !== "all") {
    if (status === "not_collected") {
      sql += " AND ps.Id IS NULL";
    } else {
      sql += " AND ps.Status = ?";
      params.push(status);
    }
  }

  if (search) {
    sql += " AND (pt.Name LIKE ? OR mt.TestName LIKE ? OR ps.Barcode LIKE ?)";
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  sql += " ORDER BY COALESCE(ps.AcceptedAt, ps.CreatedAt, ptr.Id) DESC LIMIT ?";
  params.push(parseInt(limit) || 100);

  const [rows] = await dbConnection.connection.promise().query(sql, params);
  return rows;
};

let findSpecimenStats = async (dateFrom, dateTo) => {
  let sql = `
    SELECT 
      COALESCE(ps.Status, 'not_collected') AS Status,
      COUNT(*) AS Count
    FROM PatientTestRefference ptr
    JOIN MainTestTable mt ON ptr.TestId = mt.Id
    LEFT JOIN Patho_Specimen ps ON ptr.Id = ps.PatientTestRefferenceId
    WHERE mt.CategoryId = 2
  `;
  const params = [];

  if (dateFrom && dateTo) {
    sql += " AND DATE(ps.CreatedAt) BETWEEN ? AND ?";
    params.push(dateFrom, dateTo);
  } else if (dateFrom) {
    sql += " AND DATE(ps.CreatedAt) >= ?";
    params.push(dateFrom);
  } else if (dateTo) {
    sql += " AND DATE(ps.CreatedAt) <= ?";
    params.push(dateTo);
  }

  sql += " GROUP BY ps.Status";

  const [rows] = await dbConnection.connection.promise().query(sql, params);
  const stats = { pending: 0, accepted: 0, rejected: 0, collected: 0, not_collected: 0, discarded: 0 };
  rows.forEach((r) => {
    stats[r.Status || "not_collected"] = r.Count;
  });
  stats.pending = (stats.not_collected || 0) + (stats.collected || 0) + (stats.received || 0);
  return stats;
};

/**
 * FIX: Corrected CONCAT spacing for AcceptedByName.
 */
let findSpecimenDetail = async (patientTestRefferenceId) => {
  const [rows] = await dbConnection.connection.promise().query(
    `
    SELECT 
      ptr.Id AS PatientTestRefferenceId,
      ptr.TestId,
      pt.Name AS PatientName,
      pt.Age AS PatientAge,
      pt.YMD AS PatientAgeUnit,
      pt.Gender AS PatientGender,
      mt.TestName,
      st.TypeName AS DefaultSpecimenTypeName,
      ct.ContainerName AS DefaultContainerName,
      ct.CapColor AS DefaultCapColor,
      ps.Id AS SpecimenId,
      ps.SpecimenType AS ActualSpecimenType,
      ps.ContainerType AS ActualContainerType,
      ps.Barcode,
      ps.Status,
      ps.CollectedAt,
      ps.ReceivedAt,
      ps.AcceptedAt,
      ps.AcceptedBy,
      ps.RejectionReason,
      ps.RejectionReasonCategory,
      ps.QualityCheckNotes,
      CONCAT(u.FirstName,' ',u.LastName) AS AcceptedByName,
      r.Id AS ReportId,
      r.Status AS ReportStatus
    FROM PatientTestRefference ptr
    JOIN PatientDetails pt ON ptr.PatientId = pt.Id
    JOIN MainTestTable mt ON ptr.TestId = mt.Id
    LEFT JOIN Patho_TestSpecimenRequirement tsr ON mt.Id = tsr.MainTestId AND tsr.IsDefault = 1 AND tsr.DeletedAt IS NULL
    LEFT JOIN Patho_SpecimenType st ON tsr.SpecimenTypeId = st.Id
    LEFT JOIN Patho_ContainerType ct ON tsr.ContainerTypeId = ct.Id
    -- FIX: a recollected test has several specimen rows (old rejected + new).
    -- Always take the LATEST one, otherwise after "Recollect" the screen keeps
    -- showing the old rejected specimen and it looks like nothing happened.
    LEFT JOIN Patho_Specimen ps ON ps.Id = (
        SELECT s.Id FROM Patho_Specimen s
         WHERE s.PatientTestRefferenceId = ptr.Id
         ORDER BY s.Id DESC LIMIT 1
    )
    LEFT JOIN Users u ON ps.AcceptedBy = u.Id
    LEFT JOIN Patho_Report r ON ps.Id = r.SpecimenId AND r.DeletedAt IS NULL
    WHERE ptr.Id = ?
    LIMIT 1
  `,
    [patientTestRefferenceId]
  );
  return rows[0] || null;
};

let findPatientTestReferenceById = async (id) => {
  const [rows] = await dbConnection.connection.promise().query(
    "SELECT * FROM PatientTestRefference WHERE Id = ?",
    [id]
  );
  return rows[0] || null;
};

// ==================== BRIDGE: PATIENT DETAIL -> PATHOLOGY ====================

/**
 * Resolve the PatientTestRefference for a (patient, test) pair.
 * Used by the "Report" button on the patient-details page (/pathology/go),
 * so the EJS never has to know the PatientTestRefferenceId. Only pathology
 * tests (MainTestTable.CategoryId = 2) are matched. If the same test was booked
 * more than once for the patient, the most recent active reference wins.
 */
let findPtrByPatientAndTest = async (patientId, testId) => {
  const [rows] = await dbConnection.connection.promise().query(
    `SELECT ptr.Id AS PatientTestRefferenceId, ptr.TestId, ptr.PatientId, mt.CategoryId
       FROM PatientTestRefference ptr
       JOIN MainTestTable mt ON ptr.TestId = mt.Id
      WHERE ptr.PatientId = ? AND ptr.TestId = ? AND mt.CategoryId = 2
      ORDER BY ptr.Id DESC
      LIMIT 1`,
    [patientId, testId]
  );
  return rows[0] || null;
};

// ==================== ATOMIC WORKFLOW (double-submit / race safe) ====================

/**
 * Atomically move a report from one of `fromStatuses` to `toStatus`.
 * The whole check-and-set is a single conditional UPDATE, so two concurrent
 * requests (double click, two tabs, a retried POST) can never both succeed:
 * the first updates 1 row, the second updates 0. Returns { changed, affectedRows }.
 *
 * This replaces the old read-then-write in ReportWorkflowService that let a
 * double click create duplicate audit / verification rows and overwrite the
 * Completed/Verified/Approved timestamps twice.
 */
let transitionReportStatus = async (id, fromStatuses, toStatus, userId, extra = {}) => {
  const from = Array.isArray(fromStatuses) ? fromStatuses : [fromStatuses];
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    const fields = ["Status = ?"];
    const values = [toStatus];
    const timestampMap = {
      completed: "CompletedAt", verified: "VerifiedAt", approved: "ApprovedAt",
      rejected: "RejectedAt", delivered: "DeliveredAt", draft: null
    };
    const userMap = {
      completed: "CompletedBy", verified: "VerifiedBy", approved: "ApprovedBy",
      rejected: "RejectedBy", delivered: "DeliveredBy"
    };
    if (timestampMap[toStatus]) fields.push(`${timestampMap[toStatus]} = NOW()`);
    if (userMap[toStatus]) { fields.push(`${userMap[toStatus]} = ?`); values.push(userId); }
    if (extra.Remarks !== undefined) { fields.push("Remarks = ?"); values.push(extra.Remarks); }
    if (extra.Reason !== undefined) { fields.push("RejectionReason = ?"); values.push(extra.Reason); }
    if (extra.DeliveryMethod !== undefined) { fields.push("DeliveryMethod = ?"); values.push(extra.DeliveryMethod); }

    const placeholders = from.map(() => "?").join(",");
    const [result] = await conn.query(
      `UPDATE Patho_Report SET ${fields.join(", ")}
        WHERE Id = ? AND DeletedAt IS NULL AND Status IN (${placeholders})`,
      [...values, id, ...from]
    );
    await conn.commit();
    return { changed: result.affectedRows === 1, affectedRows: result.affectedRows };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    release(conn);
  }
};

/**
 * Atomic report-number sequence. A COUNT(*)+1 scheme hands the same number to
 * two concurrent report creations (this is what produced two "LAB-2026-000006"
 * reports). Patho_Sequence.Val is bumped with LAST_INSERT_ID so each caller gets
 * a distinct value even under load. Requires the Patho_Sequence table (see the
 * SQL shipped with this change).
 */
let getNextReportSequence = async (sequenceKey) => {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO Patho_Sequence (SeqKey, Val) VALUES (?, LAST_INSERT_ID(1))
       ON DUPLICATE KEY UPDATE Val = LAST_INSERT_ID(Val + 1)`,
      [sequenceKey]
    );
    const [rows] = await conn.query("SELECT LAST_INSERT_ID() AS Val");
    await conn.commit();
    return rows[0].Val;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    release(conn);
  }
};

/**
 * Serialise a critical section against a key using a MySQL named lock.
 * Used to make "create report for this PatientTestRefference if none exists"
 * safe when two specimen-accept clicks land at the same moment.
 */
let withNamedLock = async (lockName, timeoutSeconds, fn) => {
  const conn = await getConnection();
  try {
    const [[{ got }]] = await conn.query("SELECT GET_LOCK(?, ?) AS got", [lockName, timeoutSeconds]);
    if (got !== 1) throw new Error("Busy, please try again.");
    try {
      return await fn();
    } finally {
      await conn.query("SELECT RELEASE_LOCK(?)", [lockName]);
    }
  } finally {
    release(conn);
  }
};

// ==================== EXPORTS ====================

module.exports = {
  // Specimen Type Master
  findAllSpecimenTypes,
  findSpecimenTypeById,
  createSpecimenType,
  // Container Type Master
  findAllContainerTypes,
  findContainerTypeById,
  createContainerType,
  // Test Specimen Requirement
  findTestSpecimenRequirement,
  findAllTestSpecimenRequirements,
  createTestSpecimenRequirement,
  updateTestSpecimenRequirement,
  softDeleteTestSpecimenRequirement: async (id) => {
    const conn = await getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        "UPDATE Patho_TestSpecimenRequirement SET DeletedAt = NOW(), Status = 'inactive' WHERE Id = ?",
        [id]
      );
      await conn.commit();
      return true;
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      release(conn);
    }
  },
  // Departments
  findAllDepartments,
  findDepartmentById,
  findDepartmentByCode,
  createDepartment,
  updateDepartment,
  softDeleteDepartment,
  // Parameters
  findAllParameters,
  findParameterById,
  findParametersByIds,
  createParameter,
  updateParameter,
  softDeleteParameter,
  // Test Profile
  findTestProfile,
  createTestProfile,
  findAllTestProfiles,
  findTestsWithoutProfile,
  // Test Parameter Mapping
  findTestParameters,
  findDepartmentByTestId,
  findPathologyTestFallback,
  assignTestParameter,
  removeTestParameter,
  updateTestParameterOrder,
  findAllParametersWithMapping,
  findMainTests,
  // Reference Ranges
  findReferenceRanges,
  findReferenceRangesByParameterId,
  findReferenceRangesByParameterIds,
  createReferenceRange,
  updateReferenceRange,
  softDeleteReferenceRange,
  // Specimen
  findSpecimenById,
  findSpecimenByPTR,
  createSpecimen,
  updateSpecimenStatus,
  // Specimen Audit
  createSpecimenAuditLog,
  findSpecimenAuditLog,
  // Reports
  findReportById,
  findReportByPatientTestReferenceId,
  findReportWithResults,
  findReportWithPatient,
  findReportResults,
  createReport,
  updateReportStatus,
  // Report Results
  createReportResult,
  updateReportResult,
  getEmptyRequiredResults,
  getReportResultsByParameterIds,
  // Report Audit & Verification
  createAuditLog,
  findAuditByReportId,
  createReportVerification,
  findReportVerifications,
  // Queues
  findDepartmentQueue,
  findDashboardStats,
  findAllDepartmentsWithQueue,
  findRecentReportsByDepartment,
  countPendingByDepartment,
  // Specimen Dashboard
  findPendingSpecimens,
  findAcceptedSpecimens,
  acceptSpecimenByPTR,
  rejectSpecimenById,
  findSpecimensByFilter,
  findSpecimenStats,
  findSpecimenDetail,
  // Misc
  findPatientTestReferenceById,
  // Bridge + atomic workflow (double-submit / race safe)
  findPtrByPatientAndTest,
  transitionReportStatus,
  getNextReportSequence,
  withNamedLock
};
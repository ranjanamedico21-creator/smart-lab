const moment = require("moment");
const Pathology = require("../models/Pathology");
const DepartmentResolverService = require("../services/DepartmentResolverService");
const ReportCreationService = require("../services/ReportCreationService");
const SpecimenService = require("../services/SpecimenService");
const ReportWorkflowService = require("../services/ReportWorkflowService");
const RangeResolutionService = require("../services/RangeResolutionService");
const FlagCalculationService = require("../services/FlagCalculationService");
const PdfGenerationService = require("../services/PdfGenerationService");
const TestProfileSuggestionService = require("../services/TestProfileSuggestionService");
const FormulaService = require("../services/FormulaService");

const createNotification = (type, messages, icon) => ({ type, messages, icon });
const getClientInfo = (req) => ({ ipAddress: req.ip || req.connection.remoteAddress, userAgent: req.headers['user-agent'] });

// ==================== UTILITIES ====================

/** 
 * CORE FIX: Resilient role extractor.
 * Different auth middlewares populate role differently:
 * req.user.role, req.user.Role, req.user.userRole, req.user.UserType
 */
const getUserRole = (req) => {
  if (!req.user) return null;
  return req.user.role || req.user.Role || req.user.userRole || req.user.UserType || req.user.type || null;
};

/** Standardized JSON success response. */
const ok = (res, data, message = "Success", status = 200) => 
  res.status(status).json({ success: true, data, message });

/** Standardized JSON error response. */
const fail = (res, message = "Bad request", status = 400) =>
  res.status(status).json({ success: false, message });

// ==================== DEPARTMENTS ====================

let getDepartments = async (req, res) => {
  try {
    const rows = await Pathology.findAllDepartments(req.query.active_only !== "false");
    res.json({ success: true, data: rows, message: "Departments retrieved" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

let getDepartmentById = async (req, res) => {
  try {
    const row = await Pathology.findDepartmentById(req.params.id);
    if (!row) return res.status(404).json({ success: false, message: "Department not found" });
    res.json({ success: true, data: row, message: "Department retrieved" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

let createDepartment = async (req, res) => {
  try {
    const existing = await Pathology.findDepartmentByCode(req.body.DepartmentCode);
    if (existing) return res.status(409).json({ success: false, message: "Department code already exists" });
    const id = await Pathology.createDepartment(req.body);
    res.status(201).json({ success: true, data: { Id: id, ...req.body }, message: "Department created" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

let updateDepartment = async (req, res) => {
  try {
    const existing = await Pathology.findDepartmentById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: "Department not found" });
    if (req.body.DepartmentCode && req.body.DepartmentCode !== existing.DepartmentCode) {
      const dup = await Pathology.findDepartmentByCode(req.body.DepartmentCode);
      if (dup) return res.status(409).json({ success: false, message: "Department code already exists" });
    }
    await Pathology.updateDepartment(req.params.id, req.body);
    res.json({ success: true, message: "Department updated" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

let deleteDepartment = async (req, res) => {
  try {
    const existing = await Pathology.findDepartmentById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: "Department not found" });
    await Pathology.softDeleteDepartment(req.params.id);
    res.json({ success: true, message: "Department deleted" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== PARAMETERS ====================

let getParameters = async (req, res) => {
  try {
    const rows = await Pathology.findAllParameters({ search: req.query.search, resultType: req.query.resultType, activeOnly: req.query.active_only !== "false" });
    res.json({ success: true, data: rows, message: "Parameters retrieved" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

let getParameterById = async (req, res) => {
  try {
    const row = await Pathology.findParameterById(req.params.id);
    if (!row) return res.status(404).json({ success: false, message: "Parameter not found" });
    res.json({ success: true, data: row, message: "Parameter retrieved" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

let createParameter = async (req, res) => {
  try {
    const id = await Pathology.createParameter(req.body);
    res.status(201).json({ success: true, data: { Id: id, ...req.body }, message: "Parameter created" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

let updateParameter = async (req, res) => {
  try {
    const existing = await Pathology.findParameterById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: "Parameter not found" });
    await Pathology.updateParameter(req.params.id, req.body);
    res.json({ success: true, message: "Parameter updated" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

let deleteParameter = async (req, res) => {
  try {
    const existing = await Pathology.findParameterById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: "Parameter not found" });
    await Pathology.softDeleteParameter(req.params.id);
    res.json({ success: true, message: "Parameter deleted" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

let bulkImportParameters = async (req, res) => {
  try {
    const { parameters } = req.body;
    let imported = 0, failed = 0, errors = [];
    for (const param of parameters) {
      try {
        await Pathology.createParameter({ ...param, ActiveStatus: "active" });
        imported++;
      } catch (e) { failed++; errors.push({ name: param.ParameterName, error: e.message }); }
    }
    res.status(201).json({ success: true, data: { imported, failed, errors }, message: `Imported ${imported} parameters` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== TEST PARAMETER MAPPING ====================

let getTestParameters = async (req, res) => {
  try {
    const rows = await Pathology.findTestParameters(req.query.test_id, req.query.department_id);
    res.json({ success: true, data: rows, message: "Test parameters retrieved" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

let assignTestParameter = async (req, res) => {
  try {
    const b = req.body;
    // FIX: the mapping screen sends display_order / is_required / section_header
    // but the model reads DisplayOrder / IsRequired / SectionHeader, so order,
    // section headers and "required" were never saved (always 0 / NULL / required).
    const pick = (snake, pascal) => (b[snake] !== undefined ? b[snake] : b[pascal]);
    const toBool = (v) => !(v === false || v === 0 || v === '0' || v === 'false');
    const data = {
      DisplayOrder: parseInt(pick('display_order', 'DisplayOrder'), 10) || 0,
      IsRequired: pick('is_required', 'IsRequired') === undefined ? true : toBool(pick('is_required', 'IsRequired')),
      IsDefaultSelected: pick('is_default_selected', 'IsDefaultSelected') === undefined ? true : toBool(pick('is_default_selected', 'IsDefaultSelected')),
      SectionHeader: pick('section_header', 'SectionHeader') || null,
      HelpText: pick('help_text', 'HelpText') || null
    };
    await Pathology.assignTestParameter(b.test_id, b.parameter_id, b.department_id, data);
    res.status(201).json({ success: true, message: "Parameter assigned" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

let removeTestParameter = async (req, res) => {
  try {
    await Pathology.removeTestParameter(req.body.test_id, req.body.parameter_id);
    res.json({ success: true, message: "Parameter removed" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

let updateTestParameterOrder = async (req, res) => {
  try {
    await Pathology.updateTestParameterOrder(req.body.test_id, req.body.parameter_id, req.body.display_order);
    res.json({ success: true, message: "Order updated" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== REFERENCE RANGES ====================

let getReferenceRanges = async (req, res) => {
  try {
    const rows = await Pathology.findReferenceRanges({ departmentId: req.query.department_id, parameterId: req.query.parameter_id, gender: req.query.gender });
    res.json({ success: true, data: rows, message: "Reference ranges retrieved" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

let getReferenceRangesByParameter = async (req, res) => {
  try {
    const rows = await Pathology.findReferenceRangesByParameterId(req.params.parameter_id);
    res.json({ success: true, data: rows, message: "Reference ranges retrieved" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

let createReferenceRange = async (req, res) => {
  try {
    const id = await Pathology.createReferenceRange(req.body);
    res.status(201).json({ success: true, data: { Id: id, ...req.body }, message: "Reference range created" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

let updateReferenceRange = async (req, res) => {
  try {
    await Pathology.updateReferenceRange(req.params.id, req.body);
    res.json({ success: true, message: "Reference range updated" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

let deleteReferenceRange = async (req, res) => {
  try {
    await Pathology.softDeleteReferenceRange(req.params.id);
    res.json({ success: true, message: "Reference range deleted" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== TEST PROFILE ====================

let getTestProfile = async (req, res) => {
  try {
    const profile = await Pathology.findTestProfile(req.params.test_id);
    if (!profile) return res.status(404).json({ success: false, message: "Test profile not found" });
    res.json({ success: true, data: profile, message: "Test profile retrieved" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

let createOrUpdateTestProfile = async (req, res) => {
  try {
    const result = await Pathology.createTestProfile(req.body);
    res.json({ success: true, data: result, message: "Test profile saved" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== SPECIMEN MASTERS ====================

let getSpecimenMasters = async (req, res) => {
  try {
    const [specimenTypes, containerTypes, requirements] = await Promise.all([
      Pathology.findAllSpecimenTypes(),
      Pathology.findAllContainerTypes(),
      Pathology.findAllTestSpecimenRequirements()
    ]);
    res.json({ success: true, data: { specimenTypes, containerTypes, requirements }, message: "Masters retrieved" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

let createSpecimenType = async (req, res) => {
  try {
    const id = await Pathology.createSpecimenType(req.body);
    res.status(201).json({ success: true, data: { Id: id, ...req.body }, message: "Specimen type created" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

let createContainerType = async (req, res) => {
  try {
    const id = await Pathology.createContainerType(req.body);
    res.status(201).json({ success: true, data: { Id: id, ...req.body }, message: "Container type created" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

let createTestSpecimenRequirement = async (req, res) => {
  try {
    const id = await Pathology.createTestSpecimenRequirement(req.body);
    res.status(201).json({ success: true, data: { Id: id, ...req.body }, message: "Requirement created" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== REPORTS - API ====================

let createReport = async (req, res) => {
  try {
    const userId = req.user ? req.user.Id : null;
    if (!userId) return res.status(401).json({ success: false, message: "Authentication required" });
    const result = await ReportCreationService.create({
      patientTestRefferenceId: req.body.PatientTestRefferenceId,
      testId: req.body.TestId,
      createdBy: userId
    });
    res.status(201).json({ success: true, data: result, message: "Report created" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

let getReport = async (req, res) => {
  try {
    const data = await Pathology.findReportWithResults(req.params.id);
    if (!data) return res.status(404).json({ success: false, message: "Report not found" });
    res.json({ success: true, data, message: "Report retrieved" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

let loadReportForEntry = async (req, res) => {
  try {
    const reportId = req.params.id;
    const { patient_age, patient_age_unit, patient_gender } = req.query;
    const report = await Pathology.findReportById(reportId);
    if (!report) return res.status(404).json({ success: false, message: "Report not found" });
    const results = await Pathology.findReportResults(reportId);
    const paramIds = results.map(r => r.ParameterId);
    const ranges = await Pathology.findReferenceRangesByParameterIds(paramIds);
    const patient = { age: parseFloat(patient_age), ageUnit: patient_age_unit || "years", gender: patient_gender };
    const enriched = await RangeResolutionService.resolveAll({ results, patient, departmentId: report.DepartmentId, ranges });
    res.json({ success: true, data: { ...report, results: enriched }, message: "Report loaded for entry" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Save draft results.
 * FIXES (2026-10-27):
 *  - Patient age/gender for range selection are read from the DATABASE, not from
 *    the browser payload (the browser value could be stale or tampered).
 *  - A result of 0 (e.g. Basophils 0 %) was stored as NumericValue NULL
 *    because of `parseFloat(v) || null`.
 *  - ReferenceRangeUsed was saved as "13.0000 - 17.0000" or "null - 200";
 *    now "13 - 17", "< 200", "> 40".
 *  - Calculated parameters (MCH, MCHC, LDL, A/G ...) were flagged against the
 *    FIRST range row for the parameter regardless of the patient's gender/age.
 */
let saveResults = async (req, res) => {
  try {
    const reportId = req.params.id;
    const { results } = req.body;
    const report = await Pathology.findReportWithPatient(reportId);
    if (!report) return res.status(404).json({ success: false, message: "Report not found" });
    if (!["draft", "rejected"].includes(report.Status)) {
      return res.status(400).json({ success: false, message: `Report is ${report.Status}; results can only be edited in draft.` });
    }
    const patient = normalizePatient(report);

    const allResultRows = await Pathology.findReportResults(reportId);
    const onReport = new Set(allResultRows.map(r => Number(r.ParameterId)));
    const allParamIds = Array.from(onReport);
    const ranges = await Pathology.findReferenceRangesByParameterIds(allParamIds);
    const parameters = await Pathology.findParametersByIds(allParamIds);

    for (const resultData of results) {
      const pid = Number(resultData.ParameterId);
      if (!onReport.has(pid)) continue;                       // not a parameter of this report
      const param = parameters.find(p => Number(p.Id) === pid);
      if (param && param.IsCalculated && param.CalculationFormula) continue; // computed below

      const raw = resultData.ResultValue === undefined || resultData.ResultValue === null
        ? '' : String(resultData.ResultValue).trim();
      const isNumericType = !param || param.ResultType === 'numeric';
      const n = raw === '' ? NaN : Number(raw);
      const numeric = isNumericType && !isNaN(n) ? n : null;

      const bestRange = RangeResolutionService.resolve({
        parameterId: pid, patient, method: param ? param.Method : null,
        departmentId: report.DepartmentId, ranges
      });
      const flagDetails = numeric === null
        ? { flag: null, symbol: '', interpretation: '' }
        : FlagCalculationService.calculate(numeric, bestRange);

      await Pathology.updateReportResult(reportId, pid, {
        ResultValue: raw,
        NumericValue: numeric,
        TextValue: isNumericType ? null : (raw || null),
        Flag: flagDetails.flag,
        FlagSymbol: flagDetails.symbol || null,
        ReferenceRangeUsed: RangeResolutionService.rangeText(bestRange),
        ReferenceRangeId: bestRange ? bestRange.Id : null,
        Interpretation: flagDetails.interpretation || null,
        Comment: resultData.Comment || null,
        UpdatedAt: new Date()
      });
    }

    const overrides = req.body.calculatedOverrides || {};
    await processCalculatedParameters(reportId, patient, ranges, parameters, overrides, report.DepartmentId);
    res.json({ success: true, message: "Results saved successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Recompute every calculated parameter on the report from the stored values.
 *  - Formula tokens: {SHORTNAME} (brace syntax) or legacy bare ShortNames.
 *  - Multi-pass so chained calcs settle (LDL -> LDL/HDL).
 *  - Missing dependency => value cleared (no stale number left behind).
 *  - Manual overrides typed into a calculated field win over the formula.
 *  - Range chosen with the patient's gender/age (was: first row found).
 */
let processCalculatedParameters = async (reportId, patient, ranges, parameters, overrides = {}, departmentId = null) => {
  const calculatedParams = parameters.filter(p => p.IsCalculated && p.CalculationFormula);
  if (!calculatedParams.length) return;

  const stored = await Pathology.findReportResults(reportId);
  const shortNameById = {};
  parameters.forEach(p => { shortNameById[p.Id] = p.ShortName; });
  const calcIds = new Set(calculatedParams.map(p => Number(p.Id)));

  const valueMap = {};
  stored.forEach(r => {
    if (calcIds.has(Number(r.ParameterId))) return;            // never seed calc params from stale values
    const sn = shortNameById[r.ParameterId];
    if (!sn) return;
    const v = r.NumericValue != null ? Number(r.NumericValue) : parseFloat(r.ResultValue);
    if (!isNaN(v)) valueMap[sn] = v;
  });

  const hasOverride = (id) => Object.prototype.hasOwnProperty.call(overrides, id) || Object.prototype.hasOwnProperty.call(overrides, String(id));
  const overrideVal = (id) => parseFloat(overrides[id] !== undefined ? overrides[id] : overrides[String(id)]);

  for (let pass = 0; pass <= calculatedParams.length; pass++) {
    let changed = false;
    for (const param of calculatedParams) {
      let val;
      if (hasOverride(param.Id) && !isNaN(overrideVal(param.Id))) val = overrideVal(param.Id);
      else {
        const out = FormulaService.evaluate(param.CalculationFormula, valueMap);
        if (out === null) continue;
        const prec = param.DecimalPrecision != null ? Number(param.DecimalPrecision) : 2;
        val = Number(out.toFixed(prec));
        // Calculated concentrations/ratios can't be negative; a sub-zero result
        // means the source values don't reconcile (e.g. Friedewald LDL when
        // HDL+VLDL exceed total cholesterol). Clamp to 0 rather than store "-20".
        if (val < 0) val = 0;
      }
      if (valueMap[param.ShortName] !== val) { valueMap[param.ShortName] = val; changed = true; }
    }
    if (!changed) break;
  }

  for (const param of calculatedParams) {
    const finalVal = valueMap[param.ShortName];
    const prec = param.DecimalPrecision != null ? Number(param.DecimalPrecision) : 2;
    if (finalVal === undefined || isNaN(finalVal)) {
      await Pathology.updateReportResult(reportId, param.Id, {
        ResultValue: '', NumericValue: null, Flag: null, FlagSymbol: null,
        ReferenceRangeUsed: null, ReferenceRangeId: null, Interpretation: null, UpdatedAt: new Date()
      });
      continue;
    }
    const range = RangeResolutionService.resolve({ parameterId: param.Id, patient, method: param.Method, departmentId, ranges });
    const flagDetails = FlagCalculationService.calculate(finalVal, range);
    await Pathology.updateReportResult(reportId, param.Id, {
      ResultValue: finalVal.toFixed(prec),
      NumericValue: finalVal,
      Flag: flagDetails.flag,
      FlagSymbol: flagDetails.symbol || null,
      ReferenceRangeUsed: RangeResolutionService.rangeText(range),
      ReferenceRangeId: range ? range.Id : null,
      Interpretation: flagDetails.interpretation || null,
      IsCalculated: 1,
      CalculatedFrom: hasOverride(param.Id) ? null : (param.FormulaDependencies || null),
      UpdatedAt: new Date()
    });
  }
};

// ==================== REPORT WORKFLOW (Uses ReportWorkflowService) ====================

/**
 * CORE FIX: All workflow transitions now use getUserRole() for resilience.
 */
let completeReport = async (req, res) => {
  try {
    const userId = req.user ? req.user.Id : null;
    if (!userId) return res.status(401).json({ success: false, message: "Authentication required" });
    
    const result = await ReportWorkflowService.transition({
      reportId: req.params.id,
      action: 'complete',
      userId,
      role: getUserRole(req),  // FIX: Was req.user?.role, now resilient
      remarks: req.body.Remarks,
      ...getClientInfo(req)
    });
    
    res.json({
      success: true,
      message: "Report completed",
      data: result,
      redirect: `/pathology/view/verify/${req.params.id}`  // FIX: tell the client exactly where to go
    });
  } catch (error) {
    console.error(error);
    res.status(400).json({ success: false, message: error.message });
  }
};

let verifyReport = async (req, res) => {
  try {
    const userId = req.user ? req.user.Id : null;
    if (!userId) return res.status(401).json({ success: false, message: "Authentication required" });
    
    const result = await ReportWorkflowService.transition({
      reportId: req.params.id,
      action: 'verify',
      userId,
      role: getUserRole(req),
      remarks: req.body.Remarks,
      ...getClientInfo(req)
    });
    
    res.json({ success: true, message: "Report verified", data: result });
  } catch (error) {
    console.error(error);
    res.status(400).json({ success: false, message: error.message });
  }
};

let approveReport = async (req, res) => {
  try {
    const userId = req.user ? req.user.Id : null;
    if (!userId) return res.status(401).json({ success: false, message: "Authentication required" });
    
    const result = await ReportWorkflowService.transition({
      reportId: req.params.id,
      action: 'approve',
      userId,
      role: getUserRole(req),
      remarks: req.body.Remarks,
      ...getClientInfo(req)
    });
    
    res.json({ success: true, message: "Report approved", data: result });
  } catch (error) {
    console.error(error);
    res.status(400).json({ success: false, message: error.message });
  }
};

let deliverReport = async (req, res) => {
  try {
    const userId = req.user ? req.user.Id : null;
    if (!userId) return res.status(401).json({ success: false, message: "Authentication required" });
    
    const result = await ReportWorkflowService.transition({
      reportId: req.params.id,
      action: 'deliver',
      userId,
      role: getUserRole(req),
      remarks: req.body.DeliveryMethod,
      ...getClientInfo(req)
    });
    
    res.json({ success: true, message: "Report delivered", data: result });
  } catch (error) {
    console.error(error);
    res.status(400).json({ success: false, message: error.message });
  }
};

let rejectReport = async (req, res) => {
  try {
    const userId = req.user ? req.user.Id : null;
    if (!userId) return res.status(401).json({ success: false, message: "Authentication required" });
    if (!req.body.Reason) return res.status(400).json({ success: false, message: "Rejection reason required" });
    
    const result = await ReportWorkflowService.transition({
      reportId: req.params.id,
      action: 'reject',
      userId,
      role: getUserRole(req),
      remarks: req.body.Remarks,
      rejectionReason: req.body.Reason,
      ...getClientInfo(req)
    });
    
    res.json({ success: true, message: "Report rejected", data: result });
  } catch (error) {
    console.error(error);
    res.status(400).json({ success: false, message: error.message });
  }
};

let generatePDF = async (req, res) => {
  try {
    const report = await Pathology.findReportWithPatient(req.params.id);
    if (!report) return res.status(404).json({ success: false, message: "Report not found" });
    if (!["approved", "delivered"].includes(report.Status)) return res.status(400).json({ success: false, message: "Must be approved" });
    const results = await Pathology.findReportResults(req.params.id);
    // labInfo drives the PDF letterhead. Fall back to BRAND/env so the report
    // never renders the "LOGO / N/A" placeholders when app.locals isn't set.
    const labInfo = Object.assign({
      name: process.env.LAB_NAME || process.env.BRAND_NAME || "Pathology Laboratory",
      address: process.env.LAB_ADDRESS || "",
      phone: process.env.LAB_PHONE || "",
      email: process.env.LAB_EMAIL || "",
      nabl: process.env.LAB_NABL ? process.env.LAB_NABL === "true" : true
    }, req.app.locals.labInfo || {});
    const pdfService = new PdfGenerationService();
    const pdfBuffer = await pdfService.generate({ report, results, labInfo });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="report-${report.ReportNumber}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

let getAuditTrail = async (req, res) => {
  try {
    const [auditLogs, verifications] = await Promise.all([
      Pathology.findAuditByReportId(req.params.id),
      Pathology.findReportVerifications(req.params.id)
    ]);
    res.json({ success: true, data: { auditLogs, verifications }, message: "Audit trail retrieved" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== QUEUES - API ====================

let getDepartmentQueue = async (req, res) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const result = await Pathology.findDepartmentQueue(req.params.department_id, status, page, limit);
    // FIX: Keep backward-compatible response shape (pagination at top level)
    res.json({ success: true, data: result.data, pagination: result.pagination, message: "Queue retrieved" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

let getDashboard = async (req, res) => {
  try {
    const stats = await Pathology.findDashboardStats(req.query.department_id);
    const formatted = { total_draft: 0, total_completed: 0, total_verified: 0, total_approved: 0, total_delivered: 0, total_urgent: 0 };
    stats.forEach(s => { formatted[`total_${s.Status}`] = parseInt(s.Count); formatted.total_urgent += parseInt(s.Urgent); });
    res.json({ success: true, data: formatted, message: "Dashboard stats retrieved" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

let getAllQueues = async (req, res) => {
  try {
    const departments = await Pathology.findAllDepartmentsWithQueue();
    const queues = await Promise.all(departments.map(async (dept) => {
      const pending = await Pathology.countPendingByDepartment(dept.Id);
      const recent = await Pathology.findRecentReportsByDepartment(dept.Id, 5);
      return { ...dept, pending_count: pending, recent };
    }));
    res.json({ success: true, data: queues, message: "All queues retrieved" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== VIEWS - RENDERING ====================

let renderReportEntry = async (req, res) => {
  try {
    const report = await Pathology.findReportWithPatient(req.params.id);
    if (!report) return res.status(404).render("error", { message: "Report not found", title: "Error", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout" });

    // GUARD: results can only be ENTERED while the report is in draft (or was
    // rejected back to draft). For any later state, the entry form can't save
    // (saveResults enforces draft), so send the user to the verification screen
    // instead of rendering a dead form that errors on save.
    if (report.Status && !['draft', 'rejected'].includes(report.Status)) {
      return res.redirect('/pathology/view/verify/' + report.Id +
        '?toast=' + encodeURIComponent('Results already entered (status: ' + report.Status + ').') + '&type=info');
    }

    const results = await Pathology.findReportResults(report.Id);
    const paramIds = results.map(r => r.ParameterId);
    const ranges = await Pathology.findReferenceRangesByParameterIds(paramIds);
    
    // FIX: Normalize patient data here (moved from model to controller)
    const patient = normalizePatient(report);
    const enriched = await RangeResolutionService.resolveAll({ results, patient, departmentId: report.DepartmentId, ranges });
    
    const grouped = enriched.reduce((acc, r) => {
      const section = r.SectionHeader || 'Results';
      if (!acc[section]) acc[section] = [];
      acc[section].push(r);
      return acc;
    }, {});
    
    res.render("Pathology/report-entry", {
      report, groupedResults: grouped, results: enriched, patient, moment,
      user: req.user || null, title: `Report Entry - ${report.ReportNumber}`,
      BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout"
    });
  } catch (error) {
    console.error(error);
    res.status(500).render("error", { message: error.message, title: "Error", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout" });
  }
};

/** Helper: Normalize patient gender/age from DB encoding */
const normalizePatient = (report) => {
  let gender = (report.PatientGender || '').toString().toLowerCase().trim();
  if (gender === '1' || gender === 'm' || gender === 'male') gender = 'male';
  else if (gender === '2' || gender === 'f' || gender === 'female') gender = 'female';
  else if (gender === '0') gender = 'other';
  
  let ageUnit = (report.PatientAgeUnit || '').toString().toLowerCase().trim();
  if (['years','year','yrs','y'].includes(ageUnit)) ageUnit = 'years';
  else if (['months','month','mos','m'].includes(ageUnit)) ageUnit = 'months';
  else if (['days','day','d'].includes(ageUnit)) ageUnit = 'days';
  
  return {
    age: parseFloat(report.PatientAge) || 0,
    ageUnit: ageUnit || 'years',
    gender
  };
};

let renderReportVerify = async (req, res) => {
  try {
    const report = await Pathology.findReportWithPatient(req.params.id);
    if (!report) return res.status(404).render("error", { message: "Report not found", title: "Error", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout" });
    const results = await Pathology.findReportResults(req.params.id);
    const grouped = results.reduce((acc, r) => { const section = r.SectionHeader || 'Results'; if (!acc[section]) acc[section] = []; acc[section].push(r); return acc; }, {});
    res.render("Pathology/report-verify", { report, groupedResults: grouped, results, moment, user: req.user || null, title: "Report Verification", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout" });
  } catch (error) {
    console.error(error);
    res.status(500).render("error", { message: error.message, title: "Error", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout" });
  }
};

// FIX: views report-approve.ejs / report-final.ejs do not exist, so these routes
// crashed with "Failed to lookup view". Approval happens on the verify screen and
// the final report is the PDF, so redirect there.
let renderReportApprove = async (req, res) => {
  res.redirect('/pathology/view/verify/' + encodeURIComponent(req.params.id));
};

let renderReportFinal = async (req, res) => {
  res.redirect('/pathology/reports/' + encodeURIComponent(req.params.id) + '/pdf');
};

let renderQueueDashboard = async (req, res) => {
  try {
    const departments = await Pathology.findAllDepartmentsWithQueue();
    const queues = await Promise.all(departments.map(async (dept) => {
      const pending = await Pathology.countPendingByDepartment(dept.Id);
      const recent = await Pathology.findRecentReportsByDepartment(dept.Id, 5);
      return { ...dept, pending_count: pending, recent };
    }));
    const statRows = await Pathology.findDashboardStats();
    const totals = { draft: 0, completed: 0, verified: 0, approved: 0, delivered: 0, rejected: 0, urgent: 0 };
    statRows.forEach(s => { totals[s.Status] = parseInt(s.Count) || 0; totals.urgent += parseInt(s.Urgent) || 0; });
    res.render("Pathology/queue-dashboard", { queues, totals, moment, user: req.user || null, title: "Department Queues", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout" });
  } catch (error) {
    console.error(error);
    res.status(500).render("error", { message: error.message, title: "Error", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout" });
  }
};

// ==================== ADMIN VIEWS ====================

let renderDepartmentAdmin = async (req, res) => {
  try {
    const departments = await Pathology.findAllDepartments(false);
    res.render("Pathology/departments-admin", { departments, moment, user: req.user || null, title: "Department Master", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout" });
  } catch (error) {
    console.error(error);
    res.status(500).render("error", { message: error.message, title: "Error", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout" });
  }
};

let renderParameterAdmin = async (req, res) => {
  try {
    const parameters = await Pathology.findAllParameters({ activeOnly: false, search: req.query.search });
    res.render("Pathology/parameters-admin", { parameters, moment, user: req.user || null, search: req.query.search || '', title: "Parameter Master", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout" });
  } catch (error) {
    console.error(error);
    res.status(500).render("error", { message: error.message, title: "Error", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout" });
  }
};

let renderTestMappingAdmin = async (req, res) => {
  try {
    const tests = await Pathology.findMainTests();
    const departments = await Pathology.findAllDepartments(true);
    let selectedTest = req.query.test_id ? parseInt(req.query.test_id) : null;
    let selectedDept = req.query.department_id ? parseInt(req.query.department_id) : null;
    const profiles = await Pathology.findAllTestProfiles();
    const unprofiled = await Pathology.findTestsWithoutProfile();

    if (!selectedTest && tests.length) selectedTest = tests[0].Id;
    if (selectedTest && !selectedDept) {
      const resolution = await DepartmentResolverService.resolve(selectedTest);
      if (resolution.DepartmentId) selectedDept = resolution.DepartmentId;
      else if (departments.length) selectedDept = departments[0].Id;
    }
    if (!selectedDept && departments.length) selectedDept = departments[0].Id;

    let mappedParameters = [];
    let suggestedParamIds = [];
    if (selectedTest && selectedDept) {
      mappedParameters = await Pathology.findAllParametersWithMapping(selectedTest, selectedDept);
      const currentTest = tests.find(t => t.Id == selectedTest);
      if (currentTest) {
        const allParams = await Pathology.findAllParameters({ activeOnly: false });
        const suggestion = TestProfileSuggestionService.suggest(currentTest.TestName, allParams, departments);
        suggestedParamIds = suggestion.suggestedParamIds;
      }
    }

    res.render("Pathology/test-mapping-admin", {
      tests, departments, mappedParameters, selectedTest, selectedDept, suggestedParamIds,
      moment, profiles, unprofiled: unprofiled || [], user: req.user || null,
      title: "Test Parameter Mapping", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout"
    });
  } catch (error) {
    console.error(error);
    res.status(500).render("error", { message: error.message, title: "Error", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout" });
  }
};

let renderReferenceRangeAdmin = async (req, res) => {
  try {
    const parameterId = req.params.parameter_id;
    const parameter = await Pathology.findParameterById(parameterId);
    if (!parameter) return res.status(404).render("error", { message: "Parameter not found", title: "Error", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout" });
    const ranges = await Pathology.findReferenceRangesByParameterId(parameterId);
    const departments = await Pathology.findAllDepartments(true);
    res.render("Pathology/reference-ranges-admin", { parameter, ranges, departments, moment, user: req.user || null, title: `Reference Ranges - ${parameter.ParameterName}`, BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout" });
  } catch (error) {
    console.error(error);
    res.status(500).render("error", { message: error.message, title: "Error", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout" });
  }
};

let renderTestProfileAdmin = async (req, res) => {
  try {
    const tests = await Pathology.findMainTests();
    const departments = await Pathology.findAllDepartments(true);
    const profiles = await Pathology.findAllTestProfiles();
    const unprofiled = await Pathology.findTestsWithoutProfile();
    const allParams = await Pathology.findAllParameters({ activeOnly: false });
    
    const testsWithSuggestions = tests.map(t => {
      const suggestion = TestProfileSuggestionService.suggest(t.TestName, allParams, departments);
      const existing = profiles.find(p => p.MainTestId == t.Id);
      return { ...t, suggestedDeptId: suggestion.deptId, suggestedSpecimen: suggestion.specimen, profile: existing || null };
    });
    
    res.render("Pathology/test-profile-admin", {
      tests: testsWithSuggestions, departments, profiles, unprofiled: unprofiled || [],
      moment, user: req.user || null, title: "Test Profile Master", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout"
    });
  } catch (error) {
    console.error(error);
    res.status(500).render("error", { message: error.message, title: "Error", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout" });
  }
};

// ==================== SPECIMEN MASTERS VIEW ====================

let renderSpecimenMasters = async (req, res) => {
  try {
    const [specimenTypes, containerTypes, requirements, tests, departments] = await Promise.all([
      Pathology.findAllSpecimenTypes(),
      Pathology.findAllContainerTypes(),
      Pathology.findAllTestSpecimenRequirements(),
      Pathology.findMainTests(),
      Pathology.findAllDepartments(true)
    ]);
    res.render("Pathology/specimen-masters", {
      specimenTypes, containerTypes, requirements, tests, departments, moment,
      user: req.user || null, title: "Specimen Master Configuration",
      BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout"
    });
  } catch (error) {
    console.error(error);
    res.status(500).render("error", { message: error.message, title: "Error", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout" });
  }
};
// ==================== SPECIMEN DASHBOARD & ACTIONS ====================

let renderSpecimenList = async (req, res) => {
  try {
    const today = moment().format('YYYY-MM-DD');
    const dateFrom = req.query.date_from || today;
    const dateTo = req.query.date_to || today;
    const status = req.query.status || 'all';
    const search = req.query.search || '';
    
    let specimens = await Pathology.findSpecimensByFilter(dateFrom, dateTo, status, search);
    const stats = await Pathology.findSpecimenStats(dateFrom, dateTo);
    
    res.render("Pathology/specimen-list", {
      specimens, stats, dateFrom, dateTo, filterStatus: status, search,
      moment, user: req.user || null, title: "Specimen Dashboard",
      BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout"
    });
  } catch (error) {
    console.error(error);
    res.status(500).render("error", { message: error.message, title: "Error", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout" });
  }
};

let renderSpecimenAction = async (req, res) => {
  try {
    const ptrId = req.query.ptr;
    if (!ptrId) return res.redirect('/pathology/specimens?toast=' + encodeURIComponent('No patient test selected') + '&type=error');
    const detail = await Pathology.findSpecimenDetail(ptrId);
    if (!detail) return res.redirect('/pathology/specimens?toast=' + encodeURIComponent('Patient test not found') + '&type=error');
    const auditLog = detail.SpecimenId ? await Pathology.findSpecimenAuditLog(detail.SpecimenId) : [];
    
    res.render("Pathology/specimen-action", {
      detail, auditLog, moment, user: req.user || null,
      title: "Accept / Reject Specimen", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout"
    });
  } catch (error) {
    console.error(error);
    res.status(500).render("error", { message: error.message, title: "Error", BRAND_NAME: process.env.BRAND_NAME, layout: "loggedInLayout" });
  }
};

// ==================== SPECIMEN ACCEPT / REJECT (JSON API) ====================

let acceptSpecimen = async (req, res) => {
  try {
    const { specimenId, patientTestRefferenceId, qualityCheckNotes } = req.body;
    const userId = req.user?.Id;
    const role = getUserRole(req) || 'technician';
    if (!userId) return res.status(401).json({ success: false, message: "Authentication required" });

    let targetSpecimenId = specimenId ? parseInt(specimenId, 10) : null;
    if (!targetSpecimenId && patientTestRefferenceId) {
      // FIX: if registration never created the specimen row, create it now
      // instead of failing with "Specimen not found".
      const specimen = await SpecimenService.ensureSpecimen({
        patientTestRefferenceId: parseInt(patientTestRefferenceId, 10), userId, ...getClientInfo(req)
      });
      targetSpecimenId = specimen && specimen.Id;
    }
    if (!targetSpecimenId) return res.status(404).json({ success: false, message: "Specimen not found" });

    const result = await SpecimenService.accept({ specimenId: targetSpecimenId, userId, role, qualityCheckNotes, ...getClientInfo(req) });
    res.json({
      success: true,
      message: "Specimen accepted successfully",
      data: result,
      redirect: result.reportId ? `/pathology/view/entry/${result.reportId}` : null
    });
  } catch (error) {
    console.error(error);
    res.status(400).json({ success: false, message: error.message });
  }
};

/** NEW: fresh sample after a rejection. */
let recollectSpecimen = async (req, res) => {
  try {
    const userId = req.user?.Id;
    if (!userId) return res.status(401).json({ success: false, message: "Authentication required" });
    const result = await SpecimenService.recollect({ specimenId: parseInt(req.body.specimenId, 10), userId, ...getClientInfo(req) });
    res.json({ success: true, message: `New specimen ${result.Barcode} created`, data: result });
  } catch (error) {
    console.error(error);
    res.status(400).json({ success: false, message: error.message });
  }
};

/** NEW: retry report creation for an accepted specimen (e.g. parameters were mapped later). */
let createReportForSpecimen = async (req, res) => {
  try {
    const userId = req.user?.Id;
    if (!userId) return res.status(401).json({ success: false, message: "Authentication required" });
    const ptrId = parseInt(req.body.patientTestRefferenceId, 10);
    const report = await SpecimenService.createReportIfMissing({ patientTestRefferenceId: ptrId, userId });
    if (!report) return res.status(400).json({ success: false, message: "This test is not configured for pathology." });
    const id = report.ReportId || report.Id;
    res.json({ success: true, message: "Report ready", data: { reportId: id }, redirect: `/pathology/view/entry/${id}` });
  } catch (error) {
    console.error(error);
    res.status(400).json({ success: false, message: error.message });
  }
};

// ==================== BRIDGE: PATIENT DETAIL -> PATHOLOGY ====================

/**
 * Single entry point from the patient-details "Report" button.
 * Resolves the PatientTestRefference (from ?ptr, or ?patientId + ?testId) and
 * sends the user to the right screen for where this test currently is:
 *   - no report yet            -> specimen accept/reject screen (specimen-first)
 *   - report in draft/rejected -> result entry
 *   - report completed/…       -> verification screen
 * Keeps the specimen-first flow intact: a report is only created after the
 * specimen is accepted, which the action screen drives.
 */
let goToPathology = async (req, res) => {
  const patientId = req.query.patientId ? parseInt(req.query.patientId, 10) : null;
  const testId = req.query.testId ? parseInt(req.query.testId, 10) : null;
  const backUrl = patientId
    ? `/patient/getPatientDetail?patientId=${patientId}`
    : '/pathology/specimens';
  const bounce = (msg, type = 'error') =>
    res.redirect(backUrl + (backUrl.includes('?') ? '&' : '?') +
      'toast=' + encodeURIComponent(msg) + '&type=' + type);

  try {
    let ptrId = req.query.ptr ? parseInt(req.query.ptr, 10) : null;
    if (!ptrId && patientId && testId) {
      const ref = await Pathology.findPtrByPatientAndTest(patientId, testId);
      if (ref) ptrId = ref.PatientTestRefferenceId;
    }
    if (!ptrId) return bounce('This test is not set up for pathology.');

    const detail = await Pathology.findSpecimenDetail(ptrId);
    if (!detail) return bounce('Patient test not found.');

    if (detail.ReportId) {
      const st = (detail.ReportStatus || '').toString().toLowerCase();
      if (['draft', 'rejected'].includes(st)) {
        return res.redirect('/pathology/view/entry/' + detail.ReportId);
      }
      return res.redirect('/pathology/view/verify/' + detail.ReportId);
    }

    // No report yet -> accept the specimen first (report is created on accept).
    return res.redirect('/pathology/specimens/action?ptr=' + ptrId);
  } catch (error) {
    console.error(error);
    return bounce(error.message || 'Could not open the pathology report.');
  }
};

let rejectSpecimen = async (req, res) => {
  try {
    const { specimenId, reason, reasonCategory } = req.body;
    const userId = req.user?.Id;
    const role = getUserRole(req) || 'technician';
    
    if (!userId) return res.status(401).json({ success: false, message: "Authentication required" });
    if (!specimenId) return res.status(400).json({ success: false, message: "Specimen ID required" });
    if (!reason) return res.status(400).json({ success: false, message: "Rejection reason required" });
    
    const result = await SpecimenService.reject({
      specimenId, reason, reasonCategory: reasonCategory || 'other',
      userId, role, ...getClientInfo(req)
    });
    
    res.json({ success: true, message: "Specimen rejected", data: result });
  } catch (error) {
    console.error(error);
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  // Departments
  getDepartments, getDepartmentById, createDepartment, updateDepartment, deleteDepartment,
  // Parameters
  getParameters, getParameterById, createParameter, updateParameter, deleteParameter, bulkImportParameters,
  // Test Parameter Mapping
  getTestParameters, assignTestParameter, removeTestParameter, updateTestParameterOrder,
  // Reference Ranges
  getReferenceRanges, getReferenceRangesByParameter, createReferenceRange, updateReferenceRange, deleteReferenceRange,
  // Test Profile
  getTestProfile, createOrUpdateTestProfile,
  // Specimen Masters
  getSpecimenMasters, createSpecimenType, createContainerType, createTestSpecimenRequirement,
  // Reports API
  createReport, getReport, loadReportForEntry, saveResults,
  // Workflow
  completeReport, verifyReport, rejectReport, approveReport, deliverReport,
  // PDF & Audit
  generatePDF, getAuditTrail,
  // Queues
  getDepartmentQueue, getDashboard, getAllQueues,
  // Views
  renderReportEntry, renderReportVerify, renderReportApprove, renderReportFinal, renderQueueDashboard,
  renderDepartmentAdmin, renderParameterAdmin, renderTestMappingAdmin, renderReferenceRangeAdmin, renderTestProfileAdmin,
  renderSpecimenMasters, renderSpecimenList, renderSpecimenAction,
  // Specimen Actions
  acceptSpecimen, rejectSpecimen, recollectSpecimen, createReportForSpecimen,
  // Bridge
  goToPathology
};
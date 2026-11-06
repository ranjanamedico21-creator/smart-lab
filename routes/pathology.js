const express = require("express");
const router = express.Router();
const PathologyController = require("../controllers/PathologyController");
const { departmentValidators, parameterValidators, rangeValidators, reportValidators, specimenValidators } = require("../validators/pathologyValidators");
const { requireReportAction, requireRole } = require("../middleware/pathologyAuth");

// ==================== DEPARTMENTS ====================
router.get("/departments", PathologyController.getDepartments);
router.get("/departments/:id", PathologyController.getDepartmentById);
router.post("/departments", departmentValidators.create, PathologyController.createDepartment);
router.put("/departments/:id", departmentValidators.update, PathologyController.updateDepartment);
router.delete("/departments/:id", PathologyController.deleteDepartment);

// ==================== PARAMETERS ====================
router.get("/parameters", PathologyController.getParameters);
router.get("/parameters/:id", PathologyController.getParameterById);
router.post("/parameters", parameterValidators.create, PathologyController.createParameter);
router.put("/parameters/:id", parameterValidators.update, PathologyController.updateParameter);
router.delete("/parameters/:id", PathologyController.deleteParameter);
router.post("/parameters/bulk-import", parameterValidators.bulkImport, PathologyController.bulkImportParameters);

// ==================== TEST PROFILE ====================
router.get("/test-profile/:test_id", PathologyController.getTestProfile);
router.post("/test-profile", PathologyController.createOrUpdateTestProfile);

// ==================== TEST PARAMETER MAPPING ====================
router.get("/test-parameters", PathologyController.getTestParameters);
router.post("/test-parameters", parameterValidators.mapping, PathologyController.assignTestParameter);
router.put("/test-parameters/order", PathologyController.updateTestParameterOrder);
router.delete("/test-parameters", PathologyController.removeTestParameter);

// ==================== REFERENCE RANGES ====================
router.get("/reference-ranges", PathologyController.getReferenceRanges);
router.post("/reference-ranges", rangeValidators.create, PathologyController.createReferenceRange);
router.put("/reference-ranges/:id", rangeValidators.update, PathologyController.updateReferenceRange);
router.delete("/reference-ranges/:id", PathologyController.deleteReferenceRange);
// FIX: Kept original route for backward compatibility
router.get("/reference-ranges/parameter/:parameter_id", PathologyController.renderReferenceRangeAdmin);

// ==================== SPECIMEN MASTERS ====================
router.get("/specimen-masters", requireRole('master:view'), PathologyController.getSpecimenMasters);
router.post("/specimen-types", requireRole('master:view'), PathologyController.createSpecimenType);
router.post("/container-types", requireRole('master:view'), PathologyController.createContainerType);
router.post("/test-specimen-requirements", requireRole('master:view'), specimenValidators.requirement.create, PathologyController.createTestSpecimenRequirement);

// ==================== REPORTS - API ====================
router.post("/reports", reportValidators.create, PathologyController.createReport);
router.get("/reports/:id", PathologyController.getReport);
router.get("/reports/:id/entry", PathologyController.loadReportForEntry);
router.post("/reports/:id/results", reportValidators.saveResults, PathologyController.saveResults);
router.post("/reports/:id/complete", requireReportAction("complete"), PathologyController.completeReport);
router.post("/reports/:id/verify", requireReportAction("verify"), PathologyController.verifyReport);
router.post("/reports/:id/reject", requireReportAction("reject"), PathologyController.rejectReport);
router.post("/reports/:id/approve", requireReportAction("approve"), PathologyController.approveReport);
router.post("/reports/:id/deliver", requireReportAction("deliver"), PathologyController.deliverReport);
router.get("/reports/:id/pdf", PathologyController.generatePDF);
router.get("/reports/:id/audit", PathologyController.getAuditTrail);

// ==================== QUEUES - API ====================
router.get("/queues/:department_id", PathologyController.getDepartmentQueue);
router.get("/dashboard", PathologyController.getDashboard);
router.get("/queues-all", PathologyController.getAllQueues);

// ==================== VIEWS - RENDERING ====================
router.get("/view/entry/:id", PathologyController.renderReportEntry);
router.get("/view/verify/:id", PathologyController.renderReportVerify);
router.get("/view/approve/:id", PathologyController.renderReportApprove);
router.get("/view/final/:id", PathologyController.renderReportFinal);
router.get("/view/queues", PathologyController.renderQueueDashboard);

// ==================== ADMIN VIEWS ====================
router.get("/admin/departments", PathologyController.renderDepartmentAdmin);
router.get("/admin/parameters", PathologyController.renderParameterAdmin);
router.get("/admin/test-mapping", PathologyController.renderTestMappingAdmin);
router.get("/admin/test-profiles", PathologyController.renderTestProfileAdmin);
router.get("/admin/reference-ranges/:parameter_id", PathologyController.renderReferenceRangeAdmin);
router.get("/admin/specimen-masters", PathologyController.renderSpecimenMasters);

// ==================== BRIDGE (patient detail -> pathology) ====================
// Single entry point for the "Report" button on the patient-details page.
router.get("/go", PathologyController.goToPathology);

// ==================== SPECIMEN WORKFLOW ====================
router.get("/specimens", PathologyController.renderSpecimenList);
router.get("/specimens/action", PathologyController.renderSpecimenAction);
router.post("/specimens/accept", PathologyController.acceptSpecimen);
router.post("/specimens/reject", requireRole('specimen:reject'), specimenValidators.reject, PathologyController.rejectSpecimen);
// FIX: the controller exposed these two but the router never mounted them,
// so the recollect / retry-report buttons on the action screen 404'd.
router.post("/specimens/recollect", PathologyController.recollectSpecimen);
router.post("/specimens/create-report", PathologyController.createReportForSpecimen);

module.exports = router;
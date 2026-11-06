const Pathology = require("../models/Pathology");
const DepartmentResolverService = require("./DepartmentResolverService");
const moment = require("moment");

/**
 * ReportCreationService
 *
 * HARDENED 2026-11-05 (double-submit / concurrency):
 *   1. Report numbers no longer come from COUNT(*)+1. That scheme handed the
 *      same number to two simultaneous creations — the cause of the two
 *      "LAB-2026-000006" reports. Numbers now come from an atomic sequence
 *      (Pathology.getNextReportSequence), so every report gets a distinct one.
 *   2. The whole "does a report already exist? no -> create it" section runs
 *      inside a per-PatientTestRefference named lock, so two specimen-accept
 *      clicks can't each create a report for the same test. A caller that finds
 *      a report already there returns it instead of throwing.
 */
class ReportCreationService {
  static async create({ patientTestRefferenceId, testId, createdBy, specimenId = null }) {
    const dept = await DepartmentResolverService.resolve(testId);
    if (!dept.IsPathology) {
      throw new Error("This test is not configured for pathology.");
    }

    // NABL COMPLIANCE: specimen must be accepted before a report can exist.
    let specimen = specimenId
      ? await Pathology.findSpecimenById(specimenId)
      : await Pathology.findSpecimenByPTR(patientTestRefferenceId);

    if (!specimen || specimen.Status !== 'accepted') {
      throw new Error("Specimen not accepted. Cannot create report.");
    }

    // Serialise creation for this patient-test so concurrent clicks can't make
    // two reports. Lock name is scoped to the PTR; 10s timeout.
    const lockName = `patho_report_ptr_${patientTestRefferenceId}`;
    return Pathology.withNamedLock(lockName, 10, async () => {
      // Re-check inside the lock — the other click may have just created it.
      const existing = await Pathology.findReportByPatientTestReferenceId(patientTestRefferenceId);
      if (existing) {
        return {
          ReportId: existing.Id,
          ReportNumber: existing.ReportNumber,
          DepartmentId: existing.DepartmentId,
          DepartmentName: dept.DepartmentName,
          ParametersCount: null,
          alreadyExisted: true
        };
      }

      const reportNumber = await this.nextReportNumber();

      const reportId = await Pathology.createReport({
        PatientTestRefferenceId: patientTestRefferenceId,
        SpecimenId: specimenId || specimen.Id,
        ReportNumber: reportNumber,
        DepartmentId: dept.DepartmentId,
        Status: "draft",
        ReportType: "routine",
        Urgency: "normal",
        CreatedBy: createdBy,
        SpecimenDetails: `${specimen.SpecimenType} (${specimen.ContainerType})`
      });

      // Auto-create result rows (fall back to no-department mapping if needed).
      let params = await Pathology.findTestParameters(testId, dept.DepartmentId);
      if (!params.length && dept.DepartmentId) {
        params = await Pathology.findTestParameters(testId, null);
      }
      if (!params.length) {
        throw new Error(`No parameters mapped for TestId=${testId}.`);
      }

      for (const p of params) {
        await Pathology.createReportResult({
          ReportId: reportId,
          ParameterId: p.ParameterId,
          Unit: p.Unit,
          Method: p.Method,
          IsCalculated: p.IsCalculated,
          ResultValue: p.DefaultValue || ''
        });
      }

      await Pathology.createAuditLog({
        ReportId: reportId,
        Action: 'created',
        StatusTo: 'draft',
        PerformedBy: createdBy,
        PerformedByRole: 'technician',
        Details: { autoCreatedResults: params.length, departmentId: dept.DepartmentId, testId, specimenId: specimen.Id }
      });

      await Pathology.createReportVerification({
        ReportId: reportId,
        VerificationLevel: 1,
        Action: 'created',
        StatusTo: 'draft',
        PerformedBy: createdBy,
        PerformedByRole: 'system'
      });

      return {
        ReportId: reportId,
        ReportNumber: reportNumber,
        DepartmentId: dept.DepartmentId,
        DepartmentName: dept.DepartmentName,
        ParametersCount: params.length
      };
    });
  }

  /** LAB-<year>-<6-digit atomic sequence>. One sequence row per year. */
  static async nextReportNumber() {
    const year = moment().format("YYYY");
    const seq = await Pathology.getNextReportSequence(`report:${year}`);
    return `LAB-${year}-${String(seq).padStart(6, '0')}`;
  }

  /** Kept for backward compatibility; now backed by the atomic sequence. */
  static async getNextSequence() {
    const year = moment().format("YYYY");
    const seq = await Pathology.getNextReportSequence(`report:${year}`);
    return String(seq).padStart(6, '0');
  }
}

module.exports = ReportCreationService;
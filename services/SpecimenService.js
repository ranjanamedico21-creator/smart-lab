const Pathology = require("../models/Pathology");

/**
 * SpecimenService
 *
 * Specimen lifecycle: collected -> accepted / rejected, plus recollection and
 * report auto-creation on acceptance.
 *
 * HARDENED 2026-11-05 (double-submit / concurrency):
 *   - ensureSpecimen and accept run their "find-or-create" sections inside a
 *     per-PatientTestRefference named lock, so two accept clicks can't create
 *     two specimens or two reports.
 *   - accept is idempotent: a specimen already 'accepted' is not transitioned
 *     again (no duplicate audit row); the report is still ensured and its id
 *     returned, so a second click lands the user on the same report.
 *   - accept now returns { specimenId, status, reportId } — the controller uses
 *     reportId to redirect straight to result entry.
 */
class SpecimenService {
  /**
   * Auto-create specimen during patient registration (ZERO hardcoding —
   * requirement comes from Patho_TestSpecimenRequirement).
   */
  static async autoCreateFromBooking({ patientTestRefferenceId, testId, createdBy, ipAddress, userAgent }) {
    const requirement = await Pathology.findTestSpecimenRequirement(testId);
    if (!requirement) {
      throw new Error(`No specimen requirement configured for TestId=${testId}. Configure in Test Specimen Requirement Master.`);
    }

    const specimenId = await Pathology.createSpecimen({
      PatientTestRefferenceId: patientTestRefferenceId,
      SpecimenTypeId: requirement.SpecimenTypeId,
      SpecimenType: requirement.SpecimenTypeName,
      ContainerTypeId: requirement.ContainerTypeId,
      ContainerType: requirement.ContainerName,
      Barcode: this.makeBarcode(patientTestRefferenceId),
      Status: 'collected',
      CollectedAt: new Date(),
      ReceivedAt: new Date(),
      AcceptedBy: null,
      AcceptedAt: null
    });

    await Pathology.createSpecimenAuditLog({
      SpecimenId: specimenId,
      Action: 'collected',
      StatusFrom: null,
      StatusTo: 'collected',
      PerformedBy: createdBy,
      PerformedByRole: 'registration',
      IpAddress: ipAddress,
      UserAgent: userAgent,
      Remarks: `Auto-created from booking. Requirement: ${requirement.SpecimenTypeName} / ${requirement.ContainerName}`
    });

    return {
      Id: specimenId,
      SpecimenId: specimenId,
      SpecimenType: requirement.SpecimenTypeName,
      ContainerType: requirement.ContainerName,
      Requirement: requirement
    };
  }

  /**
   * Return the existing specimen for a PatientTestRefference, or create one now
   * (registration didn't). Idempotent under concurrent calls via a named lock.
   */
  static async ensureSpecimen({ patientTestRefferenceId, userId, ipAddress, userAgent }) {
    const ptrId = parseInt(patientTestRefferenceId, 10);
    const lockName = `patho_specimen_ptr_${ptrId}`;
    return Pathology.withNamedLock(lockName, 10, async () => {
      const existing = await Pathology.findSpecimenByPTR(ptrId);
      if (existing) return existing;

      const ptr = await Pathology.findPatientTestReferenceById(ptrId);
      if (!ptr) throw new Error("Patient test reference not found.");

      return this.autoCreateFromBooking({
        patientTestRefferenceId: ptrId,
        testId: ptr.TestId,
        createdBy: userId,
        ipAddress,
        userAgent
      });
    });
  }

  /**
   * Transition specimen status with audit logging and a legal-transition guard.
   */
  static async transitionStatus({ specimenId, newStatus, performedBy, role, remarks, ipAddress, userAgent, extraData = {} }) {
    const specimen = await Pathology.findSpecimenById(specimenId);
    if (!specimen) throw new Error("Specimen not found");

    const oldStatus = specimen.Status;
    const allowedTransitions = {
      collected: ['received', 'accepted', 'rejected'],
      received: ['accepted', 'rejected'],
      accepted: ['discarded'],
      rejected: ['collected']
    };

    if (oldStatus !== newStatus && allowedTransitions[oldStatus] && !allowedTransitions[oldStatus].includes(newStatus)) {
      throw new Error(`Invalid transition: ${oldStatus} → ${newStatus}`);
    }

    await Pathology.updateSpecimenStatus(specimenId, newStatus, { userId: performedBy, ...extraData });

    await Pathology.createSpecimenAuditLog({
      SpecimenId: specimenId,
      Action: newStatus,
      StatusFrom: oldStatus,
      StatusTo: newStatus,
      PerformedBy: performedBy,
      PerformedByRole: role,
      IpAddress: ipAddress,
      UserAgent: userAgent,
      Remarks: remarks
    });

    return { specimenId, oldStatus, newStatus };
  }

  /**
   * Accept a specimen and ensure its report exists. Idempotent and race-safe.
   * Returns { specimenId, status, reportId }.
   */
  static async accept({ specimenId, userId, role, qualityCheckNotes, ipAddress, userAgent }) {
    const specimen = await Pathology.findSpecimenById(specimenId);
    if (!specimen) throw new Error("Specimen not found");
    if (specimen.Status === 'rejected') {
      throw new Error("This specimen was rejected. Recollect a fresh sample before accepting.");
    }

    // Only transition if not already accepted — a second click must not add a
    // duplicate 'accepted' audit row.
    if (specimen.Status !== 'accepted') {
      await this.transitionStatus({
        specimenId, newStatus: 'accepted', performedBy: userId, role,
        remarks: qualityCheckNotes || 'Specimen accepted after quality check',
        ipAddress, userAgent, extraData: { qualityCheckNotes }
      });
    }

    const reportId = await this.ensureReport({ specimen, userId });
    return { specimenId, status: 'accepted', reportId };
  }

  /**
   * Create the report for an accepted specimen if it isn't there yet. Returns
   * the report id, or null if the test isn't configured for pathology.
   * ReportCreationService.create is itself locked + idempotent.
   */
  static async ensureReport({ specimen, userId }) {
    const existing = await Pathology.findReportByPatientTestReferenceId(specimen.PatientTestRefferenceId);
    if (existing) return existing.Id;

    const ptr = await Pathology.findPatientTestReferenceById(specimen.PatientTestRefferenceId);
    if (!ptr) return null;

    const DepartmentResolverService = require("./DepartmentResolverService");
    const dept = await DepartmentResolverService.resolve(ptr.TestId);
    if (!dept.IsPathology) return null;

    const ReportCreationService = require("./ReportCreationService");
    try {
      const result = await ReportCreationService.create({
        patientTestRefferenceId: specimen.PatientTestRefferenceId,
        testId: ptr.TestId,
        createdBy: userId,
        specimenId: specimen.Id
      });
      return result.ReportId;
    } catch (err) {
      console.error('Report auto-creation failed after acceptance:', err);
      throw new Error('Specimen accepted but report creation failed: ' + err.message);
    }
  }

  /**
   * Retry report creation for an already-accepted specimen (e.g. parameters
   * were mapped after acceptance). Returns { ReportId } or null (not pathology).
   */
  static async createReportIfMissing({ patientTestRefferenceId, userId }) {
    const specimen = await Pathology.findSpecimenByPTR(patientTestRefferenceId);
    if (!specimen || specimen.Status !== 'accepted') {
      throw new Error("Specimen is not accepted yet.");
    }
    const reportId = await this.ensureReport({ specimen, userId });
    if (!reportId) return null;
    return { ReportId: reportId };
  }

  /**
   * Fresh sample after a rejection. Creates a new 'collected' specimen linked to
   * the rejected one via RecollectedFromId, with a new barcode.
   */
  static async recollect({ specimenId, userId, ipAddress, userAgent }) {
    const old = await Pathology.findSpecimenById(specimenId);
    if (!old) throw new Error("Specimen not found");
    if (old.Status !== 'rejected') {
      throw new Error("Only a rejected specimen can be recollected.");
    }

    const lockName = `patho_specimen_ptr_${old.PatientTestRefferenceId}`;
    return Pathology.withNamedLock(lockName, 10, async () => {
      const barcode = this.makeBarcode(old.PatientTestRefferenceId);
      const newId = await Pathology.createSpecimen({
        PatientTestRefferenceId: old.PatientTestRefferenceId,
        SpecimenTypeId: old.SpecimenTypeId,
        SpecimenType: old.SpecimenType,
        ContainerTypeId: old.ContainerTypeId,
        ContainerType: old.ContainerType,
        Barcode: barcode,
        Status: 'collected',
        CollectedAt: new Date(),
        ReceivedAt: new Date()
      });
      await Pathology.updateSpecimenStatus(newId, 'collected', { recollectedFromId: specimenId });
      await Pathology.createSpecimenAuditLog({
        SpecimenId: newId,
        Action: 'collected',
        StatusFrom: null,
        StatusTo: 'collected',
        PerformedBy: userId,
        PerformedByRole: 'technician',
        IpAddress: ipAddress,
        UserAgent: userAgent,
        Remarks: `Recollected from specimen #${specimenId} (barcode ${barcode})`
      });
      return { Id: newId, Barcode: barcode, RecollectedFromId: specimenId };
    });
  }

  /** Reject a specimen. */
  static async reject({ specimenId, reason, reasonCategory, userId, role, ipAddress, userAgent }) {
    return this.transitionStatus({
      specimenId, newStatus: 'rejected', performedBy: userId, role,
      remarks: reason, ipAddress, userAgent,
      extraData: { rejectionReason: reason, rejectionReasonCategory: reasonCategory }
    });
  }

  /** Short, collision-resistant barcode. */
  static makeBarcode(ptrId) {
    const t = Date.now().toString(36).toUpperCase().slice(-6);
    const r = Math.floor(Math.random() * 46656).toString(36).toUpperCase().padStart(3, '0');
    return `SP${ptrId}-${t}${r}`;
  }
}

module.exports = SpecimenService;
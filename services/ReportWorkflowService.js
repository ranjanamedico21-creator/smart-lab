const Pathology = require("../models/Pathology");

/**
 * ReportWorkflowService
 *
 * HARDENED 2026-11-05 (double-submit / concurrency):
 *   The previous version read the report, checked its status, then updated it
 *   in three separate statements. Two requests that arrived together (a double
 *   click, two open tabs, or a POST the browser retried) both passed the check
 *   and both wrote — producing two Patho_ReportVerification rows, two audit-log
 *   rows, and a second overwrite of CompletedAt/VerifiedAt/ApprovedAt.
 *
 *   Now the status change is a single atomic conditional UPDATE
 *   (Pathology.transitionReportStatus). Exactly one concurrent caller flips the
 *   row; the rest update zero rows and are treated as idempotent no-ops. The
 *   audit and verification rows are written ONLY by the caller that actually
 *   moved the report, so the trail stays clean no matter how many clicks land.
 */
class ReportWorkflowService {
  static get TRANSITIONS() {
    return {
      // 'rejected' is allowed here so a report sent back at verify/approve can be
      // re-entered and completed again (otherwise it was a dead end: entry opened
      // but "Complete" failed with "Cannot complete from status: rejected").
      complete: { from: ['draft', 'rejected'], to: 'completed', level: 1 },
      verify:   { from: ['completed'], to: 'verified', level: 2 },
      approve:  { from: ['verified'], to: 'approved', level: 3 },
      deliver:  { from: ['approved'], to: 'delivered', level: 4 },
      reject:   { from: ['draft', 'completed', 'verified', 'approved'], to: 'rejected', level: 99 },
      amend:    { from: ['verified', 'approved', 'delivered'], to: 'draft', level: 100 }
    };
  }

  static async transition({ reportId, action, userId, role, remarks, rejectionReason, ipAddress, userAgent }) {
    const report = await Pathology.findReportById(reportId);
    if (!report) throw new Error("Report not found");

    const transition = this.TRANSITIONS[action];
    if (!transition) throw new Error(`Invalid action: ${action}`);

    const fromStatus = report.Status;

    // Idempotent short-circuit: the report is already where this action leads.
    // A second click after a successful first one lands here instead of erroring.
    if (report.Status === transition.to) {
      return { reportId, from: fromStatus, to: transition.to, alreadyDone: true };
    }

    if (!transition.from.includes(report.Status)) {
      throw new Error(`Cannot ${action} from status: ${report.Status}`);
    }

    // Guard: complete requires every required result to be filled in.
    if (action === 'complete') {
      const empty = await Pathology.getEmptyRequiredResults(reportId);
      if (empty.length) {
        throw new Error(`Missing required parameters: ${empty.map(r => r.ParameterName).join(", ")}`);
      }
    }

    // ATOMIC check-and-set. Only one concurrent caller gets changed === true.
    const { changed } = await Pathology.transitionReportStatus(
      reportId, transition.from, transition.to, userId,
      { Remarks: remarks, Reason: rejectionReason }
    );

    if (!changed) {
      // Another request won the race (or the row moved on). Re-read and treat a
      // matching final state as success so the user still gets a clean result.
      const fresh = await Pathology.findReportById(reportId);
      if (fresh && fresh.Status === transition.to) {
        return { reportId, from: fromStatus, to: transition.to, alreadyDone: true };
      }
      throw new Error(`Cannot ${action} from status: ${fresh ? fresh.Status : 'unknown'}`);
    }

    // Trail rows: written once, by the winner only.
    await Pathology.createReportVerification({
      ReportId: reportId,
      VerificationLevel: transition.level,
      Action: action,
      StatusFrom: fromStatus,
      StatusTo: transition.to,
      PerformedBy: userId,
      PerformedByRole: role,
      IpAddress: ipAddress,
      UserAgent: userAgent,
      Remarks: remarks,
      RejectionReason: rejectionReason
    });

    await Pathology.createAuditLog({
      ReportId: reportId,
      Action: action,
      StatusFrom: fromStatus,
      StatusTo: transition.to,
      PerformedBy: userId,
      PerformedByRole: role,
      IpAddress: ipAddress,
      UserAgent: userAgent,
      Details: { remarks, rejectionReason }
    });

    return { reportId, from: fromStatus, to: transition.to };
  }
}

module.exports = ReportWorkflowService;

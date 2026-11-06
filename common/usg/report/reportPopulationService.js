/**
 * common/usg/report/reportPopulationService.js
 *
 * Business logic for staging AI results into report fields and handling
 * radiologist review actions (accept/modify/reject). This is where the
 * organ/parameter -> report-template-field mapping lives (FIELD_MAP below)
 * — the only place that needs to know your existing HTML report template's
 * field naming. All DB reads/writes go through models/usgMeasurementModel.js
 * and models/usgAuditModel.js.
 *
 * Lives in common/ (not controller/) because it's called from two places:
 * the review controller (HTTP) and the AI analysis worker (background job)
 * — shared business logic, not a single request handler.
 */

const logger = require('../../../config/logger');
const measurementModel = require('../../../models/usgMeasurementModel');
const auditModel = require('../../../models/usgAuditModel');

// Maps { organ, parameter } -> the field ID used in your existing HTML report
// template. Extend this table as you wire up more templates. Keeping it
// data-driven means template changes don't require touching service logic.
const FIELD_MAP = {
  'liver.length': 'liver_size',
  'liver.echotexture': 'liver_echotexture',
  'liver.fatty_changes': 'liver_fatty_changes',
  'liver.mass': 'liver_mass',
  'liver.cyst': 'liver_cyst',
  'gall_bladder.wall_thickness': 'gb_wall_thickness',
  'gall_bladder.stone': 'gb_stone',
  'gall_bladder.sludge': 'gb_sludge',
  'gall_bladder.polyp': 'gb_polyp',
  'cbd.diameter': 'cbd_diameter',
  'pancreas.head': 'pancreas_head',
  'pancreas.body': 'pancreas_body',
  'pancreas.tail': 'pancreas_tail',
  'spleen.length': 'spleen_length',
  'right_kidney.length': 'rk_length',
  'right_kidney.width': 'rk_width',
  'right_kidney.cortical_thickness': 'rk_cortical_thickness',
  'right_kidney.hydronephrosis': 'rk_hydronephrosis',
  'right_kidney.stone': 'rk_stone',
  'left_kidney.length': 'lk_length',
  'left_kidney.width': 'lk_width',
  'left_kidney.hydronephrosis': 'lk_hydronephrosis',
  'left_kidney.stone': 'lk_stone',
  'urinary_bladder.wall_thickness': 'ub_wall_thickness',
  'urinary_bladder.residual_urine': 'ub_residual_urine',
  'prostate.volume': 'prostate_volume',
  'uterus.length': 'uterus_length',
  'uterus.width': 'uterus_width',
  'uterus.ap': 'uterus_ap',
  'endometrium.thickness': 'endometrium_thickness',
  'ovaries.volume': 'ovaries_volume',
  'gestational_sac.crl': 'crl',
  'fetal.heart_rate': 'fhr',
  'placenta.afi': 'afi',
};

/** Persists one AI analysis run (measurements + findings) as AI_SUGGESTED
 * and flips study/worklist status. Called by the AI analysis worker. */
async function saveAiResults(studyId, aiResult, providerMeta = {}) {
  await measurementModel.saveAiResults(studyId, aiResult, providerMeta);
}

/** Returns the staged report field set for the review UI, joined with FIELD_MAP */
async function getStagedReportFields(studyId) {
  const measurements = await measurementModel.findMeasurementsByStudyId(studyId);
  const latestFindings = await measurementModel.findLatestFindingsByStudyId(studyId);

  const fields = measurements.map((m) => ({
    measurementId: m.id,
    fieldId: FIELD_MAP[`${m.organ}.${m.parameter}`] || null,
    organ: m.organ,
    parameter: m.parameter,
    displayValue: formatValue(m),
    confidence: m.confidence,
    reviewStatus: m.review_status,
  })).filter((f) => f.fieldId); // drop anything without a known template field

  return { fields, findings: latestFindings };
}

function formatValue(m) {
  if (m.value_numeric != null) return `${m.value_numeric}${m.unit ? ` ${m.unit}` : ''}`;
  return m.value_text || '';
}

/** Radiologist action on one measurement — every call writes an audit log row */
async function reviewMeasurement({
  measurementId, action, newValue, userId, ipAddress,
}) {
  const old = await measurementModel.findMeasurementById(measurementId);
  if (!old) throw new Error('Measurement not found');

  const statusMap = { accept: 'ACCEPTED', modify: 'MODIFIED', reject: 'REJECTED' };
  const newStatus = statusMap[action];
  if (!newStatus) throw new Error(`Invalid action: ${action}`);

  await measurementModel.updateMeasurementReview(measurementId, {
    status: newStatus,
    reviewedValueNumeric: action === 'modify' && typeof newValue === 'number' ? newValue : null,
    reviewedValueText: action === 'modify' && typeof newValue === 'string' ? newValue : null,
    userId,
  });

  await auditModel.logAuditEvent({
    entityType: 'measurement',
    entityId: measurementId,
    action,
    oldValue: { value: old.value_numeric ?? old.value_text },
    newValue: { value: newValue ?? null },
    performedBy: userId,
    ipAddress,
  });

  logger.info(`[REPORT] Measurement ${measurementId} ${action} by user ${userId}`);
}

/** Radiologist review of the AI-drafted narrative findings (separate from
 * per-measurement review above, since findings is one text block, not a
 * per-field table). Same discipline: nothing is final until reviewed. */
async function reviewFindings({
  findingsId, action, editedText, userId, ipAddress,
}) {
  const old = await measurementModel.findFindingsById(findingsId);
  if (!old) throw new Error('Findings not found');

  const statusMap = { accept: 'ACCEPTED', modify: 'MODIFIED', reject: 'REJECTED' };
  const newStatus = statusMap[action];
  if (!newStatus) throw new Error(`Invalid action: ${action}`);

  const finalText = action === 'reject' ? null : (action === 'modify' ? editedText : old.findings_text);

  await measurementModel.updateFindingsReview(findingsId, { status: newStatus, finalText, userId });

  await auditModel.logAuditEvent({
    entityType: 'finding',
    entityId: findingsId,
    action,
    oldValue: { text: old.findings_text },
    newValue: { text: finalText },
    performedBy: userId,
    ipAddress,
  });

  logger.info(`[REPORT] Findings ${findingsId} ${action} by user ${userId}`);
}

module.exports = {
  FIELD_MAP, saveAiResults, getStagedReportFields, reviewMeasurement, reviewFindings,
};

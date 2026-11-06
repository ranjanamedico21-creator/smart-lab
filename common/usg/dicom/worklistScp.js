/**
 * common/usg/dicom/worklistScp.js
 *
 * DICOM Modality Worklist (MWL) SCP — the protocol server the CT/US/MRI
 * machine's C-FIND query hits. Lives in common/ (not controller/) because
 * it isn't triggered by an HTTP request; it's a standalone TCP listener
 * started once at boot (see the app-wiring notes at the bottom of
 * MVC-INTEGRATION-GUIDE.md). All DB access goes through
 * models/usgWorklistModel.js and models/usgAuditModel.js — this file only
 * knows DICOM protocol shapes, not SQL.
 *
 * npm install dcmjs-dimse uuid dayjs
 */

const { Server, Scp, Status } = require('dcmjs-dimse');
const { v4: uuidv4 } = require('uuid');
const dayjs = require('dayjs');
const worklistModel = require('../../../models/usgWorklistModel');
const auditModel = require('../../../models/usgAuditModel');
const config = require('../../../config/usgConfig');
const logger = require('../../../config/logger');

class WorklistScp extends Scp {
  // eslint-disable-next-line class-methods-use-this
  async cFindRequest(request, callback) {
    const remoteAet = request.getCallingAeTitle ? request.getCallingAeTitle() : 'UNKNOWN';

    if (!config.dicom.knownAETitles.includes(remoteAet)) {
      logger.warn(`[MWL] Rejecting unknown AE Title: ${remoteAet}`);
      callback([]);
      return;
    }

    try {
      const requestedModality = config.dicom.aeModalityMap[remoteAet] || null;
      const rows = await worklistModel.findQueryableToday(requestedModality);

      const responses = rows.map((row) => buildMwlDataset(row));

      await worklistModel.markSentToMachine(rows.map((r) => r.id), remoteAet);
      await auditModel.logMachineEvent({ machineAet: remoteAet, eventType: 'MWL_QUERY', detail: { matched: rows.length } });

      callback(responses);
    } catch (err) {
      logger.error(`[MWL] C-FIND handling failed: ${err.message}`);
      callback([], Status.ProcessingFailure);
    }
  }
}

function buildMwlDataset(row) {
  return {
    PatientName: row.patient_name_dicom,
    PatientID: String(row.patient_id),
    PatientBirthDate: row.patient_dob ? dayjs(row.patient_dob).format('YYYYMMDD') : '',
    PatientSex: row.patient_sex,
    AccessionNumber: row.accession_number,
    StudyInstanceUID: row.study_instance_uid,
    ReferringPhysicianName: row.doctor_name || '',
    RequestedProcedureDescription: row.study_description,
    RequestedProcedureID: row.procedure_code || '',
    ScheduledProcedureStepSequence: [
      {
        Modality: row.modality || 'US',
        ScheduledStationAETitle: config.dicom.aeTitle,
        ScheduledProcedureStepStartDate: dayjs(row.scheduled_date).format('YYYYMMDD'),
        ScheduledProcedureStepStartTime: (row.scheduled_time || '000000').replace(/:/g, ''),
        ScheduledPerformingPhysicianName: row.doctor_name || '',
        ScheduledProcedureStepDescription: row.study_description,
        ScheduledProcedureStepID: uuidv4().slice(0, 16),
        ScheduledProcedureStepStatus: 'SCHEDULED',
      },
    ],
  };
}

function startWorklistServer() {
  const server = new Server(WorklistScp);
  server.listen(config.dicom.mwlPort, {
    ...(config.dicom.tls.enabled
      ? { securityOptions: { key: config.dicom.tls.keyPath, cert: config.dicom.tls.certPath, ca: config.dicom.tls.caPath } }
      : {}),
  });
  logger.info(`[MWL] Worklist SCP listening on port ${config.dicom.mwlPort} as AE "${config.dicom.aeTitle}"`);
  return server;
}

module.exports = { startWorklistServer, WorklistScp };

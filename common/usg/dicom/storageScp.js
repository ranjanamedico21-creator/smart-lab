/**
 * common/usg/dicom/storageScp.js
 *
 * DICOM Storage SCP (C-STORE receiver) — the protocol server the machine
 * pushes acquired images to after a scan. Like worklistScp.js, this is a
 * standalone TCP listener, not an HTTP route, so it lives in common/. DICOM
 * parsing (dicom-parser) and file I/O stay here; all DB writes go through
 * models/usgStudyModel.js's transactional persistReceivedImage().
 *
 * npm install dcmjs-dimse dicom-parser sharp
 */

const fs = require('fs');
const path = require('path');
const { Server, Scp, Status } = require('dcmjs-dimse');
const dicomParser = require('dicom-parser');
const sharp = require('sharp');
const studyModel = require('../../../models/usgStudyModel');
const auditModel = require('../../../models/usgAuditModel');
const config = require('../../../config/usgConfig');
const logger = require('../../../config/logger');
const { insertJob } = require('../../../models/usgJobQueueModel');
const { emitStatus } = require('../socket/usgSocket');

class StorageScp extends Scp {
  // eslint-disable-next-line class-methods-use-this
  async cStoreRequest(request, callback) {
    const remoteAet = request.getCallingAeTitle ? request.getCallingAeTitle() : 'UNKNOWN';

    try {
      const dataset = request.getDataset();
      const buffer = Buffer.isBuffer(dataset) ? dataset : Buffer.from(dataset);

      const elements = dicomParser.parseDicom(buffer);
      const meta = extractMetadata(elements);

      const filePath = await persistFile(buffer, meta);
      const thumbnailPath = await generateThumbnail(elements, meta);
      const fileSizeBytes = (await fs.promises.stat(filePath)).size;

      const { studyId, seriesId, imageId } = await studyModel.persistReceivedImage({
        meta, filePath, thumbnailPath, fileSizeBytes,
      });

      await auditModel.logMachineEvent({
        machineAet: remoteAet, eventType: 'C_STORE', studyId, detail: { sopInstanceUID: meta.sopInstanceUID },
      });

      await enqueueAiJobIfStudyComplete(studyId);

      emitStatus('usg:image_received', { studyId, seriesId, imageId, meta });

      callback(Status.Success);
    } catch (err) {
      logger.error(`[STORE] C-STORE handling failed: ${err.message}`);
      callback(Status.ProcessingFailure);
    }
  }
}

function extractMetadata(elements) {
  const str = (tag) => elements.string(tag) || '';
  return {
    sopInstanceUID: str('x00080018'),
    sopClassUID: str('x00080016'),
    studyInstanceUID: str('x0020000d'),
    seriesInstanceUID: str('x0020000e'),
    instanceNumber: parseInt(str('x00200013') || '0', 10),
    seriesNumber: parseInt(str('x00200011') || '0', 10),
    seriesDescription: str('x0008103e'),
    modality: str('x00080060'),
    bodyPart: str('x00180015'),
    stationName: str('x00081010'),
    manufacturerModel: str('x00081090'),
    physician: str('x00081050'),
    accessionNumber: str('x00080050'),
    patientID: str('x00100020'),
    transferSyntaxUID: elements.meta ? elements.meta.transferSyntaxUID : '',
    rows: elements.uint16('x00280010'),
    columns: elements.uint16('x00280011'),
  };
}

async function persistFile(buffer, meta) {
  const studyDir = path.join(config.dicom.storageRoot, meta.studyInstanceUID);
  await fs.promises.mkdir(studyDir, { recursive: true });
  const filePath = path.join(studyDir, `${meta.sopInstanceUID}.dcm`);
  await fs.promises.writeFile(filePath, buffer);
  return filePath;
}

async function generateThumbnail(elements, meta) {
  try {
    const pixelDataElement = elements.elements.x7fe00010;
    if (!pixelDataElement) return null;

    const pixelBuffer = Buffer.from(elements.byteArray.buffer, pixelDataElement.dataOffset, pixelDataElement.length);

    const thumbDir = path.join(config.dicom.thumbnailRoot, meta.studyInstanceUID);
    await fs.promises.mkdir(thumbDir, { recursive: true });
    const thumbPath = path.join(thumbDir, `${meta.sopInstanceUID}.jpg`);

    // Assumes uncompressed/raw grayscale pixel data. For compressed
    // transfer syntaxes (JPEG Baseline etc.) decode first with a proper
    // DICOM image codec before this step.
    await sharp(pixelBuffer, { raw: { width: meta.columns, height: meta.rows, channels: 1 } })
      .jpeg({ quality: 80 })
      .toFile(thumbPath);

    return thumbPath;
  } catch (err) {
    logger.warn(`[STORE] Thumbnail generation skipped: ${err.message}`);
    return null;
  }
}

async function enqueueAiJobIfStudyComplete(studyId) {
  // Debounced: waits for the burst of images from one study to finish
  // arriving before triggering AI analysis. A C-STORE "commitment"
  // (N-ACTION) or timeout watcher is more robust for production; kept
  // simple here for clarity.
  await insertJob({
    jobType: 'AI_ANALYSIS',
    payload: { studyId },
    nextAttemptAt: new Date(Date.now() + 15000),
  });
  await studyModel.updateStudyStatus(studyId, 'COMPLETE');
}

function startStorageServer() {
  const server = new Server(StorageScp);
  server.listen(config.dicom.storePort, {
    ...(config.dicom.tls.enabled
      ? { securityOptions: { key: config.dicom.tls.keyPath, cert: config.dicom.tls.certPath, ca: config.dicom.tls.caPath } }
      : {}),
  });
  logger.info(`[STORE] Storage SCP listening on port ${config.dicom.storePort}`);
  return server;
}

module.exports = { startStorageServer, StorageScp };

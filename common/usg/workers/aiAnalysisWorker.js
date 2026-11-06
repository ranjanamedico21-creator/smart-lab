/**
 * common/usg/workers/aiAnalysisWorker.js
 * Polls usg_job_queue (via models/usgJobQueueModel.js) for AI_ANALYSIS
 * jobs and runs them through the active AI provider, then hands results to
 * reportPopulationService. Started once at boot alongside the DICOM SCP
 * servers — see the wiring notes in MVC-INTEGRATION-GUIDE.md.
 */

const config = require('../../../config/usgConfig');
const logger = require('../../../config/logger');
const jobQueueModel = require('../../../models/usgJobQueueModel');
const studyModel = require('../../../models/usgStudyModel');
const worklistModel = require('../../../models/usgWorklistModel');
const { getActiveProvider } = require('../ai/aiProviderFactory');
const { saveAiResults } = require('../report/reportPopulationService');
const { emitStatus } = require('../socket/usgSocket');
const { failJobWithBackoff } = require('./queueRetryHelper');

async function processOneJob() {
  const job = await jobQueueModel.claimNextJob('AI_ANALYSIS');
  if (!job) return false;

  const { studyId } = JSON.parse(job.payload_json);
  logger.info(`[WORKER] Processing AI_ANALYSIS job ${job.id} for study ${studyId}`);

  try {
    await studyModel.updateStudyStatus(studyId, 'AI_PROCESSING');
    emitStatus('usg:ai_processing', { studyId });

    const provider = getActiveProvider();
    const available = await provider.isAvailable();

    if (!available) {
      // Graceful fallback if AI is unavailable — never block the clinical workflow.
      await studyModel.updateStudyStatus(studyId, 'ERROR');
      const study = await studyModel.findStudyById(studyId);
      if (study?.worklist_id) await worklistModel.updateStatus(study.worklist_id, 'AI_UNAVAILABLE');
      emitStatus('usg:ai_unavailable', { studyId, reason: 'Provider unreachable — falling back to manual entry' });
      await jobQueueModel.completeJob(job.id); // not a retryable failure; it's a known fallback state
      return true;
    }

    const study = await loadStudyForAnalysis(studyId);

    if (!config.ai.analysisEnabledModalities.includes(study.modality)) {
      await studyModel.updateStudyStatus(studyId, 'AI_COMPLETED');
      emitStatus('usg:ai_skipped', { studyId, reason: `Analysis disabled for modality ${study.modality}` });
      await jobQueueModel.completeJob(job.id);
      return true;
    }

    const result = await provider.analyzeStudy(study);

    await saveAiResults(studyId, result, { provider: config.ai.activeProvider, model: config.google.vertexModel });

    emitStatus('usg:ai_completed', { studyId, measurementCount: result.measurements.length });
    await jobQueueModel.completeJob(job.id);
    return true;
  } catch (err) {
    logger.error(`[WORKER] Job ${job.id} failed: ${err.message}`);
    await failJobWithBackoff(job, err);
    return true;
  }
}

async function loadStudyForAnalysis(studyId) {
  const study = await studyModel.findStudyWithWorklistContext(studyId);
  const images = await studyModel.findImagesByStudyId(studyId);

  const modality = study?.modality || 'US'; // works for US/CT/MR — set from DICOM metadata at C-STORE time

  if (!config.ai.analysisEnabledModalities.includes(modality)) {
    logger.info(`[WORKER] Modality ${modality} not enabled for AI analysis (study ${studyId}); skipping`);
  }

  return {
    studyId,
    modality,
    images: images.map((i) => ({
      filePath: i.file_path,
      thumbnailOrJpegPath: i.thumbnail_path || i.file_path,
    })),
    patientContext: {
      age: study?.patient_dob ? ageFromDob(study.patient_dob) : null,
      sex: study?.patient_sex,
      indication: study?.indication,
    },
  };
}

function ageFromDob(dob) {
  const diff = Date.now() - new Date(dob).getTime();
  return Math.floor(diff / (365.25 * 24 * 3600 * 1000));
}

function startWorker() {
  const loop = async () => {
    try {
      let processed = true;
      while (processed) {
        // eslint-disable-next-line no-await-in-loop
        processed = await processOneJob();
      }
    } catch (err) {
      logger.error(`[WORKER] Poll loop error: ${err.message}`);
    } finally {
      setTimeout(loop, config.queue.pollIntervalMs);
    }
  };
  loop();
  logger.info('[WORKER] AI analysis worker started');
}

module.exports = { startWorker, processOneJob };

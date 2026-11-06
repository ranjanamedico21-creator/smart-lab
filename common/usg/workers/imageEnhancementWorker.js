/**
 * common/usg/workers/imageEnhancementWorker.js
 * Separate poll loop from aiAnalysisWorker.js — enhancement jobs are
 * user-triggered one at a time from the Image Viewer, so they get their
 * own light queue rather than competing with AI_ANALYSIS jobs.
 */

const config = require('../../../config/usgConfig');
const logger = require('../../../config/logger');
const jobQueueModel = require('../../../models/usgJobQueueModel');
const { runEnhancement } = require('../ai/imageEnhancementService');
const { emitStatus } = require('../socket/usgSocket');
const { failJobWithBackoff } = require('./queueRetryHelper');

async function processOneJob() {
  const job = await jobQueueModel.claimNextJob('IMAGE_ENHANCEMENT');
  if (!job) return false;

  const { enhancementId } = JSON.parse(job.payload_json);
  logger.info(`[ENHANCE-WORKER] Processing enhancement job ${job.id} (enhancement ${enhancementId})`);

  try {
    const { outPath } = await runEnhancement(enhancementId);
    emitStatus('usg:enhancement_completed', { enhancementId, outPath });
    await jobQueueModel.completeJob(job.id);
  } catch (err) {
    logger.error(`[ENHANCE-WORKER] Job ${job.id} failed: ${err.message}`);
    emitStatus('usg:enhancement_failed', { enhancementId, error: err.message });
    await failJobWithBackoff(job, err);
  }
  return true;
}

function startEnhancementWorker() {
  const loop = async () => {
    try {
      let processed = true;
      while (processed) {
        // eslint-disable-next-line no-await-in-loop
        processed = await processOneJob();
      }
    } catch (err) {
      logger.error(`[ENHANCE-WORKER] Poll loop error: ${err.message}`);
    } finally {
      setTimeout(loop, config.queue.pollIntervalMs);
    }
  };
  loop();
  logger.info('[ENHANCE-WORKER] Image enhancement worker started');
}

module.exports = { startEnhancementWorker, processOneJob };

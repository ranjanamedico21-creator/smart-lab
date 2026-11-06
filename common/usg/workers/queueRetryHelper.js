/**
 * common/usg/workers/queueRetryHelper.js
 * Shared backoff policy for both workers — computes whether a failed job
 * should retry or move to DEAD_LETTER, and the next attempt time. Pulled
 * out of the model layer (models/usgJobQueueModel.js only does the raw
 * UPDATE) so retry policy is defined once, not duplicated per worker.
 */

const config = require('../../../config/usgConfig');
const logger = require('../../../config/logger');
const jobQueueModel = require('../../../models/usgJobQueueModel');

async function failJobWithBackoff(job, error) {
  const maxAttempts = job.max_attempts || config.queue.maxAttempts;
  const isDead = job.attempts >= maxAttempts;
  const backoffMs = config.queue.backoffBaseMs * 2 ** job.attempts;

  await jobQueueModel.failJob(job.id, {
    status: isDead ? 'DEAD_LETTER' : 'PENDING',
    errorMessage: error && error.message ? error.message : error,
    nextAttemptAt: new Date(Date.now() + backoffMs),
  });

  if (isDead) {
    logger.error(`[QUEUE] Job ${job.id} (${job.job_type}) moved to DEAD_LETTER after ${job.attempts} attempts`);
  }
}

module.exports = { failJobWithBackoff };

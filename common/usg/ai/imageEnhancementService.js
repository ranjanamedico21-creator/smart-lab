/**
 * common/usg/ai/imageEnhancementService.js
 *
 * A deliberately SEPARATE feature from AI measurement/findings analysis
 * (googleHealthcareProvider.js). Enhancement is:
 *   - OPT-IN only: never runs automatically after C-STORE. A user must
 *     explicitly request it (per-image or per-study) from the Image Viewer.
 *   - NON-DESTRUCTIVE: the original DICOM file is never modified or
 *     replaced. Output is a new derived file, tracked in
 *     usg_image_enhancements, and the viewer defaults to showing the
 *     original unless the user toggles to the enhanced version.
 *   - AUDITED: every request is logged with who requested it and (if used
 *     for reporting) who accepted it as the working image.
 *
 * IMPORTANT CLINICAL CAVEAT: AI-based image enhancement (denoising,
 * contrast/sharpness adjustment, super-resolution upscaling) changes pixel
 * values. It can improve visual clarity for review, but enhanced pixels must
 * never be treated as raw diagnostic data, and enhanced images should be
 * clearly watermarked/labeled as "AI-ENHANCED — NOT ORIGINAL" if ever
 * exported, printed, or included in a report. This module labels every
 * derived file accordingly (see stampEnhancedLabel()).
 *
 * All DB access goes through models/usgEnhancementModel.js,
 * models/usgStudyModel.js, models/usgJobQueueModel.js, and
 * models/usgAuditModel.js — this file only knows image processing, not SQL.
 *
 * npm install sharp google-auth-library node-fetch@2
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { GoogleAuth } = require('google-auth-library');
const fetch = require('node-fetch');
const config = require('../../../config/usgConfig');
const logger = require('../../../config/logger');
const enhancementModel = require('../../../models/usgEnhancementModel');
const studyModel = require('../../../models/usgStudyModel');
const jobQueueModel = require('../../../models/usgJobQueueModel');
const auditModel = require('../../../models/usgAuditModel');

const auth = new GoogleAuth({
  keyFile: config.google.keyFilePath,
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

/** Queue an enhancement request. Called by controller/usgEnhancementController.js. */
async function requestEnhancement({ imageId, enhancementType, userId }) {
  if (!config.enhancement.availableTypes.includes(enhancementType)) {
    throw new Error(`Unknown enhancement type: ${enhancementType}`);
  }

  const enhancementId = await enhancementModel.insertEnhancementRequest({ imageId, enhancementType, userId });

  await jobQueueModel.insertJob({
    jobType: 'IMAGE_ENHANCEMENT',
    payload: { enhancementId },
    nextAttemptAt: new Date(),
  });

  return { enhancementId };
}

/**
 * Runs one enhancement job. Called by the enhancement worker.
 *
 * Approach:
 *  - `denoise`, `contrast_boost`, `sharpen`: classical, deterministic image
 *    processing via `sharp` (fast, cheap, fully explainable — no AI model
 *    "hallucination" risk on diagnostic pixels). This is the recommended
 *    default for anything that might inform clinical review.
 *  - `super_resolution`: optionally delegates to a Vertex AI image model for
 *    upscaling where classical interpolation isn't sufficient. Flagged more
 *    prominently in the UI since generative upscaling can introduce
 *    plausible-looking but fabricated detail — use with more caution and
 *    always alongside the original.
 */
async function runEnhancement(enhancementId) {
  const job = await enhancementModel.findEnhancementById(enhancementId);
  if (!job) throw new Error(`Enhancement job ${enhancementId} not found`);

  const image = await studyModel.findImageById(job.image_id);
  if (!image) throw new Error(`Source image ${job.image_id} not found`);

  await enhancementModel.updateEnhancementStatus(enhancementId, 'PROCESSING');

  const start = Date.now();
  try {
    const sourcePath = image.thumbnail_path || image.file_path; // enhance the viewable JPEG, not raw DICOM bytes
    const outDir = path.join(config.dicom.thumbnailRoot, 'enhanced', String(image.series_id));
    await fs.promises.mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, `${image.sop_instance_uid}_${job.enhancement_type}_${enhancementId}.jpg`);

    let usedProvider = 'sharp-classical';
    let usedModel = null;

    if (job.enhancement_type === 'super_resolution') {
      const upscaled = await superResolveViaVertex(sourcePath);
      await fs.promises.writeFile(outPath, upscaled);
      usedProvider = 'google-vertex';
      usedModel = config.google.vertexModel;
    } else {
      await applyClassicalEnhancement(sourcePath, outPath, job.enhancement_type);
    }

    await stampEnhancedLabel(outPath);

    await enhancementModel.completeEnhancement(enhancementId, {
      outputPath: outPath, provider: usedProvider, model: usedModel, processingTimeMs: Date.now() - start,
    });

    logger.info(`[ENHANCE] Job ${enhancementId} (${job.enhancement_type}) completed in ${Date.now() - start}ms`);
    return { outPath };
  } catch (err) {
    await enhancementModel.failEnhancement(enhancementId, err.message);
    throw err;
  }
}

async function applyClassicalEnhancement(sourcePath, outPath, type) {
  let pipeline = sharp(sourcePath);
  switch (type) {
    case 'denoise':
      // Median-style smoothing to reduce speckle (esp. useful for
      // ultrasound speckle noise) while preserving edges reasonably well.
      pipeline = pipeline.median(3);
      break;
    case 'contrast_boost':
      pipeline = pipeline.normalise().linear(1.15, -10); // stretch histogram + mild gain
      break;
    case 'sharpen':
      pipeline = pipeline.sharpen({ sigma: 1.2 });
      break;
    default:
      throw new Error(`applyClassicalEnhancement: unsupported type ${type}`);
  }
  await pipeline.jpeg({ quality: 90 }).toFile(outPath);
}

async function superResolveViaVertex(sourcePath) {
  // Delegates to a Vertex AI image model for upscaling. Verify the current
  // recommended Vertex image model/endpoint for upscaling in Google's docs
  // before enabling this in production — model names and capabilities
  // change; this is a template, not a guaranteed-current endpoint.
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  const imageB64 = (await fs.promises.readFile(sourcePath)).toString('base64');

  const url = `https://${config.google.location}-aiplatform.googleapis.com/v1/projects/`
    + `${config.google.projectId}/locations/${config.google.location}/publishers/google/models/`
    + 'imagegeneration:predict'; // placeholder endpoint name — confirm current Vertex Imagen upscaling endpoint

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [{ image: { bytesBase64Encoded: imageB64 } }],
      parameters: { sampleCount: 1, mode: 'upscale', upscaleFactor: 'x2' },
    }),
  });
  if (!res.ok) throw new Error(`Vertex upscale request failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const outB64 = data.predictions?.[0]?.bytesBase64Encoded;
  if (!outB64) throw new Error('Vertex upscale returned no image data');
  return Buffer.from(outB64, 'base64');
}

async function stampEnhancedLabel(filePath) {
  // Burns a small, unobtrusive "AI-ENHANCED — NOT ORIGINAL" watermark onto
  // the derived JPEG so it can never be mistaken for the raw acquisition if
  // it's ever exported or printed outside the reviewed report.
  const buffer = await fs.promises.readFile(filePath);
  const meta = await sharp(buffer).metadata();
  const label = Buffer.from(
    `<svg width="${meta.width}" height="${meta.height}">
       <text x="8" y="${meta.height - 8}" font-size="14" fill="yellow" opacity="0.85">AI-ENHANCED — NOT ORIGINAL</text>
     </svg>`,
  );
  await sharp(buffer).composite([{ input: label, gravity: 'southwest' }]).jpeg({ quality: 90 }).toFile(filePath);
}

/** Radiologist confirms they're using the enhanced image for review (audit trail) */
async function acceptEnhancement(enhancementId, userId) {
  await enhancementModel.acceptEnhancement(enhancementId);
  await auditModel.logAuditEvent({
    entityType: 'image_enhancement', entityId: enhancementId, action: 'accept', performedBy: userId,
  });
}

module.exports = {
  requestEnhancement, runEnhancement, acceptEnhancement,
};

/**
 * Google implementation of AIProvider.
 *
 * npm install @google-cloud/aiplatform @google-cloud/storage node-fetch
 *
 * Two Google pieces are used:
 *  1. Cloud Healthcare API (DICOM store) — optional durable cloud copy of the
 *     study; useful for multi-branch/PACS interop later. Skipped gracefully
 *     if not configured (offline/on-prem-only deployments).
 *  2. Vertex AI (Gemini multimodal) — does the actual image reasoning:
 *     organ detection, measurement estimation, draft findings.
 *
 * IMPORTANT: Gemini's measurement *estimates* from 2D ultrasound stills are
 * assistive, not diagnostic-grade calipers. They are always written as
 * AI_SUGGESTED and must be confirmed/corrected by the radiologist against the
 * machine's own on-screen caliper measurements before being used clinically.
 */

const fs = require('fs');
const { GoogleAuth } = require('google-auth-library');
const fetch = require('node-fetch');
const config = require('../../../config/usgConfig');
const logger = require('../../../config/logger');
const AIProvider = require('./AIProvider');
const { MODALITY_PARAMETERS, buildExtractionPrompt, buildFindingsPrompt } = require('./organPromptTemplates');

const auth = new GoogleAuth({
  keyFile: config.google.keyFilePath, // undefined -> falls back to ADC / Workload Identity
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

class GoogleHealthcareProvider extends AIProvider {
  async isAvailable() {
    try {
      const client = await auth.getClient();
      await client.getAccessToken();
      return true;
    } catch (err) {
      logger.warn(`[AI] Google auth check failed: ${err.message}`);
      return false;
    }
  }

  async analyzeStudy(study) {
    const {
      studyId, images, patientContext, modality = 'US',
    } = study;

    // Step 1 (optional): mirror to Cloud Healthcare DICOM store for durability
    // and future PACS/RIS interop. Non-fatal if it fails.
    this.storeToHealthcareApi(images).catch((err) => (
      logger.warn(`[AI] Healthcare API store skipped for study ${studyId}: ${err.message}`)
    ));

    // Step 2: run measurement extraction + findings generation via Gemini.
    // Same pipeline for US/CT/MR — only the prompt's organ/parameter list
    // and framing change (see organPromptTemplates.js), driven by `modality`.
    const imageParts = await this.loadImageParts(images);

    const [measurementResults, findingsResult] = await Promise.all([
      this.extractMeasurements(imageParts, patientContext, modality),
      this.generateFindings(imageParts, patientContext, modality),
    ]);

    return {
      measurements: measurementResults,
      findings: findingsResult,
      raw: { measurementResults, findingsResult },
    };
  }

  async loadImageParts(images) {
    // Vertex expects base64 inline data (or a GCS URI). For a typical USG
    // study (15-40 frames) we downsample to a representative subset per
    // series to control cost/latency — full-study frame-by-frame analysis
    // is possible but rarely needed for standard measurements.
    const MAX_IMAGES = 12;
    const selected = images.slice(0, MAX_IMAGES);

    return Promise.all(selected.map(async (img) => ({
      inlineData: {
        mimeType: 'image/jpeg',
        data: (await fs.promises.readFile(img.thumbnailOrJpegPath)).toString('base64'),
      },
      meta: img,
    })));
  }

  async extractMeasurements(imageParts, patientContext, modality = 'US') {
    const prompt = buildExtractionPrompt(patientContext, modality);
    const response = await this.callGemini(prompt, imageParts, { jsonMode: true });

    try {
      const parsed = JSON.parse(response);
      return this.flattenMeasurements(parsed, modality);
    } catch (err) {
      logger.error(`[AI] Failed to parse measurement JSON: ${err.message}`);
      return [];
    }
  }

  flattenMeasurements(parsed, modality = 'US') {
    // parsed shape: { liver: { length: {value: 14.8, unit:'cm', confidence: 92}, ... }, ... }
    const allowedOrgans = MODALITY_PARAMETERS[modality] || {};
    const rows = [];
    Object.entries(parsed || {}).forEach(([organ, params]) => {
      if (!allowedOrgans[organ]) return; // guard against hallucinated organ keys for this modality
      Object.entries(params || {}).forEach(([parameter, val]) => {
        if (val == null) return;
        rows.push({
          organ,
          parameter,
          value: val.value,
          unit: val.unit || null,
          confidence: typeof val.confidence === 'number' ? val.confidence : null,
        });
      });
    });
    return rows;
  }

  async generateFindings(imageParts, patientContext, modality = 'US') {
    const prompt = buildFindingsPrompt(patientContext, modality);
    const response = await this.callGemini(prompt, imageParts, { jsonMode: true });
    try {
      const parsed = JSON.parse(response);
      return {
        findingsText: parsed.findings || '',
        impressionText: parsed.impression || '',
        recommendationsText: parsed.recommendations || '',
        severity: parsed.severity || 'NORMAL',
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
      };
    } catch (err) {
      logger.error(`[AI] Failed to parse findings JSON: ${err.message}`);
      return {
        findingsText: '', impressionText: '', recommendationsText: '', severity: null, confidence: null,
      };
    }
  }

  async callGemini(promptText, imageParts, { jsonMode = false } = {}) {
    const client = await auth.getClient();
    const { token } = await client.getAccessToken();

    const url = `https://${config.google.location}-aiplatform.googleapis.com/v1/projects/`
      + `${config.google.projectId}/locations/${config.google.location}/publishers/google/models/`
      + `${config.google.vertexModel}:generateContent`;

    const body = {
      contents: [{
        role: 'user',
        parts: [
          { text: promptText },
          ...imageParts.map((p) => ({ inlineData: p.inlineData })),
        ],
      }],
      generationConfig: {
        temperature: 0.1, // low temperature: we want consistent structured extraction, not creativity
        responseMimeType: jsonMode ? 'application/json' : 'text/plain',
      },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.google.requestTimeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Vertex AI request failed: ${res.status} ${await res.text()}`);
      }
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    } finally {
      clearTimeout(timeout);
    }
  }

  async storeToHealthcareApi(images) {
    if (!config.google.projectId || !config.google.gcsBucket) return; // not configured; skip
    const client = await auth.getClient();
    const { token } = await client.getAccessToken();
    const base = `https://healthcare.googleapis.com/v1/projects/${config.google.projectId}/locations/`
      + `${config.google.location}/datasets/${config.google.healthcareDataset}/dicomStores/`
      + `${config.google.healthcareDicomStore}/dicomWeb/studies`;

    await Promise.all(images.map(async (img) => {
      const buffer = await fs.promises.readFile(img.filePath);
      await fetch(base, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/dicom' },
        body: buffer,
      });
    }));
  }
}

module.exports = GoogleHealthcareProvider;

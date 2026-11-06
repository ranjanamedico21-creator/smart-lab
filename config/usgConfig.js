/**
 * Central configuration for the USG Automation module.
 * Pulls from environment variables so dev/staging/prod and multi-branch
 * deployments can differ without code changes.
 */

// Idempotent — safe even if your real app's entry file also loads dotenv.
require('dotenv').config();

const path = require('path');

// Default storage location, cross-platform. Resolves to e.g.:
//   macOS/Linux: /your/project/data/usg-dicom
//   Windows:     C:\your\project\data\usg-dicom
// Always override via USG_STORAGE_ROOT / USG_THUMB_ROOT in .env for a real
// deployment — these defaults are dev-machine-relative, not a fixed path.
const DEFAULT_STORAGE_ROOT = path.join(__dirname, '..', '..', 'data', 'usg-dicom');
const DEFAULT_THUMB_ROOT = path.join(__dirname, '..', '..', 'data', 'usg-thumbnails');

module.exports = {
  dicom: {
    // Our SCP (server) identity — what the ultrasound machines connect to
    aeTitle: process.env.USG_AE_TITLE || 'SMARTLAB_SCP',
    mwlPort: parseInt(process.env.USG_MWL_PORT || '4001', 10),
    storePort: parseInt(process.env.USG_STORE_PORT || '4002', 10),

    // Known modalities allowed to connect (simple allow-list; extend via DB later)
    knownAETitles: (process.env.USG_KNOWN_AETS || 'CANON_APLIO_1')
      .split(',')
      .map((s) => s.trim()),

    // Maps each machine's AE Title -> the modality it should see in the MWL
    // (US/CT/MR). One SmartLab MWL/Storage SCP serves all modalities; this
    // map is what keeps a CT scanner from seeing ultrasound orders and vice
    // versa. Format: "AE_TITLE:MODALITY,AE_TITLE:MODALITY"
    // Example: "CANON_APLIO_1:US,GE_CT_1:CT,SIEMENS_MRI_1:MR"
    aeModalityMap: (process.env.USG_AE_MODALITY_MAP || 'CANON_APLIO_1:US')
      .split(',')
      .map((pair) => pair.split(':').map((s) => s.trim()))
      .reduce((acc, [aet, modality]) => {
        if (aet && modality) acc[aet] = modality;
        return acc;
      }, {}),

    tls: {
      enabled: process.env.USG_DICOM_TLS === 'true',
      certPath: process.env.USG_DICOM_TLS_CERT,
      keyPath: process.env.USG_DICOM_TLS_KEY,
      caPath: process.env.USG_DICOM_TLS_CA,
    },

    storageRoot: process.env.USG_STORAGE_ROOT || DEFAULT_STORAGE_ROOT,
    thumbnailRoot: process.env.USG_THUMB_ROOT || DEFAULT_THUMB_ROOT,
  },

  google: {
    projectId: process.env.GCP_PROJECT_ID,
    location: process.env.GCP_LOCATION || 'us-central1',
    healthcareDataset: process.env.GCP_HEALTHCARE_DATASET || 'smartlab-usg-dataset',
    healthcareDicomStore: process.env.GCP_DICOM_STORE || 'usg-dicom-store',
    gcsBucket: process.env.GCP_GCS_BUCKET,
    vertexModel: process.env.GCP_VERTEX_MODEL || 'gemini-2.5-pro', // verify current model name before use
    // Service account key path (dev only). In production prefer Workload Identity.
    keyFilePath: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    requestTimeoutMs: parseInt(process.env.GCP_AI_TIMEOUT_MS || '90000', 10),
  },

  queue: {
    pollIntervalMs: parseInt(process.env.USG_QUEUE_POLL_MS || '5000', 10),
    maxAttempts: parseInt(process.env.USG_QUEUE_MAX_ATTEMPTS || '5', 10),
    backoffBaseMs: parseInt(process.env.USG_QUEUE_BACKOFF_BASE_MS || '10000', 10),
  },

  ai: {
    // Provider-agnostic switch. 'google' today; 'openai' / 'local' can be added
    // by implementing the same AIProvider interface (see services/ai/AIProvider.js)
    activeProvider: process.env.USG_AI_PROVIDER || 'google',
    confidenceAutoHighlightThreshold: 70, // below this, UI flags "low confidence" extra hard
    // Modalities that get structured measurement extraction + findings.
    // Enhancement (below) is available for all of these regardless.
    analysisEnabledModalities: (process.env.USG_ANALYSIS_MODALITIES || 'US,CT,MR')
      .split(',').map((s) => s.trim()),
  },

  enhancement: {
    // Image Enhancement is an OPT-IN, separate step from measurement/findings
    // analysis — it never runs automatically. A user (technician or
    // radiologist) explicitly requests it per-study or per-image from the
    // Image Viewer UI. See services/ai/imageEnhancementService.js.
    enabledModalities: (process.env.USG_ENHANCEMENT_MODALITIES || 'US,CT,MR')
      .split(',').map((s) => s.trim()),
    // Available enhancement types — mapped to prompt/processing strategy in
    // imageEnhancementService.js. Keep this list in sync with that file.
    availableTypes: ['denoise', 'contrast_boost', 'sharpen', 'super_resolution'],
    defaultType: process.env.USG_ENHANCEMENT_DEFAULT_TYPE || 'denoise',
    // Original DICOM is NEVER overwritten — enhanced output is always stored
    // as a derived, separately-flagged image alongside the original.
    preserveOriginal: true,
  },
};

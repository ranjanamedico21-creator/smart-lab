/**
 * Single source of truth for which organs/parameters we ask the AI to
 * extract (Phase 4 of the spec) and the prompt templates used for both
 * measurement extraction and findings generation.
 *
 * Keeping this data-driven (rather than hardcoding prompt strings per organ)
 * means adding a new organ/parameter is a one-line change here, and the
 * report population service (report/reportPopulationService.js) picks it up
 * automatically via the same key names.
 */

const US_ORGAN_PARAMETERS = {
  liver: ['length', 'echotexture', 'fatty_changes', 'mass', 'cyst'],
  gall_bladder: ['wall_thickness', 'stone', 'sludge', 'polyp'],
  cbd: ['diameter'],
  pancreas: ['head', 'body', 'tail'],
  spleen: ['length'],
  right_kidney: ['length', 'width', 'cortical_thickness', 'hydronephrosis', 'stone'],
  left_kidney: ['length', 'width', 'hydronephrosis', 'stone'],
  urinary_bladder: ['wall_thickness', 'residual_urine'],
  prostate: ['volume'],
  uterus: ['length', 'width', 'ap'],
  endometrium: ['thickness'],
  ovaries: ['volume'],
  gestational_sac: ['crl'],
  fetal: ['heart_rate'],
  placenta: ['afi'],
};

// CT — cross-sectional, contrast-aware parameter set. Extend per protocol
// (chest/abdomen/pelvis/brain/etc.) as you wire up more report templates.
const CT_ORGAN_PARAMETERS = {
  liver: ['size', 'attenuation', 'focal_lesion_size', 'focal_lesion_count'],
  lung: ['nodule_size', 'nodule_location', 'nodule_count', 'ground_glass_opacity'],
  mediastinum: ['lymph_node_short_axis', 'lymph_node_count'],
  kidney: ['size', 'hydronephrosis', 'calculus_size'],
  aorta: ['diameter_max', 'aneurysm_present'],
  spleen: ['size'],
  pancreas: ['size', 'ductal_dilation'],
  adrenal: ['nodule_size'],
  bone: ['lytic_lesion', 'sclerotic_lesion', 'fracture_present'],
  brain: ['midline_shift', 'ventricle_size', 'hemorrhage_volume'],
};

// MRI — sequence-aware where relevant (T1/T2/FLAIR/DWI); the model is told
// which sequence a given image is from via DICOM SeriesDescription passed in
// patientContext/image metadata, not hardcoded here.
const MRI_ORGAN_PARAMETERS = {
  brain: ['lesion_size', 'lesion_count', 'midline_shift', 'ventricle_size', 'diffusion_restriction'],
  spine: ['disc_herniation_level', 'canal_stenosis_grade', 'cord_signal_change'],
  liver: ['size', 'lesion_size', 'lesion_signal_characteristics'],
  knee: ['meniscal_tear', 'ligament_tear', 'effusion_grade'],
  shoulder: ['rotator_cuff_tear', 'labral_tear', 'effusion_grade'],
  prostate: ['pirads_score', 'volume', 'lesion_size'],
  breast: ['birads_score', 'lesion_size', 'lesion_enhancement_pattern'],
  pituitary: ['size', 'mass_present'],
};

const MODALITY_PARAMETERS = {
  US: US_ORGAN_PARAMETERS,
  CT: CT_ORGAN_PARAMETERS,
  MR: MRI_ORGAN_PARAMETERS,
};

// Kept for backward compatibility with existing US-only imports.
const ORGAN_PARAMETERS = US_ORGAN_PARAMETERS;

const MODALITY_LABELS = {
  US: 'ultrasound (grayscale/Doppler)',
  CT: 'CT (cross-sectional, possibly contrast-enhanced)',
  MR: 'MRI (multi-sequence: T1/T2/FLAIR/DWI as indicated per series)',
};

function buildExtractionPrompt(patientContext = {}, modality = 'US') {
  const params = MODALITY_PARAMETERS[modality] || US_ORGAN_PARAMETERS;
  const organList = Object.entries(params)
    .map(([organ, fields]) => `  "${organ}": { ${fields.map((p) => `"${p}": {"value": <number_or_string>, "unit": "<cm|mm|cc|bpm|null>", "confidence": <0-100>}`).join(', ')} }`)
    .join(',\n');

  return `You are assisting a radiologist by pre-filling a ${MODALITY_LABELS[modality] || modality}
report from the attached images.

Patient context: age=${patientContext.age || 'unknown'}, sex=${patientContext.sex || 'unknown'},
clinical indication=${patientContext.indication || 'not specified'}, modality=${modality}.

Task: For each organ/structure visible in the images, estimate the listed
parameters. Only include an organ/parameter if it is actually visible and
measurable in at least one image — omit (do not guess) anything not visible.
Every value must include a confidence score (0-100) reflecting image quality
and measurement certainty, not clinical certainty.

Respond with ONLY a single JSON object, no prose, no markdown fences, in
exactly this shape (omit organs/parameters not visible):
{
${organList}
}

This is a decision-support estimate for radiologist review, not a final
diagnostic measurement. Do not fabricate values for structures not shown.`;
}

function buildFindingsPrompt(patientContext = {}, modality = 'US') {
  return `You are assisting a radiologist by drafting a preliminary ${MODALITY_LABELS[modality] || modality}
report narrative from the attached images. Patient context: age=${patientContext.age || 'unknown'},
sex=${patientContext.sex || 'unknown'}, clinical indication=${patientContext.indication || 'not specified'}.

Write a draft in a neutral, standard radiology-report tone. Respond with ONLY
a JSON object, no prose outside it, in this shape:
{
  "findings": "<objective per-organ/structure findings, 3-6 sentences>",
  "impression": "<concise diagnostic impression, 1-3 sentences>",
  "recommendations": "<follow-up recommendation if any, else empty string>",
  "severity": "NORMAL|MILD|MODERATE|SEVERE|CRITICAL",
  "confidence": <0-100 overall confidence>
}

This draft will be reviewed, edited, and approved by a licensed radiologist
before release. It must never be sent to a patient or finalized automatically.
If images are non-diagnostic or ambiguous, say so explicitly in "findings" and
lower "confidence" accordingly rather than guessing.`;
}

module.exports = {
  ORGAN_PARAMETERS,
  MODALITY_PARAMETERS,
  US_ORGAN_PARAMETERS,
  CT_ORGAN_PARAMETERS,
  MRI_ORGAN_PARAMETERS,
  buildExtractionPrompt,
  buildFindingsPrompt,
};

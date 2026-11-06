/**
 * common/usg/dicom/dicomIdGenerator.js
 * Small, dependency-free helpers used when creating a new worklist entry.
 * Kept separate from the model/controller so both usgWorklistController.js
 * and any future bulk-import script can reuse them.
 */

const dayjs = require('dayjs');

function generateAccessionNumber() {
  return `SL${dayjs().format('YYYYMMDD')}${Math.floor(1000 + Math.random() * 9000)}`;
}

function generateStudyInstanceUID() {
  // Production: use a registered UID root (apply for one via your national
  // body / HL7). This placeholder root works for testing but should be
  // replaced with your organization's real OID before go-live.
  const ORG_ROOT = '1.2.826.0.1.3680043.10.1001'; // <-- replace with your real root
  return `${ORG_ROOT}.${Date.now()}.${Math.floor(Math.random() * 1e6)}`;
}

module.exports = { generateAccessionNumber, generateStudyInstanceUID };

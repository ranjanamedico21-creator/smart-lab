/**
 * AIProvider — the contract every AI backend must implement.
 * Controllers/services never call Google APIs directly; they call
 * `getActiveProvider().analyzeStudy(...)`. This is what makes the AI layer
 * swappable (Google today, OpenAI or a local model later) without touching
 * anything upstream (job worker, report population, UI).
 */

/* eslint-disable class-methods-use-this, no-unused-vars */
class AIProvider {
  /**
   * @param {object} study - { studyId, images: [{filePath, bodyPart, ...}], patientContext }
   * @returns {Promise<{
   *   measurements: Array<{organ:string, parameter:string, value:number|string, unit?:string, confidence:number, sourceImageId?:number}>,
   *   findings: {findingsText:string, impressionText:string, recommendationsText:string, severity:string, confidence:number},
   *   raw: object
   * }>}
   */
  async analyzeStudy(study) {
    throw new Error('analyzeStudy() not implemented');
  }

  /** @returns {Promise<boolean>} cheap reachability check, used for the AI_UNAVAILABLE fallback */
  async isAvailable() {
    throw new Error('isAvailable() not implemented');
  }
}

module.exports = AIProvider;

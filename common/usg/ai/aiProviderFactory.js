/**
 * Factory that returns the active AIProvider implementation based on config.
 * To add a new provider (OpenAI, a local model server, etc.):
 *   1. Implement the AIProvider interface in a new file (see AIProvider.js)
 *   2. Register it in the map below
 *   3. Set USG_AI_PROVIDER env var — no other code changes needed
 */

const config = require('../../../config/usgConfig');
const GoogleHealthcareProvider = require('./googleHealthcareProvider');

const providers = {
  google: () => new GoogleHealthcareProvider(),
  // openai: () => new OpenAIProvider(),
  // local: () => new LocalModelProvider(),
};

let cachedInstance = null;

function getActiveProvider() {
  if (cachedInstance) return cachedInstance;
  const factory = providers[config.ai.activeProvider];
  if (!factory) {
    throw new Error(`Unknown AI provider configured: ${config.ai.activeProvider}`);
  }
  cachedInstance = factory();
  return cachedInstance;
}

module.exports = { getActiveProvider };

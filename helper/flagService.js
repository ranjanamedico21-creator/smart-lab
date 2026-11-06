/**
 * Flag Calculation Service
 * Auto-interprets results against reference ranges
 */

const FLAG_DEFS = {
    normal: { symbol: '', label: 'NORMAL', css: 'flag-normal' },
    low: { symbol: '↓', label: 'LOW', css: 'flag-low' },
    high: { symbol: '↑', label: 'HIGH', css: 'flag-high' },
    critical_low: { symbol: '↓↓', label: 'CRITICAL LOW', css: 'flag-critical-low' },
    critical_high: { symbol: '↑↑', label: 'CRITICAL HIGH', css: 'flag-critical-high' }
  };
  
  class FlagService {
    static calculateFlag(value, range) {
      if (value === null || value === undefined || value === '' || isNaN(value)) {
        return { flag: null, symbol: '', label: '', css: '', interpretation: '' };
      }
      const num = parseFloat(value);
  
      if (range?.critical_low !== null && num < parseFloat(range.critical_low)) {
        return { flag: 'critical_low', ...FLAG_DEFS.critical_low, interpretation: `Critical low: ${num} < ${range.critical_low}` };
      }
      if (range?.critical_high !== null && num > parseFloat(range.critical_high)) {
        return { flag: 'critical_high', ...FLAG_DEFS.critical_high, interpretation: `Critical high: ${num} > ${range.critical_high}` };
      }
      if (range?.min_value !== null && num < parseFloat(range.min_value)) {
        return { flag: 'low', ...FLAG_DEFS.low, interpretation: `Below range: ${num} < ${range.min_value}` };
      }
      if (range?.max_value !== null && num > parseFloat(range.max_value)) {
        return { flag: 'high', ...FLAG_DEFS.high, interpretation: `Above range: ${num} > ${range.max_value}` };
      }
      return { flag: 'normal', ...FLAG_DEFS.normal, interpretation: 'Within normal range' };
    }
  }
  
  module.exports = FlagService;
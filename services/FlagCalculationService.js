const FLAG_DEFS = {
  normal: { symbol: '', label: 'NORMAL', css: 'flag-normal' },
  low: { symbol: '↓', label: 'LOW', css: 'flag-low' },
  high: { symbol: '↑', label: 'HIGH', css: 'flag-high' },
  critical_low: { symbol: '↓↓', label: 'CRITICAL LOW', css: 'flag-critical-low' },
  critical_high: { symbol: '↑↑', label: 'CRITICAL HIGH', css: 'flag-critical-high' }
};

class FlagCalculationService {
  static calculate(value, range) {
    if (value === null || value === undefined || value === '' || isNaN(value)) {
      return { flag: null, symbol: '', label: '', css: '', interpretation: '' };
    }
    const num = parseFloat(value);

    if (range && range.CriticalLow !== null && num < parseFloat(range.CriticalLow)) {
      return { flag: 'critical_low', ...FLAG_DEFS.critical_low, interpretation: `Critical low: ${num} < ${range.CriticalLow}` };
    }
    if (range && range.CriticalHigh !== null && num > parseFloat(range.CriticalHigh)) {
      return { flag: 'critical_high', ...FLAG_DEFS.critical_high, interpretation: `Critical high: ${num} > ${range.CriticalHigh}` };
    }
    if (range && range.MinValue !== null && num < parseFloat(range.MinValue)) {
      return { flag: 'low', ...FLAG_DEFS.low, interpretation: `Below range: ${num} < ${range.MinValue}` };
    }
    if (range && range.MaxValue !== null && num > parseFloat(range.MaxValue)) {
      return { flag: 'high', ...FLAG_DEFS.high, interpretation: `Above range: ${num} > ${range.MaxValue}` };
    }
    return { flag: 'normal', ...FLAG_DEFS.normal, interpretation: 'Within normal range' };
  }
}

module.exports = FlagCalculationService;
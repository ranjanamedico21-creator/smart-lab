/**
 * FormulaService — evaluates calculated-parameter formulas safely.
 *
 * Preferred syntax wraps ShortNames in braces:  {HB}*10/{RBC}
 * Braces make tokens unambiguous (no partial replacement of "HB" inside "HBA1C",
 * or "K" inside other names). Legacy formulas without braces still work using
 * the old longest-ShortName-first replacement.
 *
 * Returns a finite number, or null if any dependency is missing / result invalid
 * (e.g. divide by zero).
 */
const vm = require('vm');

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');

function substitute(formula, valueMap) {
  if (!formula) return null;
  let f = String(formula);
  if (f.indexOf('{') !== -1) {
    let missing = false;
    f = f.replace(/\{\s*([^{}]+?)\s*\}/g, (_, sn) => {
      const v = valueMap[sn];
      if (v === undefined || v === null || isNaN(v)) { missing = true; return '0'; }
      return '(' + v + ')';
    });
    return missing ? null : f;
  }
  const tokens = Object.keys(valueMap).sort((a, b) => b.length - a.length);
  for (const t of tokens) {
    const v = valueMap[t];
    if (v === undefined || v === null || isNaN(v)) continue;
    f = f.replace(new RegExp(escapeRe(t), 'g'), '(' + v + ')');
  }
  return f;
}

function evaluate(formula, valueMap) {
  const f = substitute(formula, valueMap);
  if (f === null) return null;
  if (/[A-Za-z_]/.test(f)) return null;              // unresolved dependency
  if (!/^[0-9+\-*/().\s]+$/.test(f)) return null;     // only arithmetic allowed
  try {
    const out = vm.runInNewContext(f, Object.create(null), { timeout: 50 });
    return (typeof out === 'number' && isFinite(out)) ? out : null;
  } catch (e) {
    return null;
  }
}

/** ShortNames referenced by a formula (brace syntax only). */
function dependencies(formula) {
  const out = [];
  String(formula || '').replace(/\{\s*([^{}]+?)\s*\}/g, (_, sn) => { out.push(sn); return _; });
  return out;
}

module.exports = { evaluate, substitute, dependencies };

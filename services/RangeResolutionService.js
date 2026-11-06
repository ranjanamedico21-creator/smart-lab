/**
 * RangeResolutionService — picks the ONE reference range that applies to a patient.
 *
 * Rules (2026-10-27 rewrite):
 *  1. Gender is a hard filter. A 'male'/'female' row only applies to that gender;
 *     'all'/'both' rows apply to everyone. (Previously a female could be given the
 *     male range whenever its age band scored better.)
 *  2. Age is a hard filter, compared in DAYS: AgeFrom <= age < AgeTo.
 *     AgeTo is exclusive so adjacent bands (6-12 y, 12-18 y) never both match a
 *     12-year-old; AgeTo >= 999 years means "no upper limit".
 *     (Previously when no age band matched, the resolver still returned the
 *     best-scoring row — so a newborn could be flagged against adult ranges.)
 *  3. If nothing applies, return null (report shows N/A, no false flag).
 *  4. Tie-break: Priority, then gender-specific over 'all', then method match,
 *     then department match, then the narrowest age band.
 */
const DAYS_PER = { days: 1, months: 30.4375, years: 365.25 };
const OPEN_ENDED_DAYS = 998 * 365.25;

const normUnit = (u) => {
  const s = (u || 'years').toString().toLowerCase().trim();
  if (['d', 'day', 'days'].includes(s)) return 'days';
  if (['m', 'mo', 'mos', 'month', 'months'].includes(s)) return 'months';
  return 'years';
};

const normGender = (g) => {
  const s = (g == null ? '' : g).toString().toLowerCase().trim();
  if (['1', 'm', 'male'].includes(s)) return 'male';
  if (['2', 'f', 'female'].includes(s)) return 'female';
  return 'other';
};

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/** Trim DECIMAL(12,4) strings from mysql2: "13.0000" -> "13", "0.2500" -> "0.25". */
const fmt = (v) => {
  const n = num(v);
  if (n === null || isNaN(n)) return null;
  return String(Number(n.toFixed(4)));
};

class RangeResolutionService {
  static toDays(age, unit) {
    const a = parseFloat(age);
    if (isNaN(a)) return null;
    return a * DAYS_PER[normUnit(unit)];
  }

  /** Kept for backward compatibility (returns years). */
  static normalizeAge(age, unit) {
    const d = this.toDays(age, unit);
    return d === null ? 0 : d / 365.25;
  }

  static appliesTo(r, ageDays, gender) {
    const rg = (r.Gender || 'all').toLowerCase();
    if ((rg === 'male' || rg === 'female') && rg !== gender) return false;
    if (ageDays === null) return true; // unknown age: let gender + tie-break decide
    const from = this.toDays(r.AgeFrom == null ? 0 : r.AgeFrom, r.AgeUnit) || 0;
    const toRaw = this.toDays(r.AgeTo == null ? 999 : r.AgeTo, r.AgeUnit);
    const to = toRaw === null || toRaw >= OPEN_ENDED_DAYS ? Infinity : toRaw;
    return ageDays >= from && ageDays < to;
  }

  static resolve({ parameterId, patient, method, departmentId, ranges }) {
    if (!ranges || !ranges.length) return null;
    const p = patient || {};
    const ageDays = this.toDays(p.age, p.ageUnit);
    const gender = normGender(p.gender);

    const candidates = ranges.filter(r =>
      Number(r.ParameterId) === Number(parameterId) &&
      (r.ActiveStatus || 'active') === 'active' &&
      !r.DeletedAt &&
      this.appliesTo(r, ageDays, gender)
    );
    if (!candidates.length) return null;

    const span = (r) => {
      const from = this.toDays(r.AgeFrom || 0, r.AgeUnit) || 0;
      const to = this.toDays(r.AgeTo == null ? 999 : r.AgeTo, r.AgeUnit);
      return (to === null || to >= OPEN_ENDED_DAYS ? 1e9 : to) - from;
    };
    const key = (r) => {
      const rg = (r.Gender || 'all').toLowerCase();
      return [
        Number(r.Priority || 0),
        rg === gender ? 1 : 0,
        method && r.Method && r.Method.toLowerCase() === String(method).toLowerCase() ? 1 : (r.Method ? -1 : 0),
        departmentId && Number(r.DepartmentId) === Number(departmentId) ? 1 : (r.DepartmentId ? -1 : 0),
        -span(r)
      ];
    };
    candidates.sort((a, b) => {
      const ka = key(a), kb = key(b);
      for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i];
      return Number(a.Id || 0) - Number(b.Id || 0);
    });
    return candidates[0];
  }

  /** Text stored on the result row and printed on the report, e.g. "13 - 17", "< 200", "> 40". */
  static rangeText(range) {
    if (!range) return null;
    const mn = fmt(range.MinValue), mx = fmt(range.MaxValue);
    if (mn !== null && mx !== null) return `${mn} - ${mx}`;
    if (mx !== null) return `< ${mx}`;
    if (mn !== null) return `> ${mn}`;
    return null;
  }

  static formatDisplay(range) {
    return this.rangeText(range) || 'N/A';
  }

  static async resolveAll({ results, patient, departmentId, ranges }) {
    return results.map(r => {
      const bestRange = this.resolve({ parameterId: r.ParameterId, patient, method: r.Method, departmentId, ranges });
      return { ...r, referenceRange: bestRange, referenceRangeDisplay: this.formatDisplay(bestRange) };
    });
  }
}

RangeResolutionService.normGender = normGender;
RangeResolutionService.normUnit = normUnit;
module.exports = RangeResolutionService;

/**
 * Reference Range Selection Service
 */

class RangeService {
    static normalizeAge(age, unit) {
      switch(unit) {
        case 'days': return age / 365.25;
        case 'months': return age / 12;
        case 'years': return age;
        default: return age;
      }
    }
  
    static findBestRange(parameterId, patient, method, departmentId, ranges) {
      const patientAge = this.normalizeAge(patient.age, patient.age_unit || 'years');
      const gender = patient.gender?.toLowerCase();
  
      const candidates = ranges.filter(r => 
        r.parameter_id === parameterId && 
        r.active_status === 'active' && 
        r.deleted_at === null
      );
  
      if (!candidates.length) return null;
  
      const scored = candidates.map(r => {
        let score = 0;
        const rGender = r.gender?.toLowerCase();
        if (rGender === gender || rGender === 'all' || rGender === 'both') score += 100;
  
        const ageFrom = this.normalizeAge(r.age_from, r.age_unit);
        const ageTo = this.normalizeAge(r.age_to, r.age_unit);
        if (patientAge >= ageFrom && patientAge <= ageTo) score += 50;
  
        if (method && r.method && r.method.toLowerCase() === method.toLowerCase()) score += 30;
        else if (!method || !r.method) score += 15;
  
        if (departmentId && r.department_id === departmentId) score += 20;
        else if (!r.department_id) score += 10;
  
        score += (r.priority || 0);
        return { ...r, score };
      });
  
      scored.sort((a, b) => b.score - a.score);
      return scored[0] || null;
    }
  
    static formatRangeDisplay(range) {
      if (!range) return 'N/A';
      let display = '';
      if (range.min_value !== null && range.max_value !== null) display = `${range.min_value} - ${range.max_value}`;
      else if (range.min_value !== null) display = `> ${range.min_value}`;
      else if (range.max_value !== null) display = `< ${range.max_value}`;
      if (range.unit) display += ` ${range.unit}`;
      return display;
    }
  }
  
  module.exports = RangeService;
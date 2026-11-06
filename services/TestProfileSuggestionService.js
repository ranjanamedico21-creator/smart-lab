class TestProfileSuggestionService {
  static suggest(testName, allParameters, departments) {
    const name = (testName || '').toLowerCase();
    const params = allParameters || [];
    const depts = departments || [];

    let deptId = null;
    let specimen = 'Blood';
    let suggestedParamIds = [];

    if (this._match(name, ['cbc', 'esr', 'bt', 'ct', 'bleeding', 'clotting', 'coagulation', 'pt ', 'inr', 'aptt', 'blood group', 'hemat', 'hb ', 'mch', 'mcv', 'rbc', 'wbc', 'plt', 'typhidot'])) {
      deptId = this._findDept(depts, 'HAEM');
      specimen = 'Blood';
    } else if (this._match(name, ['rbs', 'fbs', 'ppbs', 'sugar', 'glucose', 'creatinine', 'urea', 'bun', 'lipid', 'lft', 'liver', 'kft', 'renal', 'electrolyte', 'sodium', 'potassium', 'chloride', 'cholesterol', 'hdl', 'ldl', 'triglyceride', 'bilirubin', 'sgpt', 'sgot', 'alt', 'ast', 'alp', 'albumin', 'protein', 'calcium', 'phosphorus', 'magnesium', 'vitamin', 'amylase', 'lipase', 'hba1c', 'a1c', 'iron', 'tibc'])) {
      deptId = this._findDept(depts, 'BIOC');
      specimen = name.includes('urine') ? 'Urine' : (name.includes('stool') ? 'Stool' : 'Serum');
    } else if (this._match(name, ['widal', 'dengue', 'hiv', 'hbsag', 'hcv', 'vdrl', 'tpha', 'crp', 'ra factor', 'aso', 'serology', 'elisa', 'cmia', 'typhidot', 'malaria', 'torch'])) {
      deptId = this._findDept(depts, 'SERO');
      specimen = 'Serum';
    } else if (this._match(name, ['culture', 'sensitivity', 'c/s', 'gram stain', 'afb', 'microbiology', 'koh', 'fungal', 'tuberculosis', 'tb '])) {
      deptId = this._findDept(depts, 'MICRO');
      specimen = name.includes('urine') ? 'Urine' : (name.includes('sputum') ? 'Sputum' : (name.includes('stool') ? 'Stool' : 'Blood'));
    } else if (this._match(name, ['urine', 'urinalysis', 'stool', 'semen', 'routine'])) {
      deptId = this._findDept(depts, 'CLIN');
      if (name.includes('urine')) specimen = 'Urine';
      else if (name.includes('stool')) specimen = 'Stool';
      else if (name.includes('semen')) specimen = 'Semen';
    } else if (this._match(name, ['biopsy', 'hpe', 'histopathology', 'tissue', 'histology'])) {
      deptId = this._findDept(depts, 'HISTO');
      specimen = 'Tissue';
    } else if (this._match(name, ['fnac', 'pap smear', 'cytology', 'aspiration', 'fine needle'])) {
      deptId = this._findDept(depts, 'CYTO');
      specimen = 'Fluid';
    }

    if (this._match(name, ['cbc', 'complete blood count', 'blood count'])) {
      suggestedParamIds = this._pickParams(params, ['Hb','RBC','WBC','PLT','HCT','MCV','MCH','MCHC','RDW','NEUT','LYMPH','MONO','EO','BASO']);
    } else if (this._match(name, ['rbs', 'random blood sugar', 'random sugar'])) {
      suggestedParamIds = this._pickParams(params, ['RBS']);
    } else if (this._match(name, ['fbs', 'fasting blood sugar', 'fasting sugar'])) {
      suggestedParamIds = this._pickParams(params, ['FBS']);
    } else if (this._match(name, ['ppbs', 'post prandial', 'post lunch'])) {
      suggestedParamIds = this._pickParams(params, ['PPBS']);
    } else if (this._match(name, ['serum creatinine', 'creatinine', 'rft', 'kft', 'renal function', 'kidney function'])) {
      suggestedParamIds = this._pickParams(params, ['CREAT','UREA','BUN','Na','K','Cl','UA']);
    } else if (this._match(name, ['bt', 'ct', 'bleeding time', 'clotting time', 'coagulation profile', 'pt inr'])) {
      suggestedParamIds = this._pickParams(params, ['PT','INR','APTT']);
    } else if (this._match(name, ['lipid', 'cholesterol', 'triglyceride'])) {
      suggestedParamIds = this._pickParams(params, ['T-CHOL','HDL','LDL','TG','VLDL','CHOL/HDL']);
    } else if (this._match(name, ['lft', 'liver function', 'sgpt', 'sgot', 'bilirubin'])) {
      suggestedParamIds = this._pickParams(params, ['BIL-T','BIL-D','BIL-I','AST','ALT','ALP','GGT','TP','ALB','GLOB','A/G']);
    } else if (this._match(name, ['urine', 'urinalysis'])) {
      suggestedParamIds = this._pickParams(params, ['U-Color','U-App','U-pH','U-SG','U-Prot','U-Glu','U-Ket','U-Blood','U-Nit','U-Leu','U-Uro','U-RBC','U-Pus','U-Epi','U-Cast','U-Crys']);
    } else if (this._match(name, ['stool', 'fecal'])) {
      suggestedParamIds = this._pickParams(params, ['S-Color','S-Cons','S-Mucus','S-Blood','S-OB','S-Parasite','S-Ova','S-Cyst','S-RBC','S-Pus']);
    } else if (this._match(name, ['semen', 'sperm'])) {
      suggestedParamIds = this._pickParams(params, ['Sem-Vol','Sem-pH','Sem-Liq','Sem-Vis','Sperm-Count','Sperm-Mot','Sperm-Morph']);
    } else if (this._match(name, ['blood group', 'abo', 'rh factor', 'typing'])) {
      suggestedParamIds = this._pickParams(params, ['ABO','Rh']);
    } else if (this._match(name, ['esr'])) {
      suggestedParamIds = this._pickParams(params, ['ESR']);
    } else if (this._match(name, ['hba1c', 'glycated hemoglobin', 'a1c'])) {
      suggestedParamIds = this._pickParams(params, ['HbA1c','eAG']);
    } else if (this._match(name, ['electrolyte'])) {
      suggestedParamIds = this._pickParams(params, ['Na','K','Cl']);
    } else if (this._match(name, ['widal', 'typhidot', 'typhoid'])) {
      suggestedParamIds = this._pickParams(params, ['Widal-O','Widal-H','Widal-AH','Widal-BH','Typh-IgG','Typh-IgM']);
    } else if (this._match(name, ['dengue'])) {
      suggestedParamIds = this._pickParams(params, ['Deng-NS1','Deng-IgG','Deng-IgM']);
    } else if (this._match(name, ['hiv', 'aids'])) {
      suggestedParamIds = this._pickParams(params, ['HIV']);
    } else if (this._match(name, ['hbsag', 'hepatitis b'])) {
      suggestedParamIds = this._pickParams(params, ['HBsAg']);
    } else if (this._match(name, ['hcv', 'hepatitis c'])) {
      suggestedParamIds = this._pickParams(params, ['HCV']);
    } else if (this._match(name, ['vdrl', 'syphilis', 'tpha'])) {
      suggestedParamIds = this._pickParams(params, ['VDRL','TPHA']);
    } else if (this._match(name, ['crp'])) {
      suggestedParamIds = this._pickParams(params, ['CRP']);
    } else if (this._match(name, ['ra factor', 'rheumatoid'])) {
      suggestedParamIds = this._pickParams(params, ['RA']);
    } else if (this._match(name, ['aso'])) {
      suggestedParamIds = this._pickParams(params, ['ASO']);
    }

    return { deptId, suggestedParamIds, specimen };
  }

  static _match(name, keywords) {
    return keywords.some(k => name.indexOf(k) !== -1);
  }

  static _findDept(depts, code) {
    for (let i = 0; i < depts.length; i++) {
      if (depts[i].DepartmentCode === code) return depts[i].Id;
    }
    return null;
  }

  static _pickParams(params, shortNames) {
    const ids = [];
    for (let i = 0; i < params.length; i++) {
      if (shortNames.indexOf(params[i].ShortName) !== -1) {
        ids.push(params[i].Id);
      }
    }
    return ids;
  }
}

module.exports = TestProfileSuggestionService;
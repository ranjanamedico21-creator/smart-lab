const Pathology = require("../models/Pathology");

/**
 * Resolves which pathology department a test belongs to.
 *   1. Patho_TestProfile (explicit, set in Test Profile Master)
 *   2. Patho_TestParameterMapping (department the parameters were mapped under)
 *   3. FIX: MainTestTable.CategoryId = 2 (PATHOLOGY) + Patho_TestSpecimenRequirement.DepartmentId
 *
 * Step 3 matters because "Add Test" saves the specimen requirement but NOT a test
 * profile. Without it a brand-new pathology test resolved as IsPathology = false,
 * so registration silently skipped specimen creation and the sample never
 * appeared for acceptance.
 */
class DepartmentResolverService {
  static async resolve(testId) {
    const profile = await Pathology.findTestProfile(testId);
    if (profile && profile.DepartmentId) {
      return {
        DepartmentId: profile.DepartmentId,
        DepartmentName: profile.DepartmentName,
        IsPathology: !!Number(profile.IsPathology),
        SpecimenType: profile.SpecimenType,
        Source: 'profile'
      };
    }
    const mapping = await Pathology.findDepartmentByTestId(testId);
    if (mapping && mapping.DepartmentId) {
      return { DepartmentId: mapping.DepartmentId, DepartmentName: null, IsPathology: true, SpecimenType: null, Source: 'mapping' };
    }
    const cat = await Pathology.findPathologyTestFallback(testId);
    if (cat) {
      return {
        DepartmentId: cat.DepartmentId || null,
        DepartmentName: cat.DepartmentName || null,
        IsPathology: true,
        SpecimenType: cat.SpecimenTypeName || null,
        Source: 'category'
      };
    }
    return { IsPathology: false, DepartmentId: null };
  }

  static async isPathology(testId) {
    const resolution = await this.resolve(testId);
    return resolution.IsPathology;
  }
}

module.exports = DepartmentResolverService;

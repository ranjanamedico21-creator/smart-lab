const { body, param, query, validationResult } = require('express-validator');

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
  }
  next();
};

const departmentValidators = {
  create: [
    body('DepartmentName').trim().isLength({ min: 2, max: 100 }).withMessage('Department name must be 2-100 characters'),
    body('DepartmentCode').trim().isLength({ min: 2, max: 20 }).matches(/^[A-Z0-9_-]+$/i).withMessage('Invalid department code format'),
    body('Description').optional().trim().isLength({ max: 500 }),
    body('DisplayOrder').optional().isInt({ min: 0 }),
    body('Status').optional().isIn(['active', 'inactive']),
    handleValidationErrors
  ],
  update: [
    param('id').isInt().withMessage('Invalid department ID'),
    body('DepartmentName').optional().trim().isLength({ min: 2, max: 100 }),
    body('DepartmentCode').optional().trim().isLength({ min: 2, max: 20 }).matches(/^[A-Z0-9_-]+$/i),
    body('Description').optional().trim().isLength({ max: 500 }),
    body('DisplayOrder').optional().isInt({ min: 0 }),
    body('Status').optional().isIn(['active', 'inactive']),
    handleValidationErrors
  ]
};

const parameterValidators = {
  create: [
    body('ParameterName').trim().isLength({ min: 2, max: 150 }).withMessage('Parameter name required'),
    body('ShortName').trim().isLength({ min: 1, max: 50 }).withMessage('Short name required'),
    body('Unit').optional().trim().isLength({ max: 50 }),
    body('Method').optional().trim().isLength({ max: 100 }),
    body('LoincCode').optional().trim().isLength({ max: 20 }),
    body('DecimalPrecision').optional().isInt({ min: 0, max: 10 }),
    body('IsCalculated').optional().isBoolean(),
    body('CalculationFormula').optional().trim(),
    body('ResultType').optional().isIn(['numeric', 'text', 'boolean', 'microscopic', 'culture', 'select']),
    body('SelectOptions').optional().isArray(),
    body('ActiveStatus').optional().isIn(['active', 'inactive']),
    handleValidationErrors
  ],
  update: [
    param('id').isInt(),
    body('ParameterName').optional().trim().isLength({ min: 2, max: 150 }),
    body('ShortName').optional().trim().isLength({ min: 1, max: 50 }),
    handleValidationErrors
  ],
  bulkImport: [
    body('parameters').isArray({ min: 1 }).withMessage('Parameters array required'),
    handleValidationErrors
  ],
  mapping: [
    body('test_id').isInt().withMessage('Test ID required'),
    body('parameter_id').isInt().withMessage('Parameter ID required'),
    body('department_id').isInt().withMessage('Department ID required'),
    body('display_order').optional().isInt({ min: 0 }),
    body('is_required').optional().isBoolean(),
    body('section_header').optional({ values: 'null' }).trim().isLength({ max: 100 }),
    handleValidationErrors
  ]
};

// FIX: the admin page sends null for empty fields ("All Departments", no critical
// limits). optional() only skips undefined, so isInt()/isFloat() rejected null and
// EVERY range save failed with "Validation failed". { values: 'null' } skips both.
const NULLABLE = { values: 'null' };
const rangeFields = [
  body('DepartmentId').optional(NULLABLE).isInt(),
  body('Method').optional(NULLABLE).trim().isLength({ max: 100 }),
  body('Gender').optional(NULLABLE).isIn(['male', 'female', 'both', 'all']),
  body('AgeFrom').optional(NULLABLE).isFloat({ min: 0 }),
  body('AgeTo').optional(NULLABLE).isFloat({ min: 0 }),
  body('AgeUnit').optional(NULLABLE).isIn(['days', 'months', 'years']),
  body('MinValue').optional(NULLABLE).isFloat(),
  body('MaxValue').optional(NULLABLE).isFloat(),
  body('CriticalLow').optional(NULLABLE).isFloat(),
  body('CriticalHigh').optional(NULLABLE).isFloat(),
  body('Priority').optional(NULLABLE).isInt({ min: 0 }),
  body().custom(b => {
    const n = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
    if (n(b.MinValue) !== null && n(b.MaxValue) !== null && n(b.MinValue) > n(b.MaxValue)) throw new Error('Min value is greater than max value');
    if (n(b.AgeFrom) !== null && n(b.AgeTo) !== null && n(b.AgeFrom) >= n(b.AgeTo)) throw new Error('Age From must be less than Age To');
    return true;
  })
];
const rangeValidators = {
  create: [
    body('ParameterId').isInt().withMessage('Parameter ID required'),
    ...rangeFields,
    handleValidationErrors
  ],
  update: [
    param('id').isInt(),
    ...rangeFields,
    handleValidationErrors
  ]
};

const reportValidators = {
  create: [
    body('PatientTestRefferenceId').isInt().withMessage('Patient test reference required'),
    body('TestId').isInt().withMessage('Test ID required'),
    body('ReportType').optional().isIn(['routine', 'stat', 'culture', 'histopathology', 'cytopathology']),
    body('Urgency').optional().isIn(['normal', 'urgent', 'critical']),
    body('Remarks').optional().trim().isLength({ max: 1000 }),
    handleValidationErrors
  ],
  saveResults: [
    param('id').isInt(),
    body('results').isArray().withMessage('Results array required'),
    body('patient.age').optional().isFloat().withMessage('Patient age must be numeric'),
    // FIX: sanitize legacy DB encodings ('Y'/'M'/'D', '1'/'2'/'M'/'F') instead of rejecting.
    // Hard isIn() checks made every Save Draft fail with 400 "Validation failed".
    body('patient.ageUnit').optional().customSanitizer(v => {
      const u = (v || '').toString().toLowerCase().trim();
      if (['y','yr','yrs','year','years'].includes(u)) return 'years';
      if (['m','mo','mos','month','months'].includes(u)) return 'months';
      if (['d','day','days'].includes(u)) return 'days';
      return 'years';
    }),
    body('patient.gender').optional().customSanitizer(v => {
      const g = (v || '').toString().toLowerCase().trim();
      if (['1','m','male'].includes(g)) return 'male';
      if (['2','f','female'].includes(g)) return 'female';
      return g === 'female' || g === 'male' ? g : 'other';
    }),
    handleValidationErrors
  ],
  workflowAction: [
    param('id').isInt(),
    body('Remarks').optional().trim().isLength({ max: 1000 }),
    body('Reason').optional().trim().isLength({ max: 500 }),
    body('DeliveryMethod').optional().isIn(['print', 'email', 'portal', 'sms', 'whatsapp']),
    handleValidationErrors
  ]
};

const specimenValidators = {
  accept: [
    body('specimenId').optional({ values: 'falsy' }).isInt(),
    body('patientTestRefferenceId').optional({ values: 'falsy' }).isInt(),
    body('qualityCheckNotes').optional({ values: 'null' }).trim().isLength({ max: 500 }),
    handleValidationErrors
  ],
  reject: [
    body('specimenId').isInt().withMessage('Specimen ID required'),
    body('reason').trim().isLength({ min: 5, max: 500 }).withMessage('Reason must be 5-500 characters'),
    body('reasonCategory').optional().isIn(['hemolysis','clotting','insufficient_volume','wrong_container','labeling_error','other']),
    handleValidationErrors
  ],
  requirement: {
    create: [
      body('MainTestId').isInt(),
      body('SpecimenTypeId').isInt(),
      body('ContainerTypeId').isInt(),
      body('MinVolume').optional({ values: 'null' }).isFloat({ min: 0 }),
      body('MaxVolume').optional({ values: 'null' }).isFloat({ min: 0 }),
      body('Inversions').optional().isInt({ min: 0 }),
      body('DepartmentId').optional({ values: 'null' }).isInt(),
      handleValidationErrors
    ]
  }
};

module.exports = {
  handleValidationErrors,
  departmentValidators,
  parameterValidators,
  rangeValidators,
  reportValidators,
  specimenValidators
};
/**
 * Pathology Validators - Using express-validator
 */

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
    body('section_header').optional().trim().isLength({ max: 100 }),
    handleValidationErrors
  ]
};

const rangeValidators = {
  create: [
    body('ParameterId').isInt().withMessage('Parameter ID required'),
    body('DepartmentId').optional().isInt(),
    body('Method').optional().trim().isLength({ max: 100 }),
    body('Gender').optional().isIn(['male', 'female', 'both', 'all']),
    body('AgeFrom').optional().isFloat({ min: 0 }),
    body('AgeTo').optional().isFloat({ min: 0 }),
    body('AgeUnit').optional().isIn(['days', 'months', 'years']),
    body('MinValue').optional().isFloat(),
    body('MaxValue').optional().isFloat(),
    body('CriticalLow').optional().isFloat(),
    body('CriticalHigh').optional().isFloat(),
    body('Priority').optional().isInt({ min: 0 }),
    handleValidationErrors
  ],
  update: [
    param('id').isInt(),
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
    body('patient.age').isFloat().withMessage('Patient age required'),
    body('patient.ageUnit').optional().isIn(['days', 'months', 'years']),
    body('patient.gender').isIn(['male', 'female', 'other']).withMessage('Gender required'),
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

module.exports = { handleValidationErrors, departmentValidators, parameterValidators, rangeValidators, reportValidators };
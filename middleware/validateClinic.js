const { body, check, validationResult } = require('express-validator');

const validateClinicInput = [
  body('ClinicName').notEmpty().withMessage('Clinic Name is required'),
  body('Email').isEmail().withMessage('Valid Email is required'),
  body('PhoneNumber')
    .isLength({ min: 10, max: 10 })
    .withMessage('Phone Number should be 10 digits'),
  body('Address').notEmpty().withMessage('Address is required'),
  body('Pincode')
    .isLength({ min: 6, max: 6 })
    .withMessage('Pin Code should be 6 digits'),
  body('City').notEmpty().withMessage('City is required'),
  body('KeyArea').notEmpty().withMessage('Key Area is required'),
  body('State').notEmpty().withMessage('State is required'),
  body('LandMark').notEmpty().withMessage('Landmark is required'),
  body('SecondaryNumber')
    .optional()
    .isLength({ min: 10, max: 10 })
    .withMessage('Secondary Phone Number should be 10 digits'),

  check('files')
    .custom((value, { req }) => {
      const files = req.files && req.files.clinicPrescription;
      if (!files || files.length === 0) {
        throw new Error('Kindly Upload Clinic Prescription');
      }
      return true;
    }),

  check('files')
    .custom((value, { req }) => {
      const files = req.files && req.files.clinicPrescription;
      const file = files && files[0]; // Multer wraps single files in an array
      if (file && !file.mimetype.match(/^image\//)) {
        throw new Error('Kindly Upload only an image file for clinic prescription');
      }
      return true;
    }),

  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.validationErrors = errors.array(); // Store errors in request object
    }
    next(); // Proceed to controller
  }
];

module.exports = validateClinicInput;
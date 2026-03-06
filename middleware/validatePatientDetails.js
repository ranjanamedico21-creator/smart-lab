

/*const validateUserInput = [
    // Validation rules
    check('grossAmount')
        .isFloat({ min: 0 })
        .withMessage('Gross Amount should be greater than or equal to 0.')
        .toFloat(),

    check('cashPayment')
        .optional()
        .isFloat({ min: 0 })
        .withMessage('Cash Payment should be greater than or equal to 0.')
        .toFloat(),

    check('onlinePayment')
        .optional()
        .isFloat({ min: 0 })
        .withMessage('Online Payment should be greater than or equal to 0.')
        .toFloat(),

    check('discount')
        .optional()
        .isFloat({ min: 0 })
        .withMessage('Discount should be greater than or equal to 0.')
        .toFloat(),

    // Custom validation for total amount
    (req, res, next) => {

        console.log(req.body)
        const { cashPayment = 0, onlinePayment = 0, grossAmount = 0 } = req.body;
        const totalAmount = cashPayment + onlinePayment;

        if (totalAmount > grossAmount) {
            // Store the custom error in res.locals
            res.locals.validationErrors = [{ msg: 'Total Paid Amount cannot be greater than the Gross amount.' }];
        }

        next();
    },

    // Handle validation errors
    (req, res, next) => {
        const errors = validationResult(req);

        // If there are validation errors, store them in res.locals
        if (!errors.isEmpty()) {
            res.locals.validationErrors = (res.locals.validationErrors || []).concat(errors.array());
        }

        // Pass control to the next middleware (controller)
        next();
    }
];

module.exports = validateUserInput;*/


const { check, validationResult } = require('express-validator');

const validateUserInput = [
    // Validation rules
    check('grossAmount')
        .isFloat({ min: 0 })
        .withMessage('Gross Amount should be greater than or equal to 0.')
        .toFloat(),

    check('cashPayment')
        .optional()
        .isFloat({ min: 0 })
        .withMessage('Cash Payment should be greater than or equal to 0.')
        .toFloat(),

    check('onlinePayment')
        .optional()
        .isFloat({ min: 0 })
        .withMessage('Online Payment should be greater than or equal to 0.')
        .toFloat(),

    check('discount')
        .optional()
        .isFloat({ min: 0 })
        .withMessage('Discount should be greater than or equal to 0.')
        .toFloat(),

    // Custom validation for total paid amount
    (req, res, next) => {
        const errors = validationResult(req);
        let validationErrors = errors.array(); // Collect validation errors

        // Convert values explicitly to numbers
        const grossAmount = parseFloat(req.body.grossAmount) || 0;
        const cashPayment = parseFloat(req.body.cashPayment) || 0;
        const onlinePayment = parseFloat(req.body.onlinePayment) || 0;
        const totalAmount = cashPayment + onlinePayment;

        if (totalAmount > grossAmount) {
            validationErrors.push({ msg: 'Total Paid Amount cannot be greater than the Gross amount.' });
        }

        if (validationErrors.length > 0) {
            req.validationErrors = validationErrors; // Store errors in `req` object
        }

        next(); // Pass control to the controller
    }
];

module.exports = validateUserInput;


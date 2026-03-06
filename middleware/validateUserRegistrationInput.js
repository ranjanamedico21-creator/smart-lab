const { body } = require('express-validator');

// Middleware for validation using express-validator
const validateUserData = [
    body("FirstName").notEmpty().withMessage("First Name is required."),
    body("LastName").notEmpty().withMessage("Last Name is required."),
    body("Email").isEmail().withMessage("Invalid email format."),
    body("JoiningDate").notEmpty().withMessage("Joining date is required."),
    body("Password").isLength({ min: 6 }).withMessage("Password must be at least 6 characters."),
    body("ConfirmPassword")
      .custom((value, { req }) => value === req.body.Password)
      .withMessage("Passwords do not match."),
    body("PhoneNumber")
      .isLength({ min: 10, max: 10 })
      .withMessage("Phone Number must be 10 digits."),
    body("Gender").notEmpty().withMessage("Gender is required."),
  ];
  
  module.exports =  validateUserData 
  
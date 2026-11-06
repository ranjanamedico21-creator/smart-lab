'use strict';

/**
 * errorMiddleware.js
 *
 * Central Express error handler.  Mount this LAST in app.js, after all routes:
 *
 *   const { errorHandler } = require('./middleware/errorMiddleware');
 *   app.use(errorHandler);
 *
 * Works with asyncHandler() in patientController.js — any unhandled async
 * error is forwarded to next(err) and lands here instead of crashing the process.
 */

const errorHandler = (err, req, res, next) => {  // eslint-disable-line no-unused-vars
    console.error('[errorHandler]', {
        message: err.message,
        stack:   process.env.NODE_ENV === 'production' ? '(hidden in prod)' : err.stack,
        path:    req.path,
        method:  req.method,
    });

    // If headers already sent (e.g. streaming response), delegate to default
    if (res.headersSent) return next(err);

    const status = err.status || err.statusCode || 500;

    // JSON / AJAX requests
    if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(status).json({
            success: false,
            message: process.env.NODE_ENV === 'production'
                ? 'An unexpected error occurred.'
                : err.message,
        });
    }

    // HTML requests — render home with error notification
    return res.status(status).render('home', {
        notifications: [{
            type:            'danger',
            messages:        process.env.NODE_ENV === 'production'
                             ? 'An unexpected error occurred. Please try again.'
                             : err.message,
            icon:            'bi-exclamation-triangle-fill',
            alertDismissible: true,
        }],
        title:      'Error',
        BRAND_NAME:  process.env.BRAND_NAME,
        layout:     'loggedInLayout',
    });
};

module.exports = { errorHandler };

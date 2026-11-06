/**
 * Reuse your existing logger (winston/pino) if you have one — this stub
 * exists so every service in this module has a consistent `logger.info/
 * warn/error` API without a hard dependency.
 */
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}] ${message}`),
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/usg-module.log' }),
  ],
});

module.exports = logger;

import winston from 'winston';
import path from 'path';
import fs from 'fs';
import { config } from '../config';

/**
 * Application logger.
 *
 * winston has been a dependency all along but was never imported: every log
 * line went to the console unstructured, with no levels, no timestamps in
 * production, and nothing written to LOG_FILE despite it being configured.
 * That makes incidents hard to reconstruct - which matters for a lender that
 * needs to explain what happened to a borrower's money.
 *
 * Console output stays human-readable in development and switches to JSON in
 * production so a log shipper can parse it.
 */

const logDir = path.dirname(config.logging.file);

// Winston will not create the directory itself; a missing one silently drops
// file output.
try {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
} catch (error) {
  console.warn(`Could not create log directory ${logDir}:`, error);
}

const isProduction = config.nodeEnv === 'production';

/** Keys whose values must never be written to a log file. */
const REDACTED_KEYS = new Set([
  'password',
  'newPassword',
  'oldPassword',
  'currentPassword',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'secret',
  'authorization',
  'pin',
  'otp',
]);

/**
 * Strip credentials from structured metadata before it is persisted, mirroring
 * the redaction applied to audit records.
 */
const redact = winston.format(info => {
  const scrub = (value: unknown, depth = 0): unknown => {
    if (depth > 6 || value === null || typeof value !== 'object') {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map(v => scrub(v, depth + 1));
    }
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = REDACTED_KEYS.has(key) ? '[REDACTED]' : scrub(val, depth + 1);
    }
    return out;
  };

  return scrub(info) as winston.Logform.TransformableInfo;
});

const consoleFormat = isProduction
  ? winston.format.combine(
      winston.format.timestamp(),
      redact(),
      winston.format.json()
    )
  : winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp({ format: 'HH:mm:ss' }),
      redact(),
      winston.format.printf(({ level, message, timestamp, ...meta }) => {
        const extra = Object.keys(meta).length
          ? ` ${JSON.stringify(meta)}`
          : '';
        return `${timestamp} ${level}: ${message}${extra}`;
      })
    );

export const logger = winston.createLogger({
  level: config.logging.level,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    redact(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({ format: consoleFormat }),
    new winston.transports.File({
      filename: config.logging.file,
      maxsize: 10 * 1024 * 1024, // 10 MB
      maxFiles: 5,
      tailable: true,
    }),
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
      tailable: true,
    }),
  ],
  // Keep the process alive if a transport fails rather than crashing the API.
  exitOnError: false,
});

export default logger;

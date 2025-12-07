import crypto from 'crypto';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { config } from '../config';

/**
 * Generate a secure API key
 */
export const generateApiKey = (): string => {
  const prefix = 'mk_'; // microfinex key prefix
  const randomBytes = crypto.randomBytes(32);
  const key = randomBytes.toString('hex');
  return `${prefix}${key}`;
};

/**
 * Generate a secure random token
 */
export const generateSecureToken = (length: number = 32): string => {
  return crypto.randomBytes(length).toString('hex');
};

/**
 * Hash a string using SHA-256
 */
export const hashString = (input: string): string => {
  return crypto.createHash('sha256').update(input).digest('hex');
};

/**
 * Generate a verification token
 */
export const generateVerificationToken = (): string => {
  return crypto.randomBytes(32).toString('hex');
};

/**
 * Security headers middleware
 */
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https:'],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
});

/**
 * Rate limiting middleware
 */
export const rateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  message: {
    success: false,
    message: 'Too many requests, please try again later',
    error: 'RATE_LIMIT_EXCEEDED',
    timestamp: new Date().toISOString(),
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Strict rate limiting for authentication endpoints
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 5 requests per windowMs
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again later',
    error: 'AUTH_RATE_LIMIT_EXCEEDED',
    timestamp: new Date().toISOString(),
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Generate a secure session ID
 */
export const generateSessionId = (): string => {
  return crypto.randomBytes(32).toString('hex');
};

/**
 * Validate API key format
 */
export const isValidApiKeyFormat = (apiKey: string): boolean => {
  const apiKeyRegex = /^mk_[a-f0-9]{64}$/;
  return apiKeyRegex.test(apiKey);
};

/**
 * Generate CSRF token
 */
export const generateCSRFToken = (): string => {
  return crypto.randomBytes(16).toString('hex');
};

/**
 * Time-safe string comparison to prevent timing attacks
 */
export const safeCompare = (a: string, b: string): boolean => {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
};

/**
 * Sanitize file name to prevent path traversal
 */
export const sanitizeFileName = (fileName: string): string => {
  // Remove path separators and dangerous characters
  return fileName
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\.\./g, '')
    .replace(/^\.+/, '')
    .trim();
};

/**
 * Generate password reset token
 */
export const generatePasswordResetToken = (): {
  token: string;
  hashedToken: string;
  expiresAt: Date;
} => {
  const token = crypto.randomBytes(32).toString('hex');
  const hashedToken = hashString(token);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  return {
    token,
    hashedToken,
    expiresAt,
  };
};

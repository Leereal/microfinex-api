import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const isProduction = (process.env.NODE_ENV || 'development') === 'production';

/**
 * Resolve a secret that must never fall back to a hardcoded literal.
 *
 * A checked-in default (the previous 'fallback_secret_key') means that any
 * deployment missing the environment variable silently signs and accepts
 * tokens under a value published in this repository - anyone could mint a
 * valid admin token. In production we refuse to start; in development we
 * generate a random per-process secret, which keeps local work frictionless
 * while guaranteeing the value is never a known constant. Note that a
 * generated secret changes on restart, so local sessions will not survive one.
 */
function requireSecret(name: string): string {
  const value = process.env[name];

  if (value && value.trim().length > 0) {
    return value;
  }

  if (isProduction) {
    throw new Error(
      `${name} is not set. Refusing to start: falling back to a default ` +
        `secret would let anyone forge authentication tokens.`
    );
  }

  const generated = crypto.randomBytes(48).toString('hex');
  console.warn(
    `⚠️  ${name} is not set. Generated a random development secret. ` +
      `Tokens will be invalidated on restart. Set ${name} in your .env file.`
  );
  return generated;
}

interface Config {
  port: number;
  nodeEnv: string;
  databaseUrl: string;
  supabase: {
    url: string;
    anonKey: string;
    serviceRoleKey: string;
  };
  jwt: {
    secret: string;
    refreshSecret: string;
    expiresIn: string;
    refreshExpiresIn: string;
    issuer: string;
    audience: string;
  };
  redis: {
    url: string;
  };
  email: {
    host: string;
    port: number;
    user: string;
    pass: string;
  };
  upload: {
    maxFileSize: number;
    uploadPath: string;
  };
  rateLimit: {
    windowMs: number;
    maxRequests: number;
  };
  logging: {
    level: string;
    file: string;
  };
  api: {
    title: string;
    version: string;
    description: string;
  };
}

export const config: Config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || '',

  supabase: {
    url: process.env.SUPABASE_URL || '',
    anonKey: process.env.SUPABASE_ANON_KEY || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  },

  jwt: {
    secret: requireSecret('JWT_SECRET'),
    refreshSecret: requireSecret('JWT_REFRESH_SECRET'),
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
    issuer: process.env.JWT_ISSUER || 'microfinex-api',
    audience: process.env.JWT_AUDIENCE || 'microfinex-client',
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  email: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },

  upload: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '5242880', 10), // 5MB
    uploadPath: process.env.UPLOAD_PATH || './uploads',
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 minutes
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || './logs/app.log',
  },

  api: {
    title: process.env.API_TITLE || 'Microfinex API',
    version: process.env.API_VERSION || '1.0.0',
    description:
      process.env.API_DESCRIPTION ||
      'Modern Microfinance Management System API',
  },
};

export default config;

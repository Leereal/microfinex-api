import dotenv from 'dotenv';

dotenv.config();

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
    secret: process.env.JWT_SECRET || 'fallback_secret_key',
    refreshSecret:
      process.env.JWT_REFRESH_SECRET || 'fallback_refresh_secret_key',
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

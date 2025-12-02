import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../config/supabase-enhanced';

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests per window
  message?: string;
  keyGenerator?: (req: Request) => string;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// In-memory store for rate limiting (use Redis in production)
const rateLimitStore: Map<string, RateLimitEntry> = new Map();

// Tier-based rate limits
const RATE_LIMIT_TIERS: Record<string, { windowMs: number; maxRequests: number }> = {
  free: { windowMs: 60000, maxRequests: 30 }, // 30 requests per minute
  basic: { windowMs: 60000, maxRequests: 100 }, // 100 requests per minute
  professional: { windowMs: 60000, maxRequests: 300 }, // 300 requests per minute
  enterprise: { windowMs: 60000, maxRequests: 1000 }, // 1000 requests per minute
  admin: { windowMs: 60000, maxRequests: 5000 }, // 5000 requests per minute
  default: { windowMs: 60000, maxRequests: 60 }, // 60 requests per minute
};

// Role-based limits
const ROLE_LIMITS: Record<string, number> = {
  admin: 5000,
  manager: 500,
  loan_officer: 300,
  teller: 200,
  user: 100,
};

/**
 * Get rate limit key from request
 */
function getDefaultKey(req: Request): string {
  const userId = (req as any).user?.id;
  const apiKeyId = (req as any).apiKey?.id;
  const ip = req.ip || req.socket.remoteAddress || 'unknown';

  if (userId) return `user:${userId}`;
  if (apiKeyId) return `apikey:${apiKeyId}`;
  return `ip:${ip}`;
}

/**
 * Clean up expired entries periodically
 */
function cleanupExpiredEntries(): void {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupExpiredEntries, 5 * 60 * 1000);

/**
 * Generic rate limit middleware
 */
export function rateLimit(config: RateLimitConfig) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const key = config.keyGenerator ? config.keyGenerator(req) : getDefaultKey(req);
      const now = Date.now();

      let entry = rateLimitStore.get(key);

      if (!entry || entry.resetAt < now) {
        // Create new entry
        entry = {
          count: 1,
          resetAt: now + config.windowMs,
        };
        rateLimitStore.set(key, entry);
      } else {
        // Increment count
        entry.count++;
      }

      // Set rate limit headers
      const remaining = Math.max(0, config.maxRequests - entry.count);
      const resetSeconds = Math.ceil((entry.resetAt - now) / 1000);

      res.setHeader('X-RateLimit-Limit', config.maxRequests);
      res.setHeader('X-RateLimit-Remaining', remaining);
      res.setHeader('X-RateLimit-Reset', resetSeconds);

      if (entry.count > config.maxRequests) {
        res.setHeader('Retry-After', resetSeconds);
        res.status(429).json({
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: config.message || 'Too many requests. Please try again later.',
            retryAfter: resetSeconds,
          },
        });
        return;
      }

      next();
    } catch (error: any) {
      console.error('Rate limit middleware error:', error);
      next();
    }
  };
}

/**
 * User-based rate limiting with tier awareness
 */
export async function userRateLimit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = (req as any).user;
    const apiKey = (req as any).apiKey;

    let tier = 'default';
    const defaultTier = RATE_LIMIT_TIERS['default'] || { maxRequests: 60, windowMs: 60000 };
    let maxRequests = defaultTier.maxRequests;
    let windowMs = defaultTier.windowMs;

    if (apiKey?.rateLimit) {
      // API key has custom rate limit
      maxRequests = apiKey.rateLimit;
      tier = 'custom';
    } else if (user) {
      // Get user's tier from organization or user settings
      const { data: org } = await supabaseAdmin
        .from('organizations')
        .select('settings')
        .eq('id', user.organizationId)
        .single();

      tier = org?.settings?.tier || 'default';
      const tierConfig = RATE_LIMIT_TIERS[tier];
      if (tierConfig) {
        maxRequests = tierConfig.maxRequests;
        windowMs = tierConfig.windowMs;
      }

      // Apply role-based adjustment
      const roleLimit = ROLE_LIMITS[user.role];
      if (roleLimit) {
        maxRequests = Math.min(maxRequests, roleLimit);
      }
    }

    const key = user?.id ? `user:${user.id}` : apiKey?.id ? `apikey:${apiKey.id}` : `ip:${req.ip}`;
    const now = Date.now();

    let entry = rateLimitStore.get(key);

    if (!entry || entry.resetAt < now) {
      entry = { count: 1, resetAt: now + windowMs };
      rateLimitStore.set(key, entry);
    } else {
      entry.count++;
    }

    const remaining = Math.max(0, maxRequests - entry.count);
    const resetSeconds = Math.ceil((entry.resetAt - now) / 1000);

    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', resetSeconds);
    res.setHeader('X-RateLimit-Tier', tier);

    if (entry.count > maxRequests) {
      // Log rate limit event
      await supabaseAdmin.from('audit_logs').insert({
        userId: user?.id,
        action: 'RATE_LIMIT_EXCEEDED',
        resource: 'api',
        resourceId: req.path,
        newValue: { 
          tier, 
          limit: maxRequests, 
          count: entry.count,
          ip: req.ip,
          path: req.path,
        },
      });

      res.setHeader('Retry-After', resetSeconds);
      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Rate limit exceeded. Please slow down your requests.',
          tier,
          limit: maxRequests,
          retryAfter: resetSeconds,
        },
      });
      return;
    }

    next();
  } catch (error: any) {
    console.error('User rate limit error:', error);
    next();
  }
}

/**
 * Endpoint-specific rate limiting
 */
export function endpointRateLimit(endpoint: string, maxRequests: number, windowMs: number = 60000) {
  return rateLimit({
    windowMs,
    maxRequests,
    keyGenerator: (req: Request) => {
      const userId = (req as any).user?.id || req.ip;
      return `${endpoint}:${userId}`;
    },
    message: `Too many requests to ${endpoint}. Please try again later.`,
  });
}

/**
 * Login attempt rate limiting
 */
export const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 5, // 5 attempts
  keyGenerator: (req: Request) => `login:${req.ip}:${req.body?.email || 'unknown'}`,
  message: 'Too many login attempts. Please try again in 15 minutes.',
});

/**
 * Password reset rate limiting
 */
export const passwordResetRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: 3, // 3 attempts
  keyGenerator: (req: Request) => `password-reset:${req.body?.email || req.ip}`,
  message: 'Too many password reset requests. Please try again in 1 hour.',
});

/**
 * Registration rate limiting
 */
export const registrationRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: 5, // 5 registrations per IP
  keyGenerator: (req: Request) => `register:${req.ip}`,
  message: 'Too many registration attempts from this IP. Please try again later.',
});

/**
 * API key creation rate limiting
 */
export const apiKeyCreationRateLimit = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  maxRequests: 10, // 10 keys per day
  keyGenerator: (req: Request) => `apikey-create:${(req as any).user?.id || req.ip}`,
  message: 'API key creation limit reached. Please try again tomorrow.',
});

/**
 * File upload rate limiting
 */
export const uploadRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: 50, // 50 uploads per hour
  keyGenerator: (req: Request) => `upload:${(req as any).user?.id || req.ip}`,
  message: 'Upload limit reached. Please try again later.',
});

/**
 * Get current rate limit status
 */
export function getRateLimitStatus(key: string): { count: number; remaining: number; resetAt: Date } | null {
  const entry = rateLimitStore.get(key);
  if (!entry) return null;

  const tierConfig = RATE_LIMIT_TIERS['default'] || { maxRequests: 60, windowMs: 60000 };
  return {
    count: entry.count,
    remaining: Math.max(0, tierConfig.maxRequests - entry.count),
    resetAt: new Date(entry.resetAt),
  };
}

/**
 * Reset rate limit for a key (admin action)
 */
export function resetRateLimit(key: string): boolean {
  return rateLimitStore.delete(key);
}

/**
 * Get all rate limit entries (for monitoring)
 */
export function getAllRateLimits(): Array<{ key: string; count: number; resetAt: Date }> {
  const entries: Array<{ key: string; count: number; resetAt: Date }> = [];
  for (const [key, entry] of rateLimitStore.entries()) {
    entries.push({ key, count: entry.count, resetAt: new Date(entry.resetAt) });
  }
  return entries;
}

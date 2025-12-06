import { Request, Response, NextFunction } from 'express';
import {
  supabase,
  supabaseAdmin,
  getUserWithContext,
} from '../config/supabase-enhanced';
import { UserRole, JWTPayload } from '../types';
import { validateApiKeyIP } from './api-key-ip-whitelist.middleware';
import { userRateLimit } from './rate-limit.middleware';
import { passwordPolicyService } from '../services/security/password-policy.service';
import { sessionManagementService } from '../services/security/session-management.service';
import { verifyToken } from '../utils/auth';

// User context interface
export interface UserContext {
  id: string;
  email: string;
  role: UserRole;
  organizationId?: string;
  supabaseUser: any;
  appUser: any;
}

// Extend Express Request type to include user context
declare global {
  namespace Express {
    interface Request {
      userContext?: UserContext;
    }
  }
}

/**
 * Enhanced authentication middleware for Supabase integration
 * Now supports both Supabase tokens and custom JWT tokens
 */
export const authenticateSupabase = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        message: 'No token provided',
        error: 'UNAUTHORIZED',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // First, try to verify as our custom JWT token
    let userContext = null;
    let jwtPayload: JWTPayload | null = null;

    try {
      jwtPayload = verifyToken(token);
      // If custom JWT verification succeeds, get user from database
      if (jwtPayload && jwtPayload.userId) {
        const { data: userData, error } = await supabaseAdmin
          .from('users')
          .select(
            `
            *,
            organization:organizations(*)
          `
          )
          .eq('id', jwtPayload.userId)
          .single();

        if (!error && userData) {
          userContext = {
            supabaseUser: { id: jwtPayload.userId, email: jwtPayload.email },
            appUser: userData,
          };
        }
      }
    } catch (jwtError) {
      // Custom JWT verification failed, try Supabase token
      userContext = await getUserWithContext(token);
    }

    if (!userContext) {
      res.status(401).json({
        success: false,
        message: 'Invalid or expired token',
        error: 'UNAUTHORIZED',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const { supabaseUser, appUser } = userContext;

    // Check if user is active in our system
    if (!appUser.isActive) {
      res.status(401).json({
        success: false,
        message: 'User account is inactive',
        error: 'ACCOUNT_INACTIVE',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Set user context on request
    req.userContext = {
      id: supabaseUser.id,
      email: supabaseUser.email || '',
      role: appUser.role as UserRole,
      organizationId: appUser.organizationId,
      supabaseUser,
      appUser,
    };

    // Also set on req.user for compatibility with other middleware
    (req as any).user = {
      id: supabaseUser.id,
      email: supabaseUser.email || '',
      role: appUser.role as UserRole,
      organizationId: appUser.organizationId,
      isEmailVerified: appUser.isEmailVerified || false,
    };

    // Check password expiration (optional warning, not blocking)
    const passwordCheck = await passwordPolicyService.isPasswordExpired(
      supabaseUser.id
    );
    if (!passwordCheck.success && passwordCheck.error === 'PASSWORD_EXPIRED') {
      res.setHeader('X-Password-Expired', 'true');
      res.setHeader(
        'X-Password-Expired-Message',
        'Your password has expired. Please change it.'
      );
    } else if (passwordCheck.data?.warningThreshold) {
      res.setHeader('X-Password-Expires-Soon', 'true');
      res.setHeader(
        'X-Password-Days-Until-Expiry',
        passwordCheck.data.daysUntilExpiry
      );
    }

    // Validate and update session activity (non-blocking)
    // This updates the lastActivityAt timestamp for the session
    try {
      const sessionResult =
        await sessionManagementService.validateSessionByToken(token);
      if (sessionResult.success && sessionResult.data?.sessionId) {
        // Attach session info to request for potential logout operations
        (req as any).sessionId = sessionResult.data.sessionId;
      }
      // If session validation fails, we don't block - the JWT is still valid
      // This allows backward compatibility during migration
    } catch (sessionError) {
      // Silent fail - session tracking is optional
      console.debug('Session tracking unavailable:', sessionError);
    }

    // Update last login timestamp
    await supabaseAdmin
      .from('users')
      .update({ lastLoginAt: new Date().toISOString() })
      .eq('id', supabaseUser.id);

    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({
      success: false,
      message: 'Authentication service error',
      error: 'AUTH_SERVICE_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
};

/**
 * Enhanced authorization middleware with role-based access control
 */
export const authorizeSupabase = (...allowedRoles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    console.log('[Auth] authorizeSupabase called, allowedRoles:', allowedRoles);
    console.log(
      '[Auth] req.userContext:',
      req.userContext ? { role: req.userContext.role } : 'undefined'
    );

    if (!req.userContext) {
      console.log('[Auth] No userContext, returning 401');
      res.status(401).json({
        success: false,
        message: 'Authentication required',
        error: 'UNAUTHORIZED',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (!allowedRoles.includes(req.userContext.role)) {
      const errorResponse = {
        success: false,
        message: 'Insufficient permissions',
        error: 'FORBIDDEN',
        requiredRoles: allowedRoles,
        userRole: req.userContext.role,
        timestamp: new Date().toISOString(),
      };
      console.log('[Auth] Role not allowed, returning 403');
      console.log(
        '[Auth] 403 Forbidden response:',
        JSON.stringify(errorResponse)
      );
      res.status(403).json(errorResponse);
      return;
    }

    console.log('[Auth] Role allowed, calling next()');
    next();
  };
};

/**
 * Organization scope middleware - ensures users can only access their org's data
 */
export const requireOrganization = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!req.userContext) {
    res.status(401).json({
      success: false,
      message: 'Authentication required',
      error: 'UNAUTHORIZED',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (
    !req.userContext.organizationId &&
    req.userContext.role !== UserRole.SUPER_ADMIN
  ) {
    res.status(403).json({
      success: false,
      message: 'User must be associated with an organization',
      error: 'NO_ORGANIZATION',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  next();
};

/**
 * API Key authentication middleware (for external integrations)
 */
export const authenticateApiKey = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const apiKey = req.headers['x-api-key'] || req.query.api_key;

    if (!apiKey || typeof apiKey !== 'string') {
      res.status(401).json({
        success: false,
        message: 'API key required',
        error: 'API_KEY_REQUIRED',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Verify API key in database
    const { data: apiKeyRecord, error } = await supabaseAdmin
      .from('api_keys')
      .select(
        `
        *,
        organization:organizations(*)
      `
      )
      .eq('key', apiKey)
      .eq('isActive', true)
      .single();

    if (error || !apiKeyRecord) {
      res.status(401).json({
        success: false,
        message: 'Invalid API key',
        error: 'INVALID_API_KEY',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Set API context on request
    req.userContext = {
      id: 'api-key-user',
      email: 'api@system.com',
      role: UserRole.API_CLIENT,
      organizationId: apiKeyRecord.organizationId,
      supabaseUser: null,
      appUser: {
        apiKey: apiKeyRecord,
        organization: apiKeyRecord.organization,
      },
    };

    // Set on req.apiKey for IP whitelist middleware
    (req as any).apiKey = {
      id: apiKeyRecord.id,
      organizationId: apiKeyRecord.organizationId,
      rateLimit: apiKeyRecord.rateLimit,
      settings: apiKeyRecord.settings || {},
    };

    // Validate IP whitelist for API key
    const clientIP = req.ip || req.socket.remoteAddress || '';
    if (apiKeyRecord.settings?.ipWhitelistEnabled) {
      const { apiKeyIPWhitelistService } = await import(
        './api-key-ip-whitelist.middleware'
      );
      const ipValidation = await apiKeyIPWhitelistService.validateIP(
        apiKeyRecord.id,
        clientIP
      );

      if (!ipValidation.allowed) {
        // Log blocked access attempt
        await supabaseAdmin.from('audit_logs').insert({
          action: 'API_KEY_IP_BLOCKED',
          resource: 'api_keys',
          resourceId: apiKeyRecord.id,
          newValue: {
            ip: clientIP,
            reason: ipValidation.reason,
            path: req.path,
          },
        });

        res.status(403).json({
          success: false,
          message: 'Access denied: IP address not whitelisted for this API key',
          error: 'IP_NOT_ALLOWED',
          timestamp: new Date().toISOString(),
        });
        return;
      }
    }

    // Update API key usage
    await supabaseAdmin
      .from('api_keys')
      .update({
        last_used_at: new Date().toISOString(),
        usage_count: apiKeyRecord.usage_count + 1,
      })
      .eq('id', apiKeyRecord.id);

    next();
  } catch (error) {
    console.error('API key authentication error:', error);
    res.status(500).json({
      success: false,
      message: 'API authentication service error',
      error: 'API_AUTH_SERVICE_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
};

/**
 * Combined authentication middleware (supports both JWT and API Key)
 */
export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const hasApiKey = req.headers['x-api-key'] || req.query.api_key;
  const hasBearerToken = req.headers.authorization?.startsWith('Bearer ');

  if (hasApiKey) {
    await authenticateApiKey(req, res, next);
  } else if (hasBearerToken) {
    await authenticateSupabase(req, res, next);
  } else {
    res.status(401).json({
      success: false,
      message: 'Authentication required - provide Bearer token or API key',
      error: 'AUTHENTICATION_REQUIRED',
      timestamp: new Date().toISOString(),
    });
  }
};

// Re-export for backward compatibility
export const authorize = authorizeSupabase;

/**
 * Email verification required middleware
 */
export const requireEmailVerification = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const user = (req as any).user || req.userContext;

  if (!user) {
    res.status(401).json({
      success: false,
      message: 'Authentication required',
      error: 'UNAUTHORIZED',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const isVerified = user.isEmailVerified || user.appUser?.isEmailVerified;

  if (!isVerified) {
    res.status(403).json({
      success: false,
      message:
        'Email verification required. Please verify your email to access this resource.',
      error: 'EMAIL_NOT_VERIFIED',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  next();
};

/**
 * Combined security middleware that applies rate limiting and authentication
 */
export const secureRoute = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  // First apply rate limiting
  await new Promise<void>((resolve, reject) => {
    userRateLimit(req, res, (err?: any) => {
      if (err) reject(err);
      else resolve();
    });
  });

  // Then authenticate
  await authenticate(req, res, next);
};

import { Request, Response, NextFunction } from 'express';
import {
  supabase,
  supabaseAdmin,
  getUserWithContext,
} from '../config/supabase-enhanced';
import { UserRole } from '../types';

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

    // Verify token with Supabase and get user context
    const userContext = await getUserWithContext(token);

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
    if (!req.userContext) {
      res.status(401).json({
        success: false,
        message: 'Authentication required',
        error: 'UNAUTHORIZED',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (!allowedRoles.includes(req.userContext.role)) {
      res.status(403).json({
        success: false,
        message: 'Insufficient permissions',
        error: 'FORBIDDEN',
        requiredRoles: allowedRoles,
        userRole: req.userContext.role,
        timestamp: new Date().toISOString(),
      });
      return;
    }

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

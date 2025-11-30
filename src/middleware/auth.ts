import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { prisma } from '../config/database';
import { supabase } from '../config/supabase';
import { JWTPayload, UserRole, ApiTier } from '../types';

export interface AuthenticatedRequest extends Request {
  user: JWTPayload;
}

/**
 * JWT Authentication Middleware
 */
export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        message: 'Access token required',
        error: 'UNAUTHORIZED',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const token = authHeader.substring(7);

    // Verify JWT token
    const decoded = jwt.verify(token, config.jwt.secret) as JWTPayload;

    // Check if user still exists and is active
    const user = await prisma.user.findFirst({
      where: {
        id: decoded.userId,
        isActive: true,
      },
      include: {
        organization: true,
      },
    });

    if (!user) {
      res.status(401).json({
        success: false,
        message: 'Invalid or expired token',
        error: 'UNAUTHORIZED',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // Attach user to request
    req.user = {
      userId: user.id,
      email: user.email,
      role: user.role as UserRole,
      organizationId: user.organizationId || undefined,
      permissions: user.permissions,
      tier: (user.organization?.apiTier as ApiTier) || ApiTier.BASIC,
    };

    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      message: 'Invalid token',
      error: 'UNAUTHORIZED',
      timestamp: new Date().toISOString(),
    });
  }
};

/**
 * Supabase Authentication Middleware (Alternative)
 */
export const authenticateSupabase = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      res.status(401).json({
        success: false,
        message: 'Access token required',
        error: 'UNAUTHORIZED',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      res.status(401).json({
        success: false,
        message: 'Invalid or expired token',
        error: 'UNAUTHORIZED',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Get user details from database
    const dbUser = await prisma.user.findFirst({
      where: {
        email: user.email || '',
        isActive: true,
      },
      include: {
        organization: true,
      },
    });

    if (!dbUser) {
      res.status(401).json({
        success: false,
        message: 'User not found in system',
        error: 'UNAUTHORIZED',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    req.user = {
      userId: dbUser.id,
      email: dbUser.email,
      role: dbUser.role as UserRole,
      organizationId: dbUser.organizationId || undefined,
      permissions: dbUser.permissions,
      tier: (dbUser.organization?.apiTier as ApiTier) || ApiTier.BASIC,
    };

    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      message: 'Authentication failed',
      error: 'UNAUTHORIZED',
      timestamp: new Date().toISOString(),
    });
  }
};

/**
 * Role-based Authorization Middleware
 */
export const authorize = (...roles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user;

    if (!user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required',
        error: 'UNAUTHORIZED',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (!roles.includes(user.role)) {
      res.status(403).json({
        success: false,
        message: 'Insufficient permissions',
        error: 'FORBIDDEN',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    next();
  };
};

/**
 * Permission-based Authorization Middleware
 */
export const requirePermission = (permission: string) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user;

    if (!user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required',
        error: 'UNAUTHORIZED',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (
      !user.permissions.includes(permission) &&
      user.role !== UserRole.SUPER_ADMIN
    ) {
      res.status(403).json({
        success: false,
        message: `Permission required: ${permission}`,
        error: 'FORBIDDEN',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    next();
  };
};

/**
 * Organization Ownership Middleware
 */
export const requireOrganization = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const user = req.user;

  if (!user) {
    res.status(401).json({
      success: false,
      message: 'Authentication required',
      error: 'UNAUTHORIZED',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (!user.organizationId && user.role !== UserRole.SUPER_ADMIN) {
    res.status(403).json({
      success: false,
      message: 'Organization membership required',
      error: 'FORBIDDEN',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  next();
};

/**
 * API Key Authentication Middleware
 */
export const authenticateApiKey = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const apiKey = req.headers['x-api-key'] as string;

    if (!apiKey) {
      res.status(401).json({
        success: false,
        message: 'API key required',
        error: 'UNAUTHORIZED',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const apiKeyRecord = await prisma.apiKey.findFirst({
      where: {
        key: apiKey,
        isActive: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      include: {
        organization: true,
      },
    });

    if (!apiKeyRecord) {
      res.status(401).json({
        success: false,
        message: 'Invalid or expired API key',
        error: 'UNAUTHORIZED',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Update last used timestamp
    await prisma.apiKey.update({
      where: { id: apiKeyRecord.id },
      data: { lastUsed: new Date() },
    });

    // Set API key context
    req.user = {
      userId: 'api-key',
      email: apiKeyRecord.organization.email || '',
      role: UserRole.ADMIN, // API keys have admin privileges within their organization
      organizationId: apiKeyRecord.organizationId,
      permissions: apiKeyRecord.permissions,
      tier: apiKeyRecord.organization.apiTier as ApiTier,
    };

    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      message: 'API key authentication failed',
      error: 'UNAUTHORIZED',
      timestamp: new Date().toISOString(),
    });
  }
};

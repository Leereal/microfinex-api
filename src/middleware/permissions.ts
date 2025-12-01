import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { PERMISSIONS, isValidPermission } from '../constants/permissions';

// Cache for user permissions (with TTL)
const permissionCache = new Map<string, { permissions: Set<string>; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Load all permissions for a user from their roles and direct assignments
 */
export async function loadUserPermissions(userId: string): Promise<Set<string>> {
  // Check cache first
  const cached = permissionCache.get(userId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.permissions;
  }

  const permissions = new Set<string>();

  try {
    // Get permissions from user roles
    const userRoles = await prisma.userRoleAssignment.findMany({
      where: {
        userId,
        isActive: true,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      include: {
        role: {
          include: {
            rolePermissions: {
              include: {
                permission: true,
              },
            },
          },
        },
      },
    });

    // Add permissions from roles
    for (const userRole of userRoles) {
      if (userRole.role.isActive) {
        for (const rp of userRole.role.rolePermissions) {
          if (rp.permission.isActive) {
            permissions.add(rp.permission.code);
          }
        }
      }
    }

    // Get direct user permissions
    const userPermissions = await prisma.userPermission.findMany({
      where: {
        userId,
        isActive: true,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
    });

    // Add direct permissions
    for (const up of userPermissions) {
      permissions.add(up.permissionCode);
    }

    // Also check legacy permissions array on User model
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { permissions: true, role: true },
    });

    if (user) {
      // Add legacy permissions array
      for (const perm of user.permissions) {
        permissions.add(perm);
      }

      // Handle legacy UserRole enum - grant all permissions for SUPER_ADMIN
      if (user.role === 'SUPER_ADMIN') {
        Object.values(PERMISSIONS).forEach(p => permissions.add(p));
      } else if (user.role === 'ADMIN') {
        // Admins get most permissions except super-admin only ones
        Object.values(PERMISSIONS).forEach(p => {
          if (!p.startsWith('organizations:')) {
            permissions.add(p);
          }
        });
        permissions.add(PERMISSIONS.ORGANIZATIONS_VIEW);
        permissions.add(PERMISSIONS.ORGANIZATIONS_UPDATE);
      }
    }

    // Cache the result
    permissionCache.set(userId, { permissions, timestamp: Date.now() });

    return permissions;
  } catch (error) {
    console.error('Error loading user permissions:', error);
    return permissions;
  }
}

/**
 * Clear permission cache for a user (call after role/permission changes)
 */
export function clearPermissionCache(userId?: string): void {
  if (userId) {
    permissionCache.delete(userId);
  } else {
    permissionCache.clear();
  }
}

/**
 * Check if user has a specific permission
 */
export async function hasPermission(userId: string, permissionCode: string): Promise<boolean> {
  const permissions = await loadUserPermissions(userId);
  return permissions.has(permissionCode);
}

/**
 * Check if user has all of the specified permissions
 */
export async function hasAllPermissions(userId: string, permissionCodes: string[]): Promise<boolean> {
  const permissions = await loadUserPermissions(userId);
  return permissionCodes.every(code => permissions.has(code));
}

/**
 * Check if user has any of the specified permissions
 */
export async function hasAnyPermission(userId: string, permissionCodes: string[]): Promise<boolean> {
  const permissions = await loadUserPermissions(userId);
  return permissionCodes.some(code => permissions.has(code));
}

/**
 * Middleware: Require ALL specified permissions
 * Usage: router.get('/path', authenticate, requirePermission('clients:view', 'clients:update'), handler)
 */
export function requirePermission(...permissionCodes: string[]) {
  // Validate permission codes at registration time
  for (const code of permissionCodes) {
    if (!isValidPermission(code)) {
      console.warn(`Warning: Invalid permission code used in requirePermission: ${code}`);
    }
  }

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.userContext?.id;
      
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required',
          error: 'UNAUTHORIZED',
          timestamp: new Date().toISOString(),
        });
      }

      const userPermissions = await loadUserPermissions(userId);
      const hasAll = permissionCodes.every(code => userPermissions.has(code));

      if (!hasAll) {
        const missing = permissionCodes.filter(code => !userPermissions.has(code));
        return res.status(403).json({
          success: false,
          message: 'Insufficient permissions',
          error: 'FORBIDDEN',
          details: {
            required: permissionCodes,
            missing,
          },
          timestamp: new Date().toISOString(),
        });
      }

      // Attach permissions to request for later use
      req.userPermissions = userPermissions;
      next();
    } catch (error) {
      console.error('Permission check error:', error);
      res.status(500).json({
        success: false,
        message: 'Error checking permissions',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  };
}

/**
 * Middleware: Require AT LEAST ONE of the specified permissions
 * Usage: router.get('/path', authenticate, requireAnyPermission('clients:view', 'clients:export'), handler)
 */
export function requireAnyPermission(...permissionCodes: string[]) {
  // Validate permission codes at registration time
  for (const code of permissionCodes) {
    if (!isValidPermission(code)) {
      console.warn(`Warning: Invalid permission code used in requireAnyPermission: ${code}`);
    }
  }

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.userContext?.id;
      
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required',
          error: 'UNAUTHORIZED',
          timestamp: new Date().toISOString(),
        });
      }

      const userPermissions = await loadUserPermissions(userId);
      const hasAny = permissionCodes.some(code => userPermissions.has(code));

      if (!hasAny) {
        return res.status(403).json({
          success: false,
          message: 'Insufficient permissions',
          error: 'FORBIDDEN',
          details: {
            requiredOneOf: permissionCodes,
          },
          timestamp: new Date().toISOString(),
        });
      }

      // Attach permissions to request for later use
      req.userPermissions = userPermissions;
      next();
    } catch (error) {
      console.error('Permission check error:', error);
      res.status(500).json({
        success: false,
        message: 'Error checking permissions',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  };
}

/**
 * Middleware: Check permission but don't block (for conditional logic in handlers)
 * Attaches hasPermission function to request
 */
export function checkPermissions() {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.userContext?.id;
      
      if (userId) {
        const permissions = await loadUserPermissions(userId);
        req.userPermissions = permissions;
        req.checkPermission = (code: string) => permissions.has(code);
        req.checkAnyPermission = (...codes: string[]) => codes.some(c => permissions.has(c));
        req.checkAllPermissions = (...codes: string[]) => codes.every(c => permissions.has(c));
      } else {
        req.userPermissions = new Set();
        req.checkPermission = () => false;
        req.checkAnyPermission = () => false;
        req.checkAllPermissions = () => false;
      }
      
      next();
    } catch (error) {
      console.error('Permission loading error:', error);
      next();
    }
  };
}

/**
 * Middleware: Require permission on specific resource (for row-level security)
 * Usage: router.get('/clients/:id', authenticate, requireResourcePermission('clients:view', 'clientId'), handler)
 */
export function requireResourcePermission(
  permissionCode: string,
  resourceIdParam: string = 'id',
  checkOwnership?: (userId: string, resourceId: string) => Promise<boolean>
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.userContext?.id;
      const resourceId = req.params[resourceIdParam];
      
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required',
          error: 'UNAUTHORIZED',
          timestamp: new Date().toISOString(),
        });
      }

      const userPermissions = await loadUserPermissions(userId);
      
      // If user has the permission, allow access
      if (userPermissions.has(permissionCode)) {
        req.userPermissions = userPermissions;
        return next();
      }

      // If ownership check function is provided, check if user owns the resource
      if (checkOwnership && resourceId) {
        const isOwner = await checkOwnership(userId, resourceId);
        if (isOwner) {
          req.userPermissions = userPermissions;
          return next();
        }
      }

      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions for this resource',
        error: 'FORBIDDEN',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Resource permission check error:', error);
      res.status(500).json({
        success: false,
        message: 'Error checking permissions',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  };
}

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      userPermissions?: Set<string>;
      checkPermission?: (code: string) => boolean;
      checkAnyPermission?: (...codes: string[]) => boolean;
      checkAllPermissions?: (...codes: string[]) => boolean;
    }
  }
}

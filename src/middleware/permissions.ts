import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import {
  PERMISSIONS,
  isValidPermission,
  DEFAULT_ROLE_PERMISSIONS,
} from '../constants/permissions';

// Cache for user permissions (with TTL)
const permissionCache = new Map<
  string,
  { permissions: Set<string>; timestamp: number }
>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Helper function to extract user ID from request
 * Handles different auth middleware patterns:
 * - auth.ts sets req.user.userId
 * - auth-supabase.ts sets req.user.id and req.userContext.id
 */
function getUserId(req: Request): string | undefined {
  return (
    req.userContext?.id || (req as any).user?.id || (req as any).user?.userId
  );
}

/**
 * Load all permissions for a user from their roles and direct assignments
 */
export async function loadUserPermissions(
  userId: string
): Promise<Set<string>> {
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
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
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
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
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
      } else if (user.role === 'ORG_ADMIN') {
        // Org Admins get permissions for their organization
        // Users management
        permissions.add(PERMISSIONS.USERS_VIEW);
        permissions.add(PERMISSIONS.USERS_CREATE);
        permissions.add(PERMISSIONS.USERS_UPDATE);
        permissions.add(PERMISSIONS.USERS_DELETE);
        permissions.add(PERMISSIONS.USERS_ASSIGN_ROLE);
        permissions.add(PERMISSIONS.USERS_PERMISSIONS_VIEW);
        permissions.add(PERMISSIONS.USERS_PERMISSIONS_MANAGE);

        // Roles management
        permissions.add(PERMISSIONS.ROLES_VIEW);
        permissions.add(PERMISSIONS.ROLES_CREATE);
        permissions.add(PERMISSIONS.ROLES_UPDATE);
        permissions.add(PERMISSIONS.ROLES_DELETE);
        permissions.add(PERMISSIONS.ROLES_PERMISSIONS_MANAGE);

        // Clients
        permissions.add(PERMISSIONS.CLIENTS_VIEW);
        permissions.add(PERMISSIONS.CLIENTS_CREATE);
        permissions.add(PERMISSIONS.CLIENTS_UPDATE);
        permissions.add(PERMISSIONS.CLIENTS_DELETE);
        permissions.add(PERMISSIONS.CLIENTS_EXPORT);
        permissions.add(PERMISSIONS.CLIENTS_IMPORT);

        // Loans
        permissions.add(PERMISSIONS.LOANS_VIEW);
        permissions.add(PERMISSIONS.LOANS_CREATE);
        permissions.add(PERMISSIONS.LOANS_UPDATE);
        permissions.add(PERMISSIONS.LOANS_DELETE);
        permissions.add(PERMISSIONS.LOANS_APPROVE);
        permissions.add(PERMISSIONS.LOANS_REJECT);
        permissions.add(PERMISSIONS.LOANS_DISBURSE);
        permissions.add(PERMISSIONS.LOANS_EXPORT);

        // Branches
        permissions.add(PERMISSIONS.BRANCHES_VIEW);
        permissions.add(PERMISSIONS.BRANCHES_CREATE);
        permissions.add(PERMISSIONS.BRANCHES_UPDATE);
        permissions.add(PERMISSIONS.BRANCHES_DELETE);

        // Products
        permissions.add(PERMISSIONS.PRODUCTS_VIEW);
        permissions.add(PERMISSIONS.PRODUCTS_CREATE);
        permissions.add(PERMISSIONS.PRODUCTS_UPDATE);
        permissions.add(PERMISSIONS.PRODUCTS_DELETE);

        // Categories
        permissions.add(PERMISSIONS.CATEGORIES_VIEW);
        permissions.add(PERMISSIONS.CATEGORIES_CREATE);
        permissions.add(PERMISSIONS.CATEGORIES_UPDATE);
        permissions.add(PERMISSIONS.CATEGORIES_DELETE);

        // Reports
        permissions.add(PERMISSIONS.REPORTS_VIEW);
        permissions.add(PERMISSIONS.REPORTS_GENERATE);
        permissions.add(PERMISSIONS.REPORTS_EXPORT);

        // Audit
        permissions.add(PERMISSIONS.AUDIT_VIEW);
        permissions.add(PERMISSIONS.AUDIT_EXPORT);

        // Settings for their org
        permissions.add(PERMISSIONS.SETTINGS_VIEW);
        permissions.add(PERMISSIONS.SETTINGS_UPDATE);

        // Organization - view and update only (not create/delete)
        permissions.add(PERMISSIONS.ORGANIZATIONS_VIEW);
        permissions.add(PERMISSIONS.ORGANIZATIONS_UPDATE);
      } else if (user.role === 'MANAGER') {
        // Managers get operational permissions from DEFAULT_ROLE_PERMISSIONS
        DEFAULT_ROLE_PERMISSIONS.MANAGER.forEach(p => permissions.add(p));
      } else if (user.role === 'LOAN_ASSESSOR') {
        DEFAULT_ROLE_PERMISSIONS.LOAN_ASSESSOR.forEach(p => permissions.add(p));
      } else if (user.role === 'LOAN_OFFICER') {
        DEFAULT_ROLE_PERMISSIONS.LOAN_OFFICER.forEach(p => permissions.add(p));
      } else if (user.role === 'CASHIER') {
        DEFAULT_ROLE_PERMISSIONS.CASHIER.forEach(p => permissions.add(p));
      } else if (user.role === 'VIEWER') {
        DEFAULT_ROLE_PERMISSIONS.VIEWER.forEach(p => permissions.add(p));
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
export async function hasPermission(
  userId: string,
  permissionCode: string
): Promise<boolean> {
  const permissions = await loadUserPermissions(userId);
  return permissions.has(permissionCode);
}

/**
 * Check if user has all of the specified permissions
 */
export async function hasAllPermissions(
  userId: string,
  permissionCodes: string[]
): Promise<boolean> {
  const permissions = await loadUserPermissions(userId);
  return permissionCodes.every(code => permissions.has(code));
}

/**
 * Check if user has any of the specified permissions
 */
export async function hasAnyPermission(
  userId: string,
  permissionCodes: string[]
): Promise<boolean> {
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
      console.warn(
        `Warning: Invalid permission code used in requirePermission: ${code}`
      );
    }
  }

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);

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
        const missing = permissionCodes.filter(
          code => !userPermissions.has(code)
        );
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
      console.warn(
        `Warning: Invalid permission code used in requireAnyPermission: ${code}`
      );
    }
  }

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);

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
      const userId = getUserId(req);

      if (userId) {
        const permissions = await loadUserPermissions(userId);
        req.userPermissions = permissions;
        req.checkPermission = (code: string) => permissions.has(code);
        req.checkAnyPermission = (...codes: string[]) =>
          codes.some(c => permissions.has(c));
        req.checkAllPermissions = (...codes: string[]) =>
          codes.every(c => permissions.has(c));
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
      const userId = getUserId(req);
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

/**
 * Middleware to load and attach user permissions to the request
 * Call this after authentication middleware to ensure req.user is set
 * Handles both `id` and `userId` property names for compatibility
 */
export async function loadPermissions(
  req: any,
  res: Response,
  next: NextFunction
) {
  try {
    // Handle both `id` and `userId` for compatibility with different auth middlewares
    // auth.ts uses `userId`, auth-supabase.ts uses `id`
    const userId = req.user?.id || req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated',
        error: 'UNAUTHORIZED',
        timestamp: new Date().toISOString(),
      });
    }

    // Load user permissions
    const permissions = await loadUserPermissions(userId);

    // Attach permissions to request for easy access
    // Normalize the user object to always have `id` for downstream middleware
    req.user.id = userId;
    req.user.permissions = Array.from(permissions);

    next();
  } catch (error) {
    console.error('Error loading permissions:', error);
    res.status(500).json({
      success: false,
      message: 'Error loading permissions',
      error: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
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

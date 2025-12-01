import { Request, Response } from 'express';
import roleService from '../services/role.service';
import { clearPermissionCache } from '../middleware/permissions';

// ===== PERMISSIONS =====

/**
 * Seed permissions from constants
 */
export async function seedPermissions(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const result = await roleService.seedPermissions();
    res.json({
      success: true,
      message: 'Permissions seeded successfully',
      data: result,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error seeding permissions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to seed permissions',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Get all permissions
 */
export async function getAllPermissions(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { module } = req.query;
    const permissions = await roleService.getAllPermissions(module as string);
    res.json({
      success: true,
      data: permissions,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error fetching permissions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch permissions',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Get permissions grouped by module
 */
export async function getPermissionsByModule(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const permissions = await roleService.getPermissionsByModule();
    res.json({
      success: true,
      data: permissions,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error fetching permissions by module:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch permissions by module',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}

// ===== ROLES =====

/**
 * Create a new role
 */
export async function createRole(req: Request, res: Response): Promise<void> {
  try {
    const organizationId = req.params.organizationId;
    const { name, description, isDefault, permissions } = req.body;

    if (!organizationId) {
      res.status(400).json({
        success: false,
        message: 'Organization ID is required',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (!name) {
      res.status(400).json({
        success: false,
        message: 'Role name is required',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const role = await roleService.createRole({
      name,
      description,
      organizationId: organizationId as string,
      isDefault,
      permissions,
    });

    res.status(201).json({
      success: true,
      message: 'Role created successfully',
      data: role,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error creating role:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create role',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Get all roles for an organization
 */
export async function getRoles(req: Request, res: Response): Promise<void> {
  try {
    const organizationId = req.params.organizationId!;
    const { includeInactive } = req.query;

    const roles = await roleService.getRolesByOrganization(
      organizationId,
      includeInactive === 'true'
    );

    res.json({
      success: true,
      data: roles,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error fetching roles:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch roles',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Get a role by ID
 */
export async function getRoleById(req: Request, res: Response): Promise<void> {
  try {
    const roleId = req.params.roleId!;

    const role = await roleService.getRoleById(roleId);

    if (!role) {
      res.status(404).json({
        success: false,
        message: 'Role not found',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    res.json({
      success: true,
      data: role,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error fetching role:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch role',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Update a role
 */
export async function updateRole(req: Request, res: Response): Promise<void> {
  try {
    const roleId = req.params.roleId!;
    const { name, description, isActive, isDefault } = req.body;

    const role = await roleService.updateRole(roleId, {
      name,
      description,
      isActive,
      isDefault,
    });

    // Clear permission cache for all users with this role
    clearPermissionCache();

    res.json({
      success: true,
      message: 'Role updated successfully',
      data: role,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error updating role:', error);

    if (error.message.includes('Cannot rename system roles')) {
      res.status(400).json({
        success: false,
        message: error.message,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    res.status(500).json({
      success: false,
      message: 'Failed to update role',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Delete a role
 */
export async function deleteRole(req: Request, res: Response): Promise<void> {
  try {
    const roleId = req.params.roleId!;

    await roleService.deleteRole(roleId);

    res.json({
      success: true,
      message: 'Role deleted successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error deleting role:', error);

    if (
      error.message.includes('Cannot delete system roles') ||
      error.message.includes('Cannot delete role with')
    ) {
      res.status(400).json({
        success: false,
        message: error.message,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    res.status(500).json({
      success: false,
      message: 'Failed to delete role',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Assign permissions to a role
 */
export async function assignPermissionsToRole(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const roleId = req.params.roleId!;
    const { permissions } = req.body;

    if (!permissions || !Array.isArray(permissions)) {
      res.status(400).json({
        success: false,
        message: 'Permissions array is required',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    await roleService.assignPermissionsToRole(roleId, permissions);

    // Clear permission cache for all users with this role
    clearPermissionCache();

    const updatedRole = await roleService.getRoleById(roleId);

    res.json({
      success: true,
      message: 'Permissions assigned successfully',
      data: updatedRole,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error assigning permissions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to assign permissions',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}

// ===== USER ROLE ASSIGNMENT =====

/**
 * Assign a role to a user
 */
export async function assignRoleToUser(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const userId = req.params.userId!;
    const { roleId, expiresAt } = req.body;
    const assignedBy = req.userContext?.id || 'system';

    if (!roleId) {
      res.status(400).json({
        success: false,
        message: 'Role ID is required',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const assignment = await roleService.assignRoleToUser({
      userId,
      roleId,
      assignedBy,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
    });

    // Clear permission cache for the user
    clearPermissionCache(userId);

    res.status(201).json({
      success: true,
      message: 'Role assigned to user successfully',
      data: assignment,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error assigning role to user:', error);

    if (error.message.includes('already has this role')) {
      res.status(400).json({
        success: false,
        message: error.message,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    res.status(500).json({
      success: false,
      message: 'Failed to assign role to user',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Remove a role from a user
 */
export async function removeRoleFromUser(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const userId = req.params.userId!;
    const roleId = req.params.roleId!;

    await roleService.removeRoleFromUser(userId, roleId);

    // Clear permission cache for the user
    clearPermissionCache(userId);

    res.json({
      success: true,
      message: 'Role removed from user successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error removing role from user:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove role from user',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Get all roles for a user
 */
export async function getUserRoles(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.params.userId!;

    const roles = await roleService.getUserRoles(userId);

    res.json({
      success: true,
      data: roles,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error fetching user roles:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user roles',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Get all users assigned to a role
 */
export async function getRoleUsers(req: Request, res: Response): Promise<void> {
  try {
    const roleId = req.params.roleId!;

    const users = await roleService.getRoleUsers(roleId);

    res.json({
      success: true,
      data: users,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error fetching role users:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch role users',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}

// ===== USER DIRECT PERMISSIONS =====

/**
 * Set a direct permission for a user
 */
export async function setUserDirectPermission(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const userId = req.params.userId!;
    const { permissionCode, granted, expiresAt } = req.body;

    if (!permissionCode || typeof granted !== 'boolean') {
      res.status(400).json({
        success: false,
        message: 'Permission code and granted (boolean) are required',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const permission = await roleService.setUserDirectPermission({
      userId,
      permissionCode,
      granted,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
    });

    // Clear permission cache for the user
    clearPermissionCache(userId);

    res.json({
      success: true,
      message: granted ? 'Permission granted' : 'Permission revoked',
      data: permission,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error setting user permission:', error);

    if (error.message.includes('Invalid permission code')) {
      res.status(400).json({
        success: false,
        message: error.message,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    res.status(500).json({
      success: false,
      message: 'Failed to set user permission',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Remove a direct permission from a user
 */
export async function removeUserDirectPermission(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const userId = req.params.userId!;
    const permissionCode = req.params.permissionCode!;

    await roleService.removeUserDirectPermission(userId, permissionCode);

    // Clear permission cache for the user
    clearPermissionCache(userId);

    res.json({
      success: true,
      message: 'Direct permission removed',
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error removing user permission:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove user permission',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Get user's direct permissions
 */
export async function getUserDirectPermissions(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const userId = req.params.userId!;

    const permissions = await roleService.getUserDirectPermissions(userId);

    res.json({
      success: true,
      data: permissions,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error fetching user direct permissions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user direct permissions',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Get user's effective permissions (roles + direct)
 */
export async function getUserEffectivePermissions(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const userId = req.params.userId!;

    const permissions = await roleService.getUserEffectivePermissions(userId);

    res.json({
      success: true,
      data: permissions,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error fetching user effective permissions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user effective permissions',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}

// ===== DEFAULT ROLES =====

/**
 * Seed default roles for an organization
 */
export async function seedDefaultRoles(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const organizationId = req.params.organizationId!;

    const roles = await roleService.seedDefaultRoles(organizationId);

    res.json({
      success: true,
      message: 'Default roles seeded successfully',
      data: roles,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error seeding default roles:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to seed default roles',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}

export default {
  // Permissions
  seedPermissions,
  getAllPermissions,
  getPermissionsByModule,

  // Roles
  createRole,
  getRoles,
  getRoleById,
  updateRole,
  deleteRole,
  assignPermissionsToRole,

  // User Roles
  assignRoleToUser,
  removeRoleFromUser,
  getUserRoles,
  getRoleUsers,

  // User Direct Permissions
  setUserDirectPermission,
  removeUserDirectPermission,
  getUserDirectPermissions,
  getUserEffectivePermissions,

  // Default Roles
  seedDefaultRoles,
};

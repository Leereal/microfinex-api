import { prisma } from '../config/database';
import {
  Role,
  Permission,
  RolePermission,
  UserRoleAssignment,
  UserPermission,
  Prisma,
} from '@prisma/client';
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  isValidPermission,
} from '../constants/permissions';

// Types
export interface CreateRoleInput {
  name: string;
  description?: string;
  organizationId: string;
  isSystem?: boolean;
  isDefault?: boolean;
  permissions?: string[];
}

export interface UpdateRoleInput {
  name?: string;
  description?: string;
  isActive?: boolean;
  isDefault?: boolean;
}

export interface AssignRoleInput {
  userId: string;
  roleId: string;
  assignedBy: string;
  expiresAt?: Date;
}

export interface UserPermissionInput {
  userId: string;
  permissionCode: string;
  granted: boolean;
  expiresAt?: Date;
}

export interface RoleWithPermissions extends Role {
  rolePermissions: (RolePermission & { permission: Permission })[];
  _count?: { userRoles: number };
}

export interface UserEffectivePermissions {
  userId: string;
  roles: { id: string; name: string }[];
  permissions: {
    code: string;
    name: string;
    module: string;
    source: 'role' | 'direct';
  }[];
}

// ===== PERMISSION MANAGEMENT =====

/**
 * Seed all permissions from the constants file
 */
export async function seedPermissions(): Promise<{
  created: number;
  updated: number;
}> {
  let created = 0;
  let updated = 0;

  for (const permission of ALL_PERMISSIONS) {
    const existing = await prisma.permission.findUnique({
      where: { code: permission.code },
    });

    if (existing) {
      await prisma.permission.update({
        where: { code: permission.code },
        data: {
          name: permission.name,
          description: permission.description,
          module: permission.module,
        },
      });
      updated++;
    } else {
      await prisma.permission.create({
        data: {
          code: permission.code,
          name: permission.name,
          description: permission.description,
          module: permission.module,
          isActive: true,
        },
      });
      created++;
    }
  }

  return { created, updated };
}

/**
 * Get all permissions
 */
export async function getAllPermissions(
  module?: string
): Promise<Permission[]> {
  const where: Prisma.PermissionWhereInput = { isActive: true };
  if (module) where.module = module;

  return prisma.permission.findMany({
    where,
    orderBy: [{ module: 'asc' }, { name: 'asc' }],
  });
}

/**
 * Get permissions grouped by module
 */
export async function getPermissionsByModule(): Promise<
  Record<string, Permission[]>
> {
  const permissions = await getAllPermissions();

  return permissions.reduce(
    (acc, permission) => {
      if (!acc[permission.module]) {
        acc[permission.module] = [];
      }
      acc[permission.module]!.push(permission);
      return acc;
    },
    {} as Record<string, Permission[]>
  );
}

// ===== ROLE MANAGEMENT =====

/**
 * Create a new role
 */
export async function createRole(
  data: CreateRoleInput
): Promise<RoleWithPermissions> {
  const { permissions: permissionCodes, ...roleData } = data;

  // Create the role
  const role = await prisma.role.create({
    data: {
      ...roleData,
      isSystem: roleData.isSystem ?? false,
      isDefault: roleData.isDefault ?? false,
    },
  });

  // Add permissions if provided
  if (permissionCodes && permissionCodes.length > 0) {
    await assignPermissionsToRole(role.id, permissionCodes);
  }

  return getRoleById(role.id) as Promise<RoleWithPermissions>;
}

/**
 * Get all roles for an organization
 */
export async function getRolesByOrganization(
  organizationId: string,
  includeInactive = false
): Promise<RoleWithPermissions[]> {
  const where: Prisma.RoleWhereInput = { organizationId };
  if (!includeInactive) {
    where.isActive = true;
  }

  return prisma.role.findMany({
    where,
    include: {
      rolePermissions: {
        include: { permission: true },
      },
      _count: {
        select: { userRoles: true },
      },
    },
    orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
  }) as Promise<RoleWithPermissions[]>;
}

/**
 * Get a role by ID
 */
export async function getRoleById(
  roleId: string
): Promise<RoleWithPermissions | null> {
  return prisma.role.findUnique({
    where: { id: roleId },
    include: {
      rolePermissions: {
        include: { permission: true },
      },
      _count: {
        select: { userRoles: true },
      },
    },
  }) as Promise<RoleWithPermissions | null>;
}

/**
 * Update a role
 */
export async function updateRole(
  roleId: string,
  data: UpdateRoleInput
): Promise<RoleWithPermissions> {
  // Check if role is system role
  const existingRole = await prisma.role.findUnique({ where: { id: roleId } });
  if (existingRole?.isSystem && data.name) {
    throw new Error('Cannot rename system roles');
  }

  await prisma.role.update({
    where: { id: roleId },
    data: {
      ...data,
      updatedAt: new Date(),
    },
  });

  return getRoleById(roleId) as Promise<RoleWithPermissions>;
}

/**
 * Delete a role (soft delete by deactivating)
 */
export async function deleteRole(roleId: string): Promise<void> {
  const role = await prisma.role.findUnique({
    where: { id: roleId },
    include: { _count: { select: { userRoles: true } } },
  });

  if (!role) {
    throw new Error('Role not found');
  }

  if (role.isSystem) {
    throw new Error('Cannot delete system roles');
  }

  if (role._count.userRoles > 0) {
    throw new Error(
      `Cannot delete role with ${role._count.userRoles} assigned users`
    );
  }

  // Remove all permissions first
  await prisma.rolePermission.deleteMany({
    where: { roleId },
  });

  // Delete the role
  await prisma.role.delete({
    where: { id: roleId },
  });
}

/**
 * Assign permissions to a role
 */
export async function assignPermissionsToRole(
  roleId: string,
  permissionCodes: string[]
): Promise<void> {
  // Validate permission codes
  const validCodes = permissionCodes.filter(code => isValidPermission(code));

  // Get permission IDs for the codes
  const permissions = await prisma.permission.findMany({
    where: { code: { in: validCodes }, isActive: true },
  });

  const permissionIds = permissions.map(p => p.id);

  // Remove existing permissions not in the new list
  await prisma.rolePermission.deleteMany({
    where: {
      roleId,
      permissionId: { notIn: permissionIds },
    },
  });

  // Add new permissions
  const existingPermissions = await prisma.rolePermission.findMany({
    where: { roleId },
  });
  const existingPermissionIds = existingPermissions.map(p => p.permissionId);

  const newPermissionIds = permissionIds.filter(
    id => !existingPermissionIds.includes(id)
  );

  if (newPermissionIds.length > 0) {
    await prisma.rolePermission.createMany({
      data: newPermissionIds.map(permissionId => ({
        roleId,
        permissionId,
      })),
    });
  }
}

/**
 * Remove permissions from a role
 */
export async function removePermissionsFromRole(
  roleId: string,
  permissionCodes: string[]
): Promise<void> {
  const permissions = await prisma.permission.findMany({
    where: { code: { in: permissionCodes } },
  });

  const permissionIds = permissions.map(p => p.id);

  await prisma.rolePermission.deleteMany({
    where: {
      roleId,
      permissionId: { in: permissionIds },
    },
  });
}

// ===== USER ROLE ASSIGNMENT =====

/**
 * Assign a role to a user
 */
export async function assignRoleToUser(
  data: AssignRoleInput
): Promise<UserRoleAssignment> {
  // Check if user already has this role
  const existing = await prisma.userRoleAssignment.findFirst({
    where: {
      userId: data.userId,
      roleId: data.roleId,
    },
  });

  if (existing) {
    throw new Error('User already has this role');
  }

  return prisma.userRoleAssignment.create({
    data: {
      userId: data.userId,
      roleId: data.roleId,
      assignedBy: data.assignedBy,
      expiresAt: data.expiresAt,
      isActive: true,
    },
  });
}

/**
 * Remove a role from a user
 */
export async function removeRoleFromUser(
  userId: string,
  roleId: string
): Promise<void> {
  await prisma.userRoleAssignment.deleteMany({
    where: {
      userId,
      roleId,
    },
  });
}

/**
 * Get all roles for a user
 */
export async function getUserRoles(
  userId: string
): Promise<RoleWithPermissions[]> {
  const assignments = await prisma.userRoleAssignment.findMany({
    where: {
      userId,
      isActive: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    include: {
      role: {
        include: {
          rolePermissions: {
            include: { permission: true },
          },
        },
      },
    },
  });

  return assignments.map(a => a.role) as RoleWithPermissions[];
}

/**
 * Get users assigned to a role
 */
export async function getRoleUsers(
  roleId: string
): Promise<{ id: string; email: string; name: string; assignedAt: Date }[]> {
  const assignments = await prisma.userRoleAssignment.findMany({
    where: {
      roleId,
      isActive: true,
    },
    include: {
      user: {
        select: { id: true, email: true, firstName: true, lastName: true },
      },
    },
  });

  return assignments.map(a => ({
    id: a.user.id,
    email: a.user.email,
    name:
      `${a.user.firstName || ''} ${a.user.lastName || ''}`.trim() ||
      a.user.email,
    assignedAt: a.assignedAt,
  }));
}

// ===== USER DIRECT PERMISSIONS =====

/**
 * Grant or revoke a direct permission to a user
 */
export async function setUserDirectPermission(
  data: UserPermissionInput
): Promise<UserPermission> {
  const { userId, permissionCode, granted, expiresAt } = data;

  // Validate permission code exists
  if (!isValidPermission(permissionCode)) {
    throw new Error(`Invalid permission code: ${permissionCode}`);
  }

  // Upsert the permission
  const existing = await prisma.userPermission.findUnique({
    where: {
      userId_permissionCode: {
        userId,
        permissionCode,
      },
    },
  });

  if (existing) {
    return prisma.userPermission.update({
      where: {
        userId_permissionCode: {
          userId,
          permissionCode,
        },
      },
      data: {
        isActive: granted,
        expiresAt,
      },
    });
  }

  return prisma.userPermission.create({
    data: {
      userId,
      permissionCode,
      isActive: granted,
      expiresAt,
    },
  });
}

/**
 * Remove a direct permission from a user
 */
export async function removeUserDirectPermission(
  userId: string,
  permissionCode: string
): Promise<void> {
  await prisma.userPermission.deleteMany({
    where: {
      userId,
      permissionCode,
    },
  });
}

/**
 * Get all direct permissions for a user
 */
export async function getUserDirectPermissions(
  userId: string
): Promise<UserPermission[]> {
  return prisma.userPermission.findMany({
    where: {
      userId,
      isActive: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });
}

// ===== EFFECTIVE PERMISSIONS =====

/**
 * Get all effective permissions for a user (from roles + direct permissions)
 */
export async function getUserEffectivePermissions(
  userId: string
): Promise<UserEffectivePermissions> {
  // Get user's roles with permissions
  const userRoles = await getUserRoles(userId);

  // Get user's direct permissions
  const directPermissions = await getUserDirectPermissions(userId);

  // Build permission map
  const permissionMap = new Map<
    string,
    { code: string; name: string; module: string; source: 'role' | 'direct' }
  >();

  // Add role permissions
  for (const role of userRoles) {
    if (!role.isActive) continue;

    for (const rp of role.rolePermissions) {
      if (!rp.permission.isActive) continue;

      permissionMap.set(rp.permission.code, {
        code: rp.permission.code,
        name: rp.permission.name,
        module: rp.permission.module,
        source: 'role',
      });
    }
  }

  // Apply direct permissions (can override role permissions)
  for (const dp of directPermissions) {
    const permDef = ALL_PERMISSIONS.find(p => p.code === dp.permissionCode);
    if (!permDef) continue;

    permissionMap.set(dp.permissionCode, {
      code: dp.permissionCode,
      name: permDef.name,
      module: permDef.module,
      source: 'direct',
    });
  }

  return {
    userId,
    roles: userRoles
      .filter(r => r.isActive)
      .map(r => ({ id: r.id, name: r.name })),
    permissions: Array.from(permissionMap.values()),
  };
}

/**
 * Check if a user has a specific permission
 */
export async function userHasPermission(
  userId: string,
  permissionCode: string
): Promise<boolean> {
  const effectivePermissions = await getUserEffectivePermissions(userId);
  return effectivePermissions.permissions.some(p => p.code === permissionCode);
}

/**
 * Check if a user has any of the specified permissions
 */
export async function userHasAnyPermission(
  userId: string,
  permissionCodes: string[]
): Promise<boolean> {
  const effectivePermissions = await getUserEffectivePermissions(userId);
  return permissionCodes.some(code =>
    effectivePermissions.permissions.some(p => p.code === code)
  );
}

// ===== DEFAULT ROLES SEEDING =====

/**
 * Seed default roles for an organization
 */
export async function seedDefaultRoles(
  organizationId: string
): Promise<Role[]> {
  const roles: Role[] = [];

  // Ensure permissions are seeded first
  await seedPermissions();

  for (const [roleName, permissionCodes] of Object.entries(
    DEFAULT_ROLE_PERMISSIONS
  )) {
    // Check if role already exists
    const existing = await prisma.role.findFirst({
      where: {
        organizationId,
        name: roleName,
      },
    });

    if (existing) {
      // Update permissions
      await assignPermissionsToRole(existing.id, permissionCodes);
      roles.push(existing);
    } else {
      // Create the role with permissions
      const role = await createRole({
        name: roleName,
        description: `Default ${roleName.toLowerCase().replace('_', ' ')} role`,
        organizationId,
        isSystem: true,
        isDefault: roleName === 'VIEWER',
        permissions: permissionCodes,
      });
      roles.push(role);
    }
  }

  return roles;
}

/**
 * Get the default role for an organization
 */
export async function getDefaultRole(
  organizationId: string
): Promise<Role | null> {
  return prisma.role.findFirst({
    where: {
      organizationId,
      isDefault: true,
      isActive: true,
    },
  });
}

export const roleService = {
  // Permissions
  seedPermissions,
  getAllPermissions,
  getPermissionsByModule,

  // Roles
  createRole,
  getRolesByOrganization,
  getRoleById,
  updateRole,
  deleteRole,
  assignPermissionsToRole,
  removePermissionsFromRole,

  // User Roles
  assignRoleToUser,
  removeRoleFromUser,
  getUserRoles,
  getRoleUsers,

  // User Direct Permissions
  setUserDirectPermission,
  removeUserDirectPermission,
  getUserDirectPermissions,

  // Effective Permissions
  getUserEffectivePermissions,
  userHasPermission,
  userHasAnyPermission,

  // Default Roles
  seedDefaultRoles,
  getDefaultRole,
};

export default roleService;

import { Router } from 'express';
import roleController from '../controllers/role.controller';
import { authenticate } from '../middleware/auth';
import { requirePermission, requireAnyPermission } from '../middleware/permissions';
import { PERMISSIONS } from '../constants/permissions';

const router = Router();

// All routes require authentication
router.use(authenticate);

// ===== PERMISSIONS =====

/**
 * @route   GET /api/v1/roles/permissions
 * @desc    Get all permissions
 * @access  Private (ROLES_VIEW)
 */
router.get(
  '/permissions',
  requirePermission(PERMISSIONS.ROLES_VIEW),
  roleController.getAllPermissions
);

/**
 * @route   GET /api/v1/roles/permissions/by-module
 * @desc    Get permissions grouped by module
 * @access  Private (ROLES_VIEW)
 */
router.get(
  '/permissions/by-module',
  requirePermission(PERMISSIONS.ROLES_VIEW),
  roleController.getPermissionsByModule
);

/**
 * @route   POST /api/v1/roles/permissions/seed
 * @desc    Seed permissions from constants (admin only)
 * @access  Private (ROLES_PERMISSIONS_MANAGE)
 */
router.post(
  '/permissions/seed',
  requirePermission(PERMISSIONS.ROLES_PERMISSIONS_MANAGE),
  roleController.seedPermissions
);

// ===== ORGANIZATION ROLES =====

/**
 * @route   GET /api/v1/roles/organization/:organizationId
 * @desc    Get all roles for an organization
 * @access  Private (ROLES_VIEW)
 */
router.get(
  '/organization/:organizationId',
  requirePermission(PERMISSIONS.ROLES_VIEW),
  roleController.getRoles
);

/**
 * @route   POST /api/v1/roles/organization/:organizationId
 * @desc    Create a new role for an organization
 * @access  Private (ROLES_CREATE)
 */
router.post(
  '/organization/:organizationId',
  requirePermission(PERMISSIONS.ROLES_CREATE),
  roleController.createRole
);

/**
 * @route   POST /api/v1/roles/organization/:organizationId/seed-defaults
 * @desc    Seed default roles for an organization
 * @access  Private (ROLES_PERMISSIONS_MANAGE)
 */
router.post(
  '/organization/:organizationId/seed-defaults',
  requirePermission(PERMISSIONS.ROLES_PERMISSIONS_MANAGE),
  roleController.seedDefaultRoles
);

// ===== ROLE CRUD =====

/**
 * @route   GET /api/v1/roles/:roleId
 * @desc    Get a role by ID
 * @access  Private (ROLES_VIEW)
 */
router.get(
  '/:roleId',
  requirePermission(PERMISSIONS.ROLES_VIEW),
  roleController.getRoleById
);

/**
 * @route   PUT /api/v1/roles/:roleId
 * @desc    Update a role
 * @access  Private (ROLES_UPDATE)
 */
router.put(
  '/:roleId',
  requirePermission(PERMISSIONS.ROLES_UPDATE),
  roleController.updateRole
);

/**
 * @route   DELETE /api/v1/roles/:roleId
 * @desc    Delete a role
 * @access  Private (ROLES_DELETE)
 */
router.delete(
  '/:roleId',
  requirePermission(PERMISSIONS.ROLES_DELETE),
  roleController.deleteRole
);

/**
 * @route   PUT /api/v1/roles/:roleId/permissions
 * @desc    Assign permissions to a role
 * @access  Private (ROLES_PERMISSIONS_MANAGE)
 */
router.put(
  '/:roleId/permissions',
  requirePermission(PERMISSIONS.ROLES_PERMISSIONS_MANAGE),
  roleController.assignPermissionsToRole
);

/**
 * @route   GET /api/v1/roles/:roleId/users
 * @desc    Get all users assigned to a role
 * @access  Private (ROLES_VIEW)
 */
router.get(
  '/:roleId/users',
  requirePermission(PERMISSIONS.ROLES_VIEW),
  roleController.getRoleUsers
);

// ===== USER ROLE MANAGEMENT =====

/**
 * @route   GET /api/v1/roles/user/:userId/roles
 * @desc    Get all roles for a user
 * @access  Private (USERS_VIEW or ROLES_VIEW)
 */
router.get(
  '/user/:userId/roles',
  requireAnyPermission(PERMISSIONS.USERS_VIEW, PERMISSIONS.ROLES_VIEW),
  roleController.getUserRoles
);

/**
 * @route   POST /api/v1/roles/user/:userId/assign
 * @desc    Assign a role to a user
 * @access  Private (USERS_ASSIGN_ROLE)
 */
router.post(
  '/user/:userId/assign',
  requirePermission(PERMISSIONS.USERS_ASSIGN_ROLE),
  roleController.assignRoleToUser
);

/**
 * @route   DELETE /api/v1/roles/user/:userId/role/:roleId
 * @desc    Remove a role from a user
 * @access  Private (USERS_ASSIGN_ROLE)
 */
router.delete(
  '/user/:userId/role/:roleId',
  requirePermission(PERMISSIONS.USERS_ASSIGN_ROLE),
  roleController.removeRoleFromUser
);

// ===== USER DIRECT PERMISSIONS =====

/**
 * @route   GET /api/v1/roles/user/:userId/permissions
 * @desc    Get user's direct permissions
 * @access  Private (USERS_PERMISSIONS_VIEW)
 */
router.get(
  '/user/:userId/permissions',
  requireAnyPermission(PERMISSIONS.USERS_PERMISSIONS_VIEW, PERMISSIONS.ROLES_VIEW),
  roleController.getUserDirectPermissions
);

/**
 * @route   GET /api/v1/roles/user/:userId/permissions/effective
 * @desc    Get user's effective permissions (roles + direct)
 * @access  Private (USERS_PERMISSIONS_VIEW)
 */
router.get(
  '/user/:userId/permissions/effective',
  requireAnyPermission(PERMISSIONS.USERS_PERMISSIONS_VIEW, PERMISSIONS.ROLES_VIEW),
  roleController.getUserEffectivePermissions
);

/**
 * @route   POST /api/v1/roles/user/:userId/permissions
 * @desc    Set a direct permission for a user
 * @access  Private (USERS_PERMISSIONS_MANAGE)
 */
router.post(
  '/user/:userId/permissions',
  requirePermission(PERMISSIONS.USERS_PERMISSIONS_MANAGE),
  roleController.setUserDirectPermission
);

/**
 * @route   DELETE /api/v1/roles/user/:userId/permissions/:permissionCode
 * @desc    Remove a direct permission from a user
 * @access  Private (USERS_PERMISSIONS_MANAGE)
 */
router.delete(
  '/user/:userId/permissions/:permissionCode',
  requirePermission(PERMISSIONS.USERS_PERMISSIONS_MANAGE),
  roleController.removeUserDirectPermission
);

export default router;

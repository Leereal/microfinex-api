#!/usr/bin/env ts-node

/**
 * Database Seed Script
 *
 * This script seeds the database with:
 * 1. All system permissions
 * 2. Default system roles with their permissions
 *
 * Run this after migrations:
 * npx prisma db seed
 *
 * Or manually:
 * npx ts-node prisma/seed.ts
 */

import { prisma } from '../src/config/database';
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
} from '../src/constants/permissions';

// System roles that should exist by default
const SYSTEM_ROLES = [
  {
    name: 'Super Administrator',
    description:
      'Full system access across all organizations. Can manage organizations, users, and all settings.',
    roleKey: 'SUPER_ADMIN',
    isDefault: false,
  },
  {
    name: 'Administrator',
    description:
      'Full access to organization resources. Can manage users, branches, and settings.',
    roleKey: 'ADMIN',
    isDefault: false,
  },
  {
    name: 'Organization Admin',
    description:
      'Organization-level admin with access to manage organization settings and users.',
    roleKey: 'ORG_ADMIN',
    isDefault: false,
  },
  {
    name: 'Branch Manager',
    description:
      'Manages a branch including staff, clients, and loans. Has approval authority.',
    roleKey: 'MANAGER',
    isDefault: false,
  },
  {
    name: 'Loan Assessor',
    description:
      'Performs loan assessments, visits, and document verification.',
    roleKey: 'LOAN_ASSESSOR',
    isDefault: false,
  },
  {
    name: 'Loan Officer',
    description:
      'Creates and manages loans, handles client registration and payments.',
    roleKey: 'LOAN_OFFICER',
    isDefault: false,
  },
  {
    name: 'Cashier/Teller',
    description: 'Handles cash transactions and payment processing.',
    roleKey: 'CASHIER',
    isDefault: false,
  },
  {
    name: 'Viewer',
    description: 'Read-only access to view clients, loans, and basic reports.',
    roleKey: 'VIEWER',
    isDefault: true, // Default role for new users
  },
];

async function seedPermissions() {
  console.log('🔑 Seeding permissions...');

  let created = 0;
  let updated = 0;

  for (const permission of ALL_PERMISSIONS) {
    const existing = await prisma.permission.findUnique({
      where: { code: permission.code },
    });

    if (existing) {
      // Update existing permission
      await prisma.permission.update({
        where: { code: permission.code },
        data: {
          name: permission.name,
          description: permission.description,
          module: permission.module,
          isActive: true,
        },
      });
      updated++;
    } else {
      // Create new permission
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

  console.log(
    `   ✅ Permissions: ${created} created, ${updated} updated (Total: ${ALL_PERMISSIONS.length})`
  );
}

async function seedRoles() {
  console.log('👥 Seeding system roles...');

  let created = 0;
  let updated = 0;

  for (const roleData of SYSTEM_ROLES) {
    // System roles have organizationId = null
    const existing = await prisma.role.findFirst({
      where: {
        name: roleData.name,
        organizationId: null,
        isSystem: true,
      },
    });

    let role;
    if (existing) {
      role = await prisma.role.update({
        where: { id: existing.id },
        data: {
          description: roleData.description,
          isDefault: roleData.isDefault,
          isActive: true,
        },
      });
      updated++;
    } else {
      role = await prisma.role.create({
        data: {
          name: roleData.name,
          description: roleData.description,
          organizationId: null, // System roles have no organization
          isSystem: true, // Cannot be deleted
          isDefault: roleData.isDefault,
          isActive: true,
        },
      });
      created++;
    }

    // Assign permissions to the role
    const permissionCodes =
      DEFAULT_ROLE_PERMISSIONS[
        roleData.roleKey as keyof typeof DEFAULT_ROLE_PERMISSIONS
      ] || [];

    if (permissionCodes.length > 0) {
      // Get permission IDs
      const permissions = await prisma.permission.findMany({
        where: {
          code: { in: permissionCodes },
        },
        select: { id: true, code: true },
      });

      // Delete existing role permissions and recreate
      await prisma.rolePermission.deleteMany({
        where: { roleId: role.id },
      });

      // Create role permissions
      for (const permission of permissions) {
        await prisma.rolePermission.create({
          data: {
            roleId: role.id,
            permissionId: permission.id,
          },
        });
      }

      console.log(
        `   📋 ${roleData.name}: ${permissions.length} permissions assigned`
      );
    }
  }

  console.log(`   ✅ Roles: ${created} created, ${updated} updated`);
}

async function seedOrganizationRoles(organizationId: string) {
  console.log(`\n🏢 Seeding roles for organization: ${organizationId}...`);

  // Organization-specific roles (copy of system roles but scoped to organization)
  const ORG_ROLES = [
    {
      name: 'Organization Admin',
      description:
        'Full access to this organization. Can manage users, branches, and settings.',
      roleKey: 'ADMIN',
      isDefault: false,
    },
    {
      name: 'Branch Manager',
      description:
        'Manages a branch including staff, clients, and loans. Has approval authority.',
      roleKey: 'MANAGER',
      isDefault: false,
    },
    {
      name: 'Loan Assessor',
      description:
        'Performs loan assessments, visits, and document verification.',
      roleKey: 'LOAN_ASSESSOR',
      isDefault: false,
    },
    {
      name: 'Loan Officer',
      description:
        'Creates and manages loans, handles client registration and payments.',
      roleKey: 'LOAN_OFFICER',
      isDefault: false,
    },
    {
      name: 'Cashier',
      description: 'Handles cash transactions and payment processing.',
      roleKey: 'CASHIER',
      isDefault: false,
    },
    {
      name: 'Viewer',
      description:
        'Read-only access to view clients, loans, and basic reports.',
      roleKey: 'VIEWER',
      isDefault: true,
    },
  ];

  let created = 0;

  for (const roleData of ORG_ROLES) {
    // Check if role already exists for this organization
    const existing = await prisma.role.findFirst({
      where: {
        name: roleData.name,
        organizationId: organizationId,
      },
    });

    if (existing) {
      console.log(`   ⏭️ Role "${roleData.name}" already exists, skipping...`);
      continue;
    }

    // Create organization-specific role
    const role = await prisma.role.create({
      data: {
        name: roleData.name,
        description: roleData.description,
        organizationId: organizationId,
        isSystem: false, // Organization roles can be customized
        isDefault: roleData.isDefault,
        isActive: true,
      },
    });

    // Assign permissions
    const permissionCodes =
      DEFAULT_ROLE_PERMISSIONS[
        roleData.roleKey as keyof typeof DEFAULT_ROLE_PERMISSIONS
      ] || [];

    if (permissionCodes.length > 0) {
      const permissions = await prisma.permission.findMany({
        where: {
          code: { in: permissionCodes },
        },
        select: { id: true },
      });

      for (const permission of permissions) {
        await prisma.rolePermission.create({
          data: {
            roleId: role.id,
            permissionId: permission.id,
          },
        });
      }

      console.log(
        `   📋 ${roleData.name}: ${permissions.length} permissions assigned`
      );
    }

    created++;
  }

  console.log(`   ✅ Organization roles: ${created} created`);
}

async function main() {
  console.log('\n🌱 Starting database seed...\n');
  console.log('='.repeat(50));

  try {
    // 1. Seed all permissions
    await seedPermissions();

    // 2. Seed system roles (no organization)
    await seedRoles();

    // 3. Seed roles for existing organizations
    const organizations = await prisma.organization.findMany({
      select: { id: true, name: true },
    });

    if (organizations.length > 0) {
      console.log(`\n📦 Found ${organizations.length} organization(s)`);
      for (const org of organizations) {
        console.log(`   - ${org.name}`);
        await seedOrganizationRoles(org.id);
      }
    } else {
      console.log('\n📦 No organizations found. Skipping organization roles.');
    }

    console.log('\n' + '='.repeat(50));
    console.log('🎉 Database seed completed successfully!\n');

    // Print summary
    const permissionCount = await prisma.permission.count();
    const roleCount = await prisma.role.count();
    const rolePermissionCount = await prisma.rolePermission.count();

    console.log('📊 Summary:');
    console.log(`   Permissions: ${permissionCount}`);
    console.log(`   Roles: ${roleCount}`);
    console.log(`   Role-Permission mappings: ${rolePermissionCount}`);
    console.log('');
  } catch (error) {
    console.error('❌ Seed failed:', error);
    throw error;
  }
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import 'dotenv/config';

import { prisma } from '../src/config/database';
import { COMMUNICATION_PERMISSIONS, PERMISSIONS } from '../src/constants/permissions';

/**
 * Register the communication permissions and grant them to existing roles.
 *
 * `seedOrganizationRoles` skips roles that already exist, so new permissions
 * never reach an organization's roles without this. Roles are chosen by what
 * they can already do, not by name, because organizations rename and
 * customise their roles:
 *
 *   communications:view       anyone who can view clients
 *   communications:send       anyone who can update clients or take payments
 *   communications:broadcast  anyone who can create users (administrators, managers)
 *   communications:templates  the same
 *
 * Safe to run again: existing grants are left alone.
 */

const GRANTS: Array<{ code: string; basis: string[] }> = [
  { code: PERMISSIONS.COMMUNICATIONS_VIEW, basis: [PERMISSIONS.CLIENTS_VIEW] },
  { code: PERMISSIONS.COMMUNICATIONS_SEND, basis: [PERMISSIONS.CLIENTS_UPDATE, PERMISSIONS.PAYMENTS_RECEIVE] },
  { code: PERMISSIONS.COMMUNICATIONS_BROADCAST, basis: [PERMISSIONS.USERS_CREATE] },
  { code: PERMISSIONS.COMMUNICATIONS_TEMPLATES, basis: [PERMISSIONS.USERS_CREATE] },
];

async function run() {
  try {
    for (const definition of COMMUNICATION_PERMISSIONS) {
      await prisma.permission.upsert({
        where: { code: definition.code },
        update: { name: definition.name, description: definition.description, module: definition.module, isActive: true },
        create: { code: definition.code, name: definition.name, description: definition.description, module: definition.module, isActive: true },
      });
    }
    console.log(`Registered ${COMMUNICATION_PERMISSIONS.length} permissions.\n`);

    for (const grant of GRANTS) {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { code: grant.code } });
      const holders = await prisma.rolePermission.findMany({
        where: { permission: { code: { in: grant.basis } } },
        select: { roleId: true, role: { select: { name: true, isSystem: true } } },
        distinct: ['roleId'],
      });
      const already = new Set(
        (await prisma.rolePermission.findMany({ where: { permissionId: permission.id }, select: { roleId: true } })).map(row => row.roleId)
      );
      let granted = 0;
      for (const holder of holders) {
        if (already.has(holder.roleId)) continue;
        await prisma.rolePermission.create({ data: { roleId: holder.roleId, permissionId: permission.id } });
        granted++;
      }
      console.log(`${grant.code}: granted to ${granted} role(s), ${already.size} already had it (basis: ${grant.basis.join(' or ')})`);
    }

    console.log('\nPermissions are cached per user for 5 minutes, so signed-in staff pick this up within that window.');
  } catch (error) {
    console.error('Failed:', error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

run();

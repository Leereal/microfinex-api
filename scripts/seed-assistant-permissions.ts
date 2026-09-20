import 'dotenv/config';

import { prisma } from '../src/config/database';
import { ASSISTANT_PERMISSIONS, PERMISSIONS } from '../src/constants/permissions';

/**
 * Register the Agentic Assistant permissions and grant them to existing roles.
 *
 * `seedOrganizationRoles` skips roles that already exist, so a new permission
 * never reaches an organization's roles without this. Roles are chosen by what
 * they can already do rather than by name, because organizations rename and
 * customise their roles:
 *
 *   assistant:use          anyone who can view clients
 *   assistant:approve      anyone who can approve a loan or create a client -
 *                          they are the people who could do the work by hand
 *   assistant:automations  anyone who can create users (managers, admins)
 *   assistant:connections  anyone who can change settings
 *   assistant:manage       anyone who can change settings
 *
 * Safe to run again: existing grants are left alone.
 */

const GRANTS: Array<{ code: string; basis: string[] }> = [
  { code: PERMISSIONS.ASSISTANT_USE, basis: [PERMISSIONS.CLIENTS_VIEW] },
  { code: PERMISSIONS.ASSISTANT_APPROVE, basis: [PERMISSIONS.LOANS_APPROVE, PERMISSIONS.CLIENTS_CREATE] },
  { code: PERMISSIONS.ASSISTANT_AUTOMATIONS, basis: [PERMISSIONS.USERS_CREATE] },
  { code: PERMISSIONS.ASSISTANT_CONNECTIONS, basis: [PERMISSIONS.SETTINGS_UPDATE] },
  { code: PERMISSIONS.ASSISTANT_MANAGE, basis: [PERMISSIONS.SETTINGS_UPDATE] },
];

async function run() {
  try {
    for (const definition of ASSISTANT_PERMISSIONS) {
      await prisma.permission.upsert({
        where: { code: definition.code },
        update: {
          name: definition.name,
          description: definition.description,
          module: definition.module,
          isActive: true,
        },
        create: {
          code: definition.code,
          name: definition.name,
          description: definition.description,
          module: definition.module,
          isActive: true,
        },
      });
    }
    console.log(`Registered ${ASSISTANT_PERMISSIONS.length} permissions.\n`);

    for (const grant of GRANTS) {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { code: grant.code } });
      const holders = await prisma.rolePermission.findMany({
        where: { permission: { code: { in: grant.basis } } },
        select: { roleId: true },
        distinct: ['roleId'],
      });
      const already = new Set(
        (
          await prisma.rolePermission.findMany({
            where: { permissionId: permission.id },
            select: { roleId: true },
          })
        ).map(row => row.roleId)
      );

      let granted = 0;
      for (const holder of holders) {
        if (already.has(holder.roleId)) continue;
        await prisma.rolePermission.create({
          data: { roleId: holder.roleId, permissionId: permission.id },
        });
        granted++;
      }
      console.log(
        `${grant.code}: granted to ${granted} role(s), ${already.size} already had it (basis: ${grant.basis.join(' or ')})`
      );
    }

    console.log(
      '\nPermissions are cached per user for 5 minutes, so signed-in staff pick this up within that window.'
    );
    console.log(
      'The assistant itself is still off: turn it on per organization in Settings → Agentic Assistant.'
    );
  } catch (error) {
    console.error('Failed:', error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

run();

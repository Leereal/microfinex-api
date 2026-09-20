import 'dotenv/config';

import { prisma } from '../src/config/database';
import { CLIENT_PERMISSIONS, PERMISSIONS } from '../src/constants/permissions';

/**
 * Register `clients:delete:request` and grant it to the roles that should hold it.
 *
 * The full seed is the wrong tool here: `seedOrganizationRoles` skips any role
 * that already exists, so a new permission never reaches an organization's
 * roles once they have been created.
 *
 * Roles are selected by what they can already do rather than by name, because
 * organizations rename and customise their roles: anything that can update a
 * client can now also ask for one to be deleted. Approving still needs
 * `clients:delete`, which nothing here grants.
 */

const REQUEST_CODE = PERMISSIONS.CLIENTS_DELETE_REQUEST;
const BASIS_CODE = PERMISSIONS.CLIENTS_UPDATE;

async function run() {
  console.log(`Registering ${REQUEST_CODE}...\n`);

  const definition = CLIENT_PERMISSIONS.find(p => p.code === REQUEST_CODE);
  if (!definition) {
    console.error(`❌ ${REQUEST_CODE} is missing from CLIENT_PERMISSIONS.`);
    process.exit(1);
  }

  try {
    const permission = await prisma.permission.upsert({
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
    console.log(`   permission row ready (${permission.id})`);

    const basis = await prisma.permission.findUnique({
      where: { code: BASIS_CODE },
    });
    if (!basis) {
      console.error(
        `❌ ${BASIS_CODE} is not in the database. Run the full seed first.`
      );
      process.exit(1);
    }

    // Every role that can already update a client.
    const rolesWithUpdate = await prisma.rolePermission.findMany({
      where: { permissionId: basis.id },
      select: {
        roleId: true,
        role: {
          select: { name: true, organizationId: true, isSystem: true },
        },
      },
    });

    const alreadyGranted = new Set(
      (
        await prisma.rolePermission.findMany({
          where: { permissionId: permission.id },
          select: { roleId: true },
        })
      ).map(row => row.roleId)
    );

    let granted = 0;
    for (const entry of rolesWithUpdate) {
      if (alreadyGranted.has(entry.roleId)) {
        console.log(`   = ${entry.role.name} (already had it)`);
        continue;
      }

      await prisma.rolePermission.create({
        data: { roleId: entry.roleId, permissionId: permission.id },
      });
      granted++;
      console.log(
        `   + ${entry.role.name}${
          entry.role.isSystem ? ' [system]' : ''
        }`
      );
    }

    const approvers = await prisma.rolePermission.count({
      where: { permission: { code: PERMISSIONS.CLIENTS_DELETE } },
    });

    console.log(
      `\n✅ Granted to ${granted} role(s); ${rolesWithUpdate.length} can now request a deletion.`
    );
    console.log(
      `   ${approvers} role(s) hold ${PERMISSIONS.CLIENTS_DELETE} and can approve one.`
    );
    console.log(
      '\nPermissions are cached per user for 5 minutes, so signed-in staff pick this up within that window (or on the next API restart).'
    );
  } catch (error) {
    console.error('\n❌ Failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

run();

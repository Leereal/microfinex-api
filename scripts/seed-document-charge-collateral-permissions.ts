import 'dotenv/config';

import { prisma } from '../src/config/database';
import {
  CHARGE_PERMISSIONS,
  COLLATERAL_PERMISSIONS,
  DOCUMENT_PERMISSIONS,
  IMPORT_PERMISSIONS,
  PERMISSIONS,
} from '../src/constants/permissions';

/**
 * Grant the document, charge, collateral and import permissions to existing
 * roles.
 *
 * These four modules enforce their permissions on every route but appeared in
 * no role's DEFAULT_ROLE_PERMISSIONS, so the pages behind them answered 403 to
 * everybody except the Super Admin: client documents, loan charges, collateral
 * and the client importer. The defaults are fixed, but
 * `seedOrganizationRoles` skips roles that already exist, so an organization
 * already running stays broken without this.
 *
 * Roles are chosen by what they can already do, not by name, because
 * organizations rename and customise their roles. Each basis below is the
 * nearest right the role would have had to hold to be doing this work
 * already:
 *
 *   documents     follow the client rights - whoever may see a client may see
 *                 their documents, whoever may upload KYC may upload one
 *   charges       follow the loan product rights, since a charge is part of
 *                 how a product prices a loan; charges:view follows loans:view
 *                 instead, because a teller has to see what a loan is charged
 *                 before taking money against it
 *   collaterals   follow the pledge rights, which are the same job
 *   imports       follow clients:import, which is what the importer imports
 *
 * Safe to run again: existing grants are left alone.
 */

const GRANTS: Array<{ code: string; basis: string[] }> = [
  // ---------------------------------------------------------- documents
  { code: PERMISSIONS.DOCUMENTS_VIEW, basis: [PERMISSIONS.CLIENTS_VIEW] },
  {
    code: PERMISSIONS.DOCUMENTS_CREATE,
    basis: [PERMISSIONS.CLIENTS_KYC_UPLOAD, PERMISSIONS.CLIENTS_UPDATE],
  },
  { code: PERMISSIONS.DOCUMENTS_VERIFY, basis: [PERMISSIONS.CLIENTS_KYC_UPDATE] },
  { code: PERMISSIONS.DOCUMENTS_DELETE, basis: [PERMISSIONS.CLIENTS_DELETE] },
  { code: PERMISSIONS.DOCUMENTS_EXTRACT, basis: [PERMISSIONS.AI_EXTRACT] },
  // Document *types* are organization setup, not casework.
  { code: PERMISSIONS.DOCUMENTS_MANAGE, basis: [PERMISSIONS.SETTINGS_UPDATE] },

  // ------------------------------------------------------------ charges
  { code: PERMISSIONS.CHARGES_VIEW, basis: [PERMISSIONS.LOANS_VIEW] },
  { code: PERMISSIONS.CHARGES_CREATE, basis: [PERMISSIONS.LOAN_PRODUCTS_CREATE] },
  { code: PERMISSIONS.CHARGES_UPDATE, basis: [PERMISSIONS.LOAN_PRODUCTS_UPDATE] },
  { code: PERMISSIONS.CHARGES_DELETE, basis: [PERMISSIONS.LOAN_PRODUCTS_DELETE] },
  {
    code: PERMISSIONS.CHARGES_APPLY,
    basis: [PERMISSIONS.LOANS_DISBURSE, PERMISSIONS.LOANS_UPDATE],
  },
  { code: PERMISSIONS.CHARGES_WAIVE, basis: [PERMISSIONS.LOANS_WAIVE_PENALTY] },

  // -------------------------------------------------------- collaterals
  { code: PERMISSIONS.COLLATERALS_VIEW, basis: [PERMISSIONS.LOANS_VIEW] },
  { code: PERMISSIONS.COLLATERALS_CREATE, basis: [PERMISSIONS.PLEDGES_CREATE] },
  { code: PERMISSIONS.COLLATERALS_UPDATE, basis: [PERMISSIONS.PLEDGES_UPDATE] },
  { code: PERMISSIONS.COLLATERALS_VALUATE, basis: [PERMISSIONS.PLEDGES_UPDATE] },
  // Destroying the record of what secured a loan, and defining the types.
  { code: PERMISSIONS.COLLATERALS_DELETE, basis: [PERMISSIONS.LOANS_DELETE] },
  { code: PERMISSIONS.COLLATERALS_MANAGE, basis: [PERMISSIONS.SETTINGS_UPDATE] },

  // ------------------------------------------------------------ imports
  { code: PERMISSIONS.IMPORTS_VIEW, basis: [PERMISSIONS.CLIENTS_IMPORT] },
  { code: PERMISSIONS.IMPORTS_CREATE, basis: [PERMISSIONS.CLIENTS_IMPORT] },
  { code: PERMISSIONS.IMPORTS_CANCEL, basis: [PERMISSIONS.CLIENTS_IMPORT] },
  { code: PERMISSIONS.IMPORTS_DELETE, basis: [PERMISSIONS.SETTINGS_UPDATE] },
];

const DEFINITIONS = [
  ...DOCUMENT_PERMISSIONS,
  ...CHARGE_PERMISSIONS,
  ...COLLATERAL_PERMISSIONS,
  ...IMPORT_PERMISSIONS,
];

async function run() {
  try {
    for (const definition of DEFINITIONS) {
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
    console.log(`Registered ${DEFINITIONS.length} permissions.\n`);

    for (const grant of GRANTS) {
      const permission = await prisma.permission.findUniqueOrThrow({
        where: { code: grant.code },
      });
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
        `${grant.code}: granted to ${granted} role(s), ${already.size} already had it ` +
          `(basis: ${grant.basis.join(' or ')})`
      );
    }

    console.log(
      '\nPermissions are cached per user for 5 minutes, so signed-in staff pick this up within that window.'
    );
  } catch (error) {
    console.error('Failed:', error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

run();

import { prisma } from '../config/database';

/**
 * The document types every organization starts with.
 *
 * A document cannot be filed without a type, and the client form resolves the
 * type an operator picks - falling back to OTHER - against this organization's
 * list. A newly created organization had no list at all, so every upload failed
 * with "(unknown type)": the file was rejected for a reason that had nothing to
 * do with the file, and nothing in the product said the list needed creating.
 *
 * Codes match what established organizations already hold, so the two are
 * interchangeable.
 */
export const DEFAULT_DOCUMENT_TYPES: Array<{
  code: string;
  name: string;
  description?: string;
  isRequired?: boolean;
  sortOrder: number;
}> = [
  { code: 'ID', name: 'National ID', isRequired: true, sortOrder: 1 },
  { code: 'PASSPORT', name: 'Passport', sortOrder: 2 },
  {
    code: 'POA',
    name: 'Proof of Address',
    description: 'Utility bill, lease or similar, showing the address',
    isRequired: true,
    sortOrder: 3,
  },
  { code: 'PAYSLIP', name: 'Payslip', sortOrder: 4 },
  { code: 'BANK_STATEMENT', name: 'Bank Statement', sortOrder: 5 },
  { code: 'EMPLOYMENT_LETTER', name: 'Employment Letter', sortOrder: 6 },
  { code: 'BIZ_REG', name: 'Business Registration', sortOrder: 7 },
  { code: 'TAX_CLEARANCE', name: 'Tax Clearance', sortOrder: 8 },
  { code: 'COLLATERAL', name: 'Collateral Document', sortOrder: 9 },
  { code: 'APPLICATION', name: 'Loan Application Form', sortOrder: 10 },
  { code: 'PROFILE_PIC', name: 'Profile Picture', sortOrder: 11 },
  {
    code: 'OTHER',
    name: 'Other Document',
    description: 'Anything that does not fit the categories above',
    sortOrder: 99,
  },
];

/**
 * Give an organization the standard document types.
 *
 * Safe to call repeatedly: existing codes are left alone, so this tops up an
 * organization that has some of them without disturbing any the operator has
 * renamed or added themselves.
 */
export async function seedDefaultDocumentTypes(
  organizationId: string
): Promise<{ created: number; skipped: number }> {
  const existing = await prisma.documentType.findMany({
    where: { organizationId },
    select: { code: true },
  });

  const have = new Set(existing.map(type => type.code));
  const missing = DEFAULT_DOCUMENT_TYPES.filter(type => !have.has(type.code));

  if (missing.length > 0) {
    await prisma.documentType.createMany({
      data: missing.map(type => ({
        organizationId,
        code: type.code,
        name: type.name,
        description: type.description ?? null,
        isRequired: type.isRequired ?? false,
        sortOrder: type.sortOrder,
        isActive: true,
      })),
      skipDuplicates: true,
    });
  }

  return { created: missing.length, skipped: have.size };
}

export default { DEFAULT_DOCUMENT_TYPES, seedDefaultDocumentTypes };

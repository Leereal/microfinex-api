/**
 * Naming the field behind a unique-constraint violation on `organizations`.
 *
 * `organizationService.findConflict` catches the common cases before the insert,
 * but a P2002 can still arrive: two requests racing, or a constraint added to
 * the schema without the check being updated. Those used to surface as
 * "Internal server error", which reads like the server is broken when the
 * remedy is to change one field.
 */

/** The unique columns on `organizations`, and how to name each one. */
const UNIQUE_FIELDS: Record<string, string> = {
  name: 'name',
  email: 'email address',
  registrationNumber: 'registration number',
  licenseNumber: 'licence number',
};

export interface DuplicateOrganizationDetails {
  /** The column that clashed, so the form can highlight its input. */
  field: string;
  /** Ready-to-show message. */
  message: string;
}

/**
 * Work out which column a P2002 is about.
 *
 * `meta.target` is an array of column names on some drivers and the raw
 * constraint name (`organizations_name_key`) on others, so both are handled,
 * with the error text as a last resort.
 */
function resolveField(error: any): string | null {
  const target = error?.meta?.target;

  if (Array.isArray(target)) {
    const known = target.find((column: string) => column in UNIQUE_FIELDS);
    if (known) return known;
    if (typeof target[0] === 'string' && target[0]) return target[0];
  }

  if (typeof target === 'string' && target) {
    const stripped = target
      .replace(/^organizations_/, '')
      .replace(/_key$/, '');
    if (stripped in UNIQUE_FIELDS) return stripped;

    const matched = Object.keys(UNIQUE_FIELDS).find(field =>
      target.toLowerCase().includes(field.toLowerCase())
    );
    if (matched) return matched;
  }

  const message = String(error?.message ?? '');
  return (
    Object.keys(UNIQUE_FIELDS).find(field =>
      message.toLowerCase().includes(field.toLowerCase())
    ) ?? null
  );
}

export function describeDuplicateOrganization(
  error: any
): DuplicateOrganizationDetails | null {
  if (error?.code !== 'P2002') return null;

  const field = resolveField(error);
  if (!field) {
    // Still better than a 500: the operator learns it is a duplicate.
    return {
      field: '',
      message: 'Another organization already uses one of these details',
    };
  }

  const label = UNIQUE_FIELDS[field] ?? field;
  return {
    field,
    message: `Another organization already uses this ${label}`,
  };
}

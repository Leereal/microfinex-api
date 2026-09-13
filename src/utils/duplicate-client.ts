import { prisma } from '../config/database';

/**
 * Turning a unique-constraint violation into something an operator can act on.
 *
 * Prisma reports one as P2002 with `meta.target`, but what lands there varies:
 * an array of column names on some drivers, the raw constraint name on others
 * (`clients_phone_key`), and sometimes nothing at all. The previous handler did
 * `meta.target?.[0] || 'field'`, so whenever it was absent the operator was told
 * "A client with this field already exists" - true, useless, and it does not say
 * which field to change.
 */

/** The unique columns on `clients`, and how to talk about each one. */
const UNIQUE_FIELDS: Record<
  string,
  { label: string; advice: string; section: string }
> = {
  phone: {
    label: 'phone number',
    advice: 'Use a different phone number, or open the existing client record.',
    section: 'contacts',
  },
  idNumber: {
    label: 'ID number',
    advice:
      'Check the ID number for a typo, or open the existing client record.',
    section: 'identification',
  },
  clientNumber: {
    label: 'client number',
    advice: 'Please try again - a new client number will be generated.',
    section: 'personal',
  },
};

export interface DuplicateClientDetails {
  /** The column that clashed, e.g. "phone". */
  field: string;
  /** How to say it in a sentence, e.g. "phone number". */
  fieldLabel: string;
  /** What the operator should do about it. */
  advice: string;
  /** Which form section holds the field, so the UI can scroll there. */
  section: string;
  /** Ready-to-show message, naming the existing client where we may. */
  message: string;
}

/**
 * Work out which column a P2002 is about.
 *
 * Falls back through every shape `meta.target` is known to take, then to the
 * error text, before giving up.
 */
function resolveField(error: any): string | null {
  const target = error?.meta?.target;

  if (Array.isArray(target)) {
    // Composite now: ['organizationId', 'phone']. organizationId is never the
    // interesting half, so the first column that names a real field wins.
    const known = target.find((column: string) => column in UNIQUE_FIELDS);
    if (known) return known;
    const meaningful = target.find(
      (column: string) => column && column !== 'organizationId'
    );
    if (typeof meaningful === 'string') return meaningful;
    if (typeof target[0] === 'string' && target[0]) return target[0];
  }

  if (typeof target === 'string' && target) {
    // A constraint name: "clients_organizationId_phone_key" -> "phone", or the
    // older "clients_phone_key" from before uniqueness was scoped.
    const stripped = target
      .replace(/^clients_/, '')
      .replace(/^organizationId_/, '')
      .replace(/_key$/, '');
    if (stripped in UNIQUE_FIELDS) return stripped;

    const matched = Object.keys(UNIQUE_FIELDS).find(field =>
      target.toLowerCase().includes(field.toLowerCase())
    );
    if (matched) return matched;
  }

  // Last resort: the message usually quotes the constraint.
  const message = String(error?.message ?? '');
  return (
    Object.keys(UNIQUE_FIELDS).find(field =>
      message.toLowerCase().includes(field.toLowerCase())
    ) ?? null
  );
}

const clientLabel = (client: {
  firstName?: string | null;
  lastName?: string | null;
  businessName?: string | null;
  clientNumber?: string | null;
}) => {
  const name =
    [client.firstName, client.lastName].filter(Boolean).join(' ').trim() ||
    client.businessName ||
    'another client';
  return client.clientNumber ? `${name} (${client.clientNumber})` : name;
};

/**
 * Describe a duplicate-client failure, naming the record that clashed.
 *
 * Uniqueness is scoped to the organization, so a clash is always with a record
 * the caller can already see and can safely be named. The cross-organization
 * branch this used to carry is gone with the constraint that caused it - but
 * the lookup is still scoped defensively, so a stale global index could not
 * leak another tenant's client into the message.
 */
export async function describeDuplicateClient(
  error: any,
  context: { organizationId?: string; values?: Record<string, unknown> }
): Promise<DuplicateClientDetails | null> {
  if (error?.code !== 'P2002') return null;

  const field = resolveField(error);
  if (!field) return null;

  const known = UNIQUE_FIELDS[field] ?? {
    label: field,
    advice: 'Use a different value, or open the existing client record.',
    section: 'personal',
  };

  const value = context.values?.[field];
  let message = `A client with this ${known.label} already exists`;

  if (typeof value === 'string' && value) {
    try {
      const existing = await prisma.client.findFirst({
        where: {
          [field]: value,
          ...(context.organizationId
            ? { organizationId: context.organizationId }
            : {}),
        } as any,
        select: {
          firstName: true,
          lastName: true,
          businessName: true,
          clientNumber: true,
          organizationId: true,
        },
      });

      if (existing) {
        message =
          existing.organizationId === context.organizationId
            ? `A client with this ${known.label} already exists: ${clientLabel(existing)}`
            : `This ${known.label} is already registered to a client in another organization`;
      }
    } catch {
      // Naming the other record is a nicety; the field name is the point.
    }
  }

  return {
    field,
    fieldLabel: known.label,
    advice: known.advice,
    section: known.section,
    message,
  };
}

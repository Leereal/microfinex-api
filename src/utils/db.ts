import { Prisma } from '@prisma/client';

/**
 * Prisma error code for a unique constraint violation.
 */
export const UNIQUE_VIOLATION = 'P2002';

/**
 * True when the error is a unique constraint violation, optionally on a
 * specific field.
 */
export function isUniqueViolation(error: unknown, field?: string): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== UNIQUE_VIOLATION
  ) {
    return false;
  }

  if (!field) {
    return true;
  }

  const target = error.meta?.target;
  if (Array.isArray(target)) {
    return target.includes(field);
  }
  return typeof target === 'string' && target.includes(field);
}

/**
 * Run an operation that derives a human-readable sequential reference
 * (payment number, transaction number, ...) from a row count.
 *
 * Counting rows is inherently racy: two concurrent requests read the same
 * count and derive the same reference, and the second insert fails against
 * the unique index. Rather than serialise every write behind a lock, we let
 * the database arbitrate and retry the loser with a freshly derived number.
 *
 * The whole operation is retried — including any surrounding transaction —
 * because a constraint violation aborts the transaction it occurred in.
 */
export async function withUniqueRetry<T>(
  operation: () => Promise<T>,
  options: { attempts?: number; field?: string } = {}
): Promise<T> {
  const attempts = options.attempts ?? 5;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!isUniqueViolation(error, options.field)) {
        throw error;
      }
      lastError = error;
      // Small jittered backoff so retried writers do not collide again.
      await new Promise(resolve => setTimeout(resolve, 10 + Math.random() * 40));
    }
  }

  throw lastError;
}

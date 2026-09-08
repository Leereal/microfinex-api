import { Request } from 'express';
import { UserRole } from '../types';

/**
 * Row-level data scoping.
 *
 * Organisation scoping keeps one tenant's data away from another's, but within
 * a tenant every authenticated user with `loans:view` could previously list
 * every loan in every branch: `branchId` and `loanOfficerId` arrived from the
 * query string, so they were filters a caller could simply omit, not
 * constraints. These helpers derive the constraints the caller cannot escape
 * from their role and assignment, then intersect them with whatever was
 * requested.
 */

export interface DataScope {
  /** When set, results must be limited to this branch. */
  branchId?: string;
  /** When set, results must be limited to loans assigned to this officer. */
  loanOfficerId?: string;
}

/** Roles that may read across every branch in their organisation. */
const CROSS_BRANCH_ROLES: ReadonlySet<string> = new Set([
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.ORG_ADMIN,
  UserRole.ACCOUNTANT, // needs organisation-wide figures to reconcile
]);

/**
 * Roles restricted to the loans they personally own.
 * A manager sees their whole branch; an officer sees their own book.
 */
const OWN_PORTFOLIO_ROLES: ReadonlySet<string> = new Set([
  UserRole.LOAN_OFFICER,
]);

interface Actor {
  id?: string;
  role?: string;
  branchId?: string;
}

/**
 * Read the authenticated principal, tolerating the differing shapes the
 * authentication middlewares produce.
 */
export function getActor(req: Request): Actor {
  const user = (req as any).user;
  const context = req.userContext;

  return {
    id: context?.id || user?.id || user?.userId,
    role: context?.role || user?.role,
    branchId: user?.branchId || (context as any)?.appUser?.branchId,
  };
}

/**
 * Constraints this caller cannot widen.
 *
 * @param requested Optional filters supplied by the caller. A caller may
 *                  narrow within what they are allowed to see, never beyond.
 */
export function resolveDataScope(
  req: Request,
  requested: { branchId?: string; loanOfficerId?: string } = {}
): DataScope {
  const actor = getActor(req);
  const scope: DataScope = {};

  if (!actor.role) {
    // No identifiable role: fall back to the narrowest possible view rather
    // than the widest.
    return { branchId: actor.branchId, loanOfficerId: actor.id };
  }

  // Branch constraint
  if (CROSS_BRANCH_ROLES.has(actor.role)) {
    // May look at any branch; honour the requested filter if given.
    if (requested.branchId) {
      scope.branchId = requested.branchId;
    }
  } else if (actor.branchId) {
    // Pinned to their own branch. A request for a different branch is
    // narrowed to nothing rather than silently widened.
    scope.branchId = actor.branchId;
  }

  // Officer constraint
  if (OWN_PORTFOLIO_ROLES.has(actor.role)) {
    scope.loanOfficerId = actor.id;
  } else if (requested.loanOfficerId) {
    scope.loanOfficerId = requested.loanOfficerId;
  }

  return scope;
}

/**
 * True when the caller may act on data belonging to the given branch.
 */
export function canAccessBranch(req: Request, branchId?: string): boolean {
  if (!branchId) {
    return true;
  }
  const actor = getActor(req);
  if (actor.role && CROSS_BRANCH_ROLES.has(actor.role)) {
    return true;
  }
  return actor.branchId === branchId;
}

import { prisma } from '../config/database';

/**
 * Which stages an organization wants to skip on a new loan.
 *
 * The full path is assessment, then visit, then approval, then disbursement.
 * Not every lender needs all of it - a small operation issuing short-term
 * consumer loans may assess and approve in the same conversation, and making
 * them click through three stages afterwards is bookkeeping theatre.
 *
 * Off by default, deliberately. Skipping a stage removes a control, so it has
 * to be something an administrator turns on knowingly rather than something
 * they inherit.
 */

export const WORKFLOW_SETTING_KEYS = {
  SKIP_ASSESSMENT: 'workflow_skip_assessment',
  SKIP_VISIT: 'workflow_skip_visit',
  SKIP_APPROVAL: 'workflow_skip_approval',
} as const;

export interface LoanWorkflowSettings {
  skipAssessment: boolean;
  skipVisit: boolean;
  skipApproval: boolean;
  /** True when a new loan should land ready to disburse. */
  straightToDisbursement: boolean;
}

/** Settings are stored as JSON, so a stored `true`, `"true"` or 1 all count. */
const asBoolean = (value: unknown): boolean =>
  value === true || value === 'true' || value === 1 || value === '1';

export async function getWorkflowSettings(
  organizationId: string
): Promise<LoanWorkflowSettings> {
  const rows = await prisma.organizationSettings.findMany({
    where: {
      organizationId,
      settingKey: { in: Object.values(WORKFLOW_SETTING_KEYS) },
    },
    select: { settingKey: true, settingValue: true },
  });

  const byKey = new Map(rows.map(row => [row.settingKey, row.settingValue]));

  const skipAssessment = asBoolean(
    byKey.get(WORKFLOW_SETTING_KEYS.SKIP_ASSESSMENT)
  );
  const skipVisit = asBoolean(byKey.get(WORKFLOW_SETTING_KEYS.SKIP_VISIT));
  const skipApproval = asBoolean(
    byKey.get(WORKFLOW_SETTING_KEYS.SKIP_APPROVAL)
  );

  return {
    skipAssessment,
    skipVisit,
    skipApproval,
    // Only approval decides whether the loan is ready to pay out; skipping the
    // assessment alone still leaves it waiting for someone to approve it.
    straightToDisbursement: skipApproval,
  };
}

export default { getWorkflowSettings, WORKFLOW_SETTING_KEYS };

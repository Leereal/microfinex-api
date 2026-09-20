/**
 * Running one tool outside a conversation.
 *
 * Automations do most of their work deterministically - find the instalments
 * due, match the email to a client - and then need to take exactly one action
 * that a person could have taken. Rather than reimplement those actions, they
 * call the same tools the assistant uses, with the same checks: the owner's
 * permissions, the organization's capability settings, and an approval when
 * the setting says ASK.
 */

import type { z } from 'zod';
import { prisma } from '../../config/database';
import { loadUserPermissions } from '../../middleware/permissions';
import { inAppNotificationService, NOTIFICATION_TYPES } from '../in-app-notification.service';
import {
  AssistantError,
  CAPABILITY_BY_CODE,
  missingPermissions,
  resolveCapabilityMode,
  type AutonomyMode,
} from './assistant.logic';
import { assistantSettingsService } from './assistant.settings.service';
import { assembleTools } from './tools';
import type { AssistantTool, ToolContext } from './tools/tool-kit';

export interface ActingIdentity {
  organizationId: string;
  /** Whose authority the action carries. */
  userId: string;
  conversationId?: string | null;
  runId?: string;
  branchId?: string | null;
}

export async function buildToolContext(identity: ActingIdentity): Promise<ToolContext> {
  const [settings, permissions, user] = await Promise.all([
    assistantSettingsService.resolve(identity.organizationId),
    loadUserPermissions(identity.userId),
    prisma.user.findUnique({
      where: { id: identity.userId },
      select: { branchId: true, isActive: true, organizationId: true },
    }),
  ]);

  if (!user?.isActive || user.organizationId !== identity.organizationId) {
    throw new AssistantError('That account cannot act in this organization.', 'FORBIDDEN', 403);
  }

  return {
    organizationId: identity.organizationId,
    actingUserId: identity.userId,
    permissions,
    settings,
    runId: identity.runId ?? `direct:${Date.now()}`,
    conversationId: identity.conversationId ?? null,
    branchId: identity.branchId ?? user.branchId,
    clientScopeId: null,
    markTainted: () => undefined,
    artifactIds: [],
  };
}

export interface DirectActionResult {
  /** done: it ran. pending: an approval is waiting. refused: it may not run. */
  outcome: 'done' | 'pending' | 'refused';
  result?: unknown;
  approvalId?: string;
  reason?: string;
}

/**
 * Take one action as a person, honouring what the organization allows.
 *
 * `idempotencyKey` keeps a retried automation from asking twice about the same
 * thing - the second attempt finds the approval it made the first time.
 */
export async function actAs(
  identity: ActingIdentity,
  input: {
    toolName: string;
    args: Record<string, unknown>;
    idempotencyKey: string;
    title?: string;
    automationId?: string | null;
    /** Force an approval even where the setting would allow it unattended. */
    alwaysAsk?: boolean;
  }
): Promise<DirectActionResult> {
  const ctx = await buildToolContext(identity);
  const { registry } = await assembleTools(ctx);
  const tool: AssistantTool | undefined = registry.get(input.toolName);

  if (!tool) {
    return { outcome: 'refused', reason: `${input.toolName} is not available to ${identity.userId}` };
  }

  const capability = CAPABILITY_BY_CODE.get(tool.capability)!;
  const missing = missingPermissions(capability, ctx.permissions);
  if (missing.length > 0) {
    return { outcome: 'refused', reason: `The owner is missing ${missing.join(', ')}` };
  }

  const mode: AutonomyMode = resolveCapabilityMode(ctx.settings.capabilities, tool.capability);
  if (mode === 'OFF') {
    return { outcome: 'refused', reason: `${capability.name} is switched off` };
  }

  const parsed = (tool.schema as z.ZodTypeAny).safeParse(input.args);
  if (!parsed.success) {
    return {
      outcome: 'refused',
      reason: parsed.error.errors.map(issue => `${issue.path.join('.') || 'value'}: ${issue.message}`).join('; '),
    };
  }

  const title = input.title ?? (await Promise.resolve(tool.summarise(parsed.data, ctx)).catch(() => tool.name));

  if (mode === 'ASK' || input.alwaysAsk) {
    const preview = tool.preview ? await tool.preview(parsed.data, ctx).catch(() => null) : null;
    const approval = await prisma.assistantApproval.upsert({
      where: { idempotencyKey: input.idempotencyKey },
      create: {
        organizationId: identity.organizationId,
        automationId: input.automationId ?? null,
        conversationId: identity.conversationId ?? null,
        capability: tool.capability,
        toolName: tool.name,
        title,
        action: parsed.data as never,
        editableFields: tool.editableFields ?? [],
        preview: (preview ?? undefined) as never,
        requestedById: identity.userId,
        idempotencyKey: input.idempotencyKey,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600_000),
      },
      update: {},
    });

    // This exact action has been decided before - the automation is running
    // again over the same ground. Report what was decided rather than
    // pretending it is still waiting.
    if (approval.status === 'EXECUTED') {
      return { outcome: 'done', result: approval.result, approvalId: approval.id };
    }
    if (['REJECTED', 'EXPIRED', 'FAILED'].includes(approval.status)) {
      return {
        outcome: 'refused',
        approvalId: approval.id,
        reason: `A person already decided this one: ${approval.status.toLowerCase()}`,
      };
    }

    if (approval.status === 'PENDING') {
      await inAppNotificationService
        .notifyPermissionHolders({
          organizationId: identity.organizationId,
          permission: 'assistant:approve',
          type: NOTIFICATION_TYPES.ASSISTANT_APPROVAL_REQUESTED,
          title: 'The assistant needs your approval',
          body: title,
          link: `/assistant/approvals?approval=${approval.id}`,
          resource: 'assistant_approval',
          resourceId: approval.id,
        })
        .catch(() => undefined);
    }

    return { outcome: 'pending', approvalId: approval.id };
  }

  const result = await tool.execute(parsed.data, ctx);
  return { outcome: 'done', result };
}

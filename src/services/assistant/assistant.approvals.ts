/**
 * Approvals: the point where a person takes responsibility.
 *
 * When a capability is set to ASK, the assistant does not do the thing - it
 * writes down exactly what it would do and stops. Approving runs that stored
 * action verbatim; the model is not asked again, so what somebody reads on the
 * card is what happens. The approver may correct a field first, within the
 * small set of fields the tool allows.
 *
 * Nobody may approve what they could not do themselves: the approver's own
 * permissions are checked at the moment they press the button, not the
 * requester's when the assistant prepared it.
 */

import type { z } from 'zod';
import { prisma } from '../../config/database';
import { loadUserPermissions } from '../../middleware/permissions';
import { inAppNotificationService, NOTIFICATION_TYPES } from '../in-app-notification.service';
import { createAuditLog } from '../audit.service';
import {
  AssistantError,
  CAPABILITY_BY_CODE,
  describeFailure,
  missingPermissions,
  resolveCapabilityMode,
  truncate,
} from './assistant.logic';
import { assistantSettingsService } from './assistant.settings.service';
import { assembleTools, readTools, writeTools } from './tools';
import { toolRegistry } from './tools/tool-kit';
import type { ToolContext } from './tools/tool-kit';

/** The built-in tools, by name - enough to ask one what it still needs. */
const nativeTools = toolRegistry([...readTools, ...writeTools]);

export interface ApprovalContext {
  organizationId: string;
  userId: string;
}

const APPROVAL_SELECT = {
  id: true,
  organizationId: true,
  runId: true,
  conversationId: true,
  automationId: true,
  capability: true,
  toolName: true,
  title: true,
  summary: true,
  action: true,
  editableFields: true,
  preview: true,
  status: true,
  requestedById: true,
  decidedById: true,
  decidedAt: true,
  decisionNote: true,
  result: true,
  error: true,
  expiresAt: true,
  executedAt: true,
  createdAt: true,
} as const;

class AssistantApprovalService {
  async list(
    ctx: ApprovalContext,
    filters: { status?: string; mine?: boolean; limit?: number } = {}
  ) {
    const approvals = await prisma.assistantApproval.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.mine ? { requestedById: ctx.userId } : {}),
      },
      select: APPROVAL_SELECT,
      orderBy: { createdAt: 'desc' },
      take: Math.min(filters.limit ?? 50, 200),
    });
    return approvals.map(approval => this.present(approval));
  }

  async get(ctx: ApprovalContext, id: string) {
    const approval = await prisma.assistantApproval.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: APPROVAL_SELECT,
    });
    if (!approval) throw new AssistantError('No such approval.', 'NOT_FOUND', 404);
    return this.present(approval);
  }

  /**
   * The card as staff read it: what it will do, and what may be corrected.
   *
   * What is still missing is worked out here rather than stored, so a card
   * prepared before a rule existed - or one whose fields were corrected since -
   * shows what it needs now. An application that arrives by email with no name
   * on it therefore asks for the name instead of failing when somebody presses
   * Approve.
   */
  private present(approval: { capability: string } & Record<string, unknown>) {
    const capability = CAPABILITY_BY_CODE.get(approval.capability);
    const tool = nativeTools.get(String(approval.toolName ?? ''));
    const missing = tool?.missingFields
      ? tool.missingFields((approval.action ?? {}) as never)
      : [];

    return {
      ...approval,
      capabilityName: capability?.name ?? approval.capability,
      capabilityDescription: capability?.description ?? null,
      preview: missing.length
        ? { ...((approval.preview ?? {}) as Record<string, unknown>), missing }
        : approval.preview,
    };
  }

  async counts(ctx: ApprovalContext) {
    const pending = await prisma.assistantApproval.count({
      where: { organizationId: ctx.organizationId, status: 'PENDING' },
    });
    return { pending };
  }

  /**
   * Carry out an approved action.
   *
   * The work is done with the approver's authority. Should the same approval
   * be pressed twice - two tabs, a retry, a restart - the second attempt sees
   * a status that is no longer PENDING and returns the first result rather
   * than doing it again.
   */
  async approve(
    ctx: ApprovalContext,
    id: string,
    input: { edits?: Record<string, unknown>; note?: string } = {}
  ) {
    const approval = await prisma.assistantApproval.findFirst({
      where: { id, organizationId: ctx.organizationId },
    });
    if (!approval) throw new AssistantError('No such approval.', 'NOT_FOUND', 404);

    if (approval.status === 'EXECUTED') {
      return { alreadyDone: true, result: approval.result, approval: this.present(approval as never) };
    }
    // FAILED is offered again on purpose: the action did not happen, and the
    // usual reason is a field the approver can correct here and now.
    if (approval.status !== 'PENDING' && approval.status !== 'FAILED') {
      throw new AssistantError(
        `This action was already ${approval.status.toLowerCase()}.`,
        'NOT_PENDING',
        409
      );
    }
    if (approval.expiresAt && approval.expiresAt < new Date()) {
      await prisma.assistantApproval.update({ where: { id }, data: { status: 'EXPIRED' } });
      throw new AssistantError(
        'This action has expired. Ask the assistant to prepare it again if it is still wanted.',
        'EXPIRED',
        409
      );
    }

    const permissions = await loadUserPermissions(ctx.userId);
    if (!permissions.has('assistant:approve')) {
      throw new AssistantError('You may not approve the assistant’s actions.', 'FORBIDDEN', 403);
    }

    const capability = CAPABILITY_BY_CODE.get(approval.capability);
    if (!capability) throw new AssistantError('This action is no longer supported.', 'UNKNOWN_CAPABILITY', 409);

    const missing = missingPermissions(capability, permissions);
    if (missing.length > 0) {
      throw new AssistantError(
        `You would need ${missing.join(', ')} to do this yourself, so you cannot approve it.`,
        'FORBIDDEN',
        403
      );
    }

    const settings = await assistantSettingsService.resolve(ctx.organizationId);
    if (resolveCapabilityMode(settings.capabilities, approval.capability) === 'OFF') {
      throw new AssistantError(
        `${capability.name} has since been switched off, so this cannot be carried out.`,
        'CAPABILITY_OFF',
        409
      );
    }

    const approver = await prisma.user.findUnique({
      where: { id: ctx.userId },
      select: { id: true, branchId: true, isActive: true, organizationId: true },
    });
    if (!approver?.isActive || approver.organizationId !== ctx.organizationId) {
      throw new AssistantError('Your account cannot act in this organization.', 'FORBIDDEN', 403);
    }

    // Corrections are allowed only where the tool said they were, so an
    // approver cannot quietly redirect an action to a different client.
    const action = { ...((approval.action ?? {}) as Record<string, unknown>) };
    const applied: string[] = [];
    for (const [field, value] of Object.entries(input.edits ?? {})) {
      if (!approval.editableFields.includes(field)) {
        throw new AssistantError(`${field} cannot be changed on this action.`, 'FIELD_NOT_EDITABLE');
      }
      action[field] = value;
      applied.push(field);
    }

    const artifacts = approval.conversationId
      ? await prisma.assistantArtifact.findMany({
          where: { conversationId: approval.conversationId },
          select: { id: true },
          take: 25,
        })
      : [];

    const toolCtx: ToolContext = {
      organizationId: ctx.organizationId,
      actingUserId: ctx.userId,
      permissions,
      settings,
      runId: approval.runId ?? approval.id,
      conversationId: approval.conversationId,
      branchId: approver.branchId,
      clientScopeId: null,
      markTainted: () => undefined,
      artifactIds: artifacts.map(artifact => artifact.id),
    };

    const { registry } = await assembleTools(toolCtx);
    const tool = registry.get(approval.toolName);
    if (!tool) {
      throw new AssistantError(
        'This action is no longer available - the tool behind it has been withdrawn or switched off.',
        'TOOL_UNAVAILABLE',
        409
      );
    }

    const parsed = (tool.schema as z.ZodTypeAny).safeParse(action);
    if (!parsed.success) {
      throw new AssistantError(`This cannot be done yet - ${describeFailure(parsed.error)}`, 'INVALID_ACTION');
    }

    // Claim it before doing the work: a second press finds it no longer
    // pending and stops, rather than running the action twice.
    const claimed = await prisma.assistantApproval.updateMany({
      where: { id, status: { in: ['PENDING', 'FAILED'] } },
      data: {
        status: 'APPROVED',
        decidedById: ctx.userId,
        decidedAt: new Date(),
        decisionNote: input.note ?? null,
        action: action as never,
      },
    });
    if (claimed.count === 0) {
      const current = await prisma.assistantApproval.findUnique({ where: { id } });
      return { alreadyDone: true, result: current?.result ?? null, approval: this.present(current as never) };
    }

    try {
      const result = await tool.execute(parsed.data, toolCtx);
      const saved = await prisma.assistantApproval.update({
        where: { id },
        data: { status: 'EXECUTED', executedAt: new Date(), result: (result ?? {}) as never, error: null },
      });

      await createAuditLog({
        action: 'EXECUTE',
        resource: 'ASSISTANT_APPROVAL',
        resourceId: id,
        userId: ctx.userId,
        organizationId: ctx.organizationId,
        newValue: { toolName: approval.toolName, action, edited: applied },
      }).catch(() => undefined);

      await this.recordOutcome(approval, `Approved and done: ${approval.title}`, result);
      await this.tellRequester(approval, ctx.userId, `Approved: ${approval.title}`);

      return { alreadyDone: false, result, approval: this.present(saved as never) };
    } catch (error) {
      const message = describeFailure(error);
      const saved = await prisma.assistantApproval.update({
        where: { id },
        data: { status: 'FAILED', error: truncate(message, 1000) },
      });
      await this.recordOutcome(approval, `Approved, but it could not be carried out: ${message}`, null);
      await this.tellRequester(approval, ctx.userId, `Could not carry out “${approval.title}”: ${message}`);
      return { alreadyDone: false, failed: true, error: message, approval: this.present(saved as never) };
    }
  }

  async reject(ctx: ApprovalContext, id: string, note?: string) {
    const permissions = await loadUserPermissions(ctx.userId);
    if (!permissions.has('assistant:approve')) {
      throw new AssistantError('You may not decide on the assistant’s actions.', 'FORBIDDEN', 403);
    }
    const approval = await prisma.assistantApproval.findFirst({
      where: { id, organizationId: ctx.organizationId },
    });
    if (!approval) throw new AssistantError('No such approval.', 'NOT_FOUND', 404);
    if (approval.status !== 'PENDING') {
      throw new AssistantError(`This action was already ${approval.status.toLowerCase()}.`, 'NOT_PENDING', 409);
    }

    const saved = await prisma.assistantApproval.update({
      where: { id },
      data: {
        status: 'REJECTED',
        decidedById: ctx.userId,
        decidedAt: new Date(),
        decisionNote: note ?? null,
      },
    });

    await this.recordOutcome(approval, `Not approved${note ? `: ${note}` : '.'}`, null);
    return this.present(saved as never);
  }

  /** Approvals nobody decided on. */
  async expireOverdue(): Promise<number> {
    const result = await prisma.assistantApproval.updateMany({
      where: { status: 'PENDING', expiresAt: { lt: new Date() } },
      data: { status: 'EXPIRED' },
    });
    return result.count;
  }

  /**
   * Put the outcome back in the conversation.
   *
   * The assistant needs to know what happened to carry on - "the client now
   * exists, so the application can be captured" - and the person reading the
   * thread needs to see the decision in place.
   */
  private async recordOutcome(
    approval: { conversationId: string | null; organizationId: string; runId: string | null },
    text: string,
    result: unknown
  ) {
    if (!approval.conversationId) return;

    await prisma.assistantMessage.create({
      data: {
        conversationId: approval.conversationId,
        organizationId: approval.organizationId,
        role: 'user',
        content: result
          ? `${text}\nResult: ${truncate(JSON.stringify(result), 2000)}`
          : text,
        // Marked so the thread shows it as a decision, not as something the
        // person typed.
        parts: { system: true, kind: 'APPROVAL_OUTCOME' } as never,
      },
    });

    await prisma.assistantConversation.update({
      where: { id: approval.conversationId },
      data: { lastMessageAt: new Date() },
    });
  }

  private async tellRequester(
    approval: { requestedById: string | null; organizationId: string; conversationId: string | null; id: string },
    decidedById: string,
    text: string
  ) {
    if (!approval.requestedById || approval.requestedById === decidedById) return;
    await inAppNotificationService
      .notify({
        organizationId: approval.organizationId,
        recipientId: approval.requestedById,
        type: NOTIFICATION_TYPES.ASSISTANT_RUN_COMPLETED,
        title: 'Your assistant request was decided',
        body: text,
        link: approval.conversationId ? `/assistant?conversation=${approval.conversationId}` : '/assistant/approvals',
        resource: 'assistant_approval',
        resourceId: approval.id,
      })
      .catch(() => undefined);
  }
}

export const assistantApprovalService = new AssistantApprovalService();

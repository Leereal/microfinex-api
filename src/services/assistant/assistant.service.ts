/**
 * Conversations, attachments and runs - what the chat screen talks to.
 *
 * Posting a message does not wait for the assistant: the message and a queued
 * run are written down and the screen is told what to watch. The worker picks
 * the run up, and the screen follows its steps as they appear. A long piece of
 * work therefore survives a refresh, a lost connection or a restart.
 */

import { prisma } from '../../config/database';
import { storageService } from '../storage.service';
import { loadUserPermissions } from '../../middleware/permissions';
import {
  AssistantError,
  CAPABILITIES,
  conversationTitle,
  resolveCapabilityMode,
  truncate,
} from './assistant.logic';
import { assistantSettingsService } from './assistant.settings.service';
import { assistantApprovalService } from './assistant.approvals';
import { assistantWorker } from './assistant.worker';

export interface AssistantContext {
  organizationId: string;
  userId: string;
}

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const MAX_ATTACHMENTS = 10;

class AssistantService {
  /** What this person can expect the assistant to do right now. */
  async status(ctx: AssistantContext) {
    const [settings, permissions, pending] = await Promise.all([
      assistantSettingsService.resolve(ctx.organizationId),
      loadUserPermissions(ctx.userId),
      assistantApprovalService.counts(ctx),
    ]);

    const available = CAPABILITIES.filter(capability => {
      const mode = resolveCapabilityMode(settings.capabilities, capability.code);
      if (mode === 'OFF') return false;
      return capability.permissions.every(code => permissions.has(code));
    }).map(capability => ({
      code: capability.code,
      name: capability.name,
      mode: resolveCapabilityMode(settings.capabilities, capability.code),
    }));

    // Every screen asks this one endpoint what the person may do, rather than
    // working it out from a permission list held in the browser: that list is
    // rebuilt on each page load and falls back to a hard-coded one while it
    // loads, which showed people "the assistant is switched off" on a refresh.
    return {
      enabled: settings.enabled,
      canUse: permissions.has('assistant:use'),
      canApprove: permissions.has('assistant:approve'),
      canManage: permissions.has('assistant:manage'),
      canAutomate: permissions.has('assistant:automations'),
      canConnect: permissions.has('assistant:connections'),
      capabilities: available,
      pendingApprovals: pending.pending,
      memoryEnabled: settings.memoryEnabled,
    };
  }

  async listConversations(ctx: AssistantContext, options: { limit?: number; includeArchived?: boolean } = {}) {
    const conversations = await prisma.assistantConversation.findMany({
      where: {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        channel: 'APP',
        ...(options.includeArchived ? {} : { archivedAt: null }),
      },
      orderBy: { lastMessageAt: 'desc' },
      take: Math.min(options.limit ?? 30, 100),
      select: { id: true, title: true, lastMessageAt: true, createdAt: true, archivedAt: true, context: true },
    });
    return conversations;
  }

  async createConversation(ctx: AssistantContext, input: { title?: string; context?: unknown } = {}) {
    return prisma.assistantConversation.create({
      data: {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        channel: 'APP',
        title: input.title?.slice(0, 120) ?? null,
        context: (input.context ?? undefined) as never,
      },
    });
  }

  private async requireConversation(ctx: AssistantContext, id: string) {
    const conversation = await prisma.assistantConversation.findFirst({
      where: { id, organizationId: ctx.organizationId },
    });
    if (!conversation) throw new AssistantError('No such conversation.', 'NOT_FOUND', 404);
    // A staff conversation belongs to one person: it holds their questions and
    // may quote records they can see.
    if (conversation.channel === 'APP' && conversation.userId !== ctx.userId) {
      throw new AssistantError('That conversation belongs to somebody else.', 'FORBIDDEN', 403);
    }
    return conversation;
  }

  /** One thread: its messages, the runs behind them, and anything awaiting a decision. */
  async getConversation(ctx: AssistantContext, id: string) {
    const conversation = await this.requireConversation(ctx, id);

    const [messages, runs, approvals, artifacts] = await Promise.all([
      prisma.assistantMessage.findMany({
        where: { conversationId: id },
        orderBy: { createdAt: 'asc' },
        take: 300,
      }),
      prisma.assistantRun.findMany({
        where: { conversationId: id },
        orderBy: { createdAt: 'asc' },
        select: { id: true, status: true, steps: true, summary: true, error: true, createdAt: true, completedAt: true },
      }),
      prisma.assistantApproval.findMany({
        where: { conversationId: id },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.assistantArtifact.findMany({
        where: { conversationId: id },
        select: { id: true, fileName: true, mimeType: true, fileSize: true, kind: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    return {
      conversation,
      messages: messages.map(message => this.presentMessage(message)),
      runs,
      approvals,
      artifacts,
    };
  }

  /**
   * A message as the screen shows it.
   *
   * Tool calls become a short list of actions; a tool's raw result is not
   * shown in the thread at all - it lives in the run's steps, where somebody
   * who wants the detail can open it.
   */
  private presentMessage(message: {
    id: string;
    role: string;
    content: string;
    parts: unknown;
    attachments: unknown;
    runId: string | null;
    createdAt: Date;
  }) {
    const parts = (message.parts ?? {}) as {
      toolCalls?: Array<{ name: string }>;
      system?: boolean;
      kind?: string;
      name?: string;
      status?: string;
    };

    return {
      id: message.id,
      role: message.role,
      content: message.content,
      actions: parts.toolCalls?.map(call => call.name) ?? [],
      toolName: parts.name ?? null,
      toolStatus: parts.status ?? null,
      isSystem: Boolean(parts.system),
      kind: parts.kind ?? null,
      attachments: (message.attachments ?? []) as unknown[],
      runId: message.runId,
      createdAt: message.createdAt,
    };
  }

  async renameConversation(ctx: AssistantContext, id: string, title: string) {
    await this.requireConversation(ctx, id);
    return prisma.assistantConversation.update({
      where: { id },
      data: { title: title.slice(0, 120) },
    });
  }

  async archiveConversation(ctx: AssistantContext, id: string) {
    await this.requireConversation(ctx, id);
    return prisma.assistantConversation.update({ where: { id }, data: { archivedAt: new Date() } });
  }

  /**
   * Say something to the assistant.
   *
   * Attachments are stored first, so the run can read them; a failure to store
   * one stops the message rather than starting work that cannot see the file
   * the person was asking about.
   */
  async postMessage(
    ctx: AssistantContext,
    input: { conversationId?: string | null; content: string; context?: unknown },
    files: UploadedFile[] = []
  ) {
    const settings = await assistantSettingsService.resolve(ctx.organizationId);
    if (!settings.enabled) {
      throw new AssistantError(
        'The Agentic Assistant is switched off for this organization. An administrator can turn it on in Settings.',
        'DISABLED',
        409
      );
    }

    const content = (input.content ?? '').trim();
    if (!content && files.length === 0) {
      throw new AssistantError('Say something, or attach a file.', 'EMPTY_MESSAGE');
    }
    if (files.length > MAX_ATTACHMENTS) {
      throw new AssistantError(`Attach at most ${MAX_ATTACHMENTS} files at a time.`, 'TOO_MANY_FILES');
    }

    const conversation = input.conversationId
      ? await this.requireConversation(ctx, input.conversationId)
      : await this.createConversation(ctx, { title: conversationTitle(content), context: input.context });

    const stored: Array<{ id: string; fileName: string; mimeType: string; fileSize: number }> = [];
    for (const file of files) {
      const upload = await storageService.upload(file.buffer, file.originalname, file.mimetype, file.size, {
        organizationId: ctx.organizationId,
        entityType: 'organizations',
        entityId: ctx.organizationId,
        fileType: 'NOTE_ATTACHMENT',
        subEntityId: conversation.id,
      });
      const artifact = await prisma.assistantArtifact.create({
        data: {
          organizationId: ctx.organizationId,
          conversationId: conversation.id,
          kind: 'ATTACHMENT',
          fileName: file.originalname,
          mimeType: file.mimetype,
          fileSize: file.size,
          storagePath: upload.path,
          createdById: ctx.userId,
        },
      });
      stored.push({
        id: artifact.id,
        fileName: artifact.fileName,
        mimeType: artifact.mimeType,
        fileSize: artifact.fileSize,
      });
    }

    const body = stored.length
      ? `${content}\n\n[Attached: ${stored.map(file => `${file.fileName} (id ${file.id})`).join(', ')}]`
      : content;

    const message = await prisma.assistantMessage.create({
      data: {
        conversationId: conversation.id,
        organizationId: ctx.organizationId,
        role: 'user',
        content: body,
        attachments: (stored.length ? stored : undefined) as never,
      },
    });

    if (!conversation.title && content) {
      await prisma.assistantConversation.update({
        where: { id: conversation.id },
        data: { title: conversationTitle(content) },
      });
    }

    const run = await prisma.assistantRun.create({
      data: {
        organizationId: ctx.organizationId,
        conversationId: conversation.id,
        trigger: 'CHAT',
        actingUserId: ctx.userId,
        input: { prompt: truncate(content, 4000) } as never,
        status: 'QUEUED',
      },
    });

    await prisma.assistantConversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date(), ...(input.context ? { context: input.context as never } : {}) },
    });

    // Nudge the worker so a waiting person is not left watching a spinner
    // until the next idle tick.
    assistantWorker.kick();

    return {
      conversationId: conversation.id,
      message: this.presentMessage(message as never),
      runId: run.id,
      attachments: stored,
    };
  }

  /** A run and every step it took - the audit trail staff read. */
  async getRun(ctx: AssistantContext, runId: string) {
    const run = await prisma.assistantRun.findFirst({
      where: { id: runId, organizationId: ctx.organizationId },
    });
    if (!run) throw new AssistantError('No such run.', 'NOT_FOUND', 404);

    const [steps, approvals] = await Promise.all([
      prisma.assistantRunStep.findMany({ where: { runId }, orderBy: { index: 'asc' } }),
      prisma.assistantApproval.findMany({ where: { runId }, orderBy: { createdAt: 'asc' } }),
    ]);

    return {
      run: {
        id: run.id,
        status: run.status,
        trigger: run.trigger,
        steps: run.steps,
        summary: run.summary,
        error: run.error,
        provider: run.provider,
        model: run.model,
        tainted: run.tainted,
        inputTokens: run.inputTokens,
        outputTokens: run.outputTokens,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        conversationId: run.conversationId,
      },
      steps: steps.map(step => ({
        index: step.index,
        type: step.type,
        toolName: step.toolName,
        capability: step.capability,
        status: step.status,
        summary: step.summary,
        durationMs: step.durationMs,
        createdAt: step.createdAt,
        // Inputs and outputs can be large; the screen asks for one step at a
        // time when somebody opens it.
        hasDetail: Boolean(step.input || step.output),
      })),
      approvals,
    };
  }

  async getRunStep(ctx: AssistantContext, runId: string, index: number) {
    const run = await prisma.assistantRun.findFirst({
      where: { id: runId, organizationId: ctx.organizationId },
      select: { id: true },
    });
    if (!run) throw new AssistantError('No such run.', 'NOT_FOUND', 404);
    const step = await prisma.assistantRunStep.findFirst({ where: { runId, index } });
    if (!step) throw new AssistantError('No such step.', 'NOT_FOUND', 404);
    return step;
  }

  /** Ask a run to stop. It stops at the end of the step it is on. */
  async cancelRun(ctx: AssistantContext, runId: string) {
    const run = await prisma.assistantRun.findFirst({
      where: { id: runId, organizationId: ctx.organizationId },
      select: { id: true, status: true, actingUserId: true },
    });
    if (!run) throw new AssistantError('No such run.', 'NOT_FOUND', 404);
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(run.status)) {
      return { cancelled: false, status: run.status };
    }
    await prisma.assistantRun.update({
      where: { id: runId },
      data: {
        cancelRequested: true,
        // A run still in the queue can be stopped outright.
        ...(run.status === 'QUEUED' ? { status: 'CANCELLED', completedAt: new Date() } : {}),
      },
    });
    return { cancelled: true, status: run.status === 'QUEUED' ? 'CANCELLED' : run.status };
  }

  /** A link to an attachment, valid for a short while. */
  async artifactUrl(ctx: AssistantContext, artifactId: string) {
    const artifact = await prisma.assistantArtifact.findFirst({
      where: { id: artifactId, organizationId: ctx.organizationId },
    });
    if (!artifact) throw new AssistantError('No such file.', 'NOT_FOUND', 404);
    const url = await storageService.getSignedUrl(artifact.storagePath, 300, artifact.fileName);
    return { url, fileName: artifact.fileName, mimeType: artifact.mimeType };
  }

  // ------------------------------------------------------------------ memory

  async listMemories(ctx: AssistantContext) {
    return prisma.assistantMemory.findMany({
      where: {
        organizationId: ctx.organizationId,
        OR: [{ scope: 'ORG' }, { scope: 'USER', userId: ctx.userId }],
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async addMemory(ctx: AssistantContext, input: { content: string; scope?: 'ORG' | 'USER' }) {
    const content = input.content.trim();
    if (content.length < 3) throw new AssistantError('Write what the assistant should remember.', 'EMPTY');
    if (content.length > 500) throw new AssistantError('Keep a memory under 500 characters.', 'TOO_LONG');
    return prisma.assistantMemory.create({
      data: {
        organizationId: ctx.organizationId,
        scope: input.scope ?? 'ORG',
        userId: input.scope === 'USER' ? ctx.userId : null,
        content,
        source: 'USER',
        createdById: ctx.userId,
      },
    });
  }

  async deleteMemory(ctx: AssistantContext, id: string) {
    const memory = await prisma.assistantMemory.findFirst({
      where: { id, organizationId: ctx.organizationId },
    });
    if (!memory) throw new AssistantError('No such memory.', 'NOT_FOUND', 404);
    await prisma.assistantMemory.delete({ where: { id } });
    return { deleted: true };
  }
}

export const assistantService = new AssistantService();

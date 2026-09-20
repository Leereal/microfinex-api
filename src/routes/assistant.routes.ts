/**
 * The Agentic Assistant.
 *
 *   GET  /assistant/status                     what this person can expect of it
 *   GET/PUT /assistant/settings                what it may do, and with which model
 *   GET  /assistant/conversations              this person's threads
 *   POST /assistant/conversations
 *   GET  /assistant/conversations/:id          one thread, with its runs
 *   PATCH/POST .../:id, .../:id/archive
 *   POST /assistant/messages                   say something (with attachments)
 *   GET  /assistant/runs/:id                   what it did, step by step
 *   GET  /assistant/runs/:id/steps/:index
 *   POST /assistant/runs/:id/cancel
 *   GET  /assistant/approvals                  work waiting for a person
 *   POST /assistant/approvals/:id/approve|reject
 *   CRUD /assistant/automations                scheduled work, plus /run and /runs
 *   CRUD /assistant/connections                mailboxes and other accounts
 *   CRUD /assistant/browser-logins             sign-ins for websites
 *   CRUD /assistant/mcp-servers                approved MCP servers
 *   CRUD /assistant/api-connectors             configured HTTP APIs
 *   GET  /assistant/usage                      what it has cost
 *   CRUD /assistant/memories
 *   GET  /assistant/artifacts/:id/url          a link to a file it holds
 *
 * Credentials - mailbox tokens, website passwords, API keys - are write-only
 * everywhere here. Nothing returns one, at any level of permission.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { loadPermissions, requirePermission } from '../middleware/permissions';
import { handleAsync } from '../middleware/validation.middleware';
import { PERMISSIONS } from '../constants/permissions';
import { AssistantError, AUTONOMY_MODES } from '../services/assistant/assistant.logic';
import { assistantService, type AssistantContext } from '../services/assistant/assistant.service';
import { assistantSettingsService } from '../services/assistant/assistant.settings.service';
import { assistantApprovalService } from '../services/assistant/assistant.approvals';
import { assistantAutomationService } from '../services/assistant/assistant.automations';
import { assistantModelOptions } from '../services/assistant/assistant.models';
import { assistantConnectionService } from '../services/assistant/composio/connections.service';
import { browserLoginService } from '../services/assistant/browser/browser.service';
import { mcpServerService } from '../services/assistant/mcp/mcp.client';
import { apiConnectorService } from '../services/assistant/connectors/api.connectors';

const router = Router();
router.use(authenticate, loadPermissions);

const now = () => new Date().toISOString();

const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_BYTES + 1, files: MAX_ATTACHMENTS + 1 },
});

const acceptFiles = (req: Request, res: Response, next: NextFunction) =>
  upload.array('files', MAX_ATTACHMENTS + 1)(req, res, error => {
    if (!error) return next();
    const message =
      error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE'
        ? `An attachment is larger than ${MAX_ATTACHMENT_BYTES / (1024 * 1024)}MB.`
        : error instanceof multer.MulterError && error.code === 'LIMIT_FILE_COUNT'
          ? `You can attach at most ${MAX_ATTACHMENTS} files at a time.`
          : 'The attachments could not be read.';
    res.status(400).json({ success: false, message, error: 'INVALID_ATTACHMENT', timestamp: now() });
  });

function contextOf(req: Request, res: Response): AssistantContext | null {
  const user = req.user as unknown as { id?: string; userId?: string; organizationId?: string };
  const userId = user?.id || user?.userId;
  if (!user?.organizationId || !userId) {
    res.status(400).json({
      success: false,
      message: 'Organization context required',
      error: 'MISSING_ORGANIZATION',
      timestamp: now(),
    });
    return null;
  }
  return { organizationId: user.organizationId, userId };
}

/** Every handler here gets the context, and refusals come back the same way. */
const handle = (fn: (req: Request, res: Response, ctx: AssistantContext) => Promise<unknown>) =>
  handleAsync(async (req, res) => {
    const ctx = contextOf(req, res);
    if (!ctx) return;
    try {
      await fn(req, res, ctx);
    } catch (error) {
      if (error instanceof AssistantError) {
        res.status(error.httpStatus).json({
          success: false,
          message: error.message,
          error: error.code,
          timestamp: now(),
        });
        return;
      }
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          message: error.errors[0]?.message ?? 'Validation failed',
          error: 'VALIDATION_ERROR',
          details: error.errors.map(issue => ({ path: issue.path.join('.'), message: issue.message })),
          timestamp: now(),
        });
        return;
      }
      throw error;
    }
  });

const ok = (res: Response, data: unknown, status = 200, message?: string) =>
  res.status(status).json({ success: true, ...(message && { message }), data, timestamp: now() });

const uuid = z.string().uuid();

// ------------------------------------------------------------------- status

router.get(
  '/status',
  handle(async (_req, res, ctx) => ok(res, await assistantService.status(ctx)))
);

// ----------------------------------------------------------------- settings

router.get(
  '/settings',
  requirePermission(PERMISSIONS.ASSISTANT_MANAGE),
  handle(async (_req, res, ctx) => {
    const [settings, models] = await Promise.all([
      assistantSettingsService.forDisplay(ctx.organizationId),
      assistantModelOptions(ctx.organizationId).catch(() => []),
    ]);
    return ok(res, { ...settings, models });
  })
);

const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  providerName: z.string().max(40).nullish(),
  modelName: z.string().max(120).nullish(),
  capabilities: z.record(z.enum(AUTONOMY_MODES as [string, ...string[]])).optional(),
  instructions: z.string().max(4000).nullish(),
  maxStepsPerRun: z.number().int().optional(),
  monthlyTokenBudget: z.number().int().nullish(),
  dailyRunLimit: z.number().int().optional(),
  timezone: z.string().max(60).optional(),
  workingHours: z
    .object({
      days: z.array(z.number().int().min(0).max(6)),
      start: z.string(),
      end: z.string(),
    })
    .nullish(),
  memoryEnabled: z.boolean().optional(),
  whatsappEnabled: z.boolean().optional(),
  whatsappConfig: z
    .object({
      requireVerification: z.boolean().optional(),
      greeting: z.string().max(300).nullish(),
      hourlyReplyLimit: z.number().int().optional(),
      handoffHours: z.number().int().optional(),
    })
    .optional(),
  browserAllowedDomains: z.array(z.string().max(120)).max(50).optional(),
});

router.put(
  '/settings',
  requirePermission(PERMISSIONS.ASSISTANT_MANAGE),
  handle(async (req, res, ctx) => {
    const input = settingsSchema.parse(req.body);
    const settings = await assistantSettingsService.update(ctx, input as never);
    return ok(res, { settings }, 200, 'Assistant settings saved');
  })
);

// ------------------------------------------------------------ conversations

router.get(
  '/conversations',
  requirePermission(PERMISSIONS.ASSISTANT_USE),
  handle(async (req, res, ctx) =>
    ok(res, {
      conversations: await assistantService.listConversations(ctx, {
        includeArchived: req.query.includeArchived === 'true',
      }),
    })
  )
);

router.post(
  '/conversations',
  requirePermission(PERMISSIONS.ASSISTANT_USE),
  handle(async (req, res, ctx) => {
    const body = z.object({ title: z.string().max(120).optional(), context: z.unknown().optional() }).parse(req.body);
    return ok(res, { conversation: await assistantService.createConversation(ctx, body) }, 201);
  })
);

router.get(
  '/conversations/:id',
  requirePermission(PERMISSIONS.ASSISTANT_USE),
  handle(async (req, res, ctx) => ok(res, await assistantService.getConversation(ctx, uuid.parse(req.params.id))))
);

router.patch(
  '/conversations/:id',
  requirePermission(PERMISSIONS.ASSISTANT_USE),
  handle(async (req, res, ctx) => {
    const body = z.object({ title: z.string().min(1).max(120) }).parse(req.body);
    return ok(res, {
      conversation: await assistantService.renameConversation(ctx, uuid.parse(req.params.id), body.title),
    });
  })
);

router.post(
  '/conversations/:id/archive',
  requirePermission(PERMISSIONS.ASSISTANT_USE),
  handle(async (req, res, ctx) =>
    ok(res, { conversation: await assistantService.archiveConversation(ctx, uuid.parse(req.params.id)) })
  )
);

// --------------------------------------------------------------- messages

router.post(
  '/messages',
  requirePermission(PERMISSIONS.ASSISTANT_USE),
  acceptFiles,
  handle(async (req, res, ctx) => {
    const body = z
      .object({
        conversationId: uuid.nullish(),
        content: z.string().max(8000).optional(),
        // Sent as a JSON string when the request is multipart.
        context: z.string().max(2000).optional(),
      })
      .parse(req.body ?? {});

    let context: unknown;
    if (body.context) {
      try {
        context = JSON.parse(body.context);
      } catch {
        context = undefined;
      }
    }

    const files = ((req.files as Express.Multer.File[] | undefined) ?? []).map(file => ({
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      buffer: file.buffer,
    }));

    const result = await assistantService.postMessage(
      ctx,
      { conversationId: body.conversationId ?? null, content: body.content ?? '', context },
      files
    );
    return ok(res, result, 201);
  })
);

// ------------------------------------------------------------------- runs

router.get(
  '/runs/:id',
  requirePermission(PERMISSIONS.ASSISTANT_USE),
  handle(async (req, res, ctx) => ok(res, await assistantService.getRun(ctx, uuid.parse(req.params.id))))
);

router.get(
  '/runs/:id/steps/:index',
  requirePermission(PERMISSIONS.ASSISTANT_USE),
  handle(async (req, res, ctx) =>
    ok(res, {
      step: await assistantService.getRunStep(ctx, uuid.parse(req.params.id), Number(req.params.index)),
    })
  )
);

router.post(
  '/runs/:id/cancel',
  requirePermission(PERMISSIONS.ASSISTANT_USE),
  handle(async (req, res, ctx) => ok(res, await assistantService.cancelRun(ctx, uuid.parse(req.params.id))))
);

// --------------------------------------------------------------- approvals

router.get(
  '/approvals',
  requirePermission(PERMISSIONS.ASSISTANT_USE),
  handle(async (req, res, ctx) =>
    ok(res, {
      approvals: await assistantApprovalService.list(ctx, {
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        mine: req.query.mine === 'true',
      }),
    })
  )
);

router.get(
  '/approvals/:id',
  requirePermission(PERMISSIONS.ASSISTANT_USE),
  handle(async (req, res, ctx) =>
    ok(res, { approval: await assistantApprovalService.get(ctx, uuid.parse(req.params.id)) })
  )
);

router.post(
  '/approvals/:id/approve',
  requirePermission(PERMISSIONS.ASSISTANT_APPROVE),
  handle(async (req, res, ctx) => {
    const body = z
      .object({ edits: z.record(z.unknown()).optional(), note: z.string().max(500).optional() })
      .parse(req.body ?? {});
    const result = await assistantApprovalService.approve(ctx, uuid.parse(req.params.id), body);
    return ok(res, result, 200, result.failed ? 'The action was approved but could not be carried out' : 'Done');
  })
);

router.post(
  '/approvals/:id/reject',
  requirePermission(PERMISSIONS.ASSISTANT_APPROVE),
  handle(async (req, res, ctx) => {
    const body = z.object({ note: z.string().max(500).optional() }).parse(req.body ?? {});
    return ok(
      res,
      { approval: await assistantApprovalService.reject(ctx, uuid.parse(req.params.id), body.note) },
      200,
      'Not approved'
    );
  })
);

// -------------------------------------------------------------- automations

router.get(
  '/automations',
  requirePermission(PERMISSIONS.ASSISTANT_AUTOMATIONS),
  handle(async (_req, res, ctx) => ok(res, await assistantAutomationService.list(ctx)))
);

router.get(
  '/automations/:id',
  requirePermission(PERMISSIONS.ASSISTANT_AUTOMATIONS),
  handle(async (req, res, ctx) => ok(res, await assistantAutomationService.get(ctx, uuid.parse(req.params.id))))
);

const scheduleSchema = z.object({
  kind: z.enum(['DAILY', 'WEEKDAYS', 'WEEKLY', 'INTERVAL']),
  time: z.string().optional(),
  days: z.array(z.number().int().min(0).max(6)).optional(),
  everyMinutes: z.number().int().optional(),
});

router.post(
  '/automations',
  requirePermission(PERMISSIONS.ASSISTANT_AUTOMATIONS),
  handle(async (req, res, ctx) => {
    const body = z
      .object({
        type: z.string().max(60),
        name: z.string().max(120).optional(),
        schedule: scheduleSchema.optional(),
        timezone: z.string().max(60).optional(),
        config: z.record(z.unknown()).optional(),
        branchId: uuid.nullish(),
        enabled: z.boolean().optional(),
        dryRun: z.boolean().optional(),
      })
      .parse(req.body);
    return ok(res, { automation: await assistantAutomationService.create(ctx, body) }, 201, 'Automation created');
  })
);

router.put(
  '/automations/:id',
  requirePermission(PERMISSIONS.ASSISTANT_AUTOMATIONS),
  handle(async (req, res, ctx) => {
    const body = z
      .object({
        name: z.string().max(120).optional(),
        schedule: scheduleSchema.optional(),
        timezone: z.string().max(60).optional(),
        config: z.record(z.unknown()).optional(),
        branchId: uuid.nullish(),
        enabled: z.boolean().optional(),
        dryRun: z.boolean().optional(),
        ownerId: uuid.optional(),
      })
      .parse(req.body);
    return ok(res, {
      automation: await assistantAutomationService.update(ctx, uuid.parse(req.params.id), body as never),
    });
  })
);

router.delete(
  '/automations/:id',
  requirePermission(PERMISSIONS.ASSISTANT_AUTOMATIONS),
  handle(async (req, res, ctx) => ok(res, await assistantAutomationService.remove(ctx, uuid.parse(req.params.id))))
);

router.post(
  '/automations/:id/run',
  requirePermission(PERMISSIONS.ASSISTANT_AUTOMATIONS),
  handle(async (req, res, ctx) => {
    const body = z.object({ dryRun: z.boolean().optional() }).parse(req.body ?? {});
    const result = await assistantAutomationService.runNow(ctx, uuid.parse(req.params.id), body);
    return ok(res, result);
  })
);

router.get(
  '/automations/:id/runs',
  requirePermission(PERMISSIONS.ASSISTANT_AUTOMATIONS),
  handle(async (req, res, ctx) =>
    ok(res, { runs: await assistantAutomationService.runs(ctx, uuid.parse(req.params.id)) })
  )
);

// -------------------------------------------------------------- connections

router.get(
  '/connections',
  requirePermission(PERMISSIONS.ASSISTANT_CONNECTIONS),
  handle(async (_req, res, ctx) => ok(res, await assistantConnectionService.list(ctx)))
);

router.post(
  '/connections',
  requirePermission(PERMISSIONS.ASSISTANT_CONNECTIONS),
  handle(async (req, res, ctx) => {
    const body = z.object({ toolkit: z.string().max(40), label: z.string().max(120).optional() }).parse(req.body);
    return ok(res, await assistantConnectionService.start(ctx, body), 201);
  })
);

router.post(
  '/connections/:id/refresh',
  requirePermission(PERMISSIONS.ASSISTANT_CONNECTIONS),
  handle(async (req, res, ctx) =>
    ok(res, { connection: await assistantConnectionService.refresh(ctx, uuid.parse(req.params.id)) })
  )
);

router.delete(
  '/connections/:id',
  requirePermission(PERMISSIONS.ASSISTANT_CONNECTIONS),
  handle(async (req, res, ctx) =>
    ok(res, await assistantConnectionService.remove(ctx, uuid.parse(req.params.id)), 200, 'Disconnected')
  )
);

// ------------------------------------------------------------ website logins

router.get(
  '/browser-logins',
  requirePermission(PERMISSIONS.ASSISTANT_CONNECTIONS),
  handle(async (_req, res, ctx) => ok(res, await browserLoginService.list(ctx)))
);

router.post(
  '/browser-logins',
  requirePermission(PERMISSIONS.ASSISTANT_CONNECTIONS),
  handle(async (req, res, ctx) => {
    const body = z
      .object({
        name: z.string().min(1).max(120),
        loginUrl: z.string().url(),
        username: z.string().min(1).max(200),
        password: z.string().min(1).max(500),
        usernameSelector: z.string().max(200).optional(),
        passwordSelector: z.string().max(200).optional(),
        submitSelector: z.string().max(200).optional(),
      })
      .parse(req.body);
    return ok(res, { login: await browserLoginService.create(ctx, body) }, 201, 'Sign-in saved');
  })
);

router.put(
  '/browser-logins/:id',
  requirePermission(PERMISSIONS.ASSISTANT_CONNECTIONS),
  handle(async (req, res, ctx) => {
    const body = z
      .object({
        name: z.string().max(120).optional(),
        username: z.string().max(200).optional(),
        password: z.string().max(500).optional(),
        usernameSelector: z.string().max(200).nullish(),
        passwordSelector: z.string().max(200).nullish(),
        submitSelector: z.string().max(200).nullish(),
      })
      .parse(req.body);
    return ok(res, { login: await browserLoginService.update(ctx, uuid.parse(req.params.id), body as never) });
  })
);

router.delete(
  '/browser-logins/:id',
  requirePermission(PERMISSIONS.ASSISTANT_CONNECTIONS),
  handle(async (req, res, ctx) => ok(res, await browserLoginService.remove(ctx, uuid.parse(req.params.id))))
);

router.post(
  '/browser-logins/:id/verify',
  requirePermission(PERMISSIONS.ASSISTANT_CONNECTIONS),
  handle(async (req, res, ctx) => {
    const settings = await assistantSettingsService.resolve(ctx.organizationId);
    return ok(res, await browserLoginService.verify(ctx, uuid.parse(req.params.id), settings.browserAllowedDomains));
  })
);

// -------------------------------------------------------------- MCP servers

router.get(
  '/mcp-servers',
  requirePermission(PERMISSIONS.ASSISTANT_CONNECTIONS),
  handle(async (_req, res, ctx) => ok(res, await mcpServerService.list(ctx)))
);

router.post(
  '/mcp-servers',
  requirePermission(PERMISSIONS.ASSISTANT_CONNECTIONS),
  handle(async (req, res, ctx) => {
    const body = z
      .object({
        name: z.string().min(1).max(80),
        url: z.string().url(),
        authHeaderName: z.string().max(80).optional(),
        authSecret: z.string().max(2000).optional(),
        enabled: z.boolean().optional(),
      })
      .parse(req.body);
    return ok(res, { server: await mcpServerService.create(ctx, body) }, 201, 'Server added');
  })
);

router.put(
  '/mcp-servers/:id',
  requirePermission(PERMISSIONS.ASSISTANT_CONNECTIONS),
  handle(async (req, res, ctx) => {
    const body = z
      .object({
        name: z.string().max(80).optional(),
        url: z.string().url().optional(),
        authHeaderName: z.string().max(80).nullish(),
        authSecret: z.string().max(2000).nullish(),
        enabled: z.boolean().optional(),
        toolPolicy: z.record(z.string()).optional(),
      })
      .parse(req.body);
    return ok(res, { server: await mcpServerService.update(ctx, uuid.parse(req.params.id), body as never) });
  })
);

router.delete(
  '/mcp-servers/:id',
  requirePermission(PERMISSIONS.ASSISTANT_CONNECTIONS),
  handle(async (req, res, ctx) => ok(res, await mcpServerService.remove(ctx, uuid.parse(req.params.id))))
);

router.post(
  '/mcp-servers/:id/test',
  requirePermission(PERMISSIONS.ASSISTANT_CONNECTIONS),
  handle(async (req, res, ctx) => ok(res, await mcpServerService.test(ctx, uuid.parse(req.params.id))))
);

// ------------------------------------------------------------ API connectors

router.get(
  '/api-connectors',
  requirePermission(PERMISSIONS.ASSISTANT_CONNECTIONS),
  handle(async (_req, res, ctx) => ok(res, await apiConnectorService.list(ctx)))
);

router.post(
  '/api-connectors',
  requirePermission(PERMISSIONS.ASSISTANT_CONNECTIONS),
  handle(async (req, res, ctx) => {
    const body = z
      .object({
        name: z.string().min(1).max(80),
        baseUrl: z.string().url(),
        description: z.string().max(500).optional(),
        authType: z.enum(['NONE', 'BEARER', 'HEADER', 'BASIC']).optional(),
        authHeaderName: z.string().max(80).optional(),
        secret: z.string().max(2000).optional(),
        allowWrite: z.boolean().optional(),
        enabled: z.boolean().optional(),
      })
      .parse(req.body);
    return ok(res, { connector: await apiConnectorService.create(ctx, body) }, 201, 'API added');
  })
);

router.put(
  '/api-connectors/:id',
  requirePermission(PERMISSIONS.ASSISTANT_CONNECTIONS),
  handle(async (req, res, ctx) => {
    const body = z
      .object({
        name: z.string().max(80).optional(),
        description: z.string().max(500).nullish(),
        baseUrl: z.string().url().optional(),
        authType: z.enum(['NONE', 'BEARER', 'HEADER', 'BASIC']).optional(),
        authHeaderName: z.string().max(80).nullish(),
        secret: z.string().max(2000).nullish(),
        allowWrite: z.boolean().optional(),
        enabled: z.boolean().optional(),
      })
      .parse(req.body);
    return ok(res, { connector: await apiConnectorService.update(ctx, uuid.parse(req.params.id), body as never) });
  })
);

router.delete(
  '/api-connectors/:id',
  requirePermission(PERMISSIONS.ASSISTANT_CONNECTIONS),
  handle(async (req, res, ctx) => ok(res, await apiConnectorService.remove(ctx, uuid.parse(req.params.id))))
);

router.post(
  '/api-connectors/:id/test',
  requirePermission(PERMISSIONS.ASSISTANT_CONNECTIONS),
  handle(async (req, res, ctx) => {
    const body = z.object({ path: z.string().max(300).optional() }).parse(req.body ?? {});
    return ok(res, await apiConnectorService.test(ctx, uuid.parse(req.params.id), body.path));
  })
);

// -------------------------------------------------------- usage and memory

router.get(
  '/usage',
  requirePermission(PERMISSIONS.ASSISTANT_MANAGE),
  handle(async (req, res, ctx) =>
    ok(res, await assistantSettingsService.usage(ctx.organizationId, Number(req.query.days) || 30))
  )
);

router.get(
  '/memories',
  requirePermission(PERMISSIONS.ASSISTANT_USE),
  handle(async (_req, res, ctx) => ok(res, { memories: await assistantService.listMemories(ctx) }))
);

router.post(
  '/memories',
  requirePermission(PERMISSIONS.ASSISTANT_USE),
  handle(async (req, res, ctx) => {
    const body = z
      .object({ content: z.string().min(3).max(500), scope: z.enum(['ORG', 'USER']).optional() })
      .parse(req.body);
    return ok(res, { memory: await assistantService.addMemory(ctx, body) }, 201);
  })
);

router.delete(
  '/memories/:id',
  requirePermission(PERMISSIONS.ASSISTANT_USE),
  handle(async (req, res, ctx) => ok(res, await assistantService.deleteMemory(ctx, uuid.parse(req.params.id))))
);

// ---------------------------------------------------------------- artifacts

router.get(
  '/artifacts/:id/url',
  requirePermission(PERMISSIONS.ASSISTANT_USE),
  handle(async (req, res, ctx) => ok(res, await assistantService.artifactUrl(ctx, uuid.parse(req.params.id))))
);

export default router;

/**
 * Client communications.
 *
 *   GET  /communications/status                        channels this organization can use
 *   GET  /communications/merge-fields                  placeholders a message may use
 *   GET  /communications/settings                      channel settings (no secrets)
 *   PUT  /communications/settings
 *   POST /communications/settings/test/:channel        check credentials, optionally send a test
 *   GET  /communications/clients/:clientId/options     addresses, opt-outs, WhatsApp window
 *   POST /communications/clients/:clientId/preview     a message as this client would get it
 *   POST /communications/clients/:clientId/messages    send one message
 *   POST /communications/clients/:clientId/click-to-chat
 *   GET  /communications/clients/:clientId/messages    the client's message history
 *   GET  /communications/clients/:clientId/preferences
 *   PUT  /communications/clients/:clientId/preferences
 *   GET  /communications/loans/:loanId/messages
 *   GET  /communications/messages                      every message, filterable
 *   POST /communications/broadcasts/preview
 *   POST /communications/broadcasts
 *   GET  /communications/broadcasts
 *   GET  /communications/broadcasts/:id
 *   POST /communications/broadcasts/:id/cancel
 *   GET/POST /communications/templates, PUT/DELETE /communications/templates/:id
 *   GET  /communications/whatsapp/templates            approved templates from Meta
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { loadPermissions, requirePermission } from '../middleware/permissions';
import { handleAsync } from '../middleware/validation.middleware';
import { PERMISSIONS } from '../constants/permissions';
import { commsService, type CommsContext } from '../services/communications/comms.service';
import { commsSettingsService } from '../services/communications/comms-settings.service';
import { CHANNELS, CommsError, MERGE_FIELDS } from '../services/communications/comms.logic';

const router = Router();
router.use(authenticate, loadPermissions);

const now = () => new Date().toISOString();

function contextOf(req: Request, res: Response): CommsContext | null {
  const user = req.user as unknown as { id?: string; userId?: string; organizationId?: string };
  const userId = user?.id || user?.userId;
  if (!user?.organizationId || !userId) {
    res.status(400).json({ success: false, message: 'Organization context required', error: 'MISSING_ORGANIZATION', timestamp: now() });
    return null;
  }
  return { organizationId: user.organizationId, userId };
}

const handle = (fn: (req: Request, res: Response, ctx: CommsContext) => Promise<unknown>) =>
  handleAsync(async (req, res) => {
    const ctx = contextOf(req, res);
    if (!ctx) return;
    try {
      await fn(req, res, ctx);
    } catch (error) {
      if (error instanceof CommsError) {
        res.status(error.httpStatus).json({ success: false, message: error.message, error: error.code, timestamp: now() });
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
const channel = z.enum(CHANNELS);
const content = z.object({
  channel,
  subject: z.string().max(300).nullish(),
  body: z.string().max(10_000).nullish(),
  templateName: z.string().max(512).nullish(),
  templateLanguage: z.string().max(20).nullish(),
  templateParams: z.array(z.string().max(1000)).max(20).nullish(),
});
const audience = z.discriminatedUnion('type', [
  z.object({ type: z.literal('CLIENTS'), clientIds: z.array(uuid).min(1).max(5000) }),
  z.object({
    type: z.literal('FILTER'),
    branchId: uuid.nullish(),
    clientStatus: z.enum(['ACTIVE', 'ALL']).optional(),
    loanStatus: z.enum(['ANY', 'ACTIVE', 'OVERDUE', 'NO_ACTIVE_LOAN']).optional(),
  }),
]);
const page = z.coerce.number().int().min(1).optional();

// ----------------------------------------------------------------- basics
router.get('/status', handle(async (_req, res, ctx) => ok(res, await commsSettingsService.status(ctx.organizationId))));

router.get('/merge-fields', handle(async (_req, res) => ok(res, MERGE_FIELDS)));

// --------------------------------------------------------------- settings
router.get(
  '/settings',
  requirePermission(PERMISSIONS.SETTINGS_VIEW),
  handle(async (_req, res, ctx) => ok(res, await commsSettingsService.publicSettings(ctx.organizationId)))
);

const nullableText = (max: number) => z.string().max(max).nullish();
router.put(
  '/settings',
  requirePermission(PERMISSIONS.SETTINGS_UPDATE),
  handle(async (req, res, ctx) => {
    const body = z
      .object({
        defaultCountryCode: z.string().max(6).optional(),
        email: z
          .object({
            enabled: z.boolean().optional(),
            host: nullableText(255),
            port: z.number().int().nullish(),
            secure: z.boolean().optional(),
            username: nullableText(255),
            password: nullableText(512),
            fromName: nullableText(120),
            fromAddress: nullableText(255),
            replyTo: nullableText(255),
          })
          .strict()
          .optional(),
        sms: z
          .object({
            enabled: z.boolean().optional(),
            tokenId: nullableText(255),
            tokenSecret: nullableText(512),
            senderId: nullableText(20),
            routingGroup: z.enum(['ECONOMY', 'STANDARD', 'PREMIUM']).optional(),
          })
          .strict()
          .optional(),
        whatsapp: z
          .object({
            enabled: z.boolean().optional(),
            phoneNumberId: nullableText(40),
            businessAccountId: nullableText(40),
            accessToken: nullableText(2048),
            appSecret: nullableText(255),
            apiVersion: nullableText(10),
            clickToChatEnabled: z.boolean().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .parse(req.body ?? {});
    const result = await commsSettingsService.update(ctx.organizationId, ctx.userId, body);
    ok(res, result, 200, result.warnings.length ? `Saved, but ${result.warnings.join('; ')}.` : 'Communication settings saved');
  })
);

router.post(
  '/settings/test/:channel',
  requirePermission(PERMISSIONS.SETTINGS_UPDATE),
  handle(async (req, res, ctx) => {
    const target = channel.parse(req.params.channel);
    const { sendTo } = z.object({ sendTo: z.string().max(255).optional() }).parse(req.body ?? {});
    ok(res, await commsSettingsService.test(ctx.organizationId, target, sendTo));
  })
);

// ---------------------------------------------------------------- one client
router.get(
  '/clients/:clientId/options',
  requirePermission(PERMISSIONS.COMMUNICATIONS_VIEW),
  handle(async (req, res, ctx) => {
    const clientId = uuid.parse(req.params.clientId);
    const loanId = req.query.loanId ? uuid.parse(req.query.loanId) : null;
    ok(res, await commsService.contactOptions(ctx, clientId, loanId));
  })
);

router.post(
  '/clients/:clientId/preview',
  requirePermission(PERMISSIONS.COMMUNICATIONS_SEND),
  handle(async (req, res, ctx) => {
    const clientId = uuid.parse(req.params.clientId);
    const body = content.extend({ loanId: uuid.nullish() }).parse(req.body ?? {});
    ok(res, await commsService.preview(ctx, clientId, body));
  })
);

router.post(
  '/clients/:clientId/messages',
  requirePermission(PERMISSIONS.COMMUNICATIONS_SEND),
  handle(async (req, res, ctx) => {
    const clientId = uuid.parse(req.params.clientId);
    const body = content.extend({ loanId: uuid.nullish(), to: z.string().max(255).nullish() }).parse(req.body ?? {});
    const message = await commsService.sendToClient(ctx, clientId, body);
    if (message.status === 'FAILED') {
      res.status(502).json({ success: false, message: message.errorMessage ?? 'The message could not be sent.', error: message.errorCode ?? 'SEND_FAILED', data: message, timestamp: now() });
      return;
    }
    ok(res, message, 201, 'Message sent');
  })
);

router.post(
  '/clients/:clientId/click-to-chat',
  requirePermission(PERMISSIONS.COMMUNICATIONS_SEND),
  handle(async (req, res, ctx) => {
    const clientId = uuid.parse(req.params.clientId);
    const body = z.object({ body: z.string().min(1).max(4000), loanId: uuid.nullish(), to: z.string().max(40).nullish() }).parse(req.body ?? {});
    ok(res, await commsService.clickToChat(ctx, clientId, body), 201);
  })
);

const historyQuery = z.object({
  channel: channel.optional(),
  status: z.string().max(20).optional(),
  direction: z.enum(['OUTBOUND', 'INBOUND']).optional(),
  search: z.string().max(100).optional(),
  page,
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

router.get(
  '/clients/:clientId/messages',
  requirePermission(PERMISSIONS.COMMUNICATIONS_VIEW),
  handle(async (req, res, ctx) => {
    const clientId = uuid.parse(req.params.clientId);
    ok(res, await commsService.listMessages(ctx, { ...historyQuery.parse(req.query), clientId }));
  })
);

router.get(
  '/clients/:clientId/preferences',
  requirePermission(PERMISSIONS.COMMUNICATIONS_VIEW),
  handle(async (req, res, ctx) => ok(res, await commsService.getPreferences(ctx, uuid.parse(req.params.clientId))))
);

router.put(
  '/clients/:clientId/preferences',
  requirePermission(PERMISSIONS.CLIENTS_UPDATE),
  handle(async (req, res, ctx) => {
    const body = z
      .object({ emailOptOut: z.boolean().optional(), smsOptOut: z.boolean().optional(), whatsappOptOut: z.boolean().optional(), note: z.string().max(500).nullish() })
      .strict()
      .parse(req.body ?? {});
    ok(res, await commsService.updatePreferences(ctx, uuid.parse(req.params.clientId), body), 200, 'Preferences saved');
  })
);

router.get(
  '/loans/:loanId/messages',
  requirePermission(PERMISSIONS.COMMUNICATIONS_VIEW),
  handle(async (req, res, ctx) => {
    const loanId = uuid.parse(req.params.loanId);
    ok(res, await commsService.listMessages(ctx, { ...historyQuery.parse(req.query), loanId }));
  })
);

router.get(
  '/messages',
  requirePermission(PERMISSIONS.COMMUNICATIONS_VIEW),
  handle(async (req, res, ctx) => {
    const query = historyQuery.extend({ broadcastId: uuid.optional() }).parse(req.query);
    ok(res, await commsService.listMessages(ctx, query));
  })
);

// ------------------------------------------------------------- broadcasts
const broadcastBody = content.extend({ audience, name: z.string().max(150).nullish() });

router.post(
  '/broadcasts/preview',
  requirePermission(PERMISSIONS.COMMUNICATIONS_BROADCAST),
  handle(async (req, res, ctx) => ok(res, await commsService.previewBroadcast(ctx, broadcastBody.parse(req.body ?? {}))))
);

router.post(
  '/broadcasts',
  requirePermission(PERMISSIONS.COMMUNICATIONS_BROADCAST),
  handle(async (req, res, ctx) => ok(res, await commsService.createBroadcast(ctx, broadcastBody.parse(req.body ?? {})), 201, 'Broadcast queued'))
);

router.get(
  '/broadcasts',
  requirePermission(PERMISSIONS.COMMUNICATIONS_VIEW),
  handle(async (req, res, ctx) => {
    const query = z.object({ page }).parse(req.query);
    ok(res, await commsService.listBroadcasts(ctx, query.page ?? 1));
  })
);

router.get(
  '/broadcasts/:id',
  requirePermission(PERMISSIONS.COMMUNICATIONS_VIEW),
  handle(async (req, res, ctx) => ok(res, await commsService.getBroadcast(ctx, uuid.parse(req.params.id))))
);

router.post(
  '/broadcasts/:id/cancel',
  requirePermission(PERMISSIONS.COMMUNICATIONS_BROADCAST),
  handle(async (req, res, ctx) => ok(res, await commsService.cancelBroadcast(ctx, uuid.parse(req.params.id)), 200, 'Broadcast cancelled'))
);

// -------------------------------------------------------------- templates
const templateBody = z.object({
  name: z.string().min(1).max(100),
  channel: z.enum(['EMAIL', 'SMS', 'WHATSAPP', 'ANY']),
  subject: z.string().max(300).nullish(),
  body: z.string().min(1).max(10_000),
  isActive: z.boolean().optional(),
});

router.get(
  '/templates',
  requirePermission(PERMISSIONS.COMMUNICATIONS_VIEW),
  handle(async (req, res, ctx) => {
    const query = z.object({ channel: channel.optional() }).parse(req.query);
    ok(res, await commsService.listTemplates(ctx, query.channel));
  })
);

router.post(
  '/templates',
  requirePermission(PERMISSIONS.COMMUNICATIONS_TEMPLATES),
  handle(async (req, res, ctx) => ok(res, await commsService.saveTemplate(ctx, templateBody.parse(req.body ?? {})), 201, 'Template saved'))
);

router.put(
  '/templates/:id',
  requirePermission(PERMISSIONS.COMMUNICATIONS_TEMPLATES),
  handle(async (req, res, ctx) =>
    ok(res, await commsService.saveTemplate(ctx, { ...templateBody.parse(req.body ?? {}), id: uuid.parse(req.params.id) }), 200, 'Template saved')
  )
);

router.delete(
  '/templates/:id',
  requirePermission(PERMISSIONS.COMMUNICATIONS_TEMPLATES),
  handle(async (req, res, ctx) => {
    await commsService.deleteTemplate(ctx, uuid.parse(req.params.id));
    ok(res, null, 200, 'Template deleted');
  })
);

router.get(
  '/whatsapp/templates',
  requirePermission(PERMISSIONS.COMMUNICATIONS_SEND),
  handle(async (_req, res, ctx) => ok(res, await commsService.whatsappTemplates(ctx)))
);

export default router;

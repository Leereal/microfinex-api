/**
 * What Composio pushes at us.
 *
 *   POST /public/assistant/composio    new mail in a connected mailbox
 *
 * Reached without signing in, so the signature is checked before anything else
 * and an unsigned request is refused outright. The work itself is handed to the
 * automations that would have picked the mail up on their next poll: that way
 * a webhook only makes things faster, never different, and a missed webhook
 * costs a few minutes rather than losing an application.
 */

import { Router, type Request } from 'express';
import { prisma } from '../config/database';
import { verifyComposioWebhook } from '../services/assistant/composio/composio.client';
import { assistantConnectionService } from '../services/assistant/composio/connections.service';
import { runAutomation } from '../services/assistant/assistant.automations';

const router = Router();
const now = () => new Date().toISOString();

router.post('/composio', async (req, res) => {
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  const verified = verifyComposioWebhook({
    id: req.header('webhook-id') ?? undefined,
    timestamp: req.header('webhook-timestamp') ?? undefined,
    signature: req.header('webhook-signature') ?? undefined,
    rawBody,
  });

  if (!verified.ok) {
    console.warn('Composio webhook refused:', verified.reason);
    return res.status(401).json({ success: false, error: 'INVALID_SIGNATURE', timestamp: now() });
  }

  // Acknowledge immediately: Composio retries anything slow, and the work
  // below can take longer than its patience.
  res.status(200).json({ success: true, timestamp: now() });

  void (async () => {
    try {
      const payload = req.body as {
        type?: string;
        metadata?: { user_id?: string; trigger_slug?: string; connected_account_id?: string };
      };
      if (payload?.type && !String(payload.type).includes('trigger')) return;

      const composioUserId = payload?.metadata?.user_id;
      if (!composioUserId) return;

      const connection = await assistantConnectionService.byComposioUser(composioUserId);
      if (!connection) return;

      await prisma.assistantConnection.update({
        where: { id: connection.id },
        data: { lastSyncAt: new Date() },
      });

      // Whichever automations read this mailbox get a run now.
      const automations = await prisma.assistantAutomation.findMany({
        where: {
          organizationId: connection.organizationId,
          enabled: true,
          type: { in: ['EMAIL_APPLICATION_INTAKE', 'EMAIL_CORRESPONDENCE_CAPTURE'] },
        },
        select: { id: true, config: true },
      });

      for (const automation of automations) {
        const configured = (automation.config as { connectionId?: string } | null)?.connectionId;
        if (configured && configured !== connection.id) continue;
        await runAutomation(automation.id, 'WEBHOOK').catch(error =>
          console.error('Assistant webhook run failed:', (error as Error).message)
        );
      }
    } catch (error) {
      console.error('Composio webhook handling failed:', (error as Error).message);
    }
  })();
});

export default router;

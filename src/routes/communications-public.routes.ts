/**
 * The two communication endpoints outside the application:
 *
 *   GET/POST /public/communications/unsubscribe      the link in a broadcast email
 *   GET/POST /public/communications/whatsapp/webhook  Meta's webhook
 *
 * Neither is signed in. The unsubscribe link carries a signed token, and a
 * webhook call must carry Meta's signature over its raw body.
 */

import { Router, type Request, type Response } from 'express';
import { commsService } from '../services/communications/comms.service';
import { commsSettingsService } from '../services/communications/comms-settings.service';
import { CommsError, verifyMetaSignature } from '../services/communications/comms.logic';

const router = Router();

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function page(res: Response, status: number, title: string, body: string) {
  res
    .status(status)
    .type('html')
    .send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#1e293b">
<main style="max-width:480px;margin:10vh auto;background:#fff;border-radius:10px;padding:32px;box-shadow:0 2px 10px rgba(0,0,0,.06)">
<h1 style="margin:0 0 12px;font-size:22px;color:#064e3b">${escapeHtml(title)}</h1>${body}</main></body></html>`);
}

const CHANNEL_WORD: Record<string, string> = { EMAIL: 'emails', SMS: 'SMS messages', WHATSAPP: 'WhatsApp messages' };

/**
 * Showing the page never unsubscribes anyone: mail security scanners open
 * links on arrival, and would otherwise opt every recipient out. Only the
 * button (a POST) does - or a mail client's own one-click unsubscribe, which
 * is also a POST.
 */
router.get('/unsubscribe', (req: Request, res: Response) => {
  const token = String(req.query.token ?? '');
  page(
    res,
    200,
    'Unsubscribe',
    `<p style="line-height:1.6">Stop receiving these messages? You can still be contacted about your own account.</p>
<form method="post" action="?token=${encodeURIComponent(token)}"><button type="submit" style="background:#064e3b;color:#fff;border:0;border-radius:6px;padding:12px 20px;font-size:15px;cursor:pointer">Unsubscribe</button></form>`
  );
});

router.post('/unsubscribe', async (req: Request, res: Response) => {
  try {
    const result = await commsService.unsubscribe(String(req.query.token ?? ''));
    page(
      res,
      200,
      'You have been unsubscribed',
      `<p style="line-height:1.6">${escapeHtml(result.organizationName)} will no longer send you ${CHANNEL_WORD[result.channel] ?? 'these messages'} like this one.</p>`
    );
  } catch (error) {
    const message = error instanceof CommsError ? error.message : 'Something went wrong. Please try again later.';
    page(res, error instanceof CommsError ? error.httpStatus : 500, 'Could not unsubscribe', `<p style="line-height:1.6">${escapeHtml(message)}</p>`);
  }
});

/** Meta's subscription handshake. */
router.get('/whatsapp/webhook', async (req: Request, res: Response) => {
  const mode = String(req.query['hub.mode'] ?? '');
  const token = String(req.query['hub.verify_token'] ?? '');
  const challenge = String(req.query['hub.challenge'] ?? '');
  if (mode === 'subscribe' && (await commsSettingsService.verifyTokenMatches(token))) {
    res.status(200).type('text/plain').send(challenge);
    return;
  }
  res.sendStatus(403);
});

router.post('/whatsapp/webhook', async (req: Request, res: Response) => {
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  const phoneNumberId = String(
    (req.body as any)?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id ?? ''
  );
  const organizationId = phoneNumberId ? await commsSettingsService.organizationForPhoneNumberId(phoneNumberId) : null;
  if (!organizationId || !rawBody) {
    // Not for any organization here; acknowledged so Meta stops retrying.
    res.sendStatus(200);
    return;
  }
  const config = await commsSettingsService.resolve(organizationId);
  if (!config.whatsapp?.appSecret || !verifyMetaSignature(rawBody, req.header('x-hub-signature-256'), config.whatsapp.appSecret)) {
    res.sendStatus(401);
    return;
  }
  try {
    await commsService.handleWhatsAppWebhook(req.body);
  } catch (error) {
    console.error('WhatsApp webhook processing failed:', (error as Error).message);
  }
  res.sendStatus(200);
});

export default router;

/**
 * The three ways a message actually leaves: SMTP, BulkSMS and the WhatsApp
 * Cloud API. Each takes its organization's credentials per call, so nothing is
 * shared between organizations, and turns the provider's reply into a
 * SendOutcome with comms.logic.
 */

// nodemailer ships no types in this project; it is required as elsewhere.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const nodemailer = require('nodemailer');
import crypto from 'crypto';
import {
  DEFAULT_WHATSAPP_API_VERSION,
  MAX_SMS_PARTS,
  interpretBulkSmsResponse,
  interpretWhatsAppResponse,
  mapBulkSmsStatus,
  whatsappNumber,
  type MessageStatus,
  type SendOutcome,
} from './comms.logic';

const REQUEST_TIMEOUT_MS = 30_000;

async function fetchJson(url: string, init: RequestInit): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { detail: text.slice(0, 300) };
    }
    return { status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

const unreachable = (provider: string, error: unknown): SendOutcome => ({
  ok: false,
  providerMessageId: null,
  status: 'FAILED',
  errorCode: `${provider}_UNREACHABLE`,
  errorMessage:
    (error as Error)?.name === 'AbortError'
      ? `${provider === 'SMTP' ? 'The mail server' : provider === 'BULKSMS' ? 'BulkSMS' : 'WhatsApp'} did not answer in time.`
      : `Could not reach ${provider === 'SMTP' ? 'the mail server' : provider === 'BULKSMS' ? 'BulkSMS' : 'WhatsApp'}.`,
  retryable: true,
});

// ------------------------------------------------------------------- SMTP
export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  username: string | null;
  password: string | null;
  fromName: string;
  fromAddress: string;
  replyTo: string | null;
}

/** Transports are reused per configuration, so a broadcast does not reconnect per email. */
const transports = new Map<string, { transport: any; createdAt: number }>();

function transportFor(config: SmtpConfig) {
  const key = crypto
    .createHash('sha256')
    .update(JSON.stringify([config.host, config.port, config.secure, config.username, config.password]))
    .digest('hex');
  const cached = transports.get(key);
  if (cached && Date.now() - cached.createdAt < 30 * 60_000) return cached.transport;
  cached?.transport.close?.();
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.username ? { user: config.username, pass: config.password ?? '' } : undefined,
    pool: true,
    maxConnections: 3,
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  transports.set(key, { transport, createdAt: Date.now() });
  return transport;
}

export async function sendEmail(
  config: SmtpConfig,
  message: { to: string; subject: string; text: string; html: string; headers?: Record<string, string> }
): Promise<SendOutcome> {
  try {
    const info = await transportFor(config).sendMail({
      from: { name: config.fromName, address: config.fromAddress },
      replyTo: config.replyTo ?? undefined,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      headers: message.headers,
    });
    const rejected = (info.rejected ?? []) as string[];
    if (rejected.length > 0) {
      return {
        ok: false,
        providerMessageId: info.messageId ?? null,
        status: 'FAILED',
        errorCode: 'SMTP_REJECTED',
        errorMessage: 'The mail server refused this recipient address.',
        retryable: false,
      };
    }
    return { ok: true, providerMessageId: info.messageId ?? null, status: 'SENT', errorCode: null, errorMessage: null, retryable: false };
  } catch (error) {
    const err = error as { code?: string; responseCode?: number; message?: string };
    if (err.code === 'EAUTH') {
      return { ok: false, providerMessageId: null, status: 'FAILED', errorCode: 'SMTP_AUTH', errorMessage: 'The mail server rejected the username or password.', retryable: false };
    }
    if (err.responseCode && err.responseCode >= 500 && err.responseCode < 600) {
      return { ok: false, providerMessageId: null, status: 'FAILED', errorCode: `SMTP_${err.responseCode}`, errorMessage: `The mail server refused the email: ${err.message ?? ''}`.trim(), retryable: false };
    }
    return unreachable('SMTP', error);
  }
}

export async function verifySmtp(config: SmtpConfig): Promise<{ ok: boolean; message: string }> {
  try {
    await transportFor(config).verify();
    return { ok: true, message: `Connected to ${config.host}:${config.port}.` };
  } catch (error) {
    const err = error as { code?: string; message?: string };
    if (err.code === 'EAUTH') return { ok: false, message: 'The mail server rejected the username or password.' };
    return { ok: false, message: `Could not connect to ${config.host}:${config.port}: ${err.message ?? 'unknown error'}` };
  }
}

// ---------------------------------------------------------------- BulkSMS
export interface BulkSmsConfig {
  tokenId: string;
  tokenSecret: string;
  senderId: string | null;
  routingGroup: 'ECONOMY' | 'STANDARD' | 'PREMIUM';
}

const BULKSMS_BASE = 'https://api.bulksms.com/v1';
const bulkSmsAuth = (config: BulkSmsConfig) =>
  `Basic ${Buffer.from(`${config.tokenId}:${config.tokenSecret}`).toString('base64')}`;

export async function sendSms(config: BulkSmsConfig, message: { to: string; body: string; reference: string }): Promise<SendOutcome> {
  try {
    const { status, body } = await fetchJson(`${BULKSMS_BASE}/messages?auto-unicode=true`, {
      method: 'POST',
      headers: { Authorization: bulkSmsAuth(config), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        to: message.to,
        body: message.body,
        ...(config.senderId ? { from: config.senderId } : {}),
        routingGroup: config.routingGroup,
        longMessageMaxParts: MAX_SMS_PARTS,
        deliveryReports: 'ALL',
        // BulkSMS allows at most 20 characters here.
        userSuppliedId: message.reference.replace(/-/g, '').slice(0, 20),
      }),
    });
    return interpretBulkSmsResponse(status, body);
  } catch (error) {
    return unreachable('BULKSMS', error);
  }
}

export async function getSmsStatus(config: BulkSmsConfig, providerMessageId: string): Promise<{ status: MessageStatus; subtype: string | null } | null> {
  try {
    const { status, body } = await fetchJson(`${BULKSMS_BASE}/messages/${encodeURIComponent(providerMessageId)}`, {
      method: 'GET',
      headers: { Authorization: bulkSmsAuth(config), Accept: 'application/json' },
    });
    if (status !== 200 || !body) return null;
    const record = body as { status?: { type?: string; subtype?: string } };
    return { status: mapBulkSmsStatus(record.status?.type), subtype: record.status?.subtype ?? null };
  } catch {
    return null;
  }
}

export async function checkBulkSms(config: BulkSmsConfig): Promise<{ ok: boolean; message: string; balance?: number }> {
  try {
    const { status, body } = await fetchJson(`${BULKSMS_BASE}/profile`, {
      method: 'GET',
      headers: { Authorization: bulkSmsAuth(config), Accept: 'application/json' },
    });
    if (status === 200) {
      const balance = (body as { credits?: { balance?: number } })?.credits?.balance;
      return { ok: true, message: `Connected to BulkSMS${typeof balance === 'number' ? ` - ${balance} credits available` : ''}.`, balance };
    }
    if (status === 401) return { ok: false, message: 'BulkSMS rejected the token ID or secret.' };
    return { ok: false, message: `BulkSMS answered with HTTP ${status}.` };
  } catch (error) {
    return { ok: false, message: unreachable('BULKSMS', error).errorMessage ?? 'Could not reach BulkSMS.' };
  }
}

// --------------------------------------------------------------- WhatsApp
export interface WhatsAppConfig {
  phoneNumberId: string;
  businessAccountId: string | null;
  accessToken: string;
  apiVersion: string;
}

const graphUrl = (config: WhatsAppConfig, path: string) =>
  `https://graph.facebook.com/${config.apiVersion || DEFAULT_WHATSAPP_API_VERSION}/${path}`;

export async function sendWhatsApp(
  config: WhatsAppConfig,
  message:
    | { kind: 'text'; to: string; body: string }
    | { kind: 'template'; to: string; templateName: string; language: string; params: string[] }
): Promise<SendOutcome> {
  const payload =
    message.kind === 'text'
      ? {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: whatsappNumber(message.to),
          type: 'text',
          text: { preview_url: false, body: message.body },
        }
      : {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: whatsappNumber(message.to),
          type: 'template',
          template: {
            name: message.templateName,
            language: { code: message.language },
            ...(message.params.length
              ? { components: [{ type: 'body', parameters: message.params.map(text => ({ type: 'text', text })) }] }
              : {}),
          },
        };
  try {
    const { status, body } = await fetchJson(graphUrl(config, `${config.phoneNumberId}/messages`), {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return interpretWhatsAppResponse(status, body);
  } catch (error) {
    return unreachable('WHATSAPP', error);
  }
}

export async function checkWhatsApp(config: WhatsAppConfig): Promise<{ ok: boolean; message: string }> {
  try {
    const { status, body } = await fetchJson(
      graphUrl(config, `${config.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`),
      { method: 'GET', headers: { Authorization: `Bearer ${config.accessToken}` } }
    );
    if (status === 200) {
      const record = body as { display_phone_number?: string; verified_name?: string; quality_rating?: string };
      return {
        ok: true,
        message: `Connected to ${record.verified_name ?? 'WhatsApp'} (${record.display_phone_number ?? config.phoneNumberId})${record.quality_rating ? `, quality ${record.quality_rating}` : ''}.`,
      };
    }
    const error = (body as { error?: { message?: string } })?.error?.message;
    return { ok: false, message: error ? `WhatsApp refused: ${error}` : `WhatsApp answered with HTTP ${status}.` };
  } catch (error) {
    return { ok: false, message: unreachable('WHATSAPP', error).errorMessage ?? 'Could not reach WhatsApp.' };
  }
}

export interface WhatsAppTemplate {
  name: string;
  language: string;
  category: string;
  status: string;
  body: string;
  parameterCount: number;
}

/** Approved templates on the business account, with how many body parameters each takes. */
export async function listWhatsAppTemplates(config: WhatsAppConfig): Promise<WhatsAppTemplate[]> {
  if (!config.businessAccountId) {
    throw new Error('Add the WhatsApp Business Account ID in Organization Settings to load templates.');
  }
  const { status, body } = await fetchJson(
    graphUrl(config, `${config.businessAccountId}/message_templates?fields=name,language,status,category,components&limit=200`),
    { method: 'GET', headers: { Authorization: `Bearer ${config.accessToken}` } }
  );
  if (status !== 200) {
    const error = (body as { error?: { message?: string } })?.error?.message;
    throw new Error(error ? `WhatsApp refused: ${error}` : `WhatsApp answered with HTTP ${status}.`);
  }
  const data = ((body as { data?: unknown[] })?.data ?? []) as Array<{
    name: string;
    language: string;
    status: string;
    category: string;
    components?: Array<{ type: string; text?: string }>;
  }>;
  return data
    .filter(template => template.status === 'APPROVED')
    .map(template => {
      const text = template.components?.find(component => component.type === 'BODY')?.text ?? '';
      const placeholders = new Set(text.match(/\{\{\s*(\d+)\s*\}\}/g) ?? []);
      return {
        name: template.name,
        language: template.language,
        category: template.category,
        status: template.status,
        body: text,
        parameterCount: placeholders.size,
      };
    });
}

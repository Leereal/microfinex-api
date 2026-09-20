/**
 * Client communications - the rules.
 *
 * Pure functions, apart from providers, the database and HTTP, so each rule
 * can be tested on its own.
 *
 * Provider contracts were taken from the providers' own specifications:
 *
 *   BulkSMS JSON REST API v1 (https://api.bulksms.com/v1)
 *     POST /messages   Basic auth (token id + secret, or username + password)
 *       body { to, body, from?, routingGroup?, longMessageMaxParts?,
 *              deliveryReports?, userSuppliedId? }, query auto-unicode=true
 *       201 -> Message[] with status { type, subtype }
 *     GET /messages/{id}, GET /profile (credits.balance)
 *     errors -> { type, title, status, detail }
 *     status.type: ACCEPTED | SCHEDULED | SENT | DELIVERED | UNKNOWN | FAILED
 *     status.subtype (FAILED only): EXPIRED | HANDSET_ERROR | BLOCKED | NOT_SENT
 *
 *   WhatsApp Cloud API (https://graph.facebook.com/{version})
 *     POST /{phone-number-id}/messages   Bearer token
 *       text:     { messaging_product, recipient_type, to, type:"text", text:{ body } }
 *       template: { messaging_product, to, type:"template",
 *                   template:{ name, language:{ code }, components:[{ type:"body", parameters:[{ type:"text", text }] }] } }
 *       200 -> { messages:[{ id }] }, errors -> { error:{ message, code, error_data:{ details } } }
 *     Webhooks: GET hub.mode/hub.verify_token/hub.challenge handshake;
 *       POST signed X-Hub-Signature-256 = sha256=HMAC(app secret, raw body).
 *     Free-form text only reaches a client who wrote within 24 hours;
 *       otherwise an approved template is required (error 131047).
 */

import crypto from 'crypto';

export const CHANNELS = ['EMAIL', 'SMS', 'WHATSAPP'] as const;
export type Channel = (typeof CHANNELS)[number];

export const PROVIDERS = {
  SMTP: 'SMTP',
  BULKSMS: 'BULKSMS',
  WHATSAPP_CLOUD: 'WHATSAPP_CLOUD',
  CLICK_TO_CHAT: 'CLICK_TO_CHAT',
} as const;
export type Provider = (typeof PROVIDERS)[keyof typeof PROVIDERS];

export const MESSAGE_STATUS = {
  QUEUED: 'QUEUED',
  SENDING: 'SENDING',
  SENT: 'SENT',
  DELIVERED: 'DELIVERED',
  READ: 'READ',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
  CANCELLED: 'CANCELLED',
  OPENED: 'OPENED',
  RECEIVED: 'RECEIVED',
} as const;
export type MessageStatus = (typeof MESSAGE_STATUS)[keyof typeof MESSAGE_STATUS];

/** Statuses after which nothing more will happen to a message. */
export const FINAL_STATUSES: MessageStatus[] = ['DELIVERED', 'READ', 'FAILED', 'SKIPPED', 'CANCELLED', 'OPENED', 'RECEIVED'];

export const MAX_SEND_ATTEMPTS = 3;
/** A message claimed for sending this long ago was abandoned by a crash. */
export const SENDING_LOCK_MINUTES = 10;
/** WhatsApp free-form text is only allowed this long after the client last wrote. */
export const WHATSAPP_SESSION_HOURS = 24;
export const DEFAULT_WHATSAPP_API_VERSION = 'v23.0';
export const MAX_SMS_PARTS = 6;
export const MAX_BROADCAST_RECIPIENTS = 5000;

export class CommsError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatus = 400
  ) {
    super(message);
    this.name = 'CommsError';
  }
}

// ------------------------------------------------------------ addresses
const EMAIL_PATTERN = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

export function normaliseEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return EMAIL_PATTERN.test(trimmed) ? trimmed : null;
}

/**
 * A phone number in E.164 form (+27831234567), or null.
 *
 * Numbers are stored however they were typed. One with a + or a 00 prefix
 * already says its country; a local one (0831234567, or 831234567) takes the
 * organization's default country code. Anything that cannot be a real number
 * afterwards - too short, too long - is refused rather than guessed at.
 */
export function normalisePhone(value: unknown, defaultCountryCode: string | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const country = (defaultCountryCode ?? '').replace(/\D/g, '');

  let digits: string;
  if (trimmed.startsWith('+')) {
    digits = trimmed.slice(1).replace(/\D/g, '');
  } else {
    const raw = trimmed.replace(/\D/g, '');
    if (raw.startsWith('00')) digits = raw.slice(2);
    else if (country && raw.startsWith(country) && raw.length > country.length + 7) digits = raw;
    else if (!country) return null;
    else if (raw.startsWith('0')) digits = country + raw.slice(1);
    else digits = country + raw;
  }

  if (digits.length < 8 || digits.length > 15 || digits.startsWith('0')) return null;
  return `+${digits}`;
}

/** WhatsApp wants the number without the plus. */
export const whatsappNumber = (e164: string) => e164.replace(/^\+/, '');

/** Opens WhatsApp on the staff member's device with the message ready to send. */
export function clickToChatUrl(e164: string, text: string): string {
  return `https://wa.me/${whatsappNumber(e164)}?text=${encodeURIComponent(text)}`;
}

// ------------------------------------------------------------ recipients
export interface ContactRecord {
  contactType: string;
  contactValue: string;
  isPrimary: boolean;
  isWhatsApp: boolean;
}

export interface RecipientSource {
  email?: string | null;
  phone?: string | null;
  contacts?: ContactRecord[];
}

/**
 * The address a message on this channel goes to.
 *
 * Email: the client's email, else a primary email contact, else any email
 * contact. SMS: a primary mobile, else the client's phone, else any mobile.
 * WhatsApp: a mobile marked as WhatsApp (primary first), else the SMS choice.
 */
export function resolveAddress(
  channel: Channel,
  source: RecipientSource,
  defaultCountryCode: string | null
): string | null {
  const contacts = source.contacts ?? [];
  const byPrimary = (a: ContactRecord, b: ContactRecord) => Number(b.isPrimary) - Number(a.isPrimary);

  if (channel === 'EMAIL') {
    const candidates = [
      source.email,
      ...contacts.filter(c => c.contactType === 'EMAIL').sort(byPrimary).map(c => c.contactValue),
    ];
    for (const candidate of candidates) {
      const email = normaliseEmail(candidate);
      if (email) return email;
    }
    return null;
  }

  const mobiles = contacts.filter(c => c.contactType === 'MOBILE').sort(byPrimary);
  const ordered =
    channel === 'WHATSAPP'
      ? [...mobiles.filter(c => c.isWhatsApp).map(c => c.contactValue), ...mobiles.filter(c => c.isPrimary).map(c => c.contactValue), source.phone, ...mobiles.map(c => c.contactValue)]
      : [...mobiles.filter(c => c.isPrimary).map(c => c.contactValue), source.phone, ...mobiles.map(c => c.contactValue)];

  for (const candidate of ordered) {
    const phone = normalisePhone(candidate, defaultCountryCode);
    if (phone) return phone;
  }
  return null;
}

export interface Preferences {
  emailOptOut: boolean;
  smsOptOut: boolean;
  whatsappOptOut: boolean;
}

export function isOptedOut(channel: Channel, preferences: Preferences | null | undefined): boolean {
  if (!preferences) return false;
  if (channel === 'EMAIL') return preferences.emailOptOut;
  if (channel === 'SMS') return preferences.smsOptOut;
  return preferences.whatsappOptOut;
}

export type SkipReason = 'NO_ADDRESS' | 'OPTED_OUT' | 'DUPLICATE_ADDRESS';

export const SKIP_REASON_TEXT: Record<SkipReason, string> = {
  NO_ADDRESS: 'No usable address on file',
  OPTED_OUT: 'Opted out of this channel',
  DUPLICATE_ADDRESS: 'Same address as another recipient',
};

// ----------------------------------------------------------- placeholders
export const MERGE_FIELDS = [
  { key: 'firstName', label: 'First name' },
  { key: 'lastName', label: 'Last name' },
  { key: 'fullName', label: 'Full name' },
  { key: 'clientNumber', label: 'Client number' },
  { key: 'organizationName', label: 'Organization name' },
  { key: 'organizationPhone', label: 'Organization phone' },
  { key: 'organizationEmail', label: 'Organization email' },
  { key: 'loanNumber', label: 'Loan number' },
  { key: 'loanAmount', label: 'Loan amount' },
  { key: 'outstandingBalance', label: 'Outstanding balance' },
  { key: 'nextDueDate', label: 'Next due date' },
  { key: 'nextDueAmount', label: 'Next due amount' },
  { key: 'currency', label: 'Currency' },
] as const;

export type MergeContext = Partial<Record<(typeof MERGE_FIELDS)[number]['key'], string>>;

const PLACEHOLDER = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;

/**
 * Fill {{placeholders}} for one recipient.
 *
 * A placeholder with no value for this client is left out and reported, so a
 * preview can warn before "Dear {{firstName}}" reaches anyone. An unknown
 * placeholder name is reported too, rather than silently vanishing.
 */
export function renderTemplate(text: string, context: MergeContext): { text: string; missing: string[]; unknown: string[] } {
  const known = new Set<string>(MERGE_FIELDS.map(field => field.key));
  const missing = new Set<string>();
  const unknown = new Set<string>();
  const rendered = text.replace(PLACEHOLDER, (_match, key: string) => {
    if (!known.has(key)) {
      unknown.add(key);
      return '';
    }
    const value = context[key as keyof MergeContext];
    if (value === undefined || value === null || value === '') {
      missing.add(key);
      return '';
    }
    return value;
  });
  return { text: rendered, missing: [...missing], unknown: [...unknown] };
}

// -------------------------------------------------------------------- SMS
const GSM_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXTENDED = '^{}\\[~]|€\f';

/**
 * How an SMS will be billed: the encoding, its length in characters and the
 * number of parts. GSM text fits 160 characters in one part and 153 per part
 * once split; anything outside the GSM alphabet (emoji, curly quotes) turns
 * the whole message into Unicode, which fits 70 and 67.
 */
export function smsSegments(text: string): { encoding: 'GSM' | 'UNICODE'; length: number; parts: number } {
  let gsmLength = 0;
  let unicode = false;
  for (const char of text) {
    if (GSM_BASIC.includes(char)) gsmLength += 1;
    else if (GSM_EXTENDED.includes(char)) gsmLength += 2;
    else {
      unicode = true;
      break;
    }
  }
  if (unicode) {
    const length = [...text].length;
    return { encoding: 'UNICODE', length, parts: length <= 70 ? 1 : Math.ceil(length / 67) };
  }
  return { encoding: 'GSM', length: gsmLength, parts: gsmLength <= 160 ? 1 : Math.ceil(gsmLength / 153) };
}

// ---------------------------------------------------------------- email
const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The HTML version of an email, built from plain text.
 *
 * Staff write plain text; it is escaped here, so nothing they paste can inject
 * markup, and paragraphs and line breaks are kept. A broadcast carries an
 * unsubscribe link in the footer.
 */
export function buildEmailHtml(input: {
  body: string;
  organizationName: string;
  organizationContact?: string | null;
  unsubscribeUrl?: string | null;
}): string {
  const paragraphs = input.body
    .split(/\n{2,}/)
    .map(part => `<p style="margin:0 0 14px">${escapeHtml(part).replace(/\n/g, '<br>')}</p>`)
    .join('');
  const contact = input.organizationContact ? `<br>${escapeHtml(input.organizationContact)}` : '';
  const unsubscribe = input.unsubscribeUrl
    ? `<br><a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#64748b">Unsubscribe from these emails</a>`
    : '';
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#1e293b">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden">
<tr><td style="background:#064e3b;color:#ffffff;padding:18px 24px;font-size:18px;font-weight:bold">${escapeHtml(input.organizationName)}</td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.6">${paragraphs}</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b">${escapeHtml(input.organizationName)}${contact}${unsubscribe}</td></tr>
</table></body></html>`;
}

// ---------------------------------------------------- unsubscribe tokens
export interface UnsubscribeClaims {
  organizationId: string;
  clientId: string;
  channel: Channel;
}

/**
 * A link a client can use to opt out, signed so it cannot be altered to opt
 * someone else out. It does not expire: an old email's link should still work.
 */
export function signUnsubscribeToken(claims: UnsubscribeClaims, secret: string): string {
  const payload = Buffer.from(`${claims.organizationId}.${claims.clientId}.${claims.channel}`).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyUnsubscribeToken(token: string, secret: string): UnsubscribeClaims | null {
  const [payload, signature] = String(token || '').split('.');
  if (!payload || !signature) return null;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const [organizationId, clientId, channel] = Buffer.from(payload, 'base64url').toString('utf8').split('.');
  if (!organizationId || !clientId || !CHANNELS.includes(channel as Channel)) return null;
  return { organizationId, clientId, channel: channel as Channel };
}

/** Verifies Meta's X-Hub-Signature-256 over the raw request body. */
export function verifyMetaSignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith('sha256=') || !appSecret) return false;
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const a = Buffer.from(header.slice(7), 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ------------------------------------------------------ provider replies
export interface SendOutcome {
  ok: boolean;
  providerMessageId: string | null;
  status: MessageStatus;
  errorCode: string | null;
  errorMessage: string | null;
  /** Worth trying again later: rate limits, timeouts, provider outages. */
  retryable: boolean;
}

const failed = (errorCode: string, errorMessage: string, retryable = false): SendOutcome => ({
  ok: false,
  providerMessageId: null,
  status: 'FAILED',
  errorCode,
  errorMessage,
  retryable,
});

/** A BulkSMS status as ours. */
export function mapBulkSmsStatus(type: unknown): MessageStatus {
  switch (String(type)) {
    case 'DELIVERED':
      return 'DELIVERED';
    case 'FAILED':
      return 'FAILED';
    default:
      return 'SENT'; // ACCEPTED, SCHEDULED, SENT, UNKNOWN - on its way
  }
}

export const BULKSMS_FAILURE_TEXT: Record<string, string> = {
  EXPIRED: 'The message expired before the phone could receive it.',
  HANDSET_ERROR: 'The phone could not accept the message (for example, its storage is full).',
  BLOCKED: 'The recipient has blocked messages from this sender (for example, by replying STOP).',
  NOT_SENT: 'The message could not be routed to this number.',
};

export function interpretBulkSmsResponse(httpStatus: number, body: unknown): SendOutcome {
  if (httpStatus === 201 && Array.isArray(body) && body[0]) {
    const message = body[0] as { id?: string; status?: { type?: string; subtype?: string } };
    const status = mapBulkSmsStatus(message.status?.type);
    if (status === 'FAILED') {
      const subtype = message.status?.subtype ?? 'FAILED';
      return { ...failed(`BULKSMS_${subtype}`, BULKSMS_FAILURE_TEXT[subtype] ?? 'BulkSMS could not send the message.'), providerMessageId: message.id ?? null };
    }
    return { ok: true, providerMessageId: message.id ?? null, status, errorCode: null, errorMessage: null, retryable: false };
  }
  const error = (body ?? {}) as { title?: string; detail?: string };
  const detail = error.detail || error.title;
  if (httpStatus === 401) return failed('BULKSMS_AUTH', 'BulkSMS rejected the API credentials. Check them in Organization Settings.');
  if (httpStatus === 403) return failed('BULKSMS_FORBIDDEN', detail ? `BulkSMS refused: ${detail}` : 'BulkSMS refused the request - check the account has credits.');
  if (httpStatus === 429) return failed('BULKSMS_RATE_LIMIT', 'BulkSMS is rate limiting requests.', true);
  if (httpStatus >= 500) return failed(`BULKSMS_HTTP_${httpStatus}`, 'BulkSMS is unavailable right now.', true);
  return failed(`BULKSMS_HTTP_${httpStatus}`, detail ? `BulkSMS refused: ${detail}` : `BulkSMS refused the message (HTTP ${httpStatus}).`);
}

const WHATSAPP_ERRORS: Record<number, { text: string; retryable?: boolean }> = {
  131047: { text: 'More than 24 hours have passed since the client last wrote. Use an approved template message.' },
  131026: { text: 'WhatsApp could not deliver to this number - it may not be on WhatsApp.' },
  131030: { text: 'This number is not on the test recipient list of the WhatsApp account.' },
  131051: { text: 'This message type is not supported.' },
  131056: { text: 'Too many messages to this client in a short time. It will be retried.', retryable: true },
  130429: { text: 'WhatsApp is rate limiting this account. It will be retried.', retryable: true },
  131016: { text: 'WhatsApp is temporarily unavailable. It will be retried.', retryable: true },
  132000: { text: 'The template parameters do not match the approved template.' },
  132001: { text: 'That template does not exist in this language, or is not approved.' },
  190: { text: 'The WhatsApp access token has expired or is invalid. Update it in Organization Settings.' },
  100: { text: 'WhatsApp rejected a parameter of the request.' },
};

export function interpretWhatsAppResponse(httpStatus: number, body: unknown): SendOutcome {
  const record = (body ?? {}) as { messages?: Array<{ id?: string }>; error?: { code?: number; message?: string; error_data?: { details?: string } } };
  if (httpStatus >= 200 && httpStatus < 300 && record.messages?.[0]?.id) {
    return { ok: true, providerMessageId: record.messages[0].id, status: 'SENT', errorCode: null, errorMessage: null, retryable: false };
  }
  const code = record.error?.code;
  const known = code !== undefined ? WHATSAPP_ERRORS[code] : undefined;
  const detail = record.error?.error_data?.details || record.error?.message;
  if (known) return failed(`WHATSAPP_${code}`, known.text, Boolean(known.retryable));
  if (httpStatus === 429 || httpStatus >= 500) return failed(`WHATSAPP_HTTP_${httpStatus}`, 'WhatsApp is unavailable right now.', true);
  return failed(code !== undefined ? `WHATSAPP_${code}` : `WHATSAPP_HTTP_${httpStatus}`, detail ? `WhatsApp refused: ${detail}` : 'WhatsApp refused the message.');
}

/** A WhatsApp webhook status as ours. */
export function mapWhatsAppStatus(status: unknown): MessageStatus | null {
  switch (String(status)) {
    case 'sent':
      return 'SENT';
    case 'delivered':
      return 'DELIVERED';
    case 'read':
      return 'READ';
    case 'failed':
      return 'FAILED';
    default:
      return null;
  }
}

/** Status only ever moves forward: a late "delivered" never undoes "read". */
export function isStatusAdvance(current: string, next: MessageStatus): boolean {
  const order: Record<string, number> = { QUEUED: 0, SENDING: 1, SENT: 2, DELIVERED: 3, READ: 4 };
  if (next === 'FAILED') return !['DELIVERED', 'READ', 'FAILED'].includes(current);
  if (!(current in order) || !(next in order)) return false;
  return order[next]! > order[current]!;
}

/** Replies that mean "stop messaging me". */
export function isOptOutKeyword(text: unknown): boolean {
  return /^\s*(stop|stopall|unsubscribe|opt[\s-]?out|cancel|end|quit)\s*[.!]*\s*$/i.test(String(text ?? ''));
}

/** Backoff before retrying a transient failure. */
export function retryDelayMs(attempt: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, attempt - 1), 30 * 60_000);
}

/**
 * One shape of email, whichever mailbox it came from.
 *
 * Gmail and Outlook answer quite differently - different tool names, different
 * argument names, different field names, attachments as ids in one and as
 * base64 in the other - so everything above this file works with `MailMessage`
 * and never learns which provider is behind it.
 *
 * The field names each provider returns have changed before and will change
 * again, so reading is deliberately forgiving: several likely names are tried
 * for each value, and anything missing comes back null rather than throwing.
 */

import { AssistantError, mailSearchQuery, truncate } from '../assistant.logic';
import { composioClient } from './composio.client';

export interface MailAddress {
  name: string | null;
  address: string;
}

export interface MailAttachment {
  id: string | null;
  fileName: string;
  mimeType: string;
  size: number | null;
  /** Present when the provider returns the bytes inline (Outlook does). */
  contentBase64?: string | null;
}

export interface MailMessage {
  id: string;
  threadId: string | null;
  from: MailAddress | null;
  to: MailAddress[];
  cc: MailAddress[];
  subject: string;
  date: Date | null;
  bodyText: string;
  attachments: MailAttachment[];
  isOutbound: boolean;
}

export interface MailConnection {
  id: string;
  toolkit: string;
  composioUserId: string;
  composioAccountId: string | null;
}

const EMAIL_PATTERN = /([^\s<>",;]+@[^\s<>",;]+\.[^\s<>",;]+)/;

/** "Jane Doe <jane@example.com>" and the dozen other ways this arrives. */
export function parseAddress(value: unknown): MailAddress | null {
  if (!value) return null;
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    const nested = (object.emailAddress ?? object.email_address) as Record<string, unknown> | undefined;
    const address = String(nested?.address ?? object.address ?? object.email ?? object.value ?? '');
    const name = (nested?.name ?? object.name ?? null) as string | null;
    return address ? { name: name ? String(name) : null, address: address.toLowerCase() } : null;
  }
  const text = String(value);
  const match = text.match(EMAIL_PATTERN);
  if (!match) return null;
  const name = text.split('<')[0]?.trim().replace(/^"|"$/g, '') || null;
  return { name: name && name !== match[1] ? name : null, address: match[1]!.toLowerCase() };
}

function parseAddresses(value: unknown): MailAddress[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : String(value).split(/[,;]/);
  return list.map(parseAddress).filter((entry): entry is MailAddress => Boolean(entry));
}

function firstString(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  if (typeof value === 'number') return new Date(value > 1e12 ? value : value * 1000);
  const text = String(value);
  const numeric = Number(text);
  if (Number.isFinite(numeric) && text.length >= 10 && !text.includes('-')) {
    return new Date(numeric > 1e12 ? numeric : numeric * 1000);
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Strip HTML down to something a model can read without drowning in markup. */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ------------------------------------------------------------------- Gmail

function gmailMessage(raw: Record<string, unknown>): MailMessage {
  const labels = (raw.labelIds ?? raw.label_ids ?? []) as string[];
  const preview = (raw.preview ?? {}) as Record<string, unknown>;
  const bodyRaw = firstString(raw, ['messageText', 'message_text', 'body', 'snippet']) || firstString(preview, ['body']);
  const attachments = ((raw.attachmentList ?? raw.attachment_list ?? raw.attachments ?? []) as Array<Record<string, unknown>>).map(
    attachment => ({
      id: (attachment.attachmentId ?? attachment.attachment_id ?? attachment.id ?? null) as string | null,
      fileName: String(attachment.filename ?? attachment.fileName ?? attachment.name ?? 'attachment'),
      mimeType: String(attachment.mimeType ?? attachment.mime_type ?? 'application/octet-stream'),
      size: Number(attachment.size ?? 0) || null,
    })
  );

  return {
    id: String(raw.messageId ?? raw.message_id ?? raw.id ?? ''),
    threadId: (raw.threadId ?? raw.thread_id ?? null) as string | null,
    from: parseAddress(raw.sender ?? raw.from),
    to: parseAddresses(raw.to ?? raw.recipient),
    cc: parseAddresses(raw.cc),
    subject: firstString(raw, ['subject']) || firstString(preview, ['subject']),
    date: parseDate(raw.messageTimestamp ?? raw.message_timestamp ?? raw.internalDate ?? raw.date),
    bodyText: truncate(bodyRaw.includes('<') ? htmlToText(bodyRaw) : bodyRaw, 20_000),
    attachments,
    isOutbound: labels.includes('SENT'),
  };
}

// ----------------------------------------------------------------- Outlook

function outlookMessage(raw: Record<string, unknown>): MailMessage {
  const body = (raw.body ?? {}) as Record<string, unknown>;
  const content = String(body.content ?? raw.bodyPreview ?? '');
  const isHtml = String(body.contentType ?? '').toLowerCase() === 'html' || content.includes('<html');
  const attachments = ((raw.attachments ?? []) as Array<Record<string, unknown>>).map(attachment => ({
    id: (attachment.id ?? null) as string | null,
    fileName: String(attachment.name ?? 'attachment'),
    mimeType: String(attachment.contentType ?? 'application/octet-stream'),
    size: Number(attachment.size ?? 0) || null,
    contentBase64: (attachment.contentBytes ?? null) as string | null,
  }));

  return {
    id: String(raw.id ?? ''),
    threadId: (raw.conversationId ?? null) as string | null,
    from: parseAddress(raw.from ?? raw.sender),
    to: parseAddresses(raw.toRecipients),
    cc: parseAddresses(raw.ccRecipients),
    subject: String(raw.subject ?? ''),
    date: parseDate(raw.receivedDateTime ?? raw.sentDateTime),
    bodyText: truncate(isHtml ? htmlToText(content) : content, 20_000),
    attachments,
    // Mail found in the Sent Items folder is marked by the caller; a single
    // message read on its own does not say which folder it came from.
    isOutbound: false,
  };
}

/** Pull the list of messages out of whatever envelope the tool used. */
function listOf(data: Record<string, unknown>): Array<Record<string, unknown>> {
  for (const key of ['messages', 'value', 'items', 'results', 'data']) {
    const value = data[key];
    if (Array.isArray(value)) return value as Array<Record<string, unknown>>;
  }
  return [];
}

export interface SearchMailOptions {
  /** Free text, as the provider's own search would take it. */
  query?: string;
  since?: Date;
  maxResults?: number;
  /** Look in Sent as well as the inbox. */
  includeSent?: boolean;
  onlyWithAttachments?: boolean;
}

class EmailAdapter {
  private assertReady(connection: MailConnection) {
    if (!connection.composioAccountId) {
      throw new AssistantError('That mailbox is not finished connecting yet.', 'CONNECTION_NOT_READY', 409);
    }
  }

  /** Recent messages matching a search. */
  async search(connection: MailConnection, options: SearchMailOptions = {}): Promise<MailMessage[]> {
    this.assertReady(connection);
    const max = Math.min(options.maxResults ?? 20, 50);

    if (connection.toolkit === 'gmail') {
      const parts: string[] = [];
      const words = mailSearchQuery(options.query);
      if (words) parts.push(words);
      if (options.onlyWithAttachments) parts.push('has:attachment');
      if (options.since) parts.push(`after:${Math.floor(options.since.getTime() / 1000)}`);
      if (!options.includeSent) parts.push('in:inbox');

      const data = await composioClient.executeTool({
        slug: 'GMAIL_FETCH_EMAILS',
        connectedAccountId: connection.composioAccountId!,
        composioUserId: connection.composioUserId,
        arguments: {
          user_id: 'me',
          query: parts.join(' ').trim() || undefined,
          max_results: max,
          include_payload: true,
          verbose: true,
        },
      });
      return listOf(data).map(gmailMessage).filter(message => message.id);
    }

    // Outlook: a single $filter over the mailbox, then the same again over
    // Sent Items when asked - Graph has no "search both folders" in one call.
    const filters: string[] = [];
    if (options.since) filters.push(`receivedDateTime ge ${options.since.toISOString()}`);
    if (options.onlyWithAttachments) filters.push('hasAttachments eq true');

    const searchWords = mailSearchQuery(options.query);

    const fetchFolder = async (folder: string) => {
      const data = await composioClient.executeTool({
        slug: searchWords ? 'OUTLOOK_SEARCH_MESSAGES' : 'OUTLOOK_LIST_MESSAGES',
        connectedAccountId: connection.composioAccountId!,
        composioUserId: connection.composioUserId,
        arguments: {
          user_id: 'me',
          folder_id: folder,
          top: max,
          ...(searchWords ? { query: searchWords, search: searchWords } : {}),
          ...(filters.length ? { filter: filters.join(' and ') } : {}),
          orderby: ['receivedDateTime desc'],
        },
      });
      const messages = listOf(data).map(outlookMessage).filter(message => message.id);
      return folder === 'sentitems'
        ? messages.map(message => ({ ...message, isOutbound: true }))
        : messages;
    };

    const inbox = await fetchFolder('inbox');
    if (!options.includeSent) return inbox;
    const sent = await fetchFolder('sentitems').catch(() => []);
    return [...inbox, ...sent].sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0)).slice(0, max);
  }

  /** One message in full, including its attachment list. */
  async get(connection: MailConnection, messageId: string): Promise<MailMessage> {
    this.assertReady(connection);

    if (connection.toolkit === 'gmail') {
      const data = await composioClient.executeTool({
        slug: 'GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID',
        connectedAccountId: connection.composioAccountId!,
        composioUserId: connection.composioUserId,
        arguments: { user_id: 'me', message_id: messageId, format: 'full' },
      });
      const raw = (data.message ?? data.data ?? data) as Record<string, unknown>;
      return gmailMessage(raw);
    }

    const data = await composioClient.executeTool({
      slug: 'OUTLOOK_GET_MESSAGE',
      connectedAccountId: connection.composioAccountId!,
      composioUserId: connection.composioUserId,
      arguments: { user_id: 'me', message_id: messageId },
    });
    const raw = (data.message ?? data.value ?? data) as Record<string, unknown>;
    const message = outlookMessage(raw);

    if (message.attachments.length === 0 && raw.hasAttachments) {
      const attachments = await composioClient
        .executeTool({
          slug: 'OUTLOOK_LIST_ATTACHMENTS',
          connectedAccountId: connection.composioAccountId!,
          composioUserId: connection.composioUserId,
          arguments: { user_id: 'me', message_id: messageId },
        })
        .catch(() => ({}) as Record<string, unknown>);
      message.attachments = listOf(attachments).map(attachment => ({
        id: (attachment.id ?? null) as string | null,
        fileName: String(attachment.name ?? 'attachment'),
        mimeType: String(attachment.contentType ?? 'application/octet-stream'),
        size: Number(attachment.size ?? 0) || null,
        contentBase64: (attachment.contentBytes ?? null) as string | null,
      }));
    }
    return message;
  }

  /**
   * The bytes of one attachment.
   *
   * Outlook hands them back inline. Gmail returns either base64 or a link to
   * where Composio put the file, so both are handled, and a link is fetched
   * only over https.
   */
  async downloadAttachment(
    connection: MailConnection,
    messageId: string,
    attachment: MailAttachment
  ): Promise<Buffer> {
    this.assertReady(connection);

    if (attachment.contentBase64) return Buffer.from(attachment.contentBase64, 'base64');

    if (connection.toolkit !== 'gmail') {
      const data = await composioClient.executeTool({
        slug: 'OUTLOOK_GET_ATTACHMENT',
        connectedAccountId: connection.composioAccountId!,
        composioUserId: connection.composioUserId,
        arguments: { user_id: 'me', message_id: messageId, attachment_id: attachment.id },
      });
      return extractFileBytes(data, attachment.fileName);
    }

    const data = await composioClient.executeTool({
      slug: 'GMAIL_GET_ATTACHMENT',
      connectedAccountId: connection.composioAccountId!,
      composioUserId: connection.composioUserId,
      arguments: {
        user_id: 'me',
        message_id: messageId,
        attachment_id: attachment.id,
        file_name: attachment.fileName,
      },
    });
    return extractFileBytes(data, attachment.fileName);
  }

  async send(
    connection: MailConnection,
    input: { to: string; subject: string; body: string; cc?: string[]; isHtml?: boolean; threadId?: string | null; replyTo?: string | null }
  ): Promise<{ id: string | null }> {
    this.assertReady(connection);

    if (connection.toolkit === 'gmail') {
      const data = input.threadId
        ? await composioClient.executeTool({
            slug: 'GMAIL_REPLY_TO_THREAD',
            connectedAccountId: connection.composioAccountId!,
            composioUserId: connection.composioUserId,
            arguments: {
              user_id: 'me',
              thread_id: input.threadId,
              recipient_email: input.to,
              message_body: input.body,
              is_html: Boolean(input.isHtml),
            },
          })
        : await composioClient.executeTool({
            slug: 'GMAIL_SEND_EMAIL',
            connectedAccountId: connection.composioAccountId!,
            composioUserId: connection.composioUserId,
            arguments: {
              user_id: 'me',
              recipient_email: input.to,
              subject: input.subject,
              body: input.body,
              is_html: Boolean(input.isHtml),
              ...(input.cc?.length ? { cc: input.cc } : {}),
            },
          });
      return { id: (data.id ?? data.messageId ?? null) as string | null };
    }

    const data = await composioClient.executeTool({
      slug: 'OUTLOOK_SEND_EMAIL',
      connectedAccountId: connection.composioAccountId!,
      composioUserId: connection.composioUserId,
      arguments: {
        user_id: 'me',
        to_email: input.to,
        subject: input.subject,
        body: input.body,
        is_html: Boolean(input.isHtml),
        ...(input.cc?.length ? { cc_emails: input.cc } : {}),
      },
    });
    return { id: (data.id ?? null) as string | null };
  }

  async createDraft(
    connection: MailConnection,
    input: { to: string; subject: string; body: string; threadId?: string | null }
  ): Promise<{ id: string | null }> {
    this.assertReady(connection);

    const slug = connection.toolkit === 'gmail' ? 'GMAIL_CREATE_EMAIL_DRAFT' : 'OUTLOOK_CREATE_DRAFT';
    const data = await composioClient.executeTool({
      slug,
      connectedAccountId: connection.composioAccountId!,
      composioUserId: connection.composioUserId,
      arguments:
        connection.toolkit === 'gmail'
          ? {
              user_id: 'me',
              recipient_email: input.to,
              subject: input.subject,
              body: input.body,
              ...(input.threadId ? { thread_id: input.threadId } : {}),
            }
          : { user_id: 'me', to_email: input.to, subject: input.subject, body: input.body },
    });
    return { id: (data.id ?? data.draftId ?? null) as string | null };
  }
}

/**
 * Get the bytes out of a tool result.
 *
 * Composio returns a file either as base64 in the body or as a short-lived
 * link to its own storage, and which one depends on the tool and the file's
 * size. Only https links are followed.
 */
async function extractFileBytes(data: Record<string, unknown>, fileName: string): Promise<Buffer> {
  const candidates = [data, data.file, data.attachment, data.data].filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
  );

  for (const candidate of candidates) {
    const inline = candidate.data ?? candidate.content ?? candidate.contentBytes ?? candidate.base64;
    if (typeof inline === 'string' && inline.length > 32 && !inline.startsWith('http')) {
      return Buffer.from(inline.replace(/^data:[^;]+;base64,/, ''), 'base64');
    }
  }

  for (const candidate of candidates) {
    const link = candidate.s3url ?? candidate.uri ?? candidate.url ?? candidate.downloadUrl ?? candidate.s3_url;
    if (typeof link === 'string' && link.startsWith('https://')) {
      const response = await fetch(link, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) break;
      return Buffer.from(await response.arrayBuffer());
    }
  }

  throw new AssistantError(`The attachment ${fileName} could not be downloaded.`, 'ATTACHMENT_UNAVAILABLE', 502);
}

export const emailAdapter = new EmailAdapter();

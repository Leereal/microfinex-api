/**
 * Talking to clients: one-to-one messages from a client or loan, broadcasts
 * to many clients, reusable templates, opt-outs, the message history, and
 * what WhatsApp and unsubscribe links send back.
 *
 * Every message is written down before it is sent, so the history shows what
 * was attempted as well as what arrived.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { createAuditLog } from '../audit.service';
import { inAppNotificationService, NOTIFICATION_TYPES } from '../in-app-notification.service';
import {
  CHANNELS,
  CommsError,
  MAX_BROADCAST_RECIPIENTS,
  MERGE_FIELDS,
  PROVIDERS,
  WHATSAPP_SESSION_HOURS,
  buildEmailHtml,
  clickToChatUrl,
  isOptOutKeyword,
  isOptedOut,
  isStatusAdvance,
  mapWhatsAppStatus,
  normaliseEmail,
  normalisePhone,
  renderTemplate,
  resolveAddress,
  signUnsubscribeToken,
  smsSegments,
  verifyUnsubscribeToken,
  type Channel,
  type MergeContext,
  type SendOutcome,
  type SkipReason,
} from './comms.logic';
import { commsSettingsService, type ResolvedCommsConfig } from './comms-settings.service';
import { listWhatsAppTemplates, sendEmail, sendSms, sendWhatsApp } from './comms.providers';
import { onClientWhatsAppMessage } from '../assistant/whatsapp/whatsapp.assistant';

export interface CommsContext {
  organizationId: string;
  userId: string;
}

export interface MessageContent {
  channel: Channel;
  subject?: string | null;
  body?: string | null;
  /** WhatsApp template messages. */
  templateName?: string | null;
  templateLanguage?: string | null;
  templateParams?: string[] | null;
}

export type Audience =
  | { type: 'CLIENTS'; clientIds: string[] }
  | {
      type: 'FILTER';
      branchId?: string | null;
      clientStatus?: 'ACTIVE' | 'ALL';
      loanStatus?: 'ANY' | 'ACTIVE' | 'OVERDUE' | 'NO_ACTIVE_LOAN';
    };

const CLIENT_SELECT = {
  id: true,
  organizationId: true,
  firstName: true,
  lastName: true,
  businessName: true,
  clientNumber: true,
  email: true,
  phone: true,
  isActive: true,
  contacts: { select: { contactType: true, contactValue: true, isPrimary: true, isWhatsApp: true } },
  communicationPreference: { select: { emailOptOut: true, smsOptOut: true, whatsappOptOut: true, source: true, updatedAt: true } },
} satisfies Prisma.ClientSelect;

type ClientRecord = Prisma.ClientGetPayload<{ select: typeof CLIENT_SELECT }>;

const MESSAGE_SELECT = {
  id: true,
  clientId: true,
  loanId: true,
  broadcastId: true,
  channel: true,
  provider: true,
  direction: true,
  toAddress: true,
  fromAddress: true,
  subject: true,
  body: true,
  templateName: true,
  status: true,
  errorCode: true,
  errorMessage: true,
  createdAt: true,
  sentAt: true,
  deliveredAt: true,
  readAt: true,
  failedAt: true,
  sentBy: { select: { id: true, firstName: true, lastName: true } },
  client: { select: { id: true, firstName: true, lastName: true, businessName: true, clientNumber: true } },
  loan: { select: { id: true, loanNumber: true } },
  broadcast: { select: { id: true, name: true } },
} satisfies Prisma.ClientMessageSelect;

const money = (amount: Prisma.Decimal | number | null | undefined, currency: string) => {
  if (amount === null || amount === undefined) return undefined;
  const value = Number(amount);
  return `${currency} ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const day = (date: Date | null | undefined) =>
  date ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : undefined;

const clientName = (client: { firstName: string | null; lastName: string | null; businessName: string | null }) =>
  client.businessName || [client.firstName, client.lastName].filter(Boolean).join(' ') || 'Client';

export class CommsService {
  // -------------------------------------------------------------- helpers
  private async client(ctx: CommsContext, clientId: string): Promise<ClientRecord> {
    const client = await prisma.client.findFirst({ where: { id: clientId, organizationId: ctx.organizationId }, select: CLIENT_SELECT });
    if (!client) throw new CommsError('Client not found.', 'NOT_FOUND', 404);
    return client;
  }

  private channelReady(config: ResolvedCommsConfig, channel: Channel) {
    const ready = channel === 'EMAIL' ? config.emailEnabled : channel === 'SMS' ? config.smsEnabled : config.whatsappEnabled;
    if (!ready) {
      const name = channel === 'EMAIL' ? 'Email' : channel === 'SMS' ? 'SMS' : 'WhatsApp';
      throw new CommsError(`${name} is not set up for this organization. An administrator can switch it on in Organization Settings.`, 'CHANNEL_NOT_ACTIVE', 409);
    }
  }

  /** The values placeholders are filled with, for one client (and loan). */
  async mergeContext(config: ResolvedCommsConfig, client: ClientRecord, loanId?: string | null): Promise<{ context: MergeContext; loanId: string | null }> {
    const loan = await prisma.loan.findFirst({
      where: loanId
        ? { id: loanId, clientId: client.id, organizationId: config.organizationId }
        : { clientId: client.id, organizationId: config.organizationId, status: { in: ['ACTIVE', 'OVERDUE'] } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        loanNumber: true,
        amount: true,
        currency: true,
        outstandingBalance: true,
        nextDueDate: true,
        repaymentSchedule: {
          where: { status: 'PENDING', outstandingAmount: { gt: 0 } },
          orderBy: { dueDate: 'asc' },
          take: 1,
          select: { dueDate: true, outstandingAmount: true },
        },
      },
    });
    if (loanId && !loan) throw new CommsError('Loan not found for this client.', 'NOT_FOUND', 404);

    const next = loan?.repaymentSchedule[0];
    const currency = loan ? String(loan.currency) : undefined;
    return {
      loanId: loan?.id ?? null,
      context: {
        firstName: client.firstName ?? client.businessName ?? undefined,
        lastName: client.lastName ?? undefined,
        fullName: clientName(client),
        clientNumber: client.clientNumber,
        organizationName: config.organizationName,
        organizationPhone: config.organizationPhone ?? undefined,
        organizationEmail: config.organizationEmail ?? undefined,
        loanNumber: loan?.loanNumber,
        loanAmount: loan && currency ? money(loan.amount, currency) : undefined,
        outstandingBalance: loan && currency ? money(loan.outstandingBalance, currency) : undefined,
        nextDueDate: day(next?.dueDate ?? loan?.nextDueDate),
        nextDueAmount: next && currency ? money(next.outstandingAmount, currency) : undefined,
        currency,
      },
    };
  }

  private addresses(config: ResolvedCommsConfig, client: ClientRecord) {
    const phones = new Set<string>();
    const emails = new Set<string>();
    const whatsapp = new Set<string>();
    const add = (value: string | null | undefined, kind: 'phone' | 'email', isWhatsApp = false) => {
      if (kind === 'email') {
        const email = normaliseEmail(value);
        if (email) emails.add(email);
        return;
      }
      const phone = normalisePhone(value, config.defaultCountryCode);
      if (phone) {
        phones.add(phone);
        if (isWhatsApp) whatsapp.add(phone);
      }
    };
    add(client.email, 'email');
    add(client.phone, 'phone');
    for (const contact of client.contacts) {
      if (contact.contactType === 'EMAIL') add(contact.contactValue, 'email');
      if (contact.contactType === 'MOBILE') add(contact.contactValue, 'phone', contact.isWhatsApp);
    }
    return {
      EMAIL: { default: resolveAddress('EMAIL', client, config.defaultCountryCode), all: [...emails] },
      SMS: { default: resolveAddress('SMS', client, config.defaultCountryCode), all: [...phones] },
      WHATSAPP: { default: resolveAddress('WHATSAPP', client, config.defaultCountryCode), all: [...whatsapp, ...[...phones].filter(p => !whatsapp.has(p))] },
    };
  }

  private async lastWhatsAppInbound(organizationId: string, clientId: string) {
    const inbound = await prisma.clientMessage.findFirst({
      where: { organizationId, clientId, channel: 'WHATSAPP', direction: 'INBOUND' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return inbound?.createdAt ?? null;
  }

  private renderContent(content: MessageContent, context: MergeContext) {
    const body = renderTemplate(content.body ?? '', context);
    const subject = renderTemplate(content.subject ?? '', context);
    const params = (content.templateParams ?? []).map(param => renderTemplate(param, context));
    return {
      subject: subject.text.trim(),
      body: body.text.trim(),
      params: params.map(param => param.text.trim()),
      missing: [...new Set([...body.missing, ...subject.missing, ...params.flatMap(param => param.missing)])],
      unknown: [...new Set([...body.unknown, ...subject.unknown, ...params.flatMap(param => param.unknown)])],
    };
  }

  private validateContent(content: MessageContent) {
    if (!CHANNELS.includes(content.channel)) throw new CommsError('Choose email, SMS or WhatsApp.', 'INVALID_CHANNEL');
    const usesTemplate = content.channel === 'WHATSAPP' && Boolean(content.templateName);
    if (!usesTemplate && !content.body?.trim()) throw new CommsError('Write the message first.', 'EMPTY_MESSAGE');
    if (content.channel === 'EMAIL' && !content.subject?.trim()) throw new CommsError('An email needs a subject.', 'SUBJECT_REQUIRED');
    if ((content.body ?? '').length > 10_000) throw new CommsError('The message is too long.', 'MESSAGE_TOO_LONG');
    if (content.channel === 'SMS' && smsSegments(content.body ?? '').parts > 6) {
      throw new CommsError('The SMS is longer than 6 parts. Shorten it.', 'SMS_TOO_LONG');
    }
  }

  /** What a WhatsApp template message looks like in the history. */
  private templateSummary(content: MessageContent, params: string[]) {
    return `[Template: ${content.templateName}]${params.length ? ` ${params.join(' | ')}` : ''}`;
  }

  // ------------------------------------------------------------ provider
  /**
   * Send one message through its provider. Used by one-to-one sends and by
   * the dispatcher for broadcasts, so both behave identically.
   */
  async deliver(
    config: ResolvedCommsConfig,
    message: {
      id: string;
      channel: string;
      clientId: string | null;
      toAddress: string;
      subject: string | null;
      body: string;
      templateName: string | null;
      templateLanguage: string | null;
      templateParams: Prisma.JsonValue;
      broadcastId: string | null;
    }
  ): Promise<SendOutcome> {
    if (message.channel === 'EMAIL') {
      if (!config.emailEnabled || !config.email) return { ok: false, providerMessageId: null, status: 'FAILED', errorCode: 'CHANNEL_NOT_ACTIVE', errorMessage: 'Email is no longer set up for this organization.', retryable: false };
      // Broadcast emails carry a way to opt out, in the footer and in the
      // headers mail clients use for their own unsubscribe button.
      let unsubscribeUrl: string | null = null;
      if (message.broadcastId && message.clientId) {
        unsubscribeUrl = commsSettingsService.unsubscribeUrl(
          signUnsubscribeToken({ organizationId: config.organizationId, clientId: message.clientId, channel: 'EMAIL' }, commsSettingsService.linkSecret())
        );
      }
      return sendEmail(config.email, {
        to: message.toAddress,
        subject: message.subject ?? config.organizationName,
        text: unsubscribeUrl ? `${message.body}\n\n--\nUnsubscribe: ${unsubscribeUrl}` : message.body,
        html: buildEmailHtml({ body: message.body, organizationName: config.organizationName, organizationContact: config.organizationContact, unsubscribeUrl }),
        headers: unsubscribeUrl ? { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : undefined,
      });
    }
    if (message.channel === 'SMS') {
      if (!config.smsEnabled || !config.sms) return { ok: false, providerMessageId: null, status: 'FAILED', errorCode: 'CHANNEL_NOT_ACTIVE', errorMessage: 'SMS is no longer set up for this organization.', retryable: false };
      return sendSms(config.sms, { to: message.toAddress, body: message.body, reference: message.id });
    }
    if (!config.whatsappEnabled || !config.whatsapp) return { ok: false, providerMessageId: null, status: 'FAILED', errorCode: 'CHANNEL_NOT_ACTIVE', errorMessage: 'WhatsApp is no longer set up for this organization.', retryable: false };
    if (message.templateName) {
      return sendWhatsApp(config.whatsapp, {
        kind: 'template',
        to: message.toAddress,
        templateName: message.templateName,
        language: message.templateLanguage || 'en',
        params: Array.isArray(message.templateParams) ? (message.templateParams as string[]) : [],
      });
    }
    return sendWhatsApp(config.whatsapp, { kind: 'text', to: message.toAddress, body: message.body });
  }

  // ------------------------------------------------------------- one client
  async contactOptions(ctx: CommsContext, clientId: string, loanId?: string | null) {
    const [config, client] = await Promise.all([commsSettingsService.resolve(ctx.organizationId), this.client(ctx, clientId)]);
    const [{ context }, lastInbound] = await Promise.all([
      this.mergeContext(config, client, loanId),
      this.lastWhatsAppInbound(ctx.organizationId, clientId),
    ]);
    const sessionOpen = Boolean(lastInbound && Date.now() - lastInbound.getTime() < WHATSAPP_SESSION_HOURS * 3600_000);
    const addresses = this.addresses(config, client);
    return {
      client: { id: client.id, name: clientName(client), clientNumber: client.clientNumber },
      channels: {
        email: config.emailEnabled,
        sms: config.smsEnabled,
        whatsapp: config.whatsappEnabled,
        clickToChat: config.clickToChatEnabled,
      },
      addresses,
      preferences: {
        emailOptOut: client.communicationPreference?.emailOptOut ?? false,
        smsOptOut: client.communicationPreference?.smsOptOut ?? false,
        whatsappOptOut: client.communicationPreference?.whatsappOptOut ?? false,
      },
      whatsappSession: { open: sessionOpen, lastInboundAt: lastInbound },
      mergeFields: MERGE_FIELDS.map(field => ({ ...field, value: context[field.key] ?? null })),
    };
  }

  async preview(ctx: CommsContext, clientId: string, content: MessageContent & { loanId?: string | null }) {
    const [config, client] = await Promise.all([commsSettingsService.resolve(ctx.organizationId), this.client(ctx, clientId)]);
    const { context } = await this.mergeContext(config, client, content.loanId);
    const rendered = this.renderContent(content, context);
    return {
      subject: rendered.subject,
      body: rendered.body,
      templateParams: rendered.params,
      missing: rendered.missing,
      unknown: rendered.unknown,
      sms: content.channel === 'SMS' ? smsSegments(rendered.body) : null,
    };
  }

  async sendToClient(ctx: CommsContext, clientId: string, input: MessageContent & { loanId?: string | null; to?: string | null }) {
    this.validateContent(input);
    const [config, client] = await Promise.all([commsSettingsService.resolve(ctx.organizationId), this.client(ctx, clientId)]);
    this.channelReady(config, input.channel);

    const addresses = this.addresses(config, client)[input.channel];
    const to = input.to ? (input.channel === 'EMAIL' ? normaliseEmail(input.to) : normalisePhone(input.to, config.defaultCountryCode)) : addresses.default;
    if (!to) {
      throw new CommsError(input.channel === 'EMAIL' ? 'This client has no valid email address.' : 'This client has no valid mobile number.', 'NO_ADDRESS');
    }
    // Only an address on the client's record, so a message sent "to" a client
    // cannot quietly go to someone else.
    if (!addresses.all.includes(to)) throw new CommsError('That address is not on this client’s record.', 'ADDRESS_NOT_ON_RECORD');

    if (input.channel === 'WHATSAPP' && !input.templateName) {
      const lastInbound = await this.lastWhatsAppInbound(ctx.organizationId, clientId);
      if (!lastInbound || Date.now() - lastInbound.getTime() >= WHATSAPP_SESSION_HOURS * 3600_000) {
        throw new CommsError(
          'WhatsApp only allows a free-form message within 24 hours of the client writing to you. Use an approved template, or click-to-chat.',
          'WHATSAPP_SESSION_CLOSED',
          409
        );
      }
    }

    const { context } = await this.mergeContext(config, client, input.loanId);
    const rendered = this.renderContent(input, context);
    if (rendered.unknown.length) throw new CommsError(`Unknown placeholder: {{${rendered.unknown[0]}}}.`, 'UNKNOWN_PLACEHOLDER');
    if (rendered.missing.length) {
      throw new CommsError(`This client has no value for {{${rendered.missing.join('}}, {{')}}}. Remove it or fill in the client's details.`, 'MISSING_PLACEHOLDER');
    }

    const message = await prisma.clientMessage.create({
      data: {
        organizationId: ctx.organizationId,
        clientId,
        loanId: input.loanId ?? null,
        channel: input.channel,
        provider: input.channel === 'EMAIL' ? PROVIDERS.SMTP : input.channel === 'SMS' ? PROVIDERS.BULKSMS : PROVIDERS.WHATSAPP_CLOUD,
        toAddress: to,
        fromAddress: input.channel === 'EMAIL' ? config.email?.fromAddress : input.channel === 'SMS' ? config.sms?.senderId : config.whatsapp?.phoneNumberId,
        subject: input.channel === 'EMAIL' ? rendered.subject : null,
        body: input.templateName ? this.templateSummary(input, rendered.params) : rendered.body,
        templateName: input.templateName ?? null,
        templateLanguage: input.templateLanguage ?? null,
        templateParams: input.templateName ? (rendered.params as Prisma.InputJsonValue) : Prisma.DbNull,
        status: 'SENDING',
        attempts: 1,
        lockedAt: new Date(),
        sentById: ctx.userId,
      },
    });
    const outcome = await this.deliver(config, message);
    const now = new Date();
    const updated = await prisma.clientMessage.update({
      where: { id: message.id },
      data: {
        status: outcome.status,
        providerMessageId: outcome.providerMessageId,
        errorCode: outcome.errorCode,
        errorMessage: outcome.errorMessage,
        lockedAt: null,
        sentAt: outcome.ok ? now : null,
        deliveredAt: outcome.status === 'DELIVERED' ? now : null,
        failedAt: outcome.ok ? null : now,
      },
      select: MESSAGE_SELECT,
    });
    // A failed send is still recorded; the caller reads its status.
    return updated;
  }

  /** Open WhatsApp on the staff member's device, and record that it was opened. */
  async clickToChat(ctx: CommsContext, clientId: string, input: { body: string; loanId?: string | null; to?: string | null }) {
    const [config, client] = await Promise.all([commsSettingsService.resolve(ctx.organizationId), this.client(ctx, clientId)]);
    if (!config.clickToChatEnabled) throw new CommsError('Click-to-chat is switched off for this organization.', 'CHANNEL_NOT_ACTIVE', 409);
    if (!input.body?.trim()) throw new CommsError('Write the message first.', 'EMPTY_MESSAGE');

    const addresses = this.addresses(config, client).WHATSAPP;
    const to = input.to ? normalisePhone(input.to, config.defaultCountryCode) : addresses.default;
    if (!to) throw new CommsError('This client has no valid mobile number.', 'NO_ADDRESS');
    if (!addresses.all.includes(to)) throw new CommsError('That number is not on this client’s record.', 'ADDRESS_NOT_ON_RECORD');

    const { context } = await this.mergeContext(config, client, input.loanId);
    const rendered = this.renderContent({ channel: 'WHATSAPP', body: input.body }, context);
    if (rendered.unknown.length) throw new CommsError(`Unknown placeholder: {{${rendered.unknown[0]}}}.`, 'UNKNOWN_PLACEHOLDER');
    if (rendered.missing.length) throw new CommsError(`This client has no value for {{${rendered.missing.join('}}, {{')}}}.`, 'MISSING_PLACEHOLDER');

    const message = await prisma.clientMessage.create({
      data: {
        organizationId: ctx.organizationId,
        clientId,
        loanId: input.loanId ?? null,
        channel: 'WHATSAPP',
        provider: PROVIDERS.CLICK_TO_CHAT,
        toAddress: to,
        body: rendered.body,
        status: 'OPENED',
        attempts: 1,
        sentById: ctx.userId,
        sentAt: new Date(),
      },
      select: MESSAGE_SELECT,
    });
    return { message, url: clickToChatUrl(to, rendered.body) };
  }

  // ---------------------------------------------------------------- history
  async listMessages(
    ctx: CommsContext,
    filters: { clientId?: string; loanId?: string; broadcastId?: string; channel?: string; status?: string; direction?: string; search?: string; page?: number; pageSize?: number }
  ) {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 25));
    const where: Prisma.ClientMessageWhereInput = {
      organizationId: ctx.organizationId,
      ...(filters.clientId && { clientId: filters.clientId }),
      ...(filters.loanId && { loanId: filters.loanId }),
      ...(filters.broadcastId && { broadcastId: filters.broadcastId }),
      ...(filters.channel && { channel: filters.channel }),
      ...(filters.status && { status: filters.status }),
      ...(filters.direction && { direction: filters.direction }),
      ...(filters.search && {
        OR: [
          { toAddress: { contains: filters.search, mode: 'insensitive' } },
          { subject: { contains: filters.search, mode: 'insensitive' } },
          { body: { contains: filters.search, mode: 'insensitive' } },
          { client: { OR: [{ firstName: { contains: filters.search, mode: 'insensitive' } }, { lastName: { contains: filters.search, mode: 'insensitive' } }, { clientNumber: { contains: filters.search, mode: 'insensitive' } }] } },
        ],
      }),
    };
    const [total, messages] = await Promise.all([
      prisma.clientMessage.count({ where }),
      prisma.clientMessage.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, select: MESSAGE_SELECT }),
    ]);
    return { messages, pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }

  // ------------------------------------------------------------ preferences
  async getPreferences(ctx: CommsContext, clientId: string) {
    const client = await this.client(ctx, clientId);
    return {
      emailOptOut: client.communicationPreference?.emailOptOut ?? false,
      smsOptOut: client.communicationPreference?.smsOptOut ?? false,
      whatsappOptOut: client.communicationPreference?.whatsappOptOut ?? false,
      source: client.communicationPreference?.source ?? null,
      updatedAt: client.communicationPreference?.updatedAt ?? null,
    };
  }

  async updatePreferences(ctx: CommsContext, clientId: string, input: { emailOptOut?: boolean; smsOptOut?: boolean; whatsappOptOut?: boolean; note?: string | null }) {
    const client = await this.client(ctx, clientId);
    const before = await this.getPreferences(ctx, clientId);
    const data = {
      ...(input.emailOptOut !== undefined && { emailOptOut: input.emailOptOut }),
      ...(input.smsOptOut !== undefined && { smsOptOut: input.smsOptOut }),
      ...(input.whatsappOptOut !== undefined && { whatsappOptOut: input.whatsappOptOut }),
      note: input.note ?? null,
      source: 'STAFF',
      updatedById: ctx.userId,
    };
    await prisma.clientCommunicationPreference.upsert({
      where: { clientId: client.id },
      create: { organizationId: ctx.organizationId, clientId: client.id, ...data },
      update: data,
    });
    const after = await this.getPreferences(ctx, clientId);
    await createAuditLog({
      action: 'UPDATE',
      resource: 'client_communication_preference',
      resourceId: client.id,
      userId: ctx.userId,
      organizationId: ctx.organizationId,
      previousValue: before,
      newValue: after,
    }).catch(() => undefined);
    return after;
  }

  // ------------------------------------------------------------ broadcasts
  private async audienceClients(ctx: CommsContext, audience: Audience): Promise<ClientRecord[]> {
    let where: Prisma.ClientWhereInput = { organizationId: ctx.organizationId };
    if (audience.type === 'CLIENTS') {
      const ids = [...new Set(audience.clientIds)];
      if (ids.length === 0) throw new CommsError('Choose at least one client.', 'NO_RECIPIENTS');
      where = { ...where, id: { in: ids } };
    } else {
      if (audience.branchId) where.branchId = audience.branchId;
      if ((audience.clientStatus ?? 'ACTIVE') === 'ACTIVE') where.isActive = true;
      if (audience.loanStatus === 'ACTIVE') where.loans = { some: { status: { in: ['ACTIVE', 'OVERDUE'] } } };
      if (audience.loanStatus === 'OVERDUE') where.loans = { some: { status: 'OVERDUE' } };
      if (audience.loanStatus === 'NO_ACTIVE_LOAN') where.loans = { none: { status: { in: ['ACTIVE', 'OVERDUE'] } } };
    }
    const clients = await prisma.client.findMany({ where, select: CLIENT_SELECT, orderBy: { createdAt: 'asc' }, take: MAX_BROADCAST_RECIPIENTS + 1 });
    if (clients.length > MAX_BROADCAST_RECIPIENTS) {
      throw new CommsError(`A broadcast can reach at most ${MAX_BROADCAST_RECIPIENTS} clients. Narrow the audience.`, 'TOO_MANY_RECIPIENTS');
    }
    return clients;
  }

  /**
   * Work out, for every client in the audience, whether they get the message
   * and exactly what it says - or why they are skipped.
   */
  private async planBroadcast(ctx: CommsContext, config: ResolvedCommsConfig, input: MessageContent & { audience: Audience }) {
    const clients = await this.audienceClients(ctx, input.audience);
    const seen = new Set<string>();
    const plan: Array<{ client: ClientRecord; to: string | null; skip: SkipReason | 'MISSING_FIELDS' | null; rendered: ReturnType<CommsService['renderContent']> | null; missing: string[] }> = [];

    for (const client of clients) {
      const to = resolveAddress(input.channel, client, config.defaultCountryCode);
      if (!to) {
        plan.push({ client, to: null, skip: 'NO_ADDRESS', rendered: null, missing: [] });
        continue;
      }
      if (isOptedOut(input.channel, client.communicationPreference)) {
        plan.push({ client, to, skip: 'OPTED_OUT', rendered: null, missing: [] });
        continue;
      }
      if (seen.has(to)) {
        plan.push({ client, to, skip: 'DUPLICATE_ADDRESS', rendered: null, missing: [] });
        continue;
      }
      seen.add(to);
      const { context } = await this.mergeContext(config, client);
      const rendered = this.renderContent(input, context);
      if (rendered.missing.length) {
        plan.push({ client, to, skip: 'MISSING_FIELDS', rendered, missing: rendered.missing });
        continue;
      }
      plan.push({ client, to, skip: null, rendered, missing: [] });
    }
    return plan;
  }

  private validateBroadcast(config: ResolvedCommsConfig, input: MessageContent) {
    this.validateContent(input);
    this.channelReady(config, input.channel);
    if (input.channel === 'WHATSAPP' && !input.templateName) {
      throw new CommsError('WhatsApp broadcasts must use an approved template - clients have not written to you in the last 24 hours.', 'TEMPLATE_REQUIRED');
    }
    const unknown = renderTemplate(`${input.subject ?? ''} ${input.body ?? ''} ${(input.templateParams ?? []).join(' ')}`, {}).unknown;
    if (unknown.length) throw new CommsError(`Unknown placeholder: {{${unknown[0]}}}.`, 'UNKNOWN_PLACEHOLDER');
  }

  async previewBroadcast(ctx: CommsContext, input: MessageContent & { audience: Audience }) {
    const config = await commsSettingsService.resolve(ctx.organizationId);
    this.validateBroadcast(config, input);
    const plan = await this.planBroadcast(ctx, config, input);
    const skipped: Record<string, number> = {};
    for (const entry of plan) if (entry.skip) skipped[entry.skip] = (skipped[entry.skip] ?? 0) + 1;
    const sendable = plan.filter(entry => !entry.skip);
    return {
      total: plan.length,
      sendable: sendable.length,
      skipped,
      samples: sendable.slice(0, 3).map(entry => ({
        client: { id: entry.client.id, name: clientName(entry.client), clientNumber: entry.client.clientNumber },
        to: entry.to,
        subject: entry.rendered?.subject ?? null,
        body: entry.rendered?.body ?? '',
        templateParams: entry.rendered?.params ?? [],
        sms: input.channel === 'SMS' && entry.rendered ? smsSegments(entry.rendered.body) : null,
      })),
      recipients: plan.slice(0, 200).map(entry => ({
        clientId: entry.client.id,
        name: clientName(entry.client),
        clientNumber: entry.client.clientNumber,
        to: entry.to,
        skip: entry.skip,
        missing: entry.missing,
      })),
    };
  }

  async createBroadcast(ctx: CommsContext, input: MessageContent & { audience: Audience; name?: string | null }) {
    const config = await commsSettingsService.resolve(ctx.organizationId);
    this.validateBroadcast(config, input);
    const plan = await this.planBroadcast(ctx, config, input);
    const sendable = plan.filter(entry => !entry.skip);
    if (sendable.length === 0) throw new CommsError('None of the chosen clients can receive this message.', 'NO_RECIPIENTS');

    const provider = input.channel === 'EMAIL' ? PROVIDERS.SMTP : input.channel === 'SMS' ? PROVIDERS.BULKSMS : PROVIDERS.WHATSAPP_CLOUD;
    const name = input.name?.trim() || input.subject?.trim() || `${input.channel} broadcast ${new Date().toLocaleDateString('en-GB')}`;

    const broadcast = await prisma.messageBroadcast.create({
      data: {
        organizationId: ctx.organizationId,
        name: name.slice(0, 150),
        channel: input.channel,
        subject: input.subject ?? null,
        body: input.body ?? '',
        templateName: input.templateName ?? null,
        templateLanguage: input.templateLanguage ?? null,
        templateParams: input.templateParams ? (input.templateParams as Prisma.InputJsonValue) : Prisma.DbNull,
        audience: input.audience as unknown as Prisma.InputJsonValue,
        totalRecipients: plan.length,
        skippedCount: plan.length - sendable.length,
        createdById: ctx.userId,
      },
    });

    const rows: Prisma.ClientMessageCreateManyInput[] = plan
      .filter(entry => entry.to)
      .map(entry => ({
        organizationId: ctx.organizationId,
        clientId: entry.client.id,
        broadcastId: broadcast.id,
        channel: input.channel,
        provider,
        toAddress: entry.to!,
        subject: input.channel === 'EMAIL' ? entry.rendered?.subject ?? input.subject ?? null : null,
        body: entry.rendered
          ? input.templateName
            ? this.templateSummary(input, entry.rendered.params)
            : entry.rendered.body
          : input.body ?? '',
        templateName: input.templateName ?? null,
        templateLanguage: input.templateLanguage ?? null,
        templateParams: input.templateName && entry.rendered ? (entry.rendered.params as Prisma.InputJsonValue) : Prisma.DbNull,
        status: entry.skip ? 'SKIPPED' : 'QUEUED',
        errorCode: entry.skip,
        errorMessage: entry.skip === 'MISSING_FIELDS' ? `No value for {{${entry.missing.join('}}, {{')}}}` : entry.skip ? null : null,
        sentById: ctx.userId,
      }));
    for (let i = 0; i < rows.length; i += 500) {
      await prisma.clientMessage.createMany({ data: rows.slice(i, i + 500) });
    }

    await createAuditLog({
      action: 'CREATE',
      resource: 'message_broadcast',
      resourceId: broadcast.id,
      userId: ctx.userId,
      organizationId: ctx.organizationId,
      newValue: { name: broadcast.name, channel: input.channel, audience: input.audience, recipients: sendable.length, skipped: plan.length - sendable.length },
    }).catch(() => undefined);

    // Imported lazily: the dispatcher imports this service.
    const { commsDispatcher } = await import('./comms.dispatcher');
    commsDispatcher.kick();
    return this.getBroadcast(ctx, broadcast.id);
  }

  async listBroadcasts(ctx: CommsContext, page = 1, pageSize = 20) {
    const [total, broadcasts] = await Promise.all([
      prisma.messageBroadcast.count({ where: { organizationId: ctx.organizationId } }),
      prisma.messageBroadcast.findMany({
        where: { organizationId: ctx.organizationId },
        orderBy: { createdAt: 'desc' },
        skip: (Math.max(1, page) - 1) * pageSize,
        take: pageSize,
        include: { createdBy: { select: { id: true, firstName: true, lastName: true } } },
      }),
    ]);
    const counts = await this.statusCounts(broadcasts.map(broadcast => broadcast.id));
    return {
      broadcasts: broadcasts.map(broadcast => ({ ...broadcast, counts: counts.get(broadcast.id) ?? {} })),
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  private async statusCounts(ids: string[]) {
    const map = new Map<string, Record<string, number>>();
    if (!ids.length) return map;
    const groups = await prisma.clientMessage.groupBy({ by: ['broadcastId', 'status'], where: { broadcastId: { in: ids } }, _count: { _all: true } });
    for (const group of groups) {
      if (!group.broadcastId) continue;
      const entry = map.get(group.broadcastId) ?? {};
      entry[group.status] = group._count._all;
      map.set(group.broadcastId, entry);
    }
    return map;
  }

  async getBroadcast(ctx: CommsContext, id: string) {
    const broadcast = await prisma.messageBroadcast.findFirst({
      where: { id, organizationId: ctx.organizationId },
      include: { createdBy: { select: { id: true, firstName: true, lastName: true } } },
    });
    if (!broadcast) throw new CommsError('Broadcast not found.', 'NOT_FOUND', 404);
    const counts = await this.statusCounts([broadcast.id]);
    return { ...broadcast, counts: counts.get(broadcast.id) ?? {} };
  }

  async cancelBroadcast(ctx: CommsContext, id: string) {
    const broadcast = await this.getBroadcast(ctx, id);
    if (['COMPLETED', 'CANCELLED'].includes(broadcast.status)) throw new CommsError('This broadcast has already finished.', 'BROADCAST_FINISHED', 409);
    const now = new Date();
    await prisma.$transaction([
      prisma.messageBroadcast.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: now } }),
      prisma.clientMessage.updateMany({ where: { broadcastId: id, status: 'QUEUED' }, data: { status: 'CANCELLED', failedAt: now, errorCode: 'CANCELLED', errorMessage: 'The broadcast was cancelled before this was sent.' } }),
    ]);
    await createAuditLog({ action: 'UPDATE', resource: 'message_broadcast', resourceId: id, userId: ctx.userId, organizationId: ctx.organizationId, newValue: { status: 'CANCELLED' } }).catch(() => undefined);
    return this.getBroadcast(ctx, id);
  }

  // ------------------------------------------------------------- templates
  async listTemplates(ctx: CommsContext, channel?: string) {
    return prisma.messageTemplate.findMany({
      where: { organizationId: ctx.organizationId, ...(channel && { channel: { in: [channel, 'ANY'] } }) },
      orderBy: { name: 'asc' },
    });
  }

  async saveTemplate(ctx: CommsContext, input: { id?: string; name: string; channel: string; subject?: string | null; body: string; isActive?: boolean }) {
    const name = input.name.trim();
    if (!name) throw new CommsError('Give the template a name.', 'NAME_REQUIRED');
    if (!input.body.trim()) throw new CommsError('Write the template text.', 'EMPTY_MESSAGE');
    const unknown = renderTemplate(`${input.subject ?? ''} ${input.body}`, {}).unknown;
    if (unknown.length) throw new CommsError(`Unknown placeholder: {{${unknown[0]}}}.`, 'UNKNOWN_PLACEHOLDER');
    const data = { name, channel: input.channel, subject: input.subject?.trim() || null, body: input.body, isActive: input.isActive ?? true };
    try {
      if (input.id) {
        const existing = await prisma.messageTemplate.findFirst({ where: { id: input.id, organizationId: ctx.organizationId } });
        if (!existing) throw new CommsError('Template not found.', 'NOT_FOUND', 404);
        return await prisma.messageTemplate.update({ where: { id: input.id }, data });
      }
      return await prisma.messageTemplate.create({ data: { ...data, organizationId: ctx.organizationId, createdById: ctx.userId } });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new CommsError('A template with that name already exists.', 'DUPLICATE_NAME', 409);
      throw error;
    }
  }

  async deleteTemplate(ctx: CommsContext, id: string) {
    const result = await prisma.messageTemplate.deleteMany({ where: { id, organizationId: ctx.organizationId } });
    if (result.count === 0) throw new CommsError('Template not found.', 'NOT_FOUND', 404);
  }

  async whatsappTemplates(ctx: CommsContext) {
    const config = await commsSettingsService.resolve(ctx.organizationId);
    this.channelReady(config, 'WHATSAPP');
    try {
      return await listWhatsAppTemplates(config.whatsapp!);
    } catch (error) {
      throw new CommsError((error as Error).message, 'TEMPLATES_UNAVAILABLE', 502);
    }
  }

  // ------------------------------------------------------ inbound & links
  /** A client opting out through the link in a broadcast email. */
  async unsubscribe(token: string) {
    const claims = verifyUnsubscribeToken(token, commsSettingsService.linkSecret());
    if (!claims) throw new CommsError('This unsubscribe link is not valid.', 'INVALID_TOKEN', 400);
    const client = await prisma.client.findFirst({
      where: { id: claims.clientId, organizationId: claims.organizationId },
      select: { id: true, organization: { select: { name: true } } },
    });
    if (!client) throw new CommsError('This unsubscribe link is no longer valid.', 'INVALID_TOKEN', 400);
    const field = claims.channel === 'EMAIL' ? 'emailOptOut' : claims.channel === 'SMS' ? 'smsOptOut' : 'whatsappOptOut';
    await prisma.clientCommunicationPreference.upsert({
      where: { clientId: client.id },
      create: { organizationId: claims.organizationId, clientId: client.id, [field]: true, source: 'UNSUBSCRIBE_LINK' },
      update: { [field]: true, source: 'UNSUBSCRIBE_LINK' },
    });
    return { organizationName: client.organization.name, channel: claims.channel };
  }

  /**
   * Status updates and replies from WhatsApp.
   *
   * Statuses move a message forward only. A reply is filed against the client
   * whose number sent it; "STOP" opts them out; and whoever last messaged the
   * client is told a reply came in, since it opens the 24-hour window.
   */
  async handleWhatsAppWebhook(payload: unknown) {
    const entries = ((payload as { entry?: unknown[] })?.entry ?? []) as Array<{ changes?: Array<{ field?: string; value?: any }> }>;
    for (const entry of entries) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'messages' || !change.value) continue;
        const phoneNumberId = String(change.value.metadata?.phone_number_id ?? '');
        const organizationId = phoneNumberId ? await commsSettingsService.organizationForPhoneNumberId(phoneNumberId) : null;
        if (!organizationId) continue;

        for (const status of change.value.statuses ?? []) {
          const next = mapWhatsAppStatus(status.status);
          if (!next || !status.id) continue;
          const message = await prisma.clientMessage.findFirst({
            where: { organizationId, provider: PROVIDERS.WHATSAPP_CLOUD, providerMessageId: String(status.id) },
            select: { id: true, status: true },
          });
          if (!message || !isStatusAdvance(message.status, next)) continue;
          const at = status.timestamp ? new Date(Number(status.timestamp) * 1000) : new Date();
          const error = status.errors?.[0];
          await prisma.clientMessage.update({
            where: { id: message.id },
            data: {
              status: next,
              ...(next === 'DELIVERED' && { deliveredAt: at }),
              ...(next === 'READ' && { readAt: at }),
              ...(next === 'FAILED' && {
                failedAt: at,
                errorCode: error?.code ? `WHATSAPP_${error.code}` : 'WHATSAPP_FAILED',
                errorMessage: error?.error_data?.details || error?.message || error?.title || 'WhatsApp could not deliver the message.',
              }),
            },
          });
        }

        for (const inbound of change.value.messages ?? []) {
          const from = normalisePhone(`+${String(inbound.from ?? '')}`, null);
          if (!from || !inbound.id) continue;
          const duplicate = await prisma.clientMessage.findFirst({ where: { organizationId, provider: PROVIDERS.WHATSAPP_CLOUD, providerMessageId: String(inbound.id) }, select: { id: true } });
          if (duplicate) continue;

          const client = await this.findClientByPhone(organizationId, from);
          const text =
            inbound.type === 'text'
              ? String(inbound.text?.body ?? '')
              : inbound.type === 'button'
                ? String(inbound.button?.text ?? '')
                : `[${inbound.type ?? 'message'}]`;
          await prisma.clientMessage.create({
            data: {
              organizationId,
              clientId: client?.id ?? null,
              channel: 'WHATSAPP',
              provider: PROVIDERS.WHATSAPP_CLOUD,
              direction: 'INBOUND',
              toAddress: phoneNumberId,
              fromAddress: from,
              body: text || '[empty message]',
              status: 'RECEIVED',
              providerMessageId: String(inbound.id),
              sentAt: inbound.timestamp ? new Date(Number(inbound.timestamp) * 1000) : new Date(),
            },
          });

          if (client && isOptOutKeyword(text)) {
            await prisma.clientCommunicationPreference.upsert({
              where: { clientId: client.id },
              create: { organizationId, clientId: client.id, whatsappOptOut: true, source: 'WHATSAPP_STOP' },
              update: { whatsappOptOut: true, source: 'WHATSAPP_STOP' },
            });
          }
          if (client) await this.notifyReply(organizationId, client, text);

          // The assistant answers clients where the organization has turned
          // that on. It is deliberately not awaited: WhatsApp retries a
          // webhook that takes too long, and a reply is not worth a duplicate
          // inbound message.
          if (client && !isOptOutKeyword(text)) {
            void onClientWhatsAppMessage({
              organizationId,
              clientId: client.id,
              text,
              phone: from,
              clientName: clientName(client),
            }).catch(error =>
              console.error('Assistant WhatsApp reply failed:', (error as Error).message)
            );
          }
        }
      }
    }
  }

  private async findClientByPhone(organizationId: string, e164: string) {
    const digits = e164.slice(1);
    const variants = [e164, digits];
    const clients = await prisma.client.findMany({
      where: {
        organizationId,
        OR: [
          { phone: { in: variants } },
          { contacts: { some: { contactValue: { in: variants } } } },
          { phone: { endsWith: digits.slice(-9) } },
          { contacts: { some: { contactValue: { endsWith: digits.slice(-9) } } } },
        ],
      },
      select: { id: true, firstName: true, lastName: true, businessName: true, phone: true, contacts: { select: { contactValue: true } } },
      take: 10,
    });
    const settings = await commsSettingsService.resolve(organizationId);
    // The loose "ends with" match only finds candidates; a client counts only
    // if one of their numbers normalises to exactly this one.
    return (
      clients.find(client =>
        [client.phone, ...client.contacts.map(contact => contact.contactValue)].some(value => normalisePhone(value, settings.defaultCountryCode) === e164)
      ) ?? null
    );
  }

  private async notifyReply(organizationId: string, client: { id: string; firstName: string | null; lastName: string | null; businessName: string | null }, text: string) {
    const lastOutbound = await prisma.clientMessage.findFirst({
      where: { organizationId, clientId: client.id, direction: 'OUTBOUND', sentById: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { sentById: true },
    });
    if (!lastOutbound?.sentById) return;
    await inAppNotificationService
      .notify({
        organizationId,
        recipientId: lastOutbound.sentById,
        type: NOTIFICATION_TYPES.CLIENT_MESSAGE_RECEIVED,
        title: `${clientName(client)} replied on WhatsApp`,
        body: text.slice(0, 140),
        link: `/clients/${client.id}?tab=messages`,
        resource: 'client',
        resourceId: client.id,
      })
      .catch(() => undefined);
  }
}

export const commsService = new CommsService();

/**
 * An organization's communication channels: its mail server, its BulkSMS
 * account and its WhatsApp Business number.
 *
 * Every organization uses its own accounts, so messages come from its own
 * name and are paid for by it. Credentials are write-only: once saved, only
 * whether one exists (and its last characters) is ever returned.
 */

import crypto from 'crypto';
import { prisma } from '../../config/database';
import { settingsService } from '../settings.service';
import { encryptionService } from '../security/encryption.service';
import { createAuditLog } from '../audit.service';
import { CommsError, DEFAULT_WHATSAPP_API_VERSION, normaliseEmail, normalisePhone, type Channel } from './comms.logic';
import {
  checkBulkSms,
  checkWhatsApp,
  sendEmail,
  sendSms,
  verifySmtp,
  type BulkSmsConfig,
  type SmtpConfig,
  type WhatsAppConfig,
} from './comms.providers';

export const COMMS_KEYS = {
  DEFAULT_COUNTRY_CODE: 'comms_default_country_code',
  EMAIL_ENABLED: 'comms_email_enabled',
  SMTP_HOST: 'comms_smtp_host',
  SMTP_PORT: 'comms_smtp_port',
  SMTP_SECURE: 'comms_smtp_secure',
  SMTP_USERNAME: 'comms_smtp_username',
  SMTP_PASSWORD: 'comms_smtp_password',
  EMAIL_FROM_NAME: 'comms_email_from_name',
  EMAIL_FROM_ADDRESS: 'comms_email_from_address',
  EMAIL_REPLY_TO: 'comms_email_reply_to',
  SMS_ENABLED: 'comms_sms_enabled',
  BULKSMS_TOKEN_ID: 'comms_bulksms_token_id',
  BULKSMS_TOKEN_SECRET: 'comms_bulksms_token_secret',
  SMS_SENDER_ID: 'comms_sms_sender_id',
  SMS_ROUTING_GROUP: 'comms_sms_routing_group',
  WHATSAPP_ENABLED: 'comms_whatsapp_enabled',
  WHATSAPP_PHONE_NUMBER_ID: 'comms_whatsapp_phone_number_id',
  WHATSAPP_BUSINESS_ACCOUNT_ID: 'comms_whatsapp_business_account_id',
  WHATSAPP_ACCESS_TOKEN: 'comms_whatsapp_access_token',
  WHATSAPP_APP_SECRET: 'comms_whatsapp_app_secret',
  WHATSAPP_VERIFY_TOKEN: 'comms_whatsapp_webhook_verify_token',
  WHATSAPP_API_VERSION: 'comms_whatsapp_api_version',
  CLICK_TO_CHAT_ENABLED: 'comms_whatsapp_click_to_chat_enabled',
} as const;

const SECRET_KEYS = new Set<string>([
  COMMS_KEYS.SMTP_PASSWORD,
  COMMS_KEYS.BULKSMS_TOKEN_SECRET,
  COMMS_KEYS.WHATSAPP_ACCESS_TOKEN,
  COMMS_KEYS.WHATSAPP_APP_SECRET,
]);

const asBoolean = (value: unknown, fallback = false) =>
  value === undefined || value === null ? fallback : value === true || value === 'true' || value === 1 || value === '1';
const asText = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);

const hint = (value: string | null) => (value ? (value.length <= 8 ? '****' : `****${value.slice(-4)}`) : null);

export interface ResolvedCommsConfig {
  organizationId: string;
  organizationName: string;
  organizationContact: string | null;
  organizationPhone: string | null;
  organizationEmail: string | null;
  defaultCountryCode: string;
  email: (SmtpConfig & { source: 'organization' | 'environment' }) | null;
  emailEnabled: boolean;
  sms: BulkSmsConfig | null;
  smsEnabled: boolean;
  whatsapp: (WhatsAppConfig & { appSecret: string | null; verifyToken: string | null }) | null;
  whatsappEnabled: boolean;
  clickToChatEnabled: boolean;
}

export interface UpdateCommsSettingsInput {
  defaultCountryCode?: string;
  email?: {
    enabled?: boolean;
    host?: string | null;
    port?: number | null;
    secure?: boolean;
    username?: string | null;
    password?: string | null;
    fromName?: string | null;
    fromAddress?: string | null;
    replyTo?: string | null;
  };
  sms?: {
    enabled?: boolean;
    tokenId?: string | null;
    tokenSecret?: string | null;
    senderId?: string | null;
    routingGroup?: 'ECONOMY' | 'STANDARD' | 'PREMIUM';
  };
  whatsapp?: {
    enabled?: boolean;
    phoneNumberId?: string | null;
    businessAccountId?: string | null;
    accessToken?: string | null;
    appSecret?: string | null;
    apiVersion?: string | null;
    clickToChatEnabled?: boolean;
  };
}

export class CommsSettingsService {
  private publicBaseUrl(): string {
    return (process.env.API_PUBLIC_URL || `http://localhost:${process.env.PORT || 8000}`).replace(/\/+$/, '');
  }

  webhookUrl(): string {
    return `${this.publicBaseUrl()}/api/v1/public/communications/whatsapp/webhook`;
  }

  unsubscribeUrl(token: string): string {
    return `${this.publicBaseUrl()}/api/v1/public/communications/unsubscribe?token=${encodeURIComponent(token)}`;
  }

  /** The key unsubscribe links are signed with. */
  linkSecret(): string {
    const secret = process.env.COMMS_LINK_SECRET || process.env.JWT_SECRET;
    if (!secret) throw new CommsError('COMMS_LINK_SECRET is not configured on the server.', 'LINK_SECRET_MISSING', 500);
    return secret;
  }

  private async readSettings(organizationId: string): Promise<Map<string, unknown>> {
    const rows = await prisma.organizationSettings.findMany({
      where: { organizationId, settingKey: { in: Object.values(COMMS_KEYS) } },
      select: { settingKey: true, settingValue: true },
    });
    return new Map(
      rows.map(row => {
        if (SECRET_KEYS.has(row.settingKey) && typeof row.settingValue === 'string') {
          try {
            const decrypted = encryptionService.decrypt(row.settingValue);
            return [row.settingKey, encryptionService.isEncrypted(decrypted) ? null : decrypted];
          } catch {
            return [row.settingKey, null];
          }
        }
        return [row.settingKey, row.settingValue];
      })
    );
  }

  async resolve(organizationId: string): Promise<ResolvedCommsConfig> {
    const [values, organization] = await Promise.all([
      this.readSettings(organizationId),
      prisma.organization.findUnique({
        where: { id: organizationId },
        select: { name: true, phone: true, email: true, website: true },
      }),
    ]);
    if (!organization) throw new CommsError('Organization not found.', 'NOT_FOUND', 404);
    const get = (key: string) => values.get(key);

    const orgHost = asText(get(COMMS_KEYS.SMTP_HOST));
    const fromAddress = normaliseEmail(get(COMMS_KEYS.EMAIL_FROM_ADDRESS));
    let email: ResolvedCommsConfig['email'] = null;
    if (orgHost && fromAddress) {
      const port = Number(get(COMMS_KEYS.SMTP_PORT) ?? 587) || 587;
      email = {
        source: 'organization',
        host: orgHost,
        port,
        secure: asBoolean(get(COMMS_KEYS.SMTP_SECURE), port === 465),
        username: asText(get(COMMS_KEYS.SMTP_USERNAME)),
        password: (get(COMMS_KEYS.SMTP_PASSWORD) as string | null) ?? null,
        fromName: asText(get(COMMS_KEYS.EMAIL_FROM_NAME)) ?? organization.name,
        fromAddress,
        replyTo: normaliseEmail(get(COMMS_KEYS.EMAIL_REPLY_TO)),
      };
    } else if (process.env.SMTP_HOST && normaliseEmail(process.env.SMTP_FROM)) {
      // The platform's own mail server, sending in the organization's name.
      const port = Number(process.env.SMTP_PORT || 587);
      email = {
        source: 'environment',
        host: process.env.SMTP_HOST,
        port,
        secure: port === 465,
        username: process.env.SMTP_USER || null,
        password: process.env.SMTP_PASS || null,
        fromName: organization.name,
        fromAddress: normaliseEmail(process.env.SMTP_FROM)!,
        replyTo: normaliseEmail(organization.email),
      };
    }

    const tokenId = asText(get(COMMS_KEYS.BULKSMS_TOKEN_ID));
    const tokenSecret = (get(COMMS_KEYS.BULKSMS_TOKEN_SECRET) as string | null) ?? null;
    const routing = String(get(COMMS_KEYS.SMS_ROUTING_GROUP) ?? 'STANDARD');
    const sms: BulkSmsConfig | null =
      tokenId && tokenSecret
        ? {
            tokenId,
            tokenSecret,
            senderId: asText(get(COMMS_KEYS.SMS_SENDER_ID)),
            routingGroup: (['ECONOMY', 'STANDARD', 'PREMIUM'].includes(routing) ? routing : 'STANDARD') as BulkSmsConfig['routingGroup'],
          }
        : null;

    const phoneNumberId = asText(get(COMMS_KEYS.WHATSAPP_PHONE_NUMBER_ID));
    const accessToken = (get(COMMS_KEYS.WHATSAPP_ACCESS_TOKEN) as string | null) ?? null;
    const whatsapp: ResolvedCommsConfig['whatsapp'] =
      phoneNumberId && accessToken
        ? {
            phoneNumberId,
            businessAccountId: asText(get(COMMS_KEYS.WHATSAPP_BUSINESS_ACCOUNT_ID)),
            accessToken,
            apiVersion: asText(get(COMMS_KEYS.WHATSAPP_API_VERSION)) ?? DEFAULT_WHATSAPP_API_VERSION,
            appSecret: (get(COMMS_KEYS.WHATSAPP_APP_SECRET) as string | null) ?? null,
            verifyToken: asText(get(COMMS_KEYS.WHATSAPP_VERIFY_TOKEN)),
          }
        : null;

    const contactParts = [organization.phone, organization.email, organization.website].filter(Boolean);

    return {
      organizationId,
      organizationName: organization.name,
      organizationContact: contactParts.length ? contactParts.join(' · ') : null,
      organizationPhone: organization.phone,
      organizationEmail: organization.email,
      defaultCountryCode: String(get(COMMS_KEYS.DEFAULT_COUNTRY_CODE) ?? '27').replace(/\D/g, '') || '27',
      email,
      emailEnabled: asBoolean(get(COMMS_KEYS.EMAIL_ENABLED)) && Boolean(email),
      sms,
      smsEnabled: asBoolean(get(COMMS_KEYS.SMS_ENABLED)) && Boolean(sms),
      whatsapp,
      whatsappEnabled: asBoolean(get(COMMS_KEYS.WHATSAPP_ENABLED)) && Boolean(whatsapp),
      clickToChatEnabled: asBoolean(get(COMMS_KEYS.CLICK_TO_CHAT_ENABLED), true),
    };
  }

  /** Which ways of reaching a client this organization can use. For every signed-in user. */
  async status(organizationId: string) {
    const config = await this.resolve(organizationId);
    return {
      email: config.emailEnabled,
      sms: config.smsEnabled,
      whatsapp: config.whatsappEnabled,
      clickToChat: config.clickToChatEnabled,
      defaultCountryCode: config.defaultCountryCode,
    };
  }

  /** What the settings screen may know: never a secret, only that one exists. */
  async publicSettings(organizationId: string) {
    const [values, config] = await Promise.all([this.readSettings(organizationId), this.resolve(organizationId)]);
    const get = (key: string) => values.get(key);
    return {
      defaultCountryCode: config.defaultCountryCode,
      encryptedAtRest: encryptionService.isEnabled(),
      email: {
        enabled: asBoolean(get(COMMS_KEYS.EMAIL_ENABLED)),
        active: config.emailEnabled,
        source: config.email?.source ?? null,
        platformAvailable: Boolean(process.env.SMTP_HOST && normaliseEmail(process.env.SMTP_FROM)),
        host: asText(get(COMMS_KEYS.SMTP_HOST)),
        port: Number(get(COMMS_KEYS.SMTP_PORT) ?? 587) || 587,
        secure: asBoolean(get(COMMS_KEYS.SMTP_SECURE)),
        username: asText(get(COMMS_KEYS.SMTP_USERNAME)),
        hasPassword: Boolean(get(COMMS_KEYS.SMTP_PASSWORD)),
        fromName: asText(get(COMMS_KEYS.EMAIL_FROM_NAME)),
        fromAddress: asText(get(COMMS_KEYS.EMAIL_FROM_ADDRESS)),
        replyTo: asText(get(COMMS_KEYS.EMAIL_REPLY_TO)),
      },
      sms: {
        enabled: asBoolean(get(COMMS_KEYS.SMS_ENABLED)),
        active: config.smsEnabled,
        provider: 'BulkSMS',
        tokenId: asText(get(COMMS_KEYS.BULKSMS_TOKEN_ID)),
        hasTokenSecret: Boolean(get(COMMS_KEYS.BULKSMS_TOKEN_SECRET)),
        tokenSecretHint: hint((get(COMMS_KEYS.BULKSMS_TOKEN_SECRET) as string | null) ?? null),
        senderId: asText(get(COMMS_KEYS.SMS_SENDER_ID)),
        routingGroup: config.sms?.routingGroup ?? String(get(COMMS_KEYS.SMS_ROUTING_GROUP) ?? 'STANDARD'),
      },
      whatsapp: {
        enabled: asBoolean(get(COMMS_KEYS.WHATSAPP_ENABLED)),
        active: config.whatsappEnabled,
        phoneNumberId: asText(get(COMMS_KEYS.WHATSAPP_PHONE_NUMBER_ID)),
        businessAccountId: asText(get(COMMS_KEYS.WHATSAPP_BUSINESS_ACCOUNT_ID)),
        hasAccessToken: Boolean(get(COMMS_KEYS.WHATSAPP_ACCESS_TOKEN)),
        accessTokenHint: hint((get(COMMS_KEYS.WHATSAPP_ACCESS_TOKEN) as string | null) ?? null),
        hasAppSecret: Boolean(get(COMMS_KEYS.WHATSAPP_APP_SECRET)),
        apiVersion: asText(get(COMMS_KEYS.WHATSAPP_API_VERSION)) ?? DEFAULT_WHATSAPP_API_VERSION,
        // Not a credential for this system: it only answers Meta's handshake,
        // and the administrator has to paste it into Meta.
        webhookVerifyToken: asText(get(COMMS_KEYS.WHATSAPP_VERIFY_TOKEN)),
        webhookUrl: this.webhookUrl(),
        clickToChatEnabled: config.clickToChatEnabled,
      },
    };
  }

  async update(organizationId: string, userId: string, input: UpdateCommsSettingsInput) {
    const writes: Array<[string, unknown]> = [];
    const removals: string[] = [];
    const set = (key: string, value: unknown) => {
      if (value === undefined) return;
      if (value === null || value === '') removals.push(key);
      else writes.push([key, SECRET_KEYS.has(key) ? encryptionService.encrypt(String(value), { organizationId }) : value]);
    };

    if (input.defaultCountryCode !== undefined) {
      const digits = String(input.defaultCountryCode).replace(/\D/g, '');
      if (digits.length < 1 || digits.length > 4) throw new CommsError('The default country code must be 1 to 4 digits, like 27 or 263.', 'INVALID_COUNTRY_CODE');
      set(COMMS_KEYS.DEFAULT_COUNTRY_CODE, digits);
    }

    const email = input.email;
    if (email) {
      if (email.fromAddress && !normaliseEmail(email.fromAddress)) throw new CommsError('The From address is not a valid email address.', 'INVALID_EMAIL');
      if (email.replyTo && !normaliseEmail(email.replyTo)) throw new CommsError('The Reply-To address is not a valid email address.', 'INVALID_EMAIL');
      if (email.port !== undefined && email.port !== null && (email.port < 1 || email.port > 65535)) throw new CommsError('The SMTP port must be between 1 and 65535.', 'INVALID_PORT');
      set(COMMS_KEYS.EMAIL_ENABLED, email.enabled);
      set(COMMS_KEYS.SMTP_HOST, email.host);
      set(COMMS_KEYS.SMTP_PORT, email.port);
      set(COMMS_KEYS.SMTP_SECURE, email.secure);
      set(COMMS_KEYS.SMTP_USERNAME, email.username);
      set(COMMS_KEYS.SMTP_PASSWORD, email.password);
      set(COMMS_KEYS.EMAIL_FROM_NAME, email.fromName);
      set(COMMS_KEYS.EMAIL_FROM_ADDRESS, email.fromAddress ? normaliseEmail(email.fromAddress) : email.fromAddress);
      set(COMMS_KEYS.EMAIL_REPLY_TO, email.replyTo ? normaliseEmail(email.replyTo) : email.replyTo);
    }

    const sms = input.sms;
    if (sms) {
      if (sms.senderId && !/^(\+?\d{7,15}|[A-Za-z0-9 ]{1,11})$/.test(sms.senderId.trim())) {
        throw new CommsError('A sender ID is up to 11 letters and numbers, or a phone number.', 'INVALID_SENDER_ID');
      }
      set(COMMS_KEYS.SMS_ENABLED, sms.enabled);
      set(COMMS_KEYS.BULKSMS_TOKEN_ID, sms.tokenId);
      set(COMMS_KEYS.BULKSMS_TOKEN_SECRET, sms.tokenSecret);
      set(COMMS_KEYS.SMS_SENDER_ID, sms.senderId?.trim());
      set(COMMS_KEYS.SMS_ROUTING_GROUP, sms.routingGroup);
    }

    const whatsapp = input.whatsapp;
    if (whatsapp) {
      if (whatsapp.apiVersion && !/^v\d{2}\.\d$/.test(whatsapp.apiVersion)) throw new CommsError('The API version looks like v23.0.', 'INVALID_API_VERSION');
      if (whatsapp.phoneNumberId && !/^\d{5,25}$/.test(whatsapp.phoneNumberId)) throw new CommsError('The phone number ID is the long number Meta shows, not the phone number.', 'INVALID_PHONE_NUMBER_ID');
      set(COMMS_KEYS.WHATSAPP_ENABLED, whatsapp.enabled);
      set(COMMS_KEYS.WHATSAPP_PHONE_NUMBER_ID, whatsapp.phoneNumberId);
      set(COMMS_KEYS.WHATSAPP_BUSINESS_ACCOUNT_ID, whatsapp.businessAccountId);
      set(COMMS_KEYS.WHATSAPP_ACCESS_TOKEN, whatsapp.accessToken);
      set(COMMS_KEYS.WHATSAPP_APP_SECRET, whatsapp.appSecret);
      set(COMMS_KEYS.WHATSAPP_API_VERSION, whatsapp.apiVersion);
      set(COMMS_KEYS.CLICK_TO_CHAT_ENABLED, whatsapp.clickToChatEnabled);
    }

    for (const [key, value] of writes) {
      await settingsService.set(organizationId, { settingKey: key, settingValue: value, updatedBy: userId });
    }
    if (removals.length) {
      await prisma.organizationSettings.deleteMany({ where: { organizationId, settingKey: { in: removals } } });
    }

    // Meta's webhook handshake needs a verify token the administrator pastes
    // into Meta; one is made the first time WhatsApp is configured.
    const current = await this.readSettings(organizationId);
    if (current.get(COMMS_KEYS.WHATSAPP_PHONE_NUMBER_ID) && !current.get(COMMS_KEYS.WHATSAPP_VERIFY_TOKEN)) {
      await settingsService.set(organizationId, {
        settingKey: COMMS_KEYS.WHATSAPP_VERIFY_TOKEN,
        settingValue: crypto.randomBytes(18).toString('base64url'),
        updatedBy: userId,
      });
    }

    const resolved = await this.resolve(organizationId);
    const refusals: string[] = [];
    if (input.email?.enabled && !resolved.email) refusals.push('email needs a mail server and From address');
    if (input.sms?.enabled && !resolved.sms) refusals.push('SMS needs a BulkSMS token ID and secret');
    if (input.whatsapp?.enabled && !resolved.whatsapp) refusals.push('WhatsApp needs a phone number ID and access token');

    await createAuditLog({
      action: 'UPDATE',
      resource: 'communication_settings',
      resourceId: organizationId,
      userId,
      organizationId,
      newValue: {
        changed: writes.map(([key]) => key).concat(removals.map(key => `${key} (removed)`)),
        // Which credentials changed, never their values.
        secretsChanged: [...writes.map(([key]) => key), ...removals].filter(key => SECRET_KEYS.has(key)),
      },
    }).catch(() => undefined);

    return { settings: await this.publicSettings(organizationId), warnings: refusals };
  }

  /** Check a channel's credentials, optionally sending a real test message. */
  async test(organizationId: string, channel: Channel, sendTo?: string) {
    const config = await this.resolve(organizationId);
    if (channel === 'EMAIL') {
      if (!config.email) return { ok: false, message: 'Add a mail server and From address first.' };
      const check = await verifySmtp(config.email);
      if (!check.ok || !sendTo) return check;
      const to = normaliseEmail(sendTo);
      if (!to) return { ok: false, message: 'The test address is not a valid email address.' };
      const outcome = await sendEmail(config.email, {
        to,
        subject: `Test email from ${config.organizationName}`,
        text: `This is a test email from ${config.organizationName}. Email is working.`,
        html: `<p>This is a test email from <b>${config.organizationName.replace(/</g, '&lt;')}</b>. Email is working.</p>`,
      });
      return outcome.ok ? { ok: true, message: `${check.message} A test email was sent to ${to}.` } : { ok: false, message: outcome.errorMessage ?? 'The test email failed.' };
    }
    if (channel === 'SMS') {
      if (!config.sms) return { ok: false, message: 'Add the BulkSMS token ID and secret first.' };
      const check = await checkBulkSms(config.sms);
      if (!check.ok || !sendTo) return check;
      const to = normalisePhone(sendTo, config.defaultCountryCode);
      if (!to) return { ok: false, message: 'The test number is not a valid phone number.' };
      const outcome = await sendSms(config.sms, { to, body: `Test SMS from ${config.organizationName}. SMS is working.`, reference: `test${Date.now()}` });
      return outcome.ok ? { ok: true, message: `${check.message} A test SMS was sent to ${to}.` } : { ok: false, message: outcome.errorMessage ?? 'The test SMS failed.' };
    }
    if (!config.whatsapp) return { ok: false, message: 'Add the WhatsApp phone number ID and access token first.' };
    return checkWhatsApp(config.whatsapp);
  }

  /** The organization a WhatsApp webhook event belongs to, by its phone number ID. */
  async organizationForPhoneNumberId(phoneNumberId: string): Promise<string | null> {
    const rows = await prisma.organizationSettings.findMany({
      where: { settingKey: COMMS_KEYS.WHATSAPP_PHONE_NUMBER_ID },
      select: { organizationId: true, settingValue: true },
    });
    return rows.find(row => String(row.settingValue) === phoneNumberId)?.organizationId ?? null;
  }

  /** The verify token that matches, for Meta's GET handshake. */
  async verifyTokenMatches(token: string): Promise<boolean> {
    if (!token) return false;
    const rows = await prisma.organizationSettings.findMany({
      where: { settingKey: COMMS_KEYS.WHATSAPP_VERIFY_TOKEN },
      select: { settingValue: true },
    });
    return rows.some(row => {
      const a = Buffer.from(String(row.settingValue));
      const b = Buffer.from(token);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    });
  }
}

export const commsSettingsService = new CommsSettingsService();

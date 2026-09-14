/**
 * The communications service and dispatcher, with the database, settings and
 * providers mocked.
 */

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const CLIENT = '33333333-3333-4333-8333-333333333333';
const CLIENT_2 = '44444444-4444-4444-8444-444444444444';

const db: any = {
  client: { findFirst: jest.fn(), findMany: jest.fn() },
  loan: { findFirst: jest.fn(async () => null) },
  clientMessage: {
    create: jest.fn(async ({ data }: any) => ({ id: 'msg-1', broadcastId: null, templateParams: null, templateLanguage: null, ...data })),
    update: jest.fn(async ({ data }: any) => ({ id: 'msg-1', ...data })),
    updateMany: jest.fn(async () => ({ count: 0 })),
    findFirst: jest.fn(async () => null),
    findMany: jest.fn(async () => []),
    createMany: jest.fn(async () => ({ count: 0 })),
    count: jest.fn(async () => 0),
    groupBy: jest.fn(async () => []),
  },
  messageBroadcast: {
    create: jest.fn(async ({ data }: any) => ({ id: 'broadcast-1', ...data })),
    findFirst: jest.fn(async () => ({ id: 'broadcast-1', status: 'QUEUED' })),
    update: jest.fn(async () => ({})),
    updateMany: jest.fn(async () => ({ count: 1 })),
  },
  clientCommunicationPreference: { upsert: jest.fn(async () => ({})) },
  $queryRaw: jest.fn(async () => []),
  $transaction: jest.fn(async (ops: unknown[]) => ops),
};

jest.mock('../src/config/database', () => ({
  get prisma() {
    return db;
  },
}));

const config: any = {
  organizationId: ORG,
  organizationName: 'OMS',
  organizationContact: null,
  organizationPhone: '+27110000000',
  organizationEmail: 'info@oms.test',
  defaultCountryCode: '27',
  email: { host: 'smtp.test', port: 587, secure: false, username: 'u', password: 'p', fromName: 'OMS', fromAddress: 'info@oms.test', replyTo: null, source: 'organization' },
  emailEnabled: true,
  sms: { tokenId: 'id', tokenSecret: 'secret', senderId: 'OMS', routingGroup: 'STANDARD' },
  smsEnabled: true,
  whatsapp: { phoneNumberId: '1234567890', businessAccountId: null, accessToken: 'token', apiVersion: 'v23.0', appSecret: 'app', verifyToken: 'verify' },
  whatsappEnabled: true,
  clickToChatEnabled: true,
};

jest.mock('../src/services/communications/comms-settings.service', () => ({
  commsSettingsService: {
    resolve: jest.fn(async () => config),
    linkSecret: () => 'link-secret',
    unsubscribeUrl: (token: string) => `https://api.test/unsubscribe?token=${token}`,
    organizationForPhoneNumberId: jest.fn(async (id: string) => (id === '1234567890' ? ORG : null)),
  },
}));

const providers = {
  sendEmail: jest.fn(async () => ({ ok: true, providerMessageId: 'email-1', status: 'SENT', errorCode: null, errorMessage: null, retryable: false })),
  sendSms: jest.fn(async () => ({ ok: true, providerMessageId: 'sms-1', status: 'SENT', errorCode: null, errorMessage: null, retryable: false })),
  sendWhatsApp: jest.fn(async () => ({ ok: true, providerMessageId: 'wamid.1', status: 'SENT', errorCode: null, errorMessage: null, retryable: false })),
  listWhatsAppTemplates: jest.fn(async () => []),
  getSmsStatus: jest.fn(async () => null),
};
jest.mock('../src/services/communications/comms.providers', () => new Proxy({}, { get: (_t, key: string) => (providers as any)[key] }));

jest.mock('../src/services/audit.service', () => ({ createAuditLog: jest.fn(async () => ({})) }));
const notify = jest.fn(async () => ({}));
jest.mock('../src/services/in-app-notification.service', () => ({
  inAppNotificationService: { notify: (...args: unknown[]) => (notify as any)(...args) },
  NOTIFICATION_TYPES: { CLIENT_MESSAGE_RECEIVED: 'CLIENT_MESSAGE_RECEIVED' },
}));

import { CommsService } from '../src/services/communications/comms.service';
import { CommsError } from '../src/services/communications/comms.logic';

const service = new CommsService();
const ctx = { organizationId: ORG, userId: USER };

const client = (overrides: Record<string, unknown> = {}) => ({
  id: CLIENT,
  organizationId: ORG,
  firstName: 'Rudo',
  lastName: 'Banda',
  businessName: null,
  clientNumber: 'CL-1',
  email: 'rudo@example.com',
  phone: '0831234567',
  isActive: true,
  contacts: [],
  communicationPreference: null,
  ...overrides,
});

const refusal = async (promise: Promise<unknown>) => {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(CommsError);
  return error as CommsError;
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  config.emailEnabled = true;
  config.smsEnabled = true;
  config.whatsappEnabled = true;
  db.client.findFirst.mockResolvedValue(client());
  db.clientMessage.findFirst.mockResolvedValue(null);
});

describe('messaging one client', () => {
  it('sends an SMS to the client’s number and records it as sent', async () => {
    const message = await service.sendToClient(ctx, CLIENT, { channel: 'SMS', body: 'Hi {{firstName}}, thanks for your payment.' });
    expect(providers.sendSms).toHaveBeenCalledWith(config.sms, expect.objectContaining({ to: '+27831234567', body: 'Hi Rudo, thanks for your payment.' }));
    expect(db.clientMessage.create.mock.calls[0][0].data).toMatchObject({ clientId: CLIENT, channel: 'SMS', provider: 'BULKSMS', toAddress: '+27831234567', status: 'SENDING', sentById: USER });
    expect(message.status).toBe('SENT');
  });

  it('records a failed send instead of losing it', async () => {
    providers.sendSms.mockResolvedValueOnce({ ok: false, providerMessageId: null, status: 'FAILED', errorCode: 'BULKSMS_AUTH', errorMessage: 'BulkSMS rejected the API credentials.', retryable: false } as any);
    const message = await service.sendToClient(ctx, CLIENT, { channel: 'SMS', body: 'Hello' });
    expect(message).toMatchObject({ status: 'FAILED', errorCode: 'BULKSMS_AUTH' });
    expect(db.clientMessage.update.mock.calls[0][0].data.failedAt).toBeInstanceOf(Date);
  });

  it('refuses a channel the organization has not set up', async () => {
    config.smsEnabled = false;
    expect((await refusal(service.sendToClient(ctx, CLIENT, { channel: 'SMS', body: 'Hello' }))).code).toBe('CHANNEL_NOT_ACTIVE');
    expect(db.clientMessage.create).not.toHaveBeenCalled();
  });

  it('only sends to an address on the client’s record', async () => {
    const error = await refusal(service.sendToClient(ctx, CLIENT, { channel: 'SMS', body: 'Hello', to: '+27839999999' }));
    expect(error.code).toBe('ADDRESS_NOT_ON_RECORD');
    expect(providers.sendSms).not.toHaveBeenCalled();
  });

  it('needs a subject for email', async () => {
    expect((await refusal(service.sendToClient(ctx, CLIENT, { channel: 'EMAIL', body: 'Hello' }))).code).toBe('SUBJECT_REQUIRED');
  });

  it('will not send "Dear {{loanNumber}}" to a client without a loan', async () => {
    const error = await refusal(service.sendToClient(ctx, CLIENT, { channel: 'SMS', body: 'Your loan {{loanNumber}}' }));
    expect(error.code).toBe('MISSING_PLACEHOLDER');
    expect(providers.sendSms).not.toHaveBeenCalled();
  });

  it('refuses free-form WhatsApp outside the 24-hour window', async () => {
    const error = await refusal(service.sendToClient(ctx, CLIENT, { channel: 'WHATSAPP', body: 'Hello' }));
    expect(error.code).toBe('WHATSAPP_SESSION_CLOSED');
    expect(providers.sendWhatsApp).not.toHaveBeenCalled();
  });

  it('allows free-form WhatsApp when the client wrote recently', async () => {
    db.clientMessage.findFirst.mockResolvedValueOnce({ createdAt: new Date(Date.now() - 3600_000) });
    await service.sendToClient(ctx, CLIENT, { channel: 'WHATSAPP', body: 'Hello' });
    expect(providers.sendWhatsApp).toHaveBeenCalledWith(config.whatsapp, expect.objectContaining({ kind: 'text', to: '+27831234567' }));
  });

  it('sends an approved template at any time, with its parameters filled', async () => {
    await service.sendToClient(ctx, CLIENT, { channel: 'WHATSAPP', templateName: 'payment_reminder', templateLanguage: 'en', templateParams: ['{{firstName}}'] });
    expect(providers.sendWhatsApp).toHaveBeenCalledWith(config.whatsapp, expect.objectContaining({ kind: 'template', templateName: 'payment_reminder', params: ['Rudo'] }));
  });

  it('logs click-to-chat as opened and hands back the link', async () => {
    const result = await service.clickToChat(ctx, CLIENT, { body: 'Hi {{firstName}}' });
    expect(result.url).toBe('https://wa.me/27831234567?text=Hi%20Rudo');
    expect(db.clientMessage.create.mock.calls[0][0].data).toMatchObject({ provider: 'CLICK_TO_CHAT', status: 'OPENED' });
  });
});

describe('broadcasts', () => {
  const recipients = [
    client(),
    client({ id: CLIENT_2, firstName: 'Tendai', email: null, phone: 'unknown', contacts: [] }), // no address
    client({ id: 'c3', firstName: 'Opted', email: 'opted@example.com', communicationPreference: { emailOptOut: true, smsOptOut: false, whatsappOptOut: false } }),
    client({ id: 'c4', firstName: 'Twin', email: 'rudo@example.com' }), // same address as the first
  ];

  it('plans who gets it and why others are skipped', async () => {
    db.client.findMany.mockResolvedValue(recipients);
    const preview = await service.previewBroadcast(ctx, { channel: 'EMAIL', subject: 'News', body: 'Hi {{firstName}}', audience: { type: 'CLIENTS', clientIds: [CLIENT, CLIENT_2, 'c3', 'c4'] } });
    expect(preview).toMatchObject({ total: 4, sendable: 1, skipped: { NO_ADDRESS: 1, OPTED_OUT: 1, DUPLICATE_ADDRESS: 1 } });
    expect(preview.samples[0]).toMatchObject({ to: 'rudo@example.com', body: 'Hi Rudo' });
  });

  it('skips a client whose message would have a gap', async () => {
    db.client.findMany.mockResolvedValue([client()]);
    await expect(service.createBroadcast(ctx, { channel: 'SMS', body: 'Loan {{loanNumber}}', audience: { type: 'CLIENTS', clientIds: [CLIENT] } })).rejects.toMatchObject({ code: 'NO_RECIPIENTS' });
  });

  it('queues one message per recipient and records the skipped ones', async () => {
    db.client.findMany.mockResolvedValue(recipients);
    db.messageBroadcast.findFirst.mockResolvedValue({ id: 'broadcast-1', status: 'QUEUED' });
    await service.createBroadcast(ctx, { channel: 'EMAIL', subject: 'News', body: 'Hi {{firstName}}', audience: { type: 'CLIENTS', clientIds: [CLIENT, CLIENT_2, 'c3', 'c4'] } });
    const rows = db.clientMessage.createMany.mock.calls[0][0].data;
    expect(rows.map((row: any) => row.status)).toEqual(['QUEUED', 'SKIPPED', 'SKIPPED']); // the address-less client has no row
    expect(rows[0]).toMatchObject({ toAddress: 'rudo@example.com', body: 'Hi Rudo', broadcastId: 'broadcast-1' });
    expect(db.messageBroadcast.create.mock.calls[0][0].data).toMatchObject({ totalRecipients: 4, skippedCount: 3 });
  });

  it('must use a template on WhatsApp', async () => {
    const error = await refusal(service.createBroadcast(ctx, { channel: 'WHATSAPP', body: 'Hello all', audience: { type: 'FILTER' } }));
    expect(error.code).toBe('TEMPLATE_REQUIRED');
  });

  it('builds a filter audience from branch and loan status', async () => {
    db.client.findMany.mockResolvedValue([client()]);
    await service.previewBroadcast(ctx, { channel: 'SMS', body: 'Hello', audience: { type: 'FILTER', branchId: 'branch-1', loanStatus: 'OVERDUE' } });
    expect(db.client.findMany.mock.calls[0][0].where).toEqual({ organizationId: ORG, branchId: 'branch-1', isActive: true, loans: { some: { status: 'OVERDUE' } } });
  });
});

describe('what WhatsApp sends back', () => {
  const webhook = (value: Record<string, unknown>) => ({ entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: '1234567890' }, ...value } }] }] });

  it('moves a message forward on a status update', async () => {
    db.clientMessage.findFirst.mockResolvedValueOnce({ id: 'msg-1', status: 'SENT' });
    await service.handleWhatsAppWebhook(webhook({ statuses: [{ id: 'wamid.1', status: 'read', timestamp: '1789000000' }] }));
    expect(db.clientMessage.update.mock.calls[0][0].data).toMatchObject({ status: 'READ' });
  });

  it('never moves a read message back to delivered', async () => {
    db.clientMessage.findFirst.mockResolvedValueOnce({ id: 'msg-1', status: 'READ' });
    await service.handleWhatsAppWebhook(webhook({ statuses: [{ id: 'wamid.1', status: 'delivered' }] }));
    expect(db.clientMessage.update).not.toHaveBeenCalled();
  });

  it('files a STOP reply against the client and opts them out', async () => {
    db.client.findMany.mockResolvedValue([{ id: CLIENT, firstName: 'Rudo', lastName: 'Banda', businessName: null, phone: '+27831234567', contacts: [] }]);
    await service.handleWhatsAppWebhook(webhook({ messages: [{ from: '27831234567', id: 'wamid.in', type: 'text', text: { body: 'STOP' }, timestamp: '1789000000' }] }));
    expect(db.clientMessage.create.mock.calls[0][0].data).toMatchObject({ clientId: CLIENT, direction: 'INBOUND', status: 'RECEIVED', body: 'STOP' });
    expect(db.clientCommunicationPreference.upsert.mock.calls[0][0].update).toMatchObject({ whatsappOptOut: true, source: 'WHATSAPP_STOP' });
  });

  it('ignores events for a number no organization owns', async () => {
    await service.handleWhatsAppWebhook({ entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: '999' }, statuses: [{ id: 'x', status: 'read' }] } }] }] });
    expect(db.clientMessage.findFirst).not.toHaveBeenCalled();
  });
});

describe('unsubscribe links', () => {
  it('opts the client out of that channel only', async () => {
    const { signUnsubscribeToken } = jest.requireActual('../src/services/communications/comms.logic');
    db.client.findFirst.mockResolvedValue({ id: CLIENT, organization: { name: 'OMS' } });
    const result = await service.unsubscribe(signUnsubscribeToken({ organizationId: ORG, clientId: CLIENT, channel: 'EMAIL' }, 'link-secret'));
    expect(result).toEqual({ organizationName: 'OMS', channel: 'EMAIL' });
    expect(db.clientCommunicationPreference.upsert.mock.calls[0][0].update).toEqual({ emailOptOut: true, source: 'UNSUBSCRIBE_LINK' });
  });

  it('refuses a forged link', async () => {
    expect((await refusal(service.unsubscribe('abc.def'))).code).toBe('INVALID_TOKEN');
  });
});

describe('the dispatcher', () => {
  const queued = (overrides: Record<string, unknown> = {}) => ({
    id: 'q1',
    organizationId: ORG,
    clientId: CLIENT,
    channel: 'SMS',
    toAddress: '+27831234567',
    subject: null,
    body: 'Hi',
    templateName: null,
    templateLanguage: null,
    templateParams: null,
    broadcastId: 'broadcast-1',
    attempts: 1,
    broadcast: { id: 'broadcast-1', status: 'SENDING' },
    ...overrides,
  });

  const loadDispatcher = async () => (await import('../src/services/communications/comms.dispatcher')).commsDispatcher;

  it('sends what it claims and completes the broadcast', async () => {
    db.$queryRaw.mockResolvedValueOnce([{ id: 'q1' }]);
    db.clientMessage.findMany.mockResolvedValueOnce([queued()]);
    const dispatcher = await loadDispatcher();
    expect(await dispatcher.dispatchBatch()).toBe(1);
    expect(db.clientMessage.update.mock.calls[0][0].data).toMatchObject({ status: 'SENT', providerMessageId: 'sms-1' });
    expect(db.messageBroadcast.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) }));
  });

  it('puts a temporary failure back in the queue for later', async () => {
    providers.sendSms.mockResolvedValueOnce({ ok: false, providerMessageId: null, status: 'FAILED', errorCode: 'BULKSMS_RATE_LIMIT', errorMessage: 'slow down', retryable: true } as any);
    db.$queryRaw.mockResolvedValueOnce([{ id: 'q1' }]);
    db.clientMessage.findMany.mockResolvedValueOnce([queued()]);
    db.clientMessage.count.mockResolvedValueOnce(1);
    const dispatcher = await loadDispatcher();
    await dispatcher.dispatchBatch();
    const data = db.clientMessage.update.mock.calls[0][0].data;
    expect(data.status).toBe('QUEUED');
    expect(data.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('gives up after the last attempt', async () => {
    providers.sendSms.mockResolvedValueOnce({ ok: false, providerMessageId: null, status: 'FAILED', errorCode: 'BULKSMS_HTTP_503', errorMessage: 'down', retryable: true } as any);
    db.$queryRaw.mockResolvedValueOnce([{ id: 'q1' }]);
    db.clientMessage.findMany.mockResolvedValueOnce([queued({ attempts: 3 })]);
    const dispatcher = await loadDispatcher();
    await dispatcher.dispatchBatch();
    expect(db.clientMessage.update.mock.calls[0][0].data).toMatchObject({ status: 'FAILED' });
  });

  it('does not send a message from a cancelled broadcast', async () => {
    db.$queryRaw.mockResolvedValueOnce([{ id: 'q1' }]);
    db.clientMessage.findMany.mockResolvedValueOnce([queued({ broadcast: { id: 'broadcast-1', status: 'CANCELLED' } })]);
    const dispatcher = await loadDispatcher();
    await dispatcher.dispatchBatch();
    expect(providers.sendSms).not.toHaveBeenCalled();
    expect(db.clientMessage.update.mock.calls[0][0].data).toMatchObject({ status: 'CANCELLED' });
  });

  it('adds an unsubscribe link and header to broadcast emails', async () => {
    db.$queryRaw.mockResolvedValueOnce([{ id: 'q1' }]);
    db.clientMessage.findMany.mockResolvedValueOnce([queued({ channel: 'EMAIL', toAddress: 'rudo@example.com', subject: 'News' })]);
    const dispatcher = await loadDispatcher();
    await dispatcher.dispatchBatch();
    const [, email] = providers.sendEmail.mock.calls[0] as any[];
    expect(email.html).toContain('Unsubscribe from these emails');
    expect(email.headers['List-Unsubscribe']).toMatch(/^<https:\/\/api\.test\/unsubscribe\?token=/);
    expect(email.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });
});

/**
 * The assistant's endpoints, with the services mocked.
 *
 * What matters here is the guard rails around them: the right permission on
 * every route, the organization taken from the session rather than the body,
 * refusals turned into the same shape as everywhere else, and - the one that
 * would be worst to get wrong - no credential ever coming back out.
 */

import express from 'express';
import request from 'supertest';

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';

let permissions: string[] = [];

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { userId: USER, organizationId: ORG };
    next();
  },
}));

jest.mock('../src/middleware/permissions', () => ({
  loadPermissions: (req: any, _res: any, next: any) => {
    req.user.id = req.user.userId;
    req.user.permissions = permissions;
    next();
  },
  requirePermission:
    (...codes: string[]) =>
    (_req: any, res: any, next: any) =>
      codes.every(code => permissions.includes(code))
        ? next()
        : res.status(403).json({ success: false, error: 'FORBIDDEN', requiredPermission: codes[0] }),
  loadUserPermissions: jest.fn(async () => new Set(permissions)),
}));

const service = {
  status: jest.fn(async () => ({ enabled: true, canUse: true, pendingApprovals: 2 })),
  listConversations: jest.fn(async () => []),
  createConversation: jest.fn(async () => ({ id: 'conversation-1' })),
  getConversation: jest.fn(async () => ({ conversation: { id: 'conversation-1' }, messages: [], runs: [] })),
  renameConversation: jest.fn(async () => ({ id: 'conversation-1', title: 'Renamed' })),
  archiveConversation: jest.fn(async () => ({ id: 'conversation-1' })),
  postMessage: jest.fn(async () => ({ conversationId: 'conversation-1', runId: 'run-1', message: {}, attachments: [] })),
  getRun: jest.fn(async () => ({ run: { id: 'run-1', status: 'COMPLETED' }, steps: [], approvals: [] })),
  getRunStep: jest.fn(async () => ({ index: 1 })),
  cancelRun: jest.fn(async () => ({ cancelled: true, status: 'CANCELLED' })),
  artifactUrl: jest.fn(async () => ({ url: 'https://files.test/x', fileName: 'id.pdf', mimeType: 'application/pdf' })),
  listMemories: jest.fn(async () => []),
  addMemory: jest.fn(async () => ({ id: 'memory-1' })),
  deleteMemory: jest.fn(async () => ({ deleted: true })),
};

jest.mock('../src/services/assistant/assistant.service', () => ({
  assistantService: new Proxy({}, { get: (_t, key: string) => (service as any)[key] }),
}));

const settingsService = {
  forDisplay: jest.fn(async () => ({ settings: { enabled: true }, catalogue: [], humanOnly: [] })),
  update: jest.fn(async () => ({ enabled: true })),
  usage: jest.fn(async () => ({ days: 30, rows: [], totals: {} })),
  resolve: jest.fn(async () => ({ browserAllowedDomains: ['bureau.test'] })),
};
jest.mock('../src/services/assistant/assistant.settings.service', () => ({
  assistantSettingsService: new Proxy({}, { get: (_t, key: string) => (settingsService as any)[key] }),
}));

const approvals = {
  list: jest.fn(async () => []),
  get: jest.fn(async () => ({ id: 'approval-1' })),
  approve: jest.fn(async () => ({ alreadyDone: false, result: { created: true } })),
  reject: jest.fn(async () => ({ id: 'approval-1', status: 'REJECTED' })),
  counts: jest.fn(async () => ({ pending: 0 })),
};
jest.mock('../src/services/assistant/assistant.approvals', () => ({
  assistantApprovalService: new Proxy({}, { get: (_t, key: string) => (approvals as any)[key] }),
}));

const automations = {
  list: jest.fn(async () => ({ catalogue: [], automations: [] })),
  get: jest.fn(async () => ({ automation: {}, runs: [] })),
  create: jest.fn(async () => ({ id: 'automation-1' })),
  update: jest.fn(async () => ({ id: 'automation-1' })),
  remove: jest.fn(async () => ({ removed: true })),
  runNow: jest.fn(async () => ({ status: 'COMPLETED', summary: 'Would send 3 reminders' })),
  runs: jest.fn(async () => []),
};
jest.mock('../src/services/assistant/assistant.automations', () => ({
  assistantAutomationService: new Proxy({}, { get: (_t, key: string) => (automations as any)[key] }),
}));

jest.mock('../src/services/assistant/assistant.models', () => ({
  assistantModelOptions: jest.fn(async () => [{ name: 'gemini', displayName: 'Google Gemini', hasKey: true }]),
}));

const connections = {
  list: jest.fn(async () => ({ configured: true, connections: [], toolkits: [] })),
  start: jest.fn(async () => ({ connectionId: 'connection-1', redirectUrl: 'https://composio.test/auth' })),
  refresh: jest.fn(async () => ({ id: 'connection-1', status: 'ACTIVE' })),
  remove: jest.fn(async () => ({ removed: true })),
};
jest.mock('../src/services/assistant/composio/connections.service', () => ({
  assistantConnectionService: new Proxy({}, { get: (_t, key: string) => (connections as any)[key] }),
}));

const logins = {
  list: jest.fn(async () => ({ logins: [{ id: 'login-1', name: 'Bureau', username: 'ops' }], encryptedAtRest: false })),
  create: jest.fn(async () => ({ id: 'login-1', name: 'Bureau', username: 'ops' })),
  update: jest.fn(async () => ({ id: 'login-1' })),
  remove: jest.fn(async () => ({ removed: true })),
  verify: jest.fn(async () => ({ signedIn: true })),
};
jest.mock('../src/services/assistant/browser/browser.service', () => ({
  browserLoginService: new Proxy({}, { get: (_t, key: string) => (logins as any)[key] }),
}));

const mcp = {
  list: jest.fn(async () => ({ servers: [], encryptedAtRest: false })),
  create: jest.fn(async () => ({ id: 'server-1' })),
  update: jest.fn(async () => ({ id: 'server-1' })),
  remove: jest.fn(async () => ({ removed: true })),
  test: jest.fn(async () => ({ reachable: true, tools: [] })),
};
jest.mock('../src/services/assistant/mcp/mcp.client', () => ({
  mcpServerService: new Proxy({}, { get: (_t, key: string) => (mcp as any)[key] }),
}));

const connectors = {
  list: jest.fn(async () => ({ connectors: [], encryptedAtRest: false })),
  create: jest.fn(async () => ({ id: 'connector-1' })),
  update: jest.fn(async () => ({ id: 'connector-1' })),
  remove: jest.fn(async () => ({ removed: true })),
  test: jest.fn(async () => ({ reachable: true, status: 200 })),
};
jest.mock('../src/services/assistant/connectors/api.connectors', () => ({
  apiConnectorService: new Proxy({}, { get: (_t, key: string) => (connectors as any)[key] }),
}));

import assistantRoutes from '../src/routes/assistant.routes';
import { AssistantError } from '../src/services/assistant/assistant.logic';

const app = express();
app.use(express.json());
app.use('/assistant', assistantRoutes);

beforeEach(() => {
  jest.clearAllMocks();
  permissions = [
    'assistant:use',
    'assistant:approve',
    'assistant:automations',
    'assistant:connections',
    'assistant:manage',
  ];
});

describe('who may reach what', () => {
  it('lets anyone who may use the assistant see its status', async () => {
    permissions = ['assistant:use'];
    const response = await request(app).get('/assistant/status');
    expect(response.status).toBe(200);
    expect(response.body.data.pendingApprovals).toBe(2);
  });

  it('keeps the settings for whoever may configure it', async () => {
    permissions = ['assistant:use'];
    expect((await request(app).get('/assistant/settings')).status).toBe(403);
    permissions = ['assistant:manage'];
    expect((await request(app).get('/assistant/settings')).status).toBe(200);
  });

  it('keeps approving for whoever may approve', async () => {
    permissions = ['assistant:use'];
    const response = await request(app).post('/assistant/approvals/44444444-4444-4444-8444-444444444444/approve').send({});
    expect(response.status).toBe(403);
    expect(approvals.approve).not.toHaveBeenCalled();
  });

  it('keeps automations, connections and usage behind their own permissions', async () => {
    permissions = ['assistant:use'];
    expect((await request(app).get('/assistant/automations')).status).toBe(403);
    expect((await request(app).get('/assistant/connections')).status).toBe(403);
    expect((await request(app).get('/assistant/usage')).status).toBe(403);
    expect((await request(app).get('/assistant/mcp-servers')).status).toBe(403);
    expect((await request(app).get('/assistant/api-connectors')).status).toBe(403);
  });
});

describe('the organization comes from the session', () => {
  it('ignores an organization id in the body', async () => {
    await request(app)
      .post('/assistant/messages')
      .send({ content: 'Hello', organizationId: OTHER });
    const [ctx] = service.postMessage.mock.calls[0] as any[];
    expect(ctx).toEqual({ organizationId: ORG, userId: USER });
  });

  it('passes the message, its conversation and its context through', async () => {
    await request(app)
      .post('/assistant/messages')
      .send({
        content: 'Look at this client',
        conversationId: '55555555-5555-4555-8555-555555555555',
        context: JSON.stringify({ clientId: 'client-1' }),
      });
    const [, input] = service.postMessage.mock.calls[0] as any[];
    expect(input).toMatchObject({
      content: 'Look at this client',
      conversationId: '55555555-5555-4555-8555-555555555555',
      context: { clientId: 'client-1' },
    });
  });

  it('takes an attachment as multipart', async () => {
    const response = await request(app)
      .post('/assistant/messages')
      .field('content', 'Create this client')
      .attach('files', Buffer.from('%PDF-1.4'), { filename: 'id.pdf', contentType: 'application/pdf' });
    expect(response.status).toBe(201);
    const [, , files] = service.postMessage.mock.calls[0] as any[];
    expect(files[0].originalname).toBe('id.pdf');
  });
});

describe('refusals', () => {
  it('come back with their own status and message', async () => {
    service.getConversation.mockRejectedValueOnce(
      new AssistantError('That conversation belongs to somebody else.', 'FORBIDDEN', 403) as never
    );
    const response = await request(app).get('/assistant/conversations/66666666-6666-4666-8666-666666666666');
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: 'FORBIDDEN' });
  });

  it('reject an id that is not a record id', async () => {
    const response = await request(app).get('/assistant/conversations/not-a-uuid');
    expect(response.status).toBe(400);
    expect(service.getConversation).not.toHaveBeenCalled();
  });

  it('reject a schedule the automation service would not accept', async () => {
    const response = await request(app)
      .post('/assistant/automations')
      .send({ type: 'DUE_SOON_REMINDERS', schedule: { kind: 'HOURLY' } });
    expect(response.status).toBe(400);
  });
});

describe('credentials', () => {
  it('are never returned by the website sign-ins endpoint', async () => {
    const response = await request(app).get('/assistant/browser-logins');
    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toMatch(/password|secret|storageState/i);
  });

  it('are accepted on the way in', async () => {
    const response = await request(app).post('/assistant/browser-logins').send({
      name: 'Bureau',
      loginUrl: 'https://bureau.test/login',
      username: 'ops',
      password: 'a-real-password',
    });
    expect(response.status).toBe(201);
    expect((logins.create.mock.calls[0] as any[])[1].password).toBe('a-real-password');
    expect(JSON.stringify(response.body)).not.toContain('a-real-password');
  });
});

describe('the everyday paths', () => {
  it('runs an automation as a dry run when asked', async () => {
    const response = await request(app)
      .post('/assistant/automations/77777777-7777-4777-8777-777777777777/run')
      .send({ dryRun: true });
    expect(response.status).toBe(200);
    expect((automations.runNow.mock.calls[0] as any[])[2]).toEqual({ dryRun: true });
  });

  it('approves with corrections', async () => {
    const response = await request(app)
      .post('/assistant/approvals/88888888-8888-4888-8888-888888888888/approve')
      .send({ edits: { phone: '+263771111111' }, note: 'Fixed the number' });
    expect(response.status).toBe(200);
    expect((approvals.approve.mock.calls[0] as any[])[2]).toEqual({
      edits: { phone: '+263771111111' },
      note: 'Fixed the number',
    });
  });

  it('cancels a run', async () => {
    const response = await request(app).post('/assistant/runs/99999999-9999-4999-8999-999999999999/cancel');
    expect(response.status).toBe(200);
    expect(response.body.data.cancelled).toBe(true);
  });

  it('starts connecting a mailbox and hands back the sign-in link', async () => {
    const response = await request(app).post('/assistant/connections').send({ toolkit: 'gmail' });
    expect(response.status).toBe(201);
    expect(response.body.data.redirectUrl).toContain('https://');
  });
});

/**
 * The OBSE service, with the database, storage and network mocked.
 *
 * These are the promises the integration makes that are easy to break
 * quietly: the API key never comes back out, a password is never written
 * down, the shared key never follows an administrator's base URL, nothing
 * happens for an organization that has not switched OBSE on, and every
 * analysis ends in a recorded result rather than spinning forever.
 */

const ORG = '11111111-1111-4111-8111-111111111111';
const CLIENT = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const STATEMENT = '44444444-4444-4444-8444-444444444444';
const PAYSLIP = '55555555-5555-4555-8555-555555555555';
const ANALYSIS = '66666666-6666-4666-8666-666666666666';

const ORG_KEY = 'org_key_abcdefghijklmnopqrstuvwxyz_1234';
const ENV_KEY = 'env_key_zyxwvutsrqponmlkjihgfedcba_9876';

// ------------------------------------------------------------------ mocks
let storedSettings: Record<string, unknown> = {};

const db: any = {
  organizationSettings: {
    findMany: jest.fn(async ({ where }: any) =>
      Object.entries(storedSettings)
        .filter(([key]) => where.settingKey.in.includes(key))
        .map(([settingKey, settingValue]) => ({ settingKey, settingValue }))
    ),
    deleteMany: jest.fn(async ({ where }: any) => {
      for (const key of where.settingKey.in) delete storedSettings[key];
      return { count: 1 };
    }),
  },
  client: {
    findFirst: jest.fn(),
    findUnique: jest.fn(async () => ({ firstName: 'Tendai', lastName: 'Moyo', businessName: null, clientNumber: 'CL-0001' })),
  },
  clientDocument: { findMany: jest.fn() },
  bankStatementAnalysis: {
    updateMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(async () => ({})),
  },
  $executeRaw: jest.fn(async () => 1),
  $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
};

// A getter, because the service is imported before `db` is initialised.
jest.mock('../src/config/database', () => ({
  get prisma() {
    return db;
  },
}));

jest.mock('../src/services/settings.service', () => ({
  settingsService: {
    set: jest.fn(async (_org: string, input: any) => {
      storedSettings[input.settingKey] = input.settingValue;
    }),
  },
}));

const download = jest.fn();
jest.mock('../src/services/storage.service', () => ({
  storageService: { download: (...args: unknown[]) => download(...args) },
}));

// Encryption on, so the test can see a key is not stored as given.
jest.mock('../src/services/security/encryption.service', () => ({
  encryptionService: {
    isEnabled: () => true,
    isEncrypted: (value: string) => value.startsWith('enc:'),
    encrypt: (value: string) => `enc:${Buffer.from(value).toString('base64')}`,
    decrypt: (value: string) =>
      value.startsWith('enc:')
        ? Buffer.from(value.slice(4), 'base64').toString()
        : value,
  },
}));

const createAuditLog = jest.fn(async () => ({}));
jest.mock('../src/services/audit.service', () => ({
  createAuditLog: (...args: unknown[]) => (createAuditLog as any)(...args),
}));

const notify = jest.fn(async () => ({}));
jest.mock('../src/services/in-app-notification.service', () => ({
  inAppNotificationService: { notify: (...args: unknown[]) => (notify as any)(...args) },
  NOTIFICATION_TYPES: {
    BANK_STATEMENT_ANALYSIS_COMPLETED: 'BANK_STATEMENT_ANALYSIS_COMPLETED',
    BANK_STATEMENT_ANALYSIS_FAILED: 'BANK_STATEMENT_ANALYSIS_FAILED',
  },
}));

const fetchMock = jest.fn();
jest.mock('undici', () => ({
  ...jest.requireActual('undici'),
  Agent: jest.fn(),
  fetch: (...args: unknown[]) => fetchMock(...args),
}));

import { ObseService } from '../src/services/obse/obse.service';
import { AnalysisRequestError } from '../src/services/obse/obse.logic';

const reply = (status: number, body: unknown) => ({
  status,
  text: async () => JSON.stringify(body),
  json: async () => body,
});

const SUCCESS = {
  success: true,
  data: {
    policyVersion: '2026.09',
    statementPeriod: { from: '01/03/2026', to: '31/05/2026', months: 3 },
    statementDetails: { bankName: 'Capitec' },
    summary: {
      totalMonthlyIncome: 19000,
      totalMonthlyExpenses: 12000,
      disposableIncome: 7000,
      suggestedAffordableRepayment: 2100,
      primaryMonthlySalary: 18500,
    },
    incomeStability: { volatility: 'low' },
    fraud: { hasFindings: false, findings: [] },
  },
};

const service = new ObseService();

const expectRefusal = async (promise: Promise<unknown>, code: string) => {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(AnalysisRequestError);
  expect((error as AnalysisRequestError).code).toBe(code);
  return error as AnalysisRequestError;
};

beforeEach(() => {
  jest.clearAllMocks();
  // Failures are logged on purpose; the assertions check what was recorded.
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  storedSettings = {};
  delete process.env.OBSE_API_KEY;
  delete process.env.OBSE_BASE_URL;
  delete process.env.OBSE_ALLOWED_HOSTS;
});

// ---------------------------------------------------------------- config
describe('which key and URL an organization uses', () => {
  it('is inactive until switched on, even with a key', async () => {
    process.env.OBSE_API_KEY = ENV_KEY;
    const config = await service.resolveConfig(ORG);
    expect(config.active).toBe(false);
    expect(await service.isActive(ORG)).toBe(false);
  });

  it('prefers the organization’s own key, decrypted', async () => {
    process.env.OBSE_API_KEY = ENV_KEY;
    storedSettings = {
      obse_enabled: true,
      obse_api_key: `enc:${Buffer.from(ORG_KEY).toString('base64')}`,
      obse_base_url: 'https://api.obse.co.za',
    };
    const config = await service.resolveConfig(ORG);
    expect(config).toMatchObject({
      active: true,
      apiKey: ORG_KEY,
      keySource: 'organization',
      baseUrl: 'https://api.obse.co.za',
    });
  });

  it('never sends the shared key to an administrator’s base URL', async () => {
    process.env.OBSE_API_KEY = ENV_KEY;
    storedSettings = { obse_enabled: true, obse_base_url: 'https://api.obse.co.za' };
    const config = await service.resolveConfig(ORG);
    expect(config.keySource).toBe('environment');
    expect(config.baseUrl).toBe('https://api.qa.obse.co.za');
  });

  it('ignores a saved base URL that is off the allow-list', async () => {
    storedSettings = {
      obse_enabled: true,
      obse_api_key: ORG_KEY,
      obse_base_url: 'https://evil.example.com',
    };
    const config = await service.resolveConfig(ORG);
    expect(config.baseUrl).toBe('https://api.qa.obse.co.za');
  });

  it('does not fall back to the shared key when its own key cannot be read', async () => {
    process.env.OBSE_API_KEY = ENV_KEY;
    storedSettings = { obse_enabled: true, obse_api_key: 'enc:@@not-decryptable' };
    const { encryptionService } = jest.requireMock('../src/services/security/encryption.service');
    const original = encryptionService.decrypt;
    encryptionService.decrypt = () => {
      throw new Error('bad key');
    };
    try {
      const config = await service.resolveConfig(ORG);
      expect(config).toMatchObject({ keyUnreadable: true, apiKey: null, active: false });
    } finally {
      encryptionService.decrypt = original;
    }
  });
});

describe('the settings screen', () => {
  it('never receives the key, only its last four characters', async () => {
    storedSettings = { obse_enabled: true, obse_api_key: ORG_KEY };
    const settings = await service.getPublicSettings(ORG);
    expect(JSON.stringify(settings)).not.toContain(ORG_KEY.slice(0, -4));
    expect(settings.apiKeyHint).toBe('****1234');
    expect(settings.hasApiKey).toBe(true);
  });

  it('stores a new key encrypted, not as typed', async () => {
    await service.updateSettings(ORG, USER, { apiKey: ORG_KEY, enabled: true });
    expect(storedSettings.obse_api_key).not.toBe(ORG_KEY);
    expect(String(storedSettings.obse_api_key)).toMatch(/^enc:/);
    expect(storedSettings.obse_enabled).toBe(true);
  });

  it('keeps the key out of the audit trail', async () => {
    await service.updateSettings(ORG, USER, { apiKey: ORG_KEY, enabled: true });
    const entry = JSON.stringify((createAuditLog.mock.calls as any[])[0][0]);
    expect(entry).not.toContain(ORG_KEY.slice(0, -4));
    expect(entry).toContain('"apiKeyChanged":true');
  });

  it('refuses to activate with no key anywhere', async () => {
    await expectRefusal(service.updateSettings(ORG, USER, { enabled: true }), 'API_KEY_REQUIRED');
    expect(storedSettings.obse_enabled).toBeUndefined();
  });

  it('lets an organization activate on the deployment’s shared key', async () => {
    process.env.OBSE_API_KEY = ENV_KEY;
    const settings = await service.updateSettings(ORG, USER, { enabled: true });
    expect(settings).toMatchObject({ active: true, keySource: 'environment' });
  });

  it('refuses to remove the only key while OBSE stays active', async () => {
    storedSettings = { obse_enabled: true, obse_api_key: ORG_KEY };
    await expectRefusal(service.updateSettings(ORG, USER, { apiKey: null }), 'API_KEY_REQUIRED');
    expect(storedSettings.obse_api_key).toBe(ORG_KEY);
  });

  it('refuses a base URL off the allow-list, and writes nothing', async () => {
    await expectRefusal(
      service.updateSettings(ORG, USER, { apiKey: ORG_KEY, baseUrl: 'https://collector.example.com' }),
      'BASE_URL_NOT_ALLOWED'
    );
    expect(storedSettings).toEqual({});
  });

  it('removes a saved base URL when cleared', async () => {
    storedSettings = { obse_api_key: ORG_KEY, obse_base_url: 'https://api.obse.co.za' };
    await service.updateSettings(ORG, USER, { baseUrl: '' });
    expect(storedSettings.obse_base_url).toBeUndefined();
  });
});

describe('testing a connection', () => {
  it('sends the key as X-API-Key and posts no documents', async () => {
    storedSettings = { obse_api_key: ORG_KEY };
    fetchMock.mockResolvedValue(reply(400, { success: false, error: "A bank statement is required under the 'statements' field" }));
    const result = await service.testConnection(ORG);
    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.qa.obse.co.za/api/v2/affordability/analyze');
    expect(init.headers['X-API-Key']).toBe(ORG_KEY);
    expect(init.body).toBeUndefined();
  });

  it('keeps the shared key at the deployment’s URL even when asked to test elsewhere', async () => {
    process.env.OBSE_API_KEY = ENV_KEY;
    fetchMock.mockResolvedValue(reply(400, { error: 'statement required' }));
    await service.testConnection(ORG, { baseUrl: 'https://api.obse.co.za' });
    expect(fetchMock.mock.calls[0][0]).toContain('https://api.qa.obse.co.za');
  });

  it('reports an unreachable service instead of throwing', async () => {
    storedSettings = { obse_api_key: ORG_KEY };
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await service.testConnection(ORG);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Could not reach OBSE/);
  });
});

// -------------------------------------------------------------- requests
const activeOrg = () => {
  storedSettings = { obse_enabled: true, obse_api_key: ORG_KEY };
};

const statementDoc = {
  id: STATEMENT,
  clientId: CLIENT,
  mimeType: 'application/pdf',
  fileName: 'march-may.pdf',
  documentType: { code: 'BANK_STATEMENT' },
};

describe('starting an analysis', () => {
  beforeEach(() => {
    db.client.findFirst.mockResolvedValue({ id: CLIENT, clientNumber: 'CL-0001', type: 'INDIVIDUAL', employmentStatus: 'EMPLOYED' });
    db.clientDocument.findMany.mockResolvedValue([statementDoc]);
    db.bankStatementAnalysis.updateMany.mockResolvedValue({ count: 0 });
    db.bankStatementAnalysis.findFirst.mockResolvedValue(null);
    db.bankStatementAnalysis.create.mockImplementation(async ({ data }: any) => ({ id: ANALYSIS, ...data }));
  });

  const request = (overrides = {}) =>
    service.requestAnalysis({
      organizationId: ORG,
      clientId: CLIENT,
      userId: USER,
      statementDocumentIds: [STATEMENT],
      payslipDocumentIds: [],
      ...overrides,
    });

  it('refuses outright when OBSE is not active, touching nothing', async () => {
    const error = await expectRefusal(request(), 'OBSE_NOT_ACTIVE');
    expect(error.httpStatus).toBe(403);
    expect(db.bankStatementAnalysis.create).not.toHaveBeenCalled();
  });

  it('creates a pending record and runs it in the background', async () => {
    activeOrg();
    const run = jest.spyOn(service, 'runAnalysis').mockResolvedValue();
    const analysis = await request({ pdfPassword: 'secret-pw' });

    expect(analysis.status).toBe('PENDING');
    const data = db.bankStatementAnalysis.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      organizationId: ORG,
      clientId: CLIENT,
      statementDocumentIds: [STATEMENT],
      customerType: 'salaried',
      referenceNumber: 'CL-0001',
      requestedById: USER,
    });
    expect(run).toHaveBeenCalledWith(ANALYSIS, { pdfPassword: 'secret-pw' });
    run.mockRestore();
  });

  it('never writes the PDF password down', async () => {
    activeOrg();
    const run = jest.spyOn(service, 'runAnalysis').mockResolvedValue();
    await request({ pdfPassword: 'secret-pw' });
    const written = JSON.stringify([
      db.bankStatementAnalysis.create.mock.calls,
      createAuditLog.mock.calls,
    ]);
    expect(written).not.toContain('secret-pw');
    run.mockRestore();
  });

  it('refuses a second analysis while one is running for the client', async () => {
    activeOrg();
    db.bankStatementAnalysis.findFirst.mockResolvedValue({ id: 'running' });
    const error = await expectRefusal(request(), 'ANALYSIS_IN_PROGRESS');
    expect(error.httpStatus).toBe(409);
    expect(db.bankStatementAnalysis.create).not.toHaveBeenCalled();
    // The check runs under a lock, so two clicks cannot both pass it.
    expect(db.$executeRaw).toHaveBeenCalled();
  });

  it('refuses a client from another organization as not found', async () => {
    activeOrg();
    db.client.findFirst.mockResolvedValue(null);
    await expectRefusal(request(), 'CLIENT_NOT_FOUND');
    expect(db.client.findFirst.mock.calls[0][0].where.organizationId).toBe(ORG);
  });

  it('suggests non-salaried for a self-employed client when no type is given', async () => {
    activeOrg();
    db.client.findFirst.mockResolvedValue({ id: CLIENT, clientNumber: 'CL-0001', type: 'INDIVIDUAL', employmentStatus: 'SELF_EMPLOYED' });
    const run = jest.spyOn(service, 'runAnalysis').mockResolvedValue();
    await request();
    expect(db.bankStatementAnalysis.create.mock.calls[0][0].data.customerType).toBe('non-salaried');
    run.mockRestore();
  });
});

// ---------------------------------------------------------------- running
describe('running an analysis', () => {
  const pending = {
    id: ANALYSIS,
    organizationId: ORG,
    clientId: CLIENT,
    requestedById: USER,
    statementDocumentIds: [STATEMENT],
    payslipDocumentIds: [PAYSLIP],
    customerType: 'salaried',
    referenceNumber: 'CL-0001',
  };

  beforeEach(() => {
    activeOrg();
    db.bankStatementAnalysis.updateMany.mockResolvedValue({ count: 1 });
    db.bankStatementAnalysis.findUnique.mockResolvedValue(pending);
    db.clientDocument.findMany.mockResolvedValue([
      { id: STATEMENT, fileName: 'statement.pdf', mimeType: 'application/pdf', storagePath: 'a/statement.pdf' },
      { id: PAYSLIP, fileName: 'payslip.pdf', mimeType: 'application/pdf', storagePath: 'a/payslip.pdf' },
    ]);
    download.mockResolvedValue(Buffer.from('%PDF-1.4 test'));
  });

  const finalUpdate = () => db.bankStatementAnalysis.update.mock.calls.at(-1)![0].data;

  it('sends the documents and fields OBSE expects', async () => {
    fetchMock.mockResolvedValue(reply(200, SUCCESS));
    await service.runAnalysis(ANALYSIS, { pdfPassword: 'secret-pw' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.qa.obse.co.za/api/v2/affordability/analyze');
    expect(init.method).toBe('POST');
    expect(init.headers['X-API-Key']).toBe(ORG_KEY);

    const form = init.body as FormData;
    expect(form.getAll('statements')).toHaveLength(1);
    expect(form.getAll('payslips')).toHaveLength(1);
    expect((form.get('statements') as File).name).toBe('statement.pdf');
    expect(form.get('customerType')).toBe('salaried');
    expect(form.get('referenceNumber')).toBe('CL-0001');
    expect(form.get('pdfPassword')).toBe('secret-pw');
  });

  it('only runs an analysis that is still pending', async () => {
    db.bankStatementAnalysis.updateMany.mockResolvedValue({ count: 0 });
    await service.runAnalysis(ANALYSIS);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('records the full response and its headline figures', async () => {
    fetchMock.mockResolvedValue(reply(200, SUCCESS));
    await service.runAnalysis(ANALYSIS, { pdfPassword: 'secret-pw' });

    const data = finalUpdate();
    expect(data.status).toBe('COMPLETED');
    expect(data.rawResponse).toEqual(SUCCESS);
    expect(Number(data.monthlyIncome)).toBe(19000);
    expect(Number(data.suggestedRepayment)).toBe(2100);
    expect(data.bankName).toBe('Capitec');
    expect(data.incomeVolatility).toBe('low');
    expect(data.fraudFindingsCount).toBe(0);
    expect(data.completedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(db.bankStatementAnalysis.update.mock.calls)).not.toContain('secret-pw');
  });

  it('tells the person who asked that it is ready', async () => {
    fetchMock.mockResolvedValue(reply(200, SUCCESS));
    await service.runAnalysis(ANALYSIS);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: USER,
        type: 'BANK_STATEMENT_ANALYSIS_COMPLETED',
        link: `/clients/${CLIENT}?tab=bank-statement-analysis&analysis=${ANALYSIS}`,
      })
    );
  });

  it('records OBSE’s refusal, with its reason', async () => {
    fetchMock.mockResolvedValue(reply(422, { success: false, error: 'Password required', passwordRequired: true }));
    await service.runAnalysis(ANALYSIS);
    const data = finalUpdate();
    expect(data).toMatchObject({ status: 'FAILED', errorCode: 'PASSWORD_REQUIRED', httpStatus: 422 });
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'BANK_STATEMENT_ANALYSIS_FAILED' }));
  });

  it('fails cleanly when OBSE cannot be reached', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await service.runAnalysis(ANALYSIS);
    expect(finalUpdate()).toMatchObject({ status: 'FAILED', errorCode: 'CONNECTION_FAILED' });
  });

  it('fails cleanly on timeout', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    await service.runAnalysis(ANALYSIS);
    expect(finalUpdate()).toMatchObject({ status: 'FAILED', errorCode: 'TIMEOUT' });
  });

  it('does not call OBSE when a document cannot be read from storage', async () => {
    download.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:9000'));
    await service.runAnalysis(ANALYSIS);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(finalUpdate()).toMatchObject({ status: 'FAILED', errorCode: 'STORAGE_UNAVAILABLE' });
  });

  it('does not call OBSE when a document was deleted in the meantime', async () => {
    db.clientDocument.findMany.mockResolvedValue([]);
    await service.runAnalysis(ANALYSIS);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(finalUpdate()).toMatchObject({ status: 'FAILED', errorCode: 'DOCUMENT_UNAVAILABLE' });
  });

  it('does not call OBSE when it was deactivated before the analysis ran', async () => {
    storedSettings = { obse_enabled: false, obse_api_key: ORG_KEY };
    await service.runAnalysis(ANALYSIS);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(finalUpdate()).toMatchObject({ status: 'FAILED', errorCode: 'OBSE_NOT_ACTIVE' });
  });

  it('never throws, even when something unexpected breaks', async () => {
    fetchMock.mockResolvedValue({ status: 200, text: async () => { throw new Error('socket hang up'); } });
    await expect(service.runAnalysis(ANALYSIS)).resolves.toBeUndefined();
  });
});

describe('reading analyses', () => {
  it('scopes a single analysis to the caller’s organization', async () => {
    db.bankStatementAnalysis.findFirst.mockResolvedValue(null);
    await expectRefusal(service.getById(ORG, ANALYSIS), 'ANALYSIS_NOT_FOUND');
    expect(db.bankStatementAnalysis.findFirst.mock.calls[0][0].where).toEqual({ id: ANALYSIS, organizationId: ORG });
  });

  it('leaves the large response out of the list', async () => {
    db.client.findFirst.mockResolvedValue({ id: CLIENT });
    db.bankStatementAnalysis.updateMany.mockResolvedValue({ count: 0 });
    db.bankStatementAnalysis.findMany.mockResolvedValue([]);
    await service.listForClient(ORG, CLIENT);
    const select = db.bankStatementAnalysis.findMany.mock.calls[0][0].select;
    expect(select.rawResponse).toBeUndefined();
  });

  it('closes off analyses abandoned by a restart before listing', async () => {
    db.client.findFirst.mockResolvedValue({ id: CLIENT });
    db.bankStatementAnalysis.updateMany.mockResolvedValue({ count: 1 });
    db.bankStatementAnalysis.findMany.mockResolvedValue([]);
    await service.listForClient(ORG, CLIENT);
    const sweep = db.bankStatementAnalysis.updateMany.mock.calls[0][0];
    expect(sweep.where.status.in).toEqual(['PENDING', 'PROCESSING']);
    expect(sweep.data).toMatchObject({ status: 'FAILED', errorCode: 'ABANDONED' });
  });

  it('names the documents that were analysed', async () => {
    db.client.findFirst.mockResolvedValue({ id: CLIENT });
    db.bankStatementAnalysis.updateMany.mockResolvedValue({ count: 0 });
    db.bankStatementAnalysis.findMany.mockResolvedValue([
      { id: ANALYSIS, statementDocumentIds: [STATEMENT], payslipDocumentIds: [PAYSLIP] },
    ]);
    db.clientDocument.findMany.mockResolvedValue([{ id: STATEMENT, fileName: 'statement.pdf' }]);
    const [analysis] = await service.listForClient(ORG, CLIENT);
    expect(analysis!.documents).toEqual([
      { id: STATEMENT, kind: 'BANK_STATEMENT', fileName: 'statement.pdf' },
      // Deleted since: the id stays, the name is gone.
      { id: PAYSLIP, kind: 'PAYSLIP', fileName: null },
    ]);
  });
});

describe('saving a reviewer’s adjustments', () => {
  const stored = {
    id: ANALYSIS,
    status: 'COMPLETED',
    reviewerOverrides: null,
    monthlyIncome: '10000',
    monthlyExpenses: '2000',
    disposableIncome: '8000',
    suggestedRepayment: '2400',
    primaryMonthlySalary: '10000',
    rawResponse: {
      success: true,
      data: {
        customerType: 'salaried',
        statementPeriod: { months: 1, monthKeys: ['2026-01'] },
        summary: { repaymentRatio: 0.3, payslipSalary: 0 },
        evidence: {
          incomeTransactions: [
            { id: 'txn-1', month: '2026-01', group: 'salary', included: true, moneyIn: 10000 },
            { id: 'txn-2', month: '2026-01', group: 'other-income', included: false, moneyIn: 3000 },
          ],
          expenseTransactions: [
            { id: 'txn-3', month: '2026-01', group: 'living', included: true, moneyOut: 2000 },
          ],
          salaryTransactions: [{ id: 'txn-1' }],
        },
      },
    },
  };

  beforeEach(() => {
    db.bankStatementAnalysis.findFirst.mockReset();
    db.bankStatementAnalysis.findFirst
      .mockResolvedValueOnce(stored)
      .mockResolvedValue({ ...stored, statementDocumentIds: [], payslipDocumentIds: [] });
    db.bankStatementAnalysis.updateMany.mockResolvedValue({ count: 0 });
    db.clientDocument.findMany.mockResolvedValue([]);
  });

  const lastUpdate = () => db.bankStatementAnalysis.update.mock.calls.at(-1)![0].data;

  it('recalculates the figures itself rather than trusting the browser', async () => {
    await service.saveAdjustments(ORG, ANALYSIS, USER, { 'txn-2': true });
    const data = lastUpdate();
    expect(Number(data.monthlyIncome)).toBe(13000);
    expect(Number(data.disposableIncome)).toBe(11000);
    expect(Number(data.suggestedRepayment)).toBe(3300);
    expect(data.reviewerOverrides).toEqual({ 'txn-2': true });
    expect(data.adjustedBy).toEqual({ connect: { id: USER } });
    expect(data.adjustedAt).toBeInstanceOf(Date);
  });

  it('never touches OBSE’s original response', async () => {
    await service.saveAdjustments(ORG, ANALYSIS, USER, { 'txn-2': true });
    expect(lastUpdate().rawResponse).toBeUndefined();
  });

  it('returns to OBSE’s figures when every decision matches OBSE again', async () => {
    await service.saveAdjustments(ORG, ANALYSIS, USER, { 'txn-2': false });
    const data = lastUpdate();
    expect(Number(data.monthlyIncome)).toBe(10000);
    expect(data.adjustedAt).toBeNull();
    expect(data.adjustedBy).toEqual({ disconnect: true });
  });

  it('records before and after in the audit trail', async () => {
    await service.saveAdjustments(ORG, ANALYSIS, USER, { 'txn-2': true });
    const entry = (createAuditLog.mock.calls as any[]).at(-1)[0];
    expect(entry.previousValue.monthlyIncome).toBe('10000');
    expect(entry.newValue).toMatchObject({ monthlyIncome: 13000, adjustedLines: 1 });
  });

  it('refuses a line that is not in the analysis', async () => {
    await expectRefusal(
      service.saveAdjustments(ORG, ANALYSIS, USER, { 'txn-999': true }),
      'UNKNOWN_TRANSACTION'
    );
    expect(db.bankStatementAnalysis.update).not.toHaveBeenCalled();
  });

  it('refuses an analysis that has not completed', async () => {
    db.bankStatementAnalysis.findFirst.mockReset();
    db.bankStatementAnalysis.findFirst.mockResolvedValue({ ...stored, status: 'FAILED' });
    await expectRefusal(
      service.saveAdjustments(ORG, ANALYSIS, USER, {}),
      'ANALYSIS_NOT_COMPLETED'
    );
  });

  it('only finds analyses in the caller’s organization', async () => {
    await service.saveAdjustments(ORG, ANALYSIS, USER, {});
    expect(db.bankStatementAnalysis.findFirst.mock.calls[0][0].where).toEqual({
      id: ANALYSIS,
      organizationId: ORG,
    });
  });
});

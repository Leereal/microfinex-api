/**
 * OBSE bank statement analysis - configuration, requests and results.
 *
 * The decisions live in obse.logic.ts; this file does the talking: to the
 * organization's settings, to document storage, to OBSE, and to the database.
 *
 * Three rules hold throughout:
 *
 *  - The API key never leaves the server. No response carries it, no log line
 *    prints it, and the audit trail records only that it changed.
 *  - A PDF password is used for the one request it was given for and then
 *    forgotten. It is never written anywhere.
 *  - An organization that has not activated OBSE gets nothing: no analysis
 *    can be requested, and the status endpoint tells the UI to hide it all.
 */

import { Agent, FormData, fetch } from 'undici';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { settingsService } from '../settings.service';
import { storageService } from '../storage.service';
import { encryptionService } from '../security/encryption.service';
import { createAuditLog } from '../audit.service';
import {
  inAppNotificationService,
  NOTIFICATION_TYPES,
} from '../in-app-notification.service';
import {
  ANALYSIS_STATUS,
  AnalysisRequestError,
  IN_FLIGHT_STATUSES,
  OBSE_ANALYZE_PATH,
  OBSE_CONNECTION_TEST_TIMEOUT_MS,
  OBSE_DEFAULT_BASE_URL,
  OBSE_REQUEST_TIMEOUT_MS,
  STALE_ANALYSIS_MINUTES,
  allowedHostsFrom,
  asBoolean,
  extractHeadlineFigures,
  interpretConnectionTest,
  interpretResponse,
  isAllowedBaseUrl,
  maskApiKey,
  normaliseBaseUrl,
  normaliseCustomerType,
  selectDocuments,
  storableBody,
  suggestCustomerType,
  type ConnectionTestResult,
  type CustomerType,
} from './obse.logic';
import {
  normaliseOverrides,
  recalculateAffordability,
  unknownOverrideIds,
  type AnalysisForRecalculation,
  type Overrides,
} from './affordability.calc';

export const OBSE_SETTING_KEYS = {
  ENABLED: 'obse_enabled',
  API_KEY: 'obse_api_key',
  BASE_URL: 'obse_base_url',
} as const;

export type KeySource = 'organization' | 'environment' | null;

export interface ResolvedObseConfig {
  enabled: boolean;
  apiKey: string | null;
  keySource: KeySource;
  /** The organization's own base URL, as saved - null when not set. */
  configuredBaseUrl: string | null;
  /** The base URL requests actually go to. */
  baseUrl: string;
  /** A stored key that can no longer be decrypted. */
  keyUnreadable: boolean;
  /** Enabled, and holding a key that can be used. */
  active: boolean;
}

export interface PublicObseSettings {
  enabled: boolean;
  active: boolean;
  hasApiKey: boolean;
  apiKeyHint: string | null;
  keySource: KeySource;
  keyUnreadable: boolean;
  baseUrl: string | null;
  effectiveBaseUrl: string;
  defaultBaseUrl: string;
  allowedHosts: string[];
  /** Whether a saved key is encrypted at rest in this deployment. */
  encryptedAtRest: boolean;
}

export interface UpdateObseSettingsInput {
  enabled?: boolean;
  /** A new key; `null` removes the organization's key. Omitted = unchanged. */
  apiKey?: string | null;
  /** `null` or empty returns to the default. Omitted = unchanged. */
  baseUrl?: string | null;
}

export interface RequestAnalysisInput {
  organizationId: string;
  clientId: string;
  userId: string;
  statementDocumentIds: string[];
  payslipDocumentIds: string[];
  customerType?: string;
  pdfPassword?: string;
}

/** Everything about an analysis except the (large) response body. */
const ANALYSIS_LIST_SELECT = {
  id: true,
  organizationId: true,
  clientId: true,
  status: true,
  provider: true,
  statementDocumentIds: true,
  payslipDocumentIds: true,
  customerType: true,
  referenceNumber: true,
  httpStatus: true,
  durationMs: true,
  monthlyIncome: true,
  monthlyExpenses: true,
  disposableIncome: true,
  suggestedRepayment: true,
  primaryMonthlySalary: true,
  incomeVolatility: true,
  fraudFindingsCount: true,
  bankName: true,
  statementFrom: true,
  statementTo: true,
  statementMonths: true,
  policyVersion: true,
  errorMessage: true,
  errorCode: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  adjustedAt: true,
  requestedBy: { select: { id: true, firstName: true, lastName: true } },
  adjustedBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.BankStatementAnalysisSelect;

/**
 * One connection pool for OBSE, with its waits set by us.
 *
 * Node's built-in fetch stops waiting for response headers after five
 * minutes, and OBSE can take longer than that to finish reading a long
 * statement. The AbortController in `callObse` is the real limit; these are
 * set just above it so they never cut in first.
 */
const obseAgent = new Agent({
  headersTimeout: OBSE_REQUEST_TIMEOUT_MS + 30_000,
  bodyTimeout: OBSE_REQUEST_TIMEOUT_MS + 30_000,
  connectTimeout: 30_000,
});

const decimal = (value: number | null) =>
  value === null ? null : new Prisma.Decimal(value.toFixed(2));

export class ObseService {
  // ---------------------------------------------------------------- config
  private allowedHosts(): string[] {
    return allowedHostsFrom(process.env.OBSE_ALLOWED_HOSTS);
  }

  private environmentBaseUrl(): string {
    return normaliseBaseUrl(process.env.OBSE_BASE_URL) ?? OBSE_DEFAULT_BASE_URL;
  }

  /**
   * Work out which key and which URL this organization's requests use.
   *
   * The organization's own key comes first. Without one, the deployment's
   * OBSE_API_KEY is used - but only ever with the deployment's own base URL.
   * An organization administrator can change the base URL; if the shared key
   * followed that setting, changing it would be a way to read the key.
   */
  async resolveConfig(organizationId: string): Promise<ResolvedObseConfig> {
    const rows = await prisma.organizationSettings.findMany({
      where: {
        organizationId,
        settingKey: { in: Object.values(OBSE_SETTING_KEYS) },
      },
      select: { settingKey: true, settingValue: true },
    });
    const values = new Map(rows.map(row => [row.settingKey, row.settingValue]));

    const enabled = asBoolean(values.get(OBSE_SETTING_KEYS.ENABLED));

    const storedKey = values.get(OBSE_SETTING_KEYS.API_KEY);
    let organizationKey: string | null = null;
    let keyUnreadable = false;
    if (typeof storedKey === 'string' && storedKey) {
      try {
        const decrypted = encryptionService.decrypt(storedKey);
        // Still in its encrypted form: stored under a master key this
        // deployment no longer has.
        if (encryptionService.isEncrypted(decrypted)) keyUnreadable = true;
        else organizationKey = decrypted;
      } catch {
        keyUnreadable = true;
      }
    }

    const configuredBaseUrl = normaliseBaseUrl(
      values.get(OBSE_SETTING_KEYS.BASE_URL)
    );

    const environmentKey = process.env.OBSE_API_KEY?.trim() || null;

    let apiKey: string | null;
    let keySource: KeySource;
    let baseUrl: string;

    if (organizationKey) {
      apiKey = organizationKey;
      keySource = 'organization';
      baseUrl =
        configuredBaseUrl &&
        isAllowedBaseUrl(configuredBaseUrl, this.allowedHosts())
          ? configuredBaseUrl
          : this.environmentBaseUrl();
    } else if (environmentKey && !keyUnreadable) {
      apiKey = environmentKey;
      keySource = 'environment';
      baseUrl = this.environmentBaseUrl();
    } else {
      apiKey = null;
      keySource = null;
      baseUrl = this.environmentBaseUrl();
    }

    return {
      enabled,
      apiKey,
      keySource,
      configuredBaseUrl,
      baseUrl,
      keyUnreadable,
      active: enabled && Boolean(apiKey),
    };
  }

  /** What the settings screen may know. Never the key. */
  async getPublicSettings(organizationId: string): Promise<PublicObseSettings> {
    const config = await this.resolveConfig(organizationId);
    return {
      enabled: config.enabled,
      active: config.active,
      hasApiKey: Boolean(config.apiKey),
      apiKeyHint: maskApiKey(config.apiKey),
      keySource: config.keySource,
      keyUnreadable: config.keyUnreadable,
      baseUrl: config.configuredBaseUrl,
      effectiveBaseUrl: config.baseUrl,
      defaultBaseUrl: this.environmentBaseUrl(),
      allowedHosts: this.allowedHosts(),
      encryptedAtRest: encryptionService.isEnabled(),
    };
  }

  /** Whether any OBSE feature should appear at all. */
  async isActive(organizationId: string): Promise<boolean> {
    return (await this.resolveConfig(organizationId)).active;
  }

  private validateApiKey(apiKey: string): string {
    const trimmed = apiKey.trim();
    if (trimmed.length < 16 || trimmed.length > 512 || /\s/.test(trimmed)) {
      throw new AnalysisRequestError(
        'That does not look like an OBSE API key.',
        'INVALID_API_KEY'
      );
    }
    return trimmed;
  }

  private validateBaseUrl(baseUrl: string): string {
    const normalised = normaliseBaseUrl(baseUrl);
    if (!normalised) {
      throw new AnalysisRequestError(
        'The base URL is not a valid web address.',
        'INVALID_BASE_URL'
      );
    }
    if (!isAllowedBaseUrl(normalised, this.allowedHosts())) {
      throw new AnalysisRequestError(
        `The base URL must be an HTTPS address on ${this.allowedHosts().join(', ')}.`,
        'BASE_URL_NOT_ALLOWED'
      );
    }
    return normalised;
  }

  async updateSettings(
    organizationId: string,
    userId: string,
    input: UpdateObseSettingsInput
  ): Promise<PublicObseSettings> {
    const before = await this.resolveConfig(organizationId);

    // Validate everything before writing anything.
    const newKey =
      typeof input.apiKey === 'string' ? this.validateApiKey(input.apiKey) : undefined;
    const newBaseUrl =
      typeof input.baseUrl === 'string' && input.baseUrl.trim()
        ? this.validateBaseUrl(input.baseUrl)
        : undefined;
    const clearingKey = input.apiKey === null;
    const clearingBaseUrl =
      input.baseUrl === null ||
      (typeof input.baseUrl === 'string' && !input.baseUrl.trim());

    // Mirrors resolveConfig: the shared key stands in only when the
    // organization has no key of its own, not when its own key is unreadable.
    const organizationKeyAfter =
      newKey !== undefined ||
      (!clearingKey && before.keySource === 'organization');
    const unreadableKeyRemains =
      before.keyUnreadable && !clearingKey && newKey === undefined;
    const willHaveKey =
      organizationKeyAfter ||
      (Boolean(process.env.OBSE_API_KEY?.trim()) && !unreadableKeyRemains);
    const willBeEnabled = input.enabled ?? before.enabled;
    if (willBeEnabled && !willHaveKey) {
      throw new AnalysisRequestError(
        'Add an API key before activating OBSE.',
        'API_KEY_REQUIRED'
      );
    }

    const writes: Array<Promise<unknown>> = [];
    const set = (settingKey: string, settingValue: unknown, description: string) =>
      writes.push(
        settingsService.set(organizationId, {
          settingKey,
          settingValue,
          description,
          updatedBy: userId,
        })
      );

    if (input.enabled !== undefined) {
      set(OBSE_SETTING_KEYS.ENABLED, input.enabled, 'OBSE bank statement analysis is active');
    }
    if (newKey !== undefined) {
      set(
        OBSE_SETTING_KEYS.API_KEY,
        encryptionService.encrypt(newKey, { organizationId }),
        'OBSE API key'
      );
    }
    if (newBaseUrl !== undefined) {
      set(OBSE_SETTING_KEYS.BASE_URL, newBaseUrl, 'OBSE base URL');
    }
    await Promise.all(writes);

    const removals: string[] = [];
    if (clearingKey) removals.push(OBSE_SETTING_KEYS.API_KEY);
    if (clearingBaseUrl) removals.push(OBSE_SETTING_KEYS.BASE_URL);
    if (removals.length) {
      await prisma.organizationSettings.deleteMany({
        where: { organizationId, settingKey: { in: removals } },
      });
    }

    const after = await this.getPublicSettings(organizationId);

    await createAuditLog({
      action: 'UPDATE',
      resource: 'obse_settings',
      resourceId: organizationId,
      userId,
      organizationId,
      previousValue: {
        enabled: before.enabled,
        keySource: before.keySource,
        baseUrl: before.configuredBaseUrl,
      },
      newValue: {
        enabled: after.enabled,
        keySource: after.keySource,
        baseUrl: after.baseUrl,
        // That it changed, and its last four characters - never the key.
        apiKeyChanged: newKey !== undefined || clearingKey,
        apiKeyHint: after.apiKeyHint,
      },
    }).catch(error =>
      console.error('OBSE settings audit log failed:', (error as Error).message)
    );

    return after;
  }

  /**
   * Check a key without analysing anything.
   *
   * `candidate` lets an administrator test a key before saving it. A candidate
   * base URL is held to the same allow-list as a saved one, and the
   * deployment's shared key is never sent to it.
   */
  async testConnection(
    organizationId: string,
    candidate: { apiKey?: string; baseUrl?: string } = {}
  ): Promise<ConnectionTestResult & { baseUrl: string; httpStatus: number | null }> {
    const config = await this.resolveConfig(organizationId);

    const candidateKey = candidate.apiKey?.trim()
      ? this.validateApiKey(candidate.apiKey)
      : null;
    const candidateBaseUrl = candidate.baseUrl?.trim()
      ? this.validateBaseUrl(candidate.baseUrl)
      : null;

    const apiKey = candidateKey ?? config.apiKey;
    if (!apiKey) {
      return {
        ok: false,
        message: 'There is no API key to test.',
        baseUrl: config.baseUrl,
        httpStatus: null,
      };
    }

    const usingSharedKey = !candidateKey && config.keySource === 'environment';
    const baseUrl = usingSharedKey
      ? config.baseUrl
      : candidateBaseUrl ?? config.baseUrl;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OBSE_CONNECTION_TEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${baseUrl}${OBSE_ANALYZE_PATH}`, {
        method: 'POST',
        headers: { 'X-API-Key': apiKey, Accept: 'application/json' },
        signal: controller.signal,
        dispatcher: obseAgent,
      });
      const body = await response.json().catch(() => null);
      return {
        ...interpretConnectionTest(response.status, body),
        baseUrl,
        httpStatus: response.status,
      };
    } catch (error) {
      const aborted = (error as Error).name === 'AbortError';
      return {
        ok: false,
        message: aborted
          ? 'OBSE did not answer in time.'
          : `Could not reach OBSE at ${baseUrl}.`,
        baseUrl,
        httpStatus: null,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  // -------------------------------------------------------------- analyses
  /**
   * Mark analyses that can no longer finish as failed.
   *
   * Analyses run inside the API process, so a restart mid-request leaves one
   * PROCESSING forever. Anything unfinished past the stale window is closed
   * off with an explanation, so it neither spins in the UI nor blocks a new
   * analysis for that client.
   */
  async failStaleAnalyses(where: Prisma.BankStatementAnalysisWhereInput) {
    const cutoff = new Date(Date.now() - STALE_ANALYSIS_MINUTES * 60_000);
    await prisma.bankStatementAnalysis.updateMany({
      where: {
        ...where,
        status: { in: IN_FLIGHT_STATUSES },
        createdAt: { lt: cutoff },
      },
      data: {
        status: ANALYSIS_STATUS.FAILED,
        errorCode: 'ABANDONED',
        errorMessage:
          'The analysis did not finish - the service may have restarted while it was running. Run it again.',
        completedAt: new Date(),
      },
    });
  }

  /** Pre-fill for the analyse form. */
  async getAnalysisDefaults(organizationId: string, clientId: string) {
    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId },
      select: { type: true, employmentStatus: true },
    });
    if (!client) {
      throw new AnalysisRequestError('Client not found.', 'CLIENT_NOT_FOUND', 404);
    }
    return { customerType: suggestCustomerType(client) };
  }

  async requestAnalysis(input: RequestAnalysisInput) {
    const config = await this.resolveConfig(input.organizationId);
    if (!config.active) {
      throw new AnalysisRequestError(
        'Bank statement analysis is not activated for this organization.',
        'OBSE_NOT_ACTIVE',
        403
      );
    }

    const client = await prisma.client.findFirst({
      where: { id: input.clientId, organizationId: input.organizationId },
      select: {
        id: true,
        clientNumber: true,
        type: true,
        employmentStatus: true,
      },
    });
    if (!client) {
      throw new AnalysisRequestError('Client not found.', 'CLIENT_NOT_FOUND', 404);
    }

    const requestedIds = [
      ...input.statementDocumentIds,
      ...input.payslipDocumentIds,
    ];
    const documents = await prisma.clientDocument.findMany({
      where: {
        id: { in: requestedIds },
        clientId: client.id,
        client: { organizationId: input.organizationId },
      },
      select: {
        id: true,
        clientId: true,
        mimeType: true,
        fileName: true,
        documentType: { select: { code: true } },
      },
    });

    const selection = selectDocuments(
      client.id,
      {
        statementDocumentIds: input.statementDocumentIds,
        payslipDocumentIds: input.payslipDocumentIds,
      },
      documents.map(doc => ({
        id: doc.id,
        clientId: doc.clientId,
        mimeType: doc.mimeType,
        fileName: doc.fileName,
        documentTypeCode: doc.documentType.code,
      }))
    );

    const customerType: CustomerType = input.customerType
      ? normaliseCustomerType(input.customerType)
      : suggestCustomerType(client);

    await this.failStaleAnalyses({ clientId: client.id });

    // One analysis at a time per client. The advisory lock makes the check and
    // the insert atomic, so a double-click cannot start two.
    const analysis = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`obse:${client.id}`}))`;

      const running = await tx.bankStatementAnalysis.findFirst({
        where: { clientId: client.id, status: { in: IN_FLIGHT_STATUSES } },
        select: { id: true },
      });
      if (running) {
        throw new AnalysisRequestError(
          'An analysis is already running for this client. Wait for it to finish before starting another.',
          'ANALYSIS_IN_PROGRESS',
          409
        );
      }

      return tx.bankStatementAnalysis.create({
        data: {
          organizationId: input.organizationId,
          clientId: client.id,
          status: ANALYSIS_STATUS.PENDING,
          statementDocumentIds: selection.statements.map(doc => doc.id),
          payslipDocumentIds: selection.payslips.map(doc => doc.id),
          customerType,
          referenceNumber: client.clientNumber,
          endpoint: `${config.baseUrl}${OBSE_ANALYZE_PATH}`,
          requestedById: input.userId,
        },
        select: ANALYSIS_LIST_SELECT,
      });
    });

    await createAuditLog({
      action: 'CREATE',
      resource: 'bank_statement_analysis',
      resourceId: analysis.id,
      userId: input.userId,
      organizationId: input.organizationId,
      newValue: {
        clientId: client.id,
        statementDocumentIds: analysis.statementDocumentIds,
        payslipDocumentIds: analysis.payslipDocumentIds,
        customerType,
        passwordSupplied: Boolean(input.pdfPassword),
      },
    }).catch(error =>
      console.error('OBSE analysis audit log failed:', (error as Error).message)
    );

    // Deliberately not awaited: the caller gets the PENDING record now and
    // polls for the result. runAnalysis never throws.
    void this.runAnalysis(analysis.id, { pdfPassword: input.pdfPassword });

    return analysis;
  }

  /**
   * Send the documents to OBSE and record whatever comes back.
   *
   * Every path ends with the record COMPLETED or FAILED and the requester
   * notified - an exception here would otherwise leave it PROCESSING until the
   * stale sweep found it.
   */
  async runAnalysis(
    analysisId: string,
    secrets: { pdfPassword?: string } = {}
  ): Promise<void> {
    const claimed = await prisma.bankStatementAnalysis
      .updateMany({
        where: { id: analysisId, status: ANALYSIS_STATUS.PENDING },
        data: { status: ANALYSIS_STATUS.PROCESSING, startedAt: new Date() },
      })
      .catch(() => ({ count: 0 }));
    if (claimed.count === 0) return;

    const analysis = await prisma.bankStatementAnalysis.findUnique({
      where: { id: analysisId },
    });
    if (!analysis) return;

    const started = Date.now();
    const fail = (errorCode: string, errorMessage: string, extra: Prisma.BankStatementAnalysisUpdateInput = {}) =>
      this.finish(analysis, {
        status: ANALYSIS_STATUS.FAILED,
        errorCode,
        errorMessage,
        durationMs: Date.now() - started,
        ...extra,
      });

    try {
      const config = await this.resolveConfig(analysis.organizationId);
      if (!config.active || !config.apiKey) {
        await fail('OBSE_NOT_ACTIVE', 'OBSE was deactivated before the analysis could run.');
        return;
      }

      const ids = [...analysis.statementDocumentIds, ...analysis.payslipDocumentIds];
      const documents = await prisma.clientDocument.findMany({
        where: { id: { in: ids }, clientId: analysis.clientId },
        select: { id: true, fileName: true, mimeType: true, storagePath: true },
      });
      const byId = new Map(documents.map(doc => [doc.id, doc]));
      if (ids.some(id => !byId.has(id))) {
        await fail('DOCUMENT_UNAVAILABLE', 'One of the documents was deleted before the analysis could run.');
        return;
      }

      const form = new FormData();
      try {
        for (const [field, fieldIds] of [
          ['statements', analysis.statementDocumentIds],
          ['payslips', analysis.payslipDocumentIds],
        ] as const) {
          for (const id of fieldIds) {
            const doc = byId.get(id)!;
            const content = await storageService.download(doc.storagePath);
            form.append(
              field,
              new Blob([new Uint8Array(content)], { type: doc.mimeType }),
              doc.fileName
            );
          }
        }
      } catch (error) {
        console.error(
          `OBSE analysis ${analysis.id}: could not read documents from storage:`,
          (error as Error).message
        );
        await fail('STORAGE_UNAVAILABLE', 'The documents could not be read from storage. Try again shortly.');
        return;
      }

      form.append('customerType', analysis.customerType);
      if (analysis.referenceNumber) form.append('referenceNumber', analysis.referenceNumber);
      if (secrets.pdfPassword) form.append('pdfPassword', secrets.pdfPassword);

      const endpoint = `${config.baseUrl}${OBSE_ANALYZE_PATH}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), OBSE_REQUEST_TIMEOUT_MS);

      let httpStatus: number;
      let rawText: string;
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'X-API-Key': config.apiKey, Accept: 'application/json' },
          body: form,
          signal: controller.signal,
          dispatcher: obseAgent,
        });
        httpStatus = response.status;
        rawText = await response.text();
      } catch (error) {
        const aborted = (error as Error).name === 'AbortError';
        console.error(
          `OBSE analysis ${analysis.id}: request failed:`,
          aborted ? 'timed out' : (error as Error).message
        );
        await fail(
          aborted ? 'TIMEOUT' : 'CONNECTION_FAILED',
          aborted
            ? `OBSE did not finish within ${Math.round(OBSE_REQUEST_TIMEOUT_MS / 60_000)} minutes.`
            : 'Could not reach OBSE. Check the connection and try again.',
          { endpoint }
        );
        return;
      } finally {
        clearTimeout(timer);
      }

      let parsed: unknown = null;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        parsed = null;
      }

      const outcome = interpretResponse(httpStatus, parsed);
      const rawResponse = storableBody(parsed, rawText) as Prisma.InputJsonValue;

      if (!outcome.ok) {
        await fail(outcome.errorCode ?? `HTTP_${httpStatus}`, outcome.errorMessage ?? 'OBSE refused the request.', {
          endpoint,
          httpStatus,
          rawResponse,
        });
        return;
      }

      const figures = extractHeadlineFigures(parsed);
      await this.finish(analysis, {
        status: ANALYSIS_STATUS.COMPLETED,
        endpoint,
        httpStatus,
        durationMs: Date.now() - started,
        rawResponse,
        errorCode: null,
        errorMessage: null,
        monthlyIncome: decimal(figures.monthlyIncome),
        monthlyExpenses: decimal(figures.monthlyExpenses),
        disposableIncome: decimal(figures.disposableIncome),
        suggestedRepayment: decimal(figures.suggestedRepayment),
        primaryMonthlySalary: decimal(figures.primaryMonthlySalary),
        incomeVolatility: figures.incomeVolatility,
        fraudFindingsCount: figures.fraudFindingsCount,
        bankName: figures.bankName,
        statementFrom: figures.statementFrom,
        statementTo: figures.statementTo,
        statementMonths: figures.statementMonths,
        policyVersion: figures.policyVersion,
      });
    } catch (error) {
      console.error(`OBSE analysis ${analysis.id}: unexpected failure:`, (error as Error).message);
      await fail('INTERNAL_ERROR', 'The analysis failed unexpectedly. Try again.').catch(() => undefined);
    }
  }

  private async finish(
    analysis: { id: string; organizationId: string; clientId: string; requestedById: string },
    data: Prisma.BankStatementAnalysisUpdateInput
  ) {
    await prisma.bankStatementAnalysis.update({
      where: { id: analysis.id },
      data: { ...data, completedAt: new Date() },
    });

    const completed = data.status === ANALYSIS_STATUS.COMPLETED;
    const client = await prisma.client
      .findUnique({
        where: { id: analysis.clientId },
        select: { firstName: true, lastName: true, businessName: true, clientNumber: true },
      })
      .catch(() => null);
    const clientName =
      client?.businessName ||
      [client?.firstName, client?.lastName].filter(Boolean).join(' ') ||
      client?.clientNumber ||
      'the client';

    await inAppNotificationService
      .notify({
        organizationId: analysis.organizationId,
        recipientId: analysis.requestedById,
        type: completed
          ? NOTIFICATION_TYPES.BANK_STATEMENT_ANALYSIS_COMPLETED
          : NOTIFICATION_TYPES.BANK_STATEMENT_ANALYSIS_FAILED,
        title: completed
          ? 'Bank statement analysis ready'
          : 'Bank statement analysis failed',
        body: completed
          ? `The bank statement analysis for ${clientName} is ready to review.`
          : `The bank statement analysis for ${clientName} failed: ${String(data.errorMessage ?? 'unknown error')}`,
        link: `/clients/${analysis.clientId}?tab=bank-statement-analysis&analysis=${analysis.id}`,
        resource: 'bank_statement_analysis',
        resourceId: analysis.id,
      })
      .catch(error =>
        console.error('OBSE analysis notification failed:', (error as Error).message)
      );
  }

  async listForClient(organizationId: string, clientId: string) {
    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId },
      select: { id: true },
    });
    if (!client) {
      throw new AnalysisRequestError('Client not found.', 'CLIENT_NOT_FOUND', 404);
    }

    await this.failStaleAnalyses({ clientId });

    const analyses = await prisma.bankStatementAnalysis.findMany({
      where: { organizationId, clientId },
      orderBy: { createdAt: 'desc' },
      select: ANALYSIS_LIST_SELECT,
    });

    return this.withDocumentNames(analyses);
  }

  async getById(organizationId: string, analysisId: string) {
    await this.failStaleAnalyses({ id: analysisId, organizationId });

    const analysis = await prisma.bankStatementAnalysis.findFirst({
      where: { id: analysisId, organizationId },
      select: {
        ...ANALYSIS_LIST_SELECT,
        endpoint: true,
        rawResponse: true,
        reviewerOverrides: true,
      },
    });
    if (!analysis) {
      throw new AnalysisRequestError('Analysis not found.', 'ANALYSIS_NOT_FOUND', 404);
    }

    const [named] = await this.withDocumentNames([analysis]);
    return named!;
  }

  /**
   * Record a reviewer's decisions on which transactions count.
   *
   * The figures are recalculated here, from the stored response, rather than
   * accepted from the browser - what is saved is always what the formula gives
   * for those decisions. Passing no overrides returns the analysis to OBSE's
   * own figures. OBSE's original response is never touched.
   */
  async saveAdjustments(
    organizationId: string,
    analysisId: string,
    userId: string,
    overrides: Overrides
  ) {
    const analysis = await prisma.bankStatementAnalysis.findFirst({
      where: { id: analysisId, organizationId },
      select: {
        id: true,
        status: true,
        rawResponse: true,
        reviewerOverrides: true,
        monthlyIncome: true,
        monthlyExpenses: true,
        disposableIncome: true,
        suggestedRepayment: true,
        primaryMonthlySalary: true,
      },
    });
    if (!analysis) {
      throw new AnalysisRequestError('Analysis not found.', 'ANALYSIS_NOT_FOUND', 404);
    }
    if (analysis.status !== ANALYSIS_STATUS.COMPLETED) {
      throw new AnalysisRequestError(
        'Only a completed analysis can be adjusted.',
        'ANALYSIS_NOT_COMPLETED',
        409
      );
    }

    const data = ((analysis.rawResponse as Record<string, unknown> | null)?.data ??
      null) as AnalysisForRecalculation | null;
    if (!data?.evidence) {
      throw new AnalysisRequestError(
        'This analysis has no transactions to adjust.',
        'NO_TRANSACTIONS',
        409
      );
    }

    const unknown = unknownOverrideIds(data, overrides);
    if (unknown.length > 0) {
      throw new AnalysisRequestError(
        `${unknown.length} of the adjusted lines are not transactions in this analysis.`,
        'UNKNOWN_TRANSACTION'
      );
    }

    const effective = normaliseOverrides(data, overrides);
    const adjusted = Object.keys(effective).length > 0;
    const figures = recalculateAffordability(data, effective);

    await prisma.bankStatementAnalysis.update({
      where: { id: analysis.id },
      data: {
        reviewerOverrides: adjusted
          ? (effective as Prisma.InputJsonValue)
          : Prisma.DbNull,
        adjustedAt: adjusted ? new Date() : null,
        adjustedBy: adjusted
          ? { connect: { id: userId } }
          : { disconnect: true },
        monthlyIncome: decimal(figures.monthlyIncome),
        monthlyExpenses: decimal(figures.monthlyExpenses),
        disposableIncome: decimal(figures.disposableIncome),
        suggestedRepayment: decimal(figures.suggestedRepayment),
        primaryMonthlySalary: decimal(figures.salary),
      },
    });

    const previousOverrides =
      (analysis.reviewerOverrides as Overrides | null) ?? {};
    await createAuditLog({
      action: 'UPDATE',
      resource: 'bank_statement_analysis',
      resourceId: analysis.id,
      userId,
      organizationId,
      previousValue: {
        adjustedLines: Object.keys(previousOverrides).length,
        monthlyIncome: analysis.monthlyIncome?.toString() ?? null,
        monthlyExpenses: analysis.monthlyExpenses?.toString() ?? null,
        disposableIncome: analysis.disposableIncome?.toString() ?? null,
        suggestedRepayment: analysis.suggestedRepayment?.toString() ?? null,
      },
      newValue: {
        adjustedLines: Object.keys(effective).length,
        overrides: effective,
        monthlyIncome: figures.monthlyIncome,
        monthlyExpenses: figures.monthlyExpenses,
        disposableIncome: figures.disposableIncome,
        suggestedRepayment: figures.suggestedRepayment,
      },
    }).catch(error =>
      console.error('OBSE adjustment audit log failed:', (error as Error).message)
    );

    return this.getById(organizationId, analysis.id);
  }

  /**
   * Put a file name beside each document id, so the list says what was
   * analysed. A document deleted since keeps its id and loses its name.
   */
  private async withDocumentNames<
    T extends { statementDocumentIds: string[]; payslipDocumentIds: string[] },
  >(analyses: T[]) {
    const ids = [
      ...new Set(
        analyses.flatMap(a => [...a.statementDocumentIds, ...a.payslipDocumentIds])
      ),
    ];
    const documents = ids.length
      ? await prisma.clientDocument.findMany({
          where: { id: { in: ids } },
          select: { id: true, fileName: true },
        })
      : [];
    const names = new Map(documents.map(doc => [doc.id, doc.fileName]));

    return analyses.map(analysis => ({
      ...analysis,
      documents: [
        ...analysis.statementDocumentIds.map(id => ({
          id,
          kind: 'BANK_STATEMENT' as const,
          fileName: names.get(id) ?? null,
        })),
        ...analysis.payslipDocumentIds.map(id => ({
          id,
          kind: 'PAYSLIP' as const,
          fileName: names.get(id) ?? null,
        })),
      ],
    }));
  }
}

export const obseService = new ObseService();

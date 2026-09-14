/**
 * OBSE - the parts that decide things.
 *
 * Pure functions, kept apart from the HTTP call and the database so each rule
 * can be tested on its own. The contract below was taken from OBSE's own
 * source and confirmed against the QA service:
 *
 *   POST {baseUrl}/api/v2/affordability/analyze
 *   Authentication: an `X-API-Key` header. The key needs the
 *     `affordability:analyze` scope, and the key's organization needs the
 *     `affordability-assessment` module switched on.
 *   Body: multipart/form-data
 *     statements     PDF, one or more - required
 *     payslips       PDF, zero or more - if sent and unreadable, the whole
 *                    analysis fails rather than quietly ignoring it
 *     customerType   salaried | non-salaried
 *     referenceNumber
 *     pdfPassword    for a password-protected statement
 *   Success:  { success: true, data: <analysis> }
 *   Failure:  { success: false, error, code?, passwordRequired? }
 *     400 no statement, 401 bad key, 403 scope/module, 422 unreadable or
 *     password needed, 502 an upstream step failed.
 *
 * OBSE is stateless - it keeps nothing - so the response is the only record of
 * the analysis there will ever be. That is why it is stored whole.
 */

export const OBSE_ANALYZE_PATH = '/api/v2/affordability/analyze';

/** The QA service, used only when nothing else is configured. */
export const OBSE_DEFAULT_BASE_URL = 'https://api.qa.obse.co.za';

/**
 * Hosts an OBSE base URL may point at.
 *
 * The base URL is editable by an organization administrator, and the request
 * sent to it carries an API key and a client's bank statements. Left open, it
 * would let anyone with settings access send both to a server of their
 * choosing, or point the API at something on its own private network. Extra
 * hosts can be allowed through OBSE_ALLOWED_HOSTS.
 */
export const OBSE_DEFAULT_ALLOWED_HOSTS = ['obse.co.za'];

export const ANALYSIS_STATUS = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;

export type AnalysisStatus =
  (typeof ANALYSIS_STATUS)[keyof typeof ANALYSIS_STATUS];

export const IN_FLIGHT_STATUSES: AnalysisStatus[] = [
  ANALYSIS_STATUS.PENDING,
  ANALYSIS_STATUS.PROCESSING,
];

export const DOCUMENT_CODES = {
  BANK_STATEMENT: 'BANK_STATEMENT',
  PAYSLIP: 'PAYSLIP',
} as const;

export const CUSTOMER_TYPES = ['salaried', 'non-salaried'] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

/**
 * OBSE's analysis reads through its own pipeline - PDF extraction, fraud
 * checks, then categorisation - and gives the last step alone 620 seconds.
 * Abandoning the request sooner would throw away an analysis OBSE was still
 * going to finish.
 */
export const OBSE_REQUEST_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * How long an analysis may sit unfinished before it is presumed lost - the API
 * restarted mid-request, say. Longer than the request timeout, so a slow but
 * live request is never marked failed underneath itself.
 */
export const STALE_ANALYSIS_MINUTES = 20;

/** A connection test posts nothing, so it has no reason to wait long. */
export const OBSE_CONNECTION_TEST_TIMEOUT_MS = 20_000;

/** OBSE reads PDFs. */
const ACCEPTED_MIME_TYPES = new Set(['application/pdf']);

// ------------------------------------------------------------------ config
/** Settings are stored as JSON, so `true`, `"true"` and 1 all count. */
export const asBoolean = (value: unknown): boolean =>
  value === true || value === 'true' || value === 1 || value === '1';

/** Trailing slashes off, so joining a path never produces `//api`. */
export function normaliseBaseUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password) return null;
    return trimmed;
  } catch {
    return null;
  }
}

/** The allowed hosts: OBSE's own domain plus anything in OBSE_ALLOWED_HOSTS. */
export function allowedHostsFrom(envValue: string | undefined): string[] {
  const extra = (envValue ?? '')
    .split(',')
    .map(host => host.trim().toLowerCase())
    .filter(Boolean);
  return [...OBSE_DEFAULT_ALLOWED_HOSTS, ...extra];
}

/**
 * Whether a base URL may be used: HTTPS, and on an allowed host or one of its
 * subdomains. `obse.co.za.attacker.net` does not match `obse.co.za`.
 */
export function isAllowedBaseUrl(
  baseUrl: string,
  allowedHosts: string[]
): boolean {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return allowedHosts.some(
    allowed => host === allowed || host.endsWith(`.${allowed}`)
  );
}

/**
 * The last four characters, and nothing more.
 *
 * Enough for an administrator to tell which key is configured; not enough to
 * be worth stealing.
 */
export function maskApiKey(key: string | null | undefined): string | null {
  if (!key) return null;
  if (key.length <= 8) return '****';
  return `****${key.slice(-4)}`;
}

// ----------------------------------------------------------- customer type
/**
 * Read a customer type the way OBSE will.
 *
 * OBSE matches free text - "self employed", "trader", "informal" all mean
 * non-salaried - and treats everything else as salaried. Normalising here, with
 * the same rule, means what is stored is what OBSE actually assessed.
 */
export function normaliseCustomerType(value: unknown): CustomerType {
  const text = String(value ?? '').toLowerCase();
  return /self|non.?salar|business|trad|informal/.test(text)
    ? 'non-salaried'
    : 'salaried';
}

/**
 * The customer type a client most likely is, from what is already on file.
 *
 * Only a suggestion for the form - the person running the analysis confirms
 * it - but it saves them choosing for every salaried client.
 */
export function suggestCustomerType(client: {
  type?: string | null;
  employmentStatus?: string | null;
}): CustomerType {
  if (client.type && client.type !== 'INDIVIDUAL') return 'non-salaried';
  if (client.employmentStatus === 'SELF_EMPLOYED') return 'non-salaried';
  return 'salaried';
}

// --------------------------------------------------------------- documents
export interface CandidateDocument {
  id: string;
  clientId: string;
  mimeType: string;
  fileName: string;
  documentTypeCode: string;
}

export interface DocumentSelection {
  statements: CandidateDocument[];
  payslips: CandidateDocument[];
}

export class AnalysisRequestError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatus = 400
  ) {
    super(message);
    this.name = 'AnalysisRequestError';
  }
}

/**
 * Check the documents chosen for an analysis, and sort them by what they are.
 *
 * Refuses before calling OBSE for anything OBSE would refuse anyway - a missing
 * statement, a non-PDF - so a doomed request does not spend a call against the
 * rate limit, or minutes of the user's time.
 */
export function selectDocuments(
  clientId: string,
  requestedIds: { statementDocumentIds: string[]; payslipDocumentIds: string[] },
  found: CandidateDocument[]
): DocumentSelection {
  const byId = new Map(found.map(doc => [doc.id, doc]));
  const statementIds = [...new Set(requestedIds.statementDocumentIds)];
  const payslipIds = [...new Set(requestedIds.payslipDocumentIds)];

  for (const id of [...statementIds, ...payslipIds]) {
    const doc = byId.get(id);
    // A document from another client, or another organization, is treated as
    // not found rather than revealed to exist.
    if (!doc || doc.clientId !== clientId) {
      throw new AnalysisRequestError(
        'One of the selected documents does not belong to this client.',
        'DOCUMENT_NOT_FOUND',
        404
      );
    }
  }

  if (statementIds.length === 0) {
    throw new AnalysisRequestError(
      'An analysis needs at least one bank statement. A payslip can be included alongside a statement, but not analysed on its own.',
      'STATEMENT_REQUIRED'
    );
  }

  const statements = statementIds.map(id => byId.get(id)!);
  const payslips = payslipIds.map(id => byId.get(id)!);

  for (const doc of statements) {
    if (doc.documentTypeCode !== DOCUMENT_CODES.BANK_STATEMENT) {
      throw new AnalysisRequestError(
        `"${doc.fileName}" is not recorded as a bank statement.`,
        'WRONG_DOCUMENT_TYPE'
      );
    }
  }

  for (const doc of payslips) {
    if (doc.documentTypeCode !== DOCUMENT_CODES.PAYSLIP) {
      throw new AnalysisRequestError(
        `"${doc.fileName}" is not recorded as a payslip.`,
        'WRONG_DOCUMENT_TYPE'
      );
    }
  }

  for (const doc of [...statements, ...payslips]) {
    if (!ACCEPTED_MIME_TYPES.has(doc.mimeType)) {
      throw new AnalysisRequestError(
        `"${doc.fileName}" is not a PDF. Bank statement analysis reads PDF documents only.`,
        'UNSUPPORTED_FILE_TYPE'
      );
    }
  }

  return { statements, payslips };
}

// ---------------------------------------------------------- the response
export interface ProviderOutcome {
  ok: boolean;
  errorMessage: string | null;
  errorCode: string | null;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/**
 * Read an OBSE response as a success or a failure, with a message a person
 * can act on.
 */
export function interpretResponse(
  httpStatus: number,
  body: unknown
): ProviderOutcome {
  const record = asRecord(body);

  if (httpStatus >= 200 && httpStatus < 300 && record.success !== false) {
    // A 200 with nothing to show is not a result.
    if (!record.data || typeof record.data !== 'object') {
      return {
        ok: false,
        errorMessage: 'OBSE replied without an analysis.',
        errorCode: 'EMPTY_RESPONSE',
      };
    }
    return { ok: true, errorMessage: null, errorCode: null };
  }

  if (record.passwordRequired === true) {
    return {
      ok: false,
      errorMessage:
        'This statement is password protected. Run the analysis again with the PDF password.',
      errorCode: 'PASSWORD_REQUIRED',
    };
  }

  const providerMessage =
    typeof record.error === 'string'
      ? record.error
      : typeof record.message === 'string'
        ? record.message
        : null;

  const providerCode =
    typeof record.code === 'string' ? record.code : `HTTP_${httpStatus}`;

  if (providerCode === 'MODULE_NOT_ENABLED') {
    return {
      ok: false,
      errorMessage:
        'Affordability assessment is not enabled on this OBSE account. Ask OBSE to enable it.',
      errorCode: providerCode,
    };
  }

  const fallback =
    httpStatus === 401 || httpStatus === 403
      ? 'OBSE rejected the API key. Check it in Organization Settings.'
      : httpStatus === 413
        ? 'The documents are too large for OBSE to accept.'
        : httpStatus === 422
          ? 'OBSE could not read this statement.'
          : httpStatus === 429
            ? 'OBSE is rate limiting requests. Try again in a few minutes.'
            : httpStatus >= 500
              ? 'OBSE had a problem processing the request. Try again shortly.'
              : `OBSE refused the request (HTTP ${httpStatus}).`;

  return {
    ok: false,
    errorMessage: providerMessage ?? fallback,
    errorCode: providerCode,
  };
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
}

/**
 * What a connection test's reply says about the key.
 *
 * The test posts an empty body. That cannot start an analysis - there is no
 * statement - so it costs nothing, and OBSE checks in a useful order: key,
 * then scope, then module, and only then asks for the statement. Being asked
 * for a statement therefore proves everything before it passed.
 */
export function interpretConnectionTest(
  httpStatus: number,
  body: unknown
): ConnectionTestResult {
  const record = asRecord(body);
  const message = typeof record.error === 'string' ? record.error : '';
  const code = typeof record.code === 'string' ? record.code : '';

  if (httpStatus === 400 && /statement/i.test(message)) {
    return {
      ok: true,
      message: 'Connected. OBSE accepted the API key.',
    };
  }

  if (code === 'MODULE_NOT_ENABLED') {
    return {
      ok: false,
      message:
        'The API key is valid, but affordability assessment is not enabled on this OBSE account.',
    };
  }

  if (code === 'INSUFFICIENT_SCOPES') {
    return {
      ok: false,
      message:
        'The API key is valid, but it is missing the affordability:analyze scope.',
    };
  }

  if (httpStatus === 401 || httpStatus === 403) {
    return { ok: false, message: 'OBSE rejected the API key.' };
  }

  if (httpStatus === 404) {
    return {
      ok: false,
      message: 'The OBSE endpoint was not found. Check the base URL.',
    };
  }

  if (httpStatus === 429) {
    return {
      ok: false,
      message: 'OBSE is rate limiting requests. Try again in a few minutes.',
    };
  }

  if (httpStatus >= 500) {
    return {
      ok: false,
      message: `OBSE is unavailable right now (HTTP ${httpStatus}).`,
    };
  }

  return {
    ok: false,
    message: message || `Unexpected reply from OBSE (HTTP ${httpStatus}).`,
  };
}

// --------------------------------------------------------------- headlines
export interface HeadlineFigures {
  monthlyIncome: number | null;
  monthlyExpenses: number | null;
  disposableIncome: number | null;
  suggestedRepayment: number | null;
  primaryMonthlySalary: number | null;
  incomeVolatility: string | null;
  fraudFindingsCount: number | null;
  bankName: string | null;
  statementFrom: string | null;
  statementTo: string | null;
  statementMonths: number | null;
  policyVersion: string | null;
}

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const text = (value: unknown, max = 255): string | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
};

/**
 * Copy the headline figures out of a successful response.
 *
 * Read from fixed paths in OBSE's schema, never searched for: a figure that is
 * missing stays null rather than being filled from some other field that
 * happened to share its name. The full response is stored either way.
 */
export function extractHeadlineFigures(body: unknown): HeadlineFigures {
  const data = asRecord(asRecord(body).data);
  const summary = asRecord(data.summary);
  const period = asRecord(data.statementPeriod);
  const details = asRecord(data.statementDetails);
  const stability = asRecord(data.incomeStability);
  const fraud = asRecord(data.fraud);

  return {
    monthlyIncome: finite(summary.totalMonthlyIncome),
    monthlyExpenses: finite(summary.totalMonthlyExpenses),
    disposableIncome: finite(summary.disposableIncome),
    suggestedRepayment: finite(summary.suggestedAffordableRepayment),
    primaryMonthlySalary: finite(summary.primaryMonthlySalary),
    incomeVolatility: text(stability.volatility, 32),
    fraudFindingsCount: Array.isArray(fraud.findings)
      ? fraud.findings.length
      : null,
    bankName: text(details.bankName),
    statementFrom: text(period.from, 64),
    statementTo: text(period.to, 64),
    statementMonths: finite(period.months),
    policyVersion: text(data.policyVersion, 64),
  };
}

/**
 * The response as stored: exactly what OBSE sent.
 *
 * A body that is not JSON (a proxy's HTML error page) is kept as text, capped,
 * so a failure can still be diagnosed from the record.
 */
export function storableBody(
  parsed: unknown,
  rawText: string
): Record<string, unknown> {
  if (parsed && typeof parsed === 'object') {
    return parsed as Record<string, unknown>;
  }
  return { unparsedBody: rawText.slice(0, 4000) };
}

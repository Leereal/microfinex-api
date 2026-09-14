import {
  AnalysisRequestError,
  allowedHostsFrom,
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
  OBSE_REQUEST_TIMEOUT_MS,
  STALE_ANALYSIS_MINUTES,
  type CandidateDocument,
} from '../src/services/obse/obse.logic';

/**
 * The rules of the OBSE integration, without the network or the database.
 *
 * The response fixtures follow OBSE's real schema (taken from its source):
 * a success is `{ success: true, data }`, a failure
 * `{ success: false, error, code?, passwordRequired? }`.
 */

const CLIENT = 'client-1';

const doc = (overrides: Partial<CandidateDocument> = {}): CandidateDocument => ({
  id: 'doc-statement',
  clientId: CLIENT,
  mimeType: 'application/pdf',
  fileName: 'statement.pdf',
  documentTypeCode: 'BANK_STATEMENT',
  ...overrides,
});

const payslip = doc({
  id: 'doc-payslip',
  fileName: 'payslip.pdf',
  documentTypeCode: 'PAYSLIP',
});

const refusal = (fn: () => unknown): AnalysisRequestError => {
  try {
    fn();
  } catch (error) {
    if (error instanceof AnalysisRequestError) return error;
    throw error;
  }
  throw new Error('expected a refusal');
};

describe('the base URL', () => {
  const allowed = allowedHostsFrom(undefined);

  it('accepts OBSE QA and production', () => {
    expect(isAllowedBaseUrl('https://api.qa.obse.co.za', allowed)).toBe(true);
    expect(isAllowedBaseUrl('https://api.obse.co.za', allowed)).toBe(true);
  });

  it('refuses a host that only starts with OBSE’s name', () => {
    expect(isAllowedBaseUrl('https://obse.co.za.attacker.net', allowed)).toBe(false);
    expect(isAllowedBaseUrl('https://notobse.co.za', allowed)).toBe(false);
  });

  it('refuses plain HTTP, even on OBSE’s domain', () => {
    expect(isAllowedBaseUrl('http://api.qa.obse.co.za', allowed)).toBe(false);
  });

  it('refuses the private network', () => {
    expect(isAllowedBaseUrl('https://169.254.169.254', allowed)).toBe(false);
    expect(isAllowedBaseUrl('https://localhost', allowed)).toBe(false);
  });

  it('allows extra hosts only when the deployment lists them', () => {
    const extended = allowedHostsFrom(' obse.example.com , ');
    expect(isAllowedBaseUrl('https://obse.example.com', extended)).toBe(true);
    expect(isAllowedBaseUrl('https://obse.example.com', allowed)).toBe(false);
  });

  it('drops trailing slashes and refuses credentials in the URL', () => {
    expect(normaliseBaseUrl('https://api.qa.obse.co.za///')).toBe('https://api.qa.obse.co.za');
    expect(normaliseBaseUrl('https://user:pw@api.qa.obse.co.za')).toBeNull();
    expect(normaliseBaseUrl('ftp://api.qa.obse.co.za')).toBeNull();
    expect(normaliseBaseUrl('')).toBeNull();
  });
});

describe('the API key hint', () => {
  it('shows the last four characters and nothing else', () => {
    const key = 'omse_19fe6faf8d9c5834ebab6fbfe0aeccba';
    const hint = maskApiKey(key)!;
    expect(hint).toBe('****ccba');
    expect(hint).not.toContain('omse_');
  });

  it('shows nothing of a key too short to hide', () => {
    expect(maskApiKey('abcdefgh')).toBe('****');
    expect(maskApiKey(null)).toBeNull();
  });
});

describe('customer type', () => {
  it('reads free text the way OBSE does', () => {
    expect(normaliseCustomerType('non-salaried')).toBe('non-salaried');
    expect(normaliseCustomerType('Self employed')).toBe('non-salaried');
    expect(normaliseCustomerType('informal trader')).toBe('non-salaried');
    expect(normaliseCustomerType('salaried')).toBe('salaried');
    expect(normaliseCustomerType(undefined)).toBe('salaried');
  });

  it('suggests non-salaried for businesses and the self-employed', () => {
    expect(suggestCustomerType({ type: 'BUSINESS' })).toBe('non-salaried');
    expect(suggestCustomerType({ type: 'INDIVIDUAL', employmentStatus: 'SELF_EMPLOYED' })).toBe('non-salaried');
    expect(suggestCustomerType({ type: 'INDIVIDUAL', employmentStatus: 'EMPLOYED' })).toBe('salaried');
  });
});

describe('choosing documents', () => {
  it('sorts statements and payslips', () => {
    const selection = selectDocuments(
      CLIENT,
      { statementDocumentIds: ['doc-statement'], payslipDocumentIds: ['doc-payslip'] },
      [doc(), payslip]
    );
    expect(selection.statements.map(d => d.id)).toEqual(['doc-statement']);
    expect(selection.payslips.map(d => d.id)).toEqual(['doc-payslip']);
  });

  it('refuses a payslip on its own - OBSE needs a statement', () => {
    const error = refusal(() =>
      selectDocuments(CLIENT, { statementDocumentIds: [], payslipDocumentIds: ['doc-payslip'] }, [payslip])
    );
    expect(error.code).toBe('STATEMENT_REQUIRED');
  });

  it('treats another client’s document as not found', () => {
    const error = refusal(() =>
      selectDocuments(
        CLIENT,
        { statementDocumentIds: ['doc-statement'], payslipDocumentIds: [] },
        [doc({ clientId: 'someone-else' })]
      )
    );
    expect(error.code).toBe('DOCUMENT_NOT_FOUND');
    expect(error.httpStatus).toBe(404);
  });

  it('refuses a document id that does not exist', () => {
    const error = refusal(() =>
      selectDocuments(CLIENT, { statementDocumentIds: ['missing'], payslipDocumentIds: [] }, [])
    );
    expect(error.code).toBe('DOCUMENT_NOT_FOUND');
  });

  it('refuses a payslip passed off as a statement', () => {
    const error = refusal(() =>
      selectDocuments(CLIENT, { statementDocumentIds: ['doc-payslip'], payslipDocumentIds: [] }, [payslip])
    );
    expect(error.code).toBe('WRONG_DOCUMENT_TYPE');
  });

  it('refuses anything that is not a PDF', () => {
    const error = refusal(() =>
      selectDocuments(
        CLIENT,
        { statementDocumentIds: ['doc-statement'], payslipDocumentIds: [] },
        [doc({ mimeType: 'image/jpeg', fileName: 'statement.jpg' })]
      )
    );
    expect(error.code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  it('sends a document once even if it was picked twice', () => {
    const selection = selectDocuments(
      CLIENT,
      { statementDocumentIds: ['doc-statement', 'doc-statement'], payslipDocumentIds: [] },
      [doc()]
    );
    expect(selection.statements).toHaveLength(1);
  });
});

describe('reading an analysis response', () => {
  it('accepts a success that carries an analysis', () => {
    expect(interpretResponse(200, { success: true, data: { summary: {} } })).toEqual({
      ok: true,
      errorMessage: null,
      errorCode: null,
    });
  });

  it('does not accept a 200 with no analysis in it', () => {
    const outcome = interpretResponse(200, { success: true });
    expect(outcome.ok).toBe(false);
    expect(outcome.errorCode).toBe('EMPTY_RESPONSE');
  });

  it('does not accept a 200 that says it failed', () => {
    const outcome = interpretResponse(200, { success: false, error: 'nope' });
    expect(outcome.ok).toBe(false);
    expect(outcome.errorMessage).toBe('nope');
  });

  it('asks for the PDF password when OBSE needs one', () => {
    const outcome = interpretResponse(422, {
      success: false,
      error: 'Password required',
      passwordRequired: true,
    });
    expect(outcome.errorCode).toBe('PASSWORD_REQUIRED');
    expect(outcome.errorMessage).toMatch(/password/i);
  });

  it('explains a module that is not switched on', () => {
    const outcome = interpretResponse(403, {
      success: false,
      code: 'MODULE_NOT_ENABLED',
      error: 'This module is not enabled for the current organization',
    });
    expect(outcome.errorCode).toBe('MODULE_NOT_ENABLED');
    expect(outcome.errorMessage).toMatch(/not enabled on this OBSE account/);
  });

  it('keeps OBSE’s own message and code', () => {
    const outcome = interpretResponse(422, {
      success: false,
      error: 'No transactions were extracted from the bank statement',
      code: 'NO_TRANSACTIONS',
    });
    expect(outcome.errorMessage).toBe('No transactions were extracted from the bank statement');
    expect(outcome.errorCode).toBe('NO_TRANSACTIONS');
  });

  it('falls back to a readable message when OBSE gives none', () => {
    expect(interpretResponse(502, null).errorMessage).toMatch(/problem processing/);
    expect(interpretResponse(429, null).errorMessage).toMatch(/rate limiting/);
    expect(interpretResponse(401, '<html>').errorMessage).toMatch(/API key/);
    expect(interpretResponse(502, null).errorCode).toBe('HTTP_502');
  });
});

describe('a connection test', () => {
  it('passes when OBSE gets as far as asking for the statement', () => {
    const result = interpretConnectionTest(400, {
      success: false,
      error: "A bank statement is required under the 'statements' field",
    });
    expect(result.ok).toBe(true);
  });

  it('fails a rejected key', () => {
    expect(interpretConnectionTest(401, { code: 'INVALID_API_KEY' }).ok).toBe(false);
    expect(interpretConnectionTest(401, { code: 'AUTH_REQUIRED' }).message).toMatch(/rejected/);
  });

  it('tells a missing scope apart from a bad key', () => {
    const result = interpretConnectionTest(403, { code: 'INSUFFICIENT_SCOPES' });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/affordability:analyze/);
  });

  it('tells a disabled module apart from a bad key', () => {
    const result = interpretConnectionTest(403, { code: 'MODULE_NOT_ENABLED' });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/not enabled/);
  });

  it('points at the base URL when the endpoint is missing', () => {
    expect(interpretConnectionTest(404, null).message).toMatch(/base URL/);
  });
});

describe('headline figures', () => {
  const analysis = {
    success: true,
    data: {
      policyVersion: '2026.09',
      customerType: 'salaried',
      statementPeriod: { from: '01/03/2026', to: '31/05/2026', months: 3, monthKeys: ['2026-03', '2026-04', '2026-05'] },
      statementDetails: { bankName: 'Capitec', accountHolder: 'J Doe', accountNumber: '123', accountType: 'Savings' },
      summary: {
        primaryMonthlySalary: 18500,
        recurringOtherIncome: 500,
        totalMonthlyIncome: 19000,
        monthlyLivingExpenses: 9000.456,
        monthlyDebtObligations: 3000,
        totalMonthlyExpenses: 12000,
        disposableIncome: -250.5,
        suggestedAffordableRepayment: 0,
        remainingSafetyCushion: 0,
        repaymentRatio: 0.3,
        payslipSalary: 0,
        excludedIncomeCount: 2,
        excludedExpenseCount: 4,
      },
      incomeStability: { volatility: 'low' },
      fraud: { hasFindings: true, findings: [{ title: 'Font mismatch' }, { title: 'Edited total' }] },
      monthlyBreakdown: [],
      evidence: {
        // A transaction's own figures must never be mistaken for the summary.
        incomeTransactions: [{ totalMonthlyIncome: 999999 }],
      },
    },
  };

  it('reads each figure from its place in the summary', () => {
    expect(extractHeadlineFigures(analysis)).toEqual({
      monthlyIncome: 19000,
      monthlyExpenses: 12000,
      disposableIncome: -250.5,
      suggestedRepayment: 0,
      primaryMonthlySalary: 18500,
      incomeVolatility: 'low',
      fraudFindingsCount: 2,
      bankName: 'Capitec',
      statementFrom: '01/03/2026',
      statementTo: '31/05/2026',
      statementMonths: 3,
      policyVersion: '2026.09',
    });
  });

  it('keeps a zero as zero rather than treating it as missing', () => {
    expect(extractHeadlineFigures(analysis).suggestedRepayment).toBe(0);
  });

  it('leaves a missing figure empty instead of guessing', () => {
    const figures = extractHeadlineFigures({ success: true, data: { summary: { totalMonthlyIncome: '19000' } } });
    // A string is not a number OBSE sends; it is not coerced.
    expect(figures.monthlyIncome).toBeNull();
    expect(figures.bankName).toBeNull();
    expect(figures.fraudFindingsCount).toBeNull();
  });

  it('copes with a body that is not an analysis at all', () => {
    expect(extractHeadlineFigures(null).monthlyIncome).toBeNull();
    expect(extractHeadlineFigures('oops').monthlyIncome).toBeNull();
  });
});

describe('what is stored', () => {
  it('stores JSON as it arrived', () => {
    const body = { success: false, error: 'x' };
    expect(storableBody(body, JSON.stringify(body))).toBe(body);
  });

  it('keeps a non-JSON reply as capped text so a failure can be diagnosed', () => {
    const stored = storableBody(null, '<html>' + 'x'.repeat(10_000));
    expect(String(stored.unparsedBody)).toHaveLength(4000);
  });
});

describe('timing', () => {
  it('waits longer than OBSE gives its own slowest step', () => {
    expect(OBSE_REQUEST_TIMEOUT_MS).toBeGreaterThan(620_000);
  });

  it('never marks a live request as abandoned', () => {
    expect(STALE_ANALYSIS_MINUTES * 60_000).toBeGreaterThan(OBSE_REQUEST_TIMEOUT_MS);
  });
});

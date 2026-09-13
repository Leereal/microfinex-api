import express from 'express';
import request from 'supertest';

/**
 * Who may read a report, and who may take one away.
 *
 * `reports:view` puts figures on a screen inside the application.
 * `reports:export` produces a file that leaves it and can be forwarded to
 * anyone, so it is a separate grant - and these assert that asking for a
 * download without it is refused rather than quietly served.
 */

/** The permissions the request under test is carrying. */
let granted: string[] = [];
/** The organization the caller belongs to; null stands for "no session". */
let organizationId: string | null = 'org-1';

jest.mock('../src/middleware/auth.middleware', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = organizationId
      ? { id: 'u1', organizationId, firstName: 'Report', lastName: 'Runner' }
      : { id: 'u1' };
    req.userContext = req.user;
    next();
  },
  requirePermission: (permission: string) => (_req: any, res: any, next: any) => {
    if (granted.includes(permission)) return next();
    res.status(403).json({
      success: false,
      message: 'Insufficient permissions',
      error: 'FORBIDDEN',
      requiredPermission: permission,
    });
  },
}));

const loanFindMany = jest.fn().mockResolvedValue([]);
const paymentFindMany = jest.fn().mockResolvedValue([]);
const loanGroupBy = jest.fn().mockResolvedValue([]);

jest.mock('../src/config/database', () => ({
  prisma: {
    loan: {
      findMany: (...a: unknown[]) => loanFindMany(...a),
      groupBy: (...a: unknown[]) => loanGroupBy(...a),
    },
    payment: { findMany: (...a: unknown[]) => paymentFindMany(...a) },
  },
}));

// Chromium is never launched in these tests; a PDF request is refused before
// it gets that far.
jest.mock('../src/services/pdf.service', () => ({
  renderHtmlToPdf: jest.fn().mockResolvedValue(Buffer.from('pdf')),
}));

import reportRoutes from '../src/routes/report.routes';

const app = express();
app.use('/reports', reportRoutes);

const ENDPOINTS = [
  '/reports/portfolio-summary',
  '/reports/par',
  '/reports/aging',
  '/reports/collections',
  '/reports/disbursements',
];

beforeEach(() => {
  granted = ['reports:view', 'reports:export'];
  organizationId = 'org-1';
});

describe('reading a report needs reports:view', () => {
  it.each(ENDPOINTS)('refuses %s without the permission', async endpoint => {
    granted = [];
    const response = await request(app).get(endpoint);
    expect(response.status).toBe(403);
    expect(response.body.error).toBe('FORBIDDEN');
  });

  it.each(ENDPOINTS)('allows %s with reports:view', async endpoint => {
    granted = ['reports:view'];
    const response = await request(app).get(endpoint);
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });
});

describe('exporting needs reports:export as well', () => {
  it.each(['csv', 'xlsx', 'pdf'])(
    'refuses a %s download when only reports:view is held',
    async format => {
      granted = ['reports:view'];
      const response = await request(app).get(
        `/reports/portfolio-summary?format=${format}`
      );
      expect(response.status).toBe(403);
      expect(response.body.requiredPermission).toBe('reports:export');
    }
  );

  it('serves a CSV when both permissions are held', async () => {
    const response = await request(app).get(
      '/reports/portfolio-summary?format=csv'
    );
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(response.headers['content-disposition']).toContain(
      'Loan-Portfolio-Summary'
    );
  });

  it('serves a spreadsheet when both permissions are held', async () => {
    const response = await request(app)
      .get('/reports/collections?format=xlsx')
      .buffer()
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(chunk as Buffer));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('spreadsheetml');
    // A real xlsx is a zip, which always starts "PK".
    expect((response.body as Buffer).subarray(0, 2).toString()).toBe('PK');
  });

  it('names the file after the report and the moment it was run', async () => {
    const response = await request(app).get('/reports/par?format=csv');
    expect(response.headers['content-disposition']).toMatch(
      /Portfolio-at-Risk-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}\.csv/
    );
  });
});

describe('exports are built from the server-side filters', () => {
  it('ignores pagination so a download carries every matching row', async () => {
    await request(app).get(
      '/reports/portfolio-summary?format=csv&page=2&pageSize=10'
    );
    // The service is called without page/pageSize, so it returns the full set
    // rather than the slice that happened to be on screen.
    const optionsUsed = loanFindMany.mock.calls.at(-1)![0];
    expect(optionsUsed.skip).toBeUndefined();
    expect(optionsUsed.take).toBeUndefined();
  });

  it('takes the organization from the session, never from the query string', async () => {
    await request(app).get(
      '/reports/portfolio-summary?organizationId=someone-elses-org'
    );
    const where = loanFindMany.mock.calls.at(-1)![0].where;
    expect(where.organizationId).toBe('org-1');
  });
});

describe('a caller with no organization', () => {
  it('is refused rather than served another book', async () => {
    organizationId = null;
    const response = await request(app).get('/reports/portfolio-summary');
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});

describe('the CSV carries its own provenance', () => {
  it('states the report, the filters and who ran it', async () => {
    const response = await request(app).get(
      '/reports/aging?format=csv&branchId=branch-9'
    );
    expect(response.text).toContain('Loan Portfolio'.slice(0, 4));
    expect(response.text).toContain('Arrears Aging Analysis');
    expect(response.text).toContain('Generated by');
    expect(response.text).toContain('Report Runner');
    expect(response.text).toContain('branch-9');
  });
});

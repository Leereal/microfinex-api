/**
 * Accounting API.
 *
 * The chart of accounts, the journal, the three statements an auditor asks for,
 * and the two runs that keep them honest - interest accrual and provisioning.
 *
 * Every read takes a currency, and defaults to none. There is no base currency
 * in this system and no conversion happens anywhere, so a trial balance without
 * a currency would be a number that was never true.
 */

import { Router } from 'express';
import { z } from 'zod';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware';
import { validateRequest, handleAsync } from '../middleware/validation.middleware';
import { prisma } from '../config/database';
import { ledgerService, LedgerError } from '../services/ledger/ledger.service';
import { ensureChartOfAccounts } from '../services/ledger/chart-of-accounts';
import { accrualService } from '../services/ledger/accrual.service';
import { provisionService } from '../services/ledger/provision.service';
import { openingBalanceService } from '../services/ledger/opening-balance.service';

const router = Router();
router.use(authenticateToken);

/** A ledger refusal is the caller's fault, not a server fault. */
function fail(res: any, error: unknown) {
  if (error instanceof LedgerError) {
    return res.status(400).json({ success: false, message: error.message });
  }
  throw error;
}

const currencyQuery = z.object({
  query: z.object({
    currency: z.string().min(1, 'A currency is required'),
    asOf: z.string().optional(),
  }),
});

// ---------------------------------------------------------------------------
// Chart of accounts
// ---------------------------------------------------------------------------

router.get(
  '/accounts',
  requirePermission('accounting:view'),
  handleAsync(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    await ensureChartOfAccounts(organizationId);

    const accounts = await prisma.chartOfAccount.findMany({
      where: { organizationId },
      orderBy: { code: 'asc' },
    });

    res.json({ success: true, data: accounts });
  })
);

const createAccountSchema = z.object({
  body: z.object({
    code: z.string().min(1).max(20),
    name: z.string().min(1).max(120),
    type: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE']),
    parentId: z.string().uuid().optional(),
    description: z.string().max(500).optional(),
  }),
});

router.post(
  '/accounts',
  requirePermission('accounting:accounts:manage'),
  validateRequest(createAccountSchema),
  handleAsync(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    await ensureChartOfAccounts(organizationId);

    const clash = await prisma.chartOfAccount.findFirst({
      where: { organizationId, code: req.body.code },
    });
    if (clash) {
      return res.status(400).json({
        success: false,
        message: `Account code ${req.body.code} is already used by "${clash.name}".`,
      });
    }

    const account = await prisma.chartOfAccount.create({
      data: { ...req.body, organizationId, isSystem: false },
    });

    res.status(201).json({ success: true, data: account });
  })
);

const updateAccountSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(500).optional(),
    isActive: z.boolean().optional(),
  }),
});

router.patch(
  '/accounts/:id',
  requirePermission('accounting:accounts:manage'),
  validateRequest(updateAccountSchema),
  handleAsync(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const existing = await prisma.chartOfAccount.findFirst({
      where: { id: req.params.id, organizationId },
    });
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, message: 'That account could not be found.' });
    }

    // A seeded account can be renamed but never switched off: the posting
    // engine resolves to it, so a disabled one would break every rule using it.
    const data = existing.isSystem
      ? { name: req.body.name, description: req.body.description }
      : req.body;

    const account = await prisma.chartOfAccount.update({
      where: { id: existing.id },
      data,
    });

    res.json({ success: true, data: account });
  })
);

router.delete(
  '/accounts/:id',
  requirePermission('accounting:accounts:manage'),
  handleAsync(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const account = await prisma.chartOfAccount.findFirst({
      where: { id: req.params.id, organizationId },
      include: { _count: { select: { journalLines: true, children: true } } },
    });

    if (!account) {
      return res
        .status(404)
        .json({ success: false, message: 'That account could not be found.' });
    }
    if (account.isSystem) {
      return res.status(400).json({
        success: false,
        message:
          'This account is part of the standard chart and the posting engine depends on it. You can rename it instead.',
      });
    }
    if (account._count.journalLines > 0) {
      return res.status(400).json({
        success: false,
        message: `${account.name} has ${account._count.journalLines} postings against it. An account that has been used cannot be deleted; switch it off instead.`,
      });
    }
    if (account._count.children > 0) {
      return res.status(400).json({
        success: false,
        message: 'Move or remove the accounts underneath this one first.',
      });
    }

    await prisma.chartOfAccount.delete({ where: { id: account.id } });
    res.json({ success: true, message: `${account.name} was deleted.` });
  })
);

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------

const journalQuery = z.object({
  query: z.object({
    currency: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    source: z.string().optional(),
    accountId: z.string().uuid().optional(),
    loanId: z.string().uuid().optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  }),
});

router.get(
  '/journal',
  requirePermission('accounting:view'),
  validateRequest(journalQuery),
  handleAsync(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const { currency, from, to, source, accountId, loanId, page, limit } =
      req.query as any;

    const where: any = { organizationId };
    if (currency) where.currency = currency;
    if (source) where.source = source;
    if (from || to) {
      where.entryDate = {};
      if (from) where.entryDate.gte = new Date(from);
      if (to) where.entryDate.lte = new Date(to);
    }
    if (accountId || loanId) {
      where.lines = { some: { ...(accountId && { accountId }), ...(loanId && { loanId }) } };
    }

    const [entries, total] = await Promise.all([
      prisma.journalEntry.findMany({
        where,
        include: {
          lines: { include: { account: { select: { code: true, name: true, type: true } } } },
          postedBy: { select: { firstName: true, lastName: true } },
        },
        orderBy: [{ entryDate: 'desc' }, { entryNumber: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.journalEntry.count({ where }),
    ]);

    res.json({
      success: true,
      data: { entries, total, page, limit, pages: Math.ceil(total / limit) },
    });
  })
);

const manualEntrySchema = z.object({
  body: z.object({
    currency: z.string().min(1),
    entryDate: z.string().optional(),
    description: z.string().min(3),
    reference: z.string().optional(),
    branchId: z.string().uuid().optional(),
    lines: z
      .array(
        z.object({
          accountId: z.string().uuid(),
          debit: z.number().min(0).optional(),
          credit: z.number().min(0).optional(),
          description: z.string().optional(),
        })
      )
      .min(2, 'A journal entry needs at least two lines'),
  }),
});

router.post(
  '/journal',
  requirePermission('accounting:post'),
  validateRequest(manualEntrySchema),
  handleAsync(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const { currency, entryDate, description, reference, branchId, lines } =
      req.body;

    try {
      const entry = await ledgerService.post({
        organizationId,
        branchId,
        currency,
        entryDate: entryDate ? new Date(entryDate) : undefined,
        description,
        reference,
        source: 'MANUAL',
        postedById: req.user!.userId,
        lines,
      });
      res.status(201).json({ success: true, data: entry });
    } catch (error) {
      return fail(res, error);
    }
  })
);

router.post(
  '/journal/:id/reverse',
  requirePermission('accounting:reverse'),
  handleAsync(async (req, res) => {
    try {
      const entry = await ledgerService.reverse(
        req.params.id!,
        req.user!.organizationId!,
        req.user!.userId,
        req.body?.reason
      );
      res.json({ success: true, data: entry });
    } catch (error) {
      return fail(res, error);
    }
  })
);

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

router.get(
  '/trial-balance',
  requirePermission('accounting:view'),
  validateRequest(currencyQuery),
  handleAsync(async (req, res) => {
    const { currency, asOf } = req.query as any;
    const data = await ledgerService.trialBalance(
      req.user!.organizationId!,
      currency,
      asOf ? new Date(asOf) : undefined
    );
    res.json({ success: true, data });
  })
);

const plQuery = z.object({
  query: z.object({
    currency: z.string().min(1),
    from: z.string().min(1),
    to: z.string().min(1),
  }),
});

router.get(
  '/profit-and-loss',
  requirePermission('accounting:view'),
  validateRequest(plQuery),
  handleAsync(async (req, res) => {
    const { currency, from, to } = req.query as any;
    const data = await ledgerService.profitAndLoss(
      req.user!.organizationId!,
      currency,
      new Date(from),
      new Date(to)
    );
    res.json({ success: true, data });
  })
);

router.get(
  '/balance-sheet',
  requirePermission('accounting:view'),
  validateRequest(currencyQuery),
  handleAsync(async (req, res) => {
    const { currency, asOf } = req.query as any;
    const data = await ledgerService.balanceSheet(
      req.user!.organizationId!,
      currency,
      asOf ? new Date(asOf) : undefined
    );
    res.json({ success: true, data });
  })
);

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

router.get(
  '/periods',
  requirePermission('accounting:view'),
  handleAsync(async (req, res) => {
    const periods = await prisma.accountingPeriod.findMany({
      where: { organizationId: req.user!.organizationId! },
      orderBy: { startDate: 'desc' },
      include: { closedBy: { select: { firstName: true, lastName: true } } },
    });
    res.json({ success: true, data: periods });
  })
);

const periodSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(60),
    startDate: z.string().min(1),
    endDate: z.string().min(1),
  }),
});

router.post(
  '/periods',
  requirePermission('accounting:periods:manage'),
  validateRequest(periodSchema),
  handleAsync(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const { name, startDate, endDate } = req.body;

    if (new Date(endDate) <= new Date(startDate)) {
      return res.status(400).json({
        success: false,
        message: 'A period has to end after it starts.',
      });
    }

    const period = await prisma.accountingPeriod.create({
      data: {
        organizationId,
        name,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
      },
    });
    res.status(201).json({ success: true, data: period });
  })
);

router.post(
  '/periods/:id/close',
  requirePermission('accounting:periods:manage'),
  handleAsync(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const period = await prisma.accountingPeriod.findFirst({
      where: { id: req.params.id, organizationId },
    });
    if (!period) {
      return res
        .status(404)
        .json({ success: false, message: 'That period could not be found.' });
    }

    const updated = await prisma.accountingPeriod.update({
      where: { id: period.id },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
        closedById: req.user!.userId,
      },
    });
    res.json({ success: true, data: updated });
  })
);

router.post(
  '/periods/:id/reopen',
  requirePermission('accounting:periods:manage'),
  handleAsync(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const period = await prisma.accountingPeriod.findFirst({
      where: { id: req.params.id, organizationId },
    });
    if (!period) {
      return res
        .status(404)
        .json({ success: false, message: 'That period could not be found.' });
    }

    const updated = await prisma.accountingPeriod.update({
      where: { id: period.id },
      data: { status: 'OPEN', closedAt: null, closedById: null },
    });
    res.json({ success: true, data: updated });
  })
);

// ---------------------------------------------------------------------------
// Runs: accrual, provisioning, opening balances
// ---------------------------------------------------------------------------

router.post(
  '/accrual/run',
  requirePermission('accounting:accrual:run'),
  handleAsync(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const asOf = req.body?.asOf ? new Date(req.body.asOf) : new Date();

    try {
      const data = req.body?.currency
        ? [
            await accrualService.run(
              organizationId,
              req.body.currency,
              req.user!.userId,
              asOf
            ),
          ]
        : await accrualService.runAll(organizationId, req.user!.userId, asOf);
      res.json({ success: true, data });
    } catch (error) {
      return fail(res, error);
    }
  })
);

router.get(
  '/provision/bands',
  requirePermission('accounting:view'),
  handleAsync(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    await provisionService.ensureBands(organizationId);
    const bands = await prisma.provisionBand.findMany({
      where: { organizationId },
      orderBy: { sortOrder: 'asc' },
    });
    res.json({ success: true, data: bands });
  })
);

const bandsSchema = z.object({
  body: z.object({
    bands: z
      .array(
        z.object({
          id: z.string().uuid().optional(),
          name: z.string().min(1).max(60),
          minDaysInArrears: z.number().int().min(0),
          maxDaysInArrears: z.number().int().min(0).nullable().optional(),
          rate: z.number().min(0).max(100),
          deductSecurity: z.boolean().default(false),
          sortOrder: z.number().int().min(0).default(0),
        })
      )
      .min(1),
  }),
});

/** Replaces the whole grid, because the bands only make sense together. */
router.put(
  '/provision/bands',
  requirePermission('accounting:provision:manage'),
  validateRequest(bandsSchema),
  handleAsync(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const { bands } = req.body;

    const sorted = [...bands].sort(
      (a: any, b: any) => a.minDaysInArrears - b.minDaysInArrears
    );
    for (let i = 0; i < sorted.length - 1; i++) {
      const current = sorted[i];
      const next = sorted[i + 1];
      if (current.maxDaysInArrears == null) {
        return res.status(400).json({
          success: false,
          message: `Only the last band may run to infinity, and "${current.name}" is not last.`,
        });
      }
      if (next.minDaysInArrears !== current.maxDaysInArrears + 1) {
        return res.status(400).json({
          success: false,
          message: `There is a gap or an overlap between "${current.name}" and "${next.name}". Every loan has to land in exactly one band.`,
        });
      }
    }

    await prisma.$transaction(async tx => {
      await tx.provisionBand.deleteMany({
        where: { organizationId, runLines: { none: {} } },
      });
      await tx.provisionBand.createMany({
        data: sorted.map((band: any, index: number) => ({
          organizationId,
          name: band.name,
          minDaysInArrears: band.minDaysInArrears,
          maxDaysInArrears: band.maxDaysInArrears ?? null,
          rate: band.rate,
          deductSecurity: band.deductSecurity,
          sortOrder: index + 1,
        })),
        skipDuplicates: true,
      });
    });

    const saved = await prisma.provisionBand.findMany({
      where: { organizationId },
      orderBy: { sortOrder: 'asc' },
    });
    res.json({ success: true, data: saved });
  })
);

router.post(
  '/provision/run',
  requirePermission('accounting:provision:run'),
  handleAsync(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const asOf = req.body?.asOf ? new Date(req.body.asOf) : new Date();

    try {
      const data = req.body?.currency
        ? [
            await provisionService.run(
              organizationId,
              req.body.currency,
              req.user!.userId,
              asOf
            ),
          ]
        : await provisionService.runAll(organizationId, req.user!.userId, asOf);
      res.json({ success: true, data });
    } catch (error) {
      return fail(res, error);
    }
  })
);

router.get(
  '/provision/runs',
  requirePermission('accounting:view'),
  handleAsync(async (req, res) => {
    const runs = await prisma.provisionRun.findMany({
      where: { organizationId: req.user!.organizationId! },
      orderBy: { asOfDate: 'desc' },
      take: 50,
      include: { runBy: { select: { firstName: true, lastName: true } } },
    });
    res.json({ success: true, data: runs });
  })
);

router.get(
  '/opening-balances',
  requirePermission('accounting:view'),
  validateRequest(
    z.object({ query: z.object({ currency: z.string().min(1) }) })
  ),
  handleAsync(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const currency = (req.query as any).currency;

    const [preview, posted] = await Promise.all([
      openingBalanceService.preview(organizationId, currency),
      openingBalanceService.alreadyPosted(organizationId, currency),
    ]);

    res.json({ success: true, data: { ...preview, alreadyPosted: posted } });
  })
);

router.post(
  '/opening-balances',
  requirePermission('accounting:opening:post'),
  validateRequest(
    z.object({
      body: z.object({
        currency: z.string().min(1),
        asOfDate: z.string().optional(),
      }),
    })
  ),
  handleAsync(async (req, res) => {
    try {
      const data = await openingBalanceService.post(
        req.user!.organizationId!,
        req.body.currency,
        req.user!.userId,
        req.body.asOfDate ? new Date(req.body.asOfDate) : undefined
      );
      res.status(201).json({ success: true, data });
    } catch (error) {
      return fail(res, error);
    }
  })
);

export default router;

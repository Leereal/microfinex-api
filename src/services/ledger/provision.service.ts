/**
 * Loan loss provisioning.
 *
 * PAR and the arrears ageing say how much of the book is late. Provisioning is
 * the step that turns that into money: an estimate of what will not be
 * collected, charged against this period's profit. Without it a lender reports
 * the same earnings whether its borrowers are paying or not, which is the
 * single most common way a loan book looks healthy right up until it doesn't.
 *
 * Bands are per organization because this is a regulatory matter and regulators
 * differ - a Kenyan tenant and a Zimbabwean one on the same installation should
 * each be able to match their own. The seeded default is the standard five-tier
 * prudential grid, which most African regulators either use or resemble.
 *
 * Like the accrual, a run is a true-up: it works out what the book should be
 * carrying and posts the difference, so running it twice changes nothing the
 * second time.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { ledgerService } from './ledger.service';

export interface ProvisionBandSeed {
  name: string;
  minDaysInArrears: number;
  maxDaysInArrears: number | null;
  rate: number;
  deductSecurity: boolean;
  sortOrder: number;
}

/**
 * The standard prudential grid. An organization can change every part of it.
 */
export const DEFAULT_BANDS: ProvisionBandSeed[] = [
  { name: 'Pass', minDaysInArrears: 0, maxDaysInArrears: 30, rate: 1, deductSecurity: false, sortOrder: 1 },
  { name: 'Special mention', minDaysInArrears: 31, maxDaysInArrears: 90, rate: 3, deductSecurity: false, sortOrder: 2 },
  { name: 'Substandard', minDaysInArrears: 91, maxDaysInArrears: 180, rate: 20, deductSecurity: true, sortOrder: 3 },
  { name: 'Doubtful', minDaysInArrears: 181, maxDaysInArrears: 360, rate: 50, deductSecurity: true, sortOrder: 4 },
  { name: 'Loss', minDaysInArrears: 361, maxDaysInArrears: null, rate: 100, deductSecurity: false, sortOrder: 5 },
];

export interface ProvisionResult {
  runId?: string;
  currency: string;
  asOfDate: Date;
  requiredProvision: number;
  previousProvision: number;
  movement: number;
  loansAssessed: number;
  entryNumber?: string;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

class ProvisionService {
  /** Give an organization the default grid if it has none. Idempotent. */
  async ensureBands(
    organizationId: string,
    client: Prisma.TransactionClient | typeof prisma = prisma
  ): Promise<void> {
    const existing = await client.provisionBand.count({
      where: { organizationId },
    });
    if (existing > 0) return;

    await client.provisionBand.createMany({
      data: DEFAULT_BANDS.map(band => ({ ...band, organizationId })),
    });
  }

  /**
   * How many days the loan's oldest unpaid instalment is overdue by.
   *
   * Measured from the earliest instalment still owing anything, which is what
   * "days in arrears" means: a borrower who missed January and paid February is
   * as far behind as the January instalment is old, not as up to date as the
   * February one suggests.
   */
  private arrearsDays(
    schedule: { dueDate: Date; outstandingAmount: Prisma.Decimal }[],
    asOf: Date
  ): number {
    const unpaid = schedule
      .filter(s => Number(s.outstandingAmount) > 0 && s.dueDate <= asOf)
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());

    if (unpaid.length === 0) return 0;
    return Math.max(0, daysBetween(unpaid[0]!.dueDate, asOf));
  }

  /**
   * Work out and post the provision for one currency as at a date.
   *
   * Exposure is principal plus accrued interest: both are amounts the book is
   * carrying as an asset, and both are at risk.
   */
  async run(
    organizationId: string,
    currency: string,
    runById: string,
    asOfDate: Date = new Date()
  ): Promise<ProvisionResult> {
    await this.ensureBands(organizationId);

    const bands = await prisma.provisionBand.findMany({
      where: { organizationId, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });

    const loans = await prisma.loan.findMany({
      where: {
        organizationId,
        currency: currency as never,
        status: { in: ['ACTIVE', 'OVERDUE'] },
      },
      select: {
        id: true,
        principalBalance: true,
        interestBalance: true,
        repaymentSchedule: {
          select: { dueDate: true, outstandingAmount: true },
        },
        collaterals: {
          where: { status: { in: ['PLEDGED', 'AVAILABLE'] } },
          select: { estimatedValue: true },
        },
      },
    });

    const lines: {
      loanId: string;
      bandId: string | null;
      daysInArrears: number;
      exposure: number;
      securityValue: number;
      provisionRate: number;
      provisionAmount: number;
    }[] = [];

    for (const loan of loans) {
      const exposure = round2(
        Number(loan.principalBalance) + Number(loan.interestBalance)
      );
      if (exposure <= 0) continue;

      const days = this.arrearsDays(loan.repaymentSchedule, asOfDate);

      const band =
        bands.find(
          b =>
            days >= b.minDaysInArrears &&
            (b.maxDaysInArrears === null || days <= b.maxDaysInArrears)
        ) ?? null;

      const rate = band ? Number(band.rate) : 0;
      const security = band?.deductSecurity
        ? round2(
            loan.collaterals.reduce(
              (sum, c) => sum + Number(c.estimatedValue),
              0
            )
          )
        : 0;

      // Security can only reduce exposure to zero, never below it.
      const netExposure = Math.max(0, round2(exposure - security));
      const provision = round2((netExposure * rate) / 100);

      lines.push({
        loanId: loan.id,
        bandId: band?.id ?? null,
        daysInArrears: days,
        exposure,
        securityValue: security,
        provisionRate: rate,
        provisionAmount: provision,
      });
    }

    const required = round2(
      lines.reduce((sum, l) => sum + l.provisionAmount, 0)
    );

    const tb = await ledgerService.trialBalance(
      organizationId,
      currency,
      asOfDate
    );
    const provisionRow = tb.rows.find(
      r => r.systemCode === 'LOAN_LOSS_PROVISION'
    );
    // The provision is a contra-asset: a credit balance is what it should have,
    // and trialBalance reports assets debit-positive, so flip the sign.
    const previous = round2(-(provisionRow?.balance ?? 0));
    const movement = round2(required - previous);

    const result: ProvisionResult = {
      currency,
      asOfDate,
      requiredProvision: required,
      previousProvision: previous,
      movement,
      loansAssessed: lines.length,
    };

    let entryId: string | undefined;

    if (movement !== 0) {
      const entry = await ledgerService.post({
        organizationId,
        currency,
        entryDate: asOfDate,
        description:
          movement > 0
            ? 'Increase in loan loss provision'
            : 'Release of loan loss provision',
        source: 'PROVISION',
        postedById: runById,
        lines:
          movement > 0
            ? [
                { account: 'IMPAIRMENT_EXPENSE', debit: movement },
                { account: 'LOAN_LOSS_PROVISION', credit: movement },
              ]
            : [
                { account: 'LOAN_LOSS_PROVISION', debit: Math.abs(movement) },
                { account: 'IMPAIRMENT_EXPENSE', credit: Math.abs(movement) },
              ],
      });
      if (entry) {
        entryId = entry.id;
        result.entryNumber = entry.entryNumber;
      }
    }

    // One run per organization, date and currency: re-running replaces it, so
    // a correction during month-end does not leave two contradictory records.
    const run = await prisma.provisionRun.upsert({
      where: {
        organizationId_asOfDate_currency: {
          organizationId,
          asOfDate,
          currency: currency as never,
        },
      },
      create: {
        organizationId,
        asOfDate,
        currency: currency as never,
        requiredProvision: required,
        previousProvision: previous,
        movement,
        loansAssessed: lines.length,
        journalEntryId: entryId ?? null,
        runById,
        lines: { create: lines },
      },
      update: {
        requiredProvision: required,
        previousProvision: previous,
        movement,
        loansAssessed: lines.length,
        journalEntryId: entryId ?? null,
        runById,
        runAt: new Date(),
        lines: { deleteMany: {}, create: lines },
      },
      select: { id: true },
    });

    result.runId = run.id;
    return result;
  }

  /** Run provisioning across every currency the organization lends in. */
  async runAll(
    organizationId: string,
    runById: string,
    asOfDate: Date = new Date()
  ): Promise<ProvisionResult[]> {
    const rows = await prisma.loan.findMany({
      where: { organizationId, status: { in: ['ACTIVE', 'OVERDUE'] } },
      select: { currency: true },
      distinct: ['currency'],
    });

    const results: ProvisionResult[] = [];
    for (const row of rows) {
      results.push(
        await this.run(organizationId, row.currency as string, runById, asOfDate)
      );
    }
    return results;
  }
}

export const provisionService = new ProvisionService();

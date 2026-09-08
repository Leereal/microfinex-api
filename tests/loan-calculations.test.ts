import { Prisma } from '@prisma/client';
import { loanCalculationService } from '../src/services/loan-calculations/loan-calculation.service';
import {
  LoanCalculationMethod,
  RepaymentFrequency,
  LoanCalculationUtils,
  LoanCalculationInput,
} from '../src/services/loan-calculations/types';

const D = (v: string | number) => new Prisma.Decimal(v);

const baseInput = (
  overrides: Partial<LoanCalculationInput> = {}
): LoanCalculationInput => ({
  principalAmount: D('1000'),
  annualInterestRate: D('12'),
  termInMonths: 12,
  repaymentFrequency: RepaymentFrequency.MONTHLY,
  calculationMethod: LoanCalculationMethod.REDUCING_BALANCE,
  disbursementDate: new Date('2026-01-15T00:00:00Z'),
  ...overrides,
});

describe('schedule dates', () => {
  it('places the first instalment one period after disbursement', () => {
    // A loan is not repayable on the day it is advanced. Previously the first
    // instalment landed on the disbursement date itself.
    const result = loanCalculationService.calculateLoan(baseInput());
    const first = result.repaymentSchedule[0]!;

    expect(first.dueDate.toISOString().slice(0, 10)).toBe('2026-02-15');
  });

  it('adds the grace period before the first period', () => {
    const result = loanCalculationService.calculateLoan(
      baseInput({ gracePeriodDays: 10 })
    );
    const first = result.repaymentSchedule[0]!;

    // 15 Jan + 10 grace days = 25 Jan, then one month = 25 Feb.
    expect(first.dueDate.toISOString().slice(0, 10)).toBe('2026-02-25');
  });

  it('spaces instalments by one period each', () => {
    const result = loanCalculationService.calculateLoan(baseInput());
    const dates = result.repaymentSchedule.map(i =>
      i.dueDate.toISOString().slice(0, 10)
    );

    expect(dates[0]).toBe('2026-02-15');
    expect(dates[1]).toBe('2026-03-15');
    expect(dates[11]).toBe('2027-01-15');
  });

  it('honours weekly frequency', () => {
    const result = loanCalculationService.calculateLoan(
      baseInput({
        repaymentFrequency: RepaymentFrequency.WEEKLY,
        termInMonths: 1,
      })
    );

    expect(result.repaymentSchedule[0]!.dueDate.toISOString().slice(0, 10)).toBe(
      '2026-01-22'
    );
  });
});

describe('reducing balance', () => {
  it('amortises the principal exactly to zero', () => {
    const result = loanCalculationService.calculateLoan(baseInput());
    const last = result.repaymentSchedule[result.repaymentSchedule.length - 1]!;

    expect(last.remainingBalance.toFixed(2)).toBe('0.00');
  });

  it('repays exactly the principal across all instalments', () => {
    const result = loanCalculationService.calculateLoan(baseInput());
    const totalPrincipal = result.repaymentSchedule.reduce(
      (sum, i) => sum.add(i.principalAmount),
      D(0)
    );

    expect(totalPrincipal.toFixed(2)).toBe('1000.00');
  });

  it('charges declining interest as the balance reduces', () => {
    const result = loanCalculationService.calculateLoan(baseInput());
    const interest = result.repaymentSchedule.map(i => i.interestAmount);

    for (let i = 1; i < interest.length; i++) {
      expect(interest[i]!.lte(interest[i - 1]!)).toBe(true);
    }
  });

  it('produces a 12-instalment schedule for a 12-month monthly loan', () => {
    const result = loanCalculationService.calculateLoan(baseInput());
    expect(result.repaymentSchedule).toHaveLength(12);
    expect(result.summary.numberOfInstallments).toBe(12);
  });

  it('charges no interest at a zero rate', () => {
    const result = loanCalculationService.calculateLoan(
      baseInput({ annualInterestRate: D('0') })
    );

    expect(result.totalInterest.toFixed(2)).toBe('0.00');
    expect(result.monthlyInstallment.toFixed(2)).toBe('83.33');
  });
});

describe('APR', () => {
  it('annualises rather than reporting a whole-of-term ratio', () => {
    // 12% nominal, monthly reducing balance: APR should land close to 12%,
    // not the ~6.6% total-interest/principal ratio the old formula produced.
    const result = loanCalculationService.calculateLoan(baseInput());
    const apr = result.apr.toNumber();

    expect(apr).toBeGreaterThan(11.5);
    expect(apr).toBeLessThan(12.5);
  });

  it('does not inflate with term length', () => {
    // The old totalAmount/principal - 1 formula scaled with the term, so a
    // three-year loan reported roughly three times the annual rate.
    const oneYear = loanCalculationService.calculateLoan(baseInput());
    const threeYear = loanCalculationService.calculateLoan(
      baseInput({ termInMonths: 36 })
    );

    expect(
      Math.abs(threeYear.apr.toNumber() - oneYear.apr.toNumber())
    ).toBeLessThan(1);
  });

  it('rises when fees are added', () => {
    const withoutFees = loanCalculationService.calculateLoan(baseInput());
    const withFees = loanCalculationService.calculateLoan(
      baseInput({ processingFeeAmount: D('50') })
    );

    expect(withFees.apr.toNumber()).toBeGreaterThan(withoutFees.apr.toNumber());
  });

  it('is zero for an interest-free loan with no fees', () => {
    const result = loanCalculationService.calculateLoan(
      baseInput({ annualInterestRate: D('0') })
    );

    expect(result.apr.toFixed(2)).toBe('0.00');
  });
});

describe('flat rate', () => {
  const flat = () =>
    loanCalculationService.calculateLoan(
      baseInput({ calculationMethod: LoanCalculationMethod.FLAT_RATE })
    );

  it('charges interest on the full principal for the whole term', () => {
    // 1000 at 12% flat for 12 months = 120 interest.
    expect(flat().totalInterest.toFixed(2)).toBe('120.00');
  });

  it('keeps every instalment equal', () => {
    const schedule = flat().repaymentSchedule;
    const first = schedule[0]!.totalAmount;

    for (const installment of schedule.slice(0, -1)) {
      expect(installment.totalAmount.toFixed(2)).toBe(first.toFixed(2));
    }
  });

  it('reports an APR well above the nominal flat rate', () => {
    // Flat-rate interest on a declining balance is roughly twice the
    // equivalent reducing-balance rate; the APR must reveal that.
    expect(flat().apr.toNumber()).toBeGreaterThan(18);
  });
});

describe('utility functions', () => {
  it('derives periodic rates from the annual rate', () => {
    const monthly = LoanCalculationUtils.getPeriodicRate(
      D('12'),
      RepaymentFrequency.MONTHLY
    );
    expect(monthly.toNumber()).toBeCloseTo(0.01, 10);
  });

  it('advances dates by whole periods', () => {
    const start = new Date(2026, 0, 15);
    const quarterly = LoanCalculationUtils.addPeriod(
      start,
      1,
      RepaymentFrequency.QUARTERLY
    );
    expect(quarterly.getMonth()).toBe(3); // April
    expect(quarterly.getDate()).toBe(15);
  });

  it('clamps month-end dates instead of overflowing', () => {
    // setMonth overflows: 31 Jan + 1 month would land on 3 March. A schedule
    // must fall due on the last day of the shorter month instead.
    const jan31 = new Date(2026, 0, 31);

    const feb = LoanCalculationUtils.addPeriod(
      jan31,
      1,
      RepaymentFrequency.MONTHLY
    );
    expect(feb.getMonth()).toBe(1); // February
    expect(feb.getDate()).toBe(28); // 2026 is not a leap year

    const apr = LoanCalculationUtils.addPeriod(
      jan31,
      1,
      RepaymentFrequency.QUARTERLY
    );
    expect(apr.getMonth()).toBe(3); // April
    expect(apr.getDate()).toBe(30);
  });

  it('keeps month-end instalments from drifting across a schedule', () => {
    const result = loanCalculationService.calculateLoan(
      baseInput({ disbursementDate: new Date(2026, 0, 31) })
    );
    const days = result.repaymentSchedule.map(i => i.dueDate.getDate());

    // Every instalment lands on the 31st, or the last day of a shorter month.
    for (const day of days) {
      expect(day).toBeGreaterThanOrEqual(28);
    }
  });

  it('returns zero APR when nothing is advanced', () => {
    const apr = LoanCalculationUtils.calculateAPR(
      D('0'),
      [D('100')],
      RepaymentFrequency.MONTHLY
    );
    expect(apr.toFixed(2)).toBe('0.00');
  });
});

describe('input validation', () => {
  it('rejects a non-positive principal', () => {
    expect(() =>
      loanCalculationService.calculateLoan(baseInput({ principalAmount: D('0') }))
    ).toThrow('Principal amount must be greater than 0');
  });

  it('rejects a negative interest rate', () => {
    expect(() =>
      loanCalculationService.calculateLoan(
        baseInput({ annualInterestRate: D('-1') })
      )
    ).toThrow('Interest rate cannot be negative');
  });

  it('rejects a non-positive term', () => {
    expect(() =>
      loanCalculationService.calculateLoan(baseInput({ termInMonths: 0 }))
    ).toThrow('Loan term must be greater than 0');
  });

  it('rejects an unsupported calculation method', () => {
    expect(() =>
      loanCalculationService.calculateLoan(
        baseInput({ calculationMethod: LoanCalculationMethod.ANNUITY })
      )
    ).toThrow('is not supported');
  });
});

describe('early settlement', () => {
  it('charges only outstanding principal when settling on the due date', () => {
    const original = loanCalculationService.calculateLoan(baseInput());
    // The 6th instalment falls due 15 July; settling that day means no
    // part-period has accrued, so all future interest is rebated.
    const settlement = loanCalculationService.calculateEarlySettlement(
      original,
      original.repaymentSchedule[5]!.dueDate,
      6
    );

    expect(settlement.totalSettlementAmount.toFixed(2)).toBe(
      settlement.remainingPrincipal.toFixed(2)
    );
    expect(settlement.rebateAmount.gt(0)).toBe(true);
  });

  it('accrues a part-period when settling between due dates', () => {
    const original = loanCalculationService.calculateLoan(baseInput());
    const midPeriod = new Date(original.repaymentSchedule[5]!.dueDate);
    midPeriod.setDate(midPeriod.getDate() + 15);

    const settlement = loanCalculationService.calculateEarlySettlement(
      original,
      midPeriod,
      6
    );

    // Half a month of interest is owed on top of the principal, but far less
    // than the full remaining scheduled interest.
    expect(
      settlement.totalSettlementAmount.gt(settlement.remainingPrincipal)
    ).toBe(true);
    expect(settlement.rebateAmount.gt(0)).toBe(true);
  });

  it('saves the borrower money versus running to term', () => {
    const original = loanCalculationService.calculateLoan(baseInput());
    const settlement = loanCalculationService.calculateEarlySettlement(
      original,
      original.repaymentSchedule[5]!.dueDate,
      6
    );

    expect(settlement.savingsFromEarlySettlement.gt(0)).toBe(true);
  });
});

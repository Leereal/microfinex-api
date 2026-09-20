import { z } from 'zod';
import { Currency, Prisma } from '@prisma/client';
import { prisma } from '../config/database';
const Decimal = Prisma.Decimal;
import { financialTransactionService } from './financial-transaction.service';
import { clientLimitService } from './client-limit.service';
import {
  Money,
  toMoney,
  roundMoney,
  isSettled,
  isOutstanding,
  atLeastZero,
  minMoney,
  sumMoney,
} from '../utils/money';
import { withUniqueRetry } from '../utils/db';

/**
 * How long a payment is allowed to take.
 *
 * Prisma's five-second default assumes a database next door. Recording a
 * repayment is a genuinely multi-step write - lock the loan, allocate across
 * penalty, interest and principal, write the payment, book the income against
 * each component, move the payment method balance, settle the schedule - and
 * against a hosted database every one of those steps costs a round trip of
 * roughly a third of a second. The work has been cut down to the queries it
 * actually needs; this is the headroom so a slow moment on the network does not
 * abandon a payment halfway.
 */
const PAYMENT_TRANSACTION_OPTIONS = { timeout: 20_000, maxWait: 10_000 };
import { createError } from '../middleware/error';

export interface PaymentRecord {
  id: string;
  paymentNumber: string;
  loanId: string;
  amount: number;
  principalAmount: number;
  interestAmount: number;
  penaltyAmount: number;
  type: string;
  method: string;
  status: string;
  transactionRef?: string;
  paymentDate: Date;
  receivedBy: string;
  notes?: string;
}

export interface PaymentAllocation {
  penaltyAmount: Money;
  interestAmount: Money;
  principalAmount: Money;
  /** Any part of the payment that could not be applied to a balance. */
  remainingAmount: Money;
}

export interface PaymentScheduleItem {
  id: string;
  installmentNumber: number;
  dueDate: Date;
  principalAmount: number;
  interestAmount: number;
  totalAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  status: string;
  paymentDate?: Date;
  daysOverdue?: number;
}

// Validation schemas
export const createPaymentSchema = z.object({
  loanId: z.string().uuid('Invalid loan ID'),
  amount: z.number().positive('Amount must be positive'),
  paymentMethod: z.string(), // Dynamic payment methods from database
  paymentMethodId: z
    .string()
    .uuid('Payment method ID is required for financial tracking'),
  transactionRef: z.string().optional(),
  notes: z.string().optional(),
});

export const bulkPaymentSchema = z.object({
  payments: z.array(
    z.object({
      loanId: z.string().uuid(),
      amount: z.number().positive(),
      paymentMethod: z.string(), // Dynamic payment methods from database
      paymentMethodId: z
        .string()
        .uuid('Payment method ID is required for financial tracking'),
      transactionRef: z.string().optional(),
      notes: z.string().optional(),
    })
  ),
});

export const reversePaymentSchema = z.object({
  reason: z.string().min(1, 'Reversal reason is required'),
  notes: z.string().optional(),
});

/**
 * Split a payment across the outstanding balances of a loan.
 *
 * Repayments settle in a fixed waterfall - penalties, then interest, then
 * principal - so that the lender's charges are cleared before the borrower's
 * debt is reduced. Anything left once all three are settled is returned as
 * `remainingAmount`; the caller decides whether that is an overpayment to
 * reject or a credit to hold.
 *
 * Exported as a pure function so the waterfall can be tested without a
 * database.
 */
export function allocatePayment(
  paymentAmount: Money,
  penaltyBalance: Money,
  interestBalance: Money,
  principalBalance: Money
): PaymentAllocation {
  let remainingAmount = roundMoney(paymentAmount);
  const zero = new Prisma.Decimal(0);

  const take = (balance: Money): Money => {
    if (!isOutstanding(remainingAmount) || !isOutstanding(balance)) {
      return zero;
    }
    const applied = roundMoney(minMoney(remainingAmount, balance));
    remainingAmount = remainingAmount.sub(applied);
    return applied;
  };

  const penaltyAmount = take(penaltyBalance);
  const interestAmount = take(interestBalance);
  const principalAmount = take(principalBalance);

  return {
    penaltyAmount,
    interestAmount,
    principalAmount,
    remainingAmount,
  };
}

class PaymentService {
  /**
   * Generate unique payment number
   */
  private async generatePaymentNumber(
    organizationId: string,
    client: Prisma.TransactionClient | typeof prisma = prisma
  ): Promise<string> {
    const today = new Date();
    const year = today.getFullYear().toString().slice(-2);
    const month = (today.getMonth() + 1).toString().padStart(2, '0');
    const day = today.getDate().toString().padStart(2, '0');

    // Get count of payments today
    const startOfDay = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    );
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    const count = await client.payment.count({
      where: {
        loan: {
          organizationId,
        },
        createdAt: {
          gte: startOfDay,
          lt: endOfDay,
        },
      },
    });

    // paymentNumber is uniquely indexed, so concurrent writers deriving the
    // same count will collide. Callers wrap the write in withUniqueRetry,
    // which re-derives this number on the next attempt.
    const sequence = (count + 1).toString().padStart(4, '0');
    return `PAY${year}${month}${day}${sequence}`;
  }

  /**
   * Process loan payment
   */
  async processPayment(
    paymentData: z.infer<typeof createPaymentSchema>,
    organizationId: string,
    receivedBy: string
  ): Promise<PaymentRecord> {
    // The payment record, the ledger entries, the loan balances and the
    // repayment schedule must all move together. Previously these were four
    // independent writes: a failure part-way through left a payment recorded
    // against a loan whose balance had never been reduced.
    //
    // withUniqueRetry re-runs the whole transaction if the derived payment
    // number collides with a concurrent writer.
    const { payment, loanIsCompleted, loanAmount, currency, clientId } =
      await withUniqueRetry(
        () =>
          prisma.$transaction(async tx => {
            // Lock the loan row for the duration of the transaction so two
            // concurrent payments cannot both read the same starting balance
            // and overwrite each other's deduction.
            /**
             * No ::uuid casts. These id columns are text - Prisma writes
             * `String @id @default(uuid())` as text unless told `@db.Uuid` -
             * and Postgres has no `text = uuid` operator, so casting the
             * parameter made every payment fail with "operator does not exist".
             */
            const locked = await tx.$queryRaw<Array<{ id: string }>>`
              SELECT id FROM loans
              WHERE id = ${paymentData.loanId}
                AND "organizationId" = ${organizationId}
                AND status IN ('ACTIVE', 'OVERDUE')
              FOR UPDATE
            `;

            if (locked.length === 0) {
              throw createError('Loan not found or not in active status', 404);
            }

            const loan = await tx.loan.findFirstOrThrow({
              where: { id: paymentData.loanId, organizationId },
              include: {
                product: { select: { currency: true } },
                branch: { select: { id: true } },
                client: { select: { id: true } },
              },
            });

            // Allocate payment amount (penalty, then interest, then principal)
            const allocation = this.allocatePayment(
              toMoney(paymentData.amount),
              toMoney(loan.penaltyBalance),
              toMoney(loan.interestBalance),
              toMoney(loan.principalBalance)
            );

            // Reject payments that exceed what is actually owed rather than
            // recording the full amount and quietly discarding the excess.
            if (isOutstanding(allocation.remainingAmount)) {
              const owed = sumMoney([
                toMoney(loan.penaltyBalance),
                toMoney(loan.interestBalance),
                toMoney(loan.principalBalance),
              ]);
              // A 400, not a 500: the request is wrong, the server is fine.
              throw createError(
                `Payment of ${toMoney(paymentData.amount).toFixed(2)} exceeds the ` +
                  `outstanding balance of ${owed.toFixed(2)} by ` +
                  `${allocation.remainingAmount.toFixed(2)}. ` +
                  `Record a payment of at most ${owed.toFixed(2)}.`,
                400
              );
            }

            const paymentNumber = await this.generatePaymentNumber(
              organizationId,
              tx
            );

            // Create payment record
            const created = await tx.payment.create({
              data: {
                paymentNumber,
                loanId: paymentData.loanId,
                amount: roundMoney(toMoney(paymentData.amount)),
                principalAmount: allocation.principalAmount,
                interestAmount: allocation.interestAmount,
                penaltyAmount: allocation.penaltyAmount,
                type: 'LOAN_REPAYMENT',
                // Denominated in the loan's own currency. Leaving this unset
                // fell through to Prisma's @default(USD) on Payment.currency,
                // so a ZAR book reported its collections in dollars.
                currency: loan.currency,
                method: paymentData.paymentMethod,
                status: 'COMPLETED',
                transactionRef: paymentData.transactionRef,
                paymentDate: new Date(),
                receivedBy,
                notes: paymentData.notes,
              },
            });

            // Create financial transactions for each payment component
            await financialTransactionService.recordLoanRepaymentComponents(
              organizationId,
              loan.branchId,
              paymentData.loanId,
              loan.loanNumber,
              created.id,
              {
                penaltyAmount: allocation.penaltyAmount.toNumber(),
                interestAmount: allocation.interestAmount.toNumber(),
                principalAmount: allocation.principalAmount.toNumber(),
              },
              loan.currency,
              paymentData.paymentMethodId,
              receivedBy,
              tx
            );

            // Update loan balances in decimal space
            const newPenaltyBalance = roundMoney(
              atLeastZero(
                toMoney(loan.penaltyBalance).sub(allocation.penaltyAmount)
              )
            );
            const newInterestBalance = roundMoney(
              atLeastZero(
                toMoney(loan.interestBalance).sub(allocation.interestAmount)
              )
            );
            const newPrincipalBalance = roundMoney(
              atLeastZero(
                toMoney(loan.principalBalance).sub(allocation.principalAmount)
              )
            );
            const newOutstandingBalance = sumMoney([
              newPenaltyBalance,
              newInterestBalance,
              newPrincipalBalance,
            ]);

            // Compare with tolerance: an exact `=== 0` check against
            // accumulated rounding residue would leave the loan open forever.
            const completed = isSettled(newOutstandingBalance);

            await tx.loan.update({
              where: { id: paymentData.loanId },
              data: {
                penaltyBalance: newPenaltyBalance,
                interestBalance: newInterestBalance,
                principalBalance: newPrincipalBalance,
                outstandingBalance: completed
                  ? new Prisma.Decimal(0)
                  : newOutstandingBalance,
                lastPaymentDate: new Date(),
                status: completed ? 'COMPLETED' : loan.status,
              },
            });

            // Apply the payment against the schedule using only what was
            // actually allocated, so the schedule and the loan balances stay
            // in agreement.
            await this.updateRepaymentSchedule(
              tx,
              paymentData.loanId,
              sumMoney([
                allocation.penaltyAmount,
                allocation.interestAmount,
                allocation.principalAmount,
              ])
            );

            return {
              payment: created,
              loanIsCompleted: completed,
              loanAmount: toMoney(loan.amount),
              currency: loan.currency,
              clientId: loan.clientId,
            };
          }, PAYMENT_TRANSACTION_OPTIONS),
        { field: 'paymentNumber' }
      );

    // Restoring the client's credit limit happens after the payment has
    // durably committed. It is a separate concern and a failure here must not
    // roll back a legitimately received payment.
    if (loanIsCompleted) {
      const limitResult = await clientLimitService.increaseAvailableBalance(
        clientId,
        currency,
        loanAmount.toNumber(),
        'REPAYMENT',
        paymentData.loanId
      );

      if (!limitResult.success) {
        console.warn(
          `Failed to restore client limit for completed loan ${paymentData.loanId}:`,
          limitResult.error
        );
        // Continue - the payment is processed, limit can be fixed manually
      }
    }

    return this.mapPaymentToRecord(payment as any);
  }

  /**
   * Allocate payment amount to penalty, interest, and principal
   */
  private allocatePayment(
    paymentAmount: Money,
    penaltyBalance: Money,
    interestBalance: Money,
    principalBalance: Money
  ): PaymentAllocation {
    return allocatePayment(
      paymentAmount,
      penaltyBalance,
      interestBalance,
      principalBalance
    );
  }

  /**
   * Update repayment schedule based on payment
   */
  private async updateRepaymentSchedule(
    tx: Prisma.TransactionClient,
    loanId: string,
    allocatedAmount: Money
  ): Promise<void> {
    const scheduleItems = await tx.repaymentSchedule.findMany({
      where: {
        loanId,
        outstandingAmount: {
          gt: 0,
        },
      },
      orderBy: {
        dueDate: 'asc',
      },
    });

    let remainingAmount = allocatedAmount;

    for (const item of scheduleItems) {
      if (!isOutstanding(remainingAmount)) break;

      const outstandingAmount = toMoney(item.outstandingAmount);
      const paymentForThisItem = roundMoney(
        minMoney(remainingAmount, outstandingAmount)
      );
      const newPaidAmount = roundMoney(
        toMoney(item.paidAmount).add(paymentForThisItem)
      );
      const newOutstandingAmount = roundMoney(
        atLeastZero(outstandingAmount.sub(paymentForThisItem))
      );
      const settled = isSettled(newOutstandingAmount);

      await tx.repaymentSchedule.update({
        where: { id: item.id },
        data: {
          paidAmount: newPaidAmount,
          outstandingAmount: settled
            ? new Prisma.Decimal(0)
            : newOutstandingAmount,
          status: settled ? 'COMPLETED' : 'PENDING',
          paymentDate: settled ? new Date() : item.paymentDate,
        },
      });

      remainingAmount = remainingAmount.sub(paymentForThisItem);
    }
  }

  /**
   * Get payment history for a loan
   */
  async getPaymentHistory(
    loanId: string,
    organizationId: string,
    page: number = 1,
    limit: number = 10
  ): Promise<{
    payments: any[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const skip = (page - 1) * limit;

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where: {
          loanId,
          loan: {
            organizationId,
          },
        },
        skip,
        take: limit,
        include: {
          receiver: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          reverser: { select: { firstName: true, lastName: true } },
          loan: {
            select: {
              loanNumber: true,
              client: {
                select: {
                  firstName: true,
                  lastName: true,
                },
              },
            },
          },
        },
        orderBy: {
          paymentDate: 'desc',
        },
      }),
      prisma.payment.count({
        where: {
          loanId,
          loan: {
            organizationId,
          },
        },
      }),
    ]);

    return {
      payments: payments.map(payment => {
        /**
         * Which way the money went.
         *
         * Every row used to be labelled a repayment with the amount in the
         * credit column, disbursements and top-ups included - so a loan that
         * had been paid out twice looked like a loan that had been paid off
         * twice, and the statement's "total payments received" counted money
         * the lender had handed over. Money leaving is a debit against the
         * loan; only money coming in is a credit.
         */
        const isAdvance =
          payment.type === 'LOAN_DISBURSEMENT' || payment.type === 'LOAN_TOPUP';
        const amount = parseFloat(payment.amount.toString());

        const transactionType =
          payment.type === 'LOAN_DISBURSEMENT'
            ? 'disbursement'
            : payment.type === 'LOAN_TOPUP'
              ? 'topup'
              : payment.type === 'LOAN_REPAYMENT'
                ? 'repayment'
                : payment.type.toLowerCase();

        const description =
          payment.notes ||
          (payment.type === 'LOAN_TOPUP'
            ? `Top-up on ${payment.loan?.loanNumber}`
            : payment.type === 'LOAN_DISBURSEMENT'
              ? `Disbursement of ${payment.loan?.loanNumber}`
              : `Payment for ${payment.loan?.loanNumber}`);

        return {
        id: payment.id,
        loan_id: payment.loanId,
        loan_number: payment.loan?.loanNumber,
        client_name: payment.loan?.client
          ? `${payment.loan.client.firstName} ${payment.loan.client.lastName}`
          : '',
        type: payment.type,
        transaction_type: transactionType,
        is_advance: isAdvance,
        payment_number: payment.paymentNumber,
        description,
        debit: isAdvance ? amount : 0,
        credit: isAdvance ? 0 : amount,
        amount,
        principal_amount: parseFloat(payment.principalAmount.toString()),
        interest_amount: parseFloat(payment.interestAmount.toString()),
        penalty_amount: parseFloat(payment.penaltyAmount.toString()),
        payment_method: payment.method,
        transaction_ref: payment.transactionRef,
        status:
          payment.status === 'COMPLETED'
            ? 'approved'
            : payment.status?.toLowerCase(),
        /**
         * Whether this payment still stands. A reversed payment stays in the
         * history - the client saw it taken and is entitled to see it undone -
         * but nothing may count it as money received.
         */
        is_reversed: payment.status === 'REVERSED',
        reversed_at: payment.reversedAt?.toISOString() ?? null,
        reversal_reason: payment.reversalReason ?? null,
        reversed_by_name: payment.reverser
          ? `${payment.reverser.firstName} ${payment.reverser.lastName}`
          : null,
        created_at: payment.paymentDate.toISOString(),
        payment_date: payment.paymentDate.toISOString(),
        received_by: payment.receivedBy,
        receiver_name: payment.receiver
          ? `${payment.receiver.firstName} ${payment.receiver.lastName}`
          : '',
        notes: payment.notes,
        };
      }),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get repayment schedule for a loan
   */
  async getRepaymentSchedule(
    loanId: string,
    organizationId: string
  ): Promise<PaymentScheduleItem[]> {
    const schedule = await prisma.repaymentSchedule.findMany({
      where: {
        loanId,
        loan: {
          organizationId,
        },
      },
      orderBy: {
        installmentNumber: 'asc',
      },
    });

    return schedule.map(item => ({
      id: item.id,
      installmentNumber: item.installmentNumber,
      dueDate: item.dueDate,
      principalAmount: parseFloat(item.principalAmount.toString()),
      interestAmount: parseFloat(item.interestAmount.toString()),
      totalAmount: parseFloat(item.totalAmount.toString()),
      paidAmount: parseFloat(item.paidAmount.toString()),
      outstandingAmount: parseFloat(item.outstandingAmount.toString()),
      status: item.status,
      paymentDate: item.paymentDate || undefined,
      daysOverdue:
        item.status === 'PENDING' && item.dueDate < new Date()
          ? Math.floor(
              (new Date().getTime() - item.dueDate.getTime()) /
                (1000 * 60 * 60 * 24)
            )
          : undefined,
    }));
  }

  /**
   * Calculate overdue amounts and penalties
   */
  async calculateOverdueAmounts(
    loanId: string,
    organizationId: string
  ): Promise<{
    overdueAmount: number;
    penaltyAmount: number;
    daysPastDue: number;
    overdueInstallments: number;
  }> {
    const loan = await prisma.loan.findFirst({
      where: {
        id: loanId,
        organizationId,
      },
      include: {
        product: true,
        repaymentSchedule: {
          where: {
            dueDate: {
              lt: new Date(),
            },
            outstandingAmount: {
              gt: 0,
            },
          },
        },
      },
    });

    if (!loan) {
      throw new Error('Loan not found');
    }

    const today = new Date();
    let totalOverdueAmount = 0;
    let daysPastDue = 0;
    let oldestOverdueDate: Date | null = null;

    for (const item of loan.repaymentSchedule!) {
      const overdueAmount = parseFloat(item.outstandingAmount.toString());
      totalOverdueAmount += overdueAmount;

      if (!oldestOverdueDate || item.dueDate < oldestOverdueDate) {
        oldestOverdueDate = item.dueDate;
      }
    }

    if (oldestOverdueDate) {
      daysPastDue = Math.floor(
        (today.getTime() - oldestOverdueDate.getTime()) / (1000 * 60 * 60 * 24)
      );
    }

    // Calculate penalty amount
    const penaltyRate = parseFloat(loan.product!.penaltyRate.toString());
    let penaltyAmount = 0;

    if (daysPastDue > 0 && penaltyRate > 0) {
      // Simple penalty calculation: overdue amount * penalty rate * days overdue / 365
      penaltyAmount =
        (totalOverdueAmount * (penaltyRate / 100) * daysPastDue) / 365;
    }

    return {
      overdueAmount: totalOverdueAmount,
      penaltyAmount,
      daysPastDue,
      overdueInstallments: loan.repaymentSchedule!.length,
    };
  }

  /**
   * Process bulk payments
   */
  async processBulkPayments(
    paymentsData: z.infer<typeof bulkPaymentSchema>,
    organizationId: string,
    receivedBy: string
  ): Promise<{
    successful: PaymentRecord[];
    failed: Array<{ loanId: string; error: string }>;
  }> {
    const successful: PaymentRecord[] = [];
    const failed: Array<{ loanId: string; error: string }> = [];

    for (const paymentData of paymentsData.payments) {
      try {
        const payment = await this.processPayment(
          paymentData,
          organizationId,
          receivedBy
        );
        successful.push(payment);
      } catch (error) {
        failed.push({
          loanId: paymentData.loanId,
          error: (error as Error).message,
        });
      }
    }

    return { successful, failed };
  }

  /**
   * Reverse a payment
   */
  async reversePayment(
    paymentId: string,
    reversalData: z.infer<typeof reversePaymentSchema>,
    organizationId: string,
    reversedBy: string
  ): Promise<PaymentRecord> {
    // Reversal must be atomic for the same reason the original payment is:
    // restoring loan balances without cancelling the payment (or vice versa)
    // corrupts the ledger.
    const reversedPayment = await prisma.$transaction(async tx => {
      // Text columns, not uuid - see processPayment above.
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT p.id FROM payments p
        JOIN loans l ON l.id = p."loanId"
        WHERE p.id = ${paymentId}
          AND l."organizationId" = ${organizationId}
          AND p.status = 'COMPLETED'
        FOR UPDATE OF p, l
      `;

      if (locked.length === 0) {
        throw createError('Payment not found or cannot be reversed', 404);
      }

      const payment = await tx.payment.findFirstOrThrow({
        where: { id: paymentId },
        include: { loan: true },
      });

      /**
       * The reversal, as a record rather than a sentence.
       *
       * REVERSED rather than CANCELLED: a cancelled payment never took effect,
       * a reversed one did, and has had its balances restored and its income
       * voided. Who did it and why are columns now, so a reversal can be listed
       * and reported on instead of read out of a free-text notes field.
       */
      const updated = await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: 'REVERSED',
          reversedAt: new Date(),
          reversedById: reversedBy,
          reversalReason: reversalData.notes
            ? `${reversalData.reason} - ${reversalData.notes}`
            : reversalData.reason,
          notes: `${payment.notes || ''}\n\nREVERSED: ${reversalData.reason}${reversalData.notes ? ' - ' + reversalData.notes : ''}`,
        },
      });

      // Restore loan balances from the recorded components. The outstanding
      // balance is recomputed as the sum of its parts rather than by adding
      // back payment.amount, which can differ from the allocated total and
      // would otherwise leave the loan permanently out of balance.
      const loan = payment.loan;
      const penaltyBalance = roundMoney(
        toMoney(loan.penaltyBalance).add(toMoney(payment.penaltyAmount))
      );
      const interestBalance = roundMoney(
        toMoney(loan.interestBalance).add(toMoney(payment.interestAmount))
      );
      const principalBalance = roundMoney(
        toMoney(loan.principalBalance).add(toMoney(payment.principalAmount))
      );

      await tx.loan.update({
        where: { id: loan.id },
        data: {
          penaltyBalance,
          interestBalance,
          principalBalance,
          outstandingBalance: sumMoney([
            penaltyBalance,
            interestBalance,
            principalBalance,
          ]),
          // Only a loan that this payment closed should be reopened; leave any
          // other status (OVERDUE, DEFAULTED, ...) untouched.
          status: loan.status === 'COMPLETED' ? 'ACTIVE' : loan.status,
        },
      });

      // Reverse the payment's effect on the repayment schedule, newest
      // instalment first, so the schedule matches the restored balances.
      await this.reverseRepaymentSchedule(
        tx,
        loan.id,
        sumMoney([
          toMoney(payment.penaltyAmount),
          toMoney(payment.interestAmount),
          toMoney(payment.principalAmount),
        ])
      );

      // Void corresponding financial transactions and restore payment method balances
      await financialTransactionService.voidByPaymentId(
        paymentId,
        reversedBy,
        reversalData.reason,
        tx
      );

      return updated;
    }, PAYMENT_TRANSACTION_OPTIONS);

    return this.mapPaymentToRecord(reversedPayment as any);
  }

  /**
   * Roll a reversed payment back off the repayment schedule.
   *
   * Instalments are unwound in reverse due-date order — the most recently
   * satisfied instalment is the one the payment most likely settled.
   */
  private async reverseRepaymentSchedule(
    tx: Prisma.TransactionClient,
    loanId: string,
    amountToReverse: Money
  ): Promise<void> {
    const scheduleItems = await tx.repaymentSchedule.findMany({
      where: { loanId, paidAmount: { gt: 0 } },
      orderBy: { dueDate: 'desc' },
    });

    let remaining = amountToReverse;

    for (const item of scheduleItems) {
      if (!isOutstanding(remaining)) break;

      const paidAmount = toMoney(item.paidAmount);
      const reversedHere = roundMoney(minMoney(remaining, paidAmount));
      const newPaidAmount = roundMoney(atLeastZero(paidAmount.sub(reversedHere)));
      const newOutstandingAmount = roundMoney(
        atLeastZero(toMoney(item.totalAmount).sub(newPaidAmount))
      );

      await tx.repaymentSchedule.update({
        where: { id: item.id },
        data: {
          paidAmount: newPaidAmount,
          outstandingAmount: newOutstandingAmount,
          status: isSettled(newOutstandingAmount) ? 'COMPLETED' : 'PENDING',
          paymentDate: isSettled(newOutstandingAmount)
            ? item.paymentDate
            : null,
        },
      });

      remaining = remaining.sub(reversedHere);
    }
  }

  /**
   * Get payment statistics
   */
  async getPaymentStatistics(
    organizationId: string,
    branchId?: string,
    dateFrom?: Date,
    dateTo?: Date
  ): Promise<{
    totalPayments: number;
    totalAmount: number;
    averagePayment: number;
    completedPayments: number;
    cancelledPayments: number;
    paymentsByMethod: Array<{ method: string; count: number; amount: number }>;
  }> {
    const where: any = {
      loan: { organizationId },
    };

    if (branchId) {
      where.loan.branchId = branchId;
    }

    if (dateFrom || dateTo) {
      where.paymentDate = {};
      if (dateFrom) where.paymentDate.gte = dateFrom;
      if (dateTo) where.paymentDate.lte = dateTo;
    }

    const [
      totalPayments,
      completedPayments,
      cancelledPayments,
      aggregates,
      paymentsByMethod,
    ] = await Promise.all([
      prisma.payment.count({ where }),
      prisma.payment.count({ where: { ...where, status: 'COMPLETED' } }),
      prisma.payment.count({
        where: { ...where, status: { in: ['CANCELLED', 'REVERSED'] } },
      }),
      prisma.payment.aggregate({
        where,
        _sum: { amount: true },
        _avg: { amount: true },
      }),
      prisma.payment.groupBy({
        by: ['method'],
        where,
        _count: true,
        _sum: { amount: true },
      }),
    ]);

    return {
      totalPayments,
      totalAmount: parseFloat(aggregates._sum.amount?.toString() || '0'),
      averagePayment: parseFloat(aggregates._avg.amount?.toString() || '0'),
      completedPayments,
      cancelledPayments,
      paymentsByMethod: paymentsByMethod.map(item => ({
        method: item.method,
        count: item._count,
        amount: parseFloat(item._sum.amount?.toString() || '0'),
      })),
    };
  }

  /**
   * Map Prisma payment to PaymentRecord
   */
  private mapPaymentToRecord(payment: any): PaymentRecord {
    return {
      id: payment.id,
      paymentNumber: payment.paymentNumber,
      loanId: payment.loanId,
      amount: parseFloat(payment.amount.toString()),
      principalAmount: parseFloat(payment.principalAmount.toString()),
      interestAmount: parseFloat(payment.interestAmount.toString()),
      penaltyAmount: parseFloat(payment.penaltyAmount.toString()),
      type: payment.type,
      method: payment.method,
      status: payment.status,
      transactionRef: payment.transactionRef,
      paymentDate: payment.paymentDate,
      receivedBy: payment.receivedBy,
      notes: payment.notes,
    };
  }
}

export const paymentService = new PaymentService();

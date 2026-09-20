/**
 * Everything the assistant can look up.
 *
 * These read the same records the staff member could open themselves - the
 * organization comes from the run, never from the model - and return a small,
 * plainly named shape rather than raw rows: a model that is handed forty
 * columns quotes the wrong one.
 */

import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../config/database';
import { buildParReport } from '../../reports/par.report';
import { buildArrearsAging } from '../../reports/arrears-aging.report';
import { buildCollectionsReport } from '../../reports/collections.report';
import { buildPortfolioSummary } from '../../reports/portfolio-summary.report';
import { AssistantError } from '../assistant.logic';
import {
  clientName,
  daysBetween,
  isoDate,
  limitList,
  money,
  type AssistantTool,
  type ToolContext,
} from './tool-kit';

/** A client this run is allowed to see. */
async function requireClient(ctx: ToolContext, clientId: string) {
  if (ctx.clientScopeId && ctx.clientScopeId !== clientId) {
    throw new AssistantError('This conversation may only look at one client’s own record.', 'OUT_OF_SCOPE', 403);
  }
  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId: ctx.organizationId },
    include: {
      branch: { select: { id: true, name: true } },
      contacts: { select: { contactType: true, contactValue: true, isPrimary: true } },
      communicationPreference: true,
    },
  });
  if (!client) throw new AssistantError('No client with that id in this organization.', 'NOT_FOUND', 404);
  return client;
}

async function requireLoan(ctx: ToolContext, loanId: string) {
  const loan = await prisma.loan.findFirst({
    where: {
      id: loanId,
      organizationId: ctx.organizationId,
      ...(ctx.clientScopeId ? { clientId: ctx.clientScopeId } : {}),
    },
    include: {
      client: { select: { id: true, firstName: true, lastName: true, businessName: true, clientNumber: true, phone: true } },
      product: { select: { id: true, name: true } },
      branch: { select: { id: true, name: true } },
      loanOfficer: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  if (!loan) throw new AssistantError('No loan with that id in this organization.', 'NOT_FOUND', 404);
  return loan;
}

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .describe('A date as YYYY-MM-DD');

export const readTools: AssistantTool[] = [
  {
    name: 'search_clients',
    capability: 'clients.read',
    description:
      'Find clients by name, client number, phone number, email or ID number. Returns a short list with ids to use in other tools.',
    schema: z.object({
      query: z.string().min(2).describe('Name, client number, phone, email or ID number').optional(),
      branchId: z.string().uuid().optional(),
      activeOnly: z.boolean().optional().describe('Only clients who are still active. Defaults to true.'),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    summarise: args => `Search clients for “${args.query ?? 'all'}”`,
    async execute(args, ctx) {
      const query = args.query?.trim();
      const where: Prisma.ClientWhereInput = {
        organizationId: ctx.organizationId,
        ...(args.activeOnly === false ? {} : { isActive: true }),
        ...(args.branchId ? { branchId: args.branchId } : {}),
        ...(ctx.clientScopeId ? { id: ctx.clientScopeId } : {}),
        ...(query
          ? {
              OR: [
                { firstName: { contains: query, mode: 'insensitive' } },
                { lastName: { contains: query, mode: 'insensitive' } },
                { businessName: { contains: query, mode: 'insensitive' } },
                { clientNumber: { contains: query, mode: 'insensitive' } },
                { phone: { contains: query } },
                { email: { contains: query, mode: 'insensitive' } },
                { idNumber: { contains: query, mode: 'insensitive' } },
              ],
            }
          : {}),
      };

      const clients = await prisma.client.findMany({
        where,
        select: {
          id: true,
          clientNumber: true,
          firstName: true,
          lastName: true,
          businessName: true,
          phone: true,
          email: true,
          idNumber: true,
          isActive: true,
          branch: { select: { id: true, name: true } },
          _count: { select: { loans: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: (args.limit ?? 10) + 1,
      });

      return limitList(
        clients.map(client => ({
          clientId: client.id,
          clientNumber: client.clientNumber,
          name: clientName(client),
          phone: client.phone,
          email: client.email,
          idNumber: client.idNumber,
          branch: client.branch?.name ?? null,
          loans: client._count.loans,
          isActive: client.isActive,
        })),
        args.limit ?? 10,
        'clients'
      );
    },
  },

  {
    name: 'get_client',
    capability: 'clients.read',
    description:
      'Read one client in full: contact details, KYC status, documents on file and their loans.',
    schema: z.object({ clientId: z.string().uuid() }),
    summarise: args => `Open client ${args.clientId.slice(0, 8)}`,
    async execute(args, ctx) {
      const client = await requireClient(ctx, args.clientId);
      const [loans, documents] = await Promise.all([
        prisma.loan.findMany({
          where: { clientId: client.id },
          select: {
            id: true,
            loanNumber: true,
            status: true,
            amount: true,
            currency: true,
            outstandingBalance: true,
            nextDueDate: true,
            disbursedDate: true,
            product: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
        prisma.clientDocument.findMany({
          where: { clientId: client.id },
          select: {
            id: true,
            fileName: true,
            status: true,
            expiryDate: true,
            documentType: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
      ]);

      return {
        clientId: client.id,
        clientNumber: client.clientNumber,
        name: clientName(client),
        type: client.type,
        phone: client.phone,
        email: client.email,
        idType: client.idType,
        idNumber: client.idNumber,
        dateOfBirth: isoDate(client.dateOfBirth),
        address: [client.address, client.city, client.state, client.country].filter(Boolean).join(', ') || null,
        employmentStatus: client.employmentStatus,
        monthlyIncome: client.monthlyIncome ? money(client.monthlyIncome) : null,
        kycStatus: client.kycStatus,
        branch: client.branch ? { id: client.branch.id, name: client.branch.name } : null,
        isActive: client.isActive,
        optedOut: {
          email: client.communicationPreference?.emailOptOut ?? false,
          sms: client.communicationPreference?.smsOptOut ?? false,
          whatsapp: client.communicationPreference?.whatsappOptOut ?? false,
        },
        otherContacts: client.contacts.map(contact => ({
          type: contact.contactType,
          value: contact.contactValue,
          isPrimary: contact.isPrimary,
        })),
        documents: documents.map(document => ({
          documentId: document.id,
          type: document.documentType?.name ?? 'Other',
          fileName: document.fileName,
          status: document.status,
          expires: isoDate(document.expiryDate),
        })),
        loans: loans.map(loan => ({
          loanId: loan.id,
          loanNumber: loan.loanNumber,
          product: loan.product?.name ?? null,
          status: loan.status,
          amount: money(loan.amount, loan.currency),
          outstanding: money(loan.outstandingBalance, loan.currency),
          nextDueDate: isoDate(loan.nextDueDate),
          disbursedOn: isoDate(loan.disbursedDate),
        })),
      };
    },
  },

  {
    name: 'search_loans',
    // A client asking about their own account on WhatsApp may reach this,
    // scoped to their own record by the run.
    clientFacing: true,
    capability: 'loans.read',
    description:
      'List loans, optionally for one client, one branch, one status, or only those in arrears.',
    schema: z.object({
      clientId: z.string().uuid().optional(),
      branchId: z.string().uuid().optional(),
      status: z
        .enum(['PENDING', 'APPROVED', 'ACTIVE', 'OVERDUE', 'COMPLETED', 'REJECTED', 'CANCELLED', 'WRITTEN_OFF'])
        .optional(),
      overdueOnly: z.boolean().optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    summarise: args => `List loans${args.clientId ? ' for one client' : ''}${args.overdueOnly ? ' in arrears' : ''}`,
    async execute(args, ctx) {
      const loans = await prisma.loan.findMany({
        where: {
          organizationId: ctx.organizationId,
          ...(ctx.clientScopeId ? { clientId: ctx.clientScopeId } : args.clientId ? { clientId: args.clientId } : {}),
          ...(args.branchId ? { branchId: args.branchId } : {}),
          ...(args.status ? { status: args.status } : {}),
          ...(args.overdueOnly ? { status: 'OVERDUE' } : {}),
        },
        select: {
          id: true,
          loanNumber: true,
          status: true,
          amount: true,
          currency: true,
          outstandingBalance: true,
          nextDueDate: true,
          maturityDate: true,
          client: { select: { id: true, firstName: true, lastName: true, businessName: true, clientNumber: true } },
          product: { select: { name: true } },
          branch: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: (args.limit ?? 15) + 1,
      });

      return limitList(
        loans.map(loan => ({
          loanId: loan.id,
          loanNumber: loan.loanNumber,
          clientId: loan.client.id,
          client: clientName(loan.client),
          clientNumber: loan.client.clientNumber,
          product: loan.product?.name ?? null,
          branch: loan.branch?.name ?? null,
          status: loan.status,
          amount: money(loan.amount, loan.currency),
          outstanding: money(loan.outstandingBalance, loan.currency),
          nextDueDate: isoDate(loan.nextDueDate),
          maturityDate: isoDate(loan.maturityDate),
        })),
        args.limit ?? 15,
        'loans'
      );
    },
  },

  {
    name: 'get_loan',
    // A client asking about their own account on WhatsApp may reach this,
    // scoped to their own record by the run.
    clientFacing: true,
    capability: 'loans.read',
    description:
      'Read one loan in full: its terms, balances, arrears and the next few instalments.',
    schema: z.object({ loanId: z.string().uuid() }),
    summarise: args => `Open loan ${args.loanId.slice(0, 8)}`,
    async execute(args, ctx) {
      const loan = await requireLoan(ctx, args.loanId);
      const schedule = await prisma.repaymentSchedule.findMany({
        where: { loanId: loan.id },
        orderBy: { installmentNumber: 'asc' },
      });

      const today = new Date();
      const overdue = schedule.filter(
        row => row.status === 'PENDING' && row.dueDate < today && Number(row.outstandingAmount) > 0
      );
      const arrearsAmount = overdue.reduce((sum, row) => sum + Number(row.outstandingAmount), 0);
      const oldest = overdue[0];

      return {
        loanId: loan.id,
        loanNumber: loan.loanNumber,
        client: { clientId: loan.client.id, name: clientName(loan.client), clientNumber: loan.client.clientNumber },
        product: loan.product?.name ?? null,
        branch: loan.branch?.name ?? null,
        loanOfficer: loan.loanOfficer ? `${loan.loanOfficer.firstName} ${loan.loanOfficer.lastName}` : null,
        status: loan.status,
        currency: loan.currency,
        amount: money(loan.amount, loan.currency),
        interestRate: `${Number(loan.interestRate)}%`,
        term: `${loan.term} ${loan.repaymentFrequency.toLowerCase()} instalments`,
        installmentAmount: money(loan.installmentAmount, loan.currency),
        outstanding: money(loan.outstandingBalance, loan.currency),
        principalBalance: money(loan.principalBalance, loan.currency),
        interestBalance: money(loan.interestBalance, loan.currency),
        penaltyBalance: money(loan.penaltyBalance, loan.currency),
        disbursedOn: isoDate(loan.disbursedDate),
        maturityDate: isoDate(loan.maturityDate),
        nextDueDate: isoDate(loan.nextDueDate),
        arrears: {
          instalmentsOverdue: overdue.length,
          amount: money(arrearsAmount, loan.currency),
          daysOverdue: oldest ? daysBetween(today, oldest.dueDate) : 0,
        },
        upcoming: schedule
          .filter(row => Number(row.outstandingAmount) > 0)
          .slice(0, 6)
          .map(row => ({
            installment: row.installmentNumber,
            dueDate: isoDate(row.dueDate),
            due: money(row.outstandingAmount, loan.currency),
            status: row.status,
          })),
      };
    },
  },

  {
    name: 'get_loan_schedule',
    // A client asking about their own account on WhatsApp may reach this,
    // scoped to their own record by the run.
    clientFacing: true,
    capability: 'loans.read',
    description: 'The full repayment schedule for a loan, instalment by instalment.',
    schema: z.object({ loanId: z.string().uuid() }),
    summarise: args => `Repayment schedule for loan ${args.loanId.slice(0, 8)}`,
    async execute(args, ctx) {
      const loan = await requireLoan(ctx, args.loanId);
      const rows = await prisma.repaymentSchedule.findMany({
        where: { loanId: loan.id },
        orderBy: { installmentNumber: 'asc' },
      });
      return {
        loanNumber: loan.loanNumber,
        currency: loan.currency,
        instalments: rows.map(row => ({
          installment: row.installmentNumber,
          dueDate: isoDate(row.dueDate),
          principal: money(row.principalAmount),
          interest: money(row.interestAmount),
          total: money(row.totalAmount),
          paid: money(row.paidAmount),
          outstanding: money(row.outstandingAmount),
          status: row.status,
        })),
      };
    },
  },

  {
    name: 'loans_due_soon',
    capability: 'loans.read',
    description:
      'Instalments falling due within the next few days, with the client and the amount - the list to work from for reminders.',
    schema: z.object({
      days: z.number().int().min(0).max(60).describe('How many days ahead to look. 3 means the next three days.'),
      branchId: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }),
    summarise: args => `Instalments due in the next ${args.days} day(s)`,
    async execute(args, ctx) {
      const from = new Date();
      from.setHours(0, 0, 0, 0);
      const to = new Date(from);
      to.setDate(to.getDate() + args.days);
      to.setHours(23, 59, 59, 999);

      const rows = await prisma.repaymentSchedule.findMany({
        where: {
          dueDate: { gte: from, lte: to },
          status: { notIn: ['COMPLETED', 'CANCELLED', 'REVERSED', 'REFUNDED'] },
          outstandingAmount: { gt: 0 },
          loan: {
            organizationId: ctx.organizationId,
            status: { in: ['ACTIVE', 'OVERDUE'] },
            ...(args.branchId ? { branchId: args.branchId } : {}),
            ...(ctx.clientScopeId ? { clientId: ctx.clientScopeId } : {}),
          },
        },
        select: {
          id: true,
          installmentNumber: true,
          dueDate: true,
          outstandingAmount: true,
          loan: {
            select: {
              id: true,
              loanNumber: true,
              currency: true,
              client: { select: { id: true, firstName: true, lastName: true, businessName: true, phone: true, email: true } },
              branch: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { dueDate: 'asc' },
        take: (args.limit ?? 50) + 1,
      });

      return limitList(
        rows.map(row => ({
          scheduleId: row.id,
          loanId: row.loan.id,
          loanNumber: row.loan.loanNumber,
          clientId: row.loan.client.id,
          client: clientName(row.loan.client),
          phone: row.loan.client.phone,
          email: row.loan.client.email,
          branch: row.loan.branch?.name ?? null,
          installment: row.installmentNumber,
          dueDate: isoDate(row.dueDate),
          amountDue: money(row.outstandingAmount, row.loan.currency),
        })),
        args.limit ?? 50,
        'instalments'
      );
    },
  },

  {
    name: 'loans_overdue',
    capability: 'loans.read',
    description: 'Loans already in arrears, worst first, with how late they are and by how much.',
    schema: z.object({
      minDaysOverdue: z.number().int().min(1).max(3650).optional(),
      branchId: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }),
    summarise: args => `Loans overdue by ${args.minDaysOverdue ?? 1} day(s) or more`,
    async execute(args, ctx) {
      const cutoff = new Date();
      cutoff.setHours(0, 0, 0, 0);
      cutoff.setDate(cutoff.getDate() - (args.minDaysOverdue ?? 1) + 1);

      const rows = await prisma.repaymentSchedule.findMany({
        where: {
          dueDate: { lt: cutoff },
          status: { notIn: ['COMPLETED', 'CANCELLED', 'REVERSED', 'REFUNDED'] },
          outstandingAmount: { gt: 0 },
          loan: {
            organizationId: ctx.organizationId,
            status: { in: ['ACTIVE', 'OVERDUE'] },
            ...(args.branchId ? { branchId: args.branchId } : {}),
            ...(ctx.clientScopeId ? { clientId: ctx.clientScopeId } : {}),
          },
        },
        select: {
          dueDate: true,
          outstandingAmount: true,
          loan: {
            select: {
              id: true,
              loanNumber: true,
              currency: true,
              outstandingBalance: true,
              client: { select: { id: true, firstName: true, lastName: true, businessName: true, phone: true } },
              branch: { select: { name: true } },
              loanOfficer: { select: { firstName: true, lastName: true } },
            },
          },
        },
        orderBy: { dueDate: 'asc' },
        take: 500,
      });

      // One row per loan: the oldest unpaid instalment sets how late it is.
      const byLoan = new Map<string, { loan: (typeof rows)[number]['loan']; oldest: Date; amount: number }>();
      for (const row of rows) {
        const entry = byLoan.get(row.loan.id);
        const amount = Number(row.outstandingAmount);
        if (entry) {
          entry.amount += amount;
          if (row.dueDate < entry.oldest) entry.oldest = row.dueDate;
        } else {
          byLoan.set(row.loan.id, { loan: row.loan, oldest: row.dueDate, amount });
        }
      }

      const today = new Date();
      const list = [...byLoan.values()]
        .map(entry => ({
          loanId: entry.loan.id,
          loanNumber: entry.loan.loanNumber,
          clientId: entry.loan.client.id,
          client: clientName(entry.loan.client),
          phone: entry.loan.client.phone,
          branch: entry.loan.branch?.name ?? null,
          loanOfficer: entry.loan.loanOfficer
            ? `${entry.loan.loanOfficer.firstName} ${entry.loan.loanOfficer.lastName}`
            : null,
          daysOverdue: daysBetween(today, entry.oldest),
          arrears: money(entry.amount, entry.loan.currency),
          outstanding: money(entry.loan.outstandingBalance, entry.loan.currency),
        }))
        .sort((a, b) => b.daysOverdue - a.daysOverdue);

      return limitList(list, args.limit ?? 50, 'loans in arrears');
    },
  },

  {
    name: 'portfolio_summary',
    capability: 'portfolio.read',
    description:
      'The portfolio as it stands: how much is out, how many loans are running, arrears and quality, by currency.',
    schema: z.object({
      asOfDate: dateString.optional(),
      branchId: z.string().uuid().optional(),
    }),
    summarise: args => `Portfolio summary${args.asOfDate ? ` as at ${args.asOfDate}` : ''}`,
    async execute(args, ctx) {
      const report = await buildPortfolioSummary(
        {
          organizationId: ctx.organizationId,
          ...(args.branchId ? { branchId: args.branchId } : {}),
          ...(args.asOfDate ? { asOfDate: new Date(args.asOfDate) } : {}),
        },
        null
      );
      return { meta: report.meta, byCurrency: report.byCurrency, byBranch: report.breakdowns.byBranch, byStatus: report.breakdowns.byStatus, loans: report.totalRows };
    },
  },

  {
    name: 'par_report',
    capability: 'portfolio.read',
    description: 'Portfolio at risk: what share of the book is late, at 1, 7, 30, 60, 90 and 180 days.',
    schema: z.object({
      asOfDate: dateString.optional(),
      branchId: z.string().uuid().optional(),
    }),
    summarise: args => `Portfolio at risk${args.asOfDate ? ` as at ${args.asOfDate}` : ''}`,
    async execute(args, ctx) {
      const report = await buildParReport(
        {
          organizationId: ctx.organizationId,
          ...(args.branchId ? { branchId: args.branchId } : {}),
          ...(args.asOfDate ? { asOfDate: new Date(args.asOfDate) } : {}),
          pageSize: 1,
        },
        null
      );
      return { meta: report.meta, byCurrency: report.byCurrency, totalLoansAtRisk: report.totalRows };
    },
  },

  {
    name: 'arrears_aging',
    capability: 'portfolio.read',
    description: 'Arrears split into age buckets, with the worst accounts named.',
    schema: z.object({
      asOfDate: dateString.optional(),
      branchId: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    summarise: () => 'Arrears ageing',
    async execute(args, ctx) {
      const report = await buildArrearsAging(
        {
          organizationId: ctx.organizationId,
          ...(args.branchId ? { branchId: args.branchId } : {}),
          ...(args.asOfDate ? { asOfDate: new Date(args.asOfDate) } : {}),
          pageSize: args.limit ?? 10,
          sortBy: 'daysOverdue',
          sortDirection: 'desc',
        },
        null
      );
      return { meta: report.meta, byCurrency: report.byCurrency, worst: report.rows.slice(0, args.limit ?? 10) };
    },
  },

  {
    name: 'collections_report',
    capability: 'portfolio.read',
    description: 'What was collected over a period, by branch, officer or method.',
    schema: z.object({
      from: dateString,
      to: dateString,
      branchId: z.string().uuid().optional(),
      groupBy: z.enum(['branch', 'officer', 'product', 'method', 'day', 'week', 'month']).optional(),
    }),
    summarise: args => `Collections from ${args.from} to ${args.to}`,
    async execute(args, ctx) {
      const report = await buildCollectionsReport(
        {
          organizationId: ctx.organizationId,
          from: new Date(args.from),
          to: new Date(args.to),
          ...(args.branchId ? { branchId: args.branchId } : {}),
          ...(args.groupBy ? { groupBy: args.groupBy as never } : {}),
          pageSize: 1,
        },
        null
      );
      return { meta: report.meta, byCurrency: report.byCurrency, breakdown: report.breakdown, payments: report.totalRows };
    },
  },

  {
    name: 'client_messages',
    capability: 'messages.read',
    description: 'The emails, SMS and WhatsApp messages already exchanged with a client.',
    schema: z.object({
      clientId: z.string().uuid(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    summarise: () => 'Read a client’s message history',
    async execute(args, ctx) {
      await requireClient(ctx, args.clientId);
      const messages = await prisma.clientMessage.findMany({
        where: { organizationId: ctx.organizationId, clientId: args.clientId },
        select: {
          id: true,
          channel: true,
          direction: true,
          subject: true,
          body: true,
          status: true,
          createdAt: true,
          toAddress: true,
          fromAddress: true,
        },
        orderBy: { createdAt: 'desc' },
        take: args.limit ?? 15,
      });
      return {
        messages: messages.map(message => ({
          messageId: message.id,
          channel: message.channel,
          direction: message.direction,
          status: message.status,
          subject: message.subject,
          body: message.body.slice(0, 1000),
          at: message.createdAt.toISOString(),
          to: message.toAddress,
          from: message.fromAddress,
        })),
      };
    },
  },

  {
    name: 'list_loan_products',
    capability: 'loans.read',
    description: 'The loan products this organization offers, with their limits - needed before starting an application.',
    schema: z.object({ activeOnly: z.boolean().optional() }),
    summarise: () => 'List loan products',
    async execute(args, ctx) {
      const products = await prisma.loanProduct.findMany({
        where: { organizationId: ctx.organizationId, ...(args.activeOnly === false ? {} : { isActive: true }) },
        select: {
          id: true,
          name: true,
          minAmount: true,
          maxAmount: true,
          minTerm: true,
          maxTerm: true,
          interestRate: true,
          currency: true,
          repaymentFrequency: true,
          isActive: true,
        },
        orderBy: { name: 'asc' },
        take: 50,
      });
      return {
        products: products.map(product => ({
          productId: product.id,
          name: product.name,
          currency: product.currency,
          amountRange: `${money(product.minAmount)} – ${money(product.maxAmount)}`,
          termRange: `${product.minTerm} – ${product.maxTerm}`,
          interestRate: `${Number(product.interestRate)}%`,
          repaymentFrequency: product.repaymentFrequency,
          isActive: product.isActive,
        })),
      };
    },
  },

  {
    name: 'list_branches',
    capability: 'clients.read',
    description: 'The branches in this organization, with their ids.',
    schema: z.object({}),
    summarise: () => 'List branches',
    async execute(_args, ctx) {
      const branches = await prisma.branch.findMany({
        where: { organizationId: ctx.organizationId, isActive: true },
        select: { id: true, name: true, code: true, manager: { select: { firstName: true, lastName: true } } },
        orderBy: { name: 'asc' },
      });
      return {
        branches: branches.map(branch => ({
          branchId: branch.id,
          name: branch.name,
          code: branch.code,
          manager: branch.manager ? `${branch.manager.firstName} ${branch.manager.lastName}` : null,
        })),
      };
    },
  },

  {
    name: 'prepare_disbursement',
    capability: 'loans.read',
    description:
      'Check whether a loan is ready to be disbursed and return the link a member of staff opens to do it. The assistant never disburses money itself.',
    schema: z.object({ loanId: z.string().uuid() }),
    summarise: args => `Prepare the disbursement link for loan ${args.loanId.slice(0, 8)}`,
    async execute(args, ctx) {
      const loan = await requireLoan(ctx, args.loanId);
      const ready = loan.status === 'APPROVED';
      return {
        loanId: loan.id,
        loanNumber: loan.loanNumber,
        client: clientName(loan.client),
        status: loan.status,
        readyToDisburse: ready,
        amount: money(loan.amount, loan.currency),
        // The frontend opens the existing disbursement dialog from this link.
        link: `/disbursements?disburse=${loan.id}`,
        note: ready
          ? 'A member of staff with the right to disburse must open this link and confirm. The assistant cannot disburse.'
          : `This loan is ${loan.status}. It can only be disbursed once it has been approved.`,
      };
    },
  },
];

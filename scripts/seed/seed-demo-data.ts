import { randomUUID } from 'node:crypto';

import { prisma } from '../../src/config/database';
import { Manifest } from './manifest';
import { generatePersonas, makeRandom, type Persona } from './ai-personas';
import {
  amortiseFlat,
  amortiseReducing,
  addPeriod,
  daysBetween,
  penaltyFor,
  positionAfterPayments,
  ratePerPeriod,
  type Amortisation,
  type Frequency,
} from './finance';

/**
 * Seed a working demo caseload.
 *
 * Every insert is recorded in a manifest so the whole run can be undone by id;
 * nothing existing is read destructively, and nothing is deleted. Reference
 * data already in the database (products, branches, charge types, document
 * types) is reused rather than duplicated - only genuinely missing rows are
 * created.
 *
 * The point of this data is that it holds up under inspection: schedules
 * amortise to their totals, payments reconcile against the instalments they
 * settle, balances equal what is left, and every loan status in the system is
 * represented by a loan that plausibly got there.
 */

/** A client this run created, carried between phases. */
export interface SeededClient {
  id: string;
  persona: Persona;
  branchId: string;
  clientNumber: string;
}

export interface SeedOptions {
  organizationId?: string;
  clients?: number;
  useAi?: boolean;
  seed?: number;
}

/** Loans are dated relative to today so the demo never looks stale. */
const TODAY = new Date();

const daysAgo = (days: number) => {
  const date = new Date(TODAY);
  date.setDate(date.getDate() - days);
  return date;
};

const money = (value: number) => Number(value.toFixed(2));

/**
 * Every loan status the system can show, and the story that produces it.
 *
 * `paid` is how many instalments were settled; `startedDaysAgo` places the
 * loan in time. Together they decide whether a loan reads as healthy, late or
 * lost, without any status being set that the numbers do not support.
 */
interface LoanScenario {
  status: string;
  weight: number;
  startedDaysAgo: number;
  /** Fraction of the schedule settled, 0 to 1. */
  paidFraction: number;
  /** Leave a part-paid instalment behind. */
  partial?: boolean;
  disbursed: boolean;
  approved: boolean;
  penalty?: boolean;
  note: string;
}

const SCENARIOS: LoanScenario[] = [
  {
    status: 'ACTIVE',
    weight: 8,
    startedDaysAgo: 100,
    paidFraction: 0.5,
    disbursed: true,
    approved: true,
    note: 'Repaying on schedule.',
  },
  {
    status: 'ACTIVE',
    weight: 4,
    startedDaysAgo: 40,
    paidFraction: 0.25,
    partial: true,
    disbursed: true,
    approved: true,
    note: 'Part-payment received against the current instalment.',
  },
  {
    status: 'OVERDUE',
    weight: 5,
    startedDaysAgo: 220,
    paidFraction: 0.35,
    disbursed: true,
    approved: true,
    penalty: true,
    note: 'Instalments missed; follow-up call logged.',
  },
  {
    status: 'DEFAULTED',
    weight: 2,
    startedDaysAgo: 420,
    paidFraction: 0.15,
    disbursed: true,
    approved: true,
    penalty: true,
    note: 'No contact for three months; referred for collection.',
  },
  {
    status: 'WRITTEN_OFF',
    weight: 1,
    startedDaysAgo: 620,
    paidFraction: 0.1,
    disbursed: true,
    approved: true,
    penalty: true,
    note: 'Written off after collection attempts were exhausted.',
  },
  {
    status: 'COMPLETED',
    weight: 6,
    startedDaysAgo: 400,
    paidFraction: 1,
    disbursed: true,
    approved: true,
    note: 'Settled in full.',
  },
  {
    status: 'PENDING_APPROVAL',
    weight: 3,
    startedDaysAgo: 6,
    paidFraction: 0,
    disbursed: false,
    approved: false,
    note: 'Assessment complete, awaiting a decision.',
  },
  {
    status: 'PENDING_DISBURSEMENT',
    weight: 2,
    startedDaysAgo: 3,
    paidFraction: 0,
    disbursed: false,
    approved: true,
    note: 'Approved; disbursement scheduled.',
  },
  {
    status: 'PENDING',
    weight: 2,
    startedDaysAgo: 2,
    paidFraction: 0,
    disbursed: false,
    approved: false,
    note: 'Application captured at the branch.',
  },
  {
    status: 'PENDING_ASSESSMENT',
    weight: 2,
    startedDaysAgo: 4,
    paidFraction: 0,
    disbursed: false,
    approved: false,
    note: 'Awaiting affordability assessment.',
  },
  {
    status: 'CANCELLED',
    weight: 1,
    startedDaysAgo: 30,
    paidFraction: 0,
    disbursed: false,
    approved: false,
    note: 'Client withdrew the application.',
  },
];

/** Expand the weights into a flat list to draw from. */
const scenarioPool = SCENARIOS.flatMap(scenario =>
  Array.from({ length: scenario.weight }, () => scenario)
);

/**
 * Allocate a sequence number that is free, given what is already stored.
 * Existing data is never renumbered - the seeder starts after it.
 */
async function nextSequence(
  model: any,
  field: string,
  prefix: string
): Promise<number> {
  const latest = await model.findFirst({
    where: { [field]: { startsWith: prefix } },
    orderBy: { [field]: 'desc' },
    select: { [field]: true },
  });

  if (!latest) return 1;
  const parsed = parseInt(String(latest[field]).slice(prefix.length), 10);
  return Number.isNaN(parsed) ? 1 : parsed + 1;
}

export async function seedDemoData(options: SeedOptions = {}) {
  const clientCount = options.clients ?? 24;
  const random = makeRandom(options.seed ?? 20260911);
  const pick = <T>(list: T[]): T => list[Math.floor(random() * list.length)]!;
  const between = (min: number, max: number) =>
    Math.floor(random() * (max - min + 1)) + min;

  // ---------------------------------------------------------------- context
  const found = options.organizationId
    ? await prisma.organization.findUnique({ where: { id: options.organizationId } })
    : await prisma.organization.findFirst({
        where: { clients: { some: {} } },
        orderBy: { createdAt: 'asc' },
      });

  if (!found) throw new Error('No organization to seed into.');
  // Narrowed into its own const: the phases run inside a nested function, and
  // TypeScript does not carry a null check across that boundary.
  const organization = found;

  const branches = await prisma.branch.findMany({
    where: { organizationId: organization.id },
  });
  if (branches.length === 0) {
    throw new Error(`${organization.name} has no branches; seed those first.`);
  }

  const users = await prisma.user.findMany({
    where: { organizationId: organization.id, isActive: true },
  });
  if (users.length === 0) {
    throw new Error(`${organization.name} has no active users.`);
  }

  const products = await prisma.loanProduct.findMany({
    where: { organizationId: organization.id, isActive: true },
  });
  if (products.length === 0) {
    throw new Error(`${organization.name} has no active loan products.`);
  }

  const [documentTypes, collateralTypes, charges, paymentMethods, purposes] =
    await Promise.all([
      prisma.documentType.findMany({ where: { organizationId: organization.id } }),
      prisma.collateralType.findMany({ where: { organizationId: organization.id } }),
      prisma.charge.findMany({ where: { organizationId: organization.id } }),
      prisma.paymentMethod.findMany({ where: { organizationId: organization.id } }),
      prisma.loanPurpose.findMany({ where: { organizationId: organization.id } }),
    ]);

  const incomeCategories = await prisma.incomeCategory.findMany({
    where: { organizationId: organization.id },
  });
  const expenseCategories = await prisma.expenseCategory.findMany({
    where: { organizationId: organization.id },
  });

  const manifest = new Manifest(`seed-${Date.now()}`, {
    organizationId: organization.id,
    organizationName: organization.name,
  });

  // Whatever happens below, what was created has to reach the manifest -
  // otherwise a failed run leaves rows that nothing can roll back.
  try {
    return await runPhases();
  } finally {
    manifest.flush(true);
  }

  async function runPhases() {
  console.log(`\nSeeding ${organization.name}`);
  console.log(`  batch      ${manifest.batchId}`);
  console.log(
    `  reusing    ${branches.length} branches, ${users.length} users, ${products.length} products`
  );

  // --------------------------------------------------------------- personas
  const cities = Array.from(new Set(branches.map(b => b.name === 'Head Office' ? 'Harare' : b.name)));
  console.log('\n[1/9] Generating personas...');
  const { personas, source } = await generatePersonas(clientCount, cities, {
    seed: options.seed,
    useAi: options.useAi,
  });
  manifest.setAiProvider(source);
  console.log(`      ${personas.length} personas from ${source}`);

  const officer = (index: number) => users[index % users.length]!;
  const branchFor = (index: number) => branches[index % branches.length]!;

  // ------------------------------------------------------------- employers
  console.log('[2/9] Employers...');
  const employerNames = Array.from(
    new Set(
      personas
        .map(p => p.employerName)
        .filter(name => name && name !== 'Self-employed')
    )
  );

  const employers: Array<{ id: string; name: string }> = [];
  for (const name of employerNames) {
    const existing = await prisma.employer.findFirst({ where: { name } });
    if (existing) {
      employers.push(existing);
      continue;
    }
    const created = await prisma.employer.create({
      data: {
        name,
        address: 'Harare, Zimbabwe',
        contactPerson: 'HR Department',
        phone: `+2632${between(10000000, 99999999)}`,
        isActive: true,
      },
    });
    manifest.record('employer', created.id, name);
    employers.push(created);
  }
  manifest.flush();
  console.log(`      ${employers.length} employers ready`);

  // --------------------------------------------------------------- clients
  console.log('[3/9] Clients, addresses, contacts, kin, limits, documents...');
  let clientSeq = await nextSequence(prisma.client, 'clientNumber', 'CL');

  const seededClients: SeededClient[] = [];

  for (const [index, persona] of personas.entries()) {
    const branch = branchFor(index);
    const creator = officer(index);
    const isBusiness = Boolean(persona.businessName) && index % 5 === 0;
    const clientNumber = `CL${String(clientSeq++).padStart(8, '0')}`;

    const dateOfBirth = new Date(
      between(1965, 2001),
      between(0, 11),
      between(1, 28)
    );

    const client = await prisma.client.create({
      data: {
        clientNumber,
        type: isBusiness ? 'BUSINESS' : 'INDIVIDUAL',
        title: persona.gender === 'MALE' ? 'MR' : 'MS',
        firstName: persona.firstName,
        lastName: persona.lastName,
        businessName: isBusiness ? persona.businessName : null,
        email: `${persona.firstName}.${persona.lastName}${index}`
          .toLowerCase()
          .replace(/[^a-z0-9.]/g, '') + '@example.co.zw',
        phone: `+2637${between(10000000, 79999999)}`,
        dateOfBirth,
        gender: persona.gender,
        maritalStatus: pick(['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED']),
        idType: 'national_id',
        idNumber: `${between(10, 86)}-${between(100000, 999999)}${pick(['A', 'B', 'C', 'D', 'X'])}${between(10, 89)}`,
        nationality: 'Zimbabwean',
        address: persona.addressLine1,
        city: persona.city,
        state: `${persona.city} Province`,
        country: 'Zimbabwe',
        employmentStatus:
          persona.employerName === 'Self-employed' ? 'SELF_EMPLOYED' : 'EMPLOYED',
        monthlyIncome: between(250, 3200),
        creditScore: between(480, 780),
        isActive: true,
        kycStatus: pick(['VERIFIED', 'VERIFIED', 'PENDING']),
        organizationId: organization.id,
        branchId: branch.id,
        createdBy: creator.id,
      },
    });
    manifest.record('client', client.id, `${clientNumber} ${persona.firstName} ${persona.lastName}`);

    const address = await prisma.clientAddress.create({
      data: {
        clientId: client.id,
        addressType: 'RESIDENTIAL',
        addressLine1: persona.addressLine1,
        suburb: persona.suburb,
        city: persona.city,
        state: `${persona.city} Province`,
        country: 'Zimbabwe',
        isPrimary: true,
      },
    });
    manifest.record('clientAddress', address.id);

    const contact = await prisma.clientContact.create({
      data: {
        clientId: client.id,
        contactType: 'MOBILE',
        contactValue: client.phone,
        label: 'Primary mobile',
        isPrimary: true,
        isWhatsApp: random() > 0.4,
      },
    });
    manifest.record('clientContact', contact.id);

    if (isBusiness) {
      const business = await prisma.clientBusiness.create({
        data: {
          clientId: client.id,
          businessName: persona.businessName!,
          businessType: 'SOLE_PROPRIETOR',
          industry: persona.occupation,
          yearEstablished: between(2005, 2024),
          monthlyTurnover: between(800, 9000),
          businessAddress: `${persona.addressLine1}, ${persona.suburb}`,
          numberOfEmployees: between(1, 12),
        },
      });
      manifest.record('clientBusiness', business.id);
    }

    const kin = await prisma.nextOfKin.create({
      data: {
        clientId: client.id,
        name: persona.nextOfKinName,
        relationship: persona.nextOfKinRelationship,
        phone: `+2637${between(10000000, 79999999)}`,
        address: `${persona.addressLine1}, ${persona.suburb}`,
      },
    });
    manifest.record('nextOfKin', kin.id);

    const employer = employers.find(e => e.name === persona.employerName);
    if (employer) {
      const link = await prisma.clientEmployer.create({
        data: {
          clientId: client.id,
          employerId: employer.id,
          position: persona.occupation,
          startDate: daysAgo(between(400, 3000)),
          isActive: true,
          salary: Number(client.monthlyIncome ?? 0),
        },
      });
      manifest.record('clientEmployer', link.id);
    }

    const limitAmount = between(500, 6000);
    const limit = await prisma.clientLimit.create({
      data: {
        clientId: client.id,
        currency: 'USD',
        maxAmount: limitAmount,
        availableBalance: limitAmount,
        usedAmount: 0,
        enforceLimit: true,
      },
    });
    manifest.record('clientLimit', limit.id);

    // Two documents each, from the organization's own type list.
    const idType = documentTypes.find(t => t.code === 'ID') ?? documentTypes[0];
    const proofType =
      documentTypes.find(t => t.code === 'POA') ?? documentTypes[1] ?? idType;

    for (const [docType, name] of [
      [idType, 'national-id.jpg'],
      [proofType, 'proof-of-residence.pdf'],
    ] as const) {
      if (!docType) continue;
      const document = await prisma.clientDocument.create({
        data: {
          clientId: client.id,
          documentTypeId: docType.id,
          fileName: `${client.clientNumber}-${name}`,
          fileSize: between(90_000, 2_400_000),
          mimeType: name.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg',
          storagePath: `demo/${client.clientNumber}/${name}`,
          status: 'VERIFIED',
          verifiedBy: creator.id,
          verifiedAt: daysAgo(between(1, 120)),
        },
      });
      manifest.record('clientDocument', document.id);
    }

    // Roughly a third pledge something.
    if (collateralTypes.length > 0 && random() > 0.66) {
      const collateralType = pick(collateralTypes);
      const collateral = await prisma.clientCollateral.create({
        data: {
          clientId: client.id,
          collateralTypeId: collateralType.id,
          description: `${collateralType.name} offered as security`,
          estimatedValue: between(400, 9000),
          currency: 'USD',
          ownershipStatus: 'FULLY_OWNED',
          status: 'AVAILABLE',
          location: `${persona.suburb}, ${persona.city}`,
        },
      });
      manifest.record('clientCollateral', collateral.id);
    }

    seededClients.push({
      id: client.id,
      persona,
      branchId: branch.id,
      clientNumber,
    });
  }
  manifest.flush();
  console.log(`      ${seededClients.length} clients`);

  // ---------------------------------------------------------------- groups
  console.log('[4/9] Savings groups...');
  let groupSeq = await nextSequence(prisma.group, 'groupNumber', 'GRP');
  const groups: Array<{ id: string; branchId: string }> = [];

  for (let index = 0; index < 2; index++) {
    const branch = branchFor(index);
    const group = await prisma.group.create({
      data: {
        name: pick([
          'Mbare Traders Circle',
          'Mkoba Womens Group',
          'Sunrise Savings Club',
          'Chitungwiza Growers',
        ]) + ` ${index + 1}`,
        description: 'Joint-liability savings and lending group.',
        groupNumber: `GRP${String(groupSeq++).padStart(5, '0')}`,
        meetingDay: pick(['MONDAY', 'WEDNESDAY', 'FRIDAY']),
        meetingTime: '14:00',
        meetingPlace: `${branch.name} community hall`,
        isActive: true,
        organizationId: organization.id,
        branchId: branch.id,
      },
    });
    manifest.record('group', group.id, group.name);
    groups.push({ id: group.id, branchId: branch.id });

    const members = seededClients.slice(index * 4, index * 4 + 4);
    for (const [position, member] of members.entries()) {
      const groupMember = await prisma.groupMember.create({
        data: {
          groupId: group.id,
          clientId: member.id,
          role: position === 0 ? 'CHAIRPERSON' : position === 1 ? 'TREASURER' : 'MEMBER',
          joinedAt: daysAgo(between(60, 700)),
          isActive: true,
        },
      });
      manifest.record('groupMember', groupMember.id);
    }
  }
  manifest.flush();
  console.log(`      ${groups.length} groups`);

  // ----------------------------------------------------------------- loans
  console.log('[5/9] Loans, schedules, payments...');
  let loanSeq = await nextSequence(prisma.loan, 'loanNumber', 'LN');
  let paymentSeq = await nextSequence(prisma.payment, 'paymentNumber', 'PMT');

  const seededLoans: Array<{ id: string; status: string; clientId: string }> = [];

  for (const [index, seededClient] of seededClients.entries()) {
    // Most clients have one loan; some have a history of two or three.
    const loanCount = random() > 0.75 ? between(2, 3) : 1;

    for (let loanIndex = 0; loanIndex < loanCount; loanIndex++) {
      // Every status the system can display must appear at least once,
      // otherwise a small run leaves screens with nothing to show. The first
      // clients cover the scenario list one by one; the rest are drawn from
      // the weighted pool so the overall mix still looks like a real book.
      const scenario =
        loanIndex > 0
          ? // Earlier loans in a borrower's history are settled ones.
            SCENARIOS.find(s => s.status === 'COMPLETED')!
          : index < SCENARIOS.length
            ? SCENARIOS[index]!
            : pick(scenarioPool);

      const product = pick(products);
      const loanOfficer = officer(index + loanIndex);
      const minAmount = Number(product.minAmount);
      const maxAmount = Number(product.maxAmount);

      // Real micro-lending books cluster near the floor of a product's range
      // with a thin tail of larger loans. Drawing uniformly gave every client
      // an average of half the maximum, which reads as a corporate book.
      const skew = Math.pow(random(), 2.5);
      const rawAmount = minAmount + (maxAmount - minAmount) * skew;
      const rounding = rawAmount > 5000 ? 500 : rawAmount > 1000 ? 100 : 50;
      const amount = money(
        Math.min(Math.max(Math.round(rawAmount / rounding) * rounding, minAmount), maxAmount)
      );

      const term = between(product.minTerm, Math.min(product.maxTerm, 12));
      const frequency = product.repaymentFrequency as Frequency;

      // The product quotes its rate against interestRateFrequency, which is
      // rarely the repayment frequency.
      const rate = ratePerPeriod(
        Number(product.interestRate),
        product.interestRateFrequency as Frequency,
        frequency
      );
      const startDate = daysAgo(
        scenario.startedDaysAgo + loanIndex * between(200, 400)
      );

      const amortisation: Amortisation =
        product.calculationMethod === 'FLAT_RATE'
          ? amortiseFlat(amount, rate, term, frequency, startDate)
          : amortiseReducing(amount, rate, term, frequency, startDate);

      const paidCount =
        scenario.paidFraction >= 1
          ? term
          : Math.min(Math.floor(term * scenario.paidFraction), term);

      const partialAmount =
        scenario.partial && amortisation.installments[paidCount]
          ? money(amortisation.installments[paidCount]!.totalAmount / 2)
          : 0;

      // Penalty is derived from how late the next unpaid instalment is, so an
      // overdue loan's penalty matches the dates on its own schedule.
      const nextUnpaid = amortisation.installments[paidCount];
      const daysLate = nextUnpaid ? daysBetween(nextUnpaid.dueDate, TODAY) : 0;
      const penalty =
        scenario.penalty && nextUnpaid && daysLate > 0
          ? penaltyFor(
              nextUnpaid.totalAmount,
              daysLate,
              Number(product.penaltyRate) || 5
            )
          : 0;

      const position = positionAfterPayments(amortisation, paidCount, {
        partialOfNext: partialAmount,
        penalty,
      });

      const loanNumber = `LN${String(loanSeq++).padStart(8, '0')}`;
      const isSettled = scenario.status === 'COMPLETED';

      const loan = await prisma.loan.create({
        data: {
          loanNumber,
          clientId: seededClient.id,
          productId: product.id,
          organizationId: organization.id,
          branchId: seededClient.branchId,
          loanOfficerId: loanOfficer.id,
          createdById: loanOfficer.id,
          disbursedById: scenario.disbursed ? loanOfficer.id : null,
          amount,
          currency: product.currency,
          interestRate: Number(product.interestRate),
          calculationMethod: product.calculationMethod,
          term,
          repaymentFrequency: frequency,
          installmentAmount: amortisation.installmentAmount,
          totalAmount: amortisation.totalAmount,
          totalInterest: amortisation.totalInterest,
          interestAmount: amortisation.totalInterest,
          status: scenario.status as any,
          applicationDate: daysAgo(scenario.startedDaysAgo + 7),
          approvedDate: scenario.approved ? daysAgo(scenario.startedDaysAgo + 3) : null,
          disbursedDate: scenario.disbursed ? startDate : null,
          startDate: scenario.disbursed ? startDate : null,
          maturityDate: amortisation.maturityDate,
          expectedRepaymentDate: amortisation.maturityDate,
          lastPaymentDate: position.lastPaymentDate,
          nextDueDate: isSettled ? null : position.nextDueDate,
          outstandingBalance: isSettled ? 0 : position.outstandingBalance,
          principalBalance: isSettled ? 0 : position.principalBalance,
          interestBalance: isSettled ? 0 : position.interestBalance,
          penaltyBalance: isSettled ? 0 : position.penaltyBalance,
          purpose:
            loanIndex === 0
              ? seededClient.persona.loanPurpose
              : pick(personas).loanPurpose,
          notes: scenario.note,
          applicationSource: random() > 0.85 ? 'WEB' : 'BRANCH',
          gracePeriodDays: product.gracePeriod,
          ...(purposes.length > 0 ? {} : {}),
        },
      });
      manifest.record('loan', loan.id, `${loanNumber} ${scenario.status}`);
      seededLoans.push({ id: loan.id, status: scenario.status, clientId: seededClient.id });

      // -- schedule ------------------------------------------------------
      if (scenario.disbursed) {
        for (const installment of amortisation.installments) {
          const settled = installment.installmentNumber <= paidCount;
          const isPartial =
            !settled &&
            partialAmount > 0 &&
            installment.installmentNumber === paidCount + 1;

          const paidAmount = settled
            ? installment.totalAmount
            : isPartial
              ? partialAmount
              : 0;

          const row = await prisma.repaymentSchedule.create({
            data: {
              loanId: loan.id,
              installmentNumber: installment.installmentNumber,
              dueDate: installment.dueDate,
              principalAmount: installment.principalAmount,
              interestAmount: installment.interestAmount,
              totalAmount: installment.totalAmount,
              paidAmount,
              outstandingAmount: money(installment.totalAmount - paidAmount),
              status: settled
                ? 'COMPLETED'
                : isPartial
                  ? 'PENDING'
                  : 'PENDING',
              paymentDate: settled ? installment.dueDate : null,
            },
          });
          manifest.record('repaymentSchedule', row.id);
        }

        // -- payments, one per settled instalment -------------------------
        for (let number = 1; number <= paidCount; number++) {
          const installment = amortisation.installments[number - 1]!;
          // Real repayment dates wander a little around the due date.
          const paidOn = new Date(installment.dueDate);
          paidOn.setDate(paidOn.getDate() + between(-2, 3));

          const payment = await prisma.payment.create({
            data: {
              paymentNumber: `PMT${String(paymentSeq++).padStart(8, '0')}`,
              loanId: loan.id,
              amount: installment.totalAmount,
              currency: product.currency,
              principalAmount: installment.principalAmount,
              interestAmount: installment.interestAmount,
              penaltyAmount: 0,
              type: 'LOAN_REPAYMENT',
              method: pick(['CASH', 'ECOCASH', 'BANK_TRANSFER']),
              status: 'COMPLETED',
              transactionRef: `REF${between(100000, 999999)}`,
              paymentDate: paidOn,
              receivedBy: loanOfficer.id,
              processedBranchId: seededClient.branchId,
              notes: number === paidCount ? scenario.note : null,
            },
          });
          manifest.record('payment', payment.id);
        }

        if (partialAmount > 0) {
          const installment = amortisation.installments[paidCount]!;
          const interestPart = Math.min(partialAmount, installment.interestAmount);
          const payment = await prisma.payment.create({
            data: {
              paymentNumber: `PMT${String(paymentSeq++).padStart(8, '0')}`,
              loanId: loan.id,
              amount: partialAmount,
              currency: product.currency,
              interestAmount: money(interestPart),
              principalAmount: money(partialAmount - interestPart),
              penaltyAmount: 0,
              type: 'LOAN_REPAYMENT',
              method: 'ECOCASH',
              status: 'COMPLETED',
              paymentDate: daysAgo(between(1, 20)),
              receivedBy: loanOfficer.id,
              processedBranchId: seededClient.branchId,
              notes: 'Part-payment against the current instalment.',
            },
          });
          manifest.record('payment', payment.id);
        }
      }

      // -- charges --------------------------------------------------------
      if (charges.length > 0 && scenario.approved) {
        const charge = pick(charges);
        const chargeAmount = money(amount * 0.02);
        const loanCharge = await prisma.loanCharge.create({
          data: {
            loanId: loan.id,
            chargeId: charge.id,
            chargeName: charge.name,
            chargeType: charge.type,
            calculationType: 'PERCENTAGE',
            baseAmount: amount,
            amount: chargeAmount,
            calculatedAmount: chargeAmount,
            currency: product.currency,
            status: scenario.disbursed ? 'COMPLETED' : 'PENDING',
            paidAmount: scenario.disbursed ? chargeAmount : 0,
            paidAt: scenario.disbursed ? startDate : null,
          },
        });
        manifest.record('loanCharge', loanCharge.id);
      }

      // -- assessment, visit, pledge, workflow ----------------------------
      if (scenario.approved || scenario.status === 'PENDING_APPROVAL') {
        const assessment = await prisma.loanAssessment.create({
          data: {
            loanId: loan.id,
            assessorId: loanOfficer.id,
            status: scenario.approved ? 'APPROVED' : 'PENDING',
            clientCharacter: pick(['EXCELLENT', 'GOOD', 'FAIR']),
            clientCapacity: pick(['EXCELLENT', 'GOOD', 'FAIR']),
            collateralQuality: pick(['GOOD', 'FAIR']),
            conditions: 'GOOD',
            capitalAdequacy: pick(['GOOD', 'FAIR']),
            recommendedAmount: amount,
            recommendation: scenario.approved ? 'APPROVE' : 'REVIEW',
            notes: seededClient.persona.officerNote,
          },
        });
        manifest.record('loanAssessment', assessment.id);

        const visit = await prisma.loanVisit.create({
          data: {
            loanId: loan.id,
            visitType: seededClient.persona.businessName ? 'BUSINESS' : 'HOME',
            visitedBy: loanOfficer.id,
            visitedAt: daysAgo(scenario.startedDaysAgo + 5),
            address: `${seededClient.persona.addressLine1}, ${seededClient.persona.suburb}`,
            notes: seededClient.persona.officerNote,
          },
        });
        manifest.record('loanVisit', visit.id);
      }

      if (scenario.disbursed && random() > 0.7) {
        const pledge = await prisma.securityPledge.create({
          data: {
            loanId: loan.id,
            itemDescription: pick([
              'Sewing machine, industrial',
              'Toyota Hiace, 2009',
              'Deep freezer, 300L',
              'Welding plant and accessories',
            ]),
            estimatedValue: money(amount * 1.4),
            status: 'PLEDGED',
            currency: product.currency,
            serialNumber: `SN${between(100000, 999999)}`,
          },
        });
        manifest.record('securityPledge', pledge.id);
      }

      // A trail showing how the loan reached its status.
      const trail: Array<[string, string]> = [['DRAFT', 'PENDING']];
      if (scenario.approved) trail.push(['PENDING', 'APPROVED']);
      if (scenario.disbursed) trail.push(['APPROVED', 'ACTIVE']);
      if (!['ACTIVE', 'APPROVED', 'PENDING'].includes(scenario.status)) {
        trail.push([scenario.disbursed ? 'ACTIVE' : 'PENDING', scenario.status]);
      }

      for (const [from, to] of trail) {
        const history = await prisma.loanWorkflowHistory.create({
          data: {
            loanId: loan.id,
            fromStatus: from as any,
            toStatus: to as any,
            changedBy: loanOfficer.id,
            notes: `Moved from ${from} to ${to}.`,
          },
        });
        manifest.record('loanWorkflowHistory', history.id);
      }
    }

    if ((index + 1) % 8 === 0) manifest.flush();
  }
  manifest.flush();
  console.log(`      ${seededLoans.length} loans across ${new Set(seededLoans.map(l => l.status)).size} statuses`);

  // ----------------------------------------------- financial transactions
  console.log('[6/9] Financial transactions, rates, targets...');
  if (paymentMethods.length > 0) {
    let txnSeq = await nextSequence(
      prisma.financialTransaction,
      'transactionNumber',
      'TXN'
    );
    let runningBalance = 25_000;

    for (let index = 0; index < 30; index++) {
      const isIncome = random() > 0.45;
      const category = isIncome
        ? incomeCategories.length > 0 ? pick(incomeCategories) : null
        : expenseCategories.length > 0 ? pick(expenseCategories) : null;
      const amount = between(40, 1800);
      const before = runningBalance;
      runningBalance += isIncome ? amount : -amount;

      const transaction = await prisma.financialTransaction.create({
        data: {
          organizationId: organization.id,
          branchId: branchFor(index).id,
          transactionNumber: `TXN${String(txnSeq++).padStart(8, '0')}`,
          type: isIncome ? 'INCOME' : 'EXPENSE',
          ...(isIncome
            ? { incomeCategoryId: category?.id ?? null }
            : { expenseCategoryId: category?.id ?? null }),
          paymentMethodId: pick(paymentMethods).id,
          amount,
          currency: 'USD',
          description: isIncome
            ? pick([
                'Interest income on loan portfolio',
                'Application fees collected',
                'Late payment penalties recovered',
              ])
            : pick([
                'Branch rent',
                'Staff salaries',
                'Fuel and vehicle running costs',
                'Stationery and printing',
              ]),
          balanceBefore: before,
          balanceAfter: runningBalance,
          transactionDate: daysAgo(between(1, 180)),
          processedBy: officer(index).id,
          status: 'COMPLETED',
        },
      });
      manifest.record('financialTransaction', transaction.id);
    }
  }

  for (const [from, to, rate] of [
    ['USD', 'ZWG', 26.4],
    ['USD', 'ZAR', 18.2],
    ['ZAR', 'USD', 0.055],
  ] as const) {
    const exchangeRate = await prisma.exchangeRate.create({
      data: {
        organizationId: organization.id,
        fromCurrency: from,
        toCurrency: to,
        rate,
        effectiveDate: daysAgo(1),
      },
    });
    manifest.record('exchangeRate', exchangeRate.id);
  }

  for (const branch of branches) {
    for (const targetType of ['DISBURSEMENT', 'REPAYMENT'] as const) {
      const target = await prisma.monthlyTarget.create({
        data: {
          organizationId: organization.id,
          branchId: branch.id,
          currency: 'USD',
          targetType,
          targetAmount: targetType === 'DISBURSEMENT' ? 45_000 : 38_000,
          year: TODAY.getFullYear(),
          month: TODAY.getMonth() + 1,
        },
      });
      manifest.record('monthlyTarget', target.id);
    }
  }
  manifest.flush();
  console.log('      transactions, exchange rates and targets in place');

  // ------------------------------------------ applications, notes, inbox
  console.log('[7/9] Online applications and notes...');
  for (let index = 0; index < 5; index++) {
    const persona = personas[index % personas.length]!;
    const application = await prisma.onlineApplication.create({
      data: {
        source: pick(['WEB', 'WHATSAPP'] as const),
        applicationType: index % 2 === 0 ? 'NEW' : 'EXISTING',
        clientPhone: `+2637${between(10000000, 79999999)}`,
        clientName: `${persona.firstName} ${persona.lastName}`,
        amount: between(200, 2500),
        productId: pick(products).id,
        disbursementPreference: pick(['CASH', 'TRANSFER'] as const),
        status: pick(['PENDING', 'VERIFIED', 'PROCESSED'] as const),
        notes: persona.loanPurpose,
        idNumber: `${between(10, 86)}-${between(100000, 999999)}X${between(10, 89)}`,
      },
    });
    manifest.record('onlineApplication', application.id);
  }

  for (const [index, seededClient] of seededClients.slice(0, 10).entries()) {
    const note = await prisma.note.create({
      data: {
        organizationId: organization.id,
        entityType: 'CLIENT',
        entityId: seededClient.id,
        content: seededClient.persona.officerNote,
        priority: pick(['LOW', 'NORMAL', 'HIGH'] as const),
        createdBy: officer(index).id,
      },
    });
    manifest.record('note', note.id);
  }
  manifest.flush();

  // ------------------------------------ asset finance, drafts, approvals
  console.log('[8/10] Shops, drafts, deletion requests, notifications...');

  const shop = await prisma.shop.create({
    data: {
      name: 'Gwerudale Hardware & Electricals',
      address: '14 Robert Mugabe Way, Gweru',
      phone: '+263542223344',
      contactPerson: 'Sales Desk',
      mobileNumber: '+263772334455',
      organizationId: organization.id,
      isActive: true,
    },
  });
  manifest.record('shop', shop.id, shop.name);

  const shopProducts = [];
  for (const [name, price] of [
    ['Solar panel kit, 300W', 420],
    ['Deep freezer, 300L', 640],
    ['Industrial sewing machine', 380],
    ['Water pump, 1.5HP', 295],
  ] as const) {
    const product = await prisma.shopProduct.create({
      data: {
        shopId: shop.id,
        name,
        description: `${name} - supplied under asset finance.`,
        price,
        currency: 'USD',
        sku: `SKU-${between(1000, 9999)}`,
        isActive: true,
      },
    });
    manifest.record('shopProduct', product.id, name);
    shopProducts.push(product);
  }

  // Attach a few financed items to disbursed loans.
  const financedLoans = seededLoans
    .filter(loan => ['ACTIVE', 'COMPLETED'].includes(loan.status))
    .slice(0, 6);

  for (const financed of financedLoans) {
    const product = pick(shopProducts);
    const quantity = between(1, 2);
    const item = await prisma.loanItem.create({
      data: {
        loanId: financed.id,
        shopProductId: product.id,
        quantity,
        unitPrice: Number(product.price),
        totalPrice: money(Number(product.price) * quantity),
      },
    });
    manifest.record('loanItem', item.id);
  }

  // A half-finished client capture, as the create form's auto-save leaves it.
  // One draft per user is a unique constraint, and anyone who has used the
  // create form already holds theirs - so only users without one are given a
  // demo draft, and none is overwritten.
  const usersWithDrafts = new Set(
    (
      await prisma.clientDraft.findMany({
        where: { organizationId: organization.id },
        select: { userId: true },
      })
    ).map(draft => draft.userId)
  );
  const draftCandidates = users
    .filter(user => !usersWithDrafts.has(user.id))
    .slice(0, 2);

  for (const [index, draftUser] of draftCandidates.entries()) {
    const persona = personas[(index + 3) % personas.length]!;
    const draft = await prisma.clientDraft.create({
      data: {
        organizationId: organization.id,
        userId: draftUser.id,
        branchId: branchFor(index).id,
        draftData: {
          first_name: persona.firstName,
          last_name: persona.lastName,
          id_type: 'national_id',
          contacts: [{ phone: `+2637${between(10000000, 79999999)}` }],
        },
        requiredFieldsComplete: false,
        completionPercentage: between(35, 70),
        lastFieldUpdated: 'contacts.0.phone',
        version: 1,
      },
    });
    manifest.record('clientDraft', draft.id);
  }

  // Two clients put forward for deletion, so the approval queue is not empty.
  const deletionCandidates = seededClients.slice(-2);
  for (const [index, candidate] of deletionCandidates.entries()) {
    const requester = officer(index);
    const request = await prisma.clientDeletionRequest.create({
      data: {
        organizationId: organization.id,
        clientId: candidate.id,
        requestedById: requester.id,
        reason: index === 0
          ? 'Duplicate record - the same client was captured twice on the same day.'
          : 'Captured in error during training.',
        status: 'PENDING',
      },
    });
    manifest.record('clientDeletionRequest', request.id, candidate.clientNumber);

    // Everyone who can approve hears about it, exactly as the live flow does.
    const notified = await prisma.user.findMany({
      where: { organizationId: organization.id, isActive: true },
      select: { id: true },
    });
    for (const user of notified) {
      const notification = await prisma.notification.create({
        data: {
          organizationId: organization.id,
          recipientId: user.id,
          type: 'CLIENT_DELETION_REQUESTED',
          title: 'Client deletion requested',
          body: `A colleague asked for ${candidate.persona.firstName} ${candidate.persona.lastName} (${candidate.clientNumber}) to be deleted.`,
          link: `/clients/deletion-requests?request=${request.id}`,
          resource: 'ClientDeletionRequest',
          resourceId: request.id,
          readAt: index === 1 ? daysAgo(1) : null,
        },
      });
      manifest.record('notification', notification.id);
    }
  }
  manifest.flush();

  // ------------------------------------------------------------- audit log
  console.log('[9/10] Audit trail...');
  for (const [index, loan] of seededLoans.slice(0, 40).entries()) {
    const log = await prisma.auditLog.create({
      data: {
        userId: officer(index).id,
        organizationId: organization.id,
        action: 'CREATE',
        resource: 'Loan',
        resourceId: loan.id,
        status: 'SUCCESS',
        newValue: { status: loan.status },
        timestamp: daysAgo(between(1, 200)),
      },
    });
    manifest.record('auditLog', log.id);
  }
  manifest.flush();

  // ---------------------------------------------------------------- done
  console.log('[10/10] Writing manifest...');

  return { manifest, organization, seededClients, seededLoans };
  }
}

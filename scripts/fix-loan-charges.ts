import { prisma } from '../src/config/database';

async function fixLoanCharges() {
  console.log(
    'Finding loan charges that should be marked as paid at disbursement...'
  );

  // Find all loan charges that should be marked as paid
  // Either the charge mode is DEDUCTED or it applies at LOAN_CREATION with deduction
  const charges = await prisma.loanCharge.findMany({
    where: {
      status: 'PENDING',
    },
    include: {
      charge: true,
      loan: true,
    },
  });

  console.log('Found total pending charges:', charges.length);

  let updatedCount = 0;
  for (const lc of charges) {
    // Check if this charge should have been paid at disbursement
    const shouldBePaid =
      lc.charge?.chargeMode === 'DEDUCTED' ||
      lc.charge?.appliesAt === 'LOAN_CREATION' ||
      lc.isDeductedFromPrincipal;

    if (shouldBePaid) {
      await prisma.loanCharge.update({
        where: { id: lc.id },
        data: {
          status: 'COMPLETED',
          paidAmount: lc.amount,
          paidAt: lc.loan?.disbursedDate || new Date(),
          isDeductedFromPrincipal: true,
        },
      });
      console.log(
        `Updated charge: ${lc.id} - ${lc.chargeName} for loan ${lc.loan?.loanNumber}`
      );
      updatedCount++;
    }
  }

  console.log(`\nTotal charges updated: ${updatedCount}`);

  await prisma.$disconnect();
}

fixLoanCharges().catch(console.error);

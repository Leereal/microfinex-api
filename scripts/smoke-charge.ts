import { prisma } from '../src/config/database';

async function main() {
  const charge = await prisma.charge.findFirst();
  console.log('first charge id', charge?.id);
  if (charge) {
    const full = await prisma.charge.findUnique({
      where: { id: charge.id },
      include: {
        chargeRates: true,
        productCharges: {
          include: {
            product: { select: { id: true, name: true } },
          },
        },
      },
    });
    console.log('loaded ok', !!full);
  }
}

main()
  .catch(err => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

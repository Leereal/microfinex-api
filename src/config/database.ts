import { PrismaClient } from '@prisma/client';
import { config } from '../config';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma =
  globalThis.__prisma ||
  new PrismaClient({
    log:
      config.nodeEnv === 'development'
        ? ['query', 'info', 'warn', 'error']
        : ['error'],
    datasources: {
      db: {
        url: config.databaseUrl,
      },
    },
  });

if (config.nodeEnv !== 'production') {
  globalThis.__prisma = prisma;
}

// Graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

export default prisma;

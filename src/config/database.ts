import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { config } from '../config';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

// Create PostgreSQL pool
const pool = new Pool({
  connectionString: config.databaseUrl,
});

// Create Prisma adapter
const adapter = new PrismaPg(pool);

export const prisma =
  globalThis.__prisma ||
  new PrismaClient({
    adapter,
    // log:
    //   config.nodeEnv === 'development'
    //     ? ['query', 'info', 'warn', 'error']
    //     : ['error'],
    log: [], // Set to ['query', 'info', 'warn', 'error'] to enable logs
  });

if (config.nodeEnv !== 'production') {
  globalThis.__prisma = prisma;
}

// Graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
  await pool.end();
});

export default prisma;

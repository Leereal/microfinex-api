import 'dotenv/config';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

// Load the DATABASE_URL from .env
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL environment variable is not set');
}

export default defineConfig({
  schema: path.join(__dirname, 'schema.prisma'),
  migrations: {
    path: path.join(__dirname, 'migrations'),
  },
  datasource: {
    provider: 'postgresql',
    connectionString: databaseUrl,
  },
});

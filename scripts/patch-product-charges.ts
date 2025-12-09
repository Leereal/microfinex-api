import { Pool } from 'pg';
import { config } from '../src/config';

async function main() {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const client = await pool.connect();
  try {
    console.log('Patching product_charges columns...');
    await client.query(
      'ALTER TABLE product_charges ADD COLUMN IF NOT EXISTS "isMandatory" BOOLEAN DEFAULT false;'
    );
    await client.query(
      'ALTER TABLE product_charges ADD COLUMN IF NOT EXISTS "customAmount" DECIMAL(15,2);'
    );
    await client.query(
      'ALTER TABLE product_charges ADD COLUMN IF NOT EXISTS "customPercentage" DECIMAL(5,4);'
    );
    await client.query(
      'ALTER TABLE product_charges ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;'
    );
    console.log('Done');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

/**
 * Check columns in charges table
 */
import { Pool } from 'pg';
import { config } from '../src/config';

async function main() {
  const pool = new Pool({
    connectionString: config.databaseUrl,
  });

  const client = await pool.connect();

  try {
    const result = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'charges'
      ORDER BY ordinal_position
    `);
    console.log('Columns in charges table:');
    result.rows.forEach(row => {
      console.log(`  - ${row.column_name}: ${row.data_type}`);
    });
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);

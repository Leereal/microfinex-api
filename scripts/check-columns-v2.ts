import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  try {
    const client = await pool.connect();
    try {
      const res = await client.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'charges';
      `);
      console.log('Columns in charges table:', res.rows);
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('Error checking schema:', e);
  } finally {
    await pool.end();
  }
}

main();

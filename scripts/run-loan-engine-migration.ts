/**
 * Run Loan Engine Migration
 * 
 * Execute this script to apply the loan engine schema changes.
 * Run: npx tsx scripts/run-loan-engine-migration.ts
 */

import 'dotenv/config';
import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';

async function runMigration() {
  const connectionString = process.env.DATABASE_URL;
  
  if (!connectionString) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString,
  });

  try {
    console.log('Reading migration file...');
    const sqlPath = path.join(__dirname, '../prisma/migrations/manual/add_loan_engine_fields.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    console.log('Connecting to database...');
    const client = await pool.connect();
    
    try {
      console.log('Running migration...');
      // Split by statements and execute one by one to get better error messages
      const statements = sql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0);
      
      for (const statement of statements) {
        try {
          console.log(`Executing: ${statement.substring(0, 80)}...`);
          await client.query(statement);
          console.log('  ✓ Success');
        } catch (err: any) {
          if (err.message.includes('already exists')) {
            console.log('  ⚠ Already exists, skipping');
          } else {
            console.error(`  ✗ Error: ${err.message}`);
          }
        }
      }
      
      console.log('\n✅ Migration completed successfully!');
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();

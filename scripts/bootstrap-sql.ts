#!/usr/bin/env ts-node

/**
 * SQL Bootstrap Script
 *
 * Alternative bootstrap approach using direct SQL queries
 * Useful when you prefer SQL or need to bootstrap via database console
 */

import { prisma } from '../src/config/database';
import * as readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const askQuestion = (question: string): Promise<string> => {
  return new Promise(resolve => {
    rl.question(question, answer => {
      resolve(answer.trim());
    });
  });
};

async function generateBootstrapSQL() {
  console.log('🔧 SQL Bootstrap Generator\n');
  console.log(
    'This will generate SQL commands you can run directly in your database.\n'
  );

  try {
    // Get details
    const orgName = await askQuestion('Organization Name: ');
    const orgType =
      (await askQuestion(
        'Organization Type (MICROFINANCE/BANK/CREDIT_UNION/COOPERATIVE) [MICROFINANCE]: '
      )) || 'MICROFINANCE';
    const orgAddress = await askQuestion('Organization Address: ');
    const orgPhone = await askQuestion('Organization Phone: ');
    const orgEmail = await askQuestion('Organization Email: ');
    const superAdminEmail = await askQuestion('Super Admin Email: ');
    const superAdminFirstName = await askQuestion('Super Admin First Name: ');
    const superAdminLastName = await askQuestion('Super Admin Last Name: ');

    const sql = `
-- ==============================================
-- Microfinex System Bootstrap SQL
-- Generated on: ${new Date().toISOString()}
-- ==============================================

-- 1. Create the first organization
INSERT INTO organizations (
  id, name, type, address, phone, email, 
  "isActive", "apiTier", "maxApiKeys", "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid(),
  '${orgName}',
  '${orgType}',
  '${orgAddress}',
  '${orgPhone}',
  '${orgEmail}',
  true,
  'PREMIUM',
  10,
  NOW(),
  NOW()
)
RETURNING id;

-- Store the organization ID from above result, then use it below
-- Replace 'YOUR_ORG_ID_HERE' with the actual ID from the INSERT above

-- 2. Create default branch
INSERT INTO branches (
  id, "organizationId", name, code, address, phone, email,
  "isActive", "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid(),
  'YOUR_ORG_ID_HERE', -- Replace with actual org ID
  'Head Office',
  'HQ',
  '${orgAddress}',
  '${orgPhone}',
  '${orgEmail}',
  true,
  NOW(),
  NOW()
);

-- 3. Create Super Admin user (organizationId = NULL for global access)
-- NOTE: You'll need to create this user in Supabase Auth first, then use their UUID here
INSERT INTO users (
  id, email, password, "firstName", "lastName", role,
  "organizationId", "isActive", "isEmailVerified", permissions,
  "createdAt", "updatedAt"
) VALUES (
  'YOUR_SUPABASE_USER_UUID_HERE', -- Replace with Supabase auth user UUID
  '${superAdminEmail}',
  'hashed_password_here', -- Replace with actual hashed password
  '${superAdminFirstName}',
  '${superAdminLastName}',
  'SUPER_ADMIN',
  NULL, -- NULL organizationId = Super Admin with access to all orgs
  true,
  true,
  ARRAY['CREATE_ORGANIZATIONS', 'MANAGE_USERS', 'VIEW_ALL_DATA', 'SYSTEM_ADMIN', 'API_MANAGEMENT'],
  NOW(),
  NOW()
);

-- 4. Create sample loan products
INSERT INTO loan_products (
  id, name, description, type, "minAmount", "maxAmount", "interestRate",
  "calculationMethod", "minTerm", "maxTerm", "repaymentFrequency",
  "gracePeriod", "penaltyRate", "organizationId", "isActive",
  "createdAt", "updatedAt"
) VALUES 
(
  gen_random_uuid(),
  'Micro Business Loan',
  'Small business loans for entrepreneurs',
  'BUSINESS',
  1000.00,
  50000.00,
  18.0000,
  'REDUCING_BALANCE',
  6,
  24,
  'MONTHLY',
  0,
  2.0000,
  'YOUR_ORG_ID_HERE', -- Replace with actual org ID
  true,
  NOW(),
  NOW()
),
(
  gen_random_uuid(),
  'Personal Loan',
  'Quick personal loans for individuals',
  'PERSONAL',
  500.00,
  25000.00,
  15.0000,
  'REDUCING_BALANCE',
  3,
  18,
  'MONTHLY',
  0,
  2.5000,
  'YOUR_ORG_ID_HERE', -- Replace with actual org ID
  true,
  NOW(),
  NOW()
),
(
  gen_random_uuid(),
  'Agricultural Loan',
  'Seasonal loans for farmers',
  'AGRICULTURAL',
  2000.00,
  100000.00,
  12.0000,
  'REDUCING_BALANCE',
  6,
  36,
  'MONTHLY',
  3,
  1.5000,
  'YOUR_ORG_ID_HERE', -- Replace with actual org ID
  true,
  NOW(),
  NOW()
);

-- ==============================================
-- MANUAL STEPS REQUIRED:
-- ==============================================
-- 1. Create user in Supabase Auth first:
--    - Go to Supabase Dashboard > Authentication > Users
--    - Add user with email: ${superAdminEmail}
--    - Copy the generated UUID
--
-- 2. Replace placeholders in the SQL above:
--    - YOUR_ORG_ID_HERE: Use the organization ID from step 1
--    - YOUR_SUPABASE_USER_UUID_HERE: Use the UUID from Supabase Auth
--    - hashed_password_here: Use bcrypt to hash the password
--
-- 3. Run the SQL commands in your database console
--
-- ==============================================

-- Verification Queries:
-- Check if everything was created correctly

SELECT 'Organizations' as table_name, count(*) as count FROM organizations
UNION ALL
SELECT 'Branches' as table_name, count(*) as count FROM branches
UNION ALL  
SELECT 'Users' as table_name, count(*) as count FROM users
UNION ALL
SELECT 'Loan Products' as table_name, count(*) as count FROM loan_products;

-- Check Super Admin
SELECT email, role, "organizationId", "isActive" 
FROM users 
WHERE role = 'SUPER_ADMIN' AND "organizationId" IS NULL;
`;

    console.log('\n📄 Generated SQL Bootstrap Script:');
    console.log('=====================================\n');
    console.log(sql);

    const saveToFile = await askQuestion('\nSave to file? (y/N): ');
    if (saveToFile.toLowerCase() === 'y') {
      const fs = require('fs');
      const filename = `bootstrap-${Date.now()}.sql`;
      fs.writeFileSync(filename, sql);
      console.log(`✅ SQL saved to: ${filename}`);
    }
  } catch (error) {
    console.error('❌ Error generating SQL:', error);
  } finally {
    rl.close();
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  generateBootstrapSQL()
    .then(() => {
      console.log('\n🎉 SQL generation completed!');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n💥 SQL generation failed:', error.message);
      process.exit(1);
    });
}

export { generateBootstrapSQL };

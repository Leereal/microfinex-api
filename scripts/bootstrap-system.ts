#!/usr/bin/env ts-node

/**
 * Bootstrap System Script
 *
 * This script initializes the microfinance system with:
 * 1. First Super Admin user (organizationId = null)
 * 2. Default organization
 * 3. System-wide configuration
 *
 * Run this ONCE during initial system setup:
 * npm run bootstrap
 */

import { prisma } from '../src/config/database';
import { supabaseAdmin } from '../src/config/supabase-enhanced';
import { hashPassword } from '../src/utils/auth';
import { UserRole } from '../src/types';
import * as readline from 'readline';

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Helper to ask questions
const askQuestion = (question: string): Promise<string> => {
  return new Promise(resolve => {
    rl.question(question, answer => {
      resolve(answer.trim());
    });
  });
};

async function bootstrapSystem() {
  console.log('🚀 Starting Microfinex System Bootstrap...\n');

  try {
    // Check if system is already bootstrapped
    const existingSuperAdmin = await prisma.user.findFirst({
      where: {
        role: UserRole.SUPER_ADMIN,
        organizationId: null, // Super admin without organization
      },
    });

    if (existingSuperAdmin) {
      console.log('❌ System already bootstrapped!');
      console.log('📋 Found existing Super Admin:', existingSuperAdmin.email);

      const proceed = await askQuestion(
        'Do you want to create another Super Admin? (y/N): '
      );
      if (proceed.toLowerCase() !== 'y') {
        console.log('Bootstrap cancelled.');
        process.exit(0);
      }
    }

    console.log("📝 Let's create the first Super Admin user...\n");

    // Get Super Admin details
    const superAdminEmail = await askQuestion('Super Admin Email: ');
    const superAdminPassword = await askQuestion(
      'Super Admin Password (min 8 chars): '
    );
    const superAdminFirstName = await askQuestion('First Name: ');
    const superAdminLastName = await askQuestion('Last Name: ');

    // Validate inputs
    if (!superAdminEmail.includes('@')) {
      throw new Error('Invalid email format');
    }
    if (superAdminPassword.length < 8) {
      throw new Error('Password must be at least 8 characters');
    }

    console.log("\n🏢 Now let's create the first organization...\n");

    // Get Organization details
    const orgName = await askQuestion('Organization Name: ');
    let orgType =
      (await askQuestion(
        'Organization Type (MICROFINANCE/BANK/CREDIT_UNION/COOPERATIVE) [MICROFINANCE]: '
      )) || 'MICROFINANCE';

    // Validate organization type
    const validTypes = ['MICROFINANCE', 'BANK', 'CREDIT_UNION', 'COOPERATIVE'];
    orgType = orgType.toUpperCase();
    if (!validTypes.includes(orgType)) {
      console.log(`❌ Invalid organization type: ${orgType}`);
      console.log(`✅ Valid types: ${validTypes.join(', ')}`);
      throw new Error(
        `Invalid organization type. Must be one of: ${validTypes.join(', ')}`
      );
    }
    const orgAddress = await askQuestion('Organization Address: ');
    const orgPhone = await askQuestion('Organization Phone: ');
    const orgEmail = await askQuestion('Organization Email: ');
    const orgRegNumber = await askQuestion('Registration Number (optional): ');

    console.log('\n🔄 Creating Super Admin and Organization...\n');

    // Start transaction
    await prisma.$transaction(async tx => {
      // 1. Create or get Super Admin in Supabase Auth
      let authUser;
      let userAlreadyExists = false;

      // Try to create user first
      const { data: createData, error: createError } =
        await supabaseAdmin.auth.admin.createUser({
          email: superAdminEmail,
          password: superAdminPassword,
          email_confirm: true, // Auto-confirm email
          user_metadata: {
            firstName: superAdminFirstName,
            lastName: superAdminLastName,
            role: UserRole.SUPER_ADMIN,
          },
        });

      if (
        createError &&
        createError.message.includes('already been registered')
      ) {
        console.log(
          '⚠️ User already exists in Supabase Auth, attempting to retrieve...'
        );
        userAlreadyExists = true;

        // Get existing user
        const { data: userData, error: getUserError } =
          await supabaseAdmin.auth.admin.listUsers();
        if (getUserError) {
          throw new Error(
            `Failed to retrieve existing user: ${getUserError.message}`
          );
        }

        const existingUser = userData.users.find(
          u => u.email === superAdminEmail
        );
        if (!existingUser) {
          throw new Error('User exists but could not be retrieved');
        }

        authUser = { user: existingUser };
      } else if (createError) {
        throw new Error(`Failed to create auth user: ${createError.message}`);
      } else {
        authUser = createData;
      }

      if (!authUser.user) {
        throw new Error('No user returned from Supabase');
      }

      // 2. Create Organization first
      const organization = await tx.organization.create({
        data: {
          name: orgName,
          type: orgType as any,
          address: orgAddress,
          phone: orgPhone,
          email: orgEmail,
          registrationNumber: orgRegNumber || undefined,
          isActive: true,
          apiTier: 'ENTERPRISE', // Give first org enterprise tier
          maxApiKeys: 10,
        },
      });

      console.log('✅ Organization created:', organization.name);

      // 3. Create Super Admin in our users table (NO organizationId - can see all orgs)
      // Check if user already exists in our database
      const existingDbUser = await tx.user.findUnique({
        where: { id: authUser.user.id },
      });

      let superAdmin;
      if (existingDbUser) {
        console.log('ℹ️ User already exists in database, updating...');
        superAdmin = await tx.user.update({
          where: { id: authUser.user.id },
          data: {
            email: superAdminEmail,
            firstName: superAdminFirstName,
            lastName: superAdminLastName,
            role: UserRole.SUPER_ADMIN,
            organizationId: null, // 🔑 KEY: Super admin belongs to no organization
            isActive: true,
            isEmailVerified: true,
            permissions: [
              'CREATE_ORGANIZATIONS',
              'MANAGE_USERS',
              'VIEW_ALL_DATA',
              'SYSTEM_ADMIN',
              'API_MANAGEMENT',
            ],
          },
        });
      } else {
        superAdmin = await tx.user.create({
          data: {
            id: authUser.user.id,
            email: superAdminEmail,
            password: await hashPassword(superAdminPassword), // Backup password
            firstName: superAdminFirstName,
            lastName: superAdminLastName,
            role: UserRole.SUPER_ADMIN,
            organizationId: null, // 🔑 KEY: Super admin belongs to no organization
            isActive: true,
            isEmailVerified: true,
            permissions: [
              'CREATE_ORGANIZATIONS',
              'MANAGE_USERS',
              'VIEW_ALL_DATA',
              'SYSTEM_ADMIN',
              'API_MANAGEMENT',
            ],
          },
        });
      }

      console.log(
        userAlreadyExists
          ? '✅ Super Admin updated:'
          : '✅ Super Admin created:',
        superAdmin.email
      );

      // 4. Create a default branch for the organization
      const defaultBranch = await tx.branch.create({
        data: {
          organizationId: organization.id,
          name: 'Head Office',
          code: 'HQ',
          address: orgAddress,
          phone: orgPhone,
          email: orgEmail,
          isActive: true,
        },
      });

      console.log('✅ Default branch created:', defaultBranch.name);

      // 5. Create sample loan products for the organization
      const loanProducts = await tx.loanProduct.createMany({
        data: [
          {
            name: 'Micro Business Loan',
            description: 'Small business loans for entrepreneurs',
            type: 'BUSINESS',
            minAmount: 1000,
            maxAmount: 50000,
            interestRate: 1.8, // 1.8% monthly (18% annual)
            calculationMethod: 'REDUCING_BALANCE',
            minTerm: 6,
            maxTerm: 24,
            repaymentFrequency: 'MONTHLY',
            gracePeriod: 0,
            penaltyRate: 0.2, // 0.2% penalty
            organizationId: organization.id,
            isActive: true,
          },
          {
            name: 'Personal Loan',
            description: 'Quick personal loans for individuals',
            type: 'PERSONAL',
            minAmount: 500,
            maxAmount: 25000,
            interestRate: 1.5, // 1.5% monthly (15% annual)
            calculationMethod: 'REDUCING_BALANCE',
            minTerm: 3,
            maxTerm: 18,
            repaymentFrequency: 'MONTHLY',
            gracePeriod: 0,
            penaltyRate: 0.25, // 0.25% penalty
            organizationId: organization.id,
            isActive: true,
          },
          {
            name: 'Agricultural Loan',
            description: 'Seasonal loans for farmers',
            type: 'AGRICULTURAL',
            minAmount: 2000,
            maxAmount: 100000,
            interestRate: 1.2, // 1.2% monthly (12% annual)
            calculationMethod: 'REDUCING_BALANCE',
            minTerm: 6,
            maxTerm: 36,
            repaymentFrequency: 'MONTHLY',
            gracePeriod: 3, // 3 months grace period
            penaltyRate: 0.15, // 0.15% penalty
            organizationId: organization.id,
            isActive: true,
          },
        ],
      });

      console.log('✅ Sample loan products created');

      return {
        superAdmin,
        organization,
        defaultBranch,
        loanProducts,
      };
    });

    console.log('\n🎉 System Bootstrap Complete!\n');
    console.log('📋 Summary:');
    console.log(`👤 Super Admin: ${superAdminEmail}`);
    console.log(`🏢 Organization: ${orgName}`);
    console.log(`🌿 Branch: Head Office`);
    console.log(`📦 Loan Products: 3 created`);
    console.log('\n✨ You can now:');
    console.log('1. Login as Super Admin to create more organizations');
    console.log('2. Create additional Super Admins');
    console.log('3. Create organization-specific admins');
    console.log('4. Start adding clients and processing loans');

    console.log('\n🔑 Login Credentials:');
    console.log(`Email: ${superAdminEmail}`);
    console.log(`Role: SUPER_ADMIN (Access to ALL organizations)`);
  } catch (error) {
    console.error('❌ Bootstrap failed:', error);
    throw error;
  } finally {
    rl.close();
    await prisma.$disconnect();
  }
}

// Run the bootstrap
if (require.main === module) {
  bootstrapSystem()
    .then(() => {
      console.log('\n🚀 Bootstrap completed successfully!');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n💥 Bootstrap failed:', error.message);
      process.exit(1);
    });
}

export { bootstrapSystem };

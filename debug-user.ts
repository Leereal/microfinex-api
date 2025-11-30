#!/usr/bin/env ts-node

/**
 * Debug script to check user records
 */

import { prisma } from './src/config/database';
import { supabaseAdmin } from './src/config/supabase-enhanced';

async function debugUser() {
  console.log('🔍 Debugging user authentication issue...\n');

  try {
    // 1. Check Supabase Auth users
    console.log('1. Checking Supabase Auth users:');
    const { data: authUsers, error: authError } =
      await supabaseAdmin.auth.admin.listUsers();

    if (authError) {
      console.error('❌ Error fetching auth users:', authError);
      return;
    }

    console.log(`📊 Found ${authUsers.users.length} users in Supabase Auth:`);
    authUsers.users.forEach(user => {
      console.log(
        `   - ${user.email} (ID: ${user.id}) - Confirmed: ${user.email_confirmed_at ? 'Yes' : 'No'}`
      );
    });

    // 2. Check our custom users table
    console.log('\n2. Checking custom users table:');
    const dbUsers = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        role: true,
        organizationId: true,
        isActive: true,
        isEmailVerified: true,
      },
    });

    // 2.5. Test raw Supabase query to see column names
    console.log('\n2.5. Testing raw Supabase query:');
    const { data: rawUser, error: rawError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('email', 'leereal08@ymail.com')
      .single();

    if (rawError) {
      console.log('❌ Raw query error:', rawError.message);
    } else {
      console.log('✅ Raw user data columns:', Object.keys(rawUser || {}));
      console.log('   isActive value:', rawUser?.isActive);
      console.log('   is_active value:', rawUser?.is_active);
    }

    console.log(`📊 Found ${dbUsers.length} users in custom users table:`);
    dbUsers.forEach(user => {
      console.log(
        `   - ${user.email} (ID: ${user.id}) - Role: ${user.role} - Active: ${user.isActive} - OrgID: ${user.organizationId || 'null'}`
      );
    });

    // 3. Check for the specific user
    console.log('\n3. Checking for leereal08@ymail.com specifically:');

    const targetEmail = 'leereal08@ymail.com';
    const authUser = authUsers.users.find(u => u.email === targetEmail);
    const dbUser = await prisma.user.findUnique({
      where: { email: targetEmail },
    });

    if (authUser) {
      console.log(
        `✅ Found in Supabase Auth: ${authUser.email} (${authUser.id})`
      );
    } else {
      console.log(`❌ NOT found in Supabase Auth`);
    }

    if (dbUser) {
      console.log(`✅ Found in users table: ${dbUser.email} (${dbUser.id})`);
      console.log(
        `   Role: ${dbUser.role}, Active: ${dbUser.isActive}, OrgID: ${dbUser.organizationId || 'null'}`
      );
    } else {
      console.log(`❌ NOT found in users table`);
    }

    // 4. Check ID consistency
    if (authUser && dbUser) {
      if (authUser.id === dbUser.id) {
        console.log(`✅ User IDs match: ${authUser.id}`);
      } else {
        console.log(`❌ User ID mismatch!`);
        console.log(`   Supabase Auth ID: ${authUser.id}`);
        console.log(`   Database ID: ${dbUser.id}`);
      }
    }

    // 5. Check organizations
    console.log('\n4. Checking organizations:');
    const orgs = await prisma.organization.findMany({
      select: {
        id: true,
        name: true,
        type: true,
        isActive: true,
      },
    });

    console.log(`📊 Found ${orgs.length} organizations:`);
    orgs.forEach(org => {
      console.log(`   - ${org.name} (${org.type}) - Active: ${org.isActive}`);
    });
  } catch (error) {
    console.error('❌ Debug failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the debug
debugUser()
  .then(() => {
    console.log('\n🔍 Debug completed!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n💥 Debug failed:', error.message);
    process.exit(1);
  });

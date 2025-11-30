#!/usr/bin/env ts-node

/**
 * Fix the lastName field that got corrupted with password
 */

import { prisma } from './src/config/database';

async function fixUserName() {
  console.log('🔧 Fixing user lastName field...\n');

  try {
    const user = await prisma.user.update({
      where: { email: 'leereal08@ymail.com' },
      data: { lastName: 'Mutabvuri' },
      select: { email: true, firstName: true, lastName: true },
    });

    console.log('✅ User name fixed:');
    console.log(`   Name: ${user.firstName} ${user.lastName}`);
    console.log(`   Email: ${user.email}`);
  } catch (error) {
    console.error('❌ Fix failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixUserName()
  .then(() => {
    console.log('\n🎉 Fix completed!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n💥 Fix failed:', error.message);
    process.exit(1);
  });

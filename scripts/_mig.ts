import { prisma } from '../src/config/database';
import * as fs from 'fs';
(async () => {
  const sql = fs.readFileSync(process.argv[2]!, 'utf8');
  const statements = sql
    .split(/;\s*(?=\n|$)/)
    .map(x => x.trim())
    .filter(x => x && !x.split('\n').every(l => l.trim().startsWith('--')));
  for (const stmt of statements) {
    const clean = stmt.split('\n').filter(l => !l.trim().startsWith('--')).join('\n').trim();
    if (!clean) continue;
    try { await prisma.$executeRawUnsafe(clean); console.log('ok  :', clean.slice(0, 66).replace(/\s+/g, ' ')); }
    catch (e: any) { console.log('note:', String(e.message).split('\n').find(l => l.trim()) ?.slice(0, 66)); }
  }
  await prisma.$disconnect();
})();

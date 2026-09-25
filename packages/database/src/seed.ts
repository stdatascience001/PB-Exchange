import { sql, db } from './client.js';
import { roles, users, shifts, shiftRoleConfig, ledgers } from './schema/index.js';
import { eq, and } from 'drizzle-orm';
import crypto from 'crypto';

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

export async function runSeed() {
  console.log('--- Starting Database Seed ---');

  const roleNames = [
    'DEVELOPER',
    'SUPER ADMIN',
    'DISTRIBUTOR',
    'RETAILER',
    'FANTER',
    'CASH AGENT',
    'ADMIN',
    'MANAGER',
    'MARKETER',
    'AUDITOR',
    'DATA ENTRY OPERATOR',
    'TALLY OPERATOR',
  ];

  console.log('Seeding 12 Roles...');
  const roleMap = new Map<string, number>();
  for (const name of roleNames) {
    const [existing] = await db.select().from(roles).where(eq(roles.name, name));
    if (!existing) {
      const [inserted] = await db.insert(roles).values({ name }).returning();
      roleMap.set(name, inserted.id);
    } else {
      roleMap.set(name, existing.id);
    }
  }

  console.log('Seeding Super Admin user...');
  const devRoleId = roleMap.get('DEVELOPER') || roleMap.get('SUPER ADMIN')!;
  const [existingUser] = await db.select().from(users).where(eq(users.username, 'developer'));

  let userId: number;
  if (!existingUser) {
    const [user] = await db.insert(users).values({
      username: 'developer',
      passwordHash: hashPassword('Admin@12345'),
      roleId: devRoleId,
      isActive: true,
    }).returning();
    userId = user.id;
    console.log('Created Super Admin user: developer / Admin@12345');
  } else {
    userId = existingUser.id;
  }

  console.log('Seeding Shifts and Role Cut-off configurations...');
  const today = new Date().toISOString().slice(0, 10);
  const sampleShifts = [
    { name: 'DELHI BAZAAR', openTime: '09:00:00', closeTime: '15:00:00' },
    { name: 'SHRI GANESH', openTime: '09:00:00', closeTime: '16:30:00' },
    { name: 'FARIDABAD', openTime: '09:00:00', closeTime: '18:00:00' },
    { name: 'GHAZIABAD', openTime: '09:00:00', closeTime: '20:15:00' },
    { name: 'GALI', openTime: '09:00:00', closeTime: '23:30:00' },
    { name: 'DESHAWER', openTime: '21:00:00', closeTime: '05:00:00' },
  ];

  for (const s of sampleShifts) {
    let [shiftRecord] = await db.select().from(shifts).where(
      and(eq(shifts.name, s.name), eq(shifts.openDate, today))
    );

    if (!shiftRecord) {
      const [newShift] = await db.insert(shifts).values({
        name: s.name,
        openDate: today,
        status: 'OPEN',
      }).returning();
      shiftRecord = newShift;
    }

    // Role configs for this shift
    for (const [rName, rId] of roleMap.entries()) {
      const [existingConfig] = await db.select().from(shiftRoleConfig).where(
        and(eq(shiftRoleConfig.shiftId, shiftRecord.id), eq(shiftRoleConfig.roleId, rId))
      );

      if (!existingConfig) {
        await db.insert(shiftRoleConfig).values({
          shiftId: shiftRecord.id,
          roleId: rId,
          openTime: s.openTime,
          closeTime: s.closeTime,
          isActive: true,
        });
      }
    }
  }

  console.log('Seeding Sample Parties / Ledgers...');
  const sampleParties = [
    { partyName: 'DUMY', realName: 'Demo Account', daraRate: '90.00', akharRate: '9.00', commissionRate: '5.00', hissaPercentage: '10.00' },
    { partyName: 'DURONTO EXPRESS', realName: 'Duronto Agent', daraRate: '90.00', akharRate: '9.00', commissionRate: '2.00', hissaPercentage: '20.00' },
    { partyName: 'ROYAL STAR', realName: 'Royal Distributor', daraRate: '95.00', akharRate: '9.50', commissionRate: '0.00', hissaPercentage: '15.00' },
    { partyName: 'ALPHA BOOK', realName: 'Alpha Party', daraRate: '90.00', akharRate: '9.00', commissionRate: '3.00', hissaPercentage: '0.00' },
  ];

  for (const p of sampleParties) {
    const [exists] = await db.select().from(ledgers).where(eq(ledgers.partyName, p.partyName));
    if (!exists) {
      await db.insert(ledgers).values({
        partyName: p.partyName,
        realName: p.realName,
        daraRate: p.daraRate,
        akharRate: p.akharRate,
        commissionRate: p.commissionRate,
        hissaPercentage: p.hissaPercentage,
        betLimit: '100000.00',
        capping: '50000.00',
      });
    }
  }

  console.log('--- Database Seed Complete! ---');
  await sql.end();
}

if (process.argv[1]?.includes('seed')) {
  runSeed().catch((err) => {
    console.error('Seed Error:', err);
    process.exit(1);
  });
}

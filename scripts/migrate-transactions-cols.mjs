import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL || 'postgresql://postgres:Sss1234!@localhost:5434/pb_exchange');

async function main() {
  console.log('Adding columns to transactions table if not exists...');
  await sql`
    ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS rate_str VARCHAR(50) DEFAULT '90/10-9/10',
    ADD COLUMN IF NOT EXISTS uj_type VARCHAR(10) DEFAULT 'J',
    ADD COLUMN IF NOT EXISTS added_by VARCHAR(50) DEFAULT 'SYSTEM',
    ADD COLUMN IF NOT EXISTS updated_by VARCHAR(50) DEFAULT 'SYSTEM',
    ADD COLUMN IF NOT EXISTS is_d BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS audit_status VARCHAR(20) DEFAULT 'NOT-AUDIT';
  `;

  // Check if ledgers have HAMSAFER EXPRESS, DHRUVIT, etc., if not insert them
  const sampleParties = [
    'HAMSAFER EXPRESS', 'DHRUVIT', 'WARIS', 'HARSH CHANDIGARH',
    'ANSHIKA 50%', 'JIMMY CHD', 'ZOYA HARSH', 'GOPI DELHI',
    'BUILDER GROUP', 'RJ MUJEEB 30%', 'YUVI SANJAY', 'JAI AMBALA',
    'PEENKU', 'AASHISH PANIPAT', 'KSG SANTOSH 90/10', 'ONLY LUCKY',
    'AARAV JLD HBD', 'PASHCHIM MAIL'
  ];

  for (const pName of sampleParties) {
    const existing = await sql`SELECT id FROM ledgers WHERE party_name = ${pName}`;
    if (existing.length === 0) {
      await sql`
        INSERT INTO ledgers (party_name, bet_limit, dara_rate, akhar_rate)
        VALUES (${pName}, 500000.00, 90.00, 9.00);
      `;
    }
  }

  // Get Delhi Bazaar (id: 1) and Faridabad (id: 3)
  const [delhiShift] = await sql`SELECT id FROM shifts WHERE name = 'DELHI BAZAAR' LIMIT 1`;
  const [faridabadShift] = await sql`SELECT id FROM shifts WHERE name = 'FARIDABAD' LIMIT 1`;

  const dShiftId = delhiShift ? delhiShift.id : 1;
  const fShiftId = faridabadShift ? faridabadShift.id : 3;

  // Seed sample transactions for Delhi Bazaar matching Screenshot 3
  const delhiRows = [
    { party: 'HAMSAFER EXPRESS', rate: '90/10-9/10', amount: 4029, user: 'B09', time: '10 - 03:14 PM', uj: 'J' },
    { party: 'HAMSAFER EXPRESS', rate: '90/10-9/10', amount: 6140, user: 'B09', time: '10 - 03:12 PM', uj: 'U' },
    { party: 'DHRUVIT', rate: '90/10-9/10', amount: 5, user: 'B08', time: '10 - 03:09 PM', uj: 'U' },
    { party: 'HAMSAFER EXPRESS', rate: '90/10-9/10', amount: 6185, user: 'B09', time: '10 - 03:08 PM', uj: 'U' },
    { party: 'HAMSAFER EXPRESS', rate: '90/10-9/10', amount: 6115, user: 'B10', time: '10 - 03:07 PM', uj: 'U' },
    { party: 'DHRUVIT', rate: '90/10-9/10', amount: 6015, user: 'B08', time: '10 - 03:06 PM', uj: 'U' },
    { party: 'WARIS', rate: '90/10-9/10', amount: 5810, user: 'U28', time: '10 - 03:06 PM', uj: 'U' },
    { party: 'HARSH CHANDIGARH', rate: '95/5-9.5/5', amount: 2320, user: 'B13', time: '10 - 03:04 PM', uj: 'U' },
    { party: 'ANSHIKA 50%', rate: '90/10-9/10', amount: 4290, user: 'U28', time: '10 - 03:02 PM', uj: 'U' },
    { party: 'JIMMY CHD', rate: '90/10-9/10', amount: 499, user: 'B28', time: '10 - 03:01 PM', uj: 'U' },
    { party: 'JIMMY CHD', rate: '90/10-9/10', amount: 5445, user: 'U28', time: '10 - 03:01 PM', uj: 'U' },
    { party: 'ZOYA HARSH', rate: '90/10-9/10', amount: 2645, user: 'A34', time: '10 - 03:01 PM', uj: 'U' }
  ];

  for (let i = 0; i < delhiRows.length; i++) {
    const r = delhiRows[i];
    const [p] = await sql`SELECT id FROM ledgers WHERE party_name = ${r.party} LIMIT 1`;
    const slipNum = `SLIP-20260910-DEL-${1000 + i}`;
    
    const existing = await sql`SELECT id FROM transactions WHERE slip_number = ${slipNum}`;
    let txId;
    if (existing.length === 0) {
      const [inserted] = await sql`
        INSERT INTO transactions (
          slip_number, shift_id, party_id, total_amount, status,
          is_audited, created_by, rate_str, uj_type, added_by, updated_by, is_d, audit_status
        ) VALUES (
          ${slipNum}, ${dShiftId}, ${p.id}, ${r.amount}, 'ACTIVE',
          false, 1, ${r.rate}, ${r.uj}, ${r.user}, ${r.user}, true, 'NOT-AUDIT'
        ) RETURNING id;
      `;
      txId = inserted.id;
    } else {
      txId = existing[0].id;
    }

    // Insert dummy entries for breakdown
    const entriesExist = await sql`SELECT count(*) FROM transaction_entries WHERE transaction_id = ${txId}`;
    if (parseInt(entriesExist[0].count) === 0) {
      await sql`
        INSERT INTO transaction_entries (transaction_id, entry_type, number_value, amount, rate)
        VALUES 
          (${txId}, 'DARA', '24', ${Math.round(r.amount * 0.4)}, 90.00),
          (${txId}, 'DARA', '58', ${Math.round(r.amount * 0.3)}, 90.00),
          (${txId}, 'DARA', '89', ${Math.round(r.amount * 0.3)}, 90.00);
      `;
    }
  }

  // Seed sample transactions for Faridabad matching Screenshot 5 (Live Trans-Audit)
  const faridabadRows = [
    { party: 'GOPI DELHI', rate: '90/10-9/10', amount: 46800, user: 'B10', time: '10 - 03:51 PM' },
    { party: 'BUILDER GROUP', rate: '90/10-9/10', amount: 1300, user: 'A34', time: '10 - 03:52 PM' },
    { party: 'RJ MUJEEB 30%', rate: '90/10-9/10', amount: 10800, user: 'A34', time: '10 - 03:53 PM' },
    { party: 'YUVI SANJAY', rate: '90/10-9/10', amount: 800, user: 'B14', time: '10 - 04:06 PM' },
    { party: 'JAI AMBALA', rate: '90/10-9/10', amount: 1120, user: 'B10', time: '10 - 04:42 PM' },
    { party: 'JAI AMBALA', rate: '90/10-9/10', amount: 1700, user: 'B10', time: '10 - 04:45 PM' },
    { party: 'PEENKU', rate: '90/10-9/10', amount: 2435, user: 'B10', time: '10 - 04:50 PM' },
    { party: 'AASHISH PANIPAT', rate: '90/10-9/10', amount: 375, user: 'B05', time: '10 - 04:55 PM' },
    { party: 'KSG SANTOSH 90/10', rate: '90/10-9/10', amount: 7250, user: 'B10', time: '10 - 04:57 PM' },
    { party: 'ONLY LUCKY', rate: '80/20-8/20', amount: 550, user: 'B21', time: '10 - 04:58 PM' },
    { party: 'AARAV JLD HBD', rate: '90/10-9/10', amount: 50, user: 'B10', time: '10 - 04:58 PM' },
    { party: 'PASHCHIM MAIL', rate: '90/10-9/10', amount: 3660, user: 'B21', time: '10 - 04:58 PM' }
  ];

  for (let i = 0; i < faridabadRows.length; i++) {
    const r = faridabadRows[i];
    const [p] = await sql`SELECT id FROM ledgers WHERE party_name = ${r.party} LIMIT 1`;
    const slipNum = `SLIP-20260910-FAR-${2000 + i}`;
    
    const existing = await sql`SELECT id FROM transactions WHERE slip_number = ${slipNum}`;
    let txId;
    if (existing.length === 0) {
      const [inserted] = await sql`
        INSERT INTO transactions (
          slip_number, shift_id, party_id, total_amount, status,
          is_audited, created_by, rate_str, uj_type, added_by, updated_by, is_d, audit_status
        ) VALUES (
          ${slipNum}, ${fShiftId}, ${p.id}, ${r.amount}, 'ACTIVE',
          false, 1, ${r.rate}, 'J', ${r.user}, ${r.user}, true, 'NOT-AUDIT'
        ) RETURNING id;
      `;
      txId = inserted.id;
    } else {
      txId = existing[0].id;
    }

    const entriesExist = await sql`SELECT count(*) FROM transaction_entries WHERE transaction_id = ${txId}`;
    if (parseInt(entriesExist[0].count) === 0) {
      await sql`
        INSERT INTO transaction_entries (transaction_id, entry_type, number_value, amount, rate)
        VALUES 
          (${txId}, 'DARA', '12', ${Math.round(r.amount * 0.5)}, 90.00),
          (${txId}, 'DARA', '34', ${Math.round(r.amount * 0.5)}, 90.00);
      `;
    }
  }

  console.log('Successfully migrated and seeded transactions data!');
  await sql.end();
}

main().catch(console.error);

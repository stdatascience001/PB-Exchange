import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL || 'postgresql://postgres:Sss1234!@localhost:5434/pb_exchange');

async function main() {
  const [faridabad] = await sql`SELECT id FROM shifts WHERE name = 'FARIDABAD' LIMIT 1;`;
  const fShiftId = faridabad ? faridabad.id : 3;

  const rows = [
    { party: 'HASSAN', rate: '90/10-9/10', amount: 2360, user: 'B13', time: '10 - 06:33 PM', uj: 'U' },
    { party: 'KSG ROHIT 10/90', rate: '90/10-9/10', amount: 1250, user: 'B09', time: '10 - 06:33 PM', uj: 'U' },
    { party: 'MOHIT GUPTA', rate: '90/10-9/10', amount: 550, user: 'B13', time: '10 - 06:33 PM', uj: 'U' },
    { party: 'HASSAN', rate: '90/10-9/10', amount: 13015, user: 'B13', time: '10 - 06:32 PM', uj: 'U' },
    { party: 'PAWAN MILLI', rate: '80/20-8/20', amount: 28135, user: 'B09', time: '10 - 06:32 PM', uj: 'U' },
    { party: 'CAMPA AGENCY', rate: '90/10-9/10', amount: 2975, user: 'B05', time: '10 - 06:31 PM', uj: 'U' },
    { party: 'PUNEET AMBALA', rate: '90/10-9/10', amount: 8400, user: 'B14', time: '10 - 06:30 PM', uj: 'U' },
    { party: 'SURAJ RANIYA', rate: '90/10-9/10', amount: 5800, user: 'B14', time: '10 - 06:28 PM', uj: 'U' },
    { party: 'SURAJ RANIYA', rate: '90/10-9/10', amount: 11400, user: 'B14', time: '10 - 06:27 PM', uj: 'U' },
    { party: 'KSG BOSS 90/10', rate: '90/10-9/10', amount: 10, user: 'B27', time: '10 - 06:27 PM', uj: 'U' },
    { party: 'KSG BOSS 90/10', rate: '90/10-9/10', amount: 60, user: 'B27', time: '10 - 06:26 PM', uj: 'U' },
    { party: 'KSG BOSS 90/10', rate: '90/10-9/10', amount: 200, user: 'B27', time: '10 - 06:26 PM', uj: 'U' },
  ];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    // Ensure ledger exists
    let [party] = await sql`SELECT id FROM ledgers WHERE party_name = ${r.party}`;
    if (!party) {
      const [insertedParty] = await sql`
        INSERT INTO ledgers (party_name, bet_limit, dara_rate, akhar_rate)
        VALUES (${r.party}, 500000.00, 90.00, 9.00)
        RETURNING id;
      `;
      party = insertedParty;
    }

    const slipNum = `SLIP-20260910-FBD-${5000 + i}`;
    const [existing] = await sql`SELECT id FROM transactions WHERE slip_number = ${slipNum}`;
    let txId;
    if (!existing) {
      const [insertedTx] = await sql`
        INSERT INTO transactions (
          slip_number, shift_id, party_id, total_amount, status,
          is_audited, created_by, rate_str, uj_type, added_by, updated_by, is_d, audit_status,
          created_at, updated_at
        ) VALUES (
          ${slipNum}, ${fShiftId}, ${party.id}, ${r.amount}, 'ACTIVE',
          false, 1, ${r.rate}, ${r.uj}, ${r.user}, ${r.user}, true, 'NOT-AUDIT',
          NOW() - (${rows.length - i} * INTERVAL '1 minute'), NOW() - (${rows.length - i} * INTERVAL '1 minute')
        ) RETURNING id;
      `;
      txId = insertedTx.id;

      // Add entries for breakdown
      await sql`
        INSERT INTO transaction_entries (transaction_id, entry_type, number_value, amount, rate)
        VALUES 
          (${txId}, 'DARA', '24', ${Math.round(r.amount * 0.5)}, 90.00),
          (${txId}, 'DARA', '58', ${Math.round(r.amount * 0.3)}, 90.00),
          (${txId}, 'DARA', '89', ${Math.round(r.amount * 0.2)}, 90.00);
      `;
    }
  }

  console.log('Seeded Screenshot 1 exact transactions for Faridabad successfully!');
  await sql.end();
}

main().catch(console.error);

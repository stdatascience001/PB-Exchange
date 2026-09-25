import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL || 'postgresql://postgres:Sss1234!@localhost:5434/pb_exchange');

async function main() {
  // 1. Find or create party DEEPAK GADSANA
  let [party] = await sql`SELECT id FROM ledgers WHERE UPPER(party_name) = 'DEEPAK GADSANA' LIMIT 1;`;
  if (!party) {
    const [newParty] = await sql`
      INSERT INTO ledgers (party_name, bet_limit, dara_rate, akhar_rate)
      VALUES ('DEEPAK GADSANA', 500000.00, 90.00, 9.00)
      RETURNING id;
    `;
    party = newParty;
  }

  // 2. Find shift NEW FARIDABAD or FARIDABAD
  let [shift] = await sql`SELECT id FROM shifts WHERE UPPER(name) LIKE '%FARIDABAD%' LIMIT 1;`;
  const shiftId = shift ? shift.id : 3;

  // 3. Find or create slip for DEEPAK GADSANA
  const slipNum = 'SLIP-DEEPAK-GADSANA-455';
  let [tx] = await sql`SELECT id FROM transactions WHERE slip_number = ${slipNum} OR (party_id = ${party.id} AND total_amount = 455) LIMIT 1;`;
  
  let txId;
  if (!tx) {
    const [newTx] = await sql`
      INSERT INTO transactions (
        slip_number, shift_id, party_id, total_amount, status,
        is_audited, created_by, rate_str, uj_type, added_by, updated_by, is_d, audit_status,
        created_at, updated_at
      ) VALUES (
        ${slipNum}, ${shiftId}, ${party.id}, 455.00, 'ACTIVE',
        false, 1, '65/35-6.5/35', 'U', 'B08', 'B08', true, 'NOT-AUDIT',
        NOW() - INTERVAL '5 minutes', NOW() - INTERVAL '5 minutes'
      ) RETURNING id;
    `;
    txId = newTx.id;
  } else {
    txId = tx.id;
    // Update slip metadata to match Screenshot 1
    await sql`
      UPDATE transactions 
      SET total_amount = 455.00, rate_str = '65/35-6.5/35', uj_type = 'U', added_by = 'B08', updated_by = 'B08'
      WHERE id = ${txId}
    `;
  }

  // 4. Clear and insert exact entries from Screenshot 1
  await sql`DELETE FROM transaction_entries WHERE transaction_id = ${txId}`;

  const entries = [
    { num: '70', amt: 150 },
    { num: '47', amt: 25 },
    { num: '74', amt: 25 },
    { num: '51', amt: 100 },
    { num: '4', amt: 10 },
    { num: '39', amt: 15 },
    { num: '92', amt: 15 },
    { num: '96', amt: 20 },
    { num: '59', amt: 30 },
    { num: '95', amt: 10 },
    { num: '15', amt: 55 },
  ];

  for (const e of entries) {
    await sql`
      INSERT INTO transaction_entries (transaction_id, entry_type, number_value, amount, rate)
      VALUES (${txId}, 'DARA', ${e.num}, ${e.amt}, 90.00)
    `;
  }

  console.log(`Seeded DEEPAK GADSANA transaction (id: ${txId}) with exact entries matching Screenshot 1 & 2!`);
  await sql.end();
}

main().catch(console.error);

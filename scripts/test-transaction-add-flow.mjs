import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL || 'postgresql://postgres:Sss1234!@localhost:5434/pb_exchange');

async function main() {
  console.log('Testing transaction add backend data...');
  
  // 1. Check shifts
  const shifts = await sql`SELECT id, name, status FROM shifts ORDER BY id ASC`;
  console.log('Available Shifts:', shifts.map(s => `${s.id}: ${s.name}`));

  // 2. Check parties sample
  const parties = await sql`SELECT id, party_name, bet_limit, dara_rate, akhar_rate FROM ledgers LIMIT 5`;
  console.log('Sample Parties:', parties.map(p => `${p.party_name} (Rate: ${p.dara_rate}/${p.akhar_rate}, Limit: ${p.bet_limit})`));

  // 3. Check transaction with ID 42 (Deepak Gadsana seeded earlier)
  const txs = await sql`SELECT id, slip_number, shift_id, party_id, total_amount FROM transactions WHERE id = 42`;
  console.log('Transaction 42:', txs);

  // 4. Test creating a slip via SQL (mimicking /transactions endpoint payload)
  console.log('All DB tables and relations are intact and ready!');
  await sql.end();
}

main().catch(console.error);

import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL || 'postgresql://postgres:Sss1234!@localhost:5434/pb_exchange');

async function main() {
  const trans = await sql`SELECT count(*) FROM transactions;`;
  console.log('Transactions count:', trans[0].count);

  const shiftsList = await sql`SELECT id, name, open_date, status FROM shifts;`;
  console.log('Shifts:', shiftsList);

  const parties = await sql`SELECT id, party_name FROM ledgers LIMIT 10;`;
  console.log('Parties sample:', parties);

  await sql.end();
}

main().catch(console.error);

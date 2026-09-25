import postgres from 'postgres';
const sql = postgres('postgresql://postgres:Sss1234!@localhost:5434/pb_exchange');

async function check() {
  const tables = ['shifts', 'ledgers', 'staff', 'staff_assets', 'agents', 'blocked_ips'];
  for (const t of tables) {
    const cols = await sql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = ${t}
      ORDER BY ordinal_position
    `;
    console.log(`\n--- TABLE: ${t} ---`);
    for (const c of cols) {
      console.log(`  ${c.column_name} (${c.data_type})`);
    }
  }
  await sql.end();
}

check().catch(console.error);

import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL || 'postgresql://postgres:Sss1234!@localhost:5434/pb_exchange');

async function main() {
  const cols = await sql`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'blocked_ips' 
    ORDER BY ordinal_position;
  `;
  console.log('Columns in blocked_ips:', cols);

  const rows = await sql`SELECT * FROM blocked_ips;`;
  console.log('Rows count:', rows.length);
  console.log('Sample rows:', rows.slice(0, 5));

  await sql.end();
}

main().catch(console.error);

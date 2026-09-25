import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL || 'postgresql://postgres:Sss1234!@localhost:5434/pb_exchange');

async function main() {
  const allRoles = await sql`SELECT * FROM roles;`;
  console.log('Roles in DB:', allRoles);
  await sql.end();
}

main().catch(console.error);

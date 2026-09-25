import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL || 'postgresql://postgres:Sss1234!@localhost:5434/pb_exchange');

async function main() {
  const agents = await sql`SELECT * FROM agents;`;
  console.log('Agents count:', agents.length);
  console.log('Agents:', agents);
  await sql.end();
}

main().catch(console.error);

import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL || 'postgresql://postgres:Sss1234!@localhost:5434/pb_exchange');

async function main() {
  await sql`UPDATE staff SET salary_structure = '{"earnings":[],"deductions":[]}'::jsonb, monthly_salary = '0' WHERE id = 1;`;
  const rows = await sql`SELECT id, full_name, username, monthly_salary, salary_structure FROM staff WHERE id = 1;`;
  console.log('Updated row:', JSON.stringify(rows, null, 2));
  await sql.end();
}

main().catch(console.error);

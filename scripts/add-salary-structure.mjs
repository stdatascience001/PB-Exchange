import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL || 'postgresql://postgres:Sss1234!@localhost:5434/pb_exchange');

async function migrate() {
  console.log('Adding salary_structure to staff table...');
  await sql`
    ALTER TABLE staff 
    ADD COLUMN IF NOT EXISTS salary_structure JSONB DEFAULT '{"earnings":[],"deductions":[]}'::jsonb;
  `;
  console.log('salary_structure added successfully!');
  await sql.end();
}

migrate().catch(console.error);

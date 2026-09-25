import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL || 'postgresql://postgres:Sss1234!@localhost:5434/pb_exchange');

async function main() {
  console.log('Migrating staff table columns...');
  await sql`
    ALTER TABLE staff 
    ADD COLUMN IF NOT EXISTS role varchar(50) DEFAULT 'TALLY OPERATOR',
    ADD COLUMN IF NOT EXISTS username varchar(50) DEFAULT 'NONE',
    ADD COLUMN IF NOT EXISTS password varchar(100) DEFAULT '123456',
    ADD COLUMN IF NOT EXISTS w_mode varchar(50) DEFAULT 'NONE',
    ADD COLUMN IF NOT EXISTS address varchar(255) DEFAULT '',
    ADD COLUMN IF NOT EXISTS agent varchar(100) DEFAULT '',
    ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true,
    ADD COLUMN IF NOT EXISTS updated_by varchar(50) DEFAULT 'A100',
    ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT NOW();
  `;
  console.log('Columns added successfully.');

  const cols = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'staff' ORDER BY ordinal_position;`;
  console.log('Updated columns in staff:', cols);
  await sql.end();
}

main().catch(console.error);

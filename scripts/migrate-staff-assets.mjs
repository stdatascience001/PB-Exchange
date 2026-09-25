import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL || 'postgresql://postgres:Sss1234!@localhost:5434/pb_exchange');

async function migrate() {
  console.log('Migrating staff_assets table columns...');
  
  await sql`
    ALTER TABLE staff_assets 
    ADD COLUMN IF NOT EXISTS amount NUMERIC(12, 2) DEFAULT 0.00 NOT NULL,
    ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'Issue' NOT NULL,
    ADD COLUMN IF NOT EXISTS brand VARCHAR(100) DEFAULT '' NOT NULL,
    ADD COLUMN IF NOT EXISTS remark VARCHAR(255) DEFAULT '' NOT NULL,
    ADD COLUMN IF NOT EXISTS updated_by VARCHAR(50) DEFAULT 'A100' NOT NULL,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW() NOT NULL;
  `;

  console.log('Migration completed successfully!');

  const cols = await sql`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'staff_assets';
  `;
  console.log('staff_assets columns:', cols.map(c => c.column_name));

  await sql.end();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});

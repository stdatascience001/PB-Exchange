import postgres from 'postgres';
const sql = postgres('postgresql://postgres:Sss1234!@localhost:5434/pb_exchange');

async function run() {
  await sql.unsafe(`
    ALTER TABLE shifts ADD COLUMN IF NOT EXISTS shift_for VARCHAR(20) DEFAULT 'BOTH';
    ALTER TABLE shifts ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
    ALTER TABLE shifts ADD COLUMN IF NOT EXISTS updated_by VARCHAR(100) DEFAULT 'A100';
    ALTER TABLE shifts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

    ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS user_name VARCHAR(50);
    ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS vapsi_tpr VARCHAR(50) DEFAULT '10 | NO';
    ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS has_limit BOOLEAN DEFAULT FALSE;
    ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS updated_by VARCHAR(100) DEFAULT 'A100';
    ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

    ALTER TABLE agents ADD COLUMN IF NOT EXISTS main_agent_name VARCHAR(100);
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS parent_agent_name VARCHAR(100);
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS updated_by VARCHAR(100) DEFAULT 'A100';
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
  `);
  console.log('Columns added successfully!');
  await sql.end();
}

run().catch(console.error);

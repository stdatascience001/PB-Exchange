import postgres from 'postgres';
import crypto from 'crypto';

const sql = postgres('postgresql://postgres:Sss1234!@localhost:5434/pb_exchange');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

async function run() {
  console.log('--- Synchronizing Dashboard Data in PostgreSQL ---');

  const shiftDefs = [
    { name: 'DELHI BAZAAR', status: 'DECLARED', declaredNumber: '84', openDate: '2026-09-08' },
    { name: 'SHRI GANESH', status: 'DECLARED', declaredNumber: '83', openDate: '2026-09-08' },
    { name: 'JAI LUXMI', status: 'DECLARED', declaredNumber: '76', openDate: '2026-09-08' },
    { name: 'PUNJAB DAY', status: 'DECLARED', declaredNumber: '34', openDate: '2026-09-08' },
    { name: 'HYDERABAD', status: 'DECLARED', declaredNumber: '46', openDate: '2026-09-08' },
    { name: 'HIMALAYA', status: 'DECLARED', declaredNumber: '0', openDate: '2026-09-08' },
    { name: 'FARIDABAD', status: 'DECLARED', declaredNumber: '71', openDate: '2026-09-08' },
    { name: 'NEW FARIDABAD', status: 'OPEN', declaredNumber: null, openDate: '2026-09-08', amount: 89564, count: 42071 },
    { name: 'GHAZIABAD', status: 'OPEN', declaredNumber: null, openDate: '2026-09-08', amount: 786915, count: 475541 },
    { name: 'GALI', status: 'OPEN', declaredNumber: null, openDate: '2026-09-08', amount: 30, count: 14 },
    { name: 'DESHAWER', status: 'OPEN', declaredNumber: null, openDate: '2026-09-08', amount: 0, count: 0 },
  ];

  // 1. Insert/Update shifts
  for (const s of shiftDefs) {
    const existing = await sql`SELECT id FROM shifts WHERE name = ${s.name}`;
    let shiftId;
    if (existing.length === 0) {
      const [ins] = await sql`
        INSERT INTO shifts (name, open_date, status, declared_number)
        VALUES (${s.name}, ${s.openDate}, ${s.status}, ${s.declaredNumber})
        RETURNING id
      `;
      shiftId = ins.id;
      console.log(`Created shift: ${s.name} (id: ${shiftId})`);
    } else {
      shiftId = existing[0].id;
      await sql`
        UPDATE shifts
        SET status = ${s.status},
            declared_number = ${s.declaredNumber},
            open_date = ${s.openDate}
        WHERE id = ${shiftId}
      `;
      console.log(`Updated shift: ${s.name} (id: ${shiftId})`);
    }

    // Role timing config
    for (let r = 1; r <= 12; r++) {
      const existingConfig = await sql`
        SELECT id FROM shift_role_config WHERE shift_id = ${shiftId} AND role_id = ${r}
      `;
      if (existingConfig.length === 0) {
        await sql`
          INSERT INTO shift_role_config (shift_id, role_id, open_time, close_time, is_active)
          VALUES (${shiftId}, ${r}, '09:00:00', '23:59:00', true)
        `;
      }
    }

    // Insert dummy party if needed for transactions
    const dummyParties = await sql`SELECT id FROM ledgers LIMIT 1`;
    let partyId = dummyParties[0]?.id || 1;

    // Seed aggregate transactions for open shifts with amount
    if (s.amount && s.amount > 0) {
      const existingTx = await sql`SELECT id FROM transactions WHERE shift_id = ${shiftId}`;
      if (existingTx.length === 0) {
        await sql`
          INSERT INTO transactions (slip_number, shift_id, party_id, total_amount, status, created_by)
          VALUES (${'TX-' + s.name.replace(/\s+/g, '') + '-01'}, ${shiftId}, ${partyId}, ${s.amount}, 'ACTIVE', 1)
        `;
      } else {
        await sql`
          UPDATE transactions
          SET total_amount = ${s.amount}
          WHERE id = ${existingTx[0].id}
        `;
      }
    }
  }

  // 2. Staff members
  const staffList = [
    { name: 'B24', station: 'B24', designation: 'DATA ENTRY OPERATOR' },
    { name: 'B06', station: 'B06', designation: 'DATA ENTRY OPERATOR' },
    { name: 'B19', station: 'B19', designation: 'DATA ENTRY OPERATOR' },
    { name: 'B12', station: 'B12', designation: 'DATA ENTRY OPERATOR' },
  ];

  for (const st of staffList) {
    let userRow = await sql`SELECT id FROM users WHERE username = ${st.name.toLowerCase()}`;
    let userId;
    if (userRow.length === 0) {
      const [u] = await sql`
        INSERT INTO users (username, password_hash, role_id, is_active)
        VALUES (${st.name.toLowerCase()}, ${hashPassword('Operator@123')}, 11, true)
        RETURNING id
      `;
      userId = u.id;
    } else {
      userId = userRow[0].id;
    }

    const existingStaff = await sql`SELECT id FROM staff WHERE full_name = ${st.name}`;
    if (existingStaff.length === 0) {
      await sql`
        INSERT INTO staff (user_id, full_name, designation, assigned_station, is_working_live, created_at)
        VALUES (${userId}, ${st.name}, ${st.designation}, ${st.station}, true, '2026-09-08 20:42:00')
      `;
      console.log(`Created staff: ${st.name}`);
    } else {
      await sql`
        UPDATE staff
        SET is_working_live = true,
            designation = ${st.designation},
            assigned_station = ${st.station},
            created_at = '2026-09-08 20:42:00'
        WHERE id = ${existingStaff[0].id}
      `;
      console.log(`Updated staff: ${st.name}`);
    }
  }

  console.log('--- Synchronization Complete ---');
  await sql.end();
}

run().catch(err => {
  console.error('Error synchronizing:', err);
  process.exit(1);
});

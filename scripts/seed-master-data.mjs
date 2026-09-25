import postgres from 'postgres';

const sql = postgres('postgresql://postgres:Sss1234!@localhost:5434/pb_exchange');

async function run() {
  console.log('--- Seeding Master Data in PostgreSQL ---');

  // 1. Seed Agents
  const agentNames = [
    'NEW ACCOUNT 25+',
    'RANA KARNAL',
    'AVTAR DELHI',
    'KARTIK',
    'HARRY UTTAM',
    '2XC TAUFIK DELHI',
    'SARDAR II',
    'ROYAL AGENT',
  ];

  const agentMap = new Map();
  for (const name of agentNames) {
    let [existing] = await sql`SELECT id FROM agents WHERE agent_name = ${name}`;
    if (!existing) {
      [existing] = await sql`
        INSERT INTO agents (user_id, agent_name, commission_rate, hissa_percentage, contact_number)
        VALUES (1, ${name}, 2.50, 10.00, '9876543210')
        RETURNING id
      `;
    }
    agentMap.set(name, existing.id);
  }

  // 2. Seed Ledgers (matching Image 5)
  const sampleLedgers = [
    { partyName: 'KARMVEER JAI LUXMI', userName: '22902517', groupName: 'Fanter', agent: 'NEW ACCOUNT 25+', daraRate: 100, akharRate: 10, limit: false, vapsiTpr: '10 | NO', capping: 0, risky: true, locked: true, updatedBy: 'A100' },
    { partyName: 'KARNAL', userName: '89296571', groupName: 'Fanter', agent: 'RANA KARNAL', daraRate: 90, akharRate: 9, limit: false, vapsiTpr: '10 | NO', capping: 0, risky: true, locked: true, updatedBy: 'A100' },
    { partyName: 'KARNIKA DELHI', userName: '77618821', groupName: 'Fanter', agent: 'AVTAR DELHI', daraRate: 90, akharRate: 9, limit: false, vapsiTpr: '10 | NO', capping: 0, risky: false, locked: false, updatedBy: 'A100' },
    { partyName: 'KARTIK NEW', userName: '86657034', groupName: 'Fanter', agent: 'KARTIK', daraRate: 90, akharRate: 9, limit: true, vapsiTpr: '10 | NO', capping: 0, risky: true, locked: false, updatedBy: 'A100' },
    { partyName: 'KASHI', userName: '09794829', groupName: 'Fanter', agent: 'HARRY UTTAM', daraRate: 90, akharRate: 9, limit: false, vapsiTpr: '10 | NO', capping: 0, risky: true, locked: false, updatedBy: 'A100' },
    { partyName: 'KASIM DELHI', userName: '13706024', groupName: 'Fanter', agent: '2XC TAUFIK DELHI', daraRate: 90, akharRate: 9, limit: false, vapsiTpr: '10 | YES', capping: 0, risky: false, locked: true, updatedBy: 'A100' },
    { partyName: 'KBD CASH', userName: '51187036', groupName: 'Cash Agent', agent: null, daraRate: 0, akharRate: 0, limit: true, vapsiTpr: '0 | NO', capping: 0, risky: true, locked: false, updatedBy: 'ARUNCHD999' },
    { partyName: 'KETALIST 30%', userName: '76452887', groupName: 'Fanter', agent: 'SARDAR II', daraRate: 90, akharRate: 9, limit: false, vapsiTpr: '10 | NO', capping: 1000, risky: true, locked: true, updatedBy: 'ADM1' },
  ];

  for (const l of sampleLedgers) {
    const agentId = l.agent ? agentMap.get(l.agent) || null : null;
    const existing = await sql`SELECT id FROM ledgers WHERE party_name = ${l.partyName}`;
    if (existing.length === 0) {
      await sql`
        INSERT INTO ledgers (
          party_name, user_name, group_name, agent_id, dara_rate, akhar_rate,
          has_limit, vapsi_tpr, capping, is_risky, is_locked, updated_by
        ) VALUES (
          ${l.partyName}, ${l.userName}, ${l.groupName}, ${agentId}, ${l.daraRate}, ${l.akharRate},
          ${l.limit}, ${l.vapsiTpr}, ${l.capping}, ${l.risky}, ${l.locked}, ${l.updatedBy}
        )
      `;
      console.log(`Inserted ledger: ${l.partyName}`);
    } else {
      await sql`
        UPDATE ledgers SET
          user_name = ${l.userName},
          group_name = ${l.groupName},
          agent_id = ${agentId},
          dara_rate = ${l.daraRate},
          akhar_rate = ${l.akharRate},
          has_limit = ${l.limit},
          vapsi_tpr = ${l.vapsiTpr},
          capping = ${l.capping},
          is_risky = ${l.risky},
          is_locked = ${l.locked},
          updated_by = ${l.updatedBy}
        WHERE id = ${existing[0].id}
      `;
      console.log(`Updated ledger: ${l.partyName}`);
    }
  }

  // 3. Seed Staff Assets
  const [firstStaff] = await sql`SELECT id FROM staff LIMIT 1`;
  if (firstStaff) {
    const existingAssets = await sql`SELECT id FROM staff_assets WHERE staff_id = ${firstStaff.id}`;
    if (existingAssets.length === 0) {
      await sql`
        INSERT INTO staff_assets (staff_id, asset_name, serial_number, notes)
        VALUES 
          (${firstStaff.id}, 'Dell Latitude Laptop', 'DL-7420-SN981', 'Primary entry terminal'),
          (${firstStaff.id}, 'Google Pixel 7', 'IMEI-358941092', 'Operational WhatsApp & Telegram')
      `;
      console.log('Seeded staff assets');
    }
  }

  console.log('--- Master Data Seed Complete ---');
  await sql.end();
}

run().catch(console.error);

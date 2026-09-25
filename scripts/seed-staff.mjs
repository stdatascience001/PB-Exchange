import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL || 'postgresql://postgres:Sss1234!@localhost:5434/pb_exchange');

async function main() {
  console.log('Seeding / updating dynamic staff rows...');

  const staffData = [
    {
      fullName: 'B06',
      role: 'DATA ENTRY OPERATOR',
      username: 'B06',
      wMode: 'COMMAN',
      mobile: '9999912345',
      address: 'DELHI',
      agent: 'VIKAS CASH',
      isActive: true,
      updatedBy: 'A100',
      updatedAt: '2026-06-24 12:14:00',
      monthlySalary: '25000',
      assignedStation: 'B06'
    },
    {
      fullName: 'B12',
      role: 'DATA ENTRY OPERATOR',
      username: 'B12',
      wMode: 'COMMAN',
      mobile: '9999912345',
      address: 'DELHI',
      agent: 'VIKAS CASH',
      isActive: true,
      updatedBy: 'A100',
      updatedAt: '2026-06-24 12:14:00',
      monthlySalary: '25000',
      assignedStation: 'B12'
    },
    {
      fullName: 'P5',
      role: 'TALLY OPERATOR',
      username: 'NONE',
      wMode: 'COMMAN',
      mobile: '7777758585',
      address: 'P5',
      agent: 'VIKAS CASH',
      isActive: true,
      updatedBy: 'A100',
      updatedAt: '2026-06-24 12:14:00',
      monthlySalary: '28000',
      assignedStation: 'P5'
    },
    {
      fullName: 'S10',
      role: 'TALLY OPERATOR',
      username: 'S10',
      wMode: 'COMMAN',
      mobile: '9999912345',
      address: 'ARUN GLDS',
      agent: 'VIKAS CASH',
      isActive: true,
      updatedBy: 'AKM',
      updatedAt: '2026-07-14 05:20:00',
      monthlySalary: '30000',
      assignedStation: 'S10'
    },
    {
      fullName: 'DC03',
      role: 'TALLY OPERATOR',
      username: 'DC03',
      wMode: 'COMMAN',
      mobile: '9999912345',
      address: 'DXB',
      agent: 'VIKAS CASH',
      isActive: true,
      updatedBy: 'A100',
      updatedAt: '2025-04-10 16:11:00',
      monthlySalary: '32000',
      assignedStation: 'DC03'
    },
    {
      fullName: 'S12',
      role: 'TALLY OPERATOR',
      username: 'S12',
      wMode: 'COMMAN',
      mobile: '9999912345',
      address: 'SHIAVNI GL DS',
      agent: 'VIKAS CASH',
      isActive: true,
      updatedBy: 'AKM',
      updatedAt: '2026-08-15 05:00:00',
      monthlySalary: '30000',
      assignedStation: 'S12'
    },
    {
      fullName: 'S11',
      role: 'TALLY OPERATOR',
      username: 'S11',
      wMode: 'COMMAN',
      mobile: '9999912345',
      address: 'NIDHI FB',
      agent: 'VIKAS CASH',
      isActive: true,
      updatedBy: 'A100',
      updatedAt: '2026-05-29 17:33:00',
      monthlySalary: '29000',
      assignedStation: 'S11'
    },
    {
      fullName: 'B30',
      role: 'DATA ENTRY OPERATOR',
      username: 'B30',
      wMode: 'COMMAN',
      mobile: '9999912356',
      address: 'PRIYANKA',
      agent: 'BOOOK SALARIES',
      isActive: true,
      updatedBy: 'A100',
      updatedAt: '2025-03-19 15:32:00',
      monthlySalary: '26000',
      assignedStation: 'B30'
    },
  ];

  for (const s of staffData) {
    const existing = await sql`SELECT id FROM staff WHERE full_name = ${s.fullName};`;
    if (existing.length > 0) {
      await sql`
        UPDATE staff SET
          role = ${s.role},
          designation = ${s.role},
          username = ${s.username},
          w_mode = ${s.wMode},
          mobile = ${s.mobile},
          address = ${s.address},
          agent = ${s.agent},
          is_active = ${s.isActive},
          updated_by = ${s.updatedBy},
          updated_at = ${s.updatedAt}
        WHERE id = ${existing[0].id};
      `;
    } else {
      await sql`
        INSERT INTO staff (
          user_id, full_name, role, designation, username, w_mode, mobile, address, agent, is_active, updated_by, updated_at, monthly_salary, is_working_live, assigned_station
        ) VALUES (
          1, ${s.fullName}, ${s.role}, ${s.role}, ${s.username}, ${s.wMode}, ${s.mobile}, ${s.address}, ${s.agent}, ${s.isActive}, ${s.updatedBy}, ${s.updatedAt}, ${s.monthlySalary}, true, ${s.assignedStation}
        );
      `;
    }
  }

  const all = await sql`SELECT id, full_name, role, username, w_mode, mobile, address, agent, is_active, updated_by, updated_at FROM staff ORDER BY id;`;
  console.log('Seeded staff count:', all.length);
  console.log(all);

  await sql.end();
}

main().catch(console.error);

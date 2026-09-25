import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL || 'postgresql://postgres:Sss1234!@localhost:5434/pb_exchange');

async function main() {
  const userList = await sql`
    SELECT u.id, u.username, u.role_id, r.name as role_name, u.is_active, u.created_at
    FROM users u
    LEFT JOIN roles r ON u.role_id = r.id;
  `;
  console.log('Users in database:', userList);

  const staffList = await sql`
    SELECT id, user_id, full_name, role, username, password, is_active FROM staff;
  `;
  console.log('Staff in database:', staffList);

  await sql.end();
}

main().catch(console.error);

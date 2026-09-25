import postgres from 'postgres';
import crypto from 'crypto';

const sql = postgres(process.env.DATABASE_URL || 'postgresql://postgres:Sss1234!@localhost:5434/pb_exchange');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

async function main() {
  console.log('--- Syncing all staff into users table ---');

  const allRoles = await sql`SELECT id, name FROM roles;`;
  const roleMap = new Map();
  for (const r of allRoles) {
    roleMap.set(r.name.toUpperCase(), r.id);
  }

  const staffRows = await sql`SELECT * FROM staff;`;
  console.log(`Found ${staffRows.length} staff records to check.`);

  for (const s of staffRows) {
    const username = (s.username && s.username.trim() && s.username.trim().toUpperCase() !== 'NONE')
      ? s.username.trim()
      : s.full_name.trim();

    const roleName = (s.role || s.designation || 'ADMIN').trim().toUpperCase();
    const roleId = roleMap.get(roleName) || roleMap.get('ADMIN') || 7;
    const password = (s.password && s.password.trim()) ? s.password.trim() : '123456';
    const pHash = hashPassword(password);
    const isActive = s.is_active !== undefined ? s.is_active : true;

    // Check if user already exists
    const [existingUser] = await sql`
      SELECT id FROM users WHERE LOWER(username) = LOWER(${username});
    `;

    let userId;
    if (existingUser) {
      console.log(`Updating existing user ${username} (id: ${existingUser.id})...`);
      await sql`
        UPDATE users SET
          password_hash = ${pHash},
          role_id = ${roleId},
          is_active = ${isActive}
        WHERE id = ${existingUser.id};
      `;
      userId = existingUser.id;
    } else {
      console.log(`Creating new user account for staff ${username} with role ${roleName}...`);
      const [inserted] = await sql`
        INSERT INTO users (username, password_hash, role_id, is_active)
        VALUES (${username}, ${pHash}, ${roleId}, ${isActive})
        RETURNING id;
      `;
      userId = inserted.id;
    }

    // Update staff table user_id
    await sql`
      UPDATE staff SET user_id = ${userId}, username = ${username}
      WHERE id = ${s.id};
    `;
  }

  console.log('--- Checking SIDHU user in database ---');
  const [sidhuUser] = await sql`
    SELECT u.id, u.username, u.role_id, r.name as role_name, u.is_active
    FROM users u
    LEFT JOIN roles r ON u.role_id = r.id
    WHERE LOWER(u.username) = 'sidhu';
  `;
  console.log('SIDHU user record:', sidhuUser);

  await sql.end();
}

main().catch(console.error);

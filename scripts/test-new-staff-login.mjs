async function test() {
  console.log('--- Testing New Staff Auto-User Creation and Login ---');

  // 1. Login as developer
  const devLoginRes = await fetch('http://localhost:4000/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'developer', password: 'Admin@12345' }),
  });
  const devLoginData = await devLoginRes.json();
  const token = devLoginData.data.token;
  console.log('Logged in as developer, token acquired');

  // 2. Create staff RAMESH
  const createRes = await fetch('http://localhost:4000/api/v1/staff', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      fullName: 'RAMESH KUMAR',
      role: 'TALLY OPERATOR',
      wMode: 'COMMAN',
      username: 'RAMESH',
      password: 'Password@123',
      agent: 'VIKAS CASH',
      mobile: '9812345678',
      address: 'DELHI',
    }),
  });
  const createData = await createRes.json();
  console.log('Staff creation response:', createData);
  const staffId = createData.data?.id;

  // 3. Test login as RAMESH
  const capRes = await fetch('http://localhost:4000/api/v1/auth/captcha');
  const capData = await capRes.json();
  const match = capData.data.question.match(/(\d+)\s*\+\s*(\d+)/);
  const answer = (parseInt(match[1]) + parseInt(match[2])).toString();

  const rameshLoginRes = await fetch('http://localhost:4000/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'RAMESH',
      password: 'Password@123',
      captchaId: capData.data.id,
      captchaAnswer: answer,
    }),
  });
  const rameshLoginData = await rameshLoginRes.json();
  console.log('Login result for new staff RAMESH:', rameshLoginData);

  // 4. Clean up
  if (staffId) {
    await fetch(`http://localhost:4000/api/v1/staff/${staffId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    console.log('Cleaned up test staff');
  }

  console.log('--- Test Finished Successfully ---');
}

test().catch(console.error);

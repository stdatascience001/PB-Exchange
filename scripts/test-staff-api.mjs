
async function test() {
  const loginRes = await fetch('http://localhost:4000/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'developer', password: 'Admin@12345' }),
  });
  const loginData = await loginRes.json();
  const token = loginData.data?.token;
  console.log('Login success, token acquired:', !!token);

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };

  // 1. GET /staff
  const listRes = await fetch('http://localhost:4000/api/v1/staff', { headers });
  const listData = await listRes.json();
  console.log('GET /staff count:', listData.data?.length);
  if (listData.data?.length > 0) {
    console.log('First staff item:', listData.data[0]);
  }

  // 2. POST /staff
  const createRes = await fetch('http://localhost:4000/api/v1/staff', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      fullName: 'TEST_STAFF_1',
      role: 'ADMIN',
      wMode: 'COMMAN',
      username: 'TSTAFF1',
      password: '123456',
      agent: 'VIKAS CASH',
      mobile: '9888877777',
      address: 'TEST ADDR',
    }),
  });
  const createData = await createRes.json();
  console.log('POST /staff result:', createData);
  const createdId = createData.data?.id;

  if (createdId) {
    // 3. PUT /staff/:id
    const updateRes = await fetch(`http://localhost:4000/api/v1/staff/${createdId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        fullName: 'TEST_STAFF_UPDATED',
        role: 'MANAGER',
        wMode: 'WHATSAPP',
      }),
    });
    const updateData = await updateRes.json();
    console.log('PUT /staff result:', updateData);

    // 4. PATCH /staff/:id/active
    const toggleRes = await fetch(`http://localhost:4000/api/v1/staff/${createdId}/active`, {
      method: 'PATCH',
      headers,
    });
    const toggleData = await toggleRes.json();
    console.log('PATCH /staff/:id/active result:', toggleData);

    // 5. DELETE /staff/:id
    const delRes = await fetch(`http://localhost:4000/api/v1/staff/${createdId}`, {
      method: 'DELETE',
      headers,
    });
    const delData = await delRes.json();
    console.log('DELETE /staff/:id result:', delData);
  }

  console.log('All backend staff API tests completed successfully!');
}

test().catch(console.error);

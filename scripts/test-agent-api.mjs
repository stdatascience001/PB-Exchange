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

  // 1. GET /agents
  const listRes = await fetch('http://localhost:4000/api/v1/agents', { headers });
  const listData = await listRes.json();
  console.log('GET /agents status:', listRes.status);
  console.log('GET /agents count:', listData.data?.length);
  if (listData.data?.length > 0) {
    console.log('Sample agent item:', listData.data[0]);
  }

  // 2. POST /agents
  const createRes = await fetch('http://localhost:4000/api/v1/agents', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      agentName: 'TEST AGENT DEMO',
      mainAgentName: 'VIKAS CASH',
      parentAgentName: 'MAIN CASH',
    }),
  });
  const createData = await createRes.json();
  console.log('POST /agents status:', createRes.status);
  console.log('POST /agents response:', createData);

  // 3. GET /agents again to verify
  const listRes2 = await fetch('http://localhost:4000/api/v1/agents', { headers });
  const listData2 = await listRes2.json();
  console.log('GET /agents count after creation:', listData2.data?.length);
  const found = listData2.data?.find(a => a.agentName === 'TEST AGENT DEMO');
  console.log('Found newly created agent:', found);
}

test().catch(console.error);

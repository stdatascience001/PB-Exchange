async function run() {
  console.log('--- Testing All Master API Endpoints ---');

  // 1. Auth Login
  const cap = await fetch('http://localhost:4000/api/v1/auth/captcha').then(r => r.json());
  const m = cap.data.question.match(/(\d+)\s*\+\s*(\d+)/);
  const ans = (parseInt(m[1]) + parseInt(m[2])).toString();
  const login = await fetch('http://localhost:4000/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'developer',
      password: 'Admin@12345',
      captchaId: cap.data.id,
      captchaAnswer: ans,
    })
  }).then(r => r.json());

  const token = login.data.token;
  const headers = {
    'Authorization': 'Bearer ' + token,
    'Content-Type': 'application/json',
  };

  // 2. Test Shifts
  const shiftsRes = await fetch('http://localhost:4000/api/v1/shifts', { headers }).then(r => r.json());
  console.log('Shifts count:', shiftsRes.data.length, 'Sample shift:', shiftsRes.data[0].name, 'Active:', shiftsRes.data[0].isActive);

  // Toggle active
  const toggleRes = await fetch(`http://localhost:4000/api/v1/shifts/${shiftsRes.data[0].id}/toggle-active`, {
    method: 'PATCH',
    headers,
  }).then(r => r.json());
  console.log('Shift toggle success:', toggleRes.success);

  // 3. Test Ledgers
  const ledgersRes = await fetch('http://localhost:4000/api/v1/ledgers', { headers }).then(r => r.json());
  console.log('Ledgers count:', ledgersRes.data.length, 'Sample ledger:', ledgersRes.data[0].partyName, 'Agent:', ledgersRes.data[0].agentName);

  // 4. Test Staff
  const staffRes = await fetch('http://localhost:4000/api/v1/staff', { headers }).then(r => r.json());
  console.log('Staff count:', staffRes.data.length, 'Sample staff:', staffRes.data[0].fullName, 'Station:', staffRes.data[0].assignedStation);

  // 5. Test Agents
  const agentsRes = await fetch('http://localhost:4000/api/v1/agents', { headers }).then(r => r.json());
  console.log('Agents count:', agentsRes.data.length, 'Sample agent:', agentsRes.data[0].agentName);

  // 6. Test Staff Assets
  const assetsRes = await fetch('http://localhost:4000/api/v1/staff/assets', { headers }).then(r => r.json());
  console.log('Staff Assets count:', assetsRes.data.length, 'Sample asset:', assetsRes.data[0].assetName);

  // 7. Test IP Access
  const accessRes = await fetch('http://localhost:4000/api/v1/access', { headers }).then(r => r.json());
  console.log('Blocked IPs count:', accessRes.data.length);

  console.log('--- ALL MASTER ENDPOINTS TESTED SUCCESSFULLY! ---');
}

run().catch(console.error);

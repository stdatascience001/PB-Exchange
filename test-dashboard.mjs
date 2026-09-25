async function run() {
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
      captchaAnswer: ans
    })
  }).then(r => r.json());

  console.log('Login success:', login.success, 'Role:', login.data.user.roleName);
  const metrics = await fetch('http://localhost:4000/api/v1/dashboard/metrics', {
    headers: { 'Authorization': 'Bearer ' + login.data.token }
  }).then(r => r.json());

  console.log('Metrics success:', metrics.success);
  console.log('Total shifts in dashboard:', metrics.data.shifts.length);
  for (const s of metrics.data.shifts) {
    console.log(`  - ${s.name.padEnd(16)} | Declared: ${s.declaredNumber || 'NONE'} | Amount: ${s.totalAmount} | Count: ${s.totalCount}`);
  }
  console.log('Staff Working count:', metrics.data.staffWorking.length);
  for (const st of metrics.data.staffWorking) {
    console.log(`  - ${st.code} | ${st.designation} | ${st.timestamp}`);
  }
}
run().catch(console.error);

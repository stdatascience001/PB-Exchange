async function test() {
  console.log('--- Testing Change Password API ---');

  // 1. Login as SIDHU with current password 123456
  const capRes = await fetch('http://localhost:4000/api/v1/auth/captcha');
  const capData = await capRes.json();
  const match = capData.data.question.match(/(\d+)\s*\+\s*(\d+)/);
  const answer = (parseInt(match[1]) + parseInt(match[2])).toString();

  const loginRes = await fetch('http://localhost:4000/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'SIDHU',
      password: '123456',
      captchaId: capData.data.id,
      captchaAnswer: answer,
    }),
  });
  const loginData = await loginRes.json();
  console.log('Login result:', loginData.success);
  const token = loginData.data?.token;

  // 2. Change password to NewPass@999
  const changeRes = await fetch('http://localhost:4000/api/v1/auth/change-password', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      currentPassword: '123456',
      newPassword: 'NewPass@999',
    }),
  });
  const changeData = await changeRes.json();
  console.log('Change password response:', changeData);

  // 3. Test login with Old Password (should fail)
  const capRes2 = await fetch('http://localhost:4000/api/v1/auth/captcha');
  const capData2 = await capRes2.json();
  const match2 = capData2.data.question.match(/(\d+)\s*\+\s*(\d+)/);
  const answer2 = (parseInt(match2[1]) + parseInt(match2[2])).toString();

  const failLogin = await fetch('http://localhost:4000/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'SIDHU',
      password: '123456',
      captchaId: capData2.data.id,
      captchaAnswer: answer2,
    }),
  });
  const failData = await failLogin.json();
  console.log('Login with OLD password (should fail):', failData.success, failData.error?.message);

  // 4. Test login with NEW Password (should succeed)
  const capRes3 = await fetch('http://localhost:4000/api/v1/auth/captcha');
  const capData3 = await capRes3.json();
  const match3 = capData3.data.question.match(/(\d+)\s*\+\s*(\d+)/);
  const answer3 = (parseInt(match3[1]) + parseInt(match3[2])).toString();

  const successLogin = await fetch('http://localhost:4000/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'SIDHU',
      password: 'NewPass@999',
      captchaId: capData3.data.id,
      captchaAnswer: answer3,
    }),
  });
  const successData = await successLogin.json();
  console.log('Login with NEW password (should succeed):', successData.success);

  // 5. Restore back to 123456
  const token2 = successData.data?.token;
  await fetch('http://localhost:4000/api/v1/auth/change-password', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token2}`,
    },
    body: JSON.stringify({
      currentPassword: 'NewPass@999',
      newPassword: '123456',
    }),
  });
  console.log('Restored password back to 123456 for testing consistency.');
}

test().catch(console.error);

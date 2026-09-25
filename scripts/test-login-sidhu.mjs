async function testLogin() {
  console.log('Testing login for SIDHU / 123456...');
  
  // 1. Get captcha
  const capRes = await fetch('http://localhost:4000/api/v1/auth/captcha');
  const capData = await capRes.json();
  console.log('Captcha:', capData);
  
  // Evaluate the captcha question e.g. "62 + 71 = ?"
  const match = capData.data.question.match(/(\d+)\s*\+\s*(\d+)/);
  const answer = (parseInt(match[1]) + parseInt(match[2])).toString();
  console.log('Calculated answer:', answer);

  // 2. Login with uppercase "SIDHU"
  const loginRes1 = await fetch('http://localhost:4000/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'SIDHU',
      password: '123456',
      captchaId: capData.data.id,
      captchaAnswer: answer,
    }),
  });
  const resData1 = await loginRes1.json();
  console.log('Login result with "SIDHU":', resData1);

  // 3. Test with lowercase "sidhu"
  const capRes2 = await fetch('http://localhost:4000/api/v1/auth/captcha');
  const capData2 = await capRes2.json();
  const match2 = capData2.data.question.match(/(\d+)\s*\+\s*(\d+)/);
  const answer2 = (parseInt(match2[1]) + parseInt(match2[2])).toString();

  const loginRes2 = await fetch('http://localhost:4000/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'sidhu',
      password: '123456',
      captchaId: capData2.data.id,
      captchaAnswer: answer2,
    }),
  });
  const resData2 = await loginRes2.json();
  console.log('Login result with "sidhu":', resData2);
}

testLogin().catch(console.error);

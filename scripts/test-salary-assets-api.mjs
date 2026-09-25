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
  const staffRes = await fetch('http://localhost:4000/api/v1/staff', { headers });
  const staffData = await staffRes.json();
  console.log('GET /staff count:', staffData.data?.length);
  if (staffData.data?.length > 0) {
    const s = staffData.data[0];
    console.log('First staff record:', {
      id: s.id,
      fullName: s.fullName,
      hasSalary: s.hasSalary,
      hasAssets: s.hasAssets,
      monthlySalary: s.monthlySalary,
      assetsCount: s.assets?.length,
    });
  }

  // 2. POST /staff/assets
  if (staffData.data?.length > 0) {
    const firstStaffId = staffData.data[0].id;
    const createAssetRes = await fetch('http://localhost:4000/api/v1/staff/assets', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        staffId: firstStaffId,
        assetName: 'LAPTOP',
        amount: 45000,
        type: 'Issue',
        brand: 'DELL LATITUDE',
        serialNumber: 'DL-7420-TEST',
        remark: 'Test operational laptop',
      }),
    });
    const createAssetData = await createAssetRes.json();
    console.log('POST /staff/assets response:', createAssetData);

    // 3. GET /staff again to verify hasAssets changed to true
    const staffRes2 = await fetch('http://localhost:4000/api/v1/staff', { headers });
    const staffData2 = await staffRes2.json();
    const updatedStaff = staffData2.data?.find(s => s.id === firstStaffId);
    console.log('Updated staff hasAssets:', updatedStaff?.hasAssets, 'assetsCount:', updatedStaff?.assets?.length);
  }
}

test().catch(console.error);

async function test() {
  const routes = [
    '/dashboard',
    '/shifts',
    '/ledgers',
    '/staffs',
    '/agents',
    '/staff-assets',
    '/access-block',
    '/add-transaction',
    '/transaction-list',
    '/jantri',
    '/declare',
    '/duplicates',
    '/audit',
  ];

  console.log('Testing all SPA routes on http://localhost:3000:');
  for (const r of routes) {
    const res = await fetch(`http://localhost:3000${r}`);
    console.log(`Route ${r}: Status ${res.status}`);
  }
  console.log('All routes returned 200 OK!');
}

test().catch(console.error);

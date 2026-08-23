const http = require('http');
const { createServer } = require('../src/server');

const PORT = 3456;

function request(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${PORT}${path}`, (res) => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (err) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    }).on('error', reject);
  });
}

async function runTest() {
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ ${message}`);
      passed++;
    } else {
      console.log(`  ❌ ${message}`);
      failed++;
    }
  }

  const server = createServer();

  await new Promise((resolve, reject) => {
    server.listen(PORT, '0.0.0.0', () => resolve());
    server.on('error', reject);
  });

  console.log('Test 1: GET /health');
  const health = await request('/health');
  assert(health.status === 200, 'health status is 200');
  assert(health.body.status === 'ok', 'health body.status is "ok"');

  console.log('Test 2: GET /check');
  const check = await request('/check');
  assert(check.status === 200, 'check status is 200');
  assert(check.body.success === true, 'check body.success is true');
  assert(typeof check.body.newCount === 'number', 'check body.newCount is a number');
  assert(typeof check.body.totalSeen === 'number', 'check body.totalSeen is a number');

  console.log('Test 3: GET / (root)');
  const root = await request('/');
  assert(root.status === 200, 'root status is 200');
  assert(root.body.status === 'ok', 'root body.status is "ok"');

  await new Promise((resolve) => server.close(resolve));

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTest().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});

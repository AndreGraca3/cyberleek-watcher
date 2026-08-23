const { fetchContentAccounts } = require('../src/fetcher');
const { evaluateUpdates } = require('../src/engine');
const { createStore } = require('../src/store');
const config = require('../src/config');

async function runTests() {
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

  const accounts = await fetchContentAccounts();

  // Test 1: Bootstrap run with empty state
  console.log('Test 1: Bootstrap run with empty state');
  const result1 = evaluateUpdates(accounts, null);
  assert(result1.isFirstRun === true, 'isFirstRun is true');
  assert(Array.isArray(result1.newAccounts) && result1.newAccounts.length === 0, 'newAccounts is empty');
  assert(result1.updatedState.initialized === true, 'updatedState.initialized is true');
  assert(Array.isArray(result1.updatedState.seenPubkeys), 'seenPubkeys is an array');
  assert(result1.updatedState.seenPubkeys.length === accounts.length, 'seenPubkeys contains all current accounts');
  assert(typeof result1.updatedState.lastMaxTimestamp === 'number', 'lastMaxTimestamp is a number');

  // Test 2: Subsequent identical run
  console.log('Test 2: Subsequent identical run');
  const result2 = evaluateUpdates(accounts, result1.updatedState);
  assert(result2.isFirstRun === false, 'isFirstRun is false');
  assert(Array.isArray(result2.newAccounts) && result2.newAccounts.length === 0, 'newAccounts is empty on identical input');
  assert(result2.updatedState.seenPubkeys.length === accounts.length, 'seenPubkeys unchanged');

  // Test 3: New account detection
  console.log('Test 3: New account detection');
  const mockAccount = {
    pubkey: 'MockPubkey1111111111111111111111111111111',
    timestamp: Math.floor(Date.now() / 1000),
    title: 'Mock New Leak',
    items: [{ label: 'test', url: 'https://example.com' }],
  };
  const result3 = evaluateUpdates([...accounts, mockAccount], result2.updatedState);
  assert(result3.newAccounts.length === 1, 'newAccounts has exactly 1 entry');
  assert(result3.newAccounts[0].pubkey === mockAccount.pubkey, 'new account pubkey matches');
  assert(result3.newAccounts[0].title === mockAccount.title, 'new account title matches');
  assert(result3.updatedState.seenPubkeys.includes(mockAccount.pubkey), 'seenPubkeys includes new pubkey');
  assert(result3.updatedState.lastMaxTimestamp >= mockAccount.timestamp, 'lastMaxTimestamp advanced');

  // Test 4: Local File store
  console.log('Test 4: Local File store save/get');
  const localConfig = { ...config, UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '' };
  const store = createStore(localConfig);
  const testState = {
    initialized: true,
    seenPubkeys: ['testpubkey'],
    lastMaxTimestamp: 1234567890,
    updatedAt: new Date().toISOString(),
  };

  await store.saveState(testState);
  const loaded = await store.getState();

  assert(loaded !== null, 'getState returns non-null');
  assert(loaded.initialized === true, 'loaded.initialized is true');
  assert(loaded.seenPubkeys[0] === 'testpubkey', 'loaded.seenPubkeys[0] matches');
  assert(loaded.lastMaxTimestamp === 1234567890, 'loaded.lastMaxTimestamp matches');

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});

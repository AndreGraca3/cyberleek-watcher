const fs = require('fs/promises');
const path = require('path');

// Isolated local config for this test — must be set BEFORE requiring project modules
process.env.UPSTASH_REDIS_REST_URL = '';
process.env.UPSTASH_REDIS_REST_TOKEN = '';
process.env.LOCAL_STATE_PATH = path.resolve('data/test-state.json');
process.env.DISCORD_WEBHOOK_URL = '';

const { main } = require('../src/index');

const TEST_STATE_PATH = path.resolve('data/test-state.json');

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

  // Ensure clean start
  try {
    await fs.unlink(TEST_STATE_PATH);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  // Run 1: Bootstrap
  console.log('Run 1: Bootstrap');
  await main();

  const raw1 = await fs.readFile(TEST_STATE_PATH, 'utf8');
  const state1 = JSON.parse(raw1);

  assert(state1.initialized === true, 'state.initialized is true after bootstrap');
  assert(Array.isArray(state1.seenPubkeys), 'state.seenPubkeys is an array');
  assert(state1.seenPubkeys.length === 8, `state.seenPubkeys has 8 entries (got ${state1.seenPubkeys.length})`);
  assert(typeof state1.lastMaxTimestamp === 'number', 'state.lastMaxTimestamp is a number');
  assert(state1.lastMaxTimestamp > 0, 'state.lastMaxTimestamp > 0');

  // Run 2: No-op
  console.log('Run 2: No-op check');
  await main();

  const raw2 = await fs.readFile(TEST_STATE_PATH, 'utf8');
  const state2 = JSON.parse(raw2);

  assert(state2.seenPubkeys.length === 8, 'seenPubkeys unchanged after no-op run');
  assert(state2.lastMaxTimestamp === state1.lastMaxTimestamp, 'lastMaxTimestamp unchanged after no-op run');

  // Cleanup
  try {
    await fs.unlink(TEST_STATE_PATH);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTest().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});

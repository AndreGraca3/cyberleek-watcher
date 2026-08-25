const { fetchContentAccounts } = require('../src/fetcher');

(async () => {
  try {
    const accounts = await fetchContentAccounts();
    console.log(`Total accounts: ${accounts.length}`);

    for (const acc of accounts) {
      console.log(`\n--- ${acc.pubkey} ---`);
      console.log(`Timestamp: ${acc.timestamp}`);
      console.log(`Title: ${acc.title}`);
      console.log(`Items (${acc.items.length}):`);
      for (const item of acc.items) {
        console.log(`  - ${item.label}: ${item.url}`);
      }
    }

    // Live on-chain data grows over time, so this only checks that fetching
    // and decoding actually returned something well-formed, not an exact count.
    if (accounts.length === 0) {
      throw new Error('Expected at least 1 account, got 0');
    }

    console.log(`\n✅ Verification passed: ${accounts.length} accounts decoded successfully`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Verification failed:', err.message);
    process.exit(1);
  }
})();

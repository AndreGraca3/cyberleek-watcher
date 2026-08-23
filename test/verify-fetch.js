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

    if (accounts.length !== 8) {
      throw new Error(`Expected 8 accounts, got ${accounts.length}`);
    }

    console.log('\n✅ Verification passed: 8 accounts decoded successfully');
    process.exit(0);
  } catch (err) {
    console.error('❌ Verification failed:', err.message);
    process.exit(1);
  }
})();

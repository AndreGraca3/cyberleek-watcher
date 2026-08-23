const config = require('./config');
const logger = require('./logger');
const { fetchContentAccounts } = require('./fetcher');
const { evaluateUpdates } = require('./engine');
const { createStore } = require('./store');
const { sendDiscordAlert } = require('./notifier');

async function runWatcher() {
  const store = createStore(config);
  const storedState = await store.getState();
  const currentAccounts = await fetchContentAccounts();
  const { isFirstRun, newAccounts, updatedState } = evaluateUpdates(currentAccounts, storedState);

  if (isFirstRun) {
    logger.info(
      { count: updatedState.seenPubkeys.length },
      `First run / bootstrap: stored ${updatedState.seenPubkeys.length} baseline accounts. No alerts sent.`
    );
    await store.saveState(updatedState);
  } else if (newAccounts.length > 0) {
    logger.info(
      { count: newAccounts.length },
      `Detected ${newAccounts.length} new leak(s)! Dispatching notifications...`
    );
    // Dispatched in parallel so total latency is bounded by the slowest single
    // leak's resolution time, not the sum across all new leaks in this batch.
    await Promise.all(newAccounts.map(account => sendDiscordAlert(account)));
    await store.saveState(updatedState);
  } else {
    logger.info('Check complete: 0 new leaks. System up to date.');
  }

  return {
    success: true,
    isFirstRun,
    newCount: newAccounts.length,
    totalSeen: updatedState.seenPubkeys.length,
    lastMaxTimestamp: updatedState.lastMaxTimestamp,
  };
}

async function main() {
  try {
    const result = await runWatcher();
    return result;
  } catch (err) {
    logger.error(err, 'Unhandled error in main');
    throw err;
  }
}

if (require.main === module) {
  main().then(
    () => process.exit(0),
    (err) => {
      logger.error(err, 'Fatal error');
      process.exit(1);
    }
  );
}

module.exports = { main, runWatcher };

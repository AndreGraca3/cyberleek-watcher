const config = require('./config');
const logger = require('./logger');
const { fetchContentAccounts, fetchPollAccounts } = require('./fetcher');
const { evaluateUpdates, evaluatePollUpdates, evaluatePollClosures } = require('./engine');
const { createStore } = require('./store');
const { sendDiscordAlert, sendPollAlert, sendPollResultsAlert } = require('./notifier');

async function runWatcher() {
  const store = createStore(config);
  const storedState = await store.getState();
  const [currentAccounts, currentPolls] = await Promise.all([
    fetchContentAccounts(),
    fetchPollAccounts(),
  ]);

  const { isFirstRun, newAccounts, updatedState: leakState } = evaluateUpdates(currentAccounts, storedState);
  const { isFirstRun: isFirstPollRun, newPolls, updatedState: pollState } = evaluatePollUpdates(currentPolls, storedState);
  const { isFirstRun: isFirstClosureRun, newlyClosedPolls, updatedState: closureState } = evaluatePollClosures(
    currentPolls,
    storedState,
    config.POLL_CLOSE_GRACE_SECONDS,
    config.POLL_SETTLE_MIN_DELAY_SECONDS
  );

  const updatedState = { ...leakState, ...pollState, ...closureState, updatedAt: new Date().toISOString() };
  let stateChanged = false;

  if (isFirstRun) {
    logger.info(
      { count: leakState.seenPubkeys.length },
      `First run / bootstrap: stored ${leakState.seenPubkeys.length} baseline accounts. No alerts sent.`
    );
    stateChanged = true;
  } else if (newAccounts.length > 0) {
    logger.info(
      { count: newAccounts.length },
      `Detected ${newAccounts.length} new leak(s)! Dispatching notifications...`
    );
    // Dispatched in parallel so total latency is bounded by the slowest single
    // leak's resolution time, not the sum across all new leaks in this batch.
    await Promise.all(newAccounts.map(account => sendDiscordAlert(account)));
    stateChanged = true;
  } else {
    logger.info('Check complete: 0 new leaks. System up to date.');
  }

  if (isFirstPollRun) {
    logger.info(
      { count: pollState.seenPollPubkeys.length },
      `First poll run / bootstrap: stored ${pollState.seenPollPubkeys.length} baseline poll(s). No alerts sent.`
    );
    stateChanged = true;
  } else if (newPolls.length > 0) {
    logger.info(
      { count: newPolls.length },
      `Detected ${newPolls.length} new poll(s)! Dispatching notifications...`
    );
    await Promise.all(newPolls.map(poll => sendPollAlert(poll)));
    stateChanged = true;
  } else {
    logger.info('Check complete: 0 new polls. System up to date.');
  }

  if (isFirstClosureRun) {
    logger.info(
      { count: closureState.closedNotifiedPollPubkeys.length },
      `First closure run / bootstrap: marked ${closureState.closedNotifiedPollPubkeys.length} already-closed poll(s) as notified. No alerts sent.`
    );
    stateChanged = true;
  } else if (newlyClosedPolls.length > 0) {
    logger.info(
      { count: newlyClosedPolls.length },
      `Detected ${newlyClosedPolls.length} newly closed poll(s)! Dispatching result notifications...`
    );
    await Promise.all(newlyClosedPolls.map(poll => sendPollResultsAlert(poll)));
    stateChanged = true;
  } else {
    logger.info('Check complete: 0 newly closed polls. System up to date.');
  }

  if (stateChanged) {
    await store.saveState(updatedState);
  }

  return {
    success: true,
    isFirstRun,
    newCount: newAccounts.length,
    totalSeen: updatedState.seenPubkeys.length,
    lastMaxTimestamp: updatedState.lastMaxTimestamp,
    isFirstPollRun,
    newPollCount: newPolls.length,
    totalPollsSeen: updatedState.seenPollPubkeys.length,
    lastMaxPollTimestamp: updatedState.lastMaxPollTimestamp,
    isFirstClosureRun,
    newClosedPollCount: newlyClosedPolls.length,
    totalClosedPollsNotified: updatedState.closedNotifiedPollPubkeys.length,
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

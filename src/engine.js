const logger = require('./logger');

function evaluateUpdates(currentAccounts, storedState) {
  if (!storedState || !storedState.initialized) {
    const seenPubkeys = currentAccounts.map(a => a.pubkey);
    const lastMaxTimestamp = currentAccounts.length > 0
      ? Math.max(...currentAccounts.map(a => a.timestamp))
      : 0;

    logger.info(
      { count: seenPubkeys.length, lastMaxTimestamp },
      'Bootstrap: initialized state from current accounts'
    );

    return {
      isFirstRun: true,
      newAccounts: [],
      updatedState: {
        initialized: true,
        seenPubkeys,
        lastMaxTimestamp,
        updatedAt: new Date().toISOString(),
      },
    };
  }

  const seenSet = new Set(storedState.seenPubkeys || []);
  const newAccounts = currentAccounts.filter(acc => !seenSet.has(acc.pubkey));

  const updatedSeen = [...seenSet, ...newAccounts.map(a => a.pubkey)];
  const updatedMaxTimestamp = Math.max(
    storedState.lastMaxTimestamp || 0,
    ...newAccounts.map(a => a.timestamp),
    0
  );

  logger.info(
    { newCount: newAccounts.length, updatedMaxTimestamp },
    'Diff complete'
  );

  return {
    isFirstRun: false,
    newAccounts,
    updatedState: {
      initialized: true,
      seenPubkeys: updatedSeen,
      lastMaxTimestamp: updatedMaxTimestamp,
      updatedAt: new Date().toISOString(),
    },
  };
}

/**
 * Same bootstrap/diff pattern as evaluateUpdates, but namespaced under
 * seenPollPubkeys/pollsInitialized so it can coexist with the leak state in
 * the same stored state object without colliding.
 */
function evaluatePollUpdates(currentPolls, storedState) {
  if (!storedState || !storedState.pollsInitialized) {
    const seenPollPubkeys = currentPolls.map(p => p.pubkey);
    const lastMaxPollTimestamp = currentPolls.length > 0
      ? Math.max(...currentPolls.map(p => p.timestamp))
      : 0;

    logger.info(
      { count: seenPollPubkeys.length, lastMaxPollTimestamp },
      'Bootstrap: initialized poll state from current accounts'
    );

    return {
      isFirstRun: true,
      newPolls: [],
      updatedState: {
        pollsInitialized: true,
        seenPollPubkeys,
        lastMaxPollTimestamp,
      },
    };
  }

  const seenSet = new Set(storedState.seenPollPubkeys || []);
  const newPolls = currentPolls.filter(p => !seenSet.has(p.pubkey));

  const updatedSeen = [...seenSet, ...newPolls.map(p => p.pubkey)];
  const updatedMaxTimestamp = Math.max(
    storedState.lastMaxPollTimestamp || 0,
    ...newPolls.map(p => p.timestamp),
    0
  );

  logger.info(
    { newCount: newPolls.length, updatedMaxTimestamp },
    'Poll diff complete'
  );

  return {
    isFirstRun: false,
    newPolls,
    updatedState: {
      pollsInitialized: true,
      seenPollPubkeys: updatedSeen,
      lastMaxPollTimestamp: updatedMaxTimestamp,
    },
  };
}

/**
 * Detects polls whose closesAt has passed and that we haven't yet sent a
 * "poll finished / results" alert for. Uses its own state namespace
 * (closedNotifiedPollPubkeys/pollClosuresInitialized) so it coexists with
 * leak and poll-creation tracking in the same stored state object.
 */
function evaluatePollClosures(currentPolls, storedState) {
  const nowSec = Math.floor(Date.now() / 1000);
  const closedNow = currentPolls.filter(p => typeof p.closesAt === 'number' && p.closesAt <= nowSec);

  if (!storedState || !storedState.pollClosuresInitialized) {
    const closedNotifiedPollPubkeys = closedNow.map(p => p.pubkey);

    logger.info(
      { count: closedNotifiedPollPubkeys.length },
      'Bootstrap: initialized poll-closure state from already-closed polls'
    );

    return {
      isFirstRun: true,
      newlyClosedPolls: [],
      updatedState: {
        pollClosuresInitialized: true,
        closedNotifiedPollPubkeys,
      },
    };
  }

  const seenSet = new Set(storedState.closedNotifiedPollPubkeys || []);
  const newlyClosedPolls = closedNow.filter(p => !seenSet.has(p.pubkey));
  const updatedSeen = [...seenSet, ...newlyClosedPolls.map(p => p.pubkey)];

  logger.info({ newCount: newlyClosedPolls.length }, 'Poll closure diff complete');

  return {
    isFirstRun: false,
    newlyClosedPolls,
    updatedState: {
      pollClosuresInitialized: true,
      closedNotifiedPollPubkeys: updatedSeen,
    },
  };
}

module.exports = { evaluateUpdates, evaluatePollUpdates, evaluatePollClosures };

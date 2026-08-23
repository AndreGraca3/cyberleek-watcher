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

module.exports = { evaluateUpdates };

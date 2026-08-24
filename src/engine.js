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
 *
 * A poll's on-chain tally isn't final the instant closesAt passes — the
 * ProcessResults instruction settles it shortly after, but only touches
 * options that received votes; options with zero votes never get their
 * flag/count updated at all (verified on real poll data — a poll's losing,
 * zero-vote option stayed flagged 0 for 2.5+ hours after two ProcessResults
 * calls already landed for its other options). So "wait for every flag to
 * reach 1" doesn't work in general.
 *
 * We instead wait for the poll account's data (optionFlags + voteCounts) to
 * be IDENTICAL across two consecutive checks — but a poll's data also starts
 * out unchanging (all zero) *before* ProcessResults has even run, so a naive
 * "unchanged since last check" comparison can false-positive on that
 * pre-processing zero state (verified: one real poll's first ProcessResults
 * didn't land until 177s after closesAt — a 60s-cron check at +60s and +120s
 * would both read all-zero and look "stable" despite nothing having run yet).
 *
 * To avoid that, a match only counts as "stable" if BOTH compared readings
 * were taken at least `minSettleSeconds` after closesAt. `graceSeconds` is a
 * last-resort fallback: if a poll still hasn't stabilized this long after
 * closesAt (e.g. a stuck/never-run ProcessResults), notify anyway with
 * whatever tally currently exists rather than withholding forever.
 */
function pollTallySignature(poll) {
  return JSON.stringify({ flags: poll.optionFlags, votes: poll.voteCounts });
}

function evaluatePollClosures(currentPolls, storedState, graceSeconds = 0, minSettleSeconds = 0) {
  const nowSec = Math.floor(Date.now() / 1000);
  const pastClose = currentPolls.filter(
    p => typeof p.closesAt === 'number' && p.closesAt <= nowSec
  );
  const prevSnapshots = (storedState && storedState.pollTallySnapshots) || {};
  const updatedSnapshots = {};

  const closedNow = pastClose.filter(p => {
    const signature = pollTallySignature(p);
    const prev = prevSnapshots[p.pubkey];
    const elapsed = nowSec - p.closesAt;
    const pastMinSettle = elapsed >= minSettleSeconds;

    // Snapshots are only ever recorded once past the cooldown, so `prev`
    // (when present) is guaranteed to have been captured post-cooldown too —
    // a match can never be an artifact of two pre-processing zero reads.
    const stabilized = pastMinSettle && prev !== undefined && prev === signature;
    if (pastMinSettle) {
      updatedSnapshots[p.pubkey] = signature;
    } else if (prev !== undefined) {
      updatedSnapshots[p.pubkey] = prev;
    }

    const graceExpired = p.closesAt + graceSeconds <= nowSec;
    return stabilized || graceExpired;
  });

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
        pollTallySnapshots: updatedSnapshots,
      },
    };
  }

  const seenSet = new Set(storedState.closedNotifiedPollPubkeys || []);
  const newlyClosedPolls = closedNow.filter(p => !seenSet.has(p.pubkey));
  const updatedSeen = [...seenSet, ...newlyClosedPolls.map(p => p.pubkey)];

  // Drop snapshots for already-notified polls so state doesn't grow forever.
  const notifiedSet = new Set(updatedSeen);
  for (const pubkey of Object.keys(updatedSnapshots)) {
    if (notifiedSet.has(pubkey)) delete updatedSnapshots[pubkey];
  }

  logger.info({ newCount: newlyClosedPolls.length }, 'Poll closure diff complete');

  return {
    isFirstRun: false,
    newlyClosedPolls,
    updatedState: {
      pollClosuresInitialized: true,
      closedNotifiedPollPubkeys: updatedSeen,
      pollTallySnapshots: updatedSnapshots,
    },
  };
}

module.exports = { evaluateUpdates, evaluatePollUpdates, evaluatePollClosures };

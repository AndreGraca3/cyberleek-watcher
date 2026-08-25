const config = require('./config');
const { sendDiscordAlert, waitForPendingDispatches } = require('./notifier');

/**
 * Business logic for the `/test-check` live-test endpoint (routed in
 * src/server.js). Deliberately kept out of notifier.js, which is scoped to
 * real Discord alerts (leaks/polls) — this module just wires a fake leak
 * account into the *actual* production alert function (`sendDiscordAlert`),
 * pointed at a dedicated test webhook, so a human can exercise the real
 * pipeline (rich embed + resolveDirectVideos + Filebase mirroring + video
 * follow-up) end-to-end without touching production alert code or the real
 * DISCORD_WEBHOOK_URL channel.
 */
async function handleTest(mirrorUrl, webhookUrl = config.TEST_DISCORD_WEBHOOK_URL) {
  if (!webhookUrl) {
    return { success: false, skipped: true, error: 'No TEST_DISCORD_WEBHOOK_URL configured' };
  }

  // Fake leak account with a single mirror item, shaped exactly like a real
  // decoded account (src/decoder.js) — this is what lets sendDiscordAlert
  // run unmodified: same embed, same spoiler check, same decoupled video
  // follow-up (resolveDirectVideos + mirrorVideosToFilebase).
  const fakeAccount = {
    pubkey: `test-${Date.now()}`,
    timestamp: Math.floor(Date.now() / 1000),
    title: 'TEST — /test-check endpoint',
    items: [{ label: 'test mirror', url: mirrorUrl }],
  };

  const result = await sendDiscordAlert(fakeAccount, webhookUrl);

  // sendDiscordAlert dispatches the video follow-up (resolve + Filebase
  // mirror + post) in the background via trackDispatch. Wait for it here —
  // same mechanism the CLI uses (src/index.js) — so this manual test's HTTP
  // response reflects the full pipeline instead of returning before it lands.
  await waitForPendingDispatches();

  return result;
}

module.exports = { handleTest };

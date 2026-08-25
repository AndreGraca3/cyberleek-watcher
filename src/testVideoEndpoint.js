const config = require('./config');
const logger = require('./logger');
const { resolveDirectVideos } = require('./resolver');
const { mirrorVideosToFilebase } = require('./uploader');

/**
 * Business logic for the `/test-video` live-test endpoint (routed in
 * src/server.js). Deliberately kept out of notifier.js, which is scoped to
 * real Discord alerts (leaks/polls) — this module exists purely to let a
 * human exercise the real resolve → mirror pipeline on demand, using a fake
 * mirror URL, without touching production alert code.
 *
 * Treats `mirrorUrl` exactly like a single mirror item from a real leak
 * account and runs it through the actual production pipeline:
 *   1. resolveDirectVideos (src/resolver.js) — mirror link -> direct video link
 *   2. mirrorVideosToFilebase (src/uploader.js) — best-effort Filebase mirror
 * The outcome is posted to a dedicated test webhook (never the real
 * DISCORD_WEBHOOK_URL channel). Returns a result object instead of throwing
 * so the endpoint can always respond with a clear status.
 */
async function handleTestVideo(mirrorUrl, webhookUrl = config.TEST_DISCORD_WEBHOOK_URL) {
  if (!webhookUrl) {
    return { success: false, skipped: true, error: 'No TEST_DISCORD_WEBHOOK_URL configured' };
  }

  const resolvedUrls = await resolveDirectVideos([{ label: 'test mirror', url: mirrorUrl }]);

  if (resolvedUrls.length === 0) {
    const content = `🧪 Test video alert\nMirror: ${mirrorUrl}\nCould not resolve a direct video link from this mirror.`;
    const posted = await postToWebhook(webhookUrl, content, mirrorUrl);
    return { ...posted, resolved: false };
  }

  // Best-effort: mirrors each resolved video to Filebase when configured,
  // falling back to the original resolved URL if mirroring is disabled,
  // blocked, or fails for any reason — same code path as the real pipeline.
  const finalUrls = await mirrorVideosToFilebase(resolvedUrls);
  const mirrored = finalUrls.some((url, i) => url !== resolvedUrls[i]);

  const content = [
    '🧪 Test video alert',
    `Mirror: ${mirrorUrl}`,
    `Resolved: ${resolvedUrls.join(', ')}`,
    mirrored
      ? `Mirrored to Filebase: ${finalUrls.join(', ')}`
      : 'Not mirrored (Filebase unset or download failed) — using resolved link(s)',
  ].join('\n');

  const posted = await postToWebhook(webhookUrl, content, mirrorUrl);
  return { ...posted, resolved: true, mirrored, resolvedUrls, finalUrls };
}

/**
 * Posts a plain-content test message to the given webhook, returning a
 * `{ success, error? }` result instead of throwing.
 */
async function postToWebhook(webhookUrl, content, mirrorUrl) {
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });

    if (!res.ok) {
      const text = await res.text();
      logger.error({ status: res.status, body: text, mirrorUrl }, 'Test video webhook failed');
      return { success: false, error: `HTTP ${res.status}` };
    }

    logger.info({ mirrorUrl }, 'Test video alert sent');
    return { success: true };
  } catch (err) {
    logger.error({ error: err.message, mirrorUrl }, 'Test video webhook error');
    return { success: false, error: err.message };
  }
}

module.exports = { handleTestVideo };

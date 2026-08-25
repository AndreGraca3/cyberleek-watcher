const config = require('./config');
const logger = require('./logger');
const { resolveDirectVideos } = require('./resolver');
const { mirrorVideosToFilebase } = require('./uploader');

/**
 * Returns true if the title contains any configured spoiler keyword as a
 * plain substring (case-insensitive) — e.g. keyword "death" matches both
 * "Carl death" and "carldeath". Intentionally permissive: false positives are
 * preferred over missing a spoiler. Always false when the filter is disabled
 * or no keywords are configured.
 */
function isSpoilerTitle(title, keywords = config.SPOILER_KEYWORDS) {
  if (!config.SPOILER_FILTER_ENABLED || keywords.length === 0) return false;
  const lowerTitle = title.toLowerCase();
  return keywords.some(keyword => lowerTitle.includes(keyword.toLowerCase()));
}

/**
 * Fetches the webhook's own avatar URL (Discord CDN) so it can be reused as the
 * embed footer icon. Returns null if the webhook has no avatar or the lookup fails.
 */
async function getWebhookAvatarUrl(webhookUrl) {
  try {
    const res = await fetch(webhookUrl);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.avatar) return null;
    return `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png`;
  } catch (err) {
    logger.warn({ error: err.message }, 'Failed to fetch webhook avatar');
    return null;
  }
}

// Tracks in-flight background dispatches (main alerts fired without being
// awaited by the caller, plus their decoupled video follow-ups) so CLI runs
// (`main()` in index.js) can await them before `process.exit()`. Not needed
// by the long-lived HTTP server, which keeps running regardless.
const pendingDispatches = new Set();

/**
 * Registers `promise` as in-flight background work and returns it unchanged.
 * Swallows rejections here (each dispatch function already logs its own
 * errors internally) purely to prevent an unhandled-rejection crash if
 * something unexpected throws.
 */
function trackDispatch(promise) {
  pendingDispatches.add(promise);
  const settle = promise.catch(() => {}).finally(() => pendingDispatches.delete(promise));
  void settle;
  return promise;
}

/**
 * Waits for all in-flight background dispatches to settle. Intended for
 * short-lived callers (the CLI) that would otherwise exit before background
 * work (Discord alert delivery, video resolution, Filebase mirroring, video
 * follow-up message) completes.
 */
function waitForPendingDispatches() {
  return Promise.allSettled([...pendingDispatches]);
}

/**
 * Resolves direct video links, best-effort mirrors them to Filebase, and
 * posts them as their own follow-up Discord message. Runs independently of
 * (and after) the main leak alert: a slow/blocked mirror download can never
 * delay or block the alert itself. Always spoiler-wraps the links (with
 * embed-preview suppression via `<>`) when the leak title is a spoiler, so
 * even this decoupled message stays spoiler-safe.
 */
async function dispatchVideoFollowUp(account, webhookUrl, isSpoiler) {
  try {
    const resolvedVideoUrls = await resolveDirectVideos(account.items);
    if (resolvedVideoUrls.length === 0) return;

    // Best-effort: mirrors each resolved video to Filebase when configured,
    // falling back to the original URL if mirroring is disabled, blocked, or
    // fails for any reason.
    const videoUrls = await mirrorVideosToFilebase(resolvedVideoUrls);

    const content = isSpoiler
      ? `🎥 Direct video (Spoiler):\n${videoUrls.map(u => `||<${u}>||`).join('\n')}`
      : `🎥 Direct video:\n${videoUrls.join('\n')}`;

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });

    if (!res.ok) {
      const text = await res.text();
      logger.error({ status: res.status, body: text, pubkey: account.pubkey }, 'Discord video follow-up failed');
      return;
    }

    logger.info({ pubkey: account.pubkey }, 'Discord video follow-up sent');
  } catch (err) {
    logger.error({ error: err.message, pubkey: account.pubkey }, 'Discord video follow-up error');
  }
}

async function sendDiscordAlert(account, webhookUrl = config.DISCORD_WEBHOOK_URL) {
  if (!webhookUrl) {
    logger.warn({ pubkey: account.pubkey }, 'No DISCORD_WEBHOOK_URL configured, skipping alert');
    return { success: false, skipped: true };
  }

  const footerIconUrl = await getWebhookAvatarUrl(webhookUrl);
  const isSpoiler = isSpoilerTitle(account.title);

  const embed = {
    title: isSpoiler ? '🚨 NEW GTA 6 LEAK - SPOILER WARNING ⚠️' : '🚨 NEW GTA 6 LEAK',
    description: 'For a safer viewing experience, consider searching for this leak on X (Twitter) instead of using mirror links.',
    color: 0x0064EC,
    timestamp: new Date(account.timestamp * 1000).toISOString(),
    fields: [
      { name: '🎬 Title', value: isSpoiler ? `||${account.title}||` : account.title, inline: false },
      {
        name: '⚠️ Safety Notice',
        value: 'Never enter passwords or download anything except video files!',
        inline: false,
      },
      {
        name: `🔗 Mirrors (${account.items.length})`,
        value: account.items.map(i => `• ||[${i.label}](${i.url})||`).join('\n') || 'None',
        inline: false,
      },
    ],
    footer: { text: 'CYBERLEEK Watcher', ...(footerIconUrl ? { icon_url: footerIconUrl } : {}) },
  };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });

    if (!res.ok) {
      const text = await res.text();
      logger.error({ status: res.status, body: text, pubkey: account.pubkey }, 'Discord webhook failed');
      return { success: false, skipped: false, error: `HTTP ${res.status}` };
    }

    logger.info({ pubkey: account.pubkey, title: account.title }, 'Discord alert sent');

    // Fire-and-forget: video resolution + Filebase mirroring + follow-up
    // message run independently, after the alert has already been sent, so
    // they never delay this response. Tracked only so the CLI can flush
    // pending work before exiting (see waitForPendingDispatches).
    trackDispatch(dispatchVideoFollowUp(account, webhookUrl, isSpoiler));

    return { success: true };
  } catch (err) {
    logger.error({ error: err.message, pubkey: account.pubkey }, 'Discord webhook error');
    return { success: false, skipped: false, error: err.message };
  }
}

async function sendPollAlert(poll, webhookUrl = config.DISCORD_WEBHOOK_URL) {
  if (!webhookUrl) {
    logger.warn({ pubkey: poll.pubkey }, 'No DISCORD_WEBHOOK_URL configured, skipping poll alert');
    return { success: false, skipped: true };
  }

  const footerIconUrl = await getWebhookAvatarUrl(webhookUrl);

  const embed = {
    title: '📊 NEW POLL',
    description: 'A new community poll was posted, deciding what leaks next.',
    color: 0x9B59B6,
    timestamp: new Date(poll.timestamp * 1000).toISOString(),
    fields: [
      { name: '❓ Question', value: poll.question, inline: false },
      {
        name: `📋 Options (${poll.options.length})`,
        value: poll.options.map(o => `• ${o}`).join('\n') || 'None',
        inline: false,
      },
      ...(poll.closesAt
        ? [{ name: '⏰ Ends', value: `<t:${poll.closesAt}:F> (<t:${poll.closesAt}:R>)`, inline: false }]
        : []),
    ],
    footer: { text: 'CYBERLEEK Watcher', ...(footerIconUrl ? { icon_url: footerIconUrl } : {}) },
  };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });

    if (!res.ok) {
      const text = await res.text();
      logger.error({ status: res.status, body: text, pubkey: poll.pubkey }, 'Discord poll webhook failed');
      return { success: false, skipped: false, error: `HTTP ${res.status}` };
    }

    logger.info({ pubkey: poll.pubkey, question: poll.question }, 'Discord poll alert sent');
    return { success: true };
  } catch (err) {
    logger.error({ error: err.message, pubkey: poll.pubkey }, 'Discord poll webhook error');
    return { success: false, skipped: false, error: err.message };
  }
}

async function sendPollResultsAlert(poll, webhookUrl = config.DISCORD_WEBHOOK_URL) {
  if (!webhookUrl) {
    logger.warn({ pubkey: poll.pubkey }, 'No DISCORD_WEBHOOK_URL configured, skipping poll results alert');
    return { success: false, skipped: true };
  }

  const footerIconUrl = await getWebhookAvatarUrl(webhookUrl);

  const voteCounts = poll.voteCounts || [];
  const totalVotes = voteCounts.reduce((sum, v) => sum + v, 0);
  const results = poll.options
    .map((label, i) => {
      const votes = voteCounts[i] || 0;
      const pct = totalVotes > 0 ? ((votes / totalVotes) * 100).toFixed(1) : '0.0';
      return { label, votes, pct };
    })
    .sort((a, b) => b.votes - a.votes);

  const winner = totalVotes > 0 ? results[0].label : null;

  const embed = {
    title: '🏁 POLL CLOSED — RESULTS',
    description: winner ? `**${winner}** won the vote!` : 'This poll closed with no votes recorded.',
    color: 0x2ECC71,
    timestamp: new Date(poll.closesAt * 1000).toISOString(),
    fields: [
      { name: '❓ Question', value: poll.question, inline: false },
      {
        name: '📋 Final Results',
        value: results.map(r => `${r.label === winner ? '👑' : '•'} ${r.label}: ${r.pct}%`).join('\n') || 'None',
        inline: false,
      },
    ],
    footer: { text: 'CYBERLEEK Watcher', ...(footerIconUrl ? { icon_url: footerIconUrl } : {}) },
  };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });

    if (!res.ok) {
      const text = await res.text();
      logger.error({ status: res.status, body: text, pubkey: poll.pubkey }, 'Discord poll results webhook failed');
      return { success: false, skipped: false, error: `HTTP ${res.status}` };
    }

    logger.info({ pubkey: poll.pubkey, question: poll.question }, 'Discord poll results alert sent');
    return { success: true };
  } catch (err) {
    logger.error({ error: err.message, pubkey: poll.pubkey }, 'Discord poll results webhook error');
    return { success: false, skipped: false, error: err.message };
  }
}

module.exports = {
  sendDiscordAlert,
  sendPollAlert,
  sendPollResultsAlert,
  isSpoilerTitle,
  trackDispatch,
  waitForPendingDispatches,
};

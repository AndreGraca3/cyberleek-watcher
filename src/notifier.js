const config = require('./config');
const logger = require('./logger');
const { resolveDirectVideos } = require('./resolver');

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

async function sendDiscordAlert(account, webhookUrl = config.DISCORD_WEBHOOK_URL) {
  if (!webhookUrl) {
    logger.warn({ pubkey: account.pubkey }, 'No DISCORD_WEBHOOK_URL configured, skipping alert');
    return { success: false, skipped: true };
  }

  const [directVideoUrls, footerIconUrl] = await Promise.all([
    resolveDirectVideos(account.items),
    getWebhookAvatarUrl(webhookUrl),
  ]);

  const isSpoiler = isSpoilerTitle(account.title);

  const embed = {
    title: isSpoiler ? '⚠️ SPOILER ALERT — NEW GTA 6 LEAK' : '🚨 NEW GTA 6 LEAK',
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
      // When the title matches a spoiler keyword, the direct video link is kept
      // inside the embed (spoilered) instead of being sent as a separate,
      // auto-unfurling follow-up message.
      ...(isSpoiler && directVideoUrls.length > 0
        ? [{
            name: '🎥 Direct Video (Spoiler)',
            value: directVideoUrls.map(u => `||${u}||`).join('\n'),
            inline: false,
          }]
        : []),
    ],
    footer: { text: 'CYBERLEEK Watcher', ...(footerIconUrl ? { icon_url: footerIconUrl } : {}) },
  };

  try {
    // Send the embed first, then (for non-spoiler leaks) the direct video link
    // as a separate follow-up message: Discord doesn't auto-unfurl a raw video
    // link in the same payload that already contains a manual embed, so they
    // must be sent separately.
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

    if (!isSpoiler && directVideoUrls.length > 0) {
      // Bare URLs (not markdown-wrapped, not spoilered) so Discord can auto-unfurl a
      // playable video; the mirror links in the embed above still work as a fallback.
      const videoRes = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `🎥 Direct video:\n${directVideoUrls.join('\n')}` }),
      });

      if (!videoRes.ok) {
        const text = await videoRes.text();
        logger.error({ status: videoRes.status, body: text, pubkey: account.pubkey }, 'Discord video follow-up failed');
      }
    }

    logger.info({ pubkey: account.pubkey, title: account.title }, 'Discord alert sent');
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

module.exports = { sendDiscordAlert, sendPollAlert, sendPollResultsAlert, isSpoilerTitle };

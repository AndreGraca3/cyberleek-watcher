const config = require('./config');
const logger = require('./logger');
const { resolveDirectVideos } = require('./resolver');

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

  const embed = {
    title: '🚨 NEW GTA 6 LEAK',
    description: 'For a safer viewing experience, consider searching for this leak on X (Twitter) instead of using mirror links.',
    color: 0x0064EC,
    timestamp: new Date(account.timestamp * 1000).toISOString(),
    fields: [
      { name: '🎬 Title', value: account.title, inline: false },
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
    // Send the embed first, then the direct video link as a separate follow-up
    // message: Discord doesn't auto-unfurl a raw video link in the same payload
    // that already contains a manual embed, so they must be sent separately.
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

    if (directVideoUrls.length > 0) {
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

module.exports = { sendDiscordAlert };

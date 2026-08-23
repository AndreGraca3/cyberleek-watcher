const config = require('./config');
const logger = require('./logger');
const { resolveDirectVideos } = require('./resolver');

async function sendDiscordAlert(account, webhookUrl = config.DISCORD_WEBHOOK_URL) {
  if (!webhookUrl) {
    logger.warn({ pubkey: account.pubkey }, 'No DISCORD_WEBHOOK_URL configured, skipping alert');
    return { success: false, skipped: true };
  }

  const directVideoUrls = await resolveDirectVideos(account.items);

  const embed = {
    title: '🚨 NEW GTA 6 LEAK',
    description: 'For a safer viewing experience, consider searching for this leak on X (Twitter) instead of using mirror links.',
    color: 0x0064EC,
    timestamp: new Date(account.timestamp * 1000).toISOString(),
    fields: [
      { name: '🎬 Title', value: account.title, inline: false },
      {
        name: `🔗 Mirrors (${account.items.length})`,
        value: account.items.map(i => `• [${i.label}](${i.url})`).join('\n') || 'None',
        inline: false,
      },
      {
        name: '⚠️ Safety Notice',
        value: 'Third-party mirrors — never enter passwords or download unexpected files.',
        inline: false,
      },
    ],
    footer: { text: 'CYBERLEEK Watcher' },
  };

  const payload = { embeds: [embed] };
  // Bare URLs in content (not markdown-wrapped) so Discord can auto-unfurl a playable video;
  // if it doesn't render, the mirror links in the embed above still work as a fallback.
  if (directVideoUrls.length > 0) {
    payload.content = directVideoUrls.join('\n');
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      logger.error({ status: res.status, body: text, pubkey: account.pubkey }, 'Discord webhook failed');
      return { success: false, skipped: false, error: `HTTP ${res.status}` };
    }

    logger.info({ pubkey: account.pubkey, title: account.title }, 'Discord alert sent');
    return { success: true };
  } catch (err) {
    logger.error({ error: err.message, pubkey: account.pubkey }, 'Discord webhook error');
    return { success: false, skipped: false, error: err.message };
  }
}

module.exports = { sendDiscordAlert };

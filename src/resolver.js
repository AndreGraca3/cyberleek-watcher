const logger = require('./logger');

// Gateways known to already serve the raw file directly (permanent, content-addressed storage).
const DIRECT_HOSTS = ['arweave.net', 'turbo-gateway.com', 'vilenarios.com', 'ar.io'];
const VIDEO_EXT_RE = /\.(mp4|webm|mov|m3u8)(\?|$)/i;
const VIDEO_LINK_RE = /https?:\/\/[^"'\s<>]+\.(mp4|webm|mov|m3u8)/gi;
const RESOLVE_TIMEOUT_MS = 6000;

/**
 * Attempts to resolve a mirror URL to a direct, playable video file URL.
 * Returns null if no direct link could be found (mirror is JS-rendered,
 * requires an API call, or is unreachable).
 */
async function resolveDirectVideo(url) {
  try {
    const hostname = new URL(url).hostname;
    if (DIRECT_HOSTS.some(h => hostname.endsWith(h))) return url;
    if (VIDEO_EXT_RE.test(url)) return url;

    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS) });
    const contentType = res.headers.get('content-type') || '';
    if (contentType.startsWith('video/')) return res.url;

    if (contentType.includes('text/html')) {
      const html = await res.text();
      const matches = [...html.matchAll(VIDEO_LINK_RE)].map(m => m[0]);
      if (matches.length > 0) return matches[0];
    }
  } catch (err) {
    logger.warn({ url, error: err.message }, 'Failed to resolve direct video link');
  }
  return null;
}

/**
 * Resolves direct video links for all mirror items, returning a de-duplicated list.
 */
async function resolveDirectVideos(items) {
  const resolved = await Promise.all(items.map(item => resolveDirectVideo(item.url)));
  return [...new Set(resolved.filter(Boolean))];
}

module.exports = { resolveDirectVideo, resolveDirectVideos };

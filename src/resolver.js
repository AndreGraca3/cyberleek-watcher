const logger = require('./logger');

// Gateways known to already serve the raw file directly (permanent, content-addressed storage).
const DIRECT_HOSTS = ['arweave.net', 'turbo-gateway.com', 'vilenarios.com', 'ar.io'];
const VIDEO_LINK_RE = /https?:\/\/[^"'\s<>]+\.(mp4|webm|mov|m3u8)/gi;
const RESOLVE_TIMEOUT_MS = 6000;
const FORM_TAG_RE = /<form\b[^>]*>/i;
const FORM_METHOD_POST_RE = /\bmethod\s*=\s*["']?post["']?/i;
const FORM_ACTION_RE = /\baction\s*=\s*["']([^"']*)["']/i;

/**
 * Detects the common "HTML confirmation page requiring a POST to download"
 * pattern seen on some file-sharing hosts (e.g. temp.sh serves an HTML page
 * with a `<form method="POST">Click here to download</form>` instead of the
 * file itself on a plain GET). Returns the absolute URL to POST to in order
 * to receive the actual file, or null if the page doesn't match this
 * pattern. Intentionally generic (not tied to any specific hostname) so any
 * host using the same convention is handled, not just the one we've seen.
 */
function extractPostDownloadUrl(html, baseUrl) {
  const formTag = html.match(FORM_TAG_RE);
  if (!formTag || !FORM_METHOD_POST_RE.test(formTag[0])) return null;

  const actionMatch = formTag[0].match(FORM_ACTION_RE);
  try {
    // A form with no (or empty) `action` submits back to its own page, per
    // the HTML spec — same as `baseUrl`.
    return actionMatch ? new URL(actionMatch[1], baseUrl).toString() : baseUrl;
  } catch (err) {
    return baseUrl;
  }
}

/**
 * Attempts to resolve a mirror URL to a direct, playable video file URL.
 * Returns null if no direct link could be found (mirror is JS-rendered,
 * requires an API call, or is unreachable).
 */
async function resolveDirectVideo(url) {
  try {
    const hostname = new URL(url).hostname;
    if (DIRECT_HOSTS.some(h => hostname.endsWith(h))) return url;

    // Always verify via a real fetch rather than trusting a `.mp4`-style
    // extension in the URL — some hosts (e.g. temp.sh) put a filename in
    // the URL but actually serve an HTML confirmation page there, not the
    // file itself (see extractPostDownloadUrl below).
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS) });
    const contentType = res.headers.get('content-type') || '';
    if (contentType.startsWith('video/')) return res.url;

    if (contentType.includes('text/html')) {
      const html = await res.text();

      const postUrl = extractPostDownloadUrl(html, res.url);
      if (postUrl) {
        const postRes = await fetch(postUrl, { method: 'POST', redirect: 'follow', signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS) });
        if ((postRes.headers.get('content-type') || '').startsWith('video/')) return url;
      }

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

module.exports = { resolveDirectVideo, resolveDirectVideos, extractPostDownloadUrl };

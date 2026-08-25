const http = require('http');
const config = require('./config');
const logger = require('./logger');
const { runWatcher } = require('./index');
const { handleTest } = require('./testEndpoint');

// Upper bound on the `delay` query param (seconds) accepted by /check. Kept
// safely under 60s so a delayed run can't still be pending when the *next*
// minute's cron trigger fires (which would otherwise overlap two runWatcher()
// calls).
const MAX_CHECK_DELAY_SECONDS = 45;

function createServer() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if ((req.method === 'GET' && url.pathname === '/') || (req.method === 'GET' && url.pathname === '/health')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'cyberleek-watcher' }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/check') {
      // Optional `delay` (seconds): lets a second, identically-scheduled
      // cron-job.org job offset itself mid-minute (e.g. `?delay=20`) so the
      // two jobs combined poll more often than once a minute. When a delay is
      // requested, respond immediately (so the caller's own timeout can never
      // be hit) and run the actual check afterwards in the background.
      const rawDelay = Number(url.searchParams.get('delay'));
      const delaySeconds = Number.isFinite(rawDelay)
        ? Math.min(Math.max(rawDelay, 0), MAX_CHECK_DELAY_SECONDS)
        : 0;

      if (delaySeconds > 0) {
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'scheduled', delaySeconds }));
        setTimeout(() => {
          runWatcher().catch(err => logger.error(err, 'Delayed check failed'));
        }, delaySeconds * 1000);
        return;
      }

      try {
        const result = await runWatcher();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        logger.error(err, 'Check endpoint failed');
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: err.message }));
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/test-check') {
      // Live test harness: pass `?url=<mirror-link>` (e.g. a bedrive.ru,
      // temp.sh, upload.ee, or arweave URL exactly like a real leak's item
      // link) and it's wrapped in a fake leak account, then run through the
      // *real* sendDiscordAlert (src/notifier.js) — same embed, same
      // resolveDirectVideos + Filebase mirroring + video follow-up — just
      // pointed at TEST_DISCORD_WEBHOOK_URL instead of the real alert
      // channel. Guarded by TEST_ENDPOINT_TOKEN (when set) since it
      // triggers real network fetches/downloads/uploads/webhook posts.
      // Optional `?spoiler=true|false` forces the spoiler embed rendering.
      if (config.TEST_ENDPOINT_TOKEN && url.searchParams.get('token') !== config.TEST_ENDPOINT_TOKEN) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: 'Invalid or missing token' }));
        return;
      }

      const mirrorUrl = url.searchParams.get('url');
      if (!mirrorUrl) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: 'Missing required "url" query param' }));
        return;
      }

      // Optional `spoiler=true`/`spoiler=false` forces the spoiler embed
      // rendering regardless of SPOILER_KEYWORDS/title, for testing that
      // path specifically. Omitted (or any other value) falls back to the
      // real title-keyword-based detection, same as production.
      const spoilerParam = url.searchParams.get('spoiler');
      const spoilerOverride = spoilerParam === null ? null : /^true$/i.test(spoilerParam);

      try {
        const result = handleTest(mirrorUrl, undefined, spoilerOverride);
        // Fire-and-forget, same as /check: dispatched (202) once the alert
        // has been kicked off in the background, not once it's actually
        // landed in Discord. Only fails synchronously (200/error) when
        // TEST_DISCORD_WEBHOOK_URL isn't configured at all.
        res.writeHead(result.dispatched ? 202 : 200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: result.dispatched ? 'scheduled' : 'error', ...result }));
      } catch (err) {
        logger.error(err, 'Test endpoint failed');
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: err.message }));
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'not found' }));
  });

  return server;
}

function startServer(port = process.env.PORT || 3000) {
  const server = createServer();
  server.listen(port, '0.0.0.0', () => {
    logger.info({ port }, 'Cyberleek Watcher HTTP server listening');
  });
  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = { createServer, startServer };

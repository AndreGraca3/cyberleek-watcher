const http = require('http');
const config = require('./config');
const logger = require('./logger');
const { runWatcher } = require('./index');

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

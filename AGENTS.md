# Cyberleek Watcher - Agent Context

## Goal
Render Free Web Service + cron-job.org watcher for CYBERLEEK Solana leak accounts. $0/mo, 24/7.

## Source of Truth Order
`README.md` → `package.json` → `src/config.js` → `src/server.js` → `src/index.js` → `src/store.js` → tests. If docs conflict with code, code wins.

## Entrypoints & Execution
- **Render start**: `node index.js` → requires `src/server.js` → calls `startServer()`.
- **CLI single check**: `node src/index.js` → calls `main()` → exits.
- **HTTP server**: `node src/server.js` or `npm start` → binds `0.0.0.0:process.env.PORT || 3000`.
- **`runWatcher()`** is the reusable core. `main()` is the CLI wrapper. `server.js` uses `runWatcher()` directly for `/check`.

## Env / Secrets
- `dotenv` loads `.env` implicitly from `src/config.js` (`require('dotenv').config()` at top). No separate init step.
- `.env` is gitignored. `.env.example` is the template.
- State store selection is implicit in `src/store.js`:
  - Both `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` set → Upstash Redis.
  - Otherwise → local file at `LOCAL_STATE_PATH` (default `./data/state.json`, relative to CWD).

## Commands
```bash
npm install
npm test          # chains verify-fetch -> verify-engine -> verify-run -> verify-server
npm start         # HTTP server on :3000
npm run check:once # single CLI check
node test/test-discord.js # live Discord test
```

## Test Quirks
- Tests are chained with `&&` in `package.json`. If one fails, the rest don't run.
- `test/verify-server.js` hardcodes port `3456`. Ensure it's free before running.
- `test/verify-run.js` must set `process.env` **before** requiring `../src/index`, because `config.js` reads env at module load time.
- `test/test-discord.js` requires real `DISCORD_WEBHOOK_URL` in `.env`.

## Data Model
- Program: `7rAgHPLDc9NryZmNdeEzyDui6D9PHkvTxMjKhNSa7w3a`
- Filter: `memcmp offset 0 bytes G6JNBZ2BSey` + `dataSize 7156`
- Account size: 7156 bytes. Discriminator 0-7, authority 8-39, timestamp i64 LE at 40-47, title from 48.
- Each new leak = new account (new pubkey). Existing accounts immutable.
- Unique ID = pubkey. Titles can repeat.

## State Schema
```json
{
  "initialized": true,
  "seenPubkeys": ["pubkey1", "pubkey2"],
  "lastMaxTimestamp": 1787158475,
  "updatedAt": "2026-08-20T01:00:00.000Z"
}
```
- Hybrid: `seenPubkeys` for exact duplicate suppression + `lastMaxTimestamp` for monotonic ordering.
- Bootstrap (cold start / no state): scans all current accounts, saves pubkeys + max timestamp, sends **no** alerts.
- Subsequent runs: only accounts with pubkey not in `seenPubkeys` trigger Discord alerts.

## HTTP Endpoints
- `GET /` or `GET /health` → `200 {"status":"ok","service":"cyberleek-watcher"}`
- `GET /check` → runs watcher, returns execution JSON or `500 {"status":"error","message":...}`
- Other → `404 {"status":"not found"}`

## Deployment Constraints
- Render Free: ephemeral filesystem, no persistent disk, SMTP blocked (ports 25/465/587), 5 GB bandwidth/mo, 750 hours/mo.
- Use Upstash Redis Free (256 MB, 500K commands/mo) for state. Render Key Value is in-memory only and loses data on restart. Render Postgres Free expires after 30 days.
- Discord webhook over HTTPS (port 443). No daily caps, rich embeds. One secret to manage.
- Solana Labs public RPC: ~868ms response, ~76 KB. Limits: 100 req/10s per IP, 40 req/10s per method. 1 req/60s is safe.

## What NOT to Do
- Don't scrape `https://cyberleek.ar.io/` (frontend is down / separate from on-chain data).
- Don't use WebSocket on Render Free (dyno sleep kills connection; cold-start blind spot negates benefit).
- Don't add a database "because one is available." The hybrid state schema + Upstash Redis is sufficient.
- Don't use `setInterval` in-process on Render Free; use cron-job.org to ping `/check` every 60s.

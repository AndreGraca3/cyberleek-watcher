# DISCLAIMER: This app has no affiliation with CYBERLEEK or ROCKSTAR Nor does it hold any leaked or copyright content, it simply makes requests on the solana blockchain

# CYBERLEEK Watcher

Lightweight Node.js watcher that monitors the CYBERLEEK Solana program for new leak accounts and sends rich Discord notifications. Designed for a 100% free ($0/mo) deployment on **Render Free Web Service + cron-job.org**.

## How It Works

CYBERLEEK publishes leaks as on-chain Solana accounts under program `7rAgHPLDc9NryZmNdeEzyDui6D9PHkvTxMjKhNSa7w3a`. Each new leak creates a new immutable account.

This watcher runs as a lightweight HTTP microservice:
1. **`GET /health`** - Instant health check (`200 OK`).
2. **`GET /check`** - Runs the full watcher pipeline:
   - Fetches on-chain program accounts via Solana JSON-RPC (both leak accounts and poll accounts).
   - Decodes 7156-byte leak payloads and 2800-byte poll payloads (Borsh-like binary layouts).
   - Diffs each against its own persisted state (Upstash Redis or local fallback).
   - Dispatches rich embed notifications to Discord if new leaks and/or new polls are detected.
   - Returns execution results as JSON.
3. **`GET /test-video?url=<mirror-link>`** - Live test harness (only active when `TEST_DISCORD_WEBHOOK_URL` is set): treats `url` exactly like one mirror item from a real leak (e.g. a bedrive.ru/temp.sh/upload.ee/arweave link), and runs it through the **full real pipeline** — `resolveDirectVideos` (mirror → direct video link, `src/resolver.js`) then best-effort Filebase mirroring if configured (`src/uploader.js`) — before posting the outcome to `TEST_DISCORD_WEBHOOK_URL`, never the real `DISCORD_WEBHOOK_URL` channel. If `TEST_ENDPOINT_TOKEN` is set, requests must include a matching `?token=` param, since this endpoint triggers real network fetches/downloads/uploads/webhook posts.

An external free cron scheduler (**cron-job.org**) pings `/check` every **60 seconds**, which keeps the Render Free instance awake 24/7 (preventing the 15-minute idle sleep) and executes checks on a strict 1-minute schedule.

Optionally, `/check` accepts a `delay` query param (seconds, capped at 45): a second cron-job.org job on the same 1-minute schedule can hit `/check?delay=20` to offset itself mid-minute, so the two jobs combined poll more often than once a minute. When `delay` is set, the endpoint responds immediately with `202 {"status":"scheduled"}` and runs the actual check afterwards in the background, so cron-job.org's own request timeout is never at risk.

### Data Path Specifications
- **Solana Program ID**: `7rAgHPLDc9NryZmNdeEzyDui6D9PHkvTxMjKhNSa7w3a`
- **Leak RPC Method**: `getProgramAccounts` with filters (`memcmp` at offset 0: `G6JNBZ2BSey`, `dataSize`: `7156`)
- **Poll RPC Method**: `getProgramAccounts` with filters (`memcmp` at offset 0: `5Qpj1hsHT4k`, `dataSize`: `2800`)
- **Encoding**: `base64`
- **Execution Time**: ~800-1000ms per poll
- **Response Size**: ~76 KB per poll

### Account Binary Layout (leaks, `src/decoder.js`)
- Bytes `0..7`: 8-byte discriminator (skip)
- Bytes `8..39`: 32-byte authority pubkey
- Bytes `40..47`: `i64 LE` creation timestamp (Unix seconds)
- Bytes `48..51`: `u32 LE` title length
- Bytes `52..(52+len)`: UTF-8 string title
- Next 4 bytes: `u32 LE` item count
- Per item: `u32 LE` label length → UTF-8 string → `u32 LE` url length → UTF-8 string

### Account Binary Layout (polls, `src/pollDecoder.js`)
- Bytes `0..7`: 8-byte discriminator (skip)
- Bytes `8..39`: 32-byte authority pubkey (unused)
- Bytes `40..47`: `i64 LE` creation timestamp (Unix seconds)
- Bytes `48..79`: fixed 32-byte poll ID buffer, null-padded (e.g. `poll-1787506592812`)
- Bytes `80..83`: `u32 LE` question length
- Next `len` bytes: UTF-8 string question
- Next 4 bytes: `u32 LE` option count
- Per option: `u32 LE` length → UTF-8 string
- Next 8 bytes: `i64 LE` `closesAt` (Unix seconds when voting ends)
- Next 4 bytes: `u32 LE` flag-array length, followed by that many raw bytes (per-option flags; meaning unconfirmed, currently unused)
- Next 4 bytes: `u32 LE` vote-count array length, followed by that many `u64 LE` values (one per option — appears to be token-weighted vote totals, not raw ballot counts)

### Poll Lifecycle Notifications
Two separate poll alerts are sent, tracked independently from each other and from leaks so enabling this feature never retroactively spams existing data:
1. **New poll created** (`🗳️`/`📊 NEW POLL`) — fired once per new poll pubkey.
2. **Poll closed / results** (`🏁 POLL CLOSED — RESULTS`) — fired once `closesAt` has passed for a poll not yet announced as closed, showing the winning option and vote share for each option. Votes/closure update the *same* on-chain account (confirmed via transaction history), so this never duplicates the "new poll" alert.

### Filebase Video Mirroring (Optional)
When `FILEBASE_ACCESS_KEY`, `FILEBASE_SECRET_KEY`, and `FILEBASE_BUCKET` are all set, `src/uploader.js` downloads each resolved direct video link and re-uploads it to that Filebase bucket via Filebase's S3-compatible API, so the follow-up video message (see below) links to a stable, self-hosted copy instead of the original mirror. This is entirely best-effort:
- If Filebase isn't configured (or only partially configured), mirroring is skipped and the original mirror link is used, with no added latency. A partial config (e.g. only `FILEBASE_BUCKET` set) logs a one-time warning so a typo doesn't silently disable the feature unnoticed.
- If the source host blocks or rate-limits the download (common for mirror sites), or the upload otherwise fails, the watcher logs a warning and falls back to the original link — it never blocks, delays, or drops the leak alert itself.
- Downloads are capped at `FILEBASE_MAX_VIDEO_MB` (default 200MB) and `FILEBASE_DOWNLOAD_TIMEOUT_MS` (default 45s) to protect Render's free-tier bandwidth/memory limits.
- Filebase buckets are private by default (public bucket policies require a paid Filebase plan), so mirror links are presigned S3 GET URLs, valid for `FILEBASE_URL_EXPIRY_SECONDS` (default/max 7 days — the SigV4 signature limit), not plain public `https://<bucket>.s3.filebase.com/...` links.
- Multiple video items for the same leak download in parallel and are each buffered fully in memory, so raising `FILEBASE_MAX_VIDEO_MB` increases peak RAM use — keep it comfortably under Render free tier's ~512MB limit.

### Decoupled Alert & Video Dispatch
`/check`'s response body (diff results, counts, state) never depends on Discord delivery succeeding — state is persisted as soon as new accounts/polls are diffed, regardless of alert outcome. So all Discord dispatch is fire-and-forget from `runWatcher()`'s perspective (`src/index.js`, `trackDispatch`/`waitForPendingDispatches` in `src/notifier.js`):
- `/check` (without the `delay` query param) only waits on the Solana RPC fetch, diff evaluation, and state save — not on any Discord webhook call, main alert or otherwise.
- The main leak/poll alert embed is dispatched in the background as soon as new items are detected. Video link resolution, Filebase mirroring, and posting happen even further downstream, as a **separate** follow-up Discord message (`dispatchVideoFollowUp`) sent only after the main alert succeeds.
- This is safe on the long-lived HTTP server (the Node process keeps running after the response is sent). The CLI (`npm run check:once`) explicitly waits for all pending dispatches before exiting, since it would otherwise terminate the process mid-flight.
- Spoiler-flagged leaks still get a spoiler-safe follow-up: video links are wrapped as `||<url>||` (spoiler + suppressed embed preview) instead of being posted as bare, auto-unfurling URLs.

---

## Project Structure

```text
├── index.js             # Root entry point (boots HTTP server)
├── src/
│   ├── config.js        # Environment variables & default constants
│   ├── logger.js        # Structured Pino logger
│   ├── decoder.js       # Leak account binary buffer parser
│   ├── pollDecoder.js   # Poll account binary buffer parser
│   ├── fetcher.js       # Solana RPC getProgramAccounts client (leaks + polls)
│   ├── store.js         # Upstash Redis REST + Local File fallback
│   ├── engine.js        # Bootstrap & diff detection engine (leaks + polls)
│   ├── notifier.js      # Discord webhook rich embed sender (leaks + polls)
│   ├── uploader.js      # Best-effort Filebase (S3-compatible) video mirroring
│   ├── testVideoEndpoint.js # /test-video business logic (resolve + mirror + test webhook post)
│   ├── server.js        # Native HTTP server (/health, /check, /test-video)
│   └── index.js         # Core orchestrator & CLI runner
├── test/
│   ├── verify-fetch.js  # Verifies live Solana RPC fetch & decode
│   ├── verify-engine.js # Verifies diff engine & state storage logic
│   ├── verify-run.js    # Verifies end-to-end execution lifecycle
│   ├── verify-server.js # Verifies HTTP endpoints (/health, /check)
│   └── test-discord.js  # Live test embed delivery to Discord
├── .env.example
├── package.json
└── AGENTS.md            # Agent context & architectural decisions
```

---

## Setup & Local Development

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
```

Edit `.env` with your credentials:
```env
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
UPSTASH_REDIS_REST_URL=https://....upstash.io
UPSTASH_REDIS_REST_TOKEN=...
STATE_KEY=cyberleek:state
LOG_LEVEL=info
```

### Running Locally

- **Start HTTP Web Server**:
  ```bash
  npm start
  ```
  Listens on `http://localhost:3000`. Test via `http://localhost:3000/check`.

- **Run Single CLI Check**:
  ```bash
  npm run check:once
  ```

---

## Testing

Run all 4 automated test suites:
```bash
npm test
```

Includes:
- `test/verify-fetch.js` - Live Solana mainnet account query and decoding.
- `test/verify-engine.js` - State bootstrapping, duplicate suppression, and mock leak diffing.
- `test/verify-run.js` - End-to-end bootstrap and no-op run lifecycle.
- `test/verify-server.js` - HTTP server routes, status codes, and JSON responses.

Test live Discord alert delivery:
```bash
node test/test-discord.js
```

---

## Deployment (Render + cron-job.org)

### 1. Render Web Service (Free Tier)
1. In Render Dashboard, click **New +** → **Web Service**.
2. Connect your Git repository.
3. Settings:
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: `Free` ($0/mo)
4. Add your Environment Variables (`DISCORD_WEBHOOK_URL`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, etc.).
5. Deploy. You will receive a URL like `https://cyberleek-watcher.onrender.com`.

### 2. cron-job.org (Free 1-Minute Scheduler)
1. Sign up at [cron-job.org](https://cron-job.org) (Free).
2. Click **Create Cronjob**:
   - **URL**: `https://cyberleek-watcher.onrender.com/check`
   - **Schedule**: Every **1 minute** (`* * * * *`)
   - **Request Method**: `GET`
   - **Save responses in job history**: Checked
3. Save the job.

### 3. (Optional) Second cron-job.org job for tighter polling
1. Click **Create Cronjob** again:
   - **URL**: `https://cyberleek-watcher.onrender.com/check?delay=20`
   - **Schedule**: Every **1 minute** (`* * * * *`)
   - **Request Method**: `GET`
   - **Request Timeout**: leave at default — the delayed check runs in the background *after* an immediate `202` response, so it can't trigger cron-job.org's request timeout.
2. Save the job. Combined with the first job, this polls more often than every 60 seconds without any timeout risk.

---

## Architecture Highlights

- **Immune to Frontend Downtime**: Does not scrape the Arweave frontend (`https://cyberleek.ar.io/`). It queries the Solana blockchain directly via JSON-RPC.
- **Zero Idle Spindown**: 1-minute cron pings keep the Render Free web service permanently awake (<15 min idle limit).
- **Zero Historical Spam**: State baseline is absorbed silently on first run; only net-new accounts trigger Discord embeds.
- **Polls & Leaks Tracked Independently**: New polls and new leaks are diffed and bootstrapped separately (`seenPubkeys`/`lastMaxTimestamp` for leaks vs. `seenPollPubkeys`/`lastMaxPollTimestamp` for polls) so enabling poll alerts on an existing deployment won't retroactively spam already-known leaks or vice versa.
- **100% Free**: Operates comfortably within Render Free, Upstash Redis Free, cron-job.org Free, and Discord Webhook limits.

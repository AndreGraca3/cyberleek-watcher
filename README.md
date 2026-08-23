# DISCLAIMER: This app has no affiliation with CYBERLEEK or ROCKSTAR Nor does it hold any leaked or copyright content, it simply makes requests on the solana blockchain

# CYBERLEEK Watcher

Lightweight Node.js watcher that monitors the CYBERLEEK Solana program for new leak accounts and sends rich Discord notifications. Designed for a 100% free ($0/mo) deployment on **Render Free Web Service + cron-job.org**.

## How It Works

CYBERLEEK publishes leaks as on-chain Solana accounts under program `7rAgHPLDc9NryZmNdeEzyDui6D9PHkvTxMjKhNSa7w3a`. Each new leak creates a new immutable account.

This watcher runs as a lightweight HTTP microservice:
1. **`GET /health`** - Instant health check (`200 OK`).
2. **`GET /check`** - Runs the full watcher pipeline:
   - Fetches on-chain program accounts via Solana JSON-RPC.
   - Decodes 7156-byte binary Borsh-like payloads.
   - Diffs against persisted state (Upstash Redis or local fallback).
   - Dispatches rich embed notifications to Discord if new leaks are detected.
   - Returns execution results as JSON.

An external free cron scheduler (**cron-job.org**) pings `/check` every **60 seconds**, which keeps the Render Free instance awake 24/7 (preventing the 15-minute idle sleep) and executes checks on a strict 1-minute schedule.

### Data Path Specifications
- **Solana Program ID**: `7rAgHPLDc9NryZmNdeEzyDui6D9PHkvTxMjKhNSa7w3a`
- **RPC Method**: `getProgramAccounts` with filters (`memcmp` at offset 0: `G6JNBZ2BSey`, `dataSize`: `7156`)
- **Encoding**: `base64`
- **Account Binary Size**: `7156` bytes
- **Execution Time**: ~800-1000ms per poll
- **Response Size**: ~76 KB per poll

### Account Binary Layout
- Bytes `0..7`: 8-byte discriminator (skip)
- Bytes `8..39`: 32-byte authority pubkey
- Bytes `40..47`: `i64 LE` creation timestamp (Unix seconds)
- Bytes `48..51`: `u32 LE` title length
- Bytes `52..(52+len)`: UTF-8 string title
- Next 4 bytes: `u32 LE` item count
- Per item: `u32 LE` label length → UTF-8 string → `u32 LE` url length → UTF-8 string

---

## Project Structure

```text
├── index.js             # Root entry point (boots HTTP server)
├── src/
│   ├── config.js        # Environment variables & default constants
│   ├── logger.js        # Structured Pino logger
│   ├── decoder.js       # Binary account buffer parser
│   ├── fetcher.js       # Solana RPC getProgramAccounts client
│   ├── store.js         # Upstash Redis REST + Local File fallback
│   ├── engine.js        # Bootstrap & diff detection engine
│   ├── notifier.js      # Discord webhook rich embed sender
│   ├── server.js        # Native HTTP server (/health, /check)
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

---

## Architecture Highlights

- **Immune to Frontend Downtime**: Does not scrape the Arweave frontend (`https://cyberleek.ar.io/`). It queries the Solana blockchain directly via JSON-RPC.
- **Zero Idle Spindown**: 1-minute cron pings keep the Render Free web service permanently awake (<15 min idle limit).
- **Zero Historical Spam**: State baseline is absorbed silently on first run; only net-new accounts trigger Discord embeds.
- **100% Free**: Operates comfortably within Render Free, Upstash Redis Free, cron-job.org Free, and Discord Webhook limits.

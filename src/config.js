require('dotenv').config();

const config = {
  SOLANA_RPC_URL: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  PROGRAM_ID: process.env.PROGRAM_ID || '7rAgHPLDc9NryZmNdeEzyDui6D9PHkvTxMjKhNSa7w3a',
  MEMCMP_BYTES: process.env.MEMCMP_BYTES || 'G6JNBZ2BSey',
  DATA_SIZE: Number(process.env.DATA_SIZE) || 7156,
  POLL_MEMCMP_BYTES: process.env.POLL_MEMCMP_BYTES || '5Qpj1hsHT4k',
  POLL_DATA_SIZE: Number(process.env.POLL_DATA_SIZE) || 2800,
  // Fallback only: primary signal is the poll account's data stabilizing
  // (no changes across consecutive checks) — see engine.js. If it never
  // stabilizes (e.g. a stuck ProcessResults crank), notify anyway once this
  // long past closesAt.
  POLL_CLOSE_GRACE_SECONDS: Number(process.env.POLL_CLOSE_GRACE_SECONDS) || 1800,
  // Cooldown after closesAt before we start comparing consecutive reads for
  // stability. Prevents mistaking "nothing has processed yet" (all-zero,
  // unchanging) for "processing finished" (also unchanging). Set above the
  // fastest observed first ProcessResults landing (~78s on real data), with
  // margin for slower/larger polls (~177s observed on a 4-option poll).
  POLL_SETTLE_MIN_DELAY_SECONDS: Number(process.env.POLL_SETTLE_MIN_DELAY_SECONDS) || 240,
  // When enabled, leak titles matching SPOILER_KEYWORDS are announced with a
  // spoiler-safe embed: no auto-unfurled direct video link, everything
  // sensitive is wrapped in Discord spoiler tags instead. See notifier.js.
  SPOILER_FILTER_ENABLED: /^true$/i.test(process.env.SPOILER_FILTER_ENABLED || ''),
  SPOILER_KEYWORDS: (process.env.SPOILER_KEYWORDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  DISCORD_WEBHOOK_URL: process.env.DISCORD_WEBHOOK_URL || '',
  UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL || '',
  UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN || '',
  STATE_KEY: process.env.STATE_KEY || 'cyberleek:state',
  LOCAL_STATE_PATH: process.env.LOCAL_STATE_PATH || './data/state.json',
  // Optional: when all three are set, resolved direct video links are
  // downloaded and re-uploaded to this Filebase bucket (S3-compatible API)
  // before being posted to Discord. See src/uploader.js. Best-effort only —
  // mirroring is skipped silently if unset, and any failure at runtime
  // (blocked/rate-limited download, upload error) falls back to the
  // original mirror URL without blocking the alert.
  FILEBASE_ACCESS_KEY: process.env.FILEBASE_ACCESS_KEY || '',
  FILEBASE_SECRET_KEY: process.env.FILEBASE_SECRET_KEY || '',
  FILEBASE_BUCKET: process.env.FILEBASE_BUCKET || '',
  FILEBASE_ENDPOINT: process.env.FILEBASE_ENDPOINT || 'https://s3.filebase.com',
  // Per-video safety limits for Filebase mirroring (see src/uploader.js).
  // Larger/slower downloads just fall back to the original mirror link.
  FILEBASE_MAX_VIDEO_MB: Number(process.env.FILEBASE_MAX_VIDEO_MB) || 200,
  FILEBASE_DOWNLOAD_TIMEOUT_MS: Number(process.env.FILEBASE_DOWNLOAD_TIMEOUT_MS) || 45000,
  // How long the presigned mirror URL stays valid (Filebase buckets are
  // private by default; public bucket policies require a paid plan). Capped
  // at 604800 (7 days), the SigV4 maximum, in src/uploader.js.
  FILEBASE_URL_EXPIRY_SECONDS: Number(process.env.FILEBASE_URL_EXPIRY_SECONDS) || 604800,
};

Object.freeze(config);
module.exports = config;

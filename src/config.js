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
};

Object.freeze(config);
module.exports = config;

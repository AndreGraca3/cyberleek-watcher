require('dotenv').config();

const config = {
  SOLANA_RPC_URL: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  PROGRAM_ID: process.env.PROGRAM_ID || '7rAgHPLDc9NryZmNdeEzyDui6D9PHkvTxMjKhNSa7w3a',
  MEMCMP_BYTES: process.env.MEMCMP_BYTES || 'G6JNBZ2BSey',
  DATA_SIZE: Number(process.env.DATA_SIZE) || 7156,
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  DISCORD_WEBHOOK_URL: process.env.DISCORD_WEBHOOK_URL || '',
  UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL || '',
  UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN || '',
  STATE_KEY: process.env.STATE_KEY || 'cyberleek:state',
  LOCAL_STATE_PATH: process.env.LOCAL_STATE_PATH || './data/state.json',
};

Object.freeze(config);
module.exports = config;

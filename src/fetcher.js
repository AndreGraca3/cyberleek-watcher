const config = require('./config');
const logger = require('./logger');
const { decodeAccount } = require('./decoder');

async function fetchContentAccounts(rpcUrl = config.SOLANA_RPC_URL) {
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'getProgramAccounts',
    params: [
      config.PROGRAM_ID,
      {
        encoding: 'base64',
        filters: [
          { memcmp: { offset: 0, bytes: config.MEMCMP_BYTES } },
          { dataSize: config.DATA_SIZE },
        ],
      },
    ],
  };

  logger.debug({ rpcUrl, method: 'getProgramAccounts' }, 'Fetching program accounts');

  let res;
  try {
    res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    logger.error({ error: err.message, rpcUrl }, 'RPC request failed');
    throw new Error(`RPC request failed: ${err.message}`);
  }

  if (!res.ok) {
    const text = await res.text();
    logger.error({ status: res.status, body: text }, 'RPC returned non-200');
    throw new Error(`RPC error: HTTP ${res.status} — ${text}`);
  }

  const json = await res.json();

  if (json.error) {
    logger.error({ error: json.error }, 'RPC returned error object');
    throw new Error(`RPC error: ${JSON.stringify(json.error)}`);
  }

  const accounts = (json.result || [])
    .map(({ pubkey, account }) => decodeAccount(pubkey, account.data[0]))
    .filter(Boolean)
    .sort((a, b) => b.timestamp - a.timestamp);

  logger.info({ count: accounts.length }, 'Fetched and decoded accounts');
  return accounts;
}

module.exports = { fetchContentAccounts };

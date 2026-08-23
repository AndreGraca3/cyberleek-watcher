const { Redis } = require('@upstash/redis');
const fs = require('fs/promises');
const path = require('path');
const logger = require('./logger');
const config = require('./config');

function createStore(cfg = config) {
  const useUpstash = Boolean(cfg.UPSTASH_REDIS_REST_URL && cfg.UPSTASH_REDIS_REST_TOKEN);

  if (useUpstash) {
    const redis = new Redis({
      url: cfg.UPSTASH_REDIS_REST_URL,
      token: cfg.UPSTASH_REDIS_REST_TOKEN,
    });
    logger.debug({ storage: 'Upstash Redis', key: cfg.STATE_KEY }, 'Storage strategy selected');

    return {
      async getState() {
        const raw = await redis.get(cfg.STATE_KEY);
        if (!raw) return null;
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
      },
      async saveState(state) {
        await redis.set(cfg.STATE_KEY, JSON.stringify(state));
      },
    };
  }

  const statePath = path.resolve(cfg.LOCAL_STATE_PATH);
  logger.debug({ storage: 'Local File', path: statePath }, 'Storage strategy selected');

  return {
    async getState() {
      try {
        const raw = await fs.readFile(statePath, 'utf8');
        return JSON.parse(raw);
      } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
      }
    },
    async saveState(state) {
      await fs.mkdir(path.dirname(statePath), { recursive: true });
      await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
    },
  };
}

module.exports = { createStore };

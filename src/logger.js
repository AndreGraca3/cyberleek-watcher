const pino = require('pino');
const config = require('./config');

const logger = pino({
  name: 'cyberleek-watcher',
  level: config.LOG_LEVEL,
});

module.exports = logger;

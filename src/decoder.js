const logger = require('./logger');

function decodeAccount(pubkey, base64Data) {
  try {
    const buf = Buffer.from(base64Data, 'base64');

    const authority = buf.subarray(8, 40).toString('hex');
    const timestamp = Number(buf.readBigInt64LE(40));
    const titleLen = buf.readUInt32LE(48);
    const title = buf.subarray(52, 52 + titleLen).toString('utf8');

    let offset = 52 + titleLen;
    const itemCount = buf.readUInt32LE(offset);
    offset += 4;

    const items = [];
    for (let i = 0; i < itemCount; i++) {
      const labelLen = buf.readUInt32LE(offset);
      offset += 4;
      const label = buf.subarray(offset, offset + labelLen).toString('utf8');
      offset += labelLen;

      const urlLen = buf.readUInt32LE(offset);
      offset += 4;
      const url = buf.subarray(offset, offset + urlLen).toString('utf8');
      offset += urlLen;

      items.push({ label, url });
    }

    return {
      pubkey,
      timestamp,
      title,
      items,
    };
  } catch (err) {
    logger.warn({ pubkey, error: err.message }, 'Failed to decode account');
    return null;
  }
}

module.exports = { decodeAccount };

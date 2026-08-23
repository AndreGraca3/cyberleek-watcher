const logger = require('./logger');

/**
 * Decodes a CYBERLEEK poll account (fixed 2800-byte layout):
 *   8-40:  authority (unused here)
 *   40-48: timestamp (i64 LE)
 *   48-80: pollId, fixed 32-byte buffer, null-padded
 *   80-84: questionLen (u32 LE), followed by the question text
 *   then:  optionCount (u32 LE), followed by that many (u32 len + text) options
 *   then:  closesAt (i64 LE) — unix seconds when voting ends
 *   then:  optionFlags (u32 LE len + that many bytes, meaning unconfirmed — not
 *          used for notifications, just skipped over)
 *   then:  voteCounts (u32 LE len + that many u64 LE values), one per option,
 *          appears to be token-weighted vote totals rather than raw ballot counts
 */
function decodePoll(pubkey, base64Data) {
  try {
    const buf = Buffer.from(base64Data, 'base64');

    const timestamp = Number(buf.readBigInt64LE(40));
    const pollId = buf.subarray(48, 80).toString('utf8').replace(/\0+$/, '');

    let offset = 80;
    const questionLen = buf.readUInt32LE(offset);
    offset += 4;
    const question = buf.subarray(offset, offset + questionLen).toString('utf8');
    offset += questionLen;

    const optionCount = buf.readUInt32LE(offset);
    offset += 4;

    const options = [];
    for (let i = 0; i < optionCount; i++) {
      const optionLen = buf.readUInt32LE(offset);
      offset += 4;
      const option = buf.subarray(offset, offset + optionLen).toString('utf8');
      offset += optionLen;
      options.push(option);
    }

    const closesAt = Number(buf.readBigInt64LE(offset));
    offset += 8;

    const flagCount = buf.readUInt32LE(offset);
    offset += 4;
    offset += flagCount;

    const voteCountLen = buf.readUInt32LE(offset);
    offset += 4;
    const voteCounts = [];
    for (let i = 0; i < voteCountLen; i++) {
      voteCounts.push(Number(buf.readBigUInt64LE(offset)));
      offset += 8;
    }

    return {
      pubkey,
      pollId,
      timestamp,
      question,
      options,
      closesAt,
      voteCounts,
    };
  } catch (err) {
    logger.warn({ pubkey, error: err.message }, 'Failed to decode poll account');
    return null;
  }
}

module.exports = { decodePoll };

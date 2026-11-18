// Sealed game snapshots: clients hold them so a restarted server can restore a room.
// AES-256-GCM: clients can neither read (deck order, other players' tokens) nor alter them.
const crypto = require('crypto');
const zlib = require('zlib');

const keyFrom = secret => crypto.createHash('sha256').update(String(secret)).digest();

function seal(obj, secret) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const body = Buffer.concat([c.update(zlib.gzipSync(JSON.stringify(obj))), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64');
}

// Returns the object, or null if the data is malformed, tampered with, or sealed with another secret.
function open(data, secret) {
  try {
    if (typeof data !== 'string' || data.length > 2_000_000) return null;
    const buf = Buffer.from(data, 'base64');
    if (buf.length < 29) return null;
    const d = crypto.createDecipheriv('aes-256-gcm', keyFrom(secret), buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    const plain = Buffer.concat([d.update(buf.subarray(28)), d.final()]);
    return JSON.parse(zlib.gunzipSync(plain, { maxOutputLength: 10_000_000 }).toString('utf8'));
  } catch {
    return null;
  }
}

module.exports = { seal, open };

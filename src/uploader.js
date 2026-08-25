const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const config = require('./config');
const logger = require('./logger');

const DOWNLOAD_TIMEOUT_MS = Number(config.FILEBASE_DOWNLOAD_TIMEOUT_MS) || 45000;
// Safety cap so a single huge/misbehaving mirror can't blow through Render's
// bandwidth or memory (video is buffered fully in memory before upload).
// NOTE: multiple mirror items for the same leak are downloaded in parallel
// (see resolver.js/notifier.js), so peak memory use can be a multiple of
// this cap — keep it well under Render free tier's ~512MB RAM limit.
const MAX_VIDEO_BYTES = (Number(config.FILEBASE_MAX_VIDEO_MB) || 200) * 1024 * 1024;
// SigV4 presigned URLs cap out at 7 days; Filebase buckets are private by
// default (public bucket policies require a paid plan), so every mirror link
// is a presigned GET URL rather than a plain https://<bucket>.s3.filebase.com
// link, which would 403 on a private bucket.
const MAX_URL_EXPIRY_SECONDS = 7 * 24 * 60 * 60;
const EXT_RE = /\.(mp4|webm|mov|m3u8)(\?|$)/i;

let client = null;
let clientInitialized = false;

/**
 * Lazily builds the Filebase S3 client. Returns null (and only logs once)
 * when Filebase credentials aren't configured, so mirroring is a no-op by
 * default.
 */
function getClient() {
  if (clientInitialized) return client;
  clientInitialized = true;

  const configured = [
    ['FILEBASE_ACCESS_KEY', config.FILEBASE_ACCESS_KEY],
    ['FILEBASE_SECRET_KEY', config.FILEBASE_SECRET_KEY],
    ['FILEBASE_BUCKET', config.FILEBASE_BUCKET],
  ];
  const missing = configured.filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) {
    // Only warn when *some* (not all) vars are set — an intentional, fully
    // unset config (the default) should stay silent.
    if (missing.length < configured.length) {
      logger.warn({ missing }, 'Filebase partially configured, mirroring disabled until all vars are set');
    }
    return null;
  }
  client = new S3Client({
    endpoint: config.FILEBASE_ENDPOINT,
    region: 'us-east-1', // required by the SDK; ignored by Filebase
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.FILEBASE_ACCESS_KEY,
      secretAccessKey: config.FILEBASE_SECRET_KEY,
    },
  });
  return client;
}

/**
 * Downloads a resolved direct video URL and re-uploads it to the configured
 * Filebase bucket, returning a stable HTTPS URL for the stored object.
 *
 * Best-effort only: mirror hosts frequently rate-limit or block automated
 * downloads, so any failure (network error, non-2xx response, oversized
 * file, missing Filebase config) resolves to `null` instead of throwing.
 * Callers must fall back to the original mirror URL — a Filebase outage or
 * a blocked download must never delay or block a leak alert.
 */
async function mirrorVideoToFilebase(url) {
  const s3 = getClient();
  if (!s3) return null;

  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!res.ok) {
      logger.warn({ url, status: res.status }, 'Video download blocked/failed, skipping Filebase mirror');
      return null;
    }

    const declaredLength = Number(res.headers.get('content-length') || 0);
    if (declaredLength > MAX_VIDEO_BYTES) {
      logger.warn({ url, declaredLength }, 'Video exceeds size cap, skipping Filebase mirror');
      return null;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0 || buffer.length > MAX_VIDEO_BYTES) {
      logger.warn({ url, size: buffer.length }, 'Video empty or exceeds size cap, skipping Filebase mirror');
      return null;
    }

    const ext = (url.match(EXT_RE) || [null, 'mp4'])[1];
    const key = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    await s3.send(new PutObjectCommand({
      Bucket: config.FILEBASE_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: res.headers.get('content-type') || 'video/mp4',
    }));

    const expiresIn = Math.min(
      Number(config.FILEBASE_URL_EXPIRY_SECONDS) || MAX_URL_EXPIRY_SECONDS,
      MAX_URL_EXPIRY_SECONDS
    );
    return getSignedUrl(s3, new GetObjectCommand({ Bucket: config.FILEBASE_BUCKET, Key: key }), { expiresIn });
  } catch (err) {
    logger.warn({ url, error: err.message }, 'Failed to mirror video to Filebase, continuing without it');
    return null;
  }
}

/**
 * Mirrors each resolved video URL to Filebase, falling back to the original
 * URL whenever mirroring is disabled or fails for that particular video.
 */
async function mirrorVideosToFilebase(urls) {
  return Promise.all(urls.map(async url => (await mirrorVideoToFilebase(url)) || url));
}

module.exports = { mirrorVideoToFilebase, mirrorVideosToFilebase };

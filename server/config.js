import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Project root (the folder containing package.json). */
export const ROOT = path.resolve(here, '..');

/**
 * Minimal .env reader. Avoids a dependency and never overwrites a value
 * that is already present in the real environment.
 */
function loadDotEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted && value.length >= 2) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadDotEnv();

const str = (key, fallback = '') => {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
};

const num = (key, fallback) => {
  const v = Number.parseInt(process.env[key] ?? '', 10);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
};

const downloadDir = str('DOWNLOAD_DIR') || path.join(ROOT, 'downloads');

export const config = {
  root: ROOT,
  publicDir: path.join(ROOT, 'public'),
  binDir: path.join(ROOT, 'bin'),
  downloadDir,

  host: str('HOST', '127.0.0.1'),
  port: num('PORT', 8080),

  ytdlpPath: str('YTDLP_PATH'),
  ffmpegPath: str('FFMPEG_PATH'),

  spotify: {
    clientId: str('SPOTIFY_CLIENT_ID'),
    clientSecret: str('SPOTIFY_CLIENT_SECRET'),
  },

  cookiesFromBrowser: str('COOKIES_FROM_BROWSER'),
  cookiesFile: str('COOKIES_FILE'),

  /**
   * Netscape cookies.txt *contents*, pasted straight into an environment
   * variable. Hosted platforms give you env vars but no way to upload a file,
   * and Instagram and TikTok both need a session — so this is the only
   * practical way to reach them from Railway, Render or Fly.
   */
  cookiesContent: str('COOKIES_CONTENT'),

  /**
   * Optional shared password. Leave blank for a private instance on your own
   * machine; set it before exposing Stash to the internet, or strangers will
   * find it and run their downloads on your bandwidth and your bill.
   */
  accessPassword: str('ACCESS_PASSWORD'),

  /**
   * How Express derives the client IP. Behind Railway, Render, Fly or any
   * reverse proxy this must count the proxy hops, otherwise every request
   * looks like it came from the same address and rate limiting collapses.
   */
  trustProxy: (() => {
    const raw = str('TRUST_PROXY', 'loopback');
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    const hops = Number.parseInt(raw, 10);
    return Number.isFinite(hops) ? hops : raw;
  })(),

  /** Refuse new jobs once the download directory exceeds this. 0 = no cap. */
  maxDiskUsageMb: num('MAX_DISK_USAGE_MB', 8192),

  maxConcurrentJobs: Math.max(1, num('MAX_CONCURRENT_JOBS', 3)),
  maxPlaylistItems: Math.max(1, num('MAX_PLAYLIST_ITEMS', 200)),
  fileTtlMinutes: num('FILE_TTL_MINUTES', 180),
  rateLimitPerMinute: Math.max(1, num('RATE_LIMIT_PER_MINUTE', 60)),
  maxFilesizeMb: num('MAX_FILESIZE_MB', 0),

  /** Jobs older than this are dropped from the in-memory index. */
  jobRetentionMinutes: 24 * 60,
};

fs.mkdirSync(config.downloadDir, { recursive: true });

/**
 * Materialise COOKIES_CONTENT into a real file, since yt-dlp only accepts a
 * path. Written with owner-only permissions and never inside the web root.
 */
if (config.cookiesContent && !config.cookiesFile) {
  try {
    const target = path.join(ROOT, '.cookies.runtime.txt');
    // Escaped newlines survive most dashboards' single-line env editors.
    const body = config.cookiesContent.includes('\n')
      ? config.cookiesContent
      : config.cookiesContent.replace(/\\n/g, '\n');

    const header = body.startsWith('# Netscape') ? '' : '# Netscape HTTP Cookie File\n';
    fs.writeFileSync(target, header + body.trim() + '\n', { mode: 0o600 });
    config.cookiesFile = target;
  } catch (err) {
    process.stderr.write(`Could not write COOKIES_CONTENT to disk: ${err.message}\n`);
  }
}

export default config;

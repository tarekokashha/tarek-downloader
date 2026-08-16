import { spawn } from 'node:child_process';
import config from '../config.js';
import { requireYtdlp, hasFfmpeg, tools, killTree } from './binaries.js';
import log from './log.js';

/**
 * Progress is emitted through a custom template so we parse numbers, never
 * the human-readable bar. `|` is a safe delimiter because every field is a
 * number or a single status word.
 */
const PROGRESS_TAG = '@@PRG|';
const PROGRESS_TEMPLATE =
  `download:${PROGRESS_TAG}%(progress.status)s|%(progress.downloaded_bytes)s|` +
  '%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|' +
  '%(progress.eta)s|%(progress.fragment_index)s|%(progress.fragment_count)s';

const POSTPROCESS_TAG = '@@POST|';
const POSTPROCESS_TEMPLATE = `postprocess:${POSTPROCESS_TAG}%(progress.status)s|%(progress.postprocessor)s`;

/** Set STASH_DEBUG=1 to print every yt-dlp command and its full stderr. */
const DEBUG = process.env.STASH_DEBUG === '1' || process.env.STASH_DEBUG === 'true';

function debugCommand(command, args) {
  if (!DEBUG) return;
  const quoted = args.map((a) => (/[\s"]/.test(a) ? JSON.stringify(a) : a)).join(' ');
  log.info(`yt-dlp ▸ ${command} ${quoted}`);
}

function debugStderr(stderr) {
  if (!DEBUG || !stderr?.trim()) return;
  log.warn(`yt-dlp stderr ▾\n${stderr.trim()}`);
}

/** Numbers arrive as "NA" when yt-dlp does not know them yet. */
function toNumber(raw) {
  if (raw === undefined || raw === 'NA' || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Flags shared by every invocation: identity, resilience and cookie handling.
 */
export function baseArgs() {
  const args = [
    '--ignore-config',        // never pick up a stray global yt-dlp config
    '--no-colors',
    '--socket-timeout', '30',
    '--retries', '5',
    '--fragment-retries', '10',
    '--retry-sleep', 'exp=1:8',
  ];

  // Lets yt-dlp solve YouTube's JS signature challenge; without a runtime
  // some formats are unreachable. Node is already running this server.
  if (tools.ytdlp?.jsRuntime) {
    args.push('--js-runtimes', `node:${process.execPath}`);
  }

  if (config.cookiesFile) args.push('--cookies', config.cookiesFile);
  else if (config.cookiesFromBrowser) args.push('--cookies-from-browser', config.cookiesFromBrowser);

  if (tools.ffmpeg?.dir) args.push('--ffmpeg-location', tools.ffmpeg.dir);
  return args;
}

/**
 * Runs yt-dlp and collects stdout. Used for metadata, not downloads.
 * @returns {Promise<{stdout:string, stderr:string}>}
 */
export function runYtdlp(args, { timeout = 120_000, signal, platform = null } = {}) {
  const bin = requireYtdlp();
  const fullArgs = [...bin.prefixArgs, ...args];

  return new Promise((resolve, reject) => {
    const child = spawn(bin.command, fullArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (onAbort) signal?.removeEventListener('abort', onAbort);
      fn(value);
    };

    const timer = setTimeout(() => {
      killTree(child);
      finish(reject, new Error('The site took too long to respond. Try again.'));
    }, timeout);

    const onAbort = signal
      ? () => { killTree(child); finish(reject, new Error('Canceled.')); }
      : null;
    if (onAbort) signal.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });

    child.on('error', (err) => finish(reject, new Error(`Could not start yt-dlp: ${err.message}`)));
    child.on('close', (code) => {
      if (code !== 0) debugStderr(stderr);
      if (code === 0) finish(resolve, { stdout, stderr });
      else finish(reject, new Error(friendlyError(stderr, code, platform)));
    });
  });
}

/**
 * Translates yt-dlp's stderr into something a person can act on.
 * Falls back to the raw last line so nothing is silently swallowed.
 */
export function friendlyError(stderr = '', code = 1, platform = null) {
  const text = String(stderr);

  /*
   * Instagram and TikTok fail in their own distinctive ways, and the generic
   * yt-dlp wording ("Unexpected response from webpage request") tells a user
   * nothing actionable. Both are almost always fixed by supplying a session.
   */
  const COOKIE_HINT = 'Set COOKIES_FROM_BROWSER=chrome in .env (close Chrome first), or export a cookies.txt and set COOKIES_FILE.';

  if (platform === 'instagram') {
    if (/Unable to extract|marked as broken|General metadata extraction failed|Unexpected response/i.test(text)) {
      return `Instagram refused the request. It serves almost nothing to logged-out clients. ${COOKIE_HINT}`;
    }
    if (/login required|requested content is not available|Restricted Video|empty media response/i.test(text)) {
      return `Instagram needs you signed in for this post. ${COOKIE_HINT}`;
    }
  }

  if (platform === 'tiktok') {
    if (/Unexpected response from webpage request|Video not available, status code 0/i.test(text)) {
      return `TikTok blocked the request with a bot check. ${COOKIE_HINT}`;
    }
    if (/status code 102\d\d|author_settings|region/i.test(text)) {
      return 'TikTok says this post is private, region-locked or deleted.';
    }
  }

  const rules = [
    [/Private video|This video is private/i, 'That video is private. Add your cookies in .env to access it.'],
    [/Sign in to confirm your age|age-restricted|inappropriate for some users/i,
      'This is age-restricted. Add COOKIES_FROM_BROWSER in .env to download it.'],
    [/Sign in to confirm you.?re not a bot|confirm you are not a bot/i,
      'The site is asking for a sign-in check. Set COOKIES_FROM_BROWSER=chrome in .env and try again.'],
    [/login required|requested content is not available|rate-limit reached|You need to log in/i,
      'This account or post is private. Add your cookies in .env to access it.'],
    [/Video unavailable|This video is unavailable|has been removed|content isn.?t available/i,
      'That media has been removed or is not available in this region.'],
    [/Unsupported URL/i, "This site isn't supported by the downloader."],
    [/Unable to download webpage.*HTTP Error 404|HTTP Error 404/i, 'Page not found — check the link is complete.'],
    [/HTTP Error 403/i,
      'The site refused the request (403). This usually means it is throttling you after several downloads — wait a minute and retry. If it keeps happening, add your cookies in .env.'],
    [/HTTP Error 429|Too Many Requests/i, 'The site is rate-limiting this machine. Wait a few minutes and retry.'],
    [/is not a valid URL|Unable to extract/i, 'Could not read that page. The link may be incomplete or the site changed.'],
    [/ffmpeg not found|ffmpeg is not installed/i, 'ffmpeg is required for this format but was not found.'],
    [/No space left on device|not enough space/i, 'The disk is full.'],
    [/Requested format is not available/i, "That quality isn't offered for this item. Pick another option."],
    [/geo.?restricted|not available in your country/i, 'This media is blocked in your region.'],
    [/network is unreachable|Temporary failure in name resolution|getaddrinfo/i, 'No internet connection.'],
  ];

  for (const [pattern, message] of rules) {
    if (pattern.test(text)) return message;
  }

  const lastError = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('ERROR:'))
    .pop();

  if (lastError) return lastError.replace(/^ERROR:\s*/, '').slice(0, 300);

  const lastLine = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop();
  return lastLine ? lastLine.slice(0, 300) : `Download failed (exit code ${code}).`;
}

/**
 * Pulls full metadata for a link.
 *
 * `--flat-playlist` keeps collection lookups fast: we get the track list
 * without extracting every single item, which would take minutes for a
 * 200-video playlist.
 */
export async function fetchInfo(url, { playlist = false, flat = true, signal, platform = null } = {}) {
  const args = [
    ...baseArgs(),
    '--dump-single-json',
    '--no-warnings',
    '--no-progress',
    '--ignore-no-formats-error',
  ];

  if (playlist) {
    args.push('--yes-playlist', '--playlist-end', String(config.maxPlaylistItems));
    // Carousels are small and we need each item's real formats, so they are
    // extracted fully. Large playlists stay flat or resolving takes minutes.
    if (flat) args.push('--flat-playlist');
  } else {
    args.push('--no-playlist');
  }

  args.push('--', url);

  const { stdout } = await runYtdlp(args, { timeout: playlist ? 180_000 : 90_000, signal, platform });
  const text = stdout.trim();
  if (!text) throw new Error('The site returned nothing for that link.');

  try {
    return JSON.parse(text);
  } catch {
    // Defensive: if anything ever leaks onto stdout, take the JSON object only.
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error('Could not read the response from that site.');
  }
}

/**
 * Searches YouTube and returns lightweight entries. Used to match tracks that
 * come from a DRM-locked catalogue (Spotify, Apple Music).
 */
export async function searchYouTube(query, limit = 6, { signal } = {}) {
  const args = [
    ...baseArgs(),
    '--dump-single-json',
    '--flat-playlist',
    '--no-warnings',
    '--no-progress',
    '--', `ytsearch${limit}:${query}`,
  ];

  try {
    const { stdout } = await runYtdlp(args, { timeout: 60_000, signal });
    const data = JSON.parse(stdout.trim() || '{}');
    return Array.isArray(data.entries) ? data.entries.filter(Boolean) : [];
  } catch (err) {
    log.warn(`YouTube search failed for "${query}": ${err.message}`);
    return [];
  }
}

/**
 * Runs an actual download, streaming structured progress to `onProgress`.
 *
 * Output always lands in a dedicated, empty directory so the finished files
 * can be discovered by listing it — far more reliable than parsing filenames
 * out of stdout across merges, conversions and playlists.
 *
 * `url` is passed separately, not baked into `args`: everything after the
 * `--` separator is a positional argument, so the URL must stay last.
 *
 * @returns {Promise<{stdout:string, stderr:string}>}
 */
export function download(args, { url, platform = null, onProgress, onLine, signal, cwd, timeout = 0 } = {}) {
  const bin = requireYtdlp();
  if (!url) throw new Error('No URL was supplied to the downloader.');

  const fullArgs = [
    ...bin.prefixArgs,
    ...args,
    '--newline',
    '--progress',
    '--progress-template', PROGRESS_TEMPLATE,
    '--progress-template', POSTPROCESS_TEMPLATE,
    '--', url,
  ];

  debugCommand(bin.command, fullArgs);

  return new Promise((resolve, reject) => {
    const child = spawn(bin.command, fullArgs, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stderr = '';
    let stdoutTail = '';
    let settled = false;
    let stdoutBuffer = '';
    let stderrBuffer = '';

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (onAbort) signal?.removeEventListener('abort', onAbort);
      fn(value);
    };

    const timer = timeout > 0
      ? setTimeout(() => {
          killTree(child);
          finish(reject, new Error('Download timed out.'));
        }, timeout)
      : null;

    const onAbort = signal
      ? () => { killTree(child); finish(reject, Object.assign(new Error('Canceled.'), { canceled: true })); }
      : null;
    if (onAbort) signal.addEventListener('abort', onAbort, { once: true });

    const handleLine = (line) => {
      const text = line.trim();
      if (!text) return;

      if (text.startsWith(PROGRESS_TAG)) {
        const [status, downloaded, total, estimate, speed, eta, fragIndex, fragCount] =
          text.slice(PROGRESS_TAG.length).split('|');

        const totalBytes = toNumber(total) ?? toNumber(estimate);
        const downloadedBytes = toNumber(downloaded);
        const fi = toNumber(fragIndex);
        const fc = toNumber(fragCount);

        let percent = null;
        if (totalBytes && downloadedBytes !== null) {
          percent = Math.min(100, (downloadedBytes / totalBytes) * 100);
        } else if (fi !== null && fc) {
          percent = Math.min(100, (fi / fc) * 100);
        }

        onProgress?.({
          type: 'download',
          status,
          percent,
          downloaded: downloadedBytes,
          total: totalBytes,
          speed: toNumber(speed),
          eta: toNumber(eta),
        });
        return;
      }

      if (text.startsWith(POSTPROCESS_TAG)) {
        const [status, processor] = text.slice(POSTPROCESS_TAG.length).split('|');
        if (status === 'started' || status === 'processing') {
          onProgress?.({ type: 'postprocess', processor, status });
        }
        return;
      }

      onLine?.(text);
    };

    const pump = (chunk, which) => {
      const buffer = which === 'out' ? stdoutBuffer + chunk : stderrBuffer + chunk;
      const lines = buffer.split(/\r?\n/);
      const remainder = lines.pop() ?? '';
      if (which === 'out') stdoutBuffer = remainder;
      else stderrBuffer = remainder;
      for (const line of lines) handleLine(line);
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk) => {
      pump(chunk, 'out');
      stdoutTail = (stdoutTail + chunk).slice(-8000);
    });

    child.stderr.on('data', (chunk) => {
      pump(chunk, 'err');
      stderr += chunk;
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });

    child.on('error', (err) => finish(reject, new Error(`Could not start yt-dlp: ${err.message}`)));

    child.on('close', (code) => {
      if (stdoutBuffer) handleLine(stdoutBuffer);
      if (stderrBuffer) handleLine(stderrBuffer);
      if (code !== 0) debugStderr(stderr);
      if (code === 0) finish(resolve, { stdout: stdoutTail, stderr });
      else finish(reject, new Error(friendlyError(stderr, code, platform)));
    });
  });
}

/** Lines worth surfacing as a human-readable phase in the UI. */
export function readPhase(line) {
  if (/^\[download\] Downloading item (\d+) of (\d+)/.test(line)) {
    const [, index, count] = /^\[download\] Downloading item (\d+) of (\d+)/.exec(line);
    return { item: Number(index), itemCount: Number(count) };
  }

  // A merged download fetches the video stream, then the audio stream; each
  // announces its own destination and restarts its percentage at zero.
  const destination = /^\[download\] Destination:\s*(.+)$/.exec(line);
  if (destination) {
    const name = destination[1];
    const audio = /\.(m4a|mp3|opus|ogg|oga|aac|wav|flac|webm\.audio)$/i.test(name)
      || /\.f(139|140|141|171|249|250|251|256|258|327|338)\b/i.test(name);
    return { stream: true, phase: audio ? 'Downloading audio' : 'Downloading video' };
  }
  if (/^\[Merger\]/.test(line)) return { phase: 'Merging video and audio' };
  if (/^\[ExtractAudio\]/.test(line)) return { phase: 'Extracting audio' };
  if (/^\[EmbedThumbnail\]/.test(line)) return { phase: 'Embedding cover art' };
  if (/^\[Metadata\]/.test(line)) return { phase: 'Writing tags' };
  if (/^\[VideoConvertor\]|^\[VideoRemuxer\]/.test(line)) return { phase: 'Converting' };
  if (/^\[SubtitlesConvertor\]|^\[EmbedSubtitle\]/.test(line)) return { phase: 'Adding subtitles' };
  if (/^\[FixupM3u8\]|^\[Fixup/.test(line)) return { phase: 'Finalising' };
  if (/^\[info\] Downloading subtitles/.test(line)) return { phase: 'Fetching subtitles' };
  return null;
}

export { hasFfmpeg };

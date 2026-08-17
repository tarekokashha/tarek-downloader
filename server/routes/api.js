import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import config from '../config.js';
import jobs, { TERMINAL_STATES } from '../lib/jobs.js';
import queue from '../lib/queue.js';
import log from '../lib/log.js';
import { analyseUrl, FEATURED_PLATFORMS, DETECTION_TABLE } from '../lib/urls.js';
import { resolveLink } from '../lib/resolve.js';
import { runJob, hydrateJobTitle, parseTimecode } from '../lib/pipeline.js';
import { binaryStatus, hasFfmpeg } from '../lib/binaries.js';
import { CONTAINERS, AUDIO_PRESETS } from '../lib/formats.js';
import { isSafeChildPath, diskUsageBytes } from '../lib/media.js';
import {
  isProtected, hasValidSession, verifyPassword,
  setSessionCookie, clearSessionCookie, destroySession,
} from '../lib/auth.js';
import { normaliseOrigin } from '../lib/cors.js';
import {
  status as cookieStatus, install as installCookies,
  remove as removeCookies, browserExtractionViable,
} from '../lib/cookies.js';

export const router = express.Router();

/* ───────────────────────────── Access gate ─────────────────────────── */

/** Endpoints reachable without a session, so the login screen can work. */
const OPEN_PATHS = new Set(['/health', '/unlock', '/session']);

router.use((req, res, next) => {
  if (!isProtected() || OPEN_PATHS.has(req.path)) {
    next();
    return;
  }
  if (hasValidSession(req)) {
    next();
    return;
  }
  res.status(401).json({ error: 'This instance is password protected.', locked: true });
});

router.get('/session', (req, res) => {
  res.json({ protected: isProtected(), authenticated: hasValidSession(req) });
});

router.post('/unlock', (req, res) => {
  if (!isProtected()) {
    res.json({ ok: true, protected: false });
    return;
  }
  const result = verifyPassword(req.ip ?? 'unknown', req.body?.password);
  if (!result.ok) {
    res.status(401).json({ error: result.error });
    return;
  }
  const secure = req.secure || req.get('x-forwarded-proto') === 'https';
  setSessionCookie(res, result.token, secure);

  /*
   * The cookie only reaches us again when the page shares our origin. A page
   * hosted elsewhere — the static interface on Vercel — cannot send it: it
   * omits credentials, and browsers block third-party cookies anyway. Hand
   * that caller the token in the body so it can present `x-stash-key` instead.
   * Same-origin callers get nothing back, keeping the token HttpOnly.
   */
  const origin = req.get('origin');
  const proto = req.get('x-forwarded-proto') || req.protocol;
  const crossOrigin =
    Boolean(origin) && normaliseOrigin(origin) !== normaliseOrigin(`${proto}://${req.get('host')}`);

  res.json(crossOrigin ? { ok: true, token: result.token } : { ok: true });
});

router.post('/lock', (req, res) => {
  destroySession(req);
  clearSessionCookie(res);
  res.json({ ok: true });
});

/* ─────────────────────────── Rate limiting ─────────────────────────── */

const buckets = new Map();

function rateLimit(req, res, next) {
  const key = req.ip ?? 'unknown';
  const now = Date.now();
  const window = 60_000;

  let bucket = buckets.get(key);
  if (!bucket || now - bucket.start >= window) {
    bucket = { start: now, count: 0 };
    buckets.set(key, bucket);
  }

  bucket.count += 1;
  if (bucket.count > config.rateLimitPerMinute) {
    res.setHeader('Retry-After', Math.ceil((bucket.start + window - now) / 1000));
    res.status(429).json({ error: 'Too many requests. Slow down for a moment.' });
    return;
  }
  next();
}

// Keep the bucket map from growing without bound.
setInterval(() => {
  const cutoff = Date.now() - 120_000;
  for (const [key, bucket] of buckets) if (bucket.start < cutoff) buckets.delete(key);
}, 60_000).unref();

/* ───────────────────────────── Validation ──────────────────────────── */

class BadRequest extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const MODES = new Set(['video', 'audio', 'thumbnail']);
const CONTAINER_IDS = new Set(CONTAINERS.map((c) => c.id));
const AUDIO_IDS = new Set(AUDIO_PRESETS.map((p) => p.id));

/** Format selectors reach yt-dlp's --format flag; keep them to its own syntax. */
const SELECTOR_PATTERN = /^[A-Za-z0-9_\-+/[\]<>=*^$!.,:?|() ]{1,400}$/;
const LANG_PATTERN = /^[A-Za-z0-9,.\-*]{1,80}$/;

const asBool = (value, fallback = false) => {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  return value === 'true' || value === '1' || value === 1;
};

function validatePlan(body) {
  if (!body || typeof body !== 'object') throw new BadRequest('Malformed request.');

  const analysis = analyseUrl(body.url);

  const mode = String(body.mode ?? 'video');
  if (!MODES.has(mode)) throw new BadRequest('Unknown download mode.');
  if (analysis.isCatalog && mode !== 'audio') {
    throw new BadRequest(`${analysis.platformName} links can only be downloaded as audio.`);
  }

  const container = String(body.container ?? 'mp4');
  if (!CONTAINER_IDS.has(container)) throw new BadRequest('Unknown container.');

  let quality = String(body.quality ?? '');
  if (mode === 'audio') {
    if (!AUDIO_IDS.has(quality)) quality = 'mp3-320';
  }

  let selector = null;
  if (mode === 'video' && body.selector) {
    selector = String(body.selector);
    if (!SELECTOR_PATTERN.test(selector)) throw new BadRequest('Invalid quality selection.');
  }

  let height = null;
  if (mode === 'video') {
    const parsed = Number.parseInt(String(quality).replace(/^v/, ''), 10);
    if (Number.isFinite(parsed) && parsed >= 100 && parsed <= 8000) height = parsed;
  }

  let items = null;
  if (Array.isArray(body.items) && body.items.length) {
    items = [...new Set(body.items.map((n) => Number.parseInt(n, 10)))]
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= config.maxPlaylistItems)
      .sort((a, b) => a - b)
      .slice(0, config.maxPlaylistItems);
    if (!items.length) items = null;
  }

  let subtitleLang = null;
  if (body.subtitleLang) {
    const value = String(body.subtitleLang);
    if (!LANG_PATTERN.test(value)) throw new BadRequest('Invalid subtitle language.');
    subtitleLang = value;
  }

  let trim = null;
  if (body.trim && (body.trim.start || body.trim.end)) {
    const start = parseTimecode(body.trim.start);
    const end = parseTimecode(body.trim.end);
    if (start === null && end === null) throw new BadRequest('Could not read the clip times.');
    if (start !== null && end !== null && end <= start) {
      throw new BadRequest('The clip end must come after the start.');
    }
    if (!hasFfmpeg()) throw new BadRequest('Clipping needs ffmpeg, which was not found.');
    trim = { start: start ?? 0, end: end ?? null };
  }

  // Carousels must be fetched with playlist extraction on, otherwise yt-dlp
  // returns only the first photo or clip of the post.
  const playlist = asBool(body.playlist, analysis.isCollection)
    || Boolean(items?.length)
    || analysis.carousel;

  return {
    analysis,
    url: analysis.url,
    mode,
    container,
    quality,
    selector,
    height,
    items,
    playlist,
    subtitleLang,
    embedSubtitles: asBool(body.embedSubtitles, false),
    embedThumbnail: asBool(body.embedThumbnail, mode === 'audio'),
    embedMetadata: asBool(body.embedMetadata, true),
    embedChapters: asBool(body.embedChapters, false),
    writeThumbnailFile: asBool(body.writeThumbnailFile, false),
    sponsorBlock: asBool(body.sponsorBlock, false),
    trim,
  };
}

/* ─────────────────────────────── Routes ────────────────────────────── */

router.get('/health', (req, res) => {
  res.json({
    ok: true,
    binaries: binaryStatus(),
    queue: queue.stats,
    locked: isProtected() && !hasValidSession(req),
    spotifyApi: Boolean(config.spotify.clientId && config.spotify.clientSecret),
    cookies: Boolean(config.cookiesFile || config.cookiesFromBrowser),
    limits: {
      maxPlaylistItems: config.maxPlaylistItems,
      fileTtlMinutes: config.fileTtlMinutes,
      maxFilesizeMb: config.maxFilesizeMb,
    },
  });
});

/* ─────────────────────────────── Cookies ───────────────────────────── */

router.get('/cookies', (req, res) => {
  res.json({ ...cookieStatus(), extraction: browserExtractionViable() });
});

router.post('/cookies', express.text({ type: '*/*', limit: '4mb' }), async (req, res, next) => {
  try {
    // Accept a raw paste, an uploaded file body, or {content: "..."} JSON.
    let body = typeof req.body === 'string' ? req.body : '';
    if (!body && req.body && typeof req.body === 'object') body = String(req.body.content ?? '');
    if (body.trim().startsWith('{')) {
      try { body = String(JSON.parse(body).content ?? body); } catch { /* keep raw */ }
    }

    const summary = await installCookies(body);
    // Deliberately does not echo the cookies back.
    res.json({ ok: true, ...cookieStatus(), installedCount: summary.total });
  } catch (err) {
    next(Object.assign(err, { status: 400 }));
  }
});

router.delete('/cookies', async (req, res) => {
  await removeCookies();
  res.json({ ok: true, ...cookieStatus() });
});

router.get('/platforms', (req, res) => {
  res.json({
    featured: FEATURED_PLATFORMS,
    detect: DETECTION_TABLE,
    containers: CONTAINERS,
    audioPresets: AUDIO_PRESETS.map(({ id, label, detail, recommended }) => ({ id, label, detail, recommended })),
    ffmpeg: hasFfmpeg(),
  });
});

router.post('/resolve', rateLimit, async (req, res, next) => {
  try {
    const analysis = analyseUrl(req.body?.url);
    const forcePlaylist = asBool(req.body?.playlist, false);
    const container = CONTAINER_IDS.has(String(req.body?.container)) ? String(req.body.container) : 'mp4';

    const result = await resolveLink(analysis, { forcePlaylist, container });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/jobs', rateLimit, async (req, res, next) => {
  try {
    const plan = validatePlan(req.body);

    if (queue.stats.waiting > 40) {
      throw Object.assign(new Error('The queue is full. Wait for a download to finish.'), { status: 503 });
    }

    if (config.maxDiskUsageMb > 0) {
      const used = await diskUsageBytes(config.downloadDir);
      if (used > config.maxDiskUsageMb * 1024 * 1024) {
        throw Object.assign(
          new Error('The server is out of download space. Finished files are cleared automatically — try again shortly.'),
          { status: 507 },
        );
      }
    }

    const job = jobs.create({
      url: plan.url,
      platform: plan.analysis.platform,
      platformName: plan.analysis.platformName,
      accent: plan.analysis.accent,
      mode: plan.mode,
      request: {
        quality: plan.quality,
        container: plan.container,
        mode: plan.mode,
        playlist: plan.playlist,
      },
      title: typeof req.body?.title === 'string' && req.body.title.trim()
        ? req.body.title.trim().slice(0, 220)
        : 'Preparing…',
      subtitle: typeof req.body?.subtitle === 'string' ? req.body.subtitle.trim().slice(0, 120) : '',
      thumbnail: typeof req.body?.thumbnail === 'string' && /^https?:\/\//.test(req.body.thumbnail)
        ? req.body.thumbnail.slice(0, 1000)
        : null,
      duration: Number.isFinite(req.body?.duration) ? Math.round(req.body.duration) : null,
      isCollection: plan.playlist,
      itemCount: plan.items?.length ?? (Number.isFinite(req.body?.itemCount) ? req.body.itemCount : null),
    });

    if (job.title === 'Preparing…') hydrateJobTitle(job, plan).catch(() => {});

    queue.push(job, () => runJob(job, plan));
    res.status(202).json(job.toJSON());
  } catch (err) {
    next(err);
  }
});

router.get('/jobs', (req, res) => {
  res.json({ jobs: jobs.list(40), queue: queue.stats });
});

router.get('/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'That download is no longer available.' });
    return;
  }
  res.json(job.toJSON());
});

/** Server-sent events: one stream per job, closed as soon as it finishes. */
router.get('/jobs/:id/events', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Unknown download.' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const send = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    if (TERMINAL_STATES.has(payload.status)) {
      cleanup();
      res.end();
    }
  };

  const channel = `job:${job.id}`;
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 20_000);

  function cleanup() {
    clearInterval(heartbeat);
    jobs.off(channel, send);
  }

  jobs.on(channel, send);
  req.on('close', cleanup);

  send(job.toJSON());
});

/** A single stream of every job's state, powering the activity rail. */
router.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 20_000);

  jobs.on('any', send);
  req.on('close', () => {
    clearInterval(heartbeat);
    jobs.off('any', send);
  });

  res.write(`data: ${JSON.stringify({ hello: true })}\n\n`);
});

router.post('/jobs/:id/cancel', (req, res) => {
  const ok = jobs.cancel(req.params.id);
  if (!ok) {
    res.status(409).json({ error: 'That download has already finished.' });
    return;
  }
  res.json({ ok: true });
});

router.delete('/jobs/:id', async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Unknown download.' });
    return;
  }
  if (!TERMINAL_STATES.has(job.status)) job.controller.abort();
  await jobs.removeFiles(job);
  jobs.jobs.delete(job.id);
  res.json({ ok: true });
});

/* ──────────────────────────── File delivery ────────────────────────── */

function sendFile(res, job, filePath, downloadName, next) {
  if (!isSafeChildPath(job.dir, filePath)) {
    res.status(400).json({ error: 'Invalid file path.' });
    return;
  }
  if (!fs.existsSync(filePath)) {
    res.status(410).json({ error: 'That file has expired and been removed from the server.' });
    return;
  }

  res.download(filePath, downloadName, (err) => {
    // ECONNABORTED simply means the browser stopped the transfer.
    if (err && err.code !== 'ECONNABORTED' && !res.headersSent) next(err);
    else if (err && err.code !== 'ECONNABORTED') log.warn(`Send failed: ${err.message}`);
  });
}

router.get('/jobs/:id/files/:index', (req, res, next) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Unknown download.' });
    return;
  }

  const index = Number.parseInt(req.params.index, 10);
  const file = job.files[index];
  if (!file) {
    res.status(404).json({ error: 'That file is not part of this download.' });
    return;
  }

  sendFile(res, job, path.join(job.dir, file.name), file.name, next);
});

router.get('/jobs/:id/archive', (req, res, next) => {
  const job = jobs.get(req.params.id);
  if (!job?.archive) {
    res.status(404).json({ error: 'No archive for this download.' });
    return;
  }
  sendFile(res, job, job.archive.path, job.archive.name, next);
});

/* ───────────────────────── Error normalisation ─────────────────────── */

router.use((err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const status = err.status ?? 400;
  if (status >= 500) log.error(err);
  res.status(status).json({ error: err.message || 'Something went wrong.' });
});

export default router;

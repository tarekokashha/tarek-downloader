import fsp from 'node:fs/promises';
import path from 'node:path';
import config from '../config.js';
import jobs from './jobs.js';
import log from './log.js';
import { baseArgs, download, readPhase, fetchInfo } from './ytdlp.js';
import { audioPreset, genericVideoSelector, bestThumbnail, AUDIO_SOURCE_SELECTOR } from './formats.js';
import { resolveCatalog, matchTrack } from './catalog.js';
import { hasFfmpeg } from './binaries.js';
import {
  collectOutputs, createArchive, safeFilename, tagAudio, fetchCover, formatBytes,
} from './media.js';

/** Containers that can carry embedded cover art. */
const THUMBNAIL_CAPABLE = new Set(['mp4', 'mkv', 'mp3', 'm4a', 'flac', 'opus', 'ogg', 'mov']);

/**
 * What each mode must actually produce.
 *
 * `--embed-thumbnail` writes a temporary image before it embeds it, so a
 * download that dies mid-flight can leave a stray .webp behind. Without this
 * check a failed job would be reported as finished with a 130 KB "result".
 */
const EXPECTED_EXTENSIONS = {
  audio: new Set(['mp3', 'm4a', 'opus', 'ogg', 'oga', 'wav', 'flac', 'aac', 'wma', 'webm']),
  video: new Set(['mp4', 'mkv', 'webm', 'mov', 'avi', 'flv', 'm4v', '3gp', 'ts']),
  thumbnail: new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']),
};

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);

/**
 * True when at least one file matches what the user actually asked for.
 *
 * Carousels are the exception: an Instagram post or TikTok photo slideshow can
 * legitimately be all images, so a "video" request there is satisfied by a JPG.
 */
function producedRealMedia(files, mode, { carousel = false } = {}) {
  const wanted = EXPECTED_EXTENSIONS[mode] ?? EXPECTED_EXTENSIONS.video;
  if (files.some((file) => wanted.has(file.ext))) return true;
  if (carousel && mode !== 'audio') {
    return files.some((file) => IMAGE_EXTENSIONS.has(file.ext));
  }
  return false;
}

/** yt-dlp treats `%` as a template marker, so literal names must escape it. */
const escapeTemplate = (text) => String(text).replace(/%/g, '%%');

/** Converts `1:23` / `83` / `00:01:23` into seconds. Returns null when unusable. */
export function parseTimecode(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
  const parts = text.split(':').map((p) => Number(p));
  if (!parts.length || parts.some((p) => !Number.isFinite(p) || p < 0)) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

/**
 * Builds the full yt-dlp argument list for a media download.
 * Everything is passed as separate array entries — no shell, no interpolation.
 */
function buildDownloadArgs(job, plan) {
  const args = [...baseArgs()];
  const isPlaylist = plan.playlist;

  args.push('--no-mtime', '--no-overwrites', '--no-part');
  args.push('--concurrent-fragments', '4');

  args.push('--paths', job.dir);
  args.push(
    '--output',
    isPlaylist
      ? '%(playlist_index|)03d %(title).110B [%(id)s].%(ext)s'
      : '%(title).140B [%(id)s].%(ext)s',
  );

  if (isPlaylist) {
    args.push('--yes-playlist');
    args.push('--playlist-end', String(config.maxPlaylistItems));
    if (plan.items?.length) args.push('--playlist-items', plan.items.join(','));
    args.push('--ignore-errors'); // one dead video must not kill a 200-item run
  } else {
    args.push('--no-playlist');
  }

  if (config.maxFilesizeMb > 0) args.push('--max-filesize', `${config.maxFilesizeMb}M`);

  /* ── Thumbnail only ───────────────────────────────────────────────── */
  if (plan.mode === 'thumbnail') {
    args.push('--skip-download', '--write-thumbnail');
    if (hasFfmpeg()) args.push('--convert-thumbnails', 'jpg');
    return args;
  }

  /* ── Audio ────────────────────────────────────────────────────────── */
  if (plan.mode === 'audio') {
    const preset = audioPreset(plan.quality);
    args.push('--format', AUDIO_SOURCE_SELECTOR);
    args.push('--extract-audio', '--audio-format', preset.format);
    if (preset.quality && preset.quality !== '0') args.push('--audio-quality', preset.quality);

    if (plan.embedThumbnail && hasFfmpeg() && THUMBNAIL_CAPABLE.has(preset.format)) {
      args.push('--embed-thumbnail');
    }
    if (plan.embedMetadata) args.push('--embed-metadata');
    if (plan.writeThumbnailFile) args.push('--write-thumbnail');
  } else {
    /* ── Video ──────────────────────────────────────────────────────── */
    const selector = plan.selector || genericVideoSelector(plan.height, plan.container);
    args.push('--format', selector);
    args.push('--merge-output-format', plan.container);

    if (plan.container !== 'webm') args.push('--remux-video', plan.container);

    if (plan.embedThumbnail && hasFfmpeg() && THUMBNAIL_CAPABLE.has(plan.container)) {
      args.push('--embed-thumbnail');
    }
    if (plan.embedMetadata) args.push('--embed-metadata');
    if (plan.embedChapters && hasFfmpeg()) args.push('--embed-chapters');
    if (plan.writeThumbnailFile) args.push('--write-thumbnail');

    if (plan.subtitleLang) {
      args.push('--write-subs', '--write-auto-subs');
      args.push('--sub-langs', plan.subtitleLang);
      if (hasFfmpeg()) args.push('--convert-subs', 'srt');
      if (plan.embedSubtitles && hasFfmpeg() && plan.container !== 'webm') args.push('--embed-subs');
    }
  }

  /* ── Shared extras ────────────────────────────────────────────────── */
  if (plan.sponsorBlock && hasFfmpeg()) {
    args.push('--sponsorblock-remove', 'sponsor,selfpromo,interaction,intro,outro,preview,music_offtopic');
  }

  if (plan.trim && hasFfmpeg()) {
    const start = plan.trim.start ?? 0;
    const end = plan.trim.end ?? 'inf';
    args.push('--download-sections', `*${start}-${end}`);
    args.push('--force-keyframes-at-cuts');
  }

  return args;
}

/**
 * Wires yt-dlp progress + log lines into the job's live state.
 *
 * Two things make the raw numbers unusable on their own:
 *  - a merged download reports 0-100% once per stream (video, then audio), and
 *  - a playlist reports 0-100% once per item.
 * Both are folded into a single figure that only ever moves forward.
 *
 * @param {object} opts.expectedStreams 2 when video and audio arrive separately
 */
function attachProgress(job, { itemCount, expectedStreams = 1 }) {
  let currentItem = 1;
  let total = itemCount ?? 1;
  let streamIndex = -1;
  let streams = Math.max(1, expectedStreams);
  let highWater = 0;

  const overall = (streamPercent) => {
    // Guard against the selector falling back to a single progressive stream.
    const denominator = Math.max(streams, streamIndex + 1);
    const withinItem = (Math.max(0, streamIndex) + (streamPercent ?? 0) / 100) / denominator;
    const done = Math.max(0, currentItem - 1);
    const value = total > 1
      ? ((done + withinItem) / total) * 100
      : withinItem * 100;

    highWater = Math.max(highWater, Math.min(100, value));
    return highWater;
  };

  return {
    onProgress(update) {
      if (update.type === 'postprocess') {
        jobs.update(job, { status: 'processing', phase: 'Converting' });
        return;
      }
      if (streamIndex < 0) streamIndex = 0;

      if (update.status === 'finished') {
        jobs.update(job, { progress: { percent: overall(100), speed: null, eta: null } });
        return;
      }

      jobs.update(job, {
        status: 'downloading',
        progress: {
          percent: overall(update.percent),
          downloaded: update.downloaded,
          total: update.total,
          speed: update.speed,
          eta: update.eta,
        },
      });
    },

    onLine(line) {
      const parsed = readPhase(line);
      if (!parsed) return;

      if (parsed.item) {
        currentItem = parsed.item;
        total = parsed.itemCount ?? total;
        streamIndex = -1;
        streams = Math.max(1, expectedStreams);
        jobs.update(job, {
          phase: `Item ${parsed.item} of ${total}`,
          progress: { item: parsed.item, itemCount: total },
        });
        return;
      }

      if (parsed.stream) {
        streamIndex += 1;
        if (streamIndex + 1 > streams) streams = streamIndex + 1;
        jobs.update(job, { status: 'downloading', phase: parsed.phase });
        return;
      }

      if (parsed.phase) jobs.update(job, { phase: parsed.phase });
    },
  };
}

/** Zips a multi-file result so the browser gets one click instead of twenty. */
async function packageIfNeeded(job, files) {
  if (files.length <= 1) return null;

  jobs.update(job, { status: 'packaging', phase: 'Packing archive' });
  const base = safeFilename(job.title, 'stash-download');
  const archiveName = `${base}.zip`;
  const archivePath = path.join(job.dir, archiveName);

  try {
    const size = await createArchive(job.dir, files, archivePath);
    return { name: archiveName, size, path: archivePath };
  } catch (err) {
    log.warn(`Archive failed for job ${job.id}: ${err.message}`);
    jobs.addWarning(job, 'Could not build the zip — download the files individually.');
    return null;
  }
}

/* ══════════════════════════ Direct downloads ══════════════════════════ */

export async function runMediaJob(job, plan) {
  await fsp.mkdir(job.dir, { recursive: true });

  jobs.update(job, {
    status: 'downloading',
    phase: plan.playlist ? 'Reading the playlist' : 'Connecting',
  });

  const args = buildDownloadArgs(job, plan);
  const carousel = Boolean(plan.analysis.carousel);

  // A `+` in the format selector means video and audio arrive as two separate
  // streams, so the download reports its percentage twice.
  const selector = plan.selector || genericVideoSelector(plan.height, plan.container);
  const expectedStreams = plan.mode === 'video' && selector.includes('+') ? 2 : 1;

  const handlers = attachProgress(job, {
    itemCount: plan.items?.length ?? job.progress.itemCount,
    expectedStreams,
  });

  try {
    await download(args, {
      ...handlers,
      url: job.url,
      platform: plan.analysis.platform,
      signal: job.signal,
      cwd: job.dir,
    });
  } catch (err) {
    if (job.signal.aborted) throw Object.assign(new Error('Canceled.'), { canceled: true });

    // With --ignore-errors a playlist can exit non-zero while still having
    // produced files. Keep what genuinely landed — but a leftover thumbnail
    // from a half-finished job is not a result.
    const salvaged = await collectOutputs(job.dir);
    if (!producedRealMedia(salvaged, plan.mode, { carousel })) throw err;

    jobs.addWarning(job, plan.playlist
      ? `Some items failed: ${err.message}`
      : err.message);
  }

  if (job.signal.aborted) throw Object.assign(new Error('Canceled.'), { canceled: true });

  let files = await collectOutputs(job.dir);

  // Drop the temporary artwork unless the user asked to keep it — but never
  // for a carousel, where the photos are the point of the download.
  if (plan.mode !== 'thumbnail' && !plan.writeThumbnailFile && !carousel) {
    const withoutArt = files.filter((file) => !IMAGE_EXTENSIONS.has(file.ext));
    if (withoutArt.length) files = withoutArt;
  }

  if (!producedRealMedia(files, plan.mode, { carousel })) {
    throw new Error(
      plan.mode === 'thumbnail'
        ? 'No thumbnail was published for that item.'
        : 'The download did not produce a usable file. Try a different quality, or wait a minute and retry.',
    );
  }

  const archive = await packageIfNeeded(job, files);
  const bytes = files.reduce((sum, f) => sum + f.size, 0);

  jobs.update(job, {
    status: 'done',
    phase: 'Ready',
    files,
    archive,
    progress: { percent: 100, speed: null, eta: null },
  });

  log.ok(`${job.platformName} · ${files.length} file(s) · ${formatBytes(bytes)} · ${job.title}`);
}

/* ═════════════════════ Catalogue (Spotify / Apple) ═════════════════════ */

async function downloadOneTrack(job, track, { index, total, preset, coverPath, albumName }) {
  const artist = (track.artists ?? []).join(', ') || 'Unknown Artist';
  const displayName = `${artist} - ${track.title}`;

  jobs.update(job, {
    status: 'downloading',
    phase: `Finding “${track.title}”`,
    progress: { item: index, itemCount: total },
  });

  const match = await matchTrack(track, { signal: job.signal });
  if (!match) {
    return { ok: false, reason: `No confident match found for “${displayName}”.` };
  }

  if (match.score < 55) {
    jobs.addWarning(job, `Low-confidence match for “${track.title}” — check the file.`);
  }

  jobs.update(job, { phase: `${index}/${total} · ${track.title}` });

  const numbered = total > 1 ? `${String(index).padStart(3, '0')} ` : '';
  const baseName = safeFilename(`${numbered}${displayName}`, `track-${index}`);

  const args = [
    ...baseArgs(),
    '--no-playlist', '--no-mtime', '--no-part', '--no-overwrites',
    '--concurrent-fragments', '4',
    '--paths', job.dir,
    '--output', `${escapeTemplate(baseName)}.%(ext)s`,
    '--format', AUDIO_SOURCE_SELECTOR,
    '--extract-audio', '--audio-format', preset.format,
  ];
  if (preset.quality && preset.quality !== '0') args.push('--audio-quality', preset.quality);
  if (config.maxFilesizeMb > 0) args.push('--max-filesize', `${config.maxFilesizeMb}M`);

  const perTrack = (percent) => {
    const done = index - 1;
    return Math.min(100, ((done + (percent ?? 0) / 100) / total) * 100);
  };

  try {
    await download(args, {
      url: match.url,
      signal: job.signal,
      cwd: job.dir,
      onProgress(update) {
        if (update.type === 'postprocess') {
          jobs.update(job, { status: 'processing', phase: `Converting · ${track.title}` });
          return;
        }
        jobs.update(job, {
          status: 'downloading',
          progress: {
            percent: perTrack(update.percent),
            downloaded: update.downloaded,
            total: update.total,
            speed: update.speed,
            eta: update.eta,
          },
        });
      },
    });
  } catch (err) {
    if (job.signal.aborted) throw Object.assign(new Error('Canceled.'), { canceled: true });
    return { ok: false, reason: `“${displayName}” failed: ${err.message}` };
  }

  const filePath = path.join(job.dir, `${baseName}.${preset.format}`);
  try {
    await fsp.access(filePath);
  } catch {
    return { ok: false, reason: `“${displayName}” produced no file.` };
  }

  if (hasFfmpeg()) {
    jobs.update(job, { status: 'processing', phase: `Tagging · ${track.title}` });
    await tagAudio(filePath, {
      title: track.title,
      artist,
      albumArtist: (track.artists ?? [])[0],
      album: track.album ?? albumName ?? null,
      year: track.year,
      trackNumber: track.trackNumber ?? (total > 1 ? index : null),
      trackTotal: total > 1 ? total : null,
      discNumber: track.discNumber,
      comment: match.url,
      coverPath,
    }, { signal: job.signal });
  }

  return { ok: true };
}

export async function runCatalogJob(job, plan) {
  await fsp.mkdir(job.dir, { recursive: true });

  jobs.update(job, { status: 'preparing', phase: 'Reading the track list' });
  const catalog = await resolveCatalog(plan.analysis);

  let tracks = catalog.tracks;
  if (plan.items?.length) {
    const wanted = new Set(plan.items);
    tracks = tracks.filter((_, i) => wanted.has(i + 1));
  }
  if (!tracks.length) throw new Error('No tracks were selected.');

  const total = tracks.length;
  const preset = audioPreset(plan.quality);

  jobs.update(job, {
    title: catalog.name,
    subtitle: catalog.subtitle,
    thumbnail: catalog.cover ?? job.thumbnail,
    progress: { item: 0, itemCount: total },
  });

  // One cover fetch serves the whole album; per-track art overrides it.
  let coverPath = null;
  if (catalog.cover && hasFfmpeg()) {
    coverPath = await fetchCover(catalog.cover, path.join(job.dir, '.cover.jpg'));
  }

  let succeeded = 0;
  const failures = [];

  for (let i = 0; i < tracks.length; i += 1) {
    if (job.signal.aborted) throw Object.assign(new Error('Canceled.'), { canceled: true });

    const track = tracks[i];
    let trackCover = coverPath;
    if (track.cover && track.cover !== catalog.cover && hasFfmpeg()) {
      trackCover = (await fetchCover(track.cover, path.join(job.dir, `.cover-${i}.jpg`))) ?? coverPath;
    }

    const result = await downloadOneTrack(job, track, {
      index: i + 1,
      total,
      preset,
      coverPath: trackCover,
      albumName: catalog.kind === 'album' ? catalog.name : null,
    });

    if (result.ok) succeeded += 1;
    else {
      failures.push(result.reason);
      jobs.addWarning(job, result.reason);
    }

    jobs.update(job, { progress: { percent: ((i + 1) / total) * 100, speed: null, eta: null } });
  }

  // Cover art files are hidden (dot-prefixed) so collectOutputs skips them.
  const files = await collectOutputs(job.dir);
  if (!files.length) {
    throw new Error(
      failures.length
        ? `Nothing could be downloaded. ${failures[0]}`
        : 'Nothing could be downloaded from that link.',
    );
  }

  const archive = await packageIfNeeded(job, files);

  jobs.update(job, {
    status: 'done',
    phase: succeeded === total ? 'Ready' : `Ready · ${succeeded} of ${total}`,
    files,
    archive,
    progress: { percent: 100, speed: null, eta: null },
  });

  log.ok(`${job.platformName} · ${succeeded}/${total} tracks · ${job.title}`);
}

/* ═════════════════════════════ Entry point ════════════════════════════ */

export async function runJob(job, plan) {
  if (plan.analysis.isCatalog) return runCatalogJob(job, plan);
  return runMediaJob(job, plan);
}

/**
 * Fills in a job's display metadata in the background so the activity card
 * shows a real title and artwork even when the user never opened a preview.
 */
export async function hydrateJobTitle(job, plan) {
  if (plan.analysis.isCatalog) return;
  try {
    const info = await fetchInfo(job.url, { playlist: plan.playlist, signal: job.signal });
    jobs.update(job, {
      title: info.title ?? job.title,
      subtitle: info.uploader ?? info.channel ?? job.subtitle,
      thumbnail: bestThumbnail(info) ?? job.thumbnail,
      duration: Number.isFinite(info.duration) ? Math.round(info.duration) : job.duration,
    });
  } catch {
    // Cosmetic only — the download itself does not depend on this.
  }
}

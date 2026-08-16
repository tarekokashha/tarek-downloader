import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import archiver from 'archiver';
import { tools, killTree } from './binaries.js';
import log from './log.js';

/** Characters Windows forbids, plus control chars and trailing dots/spaces. */
export function safeFilename(input, fallback = 'download') {
  let name = String(input ?? '').normalize('NFC');
  name = name.replace(/[\u0000-\u001f\u007f]/g, '');
  name = name.replace(/[<>:"/\\|?*]/g, ' ');
  name = name.replace(/\s+/g, ' ').trim();
  name = name.replace(/[. ]+$/, '');

  // Reserved device names on Windows.
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) name = `_${name}`;

  if (!name) name = fallback;
  if (name.length > 120) name = `${name.slice(0, 117).trim()}...`;
  return name;
}

/** Filenames arrive from remote metadata, so re-check before serving. */
export function isSafeChildPath(baseDir, candidate) {
  const resolvedBase = path.resolve(baseDir);
  const resolved = path.resolve(baseDir, candidate);
  return resolved === resolvedBase || resolved.startsWith(resolvedBase + path.sep);
}

const MEDIA_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.webm', '.mov', '.avi', '.flv', '.m4v', '.3gp', '.ts',
  '.mp3', '.m4a', '.opus', '.ogg', '.oga', '.wav', '.flac', '.aac', '.wma',
  '.jpg', '.jpeg', '.png', '.webp', '.gif',
  '.srt', '.vtt', '.ass', '.lrc',
]);

/** Files yt-dlp leaves behind mid-run that must never be reported as results. */
const TEMP_PATTERN = /\.(part|ytdl|temp|tmp|f\d+|download)$|\.part-Frag\d+$/i;

/**
 * Lists the finished artefacts in a job directory.
 * Downloading into a dedicated empty folder and reading it back is far more
 * reliable than parsing filenames out of yt-dlp's stdout, which changes shape
 * across merges, conversions and playlists.
 */
export async function collectOutputs(dir) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name.startsWith('.')) continue;
    if (TEMP_PATTERN.test(entry.name)) continue;

    const ext = path.extname(entry.name).toLowerCase();
    if (ext && !MEDIA_EXTENSIONS.has(ext)) continue;

    try {
      const stat = await fsp.stat(path.join(dir, entry.name));
      if (stat.size === 0) continue;
      files.push({ name: entry.name, size: stat.size, ext: ext.replace('.', '') });
    } catch { /* vanished mid-scan */ }
  }

  // Media first, then subtitles, then images; alphabetical inside each group.
  const rank = (f) => {
    if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(f.ext)) return 2;
    if (['srt', 'vtt', 'ass', 'lrc'].includes(f.ext)) return 1;
    return 0;
  };
  files.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  return files;
}

/** Runs ffmpeg, resolving on success and rejecting with its stderr tail. */
export function runFfmpeg(args, { timeout = 300_000, signal } = {}) {
  if (!tools.ffmpeg) return Promise.reject(new Error('ffmpeg is not available.'));

  return new Promise((resolve, reject) => {
    const child = spawn(tools.ffmpeg.command, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });

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
      finish(reject, new Error('ffmpeg timed out.'));
    }, timeout);

    const onAbort = signal ? () => { killTree(child); finish(reject, new Error('Canceled.')); } : null;
    if (onAbort) signal.addEventListener('abort', onAbort, { once: true });

    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000); });
    child.on('error', (err) => finish(reject, err));
    child.on('close', (code) => {
      if (code === 0) finish(resolve, true);
      else finish(reject, new Error(stderr.trim().split('\n').pop() || `ffmpeg exited with ${code}`));
    });
  });
}

/**
 * Spotify encodes the artwork size in the image id: `…0000b273…` is 640px,
 * `…00001e02…` is 300px and `…00004851…` is 64px. The public embed page only
 * hands out the 300px variant, so ask for the large one first — music players
 * show cover art far bigger than that.
 */
function coverCandidates(url) {
  const list = [url];
  if (/i\.scdn\.co\/image\/ab67616d(00001e02|00004851)/.test(url)) {
    list.unshift(url.replace(/ab67616d(00001e02|00004851)/, 'ab67616d0000b273'));
  }
  return [...new Set(list)];
}

/**
 * Downloads cover art to disk, trying higher-resolution variants first.
 * Returns null rather than failing the download it belongs to.
 */
export async function fetchCover(url, destination, { timeout = 20_000 } = {}) {
  if (!url) return null;

  for (const candidate of coverCandidates(url)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(candidate, { signal: controller.signal, redirect: 'follow' });
      if (!res.ok) continue;

      const type = res.headers.get('content-type') ?? '';
      if (!type.startsWith('image/')) continue;

      const buffer = Buffer.from(await res.arrayBuffer());
      if (!buffer.length || buffer.length > 12 * 1024 * 1024) continue;

      await fsp.writeFile(destination, buffer);
      return destination;
    } catch {
      // try the next candidate
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

const escapeTag = (value) => String(value ?? '').replace(/[\r\n]+/g, ' ').trim();

/**
 * Writes catalogue metadata and cover art onto an audio file.
 * Remuxes rather than re-encodes, so it is fast and lossless.
 */
export async function tagAudio(filePath, { title, artist, albumArtist, album, year, trackNumber, trackTotal, discNumber, comment, coverPath }, opts = {}) {
  if (!tools.ffmpeg) return false;

  const ext = path.extname(filePath).toLowerCase();
  const temp = path.join(path.dirname(filePath), `.tagging${ext}`);

  const args = ['-i', filePath];
  const canEmbedCover = coverPath && ['.mp3', '.m4a', '.mp4', '.flac'].includes(ext);
  if (canEmbedCover) args.push('-i', coverPath);

  args.push('-map', '0:a');
  if (canEmbedCover) args.push('-map', '1:v');
  args.push('-c', 'copy');

  if (ext === '.mp3') args.push('-id3v2_version', '3', '-write_id3v1', '1');

  const tags = {
    title: escapeTag(title),
    artist: escapeTag(artist),
    album_artist: escapeTag(albumArtist || artist),
    album: escapeTag(album),
    date: escapeTag(year),
    comment: escapeTag(comment),
  };
  if (Number.isFinite(trackNumber) && trackNumber > 0) {
    tags.track = Number.isFinite(trackTotal) && trackTotal > 0 ? `${trackNumber}/${trackTotal}` : String(trackNumber);
  }
  if (Number.isFinite(discNumber) && discNumber > 0) tags.disc = String(discNumber);

  for (const [key, value] of Object.entries(tags)) {
    if (value) args.push('-metadata', `${key}=${value}`);
  }

  if (canEmbedCover) {
    args.push('-disposition:v', 'attached_pic');
    args.push('-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)');
  }

  args.push(temp);

  try {
    await runFfmpeg(args, { timeout: 120_000, signal: opts.signal });
    await fsp.rm(filePath, { force: true });
    await fsp.rename(temp, filePath);
    return true;
  } catch (err) {
    await fsp.rm(temp, { force: true }).catch(() => {});
    log.warn(`Could not tag ${path.basename(filePath)}: ${err.message}`);
    return false;
  }
}

/**
 * Packs a job's files into a zip. Media is already compressed, so entries are
 * stored rather than deflated — much faster and the same size.
 */
export function createArchive(dir, files, destination) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destination);
    const archive = archiver('zip', { zlib: { level: 0 }, store: true });

    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      output.destroy();
      fsp.rm(destination, { force: true }).catch(() => {});
      reject(err);
    };

    output.on('close', () => {
      if (settled) return;
      settled = true;
      resolve(archive.pointer());
    });
    output.on('error', fail);
    archive.on('error', fail);
    archive.on('warning', (err) => {
      if (err.code === 'ENOENT') log.warn(`Archive warning: ${err.message}`);
      else fail(err);
    });

    archive.pipe(output);
    for (const file of files) {
      archive.file(path.join(dir, file.name), { name: file.name });
    }
    archive.finalize().catch(fail);
  });
}

/**
 * Total bytes currently held in the download directory.
 * A public instance needs this: without a cap, a handful of playlist jobs
 * will fill the container's disk and every later download fails obscurely.
 */
export async function diskUsageBytes(dir) {
  let total = 0;
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) total += await diskUsageBytes(full);
      else total += (await fsp.stat(full)).size;
    } catch { /* vanished mid-scan */ }
  }
  return total;
}

/** Human-readable byte count, used in log lines and API responses. */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

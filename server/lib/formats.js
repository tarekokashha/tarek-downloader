/**
 * Turns yt-dlp's raw format list — often 40+ near-duplicate entries — into the
 * short, honest menu the UI shows, and builds the exact selector string used
 * to fetch each one.
 */

/** Quality rungs we offer, highest first. */
const HEIGHT_LADDER = [4320, 2160, 1440, 1080, 720, 480, 360, 240, 144];

const HEIGHT_LABELS = {
  4320: '8K', 2160: '4K', 1440: '2K', 1080: 'Full HD',
  720: 'HD', 480: 'SD', 360: '', 240: '', 144: '',
};

export const AUDIO_PRESETS = [
  { id: 'mp3-320', label: 'MP3', detail: '320 kbps', format: 'mp3', quality: '320K', kbps: 320, recommended: true },
  { id: 'mp3-256', label: 'MP3', detail: '256 kbps', format: 'mp3', quality: '256K', kbps: 256 },
  { id: 'mp3-192', label: 'MP3', detail: '192 kbps', format: 'mp3', quality: '192K', kbps: 192 },
  { id: 'mp3-128', label: 'MP3', detail: '128 kbps · small', format: 'mp3', quality: '128K', kbps: 128 },
  { id: 'm4a', label: 'M4A', detail: 'AAC · Apple native', format: 'm4a', quality: '0', kbps: 192 },
  { id: 'opus', label: 'OPUS', detail: 'best per byte', format: 'opus', quality: '0', kbps: 160 },
  { id: 'flac', label: 'FLAC', detail: 'lossless container', format: 'flac', quality: '0', kbps: 900 },
  { id: 'wav', label: 'WAV', detail: 'uncompressed', format: 'wav', quality: '0', kbps: 1411 },
];

export const CONTAINERS = [
  { id: 'mp4', label: 'MP4', detail: 'plays everywhere' },
  { id: 'mkv', label: 'MKV', detail: 'keeps every track' },
  { id: 'webm', label: 'WEBM', detail: 'open codecs' },
];

const isReal = (value) => value !== undefined && value !== null && value !== 'none' && value !== '';

const hasVideoStream = (f) => isReal(f.vcodec) && f.vcodec !== 'none';
const hasAudioStream = (f) => isReal(f.acodec) && f.acodec !== 'none';

/**
 * TikTok, and occasionally Instagram, expose a watermarked "download address"
 * variant alongside the clean stream. We never offer the branded one.
 */
function isWatermarked(f) {
  const haystack = `${f.format_id ?? ''} ${f.format_note ?? ''} ${f.format ?? ''}`.toLowerCase();
  if (haystack.includes('download_addr')) return true;
  // "no watermark" / "without watermark" describe a clean stream, not a
  // branded one — matching the bare substring would discard exactly the
  // format we want to keep.
  const cleaned = haystack.replace(/\b(no|non|without|un)[\s-]*watermark(ed)?\b/g, '');
  return cleaned.includes('watermark');
}

/** Best available byte count for a format, estimated from bitrate if needed. */
function sizeOf(format, duration) {
  if (Number.isFinite(format.filesize) && format.filesize > 0) return format.filesize;
  if (Number.isFinite(format.filesize_approx) && format.filesize_approx > 0) return format.filesize_approx;
  const bitrate = format.tbr ?? (Number(format.vbr) || 0) + (Number(format.abr) || 0);
  if (Number.isFinite(bitrate) && bitrate > 0 && Number.isFinite(duration) && duration > 0) {
    return Math.round((bitrate * 1000 * duration) / 8);
  }
  return null;
}

/**
 * Bitrate of the *video* stream alone.
 *
 * Progressive formats report `tbr` including their audio, which would make a
 * legacy 360p-with-sound look richer than a better video-only 360p stream.
 */
function videoBitrate(f) {
  if (Number.isFinite(f.vbr) && f.vbr > 0) return f.vbr;
  if (Number.isFinite(f.tbr) && f.tbr > 0) {
    const audio = hasAudioStream(f) ? (Number(f.abr) || 96) : 0;
    return Math.max(1, f.tbr - audio);
  }
  return 0;
}

/**
 * Codec preference per container, most preferred first.
 * H.264 plays on literally everything; VP9 has broad hardware decode; AV1 is
 * the most efficient but the least supported on older phones and TVs.
 */
const CODEC_ORDER = {
  mp4: ['avc1', 'h264', 'vp9', 'vp09', 'av01'],
  mkv: ['avc1', 'h264', 'vp9', 'vp09', 'av01'],
  webm: ['vp9', 'vp09', 'av01'],
};

function codecRank(vcodec, container) {
  const codec = String(vcodec ?? '').toLowerCase();
  const order = CODEC_ORDER[container] ?? CODEC_ORDER.mp4;
  const index = order.findIndex((prefix) => codec.startsWith(prefix));
  return index === -1 ? order.length : index;
}

/**
 * Picks the audio track to pair with a video-only stream.
 * Stereo wins by default: YouTube's 5.1 tracks are three times the size and
 * downmix badly on phones and laptops.
 */
function pickBestAudio(audioOnly, container) {
  if (!audioOnly.length) return null;

  const isStereo = (f) => {
    if (Number.isFinite(f.audio_channels)) return f.audio_channels <= 2;
    return !/5\.1|7\.1|surround/i.test(`${f.format_note ?? ''} ${f.format ?? ''}`);
  };

  const stereo = audioOnly.filter(isStereo);
  const pool = stereo.length ? stereo : audioOnly;
  const preferredExt = container === 'mp4' ? 'm4a' : null;

  return [...pool].sort((a, b) => {
    if (preferredExt) {
      const aExt = a.ext === preferredExt ? 1 : 0;
      const bExt = b.ext === preferredExt ? 1 : 0;
      if (aExt !== bExt) return bExt - aExt;
    }
    return (b.abr ?? b.tbr ?? 0) - (a.abr ?? a.tbr ?? 0);
  })[0];
}

function codecLabel(vcodec = '') {
  const c = String(vcodec).toLowerCase();
  if (c.startsWith('avc1') || c.startsWith('h264')) return 'H.264';
  if (c.startsWith('vp9') || c.startsWith('vp09')) return 'VP9';
  if (c.startsWith('av01')) return 'AV1';
  if (c.startsWith('hev1') || c.startsWith('hvc1') || c.startsWith('h265')) return 'HEVC';
  return null;
}

/**
 * Builds the download menu for one media item.
 *
 * @param {object} info  yt-dlp `--dump-single-json` output for a single item
 * @param {object} opts
 * @returns {{video: object[], audio: object[], best: object|null, hasVideo: boolean, hasAudio: boolean}}
 */
export function buildFormatOptions(info, { container = 'mp4' } = {}) {
  const duration = Number(info.duration) || 0;
  const all = (Array.isArray(info.formats) ? info.formats : []).filter(
    (f) => f && isReal(f.format_id) && !isWatermarked(f),
  );

  const videoFormats = all.filter((f) => hasVideoStream(f) && Number.isFinite(f.height) && f.height > 0);
  const audioOnly = all.filter((f) => hasAudioStream(f) && !hasVideoStream(f));

  // The audio track we will pair with adaptive (video-only) streams.
  const bestAudio = pickBestAudio(audioOnly, container);
  const bestAudioSize = bestAudio ? sizeOf(bestAudio, duration) : null;

  const availableHeights = [...new Set(videoFormats.map((f) => f.height))].sort((a, b) => b - a);

  const video = [];
  for (const rung of HEIGHT_LADDER) {
    // Snap each real resolution onto the nearest rung so odd heights
    // (e.g. TikTok's 1024) still appear under a familiar label.
    const matches = videoFormats.filter((f) => nearestRung(f.height) === rung);
    if (!matches.length) continue;

    const ranked = [...matches].sort((a, b) => {
      // 1. Codec that best suits the chosen container.
      const codecDelta = codecRank(a.vcodec, container) - codecRank(b.vcodec, container);
      if (codecDelta !== 0) return codecDelta;

      // 2. Adaptive beats progressive: a video-only stream gets paired with
      //    the good audio track, while legacy progressive bakes in a weak one.
      if (bestAudio) {
        const aAdaptive = hasAudioStream(a) ? 0 : 1;
        const bAdaptive = hasAudioStream(b) ? 0 : 1;
        if (aAdaptive !== bAdaptive) return bAdaptive - aAdaptive;
      }

      // 3. Richer picture, then smoother motion.
      return (videoBitrate(b) - videoBitrate(a)) || ((b.fps ?? 0) - (a.fps ?? 0));
    });

    const chosen = ranked[0];
    const progressive = hasAudioStream(chosen);
    const videoSize = sizeOf(chosen, duration);
    const totalSize = progressive ? videoSize : sum(videoSize, bestAudioSize);

    const genericFallback = container === 'mp4'
      ? `bv*[height<=${rung}][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=${rung}]+ba/b[height<=${rung}]/b`
      : `bv*[height<=${rung}]+ba/b[height<=${rung}]/b`;

    const exact = progressive || !bestAudio
      ? chosen.format_id
      : `${chosen.format_id}+${bestAudio.format_id}`;

    video.push({
      id: `v${rung}`,
      kind: 'video',
      height: rung,
      actualHeight: chosen.height,
      label: `${rung}p`,
      badge: HEIGHT_LABELS[rung] || '',
      fps: Number.isFinite(chosen.fps) ? Math.round(chosen.fps) : null,
      codec: codecLabel(chosen.vcodec),
      hdr: isReal(chosen.dynamic_range) && chosen.dynamic_range !== 'SDR' ? chosen.dynamic_range : null,
      ext: chosen.ext,
      size: totalSize,
      sizeIsEstimate: !Number.isFinite(chosen.filesize),
      // Exact IDs first for precision, generic selector as a safety net.
      selector: `${exact}/${genericFallback}`,
      recommended: rung === 1080 || (availableHeights.length > 0 && rung === nearestRung(availableHeights[0]) && rung < 1080),
    });
  }

  // Nothing resolution-tagged (some sites expose one opaque stream).
  if (!video.length && all.some(hasVideoStream)) {
    const chosen = all
      .filter(hasVideoStream)
      .sort((a, b) => (videoBitrate(b) - videoBitrate(a)) || ((b.fps ?? 0) - (a.fps ?? 0)))[0];
    video.push({
      id: 'vbest',
      kind: 'video',
      height: chosen.height ?? null,
      label: chosen.height ? `${chosen.height}p` : 'Original',
      badge: 'BEST',
      fps: Number.isFinite(chosen.fps) ? Math.round(chosen.fps) : null,
      codec: codecLabel(chosen.vcodec),
      hdr: null,
      ext: chosen.ext,
      size: sizeOf(chosen, duration),
      sizeIsEstimate: !Number.isFinite(chosen.filesize),
      selector: `${chosen.format_id}/bv*+ba/b`,
      recommended: true,
    });
  }

  if (!video.some((v) => v.recommended) && video.length) video[0].recommended = true;

  const sourceKbps = bestAudio ? Math.round(bestAudio.abr ?? bestAudio.tbr ?? 0) : 0;

  const audio = AUDIO_PRESETS.map((preset) => ({
    id: preset.id,
    kind: 'audio',
    label: preset.label,
    detail: preset.detail,
    format: preset.format,
    quality: preset.quality,
    ext: preset.format,
    size: duration > 0 ? Math.round((preset.kbps * 1000 * duration) / 8) : null,
    sizeIsEstimate: true,
    recommended: Boolean(preset.recommended),
    /** Truthful note when the target bitrate exceeds what the source holds. */
    note: sourceKbps > 0 && preset.kbps > sourceKbps + 32 && preset.format !== 'flac' && preset.format !== 'wav'
      ? `source is ~${sourceKbps} kbps`
      : null,
  }));

  return {
    video,
    audio,
    hasVideo: video.length > 0,
    hasAudio: all.some(hasAudioStream) || video.length > 0,
    sourceAudioKbps: sourceKbps || null,
  };
}

function nearestRung(height) {
  if (!Number.isFinite(height)) return null;
  let best = HEIGHT_LADDER[HEIGHT_LADDER.length - 1];
  let bestGap = Infinity;
  for (const rung of HEIGHT_LADDER) {
    const gap = Math.abs(rung - height);
    if (gap < bestGap) { bestGap = gap; best = rung; }
  }
  return best;
}

function sum(a, b) {
  if (!Number.isFinite(a)) return Number.isFinite(b) ? b : null;
  if (!Number.isFinite(b)) return a;
  return a + b;
}

/**
 * Fallback selector for collection downloads, where per-item formats are not
 * known ahead of time.
 */
export function genericVideoSelector(height, container = 'mp4') {
  const cap = Number.isFinite(height) && height > 0 ? `[height<=${height}]` : '';
  if (container === 'mp4') {
    return `bv*${cap}[vcodec^=avc1]+ba[ext=m4a]/bv*${cap}[ext=mp4]+ba/bv*${cap}+ba/b${cap}/b`;
  }
  return `bv*${cap}+ba/b${cap}/b`;
}

export function audioPreset(id) {
  return AUDIO_PRESETS.find((p) => p.id === id) ?? AUDIO_PRESETS[0];
}

/**
 * Source track for audio-only downloads.
 *
 * Ordering is driven by what actually works, not by theory. YouTube currently
 * serves its M4A/AAC streams reliably while several WebM/Opus streams answer
 * with HTTP 403, and its 5.1 tracks are three times the size for no benefit on
 * ordinary playback. So: stereo AAC first, then any AAC, then stereo anything,
 * then whatever is left. Sites without M4A fall straight through the chain.
 */
export const AUDIO_SOURCE_SELECTOR = [
  'ba[ext=m4a][audio_channels<=2]',
  'ba[ext=m4a]',
  'ba[audio_channels<=2]',
  'ba[acodec!=none]',
  'ba',
  'bestaudio/best',
].join('/');

/** Picks the best thumbnail URL from an info dict. */
export function bestThumbnail(info) {
  if (typeof info.thumbnail === 'string' && info.thumbnail) return info.thumbnail;
  const list = Array.isArray(info.thumbnails) ? info.thumbnails.filter((t) => t && t.url) : [];
  if (!list.length) return null;
  const scored = [...list].sort((a, b) => {
    const areaA = (a.width ?? 0) * (a.height ?? 0) || (a.preference ?? -100);
    const areaB = (b.width ?? 0) * (b.height ?? 0) || (b.preference ?? -100);
    return areaB - areaA;
  });
  return scored[0].url;
}

import config from '../config.js';
import log from './log.js';

/**
 * Fallback resolvers for sites yt-dlp cannot reach anonymously.
 *
 * TikTok serves a 1.4 KB stub to non-browser clients, so yt-dlp's extractor
 * fails with "Unexpected response from webpage request" and the only advice
 * left is "go and log in". That is a bad answer for a tool whose whole point
 * is pasting a link, so we ask a public no-auth resolver instead.
 *
 * Trade-off, stated plainly: the link you paste is sent to a third party.
 * That service sees the TikTok URL — nothing else, no cookies, no identity —
 * and it is only ever consulted after yt-dlp has already failed. Set
 * FALLBACK_RESOLVERS=false to turn this off and keep everything first-party.
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function getJson(url, { timeout = 20_000, signal } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const relay = () => controller.abort();
  signal?.addEventListener('abort', relay, { once: true });
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', relay);
  }
}

/** TikTok's own oEmbed. No auth, but metadata only — no media URL. */
async function tiktokOEmbed(url, opts) {
  try {
    const data = await getJson(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, opts);
    return {
      title: data.title ?? null,
      uploader: data.author_name ?? null,
      thumbnail: data.thumbnail_url ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Resolves a TikTok post to direct media URLs.
 * Handles both ordinary video posts and photo slideshows.
 */
export async function resolveTikTok(url, { signal } = {}) {
  if (!config.fallbackResolvers) return null;

  let payload;
  try {
    payload = await getJson(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`, { signal });
  } catch (err) {
    log.warn(`TikTok fallback resolver unreachable: ${err.message}`);
    return null;
  }

  if (payload?.code !== 0 || !payload.data) {
    log.warn(`TikTok fallback returned no data: ${payload?.msg ?? 'unknown'}`);
    return null;
  }

  const d = payload.data;
  const oembed = await tiktokOEmbed(url, { signal });

  const photos = Array.isArray(d.images) ? d.images.filter(Boolean) : [];
  const isSlideshow = photos.length > 0;

  // `play` is the clean stream; `wmplay` carries TikTok's watermark and is
  // never offered. `hdplay` is the higher-bitrate clean stream when present.
  const video = d.hdplay || d.play || null;
  if (!video && !isSlideshow) return null;

  return {
    source: 'tikwm',
    id: String(d.id ?? ''),
    title: d.title || oembed?.title || 'TikTok post',
    uploader: d.author?.nickname || d.author?.unique_id || oembed?.uploader || null,
    thumbnail: d.origin_cover || d.cover || oembed?.thumbnail || null,
    duration: Number.isFinite(d.duration) ? d.duration : null,
    isSlideshow,
    photos,
    video,
    videoHd: d.hdplay || null,
    /** The plain H.264 stream, which plays without extra codecs. */
    videoStandard: d.play || null,
    size: Number.isFinite(d.hd_size) ? d.hd_size : (Number.isFinite(d.size) ? d.size : null),
    audio: d.music_info?.play || d.music || null,
    audioTitle: d.music_info?.title || null,
  };
}

/**
 * Shapes a fallback result like a yt-dlp info dict for the resolver.
 *
 * Both streams are offered when available. TikTok's HD variant is HEVC, which
 * many Windows players cannot decode without an extra codec, so the plain
 * H.264 stream is listed too — the MP4 container's codec ranking then picks
 * the compatible one automatically while MKV/WebM users can still take HD.
 */
export function toInfoShape(result, url) {
  const formats = [];

  if (result.videoHd) {
    formats.push({
      format_id: 'fallback-hd',
      url: result.videoHd,
      ext: 'mp4',
      vcodec: 'hev1',
      acodec: 'aac',
      height: 1024,          // TikTok is vertical; snapped to 1080p by the ladder
      filesize: result.size ?? null,
      format_note: 'clean, HD',
    });
  }

  const standard = result.videoStandard || (result.videoHd ? null : result.video);
  if (standard) {
    formats.push({
      format_id: 'fallback-video',
      url: standard,
      ext: 'mp4',
      vcodec: 'avc1',
      acodec: 'aac',
      height: 1024,
      filesize: result.videoHd ? null : (result.size ?? null),
      format_note: 'clean',
    });
  }

  return {
    id: result.id,
    title: result.title,
    uploader: result.uploader,
    duration: result.duration,
    thumbnail: result.thumbnail,
    webpage_url: url,
    extractor: 'tiktok:fallback',
    formats,
    _fallback: result,
  };
}

export const FALLBACK_NOTICE = {
  tone: 'info',
  title: 'Resolved without signing in',
  body:
    'TikTok blocks anonymous requests, so the link was resolved through a public '
    + 'lookup service instead. Only the URL you pasted was sent — no account, no cookies. '
    + 'Set FALLBACK_RESOLVERS=false in .env to disable this.',
};

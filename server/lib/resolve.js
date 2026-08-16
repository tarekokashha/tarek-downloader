import { fetchInfo } from './ytdlp.js';
import { buildFormatOptions, bestThumbnail } from './formats.js';
import { resolveCatalog } from './catalog.js';
import config from '../config.js';

/** True when the server has any cookie source configured. */
const hasCookies = () => Boolean(config.cookiesFile || config.cookiesFromBrowser);

/**
 * Warns before the download rather than after it fails. Instagram and TikTok
 * both hand logged-out clients an error page, and the raw extractor message
 * ("Unexpected response from webpage request") explains nothing.
 */
function authNotice(analysis) {
  if (!analysis.prefersCookies || hasCookies()) return null;

  return analysis.platform === 'instagram'
    ? {
        tone: 'warn',
        title: 'Instagram needs you signed in',
        body:
          'Instagram serves almost nothing to logged-out clients, so this will probably fail. '
          + 'Add COOKIES_FROM_BROWSER=chrome to your .env (close Chrome first), or export a '
          + 'cookies.txt and set COOKIES_FILE, then restart the server.',
      }
    : {
        tone: 'warn',
        title: 'TikTok may bot-check this request',
        body:
          'TikTok blocks anonymous requests intermittently. If it fails, add '
          + 'COOKIES_FROM_BROWSER=chrome to your .env (close Chrome first) and restart.',
      };
}

/** `20240517` -> `17 May 2024` */
function readableDate(raw) {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(raw ?? ''));
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const clip = (text, max) => {
  const value = String(text ?? '').trim();
  if (!value) return null;
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
};

/** YouTube exposes a predictable thumbnail path even for flat playlist entries. */
function entryThumbnail(entry) {
  const direct = bestThumbnail(entry);
  if (direct) return direct;
  if (entry.ie_key === 'Youtube' || entry.ie_key === 'YoutubeTab' || /^[\w-]{11}$/.test(entry.id ?? '')) {
    return `https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg`;
  }
  return null;
}

function normaliseEntries(entries = []) {
  return entries
    .filter(Boolean)
    .slice(0, config.maxPlaylistItems)
    .map((entry, index) => ({
      index: index + 1,
      id: entry.id ?? String(index),
      title: clip(entry.title ?? entry.fulltitle ?? `Item ${index + 1}`, 160) ?? `Item ${index + 1}`,
      uploader: clip(entry.uploader ?? entry.channel ?? entry.artist, 80),
      duration: Number.isFinite(entry.duration) ? Math.round(entry.duration) : null,
      thumbnail: entryThumbnail(entry),
      url: entry.url ?? entry.webpage_url ?? null,
    }));
}

/**
 * Resolves a validated link into everything the UI needs to render a card:
 * title, artwork, and the download menu.
 *
 * @param {object} analysis result of `analyseUrl()`
 * @param {object} opts
 */
export async function resolveLink(analysis, { forcePlaylist = false, container = 'mp4', signal } = {}) {
  /* ── DRM-locked catalogue services ───────────────────────────────── */
  if (analysis.isCatalog) {
    const catalog = await resolveCatalog(analysis);
    const tracks = catalog.tracks;
    const totalSeconds = tracks.reduce((sum, t) => sum + (t.durationSec ?? 0), 0);

    return {
      kind: 'catalog',
      url: analysis.url,
      platform: analysis.platform,
      platformName: analysis.platformName,
      accent: analysis.accent,
      title: catalog.name,
      uploader: catalog.subtitle,
      thumbnail: catalog.cover,
      duration: totalSeconds || null,
      itemCount: tracks.length,
      isCollection: tracks.length > 1,
      collectionKind: catalog.kind,
      entries: tracks.map((track, index) => ({
        index: index + 1,
        id: `t${index}`,
        title: track.title,
        uploader: (track.artists ?? []).join(', '),
        duration: track.durationSec,
        thumbnail: track.cover ?? catalog.cover,
        url: track.sourceUrl,
      })),
      formats: { video: [], audio: buildFormatOptions({ duration: totalSeconds / Math.max(1, tracks.length), formats: [] }).audio },
      audioOnly: true,
      notice: {
        tone: 'info',
        title: `${analysis.platformName} audio is DRM-protected`,
        body:
          `No tool can pull the audio stream from ${analysis.platformName}. Stash reads the track details ` +
          'and cover art, finds the matching recording on YouTube, then writes those tags onto the file. ' +
          'Matches are scored on duration, artist and channel, and anything doubtful is reported rather than guessed.',
      },
      degraded: Boolean(catalog.degraded),
      totalAvailable: catalog.totalAvailable ?? tracks.length,
    };
  }

  /* ── Collections handled natively by yt-dlp ──────────────────────── */
  // An Instagram post or TikTok photo slideshow hides several media items
  // behind one URL; without playlist extraction only the first is ever seen.
  const wantsPlaylist = forcePlaylist || analysis.isCollection || analysis.carousel;

  let info = await fetchInfo(analysis.url, {
    playlist: wantsPlaylist,
    flat: !analysis.carousel || analysis.isCollection,
    signal,
    platform: analysis.platform,
  });

  // A carousel holding exactly one item is just a normal post — unwrap it so
  // the user gets the full quality menu instead of a one-row checklist.
  if (analysis.carousel && Array.isArray(info.entries) && info.entries.length === 1) {
    const only = info.entries[0];
    if (only && Array.isArray(only.formats) && only.formats.length) {
      info = { ...only, webpage_url: only.webpage_url ?? analysis.url };
    }
  }

  if (info._type === 'playlist' || Array.isArray(info.entries)) {
    const entries = normaliseEntries(info.entries ?? []);
    if (!entries.length) throw new Error('That collection appears to be empty or private.');

    const totalSeconds = entries.reduce((sum, e) => sum + (e.duration ?? 0), 0);

    return {
      kind: 'collection',
      url: analysis.url,
      platform: analysis.platform,
      platformName: analysis.platformName,
      accent: analysis.accent,
      title: clip(info.title ?? 'Playlist', 200) ?? 'Playlist',
      uploader: clip(info.uploader ?? info.channel ?? info.playlist_uploader, 100),
      thumbnail: bestThumbnail(info) ?? entries.find((e) => e.thumbnail)?.thumbnail ?? null,
      duration: totalSeconds || null,
      itemCount: entries.length,
      isCollection: true,
      collectionKind: analysis.collectionKind,
      entries,
      // Per-item formats are unknown up front, so a generic quality ladder is
      // offered and resolved per item at download time.
      formats: {
        video: [2160, 1440, 1080, 720, 480, 360].map((height) => ({
          id: `v${height}`,
          kind: 'video',
          height,
          label: `${height}p`,
          badge: height === 2160 ? '4K' : height === 1080 ? 'Full HD' : height === 720 ? 'HD' : '',
          size: null,
          sizeIsEstimate: true,
          selector: null,
          recommended: height === 1080,
        })),
        audio: buildFormatOptions({ duration: 0, formats: [] }).audio,
      },
      generic: true,
      totalAvailable: info.playlist_count ?? entries.length,
      notices: [authNotice(analysis)].filter(Boolean),
    };
  }

  /* ── A single piece of media ─────────────────────────────────────── */
  const formats = buildFormatOptions(info, { container });

  if (!formats.video.length && !formats.audio.length) {
    throw new Error('No downloadable media was found at that link.');
  }

  const notices = [];
  const auth = authNotice(analysis);
  if (auth) notices.push(auth);

  if (info.is_live) {
    notices.push({
      tone: 'warn',
      title: 'This is a live stream',
      body: 'Recording starts from the current moment and continues until you cancel the job.',
    });
  }
  if (info.availability && info.availability !== 'public') {
    notices.push({
      tone: 'info',
      title: `Marked as ${String(info.availability).replace(/_/g, ' ')}`,
      body: 'If the download fails, add your browser cookies in .env.',
    });
  }

  return {
    kind: 'single',
    url: info.webpage_url ?? analysis.url,
    platform: analysis.platform,
    platformName: analysis.platformName,
    accent: analysis.accent,
    title: clip(info.title ?? info.fulltitle ?? 'Untitled', 220) ?? 'Untitled',
    uploader: clip(info.uploader ?? info.channel ?? info.creator ?? info.artist, 100),
    uploaderUrl: info.uploader_url ?? info.channel_url ?? null,
    thumbnail: bestThumbnail(info),
    duration: Number.isFinite(info.duration) ? Math.round(info.duration) : null,
    viewCount: Number.isFinite(info.view_count) ? info.view_count : null,
    likeCount: Number.isFinite(info.like_count) ? info.like_count : null,
    uploadDate: readableDate(info.upload_date),
    description: clip(info.description, 400),
    isLive: Boolean(info.is_live),
    itemCount: 1,
    isCollection: false,
    entries: [],
    formats,
    chapters: Array.isArray(info.chapters) && info.chapters.length ? info.chapters.length : 0,
    subtitles: subtitleLanguages(info),
    embeddedPlaylist: analysis.embeddedPlaylist,
    notices,
  };
}

/** Merges real and auto-generated caption tracks into a display list. */
function subtitleLanguages(info) {
  const manual = Object.keys(info.subtitles ?? {});
  const auto = Object.keys(info.automatic_captions ?? {});
  const preferred = ['en', 'en-US', 'en-GB', 'es', 'fr', 'de', 'pt', 'ar', 'hi', 'ja', 'ko', 'zh-Hans', 'ru', 'it', 'tr', 'id'];

  const seen = new Set();
  const list = [];
  for (const code of [...manual, ...preferred.filter((p) => auto.includes(p)), ...auto]) {
    const base = code.split('-')[0];
    if (seen.has(code) || list.length >= 24) continue;
    seen.add(code);
    list.push({ code, auto: !manual.includes(code), base });
  }
  return list;
}

/**
 * Catalogue services (Spotify, Apple Music) stream DRM-protected audio that
 * cannot be downloaded — not by this tool, not by any other.
 *
 * What we do instead is what every working "Spotify downloader" does: read the
 * public *metadata* (title, artist, album, cover art, track order, duration),
 * find the matching recording on YouTube, and write the catalogue's tags onto
 * the resulting file. The quality of such a tool lives entirely in the match
 * step, so `scoreCandidate()` below is deliberately strict: duration has to
 * line up, the artist has to appear, and remixes/covers/live cuts are pushed
 * down unless the original track is itself a remix or live recording.
 */

import config from '../config.js';
import { searchYouTube } from './ytdlp.js';
import log from './log.js';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function httpGet(url, { headers = {}, timeout = 20_000, as = 'text' } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, 'accept-language': 'en-US,en;q=0.9', ...headers },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) {
      const err = new Error(`Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return as === 'json' ? await res.json() : await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/* ────────────────────────────── Spotify ────────────────────────────── */

let tokenCache = { value: null, expiresAt: 0 };

async function spotifyToken() {
  const { clientId, clientSecret } = config.spotify;
  if (!clientId || !clientSecret) return null;
  if (tokenCache.value && Date.now() < tokenCache.expiresAt) return tokenCache.value;

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      signal: controller.signal,
    });
    if (!res.ok) {
      log.warn(`Spotify credentials rejected (${res.status}); falling back to the public embed.`);
      return null;
    }
    const data = await res.json();
    tokenCache = {
      value: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000,
    };
    return tokenCache.value;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** `/intl-de/track/ID` and `spotify:track:ID` both need normalising. */
function parseSpotifyUrl(rawUrl) {
  const url = new URL(rawUrl);
  const path = url.pathname.replace(/^\/intl-[a-z-]+/i, '');
  const match = /^\/(track|album|playlist|artist|episode|show)\/([A-Za-z0-9]+)/.exec(path);
  if (!match) throw new Error('That Spotify link does not point at a track, album or playlist.');
  return { type: match[1], id: match[2] };
}

const spotifyImage = (images) =>
  Array.isArray(images) && images.length
    ? [...images].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0].url
    : null;

function trackFromApi(track, albumFallback = null) {
  if (!track || track.type === 'episode') return null;
  const album = track.album ?? albumFallback ?? {};
  return {
    title: track.name,
    artists: (track.artists ?? []).map((a) => a.name).filter(Boolean),
    album: album.name ?? null,
    cover: spotifyImage(album.images) ?? null,
    durationSec: Number.isFinite(track.duration_ms) ? Math.round(track.duration_ms / 1000) : null,
    trackNumber: track.track_number ?? null,
    discNumber: track.disc_number ?? null,
    year: (album.release_date ?? '').slice(0, 4) || null,
    isrc: track.external_ids?.isrc ?? null,
    explicit: Boolean(track.explicit),
    sourceUrl: track.external_urls?.spotify ?? null,
  };
}

async function spotifyViaApi(type, id, token) {
  const api = async (path) =>
    httpGet(`https://api.spotify.com/v1${path}`, {
      headers: { authorization: `Bearer ${token}` },
      as: 'json',
    });

  if (type === 'track') {
    const track = await api(`/tracks/${id}`);
    return {
      kind: 'track',
      name: track.name,
      subtitle: (track.artists ?? []).map((a) => a.name).join(', '),
      cover: spotifyImage(track.album?.images),
      tracks: [trackFromApi(track)].filter(Boolean),
    };
  }

  if (type === 'album') {
    const album = await api(`/albums/${id}`);
    const tracks = [...(album.tracks?.items ?? [])];
    let next = album.tracks?.next;
    while (next && tracks.length < config.maxPlaylistItems) {
      const page = await httpGet(next, { headers: { authorization: `Bearer ${token}` }, as: 'json' });
      tracks.push(...(page.items ?? []));
      next = page.next;
    }
    return {
      kind: 'album',
      name: album.name,
      subtitle: (album.artists ?? []).map((a) => a.name).join(', '),
      cover: spotifyImage(album.images),
      tracks: tracks
        .slice(0, config.maxPlaylistItems)
        .map((t) => trackFromApi(t, album))
        .filter(Boolean),
    };
  }

  if (type === 'playlist') {
    const playlist = await api(`/playlists/${id}?fields=name,owner(display_name),images,tracks.total`);
    const collected = [];
    let url = `https://api.spotify.com/v1/playlists/${id}/tracks?limit=100&fields=next,items(track(name,duration_ms,track_number,disc_number,explicit,external_ids,external_urls,artists(name),album(name,images,release_date)))`;
    while (url && collected.length < config.maxPlaylistItems) {
      const page = await httpGet(url, { headers: { authorization: `Bearer ${token}` }, as: 'json' });
      for (const item of page.items ?? []) {
        const track = trackFromApi(item?.track);
        if (track) collected.push(track);
      }
      url = page.next;
    }
    return {
      kind: 'playlist',
      name: playlist.name,
      subtitle: playlist.owner?.display_name ? `by ${playlist.owner.display_name}` : 'Playlist',
      cover: spotifyImage(playlist.images),
      totalAvailable: playlist.tracks?.total ?? collected.length,
      tracks: collected.slice(0, config.maxPlaylistItems),
    };
  }

  if (type === 'artist') {
    const [artist, top] = await Promise.all([api(`/artists/${id}`), api(`/artists/${id}/top-tracks?market=US`)]);
    return {
      kind: 'artist',
      name: artist.name,
      subtitle: 'Top tracks',
      cover: spotifyImage(artist.images),
      tracks: (top.tracks ?? []).map((t) => trackFromApi(t)).filter(Boolean),
    };
  }

  throw new Error('Podcasts and shows are not supported.');
}

/**
 * No-credentials path: Spotify's public embed page ships the full entity as
 * JSON. Playlists are capped by Spotify at roughly 100 items here.
 */
async function spotifyViaEmbed(type, id) {
  const html = await httpGet(`https://open.spotify.com/embed/${type}/${id}`);
  const match =
    /<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html) ||
    /<script[^>]+type="application\/json"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!match) throw new Error('Spotify did not return readable data for that link.');

  let entity;
  try {
    const data = JSON.parse(match[1]);
    entity = data?.props?.pageProps?.state?.data?.entity ?? data?.props?.pageProps?.entity;
  } catch {
    throw new Error('Spotify returned data in an unexpected shape.');
  }
  if (!entity) throw new Error('Could not read that Spotify link. Add API credentials in .env for full support.');

  const cover = spotifyImage(entity.coverArt?.sources ?? entity.visualIdentity?.image);
  const splitArtists = (value) =>
    String(value ?? '')
      .split(/,\s*|\s+&\s+/)
      .map((s) => s.trim())
      .filter(Boolean);

  if (type === 'track') {
    return {
      kind: 'track',
      name: entity.name ?? entity.title,
      subtitle: (entity.artists ?? []).map((a) => a.name).join(', '),
      cover,
      degraded: true,
      tracks: [{
        title: entity.name ?? entity.title,
        artists: (entity.artists ?? []).map((a) => a.name).filter(Boolean),
        album: entity.relatedEntityUri ? null : null,
        cover,
        durationSec: Number.isFinite(entity.duration) ? Math.round(entity.duration / 1000) : null,
        trackNumber: null,
        year: (entity.releaseDate?.isoString ?? '').slice(0, 4) || null,
        sourceUrl: `https://open.spotify.com/track/${id}`,
      }],
    };
  }

  const list = Array.isArray(entity.trackList) ? entity.trackList : [];
  if (!list.length) {
    throw new Error(
      'Spotify only exposes limited data without API credentials. Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to .env.',
    );
  }

  return {
    kind: type,
    name: entity.name ?? entity.title,
    subtitle: entity.subtitle ?? (type === 'album' ? 'Album' : 'Playlist'),
    cover,
    degraded: true,
    totalAvailable: entity.trackList.length,
    tracks: list.slice(0, config.maxPlaylistItems).map((t, i) => ({
      title: t.title ?? t.name,
      artists: splitArtists(t.subtitle),
      album: type === 'album' ? entity.name : null,
      cover,
      durationSec: Number.isFinite(t.duration) ? Math.round(t.duration / 1000) : null,
      trackNumber: type === 'album' ? i + 1 : null,
      year: (entity.releaseDate?.isoString ?? '').slice(0, 4) || null,
      sourceUrl: t.uri ? `https://open.spotify.com/track/${String(t.uri).split(':').pop()}` : null,
    })),
  };
}

async function resolveSpotify(rawUrl) {
  const { type, id } = parseSpotifyUrl(rawUrl);
  if (type === 'episode' || type === 'show') {
    throw new Error('Spotify podcasts are not supported.');
  }

  const token = await spotifyToken();
  if (token) {
    try {
      return await spotifyViaApi(type, id, token);
    } catch (err) {
      log.warn(`Spotify API call failed (${err.message}); trying the public embed.`);
    }
  }
  return spotifyViaEmbed(type, id);
}

/* ──────────────────────────── Apple Music ──────────────────────────── */

function isoDurationToSeconds(iso) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$/.exec(String(iso ?? ''));
  if (!m) return null;
  return Math.round((Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0));
}

function collectJsonLd(html) {
  const blocks = [];
  const re = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim());
      blocks.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    } catch { /* skip malformed block */ }
  }
  return blocks;
}

const metaTag = (html, property) => {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i');
  const m = re.exec(html);
  return m ? m[1] : null;
};

const artistNames = (byArtist) => {
  if (!byArtist) return [];
  const list = Array.isArray(byArtist) ? byArtist : [byArtist];
  return list.map((a) => (typeof a === 'string' ? a : a?.name)).filter(Boolean);
};

async function resolveAppleMusic(rawUrl) {
  const url = new URL(rawUrl);
  const html = await httpGet(url.toString());
  const blocks = collectJsonLd(html);
  const cover = (metaTag(html, 'og:image') ?? '').replace(/\/\d+x\d+[a-z]*\.jpg$/i, '/1000x1000bb.jpg') || null;

  const album = blocks.find((b) => b['@type'] === 'MusicAlbum');
  const song = blocks.find((b) => b['@type'] === 'MusicRecording');
  const playlist = blocks.find((b) => b['@type'] === 'MusicPlaylist');

  // A specific song inside an album page: ...album/name/id?i=trackId
  const wantsSingleTrack = url.searchParams.has('i') || Boolean(song && !album);

  if (album) {
    const rawTracks = Array.isArray(album.tracks) ? album.tracks : [];
    const year = String(album.datePublished ?? '').slice(0, 4) || null;
    const albumArtists = artistNames(album.byArtist);

    const tracks = rawTracks.map((t, i) => ({
      title: t.name,
      artists: artistNames(t.byArtist).length ? artistNames(t.byArtist) : albumArtists,
      album: album.name ?? null,
      cover,
      durationSec: isoDurationToSeconds(t.duration),
      trackNumber: i + 1,
      year,
      sourceUrl: t.url ?? rawUrl,
    })).filter((t) => t.title);

    if (wantsSingleTrack && tracks.length) {
      const target = url.searchParams.get('i');
      const picked = tracks.find((t) => target && String(t.sourceUrl).includes(target)) ?? tracks[0];
      return { kind: 'track', name: picked.title, subtitle: picked.artists.join(', '), cover, tracks: [picked] };
    }

    if (tracks.length) {
      return {
        kind: 'album',
        name: album.name,
        subtitle: albumArtists.join(', ') || 'Album',
        cover,
        tracks: tracks.slice(0, config.maxPlaylistItems),
      };
    }
  }

  if (song) {
    return {
      kind: 'track',
      name: song.name,
      subtitle: artistNames(song.byArtist).join(', '),
      cover,
      tracks: [{
        title: song.name,
        artists: artistNames(song.byArtist),
        album: song.inAlbum?.name ?? null,
        cover,
        durationSec: isoDurationToSeconds(song.duration),
        trackNumber: null,
        year: String(song.datePublished ?? '').slice(0, 4) || null,
        sourceUrl: rawUrl,
      }],
    };
  }

  if (playlist) {
    const rawTracks = Array.isArray(playlist.track) ? playlist.track : [];
    const tracks = rawTracks.map((t) => ({
      title: t.name,
      artists: artistNames(t.byArtist),
      album: null,
      cover,
      durationSec: isoDurationToSeconds(t.duration),
      trackNumber: null,
      year: null,
      sourceUrl: t.url ?? rawUrl,
    })).filter((t) => t.title);

    if (tracks.length) {
      return {
        kind: 'playlist',
        name: playlist.name ?? 'Apple Music playlist',
        subtitle: 'Playlist',
        cover,
        tracks: tracks.slice(0, config.maxPlaylistItems),
      };
    }
  }

  // Last resort: the page's social preview tags.
  const ogTitle = metaTag(html, 'og:title');
  if (ogTitle) {
    const [title, artist] = ogTitle.split(/\s+by\s+/i);
    return {
      kind: 'track',
      name: title.trim(),
      subtitle: (artist ?? '').trim(),
      cover,
      degraded: true,
      tracks: [{
        title: title.trim(),
        artists: artist ? [artist.trim()] : [],
        album: null,
        cover,
        durationSec: null,
        trackNumber: null,
        year: null,
        sourceUrl: rawUrl,
      }],
    };
  }

  throw new Error('Could not read that Apple Music link.');
}

/* ─────────────────────────── Public surface ─────────────────────────── */

/**
 * Resolves a catalogue link to a normalised track list.
 * @returns {Promise<{kind:string,name:string,subtitle:string,cover:string|null,tracks:object[]}>}
 */
export async function resolveCatalog(analysis) {
  const result =
    analysis.platform === 'spotify'
      ? await resolveSpotify(analysis.url)
      : await resolveAppleMusic(analysis.url);

  if (!result.tracks?.length) throw new Error('No tracks were found at that link.');
  result.tracks = result.tracks.filter((t) => t && t.title);
  return result;
}

/* ─────────────────────────── Match scoring ─────────────────────────── */

/**
 * Marketing boilerplate, matched as whole phrases.
 *
 * Deliberately *not* a bag of single words: "song", "music", "video" and
 * "audio" are ordinary title words. Stripping them individually would turn
 * "Video Games" into "games" and "Love Song" into "love", wrecking the very
 * comparison this function exists to make.
 */
const NOISE_PHRASES = [
  /\bofficial\s+(?:music\s+)?video\b/g,
  /\bofficial\s+(?:audio|lyric|lyrics|visuali[sz]er|version|hd\s+video)\b/g,
  /\blyrics?\s+video\b/g,
  /\bmusic\s+video\b/g,
  /\bvisuali[sz]er\b/g,
  /\bwith\s+lyrics\b/g,
  /\bfull\s+album\b/g,
  /\baudio\s+only\b/g,
];

/** Standalone tags that are never part of a real title. */
const NOISE_TAGS = new Set(['hd', 'hq', 'uhd', '4k', '1080p', '720p', 'mv', 'official', 'explicit']);

/** Strips punctuation, bracketed asides and marketing noise for comparison. */
function normalise(text) {
  let t = String(text ?? '').toLowerCase();
  t = t.replace(/[([{][^)\]}]*[)\]}]/g, ' ');             // (Official Video), [HD]
  for (const phrase of NOISE_PHRASES) t = t.replace(phrase, ' ');
  t = t.replace(/\bfeat\.?\b|\bft\.?\b|\bwith\b/g, ' ');
  t = t.replace(/[^\p{L}\p{N}\s]/gu, ' ');

  const words = t.split(/\s+/).filter((w) => w && !NOISE_TAGS.has(w));
  return words.join(' ').trim();
}

const tokens = (text) => new Set(normalise(text).split(' ').filter(Boolean));

function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let hits = 0;
  for (const token of a) if (b.has(token)) hits += 1;
  return hits / a.size;
}

/** Traits that must match between the wanted track and the candidate. */
const VARIANT_FLAGS = [
  ['live', /\blive\b(?!\s*(?:action|stream\s*save))/i],
  ['remix', /\bremix(?:es)?\b|\bbootleg\b|\bflip\b/i],
  ['acoustic', /\bacoustic\b|\bunplugged\b/i],
  ['instrumental', /\binstrumental\b/i],
  ['cover', /\bcover(?:ed)?\b(?!\s*art)/i],
  ['karaoke', /\bkaraoke\b|\bsing\s*along\b/i],
  ['sped', /\bsped\s*up\b|\bnightcore\b|\bslowed\b|\breverb\b|\b8d\b/i],
  ['extended', /\bextended\b|\bfull\s*length\b/i],
];

function variantSet(text) {
  const found = new Set();
  for (const [name, pattern] of VARIANT_FLAGS) if (pattern.test(text)) found.add(name);
  return found;
}

/**
 * Scores one YouTube search result against the catalogue track.
 * Returns -Infinity for candidates that must never be used.
 */
function scoreCandidate(candidate, track) {
  const title = String(candidate.title ?? '');
  const channel = String(candidate.channel ?? candidate.uploader ?? '');
  if (!title) return -Infinity;

  const duration = Number(candidate.duration);
  const target = Number(track.durationSec);

  let score = 0;

  // ── Duration: the strongest signal there is.
  if (Number.isFinite(duration) && duration > 0 && Number.isFinite(target) && target > 0) {
    const delta = Math.abs(duration - target);
    if (delta > 45) return -Infinity;          // a different recording entirely
    if (delta <= 2) score += 55;
    else if (delta <= 5) score += 45;
    else if (delta <= 10) score += 28;
    else if (delta <= 20) score += 10;
    else score -= 15;
  } else if (Number.isFinite(duration) && duration > 1800) {
    return -Infinity;                           // a full album upload or a mix
  }

  // ── Title and artist overlap.
  const wantedTitle = tokens(track.title);
  const candidateTokens = tokens(title);
  score += overlap(wantedTitle, candidateTokens) * 35;

  const artistText = (track.artists ?? []).join(' ');
  const artistTokens = tokens(artistText);
  const inTitleOrChannel = tokens(`${title} ${channel}`);
  score += overlap(artistTokens, inTitleOrChannel) * 25;

  // ── Source credibility. "- Topic" channels are label-delivered audio.
  if (/ - Topic$/i.test(channel)) score += 30;
  else if (/vevo/i.test(channel)) score += 18;
  else if (artistTokens.size && overlap(artistTokens, tokens(channel)) > 0.6) score += 14;
  if (/\bofficial\s+(audio|music\s+video)\b/i.test(title)) score += 8;
  if (/\bprovided to youtube\b/i.test(String(candidate.description ?? ''))) score += 12;

  // ── Variant discipline: only accept a live/remix/cover cut when the
  //    catalogue track is itself that variant.
  const wanted = variantSet(`${track.title} ${(track.artists ?? []).join(' ')}`);
  const got = variantSet(title);
  for (const flag of got) {
    if (!wanted.has(flag)) score -= flag === 'karaoke' || flag === 'cover' ? 70 : 45;
  }
  for (const flag of wanted) if (!got.has(flag)) score -= 20;

  if (/\breaction\b|\breview\b|\btutorial\b|\bhow to play\b|\blesson\b/i.test(title)) score -= 90;
  if (/\bmix\b|\bmegamix\b|\bmashup\b|\bcompilation\b|\bplaylist\b|\bfull album\b/i.test(title)) score -= 60;

  return score;
}

/**
 * Finds the best YouTube recording for a catalogue track.
 * @returns {Promise<{url:string,title:string,channel:string,score:number}|null>}
 */
export async function matchTrack(track, { signal } = {}) {
  const artist = (track.artists ?? [])[0] ?? '';
  const allArtists = (track.artists ?? []).join(' ');

  // Several phrasings, because one query rarely wins for every track.
  const queries = [
    `${artist} ${track.title} audio`,
    `${allArtists} ${track.title}`,
    track.album ? `${artist} ${track.title} ${track.album}` : `${artist} ${track.title} official`,
  ].filter((q) => q.trim().length > 2);

  const seen = new Map();
  for (const query of queries) {
    const results = await searchYouTube(query, 6, { signal });
    for (const entry of results) {
      const id = entry.id ?? entry.url;
      if (!id || seen.has(id)) continue;
      seen.set(id, entry);
    }
    // A confident hit on the first query means we can stop searching.
    const early = pickBest([...seen.values()], track);
    if (early && early.score >= 95) return early;
  }

  return pickBest([...seen.values()], track);
}

function pickBest(candidates, track) {
  let best = null;
  let bestScore = -Infinity;

  for (const candidate of candidates) {
    const score = scoreCandidate(candidate, track);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  if (!best || bestScore < 25) return null;

  const id = best.id ?? '';
  const url = best.url && String(best.url).startsWith('http')
    ? best.url
    : `https://www.youtube.com/watch?v=${id}`;

  return {
    url,
    title: best.title ?? '',
    channel: best.channel ?? best.uploader ?? '',
    duration: Number(best.duration) || null,
    score: Math.round(bestScore),
  };
}

export const catalogInternals = { normalise, scoreCandidate, variantSet };

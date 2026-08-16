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

async function httpGet(url, { headers = {}, timeout = 20_000, as = 'text', signal } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const relay = () => controller.abort();
  signal?.addEventListener('abort', relay, { once: true });
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
    signal?.removeEventListener('abort', relay);
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

/* ────────────────────── Free metadata enrichment ────────────────────── */

/**
 * Fills gaps using Apple's public iTunes Search API — no key, no account.
 *
 * Spotify's embed page (the path used when you have no API credentials) gives
 * a title, artist, cover and duration but no album, release year or track
 * number. Rather than making that a permanent "add credentials" nag, the same
 * facts are fetched from a source that needs no signup, and the artwork comes
 * back at 600px instead of the embed's 300px.
 *
 * Only ever *fills* — anything the catalogue already supplied is left alone.
 */
async function enrichFromAppleCatalog(track, { signal } = {}) {
  const artist = (track.artists ?? [])[0] ?? '';
  const term = `${artist} ${track.title}`.trim();
  if (term.length < 3) return track;

  let results;
  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=8`;
    const data = await httpGet(url, { as: 'json', timeout: 12_000, signal });
    results = Array.isArray(data.results) ? data.results : [];
  } catch {
    return track; // enrichment is a bonus, never a failure
  }
  if (!results.length) return track;

  const wantedTitle = tokens(track.title);
  const wantedArtist = tokens(artist);
  const target = Number(track.durationSec);

  let best = null;
  let bestScore = -Infinity;

  for (const row of results) {
    const seconds = Math.round((row.trackTimeMillis ?? 0) / 1000);
    let score = 0;

    // Duration decides between a track and its slowed/extended/remixed twin.
    if (Number.isFinite(target) && target > 0 && seconds > 0) {
      const delta = Math.abs(seconds - target);
      if (delta > 12) continue;          // a different cut of the song
      score += (12 - delta) * 4;
    }

    score += overlap(wantedTitle, tokens(row.trackName ?? '')) * 30;
    score += overlap(wantedArtist, tokens(row.artistName ?? '')) * 20;

    // A single named "<title> - Single" is a weaker album fact than a real LP.
    if (/ - single$/i.test(row.collectionName ?? '')) score -= 4;
    // Compilations and DJ mixes name the wrong album for a track.
    if (/\b(dj mix|compilation|mixed)\b/i.test(row.collectionName ?? '')) score -= 25;

    if (score > bestScore) { bestScore = score; best = row; }
  }

  if (!best || bestScore < 20) return track;

  const artwork = typeof best.artworkUrl100 === 'string'
    ? best.artworkUrl100.replace(/\/\d+x\d+bb\.jpg$/, '/600x600bb.jpg')
    : null;

  return {
    ...track,
    album: track.album ?? best.collectionName ?? null,
    year: track.year ?? String(best.releaseDate ?? '').slice(0, 4) ?? null,
    trackNumber: track.trackNumber ?? best.trackNumber ?? null,
    trackTotal: track.trackTotal ?? best.trackCount ?? null,
    genre: track.genre ?? best.primaryGenreName ?? null,
    cover: track.cover ?? artwork,
    /** Higher-resolution art than the Spotify embed hands out. */
    coverUpgrade: artwork,
    enriched: true,
  };
}

/**
 * Enriches a track list, but only where something is actually missing, and
 * only a few at a time so a 50-track playlist does not hammer the API.
 */
export async function enrichTracks(tracks, { signal } = {}) {
  const needsWork = (t) => !t.album || !t.year || !t.trackNumber;
  if (!tracks.some(needsWork)) return tracks;

  const output = [...tracks];
  const BATCH = 4;

  for (let i = 0; i < output.length; i += BATCH) {
    if (signal?.aborted) break;
    const slice = output.slice(i, i + BATCH);
    const done = await Promise.all(
      slice.map((t) => (needsWork(t) ? enrichFromAppleCatalog(t, { signal }) : Promise.resolve(t))),
    );
    for (let k = 0; k < done.length; k += 1) output[i + k] = done[k];
  }

  return output;
}

/* ─────────────────────────── Public surface ─────────────────────────── */

/**
 * Resolves a catalogue link to a normalised track list.
 * @returns {Promise<{kind:string,name:string,subtitle:string,cover:string|null,tracks:object[]}>}
 */
export async function resolveCatalog(analysis, { enrich = 'auto', signal } = {}) {
  const result =
    analysis.platform === 'spotify'
      ? await resolveSpotify(analysis.url)
      : await resolveAppleMusic(analysis.url);

  if (!result.tracks?.length) throw new Error('No tracks were found at that link.');
  result.tracks = result.tracks.filter((t) => t && t.title);

  /*
   * Fill missing album/year/track-number facts for free. On the preview path
   * this is limited to short lists so the card still appears instantly; the
   * download path enriches everything, because that is where the tags land.
   */
  const shouldEnrich = enrich === true || (enrich === 'auto' && result.tracks.length <= 12);
  if (shouldEnrich) {
    result.tracks = await enrichTracks(result.tracks, { signal });
    if (result.tracks.some((t) => t.enriched)) {
      result.degraded = false;
      result.enriched = true;
      // Prefer the 600px artwork over the embed's 300px thumbnail.
      const upgrade = result.tracks.find((t) => t.coverUpgrade)?.coverUpgrade;
      if (upgrade && result.tracks.length === 1) result.cover = upgrade;
    }
  }

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
 * Finds YouTube recordings for a catalogue track, best first.
 * @returns {Promise<Array<{url:string,title:string,channel:string,score:number}>>}
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
    const early = rankCandidates([...seen.values()], track);
    if (early[0] && early[0].score >= 95) return early;
  }

  return rankCandidates([...seen.values()], track);
}

/**
 * All viable matches, best first.
 *
 * Returning a list rather than a single winner matters: the top match is
 * regularly age-restricted, region-locked or freshly deleted, and without an
 * alternative the whole track is written off even though four other uploads of
 * the same song were sitting right behind it.
 */
function rankCandidates(candidates, track) {
  return candidates
    .map((candidate) => ({ candidate, score: scoreCandidate(candidate, track) }))
    .filter(({ score }) => score >= 25)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ candidate, score }) => {
      const id = candidate.id ?? '';
      const url = candidate.url && String(candidate.url).startsWith('http')
        ? candidate.url
        : `https://www.youtube.com/watch?v=${id}`;

      return {
        url,
        title: candidate.title ?? '',
        channel: candidate.channel ?? candidate.uploader ?? '',
        duration: Number(candidate.duration) || null,
        score: Math.round(score),
      };
    });
}

export const catalogInternals = { normalise, scoreCandidate, variantSet, rankCandidates };

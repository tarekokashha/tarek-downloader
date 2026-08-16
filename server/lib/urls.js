/**
 * URL parsing, platform identification and safety checks.
 *
 * Everything the user pastes flows through `analyseUrl()` before it reaches
 * yt-dlp, so this is the security boundary: it rejects non-HTTP schemes and
 * anything pointing at a private network (SSRF protection).
 */

/**
 * Known platforms. `accent` drives the UI's colour shift when a link is
 * detected — the interface takes on the colour of the service you pasted.
 * `catalog: true` means the audio is DRM-locked and must be sourced by
 * metadata matching rather than downloaded directly.
 */
export const PLATFORMS = {
  youtube: {
    id: 'youtube',
    name: 'YouTube',
    accent: '#FF2D46',
    hosts: ['youtube.com', 'youtu.be', 'youtube-nocookie.com', 'yt.be'],
  },
  tiktok: {
    id: 'tiktok',
    name: 'TikTok',
    accent: '#25F4EE',
    hosts: ['tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'],
    /** Photo posts are slideshows: several images plus the backing track. */
    carousel: true,
    /** TikTok bot-checks anonymous requests; a session usually fixes it. */
    prefersCookies: true,
  },
  instagram: {
    id: 'instagram',
    name: 'Instagram',
    accent: '#E1306C',
    hosts: ['instagram.com', 'instagr.am', 'ddinstagram.com'],
    /** A single post can hold up to 20 photos and videos. */
    carousel: true,
    /** Instagram serves almost nothing to logged-out clients any more. */
    requiresCookies: true,
  },
  spotify: { id: 'spotify', name: 'Spotify', accent: '#1DB954', hosts: ['spotify.com', 'spotify.link'], catalog: true },
  appleMusic: { id: 'appleMusic', name: 'Apple Music', accent: '#FA2D48', hosts: ['music.apple.com'], catalog: true },
  soundcloud: { id: 'soundcloud', name: 'SoundCloud', accent: '#FF5500', hosts: ['soundcloud.com', 'snd.sc', 'on.soundcloud.com'] },
  x: { id: 'x', name: 'X', accent: '#E7E9EA', hosts: ['twitter.com', 'x.com', 't.co', 'fxtwitter.com', 'vxtwitter.com'] },
  facebook: { id: 'facebook', name: 'Facebook', accent: '#0866FF', hosts: ['facebook.com', 'fb.watch', 'fb.com'] },
  reddit: { id: 'reddit', name: 'Reddit', accent: '#FF4500', hosts: ['reddit.com', 'redd.it', 'v.redd.it'] },
  vimeo: { id: 'vimeo', name: 'Vimeo', accent: '#00ADEF', hosts: ['vimeo.com'] },
  twitch: { id: 'twitch', name: 'Twitch', accent: '#9146FF', hosts: ['twitch.tv', 'clips.twitch.tv'] },
  pinterest: { id: 'pinterest', name: 'Pinterest', accent: '#E60023', hosts: ['pinterest.com', 'pin.it'] },
  dailymotion: { id: 'dailymotion', name: 'Dailymotion', accent: '#0066DC', hosts: ['dailymotion.com', 'dai.ly'] },
  snapchat: { id: 'snapchat', name: 'Snapchat', accent: '#FFFC00', hosts: ['snapchat.com'] },
  threads: { id: 'threads', name: 'Threads', accent: '#E8E8E8', hosts: ['threads.net', 'threads.com'] },
  linkedin: { id: 'linkedin', name: 'LinkedIn', accent: '#0A66C2', hosts: ['linkedin.com', 'lnkd.in'] },
  tumblr: { id: 'tumblr', name: 'Tumblr', accent: '#00CF35', hosts: ['tumblr.com'] },
  bandcamp: { id: 'bandcamp', name: 'Bandcamp', accent: '#629AA9', hosts: ['bandcamp.com'] },
  mixcloud: { id: 'mixcloud', name: 'Mixcloud', accent: '#5000FF', hosts: ['mixcloud.com'] },
  bilibili: { id: 'bilibili', name: 'Bilibili', accent: '#00A1D6', hosts: ['bilibili.com', 'b23.tv'] },
  vk: { id: 'vk', name: 'VK', accent: '#0077FF', hosts: ['vk.com', 'vkvideo.ru'] },
  odysee: { id: 'odysee', name: 'Odysee', accent: '#EF1970', hosts: ['odysee.com'] },
  rumble: { id: 'rumble', name: 'Rumble', accent: '#85C742', hosts: ['rumble.com'] },
  generic: { id: 'generic', name: 'Link', accent: '#D9F24B', hosts: [] },
};

/** Platforms shown as chips under the search bar, in display order. */
export const FEATURED_PLATFORMS = [
  'youtube', 'tiktok', 'instagram', 'spotify', 'soundcloud',
  'x', 'facebook', 'reddit', 'twitch', 'vimeo', 'pinterest', 'appleMusic',
].map((id) => ({
  id,
  name: PLATFORMS[id].name,
  accent: PLATFORMS[id].accent,
}));

/**
 * The full detection table, shipped to the browser so the platform badge and
 * accent colour react as you type — no round trip.
 */
export const DETECTION_TABLE = Object.values(PLATFORMS)
  .filter((p) => p.hosts.length > 0)
  .map(({ id, name, accent, hosts, catalog }) => ({
    id, name, accent, hosts, catalog: Boolean(catalog),
  }));

/** Hosts that resolve to a private network are never fetched. */
const BLOCKED_HOSTNAMES = new Set([
  'localhost', 'localhost.localdomain', '127.0.0.1', '0.0.0.0', '::1', '[::1]',
  'metadata.google.internal', 'instance-data',
]);

function isPrivateIPv4(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = m.slice(1).map(Number);
  if (m.slice(1).some((n) => Number(n) > 255)) return true; // malformed → refuse
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  return false;
}

function isPrivateIPv6(host) {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === '::' || h === '::1') return true;
  return /^(fc|fd|fe80)/.test(h); // unique-local + link-local
}

/**
 * Turns raw user input into a validated URL, or throws a message that is safe
 * to show in the UI.
 */
export function parseUrl(input) {
  if (typeof input !== 'string') throw new Error('No link provided.');
  let text = input.trim();
  if (!text) throw new Error('No link provided.');
  if (text.length > 2048) throw new Error('That link is too long.');

  // Be forgiving: people paste "youtube.com/watch?v=..." without a scheme.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = `https://${text}`;

  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error("That doesn't look like a valid link.");
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https links are supported.');
  }

  const host = url.hostname.toLowerCase();
  if (
    BLOCKED_HOSTNAMES.has(host) ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.localhost') ||
    isPrivateIPv4(host) ||
    isPrivateIPv6(host)
  ) {
    throw new Error('That address points at a private network and was blocked.');
  }

  // Strip tracking noise that confuses some extractors.
  for (const junk of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid']) {
    url.searchParams.delete(junk);
  }

  return rewriteForExtractor(url);
}

/**
 * Small, safe path rewrites for links whose canonical share form the extractor
 * does not recognise. Both of these serve identical content on the target path.
 */
function rewriteForExtractor(url) {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');

  // TikTok's share sheet hands out /photo/ links for slideshow posts, which
  // yt-dlp rejects outright as an unsupported URL. /video/ serves the same post.
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) {
    url.pathname = url.pathname.replace(/^\/(@[^/]+)\/photo\//, '/$1/video/');
  }

  // Instagram uses /reels/<id>/ in some surfaces and /reel/<id>/ in others.
  if (host === 'instagram.com' || host.endsWith('.instagram.com')) {
    url.pathname = url.pathname.replace(/^\/reels\/([^/]+)/, '/reel/$1');
  }

  return url;
}

function matchPlatform(hostname) {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  for (const platform of Object.values(PLATFORMS)) {
    for (const candidate of platform.hosts) {
      if (host === candidate || host.endsWith(`.${candidate}`)) return platform;
    }
  }
  return PLATFORMS.generic;
}

/**
 * Detects whether a link addresses a collection (playlist / album / channel)
 * rather than one item, and whether it merely *contains* a playlist reference.
 */
function describeCollection(url, platform) {
  const p = url.pathname.toLowerCase();

  if (platform.id === 'youtube') {
    if (p.startsWith('/playlist')) return { isCollection: true, kind: 'playlist' };
    if (/^\/(@[^/]+|channel|c|user)\b/.test(p)) return { isCollection: true, kind: 'channel' };
    if (url.searchParams.has('list')) return { isCollection: false, kind: 'video', embeddedPlaylist: true };
    return { isCollection: false, kind: 'video' };
  }

  if (platform.id === 'spotify') {
    if (/\/(playlist|album)\//.test(p)) return { isCollection: true, kind: p.includes('/album/') ? 'album' : 'playlist' };
    if (/\/artist\//.test(p)) return { isCollection: true, kind: 'artist' };
    return { isCollection: false, kind: 'track' };
  }

  if (platform.id === 'appleMusic') {
    if (/\/(playlist|album)\//.test(p) && !url.searchParams.has('i')) {
      return { isCollection: true, kind: p.includes('/album/') ? 'album' : 'playlist' };
    }
    return { isCollection: false, kind: 'track' };
  }

  if (platform.id === 'soundcloud') {
    if (/\/sets\//.test(p)) return { isCollection: true, kind: 'playlist' };
    return { isCollection: false, kind: 'track' };
  }

  if (platform.id === 'tiktok') {
    if (/\/(playlist|collection)\//.test(p)) return { isCollection: true, kind: 'playlist' };
    // Note: /photo/ links are rewritten to /video/ by rewriteForExtractor
    // before this runs, so slideshow posts arrive here as videos.
    if (/\/video\//.test(p)) return { isCollection: false, kind: 'video' };
    // A bare /@handle is the whole account.
    if (/^\/@[^/]+\/?$/.test(p)) return { isCollection: true, kind: 'account' };
    return { isCollection: false, kind: 'video' };
  }

  if (platform.id === 'instagram') {
    if (/^\/stories\//.test(p)) return { isCollection: true, kind: 'stories' };
    // Posts and reels may be carousels holding several photos or clips.
    if (/^\/(p|reel|reels|tv)\//.test(p)) {
      return { isCollection: false, kind: p.startsWith('/p/') ? 'post' : 'reel', carousel: true };
    }
    // A bare /username/ is the account grid.
    if (/^\/[^/]+\/?$/.test(p) && !/^\/(explore|accounts|direct)\b/.test(p)) {
      return { isCollection: true, kind: 'account' };
    }
    return { isCollection: false, kind: 'post', carousel: true };
  }

  return { isCollection: false, kind: 'media' };
}

/**
 * Full analysis of a pasted link. Throws on anything unsafe or unusable.
 */
export function analyseUrl(input) {
  const url = parseUrl(input);
  const platform = matchPlatform(url.hostname);
  const collection = describeCollection(url, platform);

  return {
    url: url.toString(),
    hostname: url.hostname.replace(/^www\./, ''),
    platform: platform.id,
    platformName: platform.name,
    accent: platform.accent,
    /** DRM-locked catalogue service: metadata is read, audio is matched. */
    isCatalog: Boolean(platform.catalog),
    isCollection: collection.isCollection,
    collectionKind: collection.kind,
    /** A single video that also belongs to a playlist. */
    embeddedPlaylist: Boolean(collection.embeddedPlaylist),
    /**
     * The link may hold several media items behind one URL (an Instagram
     * carousel, a TikTok photo slideshow). These must be resolved with
     * playlist extraction on, or only the first item is ever fetched.
     */
    carousel: Boolean(collection.carousel ?? platform.carousel),
    /** Sign-in expectations, surfaced in the UI before a download fails. */
    requiresCookies: Boolean(platform.requiresCookies),
    prefersCookies: Boolean(platform.prefersCookies || platform.requiresCookies),
  };
}

/** Best-effort quick detection for the browser's live badge. Never throws. */
export function peekPlatform(input) {
  try {
    return analyseUrl(input);
  } catch {
    return null;
  }
}

/**
 * Unit tests for the logic Stash owns.
 *
 * Everything here runs offline against synthetic data — the goal is to pin
 * down the decisions we make about yt-dlp's output, not to re-test yt-dlp.
 *
 *   npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { analyseUrl, parseUrl, peekPlatform } from '../server/lib/urls.js';
import { buildFormatOptions, bestThumbnail, AUDIO_SOURCE_SELECTOR, audioPreset } from '../server/lib/formats.js';
import { safeFilename, isSafeChildPath, formatBytes } from '../server/lib/media.js';
import { parseTimecode } from '../server/lib/pipeline.js';
import { catalogInternals } from '../server/lib/catalog.js';
import { friendlyError } from '../server/lib/ytdlp.js';
import { originAllowed } from '../server/lib/cors.js';

/* ═══════════════════════════ URL safety ═══════════════════════════ */

test('accepts links with and without a scheme', () => {
  assert.equal(parseUrl('https://youtu.be/abc').hostname, 'youtu.be');
  assert.equal(parseUrl('youtube.com/watch?v=x').protocol, 'https:');
  assert.equal(parseUrl('  https://vimeo.com/1  ').hostname, 'vimeo.com');
});

test('rejects non-http schemes', () => {
  for (const bad of ['file:///etc/passwd', 'ftp://x.com/a', 'javascript:alert(1)', 'data:text/html,x']) {
    assert.throws(() => parseUrl(bad), /only http|valid link/i, `should reject ${bad}`);
  }
});

test('blocks private and loopback addresses (SSRF)', () => {
  const blocked = [
    'http://localhost/x', 'http://127.0.0.1/x', 'http://0.0.0.0/x',
    'http://10.1.2.3/x', 'http://192.168.0.5/x', 'http://172.16.0.1/x',
    'http://172.31.255.254/x', 'http://169.254.169.254/latest/meta-data',
    'http://100.64.0.1/x', 'http://[::1]/x', 'http://[fd00::1]/x',
    'http://printer.local/x', 'http://api.internal/x',
    'http://metadata.google.internal/computeMetadata/v1/',
  ];
  for (const url of blocked) {
    assert.throws(() => parseUrl(url), /private network/i, `should block ${url}`);
  }
});

test('allows public addresses that merely look similar', () => {
  for (const url of ['http://172.32.0.1/x', 'http://11.0.0.1/x', 'http://192.169.0.1/x']) {
    assert.doesNotThrow(() => parseUrl(url), `should allow ${url}`);
  }
});

test('strips tracking parameters but keeps meaningful ones', () => {
  const url = parseUrl('https://www.youtube.com/watch?v=abc&list=PL1&utm_source=x&fbclid=y');
  assert.equal(url.searchParams.get('v'), 'abc');
  assert.equal(url.searchParams.get('list'), 'PL1');
  assert.equal(url.searchParams.get('utm_source'), null);
  assert.equal(url.searchParams.get('fbclid'), null);
});

test('identifies platforms including subdomains and short links', () => {
  const cases = [
    ['https://youtu.be/x', 'youtube'],
    ['https://m.youtube.com/watch?v=x', 'youtube'],
    ['https://music.youtube.com/watch?v=x', 'youtube'],
    ['https://vm.tiktok.com/ZM123/', 'tiktok'],
    ['https://www.instagram.com/reel/abc/', 'instagram'],
    ['https://open.spotify.com/track/abc', 'spotify'],
    ['https://music.apple.com/us/album/x/1?i=2', 'appleMusic'],
    ['https://x.com/user/status/1', 'x'],
    ['https://twitter.com/user/status/1', 'x'],
    ['https://example.org/video.mp4', 'generic'],
  ];
  for (const [url, expected] of cases) {
    assert.equal(analyseUrl(url).platform, expected, url);
  }
});

test('distinguishes collections from single items', () => {
  assert.equal(analyseUrl('https://www.youtube.com/playlist?list=PL1').isCollection, true);
  assert.equal(analyseUrl('https://www.youtube.com/@someone').isCollection, true);
  assert.equal(analyseUrl('https://open.spotify.com/album/x').isCollection, true);
  assert.equal(analyseUrl('https://open.spotify.com/track/x').isCollection, false);

  // A video that merely belongs to a playlist stays a single item.
  const embedded = analyseUrl('https://www.youtube.com/watch?v=abc&list=PL1');
  assert.equal(embedded.isCollection, false);
  assert.equal(embedded.embeddedPlaylist, true);
});

test('Instagram posts and reels are treated as possible carousels', () => {
  for (const url of [
    'https://www.instagram.com/p/Cabc123/',
    'https://www.instagram.com/reel/Cxyz789/',
    'https://www.instagram.com/tv/Cdef456/',
  ]) {
    const a = analyseUrl(url);
    assert.equal(a.carousel, true, `${url} must resolve with playlist extraction`);
    assert.equal(a.isCollection, false, `${url} should still present as one post`);
    assert.equal(a.requiresCookies, true);
  }
});

test('Instagram profiles and stories are collections', () => {
  assert.equal(analyseUrl('https://www.instagram.com/nasa/').isCollection, true);
  assert.equal(analyseUrl('https://www.instagram.com/stories/nasa/').isCollection, true);
  assert.equal(analyseUrl('https://www.instagram.com/stories/nasa/').collectionKind, 'stories');
});

test('TikTok /photo/ slideshow links are rewritten to /video/', () => {
  // yt-dlp does not match /photo/ at all and rejects it as an unsupported URL,
  // but TikTok serves the identical post under /video/.
  const photo = analyseUrl('https://www.tiktok.com/@user/photo/7123456789');
  assert.equal(photo.url, 'https://www.tiktok.com/@user/video/7123456789');
  assert.equal(photo.carousel, true, 'a slideshow holds several images');

  const video = analyseUrl('https://www.tiktok.com/@user/video/7123456789');
  assert.equal(video.collectionKind, 'video');
  assert.equal(video.isCollection, false);

  const account = analyseUrl('https://www.tiktok.com/@user');
  assert.equal(account.isCollection, true);
  assert.equal(account.collectionKind, 'account');
});

test('Instagram /reels/ is normalised to /reel/', () => {
  assert.equal(
    analyseUrl('https://www.instagram.com/reels/DAbc123/').url,
    'https://www.instagram.com/reel/DAbc123/',
  );
});

test('path rewrites never touch unrelated hosts', () => {
  assert.equal(
    analyseUrl('https://example.com/@user/photo/123').url,
    'https://example.com/@user/photo/123',
  );
});

test('TikTok and Instagram are flagged as wanting a session', () => {
  assert.equal(analyseUrl('https://www.tiktok.com/@u/video/1').prefersCookies, true);
  assert.equal(analyseUrl('https://www.instagram.com/p/x/').prefersCookies, true);
  assert.equal(analyseUrl('https://www.youtube.com/watch?v=x').prefersCookies, false);
});

test('flags DRM catalogue services', () => {
  assert.equal(analyseUrl('https://open.spotify.com/track/x').isCatalog, true);
  assert.equal(analyseUrl('https://music.apple.com/us/album/x').isCatalog, true);
  assert.equal(analyseUrl('https://www.youtube.com/watch?v=x').isCatalog, false);
});

test('peekPlatform never throws on junk', () => {
  for (const junk of ['', '   ', 'not a url', 'http://', '::::', null, undefined, 12345]) {
    assert.doesNotThrow(() => peekPlatform(junk));
  }
  assert.equal(peekPlatform('http://localhost/x'), null);
});

/* ═══════════════════════ Format selection ═══════════════════════ */

const fmt = (o) => ({ acodec: 'none', vcodec: 'none', ext: 'mp4', ...o });

test('never offers a watermarked TikTok stream', () => {
  const info = {
    duration: 15,
    formats: [
      fmt({ format_id: 'download_addr-0', vcodec: 'h264', height: 1024, tbr: 2000, ext: 'mp4', acodec: 'aac' }),
      fmt({ format_id: 'h264_540p_988392-0', vcodec: 'h264', height: 1024, tbr: 1800, ext: 'mp4', acodec: 'aac' }),
      fmt({ format_id: 'play_addr-1', vcodec: 'h264', height: 576, tbr: 900, ext: 'mp4', acodec: 'aac', format_note: 'watermarked' }),
    ],
  };

  const { video } = buildFormatOptions(info, { container: 'mp4' });
  const selectors = video.map((v) => v.selector).join(' ');
  assert.ok(!selectors.includes('download_addr'), 'watermarked download_addr must not be offered');
  assert.ok(!selectors.includes('play_addr-1'), 'format flagged "watermarked" must not be offered');
  assert.ok(selectors.includes('h264_540p_988392-0'), 'clean stream should be selected');
});

test('a format described as "no watermark" is kept, not filtered', () => {
  // The filter matched the bare substring, so labelling a clean stream
  // "no watermark" caused it to be thrown away — the fallback resolver then
  // offered no download options at all.
  const info = {
    duration: 101,
    formats: [
      fmt({ format_id: 'clean', vcodec: 'h264', acodec: 'aac', height: 1024, tbr: 1500, format_note: 'no watermark' }),
    ],
  };
  const { video } = buildFormatOptions(info, { container: 'mp4' });
  assert.equal(video.length, 1, 'the clean stream must survive the watermark filter');
  assert.match(video[0].selector, /^clean/);

  for (const note of ['without watermark', 'non-watermarked', 'unwatermarked']) {
    const one = buildFormatOptions({
      duration: 10,
      formats: [fmt({ format_id: 'x', vcodec: 'h264', acodec: 'aac', height: 720, tbr: 900, format_note: note })],
    }, { container: 'mp4' });
    assert.equal(one.video.length, 1, `"${note}" must not be treated as watermarked`);
  }

  // And a genuinely watermarked one is still rejected.
  const branded = buildFormatOptions({
    duration: 10,
    formats: [fmt({ format_id: 'y', vcodec: 'h264', acodec: 'aac', height: 720, tbr: 900, format_note: 'watermarked' })],
  }, { container: 'mp4' });
  assert.equal(branded.video.length, 0);
});

test('pairs video with a stereo audio track, never 5.1', () => {
  const info = {
    duration: 600,
    formats: [
      fmt({ format_id: '137', vcodec: 'avc1.640028', height: 1080, tbr: 3000, filesize: 200e6 }),
      fmt({ format_id: '140', acodec: 'mp4a.40.2', ext: 'm4a', abr: 129, audio_channels: 2, filesize: 10e6 }),
      fmt({ format_id: '258', acodec: 'mp4a.40.2', ext: 'm4a', abr: 387, audio_channels: 6, filesize: 30e6 }),
    ],
  };

  const { video } = buildFormatOptions(info, { container: 'mp4' });
  assert.match(video[0].selector, /^137\+140\b/, 'must pair with the stereo track');
  assert.ok(!video[0].selector.startsWith('137+258'), 'must not pair with the 5.1 track');
});

test('estimated sizes increase with resolution', () => {
  const info = {
    duration: 635,
    formats: [
      fmt({ format_id: '160', vcodec: 'avc1', height: 144, tbr: 55, filesize: 4.3e6 }),
      fmt({ format_id: '133', vcodec: 'avc1', height: 240, tbr: 118, filesize: 9.3e6 }),
      fmt({ format_id: '134', vcodec: 'avc1', height: 360, tbr: 231, filesize: 18.3e6 }),
      fmt({ format_id: '18', vcodec: 'avc1', acodec: 'mp4a', height: 360, tbr: 360, filesize_approx: 28.5e6 }),
      fmt({ format_id: '135', vcodec: 'avc1', height: 480, tbr: 356, filesize: 28.2e6 }),
      fmt({ format_id: '140', acodec: 'mp4a.40.2', ext: 'm4a', abr: 129, audio_channels: 2, filesize: 10.2e6 }),
    ],
  };

  const { video } = buildFormatOptions(info, { container: 'mp4' });
  const bySize = [...video].sort((a, b) => a.height - b.height);
  for (let i = 1; i < bySize.length; i += 1) {
    assert.ok(
      bySize[i].size >= bySize[i - 1].size,
      `${bySize[i].label} (${bySize[i].size}) should not be smaller than ${bySize[i - 1].label} (${bySize[i - 1].size})`,
    );
  }
});

test('prefers adaptive video over legacy progressive at the same height', () => {
  const info = {
    duration: 600,
    formats: [
      fmt({ format_id: '134', vcodec: 'avc1', height: 360, tbr: 231, filesize: 18e6 }),
      fmt({ format_id: '18', vcodec: 'avc1', acodec: 'mp4a', height: 360, tbr: 360, abr: 96, filesize_approx: 28e6 }),
      fmt({ format_id: '140', acodec: 'mp4a.40.2', ext: 'm4a', abr: 129, audio_channels: 2, filesize: 10e6 }),
    ],
  };
  const { video } = buildFormatOptions(info, { container: 'mp4' });
  assert.match(video[0].selector, /^134\+140\b/);
});

test('prefers H.264 for MP4 and VP9 for WebM', () => {
  const info = {
    duration: 100,
    formats: [
      fmt({ format_id: 'avc', vcodec: 'avc1.4d401f', height: 1080, tbr: 3000 }),
      fmt({ format_id: 'vp9', vcodec: 'vp9', ext: 'webm', height: 1080, tbr: 2100 }),
      fmt({ format_id: 'av1', vcodec: 'av01.0.09M.08', height: 1080, tbr: 1500 }),
      fmt({ format_id: 'aud', acodec: 'mp4a.40.2', ext: 'm4a', abr: 128, audio_channels: 2 }),
    ],
  };
  assert.match(buildFormatOptions(info, { container: 'mp4' }).video[0].selector, /^avc\+/);
  assert.match(buildFormatOptions(info, { container: 'webm' }).video[0].selector, /^vp9\+/);
});

test('odd resolutions snap onto a familiar rung', () => {
  const info = {
    duration: 15,
    formats: [fmt({ format_id: 'a', vcodec: 'h264', acodec: 'aac', height: 1024, tbr: 2000 })],
  };
  const { video } = buildFormatOptions(info, { container: 'mp4' });
  assert.equal(video[0].label, '1080p');
  assert.equal(video[0].actualHeight, 1024);
});

test('marks audio presets that exceed the source bitrate', () => {
  const info = {
    duration: 300,
    formats: [
      fmt({ format_id: 'v', vcodec: 'avc1', height: 720, tbr: 1000 }),
      fmt({ format_id: 'a', acodec: 'mp4a.40.2', ext: 'm4a', abr: 128, audio_channels: 2 }),
    ],
  };
  const { audio } = buildFormatOptions(info, { container: 'mp4' });
  assert.ok(audio.find((a) => a.id === 'mp3-320').note, '320 kbps should be flagged against a 128 kbps source');
  assert.equal(audio.find((a) => a.id === 'mp3-128').note, null, '128 kbps needs no warning');
});

test('audio source selector puts reliable stereo AAC first', () => {
  const chain = AUDIO_SOURCE_SELECTOR.split('/');
  assert.equal(chain[0], 'ba[ext=m4a][audio_channels<=2]');
  assert.ok(chain.length >= 5, 'needs fallbacks for sites without m4a');
  assert.ok(AUDIO_SOURCE_SELECTOR.includes('bestaudio/best'), 'must end with a catch-all');
});

test('audioPreset falls back to a sane default', () => {
  assert.equal(audioPreset('mp3-320').format, 'mp3');
  assert.equal(audioPreset('nonsense').id, 'mp3-320');
  assert.equal(audioPreset(undefined).id, 'mp3-320');
});

test('bestThumbnail picks the largest available image', () => {
  assert.equal(bestThumbnail({ thumbnail: 'https://a/x.jpg' }), 'https://a/x.jpg');
  assert.equal(
    bestThumbnail({
      thumbnails: [
        { url: 'small', width: 120, height: 90 },
        { url: 'big', width: 1920, height: 1080 },
        { url: 'mid', width: 640, height: 480 },
      ],
    }),
    'big',
  );
  assert.equal(bestThumbnail({}), null);
});

test('handles media with no formats at all', () => {
  const { video, audio, hasVideo } = buildFormatOptions({ duration: 0, formats: [] }, {});
  assert.equal(video.length, 0);
  assert.equal(hasVideo, false);
  assert.ok(audio.length > 0, 'audio presets are always offered');
});

/* ═════════════════════════ Filenames ═════════════════════════ */

test('sanitises filenames for Windows', () => {
  assert.equal(safeFilename('a/b\\c:d*e?f"g<h>i|j'), 'a b c d e f g h i j');
  assert.equal(safeFilename('trailing dots...'), 'trailing dots');
  assert.equal(safeFilename('  spaced  out  '), 'spaced out');
  assert.equal(safeFilename(''), 'download');
  assert.equal(safeFilename(null, 'fallback'), 'fallback');
  assert.equal(safeFilename('CON'), '_CON');
  assert.equal(safeFilename('lpt1'), '_lpt1');
  assert.ok(safeFilename('x'.repeat(400)).length <= 120);
});

test('keeps unicode titles intact', () => {
  assert.equal(safeFilename('日本語のタイトル'), '日本語のタイトル');
  assert.equal(safeFilename('Café — Naïve'), 'Café — Naïve');
});

test('strips control characters', () => {
  const dirty = `bad${String.fromCharCode(0)}name${String.fromCharCode(9)}here${String.fromCharCode(31)}`;
  const clean = safeFilename(dirty);
  assert.ok(!/[\u0000-\u001f]/.test(clean), 'no control characters may survive');
});

test('rejects path traversal when serving files', () => {
  const base = process.platform === 'win32' ? 'C:\\downloads\\job1' : '/downloads/job1';
  assert.equal(isSafeChildPath(base, 'video.mp4'), true);
  assert.equal(isSafeChildPath(base, '../job2/secret.mp4'), false);
  assert.equal(isSafeChildPath(base, '../../etc/passwd'), false);
  assert.equal(isSafeChildPath(base, 'nested/../video.mp4'), true);
});

test('formatBytes is readable', () => {
  assert.equal(formatBytes(0), null);
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(15.15 * 1048576), '15.2 MB');
});

/* ═════════════════════════ Timecodes ═════════════════════════ */

test('parses clip timecodes in every common shape', () => {
  assert.equal(parseTimecode('90'), 90);
  assert.equal(parseTimecode('1:30'), 90);
  assert.equal(parseTimecode('00:01:30'), 90);
  assert.equal(parseTimecode('1:00:00'), 3600);
  assert.equal(parseTimecode('12.5'), 12.5);
  assert.equal(parseTimecode(''), null);
  assert.equal(parseTimecode(null), null);
  assert.equal(parseTimecode('abc'), null);
  assert.equal(parseTimecode('-5'), null);
});

/* ═══════════════════ Error messages ═══════════════════ */

test('TikTok bot-check becomes an actionable message', () => {
  const raw = 'ERROR: [TikTok] 7674335694810123533: Unexpected response from webpage request; please report this issue';
  const generic = friendlyError(raw, 1);
  const specific = friendlyError(raw, 1, 'tiktok');

  assert.match(specific, /bot check/i);
  assert.match(specific, /cookies\.txt|Sign in to sites/i);
  assert.notEqual(specific, generic, 'platform context must change the advice');
});

test('Instagram extraction failure explains the sign-in requirement', () => {
  const raw = 'ERROR: [instagram:user] nasa: Unable to extract data; please report this issue';
  const message = friendlyError(raw, 1, 'instagram');
  assert.match(message, /logged-out|signed in/i);
  assert.match(message, /cookies\.txt|Sign in to sites/i);
});

test('never advises reading Chrome cookies — Chrome 127+ makes that impossible', () => {
  // App-Bound Encryption ties the key to the Chrome process. Telling someone
  // to "close Chrome and use COOKIES_FROM_BROWSER" sends them in circles,
  // which is exactly what happened before this was fixed.
  const cases = [
    ['ERROR: [TikTok] 1: Unexpected response from webpage request', 'tiktok'],
    ['ERROR: [instagram] x: Unable to extract data', 'instagram'],
    ['ERROR: Could not copy Chrome cookie database', null],
    ['WARNING: failed to decrypt with DPAPI', null],
  ];
  for (const [raw, platform] of cases) {
    const message = friendlyError(raw, 1, platform);
    assert.doesNotMatch(
      message, /COOKIES_FROM_BROWSER/,
      `must not suggest browser extraction for: ${raw}`,
    );
    assert.match(message, /cookies\.txt|Sign in to sites/i, `must offer the working route for: ${raw}`);
  }
});

test('unrelated platforms keep the generic mapping', () => {
  assert.match(friendlyError('ERROR: Private video', 1, 'tiktok'), /private/i);
  assert.match(friendlyError('ERROR: HTTP Error 429', 1, 'instagram'), /rate-limit/i);
});

test('an unrecognised error still surfaces something useful', () => {
  const message = friendlyError('ERROR: something nobody has seen before', 1);
  assert.match(message, /something nobody has seen before/);
  assert.ok(!message.includes('ERROR:'), 'the ERROR: prefix is stripped');
});

/* ═══════════════════ Catalogue match scoring ═══════════════════ */

const { scoreCandidate, normalise, variantSet, rankCandidates } = catalogInternals;

const track = { title: 'Never Gonna Give You Up', artists: ['Rick Astley'], durationSec: 213 };

test('normalise removes marketing noise and brackets', () => {
  assert.equal(normalise('Song Name (Official Music Video) [HD]'), 'song name');
  assert.equal(normalise('Artist - Title feat. Someone'), 'artist title someone');
  assert.equal(normalise('Title Official Music Video'), 'title');
  assert.equal(normalise('Title - Lyrics Video HD'), 'title');
});

test('normalise never eats real title words', () => {
  // These would all be destroyed by a naive single-word noise list.
  assert.equal(normalise('Video Games'), 'video games');
  assert.equal(normalise('Love Song'), 'love song');
  assert.equal(normalise('Music Sounds Better With You'), 'music sounds better you');
  assert.equal(normalise('The Sound of Silence'), 'the sound of silence');
  assert.equal(normalise('Songs About Jane'), 'songs about jane');
});

test('a real title containing "video" still matches its own upload', () => {
  const videoGames = { title: 'Video Games', artists: ['Lana Del Rey'], durationSec: 282 };
  const correct = { title: 'Lana Del Rey - Video Games (Official Music Video)', channel: 'LanaDelRey', duration: 282 };
  const unrelated = { title: 'Lana Del Rey - Summertime Sadness', channel: 'LanaDelRey', duration: 285 };
  assert.ok(scoreCandidate(correct, videoGames) > scoreCandidate(unrelated, videoGames));
  assert.ok(scoreCandidate(correct, videoGames) > 90, 'a clean match should score highly');
});

test('an official upload outranks a random re-upload', () => {
  const official = { title: 'Rick Astley - Never Gonna Give You Up', channel: 'Rick Astley - Topic', duration: 213 };
  const reupload = { title: 'never gonna give you up', channel: 'randomuser123', duration: 213 };
  assert.ok(scoreCandidate(official, track) > scoreCandidate(reupload, track));
});

test('a wildly different duration is rejected outright', () => {
  const wrong = { title: 'Rick Astley - Never Gonna Give You Up', channel: 'Rick Astley - Topic', duration: 700 };
  assert.equal(scoreCandidate(wrong, track), -Infinity);
});

test('a one-hour mix is never chosen', () => {
  const mix = { title: 'Never Gonna Give You Up [1 HOUR LOOP]', channel: 'loops', duration: 3600 };
  assert.equal(scoreCandidate(mix, track), -Infinity);
});

test('covers, karaoke and live cuts lose to the studio version', () => {
  const studio = { title: 'Never Gonna Give You Up', channel: 'Rick Astley - Topic', duration: 213 };
  for (const bad of ['Never Gonna Give You Up (Karaoke Version)', 'Never Gonna Give You Up (Live)',
    'Never Gonna Give You Up - Piano Cover', 'Never Gonna Give You Up (sped up)']) {
    const candidate = { title: bad, channel: 'someone', duration: 213 };
    assert.ok(
      scoreCandidate(studio, track) > scoreCandidate(candidate, track),
      `studio should beat "${bad}"`,
    );
  }
});

test('a track that IS live prefers the live recording', () => {
  const liveTrack = { title: 'Bohemian Rhapsody - Live Aid', artists: ['Queen'], durationSec: 360 };
  const live = { title: 'Queen - Bohemian Rhapsody (Live Aid 1985)', channel: 'Queen Official', duration: 360 };
  const studio = { title: 'Queen - Bohemian Rhapsody', channel: 'Queen Official', duration: 358 };
  assert.ok(scoreCandidate(live, liveTrack) > scoreCandidate(studio, liveTrack));
});

test('reaction and tutorial videos are pushed far down', () => {
  const reaction = { title: 'Never Gonna Give You Up REACTION!!', channel: 'reactor', duration: 213 };
  const plain = { title: 'Never Gonna Give You Up', channel: 'someone', duration: 213 };
  assert.ok(scoreCandidate(reaction, track) < scoreCandidate(plain, track));
});

test('a track keeps backup sources so one bad upload cannot kill it', () => {
  // The real failure: the top match was age-restricted, and because only one
  // candidate was ever returned the whole track was written off.
  const pool = [
    { id: 'a', title: 'Never Gonna Give You Up', channel: 'Rick Astley - Topic', duration: 213 },
    { id: 'b', title: 'Rick Astley - Never Gonna Give You Up', channel: 'RickAstleyVEVO', duration: 213 },
    { id: 'c', title: 'Never Gonna Give You Up', channel: 'someuploader', duration: 214 },
    { id: 'd', title: 'Totally Unrelated Song', channel: 'nobody', duration: 900 },
  ];

  const ranked = rankCandidates(pool, track);
  assert.ok(ranked.length >= 3, 'must return alternatives, not just a winner');
  assert.ok(!ranked.some((c) => c.url.includes('/watch?v=d')), 'the unrelated track is excluded');

  for (let i = 1; i < ranked.length; i += 1) {
    assert.ok(ranked[i - 1].score >= ranked[i].score, 'candidates must be ordered best first');
  }
  assert.ok(ranked.every((c) => c.url.startsWith('https://')), 'every candidate needs a usable URL');
});

test('ranking returns nothing when every option is wrong', () => {
  const pool = [
    { id: 'x', title: 'Some Other Song', channel: 'nobody', duration: 999 },
    { id: 'y', title: 'Podcast Episode 44', channel: 'a podcast', duration: 3600 },
  ];
  assert.equal(rankCandidates(pool, track).length, 0);
});

test('ranking is capped so one track cannot spawn endless retries', () => {
  const pool = Array.from({ length: 30 }, (_, i) => ({
    id: `v${i}`, title: 'Never Gonna Give You Up', channel: 'Rick Astley - Topic', duration: 213,
  }));
  assert.ok(rankCandidates(pool, track).length <= 5);
});

test('variantSet detects the traits that must match', () => {
  assert.ok(variantSet('Song (Live at Wembley)').has('live'));
  assert.ok(variantSet('Song (Tiesto Remix)').has('remix'));
  assert.ok(variantSet('Song - Acoustic').has('acoustic'));
  assert.equal(variantSet('Song').size, 0);
});

/* ═════════════════════════ Split hosting ═════════════════════════ */

test('CORS matches an origin exactly, ignoring case and trailing slash', () => {
  const allowed = ['https://stash.vercel.app'];
  assert.equal(originAllowed('https://stash.vercel.app', allowed), true);
  assert.equal(originAllowed('https://stash.vercel.app/', allowed), true);
  assert.equal(originAllowed('https://STASH.vercel.app', allowed), true);
  assert.equal(originAllowed('http://stash.vercel.app', allowed), false);
  assert.equal(originAllowed('https://stash.vercel.app.evil.com', allowed), false);
  assert.equal(originAllowed('', allowed), false);
});

test('a wildcard covers changing preview hostnames but not other sites', () => {
  const allowed = ['https://*.vercel.app'];
  assert.equal(originAllowed('https://stash-abc123.vercel.app', allowed), true);
  assert.equal(originAllowed('https://a.b.vercel.app', allowed), true);
  assert.equal(originAllowed('https://vercel.app.evil.com', allowed), false);
  assert.equal(originAllowed('https://evil.com', allowed), false);
  assert.equal(originAllowed('http://stash.vercel.app', allowed), false);
});

test('a bare star allows anything, an empty list nothing', () => {
  assert.equal(originAllowed('https://anywhere.example', ['*']), true);
  assert.equal(originAllowed('https://anywhere.example', []), false);
  assert.equal(originAllowed('https://anywhere.example', ['', '  ']), false);
});

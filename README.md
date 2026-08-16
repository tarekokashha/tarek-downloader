# Stash

**Paste a link. Keep the file.**

A self-hosted downloader for video, audio and artwork — YouTube, TikTok
(watermark-free), Instagram, Spotify, SoundCloud, X, Reddit and roughly 1,800
other sites. Runs entirely on your own machine; nothing is uploaded anywhere.

---

## Quick start

```bash
npm install
```

```bash
npm run setup
```

```bash
npm start
```

Then open **http://localhost:8080**.

`npm run setup` fetches `yt-dlp` from its official GitHub release into `bin/`,
checks for `ffmpeg`, and creates your `.env`. Run `npm run doctor` any time to
re-check without changing anything.

### ffmpeg

Required for merging high-quality video with audio, converting to MP3,
embedding cover art, and clipping. Without it you can still download, but only
in the formats a site already serves pre-merged.

```bash
winget install Gyan.FFmpeg
```

macOS: `brew install ffmpeg` · Debian/Ubuntu: `sudo apt install ffmpeg`

---

## What it does

**Any link, one box.** Paste and the interface identifies the platform, pulls
the real title, channel, duration, view count and artwork, then offers only the
formats that actually exist for that item.

**Video** — every resolution the source offers, from 144p to 8K, with the codec,
frame rate and true file size shown before you commit. MP4 prefers H.264 so the
file plays on anything; MKV and WebM are there when you want the original
streams untouched.

**Audio** — MP3 at 320/256/192/128, or M4A, Opus, FLAC and WAV. Cover art and
tags are written into the file.

**Honest quality labels.** If you pick MP3 320 but the source is only 129 kbps,
it says so. Upsampling gains nothing but megabytes, and most downloaders never
mention it.

**TikTok without the watermark.** Watermarked variants are filtered out of the
menu entirely, so you cannot pick one by accident.

**Playlists, albums and channels.** Tick the items you want; everything arrives
as a single zip.

**Cover art.** Full-resolution artwork as its own download, or embedded in the
media file.

Plus: clip a section by timecode, keep chapter markers, download subtitles
(embedded or as `.srt`), skip sponsor segments via SponsorBlock, live progress
with speed and ETA, cancel mid-download, dark and light themes, and an accent
colour that adopts whichever service you just pasted.

---

## Spotify and Apple Music — read this

Spotify and Apple Music audio is DRM-protected. **It cannot be downloaded from
them.** Not by this tool, not by any other, paid or otherwise. Anything claiming
to "rip Spotify" is doing one of two things: recording playback in real time, or
what Stash does.

Stash reads the *public metadata* — title, artist, album, cover art, release
year, track order — finds the matching recording on YouTube, downloads that, and
writes the catalogue's tags onto the result.

The whole game is in the matching, so Stash scores candidates carefully:

- **Duration** is the strongest signal. More than 45 seconds off and the
  candidate is rejected outright, which kills hour-long loops and full-album
  uploads.
- **Official sources win.** `— Topic` channels are label-delivered audio and get
  the largest bonus, then VEVO, then channels matching the artist name.
- **Variants must agree.** A live, remix, acoustic or cover version is only
  accepted if the track you asked for is itself that variant. Karaoke and
  reaction uploads are pushed far down.
- Anything below the confidence floor is **reported rather than guessed** — you
  get a warning naming the track instead of a silently wrong file.

Playlists work without any credentials (~100 tracks via Spotify's public embed).
For full playlists, album names and track numbers, add free API credentials from
[developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) to
`.env`:

```
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
```

---

## Deploying it publicly

Stash needs a **long-lived container with a real disk**. It will not run on
Vercel, Netlify, or any serverless platform — the job queue and live progress
stream need a process that survives between requests, downloads outlive a
60-second function limit, and `/tmp` is gone by the time the browser asks for
the file.

**→ Step-by-step instructions: [DEPLOY.md](DEPLOY.md)**

### Where it runs, as of August 2026

| Platform | Free? | Always on? | Notes |
| --- | --- | --- | --- |
| **Northflank** | yes | yes | Best free option. Card verified, not charged. Config: build the `Dockerfile`. |
| **Render** | yes | no | Sleeps after 15 min idle, 30–60s wake. 100 GB/month. Reads `render.yaml`. |
| **Oracle Cloud** | yes | yes | A real always-free ARM VM. Most capable, longest setup. |
| **Railway** | no | yes | Free tier removed; ~$5/month. Reads `railway.json`. |
| **Fly.io / Koyeb** | no | — | Free tiers closed to new accounts. |
| **Your own machine** | yes | while on | Fastest and most reliable — see below. |

### Variables to set

| Variable | Why |
| --- | --- |
| `ACCESS_PASSWORD` | **Set this.** Without it, anyone who finds the URL runs downloads on your bandwidth and your bill. |
| `TRUST_PROXY=1` | So rate limiting sees real client IPs behind the platform's proxy. |
| `COOKIES_CONTENT` | Paste your `cookies.txt` contents — required for Instagram and TikTok. |
| `SPOTIFY_CLIENT_ID` / `SECRET` | Full Spotify playlists. |
| `MAX_DISK_USAGE_MB` | Keep below your container's disk. |

### What to expect from a datacenter IP

This is the honest part. YouTube, Instagram and TikTok all treat cloud IP
ranges as suspicious, and hosted instances get bot-checked far more often than
your home connection does. **`COOKIES_CONTENT` is what makes the difference** —
with a valid session most of it works; without one, Instagram fails outright and
TikTok and YouTube fail intermittently. Cookies expire, so expect to refresh
them every few weeks.

### Or skip the cloud entirely

For a downloader specifically, self-hosting is not a compromise — it is the
better setup. Your home connection is a residential IP, which is not treated as
a bot, and there is no bandwidth meter or egress bill. Run `npm start` and put a
free [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
or [Tailscale Funnel](https://tailscale.com/kb/1223/funnel) in front of it to get
a public HTTPS URL. The only cost is that it runs while your machine does.

---

## Private and age-restricted content

**Instagram serves almost nothing to logged-out clients, and TikTok bot-checks
anonymous requests.** For those two, cookies are not optional. Private YouTube
videos and age-gated material need them too.

Set **one** of these:

```
COOKIES_FROM_BROWSER=chrome
```

```
COOKIES_FILE=C:\path\to\cookies.txt
```

```
COOKIES_CONTENT=<paste the whole cookies.txt here>
```

Close the browser first — Chrome and Edge lock their cookie databases while
running, and `--cookies-from-browser` will fail with "Could not copy Chrome
cookie database".

To export a `cookies.txt`: install a "Get cookies.txt LOCALLY" extension, sign
in to the site, and export while on that site's page. Use `COOKIES_CONTENT` for
hosted deployments, where there is no filesystem to upload to.

Treat that file as a password — it *is* your logged-in session. Never commit it;
`.gitignore` already excludes `cookies.txt` and the generated runtime copy.

### What works without cookies

| | Anonymous | With cookies |
| --- | --- | --- |
| YouTube | works, occasional throttling | reliable |
| TikTok — profile listing | works | works |
| TikTok — individual video | often bot-checked | reliable |
| Instagram | fails | works |
| SoundCloud, Vimeo, Reddit, X | works | works |
| Spotify / Apple Music | works (metadata is public) | n/a |

---

## Configuration

Everything lives in `.env` and every value is optional. See `.env.example` for
the annotated list. The ones worth knowing:

| Setting | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | Web server port |
| `HOST` | `127.0.0.1` | Use `0.0.0.0` to reach it from your LAN |
| `MAX_CONCURRENT_JOBS` | `3` | Simultaneous downloads |
| `MAX_PLAYLIST_ITEMS` | `200` | Cap per playlist |
| `FILE_TTL_MINUTES` | `180` | Auto-delete finished files; `0` keeps forever |
| `MAX_FILESIZE_MB` | `0` | Per-download cap; `0` is unlimited |
| `RATE_LIMIT_PER_MINUTE` | `60` | Requests per IP |

---

## Troubleshooting

**"The site refused the request (403)"** — usually throttling after several
downloads in quick succession. Wait a minute. If it persists, set
`COOKIES_FROM_BROWSER`.

**"Sign in to confirm you're not a bot"** — set `COOKIES_FROM_BROWSER=chrome`.

**A site stopped working.** Sites change their internals constantly; yt-dlp
ships fixes quickly. Update it:

```bash
bin/yt-dlp.exe -U
```

**Conversion or clipping unavailable** — ffmpeg is missing. See above.

**Seeing exactly what went wrong** — start the server with debug tracing to log
every yt-dlp command and its full stderr:

```bash
STASH_DEBUG=1 npm start
```

---

## Development

```bash
npm test
```

36 unit tests covering URL safety and SSRF blocking, platform detection, format
selection, watermark filtering, filename sanitisation, path-traversal defence,
timecode parsing and the catalogue match scorer.

```bash
npm run dev
```

Restarts on file changes.

### Layout

```
server/
  index.js          Express app, security headers, static hosting
  config.js         .env loading and defaults
  lib/
    urls.js         Platform detection, URL validation, SSRF blocking
    ytdlp.js        yt-dlp process wrapper, progress parsing, error mapping
    formats.js      Turns raw format lists into the download menu
    catalog.js      Spotify / Apple Music metadata + YouTube match scoring
    pipeline.js     Download orchestration for media and catalogue jobs
    jobs.js         Job state and live event fan-out
    queue.js        Concurrency-limited runner
    media.js        ffmpeg tagging, cover art, zipping, filename safety
    cleanup.js      TTL-based file expiry
  routes/api.js     REST + Server-Sent Events
public/             Hand-written front end — no framework, no build step
tests/              Unit tests
```

### Security notes

- Every pasted URL is validated before it reaches yt-dlp; private, loopback,
  link-local and cloud-metadata addresses are refused.
- yt-dlp and ffmpeg are spawned with argument arrays — never a shell string.
- Files are served only from their own job directory, with path-traversal
  checks on every request.
- A strict Content-Security-Policy is set; the page loads no external scripts
  or styles. Remote thumbnails are the only outside resource.
- All remote text (titles, channel names, filenames) is inserted into the DOM
  as text nodes, never as markup.

---

## Please download responsibly

Download only what you have the right to keep — your own uploads, public-domain
or openly-licensed works, or material the rights holder permits you to save.
Respect each service's terms of use and the copyright law where you live.

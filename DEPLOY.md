# Deploying Stash

## Vercel

Vercel cannot run the downloader — that needs a process which outlives a
request and a real disk. What it can do is serve the interface, which is plain
HTML, CSS and JS. `vercel.json` already says how: build with
`scripts/build-static.js`, serve `.vercel-static`. There is nothing to
configure to get the page up.

The page then needs to be told where its engine is. Two ways:

- **Leave it unset.** On first load the page asks for the engine's address and
  remembers it in that browser. This is the right choice for a Cloudflare quick
  tunnel, because you can paste the new address after a restart without
  redeploying anything.
- **Bake it in.** Set `STASH_ENGINE` to an `https://` address in the Vercel
  project's environment variables and redeploy. Only worth it for an address
  that does not change — a named tunnel or a container URL.

Then, on the engine, set `CORS_ORIGINS` to your Vercel address:

```
CORS_ORIGINS=https://your-app.vercel.app
```

Without it the browser refuses every call and the page will keep asking you to
connect. Preview deployments each get their own hostname, so
`https://*.vercel.app` is accepted too — one `*` matching anything up to the
next `/`. Only use that on an engine with `ACCESS_PASSWORD` set.

Because the interface and the engine are on different origins, the engine's
session cookie cannot reach it. Unlocking a password-protected engine from a
hosted page therefore hands the browser a token, which it keeps and presents on
every later call. Nothing to configure; it just means signing in on the hosted
page and on the engine's own address are separate.

### Do not proxy the site through Vercel

An earlier version of `vercel.json` rewrote every path — `/` included — to the
engine. It reads well: one origin, no CORS. It also means **the whole site is
down whenever the engine is**, and a Cloudflare quick tunnel hostname is
recycled on every restart, so the rewrite ends up pointing at a name that no
longer exists and Vercel answers `502 DNS_HOSTNAME_NOT_FOUND` — the page
included, so there is nothing left to explain what went wrong.

Serving the interface from Vercel instead means an unreachable engine only
costs you the connect prompt, and it keeps every downloaded byte off Vercel's
bandwidth. `scripts/build-static.js` refuses a `trycloudflare.com` address in
`STASH_ENGINE` for the same reason.

---

## How the pieces fit

Stash is two things that can live apart:

- **the interface** — plain HTML, CSS and JS, hostable anywhere, including Vercel
- **the engine** — yt-dlp and ffmpeg, needing a process that outlives a request
  and a real disk, which rules out every serverless host

Run both together (`npm start`) and the interface talks to the engine on the
same origin. Host them apart and the interface needs to be told where its engine
is, via `STASH_ENGINE` at build time or the connect screen on first load.

`vercel.json` builds the interface only. The engine must run somewhere else —
your own machine behind a tunnel is both the cheapest and the most reliable,
because these sites bot-check datacentre addresses and not residential ones.

Whichever host serves the interface must be listed in the engine's
`CORS_ORIGINS`, or the browser will refuse the calls.

---

Two routes for the engine. **Cloudflare Tunnel is the better one for a downloader** — it runs
on your own connection, so sites see a residential IP instead of a cloud range
and stop bot-checking you. Northflank is the answer if you need it up when your
machine is off.

---

# Route 1 — Cloudflare Tunnel (recommended)

Free, no card, no bandwidth meter, and the most reliable downloads you can get.
`cloudflared` is already installed.

## Try it right now

```bash
npm start
```

```bash
npm run tunnel
```

The second command prints a public HTTPS URL like
`https://something-random.trycloudflare.com`. It works immediately and needs no
account — but the name is random and changes every restart.

## Make the URL permanent

This needs a domain on your Cloudflare account. One-time setup:

```bash
cloudflared tunnel login
```

Pick your domain in the browser window that opens, then:

```bash
cloudflared tunnel create stash
```

```bash
cloudflared tunnel route dns stash downloader.yourdomain.com
```

Create `%USERPROFILE%\.cloudflared\config.yml`:

```yaml
tunnel: stash
credentials-file: C:\Users\tarek\.cloudflared\<TUNNEL-ID>.json

ingress:
  - hostname: downloader.yourdomain.com
    service: http://127.0.0.1:8080
  - service: http_status:404
```

Then run it:

```bash
cloudflared tunnel run stash
```

`downloader.yourdomain.com` now points at your machine, with Cloudflare's HTTPS
in front. To have it start with Windows and stay up:

```bash
cloudflared service install
```

## Set a password first

A tunnel puts your machine on the public internet. **Add `ACCESS_PASSWORD` to
your `.env` before you leave one running**, or anyone with the URL can queue
downloads on your connection. Stash prints a warning when it is exposed without
one.

You can also put Cloudflare Access in front of the hostname (*Zero Trust →
Access → Applications*) to require a login with your email — free for up to
50 users, and stronger than a shared password.

---

# Route 2 — Northflank

Northflank's free Sandbox tier gives you **always-on compute with no sleeping**
and two free services — which, since Railway and Fly closed their free tiers and
Koyeb closed its Starter plan to new users, makes it the best remaining free
option for a container that must stay running.

---

## Before you start: the two things that will bite you

**1. A downloader is pure egress.** Every file travels twice: the source sends
it to your container, then your container sends it to you. A 500 MB video costs
about 1 GB of transfer. Northflank requires a card on file and bills egress
beyond the free allowance at $0.06/GB, so an unguarded public instance is a bill
waiting to happen.

**Set `ACCESS_PASSWORD`.** It is the single most important variable here. Stash
prints a loud warning at startup if it is bound publicly without one.

**2. Datacenter IPs get bot-checked.** YouTube, Instagram and TikTok all treat
cloud IP ranges as suspicious. Instagram will not work at all without a session,
and TikTok and YouTube will fail intermittently. `COOKIES_CONTENT` (below) is
what fixes this. Running Stash on your own machine avoids the problem entirely,
because a residential IP is not treated as a bot.

---

## Deploy

1. **Sign in** at [northflank.com](https://northflank.com) and add a payment
   method — the card is verified, not charged, on the free plan.

2. **Link GitHub**: *Account settings → Git integrations → connect GitHub*, and
   grant access to `tarek-downloader`.

3. **Create the service**: *Project → Create new → Service → Combined service*
   (build + deploy in one).
   - **Repository**: `tarekokasha22/tarek-downloader`, branch `main`
   - **Build type**: `Dockerfile`
   - **Dockerfile path**: `/Dockerfile`
   - **Build context**: `/`

4. **Networking**: add port **8080**, protocol **HTTP**, and tick
   **Publicly exposed**. Northflank issues an HTTPS URL like
   `https://stash--yourproject.code.run`.

5. **Health check**: path `/api/health`, port 8080.

6. **Environment variables** — at minimum:

   | Variable | Value |
   | --- | --- |
   | `ACCESS_PASSWORD` | something long and random |
   | `TRUST_PROXY` | `1` |

   The Dockerfile already sets conservative defaults for everything else
   (1 concurrent job, 1 GB max file, 2 GB disk cap, 30-minute file TTL).

7. **Deploy.** First build takes 3–5 minutes; the image is roughly 400 MB
   because it carries ffmpeg.

---

## Making Instagram and TikTok work

These need a logged-in session. There is no filesystem to upload to, so paste
the cookie file's *contents* into an environment variable instead.

1. Install a **"Get cookies.txt LOCALLY"** extension in your browser.
2. Sign in to Instagram (and TikTok), then export `cookies.txt` **while on that
   site's page**.
3. Open the file, copy everything, and set it as `COOKIES_CONTENT` in
   Northflank. Multi-line values are fine; if the field rejects newlines, use
   literal `\n` between lines and Stash will expand them.

Stash writes it to disk at boot with owner-only permissions and points yt-dlp at
it.

**That file is your live session — treat it exactly like a password.** Never
commit it. Cookies expire every few weeks, so expect to refresh them.

---

## If memory is tight

The free compute plan is small, and ffmpeg is the memory-hungry part — merging
4K video is what will push it over. If deploys get OOM-killed:

| Variable | Try |
| --- | --- |
| `NODE_OPTIONS` | `--max-old-space-size=128` |
| `CONCURRENT_FRAGMENTS` | `1` |
| `MAX_FILESIZE_MB` | `512` |

Or raise the service's memory in Northflank — the next plan up is a couple of
dollars a month.

---

## Updating

Northflank rebuilds on every push to `main`:

```bash
git push
```

To pick up yt-dlp fixes (sites change constantly and yt-dlp patches fast),
trigger a rebuild — the Dockerfile always fetches the latest release.

---

## Sanity check after deploying

```bash
curl -s https://YOUR-URL/api/health
```

Expect `"ytdlp":{"ok":true}`, `"ffmpeg":{"ok":true}` and, if you set a password,
`"locked":true`.

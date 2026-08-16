# Deploying Stash

Two routes. **Cloudflare Tunnel is the better one for a downloader** — it runs
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

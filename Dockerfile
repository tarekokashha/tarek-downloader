# ─────────────────────────────────────────────────────────────
#  Stash — production container
#
#  Runs anywhere that hosts a long-lived container: Railway,
#  Render, Fly.io, Coolify, or your own VPS. It deliberately does
#  NOT target serverless — the app needs a process that stays
#  alive between requests (job queue, progress stream) and a real
#  writable disk.
# ─────────────────────────────────────────────────────────────

FROM node:22-bookworm-slim

# ffmpeg does the merging, conversion and tagging.
# curl + ca-certificates are needed to fetch yt-dlp and cover art.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ffmpeg \
      curl \
      ca-certificates \
      tini \
 && rm -rf /var/lib/apt/lists/*

# yt-dlp's official standalone Linux build. It bundles its own Python,
# so the image needs no interpreter of its own.
ARG YTDLP_VERSION=latest
RUN curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/${YTDLP_VERSION}/download/yt-dlp_linux" \
      -o /usr/local/bin/yt-dlp \
 && chmod 0755 /usr/local/bin/yt-dlp \
 && /usr/local/bin/yt-dlp --version

WORKDIR /app

# Dependencies first so image layers cache across code changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY public ./public
COPY scripts ./scripts

# Downloads live on the container's own disk and are swept by TTL.
RUN mkdir -p /app/downloads && chown -R node:node /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DOWNLOAD_DIR=/app/downloads \
    YTDLP_PATH=/usr/local/bin/yt-dlp \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    TRUST_PROXY=1 \
    MAX_CONCURRENT_JOBS=2 \
    FILE_TTL_MINUTES=45 \
    MAX_FILESIZE_MB=2048

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# tini reaps the yt-dlp and ffmpeg children a download spawns.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server/index.js"]

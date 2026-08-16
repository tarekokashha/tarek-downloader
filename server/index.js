import express from 'express';
import path from 'node:path';
import config from './config.js';
import log from './lib/log.js';
import apiRouter from './routes/api.js';
import { initBinaries, binaryStatus } from './lib/binaries.js';
import { startCleanup, purgeOnStart } from './lib/cleanup.js';

const app = express();

app.disable('x-powered-by');
// Behind Railway, Render or any reverse proxy this must count the hops, or
// every request appears to come from the proxy and rate limiting is useless.
app.set('trust proxy', config.trustProxy);
app.set('etag', false);

app.use(express.json({ limit: '128kb' }));

/**
 * Security headers. The CSP is deliberately tight: the page ships no external
 * scripts or styles, so everything but `self` can be denied. Remote thumbnails
 * are the one exception — they come from the source platform's CDN.
 */
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), interest-cohort=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "media-src 'self' blob:",
      "connect-src 'self'",
      "font-src 'self'",
      "form-action 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
    ].join('; '),
  );
  next();
});

app.use('/api', apiRouter);

app.use(
  express.static(config.publicDir, {
    index: 'index.html',
    maxAge: 0,
    setHeaders(res, filePath) {
      // Hashless static assets during local use: revalidate every time.
      if (/\.(css|js)$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
    },
  }),
);

// Single-page fallback for anything that is not an API call.
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ error: 'Unknown endpoint.' });
    return;
  }
  res.sendFile(path.join(config.publicDir, 'index.html'));
});

app.use((err, req, res, next) => {
  log.error(err);
  if (res.headersSent) {
    next(err);
    return;
  }
  res.status(err.status ?? 500).json({ error: err.message ?? 'Internal error.' });
});

/* ──────────────────────────────── Boot ─────────────────────────────── */

async function main() {
  log.plain('');
  log.plain('  \x1b[1mStash\x1b[0m — paste a link, keep the file');
  log.plain('');

  await initBinaries();
  await purgeOnStart();
  startCleanup();

  const status = binaryStatus();
  if (!status.ytdlp.ok) {
    log.plain('');
    log.error('yt-dlp is missing. The server will start but downloads will fail.');
    log.plain('  Fix it with:  \x1b[1mnpm run setup\x1b[0m');
    log.plain('');
  }

  /*
   * An unguarded downloader on a public address is an open proxy for other
   * people's bandwidth. On a metered host that is billed to whoever deployed
   * it, so say so loudly rather than letting it be discovered on an invoice.
   */
  const publiclyBound = config.host === '0.0.0.0' || config.host === '::';
  if (publiclyBound && !config.accessPassword) {
    log.plain('');
    log.warn('\x1b[1mThis instance is reachable from the network with no password.\x1b[0m');
    log.plain('  Anyone who finds the URL can run downloads on your bandwidth.');
    log.plain('  Set \x1b[1mACCESS_PASSWORD\x1b[0m in the environment and redeploy.');
    log.plain('');
  }

  const server = app.listen(config.port, config.host, () => {
    const shown = config.host === '0.0.0.0' ? 'localhost' : config.host;
    log.plain('');
    log.ok(`Ready at \x1b[1mhttp://${shown}:${config.port}\x1b[0m`);
    log.plain(`  files      ${config.downloadDir}`);
    log.plain(`  concurrency ${config.maxConcurrentJobs}   ttl ${config.fileTtlMinutes || '∞'} min`);
    log.plain('');
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      log.error(`Port ${config.port} is already in use. Set PORT in .env to something else.`);
      process.exit(1);
    }
    log.error(err);
    process.exit(1);
  });

  // Large files need generous timeouts.
  server.requestTimeout = 0;
  server.headersTimeout = 65_000;
  server.keepAliveTimeout = 61_000;

  const shutdown = (signal) => {
    log.plain('');
    log.info(`${signal} received — shutting down.`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

process.on('unhandledRejection', (reason) => log.error('Unhandled rejection:', reason));
process.on('uncaughtException', (err) => {
  log.error('Uncaught exception:', err);
  process.exit(1);
});

main().catch((err) => {
  log.error(err);
  process.exit(1);
});

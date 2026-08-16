#!/usr/bin/env node
/**
 * First-run setup.
 *
 * Finds or installs the two tools Stash depends on:
 *   yt-dlp  — the extractor that talks to every supported site
 *   ffmpeg  — merges video with audio and converts formats
 *
 * Both come from their official project releases. Nothing is installed
 * without telling you exactly what and from where.
 *
 *   node scripts/setup.js           install what is missing
 *   node scripts/setup.js --check   report only, change nothing
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN_DIR = path.join(ROOT, 'bin');
const CHECK_ONLY = process.argv.includes('--check');

const isWindows = process.platform === 'win32';
const c = {
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

const say = (msg = '') => process.stdout.write(`${msg}\n`);
const ok = (msg) => say(`  ${c.green('✓')} ${msg}`);
const bad = (msg) => say(`  ${c.red('✗')} ${msg}`);
const warn = (msg) => say(`  ${c.yellow('!')} ${msg}`);
const step = (msg) => say(`  ${c.cyan('→')} ${msg}`);

function run(command, args, { cwd } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch {
      resolve({ code: -1, out: '' });
      return;
    }
    let out = '';
    const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, 120_000);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', () => { clearTimeout(timer); resolve({ code: -1, out }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out: out.trim() }); });
  });
}

async function version(command, args) {
  const { code, out } = await run(command, args);
  return code === 0 ? out.split(/\r?\n/)[0].trim() : null;
}

/* ─────────────────────────────── yt-dlp ────────────────────────────── */

const YTDLP_ASSET = {
  win32: { x64: 'yt-dlp.exe', arm64: 'yt-dlp.exe', ia32: 'yt-dlp_x86.exe' },
  darwin: { x64: 'yt-dlp_macos', arm64: 'yt-dlp_macos' },
  linux: { x64: 'yt-dlp_linux', arm64: 'yt-dlp_linux_aarch64', arm: 'yt-dlp_linux_armv7l' },
};

function ytdlpDownloadUrl() {
  const asset = YTDLP_ASSET[process.platform]?.[process.arch];
  if (!asset) return null;
  return `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`;
}

async function fetchToFile(url, destination) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': 'stash-setup' },
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

  const total = Number(res.headers.get('content-length')) || 0;
  let received = 0;
  let lastPrint = 0;

  const source = Readable.fromWeb(res.body);
  source.on('data', (chunk) => {
    received += chunk.length;
    const now = Date.now();
    if (now - lastPrint > 200) {
      lastPrint = now;
      const mb = (received / 1e6).toFixed(1);
      const pct = total ? ` (${Math.round((received / total) * 100)}%)` : '';
      process.stdout.write(`\r    ${c.dim(`${mb} MB${pct}`)}          `);
    }
  });

  const temp = `${destination}.partial`;
  await pipeline(source, createWriteStream(temp));
  process.stdout.write('\r                                        \r');

  const stat = await fsp.stat(temp);
  if (stat.size < 100_000) {
    await fsp.rm(temp, { force: true });
    throw new Error('the downloaded file looks truncated');
  }

  await fsp.rm(destination, { force: true });
  await fsp.rename(temp, destination);
  if (!isWindows) await fsp.chmod(destination, 0o755);
}

async function findYtdlp() {
  const local = path.join(BIN_DIR, isWindows ? 'yt-dlp.exe' : 'yt-dlp');
  if (fs.existsSync(local)) {
    const v = await version(local, ['--version']);
    if (v) return { where: `bin/${path.basename(local)}`, version: v };
  }

  const onPath = await version(isWindows ? 'yt-dlp.exe' : 'yt-dlp', ['--version']);
  if (onPath) return { where: 'PATH', version: onPath };

  for (const python of [isWindows ? 'python' : 'python3', 'py']) {
    const v = await version(python, ['-m', 'yt_dlp', '--version']);
    if (v) return { where: `${python} -m yt_dlp`, version: v };
  }
  return null;
}

async function installYtdlp() {
  const url = ytdlpDownloadUrl();
  if (!url) {
    bad(`No prebuilt yt-dlp for ${process.platform}/${process.arch}.`);
    say(`    Install it yourself:  ${c.bold('pip install -U yt-dlp')}`);
    return false;
  }

  await fsp.mkdir(BIN_DIR, { recursive: true });
  const target = path.join(BIN_DIR, isWindows ? 'yt-dlp.exe' : 'yt-dlp');

  step('Installing yt-dlp from the official GitHub release');
  say(`    ${c.dim(url)}`);

  try {
    await fetchToFile(url, target);
  } catch (err) {
    bad(`Download failed: ${err.message}`);
    say(`    Alternative:  ${c.bold('pip install -U yt-dlp')}`);
    return false;
  }

  const v = await version(target, ['--version']);
  if (!v) {
    bad('The downloaded yt-dlp would not run.');
    return false;
  }
  ok(`yt-dlp ${v} installed to bin/`);
  return true;
}

/* ─────────────────────────────── ffmpeg ────────────────────────────── */

async function findFfmpeg() {
  const local = path.join(BIN_DIR, isWindows ? 'ffmpeg.exe' : 'ffmpeg');
  if (fs.existsSync(local)) {
    const v = await version(local, ['-version']);
    if (v) return { where: 'bin/', version: v };
  }
  const onPath = await version('ffmpeg', ['-version']);
  if (onPath) return { where: 'PATH', version: onPath };
  return null;
}

function ffmpegAdvice() {
  warn('ffmpeg was not found.');
  say('    Without it you can still download, but not merge high-quality');
  say('    video with audio, convert to MP3, embed cover art, or clip.');
  say('');
  if (isWindows) {
    say(`    Install with:  ${c.bold('winget install Gyan.FFmpeg')}`);
    say(`               or:  ${c.bold('choco install ffmpeg')}`);
  } else if (process.platform === 'darwin') {
    say(`    Install with:  ${c.bold('brew install ffmpeg')}`);
  } else {
    say(`    Install with:  ${c.bold('sudo apt install ffmpeg')}   (Debian/Ubuntu)`);
    say(`               or:  ${c.bold('sudo dnf install ffmpeg')}  (Fedora)`);
  }
  say(`    ${c.dim('Then reopen your terminal so PATH refreshes.')}`);
}

/* ──────────────────────────────── Main ─────────────────────────────── */

async function main() {
  say('');
  say(`  ${c.bold('Stash setup')}  ${c.dim(`${process.platform}/${process.arch} · node ${process.versions.node}`)}`);
  say('');

  let ready = true;

  // yt-dlp
  let ytdlp = await findYtdlp();
  if (ytdlp) {
    ok(`yt-dlp ${ytdlp.version}  ${c.dim(`(${ytdlp.where})`)}`);
  } else if (CHECK_ONLY) {
    bad('yt-dlp not found.');
    ready = false;
  } else {
    const installed = await installYtdlp();
    ready = ready && installed;
    if (installed) ytdlp = await findYtdlp();
  }

  // ffmpeg
  const ffmpeg = await findFfmpeg();
  if (ffmpeg) {
    ok(`ffmpeg ${ffmpeg.version.replace(/^ffmpeg version /, '').split(' ')[0]}  ${c.dim(`(${ffmpeg.where})`)}`);
  } else {
    say('');
    ffmpegAdvice();
    say('');
  }

  // Configuration
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath) && !CHECK_ONLY) {
    const example = path.join(ROOT, '.env.example');
    if (fs.existsSync(example)) {
      await fsp.copyFile(example, envPath);
      ok('Created .env from the template');
    }
  } else if (fs.existsSync(envPath)) {
    ok('.env present');
  }

  await fsp.mkdir(path.join(ROOT, 'downloads'), { recursive: true });

  say('');
  if (ready && ytdlp) {
    say(`  ${c.green('Ready.')}  Start it with  ${c.bold('npm start')}`);
    if (!ffmpeg) say(`  ${c.dim('Some formats will be unavailable until ffmpeg is installed.')}`);
  } else {
    say(`  ${c.red('Not ready.')} Resolve the items above, then run setup again.`);
  }
  say('');

  process.exit(ready && ytdlp ? 0 : 1);
}

main().catch((err) => {
  say('');
  bad(err.message);
  process.exit(1);
});

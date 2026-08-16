import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import config from '../config.js';
import log from './log.js';

const isWindows = process.platform === 'win32';

/**
 * Runs a command purely to read its version string. Never throws.
 * @returns {Promise<string|null>}
 */
function probe(command, args = ['--version'], cwd) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch {
      resolve(null);
      return;
    }

    let out = '';
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* already gone */ }
      resolve(null);
    }, 15_000);

    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { out += chunk; });
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? out.trim().split(/\r?\n/)[0].trim() : null);
    });
  });
}

/**
 * Candidate ways to invoke yt-dlp, most preferred first.
 * Each entry is `{ command, prefixArgs }` so a Python module invocation
 * (`python -m yt_dlp`) works exactly like a standalone binary.
 */
function ytdlpCandidates() {
  const list = [];
  if (config.ytdlpPath) list.push({ command: config.ytdlpPath, prefixArgs: [] });

  const local = path.join(config.binDir, isWindows ? 'yt-dlp.exe' : 'yt-dlp');
  if (fs.existsSync(local)) list.push({ command: local, prefixArgs: [] });

  list.push({ command: isWindows ? 'yt-dlp.exe' : 'yt-dlp', prefixArgs: [] });
  list.push({ command: 'yt-dlp', prefixArgs: [] });
  list.push({ command: isWindows ? 'python' : 'python3', prefixArgs: ['-m', 'yt_dlp'] });
  list.push({ command: 'py', prefixArgs: ['-m', 'yt_dlp'] });
  return list;
}

function ffmpegCandidates() {
  const list = [];
  if (config.ffmpegPath) list.push(config.ffmpegPath);
  const local = path.join(config.binDir, isWindows ? 'ffmpeg.exe' : 'ffmpeg');
  if (fs.existsSync(local)) list.push(local);
  list.push('ffmpeg');
  return list;
}

/** Resolved tool locations, filled in by `initBinaries()`. */
export const tools = {
  ytdlp: null,      // { command, prefixArgs, version }
  ffmpeg: null,     // { command, version, dir }
  ffprobe: null,    // { command, version }
};

export async function initBinaries({ quiet = false } = {}) {
  for (const candidate of ytdlpCandidates()) {
    const version = await probe(candidate.command, [...candidate.prefixArgs, '--version']);
    if (version) {
      tools.ytdlp = { ...candidate, version, jsRuntime: false };
      break;
    }
  }

  /*
   * YouTube deciphers stream URLs with a JavaScript challenge. yt-dlp only
   * enables Deno out of the box, and without a runtime some formats simply
   * 403. Node is by definition available here, so point yt-dlp at it —
   * but only if this build understands the flag.
   */
  if (tools.ytdlp) {
    const help = await probe(
      tools.ytdlp.command,
      [...tools.ytdlp.prefixArgs, '--help'],
    );
    const supportsFlag = await probe(
      tools.ytdlp.command,
      [...tools.ytdlp.prefixArgs, '--js-runtimes', `node:${process.execPath}`, '--version'],
    );
    tools.ytdlp.jsRuntime = Boolean(supportsFlag) || Boolean(help && help.includes('--js-runtimes'));
  }

  for (const candidate of ffmpegCandidates()) {
    const version = await probe(candidate, ['-version']);
    if (version) {
      tools.ffmpeg = {
        command: candidate,
        version: version.replace(/^ffmpeg version /, '').split(' ')[0],
        dir: candidate.includes(path.sep) ? path.dirname(candidate) : null,
      };
      break;
    }
  }

  if (tools.ffmpeg) {
    const probeCmd = tools.ffmpeg.dir
      ? path.join(tools.ffmpeg.dir, isWindows ? 'ffprobe.exe' : 'ffprobe')
      : 'ffprobe';
    const version = await probe(probeCmd, ['-version']);
    if (version) tools.ffprobe = { command: probeCmd, version };
  }

  if (!quiet) {
    if (tools.ytdlp) log.ok(`yt-dlp ${tools.ytdlp.version}`);
    else log.error('yt-dlp not found — run: npm run setup');
    if (tools.ffmpeg) log.ok(`ffmpeg ${tools.ffmpeg.version}`);
    else log.warn('ffmpeg not found — merging and audio conversion will be unavailable');
  }

  return tools;
}

/** Throws a user-facing error when the core downloader is missing. */
export function requireYtdlp() {
  if (!tools.ytdlp) {
    throw new Error(
      'yt-dlp is not installed. Stop the server and run "npm run setup", then start it again.',
    );
  }
  return tools.ytdlp;
}

export function hasFfmpeg() {
  return Boolean(tools.ffmpeg);
}

export function requireFfmpeg() {
  if (!tools.ffmpeg) {
    throw new Error('ffmpeg is required for this conversion but was not found on this machine.');
  }
  return tools.ffmpeg;
}

export function binaryStatus() {
  return {
    ytdlp: tools.ytdlp ? { ok: true, version: tools.ytdlp.version } : { ok: false },
    ffmpeg: tools.ffmpeg ? { ok: true, version: tools.ffmpeg.version } : { ok: false },
  };
}

/**
 * Kills a process and everything it spawned. On Windows a plain kill() leaves
 * ffmpeg children orphaned, so shell out to taskkill for the whole tree.
 */
export function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (isWindows) {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      return;
    } catch {
      // fall through to the portable path
    }
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    try { child.kill('SIGKILL'); } catch { /* already dead */ }
  }
}

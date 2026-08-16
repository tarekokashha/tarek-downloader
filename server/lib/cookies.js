import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import config from '../config.js';
import log from './log.js';

/**
 * Runtime cookie management.
 *
 * Chrome 127+ encrypts its cookie store with a key bound to the Chrome
 * process (App-Bound Encryption), so `--cookies-from-browser chrome` cannot
 * work no matter what permissions we have or whether the browser is closed.
 * Firefox still stores cookies in plain SQLite and works fine; for everyone
 * else the reliable route is a Netscape cookies.txt exported by an extension.
 *
 * This module lets that file be handed to a running server — no .env editing,
 * no restart — and keeps it out of logs, responses and git.
 */

const COOKIE_PATH = path.join(config.root, '.cookies.runtime.txt');

/** Sites worth reporting on, since these are the ones that need a session. */
const INTERESTING = [
  { id: 'instagram', label: 'Instagram', match: /(^|\.)instagram\.com$/i },
  { id: 'tiktok', label: 'TikTok', match: /(^|\.)tiktok\.com$/i },
  { id: 'youtube', label: 'YouTube', match: /(^|\.)(youtube\.com|google\.com)$/i },
  { id: 'x', label: 'X', match: /(^|\.)(x\.com|twitter\.com)$/i },
  { id: 'facebook', label: 'Facebook', match: /(^|\.)facebook\.com$/i },
  { id: 'reddit', label: 'Reddit', match: /(^|\.)reddit\.com$/i },
];

/** Cookie names that actually represent a signed-in session. */
const SESSION_NAMES = /^(sessionid|sessionid_ss|ds_user_id|sid|sessionidguard|__Secure-|LOGIN_INFO|SAPISID|auth_token|c_user|xs|reddit_session|token)/i;

/**
 * Parses a Netscape cookie file into a summary. Never returns cookie values —
 * only which domains are covered and whether a session cookie is present.
 */
export function summarise(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const domains = new Map();
  let total = 0;
  let malformed = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    // domain \t includeSubdomains \t path \t secure \t expiry \t name \t value
    const parts = line.split('\t');
    if (parts.length < 7) { malformed += 1; continue; }

    const [domainRaw, , , , expiryRaw, name] = parts;
    const domain = domainRaw.replace(/^\./, '').toLowerCase();
    if (!domain) { malformed += 1; continue; }

    total += 1;
    const expiry = Number.parseInt(expiryRaw, 10);
    const entry = domains.get(domain) ?? { count: 0, session: false, earliestExpiry: null };
    entry.count += 1;
    if (SESSION_NAMES.test(name)) entry.session = true;
    if (Number.isFinite(expiry) && expiry > 0) {
      entry.earliestExpiry = entry.earliestExpiry === null
        ? expiry
        : Math.min(entry.earliestExpiry, expiry);
    }
    domains.set(domain, entry);
  }

  const sites = INTERESTING.map((site) => {
    let count = 0;
    let session = false;
    let expiry = null;
    for (const [domain, entry] of domains) {
      if (!site.match.test(domain)) continue;
      count += entry.count;
      session = session || entry.session;
      if (entry.earliestExpiry !== null) {
        expiry = expiry === null ? entry.earliestExpiry : Math.min(expiry, entry.earliestExpiry);
      }
    }
    return {
      id: site.id,
      label: site.label,
      present: count > 0,
      signedIn: session,
      cookies: count,
      expiresAt: expiry ? expiry * 1000 : null,
    };
  });

  return { total, malformed, domains: domains.size, sites };
}

/** Rejects anything that is not plausibly a Netscape cookie file. */
export function validate(text) {
  const body = String(text ?? '');
  if (!body.trim()) throw new Error('The file is empty.');
  if (body.length > 2 * 1024 * 1024) throw new Error('That file is unexpectedly large (over 2 MB).');

  const summary = summarise(body);
  if (summary.total === 0) {
    throw new Error(
      'No cookies found. Make sure you exported in "Netscape" format — the file should have '
      + 'tab-separated lines, not JSON.',
    );
  }
  return summary;
}

/**
 * Stores the cookie file and points yt-dlp at it immediately.
 * `baseArgs()` reads config.cookiesFile on every call, so no restart is needed.
 */
export async function install(text) {
  const summary = validate(text);

  const header = text.startsWith('# Netscape') || text.startsWith('# HTTP Cookie File')
    ? ''
    : '# Netscape HTTP Cookie File\n';

  await fsp.writeFile(COOKIE_PATH, header + text.trimEnd() + '\n', { mode: 0o600 });
  config.cookiesFile = COOKIE_PATH;
  // A browser-based source cannot coexist with an explicit file.
  config.cookiesFromBrowser = '';

  const named = summary.sites.filter((s) => s.present).map((s) => s.label);
  log.ok(`Cookies installed — ${summary.total} cookies across ${summary.domains} domains${named.length ? ` (${named.join(', ')})` : ''}`);

  return summary;
}

export async function remove() {
  await fsp.rm(COOKIE_PATH, { force: true });
  if (config.cookiesFile === COOKIE_PATH) config.cookiesFile = '';
  log.info('Cookies removed.');
}

/** Current state, safe to send to the browser. */
export function status() {
  const file = config.cookiesFile;
  const usingBrowser = Boolean(config.cookiesFromBrowser);

  if (!file || !fs.existsSync(file)) {
    return {
      installed: false,
      source: usingBrowser ? `browser:${config.cookiesFromBrowser}` : null,
      sites: INTERESTING.map((s) => ({ id: s.id, label: s.label, present: false, signedIn: false })),
    };
  }

  try {
    const summary = summarise(fs.readFileSync(file, 'utf8'));
    return {
      installed: true,
      source: file === COOKIE_PATH ? 'uploaded' : 'file',
      total: summary.total,
      domains: summary.domains,
      sites: summary.sites,
      updatedAt: fs.statSync(file).mtimeMs,
    };
  } catch {
    return { installed: false, source: null, sites: [] };
  }
}

/**
 * Whether `--cookies-from-browser` has any chance of working here.
 * Chrome and Edge on Windows are hopeless from Chrome 127 onward.
 */
export function browserExtractionViable() {
  if (process.platform !== 'win32') return { viable: true, reason: null };

  const localState = path.join(
    process.env.LOCALAPPDATA ?? '',
    'Google', 'Chrome', 'User Data', 'Local State',
  );
  try {
    const text = fs.readFileSync(localState, 'utf8');
    if (text.includes('app_bound_encrypted_key')) {
      return {
        viable: false,
        reason:
          'Chrome on Windows encrypts cookies with a key bound to the Chrome process '
          + '(App-Bound Encryption, Chrome 127+). No other program can read them, even '
          + 'with the browser closed. Export a cookies.txt instead.',
      };
    }
  } catch {
    // No Chrome installed, or unreadable — assume the generic path is fine.
  }
  return { viable: true, reason: null };
}

export const COOKIE_FILE_PATH = COOKIE_PATH;

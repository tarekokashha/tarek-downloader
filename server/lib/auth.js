import crypto from 'node:crypto';
import config from '../config.js';

/**
 * Optional shared-password gate.
 *
 * A downloader on a public URL is an open proxy for other people's bandwidth
 * if you leave it unguarded. When ACCESS_PASSWORD is set, every API call and
 * the page itself require a session; when it is blank the gate disappears
 * entirely, which is the right default for a private instance on localhost.
 *
 * Sessions are random tokens held in memory — nothing is persisted, and a
 * restart signs everyone out.
 */

const COOKIE = 'stash_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** token -> expiry timestamp */
const sessions = new Map();

export const isProtected = () => Boolean(config.accessPassword);

function sweep() {
  const now = Date.now();
  for (const [token, expires] of sessions) {
    if (expires <= now) sessions.delete(token);
  }
}
setInterval(sweep, 60 * 60_000).unref();

/** Constant-time comparison so the password cannot be probed by timing. */
function matches(candidate) {
  const expected = Buffer.from(config.accessPassword, 'utf8');
  const given = Buffer.from(String(candidate ?? ''), 'utf8');
  // timingSafeEqual throws on length mismatch, so compare digests instead.
  const a = crypto.createHash('sha256').update(expected).digest();
  const b = crypto.createHash('sha256').update(given).digest();
  return crypto.timingSafeEqual(a, b);
}

export function createSession() {
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

export function hasValidSession(req) {
  if (!isProtected()) return true;

  const token = readCookie(req, COOKIE) || req.get('x-stash-key');
  if (!token) return false;

  // A raw password in the header is accepted so scripts and curl can be used.
  if (token === config.accessPassword) return true;

  const expires = sessions.get(token);
  if (!expires) return false;
  if (expires <= Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

export function setSessionCookie(res, token, secure) {
  const attrs = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (secure) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export function destroySession(req) {
  const token = readCookie(req, COOKIE);
  if (token) sessions.delete(token);
}

/**
 * Rate-limited password check. Without this the gate is a few thousand
 * guesses away from being no gate at all.
 */
const attempts = new Map();

export function verifyPassword(ip, candidate) {
  const now = Date.now();
  const record = attempts.get(ip) ?? { count: 0, until: 0 };

  if (record.until > now) {
    const wait = Math.ceil((record.until - now) / 1000);
    return { ok: false, error: `Too many attempts. Try again in ${wait}s.` };
  }

  if (!candidate || !matches(candidate)) {
    record.count += 1;
    // Back off hard after five misses.
    if (record.count >= 5) {
      record.until = now + Math.min(15 * 60_000, 2 ** (record.count - 5) * 30_000);
      record.count = 0;
    }
    attempts.set(ip, record);
    return { ok: false, error: 'Wrong password.' };
  }

  attempts.delete(ip);
  return { ok: true, token: createSession() };
}

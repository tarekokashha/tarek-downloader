/**
 * Matching for CORS_ORIGINS.
 *
 * The engine needs these headers whenever the page is served from somewhere
 * other than the engine itself — a static front end on Vercel talking to a
 * tunnel, for example. Origins are listed explicitly because a downloader that
 * answers to any website is one that any website can drive.
 *
 * A pattern may contain `*`, which matches anything up to the next `/`. That
 * exists because Vercel gives every preview deployment its own hostname, so an
 * exact list is unmaintainable — `https://*.vercel.app` covers them all. A
 * pattern of `*` alone allows every origin, which is only sensible when the
 * engine is behind ACCESS_PASSWORD.
 */

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Origins have no path or trailing slash; compare them in one shape. */
export const normaliseOrigin = (value) =>
  String(value ?? '').trim().replace(/\/+$/, '').toLowerCase();

export function originAllowed(origin, patterns = []) {
  const candidate = normaliseOrigin(origin);
  if (!candidate) return false;

  for (const raw of patterns) {
    const pattern = normaliseOrigin(raw);
    if (!pattern) continue;
    if (pattern === '*') return true;
    if (pattern === candidate) return true;
    if (!pattern.includes('*')) continue;

    const rx = new RegExp(`^${pattern.split('*').map(escapeRegExp).join('[^/]*')}$`);
    if (rx.test(candidate)) return true;
  }
  return false;
}

export default originAllowed;

/**
 * Where this page's engine lives.
 *
 * Empty means "the same origin as this page", which is the case whenever you
 * run Stash yourself with `npm start`. A host that serves the interface on its
 * own — Vercel, say — stamps the engine's address in here at build time; see
 * scripts/build-static.js. Leave it blank and the page asks the visitor for an
 * address on first load and remembers the answer.
 *
 * This lives in its own file rather than a <script> block in the page so the
 * Content-Security-Policy can keep refusing inline scripts.
 */
window.STASH_ENGINE = '';

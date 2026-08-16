/* ═══════════════════════════════════════════════════════════════════════
   Stash — client

   Paste a link, pick a quality, get the file. One screen, no history, no
   accounts. Everything remote (titles, channel names, filenames) is inserted
   as text nodes; the `el()` helper makes that the default path.
   ═══════════════════════════════════════════════════════════════════════ */

/* ──────────────────────────── DOM helpers ──────────────────────────── */

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;

    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'svg') node.innerHTML = value;            // our own icon markup only
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }

  add(node, children);
  return node;
}

function add(parent, children) {
  for (const child of children.flat(4)) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

const $ = (id) => document.getElementById(id);
const clear = (node) => { while (node.firstChild) node.firstChild.remove(); };

/* ───────────────────────────── Icons ───────────────────────────────── */

const ICON = {
  video: '<svg viewBox="0 0 16 16" fill="none"><rect x="1.2" y="3" width="13.6" height="10" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M6.6 6.4v3.2l3-1.6z" fill="currentColor"/></svg>',
  audio: '<svg viewBox="0 0 16 16" fill="none"><path d="M6 11.5V3.6l7-1.3v7.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="4.4" cy="11.6" r="1.9" stroke="currentColor" stroke-width="1.4"/><circle cx="11.4" cy="9.9" r="1.9" stroke="currentColor" stroke-width="1.4"/></svg>',
  image: '<svg viewBox="0 0 16 16" fill="none"><rect x="1.5" y="2.8" width="13" height="10.4" rx="2" stroke="currentColor" stroke-width="1.4"/><circle cx="5.6" cy="6.4" r="1.3" stroke="currentColor" stroke-width="1.2"/><path d="M2.2 11.6 5.8 8.6l3 2.4 2.3-1.9 2.6 2.3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  download: '<svg viewBox="0 0 16 16" fill="none"><path d="M8 2v8m0 0 3.2-3.2M8 10 4.8 6.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.4 11.6v1.2a1.2 1.2 0 0 0 1.2 1.2h8.8a1.2 1.2 0 0 0 1.2-1.2v-1.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  chevron: '<svg viewBox="0 0 12 12" fill="none"><path d="M4.5 2.5 8 6l-3.5 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  check: '<svg viewBox="0 0 12 12" fill="none"><path d="M2.5 6.2 4.8 8.5 9.5 3.6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  alert: '<svg viewBox="0 0 20 20" fill="none"><path d="M10 6v5M10 13.6v.1" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><circle cx="10" cy="10" r="7.6" stroke="currentColor" stroke-width="1.6"/></svg>',
  film: '<svg viewBox="0 0 20 20" fill="none"><rect x="2.5" y="4.5" width="15" height="11" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M6.6 4.5v11M13.4 4.5v11" stroke="currentColor" stroke-width="1.2"/></svg>',
  stop: '<svg viewBox="0 0 16 16" fill="none"><rect x="4.4" y="4.4" width="7.2" height="7.2" rx="1.4" fill="currentColor"/></svg>',
  copy: '<svg viewBox="0 0 16 16" fill="none"><rect x="5.5" y="2.5" width="8" height="10" rx="1.6" stroke="currentColor" stroke-width="1.4"/><path d="M5.5 5H3.6A1.1 1.1 0 0 0 2.5 6.1v7.3A1.1 1.1 0 0 0 3.6 14.5h6.3" stroke="currentColor" stroke-width="1.4"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none"><path d="M9.5 14.5a3.6 3.6 0 0 0 5.1 0l3.1-3.1a3.6 3.6 0 0 0-5.1-5.1l-1.1 1.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M14.5 9.5a3.6 3.6 0 0 0-5.1 0l-3.1 3.1a3.6 3.6 0 0 0 5.1 5.1l1.1-1.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none"><rect x="4.5" y="10.5" width="15" height="10" rx="2.4" stroke="currentColor" stroke-width="1.7"/><path d="M8.2 10.5V7.8a3.8 3.8 0 0 1 7.6 0v2.7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="15.4" r="1.3" fill="currentColor"/></svg>',
};

/* ──────────────────────────── Formatting ───────────────────────────── */

function bytes(value) {
  if (!Number.isFinite(value) || value <= 0) return null;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = value;
  let u = 0;
  while (n >= 1024 && u < units.length - 1) { n /= 1024; u += 1; }
  return `${n >= 100 || u === 0 ? Math.round(n) : n.toFixed(1)} ${units[u]}`;
}

function duration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

function longDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h} hr ${m} min` : `${Math.max(1, m)} min`;
}

function compactCount(value) {
  if (!Number.isFinite(value) || value < 0) return null;
  if (value < 1000) return String(value);
  if (value < 1e6) return `${(value / 1e3).toFixed(value < 1e4 ? 1 : 0)}K`;
  if (value < 1e9) return `${(value / 1e6).toFixed(value < 1e7 ? 1 : 0)}M`;
  return `${(value / 1e9).toFixed(1)}B`;
}

function eta(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds < 60) return `${Math.round(seconds)}s left`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ${Math.round(seconds % 60)}s left`;
  return `${Math.floor(m / 60)}h ${m % 60}m left`;
}

/* ──────────────────────────── Accent colour ────────────────────────── */

const DEFAULT_ACCENT = '#d9f24b';

function hexToRgb(hex) {
  const clean = String(hex).replace('#', '').trim();
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/** WCAG relative luminance — decides whether text on the accent is black or white. */
function luminance({ r, g, b }) {
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

let currentAccent = DEFAULT_ACCENT;

function setAccent(hex) {
  const rgb = hexToRgb(hex || DEFAULT_ACCENT) ?? hexToRgb(DEFAULT_ACCENT);
  const value = `#${[rgb.r, rgb.g, rgb.b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
  if (value === currentAccent) return;
  currentAccent = value;

  const root = document.documentElement.style;
  root.setProperty('--accent', value);
  root.setProperty('--accent-ink', luminance(rgb) > 0.42 ? '#0b0b0c' : '#ffffff');
  root.setProperty('--accent-soft', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.13)`);
  root.setProperty('--accent-glow', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.22)`);
}

/* ─────────────────────────────── State ─────────────────────────────── */

const state = {
  platforms: [],
  containers: [],
  ffmpeg: true,
  result: null,
  choice: null,
  resolveToken: 0,
  activeJob: null,
};

function detect(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;

  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname.includes('.')) return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  for (const platform of state.platforms) {
    for (const candidate of platform.hosts ?? []) {
      if (host === candidate || host.endsWith(`.${candidate}`)) return platform;
    }
  }
  return { id: 'generic', name: host.length > 22 ? 'Link' : host, accent: DEFAULT_ACCENT };
}

/* ─────────────────────────── Engine address ────────────────────────── */

/**
 * Where the download engine lives. Same origin when you run Stash yourself;
 * elsewhere when the interface is hosted separately, in which case the deploy
 * writes the address into `window.STASH_ENGINE`.
 */
const ENGINE_KEY = 'stash:engine';

function engineBase() {
  const stored = localStorage.getItem(ENGINE_KEY);
  if (stored) return stored.replace(/\/$/, '');
  const baked = typeof window !== 'undefined' ? window.STASH_ENGINE : null;
  if (baked && baked !== '__STASH_ENGINE__') return String(baked).replace(/\/$/, '');
  return '';
}

function setEngineBase(url) {
  const clean = String(url || '').trim().replace(/\/$/, '');
  if (clean) localStorage.setItem(ENGINE_KEY, clean);
  else localStorage.removeItem(ENGINE_KEY);
}

const isRemoteEngine = () => Boolean(engineBase());
const apiUrl = (path) => engineBase() + path;

/* ───────────────────────────── Networking ──────────────────────────── */

async function api(path, options = {}) {
  const res = await fetch(apiUrl(path), {
    headers: options.body ? { 'content-type': 'application/json' } : {},
    credentials: isRemoteEngine() ? 'omit' : 'same-origin',
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  let payload = null;
  try { payload = await res.json(); } catch { /* empty body */ }

  if (!res.ok) {
    if (res.status === 401 && payload?.locked) {
      showLockScreen();
      throw new Error('Signed out.');
    }
    throw new Error(payload?.error || `Request failed (${res.status})`);
  }
  return payload;
}

/* ────────────────────────── Saving to disk ─────────────────────────── */

/**
 * Pulls the finished file and hands it to the browser.
 *
 * The obvious approach — an <a download> pointing at the engine — silently
 * fails whenever the interface and the engine are on different origins: the
 * `download` attribute is ignored cross-origin, so it degrades to a navigation,
 * and browsers block navigations that are not tied to a user gesture. Fetching
 * the bytes and saving from a blob: URL sidesteps both problems, and gives us
 * real transfer progress as a bonus.
 */
async function saveFile(fileUrl, filename, onProgress) {
  const res = await fetch(apiUrl(fileUrl), {
    credentials: isRemoteEngine() ? 'omit' : 'same-origin',
  });
  if (!res.ok) throw new Error(`Could not fetch the file (${res.status}).`);

  const total = Number(res.headers.get('content-length')) || 0;
  let blob;

  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      onProgress?.(total ? (received / total) * 100 : null, received, total);
    }
    blob = new Blob(chunks);
  } else {
    blob = await res.blob();
  }

  const objectUrl = URL.createObjectURL(blob);
  const anchor = el('a', { href: objectUrl, download: filename || 'download', rel: 'noopener' });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Give the browser time to start writing before the blob is reclaimed.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 120_000);
}

/* ────────────────────────────── Toasts ─────────────────────────────── */

function toast(message, tone = 'info', ms = 4600) {
  const node = el('div', { class: 'toast', dataset: { tone }, role: 'status' },
    el('i'),
    el('p', { text: message }),
  );
  $('toasts').append(node);

  const remove = () => {
    node.dataset.leaving = 'true';
    setTimeout(() => node.remove(), 200);
  };
  const timer = setTimeout(remove, ms);
  node.addEventListener('click', () => { clearTimeout(timer); remove(); });
  return node;
}

/* ─────────────────────────── Capture bar ───────────────────────────── */

const urlInput = $('urlInput');
const goButton = $('goButton');
const captureShell = $('captureShell');
const platformBadge = $('platformBadge');
const captureHint = $('captureHint');
const clearInputBtn = $('clearInput');
const stage = $('stage');

const DEFAULT_HINT = captureHint.innerHTML;

function setHint(message, tone = '') {
  if (!message) {
    captureHint.innerHTML = DEFAULT_HINT;
    captureHint.removeAttribute('data-tone');
    return;
  }
  clear(captureHint);
  captureHint.append(document.createTextNode(message));
  if (tone) captureHint.dataset.tone = tone;
  else captureHint.removeAttribute('data-tone');
}

function refreshBadge() {
  const value = urlInput.value.trim();
  clearInputBtn.hidden = value.length === 0;
  const label = platformBadge.querySelector('.badge-label');

  if (!value) {
    platformBadge.dataset.state = 'empty';
    label.textContent = 'Link';
    setAccent(DEFAULT_ACCENT);
    return;
  }

  const platform = detect(value);
  if (!platform) {
    platformBadge.dataset.state = 'empty';
    label.textContent = 'Link';
    setAccent(DEFAULT_ACCENT);
    return;
  }

  platformBadge.dataset.state = 'detected';
  label.textContent = platform.name;
  setAccent(platform.accent);
}

urlInput.addEventListener('input', refreshBadge);

clearInputBtn.addEventListener('click', () => {
  urlInput.value = '';
  refreshBadge();
  setHint(null);
  clear(stage);
  urlInput.focus();
});

$('pasteButton').addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (!text?.trim()) {
      toast('Your clipboard is empty.', 'error');
      return;
    }
    urlInput.value = text.trim();
    refreshBadge();
    submit();
  } catch {
    urlInput.focus();
    toast('Clipboard access was blocked — paste with Ctrl+V.', 'error');
  }
});

$('captureForm').addEventListener('submit', (event) => {
  event.preventDefault();
  submit();
});

document.addEventListener('paste', (event) => {
  const target = event.target;
  if (target instanceof HTMLElement && /input|textarea/i.test(target.tagName) && target !== urlInput) return;

  const text = event.clipboardData?.getData('text')?.trim();
  if (!text || !detect(text)) return;

  event.preventDefault();
  urlInput.value = text;
  refreshBadge();
  submit();
});

document.addEventListener('keydown', (event) => {
  if (event.key === '/' && document.activeElement !== urlInput) {
    const tag = document.activeElement?.tagName ?? '';
    if (/input|textarea/i.test(tag)) return;
    event.preventDefault();
    urlInput.focus();
    urlInput.select();
  }
  if (event.key === 'Escape' && document.activeElement === urlInput) urlInput.blur();
});

/* ──────────────────────────── Resolve flow ─────────────────────────── */

function setBusy(busy) {
  goButton.dataset.loading = busy ? 'true' : 'false';
  goButton.disabled = busy;
  captureShell.dataset.busy = busy ? 'true' : 'false';
  stage.setAttribute('aria-busy', busy ? 'true' : 'false');
}

function renderSkeleton() {
  clear(stage);
  stage.append(
    el('div', { class: 'panel' },
      el('div', { class: 'skeleton' },
        el('div', { class: 'skeleton-thumb' }),
        el('div', { class: 'skeleton-lines' },
          el('div', { class: 'skeleton-line w-90' }),
          el('div', { class: 'skeleton-line w-40' }),
          el('div', { class: 'skeleton-line w-70' }),
          el('div', { class: 'skeleton-line tall' }),
        ),
      ),
    ),
  );
}

function renderError(message) {
  clear(stage);
  stage.append(
    el('div', { class: 'panel' },
      el('div', { class: 'error-panel' },
        el('div', { class: 'error-icon', svg: ICON.alert }),
        el('div', { class: 'error-body' },
          el('h3', { text: "That didn't work" }),
          el('p', { text: message }),
        ),
      ),
    ),
  );
}

async function submit({ forcePlaylist = false } = {}) {
  const value = urlInput.value.trim();
  if (!value) {
    urlInput.focus();
    setHint('Paste a link first.', 'error');
    return;
  }
  if (!detect(value)) {
    setHint("That doesn't look like a link.", 'error');
    platformBadge.dataset.state = 'invalid';
    return;
  }

  const token = ++state.resolveToken;
  state.activeJob = null;
  setHint(null);
  setBusy(true);
  renderSkeleton();

  try {
    const result = await api('/api/resolve', {
      method: 'POST',
      body: { url: value, playlist: forcePlaylist, container: state.choice?.container ?? 'mp4' },
    });
    if (token !== state.resolveToken) return;

    state.result = result;
    setAccent(result.accent);
    renderResult(result);
  } catch (err) {
    if (token !== state.resolveToken) return;
    renderError(err.message);
    setHint(null);
  } finally {
    if (token === state.resolveToken) setBusy(false);
  }
}

/* ───────────────────────── Result rendering ────────────────────────── */

function defaultChoice(result) {
  const audioOnly = Boolean(result.audioOnly) || !result.formats.video.length;
  const mode = audioOnly ? 'audio' : 'video';
  const list = mode === 'audio' ? result.formats.audio : result.formats.video;
  const preferred = list.find((o) => o.recommended) ?? list[0];

  return {
    mode,
    quality: preferred?.id ?? null,
    selector: preferred?.selector ?? null,
    container: 'mp4',
    subtitleLang: '',
    embedThumbnail: true,
    embedMetadata: true,
    embedChapters: result.chapters > 0,
    writeThumbnailFile: false,
    sponsorBlock: false,
    trimStart: '',
    trimEnd: '',
    selected: result.entries?.length ? new Set(result.entries.map((e) => e.index)) : null,
  };
}

function artShape(result) {
  if (result.platform === 'spotify' || result.platform === 'appleMusic') return 'square';
  if (result.platform === 'tiktok') return 'portrait';
  return 'wide';
}

function renderResult(result) {
  state.choice = defaultChoice(result);

  const panel = el('div', { class: 'panel' });
  const body = el('div', { class: 'result' });

  /* ── Artwork ── */
  const art = el('div', { class: 'result-art', dataset: { shape: artShape(result) } });
  if (result.thumbnail) {
    art.append(el('img', {
      src: result.thumbnail,
      alt: '',
      loading: 'lazy',
      referrerpolicy: 'no-referrer',
      onerror(event) {
        event.target.replaceWith(el('div', { class: 'art-fallback', svg: ICON.film }));
      },
    }));
  } else {
    art.append(el('div', { class: 'art-fallback', svg: ICON.film }));
  }

  art.append(el('span', { class: 'art-platform' }, el('i'), result.platformName));

  const runtime = result.isCollection ? longDuration(result.duration) : duration(result.duration);
  if (runtime) art.append(el('span', { class: 'art-duration', text: runtime }));

  body.append(art);

  /* ── Main column ── */
  const main = el('div', { class: 'result-main' });
  main.append(el('h2', { class: 'result-title', text: result.title }));

  const meta = el('div', { class: 'result-meta' });
  const metaBits = [];
  if (result.uploader) metaBits.push(el('strong', { text: result.uploader }));
  if (result.isCollection) metaBits.push(`${result.itemCount} item${result.itemCount === 1 ? '' : 's'}`);
  if (result.uploadDate) metaBits.push(result.uploadDate);
  if (Number.isFinite(result.viewCount)) metaBits.push(`${compactCount(result.viewCount)} views`);
  if (result.chapters > 0) metaBits.push(`${result.chapters} chapters`);

  metaBits.forEach((bit, index) => {
    if (index > 0) meta.append(el('span', { class: 'sep', text: '·' }));
    meta.append(bit);
  });
  if (metaBits.length) main.append(meta);

  /* Only notices that tell you something you can act on. */
  for (const notice of [result.notice, ...(result.notices ?? [])].filter(Boolean)) {
    main.append(
      el('div', { class: 'notice', dataset: { tone: notice.tone ?? 'info' } },
        el('span', { class: 'notice-mark' }),
        el('div', {},
          el('h4', { text: notice.title }),
          el('p', { text: notice.body }),
        ),
      ),
    );
  }

  if (result.embeddedPlaylist) {
    main.append(
      el('div', { class: 'notice' },
        el('span', { class: 'notice-mark' }),
        el('div', {},
          el('h4', { text: 'This link is part of a playlist' }),
          el('p', {},
            'Showing the single item. ',
            el('button', {
              class: 'link-button',
              type: 'button',
              text: 'Load the whole playlist instead',
              onclick: () => submit({ forcePlaylist: true }),
            }),
          ),
        ),
      ),
    );
  }

  /* ── Mode segments ── */
  const modes = [
    { id: 'video', label: 'Video', icon: ICON.video, enabled: result.formats.video.length > 0 },
    { id: 'audio', label: 'Audio', icon: ICON.audio, enabled: result.formats.audio.length > 0 },
    { id: 'thumbnail', label: 'Cover', icon: ICON.image, enabled: !result.audioOnly && Boolean(result.thumbnail) },
  ].filter((m) => m.enabled);

  const segments = el('div', { class: 'segments', role: 'tablist' });
  const pill = el('span', { class: 'segment-pill' });
  segments.append(pill);

  const segmentButtons = modes.map((mode) =>
    el('button', {
      class: 'segment',
      type: 'button',
      role: 'tab',
      'aria-selected': String(state.choice.mode === mode.id),
      onclick: () => selectMode(mode.id),
    },
      el('span', { svg: mode.icon }),
      mode.label,
    ),
  );
  segments.append(...segmentButtons);
  if (modes.length > 1) main.append(segments);

  const optionsHost = el('div');
  const advancedHost = el('div');
  const actionHost = el('div');
  main.append(optionsHost, advancedHost, actionHost);

  body.append(main);
  panel.append(body);

  let trackListHost = null;
  if (result.entries?.length) {
    trackListHost = el('div', { class: 'tracks' });
    panel.append(trackListHost);
  }

  clear(stage);
  stage.append(panel);

  /* ── Wiring ── */
  function positionPill() {
    const active = segmentButtons[modes.findIndex((m) => m.id === state.choice.mode)];
    if (!active) return;
    pill.style.width = `${active.offsetWidth}px`;
    pill.style.transform = `translateX(${active.offsetLeft - 3}px)`;
  }

  function selectMode(mode) {
    state.choice.mode = mode;
    const list = mode === 'audio' ? result.formats.audio : result.formats.video;
    const preferred = list.find((o) => o.recommended) ?? list[0];
    state.choice.quality = preferred?.id ?? null;
    state.choice.selector = preferred?.selector ?? null;

    segmentButtons.forEach((button, index) => {
      button.setAttribute('aria-selected', String(modes[index].id === mode));
    });
    positionPill();
    renderOptions();
    renderAdvanced();
    renderAction();
  }

  function renderOptions() {
    clear(optionsHost);
    const mode = state.choice.mode;

    if (mode === 'thumbnail') {
      optionsHost.append(
        el('div', { class: 'field' },
          el('div', { class: 'field-label' }, el('span', { text: 'Artwork' })),
          el('p', { class: 'switch-desc', text: 'Saves the highest-resolution cover image published for this item, as a JPG.' }),
        ),
      );
      return;
    }

    const list = mode === 'audio' ? result.formats.audio : result.formats.video;
    if (!list.length) return;

    const label = el('div', { class: 'field-label' },
      el('span', { text: mode === 'audio' ? 'Audio quality' : 'Video quality' }),
    );
    if (mode === 'video' && result.generic) {
      label.append(el('span', { class: 'field-note', text: 'per-item best match' }));
    }
    if (mode === 'audio' && result.formats.sourceAudioKbps) {
      label.append(el('span', { class: 'field-note', text: `source ≈ ${result.formats.sourceAudioKbps} kbps` }));
    }

    const options = el('div', { class: 'options', role: 'group' });

    for (const option of list) {
      const selected = option.id === state.choice.quality;
      const sub = [];

      if (option.kind === 'video') {
        if (option.fps && option.fps >= 50) sub.push(`${option.fps}fps`);
        if (option.codec) sub.push(option.codec);
        if (option.hdr) sub.push(option.hdr);
        const size = bytes(option.size);
        if (size) sub.push(`${option.sizeIsEstimate ? '≈' : ''}${size}`);
      } else {
        if (option.detail) sub.push(option.detail);
        const size = bytes(option.size);
        if (size && !result.isCollection) sub.push(`≈${size}`);
        if (option.note) sub.push(option.note);
      }

      options.append(el('button', {
        class: 'option',
        type: 'button',
        'aria-pressed': String(selected),
        onclick: () => {
          state.choice.quality = option.id;
          state.choice.selector = option.selector ?? null;
          renderOptions();
          renderAction();
        },
      },
        el('span', { class: 'option-top' },
          el('span', { class: 'option-label', text: option.label }),
          option.badge ? el('span', { class: 'option-tag', text: option.badge }) : null,
        ),
        sub.length ? el('span', { class: 'option-sub', text: sub.join(' · ') }) : null,
        option.recommended ? el('span', { class: 'option-star' }) : null,
      ));
    }

    optionsHost.append(el('div', { class: 'field' }, label, options));
  }

  function switchRow(key, title, description, { disabled = false } = {}) {
    const input = el('input', {
      type: 'checkbox',
      checked: Boolean(state.choice[key]),
      disabled,
      onchange: (event) => { state.choice[key] = event.target.checked; },
    });
    return el('label', { class: 'switch' },
      input,
      el('span', { class: 'switch-box', svg: ICON.check }),
      el('span', { class: 'switch-text' },
        el('span', { class: 'switch-title', text: title }),
        el('span', { class: 'switch-desc', text: description }),
      ),
    );
  }

  function renderAdvanced() {
    clear(advancedHost);
    if (state.choice.mode === 'thumbnail') return;

    const isVideo = state.choice.mode === 'video';
    const wrap = el('div', { class: 'advanced', dataset: { open: 'false' } });

    const toggle = el('button', {
      class: 'advanced-toggle',
      type: 'button',
      onclick: () => { wrap.dataset.open = wrap.dataset.open === 'true' ? 'false' : 'true'; },
    }, el('span', { svg: ICON.chevron }), 'More options');

    const grid = el('div', { class: 'switch-grid' });

    grid.append(switchRow('embedThumbnail', 'Embed cover art',
      isVideo ? 'Adds the thumbnail as the file poster.' : 'Adds the artwork inside the audio file.',
      { disabled: !state.ffmpeg }));
    grid.append(switchRow('embedMetadata', 'Write tags',
      'Stores title, artist and source inside the file.'));

    if (isVideo && result.chapters > 0) {
      grid.append(switchRow('embedChapters', 'Keep chapters',
        `${result.chapters} chapter markers stay navigable.`, { disabled: !state.ffmpeg }));
    }
    grid.append(switchRow('writeThumbnailFile', 'Save cover separately',
      'Also writes the artwork as its own image file.'));
    if (isVideo && result.platform === 'youtube') {
      grid.append(switchRow('sponsorBlock', 'Skip sponsor segments',
        'Cuts sponsorships and intros using SponsorBlock data.', { disabled: !state.ffmpeg }));
    }

    const inner = el('div', { class: 'advanced-body' }, grid);
    const inline = el('div', { class: 'inline-fields' });

    if (isVideo && !result.audioOnly) {
      const select = el('select', {
        onchange: (event) => {
          state.choice.container = event.target.value;
          const current = result.formats.video.find((o) => o.id === state.choice.quality);
          state.choice.selector = current?.selector ?? null;
        },
      });
      for (const container of state.containers) {
        select.append(el('option', {
          value: container.id,
          selected: container.id === state.choice.container,
          text: `${container.label} — ${container.detail}`,
        }));
      }
      inline.append(el('label', { class: 'inline-field' }, el('span', { text: 'Container' }), select));
    }

    if (isVideo && result.subtitles?.length) {
      const select = el('select', {
        onchange: (event) => { state.choice.subtitleLang = event.target.value; },
      });
      select.append(el('option', { value: '', text: 'None' }));
      for (const sub of result.subtitles.slice(0, 20)) {
        select.append(el('option', { value: sub.code, text: `${sub.code}${sub.auto ? ' (auto)' : ''}` }));
      }
      inline.append(el('label', { class: 'inline-field' }, el('span', { text: 'Subtitles' }), select));
    }

    if (!result.isCollection && state.ffmpeg && result.duration) {
      inline.append(
        el('label', { class: 'inline-field' },
          el('span', { text: 'Clip from' }),
          el('input', {
            type: 'text', placeholder: '0:00', value: state.choice.trimStart,
            oninput: (event) => { state.choice.trimStart = event.target.value; },
          }),
        ),
        el('label', { class: 'inline-field' },
          el('span', { text: 'Clip to' }),
          el('input', {
            type: 'text', placeholder: duration(result.duration) ?? 'end', value: state.choice.trimEnd,
            oninput: (event) => { state.choice.trimEnd = event.target.value; },
          }),
        ),
      );
    }

    if (inline.children.length) inner.append(inline);
    if (!state.ffmpeg) {
      inner.append(el('p', {
        class: 'switch-desc',
        style: 'margin-top:12px',
        text: 'ffmpeg was not found, so conversion, clipping and embedding are unavailable.',
      }));
    }

    wrap.append(toggle, inner);
    advancedHost.append(wrap);
  }

  function currentOption() {
    const list = state.choice.mode === 'audio' ? result.formats.audio : result.formats.video;
    return list.find((o) => o.id === state.choice.quality) ?? null;
  }

  function renderAction() {
    clear(actionHost);

    const option = currentOption();
    const count = state.choice.selected ? state.choice.selected.size : 1;

    let label = 'Download';
    if (state.choice.mode === 'thumbnail') label = 'Download cover';
    else if (result.isCollection) label = `Download ${count} item${count === 1 ? '' : 's'}`;
    else if (option) label = `Download ${option.label}`;

    const sizeText = !result.isCollection && option?.size
      ? `${option.sizeIsEstimate ? '≈' : ''}${bytes(option.size)}`
      : null;

    const button = el('button', {
      class: 'download-button',
      type: 'button',
      disabled: result.isCollection && count === 0,
      onclick: () => runDownload(result, actionHost, renderAction),
    },
      el('span', { svg: ICON.download }),
      label,
      sizeText ? el('span', { class: 'download-size', text: sizeText }) : null,
    );

    const copy = el('button', {
      class: 'secondary-button',
      type: 'button',
      title: 'Copy the source link',
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(result.url);
          toast('Link copied.', 'good', 2200);
        } catch {
          toast('Could not access the clipboard.', 'error');
        }
      },
    }, el('span', { svg: ICON.copy }));

    actionHost.append(el('div', { class: 'action-row' }, button, copy));
  }

  function renderTracks() {
    if (!trackListHost) return;
    clear(trackListHost);
    const selected = state.choice.selected;

    const head = el('div', { class: 'tracks-head' },
      el('span', { class: 'tracks-title', text: `${selected.size} of ${result.entries.length} selected` }),
      el('div', { class: 'tracks-tools' },
        el('button', {
          class: 'link-button', type: 'button', text: 'All',
          onclick: () => { result.entries.forEach((e) => selected.add(e.index)); renderTracks(); renderAction(); },
        }),
        el('button', {
          class: 'link-button', type: 'button', text: 'None',
          onclick: () => { selected.clear(); renderTracks(); renderAction(); },
        }),
      ),
    );

    const list = el('ul', { class: 'tracks-list' });

    for (const entry of result.entries) {
      const row = el('li', { class: 'track' });
      const checkbox = el('input', {
        type: 'checkbox',
        checked: selected.has(entry.index),
        onchange: (event) => {
          if (event.target.checked) selected.add(entry.index);
          else selected.delete(entry.index);
          head.querySelector('.tracks-title').textContent =
            `${selected.size} of ${result.entries.length} selected`;
          renderAction();
        },
      });

      row.append(
        el('label', { class: 'switch', style: 'border:none;background:none;padding:0' },
          checkbox,
          el('span', { class: 'switch-box', svg: ICON.check }),
        ),
        el('span', { class: 'track-index', text: String(entry.index) }),
      );

      if (entry.thumbnail) {
        row.append(el('img', {
          class: 'track-art', src: entry.thumbnail, alt: '', loading: 'lazy',
          referrerpolicy: 'no-referrer',
          onerror: (event) => event.target.remove(),
        }));
      }

      row.append(
        el('div', { class: 'track-text' },
          el('div', { class: 'track-name', text: entry.title }),
          entry.uploader ? el('div', { class: 'track-by', text: entry.uploader }) : null,
        ),
        el('span', { class: 'track-time', text: duration(entry.duration) ?? '' }),
      );

      list.append(row);
    }

    trackListHost.append(head, list);
  }

  renderOptions();
  renderAdvanced();
  renderAction();
  renderTracks();
  requestAnimationFrame(positionPill);
  repositionPill = positionPill;
}

/** Set by the active result card so the segment pill tracks window resizes. */
let repositionPill = null;
window.addEventListener('resize', () => repositionPill?.(), { passive: true });

/* ────────────────────────── Download, inline ───────────────────────── */

const ACTIVE_STATES = new Set(['queued', 'preparing', 'downloading', 'processing', 'packaging']);

/**
 * Runs a download to completion in place of the button, then saves the file.
 * There is no queue and no history: one link, one result, done.
 */
async function runDownload(result, host, restore) {
  const choice = state.choice;

  const selectedItems = choice.selected && choice.selected.size < (result.entries?.length ?? 0)
    ? [...choice.selected].sort((a, b) => a - b)
    : null;

  clear(host);
  const bar = el('span');
  const label = el('span', { class: 'progress-label', text: 'Starting…' });
  const detail = el('span', { class: 'progress-detail' });

  const cancelButton = el('button', {
    class: 'secondary-button', type: 'button', title: 'Cancel',
    svg: ICON.stop,
  });

  host.append(
    el('div', { class: 'progress-row' },
      el('div', { class: 'progress-block' },
        el('div', { class: 'progress-head' }, label, detail),
        el('div', { class: 'progress-track' }, bar),
      ),
      cancelButton,
    ),
  );

  const setProgress = (percent) => {
    bar.style.width = `${Math.max(0, Math.min(100, percent ?? 0))}%`;
  };

  let job;
  try {
    job = await api('/api/jobs', {
      method: 'POST',
      body: {
        url: result.url,
        mode: choice.mode,
        quality: choice.quality,
        selector: choice.mode === 'video' ? choice.selector : null,
        container: choice.container,
        playlist: result.isCollection,
        items: selectedItems,
        subtitleLang: choice.subtitleLang || null,
        embedSubtitles: Boolean(choice.subtitleLang) && choice.mode === 'video',
        embedThumbnail: choice.embedThumbnail,
        embedMetadata: choice.embedMetadata,
        embedChapters: choice.embedChapters,
        writeThumbnailFile: choice.writeThumbnailFile,
        sponsorBlock: choice.sponsorBlock,
        trim: (choice.trimStart || choice.trimEnd)
          ? { start: choice.trimStart || null, end: choice.trimEnd || null }
          : null,
        title: result.title,
        subtitle: result.uploader ?? '',
        thumbnail: result.thumbnail,
        duration: result.duration,
        itemCount: selectedItems?.length ?? result.itemCount,
      },
    });
  } catch (err) {
    restore();
    toast(err.message, 'error', 7000);
    return;
  }

  state.activeJob = job.id;
  cancelButton.onclick = () => {
    api(`/api/jobs/${job.id}/cancel`, { method: 'POST' }).catch(() => {});
    label.textContent = 'Cancelling…';
  };

  /* Follow the job to completion. */
  let final;
  try {
    final = await followJob(job.id, (state_) => {
      const p = state_.progress?.percent;
      setProgress(p);
      label.textContent = state_.phase || state_.status;

      const bits = [];
      if (Number.isFinite(p)) bits.push(`${p.toFixed(p < 10 ? 1 : 0)}%`);
      if (state_.progress?.speed) bits.push(`${bytes(state_.progress.speed)}/s`);
      if (state_.progress?.eta) bits.push(eta(state_.progress.eta));
      detail.textContent = bits.join(' · ');
    });
  } catch (err) {
    restore();
    toast(err.message, 'error', 7000);
    return;
  }

  if (final.status === 'canceled') {
    restore();
    return;
  }
  if (final.status === 'error') {
    restore();
    renderErrorNotice(host, final.error ?? 'The download failed.');
    return;
  }

  /* Transfer the finished file to the browser. */
  cancelButton.remove();
  const target = final.archive ?? final.files[0];
  if (!target) {
    restore();
    toast('The download produced no file.', 'error');
    return;
  }

  label.textContent = 'Saving to your device…';
  detail.textContent = '';
  setProgress(0);

  try {
    await saveFile(target.url, target.name, (percent, received, total) => {
      setProgress(percent);
      detail.textContent = total
        ? `${bytes(received)} of ${bytes(total)}`
        : bytes(received) ?? '';
    });
  } catch (err) {
    restore();
    toast(err.message, 'error', 7000);
    return;
  }

  /* Done. */
  clear(host);
  host.append(
    el('div', { class: 'action-row' },
      el('div', { class: 'saved-banner' },
        el('span', { class: 'saved-check', svg: ICON.check }),
        el('div', {},
          el('strong', { text: final.files.length > 1 ? `Saved ${final.files.length} files` : 'Saved' }),
          el('span', { class: 'saved-name', text: target.name }),
        ),
      ),
      el('button', {
        class: 'secondary-button', type: 'button', text: 'Again',
        onclick: () => restore(),
      }),
    ),
  );
  state.activeJob = null;
}

function renderErrorNotice(host, message) {
  const existing = host.parentElement?.querySelector('.inline-error');
  if (existing) existing.remove();
  const node = el('div', { class: 'notice inline-error', dataset: { tone: 'warn' } },
    el('span', { class: 'notice-mark' }),
    el('div', {},
      el('h4', { text: "That didn't work" }),
      el('p', { text: message }),
    ),
  );
  host.parentElement?.insertBefore(node, host);
}

/**
 * Watches one job until it finishes. Uses the live stream when it is available
 * and falls back to polling, so a proxy that buffers events cannot leave the
 * interface stuck on "Starting".
 */
function followJob(id, onUpdate) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let source = null;
    let poller = null;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      try { source?.close(); } catch { /* already closed */ }
      clearInterval(poller);
      fn(value);
    };

    const consider = (job) => {
      if (!job) return;
      onUpdate(job);
      if (!ACTIVE_STATES.has(job.status)) finish(resolve, job);
    };

    try {
      source = new EventSource(apiUrl(`/api/jobs/${id}/events`));
      source.onmessage = (event) => {
        try { consider(JSON.parse(event.data)); } catch { /* ignore frame */ }
      };
      source.onerror = () => { try { source.close(); } catch { /* noop */ } };
    } catch { /* polling still covers it */ }

    // Polling is the safety net, not the primary path.
    poller = setInterval(async () => {
      try {
        consider(await api(`/api/jobs/${id}`));
      } catch (err) {
        finish(reject, err);
      }
    }, 1200);
  });
}

/* ─────────────────────────── Lock screen ───────────────────────────── */

function showLockScreen(message = null) {
  if (document.querySelector('#lockScreen')) return;

  const input = el('input', {
    type: 'password', id: 'lockInput', class: 'capture-input',
    placeholder: 'Password', autocomplete: 'current-password', 'aria-label': 'Access password',
  });
  const error = el('p', { class: 'capture-hint', dataset: { tone: 'error' }, text: message ?? '' });

  const submitPassword = async (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (!value) { input.focus(); return; }
    try {
      const res = await fetch(apiUrl('/api/unlock'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: isRemoteEngine() ? 'omit' : 'same-origin',
        body: JSON.stringify({ password: value }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        error.textContent = payload?.error ?? 'Wrong password.';
        input.select();
        return;
      }
      overlay.remove();
      boot();
    } catch {
      error.textContent = 'Could not reach the server.';
    }
  };

  const overlay = el('div', { class: 'lock-overlay', id: 'lockScreen' },
    el('form', { class: 'lock-card', onsubmit: submitPassword },
      el('div', { class: 'lock-mark', svg: ICON.lock }),
      el('h2', { class: 'lock-title', text: 'This Stash is private' }),
      el('p', { class: 'lock-sub', text: 'Enter the password to continue.' }),
      el('div', { class: 'capture-shell' },
        input,
        el('button', { class: 'go-button', type: 'submit' }, el('span', { class: 'go-label', text: 'Unlock' })),
      ),
      error,
    ),
  );

  document.body.append(overlay);
  requestAnimationFrame(() => input.focus());
}

/* ────────────────────────── Engine setup ───────────────────────────── */

function showEngineSetup(message = null) {
  if (document.querySelector('#engineSetup')) return;

  const input = el('input', {
    type: 'url', id: 'engineInput', class: 'capture-input',
    placeholder: 'https://your-tunnel.trycloudflare.com',
    spellcheck: 'false', value: engineBase(), 'aria-label': 'Engine address',
  });
  const note = el('p', { class: 'capture-hint', text: message ?? '' });
  if (message) note.dataset.tone = 'error';

  const connect = async (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (!value) { input.focus(); return; }

    note.textContent = 'Connecting…';
    note.removeAttribute('data-tone');
    const previous = engineBase();
    setEngineBase(value);

    try {
      const health = await api('/api/health');
      if (!health?.ok) throw new Error('That address answered, but not like a Stash engine.');
      overlay.remove();
      boot();
    } catch (err) {
      setEngineBase(previous);
      note.textContent = /failed|fetch/i.test(err.message)
        ? 'Could not reach that address. Check the engine is running and the URL is exact.'
        : err.message;
      note.dataset.tone = 'error';
    }
  };

  const overlay = el('div', { class: 'lock-overlay', id: 'engineSetup' },
    el('form', { class: 'lock-card', onsubmit: connect },
      el('div', { class: 'lock-mark', svg: ICON.link }),
      el('h2', { class: 'lock-title', text: 'Connect to your downloader' }),
      el('p', { class: 'lock-sub', text: 'This page is the interface. Point it at the engine that does the downloading.' }),
      el('div', { class: 'capture-shell' },
        input,
        el('button', { class: 'go-button', type: 'submit' }, el('span', { class: 'go-label', text: 'Connect' })),
      ),
      note,
      el('p', {
        class: 'cookie-warn',
        text: 'Run "npm start" then "npm run tunnel" on the machine that holds your files, and paste the https:// address it prints. It is remembered in this browser.',
      }),
    ),
  );

  document.body.append(overlay);
  requestAnimationFrame(() => input.focus());
}

/* ─────────────────────────────── Theme ─────────────────────────────── */

const THEME_KEY = 'stash:theme';

function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else document.documentElement.removeAttribute('data-theme');
}

applyTheme(localStorage.getItem(THEME_KEY) ?? '');

$('themeToggle').addEventListener('click', () => {
  const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
  const current = document.documentElement.dataset.theme || (prefersLight ? 'light' : 'dark');
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem(THEME_KEY, next);
});

/* ────────────────────────────── Startup ────────────────────────────── */

function renderPlatformStrip(featured) {
  const strip = $('platformStrip');
  clear(strip);
  for (const platform of featured) {
    strip.append(el('li', {},
      el('span', { class: 'platform-chip', style: `--chip:${platform.accent}` },
        el('i'), platform.name),
    ));
  }
  strip.append(el('li', {}, el('span', { class: 'platform-chip is-more', text: '+1800 more' })));
}

function showStatus(text, tone) {
  const pill = $('statusPill');
  pill.hidden = false;
  pill.dataset.tone = tone;
  pill.querySelector('.status-text').textContent = text;
}

async function boot() {
  if (/Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)) {
    const key = $('pasteKey');
    if (key) key.textContent = '⌘';
  }

  try {
    const health = await api('/api/health');
    if (health.locked) {
      showLockScreen();
      return;
    }
    state.ffmpeg = health.binaries.ffmpeg.ok;
    if (!health.binaries.ytdlp.ok) showStatus('yt-dlp missing', 'bad');
    else if (!health.binaries.ffmpeg.ok) showStatus('no ffmpeg', 'warn');
  } catch {
    showEngineSetup(engineBase() ? 'That engine stopped responding.' : null);
    return;
  }

  try {
    const info = await api('/api/platforms');
    state.platforms = info.detect ?? [];
    state.containers = info.containers ?? [];
    renderPlatformStrip(info.featured ?? []);
  } catch {
    state.containers = [{ id: 'mp4', label: 'MP4', detail: 'plays everywhere' }];
  }

  refreshBadge();
  urlInput.focus();
}

boot();

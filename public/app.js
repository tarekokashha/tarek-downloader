/* ═══════════════════════════════════════════════════════════════════════
   Stash — client
   Everything remote (titles, channel names, filenames) is inserted as text
   nodes, never as markup. The `el()` helper makes that the default path.
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
  trash: '<svg viewBox="0 0 16 16" fill="none"><path d="M3 4.4h10M6.4 4.4V3.2A1 1 0 0 1 7.4 2.2h1.2a1 1 0 0 1 1 1v1.2M4.4 4.4l.6 8a1.2 1.2 0 0 0 1.2 1.1h3.6a1.2 1.2 0 0 0 1.2-1.1l.6-8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  retry: '<svg viewBox="0 0 16 16" fill="none"><path d="M13.2 8a5.2 5.2 0 1 1-1.6-3.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M13.4 2.2v3h-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  archive: '<svg viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="3" rx="1" stroke="currentColor" stroke-width="1.4"/><path d="M3.2 6v6a1.2 1.2 0 0 0 1.2 1.2h7.2a1.2 1.2 0 0 0 1.2-1.2V6" stroke="currentColor" stroke-width="1.4"/><path d="M6.6 9h2.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
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
  if (h > 0) return `${h} hr ${m} min`;
  return `${Math.max(1, m)} min`;
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

/* ──────────────────────── Platform detection ───────────────────────── */

const state = {
  platforms: [],
  accents: {},
  containers: [],
  ffmpeg: true,
  result: null,
  choice: null,
  jobs: new Map(),
  autoSaved: new Set(),
  ownJobs: new Set(),
  resolveToken: 0,
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

/* ───────────────────────────── Networking ──────────────────────────── */

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: options.body ? { 'content-type': 'application/json' } : {},
    credentials: 'same-origin',
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  let payload = null;
  try { payload = await res.json(); } catch { /* empty body */ }

  if (!res.ok) {
    // A protected instance signed us out; show the gate instead of an error.
    if (res.status === 401 && payload?.locked) {
      showLockScreen();
      throw new Error('Signed out.');
    }
    throw new Error(payload?.error || `Request failed (${res.status})`);
  }
  return payload;
}

/* ───────────────────────────── Lock screen ─────────────────────────── */

function showLockScreen(message = null) {
  if (document.querySelector('#lockScreen')) {
    if (message) document.querySelector('#lockError').textContent = message;
    return;
  }

  const input = el('input', {
    type: 'password',
    id: 'lockInput',
    class: 'capture-input',
    placeholder: 'Password',
    autocomplete: 'current-password',
    'aria-label': 'Access password',
  });

  const error = el('p', { class: 'capture-hint', id: 'lockError', dataset: { tone: 'error' }, text: message ?? '' });

  const submit = async (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (!value) { input.focus(); return; }
    try {
      const res = await fetch('/api/unlock', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
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
    el('form', { class: 'lock-card', onsubmit: submit },
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
  clear($('stage'));
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

/* Paste anywhere on the page to fetch immediately. */
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

const stage = $('stage');

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
    embedSubtitles: false,
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
  if (result.platform === 'tiktok' || result.collectionKind === 'reel') return 'portrait';
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

  const runtime = result.isCollection
    ? longDuration(result.duration)
    : duration(result.duration);
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

  /* ── Notices ── */
  for (const notice of [result.notice, ...(result.notices ?? [])].filter(Boolean)) {
    main.append(
      el('div', { class: 'notice', dataset: { tone: notice.tone ?? 'info' } },
        el('span', { class: 'notice-mark' }),
        el('div', {},
          el('h4', { text: notice.title }),
          el('p', { text: notice.body }),
          // A warning you can act on beats one that tells you to edit a file.
          notice.action === 'cookies'
            ? el('button', {
                class: 'link-button',
                type: 'button',
                text: 'Sign in to sites →',
                style: 'margin-top:6px',
                onclick: () => openCookiePanel(),
              })
            : null,
        ),
      ),
    );
  }

  if (result.degraded) {
    main.append(
      el('div', { class: 'notice', dataset: { tone: 'warn' } },
        el('span', { class: 'notice-mark' }),
        el('div', {},
          el('h4', { text: 'Limited metadata' }),
          el('p', { text: 'Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to your .env for full playlists, album names and track numbers.' }),
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

  /* ── Dynamic panels ── */
  const optionsHost = el('div');
  const advancedHost = el('div');
  const actionHost = el('div');
  main.append(optionsHost, advancedHost, actionHost);

  body.append(main);
  panel.append(body);

  /* ── Track list for collections ── */
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

      const button = el('button', {
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
      );

      options.append(button);
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
      onclick: () => {
        wrap.dataset.open = wrap.dataset.open === 'true' ? 'false' : 'true';
      },
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

    const body_ = el('div', { class: 'advanced-body' }, grid);

    /* Inline selects and clip range */
    const inline = el('div', { class: 'inline-fields' });

    if (isVideo && !result.audioOnly) {
      const select = el('select', {
        onchange: (event) => {
          state.choice.container = event.target.value;
          const list = result.formats.video;
          const current = list.find((o) => o.id === state.choice.quality);
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
        select.append(el('option', {
          value: sub.code,
          text: `${sub.code}${sub.auto ? ' (auto)' : ''}`,
        }));
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

    if (inline.children.length) body_.append(inline);

    if (!state.ffmpeg) {
      body_.append(el('p', {
        class: 'switch-desc',
        style: 'margin-top:12px',
        text: 'ffmpeg was not found, so conversion, clipping and embedding are unavailable.',
      }));
    }

    wrap.append(toggle, body_);
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
      onclick: () => startDownload(result),
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
    }, el('span', { svg: ICON.archive }));

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
          onclick: () => {
            result.entries.forEach((e) => selected.add(e.index));
            renderTracks(); renderAction();
          },
        }),
        el('button', {
          class: 'link-button', type: 'button', text: 'None',
          onclick: () => { selected.clear(); renderTracks(); renderAction(); },
        }),
      ),
    );

    const list = el('ul', { class: 'tracks-list' });

    for (const entry of result.entries) {
      const isOn = selected.has(entry.index);
      const row = el('li', { class: 'track' });

      const checkbox = el('input', {
        type: 'checkbox',
        checked: isOn,
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

  // One listener for the page, re-pointed at the current card — adding a new
  // one per render would pile them up for the lifetime of the tab.
  repositionPill = positionPill;
}

/** Set by the active result card so the segment pill tracks window resizes. */
let repositionPill = null;
window.addEventListener('resize', () => repositionPill?.(), { passive: true });

/* ─────────────────────────── Start a download ──────────────────────── */

async function startDownload(result) {
  const choice = state.choice;

  const selectedItems = choice.selected && choice.selected.size < (result.entries?.length ?? 0)
    ? [...choice.selected].sort((a, b) => a - b)
    : null;

  const body = {
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
  };

  try {
    const job = await api('/api/jobs', { method: 'POST', body });
    state.ownJobs.add(job.id);
    upsertJob(job);
    openActivity();
    toast(result.isCollection ? 'Queued — files will appear below.' : 'Started.', 'info', 2600);
  } catch (err) {
    toast(err.message, 'error', 6000);
  }
}

/* ─────────────────────────── Site sign-in ──────────────────────────── */

const STEPS = [
  ['Install the extension', 'In Chrome, add “Get cookies.txt LOCALLY” from the Chrome Web Store. It is open source and exports on your machine only.'],
  ['Open the site, signed in', 'Go to instagram.com (or tiktok.com) in a tab where you are already logged in.'],
  ['Export', 'Click the extension icon → Export. Pick Netscape format if it asks. A cookies.txt downloads.'],
  ['Paste it below', 'Open the file in Notepad, select all, and paste here. Or drag the file straight onto this panel.'],
];

function renderCookieStatus(host, data) {
  clear(host);
  const sites = (data.sites ?? []).filter((s) => ['instagram', 'tiktok', 'youtube'].includes(s.id) || s.present);

  host.append(
    el('div', { class: 'cookie-sites' },
      ...sites.map((site) => {
        const state = site.signedIn ? 'in' : site.present ? 'partial' : 'out';
        return el('span', { class: 'cookie-site', dataset: { state } },
          el('i'),
          site.label,
          site.signedIn ? el('em', { text: 'signed in' })
            : site.present ? el('em', { text: 'cookies only' })
              : el('em', { text: '—' }),
        );
      }),
    ),
  );

  if (data.installed) {
    const when = data.updatedAt ? new Date(data.updatedAt).toLocaleString() : null;
    host.append(el('p', { class: 'cookie-meta' },
      `${data.total} cookies across ${data.domains} domains`,
      when ? ` · added ${when}` : '',
    ));
  }
}

async function openCookiePanel() {
  if (document.querySelector('#cookiePanel')) return;

  let data;
  try {
    data = await api('/api/cookies');
  } catch {
    toast('Could not read cookie status.', 'error');
    return;
  }

  const statusHost = el('div');
  const message = el('p', { class: 'capture-hint', id: 'cookieMsg' });

  const textarea = el('textarea', {
    class: 'cookie-input',
    id: 'cookieInput',
    placeholder: '# Netscape HTTP Cookie File\n.instagram.com\tTRUE\t/\tTRUE\t1800000000\tsessionid\t…',
    spellcheck: 'false',
    'aria-label': 'Paste cookies.txt contents',
  });

  const save = async () => {
    const body = textarea.value.trim();
    if (!body) { textarea.focus(); return; }
    message.textContent = 'Saving…';
    message.removeAttribute('data-tone');
    try {
      const result = await api('/api/cookies', { method: 'POST', body: { content: body } });
      renderCookieStatus(statusHost, result);
      textarea.value = '';
      message.textContent = `Saved ${result.installedCount} cookies. Active immediately — no restart.`;
      message.dataset.tone = 'good';
      refreshCookieDot(result);
      toast('Signed in. Try that link again.', 'good', 5000);
    } catch (err) {
      message.textContent = err.message;
      message.dataset.tone = 'error';
    }
  };

  const clearAll = async () => {
    try {
      const result = await api('/api/cookies', { method: 'DELETE' });
      renderCookieStatus(statusHost, result);
      message.textContent = 'Cookies removed.';
      message.removeAttribute('data-tone');
      refreshCookieDot(result);
    } catch (err) {
      message.textContent = err.message;
      message.dataset.tone = 'error';
    }
  };

  const close = () => overlay.remove();

  const overlay = el('div', {
    class: 'sheet-overlay',
    id: 'cookiePanel',
    onclick: (event) => { if (event.target === overlay) close(); },
  },
    el('div', { class: 'sheet' },
      el('div', { class: 'sheet-head' },
        el('div', {},
          el('h2', { class: 'sheet-title', text: 'Sign in to sites' }),
          el('p', { class: 'sheet-sub', text: 'Instagram and TikTok only serve logged-in clients. This gives Stash your session.' }),
        ),
        el('button', { class: 'icon-button', type: 'button', 'aria-label': 'Close', onclick: close },
          el('span', { svg: '<svg viewBox="0 0 16 16"><path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>' })),
      ),

      statusHost,

      el('div', { class: 'notice', dataset: { tone: 'warn' } },
        el('span', { class: 'notice-mark' }),
        el('div', {},
          el('h4', { text: 'Chrome cannot be read automatically' }),
          el('p', { text: 'Since Chrome 127 the cookie store is encrypted with a key bound to the Chrome process, so no other program can read it — closing Chrome does not help. Exporting the file is the way around it.' }),
        ),
      ),

      el('ol', { class: 'cookie-steps' },
        ...STEPS.map(([title, detail]) => el('li', {},
          el('strong', { text: title }),
          el('span', { text: detail }),
        )),
      ),

      textarea,
      message,

      el('div', { class: 'action-row' },
        el('button', { class: 'download-button', type: 'button', onclick: save },
          el('span', { svg: ICON.check }), 'Save cookies'),
        el('button', { class: 'secondary-button', type: 'button', text: 'Remove', onclick: clearAll }),
      ),

      el('p', { class: 'cookie-warn', text: 'This file is your live session — treat it like a password. It is stored only on this machine, never uploaded, never committed to git, and never shown back to you.' }),
    ),
  );

  // Drag a cookies.txt straight onto the panel.
  overlay.addEventListener('dragover', (event) => { event.preventDefault(); overlay.dataset.drop = 'true'; });
  overlay.addEventListener('dragleave', () => overlay.removeAttribute('data-drop'));
  overlay.addEventListener('drop', async (event) => {
    event.preventDefault();
    overlay.removeAttribute('data-drop');
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    textarea.value = await file.text();
    save();
  });

  document.body.append(overlay);
  renderCookieStatus(statusHost, data);
  requestAnimationFrame(() => textarea.focus());
}

function refreshCookieDot(data) {
  const dot = $('cookieDot');
  if (!dot) return;
  const signedIn = (data?.sites ?? []).some((s) => s.signedIn);
  dot.hidden = !signedIn;
}

$('cookieToggle').addEventListener('click', () => { openCookiePanel(); });

/* ────────────────────────────── Activity ───────────────────────────── */

const activitySection = $('activity');
const activityList = $('activityList');
const activityCount = $('activityCount');

function openActivity() {
  activitySection.hidden = false;
  requestAnimationFrame(() => {
    activitySection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
}

function upsertJob(job) {
  state.jobs.set(job.id, job);
  renderActivity();

  if (job.status === 'done' && state.ownJobs.has(job.id) && !state.autoSaved.has(job.id)) {
    state.autoSaved.add(job.id);
    const single = job.files.length === 1 && !job.archive;
    if (single) {
      saveToDisk(job.files[0].url, job.files[0].name);
      toast(`Saved ${job.files[0].name}`, 'good', 5000);
    } else {
      toast(`Ready — ${job.files.length} files. Use “Download all”.`, 'good', 6000);
    }
  }

  if (job.status === 'error' && state.ownJobs.has(job.id) && !state.autoSaved.has(job.id)) {
    state.autoSaved.add(job.id);
    toast(job.error ?? 'The download failed.', 'error', 8000);
  }
}

function saveToDisk(url, filename) {
  const anchor = el('a', { href: url, download: filename ?? '', rel: 'noopener' });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

const ACTIVE_STATES = new Set(['queued', 'preparing', 'downloading', 'processing', 'packaging']);

function renderActivity() {
  const jobs = [...state.jobs.values()].sort((a, b) => b.createdAt - a.createdAt);

  const active = jobs.filter((j) => ACTIVE_STATES.has(j.status)).length;
  activityCount.hidden = active === 0;
  activityCount.textContent = String(active);

  if (!jobs.length) {
    activitySection.hidden = true;
    return;
  }
  activitySection.hidden = false;

  clear(activityList);
  for (const job of jobs) activityList.append(renderJob(job));
}

function renderJob(job) {
  const isActive = ACTIVE_STATES.has(job.status);
  const row = el('li', {
    class: 'job',
    dataset: { status: job.status, active: String(isActive) },
  });

  /* Artwork */
  if (job.thumbnail) {
    row.append(el('img', {
      class: 'job-art', src: job.thumbnail, alt: '', loading: 'lazy',
      referrerpolicy: 'no-referrer',
      onerror: (event) => event.target.replaceWith(el('div', { class: 'job-art job-art-empty', svg: ICON.film })),
    }));
  } else {
    row.append(el('div', { class: 'job-art job-art-empty', svg: ICON.film }));
  }

  /* Text */
  const line = el('div', { class: 'job-line' });
  const bits = [];

  bits.push(el('span', { class: 'job-phase', text: job.error ?? job.phase ?? job.status }));

  if (isActive && Number.isFinite(job.progress.percent)) {
    bits.push(`${job.progress.percent.toFixed(job.progress.percent < 10 ? 1 : 0)}%`);
  }
  if (isActive && job.progress.speed) bits.push(`${bytes(job.progress.speed)}/s`);
  if (isActive && job.progress.eta) bits.push(eta(job.progress.eta));

  if (!isActive && job.files.length) {
    const total = job.files.reduce((sum, f) => sum + f.size, 0);
    bits.push(`${job.files.length} file${job.files.length === 1 ? '' : 's'}`);
    if (bytes(total)) bits.push(bytes(total));
  }
  if (job.mode) bits.push(job.mode === 'thumbnail' ? 'cover' : job.mode);

  bits.forEach((bit, index) => {
    if (index > 0) line.append(el('span', { class: 'sep', text: '·' }));
    line.append(bit);
  });

  row.append(
    el('div', { class: 'job-body' },
      el('div', { class: 'job-title', text: job.title, title: job.title }),
      line,
    ),
  );

  /* Actions */
  const actions = el('div', { class: 'job-actions' });

  if (isActive) {
    actions.append(el('button', {
      class: 'job-button icon-only danger', type: 'button', title: 'Cancel',
      svg: ICON.stop,
      onclick: () => api(`/api/jobs/${job.id}/cancel`, { method: 'POST' }).catch(() => {}),
    }));
  } else if (job.status === 'done') {
    if (job.archive) {
      actions.append(el('button', {
        class: 'job-button primary', type: 'button',
        onclick: () => saveToDisk(job.archive.url, job.archive.name),
      }, el('span', { svg: ICON.archive }), `Download all · ${bytes(job.archive.size) ?? ''}`));
    } else if (job.files.length === 1) {
      actions.append(el('button', {
        class: 'job-button primary', type: 'button',
        onclick: () => saveToDisk(job.files[0].url, job.files[0].name),
      }, el('span', { svg: ICON.download }), 'Save'));
    }
    actions.append(el('button', {
      class: 'job-button icon-only danger', type: 'button', title: 'Remove',
      svg: ICON.trash,
      onclick: () => removeJob(job.id),
    }));
  } else {
    actions.append(el('button', {
      class: 'job-button icon-only', type: 'button', title: 'Try again',
      svg: ICON.retry,
      onclick: () => {
        urlInput.value = job.url;
        refreshBadge();
        submit();
      },
    }));
    actions.append(el('button', {
      class: 'job-button icon-only danger', type: 'button', title: 'Remove',
      svg: ICON.trash,
      onclick: () => removeJob(job.id),
    }));
  }

  row.append(actions);

  /* Individual files, when there are several */
  if (job.status === 'done' && job.files.length > 1) {
    const files = el('div', { class: 'job-files' });
    for (const file of job.files.slice(0, 24)) {
      files.append(el('button', {
        class: 'job-file', type: 'button', title: file.name,
        onclick: () => saveToDisk(file.url, file.name),
      }, el('span', { text: file.name }), bytes(file.size) ?? ''));
    }
    if (job.files.length > 24) {
      files.append(el('span', { class: 'job-file', text: `+${job.files.length - 24} more` }));
    }
    row.append(files);
  }

  if (job.warnings?.length) {
    row.append(el('div', { class: 'job-warnings', text: job.warnings.join(' · ') }));
  }

  /* Progress hairline */
  const percent = Number.isFinite(job.progress.percent) ? job.progress.percent : (job.status === 'done' ? 100 : 0);
  row.append(el('div', { class: 'job-bar' }, el('span', { style: `width:${Math.max(0, Math.min(100, percent))}%` })));

  return row;
}

async function removeJob(id) {
  state.jobs.delete(id);
  renderActivity();
  try { await api(`/api/jobs/${id}`, { method: 'DELETE' }); } catch { /* already gone */ }
}

$('clearFinished').addEventListener('click', async () => {
  const finished = [...state.jobs.values()].filter((j) => !ACTIVE_STATES.has(j.status));
  for (const job of finished) {
    state.jobs.delete(job.id);
    api(`/api/jobs/${job.id}`, { method: 'DELETE' }).catch(() => {});
  }
  renderActivity();
});

$('activityToggle').addEventListener('click', () => {
  if (!state.jobs.size) {
    toast('No downloads yet.', 'info', 2400);
    return;
  }
  openActivity();
});

/* ───────────────────────── Live job updates ────────────────────────── */

function connectEvents() {
  let source;
  let retry = 1000;

  const open = () => {
    source = new EventSource('/api/events');

    source.onopen = () => { retry = 1000; };

    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.hello) return;
        upsertJob(payload);
      } catch { /* ignore malformed frame */ }
    };

    source.onerror = () => {
      source.close();
      setTimeout(open, retry);
      retry = Math.min(retry * 2, 15_000);
    };
  };

  open();
}

/* ─────────────────────────────── Theme ─────────────────────────────── */

const THEME_KEY = 'stash:theme';

function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.dataset.theme = theme;
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
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

async function boot() {
  if (/Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)) {
    const key = $('pasteKey');
    if (key) key.textContent = '⌘';
  }

  try {
    const info = await api('/api/platforms');
    state.platforms = info.detect ?? [];
    state.containers = info.containers;
    state.ffmpeg = info.ffmpeg;
    renderPlatformStrip(info.featured);
  } catch {
    state.containers = [{ id: 'mp4', label: 'MP4', detail: 'plays everywhere' }];
  }

  try {
    const health = await api('/api/health');
    if (health.locked) {
      showLockScreen();
      return;
    }
    state.ffmpeg = health.binaries.ffmpeg.ok;

    if (!health.binaries.ytdlp.ok) {
      showStatus('yt-dlp missing', 'bad');
      renderError('yt-dlp is not installed. Stop the server, run "npm run setup", then start it again.');
    } else if (!health.binaries.ffmpeg.ok) {
      showStatus('no ffmpeg', 'warn');
    }
  } catch { /* server info is optional */ }

  try {
    refreshCookieDot(await api('/api/cookies'));
  } catch { /* optional */ }

  try {
    const { jobs } = await api('/api/jobs');
    for (const job of jobs) state.jobs.set(job.id, job);
    if (jobs.length) { renderActivity(); state.autoSaved = new Set(jobs.map((j) => j.id)); }
  } catch { /* nothing running */ }

  connectEvents();
  refreshBadge();
  urlInput.focus();
}

function showStatus(text, tone) {
  const pill = $('statusPill');
  pill.hidden = false;
  pill.dataset.tone = tone;
  pill.querySelector('.status-text').textContent = text;
}

function renderPlatformStrip(featured) {
  const strip = $('platformStrip');
  clear(strip);
  for (const platform of featured) {
    strip.append(
      el('li', {},
        el('span', { class: 'platform-chip', style: `--chip:${platform.accent}` },
          el('i'),
          platform.name,
        ),
      ),
    );
  }
  strip.append(el('li', {}, el('span', { class: 'platform-chip is-more', text: '+1800 more' })));
}

boot();

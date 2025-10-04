// media selection priority order:
// 1. override (manual file)
// 2. holiday map (fixed dates)
// 3. easter / thanksgiving (calculated dates)
// 4. date ranges (e.g., halloween week rotation)
// 5. shuffled regular media pool (default)

// note: setting enabled = true will always force this file, regardless of date (for testing)
// override media
const override = {
  enabled: true, // set true to force a specific file
  file: 'maintenance/ps2-error.mp4',
  // legacy date override (kept for backward compatibility); prefer dateOverride below
  date: null,
};

// Date override controller for testing: mode 'auto' | 'on'
// - auto: use the viewer's current local date
// - on: use the provided YYYY-MM-DD string in dateOverride.date
const dateOverride = {
  mode: 'auto', // change to 'on' to override
  // keep a default test date here so you only flip mode
  date: '2025-09-16', // 'YYYY-MM-DD'
};

function getTodayDate() {
  try {
    if (dateOverride && dateOverride.mode === 'on' && dateOverride.date) {
      return new Date(dateOverride.date);
    }
    // fallback to legacy override.date if set
    if (override && override.date) return new Date(override.date);
  } catch (e) {}
  return new Date();
}

// maintenance mode toggle (formerly underConstruction)
const maintenance = {
  // set true to show caution tape + one of the media below
  enabled: false,
  // pool of possible media to display while under construction
  media: [
    'maintenance/grid.png',
    'maintenance/monoscope.png',
    'maintenance/ps1-error.png',
    'maintenance/ps2-error.mp4',
  ]
};

/* media list */
// dynamically populated from assets/videos/index.json by initRegularMedia()
let regularmedia = [];

// Freeze today's channel list so it doesn't expand within the same day
let _frozenDateKey = null;
let _frozenChannels = null;

function _dateKeyUTC(d) { return d.toISOString().slice(0, 10); }
function _dateKeyLocal(d) {
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function _readPinnedChannels(key) {
  try {
    const raw = localStorage.getItem(`pvm_daily_channels:${key}`);
    const arr = JSON.parse(raw || 'null');
    return Array.isArray(arr) ? arr : null;
  } catch (e) { return null; }
}
function _writePinnedChannels(key, list) {
  try { localStorage.setItem(`pvm_daily_channels:${key}`, JSON.stringify(list)); } catch (e) {}
}

async function initRegularMedia() { /* no-op: single-clip mode */ }

// (moved below holiday/config for clarity)

// holiday (mm-dd format) - all holidays and special days
const holiday = {};

// static effect configuration (halloween week)
const staticEffect = {
  enabled: true,  // master toggle for the static intro effect
  mode: 'auto',   // 'auto' | 'on' | 'off' (override the date)
  halloweenWeek: {
    start: '10-25',
    end: '10-31'
  },
  // Use short static burst for channel changes
  introFile: 'static/static-short.mp4', // static intro clip filename (under assets/videos/)
  date: null  // optional: set to 'YYYY-MM-DD' to simulate date for testing
};

// date ranges (e.g., halloween week)
const dateranges = [];

// --- Viewer history (localStorage) ---
function _readSeenList() {
  try {
    const raw = localStorage.getItem('seenVideos') || '[]';
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
function _writeSeenList(list) {
  try { localStorage.setItem('seenVideos', JSON.stringify(list)); } catch (e) {}
}
function getSeenSet() {
  const list = _readSeenList();
  const set = new Set(list);
  return { list, set };
}
function recordVideoSeen(name) {
  if (!name) return;
  const { list, set } = getSeenSet();
  if (!set.has(name)) {
    list.push(name);
    const CAP = 512; // supports 365+ later
    if (list.length > CAP) list.splice(0, list.length - CAP);
    _writeSeenList(list);
  }
}
// expose minimal API for the player
if (typeof window !== 'undefined') {
  window.recordVideoSeen = function noop(){};
  window.getDailyChannelList = function() { return [gettodaysmedia()]; };
}

// Build the day's channel list: exactly 1 new (if available), then previously seen items
function buildDailyChannels(pool, today) {
  const dn = _dayNumberUTC(today);
  const N = pool.length;
  if (N === 0) return [];
  const base = dn % N;
  const { list: seenList, set: seenSet } = getSeenSet();
  const channels = [];

  // 1) Pick today's new item: scan forward from base until we find an unseen
  let newPick = null;
  for (let i = 0; i < N; i++) {
    const name = pool[(base + i) % N];
    if (!seenSet.has(name)) { newPick = name; break; }
  }
  // Fallback: if all seen, pick deterministic base
  if (!newPick) newPick = pool[base];
  channels.push(newPick);

  // 2) Fill the rest with previously seen, most recent first, filtered to items still in pool
  const HISTORY_MAX = 9; // total channels = 1 new + up to 9 seen = 10
  if (seenList && seenList.length) {
    for (let i = seenList.length - 1; i >= 0 && channels.length < (1 + HISTORY_MAX); i--) {
      const name = seenList[i];
      if (name === newPick) continue;
      if (pool.indexOf(name) !== -1 && !channels.includes(name)) channels.push(name);
    }
  }
  return channels;
}

// calculate easter date (gauss's easter algorithm)
function geteasterdate(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

// calculate thanksgiving date (4th thursday of november)
function getthanksgivingdate(year) {
  const firstday = new Date(year, 10, 1).getDay(); // november is month 10 (0-indexed)
  const thursdayoffset = (4 - firstday + 7) % 7; // days until first thursday
  const thanksgivingday = 1 + thursdayoffset + 21; // 4th thursday = 1st thursday + 21 days
  return { month: 11, day: thanksgivingday };
}

// deterministic helpers
function _dayNumberUTC(date) {
  // days since Unix epoch at UTC midnight for deterministic indexing
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
}

function gettodaysmedia() {
  if (override && override.enabled && override.file) return override.file;
  return SINGLE_MEDIA;
}

// check if static effect should be active (halloween week only, with optional forced override)
function isStaticEffectActive() {
  if (!staticEffect.enabled) return false;
  if (staticEffect.mode === 'on') return true;
  if (staticEffect.mode === 'off') return false;
  const today = staticEffect.date ? new Date(staticEffect.date) : new Date();
  const mmdd = today.toISOString().slice(5, 10); // mm-dd
  return mmdd >= staticEffect.halloweenWeek.start && mmdd <= staticEffect.halloweenWeek.end;
}

// export for use in your main script
window.gettodaysmedia = gettodaysmedia;
if (typeof window.getRandomMedia !== 'function') {
  window.getRandomMedia = function getRandomMediaFallback() {
    try { return gettodaysmedia(); } catch (e) { return null; }
  };
}
window.isStaticEffectActive = isStaticEffectActive;
window.getStaticIntroSrc = function getStaticIntroSrc() {
  const file = (staticEffect && staticEffect.introFile) ? staticEffect.introFile : 'static-short.mp4';
  return '/assets/videos/' + file;
};

// expose simple channel offset controls for external handlers (e.g., PVM up/down buttons)
if (typeof window !== 'undefined') {
  if (typeof window.mediaChannelOffset !== 'number') window.mediaChannelOffset = 0;
  window.getMediaChannelOffset = function() { return window.mediaChannelOffset || 0; };
  window.setMediaChannelOffset = function(v) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return;
    window.mediaChannelOffset = n;
  };
  window.bumpMediaChannel = function(delta) {
    const d = parseInt(delta, 10) || 0;
    window.mediaChannelOffset = (window.mediaChannelOffset || 0) + d;
    return window.mediaChannelOffset;
  };
}

function applyMaintenanceUI() {
  const link = document.querySelector('.message a');
  if (!link) return;

  if (maintenance.enabled) {
    link.textContent = '現在工事中です';
    link.removeAttribute('href');
    link.style.pointerEvents = 'none';
    document.body.classList.add('maintenance-on');
  } else {
    // keep homepage message text aligned with index.html
    link.textContent = 'gallery';
    link.setAttribute('href', '/gallery');
    link.style.pointerEvents = '';
    document.body.classList.remove('maintenance-on');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // If maintenance is enabled, prevent access to subpages and send users home
  if (maintenance.enabled) {
    try {
      const isFile = window.location.protocol === 'file:';
      const href = (window.location && window.location.href) || '';
      const path = (window.location && window.location.pathname) || '';
      const isHome = isFile
        ? /(?:\/?index\.html)?$/i.test(href)
        : (path === '/' || /\/index\.html$/i.test(path));
      if (!isHome) {
        // redirect to homepage (file or http)
        if (isFile) {
          window.location.replace('index.html');
        } else {
          window.location.replace('/');
        }
        return; // stop further init on locked pages
      }
    } catch (e) { /* ignore */ }
  }
  applyMaintenanceUI();
  initRegularMedia();
});

window.applyMaintenanceUI = applyMaintenanceUI;

// --- Decoupled Audio Loop (WebAudio) ---
;(function(){
  const AudioLoop = { ctx: null, src: null, gain: null, buf: null };
  function ensureCtx() {
    if (!AudioLoop.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      AudioLoop.ctx = new Ctx();
    }
    return AudioLoop.ctx;
  }
  async function resumeCtx() {
    const ctx = ensureCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') { try { await ctx.resume(); } catch(e) {} }
  }
  async function loadBuffer(url) {
    const ctx = ensureCtx();
    if (!ctx) return null;
    try {
      const res = await fetch(url, { cache: 'force-cache' });
      if (!res.ok) return null;
      const ab = await res.arrayBuffer();
      return await new Promise((resolve, reject)=>ctx.decodeAudioData(ab, resolve, reject));
    } catch (e) { return null; }
  }
  function stop() {
    try { if (AudioLoop.src) AudioLoop.src.stop(); } catch (e) {}
    AudioLoop.src = null;
  }
  async function play(url, loopStart = 0, loopEnd = null) {
    const ctx = ensureCtx();
    if (!ctx) return;
    await resumeCtx();
    const buf = await loadBuffer(url);
    if (!buf) return; // no audio available; stay silent
    stop();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    if (loopEnd != null) { src.loopStart = loopStart || 0; src.loopEnd = loopEnd; }
    const gain = ctx.createGain();
    gain.gain.value = 1;
    src.connect(gain).connect(ctx.destination);
    try { src.start(0); } catch (e) {}
    AudioLoop.src = src; AudioLoop.gain = gain; AudioLoop.buf = buf;
  }
  function getAudioUrlForVideo(name) {
    try { if (window.audioOverrideMap && window.audioOverrideMap[name]) return window.audioOverrideMap[name]; } catch (e) {}
    if (!name) return null;
    const base = String(name).replace(/\.[^.]+$/, '');
    return '/assets/audio/' + base + '.m4a';
  }
  window.audioLoop = { play, stop, resume: resumeCtx };
  window.getAudioUrlForVideo = getAudioUrlForVideo;
})();

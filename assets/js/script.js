/* main script */

// Provide minimal fallbacks when helper scripts are absent
if (typeof window.loadButtonStates !== 'function') {
  window.loadButtonStates = function noopLoadButtonStates() {};
}
if (typeof window.saveButtonStates !== 'function') {
  window.saveButtonStates = function noopSaveButtonStates() {};
}

// dom references
const body = document.body;
const pvmSvgContainer = document.getElementById('pvm-svg-container');

// Preload SonyCam font to avoid swap on first OSD open
(function preloadSonyCamFont(){
  try {
    // Inject a preload link for the OTF
    if (!document.querySelector('link[data-preload-sonycam]')) {
      const link = document.createElement('link');
      link.rel = 'preload';
      link.as = 'font';
      link.href = '/assets/fonts/sonycam.otf';
      link.type = 'font/otf';
      link.setAttribute('data-preload-sonycam','1');
      // omit crossorigin on same-origin
      document.head && document.head.appendChild(link);
    }
    // Kick the CSS Font Loading API
    if (document.fonts && document.fonts.load) {
      document.fonts.load('12px "SonyCam"');
      document.fonts.load('16px "SonyCam"');
    }
  } catch (e) { /* ignore */ }
})();

// Pending timers
let _audioUnmuteTimerId = null;

// --- Small audio helpers for reliable one-shots ---
function stopOneShotByRole(role) {
  try {
    if (!role) return;
    document.querySelectorAll('audio.one-shot-sfx').forEach(el => {
      if (el.dataset && el.dataset.role === role) {
        try { el.pause(); } catch (e) {}
        try { el.currentTime = 0; } catch (e) {}
        try { el.remove(); } catch (e) {}
      }
    });
  } catch (e) {}
}

function stopAllOneShots() {
  try {
    document.querySelectorAll('audio.one-shot-sfx').forEach(el => {
      try { el.pause(); } catch (e) {}
      try { el.currentTime = 0; } catch (e) {}
      try { el.remove(); } catch (e) {}
    });
  } catch (e) {}
}

function playOneShot(audioId, vol = 1.0, role = null) {
  try {
    const base = document.getElementById(audioId);
    if (!base) return;
    // stop any prior sfx for the same role before starting a new one
    if (role) stopOneShotByRole(role);
    const node = base.cloneNode(true); // independent instance
    node.classList.add('one-shot-sfx');
    if (role) node.dataset.role = role;
    node.volume = Math.max(0, Math.min(1, vol));
    node.muted = false;
    node.style.display = 'none';
    if (base.parentNode) base.parentNode.appendChild(node);
    const p = node.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        // ignore NotAllowedError; will succeed on next valid user gesture
      });
    }
    const cleanup = () => { try { node.remove(); } catch (e) {} };
    node.addEventListener('ended', cleanup, { once: true });
    node.addEventListener('error', cleanup, { once: true });
  } catch (e) {}
}

function queueInitialFadeIn() {
  const run = () => {
    requestAnimationFrame(() => {
      try { document.body.classList.remove('loading'); } catch (e) {}
    });
  };
  if (document.readyState === 'complete') {
    run();
  } else {
    window.addEventListener('load', () => {
      setTimeout(run, 10);
    }, { once: true });
  }
}

// ==================
// PVM OSD Menu (DOM)
// ==================
// YouTube support removed; inputs are A (default), B (local), C (local)
let _pvmMenuEl = null;
let _pvmMenuIndex = 0;
let _pvmMenuMode = 'root'; // 'root' or 'change-video'
// Session-scoped geometry defaults and write-arm state
let _sessionGeomDefaults = { a: {}, b: {}, c: {} };
let _sessionWriteArmed = false;     // show 'write' under value when armed
let _sessionStarFlash = false;      // flash '*' next to index for 1s after commit
let _sessionUiClearTimer = null;    // timer to clear write/star
function _ensurePvmMenu() {
  if (_pvmMenuEl && _pvmMenuEl.isConnected) return _pvmMenuEl;
  const parent = pvmSvgContainer && pvmSvgContainer.parentElement;
  if (!parent) return null;
  const el = document.createElement('div');
  el.className = 'pvm-osd-menu';
  el.innerHTML = `
    <div class=\"osd-main\"> 
      <div class=\"osd-title\">MENU</div>
      <div class=\"osd-list\"></div>
    </div>
    <div class=\"osd-footer\">
      <div class=\"osd-foot-left\"><img class=\"osd-ico osd-ico-arrows\" src=\"/assets/images/arrows.png\" alt=\"SELECT\"/><span class=\"osd-foot-text\">SELECT</span></div>
      <div class=\"osd-foot-enter\"><img class=\"osd-ico osd-ico-enter\" src=\"/assets/images/enter.png\" alt=\"ENTER\"/></div>
      <div class=\"osd-foot-menu\"><img class=\"osd-ico osd-ico-menu\" src=\"/assets/images/menu.png\" alt=\"MENU\"/></div>
    </div>
  `;
  el.style.display = 'none';
  parent.appendChild(el);
  _pvmMenuEl = el;
  _pvmMenuIndex = 0;
  _pvmMenuMode = 'root';
  positionOsdMenuOverlay();
  renderPvmMenu();
  return el;
}
function positionOsdMenuOverlay() {
  try {
    const el = _pvmMenuEl; if (!el) return;
    const parent = pvmSvgContainer && pvmSvgContainer.parentElement;
    const svg = pvmSvgContainer && pvmSvgContainer.querySelector('svg');
    if (!parent || !svg) return;
    const screen = svg.getElementById('screen'); if (!screen) return;
    const sr = screen.getBoundingClientRect();
    const pr = parent.getBoundingClientRect();
    el.style.left = `${Math.round(sr.left - pr.left)}px`;
    el.style.top = `${Math.round(sr.top - pr.top)}px`;
    el.style.width = `${Math.round(sr.width)}px`;
    el.style.height = `${Math.round(sr.height)}px`;
    // Scale OSD text with the screen height, not the viewport
    // so opening DevTools (changing viewport height) doesn't shrink the OSD.
    // Mirrors the old clamp(9px..18px) range.
    // Slightly larger again
    const fs = Math.max(14, Math.min(28, sr.height * 0.025));
    el.style.fontSize = `${fs}px`;
  } catch (e) {}
}
function showPvmMenu() {
  const el = _ensurePvmMenu(); if (!el) return;
  // Fade-in using CSS transition
  el.style.display = '';
  el.style.opacity = '0';
  // kick to next frame to allow transition
  requestAnimationFrame(() => { el.style.opacity = '1'; });
  positionOsdMenuOverlay();
  _pvmMenuMode = 'root';
  _pvmMenuIndex = 0;
  _sessionWriteArmed = false;
  _sessionStarFlash = false;
  if (_sessionUiClearTimer) { clearTimeout(_sessionUiClearTimer); _sessionUiClearTimer = null; }
  renderPvmMenu();
  // attach keyboard controls while menu is open
  try {
    if (!window._pvmMenuKeyHandler) {
      let _keyRptTimer = null;
      const RPT_DELAY = 500;       // start repeating after 0.5s
      const RPT_INTERVAL = 35;     // a little faster

      function _stopKeyRepeat() {
        if (_keyRptTimer) { clearTimeout(_keyRptTimer); _keyRptTimer = null; }
      }
      function _startKeyRepeat(dir) {
        _stopKeyRepeat();
        const fire = () => {
          try { handleUpDown(dir); } catch (e) {}
          _keyRptTimer = setTimeout(fire, RPT_INTERVAL);
        };
        _keyRptTimer = setTimeout(fire, RPT_DELAY);
      }

      window._pvmMenuKeyHandler = (e) => {
        try {
          if (!_pvmMenuEl || _pvmMenuEl.style.display === 'none') return;
          const k = e.key;
          if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'Enter' || k === 'Backspace' || k === 'Escape') {
            e.preventDefault(); e.stopPropagation();
            if (k === 'ArrowUp' || k === 'ArrowDown') {
              const dir = (k === 'ArrowUp') ? 'up' : 'down';
              // Only trigger once on initial keydown; ignore OS auto-repeat so acceleration doesn't reset
              if (!_keyRptTimer && !e.repeat) {
                handleUpDown(dir);
                _startKeyRepeat(dir);
              }
            } else if (k === 'Enter') {
              handleEnter();
            } else if (k === 'Backspace' || k === 'Escape') {
              _stopKeyRepeat();
              handleMenu();
            }
          }
        } catch (err) {}
      };
      document.addEventListener('keydown', window._pvmMenuKeyHandler, { capture: true });
      // Stop repeat on keyup or blur
      window._pvmMenuKeyUpHandler = (ev) => { if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') _stopKeyRepeat(); };
      document.addEventListener('keyup', window._pvmMenuKeyUpHandler, { capture: true });
      window._pvmMenuBlurHandler = () => { _stopKeyRepeat(); };
      window.addEventListener('blur', window._pvmMenuBlurHandler);
    }
  } catch (e) {}
}
function hidePvmMenu() {
  const el = _pvmMenuEl; if (!el) return;
  // Fade-out over CSS duration, then hide
  el.style.opacity = '0';
  const onEnd = (ev) => {
    if (ev && ev.propertyName && ev.propertyName !== 'opacity') return;
    el.style.display = 'none';
    el.removeEventListener('transitionend', onEnd);
    // ensure opacity reset for next show
    el.style.opacity = '0';
  };
  el.addEventListener('transitionend', onEnd, { once: true });
  // detach keyboard controls when menu closes
  try {
    if (window._pvmMenuKeyHandler) {
      document.removeEventListener('keydown', window._pvmMenuKeyHandler, { capture: true });
      window._pvmMenuKeyHandler = null;
    }
    if (window._pvmMenuKeyUpHandler) {
      document.removeEventListener('keyup', window._pvmMenuKeyUpHandler, { capture: true });
      window._pvmMenuKeyUpHandler = null;
    }
    if (window._pvmMenuBlurHandler) {
      window.removeEventListener('blur', window._pvmMenuBlurHandler);
      window._pvmMenuBlurHandler = null;
    }
  } catch (e) {}
}
function togglePvmMenu() { if (body.classList.contains('power-off')) return; const el = _ensurePvmMenu(); if (!el) return; const showing = el.style.display !== 'none'; if (showing) hidePvmMenu(); else showPvmMenu(); }

function isPvmMenuVisible() { return !!(_pvmMenuEl && _pvmMenuEl.style.display !== 'none'); }
function _formatOnOff(v) { return v ? ' [ON]' : ' [OFF]'; }
function _isVignetteOn() {
  try {
    const overlay = document.querySelector('.vignette-overlay');
    if (!overlay) return true; // default visible
    const op = (overlay.style.opacity || '').trim();
    return (op === '' || op === '1');
  } catch (e) { return true; }
}
function _getMenuItems(){
  if (_pvmMenuMode === 'change-video') return ['LOCAL FILE (DEVICE)'];
  if (_pvmMenuMode === 'shader-config') {
    // Live ON/OFF states
    const sunlight = (typeof window.sunlightOn === 'undefined') ? true : !!window.sunlightOn;
    const scan = !!scanlinesOn;
    const bloom = !!bloomOn;
    const vign = _isVignetteOn();
    const phos = !!phosphorOn;
    return [
      'SUNLIGHT'  + _formatOnOff(sunlight),
      'SCANLINES' + _formatOnOff(scan),
      'BLOOM'     + _formatOnOff(bloom),
      'VIGNETTE'  + _formatOnOff(vign),
      'PHOSPHOR'  + _formatOnOff(phos),
    ];
  }
  if (_pvmMenuMode === 'geometry') {
    // Single items; values shown on-demand during edit
    return ['H STRETCH','V STRETCH','ROTATE','SHIFT HORIZ','SHIFT VERTICAL'];
  }
  if (_pvmMenuMode === 'color-temp') {
    const items = ['6500K','5600K','USER'];
    // Show value inline when editing USER
    if (_ctEdit.active) {
      return items;
    }
    return items;
  }
  return ['OPEN MEDIA','SHADERS','GEOMETRY','COLOR TEMP'];
}
function renderPvmMenu(){
  if (!_pvmMenuEl) return;
  const list = _pvmMenuEl.querySelector('.osd-list');
  if (!list) return;
  const items = _getMenuItems();

  // Toggle a mode class on the container to control title/footer visibility
  try {
    if (_pvmMenuMode === 'geometry') _pvmMenuEl.classList.add('geom-mode');
    else _pvmMenuEl.classList.remove('geom-mode');
  } catch (e) {}

  if (_pvmMenuMode === 'geometry') {
    // Custom two-line geometry UI
    const key = _activeInputKey();
    const inputLabel = key === 'a' ? 'RGB' : key === 'b' ? 'COMPONENT' : key === 'c' ? 'SDI' : '';
    const labels = ['H STRETCH','V STRETCH','ROTATE','SHIFT HORIZ','SHIFT VERTICAL'];
    const field = _geomFieldByIndex(_pvmMenuIndex);
    const param = labels[_pvmMenuIndex] || '';
    // Compute display value 0..255 with defaults at midpoint 128
    const gView = _getGeom();
    let val = 128, def = 128;
    if (field === 'sx') {
      const sx = (gView.sx == null ? 1 : gView.sx); // 0.5..1.5
      val = Math.max(0, Math.min(255, Math.round(((sx - 0.5) / 1.0) * 255)));
    } else if (field === 'sy') {
      const sy = (gView.sy == null ? 1 : gView.sy);
      val = Math.max(0, Math.min(255, Math.round(((sy - 0.5) / 1.0) * 255)));
    } else if (field === 'rotDeg') {
      let rd = (gView.rotDeg || 0) % 360; if (rd > 180) rd -= 360; if (rd < -180) rd += 360;
      val = Math.max(0, Math.min(255, Math.round(((rd + 180) / 360) * 255)));
    } else if (field === 'dx') {
      const dx = (gView.dx || 0); // map -128..+128 => 0..255
      val = Math.max(0, Math.min(255, Math.round(((dx + 128) / 256) * 255)));
    } else if (field === 'dy') {
      const dy = (gView.dy || 0);
      val = Math.max(0, Math.min(255, Math.round(((dy + 128) / 256) * 255)));
    }
    // Determine default marker position: session default if set, else factory
    const defDisp = (function(){
      try {
        const k = _activeInputKey();
        const f = field;
        const sess = (k && _sessionGeomDefaults[k]) ? _sessionGeomDefaults[k][f] : undefined;
        const base = (sess != null) ? sess : _factoryGeomValue(f);
        return _geomValueToDisplay(f, base);
      } catch (e) { return def; }
    })();
    const showArrow = (val === defDisp);
    const secondary = (_pvmMenuIndex + 1); // chronological setting index
  list.innerHTML = `
      <div class="osd-geom">
        <div class="geom-left">
          <div class="geom-input">${inputLabel}</div>
          <div class="geom-param">${param}</div>
        </div>
        <div class="geom-right">
          <span class="osd-arrow" style="opacity:${showArrow ? '1' : '0'}">▶</span>
          <span class="geom-val">${val}</span>
          <span class="geom-sup">${secondary}</span>
          <span class="geom-star-slot">${_sessionStarFlash ? '<span class=\"geom-star\">*</span>' : ''}</span>
          ${_sessionWriteArmed ? '<div class="geom-write">WRITE</div>' : ''}
        </div>
      </div>
    `;
    return;
  }

  // Default list rendering for non-geometry modes
  list.innerHTML = items.map((txt,i)=>{
    let suffix = '';
    if (_pvmMenuMode === 'geometry' && _geomEdit.active && i === _pvmMenuIndex) {
      const field = _geomFieldByIndex(i);
      suffix = ` <span class=\\"osd-val\\">${_formatGeomValue(field)}</span>`;
    } else if (_pvmMenuMode === 'color-temp' && _ctEdit.active && i === 2) {
      suffix = ` <span class=\\"osd-val\\">${Math.round(_getCtK())}K</span>`;
    }
    return `<div class=\"osd-item${i===_pvmMenuIndex?' selected':''}\"><span class=\"osd-arrow\">${i===_pvmMenuIndex?'▶':''}</span>${txt}${suffix}</div>`;
  }).join('');
}
function _updateMenuSelection() {
  if (!_pvmMenuEl) return;
  const items = _pvmMenuEl.querySelectorAll('.osd-item');
  items.forEach((it, i) => {
    if (i === _pvmMenuIndex) {
      it.classList.add('selected');
      const arrow = it.querySelector('.osd-arrow'); if (arrow) arrow.textContent = '▶';
    } else {
      it.classList.remove('selected');
      const arrow = it.querySelector('.osd-arrow'); if (arrow) arrow.textContent = '';
    }
  });
}
function menuMove(delta) {
  if (!_pvmMenuEl) return;
  const N = _getMenuItems().length;
  _pvmMenuIndex = ( (_pvmMenuIndex + delta) % N + N ) % N;
  renderPvmMenu();
}
function handleUpDown(dir) {
  if (isPvmMenuVisible()) {
    if (_pvmMenuMode === 'geometry' && _geomEdit.active) {
      const field = _geomFieldByIndex(_pvmMenuIndex);
      _stepGeomField(field, dir === 'up' ? 'up' : 'down');
      renderPvmMenu();
      return;
    }
    if (_pvmMenuMode === 'color-temp' && _ctEdit.active && _pvmMenuIndex === 2) {
      const step = 100; // 100K per nudge; hold accelerates
      const d = dir === 'up' ? step : -step;
      _nudgeCtK(d);
      _applyColorTempGain();
      try { applyColorAdjustments(); } catch (e) {}
      renderPvmMenu();
      return;
    }
    menuMove(dir === 'up' ? -1 : 1);
  } else {
    // original behavior: swap directions so Up = next, Down = previous
    // but only when an input A/B/C is active
    try {
      if (!_isAnyExclusiveSourceOn()) return;
    } catch (e) {}
    if (dir === 'up') changeChannel(-1); else changeChannel(1);
  }
}

function handleEnter() {
  if (isPvmMenuVisible()) {
    if (_pvmMenuMode === 'root') {
      if (_pvmMenuIndex === 0) { // ADD MEDIA
        promptUserMediaUpload();
      } else if (_pvmMenuIndex === 1) { // SHADER CONFIG
        _pvmMenuMode = 'shader-config';
        _pvmMenuIndex = 0;
        renderPvmMenu();
      } else if (_pvmMenuIndex === 2) { // GEOMETRY
        _pvmMenuMode = 'geometry';
        _pvmMenuIndex = 0;
        renderPvmMenu();
      } else if (_pvmMenuIndex === 3) { // COLOR TEMP
        _pvmMenuMode = 'color-temp';
        _pvmMenuIndex = 0;
        renderPvmMenu();
      }
      return;
    }
    // deprecated 'change-video' submenu removed
    if (_pvmMenuMode === 'shader-config') {
      // Toggle shader-like screen effects
      try {
        switch (_pvmMenuIndex) {
          case 0: toggleSunlight(); break;
          case 1: toggleScanlines(); break;
          case 2: toggleBloom(); break;
          case 3: toggleVignette(); break;
          case 4: togglePhosphor(); break;
          default: break;
        }
      } catch (e) {}
      // refresh menu to reflect ON/OFF states
      renderPvmMenu();
      return;
    }
    if (_pvmMenuMode === 'geometry') {
      // ENTER starts editing the selected field; MENU exits edit (see handleMenu)
      if (!_geomEdit.active) {
        _geomEdit.active = true;
        _geomEdit.field = _geomFieldByIndex(_pvmMenuIndex);
        renderPvmMenu();
      }
      return;
    }
    if (_pvmMenuMode === 'color-temp') {
      if (_pvmMenuIndex === 0) { _setCtMode('6500K'); _ctEdit.active = false; _applyColorTempGain(); try{ applyColorAdjustments(); }catch(e){} renderPvmMenu(); return; }
      if (_pvmMenuIndex === 1) { _setCtMode('5600K'); _ctEdit.active = false; _applyColorTempGain(); try{ applyColorAdjustments(); }catch(e){} renderPvmMenu(); return; }
      if (_pvmMenuIndex === 2) {
        _setCtMode('USER');
        _ctEdit.active = true;
        _applyColorTempGain(); try{ applyColorAdjustments(); }catch(e){}
        renderPvmMenu();
        return;
      }
    }
  }
}

function handleMenu() {
  // General Back behavior:
  // - If menu is closed: open root menu
  // - If menu is open and in a submenu: go back to root (keep menu open)
  // - If menu is open at root: close menu
  if (!isPvmMenuVisible()) { showPvmMenu(); return; }
  // If editing a geometry field, exit edit mode but stay in geometry submenu
  if (_pvmMenuMode === 'geometry' && _geomEdit && _geomEdit.active) {
    _geomEdit.active = false;
    _geomEdit.field = null;
    _sessionWriteArmed = false;
    renderPvmMenu();
    return;
  }
  if (_pvmMenuMode && _pvmMenuMode !== 'root') {
    _pvmMenuMode = 'root';
    _pvmMenuIndex = 0;
    renderPvmMenu();
  } else {
    hidePvmMenu();
  }
}

function promptUserMediaUpload() {
  try {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,video/*';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (file) {
        const result = loadUserMedia(file);
        // If we filled an empty slot, auto-switch to that input once
        try {
          if (result && !result.replaced) {
            const target = (result.assigned === 'c') ? 'c-sdi-light' : 'b-component-light';
            // Do not show NTSC/NO SYNC label for automatic switch after adding media
            window._suppressInputStatusOnce = true;
            setExclusiveSourceExact(target);
            refreshExclusiveSourceLights(pvmSvgContainer && pvmSvgContainer.querySelector('svg'), true);
            applySourceBlanking();
          }
        } catch (e) {}
        hidePvmMenu();
      }
      try { document.body.removeChild(input); } catch (e) {}
    }, { once: true });
    input.click();
  } catch (e) {}
}

function loadUserMedia(file) {
  if (!screenContainer || !window.PIXI) return;
  const url = URL.createObjectURL(file);
  const isVideo = /^video\//i.test(file.type);
  let el, sprite;
  if (isVideo) {
    el = document.createElement('video');
    el.src = url;
    el.autoplay = true;
    el.loop = true;
    // autoplay reliability
    el.muted = true;
    try { el.setAttribute('muted', ''); } catch (e) {}
    el.playsInline = true;
    // Keep in render tree but off-screen instead of display:none
    el.style.position = 'absolute';
    el.style.left = '-10000px';
    el.style.top = '0';
    el.style.width = '1px';
    el.style.height = '1px';
    el.style.opacity = '0';
    document.body.appendChild(el);
    sprite = new PIXI.Sprite(PIXI.Texture.from(el));
  } else {
    el = new Image();
    el.src = url;
    sprite = new PIXI.Sprite(PIXI.Texture.from(el));
  }
  sprite.anchor.set(0.5, 0.5);
  sprite.x = screenApp.screen.width / 2;
  sprite.y = screenApp.screen.height / 2;
  sprite.mediaEl = el;
  sprite.mediaType = isVideo ? 'media' : 'image';
  // Ensure CT filter is present and up-to-date for the new sprite
  try { _ensureCtFilterForSprite(sprite); _updateCtFiltersForAll(); } catch (e) {}
  // Fit once metadata is ready
  const fit = () => {
    const w = isVideo ? el.videoWidth : el.naturalWidth;
    const h = isVideo ? el.videoHeight : el.naturalHeight;
    if (w && h) {
      sizeSpriteToScreen(sprite, w, h, isVideo ? 'cover' : 'contain');
      // Re-apply global geometry to include the new sprite immediately
      try { updatePvmGridTransform(); } catch (e) {}
      try { _updateCtFiltersForAll(); } catch (e) {}
    }
  };
  if (isVideo) {
    el.addEventListener('loadeddata', () => {
      try { fit(); } catch (e) {}
      try { const p = el.play(); if (p && p.catch) p.catch(()=>{}); } catch (e) {}
    }, { once: true });
    el.addEventListener('playing', () => { try { _updateCtFiltersForAll(); } catch (e) {} }, { once: true });
  } else {
    if (el.complete) fit(); else el.addEventListener('load', fit, { once: true });
  }
  // Assign to B if empty; else C if empty; else replace the currently active input (B/C)
  let assigned = 'b';
  let replaced = false;
  if (!_inputBLocalSprite) {
    _inputBLocalSprite = sprite;
    assigned = 'b';
  } else if (!_inputCLocalSprite) {
    _inputCLocalSprite = sprite;
    assigned = 'c';
  } else {
    const active = _activeInputKey && _activeInputKey();
    if (active === 'c') {
      try { if (_inputCLocalSprite && _inputCLocalSprite.mediaEl && _inputCLocalSprite.mediaEl.pause) _inputCLocalSprite.mediaEl.pause(); } catch (e) {}
      try { if (_inputCLocalSprite && _inputCLocalSprite.parent) _inputCLocalSprite.parent.removeChild(_inputCLocalSprite); } catch (e) {}
      try { if (_inputCLocalSprite && _inputCLocalSprite.texture && _inputCLocalSprite.texture.destroy) _inputCLocalSprite.texture.destroy(true); } catch (e) {}
      _inputCLocalSprite = sprite;
      assigned = 'c';
      replaced = true;
    } else if (active === 'b') {
      try { if (_inputBLocalSprite && _inputBLocalSprite.mediaEl && _inputBLocalSprite.mediaEl.pause) _inputBLocalSprite.mediaEl.pause(); } catch (e) {}
      try { if (_inputBLocalSprite && _inputBLocalSprite.parent) _inputBLocalSprite.parent.removeChild(_inputBLocalSprite); } catch (e) {}
      try { if (_inputBLocalSprite && _inputBLocalSprite.texture && _inputBLocalSprite.texture.destroy) _inputBLocalSprite.texture.destroy(true); } catch (e) {}
      _inputBLocalSprite = sprite;
      assigned = 'b';
      replaced = true;
    } else {
      // Replace A when active is A and both B/C already occupied
      try { if (pvmGridSprite && pvmGridSprite.mediaEl && pvmGridSprite.mediaEl.pause) pvmGridSprite.mediaEl.pause(); } catch (e) {}
      try { if (pvmGridSprite && pvmGridSprite.parent) pvmGridSprite.parent.removeChild(pvmGridSprite); } catch (e) {}
      try { if (pvmGridSprite && pvmGridSprite.texture && pvmGridSprite.texture.destroy) pvmGridSprite.texture.destroy(true); } catch (e) {}
      pvmGridSprite = sprite;
      assigned = 'a';
      replaced = true;
    }
  }
  try { updateActiveSourceDisplay(); } catch (e) {}
  try { _updateCtFiltersForAll(); } catch (e) {}
  return { assigned, replaced };
}


// Position a DOM overlay element exactly over the SVG screen path
function _positionElementToScreen(el) {
  try {
    if (!el) return;
    const parent = pvmSvgContainer && pvmSvgContainer.parentElement;
    const svg = pvmSvgContainer && pvmSvgContainer.querySelector('svg');
    if (!parent || !svg) return;
    const screen = svg.getElementById('screen'); if (!screen) return;
    const r = screen.getBoundingClientRect();
    const pr = parent.getBoundingClientRect();
    el.style.position = 'absolute';
    if (el.classList && el.classList.contains('ct-overlay')) {
      const padX = 0.5;
      const padY = 1.5;
      el.style.left = `${(r.left - pr.left - padX)}px`;
      el.style.top = `${(r.top - pr.top - padY)}px`;
      el.style.width = `${(r.width + padX * 2)}px`;
      el.style.height = `${(r.height + padY * 2)}px`;
    } else {
      el.style.left = `${Math.round(r.left - pr.left)}px`;
      el.style.top = `${Math.round(r.top - pr.top)}px`;
      el.style.width = `${Math.round(r.width)}px`;
      el.style.height = `${Math.round(r.height)}px`;
    }
    // clip strictly to the screen shape
    el.style.clipPath = 'url(#screen-clip)';
    try { el.style.webkitClipPath = 'url(#screen-clip)'; } catch (e2) {}
  } catch (e) {}
}

queueInitialFadeIn();

// helper: fade out the page by adding body.loading and wait for the layout transition
function getLayoutTransitionMs() {
  try {
    const layoutEl = document.querySelector('.layout') || document.documentElement;
    const td = getComputedStyle(layoutEl).transitionDuration || '';
    const first = td.split(',')[0].trim();
    if (first.endsWith('ms')) return parseFloat(first);
    if (first.endsWith('s')) return parseFloat(first) * 1000;
  } catch (e) {}
  return 250; // fallback
}

function fadeOutPage() {
  const dur = getLayoutTransitionMs();
  document.body.classList.add('loading');
  return new Promise(resolve => setTimeout(resolve, dur + 20));
}

// --- Tooltip for knob/button feedback ---
// Tooltip messaging: reuse legacy effect status style
function _showEffectLabelPercent(label, percent) {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  showEffectStatusMessage('', null, `${label}: <b>${p}%</b>`);
}

// global pixi.js app for the main screen content
let screenApp = null;
let mediaSprite = null;

// global references for the grey square and grid image
let pvmGridSprite = null;
// Local upload sprite reserved for Input B
let _inputBLocalSprite = null;
let _inputCLocalSprite = null; // New: local media assigned to Input C
// C is local now; no URL memory
let screenContainer = null;

// global variable to track the fade-in animation frame
let gridFadeInFrameId = null;

// black bar overlay for 16:9 mode (pixi version)
let letterboxBars = null;

// dynamic media glow overlay

// --- Continuous control (knobs) state ---
const KNOB_BUTTON_IDS = ['aperature', 'bright', 'chroma', 'phase', 'contrast', 'volume'];
const knobDefaults = {
  aperture: 0.0,      // 0..1 sharpen amount (0 = off)
  brightness: 1.0,    // gamma (0.5..2), 1 = neutral
  contrast: 1.0,      // 0..2, 1 = neutral
  saturation: 1.0,    // 0..2, 1 = neutral (0 = B/W)
  hue: 0.0,           // -45..45 degrees
  volume: 1.0         // 0..1, default 100%
};
let knobState = { ...knobDefaults };

// --- User activation tracking (for autoplay/audio policies) ---
let _userActivated = false;
let _soundActivated = false; // only set when volume knob is used
function _markUserActivated() {
  if (_userActivated) return;
  _userActivated = true;
  try { localStorage.setItem('soundActivated', 'true'); } catch (e) {}
  try { if (window.audioLoop && window.audioLoop.resume) window.audioLoop.resume(); } catch (e) {}
}
// Mark activation on common gestures
try {
  window.addEventListener('pointerdown', _markUserActivated, { capture: true });
  window.addEventListener('keydown', _markUserActivated, { capture: true });
  window.addEventListener('touchstart', _markUserActivated, { capture: true, passive: true });
} catch (e) {}

// --- Color temperature state ---
// Global color temperature state (applies to all inputs)
let colorTempMode = '6500K'; // '6500K' | '5600K' | 'USER'
let colorTempK = 6500;       // valid when mode is USER
function _getCtMode() { return colorTempMode; }
function _getCtK() { return colorTempK; }
function _setCtMode(mode) {
  colorTempMode = mode;
  if (mode === '6500K') colorTempK = 6500;
  if (mode === '5600K') colorTempK = 5600;
}
function _nudgeCtK(delta) {
  colorTempMode = 'USER';
  colorTempK = Math.max(3500, Math.min(10000, (colorTempK || 6500) + delta));
}
const _ctEdit = { active: false };

function _kelvinToRgb(kelvin) {
  // Approximate RGB from color temperature (in Kelvin)
  // Source adapted from Tanner Helland and others; clamped to 1000..40000K
  let temp = Math.max(1000, Math.min(40000, kelvin)) / 100;
  let r, g, b;
  // Red
  if (temp <= 66) r = 255; else {
    r = temp - 60; r = 329.698727446 * Math.pow(r, -0.1332047592);
    r = Math.max(0, Math.min(255, r));
  }
  // Green
  if (temp <= 66) {
    g = 99.4708025861 * Math.log(temp) - 161.1195681661;
  } else {
    g = temp - 60; g = 288.1221695283 * Math.pow(g, -0.0755148492);
  }
  g = Math.max(0, Math.min(255, g));
  // Blue
  if (temp >= 66) b = 255; else if (temp <= 19) b = 0; else {
    b = temp - 10; b = 138.5177312231 * Math.log(b) - 305.0447927307;
    b = Math.max(0, Math.min(255, b));
  }
  return [r/255, g/255, b/255];
}
function _applyColorTempGain() {
  // Use shader-based tint per sprite so it conforms to the video only
  try { _updateCtFiltersForAll(); } catch (e) {}
}

function _updateCtOverlayVisibility() {
  try {
    const container = pvmSvgContainer && pvmSvgContainer.parentElement;
    if (!container) return;
    const ov = container.querySelector('.ct-overlay');
    if (!ov) return;
    // Hide by display when Blue Only is active
    if (typeof isBlueOnly !== 'undefined' && isBlueOnly) {
      ov.style.display = 'none';
      return;
    }
    ov.style.display = '';
    // Ensure geometry transform matches current view
    try { positionCtOverlay(ov); } catch (e) {}
    _applyCtFinalOpacity();
  } catch (e) {}
}

// Compose color temp overlay final opacity from baseCtOpacity and current CRT alpha
function _applyCtFinalOpacity() {
  try {
    const container = pvmSvgContainer && pvmSvgContainer.parentElement;
    if (!container) return;
    const ov = container.querySelector('.ct-overlay');
    if (!ov) return;
    // respect Blue Only
    if (typeof isBlueOnly !== 'undefined' && isBlueOnly) { ov.style.display = 'none'; return; }
    // Only show when current input actually has media visible
    const key = _activeInputKey && _activeInputKey();
    const hasMedia = (key === 'a' && !!pvmGridSprite && pvmGridSprite.alpha > 0) ||
                     (key === 'b' && !!_inputBLocalSprite && _inputBLocalSprite.alpha > 0) ||
                     (key === 'c' && !!_inputCLocalSprite && _inputCLocalSprite.alpha > 0);
    if (!hasMedia) { ov.style.display = 'none'; return; }
    ov.style.display = '';
    const base = parseFloat(ov.dataset.baseCtOpacity || '0');
    const powerOn = !body.classList.contains('power-off');
    const a = powerOn ? _crtEffectsAlpha : 0;
    ov.style.opacity = String(base * a);
  } catch (e) {}
}

// Position/transform color-temp overlay to match current geometry
function positionCtOverlay(ovEl) {
  try {
    const ov = ovEl || ((pvmSvgContainer && pvmSvgContainer.parentElement) ? pvmSvgContainer.parentElement.querySelector('.ct-overlay') : null);
    if (!ov) return;
    const gObj = _getGeom();
    const sx = (gObj && gObj.sx) || 1;
    const sy = (gObj && gObj.sy) || 1;
    const rot = ((gObj && gObj.rotDeg) || 0);
    const dx = ((gObj && gObj.dx) || 0);
    const dy = ((gObj && gObj.dy) || 0);
    ov.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy}) rotate(${rot}deg)`;
    ov.style.transformOrigin = 'center center';
  } catch (e) {}
}

// --- Shader-based color temperature tint ---
function _ensureCtFilterForSprite(spr) {
  if (!spr || !window.PIXI) return null;
  if (spr._ctFilter) return spr._ctFilter;
  try {
    const fragCT = `
      precision mediump float;
      varying vec2 vTextureCoord;
      uniform sampler2D uSampler;
      uniform vec3 uTint;
      uniform float uStrength;
      vec3 rgb2hsl(vec3 c){
        float maxc = max(max(c.r, c.g), c.b);
        float minc = min(min(c.r, c.g), c.b);
        float L = (maxc + minc) * 0.5;
        float H = 0.0;
        float S = 0.0;
        if (maxc != minc) {
          float d = maxc - minc;
          S = L > 0.5 ? d / (2.0 - maxc - minc) : d / (maxc + minc);
          if (maxc == c.r) H = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
          else if (maxc == c.g) H = (c.b - c.r) / d + 2.0;
          else H = (c.r - c.g) / d + 4.0;
          H /= 6.0;
        }
        return vec3(H, S, L);
      }
      float hue2rgb(float p, float q, float t){
        if (t < 0.0) t += 1.0;
        if (t > 1.0) t -= 1.0;
        if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
        if (t < 1.0/2.0) return q;
        if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
        return p;
      }
      vec3 hsl2rgb(vec3 hsl){
        float H = hsl.x, S = hsl.y, L = hsl.z;
        float r,g,b;
        if (S == 0.0) { r = g = b = L; }
        else {
          float q = L < 0.5 ? L * (1.0 + S) : L + S - L * S;
          float p = 2.0 * L - q;
          r = hue2rgb(p, q, H + 1.0/3.0);
          g = hue2rgb(p, q, H);
          b = hue2rgb(p, q, H - 1.0/3.0);
        }
        return vec3(r,g,b);
      }
      void main(){
        vec4 base = texture2D(uSampler, vTextureCoord);
        vec3 tintHSL = rgb2hsl(uTint);
        vec3 baseHSL = rgb2hsl(base.rgb);
        vec3 outRGB = hsl2rgb(vec3(tintHSL.x, tintHSL.y, baseHSL.z));
        outRGB = mix(base.rgb, outRGB, clamp(uStrength, 0.0, 1.0));
        gl_FragColor = vec4(outRGB, base.a);
      }
    `;
    spr._ctFilter = new PIXI.Filter(undefined, fragCT, { uTint: [0,0,0], uStrength: 0.0 });
  } catch (e) { spr._ctFilter = null; }
  return spr._ctFilter;
}

function _updateCtFiltersForAll() {
  const applyFor = (key, spr) => {
    if (!spr) return;
    const f = _ensureCtFilterForSprite(spr);
    if (!f) return;
    const blue = (typeof isBlueOnly !== 'undefined' && isBlueOnly);
    const powerOn = !body.classList.contains('power-off');
    const visible = !!spr.alpha;
    const mode = _getCtMode();
    const k = mode === 'USER' ? _getCtK() : (mode === '5600K' ? 5600 : 6500);
    const t = (k - 6500) / 3500;
    const warm = [1.0, 140.0/255.0, 0.0];
    const cool = [0.0, 150.0/255.0, 1.0];
    const tint = (t >= 0) ? cool : warm;
    const base = Math.min(0.45, Math.max(0, Math.abs(t) * 0.45));
    const strength = (blue || !powerOn || !visible) ? 0.0 : base;
    try { f.uniforms.uTint = tint; f.uniforms.uStrength = strength; } catch (e) {}
    try {
      const existing = Array.isArray(spr.filters) ? spr.filters.slice() : [];
      if (!existing.includes(f)) {
        spr.filters = [...existing, f];
      }
    } catch (e) {}
  };
  applyFor('a', pvmGridSprite);
  applyFor('b', _inputBLocalSprite);
  applyFor('c', _inputCLocalSprite);
}

// Mode-aware knob availability
function _isLineRgbOn() {
  try { return !!toggleLightState['line-rgb-light']; } catch (e) { return false; }
}
function _isKnobDisabledForMode(id) {
  // Disable both CHROMA and PHASE whenever LINE/RGB is ON.
  // When LINE/RGB button is OFF (line mode), both are enabled.
  if (id === 'chroma' || id === 'phase') return _isLineRgbOn();
  return false;
}
function updateKnobDisabledStyles(pvmSvg) {
  if (!pvmSvg) return;
  ['chroma','phase'].forEach((id) => {
    const el = pvmSvg.getElementById(id);
    if (!el) return;
    const disabled = _isKnobDisabledForMode(id);
    el.style.opacity = disabled ? '0.45' : '1';
    el.style.cursor = disabled ? 'not-allowed' : 'ew-resize';
    el.setAttribute('aria-disabled', disabled ? 'true' : 'false');
  });
}

// Filters for continuous adjustments live on screenContainer
let colorMatrixFilter = null; // PIXI.filters.ColorMatrixFilter
let saturationFilter = null;  // Custom PIXI.Filter for smooth saturation control
let gammaFilter = null;       // Custom PIXI.Filter implementing gamma correction
let colorTempFilter = null;   // (deprecated) per-channel gain for color temperature — not used in core stack
let _crtEffectsAlpha = 1;     // tracks current CRT/global screen fade (0..1)
let sharpenFilter = null;     // PIXI.filters.ConvolutionFilter (if available)
// let ctBlendFilter = null;     // (deprecated) global CT blend; replaced with per-sprite filters

function _composeCoreFilters(extraEffects) {
  const core = [];
  if (saturationFilter) core.push(saturationFilter);
  if (colorMatrixFilter) core.push(colorMatrixFilter);
  if (gammaFilter) core.push(gammaFilter);
  if (sharpenFilter && knobState && knobState.aperture > 0.001) core.push(sharpenFilter);
  const rest = (extraEffects || []).filter(f => f && f !== saturationFilter && f !== colorMatrixFilter && f !== gammaFilter && f !== sharpenFilter);
  return [...core, ...rest];
}
function _setSpriteFilters(effects) {
  const base = _composeCoreFilters(effects);
  const apply = (spr) => {
    if (!spr) return;
    let final = base.slice();
    if (spr._ctFilter && !final.includes(spr._ctFilter)) final = [...final, spr._ctFilter];
    try { spr.filters = final; } catch (e) {}
  };
  apply(pvmGridSprite);
  apply(_inputBLocalSprite);
  apply(_inputCLocalSprite);
}

// Knob indicator mapping and angle math
const KNOB_RANGES = {
  aperture:   [0, 1],
  brightness: [0, 2],
  contrast:   [0, 2],
  saturation: [0, 2],
  hue:        [-45, 45],
  volume:     [0, 1],
};

const KNOB_INDICATOR_IDS = {
  aperture:   ['light-aperature-position', 'dark-aperature-position'],
  brightness: ['light-bright-position',    'dark-bright-position'],
  saturation: ['light-chroma-position',    'dark-chroma-position'],
  hue:        ['light-phase-position',     'dark-phase-position'],
  contrast:   ['light-contrast-position',  'dark-contrast-position'],
  volume:     ['light-volume-position',    'dark-volume-position'],
};

const KNOB_SWEEP_DEG = { default: 270 };
const KNOB_ANGLE_OFFSET_DEG = 0; // rotate axis 90° counter‑clockwise
// Pivot exactly at knob center (no offset)
const KNOB_PIVOT_OFFSET_PX = { x: 1, y: 1.5 };
const KNOB_PIVOT_OFFSET_FRAC = { x: 0.0, y: 0.0 };
// One-time visual nudge for indicator artwork (down-right in screen px)
const INDICATOR_NUDGE_PX = { x: 0, y: 0 };

function _clamp01(v){ return v < 0 ? 0 : v > 1 ? 1 : v; }

function _knobNorm(prop, value) {
  const rng = KNOB_RANGES[prop] || [0, 1];
  const min = rng[0], max = rng[1];
  return _clamp01((value - min) / (max - min || 1));
}

function _getKnobIdForProp(prop) {
  if (prop === 'aperture') return 'aperature';
  if (prop === 'brightness') return 'bright';
  if (prop === 'saturation') return 'chroma';
  if (prop === 'hue') return 'phase';
  return prop; // contrast, volume
}

function _getKnobPivot(prop, svg) {
  const knobId = _getKnobIdForProp(prop);
  const el = svg && svg.getElementById(knobId);
  if (!el) return null;
  try {
    // Compute center in client space, then convert to SVG user space to account for transforms
    const r = el.getBoundingClientRect();
    const cxClient = r.left + r.width / 2;
    const cyClient = r.top + r.height / 2;
    const pt = svg.createSVGPoint ? svg.createSVGPoint() : null;
    if (pt && svg.getScreenCTM && svg.getScreenCTM()) {
      pt.x = cxClient; pt.y = cyClient;
      const inv = svg.getScreenCTM().inverse();
      const svgPt = pt.matrixTransform(inv);
      // Apply consistent down-right offset in client pixels mapped to SVG space
      const pt2 = svg.createSVGPoint();
      pt2.x = cxClient + KNOB_PIVOT_OFFSET_PX.x;
      pt2.y = cyClient + KNOB_PIVOT_OFFSET_PX.y;
      const svgPt2 = pt2.matrixTransform(inv);
      const dx = svgPt2.x - svgPt.x;
      const dy = svgPt2.y - svgPt.y;
      return { cx: svgPt.x + dx, cy: svgPt.y + dy };
    }
  } catch (e) {}
  // Fallback to bbox center if matrix conversion unavailable
  if (el.getBBox) {
    const b = el.getBBox();
    const baseCx = b.x + b.width / 2;
    const baseCy = b.y + b.height / 2;
    return {
      cx: baseCx + b.width * KNOB_PIVOT_OFFSET_FRAC.x,
      cy: baseCy + b.height * KNOB_PIVOT_OFFSET_FRAC.y,
    };
  }
  return null;
}

function updateKnobIndicator(prop) {
  try {
    const svg = pvmSvgContainer && pvmSvgContainer.querySelector('svg');
    if (!svg) return;
    // knob clickable element center in client space
    const knobId = _getKnobIdForProp(prop);
    const knobEl = svg.getElementById(knobId);
    if (!knobEl) return;
    const kb = knobEl.getBoundingClientRect();
    const cxClient = kb.left + kb.width / 2;
    const cyClient = kb.top + kb.height / 2;

    const ids = KNOB_INDICATOR_IDS[prop] || [];
    const sweep = (KNOB_SWEEP_DEG[prop] || KNOB_SWEEP_DEG.default) || 270;
    const minA = -sweep / 2;
    const maxA =  sweep / 2;
    let norm = _knobNorm(prop, knobState[prop]);
    norm = Math.min(0.999, Math.max(0.001, norm));
    const angle = minA + norm * (maxA - minA) + KNOB_ANGLE_OFFSET_DEG;
    const isDark = document.body.classList.contains('dark-mode');

    ids.forEach(id => {
      const el = svg.getElementById(id);
      if (!el) return;
      // convert knob center into a single, stable coordinate space (root svg)
      const ctm = svg.getScreenCTM && svg.getScreenCTM();
      if (!ctm || !svg.createSVGPoint) return;
      const inv = ctm.inverse();
      const pt = svg.createSVGPoint();
      pt.x = cxClient; pt.y = cyClient;
      const centerLocal = pt.matrixTransform(inv);
      // small pivot offset in client px mapped into local space
      const opt = svg.createSVGPoint();
      opt.x = cxClient + KNOB_PIVOT_OFFSET_PX.x;
      opt.y = cyClient + KNOB_PIVOT_OFFSET_PX.y;
      const offsetLocal = opt.matrixTransform(inv);
      const pivotX = centerLocal.x + (offsetLocal.x - centerLocal.x);
      const pivotY = centerLocal.y + (offsetLocal.y - centerLocal.y);

      // rotate from a stable base transform (no accumulation)
      if (!el.dataset.initialTransform) {
        el.dataset.initialTransform = el.getAttribute('transform') || '';
      }
      const base = el.dataset.initialTransform.replace(/\s*rotate\([^\)]*\)/g, '');
      el.setAttribute('transform', `${base} rotate(${angle} ${pivotX} ${pivotY})`.trim());

      // Theme visibility: enforce via SVG attribute and CSS fallback
      if (/^dark-/.test(id)) {
        const show = isDark;
        el.setAttribute('display', show ? 'inline' : 'none');
        el.setAttribute('visibility', show ? 'visible' : 'hidden');
        el.style.display = show ? '' : 'none';
        el.style.visibility = show ? '' : 'hidden';
        el.style.opacity = show ? '1' : '0';
        el.style.pointerEvents = show ? '' : 'none';
      } else if (/^light-/.test(id)) {
        const show = !isDark;
        el.setAttribute('display', show ? 'inline' : 'none');
        el.setAttribute('visibility', show ? 'visible' : 'hidden');
        el.style.display = show ? '' : 'none';
        el.style.visibility = show ? '' : 'hidden';
        el.style.opacity = show ? '1' : '0';
        el.style.pointerEvents = show ? '' : 'none';
      }
    });
  } catch (e) {}
}

function updateAllKnobIndicators() {
  ['aperture','brightness','saturation','hue','contrast','volume'].forEach(updateKnobIndicator);
}

function updateIndicatorThemeVisibility() {
  try {
    const svg = pvmSvgContainer && pvmSvgContainer.querySelector('svg');
    if (!svg) return;
    const isDark = document.body.classList.contains('dark-mode');
    const allIds = [];
    Object.values(KNOB_INDICATOR_IDS).forEach(arr => arr.forEach(id => allIds.push(id)));
    allIds.forEach(id => {
      const el = svg.getElementById(id);
      if (!el) return;
      const show = (/^dark-/.test(id)) ? isDark : !isDark;
      el.setAttribute('display', show ? 'inline' : 'none');
      el.setAttribute('visibility', show ? 'visible' : 'hidden');
      el.style.display = show ? '' : 'none';
      el.style.visibility = show ? '' : 'hidden';
      el.style.opacity = show ? '1' : '0';
      el.style.pointerEvents = show ? '' : 'none';
    });
  } catch (e) {}
}

function _ensureAdjustmentFilters() {
  if (!window.PIXI || !screenContainer) return false;
  if (!colorMatrixFilter) {
    try { colorMatrixFilter = new PIXI.filters.ColorMatrixFilter(); }
    catch (e) { colorMatrixFilter = null; }
  }
  // create saturation filter if missing (smooth grayscale blend, no washout)
  if (!saturationFilter) {
    try {
      const fragSat = `
        precision mediump float;
        varying vec2 vTextureCoord;
        uniform sampler2D uSampler;
        uniform float uSaturation; // 0 = grayscale, 1 = neutral, >1 = over-saturated
        const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
        void main(void) {
          vec4 color = texture2D(uSampler, vTextureCoord);
          float gray = dot(color.rgb, LUMA);
          vec3 delta = color.rgb - vec3(gray);
          vec3 rgb = vec3(gray) + delta * uSaturation;
          gl_FragColor = vec4(rgb, color.a);
        }
      `;
      saturationFilter = new PIXI.Filter(undefined, fragSat, { uSaturation: 1.0 });
    } catch (e) { saturationFilter = null; }
  }
  // create gamma filter if missing
  if (!gammaFilter) {
    try {
      const frag = `
        precision mediump float;
        varying vec2 vTextureCoord;
        uniform sampler2D uSampler;
        uniform float uGamma; // 1.0 = neutral, >1 brightens mids
        void main(void) {
          vec4 color = texture2D(uSampler, vTextureCoord);
          float g = max(uGamma, 0.01);
          // apply inverse exponent so higher uGamma brightens midtones
          vec3 rgb = pow(color.rgb, vec3(1.0 / g));
          gl_FragColor = vec4(rgb, color.a);
        }
      `;
      gammaFilter = new PIXI.Filter(undefined, frag, { uGamma: 1.0 });
    } catch (e) { gammaFilter = null; }
  }
  // (no colorTempFilter in core; use unified CSS approach for all inputs)
  // ensure the core filters sit on the media sprite so they're always visible
  if (!pvmGridSprite && !_inputBLocalSprite && !_inputCLocalSprite) return !!colorMatrixFilter;
  const applyTo = [];
  if (pvmGridSprite) applyTo.push(pvmGridSprite);
  if (_inputBLocalSprite) applyTo.push(_inputBLocalSprite);
  if (_inputCLocalSprite) applyTo.push(_inputCLocalSprite);
  applyTo.forEach((spr) => {
    const existing = Array.isArray(spr.filters) ? spr.filters.slice() : [];
    const withoutOld = existing.filter(f => f !== saturationFilter && f !== colorMatrixFilter && f !== gammaFilter && f !== colorTempFilter);
  const core = [saturationFilter, colorMatrixFilter, gammaFilter].filter(Boolean);
    spr.filters = [...core, ...withoutOld];
  });
  return !!colorMatrixFilter;
}

function applyColorAdjustments() {
  if (!window.PIXI || !screenContainer) return;
  _ensureAdjustmentFilters();
  // Color matrix stacking: reset and apply in order
  if (colorMatrixFilter) {
    try {
      colorMatrixFilter.reset();
      // Bright knob is gamma: handled by custom gammaFilter below
      // TV "Contrast" knob repurposed as screen brightness (gain), like phone brightness
      // Use ColorMatrix brightness: 1 = neutral, floor at 0.2 so far-left is dim, not black
      if (typeof colorMatrixFilter.brightness === 'function') {
        let br = knobState.contrast; // reuse contrast knob value as brightness gain
        if (br === undefined || br === null || Number.isNaN(br)) br = 1.0;
        br = Math.max(0.2, Math.min(2.0, br));
        // first matrix op after reset: multiply=false
        colorMatrixFilter.brightness(br, false);
      }
      // hue in degrees (compose on top of contrast)
      if (typeof colorMatrixFilter.hue === 'function') colorMatrixFilter.hue(knobState.hue, true);
    } catch (e) {}
  }
  // Update saturation filter uniform: smooth grayscale blend, gradual from 0..2
  if (saturationFilter) {
    try {
      let s = knobState.saturation;
      if (s === undefined || s === null || Number.isNaN(s)) s = 1.0;
      s = Math.max(0.0, Math.min(2.0, s));
      // avoid engine shortcuts: never rely on colorMatrix greyscale; our shader handles s=0 smoothly
      saturationFilter.uniforms.uSaturation = s;
    } catch (e) {}
  }
  // Update gamma filter uniform: 1.0 neutral; >1 brightens mids; <1 darkens
  if (gammaFilter) {
    try {
      // Map knob directly to gamma but allow a deeper dark floor and a slightly higher ceiling.
      // Neutral remains at 1.0; left gets significantly darker.
      let raw = knobState.brightness;
      if (raw === undefined || raw === null || Number.isNaN(raw)) raw = 1.0;
      const g = Math.max(0.2, Math.min(2.5, raw)); // 0.2..2.5, 1.0 = neutral
      gammaFilter.uniforms.uGamma = g;
    } catch (e) {}
  }
  // Update color temperature filter per current selection
  try { _applyColorTempGain(); } catch (e) {}
  // Rebuild filter stack: always include color matrix; add sharpen only if aperture > 0
  const filters = [];
  if (colorMatrixFilter) filters.push(colorMatrixFilter);
  if (gammaFilter) filters.push(gammaFilter);
  const amount = Math.max(0, Math.min(1, knobState.aperture));
  if (amount > 0.001) {
    // Subtle sharpen: keep brightness neutral and reduce range so it acts like a true sharpness knob
    const eff = amount * 0.04; // very conservative ceiling to avoid perceived brightness boost
    if (!sharpenFilter) {
      try {
        const hasConv = PIXI.filters && PIXI.filters.ConvolutionFilter;
        if (hasConv) {
          sharpenFilter = new PIXI.filters.ConvolutionFilter([0,0,0,0,1,0,0,0,0], 3, 3);
        }
      } catch (e) { sharpenFilter = null; }
    }
    if (sharpenFilter) {
      const a = eff;
      // 8-neighbor kernel that sums to 1.0 to preserve overall brightness
      const k = [
        -a,   -a,   -a,
        -a, 1+8*a, -a,
        -a,   -a,   -a
      ];
      try { sharpenFilter.matrix = k; } catch (e) {}
      filters.push(sharpenFilter);
    }
  }
  // Apply final stack
  // apply the final stack at the sprite level; preserve any non-color filters already present
  if (pvmGridSprite) {
    const others = (Array.isArray(pvmGridSprite.filters) ? pvmGridSprite.filters : []).filter(f => f !== colorMatrixFilter && f !== sharpenFilter);
    _setSpriteFilters([...others]);
  }
}

// (Removed) EXT SYNC chaos effect and hooks

// --- GEOMETRY ADJUST (fun) ---
// User-tweakable picture geometry like a PVM: extra stretch, rotation, and offset
// Each input (A=RGB, B=Component, C=Local) maintains its own geometry settings
// Global geometry state (applies to all inputs)
const _geomGlobal = { sx: 1, sy: 1, rotDeg: 0, dx: 0, dy: 0 };
const _geomByInput = { a: _geomGlobal, b: _geomGlobal, c: _geomGlobal };
const _geomEdit = { active: false, field: null };
function _getGeom() { return _geomGlobal; }
function resetGeometry() {
  const g = _getGeom();
  g.sx = 1; g.sy = 1; g.rotDeg = 0; g.dx = 0; g.dy = 0;
  updatePvmGridTransform();
  // no iframe positioning needed
  try { positionCtOverlay(); } catch (e) {}
}
function nudgeGeometry(op) {
  const s = 0.02; // stretch step
  const r = 1;    // degrees
  const p = 2;    // pixels
  const g = _getGeom();
  switch (op) {
    case 'h-': g.sx = Math.max(0.5, g.sx - s); break;
    case 'h+': g.sx = Math.min(1.5, g.sx + s); break;
    case 'v-': g.sy = Math.max(0.5, g.sy - s); break;
    case 'v+': g.sy = Math.min(1.5, g.sy + s); break;
    case 'rot-': g.rotDeg = (g.rotDeg - r) % 360; break;
    case 'rot+': g.rotDeg = (g.rotDeg + r) % 360; break;
    case 'left': g.dx -= p; break;
    case 'right': g.dx += p; break;
    case 'up': g.dy -= p; break;
    case 'down': g.dy += p; break;
    default: break;
  }
  updatePvmGridTransform();
  // no iframe positioning needed
  try { positionCtOverlay(); } catch (e) {}
}

function _geomFieldByIndex(i) {
  return ['sx','sy','rotDeg','dx','dy'][i] || null;
}
// Map a geometry field value to 0..255 display scale
function _geomValueToDisplay(field, rawVal) {
  try {
    if (field === 'sx') {
      const sx = (rawVal == null ? 1 : rawVal); // 0.5..1.5
      return Math.max(0, Math.min(255, Math.round(((sx - 0.5) / 1.0) * 255)));
    } else if (field === 'sy') {
      const sy = (rawVal == null ? 1 : rawVal);
      return Math.max(0, Math.min(255, Math.round(((sy - 0.5) / 1.0) * 255)));
    } else if (field === 'rotDeg') {
      let rd = (rawVal == null ? 0 : rawVal) % 360; if (rd > 180) rd -= 360; if (rd < -180) rd += 360;
      return Math.max(0, Math.min(255, Math.round(((rd + 180) / 360) * 255)));
    } else if (field === 'dx') {
      const dx = (rawVal == null ? 0 : rawVal);
      return Math.max(0, Math.min(255, Math.round(((dx + 128) / 256) * 255)));
    } else if (field === 'dy') {
      const dy = (rawVal == null ? 0 : rawVal);
      return Math.max(0, Math.min(255, Math.round(((dy + 128) / 256) * 255)));
    }
  } catch (e) {}
  return 128;
}
function _formatGeomValue(field) {
  const g = _getGeom();
  if (field === 'sx' || field === 'sy') return (Math.round((g[field] || 1) * 100) + '%');
  if (field === 'rotDeg') return (Math.round(g[field] || 0) + '°');
  if (field === 'dx' || field === 'dy') return ((g[field] || 0) + 'px');
  return '';
}
function _stepGeomField(field, dir) {
  const d = dir === 'up' ? 1 : -1;
  const g = _getGeom();
  // Restore fine step increments; acceleration handled by faster repeat when holding
  // Choose steps so the 0..255 on-screen value changes by 1 per nudge:
  // sx/sy: val = ((s - 0.5)/1.0)*255 -> ds = 1/255
  if (field === 'sx') g.sx = Math.max(0.5, Math.min(1.5, (g.sx || 1) + d * (1/255)));
  else if (field === 'sy') g.sy = Math.max(0.5, Math.min(1.5, (g.sy || 1) + d * (1/255)));
  // rotDeg: val = ((rot+180)/360)*255 -> drot = 360/255 ≈ 1.41176
  else if (field === 'rotDeg') g.rotDeg = (((g.rotDeg || 0) + d * (360/255)) + 360) % 360;
  // dx/dy: val = ((dxy+128)/256)*255 -> dd ≈ 1 gives ~1 step
  else if (field === 'dx') g.dx = (g.dx || 0) + d * 1;
  else if (field === 'dy') g.dy = (g.dy || 0) + d * 1;
  updatePvmGridTransform();
  // no iframe positioning needed
  try { positionCtOverlay(); } catch (e) {}
}

// Session default helpers for geometry
function _factoryGeomValue(field) {
  if (field === 'sx' || field === 'sy') return 1;
  if (field === 'rotDeg') return 0;
  if (field === 'dx' || field === 'dy') return 0;
  return null;
}
function _hasSessionDefaultForCurrentField() {
  try {
    const k = _activeInputKey();
    const f = _geomFieldByIndex(_pvmMenuIndex);
    return !!(k && f && _sessionGeomDefaults[k] && _sessionGeomDefaults[k][f] != null);
  } catch (e) { return false; }
}
function _applyGeomDefault(field) {
  const k = _activeInputKey();
  const g = _getGeom();
  if (!field) return;
  const sessionVal = (k && _sessionGeomDefaults[k]) ? _sessionGeomDefaults[k][field] : undefined;
  const v = (sessionVal != null) ? sessionVal : _factoryGeomValue(field);
  if (v == null) return;
  g[field] = v;
  updatePvmGridTransform();
  // no iframe positioning needed
}
function _applyAllGeomDefaults() {
  const k = _activeInputKey();
  const g = _getGeom();
  ['sx','sy','rotDeg','dx','dy'].forEach(f => {
    const sessionVal = (k && _sessionGeomDefaults[k]) ? _sessionGeomDefaults[k][f] : undefined;
    const v = (sessionVal != null) ? sessionVal : _factoryGeomValue(f);
    g[f] = v;
  });
  updatePvmGridTransform();
}

function setupKnobControls(pvmSvg) {
  if (!pvmSvg) return;
  // helper to avoid repeated localStorage writes during wheel/drag
  let _soundActivatedMarked = false;
  function _markSoundActivatedOnce() {
    if (_soundActivatedMarked) return;
    try {
      if (localStorage.getItem('soundActivated') !== 'true') {
        localStorage.setItem('soundActivated', 'true');
      }
    } catch (e) {}
    _soundActivatedMarked = true;
    _soundActivated = true;
  }
  const map = {
    'aperature': { prop: 'aperture', min: 0, max: 1, step: 0.1, label: 'aperture' },
    'bright':    { prop: 'brightness', min: 0, max: 2, step: 0.1, label: 'bright' },
    'chroma':    { prop: 'saturation', min: 0, max: 2, step: 0.1, label: 'chroma' },
    'phase':     { prop: 'hue', min: -45, max: 45, step: 0.1, label: 'phase' },
    'contrast':  { prop: 'contrast', min: 0, max: 2, step: 0.1, label: 'contrast' },
    'volume':    { prop: 'volume', min: 0, max: 1, step: 0.1, label: 'volume' },
  };
  const PIXELS_PER_FULL_SWEEP = 90; // faster knob: fewer pixels to traverse full range
  Object.keys(map).forEach(id => {
    const btn = pvmSvg.getElementById(id);
    if (!btn) return;
    btn.style.cursor = 'ew-resize';
    btn.style.pointerEvents = 'all';
    const cfg = map[id];
    const getVal = () => knobState[cfg.prop];
    const setVal = (v) => { knobState[cfg.prop] = Math.max(cfg.min, Math.min(cfg.max, v)); };
    const sensitivity = 1.0; // not used in normalized mode
    let startX = 0, startVal = 0, startNorm = 0, dragging = false;
    function onMove(e) {
      if (!dragging) return;
      const x = (e.touches && e.touches[0]) ? e.touches[0].clientX : e.clientX;
      const dx = (x - startX);
      const range = (cfg.max - cfg.min) || 1;
      // normalized delta so all knobs travel the same distance regardless of range
      const deltaNorm = dx / PIXELS_PER_FULL_SWEEP; // right increases, left decreases
      const newNorm = Math.max(0, Math.min(1, startNorm + deltaNorm));
      const newVal = cfg.min + newNorm * range;
      setVal(newVal);
      // live status message for knobs: label + percent
      _showEffectLabelPercent(cfg.label, newNorm * 100);
      if (cfg.prop === 'volume') {
        // user interaction: only affect audio when TV is on
        if (!body.classList.contains('power-off')) {
          // Unmute only the active input's media element (A or B)
          try {
            const k = _activeInputKey();
            const elA = (pvmGridSprite && pvmGridSprite.mediaType === 'media') ? pvmGridSprite.mediaEl : null;
            const elB = (_inputBLocalSprite && _inputBLocalSprite.mediaType === 'media') ? _inputBLocalSprite.mediaEl : null;
            if (k === 'a' && elA) { elA.muted = false; elA.volume = knobState.volume; }
            if (k === 'b' && elB) { elB.muted = false; elB.volume = knobState.volume; }
            localStorage.setItem('soundActivated', 'true'); _soundActivated = true;
          } catch (e) {}
        }
        updateKnobIndicator(cfg.prop);
      } else {
        applyColorAdjustments();
        updateKnobIndicator(cfg.prop);
      }
      e.preventDefault();
    }
    function onUp() {
      dragging = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
      // fade out handled by showEffectStatusMessage
    }
    btn.addEventListener('pointerdown', (e) => {
      if (_isKnobDisabledForMode(id)) {
        const msg = '<div class="effect-sub">disable RGB</div>';
        showEffectStatusMessage(id, false, msg);
        return;
      }
      try { _markUserActivated(); } catch (e) {}
      dragging = true;
      startX = e.clientX;
      startVal = getVal();
      const r = (cfg.max - cfg.min) || 1;
      startNorm = (startVal - cfg.min) / r;
      // If this is the volume knob, a simple click should also enable sound (only when TV is on)
      if (cfg.prop === 'volume' && !body.classList.contains('power-off')) {
        try {
          const k = _activeInputKey();
          const elA = (pvmGridSprite && pvmGridSprite.mediaType === 'media') ? pvmGridSprite.mediaEl : null;
          const elB = (_inputBLocalSprite && _inputBLocalSprite.mediaType === 'media') ? _inputBLocalSprite.mediaEl : null;
          if (k === 'a' && elA) { elA.muted = false; elA.volume = knobState.volume; }
          if (k === 'b' && elB) { elB.muted = false; elB.volume = knobState.volume; }
          try { localStorage.setItem('soundActivated', 'true'); _soundActivated = true; } catch (e) {}
        } catch (err) {}
        try { updateKnobIndicator(cfg.prop); } catch (err) {}
      }
      // show initial status on grab
      _showEffectLabelPercent(cfg.label, startNorm * 100);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp, { once: true });
      e.preventDefault();
    });
    // touch support
    btn.addEventListener('touchstart', (e) => {
      if (_isKnobDisabledForMode(id)) {
        const msg = '<div class="effect-sub">disable LINE RGB</div>';
        showEffectStatusMessage(id, false, msg);
        return;
      }
      const t = e.touches[0];
      dragging = true;
      startX = t.clientX;
      startVal = getVal();
      const r2 = (cfg.max - cfg.min) || 1;
      startNorm = (startVal - cfg.min) / r2;
      if (cfg.prop === 'volume' && !body.classList.contains('power-off')) {
        try {
          const k = _activeInputKey();
          const elA = (pvmGridSprite && pvmGridSprite.mediaType === 'media') ? pvmGridSprite.mediaEl : null;
          const elB = (_inputBLocalSprite && _inputBLocalSprite.mediaType === 'media') ? _inputBLocalSprite.mediaEl : null;
          if (k === 'a' && elA) { elA.muted = false; elA.volume = knobState.volume; }
          if (k === 'b' && elB) { elB.muted = false; elB.volume = knobState.volume; }
          try { localStorage.setItem('soundActivated', 'true'); } catch (e) {}
        } catch (err) {}
        try { updateKnobIndicator(cfg.prop); } catch (err) {}
      }
      _showEffectLabelPercent(cfg.label, startNorm * 100);
      window.addEventListener('touchmove', onMove, { passive: false });
      window.addEventListener('touchend', onUp, { once: true });
      e.preventDefault();
    }, { passive: false });

    // scroll-wheel support on this knob element only while hovered
    btn.addEventListener('wheel', (e) => {
      if (_isKnobDisabledForMode(id)) {
        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
        const msg = '<div class="effect-sub">disable LINE RGB</div>';
        showEffectStatusMessage(id, false, msg);
        return;
      }
      try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
      const range = (cfg.max - cfg.min) || 1;
      // Use normalized step so all knobs feel consistent regardless of range
      const normStep = 0.05; // 5% per notch
      const mult = e.shiftKey ? 3 : (e.ctrlKey || e.metaKey) ? 0.5 : 1;
      const dir = e.deltaY > 0 ? -1 : 1; // up increases
      const curNorm = (getVal() - cfg.min) / range;
      const newNorm = Math.max(0, Math.min(1, curNorm + dir * normStep * mult));
      const newVal = cfg.min + newNorm * range;
      // For volume: do not change value on wheel until user activation
      if (cfg.prop === 'volume' && !_userActivated) {
        showEffectStatusMessage('', null, 'click to enable audio');
        return;
      }
      setVal(newVal);
      const percent = ((getVal() - cfg.min) / range) * 100;
      _showEffectLabelPercent(cfg.label, percent);
      if (cfg.prop === 'volume') {
        if (!_userActivated) {
          // Do not attempt to unmute/play on wheel without activation; show hint instead
          showEffectStatusMessage('', null, 'click to enable audio');
        } else if (!body.classList.contains('power-off')) {
          try {
            try { if (window.audioLoop && window.audioLoop.resume) window.audioLoop.resume(); } catch (e) {}
            const k = _activeInputKey();
            const elA = (pvmGridSprite && pvmGridSprite.mediaType === 'media') ? pvmGridSprite.mediaEl : null;
            const elB = (_inputBLocalSprite && _inputBLocalSprite.mediaType === 'media') ? _inputBLocalSprite.mediaEl : null;
            if (k === 'a' && elA) {
              elA.muted = false; elA.volume = knobState.volume;
              try { const p = elA.play && elA.play(); if (p && p.catch) p.catch(()=>{}); } catch (e) {}
            }
            if (k === 'b' && elB) {
              elB.muted = false; elB.volume = knobState.volume;
              try { const p = elB.play && elB.play(); if (p && p.catch) p.catch(()=>{}); } catch (e) {}
            }
            _markSoundActivatedOnce();
          } catch (err) {}
        }
        updateKnobIndicator(cfg.prop);
      } else {
        applyColorAdjustments();
        updateKnobIndicator(cfg.prop);
      }
    }, { passive: false });
  });

  // Fallback: capture wheel on the SVG root and route to a knob if hovered
  if (!pvmSvg._hasWheelKnobHandler) {
    const KNOB_IDS = Object.keys(map);
    function findKnobId(target) {
      let cur = target;
      while (cur && cur !== pvmSvg) {
        if (cur.id && KNOB_IDS.includes(cur.id)) return cur.id;
        cur = cur.parentNode;
      }
      return null;
    }
    function onWheel(e) {
      const id = findKnobId(e.target);
      if (!id) return;
      const cfg = map[id]; if (!cfg) return;
      try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
      if (_isKnobDisabledForMode(id)) {
        const msg = '<div class="effect-sub">disable LINE RGB</div>';
        showEffectStatusMessage(id, false, msg);
        return;
      }
      const range = (cfg.max - cfg.min) || 1;
      const normStep = 0.05;
      const mult = e.shiftKey ? 3 : (e.ctrlKey || e.metaKey) ? 0.5 : 1;
      const dir = e.deltaY > 0 ? -1 : 1;
      const prop = cfg.prop;
      const curNorm = (knobState[prop] - cfg.min) / range;
      const newNorm = Math.max(0, Math.min(1, curNorm + dir * normStep * mult));
      if (prop === 'volume' && !_userActivated) {
        showEffectStatusMessage('', null, 'click to enable audio');
        return;
      }
      knobState[prop] = cfg.min + newNorm * range;
      const percent = ((knobState[prop] - cfg.min) / range) * 100;
      _showEffectLabelPercent(cfg.label, percent);
      if (prop === 'volume') {
        if (!_userActivated) {
          showEffectStatusMessage('', null, 'click to enable audio');
        } else if (!body.classList.contains('power-off')) {
          try {
            try { if (window.audioLoop && window.audioLoop.resume) window.audioLoop.resume(); } catch (e) {}
            const k = _activeInputKey();
            const elA = (pvmGridSprite && pvmGridSprite.mediaType === 'media') ? pvmGridSprite.mediaEl : null;
            const elB = (_inputBLocalSprite && _inputBLocalSprite.mediaType === 'media') ? _inputBLocalSprite.mediaEl : null;
            if (k === 'a' && elA) {
              elA.muted = false; elA.volume = knobState.volume;
              try { const p = elA.play && elA.play(); if (p && p.catch) p.catch(()=>{}); } catch (e) {}
            }
            if (k === 'b' && elB) {
              elB.muted = false; elB.volume = knobState.volume;
              try { const p = elB.play && elB.play(); if (p && p.catch) p.catch(()=>{}); } catch (e) {}
            }
            _markSoundActivatedOnce();
          } catch (err) {}
        }
        updateKnobIndicator(prop);
      } else {
        applyColorAdjustments();
        updateKnobIndicator(prop);
      }
    }
    pvmSvg.addEventListener('wheel', onWheel, { passive: false, capture: true });
    pvmSvg.addEventListener('mousewheel', onWheel, { passive: false, capture: true });
    pvmSvg.addEventListener('DOMMouseScroll', onWheel, { passive: false, capture: true });
    pvmSvg._hasWheelKnobHandler = true;
  }
}
//
// (Removed experimental aperture triad shader; restored DOM overlay approach)

// utility: list of all light ids in the <g id="lights"> group
const ALL_LIGHT_IDS = [
  '16-9-light',
  'hv-delay-light',
  'underscan-light',
  'blue-only-light',
  'degauss-light',
  'ext-sync-light',
  'line-rgb-light',
  'c-sdi-light',
  'b-component-light',
  'a-rgb-light',
  'power-light',
  'tally-light',
];
const ON_LIGHT_IDS = [
  'power-light',
  'a-rgb-light',
  'line-rgb-light',
  'ext-sync-light',
];

// ids for all toggleable lights (excluding power-light and tally-light)
const TOGGLE_LIGHT_IDS = [
  '16-9-light',
  'hv-delay-light',
  'underscan-light',
  'blue-only-light',
  'degauss-light',
  'ext-sync-light',
  'line-rgb-light',
  'c-sdi-light',
  'b-component-light',
  'a-rgb-light',
];

// Exclusive group: only one of these three may be ON at a time
const EXCLUSIVE_SOURCE_LIGHTS = [
  'a-rgb-light',
  'b-component-light',
  'c-sdi-light',
];

// --- Degauss tiers ---
const DEGAUSS_HALF_MS = 5 * 60 * 1000;
const DEGAUSS_FULL_MS = 10 * 60 * 1000;
let _lastDegaussMs = 0;
let _degaussLightTimerId = null;
let _degaussAbort = false;
// (Removed degauss video overlay entirely; underlay blur/shake only)
const _useDegaussOverlay = true;
// wobble state for degauss blur/wave effect
let _degaussWobble = { running: false, raf: null, sprite: null, origX: 0, origY: 0, origSX: 1, origSY: 1, blur: null, prevFilters: null, baseBlur: 0, ampXY: 0, ampS: 0, startTs: 0, decaying: false, decayStart: 0, decayMs: 0 };

function _removeDegaussOverlay() {
  // No-op: degauss video overlay removed; ensure wobble stops if requested
  try { _stopDegaussWobble(); } catch (e) {}
}

// (No degauss video overlay; function removed)

function _startDegaussWobble(strength = 1) {
  if (!window.PIXI) return;
  // Only wobble A/B (PIXI sprites)
  const target = _getActiveSprite && _getActiveSprite();
  if (!target) return;
  // If already running, stop and restart on current target
  try { _stopDegaussWobble(); } catch (e) {}
  const blur = new PIXI.filters.BlurFilter();
  // restore stronger blur for degauss wobble
  blur.blur = 2 + 6 * Math.max(0, Math.min(1, strength));
  const prev = Array.isArray(target.filters) ? target.filters.slice() : [];
  // Ensure degauss underlay stays clean: strip any GlitchFilter remnants
  const prevClean = prev.filter(f => {
    try {
      const name = f && f.constructor && f.constructor.name || '';
      return !/GlitchFilter/i.test(String(name));
    } catch (e) { return true; }
  });
  target.filters = [...prevClean, blur];
  _degaussWobble = {
    running: true,
    raf: null,
    sprite: target,
    origX: target.x,
    origY: target.y,
    origSX: target.scale.x,
    origSY: target.scale.y,
    blur,
    prevFilters: prevClean,
    baseBlur: blur.blur,
    // restore larger amplitude for more pronounced motion
    ampXY: 10 * strength,
    ampS: 0.05 * strength,
    startTs: performance.now(),
    decaying: false,
    decayStart: 0,
    decayMs: 0,
  };
  // restore faster wobble frequencies
  const freq1 = 18; // Hz
  const freq2 = 27; // Hz
  function tick(ts) {
    const st = _degaussWobble; if (!st.running || !st.sprite) return;
    const t = (ts - st.startTs) / 1000;
    const sx = Math.sin(2 * Math.PI * freq1 * t);
    const sy = Math.sin(2 * Math.PI * freq2 * t + Math.PI / 3);
    let factor = 1;
    if (st.decaying && st.decayMs > 0) {
      const p = Math.max(0, Math.min(1, (ts - st.decayStart) / st.decayMs));
      factor = 1 - p;
      if (p >= 1) { _stopDegaussWobble(); return; }
    }
    st.sprite.x = st.origX + sx * st.ampXY * factor;
    st.sprite.y = st.origY + sy * st.ampXY * factor;
    st.sprite.scale.x = st.origSX + sx * st.ampS * factor;
    st.sprite.scale.y = st.origSY + sy * st.ampS * factor;
    if (st.blur) st.blur.blur = st.baseBlur * factor;
    st.raf = requestAnimationFrame(tick);
  }
  _degaussWobble.raf = requestAnimationFrame(tick);
}

function _stopDegaussWobble() {
  const st = _degaussWobble;
  if (!st.running) return;
  st.running = false;
  try { if (st.raf) cancelAnimationFrame(st.raf); } catch (e) {}
  if (st.sprite) {
    try {
      st.sprite.x = st.origX;
      st.sprite.y = st.origY;
      st.sprite.scale.x = st.origSX;
      st.sprite.scale.y = st.origSY;
    } catch (e) {}
    try {
      // remove only the blur we added and restore prior filters
      st.sprite.filters = st.prevFilters || [];
    } catch (e) {}
  }
  _degaussWobble = { running: false, raf: null, sprite: null, origX: 0, origY: 0, origSX: 1, origSY: 1, blur: null, prevFilters: null, baseBlur: 0, ampXY: 0, ampS: 0, startTs: 0, decaying: false, decayStart: 0, decayMs: 0 };
}

function _beginDegaussWobbleFadeOut(ms) {
  const st = _degaussWobble;
  if (!st.running) return;
  st.decaying = true;
  st.decayMs = Math.max(0, ms || 0);
  st.decayStart = performance.now();
}

function _fadeOutDegaussEffect(ms = 1000) {
  // Only fade the wobble now that video overlay is removed
  try { _beginDegaussWobbleFadeOut(ms); } catch (e) {}
}

function setExclusiveSource(targetLightId) {
  // Ensure at least one of A/B/C is always ON.
  // - If target is OFF: turn it ON and turn others OFF (exclusive select).
  // - If target is ON: only turn it OFF if another source is currently ON; otherwise keep it ON.
  try {
    const isOn = !!toggleLightState[targetLightId];
    if (!isOn) {
      // Turn target ON exclusively
      EXCLUSIVE_SOURCE_LIGHTS.forEach(id => { toggleLightState[id] = false; });
      toggleLightState[targetLightId] = true;
      return;
    }
    // Target is ON — check if any other is ON
    const otherOn = EXCLUSIVE_SOURCE_LIGHTS.find(id => id !== targetLightId && !!toggleLightState[id]);
    if (otherOn) {
      // Switch to the other that is ON (effectively turns target OFF but keeps one ON)
      EXCLUSIVE_SOURCE_LIGHTS.forEach(id => { toggleLightState[id] = false; });
      toggleLightState[otherOn] = true;
    } else {
      // No other ON — keep target ON to prevent blanking
      toggleLightState[targetLightId] = true;
    }
  } catch (e) {
    // In case of any error, keep current selection unchanged to avoid all-off state
  }
}

// Set A/B/C selection exactly (no toggle semantics). If targetLightId is null, all off.
function setExclusiveSourceExact(targetLightId) {
  EXCLUSIVE_SOURCE_LIGHTS.forEach(id => { toggleLightState[id] = false; });
  if (targetLightId && EXCLUSIVE_SOURCE_LIGHTS.includes(targetLightId)) {
    toggleLightState[targetLightId] = true;
  }
}

// Reuse PIXI media path with an existing element (video or image)
function loadUserMediaFromEl(el, isVideo) {
  if (!screenContainer || !window.PIXI) return;
  const sprite = new PIXI.Sprite(PIXI.Texture.from(el));
  sprite.anchor.set(0.5, 0.5);
  sprite.x = screenApp.screen.width / 2;
  sprite.y = screenApp.screen.height / 2;
  sprite.mediaEl = el;
  sprite.mediaType = isVideo ? 'media' : 'image';
  const fit = () => {
    const w = isVideo ? el.videoWidth : el.naturalWidth;
    const h = isVideo ? el.videoHeight : el.naturalHeight;
    if (w && h) sizeSpriteToScreen(sprite, w, h, isVideo ? 'cover' : 'contain');
  };
  if (isVideo) {
    el.addEventListener('loadedmetadata', fit, { once: true });
    const p = el.play && el.play();
    if (p && p.catch) p.catch(()=>{ try{ el.muted = true; el.play(); }catch(_){}});
  } else {
    if (el.complete) fit(); else el.addEventListener('load', fit, { once: true });
  }
  try { if (pvmGridSprite) screenContainer.removeChild(pvmGridSprite); } catch (e) {}
  pvmGridSprite = sprite;
  screenContainer.addChild(pvmGridSprite);
  applyColorAdjustments();
  pvmGridSprite.alpha = body.classList.contains('power-off') ? 0 : 1;
  // no iframe cleanup needed
}

function getActiveExclusiveSourceId() {
  for (const id of EXCLUSIVE_SOURCE_LIGHTS) {
    if (toggleLightState[id]) return id;
  }
  return null;
}

function _activeInputKey() {
  const id = getActiveExclusiveSourceId();
  if (id === 'a-rgb-light') return 'a';
  if (id === 'b-component-light') return 'b';
  if (id === 'c-sdi-light') return 'c';
  return null;
}

function _ensureSpriteOnStage(sprite) {
  if (!sprite || !screenContainer) return;
  if (!sprite.parent) screenContainer.addChild(sprite);
}

function _setSpriteVisible(sprite, vis) {
  if (!sprite) return;
  sprite.alpha = vis ? 1 : 0;
}

// YouTube removed; shim remains for legacy calls
function _ensureYouTubeVisible(show) {}

function updateActiveSourceAudio() {
  const k = _activeInputKey();
  // A: default media
  try {
    if (pvmGridSprite && pvmGridSprite.mediaType === 'media' && pvmGridSprite.mediaEl) {
      const shouldUnmute = (_userActivated === true) && (k === 'a');
      pvmGridSprite.mediaEl.muted = !shouldUnmute;
      if (shouldUnmute) pvmGridSprite.mediaEl.volume = knobState.volume;
    }
  } catch (e) {}
  // B: local upload
  try {
    if (_inputBLocalSprite && _inputBLocalSprite.mediaType === 'media' && _inputBLocalSprite.mediaEl) {
      const shouldUnmute = (_userActivated === true) && (k === 'b');
      _inputBLocalSprite.mediaEl.muted = !shouldUnmute;
      if (shouldUnmute) _inputBLocalSprite.mediaEl.volume = knobState.volume;
    }
  } catch (e) {}
  // C: local upload
  try {
    if (_inputCLocalSprite && _inputCLocalSprite.mediaType === 'media' && _inputCLocalSprite.mediaEl) {
      const shouldUnmute = (_userActivated === true) && (k === 'c');
      _inputCLocalSprite.mediaEl.muted = !shouldUnmute;
      if (shouldUnmute) _inputCLocalSprite.mediaEl.volume = knobState.volume;
    }
  } catch (e) {}
  // Stop any decoupled A-audio loop when not on A
  try { if (k !== 'a' && window.audioLoop && window.audioLoop.stop) window.audioLoop.stop(); } catch (e) {}
}

function updateActiveSourceDisplay() {
  const k = _activeInputKey();
  // Default: hide all
  _setSpriteVisible(pvmGridSprite, false);
  _setSpriteVisible(_inputBLocalSprite, false);
  _setSpriteVisible(_inputCLocalSprite, false);
  if (k === 'a') {
    if (pvmGridSprite) {
      _ensureSpriteOnStage(pvmGridSprite);
      _setSpriteVisible(pvmGridSprite, true);
      try { if (pvmGridSprite.mediaEl && pvmGridSprite.mediaEl.readyState >= 2 && pvmGridSprite.mediaEl.paused) pvmGridSprite.mediaEl.play().catch(()=>{}); } catch (e) {}
    }
  } else if (k === 'b') {
    if (_inputBLocalSprite) {
      _ensureSpriteOnStage(_inputBLocalSprite);
      _setSpriteVisible(_inputBLocalSprite, true);
      try { if (_inputBLocalSprite.mediaEl && _inputBLocalSprite.mediaEl.readyState >= 2 && _inputBLocalSprite.mediaEl.paused) _inputBLocalSprite.mediaEl.play().catch(()=>{}); } catch (e) {}
    } else {
      // blank when no local upload yet
    }
  } else if (k === 'c') {
    if (_inputCLocalSprite) {
      _ensureSpriteOnStage(_inputCLocalSprite);
      _setSpriteVisible(_inputCLocalSprite, true);
      try { if (_inputCLocalSprite.mediaEl && _inputCLocalSprite.mediaEl.readyState >= 2 && _inputCLocalSprite.mediaEl.paused) _inputCLocalSprite.mediaEl.play().catch(()=>{}); } catch (e) {}
    }
  } else {
    // none active: blank
  }
  try { _updateCtFiltersForAll(); } catch (e) {}
  try { updatePvmGridTransform(); } catch (e) {}
  updateActiveSourceAudio();
}

// Remember last selected source for normal mode and for LINE mode
let lastSourceNormal = null; // one of EXCLUSIVE_SOURCE_LIGHTS or null
let lastSourceLine = null;   // one of EXCLUSIVE_SOURCE_LIGHTS or null
let initialSourceAtLoad = null; // capture initial A/B/C at first load

function initSourceMemoriesFromState() {
  const active = getActiveExclusiveSourceId();
  initialSourceAtLoad = active;
  // Seed both memories so we always have a fallback even if LINE starts enabled
  lastSourceNormal = active;
  lastSourceLine = active;
}

function refreshExclusiveSourceLights(pvmSvg, isPowerOn) {
  if (!pvmSvg) return;
  EXCLUSIVE_SOURCE_LIGHTS.forEach(id => {
    const el = pvmSvg.getElementById(id);
    if (el) {
      el.style.transition = 'opacity 0.1s ease-out';
      el.style.opacity = (isPowerOn && toggleLightState[id]) ? '1' : '0';
    }
  });
}

function _isAnyExclusiveSourceOn() {
  try {
    return EXCLUSIVE_SOURCE_LIGHTS.some(id => !!toggleLightState[id]);
  } catch (e) {
    return true; // fail open to showing media if state unavailable
  }
}

function applySourceBlanking() {
  // When power is on, reflect active input (A=default, B=local upload, C=local upload).
  if (!screenApp) return;
  if (body.classList.contains('power-off')) return;
  const hasPrev = (typeof window._lastActiveInputKey === 'string');
  const prev = hasPrev ? window._lastActiveInputKey : null;
  try { updateActiveSourceDisplay(); } catch (e) {}
  // After display update, detect input change and show status label
  try {
    const cur = _activeInputKey && _activeInputKey();
    // Do not show on initial page load before we have a previous input recorded
    const suppressed = !!window._suppressInputStatusOnce;
    if (suppressed) { window._suppressInputStatusOnce = false; }
    if (hasPrev && cur && cur !== prev && !suppressed) {
      const txt = _getInputSyncLabel(cur);
      showInputStatusLabel(txt);
    }
    window._lastActiveInputKey = cur;
  } catch (e) {}
}

function _getInputSyncLabel(k) {
  // Report simple system label; treat A as having a signal, B/C depend on loaded media
  if (k === 'b') return (_inputBLocalSprite ? 'NTSC' : 'NO SYNC');
  if (k === 'c') return (_inputCLocalSprite ? 'NTSC' : 'NO SYNC');
  return 'NTSC';
}

let _inputStatusTimer = null;
function showInputStatusLabel(text) {
  try {
    const parent = pvmSvgContainer && pvmSvgContainer.parentElement;
    const svg = pvmSvgContainer && pvmSvgContainer.querySelector('svg');
    if (!parent || !svg) return;
    const screen = svg.getElementById('screen'); if (!screen) return;
    let el = parent.querySelector('#input-status');
    if (!el) {
      el = document.createElement('div');
      el.id = 'input-status';
      el.style.position = 'absolute';
      el.style.pointerEvents = 'none';
      el.style.color = '#eaeaea';
      el.style.fontFamily = "'SonyCam', monospace";
      el.style.textTransform = 'uppercase';
      el.style.letterSpacing = '0.04em';
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.18s ease';
      // outline for readability
      el.style.textShadow = '1px 0 0 #000, -1px 0 0 #000, 0 1px 0 #000, 0 -1px 0 #000, 1px 1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, -1px -1px 0 #000';
      parent.appendChild(el);
    }
    // position bottom-left inside the screen with padding
    const sr = screen.getBoundingClientRect();
    const pr = parent.getBoundingClientRect();
    let fsPx = null;
    try { if (_pvmMenuEl) { fsPx = getComputedStyle(_pvmMenuEl).fontSize; } } catch (e) {}
    const fsNum = Math.max(12, Math.min(28, sr.height * 0.025));
    el.style.fontSize = fsPx || `${fsNum}px`;
    // Move label further up and to the right inside the raster
    const padX = Math.max(16, Math.round(sr.width * 0.08));
    const padY = Math.max(20, Math.round(sr.height * 0.14));
    el.style.left = `${Math.round(sr.left - pr.left) + padX}px`;
    // place above bottom with padding
    const approxH = (parseFloat(el.style.fontSize) || fsNum) * 1.2;
    el.style.top = `${Math.round(sr.top - pr.top + sr.height - approxH - padY)}px`;
    // match OSD z-index (above video, below overlays)
    try {
      const osdZ = _pvmMenuEl ? getComputedStyle(_pvmMenuEl).zIndex : null;
      el.style.zIndex = osdZ || '2';
    } catch (e) { el.style.zIndex = '2'; }
    el.textContent = text;
    // fade in
    el.style.opacity = '0';
    requestAnimationFrame(() => { el.style.opacity = '1'; });
    // clear any prior timer
    if (_inputStatusTimer) { clearTimeout(_inputStatusTimer); _inputStatusTimer = null; }
    _inputStatusTimer = setTimeout(() => {
      try {
        el.style.opacity = '0';
        el.addEventListener('transitionend', function handler(ev){
          if (ev.propertyName === 'opacity') { el.removeEventListener('transitionend', handler); }
        });
      } catch (e2) {}
    }, 5000);
  } catch (e) {}
}

const DEFAULT_ON_LIGHTS = [
  'a-rgb-light',
  'line-rgb-light',
  'ext-sync-light',
];
// track current on/off state for each light (reset on power cycle)
let toggleLightState = {};

// state for toggles
let isUnderscan = false;
let is169 = false;
let isBlueOnly = false;
let isHvDelay = false;

// track effect states
let scanlinesOn = true;
let phosphorOn = true;
let bloomOn = true;

// --- Phosphor overlay helpers ---
function setPhosphorBaseFromCssOnce(el) {
  if (!el || (el.dataset && el.dataset.baseOpacity)) return;
  const prevOpacity = el.style.opacity;
  el.style.opacity = '';
  const cssOpacity = parseFloat(getComputedStyle(el).opacity);
  const base = Number.isNaN(cssOpacity) ? 0.2 : cssOpacity;
  el.dataset.baseOpacity = String(base);
  el.style.opacity = prevOpacity;
}

// compatibility shim: map any legacy pixi alpha requests to the dom phosphor base
function getPhosphorBaseAlpha() {
  // optional css var (preferred): :root { --phosphor-strength: .12 }
  const cssVar = getComputedStyle(document.documentElement)
    .getPropertyValue('--phosphor-strength')
    .trim();
  if (cssVar) {
    const v = parseFloat(cssVar);
    if (!Number.isNaN(v)) return v;
  }
  // legacy fallback: if a .phosphor node exists, read its computed opacity
  const legacy = document.querySelector('.phosphor');
  if (legacy) {
    const v = parseFloat(getComputedStyle(legacy).opacity);
    if (!Number.isNaN(v)) return v;
  }
  return 0.12;
}

// dom phosphor overlay implementation (restored from script_old.js)
function getPhosphorBaseOpacity() {
  const el = document.querySelector('.phosphor');
  if (el) {
    const ds = el.dataset && el.dataset.baseOpacity;
    if (ds && !Number.isNaN(parseFloat(ds))) return parseFloat(ds);
    const cssOpacity = parseFloat(getComputedStyle(el).opacity);
    if (!Number.isNaN(cssOpacity)) return cssOpacity;
  }
  return 0.35;
}

// removed duplicate setPhosphorBaseFromCssOnce (kept single definition above)

// add createPhosphorOverlay function (copied from script_old.js)
function createPhosphorOverlay(svgDoc) {
  // remove any existing overlay
  const existing = document.querySelector('.phosphor');
  if (existing) existing.remove();
  const svgScreenElement = svgDoc.getElementById('screen');
  if (!svgScreenElement) return;
  const screenRect = svgScreenElement.getBoundingClientRect();
  const containerRect = pvmSvgContainer.parentElement.getBoundingClientRect();
  // round all values to nearest integer
  const left = Math.round(screenRect.left - containerRect.left);
  const top = Math.round(screenRect.top - containerRect.top);
  const width = Math.round(screenRect.width);
  const height = Math.round(screenRect.height);
  const overlay = document.createElement('div');
  overlay.className = 'phosphor';
  overlay.style.position = 'absolute';
  overlay.style.left = `${left}px`;
  overlay.style.top = `${top}px`;
  overlay.style.width = `${width}px`;
  overlay.style.height = `${height}px`;
  overlay.style.backgroundImage = "url('/assets/images/aperature.png')";
  overlay.style.backgroundRepeat = 'repeat';
  overlay.style.backgroundSize = '10px 10px';
  overlay.style.opacity = phosphorOn ? '0.35' : '0';
  overlay.style.pointerEvents = 'none';
  overlay.style.zIndex = '2';
  // re-enable clip-path for masking (relies on an SVG clipPath with id="screen-clip")
  overlay.style.clipPath = 'url(#screen-clip)';
  const parent = pvmSvgContainer.parentElement;
  parent.appendChild(overlay);
}

// --- Effect State Persistence ---
function saveEffectState(key, value) {
  try { localStorage.setItem(key, String(value)); } catch (e) { /* ignore */ }
}

function loadEffectStates() {
  // Do not read persisted visual effect states; use in-memory defaults

  // apply to existing dom/pixi if available
  const scanlinesElement = document.querySelector('.scanlines');
  if (scanlinesElement) {
    // never enable scanlines visually while the tv is powered off
    if (!body.classList.contains('power-off') && scanlinesOn) {
      scanlinesElement.style.display = '';
      scanlinesElement.style.opacity = '1';
    } else {
      scanlinesElement.style.opacity = '0';
      scanlinesElement.style.display = 'none';
    }
  }

  // ensure dom phosphor overlay reflects saved state
  try {
    const svgDoc = pvmSvgContainer.querySelector('svg');
    if (svgDoc) createPhosphorOverlay(svgDoc);
    const overlay = document.querySelector('.phosphor');
    // ensure phosphor overlay is hidden while power is off
    if (overlay) overlay.style.opacity = (!body.classList.contains('power-off') && phosphorOn) ? '0.35' : '0';
  } catch (e) { /* ignore */ }

  if (screenApp && screenApp.stage) {
    // do not enable bloom while power is off
    if (!body.classList.contains('power-off') && bloomOn) {
      if (_ensureBloomFilter()) {
        if (typeof bloomFilter.blur === 'number') bloomFilter.blur = 2;
        if (typeof bloomFilter.bloomBlur === 'number') bloomFilter.bloomBlur = 2;
      }
    } else {
      screenApp.stage.filters = null;
      bloomFilter = null;
    }
  }
}
// static effect is now controlled in media.js (halloween week only)

let bloomFilter = null;
let _bloomFadeFrameId = null;
// removed PIXI phosphor layer - replaced by DOM overlay
let _phosphorFadeFrameId = null;

// --- PIXI Phosphor ticker binding ---
// removed pixi ticker binding for phosphor - dom overlay updates directly via CSS

// (removed older setupManualLoop; using a simpler inline timeupdate loop in createMediaSprite)

// initialize when dom is loaded
window.addEventListener('DOMContentLoaded', () => {
  try {
    // Ensure any pre-existing phosphor node uses an absolute background URL
    const pre = document.querySelector('.phosphor');
    if (pre) pre.style.backgroundImage = "url('/assets/images/aperature.png')";
  } catch (e) {}
  // if we are on the gallery page, initialize the gallery and skip homepage init
  if (document.querySelector('.gallery-layout')) {
    if (typeof initGalleryPage === 'function') initGalleryPage();
    // Handle direct navigation to /gallery/:slug on initial load
    const path = window.location.pathname;
    if (path.startsWith('/gallery/')) {
      const slug = path.split('/gallery/')[1].replace(/\/$/, '');
      if (typeof renderPageFromSlug === 'function') {
        renderPageFromSlug(slug);
      }
    }
    return;
  }
  // core initialization (homepage only)
  initDarkModeHandler();
  createGreyOverlay();
  loadPvmSvg();
  initPowerManagement();
  // Volume is controlled explicitly by the PVM volume button.
  // animate both message and reflection
  const messageElement = document.querySelector('.message');
  const glowReflection = document.querySelector('.pvm-glow-reflection');
  if (messageElement && glowReflection) {
    messageElement.dataset.rawText = messageElement.textContent;
    glowReflection.dataset.rawText = messageElement.textContent;
    initMessageAnimation(messageElement);
    initMessageAnimation(glowReflection);
  }
  initMessageAnimation();
  // hide crt effects and show grey square if tv is off on page load
  if (body.classList.contains('power-off')) {
    // Force cold-start sound on next power-on after a page reload with TV off
    try { localStorage.setItem('forceColdStart', 'true'); } catch (e) {}
    setCrtEffectsOpacity(0);
    try { updateActiveSourceDisplay(); } catch (e) {}
    ensureGreySquareForPowerOff();
    setTimeout(() => {
      if (pvmGridSprite && pvmGridSprite.mediaEl) {
        pvmGridSprite.mediaEl.muted = true;
      }
    }, 0);
  }
  if (typeof loadButtonStates === 'function') { loadButtonStates(); }
  loadEffectStates();
});

// load pvm svg dynamically
// =================
function createGreyOverlay() {
  // remove any existing overlay
  const existing = document.querySelector('.pvm-grey-overlay');
  if (existing) existing.remove();
  // find the svg screen element to match size/position
  const svgDoc = pvmSvgContainer.querySelector('svg');
  if (!svgDoc) return;
  const svgScreenElement = svgDoc.getElementById('screen');
  if (!svgScreenElement) return;
  const screenRect = svgScreenElement.getBoundingClientRect();
  const containerRect = pvmSvgContainer.parentElement.getBoundingClientRect();
  const left = screenRect.left - containerRect.left;
  const top = screenRect.top - containerRect.top;
  const width = screenRect.width;
  const height = screenRect.height;
  const overlay = document.createElement('div');
  overlay.className = 'pvm-grey-overlay';
  overlay.style.position = 'absolute';
  overlay.style.left = `${left}px`;
  overlay.style.top = `${top}px`;
  overlay.style.width = `${width}px`;
  overlay.style.height = `${height}px`;
  let pillarColor = body.classList.contains('dark-mode') ? '#0f0f10' : '#171717';
  try {
    const pixiCanvas = pvmSvgContainer.parentElement.querySelector('.pvm-pixi-canvas');
    if (pixiCanvas) {
      const computed = getComputedStyle(pixiCanvas).backgroundColor;
      if (computed && computed !== 'rgba(0, 0, 0, 0)' && computed !== 'transparent') {
        pillarColor = computed;
      }
    }
  } catch (e) { /* best effort to match pillarboxing color */ }
  overlay.style.background = pillarColor;
  overlay.style.pointerEvents = 'none';
  overlay.style.zIndex = '0'; // always at the very bottom
  overlay.style.opacity = '1'; // always fully opaque
  const parent = pvmSvgContainer.parentElement;
  const firstChild = parent.firstChild;
  if (firstChild) {
    parent.insertBefore(overlay, firstChild);
  } else {
    parent.appendChild(overlay);
  }
}

let _pendingGreyOverlayRefresh = false;
function requestGreyOverlayRefresh() {
  if (_pendingGreyOverlayRefresh) return;
  _pendingGreyOverlayRefresh = true;
  requestAnimationFrame(() => {
    _pendingGreyOverlayRefresh = false;
    try { createGreyOverlay(); } catch (e) {}
  });
}

function loadPvmSvg() {
  fetch('/assets/images/pvm.svg')
    .then(response => response.text())
    .then(svgText => {
      if (pvmSvgContainer) {
        pvmSvgContainer.innerHTML = svgText;
        let pvmSvg = pvmSvgContainer.querySelector('svg');
        if (pvmSvg) {
          const svgScreenElement = pvmSvg.getElementById('screen');
          
          if (svgScreenElement) {
            svgScreenElement.style.pointerEvents = 'auto'; // make the path itself interactive
            svgScreenElement.style.cursor = 'pointer';
            svgScreenElement.style.fill = 'rgba(0,0,0,0.001)'; // almost transparent fill to help capture clicks
            svgScreenElement.addEventListener('click', (e) => {
              if (body.classList.contains('power-off')) {
                e.preventDefault();
                e.stopPropagation();
                return;
              }
              e.preventDefault();
              openChatbox();
            });

            // tally light hover effect
            const tallyLightElement = pvmSvg.getElementById('tally-light');
            if (svgScreenElement && tallyLightElement) {
              tallyLightElement.style.opacity = '0';
              tallyLightElement.style.transition = 'opacity 0.3s ease-out';

              svgScreenElement.addEventListener('mouseenter', () => {
                if (!body.classList.contains('power-off')) {
                  tallyLightElement.style.transition = 'opacity 0.05s ease-in';
                  tallyLightElement.style.opacity = '1';
                }
              });

              svgScreenElement.addEventListener('mouseleave', () => {
                tallyLightElement.style.transition = 'opacity 0.3s ease-out';
                tallyLightElement.style.opacity = '0';
              });
            } else if (!tallyLightElement) {
              console.warn('tally light element (id: tally-light) not found in svg.');
            }

            initScreenEffects(svgScreenElement);
            
            // call setup functions after svg is loaded into the dom
            setupSvgPower(pvmSvg);
            setTimeout(() => {
              const bodyIsDark = body.classList.contains('dark-mode');
              if (window.setSvgMode) window.setSvgMode(bodyIsDark);
            }, 0);

            // set initial pointer events and cursor for the screen based on power state
            if (body.classList.contains('power-off')) {
              svgScreenElement.style.pointerEvents = 'none';
              svgScreenElement.style.cursor = 'default';
            } else {
              svgScreenElement.style.pointerEvents = 'auto';
              svgScreenElement.style.cursor = 'pointer';
            }

            // centralize PVM control button wiring (only up/down for channel surf)
            const PVM_BUTTON_ACTIONS = {
              // Up/Down: navigate OSD when visible; otherwise change channel
              up: () => handleUpDown('up'),
              down: () => handleUpDown('down'),
              // MENU acts as a general Back: submenu -> root; root -> close; closed -> open
              menu: () => handleMenu(),
              enter: () => handleEnter(),
            };
            Object.keys(PVM_BUTTON_ACTIONS).forEach((id) => {
              const btn = pvmSvg.getElementById(id);
              if (!btn) return;
              btn.style.cursor = 'pointer';
              btn.style.pointerEvents = 'all';
              let _repeatTimer = null;
              const _repeatDelayStart = 500;   // start repeating after 0.5s
              const _repeatInterval = 35;      // a little faster (~14 ticks per 0.5s)
              function _stopRepeat() { if (_repeatTimer) { clearTimeout(_repeatTimer); _repeatTimer = null; } }
              function _startRepeat(dir) {
                _stopRepeat();
                const editingGeometry = isPvmMenuVisible() && _pvmMenuMode === 'geometry' && _geomEdit.active;
                const editingColorTemp = isPvmMenuVisible() && _pvmMenuMode === 'color-temp' && _ctEdit.active && _pvmMenuIndex === 2;
                if (!editingGeometry && !editingColorTemp) return;
                const fire = () => {
                  try { handleUpDown(dir); } catch (e) {}
                  _repeatTimer = setTimeout(fire, _repeatInterval);
                };
                _repeatTimer = setTimeout(fire, _repeatDelayStart);
              }
              btn.addEventListener('click', (e) => {
                e.preventDefault();
                if (body.classList.contains('power-off')) return;
                try { PVM_BUTTON_ACTIONS[id](); } catch (err) {}
              });
              if (id === 'up' || id === 'down') {
                btn.addEventListener('pointerdown', (e) => {
                  if (body.classList.contains('power-off')) return;
                  _startRepeat(id);
                });
                btn.addEventListener('pointerup', _stopRepeat);
                btn.addEventListener('pointerleave', _stopRepeat);
              }
            });
          } else {
            console.error('svg screen element not found, cannot make it clickable.');
          }
          setToggleLightsToDefault();
          // initialize remembered sources based on current state
          initSourceMemoriesFromState();
          setupToggleLightButtons(pvmSvg);
          const powerOn = !body.classList.contains('power-off');
          setSvgLightsPowerState(pvmSvg, powerOn);
          updateAllKnobIndicators();
          updateIndicatorThemeVisibility();
          if (powerOn) {
            // Ensure exclusive lights and blanking reflect current state on load
            refreshExclusiveSourceLights(pvmSvg, true);
            applySourceBlanking();
          }
          createGreyOverlay();
          // createPhosphorOverlay(pvmSvg); // now handled in DOMContentLoaded init area
          // overlays align via initial layout logic
        }
      }
    })
    .catch(error => console.error('error loading pvm svg:', error));
}

// Initialize screen effects (video, scanlines, vignette, phosphor)
// ========================================================
function ensureGreySquareForPowerOff() {
  // function simplified as per requirement
}

function initScreenEffects(svgScreenElement) {
  
  if (!svgScreenElement) {
    console.error('svg screen element is null in initscreeneffects, cannot proceed with pixi setup.');
    return;
  }
  const screenPathRect = svgScreenElement.getBoundingClientRect();
  if (screenPathRect.width === 0 || screenPathRect.height === 0) {
    console.error('svg screen path has zero dimensions, aborting pixi setup.');
    return;
  }
  const pvmContainerElement = pvmSvgContainer.parentElement;
  if (!pvmContainerElement) {
    console.error('pvm container element not found, aborting pixi setup.');
    return;
  }
  const containerRect = pvmContainerElement.getBoundingClientRect();
  const pixiAppLeft = screenPathRect.left - containerRect.left;
  const pixiAppTop = screenPathRect.top - containerRect.top;
  const pixiAppWidth = screenPathRect.width;
  const pixiAppHeight = screenPathRect.height;

  screenApp = new PIXI.Application({
    width: pixiAppWidth,
    height: pixiAppHeight,
    backgroundAlpha: 0, 
    antialias: true, 
    forceCanvas: false,
  });
  // Improve pixel snapping and allow z-ordering
  screenApp.renderer.roundPixels = true;
  screenApp.stage.sortableChildren = true;

  const existingScreenCanvas = pvmContainerElement.querySelector('canvas.pvm-pixi-canvas');
  if (existingScreenCanvas) {
    existingScreenCanvas.remove();
  }
  screenApp.view.classList.add('pvm-pixi-canvas');
  pvmContainerElement.appendChild(screenApp.view);
  screenApp.view.style.position = 'absolute';
  screenApp.view.style.left = `${pixiAppLeft}px`;
  screenApp.view.style.top = `${pixiAppTop}px`;
  screenApp.view.style.width = `${pixiAppWidth}px`;
  screenApp.view.style.height = `${pixiAppHeight}px`;
  screenApp.view.style.zIndex = '1'; 
  screenApp.view.style.pointerEvents = 'none';

  const scanlinesElement = pvmContainerElement.querySelector('.scanlines');
  if (scanlinesElement) {
    scanlinesElement.style.position = 'absolute';
    scanlinesElement.style.left = `${pixiAppLeft}px`;
    scanlinesElement.style.top = `${pixiAppTop}px`;
    scanlinesElement.style.width = `${pixiAppWidth}px`;
    scanlinesElement.style.height = `${pixiAppHeight}px`;
    // Keep scanlines above video/color-temp/vignette, but below bezel art
    scanlinesElement.style.zIndex = '5';
    scanlinesElement.style.pointerEvents = 'none';
    try { scanlinesElement.style.clipPath = 'url(#screen-clip)'; } catch (e) {}
  }


  // create container
  const baseW = screenApp.screen.width;
  const baseH = screenApp.screen.height;
  screenContainer = new PIXI.Container();
  // ensure zIndex is respected for overlay ordering
  screenContainer.sortableChildren = true;
  screenContainer.baseW = baseW;
  screenContainer.baseH = baseH;
  screenContainer.x = 0;
  screenContainer.y = 0;
  screenContainer.scale.set(1, 1);
  // create video sprite
  pvmGridSprite = createMediaSprite();
  // add to container
  screenContainer.addChild(pvmGridSprite);
  // add container to stage
  screenApp.stage.addChild(screenContainer);
  // initialize color adjustments stack after screenContainer exists
  applyColorAdjustments();

  // keep DOM overlay approach (no shader triad)

  // set initial alpha based on power state (robust, after both sprites are added)
  if (body.classList.contains('power-off')) {
    pvmGridSprite.alpha = 0;
  } else {
    pvmGridSprite.alpha = 1;
    showStaticOverlay(); // toggle: on
  }

  // create dom phosphor overlay above the video, sized to the screen
  try {
    const svgDoc = pvmSvgContainer.querySelector('svg');
    if (svgDoc) createPhosphorOverlay(svgDoc);
      const overlay = document.querySelector('.phosphor');
      if (overlay) overlay.style.opacity = body.classList.contains('power-off') ? '0' : (phosphorOn ? '0.35' : '0');
  } catch (e) { /* ignore */ }

  initMediaGlowEffect(screenApp);

  // vignette overlay
  let vignetteOverlay = pvmContainerElement.querySelector('.vignette-overlay');
  if (vignetteOverlay) vignetteOverlay.remove();
  vignetteOverlay = document.createElement('div');
  vignetteOverlay.className = 'vignette-overlay';
  vignetteOverlay.style.left = `${pixiAppLeft}px`;
  vignetteOverlay.style.top = `${pixiAppTop}px`;
  vignetteOverlay.style.width = `${pixiAppWidth}px`;
  vignetteOverlay.style.height = `${pixiAppHeight}px`;
  vignetteOverlay.style.zIndex = '4';
  // insert as the first child so it is below the svg and overlays
  pvmContainerElement.insertBefore(vignetteOverlay, pvmContainerElement.firstChild);

  // after adding screenContainer to stage, apply default bloom if bloomOn is true
  if (screenApp && screenApp.stage) {
    if (bloomOn) {
      bloomFilter = new PIXI.filters.BloomFilter(2, 4, 0, 7);
      screenApp.stage.filters = [bloomFilter];
    } else {
      bloomFilter = null;
      screenApp.stage.filters = null;
    }
  }
}

// Power Management
// ========
// initialize power management
function initPowerManagement() {
  // check power state
  const isPowerOff = localStorage.getItem('powerEnabled') === 'false';
  
  // apply power-off class if needed
  if (isPowerOff) {
    body.classList.add('power-off');
  } else {
    localStorage.setItem('powerEnabled', 'true');
  }
}

// set up the power button in svg
function setupSvgPower(svgDoc) {
  if (!svgDoc) return;
  
  // get the power button
  const powerButton = svgDoc.getElementById('power');
  if (!powerButton) return;
  
  // remove tooltip logic entirely
  powerButton.onmouseenter = null;
  powerButton.onmousemove = null;
  powerButton.onmouseleave = null;
  
  // check the power state
  const isPowerOff = body.classList.contains('power-off');
  
  // set initial power light state
  const powerLight = svgDoc.getElementById('power-light');
  if (powerLight) {
    powerLight.style.transition = 'opacity 0.1s ease-out';
    powerLight.style.opacity = isPowerOff ? '0' : '1';
  }
  
  // make the power button invisible by default, but clickable
  powerButton.setAttribute('fill', 'none');
  powerButton.setAttribute('stroke', 'none');
  powerButton.style.cursor = 'pointer';
  powerButton.style.pointerEvents = 'all';
  // remove keyboard accessibility
  powerButton.removeAttribute('tabindex');
  powerButton.removeAttribute('role');
  powerButton.removeAttribute('aria-label');
  powerButton.onkeydown = null;

  // add click event to toggle power state
  powerButton.onclick = () => {
    if (body.classList.contains('power-off')) {
      turnOnTV();
    } else {
      turnOffTV();
    }
  };
}

// function to turn off the tv
function turnOffTV() {
  // record last power-off for warm/cold start logic
  try { localStorage.setItem('lastPowerOffMs', String(Date.now())); } catch (e) {}
  // cancel any pending delayed unmute on power-off
  try { if (_audioUnmuteTimerId) { clearTimeout(_audioUnmuteTimerId); _audioUnmuteTimerId = null; } } catch (e) {}
  // play power-off sound; stop any ongoing power one-shots to prevent overlap
  stopOneShotByRole('power');
  stopAllOneShots();
  playOneShot('poweroff-audio', 0.3, 'power');
  // cancel any ongoing grid fade-in animation
  if (gridFadeInFrameId !== null) {
    cancelAnimationFrame(gridFadeInFrameId);
    gridFadeInFrameId = null;
  }
  body.classList.add('power-off');
  localStorage.setItem('powerEnabled', 'false');
  requestGreyOverlayRefresh();
  try { _updateCtOverlayVisibility(); } catch (e) {}
  // update power light in svg
  let pvmSvg = pvmSvgContainer.querySelector('svg');
  if (pvmSvg) {
    const powerLight = pvmSvg.getElementById('power-light');
    if (powerLight) {
      powerLight.style.opacity = '0';
    }
    // turn off tally light
    const tallyLight = pvmSvg.getElementById('tally-light');
    if (tallyLight) {
      tallyLight.style.opacity = '0';
    }
    // disable svg screen interactivity
    const svgScreenElement = pvmSvg.getElementById('screen');
    if (svgScreenElement) {
      svgScreenElement.style.pointerEvents = 'none';
      svgScreenElement.style.cursor = 'default';
    }
  }
  // instantly hide grid image and crt effects
  if (pvmGridSprite) pvmGridSprite.alpha = 0;
  setCrtEffectsOpacity(0);
  // disable chat interactivity
  const chatElement = document.getElementById('chat');
  if (chatElement) {
    chatElement.style.pointerEvents = 'none';
    chatElement.style.cursor = 'default';
    chatElement.setAttribute('aria-disabled', 'true');
    chatElement.tabIndex = -1;
  }
  
  setSvgLightsPowerState(pvmSvg, false);
  try { _stopExtSyncPulse(); } catch (e) {}
  if (pvmGridSprite && pvmGridSprite.mediaEl) {
    pvmGridSprite.mediaEl.muted = true;
  }
  try { if (_inputBLocalSprite && _inputBLocalSprite.mediaEl) _inputBLocalSprite.mediaEl.muted = true; } catch (e) {}
  try { if (_inputCLocalSprite && _inputCLocalSprite.mediaEl) _inputCLocalSprite.mediaEl.muted = true; } catch (e) {}
  // clear degauss light timer and state
  try { if (_degaussLightTimerId) { clearTimeout(_degaussLightTimerId); _degaussLightTimerId = null; } } catch (e) {}
  try { toggleLightState['degauss-light'] = false; } catch (e) {}
  // stop decoupled audio if running
  try { if (window.audioLoop && window.audioLoop.stop) window.audioLoop.stop(); } catch (e) {}
  // Hide the phosphor effect when off (legacy references removed)
  const phosphorOverlay = document.querySelector('.phosphor');
  if (phosphorOverlay) { phosphorOverlay.style.opacity = '0'; }
  // hide OSD menu if visible
  try { hidePvmMenu(); } catch (e) {}
}

function debugPhosphorState() {
  const svg = document.querySelector('#pvm-svg-container svg');
  if (!svg) {
    return;
  }
  // count patterns
  const patterns = svg.querySelectorAll('pattern#phosphorPattern');

  // check screen path
  const screen = svg.getElementById('screen');
  if (screen) {
  } else {
  }

  // count grid images
  const gridImages = svg.querySelectorAll('#grid-image');

  // list all direct children of svg for visual inspection
}

// function to turn on the tv
function turnOnTV() {
  // On power-on, restart degauss cooldown timer (treat as recently degaussed)
  try { _lastDegaussMs = Date.now(); } catch (e) {}
  // Play power-on sound based on warm/cold state
  try {
    const forceCold = (localStorage.getItem('forceColdStart') === 'true');
    if (forceCold) { try { localStorage.removeItem('forceColdStart'); } catch (e) {} }
    const lastOff = parseInt(localStorage.getItem('lastPowerOffMs') || '0', 10) || 0;
    const now = Date.now();
    const offMs = lastOff ? (now - lastOff) : 0;
    const WARM_MS = 5 * 60 * 1000;
    const COLD_FULL_MS = 10 * 60 * 1000;
    if (forceCold) {
      playOneShot('power-cold-audio', 0.7, 'power');
    } else if (!lastOff || offMs < WARM_MS) {
      playOneShot('power-warm-audio', 0.7);
    } else if (offMs < COLD_FULL_MS) {
      playOneShot('power-cold-audio', 0.35);
    } else {
      playOneShot('power-cold-audio', 0.7);
    }
  } catch (e) {}
  body.classList.remove('power-off');
  localStorage.setItem('powerEnabled', 'true');
  // On power-on: reset geometry values to their defaults (session default if present)
  try { _applyAllGeomDefaults(); } catch (e) {}
  try { if (isPvmMenuVisible && isPvmMenuVisible() && _pvmMenuMode === 'geometry') renderPvmMenu(); } catch (e) {}
  try { _updateCtOverlayVisibility(); } catch (e) {}
  requestGreyOverlayRefresh();
  // Do not restore phosphor state from storage; honor current in-memory value
  // update power light in svg
  let pvmSvg = pvmSvgContainer.querySelector('svg');
  if (pvmSvg) {
    const powerLight = pvmSvg.getElementById('power-light');
    if (powerLight) {
      powerLight.style.opacity = '1';
    }
    // tally light will be handled by hover logic, but ensure it's off initially
    const tallyLight = pvmSvg.getElementById('tally-light');
    if (tallyLight) {
      tallyLight.style.opacity = '0';
    }
    // enable svg screen interactivity
    const svgScreenElement = pvmSvg.getElementById('screen');
    if (svgScreenElement) {
      svgScreenElement.style.pointerEvents = 'auto';
      svgScreenElement.style.cursor = 'pointer';
    }
  }
  // crt fade-in
  if (pvmGridSprite) {
    // ensure dom phosphor overlay exists and is ready to fade with power-on
    try {
      const svgDoc = pvmSvgContainer.querySelector('svg');
      if (svgDoc) createPhosphorOverlay(svgDoc);
      const overlay = document.querySelector('.phosphor');
      if (overlay) {
        overlay.style.opacity = '0';
      }
    } catch (e) { /* ignore */ }
    // Drive only overall CRT layer opacity (canvas + scanlines), not individual sprites
    setCrtEffectsOpacity(0);
    const totalDuration = 10000; // 10 seconds
    const faintGlowStart = 3000; // 3s
    const faintGlowEnd = 5000;   // 5s
    const moderateStart = 7000;  // 7s
    const moderateEnd = 8000;    // 8s
    if (gridFadeInFrameId !== null) {
      cancelAnimationFrame(gridFadeInFrameId);
      gridFadeInFrameId = null;
    }
    let fadeStartTime = null;
    const baseForPower = 0.35;
    function animateNonLinearFade(now) {
      if (!fadeStartTime) fadeStartTime = now;
      const elapsed = now - fadeStartTime;
      if (body.classList.contains('power-off')) {
        gridFadeInFrameId = null;
        setCrtEffectsOpacity(0);
        return;
      }
      let alpha = 0;
      if (elapsed < faintGlowStart) {
        alpha = 0;
      } else if (elapsed < faintGlowEnd) {
        alpha = 0.25 * ((elapsed - faintGlowStart) / (faintGlowEnd - faintGlowStart));
      } else if (elapsed < moderateStart) {
        alpha = 0.25 + 0.4 * ((elapsed - faintGlowEnd) / (moderateStart - faintGlowEnd));
      } else if (elapsed < moderateEnd) {
        alpha = 0.65 + 0.05 * ((elapsed - moderateStart) / (moderateEnd - moderateStart));
      } else if (elapsed < totalDuration) {
        alpha = 0.7 + 0.3 * ((elapsed - moderateEnd) / (totalDuration - moderateEnd));
      } else {
        alpha = 1;
      }
      setCrtEffectsOpacity(Math.min(alpha, 1));
      // fade dom phosphor overlay with the same alpha curve, capped to its base
      try {
        const overlay = document.querySelector('.phosphor');
        if (overlay) {
          const a = Math.min(alpha, 1);
          const base = baseForPower;
          overlay.style.opacity = phosphorOn ? String(base * a) : '0';
        }
      } catch (e) { /* ignore */ }
      if (elapsed < totalDuration) {
        gridFadeInFrameId = requestAnimationFrame(animateNonLinearFade);
      } else {
        setCrtEffectsOpacity(1);
        // ensure dom phosphor overlay ends at its target value
        try {
          const overlay = document.querySelector('.phosphor');
          if (overlay) overlay.style.opacity = phosphorOn ? '0.35' : '0';
        } catch (e) { /* ignore */ }
        gridFadeInFrameId = null;
      }
    }
    gridFadeInFrameId = requestAnimationFrame(animateNonLinearFade);
  }
  // show crt effect layers (scanlines, phosphor, etc.) — respect current toggle states
  const scanlinesElement = document.querySelector('.scanlines');
  if (scanlinesElement) {
    if (scanlinesOn) {
      scanlinesElement.style.display = '';
      scanlinesElement.style.opacity = '1';
    } else {
      scanlinesElement.style.opacity = '0';
      scanlinesElement.style.display = 'none';
    }
  }
  // enable chat interactivity
  const chatElement = document.getElementById('chat');
  if (chatElement) {
    chatElement.style.pointerEvents = 'auto';
    chatElement.style.cursor = 'pointer';
    chatElement.removeAttribute('aria-disabled');
    chatElement.tabIndex = 0;
  }
  setSvgLightsPowerState(pvmSvg, true);
  updateToggleLights(pvmSvg, true);
  if (pvmGridSprite && pvmGridSprite.mediaEl) {
    // Start playing default media muted; active-source logic will unmute the selected input
    const media = pvmGridSprite.mediaEl;
    try { media.play(); } catch (e) {}
    try { media.muted = true; } catch (e) {}
    try { media.volume = Math.max(0, Math.min(1, knobState.volume)); } catch (e) {}
  }
  // kick off decoupled audio loop for current media (requires user gesture; power click provides it)
  // Start decoupled audio loop only when Input A is active; ensure muted otherwise
  try {
    if (_activeInputKey() === 'a') {
      const name = pvmGridSprite && pvmGridSprite.mediaName;
      const url = (window.getAudioUrlForVideo && name) ? window.getAudioUrlForVideo(name) : null;
      if (url && window.audioLoop && window.audioLoop.play) window.audioLoop.play(url);
    } else {
      if (window.audioLoop && window.audioLoop.stop) window.audioLoop.stop();
    }
  } catch (e) {}
  // Ensure visible source and audio reflect current input
  try { updateActiveSourceDisplay(); } catch (e) {}
  // safety: ensure dom phosphor matches its toggle
  try {
    const overlay = document.querySelector('.phosphor');
    if (overlay) overlay.style.opacity = phosphorOn ? String(getPhosphorBaseOpacity()) : '0';
  } catch (e) { /* ignore */ }
  // Do NOT forcibly enable scanlines, phosphor, vignette, or sunlight effects here.
  // reflect current EXT SYNC state for continuous pulse
  try { _updateExtSyncPulse(); } catch (e) {}
}

// message animation
// =========
// animation for the message text
function initMessageAnimation(targetElement) {
  if (!targetElement) return;
  // preserve anchors so links remain clickable
  const link = targetElement.querySelector('a');
  if (link) {
    const text = (link.textContent || '').trim();
    link.textContent = '';
    [...text].forEach((char, i) => {
      const span = document.createElement('span');
      span.innerHTML = char === ' ' ? '&nbsp;' : char;
      span.style.animationDelay = `${i * 0.08}s, ${i * 0.08}s`;
      span.style.setProperty('--char-index', i);
      link.appendChild(span);
    });
    return;
  }
  const text = targetElement.dataset.rawText || targetElement.textContent;
  targetElement.textContent = '';
  [...text].forEach((char, i) => {
    const span = document.createElement('span');
    span.innerHTML = char === ' ' ? '&nbsp;' : char;
    span.style.animationDelay = `${i * 0.08}s, ${i * 0.08}s`;
    span.style.setProperty('--char-index', i);
    targetElement.appendChild(span);
  });
}

// dark mode handler
// =======
// initialize dark mode handler
function initDarkModeHandler() {
  const pvmGlowReflection = document.querySelector('.pvm-glow-reflection');

  // immediately apply dark/light mode class to body based on system preference
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (prefersDark) {
    body.classList.add('dark-mode');
  } else {
    body.classList.remove('dark-mode');
  }
  requestGreyOverlayRefresh();

  function setSvgMode(isDarkMode, attempt = 1) {
    const svgDoc = pvmSvgContainer.querySelector('svg');
    if (!svgDoc) {
      if (attempt <= 5) {
        setTimeout(() => setSvgMode(isDarkMode, attempt + 1), 50);
      }
      return;
    }
    const lightElement = svgDoc.getElementById('light');
    const darkElement = svgDoc.getElementById('dark');
    if (!lightElement || !darkElement) {
      if (attempt <= 5) {
        setTimeout(() => setSvgMode(isDarkMode, attempt + 1), 50);
      }
      return;
    }
    lightElement.style.display = isDarkMode ? 'none' : 'inline';
    darkElement.style.display = isDarkMode ? 'inline' : 'none';
    if (pvmGlowReflection) {
      pvmGlowReflection.style.opacity = isDarkMode ? '1' : '0';
    }
    requestGreyOverlayRefresh();
    try { updateAllKnobIndicators(); } catch (e) {}
    try { updateIndicatorThemeVisibility(); } catch (e) {}
  }
  window.setSvgMode = setSvgMode;

  // listen for changes in color scheme preference
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
    if (e.matches) {
      body.classList.add('dark-mode');
    } else {
      body.classList.remove('dark-mode');
    }
    requestGreyOverlayRefresh();
    window.setSvgMode(e.matches);
    updateSunlightVisibility();
    try { updateAllKnobIndicators(); } catch (e) {}
    try { updateIndicatorThemeVisibility(); } catch (e) {}
  });
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', updateSunlightVisibility);
  updateSunlightVisibility();
}

// sunlight effect
// ======
// function to update sunlight visibility
let _sunlightPrevIsLightMode = null;
let _sunlightPrevSunlightOn = null;
function updateSunlightVisibility() {
  const isLightMode = window.matchMedia('(prefers-color-scheme: light)').matches;
  const sunlightEnabled = typeof window.sunlightOn === 'undefined' ? true : window.sunlightOn;
  const mediaGlowCanvas = document.querySelector('.media-glow-canvas');
  if (mediaGlowCanvas) {
    if (isLightMode && sunlightEnabled) {
      mediaGlowCanvas.style.display = 'block';

      // detect two cases that should fade in:
      // 1) we just toggled sunlight from off -> on
      // 2) we just switched from dark -> light mode
      const turningOn = _sunlightPrevSunlightOn === false && sunlightEnabled === true;
      const lightModeJustSwitched = _sunlightPrevIsLightMode === false && isLightMode === true;

      if (turningOn || lightModeJustSwitched) {
        // start from 0 then raise to target so css transition can animate
        mediaGlowCanvas.style.opacity = '0';
        requestAnimationFrame(() => {
          mediaGlowCanvas.style.opacity = '0.7';
        });
      } else {
        // initial load or repeated enable while already in light mode
        mediaGlowCanvas.style.opacity = '0.7';
      }
    } else {
      // fade out, then hide
      mediaGlowCanvas.style.opacity = '0';
      mediaGlowCanvas.addEventListener('transitionend', function handler(e) {
        if (e.propertyName === 'opacity' && mediaGlowCanvas.style.opacity === '0') {
          mediaGlowCanvas.style.display = 'none';
          mediaGlowCanvas.removeEventListener('transitionend', handler);
        }
      });
    }

    // track previous states for future transitions
    _sunlightPrevIsLightMode = isLightMode;
    _sunlightPrevSunlightOn = sunlightEnabled;
  }
}

// toggle sunlight effect (session only, not remembered)
function toggleSunlight() {
  window.sunlightOn = typeof window.sunlightOn === 'undefined' ? false : !window.sunlightOn;
  // update knob/tooltip
  const sunlightKnob = document.getElementById('sunlight-knob');
  if (sunlightKnob) {
    sunlightKnob.setAttribute('data-state', window.sunlightOn ? 'on' : 'off');
  }
  // Show legacy-style status message
  const isDark = document.body.classList.contains('dark-mode');
  if (isDark) {
    showEffectStatusMessage('', null, 'the sun has set');
  } else {
    showEffectStatusMessage('sunlight', window.sunlightOn);
  }
  updateSunlightVisibility();
}

// initialize media glow effect (sunlight)
function initMediaGlowEffect(screenApp) {
  // remove any existing canvas
  const existingCanvas = document.querySelector('.media-glow-canvas');
  if (existingCanvas) {
    existingCanvas.remove();
  }
  
  if (!screenApp) {
    console.error('screen pixi.js app not available for media glow effect.');
    return;
  }

  // get the svg screen element to base positioning on
  const svgDoc = pvmSvgContainer.querySelector('svg');
  if (!svgDoc) {
    console.error('svg document not found for sunlight effect positioning.');
    return;
  }
  const svgScreenElement = svgDoc.getElementById('screen');
  if (!svgScreenElement) {
    console.error('svg screen element not found for sunlight effect positioning.');
    return;
  }

  const screenPathRect = svgScreenElement.getBoundingClientRect();
  if (screenPathRect.width === 0 || screenPathRect.height === 0) {
    console.error('[vge] svg screen path has zero dimensions, aborting sunlight effect setup.');
    return;
  }

  const pvmContainerElement = pvmSvgContainer.parentElement;
  if (!pvmContainerElement) {
    console.error('[vge] pvm container element not found, aborting sunlight effect setup.');
    return;
  }
  const containerRect = pvmContainerElement.getBoundingClientRect();

  // initialize with default numeric values to prevent "uninitialized variable" errors
  let glowCanvasLeft = 0;
  let glowCanvasTop = 0;
  let glowCanvasWidth = 1; // default to 1x1 to avoid zero-size canvas issues
  let glowCanvasHeight = 1;
  let calculatedDimensionsSuccessfully = false;

  try {
    if (typeof screenPathRect.left !== 'number' || typeof screenPathRect.top !== 'number' || 
        typeof screenPathRect.width !== 'number' || typeof screenPathRect.height !== 'number' ||
        typeof containerRect.left !== 'number' || typeof containerRect.top !== 'number' ||
        isNaN(screenPathRect.left) || isNaN(screenPathRect.top) || 
        isNaN(screenPathRect.width) || isNaN(screenPathRect.height) ||
        isNaN(containerRect.left) || isNaN(containerRect.top) ) {
      console.error('[vge] invalid or nan properties in getBoundingClientRect results.', 
                    'screenPathRect details:', screenPathRect, 
                    'containerRect details:', containerRect);
      // do not return, let it use defaults, but flag that calculation failed
      calculatedDimensionsSuccessfully = false;
    } else {
      glowCanvasLeft = screenPathRect.left - containerRect.left;
      glowCanvasTop = screenPathRect.top - containerRect.top;
      glowCanvasWidth = screenPathRect.width;
      glowCanvasHeight = screenPathRect.height;
      calculatedDimensionsSuccessfully = true;
    }
  } catch (e) {
    console.error('[vge] exception during glow canvas dimension calculation:', e, 
                  'screenPathRect details:', screenPathRect, 
                  'containerRect details:', containerRect);
    calculatedDimensionsSuccessfully = false; // ensure flag reflects failure
    // do not return, let it use defaults and log this fact
  }

  if (!calculatedDimensionsSuccessfully) {
  }

  // create a canvas for the sunlight effect
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = glowCanvasWidth; 
  glowCanvas.height = glowCanvasHeight; 
  glowCanvas.className = 'media-glow-canvas';
  
  // apply sunlight beams effect
  const ctx = glowCanvas.getContext('2d');
  
  // clear canvas
  ctx.clearRect(0, 0, glowCanvas.width, glowCanvas.height);
  
  // determine the light effect type:
  // 1. no window effect, just overall glare (20% chance)
  // 2. blinds effect (60% chance - 0.2 to 0.8)
  // 3. beam effect (20% chance - 0.8 to 1.0)
  const lightEffectRandom = Math.random();
  const showOnlyGlare = lightEffectRandom < 0.20; // 20% chance for glare only
  const useWindowBlinds = lightEffectRandom >= 0.20 && lightEffectRandom < 0.60; // 40% for blinds
  // else, it's directional/skewed glow (remaining 40%)
  
  // original left/right zone logic (will be used by blinds initially)
  const onLeftSide = Math.random() > 0.5;
  const defaultHorizontalZone = {
    x: onLeftSide ? 0 : glowCanvas.width * 0.5,
    y: 0,
    width: glowCanvas.width * 0.5,
    height: glowCanvas.height
  };
  
  // determine light intensity
  const lightIntensity = 0.8;
  const baseR = 255;
  const baseG = 252;
  const baseB = 248;
  
  // generate random blur amount (between 5px and 12px)
  let blurAmount;
  const baseBlur = Math.floor(Math.random() * 8) + 5; // original range: 5-12px
  blurAmount = baseBlur; // default to baseBlur

  if (useWindowBlinds) {
    blurAmount = Math.floor(Math.random() * 5) + 3; // new range for blinds: 3-7px
  } else if (!showOnlyGlare) { // only override if not glare only and not blinds
    blurAmount = Math.floor(Math.random() * 5) + 6; // new range for other effects: 6-10px
  }
  
  // only create window or beam effect if not showing only glare
  if (!showOnlyGlare) {
    if (useWindowBlinds) {
      // blinds effect refactor
      const blindVariationRandom = Math.random();
      let isShadesUp = false;
      let useCheaperBlinds = false;
      let applySkewToBlinds = false;
      let skewYFactorBlinds = 0;

      if (blindVariationRandom < 0.15) { // 15% chance for shades up
        isShadesUp = true;
      } else if (blindVariationRandom < 0.55) { // 40% chance for non-skewed blinds
        if (Math.random() < 0.5) { useCheaperBlinds = true; }
        // applySkewToBlinds remains false
      } else { // 45% chance for skewed blinds
        applySkewToBlinds = true;
        if (Math.random() < 0.5) { useCheaperBlinds = true; }
        skewYFactorBlinds = (Math.random() - 0.5) * 0.4; // skew factor for blinds (-0.2 to +0.2)
      }

      if (!isShadesUp) {
        const blindsZone = defaultHorizontalZone; // still use this for general positioning
        const blindsWidth = Math.min(blindsZone.width - 10, glowCanvas.width / 2);
        const randomHeightFactor = Math.random() * 0.4 + 0.5;
        let blindsHeight = glowCanvas.height * randomHeightFactor;
        blindsHeight = Math.max(blindsHeight, glowCanvas.height * 0.3);
        blindsHeight = Math.min(blindsHeight, blindsZone.height - 10);

        const x = blindsZone.x + Math.random() * (blindsZone.width - blindsWidth);
        const y = blindsZone.y + Math.random() * (blindsZone.height - blindsHeight);
        const angle = (Math.random() * 4 - 2) * Math.PI / 180;

        ctx.save(); // outer save for all blind transformations

        if (applySkewToBlinds) {
          // skew around the center of the determined blinds area (x,y, blindsWidth, blindsHeight)
          // this requires calculating the center *before* the rotation-specific translate.
          const currentBlindsCenterX = x + blindsWidth / 2;
          const currentBlindsCenterY = y + blindsHeight / 2;
          ctx.translate(currentBlindsCenterX, currentBlindsCenterY);
          ctx.transform(1, skewYFactorBlinds, 0, 1, 0, 0); // apply vertical skew
          ctx.translate(-currentBlindsCenterX, -currentBlindsCenterY);
        }

        // original rotation logic, happens after potential skew
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.translate(-x, -y);

        let uniformSlatHeight, uniformGapHeight;
        if (useCheaperBlinds) {
          uniformSlatHeight = Math.max(glowCanvas.height / 70, 3);
          uniformGapHeight = Math.max(glowCanvas.height / 65, 4);
        } else { // standard blinds
          uniformSlatHeight = Math.max(glowCanvas.height / 40, 6);
          uniformGapHeight = Math.max(glowCanvas.height / 35, 7);
        }

        const avgSlatCycleHeight = uniformSlatHeight + uniformGapHeight;
        let barCount = Math.round(blindsHeight / avgSlatCycleHeight);
        barCount = Math.max(useCheaperBlinds ? 8 : 5, Math.min(barCount, useCheaperBlinds ? 25 : 15));
        let currentYPos = y; // drawing y position relative to the pre-rotated/skewed canvas

        for (let j = 0; j < barCount; j++) {
          if (currentYPos + uniformSlatHeight > y + blindsHeight) break;
          const angleRandomFactor = 0.7 + Math.random() * 0.3;
          const currentSlatMidAlpha = lightIntensity * angleRandomFactor;
          const currentSlatEdgeAlpha = currentSlatMidAlpha * 0.5;
          const slatGradient = ctx.createLinearGradient(x, currentYPos, x, currentYPos + uniformSlatHeight);
          slatGradient.addColorStop(0, `rgba(${baseR}, ${baseG}, ${baseB}, ${currentSlatEdgeAlpha})`);
          slatGradient.addColorStop(0.2, `rgba(${baseR}, ${baseG}, ${baseB}, ${currentSlatMidAlpha})`);
          slatGradient.addColorStop(0.8, `rgba(${baseR}, ${baseG}, ${baseB}, ${currentSlatMidAlpha})`);
          slatGradient.addColorStop(1, `rgba(${baseR}, ${baseG}, ${baseB}, ${currentSlatEdgeAlpha})`);
          ctx.fillStyle = slatGradient;
          ctx.fillRect(x, currentYPos, blindsWidth, uniformSlatHeight);
          currentYPos += uniformSlatHeight + uniformGapHeight;
        }
        ctx.restore(); // matches outer save
      }
      // if isShadesUp, we draw nothing for the blinds effect.
    } else { // directional/skewed glow effect (no longer from bottom)
      const edges = ['left', 'right']; // modified: no 'bottom'
      const originEdge = edges[Math.floor(Math.random() * edges.length)];

      let beamX, beamY, beamWidth, beamHeight;
      let beamGradient;
      const fringeAlpha = lightIntensity * 0.07; // declare fringeAlpha once here

      switch (originEdge) {
        case 'left':
          beamWidth = glowCanvas.width;
          beamHeight = glowCanvas.height;
          beamX = 0;
          beamY = 0;
          beamGradient = ctx.createLinearGradient(0, beamHeight / 2, beamWidth * 0.75, beamHeight / 2);
          beamGradient.addColorStop(0, `rgba(${baseR}, ${baseG}, ${baseB}, ${lightIntensity * (Math.random() * 0.2 + 0.3)})`);
          beamGradient.addColorStop(1, `rgba(${baseR}, ${baseG}, ${baseB}, 0)`);
          ctx.save();
          const skewYFactorLeft = (Math.random() - 0.5) * 1.0;
          ctx.transform(1, skewYFactorLeft, 0, 1, 0, 0);
          ctx.fillStyle = beamGradient;
          ctx.fillRect(beamX, beamY, beamWidth, beamHeight);

          // chromatic fringing - left beam
          ctx.globalCompositeOperation = 'lighter';
          // red fringe (offset right)
          ctx.fillStyle = `rgba(254, 199, 199, ${fringeAlpha})`; // slightly modified rgb for testing
          ctx.fillRect(beamX + 1, beamY, beamWidth, beamHeight); 
          // blue fringe (offset left)
          ctx.fillStyle = `rgba(199, 199, 254, ${fringeAlpha})`; // slightly modified rgb for testing
          ctx.fillRect(beamX - 1, beamY, beamWidth, beamHeight); 
          ctx.globalCompositeOperation = 'source-over'; // reset composite op

          ctx.restore();
          break;
        case 'right':
          beamWidth = glowCanvas.width;
          beamHeight = glowCanvas.height;
          beamX = 0;
          beamY = 0;
          beamGradient = ctx.createLinearGradient(beamWidth, beamHeight / 2, beamWidth * 0.25, beamHeight / 2);
          beamGradient.addColorStop(0, `rgba(${baseR}, ${baseG}, ${baseB}, ${lightIntensity * (Math.random() * 0.2 + 0.3)})`);
          beamGradient.addColorStop(1, `rgba(${baseR}, ${baseG}, ${baseB}, 0)`);
          ctx.save();
          const skewYFactorRight = (Math.random() - 0.5) * 1.0;
          ctx.transform(1, skewYFactorRight, 0, 1, 0, 0);
          ctx.fillStyle = beamGradient;
          ctx.fillRect(beamX, beamY, beamWidth, beamHeight);

          // chromatic fringing - right beam
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = `rgba(254, 199, 199, ${fringeAlpha})`; // slightly modified rgb for testing
          ctx.fillRect(beamX + 1, beamY, beamWidth, beamHeight);
          ctx.fillStyle = `rgba(199, 199, 254, ${fringeAlpha})`; // slightly modified rgb for testing
          ctx.fillRect(beamX - 1, beamY, beamWidth, beamHeight);
          ctx.globalCompositeOperation = 'source-over'; // reset composite op

          ctx.restore();
          break;
      }
    }
  }
  
  // add overall screen glare effect - this happens regardless of window effect
  const glareCenterRandomX = Math.random() * 0.4 + 0.3; // 0.3 to 0.7 of canvas width
  const glareCenterRandomY = Math.random() * 0.4 + 0.3; // 0.3 to 0.7 of canvas height
  const glareGradient = ctx.createRadialGradient(
    glowCanvas.width * glareCenterRandomX, glowCanvas.height * glareCenterRandomY, glowCanvas.width * 0.05, // inner circle smaller
    glowCanvas.width * glareCenterRandomX, glowCanvas.height * glareCenterRandomY, glowCanvas.width * 0.8 // outer circle larger
  );
  
  // adjust glare intensity based on whether it's the only effect
  const glareIntensity = showOnlyGlare ? 0.4 : 0.5;
  
  glareGradient.addColorStop(0, `rgba(${baseR}, ${baseG}, ${baseB}, ${glareIntensity})`);
  glareGradient.addColorStop(0.2, `rgba(${baseR}, ${baseG}, ${baseB}, ${glareIntensity * 0.8})`);
  glareGradient.addColorStop(0.6, `rgba(${baseR}, ${baseG}, ${baseB}, ${glareIntensity * 0.3})`);
  glareGradient.addColorStop(1, `rgba(${baseR}, ${baseG}, ${baseB}, 0)`);
  
  // apply the glare on top of everything
  ctx.globalCompositeOperation = 'lighter'; // make the glare add light
  ctx.fillStyle = glareGradient;
  ctx.fillRect(0, 0, glowCanvas.width, glowCanvas.height);
  
  // position and style the canvas
  glowCanvas.style.position = 'absolute';
  glowCanvas.style.left = `${glowCanvasLeft}px`;
  glowCanvas.style.top = `${glowCanvasTop}px`;
  glowCanvas.style.width = `${glowCanvasWidth}px`;
  glowCanvas.style.height = `${glowCanvasHeight}px`;
  glowCanvas.style.transform = 'none'; // ensure no css transforms interfere
  glowCanvas.style.filter = `blur(${blurAmount}px)`;
  glowCanvas.style.pointerEvents = 'none'; // ensure it doesn't interfere with interactions

  // add the canvas to the pvm container
  if (pvmContainerElement) {
    pvmContainerElement.appendChild(glowCanvas);
  }
  
  // initial visibility update
  updateSunlightVisibility();
}

function setToggleLightsToDefault() {
  toggleLightState = {};
  for (const id of TOGGLE_LIGHT_IDS) {
    toggleLightState[id] = DEFAULT_ON_LIGHTS.includes(id);
  }
}

// update the opacity of all toggleable lights based on state and power
function updateToggleLights(pvmSvg, isPowerOn) {
  if (!pvmSvg) return;
  for (const id of TOGGLE_LIGHT_IDS) {
    const el = pvmSvg.getElementById(id);
    if (el) {
      el.style.transition = 'opacity 0.1s ease-out';
      el.style.opacity = (isPowerOn && toggleLightState[id]) ? '1' : '0';
    }
  }
}

// add event listeners to all toggleable light buttons
function setupToggleLightButtons(pvmSvg) {
  // original logic for toggle light ids (blue-only, 16-9, glitch, etc.)
  if (!pvmSvg) return;
  const labelMap = {
    '16-9-light': '16:9',
    'hv-delay-light': 'h/v delay',
    'underscan-light': 'underscan',
    'blue-only-light': 'blue only',
    'degauss-light': 'degauss',
    'ext-sync-light': 'ext sync',
    'line-rgb-light': 'line rgb',
    'c-sdi-light': 'c (sdi)',
    'b-component-light': 'b (component)',
    'a-rgb-light': 'a (rgb)'
  };
  function showButtonStatus(id, state) {
    const label = labelMap[id] || id.replace(/-light$/, '');
    showEffectStatusMessage(label, !!state);
  }
  for (const id of TOGGLE_LIGHT_IDS) {
    const btnId = id.replace(/-light$/, '');
    const btn = pvmSvg.getElementById(btnId);
    if (btn) {
      // only attach if not already set by effectButtonMap
      if (!btn._hasToggleLightHandler) {
        btn.style.cursor = 'pointer';
        btn.style.pointerEvents = 'all';
        btn.onmouseenter = null;
        btn.onmousemove = null;
        btn.onmouseleave = null;
        btn.onclick = () => {
          // capture active exclusive source before any changes
          const prevExclusive = getActiveExclusiveSourceId();
          // If OSD menu is open: disable all buttons except degauss/blue-only special edit behavior
          try {
            const menuOpen = (isPvmMenuVisible && isPvmMenuVisible());
            if (menuOpen && id !== 'degauss-light' && id !== 'blue-only-light') {
              return;
            }
          } catch (e) {}
          // allow mechanical toggle when power is off: toggle internal state and
          // apply the underlying effect state (so it will be active when power
          // is restored), but do not update visual light opacity while off.
          if (body.classList.contains('power-off')) {
            // Do not allow degauss while power is off
            if (id === 'degauss-light') {
              return;
            }
            if (EXCLUSIVE_SOURCE_LIGHTS.includes(id)) {
              // Clicking A/B/C while power off: set exclusive and update memory for current mode
              setExclusiveSource(id);
              const active = getActiveExclusiveSourceId();
              if (toggleLightState['line-rgb-light']) {
                lastSourceLine = active;
              } else {
                lastSourceNormal = active;
              }
              showButtonStatus(id, getActiveExclusiveSourceId() === id);
            } else if (id === 'line-rgb-light') {
              const turningOn = !toggleLightState[id];
              if (turningOn) {
                // remember current normal source, flip LINE on, apply last LINE source
                lastSourceNormal = getActiveExclusiveSourceId();
                toggleLightState[id] = true;
                // Apply last LINE source (allow any A/B/C including C/SDI)
                let candidate = lastSourceLine || initialSourceAtLoad || lastSourceNormal || 'a-rgb-light';
                setExclusiveSourceExact(candidate);
                lastSourceLine = candidate;
              } else {
                // flip LINE off and restore last normal source
                toggleLightState[id] = false;
                setExclusiveSourceExact(lastSourceNormal || initialSourceAtLoad);
              }
              showButtonStatus(id, toggleLightState[id]);
            } else {
              toggleLightState[id] = !toggleLightState[id];
              showButtonStatus(id, toggleLightState[id]);
            }
            // apply effect state so it will be active when power is restored
            // Do not trigger transient glitch when power is off or for A/B/C
            const isABC = (btnId === 'a-rgb' || btnId === 'b-component' || btnId === 'c-sdi');
            if (!isABC && BUTTON_EFFECTS && BUTTON_EFFECTS[btnId]) BUTTON_EFFECTS[btnId]();
            return;
          }
          // Power on: apply exclusive logic and refresh all three lights together
          if (EXCLUSIVE_SOURCE_LIGHTS.includes(id)) {
            setExclusiveSource(id);
            const active = getActiveExclusiveSourceId();
            if (toggleLightState['line-rgb-light']) {
              lastSourceLine = active;
            } else {
              lastSourceNormal = active;
            }
            refreshExclusiveSourceLights(pvmSvg, true);
            applySourceBlanking(); // updates visible source + audio
            try { updateKnobDisabledStyles(pvmSvg); } catch (e) {}
            try { if (isPvmMenuVisible && isPvmMenuVisible() && _pvmMenuMode === 'geometry') renderPvmMenu(); } catch (e) {}
            showButtonStatus(id, getActiveExclusiveSourceId() === id);
          } else if (id === 'line-rgb-light') {
            const turningOn = !toggleLightState[id];
            if (turningOn) {
              lastSourceNormal = getActiveExclusiveSourceId();
              toggleLightState[id] = true;
              // Apply last LINE source (allow any A/B/C including C/SDI)
              let candidate = lastSourceLine || initialSourceAtLoad || lastSourceNormal || 'a-rgb-light';
              setExclusiveSourceExact(candidate);
              lastSourceLine = candidate;
            } else {
              toggleLightState[id] = false;
              // Restore last normal source or fallback to initial at load
              setExclusiveSourceExact(lastSourceNormal || initialSourceAtLoad);
            }
            // update full set of toggle lights visually
            updateToggleLights(pvmSvg, true);
            refreshExclusiveSourceLights(pvmSvg, true);
            applySourceBlanking(); // updates visible source + audio
            try { updateKnobDisabledStyles(pvmSvg); } catch (e) {}
            try { if (isPvmMenuVisible && isPvmMenuVisible() && _pvmMenuMode === 'geometry') renderPvmMenu(); } catch (e) {}
            showButtonStatus(id, toggleLightState[id]);
          } else if (id === 'degauss-light') {
            // If OSD is open, suppress normal degauss; allow special write only while editing
            if (isPvmMenuVisible && isPvmMenuVisible()) {
              try {
                if ((_pvmMenuMode === 'geometry' && _geomEdit && _geomEdit.active) || (_pvmMenuMode === 'color-temp' && _ctEdit && _ctEdit.active)) {
                  const k = _activeInputKey();
                  const f = (_pvmMenuMode === 'color-temp') ? 'ctK' : _geomFieldByIndex(_pvmMenuIndex);
                  if (k && f) {
                    if (!_sessionWriteArmed) { _sessionWriteArmed = true; renderPvmMenu(); }
                    else {
                      const g = _getGeom();
                      if (!_sessionGeomDefaults[k]) _sessionGeomDefaults[k] = {};
                      _sessionGeomDefaults[k][f] = (f === 'ctK') ? _getCtK() : g[f];
                      _sessionWriteArmed = false; _sessionStarFlash = true;
                      if (_sessionUiClearTimer) clearTimeout(_sessionUiClearTimer);
                      renderPvmMenu();
                      _sessionUiClearTimer = setTimeout(()=>{ _sessionStarFlash = false; renderPvmMenu(); _sessionUiClearTimer=null; }, 1000);
                    }
                  }
                }
              } catch (e) {}
              return; // fully suppress normal degauss when OSD is open
            }
            // While editing a geometry value: use degauss as session default writer (two-press "arm" then "commit")
            try {
              if (isPvmMenuVisible && isPvmMenuVisible() && _pvmMenuMode === 'geometry' && _geomEdit && _geomEdit.active) {
                const k = _activeInputKey();
                const f = _geomFieldByIndex(_pvmMenuIndex);
                if (k && f) {
                  if (!_sessionWriteArmed) {
                    _sessionWriteArmed = true; // first press: show 'write'
                    renderPvmMenu();
                  } else {
                    const g = _getGeom();
                    if (!_sessionGeomDefaults[k]) _sessionGeomDefaults[k] = {};
                    _sessionGeomDefaults[k][f] = g[f];
                    // On commit: show star + keep 'write' for 1s, then clear both
                    _sessionWriteArmed = true;
                    _sessionStarFlash = true;
                    if (_sessionUiClearTimer) { clearTimeout(_sessionUiClearTimer); }
                    renderPvmMenu();
                    _sessionUiClearTimer = setTimeout(() => {
                      _sessionWriteArmed = false;
                      _sessionStarFlash = false;
                      _sessionUiClearTimer = null;
                      try { renderPvmMenu(); } catch (e) {}
                    }, 1000);
                  }
                }
                // Do not perform normal degauss behavior while OSD is active
                return;
              }
            } catch (e) {}
            // Degauss should stay ON for 10s, then turn OFF and click the relay
            const now = Date.now();
            const elapsed = now - (_lastDegaussMs || 0);
            if (_degaussLightTimerId) {
              // Turn off early when pressed again during active window
              clearTimeout(_degaussLightTimerId);
              _degaussLightTimerId = null;
              _degaussAbort = true; // stop visual wobble immediately
              toggleLightState[id] = false;
              const e2 = pvmSvg.getElementById(id);
              if (e2) { e2.style.transition = 'opacity 0.1s ease-out'; e2.style.opacity = '0'; }
              showButtonStatus(id, false);
              return;
            }
            if (_lastDegaussMs && elapsed < DEGAUSS_HALF_MS) {
              // In cooldown <5m: allow light to turn ON for 10s, but no sound/visual
              toggleLightState[id] = true;
              showEffectStatusMessage('degauss', true, '<div class="effect-sub">cooling down</div>');
              const elcd = pvmSvg.getElementById(id);
              if (elcd) { elcd.style.transition = 'opacity 0.1s ease-out'; elcd.style.opacity = '1'; }
              _degaussLightTimerId = setTimeout(() => {
                toggleLightState[id] = false;
                const e2 = pvmSvg.getElementById(id);
                if (e2) { e2.style.transition = 'opacity 0.1s ease-out'; e2.style.opacity = '0'; }
                showButtonStatus(id, false);
                playOneShot('relay-audio', 0.7, 'relay');
                _degaussLightTimerId = null;
              }, 10000);
              return;
            }
            toggleLightState[id] = true;
            showButtonStatus(id, true);
            const el = pvmSvg.getElementById(id);
            if (el) { el.style.transition = 'opacity 0.1s ease-out'; el.style.opacity = '1'; }
            try { triggerDegaussEffect(); } catch (e) {}
            _degaussLightTimerId = setTimeout(() => {
              toggleLightState[id] = false;
              const e2 = pvmSvg.getElementById(id);
              if (e2) { e2.style.transition = 'opacity 0.1s ease-out'; e2.style.opacity = '0'; }
              showButtonStatus(id, false);
              playOneShot('relay-audio', 0.7, 'relay');
              _degaussLightTimerId = null;
            }, 10000);
          } else {
            // While editing geometry: Blue Only acts as reset-to-default for the current field
            if (id === 'blue-only-light') {
              try {
                const menuOpen = isPvmMenuVisible && isPvmMenuVisible();
                if (menuOpen && _pvmMenuMode === 'geometry' && _geomEdit && _geomEdit.active) {
                  const f = _geomFieldByIndex(_pvmMenuIndex);
                  _applyGeomDefault(f);
                  renderPvmMenu();
                  return;
                } else if (menuOpen && _pvmMenuMode === 'color-temp' && _ctEdit && _ctEdit.active) {
                  _applyGeomDefault('ctK');
                  renderPvmMenu();
                  return;
                } else if (menuOpen) {
                  // OSD open but not editing: suppress normal blue-only entirely
                  return;
                }
              } catch (e) {}
            }
            toggleLightState[id] = !toggleLightState[id];
            const el = pvmSvg.getElementById(id);
            if (el) {
              el.style.transition = 'opacity 0.1s ease-out';
              el.style.opacity = toggleLightState[id] ? '1' : '0';
            }
            showButtonStatus(id, toggleLightState[id]);
          }
          // Update continuous EXT SYNC pulse state (repeat quick roll)
          _updateExtSyncPulse();
          // trigger effect — suppress glitch when pressing currently active A/B/C
          let shouldTrigger = true;
          if (btnId === 'a-rgb' || btnId === 'b-component' || btnId === 'c-sdi') {
            const postExclusive = getActiveExclusiveSourceId();
            shouldTrigger = prevExclusive !== postExclusive;
          }
          if (shouldTrigger && BUTTON_EFFECTS && BUTTON_EFFECTS[btnId]) BUTTON_EFFECTS[btnId]();
          // do not show status popup for lighted buttons
        };
        btn._hasToggleLightHandler = true;
      }
    }
  }
  // Remove old effect button click behavior; knobs handle continuous control instead.
  setupKnobControls(pvmSvg);
}

function setSvgLightsPowerState(pvmSvg, isOn) {
  if (!pvmSvg) return;
  for (const id of ALL_LIGHT_IDS) {
    if (id === 'tally-light') {
      // tally light is handled by hover logic; always hide by default
      const el = pvmSvg.getElementById(id);
      if (el) el.style.opacity = '0';
      continue;
    }
    if (TOGGLE_LIGHT_IDS.includes(id)) {
      // handled by updateToggleLights
      continue;
    }
    const el = pvmSvg.getElementById(id);
    if (el) {
      el.style.opacity = (isOn && ON_LIGHT_IDS.includes(id)) ? '1' : '0';
    }
  }
  updateToggleLights(pvmSvg, isOn);
  // When powering on, also apply source blanking rule (none of A/B/C => blank image)
  if (isOn) {
    applySourceBlanking();
  }
}

function setCrtEffectsOpacity(alpha) {
  // drive scanlines + canvas opacity; phosphor tracks grid alpha via ticker
  _crtEffectsAlpha = alpha;
  const scanlinesElement = document.querySelector('.scanlines');
  if (scanlinesElement) scanlinesElement.style.opacity = alpha;
  const pixiCanvas = document.querySelector('.pvm-pixi-canvas');
  if (pixiCanvas) pixiCanvas.style.opacity = alpha;
  // keep color-temp overlay in lockstep with CRT/global fade
  try { _applyCtFinalOpacity(); } catch (e) {}
}

// update overlay position/size on window resize (debounced)
function _doResizeWork() {
  createGreyOverlay();
  // Reposition color temperature overlay to match screen on resize
  try {
    const ov = (pvmSvgContainer && pvmSvgContainer.parentElement) ? pvmSvgContainer.parentElement.querySelector('.ct-overlay') : null;
    if (ov) { _positionElementToScreen(ov); positionCtOverlay(ov); }
  } catch (e) {}
  updatePvmGridTransform();
  updateGlowReflectionWidth();
  positionOsdMenuOverlay();
  // no YouTube iframe to align
  // no triad scaling needed
}

function _debounce(fn, delay = 120) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), delay);
  };
}

window.addEventListener('resize', _debounce(_doResizeWork, 120));

// repositionScreenLayers removed to restore pre-zoom behavior

// Hook reposition into resize workflow and initial SVG load
// (Legacy behavior) No extra realignment hook; base resize work remains above

// Helper to set overlay opacity
// Remove setGreyOverlayOpacity function entirely

// small helpers for polish
function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
function createBlueOnlyFilter() {
  if (!window.PIXI || !PIXI.filters) return null;
  const m = new PIXI.filters.ColorMatrixFilter();
  // Blue-only (PVM-style): display the blue channel as neutral greyscale
  // Map R', G', B' each to the source Blue channel.
  // This makes blue areas appear bright (near white) and others as grey based on their blue component.
  m.matrix = [
    0, 0, 1, 0, 0,  // R' = B
    0, 0, 1, 0, 0,  // G' = B
    0, 0, 1, 0, 0,  // B' = B
    0, 0, 0, 1, 0   // A' = A
  ];
  return m;
}

// --- EFFECTS FOR FRONT PANEL BUTTONS ---
// Helper: ensure pixi-filters is loaded (add <script src="https://cdn.jsdelivr.net/npm/pixi-filters@latest/dist/pixi-filters.min.js"></script> to your HTML)

function _getActiveSprite() {
  const k = _activeInputKey && _activeInputKey();
  if (k === 'b' && _inputBLocalSprite) return _inputBLocalSprite;
  if (k === 'c' && _inputCLocalSprite) return _inputCLocalSprite;
  // default to A
  return pvmGridSprite;
}

function triggerGlitchEffect(duration = 120) {
  // Safe, brief glitch: tiny jitter + blur + random hue warp that fades out quickly.
  const k = (_activeInputKey && _activeInputKey()) || 'a';
  const endAt = performance.now() + Math.max(60, Math.min(1000, duration));
  const startAt = performance.now();
  const veryDarkWindowMs = 40; // first few ms: extra dark
  const hueDeg = Math.floor(Math.random() * 360); // random hue each time
  const satBoost = 1.2 + Math.random() * 0.8;     // 1.2 .. 2.0
  const dimBase = 0.40 + Math.random() * 0.25;    // 0.40 .. 0.65
  const huePhaseMs = 80; // hue/brightness/sat fade out sooner than motion

  // Use active PIXI sprite (A/B/C are all sprites now)
  const sprite = (_getActiveSprite && _getActiveSprite());
  if (sprite && window.PIXI && PIXI.filters) {
    const prev = Array.isArray(sprite.filters) ? sprite.filters.slice() : [];
    const blur = new PIXI.filters.BlurFilter();
    blur.blur = 1.2;
    const cm = new PIXI.filters.ColorMatrixFilter();
    // initialize with strongest shift; will fade each frame
    try { if (typeof cm.reset === 'function') cm.reset(); } catch (e) {}
    try { if (typeof cm.brightness === 'function') cm.brightness(dimBase, true); } catch (e) {}
    try { if (typeof cm.saturate === 'function') cm.saturate(satBoost, true); } catch (e) {}
    try { if (typeof cm.hue === 'function') cm.hue(hueDeg, true); } catch (e) {}
    sprite.filters = [...prev, cm, blur];
    const ox = sprite.x, oy = sprite.y, osx = sprite.scale.x, osy = sprite.scale.y;
    const oalpha = (typeof sprite.alpha === 'number') ? sprite.alpha : 1;
    const f1 = 40, f2 = 63; // Hz; fast but tiny motion
    const ax = 2, ay = 1;   // pixels
    const as = 0.01;       // scale delta
    (function tick() {
      const now = performance.now();
      if (now >= endAt || !sprite.parent) {
        // restore
        try { sprite.x = ox; sprite.y = oy; sprite.scale.x = osx; sprite.scale.y = osy; sprite.alpha = oalpha; } catch (e) {}
        try { sprite.filters = prev; } catch (e) {}
        return;
      }
      const t = now / 1000;
      const elapsed = now - startAt;
      // fade color warp quickly
      const w = Math.max(0, 1 - (elapsed / huePhaseMs)); // 1 -> 0
      try {
        if (typeof cm.reset === 'function') cm.reset();
        // brightness: 0.55 -> 1
        const b = 1 - (1 - dimBase) * w;
        if (typeof cm.brightness === 'function') cm.brightness(b, true);
        // saturation: 1.4 -> 1
        const s = 1 + (satBoost - 1) * w;
        if (typeof cm.saturate === 'function') cm.saturate(s, true);
        // hue: hueDeg -> 0
        const h = hueDeg * w;
        if (typeof cm.hue === 'function') cm.hue(h, true);
      } catch (e) {}
      const sx = Math.sin(2 * Math.PI * f1 * t);
      const sy = Math.sin(2 * Math.PI * f2 * t + Math.PI / 5);
      try {
        sprite.x = ox + sx * ax;
        sprite.y = oy + sy * ay;
        sprite.scale.x = osx + sx * as;
        sprite.scale.y = osy + sy * as;
        // super dark at start
        if (now - startAt < veryDarkWindowMs) {
          sprite.alpha = Math.max(0, Math.min(1, oalpha * 0.25));
        } else {
          sprite.alpha = oalpha;
        }
      } catch (e) {}
      requestAnimationFrame(tick);
    })();
    return;
  }

  // No iframe fallback; all inputs are sprites now
}

function triggerVerticalRoll(duration = 60) {
  if (!pvmGridSprite) return;
  let start = null;
  const origY = pvmGridSprite.y;
  // add blur filter and preserve Blue Only if active
  let blur;
  if (window.PIXI && PIXI.filters) {
    blur = new PIXI.filters.BlurFilter();
    blur.blur = 2 + Math.random() * 2;
    // build filters; if blue-only is on, append its matrix last so it tints the final output
  const filters = [blur];
  if (isBlueOnly && window.PIXI && PIXI.filters) {
    const blueMatrix = createBlueOnlyFilter();
    if (blueMatrix) filters.push(blueMatrix);
  }
  _setSpriteFilters(filters);
  }
  function animateRoll(ts) {
    if (!start) start = ts;
    const elapsed = ts - start;
    const phase = Math.sin((elapsed / duration) * Math.PI * 2);
    pvmGridSprite.y = origY + phase * 30;
    if (elapsed < duration) {
      requestAnimationFrame(animateRoll);
    } else {
      pvmGridSprite.y = origY;
      // remove blur filter, restore Blue Only if needed
      if (isBlueOnly && window.PIXI && PIXI.filters) {
        const blueMatrix = createBlueOnlyFilter();
        _setSpriteFilters(blueMatrix ? [blueMatrix] : []);
      } else {
        _setSpriteFilters([]);
      }
    }
  }
  requestAnimationFrame(animateRoll);
  // No iframe to roll; inputs are sprites
}

function triggerBlueOnly(on) {
  if (!window.PIXI || !pvmGridSprite) return;
  if (on) {
    const blue = createBlueOnlyFilter();
  _setSpriteFilters(blue ? [blue] : []);
  } else {
  _setSpriteFilters([]);
  }
  // Also hide/show the color temperature overlay to avoid tint mixing
  try { _updateCtOverlayVisibility(); } catch (e) {}
}

function triggerAspectRatioToggle() {
  is169 = !is169;
  updatePvmGridTransform();
}

function triggerUnderscanToggle() {
  isUnderscan = !isUnderscan;
  updatePvmGridTransform();
}

function triggerHvDelayToggle() {
  isHvDelay = !isHvDelay;
  updatePvmGridTransform();
}

function triggerDegaussEffect() {
  // No degauss possible while TV is off
  if (body.classList.contains('power-off')) return;
  const now = Date.now();
  const elapsed = now - (_lastDegaussMs || 0);
  // < 5 minutes: no sound, no visual
  if (_lastDegaussMs && elapsed < DEGAUSS_HALF_MS) { _lastDegaussMs = now; return; }
  // 5–10 minutes: half strength; >=10 minutes: full strength
  const tierStrength = (!_lastDegaussMs || elapsed >= DEGAUSS_FULL_MS) ? 1.0 : 0.5;
  // play degauss sound at tier volume
  playOneShot('degauss-audio', 0.35 * tierStrength);
  // Underlay: fast blur + wave wobble (no video overlay)
  try { _startDegaussWobble(tierStrength); } catch (e) {}
  // Always fade the wobble out on a fixed schedule (no fade-in; longer runtime)
  try {
    setTimeout(() => { if (_degaussWobble && _degaussWobble.running) _beginDegaussWobbleFadeOut(1200); }, 3000);
  } catch (e) {}
  _lastDegaussMs = now;
}

// hook up effects in setupToggleLightButtons
// Restore effect triggers for illuminated toggle buttons
const BUTTON_EFFECTS = {
  // Small, safe glitch on input switches
  'a-rgb': () => triggerGlitchEffect(120),
  'b-component': () => triggerGlitchEffect(120),
  // Only glitch on A/B/C per request; keep LINE RGB quiet
  'line-rgb': () => {},
  'c-sdi': () => triggerGlitchEffect(120),
  'ext-sync': () => triggerVerticalRoll(),
  'blue-only': () => { isBlueOnly = !isBlueOnly; triggerBlueOnly(isBlueOnly); },
  '16-9': () => triggerAspectRatioToggle(),
  'hv-delay': () => triggerHvDelayToggle(),
  'underscan': () => triggerUnderscanToggle(),
  'degauss': () => triggerDegaussEffect(),
};

// Continuous EXT SYNC pulse: repeat the existing one-shot vertical roll forever while ext sync is OFF
window._extSyncPulse = { running: false, timer: null };
function _isExtSyncEnabled() {
  try { return !!toggleLightState['ext-sync-light']; } catch (e) { return true; }
}
function _loopExtSyncPulse() {
  const st = window._extSyncPulse;
  if (!st.running) return;
  try { triggerVerticalRoll(40); } catch (e) {}
  // Schedule next pulse with a natural-feeling cadence
  const next = 160 + Math.floor(Math.random() * 220); // 160–380ms
  st.timer = setTimeout(_loopExtSyncPulse, next);
}
function _startExtSyncPulse() {
  const st = window._extSyncPulse;
  if (st.running) return;
  st.running = true;
  _loopExtSyncPulse();
}
function _stopExtSyncPulse() {
  const st = window._extSyncPulse;
  if (!st.running) return;
  st.running = false;
  if (st.timer) { clearTimeout(st.timer); st.timer = null; }
}
function _updateExtSyncPulse() {
  if (body.classList.contains('power-off')) { _stopExtSyncPulse(); return; }
  if (_isExtSyncEnabled()) { _stopExtSyncPulse(); } else { _startExtSyncPulse(); }
}

// Helper to show effect status message under the PVM
function showEffectStatusMessage(label, state, extra = '') {
  let msg = document.getElementById('effect-status-message');
  if (!msg) {
    // insert after the pvm container
    const pvmContainer = pvmSvgContainer.parentElement;
    msg = document.createElement('div');
    msg.id = 'effect-status-message';
    msg.style.position = 'absolute';
    msg.style.left = '50%';
    msg.style.top = '100%';
    msg.style.transform = 'translateX(-50%)';
    // Footnote/status font uses the system UI font for clarity
    msg.style.fontSize = '10pt';
    msg.style.fontFamily = "-apple-system, system-ui, BlinkMacSystemFont, Helvetica, Arial, sans-serif";
    msg.style.textTransform = 'lowercase';
    msg.style.textAlign = 'center';
    msg.style.letterSpacing = '0.5px';
    msg.style.color = '#bbb';
    msg.style.opacity = '0';
    msg.style.pointerEvents = 'none';
    msg.style.transition = 'opacity 0.4s';
    pvmContainer.style.position = 'relative';
    pvmContainer.appendChild(msg);
  }
  // if label and state are empty, show only extra (custom html)
  if (!label && !state && extra) {
    msg.innerHTML = extra;
  } else {
    const statusHtml = `<span>${label}: <b>${state ? 'on' : 'off'}</b>${extra ? ' ' + extra : ''}</span>`;
    msg.innerHTML = statusHtml;
  }
  msg.style.opacity = '1';
  if (window._effectStatusTimeout) clearTimeout(window._effectStatusTimeout);
  window._effectStatusTimeout = setTimeout(() => {
    msg.style.opacity = '0';
  }, 1500);
}

// --- Black bar overlay for 16:9 mode (PIXI version) ---
function updatePvmGridTransform() {
  if (!screenContainer) return;
  const baseW = screenContainer.baseW;
  const baseH = screenContainer.baseH;
  let scaleX = 1, scaleY = 1, x = 0, y = 0;
  let barHeight = 0;
  if (is169) {
    scaleY = 0.75;
    barHeight = ((1 - scaleY) * baseH) / 2;
  }
  if (isUnderscan) {
    scaleX *= 0.88;
    scaleY *= 0.88;
    if (is169) barHeight *= 0.88;
  }
  if (isHvDelay) {
    x += 15;
    y += 15;
  }
  // apply extra user geometry first
  const gObj = _getGeom();
  const gScaleX = scaleX * (gObj && gObj.sx ? gObj.sx : 1);
  const gScaleY = scaleY * (gObj && gObj.sy ? gObj.sy : 1);
  const gx = x + ((gObj && gObj.dx) || 0);
  const gy = y + ((gObj && gObj.dy) || 0);
  // apply transforms to container (scale + translate)
  screenContainer.scale.set(gScaleX, gScaleY);
  screenContainer.x = (baseW - baseW * gScaleX) / 2 + gx;
  screenContainer.y = (baseH - baseH * gScaleY) / 2 + gy;
  // apply rotation around sprite centers (for all sprites)
  const rotRads = ((gObj && gObj.rotDeg) || 0) * Math.PI / 180;
  [pvmGridSprite, _inputBLocalSprite, _inputCLocalSprite].forEach(spr => {
    try { if (spr) spr.rotation = rotRads; } catch (e) {}
  });
  // 16:9: scale content only — no letterbox bars. ensure any old bars are hidden
  if (letterboxBars) {
    letterboxBars.visible = false;
    letterboxBars.removeChildren();
  }
}

function sizeSpriteToScreen(sprite, sourceWidth, sourceHeight, mode = 'contain') {
  if (!screenApp || !sprite || !sourceWidth || !sourceHeight) return;
  const screenW = screenApp.screen.width;
  const screenH = screenApp.screen.height;
  const scaleFn = mode === 'cover' ? Math.max : Math.min;
  const scale = scaleFn(screenW / sourceWidth, screenH / sourceHeight);
  sprite.width = sourceWidth * scale;
  sprite.height = sourceHeight * scale;
}

function createMediaSprite() {
  // use gettodaysmedia from media.js
  const filename = window.gettodaysmedia ? window.gettodaysmedia() : null;
  if (!filename) return new PIXI.Container(); // fallback: empty container
  const mediaPath = '/assets/videos/' + filename;
  const isMedia = /\.(mp4|mov|webm)$/i.test(mediaPath);
  let sprite, mediaEl = null;
  if (isMedia) {
    mediaEl = document.createElement('video');
    mediaEl.autoplay = true;
    // manual loop to avoid end-of-file hesitation
    mediaEl.loop = false;
    // Always start muted so autoplay is never blocked
    mediaEl.muted = true;
    mediaEl.setAttribute('muted', '');
    mediaEl.playsInline = true;
    mediaEl.setAttribute('playsinline', '');
    mediaEl.webkitPlaysInline = true;
    mediaEl.crossOrigin = 'anonymous';
    mediaEl.style.display = 'none';
    // preload for quicker start
    mediaEl.preload = 'auto';
    mediaEl.setAttribute('preload', 'auto');
    // Attach metadata handler BEFORE starting load to avoid race
    // Sprite and fit sizing will be set up below after fitSprite is defined
    document.body.appendChild(mediaEl);
    mediaEl.src = mediaPath;
    // Start playback once initial data is ready; retry muted if blocked
    function detectHasAudio(el) {
      try {
        if (typeof el.mozHasAudio !== 'undefined') return !!el.mozHasAudio;
      } catch (e) {}
      try {
        if (el.audioTracks && typeof el.audioTracks.length === 'number') return el.audioTracks.length > 0;
      } catch (e) {}
      try {
        if (typeof el.webkitAudioDecodedByteCount === 'number') return el.webkitAudioDecodedByteCount > 0;
      } catch (e) {}
      return false; // best-effort fallback
    }
    mediaEl.addEventListener('loadedmetadata', () => {
      try { mediaEl._hasAudioTrack = detectHasAudio(mediaEl); } catch (e) { mediaEl._hasAudioTrack = false; }
    });
    mediaEl.addEventListener('loadeddata', () => {
      const p = mediaEl.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => { mediaEl.muted = true; mediaEl.play().catch(() => {}); });
      }
    }, { once: true });
    mediaEl.addEventListener('error', () => {
      // suppress channel error popup
    }, { once: true });
    // Bind texture immediately
    sprite = new PIXI.Sprite(PIXI.Texture.from(mediaEl));
    sprite.mediaEl = mediaEl;
    sprite.mediaType = 'media';
    sprite.mediaName = filename;
    // Use native looping (original behavior)
    mediaEl.loop = true;
  } else {
    mediaEl = new Image();
    // Attach onload BEFORE assigning src to avoid cached-image race
    sprite = new PIXI.Sprite(PIXI.Texture.from(mediaEl));
    sprite.mediaEl = mediaEl;
    sprite.mediaType = 'image';
    sprite.mediaName = filename;
    mediaEl.src = mediaPath;
    mediaEl.addEventListener('error', () => {
      // suppress channel error popup
    }, { once: true });
  }
  // Common 'fit' (contain) logic for both images and media
  sprite.anchor.set(0.5, 0.5);
  sprite.x = screenApp.screen.width / 2;
  sprite.y = screenApp.screen.height / 2;
  function fitSprite() {
    const mediaWidth = isMedia ? mediaEl.videoWidth : mediaEl.naturalWidth;
    const mediaHeight = isMedia ? mediaEl.videoHeight : mediaEl.naturalHeight;
    if (!mediaWidth || !mediaHeight) return;
    const mode = isMedia ? 'cover' : 'contain';
    sizeSpriteToScreen(sprite, mediaWidth, mediaHeight, mode);
  }
  if (isMedia) {
    mediaEl.addEventListener('loadedmetadata', fitSprite, { once: true });
    // Now that handler is wired, begin loading explicitly
    if (typeof mediaEl.load === 'function') mediaEl.load();
  } else {
    // If the image was already cached and loaded, natural sizes are available; call once
    if (mediaEl.complete && mediaEl.naturalWidth && mediaEl.naturalHeight) {
      fitSprite();
    } else {
      mediaEl.addEventListener('load', fitSprite, { once: true });
    }
  }
  return sprite;
}

// swap current media sprite to reflect current channel/date selection
function reloadMediaSprite(retryCount = 0) {
  if (!screenContainer) return;
  // static overlay is triggered by changeChannel(); do not trigger here to avoid double overlay

  const old = pvmGridSprite;
  const candidate = createMediaSprite();

  // wait for media to be ready before swapping in, to avoid black frames
  const isVideo = candidate && candidate.mediaType === 'media' && candidate.mediaEl;
  const isImage = candidate && candidate.mediaType === 'image' && candidate.mediaEl;

  function swapToFallbackStaticLong() {
    // Build a looping sprite from static-long as a visible backup
    try {
      const fallbackVideo = document.createElement('video');
      fallbackVideo.src = '/assets/videos/static/static-long.mp4';
      fallbackVideo.autoplay = true;
      fallbackVideo.loop = true;
      fallbackVideo.muted = true;
      fallbackVideo.playsInline = true;
      fallbackVideo.style.display = 'none';
      document.body.appendChild(fallbackVideo);
      const fbSprite = new PIXI.Sprite(PIXI.Texture.from(fallbackVideo));
      fbSprite.mediaEl = fallbackVideo;
      fbSprite.mediaType = 'media';
      fbSprite.anchor.set(0.5, 0.5);
      fbSprite.x = screenApp.screen.width / 2;
      fbSprite.y = screenApp.screen.height / 2;
      fallbackVideo.addEventListener('loadedmetadata', () => {
        sizeSpriteToScreen(fbSprite, fallbackVideo.videoWidth, fallbackVideo.videoHeight, 'cover');
      }, { once: true });
      if (old) {
        try { screenContainer.removeChild(old); } catch (e) {}
      }
      pvmGridSprite = fbSprite;
      screenContainer.addChild(pvmGridSprite);
      updatePvmGridTransform();
      try { fallbackVideo.play(); } catch (e) {}
    } catch (e) {
      // as a last resort, keep the old sprite
    }
  }

  function activate() {
    if (old) {
      try { screenContainer.removeChild(old); } catch (e) {}
      if (old.mediaType === 'media' && old.mediaEl) {
        try { old.mediaEl.pause(); } catch (e) {}
        try { old.mediaEl.src = ''; old.mediaEl.removeAttribute('src'); } catch (e) {}
        try { if (old.mediaEl.parentNode) old.mediaEl.parentNode.removeChild(old.mediaEl); } catch (e) {}
      }
    }
    pvmGridSprite = candidate;
    pvmGridSprite.alpha = 1;
    screenContainer.addChild(pvmGridSprite);
    updatePvmGridTransform();
  if (pvmGridSprite && pvmGridSprite.mediaType === 'media' && pvmGridSprite.mediaEl) {
    try { pvmGridSprite.mediaEl.muted = true; pvmGridSprite.mediaEl.play(); } catch (e) {}
    // mark as seen when media data is ready (skip on channel swaps)
    try {
      const name = pvmGridSprite.mediaName;
      const el = pvmGridSprite.mediaEl;
      const mark = () => {
        try {
          if (window._suppressSeenMarkOnSwap) return;
          if (window.recordVideoSeen) window.recordVideoSeen(name);
        } catch (e) {}
      };
      if (el.readyState >= 2) { mark(); }
      else { el.addEventListener('loadeddata', mark, { once: true }); }
    } catch (e) {}
    // start/refresh decoupled audio loop for new media
    try {
      const name = pvmGridSprite.mediaName;
      const url = (window.getAudioUrlForVideo && name) ? window.getAudioUrlForVideo(name) : null;
      if (window.audioLoop && window.audioLoop.stop) window.audioLoop.stop();
      if (url && window.audioLoop && window.audioLoop.play) window.audioLoop.play(url);
    } catch (e) {}
  }
    // no channel status popup
  }

  // safety timeout in case events don't fire
  let activated = false;
  const t = setTimeout(() => { if (!activated) { activated = true; activate(); } }, 800);

  if (isVideo) {
    const el = candidate.mediaEl;
    if (el.readyState >= 2) { // HAVE_CURRENT_DATA
      clearTimeout(t); activated = true; activate();
    } else {
      el.addEventListener('loadeddata', () => { if (!activated) { clearTimeout(t); activated = true; activate(); } }, { once: true });
      el.addEventListener('error', () => {
        if (!activated) {
          clearTimeout(t);
          // Try advancing once to the next channel; on second failure, show static-long backup
          if (retryCount < 1) {
            // advance offset one step forward
            try {
              if (typeof window.bumpMediaChannel === 'function') window.bumpMediaChannel(1);
              else window.mediaChannelOffset = (window.mediaChannelOffset || 0) + 1;
            } catch (e) {}
            reloadMediaSprite(retryCount + 1);
          } else {
            activated = true;
            swapToFallbackStaticLong();
          }
        }
      }, { once: true });
    }
  } else if (isImage) {
    const img = candidate.mediaEl;
    if (img.complete && img.naturalWidth) {
      clearTimeout(t); activated = true; activate();
    } else {
      img.addEventListener('load', () => { if (!activated) { clearTimeout(t); activated = true; activate(); } }, { once: true });
      img.addEventListener('error', () => {
        if (!activated) {
          clearTimeout(t);
          if (retryCount < 1) {
            try {
              if (typeof window.bumpMediaChannel === 'function') window.bumpMediaChannel(1);
              else window.mediaChannelOffset = (window.mediaChannelOffset || 0) + 1;
            } catch (e) {}
            reloadMediaSprite(retryCount + 1);
          } else {
            activated = true;
            swapToFallbackStaticLong();
          }
        }
      }, { once: true });
    }
  } else {
    clearTimeout(t); activated = true; activate();
  }
}

// channel change API used by PVM up/down buttons
function changeChannel(delta) {
  // suppress marking this swap as "seen"; only first load of the day should be recorded
  window._suppressSeenMarkOnSwap = true;
  if (typeof window.bumpMediaChannel === 'function') {
    window.bumpMediaChannel(delta);
  } else {
    window.mediaChannelOffset = (window.mediaChannelOffset || 0) + (parseInt(delta, 10) || 0);
  }
  // kick a static overlay and replace media
  try { showStaticOverlay(true); } catch (e) {}
  reloadMediaSprite();
}

// effects button mapping
// aperature: scanlines
// bright: sunlight
// chroma: phosphor
// phase: vignette
// contrast: bloom

function fadeEffect(element, show, targetOpacity = '1', display = '') {
  if (!element) return;
  const isSvg = (typeof SVGElement !== 'undefined') && (element instanceof SVGElement);
  if (show) {
    if (!isSvg) element.style.display = display;
    element.style.opacity = '0';
    requestAnimationFrame(() => {
      element.style.opacity = targetOpacity;
    });
  } else {
    element.style.opacity = '0';
    if (!isSvg) {
      element.addEventListener('transitionend', function handler(e) {
        if (e.propertyName === 'opacity' && element.style.opacity === '0') {
          element.style.display = 'none';
          element.removeEventListener('transitionend', handler);
        }
      });
    }
  }
}

function toggleScanlines() {
  scanlinesOn = !scanlinesOn;
  const scanlinesElement = document.querySelector('.scanlines');
  fadeEffect(scanlinesElement, scanlinesOn);
}
function togglePhosphor() {
  phosphorOn = !phosphorOn;
  try {
    let overlay = document.querySelector('.phosphor');
    if (!overlay) {
      const svgDoc = pvmSvgContainer.querySelector('svg');
      if (svgDoc) createPhosphorOverlay(svgDoc);
      overlay = document.querySelector('.phosphor');
    }
    if (overlay) {
      // use fadeEffect to match original timing/transition behavior
      fadeEffect(overlay, phosphorOn, '0.35');
    }
  } catch (e) { /* ignore */ }
  // do not persist phosphor state
}

function _ensureBloomFilter() {
  if (!screenApp || !screenApp.stage) return false;
  if (!bloomFilter) {
    try {
      bloomFilter = new PIXI.filters.BloomFilter(0, 4, 0, 7); // start at 0 for fade-in, lower quality/blur
    } catch (e) {
      console.error('unable to create bloom filter', e);
      return false;
    }
  }
  // ensure stage has only our bloom filter; this app uses stage.filters exclusively for bloom
  screenApp.stage.filters = [bloomFilter];
  return true;
}

function _animateBloomBlur(targetBlur = 2, durationMs = 150) {
  if (!bloomFilter) return;
  if (_bloomFadeFrameId !== null) {
    cancelAnimationFrame(_bloomFadeFrameId);
    _bloomFadeFrameId = null;
  }
  const start = performance.now();
  const startBlur = typeof bloomFilter.blur === 'number' ? bloomFilter.blur : 0;
  const delta = targetBlur - startBlur;

  function step(ts) {
    const t = Math.min(1, (ts - start) / durationMs);
    // use shared easeInOutCubic
    const tt = easeInOutCubic(t);
    const current = startBlur + delta * tt;
    // some versions of BloomFilter expose .blur or .bloomBlur; set both defensively
    if (typeof bloomFilter.blur === 'number') bloomFilter.blur = current;
    if (typeof bloomFilter.bloomBlur === 'number') bloomFilter.bloomBlur = current;
    if (t < 1) {
      _bloomFadeFrameId = requestAnimationFrame(step);
    } else {
      _bloomFadeFrameId = null;
    }
  }
  _bloomFadeFrameId = requestAnimationFrame(step);
}

function toggleBloom() {
  bloomOn = !bloomOn;
  // do not persist bloom state
  if (!screenApp || !screenApp.stage) return;

  if (bloomOn) {
    if (_ensureBloomFilter()) {
      // start from 0 and fade to 2
      if (typeof bloomFilter.blur === 'number') bloomFilter.blur = 0;
      if (typeof bloomFilter.bloomBlur === 'number') bloomFilter.bloomBlur = 0;
      _animateBloomBlur(2, 120);
    }
  } else {
    if (bloomFilter) {
      // fade to 0 then remove filter
      const onDoneRemove = () => {
        screenApp.stage.filters = null;
        bloomFilter = null;
      };
      if (_bloomFadeFrameId !== null) {
        cancelAnimationFrame(_bloomFadeFrameId);
        _bloomFadeFrameId = null;
      }
      const start = performance.now();
      const startBlur = typeof bloomFilter.blur === 'number' ? bloomFilter.blur : 2;
      const durationMs = 120;
      function step(ts) {
        const t = Math.min(1, (ts - start) / durationMs);
        const tt = easeInOutCubic(t);
        const current = startBlur * (1 - tt);
        if (typeof bloomFilter.blur === 'number') bloomFilter.blur = current;
        if (typeof bloomFilter.bloomBlur === 'number') bloomFilter.bloomBlur = current;
        if (t < 1) {
          _bloomFadeFrameId = requestAnimationFrame(step);
        } else {
          _bloomFadeFrameId = null;
          onDoneRemove();
        }
      }
      _bloomFadeFrameId = requestAnimationFrame(step);
    } else {
      // nothing to remove, just make sure stage has no filters
      screenApp.stage.filters = null;
    }
  }
}

function toggleVolume() {
  if (pvmGridSprite && pvmGridSprite.mediaType === 'media' && pvmGridSprite.mediaEl) {
    const media = pvmGridSprite.mediaEl;
    // If clip has no audio track, keep volume off and show explanatory message
    const hasAudio = !!(media._hasAudioTrack || (media.audioTracks && media.audioTracks.length) || media.mozHasAudio || (typeof media.webkitAudioDecodedByteCount === 'number' && media.webkitAudioDecodedByteCount > 0));
    if (!hasAudio) {
      media.muted = true;
      showEffectStatusMessage('', '', `<span style=\"font-size:10pt;\">volume: <b>off</b></span><br><span style=\"font-size:8pt;font-style:italic;opacity:0.8;\">there is no sound</span>`);
      return;
    }
    media.muted = !media.muted;
    showEffectStatusMessage('volume', !media.muted);
  } else {
    showEffectStatusMessage('volume', false, 'no media loaded');
  }
}


function toggleVignette() {
  const overlay = document.querySelector('.vignette-overlay');
  if (!overlay) return;
  const isOn = overlay.style.opacity === '' || overlay.style.opacity === '1';
  overlay.style.opacity = isOn ? '0' : '1';
}

function toggleStatic() {
  // this function is now just for testing - the effect is controlled by media.js
  const isActive = window.isStaticEffectActive();
  showEffectStatusMessage('static', isActive);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// --- Chatbox SPA logic ---
function openChatbox(pushState = true) {
  const layout = document.querySelector('.layout');
  const chatbox = document.getElementById('chatbox');
  if (!layout || !chatbox) return;
  // ensure tally light is off when entering chat
  try {
    const svg = document.querySelector('#pvm-svg-container svg');
    const tally = svg && svg.getElementById('tally-light');
    if (tally) tally.style.opacity = '0';
  } catch (e) {}
  fadeEffect(layout, false);
  setTimeout(() => {
    layout.style.display = 'none';
    chatbox.style.display = '';
    chatbox.classList.add('visible');
    fadeEffect(chatbox, true, '1', 'flex');
  }, 500);
  if (pushState) {
    history.pushState({ chat: true }, '', '/chat');
  }
}

function closeChatbox(pushState = true) {
  const layout = document.querySelector('.layout');
  const chatbox = document.getElementById('chatbox');
  if (!layout || !chatbox) return;
  fadeEffect(chatbox, false);
  setTimeout(() => {
    chatbox.classList.remove('visible');
    chatbox.style.display = 'none';
    layout.style.display = '';
    fadeEffect(layout, true);
    // make sure tally light is off after returning
    try {
      const svg = document.querySelector('#pvm-svg-container svg');
      const tally = svg && svg.getElementById('tally-light');
      if (tally) tally.style.opacity = '0';
    } catch (e) {}
  }, 500);
  if (pushState) {
    history.pushState({}, '', '/');
  }
}
document.addEventListener('DOMContentLoaded', () => {
  const chatboxBack = document.getElementById('chatbox-back');
  if (chatboxBack) {
    chatboxBack.addEventListener('click', (e) => {
      e.preventDefault();
      closeChatbox();
    });
  }

  // On load, check if URL is /chat
  if (window.location.pathname === '/chat') {
    openChatbox(false);
  }
});

window.addEventListener('popstate', (event) => {
  // ignore homepage spa handler on gallery page
  if (document.querySelector('.gallery-layout')) return;
  if (window.location.pathname === '/chat') {
    openChatbox(false);
  } else {
    closeChatbox(false);
  }
});
// gallery page logic (moved from assets/js/gallery.js)
// =============================================function initGalleryPage() {
  function getPageFadeDurationMs() {
    try {
      const td = getComputedStyle(document.body).transitionDuration || '';
      const first = td.split(',')[0].trim();
      if (first.endsWith('ms')) return parseFloat(first) || 0;
      if (first.endsWith('s')) return (parseFloat(first) || 0) * 1000;
    } catch (e) {}
    return 250;
  }

  function runGalleryTransition(step) {
    if (typeof step !== 'function') return Promise.resolve();
    const container = galleryMain || document.querySelector('.gallery-layout');
    if (container) {
      if (container.dataset.galleryFade === 'running') {
        try { step(); } catch (err) { console.error(err); }
        return Promise.resolve();
      }
      container.dataset.galleryFade = 'running';
      const fadeDuration = 500;
      fadeEffect(container, false);
      return new Promise((resolve) => {
        setTimeout(() => {
          let result;
          try { result = step(); } catch (err) { console.error(err); }
          Promise.resolve(result)
            .catch((err) => { console.error(err); })
            .finally(() => {
              const displayValue = (galleryMain && container === galleryMain) ? 'block'
                : (container.classList.contains('gallery-layout') ? 'flex' : 'block');
              fadeEffect(container, true, '1', displayValue);
              setTimeout(() => {
                delete container.dataset.galleryFade;
                resolve();
              }, fadeDuration);
            });
        }, fadeDuration);
      });
    }

    const baseFade = getPageFadeDurationMs();
    const fadeMs = Math.max(0, baseFade * 0.6);
    if (body.classList.contains('loading')) {
      try { step(); } catch (err) { console.error(err); }
      return Promise.resolve();
    }
    body.classList.add('loading');
    return new Promise((resolve) => {
      setTimeout(() => {
        let result;
        try { result = step(); } catch (err) { console.error(err); }
        Promise.resolve(result)
          .catch((err) => { console.error(err); })
          .finally(() => {
            requestAnimationFrame(() => {
              body.classList.remove('loading');
              resolve();
            });
          });
      }, fadeMs);
    });
  }

  const gridEl = document.getElementById('gallery-grid');
  const detailEl = document.getElementById('gallery-detail');
  const galleryHeader = document.querySelector('.gallery-header');
  const galleryMain = document.querySelector('.gallery-main');
  const galleryNav = document.querySelector('.gallery-nav');
  const galleryNavIndicator = galleryNav ? galleryNav.querySelector('.gallery-nav-indicator') : null;
  const collections = (window.__galleryCollections && typeof window.__galleryCollections === 'object') ? window.__galleryCollections : null;
  const collectionNames = collections ? Object.keys(collections) : [];
  const useCollections = collectionNames.length > 0;
  let currentCollection = null;
  let pendingCollection = null;
  const detailImg = document.getElementById('detail-image');
  const detailVideo = document.getElementById('detail-video');
  const detailLabel = document.getElementById('detail-label');
  const configuredBase = (typeof window.__galleryRouteBase === 'string') ? window.__galleryRouteBase : '/gallery';
  const routeBase = configuredBase.replace(/\/+$/, '');
  const normalizedRouteBase = routeBase.startsWith('/') ? routeBase : `/${routeBase}`;
  const usingHashRouting = /\.html$/i.test(normalizedRouteBase);
  const landingHref = (typeof window.__galleryLanding === 'string')
    ? window.__galleryLanding
    : (useCollections ? 'index.html' : 'gallery.html');
  const landingUrl = (typeof window.__galleryLandingUrl === 'string')
    ? window.__galleryLandingUrl
    : (useCollections ? '/' : (usingHashRouting ? 'gallery.html' : '/gallery/'));

  function buildGalleryUrl(slug = null) {
    const base = normalizedRouteBase || '/gallery';
    if (/\.html$/i.test(base)) {
      return slug ? `${base}#${slug}` : base;
    }
    const trimmed = base.replace(/\/+$/, '');
    if (slug) return `${trimmed}/${slug}/`;
    return `${trimmed}/`;
  }

  // Load gallery items and sort with series-aware logic:
  // - Normalize titles (strip articles like "the", "a", and prefix "dr.") so related items group
  // - Group by base name; if numeric suffix exists (from slug like foo-3), sort numerically
  function normalizeTitleForSeries(s) {
    const t = (s || '').toString().toLowerCase().trim();
    // strip leading articles and common prefixes
    let x = t.replace(/^\s*(the|a|an)\s+/, '');
    x = x.replace(/^\s*dr\.?\s+/, '');
    // treat platform prefix 'wii' as ignorable for sorting so
    // 'wii forecast channel' sorts under 'forecast channel'
    x = x.replace(/^\s*wii\s+/, '');
    // remove common descriptor words so base titles group correctly
    // e.g., "biohazard recreation" -> "biohazard"
    x = x.replace(/\b(recreation|restoration|vectorization|upscale|title)\b/g, ' ');
    // collapse punctuation and whitespace to spaces
    x = x.replace(/[^a-z0-9]+/g, ' ').trim();
    return x;
  }
  function baseRootFromTitle(title) {
    const norm = normalizeTitleForSeries(title);
    const parts = norm.split(/\s+/).filter(Boolean);
    // group by first two significant words to keep related items together
    return parts.slice(0, 2).join(' ') || norm;
  }
  function seriesKey(item) {
    const title = item.title || item.slug || '';
    const slug = (item.slug || '').toString();
    // prefer slug for numeric parsing (e.g., castle-cat-3)
    const m = slug.match(/^(.*?)-(\d+)$/);
    if (m) {
      const baseSlug = m[1].replace(/-/g, ' ');
      return baseRootFromTitle(baseSlug);
    }
    return baseRootFromTitle(title);
  }
  function seriesNum(item) {
    const slug = (item.slug || '').toString();
    const m = slug.match(/-(\d+)$/);
    if (m) return parseInt(m[1], 10) || 0;
    // fallback: trailing number in normalized title
    const t = normalizeTitleForSeries(item.title || item.slug || '');
    const m2 = t.match(/(\d+)$/);
    return m2 ? (parseInt(m2[1], 10) || 0) : 0;
  }
  function computeItems(list) {
    return Array.isArray(list)
      ? list.slice().sort((a, b) => {
          const ka = seriesKey(a);
          const kb = seriesKey(b);
          if (ka !== kb) return ka.localeCompare(kb, undefined, { sensitivity: 'base' });
          const na = seriesNum(a);
          const nb = seriesNum(b);
          if (na !== nb) return na - nb || 0;
          const ta = (a.title || a.slug || '').toString();
          const tb = (b.title || b.slug || '').toString();
          return ta.localeCompare(tb, undefined, { sensitivity: 'base' });
        })
      : [];
  }

  const LS_KEY_COLLECTION = 'gallery:lastCollection';
  const storedCollection = (() => {
    try {
      const v = localStorage.getItem(LS_KEY_COLLECTION);
      return (v && collections && collections[v]) ? v : null;
    } catch (e) { return null; }
  })();

  function firstCollectionFromNav() {
    try {
      const firstBtn = galleryNav && galleryNav.querySelector('[data-collection]');
      const key = firstBtn && firstBtn.dataset && firstBtn.dataset.collection;
      return (key && collections && collections[key]) ? key : null;
    } catch (e) { return null; }
  }

  if (useCollections && collectionNames.length && (!window.__galleryData || !Array.isArray(window.__galleryData) || !window.__galleryData.length)) {
    // Default to the first nav item, ignoring stored value to respect visible order
    currentCollection = firstCollectionFromNav() || collectionNames[0];
    window.__galleryData = collections[currentCollection];
  }
  let items = computeItems(window.__galleryData);

  function rebuildItems() {
    items = computeItems(window.__galleryData);
  }
  // Treat localhost like file-protocol for SPA routing so Python's http.server
  // doesn't 404 on pretty URLs like /gallery/...
  const isFileProtocol = window.location.protocol === 'file:' ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';
  const slugFromPath = () => {
    if (useCollections) {
      const { collection, slug } = parseHash();
      if (collection) pendingCollection = collection;
      return slug;
    }
    if (isFileProtocol || usingHashRouting) {
      const hash = (window.location.hash || '').replace(/^#/, '');
      return hash || null;
    }
    const currentPath = window.location.pathname.replace(/\/+$/, '');
    if (!normalizedRouteBase) return null;
    if (!currentPath.startsWith(normalizedRouteBase)) return null;
    const remainder = currentPath.slice(normalizedRouteBase.length);
    const parts = remainder.split('/').filter(Boolean);
    return parts[0] || null;
  };

  // Pause and reset any media inside the detail panel (e.g., inline audio players)
  function stopDetailMedia() {
    try {
      if (!detailEl) return;
      const nodes = detailEl.querySelectorAll('audio, video');
      nodes.forEach((m) => {
        try { m.pause(); } catch (e) {}
        try { m.currentTime = 0; } catch (e) {}
      });
    } catch (e) {}
  }

  function showGrid() {
    if (!gridEl || !detailEl) return;
    // stop any playing media (e.g., forecast channel audio) when leaving detail view
    stopDetailMedia();
    if (galleryHeader) galleryHeader.style.display = '';
    document.body.classList.remove('no-scroll');
    gridEl.style.display = '';
    detailEl.style.display = 'none';
    // Recalculate nav underline after layout is visible again
    try {
      const active = galleryNav ? galleryNav.querySelector('[data-collection].is-active') : null;
      if (active) {
        requestAnimationFrame(() => positionNavIndicator(active.dataset.collection, { mode: 'grow' }));
      }
    } catch (e) {}
  }

  function showDetail() {
    if (!gridEl || !detailEl) return;
    if (galleryHeader) galleryHeader.style.display = 'none';
    document.body.classList.add('no-scroll');
    gridEl.style.display = 'none';
    detailEl.style.display = '';
  }

  function normalizeMediaEntry(entry) {
    if (!entry) return null;
    const copy = Object.assign({}, entry);
    if (!copy.kind && typeof copy.type === 'string') copy.kind = copy.type;
    return copy;
  }

  function getMediaList(item) {
    if (item && Array.isArray(item.images)) return item.images.map(normalizeMediaEntry);
    if (item && Array.isArray(item.media)) return item.media.map(normalizeMediaEntry);
    return [];
  }

  function isVideoEntry(entry) {
    if (!entry) return false;
    if (entry.kind && entry.kind.toLowerCase() === 'video') return true;
    return typeof entry.src === 'string' && /\.(mp4|mov|webm)$/i.test(entry.src);
  }

  function getThumbSrc(entry) {
    if (!entry) return null;
    if (entry.thumb) return entry.thumb;
    if (!isVideoEntry(entry)) return entry.src;
    return null;
  }

  const DEFAULT_THUMB = (typeof window.__galleryDefaultThumb === 'string')
    ? window.__galleryDefaultThumb
    : '/assets/images/preview.png';

  // Cache generated thumbnails per URL to avoid duplicate work
  const _videoThumbCache = new Map();

  // Generate a poster/thumbnail from a video frame
  function captureFrameFromVideo(url, seekTime = null) {
    if (!url) return Promise.resolve(null);
    if (_videoThumbCache.has(url)) return Promise.resolve(_videoThumbCache.get(url));
    return new Promise((resolve) => {
      try {
        const v = document.createElement('video');
        v.crossOrigin = 'anonymous';
        v.muted = true;
        v.playsInline = true;
        v.preload = 'metadata';
        v.src = url;
        const cleanup = () => {
          try { v.src = ''; v.removeAttribute('src'); v.load(); } catch (e) {}
        };
        const finish = (dataUrl) => {
          _videoThumbCache.set(url, dataUrl);
          cleanup();
          resolve(dataUrl || null);
        };
        v.addEventListener('error', () => finish(null), { once: true });
        v.addEventListener('loadedmetadata', () => {
          const dur = (v.duration && isFinite(v.duration)) ? v.duration : 0;
          const clamp = (val) => {
            const minT = 0.1;
            if (!dur) return Math.max(minT, val || minT);
            const maxT = Math.max(minT, dur - 0.15);
            return Math.min(Math.max(minT, val), maxT);
          };
          const t = clamp(Number.isFinite(seekTime) ? seekTime : (dur ? dur * 0.5 : 0.5));
          const onSeeked = () => {
            try {
              const w = v.videoWidth;
              const h = v.videoHeight;
              if (!w || !h) return finish(null);
              const canvas = document.createElement('canvas');
              canvas.width = w;
              canvas.height = h;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(v, 0, 0, w, h);
              const data = canvas.toDataURL('image/jpeg', 0.82);
              finish(data);
            } catch (e) {
              finish(null);
            }
          };
          v.addEventListener('seeked', onSeeked, { once: true });
          try { v.currentTime = t; } catch (e) {
            // Not a different time; wait until canplay to apply the same seek
            v.addEventListener('canplay', () => { try { v.currentTime = t; } catch(_) {} }, { once: true });
          }
        }, { once: true });
      } catch (e) {
        resolve(null);
      }
    });
  }

  function updateNavState(name) {
    if (!galleryNav) return;
    const buttons = galleryNav.querySelectorAll('[data-collection]');
    buttons.forEach((btn) => {
      const isActive = btn.dataset.collection === name;
      btn.classList.toggle('is-active', isActive);
      if (isActive) btn.setAttribute('aria-current','true'); else btn.removeAttribute('aria-current');
      if ('disabled' in btn) btn.disabled = isActive;
    });
    positionNavIndicator(name);
    try { localStorage.setItem(LS_KEY_COLLECTION, name); } catch (e) {}
  }

  function positionNavIndicator(name, opts){
    if(!galleryNav||!galleryNavIndicator) return;
    const t = galleryNav.querySelector(`[data-collection="${name}"]`);
    if(!t){ galleryNavIndicator.style.width='0'; return; }
    const nr = galleryNav.getBoundingClientRect();
    const br = t.getBoundingClientRect();
    const animate = !opts || opts.animate !== false;
    const mode = opts && opts.mode ? String(opts.mode) : null; // null | 'grow'

    let prevTransition = '';
    if (!animate) {
      prevTransition = galleryNavIndicator.style.transition;
      galleryNavIndicator.style.transition = 'none';
    }

    const targetWidth = `${br.width}px`;
    const targetX = `translateX(${br.left-nr.left}px)`;

    if (animate && mode === 'grow') {
      // Snap transform to target without transition, collapse width, then grow width with transition
      const original = galleryNavIndicator.style.transition;
      galleryNavIndicator.style.transition = 'none';
      galleryNavIndicator.style.transform = targetX;
      galleryNavIndicator.style.width = '0px';
      // Force reflow before enabling transition for growth
      void galleryNavIndicator.offsetWidth;
      galleryNavIndicator.style.transition = original || '';
      galleryNavIndicator.style.width = targetWidth;
    } else {
      galleryNavIndicator.style.width = targetWidth;
      galleryNavIndicator.style.transform = targetX;
    }
    // Color is handled purely by CSS (prefers-color-scheme). Avoid JS overrides.

    if (!animate) {
      void galleryNavIndicator.offsetWidth; // force reflow
      galleryNavIndicator.style.transition = prevTransition || '';
    }
  }

  function parseHash() {
    const raw = window.location.hash.replace(/^#/, '');
    if (!raw) return { collection: null, slug: null };
    const parts = raw.split('/').filter(Boolean);
    const collection = (parts[0] && collections && collections[parts[0]]) ? parts[0] : null;
    const slug = parts[1] || null;
    return { collection, slug };
  }

  function renderGrid() {
    if (!gridEl || !detailEl) return;
    gridEl.innerHTML = '';
    showGrid();
    items.forEach((item) => {
      const card = document.createElement('a');
      if (useCollections) {
        const collectionKey = currentCollection || collectionNames[0] || 'gallery';
        card.href = `#${collectionKey}/${item.slug}`;
      } else {
        const baseUrl = normalizedRouteBase || '/gallery';
        card.href = isFileProtocol ? `#${item.slug}` : `${baseUrl}/${item.slug}/`;
      }
      card.className = 'gallery-card';
      card.classList.add('is-loading');
      card.setAttribute('aria-label', item.title || item.slug);
      const mediaEntries = getMediaList(item);
      const firstEntry = mediaEntries[0] || null;
      const isVideoThumb = !!firstEntry && isVideoEntry(firstEntry);
      const thumbSrc = getThumbSrc(firstEntry) || item.thumb || DEFAULT_THUMB;
      const img = document.createElement('img');
      img.src = thumbSrc;
      img.alt = item.title || item.slug;
      img.loading = 'lazy';
      img.draggable = false;
      img.classList.add('no-save');
      // optional per-item crop/zoom via data props
      if (item.thumbScale) card.style.setProperty('--thumb-scale', String(item.thumbScale));
      if (item.thumbScaleHover) card.style.setProperty('--thumb-scale-hover', String(item.thumbScaleHover));
      if (item.thumbX) card.style.setProperty('--thumb-x', item.thumbX);
      if (item.thumbY) card.style.setProperty('--thumb-y', item.thumbY);
      card.appendChild(img);

      // If this is a video without an explicit thumbnail, generate one
      if (isVideoThumb && !getThumbSrc(firstEntry) && !item.thumb) {
        captureFrameFromVideo(firstEntry.src).then((dataUrl) => {
          if (dataUrl) {
            // Only update if this card/image is still in the DOM
            if (img && img.isConnected) img.src = dataUrl;
          }
        });
      }

      // Add a play overlay for video thumbnails
      if (isVideoThumb) {
        card.classList.add('has-video');
        const play = document.createElement('div');
        play.className = 'play-overlay';
        play.setAttribute('aria-hidden', 'true');
        card.appendChild(play);
      }
      const markReady = () => {
        card.classList.remove('is-loading');
        card.classList.add('is-ready');
      };
      if (img.complete && img.naturalWidth) {
        markReady();
      } else {
        img.addEventListener('load', markReady, { once: true });
        img.addEventListener('error', markReady, { once: true });
      }
      card.addEventListener('click', async (e) => {
        e.preventDefault();
        await navigateTo(item.slug);
      });
      gridEl.appendChild(card);
    });
  }

  function switchCollection(name, options = {}) {
    if (!useCollections || !collections[name]) return Promise.resolve();
    const shouldForce = !!options.force;
    const slug = options.slug || null;
    const suppressHash = !!options.suppressHash;
    const replaceHash = !!options.replaceHash;
    const apply = () => {
      if (currentCollection !== name || shouldForce) {
        window.__galleryData = collections[name];
        rebuildItems();
        currentCollection = name;
        updateNavState(name);
      }
      renderGrid();
    };
    const finalize = () => {
      if (!suppressHash) {
        const hash = slug ? `#${name}/${slug}` : `#${name}`;
        if (replaceHash) {
          history.replaceState({}, '', hash);
        } else {
          history.pushState({}, '', hash);
        }
      }
      if (slug) renderDetail(slug);
      return Promise.resolve();
    };
    if (options.skipFade) {
      apply();
      return finalize();
    }
    return runGalleryTransition(() => {
      apply();
    }).then(finalize);
  }

  function setDetailMedia(item, index = 0) {
    const mediaEntries = getMediaList(item);
    const entry = mediaEntries[index] || mediaEntries[0] || null;
    const src = entry ? entry.src : (item.full || '');
    const videoActive = entry ? isVideoEntry(entry) : isVideoEntry({ src });

    if (detailVideo) {
      try { detailVideo.pause(); } catch (e) {}
      detailVideo.removeAttribute('src');
      detailVideo.removeAttribute('poster');
      detailVideo.style.display = 'none';
    }
    if (detailImg) {
      detailImg.style.display = 'none';
    }

    detailImg.dataset.index = index;

    if (videoActive && detailVideo) {
      if (entry && entry.poster) {
        detailVideo.poster = entry.poster;
      } else if (entry && entry.thumb) {
        detailVideo.poster = entry.thumb;
      } else if (src) {
        // generate a poster on the fly when none is provided
        captureFrameFromVideo(src).then((dataUrl) => {
          if (dataUrl && detailVideo && detailVideo.isConnected && detailVideo.src === src) {
            try { detailVideo.poster = dataUrl; } catch (e) {}
          }
        });
      }
      detailVideo.src = src;
      detailVideo.style.display = '';
      detailVideo.load();
      try { detailVideo.setAttribute('controlsList', 'nodownload'); } catch(e) {}
      try { detailVideo.classList.add('no-save'); } catch(e) {}
    } else if (detailImg) {
      detailImg.src = src;
      detailImg.alt = item.title || item.slug || '';
      detailImg.style.display = '';
      try { detailImg.draggable = false; } catch(e) {}
      try { detailImg.classList.add('no-save'); } catch(e) {}
    }
  }

  function renderDetail(slug) {
    if (!gridEl || !detailEl || !detailImg || !detailLabel) return;
    // stop any currently playing media in the previous detail before rendering a new one
    stopDetailMedia();
    const item = items.find((it) => it.slug === slug);
    if (!item) {
      renderNotFound();
      return;
    }
    showDetail();
    setDetailMedia(item, 0);

    const safeTitle = (item.title || slug);
    const hasDesc = item.description != null && String(item.description).length > 0;
    const hasSub = item.subtitle != null && String(item.subtitle).length > 0;
    const combined = hasDesc && hasSub
      ? String(item.description) + '\n\n' + String(item.subtitle)
      : hasDesc
        ? String(item.description)
        : (item.subtitle || '');
    const descHtml = combined.replace(/\n/g, '<br>');
    // Title on first line (block), description below with preserved newlines
    detailLabel.innerHTML = combined
      ? `<strong>${safeTitle}</strong><span class="art-desc">${descHtml}</span>`
      : `<strong>${safeTitle}</strong>`;

    // remove any old preview strip
    const oldStrip = detailEl.querySelector('.detail-previews');
    if (oldStrip) oldStrip.remove();

    // build preview thumbnails if multiple images
    let previewStrip = null;
    const mediaEntries = getMediaList(item);
    if (mediaEntries.length > 1) {
      previewStrip = document.createElement('div');
      previewStrip.className = 'detail-previews';
      mediaEntries.forEach((img, idx) => {
        const thumb = document.createElement('img');
        thumb.src = getThumbSrc(img) || img.src || DEFAULT_THUMB;
        thumb.className = 'preview-thumb';
        thumb.style.opacity = idx === 0 ? '1' : '0.5';
        thumb.addEventListener('click', () => {
          setDetailMedia(item, idx);
          [...previewStrip.querySelectorAll('img')].forEach((el, i) => {
            el.style.opacity = i === idx ? '1' : '0.5';
          });
        });
        previewStrip.appendChild(thumb);
      });
      detailEl.appendChild(previewStrip);
    }

    // Move the title/description label below the thumbnails (or below image when no thumbnails)
    if (detailLabel) {
      if (previewStrip) {
        detailEl.appendChild(detailLabel);
      } else {
        const wrapper = detailImg.closest('.artwork-wrapper');
        if (wrapper && wrapper.parentNode === detailEl) {
          detailEl.appendChild(detailLabel);
        }
      }
    }

    // enable native-resolution hover zoom on the detail image
    setupDetailHoverZoom();

    // Dynamically constrain image height so the page never scrolls
    function adjustDetailMediaSize() {
      try {
        const mediaEl = (detailVideo && detailVideo.style.display !== 'none') ? detailVideo : detailImg;
        if (!mediaEl) return;
        const vh = window.innerHeight || document.documentElement.clientHeight || 0;
        const imgRect = mediaEl.getBoundingClientRect();
        const previews = detailEl.querySelector('.detail-previews');
        const previewsH = previews ? previews.getBoundingClientRect().height : 0;
        const labelH = detailLabel ? detailLabel.getBoundingClientRect().height : 0;
        const bottomPad = 64; // keep in sync with #gallery-detail padding-bottom
        const reserved = previewsH + labelH + 24 + bottomPad;
        const available = Math.max(120, Math.floor(vh - imgRect.top - reserved));
        mediaEl.style.maxHeight = available + 'px';
      } catch (e) {}
    }
    if (detailImg && detailImg.complete && detailImg.style.display !== 'none') adjustDetailMediaSize();
    if (detailImg) detailImg.addEventListener('load', adjustDetailMediaSize, { once: true });
    if (detailVideo) detailVideo.addEventListener('loadedmetadata', adjustDetailMediaSize, { once: true });
    window.addEventListener('resize', adjustDetailMediaSize, { passive: true });
  }

  function renderNotFound() {
    if (!gridEl || !detailEl || !detailImg || !detailLabel) return;
    showDetail();
    detailImg.style.display = 'none';
    detailLabel.textContent = 'not found';
  }

  function setupDetailHoverZoom() {
    if (detailVideo && detailVideo.style.display !== 'none') {
      if (detailImg) {
        detailImg.style.transform = 'scale(1)';
      }
      return;
    }
    const img = detailImg;
    if (!img) return;
    const wrapper = img.closest('.artwork-wrapper');
    if (!wrapper) return;

    // reset
    img.style.transformOrigin = '';
    img.style.transform = '';
    img.style.cursor = 'zoom-in';
    wrapper.style.overflow = 'hidden';

    let zoomed = false;
    let maxScale = 1;

    function computeMaxScale() {
      const nx = img.naturalWidth || 0;
      const ny = img.naturalHeight || 0;
      const cw = img.clientWidth || 0;
      const ch = img.clientHeight || 0;
      if (!nx || !ny || !cw || !ch) return 2; // allow zoom even if not measured yet
      const sx = nx / cw;
      const sy = ny / ch;
      const intrinsicScale = Math.min(sx, sy);
      // If intrinsic resolution isn't larger than displayed, still allow a tasteful zoom
      if (!isFinite(intrinsicScale) || intrinsicScale <= 1.0001) return 2;
      // Otherwise limit to 2x or intrinsic, whichever is smaller
      return Math.min(2, intrinsicScale);
    }

    function updateZoomCapability() {
      maxScale = computeMaxScale();
      if (maxScale <= 1.0001) {
        // effectively no extra resolution; disable zoom affordance
        img.style.cursor = 'default';
        zoomed = false;
        img.style.transform = 'scale(1)';
      } else {
        img.style.cursor = 'zoom-in';
      }
    }

    // Disable tap-to-zoom on touch devices
    const isTouch = (('ontouchstart' in window) || (navigator.maxTouchPoints > 0) ||
      (window.matchMedia && matchMedia('(pointer: coarse)').matches));
    // compute once now; if image isn't ready yet, recompute on load
    updateZoomCapability();
    if (!img.complete || !img.naturalWidth) {
      img.addEventListener('load', updateZoomCapability, { once: true });
    }

    if (isTouch) {
      img.style.cursor = 'default';
      img.onclick = null;
      img.onmousemove = null;
      img.onmouseleave = null;
      return; // exit early: no zoom handlers on mobile
    }

    img.onclick = (e) => {
      e.preventDefault();
      if (maxScale <= 1.0001) return; // nothing to zoom
      zoomed = !zoomed;
      if (zoomed) {
        img.style.cursor = 'zoom-out';
        // apply zoom immediately at the click point (no mousemove required)
        const rect = img.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;
        const scale = maxScale;
        img.style.transformOrigin = `${(x * 100).toFixed(2)}% ${(y * 100).toFixed(2)}%`;
        img.style.transform = `scale(${scale})`;
      } else {
        img.style.transform = 'scale(1)';
        img.style.cursor = maxScale > 1.0001 ? 'zoom-in' : 'default';
      }
    };

    img.onmousemove = (e) => {
      if (!zoomed || maxScale <= 1.0001) return;
      const rect = img.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      const scale = maxScale;
      img.style.transformOrigin = `${(x * 100).toFixed(2)}% ${(y * 100).toFixed(2)}%`;
      img.style.transform = `scale(${scale})`;
    };

    img.onmouseleave = () => {
      if (zoomed) return; // don’t reset if zoomed in
      img.style.transform = 'scale(1)';
      img.style.cursor = maxScale > 1.0001 ? 'zoom-in' : 'default';
    };
  }

  let _lastGridScrollY = 0;
  function navigateTo(slug, replace = false) {
    const run = () => {
      // Never run gallery navigation on non-gallery pages
      if (!document.querySelector('.gallery-layout')) return;
      try { _lastGridScrollY = window.scrollY || window.pageYOffset || 0; } catch (e) {}
      if (useCollections) {
        const col = currentCollection || collectionNames[0] || 'gallery';
        const hash = `#${col}/${slug}`;
        if (replace) {
          history.replaceState({ slug, col, scrollY: _lastGridScrollY }, '', hash);
        } else {
          history.pushState({ slug, col, scrollY: _lastGridScrollY }, '', hash);
        }
        renderDetail(slug);
        return;
      }
      if (isFileProtocol) {
        if (replace) {
          location.replace(`#${slug}`);
        } else {
          location.hash = `#${slug}`;
        }
        renderDetail(slug);
        return;
      }
    const baseUrl = normalizedRouteBase || '/gallery';
    const url = `${baseUrl}/${slug}/`;
      if (replace) {
        history.replaceState({ slug, scrollY: _lastGridScrollY }, '', url);
      } else {
        history.pushState({ slug, scrollY: _lastGridScrollY }, '', url);
      }
      renderDetail(slug);
    };
    return runGalleryTransition(run);
  }

  function navigateHome(replace = false) {
    const run = () => {
      // Never run gallery navigation on non-gallery pages
      if (!document.querySelector('.gallery-layout')) return;
      if (useCollections) {
        const col = currentCollection || collectionNames[0] || 'gallery';
        const hash = `#${col}`;
        if (replace) {
          history.replaceState({ col }, '', hash);
        } else {
          history.pushState({ col }, '', hash);
        }
        renderGrid();
        const s = history.state && history.state.scrollY;
        const y = (typeof s === 'number') ? s : _lastGridScrollY;
        try { window.scrollTo(0, y); } catch (e) {}
        return;
      }
      if (isFileProtocol) {
        if (replace) {
          location.replace(landingHref);
        } else {
          location.hash = '';
        }
        renderGrid();
        const s2 = history.state && history.state.scrollY;
        const y2 = (typeof s2 === 'number') ? s2 : _lastGridScrollY;
        try { window.scrollTo(0, y2); } catch (e) {}
        return;
      }
    const baseUrl = normalizedRouteBase || '/gallery';
    const url = `${baseUrl}/`;
      if (replace) {
        history.replaceState({ scrollY: _lastGridScrollY }, '', url);
      } else {
        history.pushState({ scrollY: _lastGridScrollY }, '', url);
      }
      renderGrid();
      const s3 = history.state && history.state.scrollY;
      const y3 = (typeof s3 === 'number') ? s3 : _lastGridScrollY;
      try { window.scrollTo(0, y3); } catch (e) {}
    };
    return runGalleryTransition(run);
  }

  if (useCollections) {
    const handleHashChange = () => {
      const { collection, slug } = parseHash();
      const targetCollection = collection && collections[collection] ? collection : (currentCollection || collectionNames[0]);
      switchCollection(targetCollection, {
        suppressHash: true,
        force: true,
        slug: slug || null,
        replaceHash: true
      });
    };
    window.addEventListener('hashchange', handleHashChange);
  } else if (isFileProtocol || usingHashRouting) {
    window.addEventListener('hashchange', () => {
      const slug = slugFromPath();
      const render = () => { if (slug) renderDetail(slug); else renderGrid(); };
      if (body.classList.contains('loading')) {
        render();
      } else {
        runGalleryTransition(render);
      }
    });
  } else {
    window.addEventListener('popstate', () => {
      const slug = slugFromPath();
      const render = () => {
        if (slug) {
          renderDetail(slug);
        } else {
          renderGrid();
          const s = history.state && history.state.scrollY;
          const y = (typeof s === 'number') ? s : _lastGridScrollY;
          try { window.scrollTo(0, y); } catch (e) {}
        }
      };
      if (body.classList.contains('loading')) {
        render();
      } else {
        runGalleryTransition(render);
      }
    });
  }

  if (useCollections && galleryNav) {
    galleryNav.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-collection]');
      if (!btn) return;
      const target = btn.dataset.collection;
      if (!target || target === currentCollection) return;
      e.preventDefault();
      updateNavState(target); // move underline immediately
      switchCollection(target, { replaceHash: true });
    });
  }

  // init underline
  requestAnimationFrame(()=>{
    const active = galleryNav ? galleryNav.querySelector('[data-collection].is-active') : null;
    if (active) positionNavIndicator(active.dataset.collection, { mode: 'grow' });
  });

  // keep in sync on resize/theme
  window.addEventListener('resize', ()=>{
    const active = galleryNav ? galleryNav.querySelector('[data-collection].is-active') : null;
    if (active) positionNavIndicator(active.dataset.collection, { animate: false });
  });
  try{
    const mql = matchMedia('(prefers-color-scheme: dark)');
    mql.addEventListener('change', ()=>{
      // wait a tick for CSS to apply before measuring/setting
      requestAnimationFrame(()=>{
        const a=galleryNav?.querySelector('[data-collection].is-active');
        if(a) positionNavIndicator(a.dataset.collection, { animate: false });
      });
    });
  }catch(e){}

  // Best-effort: block context menu on marked media
  document.addEventListener('contextmenu', (e) => {
    const t = e.target;
    if (t && (t.matches && (t.matches('img.no-save') || t.matches('video.no-save'))) ) {
      e.preventDefault();
    }
  });

  // Best-effort: suppress long-press save on touch devices for marked media
  let _touchTimer = null;
  document.addEventListener('touchstart', (e) => {
    const t = e.target;
    if (!t || !(t.matches && (t.matches('img.no-save') || t.matches('video.no-save')))) return;
    _touchTimer = setTimeout(() => {
      try { e.preventDefault(); } catch(_) {}
    }, 350);
  }, { passive: false });
  document.addEventListener('touchend', () => { if (_touchTimer) { clearTimeout(_touchTimer); _touchTimer = null; } }, { passive: true });
  document.addEventListener('touchmove', () => { if (_touchTimer) { clearTimeout(_touchTimer); _touchTimer = null; } }, { passive: true });

  // Only perform gallery initial navigation when the gallery layout exists
  if (document.querySelector('.gallery-layout')) {
    const initialSlug = slugFromPath();
    if (useCollections) {
      const initialCollection = (pendingCollection && collections[pendingCollection])
        ? pendingCollection
        : (firstCollectionFromNav() || (collectionNames[0] || null));
      const initialHash = parseHash();
      if (initialCollection) {
        switchCollection(initialCollection, {
          skipFade: true,
          suppressHash: true,
          force: true,
          slug: initialHash.slug || null,
          replaceHash: true
        });
      }
    } else {
      if (initialSlug) {
        renderDetail(initialSlug);
        if (!isFileProtocol) {
          const url = buildGalleryUrl(initialSlug);
          history.replaceState({ slug: initialSlug }, '', url);
        }
      } else {
        renderGrid();
        if (!isFileProtocol) {
          const url = buildGalleryUrl(null);
          history.replaceState({}, '', url);
        }
      }
    }
  }

function updateGlowReflectionWidth() {
  const message = document.querySelector('.message');
  const glow = document.querySelector('.pvm-glow-reflection');
  if (!message || !glow) return;

  // Copy the message HTML, preserving line breaks and spans
  glow.innerHTML = message.innerHTML;
}

// simple static overlay function
function showStaticOverlay(force = false, srcOverride = null) {
  // when force=true, always show static (e.g., channel change)
  if (!force && !window.isStaticEffectActive()) return;
  
  // create video element for the static
  const staticVideo = document.createElement('video');
  const staticSrc = srcOverride || (window.getStaticIntroSrc && window.getStaticIntroSrc()) || '/assets/videos/static/static-short.mp4';
  const isShort = /static-short/i.test(staticSrc);
  staticVideo.src = staticSrc;
  staticVideo.muted = false;
  staticVideo.playsInline = true;
  staticVideo.autoplay = true;
  staticVideo.loop = false;
  staticVideo.style.display = 'none';
  document.body.appendChild(staticVideo);
  
  // create PIXI sprite from the video
  const staticSprite = new PIXI.Sprite(PIXI.Texture.from(staticVideo));
  staticSprite.anchor.set(0.5, 0.5);
  staticSprite.x = screenApp.screen.width / 2;
  staticSprite.y = screenApp.screen.height / 2;
  staticSprite.width = screenApp.screen.width;
  staticSprite.height = screenApp.screen.height;
  staticSprite.zIndex = 999;
  
  // add to screen container
  screenContainer.addChild(staticSprite);
  
  // Static overlay keyframes config
  const STATIC_CURVES = {
    long: [
      { t: 0.20, mode: 'NORMAL', a: 1.0 },
      { t: 0.25, mode: 'NORMAL', a: 1.0 },
      { t: 0.26, mode: 'NORMAL', a: 0.2 },
      { t: 0.50, mode: 'NORMAL', a: 1.0 },
      { t: 0.51, mode: 'NORMAL', a: 0.9 },
      { t: 0.58, mode: 'NORMAL', a: 0.9 },
      { t: 1.00, mode: 'NORMAL', a: 1.0 },
    ],
    short: [
      { t: 0.08, mode: 'NORMAL', a: 1.0 },
      { t: 0.12, mode: 'NORMAL', a: 0.35 },
      { t: 0.18, mode: 'NORMAL', a: 0.9 },
      { t: 0.22, mode: 'NORMAL', a: 0.8 },
      { t: 0.32, mode: 'SCREEN', a: 0.7 },
      { t: 1.00, mode: 'NORMAL', a: 1.0 },
    ],
  };
  const STATIC_TIMING = {
    long: { finalFadeMs: 120, capMs: null },
    short: { finalFadeMs: 60, capMs: 240 },
  };
  const BLEND = PIXI.BLEND_MODES;
  const curve = isShort ? STATIC_CURVES.short : STATIC_CURVES.long;
  const timing = isShort ? STATIC_TIMING.short : STATIC_TIMING.long;

  // Drive animation by the video playback (plays to completion)
  let finalFadeStarted = false;
  let finalFadeStartTs = 0;
  const finalFadeMs = timing.finalFadeMs;
  const shortMaxMs = timing.capMs; // total on-screen time cap for short (ms)
  let animStartTs = 0;

  function animateStatic(ts) {
    const dur = staticVideo.duration || 0;
    const ct = staticVideo.currentTime || 0;
    const progress = dur > 0 ? Math.min(1, ct / dur) : 0;
    if (!animStartTs) animStartTs = ts || performance.now();
    const elapsed = (ts || performance.now()) - animStartTs;
    // If has a cap and we've exceeded it, begin final fade even if video hasn't ended
    if (shortMaxMs && !finalFadeStarted && elapsed >= shortMaxMs) {
      finalFadeStarted = true;
      finalFadeStartTs = ts || performance.now();
    }
    
    if (progress < 1 && !finalFadeStarted) {
      // Apply curve step by progress
      let opacity = 1.0;
      let blendMode = BLEND.NORMAL;
      for (let i = 0; i < curve.length; i++) {
        if (progress < curve[i].t) {
          opacity = curve[i].a;
          blendMode = BLEND[curve[i].mode];
          break;
        }
      }

      staticSprite.alpha = opacity;
      staticSprite.blendMode = blendMode;

      requestAnimationFrame(animateStatic);
    } else {
      // Smooth, consistent end: short fade after completion
      if (!finalFadeStarted) {
        finalFadeStarted = true;
        finalFadeStartTs = ts || performance.now();
      }
      const t = Math.min(1, ((ts || performance.now()) - finalFadeStartTs) / finalFadeMs);
      staticSprite.blendMode = PIXI.BLEND_MODES.NORMAL;
      staticSprite.alpha = 0.9 * (1 - t);
      if (t < 1) {
        requestAnimationFrame(animateStatic);
      } else {
        // remove sprite and video element
        try { screenContainer.removeChild(staticSprite); } catch (e) {}
        if (staticVideo.parentNode) {
          staticVideo.parentNode.removeChild(staticVideo);
        }
      }
    }
  }
  
  staticVideo.addEventListener('loadedmetadata', () => {
    try {
      const playAttempt = staticVideo.play();
      if (playAttempt && typeof playAttempt.catch === 'function') {
        playAttempt.catch(() => {
          try {
            staticVideo.muted = true;
            staticVideo.play().catch(() => {});
          } catch (err) {}
        });
      }
    } catch (e) {}
    requestAnimationFrame(animateStatic);
  });
}


  // Arrow key navigation for gallery detail images
  document.addEventListener('keydown', (e) => {
    if (!detailEl || detailEl.style.display === 'none') return;
    const slug = slugFromPath();
    const item = items.find((it) => it.slug === slug);
    const mediaEntries = getMediaList(item);
    if (!item || mediaEntries.length <= 1) return;

    let idx = parseInt(detailImg.dataset.index || '0', 10);
    if (Number.isNaN(idx)) idx = 0;
    if (e.key === 'ArrowRight') {
      idx = (idx + 1) % mediaEntries.length;
    } else if (e.key === 'ArrowLeft') {
      idx = (idx - 1 + mediaEntries.length) % mediaEntries.length;
    } else {
      return;
    }
    setDetailMedia(item, idx);
    const strip = detailEl.querySelector('.detail-previews');
    if (strip) {
      [...strip.querySelectorAll('img')].forEach((el, i) => {
        el.style.opacity = i === idx ? '1' : '0.5';
      });
    }
  });

  // Keyboard control for PVM OSD menu
  document.addEventListener('keydown', (e) => {
    try {
      if (!isPvmMenuVisible || typeof isPvmMenuVisible !== 'function') return;
      if (!isPvmMenuVisible()) return;
      const k = e.key;
      if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'Enter' || k === 'Backspace' || k === 'Escape') {
        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
        if (k === 'ArrowUp') handleUpDown('up');
        else if (k === 'ArrowDown') handleUpDown('down');
        else if (k === 'Enter') handleEnter();
        else if (k === 'Backspace' || k === 'Escape') handleMenu();
      }
    } catch (_) {}
  });

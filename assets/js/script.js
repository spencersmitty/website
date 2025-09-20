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

// global pixi.js app for the main screen content
let screenApp = null;
let mediaSprite = null;

// global references for the grey square and grid image
let pvmGridSprite = null;
let screenContainer = null;

// global variable to track the fade-in animation frame
let gridFadeInFrameId = null;

// black bar overlay for 16:9 mode (pixi version)
let letterboxBars = null;

// dynamic media glow overlay

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
  return 0.2;
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
  overlay.style.backgroundImage = "url('assets/images/phosphor.png')";
  overlay.style.backgroundRepeat = 'repeat';
  overlay.style.backgroundSize = '10px 10px';
  overlay.style.opacity = phosphorOn ? '0.2' : '0';
  overlay.style.pointerEvents = 'none';
  overlay.style.zIndex = '2';
  // re-enable clip-path for masking
  overlay.style.clipPath = 'url(#screen-clip)'; // adjust if your mask uses a different id
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
    if (overlay) overlay.style.opacity = (!body.classList.contains('power-off') && phosphorOn) ? '0.2' : '0';
  } catch (e) { /* ignore */ }

  if (screenApp && screenApp.stage) {
    // do not enable bloom while power is off
    if (!body.classList.contains('power-off') && bloomOn) {
      if (_ensureBloomFilter()) {
        if (typeof bloomFilter.blur === 'number') bloomFilter.blur = 5;
        if (typeof bloomFilter.bloomBlur === 'number') bloomFilter.bloomBlur = 5;
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
  (function setupFirstInteractionUnmute(){
    let done = false;
    function tryResumeAudio() {
      let succeeded = false;
      try {
        if (pvmGridSprite && pvmGridSprite.mediaType === 'media' && pvmGridSprite.mediaEl) {
          const media = pvmGridSprite.mediaEl;
          media.muted = false;
          const playback = media.play();
          if (playback && typeof playback.catch === 'function') playback.catch(() => {});
          succeeded = true;
        }
      } catch (e) {}
      try {
        if (window.audioLoop && window.audioLoop.resume) {
          window.audioLoop.resume();
          succeeded = true;
        }
      } catch (e) {}
      return succeeded;
    }
    function cleanup() {
      window.removeEventListener('pointerdown', handler, true);
      window.removeEventListener('keydown', handler, true);
      window.removeEventListener('touchstart', handler, true);
    }
    function handler() {
      if (done) return;
      if (!tryResumeAudio()) return;
      done = true;
      cleanup();
    }
    window.addEventListener('pointerdown', handler, true);
    window.addEventListener('keydown', handler, true);
    window.addEventListener('touchstart', handler, true);
  })();
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
    setCrtEffectsOpacity(0);
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
  fetch('assets/images/pvm.svg')
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
              // Swap directions so Up = next (future), Down = previous (past)
              up: () => changeChannel(-1),
              down: () => changeChannel(1),
            };
            Object.keys(PVM_BUTTON_ACTIONS).forEach((id) => {
              const btn = pvmSvg.getElementById(id);
              if (!btn) return;
              btn.style.cursor = 'pointer';
              btn.style.pointerEvents = 'all';
              btn.addEventListener('click', (e) => {
                e.preventDefault();
                if (body.classList.contains('power-off')) return;
                try { PVM_BUTTON_ACTIONS[id](); } catch (err) {}
              });
            });
          } else {
            console.error('svg screen element not found, cannot make it clickable.');
          }
          setToggleLightsToDefault();
          setupToggleLightButtons(pvmSvg);
          setSvgLightsPowerState(pvmSvg, !body.classList.contains('power-off'));
          createGreyOverlay();
          // createPhosphorOverlay(pvmSvg); // now handled in DOMContentLoaded init area
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
    scanlinesElement.style.zIndex = '3'; 
    scanlinesElement.style.pointerEvents = 'none';
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
    if (overlay) overlay.style.opacity = body.classList.contains('power-off') ? '0' : (phosphorOn ? '0.2' : '0');
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
      bloomFilter = new PIXI.filters.BloomFilter(5, 5, 0, 7);
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
  // cancel any ongoing grid fade-in animation
  if (gridFadeInFrameId !== null) {
    cancelAnimationFrame(gridFadeInFrameId);
    gridFadeInFrameId = null;
  }
  body.classList.add('power-off');
  localStorage.setItem('powerEnabled', 'false');
  requestGreyOverlayRefresh();
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
  if (pvmGridSprite && pvmGridSprite.mediaEl) {
    pvmGridSprite.mediaEl.muted = true;
  }
  // stop decoupled audio if running
  try { if (window.audioLoop && window.audioLoop.stop) window.audioLoop.stop(); } catch (e) {}
  // Hide the phosphor effect when off (legacy references removed)
  const phosphorOverlay = document.querySelector('.phosphor');
  if (phosphorOverlay) { phosphorOverlay.style.opacity = '0'; }
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
  // Play power-on sound from preloaded element
  const powerOnAudio = document.getElementById('poweron-audio');
  if (powerOnAudio) {
    powerOnAudio.currentTime = 0;
    powerOnAudio.volume = 0.2;
    powerOnAudio.play();
  }
  body.classList.remove('power-off');
  localStorage.setItem('powerEnabled', 'true');
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
    pvmGridSprite.alpha = 0;
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
    const baseForPower = 0.2;
    function animateNonLinearFade(now) {
      if (!fadeStartTime) fadeStartTime = now;
      const elapsed = now - fadeStartTime;
      if (body.classList.contains('power-off')) {
        gridFadeInFrameId = null;
        pvmGridSprite.alpha = 0;
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
      pvmGridSprite.alpha = Math.min(alpha, 1);
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
        pvmGridSprite.alpha = 1;
        setCrtEffectsOpacity(1);
        // ensure dom phosphor overlay ends at its target value
        try {
          const overlay = document.querySelector('.phosphor');
          if (overlay) overlay.style.opacity = phosphorOn ? '0.2' : '0';
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
    // Start playing immediately and keep muted by default
    pvmGridSprite.mediaEl.muted = true;
    pvmGridSprite.mediaEl.volume = 1;
    pvmGridSprite.mediaEl.play();
  }
  // kick off decoupled audio loop for current media (requires user gesture; power click provides it)
  try {
    const name = pvmGridSprite && pvmGridSprite.mediaName;
    const url = (window.getAudioUrlForVideo && name) ? window.getAudioUrlForVideo(name) : null;
    if (url && window.audioLoop && window.audioLoop.play) window.audioLoop.play(url);
  } catch (e) {}
  // safety: ensure dom phosphor matches its toggle
  try {
    const overlay = document.querySelector('.phosphor');
    if (overlay) overlay.style.opacity = phosphorOn ? String(getPhosphorBaseOpacity()) : '0';
  } catch (e) { /* ignore */ }
  // Do NOT forcibly enable scanlines, phosphor, vignette, or sunlight effects here.
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
    const tooltip = sunlightKnob.querySelector('.knob-tooltip');
    if (tooltip) tooltip.textContent = window.sunlightOn ? 'SUNLIGHT: ON' : 'SUNLIGHT: OFF';
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
          // allow mechanical toggle when power is off: toggle internal state and
          // apply the underlying effect state (so it will be active when power
          // is restored), but do not update visual light opacity while off.
          if (body.classList.contains('power-off')) {
            toggleLightState[id] = !toggleLightState[id];
            // apply effect state so it will be active when power is restored
            if (BUTTON_EFFECTS && BUTTON_EFFECTS[btnId]) BUTTON_EFFECTS[btnId]();
            return;
          }
          toggleLightState[id] = !toggleLightState[id];
          const el = pvmSvg.getElementById(id);
          if (el) {
            el.style.transition = 'opacity 0.1s ease-out';
            el.style.opacity = toggleLightState[id] ? '1' : '0';
          }
          // trigger effect
          if (BUTTON_EFFECTS && BUTTON_EFFECTS[btnId]) BUTTON_EFFECTS[btnId]();
          // do not show status popup for lighted buttons
        };
        btn._hasToggleLightHandler = true;
      }
    }
  }
  // effect button logic (aperature, bright, chroma, phase, contrast, volume)
  const effectButtonMap = {
    'aperature': {
      toggle: toggleScanlines,
      label: 'scanlines',
      getState: () => scanlinesOn
    },
    'bright': {
      toggle: toggleSunlight,
      label: 'sunlight',
      getState: () => (typeof window.sunlightOn === 'undefined' ? true : window.sunlightOn)
    },
    'chroma': {
      toggle: togglePhosphor,
      label: 'phosphor',
      getState: () => phosphorOn
    },
    'phase': {
      toggle: toggleVignette,
      label: 'vignette',
      getState: () => {
        const overlay = document.querySelector('.vignette-overlay');
        return overlay && (overlay.style.opacity === '' || overlay.style.opacity === '1');
      }
    },
    'contrast': {
      toggle: toggleBloom,
      label: 'bloom',
      getState: () => bloomOn
    },
    'volume': {
      toggle: toggleVolume,
      label: 'volume',
      getState: () => (pvmGridSprite && pvmGridSprite.mediaType === 'media' && pvmGridSprite.mediaEl && !pvmGridSprite.mediaEl.muted)
    },
  };
  for (const btnId in effectButtonMap) {
    const btn = pvmSvg.getElementById(btnId);
    if (btn) {
      const { label, getState } = effectButtonMap[btnId];
      btn.onmouseenter = null;
      btn.onmouseleave = null;
      btn.onclick = () => {
        // if tv is powered off, do nothing (no click, no tooltip)
        if (body.classList.contains('power-off')) return;

        if (btnId === 'bright') {
          const isDark = body.classList.contains('dark-mode');
          if (isDark) {
            showEffectStatusMessage('', '', `<span style=\"font-size:10pt;\">sunlight: <b>off</b></span><br><span style=\"font-size:8pt;font-style:italic;opacity:0.8;\">the sun has set</span>`);
            return;
          } else {
            effectButtonMap[btnId].toggle();
            showEffectStatusMessage(label, getState());
            return;
          }
        }
        effectButtonMap[btnId].toggle();
        if (btnId !== 'bright') {
          showEffectStatusMessage(label, getState());
        }
      };
      btn.style.cursor = 'pointer';
      btn.style.pointerEvents = 'all';
      // also ensure hover/tooltips do nothing when power is off
      btn.onmouseenter = () => { if (body.classList.contains('power-off')) return; };
      btn.onmouseleave = () => { if (body.classList.contains('power-off')) return; };
      btn._hasToggleLightHandler = true;
    }
  }
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
}

function setCrtEffectsOpacity(alpha) {
  // drive scanlines + canvas opacity; phosphor tracks grid alpha via ticker
  const scanlinesElement = document.querySelector('.scanlines');
  if (scanlinesElement) scanlinesElement.style.opacity = alpha;
  const pixiCanvas = document.querySelector('.pvm-pixi-canvas');
  if (pixiCanvas) pixiCanvas.style.opacity = alpha;
}

// update overlay position/size on window resize (debounced)
function _doResizeWork() {
  createGreyOverlay();
  updatePvmGridTransform();
  updateGlowReflectionWidth();
}

function _debounce(fn, delay = 120) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), delay);
  };
}

window.addEventListener('resize', _debounce(_doResizeWork, 120));

// Helper to set overlay opacity
// Remove setGreyOverlayOpacity function entirely

// small helpers for polish
function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
function createBlueOnlyFilter() {
  if (!window.PIXI || !PIXI.filters) return null;
  const m = new PIXI.filters.ColorMatrixFilter();
  m.matrix = [
    0, 0, 0, 0, 0,
    0, 0, 0, 0, 0,
    0, 0, 1, 0, 0,
    0, 0, 0, 1, 0
  ];
  return m;
}

// --- EFFECTS FOR FRONT PANEL BUTTONS ---
// Helper: ensure pixi-filters is loaded (add <script src="https://cdn.jsdelivr.net/npm/pixi-filters@latest/dist/pixi-filters.min.js"></script> to your HTML)

function triggerGlitchEffect(duration = 60) {
  if (!window.PIXI || !window.PIXI.filters || !pvmGridSprite) return;
  const glitch = new PIXI.filters.GlitchFilter();
  const colorMatrix = new PIXI.filters.ColorMatrixFilter();
  // apply a random color shift for the glitch
  colorMatrix.matrix = [
    1, 0.2 - Math.random() * 0.4, 0.2 - Math.random() * 0.4, 0, 0,
    0.2 - Math.random() * 0.4, 1, 0.2 - Math.random() * 0.4, 0, 0,
    0.2 - Math.random() * 0.4, 0.2 - Math.random() * 0.4, 1, 0, 0,
    0, 0, 0, 1, 0
  ];
  const blur = new PIXI.filters.BlurFilter();
  blur.blur = 2 + Math.random() * 2; // 2-4px blur

  // build filter stack; if Blue Only is active, append its matrix LAST so it tints the final output
  const filters = [glitch, colorMatrix, blur];
  if (isBlueOnly) {
    const blueMatrix = createBlueOnlyFilter();
    if (blueMatrix) filters.push(blueMatrix);
  }
  pvmGridSprite.filters = filters;

  // after the transient effect, restore Blue Only if it was on; otherwise clear filters
  setTimeout(() => {
    if (isBlueOnly) {
      const blueMatrix = createBlueOnlyFilter();
      if (blueMatrix) { pvmGridSprite.filters = [blueMatrix]; } else { pvmGridSprite.filters = []; }
    } else {
      pvmGridSprite.filters = [];
    }
  }, duration);
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
    pvmGridSprite.filters = filters;
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
        if (blueMatrix) { pvmGridSprite.filters = [blueMatrix]; } else { pvmGridSprite.filters = []; }
      } else {
        pvmGridSprite.filters = [];
      }
    }
  }
  requestAnimationFrame(animateRoll);
}

function triggerBlueOnly(on) {
  if (!window.PIXI || !pvmGridSprite) return;
  if (on) {
    const blue = createBlueOnlyFilter();
    pvmGridSprite.filters = blue ? [blue] : [];
  } else {
    pvmGridSprite.filters = [];
  }
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

function triggerDegaussEffect(duration = 60) {
  if (!pvmGridSprite) return;
  let start = null;
  const origX = pvmGridSprite.x, origY = pvmGridSprite.y;
  const origScaleX = pvmGridSprite.scale.x, origScaleY = pvmGridSprite.scale.y;
  // add blur filter and preserve Blue Only if active
  let blur;
  if (window.PIXI && PIXI.filters) {
    blur = new PIXI.filters.BlurFilter();
    blur.blur = 2 + Math.random() * 2;
    const filters = [blur];
    if (isBlueOnly && window.PIXI && PIXI.filters) {
      const blueMatrix = createBlueOnlyFilter();
      if (blueMatrix) filters.push(blueMatrix);
    }
    pvmGridSprite.filters = filters;
  }
  function animateWobble(ts) {
    if (!start) start = ts;
    const elapsed = ts - start;
    const phase = Math.sin((elapsed / duration) * Math.PI * 4);
    pvmGridSprite.x = origX + Math.sin(phase) * 8;
    pvmGridSprite.y = origY + Math.cos(phase) * 8;
    pvmGridSprite.scale.x = origScaleX + Math.sin(phase) * 0.04;
    pvmGridSprite.scale.y = origScaleY + Math.cos(phase) * 0.04;
    if (elapsed < duration) {
      requestAnimationFrame(animateWobble);
    } else {
      pvmGridSprite.x = origX;
      pvmGridSprite.y = origY;
      pvmGridSprite.scale.x = origScaleX;
      pvmGridSprite.scale.y = origScaleY;
      // remove blur filter, restore Blue Only if needed
      if (isBlueOnly && window.PIXI && PIXI.filters) {
        const blueMatrix = createBlueOnlyFilter();
        if (blueMatrix) { pvmGridSprite.filters = [blueMatrix]; } else { pvmGridSprite.filters = []; }
      } else {
        pvmGridSprite.filters = [];
      }
    }
  }
  requestAnimationFrame(animateWobble);
}

// hook up effects in setupToggleLightButtons
const BUTTON_EFFECTS = {
  'a-rgb': () => triggerGlitchEffect(),
  'b-component': () => triggerGlitchEffect(),
  'line-rgb': () => triggerGlitchEffect(),
  'c-sdi': () => triggerGlitchEffect(),
  'ext-sync': () => triggerVerticalRoll(),
  'blue-only': () => { isBlueOnly = !isBlueOnly; triggerBlueOnly(isBlueOnly); },
  '16-9': () => triggerAspectRatioToggle(),
  'hv-delay': () => triggerHvDelayToggle(),
  'underscan': () => triggerUnderscanToggle(),
  'degauss': () => triggerDegaussEffect(),
};

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
    msg.style.fontSize = '10pt';
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
  // apply transforms to container
  screenContainer.scale.set(scaleX, scaleY);
  screenContainer.x = (baseW - baseW * scaleX) / 2 + x;
  screenContainer.y = (baseH - baseH * scaleY) / 2 + y;
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
  const mediaPath = 'assets/videos/' + filename;
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
      fallbackVideo.src = 'assets/videos/static/static-long.mp4';
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
  try { showStaticOverlay(true, 'assets/videos/static/static-short.mp4'); } catch (e) {}
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
      // use fadeEffect to match original timing/transition behavior (exact old call)
      fadeEffect(overlay, phosphorOn, '0.2');
    }
  } catch (e) { /* ignore */ }
  // do not persist phosphor state
}

function _ensureBloomFilter() {
  if (!screenApp || !screenApp.stage) return false;
  if (!bloomFilter) {
    try {
      bloomFilter = new PIXI.filters.BloomFilter(0, 5, 0, 7); // start at 0 for fade-in
    } catch (e) {
      console.error('unable to create bloom filter', e);
      return false;
    }
  }
  // ensure stage has only our bloom filter; this app uses stage.filters exclusively for bloom
  screenApp.stage.filters = [bloomFilter];
  return true;
}

function _animateBloomBlur(targetBlur = 5, durationMs = 150) {
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
      // start from 0 and fade to 5
      if (typeof bloomFilter.blur === 'number') bloomFilter.blur = 0;
      if (typeof bloomFilter.bloomBlur === 'number') bloomFilter.bloomBlur = 0;
      _animateBloomBlur(5, 120);
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
      const startBlur = typeof bloomFilter.blur === 'number' ? bloomFilter.blur : 5;
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
  const landingHref = (typeof window.__galleryLanding === 'string')
    ? window.__galleryLanding
    : (useCollections ? 'index.html' : 'gallery.html');
  const landingUrl = (typeof window.__galleryLandingUrl === 'string')
    ? window.__galleryLandingUrl
    : (useCollections ? '/' : '/gallery/');

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
    if (isFileProtocol) {
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

    // compute once now; if image isn't ready yet, recompute on load
    updateZoomCapability();
    if (!img.complete || !img.naturalWidth) {
      img.addEventListener('load', updateZoomCapability, { once: true });
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

  function navigateTo(slug, replace = false) {
    const run = () => {
      if (useCollections) {
        const col = currentCollection || collectionNames[0] || 'gallery';
        const hash = `#${col}/${slug}`;
        if (replace) {
          history.replaceState({ slug, col }, '', hash);
        } else {
          history.pushState({ slug, col }, '', hash);
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
        history.replaceState({ slug }, '', url);
      } else {
        history.pushState({ slug }, '', url);
      }
      renderDetail(slug);
    };
    return runGalleryTransition(run);
  }

  function navigateHome(replace = false) {
    const run = () => {
      if (useCollections) {
        const col = currentCollection || collectionNames[0] || 'gallery';
        const hash = `#${col}`;
        if (replace) {
          history.replaceState({ col }, '', hash);
        } else {
          history.pushState({ col }, '', hash);
        }
        renderGrid();
        return;
      }
      if (isFileProtocol) {
        if (replace) {
          location.replace(landingHref);
        } else {
          location.hash = '';
        }
        renderGrid();
        return;
      }
    const baseUrl = normalizedRouteBase || '/gallery';
    const url = `${baseUrl}/`;
      if (replace) {
        history.replaceState({}, '', url);
      } else {
        history.pushState({}, '', url);
      }
      renderGrid();
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
  } else if (isFileProtocol) {
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
      const render = () => { if (slug) renderDetail(slug); else renderGrid(); };
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
        const baseUrl = normalizedRouteBase || '/gallery';
        history.replaceState({ slug: initialSlug }, '', `${baseUrl}/${initialSlug}/`);
      }
    } else {
      renderGrid();
      if (!isFileProtocol) {
        const baseUrl = normalizedRouteBase || '/gallery';
        history.replaceState({}, '', `${baseUrl}/`);
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
  const staticSrc = srcOverride || (window.getStaticIntroSrc && window.getStaticIntroSrc()) || 'assets/videos/static-short.mp4';
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

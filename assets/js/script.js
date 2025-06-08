/* main script */

// dom references
const body = document.body;
const pvmSvgContainer = document.getElementById('pvm-svg-container');

// global pixi.js app for the main screen content
let screenApp = null;
let videoSprite = null;

// global references for the grey square and grid image
let pvmGridSprite = null;
let screenContainer = null;

// global variable to track the fade-in animation frame
let gridFadeInFrameId = null;

// black bar overlay for 16:9 mode (pixi version)
let letterboxBars = null;

// dynamic video glow overlay
let dynamicGlowCanvas = null;
let dynamicGlowInterval = null;
let prevGlowColor = { r: 0, g: 0, b: 0, initialized: false };

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

let bloomFilter = null;

// initialize when dom is loaded
window.addEventListener('DOMContentLoaded', () => {
  // core initialization
  initDarkModeHandler();
  createGreyOverlay();
  loadPvmSvg();
  initPowerManagement();
  initMessageAnimation();
  // hide crt effects and show grey square if tv is off on page load
  if (body.classList.contains('power-off')) {
    setCrtEffectsOpacity(0);
    ensureGreySquareForPowerOff();
  }
  loadButtonStates();

  // Mobile tap hand: show after 15 seconds, only on mobile
  const tapGraphic = document.querySelector('.mobile-tap-graphic');
  if (tapGraphic) {
    tapGraphic.classList.remove('show-tap-graphic');
    if (window.matchMedia('(max-width: 600px)').matches) {
      setTimeout(() => {
        console.log('Showing tap hand graphic!');
        tapGraphic.classList.add('show-tap-graphic');
      }, 15000);
    }
  }
});

// load pvm svg dynamically
// ========================

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
  overlay.style.background = '#282828';
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

function loadPvmSvg() {
  fetch('assets/images/pvm.svg')
    .then(response => response.text())
    .then(svgText => {
      if (pvmSvgContainer) {
        pvmSvgContainer.innerHTML = svgText;
        const svgDoc = pvmSvgContainer.querySelector('svg');
        if (svgDoc) {
          const svgScreenElement = svgDoc.getElementById('screen');
          
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
            console.log('svg screen path is now a clickable link.');

            // tally light hover effect
            const tallyLightElement = svgDoc.getElementById('tally-light');
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
              console.log('tally light hover effect initialized.');
            } else if (!tallyLightElement) {
              console.warn('tally light element (id: tally-light) not found in svg.');
            }

            initScreenEffects(svgScreenElement);
            
            // call setup functions after svg is loaded into the dom
            setupSvgPower(svgDoc);
            setTimeout(() => {
              const bodyIsDark = body.classList.contains('dark-mode');
              console.log('[dm] loadpvmsvg (settimeout): calling setsvgmode. body class dark-mode is:', bodyIsDark);
              setSvgMode(bodyIsDark);
            }, 0);

            // set initial pointer events and cursor for the screen based on power state
            if (body.classList.contains('power-off')) {
              svgScreenElement.style.pointerEvents = 'none';
              svgScreenElement.style.cursor = 'default';
            } else {
              svgScreenElement.style.pointerEvents = 'auto';
              svgScreenElement.style.cursor = 'pointer';
            }

            // set hand cursor for up, down, menu, and enter buttons
            const handCursorIds = ['up', 'down', 'menu', 'enter'];
            handCursorIds.forEach(id => {
              const btn = svgDoc.getElementById(id);
              if (btn) {
                btn.style.cursor = 'pointer';
                btn.style.pointerEvents = 'all';
              }
            });
          } else {
            console.error('svg screen element not found, cannot make it clickable.');
          }
          setToggleLightsToDefault();
          setupToggleLightButtons(svgDoc);
          setSvgLightsPowerState(svgDoc, !body.classList.contains('power-off'));
          createGreyOverlay();
          createPhosphorOverlay(svgDoc);
        }
      }
    })
    .catch(error => console.error('error loading pvm svg:', error));
}

// Initialize screen effects (video, scanlines, vignette, phosphor)
// ===============================================================

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
  console.log('pixi app configured - z-index: 1');

  const scanlinesElement = pvmContainerElement.querySelector('.scanlines');
  if (scanlinesElement) {
    scanlinesElement.style.position = 'absolute';
    scanlinesElement.style.left = `${pixiAppLeft}px`;
    scanlinesElement.style.top = `${pixiAppTop}px`;
    scanlinesElement.style.width = `${pixiAppWidth}px`;
    scanlinesElement.style.height = `${pixiAppHeight}px`;
    scanlinesElement.style.zIndex = '3'; 
    scanlinesElement.style.pointerEvents = 'none';
    console.log('scanlines element positioned and styled - z-index: 3');
  }

  const phosphorElement = pvmContainerElement.querySelector('.phosphor');
  if (phosphorElement) {
    phosphorElement.style.position = 'absolute';
    phosphorElement.style.left = `${pixiAppLeft}px`;
    phosphorElement.style.top = `${pixiAppTop}px`;
    phosphorElement.style.width = `${pixiAppWidth}px`;
    phosphorElement.style.height = `${pixiAppHeight}px`;
    phosphorElement.style.zIndex = '2'; 
    phosphorElement.style.pointerEvents = 'none';
    console.log('phosphor element positioned and styled - z-index: 2');
  }

  // create container
  const baseW = screenApp.screen.width;
  const baseH = screenApp.screen.height;
  screenContainer = new PIXI.Container();
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
  }

  initVideoGlowEffect(screenApp);
  console.log('bloom and video glow effects initialized after grid sprite.');

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
  if (bloomOn && screenApp && screenApp.stage) {
    const bloom = new PIXI.filters.BloomFilter(5, 5, 0, 7);
    screenApp.stage.filters = [bloom];
  }
}

// Power Management
// ===============

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
  setToggleLightsToDefault();
  setSvgLightsPowerState(pvmSvg, false);
  if (pvmGridSprite && pvmGridSprite.videoEl) {
    pvmGridSprite.videoEl.pause();
  }
  // hide the phosphor effect when off
  const phosphorImagesOff = document.querySelectorAll('#phosphor-image');
  phosphorImagesOff.forEach(img => {
    img.setAttribute('opacity', '0');
  });
  // after power off logic
  const svgDocOff = document.querySelector('#pvm-svg-container svg');
  if (svgDocOff) {
    const screenPath = svgDocOff.getElementById('screen');
    if (screenPath) {
      screenPath.setAttribute('fill-opacity', '0');
    }
  }
  debugPhosphorState();
  const overlayOn = document.querySelector('.phosphor');
  if (overlayOn) overlayOn.style.opacity = '0';
  const overlayOff = document.querySelector('.phosphor');
  if (overlayOff) overlayOff.style.opacity = '0';
}

function debugPhosphorState() {
  const svg = document.querySelector('#pvm-svg-container svg');
  if (!svg) {
    console.log('no svg found.');
    return;
  }
  // count patterns
  const patterns = svg.querySelectorAll('pattern#phosphorPattern');
  console.log('number of phosphorPattern elements:', patterns.length);

  // check screen path
  const screen = svg.getElementById('screen');
  if (screen) {
    console.log('screen fill:', screen.getAttribute('fill'));
    console.log('screen fill-opacity:', screen.getAttribute('fill-opacity'));
  } else {
    console.log('no screen path found.');
  }

  // count grid images
  const gridImages = svg.querySelectorAll('#grid-image');
  console.log('number of grid-image elements:', gridImages.length);

  // list all direct children of svg for visual inspection
  console.log('svg children:', Array.from(svg.children).map(el => el.tagName + (el.id ? `#${el.id}` : '')));
}

// function to turn on the tv
function turnOnTV() {
  body.classList.remove('power-off');
  localStorage.setItem('powerEnabled', 'true');
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
      if (elapsed < totalDuration) {
        gridFadeInFrameId = requestAnimationFrame(animateNonLinearFade);
      } else {
        pvmGridSprite.alpha = 1;
        setCrtEffectsOpacity(1);
        gridFadeInFrameId = null;
      }
    }
    gridFadeInFrameId = requestAnimationFrame(animateNonLinearFade);
  }
  // show crt effect layers (scanlines, phosphor, etc.)
  const scanlinesElement = document.querySelector('.scanlines');
  if (scanlinesElement) scanlinesElement.style.display = '';
  const phosphorElement = document.querySelector('.phosphor');
  if (phosphorElement) phosphorElement.style.display = '';
  // enable chat interactivity
  const chatElement = document.getElementById('chat');
  if (chatElement) {
    chatElement.style.pointerEvents = 'auto';
    chatElement.style.cursor = 'pointer';
    chatElement.removeAttribute('aria-disabled');
    chatElement.tabIndex = 0;
  }
  setToggleLightsToDefault();
  setSvgLightsPowerState(pvmSvg, true);
  if (pvmGridSprite && pvmGridSprite.videoEl) {
    pvmGridSprite.videoEl.play();
  }
  
  const phosphorImagesOn = document.querySelectorAll('#phosphor-image');
  phosphorImagesOn.forEach(img => {
    img.setAttribute('opacity', phosphorOn ? '0.2' : '0');
  });
  
  const svgDocOn = document.querySelector('#pvm-svg-container svg');
  if (svgDocOn) {
    const screenPath = svgDocOn.getElementById('screen');
    if (screenPath) {
      screenPath.setAttribute('fill-opacity', phosphorOn ? '0.2' : '0');
    }
  }
  debugPhosphorState();
  const overlayOn = document.querySelector('.phosphor');
  if (overlayOn) overlayOn.style.opacity = phosphorOn ? '0.2' : '0';
  const overlayOff = document.querySelector('.phosphor');
  if (overlayOff) overlayOff.style.opacity = '0';
}

// message animation
// ================

// animation for the message text
function initMessageAnimation() {
  const messageElement = document.querySelector('.message');
  const hiddenTextElement = document.querySelector('.hidden-text');
  if (!messageElement) return;
  
  const text = messageElement.textContent;
  messageElement.textContent = '';
  
  // create spans for each character with animation delays
  [...text].forEach((char, i) => {
    const span = document.createElement('span');
    span.innerHTML = char === ' ' ? '&nbsp;' : char;
    span.style.animationDelay = `${i * 0.08}s, ${i * 0.08}s`;
    span.style.setProperty('--char-index', i);
    messageElement.appendChild(span);
  });
  
  // apply the same animation to the hidden text
  if (hiddenTextElement) {
    hiddenTextElement.textContent = text;
    
    // no need for character-by-character animation on the reflection
    const middleIndex = Math.floor(text.length / 2);
    const middleDelay = `${middleIndex * 0.08}s, ${middleIndex * 0.08}s`;
    hiddenTextElement.style.animationDelay = middleDelay;
  }
}

// dark mode handler
// ==============

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
  }
  window.setSvgMode = setSvgMode;

  // listen for changes in color scheme preference
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
    if (e.matches) {
      body.classList.add('dark-mode');
    } else {
      body.classList.remove('dark-mode');
    }
    window.setSvgMode(e.matches);
    updateSunlightVisibility();
  });
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', updateSunlightVisibility);
  updateSunlightVisibility();
}

// sunlight effect
// =============

// function to update sunlight visibility
let _sunlightPrevIsLightMode = null;
function updateSunlightVisibility() {
  const isLightMode = window.matchMedia('(prefers-color-scheme: light)').matches;
  const sunlightEnabled = typeof window.sunlightOn === 'undefined' ? true : window.sunlightOn;
  const videoGlowCanvas = document.querySelector('.video-glow-canvas');
  if (videoGlowCanvas) {
    if (isLightMode && sunlightEnabled) {
      videoGlowCanvas.style.display = 'block';
      if (_sunlightPrevIsLightMode === false) {
        // only fade in if switching from dark to light
        videoGlowCanvas.style.opacity = '0';
        requestAnimationFrame(() => {
          videoGlowCanvas.style.opacity = '0.7';
        });
      } else {
        // on first load or already in light mode, set instantly
        videoGlowCanvas.style.opacity = '0.7';
      }
    } else {
      // fade out, then hide
      videoGlowCanvas.style.opacity = '0';
      videoGlowCanvas.addEventListener('transitionend', function handler(e) {
        if (e.propertyName === 'opacity' && videoGlowCanvas.style.opacity === '0') {
          videoGlowCanvas.style.display = 'none';
          videoGlowCanvas.removeEventListener('transitionend', handler);
        }
      });
    }
    _sunlightPrevIsLightMode = isLightMode;
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

// initialize video glow effect (sunlight)
function initVideoGlowEffect(screenApp) {
  // remove any existing canvas
  const existingCanvas = document.querySelector('.video-glow-canvas');
  if (existingCanvas) {
    existingCanvas.remove();
  }
  
  if (!screenApp) {
    console.error('screen pixi.js app not available for video glow effect.');
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
    console.log('[vge] screenPathRect:', JSON.stringify(screenPathRect));
    console.log('[vge] containerRect:', JSON.stringify(containerRect));

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
      console.log('[vge] successfully calculated glow canvas dims: l:', glowCanvasLeft, 't:', glowCanvasTop, 'w:', glowCanvasWidth, 'h:', glowCanvasHeight);
    }
  } catch (e) {
    console.error('[vge] exception during glow canvas dimension calculation:', e, 
                  'screenPathRect details:', screenPathRect, 
                  'containerRect details:', containerRect);
    calculatedDimensionsSuccessfully = false; // ensure flag reflects failure
    // do not return, let it use defaults and log this fact
  }

  if (!calculatedDimensionsSuccessfully) {
    console.warn('[vge] proceeding with default dimensions (l:0, t:0, w:1, h:1) due to calculation issues.');
  }

  // create a canvas for the sunlight effect
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = glowCanvasWidth; 
  glowCanvas.height = glowCanvasHeight; 
  glowCanvas.className = 'video-glow-canvas';
  
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
          console.log('[vge-fringeleft] about to set red fringe. fringeAlpha:', fringeAlpha, 'typeof:', typeof fringeAlpha);
          ctx.fillStyle = `rgba(254, 199, 199, ${fringeAlpha})`; // slightly modified rgb for testing
          ctx.fillRect(beamX + 1, beamY, beamWidth, beamHeight); 
          // blue fringe (offset left)
          console.log('[vge-fringeleft] about to set blue fringe. fringeAlpha:', fringeAlpha, 'typeof:', typeof fringeAlpha);
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
          console.log('[vge-fringeright] about to set red fringe. fringeAlpha:', fringeAlpha, 'typeof:', typeof fringeAlpha);
          ctx.fillStyle = `rgba(254, 199, 199, ${fringeAlpha})`; // slightly modified rgb for testing
          ctx.fillRect(beamX + 1, beamY, beamWidth, beamHeight);
          console.log('[vge-fringeright] about to set blue fringe. fringeAlpha:', fringeAlpha, 'typeof:', typeof fringeAlpha);
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
          if (body.classList.contains('power-off')) return;
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
      getState: () => (pvmGridSprite && pvmGridSprite.mediaType === 'video' && pvmGridSprite.videoEl && !pvmGridSprite.videoEl.muted)
    },
  };
  for (const btnId in effectButtonMap) {
    const btn = pvmSvg.getElementById(btnId);
    if (btn) {
      const { label, getState } = effectButtonMap[btnId];
      btn.onmouseenter = null;
      btn.onmouseleave = null;
      btn.onclick = () => {
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
  // set opacity for scanlines, phosphor, vignette
  const scanlinesElement = document.querySelector('.scanlines');
  if (scanlinesElement) scanlinesElement.style.opacity = alpha;
  const phosphorElement = document.querySelector('.phosphor');
  if (phosphorElement) phosphorElement.style.opacity = alpha;
  const vignetteCanvas = document.querySelector('.pvm-pixi-canvas');
  if (vignetteCanvas) vignetteCanvas.style.opacity = alpha;
}

// update overlay position/size on window resize
window.addEventListener('resize', () => {
  createGreyOverlay();
  updatePvmGridTransform();
});

// Helper to set overlay opacity
// Remove setGreyOverlayOpacity function entirely

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
  pvmGridSprite.filters = [glitch, colorMatrix, blur];
  setTimeout(() => { pvmGridSprite.filters = []; }, duration);
}

function triggerVerticalRoll(duration = 60) {
  if (!pvmGridSprite) return;
  let start = null;
  const origY = pvmGridSprite.y;
  // add blur filter
  let blur;
  if (window.PIXI && PIXI.filters) {
    blur = new PIXI.filters.BlurFilter();
    blur.blur = 2 + Math.random() * 2;
    pvmGridSprite.filters = [blur];
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
      // remove blur filter
      pvmGridSprite.filters = [];
    }
  }
  requestAnimationFrame(animateRoll);
}

function triggerBlueOnly(on) {
  if (!window.PIXI || !pvmGridSprite) return;
  if (on) {
    const matrix = new PIXI.filters.ColorMatrixFilter();
    matrix.matrix = [
      0, 0, 0, 0, 0, // r
      0, 0, 0, 0, 0, // g
      0, 0, 1, 0, 0, // b
      0, 0, 0, 1, 0  // a
    ];
    pvmGridSprite.filters = [matrix];
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
  // add blur filter
  let blur;
  if (window.PIXI && PIXI.filters) {
    blur = new PIXI.filters.BlurFilter();
    blur.blur = 2 + Math.random() * 2;
    pvmGridSprite.filters = [blur];
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
      // remove blur filter
      pvmGridSprite.filters = [];
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
  // handle black bars for 16:9
  if (is169) {
    if (!letterboxBars) {
      letterboxBars = new PIXI.Container();
      letterboxBars.name = 'letterboxBars';
      screenContainer.addChildAt(letterboxBars, 0);
    }
    letterboxBars.removeChildren();
    const topBar = new PIXI.Graphics();
    topBar.beginFill(0x000000, 1);
    topBar.drawRect(0, 0, baseW, barHeight);
    topBar.endFill();
    const botBar = new PIXI.Graphics();
    botBar.beginFill(0x000000, 1);
    botBar.drawRect(0, baseH - barHeight, baseW, barHeight);
    botBar.endFill();
    letterboxBars.addChild(topBar, botBar);
    letterboxBars.visible = true;
  } else if (letterboxBars) {
    letterboxBars.visible = false;
  }
}

function createMediaSprite() {
  const mediaPath = getRandomMedia();
  const isVideo = /\.(mp4|mov|webm)$/i.test(mediaPath);
  let sprite, videoEl = null;
  if (isVideo) {
    videoEl = document.createElement('video');
    videoEl.src = mediaPath;
    videoEl.autoplay = true;
    videoEl.loop = true;
    videoEl.muted = true; // muted by default
    videoEl.playsInline = true;
    videoEl.crossOrigin = 'anonymous';
    videoEl.style.display = 'none';
    document.body.appendChild(videoEl);
    videoEl.load();
    sprite = new PIXI.Sprite(PIXI.Texture.from(videoEl));
    // restore volume state if available
    if (typeof window._restoreVolumeOn === 'boolean') {
      videoEl.muted = !window._restoreVolumeOn;
    }
  } else {
    sprite = new PIXI.Sprite(PIXI.Texture.from(mediaPath));
  }
  // ensure the sprite always fills the screen area
  sprite.width = screenApp.screen.width;
  sprite.height = screenApp.screen.height;
  sprite.x = 0;
  sprite.y = 0;
  sprite.mediaType = isVideo ? 'video' : 'image';
  sprite.videoEl = videoEl;
  return sprite;
}

// effects button mapping
// aperature: scanlines
// bright: sunlight
// chroma: phosphor
// phase: vignette
// contrast: bloom

function fadeEffect(element, show, targetOpacity = '1', display = '') {
  if (!element) return;
  if (show) {
    element.style.display = display;
    requestAnimationFrame(() => {
      element.style.opacity = targetOpacity;
    });
  } else {
    element.style.opacity = '0';
    element.addEventListener('transitionend', function handler(e) {
      if (e.propertyName === 'opacity' && element.style.opacity === '0') {
        element.style.display = 'none';
        element.removeEventListener('transitionend', handler);
      }
    });
  }
}

function toggleScanlines() {
  scanlinesOn = !scanlinesOn;
  const scanlinesElement = document.querySelector('.scanlines');
  fadeEffect(scanlinesElement, scanlinesOn);
}
function togglePhosphor() {
  phosphorOn = !phosphorOn;
  const overlay = document.querySelector('.phosphor');
  fadeEffect(overlay, phosphorOn, '0.2');
}
function toggleBloom() {
  bloomOn = !bloomOn;
  if (screenApp && screenApp.stage) {
    if (bloomOn) {
      const bloom = new PIXI.filters.BloomFilter(5, 5, 0, 7); // instantly enable with blur 2
      screenApp.stage.filters = [bloom];
    } else {
      screenApp.stage.filters = null; // instantly disable
    }
  }
}
function toggleVolume() {
  if (pvmGridSprite && pvmGridSprite.mediaType === 'video' && pvmGridSprite.videoEl) {
    const video = pvmGridSprite.videoEl;
    video.muted = !video.muted;
    showEffectStatusMessage('volume', !video.muted);
  } else {
    showEffectStatusMessage('volume', false, 'no video loaded');
  }
}

// add createPhosphorOverlay function
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

function toggleVignette() {
  const overlay = document.querySelector('.vignette-overlay');
  if (!overlay) return;
  const isOn = overlay.style.opacity === '' || overlay.style.opacity === '1';
  overlay.style.opacity = isOn ? '0' : '1';
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
  if (window.location.pathname === '/chat') {
    openChatbox(false);
  } else {
    closeChatbox(false);
  }
});

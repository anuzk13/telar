(function () {

  const INIT_ORBIT = '0deg 75deg 105%';

  let mv, reduceMotion;
  let container;
  let modelID, baseUrl;
  let triedGltf = false;

  init();

  function init() {
    container = document.getElementById('object-viewer');

    modelID = container.dataset.modelId;
    baseUrl = container.dataset.baseUrl;
    const altText = container.dataset.altText;
    initModelViewer(altText);
    mv.addEventListener('load', function () {
      const modelNav = document.getElementById('modelNav');
      new ModelNav(modelNav);
      const cameraPanel = document.getElementById('cameraPanel');
      const picker = new CameraPicker(cameraPanel);
      mv.addEventListener('camera-change', function () { picker.refresh(); });
      picker.refresh();
    });
    // Check reduction in motion preference for animation
    reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.addEventListener('DOMContentLoaded', function () {
      setCoordinatePanelTheme();
    });
  }

  function initModelViewer(altText) {
    const modelURL = baseUrl + '/telar-content/objects/' + modelID + '.glb';
    mv = document.createElement('model-viewer');
    mv.setAttribute('src', modelURL);
    mv.setAttribute('camera-controls', '');
    mv.setAttribute('camera-orbit', INIT_ORBIT);
    mv.setAttribute('shadow-intensity', '0.5');
    mv.setAttribute('exposure', '1');
    mv.setAttribute('alt', altText);
    mv.addEventListener('error', handleModelExtensionError);
    container.appendChild(mv);
  }

  function handleModelExtensionError() {
    if (!triedGltf) { 
      triedGltf = true;
      mv.setAttribute('src', baseUrl + '/telar-content/objects/' + modelID + '.gltf'); 
    }
  }

  class ModelNav {
    constructor(root) {
      this.root = root;
      root.addEventListener('click', this.onClick.bind(this));
    }

    onClick(event) {
      const btn = event.target.closest('[data-act]');
      if (!btn) return;
      const action = btn.dataset.act;
      if (typeof this[action] === 'function') this[action]();
    }

    'zoom-in'()   { this._zoom(0.82); }
    'zoom-out'()  { this._zoom(1.22); }
    'pan-up'()    { this._pan(0, 1); }
    'pan-down'()  { this._pan(0, -1); }
    'pan-left'()  { this._pan(-1, 0); }
    'pan-right'() { this._pan(1, 0); }
    reset() {
      mv.cameraTarget = 'auto auto auto';
      mv.cameraOrbit = INIT_ORBIT;
      mv.fieldOfView = 'auto';
      this._settle();
    }

    _settle() {
      if (reduceMotion) mv.jumpCameraToGoal();
    }

    _zoom(factor) {
      const o = mv.getCameraOrbit();
      mv.cameraOrbit = o.theta + 'rad ' + o.phi + 'rad ' + Math.max(0.05, o.radius * factor) + 'm';
      this._settle();
    }

    _pan(dx, dy) {
      const o = mv.getCameraOrbit(), t = mv.getCameraTarget();
      const right = { x: Math.cos(o.theta), y: 0, z: -Math.sin(o.theta) };
      const up = { x: -Math.cos(o.phi) * Math.sin(o.theta), y: Math.sin(o.phi), z: -Math.cos(o.phi) * Math.cos(o.theta) };
      const s = o.radius * 0.18;
      mv.cameraTarget =
        (t.x + (right.x * dx + up.x * dy) * s) + 'm ' +
        (t.y + (right.y * dx + up.y * dy) * s) + 'm ' +
        (t.z + (right.z * dx + up.z * dy) * s) + 'm';
      this._settle();
    }
  }

  class CameraPicker {
    constructor(root) {
      this.root = root;
      this.copiedTxt = root.dataset.modelCopyText;
      this.cameraEl = root.querySelector('#cam-camera');
      this.targetEl = root.querySelector('#cam-target');
      root.addEventListener('click', this.onClick.bind(this));
    }

    onClick(event) {
      const btn = event.target.closest('[data-act]');
      if (!btn) return;
      const action = btn.dataset.act;
      if (typeof this[action] === 'function') this[action](btn);
    }

    // Per-triple copies (azimuth/elevation/distance, then target_x/y/z), tab-
    // separated so each value lands in its own spreadsheet cell.
    'copy-cam-camera'(btn) { this._copy(this._cameraVals().join('\t'), btn); }
    'copy-cam-target'(btn) { this._copy(this._targetVals().join('\t'), btn); }
    // All six framing columns at once — they are contiguous in the story schema
    // (azimuth, elevation, distance, target_x, target_y, target_z). Tab-separated
    // for Sheets (six cells); comma-separated for raw CSV (values are plain
    // numbers, no embedded commas).
    'copy-cam-sheets'(btn) { this._copy(this._cameraVals().concat(this._targetVals()).join('\t'), btn); }
    'copy-cam-csv'(btn)    { this._copy(this._cameraVals().concat(this._targetVals()).join(','), btn); }

    refresh() {
      this.cameraEl.textContent = this._cameraVals().join('  ');
      this.targetEl.textContent = this._targetVals().join('  ');
    }
  
    _cameraVals() {
      const o = mv.getCameraOrbit();
      return [this._deg(o.theta), this._deg(o.phi), this._round2(o.radius)];
    }

    _targetVals() {
      const t = mv.getCameraTarget();
      return [this._round2(t.x), this._round2(t.y), this._round2(t.z)];
    }

    _deg(rad)  { return Math.round(rad * 180 / Math.PI * 10) / 10; }
    _round2(n) { return Math.round(n * 100) / 100; }

    _copy(text, btn) {
      navigator.clipboard.writeText(text).then(() => this._flashCopied(btn));
    }

    _flashCopied(btn) {
      btn.classList.add('copied');
      const prevText = btn.getAttribute('title');
      btn.setAttribute('title', this.copiedTxt);
      setTimeout(() => {
        btn.setAttribute('title', prevText);
        btn.classList.remove('copied');
      }, 1200);
    }
  }

  function setCoordinatePanelTheme() {
    // Coordinate panel theme colouring — detect luminance of theme colour
    const panel = document.querySelector('.coordinate-panel');
    if (panel) {
      const bg = getComputedStyle(document.documentElement).getPropertyValue('--color-button-bg').trim();
      if (bg) {
        // Parse hex colour to RGB
        const hex = bg.replace('#', '');
        const r = parseInt(hex.substring(0, 2), 16) / 255;
        const g = parseInt(hex.substring(2, 4), 16) / 255;
        const b = parseInt(hex.substring(4, 6), 16) / 255;
        // WCAG relative luminance
        const lum = 0.2126 * (r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4))
                   + 0.7152 * (g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4))
                   + 0.0722 * (b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4));
        panel.classList.add(lum > 0.179 ? 'coord-light' : 'coord-dark');
      }
    }
  }


})();

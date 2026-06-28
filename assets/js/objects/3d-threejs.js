/**
 * 3D object viewer using three.js PerspectiveCamera GLTFLoader and OrbitControls.
 * 
 * https://github.com/mrdoob/three.js/blob/master/examples/webgl_camera.html
 * https://github.com/mrdoob/three.js/blob/master/examples/webgl_loader_gltf.html
 * 
 */

import { fitCameraToModel, setupNeutralEnvironment } from '../3d-helpers.js';

(function () {

  const THREE = window.THREE;
  const OrbitControls = window.OrbitControls;
  const GLTFLoader = window.GLTFLoader;

  let container, errorContainer, loadingContainer;
  let reduceMotion;
  let camera, scene, renderer, controls;

  const CAMERA_FOV = 45;
  const CAMERA_NEAR = 0.01;
  const CAMERA_FAR = 1000;

  init();

  function init() {

    container = document.getElementById('object-viewer');
    errorContainer = document.getElementById('model-error');
    errorContainer.style.display = 'none';

    loadingContainer = document.getElementById('model-loading');
    loadingContainer.style.display = 'block';

    const modelUrl = container.dataset.modelUrl;

    const aspect = container.clientWidth / container.clientHeight;
    camera = new THREE.PerspectiveCamera( CAMERA_FOV, aspect, CAMERA_NEAR, CAMERA_FAR );

    scene = new THREE.Scene();

    renderer = new THREE.WebGLRenderer( { antialias: true, alpha: true } );
    renderer.setClearAlpha(0);
    renderer.setPixelRatio( window.devicePixelRatio );
    renderer.setSize( container.clientWidth, container.clientHeight );
    renderer.setAnimationLoop( render );
    renderer.toneMapping = THREE.NeutralToneMapping;
    container.appendChild( renderer.domElement );

    setupNeutralEnvironment(renderer, scene);
    loadModel(modelUrl);

    controls = new OrbitControls( camera, renderer.domElement );
    // Respect reduced-motion: damping adds a glide animation to camera moves.
    reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    controls.enableDamping = !reduceMotion;

    window.addEventListener( 'resize', onWindowResize );

    document.addEventListener('DOMContentLoaded', setCoordinatePanelTheme);
  }

  // Wire the nav-bar buttons and the camera-position copy panel once the model
  // is framed. OrbitControls 'change' fires on every camera move (including
  // damping frames), keeping the picker's displayed values live.
  function initControlsUI() {
    new ModelNav(document.getElementById('modelNav'));
    const picker = new CameraPicker(document.getElementById('cameraPanel'));
    controls.addEventListener('change', function () { picker.refresh(); });
    picker.refresh();
  }

  function loadModel (modelUrl) {
    const loader = new GLTFLoader();
    loader.load(
      modelUrl,
      async function (gltf) {
        loadingContainer.style.display = 'none';
        // wait until the model can be added to the scene without blocking due to shader compilation
				await renderer.compileAsync( gltf.scene, camera, scene );
        scene.add(gltf.scene);
        const fit = fitCameraToModel(camera, gltf.scene);
        controls.target.set(fit.target[0], fit.target[1], fit.target[2]);
        controls.minDistance = fit.radius * 0.2;
        controls.maxDistance = fit.distance + fit.radius * 4;
        controls.update();
        controls.saveState();   // capture the framing so nav "reset" returns here
        initControlsUI();
      },
      function () {
        loadingContainer.style.display = 'block';
      },
      function (err) {
        errorContainer.style.display = 'block';
        loadingContainer.style.display = 'none';
      }
    );

  }

  function onWindowResize() {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize( container.clientWidth, container.clientHeight );
    render();
  }

  function render() {
    controls.update();
    renderer.render( scene, camera );
  }

  function readCameraSpherical(camera, target) {
    const offset = camera.position.clone().sub(target);
    const s = new THREE.Spherical().setFromVector3(offset);
    return {
      azimuth: s.theta * 180 / Math.PI,
      elevation: s.phi * 180 / Math.PI,
      distance: s.radius,
    };
  }

  // Nav-bar zoom/pan/reset, driving the three.js camera + OrbitControls. Mirrors
  // the model-viewer ModelNav button contract (data-act → method name).
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
    reset()       { controls.reset(); }

    // Dolly toward/away from the orbit target, clamped to the OrbitControls
    // min/max distance so the model can't be lost or clipped.
    _zoom(factor) {
      const offset = camera.position.clone().sub(controls.target);
      const dist = Math.max(controls.minDistance,
                   Math.min(controls.maxDistance, offset.length() * factor));
      camera.position.copy(controls.target).add(offset.setLength(dist));
      controls.update();
    }

    // Slide camera and target together across the view plane, scaled to the
    // current distance so the gesture feels consistent at any zoom.
    _pan(dx, dy) {
      const step = camera.position.distanceTo(controls.target) * 0.18;
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      const move = new THREE.Vector3()
        .addScaledVector(right, dx * step)
        .addScaledVector(up, dy * step);
      camera.position.add(move);
      controls.target.add(move);
      controls.update();
    }
  }

  // Reads the live camera and copies the six story-schema framing columns
  // (azimuth, elevation, distance, target_x/y/z). Copy/flash logic is identical
  // to the model-viewer picker; only the value sources are three.js-specific.
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
    // All six framing columns at once — contiguous in the story schema. Tab-
    // separated for Sheets (six cells); comma-separated for raw CSV.
    'copy-cam-sheets'(btn) { this._copy(this._cameraVals().concat(this._targetVals()).join('\t'), btn); }
    'copy-cam-csv'(btn)    { this._copy(this._cameraVals().concat(this._targetVals()).join(','), btn); }

    refresh() {
      this.cameraEl.textContent = this._cameraVals().join('  ');
      this.targetEl.textContent = this._targetVals().join('  ');
    }

    _cameraVals() {
      const cam = readCameraSpherical(camera, controls.target);
      return [this._round1(cam.azimuth), this._round1(cam.elevation), this._round2(cam.distance)];
    }

    _targetVals() {
      const t = controls.target;
      return [this._round2(t.x), this._round2(t.y), this._round2(t.z)];
    }

    _round1(n) { return Math.round(n * 10) / 10; }
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

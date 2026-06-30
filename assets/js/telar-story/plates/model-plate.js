/**
 * Telar Story — Model Plate
 *
 * Plate subclass for self-hosted 3D objects rendered with Google's <model-viewer> via WebGL. 
 * 
 */

import { Plate } from './base-plate.js';
import { state } from './../state.js';
import { getBasePath } from './../utils.js';
import { createRenderer, fitCameraToModel, setupNeutralEnvironment } from './../../3d-helpers.js';


/** Load the three.js UMD bundle once (THREE + GLTFLoader + RoomEnvironment). */
let _threePromise;
function loadThree() {
  if (_threePromise) return _threePromise;
  _threePromise = new Promise((resolve, reject) => {
    if (window.THREE) return resolve();
    const s = document.createElement('script');
    s.src = `${getBasePath()}/assets/vendor/umd_threejs.js`;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('three.js failed to load'));
    document.head.appendChild(s);
  });
  return _threePromise;
}


export class ModelPlate extends Plate {

  static containerClass = 'model-plate';
  static deps = loadThree;

  constructor(container, objectId, sceneIndex, zIndex, initialStep) {
    super(container, objectId, sceneIndex, zIndex, initialStep);
    this._renderer = null;
    this._scene = null;
    this._camera = null;
    this._model = null;
    this._autoFraming = null;     // bounding sphere location and framing distance
    this._cameraControl = null;
  }

  /** Build renderer + load the GLB. Resolves when the model's first frame is ready. */
  _build() {
    const THREE = window.THREE;
    const GLTFLoader = window.GLTFLoader;

    const ext = window.modelObjects[this.objectId];
    const url = `${getBasePath()}/telar-content/objects/${this.objectId}.${ext}`;

    this.container.dataset.loading = 'true';

    const renderer = createRenderer(this.container);
    renderer.domElement.className = 'model-instance';

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      45,
      this.container.clientWidth / this.container.clientHeight,
      0.01,
      1000
    );
    setupNeutralEnvironment(renderer, scene);

    this._renderer = renderer;
    this._scene = scene;
    this._camera = camera;

    return new Promise((resolve, reject) => {
      new GLTFLoader().load(
        url,
        (gltf) => {
          if (!this._renderer) return;   // unloaded mid-load
          this._model = gltf.scene;
          scene.add(gltf.scene);
          this._autoFraming = fitCameraToModel(camera, gltf.scene);
          this._cameraControl = new CameraControl(camera, () => this._render());
          this._applyViewOffset();
          delete this.container.dataset.loading;
          this.goToStep(this._currentStep, false);
          this._render();
          resolve();
        },
        undefined,
        (err) => {
          delete this.container.dataset.loading;
          this._injectModelError();
          reject(err);
        }
      );
    });
  }

  _render() {
    this._renderer.render(this._scene, this._camera);
  }

  /**
   * Apply the view offset based on the current layout mode so the model bleeds behind the card view
   */
  _applyViewOffset() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (state.layoutMode === 'vertical') {
      this._camera.setViewOffset(w, h, 0, 0.2 * h, w, h);
    } else {
      this._camera.setViewOffset(w, h, -0.2 * w, 0, w, h);
    }
  }

  /** Free the renderer, GPU resources and WebGL context. */
  _teardown() {
    this._cameraControl?.stopAnimation();

    // threejs.org/manual/#en/how-to-dispose-of-objects
    // TODO: look into a singleton that implements a shared renderer across plates 
    // https://threejs.org/manual/#en/multiple-scenes
    // to show the overlapping plates it could use some baking of the renderer to an image
    this._scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of materials) {
        if (!m) continue;
        for (const key in m) {
          if (m[key] && m[key].isTexture) m[key].dispose();
        }
        m.dispose();
      }
    });
    if (this._scene.environment) this._scene.environment.dispose();

    this._renderer.dispose();
    this._renderer.forceContextLoss();
    this._renderer.domElement.remove();

    this._renderer = null;
    this._scene = null;
    this._camera = null;
    this._model = null;
    this._autoFraming = null;
    this._cameraControl = null;
  }

  /** Stop the camera animation when sent back. */
  onSendBack() {
    this._cameraControl?.stopAnimation();
  }

  /** Move to a step pose: eased on discrete navigation, snapped otherwise. */
  goToStep(step, animate = false) {
    this._currentStep = step;
    if (!this._cameraControl) return;
    const pose = this._resolvePose(step);
    if (animate) this._cameraControl.ease(pose);
    else this._cameraControl.snap(pose);
  }

  /** Interpolate the camera between two steps by scroll progress (no animation). */
  scroll(progress, stepA, stepB) {
    if (!this._cameraControl) return;
    this._cameraControl.lerp(this._resolvePose(stepA), this._resolvePose(stepB), progress);
  }

  /**
   * Resolve a step's framing columns to a numeric pose
   *
   * @returns {{ azimuth: number, elevation: number, distance: number, target: number[] }}
   */
  _resolvePose(step) {
    const [azimuth, elevation, distance] = this._stepOrbit(step);
    const target = this._stepTarget(step);
    return { azimuth, elevation, distance, target };
  }

  /**
   * Read a step's orbit columns into [azimuth, elevation, distance]; empty values
   * default to 0° / 75° / the model's ideal framing distance.
   */
  _stepOrbit(step) {
    const az = this._num(step.azimuth) ?? 0;
    const el = this._num(step.elevation) ?? 75;
    const dist = this._num(step.distance) ?? this._autoFraming.distance;
    return [az, el, dist];
  }

  /**
   * Read a step's look-at target into [x, y, z] metres; empty values default to
   * the model's bounding-sphere centre.
   */
  _stepTarget(step) {
    const x = this._num(step.target_x) ?? this._autoFraming.target[0];
    const y = this._num(step.target_y) ?? this._autoFraming.target[1];
    const z = this._num(step.target_z) ?? this._autoFraming.target[2];
    return [x, y, z];
  }

  /**
   * Parse story value as number or null
   */
  _num(v) {
    const n = parseFloat(v);
    return Number.isNaN(n) ? null : n;
  }

  /**
   * Inject a .telar-alert error notification into the model plate.
   */
  _injectModelError() {
    if (this.container.querySelector('.telar-alert')) return;

    const alertEl = document.createElement('div');
    alertEl.className = 'alert alert-warning telar-alert';
    alertEl.setAttribute('role', 'alert');
    alertEl.innerHTML = `<strong>3D model unavailable</strong>
<p>This 3D model could not be loaded. Continue scrolling to read the story.</p>`;
    this.container.appendChild(alertEl);
  }
}


/** Duration (ms) of an eased camera move. */
const EASE_DURATION = 600;

/**
 * Drives a three.js camera between framing poses.
 */
class CameraControl {
  constructor(camera, onChange) {
    this._camera = camera;
    this._onChange = onChange;
    this._pose = null;
    this._animFrame = null; 
  }

  /** 
   * Fix a pose
   **/
  snap(pose) {
    this.stopAnimation();
    this._positionCamera(pose);
  }

  /** 
   * Lerp between two poses over t in [0, 1] and show the intermediate pose.
   **/
  lerp(a, b, t) {
    this._positionCamera({
      azimuth:   a.azimuth   + (b.azimuth   - a.azimuth)   * t,
      elevation: a.elevation + (b.elevation - a.elevation) * t,
      distance:  a.distance  + (b.distance  - a.distance)  * t,
      target: [
        a.target[0] + (b.target[0] - a.target[0]) * t,
        a.target[1] + (b.target[1] - a.target[1]) * t,
        a.target[2] + (b.target[2] - a.target[2]) * t,
      ],
    });
  }

  /** 
   * Animate to a specific pose
   **/
  ease(to) {
    this.stopAnimation();
    const from = this._pose;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min((now - start) / EASE_DURATION, 1);
      this.lerp(from, to, t);
      this._animFrame = t < 1 ? requestAnimationFrame(tick) : null;
    };
    this._animFrame = requestAnimationFrame(tick);
  }

  stopAnimation() {
    if (this._animFrame) {
      cancelAnimationFrame(this._animFrame);
      this._animFrame = null;
    }
  }

  /** 
   * Position the camera from a pose around its target
   **/
  _positionCamera(pose) {
    const THREE = window.THREE;
    const offset = new THREE.Vector3().setFromSphericalCoords(
      pose.distance,
      THREE.MathUtils.degToRad(pose.elevation),
      THREE.MathUtils.degToRad(pose.azimuth)
    );
    this._camera.position.set(pose.target[0], pose.target[1], pose.target[2]).add(offset);
    this._camera.lookAt(pose.target[0], pose.target[1], pose.target[2]);
    this._pose = pose;
    this._onChange();
  }
}

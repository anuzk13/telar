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


/** Duration (ms) of the camera move on mobile tap, nav button and deep-link */
const MODEL_CAMERA_DURATION = 600;

export class ModelPlate extends Plate {
  constructor(container, objectId, sceneIndex, zIndex, initialStep) {
    super(container, objectId, sceneIndex, zIndex, initialStep);
    this._currentPose = null;
    this._renderer = null;
    this._scene = null;
    this._camera = null;
    this._model = null;
    this._autoFraming = null;   // bounding sphere location and framing distance calculated on load
    this._cameraRAF = null;
  }

  hasPlayer() {
    return !!this._renderer;
  }

  createPlayer() {
    const THREE = window.THREE;
    const GLTFLoader = window.GLTFLoader;

    const ext = window.modelObjects[this.objectId];
    const url = `${getBasePath()}/telar-content/objects/${this.objectId}.${ext}`;

    this.container.style.zIndex = this.zIndex;
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

    new GLTFLoader().load(
      url,
      (gltf) => {
        if (!this._renderer) return;   // destroyPlayer() was called mid load
        this._model = gltf.scene;
        scene.add(gltf.scene);
        this._autoFraming = fitCameraToModel(camera, gltf.scene);
        this._applyViewOffset();
        delete this.container.dataset.loading;
        this.moveStep(this._currentStep, false);
        this._render();
      },
      undefined,
      () => {
        delete this.container.dataset.loading;
        this._injectModelError();
      }
    );
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

  /**
   * Destroy the model player, releasing its GPU resources and WebGL context.
   */
  destroyPlayer() {
    this._cancelDiscreteCameraAnim();

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
  }

  /**
   * Deactivate a model card plate
   */
  onDeactivate() {
    this._cancelDiscreteCameraAnim();
  }

  /**
   * Move to a step pose eased on discrete navigation, snapped otherwise.
   */
  moveStep(step, animate = false) {
    this._currentStep = step;
    if (!this._model) return;
    const pose = this._resolvePose(step);
    if (animate) this._easeCamera(pose);
    else this._snapCamera(pose);
    this._currentPose = pose;
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
    const az = _num(step.azimuth) ?? 0;
    const el = _num(step.elevation) ?? 75;
    const dist = _num(step.distance) ?? this._autoFraming.distance;
    return [az, el, dist];
  }

  /**
   * Read a step's look-at target into [x, y, z] metres; empty values default to
   * the model's bounding-sphere centre.
   */
  _stepTarget(step) {
    const x = _num(step.target_x) ?? this._autoFraming.target[0];
    const y = _num(step.target_y) ?? this._autoFraming.target[1];
    const z = _num(step.target_z) ?? this._autoFraming.target[2];
    return [x, y, z];
  }

  /**
   * Orbit the camera to a numeric pose (azimuth/elevation/distance around target)
   * and render.
   */
  _applyPose({ azimuth, elevation, distance, target }) {
    const THREE = window.THREE;
    const offset = new THREE.Vector3().setFromSphericalCoords(
      distance,
      THREE.MathUtils.degToRad(elevation),
      THREE.MathUtils.degToRad(azimuth)
    );
    this._camera.position.set(target[0], target[1], target[2]).add(offset);
    this._camera.lookAt(target[0], target[1], target[2]);
    this._render();
  }

  /** Land a new authored pose instantly. */
  _snapCamera(pose) {
    this._cancelDiscreteCameraAnim();
    this._applyPose(pose);
  }

  /**
   * Ease the camera from its current pose to `pose` 
   */
  _easeCamera(pose) {
    
  }

  _lerp (poseA, poseB, t) {

  }

  /**
   * Cancel any in-flight discrete camera animation on this plate.
   */
  _cancelDiscreteCameraAnim() {
    if (this._cameraRAF) {
      cancelAnimationFrame(this._cameraRAF);
      this._cameraRAF = null;
    }
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


// Math utils 
// adopted from https://github.com/yomotsu/camera-controls/blob/dev/src/utils/math-utils.ts#L51

const EPSILON = 1e-5;

export function approxZero(number, error = EPSILON) {
  return Math.abs(number) < error;
}

export function approxEquals(a, b, error = EPSILON) {
  return approxZero(a - b, error);
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Gradually moves the current value towards a target value, over a specified time and at a specified velocity
 *
 * adapted from https://github.com/yomotsu/camera-controls/blob/c51601107e266097edf6a9caa57bfa9eaa77427c/src/utils/math-utils.ts#L51
 * https://docs.unity3d.com/ScriptReference/Mathf.SmoothDamp.html
 * https://github.com/Unity-Technologies/UnityCsReference/blob/a2bdfe9b3c4cd4476f44bf52f848063bfaf7b6b9/Runtime/Export/Math/Mathf.cs#L308
 */
function smoothDamp(current, target, currentVelocityRef, smoothTime, maxSpeed = Infinity, deltaTime) {

  // Based on Game Programming Gems 4 Chapter 1.10
  smoothTime = Math.max(0.0001, smoothTime);
  const omega = 2 / smoothTime;

  const x = omega * deltaTime;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  let change = current - target;
  const originalTo = target;

  // Clamp maximum speed
  const maxChange = maxSpeed * smoothTime;
  change = clamp(change, -maxChange, maxChange);
  target = current - change;

  const temp = (currentVelocityRef.value + omega * change) * deltaTime;
  currentVelocityRef.value = (currentVelocityRef.value - omega * temp) * exp;
  let output = target + (change + temp) * exp;

  // Prevent overshooting
  if (originalTo - current > 0.0 === output > originalTo) {
    output = originalTo;
    currentVelocityRef.value = (output - originalTo) / deltaTime;
  }

  return output;
}


/**
 * Gradually changes a vector towards a desired goal over time
 *
 * adapted from https://github.com/yomotsu/camera-controls/blob/c51601107e266097edf6a9caa57bfa9eaa77427c/src/utils/math-utils.ts#L92-L95
 *  https://docs.unity3d.com/ScriptReference/Vector3.SmoothDamp.html
 * https://github.com/Unity-Technologies/UnityCsReference/blob/a2bdfe9b3c4cd4476f44bf52f848063bfaf7b6b9/Runtime/Export/Math/Mathf.cs#L308
 */
function smoothDampVec3(current, target, currentVelocityRef, smoothTime, maxSpeed = Infinity, deltaTime, out) {

  // Based on Game Programming Gems 4 Chapter 1.10
  smoothTime = Math.max(0.0001, smoothTime);
  const omega = 2 / smoothTime;

  const x = omega * deltaTime;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);

  let targetX = target.x;
  let targetY = target.y; 
  let targetZ = target.z;

  let changeX = current.x - targetX;
  let changeY = current.y - targetY;
  let changeZ = current.z - targetZ;

  const originalToX = targetX;
  const originalToY = targetY;
  const originalToZ = targetZ;

  // Clamp maximum speed
  const maxChange = maxSpeed * smoothTime;

  const maxChangeSq = maxChange * maxChange;
  const magnitudeSq = changeX * changeX + changeY * changeY + changeZ * changeZ;

  if (magnitudeSq > maxChangeSq) {
    const magnitude = Math.sqrt(magnitudeSq);
    changeX = changeX / magnitude * maxChange;
    changeY = changeY / magnitude * maxChange;
    changeZ = changeZ / magnitude * maxChange;
  }

  targetX = current.x - changeX;
  targetY = current.y - changeY;
  targetZ = current.z - changeZ;

  const tempX = (currentVelocityRef.x + omega * changeX) * deltaTime;
  const tempY = (currentVelocityRef.y + omega * changeY) * deltaTime;
  const tempZ = (currentVelocityRef.z + omega * changeZ) * deltaTime;

  currentVelocityRef.x = (currentVelocityRef.x - omega * tempX) * exp;
  currentVelocityRef.y = (currentVelocityRef.y - omega * tempY) * exp;
  currentVelocityRef.z = (currentVelocityRef.z - omega * tempZ) * exp;

  out.x = targetX + (changeX + tempX) * exp;
  out.y = targetY + (changeY + tempY) * exp;
  out.z = targetZ + (changeZ + tempZ) * exp;

  // Prevent overshooting
  const origMinusCurrentX = originalToX - current.x;
  const origMinusCurrentY = originalToY - current.y;
  const origMinusCurrentZ = originalToZ - current.z;
  const outMinusOrigX = out.x - originalToX;
  const outMinusOrigY = out.y - originalToY;
  const outMinusOrigZ = out.z - originalToZ;

  if (origMinusCurrentX * outMinusOrigX + origMinusCurrentY * outMinusOrigY + origMinusCurrentZ * outMinusOrigZ > 0) {
    out.x = originalToX;
    out.y = originalToY;
    out.z = originalToZ;
  
    currentVelocityRef.x = (out.x - originalToX) / deltaTime;
    currentVelocityRef.y = (out.y - originalToY) / deltaTime;
    currentVelocityRef.z = (out.z - originalToZ) / deltaTime;
  }
  
  return out;
}
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


const DEFAULT_ORBIT = '0deg 75deg auto';

/** Duration (ms) of the camera move on mobile tap, nav button and deep-link */
const MODEL_CAMERA_DURATION = 600;

export class ModelPlate extends Plate {
  constructor(container, objectId, sceneIndex, zIndex) {
    super(container, objectId, sceneIndex, zIndex);
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
   * Apply a step's authored camera
   */
  applyStep(step, animate = false) {
    const cam = stepCameraStrings(step);
    if (animate) this._easeCamera(cam.orbit, cam.target, step);
    else this._snapCamera(cam.orbit, cam.target);
  }

  /**
   * Land a new authored camera pose instantly
   */
  _snapCamera(cameraOrbit, cameraTarget) {
    if (!this._setCameraGoal(cameraOrbit, cameraTarget)) {
      return;
    }
    this._cancelDiscreteCameraAnim();
    this._applyCameraGoal();
  }

  /**
   * EASE the camera to a new authored pose over MODEL_CAMERA_DURATION.
   * Falls back to a snap for reduced motion.
   */
  _easeCamera(cameraOrbit, cameraTarget, step) {
    if (!this._setCameraGoal(cameraOrbit, cameraTarget)) return;
    const mv = this._mv;
    if (!mv) return; // still loading — createPlayer applies the goal on append
    if (_reduceMotion() || !mv.loaded) {
      this._cancelDiscreteCameraAnim();
      this._applyCameraGoal();
      return;
    }
    this._animateModelCameraDiscrete(step, this.cameraOrbit, this.cameraTarget || 'auto auto auto');
  }

  /**
   * Persist the camera goal. Returns false when it's unchanged.
   *
   * @returns {boolean} whether the goal changed.
   */
  _setCameraGoal(cameraOrbit, cameraTarget) {
    if (cameraOrbit === this.cameraOrbit && cameraTarget === this.cameraTarget) {
      return false;
    } 
    this.cameraOrbit = cameraOrbit;
    this.cameraTarget = cameraTarget;
    return true;
  }

  /** Set the goal on the element and force the static renderer to it. */
  _applyCameraGoal() {
    this._mv.cameraOrbit = this.cameraOrbit;
    this._mv.cameraTarget = this.cameraTarget || 'auto auto auto';
    _jumpModelCameraToGoal(this._mv);
  }

  /**
   * Interpolate the camera between two steps based on scroll progress.
   *
   * The 3D analogue of iiif-card.js:lerpIiifPosition, and the fix for D1 (the
   * camera "jumping at a threshold"). Called every frame by the scroll engine's
   * rAF loop. For step pairs that share the same object it linearly interpolates
   * the camera orbit (θ, φ, radius) and target between step A and step B by the
   * fractional scroll `progress`, then assigns the result with the cameraOrbit /
   * cameraTarget property setters. Because the element carries
   * `interpolation-decay="0"`, each assignment applies instantly — smoothness
   * comes from Lenis calling this every frame, exactly like snapIiifToPosition.
   *
   * Different-object pairs are frozen (the new plate slides in on top, same as
   * IIIF). Progress below 0.001 is skipped (already at the integer step); at
   * progress ≥ 0.999 the camera snaps exactly to step B so the boundary always
   * lands even on a fast scroll or snap.
   *
   * (The scene/plate lookup of the old lerpModelCamera moved to the orchestrator,
   * which resolves the active plate and the step pair, then calls this directly.)
   *
   * @param {number} progress - Fractional progress 0.0–1.0 toward the next step.
   * @param {Object} stepA
   * @param {Object} stepB
   */
  lerp(progress, stepA, stepB) {
    if (progress < 0.001) return; // at exact integer step, no interpolation needed
    if (!stepA || !stepB) return;

    const objectIdA = stepA.object || stepA.objectId || '';
    const objectIdB = stepB.object || stepB.objectId || '';
    if (objectIdA !== objectIdB) return; // different object → freeze

    this._cancelDiscreteCameraAnim(); // a scroll frame supersedes any discrete ease

    // Snap exactly to step B at the boundary so the endpoint always lands.
    const p = progress >= 0.999 ? 1 : progress;

    // ── Orbit (numeric columns) ─────────────────────────────────────────────────
    // azimuth / elevation / distance are plain numbers. A missing endpoint mirrors
    // the other (no movement on that axis); both azimuth/elevation missing default
    // to 0°/75°; both distance missing → 'auto' radius (idealCameraDistance). One
    // unit throughout (degrees / metres), so this is a straight numeric lerp.
    const azP   = _lerpPair(_num(stepA.azimuth),   _num(stepB.azimuth),   0);
    const elP   = _lerpPair(_num(stepA.elevation), _num(stepB.elevation), 75);
    const distP = _lerpPair(_num(stepA.distance),  _num(stepB.distance),  null);

    // Shortest-path azimuth: wrap Δθ into [−180°, 180°].
    let dTheta = azP.to - azP.from;
    dTheta = ((dTheta + 180) % 360 + 360) % 360 - 180;
    const theta = azP.from + dTheta * p;
    const phi   = elP.from + (elP.to - elP.from) * p;
    const radiusPart = distP.from == null
      ? 'auto'
      : `${distP.from + (distP.to - distP.from) * p}m`;
    const orbitStr = `${theta}deg ${phi}deg ${radiusPart}`;

    const mv = this._mv;
    this.cameraOrbit = orbitStr; // keep this.cameraOrbit in sync so a post-scrub applyStep isn't a stale no-op
    if (mv) mv.cameraOrbit = orbitStr;

    // ── Target (numeric columns) ─────────────────────────────────────────────────
    const tA = _stepTarget(stepA);
    const tB = _stepTarget(stepB);
    if (!tA && !tB) {
      // Both model-centred — nothing to interpolate; leave target at its default.
      this.cameraTarget = '';
      if (mv) mv.cameraTarget = 'auto auto auto';
    } else {
      let from = tA, to = tB;
      if (!from || !to) {
        // One side is model-centred: resolve it to the bounding-box centre, but
        // only once the model is loaded (getBoundingBoxCenter needs the scene).
        if (mv && mv.loaded && typeof mv.getBoundingBoxCenter === 'function') {
          const c = mv.getBoundingBoxCenter();
          const centre = [c.x, c.y, c.z];
          from = from || centre;
          to = to || centre;
        } else {
          _jumpModelCameraToGoal(mv); // orbit applied; force the static renderer to it
          return; // skip the target lerp this frame
        }
      }
      const tx = from[0] + (to[0] - from[0]) * p;
      const ty = from[1] + (to[1] - from[1]) * p;
      const tz = from[2] + (to[2] - from[2]) * p;
      const targetStr = `${tx}m ${ty}m ${tz}m`;
      this.cameraTarget = targetStr;
      if (mv) mv.cameraTarget = targetStr;
    }

    // A static (non-animating) model renders on demand, so with interpolation-decay=0
    // the camera GOAL is updated but the rendered camera never ticks toward it until
    // a render is forced. jumpCameraToGoal() forces that snap every frame; smoothness
    // still comes from the per-frame lerp above (Lenis), exactly like snapIiifToPosition.
    _jumpModelCameraToGoal(mv);
  }

  /**
   * Ease the camera from its current rendered pose to a step's authored pose over
   * MODEL_CAMERA_DURATION, driven by our own requestAnimationFrame loop.
   *
   * Why not model-viewer's interpolation-decay: a guided story plate is a static,
   * `camera-controls`-less, non-animated <model-viewer>, which does not run a
   * continuous render loop. Setting cameraOrbit only sets a goal; with nothing
   * ticking, the eased interpolation never plays — the camera snaps only when an
   * unrelated render is forced. So we drive the motion explicitly, calling
   * jumpCameraToGoal() each frame (which both moves the camera AND schedules a
   * render), exactly like lerpModelCamera does for scroll.
   *
   * FROM is the LIVE camera (getCameraOrbit/Target — concrete radians/metres of the
   * settled previous step). TO is computed from the destination step's numeric
   * columns (azimuth/elevation/distance/target_x/y/z), NOT read back from
   * model-viewer — a freshly-set cameraOrbit only reaches model-viewer's goal on
   * its next tick, so an immediate read-back returns the STALE goal (≈ FROM) and the
   * ease would have zero motion. Any null column mirrors FROM (no motion on that
   * axis), matching lerpModelCamera's _lerpPair. Azimuth takes the shortest path.
   * A new discrete nav (rapid taps) or a scroll/reduced-motion snap cancels the loop.
   *
   * @param {Object} step - destination step row (numeric framing columns)
   * @param {string} fallbackOrbit - the step's resolved orbit string (for the final landing + sync)
   * @param {string} fallbackTarget - the step's resolved target string ("x y z" / "auto auto auto")
   */
  _animateModelCameraDiscrete(step, fallbackOrbit, fallbackTarget) {
    const mv = this._mv;
    if (!mv) return;
    this._cancelDiscreteCameraAnim();

    const DEG = 180 / Math.PI;
    // FROM: current rendered pose, converted to degrees / metres.
    const fO = mv.getCameraOrbit();
    const fT = mv.getCameraTarget();
    const fromTh = fO.theta * DEG, fromPh = fO.phi * DEG, fromR = fO.radius;
    const fromT = [fT.x, fT.y, fT.z];

    // TO: from the step's numeric columns; a null column keeps FROM on that axis.
    const az = _num(step.azimuth), el = _num(step.elevation), dist = _num(step.distance);
    const toTh = az == null ? fromTh : az;
    const toPh = el == null ? fromPh : el;
    const toR  = dist == null ? fromR : dist;
    const stepT = _stepTarget(step);
    const toT = stepT || fromT.slice();

    // Shortest-path azimuth: wrap Δθ into [−180°, 180°].
    let dth = toTh - fromTh;
    dth = ((dth + 180) % 360 + 360) % 360 - 180;

    const ease = (t) => 1 - Math.pow(1 - t, 3); // ease-out cubic (matches keyboardNav scrollTo)
    const start = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const tick = (now) => {
      const elapsed = now - start;
      const p = elapsed >= MODEL_CAMERA_DURATION ? 1 : elapsed / MODEL_CAMERA_DURATION;
      const e = ease(p);
      const th = fromTh + dth * e;
      const ph = fromPh + (toPh - fromPh) * e;
      const r  = fromR  + (toR  - fromR)  * e;
      const tx = fromT[0] + (toT[0] - fromT[0]) * e;
      const ty = fromT[1] + (toT[1] - fromT[1]) * e;
      const tz = fromT[2] + (toT[2] - fromT[2]) * e;
      mv.cameraOrbit = `${th}deg ${ph}deg ${r}m`;
      mv.cameraTarget = `${tx}m ${ty}m ${tz}m`;
      _jumpModelCameraToGoal(mv);
      if (p < 1) {
        this._cameraRAF = requestAnimationFrame(tick);
      } else {
        // Land exactly on the authored goal. model-viewer applies a freshly-set
        // cameraOrbit to its goal on the NEXT tick, so jumpCameraToGoal here is one
        // tick behind; a second jump next frame settles the rendered camera onto it.
        mv.cameraOrbit = fallbackOrbit;
        mv.cameraTarget = fallbackTarget;
        _jumpModelCameraToGoal(mv);
        this._cameraRAF = requestAnimationFrame(() => {
          _jumpModelCameraToGoal(mv);
          this._cameraRAF = null;
        });
      }
    };
    this._cameraRAF = requestAnimationFrame(tick);
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
   * Snap the rendered camera to its goal once the model's first frame loads, so
   * the plate appears already framed at the authored camera (no opening drift from
   * model-viewer's default framing). Step-to-step motion is handled separately by
   * lerp (scroll) and applyStep (boundary).
   */
  _settle() {
    _jumpModelCameraToGoal(this._mv);
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

// ── Private helpers ───────────────────────────────────────────────────────────

/**
 * Force a <model-viewer>'s rendered camera to its current goal.
 *
 * Guided story plates carry no `camera-controls`, no auto-rotate and no
 * animation, so model-viewer renders on demand. Assigning cameraOrbit /
 * cameraTarget only updates the GOAL; with interpolation-decay=0 the camera is
 * meant to land instantly, but without a running render loop the on-demand
 * renderer never ticks, so the goal is silently never reached. Calling
 * jumpCameraToGoal() snaps the camera to the goal AND schedules a render.
 *
 * @param {HTMLElement|null} mv
 */
function _jumpModelCameraToGoal(mv) {
  if (mv && typeof mv.jumpCameraToGoal === 'function') mv.jumpCameraToGoal();
}

/**
 * Whether the reader prefers reduced motion. Reduced-motion readers get instant
 * camera snaps on discrete navigation instead of an eased interpolation.
 *
 * @returns {boolean}
 */
function _reduceMotion() {
  return typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Coerce a story-step framing cell to a number. Empty / "nan" / unparseable → null
 * (so the caller can apply a per-component default). Story JSON carries these as
 * strings ("0", "1.45") or null.
 *
 * @param {*} v
 * @returns {number|null}
 */
function _num(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s === '' || s.toLowerCase() === 'nan') return null;
  const n = parseFloat(s);
  return Number.isNaN(n) ? null : n;
}

/**
 * Resolve a numeric component pair for interpolation. A null endpoint mirrors the
 * other (constant on that axis); both null → the supplied default on each side
 * (or null/null when `dflt` is null, which the distance lerp reads as "auto").
 *
 * @param {number|null} a
 * @param {number|null} b
 * @param {number|null} dflt
 * @returns {{ from: number|null, to: number|null }}
 */
function _lerpPair(a, b, dflt) {
  if (a == null && b == null) return { from: dflt, to: dflt };
  return { from: a == null ? b : a, to: b == null ? a : b };
}

/**
 * Read a step's look-at target columns into [x, y, z] metres, or null
 * (model-centred) when any axis is empty.
 */
function _stepTarget(step) {
  const x = _num(step.target_x);
  const y = _num(step.target_y);
  const z = _num(step.target_z);
  if (x == null || y == null || z == null) return null;
  return [x, y, z];
}

/**
 * Read a step's orbit columns into [azimuth, elevation, distance]; an empty value
 * defaults to azimuth 0, elevation 75, distance 'auto'.
 */
function _stepOrbit(step) {
  const az = _num(step.azimuth) ?? 0;
  const el = _num(step.elevation) ?? 75;
  const dist = _num(step.distance) ?? 'auto';
  return [az, el, dist];
}

/**
 * Build a model-viewer camera-orbit string from [azimuth, elevation, distance].
 */
function _getOrbitString(orbit) {
  const [az, el, dist] = orbit;
  return `${az}deg ${el}deg ${dist === 'auto' ? 'auto' : dist + 'm'}`;
}

/**
 * Build a model-viewer camera-target string from [x, y, z] metres, or '' when
 * the target is null (model-centred).
 */
function _getTargetString(target) {
  return target ? `${target[0]}m ${target[1]}m ${target[2]}m` : '';
}

/**
 * Convert a story step's numeric framing columns (azimuth, elevation, distance,
 * target_x/y/z) into the model-viewer native { orbit, target } strings the player
 * consumes. The numeric columns are the authoring/storage form; these strings are
 * the internal model-viewer boundary. Exported for the orchestrator's discrete
 * updates and plate initialisation.
 *
 * @param {Object} step
 * @returns {{ orbit: string, target: string }}
 */
export function stepCameraStrings(step) {
  return { orbit: _stepToOrbitString(step), target: _stepToTargetString(step) };
}

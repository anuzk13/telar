/**
 * Telar Story — Base Plate
 *
 * Full-viewport background container that renders an object for a scene
 * Exposes methods to create, activate, pause and destroy viewer resouce
 *
 */

export class Plate {
  /**
   * @param {HTMLElement} container
   * @param {string} objectId
   * @param {number} sceneIndex
   * @param {number} zIndex
   */
  constructor(container, objectId, sceneIndex, zIndex) {
    this.container = container;
    this.objectId = objectId;
    this.sceneIndex = sceneIndex;
    this.zIndex = zIndex;
  }

  /**
   * Bring the plate on-screen as the active scene.
   */
  activate() {
    this.ensurePlayer();
    this.container.style.zIndex = this.zIndex;
    this.container.style.transform = 'translateY(0)';
    this.container.classList.add('is-active');
    this.onActivate();
  }

  /**
   * Move the plate off-screen.
   */
  deactivate() {
    this.container.classList.remove('is-active');
    this.onDeactivate();
  }

  /**
   * Slide the plate down out  to reveal the plate beneath.
   */
  slideDown() {
    this.container.style.transform = 'translateY(100%)';
  }

  /** Create the player if not preloaded. */
  ensurePlayer() {
    if (!this.hasPlayer()) this.createPlayer();
  }

  /** Destroy the player and reset shared container state. */
  destroy() {
    if (this.hasPlayer()) this.destroyPlayer();
    // Shared cleanup: any plate type may have injected a .telar-alert error
    // notice and set the data-loading shimmer flag.
    this.container.querySelector('.telar-alert')?.remove();
    delete this.container.dataset.loading;
  }

  /**
   * Per-frame interpolation during scroll scrubbing.
   * No-op by default IIIF and model implement it.
   *
   * @param {number} _progress - 0..1 within the current step pair.
   * @param {Object} _fromStep
   * @param {Object} _toStep
   */
  lerp(_progress, _fromStep, _toStep) {}

  /**
   * Apply a step's view discretely 
   * video/audio: clip times). No-op by default.
   *
   * @param {Object} _step - the destination step data
   * @param {boolean} [_animate=false]
   */
  applyStep(_step, _animate = false) {}

  /** @returns {boolean} whether the player currently exists. */
  hasPlayer() { return false; }

  /** Build the type-specific player  */
  createPlayer() {}

  /** Tear down the player to release resources */
  destroyPlayer() {}

  /** Apply this step's layout / camera once the plate is active. */
  onActivate() {}

  /** Action after deactivation (i.e freeze video frame). */
  onDeactivate() {}
}

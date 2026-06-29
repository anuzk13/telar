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
   * @param {Object} initialStep
   */
  constructor(container, objectId, sceneIndex, zIndex, initialStep) {
    this.container = container;
    this.objectId = objectId;
    this.sceneIndex = sceneIndex;
    this.zIndex = zIndex;
    this._currentStep = initialStep;
  }

  /**
   * Bring the plate on-screen as the active scene and frame it to the given step.
   */
  activate(step) {
    this.ensurePlayer();
    this.container.style.zIndex = this.zIndex;
    this.container.style.transform = 'translateY(0)';
    this.container.classList.add('is-active');
    this.moveStep(step, false);
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
   *
   * @param {number} progress - 0..1 with respect to previous step or initial pose
   * @param {Object} step
   */
  lerpStep(progress, step) {}

  /**
   * Apply a step's view discretely with predefined animation
   *
   * @param {Object} step - the destination step data
   * @param {boolean} [animate=false]
   */
  moveStep(step, animate = false) {}

  /** @returns {boolean} whether the player currently exists. */
  hasPlayer() { return false; }

  /** Build the type-specific player  */
  createPlayer() {}

  /** Tear down the player to release resources */
  destroyPlayer() {}

  /** Action after deactivation (i.e freeze video frame). */
  onDeactivate() {}
}

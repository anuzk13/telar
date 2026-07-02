/**
 * Telar Story — Base Plate
 *
 * One viewer for a scene. The instance is permanent; its player loads/unloads.
 *
 * Two axes:
 *   load / unload      — the player (libraries + file + GPU)
 *   center / sendBack  — the visual position
 */

export class Plate {

  static containerClass = 'base-plate';
  static deps = () => Promise.resolve();   // libraries this type needs (subclass overrides)

  constructor(container, objectId, sceneIndex, zIndex, firstStep, firstStepIdx) {
    this.container = container;
    this.objectId = objectId;
    this.sceneIndex = sceneIndex;
    this.zIndex = zIndex;
    this._currentStep = firstStep;
    this._firstStepIdx = firstStepIdx;
    this._loadPromise = null;
    container.classList.add(this.constructor.containerClass);
  }

  /** Idempotent load of libraries and build player */
  load() {
    if (this._loadPromise) return this._loadPromise;
    this._loadPromise = this.constructor.deps().then(() => this._build());
    return this._loadPromise;
  }

  /** Tear down the player. */
  unload() {
    if (!this._loadPromise) return;
    this._teardown();
    this._loadPromise = null;
    this.container.querySelector('.telar-alert')?.remove();
    delete this.container.dataset.loading;
  }

  /** Bring to the front. */
  centerPlate() {
    this.load();
    this.container.style.zIndex = this.zIndex;
    this.container.style.transform = 'translateY(0)';
    this.container.classList.add('is-active');
  }

  /** Settle plate off screen */
  sendBack(direction) {
    this.container.classList.remove('is-active');
    if (direction === 'backward') {
      this.container.style.transform = 'translateY(100%)';
    }
  }

  /** Move the camera to a step (snap, or ease when animate). */
  goToStep(step, animate = false) {}

  /**
   * Position from the continuous scroll: 0 while its scene is current, sliding
   * down to 100% one step below it, staying put (covered) above it.
   * @param {number} scrollProgress - continuous scroll position (0 = first step, 1 = second step, etc.)
   */
  scrollPos(scrollProgress) {
    const distToScroll = this._firstStepIdx - scrollProgress;
    const t = Math.min(1, Math.max(0, distToScroll)) * 100;
    this.container.style.transform = `translateY(${t}%)`;
  }

  /** Player scroll interpolation between two steps inside a scene */
  scrollContent(progress, stepA, stepB) { }

  /** React to a viewport resize. */
  resize() {}

  /** Build the player */
  _build() {}

  /** Free the player */
  _teardown() {}
  
}

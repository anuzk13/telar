/**
 * Telar Story — Text Card
 *
 * One text/title card. No player — just movement: slide up to centre, down or
 * stacked to leave, and scrub per scroll frame. Parallel to a Plate's
 * center / sendBack, reading its messiness offsets from the dataset.
 */

import { state } from '../state.js';

export class TextCard {
  constructor(el) {
    this.el = el;
    this.messiness = {
      rot:  parseFloat(el.dataset.messinessRot  || 0),
      offX: parseFloat(el.dataset.messinessOffX || 0),
      offY: parseFloat(el.dataset.messinessOffY || 0),
    };
  }

  /** Slide up into view (rotation halved in vertical layout — less distracting full-width). */
  center() {
    const rot = state.layoutMode === 'vertical' ? this.messiness.rot * 0.5 : this.messiness.rot;
    this.el.classList.remove('is-stacked');
    this.el.classList.add('is-active');
    this.el.style.transform = this._transform('0', rot);
  }

  /** Leave: forward stays put (stacked, covered by the next card); backward slides down. */
  sendBack(direction) {
    this.el.classList.remove('is-active');
    if (direction === 'backward') {
      this.el.classList.remove('is-stacked');
      this.el.style.transform = this._transform('100vh', this.messiness.rot);
    } else {
      this.el.classList.add('is-stacked');
    }
  }

  /** Per-frame scroll: slide from offscreen (progress 0) toward centred (1). */
  scrub(progress) {
    this.el.style.transform = this._transform(`${(1 - progress) * 100}vh`, this.messiness.rot);
  }

  _transform(translateY, rot) {
    return `translateY(${translateY}) rotate(${rot}deg) translate(${this.messiness.offX}px, ${this.messiness.offY}px)`;
  }
}

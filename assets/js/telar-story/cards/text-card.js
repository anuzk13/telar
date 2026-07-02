/**
 * Telar Story — Text Card
 *
 * Cards containing text
 */

import { state } from '../state.js';

export class TextCard {
  constructor(el, stepIndex) {
    this.el = el;
    this.stepIndex = stepIndex;
    this.messiness = {
      rot:  parseFloat(el.dataset.messinessRot  || 0),
      offX: parseFloat(el.dataset.messinessOffX || 0),
      offY: parseFloat(el.dataset.messinessOffY || 0),
    };
  }

  /** Slide up into view */
  center() {
    // rotation halved in vertical layout — less distracting 
    const rot = state.layoutMode === 'vertical' ? this.messiness.rot * 0.5 : this.messiness.rot;
    this.el.classList.remove('is-stacked');
    this.el.classList.add('is-active');
    this.el.style.transform = this._transform('0', rot);
  }

  /** Slide off / behind. */
  sendBack(direction) {
    this.el.classList.remove('is-active');
    if (direction === 'backward') {
      this.el.classList.remove('is-stacked');
      this.el.style.transform = this._transform('100vh', this.messiness.rot);
    } else {
      this.el.classList.add('is-stacked');
    }
  }

  /**
   * Position from the continuous scroll: 0 while its step is current, sliding
   * @param {number} scrollProgress - continuous scroll position (0 = first step, 1 = second step, etc.)
   */
  scrollPos(scrollProgress) {
    const distToScroll = this.stepIndex - scrollProgress;
    const t = Math.min(1, Math.max(0, distToScroll));
    this.el.style.transform = this._transform(`${t * 100}vh`, this.messiness.rot);
  }

  _transform(translateY, rot) {
    return `translateY(${translateY}) rotate(${rot}deg) translate(${this.messiness.offX}px, ${this.messiness.offY}px)`;
  }
}

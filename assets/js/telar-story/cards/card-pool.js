/**
 * Telar Story — card pool - orchestrates cards and panels with scrolling or navigation story progression
 */

import { state } from '../state.js';
import { onViewportResize } from '../layout-mode.js';
import { buildScenes, getSceneIndex } from './card-pool-builder.js';
import { ModelPlate } from '../plates/model-plate.js';
import { TextCard } from './text-card.js';

const PLATE_TYPES = {
  model: ModelPlate,
  // image: IiifPlate,
};

const AHEAD = 2, BEHIND = 1; // viewer scenes kept loaded around the centred one

let _currentSceneIdx = -1;
let _currentStepIdx = -1;             // active step — boundary detection + returnToIntro
const _liveSceneIdxs = new Set();     // scene indices whose player is loaded
const _cards = new Map();    // stepIndex to TextCard
const _plates = new Map();   // sceneIndex to Plate

// css card animation
const CARD_SLIDE_MS = 550;
let _slideTimer;
let _cardStackElem;

/**
 * Enable the cards'/plates' CSS transition.
 */
function enableCardSlide() {
  _cardStackElem.classList.add('is-animating');
  clearTimeout(_slideTimer);
  _slideTimer = setTimeout(() => _cardStackElem.classList.remove('is-animating'), CARD_SLIDE_MS);
}

/** Whether this scene's type has a viewer plate */
function hasPlate(scene) {
  return scene?.type === 'model';
  // TODO: check other scene types that have a plate
    // || scene?.type === 'iiif'
    // || scene?.type === 'youtube'
    // || scene?.type === 'vimeo'
    // || scene?.type === 'google-drive'
    // || scene?.type === 'audio';
}

function makePlate(scene) {
  const Plate = PLATE_TYPES[scene.type];
  return new Plate(scene.container, scene.objectId, scene.index, scene.z, scene.firstStep, scene.firstStepIdx);
}

function resizeLivePlates() {
  for (const i of _liveSceneIdxs) _plates.get(i).resize();
}

/** Load the viewer scenes in the [BEHIND, AHEAD] window around `centerIndex`; unload the rest. */
function setWindow(centerIndex) {
  const window = new Set();
  for (let d = -BEHIND; d <= AHEAD; d++) {
    const sceneIndex = centerIndex + d;
    const plate = _plates.get(sceneIndex);
    if (!plate) continue;
    window.add(sceneIndex);
    if (!_liveSceneIdxs.has(sceneIndex)) { plate.load(); _liveSceneIdxs.add(sceneIndex); }
  }
  for (const i of [..._liveSceneIdxs]) {
    if (!window.has(i)) { _plates.get(i).unload(); _liveSceneIdxs.delete(i); }
  }
}

/** build scenes, cards and plates */
export function initCardPool(storyData, config) {
  _cardStackElem = document.querySelector('.card-stack');
  buildScenes(storyData, config);
  for (const scene of state.scenes) {
    if (hasPlate(scene)) _plates.set(scene.index, makePlate(scene));
  }
  for (const idx in state.textCards)  _cards.set(+idx, new TextCard(state.textCards[idx], +idx));
  for (const idx in state.titleCards) _cards.set(+idx, new TextCard(state.titleCards[idx], +idx));

  // activate is not called for the title, activate the first scene
  setWindow(getSceneIndex(0));
  
  onViewportResize(resizeLivePlates);
}

export function activateCard(stepIndex, animate = false) {
  if (animate) enableCardSlide();
  _cards.get(stepIndex)?.center();
  const sceneIndex = getSceneIndex(stepIndex);
  _plates.get(sceneIndex)?.goToStep(state.stepsData[stepIndex], animate);
  if (sceneIndex !== _currentSceneIdx) { // moving to a new scene
    _plates.get(_currentSceneIdx)?.sendBack();   // settle the departing scene's plate
    setWindow(sceneIndex);
    _plates.get(sceneIndex)?.centerPlate();
  }
  _currentSceneIdx = sceneIndex;
  _currentStepIdx = stepIndex;
}

/** Deactivate one card: send it back. */
export function deactivateCard(stepIndex, direction) {
  _cards.get(stepIndex)?.sendBack(direction);
}

/** Send the active viewer + card back and clear the centred indices. */
export function returnToIntro() {
  _plates.get(0)?.sendBack('backward');
  _cards.get(0)?.sendBack('backward');
  _currentSceneIdx = -1;
  _currentStepIdx = -1;
}

/**
 * Per-frame scroll 
 * @param {number} scrollProgress - continuous scroll position (0 = first step, 1 = second step, etc.)
 */
export function scrollCardPool(scrollProgress) {
  const stepsData = state.stepsData;
  const clamped = Math.min(stepsData.length - 1, scrollProgress);
  const stepIndex = Math.floor(clamped);
  const progress = clamped - stepIndex;

  // Crossing scenes
  if (stepIndex !== _currentStepIdx) {
    const prevStep = _currentStepIdx;
    const direction = stepIndex > prevStep ? 'forward' : 'backward';
    activateCard(stepIndex, false);
    if (prevStep >= 0) deactivateCard(prevStep, direction);
  }

  // Camera pose within the current scene.
  if (stepIndex + 1 < stepsData.length && getSceneIndex(stepIndex) === getSceneIndex(stepIndex + 1)) {
    _plates.get(getSceneIndex(stepIndex))?.scrollContent(progress, stepsData[stepIndex], stepsData[stepIndex + 1]);
  }

  // Position cads and live plates from scroll
  for (const [_, card] of _cards) card.scrollPos(scrollProgress);
  for (const i of _liveSceneIdxs) _plates.get(i).scrollPos(scrollProgress);

  return { stepIndex, progress };
}
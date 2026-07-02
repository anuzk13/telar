/**
 * Telar Story — card pool (orchestrator) 
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
const _cards = new Map();    // stepIndex → TextCard

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

/** build scenes + make every plate (permanent, unloaded). */
export function initPool(storyData, config) {
  buildScenes(storyData, config);
  for (const scene of state.scenes) {
    if (hasPlate(scene)) scene.plate = makePlate(scene);
  }
  for (const idx in state.textCards)  _cards.set(+idx, new TextCard(state.textCards[idx], +idx));
  for (const idx in state.titleCards) _cards.set(+idx, new TextCard(state.titleCards[idx], +idx));

  // activate is not called for the title, activate the first scene
  setWindow(getSceneIndex(0));
  
  onViewportResize(resizeLivePlates);
}

function resizeLivePlates() {
  for (const i of _liveSceneIdxs) state.scenes[i].plate.resize();
}

/** Load the viewer scenes in the [BEHIND, AHEAD] window around `centerIndex`; unload the rest. */
function setWindow(centerIndex) {
  const window = new Set();
  for (let d = -BEHIND; d <= AHEAD; d++) {
    const scene = state.scenes[centerIndex + d];
    if (!scene?.plate) continue;
    window.add(scene.index);
    if (!_liveSceneIdxs.has(scene.index)) { scene.plate.load(); _liveSceneIdxs.add(scene.index); }
  }
  for (const i of [..._liveSceneIdxs]) {
    if (!window.has(i)) { state.scenes[i].plate.unload(); _liveSceneIdxs.delete(i); }
  }
}


export function initCardPool(storyData, config) {
  initPool(storyData, config);
}

export function activateCard(stepIndex, animate = false) {
  _cards.get(stepIndex)?.center();
  const sceneIndex = getSceneIndex(stepIndex);
  const scene = state.scenes[sceneIndex];
  scene?.plate?.goToStep(state.stepsData[stepIndex], animate);
  if (sceneIndex !== _currentSceneIdx) { // moving to a new scene
    state.scenes[_currentSceneIdx]?.plate?.sendBack();   // settle the departing scene's plate
    setWindow(sceneIndex);
    scene?.plate?.centerPlate();
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
  state.scenes[0]?.plate?.sendBack('backward');
  _cards.get(0)?.sendBack('backward');
  _currentSceneIdx = -1;
  _currentStepIdx = -1;
}

/**
 * Per-frame scroll 
 * @param {number} scrollProgress - continuous scroll position (0 = first step, 1 = second step, etc.)
 */
export function scrollCardPool(scrollProgress) {
  console.log('scrollCardPool', `contentPos: ${scrollProgress}`);
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
    state.scenes[getSceneIndex(stepIndex)]?.plate?.scrollContent(progress, stepsData[stepIndex], stepsData[stepIndex + 1]);
  }

  // Position cads and live plates from scroll
  for (const [_, card] of _cards) card.scrollPos(scrollProgress);
  for (const i of _liveSceneIdxs) state.scenes[i].plate.scrollPos(scrollProgress);

  return { stepIndex, progress };
}
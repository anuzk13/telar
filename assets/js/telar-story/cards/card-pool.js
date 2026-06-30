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
let _currentStepIdx = -1;
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
  return new Plate(scene.container, scene.objectId, scene.index, scene.z, scene.firstStep);
}


/** build scenes + make every plate (permanent, unloaded). */
export function initPool(storyData, config) {
  buildScenes(storyData, config);
  for (const scene of state.scenes) {
    if (hasPlate(scene)) scene.plate = makePlate(scene);
  }
  for (const idx in state.textCards)  _cards.set(+idx, new TextCard(state.textCards[idx]));
  for (const idx in state.titleCards) _cards.set(+idx, new TextCard(state.titleCards[idx]));

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

/** bring a viewer to the front: load its window, center it, send the previous back. */
function centerViewer(scene, step, direction) {
  if (scene.index === _currentSceneIdx) {              // same scene, new step => move the camera
    scene.plate?.goToStep(step, !state.scrollDriven);
    return;
  }

  const prevScene = state.scenes[_currentSceneIdx];
  _currentSceneIdx = scene.index;

  setWindow(scene.index);
  scene.plate?.center(step);
  if (direction === 'backward') prevScene?.plate?.sendBack();
}

/** center the step's text/title card; send the previously-centred one back. */
function centerCard(stepIndex, direction) {
  if (stepIndex === _currentStepIdx) return;
  _cards.get(_currentStepIdx)?.sendBack(direction);
  _cards.get(stepIndex)?.center();
  _currentStepIdx = stepIndex;
}

/** scroll the centred plate between two steps. Caller ensures hasPlate + same scene. */
function scroll(scene, progress, stepA, stepB) {
  scene.plate.scroll(progress, stepA, stepB);
}

// ── App entry points (step index → scene). What scroll-engine / nav / deep-link call. ──

export function initCardPool(storyData, config) {
  initPool(storyData, config);
}

export function activateCard(index, direction) {
  centerViewer(state.scenes[getSceneIndex(index)], state.stepsData[index], direction);
  centerCard(index, direction);
}

/** Send the centred viewer + card back and clear the centred indices. */
export function returnToIntro() {
  state.scenes[_currentSceneIdx]?.plate?.sendBack();
  _cards.get(_currentStepIdx)?.sendBack('backward');
  _currentSceneIdx = -1;
  _currentStepIdx = -1;
}

/** scroll-engine per frame — slide the next card in proportionally to scroll. */
export function setCardProgress(stepIndex, progress) {
  if (progress < 0.001) return;
  _cards.get(stepIndex + 1)?.scrub(progress);
}

export function lerpModelCamera(stepIndex, progress, stepsData) {
  if (stepIndex + 1 >= stepsData.length) return;                          // no next step
  if (getSceneIndex(stepIndex) !== getSceneIndex(stepIndex + 1)) return;  // crosses scenes
  const scene = state.scenes[getSceneIndex(stepIndex)];
  if (scene?.plate) scroll(scene, progress, stepsData[stepIndex], stepsData[stepIndex + 1]);
}

/**
 * Telar Story — card pool (orchestrator)
 *
 * Two axes:
 *   loaded / unloaded   ← the pool's job (files + GPU + budget)
 *   centred / back      ← the visual position (scroll / nav)
 *
 * PLATE (one viewer, permanent — these methods live in the plate):
 *   load()                   build player; loads its own libs (three.js) + file -> idempotent
 *   unload()                 free the player + GPU
 *   center(step)             move to front, frame to step
 *   sendBack()               slide off / behind
 *   goToStep(step, animate)  move camera to a step
 *   scroll(progress, a, b)   scroll interpolation between two steps
 */

import { state } from '../state.js';
import { buildScenes, getSceneIndex } from './card-pool-builder.js';
import { ModelPlate } from '../plates/model-plate.js';
import { TextCard } from './text-card.js';

const PLATE_TYPES = {
  model: ModelPlate,
  // image: IiifPlate,
};

const AHEAD = 2, BEHIND = 1; // viewer scenes kept loaded around the centred one
let _current = -1;           // centred scene index
let _currentStep = -1;       // centred step index (text/title card)
const _live = new Set();     // scene indices whose player is loaded
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
}

/** Load the viewer scenes in the [BEHIND, AHEAD] window around `centerIndex`; unload the rest. */
function setWindow(centerIndex) {
  const window = new Set();
  for (let d = -BEHIND; d <= AHEAD; d++) {
    const scene = state.scenes[centerIndex + d];
    if (!scene?.plate) continue;
    window.add(scene.index);
    if (!_live.has(scene.index)) { scene.plate.load(); _live.add(scene.index); }
  }
  for (const i of [..._live]) {
    if (!window.has(i)) { state.scenes[i].plate.unload(); _live.delete(i); }
  }
}

/** bring a viewer to the front: load its window, center it, send the previous back. */
function centerViewer(scene, step, direction) {
  if (scene.index === _current) {              // same scene, new step => move the camera
    scene.plate?.goToStep(step, !state.scrollDriven);
    return;
  }

  const prevScene = state.scenes[_current];
  _current = scene.index;

  setWindow(scene.index);
  scene.plate?.center(step);
  if (direction === 'backward') prevScene?.plate?.sendBack();
}

/** center the step's text/title card; send the previously-centred one back. */
function centerCard(stepIndex, direction) {
  if (stepIndex === _currentStep) return;
  _cards.get(_currentStep)?.sendBack(direction);
  _cards.get(stepIndex)?.center();
  _currentStep = stepIndex;
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

/**
 * Telar Story — card-pool builder
 *
 * Turns window.storyData into the DOM + `state` the orchestrator drives:
 *   state.scenes[i] = { index, type, objectId, z, firstStep, container }
 *   state.stepToScene[stepIndex] = sceneIndex
 *   state.viewerPlates[sceneIndex] = container
 *   state.textCards / state.titleCards = per-step card elements
 *
 * Build-time only: creates bare plate containers (no player) + text/title cards.
 * The geometry / z-index / messiness helpers are copied verbatim from the old
 * card-pool; only the scene-construction is adapted to the scene model above.
 */

import { state } from '../state.js';
import { detectCardType } from '../card-type.js';
import { escapeHtml } from '../utils.js';
import { isLandscapeSideCard, getLayoutMode, onViewportResize, onLayoutChange } from '../layout-mode.js';

let _config = { peekHeight: 1, messiness: 20 };
let _zPlan = { plateZ: {}, textCardZ: {} };

/** Build every scene's DOM + populate state. Called once by initPool(). */
export function buildScenes(storyData, config) {
  const cardStack = document.querySelector('.card-stack');
  if (!cardStack) return;

  const steps = (storyData?.steps || []).filter(s => !s._metadata);
  state.stepsData = steps;
  _config = { peekHeight: config?.peekHeight ?? 1, messiness: config?.messiness ?? 20 };

  _zPlan = computeZIndexPlan(steps);
  buildSceneMaps(steps);
  buildViewerPlates(cardStack);
  buildCards(steps, cardStack);

  onViewportResize(({ viewport }) => recomputeCardGeometry(viewport.w, viewport.h));
  onLayoutChange(({ viewport }) => recomputeCardGeometry(viewport.w, viewport.h));
  recomputeCardGeometry(window.innerWidth, window.innerHeight);
}

// ── Scene maps ────────────────────────────────────────────────────────────────

/** Walk steps, group same-object runs into scenes → state.scenes + state.stepToScene. */
function buildSceneMaps(steps) {
  state.stepToScene = {};
  state.scenes = [];
  let sceneIdx = -1;
  let currentId = null;
  let titleCounter = 0;

  for (let i = 0; i < steps.length; i++) {
    const objectId = steps[i].object || steps[i].objectId || '';
    const effectiveId = objectId === '' ? '__title_' + (titleCounter++) + '__' : objectId;
    if (effectiveId !== currentId) {
      sceneIdx++;
      currentId = effectiveId;
      state.scenes.push({ index: sceneIdx, objectId, firstStep: steps[i], firstStepIdx: i, z: _zPlan.plateZ[i] });
    }
    state.stepToScene[i] = sceneIdx;
  }
  state.totalScenes = sceneIdx + 1;
}

export function getSceneIndex(stepIndex) {
  return state.stepToScene[stepIndex] ?? -1;
}

// ── Viewer plate containers (one per object scene) ────────────────────────────

function buildViewerPlates(cardStack) {
  const audioObjects = window.audioObjects || {};
  const modelObjects = window.modelObjects || {};
  const filePathFor = (id) => {
    if (audioObjects[id]) return `objects/${id}.${audioObjects[id]}`;
    if (modelObjects[id]) return `objects/${id}.${modelObjects[id]}`;
    return '';
  };

  for (const scene of state.scenes) {
    if (!scene.objectId) { scene.type = 'title'; continue; } // title scene → no plate

    const objectData = state.objectsIndex[scene.objectId] || {};
    scene.type = detectCardType({
      objectId: scene.objectId,
      cardType: scene.firstStep.cardType,
      source_url: objectData.source_url || objectData.iiif_manifest || '',
      file_path: filePathFor(scene.objectId),
    });

    const el = document.createElement('div');
    el.className = 'viewer-plate';
    el.dataset.object = scene.objectId;
    el.dataset.scene = String(scene.index);
    el.dataset.cardType = scene.type;
    el.style.zIndex = scene.z;
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', buildAriaLabel(scene.objectId, scene.firstStep.alt_text, scene.type));
    el.style.transform = 'translateY(100%)';

    cardStack.appendChild(el);
    scene.container = el;
    state.viewerPlates[scene.index] = el;
  }
}

// ── Text + title cards (one per step) ─────────────────────────────────────────

function buildCards(steps, cardStack) {
  const viewportH = window.innerHeight;
  const cardH = viewportH * 0.80;
  const peekHeight = _config.peekHeight;
  const messinessPercent = _config.messiness;
  state.titleCards = {};
  const runPositions = {};

  for (let stepIdx = 0; stepIdx < steps.length; stepIdx++) {
    const step = steps[stepIdx];
    const objectId = step.object || step.objectId || '';

    if (!objectId) {
      const titleCard = document.createElement('div');
      titleCard.className = 'title-card';
      titleCard.dataset.stepIndex = String(stepIdx);
      titleCard.dataset.cardType = 'title';
      titleCard.style.zIndex = _zPlan.textCardZ[stepIdx];
      titleCard.style.transform = 'translateY(100vh)';
      titleCard.innerHTML = buildTitleCardContent(step);
      cardStack.appendChild(titleCard);
      state.titleCards[stepIdx] = titleCard;
      continue;
    }

    if (!Object.hasOwn(runPositions, objectId)) runPositions[objectId] = 0;
    const runPos = runPositions[objectId]++;

    const topPx = computeCardTop(viewportH, cardH, 0, peekHeight);
    const messiness = getCardMessiness(stepIdx, messinessPercent);

    const card = document.createElement('div');
    card.className = 'text-card';
    card.dataset.stepIndex = stepIdx;
    card.dataset.object = objectId;
    card.dataset.runPosition = runPos;
    card.style.zIndex = _zPlan.textCardZ[stepIdx];
    card.style.top = `${topPx}px`;
    card.style.height = `${cardH}px`;
    card.style.transform = buildTransform(messiness, 'translateY(100vh)');
    card.dataset.messinessRot = messiness.rot;
    card.dataset.messinessOffX = messiness.offX;
    card.dataset.messinessOffY = messiness.offY;

    // Jekyll already rendered the content into a hidden .step-data node; clone it.
    const hiddenStep = document.querySelector(`.step-data .story-step[data-step="${step.step}"]`);
    const content = hiddenStep?.querySelector('.step-content');
    if (content) card.appendChild(content.cloneNode(true));
    else card.innerHTML = buildTextCardContent(step);

    cardStack.appendChild(card);
    state.textCards[stepIdx] = card;
  }
}

// ── Geometry recompute on resize / layout change (verbatim) ───────────────────

function recomputeCardGeometry(viewportW, viewportH) {
  const peekHeight = _config.peekHeight ?? 1;
  const landscapeSideCard = isLandscapeSideCard();

  for (const card of document.querySelectorAll('.text-card')) {
    const runPos = parseInt(card.dataset.runPosition, 10) || 0;

    if (landscapeSideCard) {
      card.style.height = '';
      const cardH = card.offsetHeight;
      card.style.setProperty('top', `${computeCardTop(viewportH, cardH, runPos, peekHeight)}px`, 'important');
    } else if (getLayoutMode() === 'vertical') {
      card.style.removeProperty('top');
      card.style.height = `${viewportH * 0.80}px`;
    } else {
      const cardH = viewportH * 0.80;
      card.style.setProperty('top', `${computeCardTop(viewportH, cardH, runPos, peekHeight)}px`, 'important');
      card.style.height = `${cardH}px`;
    }
  }
}

// ── Z-index plan (verbatim) ───────────────────────────────────────────────────

function computeZIndexPlan(steps) {
  let scene = -1;
  let runPos = 0;
  let currentObjectId = null;
  let titleCounter = 0;
  const plateZ = {};
  const textCardZ = {};

  for (let i = 0; i < steps.length; i++) {
    const objectId = steps[i].object || steps[i].objectId || '';
    const effectiveId = objectId === '' ? '__title_' + (titleCounter++) + '__' : objectId;
    if (effectiveId !== currentObjectId) {
      scene++;
      runPos = 0;
      currentObjectId = effectiveId;
    }
    if (scene === 97) {
      console.warn('[Telar] Story has more than 98 unique scenes; z-index banding is clamped at 9800.');
    }
    const bandBase = Math.min((scene + 1) * 100, 9800);
    plateZ[i] = bandBase;
    textCardZ[i] = bandBase + 1 + runPos;
    runPos++;
  }

  return { plateZ, textCardZ };
}

// ── Messiness / peek geometry (verbatim, pure) ────────────────────────────────

function seededRandom(seed) {
  const n = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function getCardMessiness(seed, messinessPercent) {
  if (messinessPercent === 0) return { rot: 0, offX: 0, offY: 0 };
  const factor = messinessPercent / 100;
  const maxRot = 1.2 * factor, maxOffX = 8.0 * factor, maxOffY = 4.0 * factor;
  return {
    rot:  seededRandom(seed * 3 + 1) * maxRot  * 2 - maxRot,
    offX: seededRandom(seed * 3 + 2) * maxOffX * 2 - maxOffX,
    offY: seededRandom(seed * 3 + 3) * maxOffY * 2 - maxOffY,
  };
}

function computeCardTop(viewportH, cardH, runPosition, peekHeightPx) {
  return (viewportH - cardH) / 2 + runPosition * peekHeightPx;
}

function buildTransform(messiness, baseTranslate) {
  return `${baseTranslate} rotate(${messiness.rot}deg) translate(${messiness.offX}px, ${messiness.offY}px)`;
}

// ── Card content (verbatim) ───────────────────────────────────────────────────

function buildAriaLabel(objectId, stepAlt, cardType) {
  if (stepAlt) return stepAlt;
  const obj = state.objectsIndex?.[objectId] || {};
  if (obj.alt_text) return obj.alt_text;
  if (obj.title) return obj.title;
  if (objectId) return objectId;
  if (cardType === 'youtube' || cardType === 'vimeo' || cardType === 'google-drive') return 'Video player';
  if (cardType === 'audio') return 'Audio player';
  if (cardType === 'model') return '3D model viewer';
  return 'Image viewer';
}

function buildTextCardContent(step) {
  const question = escapeHtml(step.question || '');
  const answer = escapeHtml(step.answer || '');
  let layerButtons = '';
  if (step.layer1_button && step.layer1_button.trim()) {
    layerButtons += `<button class="panel-trigger" data-panel="layer1" data-step="${step.step}">${escapeHtml(step.layer1_button)}</button>`;
  }
  if (step.layer2_button && step.layer2_button.trim()) {
    layerButtons += `<button class="panel-trigger" data-panel="layer2" data-step="${step.step}">${escapeHtml(step.layer2_button)}</button>`;
  }
  return `
    <div class="step-question">${question}</div>
    <div class="step-answer">${answer}</div>
    ${layerButtons ? `<div class="step-actions">${layerButtons}</div>` : ''}
  `;
}

function buildTitleCardContent(step) {
  const heading = step.question || '';
  const body = step.answer || '';
  return `
    <div class="title-card-inner">
      <h2 class="title-card-heading">${heading}</h2>
      ${body ? '<p class="title-card-body">' + body + '</p>' : ''}
    </div>
  `;
}

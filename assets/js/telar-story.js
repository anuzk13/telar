(() => {
  // assets/js/telar-story/state.js
  var MOBILE_NAV_COOLDOWN = 400;
  var state = {
    // ── Navigation ───────────────────────────────────────────────────────────
    /** @type {HTMLElement[]} All .story-step elements in DOM order. */
    steps: [],
    /** Index of the current desktop step (-1 = none). */
    currentIndex: -1,
    /** Object ID currently displayed in the viewer. */
    currentObject: null,
    // ── Scroll engine ─────────────────────────────────────────────────────────
    /** Continuous float position (e.g. 2.3 = step 2, 30% progress). */
    scrollPosition: 0,
    /** Fractional progress within the current step (0.0–1.0). */
    scrollProgress: 0,
    /** Whether a snap animation is currently in flight. */
    isSnapping: false,
    /** Lenis instance reference — used by panels.js to stop/start scroll. */
    lenis: null,
    /** Snap plugin instance reference. */
    snap: null,
    // ── Viewer cards ─────────────────────────────────────────────────────────
    /** The viewer card object currently visible on screen. */
    currentViewerCard: null,
    /** @type {ViewerCard[]} Pool of viewer card objects. */
    viewerCards: [],
    /** Counter for generating unique viewer instance DOM IDs. */
    viewerCardCounter: 0,
    /** Quick lookup: object_id → object data from window.objectsData. */
    objectsIndex: {},
    // ── Panels ───────────────────────────────────────────────────────────────
    /** @type {{ type: string, id: string }[]} Stack of open panels. */
    panelStack: [],
    /** Whether any panel is currently open. */
    isPanelOpen: false,
    /** Whether scroll-lock is active (blocks step navigation). */
    scrollLockActive: false,
    /** Whether the user dismissed the credits badge this session. */
    creditsDismissed: false,
    // ── Autoplay policy ──────────────────────────────────────────────────────
    /** Set true on first play overlay tap; enables autoplay for all subsequent media cards. */
    hasUserInteracted: false,
    // ── Layout mode & embed ──────────────────────────────────────────────────
    /** @type {'horizontal' | 'vertical'} Layout mode. Updated by layout-mode.js on every resize/orientationchange. */
    layoutMode: "horizontal",
    /** Page-level boolean, set once at boot from window.telarEmbed.enabled. Orthogonal to layoutMode. */
    isEmbed: false,
    /** @type {DOMRect | null} Active text card's getBoundingClientRect; null when no active text card (title card, full-object mode). Populated by card-pool.js on activation + layout-mode.js on layoutchange. */
    cardOverlayRect: null,
    // ── Mobile button navigation ─────────────────────────────────────────────
    /** Index of the current step in mobile/embed button mode. */
    currentMobileStep: 0,
    /** Whether mobile navigation is showing the intro card (before step 0). */
    mobileInIntro: false,
    /** References to the prev/next button DOM elements. */
    mobileNavButtons: null,
    /** Whether mobile navigation is in its cooldown period. */
    mobileNavigationCooldown: false,
    // ── Connection speed ─────────────────────────────────────────────────────
    /** @type {number[]} Measured manifest fetch times (ms) for threshold tuning. */
    manifestLoadTimes: [],
    // ── Card pool ────────────────────────────────────────────────────────────
    /** @type {Object[]} Pool of active card instances. */
    cardPool: [],
    /** Map of sceneIndex -> viewer plate element (one plate per scene). */
    viewerPlates: {},
    /** Map of stepIndex -> text card element. */
    textCards: {},
    /** Current object run tracking (for peek stack positioning). */
    currentObjectRun: { objectId: null, runPosition: 0 },
    // ── Scene maps (populated at initCardPool time) ───────────────────────────
    /**
     * Filtered step data (metadata rows removed), in the same index space as
     * stepToScene / the card pool. Populated by initCardPool. The per-frame
     * lerp reads this so its stepIndex (a filtered-space index) lines up with
     * the step objects it interpolates between.
     */
    stepsData: [],
    /** Map of stepIndex -> sceneIndex. Populated by buildSceneMaps at init. */
    stepToScene: {},
    /** Map of sceneIndex -> objectId. */
    sceneToObject: {},
    /** Map of sceneIndex -> first stepIndex in that scene. */
    sceneFirstStep: {},
    /** Total number of scenes in the story. */
    totalScenes: 0,
    // ── Viewer preloading config (set from telarConfig in main.js) ───────────
    config: {
      /** Maximum IIIF wrapper instances kept in memory (per-scene pool cap). */
      maxViewerCards: 8,
      /** Steps to preload ahead of the current position. */
      preloadSteps: 6,
      /** Show loading shimmer when story has >= this many unique viewers. */
      loadingThreshold: 5,
      /** Hide shimmer once this many viewers are ready. */
      minReadyViewers: 3
    }
  };

  // assets/js/telar-story/layout-mode.js
  var layoutChangeSubs = /* @__PURE__ */ new Set();
  var viewportResizeSubs = /* @__PURE__ */ new Set();
  var _cachedMode = null;
  var _breakpoints = null;
  var _modeMql = null;
  var _resizeTimer = null;
  var DEBOUNCE_MS = 100;
  var _initialized = false;
  function _readBreakpoints() {
    const cs = getComputedStyle(document.documentElement);
    const minW = parseFloat(cs.getPropertyValue("--telar-vertical-min-width").trim()) || 1024;
    const minA = parseFloat(cs.getPropertyValue("--telar-vertical-min-aspect").trim()) || 0.75;
    return { verticalMinWidth: minW, verticalMinAspect: minA };
  }
  function _evaluateMode() {
    return _modeMql.matches ? "vertical" : "horizontal";
  }
  function _dispatchLayoutChange() {
    const next = _evaluateMode();
    const prev = _cachedMode;
    _cachedMode = next;
    if (prev !== null && prev !== next) {
      const viewport = { w: window.innerWidth, h: window.innerHeight };
      for (const cb of layoutChangeSubs) {
        try {
          cb({ from: prev, to: next, viewport, isEmbed: state.isEmbed });
        } catch (e) {
          console.error("[layout-mode] onLayoutChange handler threw:", e);
        }
      }
    }
  }
  function _dispatchViewportResize() {
    const viewport = { w: window.innerWidth, h: window.innerHeight };
    for (const cb of viewportResizeSubs) {
      try {
        cb({ viewport });
      } catch (e) {
        console.error("[layout-mode] onViewportResize handler threw:", e);
      }
    }
  }
  function _onResize() {
    if (_resizeTimer) clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(_dispatchViewportResize, DEBOUNCE_MS);
  }
  function _onOrientationChange() {
    if (_resizeTimer) clearTimeout(_resizeTimer);
    _dispatchLayoutChange();
    _dispatchViewportResize();
  }
  function _initOnce() {
    if (_initialized) return;
    _initialized = true;
    _breakpoints = _readBreakpoints();
    const { verticalMinWidth: minW, verticalMinAspect: minA } = _breakpoints;
    _modeMql = window.matchMedia(`(max-width: ${minW}px), (max-aspect-ratio: ${minA})`);
    _cachedMode = _evaluateMode();
    _modeMql.addEventListener("change", _dispatchLayoutChange);
    window.addEventListener("resize", _onResize, { passive: true });
    window.addEventListener("orientationchange", _onOrientationChange, { passive: true });
  }
  function getLayoutMode() {
    _initOnce();
    return _cachedMode;
  }
  function onLayoutChange(cb) {
    _initOnce();
    layoutChangeSubs.add(cb);
    return () => layoutChangeSubs.delete(cb);
  }
  function onViewportResize(cb) {
    _initOnce();
    viewportResizeSubs.add(cb);
    return () => viewportResizeSubs.delete(cb);
  }
  function isLandscapeSideCard() {
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--telar-card-landscape-max-height");
    const maxH = parseFloat(raw) || 480;
    return window.matchMedia(`(max-height: ${maxH}px)`).matches;
  }

  // assets/js/telar-story/utils.js
  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text == null ? "" : String(text);
    return div.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function getBasePath() {
    const pathParts = window.location.pathname.split("/").filter((p) => p);
    if (pathParts.length >= 2) {
      return "/" + pathParts.slice(0, -2).join("/");
    }
    return "";
  }
  function fixImageUrls(htmlContent, basePath) {
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = htmlContent;
    const images = tempDiv.querySelectorAll("img");
    images.forEach((img) => {
      const src = img.getAttribute("src");
      if (src && src.startsWith("/") && !src.startsWith("//")) {
        img.setAttribute("src", basePath + src);
      }
    });
    return tempDiv.innerHTML;
  }

  // assets/js/telar-story/viewer.js
  function buildObjectsIndex() {
    const objects = window.objectsData || [];
    objects.forEach((obj) => {
      state.objectsIndex[obj.object_id] = obj;
    });
  }
  function getManifestUrl(objectId, page) {
    const object = state.objectsIndex[objectId];
    if (!object) {
      console.warn("Object not found:", objectId);
      return buildLocalInfoJsonUrl(objectId, page);
    }
    const sourceUrl = object.source_url || object.iiif_manifest;
    if (sourceUrl && sourceUrl.trim() !== "") {
      return sourceUrl;
    }
    return buildLocalInfoJsonUrl(objectId, page);
  }
  function buildLocalInfoJsonUrl(objectId, page) {
    const basePath = getBasePath();
    if (page) {
      const manifestUrl2 = `${window.location.origin}${basePath}/iiif/objects/${objectId}/page-${page}/manifest.json`;
      return manifestUrl2;
    }
    const manifestUrl = `${window.location.origin}${basePath}/iiif/objects/${objectId}/manifest.json`;
    return manifestUrl;
  }
  var _PREFETCH_SKIP_HOSTS = ["youtube.com", "youtu.be", "vimeo.com", "drive.google.com"];
  async function prefetchStoryManifests() {
    const objectIds = [...new Set(
      Array.from(document.querySelectorAll("[data-object]")).map((el) => el.dataset.object).filter(Boolean)
    )];
    if (objectIds.length === 0) return;
    const manifestUrls = [...new Set(
      objectIds.map((id) => state.objectsIndex[id]).map((o) => (o && (o.source_url || o.iiif_manifest) || "").trim()).filter((url) => url && !_PREFETCH_SKIP_HOSTS.some((h) => url.includes(h)))
    )];
    if (manifestUrls.length === 0) {
      adjustThresholdsForConnection();
      return;
    }
    const CONCURRENCY = 3;
    const queue = [...manifestUrls];
    const worker = async () => {
      while (queue.length) {
        const url = queue.shift();
        try {
          const start = performance.now();
          const resp = await fetch(url, { cache: "force-cache" });
          await resp.text().catch(() => {
          });
          state.manifestLoadTimes.push(performance.now() - start);
        } catch (e) {
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker)
    );
    adjustThresholdsForConnection();
  }
  function adjustThresholdsForConnection() {
    if (state.manifestLoadTimes.length < 2) return;
    const avgTime = state.manifestLoadTimes.reduce((a, b) => a + b, 0) / state.manifestLoadTimes.length;
    if (avgTime > 1e3) {
      state.config.loadingThreshold = 1;
      state.config.minReadyViewers = Math.min(6, state.config.preloadSteps);
    } else if (avgTime > 500) {
      state.config.loadingThreshold = Math.max(3, state.config.loadingThreshold - 2);
      state.config.minReadyViewers = Math.min(state.config.minReadyViewers + 1, state.config.preloadSteps);
    }
  }
  function initializeLoadingShimmer() {
    const uniqueViewers = new Set(
      state.steps.map((step) => step.dataset.object).filter(Boolean)
    ).size;
    if (uniqueViewers >= state.config.loadingThreshold) {
      showViewerSkeletonState();
      const checkReadyViewers = () => {
        const readyCount = state.viewerCards.filter((v) => v.isReady).length;
        const targetReady = Math.min(state.config.minReadyViewers, uniqueViewers);
        if (readyCount >= targetReady) {
          hideViewerSkeletonState();
        } else {
          setTimeout(checkReadyViewers, 200);
        }
      };
      setTimeout(checkReadyViewers, 500);
    }
  }
  function showViewerSkeletonState() {
    const container = document.getElementById("viewer-cards-container");
    if (container) {
      container.classList.add("skeleton-loading");
    }
  }
  function hideViewerSkeletonState() {
    const container = document.getElementById("viewer-cards-container");
    if (container) {
      container.classList.remove("skeleton-loading");
    }
  }
  function initializeCredits() {
    if (!window.telarConfig?.showObjectCredits) return;
    const dismissBtn = document.getElementById("object-credits-dismiss");
    if (dismissBtn) {
      dismissBtn.addEventListener("click", function() {
        const badge = document.getElementById("object-credits-badge");
        if (badge) badge.classList.add("d-none");
        state.creditsDismissed = true;
      });
    }
  }

  // assets/js/telar-story/card-type.js
  var YOUTUBE_RE = /(?:youtube\.com\/(?:watch\?.*v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;
  var VIMEO_RE = /vimeo\.com\/(?:video\/)?(\d+)/;
  var GDRIVE_RE = /drive\.google\.com\/(?:file\/d\/|open\?id=)([A-Za-z0-9_-]+)/;
  var AUDIO_FILE_RE = /\.(mp3|ogg|m4a)$/i;
  var MODEL_FILE_RE = /\.(glb|gltf)$/i;
  function detectCardType(stepData) {
    if (stepData.cardType && stepData.cardType !== "") return stepData.cardType;
    if (!stepData.objectId || stepData.objectId === "") return "text-only";
    const sourceUrl = stepData.source_url || "";
    if (YOUTUBE_RE.test(sourceUrl)) return "youtube";
    if (VIMEO_RE.test(sourceUrl)) return "vimeo";
    if (GDRIVE_RE.test(sourceUrl)) return "google-drive";
    const filePath = stepData.file_path || "";
    if (AUDIO_FILE_RE.test(filePath)) return "audio";
    if (MODEL_FILE_RE.test(filePath)) return "model";
    return "iiif";
  }

  // assets/js/telar-story/cards/card-pool-builder.js
  var _config = { peekHeight: 1, messiness: 20 };
  var _zPlan = { plateZ: {}, textCardZ: {} };
  function buildScenes(storyData, config) {
    const cardStack = document.querySelector(".card-stack");
    if (!cardStack) return;
    const steps = (storyData?.steps || []).filter((s) => !s._metadata);
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
  function buildSceneMaps(steps) {
    state.stepToScene = {};
    state.scenes = [];
    let sceneIdx = -1;
    let currentId = null;
    let titleCounter = 0;
    for (let i = 0; i < steps.length; i++) {
      const objectId = steps[i].object || steps[i].objectId || "";
      const effectiveId = objectId === "" ? "__title_" + titleCounter++ + "__" : objectId;
      if (effectiveId !== currentId) {
        sceneIdx++;
        currentId = effectiveId;
        state.scenes.push({ index: sceneIdx, objectId, firstStep: steps[i], firstStepIdx: i, z: _zPlan.plateZ[i] });
      }
      state.stepToScene[i] = sceneIdx;
    }
    state.totalScenes = sceneIdx + 1;
  }
  function getSceneIndex(stepIndex) {
    return state.stepToScene[stepIndex] ?? -1;
  }
  function buildViewerPlates(cardStack) {
    const audioObjects = window.audioObjects || {};
    const modelObjects = window.modelObjects || {};
    const filePathFor = (id) => {
      if (audioObjects[id]) return `objects/${id}.${audioObjects[id]}`;
      if (modelObjects[id]) return `objects/${id}.${modelObjects[id]}`;
      return "";
    };
    for (const scene of state.scenes) {
      if (!scene.objectId) {
        scene.type = "title";
        continue;
      }
      const objectData = state.objectsIndex[scene.objectId] || {};
      scene.type = detectCardType({
        objectId: scene.objectId,
        cardType: scene.firstStep.cardType,
        source_url: objectData.source_url || objectData.iiif_manifest || "",
        file_path: filePathFor(scene.objectId)
      });
      const el = document.createElement("div");
      el.className = "viewer-plate";
      el.dataset.object = scene.objectId;
      el.dataset.scene = String(scene.index);
      el.dataset.cardType = scene.type;
      el.style.zIndex = scene.z;
      el.setAttribute("role", "img");
      el.setAttribute("aria-label", buildAriaLabel(scene.objectId, scene.firstStep.alt_text, scene.type));
      el.style.transform = "translateY(100%)";
      cardStack.appendChild(el);
      scene.container = el;
      state.viewerPlates[scene.index] = el;
    }
  }
  function buildCards(steps, cardStack) {
    const viewportH = window.innerHeight;
    const cardH = viewportH * 0.8;
    const peekHeight = _config.peekHeight;
    const messinessPercent = _config.messiness;
    state.titleCards = {};
    const runPositions = {};
    for (let stepIdx = 0; stepIdx < steps.length; stepIdx++) {
      const step = steps[stepIdx];
      const objectId = step.object || step.objectId || "";
      if (!objectId) {
        const titleCard = document.createElement("div");
        titleCard.className = "title-card";
        titleCard.dataset.stepIndex = String(stepIdx);
        titleCard.dataset.cardType = "title";
        titleCard.style.zIndex = _zPlan.textCardZ[stepIdx];
        titleCard.style.transform = "translateY(100vh)";
        titleCard.innerHTML = buildTitleCardContent(step);
        cardStack.appendChild(titleCard);
        state.titleCards[stepIdx] = titleCard;
        continue;
      }
      if (!Object.hasOwn(runPositions, objectId)) runPositions[objectId] = 0;
      const runPos = runPositions[objectId]++;
      const topPx = computeCardTop(viewportH, cardH, 0, peekHeight);
      const messiness = getCardMessiness(stepIdx, messinessPercent);
      const card = document.createElement("div");
      card.className = "text-card";
      card.dataset.stepIndex = stepIdx;
      card.dataset.object = objectId;
      card.dataset.runPosition = runPos;
      card.style.zIndex = _zPlan.textCardZ[stepIdx];
      card.style.top = `${topPx}px`;
      card.style.height = `${cardH}px`;
      card.style.transform = buildTransform(messiness, "translateY(100vh)");
      card.dataset.messinessRot = messiness.rot;
      card.dataset.messinessOffX = messiness.offX;
      card.dataset.messinessOffY = messiness.offY;
      const hiddenStep = document.querySelector(`.step-data .story-step[data-step="${step.step}"]`);
      const content = hiddenStep?.querySelector(".step-content");
      if (content) card.appendChild(content.cloneNode(true));
      else card.innerHTML = buildTextCardContent(step);
      cardStack.appendChild(card);
      state.textCards[stepIdx] = card;
    }
  }
  function recomputeCardGeometry(viewportW, viewportH) {
    const peekHeight = _config.peekHeight ?? 1;
    const landscapeSideCard = isLandscapeSideCard();
    for (const card of document.querySelectorAll(".text-card")) {
      const runPos = parseInt(card.dataset.runPosition, 10) || 0;
      if (landscapeSideCard) {
        card.style.height = "";
        const cardH = card.offsetHeight;
        card.style.setProperty("top", `${computeCardTop(viewportH, cardH, runPos, peekHeight)}px`, "important");
      } else if (getLayoutMode() === "vertical") {
        card.style.removeProperty("top");
        card.style.height = `${viewportH * 0.8}px`;
      } else {
        const cardH = viewportH * 0.8;
        card.style.setProperty("top", `${computeCardTop(viewportH, cardH, runPos, peekHeight)}px`, "important");
        card.style.height = `${cardH}px`;
      }
    }
  }
  function computeZIndexPlan(steps) {
    let scene = -1;
    let runPos = 0;
    let currentObjectId = null;
    let titleCounter = 0;
    const plateZ = {};
    const textCardZ = {};
    for (let i = 0; i < steps.length; i++) {
      const objectId = steps[i].object || steps[i].objectId || "";
      const effectiveId = objectId === "" ? "__title_" + titleCounter++ + "__" : objectId;
      if (effectiveId !== currentObjectId) {
        scene++;
        runPos = 0;
        currentObjectId = effectiveId;
      }
      if (scene === 97) {
        console.warn("[Telar] Story has more than 98 unique scenes; z-index banding is clamped at 9800.");
      }
      const bandBase = Math.min((scene + 1) * 100, 9800);
      plateZ[i] = bandBase;
      textCardZ[i] = bandBase + 1 + runPos;
      runPos++;
    }
    return { plateZ, textCardZ };
  }
  function seededRandom(seed) {
    const n = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
    return n - Math.floor(n);
  }
  function getCardMessiness(seed, messinessPercent) {
    if (messinessPercent === 0) return { rot: 0, offX: 0, offY: 0 };
    const factor = messinessPercent / 100;
    const maxRot = 1.2 * factor, maxOffX = 8 * factor, maxOffY = 4 * factor;
    return {
      rot: seededRandom(seed * 3 + 1) * maxRot * 2 - maxRot,
      offX: seededRandom(seed * 3 + 2) * maxOffX * 2 - maxOffX,
      offY: seededRandom(seed * 3 + 3) * maxOffY * 2 - maxOffY
    };
  }
  function computeCardTop(viewportH, cardH, runPosition, peekHeightPx) {
    return (viewportH - cardH) / 2 + runPosition * peekHeightPx;
  }
  function buildTransform(messiness, baseTranslate) {
    return `${baseTranslate} rotate(${messiness.rot}deg) translate(${messiness.offX}px, ${messiness.offY}px)`;
  }
  function buildAriaLabel(objectId, stepAlt, cardType) {
    if (stepAlt) return stepAlt;
    const obj = state.objectsIndex?.[objectId] || {};
    if (obj.alt_text) return obj.alt_text;
    if (obj.title) return obj.title;
    if (objectId) return objectId;
    if (cardType === "youtube" || cardType === "vimeo" || cardType === "google-drive") return "Video player";
    if (cardType === "audio") return "Audio player";
    if (cardType === "model") return "3D model viewer";
    return "Image viewer";
  }
  function buildTextCardContent(step) {
    const question = escapeHtml(step.question || "");
    const answer = escapeHtml(step.answer || "");
    let layerButtons = "";
    if (step.layer1_button && step.layer1_button.trim()) {
      layerButtons += `<button class="panel-trigger" data-panel="layer1" data-step="${step.step}">${escapeHtml(step.layer1_button)}</button>`;
    }
    if (step.layer2_button && step.layer2_button.trim()) {
      layerButtons += `<button class="panel-trigger" data-panel="layer2" data-step="${step.step}">${escapeHtml(step.layer2_button)}</button>`;
    }
    return `
    <div class="step-question">${question}</div>
    <div class="step-answer">${answer}</div>
    ${layerButtons ? `<div class="step-actions">${layerButtons}</div>` : ""}
  `;
  }
  function buildTitleCardContent(step) {
    const heading = step.question || "";
    const body = step.answer || "";
    return `
    <div class="title-card-inner">
      <h2 class="title-card-heading">${heading}</h2>
      ${body ? '<p class="title-card-body">' + body + "</p>" : ""}
    </div>
  `;
  }

  // assets/js/telar-story/plates/base-plate.js
  var Plate = class {
    static containerClass = "base-plate";
    static deps = () => Promise.resolve();
    // libraries this type needs (subclass overrides)
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
      this.container.querySelector(".telar-alert")?.remove();
      delete this.container.dataset.loading;
    }
    /** Bring to the front. */
    centerPlate() {
      this.load();
      this.container.style.zIndex = this.zIndex;
      this.container.style.transform = "translateY(0)";
      this.container.classList.add("is-active");
    }
    /** Settle plate off screen */
    sendBack(direction) {
      this.container.classList.remove("is-active");
      if (direction === "backward") {
        this.container.style.transform = "translateY(100%)";
      }
    }
    /** Move the camera to a step (snap, or ease when animate). */
    goToStep(step, animate = false) {
    }
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
    scrollContent(progress, stepA, stepB) {
    }
    /** React to a viewport resize. */
    resize() {
    }
    /** Build the player */
    _build() {
    }
    /** Free the player */
    _teardown() {
    }
  };

  // assets/js/3d-helpers.js
  function createRenderer(container) {
    const THREE = window.THREE;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearAlpha(0);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);
    return renderer;
  }
  function resizeRendererToContainer(renderer, camera, container) {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
  }
  function getDistanceToFitSphere(camera, radius) {
    const vFOV = camera.getEffectiveFOV() * Math.PI / 180;
    const hFOV = Math.atan(Math.tan(vFOV * 0.5) * camera.aspect) * 2;
    const fov = 1 < camera.aspect ? vFOV : hFOV;
    return radius / Math.sin(fov * 0.5);
  }
  function fitCameraToModel(camera, model) {
    const THREE = window.THREE;
    const box = new THREE.Box3();
    box.setFromObject(model);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const distance = getDistanceToFitSphere(camera, sphere.radius);
    const c = sphere.center;
    camera.position.set(c.x, c.y, c.z + distance);
    camera.lookAt(c);
    return { target: [c.x, c.y, c.z], distance, radius: sphere.radius };
  }
  function setupNeutralEnvironment(renderer, scene) {
    const THREE = window.THREE;
    const RoomEnvironment = window.RoomEnvironment;
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment()).texture;
    pmremGenerator.dispose();
  }

  // assets/js/telar-story/plates/model-plate.js
  var _threePromise;
  function loadThree() {
    if (_threePromise) return _threePromise;
    _threePromise = new Promise((resolve, reject) => {
      if (window.THREE) return resolve();
      const s = document.createElement("script");
      s.src = `${getBasePath()}/assets/vendor/umd_threejs.js`;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("three.js failed to load"));
      document.head.appendChild(s);
    });
    return _threePromise;
  }
  var ModelPlate = class extends Plate {
    static containerClass = "model-plate";
    static deps = loadThree;
    constructor(container, objectId, sceneIndex, zIndex, initialStep, initialStepIdx) {
      super(container, objectId, sceneIndex, zIndex, initialStep, initialStepIdx);
      this._renderer = null;
      this._scene = null;
      this._camera = null;
      this._model = null;
      this._autoFraming = null;
      this._cameraControl = null;
    }
    /** Build renderer + load the GLB. Resolves when the model's first frame is ready. */
    _build() {
      const THREE = window.THREE;
      const GLTFLoader = window.GLTFLoader;
      const ext = window.modelObjects[this.objectId];
      const url = `${getBasePath()}/telar-content/objects/${this.objectId}.${ext}`;
      this.container.dataset.loading = "true";
      const renderer = createRenderer(this.container);
      renderer.domElement.className = "model-instance";
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(
        45,
        this.container.clientWidth / this.container.clientHeight,
        0.01,
        1e3
      );
      setupNeutralEnvironment(renderer, scene);
      this._renderer = renderer;
      this._scene = scene;
      this._camera = camera;
      return new Promise((resolve, reject) => {
        new GLTFLoader().load(
          url,
          (gltf) => {
            if (!this._renderer) return;
            this._model = gltf.scene;
            scene.add(gltf.scene);
            this._autoFraming = fitCameraToModel(camera, gltf.scene);
            this._cameraControl = new CameraControl(camera, () => this._render());
            this._applyViewOffset();
            delete this.container.dataset.loading;
            this.goToStep(this._currentStep, false);
            this._render();
            resolve();
          },
          void 0,
          (err) => {
            delete this.container.dataset.loading;
            this._injectModelError();
            reject(err);
          }
        );
      });
    }
    _render() {
      this._renderer.render(this._scene, this._camera);
    }
    resize() {
      if (!this._renderer) return;
      resizeRendererToContainer(this._renderer, this._camera, this.container);
      this._applyViewOffset();
      this._render();
    }
    /**
     * Apply the view offset based on the current layout mode so the model bleeds behind the card view
     */
    _applyViewOffset() {
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      if (getLayoutMode() === "vertical") {
        this._camera.setViewOffset(w, h, 0, 0.2 * h, w, h);
      } else {
        this._camera.setViewOffset(w, h, -0.2 * w, 0, w, h);
      }
    }
    /** Free the renderer, GPU resources and WebGL context. */
    _teardown() {
      this._cameraControl?.stopAnimation();
      this._scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of materials) {
          if (!m) continue;
          for (const key in m) {
            if (m[key] && m[key].isTexture) m[key].dispose();
          }
          m.dispose();
        }
      });
      if (this._scene.environment) this._scene.environment.dispose();
      this._renderer.dispose();
      this._renderer.forceContextLoss();
      this._renderer.domElement.remove();
      this._renderer = null;
      this._scene = null;
      this._camera = null;
      this._model = null;
      this._autoFraming = null;
      this._cameraControl = null;
    }
    sendBack() {
      super.sendBack();
      this._cameraControl?.stopAnimation();
    }
    /** Move to a step pose: eased on discrete navigation, snapped otherwise. */
    goToStep(step, animate = false) {
      this._currentStep = step;
      if (!this._cameraControl) return;
      const pose = this._resolvePose(step);
      if (animate) this._cameraControl.ease(pose);
      else this._cameraControl.snap(pose);
    }
    /** Interpolate the camera between two steps by scroll progress. */
    scrollContent(progress, stepA, stepB) {
      if (!this._cameraControl) return;
      this._cameraControl.lerp(this._resolvePose(stepA), this._resolvePose(stepB), progress);
    }
    /**
     * Resolve a step's framing columns to a numeric pose
     *
     * @returns {{ azimuth: number, elevation: number, distance: number, target: number[] }}
     */
    _resolvePose(step) {
      const [azimuth, elevation, distance] = this._stepOrbit(step);
      const target = this._stepTarget(step);
      return { azimuth, elevation, distance, target };
    }
    /**
     * Read a step's orbit columns into [azimuth, elevation, distance]; empty values
     * default to 0° / 75° / the model's ideal framing distance.
     */
    _stepOrbit(step) {
      const az = this._num(step.azimuth) ?? 0;
      const el = this._num(step.elevation) ?? 75;
      const dist = this._num(step.distance) ?? this._autoFraming.distance;
      return [az, el, dist];
    }
    /**
     * Read a step's look-at target into [x, y, z] metres; empty values default to
     * the model's bounding-sphere centre.
     */
    _stepTarget(step) {
      const x = this._num(step.target_x) ?? this._autoFraming.target[0];
      const y = this._num(step.target_y) ?? this._autoFraming.target[1];
      const z = this._num(step.target_z) ?? this._autoFraming.target[2];
      return [x, y, z];
    }
    /**
     * Parse story value as number or null
     */
    _num(v) {
      const n = parseFloat(v);
      return Number.isNaN(n) ? null : n;
    }
    /**
     * Inject a .telar-alert error notification into the model plate.
     */
    _injectModelError() {
      if (this.container.querySelector(".telar-alert")) return;
      const alertEl = document.createElement("div");
      alertEl.className = "alert alert-warning telar-alert";
      alertEl.setAttribute("role", "alert");
      alertEl.innerHTML = `<strong>3D model unavailable</strong>
<p>This 3D model could not be loaded. Continue scrolling to read the story.</p>`;
      this.container.appendChild(alertEl);
    }
  };
  var EASE_DURATION = 600;
  var CameraControl = class {
    constructor(camera, onChange) {
      this._camera = camera;
      this._onChange = onChange;
      this._pose = null;
      this._animFrame = null;
    }
    /** 
     * Fix a pose
     **/
    snap(pose) {
      this.stopAnimation();
      this._positionCamera(pose);
    }
    /** 
     * Lerp between two poses over t in [0, 1] and show the intermediate pose.
     **/
    lerp(a, b, t) {
      this._positionCamera({
        azimuth: a.azimuth + (b.azimuth - a.azimuth) * t,
        elevation: a.elevation + (b.elevation - a.elevation) * t,
        distance: a.distance + (b.distance - a.distance) * t,
        target: [
          a.target[0] + (b.target[0] - a.target[0]) * t,
          a.target[1] + (b.target[1] - a.target[1]) * t,
          a.target[2] + (b.target[2] - a.target[2]) * t
        ]
      });
    }
    /** 
     * Animate to a specific pose
     **/
    ease(to) {
      this.stopAnimation();
      const from = this._pose;
      const start = performance.now();
      const tick = (now) => {
        const t = Math.min((now - start) / EASE_DURATION, 1);
        this.lerp(from, to, t);
        this._animFrame = t < 1 ? requestAnimationFrame(tick) : null;
      };
      this._animFrame = requestAnimationFrame(tick);
    }
    stopAnimation() {
      if (this._animFrame) {
        cancelAnimationFrame(this._animFrame);
        this._animFrame = null;
      }
    }
    /** 
     * Position the camera from a pose around its target
     **/
    _positionCamera(pose) {
      const THREE = window.THREE;
      const offset = new THREE.Vector3().setFromSphericalCoords(
        pose.distance,
        THREE.MathUtils.degToRad(pose.elevation),
        THREE.MathUtils.degToRad(pose.azimuth)
      );
      this._camera.position.set(pose.target[0], pose.target[1], pose.target[2]).add(offset);
      this._camera.lookAt(pose.target[0], pose.target[1], pose.target[2]);
      this._pose = pose;
      this._onChange();
    }
  };

  // assets/js/telar-story/cards/text-card.js
  var TextCard = class {
    constructor(el, stepIndex) {
      this.el = el;
      this.stepIndex = stepIndex;
      this.messiness = {
        rot: parseFloat(el.dataset.messinessRot || 0),
        offX: parseFloat(el.dataset.messinessOffX || 0),
        offY: parseFloat(el.dataset.messinessOffY || 0)
      };
    }
    /** Slide up into view */
    center() {
      const rot = state.layoutMode === "vertical" ? this.messiness.rot * 0.5 : this.messiness.rot;
      this.el.classList.remove("is-stacked");
      this.el.classList.add("is-active");
      this.el.style.transform = this._transform("0", rot);
    }
    /** Slide off / behind. */
    sendBack(direction) {
      this.el.classList.remove("is-active");
      if (direction === "backward") {
        this.el.classList.remove("is-stacked");
        this.el.style.transform = this._transform("100vh", this.messiness.rot);
      } else {
        this.el.classList.add("is-stacked");
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
  };

  // assets/js/telar-story/cards/card-pool.js
  var PLATE_TYPES = {
    model: ModelPlate
    // image: IiifPlate,
  };
  var AHEAD = 2;
  var BEHIND = 1;
  var _currentSceneIdx = -1;
  var _currentStepIdx = -1;
  var _liveSceneIdxs = /* @__PURE__ */ new Set();
  var _cards = /* @__PURE__ */ new Map();
  var _plates = /* @__PURE__ */ new Map();
  var CARD_SLIDE_MS = 550;
  var _slideTimer;
  var _cardStackElem;
  function enableCardSlide() {
    _cardStackElem.classList.add("is-animating");
    clearTimeout(_slideTimer);
    _slideTimer = setTimeout(() => _cardStackElem.classList.remove("is-animating"), CARD_SLIDE_MS);
  }
  function hasPlate(scene) {
    return scene?.type === "model";
  }
  function makePlate(scene) {
    const Plate2 = PLATE_TYPES[scene.type];
    return new Plate2(scene.container, scene.objectId, scene.index, scene.z, scene.firstStep, scene.firstStepIdx);
  }
  function resizeLivePlates() {
    for (const i of _liveSceneIdxs) _plates.get(i).resize();
  }
  function setWindow(centerIndex) {
    const window2 = /* @__PURE__ */ new Set();
    for (let d = -BEHIND; d <= AHEAD; d++) {
      const sceneIndex = centerIndex + d;
      const plate = _plates.get(sceneIndex);
      if (!plate) continue;
      window2.add(sceneIndex);
      if (!_liveSceneIdxs.has(sceneIndex)) {
        plate.load();
        _liveSceneIdxs.add(sceneIndex);
      }
    }
    for (const i of [..._liveSceneIdxs]) {
      if (!window2.has(i)) {
        _plates.get(i).unload();
        _liveSceneIdxs.delete(i);
      }
    }
  }
  function initCardPool(storyData, config) {
    _cardStackElem = document.querySelector(".card-stack");
    buildScenes(storyData, config);
    for (const scene of state.scenes) {
      if (hasPlate(scene)) _plates.set(scene.index, makePlate(scene));
    }
    for (const idx in state.textCards) _cards.set(+idx, new TextCard(state.textCards[idx], +idx));
    for (const idx in state.titleCards) _cards.set(+idx, new TextCard(state.titleCards[idx], +idx));
    setWindow(getSceneIndex(0));
    onViewportResize(resizeLivePlates);
  }
  function activateCard(stepIndex, animate = false) {
    if (animate) enableCardSlide();
    _cards.get(stepIndex)?.center();
    const sceneIndex = getSceneIndex(stepIndex);
    _plates.get(sceneIndex)?.goToStep(state.stepsData[stepIndex], animate);
    if (sceneIndex !== _currentSceneIdx) {
      _plates.get(_currentSceneIdx)?.sendBack();
      setWindow(sceneIndex);
      _plates.get(sceneIndex)?.centerPlate();
    }
    _currentSceneIdx = sceneIndex;
    _currentStepIdx = stepIndex;
  }
  function deactivateCard(stepIndex, direction) {
    _cards.get(stepIndex)?.sendBack(direction);
  }
  function returnToIntro() {
    _plates.get(0)?.sendBack("backward");
    _cards.get(0)?.sendBack("backward");
    _currentSceneIdx = -1;
    _currentStepIdx = -1;
  }
  function scrollCardPool(scrollProgress) {
    const stepsData = state.stepsData;
    const clamped = Math.min(stepsData.length - 1, scrollProgress);
    const stepIndex = Math.floor(clamped);
    const progress = clamped - stepIndex;
    if (stepIndex !== _currentStepIdx) {
      const prevStep2 = _currentStepIdx;
      const direction = stepIndex > prevStep2 ? "forward" : "backward";
      activateCard(stepIndex, false);
      if (prevStep2 >= 0) deactivateCard(prevStep2, direction);
    }
    if (stepIndex + 1 < stepsData.length && getSceneIndex(stepIndex) === getSceneIndex(stepIndex + 1)) {
      _plates.get(getSceneIndex(stepIndex))?.scrollContent(progress, stepsData[stepIndex], stepsData[stepIndex + 1]);
    }
    for (const [_, card] of _cards) card.scrollPos(scrollProgress);
    for (const i of _liveSceneIdxs) _plates.get(i).scrollPos(scrollProgress);
    return { stepIndex, progress };
  }

  // assets/js/telar-story/iiif-manifest.js
  function extractAllPages(manifest) {
    const v3Pages = extractV3Pages(manifest);
    if (v3Pages.length > 0) return v3Pages;
    const v2Pages = extractV2Pages(manifest);
    if (v2Pages.length > 0) return v2Pages;
    return [];
  }
  function extractV3Pages(manifest) {
    const pages = [];
    try {
      const items = manifest.items;
      if (!items) return pages;
      for (const canvas of items) {
        const annoPages = canvas.items;
        if (!annoPages?.[0]) continue;
        const annos = annoPages[0].items;
        if (!annos?.[0]) continue;
        const body = annos[0].body;
        if (!body) continue;
        const service = body.service;
        if (service?.[0]?.id) {
          pages.push({ tileSource: service[0].id + "/info.json" });
          continue;
        }
        if (body.id && typeof body.id === "string" && body.type === "Image") {
          const infoUrl = deriveInfoJsonFromImageUrl(body.id);
          if (infoUrl) {
            pages.push({ tileSource: infoUrl });
            continue;
          }
          pages.push({ tileSource: body.id });
        }
      }
    } catch {
    }
    return pages;
  }
  function extractV2Pages(manifest) {
    const pages = [];
    try {
      const sequences = manifest.sequences;
      if (!sequences?.[0]) return pages;
      const canvases = sequences[0].canvases;
      if (!canvases) return pages;
      for (const canvas of canvases) {
        const images = canvas.images;
        if (!images?.[0]) continue;
        const resource = images[0].resource;
        if (!resource) continue;
        const service = resource.service;
        if (service?.["@id"]) {
          pages.push({ tileSource: service["@id"] + "/info.json" });
          continue;
        }
        if (resource["@id"] && typeof resource["@id"] === "string") {
          pages.push({ tileSource: resource["@id"] });
        }
      }
    } catch {
    }
    return pages;
  }
  function deriveInfoJsonFromImageUrl(url) {
    const match = url.match(/^(.+\/iiif\/\d+\/[^/]+)\/[^/]+\/[^/]+\/[^/]+\/[^/]+$/);
    if (match) return match[1] + "/info.json";
    return null;
  }

  // assets/js/telar-story/test-hook.js
  function testEnabled() {
    if (typeof window === "undefined") return false;
    if (window.__TELAR_TEST_HOOK__ === true) return true;
    try {
      return /[?&]telartest=1(?:&|$)/.test(window.location.search);
    } catch {
      return false;
    }
  }
  var registry = [];
  var installed = false;
  function registerTestViewer(wrapper) {
    if (!testEnabled() || !wrapper) return;
    if (!registry.includes(wrapper)) registry.push(wrapper);
    installTestHook();
  }
  function unregisterTestViewer(wrapper) {
    const i = registry.indexOf(wrapper);
    if (i >= 0) registry.splice(i, 1);
  }
  function visibleArea(el) {
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.max(0, Math.min(vw, r.right) - Math.max(0, r.left));
    const h = Math.max(0, Math.min(vh, r.bottom) - Math.max(0, r.top));
    return w * h;
  }
  function getActiveViewer() {
    const live = registry.filter(
      (w) => w && w.viewer && !w._destroyed && w.containerEl && document.contains(w.containerEl)
    );
    if (live.length === 0) return null;
    const plateOf = (w) => w.containerEl.closest(".viewer-plate");
    const zOf = (w) => {
      const p = plateOf(w);
      const z = p ? parseInt(getComputedStyle(p).zIndex, 10) : NaN;
      return Number.isNaN(z) ? -Infinity : z;
    };
    const isActive = (w) => !!plateOf(w)?.classList.contains("is-active");
    const pool = live.some(isActive) ? live.filter(isActive) : live;
    pool.sort(
      (a, b) => zOf(b) - zOf(a) || visibleArea(b.containerEl) - visibleArea(a.containerEl)
    );
    return pool[0];
  }
  function isSettled() {
    const w = getActiveViewer();
    if (!w || !w.viewer) return false;
    const vp = w.viewer.viewport;
    const zc = vp.getZoom(true), zt = vp.getZoom(false);
    const cc = vp.getCenter(true), ct = vp.getCenter(false);
    return Math.abs(zc - zt) < 1e-4 && Math.abs(cc.x - ct.x) < 1e-4 && Math.abs(cc.y - ct.y) < 1e-4;
  }
  function measure(nx, ny) {
    const w = getActiveViewer();
    if (!w) return { error: "no-active-viewer" };
    const v = w.viewer;
    const OSD = window.OpenSeadragon;
    if (!OSD || !v.world || v.world.getItemCount() === 0) return { error: "world-empty" };
    const item = v.world.getItemAt(0);
    const cs = item.getContentSize();
    const vp = v.viewport;
    const rect = w.containerEl.getBoundingClientRect();
    const elPt = vp.imageToViewerElementCoordinates(new OSD.Point(nx * cs.x, ny * cs.y));
    const focalScreenPx = { x: rect.left + elPt.x, y: rect.top + elPt.y };
    const visImg = vp.viewportToImageRectangle(vp.getBounds(true));
    const homeZoom = vp.getHomeZoom();
    const zoom = vp.getZoom(true);
    const cor = state.cardOverlayRect;
    return {
      ok: true,
      input: { nx, ny },
      viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 },
      imageSize: { w: cs.x, h: cs.y, aspect: cs.x / cs.y },
      homeZoom,
      zoom,
      effectiveNzoom: zoom / homeZoom,
      // what the runtime actually rendered, vs authored
      osdConfig: {
        visibilityRatio: v.visibilityRatio,
        constrainDuringPan: v.constrainDuringPan,
        minZoomImageRatio: v.minZoomImageRatio,
        homeFillsViewer: v.homeFillsViewer
      },
      viewerRect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
      focalScreenPx,
      focalInViewerPx: { x: elPt.x, y: elPt.y },
      visibleImageRect: { x: visImg.x, y: visImg.y, w: visImg.width, h: visImg.height },
      cardOverlayRect: cor ? { x: cor.x, y: cor.y, w: cor.width, h: cor.height } : null,
      layoutMode: state.layoutMode ?? null,
      activeTitleCardIndex: state.activeTitleCardIndex ?? null
    };
  }
  var DEFAULT_SWEEP_STEPS = [
    { step: 1, x: 0.5, y: 0.5, zoom: 1 },
    { step: 2, x: 0.477, y: 0.125, zoom: 8.9 },
    { step: 3, x: 0.486, y: 0.277, zoom: 10 },
    { step: 4, x: 0.504, y: 0.415, zoom: 2.9 },
    { step: 5, x: 0.478, y: 0.883, zoom: 10 },
    { step: 6, x: 0.5, y: 0.5, zoom: 1 },
    { step: 19, x: 0.516, y: 0.974, zoom: 10 },
    { step: 20, x: 0.5, y: 0.5, zoom: 1 }
  ];
  async function settleAndMeasure(nx, ny, timeoutMs = 9e3) {
    const start = Date.now();
    let streak = 0, lastKey = null;
    while (Date.now() - start < timeoutMs) {
      const st = state;
      if (isSettled() && !(st && st.isSnapping)) {
        const m = measure(nx, ny);
        if (m && m.ok) {
          const key = `${Math.round(m.focalScreenPx.x)},${Math.round(m.focalScreenPx.y)},${m.zoom.toFixed(3)}`;
          if (key === lastKey) streak++;
          else {
            lastKey = key;
            streak = 0;
          }
          if (streak >= 3) return m;
        }
      } else {
        streak = 0;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    return measure(nx, ny);
  }
  async function runSweep(steps) {
    const nav = window.TelarStory && window.TelarStory.navigateToStep;
    const out = [];
    for (const s of steps) {
      if (nav) nav(s.step);
      await new Promise((r) => setTimeout(r, 450));
      const m = await settleAndMeasure(s.x, s.y);
      out.push({ step: s.step, authored: s, m });
    }
    return out;
  }
  function maybeAutoCollect() {
    let params;
    try {
      params = new URLSearchParams(window.location.search);
    } catch {
      return;
    }
    if (!params.has("collect")) return;
    const url = params.get("collect") || "http://127.0.0.1:8899/collect";
    const label = params.get("label") || "device";
    const steps = window.__TELAR_SWEEP_STEPS__ || DEFAULT_SWEEP_STEPS;
    runSweep(steps).then((results) => {
      const payload = {
        label,
        ua: navigator.userAgent,
        viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 },
        results
      };
      try {
        navigator.sendBeacon(url, new Blob([JSON.stringify(payload)], { type: "text/plain" }));
      } catch (e) {
        fetch(url, { method: "POST", mode: "no-cors", body: JSON.stringify(payload) }).catch(() => {
        });
      }
    });
  }
  function installTestHook() {
    if (installed || !testEnabled()) return;
    installed = true;
    window.__telarTestHook__ = {
      version: "v1.4.0",
      registry,
      getActiveViewer,
      isSettled,
      /** Primary API: exact rendered position + footprint of a focal point. */
      getFocalScreenPosition: measure,
      measure,
      /** Convenience: measure a list of `{nx, ny}` (or `{x, y}`) points in one call. */
      measurePoints(points) {
        return points.map((p) => measure(Number(p.nx ?? p.x), Number(p.ny ?? p.y)));
      },
      runSweep,
      settleAndMeasure
    };
    setTimeout(maybeAutoCollect, 800);
  }

  // assets/js/telar-story/iiif-viewer.js
  var IiifViewer = class _IiifViewer {
    /**
     * @param {IiifViewerOptions} options
     */
    constructor({ container, manifestUrl, startPage = 0, showChrome = false, allowZoomGestures = false }) {
      if (!window.OpenSeadragon) {
        throw new Error("IiifViewer: window.OpenSeadragon not loaded \u2014 vendor <script> ordering issue?");
      }
      this.containerEl = typeof container === "string" ? document.querySelector(container) : container;
      if (!this.containerEl) {
        throw new Error(`IiifViewer: container ${container} not found`);
      }
      this.manifestUrl = manifestUrl;
      this.startPage = startPage;
      this.showChrome = showChrome;
      this.allowZoomGestures = allowZoomGestures;
      this.pages = [];
      this.currentPage = startPage;
      this.viewer = null;
      this._destroyed = false;
      this._chromeEl = null;
      this._pageTransitioning = false;
      this.ready = this._init();
    }
    /**
     * Fetch the manifest, parse pages, and instantiate OpenSeadragon with
     * Tify-faithful options. Resolves `this.ready` on success; rejects (and
     * appends `.telar-iiif-error` to the container) on any failure.
     */
    async _init() {
      try {
        const res = await fetch(this.manifestUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const manifest = await res.json();
        this.pages = extractAllPages(manifest);
        if (this.pages.length === 0) throw new Error("No pages extracted from manifest");
        this.currentPage = Math.max(0, Math.min(this.startPage, this.pages.length - 1));
        const gestureSettingsMouse = this.allowZoomGestures ? {} : { scrollToZoom: false };
        this.viewer = new window.OpenSeadragon({
          element: this.containerEl,
          tileSources: this.pages[this.currentPage].tileSource,
          animationTime: 0.4,
          drawer: "canvas",
          immediateRender: true,
          placeholderFillStyle: "grey",
          preserveImageSizeOnResize: true,
          preserveViewport: true,
          showNavigationControl: false,
          showZoomControl: false,
          visibilityRatio: 0.2,
          gestureSettingsMouse
        });
        if (!this.allowZoomGestures) {
          this.viewer.innerTracker.scrollHandler = false;
          this.viewer.gestureSettingsMouse.clickToZoom = false;
        }
        await new Promise((resolve, reject) => {
          const onFirstOpen = () => {
            this.viewer.removeHandler("open", onFirstOpen);
            this.viewer.removeHandler("open-failed", onOpenFailed);
            requestAnimationFrame(resolve);
          };
          const onOpenFailed = (event) => {
            this.viewer.removeHandler("open", onFirstOpen);
            this.viewer.removeHandler("open-failed", onOpenFailed);
            reject(new Error("OSD open-failed: " + (event?.message || "unknown")));
          };
          this.viewer.addHandler("open", onFirstOpen);
          this.viewer.addHandler("open-failed", onOpenFailed);
        });
        this.viewer.addHandler("open", () => {
          this._pageTransitioning = false;
          this._updateChrome();
        });
        this.viewer.addHandler("open-failed", () => {
          this._pageTransitioning = false;
          this._updateChrome();
        });
        if (this.showChrome && this.pages.length > 1) {
          this._injectChrome();
        }
        registerTestViewer(this);
      } catch (err) {
        console.error("IiifViewer: failed to initialise", err);
        this._injectErrorUI();
        throw err;
      }
    }
    /**
     * Open a different page of the manifest. Silent no-op when destroyed,
     * out of range, or already on the requested page.
     *
     * @param {number} n - 0-indexed page number.
     */
    setPage(n) {
      if (this._destroyed) return;
      if (n === this.currentPage || n < 0 || n >= this.pages.length) return;
      this.currentPage = n;
      this._pageTransitioning = true;
      this.viewer.open(this.pages[n].tileSource);
      this._updateChrome();
    }
    /**
     * Tear down the viewer and remove injected chrome.
     *
     * Idempotent — second and later calls return early via the `_destroyed`
     * flag. The viewer uses the Canvas2D drawer, so there is no
     * WebGL context to release before teardown (OpenSeadragon issue #2693
     * applies only to the WebGL drawer); this simply calls `viewer.destroy()`.
     */
    destroy() {
      if (this._destroyed) return;
      this._destroyed = true;
      unregisterTestViewer(this);
      if (this.viewer) {
        this.viewer.destroy();
        this.viewer = null;
      }
      if (this._chromeEl) {
        this._chromeEl.remove();
        this._chromeEl = null;
      }
    }
    // ── Chrome ─────────────────────────────────────────────────────────────────
    // Bootstrap Icons chevron paths (16×16, viewBox 0 0 16 16). Inlined so the
    // wrapper has no SVG-loading dependency; static path data only — no user
    // input ever reaches these strings.
    static _CHEVRON_LEFT = "M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z";
    static _CHEVRON_RIGHT = "M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z";
    /**
     * Substitute the wrapper's %{current} and %{total} placeholders in a
     * lang-key aria template. Returns '' when the template is missing so
     * a partially-localised installation does not write `undefined` into
     * an aria-label.
     *
     * @param {string|undefined} template
     * @param {number} current
     * @param {number} total
     * @returns {string}
     */
    _formatAriaLabel(template, current, total) {
      if (!template) return "";
      return template.replace("%{current}", String(current)).replace("%{total}", String(total));
    }
    /**
     * Build the `<svg><path/></svg>` chevron used by prev / next buttons.
     * createElementNS keeps the SVG in the SVG namespace; setAttribute
     * carries no XSS risk because the `d` value is a class-level constant.
     */
    _makeChevronSvg(pathData) {
      const NS = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(NS, "svg");
      svg.setAttribute("xmlns", NS);
      svg.setAttribute("width", "16");
      svg.setAttribute("height", "16");
      svg.setAttribute("viewBox", "0 0 16 16");
      svg.setAttribute("fill", "currentColor");
      svg.setAttribute("aria-hidden", "true");
      const path = document.createElementNS(NS, "path");
      path.setAttribute("d", pathData);
      svg.appendChild(path);
      return svg;
    }
    /**
     * Inject the prev / page-input / next pagination pills into the
     * container. Telar-namespaced class names only (no Bootstrap utility
     * classes). The pills float over the OSD canvas; positional
     * styling lives in `_sass/_viewer.scss`.
     */
    _injectChrome() {
      const lang = window.telarViewerLang ?? {};
      const total = this.pages.length;
      const current1 = this.currentPage + 1;
      const wrap = document.createElement("div");
      wrap.className = "telar-iiif-pagination";
      const prevBtn = document.createElement("button");
      prevBtn.type = "button";
      prevBtn.className = "prev-btn";
      prevBtn.setAttribute("aria-label", lang.prev_page ?? "Previous page");
      prevBtn.appendChild(this._makeChevronSvg(_IiifViewer._CHEVRON_LEFT));
      prevBtn.disabled = this.currentPage === 0;
      prevBtn.addEventListener("click", () => {
        if (this.currentPage > 0) this.setPage(this.currentPage - 1);
      });
      const labelEl = document.createElement("label");
      labelEl.className = "visually-hidden";
      labelEl.textContent = lang.page_input_label ?? "Page number";
      const inputId = `telar-iiif-page-${Math.random().toString(36).slice(2, 8)}`;
      labelEl.setAttribute("for", inputId);
      const input = document.createElement("input");
      input.type = "number";
      input.className = "page-input";
      input.id = inputId;
      input.min = "1";
      input.max = String(total);
      input.value = String(current1);
      input.setAttribute(
        "aria-label",
        this._formatAriaLabel(lang.page_input_aria, current1, total)
      );
      input.addEventListener("change", (e) => {
        const parsed = parseInt(e.target.value, 10);
        if (Number.isNaN(parsed)) {
          input.value = String(this.currentPage + 1);
          return;
        }
        const clamped = Math.max(1, Math.min(parsed, this.pages.length));
        this.setPage(clamped - 1);
      });
      const nextBtn = document.createElement("button");
      nextBtn.type = "button";
      nextBtn.className = "next-btn";
      nextBtn.setAttribute("aria-label", lang.next_page ?? "Next page");
      nextBtn.appendChild(this._makeChevronSvg(_IiifViewer._CHEVRON_RIGHT));
      nextBtn.disabled = this.currentPage === total - 1;
      nextBtn.addEventListener("click", () => {
        if (this.currentPage < this.pages.length - 1) this.setPage(this.currentPage + 1);
      });
      wrap.append(prevBtn, labelEl, input, nextBtn);
      this.containerEl.append(wrap);
      this._chromeEl = wrap;
    }
    /**
     * Reflect `currentPage` and `_pageTransitioning` back into the
     * injected chrome (input value, aria-label, prev/next disabled).
     * No-op when chrome has not been injected (`showChrome` false or
     * single-page manifest).
     */
    _updateChrome() {
      if (!this._chromeEl) return;
      const lang = window.telarViewerLang ?? {};
      const total = this.pages.length;
      const current1 = this.currentPage + 1;
      const input = this._chromeEl.querySelector(".page-input");
      if (input) {
        input.value = String(current1);
        input.setAttribute(
          "aria-label",
          this._formatAriaLabel(lang.page_input_aria, current1, total)
        );
      }
      const prevBtn = this._chromeEl.querySelector(".prev-btn");
      if (prevBtn) prevBtn.disabled = this.currentPage === 0 || this._pageTransitioning;
      const nextBtn = this._chromeEl.querySelector(".next-btn");
      if (nextBtn) nextBtn.disabled = this.currentPage === total - 1 || this._pageTransitioning;
    }
    // ── Error UI ───────────────────────────────────────────────────────────────
    /**
     * Append `.telar-iiif-error` to the container when manifest fetch or
     * OSD instantiation fails. Uses `textContent` for every string and
     * never assembles HTML strings; reads localised text from
     * `window.telarViewerLang` with inline English fallbacks so the wrapper
     * degrades gracefully if the lang injection is missing.
     */
    _injectErrorUI() {
      const div = document.createElement("div");
      div.className = "telar-iiif-error";
      div.setAttribute("role", "alert");
      div.setAttribute("aria-live", "polite");
      const lang = window.telarViewerLang ?? {};
      const strong = document.createElement("strong");
      strong.textContent = lang.image_unavailable_title ?? "Image unavailable";
      const p = document.createElement("p");
      p.textContent = lang.image_unavailable_detail ?? "The IIIF image could not be loaded.";
      div.append(strong, p);
      this.containerEl.append(div);
    }
  };

  // assets/js/telar-story/video-card.js
  var _cs = getComputedStyle(document.documentElement);
  var videoPadFactor = parseFloat(_cs.getPropertyValue("--telar-video-pad-factor").trim()) || 0.025;
  var videoStackMaxH = parseFloat(_cs.getPropertyValue("--telar-video-stack-max-h").trim()) || 0.58;
  var videoCardFracSide = parseFloat(_cs.getPropertyValue("--telar-video-card-frac-side").trim()) || 0.35;
  var _videoPlayers = [];
  function computeVideoLayout(W, H, aspectRatio) {
    if (state.layoutMode === "vertical") {
      return _computeStackedLayout(W, H, aspectRatio);
    }
    const pad = Math.max(8, Math.round(Math.min(W, H) * videoPadFactor));
    const cardFracSide = videoCardFracSide;
    const sideCardW = Math.round(W * cardFracSide);
    const sideVideoMaxW = W - sideCardW - pad * 3;
    const sideVideoMaxH = H - pad * 2;
    let sideVidW = sideVideoMaxW;
    let sideVidH = sideVidW / aspectRatio;
    if (sideVidH > sideVideoMaxH) {
      sideVidH = sideVideoMaxH;
      sideVidW = sideVidH * aspectRatio;
    }
    const sideVideoArea = sideVidW * sideVidH;
    const stackVideoMaxW = W - pad * 2;
    const stackVideoMaxH = H * videoStackMaxH;
    let stackVidW = stackVideoMaxW;
    let stackVidH = stackVidW / aspectRatio;
    if (stackVidH > stackVideoMaxH) {
      stackVidH = stackVideoMaxH;
      stackVidW = stackVidH * aspectRatio;
    }
    const stackVideoArea = stackVidW * stackVidH;
    if (sideVideoArea >= stackVideoArea) {
      return _buildSideBySideResult(W, H, pad, sideCardW, sideVidW, sideVidH);
    } else {
      return _buildStackedResult(W, H, pad, stackVidW, stackVidH);
    }
  }
  function _buildSideBySideResult(W, H, pad, sideCardW, sideVidW, sideVidH) {
    const vidW = Math.round(sideVidW);
    const vidH = Math.round(sideVidH);
    const vidLeft = sideCardW + pad * 2;
    const vidTop = Math.round((H - vidH) / 2);
    const cardW = sideCardW;
    const cardH = Math.round(H - pad * 2);
    const cardLeft = pad;
    const cardTop = pad;
    const cardPad = cardW > 300 ? 24 : cardW > 200 ? 16 : 10;
    return {
      mode: "side-by-side",
      video: { left: vidLeft, top: vidTop, width: vidW, height: vidH },
      card: { left: cardLeft, top: cardTop, width: cardW, height: cardH },
      padding: cardPad
    };
  }
  function _buildStackedResult(W, H, pad, stackVidW, stackVidH) {
    const vidW = Math.round(stackVidW);
    const vidH = Math.round(stackVidH);
    const vidLeft = Math.round((W - vidW) / 2);
    const vidTop = pad;
    const cardTop = vidTop + vidH + pad;
    const cardH = Math.max(60, H - cardTop - pad);
    const cardW = Math.round(W - pad * 2);
    const cardLeft = pad;
    const cardPad = cardH > 200 ? 22 : cardH > 120 ? 14 : 8;
    return {
      mode: "stacked",
      video: { left: vidLeft, top: vidTop, width: vidW, height: vidH },
      card: { left: cardLeft, top: cardTop, width: cardW, height: cardH },
      padding: cardPad
    };
  }
  function computeVideoLetterboxRegion(W, H) {
    const pad = Math.max(8, Math.round(Math.min(W, H) * videoPadFactor));
    if (state.layoutMode === "vertical") {
      return {
        left: pad,
        top: pad,
        width: Math.round(W - pad * 2),
        height: Math.round(H * videoStackMaxH)
      };
    }
    const cardW = Math.round(W * videoCardFracSide);
    return {
      left: cardW + pad * 2,
      top: pad,
      width: Math.round(W - cardW - pad * 3),
      height: Math.round(H - pad * 2)
    };
  }
  function _computeStackedLayout(W, H, aspectRatio) {
    const pad = Math.max(8, Math.round(Math.min(W, H) * videoPadFactor));
    const stackVideoMaxW = W - pad * 2;
    const stackVideoMaxH = H * videoStackMaxH;
    let stackVidW = stackVideoMaxW;
    let stackVidH = stackVidW / aspectRatio;
    if (stackVidH > stackVideoMaxH) {
      stackVidH = stackVideoMaxH;
      stackVidW = stackVidH * aspectRatio;
    }
    return _buildStackedResult(W, H, pad, stackVidW, stackVidH);
  }
  function _applyVideoLayout(plateEl) {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const videoEl = plateEl.querySelector(".video-iframe");
    if (!videoEl) return;
    if (plateEl.dataset.videoLetterbox === "true") {
      const region = computeVideoLetterboxRegion(W, H);
      videoEl.classList.add("video-iframe--letterbox");
      videoEl.style.position = "absolute";
      videoEl.style.left = `${region.left}px`;
      videoEl.style.top = `${region.top}px`;
      videoEl.style.width = `${region.width}px`;
      videoEl.style.height = `${region.height}px`;
      return;
    }
    videoEl.classList.remove("video-iframe--letterbox");
    const aspectRatio = parseFloat(plateEl.dataset.aspectRatio) || 16 / 9;
    const layout = computeVideoLayout(W, H, aspectRatio);
    videoEl.style.position = "absolute";
    videoEl.style.left = `${layout.video.left}px`;
    videoEl.style.top = `${layout.video.top}px`;
    videoEl.style.width = `${layout.video.width}px`;
    videoEl.style.height = `${layout.video.height}px`;
  }
  onViewportResize(() => {
    for (const wrapper of _videoPlayers) {
      if (wrapper.element && wrapper.element.classList.contains("is-active")) {
        _applyVideoLayout(wrapper.element);
      }
    }
  });

  // node_modules/lenis/dist/lenis.mjs
  var version = "1.3.23";
  function clamp(min, input, max) {
    return Math.max(min, Math.min(input, max));
  }
  function lerp(x, y, t) {
    return (1 - t) * x + t * y;
  }
  function damp(x, y, lambda, deltaTime) {
    return lerp(x, y, 1 - Math.exp(-lambda * deltaTime));
  }
  function modulo(n, d) {
    return (n % d + d) % d;
  }
  var Animate = class {
    isRunning = false;
    value = 0;
    from = 0;
    to = 0;
    currentTime = 0;
    lerp;
    duration;
    easing;
    onUpdate;
    /**
    * Advance the animation by the given delta time
    *
    * @param deltaTime - The time in seconds to advance the animation
    */
    advance(deltaTime) {
      if (!this.isRunning) return;
      let completed = false;
      if (this.duration && this.easing) {
        this.currentTime += deltaTime;
        const linearProgress = clamp(0, this.currentTime / this.duration, 1);
        completed = linearProgress >= 1;
        const easedProgress = completed ? 1 : this.easing(linearProgress);
        this.value = this.from + (this.to - this.from) * easedProgress;
      } else if (this.lerp) {
        this.value = damp(this.value, this.to, this.lerp * 60, deltaTime);
        if (Math.round(this.value) === Math.round(this.to)) {
          this.value = this.to;
          completed = true;
        }
      } else {
        this.value = this.to;
        completed = true;
      }
      if (completed) this.stop();
      this.onUpdate?.(this.value, completed);
    }
    /** Stop the animation */
    stop() {
      this.isRunning = false;
    }
    /**
    * Set up the animation from a starting value to an ending value
    * with optional parameters for lerping, duration, easing, and onUpdate callback
    *
    * @param from - The starting value
    * @param to - The ending value
    * @param options - Options for the animation
    */
    fromTo(from, to, { lerp: lerp2, duration, easing, onStart, onUpdate }) {
      this.from = this.value = from;
      this.to = to;
      this.lerp = lerp2;
      this.duration = duration;
      this.easing = easing;
      this.currentTime = 0;
      this.isRunning = true;
      onStart?.();
      this.onUpdate = onUpdate;
    }
  };
  function debounce(callback, delay) {
    let timer;
    return function(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = void 0;
        callback.apply(this, args);
      }, delay);
    };
  }
  var Dimensions = class {
    width = 0;
    height = 0;
    scrollHeight = 0;
    scrollWidth = 0;
    debouncedResize;
    wrapperResizeObserver;
    contentResizeObserver;
    constructor(wrapper, content, { autoResize = true, debounce: debounceValue = 250 } = {}) {
      this.wrapper = wrapper;
      this.content = content;
      if (autoResize) {
        this.debouncedResize = debounce(this.resize, debounceValue);
        if (this.wrapper instanceof Window) window.addEventListener("resize", this.debouncedResize);
        else {
          this.wrapperResizeObserver = new ResizeObserver(this.debouncedResize);
          this.wrapperResizeObserver.observe(this.wrapper);
        }
        this.contentResizeObserver = new ResizeObserver(this.debouncedResize);
        this.contentResizeObserver.observe(this.content);
      }
      this.resize();
    }
    destroy() {
      this.wrapperResizeObserver?.disconnect();
      this.contentResizeObserver?.disconnect();
      if (this.wrapper === window && this.debouncedResize) window.removeEventListener("resize", this.debouncedResize);
    }
    resize = () => {
      this.onWrapperResize();
      this.onContentResize();
    };
    onWrapperResize = () => {
      if (this.wrapper instanceof Window) {
        this.width = window.innerWidth;
        this.height = window.innerHeight;
      } else {
        this.width = this.wrapper.clientWidth;
        this.height = this.wrapper.clientHeight;
      }
    };
    onContentResize = () => {
      if (this.wrapper instanceof Window) {
        this.scrollHeight = this.content.scrollHeight;
        this.scrollWidth = this.content.scrollWidth;
      } else {
        this.scrollHeight = this.wrapper.scrollHeight;
        this.scrollWidth = this.wrapper.scrollWidth;
      }
    };
    get limit() {
      return {
        x: this.scrollWidth - this.width,
        y: this.scrollHeight - this.height
      };
    }
  };
  var Emitter = class {
    events = {};
    /**
    * Emit an event with the given data
    * @param event Event name
    * @param args Data to pass to the event handlers
    */
    emit(event, ...args) {
      const callbacks = this.events[event] || [];
      for (let i = 0, length = callbacks.length; i < length; i++) callbacks[i]?.(...args);
    }
    /**
    * Add a callback to the event
    * @param event Event name
    * @param cb Callback function
    * @returns Unsubscribe function
    */
    on(event, cb) {
      if (this.events[event]) this.events[event].push(cb);
      else this.events[event] = [cb];
      return () => {
        this.events[event] = this.events[event]?.filter((i) => cb !== i);
      };
    }
    /**
    * Remove a callback from the event
    * @param event Event name
    * @param callback Callback function
    */
    off(event, callback) {
      this.events[event] = this.events[event]?.filter((i) => callback !== i);
    }
    /**
    * Remove all event listeners and clean up
    */
    destroy() {
      this.events = {};
    }
  };
  var LINE_HEIGHT = 100 / 6;
  var listenerOptions = { passive: false };
  function getDeltaMultiplier(deltaMode, size) {
    if (deltaMode === 1) return LINE_HEIGHT;
    if (deltaMode === 2) return size;
    return 1;
  }
  var VirtualScroll = class {
    touchStart = {
      x: 0,
      y: 0
    };
    lastDelta = {
      x: 0,
      y: 0
    };
    window = {
      width: 0,
      height: 0
    };
    emitter = new Emitter();
    constructor(element, options = {
      wheelMultiplier: 1,
      touchMultiplier: 1
    }) {
      this.element = element;
      this.options = options;
      window.addEventListener("resize", this.onWindowResize);
      this.onWindowResize();
      this.element.addEventListener("wheel", this.onWheel, listenerOptions);
      this.element.addEventListener("touchstart", this.onTouchStart, listenerOptions);
      this.element.addEventListener("touchmove", this.onTouchMove, listenerOptions);
      this.element.addEventListener("touchend", this.onTouchEnd, listenerOptions);
    }
    /**
    * Add an event listener for the given event and callback
    *
    * @param event Event name
    * @param callback Callback function
    */
    on(event, callback) {
      return this.emitter.on(event, callback);
    }
    /** Remove all event listeners and clean up */
    destroy() {
      this.emitter.destroy();
      window.removeEventListener("resize", this.onWindowResize);
      this.element.removeEventListener("wheel", this.onWheel, listenerOptions);
      this.element.removeEventListener("touchstart", this.onTouchStart, listenerOptions);
      this.element.removeEventListener("touchmove", this.onTouchMove, listenerOptions);
      this.element.removeEventListener("touchend", this.onTouchEnd, listenerOptions);
    }
    /**
    * Event handler for 'touchstart' event
    *
    * @param event Touch event
    */
    onTouchStart = (event) => {
      const { clientX, clientY } = event.targetTouches ? event.targetTouches[0] : event;
      this.touchStart.x = clientX;
      this.touchStart.y = clientY;
      this.lastDelta = {
        x: 0,
        y: 0
      };
      this.emitter.emit("scroll", {
        deltaX: 0,
        deltaY: 0,
        event
      });
    };
    /** Event handler for 'touchmove' event */
    onTouchMove = (event) => {
      const { clientX, clientY } = event.targetTouches ? event.targetTouches[0] : event;
      const deltaX = -(clientX - this.touchStart.x) * this.options.touchMultiplier;
      const deltaY = -(clientY - this.touchStart.y) * this.options.touchMultiplier;
      this.touchStart.x = clientX;
      this.touchStart.y = clientY;
      this.lastDelta = {
        x: deltaX,
        y: deltaY
      };
      this.emitter.emit("scroll", {
        deltaX,
        deltaY,
        event
      });
    };
    onTouchEnd = (event) => {
      this.emitter.emit("scroll", {
        deltaX: this.lastDelta.x,
        deltaY: this.lastDelta.y,
        event
      });
    };
    /** Event handler for 'wheel' event */
    onWheel = (event) => {
      let { deltaX, deltaY, deltaMode } = event;
      const multiplierX = getDeltaMultiplier(deltaMode, this.window.width);
      const multiplierY = getDeltaMultiplier(deltaMode, this.window.height);
      deltaX *= multiplierX;
      deltaY *= multiplierY;
      deltaX *= this.options.wheelMultiplier;
      deltaY *= this.options.wheelMultiplier;
      this.emitter.emit("scroll", {
        deltaX,
        deltaY,
        event
      });
    };
    onWindowResize = () => {
      this.window = {
        width: window.innerWidth,
        height: window.innerHeight
      };
    };
  };
  var defaultEasing = (t) => Math.min(1, 1.001 - 2 ** (-10 * t));
  var Lenis = class {
    _isScrolling = false;
    _isStopped = false;
    _isLocked = false;
    _preventNextNativeScrollEvent = false;
    _resetVelocityTimeout = null;
    _rafId = null;
    /**
    * Whether or not the user is touching the screen
    */
    isTouching;
    /**
    * The time in ms since the lenis instance was created
    */
    time = 0;
    /**
    * User data that will be forwarded through the scroll event
    *
    * @example
    * lenis.scrollTo(100, {
    *   userData: {
    *     foo: 'bar'
    *   }
    * })
    */
    userData = {};
    /**
    * The last velocity of the scroll
    */
    lastVelocity = 0;
    /**
    * The current velocity of the scroll
    */
    velocity = 0;
    /**
    * The direction of the scroll
    */
    direction = 0;
    /**
    * The options passed to the lenis instance
    */
    options;
    /**
    * The target scroll value
    */
    targetScroll;
    /**
    * The animated scroll value
    */
    animatedScroll;
    animate = new Animate();
    emitter = new Emitter();
    dimensions;
    virtualScroll;
    constructor({ wrapper = window, content = document.documentElement, eventsTarget = wrapper, smoothWheel = true, syncTouch = false, syncTouchLerp = 0.075, touchInertiaExponent = 1.7, duration, easing, lerp: lerp2 = 0.1, infinite = false, orientation = "vertical", gestureOrientation = orientation === "horizontal" ? "both" : "vertical", touchMultiplier = 1, wheelMultiplier = 1, autoResize = true, prevent, virtualScroll, overscroll = true, autoRaf = false, anchors = false, autoToggle = false, allowNestedScroll = false, __experimental__naiveDimensions = false, naiveDimensions = __experimental__naiveDimensions, stopInertiaOnNavigate = false } = {}) {
      window.lenisVersion = version;
      if (!window.lenis) window.lenis = {};
      window.lenis.version = version;
      if (orientation === "horizontal") window.lenis.horizontal = true;
      if (syncTouch === true) window.lenis.touch = true;
      if (!wrapper || wrapper === document.documentElement) wrapper = window;
      if (typeof duration === "number" && typeof easing !== "function") easing = defaultEasing;
      else if (typeof easing === "function" && typeof duration !== "number") duration = 1;
      this.options = {
        wrapper,
        content,
        eventsTarget,
        smoothWheel,
        syncTouch,
        syncTouchLerp,
        touchInertiaExponent,
        duration,
        easing,
        lerp: lerp2,
        infinite,
        gestureOrientation,
        orientation,
        touchMultiplier,
        wheelMultiplier,
        autoResize,
        prevent,
        virtualScroll,
        overscroll,
        autoRaf,
        anchors,
        autoToggle,
        allowNestedScroll,
        naiveDimensions,
        stopInertiaOnNavigate
      };
      this.dimensions = new Dimensions(wrapper, content, { autoResize });
      this.updateClassName();
      this.targetScroll = this.animatedScroll = this.actualScroll;
      this.options.wrapper.addEventListener("scroll", this.onNativeScroll);
      this.options.wrapper.addEventListener("scrollend", this.onScrollEnd, { capture: true });
      if (this.options.anchors || this.options.stopInertiaOnNavigate) this.options.wrapper.addEventListener("click", this.onClick);
      this.options.wrapper.addEventListener("pointerdown", this.onPointerDown);
      this.virtualScroll = new VirtualScroll(eventsTarget, {
        touchMultiplier,
        wheelMultiplier
      });
      this.virtualScroll.on("scroll", this.onVirtualScroll);
      if (this.options.autoToggle) {
        this.checkOverflow();
        this.rootElement.addEventListener("transitionend", this.onTransitionEnd);
      }
      if (this.options.autoRaf) this._rafId = requestAnimationFrame(this.raf);
    }
    /**
    * Destroy the lenis instance, remove all event listeners and clean up the class name
    */
    destroy() {
      this.emitter.destroy();
      this.options.wrapper.removeEventListener("scroll", this.onNativeScroll);
      this.options.wrapper.removeEventListener("scrollend", this.onScrollEnd, { capture: true });
      this.options.wrapper.removeEventListener("pointerdown", this.onPointerDown);
      if (this.options.anchors || this.options.stopInertiaOnNavigate) this.options.wrapper.removeEventListener("click", this.onClick);
      this.virtualScroll.destroy();
      this.dimensions.destroy();
      this.cleanUpClassName();
      if (this._rafId) cancelAnimationFrame(this._rafId);
    }
    on(event, callback) {
      return this.emitter.on(event, callback);
    }
    off(event, callback) {
      return this.emitter.off(event, callback);
    }
    onScrollEnd = (e) => {
      if (!(e instanceof CustomEvent)) {
        if (this.isScrolling === "smooth" || this.isScrolling === false) e.stopPropagation();
      }
    };
    dispatchScrollendEvent = () => {
      this.options.wrapper.dispatchEvent(new CustomEvent("scrollend", {
        bubbles: this.options.wrapper === window,
        detail: { lenisScrollEnd: true }
      }));
    };
    get overflow() {
      const property = this.isHorizontal ? "overflow-x" : "overflow-y";
      return getComputedStyle(this.rootElement)[property];
    }
    checkOverflow() {
      if (["hidden", "clip"].includes(this.overflow)) this.internalStop();
      else this.internalStart();
    }
    onTransitionEnd = (event) => {
      if (event.propertyName?.includes("overflow") && event.target === this.rootElement) this.checkOverflow();
    };
    setScroll(scroll) {
      if (this.isHorizontal) this.options.wrapper.scrollTo({
        left: scroll,
        behavior: "instant"
      });
      else this.options.wrapper.scrollTo({
        top: scroll,
        behavior: "instant"
      });
    }
    onClick = (event) => {
      const linkElementsUrls = event.composedPath().filter((node) => node instanceof HTMLAnchorElement && node.href).map((element) => new URL(element.href));
      const currentUrl = new URL(window.location.href);
      if (this.options.anchors) {
        const anchorElementUrl = linkElementsUrls.find((targetUrl) => currentUrl.host === targetUrl.host && currentUrl.pathname === targetUrl.pathname && targetUrl.hash);
        if (anchorElementUrl) {
          const options = typeof this.options.anchors === "object" && this.options.anchors ? this.options.anchors : void 0;
          const target = `#${anchorElementUrl.hash.split("#")[1]}`;
          this.scrollTo(target, options);
          return;
        }
      }
      if (this.options.stopInertiaOnNavigate) {
        if (linkElementsUrls.some((targetUrl) => currentUrl.host === targetUrl.host && currentUrl.pathname !== targetUrl.pathname)) {
          this.reset();
          return;
        }
      }
    };
    onPointerDown = (event) => {
      if (event.button === 1) this.reset();
    };
    onVirtualScroll = (data) => {
      if (typeof this.options.virtualScroll === "function" && this.options.virtualScroll(data) === false) return;
      const { deltaX, deltaY, event } = data;
      this.emitter.emit("virtual-scroll", {
        deltaX,
        deltaY,
        event
      });
      if (event.ctrlKey) return;
      if (event.lenisStopPropagation) return;
      const isTouch = event.type.includes("touch");
      const isWheel = event.type.includes("wheel");
      this.isTouching = event.type === "touchstart" || event.type === "touchmove";
      const isClickOrTap = deltaX === 0 && deltaY === 0;
      if (this.options.syncTouch && isTouch && event.type === "touchstart" && isClickOrTap && !this.isStopped && !this.isLocked) {
        this.reset();
        return;
      }
      const isUnknownGesture = this.options.gestureOrientation === "vertical" && deltaY === 0 || this.options.gestureOrientation === "horizontal" && deltaX === 0;
      if (isClickOrTap || isUnknownGesture) return;
      let composedPath = event.composedPath();
      composedPath = composedPath.slice(0, composedPath.indexOf(this.rootElement));
      const prevent = this.options.prevent;
      const gestureOrientation = Math.abs(deltaX) >= Math.abs(deltaY) ? "horizontal" : "vertical";
      if (composedPath.find((node) => node instanceof HTMLElement && (typeof prevent === "function" && prevent?.(node) || node.hasAttribute?.("data-lenis-prevent") || gestureOrientation === "vertical" && node.hasAttribute?.("data-lenis-prevent-vertical") || gestureOrientation === "horizontal" && node.hasAttribute?.("data-lenis-prevent-horizontal") || isTouch && node.hasAttribute?.("data-lenis-prevent-touch") || isWheel && node.hasAttribute?.("data-lenis-prevent-wheel") || this.options.allowNestedScroll && this.hasNestedScroll(node, {
        deltaX,
        deltaY
      })))) return;
      if (this.isStopped || this.isLocked) {
        if (event.cancelable) event.preventDefault();
        return;
      }
      if (!(this.options.syncTouch && isTouch || this.options.smoothWheel && isWheel)) {
        this.isScrolling = "native";
        this.animate.stop();
        event.lenisStopPropagation = true;
        return;
      }
      let delta = deltaY;
      if (this.options.gestureOrientation === "both") delta = Math.abs(deltaY) > Math.abs(deltaX) ? deltaY : deltaX;
      else if (this.options.gestureOrientation === "horizontal") delta = deltaX;
      if (!this.options.overscroll || this.options.infinite || this.options.wrapper !== window && this.limit > 0 && (this.animatedScroll > 0 && this.animatedScroll < this.limit || this.animatedScroll === 0 && deltaY > 0 || this.animatedScroll === this.limit && deltaY < 0)) event.lenisStopPropagation = true;
      if (event.cancelable) event.preventDefault();
      const isSyncTouch = isTouch && this.options.syncTouch;
      const hasTouchInertia = isTouch && event.type === "touchend";
      if (hasTouchInertia) delta = Math.sign(delta) * Math.abs(this.velocity) ** this.options.touchInertiaExponent;
      this.scrollTo(this.targetScroll + delta, {
        programmatic: false,
        ...isSyncTouch ? { lerp: hasTouchInertia ? this.options.syncTouchLerp : 1 } : {
          lerp: this.options.lerp,
          duration: this.options.duration,
          easing: this.options.easing
        }
      });
    };
    /**
    * Force lenis to recalculate the dimensions
    */
    resize() {
      this.dimensions.resize();
      this.animatedScroll = this.targetScroll = this.actualScroll;
      this.emit();
    }
    emit() {
      this.emitter.emit("scroll", this);
    }
    onNativeScroll = () => {
      if (this._resetVelocityTimeout !== null) {
        clearTimeout(this._resetVelocityTimeout);
        this._resetVelocityTimeout = null;
      }
      if (this._preventNextNativeScrollEvent) {
        this._preventNextNativeScrollEvent = false;
        return;
      }
      if (this.isScrolling === false || this.isScrolling === "native") {
        const lastScroll = this.animatedScroll;
        this.animatedScroll = this.targetScroll = this.actualScroll;
        this.lastVelocity = this.velocity;
        this.velocity = this.animatedScroll - lastScroll;
        this.direction = Math.sign(this.animatedScroll - lastScroll);
        if (!this.isStopped) this.isScrolling = "native";
        this.emit();
        if (this.velocity !== 0) this._resetVelocityTimeout = setTimeout(() => {
          this.lastVelocity = this.velocity;
          this.velocity = 0;
          this.isScrolling = false;
          this.emit();
        }, 400);
      }
    };
    reset() {
      this.isLocked = false;
      this.isScrolling = false;
      this.animatedScroll = this.targetScroll = this.actualScroll;
      this.lastVelocity = this.velocity = 0;
      this.animate.stop();
    }
    /**
    * Start lenis scroll after it has been stopped
    */
    start() {
      if (!this.isStopped) return;
      if (this.options.autoToggle) {
        this.rootElement.style.removeProperty("overflow");
        return;
      }
      this.internalStart();
    }
    internalStart() {
      if (!this.isStopped) return;
      this.reset();
      this.isStopped = false;
      this.emit();
    }
    /**
    * Stop lenis scroll
    */
    stop() {
      if (this.isStopped) return;
      if (this.options.autoToggle) {
        this.rootElement.style.setProperty("overflow", "clip");
        return;
      }
      this.internalStop();
    }
    internalStop() {
      if (this.isStopped) return;
      this.reset();
      this.isStopped = true;
      this.emit();
    }
    /**
    * RequestAnimationFrame for lenis
    *
    * @param time The time in ms from an external clock like `requestAnimationFrame` or Tempus
    */
    raf = (time) => {
      const deltaTime = time - (this.time || time);
      this.time = time;
      this.animate.advance(deltaTime * 1e-3);
      if (this.options.autoRaf) this._rafId = requestAnimationFrame(this.raf);
    };
    /**
    * Scroll to a target value
    *
    * @param target The target value to scroll to
    * @param options The options for the scroll
    *
    * @example
    * lenis.scrollTo(100, {
    *   offset: 100,
    *   duration: 1,
    *   easing: (t) => 1 - Math.cos((t * Math.PI) / 2),
    *   lerp: 0.1,
    *   onStart: () => {
    *     console.log('onStart')
    *   },
    *   onComplete: () => {
    *     console.log('onComplete')
    *   },
    * })
    */
    scrollTo(_target, { offset = 0, immediate = false, lock = false, programmatic = true, lerp: lerp2 = programmatic ? this.options.lerp : void 0, duration = programmatic ? this.options.duration : void 0, easing = programmatic ? this.options.easing : void 0, onStart, onComplete, force = false, userData } = {}) {
      if ((this.isStopped || this.isLocked) && !force) return;
      let target = _target;
      let adjustedOffset = offset;
      if (typeof target === "string" && [
        "top",
        "left",
        "start",
        "#"
      ].includes(target)) target = 0;
      else if (typeof target === "string" && [
        "bottom",
        "right",
        "end"
      ].includes(target)) target = this.limit;
      else {
        let node = null;
        if (typeof target === "string") {
          node = document.querySelector(target);
          if (!node) if (target === "#top") target = 0;
          else console.warn("Lenis: Target not found", target);
        } else if (target instanceof HTMLElement && target?.nodeType) node = target;
        if (node) {
          if (this.options.wrapper !== window) {
            const wrapperRect = this.rootElement.getBoundingClientRect();
            adjustedOffset -= this.isHorizontal ? wrapperRect.left : wrapperRect.top;
          }
          const rect = node.getBoundingClientRect();
          const targetStyle = getComputedStyle(node);
          const scrollMargin = this.isHorizontal ? Number.parseFloat(targetStyle.scrollMarginLeft) : Number.parseFloat(targetStyle.scrollMarginTop);
          const containerStyle = getComputedStyle(this.rootElement);
          const scrollPadding = this.isHorizontal ? Number.parseFloat(containerStyle.scrollPaddingLeft) : Number.parseFloat(containerStyle.scrollPaddingTop);
          target = (this.isHorizontal ? rect.left : rect.top) + this.animatedScroll - (Number.isNaN(scrollMargin) ? 0 : scrollMargin) - (Number.isNaN(scrollPadding) ? 0 : scrollPadding);
        }
      }
      if (typeof target !== "number") return;
      target += adjustedOffset;
      if (this.options.infinite) {
        if (programmatic) {
          this.targetScroll = this.animatedScroll = this.scroll;
          const distance = target - this.animatedScroll;
          if (distance > this.limit / 2) target -= this.limit;
          else if (distance < -this.limit / 2) target += this.limit;
        }
      } else target = clamp(0, target, this.limit);
      if (target === this.targetScroll) {
        onStart?.(this);
        onComplete?.(this);
        return;
      }
      this.userData = userData ?? {};
      if (immediate) {
        this.animatedScroll = this.targetScroll = target;
        this.setScroll(this.scroll);
        this.reset();
        this.preventNextNativeScrollEvent();
        this.emit();
        onComplete?.(this);
        this.userData = {};
        requestAnimationFrame(() => {
          this.dispatchScrollendEvent();
        });
        return;
      }
      if (!programmatic) this.targetScroll = target;
      if (typeof duration === "number" && typeof easing !== "function") easing = defaultEasing;
      else if (typeof easing === "function" && typeof duration !== "number") duration = 1;
      this.animate.fromTo(this.animatedScroll, target, {
        duration,
        easing,
        lerp: lerp2,
        onStart: () => {
          if (lock) this.isLocked = true;
          this.isScrolling = "smooth";
          onStart?.(this);
        },
        onUpdate: (value, completed) => {
          this.isScrolling = "smooth";
          this.lastVelocity = this.velocity;
          this.velocity = value - this.animatedScroll;
          this.direction = Math.sign(this.velocity);
          this.animatedScroll = value;
          this.setScroll(this.scroll);
          if (programmatic) this.targetScroll = value;
          if (!completed) this.emit();
          if (completed) {
            this.reset();
            this.emit();
            onComplete?.(this);
            this.userData = {};
            requestAnimationFrame(() => {
              this.dispatchScrollendEvent();
            });
            this.preventNextNativeScrollEvent();
          }
        }
      });
    }
    preventNextNativeScrollEvent() {
      this._preventNextNativeScrollEvent = true;
      requestAnimationFrame(() => {
        this._preventNextNativeScrollEvent = false;
      });
    }
    hasNestedScroll(node, { deltaX, deltaY }) {
      const time = Date.now();
      if (!node._lenis) node._lenis = {};
      const cache = node._lenis;
      let hasOverflowX;
      let hasOverflowY;
      let isScrollableX;
      let isScrollableY;
      let hasOverscrollBehaviorX;
      let hasOverscrollBehaviorY;
      let scrollWidth;
      let scrollHeight;
      let clientWidth;
      let clientHeight;
      if (time - (cache.time ?? 0) > 2e3) {
        cache.time = Date.now();
        const computedStyle = window.getComputedStyle(node);
        cache.computedStyle = computedStyle;
        hasOverflowX = [
          "auto",
          "overlay",
          "scroll"
        ].includes(computedStyle.overflowX);
        hasOverflowY = [
          "auto",
          "overlay",
          "scroll"
        ].includes(computedStyle.overflowY);
        hasOverscrollBehaviorX = ["auto"].includes(computedStyle.overscrollBehaviorX);
        hasOverscrollBehaviorY = ["auto"].includes(computedStyle.overscrollBehaviorY);
        cache.hasOverflowX = hasOverflowX;
        cache.hasOverflowY = hasOverflowY;
        if (!(hasOverflowX || hasOverflowY)) return false;
        scrollWidth = node.scrollWidth;
        scrollHeight = node.scrollHeight;
        clientWidth = node.clientWidth;
        clientHeight = node.clientHeight;
        isScrollableX = scrollWidth > clientWidth;
        isScrollableY = scrollHeight > clientHeight;
        cache.isScrollableX = isScrollableX;
        cache.isScrollableY = isScrollableY;
        cache.scrollWidth = scrollWidth;
        cache.scrollHeight = scrollHeight;
        cache.clientWidth = clientWidth;
        cache.clientHeight = clientHeight;
        cache.hasOverscrollBehaviorX = hasOverscrollBehaviorX;
        cache.hasOverscrollBehaviorY = hasOverscrollBehaviorY;
      } else {
        isScrollableX = cache.isScrollableX;
        isScrollableY = cache.isScrollableY;
        hasOverflowX = cache.hasOverflowX;
        hasOverflowY = cache.hasOverflowY;
        scrollWidth = cache.scrollWidth;
        scrollHeight = cache.scrollHeight;
        clientWidth = cache.clientWidth;
        clientHeight = cache.clientHeight;
        hasOverscrollBehaviorX = cache.hasOverscrollBehaviorX;
        hasOverscrollBehaviorY = cache.hasOverscrollBehaviorY;
      }
      if (!(hasOverflowX && isScrollableX || hasOverflowY && isScrollableY)) return false;
      const orientation = Math.abs(deltaX) >= Math.abs(deltaY) ? "horizontal" : "vertical";
      let scroll;
      let maxScroll;
      let delta;
      let hasOverflow;
      let isScrollable;
      let hasOverscrollBehavior;
      if (orientation === "horizontal") {
        scroll = Math.round(node.scrollLeft);
        maxScroll = scrollWidth - clientWidth;
        delta = deltaX;
        hasOverflow = hasOverflowX;
        isScrollable = isScrollableX;
        hasOverscrollBehavior = hasOverscrollBehaviorX;
      } else if (orientation === "vertical") {
        scroll = Math.round(node.scrollTop);
        maxScroll = scrollHeight - clientHeight;
        delta = deltaY;
        hasOverflow = hasOverflowY;
        isScrollable = isScrollableY;
        hasOverscrollBehavior = hasOverscrollBehaviorY;
      } else return false;
      if (!hasOverscrollBehavior && (scroll >= maxScroll || scroll <= 0)) return true;
      return (delta > 0 ? scroll < maxScroll : scroll > 0) && hasOverflow && isScrollable;
    }
    /**
    * The root element on which lenis is instanced
    */
    get rootElement() {
      return this.options.wrapper === window ? document.documentElement : this.options.wrapper;
    }
    /**
    * The limit which is the maximum scroll value
    */
    get limit() {
      if (this.options.naiveDimensions) {
        if (this.isHorizontal) return this.rootElement.scrollWidth - this.rootElement.clientWidth;
        return this.rootElement.scrollHeight - this.rootElement.clientHeight;
      }
      return this.dimensions.limit[this.isHorizontal ? "x" : "y"];
    }
    /**
    * Whether or not the scroll is horizontal
    */
    get isHorizontal() {
      return this.options.orientation === "horizontal";
    }
    /**
    * The actual scroll value
    */
    get actualScroll() {
      const wrapper = this.options.wrapper;
      return this.isHorizontal ? wrapper.scrollX ?? wrapper.scrollLeft : wrapper.scrollY ?? wrapper.scrollTop;
    }
    /**
    * The current scroll value
    */
    get scroll() {
      return this.options.infinite ? modulo(this.animatedScroll, this.limit) : this.animatedScroll;
    }
    /**
    * The progress of the scroll relative to the limit
    */
    get progress() {
      return this.limit === 0 ? 1 : this.scroll / this.limit;
    }
    /**
    * Current scroll state
    */
    get isScrolling() {
      return this._isScrolling;
    }
    set isScrolling(value) {
      if (this._isScrolling !== value) {
        this._isScrolling = value;
        this.updateClassName();
      }
    }
    /**
    * Check if lenis is stopped
    */
    get isStopped() {
      return this._isStopped;
    }
    set isStopped(value) {
      if (this._isStopped !== value) {
        this._isStopped = value;
        this.updateClassName();
      }
    }
    /**
    * Check if lenis is locked
    */
    get isLocked() {
      return this._isLocked;
    }
    set isLocked(value) {
      if (this._isLocked !== value) {
        this._isLocked = value;
        this.updateClassName();
      }
    }
    /**
    * Check if lenis is smooth scrolling
    */
    get isSmooth() {
      return this.isScrolling === "smooth";
    }
    /**
    * The class name applied to the wrapper element
    */
    get className() {
      let className = "lenis";
      if (this.options.autoToggle) className += " lenis-autoToggle";
      if (this.isStopped) className += " lenis-stopped";
      if (this.isLocked) className += " lenis-locked";
      if (this.isScrolling) className += " lenis-scrolling";
      if (this.isScrolling === "smooth") className += " lenis-smooth";
      return className;
    }
    updateClassName() {
      this.cleanUpClassName();
      this.className.split(" ").forEach((className) => {
        this.rootElement.classList.add(className);
      });
    }
    cleanUpClassName() {
      for (const className of Array.from(this.rootElement.classList)) if (className === "lenis" || className.startsWith("lenis-")) this.rootElement.classList.remove(className);
    }
  };

  // node_modules/lenis/dist/lenis-snap.mjs
  function debounce2(callback, delay) {
    let timer;
    return function(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = void 0;
        callback.apply(this, args);
      }, delay);
    };
  }
  function removeParentSticky(element) {
    if (getComputedStyle(element).position === "sticky") {
      element.style.setProperty("position", "static");
      element.dataset.sticky = "true";
    }
    if (element.offsetParent) removeParentSticky(element.offsetParent);
  }
  function addParentSticky(element) {
    if (element?.dataset?.sticky === "true") {
      element.style.removeProperty("position");
      delete element.dataset.sticky;
    }
    if (element.offsetParent) addParentSticky(element.offsetParent);
  }
  function offsetTop(element, accumulator = 0) {
    const top = accumulator + element.offsetTop;
    if (element.offsetParent) return offsetTop(element.offsetParent, top);
    return top;
  }
  function offsetLeft(element, accumulator = 0) {
    const left = accumulator + element.offsetLeft;
    if (element.offsetParent) return offsetLeft(element.offsetParent, left);
    return left;
  }
  function scrollTop(element, accumulator = 0) {
    const top = accumulator + element.scrollTop;
    if (element.offsetParent) return scrollTop(element.offsetParent, top);
    return top + window.scrollY;
  }
  function scrollLeft(element, accumulator = 0) {
    const left = accumulator + element.scrollLeft;
    if (element.offsetParent) return scrollLeft(element.offsetParent, left);
    return left + window.scrollX;
  }
  var SnapElement = class {
    element;
    options;
    align;
    rect = {};
    wrapperResizeObserver;
    resizeObserver;
    debouncedWrapperResize;
    constructor(element, { align = ["start"], ignoreSticky = true, ignoreTransform = false } = {}) {
      this.element = element;
      this.options = {
        align,
        ignoreSticky,
        ignoreTransform
      };
      this.align = [align].flat();
      this.debouncedWrapperResize = debounce2(this.onWrapperResize, 500);
      this.wrapperResizeObserver = new ResizeObserver(this.debouncedWrapperResize);
      this.wrapperResizeObserver.observe(document.body);
      this.onWrapperResize();
      this.resizeObserver = new ResizeObserver(this.onResize);
      this.resizeObserver.observe(this.element);
      this.setRect({
        width: this.element.offsetWidth,
        height: this.element.offsetHeight
      });
    }
    destroy() {
      this.wrapperResizeObserver.disconnect();
      this.resizeObserver.disconnect();
    }
    setRect({ top, left, width, height, element } = {}) {
      top = top ?? this.rect.top;
      left = left ?? this.rect.left;
      width = width ?? this.rect.width;
      height = height ?? this.rect.height;
      element = element ?? this.rect.element;
      if (top === this.rect.top && left === this.rect.left && width === this.rect.width && height === this.rect.height && element === this.rect.element) return;
      this.rect.top = top;
      this.rect.y = top;
      this.rect.width = width;
      this.rect.height = height;
      this.rect.left = left;
      this.rect.x = left;
      this.rect.bottom = top + height;
      this.rect.right = left + width;
    }
    onWrapperResize = () => {
      let top;
      let left;
      if (this.options.ignoreSticky) removeParentSticky(this.element);
      if (this.options.ignoreTransform) {
        top = offsetTop(this.element);
        left = offsetLeft(this.element);
      } else {
        const rect = this.element.getBoundingClientRect();
        top = rect.top + scrollTop(this.element);
        left = rect.left + scrollLeft(this.element);
      }
      if (this.options.ignoreSticky) addParentSticky(this.element);
      this.setRect({
        top,
        left
      });
    };
    onResize = ([entry]) => {
      if (!entry?.borderBoxSize[0]) return;
      const width = entry.borderBoxSize[0].inlineSize;
      const height = entry.borderBoxSize[0].blockSize;
      this.setRect({
        width,
        height
      });
    };
  };
  var index = 0;
  function uid() {
    return index++;
  }
  var Snap = class {
    options;
    elements = /* @__PURE__ */ new Map();
    snaps = /* @__PURE__ */ new Map();
    viewport = {
      width: window.innerWidth,
      height: window.innerHeight
    };
    isStopped = false;
    onSnapDebounced;
    currentSnapIndex;
    constructor(lenis2, { type = "proximity", lerp: lerp2, easing, duration, distanceThreshold = "50%", debounce: debounceDelay = 500, onSnapStart, onSnapComplete } = {}) {
      this.lenis = lenis2;
      if (!window.lenis) window.lenis = {};
      window.lenis.snap = true;
      this.options = {
        type,
        lerp: lerp2,
        easing,
        duration,
        distanceThreshold,
        debounce: debounceDelay,
        onSnapStart,
        onSnapComplete
      };
      this.onWindowResize();
      window.addEventListener("resize", this.onWindowResize);
      this.onSnapDebounced = debounce2(this.onSnap, this.options.debounce);
      this.lenis.on("virtual-scroll", this.onSnapDebounced);
    }
    /**
    * Destroy the snap instance
    */
    destroy() {
      this.lenis.off("virtual-scroll", this.onSnapDebounced);
      window.removeEventListener("resize", this.onWindowResize);
      this.elements.forEach((element) => {
        element.destroy();
      });
    }
    /**
    * Start the snap after it has been stopped
    */
    start() {
      this.isStopped = false;
    }
    /**
    * Stop the snap
    */
    stop() {
      this.isStopped = true;
    }
    /**
    * Add a snap to the snap instance
    *
    * @param value The value to snap to
    * @param userData User data that will be forwarded through the snap event
    * @returns Unsubscribe function
    */
    add(value) {
      const id = uid();
      this.snaps.set(id, { value });
      return () => this.snaps.delete(id);
    }
    /**
    * Add an element to the snap instance
    *
    * @param element The element to add
    * @param options The options for the element
    * @returns Unsubscribe function
    */
    addElement(element, options = {}) {
      const id = uid();
      this.elements.set(id, new SnapElement(element, options));
      return () => this.elements.delete(id);
    }
    addElements(elements, options = {}) {
      const map = [...elements].map((element) => this.addElement(element, options));
      return () => {
        map.forEach((remove) => {
          remove();
        });
      };
    }
    onWindowResize = () => {
      this.viewport.width = window.innerWidth;
      this.viewport.height = window.innerHeight;
    };
    computeSnaps = () => {
      const { isHorizontal } = this.lenis;
      let snaps = [...this.snaps.values()];
      this.elements.forEach(({ rect, align }) => {
        let value;
        align.forEach((align2) => {
          if (align2 === "start") value = rect.top;
          else if (align2 === "center") value = isHorizontal ? rect.left + rect.width / 2 - this.viewport.width / 2 : rect.top + rect.height / 2 - this.viewport.height / 2;
          else if (align2 === "end") value = isHorizontal ? rect.left + rect.width - this.viewport.width : rect.top + rect.height - this.viewport.height;
          if (typeof value === "number") snaps.push({ value: Math.ceil(value) });
        });
      });
      snaps = snaps.sort((a, b) => Math.abs(a.value) - Math.abs(b.value));
      return snaps;
    };
    previous() {
      this.goTo((this.currentSnapIndex ?? 0) - 1);
    }
    next() {
      this.goTo((this.currentSnapIndex ?? 0) + 1);
    }
    goTo(index2) {
      const snaps = this.computeSnaps();
      if (snaps.length === 0) return;
      this.currentSnapIndex = Math.max(0, Math.min(index2, snaps.length - 1));
      const currentSnap = snaps[this.currentSnapIndex];
      if (currentSnap === void 0) return;
      this.lenis.scrollTo(currentSnap.value, {
        duration: this.options.duration,
        easing: this.options.easing,
        lerp: this.options.lerp,
        lock: this.options.type === "lock",
        userData: { initiator: "snap" },
        onStart: () => {
          this.options.onSnapStart?.({
            index: this.currentSnapIndex,
            ...currentSnap
          });
        },
        onComplete: () => {
          this.options.onSnapComplete?.({
            index: this.currentSnapIndex,
            ...currentSnap
          });
        }
      });
    }
    get distanceThreshold() {
      let distanceThreshold = Number.POSITIVE_INFINITY;
      if (this.options.type === "mandatory") return Number.POSITIVE_INFINITY;
      const { isHorizontal } = this.lenis;
      const axis = isHorizontal ? "width" : "height";
      if (typeof this.options.distanceThreshold === "string" && this.options.distanceThreshold.endsWith("%")) distanceThreshold = Number(this.options.distanceThreshold.replace("%", "")) / 100 * this.viewport[axis];
      else if (typeof this.options.distanceThreshold === "number") distanceThreshold = this.options.distanceThreshold;
      else distanceThreshold = this.viewport[axis];
      return distanceThreshold;
    }
    onSnap = (e) => {
      if (this.isStopped) return;
      if (e.event.type === "touchmove") return;
      if (this.options.type === "lock" && this.lenis.userData?.initiator === "snap") return;
      let { scroll, isHorizontal } = this.lenis;
      const delta = isHorizontal ? e.deltaX : e.deltaY;
      scroll = Math.ceil(this.lenis.scroll + delta);
      const snaps = this.computeSnaps();
      if (snaps.length === 0) return;
      let snapIndex;
      const prevSnapIndex = snaps.findLastIndex(({ value }) => value < scroll);
      const nextSnapIndex = snaps.findIndex(({ value }) => value > scroll);
      if (this.options.type === "lock") {
        if (delta > 0) snapIndex = nextSnapIndex;
        else if (delta < 0) snapIndex = prevSnapIndex;
      } else {
        const prevSnap = snaps[prevSnapIndex];
        const distanceToPrevSnap = prevSnap ? Math.abs(scroll - prevSnap.value) : Number.POSITIVE_INFINITY;
        const nextSnap = snaps[nextSnapIndex];
        snapIndex = distanceToPrevSnap < (nextSnap ? Math.abs(scroll - nextSnap.value) : Number.POSITIVE_INFINITY) ? prevSnapIndex : nextSnapIndex;
      }
      if (snapIndex === void 0) return;
      if (snapIndex === -1) return;
      snapIndex = Math.max(0, Math.min(snapIndex, snaps.length - 1));
      const snap2 = snaps[snapIndex];
      if (Math.abs(scroll - snap2.value) <= this.distanceThreshold) this.goTo(snapIndex);
    };
    resize() {
      this.elements.forEach((element) => {
        element.onWrapperResize();
      });
    }
  };

  // assets/js/telar-story/panels.js
  function initializePanels() {
    document.addEventListener("click", function(e) {
      const trigger = e.target.closest('[data-panel="layer1"]');
      if (trigger) {
        const stepNumber = trigger.dataset.step;
        document.querySelectorAll(".offcanvas.show").forEach((p) => {
          const inst = bootstrap.Offcanvas.getInstance(p);
          if (inst) inst.hide();
        });
        state.panelStack = [];
        openPanel("layer1", stepNumber);
      }
    });
    document.addEventListener("click", function(e) {
      if (e.target.matches('[data-panel="layer2"]')) {
        const stepNumber = e.target.dataset.step;
        openPanel("layer2", stepNumber);
      }
    });
    const layer1Back = document.getElementById("panel-layer1-back");
    if (layer1Back) {
      layer1Back.addEventListener("click", function() {
        closePanel("layer1");
      });
    }
    const layer2Back = document.getElementById("panel-layer2-back");
    if (layer2Back) {
      layer2Back.addEventListener("click", function() {
        closePanel("layer2");
      });
    }
    const glossaryBack = document.getElementById("panel-glossary-back");
    if (glossaryBack) {
      glossaryBack.addEventListener("click", function() {
        closePanel("glossary");
      });
    }
  }
  function openPanel(panelType, contentId) {
    const panelId = `panel-${panelType}`;
    const panel = document.getElementById(panelId);
    if (!panel) return;
    const content = getPanelContent(panelType, contentId);
    if (content) {
      const titleElement = document.getElementById(`${panelId}-title`);
      titleElement.textContent = content.title;
      if (content.demo) {
        const demoBadgeText = window.telarLang?.demoPanelBadge || "Demo content";
        const badge = document.createElement("span");
        badge.className = "demo-badge-inline";
        badge.style.marginLeft = "0.5rem";
        badge.textContent = demoBadgeText;
        titleElement.appendChild(badge);
      }
      const contentElement = document.getElementById(`${panelId}-content`);
      contentElement.innerHTML = content.html;
      if (window.Telar && window.Telar.initializeGlossaryLinks) {
        window.Telar.initializeGlossaryLinks(contentElement);
      }
      const glossaryLinks = contentElement.querySelectorAll(".glossary-link");
      glossaryLinks.forEach((el, i) => {
        el.dataset.deepLinkN = i + 1;
      });
      glossaryLinks.forEach((el) => {
        el.addEventListener("click", () => {
          writeHashWithGlossary(parseInt(el.dataset.deepLinkN, 10));
        });
      });
      if (window.telarRenderLatex) {
        window.telarRenderLatex(contentElement);
      }
      if (panelType === "layer1") {
        state.panelStack = [{ type: panelType, id: contentId }];
      } else {
        state.panelStack.push({ type: panelType, id: contentId });
      }
      const bsOffcanvas = new bootstrap.Offcanvas(panel);
      bsOffcanvas.show();
      state.isPanelOpen = true;
      activateScrollLock();
      writeHash();
    }
  }
  function closePanel(panelType) {
    const panelId = `panel-${panelType}`;
    const panel = document.getElementById(panelId);
    if (!panel) return;
    const bsOffcanvas = bootstrap.Offcanvas.getInstance(panel);
    if (bsOffcanvas) {
      bsOffcanvas.hide();
    }
    state.panelStack = state.panelStack.filter((p) => p.type !== panelType);
    writeHash();
    setTimeout(() => {
      const anyPanelOpen = document.querySelector(".offcanvas.show");
      if (!anyPanelOpen) {
        state.isPanelOpen = false;
        deactivateScrollLock();
      }
    }, 350);
  }
  function closeTopPanel() {
    if (state.panelStack.length > 0) {
      const top = state.panelStack[state.panelStack.length - 1];
      closePanel(top.type);
    }
  }
  function closeAllPanels() {
    const openPanels = document.querySelectorAll(".offcanvas.show");
    openPanels.forEach((panel) => {
      const bsOffcanvas = bootstrap.Offcanvas.getInstance(panel);
      if (bsOffcanvas) {
        bsOffcanvas.hide();
      }
    });
    state.panelStack = [];
    state.isPanelOpen = false;
    writeHash();
    deactivateScrollLock();
  }
  function getPanelContent(panelType, contentId) {
    const steps = window.storyData?.steps || [];
    const step = steps.find((s) => s.step == contentId);
    if (!step) return null;
    if (panelType === "layer1") {
      let html = formatPanelContent({
        text: step.layer1_text,
        media: step.layer1_media
      }, step.object);
      if (step.layer2_title && step.layer2_title.trim() !== "" || step.layer2_text && step.layer2_text.trim() !== "") {
        const buttonLabel = step.layer2_button && step.layer2_button.trim() !== "" ? step.layer2_button : window.telarLang.goDeeper;
        html += `<p><button class="panel-trigger" data-panel="layer2" data-step="${contentId}">${escapeHtml(buttonLabel)} \u2192</button></p>`;
      }
      return {
        title: step.layer1_title || step.layer1_button || "Layer 1",
        html,
        demo: step.layer1_demo || false
      };
    } else if (panelType === "layer2") {
      return {
        title: step.layer2_title || step.layer2_button || "Layer 2",
        html: formatPanelContent({
          text: step.layer2_text,
          media: step.layer2_media
        }, step.object),
        demo: step.layer2_demo || false
      };
    } else if (panelType === "glossary") {
      return {
        title: "Glossary Term",
        html: "<p>Glossary content...</p>"
      };
    }
    return null;
  }
  function formatPanelContent(panelData, objectId) {
    if (!panelData) return "<p>No content available.</p>";
    let html = "";
    const basePath = getBasePath();
    if (panelData.text) {
      html += fixImageUrls(panelData.text, basePath);
    }
    if (panelData.media && panelData.media.trim() !== "") {
      let mediaUrl = panelData.media;
      if (mediaUrl.startsWith("/") && !mediaUrl.startsWith("//")) {
        mediaUrl = basePath + mediaUrl;
      }
      const objectsData = window.objectsData || [];
      const panelObj = objectId ? objectsData.find((o) => o.object_id === objectId) || {} : {};
      const panelAlt = panelObj.alt_text || panelObj.title || objectId || "Panel image";
      html += `<img src="${escapeHtml(mediaUrl)}" alt="${escapeHtml(panelAlt)}" class="img-fluid">`;
    }
    return html;
  }
  function stepHasLayer1Content(step) {
    if (!step) return false;
    return step.layer1_title && step.layer1_title.trim() !== "" || step.layer1_text && step.layer1_text.trim() !== "";
  }
  function stepHasLayer2Content(step) {
    if (!step) return false;
    return step.layer2_title && step.layer2_title.trim() !== "" || step.layer2_text && step.layer2_text.trim() !== "";
  }
  function initializeScrollLock() {
    const backdrop = document.createElement("div");
    backdrop.id = "panel-backdrop";
    backdrop.style.cssText = `
    position: fixed;
    inset: -50px;
    background: rgba(0, 0, 0, 0.025);
    z-index: 9900;
    display: none;
    pointer-events: none;
  `;
    document.body.appendChild(backdrop);
    const storyContainer = document.querySelector(".story-container");
    if (storyContainer) {
      storyContainer.addEventListener("click", function(e) {
        if (state.isPanelOpen && !e.target.closest(".offcanvas") && !e.target.closest("[data-panel]") && !e.target.closest(".share-button")) {
          closeTopPanel();
        }
      });
    }
  }
  function activateScrollLock() {
    state.scrollLockActive = true;
    if (state.lenis) state.lenis.stop();
    const backdrop = document.getElementById("panel-backdrop");
    if (backdrop) {
      backdrop.style.display = "block";
    }
  }
  function deactivateScrollLock() {
    state.scrollLockActive = false;
    if (state.lenis) state.lenis.start();
    const backdrop = document.getElementById("panel-backdrop");
    if (backdrop) {
      backdrop.style.display = "none";
    }
  }

  // assets/js/telar-story/deep-link.js
  var _isScrollDrivenHashUpdate = false;
  var _deepLinkTimers = [];
  function _cancelDeepLinkTimers() {
    _deepLinkTimers.forEach(clearTimeout);
    _deepLinkTimers = [];
  }
  function _armDeepLinkCancellation() {
    const cancel = () => {
      _cancelDeepLinkTimers();
      window.removeEventListener("wheel", cancel);
      window.removeEventListener("keydown", cancel);
      window.removeEventListener("touchstart", cancel);
    };
    window.addEventListener("wheel", cancel, { passive: true });
    window.addEventListener("keydown", cancel);
    window.addEventListener("touchstart", cancel, { passive: true });
  }
  var FRAGMENT_RE = /^#s(\d+)(?:l(\d+)(?:(g|ps)(\d+))?)?$/;
  function parseFragment(hash) {
    if (!hash || hash === "#") return null;
    const m = FRAGMENT_RE.exec(hash);
    if (!m) return null;
    return {
      step: parseInt(m[1], 10),
      // 1-based step number
      layer: m[2] ? parseInt(m[2], 10) : null,
      subType: m[3] || null,
      // 'g' or 'ps'
      subN: m[4] ? parseInt(m[4], 10) : null
    };
  }
  function writeHash() {
    _writeHashFragment(null, null);
  }
  function writeHashWithGlossary(n) {
    _writeHashFragment("g", n);
  }
  function _writeHashFragment(subType, subN) {
    const idx = state.currentIndex;
    let hash = "";
    if (idx >= 0) {
      hash = `#s${idx + 1}`;
      if (state.panelStack.length > 0) {
        for (let i = state.panelStack.length - 1; i >= 0; i--) {
          const layerMatch = state.panelStack[i].type.match(/^layer(\d+)$/);
          if (layerMatch) {
            hash += `l${layerMatch[1]}`;
            if (subType !== null && subN !== null) {
              hash += `${subType}${subN}`;
            }
            break;
          }
        }
      }
    }
    _isScrollDrivenHashUpdate = true;
    if (hash) {
      history.replaceState(null, "", hash);
    } else {
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    Promise.resolve().then(() => {
      _isScrollDrivenHashUpdate = false;
    });
  }
  function navigateToIntro() {
    if (state.viewerPlates) {
      for (const key of Object.keys(state.viewerPlates)) {
        const plate = state.viewerPlates[key];
        if (plate) plate.classList.remove("is-active");
      }
    }
    if (state.lenis) {
      state.lenis.stop();
      document.documentElement.scrollTop = 0;
      state.lenis.animatedScroll = 0;
      state.lenis.targetScroll = 0;
      state.currentIndex = -1;
      state.scrollPosition = 0;
      requestAnimationFrame(() => {
        state.lenis.start();
      });
    } else {
      state.currentMobileStep = -1;
      state.mobileInIntro = true;
      state.steps.forEach((step) => step.classList.remove("mobile-active"));
    }
    goToStep(-1, "backward");
    writeHash();
  }
  function navigateToStep(stepNumber) {
    const targetIndex = stepNumber - 1;
    if (targetIndex < 0 || targetIndex >= state.steps.length) return;
    if (state.viewerPlates) {
      for (const key of Object.keys(state.viewerPlates)) {
        const plate = state.viewerPlates[key];
        if (plate) plate.classList.remove("is-active");
      }
    }
    if (state.lenis) {
      const targetPx = (targetIndex + 1) * window.innerHeight;
      state.lenis.scrollTo(targetPx, { immediate: true, force: true });
      if (state.snap) state.snap.currentSnapIndex = targetIndex + 1;
      const prevStep2 = state.currentIndex;
      activateCard(targetIndex);
      if (prevStep2 >= 0 && prevStep2 !== targetIndex) {
        deactivateCard(prevStep2, targetIndex > prevStep2 ? "forward" : "backward");
      }
      state.currentIndex = targetIndex;
      state.scrollPosition = targetIndex + 1;
    } else {
      const prevStep2 = state.currentMobileStep;
      state.currentMobileStep = targetIndex;
      state.mobileInIntro = false;
      activateCard(targetIndex);
      if (prevStep2 >= 0 && prevStep2 !== targetIndex) {
        deactivateCard(prevStep2, targetIndex > prevStep2 ? "forward" : "backward");
      }
      state.steps.forEach((step, i) => {
        if (i === targetIndex) {
          step.classList.add("mobile-active");
        } else {
          step.classList.remove("mobile-active");
        }
      });
    }
    writeHash();
  }
  function applyDeepLinkOnLoad() {
    const parsed = parseFragment(window.location.hash);
    if (!parsed) return;
    const targetIndex = Math.min(parsed.step - 1, state.steps.length - 1);
    if (targetIndex < 0) return;
    if (state.lenis) {
      const targetPx = (targetIndex + 1) * window.innerHeight;
      state.lenis.scrollTo(targetPx, { immediate: true, force: true });
      if (state.snap) state.snap.currentSnapIndex = targetIndex + 1;
      activateCard(targetIndex);
      state.currentIndex = targetIndex;
      state.scrollPosition = targetIndex + 1;
    } else {
      state.currentMobileStep = targetIndex;
      state.mobileInIntro = false;
      activateCard(targetIndex);
      state.steps.forEach((step, i) => {
        if (i === targetIndex) {
          step.classList.add("mobile-active");
        } else {
          step.classList.remove("mobile-active");
        }
      });
    }
    if (parsed.layer !== null) {
      const stepNumber = state.steps[targetIndex]?.dataset?.step;
      if (stepNumber) {
        let delay = 100;
        const onTarget = () => state.lenis ? state.currentIndex === targetIndex : state.currentMobileStep === targetIndex;
        if (parsed.layer >= 2) {
          _deepLinkTimers.push(setTimeout(() => {
            if (onTarget()) openPanel("layer1", stepNumber);
          }, delay));
          delay += 200;
        }
        _deepLinkTimers.push(setTimeout(() => {
          if (onTarget()) openPanel("layer" + parsed.layer, stepNumber);
        }, delay));
        delay += 200;
        if (parsed.subType === "g" && parsed.subN !== null) {
          _deepLinkTimers.push(setTimeout(() => {
            if (!onTarget()) return;
            const panelContent = document.getElementById("panel-layer" + parsed.layer + "-content");
            if (panelContent) {
              const target = panelContent.querySelector(`[data-deep-link-n="${parsed.subN}"]`);
              if (target) target.click();
            }
          }, delay));
        }
        if (_deepLinkTimers.length) _armDeepLinkCancellation();
      }
    }
  }

  // assets/js/telar-story/scroll-engine.js
  var lenis;
  var snap;
  var snapRemovers = [];
  var rafId;
  var dwellTimer;
  var totalPositions = 0;
  function initScrollEngine(stepCount) {
    const surface = document.querySelector(".scroll-surface");
    const cardStack = document.querySelector(".card-stack");
    if (!surface || !cardStack) {
      console.error("scroll-engine: .scroll-surface or .card-stack not found in DOM");
      return;
    }
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (dwellTimer) {
      clearTimeout(dwellTimer);
      dwellTimer = null;
    }
    state.steps = Array.from(document.querySelectorAll(".story-step"));
    history.scrollRestoration = "manual";
    totalPositions = stepCount + 1;
    surface.style.height = `${totalPositions * window.innerHeight}px`;
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    lenis = new Lenis({
      lerp: 0.06,
      // lower = heavier, more contemplative feel
      smoothWheel: !prefersReduced,
      wheelMultiplier: 0.5,
      // scroll sensitivity
      autoRaf: false,
      // we drive the rAF loop manually
      prevent: (node) => node.closest(".offcanvas") !== null || node.closest("[data-telar-panel]") !== null
      // let wheel events pass through inside open panels
    });
    snap = new Snap(lenis, {
      type: "lock",
      velocityThreshold: 0.5,
      debounce: 150,
      distanceThreshold: "20%",
      lerp: 0.08,
      onSnapStart: () => {
        state.isSnapping = true;
      },
      onSnapComplete: () => {
        state.isSnapping = false;
        const finalPosition = lenis.animatedScroll / window.innerHeight;
        updateScrollPosition(finalPosition);
        lenis.stop();
        dwellTimer = setTimeout(() => {
          if (!state.isPanelOpen) {
            lenis.start();
          }
          dwellTimer = null;
        }, 500);
      }
    });
    lenis.on("scroll", (l) => {
      const position = l.animatedScroll / window.innerHeight;
      updateScrollPosition(position);
    });
    rafId = requestAnimationFrame(function raf(time) {
      lenis.raf(time);
      rafId = requestAnimationFrame(raf);
    });
    onViewportResize(({ viewport }) => {
      surface.style.height = `${totalPositions * viewport.h}px`;
      lenis.resize();
      registerSnapPoints(totalPositions);
    });
    state.lenis = lenis;
    state.snap = snap;
    initKeyboardNavigation();
    initializeLoadingShimmer();
  }
  function registerSnapPoints(count) {
    snapRemovers.forEach((fn) => fn());
    snapRemovers = [];
    for (let i = 0; i < count; i++) {
      snapRemovers.push(snap.add(i * window.innerHeight));
    }
  }
  function advanceToStep(targetIndex) {
    if (targetIndex < 0 || targetIndex >= state.steps.length) return;
    const lenisInstance = state.lenis || lenis;
    if (!lenisInstance) return;
    const targetPx = (targetIndex + 1) * window.innerHeight;
    lenisInstance.scrollTo(targetPx, {
      duration: 0.5,
      easing: (t) => 1 - Math.pow(1 - t, 3)
      // ease-out cubic
    });
  }
  function keyboardNav(direction) {
    if (!lenis) return;
    if (dwellTimer) {
      clearTimeout(dwellTimer);
      dwellTimer = null;
      lenis.start();
    }
    const vh = window.innerHeight;
    const position = lenis.animatedScroll / vh;
    const isExact = Math.abs(position - Math.round(position)) < 0.01;
    const rounded = Math.round(position);
    let target;
    if (direction === "forward") {
      target = isExact ? rounded + 1 : Math.ceil(position);
    } else {
      target = isExact ? rounded - 1 : Math.floor(position);
    }
    target = Math.max(0, Math.min(target, totalPositions - 1));
    if (target === rounded && isExact) return;
    if (snap) snap.currentSnapIndex = target;
    lenis.scrollTo(target * vh, {
      force: true,
      duration: 0.8,
      easing: (t) => 1 - Math.pow(1 - t, 3),
      // ease-out cubic
      onComplete: () => {
        writeHash();
      }
    });
  }
  function getScrollEngineState() {
    return {
      lenis,
      snap,
      position: state.scrollPosition,
      progress: state.scrollProgress
    };
  }
  function updateScrollPosition(position) {
    const contentPos = position - 1;
    state.scrollPosition = position;
    if (position < 1) {
      state.scrollProgress = 0;
      if (state.currentIndex >= 0) {
        goToStep(-1, "backward");
      }
      const progress2 = position;
      const firstCard = state.textCards?.[0];
      if (firstCard) {
        const rot = parseFloat(firstCard.dataset.messinessRot || 0);
        const offX = parseFloat(firstCard.dataset.messinessOffX || 0);
        const offY = parseFloat(firstCard.dataset.messinessOffY || 0);
        const translateY = (1 - progress2) * 100;
        firstCard.style.transform = `translateY(${translateY}vh) rotate(${rot}deg) translate(${offX}px, ${offY}px)`;
      }
      const firstPlate = state.viewerPlates?.[0];
      if (firstPlate) {
        const plateTranslateY = (1 - progress2) * 100;
        firstPlate.style.transform = `translateY(${plateTranslateY}%)`;
      }
      return;
    }
    const { stepIndex, progress } = scrollCardPool(contentPos);
    state.scrollProgress = progress;
    if (stepIndex !== state.currentIndex) {
      state.currentIndex = stepIndex;
      writeHash();
      updateViewerInfo(stepIndex);
      if (state.onStepChange) state.onStepChange(stepIndex);
    }
  }

  // assets/js/telar-story/navigation.js
  function initKeyboardNavigation() {
    document.addEventListener("keydown", handleKeyboard);
  }
  function goToStep(newIndex, direction = "forward") {
    if (newIndex < -1 || newIndex >= state.steps.length) return;
    const prevStep2 = state.currentIndex;
    state.currentIndex = newIndex;
    if (newIndex === -1) {
      const intro = document.querySelector(".story-intro");
      if (intro) {
        intro.style.transition = "transform 0.5s ease-out";
        intro.style.transform = "translateY(0)";
      }
      returnToIntro();
      state.currentObjectRun = { objectId: null, runPosition: 0 };
      updateViewerInfo(-1);
      const creditBadge = document.getElementById("object-credits-badge");
      if (creditBadge) creditBadge.classList.add("d-none");
      if (state.onStepChange) state.onStepChange(-1);
      return;
    }
    activateCard(newIndex, true);
    if (prevStep2 >= 0 && prevStep2 !== newIndex) deactivateCard(prevStep2, direction);
    updateViewerInfo(newIndex);
    if (state.onStepChange) state.onStepChange(newIndex);
  }
  function nextStep() {
    goToStep(state.currentIndex + 1, "forward");
  }
  function prevStep() {
    goToStep(state.currentIndex - 1, "backward");
  }
  function createNavigationButtons() {
    if (document.querySelector(".mobile-nav")) {
      console.warn("Navigation buttons already exist, skipping creation");
      return null;
    }
    const navContainer = document.createElement("div");
    navContainer.className = "mobile-nav";
    const prevButton = document.createElement("button");
    prevButton.className = "mobile-prev";
    prevButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" height="32" viewBox="0 -960 960 960" width="32" fill="currentColor"><path d="M440-160v-487L216-423l-56-57 320-320 320 320-56 57-224-224v487h-80Z"/></svg>';
    prevButton.setAttribute("aria-label", "Previous step");
    const nextButton = document.createElement("button");
    nextButton.className = "mobile-next";
    nextButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" height="32" viewBox="0 -960 960 960" width="32" fill="currentColor"><path d="M440-800v487L216-537l-56 57 320 320 320-320-56-57-224 224v-487h-80Z"/></svg>';
    nextButton.setAttribute("aria-label", "Next step");
    navContainer.appendChild(prevButton);
    navContainer.appendChild(nextButton);
    document.body.appendChild(navContainer);
    return { container: navContainer, prev: prevButton, next: nextButton };
  }
  function initializeButtonNavigation() {
    state.steps = Array.from(document.querySelectorAll(".story-step"));
    initializeLoadingShimmer();
    state.steps.forEach((step) => {
      step.classList.remove("mobile-active");
    });
    if (state.steps.length > 0) {
      state.steps[0].classList.add("mobile-active");
      state.currentMobileStep = 0;
    }
    const buttons = createNavigationButtons();
    if (!buttons) return;
    state.mobileNavButtons = { prev: buttons.prev, next: buttons.next };
    buttons.prev.addEventListener("click", goToPreviousMobileStep);
    buttons.next.addEventListener("click", goToNextMobileStep);
    updateMobileButtonStates();
  }
  function goToNextMobileStep() {
    if (state.mobileInIntro) {
      _dismissMobileIntro();
      return;
    }
    if (state.currentMobileStep >= state.steps.length - 1) {
      return;
    }
    goToMobileStep(state.currentMobileStep + 1);
  }
  function goToPreviousMobileStep() {
    if (state.mobileInIntro) {
      return;
    }
    if (state.currentMobileStep === 0) {
      _restoreMobileIntro();
      return;
    }
    goToMobileStep(state.currentMobileStep - 1);
  }
  function _restoreMobileIntro() {
    if (state.mobileNavigationCooldown) return;
    state.mobileNavigationCooldown = true;
    setTimeout(() => {
      state.mobileNavigationCooldown = false;
    }, MOBILE_NAV_COOLDOWN);
    state.mobileInIntro = true;
    const intro = document.querySelector(".story-intro");
    if (intro) {
      intro.style.transition = "transform 0.5s ease-out";
      intro.style.transform = "translateY(0)";
    }
    const firstCard = state.textCards?.[0];
    if (firstCard) {
      firstCard.classList.remove("is-active", "is-stacked");
      const rot = parseFloat(firstCard.dataset.messinessRot || 0);
      const offX = parseFloat(firstCard.dataset.messinessOffX || 0);
      const offY = parseFloat(firstCard.dataset.messinessOffY || 0);
      firstCard.style.transform = `translateY(100vh) rotate(${rot}deg) translate(${offX}px, ${offY}px)`;
    }
    const firstPlate = state.viewerPlates?.[0];
    if (firstPlate) {
      firstPlate.style.transform = "translateY(100%)";
      firstPlate.classList.remove("is-active");
    }
    state.currentObjectRun = { objectId: null, runPosition: 0 };
    updateViewerInfo(-1);
    const creditBadge = document.getElementById("object-credits-badge");
    if (creditBadge) creditBadge.classList.add("d-none");
    updateMobileButtonStates();
  }
  function _dismissMobileIntro() {
    if (state.mobileNavigationCooldown) return;
    state.mobileNavigationCooldown = true;
    setTimeout(() => {
      state.mobileNavigationCooldown = false;
    }, MOBILE_NAV_COOLDOWN);
    state.mobileInIntro = false;
    const intro = document.querySelector(".story-intro");
    if (intro) {
      intro.style.transition = "transform 0.5s ease-out";
      intro.style.transform = "translateY(-100%)";
    }
    state.currentMobileStep = 0;
    activateCard(0);
    updateViewerInfo(0);
    updateMobileButtonStates();
  }
  function goToMobileStep(newIndex) {
    if (newIndex < 0 || newIndex >= state.steps.length) {
      return;
    }
    if (state.mobileNavigationCooldown) {
      return;
    }
    const newStep = state.steps[newIndex];
    const objectId = newStep.dataset.object;
    const viewerCard = state.viewerCards.find((vc) => vc.objectId === objectId);
    if (!viewerCard || !viewerCard.isReady) {
      showViewerSkeletonState();
    }
    state.mobileNavigationCooldown = true;
    setTimeout(() => {
      state.mobileNavigationCooldown = false;
    }, MOBILE_NAV_COOLDOWN);
    const prevStep2 = state.currentMobileStep;
    const direction = newIndex > state.currentMobileStep ? "forward" : "backward";
    state.steps[state.currentMobileStep].classList.remove("mobile-active");
    state.steps[newIndex].classList.add("mobile-active");
    state.currentMobileStep = newIndex;
    updateMobileButtonStates();
    if (state.lenis) {
      advanceToStep(newIndex);
    } else {
      activateCard(newIndex, true);
      if (prevStep2 >= 0 && prevStep2 !== newIndex) deactivateCard(prevStep2, direction);
    }
    updateViewerInfo(newIndex);
    writeHash();
  }
  function updateMobileButtonStates() {
    if (!state.mobileNavButtons) return;
    state.mobileNavButtons.prev.disabled = !!state.mobileInIntro;
    state.mobileNavButtons.next.disabled = state.currentMobileStep === state.steps.length - 1;
  }
  function handleKeyboard(e) {
    if (e.repeat && !state.isPanelOpen) return;
    switch (e.key) {
      case "ArrowDown":
      case "PageDown":
        if (state.isPanelOpen) {
          scrollOpenPanel(40);
          break;
        }
        e.preventDefault();
        if (!state.scrollLockActive) {
          if (state.lenis) {
            keyboardNav("forward");
          } else {
            nextStep();
          }
        }
        break;
      case "ArrowUp":
      case "PageUp":
        if (state.isPanelOpen) {
          scrollOpenPanel(-40);
          break;
        }
        e.preventDefault();
        if (!state.scrollLockActive) {
          if (state.lenis) {
            keyboardNav("backward");
          } else {
            prevStep();
          }
        }
        break;
      case "ArrowRight":
        e.preventDefault();
        if (!state.isPanelOpen) {
          const stepForL1 = getCurrentStepData();
          const stepNumForL1 = getCurrentStepNumber();
          if (stepForL1 && stepHasLayer1Content(stepForL1)) {
            openPanel("layer1", stepNumForL1);
          }
        } else if (state.panelStack.length === 1 && state.panelStack[0]?.type === "layer1") {
          const stepForL2 = getCurrentStepData();
          const stepNumForL2 = getCurrentStepNumber();
          if (stepForL2 && stepHasLayer2Content(stepForL2)) {
            openPanel("layer2", stepNumForL2);
          }
        }
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (state.isPanelOpen) {
          closeTopPanel();
        }
        break;
      case "Escape":
        if (state.isPanelOpen) {
          e.preventDefault();
          closeTopPanel();
        }
        break;
      case " ":
        if (state.isPanelOpen) {
          scrollOpenPanel(e.shiftKey ? -100 : 100);
          e.preventDefault();
          break;
        }
        e.preventDefault();
        if (!state.scrollLockActive) {
          if (e.shiftKey) {
            if (state.lenis) keyboardNav("backward");
            else prevStep();
          } else {
            if (state.lenis) keyboardNav("forward");
            else nextStep();
          }
        }
        break;
    }
  }
  function scrollOpenPanel(delta) {
    const top = state.panelStack[state.panelStack.length - 1];
    if (!top) return;
    const panel = document.getElementById(`panel-${top.type}`);
    const body = panel?.querySelector(".offcanvas-body");
    if (body) body.scrollBy({ top: delta, behavior: "smooth" });
  }
  function getCurrentStepNumber() {
    if (state.currentIndex < 0 || state.currentIndex >= state.steps.length) {
      return null;
    }
    return state.steps[state.currentIndex].dataset.step;
  }
  function getCurrentStepData() {
    const stepNumber = getCurrentStepNumber();
    if (!stepNumber) return null;
    const steps = window.storyData?.steps || [];
    return steps.find((s) => s.step == stepNumber);
  }
  function updateViewerInfo(stepIndex) {
    const counter = document.getElementById("step-counter");
    const infoElement = document.getElementById("current-object-title");
    if (!counter || !infoElement) return;
    if (stepIndex < 0) {
      counter.classList.add("d-none");
      return;
    }
    counter.classList.remove("d-none");
    const total = (window.storyData?.steps || []).filter((s) => !s._metadata).length;
    const stepTemplate = window.telarLang.stepNumber || "Step {{ number }}";
    const display = stepTemplate.replace("{{ number }}", stepIndex + 1);
    infoElement.textContent = total > 0 ? `${display} / ${total}` : display;
  }

  // assets/js/telar-story/main.js
  if (typeof window !== "undefined") {
    window.IiifViewer = IiifViewer;
  }
  function initializeStory() {
    const viewerConfig = window.telarConfig?.viewer_preloading || {};
    state.config.maxViewerCards = Math.min(viewerConfig.max_viewer_cards || 10, 15);
    state.config.preloadSteps = Math.min(viewerConfig.preload_steps || 6, state.config.maxViewerCards - 2);
    state.config.loadingThreshold = viewerConfig.loading_threshold || 5;
    state.config.minReadyViewers = Math.min(viewerConfig.min_ready_viewers || 3, state.config.preloadSteps);
    buildObjectsIndex();
    prefetchStoryManifests();
    const cardConfig = {
      peekHeight: window.telarConfig?.cardPeekHeight ?? 1,
      messiness: window.telarConfig?.cardMessiness ?? 20
    };
    initCardPool(window.storyData, cardConfig);
    state.isEmbed = window.telarEmbed?.enabled || false;
    state.layoutMode = getLayoutMode();
    onLayoutChange(({ to }) => {
      state.layoutMode = to;
      const activeCard = document.querySelector(".text-card.is-active");
      state.cardOverlayRect = activeCard ? activeCard.getBoundingClientRect() : null;
    });
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (state.isEmbed) {
      initializeButtonNavigation();
      const stepCount = (window.storyData?.steps || []).filter((s) => !s._metadata).length;
      initScrollEngine(stepCount);
    } else if (state.layoutMode === "vertical") {
      initializeButtonNavigation();
    } else if (isIOS) {
      initializeButtonNavigation();
    } else {
      const stepCount = (window.storyData?.steps || []).filter((s) => !s._metadata).length;
      initScrollEngine(stepCount);
    }
    initializePanels();
    applyDeepLinkOnLoad();
    const btnNav = document.getElementById("btn-nav-back");
    if (btnNav) {
      btnNav.classList.add("is-home");
      const homeUrl = btnNav.dataset.homeUrl;
      const homeText = btnNav.dataset.homeText;
      const startText = btnNav.dataset.startText;
      const textEl = btnNav.querySelector(".btn-nav-text");
      state.onStepChange = (index2) => {
        if (index2 < 0) {
          btnNav.classList.remove("is-start");
          btnNav.classList.add("is-home");
          btnNav.href = homeUrl;
          if (textEl) textEl.textContent = homeText;
        } else {
          btnNav.classList.remove("is-home");
          btnNav.classList.add("is-start");
          btnNav.removeAttribute("href");
          if (textEl) textEl.textContent = startText;
        }
      };
      btnNav.addEventListener("click", (e) => {
        if (btnNav.classList.contains("is-start")) {
          e.preventDefault();
          navigateToIntro();
        }
      });
    }
    document.querySelectorAll(".intro-toc-link[data-target-step]").forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const step = parseInt(link.dataset.targetStep, 10);
        if (step) navigateToStep(step);
      });
    });
    initializeScrollLock();
    initializeCredits();
  }
  document.addEventListener("DOMContentLoaded", function() {
    if (window.storyData?.encrypted) {
      window.addEventListener("telar:story-unlocked", function() {
        initializeStory();
      }, { once: true });
    } else {
      initializeStory();
    }
  });
  window.TelarStory = {
    state,
    activateCard,
    openPanel,
    getManifestUrl,
    closeAllPanels,
    getScrollEngineState,
    navigateToStep
  };
})();
//# sourceMappingURL=telar-story.js.map

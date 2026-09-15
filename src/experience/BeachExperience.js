import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { assetUrl } from './assetUrl.js';

import { BeachBilliardsGame } from './BeachBilliardsGame.js';
import { BeachDiscoveryGame } from './BeachDiscoveryGame.js';
import { BloomPostProcessor } from './BloomPostProcessor.js';
import { CameraBookmarks } from './CameraBookmarks.js';
import { CoastalProps } from './CoastalProps.js';
import { BeachNpcSystem } from './BeachNpcSystem.js';
import { BeachEnvironment } from './environment.js';
import { FreeCameraController } from './FreeCameraController.js';
import { FootstepAudio } from './FootstepAudio.js';
import { GpuFrameTimer } from './GpuFrameTimer.js';
import { LocalAssetManager } from './LocalAssetManager.js';
import { RainSystem } from './RainSystem.js';
import { createBeachWorld, terrainHeight } from './world.js';
import { STREET_WALK_MAX_Z } from './CoastalStreet.js';

// The entry view reads the path, activity clearing and shoreline together.
const CAMERA_VIEWS = {
  desktop: {
    position: new THREE.Vector3(32, 16, 58),
    target: new THREE.Vector3(10, 1.8, 22),
  },
  mobile: {
    position: new THREE.Vector3(15, 16, 90),
    target: new THREE.Vector3(6, 2, 25),
  },
};

const BILLIARDS_CAMERA_VIEWS = {
  desktop: {
    positionOffset: new THREE.Vector3(0, 7.2, 9.5),
    targetHeight: 1.86,
  },
  mobile: {
    positionOffset: new THREE.Vector3(0, 11.6, 16.2),
    targetHeight: 1.86,
  },
};

// Returning from free flight keeps the current look direction, while this
// target box prevents OrbitControls from pivoting around a point under the
// sand or far beyond the authored shoreline.
const ORBIT_TARGET_BOUNDS = new THREE.Box3(
  new THREE.Vector3(-45, 0.8, -36),
  new THREE.Vector3(45, 16, STREET_WALK_MAX_Z),
);

const WALK_ENTRY_POSITION = new THREE.Vector3(41, 0, 35);
const WALK_ENTRY_TARGET = new THREE.Vector3(
  24,
  terrainHeight(24, 20) + 1.35,
  20,
);

const GPU_AUTO_QUALITY_BUDGET_MS = 20;
const GPU_AUTO_QUALITY_MIN_SAMPLES = 12;

/**
 * Owns the renderer-facing lifecycle: initialization, quality selection,
 * camera interaction, the frame loop and teardown.
 */
export class BeachExperience extends EventTarget {
  constructor(canvas, { onProgress = () => {} } = {}) {
    super();
    this.canvas = canvas;
    this.onProgress = onProgress;
    this.initialized = false;
    this.previewing = false;
    this.entered = false;
    this.isVisible = !document.hidden;
    this.qualityMode = 'auto';
    this.effectiveQuality = this.detectAutoQuality();
    this.shadowsEnabled = true;
    this.rainEnabled = false;
    this.bloomEnabled = false;
    this.footstepAudioEnabled = false;
    this.adaptedDown = false;
    this.foamStrength = 0.85;
    this.tideMode = 'auto';
    this.tideStateKey = '';
    this.worldRevision = 0;
    this.cameraTween = null;
    this.fpsFrames = 0;
    this.fpsElapsed = 0;
    this.lastMeasuredFps = 60;
    this.lastAdaptationReason = 'monitoring';
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.disposed = false;
    this.cameraMode = 'orbit';
    this.cameraViewMode = null;
    this.defaultCameraPosition = new THREE.Vector3();
    this.defaultCameraTarget = new THREE.Vector3();
    this.previewBasePosition = new THREE.Vector3();
    this.previewOffset = new THREE.Vector3();
    this.cameraDirection = new THREE.Vector3();
    this.orbitTargetBeforeFree = new THREE.Vector3();
    this.orbitPositionBeforeFree = new THREE.Vector3();
    this.orbitTargetCandidate = new THREE.Vector3();
    this.orbitOffset = new THREE.Vector3();
    this.orbitHorizontalDirection = new THREE.Vector3();
    this.bookmarkTarget = new THREE.Vector3();
    this.billiardsViewPosition = new THREE.Vector3();
    this.billiardsViewTarget = new THREE.Vector3();
    this.billiardsViewMode = null;
    this.cameraBookmarks = new CameraBookmarks();
    this.billiardsEventHandlers = null;
    this.discoveryEventHandlers = null;

    this.handleResize = this.handleResize.bind(this);
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
    this.handleContextLost = this.handleContextLost.bind(this);
    this.handleContextRestored = this.handleContextRestored.bind(this);
    this.handleFreeCameraStateChange =
      this.handleFreeCameraStateChange.bind(this);
    this.handleFreeCameraExitRequest =
      this.handleFreeCameraExitRequest.bind(this);
    this.handleFreeCameraActivationError =
      this.handleFreeCameraActivationError.bind(this);
    this.animate = this.animate.bind(this);
  }

  async init() {
    // Progress values represent meaningful initialization milestones for the UI.
    this.onProgress(0.08);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: this.effectiveQuality === 'high',
      alpha: false,
      depth: true,
      stencil: false,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x9dc7cb, 1);
    // Water performs a nested mirror render. Manual reset keeps renderer.info
    // cumulative for the complete animation frame instead of half a pass.
    this.renderer.info.autoReset = false;
    this.gpuFrameTimer = new GpuFrameTimer(this.renderer.getContext());

    this.scene = new THREE.Scene();
    this.worldSlot = new THREE.Group();
    this.worldSlot.name = 'WorldSlot';
    this.scene.add(this.worldSlot);
    this.camera = new THREE.PerspectiveCamera(47, 1, 0.1, 1800);
    this.refreshDefaultCameraView();
    this.camera.position.copy(this.defaultCameraPosition);
    this.bloom = new BloomPostProcessor({
      renderer: this.renderer,
      scene: this.scene,
      camera: this.camera,
      quality: this.effectiveQuality,
    });

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.target.copy(this.defaultCameraTarget);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.055;
    this.controls.enablePan = false;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 72;
    this.controls.minPolarAngle = Math.PI * 0.12;
    this.controls.maxPolarAngle = Math.PI * 0.485;
    this.controls.rotateSpeed = 0.55;
    this.controls.zoomSpeed = 0.72;
    this.controls.enabled = false;
    this.controls.update();

    this.freeCamera = new FreeCameraController(this.camera, this.canvas, {
      minimumHeightAt: (x, z) =>
        this.world?.getWalkSurfaceHeight?.(x, z) ?? terrainHeight(x, z),
      walkMinimumZAt: (x) =>
        this.world?.getWalkBoundaryZ?.(x) ?? 3.6,
      enableHeadBob: !this.reducedMotion,
      resolvePosition: (position, options) =>
        this.world?.resolveCameraPosition(position, options) ?? null,
    });
    this.freeCamera.addEventListener(
      'statechange',
      this.handleFreeCameraStateChange,
    );
    this.freeCamera.addEventListener(
      'exitrequest',
      this.handleFreeCameraExitRequest,
    );
    this.freeCamera.addEventListener(
      'activationerror',
      this.handleFreeCameraActivationError,
    );
    this.footstepAudio = new FootstepAudio();

    this.previewBasePosition.copy(this.defaultCameraPosition);
    this.onProgress(0.24);

    const waterNormals = await this.loadWaterNormal();
    const skyTexture = await this.loadSkyTexture();
    if (this.disposed) { waterNormals?.dispose(); skyTexture?.dispose(); return; }
    this.onProgress(0.56);

    this.world = createBeachWorld(this.worldSlot, {
      quality: this.effectiveQuality,
    });
    this.worldRevision = 1;
    this.onProgress(0.76);

    this.coastalProps = new CoastalProps({ scene: this.scene, world: this.world, quality: this.effectiveQuality });
    await this.coastalProps.ready;
    if (this.disposed) { waterNormals?.dispose(); skyTexture?.dispose(); return; }
    this.onProgress(0.82);

    this.environment = new BeachEnvironment({
      scene: this.scene,
      renderer: this.renderer,
      camera: this.camera,
      waterNormals,
      skyTexture,
      world: this.world,
      quality: this.effectiveQuality,
    });
    this.environment.setTimeOfDay('day', true);
    this.environment.setWeather('clear', true);
    this.setTideMode(this.tideMode, true);

    this.rain = new RainSystem({
      scene: this.scene,
      camera: this.camera,
      quality: this.effectiveQuality,
    });
    this.rain.setEnabled(this.rainEnabled);
    this.rain.setWindFactor(this.environment.getWindState().factor);
    this.world.registerReflectionExclusion(this.rain.lines);
    this.localAssets = new LocalAssetManager({
      scene: this.scene,
      camera: this.camera,
      renderer: this.renderer,
    });
    this.localAssets.setShadows(
      this.shadowsEnabled && this.effectiveQuality === 'high',
    );
    this.billiards = new BeachBilliardsGame({
      scene: this.scene,
      camera: this.camera,
      domElement: this.canvas,
      quality: this.effectiveQuality,
    });
    this.billiards.setShadows(
      this.shadowsEnabled && this.effectiveQuality === 'high',
    );
    this.bindBilliardsEvents();
    this.billiards.setEnabled(false);
    this.world.registerCameraCollider(this.billiards.cameraCollider);

    this.discovery = new BeachDiscoveryGame({
      world: this.world,
      scene: this.scene,
      camera: this.camera,
      domElement: this.canvas,
      quality: this.effectiveQuality,
    });
    this.bindDiscoveryEvents();
    this.discovery.setEnabled(false);

    this.npcs = new BeachNpcSystem(this);
    this.npcs.addEventListener('dialogchange', () => this.dispatchEvent(new Event('npcdialogchange')));

    this.clock = new THREE.Clock();
    this.handleResize();
    this.applyQuality(this.effectiveQuality);
    this.bindEvents();
    this.renderer.setAnimationLoop(this.animate);
    this.initialized = true;
    this.onProgress(1);
  }

  async loadWaterNormal() {
    const loader = new THREE.TextureLoader();

    try {
      const texture = await loader.loadAsync(assetUrl('textures/water-normal-three-r160.jpg'));
      texture.colorSpace = THREE.NoColorSpace;
      return texture;
    } catch (error) {
      console.warn('Local water normal was unavailable; using procedural fallback.', error);
      return null;
    }
  }

  async loadSkyTexture() {
    try {
      const response = await fetch(assetUrl('textures/coastal-sky-2k.hdr'), { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`Sky HTTP ${response.status}`);
      const data = new RGBELoader().parse(await response.arrayBuffer());
      const texture = new THREE.DataTexture(data.data, data.width, data.height, THREE.RGBAFormat, data.type);
      texture.name = 'CoastalPureSkyHDR';
      texture.colorSpace = THREE.LinearSRGBColorSpace;
      texture.minFilter = texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      texture.flipY = true;
      texture.wrapS = THREE.RepeatWrapping;
      texture.needsUpdate = true;
      return texture;
    } catch (error) {
      console.warn('HDR sky unavailable; keeping analytical sky.', error);
      return null;
    }
  }

  bindEvents() {
    window.addEventListener('resize', this.handleResize, { passive: true });
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.canvas.addEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.addEventListener(
      'webglcontextrestored',
      this.handleContextRestored,
    );
  }

  bindDiscoveryEvents() {
    const forward = (type) => (event) => {
      this.dispatchEvent(
        new CustomEvent(`discovery${type}`, { detail: event.detail ?? null }),
      );
    };
    this.discoveryEventHandlers = {
      progress: forward('progress'),
      focus: forward('focus'),
      found: forward('found'),
      complete: forward('complete'),
      reset: forward('reset'),
    };
    this.discovery.addEventListener(
      'progresschange',
      this.discoveryEventHandlers.progress,
    );
    this.discovery.addEventListener(
      'focuschange',
      this.discoveryEventHandlers.focus,
    );
    this.discovery.addEventListener('discover', this.discoveryEventHandlers.found);
    this.discovery.addEventListener(
      'complete',
      this.discoveryEventHandlers.complete,
    );
    this.discovery.addEventListener('reset', this.discoveryEventHandlers.reset);
  }

  bindBilliardsEvents() {
    const forward = (type) => (event) => {
      this.dispatchEvent(
        new CustomEvent(`billiards${type}`, { detail: event.detail ?? null }),
      );
    };
    this.billiardsEventHandlers = {
      progress: (event) => {
        if (this.billiardsViewMode && this.billiardsViewMode !== 'table'
          && (event.detail?.placingCue || event.detail?.pending || event.detail?.completed)) this.focusBilliards('table');
        forward('progress')(event);
      },
      shot: (event) => {
        this.setBilliardsMode('observe');
        forward('shot')(event);
      },
      pocket: forward('pocket'),
      complete: forward('complete'),
      reset: forward('reset'),
      aim: (event) => {
        const aiming = Boolean(event.detail?.aiming);
        if (this.cameraMode === 'orbit') {
          this.controls.enabled = this.entered && !this.cameraTween && !aiming
            && this.billiardsViewMode !== 'cue' && !document.querySelector('dialog[open]');
        }
        this.dispatchEvent(
          new CustomEvent('billiardsaimchange', {
            detail: event.detail ?? null,
          }),
        );
      },
    };
    this.billiards.addEventListener(
      'progresschange',
      this.billiardsEventHandlers.progress,
    );
    this.billiards.addEventListener('shot', this.billiardsEventHandlers.shot);
    this.billiards.addEventListener(
      'pocket',
      this.billiardsEventHandlers.pocket,
    );
    this.billiards.addEventListener(
      'complete',
      this.billiardsEventHandlers.complete,
    );
    this.billiards.addEventListener('reset', this.billiardsEventHandlers.reset);
    this.billiards.addEventListener(
      'aimchange',
      this.billiardsEventHandlers.aim,
    );
  }

  startPreview() {
    this.previewing = true;
  }

  enter() {
    this.entered = true;
    this.npcs?.setEnabled(true);
    this.previewing = false;
    this.controls.enabled = this.cameraMode === 'orbit';
    this.billiards?.setEnabled(true).then(() => {
      if (
        !this.disposed &&
        this.entered &&
        this.billiards?.initialized
      ) {
        this.world?.registerReflectionExclusion(this.billiards.group);
      }
    });
    this.discovery?.setEnabled(true);
    if (this.discovery?.initialized) {
      this.world.registerReflectionExclusion(this.discovery.group);
    }
    this.canvas.focus({ preventScroll: true });
  }

  supportsFreeCamera() {
    // any-pointer keeps the mode available on hybrid laptops when a mouse is
    // connected even if the touchscreen is reported as the primary pointer.
    const hasFinePointer = window.matchMedia('(any-pointer: fine)').matches;
    return Boolean(this.freeCamera?.supportsPointerLock && hasFinePointer);
  }

  toggleCameraMode(mode = 'free') {
    return this.setCameraMode(this.cameraMode === mode ? 'orbit' : mode);
  }

  setCameraMode(mode, { requestPointerLock = true } = {}) {
    if (!['orbit', 'walk', 'free'].includes(mode)) return this.cameraMode;
    if (mode === this.cameraMode) return this.cameraMode;
    this.leaveBilliardsView();
    const enteringPointerMode = mode !== 'orbit';
    const leavingOrbit = this.cameraMode === 'orbit';

    if (enteringPointerMode) {
      if (!this.entered) return this.cameraMode;
      if (requestPointerLock && !this.supportsFreeCamera()) {
        this.dispatchCameraModeChange();
        return this.cameraMode;
      }

      this.cameraTween = null;
      this.previewing = false;
      if (leavingOrbit) {
        this.orbitTargetBeforeFree.copy(this.controls.target);
        this.orbitPositionBeforeFree.copy(this.camera.position);
        this.controls.enabled = false;
        if (mode === 'walk') {
          const surfaceHeight =
            this.world?.getWalkSurfaceHeight?.(
              WALK_ENTRY_POSITION.x,
              WALK_ENTRY_POSITION.z,
            ) ?? terrainHeight(WALK_ENTRY_POSITION.x, WALK_ENTRY_POSITION.z);
          this.camera.position.set(
            WALK_ENTRY_POSITION.x,
            surfaceHeight + this.freeCamera.walkEyeHeight,
            WALK_ENTRY_POSITION.z,
          );
          this.camera.lookAt(WALK_ENTRY_TARGET);
          this.camera.updateMatrixWorld(true);
        }
        this.cameraMode = mode;
        const activated = this.freeCamera.activate({
          requestPointerLock,
          movementMode: mode,
        });
        if (!activated) {
          this.cameraMode = 'orbit';
          this.camera.position.copy(this.orbitPositionBeforeFree);
          this.controls.target.copy(this.orbitTargetBeforeFree);
          this.controls.enabled = this.entered;
          this.controls.update();
        }
      } else {
        // WALK and FREE share one pointer-lock session. Switching the movement
        // strategy keeps the current heading while grounding only WALK.
        this.cameraMode = mode;
        this.freeCamera.setMovementMode(mode);
      }
      this.dispatchCameraModeChange();
      return this.cameraMode;
    }

    const shouldRestoreOrbitTarget =
      !this.freeCamera.sessionWasLocked &&
      !this.freeCamera.allowUnlockedMovement;
    this.cameraMode = 'orbit';
    this.freeCamera.deactivate();
    if (shouldRestoreOrbitTarget) {
      this.camera.position.copy(this.orbitPositionBeforeFree);
      this.controls.target.copy(this.orbitTargetBeforeFree);
      this.controls.update();
    } else {
      this.syncOrbitTargetFromCamera();
    }
    this.controls.enabled = this.entered && !this.cameraTween;
    this.dispatchCameraModeChange();
    return this.cameraMode;
  }

  syncOrbitTargetFromCamera() {
    this.camera.getWorldDirection(this.cameraDirection);
    this.orbitTargetCandidate
      .copy(this.camera.position)
      .addScaledVector(this.cameraDirection, 14)
      .clamp(ORBIT_TARGET_BOUNDS.min, ORBIT_TARGET_BOUNDS.max);
    this.orbitOffset
      .copy(this.camera.position)
      .sub(this.orbitTargetCandidate);
    const candidateDistance = this.orbitOffset.length();
    const candidatePolar =
      candidateDistance > 0.0001
        ? Math.acos(
            THREE.MathUtils.clamp(
              this.orbitOffset.y / candidateDistance,
              -1,
              1,
            ),
          )
        : Infinity;
    const candidateIsValid =
      candidateDistance >= this.controls.minDistance &&
      candidateDistance <= this.controls.maxDistance &&
      candidatePolar >= this.controls.minPolarAngle &&
      candidatePolar <= this.controls.maxPolarAngle;

    if (!candidateIsValid) {
      // At an authored boundary the look direction can point outside the
      // target box. Choose an inward horizontal direction and a legal pitch,
      // preserving the camera position instead of letting OrbitControls push
      // the camera several metres away to satisfy minDistance.
      this.orbitHorizontalDirection
        .set(
          this.defaultCameraTarget.x - this.camera.position.x,
          0,
          this.defaultCameraTarget.z - this.camera.position.z,
        );
      if (this.orbitHorizontalDirection.lengthSq() < 0.0001) {
        this.orbitHorizontalDirection.set(0, 0, -1);
      }
      this.orbitHorizontalDirection.normalize();

      const targetY = THREE.MathUtils.clamp(
        this.camera.position.y - 2.5,
        ORBIT_TARGET_BOUNDS.min.y,
        ORBIT_TARGET_BOUNDS.max.y,
      );
      const verticalDrop = Math.max(0.001, this.camera.position.y - targetY);
      const maximumHorizontal =
        verticalDrop * Math.tan(this.controls.maxPolarAngle - 0.002);
      const minimumForDistance = Math.sqrt(
        Math.max(
          0,
          (this.controls.minDistance + 0.1) ** 2 - verticalDrop ** 2,
        ),
      );
      const horizontalDistance = THREE.MathUtils.clamp(
        12,
        minimumForDistance,
        Math.max(minimumForDistance, maximumHorizontal),
      );
      this.orbitTargetCandidate
        .copy(this.camera.position)
        .addScaledVector(this.orbitHorizontalDirection, horizontalDistance);
      this.orbitTargetCandidate.y = targetY;
      this.orbitTargetCandidate.clamp(
        ORBIT_TARGET_BOUNDS.min,
        ORBIT_TARGET_BOUNDS.max,
      );
    }

    this.controls.target.copy(this.orbitTargetCandidate);
    this.camera.lookAt(this.controls.target);
    this.camera.updateMatrixWorld(true);
  }

  handleFreeCameraStateChange() {
    this.dispatchCameraModeChange();
  }

  handleFreeCameraExitRequest() {
    if (this.cameraMode !== 'orbit') this.setCameraMode('orbit');
  }

  handleFreeCameraActivationError(event) {
    this.dispatchEvent(
      new CustomEvent('cameraerror', {
        detail: event.detail,
      }),
    );
  }

  dispatchCameraModeChange() {
    const isPointerMode = this.cameraMode !== 'orbit';
    const detail = {
      mode: this.cameraMode,
      locked:
        isPointerMode &&
        (this.freeCamera?.isPointerLocked ?? false),
      pending:
        isPointerMode &&
        (this.freeCamera?.lockPending ?? false),
      interactive:
        isPointerMode &&
        ((this.freeCamera?.isPointerLocked ?? false) ||
          (this.freeCamera?.allowUnlockedMovement ?? false)),
      supported: this.supportsFreeCamera(),
    };
    this.discovery?.setCameraState(detail.mode, detail.interactive);
    this.billiards?.setCameraState(detail.mode);
    this.dispatchEvent(
      new CustomEvent('cameramodechange', {
        detail,
      }),
    );
  }

  setTimeOfDay(period) {
    this.environment?.setTimeOfDay(period);
  }

  setWeather(weather, immediate = false) {
    return this.environment?.setWeather(weather, immediate) ?? null;
  }

  setWaveSpeed(value) {
    this.environment?.setWaveSpeed(value);
  }

  setOceanSwellStrength(value) {
    return this.environment?.setOceanSwellStrength(value) ?? null;
  }

  setWindStrength(value, immediate = false) {
    const wind = this.environment?.setWindStrength(value, immediate) ?? null;
    if (wind) this.rain?.setWindFactor(wind.factor);
    return wind;
  }

  setTideMode(mode, immediate = false) {
    const tide = this.environment?.setTideMode(mode, immediate) ?? null;
    if (!tide) return null;
    this.tideMode = tide.mode;
    this.dispatchTideChange(tide, true);
    return tide;
  }

  dispatchTideChange(tide = this.environment?.getTideState(), force = false) {
    if (!tide) return;
    const stateKey = `${tide.mode}:${tide.band}`;
    if (!force && stateKey === this.tideStateKey) return;
    this.tideStateKey = stateKey;
    this.dispatchEvent(new CustomEvent('tidechange', { detail: tide }));
  }

  setFoamStrength(value) {
    this.foamStrength = value;
    this.world?.setFoamStrength(value);
    if (this.environment) this.environment.water.material.uniforms.uFoamStrength.value = value;
  }

  getCameraBookmarkState() {
    return this.cameraBookmarks.getDebugState();
  }

  saveCameraBookmark(slot) {
    if (!this.camera || !this.controls) return null;
    if (this.cameraMode === 'orbit') {
      this.bookmarkTarget.copy(this.controls.target);
    } else {
      this.camera.getWorldDirection(this.cameraDirection);
      this.bookmarkTarget
        .copy(this.camera.position)
        .addScaledVector(this.cameraDirection, 14)
        .clamp(ORBIT_TARGET_BOUNDS.min, ORBIT_TARGET_BOUNDS.max);
    }
    const bookmark = this.cameraBookmarks.save(slot, {
      position: this.camera.position.toArray(),
      target: this.bookmarkTarget.toArray(),
    });
    if (!bookmark) return null;
    const state = this.cameraBookmarks.getDebugState();
    this.dispatchEvent(
      new CustomEvent('camerabookmarkchange', {
        detail: { action: 'save', slot: Number(slot), bookmark, state },
      }),
    );
    return { slot: Number(slot), bookmark, state };
  }

  restoreCameraBookmark(slot) {
    const bookmark = this.cameraBookmarks.get(slot);
    if (!bookmark || !this.camera || !this.controls) return null;
    if (this.cameraMode !== 'orbit') this.setCameraMode('orbit');
    const toPosition = new THREE.Vector3().fromArray(bookmark.position);
    const toTarget = new THREE.Vector3()
      .fromArray(bookmark.target)
      .clamp(ORBIT_TARGET_BOUNDS.min, ORBIT_TARGET_BOUNDS.max);
    this.startCameraTween(toPosition, toTarget);
    const detail = {
      action: 'restore',
      slot: Number(slot),
      bookmark,
      state: this.cameraBookmarks.getDebugState(),
    };
    this.dispatchEvent(new CustomEvent('camerabookmarkrestore', { detail }));
    return detail;
  }

  removeCameraBookmark(slot) {
    if (!this.cameraBookmarks.remove(slot)) return null;
    const state = this.cameraBookmarks.getDebugState();
    const detail = { action: 'remove', slot: Number(slot), state };
    this.dispatchEvent(new CustomEvent('camerabookmarkchange', { detail }));
    return detail;
  }

  setRainEnabled(enabled) {
    this.rainEnabled = Boolean(enabled);
    const previousRainLines = this.rain?.lines;
    const state = this.rain?.setEnabled(this.rainEnabled) ?? {
      enabled: this.rainEnabled,
    };
    if (previousRainLines !== this.rain?.lines) {
      if (previousRainLines) {
        this.world?.unregisterReflectionExclusion(previousRainLines);
      }
      this.world?.registerReflectionExclusion(this.rain?.lines);
    }
    this.dispatchEvent(new CustomEvent('rainchange', { detail: state }));
    return state;
  }

  async setBloomEnabled(enabled) {
    const state = await this.bloom.setEnabled(enabled);
    this.bloomEnabled = state.enabled;
    this.dispatchEvent(new CustomEvent('bloomchange', { detail: state }));
    return state;
  }

  async setFootstepAudioEnabled(enabled) {
    const state = await this.footstepAudio.setEnabled(enabled);
    this.footstepAudioEnabled = state.enabled;
    this.dispatchEvent(
      new CustomEvent('footstepaudiochange', { detail: state }),
    );
    return state;
  }

  async importLocalAsset(kind, file) {
    if (!this.localAssets) throw new Error('本地资源系统尚未初始化。');
    const state = kind === 'model'
      ? await this.localAssets.importModel(file)
      : kind === 'texture'
        ? await this.localAssets.importTexture(file)
        : null;
    if (!state) throw new Error('不支持的导入类型。');
    this.dispatchEvent(new CustomEvent('assetimportchange', { detail: state }));
    return state;
  }

  removeLocalAsset() {
    const state = this.localAssets?.removeCurrent() ?? null;
    if (state) {
      this.dispatchEvent(new CustomEvent('assetimportchange', { detail: state }));
    }
    return state;
  }

  dispatchAssetTransformChange(state) {
    this.dispatchEvent(new CustomEvent('assettransformchange', { detail: state }));
    return state;
  }

  setLocalAssetTransform(values) {
    return this.dispatchAssetTransformChange(
      this.localAssets?.setTransform(values) ?? null,
    );
  }

  resetLocalAssetTransform() {
    return this.dispatchAssetTransformChange(
      this.localAssets?.resetTransform() ?? null,
    );
  }

  dispatchAssetAnimationChange(state) {
    this.dispatchEvent(new CustomEvent('assetanimationchange', { detail: state }));
    return state;
  }

  selectLocalAssetAnimation(index) {
    return this.dispatchAssetAnimationChange(
      this.localAssets?.selectAnimation(index) ?? null,
    );
  }

  setLocalAssetAnimationPlaying(playing) {
    return this.dispatchAssetAnimationChange(
      this.localAssets?.setAnimationPlaying(playing) ?? null,
    );
  }

  restartLocalAssetAnimation() {
    return this.dispatchAssetAnimationChange(
      this.localAssets?.restartAnimation() ?? null,
    );
  }

  setLocalAssetAnimationSpeed(speed) {
    return this.dispatchAssetAnimationChange(
      this.localAssets?.setAnimationSpeed(speed) ?? null,
    );
  }

  resetDiscovery() {
    this.discovery?.reset();
    if (this.npcs) { this.npcs.questAccepted = false; this.npcs.questClaimed = false; }
  }

  resetBilliards() {
    this.billiards?.reset();
    if (this.billiardsViewMode) this.focusBilliards('table');
  }

  performBilliardsAction(action) {
    if (action === 'place') return this.billiards?.beginCuePlacement();
    if (action === 'confirm') {
      const confirmed = this.billiards?.confirmCuePlacement();
      if (confirmed) this.setBilliardsMode('observe');
      return confirmed;
    }
    return this.billiards?.chooseBreak(action);
  }

  setBilliardsShotSettings(settings) {
    return this.billiards?.setShotSettings(settings) ?? false;
  }

  leaveBilliardsView() {
    this.billiardsViewMode = null;
    this.controls.minDistance = 8;
    this.billiards?.setCueView(false);
    this.dispatchEvent(new CustomEvent('billiardsviewchange', { detail: { mode: null } }));
  }

  setBilliardsAudio(settings) {
    const state = this.billiards.audio.setSettings(settings);
    if (state.enabled) void this.billiards.audio.unlock();
    this.dispatchEvent(new CustomEvent('billiardsaudiochange', { detail: state }));
    return state;
  }

  clearOrbitMomentum() {
    // Flush private damping deltas without allowing that update to move the view.
    const position = this.camera.position.clone(), target = this.controls.target.clone();
    const quaternion = this.camera.quaternion.clone(), damping = this.controls.enableDamping;
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.enableDamping = damping;
    this.camera.position.copy(position); this.controls.target.copy(target);
    this.camera.quaternion.copy(quaternion);
  }

  setBilliardsMode(mode) {
    if (!['shoot', 'observe'].includes(mode) || !this.billiards?.initialized) return false;
    if (mode === 'shoot') {
      if (this.billiards.shot || this.billiards.placingCue || this.billiards.rules.pending
        || this.billiards.completed || !this.billiards.areBallsSettled()) return false;
      if (this.billiardsViewMode === 'cue') return true;
      if (this.billiardsViewMode === 'observe') {
        const cue = this.billiards.balls[0].body.position;
        const dx = cue.x + this.billiards.group.position.x - this.camera.position.x;
        const dz = cue.z + this.billiards.group.position.z - this.camera.position.z;
        if (Math.hypot(dx, dz) > 0.001) this.billiards.viewYaw = Math.atan2(dz, dx);
      }
      this.focusBilliards('cue');
    } else {
      if (!this.billiardsViewMode) { this.focusBilliards('table'); return true; }
      if (this.cameraMode !== 'orbit') this.setCameraMode('orbit');
      this.cameraTween = null;
      this.billiardsViewMode = 'observe';
      this.controls.minDistance = 1;
      this.billiards.setCueView(false);
      this.billiards.setCameraState('orbit');
      this.clearOrbitMomentum();
      this.controls.enabled = this.entered && !document.querySelector('dialog[open]');
      this.dispatchEvent(new CustomEvent('billiardsviewchange', { detail: { mode: 'observe' } }));
    }
    return true;
  }

  focusBilliards(mode = 'table') {
    if (!this.camera || !this.controls || !this.billiards) return null;
    if (!this.billiards.initialized || !['cue', 'table'].includes(mode)) return null;
    if (this.cameraMode !== 'orbit') this.setCameraMode('orbit');
    if (this.billiards.placingCue || this.billiards.shot || this.billiards.rules.pending || this.billiards.completed) mode = 'table';
    void this.billiards.audio.unlock();

    const viewMode = window.innerWidth < 720 ? 'mobile' : 'desktop';
    const view = BILLIARDS_CAMERA_VIEWS[viewMode];
    const table = this.billiards.cameraCollider;
    this.billiardsViewTarget.set(
      table.x,
      this.billiards.groundY + view.targetHeight,
      table.z,
    );
    this.billiardsViewPosition
      .set(table.x, this.billiards.groundY, table.z)
      .add(view.positionOffset);
    if (mode === 'cue') {
      const pose = this.billiards.getCueViewPose();
      this.billiardsViewPosition.copy(pose.position);
      this.billiardsViewTarget.copy(pose.target);
    }
    this.startCameraTween(
      this.billiardsViewPosition,
      this.billiardsViewTarget,
      { billiardsView: mode },
    );

    const detail = {
      mode: this.cameraMode,
      viewMode,
      billiardsView: mode,
      position: this.billiardsViewPosition.toArray(),
      target: this.billiardsViewTarget.toArray(),
    };
    this.dispatchEvent(new CustomEvent('billiardsfocus', { detail }));
    return detail;
  }

  setShadows(enabled) {
    this.shadowsEnabled = enabled;
    if (!this.renderer || !this.environment) return;
    this.renderer.shadowMap.enabled = enabled && this.effectiveQuality === 'high';
    this.environment.setShadows(enabled && this.effectiveQuality === 'high');
    this.billiards?.setShadows(enabled && this.effectiveQuality === 'high');
    this.localAssets?.setShadows(enabled && this.effectiveQuality === 'high');
    this.coastalProps?.setShadows(enabled && this.effectiveQuality === 'high');
    this.npcs?.setShadows(enabled && this.effectiveQuality === 'high');
  }

  setQuality(mode) {
    if (!['auto', 'high', 'low'].includes(mode)) return this.effectiveQuality;
    this.qualityMode = mode;
    this.adaptedDown = false;
    this.fpsFrames = 0;
    this.fpsElapsed = 0;
    this.lastAdaptationReason = mode === 'auto' ? 'monitoring' : 'manual';
    const quality = mode === 'auto' ? this.detectAutoQuality() : mode;
    this.applyQuality(quality);
    return quality;
  }

  applyQuality(quality) {
    if (!this.renderer) return;

    if (this.world && quality !== this.effectiveQuality) {
      this.rebuildWorld(quality);
    }
    this.effectiveQuality = quality;
    const pixelRatioLimit = quality === 'high' ? 1.75 : 1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatioLimit));
    this.bloom?.setQuality(quality);
    this.renderer.shadowMap.enabled = this.shadowsEnabled && quality === 'high';
    this.environment?.setQuality(quality);
    this.environment?.setShadows(this.shadowsEnabled && quality === 'high');
    this.world?.setDetailEnabled(quality === 'high');
    this.billiards?.setQuality(quality);
    this.billiards?.setShadows(this.shadowsEnabled && quality === 'high');
    this.discovery?.setQuality(quality);
    const previousRainLines = this.rain?.lines;
    this.rain?.setQuality(quality);
    if (previousRainLines !== this.rain?.lines) {
      if (previousRainLines) {
        this.world?.unregisterReflectionExclusion(previousRainLines);
      }
      this.world?.registerReflectionExclusion(this.rain?.lines);
    }
    this.localAssets?.setShadows(this.shadowsEnabled && quality === 'high');
    this.coastalProps?.setShadows(this.shadowsEnabled && quality === 'high');
    this.npcs?.setShadows(this.shadowsEnabled && quality === 'high');
    this.handleResize();

    this.dispatchEvent(
      new CustomEvent('qualitychange', {
        detail: {
          mode: this.qualityMode,
          effective: this.effectiveQuality,
        },
      }),
    );
  }

  rebuildWorld(quality) {
    // Rebuild only land-side assets so a quality change can swap Standard and
    // Physical materials without reallocating Water's reflection render target.
    this.world.dispose();
    this.world = createBeachWorld(this.worldSlot, { quality });
    this.coastalProps?.bindWorld(this.world);
    this.npcs?.bindWorld(this.world);
    if (this.discovery) this.discovery.world = this.world;
    this.world.setFoamStrength(this.foamStrength);
    if (this.billiards?.initialized) {
      this.world.registerReflectionExclusion(this.billiards.group);
    }
    if (this.billiards) {
      this.world.registerCameraCollider(this.billiards.cameraCollider);
    }
    if (this.discovery?.initialized) {
      this.world.registerReflectionExclusion(this.discovery.group);
    }
    if (this.rain) {
      this.world.registerReflectionExclusion(this.rain.lines);
    }
    this.environment.world = this.world;
    this.environment.applyCurrentState();
    this.environment.applyTideState();
    // Water renders the scene through a second camera. Clearing cached render
    // lists prevents that mirror camera from retaining disposed world entries.
    this.renderer.renderLists.dispose();
    this.renderer.info.reset();
    this.worldRevision += 1;
  }

  detectAutoQuality() {
    // Conservative heuristics keep coarse-pointer and memory-limited devices
    // on the standard-material path before expensive shaders are constructed.
    const isCompact = window.innerWidth < 820;
    const hasCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
    const cores = navigator.hardwareConcurrency || 4;
    const memory = navigator.deviceMemory || 4;
    return isCompact || hasCoarsePointer || cores <= 4 || memory <= 4 ? 'low' : 'high';
  }

  getEffectiveQuality() {
    return this.effectiveQuality;
  }

  refreshDefaultCameraView() {
    const nextMode = window.innerWidth < 720 ? 'mobile' : 'desktop';
    if (nextMode === this.cameraViewMode) return false;

    this.cameraViewMode = nextMode;
    this.defaultCameraPosition.copy(CAMERA_VIEWS[nextMode].position);
    this.defaultCameraTarget.copy(CAMERA_VIEWS[nextMode].target);
    this.previewBasePosition.copy(this.defaultCameraPosition);
    return true;
  }

  focusStreet() {
    if (!this.camera || !this.controls) return;
    if (this.cameraMode !== 'orbit') this.setCameraMode('orbit');
    const mobile = this.camera.aspect < 1;
    this.startCameraTween(new THREE.Vector3(-6, mobile ? 9 : 11, mobile ? 42 : 25),
      new THREE.Vector3(-6, 4, 78));
  }

  resetCamera() {
    if (!this.camera || !this.controls) return;

    if (this.cameraMode !== 'orbit') this.setCameraMode('orbit');
    this.refreshDefaultCameraView();
    this.startCameraTween(
      this.defaultCameraPosition,
      this.defaultCameraTarget,
    );
  }

  startCameraTween(toPosition, toTarget, { billiardsView = null } = {}) {
    this.billiardsViewMode = billiardsView;
    this.controls.minDistance = billiardsView ? 1 : 8;
    this.clearOrbitMomentum();
    this.billiards?.setCueView(billiardsView === 'cue');
    this.dispatchEvent(new CustomEvent('billiardsviewchange', { detail: { mode: billiardsView } }));
    this.billiards?.setCameraState('transition');
    this.cameraTween = {
      elapsed: 0,
      duration: this.reducedMotion ? 0.01 : 1.15,
      fromPosition: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      toPosition: toPosition.clone(),
      toTarget: toTarget.clone(),
    };
    this.controls.enabled = false;
  }

  updateCameraTween(delta) {
    if (!this.cameraTween) return;

    this.cameraTween.elapsed += delta;
    const rawProgress = Math.min(
      1,
      this.cameraTween.elapsed / this.cameraTween.duration,
    );
    const progress =
      rawProgress < 0.5
        ? 4 * rawProgress * rawProgress * rawProgress
        : 1 - Math.pow(-2 * rawProgress + 2, 3) / 2;

    this.camera.position.lerpVectors(
      this.cameraTween.fromPosition,
      this.cameraTween.toPosition,
      progress,
    );
    this.controls.target.lerpVectors(
      this.cameraTween.fromTarget,
      this.cameraTween.toTarget,
      progress,
    );

    if (rawProgress >= 1) {
      this.cameraTween = null;
      this.billiards?.setCameraState(this.cameraMode);
      this.controls.enabled = this.entered && this.cameraMode === 'orbit'
        && this.billiardsViewMode !== 'cue' && !document.querySelector('dialog[open]');
      this.billiards?.dispatchProgress();
    }
  }

  renderScene(delta = 0) {
    this.world?.street.updateVisibility(this.camera);
    if (!this.bloom?.render(delta)) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  animate() {
    if (!this.isVisible || !this.environment) return;

    this.renderer.info.reset();
    const realDelta = this.clock.getDelta();
    const delta = Math.min(realDelta, 0.05);
    const elapsed = this.clock.elapsedTime;

    if (this.previewing && !this.reducedMotion) {
      const angle = Math.sin(elapsed * 0.08) * 0.035;
      this.previewOffset
        .copy(this.previewBasePosition)
        .sub(this.defaultCameraTarget)
        .applyAxisAngle(THREE.Object3D.DEFAULT_UP, angle);
      this.camera.position.copy(this.defaultCameraTarget).add(this.previewOffset);
    }

    this.updateCameraTween(delta);
    const wind = this.environment.update(delta, elapsed, realDelta);
    const dayClock = this.environment.dayClock.getState();
    const clockSignature = `${dayClock.label}-${dayClock.running}`;
    if (this.lastClockSignature !== clockSignature) {
      this.lastClockSignature = clockSignature;
      this.dispatchEvent(new CustomEvent('clockchange', { detail: dayClock }));
    }
    this.coastalProps?.updateTide(this.environment.water.position.y);
    this.dispatchTideChange();
    this.billiards?.update(delta);
    if (this.billiardsViewMode === 'cue') {
      this.controls.enabled = false;
      if (!this.cameraTween && !this.billiards.aiming && !this.billiards.shot && this.billiards.balls[0]?.active) {
        const pose = this.billiards.getCueViewPose();
        const blend = 1 - Math.exp(-delta * 16);
        this.camera.position.lerp(pose.position, blend);
        this.controls.target.lerp(pose.target, blend);
      }
    }
    this.discovery?.update(delta, elapsed, this.environment.current);
    this.npcs?.update(delta);
    this.rain?.setWindFactor(wind.factor);
    this.rain?.update(delta, this.environment.water.position.y);
    this.localAssets?.update(delta);
    if (this.cameraMode !== 'orbit') this.freeCamera.update(delta);
    else if (this.billiardsViewMode === 'cue' || this.cameraTween) this.camera.lookAt(this.controls.target);
    else this.controls.update();
    this.footstepAudio?.update({
      x: this.camera.position.x,
      z: this.camera.position.z,
      walking: this.cameraMode === 'walk',
      grounded: this.freeCamera?.isGrounded() ?? false,
      surface:
        this.world?.getWalkSurfaceType?.(
          this.camera.position.x,
          this.camera.position.z,
        ) ?? 'sand',
      speed: this.freeCamera?.getHorizontalSpeed() ?? 0,
    });
    this.gpuFrameTimer?.poll();
    this.gpuFrameTimer?.begin();
    try {
      this.renderScene(delta);
    } finally {
      this.gpuFrameTimer?.end();
    }
    this.measurePerformance(delta);
  }

  measurePerformance(delta) {
    // Auto mode samples a five-second window once and only downgrades. Avoiding
    // repeated up/down switching prevents visible resolution oscillation.
    if (!this.entered || this.qualityMode !== 'auto' || this.adaptedDown) return;

    this.fpsFrames += 1;
    this.fpsElapsed += delta;
    if (this.fpsElapsed < 5) return;

    this.lastMeasuredFps = this.fpsFrames / this.fpsElapsed;
    this.fpsFrames = 0;
    this.fpsElapsed = 0;

    const gpuTiming = this.gpuFrameTimer?.getDebugState();
    const gpuOverBudget = Boolean(
      gpuTiming?.supported &&
        gpuTiming.samples >= GPU_AUTO_QUALITY_MIN_SAMPLES &&
        gpuTiming.smoothedMs > GPU_AUTO_QUALITY_BUDGET_MS,
    );
    const fpsUnderBudget = this.lastMeasuredFps < 42;

    if (this.effectiveQuality === 'high' && (fpsUnderBudget || gpuOverBudget)) {
      this.adaptedDown = true;
      this.lastAdaptationReason =
        fpsUnderBudget && gpuOverBudget
          ? 'fps-and-gpu'
          : gpuOverBudget
            ? 'gpu'
            : 'fps';
      this.applyQuality('low');
    } else {
      this.lastAdaptationReason = 'within-budget';
    }
  }

  handleResize() {
    if (!this.renderer || !this.camera) return;
    const width = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const height = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    const cameraViewChanged = this.refreshDefaultCameraView();
    if (cameraViewChanged && !this.entered) {
      this.camera.position.copy(this.defaultCameraPosition);
      this.controls?.target.copy(this.defaultCameraTarget);
      this.controls?.update();
    }
    this.camera.fov = width < 720 ? 54 : 47;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.bloom?.setSize(width, height, this.renderer.getPixelRatio());
  }

  handleVisibilityChange() {
    this.isVisible = !document.hidden;
    this.billiards?.audio.setHidden(!this.isVisible);
    if (this.isVisible) {
      this.clock.start();
      this.renderer.setAnimationLoop(this.animate);
    } else {
      this.billiards?.cancelAim();
      if (this.cameraMode !== 'orbit') this.setCameraMode('orbit');
      this.renderer.setAnimationLoop(null);
    }
  }

  handleContextLost(event) {
    event.preventDefault();
    this.billiards?.cancelAim();
    this.gpuFrameTimer?.handleContextLost();
    this.renderer.setAnimationLoop(null);
  }

  handleContextRestored() {
    if (this.disposed) return;
    this.gpuFrameTimer?.handleContextRestored();
    this.clock.start();
    this.renderer.setAnimationLoop(this.animate);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer?.setAnimationLoop(null);
    window.removeEventListener('resize', this.handleResize);
    document.removeEventListener(
      'visibilitychange',
      this.handleVisibilityChange,
    );
    this.canvas.removeEventListener(
      'webglcontextlost',
      this.handleContextLost,
    );
    this.canvas.removeEventListener(
      'webglcontextrestored',
      this.handleContextRestored,
    );
    this.freeCamera?.removeEventListener(
      'statechange',
      this.handleFreeCameraStateChange,
    );
    this.freeCamera?.removeEventListener(
      'exitrequest',
      this.handleFreeCameraExitRequest,
    );
    this.freeCamera?.removeEventListener(
      'activationerror',
      this.handleFreeCameraActivationError,
    );
    this.freeCamera?.dispose();
    this.controls?.dispose();
    if (this.discovery && this.discoveryEventHandlers) {
      this.discovery.removeEventListener(
        'progresschange',
        this.discoveryEventHandlers.progress,
      );
      this.discovery.removeEventListener(
        'focuschange',
        this.discoveryEventHandlers.focus,
      );
      this.discovery.removeEventListener(
        'discover',
        this.discoveryEventHandlers.found,
      );
      this.discovery.removeEventListener(
        'complete',
        this.discoveryEventHandlers.complete,
      );
      this.discovery.removeEventListener(
        'reset',
        this.discoveryEventHandlers.reset,
      );
    }
    if (this.billiards && this.billiardsEventHandlers) {
      this.billiards.removeEventListener(
        'progresschange',
        this.billiardsEventHandlers.progress,
      );
      this.billiards.removeEventListener(
        'shot',
        this.billiardsEventHandlers.shot,
      );
      this.billiards.removeEventListener(
        'pocket',
        this.billiardsEventHandlers.pocket,
      );
      this.billiards.removeEventListener(
        'complete',
        this.billiardsEventHandlers.complete,
      );
      this.billiards.removeEventListener(
        'reset',
        this.billiardsEventHandlers.reset,
      );
      this.billiards.removeEventListener(
        'aimchange',
        this.billiardsEventHandlers.aim,
      );
    }
    this.world?.unregisterCameraCollider(this.billiards?.cameraCollider);
    this.discovery?.dispose();
    this.billiards?.dispose();
    this.rain?.dispose();
    this.footstepAudio?.dispose();
    this.localAssets?.dispose();
    this.coastalProps?.dispose();
    this.npcs?.dispose();
    this.bloom?.dispose();
    this.world?.dispose();
    this.worldSlot?.removeFromParent();
    this.environment?.dispose();
    this.gpuFrameTimer?.dispose();
    this.renderer?.dispose();
  }

  getDebugState() {
    const renderInfo = this.renderer?.info.render;
    const gpuTiming = this.gpuFrameTimer?.getDebugState() ?? {
      supported: false,
      unavailableReason: 'not-initialized',
      samples: 0,
      latestMs: null,
      smoothedMs: null,
      pendingQueries: 0,
      maxPendingQueries: 4,
      disjointEvents: 0,
      droppedQueries: 0,
      skippedFrames: 0,
      contextRestores: 0,
    };
    return {
      initialized: this.initialized,
      entered: this.entered,
      period: this.environment?.currentPreset ?? null,
      weather: this.environment?.getWeatherState() ?? null,
      tide: this.environment?.getTideState() ?? null,
      wind: this.environment?.getWindState() ?? null,
      lantern: this.world?.getLanternState() ?? null,
      cloudQuality: this.environment?.getCloudQualityState() ?? null,
      dayClock: this.environment?.dayClock.getState() ?? null,
      starQuality: this.environment?.getStarQualityState() ?? null,
      celestialResources:
        this.environment?.getCelestialResourceState() ?? null,
      waterNormal: this.environment?.getWaterNormalQualityState() ?? null,
      moonQuality: this.environment?.getMoonQualityState() ?? null,
      waterReflection:
        this.environment?.getWaterReflectionQualityState() ?? null,
      qualityMode: this.qualityMode,
      effectiveQuality: this.effectiveQuality,
      worldRevision: this.worldRevision,
      coastalProps: this.coastalProps?.getState() ?? null,
      cameraColliderCount: this.world?.cameraColliderCount ?? 0,
      cameraBookmarks: this.cameraBookmarks.getDebugState(),
      characters: null,
      npcs: this.npcs?.getState() ?? null,
      billiards: this.billiards?.getDebugState() ?? null,
      discovery: this.discovery?.getDebugState() ?? null,
      rain: this.rain?.getDebugState() ?? {
        enabled: this.rainEnabled,
        visible: false,
        drops: 0,
        drawObjects: 0,
      },
      bloom: this.bloom?.getDebugState() ?? {
        enabled: this.bloomEnabled,
        initialized: false,
        loading: false,
      },
      footstepAudio: this.footstepAudio?.getDebugState() ?? {
        enabled: this.footstepAudioEnabled,
        initialized: false,
        contextState: 'not-created',
        steps: 0,
        sandSteps: 0,
        woodSteps: 0,
      },
      localAsset: this.localAssets?.getDebugState() ?? null,
      fps: Number(this.lastMeasuredFps.toFixed(1)),
      gpuTiming: {
        ...gpuTiming,
        budgetMs: GPU_AUTO_QUALITY_BUDGET_MS,
        minimumSamples: GPU_AUTO_QUALITY_MIN_SAMPLES,
        overBudget: Boolean(
          gpuTiming.supported &&
            gpuTiming.samples >= GPU_AUTO_QUALITY_MIN_SAMPLES &&
            gpuTiming.smoothedMs > GPU_AUTO_QUALITY_BUDGET_MS,
        ),
        autoQualityReason: this.lastAdaptationReason,
      },
      camera: {
        mode: this.cameraMode,
        supported: this.supportsFreeCamera(),
        position: this.camera?.position
          .toArray()
          .map((value) => Number(value.toFixed(3))) ?? [0, 0, 0],
        target: this.controls?.target
          .toArray()
          .map((value) => Number(value.toFixed(3))) ?? [0, 0, 0],
        free: this.freeCamera?.getDebugState() ?? null,
      },
      canvas: {
        width: this.renderer?.domElement.width ?? 0,
        height: this.renderer?.domElement.height ?? 0,
      },
      render: {
        calls: renderInfo?.calls ?? 0,
        triangles: renderInfo?.triangles ?? 0,
        points: renderInfo?.points ?? 0,
      },
      waterTime: Number(
        (this.environment?.water.material.uniforms.time.value ?? 0).toFixed(3),
      ),
      foam: this.world?.getFoamState() ?? null,
      oceanSwell: this.environment?.getOceanSwellState() ?? null,
      water: {
        refraction: this.environment?.oceanRefraction?.getState() ?? null,
        layeredModel: Boolean(
          this.environment?.water.material.fragmentShader.includes(
            'deepAbsorption',
          ),
        ),
        reflectionStrength: Number(
          (
            this.environment?.water.material.uniforms.uReflectionStrength
              ?.value ?? 0
          ).toFixed(3),
        ),
        sunGlintStrength: Number(
          (
            this.environment?.water.material.uniforms.uSunGlintStrength
              ?.value ?? 0
          ).toFixed(3),
        ),
        horizonColor: `#${
          this.environment?.water.material.uniforms.uHorizonWaterColor?.value
            ?.getHexString?.() ?? '000000'
        }`,
        deepColor: `#${
          this.environment?.water.material.uniforms.uDeepWaterColor?.value
            ?.getHexString?.() ?? '000000'
        }`,
        normalAnisotropy: this.environment?.waterNormals.anisotropy ?? 1,
      },
      materialPipeline: {
        sandPhysical: Boolean(this.world?.sandMaterial.isMeshPhysicalMaterial),
        sandShaderCompiled: Boolean(this.world?.sandMaterial.userData.shader),
        rockShaderCompiled: Boolean(
          this.world?.materials.rock.some(
            (material) => material.userData.shader,
          ),
        ),
        rockShaderVariantsCompiled:
          this.world?.materials.rock.filter(
            (material) => material.userData.shader,
          ).length ?? 0,
        rockBatches: this.world?.rockClusters.length ?? 0,
        rockInstances:
          this.world?.rockClusters.reduce(
            (total, cluster) => total + cluster.count,
            0,
          ) ?? 0,
        frondBatches: this.world?.palmFronds.mesh.isInstancedMesh ? 1 : 0,
        frondInstances: this.world?.palmFronds.count ?? 0,
        trunkBatches: this.world?.palmTrunks.isInstancedMesh ? 1 : 0,
        trunkInstances: this.world?.palmTrunks.count ?? 0,
        coconutBatches: this.world?.palmCoconuts.isInstancedMesh ? 1 : 0,
        coconutInstances: this.world?.palmCoconuts.count ?? 0,
        grassShaderCompiled: Boolean(
          this.world?.materials.grass.userData.shader,
        ),
        grassInstances: this.world?.details.grass.count ?? 0,
        boardwalkPlanks: this.world?.boardwalk.planks.count ?? 0,
        boardwalkPosts: this.world?.boardwalk.posts.count ?? 0,
        shadeShelter: Boolean(this.world?.shadeShelter?.canopy),
        shadePosts: this.world?.shadeShelter?.postCount ?? 0,
        footprintInstances: this.world?.footprints?.count ?? 0,
        tidePools: Boolean(this.world?.tidePools),
        reflectionExclusions: this.world?.reflectionExclusionCount ?? 0,
        woodShadersCompiled: Boolean(
          [
            this.world?.materials.trunk,
            this.world?.materials.boatHull,
            this.world?.materials.boatTrim,
            this.world?.materials.driftwood,
            this.world?.materials.boardwalk,
            this.world?.materials.boardwalkDark,
          ].every((material) => material?.userData.shader),
        ),
        shallowWaterShader: Boolean(
          this.environment?.water.material.fragmentShader.includes(
            'sceneDistance',
          ),
        ),
        layeredWaterShader: Boolean(
          this.environment?.water.material.fragmentShader.includes(
            'deepAbsorption',
          ),
        ),
        beachWidth: this.world?.beach.geometry.parameters.width ?? 0,
        foamWidth: this.world?.foam.geometry.parameters.width ?? 0,
        contactOcclusion: Boolean(this.world?.contactShadows),
        moonTexture: Boolean(this.environment?.moon.material.map),
        cloudShader: Boolean(
          this.environment?.clouds.material.fragmentShader.includes(
            'projectedUv',
          ),
        ),
      },
      lighting: {
        exposure: Number(
          (this.renderer?.toneMappingExposure ?? 0).toFixed(3),
        ),
        sunIntensity: Number(
          (this.environment?.sunLight.intensity ?? 0).toFixed(3),
        ),
        sunColor: `#${
          this.environment?.sunLight.color.getHexString?.() ?? '000000'
        }`,
        fogColor: `#${
          this.scene?.fog?.color.getHexString?.() ?? '000000'
        }`,
        moonOpacity: Number(
          (this.environment?.moon.material.opacity ?? 0).toFixed(3),
        ),
        starsVisible: Boolean(this.environment?.stars.visible),
        moonVisible: Boolean(this.environment?.moon.visible),
        moonHaloVisible: Boolean(this.environment?.moonHalo.visible),
        lanternIntensity: Number(
          (this.world?.lantern.intensity ?? 0).toFixed(3),
        ),
        lanternVisible: Boolean(this.world?.lantern.visible),
        lanternGlowVisible: Boolean(this.world?.lanternGlow.visible),
        lanternHaloVisible: Boolean(this.world?.lanternHalo.visible),
      },
    };
  }
}

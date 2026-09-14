import { Vector2 } from 'three';

const PROFILE_VALUES = {
  high: { strength: 0.32, radius: 0.22, threshold: 0.84 },
  low: { strength: 0.22, radius: 0.16, threshold: 0.9 },
};

export const BLOOM_PROFILES = Object.freeze({
  high: Object.freeze({ ...PROFILE_VALUES.high }),
  low: Object.freeze({ ...PROFILE_VALUES.low }),
});

export function getBloomProfile(quality) {
  return BLOOM_PROFILES[quality === 'high' ? 'high' : 'low'];
}

async function loadBloomModules() {
  const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] =
    await Promise.all([
      import('three/addons/postprocessing/EffectComposer.js'),
      import('three/addons/postprocessing/RenderPass.js'),
      import('three/addons/postprocessing/UnrealBloomPass.js'),
      import('three/addons/postprocessing/OutputPass.js'),
    ]);
  return { EffectComposer, RenderPass, UnrealBloomPass, OutputPass };
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/** Lazily owns the optional post-processing chain and all of its GPU targets. */
export class BloomPostProcessor {
  constructor({ renderer, scene, camera, quality = 'high', moduleLoader = loadBloomModules }) {
    if (!renderer || !scene || !camera) {
      throw new Error('BloomPostProcessor requires renderer, scene, and camera.');
    }
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.quality = quality === 'high' ? 'high' : 'low';
    this.moduleLoader = moduleLoader;
    this.enabled = false;
    this.requestedEnabled = false;
    this.loading = false;
    this.disposed = false;
    this.lastError = null;
    this.width = 1;
    this.height = 1;
    this.pixelRatio = Math.max(0.5, Number(renderer.getPixelRatio?.()) || 1);
    this.composer = null;
    this.renderPass = null;
    this.bloomPass = null;
    this.outputPass = null;
    this.initialization = null;
  }

  async setEnabled(enabled) {
    if (this.disposed) return this.getDebugState();
    this.requestedEnabled = Boolean(enabled);
    if (!this.requestedEnabled) {
      this.enabled = false;
      return this.getDebugState();
    }

    try {
      await this.ensureInitialized();
      this.enabled = this.requestedEnabled && !this.disposed && Boolean(this.composer);
      this.lastError = null;
    } catch (error) {
      this.requestedEnabled = false;
      this.enabled = false;
      this.lastError = errorMessage(error);
    }
    return this.getDebugState();
  }

  async ensureInitialized() {
    if (this.composer || this.disposed) return;
    if (!this.initialization) {
      this.loading = true;
      this.initialization = this.moduleLoader()
        .then((modules) => {
          if (!this.disposed) this.initializeComposer(modules);
        })
        .finally(() => {
          this.loading = false;
          this.initialization = null;
        });
    }
    await this.initialization;
  }

  initializeComposer({ EffectComposer, RenderPass, UnrealBloomPass, OutputPass }) {
    const profile = getBloomProfile(this.quality);
    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.bloomPass = new UnrealBloomPass(
      new Vector2(this.width, this.height),
      profile.strength,
      profile.radius,
      profile.threshold,
    );
    this.outputPass = new OutputPass();
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.outputPass);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(this.width, this.height);
  }

  setQuality(quality) {
    this.quality = quality === 'high' ? 'high' : 'low';
    const profile = getBloomProfile(this.quality);
    if (this.bloomPass) {
      this.bloomPass.strength = profile.strength;
      this.bloomPass.radius = profile.radius;
      this.bloomPass.threshold = profile.threshold;
    }
    return this.getDebugState();
  }

  setSize(width, height, pixelRatio = this.renderer.getPixelRatio?.()) {
    this.width = Math.max(1, Math.round(Number(width) || 1));
    this.height = Math.max(1, Math.round(Number(height) || 1));
    this.pixelRatio = Math.max(0.5, Number(pixelRatio) || 1);
    if (this.composer) {
      this.composer.setPixelRatio(this.pixelRatio);
      this.composer.setSize(this.width, this.height);
    }
    return this.getDebugState();
  }

  render(delta) {
    if (!this.enabled || !this.composer) return false;
    this.composer.render(delta);
    return true;
  }

  getDebugState() {
    const profile = getBloomProfile(this.quality);
    return {
      enabled: this.enabled,
      requested: this.requestedEnabled,
      initialized: Boolean(this.composer),
      loading: this.loading,
      quality: this.quality,
      passes: this.composer?.passes?.length ?? 0,
      strength: this.bloomPass?.strength ?? profile.strength,
      radius: this.bloomPass?.radius ?? profile.radius,
      threshold: this.bloomPass?.threshold ?? profile.threshold,
      width: this.width,
      height: this.height,
      pixelRatio: Number(this.pixelRatio.toFixed(3)),
      lazyLoaded: Boolean(this.composer),
      lastError: this.lastError,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.enabled = false;
    this.requestedEnabled = false;
    this.renderPass?.dispose?.();
    this.bloomPass?.dispose?.();
    this.outputPass?.dispose?.();
    this.composer?.dispose?.();
    this.renderPass = null;
    this.bloomPass = null;
    this.outputPass = null;
    this.composer = null;
  }
}

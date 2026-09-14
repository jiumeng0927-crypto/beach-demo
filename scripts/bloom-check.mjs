import assert from 'node:assert/strict';

import {
  BLOOM_PROFILES,
  BloomPostProcessor,
  getBloomProfile,
} from '../src/experience/BloomPostProcessor.js';

class FakeComposer {
  constructor() {
    this.passes = [];
    this.renderCount = 0;
    this.disposed = false;
  }

  addPass(pass) {
    this.passes.push(pass);
  }

  setPixelRatio(value) {
    this.pixelRatio = value;
  }

  setSize(width, height) {
    this.width = width;
    this.height = height;
  }

  render(delta) {
    this.renderCount += 1;
    this.lastDelta = delta;
  }

  dispose() {
    this.disposed = true;
  }
}

class FakePass {
  dispose() {
    this.disposed = true;
  }
}

class FakeRenderPass extends FakePass {}
class FakeOutputPass extends FakePass {}
class FakeBloomPass extends FakePass {
  constructor(resolution, strength, radius, threshold) {
    super();
    this.resolution = resolution;
    this.strength = strength;
    this.radius = radius;
    this.threshold = threshold;
  }
}

const fakeModules = {
  EffectComposer: FakeComposer,
  RenderPass: FakeRenderPass,
  UnrealBloomPass: FakeBloomPass,
  OutputPass: FakeOutputPass,
};
const renderer = { getPixelRatio: () => 1.5 };
let moduleLoads = 0;
const bloom = new BloomPostProcessor({
  renderer,
  scene: {},
  camera: {},
  quality: 'high',
  moduleLoader: async () => {
    moduleLoads += 1;
    return fakeModules;
  },
});

assert.deepEqual(getBloomProfile('high'), BLOOM_PROFILES.high);
assert.deepEqual(getBloomProfile('low'), BLOOM_PROFILES.low);
assert.equal(bloom.getDebugState().initialized, false);
assert.equal(bloom.getDebugState().enabled, false);
assert.equal(moduleLoads, 0, 'default-off bloom must not load post-processing modules');

bloom.setSize(1440, 900, 1.5);
const enabled = await bloom.setEnabled(true);
assert.equal(moduleLoads, 1);
assert.equal(enabled.enabled, true);
assert.equal(enabled.initialized, true);
assert.equal(enabled.passes, 3);
assert.equal(enabled.strength, BLOOM_PROFILES.high.strength);
assert.equal(bloom.composer.pixelRatio, 1.5);
assert.equal(bloom.composer.width, 1440);
assert.equal(bloom.render(0.016), true);
assert.equal(bloom.composer.renderCount, 1);

const low = bloom.setQuality('low');
assert.equal(low.quality, 'low');
assert.equal(low.strength, BLOOM_PROFILES.low.strength);
assert.equal(low.radius, BLOOM_PROFILES.low.radius);
assert.equal(low.threshold, BLOOM_PROFILES.low.threshold);

const disabled = await bloom.setEnabled(false);
assert.equal(disabled.enabled, false);
assert.equal(disabled.initialized, true, 'disabling retains reusable GPU resources');
assert.equal(bloom.render(0.016), false);
assert.equal(moduleLoads, 1, 're-enabling must reuse the initialized chain');

const composer = bloom.composer;
const bloomPass = bloom.bloomPass;
bloom.dispose();
assert.equal(composer.disposed, true);
assert.equal(bloomPass.disposed, true);
assert.equal(bloom.getDebugState().initialized, false);

const failedBloom = new BloomPostProcessor({
  renderer,
  scene: {},
  camera: {},
  moduleLoader: async () => {
    throw new Error('synthetic module failure');
  },
});
const failed = await failedBloom.setEnabled(true);
assert.equal(failed.enabled, false);
assert.equal(failed.initialized, false);
assert.equal(failed.lastError, 'synthetic module failure');

console.log('Bloom lazy-loading, quality, render, failure, and disposal checks passed.');

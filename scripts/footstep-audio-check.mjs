import assert from 'node:assert/strict';

import { FootstepAudio } from '../src/experience/FootstepAudio.js';

class FakeParam {
  constructor(value = 0) {
    this.value = value;
  }

  setValueAtTime(value) {
    this.value = value;
  }

  exponentialRampToValueAtTime(value) {
    this.value = value;
  }
}

class FakeNode {
  constructor() {
    this.connections = [];
  }

  connect(target) {
    this.connections.push(target);
    return target;
  }

  disconnect() {
    this.connections.length = 0;
  }
}

class FakeAudioContext {
  constructor() {
    this.state = 'suspended';
    this.currentTime = 3;
    this.sampleRate = 48000;
    this.destination = new FakeNode();
    this.bufferSources = 0;
    this.oscillators = 0;
    this.resumeCalls = 0;
    this.closeCalls = 0;
  }

  createGain() {
    const node = new FakeNode();
    node.gain = new FakeParam(1);
    return node;
  }

  createBuffer(channels, length, sampleRate) {
    assert.equal(channels, 1);
    assert.equal(sampleRate, this.sampleRate);
    const samples = new Float32Array(length);
    return { getChannelData: () => samples };
  }

  createBufferSource() {
    this.bufferSources += 1;
    const node = new FakeNode();
    node.playbackRate = new FakeParam(1);
    node.start = () => {};
    node.stop = () => {};
    return node;
  }

  createBiquadFilter() {
    const node = new FakeNode();
    node.frequency = new FakeParam(350);
    node.Q = new FakeParam(1);
    return node;
  }

  createOscillator() {
    this.oscillators += 1;
    const node = new FakeNode();
    node.frequency = new FakeParam(440);
    node.start = () => {};
    node.stop = () => {};
    return node;
  }

  async resume() {
    this.resumeCalls += 1;
    this.state = 'running';
  }

  async close() {
    this.closeCalls += 1;
    this.state = 'closed';
  }
}

let createdContexts = 0;
let context = null;
const footsteps = new FootstepAudio({
  contextFactory: () => {
    createdContexts += 1;
    context = new FakeAudioContext();
    return context;
  },
});

assert.deepEqual(
  footsteps.getDebugState(),
  {
    enabled: false,
    initialized: false,
    contextState: 'not-created',
    steps: 0,
    sandSteps: 0,
    woodSteps: 0,
    skippedSteps: 0,
    resumeFailures: 0,
    lastSurface: null,
    stride: 1.05,
    pendingDistance: 0,
    lastError: null,
  },
);
footsteps.update({ x: 0, z: 0, walking: true, grounded: true, speed: 4.2 });
footsteps.update({ x: 2, z: 0, walking: true, grounded: true, speed: 4.2 });
assert.equal(createdContexts, 0);

let state = await footsteps.setEnabled(true);
assert.equal(state.enabled, true);
assert.equal(state.initialized, true);
assert.equal(state.contextState, 'running');
assert.equal(createdContexts, 1);
assert.equal(context.resumeCalls, 1);

footsteps.update({ x: 0, z: 0, walking: true, grounded: true, surface: 'sand', speed: 4.2 });
assert.equal(
  footsteps.update({ x: 0.6, z: 0, walking: true, grounded: true, surface: 'sand', speed: 4.2 }),
  false,
);
assert.equal(
  footsteps.update({ x: 1.1, z: 0, walking: true, grounded: true, surface: 'sand', speed: 4.2 }),
  true,
);
state = footsteps.getDebugState();
assert.equal(state.steps, 1);
assert.equal(state.sandSteps, 1);
assert.equal(state.lastSurface, 'sand');
assert.equal(context.bufferSources, 1);
assert.equal(context.oscillators, 0);

await footsteps.setEnabled(false);
await footsteps.setEnabled(true);
assert.equal(createdContexts, 1);
footsteps.update({ x: 30, z: 30, walking: true, grounded: true, surface: 'wood', speed: 4.2 });
assert.equal(
  footsteps.update({ x: 31.1, z: 30, walking: true, grounded: true, surface: 'wood', speed: 4.2 }),
  true,
);
state = footsteps.getDebugState();
assert.equal(state.steps, 2);
assert.equal(state.woodSteps, 1);
assert.equal(state.lastSurface, 'wood');
assert.equal(context.bufferSources, 2);
assert.equal(context.oscillators, 1);

footsteps.update({ x: 40, z: 40, walking: true, grounded: true, surface: 'sand', speed: 7 });
assert.equal(footsteps.getDebugState().steps, 2);
assert.equal(footsteps.getDebugState().pendingDistance, 0);
footsteps.update({ x: 40.8, z: 40, walking: true, grounded: false, surface: 'sand', speed: 7 });
assert.equal(footsteps.getDebugState().steps, 2);

state = await footsteps.setEnabled(false);
assert.equal(state.enabled, false);
footsteps.update({ x: 0, z: 0, walking: true, grounded: true, surface: 'sand', speed: 4.2 });
footsteps.update({ x: 2, z: 0, walking: true, grounded: true, surface: 'sand', speed: 4.2 });
assert.equal(footsteps.getDebugState().steps, 2);

await footsteps.dispose();
assert.equal(context.closeCalls, 1);
assert.equal(context.state, 'closed');

console.log('Footstep audio lifecycle and surface checks passed.');

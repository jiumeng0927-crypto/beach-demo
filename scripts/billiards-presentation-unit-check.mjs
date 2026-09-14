import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BilliardsAudio, createImpactSamples, IMPACT_PROFILES } from '../src/experience/BilliardsAudio.js';
import { BeachBilliardsGame } from '../src/experience/BeachBilliardsGame.js';
import { RAILS, TABLE } from '../src/experience/billiardsTable.js';

const sounds = new Map();
let seed = 1709;
const recording = Float32Array.from({ length: 12000 }, (_, i) => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return (seed / 0x80000000 - 1) * Math.exp(-i / 1800);
});
for (const type of Object.keys(IMPACT_PROFILES)) {
  const samples = createImpactSamples(type, 48000, recording);
  assert.deepEqual(samples, createImpactSamples(type, 48000, recording));
  assert.ok(samples.every(Number.isFinite));
  const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample ** 2, 0) / samples.length);
  assert.ok(rms > 0.015 && rms < 0.3);
  assert.ok(samples.every(sample => Math.abs(sample) < 1));
  assert.equal(Math.abs(samples[0]), 0);
  assert.ok(Math.abs(samples.at(-1)) < 0.001);
  sounds.set(type, { rms, length: samples.length });
}
assert.equal(new Set([...sounds.values()].map(sound => sound.length)).size, 4);
assert.equal(createImpactSamples('unknown').length, 0);
assert.equal(createImpactSamples('cue', NaN).length, 0);
assert.equal(createImpactSamples('cue', 48000, new Float32Array(100)).length, 0);

class Node {
  threshold = {}; knee = {}; ratio = {}; attack = {}; release = {};
  gain = { value: 0, setValueAtTime(value) { this.value = value; } };
  pan = { value: 0 }; playbackRate = { value: 1 };
  connect() {} disconnect() { this.disconnected = true; }
  start() { this.started = true; } stop() { this.stopped = true; }
}
let created = 0, closed = 0;
const fake = { state: 'suspended', sampleRate: 48000, currentTime: 0, destination: {},
  createGain: () => new Node(), createStereoPanner: () => new Node(), createBufferSource: () => new Node(),
  createDynamicsCompressor: () => new Node(),
  decodeAudioData: async () => ({ getChannelData: () => recording }),
  createBuffer: (_, length) => { const samples = new Float32Array(length); return { getChannelData: () => samples }; },
  async resume() { this.state = 'running'; }, async close() { closed++; this.state = 'closed'; } };
let fetched = 0;
const fetchAudio = async () => { fetched++; return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; };
const audio = new BilliardsAudio({ contextFactory: () => { created++; return fake; }, fetchAudio });
assert.equal(created, 0); assert.equal(audio.play('cue'), false);
await audio.unlock(); await audio.unlock(); assert.equal(created, 1);
assert.equal(fetched, 1, 'Cache recording across repeated gestures');
assert.equal(audio.buffers.size, 4);
for (let i = 0; i < 12; i++) assert.equal(audio.play('ball', { speed: 3, pan: 10 }), true);
assert.equal(audio.play('ball'), false, 'Limit simultaneous break impacts');
const retired = [...audio.voices]; audio.setSettings({ enabled: false });
assert.equal(audio.voices.size, 0); assert.ok(retired.every(({ source, gain, panner }) => source.stopped && source.disconnected && gain.disconnected && panner.disconnected));
assert.equal(audio.play('cue'), false);
audio.setSettings({ enabled: true, volume: 0 }); assert.equal(audio.play('cue'), false);
audio.setSettings({ volume: 1 }); audio.setHidden(true); assert.equal(audio.play('cue'), false);
audio.setHidden(false); assert.equal(audio.play('pocket'), true);
const voice = [...audio.voices][0]; voice.source.onended(); assert.equal(audio.voices.size, 0);
await audio.dispose(); await audio.dispose(); assert.equal(closed, 1);
assert.equal(await audio.unlock(), false);
const unavailable = new BilliardsAudio({ contextFactory: () => { throw new Error('device'); } });
assert.equal(await unavailable.unlock(), false); await unavailable.dispose();
const failed = new BilliardsAudio({ contextFactory: () => ({ ...fake, state: 'running' }),
  fetchAudio: async () => ({ ok: false, status: 404 }) });
assert.equal(await failed.unlock(), false); assert.equal(failed.buffers.size, 0);
assert.equal(failed.play('cue'), false, 'Failed assets do not produce synthesized fallback tones');
failed.fetchAudio = fetchAudio;
assert.equal(await failed.unlock(), true, 'A later gesture can retry a failed load');
await failed.dispose();
let finishDecode;
const late = new BilliardsAudio({ contextFactory: () => ({ ...fake, state: 'running',
  decodeAudioData: () => new Promise(resolve => { finishDecode = resolve; }) }), fetchAudio });
const pending = late.unlock();
while (!finishDecode) await new Promise(resolve => setTimeout(resolve, 0));
await late.dispose(); finishDecode({ getChannelData: () => recording });
assert.equal(await pending, false); assert.equal(late.buffers.size, 0, 'Disposed audio cannot receive late buffers');

class Canvas extends EventTarget { classList = { toggle() {}, remove() {} }; }
const camera = new THREE.PerspectiveCamera(47, 1.6, 0.1, 1800);
const game = new BeachBilliardsGame({ scene: new THREE.Scene(), camera, domElement: new Canvas() });
await game.setEnabled(true); game.rules.hand = null;
game.setCueView(true);
for (const [x, z] of [[0, 0], [-3.05, 1.4], [2.95, -1.4]]) {
  game.balls[0].body.position.set(x, 0, z);
  for (let i = 0; i < 24; i++) {
    game.viewYaw = i * Math.PI / 12;
    const pose = game.getCueViewPose();
    assert.ok(Math.abs(pose.target.x - game.group.position.x - x) < 1e-10);
    assert.ok(Math.abs(pose.target.z - game.group.position.z - z) < 1e-10);
    assert.ok(Math.abs(pose.position.y - pose.target.y - 0.48) < 1e-10);
    game.updateCueModel(); assert.ok(Number.isFinite(game.cueModel.rotation.x));
  }
}
// New sloped cushions preserve the original physical nose at ball-center height.
game.group.updateMatrixWorld(true);
const ray = new THREE.Raycaster();
for (const rail of RAILS) {
  const long = rail.size[0] > rail.size[1];
  const direction = long ? new THREE.Vector3(0, 0, Math.sign(rail.center[1])) : new THREE.Vector3(Math.sign(rail.center[0]), 0, 0);
  const start = new THREE.Vector3(long ? rail.center[0] : 0, TABLE.top + TABLE.ballRadius, long ? 0 : rail.center[1]);
  ray.set(start.add(game.group.position), direction);
  const hit = ray.intersectObject(game.bed)[0];
  assert.ok(hit, 'Cushion front face must render with outward winding');
  assert.ok(Math.abs(hit.distance - (long ? TABLE.halfDepth : TABLE.halfWidth)) < 1e-5);
}
const impacts = [];
game.audio.play = (type, options) => { impacts.push({ type, ...options }); return true; };
game.reset(); game.setCueView(true); game.shoot(1, 0, 1);
for (let i = 0; i < 3000 && game.shot; i++) game.update(1 / 120);
assert.ok(impacts.some(impact => impact.type === 'cue'));
assert.ok(impacts.some(impact => impact.type === 'ball'));
assert.ok(impacts.some(impact => impact.type === 'rail'));
assert.ok(impacts.length < 200, 'Persistent contact cannot retrigger every physics step');
game.reset();
const pocketCount = impacts.filter(impact => impact.type === 'pocket').length;
game.pocketBall(game.balls[1]); game.pocketBall(game.balls[1]);
assert.equal(impacts.filter(impact => impact.type === 'pocket').length, pocketCount + 1);
game.dispose();
console.log(JSON.stringify({ ok: true, sounds: Object.fromEntries(sounds), impacts: impacts.length }));

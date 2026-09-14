import assert from 'node:assert/strict';

import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';

import {
  DEFAULT_OCEAN_SWELL_STRENGTH,
  injectOceanSwellShader,
  OCEAN_SWELL_FADE_END_Z,
  OCEAN_SWELL_FADE_START_Z,
} from '../src/experience/OceanSwell.js';

const waterNormals = new THREE.DataTexture(
  new Uint8Array([128, 128, 255, 255]),
  1,
  1,
  THREE.RGBAFormat,
);
waterNormals.needsUpdate = true;
const water = new Water(new THREE.PlaneGeometry(2, 2), { waterNormals });
const source = water.material.fragmentShader;
const sourceSamples = (source.match(/texture2D\s*\(/g) ?? []).length;
const patched = injectOceanSwellShader(source);
const patchedSamples = (patched.match(/texture2D\s*\(/g) ?? []).length;

assert.equal(DEFAULT_OCEAN_SWELL_STRENGTH, 0.42);
assert.equal(OCEAN_SWELL_FADE_START_Z, -55);
assert.equal(OCEAN_SWELL_FADE_END_Z, 4);
assert.equal((patched.match(/uniform float uSwellStrength;/g) ?? []).length, 1);
assert.ok(patched.includes('float farOceanMask'));
assert.ok(patched.includes('time * 0.31'));
assert.ok(patched.includes('time * 0.19'));
assert.ok(patched.includes('worldPosition.z'));
assert.ok(patched.includes('surfaceNormal +'));
assert.equal(patchedSamples, sourceSamples);
assert.throws(
  () => injectOceanSwellShader('void main() {}'),
  /surface-normal marker was not found/,
);

water.geometry.dispose();
water.material.dispose();
waterNormals.dispose();

console.log('Ocean swell shader injection checks passed.');

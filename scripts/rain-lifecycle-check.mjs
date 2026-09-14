import assert from 'node:assert/strict';

import * as THREE from 'three';

import {
  getRainGpuAttributeByteCount,
  getRainPositionCount,
  getRainQualityProfile,
  getRainResidentByteCount,
  getRainResidentFloatCount,
  RAIN_QUALITY_PROFILES,
} from '../src/experience/RainQuality.js';
import { RainSystem } from '../src/experience/RainSystem.js';

const high = getRainQualityProfile('high');
const low = getRainQualityProfile('low');

assert.equal(getRainQualityProfile('unsupported'), low);
assert.ok(Object.isFrozen(RAIN_QUALITY_PROFILES));
assert.ok(Object.isFrozen(high));
assert.ok(Object.isFrozen(low));
assert.equal(getRainPositionCount(high), 6600);
assert.equal(getRainPositionCount(low), 3120);
assert.equal(getRainResidentFloatCount(high), 46_200);
assert.equal(getRainResidentFloatCount(low), 21_840);
assert.equal(getRainResidentByteCount(high), 184_800);
assert.equal(getRainResidentByteCount(low), 87_360);
assert.equal(getRainGpuAttributeByteCount(high), 158_400);
assert.equal(getRainGpuAttributeByteCount(low), 74_880);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera();
camera.position.set(12, 10, 15);
const rain = new RainSystem({ scene, camera, quality: 'high' });

let state = rain.getDebugState();
assert.equal(state.enabled, false);
assert.equal(state.initialized, false);
assert.equal(state.allocations, 0);
assert.equal(state.releases, 0);
assert.equal(state.residentBytes, 0);
assert.equal(state.gpuAttributeBytes, 0);
assert.equal(state.plannedResidentBytes, 184_800);
assert.equal(scene.children.length, 0);

state = rain.setEnabled(false);
assert.equal(state.initialized, false);
assert.equal(state.allocations, 0);

state = rain.setQuality('low');
assert.equal(state.quality, 'low');
assert.equal(state.initialized, false);
assert.equal(state.plannedResidentBytes, 87_360);

state = rain.setEnabled(true);
assert.equal(state.enabled, true);
assert.equal(state.visible, true);
assert.equal(state.initialized, true);
assert.equal(state.resourcesLinked, true);
assert.equal(state.allocations, 1);
assert.equal(state.residentFloats, 21_840);
assert.equal(state.residentBytes, 87_360);
assert.equal(state.gpuAttributeBytes, 74_880);
assert.equal(rain.lines.geometry.getAttribute('position').count, 3120);
assert.equal(scene.children.length, 1);

const reusableLines = rain.lines;
rain.setEnabled(false);
state = rain.setEnabled(true);
assert.equal(rain.lines, reusableLines);
assert.equal(state.allocations, 1);
rain.setEnabled(false);

let geometryDisposals = 0;
let materialDisposals = 0;
reusableLines.geometry.addEventListener('dispose', () => {
  geometryDisposals += 1;
});
reusableLines.material.addEventListener('dispose', () => {
  materialDisposals += 1;
});

state = rain.setQuality('high');
assert.equal(state.quality, 'high');
assert.equal(state.initialized, false);
assert.equal(state.releases, 1);
assert.equal(state.residentBytes, 0);
assert.equal(geometryDisposals, 1);
assert.equal(materialDisposals, 1);
assert.equal(scene.children.length, 0);

state = rain.setEnabled(true);
assert.equal(state.initialized, true);
assert.equal(state.allocations, 2);
assert.equal(state.residentBytes, 184_800);
assert.equal(rain.lines.geometry.getAttribute('position').count, 6600);

const finalLines = rain.lines;
rain.dispose();
state = rain.getDebugState();
assert.equal(finalLines.parent, null);
assert.equal(state.enabled, false);
assert.equal(state.initialized, false);
assert.equal(state.releases, 2);
assert.equal(state.residentBytes, 0);

console.log(
  JSON.stringify(
    {
      ok: true,
      defaultResidentBytes: 0,
      deferredResidentBytes: {
        high: getRainResidentByteCount(high),
        low: getRainResidentByteCount(low),
      },
      deferredGpuAttributeBytes: {
        high: getRainGpuAttributeByteCount(high),
        low: getRainGpuAttributeByteCount(low),
      },
      disabledToggleReusesResources: true,
      disabledQualityChangeReleasesResources: true,
    },
    null,
    2,
  ),
);

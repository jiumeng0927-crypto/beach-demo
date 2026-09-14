import assert from 'node:assert/strict';

import * as THREE from 'three';

import { BeachDiscoveryGame } from '../src/experience/BeachDiscoveryGame.js';
import {
  DISCOVERY_RESOURCE_PROFILE,
  getDiscoveryResourceProfile,
} from '../src/experience/DiscoveryResources.js';

globalThis.window = { devicePixelRatio: 2 };
globalThis.document = new EventTarget();
globalThis.HTMLElement = class HTMLElement {};

class MockDomElement extends EventTarget {
  constructor() {
    super();
    this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => this.classes.add(name)),
      remove: (...names) => names.forEach((name) => this.classes.delete(name)),
      toggle: (name, force) => {
        if (force) this.classes.add(name);
        else this.classes.delete(name);
      },
    };
  }
}

const profile = getDiscoveryResourceProfile();
assert.equal(profile, DISCOVERY_RESOURCE_PROFILE);
assert.ok(Object.isFrozen(profile));
assert.deepEqual(profile, {
  siteCount: 6,
  glassVertexCount: 240,
  glassGeometryBytes: 7_680,
  instanceMatrixBytes: 384,
  instanceColorBytes: 72,
  glowAttributeBytes: 192,
  totalAttributeBytes: 8_328,
});

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera();
const domElement = new MockDomElement();
const discovery = new BeachDiscoveryGame({
  scene,
  camera,
  domElement,
  quality: 'high',
});

let state = discovery.getDebugState();
assert.equal(state.enabled, false);
assert.equal(state.initialized, false);
assert.equal(state.allocations, 0);
assert.equal(state.releases, 0);
assert.equal(state.residentAttributeBytes, 0);
assert.equal(state.plannedAttributeBytes, 8_328);
assert.equal(state.objectsInScene, 0);
assert.equal(state.drawObjects, 0);
assert.equal(state.resourcesLinked, false);
assert.equal(state.total, 6);
assert.equal(discovery.group.parent, null);
assert.equal(discovery.glass, null);
assert.equal(discovery.glows, null);

discovery.setQuality('low');
discovery.setEnabled(true);
state = discovery.getDebugState();
assert.equal(state.enabled, true);
assert.equal(state.initialized, true);
assert.equal(state.allocations, 1);
assert.equal(state.releases, 0);
assert.equal(state.residentAttributeBytes, 8_328);
assert.equal(state.glassGeometryBytes, 7_680);
assert.equal(state.instanceMatrixBytes, 384);
assert.equal(state.instanceColorBytes, 72);
assert.equal(state.glowAttributeBytes, 192);
assert.equal(state.objectsInScene, 3);
assert.equal(state.drawObjects, 2);
assert.equal(state.resourcesLinked, true);
assert.equal(discovery.group.parent, scene);
assert.equal(discovery.glowMaterial.uniforms.uPixelRatio.value, 1);
assert.equal(discovery.glass.castShadow, false);

const group = discovery.group;
const glass = discovery.glass;
const glows = discovery.glows;
const glowMaterial = discovery.glowMaterial;

discovery.setEnabled(false);
state = discovery.getDebugState();
assert.equal(state.enabled, false);
assert.equal(state.initialized, true);
assert.equal(state.allocations, 1);
assert.equal(state.residentAttributeBytes, 8_328);
assert.equal(state.drawObjects, 0);

discovery.setEnabled(true);
state = discovery.getDebugState();
assert.equal(discovery.group, group);
assert.equal(discovery.glass, glass);
assert.equal(discovery.glows, glows);
assert.equal(discovery.glowMaterial, glowMaterial);
assert.equal(state.allocations, 1);
assert.equal(state.drawObjects, 2);

let instanceDisposals = 0;
let glassGeometryDisposals = 0;
let glassMaterialDisposals = 0;
let glowGeometryDisposals = 0;
let glowMaterialDisposals = 0;
glass.addEventListener('dispose', () => { instanceDisposals += 1; });
glass.geometry.addEventListener('dispose', () => {
  glassGeometryDisposals += 1;
});
glass.material.addEventListener('dispose', () => {
  glassMaterialDisposals += 1;
});
glows.geometry.addEventListener('dispose', () => {
  glowGeometryDisposals += 1;
});
glowMaterial.addEventListener('dispose', () => {
  glowMaterialDisposals += 1;
});

discovery.dispose();
state = discovery.getDebugState();
assert.equal(state.enabled, false);
assert.equal(state.initialized, false);
assert.equal(state.releases, 1);
assert.equal(state.residentAttributeBytes, 0);
assert.equal(state.objectsInScene, 0);
assert.equal(state.resourcesLinked, false);
assert.equal(group.parent, null);
assert.equal(discovery.glass, null);
assert.equal(discovery.glows, null);
assert.equal(discovery.glowMaterial, null);
assert.equal(instanceDisposals, 1);
assert.equal(glassGeometryDisposals, 1);
assert.equal(glassMaterialDisposals, 1);
assert.equal(glowGeometryDisposals, 1);
assert.equal(glowMaterialDisposals, 1);

const chapters = new BeachDiscoveryGame({ scene, camera, domElement });
chapters.setEnabled(true);
const released = [];
const chapterGroup = chapters.group;
for (let chapter = 0; chapter < 3; chapter++) {
  const state = chapters.getDebugState();
  assert.equal(state.residentAttributeBytes, state.plannedAttributeBytes, 'Actual buffers match the chapter resource profile');
  for (const resource of [chapters.glass, chapters.glass.geometry, chapters.glass.material, chapters.glows.geometry, chapters.glowMaterial]) {
    const tracker = { count: 0 }; released.push(tracker);
    resource.addEventListener('dispose', () => tracker.count++);
  }
  chapters.tideLevel = -1;
  chapters.items.forEach((_, i) => chapters.collect(i));
  if (chapter < 2) assert.equal(chapters.nextChapter(), true);
}
assert.equal(chapters.campaign.getState().completed, true);
chapters.reset();
assert.equal(chapters.group, chapterGroup);
assert.equal(chapters.allocations, 4); assert.equal(chapters.releases, 3);
assert.ok(released.every(resource => resource.count === 1), 'Each retired chapter releases all its owned resources once');
chapters.dispose(); chapters.dispose();
assert.equal(chapters.releases, chapters.allocations);

console.log(
  JSON.stringify(
    {
      ok: true,
      defaultResidentAttributeBytes: 0,
      deferredAttributeBytes: profile.totalAttributeBytes,
      firstEntryAllocation: true,
      disabledToggleReusesResources: true,
      disposalComplete: true,
    },
    null,
    2,
  ),
);

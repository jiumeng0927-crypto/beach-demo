import assert from 'node:assert/strict';
import * as THREE from 'three';
import { NPC_SPECS, getNpcRouteState } from '../src/experience/BeachNpcSystem.js';
import { applyNpcPalette, createNpcAccessory, NPC_APPEARANCES } from '../src/experience/NpcAppearance.js';

const appearances = NPC_SPECS.map(spec => NPC_APPEARANCES[spec.id]);
assert.equal(appearances.filter(Boolean).length, NPC_SPECS.length);
assert.equal(new Set(appearances.map(item => item.kit)).size, NPC_SPECS.length);
assert.equal(new Set(appearances.map(item => item.label)).size, NPC_SPECS.length);
assert.equal(new Set(appearances.map(item => item.palette.shirt)).size, NPC_SPECS.length);
assert.ok(appearances.every(item => item.width >= 0.9 && item.width <= 1.11));
assert.ok(appearances.every(item => item.depth >= 0.94 && item.depth <= 1.06));

let accessoryTriangles = 0;
for (const appearance of appearances) {
  const mesh = createNpcAccessory(appearance);
  assert.equal(mesh.name, `NpcAccessory-${appearance.kit}`);
  assert.ok(mesh.geometry.getAttribute('color'));
  assert.equal(mesh.material.vertexColors, true);
  accessoryTriangles += mesh.geometry.index.count / 3;
  mesh.geometry.dispose();
  mesh.material.dispose();
}
assert.ok(accessoryTriangles < 4500, `Accessory budget exceeded: ${accessoryTriangles}`);

const sourceGeometry = new THREE.BufferGeometry();
sourceGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
sourceGeometry.setAttribute('color', new THREE.Float32BufferAttribute([
  0.591, 0.342, 0.287, 0.591, 0.342, 0.287, 0.591, 0.342, 0.287,
], 3));
const sourceMaterial = new THREE.MeshStandardMaterial({ vertexColors: true });
const sourceMesh = new THREE.Mesh(sourceGeometry, sourceMaterial);
const sourceModel = new THREE.Group();
sourceModel.add(sourceMesh);
const recolored = applyNpcPalette(sourceModel, NPC_APPEARANCES.lin, 'female');
assert.equal(recolored, 3);
assert.notEqual(sourceMesh.geometry, sourceGeometry);
assert.notEqual(sourceMesh.material, sourceMaterial);
const expected = new THREE.Color(NPC_APPEARANCES.lin.palette.shirt);
assert.ok(Math.abs(sourceMesh.geometry.getAttribute('color').getX(0) - expected.r) < 1e-6);
sourceMesh.geometry.dispose(); sourceMesh.material.dispose(); sourceGeometry.dispose(); sourceMaterial.dispose();

const walker = NPC_SPECS.find(spec => spec.id === 'fan');
const start = getNpcRouteState(walker, 0);
const outbound = getNpcRouteState(walker, 4);
const turn = getNpcRouteState(walker, Math.abs(walker.route[1] - walker.route[0]) / walker.speed + 1);
assert.equal(start.x, walker.route[0]);
assert.ok(outbound.x > start.x && outbound.moving && !outbound.reverse);
assert.equal(turn.x, walker.route[1]);
assert.equal(turn.moving, false);

console.log(JSON.stringify({ ok: true, visitors: appearances.length,
  uniqueKits: new Set(appearances.map(item => item.kit)).size, accessoryTriangles, paletteClone: true }));

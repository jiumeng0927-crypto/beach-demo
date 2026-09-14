import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  CHIBI_CHARACTER_PROFILE,
  ChibiCharacterSystem,
} from '../src/experience/ChibiCharacterSystem.js';

function createFakeAsset(seed) {
  const scene = new THREE.Group();
  scene.name = `FakeCharacter${seed}`;
  const head = new THREE.Group();
  head.name = 'HeadPivot';
  head.position.y = 1;
  const leftArm = new THREE.Group();
  leftArm.name = 'LeftArmPivot';
  leftArm.position.set(-0.45, 0.8, 0);
  const rightArm = new THREE.Group();
  rightArm.name = 'RightArmPivot';
  rightArm.position.set(0.45, 0.8, 0);

  const addMesh = (parent, name, position, scale) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x668899 + seed }),
    );
    mesh.name = name;
    mesh.position.copy(position);
    mesh.scale.copy(scale);
    parent.add(mesh);
    return mesh;
  };
  addMesh(
    scene,
    'BodyMesh',
    new THREE.Vector3(0, 0.5, 0),
    new THREE.Vector3(0.8, 1, 0.6),
  );
  addMesh(
    head,
    'HeadMesh',
    new THREE.Vector3(0, 0.5, 0),
    new THREE.Vector3(1.1, 1, 0.8),
  );
  addMesh(
    leftArm,
    'LeftArmMesh',
    new THREE.Vector3(0, -0.2, 0),
    new THREE.Vector3(0.25, 0.6, 0.25),
  );
  addMesh(
    rightArm,
    'RightArmMesh',
    new THREE.Vector3(0, -0.2, 0),
    new THREE.Vector3(0.25, 0.6, 0.25),
  );
  scene.add(head, leftArm, rightArm);
  return { scene, animations: [] };
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera();
let modelLoads = 0;
const characters = new ChibiCharacterSystem({
  scene,
  camera,
  quality: 'high',
  modelLoader: async () => {
    modelLoads += 1;
    return createFakeAsset(modelLoads);
  },
});

let state = characters.getDebugState();
assert.equal(state.initialized, false);
assert.equal(state.loading, false);
assert.equal(state.characters, 0);
assert.equal(state.residentMeshes, 0);
assert.equal(state.groupInScene, false);

const firstReady = characters.setEnabled(true);
state = characters.getDebugState();
assert.equal(state.loading, true);
assert.equal(state.initialized, false);
assert.equal(state.groupInScene, true);
await firstReady;

state = characters.getDebugState();
assert.equal(state.initialized, true);
assert.equal(state.loading, false);
assert.equal(state.visible, true);
assert.equal(state.characters, CHIBI_CHARACTER_PROFILE.characterCount);
assert.equal(state.source, 'blender-glb');
assert.equal(state.animation, 'procedural-idle');
assert.equal(state.modelFiles, 2);
assert.equal(state.headBodyRatio, 1);
assert.equal(state.residentMeshes, 8);
assert.equal(state.drawObjects, 8);
assert.equal(state.geometries, 8);
assert.equal(state.materials, 8);
assert.equal(state.textures, 0);
assert.equal(state.animationNodes, 6);
assert.equal(state.triangles, 96);
assert.equal(state.residentGeometryBytes > 0, true);
assert.equal(state.allocations, 1);
assert.equal(state.resourcesLinked, true);
assert.equal(state.groupInScene, true);
assert.deepEqual(state.names, ['晴帽向导', '软绒旅伴']);
assert.equal(modelLoads, 2);

const initialUuids = [...state.characterUuids];
const initialY = characters.characters[0].root.position.y;
const initialArmRotation = characters.characters[0].rightArm.rotation.z;
characters.update(1 / 60, 1.5, 0.8);
assert.notEqual(characters.characters[0].root.position.y, initialY);
assert.notEqual(
  characters.characters[0].rightArm.rotation.z,
  initialArmRotation,
);

await characters.setEnabled(false);
state = characters.getDebugState();
assert.equal(state.visible, false);
assert.equal(state.drawObjects, 0);
assert.equal(state.residentMeshes, 8);
await characters.setEnabled(true);
state = characters.getDebugState();
assert.equal(state.allocations, 1);
assert.equal(modelLoads, 2);
assert.deepEqual(state.characterUuids, initialUuids);

characters.setQuality('low');
characters.setShadows(false);
state = characters.getDebugState();
assert.equal(state.quality, 'low');
assert.equal(state.shadowsEnabled, false);
characters.group.traverse((object) => {
  if (object.isMesh) assert.equal(object.castShadow, false);
});

const geometries = new Set();
const materials = new Set();
characters.group.traverse((object) => {
  if (object.geometry) geometries.add(object.geometry);
  if (object.material) materials.add(object.material);
});
assert.equal(geometries.size, 8);
assert.equal(materials.size, 8);

const resources = [...geometries, ...materials];
const disposalCounts = new Map(resources.map((resource) => [resource, 0]));
resources.forEach((resource) => {
  resource.addEventListener('dispose', () => {
    disposalCounts.set(resource, disposalCounts.get(resource) + 1);
  });
});

characters.dispose();
state = characters.getDebugState();
assert.equal(state.initialized, false);
assert.equal(state.characters, 0);
assert.equal(state.groupInScene, false);
assert.equal(state.releases, 1);
assert.equal(
  [...disposalCounts.values()].every((count) => count === 1),
  true,
);

console.log(JSON.stringify({
  ok: true,
  source: CHIBI_CHARACTER_PROFILE.source,
  characterCount: CHIBI_CHARACTER_PROFILE.characterCount,
  headBodyRatio: CHIBI_CHARACTER_PROFILE.headBodyRatio,
  modelFiles: CHIBI_CHARACTER_PROFILE.modelFiles,
  animationNodes: 6,
  meshes: 8,
  lazyAllocation: true,
  toggleReusesResources: true,
  disposalComplete: true,
}, null, 2));

import * as THREE from 'three';
import { assetUrl } from './assetUrl.js';

import { terrainHeight } from './world.js';

const CHARACTER_SPECS = Object.freeze([
  Object.freeze({
    id: 'hat-guide',
    name: '晴帽向导',
    url: '/characters/hat-guide.glb',
    position: Object.freeze([9.2, 23.6]),
    facing: 0.74,
    phase: 0.35,
    targetHeight: 4.65,
    motion: 'wave',
  }),
  Object.freeze({
    id: 'plush-dreamer',
    name: '软绒旅伴',
    url: '/characters/plush-dreamer.glb',
    position: Object.freeze([16.5, 25.5]),
    facing: 0.74,
    phase: 2.1,
    targetHeight: 4.25,
    motion: 'sway',
  }),
]);

export const CHIBI_CHARACTER_PROFILE = Object.freeze({
  characterCount: CHARACTER_SPECS.length,
  headBodyRatio: 1,
  modelFiles: CHARACTER_SPECS.length,
  source: 'blender-glb',
  animation: 'procedural-idle',
});

let loaderPromise = null;

async function loadCharacterModel(spec) {
  loaderPromise ??= import('three/addons/loaders/GLTFLoader.js').then(
    ({ GLTFLoader }) => new GLTFLoader(),
  );
  const loader = await loaderPromise;
  return loader.loadAsync(assetUrl(spec.url));
}

function materialList(material) {
  return Array.isArray(material) ? material : material ? [material] : [];
}

function collectResources(root) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  let meshes = 0;
  let triangles = 0;
  let drawObjects = 0;

  root?.traverse((object) => {
    if (!object.isMesh || !object.geometry) return;
    meshes += 1;
    geometries.add(object.geometry);
    const objectMaterials = materialList(object.material);
    objectMaterials.forEach((material) => materials.add(material));
    drawObjects += Math.max(1, objectMaterials.length);
    triangles += Math.floor(
      (object.geometry.index?.count
        ?? object.geometry.attributes.position?.count
        ?? 0) / 3,
    );
  });

  materials.forEach((material) => {
    Object.values(material).forEach((value) => {
      if (value?.isTexture) textures.add(value);
    });
  });

  const geometryBytes = [...geometries].reduce((total, geometry) => {
    const attributeBytes = Object.values(geometry.attributes ?? {}).reduce(
      (sum, attribute) => sum + (attribute.array?.byteLength ?? 0),
      0,
    );
    return total + attributeBytes + (geometry.index?.array?.byteLength ?? 0);
  }, 0);

  return {
    geometries,
    materials,
    textures,
    meshes,
    triangles,
    drawObjects,
    geometryBytes,
  };
}

function disposeObjectTree(root) {
  const resources = collectResources(root);
  resources.textures.forEach((texture) => {
    texture.dispose();
    texture.source?.data?.close?.();
  });
  resources.materials.forEach((material) => material.dispose());
  resources.geometries.forEach((geometry) => geometry.dispose());
}

function getAssetRoot(asset) {
  return asset?.scene ?? asset;
}

function createCharacter(spec, asset, shadowsEnabled) {
  const model = getAssetRoot(asset);
  if (!model?.isObject3D) {
    throw new Error(`${spec.name} 的 GLB 不包含有效场景。`);
  }

  model.name = `${spec.id}-model`;
  model.traverse((object) => {
    if (object.isLight || object.isCamera) object.visible = false;
    if (object.isMesh) {
      object.castShadow = shadowsEnabled;
      object.receiveShadow = true;
    }
  });
  model.updateMatrixWorld(true);

  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  if (!Number.isFinite(size.y) || size.y <= 0.0001) {
    disposeObjectTree(model);
    throw new Error(`${spec.name} 的 GLB 尺寸无效。`);
  }

  model.scale.multiplyScalar(spec.targetHeight / size.y);
  model.updateMatrixWorld(true);
  bounds.setFromObject(model);
  const center = bounds.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.y -= bounds.min.y;
  model.position.z -= center.z;

  const root = new THREE.Group();
  root.name = `${spec.id}-character`;
  const [x, z] = spec.position;
  const baseY = terrainHeight(x, z) + 0.045;
  root.position.set(x, baseY, z);
  root.rotation.y = spec.facing;
  root.add(model);

  const head = model.getObjectByName('HeadPivot');
  const leftArm = model.getObjectByName('LeftArmPivot');
  const rightArm = model.getObjectByName('RightArmPivot');
  const resources = collectResources(model);

  return {
    spec,
    root,
    model,
    head,
    leftArm,
    rightArm,
    baseY,
    resources,
    baseScale: model.scale.clone(),
    baseRotations: {
      head: head?.rotation.clone() ?? null,
      leftArm: leftArm?.rotation.clone() ?? null,
      rightArm: rightArm?.rotation.clone() ?? null,
    },
  };
}

function applyPivotRotation(pivot, base, x, y, z) {
  if (!pivot || !base) return;
  pivot.rotation.set(base.x + x, base.y + y, base.z + z, base.order);
}

export class ChibiCharacterSystem {
  constructor({
    scene,
    camera,
    renderer,
    quality = 'high',
    modelLoader = loadCharacterModel,
  }) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.modelLoader = modelLoader;
    this.quality = quality === 'high' ? 'high' : 'low';
    this.enabled = false;
    this.initialized = false;
    this.loading = false;
    this.shadowsEnabled = this.quality === 'high';
    this.allocations = 0;
    this.releases = 0;
    this.loadRevision = 0;
    this.lastError = null;
    this.group = new THREE.Group();
    this.group.name = 'TidelineChibiCharacters';
    this.group.visible = false;
    this.characters = [];
    this.ready = Promise.resolve(null);
  }

  createVisuals() {
    if (this.initialized || this.loading) return this.ready;
    this.loading = true;
    this.lastError = null;
    const revision = ++this.loadRevision;
    if (this.group.parent !== this.scene) this.scene.add(this.group);
    this.group.visible = false;

    this.ready = Promise.allSettled(
      CHARACTER_SPECS.map((spec) => this.modelLoader(spec)),
    ).then((results) => {
      const fulfilled = results
        .filter((result) => result.status === 'fulfilled')
        .map((result) => result.value);
      if (revision !== this.loadRevision) {
        fulfilled.forEach((asset) => disposeObjectTree(getAssetRoot(asset)));
        return null;
      }
      const failure = results.find((result) => result.status === 'rejected');
      if (failure) {
        fulfilled.forEach((asset) => disposeObjectTree(getAssetRoot(asset)));
        throw failure.reason;
      }

      this.characters = CHARACTER_SPECS.map((spec, index) =>
        createCharacter(spec, results[index].value, this.shadowsEnabled),
      );
      this.characters.forEach(({ root }) => this.group.add(root));
      this.loading = false;
      this.initialized = true;
      this.allocations += 1;
      this.group.visible = this.enabled;
      return this.getDebugState();
    }).catch((error) => {
      if (revision !== this.loadRevision) return null;
      this.loading = false;
      this.lastError = error instanceof Error ? error.message : String(error);
      console.error('Blender 角色模型加载失败。', error);
      return null;
    });
    return this.ready;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (this.enabled) this.createVisuals();
    this.group.visible = this.enabled && this.initialized;
    return this.enabled
      ? this.ready
      : Promise.resolve(this.getDebugState());
  }

  setQuality(quality) {
    this.quality = quality === 'high' ? 'high' : 'low';
    return this.getDebugState();
  }

  setShadows(enabled) {
    this.shadowsEnabled = Boolean(enabled);
    this.characters.forEach(({ model }) => {
      model.traverse((object) => {
        if (object.isMesh) object.castShadow = this.shadowsEnabled;
      });
    });
  }

  update(_delta, elapsed, windFactor = 0.6) {
    if (!this.enabled || !this.initialized) return;
    const wind = THREE.MathUtils.clamp(windFactor, 0, 1.2);

    this.characters.forEach((character, index) => {
      const time = elapsed + character.spec.phase;
      const quick = character.spec.motion === 'wave';
      const breathing = Math.sin(time * (quick ? 1.7 : 1.25));
      character.root.position.y = character.baseY
        + breathing * (quick ? 0.045 : 0.035);
      character.root.rotation.y = character.spec.facing
        + Math.sin(time * 0.48) * 0.025 * wind;
      character.model.scale.set(
        character.baseScale.x,
        character.baseScale.y * (1 + breathing * (quick ? 0.006 : 0.01)),
        character.baseScale.z,
      );

      applyPivotRotation(
        character.head,
        character.baseRotations.head,
        Math.sin(time * 0.62) * 0.018,
        Math.sin(time * 0.44) * 0.035,
        Math.sin(time * 0.71) * 0.022 * wind,
      );

      if (quick) {
        applyPivotRotation(
          character.leftArm,
          character.baseRotations.leftArm,
          0,
          0,
          Math.sin(time * 1.15) * 0.08,
        );
        applyPivotRotation(
          character.rightArm,
          character.baseRotations.rightArm,
          -0.28,
          0,
          -0.46 + Math.sin(time * 3.1) * 0.24,
        );
      } else {
        const sway = Math.sin(time * 1.05) * 0.09;
        applyPivotRotation(
          character.leftArm,
          character.baseRotations.leftArm,
          0,
          0,
          sway,
        );
        applyPivotRotation(
          character.rightArm,
          character.baseRotations.rightArm,
          0,
          0,
          -sway,
        );
      }

      character.root.userData.animationPhase = Number(time.toFixed(3));
      character.root.userData.characterIndex = index;
    });
  }

  getDebugState() {
    const totals = this.characters.reduce(
      (result, character) => {
        result.meshes += character.resources.meshes;
        result.triangles += character.resources.triangles;
        result.drawObjects += character.resources.drawObjects;
        result.geometries += character.resources.geometries.size;
        result.materials += character.resources.materials.size;
        result.textures += character.resources.textures.size;
        result.geometryBytes += character.resources.geometryBytes;
        return result;
      },
      {
        meshes: 0,
        triangles: 0,
        drawObjects: 0,
        geometries: 0,
        materials: 0,
        textures: 0,
        geometryBytes: 0,
      },
    );
    return {
      enabled: this.enabled,
      initialized: this.initialized,
      loading: this.loading,
      visible: this.group.visible,
      quality: this.quality,
      source: CHIBI_CHARACTER_PROFILE.source,
      animation: CHIBI_CHARACTER_PROFILE.animation,
      characters: this.characters.length,
      names: this.characters.map(({ spec }) => spec.name),
      headBodyRatio: CHIBI_CHARACTER_PROFILE.headBodyRatio,
      modelFiles: CHIBI_CHARACTER_PROFILE.modelFiles,
      drawObjects: this.group.visible && this.initialized
        ? totals.drawObjects
        : 0,
      residentMeshes: totals.meshes,
      triangles: totals.triangles,
      geometries: totals.geometries,
      materials: totals.materials,
      textures: totals.textures,
      residentGeometryBytes: totals.geometryBytes,
      animationNodes: this.characters.reduce(
        (total, character) =>
          total
          + Number(Boolean(character.head))
          + Number(Boolean(character.leftArm))
          + Number(Boolean(character.rightArm)),
        0,
      ),
      allocations: this.allocations,
      releases: this.releases,
      shadowsEnabled: this.shadowsEnabled,
      groupInScene: this.group.parent === this.scene,
      resourcesLinked:
        this.initialized
        && this.characters.every(
          ({ resources }) =>
            resources.meshes > 0
            && resources.geometries.size > 0
            && resources.materials.size > 0,
        ),
      groupUuid: this.group.parent ? this.group.uuid : null,
      characterUuids: this.characters.map(({ root }) => root.uuid),
      positions: this.characters.map(({ root }) =>
        root.position.toArray().map((value) => Number(value.toFixed(3))),
      ),
      lastError: this.lastError,
    };
  }

  releaseVisuals() {
    if (!this.initialized) return;
    this.characters.forEach(({ model }) => disposeObjectTree(model));
    this.group.clear();
    this.characters = [];
    this.initialized = false;
    this.releases += 1;
    this.ready = Promise.resolve(null);
  }

  dispose() {
    this.enabled = false;
    this.loadRevision += 1;
    this.loading = false;
    this.group.visible = false;
    this.releaseVisuals();
    this.group.removeFromParent();
  }
}

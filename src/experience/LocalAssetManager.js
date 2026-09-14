import * as THREE from 'three';

import { terrainHeight } from './world.js';

const MODEL_LIMIT_BYTES = 30 * 1024 * 1024;
const TEXTURE_LIMIT_BYTES = 15 * 1024 * 1024;
const TRIANGLE_LIMIT = 500_000;
const MODEL_EXTENSIONS = new Set(['glb', 'gltf']);
const TEXTURE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'avif']);
const DISPLAY_ANCHOR = new THREE.Vector3(2, 0, 25);
const ANIMATION_FADE_SECONDS = 0.35;
const MIN_ANIMATION_SPEED = 0.25;
const MAX_ANIMATION_SPEED = 2;
const TRANSFORM_LIMITS = Object.freeze({
  x: [-32, 32],
  z: [14, 44],
  rotation: [-180, 180],
  scale: [0.5, 2],
});

function getExtension(name) {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

function displayName(name) {
  return name.length > 34 ? `${name.slice(0, 31)}...` : name;
}

function materialList(material) {
  return Array.isArray(material) ? material : material ? [material] : [];
}

function disposeObjectTree(root) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();

  root.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    materialList(object.material).forEach((material) => materials.add(material));
  });

  materials.forEach((material) => {
    Object.values(material).forEach((value) => {
      if (value?.isTexture) textures.add(value);
    });
  });
  textures.forEach((texture) => {
    texture.dispose();
    texture.source?.data?.close?.();
  });
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
}

function countModel(root) {
  let meshes = 0;
  let triangles = 0;
  root.traverse((object) => {
    if (!object.isMesh || !object.geometry) return;
    meshes += 1;
    const geometry = object.geometry;
    triangles += Math.floor(
      (geometry.index?.count ?? geometry.attributes.position?.count ?? 0) / 3,
    );
  });
  return { meshes, triangles };
}

function validateEmbeddedGltf(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('glTF 文件不是有效的 JSON。');
  }

  const externalUri = [...(data.buffers ?? []), ...(data.images ?? [])]
    .map((item) => item.uri)
    .find((uri) => uri && !uri.startsWith('data:'));
  if (externalUri) {
    throw new Error('当前仅支持 GLB，或资源已内嵌为 data URI 的 glTF。');
  }
  return text;
}

export class LocalAssetManager {
  constructor({ scene, camera, renderer }) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.loaderPromise = null;
    this.current = null;
    this.mixer = null;
    this.animationRoot = null;
    this.animationClips = [];
    this.activeAction = null;
    this.activeAnimationIndex = -1;
    this.animationPlaying = false;
    this.animationSpeed = 1;
    this.operationId = 0;
    this.shadowsEnabled = true;
    this.anchor = DISPLAY_ANCHOR.clone();
    this.anchor.y = terrainHeight(this.anchor.x, this.anchor.z) + 0.04;
  }

  validateFile(file, extensions, byteLimit, label) {
    if (!file?.name || typeof file.arrayBuffer !== 'function') {
      throw new Error(`请选择有效的${label}文件。`);
    }
    if (!file.size) throw new Error(`${label}文件为空。`);
    if (file.size > byteLimit) {
      throw new Error(`${label}文件不能超过 ${Math.round(byteLimit / 1024 / 1024)} MB。`);
    }
    if (!extensions.has(getExtension(file.name))) {
      throw new Error(`${label}格式不受支持。`);
    }
  }

  async importModel(file) {
    this.validateFile(file, MODEL_EXTENSIONS, MODEL_LIMIT_BYTES, '模型');
    const operationId = ++this.operationId;
    const extension = getExtension(file.name);
    this.loaderPromise ??= import('three/addons/loaders/GLTFLoader.js').then(
      ({ GLTFLoader }) => new GLTFLoader(),
    );
    const [buffer, loader] = await Promise.all([
      file.arrayBuffer(),
      this.loaderPromise,
    ]);
    const source = extension === 'gltf'
      ? validateEmbeddedGltf(new TextDecoder().decode(buffer))
      : buffer;
    const gltf = await loader.parseAsync(source, '');
    const model = gltf.scene;

    if (operationId !== this.operationId) {
      disposeObjectTree(model);
      throw new Error('导入操作已被新的选择替换。');
    }

    const metrics = countModel(model);
    if (!metrics.meshes) {
      disposeObjectTree(model);
      throw new Error('模型中没有可显示的网格。');
    }
    if (metrics.triangles > TRIANGLE_LIMIT) {
      disposeObjectTree(model);
      throw new Error(`模型超过 ${TRIANGLE_LIMIT.toLocaleString()} 三角形限制。`);
    }

    model.traverse((object) => {
      if (object.isLight || object.isCamera) object.visible = false;
      if (object.isMesh) {
        object.castShadow = this.shadowsEnabled;
        object.receiveShadow = true;
      }
    });
    model.updateMatrixWorld(true);

    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const largestDimension = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(largestDimension) || largestDimension <= 0.0001) {
      disposeObjectTree(model);
      throw new Error('模型尺寸无效。');
    }

    const scale = 4 / largestDimension;
    model.scale.multiplyScalar(scale);
    model.updateMatrixWorld(true);
    bounds.setFromObject(model);
    const center = bounds.getCenter(new THREE.Vector3());
    model.position.x -= center.x;
    model.position.y -= bounds.min.y;
    model.position.z -= center.z;

    const slot = new THREE.Group();
    slot.name = 'ImportedLocalModel';
    slot.position.copy(this.anchor);
    slot.add(model);

    this.commit({
      kind: 'model',
      name: displayName(file.name),
      root: slot,
      meshes: metrics.meshes,
      triangles: metrics.triangles,
      animations: gltf.animations.length,
      scale,
      bytes: file.size,
    });

    this.setupAnimations(model, gltf.animations);
    return this.getDebugState();
  }

  async importTexture(file) {
    this.validateFile(file, TEXTURE_EXTENSIONS, TEXTURE_LIMIT_BYTES, '贴图');
    const operationId = ++this.operationId;
    const bitmap = await createImageBitmap(file);

    if (operationId !== this.operationId) {
      bitmap.close();
      throw new Error('导入操作已被新的选择替换。');
    }
    if (!bitmap.width || !bitmap.height) {
      bitmap.close();
      throw new Error('贴图尺寸无效。');
    }

    const texture = new THREE.CanvasTexture(bitmap);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(
      8,
      this.renderer.capabilities.getMaxAnisotropy(),
    );

    const aspect = THREE.MathUtils.clamp(bitmap.width / bitmap.height, 0.5, 2.2);
    const height = 2.8;
    const width = height * aspect;
    const slot = new THREE.Group();
    slot.name = 'ImportedLocalTexture';
    slot.position.copy(this.anchor);
    slot.rotation.y = Math.atan2(
      this.camera.position.x - this.anchor.x,
      this.camera.position.z - this.anchor.z,
    );

    const backing = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.18, height + 0.18, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x172326, roughness: 0.78 }),
    );
    backing.position.y = height / 2 + 0.18;
    backing.castShadow = this.shadowsEnabled;
    backing.receiveShadow = true;

    const image = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshStandardMaterial({
        map: texture,
        color: 0xffffff,
        roughness: 0.68,
        metalness: 0,
        side: THREE.DoubleSide,
      }),
    );
    image.position.set(0, height / 2 + 0.18, 0.045);
    image.receiveShadow = true;
    slot.add(backing, image);

    this.commit({
      kind: 'texture',
      name: displayName(file.name),
      root: slot,
      meshes: 2,
      triangles: 14,
      animations: 0,
      scale: 1,
      bytes: file.size,
      dimensions: [bitmap.width, bitmap.height],
    });
    return this.getDebugState();
  }

  commit(asset) {
    this.removeCurrent(false);
    asset.baseRotation = asset.root.rotation.y;
    asset.transform = {
      x: this.anchor.x,
      z: this.anchor.z,
      rotation: 0,
      scale: 1,
    };
    this.current = asset;
    this.applyTransform();
    this.scene.add(asset.root);
  }

  applyTransform() {
    if (!this.current) return;
    const { root, baseRotation, transform } = this.current;
    root.position.set(
      transform.x,
      terrainHeight(transform.x, transform.z) + 0.04,
      transform.z,
    );
    root.rotation.y = baseRotation + THREE.MathUtils.degToRad(transform.rotation);
    root.scale.setScalar(transform.scale);
    root.updateMatrixWorld(true);
  }

  setTransform(values = {}) {
    if (!this.current) return this.getDebugState();
    const next = this.current.transform;
    Object.keys(TRANSFORM_LIMITS).forEach((key) => {
      const value = Number(values[key]);
      if (!Number.isFinite(value)) return;
      const [minimum, maximum] = TRANSFORM_LIMITS[key];
      next[key] = THREE.MathUtils.clamp(value, minimum, maximum);
    });
    this.applyTransform();
    return this.getDebugState();
  }

  resetTransform() {
    if (!this.current) return this.getDebugState();
    this.current.transform = {
      x: this.anchor.x,
      z: this.anchor.z,
      rotation: 0,
      scale: 1,
    };
    this.applyTransform();
    return this.getDebugState();
  }

  setShadows(enabled) {
    this.shadowsEnabled = Boolean(enabled);
    this.current?.root.traverse((object) => {
      if (object.isMesh) object.castShadow = this.shadowsEnabled;
    });
  }

  setupAnimations(root, clips) {
    this.animationRoot = root;
    this.animationClips = clips;
    this.activeAction = null;
    this.activeAnimationIndex = -1;
    this.animationPlaying = clips.length > 0;
    this.animationSpeed = 1;
    if (!clips.length) return;

    this.mixer = new THREE.AnimationMixer(root);
    this.selectAnimation(0, 0);
  }

  selectAnimation(index, fadeSeconds = ANIMATION_FADE_SECONDS) {
    if (!this.mixer || !this.animationClips.length) return this.getDebugState();
    if (!Number.isFinite(index)) return this.getDebugState();
    const nextIndex = THREE.MathUtils.clamp(Math.trunc(index), 0, this.animationClips.length - 1);
    if (nextIndex === this.activeAnimationIndex) return this.getDebugState();

    const previousAction = this.activeAction;
    const nextAction = this.mixer.clipAction(this.animationClips[nextIndex]);
    nextAction
      .stopFading()
      .reset()
      .setEffectiveTimeScale(1)
      .setEffectiveWeight(1)
      .play();

    if (previousAction && previousAction !== nextAction) {
      previousAction.stopFading();
      if (this.animationPlaying && fadeSeconds > 0) {
        previousAction.crossFadeTo(nextAction, fadeSeconds, false);
      } else {
        previousAction.stop();
      }
    }

    this.activeAction = nextAction;
    this.activeAnimationIndex = nextIndex;
    this.mixer.timeScale = this.animationPlaying ? this.animationSpeed : 0;
    return this.getDebugState();
  }

  setAnimationPlaying(playing) {
    if (!this.mixer || !this.activeAction) return this.getDebugState();
    this.animationPlaying = Boolean(playing);
    this.mixer.timeScale = this.animationPlaying ? this.animationSpeed : 0;
    return this.getDebugState();
  }

  restartAnimation() {
    if (!this.mixer || !this.activeAction) return this.getDebugState();
    this.mixer.stopAllAction();
    this.activeAction.stopFading().reset().setEffectiveWeight(1).play();
    this.mixer.timeScale = this.animationPlaying ? this.animationSpeed : 0;
    return this.getDebugState();
  }

  setAnimationSpeed(speed) {
    if (!Number.isFinite(speed)) return this.getDebugState();
    this.animationSpeed = THREE.MathUtils.clamp(
      speed,
      MIN_ANIMATION_SPEED,
      MAX_ANIMATION_SPEED,
    );
    if (this.mixer) {
      this.mixer.timeScale = this.animationPlaying ? this.animationSpeed : 0;
    }
    return this.getDebugState();
  }

  update(delta) {
    this.mixer?.update(delta);
  }

  removeCurrent(invalidateOperation = true) {
    if (invalidateOperation) this.operationId += 1;
    this.mixer?.stopAllAction();
    if (this.mixer && this.animationRoot) this.mixer.uncacheRoot(this.animationRoot);
    this.mixer = null;
    this.animationRoot = null;
    this.animationClips = [];
    this.activeAction = null;
    this.activeAnimationIndex = -1;
    this.animationPlaying = false;
    this.animationSpeed = 1;
    if (!this.current) return this.getDebugState();
    this.current.root.removeFromParent();
    disposeObjectTree(this.current.root);
    this.current = null;
    return this.getDebugState();
  }

  getDebugState() {
    if (!this.current) {
      return {
        loaded: false,
        kind: null,
        name: null,
        meshes: 0,
        triangles: 0,
        animations: 0,
        animation: null,
        transform: null,
      };
    }
    const activeClip = this.animationClips[this.activeAnimationIndex] ?? null;
    return {
      loaded: true,
      kind: this.current.kind,
      name: this.current.name,
      meshes: this.current.meshes,
      triangles: this.current.triangles,
      animations: this.current.animations,
      animation: this.animationClips.length
        ? {
            clips: this.animationClips.map((clip, index) => ({
              index,
              name: clip.name || `动画 ${index + 1}`,
              duration: Number(clip.duration.toFixed(3)),
            })),
            activeIndex: this.activeAnimationIndex,
            activeName: activeClip?.name || `动画 ${this.activeAnimationIndex + 1}`,
            playing: this.animationPlaying,
            speed: Number(this.animationSpeed.toFixed(2)),
            time: Number((this.activeAction?.time ?? 0).toFixed(3)),
          }
        : null,
      transform: {
        x: Number(this.current.transform.x.toFixed(2)),
        y: Number(this.current.root.position.y.toFixed(3)),
        z: Number(this.current.transform.z.toFixed(2)),
        rotation: Number(this.current.transform.rotation.toFixed(1)),
        scale: Number(this.current.transform.scale.toFixed(2)),
      },
      bytes: this.current.bytes,
      dimensions: this.current.dimensions ?? null,
      anchor: this.anchor.toArray().map((value) => Number(value.toFixed(3))),
    };
  }

  dispose() {
    this.removeCurrent();
  }
}

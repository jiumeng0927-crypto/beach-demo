import * as THREE from 'three';

import {
  DISCOVERY_SITE_COUNT,
  getDiscoveryResourceProfile,
} from './DiscoveryResources.js';
import { terrainHeight } from './world.js';
import { CollectionCampaign } from './CollectionCampaign.js';

const DISCOVERY_SITES = [
  {
    id: 'shoreline',
    name: '潮纹海玻璃',
    x: 4.5,
    z: 10.5,
    color: '#73c7bd',
    scale: [1.25, 0.55, 0.82],
  },
  {
    id: 'driftwood',
    name: '漂木海玻璃',
    x: -7.4,
    z: 14.2,
    color: '#79aab2',
    scale: [0.8, 0.5, 1.32],
  },
  {
    id: 'reef',
    name: '礁影海玻璃',
    x: -21,
    z: 13,
    color: '#8bb49e',
    scale: [1.12, 0.62, 0.9],
  },
  {
    id: 'chair',
    name: '日晒海玻璃',
    x: -10.4,
    z: 25.2,
    color: '#d99a72',
    scale: [0.9, 0.56, 1.24],
  },
  {
    id: 'boat',
    name: '船痕海玻璃',
    x: 18.4,
    z: 17.1,
    color: '#6ba4ae',
    scale: [1.22, 0.52, 0.78],
  },
  {
    id: 'dunes',
    name: '沙丘海玻璃',
    x: 29.5,
    z: 37.4,
    color: '#a7bc79',
    scale: [0.82, 0.62, 1.26],
  },
];

if (DISCOVERY_SITES.length !== DISCOVERY_SITE_COUNT) {
  throw new Error('Discovery resource profile does not match the authored sites.');
}

function getAttributeBytes(attribute) {
  return attribute?.array?.byteLength ?? 0;
}

function getGeometryBytes(geometry) {
  if (!geometry) return 0;
  const attributeBytes = Object.values(geometry.attributes).reduce(
    (total, attribute) => total + getAttributeBytes(attribute),
    0,
  );
  return attributeBytes + (geometry.index?.array?.byteLength ?? 0);
}

function createGlowMaterial(pixelRatio) {
  return new THREE.ShaderMaterial({
    name: 'TidelineDiscoveryGlow',
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: pixelRatio },
      uIntensity: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uPixelRatio;
      attribute float aPhase;
      attribute float aVisible;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vColor = color;
        float pulse = 0.5 + 0.5 * sin(uTime * 2.1 + aPhase);
        vAlpha = aVisible * (0.58 + pulse * 0.42);
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        float perspective = 38.0 / max(1.0, -viewPosition.z);
        gl_PointSize = clamp(
          (13.0 + pulse * 4.0) * uPixelRatio * perspective,
          2.0,
          34.0 * uPixelRatio
        );
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uIntensity;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec2 centered = gl_PointCoord - 0.5;
        float radius = length(centered) * 2.0;
        float core = 1.0 - smoothstep(0.0, 0.22, radius);
        float halo = 1.0 - smoothstep(0.12, 1.0, radius);
        float alpha = (core * 0.72 + halo * 0.32) * vAlpha * uIntensity;
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(vColor * (0.72 + core * 0.8), alpha);
      }
    `,
  });
}

function isEditableTarget(target) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(target.tagName))
  );
}

/**
 * A small exploration loop kept separate from world construction. The glass
 * pieces use one InstancedMesh and one Points draw, while raycasting targets the
 * point buffer so the interaction radius can stay usable at wide camera views.
 */
export class BeachDiscoveryGame extends EventTarget {
  constructor({ scene, camera, domElement, quality = 'high', world = null }) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.domElement = domElement;
    this.quality = quality;
    this.world = world;
    let storage = null;
    try { storage = globalThis.localStorage; } catch { /* Storage is optional. */ }
    this.campaign = new CollectionCampaign(DISCOVERY_SITES, storage);
    this.enabled = false;
    this.cameraMode = 'orbit';
    this.freeInteractive = false;
    this.focusedIndex = -1;
    this.collectedCount = 0;
    this.pointerInside = false;
    this.pointer = new THREE.Vector2();
    this.pointerDown = null;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Points.threshold = 0.72;
    this.eventController = new AbortController();

    this.matrix = new THREE.Matrix4();
    this.quaternion = new THREE.Quaternion();
    this.position = new THREE.Vector3();
    this.scale = new THREE.Vector3();
    this.euler = new THREE.Euler();

    this.group = new THREE.Group();
    this.group.name = 'TideTraceDiscovery';
    this.group.visible = false;
    this.initialized = false;
    this.allocations = 0;
    this.releases = 0;
    this.glass = null;
    this.glows = null;
    this.glowMaterial = null;
    this.loadChapter();
    this.bindEvents();
  }

  loadChapter() {
    this.items = this.campaign.sites[this.campaign.chapter].map((site, index) => ({
      ...site,
      index,
      position: new THREE.Vector3(
        site.x,
        terrainHeight(site.x, site.z) + 0.2,
        site.z,
      ),
      collected: this.campaign.found.has(site.id),
      animation: this.campaign.found.has(site.id) ? 0 : 1,
      phase: index * 1.71 + 0.4,
    }));
    this.collectedCount = this.items.filter(item => item.collected).length;
  }

  createVisuals() {
    if (this.initialized) return false;

    const kind = this.items[0].kind;
    let geometry;
    if (kind === 'shell') {
      geometry = new THREE.SphereGeometry(.3, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      const p = geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const angle = Math.atan2(p.getZ(i), p.getX(i));
        const rib = 1 + Math.cos(angle * 12) * .055;
        p.setXYZ(i, p.getX(i) * rib, p.getY(i) * .38, p.getZ(i) * rib * 1.1);
      }
      geometry.computeVertexNormals();
    } else if (kind === 'bottle') {
      geometry = new THREE.LatheGeometry([[.001, -.27], [.12, -.27], [.13, -.23], [.13, .13], [.065, .20], [.05, .22], [.05, .31], [.001, .31]]
        .map(p => new THREE.Vector2(...p)), 16);
    } else geometry = new THREE.IcosahedronGeometry(0.24, 1);
    const material = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: kind === 'shell' ? .75 : .32,
      metalness: 0,
      clearcoat: kind === 'glass' ? 1 : .15,
      clearcoatRoughness: 0.14,
      ior: 1.42,
      specularIntensity: 0.9,
      emissive: new THREE.Color('#163f3d'),
      emissiveIntensity: 0.14,
      transparent: true,
      opacity: 0.92,
      vertexColors: true,
    });
    this.glass = new THREE.InstancedMesh(
      geometry,
      material,
      DISCOVERY_SITES.length,
    );
    this.glass.name = 'InstancedSeaGlass';
    this.glass.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.glass.castShadow = true;
    this.glass.receiveShadow = true;

    const pointPositions = new Float32Array(DISCOVERY_SITES.length * 3);
    const pointColors = new Float32Array(DISCOVERY_SITES.length * 3);
    const phases = new Float32Array(DISCOVERY_SITES.length);
    const visible = new Float32Array(DISCOVERY_SITES.length);
    const color = new THREE.Color();
    this.items.forEach((item, index) => {
      pointPositions.set(
        [item.position.x, item.position.y + 0.32, item.position.z],
        index * 3,
      );
      color.set(item.color);
      pointColors.set([color.r, color.g, color.b], index * 3);
      phases[index] = item.phase;
      visible[index] = this.items[index].collected ? 0 : 1;
      this.glass.setColorAt(index, color);
    });
    this.glass.instanceColor.needsUpdate = true;
    this.group.add(this.glass);

    const glowGeometry = new THREE.BufferGeometry();
    glowGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(pointPositions, 3),
    );
    glowGeometry.setAttribute('color', new THREE.BufferAttribute(pointColors, 3));
    glowGeometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    glowGeometry.setAttribute('aVisible', new THREE.BufferAttribute(visible, 1));
    this.glowMaterial = createGlowMaterial(
      Math.min(window.devicePixelRatio || 1, 1.75),
    );
    this.glows = new THREE.Points(glowGeometry, this.glowMaterial);
    this.glows.name = 'SeaGlassDiscoveryGlows';
    this.glows.frustumCulled = false;
    this.group.add(this.glows);

    this.scene.add(this.group);
    this.group.visible = this.enabled;
    this.initialized = true;
    this.allocations += 1;
    this.updateInstanceMatrices(0);
    this.setQuality(this.quality);
    return true;
  }

  releaseVisuals() {
    if (!this.initialized) return false;

    this.glass.dispose();
    this.glass.geometry.dispose();
    this.glass.material.dispose();
    this.glows.geometry.dispose();
    this.glowMaterial.dispose();
    this.group.clear();
    this.group.removeFromParent();
    this.glass = null;
    this.glows = null;
    this.glowMaterial = null;
    this.initialized = false;
    this.releases += 1;
    return true;
  }

  bindEvents() {
    const options = { signal: this.eventController.signal };
    this.domElement.addEventListener(
      'pointerdown',
      (event) => {
        if (!this.enabled || this.cameraMode !== 'orbit') return;
        if (event.button !== 0 || document.querySelector?.('dialog[open]')) return;
        this.pointerDown = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
        };
      },
      options,
    );
    this.domElement.addEventListener(
      'pointercancel', () => { this.pointerDown = null; }, options,
    );
    this.domElement.addEventListener(
      'pointermove',
      (event) => {
        if (!this.enabled || this.cameraMode !== 'orbit') return;
        this.pointerInside = true;
        this.updatePointer(event);
      },
      options,
    );
    this.domElement.addEventListener(
      'pointerleave',
      () => {
        this.pointerInside = false;
        if (this.cameraMode === 'orbit') this.setFocusedIndex(-1);
      },
      options,
    );
    this.domElement.addEventListener(
      'pointerup',
      (event) => {
        if (!this.enabled || this.cameraMode !== 'orbit') return;
        const start = this.pointerDown;
        this.pointerDown = null;
        if (!start || start.id !== event.pointerId) return;
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) {
          return;
        }
        this.pointerInside = true;
        this.updatePointer(event);
        this.updateFocus();
        if (this.focusedIndex >= 0) this.collect(this.focusedIndex, 'pointer');
      },
      options,
    );
    document.addEventListener(
      'keydown',
      (event) => {
        if (
          !this.enabled ||
          this.cameraMode === 'orbit' ||
          !this.freeInteractive ||
          event.repeat ||
          document.querySelector?.('dialog[open]') ||
          isEditableTarget(event.target) ||
          event.code !== 'KeyE'
        ) {
          return;
        }
        if (this.focusedIndex >= 0) {
          event.preventDefault();
          this.collect(this.focusedIndex, 'keyboard');
        }
      },
      options,
    );
  }

  updatePointer(event) {
    const bounds = this.domElement.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
  }

  updateFocus() {
    if (!this.enabled || !this.initialized || document.querySelector?.('dialog[open]')) {
      this.setFocusedIndex(-1);
      return;
    }
    if (this.cameraMode !== 'orbit') {
      if (!this.freeInteractive) {
        this.setFocusedIndex(-1);
        return;
      }
      this.pointer.set(0, 0);
    } else if (!this.pointerInside) {
      this.setFocusedIndex(-1);
      return;
    }

    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersections = this.raycaster.intersectObject(this.glows, false);
    const maximumDistance = this.cameraMode !== 'orbit' ? 5.5 : Infinity;
    const match = intersections.find(
      ({ index, distance }) =>
        index !== undefined &&
        this.isAvailable(this.items[index]) &&
        distance <= maximumDistance,
    );
    let blocked = false;
    if (match && this.world?.root) {
      blocked = this.raycaster.intersectObject(this.world.root, true).some(hit => {
        if (hit.distance >= match.distance - .55 || hit.object.material?.transparent) return false;
        for (let o = hit.object; o; o = o.parent) if (!o.visible) return false;
        return true;
      });
    }
    this.setFocusedIndex(!blocked ? match?.index ?? -1 : -1);
  }

  setFocusedIndex(index) {
    if (index === this.focusedIndex) return;
    this.focusedIndex = index;
    const item = index >= 0 ? this.items[index] : null;
    this.domElement.classList.toggle(
      'is-discovery-target',
      Boolean(item) && this.cameraMode === 'orbit',
    );
    this.dispatchEvent(
      new CustomEvent('focuschange', {
        detail: {
          focused: Boolean(item),
          id: item?.id ?? null,
          name: item?.name ?? '',
          input: this.cameraMode !== 'orbit' ? 'keyboard' : 'pointer',
        },
      }),
    );
  }

  collect(index, source = 'api') {
    const item = this.items[index];
    if (!this.enabled || !item || !this.campaign.collect(index, this.tideLevel ?? 0)) return false;

    item.collected = true;
    item.animation = 1;
    this.collectedCount += 1;
    if (this.focusedIndex === index) this.setFocusedIndex(-1);

    const detail = {
      index,
      id: item.id,
      name: item.name,
      source,
      collected: this.collectedCount,
      total: this.items.length,
      ...this.campaign.getState(),
    };
    this.dispatchEvent(new CustomEvent('discover', { detail }));
    this.dispatchProgress();
    if (detail.completed) {
      this.dispatchEvent(new CustomEvent('complete', { detail }));
    }
    return true;
  }

  restoreGlow(item) {
    if (!this.glows) return;
    const positions = this.glows.geometry.attributes.position;
    const visibility = this.glows.geometry.attributes.aVisible;
    positions.setXYZ(
      item.index,
      item.position.x,
      item.position.y + 0.32,
      item.position.z,
    );
    visibility.setX(item.index, 1);
    positions.needsUpdate = true;
    visibility.needsUpdate = true;
  }

  dispatchProgress() {
    this.dispatchEvent(
      new CustomEvent('progresschange', {
        detail: this.campaign.getState(),
      }),
    );
  }

  reset() {
    const initialized = this.initialized;
    this.releaseVisuals();
    this.campaign.reset(); this.loadChapter();
    if (initialized) this.createVisuals();
    this.collectedCount = 0;
    this.setFocusedIndex(-1);
    for (const item of this.items) {
      item.collected = false;
      item.animation = 1;
      this.restoreGlow(item);
    }
    if (this.initialized) this.updateInstanceMatrices(0);
    this.dispatchEvent(new Event('reset'));
    this.dispatchProgress();
  }

  nextChapter() {
    if (!this.campaign.next()) return false;
    this.setFocusedIndex(-1);
    const initialized = this.initialized;
    this.releaseVisuals(); this.loadChapter();
    if (initialized) this.createVisuals();
    this.dispatchProgress(); return true;
  }

  sellItems(kind = 'all') {
    const transaction = this.campaign.sell(kind);
    if (transaction) this.dispatchProgress();
    return transaction;
  }

  buyProduct(id) {
    const transaction = this.campaign.buy(id);
    if (transaction) this.dispatchProgress();
    return transaction;
  }

  isAvailable(item) {
    return item && !item.collected && (!item.lowTide || (this.tideLevel ?? 0) <= -.22);
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (this.enabled) this.createVisuals();
    this.group.visible = this.enabled;
    if (!this.enabled) this.setFocusedIndex(-1);
    if (this.enabled) this.dispatchProgress();
  }

  setCameraState(mode, interactive = false) {
    this.cameraMode = mode;
    this.freeInteractive = mode !== 'orbit' && Boolean(interactive);
    this.pointerInside = mode !== 'orbit' ? true : this.pointerInside;
    this.setFocusedIndex(-1);
  }

  setQuality(quality) {
    this.quality = quality;
    if (!this.initialized) return;
    this.glowMaterial.uniforms.uPixelRatio.value = Math.min(
      window.devicePixelRatio || 1,
      quality === 'high' ? 1.75 : 1,
    );
    this.glowMaterial.uniforms.uIntensity.value = quality === 'high' ? 1 : 0.78;
    this.glass.castShadow = quality === 'high';
  }

  updateInstanceMatrices(elapsed) {
    if (!this.glass) return;
    for (const item of this.items) {
      const focusScale = item.index === this.focusedIndex
        ? 1.16 + Math.sin(elapsed * 5.2) * 0.04
        : 1;
      const visibleScale = item.collected ? item.animation : this.isAvailable(item) ? 1 : 0;
      this.position.copy(item.position);
      this.position.y += Math.sin(elapsed * 1.25 + item.phase) * 0.018;
      if (item.collected) this.position.y += (1 - item.animation) * 0.52;
      this.euler.set(
        -0.18 + Math.sin(item.phase) * 0.1,
        item.phase + elapsed * 0.08,
        0.12 + Math.cos(item.phase) * 0.08,
      );
      this.quaternion.setFromEuler(this.euler);
      this.scale
        .fromArray(item.scale)
        .multiplyScalar(focusScale * visibleScale);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      this.glass.setMatrixAt(item.index, this.matrix);
    }
    this.glass.instanceMatrix.needsUpdate = true;
  }

  update(delta, elapsed, atmosphere = { night: 0 }) {
    if (!this.enabled || !this.initialized) return;
    const tideLevel = this.world?.getTideState().level ?? 0;
    const changed = ((this.tideLevel ?? 0) <= -.22) !== (tideLevel <= -.22);
    this.tideLevel = tideLevel;
    for (const item of this.items) {
      if (!item.collected) this.glows.geometry.attributes.aVisible.setX(item.index, this.isAvailable(item) ? 1 : 0);
    }
    this.glows.geometry.attributes.aVisible.needsUpdate = true;
    if (changed) this.dispatchProgress();
    this.glowMaterial.uniforms.uTime.value = elapsed;
    this.glowMaterial.uniforms.uIntensity.value =
      (this.quality === 'high' ? 1 : 0.78) * (1 + atmosphere.night * 0.28);
    this.glass.material.emissiveIntensity = 0.14 + atmosphere.night * 0.2;

    let animating = false;
    let glowChanged = false;
    const glowPositions = this.glows.geometry.attributes.position;
    const glowVisibility = this.glows.geometry.attributes.aVisible;
    for (const item of this.items) {
      if (!item.collected || item.animation <= 0) continue;
      item.animation = Math.max(0, item.animation - delta * 2.8);
      if (item.animation > 0) {
        glowPositions.setXYZ(
          item.index,
          item.position.x,
          item.position.y + 0.32 + (1 - item.animation) * 0.7,
          item.position.z,
        );
        glowVisibility.setX(item.index, item.animation * item.animation);
      } else {
        glowPositions.setXYZ(item.index, 0, -1000, 0);
        glowVisibility.setX(item.index, 0);
      }
      glowChanged = true;
      animating = true;
    }
    if (glowChanged) {
      glowPositions.needsUpdate = true;
      glowVisibility.needsUpdate = true;
    }
    this.updateFocus();
    this.updateInstanceMatrices(elapsed);
    if (animating) this.glass.computeBoundingSphere();
  }

  getDebugState() {
    const profile = getDiscoveryResourceProfile(this.items[0].kind);
    const glassGeometryBytes = getGeometryBytes(this.glass?.geometry);
    const instanceMatrixBytes = getAttributeBytes(this.glass?.instanceMatrix);
    const instanceColorBytes = getAttributeBytes(this.glass?.instanceColor);
    const glowAttributeBytes = getGeometryBytes(this.glows?.geometry);
    const residentAttributeBytes =
      glassGeometryBytes +
      instanceMatrixBytes +
      instanceColorBytes +
      glowAttributeBytes;
    const inScene = this.group.parent === this.scene;
    return {
      enabled: this.enabled,
      initialized: this.initialized,
      allocations: this.allocations,
      releases: this.releases,
      residentAttributeBytes,
      plannedAttributeBytes: profile.totalAttributeBytes,
      glassGeometryBytes,
      instanceMatrixBytes,
      instanceColorBytes,
      glowAttributeBytes,
      objectsInScene: inScene ? 3 : 0,
      resourcesLinked: Boolean(
        this.initialized &&
          inScene &&
          this.glass?.parent === this.group &&
          this.glows?.parent === this.group &&
          this.glowMaterial === this.glows?.material,
      ),
      groupUuid: this.group.uuid,
      glassUuid: this.glass?.uuid ?? null,
      glowUuid: this.glows?.uuid ?? null,
      total: this.items.length,
      collected: this.collectedCount,
      remaining: this.items.length - this.collectedCount,
      ...this.campaign.getState(),
      tideLevel: this.tideLevel ?? 0,
      focusedIndex: this.focusedIndex,
      drawObjects: this.enabled && this.initialized ? 2 : 0,
      sites: this.items.map((item) => ({
        id: item.id,
        name: item.name,
        collected: item.collected,
        available: this.isAvailable(item),
        clue: item.clue,
        position: item.position
          .toArray()
          .map((value) => Number(value.toFixed(3))),
      })),
    };
  }

  dispose() {
    this.eventController.abort();
    this.domElement.classList.remove('is-discovery-target');
    this.enabled = false;
    this.releaseVisuals();
  }
}

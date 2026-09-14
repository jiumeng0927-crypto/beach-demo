import * as THREE from 'three';

import {
  COASTAL_WIND_BASE_DRIFT_X,
  COASTAL_WIND_BASE_DRIFT_Z,
} from './CoastalWind.js';
import {
  getRainGpuAttributeByteCount,
  getRainQualityProfile,
  getRainResidentByteCount,
  getRainResidentFloatCount,
  RAIN_POSITION_FLOATS_PER_DROP,
  RAIN_SEGMENTS_PER_DROP,
} from './RainQuality.js';
import { terrainHeight } from './world.js';

const FLOATS_PER_DROP = RAIN_POSITION_FLOATS_PER_DROP;
const CONTACT_CHECK_HEIGHT = 4.25;

export class RainSystem {
  constructor({ scene, camera, quality = 'high' }) {
    this.scene = scene;
    this.camera = camera;
    this.enabled = false;
    this.windFactor = 1;
    this.seed = 0x71d3a5c9;
    this.updateCount = 0;
    this.allocationCount = 0;
    this.releaseCount = 0;
    this.lines = null;
    this.positions = null;
    this.speeds = null;
    this.lengths = null;
    this.splashAges = null;
    this.splashPositions = null;
    this.activeSplashCount = 0;
    this.impactCount = 0;
    this.positionAttribute = null;
    this.applyProfile(getRainQualityProfile(quality));
  }

  random() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 0x100000000;
  }

  applyProfile(profile) {
    this.quality = profile.quality;
    this.count = profile.count;
    this.radius = profile.radius;
    this.splashDuration = profile.splashDuration;
    this.opacity = profile.opacity;
  }

  build() {
    this.releaseResources();
    this.positions = new Float32Array(this.count * FLOATS_PER_DROP);
    this.speeds = new Float32Array(this.count);
    this.lengths = new Float32Array(this.count);
    this.splashAges = new Float32Array(this.count);
    this.splashAges.fill(-1);
    this.splashPositions = new Float32Array(this.count * 3);
    this.activeSplashCount = 0;
    this.impactCount = 0;
    const colors = new Float32Array(this.count * FLOATS_PER_DROP);

    for (let index = 0; index < this.count; index += 1) {
      const base = index * FLOATS_PER_DROP;
      colors.set([
        0.38, 0.56, 0.64,
        0.78, 0.9, 0.96,
        0.7, 0.88, 0.94,
        0.7, 0.88, 0.94,
        0.64, 0.82, 0.9,
        0.64, 0.82, 0.9,
      ], base);
      this.collapseSplash(index);
    }

    const geometry = new THREE.BufferGeometry();
    this.positionAttribute = new THREE.BufferAttribute(this.positions, 3);
    this.positionAttribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.positionAttribute);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.LineBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      opacity: this.opacity,
      depthTest: true,
      depthWrite: false,
      fog: true,
      toneMapped: false,
    });

    this.lines = new THREE.LineSegments(geometry, material);
    this.lines.name = 'LocalRainVolume';
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 8;
    this.lines.visible = this.enabled;
    this.scene.add(this.lines);
    this.allocationCount += 1;
  }

  releaseResources() {
    const hadResources = Boolean(
      this.lines ||
        this.positions ||
        this.speeds ||
        this.lengths ||
        this.splashAges ||
        this.splashPositions,
    );
    if (!hadResources) return false;

    this.lines?.removeFromParent();
    this.lines?.geometry.dispose();
    this.lines?.material.dispose();
    this.lines = null;
    this.positions = null;
    this.speeds = null;
    this.lengths = null;
    this.splashAges = null;
    this.splashPositions = null;
    this.positionAttribute = null;
    this.activeSplashCount = 0;
    this.impactCount = 0;
    this.releaseCount += 1;
    return true;
  }

  ensureResources() {
    if (!this.lines) this.build();
    return this.lines;
  }

  setQuality(quality) {
    const profile = getRainQualityProfile(quality);
    if (profile.quality === this.quality) return this.getDebugState();

    const hadResources = Boolean(this.lines);
    this.applyProfile(profile);
    if (hadResources) {
      this.releaseResources();
      if (this.enabled) {
        this.build();
        this.resetAll();
      }
    }
    return this.getDebugState();
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (this.enabled) {
      this.ensureResources();
      this.lines.visible = true;
      this.resetAll();
    } else {
      if (this.lines) this.lines.visible = false;
      this.clearAllSplashes();
    }
    return this.getDebugState();
  }

  setWindFactor(value) {
    const number = Number(value);
    if (Number.isFinite(number)) {
      this.windFactor = Math.min(2, Math.max(0, number));
    }
    return this.windFactor;
  }

  resetAll() {
    this.seed = 0x71d3a5c9;
    this.clearAllSplashes();
    this.impactCount = 0;
    for (let index = 0; index < this.count; index += 1) {
      this.resetDrop(index, true);
    }
    this.positionAttribute.needsUpdate = true;
  }

  resetDrop(index, spreadVertically = false) {
    const x = this.camera.position.x + (this.random() * 2 - 1) * this.radius;
    const z = this.camera.position.z + (this.random() * 2 - 1) * this.radius;
    const y = spreadVertically
      ? Math.max(1, this.camera.position.y - 10) + this.random() * 24
      : this.camera.position.y + 10 + this.random() * 9;
    this.speeds[index] = 13 + this.random() * 11;
    this.lengths[index] = 0.7 + this.random() * 1.25;
    this.writeDrop(index, x, y, z);
  }

  writeDrop(index, x, y, z) {
    const base = index * FLOATS_PER_DROP;
    const length = this.lengths[index];
    const speed = this.speeds[index];
    this.positions[base] = x;
    this.positions[base + 1] = y;
    this.positions[base + 2] = z;
    const driftX = COASTAL_WIND_BASE_DRIFT_X * this.windFactor;
    const driftZ = COASTAL_WIND_BASE_DRIFT_Z * this.windFactor;
    this.positions[base + 3] = x - (driftX / speed) * length;
    this.positions[base + 4] = y + length;
    this.positions[base + 5] = z - (driftZ / speed) * length;
  }

  collapseSplash(index) {
    const base = index * FLOATS_PER_DROP + 6;
    for (let offset = 0; offset < 12; offset += 3) {
      this.positions[base + offset] = 0;
      this.positions[base + offset + 1] = -100;
      this.positions[base + offset + 2] = 0;
    }
  }

  clearAllSplashes() {
    if (!this.splashAges) return;
    this.splashAges.fill(-1);
    this.activeSplashCount = 0;
    for (let index = 0; index < this.count; index += 1) {
      this.collapseSplash(index);
    }
    if (this.positionAttribute) this.positionAttribute.needsUpdate = true;
  }

  startSplash(index, x, y, z) {
    const positionBase = index * 3;
    this.splashPositions[positionBase] = x;
    this.splashPositions[positionBase + 1] = y + 0.025;
    this.splashPositions[positionBase + 2] = z;
    this.splashAges[index] = 0;
    this.impactCount += 1;
  }

  writeSplash(index, progress) {
    const positionBase = index * 3;
    const x = this.splashPositions[positionBase];
    const y = this.splashPositions[positionBase + 1];
    const z = this.splashPositions[positionBase + 2];
    const pulse = Math.sin(progress * Math.PI);
    const variation = 0.86 + (index % 9) * 0.025;
    const radius = (0.02 + pulse * 0.3) * variation;
    const liftedY = y + pulse * 0.14;
    const angle = index * 2.399963;
    const leftAngle = angle - 0.68;
    const rightAngle = angle + 0.68;
    const base = index * FLOATS_PER_DROP + 6;

    this.positions.set([
      x, y, z,
      x + Math.cos(leftAngle) * radius, liftedY, z + Math.sin(leftAngle) * radius,
      x, y, z,
      x + Math.cos(rightAngle) * radius, liftedY, z + Math.sin(rightAngle) * radius,
    ], base);
  }

  update(delta, waterHeight = 0) {
    if (!this.enabled || !this.lines) return;

    const cameraX = this.camera.position.x;
    const cameraZ = this.camera.position.z;
    const driftX = COASTAL_WIND_BASE_DRIFT_X * this.windFactor;
    const driftZ = COASTAL_WIND_BASE_DRIFT_Z * this.windFactor;
    const diameter = this.radius * 2;
    const contactCeiling = Math.max(waterHeight + 0.08, CONTACT_CHECK_HEIGHT);
    let activeSplashes = 0;

    for (let index = 0; index < this.count; index += 1) {
      const base = index * FLOATS_PER_DROP;
      let x = this.positions[base] + driftX * delta;
      let y = this.positions[base + 1] - this.speeds[index] * delta;
      let z = this.positions[base + 2] + driftZ * delta;

      if (x < cameraX - this.radius) x += diameter;
      else if (x > cameraX + this.radius) x -= diameter;
      if (z < cameraZ - this.radius) z += diameter;
      else if (z > cameraZ + this.radius) z -= diameter;

      const surface = y <= contactCeiling
        ? Math.max(waterHeight + 0.08, terrainHeight(x, z) + 0.04)
        : Number.NEGATIVE_INFINITY;
      if (y <= surface) {
        this.startSplash(index, x, surface, z);
        this.resetDrop(index, false);
      } else {
        this.writeDrop(index, x, y, z);
      }

      const splashAge = this.splashAges[index];
      if (splashAge >= 0) {
        const nextAge = splashAge + delta;
        if (nextAge >= this.splashDuration) {
          this.splashAges[index] = -1;
          this.collapseSplash(index);
        } else {
          this.splashAges[index] = nextAge;
          this.writeSplash(index, nextAge / this.splashDuration);
          activeSplashes += 1;
        }
      }
    }

    this.activeSplashCount = activeSplashes;
    this.positionAttribute.needsUpdate = true;
    this.updateCount += 1;
  }

  getDebugState() {
    const initialized = Boolean(this.lines);
    return {
      enabled: this.enabled,
      visible: Boolean(this.lines?.visible),
      initialized,
      quality: this.quality,
      drops: this.count ?? 0,
      drawObjects: this.enabled && initialized ? 1 : 0,
      segmentsPerDrop: RAIN_SEGMENTS_PER_DROP,
      splashCapacity: (this.count ?? 0) * 2,
      activeSplashes: this.enabled ? this.activeSplashCount : 0,
      impacts: this.enabled ? this.impactCount : 0,
      updates: this.updateCount,
      allocations: this.allocationCount,
      releases: this.releaseCount,
      residentFloats: initialized ? getRainResidentFloatCount(this.quality) : 0,
      residentBytes: initialized ? getRainResidentByteCount(this.quality) : 0,
      gpuAttributeBytes: initialized
        ? getRainGpuAttributeByteCount(this.quality)
        : 0,
      plannedResidentBytes: getRainResidentByteCount(this.quality),
      resourcesLinked: Boolean(
        this.lines?.parent === this.scene &&
          this.lines.geometry.getAttribute('position') === this.positionAttribute &&
          this.positionAttribute?.array === this.positions,
      ),
      windFactor: Number(this.windFactor.toFixed(3)),
      driftX: Number(
        (COASTAL_WIND_BASE_DRIFT_X * this.windFactor).toFixed(3),
      ),
      driftZ: Number(
        (COASTAL_WIND_BASE_DRIFT_Z * this.windFactor).toFixed(3),
      ),
    };
  }

  dispose() {
    this.enabled = false;
    this.releaseResources();
  }
}

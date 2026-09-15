import * as THREE from 'three';
import { addCoastalSurfaceDetail, COASTAL_PALETTE as palette } from './CoastalStyle.js';
import { BEACH_WALK_ROUTE, distanceToBeachWalk } from './CoastalLayout.js';
import { createCoastalGulls } from './CoastalGulls.js';
import { createCoastContinuation } from './CoastBoundary.js';
import { createCoastalStreet } from './CoastalStreet.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import {
  mergeGeometries,
  mergeVertices,
} from 'three/addons/utils/BufferGeometryUtils.js';

import {
  createDuneGrassMaterial,
  createFoliageMaterial,
  createFoamMaterial,
  createRockMaterial,
  createSandMaterial,
  createWoodMaterial,
} from './shaders.js';
import {
  ATMOSPHERE_VISIBILITY_THRESHOLD,
  hasVisibleAtmosphereContribution,
} from './AtmosphereVisibility.js';

const BASE_SHORELINE_Z = 5.5;
const BASE_FOAM_Z = 5.6;
const BASE_WALK_BOUNDARY_Z = 3.7;

// A seeded generator makes procedural placement reproducible across reloads,
// screenshots and future refactors.
function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function smoothstep(min, max, value) {
  const normalized = THREE.MathUtils.clamp((value - min) / (max - min), 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

function mergeAndDispose(geometries) {
  const merged = mergeGeometries(geometries, false);
  geometries.forEach((geometry) => geometry.dispose());
  return merged;
}

function createBeveledTimber(width, height, depth, bevel) {
  const half = [width / 2, height / 2, depth / 2];
  const radius = Math.min(bevel, ...half) * 0.98;
  const points = [];
  // Three inset points per corner form 6 faces, 12 chamfers and 8 corner triangles.
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
    const signs = [x, y, z];
    for (let axis = 0; axis < 3; axis++) points.push(new THREE.Vector3(...half.map((h, i) =>
      signs[i] * (h - (i === axis ? 0 : radius)))));
  }
  const source = new ConvexGeometry(points), p = source.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i) / width + 0.5; uv[i * 2 + 1] = p.getY(i) / height + 0.5; }
  source.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const result = mergeVertices(source);
  source.dispose();
  return result;
}

/**
 * Analytic height field shared by the beach vertices and object placement.
 * Keeping one source of truth prevents props from floating above the sand.
 */
export function terrainHeight(x, z) {
  const shoreRise = smoothstep(2, 82, z) * 1.55;
  const broadUndulation =
    Math.sin(x * 0.065 + z * 0.025) * 0.22 +
    Math.sin(z * 0.085 - x * 0.018) * 0.16;
  const duneMask = smoothstep(42, 98, z);
  const dunes =
    duneMask *
    (0.72 +
      Math.sin(x * 0.075 + z * 0.035) * 0.68 +
      Math.sin(x * 0.19 - z * 0.024) * 0.2);
  const shoreRipple =
    (1 - smoothstep(12, 40, z)) *
    Math.sin(z * 0.85 + x * 0.14) *
    0.045;

  return -0.22 + shoreRise + broadUndulation + dunes + shoreRipple;
}

function cameraOverlapsCollider(position, collider, eyeHeight) {
  const feetY = position.y - eyeHeight;
  return position.y >= collider.minY && feetY <= collider.maxY;
}

function resolveCircleCollider(
  position,
  previousPosition,
  collider,
  cameraRadius,
) {
  const minimumDistance = collider.radius + cameraRadius;
  let deltaX = position.x - collider.x;
  let deltaZ = position.z - collider.z;
  let distance = Math.hypot(deltaX, deltaZ);
  if (distance >= minimumDistance) return null;
  const overlapDistance = distance;

  // An exact center overlap has no usable normal, so the previous frame picks
  // the nearest stable escape direction instead of introducing random motion.
  if (distance < 0.0001) {
    deltaX = previousPosition.x - collider.x;
    deltaZ = previousPosition.z - collider.z;
    distance = Math.hypot(deltaX, deltaZ);
  }
  const normalX = distance > 0.0001 ? deltaX / distance : 1;
  const normalZ = distance > 0.0001 ? deltaZ / distance : 0;
  const correction = minimumDistance - overlapDistance;
  position.x += normalX * correction;
  position.z += normalZ * correction;
  return { x: normalX, z: normalZ };
}

function resolveBoxCollider(
  position,
  previousPosition,
  collider,
  cameraRadius,
) {
  const cosine = Math.cos(collider.rotation);
  const sine = Math.sin(collider.rotation);
  const deltaX = position.x - collider.x;
  const deltaZ = position.z - collider.z;
  const localX = cosine * deltaX - sine * deltaZ;
  const localZ = sine * deltaX + cosine * deltaZ;
  const extentX = collider.halfX + cameraRadius;
  const extentZ = collider.halfZ + cameraRadius;
  const penetrationX = extentX - Math.abs(localX);
  const penetrationZ = extentZ - Math.abs(localZ);
  if (penetrationX <= 0 || penetrationZ <= 0) return null;

  const previousDeltaX = previousPosition.x - collider.x;
  const previousDeltaZ = previousPosition.z - collider.z;
  const previousLocalX = cosine * previousDeltaX - sine * previousDeltaZ;
  const previousLocalZ = sine * previousDeltaX + cosine * previousDeltaZ;
  let normalX;
  let normalZ;
  let correction;

  if (penetrationX < penetrationZ) {
    const sign = Math.sign(localX || previousLocalX || 1);
    normalX = cosine * sign;
    normalZ = -sine * sign;
    correction = penetrationX;
  } else {
    const sign = Math.sign(localZ || previousLocalZ || 1);
    normalX = sine * sign;
    normalZ = cosine * sign;
    correction = penetrationZ;
  }

  position.x += normalX * correction;
  position.z += normalZ * correction;
  return { x: normalX, z: normalZ };
}

function resolveCameraCollisions(
  colliders,
  position,
  { previousPosition, radius, eyeHeight },
) {
  let collided = false;
  let normalX = 0;
  let normalZ = 0;
  let names = null;

  // Two inexpensive passes resolve corners where two authored volumes touch.
  // The list is tiny and static, so this remains cheaper than mesh raycasts.
  for (let pass = 0; pass < 2; pass += 1) {
    let correctedThisPass = false;
    for (const collider of colliders) {
      if (!cameraOverlapsCollider(position, collider, eyeHeight)) continue;
      const normal =
        collider.type === 'box'
          ? resolveBoxCollider(position, previousPosition, collider, radius)
          : resolveCircleCollider(position, previousPosition, collider, radius);
      if (!normal) continue;
      collided = true;
      correctedThisPass = true;
      normalX += normal.x;
      normalZ += normal.z;
      if (!names) names = new Set();
      names.add(collider.name);
    }
    if (!correctedThisPass) break;
  }

  if (!collided) return null;
  const normal = new THREE.Vector3(normalX, 0, normalZ);
  if (normal.lengthSq() < 0.0001) normal.set(1, 0, 0);
  normal.normalize();
  return { collided: true, normal, names: [...names] };
}

function buildBeachGeometry(quality) {
  // The analytic height field is intentionally sampled below screen-pixel
  // density. This preserves dune silhouettes while leaving triangle headroom
  // for interactive props and vegetation.
  const segmentsX = quality === 'high' ? 220 : 150;
  const segmentsZ = quality === 'high' ? 105 : 72;
  // Keep the authored grid unchanged; the outer continuation owns the horizon.
  const geometry = new THREE.PlaneGeometry(260, 120, segmentsX, segmentsZ);
  const positions = geometry.attributes.position;

  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const worldZ = 45 - positions.getY(index);
    positions.setZ(index, terrainHeight(x, worldZ));
  }

  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function buildFoamGeometry(beachGeometry) {
  // Match the beach's vertices AND triangle diagonals. A different height-field
  // tessellation intersects the sand even when each vertex has a small lift.
  const { width, height, widthSegments: segmentsX, heightSegments: segmentsZ } = beachGeometry.parameters;
  const stepZ = height / segmentsZ;
  const rows = Math.ceil(50.6 / stepZ);
  const geometry = new THREE.PlaneGeometry(width, rows * stepZ, segmentsX, rows);
  const positions = geometry.attributes.position;
  const ground = beachGeometry.attributes.position;
  for (let index = 0; index < positions.count; index += 1) {
    positions.setXYZ(index, ground.getX(index), BASE_FOAM_Z - 45 + ground.getY(index), ground.getZ(index) + 0.025);
  }

  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function createRockGeometry(quality) {
  const sourceGeometry = new THREE.IcosahedronGeometry(
    1,
    quality === 'high' ? 2 : 1,
  );
  const geometry = mergeVertices(sourceGeometry, 0.0001);
  sourceGeometry.dispose();
  const positions = geometry.attributes.position;

  // Deform a subdivided sphere once, then reuse it for every rock instance.
  // Instance scaling and rotation provide the larger silhouette variation.
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const y = positions.getY(index);
    const z = positions.getZ(index);
    const radialVariation =
      Math.sin(x * 5.7 + y * 2.9) * Math.sin(z * 4.8 - y * 3.7) * 0.07 +
      Math.sin((x + z) * 11.3) * 0.025;
    const radius = 1 + radialVariation;
    const flattenBase = smoothstep(0.48, 1, -y);
    positions.setXYZ(
      index,
      x * radius,
      THREE.MathUtils.lerp(y * radius, -0.72, flattenBase),
      z * radius,
    );
  }

  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createDuneGrassGeometry(quality) {
  const positions = [];
  const colors = [];
  const rootColor = new THREE.Color('#687345');
  const tipColor = new THREE.Color('#a3ad71');
  const color = new THREE.Color();
  const bladeSpecs = [
    [-0.08, 0.01, 0.92, -0.06, 0.02],
    [0.05, -0.03, 1.08, 0.08, -0.01],
    [-0.02, 0.07, 0.78, 0.03, 0.06],
    [0.1, 0.05, 0.88, -0.02, -0.06],
    [-0.11, -0.06, 0.7, 0.06, 0.03],
  ];

  const addVertex = (x, y, z, t) => {
    positions.push(x, y, z);
    color.copy(rootColor).lerp(tipColor, 0.16 + t * 0.84);
    colors.push(color.r, color.g, color.b);
  };

  bladeSpecs.forEach(([baseX, baseZ, height, bendX, bendZ], bladeIndex) => {
    const angle = bladeIndex * 2.17 + 0.35;
    const sideX = Math.cos(angle);
    const sideZ = Math.sin(angle);
    const levels = quality === 'high' ? [0, 0.38, 0.72, 1] : [0, 0.55, 1];
    const points = levels.map((t) => ({
      ridge: [baseX + bendX * 4.2 * t * t, height * (t - 0.22 * t * t) + .024 * Math.sin(t * Math.PI),
        baseZ + bendZ * 4.2 * t * t],
      left: [
        baseX + bendX * 4.2 * t * t - sideX * (0.038 * (1 - t) + 0.001),
        height * (t - 0.22 * t * t),
        baseZ + bendZ * 4.2 * t * t - sideZ * (0.038 * (1 - t) + 0.001),
      ],
      right: [
        baseX + bendX * 4.2 * t * t + sideX * (0.038 * (1 - t) + 0.001),
        height * (t - 0.22 * t * t),
        baseZ + bendZ * 4.2 * t * t + sideZ * (0.038 * (1 - t) + 0.001),
      ],
    }));

    for (let segment = 0; segment < levels.length - 1; segment += 1) {
      const t0 = levels[segment];
      const t1 = levels[segment + 1];
      const a = points[segment];
      const b = points[segment + 1];
      for (const [left, right] of [['left', 'ridge'], ['ridge', 'right']]) {
        addVertex(...a[left], t0); addVertex(...a[right], t0); addVertex(...b[right], t1);
        addVertex(...a[left], t0); addVertex(...b[right], t1); addVertex(...b[left], t1);
      }
    }
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createRockCluster(
  parent,
  random,
  geometry,
  material,
  x,
  z,
  count,
  spread,
  clusterScale = 1,
  colliders = [],
) {
  const rocks = new THREE.InstancedMesh(geometry, material, count);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const instanceScale = new THREE.Vector3();
  const euler = new THREE.Euler();

  for (let index = 0; index < count; index += 1) {
    const rockX = x + (random() - 0.5) * spread;
    const rockZ = z + (random() - 0.5) * spread * 0.55;
    const size = clusterScale * (0.55 + random() * 1.15);
    instanceScale.set(
      size * (0.85 + random() * 0.7),
      size * (0.48 + random() * 0.65),
      size * (0.72 + random() * 0.55),
    );
    position.set(
      rockX,
      terrainHeight(rockX, rockZ) + instanceScale.y * 0.64,
      rockZ,
    );
    euler.set(random() * 0.7, random() * Math.PI, random() * 0.45);
    quaternion.setFromEuler(euler);
    matrix.compose(position, quaternion, instanceScale);
    rocks.setMatrixAt(index, matrix);

    const colliderRadius = Math.max(instanceScale.x, instanceScale.z) * 0.62;
    if (colliderRadius > 0.58) {
      colliders.push({
        type: 'circle',
        name: 'rock',
        x: rockX,
        z: rockZ,
        radius: colliderRadius,
        minY: terrainHeight(rockX, rockZ) - 0.1,
        maxY: position.y + instanceScale.y * 0.7,
      });
    }
  }

  rocks.name = 'InstancedShoreRocks';
  rocks.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  rocks.instanceMatrix.needsUpdate = true;
  rocks.computeBoundingBox();
  rocks.computeBoundingSphere();
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  parent.add(rocks);
  return rocks;
}

function createPalmFrondGeometry(length, scale, quality) {
  const vertices = [];
  const addTriangle = (a, b, c) => {
    vertices.push(...a, ...b, ...c);
  };
  const segmentCount = quality === 'low' ? 14 : 21;
  const stemHalfWidth = 0.022 * scale;

  for (let index = 0; index < segmentCount; index += 1) {
    const t0 = index / segmentCount;
    const t1 = (index + 1) / segmentCount;
    const y0 = t0 * length;
    const y1 = t1 * length;
    const z0 = (1.2 * t0 * t0 - Math.sin(t0 * Math.PI) * 0.65) * scale;
    const z1 = (1.2 * t1 * t1 - Math.sin(t1 * Math.PI) * 0.65) * scale;
    addTriangle(
      [-stemHalfWidth, y0, z0],
      [stemHalfWidth, y0, z0],
      [stemHalfWidth * (1 - t1 * 0.7), y1, z1],
    );
    addTriangle(
      [-stemHalfWidth, y0, z0],
      [stemHalfWidth * (1 - t1 * 0.7), y1, z1],
      [-stemHalfWidth * (1 - t1 * 0.7), y1, z1],
    );
  }

  for (let index = 1; index < segmentCount; index += 1) {
    const t = index / segmentCount;
    const y = t * length;
    const z = (1.2 * t * t - Math.sin(t * Math.PI) * 0.65) * scale;
    const leafletWidth =
      Math.pow(Math.sin(t * Math.PI), 0.72) * 0.66 * scale;
    const leafletLift = (0.36 - t * 0.1) * scale;
    const baseSpread = 0.12 * scale;

    for (const side of [-1, 1]) {
      const tipZ =
        z +
        (0.16 + Math.sin(index * 1.73 + side) * 0.055) * scale;
      const tipY = y + leafletLift;
      const a = [side * stemHalfWidth, y - baseSpread, z];
      const b = [side * stemHalfWidth, y + baseSpread, z];
      const mid = [side * leafletWidth * .53, y + leafletLift * .48, z - .065 * scale];
      const left = [mid[0], mid[1] - .13 * scale, mid[2] + .035 * scale];
      const right = [mid[0], mid[1] + .15 * scale, mid[2] + .035 * scale];
      const tip = [side * leafletWidth, tipY, tipZ];
      addTriangle(a, left, mid); addTriangle(a, mid, b); addTriangle(b, mid, right);
      addTriangle(left, tip, mid); addTriangle(mid, tip, right);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  const colors = [];
  const rootColor = new THREE.Color('#536c46');
  const tipColor = new THREE.Color('#98aa69');
  const color = new THREE.Color();
  for (let index = 0; index < vertices.length; index += 3) {
    const t = THREE.MathUtils.clamp(vertices[index + 1] / length, 0, 1);
    color.copy(rootColor).lerp(tipColor, 0.18 + t * 0.82);
    color.multiplyScalar(0.92 + Math.sin(t * 17.0) * 0.035);
    colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function createPalm(
  parent,
  random,
  position,
  scale,
  frondInstances,
  trunkInstances,
  coconutInstances,
) {
  const palm = new THREE.Group();
  const trunkHeight = 7.2 * scale;
  const segments = 8;
  const leanX = (random() - 0.5) * 0.8;
  const leanZ = (random() - 0.5) * 0.45;
  const frondStart = frondInstances.length;
  const trunkStart = trunkInstances.length;
  const coconutStart = coconutInstances.length;

  for (let index = 0; index < segments; index += 1) {
    const t = index / segments;
    const start = new THREE.Vector3(leanX * t * t * scale, trunkHeight * t, leanZ * t * t * scale);
    const next = (index + 1) / segments;
    const end = new THREE.Vector3(leanX * next * next * scale, trunkHeight * next, leanZ * next * next * scale);
    const axis = end.clone().sub(start);
    const length = axis.length() + .012;
    const radius = (0.23 - t * 0.055) * scale;
    trunkInstances.push({
      localPosition: start.add(end).multiplyScalar(.5),
      rotation: new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0), axis.normalize())),
      instanceScale: new THREE.Vector3(radius, length, radius),
      parentMatrix: null,
    });
  }

  const crownPosition = new THREE.Vector3(
    leanX * scale,
    trunkHeight,
    leanZ * scale,
  );
  const leafCount = 11;

  for (let index = 0; index < leafCount; index += 1) {
    const length = (3.2 + random() * 1.1) * scale;
    const azimuth = (index / leafCount) * Math.PI * 2 + random() * 0.3;
    const crownPitch =
      index % 4 === 0 ? -0.2 : index % 5 === 0 ? 0.14 : 0;
    frondInstances.push({
      localPosition: crownPosition.clone(),
      rotationX:
        Math.PI * 0.5 +
        crownPitch +
        (random() - 0.5) * 0.3,
      rotationY: azimuth,
      baseRotationZ: (random() - 0.5) * 0.18,
      instanceScale: new THREE.Vector3(scale, length / 4, scale),
      phase: random() * Math.PI * 2,
      amount: 0.018 + random() * 0.018,
      parentMatrix: null,
    });
  }

  for (let index = 0; index < 4; index += 1) {
    const angle = (index / 4) * Math.PI * 2 + random();
    coconutInstances.push({
      localPosition: crownPosition.clone().add(
        new THREE.Vector3(
          Math.cos(angle) * 0.25 * scale,
          -0.22 * scale,
          Math.sin(angle) * 0.25 * scale,
        ),
      ),
      rotation: new THREE.Euler(),
      instanceScale: new THREE.Vector3(
        0.18 * scale,
        0.18 * scale,
        0.18 * scale,
      ),
      parentMatrix: null,
    });
  }

  palm.position.copy(position);
  palm.rotation.y = random() * Math.PI * 2;
  parent.add(palm);
  palm.updateMatrixWorld(true);

  // The descriptors added by this palm need its static world transform. Keeping
  // one matrix reference per instance is cheaper than retaining 115 Object3Ds.
  const parentMatrix = palm.matrixWorld.clone();
  for (let index = frondStart; index < frondInstances.length; index += 1) {
    frondInstances[index].parentMatrix = parentMatrix;
  }
  for (let index = trunkStart; index < trunkInstances.length; index += 1) {
    trunkInstances[index].parentMatrix = parentMatrix;
  }
  for (let index = coconutStart; index < coconutInstances.length; index += 1) {
    coconutInstances[index].parentMatrix = parentMatrix;
  }
  return palm;
}

function createPalmFronds(parent, material, instances, quality) {
  const geometry = createPalmFrondGeometry(4, 1, quality);
  const fronds = new THREE.InstancedMesh(geometry, material, instances.length);
  const localMatrix = new THREE.Matrix4();
  const worldMatrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const rotation = new THREE.Euler(0, 0, 0, 'YXZ');

  const updateMatrices = (windPhase, windFactor = 1) => {
    for (let index = 0; index < instances.length; index += 1) {
      const instance = instances[index];
      rotation.set(
        instance.rotationX,
        instance.rotationY,
        instance.baseRotationZ +
          Math.sin(windPhase * 0.7 + instance.phase) *
            instance.amount *
            windFactor,
        'YXZ',
      );
      quaternion.setFromEuler(rotation);
      localMatrix.compose(
        instance.localPosition,
        quaternion,
        instance.instanceScale,
      );
      worldMatrix.multiplyMatrices(instance.parentMatrix, localMatrix);
      fronds.setMatrixAt(index, worldMatrix);
    }
    fronds.instanceMatrix.needsUpdate = true;
  };

  fronds.name = 'InstancedPalmFronds';
  fronds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  fronds.castShadow = true;
  fronds.receiveShadow = true;
  updateMatrices(0);
  fronds.computeBoundingBox();
  fronds.computeBoundingSphere();
  parent.add(fronds);

  return {
    mesh: fronds,
    count: instances.length,
    update: updateMatrices,
  };
}

function createStaticInstanceBatch(
  parent,
  geometry,
  material,
  instances,
  name,
) {
  const mesh = new THREE.InstancedMesh(geometry, material, instances.length);
  const localMatrix = new THREE.Matrix4();
  const worldMatrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();

  instances.forEach((instance, index) => {
    quaternion.setFromEuler(instance.rotation);
    localMatrix.compose(
      instance.localPosition,
      quaternion,
      instance.instanceScale,
    );
    worldMatrix.multiplyMatrices(instance.parentMatrix, localMatrix);
    mesh.setMatrixAt(index, worldMatrix);
  });

  mesh.name = name;
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  parent.add(mesh);
  return mesh;
}

function createHullGeometry(quality) {
  // Closed cross-section loft: outer planking, a thick gunwale and recessed cabin.
  const outline = new THREE.CatmullRomCurve3([
    [3.02, 0, 0], [2.05, 0, 0.87], [0.15, 0, 1.08], [-1.92, 0, 0.81],
    [-2.72, 0, 0], [-1.92, 0, -0.81], [0.15, 0, -1.08], [2.05, 0, -0.87],
  ].map((p) => new THREE.Vector3(...p)), true, 'centripetal');
  const rings = [[0.96, 0.02, -0.82], [0.98, 0.55, -0.34], [1, 0.9, 0.14],
    [1, 1, 0.55], [0.97, 0.9, 0.53], [0.9, 0.64, 0.1]];
  const vertices = [], indices = [], uvs = [];
  const count = quality === 'high' ? 48 : 32;
  rings.forEach(([sx, sz, y], ring) => {
    for (let i = 0; i <= count; i += 1) {
      const p = outline.getPoint(i / count);
      const bowLift = y < 0 ? Math.pow(Math.abs(p.x) / 3.1, 3) * 0.42 : 0;
      vertices.push(p.x * sx, y + bowLift, p.z * sz);
      uvs.push(i / count, ring / (rings.length - 1));
      if (ring && i) {
        const a = ring * (count + 1) + i;
        const b = a - (count + 1);
        indices.push(a - 1, b - 1, b, a - 1, b, a);
      }
    }
  });
  const keelCenter = vertices.length / 3;
  vertices.push(0, -0.82, 0); uvs.push(0.5, 0);
  for (let i = 1; i <= count; i++) indices.push(keelCenter, i - 1, i);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createLifeRing(materials, scale = 1) {
  const ring = new THREE.Group();
  const orange = new THREE.Mesh(
    new THREE.TorusGeometry(0.46 * scale, 0.13 * scale, 10, 40),
    materials.lifeRing,
  );
  orange.castShadow = true;
  ring.add(orange);

  const stripeGeometries = [];
  for (let index = 0; index < 4; index += 1) {
    const stripeGeometry = new THREE.TorusGeometry(
        0.46 * scale,
        0.136 * scale,
        10,
        8,
        Math.PI * 0.22,
    );
    stripeGeometry.rotateZ(index * (Math.PI / 2) - Math.PI * 0.11);
    stripeGeometries.push(stripeGeometry);
  }
  const stripes = new THREE.Mesh(
    mergeAndDispose(stripeGeometries),
    materials.rope,
  );
  stripes.castShadow = true;
  ring.add(stripes);

  return ring;
}

function createFishingBoat(parent, materials, quality) {
  const boat = new THREE.Group();
  boat.name = 'DetailedFishingBoat';
  const hull = new THREE.Mesh(createHullGeometry(quality), materials.boatHull);
  hull.name = 'LoftedBoatHull';
  hull.castShadow = true;
  hull.receiveShadow = true;
  boat.add(hull);

  const innerShape = new THREE.Shape();
  innerShape.moveTo(2.4, 0);
  innerShape.lineTo(1.65, 0.66);
  innerShape.lineTo(-1.75, 0.6);
  innerShape.lineTo(-2.35, 0);
  innerShape.lineTo(-1.75, -0.6);
  innerShape.lineTo(1.65, -0.66);
  innerShape.closePath();
  const inner = new THREE.Mesh(
    new THREE.ShapeGeometry(innerShape),
    materials.boatInterior,
  );
  inner.rotation.x = -Math.PI / 2;
  inner.position.y = 0.115;
  boat.add(inner);

  const rimPoints = [
    new THREE.Vector3(3.02, 0.59, 0),
    new THREE.Vector3(2.05, 0.59, 0.87),
    new THREE.Vector3(0.15, 0.59, 1.08),
    new THREE.Vector3(-1.92, 0.59, 0.81),
    new THREE.Vector3(-2.72, 0.59, 0),
    new THREE.Vector3(-1.92, 0.59, -0.81),
    new THREE.Vector3(0.15, 0.59, -1.08),
    new THREE.Vector3(2.05, 0.59, -0.87),
  ];
  const rimCurve = new THREE.CatmullRomCurve3(rimPoints, true, 'centripetal');
  const rimParts = [new THREE.TubeGeometry(rimCurve, quality === 'high' ? 48 : 32, 0.07, 6, true)];
  for (const [width, y] of [[0.64, -0.22], [0.85, 0.08], [0.96, 0.35]]) {
    const seam = new THREE.CatmullRomCurve3(rimPoints.map((p) =>
      new THREE.Vector3(p.x * 0.992, y + Math.pow(Math.abs(p.x) / 3.1, 3) * Math.max(0, 0.3 - y), p.z * width)), true, 'centripetal');
    rimParts.push(new THREE.TubeGeometry(seam, quality === 'high' ? 48 : 32, 0.012, 3, true));
  }
  const rim = new THREE.Mesh(mergeAndDispose(rimParts), materials.boatTrim);
  rim.name = 'BoatGunwaleAndStrakes';
  // The thick hull lip already supplies this silhouette; subpixel strakes need no extra shadow pass.
  rim.castShadow = false;
  boat.add(rim);

  const seatGeometries = [-1.25, 0.15, 1.35].map((seatX) => {
    const geometry = createBeveledTimber(0.32, 0.1, 1.62, 0.025);
    geometry.translate(seatX, 0.51, 0);
    return geometry;
  });
  for (const x of [-1.25, 0.15, 1.35]) {
    for (const z of [-0.62, 0.62]) {
      seatGeometries.push(new THREE.BoxGeometry(0.12, 0.3, 0.12).translate(x, 0.31, z));
    }
  }
  for (let x = -1.7; x <= 1.8; x += 0.5) {
    const rib = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      new THREE.Vector3(x, 0.5, -0.75), new THREE.Vector3(x, 0.16, -0.5),
      new THREE.Vector3(x, 0.15, 0.5), new THREE.Vector3(x, 0.5, 0.75),
    ]), 12, 0.025, 5, false);
    seatGeometries.push(rib);
  }
  for (const z of [-0.4, 0, 0.4]) {
    const plank = new THREE.BoxGeometry(3.8, 0.045, 0.3);
    plank.translate(0, 0.14, z);
    seatGeometries.push(plank);
  }
  const seats = new THREE.Mesh(
    mergeAndDispose(seatGeometries),
    materials.boatTrim,
  );
  seats.name = 'SupportedBoatSeats';
  seats.castShadow = true;
  boat.add(seats);

  const oar = new THREE.Group();
  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.04, 4.2, 8),
    materials.boatTrim,
  );
  handle.rotation.z = Math.PI / 2;
  handle.castShadow = true;
  oar.add(handle);
  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(-0.4, -0.035);
  bladeShape.quadraticCurveTo(-0.22, -0.055, -0.12, -0.14);
  bladeShape.quadraticCurveTo(0.25, -0.18, 0.4, -0.09);
  bladeShape.quadraticCurveTo(0.46, 0, 0.4, 0.09);
  bladeShape.quadraticCurveTo(0.25, 0.18, -0.12, 0.14);
  bladeShape.quadraticCurveTo(-0.22, 0.055, -0.4, 0.035);
  bladeShape.closePath();
  const bladeGeometry = new THREE.ExtrudeGeometry(bladeShape, {
    depth: 0.04, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.008, bevelSegments: 1, steps: 1, curveSegments: 5,
  });
  bladeGeometry.rotateX(-Math.PI / 2).translate(0, -0.02, 0);
  const blade = new THREE.Mesh(bladeGeometry, materials.boatTrim);
  blade.position.x = 2.25;
  blade.rotation.y = 0.12;
  oar.add(blade);
  oar.position.set(-0.1, 0.72, -0.2);
  oar.rotation.y = 0.18;
  boat.add(oar);

  const ring = createLifeRing(materials, 0.72);
  ring.position.set(-0.35, 0.34, 1.11);
  ring.rotation.y = 0.08;
  boat.add(ring);

  const riggingParts = [];
  const coilPoints = Array.from({ length: 73 }, (_, i) => {
    const t = i / 72, angle = t * Math.PI * 8, radius = 0.12 + 0.25 * t;
    return new THREE.Vector3(-0.5 + Math.cos(angle) * radius, 0.19 + 0.005 * t, Math.sin(angle) * radius);
  });
  riggingParts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(coilPoints), 72, 0.022, 4, false));
  const tether = new THREE.CatmullRomCurve3([
    coilPoints.at(-1), new THREE.Vector3(-0.7, 0.2, 0.34), new THREE.Vector3(-1.5, 0.25, 0.45),
    new THREE.Vector3(-2.15, 0.49, 0.42), new THREE.Vector3(-2.4, 0.63, 0.16),
  ]);
  riggingParts.push(new THREE.TubeGeometry(tether, 20, 0.022, 4, false));
  const rigging = new THREE.Mesh(mergeAndDispose(riggingParts), materials.ropeDark);
  rigging.name = 'BoatCoiledMooringLine';
  boat.add(rigging);

  const x = 14;
  const z = 20;
  boat.position.set(x, terrainHeight(x, z) + 0.85, z);
  boat.rotation.set(-0.04, -0.58, 0.06);
  boat.scale.setScalar(1.05);
  parent.add(boat);
  return boat;
}

function createDeckChair(parent, materials) {
  const chair = new THREE.Group();
  chair.name = 'DetailedCanvasDeckChair';
  const woodGeometries = [];
  const beam = (a, b, width = 0.085) => {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const direction = end.clone().sub(start);
    const geometry = createBeveledTimber(width, direction.length(), width, 0.012);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
    geometry.translate(...start.add(end).multiplyScalar(0.5).toArray());
    woodGeometries.push(geometry);
  };
  for (const x of [-0.72, 0.72]) {
    beam([x, 0.1, 0.65], [x, 2.1, -0.95]);
    beam([x, 0.1, -0.85], [x, 0.72, 0.65]);
    beam([x, 0.92, 0.55], [x, 1.16, -0.5], 0.11);
  }
  for (const [y, z] of [[2.1, -0.95], [0.72, 0.65], [0.2, -0.85]]) beam([-0.72, y, z], [0.72, y, z]);
  for (const x of [-0.72, 0.72]) {
    beam([x, 0.7, 0.1], [x, 1.04, 0.1], 0.07);
    const hinge = new THREE.CylinderGeometry(0.073, 0.073, 0.13, 10);
    hinge.rotateZ(Math.PI / 2).translate(x, 0.566, 0.277);
    woodGeometries.push(hinge);
  }
  const woodFrame = new THREE.Mesh(
    mergeAndDispose(woodGeometries),
    materials.boatTrim,
  );
  woodFrame.castShadow = true;
  chair.add(woodFrame);

  const fabric = new THREE.Mesh(
    new THREE.PlaneGeometry(1.35, 1.9, 8, 24),
    materials.chairFabric,
  );
  const positions = fabric.geometry.attributes.position;
  const sling = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.72, 0.65), new THREE.Vector3(0, 0.58, 0.05),
    new THREE.Vector3(0, 1.04, -0.47), new THREE.Vector3(0, 2.1, -0.95),
  ]);
  for (let i = 0; i < positions.count; i += 1) {
    const t = positions.getY(i) / 1.9 + 0.5;
    const p = sling.getPoint(t);
    const sag = (1 - (positions.getX(i) / 0.675) ** 2) * Math.sin(t * Math.PI) * 0.045;
    positions.setXYZ(i, positions.getX(i), p.y - sag, p.z);
  }
  fabric.geometry.computeVertexNormals();
  const fabricParts = [fabric.geometry];
  for (const x of [-0.667, 0.667]) {
    const edge = new THREE.CatmullRomCurve3(Array.from({ length: 17 }, (_, i) => {
      const p = sling.getPoint(i / 16); return new THREE.Vector3(x, p.y + 0.007, p.z);
    }));
    fabricParts.push(new THREE.TubeGeometry(edge, 20, 0.018, 4, false));
  }
  for (const [y, z] of [[0.72, 0.65], [2.1, -0.95]]) {
    const rolledEdge = new THREE.CylinderGeometry(0.048, 0.048, 1.35, 8);
    rolledEdge.rotateZ(Math.PI / 2).translate(0, y, z);
    fabricParts.push(rolledEdge);
  }
  fabric.geometry = mergeAndDispose(fabricParts);
  fabric.name = 'HemmedChairSling';
  fabric.castShadow = true;
  chair.add(fabric);

  const x = -13;
  const z = 27;
  chair.position.set(x, terrainHeight(x, z) + 0.08, z);
  chair.rotation.y = 0.35;
  chair.scale.setScalar(0.86);
  parent.add(chair);
  return chair;
}

function createShadeFabricMaterial() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  const stripeWidth = 32;

  context.fillStyle = new THREE.Color(palette.chalk).getStyle();
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (let x = 0; x < canvas.width; x += stripeWidth * 2) {
    context.fillStyle = new THREE.Color(palette.coral).getStyle();
    context.fillRect(x, 0, stripeWidth, canvas.height);
  }
  // Sparse translucent marks keep the generated cloth from reading as a
  // perfectly clean UI pattern when viewed at walking distance.
  context.fillStyle = 'rgba(54, 47, 40, 0.08)';
  for (let index = 0; index < 34; index += 1) {
    const x = (index * 73) % canvas.width;
    const y = (index * 29) % canvas.height;
    context.fillRect(x, y, 3 + (index % 5), 1);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.repeat.set(1.5, 1);
  texture.anisotropy = 4;
  return addCoastalSurfaceDetail(new THREE.MeshStandardMaterial({
    map: texture,
    color: 0xffffff,
    roughness: 0.92,
    envMapIntensity: 0.55,
    metalness: 0,
    side: THREE.DoubleSide,
  }), 'cloth');
}

function createShadeShelter(parent, materials, colliders, quality) {
  const x = -13;
  const z = 27;
  const ground = terrainHeight(x, z);
  const shelter = new THREE.Group();
  shelter.name = 'WeatheredBeachShade';
  shelter.position.set(x, ground, z);

  const width = 4.5;
  const depth = 3.5;
  const canopyHeight = 2.95;
  const woodParts = [];
  const postOffsets = [
    [-2.05, -1.52],
    [2.05, -1.52],
    [-2.05, 1.52],
    [2.05, 1.52],
  ];
  for (const [offsetX, offsetZ] of postOffsets) {
    const localGround = terrainHeight(x + offsetX, z + offsetZ) - ground;
    const postHeight = canopyHeight - localGround;
    const post = new THREE.CylinderGeometry(0.07, 0.095, postHeight, 7);
    post.translate(offsetX, localGround + postHeight * 0.5, offsetZ);
    woodParts.push(post);
    colliders.push({
      type: 'circle',
      name: 'shade-post',
      x: x + offsetX,
      z: z + offsetZ,
      radius: 0.12,
      minY: ground + localGround - 0.1,
      maxY: ground + canopyHeight,
    });
  }
  for (const edgeZ of [-1.58, 1.58]) {
    const beam = new THREE.BoxGeometry(width, 0.11, 0.11);
    beam.translate(0, canopyHeight - 0.08, edgeZ);
    woodParts.push(beam);
  }
  for (const edgeX of [-2.08, 2.08]) {
    const beam = new THREE.BoxGeometry(0.11, 0.11, depth);
    beam.translate(edgeX, canopyHeight - 0.08, 0);
    woodParts.push(beam);
  }
  for (const [px, pz] of postOffsets) {
    const brace = new THREE.BoxGeometry(0.065, 0.78, 0.065);
    brace.rotateZ(Math.sign(px) * Math.PI / 4);
    brace.translate(px - Math.sign(px) * 0.25, canopyHeight - 0.36, pz);
    woodParts.push(brace);
  }
  const wood = new THREE.Mesh(
    mergeAndDispose(woodParts),
    materials.boardwalkDark,
  );
  wood.name = 'MergedShadeFrame';
  wood.castShadow = quality === 'high';
  wood.receiveShadow = true;
  shelter.add(wood);

  const canopyGeometry = new THREE.PlaneGeometry(width + 0.18, depth + 0.2, 24, 12);
  const canopyPositions = canopyGeometry.attributes.position;
  for (let index = 0; index < canopyPositions.count; index += 1) {
    const localX = canopyPositions.getX(index);
    const localY = canopyPositions.getY(index);
    const arch = 0.2 * (1 - (localX / (width * 0.5)) ** 2);
    const ripple = Math.cos(localX * 12) * 0.016 * Math.sin((localY / depth + 0.5) * Math.PI);
    canopyPositions.setZ(index, Math.max(0, arch) + ripple);
  }
  canopyPositions.needsUpdate = true;
  canopyGeometry.computeVertexNormals();
  canopyGeometry.rotateX(-Math.PI / 2);
  canopyGeometry.translate(0, canopyHeight, 0);
  const canopyParts = [canopyGeometry];
  // Sewn front/back valances follow the same arch instead of ending in a paper-thin edge.
  for (const side of [-1, 1]) {
    const hem = new THREE.PlaneGeometry(width + 0.18, 0.18, 24, 1);
    const p = hem.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), bottom = p.getY(i) < 0;
      const arch = Math.max(0, 0.2 * (1 - (x / (width * 0.5)) ** 2));
      p.setXYZ(i, x, canopyHeight + arch - (bottom ? 0.16 + 0.025 * Math.cos(x * 10) : 0), side * (depth + 0.2) / 2);
    }
    hem.computeVertexNormals();
    canopyParts.push(hem);
  }
  const canopy = new THREE.Mesh(mergeAndDispose(canopyParts), materials.shadeFabric);
  canopy.name = 'StripedShadeCanopy';
  canopy.castShadow = quality === 'high';
  canopy.receiveShadow = true;
  shelter.add(canopy);

  parent.add(shelter);
  return { group: shelter, wood, canopy, postCount: postOffsets.length };
}

function createFootprintTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'rgba(255, 255, 255, 0.86)';
  context.beginPath();
  context.ellipse(32, 82, 13, 28, -0.05, 0, Math.PI * 2);
  context.ellipse(32, 108, 10, 13, 0, 0, Math.PI * 2);
  context.fill();
  for (let toe = 0; toe < 5; toe += 1) {
    context.beginPath();
    context.ellipse(
      18 + toe * 7,
      45 - Math.abs(2 - toe) * 2,
      4.7 - Math.abs(2 - toe) * 0.45,
      6.5 - Math.abs(2 - toe) * 0.4,
      0,
      0,
      Math.PI * 2,
    );
    context.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function createFootprintTrail(parent, quality) {
  if (quality !== 'high') return null;

  const route = new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(25, 0, 20),
      new THREE.Vector3(17, 0, 18.5),
      new THREE.Vector3(8, 0, 16),
      new THREE.Vector3(-3, 0, 13.5),
      new THREE.Vector3(-12, 0, 12),
      new THREE.Vector3(-20, 0, 9),
    ],
    false,
    'centripetal',
  );
  const promenade = new THREE.CatmullRomCurve3(BEACH_WALK_ROUTE.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
  const count = 70;
  const geometry = new THREE.PlaneGeometry(0.34, 0.78);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({
    color: 0x594d40,
    map: createFootprintTexture(),
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  const footprints = new THREE.InstancedMesh(geometry, material, count);
  const point = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const matrix = new THREE.Matrix4();
  const euler = new THREE.Euler();

  for (let index = 0; index < count; index += 1) {
    const activeRoute = index < 28 ? route : promenade;
    const t = index < 28 ? (index + 0.5) / 28 : (index - 28 + 0.5) / 42;
    activeRoute.getPointAt(t, point);
    activeRoute.getTangentAt(t, tangent).normalize();
    const side = index % 2 === 0 ? -1 : 1;
    position.set(
      point.x - tangent.z * side * 0.2,
      terrainHeight(point.x, point.z) + 0.032,
      point.z + tangent.x * side * 0.2,
    );
    euler.set(
      0,
      Math.atan2(-tangent.x, -tangent.z) + side * 0.035,
      0,
    );
    quaternion.setFromEuler(euler);
    scale.setScalar(0.92 + Math.sin(index * 2.3) * 0.06);
    matrix.compose(position, quaternion, scale);
    footprints.setMatrixAt(index, matrix);
  }
  footprints.name = 'InstancedWetFootprintTrail';
  footprints.instanceMatrix.needsUpdate = true;
  footprints.computeBoundingBox();
  footprints.computeBoundingSphere();
  footprints.renderOrder = 3;
  parent.add(footprints);
  return footprints;
}

function createDriftwood(parent, materials) {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-2.8, 0, 0),
    new THREE.Vector3(-1.2, 0.2, 0.16),
    new THREE.Vector3(0.4, -0.03, -0.05),
    new THREE.Vector3(2.5, 0.24, 0.12),
  ]);
  const wood = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 24, 0.16, 7, false),
    materials.driftwood,
  );
  const x = -8;
  const z = 12;
  wood.position.set(x, terrainHeight(x, z) + 0.24, z);
  wood.rotation.y = -0.36;
  wood.rotation.z = 0.05;
  wood.castShadow = true;
  wood.receiveShadow = true;
  parent.add(wood);
}

function createBoardwalk(parent, materials, colliders, quality) {
  const path = new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(43, 0, 37),
      new THREE.Vector3(38, 0, 32),
      new THREE.Vector3(32, 0, 26),
      new THREE.Vector3(25, 0, 20),
    ],
    false,
    'centripetal',
  );
  const plankCount = quality === 'high' ? 32 : 24;
  const plankSpacing = path.getLength() / plankCount;
  const plankDepth = plankSpacing * 0.94;
  const plankShape = new THREE.Shape();
  const halfDepth = plankDepth / 2 - 0.008;
  plankShape.moveTo(-1.55, -halfDepth); plankShape.lineTo(1.53, -halfDepth);
  plankShape.lineTo(1.567, -halfDepth + 0.045); plankShape.lineTo(1.559, halfDepth - 0.025);
  plankShape.lineTo(1.535, halfDepth); plankShape.lineTo(-1.535, halfDepth);
  plankShape.lineTo(-1.567, halfDepth - 0.035); plankShape.lineTo(-1.563, -halfDepth + 0.026);
  plankShape.closePath();
  const plankGeometry = new THREE.ExtrudeGeometry(plankShape, {
    depth: 0.106, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.008, bevelSegments: 1, steps: 1,
  });
  plankGeometry.rotateX(-Math.PI / 2).translate(0, -0.053, 0);
  const planks = new THREE.InstancedMesh(
    plankGeometry,
    materials.boardwalk,
    plankCount,
  );
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const point = new THREE.Vector3();
  const perpendicular = new THREE.Vector3();
  const euler = new THREE.Euler();
  const surfaceSamples = [];

  for (let index = 0; index < plankCount; index += 1) {
    const t = (index + 0.5) / plankCount;
    path.getPointAt(t, point);
    path.getTangentAt(t, tangent).normalize();
    const rotation = Math.atan2(-tangent.x, -tangent.z);
    position.set(
      point.x,
      terrainHeight(point.x, point.z) + 0.12,
      point.z,
    );
    euler.set(
      Math.sin(index * 1.31) * 0.018,
      rotation + Math.sin(index * 2.17) * 0.007,
      Math.cos(index * 0.91) * 0.025,
    );
    quaternion.setFromEuler(euler);
    scale.set(0.9 + Math.sin(index * 2.83) * 0.07, 1, 1);
    matrix.compose(position, quaternion, scale);
    planks.setMatrixAt(index, matrix);
    planks.setColorAt(index, new THREE.Color().setScalar(0.9 + (index % 5) * 0.025));
    surfaceSamples.push({
      x: point.x,
      z: point.z,
      height: position.y + 0.065,
      tangentX: tangent.x,
      tangentZ: tangent.z,
      halfWidth: 1.45 * scale.x,
      halfLength: plankSpacing * 0.52,
    });
  }
  planks.name = 'InstancedWeatheredBoardwalk';
  planks.userData.plankDepth = plankDepth;
  planks.userData.plankSpacing = plankSpacing;
  planks.instanceMatrix.needsUpdate = true;
  planks.castShadow = quality === 'high';
  planks.receiveShadow = true;
  planks.computeBoundingBox();
  planks.computeBoundingSphere();
  parent.add(planks);

  const postSamples = quality === 'high' ? 9 : 7;
  const postBody = new THREE.CylinderGeometry(0.075, 0.105, 1.25, 8);
  const postCap = new THREE.CylinderGeometry(0.096, 0.11, 0.075, 8).translate(0, 0.6075, 0);
  const posts = new THREE.InstancedMesh(
    mergeAndDispose([postBody, postCap]),
    materials.boardwalkDark,
    postSamples * 2,
  );
  const ropePoints = [[], []];
  let postIndex = 0;
  for (let sample = 0; sample < postSamples; sample += 1) {
    const t = sample / (postSamples - 1);
    path.getPointAt(t, point);
    path.getTangentAt(Math.min(0.999, Math.max(0.001, t)), tangent).normalize();
    perpendicular.set(-tangent.z, 0, tangent.x).normalize();

    for (const side of [-1, 1]) {
      const sideIndex = side < 0 ? 0 : 1;
      const postX = point.x + perpendicular.x * side * 1.48;
      const postZ = point.z + perpendicular.z * side * 1.48;
      const ground = terrainHeight(postX, postZ);
      position.set(postX, ground + 0.63, postZ);
      euler.set(
        Math.sin(postIndex * 1.7) * 0.035,
        0,
        Math.cos(postIndex * 1.13) * 0.035,
      );
      quaternion.setFromEuler(euler);
      scale.setScalar(1);
      matrix.compose(position, quaternion, scale);
      posts.setMatrixAt(postIndex, matrix);
      ropePoints[sideIndex].push(
        new THREE.Vector3(
          postX,
          ground + 1.04 - (sample % 2 === 0 ? 0 : 0.08),
          postZ,
        ),
      );
      colliders.push({
        type: 'circle',
        name: 'boardwalk-post',
        x: postX,
        z: postZ,
        radius: 0.11,
        minY: ground - 0.1,
        maxY: ground + 1.3,
      });
      postIndex += 1;
    }
  }
  posts.name = 'InstancedBoardwalkPosts';
  posts.instanceMatrix.needsUpdate = true;
  posts.castShadow = quality === 'high';
  posts.receiveShadow = true;
  posts.computeBoundingBox();
  posts.computeBoundingSphere();
  parent.add(posts);

  const ropeGeometries = [];
  for (const points of ropePoints) {
    const ropePath = new THREE.CurvePath();
    for (let i = 1; i < points.length; i++) {
      const midpoint = points[i - 1].clone().lerp(points[i], 0.5);
      midpoint.y -= 0.25;
      ropePath.add(new THREE.QuadraticBezierCurve3(points[i - 1], midpoint, points[i]));
    }
    ropeGeometries.push(new THREE.TubeGeometry(ropePath, quality === 'high' ? 56 : 40, 0.026, 5, false));
    for (const p of points) {
      const tie = new THREE.TorusGeometry(0.096, 0.023, 3, 8).rotateX(Math.PI / 2);
      tie.translate(p.x, p.y, p.z);
      ropeGeometries.push(tie);
    }
  }
  const ropes = new THREE.Mesh(
    mergeAndDispose(ropeGeometries),
    materials.ropeDark,
  );
  ropes.name = 'BoardwalkRopes';
  ropes.castShadow = quality === 'high';
  parent.add(ropes);

  const joists = [];
  for (const side of [-1, 1]) {
    const points = Array.from({ length: 25 }, (_, i) => {
      const p = path.getPointAt(i / 24), t = path.getTangentAt(i / 24).normalize();
      const x = p.x - t.z * side, z = p.z + t.x * side;
      return new THREE.Vector3(x, terrainHeight(x, z) + 0.015, z);
    });
    const profile = new THREE.Shape();
    profile.moveTo(-0.08, -0.05); profile.lineTo(0.08, -0.05);
    profile.lineTo(0.08, 0.05); profile.lineTo(-0.08, 0.05); profile.closePath();
    joists.push(new THREE.ExtrudeGeometry(profile, {
      steps: 24, bevelEnabled: false, extrudePath: new THREE.CatmullRomCurve3(points),
    }));
  }
  const understructure = new THREE.Mesh(mergeAndDispose(joists), materials.boardwalkDark);
  understructure.name = 'BoardwalkUnderstructure';
  understructure.receiveShadow = true;
  parent.add(understructure);

  return {
    planks,
    posts,
    ropes,
    understructure,
    clearVegetation(x, z, margin = 0.8) {
      const sample = surfaceSamples.reduce((nearest, current) =>
        Math.hypot(x - current.x, z - current.z) < Math.hypot(x - nearest.x, z - nearest.z) ? current : nearest);
      const dx = x - sample.x, dz = z - sample.z;
      const along = dx * sample.tangentX + dz * sample.tangentZ;
      const across = dx * -sample.tangentZ + dz * sample.tangentX;
      const shoulder = sample.halfWidth + margin;
      if (Math.abs(along) > sample.halfLength + margin || Math.abs(across) >= shoulder) return [x, z];
      const shift = (across < 0 ? -shoulder : shoulder) - across;
      return [x - sample.tangentZ * shift, z + sample.tangentX * shift];
    },
    surfaceHeightAt(x, z) {
      let surface = null;
      for (const sample of surfaceSamples) {
        const offsetX = x - sample.x;
        const offsetZ = z - sample.z;
        const along =
          offsetX * sample.tangentX + offsetZ * sample.tangentZ;
        const across =
          offsetX * -sample.tangentZ + offsetZ * sample.tangentX;
        if (
          Math.abs(along) <= sample.halfLength &&
          Math.abs(across) <= sample.halfWidth
        ) {
          surface = Math.max(surface ?? -Infinity, sample.height);
        }
      }
      return surface;
    },
  };
}

function createTidePools(parent, quality) {
  const poolSpecs = [
    [-20.8, 8.6, 1.45, 0.78, 0.25],
    [-24.1, 10.4, 1.08, 0.62, -0.36],
    [32.2, 7.8, 1.2, 0.7, 0.62],
  ];
  const geometries = poolSpecs.map(([x, z, width, depth, rotation], poolIndex) => {
    const geometry = new THREE.CircleGeometry(1, quality === 'high' ? 40 : 24);
    const positions = geometry.attributes.position;
    for (let index = 1; index < positions.count; index += 1) {
      const sourceX = positions.getX(index);
      const sourceY = positions.getY(index);
      const angle = Math.atan2(sourceY, sourceX);
      const irregularity =
        1 +
        Math.sin(angle * 3 + poolIndex) * 0.08 +
        Math.sin(angle * 7 - poolIndex * 0.7) * 0.035;
      positions.setXY(
        index,
        sourceX * width * irregularity,
        sourceY * depth * irregularity,
      );
    }
    geometry.rotateZ(rotation);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(x, terrainHeight(x, z) + 0.055, z);
    geometry.computeVertexNormals();
    return geometry;
  });
  const material = new THREE.MeshPhysicalMaterial({
    color: 0x2f7774,
    roughness: 0.16,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    envMapIntensity: 1.18,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  const pools = new THREE.Mesh(mergeAndDispose(geometries), material);
  pools.name = 'ReflectiveTidePools';
  pools.renderOrder = 3;
  parent.add(pools);
  return pools;
}

function createDistantSailboat(parent, materials) {
  const sailboat = new THREE.Group();
  sailboat.name = 'DistantSailboat';
  const hull = new THREE.Mesh(
    new THREE.BoxGeometry(4.2, 0.42, 1.1),
    materials.distantHull,
  );
  hull.scale.x = 1;
  hull.position.y = 0.18;
  hull.castShadow = true;
  sailboat.add(hull);

  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.055, 4.8, 8),
    materials.boatTrim,
  );
  mast.position.y = 2.55;
  mast.castShadow = true;
  sailboat.add(mast);

  const sailShape = new THREE.Shape();
  sailShape.moveTo(0.12, 0);
  sailShape.lineTo(0.12, 3.8);
  sailShape.lineTo(2.1, 0.32);
  sailShape.closePath();
  const sail = new THREE.Mesh(
    new THREE.ShapeGeometry(sailShape),
    materials.sail,
  );
  sail.position.set(0.04, 0.62, 0);
  sail.rotation.y = Math.PI / 2;
  sail.castShadow = true;
  sailboat.add(sail);

  sailboat.position.set(-27, 0.18, -32);
  sailboat.rotation.y = -0.22;
  sailboat.scale.setScalar(0.72);
  parent.add(sailboat);
  return sailboat;
}

function createInstancedGroundDetails(parent, random, materials, quality, boardwalk, street) {
  // Pebbles, shells and grass repeat simple silhouettes, making them ideal for
  // InstancedMesh: one material/geometry draw per category.
  const pebbleCount = quality === 'high' ? 76 : 36;
  const shellCount = quality === 'high' ? 30 : 16;
  const grassCount = quality === 'high' ? 300 : 70;
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const position = new THREE.Vector3();

  const pebbles = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(0.18, 0),
    materials.pebble,
    pebbleCount,
  );
  for (let index = 0; index < pebbleCount; index += 1) {
    const x = (random() - 0.5) * 110;
    let z = 7 + random() * 43;
    if (distanceToBeachWalk(x, z) < 1.8 || (Math.abs(x) < 5 && Math.abs(z - 31.2) < 7)) z = 12 + random() * 4;
    const size = 0.45 + random() * 1.3;
    position.set(x, terrainHeight(x, z) + 0.08, z);
    quaternion.setFromEuler(
      new THREE.Euler(random() * Math.PI, random() * Math.PI, random() * Math.PI),
    );
    scale.set(size * (0.7 + random()), size * 0.5, size);
    matrix.compose(position, quaternion, scale);
    pebbles.setMatrixAt(index, matrix);
  }
  pebbles.instanceMatrix.needsUpdate = true;
  pebbles.castShadow = quality === 'high';
  pebbles.receiveShadow = true;
  parent.add(pebbles);

  const shells = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.13, 8, 5, 0, Math.PI * 1.65, 0, Math.PI * 0.72),
    materials.shell,
    shellCount,
  );
  const shellPalette = [
    new THREE.Color('#fff1d8'),
    new THREE.Color('#e7bca3'),
    new THREE.Color('#c8c3b6'),
  ];
  const shellColor = new THREE.Color();
  for (let index = 0; index < shellCount; index += 1) {
    const x = (random() - 0.5) * 78;
    const z = 8 + random() * 28;
    const size = 0.4 + random() * 0.68;
    position.set(x, terrainHeight(x, z) + 0.055, z);
    quaternion.setFromEuler(
      new THREE.Euler(
        -Math.PI / 2 + (random() - 0.5) * 0.35,
        random() * Math.PI,
        random() * 0.4,
      ),
    );
    scale.set(size * 1.35, size * 0.48, size);
    matrix.compose(position, quaternion, scale);
    shells.setMatrixAt(index, matrix);
    shellColor
      .copy(shellPalette[index % shellPalette.length])
      .multiplyScalar(0.88 + random() * 0.12);
    shells.setColorAt(index, shellColor);
  }
  shells.instanceMatrix.needsUpdate = true;
  shells.instanceColor.needsUpdate = true;
  shells.receiveShadow = true;
  parent.add(shells);

  const grass = new THREE.InstancedMesh(
    createDuneGrassGeometry(quality),
    materials.grass,
    grassCount,
  );
  const grassPalette = [
    new THREE.Color('#f1f4dc'),
    new THREE.Color('#e4efde'),
    new THREE.Color('#fff0d5'),
  ];
  for (let index = 0; index < grassCount; index += 1) {
    const patchSide = random() > 0.5 ? 1 : -1;
    const foregroundPatch = random() < 0.34;
    const x =
      patchSide *
        (foregroundPatch ? 22 + random() * 34 : 28 + random() * 56) +
      (random() - 0.5) * 9;
    const z = foregroundPatch ? 29 + random() * 28 : 48 + random() * 49;
    const size = 0.55 + random() * 1.2;
    const [clearX, clearZ] = boardwalk.clearVegetation(x, z);
    position.set(clearX, terrainHeight(clearX, clearZ) + 0.025, clearZ);
    quaternion.setFromEuler(
      new THREE.Euler((random() - 0.5) * 0.22, random() * Math.PI, (random() - 0.5) * 0.18),
    );
    scale.set(0.72 + random() * 0.6, size, 0.72 + random() * 0.6);
    matrix.compose(position, quaternion, scale);
    grass.setMatrixAt(index, matrix);
    grass.setColorAt(index, grassPalette[index % grassPalette.length]);
  }
  grass.instanceMatrix.needsUpdate = true;
  grass.name = 'InstancedDuneGrass';
  grass.instanceColor.needsUpdate = true;
  grass.castShadow = quality === 'high';
  grass.receiveShadow = true;
  parent.add(grass);

  const originalGrass = grass.instanceMatrix.array.slice();
  grass.geometry.computeBoundingBox();
  const grassBox = new THREE.Box3();
  function clearVegetation(occupiedBounds = []) {
    let moved = 0;
    // Rebuild from the seeded layout, so asset load order and rebinds cannot drift.
    for (let i = 0; i < grassCount; i++) {
      matrix.fromArray(originalGrass, i * 16);
      const originX = matrix.elements[12], originZ = matrix.elements[14];
      grassBox.copy(grass.geometry.boundingBox).applyMatrix4(matrix);
      const radius = Math.max(originX - grassBox.min.x, grassBox.max.x - originX,
        originZ - grassBox.min.z, grassBox.max.z - originZ) + 0.25;
      let x = originX, z = originZ;
      for (let attempt = 0; attempt < 64; attempt++) {
        [x, z] = boardwalk.clearVegetation(x, z, radius + 0.2);
        [x, z] = street.clearVegetation(x, z, radius + 0.2);
        const obstructed = occupiedBounds.some(b => x + radius >= b.min.x && x - radius <= b.max.x
          && z + radius >= b.min.z && z - radius <= b.max.z);
        if (!obstructed && distanceToBeachWalk(x, z) > radius + 1.2) break;
        z += 2.4 + (i % 3) * 0.2;
      }
      matrix.setPosition(x, terrainHeight(x, z) + 0.025, z);
      grass.setMatrixAt(i, matrix);
      if (Math.abs(x - originX) + Math.abs(z - originZ) > 0.001) moved++;
    }
    grass.instanceMatrix.needsUpdate = true;
    grass.computeBoundingBox();
    grass.computeBoundingSphere();
    grass.userData.clearanceMoved = moved;
  }
  clearVegetation();
  return { pebbles, shells, grass, clearVegetation };
}

function createPalmTrunkGeometry(quality) {
  const geometry = new THREE.CylinderGeometry(.967, 1, 1, quality === 'low' ? 10 : 12, quality === 'low' ? 2 : 8);
  const p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const ring = 1 + .035 * Math.cos((p.getY(i) + .5) * Math.PI * 8);
    p.setX(i, p.getX(i) * ring); p.setZ(i, p.getZ(i) * ring);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function createContactShadowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(64, 64, 4, 64, 64, 62);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
  gradient.addColorStop(0.42, 'rgba(255, 255, 255, 0.48)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createLightGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
  gradient.addColorStop(0.18, 'rgba(255, 255, 255, 0.42)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createContactShadows(parent, quality, palmSpecs) {
  // These soft decals provide stable contact darkening even when real-time
  // shadows are disabled on mobile.
  const shadowSpecs = [
    [14, 20, 4.8, 1.9, -0.58, 0.17],
    [-13, 27, 2.2, 1.6, 0.35, 0.13],
    [-24, 8, 14, 6.2, 0.05, 0.16],
    [35, 5, 9.5, 4.4, -0.2, 0.15],
    [-58, 45, 12, 5.2, 0.16, 0.14],
    [8, 29, 1.25, 1.25, 0, 0.12],
  ];
  palmSpecs.forEach(([x, z, scale]) => {
    shadowSpecs.push([x, z, 2.2 * scale, 1.7 * scale, 0, 0.13]);
  });

  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshBasicMaterial({
    color: 0x261f18,
    map: createContactShadowTexture(),
    transparent: true,
    opacity: quality === 'high' ? 0.11 : 0.17,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  const shadows = new THREE.InstancedMesh(
    geometry,
    material,
    shadowSpecs.length,
  );
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();

  shadowSpecs.forEach(([x, z, width, depth, rotation, opacityScale], index) => {
    position.set(x, terrainHeight(x, z) + 0.035, z);
    quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, rotation));
    scale.set(width, depth, 1);
    matrix.compose(position, quaternion, scale);
    shadows.setMatrixAt(index, matrix);
    shadows.setColorAt(
      index,
      new THREE.Color().setScalar(0.72 + opacityScale),
    );
  });
  shadows.instanceMatrix.needsUpdate = true;
  shadows.instanceColor.needsUpdate = true;
  shadows.name = 'InstancedContactOcclusion';
  shadows.renderOrder = 2;
  shadows.frustumCulled = false;
  parent.add(shadows);
  return shadows;
}

function createMaterials(quality, waterHeight) {
  // Material construction is quality-aware so mobile never compiles desktop
  // rock/wood noise or the extra physical clearcoat and sheen lobes.
  const physicalLifeRing =
    quality === 'high'
      ? new THREE.MeshPhysicalMaterial({
          color: palette.coral,
          roughness: 0.58,
          clearcoat: 0.22,
          clearcoatRoughness: 0.4,
          specularIntensity: 0.68,
        })
      : new THREE.MeshStandardMaterial({
          color: palette.coral,
          roughness: 0.58,
        });
  const physicalFabric =
    quality === 'high'
      ? new THREE.MeshPhysicalMaterial({
          color: palette.coral,
          roughness: 0.92,
          sheen: 0.28,
          sheenColor: new THREE.Color(palette.chalk),
          sheenRoughness: 0.86,
          side: THREE.DoubleSide,
        })
      : new THREE.MeshStandardMaterial({
          color: palette.coral,
          roughness: 0.92,
          side: THREE.DoubleSide,
        });
  const shellMaterial =
    quality === 'high'
      ? new THREE.MeshPhysicalMaterial({
          color: 0xdcc8a5,
          roughness: 0.46,
          clearcoat: 0.28,
          clearcoatRoughness: 0.34,
          side: THREE.DoubleSide,
        })
      : new THREE.MeshStandardMaterial({
          color: 0xdcc8a5,
          roughness: 0.68,
          side: THREE.DoubleSide,
        });

  return {
    rock: [
      createRockMaterial({
        baseColor: '#737168',
        darkColor: '#3f4846',
        wetColor: '#203538',
        mossColor: '#5d684c',
        seed: 1.7,
        quality,
        waterHeight,
      }),
      createRockMaterial({
        baseColor: '#8a7d69',
        darkColor: '#514b43',
        wetColor: '#2d3e3d',
        mossColor: '#687052',
        seed: 4.2,
        quality,
        waterHeight,
      }),
      createRockMaterial({
        baseColor: '#59625d',
        darkColor: '#303a39',
        wetColor: '#172e31',
        mossColor: '#4f644b',
        seed: 7.6,
        quality,
        waterHeight,
      }),
    ],
    trunk: createWoodMaterial({
      baseColor: '#928370',
      darkColor: '#5e5346',
      roughness: 0.94,
      quality,
    }),
    leaf: createFoliageMaterial({ quality }),
    coconut: new THREE.MeshStandardMaterial({ color: 0x56402d, roughness: 1 }),
    boatHull: createWoodMaterial({
      baseColor: palette.timber,
      darkColor: palette.timberShadow,
      paintColor: palette.seaGlass,
      paintCoverage: 0.97,
      roughness: 0.78,
      quality,
      side: THREE.DoubleSide,
    }),
    boatInterior: new THREE.MeshStandardMaterial({
      color: 0x3b5050,
      roughness: 0.74,
      side: THREE.DoubleSide,
    }),
    boatTrim: createWoodMaterial({
      baseColor: palette.timber,
      darkColor: palette.timberShadow,
      roughness: 0.82,
      quality,
    }),
    driftwood: createWoodMaterial({
      baseColor: '#75685a',
      darkColor: '#403a34',
      roughness: 0.98,
      quality,
    }),
    boardwalk: createWoodMaterial({
      baseColor: palette.timber,
      darkColor: palette.timberShadow,
      paintColor: '#b3aa91',
      paintCoverage: 0,
      grainAxis: 'x',
      roughness: 0.96,
      quality,
    }),
    boardwalkDark: createWoodMaterial({
      baseColor: '#7e7262',
      darkColor: '#574e43',
      roughness: 0.98,
      quality,
    }),
    lifeRing: physicalLifeRing,
    rope: new THREE.MeshStandardMaterial({ color: 0xe9dfc7, roughness: 0.82 }),
    ropeDark: new THREE.MeshStandardMaterial({ color: 0x746959, roughness: 0.98 }),
    chairFabric: addCoastalSurfaceDetail(physicalFabric, 'cloth'),
    shadeFabric: createShadeFabricMaterial(),
    pebble: new THREE.MeshStandardMaterial({
      color: 0x77746b,
      roughness: 0.9,
      flatShading: true,
    }),
    shell: shellMaterial,
    grass: createDuneGrassMaterial({ quality }),
    distantHull: createWoodMaterial({
      baseColor: '#815441',
      darkColor: '#3d2923',
      paintColor: '#8d4b3e',
      paintCoverage: 0.52,
      roughness: 0.8,
      quality,
    }),
    sail: new THREE.MeshStandardMaterial({
      color: 0xeee6d7,
      roughness: 0.7,
      side: THREE.DoubleSide,
    }),
  };
}

function disposeObjectTree(root) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();

  root.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    objectMaterials.filter(Boolean).forEach((material) => {
      materials.add(material);

      // Covers regular material maps plus textures owned by ShaderMaterial
      // uniforms without touching the scene-level PMREM environment texture.
      Object.values(material).forEach((value) => {
        if (value?.isTexture) textures.add(value);
      });
      Object.values(material.uniforms ?? {}).forEach((uniform) => {
        if (uniform?.value?.isTexture) textures.add(uniform.value);
      });
    });
  });

  textures.forEach((texture) => texture.dispose());
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
  root.removeFromParent();
}

/**
 * Builds all land-side geometry and returns a small runtime API used by the
 * environment. Static repetition is instanced; only water-adjacent animation
 * data is touched during the frame loop.
 */
export function createBeachWorld(parent, { quality = 'high' } = {}) {
  const random = createRandom(20260707);
  const root = new THREE.Group();
  root.name = 'BeachWorld';
  parent.add(root);

  const sandMaterial = createSandMaterial({ quality });
  const materials = createMaterials(quality, sandMaterial.userData.uniforms.uWaterHeight);
  const foamMaterial = createFoamMaterial();
  const rockGeometry = createRockGeometry(quality);
  const frondInstances = [];
  const trunkInstances = [];
  const coconutInstances = [];
  const cameraColliders = [];

  const beach = new THREE.Mesh(buildBeachGeometry(quality), sandMaterial);
  beach.name = 'ShaderBeach';
  beach.rotation.x = -Math.PI / 2;
  beach.position.z = 45;
  beach.receiveShadow = true;
  root.add(beach);

  // Extend only below the water, keeping every authored land vertex unchanged.
  const seabedGeometry = new THREE.PlaneGeometry(260, 180, quality === 'high' ? 220 : 150, quality === 'high' ? 24 : 16);
  const seabedPositions = seabedGeometry.attributes.position;
  for (let i = 0; i < seabedPositions.count; i++) {
    const x = seabedPositions.getX(i), t = (90 + seabedPositions.getY(i)) / 180;
    const distance = 180 * Math.pow(t, 1.65);
    seabedPositions.setY(i, distance - 90);
    seabedPositions.setZ(i, terrainHeight(x, -15) - Math.pow(distance / 180, 1.3) * 32);
  }
  seabedGeometry.computeVertexNormals();
  const seabed = new THREE.Mesh(seabedGeometry, sandMaterial);
  seabed.name = 'SubmergedSandSlope';
  seabed.rotation.x = -Math.PI / 2;
  seabed.position.z = -105;
  seabed.receiveShadow = true;
  root.add(seabed);

  const coastContinuation = new THREE.Mesh(createCoastContinuation(beach, seabed, terrainHeight), sandMaterial);
  coastContinuation.name = 'CoastContinuation';
  coastContinuation.receiveShadow = true;
  root.add(coastContinuation);

  const foam = new THREE.Mesh(
    buildFoamGeometry(beach.geometry),
    foamMaterial,
  );
  foam.name = 'ShorelineFoam';
  foam.rotation.x = -Math.PI / 2;
  foam.position.set(0, 0, BASE_FOAM_Z);
  foam.renderOrder = 4;
  root.add(foam);

  const rockClusters = [
    createRockCluster(
      root,
      random,
      rockGeometry,
      materials.rock[0],
      -24,
      8,
      11,
      14,
      1.35,
      cameraColliders,
    ),
    createRockCluster(
      root,
      random,
      rockGeometry,
      materials.rock[1],
      35,
      5,
      8,
      12,
      0.92,
      cameraColliders,
    ),
    createRockCluster(
      root,
      random,
      rockGeometry,
      materials.rock[2],
      -58,
      45,
      7,
      16,
      1.6,
      cameraColliders,
    ),
  ];

  const palmSpecs = [
    [38, 28, 0.82],
    [-4, 44, 0.72],
    [-24, 22, 0.82],
    [43, 14, 0.72],
    [-45, 45, 0.96],
  ];
  palmSpecs.forEach(([x, z, scale]) => {
    createPalm(
      root,
      random,
      new THREE.Vector3(x, terrainHeight(x, z), z),
      scale,
      frondInstances,
      trunkInstances,
      coconutInstances,
    );
    cameraColliders.push({
      type: 'circle',
      name: 'palm',
      x,
      z,
      radius: 0.34 * scale,
      minY: terrainHeight(x, z) - 0.1,
      maxY: terrainHeight(x, z) + 7.2 * scale,
    });
  });
  const palmFronds = createPalmFronds(root, materials.leaf, frondInstances, quality);
  const palmTrunks = createStaticInstanceBatch(
    root,
    createPalmTrunkGeometry(quality),
    materials.trunk,
    trunkInstances,
    'InstancedPalmTrunks',
  );
  const palmCoconuts = createStaticInstanceBatch(
    root,
    new THREE.SphereGeometry(1, quality === 'low' ? 8 : 10, quality === 'low' ? 6 : 8),
    materials.coconut,
    coconutInstances,
    'InstancedPalmCoconuts',
  );
  const contactShadows = createContactShadows(root, quality, palmSpecs);

  const fishingBoat = createFishingBoat(root, materials, quality);
  const deckChair = createDeckChair(root, materials);
  const shadeShelter = createShadeShelter(
    root,
    materials,
    cameraColliders,
    quality,
  );
  createDriftwood(root, materials);
  const boardwalk = createBoardwalk(
    root,
    materials,
    cameraColliders,
    quality,
  );
  const tidePools = createTidePools(root, quality);
  const sailboat = createDistantSailboat(root, materials);
  const street = createCoastalStreet(root, terrainHeight, quality);
  cameraColliders.push(...street.colliders);
  const details = createInstancedGroundDetails(root, random, materials, quality, boardwalk, street);
  const footprints = createFootprintTrail(root, quality);
  const birds = createCoastalGulls(root, quality);

  const boatFloor = terrainHeight(14, 20);
  cameraColliders.push(
    {
      type: 'box',
      name: 'fishing-boat',
      x: 14,
      z: 20,
      halfX: 3.15,
      halfZ: 1.2,
      rotation: -0.58,
      minY: boatFloor - 0.1,
      maxY: boatFloor + 2.5,
    },
    {
      type: 'box',
      name: 'deck-chair',
      x: -13,
      z: 27,
      halfX: 0.82,
      halfZ: 1.05,
      rotation: 0.35,
      minY: terrainHeight(-13, 27) - 0.1,
      maxY: terrainHeight(-13, 27) + 2.2,
    },
  );

  const standaloneRing = createLifeRing(materials, 0.88);
  standaloneRing.name = 'LegacyStandaloneLifeRing';
  const ringX = 23;
  const ringZ = 30;
  standaloneRing.position.set(
    ringX,
    terrainHeight(ringX, ringZ) + 0.54,
    ringZ,
  );
  standaloneRing.rotation.set(-0.25, -0.45, 0.2);
  root.add(standaloneRing);

  const lanternPost = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.09, 2.5, 8),
    materials.boatTrim,
  );
  const lanternX = 8;
  const lanternZ = 29;
  lanternPost.position.set(
    lanternX,
    terrainHeight(lanternX, lanternZ) + 1.2,
    lanternZ,
  );
  lanternPost.castShadow = true;
  root.add(lanternPost);
  cameraColliders.push({
    type: 'circle',
    name: 'lantern-post',
    x: lanternX,
    z: lanternZ,
    radius: 0.12,
    minY: terrainHeight(lanternX, lanternZ) - 0.1,
    maxY: terrainHeight(lanternX, lanternZ) + 2.5,
  });

  const lantern = new THREE.PointLight(0xff9a54, 0, 18, 2);
  lantern.position.set(
    lanternX,
    terrainHeight(lanternX, lanternZ) + 2.35,
    lanternZ,
  );
  lantern.castShadow = false;
  lantern.visible = false;
  root.add(lantern);

  const lanternGlow = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 12, 8),
    new THREE.MeshBasicMaterial({
      color: 0xffc06c,
      transparent: true,
      opacity: 0,
    }),
  );
  lanternGlow.position.copy(lantern.position);
  lanternGlow.visible = false;
  root.add(lanternGlow);

  const lanternHalo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      color: 0xff8a42,
      map: createLightGlowTexture(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: true,
    }),
  );
  lanternHalo.position.copy(lantern.position);
  lanternHalo.scale.set(3.4, 3.4, 1);
  lanternHalo.visible = false;
  root.add(lanternHalo);

  // Water's mirror camera only needs silhouettes that can read in reflection.
  // Hiding dense ground detail for that nested pass saves a second full draw.
  const reflectionExclusions = [
    beach,
    seabed,
    coastContinuation,
    street.root,
    foam,
    details.pebbles,
    details.shells,
    details.grass,
    birds,
    contactShadows,
    standaloneRing,
    lanternPost,
    lanternGlow,
    lanternHalo,
    boardwalk.planks,
    boardwalk.posts,
    boardwalk.ropes,
    boardwalk.understructure,
    deckChair,
    ...fishingBoat.children.filter((object) => object.name !== 'LoftedBoatHull'),
    tidePools,
    shadeShelter.wood,
    shadeShelter.canopy,
    ...(footprints ? [footprints] : []),
  ];
  const reflectionVisibility = new Array(reflectionExclusions.length);
  let foamStrength = 0.85;
  let foamWavePhase = 0;
  let foamWaveSpeed = 0.55;
  let detailEnabled = true;
  let lanternActive = false;
  let lanternFlickerActive = false;
  let lanternVisibilityTransitions = 0;
  let tideState = {
    mode: 'auto',
    level: 0,
    band: 'mid',
    shoreline: BASE_SHORELINE_Z,
    shorelineOffset: 0,
    waterHeight: 0,
  };

  return {
    root,
    materials,
    beach,
    foam,
    seabed,
    coastContinuation,
    street,
    sandMaterial,
    foamMaterial,
    lantern,
    lanternGlow,
    lanternHalo,
    contactShadows,
    rockClusters,
    palmFronds,
    palmTrunks,
    palmCoconuts,
    boardwalk,
    shadeShelter,
    footprints,
    tidePools,
    details,
    get cameraColliderCount() {
      return cameraColliders.length;
    },
    get reflectionExclusionCount() {
      return reflectionExclusions.length;
    },

    resolveCameraPosition(position, options) {
      return resolveCameraCollisions(cameraColliders, position, options);
    },

    registerCameraCollider(collider) {
      if (collider && !cameraColliders.includes(collider)) {
        cameraColliders.push(collider);
      }
    },

    unregisterCameraCollider(collider) {
      const index = cameraColliders.indexOf(collider);
      if (index >= 0) cameraColliders.splice(index, 1);
    },

    getWalkSurfaceHeight(x, z) {
      return boardwalk.surfaceHeightAt(x, z) ?? street.surfaceHeightAt(x, z) ?? terrainHeight(x, z);
    },

    getWalkSurfaceType(x, z) {
      return boardwalk.surfaceHeightAt(x, z) === null ? 'sand' : 'wood';
    },

    getWalkBoundaryZ(x) {
      // A slightly irregular line follows the authored foam band while keeping
      // walking feet out of the reflective ocean plane.
      return (
        BASE_WALK_BOUNDARY_Z +
        tideState.shorelineOffset +
        Math.sin(x * 0.11) * 0.55 +
        Math.sin(x * 0.035 + 1.2) * 0.25
      );
    },

    registerReflectionExclusion(object) {
      if (object && !reflectionExclusions.includes(object)) {
        reflectionExclusions.push(object);
      }
    },

    unregisterReflectionExclusion(object) {
      const index = reflectionExclusions.indexOf(object);
      if (index >= 0) reflectionExclusions.splice(index, 1);
    },

    update(elapsed, delta, atmosphere, waterTime, waveSpeed, wind) {
      // Uniform updates are centralized here; no material is recreated during
      // the frame loop or a time-of-day transition.
      sandMaterial.userData.uniforms.uSandTime.value = elapsed;
      sandMaterial.userData.uniforms.uDaylight.value = atmosphere.daylight;
      foamMaterial.userData.uniforms.uTime.value = elapsed;
      foamWavePhase = waterTime;
      foamWaveSpeed = waveSpeed;
      foamMaterial.userData.uniforms.uWavePhase.value = foamWavePhase;
      foamMaterial.userData.uniforms.uStrength.value =
        foamStrength * (0.72 + atmosphere.daylight * 0.28);

      const windPhase = wind?.phase ?? elapsed;
      const windFactor = wind?.factor ?? 1;
      street.update(atmosphere.night, windPhase, windFactor);
      palmFronds.update(windPhase, windFactor);
      materials.grass.userData.uniforms.uGrassTime.value = windPhase;
      materials.grass.userData.uniforms.uWindStrength.value =
        (quality === 'high' ? 1 : 0.62) * windFactor;
      materials.grass.userData.uniforms.uGrassDaylight.value =
        atmosphere.daylight;

      sailboat.position.y = tideState.waterHeight + 0.18 + Math.sin(waterTime * 0.72) * 0.09;
      sailboat.rotation.z = Math.sin(waterTime * 0.48) * 0.018;
      sailboat.rotation.x = Math.cos(waterTime * 0.55) * 0.012;

      birds.update(elapsed);
      birds.visible = atmosphere.daylight > .3;

      fishingBoat.rotation.z = 0.06 + Math.sin(elapsed * 0.35) * 0.002;
      const nextLanternActive = hasVisibleAtmosphereContribution(
        atmosphere.night,
      );
      if (nextLanternActive !== lanternActive) {
        lanternActive = nextLanternActive;
        lanternVisibilityTransitions += 1;
      }
      lantern.visible = lanternActive;
      lanternGlow.visible = lanternActive;
      lanternHalo.visible = lanternActive;
      lantern.intensity = lanternActive ? atmosphere.night * 12 : 0;
      lanternFlickerActive = lanternActive;
      if (lanternActive) {
        const lanternFlicker = 0.92 + Math.sin(elapsed * 6.4) * 0.08;
        lanternGlow.material.opacity = atmosphere.night;
        lanternGlow.scale.setScalar(lanternFlicker);
        lanternHalo.material.opacity =
          atmosphere.night * 0.38 * lanternFlicker;
        lanternHalo.scale.setScalar(3.3 + Math.sin(elapsed * 4.8) * 0.12);
      } else {
        lanternGlow.material.opacity = 0;
        lanternHalo.material.opacity = 0;
      }
    },

    getLanternState() {
      return {
        active: lanternActive,
        flickerActive: lanternFlickerActive,
        threshold: ATMOSPHERE_VISIBILITY_THRESHOLD,
        visibilityTransitions: lanternVisibilityTransitions,
        lightVisible: lantern.visible,
        glowVisible: lanternGlow.visible,
        haloVisible: lanternHalo.visible,
        intensity: Number(lantern.intensity.toFixed(3)),
        glowOpacity: Number(lanternGlow.material.opacity.toFixed(3)),
        haloOpacity: Number(lanternHalo.material.opacity.toFixed(3)),
        drawObjects: Number(lanternGlow.visible) + Number(lanternHalo.visible),
        lightUuid: lantern.uuid,
        glowUuid: lanternGlow.uuid,
        haloUuid: lanternHalo.uuid,
      };
    },

    setFoamStrength(value) {
      foamStrength = value;
    },

    getFoamState() {
      return {
        linkedToWater: true,
        wavePhase: Number(foamWavePhase.toFixed(3)),
        waveSpeed: Number(foamWaveSpeed.toFixed(2)),
        strength: Number(foamStrength.toFixed(2)),
        waveTravel: 0.91,
        shaderLinked: foamMaterial.fragmentShader.includes('uWavePhase'),
      };
    },

    setTideState(level, shorelineOffset, waterHeight, mode, band) {
      tideState.level = level;
      tideState.shorelineOffset = shorelineOffset;
      tideState.shoreline = BASE_SHORELINE_Z + shorelineOffset;
      tideState.waterHeight = waterHeight;
      tideState.mode = mode;
      tideState.band = band;
      foamMaterial.userData.uniforms.uWaterHeight.value = waterHeight;
      sandMaterial.userData.uniforms.uWaterHeight.value = waterHeight;
      sandMaterial.userData.uniforms.uShoreline.value =
        BASE_SHORELINE_Z + tideState.shorelineOffset;
    },

    getTideState() {
      return { ...tideState };
    },

    setDetailEnabled(enabled) {
      detailEnabled = enabled;
      details.shells.visible = detailEnabled;
      details.grass.castShadow = detailEnabled;
      tidePools.visible = detailEnabled;
      if (footprints) footprints.visible = detailEnabled;
      palmCoconuts.visible = detailEnabled;
    },

    setTimeColors({ drySand, wetSand, foam, foamTint }) {
      sandMaterial.userData.uniforms.uDrySandColor.value.set(drySand);
      sandMaterial.userData.uniforms.uWetSandColor.value.set(wetSand);
      foamMaterial.userData.uniforms.uColor.value.set(foam);
      foamMaterial.userData.uniforms.uTint.value.set(foamTint);
    },

    beginReflectionPass() {
      for (let index = 0; index < reflectionExclusions.length; index += 1) {
        const object = reflectionExclusions[index];
        reflectionVisibility[index] = object.visible;
        object.visible = false;
      }
    },

    endReflectionPass() {
      for (let index = 0; index < reflectionExclusions.length; index += 1) {
        reflectionExclusions[index].visible = reflectionVisibility[index];
      }
    },

    dispose() {
      disposeObjectTree(root);
    },
  };
}

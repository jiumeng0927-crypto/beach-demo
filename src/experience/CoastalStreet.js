import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { COASTAL_PALETTE as palette, addCoastalSurfaceDetail } from './CoastalStyle.js';
import { coastContinuationHeight } from './CoastBoundary.js';

export const STREET_WALK_MAX_Z = 87;
export const STREET_HALF_LENGTH = 52;
export const STREET_SHOPS = Object.freeze([
  Object.freeze({ id: 'cafe', title: '海风咖啡', subtitle: 'COFFEE & SODA', x: -26, z: 80, width: 10, depth: 7, color: palette.coral }),
  Object.freeze({ id: 'surf', title: '浪间冲浪', subtitle: 'SURF & RENTAL', x: -6, z: 80, width: 11, depth: 7, color: palette.seaGlass }),
  Object.freeze({ id: 'market', title: '潮岸小铺', subtitle: 'BEACH MARKET', x: 17, z: 80, width: 10, depth: 7, color: palette.sage }),
]);

export function streetCenterZ(x) {
  return 65 + Math.max(0, Math.abs(x) - 55) ** 2 * 0.003;
}

// The whole cross-section clears the undisturbed dunes; the visual mesh and
// grounded camera interpolate the same samples rather than two height fields.
export function createStreetProfile(terrainHeight, quality) {
  const xs = [0];
  const step = quality === 'high' ? 2 : 4;
  for (let x = step; x <= STREET_HALF_LENGTH; x += step) xs.push(x);
  const samples = [...xs.slice(1).reverse().map(x => -x), ...xs].map(x => {
    const z = streetCenterZ(x);
    let y = -Infinity;
    for (let offset = -7; offset <= 7; offset++) {
      y = Math.max(y, coastContinuationHeight(x, z + offset, terrainHeight));
    }
    return { x, z, y: y + 0.16 };
  });
  return {
    samples,
    sampleAt(x) {
      if (x < samples[0].x || x > samples.at(-1).x) return null;
      let lo = 0, hi = samples.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (samples[mid].x > x) hi = mid; else lo = mid;
      }
      const a = samples[lo], b = samples[hi], t = (x - a.x) / (b.x - a.x);
      return { z: THREE.MathUtils.lerp(a.z, b.z, t), y: THREE.MathUtils.lerp(a.y, b.y, t) };
    },
  };
}

function makeRibbon(samples, bands) {
  const positions = [], colors = [], uv = [], indices = [];
  for (const [a, b, liftA, liftB, color] of bands) {
    const start = positions.length / 3, tint = new THREE.Color(color);
    for (const p of samples) {
      positions.push(p.x, p.y + (typeof liftA === 'function' ? liftA(p) : liftA), p.z + a,
        p.x, p.y + (typeof liftB === 'function' ? liftB(p) : liftB), p.z + b);
      colors.push(...tint.toArray(), ...tint.toArray());
      uv.push(p.x, a, p.x, b);
    }
    for (let i = 0; i < samples.length - 1; i++) {
      const j = start + i * 2;
      indices.push(j, j + 1, j + 2, j + 1, j + 3, j + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(positions.length), 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

function createRoadMaterial() {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, envMapIntensity: 0.35 });
  material.name = 'CoastalAsphalt';
  material.onBeforeCompile = shader => {
    shader.vertexShader = `varying vec2 vRoad;\n${shader.vertexShader}`.replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoad = uv;');
    shader.fragmentShader = `varying vec2 vRoad;\n${shader.fragmentShader}`.replace('#include <color_fragment>', `
      #include <color_fragment>
      float aa = max(fwidth(vRoad.y), 0.01);
      float asphalt = 1.0 - smoothstep(3.65, 3.7, abs(vRoad.y));
      float edge = (1.0 - smoothstep(0.055, 0.055 + aa, abs(abs(vRoad.y) - 3.25))) * asphalt;
      float dashAA = max(fwidth(vRoad.x), 0.01);
      float dash = 1.0 - smoothstep(1.4, 1.4 + dashAA, abs(mod(vRoad.x + 3.5, 7.0) - 3.5));
      float crossing = 1.0 - smoothstep(2.5, 2.5 + dashAA, abs(vRoad.x + 6.0));
      float stripe = 1.0 - smoothstep(0.27, 0.27 + aa, abs(mod(vRoad.y + 0.6, 1.2) - 0.6));
      float center = (1.0 - smoothstep(0.07, 0.07 + aa, abs(vRoad.y))) * dash * (1.0 - crossing);
      float paint = max(edge, max(center, crossing * stripe * asphalt));
      float grain = fract(sin(dot(floor(vRoad * 38.0), vec2(127.1, 311.7))) * 43758.5453);
      grain = mix(grain, 0.5, smoothstep(0.4, 1.3, length(fwidth(vRoad * 38.0))));
      diffuseColor.rgb *= 0.94 + grain * 0.12;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.72, 0.73, 0.66), paint * 0.88);
    `);
    material.userData.compiled = true;
  };
  material.customProgramCacheKey = () => 'coastal-road-v1';
  return material;
}

function createShopSign(spec) {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 160;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#e5e7df'; ctx.fillRect(0, 0, 512, 160);
  ctx.strokeStyle = '#526260'; ctx.lineWidth = 4; ctx.strokeRect(9, 9, 494, 142);
  ctx.fillStyle = '#283c3c'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '600 52px "Microsoft YaHei", sans-serif'; ctx.fillText(spec.title, 256, 63);
  ctx.font = '21px sans-serif'; ctx.fillText(spec.subtitle, 256, 118);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.name = `StreetSign-${spec.id}`;
  return new THREE.MeshStandardMaterial({ map: texture, roughness: 0.82, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 0 });
}

export function createCoastalStreet(parent, terrainHeight, quality = 'high') {
  const root = new THREE.Group(); root.name = 'CoastalStreet'; parent.add(root);
  const profile = createStreetProfile(terrainHeight, quality);
  const roadMaterial = createRoadMaterial();
  const shoulder = side => p => coastContinuationHeight(p.x, p.z + side * 7, terrainHeight) + 0.025 - p.y;
  const roadBands = [[-7, -6, shoulder(-1), 0.1, 0x92998d],
    [-6, -3.7, 0.10, 0.10, 0x9da49f], [-3.7, -3.7, 0.10, 0, 0xadb5ae],
    [-3.7, 0, 0, 0.06, 0x42494a], [0, 3.7, 0.06, 0, 0x42494a],
    [3.7, 3.7, 0, 0.10, 0xadb5ae], [3.7, 6, 0.10, 0.10, 0x9da49f],
    [6, 7, 0.1, shoulder(1), 0x92998d]];
  const roads = [];
  const road = new THREE.Mesh(makeRibbon(profile.samples, roadBands), roadMaterial);
  road.name = 'CoastalRoad'; road.receiveShadow = true; root.add(road); roads.push(road);
  const stone = new THREE.MeshStandardMaterial({ color: 0xa4aaa2, roughness: 0.94 });
  const chalk = addCoastalSurfaceDetail(new THREE.MeshStandardMaterial({ color: palette.chalk, roughness: 0.9 }), 'plaster');
  const metal = new THREE.MeshStandardMaterial({ color: 0x36484a, roughness: 0.52, metalness: 0.45 });
  const wood = addCoastalSurfaceDetail(new THREE.MeshStandardMaterial({ color: palette.timber, roughness: 0.8 }), 'wood');
  const glass = new THREE.MeshStandardMaterial({ color: 0x315a60, metalness: 0.22, roughness: 0.22,
    emissive: 0xffd9a1, emissiveIntensity: 0 });
  const lampGlass = new THREE.MeshStandardMaterial({ color: 0xe9eddb, roughness: 0.5, emissive: 0xffdcaa, emissiveIntensity: 0 });
  const shopFloors = [], colliders = [], signs = [];
  const batches = new Map();
  const box = (owner, material, size, position, rotation = [0, 0, 0]) => {
    const geometry = new THREE.BoxGeometry(...size);
    geometry.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(1, 1, 1)));
    let byMaterial = batches.get(owner); if (!byMaterial) { byMaterial = new Map(); batches.set(owner, byMaterial); }
    if (!byMaterial.has(material)) byMaterial.set(material, []);
    byMaterial.get(material).push(geometry);
  };
  for (const spec of STREET_SHOPS) {
    const shop = new THREE.Group(); shop.name = `StreetShop-${spec.id}`; root.add(shop);
    let floor = -Infinity;
    for (let x = -spec.width / 2 - 1; x <= spec.width / 2 + 1; x++) for (let z = -5; z <= 4; z++) {
      floor = Math.max(floor, terrainHeight(spec.x + x, spec.z + z));
    }
    floor += 0.14;
    shop.position.set(spec.x, floor, spec.z);
    const w = spec.width, d = spec.depth;
    const accent = addCoastalSurfaceDetail(new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.8 }), 'cloth');
    box(shop, stone, [w + 1.2, 0.4, d + 2.8], [0, -0.14, -0.6]);
    box(shop, chalk, [w, 3.9, d], [0, 1.95, 0]);
    box(shop, accent, [w + 0.1, 0.5, d + 0.1], [0, 0.35, 0]);
    // Two roof pitches, a ridge cap and repeated standing seams give a readable silhouette.
    const angle = 0.24, roofDepth = (d / 2 + 0.55) / Math.cos(angle);
    for (const side of [-1, 1]) {
      box(shop, metal, [w + 1.15, 0.16, roofDepth], [0, 4.23, side * (d / 4 + 0.22)], [side * angle, 0, 0]);
      for (let x = -w / 2; x <= w / 2; x += quality === 'high' ? 1.25 : 2.5) {
        box(shop, metal, [0.035, 0.06, roofDepth], [x, 4.34, side * (d / 4 + 0.22)], [side * angle, 0, 0]);
      }
    }
    box(shop, metal, [w + 1.2, 0.12, 0.24], [0, 4.75, 0]);
    box(shop, wood, [w + 0.55, 0.2, 0.22], [0, 3.8, -d / 2 - 0.15]);
    // Close the gable ends under the two roof pitches, including the back view.
    const gableShape = new THREE.Shape();
    gableShape.moveTo(-d / 2, 0); gableShape.lineTo(d / 2, 0); gableShape.lineTo(0, 0.87); gableShape.closePath();
    for (const side of [-1, 1]) {
      const gable = new THREE.ExtrudeGeometry(gableShape, { depth: 0.16, bevelEnabled: false });
      gable.rotateY(Math.PI / 2).translate(side * w / 2 - 0.08, 3.86, 0);
      batches.get(shop).get(chalk).push(mergeVertices(gable)); gable.dispose();
      box(shop, wood, [w + 0.8, 0.22, 0.2], [0, 3.82, side * (d / 2 + 0.42)]);
      box(shop, metal, [0.14, 3.7, 0.14], [side * (w / 2 + 0.14), 1.85, d / 2 + 0.1]);
      box(shop, chalk, [0.14, 3.85, 0.2], [side * (w / 2 - 0.02), 1.94, -d / 2 - 0.12]);
      box(shop, metal, [0.14, 1.7, 2.1], [side * (w / 2 + 0.09), 2.05, 0.25]);
      box(shop, glass, [0.035, 1.45, 1.86], [side * (w / 2 + 0.17), 2.05, 0.25]);
      box(shop, chalk, [0.09, 1.5, 0.08], [side * (w / 2 + 0.20), 2.05, 0.25]);
      box(shop, wood, [0.38, 0.15, 2.35], [side * (w / 2 + 0.15), 1.18, 0.25]);
    }
    // Opaque tinted glazing avoids transparent sorting and a second transmission pass.
    for (const x of [-w * 0.29, w * 0.29]) {
      box(shop, metal, [2.8, 2.25, 0.18], [x, 1.72, -d / 2 - 0.12]);
      box(shop, glass, [2.55, 2.02, 0.05], [x, 1.72, -d / 2 - 0.23]);
      box(shop, chalk, [0.08, 2.08, 0.10], [x, 1.72, -d / 2 - 0.28]);
      box(shop, chalk, [2.65, 0.10, 0.10], [x, 1.78, -d / 2 - 0.28]);
      box(shop, wood, [3.0, 0.14, 0.36], [x, 0.57, -d / 2 - 0.25]);
    }
    box(shop, metal, [1.5, 2.6, 0.20], [0, 1.32, -d / 2 - 0.13]);
    box(shop, glass, [1.25, 2.34, 0.05], [0, 1.32, -d / 2 - 0.26]);
    box(shop, chalk, [0.07, 0.55, 0.08], [0.42, 1.25, -d / 2 - 0.32]);
    for (let i = 0; i < 12; i++) {
      const x = -w / 2 + w / 24 + i * w / 12;
      box(shop, i % 2 ? chalk : accent, [w / 12, 0.065, 1.55], [x, 3.04, -d / 2 - 0.8], [-0.18, 0, 0]);
      box(shop, i % 2 ? chalk : accent, [w / 12, 0.25, 0.07], [x, 2.8, -d / 2 - 1.55]);
    }
    for (const x of [-w / 2 + 0.16, w / 2 - 0.16]) {
      box(shop, wood, [0.11, 2.84, 0.11], [x, 1.42, -d / 2 - 1.48]);
      box(shop, wood, [0.09, 0.92, 0.09], [x, 2.45, -d / 2 - 1.2], [-0.55, 0, 0]);
      colliders.push({ type: 'circle', name: 'street-awning-post', x: spec.x + x, z: spec.z - d / 2 - 1.48,
        radius: 0.09, minY: floor, maxY: floor + 2.9 });
    }
    // Different street-facing details identify each business without extra UI.
    if (spec.id === 'cafe') {
      box(shop, wood, [2.3, 0.16, 0.85], [w * 0.29, 1.05, -d / 2 - 0.72]);
      colliders.push({ type: 'box', name: 'street-cafe-counter', x: spec.x + w * 0.29, z: spec.z - d / 2 - 1,
        halfX: 1.2, halfZ: 0.8, rotation: 0, minY: floor, maxY: floor + 1.2 });
      for (const x of [w * 0.29 - 0.62, w * 0.29 + 0.62]) {
        box(shop, wood, [0.5, 0.1, 0.5], [x, 0.64, -d / 2 - 1.4]);
        for (const dx of [-0.18, 0.18]) box(shop, metal, [0.06, 0.58, 0.35], [x + dx, 0.3, -d / 2 - 1.4]);
      }
    } else if (spec.id === 'market') {
      box(shop, wood, [2.75, 0.16, 0.65], [-w * 0.29, 1.1, -d / 2 - 0.62]);
      for (let i = 0; i < 8; i++) box(shop, i % 2 ? accent : chalk, [0.19, 0.3 + (i % 3) * 0.08, 0.19],
        [-w * 0.29 - 1.05 + i * 0.3, 1.32, -d / 2 - 0.62]);
    }
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 1.25), createShopSign(spec));
    sign.position.set(0, 3.7, -d / 2 - 1.62); sign.rotation.y = Math.PI;
    for (const x of [-1.6, 1.6]) box(shop, metal, [0.07, 0.07, 1.5], [x, 3.44, -d / 2 - 0.9]);
    sign.name = `ShopSign-${spec.id}`; shop.add(sign); signs.push(sign.material);
    colliders.push({ type: 'box', name: `street-shop-${spec.id}`, x: spec.x, z: spec.z,
      halfX: w / 2 + 0.06, halfZ: d / 2 + 0.33, rotation: 0, minY: floor - 0.4, maxY: floor + 4.85 });
    shopFloors.push({ x: spec.x, z: spec.z, halfX: w / 2 + 0.6, minZ: -d / 2 - 2, maxZ: d / 2 + 0.8, y: floor + 0.06 });
    // Shop-to-sidewalk aprons slope continuously up from the street.
    const apronXs = [spec.x - w / 2 - 0.6, ...profile.samples.map(p => p.x).filter(x => Math.abs(x - spec.x) < w / 2 + 0.6), spec.x + w / 2 + 0.6];
    const apron = makeRibbon(apronXs.map(x => ({ x, y: 0, z: 0 })),
      [[71, spec.z - d / 2 - 2, p => profile.sampleAt(p.x).y + 0.1, floor + 0.06, 0xa4aaa2]]);
    const apronMesh = new THREE.Mesh(apron, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
    apronMesh.name = 'ShopApron'; apronMesh.receiveShadow = true; root.add(apronMesh);
    if (spec.id === 'surf') {
      for (let i = 0; i < 3; i++) {
        const board = new THREE.SphereGeometry(1, quality === 'high' ? 12 : 8, 6);
        board.scale(0.34, 1.22, 0.10); board.rotateZ(-0.12 + i * 0.12); board.translate(-4 + i * 0.78, 1.32, -d / 2 - 0.5);
        if (!batches.get(shop).has(accent)) batches.get(shop).set(accent, []);
        batches.get(shop).get(accent).push(board);
      }
    } else {
      for (const x of spec.id === 'cafe' ? [-w * 0.29] : [-w * 0.29, w * 0.29]) {
        box(shop, wood, [2.4, 0.13, 0.65], [x, 0.64, -d / 2 - 1.5]);
        for (const dx of [-0.86, 0.86]) box(shop, metal, [0.12, 0.60, 0.5], [x + dx, 0.32, -d / 2 - 1.5]);
        colliders.push({ type: 'box', name: 'street-bench', x: spec.x + x, z: spec.z - d / 2 - 1.5,
          halfX: 1.2, halfZ: 0.36, rotation: 0, minY: floor, maxY: floor + 0.8 });
      }
    }
  }
  const lamps = new THREE.Group(); lamps.name = 'StreetLamps'; root.add(lamps);
  for (const x of [-42, -16, 10, 36]) {
    const ground = profile.sampleAt(x), z = ground.z + 5.3, y = ground.y + 0.1;
    box(lamps, metal, [0.12, 4.7, 0.12], [x, y + 2.35, z]);
    box(lamps, metal, [0.9, 0.1, 0.1], [x + 0.4, y + 4.65, z]);
    box(lamps, metal, [0.65, 0.10, 0.4], [x + 0.72, y + 4.60, z]);
    box(lamps, lampGlass, [0.52, 0.05, 0.29], [x + 0.72, y + 4.52, z]);
    colliders.push({ type: 'circle', name: 'street-lamp', x, z, radius: 0.14, minY: y, maxY: y + 4.75 });
  }
  for (const [owner, byMaterial] of batches) for (const [material, geometries] of byMaterial) {
    const geometry = mergeGeometries(geometries, false); geometries.forEach(g => g.dispose());
    const mesh = new THREE.Mesh(geometry, material); mesh.name = 'StreetArchitecture';
    mesh.castShadow = quality === 'high'; mesh.receiveShadow = true; owner.add(mesh);
  }
  // One gently ramped beach access, aligned to the painted crossing at x=-6.
  const pathSamples = Array.from({ length: 19 }, (_, i) => {
    const z = 42 + i * 0.95;
    const blend = THREE.MathUtils.smoothstep(z, 54, 59.1);
    const streetY = profile.sampleAt(-6).y + 0.1;
    return { x: z, z: 6, y: THREE.MathUtils.lerp(terrainHeight(-6, z) + 0.05, streetY, blend) };
  });
  const accessGeometry = makeRibbon(pathSamples, [[-1.5, 1.5, 0, 0, 0x9da49f]]);
  accessGeometry.rotateY(Math.PI / 2);
  // Rotation maps (z,y,6) to (6,y,-z); mirror into the authored access direction.
  accessGeometry.scale(-1, 1, -1); accessGeometry.computeVertexNormals();
  const access = new THREE.Mesh(accessGeometry, stone); access.name = 'StreetBeachAccess'; access.receiveShadow = true; root.add(access);
  const surfaceHeightAt = (x, z) => {
    const p = profile.sampleAt(x);
    if (p && Math.abs(z - p.z) <= 6) {
      const across = Math.abs(z - p.z);
      return p.y + (across >= 3.7 ? 0.1 : 0.06 * (1 - across / 3.7));
    }
    for (const f of shopFloors) if (Math.abs(x - f.x) <= f.halfX && z >= 71 && z <= f.z + f.maxZ) {
      const apronEnd = f.z + f.minZ;
      if (z >= apronEnd) return f.y;
      // Match the two triangles of the apron cell, including its diagonal.
      const xs = [f.x - f.halfX, ...profile.samples.map(p => p.x).filter(px => Math.abs(px - f.x) < f.halfX), f.x + f.halfX];
      const end = xs.findIndex(px => px >= x && px > xs[0]);
      const left = xs[Math.max(0, end - 1)], right = xs[Math.max(1, end)];
      const u = (x - left) / (right - left), v = (z - 71) / (apronEnd - 71);
      const a = profile.sampleAt(left).y + 0.1, b = profile.sampleAt(right).y + 0.1;
      return u + v <= 1 ? a + u * (b - a) + v * (f.y - a) : f.y + (1 - v) * (b - f.y);
    }
    if (Math.abs(x + 6) <= 1.5 && z >= 42 && z <= 59.1) {
      const i = Math.min(pathSamples.length - 2, Math.floor((z - 42) / 0.95));
      return THREE.MathUtils.lerp(pathSamples[i].y, pathSamples[i + 1].y, (z - pathSamples[i].x) / 0.95);
    }
    return null;
  };
  const frustum = new THREE.Frustum(), projection = new THREE.Matrix4(), cullable = [];
  root.updateWorldMatrix(true, true);
  root.traverse(mesh => {
    // Long, shallow street batches have spheres that extend far outside their
    // actual geometry. Use tight boxes only where no off-screen shadows depend on them.
    if (!mesh.isMesh || mesh.castShadow) return;
    if (mesh.isInstancedMesh) mesh.computeBoundingBox(); else mesh.geometry.computeBoundingBox();
    const bounds = (mesh.isInstancedMesh ? mesh.boundingBox : mesh.geometry.boundingBox).clone()
      .applyMatrix4(mesh.matrixWorld).expandByScalar(0.2);
    mesh.frustumCulled = false;
    cullable.push({ mesh, bounds });
  });
  return {
    root, roads, profile, colliders, shopFloors, surfaceHeightAt,
    updateVisibility(camera) {
      camera.updateMatrixWorld();
      frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      for (const { mesh, bounds } of cullable) mesh.visible = frustum.intersectsBox(bounds);
    },
    clearVegetation(x, z, radius) {
      if (z > 41 - radius && z < 59.5 + radius && Math.abs(x + 6) < 1.5 + radius) x = -7.6 - radius;
      const p = profile.sampleAt(x);
      if (p && Math.abs(z - p.z) < 6.5 + radius) z = p.z - 6.6 - radius;
      for (const f of shopFloors) if (Math.abs(x - f.x) < f.halfX + radius && z > 71 - radius && z < f.z + f.maxZ + radius) z = f.z + f.maxZ + radius + 0.2;
      return [x, z];
    },
    update(night, elapsed = 0, windFactor = 1) {
      glass.emissiveIntensity = night * 0.38;
      lampGlass.emissiveIntensity = night * 2.5;
      for (const material of signs) material.emissiveIntensity = night * 0.35;
    },
  };
}

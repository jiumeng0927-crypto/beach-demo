import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { terrainHeight } from './world.js';
import { assetUrl } from './assetUrl.js';
import { addCoastalSurfaceDetail, COASTAL_PALETTE as palette, styleCoastalAsset } from './CoastalStyle.js';

// Rest on the west, activity in the center, equipment east of the boardwalk.
export const EQUIPMENT_ZONE = Object.freeze({ x: 38, z: 24, yaw: -0.22 });
export const COASTAL_PLACEMENTS = {
  wooden_picnic_table: [
    { x: -21, z: 26, span: 4.2, yaw: -0.22, solid: true },
    { x: -25, z: 30, span: 4.2, yaw: 0.38, solid: true },
  ],
  wooden_crate_02: [
    { x: 37, z: 28.5, span: 1.5, yaw: 0.2, solid: true },
    { x: 38.8, z: 28.8, span: 1.2, yaw: -0.15, solid: true },
    { x: 20.5, z: 72.6, span: 1.2, yaw: 0.08, solid: true, surface: 'street' },
    { x: 18.9, z: 72.4, span: 1.0, yaw: -0.14, solid: true, surface: 'street' },
  ],
  plastic_crate_01: [
    { x: 40.5, z: 28.2, span: 1.3, yaw: 0.28, solid: true },
    { x: 40.6, z: 26.5, span: 1.3, yaw: -0.18, solid: true },
    { x: -24.1, z: 25.1, span: 1.1, yaw: -0.3, solid: true },
  ],
  lifebuoy: [
    { x: 40.5, z: 23, span: 1.65, yaw: -0.45, pitch: -1.5 },
    { x: -22.2, z: 31.2, span: 1.25, yaw: -0.5, pitch: -1.35 },
  ],
  lambis_shell: [
    { x: 6, z: 12.5, span: 0.8, yaw: 1.2 },
    { x: 7.1, z: 12.8, span: 0.45, yaw: -0.4 },
    { x: -12, z: 12.5, span: 0.7, yaw: 0.3 },
    { x: 25.5, z: 13.5, span: 0.6, yaw: 2.2 },
  ],
  boulder_01: [
    { x: -33, z: 14, span: 4, yaw: 0.8, embed: 0.32, solid: true },
    { x: 29.5, z: 14, span: 3.6, yaw: -0.5, embed: 0.3, solid: true },
    { x: -30, z: 17, span: 1.8, yaw: 2.4, embed: 0.16, solid: true },
  ],
  outdoor_table_chair_set_01: [
    { x: -26, z: 73.1, span: 2.7, yaw: 0, solid: true, surface: 'street' },
    { x: -29.3, z: 73.1, span: 2.7, yaw: 0.15, solid: true, surface: 'street' },
    { x: 17, z: 44, span: 2.7, yaw: -0.18, solid: true },
  ],
  planter_box_01: [
    { x: -33.6, z: 77, span: 1.6, yaw: 0.1, solid: true, surface: 'street' },
    { x: 24.6, z: 77, span: 1.6, yaw: -0.1, solid: true, surface: 'street' },
  ],
};

function resourcesOf(root) {
  const geometries = new Set(), materials = new Set(), textures = new Set(), images = new Set();
  root.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    const list = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of list.filter(Boolean)) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) {
        textures.add(value);
        if (value.source?.data?.close) images.add(value.source.data);
      }
    }
  });
  return { geometries, materials, textures, images };
}

function release(resources) {
  for (const kind of ['geometries', 'materials', 'textures']) for (const item of resources[kind]) item.dispose();
  for (const image of resources.images) image.close();
}

function colored(geometry, color) {
  const data = new Float32Array(geometry.attributes.position.count * 3);
  const value = new THREE.Color(color);
  for (let i = 0; i < data.length; i += 3) value.toArray(data, i);
  geometry.setAttribute('color', new THREE.BufferAttribute(data, 3));
  return geometry;
}

function mergeParts(parts) {
  const compatible = parts.map((g) => {
    const result = g.index ? g.toNonIndexed() : g.clone();
    result.deleteAttribute('uv');
    g.dispose();
    return result;
  });
  const merged = mergeGeometries(compatible, false);
  compatible.forEach((g) => g.dispose());
  return merged;
}

function createUmbrella(color) {
  const positions = [], colors = [], indices = [];
  const panels = 8, steps = 4, rings = 5, radius = 2.8;
  for (let sector = 0; sector < panels; sector++) {
    const tint = new THREE.Color(sector % 2 ? palette.chalk : color);
    const start = positions.length / 3;
    for (let r = 0; r <= rings; r++) for (let j = 0; j <= steps; j++) {
      const angle = (sector + j / steps) / panels * Math.PI * 2;
      const distance = radius * r / rings;
      const y = 4.25 - 0.72 * (r / rings) ** 1.5
        - 0.12 * Math.sin(j / steps * Math.PI) * (r / rings) ** 2;
      positions.push(Math.cos(angle) * distance, y, Math.sin(angle) * distance);
      colors.push(tint.r, tint.g, tint.b);
      if (r < rings && j < steps) {
        const a = start + r * (steps + 1) + j, b = a + steps + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const edge = start + rings * (steps + 1), hem = positions.length / 3;
    for (let j = 0; j <= steps; j++) {
      const top = (edge + j) * 3;
      const drop = 0.14 + Math.sin(j / steps * Math.PI) * 0.08;
      positions.push(positions[top], positions[top + 1] - drop, positions[top + 2]);
      colors.push(tint.r * 0.96, tint.g * 0.96, tint.b * 0.96);
      if (j < steps) indices.push(edge + j, hem + j, edge + j + 1, edge + j + 1, hem + j, hem + j + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

const SURFBOARD_PROFILE = [
  [0, -1.65], [0.25, -1.56], [0.4, -1.2], [0.48, -0.7], [0.51, -0.1],
  [0.5, 0.42], [0.43, 0.9], [0.3, 1.26], [0.16, 1.5], [0, 1.65],
];

function boardRocker(y) {
  return 0.12 * (y / 1.65) ** 2 + 0.025 * y / 1.65;
}

export function createSurfboardBody() {
  const geometry = new THREE.LatheGeometry(SURFBOARD_PROFILE.map(([r, y]) => new THREE.Vector2(r, y)), 20);
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    positions.setZ(i, positions.getZ(i) * 0.22 + boardRocker(positions.getY(i)));
  }
  geometry.computeVertexNormals();
  return geometry;
}

function createBoardStringer() {
  const positions = [], indices = [];
  // Use the same profile rings as the deck so the inlay stays flush on its facets.
  for (let i = 1; i < SURFBOARD_PROFILE.length - 1; i++) {
    const [radius, y] = SURFBOARD_PROFILE[i];
    const z = (radius - 0.022 * Math.tan(Math.PI / 20)) * 0.22 + boardRocker(y) + 0.003;
    positions.push(-0.022, y, z, 0.022, y, z);
    if (i > 1) {
      const a = (i - 2) * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export class CoastalProps {
  constructor({ scene, world, quality = 'high' }) {
    this.root = new THREE.Group();
    this.root.name = 'CuratedCoastalProps';
    this.reflectedRoot = new THREE.Group();
    this.reflectedRoot.name = 'CuratedShoreRockReplacement';
    this.scene = scene;
    this.world = null;
    this.quality = quality;
    this.shadows = quality === 'high';
    this.disposed = false;
    this.loaded = [];
    this.errors = [];
    this.colliders = [];
    this.placements = [];
    this.sourceRoots = [];
    this.waterHeight = { value: world.getTideState().waterHeight };
    this.vegetationBounds = [];
    this.controller = new AbortController();
    this.createBeachEquipment();
    scene.add(this.root, this.reflectedRoot);
    this.bindWorld(world);
    this.ready = this.load();
  }

  async load() {
    const loader = new GLTFLoader();
    const timer = setTimeout(() => this.controller.abort(), 15000);
    try {
      await Promise.all(Object.entries(COASTAL_PLACEMENTS).map(async ([id, specs]) => {
        try {
          const directory = specs[0]?.surface === 'street' ? 'street' : 'coastal';
          const response = await fetch(assetUrl(`models/${directory}/${id}.glb`), { signal: this.controller.signal });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const gltf = await loader.parseAsync(await response.arrayBuffer(), '');
          if (this.disposed) { release(resourcesOf(gltf.scene)); return; }
          this.sourceRoots.push(gltf.scene);
          this.addAsset(id, gltf.scene, specs);
          this.loaded.push(id);
          if (id === 'lifebuoy') this.world.root.getObjectByName('LegacyStandaloneLifeRing').visible = false;
        } catch (error) {
          if (!this.disposed) this.errors.push({ id, message: String(error.message) });
        }
      }));
    } finally {
      clearTimeout(timer);
      if (!this.disposed) this.world.details.clearVegetation(this.vegetationBounds);
    }
  }

  addAsset(id, source, specs) {
    styleCoastalAsset(source, id, this.waterHeight);
    source.updateMatrixWorld(true);
    const box = new THREE.Box3();
    source.traverse((mesh) => {
      if (mesh.isMesh && !mesh.name.includes('CoastalShoreLOD')) box.expandByObject(mesh, true);
    });
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const span = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(span) || span <= 0) throw new Error('Invalid model bounds');
    const normalization = new THREE.Matrix4().makeScale(1 / span, 1 / span, 1 / span)
      .multiply(new THREE.Matrix4().makeTranslation(-center.x, -box.min.y, -center.z));
    const normalizedBounds = box.clone().applyMatrix4(normalization);
    const vertices = [], point = new THREE.Vector3();
    source.traverse((mesh) => {
      if (!mesh.isMesh || mesh.name.includes('CoastalShoreLOD')) return;
      const transform = normalization.clone().multiply(mesh.matrixWorld);
      const positions = mesh.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i).applyMatrix4(transform);
        vertices.push(point.x, point.y, point.z);
      }
    });
    const transforms = specs.map((spec, index) => {
      const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(spec.pitch ?? 0, spec.yaw, 0));
      const matrix = new THREE.Matrix4().compose(new THREE.Vector3(), rotation, new THREE.Vector3().setScalar(spec.span));
      const bounds = normalizedBounds.clone().applyMatrix4(matrix);
      // Rotated AABB corners can hang below every actual vertex (e.g. a ring).
      // Ground the real mesh, not that conservative box.
      let minY = Infinity;
      for (let i = 0; i < vertices.length; i += 3) minY = Math.min(minY, point.fromArray(vertices, i).applyMatrix4(matrix).y);
      bounds.min.y = minY;
      const ground = (spec.surface === 'street' ? this.world.getWalkSurfaceHeight(spec.x, spec.z)
        : terrainHeight(spec.x, spec.z)) - (spec.embed ?? 0);
      matrix.setPosition(spec.x, ground - bounds.min.y, spec.z);
      bounds.translate(new THREE.Vector3(spec.x, ground - bounds.min.y, spec.z));
      const clearance = bounds.clone();
      this.vegetationBounds.push(clearance);
      const collider = spec.solid ? { type: 'box', name: `coastal-${id}`, x: spec.x, z: spec.z,
        halfX: (bounds.max.x - bounds.min.x) / 2, halfZ: (bounds.max.z - bounds.min.z) / 2,
        rotation: 0, minY: ground - 0.1, maxY: bounds.max.y } : null;
      if (collider) this.addCollider(collider);
      this.placements.push({ id, index, x: spec.x, z: spec.z, minY: bounds.min.y, ground,
        surface: spec.surface, embed: spec.embed ?? 0, clearance, collider });
      return matrix;
    });
    source.traverse((mesh) => {
      if (!mesh.isMesh || mesh.name.includes('CoastalShoreLOD')) return;
      const geometry = mesh.geometry.clone().applyMatrix4(normalization.clone().multiply(mesh.matrixWorld));
      const batch = new THREE.InstancedMesh(geometry, mesh.material, specs.length);
      batch.name = `Coastal_${id}`;
      transforms.forEach((matrix, i) => batch.setMatrixAt(i, matrix));
      batch.instanceMatrix.needsUpdate = true;
      batch.castShadow = this.shadows && id !== 'lambis_shell';
      batch.receiveShadow = true;
      batch.computeBoundingBox();
      batch.computeBoundingSphere();
      this.root.add(batch);
    });
    if (id === 'boulder_01') {
      const lod = source.getObjectByName('CoastalShoreLOD');
      if (lod?.isMesh) {
        const centered = new THREE.Matrix4().makeScale(2 / span, 2 / span, 2 / span)
          .multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z));
        const geometry = lod.geometry.clone().applyMatrix4(centered.multiply(lod.matrixWorld));
        this.shoreBatch = new THREE.InstancedMesh(geometry, lod.material, 26);
        this.shoreBatch.name = 'TexturedShoreRockInstances';
        const compile = lod.material.onBeforeCompile;
        lod.material.onBeforeCompile = (shader, renderer) => {
          compile.call(lod.material, shader, renderer);
          this.shoreShaderCompiled = true;
        };
        this.shoreBatch.receiveShadow = true;
        this.shoreBatch.castShadow = this.shadows;
        this.reflectedRoot.add(this.shoreBatch);
        this.replaceShoreRocks();
      }
    }
  }

  replaceShoreRocks() {
    if (!this.shoreBatch || !this.world) return;
    const matrix = new THREE.Matrix4();
    const point = new THREE.Vector3(), positions = this.shoreBatch.geometry.attributes.position;
    let index = 0;
    for (const rocks of this.world.rockClusters) {
      for (let i = 0; i < rocks.count; i++) {
        rocks.getMatrixAt(i, matrix);
        let minY = Infinity;
        for (let v = 0; v < positions.count; v++) minY = Math.min(minY, point.fromBufferAttribute(positions, v).applyMatrix4(matrix).y);
        matrix.elements[13] += terrainHeight(matrix.elements[12], matrix.elements[14]) - 0.16 - minY;
        this.shoreBatch.setMatrixAt(index++, matrix);
      }
      rocks.visible = false;
    }
    this.shoreBatch.count = index;
    this.shoreBatch.instanceMatrix.needsUpdate = true;
    this.shoreBatch.computeBoundingBox();
    this.shoreBatch.computeBoundingSphere();
  }

  addCollider(collider) {
    this.colliders.push(collider);
    this.world?.registerCameraCollider(collider);
  }

  bindWorld(world) {
    this.world?.unregisterReflectionExclusion(this.root);
    this.colliders.forEach((c) => this.world?.unregisterCameraCollider(c));
    this.world = world;
    if (this.disposed) return;
    world.registerReflectionExclusion(this.root);
    this.colliders.forEach((c) => world.registerCameraCollider(c));
    this.replaceShoreRocks();
    this.reanchorStreetAssets();
    this.updateTide(world.getTideState().waterHeight);
    world.details.clearVegetation(this.vegetationBounds);
    if (this.loaded.includes('lifebuoy')) world.root.getObjectByName('LegacyStandaloneLifeRing').visible = false;
  }

  reanchorStreetAssets() {
    const matrix = new THREE.Matrix4(), changed = new Set();
    for (const placement of this.placements) {
      if (placement.surface !== 'street') continue;
      const ground = this.world.getWalkSurfaceHeight(placement.x, placement.z) - placement.embed;
      const delta = ground - placement.ground;
      if (Math.abs(delta) < 1e-10) continue;
      placement.ground = ground; placement.minY += delta;
      placement.clearance.min.y += delta; placement.clearance.max.y += delta;
      if (placement.collider) { placement.collider.minY += delta; placement.collider.maxY += delta; }
      this.root.traverse(mesh => {
        if (!mesh.isInstancedMesh || mesh.name !== `Coastal_${placement.id}`) return;
        mesh.getMatrixAt(placement.index, matrix); matrix.elements[13] += delta;
        mesh.setMatrixAt(placement.index, matrix); changed.add(mesh);
      });
    }
    for (const mesh of changed) {
      mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingBox(); mesh.computeBoundingSphere();
    }
  }

  createBeachEquipment() {
    const canopy = [], frames = [], boards = [], towels = [];
    for (const [x, z, color] of [[-21, 28.3, palette.coral], [-25, 32.3, palette.seaGlass], [-24, 14.5, palette.sage]]) {
      const y = terrainHeight(x, z);
      canopy.push(createUmbrella(color).translate(x, y, z));
      frames.push(colored(new THREE.CylinderGeometry(0.065, 0.08, 4.35, 10).translate(x, y + 2.175, z), palette.metal));
      frames.push(colored(new THREE.CylinderGeometry(0.13, 0.13, 0.14, 10).translate(x, y + 3.58, z), palette.metal));
      for (let i = 0; i < 8; i++) {
        const angle = i / 8 * Math.PI * 2;
        const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(x, y + 4.22, z),
          new THREE.Vector3(x + Math.cos(angle) * 1.45, y + 4.05, z + Math.sin(angle) * 1.45),
          new THREE.Vector3(x + Math.cos(angle) * 2.77, y + 3.48, z + Math.sin(angle) * 2.77));
        frames.push(colored(new THREE.TubeGeometry(curve, 8, 0.019, 4, false), palette.metal));
      }
      this.addCollider({ type: 'circle', name: 'beach-umbrella', x, z, radius: 0.12, minY: y, maxY: y + 4.35 });
    }
    const rackFrameStart = frames.length;
    for (const [i, color] of [palette.ochre, palette.seaGlass, palette.coral].entries()) {
      const x = 19.5 + i * 1.05, z = 28.4, y = terrainHeight(x, z);
      const rotation = new THREE.Matrix4().makeRotationX(-0.16);
      const geometry = createSurfboardBody();
      boards.push(colored(geometry.applyMatrix4(rotation).translate(x, y + 1.7, z), color));
      boards.push(colored(createBoardStringer().applyMatrix4(rotation).translate(x, y + 1.7, z), palette.chalk));
      const fin = new THREE.Shape();
      fin.moveTo(-1.2, -0.04);
      fin.lineTo(-0.72, -0.075);
      fin.quadraticCurveTo(-1.02, -0.18, -1.1, -0.34);
      fin.lineTo(-1.2, -0.04);
      const finGeometry = new THREE.ExtrudeGeometry(fin, { depth: 0.035, bevelEnabled: false, curveSegments: 3 });
      // Fin profile is authored in Y/Z and faces backward into the rack.
      const fp = finGeometry.attributes.position;
      for (let v = 0; v < fp.count; v++) {
        const fy = fp.getX(v), fz = fp.getY(v), fx = fp.getZ(v) - 0.0175;
        fp.setXYZ(v, fx, fy, fz);
      }
      finGeometry.computeVertexNormals();
      boards.push(colored(finGeometry.applyMatrix4(rotation).translate(x, y + 1.7, z), palette.timberShadow));
    }
    const rackY = terrainHeight(20.5, 28.4);
    for (const x of [18.8, 22.25]) frames.push(colored(new THREE.BoxGeometry(0.14, 1.65, 0.18).translate(x, rackY + 0.825, 28.85), palette.timber));
    for (const y of [0.45, 1.45]) frames.push(colored(new THREE.BoxGeometry(3.6, 0.12, 0.16).translate(20.5, rackY + y, 28.85), palette.timber));
    for (const x of [18.8, 22.25]) {
      frames.push(colored(new THREE.BoxGeometry(0.2, 0.14, 1.3).translate(x, rackY + 0.08, 28.85), palette.timber));
      frames.push(colored(new THREE.BoxGeometry(0.1, 1.05, 0.1).rotateX(-0.5).translate(x, rackY + 0.52, 29.1), palette.timberShadow));
    }
    const { x: rackX, z: rackZ, yaw } = EQUIPMENT_ZONE;
    const gearGround = terrainHeight(rackX, rackZ);
    const rackTransform = new THREE.Matrix4().makeTranslation(rackX, gearGround, rackZ)
      .multiply(new THREE.Matrix4().makeRotationY(yaw))
      .multiply(new THREE.Matrix4().makeTranslation(-20.5, -rackY, -28.7));
    for (const geometry of [...boards, ...frames.slice(rackFrameStart)]) geometry.applyMatrix4(rackTransform);
    this.addCollider({ type: 'box', name: 'surfboard-rack', x: rackX, z: rackZ, halfX: 1.9, halfZ: 0.95,
      rotation: yaw, minY: gearGround, maxY: gearGround + 3.4 });
    this.vegetationBounds.push(new THREE.Box3(new THREE.Vector3(-1.9, 0, -0.95), new THREE.Vector3(1.9, 3.4, 0.95))
      .applyMatrix4(new THREE.Matrix4().makeTranslation(rackX, gearGround, rackZ).multiply(new THREE.Matrix4().makeRotationY(yaw))));
    for (const [x, z, tint, yaw] of [[-21.5, 15.2, palette.coral, -0.3], [-26.4, 15.3, palette.seaGlass, 0.25]]) {
      this.vegetationBounds.push(new THREE.Box3(new THREE.Vector3(-0.775, 0, -1.4), new THREE.Vector3(0.775, 0.1, 1.4))
        .applyMatrix4(new THREE.Matrix4().makeTranslation(x, terrainHeight(x, z), z).multiply(new THREE.Matrix4().makeRotationY(yaw))));
      for (let stripe = 0; stripe < 8; stripe++) {
        const geometry = new THREE.PlaneGeometry(1.55 / 8, 2.8, 1, 8);
        geometry.rotateX(-Math.PI / 2).translate((stripe - 3.5) * 1.55 / 8, 0, 0).rotateY(yaw).translate(x, 0, z);
        const positions = geometry.attributes.position;
        for (let i = 0; i < positions.count; i++) positions.setY(i, terrainHeight(positions.getX(i), positions.getZ(i)) + 0.04);
        geometry.computeVertexNormals();
        towels.push(colored(geometry, stripe % 2 ? palette.chalk : tint));
      }
    }
    this.createBeachFurniture(frames);
    for (const [name, parts, roughness, side] of [
      ['BeachUmbrellaCanopies', canopy, 0.92, THREE.DoubleSide],
      ['BeachEquipmentFrames', frames, 0.66, THREE.FrontSide],
      ['SurfboardCollection', boards, 0.48, THREE.FrontSide],
      ['BeachStripedTowels', towels, 1, THREE.DoubleSide],
    ]) {
      const mesh = new THREE.Mesh(mergeParts(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness, side }));
      mesh.material.envMapIntensity = 0.55;
      addCoastalSurfaceDetail(mesh.material, name === 'BeachUmbrellaCanopies' || name === 'BeachStripedTowels' ? 'cloth' : 'paint');
      mesh.name = name;
      mesh.castShadow = this.shadows && name !== 'BeachStripedTowels';
      mesh.receiveShadow = true;
      this.root.add(mesh);
    }
  }

  createBeachFurniture(frames) {
    const box = (size, position, color = palette.timber, rotation = [0, 0, 0]) => {
      const matrix = new THREE.Matrix4().compose(new THREE.Vector3(...position),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(1, 1, 1));
      frames.push(colored(new THREE.BoxGeometry(...size).applyMatrix4(matrix), color));
    };
    const clear = (x, z, halfX, halfZ, height) => {
      const y = terrainHeight(x, z);
      this.vegetationBounds.push(new THREE.Box3(new THREE.Vector3(x - halfX, y - 0.2, z - halfZ),
        new THREE.Vector3(x + halfX, y + height, z + halfZ)));
    };
    for (const [x, z, tint] of [[10.3, 42, palette.coral], [13.3, 42, palette.sage], [22.4, 33.9, palette.seaGlass], [25.5, 34.2, palette.ochre]]) {
      const y = terrainHeight(x, z);
      for (const dx of [-0.52, 0.52]) {
        box([0.09, 0.13, 2.6], [x + dx, y + 0.43, z]);
        for (const dz of [-0.9, 0.8]) box([0.1, 0.42, 0.12], [x + dx, y + 0.21, z + dz]);
        box([0.09, 0.12, 1.15], [x + dx, y + 0.81, z + 0.99], palette.timber, [-0.55, 0, 0]);
      }
      for (let i = 0; i < 8; i++) box([1.16, 0.055, 0.18], [x, y + 0.51, z - 1.15 + i * 0.21], i % 3 ? palette.chalk : tint);
      for (let i = 0; i < 6; i++) box([1.16, 0.055, 0.15], [x, y + 0.57 + i * 0.095, z + 0.59 + i * 0.15], i % 3 ? palette.chalk : tint, [-0.55, 0, 0]);
      clear(x, z, 0.7, 1.7, 1.4);
      this.addCollider({ type: 'box', name: 'beach-lounger', x, z: z + 0.15, halfX: 0.62, halfZ: 1.55, rotation: 0, minY: y, maxY: y + 1.2 });
    }
    // An elevated rescue lookout makes the boardwalk end a readable landmark.
    const x = 31, z = 43, y = terrainHeight(x, z);
    for (const dx of [-1.1, 1.1]) for (const dz of [-0.85, 0.85]) {
      box([0.15, 4.15, 0.15], [x + dx, y + 2.075, z + dz], palette.chalk);
      box([0.12, 1.95, 0.12], [x + dx, y + 0.9, z + dz * 0.25], palette.coral, [dz > 0 ? -0.7 : 0.7, 0, 0]);
    }
    box([2.65, 0.18, 2.1], [x, y + 2, z]);
    box([2.8, 0.13, 2.4], [x, y + 4.2, z], palette.coral, [-0.08, 0, 0]);
    for (const dx of [-1.1, 1.1]) box([0.1, 0.1, 1.9], [x + dx, y + 2.85, z], palette.chalk);
    box([2.3, 0.1, 0.12], [x, y + 2.85, z + 0.85], palette.chalk);
    box([1.0, 0.12, 0.6], [x, y + 2.48, z + 0.28]);
    box([1.0, 0.65, 0.12], [x, y + 2.8, z + 0.57], palette.chalk);
    for (const dx of [-0.4, 0.4]) box([0.1, 2.4, 0.12], [x + dx, y + 1.1, z + 1.4], palette.chalk, [-0.32, 0, 0]);
    for (let i = 0; i < 7; i++) box([0.86, 0.08, 0.12], [x, y + 0.18 + i * 0.28, z + 1.74 - i * 0.092]);
    box([2.3, 0.1, 0.12], [x, y + 2.95, z - 0.85], palette.chalk);
    for (let i = 0; i < 4; i++) {
      const ring = new THREE.TorusGeometry(0.34, 0.075, 5, 5, Math.PI / 2);
      ring.rotateZ(i * Math.PI / 2).translate(x, y + 2.66, z - 0.97);
      frames.push(colored(ring, i % 2 ? palette.chalk : palette.coral));
    }
    clear(x, z, 1.7, 2.1, 4.5);
    this.addCollider({ type: 'box', name: 'rescue-lookout', x, z: z + 0.25, halfX: 1.3, halfZ: 1.65, rotation: 0, minY: y, maxY: y + 4.3 });
    this.equipmentCounts = { umbrellas: 3, loungers: 4, rescueLookouts: 1 };
  }

  setShadows(enabled) {
    this.shadows = enabled;
    this.root.traverse((object) => { if (object.isMesh) object.castShadow = enabled
      && object.name !== 'BeachStripedTowels' && object.name !== 'Coastal_lambis_shell'; });
    if (this.shoreBatch) this.shoreBatch.castShadow = enabled;
  }

  updateTide(height) {
    this.waterHeight.value = height;
  }

  getState() {
    let triangles = 0, batches = 0;
    this.root.traverse((m) => { if (m.isMesh) {
      batches++;
      triangles += (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3 * (m.isInstancedMesh ? m.count : 1);
    } });
    return { loaded: [...this.loaded].sort(), errors: [...this.errors], instances: this.placements.length,
      equipment: this.equipmentCounts,
      waterHeight: this.waterHeight.value, vegetationMoved: this.world?.details.grass.userData.clearanceMoved ?? 0,
      batches, triangles, replacedShoreRocks: this.shoreBatch?.count ?? 0, shoreShaderCompiled: Boolean(this.shoreShaderCompiled),
      shoreTriangles: this.shoreBatch ? (this.shoreBatch.geometry.index?.count ?? this.shoreBatch.geometry.attributes.position.count) / 3 * this.shoreBatch.count : 0,
      colliders: this.colliders.length, disposed: this.disposed };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.controller.abort();
    this.world?.unregisterReflectionExclusion(this.root);
    this.colliders.forEach((c) => this.world?.unregisterCameraCollider(c));
    this.world?.details.clearVegetation();
    const resources = resourcesOf(this.root);
    for (const source of [...this.sourceRoots, this.reflectedRoot]) {
      const extra = resourcesOf(source);
      for (const key of Object.keys(resources)) for (const item of extra[key]) resources[key].add(item);
    }
    release(resources);
    this.root.removeFromParent();
    this.root.clear();
    this.reflectedRoot.removeFromParent();
    this.reflectedRoot.clear();
    this.shoreBatch = null;
    for (const rocks of this.world?.rockClusters ?? []) rocks.visible = true;
    const ring = this.world?.root.getObjectByName('LegacyStandaloneLifeRing');
    if (ring) ring.visible = true;
    this.sourceRoots.length = 0;
    this.world = null;
  }
}

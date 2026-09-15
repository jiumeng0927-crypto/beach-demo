import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCoastContinuation, COAST_EXTENT } from '../src/experience/CoastBoundary.js';
import { createOceanGeometry } from '../src/experience/OceanWater.js';
import { terrainHeight } from '../src/experience/world.js';

for (const quality of ['high', 'low']) {
  const columns = quality === 'high' ? 220 : 150;
  const beach = new THREE.Mesh(new THREE.PlaneGeometry(260, 120, columns, quality === 'high' ? 105 : 72));
  const seabed = new THREE.Mesh(new THREE.PlaneGeometry(260, 180, columns, quality === 'high' ? 24 : 16), beach.material);
  beach.rotation.x = seabed.rotation.x = -Math.PI / 2;
  beach.position.z = 45; seabed.position.z = -105;
  const bp = beach.geometry.attributes.position, sp = seabed.geometry.attributes.position;
  for (let i = 0; i < bp.count; i++) bp.setZ(i, terrainHeight(bp.getX(i), 45 - bp.getY(i)));
  for (let i = 0; i < sp.count; i++) {
    const d = 180 * ((90 + sp.getY(i)) / 180) ** 1.65;
    sp.setXYZ(i, sp.getX(i), d - 90, terrainHeight(sp.getX(i), -15) - (d / 180) ** 1.3 * 32);
  }
  beach.geometry.computeVertexNormals(); seabed.geometry.computeVertexNormals();
  const original = [bp.array.slice(), sp.array.slice(), beach.geometry.index.array.slice()];
  const geometry = createCoastContinuation(beach, seabed, terrainHeight);
  assert.deepEqual(bp.array, original[0]); assert.deepEqual(sp.array, original[1]);
  assert.deepEqual(beach.geometry.index.array, original[2]);
  const p = geometry.attributes.position, ix = geometry.index.array;
  const { perimeterCount, rings } = geometry.userData.boundary;
  assert.equal(p.count, perimeterCount * rings);
  assert.ok(ix.length / 3 <= (quality === 'high' ? 5600 : 3900));
  assert.ok([...p.array, ...geometry.attributes.normal.array].every(Number.isFinite));
  const edges = new Map(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < ix.length; i += 3) {
    a.fromBufferAttribute(p, ix[i]); b.fromBufferAttribute(p, ix[i + 1]); c.fromBufferAttribute(p, ix[i + 2]);
    assert.ok(b.sub(a).cross(c.sub(a)).y > 0, 'No reversed or zero-area outer triangles');
    for (let j = 0; j < 3; j++) {
      const u = ix[i + j], v = ix[i + (j + 1) % 3], key = u < v ? `${u}:${v}` : `${v}:${u}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  assert.ok([...edges.values()].every(n => n === 1 || n === 2));
  assert.equal([...edges.values()].filter(n => n === 1).length, perimeterCount * 2, 'Only inner and outer perimeters are open');
  const extension = new THREE.Mesh(geometry, beach.material);
  const meshEdges = new Map();
  for (const mesh of [beach, seabed]) {
    const source = mesh.geometry.attributes.position;
    for (let i = 0; i < source.count; i++) {
      a.fromBufferAttribute(source, i).applyMatrix4(mesh.matrix);
      meshEdges.set(`${a.x.toFixed(4)},${a.z.toFixed(4)}`, a.y);
    }
  }
  for (let i = 0; i < perimeterCount; i++) {
    const y = meshEdges.get(`${p.getX(i).toFixed(4)},${p.getZ(i).toFixed(4)}`);
    assert.ok(y !== undefined && Math.abs(y - p.getY(i)) < 1e-5, 'Every stitch matches an original ground vertex');
  }
  const ray = new THREE.Raycaster();
  for (const mesh of [beach, seabed, extension]) mesh.updateMatrixWorld(true);
  for (const x of [-2400, -601, -240, -160, -130.001, -129.999, 0, 129.999, 130.001, 160, 240, 601, 2400]) {
    for (const z of [-2400, -195.001, -194.999, -15.001, -14.999, 0, 30, 104.999, 105.001, 2400]) {
      ray.set(new THREE.Vector3(x, 200, z), new THREE.Vector3(0, -1, 0));
      assert.ok(ray.intersectObjects([beach, seabed, extension]).length > 0, `Ground hole at ${x},${z}`);
    }
  }
  assert.equal(geometry.boundingBox.max.x, COAST_EXTENT);
  assert.equal(geometry.boundingBox.min.x, -COAST_EXTENT);
  assert.equal(geometry.boundingBox.max.z, COAST_EXTENT);
  assert.equal(geometry.boundingBox.min.z, -COAST_EXTENT);

  const ocean = createOceanGeometry(quality), op = ocean.attributes.position, spacing = ocean.attributes.oceanSpacing;
  const sx = quality === 'high' ? 128 : 96, sy = quality === 'high' ? 96 : 72;
  const baseOceanVertices = (sx + 1) * (sy + 1);
  assert.equal(op.count, baseOceanVertices + 8, 'Only eight horizon-wing vertices are added');
  assert.equal(ocean.index.count / 3, sx * sy * 2 + 4, 'Only four horizon-wing triangles are added');
  assert.equal(ocean.userData.horizonWingTriangles, 4);
  for (let row = 0; row <= sy; row++) for (let col = 0; col <= sx; col++) {
    const i = row * (sx + 1) + col, x = Math.fround(col / sx - 0.5) * 2, t = 0.5 - Math.fround(0.5 - row / sy);
    const oldX = x * 70 + x ** 5 * 530;
    const oldZ = t < .12 ? 40 - t * 250 : t < .64 ? 10 - (t - .12) * 55 / .52 : -45 - ((t - .64) / .36) ** 2 * 1000;
    if (Math.abs(oldX) <= 160) assert.ok(Math.abs(op.getX(i) - oldX) < 1e-4);
    if (oldZ >= -180) assert.ok(Math.abs(-119 - op.getY(i) - oldZ) < 1e-4);
    for (const next of [col < sx ? i + 1 : i, row < sy ? i + sx + 1 : i]) {
      assert.ok(spacing.getX(i) + .002 >= Math.max(Math.abs(op.getX(i) - op.getX(next)), Math.abs(op.getY(i) - op.getY(next))), 'Spacing covers the stretched cells');
    }
  }
  for (const [offset, x, z] of [[0, -COAST_EXTENT, 40], [1, -130, 40], [2, -COAST_EXTENT, COAST_EXTENT], [3, -130, COAST_EXTENT],
    [4, 130, 40], [5, COAST_EXTENT, 40], [6, 130, COAST_EXTENT], [7, COAST_EXTENT, COAST_EXTENT]]) {
    assert.ok(Math.abs(op.getX(baseOceanVertices + offset) - x) < 1e-4);
    assert.ok(Math.abs(-119 - op.getY(baseOceanVertices + offset) - z) < 1e-4);
    assert.equal(spacing.getX(baseOceanVertices + offset), COAST_EXTENT);
  }
  assert.equal(ocean.boundingBox.max.x, COAST_EXTENT);
  assert.equal(-119 - ocean.boundingBox.max.y, -COAST_EXTENT);
  for (const object of [geometry, ocean, beach.geometry, seabed.geometry, beach.material]) object.dispose();
}
console.log('PASS: both qualities, exact ground stitches, manifold rings, ray coverage, winding, finite bounds, unchanged near-ocean samples and bounded horizon wings');

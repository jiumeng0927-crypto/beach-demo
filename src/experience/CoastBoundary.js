import * as THREE from 'three';

// Beyond the camera's 1800-unit far plane, including its allowed travel range.
export const COAST_EXTENT = 3600;

export function coastContinuationHeight(x, z, terrainHeight) {
  const lateral = Math.max(0, Math.abs(x) - 130);
  const inland = Math.max(0, z - 105);
  const outsideLand = Math.hypot(lateral, inland);
  const landZ = Math.max(-15, z);
  const edgeX = THREE.MathUtils.clamp(x, -130, 130);
  const edgeZ = Math.min(105, landZ);
  const land = terrainHeight(edgeX, edgeZ);
  const depth = Math.max(0, -15 - z);
  const seabed = land - 32 * Math.pow(Math.min(depth, 180) / 180, 1.3)
    - 12 * (1 - Math.exp(-Math.max(0, depth - 180) / 180));
  if (outsideLand <= 0) return seabed;
  // Drop the sealing skirt below every practical sightline before it leaves the
  // authored coast. It still closes the mesh, but can no longer read as a
  // second sandbar when the camera looks along the beach.
  const submergedShelf = THREE.MathUtils.lerp(seabed, -28,
    THREE.MathUtils.smoothstep(outsideLand, 0, 26));
  return submergedShelf - Math.max(0, outsideLand - 26) * 0.012;
}

export function createCoastContinuation(beach, seabed, terrainHeight) {
  const perimeter = [];
  const append = (mesh, column, row) => {
    const geometry = mesh.geometry;
    const index = row * (geometry.parameters.widthSegments + 1) + column;
    const position = new THREE.Vector3().fromBufferAttribute(geometry.attributes.position, index).applyMatrix4(mesh.matrix);
    const normal = new THREE.Vector3().fromBufferAttribute(geometry.attributes.normal, index).transformDirection(mesh.matrix);
    perimeter.push({ position, normal });
  };
  beach.updateMatrix();
  seabed.updateMatrix();
  const columns = beach.geometry.parameters.widthSegments;
  const landRows = beach.geometry.parameters.heightSegments;
  const seaRows = seabed.geometry.parameters.heightSegments;
  // Follow every original edge vertex, without resampling or T-junctions.
  for (let x = 0; x <= columns; x++) append(seabed, x, 0);
  for (let z = 1; z <= seaRows; z++) append(seabed, columns, z);
  for (let z = 1; z <= landRows; z++) append(beach, columns, z);
  for (let x = columns - 1; x >= 0; x--) append(beach, x, landRows);
  for (let z = landRows - 1; z >= 0; z--) append(beach, 0, z);
  for (let z = seaRows - 1; z > 0; z--) append(seabed, 0, z);

  const rings = [[130, -195, 105], [160, -240, 145], [240, -360, 240],
    [600, -750, 600], [COAST_EXTENT, -COAST_EXTENT, COAST_EXTENT]];
  const count = perimeter.length;
  const positions = new Float32Array(rings.length * count * 3);
  const indices = [];
  // Carry the authored edge profile into a sparse, deeply submerged sealing
  // skirt. Outer rings only prevent holes beyond the visible coast.
  rings.forEach(([halfWidth, seaZ, landZ], ring) => {
    perimeter.forEach(({ position }, i) => {
      const x = position.x * halfWidth / 130;
      // Keep shore rows in place; widen only the offshore and inland intervals.
      const z = position.z > 70 ? 70 + (position.z - 70) * (landZ - 70) / 35
        : position.z < -80 ? -80 + (position.z + 80) * (seaZ + 80) / -115 : position.z;
      positions.set([x, ring === 0 ? position.y : coastContinuationHeight(x, z, terrainHeight), z], (ring * count + i) * 3);
      if (ring === 0) return;
      const a = (ring - 1) * count + i, b = (ring - 1) * count + (i + 1) % count;
      const c = ring * count + i, d = ring * count + (i + 1) % count;
      indices.push(a, b, c, b, d, c);
    });
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // Match the existing edge lighting as well as its position.
  perimeter.forEach(({ normal }, i) => geometry.attributes.normal.setXYZ(i, normal.x, normal.y, normal.z));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.boundary = { perimeterCount: count, rings: rings.length, extent: COAST_EXTENT };
  return geometry;
}

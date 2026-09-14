import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TABLE, POCKET_GEOMETRY } from './billiardsTable.js';

function mergeColored(parts) {
  const buffers = parts.map(([geometry, color]) => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (g !== geometry) geometry.dispose();
    const c = new THREE.Color(color), colors = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) c.toArray(colors, i);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  });
  const result = mergeGeometries(buffers);
  // mergeGeometries copies attributes; the temporary buffers have no further owner.
  buffers.forEach((geometry) => geometry.dispose());
  return result;
}

export function createFrameBevel() {
  return new RoundedBoxGeometry(1, 1, 1, 1, 0.055);
}

export function createTableHardware() {
  const parts = [], steel = 0xb1b9b6, dark = 0x2b3436;
  for (const x of [-2.8, 0, 2.8]) for (const z of [-1.3, 1.3]) {
    parts.push([new THREE.CylinderGeometry(0.28, 0.3, 0.08, 16).translate(x, 0.06, z), dark]);
    parts.push([new THREE.CylinderGeometry(0.17, 0.17, 0.15, 12).translate(x, 0.15, z), steel]);
  }
  // Inlays lie outside the cushion line, leaving all six physical mouths untouched.
  for (const z of [-1.98, 1.98]) for (const x of [-2.38, -1.5875, -0.794, 0.794, 1.5875, 2.38]) {
    parts.push([new THREE.BoxGeometry(0.055, 0.008, 0.055).rotateY(Math.PI / 4)
      .translate(x, TABLE.top + 0.145, z), 0xe5e8d9]);
  }
  for (const x of [-3.54, 3.54]) for (const z of [-0.794, 0, 0.794]) {
    parts.push([new THREE.BoxGeometry(0.055, 0.008, 0.055).rotateY(Math.PI / 4)
      .translate(x, TABLE.top + 0.145, z), 0xe5e8d9]);
  }
  for (const z of [-1.99, 1.99]) for (const x of [-2.9, -1.4, 1.4, 2.9]) {
    parts.push([new THREE.CylinderGeometry(0.026, 0.026, 0.014, 12).rotateX(Math.PI / 2)
      .translate(x, TABLE.top - 0.3, z), steel]);
  }
  for (const z of [-1.984, 1.984]) {
    parts.push([new THREE.BoxGeometry(6.94, 0.027, 0.025).translate(0, TABLE.top - 0.49, z), steel]);
  }
  for (const x of [-3.53, 3.53]) {
    parts.push([new THREE.BoxGeometry(0.025, 0.027, 3.92).translate(x, TABLE.top - 0.49, 0), steel]);
  }
  const mesh = new THREE.Mesh(mergeColored(parts), new THREE.MeshStandardMaterial({
    name: 'BilliardsHardware', vertexColors: true, roughness: 0.36, metalness: 0.38,
  }));
  mesh.name = 'BilliardsHardware'; mesh.receiveShadow = true;
  return mesh;
}

export function createPocketLeather() {
  const parts = [];
  for (const { center: [x, z] } of POCKET_GEOMETRY) {
    parts.push([new THREE.TorusGeometry(TABLE.holeRadius + 0.025, 0.014, 6, 24)
      .rotateX(Math.PI / 2).translate(x, TABLE.top + 0.016, z), 0x372e29]);
    // Pocket bags hang below the cut-out bed; the entry diameter is unchanged.
    parts.push([new THREE.CylinderGeometry(TABLE.holeRadius * 0.99, TABLE.holeRadius * 0.68,
      0.38, 16, 1, true).translate(x, TABLE.top - 0.3, z), 0x292421]);
  }
  const mesh = new THREE.Mesh(mergeColored(parts), new THREE.MeshStandardMaterial({
    name: 'BilliardsPocketLeather', vertexColors: true, roughness: 0.92, side: THREE.DoubleSide,
  }));
  mesh.name = 'BilliardsPocketLeather'; mesh.receiveShadow = true;
  return mesh;
}

export function createCueModel() {
  const parts = [];
  for (const [front, back, r1, r2, color] of [
    [0, 0.018, 0.014, 0.014, 0x3c8993],
    [0.018, 0.085, 0.014, 0.0145, 0xe9e5d8],
    [0.085, 2.12, 0.0145, 0.027, 0xcbb585],
    [2.12, 2.17, 0.027, 0.027, 0xb7bcb4],
    [2.17, 3.48, 0.027, 0.036, 0x283b3e],
    [3.48, 3.55, 0.036, 0.036, 0x1b2224],
  ]) {
    parts.push([new THREE.CylinderGeometry(r1, r2, back - front, 12)
      .rotateX(-Math.PI / 2).translate(0, 0, (front + back) / 2), color]);
  }
  const mesh = new THREE.Mesh(mergeColored(parts), new THREE.MeshStandardMaterial({
    name: 'BilliardsCueAsh', vertexColors: true, roughness: 0.34,
  }));
  mesh.name = 'BilliardsCue'; mesh.visible = false;
  return mesh;
}

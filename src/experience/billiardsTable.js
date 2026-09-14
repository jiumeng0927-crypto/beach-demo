import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const TABLE = Object.freeze({ halfWidth: 3.175, halfDepth: 1.5875,
  top: 1.86, ballRadius: 0.05715 * 2.5 / 2, jawRadius: 0.025,
  cornerMouth: 0.085 * 2.5, sideMouth: 0.1 * 2.5, holeRadius: 0.115 });
const { halfWidth: W, halfDepth: D, jawRadius: R } = TABLE;
const diagonal = (TABLE.cornerMouth + 2 * R) / Math.sqrt(2);
const end = W - diagonal + R, shortEnd = D - diagonal + R;
const middle = TABLE.sideMouth / 2 + R;

// Each segment uses one compound body: a rectangular back and two rounded nose jaws.
export const RAILS = Object.freeze([-1, 1].flatMap((z) => [-1, 1].map((x) => ({
  center: [x * (end + middle) / 2, z * (D + 0.11)],
  size: [end - middle, 0.22],
  jaws: [[x * middle, z * (D + R)], [x * end, z * (D + R)]],
}))).concat([-1, 1].map((x) => ({
  center: [x * (W + 0.11), 0], size: [0.22, shortEnd * 2],
  jaws: [[x * (W + R), -shortEnd], [x * (W + R), shortEnd]],
}))));

export const POCKET_GEOMETRY = Object.freeze([-1, 1].flatMap((z) => [-1, 0, 1].map((x) => {
  const n = x ? [x / Math.sqrt(2), z / Math.sqrt(2)] : [0, z];
  const mouth = x ? [x * (W - diagonal / 2 + R), z * (D - diagonal / 2 + R)] : [0, z * (D + R)];
  return { normal: n, mouth, center: [mouth[0] + n[0] * 0.105, mouth[1] + n[1] * 0.105],
    width: x ? TABLE.cornerMouth : TABLE.sideMouth };
})));

export function capturesPocket(x, z) {
  return POCKET_GEOMETRY.some(({ normal: n, mouth: m, center: c }) =>
    (x - m[0]) * n[0] + (z - m[1]) * n[1] > 0.045
    && Math.hypot(x - c[0], z - c[1]) < TABLE.holeRadius - 0.016);
}

function merged(parts) {
  const buffers = parts.map((p) => {
    if (!p.index) return p;
    const buffer = p.toNonIndexed(); p.dispose(); return buffer;
  });
  const result = mergeGeometries(buffers);
  buffers.forEach((p) => p.dispose());
  return result;
}

function createCushion(x, z, w, d) {
  const long = w > d, thickness = long ? d : w, length = long ? w : d;
  const shape = new THREE.Shape();
  shape.moveTo(-thickness / 2, 0.02);
  shape.lineTo(-thickness / 2, 0.095);
  shape.lineTo(-thickness / 2 + 0.045, 0.15);
  shape.lineTo(thickness / 2, 0.15);
  shape.lineTo(thickness / 2, 0.02); shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false });
  const p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const q = p.getX(i), h = p.getY(i), along = p.getZ(i) - length / 2;
    p.setXYZ(i, x + (long ? -along * Math.sign(z) : q * Math.sign(x)), TABLE.top + h,
      z + (long ? q * Math.sign(z) : along * Math.sign(x)));
  }
  geometry.computeVertexNormals();
  return geometry;
}

export function createClothGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(-3.7, -2.125); shape.lineTo(3.7, -2.125);
  shape.lineTo(3.7, 2.125); shape.lineTo(-3.7, 2.125); shape.closePath();
  for (const { center: [x, z] } of POCKET_GEOMETRY) {
    const hole = new THREE.Path();
    hole.absarc(x, -z, TABLE.holeRadius, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  const bed = new THREE.ExtrudeGeometry(shape, { depth: 0.22, bevelEnabled: false, curveSegments: 12 });
  bed.rotateX(-Math.PI / 2).translate(0, TABLE.top - 0.22, 0);
  const parts = [bed];
  for (const { center: [x, z], size: [w, d], jaws } of RAILS) {
    parts.push(createCushion(x, z, w, d));
    jaws.forEach(([jx, jz]) => parts.push(new THREE.CylinderGeometry(R, R, 0.1, 12).translate(jx, TABLE.top + 0.05, jz)));
  }
  const geometry = merged(parts), uv = geometry.attributes.uv, p = geometry.attributes.position;
  const colors = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    uv.setXY(i, p.getX(i) / 7.4 + 0.5, 0.5 - p.getZ(i) / 4.25);
    const shade = p.getY(i) < TABLE.top - 0.01 ? 0.16 : 1;
    colors.set([shade, shade, shade], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

export function createPocketGeometry() {
  const r = TABLE.holeRadius;
  const cup = new THREE.CylinderGeometry(r, r * 0.78, 0.3, 24, 1, true).translate(0, -0.15, 0);
  const bottom = new THREE.CircleGeometry(r * 0.78, 24).rotateX(-Math.PI / 2).translate(0, -0.3, 0);
  const lip = new THREE.TorusGeometry(r + 0.008, 0.012, 6, 24).rotateX(Math.PI / 2);
  return merged([cup, bottom, lip]);
}

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const SOURCE_COLORS = Object.freeze({
  female: Object.freeze({
    face: [0.015, 0.021, 0.023], belt: [0.074, 0.061, 0.047], hair: [0.1, 0.058, 0.036],
    accent: [0.12, 0.292, 0.292], pants: [0.15, 0.181, 0.191], sole: [0.238, 0.292, 0.27],
    strap: [0.371, 0.402, 0.301], pocket: [0.468, 0.527, 0.402], shirt: [0.591, 0.342, 0.287],
    bag: [0.651, 0.68, 0.571], skin: [0.753, 0.491, 0.328], hat: [0.761, 0.708, 0.558],
    shoe: [0.831, 0.807, 0.723], lace: [0.947, 0.947, 0.871],
  }),
  male: Object.freeze({
    face: [0.015, 0.021, 0.023], glasses: [0.036, 0.054, 0.065], bridge: [0.06, 0.084, 0.084],
    belt: [0.074, 0.061, 0.047], hair: [0.1, 0.058, 0.036], capDark: [0.1, 0.25, 0.258],
    cap: [0.12, 0.342, 0.342], lens: [0.141, 0.25, 0.292], pants: [0.15, 0.181, 0.191],
    shirt: [0.22, 0.429, 0.44], sole: [0.238, 0.292, 0.27], skin: [0.753, 0.491, 0.328],
    shoe: [0.831, 0.807, 0.723], lace: [0.947, 0.947, 0.871],
  }),
});

export const NPC_APPEARANCES = Object.freeze({
  lin: { label: '潮汐采集员', kit: 'collector', width: 0.94, depth: 0.96, headScale: [1.02, 1.02, 1.02],
    palette: { shirt: '#b45f59', pants: '#243c4a', hair: '#35251f', accent: '#2f7473', bag: '#9da884', hat: '#d8ca9d', skin: '#e2b99a' } },
  chen: { label: '海岸球手', kit: 'cue-case', width: 1.02, depth: 0.98, headScale: [0.96, 0.98, 0.96],
    palette: { shirt: '#33747b', pants: '#252b31', hair: '#201b19', cap: '#28666b', capDark: '#214c50', skin: '#c9906f' } },
  mei: { label: '街角咖啡客', kit: 'coffee', width: 0.9, depth: 0.94, headScale: [1.05, 1.02, 1.02],
    palette: { shirt: '#b98742', pants: '#384653', hair: '#603f32', accent: '#8c4f45', bag: '#a89c72', hat: '#d5be82', skin: '#e9c2a4' } },
  hao: { label: '长板冲浪手', kit: 'surfboard', width: 1.08, depth: 1.02, headScale: [1, 1.03, 0.98],
    palette: { shirt: '#3d72a3', pants: '#4a4c3d', hair: '#252526', cap: '#d46f43', capDark: '#8f4934', skin: '#b97959' } },
  fan: { label: '轻装徒步客', kit: 'backpack', width: 0.98, depth: 1.06, headScale: [0.98, 1, 1.04],
    palette: { shirt: '#a85f45', pants: '#4f5944', hair: '#3c2e26', cap: '#847557', capDark: '#5b503e', skin: '#d6a17f' } },
  le: { label: '海岸摄影师', kit: 'camera', width: 0.93, depth: 0.98, headScale: [1.04, 1, 0.98],
    palette: { shirt: '#7195a2', pants: '#51445e', hair: '#704b39', accent: '#3e7b82', bag: '#788c83', hat: '#c4d1bf', skin: '#e5b28e' } },
  yu: { label: '潮岸店主', kit: 'merchant', width: 1.06, depth: 1.03, headScale: [1.01, 0.97, 1.02],
    palette: { shirt: '#55775a', pants: '#49483e', hair: '#2d2723', cap: '#b7a66f', capDark: '#786d4d', skin: '#c88864' } },
  qing: { label: '海边咖啡师', kit: 'barista', width: 0.92, depth: 0.95, headScale: [0.98, 1.04, 1],
    palette: { shirt: '#9d4d57', pants: '#34383d', hair: '#55372f', accent: '#335f63', bag: '#a19a7e', hat: '#d2c5aa', skin: '#edc7ac' } },
  ran: { label: '净滩领队', kit: 'cleanup', width: 1.11, depth: 1.04, headScale: [1.03, 1, 0.96],
    palette: { shirt: '#c46c3f', pants: '#2f4651', hair: '#252120', cap: '#347b78', capDark: '#275956', skin: '#aa6f52' } },
  ning: { label: '度假游客', kit: 'towel', width: 0.96, depth: 1.05, headScale: [1, 0.98, 1.05],
    palette: { shirt: '#8b78a3', pants: '#3d586b', hair: '#4b352d', accent: '#5d8792', bag: '#aa8d78', hat: '#b9cdd0', skin: '#deb092' } },
});

const color = value => new THREE.Color(value);

function nearestColorKey(source, r, g, b) {
  let winner = null;
  let distance = Infinity;
  for (const [key, sample] of Object.entries(source)) {
    const next = (sample[0] - r) ** 2 + (sample[1] - g) ** 2 + (sample[2] - b) ** 2;
    if (next < distance) { distance = next; winner = key; }
  }
  return winner;
}

export function applyNpcPalette(model, appearance, gender) {
  const source = SOURCE_COLORS[gender];
  let recoloredVertices = 0;
  model.traverse((mesh) => {
    if (!mesh.isMesh) return;
    mesh.geometry = mesh.geometry.clone();
    const colors = mesh.geometry.getAttribute('color');
    if (colors) {
      for (let index = 0; index < colors.count; index += 1) {
        const key = nearestColorKey(source, colors.getX(index), colors.getY(index), colors.getZ(index));
        const target = appearance.palette[key];
        if (!target) continue;
        const next = color(target);
        colors.setXYZ(index, next.r, next.g, next.b);
        recoloredVertices += 1;
      }
      colors.needsUpdate = true;
    }
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const cloned = materials.map(material => {
      const next = material.clone();
      next.envMapIntensity = 0.55;
      next.roughness = 0.88;
      return next;
    });
    mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0];
  });
  return recoloredVertices;
}

function addPart(parts, geometry, position, scale, shade, rotation = [0, 0, 0]) {
  geometry.applyMatrix4(new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    new THREE.Vector3(...scale),
  ));
  const value = color(shade);
  const colors = new Float32Array(geometry.getAttribute('position').count * 3);
  for (let index = 0; index < colors.length; index += 3) {
    colors[index] = value.r; colors[index + 1] = value.g; colors[index + 2] = value.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  parts.push(geometry);
}

function box(parts, position, scale, shade, rotation) {
  addPart(parts, new THREE.BoxGeometry(1, 1, 1, 1, 1, 1), position, scale, shade, rotation);
}

function sphere(parts, position, scale, shade) {
  addPart(parts, new THREE.SphereGeometry(1, 10, 7), position, scale, shade);
}

function cylinder(parts, position, scale, shade, rotation) {
  addPart(parts, new THREE.CylinderGeometry(1, 1, 1, 10, 1), position, scale, shade, rotation);
}

function torus(parts, position, scale, shade, rotation) {
  addPart(parts, new THREE.TorusGeometry(1, 0.13, 6, 14), position, scale, shade, rotation);
}

function createKitGeometry(kind) {
  const parts = [];
  if (kind === 'collector') {
    box(parts, [-0.33, 0.91, 0.34], [0.2, 0.25, 0.09], '#6e8066', [0, 0, -0.08]);
    box(parts, [-0.33, 0.91, 0.39], [0.12, 0.09, 0.02], '#c6d4b1');
    cylinder(parts, [0.3, 1.12, 0.38], [0.065, 0.18, 0.065], '#d6c187', [Math.PI / 2, 0, 0.18]);
  } else if (kind === 'cue-case') {
    cylinder(parts, [-0.18, 1.08, -0.31], [0.075, 0.78, 0.075], '#4e342e', [0, 0, -0.42]);
    cylinder(parts, [-0.18, 1.73, -0.31], [0.09, 0.07, 0.09], '#b99055', [0, 0, -0.42]);
    box(parts, [0, 1.1, -0.28], [0.035, 1.22, 0.035], '#8f765c', [0, 0, -0.42]);
  } else if (kind === 'coffee') {
    sphere(parts, [0, 1.04, 0.34], [0.1, 0.07, 0.05], '#8b4c43');
    box(parts, [-0.05, 0.94, 0.33], [0.06, 0.17, 0.022], '#8b4c43', [0, 0, 0.2]);
    box(parts, [0.05, 0.94, 0.33], [0.06, 0.17, 0.022], '#8b4c43', [0, 0, -0.2]);
    cylinder(parts, [0.32, 0.75, 0.36], [0.09, 0.17, 0.09], '#e4d4b1');
    torus(parts, [0.42, 0.77, 0.36], [0.075, 0.075, 0.075], '#e4d4b1', [0, Math.PI / 2, 0]);
  } else if (kind === 'surfboard') {
    sphere(parts, [0.2, 1.02, -0.32], [0.19, 0.82, 0.055], '#d36e48');
    box(parts, [0.2, 1.04, -0.38], [0.025, 1.18, 0.02], '#f2d6a2');
    box(parts, [0.2, 0.35, -0.38], [0.11, 0.14, 0.035], '#2b6d78', [0.1, 0, 0]);
  } else if (kind === 'backpack') {
    box(parts, [0, 1.05, -0.34], [0.48, 0.62, 0.18], '#59664b');
    box(parts, [0, 1.2, -0.45], [0.35, 0.18, 0.035], '#84916c');
    cylinder(parts, [0.3, 0.97, -0.34], [0.07, 0.27, 0.07], '#c49a62');
  } else if (kind === 'camera') {
    box(parts, [-0.12, 1.02, 0.3], [0.035, 0.38, 0.022], '#4c3d39', [0, 0, -0.36]);
    box(parts, [0.12, 1.02, 0.3], [0.035, 0.38, 0.022], '#4c3d39', [0, 0, 0.36]);
    box(parts, [0, 0.79, 0.35], [0.27, 0.19, 0.12], '#273337');
    cylinder(parts, [0, 0.79, 0.47], [0.08, 0.07, 0.08], '#6c8d94', [Math.PI / 2, 0, 0]);
  } else if (kind === 'merchant') {
    box(parts, [0, 0.78, 0.3], [0.4, 0.42, 0.04], '#d2bea0');
    box(parts, [0, 0.98, 0.35], [0.46, 0.055, 0.022], '#6d5844');
    box(parts, [0, 0.71, 0.35], [0.2, 0.11, 0.022], '#aa8f6f');
    cylinder(parts, [0.18, 0.91, 0.39], [0.055, 0.022, 0.055], '#d0a64e', [Math.PI / 2, 0, 0]);
  } else if (kind === 'barista') {
    box(parts, [0, 0.8, 0.3], [0.38, 0.4, 0.04], '#354f50');
    box(parts, [-0.1, 1.01, 0.31], [0.042, 0.28, 0.022], '#eadfc7', [0, 0, -0.3]);
    box(parts, [0.1, 1.01, 0.31], [0.042, 0.28, 0.022], '#eadfc7', [0, 0, 0.3]);
    box(parts, [0.12, 0.89, 0.36], [0.08, 0.05, 0.018], '#c68b57');
  } else if (kind === 'cleanup') {
    box(parts, [-0.16, 0.97, 0.34], [0.06, 0.34, 0.022], '#eee3bd', [0, 0, 0.12]);
    box(parts, [0.16, 0.97, 0.34], [0.06, 0.34, 0.022], '#eee3bd', [0, 0, -0.12]);
    box(parts, [0, 0.81, 0.34], [0.43, 0.06, 0.022], '#d98245');
    cylinder(parts, [0.43, 0.86, -0.24], [0.025, 0.72, 0.025], '#8c9690', [0, 0, -0.22]);
  } else if (kind === 'towel') {
    cylinder(parts, [0, 1.03, -0.34], [0.16, 0.52, 0.16], '#7ca9b0', [0, 0, Math.PI / 2]);
    torus(parts, [0, 1.03, -0.34], [0.18, 0.18, 0.18], '#e2d4b8', [0, Math.PI / 2, 0]);
    box(parts, [-0.34, 0.83, 0.28], [0.26, 0.36, 0.1], '#a88673', [0, 0, -0.08]);
  }
  const geometry = mergeGeometries(parts, false);
  parts.forEach(part => part.dispose());
  geometry.computeBoundingSphere();
  return geometry;
}

export function createNpcAccessory(appearance) {
  const mesh = new THREE.Mesh(createKitGeometry(appearance.kit), new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.74, metalness: 0.02,
  }));
  mesh.name = `NpcAccessory-${appearance.kit}`;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

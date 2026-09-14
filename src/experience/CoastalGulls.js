import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function colored(geometry, color, scale, position) {
  geometry.scale(...scale).translate(...position);
  const tint = new THREE.Color(color);
  const colors = new Float32Array(geometry.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) tint.toArray(colors, i);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function bodyGeometry() {
  const parts = [
    colored(new THREE.SphereGeometry(1, 12, 8), '#e4e8e4', [.15, .16, .36], [0, 0, 0]),
    colored(new THREE.SphereGeometry(1, 12, 8), '#f4f2e9', [.12, .12, .16], [0, .105, .28]),
    colored(new THREE.ConeGeometry(1, 1, 8).rotateX(Math.PI / 2), '#bd923e', [.045, .038, .17], [0, .085, .48]),
    colored(new THREE.SphereGeometry(1, 6, 4), '#202c2d', [.018, .018, .018], [-.109, .137, .33]),
    colored(new THREE.SphereGeometry(1, 6, 4), '#202c2d', [.018, .018, .018], [.109, .137, .33]),
  ];
  for (let i = -2; i <= 2; i++) {
    parts.push(colored(new THREE.SphereGeometry(1, 6, 4), '#cbd3d2', [.033, .012, .20], [i * .039, 0, -.37]));
  }
  const geometry = mergeGeometries(parts);
  parts.forEach(part => part.dispose());
  return geometry;
}

function wingGeometry() {
  const parts = [colored(new THREE.SphereGeometry(1, 10, 6).rotateY(-.18),
    '#c2cecf', [.40, .035, .18], [.33, .025, -.015])];
  for (let i = 0; i < 7; i++) {
    const tip = i > 3;
    parts.push(colored(new THREE.SphereGeometry(1, 8, 4).rotateY(-.25 - i * .035),
      tip ? '#435256' : '#d9dede', [.15 + i * .009, .012, .055],
      [.49 + i * .066, .013 - i * .007, -.05 - i * .025]));
  }
  const geometry = mergeGeometries(parts);
  parts.forEach(part => part.dispose());
  return geometry;
}

export function createCoastalGulls(parent, quality) {
  const group = new THREE.Group();
  group.name = 'CoastalGulls';
  const count = quality === 'high' ? 6 : 3;
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .83, envMapIntensity: .5 });
  const bodies = new THREE.InstancedMesh(bodyGeometry(), material, count);
  const wings = new THREE.InstancedMesh(wingGeometry(), material, count);
  const mirrored = wings.geometry.clone().scale(-1, 1, 1);
  const indices = mirrored.index.array;
  for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
  const leftWings = new THREE.InstancedMesh(mirrored, material, count);
  leftWings.name = 'GullLeftFeatherWings';
  bodies.name = 'GullBodies'; wings.name = 'GullFeatherWings';
  group.add(bodies, wings, leftWings); parent.add(group);
  const body = new THREE.Object3D(), wing = new THREE.Object3D(), matrix = new THREE.Matrix4();
  for (const mesh of [bodies, wings, leftWings]) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
  }
  group.update = elapsed => {
    for (let i = 0; i < count; i++) {
      const phase = elapsed * .032 + i * .16;
      body.position.set(-4 + Math.cos(phase) * 43, 17 + Math.sin(phase * 1.7 + i) * 2.3 + i * .3,
        -27 + Math.sin(phase) * 25);
      body.rotation.set(0, Math.atan2(-43 * Math.sin(phase), 25 * Math.cos(phase)), -.12);
      body.scale.setScalar(.8 + i * .055); body.updateMatrix(); bodies.setMatrixAt(i, body.matrix);
      // Short flapping bursts alternate with banking glides, independently per bird.
      const burst = THREE.MathUtils.smoothstep(Math.sin(elapsed * .62 + i * 1.4), .12, .75);
      const flap = Math.sin(elapsed * 5.8 + i * 1.7) * .52 * burst;
      for (let side = 0; side < 2; side++) {
        wing.position.set(side ? -.09 : .09, .04, 0);
        wing.rotation.set(0, 0, (side ? -1 : 1) * (.10 + flap));
        wing.updateMatrix(); matrix.multiplyMatrices(body.matrix, wing.matrix);
        (side ? leftWings : wings).setMatrixAt(i, matrix);
      }
    }
    bodies.instanceMatrix.needsUpdate = true; wings.instanceMatrix.needsUpdate = true; leftWings.instanceMatrix.needsUpdate = true;
  };
  group.update(0);
  return group;
}

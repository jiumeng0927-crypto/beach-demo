import * as THREE from 'three';

const COLORS = ['#faf9f2', '#e5bd18', '#2856bc', '#c93734', '#713797', '#e97822', '#247a50', '#852b38', '#161a20'];

export function createTableWoodTexture() {
  if (typeof document === 'undefined') return new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 128;
  const context = canvas.getContext('2d'), pixels = context.createImageData(512, 128);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 512; x++) {
    const grain = Math.sin(y * 1.7 + Math.sin(x * 0.017) * 0.8)
      + 0.45 * Math.sin(y * 0.49 + Math.sin(x * 0.034 + y * 0.07));
    const offset = (y * 512 + x) * 4;
    pixels.data.set([99 + grain * 5, 77 + grain * 4, 61 + grain * 3, 255], offset);
  }
  context.putImageData(pixels, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  return texture;
}

export function createTableClothTexture() {
  if (typeof document === 'undefined') return new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#187664';
  ctx.fillRect(0, 0, 1024, 512);
  const pixels = ctx.getImageData(0, 0, 1024, 512);
  let seed = 1937;
  for (let i = 0; i < pixels.data.length; i += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const grain = (seed / 0x100000000 - 0.5) * 4;
    for (let channel = 0; channel < 3; channel++) pixels.data[i + channel] += grain;
  }
  ctx.putImageData(pixels, 0, 0);
  const head = (0.5 - 1.5875 / 7.4) * 1024;
  ctx.strokeStyle = 'rgba(245,250,236,0.52)';
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(head, 65); ctx.lineTo(head, 447); ctx.stroke();
  ctx.fillStyle = '#e7eddb';
  ctx.beginPath(); ctx.arc(1024 - head, 256, 2.5, 0, Math.PI * 2); ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function createBallAtlas() {
  // Node rule tests have no DOM; browser rendering always builds the numbered atlas.
  if (typeof document === 'undefined') return new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  for (let n = 0; n < 16; n += 1) {
    const x = (n % 4) * 256;
    const y = (3 - Math.floor(n / 4)) * 256;
    ctx.fillStyle = n > 8 ? COLORS[0] : COLORS[n];
    ctx.fillRect(x, y, 256, 256);
    if (n > 8) {
      ctx.fillStyle = COLORS[n - 8];
      ctx.fillRect(x, y + 75, 256, 106);
    }
    if (!n) continue;
    for (const u of [64, 192]) {
      ctx.fillStyle = '#fffdf5';
      ctx.beginPath();
      ctx.ellipse(x + u, y + 128, 23, 39, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.translate(x + u, y + 128);
      ctx.scale(0.62, 1);
      ctx.fillStyle = '#141821';
      ctx.font = 'bold 48px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(n), 0, 3);
      ctx.restore();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function createNumberedBallMaterial(geometry) {
  geometry.setAttribute('ballNumber', new THREE.InstancedBufferAttribute(Float32Array.from({ length: 16 }, (_, i) => i), 1));
  const material = new THREE.MeshStandardMaterial({
    name: 'ChineseEightBallNumberAtlas', map: createBallAtlas(), roughness: 0.22, metalness: 0,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float ballNumber;\nvarying float vBallNumber;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBallNumber = ballNumber;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vBallNumber;')
      .replace('#include <map_fragment>', `
        float number = floor(vBallNumber + 0.5);
        vec2 tile = vec2(mod(number, 4.0), floor(number / 4.0));
        vec2 atlasUv = (clamp(vMapUv, vec2(0.003), vec2(0.997)) + tile) / 4.0;
        diffuseColor *= texture2D(map, atlasUv);
      `);
  };
  material.customProgramCacheKey = () => 'chinese-eight-ball-atlas-v2';
  return material;
}

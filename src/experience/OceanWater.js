import * as THREE from 'three';
import { OCEAN_SWELL_FADE_START_Z, OCEAN_SWELL_FADE_END_Z } from './OceanSwell.js';
import { COAST_EXTENT } from './CoastBoundary.js';

export function createOceanGeometry(quality = 'high') {
  const sx = quality === 'high' ? 128 : 96, sy = quality === 'high' ? 96 : 72;
  const geometry = new THREE.PlaneGeometry(1, 1, sx, sy);
  const positions = geometry.attributes.position;
  const spacing = new Float32Array(positions.count);
  const originalZ = (t) => t < 0.12 ? 40 - t * 250
    : t < 0.64 ? 10 - (t - 0.12) * 55 / 0.52
      : -45 - Math.pow((t - 0.64) / 0.36, 2) * 1000;
  const extend = (value, start, edge) => value + (COAST_EXTENT - edge)
    * Math.pow(Math.max(0, (value - start) / (edge - start)), 3);
  const coastX = (x) => Math.sign(x) * extend(Math.abs(x * 70 + x ** 5 * 530), 160, 600);
  const coastZ = (t) => {
    const z = originalZ(t);
    return z < -180 ? -extend(-z, 180, 1045) : z;
  };
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i) * 2, t = 0.5 - positions.getY(i);
    positions.setXYZ(i, coastX(x), -119 - coastZ(t), 0);
    // Actual adjacent spacing includes outer-grid stretching, so unresolved
    // Gerstner waves cannot turn distant cells into giant animated triangles.
    spacing[i] = Math.max(
      Math.abs(coastX(Math.min(1, x + 2 / sx)) - coastX(x)),
      Math.abs(coastX(x) - coastX(Math.max(-1, x - 2 / sx))),
      Math.abs(coastZ(Math.min(1, t + 1 / sy)) - coastZ(t)),
      Math.abs(coastZ(t) - coastZ(Math.max(0, t - 1 / sy))));
  }
  // The nonuniform depth mapping reverses PlaneGeometry's row direction.
  const baseIndices = geometry.index.array;
  for (let i = 0; i < baseIndices.length; i += 3) {
    [baseIndices[i + 1], baseIndices[i + 2]] = [baseIndices[i + 2], baseIndices[i + 1]];
  }

  // Continue the water landward only beyond the authored beach's side edges.
  // These four flat triangles hide the finite ocean edge in along-shore views
  // without flooding the playable sand or adding unresolved distant waves.
  const wingPositions = new Float32Array([
    -COAST_EXTENT, -159, 0, -130, -159, 0,
    -COAST_EXTENT, -COAST_EXTENT - 119, 0, -130, -COAST_EXTENT - 119, 0,
    130, -159, 0, COAST_EXTENT, -159, 0,
    130, -COAST_EXTENT - 119, 0, COAST_EXTENT, -COAST_EXTENT - 119, 0,
  ]);
  const baseVertexCount = positions.count;
  const mergedPositions = new Float32Array(positions.array.length + wingPositions.length);
  mergedPositions.set(positions.array);
  mergedPositions.set(wingPositions, positions.array.length);
  const mergedNormals = new Float32Array(geometry.attributes.normal.array.length + 24);
  mergedNormals.set(geometry.attributes.normal.array);
  for (let i = geometry.attributes.normal.array.length; i < mergedNormals.length; i += 3) {
    mergedNormals.set([0, 0, 1], i);
  }
  const mergedUvs = new Float32Array(geometry.attributes.uv.array.length + 16);
  mergedUvs.set(geometry.attributes.uv.array);
  mergedUvs.set([0, 1, 1, 1, 0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0], geometry.attributes.uv.array.length);
  const mergedSpacing = new Float32Array(spacing.length + 8);
  mergedSpacing.set(spacing);
  mergedSpacing.fill(COAST_EXTENT, spacing.length);
  const mergedIndices = new baseIndices.constructor(baseIndices.length + 12);
  mergedIndices.set(baseIndices);
  mergedIndices.set([
    baseVertexCount, baseVertexCount + 2, baseVertexCount + 1,
    baseVertexCount + 2, baseVertexCount + 3, baseVertexCount + 1,
    baseVertexCount + 4, baseVertexCount + 6, baseVertexCount + 5,
    baseVertexCount + 6, baseVertexCount + 7, baseVertexCount + 5,
  ], baseIndices.length);
  geometry.setAttribute('position', new THREE.BufferAttribute(mergedPositions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(mergedNormals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(mergedUvs, 2));
  geometry.setAttribute('oceanSpacing', new THREE.BufferAttribute(mergedSpacing, 1));
  geometry.setIndex(new THREE.BufferAttribute(mergedIndices, 1));
  geometry.computeBoundingBox();
  geometry.boundingBox.min.z = -4;
  geometry.boundingBox.max.z = 4;
  geometry.boundingSphere = new THREE.Sphere();
  geometry.boundingBox.getBoundingSphere(geometry.boundingSphere);
  geometry.userData.oceanQuality = quality;
  geometry.userData.horizonWingTriangles = 4;
  return geometry;
}

export const OCEAN_VERTEX_SHADER = /* glsl */ `
  uniform mat4 textureMatrix;
  uniform float time;
  uniform float uSwellStrength;
  uniform float uWindFactor;
  attribute float oceanSpacing;
  varying vec4 mirrorCoord;
  varying vec4 worldPosition;
  varying vec4 vOceanClip;
  varying vec3 vOceanNormal;
  varying vec3 vOceanView;
  varying float vOceanCrest;
  #include <common>
  #include <fog_pars_vertex>
  #include <shadowmap_pars_vertex>
  #include <logdepthbuf_pars_vertex>

  void gerstner(vec2 p, vec2 direction, float wavelength, float amplitude,
    inout vec3 displacement, inout vec3 tangent, inout vec3 bitangent) {
    float k = 6.28318530718 / wavelength;
    float resolved = 1.0 - smoothstep(wavelength * 0.22, wavelength * 0.48, oceanSpacing);
    float a = amplitude * resolved;
    float phase = k * dot(direction, p) - sqrt(9.81 * k) * time;
    float s = sin(phase), c = cos(phase), q = 0.55;
    displacement += vec3(q * a * direction.x * c, a * s, q * a * direction.y * c);
    tangent += vec3(-q * a * k * direction.x * direction.x * s,
      a * k * direction.x * c, -q * a * k * direction.x * direction.y * s);
    bitangent += vec3(-q * a * k * direction.x * direction.y * s,
      a * k * direction.y * c, -q * a * k * direction.y * direction.y * s);
  }

  void main() {
    vec4 baseWorld = modelMatrix * vec4(position, 1.0);
    float farOceanMask = 1.0 - smoothstep(${OCEAN_SWELL_FADE_START_Z.toFixed(1)}, ${OCEAN_SWELL_FADE_END_Z.toFixed(1)}, baseWorld.z);
    float strength = uSwellStrength * farOceanMask * (0.7 + 0.3 * uWindFactor);
    vec3 displacement = vec3(0.0), tangent = vec3(1.0, 0.0, 0.0), bitangent = vec3(0.0, 0.0, 1.0);
    gerstner(baseWorld.xz, normalize(vec2(0.25, 1.0)), 48.0, 1.15 * strength, displacement, tangent, bitangent);
    gerstner(baseWorld.xz, normalize(vec2(-0.48, 1.0)), 25.0, 0.65 * strength, displacement, tangent, bitangent);
    gerstner(baseWorld.xz, normalize(vec2(0.82, 0.57)), 14.0, 0.28 * strength, displacement, tangent, bitangent);
    gerstner(baseWorld.xz, normalize(vec2(-0.3, 1.0)), 8.0, 0.10 * strength, displacement, tangent, bitangent);
    worldPosition = baseWorld + vec4(displacement, 0.0);
    vOceanNormal = normalize(cross(bitangent, tangent));
    vOceanCrest = displacement.y;
    mirrorCoord = textureMatrix * worldPosition;
    vec4 mvPosition = viewMatrix * worldPosition;
    vOceanView = mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
    vOceanClip = gl_Position;
    #include <beginnormal_vertex>
    #include <defaultnormal_vertex>
    #include <logdepthbuf_vertex>
    #include <fog_vertex>
    #include <shadowmap_vertex>
  }
`;

export const OCEAN_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D mirrorSampler;
  uniform sampler2D normalSampler;
  uniform sampler2D uRefractionColor;
  uniform sampler2D uRefractionDepth;
  uniform vec2 uRefractionTexelSize;
  uniform float time;
  uniform float distortionScale;
  uniform float uReflectionStrength;
  uniform float uSunGlintStrength;
  uniform float uWindFactor;
  uniform float uDaylight;
  uniform float uFoamStrength;
  uniform float uCameraNear;
  uniform float uCameraFar;
  uniform vec3 sunColor;
  uniform vec3 sunDirection;
  uniform vec3 eye;
  uniform vec3 waterColor;
  uniform vec3 uHorizonWaterColor;
  uniform vec3 uDeepWaterColor;
  varying vec4 mirrorCoord;
  varying vec4 worldPosition;
  varying vec4 vOceanClip;
  varying vec3 vOceanNormal;
  varying vec3 vOceanView;
  varying float vOceanCrest;
  #include <common>
  #include <packing>
  #include <bsdfs>
  #include <fog_pars_fragment>
  #include <logdepthbuf_pars_fragment>
  #include <lights_pars_begin>
  #include <shadowmap_pars_fragment>
  #include <shadowmask_pars_fragment>

  float sceneDistance(vec2 uv) {
    // The depth target is smaller on mobile. Nearest sampling produces dry/wet
    // bands against the full-resolution water plane; reconstruct window depth
    // at the actual pixel before linearizing. Keep the depth sampler NEAREST:
    // hardware filtering of depth components is not portable across devices.
    vec2 pixel = uv / uRefractionTexelSize - 0.5;
    vec2 base = (floor(pixel) + 0.5) * uRefractionTexelSize;
    vec2 weight = fract(pixel);
    float a = texture2D(uRefractionDepth, base).x;
    float b = texture2D(uRefractionDepth, base + vec2(uRefractionTexelSize.x, 0.0)).x;
    float c = texture2D(uRefractionDepth, base + vec2(0.0, uRefractionTexelSize.y)).x;
    float d = texture2D(uRefractionDepth, base + uRefractionTexelSize).x;
    float windowDepth = mix(mix(a, b, weight.x), mix(c, d, weight.x), weight.y);
    return -perspectiveDepthToViewZ(windowDepth, uCameraNear, uCameraFar);
  }

  vec2 capillarySlope(vec2 p, vec2 direction, float wavelength, float amplitude) {
    float k = 6.28318530718 / wavelength;
    float phase = k * dot(p, direction) - sqrt(9.81 * k) * time;
    float footprint = length(fwidth(p)) * k;
    float resolved = 1.0 - smoothstep(0.7, 2.4, footprint);
    return direction * (cos(phase) + 0.22 * cos(phase * 2.0)) * amplitude * k * resolved;
  }

  void main() {
    #include <logdepthbuf_fragment>
    vec3 viewDirection = normalize(eye - worldPosition.xyz);
    float distanceToEye = length(eye - worldPosition.xyz);
    vec2 p = worldPosition.xz;
    vec2 a = texture2D(normalSampler, p * vec2(0.045, 0.085) + time * vec2(0.004, -0.012)).xy * 2.0 - 1.0;
    // This layer swaps its UV axes; its sampled slope must use the same frame.
    vec2 b = (texture2D(normalSampler, p.yx * vec2(0.11, 0.065) + time * vec2(-0.009, 0.004)).xy * 2.0 - 1.0).yx;
    vec2 c = texture2D(normalSampler, p * 0.31 + time * vec2(0.012, -0.021)).xy * 2.0 - 1.0;
    float fineFade = 1.0 - smoothstep(60.0, 260.0, distanceToEye);
    vec2 warpedP = p + a * 1.7 + b * 0.8;
    vec2 slope = capillarySlope(warpedP, normalize(vec2(0.18, 1.0)), 5.3, 0.019)
      + capillarySlope(warpedP, normalize(vec2(-0.38, 1.0)), 2.7, 0.007)
      + capillarySlope(warpedP, normalize(vec2(0.71, 0.70)), 1.25, 0.002);
    // Fade unresolved surface detail by pixel footprint, not distance alone.
    // Grazing views can span many world units even close to the camera.
    float footprint = max(length(dFdx(p)), length(dFdy(p)));
    float mediumDetail = 1.0 - smoothstep(0.45, 2.8, footprint);
    float fineDetail = fineFade * (1.0 - smoothstep(0.12, 0.8, footprint));
    vec2 ripple = (a * 0.14 + b * 0.095 * mediumDetail + c * 0.028 * fineDetail - slope)
      * (0.35 + uWindFactor * 0.65);
    ripple *= 1.0 - smoothstep(220.0, 900.0, distanceToEye);
    vec3 surfaceNormal = normalize(vOceanNormal + vec3(ripple.x, 0.0, ripple.y));
    vec2 screenUv = vOceanClip.xy / vOceanClip.w * 0.5 + 0.5;
    float surfaceDistance = -vOceanView.z;
    float rayScale = length(vOceanView) / max(surfaceDistance, 0.1);
    float depth = max(0.0, (sceneDistance(screenUv) - surfaceDistance) * rayScale);
    vec2 viewNormal = (viewMatrix * vec4(surfaceNormal - vec3(0.0, 1.0, 0.0), 0.0)).xy;
    float screenEdge = smoothstep(0.0, 0.06, min(min(screenUv.x, 1.0 - screenUv.x), min(screenUv.y, 1.0 - screenUv.y)));
    vec2 refractionUv = clamp(screenUv + viewNormal * 0.003 * min(depth, 1.5) * distortionScale * screenEdge, 0.001, 0.999);
    // Reject foreground silhouettes instead of smearing them beneath the water.
    if (sceneDistance(refractionUv) < surfaceDistance + 0.025) refractionUv = screenUv;
    depth = clamp((sceneDistance(refractionUv) - surfaceDistance) * rayScale, 0.0, 40.0);
    vec3 absorption = vec3(0.18, 0.052, 0.026);
    vec3 scattering = vec3(0.006, 0.018, 0.020);
    vec3 extinction = absorption + scattering;
    vec3 deepAbsorption = exp(-extinction * depth);
    vec3 refracted = texture2D(uRefractionColor, refractionUv).rgb;
    float nDotV = max(dot(surfaceNormal, viewDirection), 0.02);
    float fresnel = 0.02037 + 0.97963 * pow(1.0 - nDotV, 5.0);
    vec2 mirrorUv = mirrorCoord.xy / mirrorCoord.w + viewNormal * distortionScale * 0.008;
    vec3 reflected = texture2D(mirrorSampler, clamp(mirrorUv, 0.001, 0.999)).rgb;
    float lightAmount = (0.10 + uDaylight * 0.90) * (0.55 + max(sunDirection.y, 0.0) * 0.45);
    // Single-scattering approximation: separate extinction from angular in-scatter.
    vec3 refractedView = refract(-viewDirection, surfaceNormal, 1.0 / 1.333);
    float cosScatter = dot(-refractedView, sunDirection);
    float phaseG = 0.38;
    float phase = (1.0 - phaseG * phaseG) / pow(max(0.1, 1.0 + phaseG * phaseG - 2.0 * phaseG * cosScatter), 1.5);
    vec3 scatter = scattering / extinction * (0.28 + 0.36 * phase) * lightAmount;
    scatter *= mix(vec3(1.0), sunColor, 0.35);
    scatter = mix(scatter, waterColor * 0.38 + uDeepWaterColor * 0.45, 0.18);
    float sunDepth = depth * max(viewDirection.y, 0.05) / max(sunDirection.y, 0.18);
    vec3 bottomLight = exp(-extinction * sunDepth * 0.32);
    vec3 transmitted = refracted * deepAbsorption * bottomLight + scatter * (1.0 - deepAbsorption);
    float crestLight = smoothstep(0.05, 0.55, vOceanCrest) * pow(max(dot(viewDirection, -sunDirection), 0.0), 3.0);
    transmitted += vec3(0.015, 0.10, 0.085) * crestLight * lightAmount * (1.0 - deepAbsorption);
    vec3 halfDirection = normalize(sunDirection + viewDirection);
    float nDotH = max(dot(surfaceNormal, halfDirection), 0.0);
    float nDotL = max(dot(surfaceNormal, sunDirection), 0.0);
    // Broaden subpixel glints instead of letting fine normal detail sparkle.
    float normalVariance = dot(dFdx(surfaceNormal), dFdx(surfaceNormal)) + dot(dFdy(surfaceNormal), dFdy(surfaceNormal));
    float roughness = clamp(0.12 + (1.0 - fineDetail) * 0.10 + normalVariance * 0.65, 0.12, 0.36);
    float alpha2 = pow(roughness, 4.0);
    float denom = nDotH * nDotH * (alpha2 - 1.0) + 1.0;
    float distribution = alpha2 / max(3.14159 * denom * denom, 0.00001);
    float k = roughness * roughness * 0.5;
    float visibility = nDotV / (nDotV * (1.0 - k) + k) * nDotL / (nDotL * (1.0 - k) + k);
    float specular = min(12.0, distribution * visibility * 0.02037 / max(4.0 * nDotV, 0.04));
    vec3 color = transmitted * (1.0 - fresnel) + reflected * fresnel * uReflectionStrength;
    color += sunColor * specular * uSunGlintStrength * getShadowMask();
    float shoreFoam = (1.0 - smoothstep(0.035, 0.48, depth)) * smoothstep(0.003, 0.045, depth);
    shoreFoam *= smoothstep(0.18, 0.73, a.x * b.y + 0.5) * 0.42;
    // A raised wave is not necessarily breaking. Keep whitecaps sparse in a
    // breeze and confine them to steep, exposed crests in deeper water.
    float crestFoam = smoothstep(0.34, 0.82, vOceanCrest) * smoothstep(0.53, 0.82, a.y * b.x + 0.5);
    crestFoam *= smoothstep(0.10, 0.24, length(vOceanNormal.xz))
      * smoothstep(0.65, 1.75, uWindFactor) * smoothstep(0.5, 2.5, depth) * 0.26;
    color = mix(color, vec3(0.86, 0.91, 0.87) * lightAmount, clamp((shoreFoam + crestFoam) * uFoamStrength, 0.0, 0.65));
    // Resolve the thin shoreline coverage before the grazing-angle reflection.
    // Without this, a barely submerged triangle turns into an opaque bright shard.
    float verticalDepth = depth * max(viewDirection.y, 0.05);
    float waterCoverage = smoothstep(0.002, max(0.10, fwidth(verticalDepth) * 1.5), verticalDepth);
    color = mix(refracted, color, waterCoverage);
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
    // Three r160 supplies fogColor in the active target's output color space.
    // Do not feed it back into linear lighting and convert it a second time.
    #ifdef USE_FOG
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, smoothstep(300.0, 800.0, distanceToEye));
    #endif
  }
`;

export class OceanRefraction {
  constructor(water, quality) {
    this.water = water;
    this.quality = quality;
    this.size = new THREE.Vector2();
    this.viewport = new THREE.Vector4();
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true });
    this.target.texture.name = 'OceanRefractionColor';
    this.target.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    this.target.depthTexture.name = 'OceanRefractionDepth';
    this.captures = 0;
    this.disposed = false;
    Object.assign(water.material.uniforms, {
      uRefractionColor: { value: this.target.texture }, uRefractionDepth: { value: this.target.depthTexture },
      uRefractionTexelSize: { value: new THREE.Vector2(1, 1) },
      uCameraNear: { value: 0.1 }, uCameraFar: { value: 1800 },
      uWindFactor: { value: 1 }, uDaylight: { value: 1 },
      uFoamStrength: { value: 0.85 },
    });
    water.material.vertexShader = OCEAN_VERTEX_SHADER;
    water.material.fragmentShader = OCEAN_FRAGMENT_SHADER;
    water.material.name = 'TidelinePhysicalOcean';
    water.material.needsUpdate = true;
  }

  capture(renderer, scene, camera, excluded = []) {
    if (this.disposed || this.capturing) return;
    renderer.getDrawingBufferSize(this.size);
    const scale = Math.min(1, (this.quality === 'high' ? 1536 : 768) / Math.max(this.size.x, this.size.y));
    const width = Math.max(1, Math.round(this.size.x * scale)), height = Math.max(1, Math.round(this.size.y * scale));
    if (width !== this.target.width || height !== this.target.height) this.target.setSize(width, height);
    this.water.material.uniforms.uRefractionTexelSize.value.set(1 / width, 1 / height);
    const previous = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
    renderer.getViewport(this.viewport);
    const shadows = renderer.shadowMap.autoUpdate, xr = renderer.xr.enabled, visible = this.water.visible;
    this.water.material.uniforms.uCameraNear.value = camera.near;
    this.water.material.uniforms.uCameraFar.value = camera.far;
    this.capturing = true;
    const hidden = excluded.filter(Boolean).map((object) => [object, object.visible]);
    try {
      for (const [object] of hidden) object.visible = false;
      this.water.visible = false;
      renderer.xr.enabled = false;
      renderer.shadowMap.autoUpdate = false;
      renderer.setRenderTarget(this.target);
      // Previous transparent draws leave depth writes disabled. WebGL clear
      // respects that mask, so stale depth would survive camera movement.
      renderer.state.buffers.depth.setMask(true);
      renderer.clear();
      renderer.render(scene, camera);
      this.captures++;
    } finally {
      renderer.setRenderTarget(previous, face, mip);
      renderer.setViewport(this.viewport);
      renderer.shadowMap.autoUpdate = shadows;
      renderer.xr.enabled = xr;
      this.water.visible = visible;
      for (const [object, visibility] of hidden) object.visible = visibility;
      this.capturing = false;
    }
  }

  getState() {
    return { quality: this.quality, width: this.target.width, height: this.target.height,
      captures: this.captures, depth: this.target.depthTexture.isDepthTexture,
      triangles: this.water.geometry.index.count / 3, disposed: this.disposed };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.target.dispose();
  }
}

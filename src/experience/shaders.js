import * as THREE from 'three';
import { addTidalWetness, TIDAL_WETNESS_GLSL } from './CoastalStyle.js';

// This module demonstrates two technical-art workflows:
// 1. patch Three.js PBR materials with onBeforeCompile;
// 2. own the complete vertex/fragment pair with ShaderMaterial.
const SAND_VERTEX_HEADER = /* glsl */ `
  varying vec3 vBeachWorldPosition;
`;

const SAND_FRAGMENT_HEADER = /* glsl */ `
  uniform float uSandTime;
  uniform float uShoreline;
  uniform float uWaterHeight;
  uniform float uDaylight;
  uniform vec3 uDrySandColor;
  uniform vec3 uWetSandColor;
  uniform vec3 uUnderwaterSandColor;
  varying vec3 vBeachWorldPosition;

  float beachHash(vec2 point) {
    return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float beachNoise(vec2 point) {
    vec2 cell = floor(point);
    vec2 local = fract(point);
    local = local * local * local * (local * (local * 6.0 - 15.0) + 10.0);

    float a = beachHash(cell);
    float b = beachHash(cell + vec2(1.0, 0.0));
    float c = beachHash(cell + vec2(0.0, 1.0));
    float d = beachHash(cell + vec2(1.0, 1.0));

    return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
  }

  vec2 beachNoiseGradient(vec2 point) {
    vec2 cell = floor(point), t = fract(point);
    vec2 blend = t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
    vec2 derivative = 30.0 * t * t * (t - 1.0) * (t - 1.0);
    float a = beachHash(cell), b = beachHash(cell + vec2(1.0, 0.0));
    float c = beachHash(cell + vec2(0.0, 1.0)), d = beachHash(cell + vec2(1.0, 1.0));
    return vec2(mix(b - a, d - c, blend.y), mix(c - a, d - b, blend.x)) * derivative;
  }

  vec2 sandMicroSlope(vec2 point) {
    vec2 rotatedPoint = mat2(0.8, -0.6, 0.6, 0.8) * point;
    vec2 broad = beachNoiseGradient(point * 0.78) * (0.78 * 0.016)
      + mat2(0.8, 0.6, -0.6, 0.8) * beachNoiseGradient(rotatedPoint * 0.61 + vec2(11.2, 4.7)) * (0.61 * 0.014);
    float footprint = length(fwidth(point));
    float grainFade = 1.0 - smoothstep(0.15, 0.6, footprint * 5.8);
    vec2 grains = beachNoiseGradient(point * 5.8 + vec2(7.3, 2.1)) * (5.8 * 0.007) * grainFade;
    vec2 ripples = cos(point.x * 6.5 + point.y * 1.15) * vec2(6.5, 1.15) * 0.0035
      * (1.0 - smoothstep(0.35, 1.4, footprint * 6.6));
    return broad + grains + ripples;
  }

  float sandCaustics(vec2 point) {
    vec2 cell = floor(point), local = fract(point);
    float first = 8.0, second = 8.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 offset = vec2(float(x), float(y));
      vec2 seed = vec2(beachHash(cell + offset), beachHash(cell + offset + 43.7));
      vec2 site = offset + 0.5 + sin(seed * 6.28318 + uSandTime * 0.48) * 0.36 - local;
      float distance = dot(site, site);
      second = min(second, max(first, distance));
      first = min(first, distance);
    }
    float edge = sqrt(second) - sqrt(first);
    float aa = max(fwidth(edge), 0.015);
    return 1.0 - smoothstep(0.025, 0.075 + aa, edge);
  }
`;

/**
 * Extends the built-in PBR pipeline with world-space dry, wet and submerged
 * zones. High quality also adds procedural normals, caustics and clearcoat.
 */
export function createSandMaterial({ quality = 'high' } = {}) {
  const usePhysicalLayer = quality === 'high';
  const uniforms = {
    uSandTime: { value: 0 },
    uShoreline: { value: 5.5 },
    uWaterHeight: { value: 0 },
    uDaylight: { value: 1 },
    uDrySandColor: { value: new THREE.Color('#d6b77d') },
    uWetSandColor: { value: new THREE.Color('#665c4a') },
    uUnderwaterSandColor: { value: new THREE.Color('#315d58') },
  };

  const material = usePhysicalLayer
    ? new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        roughness: 0.88,
        metalness: 0,
        envMapIntensity: 0.82,
        clearcoat: 1,
        clearcoatRoughness: 0.18,
        ior: 1.33,
        specularIntensity: 0.72,
      })
    : new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.9,
        metalness: 0,
        envMapIntensity: 0.62,
      });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    // World position keeps the shoreline stable even if mesh UVs change.
    shader.vertexShader = `${SAND_VERTEX_HEADER}\n${shader.vertexShader}`.replace(
      '#include <project_vertex>',
      /* glsl */ `
        vBeachWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #include <project_vertex>
      `,
    );

    shader.fragmentShader = `${SAND_FRAGMENT_HEADER}\n${shader.fragmentShader}`
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
          #include <map_fragment>

          // Two differently oriented fields prevent the low-frequency color
          // breakup from revealing the square lattice of one value-noise grid.
          vec2 broadPoint = vBeachWorldPosition.xz * 0.055;
          vec2 rotatedBroadPoint =
            mat2(0.78, -0.63, 0.63, 0.78) *
            vBeachWorldPosition.xz *
            0.071 +
            vec2(8.4, 3.7);
          float broadNoise =
            beachNoise(broadPoint) * 0.58 +
            beachNoise(rotatedBroadPoint) * 0.42;
          float shoreVariation =
            sin(vBeachWorldPosition.x * 0.105 + broadNoise * 2.2) * 1.1 +
            sin(vBeachWorldPosition.x * 0.031 - uSandTime * 0.035) * 0.7;
          float localShoreline = uShoreline + shoreVariation;
          float sandDepth = uWaterHeight - vBeachWorldPosition.y;
          float wetMask = (1.0 - smoothstep(0.02, 0.38,
            -sandDepth + (broadNoise - 0.5) * 0.09)) *
            (1.0 - smoothstep(localShoreline + 8.0, localShoreline + 20.0, vBeachWorldPosition.z));
          float submergedMask = smoothstep(0.01, 0.16, sandDepth);

          float fineGrain = beachHash(floor(vBeachWorldPosition.xz * 31.0));
          fineGrain = mix(fineGrain, 0.5, smoothstep(0.4, 1.2, length(fwidth(vBeachWorldPosition.xz * 31.0))));
          float shellDust = beachNoise(vBeachWorldPosition.xz * 1.7);
          float dryVariation = mix(0.94, 1.045, broadNoise);
          vec3 sandColor = mix(uDrySandColor, uWetSandColor, wetMask);
          sandColor = mix(sandColor, uUnderwaterSandColor, submergedMask * 0.48);
          sandColor *= mix(dryVariation, 0.96, wetMask);
          sandColor *= 0.94 + fineGrain * 0.065 + shellDust * 0.035;
          ${
            usePhysicalLayer
              ? /* glsl */ `
                if (submergedMask > 0.01) {
                  vec2 causticPoint = vBeachWorldPosition.xz * 0.72;
                  causticPoint += vec2(beachNoise(causticPoint * 0.6 + uSandTime * 0.04),
                    beachNoise(causticPoint * 0.53 - uSandTime * 0.03)) * 0.8;
                  float causticLines = sandCaustics(causticPoint);
                  sandColor += vec3(0.016, 0.023, 0.020) * causticLines * submergedMask *
                    (0.25 + beachNoise(causticPoint * 0.38) * 0.75) *
                    exp(-max(sandDepth, 0.0) * 0.28) * uDaylight;
                }
              `
              : ''
          }
          diffuseColor.rgb *= sandColor;
        `,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `
          #include <roughnessmap_fragment>
          roughnessFactor = mix(0.94, 0.26, wetMask);
          roughnessFactor = mix(roughnessFactor, 0.48, submergedMask);
          roughnessFactor += (fineGrain - 0.5) * 0.055;
        `,
      );

    if (usePhysicalLayer) {
      // These replacements run only on the desktop material variant. Mobile
      // retains the cheaper color and roughness treatment above.
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <normal_fragment_maps>',
          /* glsl */ `
            #include <normal_fragment_maps>

            vec2 sandSlope = sandMicroSlope(vBeachWorldPosition.xz);
            float sandNormalStrength =
              mix(0.78, 0.44, wetMask) *
              mix(1.0, 0.5, submergedMask);
            normal = normalize(normal + mat3(viewMatrix) * vec3(-sandSlope.x, 0.0, -sandSlope.y) * sandNormalStrength);
          `,
        )
        .replace(
          '#include <lights_physical_fragment>',
          /* glsl */ `
            #include <lights_physical_fragment>
            material.clearcoat =
              wetMask *
              mix(0.82, 0.34, submergedMask);
            material.clearcoatRoughness =
              mix(0.2, 0.34, submergedMask);
          `,
        );
    }

    material.userData.shader = shader;
  };

  material.customProgramCacheKey = () =>
    `tideline-sand-v6-${usePhysicalLayer ? 'physical' : 'standard'}`;
  material.userData.uniforms = uniforms;
  return material;
}

const ROCK_VERTEX_HEADER = /* glsl */ `
  varying vec3 vRockWorldPosition;
`;

const ROCK_FRAGMENT_HEADER = /* glsl */ `
  uniform float uRockSeed;
  uniform vec3 uRockBaseColor;
  uniform vec3 uRockDarkColor;
  uniform vec3 uRockWetColor;
  uniform vec3 uRockMossColor;
  varying vec3 vRockWorldPosition;

  float rockHash(vec2 point) {
    return fract(sin(dot(point, vec2(269.5, 183.3))) * 43758.5453);
  }

  float rockNoise(vec2 point) {
    vec2 cell = floor(point);
    vec2 local = fract(point);
    local = local * local * (3.0 - 2.0 * local);
    float a = rockHash(cell);
    float b = rockHash(cell + vec2(1.0, 0.0));
    float c = rockHash(cell + vec2(0.0, 1.0));
    float d = rockHash(cell + vec2(1.0, 1.0));
    return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
  }

  vec3 rockPerturbNormal(
    vec3 surfacePosition,
    vec3 surfaceNormal,
    vec2 heightGradient
  ) {
    vec3 sigmaX = dFdx(surfacePosition);
    vec3 sigmaY = dFdy(surfacePosition);
    vec3 tangentX = cross(sigmaY, surfaceNormal);
    vec3 tangentY = cross(surfaceNormal, sigmaX);
    float determinant = dot(sigmaX, tangentX);
    vec3 gradient = sign(determinant) * (
      heightGradient.x * tangentX +
      heightGradient.y * tangentY
    );
    return normalize(
      abs(determinant) * surfaceNormal -
      gradient
    );
  }
`;

/**
 * Creates layered shore rock: large strata, small color breakup, a low wet
 * zone and moss restricted to upward-facing surfaces.
 */
export function createRockMaterial({
  baseColor,
  darkColor,
  wetColor = '#243637',
  mossColor = '#52634b',
  seed = 0,
  quality = 'high',
  waterHeight = { value: 0 },
}) {
  // Low quality avoids all procedural fragment noise and derivative work.
  if (quality === 'low') {
    return addTidalWetness(new THREE.MeshStandardMaterial({
      color: baseColor,
      roughness: 0.92,
      metalness: 0,
      flatShading: true,
      envMapIntensity: 0.45,
    }), waterHeight);
  }

  const uniforms = {
    uTidalWaterHeight: waterHeight,
    uRockSeed: { value: seed },
    uRockBaseColor: { value: new THREE.Color(baseColor) },
    uRockDarkColor: { value: new THREE.Color(darkColor) },
    uRockWetColor: { value: new THREE.Color(wetColor) },
    uRockMossColor: { value: new THREE.Color(mossColor) },
  };
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.9,
    metalness: 0.01,
    flatShading: false,
    envMapIntensity: 0.58,
  });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `${ROCK_VERTEX_HEADER}\n${shader.vertexShader}`.replace(
      '#include <project_vertex>',
      /* glsl */ `
        vec4 rockInstancePosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          rockInstancePosition = instanceMatrix * rockInstancePosition;
        #endif
        vRockWorldPosition = (modelMatrix * rockInstancePosition).xyz;
        #include <project_vertex>
      `,
    );
    shader.fragmentShader = `${TIDAL_WETNESS_GLSL}\n${ROCK_FRAGMENT_HEADER}\n${shader.fragmentShader}`
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
          #include <map_fragment>

          vec3 rockWorldNormal = normalize(cross(
            dFdx(vRockWorldPosition),
            dFdy(vRockWorldPosition)
          ));
          float rockTopMask = smoothstep(0.38, 0.86, abs(rockWorldNormal.y));
          float rockBroadNoise = rockNoise(
            vRockWorldPosition.xz * 0.34 + uRockSeed
          );
          float rockFineNoise = rockNoise(
            vRockWorldPosition.xz * 2.8 +
            vRockWorldPosition.y * 1.7 +
            uRockSeed * 2.3
          );
          float rockStrata =
            sin(
              vRockWorldPosition.y * 7.5 +
              rockBroadNoise * 5.0 +
              uRockSeed
            ) * 0.5 + 0.5;
          float rockWetMask = tidalWetness(vRockWorldPosition);
          float rockMossMask =
            rockTopMask *
            smoothstep(0.48, 0.76, rockNoise(
              vRockWorldPosition.xz * 0.72 + uRockSeed * 4.0
            )) *
            (1.0 - rockWetMask);

          vec3 rockColor = mix(
            uRockDarkColor,
            uRockBaseColor,
            rockBroadNoise * 0.72 + rockStrata * 0.28
          );
          rockColor *= 0.88 + rockFineNoise * 0.16;
          rockColor = mix(rockColor, uRockMossColor, rockMossMask * 0.48);
          rockColor = mix(rockColor, uRockWetColor, rockWetMask * 0.78);
          diffuseColor.rgb *= rockColor;
        `,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `
          #include <normal_fragment_maps>
          vec2 rockHeightGradient = vec2(
            dFdx(rockFineNoise),
            dFdy(rockFineNoise)
          ) * 0.07;
          normal = rockPerturbNormal(
            -vViewPosition,
            normal,
            rockHeightGradient
          );
        `,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `
          #include <roughnessmap_fragment>
          roughnessFactor = mix(0.94, 0.32, rockWetMask);
          roughnessFactor = mix(roughnessFactor, 0.98, rockMossMask);
          roughnessFactor += (rockFineNoise - 0.5) * 0.08;
        `,
      );
    material.userData.shader = shader;
    material.userData.tidalWetnessCompiled = true;
  };

  material.customProgramCacheKey = () => 'tideline-rock-v2-tidal';
  material.userData.tidalWetness = waterHeight;
  material.userData.uniforms = uniforms;
  return material;
}

const WOOD_VERTEX_HEADER = /* glsl */ `
  varying vec3 vWoodLocalPosition;
`;

const WOOD_FRAGMENT_HEADER = /* glsl */ `
  uniform float uWoodSeed;
  uniform float uPaintCoverage;
  uniform float uWoodRoughness;
  uniform vec3 uWoodBaseColor;
  uniform vec3 uWoodDarkColor;
  uniform vec3 uPaintColor;
  varying vec3 vWoodLocalPosition;

  float woodHash(vec2 point) {
    return fract(sin(dot(point, vec2(127.1, 347.7))) * 43758.5453);
  }

  float woodNoise(vec2 point) {
    vec2 cell = floor(point);
    vec2 local = fract(point);
    local = local * local * (3.0 - 2.0 * local);
    float a = woodHash(cell);
    float b = woodHash(cell + vec2(1.0, 0.0));
    float c = woodHash(cell + vec2(0.0, 1.0));
    float d = woodHash(cell + vec2(1.0, 1.0));
    return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
  }
`;

/**
 * Produces local-space wood grain and optional chipped paint while preserving
 * Three.js lighting, shadows and environment reflections.
 */
export function createWoodMaterial({
  baseColor,
  darkColor,
  paintColor = baseColor,
  paintCoverage = 0,
  roughness = 0.82,
  quality = 'high',
  side = THREE.FrontSide,
  grainAxis = 'y',
}) {
  // Mobile receives one representative baked color instead of procedural
  // rings, scratches and a physical clearcoat lobe.
  if (quality === 'low') {
    const fallbackColor = new THREE.Color(baseColor).lerp(
      new THREE.Color(paintColor),
      paintCoverage * 0.82,
    );
    return new THREE.MeshStandardMaterial({
      color: fallbackColor,
      roughness: Math.max(roughness, 0.72),
      metalness: 0,
      envMapIntensity: 0.42,
      side,
    });
  }

  const usePaintClearcoat = quality === 'high' && paintCoverage > 0.2;
  const uniforms = {
    uWoodSeed: { value: 2.71 + paintCoverage * 7.3 },
    uPaintCoverage: { value: paintCoverage },
    uWoodRoughness: { value: roughness },
    uWoodBaseColor: { value: new THREE.Color(baseColor) },
    uWoodDarkColor: { value: new THREE.Color(darkColor) },
    uPaintColor: { value: new THREE.Color(paintColor) },
  };
  const parameters = {
    color: 0xffffff,
    roughness,
    metalness: 0,
    envMapIntensity: 0.55,
    side,
  };
  const material = usePaintClearcoat
    ? new THREE.MeshPhysicalMaterial({
        ...parameters,
        clearcoat: 0.22,
        clearcoatRoughness: 0.4,
        specularIntensity: 0.62,
      })
    : new THREE.MeshStandardMaterial(parameters);

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `${WOOD_VERTEX_HEADER}\n${shader.vertexShader}`.replace(
      '#include <project_vertex>',
      /* glsl */ `
        vWoodLocalPosition = ${grainAxis === 'x' ? 'position.zxy' : 'position'};
        #include <project_vertex>
      `,
    );
    shader.fragmentShader = `${WOOD_FRAGMENT_HEADER}\n${shader.fragmentShader}`
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
          #include <map_fragment>

          float woodWarp = woodNoise(
            vWoodLocalPosition.xy * vec2(0.9, 2.7) + uWoodSeed
          );
          float woodRings =
            sin(
              vWoodLocalPosition.x * 11.0 +
              vWoodLocalPosition.y * 2.2 +
              woodWarp * 5.0
            ) * 0.5 + 0.5;
          float woodFiber = woodNoise(
            vec2(
              vWoodLocalPosition.x * 4.2 + uWoodSeed,
              vWoodLocalPosition.y * 19.0
            )
          );
          float woodTone = clamp(
            0.44 +
            (woodRings - 0.5) * 0.2 +
            (woodFiber - 0.5) * 0.16,
            0.12,
            0.86
          );
          vec3 rawWoodColor = mix(
            uWoodDarkColor,
            uWoodBaseColor,
            woodTone
          );
          float woodWearNoise = woodNoise(
            vWoodLocalPosition.xz * 9.8 +
            vWoodLocalPosition.y * 3.2 +
            uWoodSeed * 3.0
          );
          float woodPaintMask = smoothstep(
            1.0 - uPaintCoverage,
            1.18 - uPaintCoverage,
            woodWearNoise
          );
          float woodScratch =
            smoothstep(0.96, 1.0, sin(
              vWoodLocalPosition.y * 34.0 +
              woodWarp * 7.0
            ) * 0.5 + 0.5) *
            woodPaintMask *
            0.07;
          vec3 woodSurfaceColor = mix(
            rawWoodColor,
            uPaintColor,
            woodPaintMask
          );
          woodSurfaceColor = mix(
            woodSurfaceColor,
            rawWoodColor,
            woodScratch
          );
          diffuseColor.rgb *= woodSurfaceColor;
        `,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `
          #include <roughnessmap_fragment>
          roughnessFactor = mix(
            uWoodRoughness,
            0.62,
            woodPaintMask
          );
          roughnessFactor += (woodFiber - 0.5) * 0.1;
          roughnessFactor = mix(
            roughnessFactor,
            uWoodRoughness,
            woodScratch
          );
        `,
      );

    if (usePaintClearcoat) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <lights_physical_fragment>',
        /* glsl */ `
          #include <lights_physical_fragment>
          material.clearcoat *= woodPaintMask;
          material.clearcoatRoughness = mix(
            0.48,
            0.4,
            woodPaintMask
          );
        `,
      );
    }

    material.userData.shader = shader;
  };

  material.customProgramCacheKey = () =>
    `tideline-wood-v3-${usePaintClearcoat ? 'physical' : 'standard'}-${grainAxis}`;
  material.userData.uniforms = uniforms;
  return material;
}

/**
 * Uses vertex colors for root-to-tip variation and a small back-face emission
 * term to approximate thin-leaf light transmission without subsurface shading.
 */
export function createFoliageMaterial({ quality = 'high' } = {}) {
  const parameters = {
    color: 0xffffff,
    roughness: 0.76,
    metalness: 0,
    envMapIntensity: 0.42,
    vertexColors: true,
    side: THREE.DoubleSide,
  };
  const material =
    quality === 'high'
      ? new THREE.MeshPhysicalMaterial({
          ...parameters,
          sheen: 0.22,
          sheenColor: new THREE.Color('#6e9b68'),
          sheenRoughness: 0.82,
        })
      : new THREE.MeshStandardMaterial(parameters);

  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      /* glsl */ `
        #include <emissivemap_fragment>
        totalEmissiveRadiance +=
          diffuseColor.rgb *
          (gl_FrontFacing ? 0.018 : 0.09);
      `,
    );
  };
  material.customProgramCacheKey = () =>
    `tideline-foliage-v1-${quality}`;
  return material;
}

/**
 * Keeps hundreds of dune-grass clusters in one InstancedMesh while bending
 * only their tips in the vertex shader. Instance translation seeds each patch,
 * avoiding the synchronized motion that makes procedural vegetation look fake.
 */
export function createDuneGrassMaterial({ quality = 'high' } = {}) {
  const uniforms = {
    uGrassTime: { value: 0 },
    uWindStrength: { value: quality === 'high' ? 1 : 0.62 },
    uGrassDaylight: { value: 1 },
  };
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.92,
    metalness: 0,
    envMapIntensity: 0.34,
    vertexColors: true,
    side: THREE.DoubleSide,
  });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = /* glsl */ `
      uniform float uGrassTime;
      uniform float uWindStrength;
      ${shader.vertexShader}
    `.replace(
      '#include <begin_vertex>',
      /* glsl */ `
        #include <begin_vertex>
        float grassPhase = 0.0;
        #ifdef USE_INSTANCING
          grassPhase = instanceMatrix[3].x * 0.27 + instanceMatrix[3].z * 0.19;
        #endif
        float grassTip = smoothstep(0.08, 1.0, position.y);
        grassTip *= grassTip;
        float grassGust =
          sin(uGrassTime * 0.92 + grassPhase) * 0.7 +
          sin(uGrassTime * 1.73 + grassPhase * 1.81) * 0.3;
        transformed.x += grassGust * grassTip * 0.075 * uWindStrength;
        transformed.z +=
          cos(uGrassTime * 0.73 + grassPhase * 1.37) *
          grassTip *
          0.035 *
          uWindStrength;
      `,
    );
    shader.fragmentShader = /* glsl */ `
      uniform float uGrassDaylight;
      ${shader.fragmentShader}
    `.replace(
      '#include <emissivemap_fragment>',
      /* glsl */ `
        #include <emissivemap_fragment>
        totalEmissiveRadiance +=
          diffuseColor.rgb * mix(0.012, gl_FrontFacing ? 0.028 : 0.11, uGrassDaylight);
      `,
    );
    material.userData.shader = shader;
  };

  material.customProgramCacheKey = () => `tideline-dune-grass-v2-${quality}`;
  material.userData.uniforms = uniforms;
  return material;
}

/**
 * A complete custom shader for crest, lacy wash and receding foam. Unlike the
 * patched PBR materials above, this material owns its entire lighting result.
 */
export function createFoamMaterial() {
  const uniforms = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    uTime: { value: 0 },
    uWavePhase: { value: 0 },
    uStrength: { value: 0.85 },
    uWaterHeight: { value: 0 },
    uColor: { value: new THREE.Color('#eaf9f3') },
    uTint: { value: new THREE.Color('#9edbd3') },
  };

  const material = new THREE.ShaderMaterial({
    name: 'TidelineFoamMaterial',
    uniforms,
    transparent: true,
    depthWrite: false,
    fog: true,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uWaterHeight;
      varying vec2 vUv;
      varying vec3 vFoamWorld;
      varying float vGroundHeight;
      #include <fog_pars_vertex>

      void main() {
        vUv = uv;
        vec3 displaced = position;
        vGroundHeight = position.z - 0.025;
        displaced.z = max(position.z, uWaterHeight + 0.025);
        vFoamWorld = (modelMatrix * vec4(displaced, 1.0)).xyz;
        vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uWavePhase;
      uniform float uStrength;
      uniform float uWaterHeight;
      uniform vec3 uColor;
      uniform vec3 uTint;
      varying vec2 vUv;
      varying vec3 vFoamWorld;
      varying float vGroundHeight;
      #include <fog_pars_fragment>

      float hash(vec2 point) {
        return fract(sin(dot(point, vec2(41.13, 289.47))) * 43758.5453);
      }

      float noise(vec2 point) {
        vec2 cell = floor(point);
        vec2 local = fract(point);
        local = local * local * (3.0 - 2.0 * local);

        float a = hash(cell);
        float b = hash(cell + vec2(1.0, 0.0));
        float c = hash(cell + vec2(0.0, 1.0));
        float d = hash(cell + vec2(1.0, 1.0));
        return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
      }

      float fbm(vec2 point) {
        float value = 0.0;
        float amplitude = 0.5;
        for (int i = 0; i < 4; i++) {
          value += noise(point) * amplitude;
          point = point * 2.03 + vec2(17.1, 9.2);
          amplitude *= 0.5;
        }
        return value;
      }

      float foamLace(vec2 point) {
        vec2 cell = floor(point), local = fract(point);
        float first = 8.0, second = 8.0;
        for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
          vec2 offset = vec2(float(x), float(y));
          vec2 site = offset + 0.2 + 0.6 * vec2(hash(cell + offset), hash(cell + offset + 23.7)) - local;
          float d = dot(site, site);
          second = min(second, max(first, d)); first = min(first, d);
        }
        float edge = sqrt(second) - sqrt(first);
        float aa = max(fwidth(edge), 0.018);
        return 1.0 - smoothstep(0.03, 0.08 + aa, edge);
      }

      void main() {
        vec2 p = vFoamWorld.xz;
        float coastNoise = fbm(vec2(p.x * 0.085, 3.7));
        float phase = fract(uWavePhase * 0.11 + coastNoise * 0.14);
        float advance = smoothstep(0.0, 0.57, phase);
        float retreat = smoothstep(0.57, 1.0, phase);
        float frontDepth = mix(0.26, -0.035, advance) + retreat * 0.295;
        float pulse = smoothstep(0.0, 0.12, phase) * (1.0 - smoothstep(0.86, 1.0, phase));
        vec2 flow = vec2(uWavePhase * 0.035, -uWavePhase * 0.10);
        vec2 warped = p + vec2(fbm(p * 0.24), fbm(p.yx * 0.21 + 12.0)) * 0.65;
        float patchNoise = fbm(warped * 1.15 + flow);
        float lace = foamLace(warped * 6.2 + flow);
        lace *= smoothstep(0.36, 0.66, fbm(warped * 2.8 + flow * 0.7));
        float waterDepth = uWaterHeight - vGroundHeight;
        float distance = waterDepth - frontDepth - (patchNoise - 0.5) * 0.028;
        float aa = max(fwidth(distance), 0.002);
        float crest = 1.0 - smoothstep(0.004, 0.018 + aa, abs(distance));
        float wash = smoothstep(-aa, 0.018 + aa, distance) * (1.0 - smoothstep(0.055, 0.16, distance));
        float breakup = smoothstep(0.26, 0.69, patchNoise);
        float opacity = crest * (0.12 + breakup * 0.62) * (1.0 - retreat * 0.55)
          + wash * (0.008 + lace * 0.24) * breakup * (1.0 - retreat * 0.35);
        float widthFade = smoothstep(0.0, 0.025, vUv.x) * smoothstep(0.0, 0.025, 1.0 - vUv.x);
        float depthFade = smoothstep(-0.07, -0.035, waterDepth) * (1.0 - smoothstep(0.38, 0.55, waterDepth));
        float alpha = opacity * pulse * widthFade * depthFade * uStrength * (1.0 - smoothstep(28.0, 35.0, p.y));
        vec3 color = mix(uTint, uColor, 0.78 + patchNoise * 0.22);
        gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.78));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });

  material.userData.uniforms = uniforms;
  return material;
}

/**
 * Offline-style fallback generated once at startup when the supplied local
 * water normal cannot load. The pattern tiles by construction.
 */
export function createProceduralWaterNormal(size = 256) {
  const data = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x / size) * Math.PI * 2;
      const v = (y / size) * Math.PI * 2;
      const dx =
        Math.cos(u * 3 + v) * 0.42 +
        Math.cos(u * 7 - v * 2) * 0.22 +
        Math.cos(u * 13 + v * 5) * 0.08;
      const dy =
        Math.sin(v * 4 - u) * 0.4 +
        Math.sin(v * 9 + u * 3) * 0.2 +
        Math.sin(v * 15 - u * 6) * 0.08;
      const normalX = -dx;
      const normalY = 1.4;
      const normalZ = -dy;
      const inverseLength = 1 / Math.hypot(normalX, normalY, normalZ);
      const index = (y * size + x) * 4;
      data[index] = Math.round((normalX * inverseLength * 0.5 + 0.5) * 255);
      data[index + 1] = Math.round((normalZ * inverseLength * 0.5 + 0.5) * 255);
      data[index + 2] = Math.round((normalY * inverseLength * 0.5 + 0.5) * 255);
      data[index + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

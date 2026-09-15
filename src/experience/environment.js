import * as THREE from 'three';
import { CoastalClock } from './CoastalClock.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { Water } from 'three/addons/objects/Water.js';
import { createOceanGeometry, OceanRefraction } from './OceanWater.js';
import {
  DEFAULT_OCEAN_SWELL_STRENGTH,
  OCEAN_SWELL_FADE_END_Z,
  OCEAN_SWELL_FADE_START_Z,
} from './OceanSwell.js';
import { CoastalWind } from './CoastalWind.js';
import {
  getCloudQualityProfile,
  getCloudSphereTriangleCount,
} from './CloudQuality.js';
import {
  getWaterReflectionPixelCount,
  getWaterReflectionProfile,
} from './WaterReflectionQuality.js';
import {
  getWaterNormalPixelCount,
  getWaterNormalProfile,
} from './WaterNormalQuality.js';
import { createProceduralWaterNormal } from './shaders.js';
import {
  getMoonCraterCount,
  getMoonPixelCount,
  getMoonQualityProfile,
  getMoonTriangleCount,
  getMoonVertexCount,
} from './MoonQuality.js';
import {
  getStarPositionByteCount,
  getStarPositionFloatCount,
  getStarQualityProfile,
} from './StarQuality.js';
import {
  CELESTIAL_GLOW_TEXTURE_SIZE,
  getCelestialResourceProfile,
} from './CelestialResources.js';
import { hasVisibleAtmosphereContribution } from './AtmosphereVisibility.js';

function getTextureImageSize(texture) {
  const image = texture?.image;
  return {
    width: Number(image?.naturalWidth ?? image?.videoWidth ?? image?.width) || 0,
    height: Number(image?.naturalHeight ?? image?.videoHeight ?? image?.height) || 0,
  };
}

function createCoastalSky(skyTexture) {
  const sky = new Sky();
  sky.material.uniforms.uCoastalDaylight = { value: 1 };
  sky.material.fragmentShader = `uniform float uCoastalDaylight;\n${sky.material.fragmentShader}`.replace(
    'gl_FragColor = vec4( retColor, 1.0 );',
    `retColor *= mix(vec3(1.0), vec3(0.55, 0.82, 1.0), uCoastalDaylight);
     gl_FragColor = vec4(retColor, 1.0);`,
  );
  sky.material.uniforms.uSkyBlend = { value: 0 };
  sky.material.uniforms.uSkyYaw = { value: 0 };
  if (skyTexture) {
    sky.material.uniforms.uSkyMap = { value: skyTexture };
    sky.material.fragmentShader = `uniform sampler2D uSkyMap; uniform float uSkyBlend; uniform float uSkyYaw;\n${sky.material.fragmentShader}`.replace(
      'gl_FragColor = vec4(retColor, 1.0);', `
        vec3 skyRay = normalize(vWorldPosition);
        vec2 skyUv = vec2(atan(skyRay.z, skyRay.x) * 0.159154943 + 0.5 + uSkyYaw * 0.159154943,
          asin(clamp(skyRay.y, -1.0, 1.0)) * 0.318309886 + 0.5);
        vec3 capturedSky = min(texture2D(uSkyMap, skyUv).rgb, vec3(24.0));
        retColor = mix(retColor, capturedSky, uSkyBlend);
        gl_FragColor = vec4(retColor, 1.0);
      `,
    );
  }
  sky.material.fog = true;
  Object.assign(sky.material.uniforms, THREE.UniformsUtils.clone(THREE.UniformsLib.fog));
  // Match built-in fog after output conversion, including below the horizon.
  // Otherwise the camera's far clip replaces fogged ground with unrelated sky.
  sky.material.fragmentShader = `#ifdef USE_FOG\nuniform vec3 fogColor;\n#endif\n${sky.material.fragmentShader}`.replace(
    '#include <colorspace_fragment>',
    `#include <colorspace_fragment>
     #ifdef USE_FOG
     float coastElevation = normalize(vWorldPosition - cameraPosition).y;
     float coastHaze = 1.0 - smoothstep(0.0, 0.12, coastElevation);
     gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, coastHaze);
     #endif`,
  );
  return sky;
}

// Every time preset interpolates the same scalar/color schema. Keeping the
// presets data-only makes it straightforward to add another time of day.
const PRESETS = {
  dawn: {
    elevation: 7.5,
    azimuth: 108,
    turbidity: 6.8,
    rayleigh: 2.35,
    mieCoefficient: 0.0105,
    mieDirectionalG: 0.86,
    exposure: 0.58,
    sunIntensity: 1.85,
    sunColor: '#ffc795',
    hemiIntensity: 0.74,
    hemiSky: '#9fb8c2',
    hemiGround: '#786b63',
    ambientIntensity: 0.1,
    fogColor: '#a9bcc0',
    fogDensity: 0.0034,
    waterColor: '#0c5360',
    waterHorizon: '#78969b',
    waterDeep: '#04313b',
    reflectionStrength: 0.8,
    sunGlintStrength: 0.64,
    distortion: 2.5,
    cloudOpacity: 0.38,
    night: 0.02,
    daylight: 0.72,
    cloudLight: '#f2d9c2',
    cloudShadow: '#637278',
    drySand: '#cbb083',
    wetSand: '#66584f',
    foam: '#f1ebe1',
    foamTint: '#95b8b2',
  },
  day: {
    elevation: 48,
    azimuth: 205,
    turbidity: 1.8,
    rayleigh: 1.65,
    mieCoefficient: 0.002,
    mieDirectionalG: 0.78,
    exposure: 0.72,
    sunIntensity: 2.55,
    sunColor: '#fff6e6',
    hemiIntensity: 0.88,
    hemiSky: '#bdd9e3',
    hemiGround: '#928977',
    ambientIntensity: 0.06,
    fogColor: '#a0c9d3',
    fogDensity: 0.00108,
    waterColor: '#187c89',
    waterHorizon: '#548eaa',
    waterDeep: '#0b4b61',
    reflectionStrength: 0.90,
    sunGlintStrength: 1.15,
    distortion: 2.65,
    cloudOpacity: 0.24,
    night: 0,
    daylight: 1,
    cloudLight: '#f3f5f2',
    cloudShadow: '#607781',
    drySand: '#d2bc96',
    wetSand: '#7d7667',
    foam: '#f3faf4',
    foamTint: '#86c6bf',
  },
  sunset: {
    elevation: 4.8,
    azimuth: 236,
    turbidity: 7.8,
    rayleigh: 1.12,
    mieCoefficient: 0.009,
    mieDirectionalG: 0.87,
    exposure: 0.58,
    sunIntensity: 2.2,
    sunColor: '#ffb178',
    hemiIntensity: 0.78,
    hemiSky: '#8297aa',
    hemiGround: '#665950',
    ambientIntensity: 0.08,
    fogColor: '#947e7a',
    fogDensity: 0.00235,
    waterColor: '#123f4a',
    waterHorizon: '#8c7775',
    waterDeep: '#082a35',
    reflectionStrength: 0.86,
    sunGlintStrength: 0.78,
    distortion: 2.45,
    cloudOpacity: 0.52,
    night: 0.1,
    daylight: 0.58,
    cloudLight: '#f4c8a7',
    cloudShadow: '#526271',
    drySand: '#c39d75',
    wetSand: '#66504a',
    foam: '#f3ddca',
    foamTint: '#b87d6e',
  },
  night: {
    elevation: -7.5,
    azimuth: 38,
    turbidity: 3,
    rayleigh: 0.34,
    mieCoefficient: 0.002,
    mieDirectionalG: 0.7,
    exposure: 0.76,
    sunIntensity: 0.9,
    sunColor: '#b6ceff',
    hemiIntensity: 0.72,
    hemiSky: '#273d59',
    hemiGround: '#253638',
    ambientIntensity: 0.16,
    fogColor: '#112832',
    fogDensity: 0.0022,
    waterColor: '#041d2a',
    waterHorizon: '#243d4a',
    waterDeep: '#010c14',
    reflectionStrength: 0.54,
    sunGlintStrength: 0.18,
    distortion: 2.15,
    cloudOpacity: 0.24,
    night: 1,
    daylight: 0.18,
    cloudLight: '#516b82',
    cloudShadow: '#172938',
    drySand: '#65717a',
    wetSand: '#2b3b3f',
    foam: '#cbdde3',
    foamTint: '#668b99',
  },
};

// Weather is layered over time-of-day presets. The clear profile is entirely
// neutral, so the authored default scene and every existing time preset keep
// their original appearance until the user selects another atmosphere.
const WEATHER_PRESETS = {
  clear: {
    coverage: 0,
    sunScale: 1,
    hemiScale: 1,
    ambientScale: 1,
    fogScale: 1,
    exposureScale: 1,
    reflectionScale: 1,
    glintScale: 1,
    turbidityBoost: 0,
    cloudColorBlend: 0,
    cloudLight: '#ffffff',
    cloudShadow: '#ffffff',
  },
  cloudy: {
    coverage: 0.34,
    sunScale: 0.78,
    hemiScale: 1.05,
    ambientScale: 1.12,
    fogScale: 1.28,
    exposureScale: 0.96,
    reflectionScale: 0.9,
    glintScale: 0.58,
    turbidityBoost: 1.1,
    cloudColorBlend: 0.3,
    cloudLight: '#d9e1e1',
    cloudShadow: '#4b5d62',
  },
  overcast: {
    coverage: 0.69,
    sunScale: 0.42,
    hemiScale: 0.92,
    ambientScale: 1.3,
    fogScale: 1.75,
    exposureScale: 0.88,
    reflectionScale: 0.76,
    glintScale: 0.22,
    turbidityBoost: 2.4,
    cloudColorBlend: 0.68,
    cloudLight: '#c3ced0',
    cloudShadow: '#34464b',
  },
};

const WEATHER_SCALAR_KEYS = [
  'coverage',
  'sunScale',
  'hemiScale',
  'ambientScale',
  'fogScale',
  'exposureScale',
  'reflectionScale',
  'glintScale',
  'turbidityBoost',
  'cloudColorBlend',
];

function createWeatherState(preset) {
  const state = {};
  WEATHER_SCALAR_KEYS.forEach((key) => {
    state[key] = preset[key];
  });
  state.cloudLight = new THREE.Color(preset.cloudLight);
  state.cloudShadow = new THREE.Color(preset.cloudShadow);
  return state;
}

const TIDE_LEVELS = Object.freeze({
  low: -1,
  high: 1,
});
const AUTO_TIDE_CYCLE_SECONDS = 180;
const BASE_SHORELINE_Z = 5.5;
const BASE_WATER_HEIGHT = 0;
const TIDE_SHORE_TRAVEL = 3.2;
const TIDE_WATER_TRAVEL = 0.16;

const SCALAR_KEYS = [
  'elevation',
  'azimuth',
  'turbidity',
  'rayleigh',
  'mieCoefficient',
  'mieDirectionalG',
  'exposure',
  'sunIntensity',
  'hemiIntensity',
  'ambientIntensity',
  'fogDensity',
  'reflectionStrength',
  'sunGlintStrength',
  'distortion',
  'cloudOpacity',
  'night',
  'daylight',
];

const COLOR_KEYS = [
  'sunColor',
  'hemiSky',
  'hemiGround',
  'fogColor',
  'waterColor',
  'waterHorizon',
  'waterDeep',
  'cloudLight',
  'cloudShadow',
  'drySand',
  'wetSand',
  'foam',
  'foamTint',
];

// Runtime state stores Color objects so transitions can lerp without creating
// garbage every frame.
function createState(preset) {
  const state = {};
  SCALAR_KEYS.forEach((key) => {
    state[key] = preset[key];
  });
  COLOR_KEYS.forEach((key) => {
    state[key] = new THREE.Color(preset[key]);
  });
  return state;
}

function seededValue(index) {
  return Math.abs(Math.sin(index * 78.233 + 12.9898) * 43758.5453) % 1;
}

function hashGrid(x, y) {
  let value = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function periodicValueNoise(x, y, periodX, periodY) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = (x0 + 1) % periodX;
  const y1 = (y0 + 1) % periodY;
  const wrappedX0 = ((x0 % periodX) + periodX) % periodX;
  const wrappedY0 = ((y0 % periodY) + periodY) % periodY;
  const fractionX = x - x0;
  const fractionY = y - y0;
  const blendX = fractionX * fractionX * (3 - 2 * fractionX);
  const blendY = fractionY * fractionY * (3 - 2 * fractionY);
  const top = THREE.MathUtils.lerp(
    hashGrid(wrappedX0, wrappedY0),
    hashGrid(x1, wrappedY0),
    blendX,
  );
  const bottom = THREE.MathUtils.lerp(
    hashGrid(wrappedX0, y1),
    hashGrid(x1, y1),
    blendX,
  );
  return THREE.MathUtils.lerp(top, bottom, blendY);
}

/**
 * Generates one tileable density map at startup. The cloud shader can then
 * animate multiscale density samples instead of evaluating FBM for every pixel.
 */
function createCloudTexture(quality) {
  const profile = getCloudQualityProfile(quality);
  const width = profile.textureWidth;
  const height = profile.textureHeight;
  const octaveCount = profile.octaveCount;
  const pixels = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let amplitude = 1;
      let amplitudeTotal = 0;
      let density = 0;

      for (let octave = 0; octave < octaveCount; octave += 1) {
        const cellsY = 3 * 2 ** octave;
        const cellsX = cellsY * 2;
        density +=
          periodicValueNoise(
            (x / width) * cellsX,
            (y / height) * cellsY,
            cellsX,
            cellsY,
          ) * amplitude;
        amplitudeTotal += amplitude;
        amplitude *= 0.53;
      }

      const shapedDensity = THREE.MathUtils.clamp(
        (density / amplitudeTotal - 0.18) * 1.8,
        0,
        1,
      );
      const value = Math.round(shapedDensity * 255);
      const offset = (y * width + x) * 4;
      pixels[offset] = value;
      pixels[offset + 1] = value;
      pixels[offset + 2] = value;
      pixels[offset + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(
    pixels,
    width,
    height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.name = `ProceduralCloudDensity-${profile.quality}`;
  texture.userData.cloudQuality = profile.quality;
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function createCloudLayer(quality) {
  const profile = getCloudQualityProfile(quality);
  const cloudTexture = createCloudTexture(quality);
  const material = new THREE.ShaderMaterial({
    name: 'LayeredCloudShader',
    uniforms: {
      uCloudMap: { value: cloudTexture },
      uTime: { value: 0 },
      uEvolution: { value: 0 },
      uCoverage: { value: 0 },
      uOpacity: { value: 0.3 },
      uLightColor: { value: new THREE.Color(PRESETS.day.cloudLight) },
      uShadowColor: { value: new THREE.Color(PRESETS.day.cloudShadow) },
      uSunDirection: { value: new THREE.Vector3(0.4, 0.8, 0.2).normalize() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vCloudDirection;

      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vCloudDirection = normalize(worldPosition.xyz - cameraPosition);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uCloudMap;
      uniform float uTime;
      uniform float uEvolution;
      uniform float uCoverage;
      uniform float uOpacity;
      uniform vec3 uLightColor;
      uniform vec3 uShadowColor;
      uniform vec3 uSunDirection;

      varying vec3 vCloudDirection;

      void main() {
        vec3 direction = normalize(vCloudDirection);
        float projectionDepth = max(direction.y + 0.26, 0.24);
        vec2 projectedUv = direction.xz / projectionDepth;
        vec2 broadDrift = vec2(uTime * 0.0038, uTime * 0.0008);
        vec2 detailDrift = vec2(-uTime * 0.0029, uTime * 0.0012);
        float broad = texture2D(
          uCloudMap,
          projectedUv * 0.2 + broadDrift
        ).r;
        float evolving = texture2D(uCloudMap, projectedUv * .12 + vec2(uEvolution * .0017, -uEvolution * .0013)).r;
        float detail = texture2D(
          uCloudMap,
          projectedUv * 0.51 + detailDrift + vec2(evolving * .14)
        ).r;
        float fine = texture2D(uCloudMap, projectedUv * 2.7 + detailDrift * 1.3).r;
        float field = broad * .64 + detail * .25 + evolving * .05 + fine * .06;
        float threshold = mix(.56, .39, uCoverage);
        float density = smoothstep(threshold, threshold + .075, field);
        float litSample = texture2D(uCloudMap, projectedUv * .2 + broadDrift + normalize(uSunDirection.xz + vec2(.001)) * .018).r;
        float edgeLight = clamp((broad - litSample) * 5.5 + .52, .16, 1.0);

        float horizonFade = smoothstep(0.015, 0.16, direction.y);
        float zenithFade = 1.0;
        float sunFacing = pow(
          max(dot(direction, normalize(uSunDirection)), 0.0),
          10.0
        );
        vec3 cloudColor = mix(
          uShadowColor,
          uLightColor,
          .69 + edgeLight * .24 + (1.0 - density) * .06
        );
        cloudColor += uLightColor * sunFacing * 0.22;

        float alpha = (1.0 - exp(-density * 2.6)) * uOpacity * horizonFade * zenithFade;
        if (alpha < 0.008) discard;
        gl_FragColor = vec4(cloudColor, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    fog: false,
    toneMapped: true,
  });

  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(
      365,
      profile.widthSegments,
      profile.heightSegments,
    ),
    material,
  );
  clouds.name = 'ProceduralCloudDome';
  clouds.userData.cloudQuality = profile.quality;
  clouds.frustumCulled = false;
  clouds.renderOrder = -2;
  return clouds;
}

function createMoonTexture(size) {
  // A deterministic canvas texture gives the moon readable surface breakup
  // without adding an external image request.
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  const baseGradient = context.createRadialGradient(
    size * 0.36,
    size * 0.32,
    size * 0.05,
    size * 0.5,
    size * 0.5,
    size * 0.72,
  );
  baseGradient.addColorStop(0, '#f2f4f7');
  baseGradient.addColorStop(0.56, '#d8dde4');
  baseGradient.addColorStop(1, '#9da5b0');
  context.fillStyle = baseGradient;
  context.fillRect(0, 0, size, size);

  const craterCount = Math.round(size * 0.18);
  for (let index = 0; index < craterCount; index += 1) {
    const x = seededValue(index * 3 + 11) * size;
    const y = seededValue(index * 3 + 12) * size;
    const radius = (0.012 + seededValue(index * 3 + 13) * 0.055) * size;
    const crater = context.createRadialGradient(
      x - radius * 0.24,
      y - radius * 0.2,
      radius * 0.08,
      x,
      y,
      radius,
    );
    crater.addColorStop(0, 'rgba(248, 250, 252, 0.35)');
    crater.addColorStop(0.42, 'rgba(111, 119, 130, 0.28)');
    crater.addColorStop(1, 'rgba(111, 119, 130, 0)');
    context.fillStyle = crater;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createGlowTexture(size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.72)');
  gradient.addColorStop(0.24, 'rgba(255, 255, 255, 0.2)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createStarGeometry(quality) {
  // Stars are one Points draw call; seeded positions keep regression images
  // stable while the group itself rotates very slowly.
  const profile = getStarQualityProfile(quality);
  const count = profile.count;
  const positions = new Float32Array(count * 3);

  for (let index = 0; index < count; index += 1) {
    const theta = seededValue(index * 2) * Math.PI * 2;
    const elevation = 0.08 + seededValue(index * 2 + 1) * Math.PI * 0.42;
    const radius = 285 + seededValue(index * 3 + 7) * 45;
    positions[index * 3] = Math.cos(theta) * Math.cos(elevation) * radius;
    positions[index * 3 + 1] = Math.sin(elevation) * radius;
    positions[index * 3 + 2] = Math.sin(theta) * Math.cos(elevation) * radius;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.userData.starQuality = profile.quality;
  return geometry;
}

function createStarShell() {
  const material = new THREE.PointsMaterial({
    color: 0xdce8ff,
    size: 0.72,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
  });
  const stars = new THREE.Points(new THREE.BufferGeometry(), material);
  stars.name = 'CelestialStars';
  stars.frustumCulled = false;
  stars.renderOrder = -3;
  return stars;
}

/**
 * Coordinates every atmosphere-dependent system from one interpolated state:
 * Sky, PMREM reflections, Water, fog, lights, stars, moon and world materials.
 */
export class BeachEnvironment {
  constructor({ scene, renderer, camera, waterNormals, skyTexture = null, world, quality }) {
    this.scene = scene;
    this.renderer = renderer;
    this.camera = camera;
    this.world = world;
    this.quality = quality;
    this.waterNormalSource = waterNormals;
    this.skyTexture = skyTexture;
    const waterNormalProfile = getWaterNormalProfile(quality);
    this.waterNormalQuality = waterNormalProfile.quality;
    this.waterNormalRevision = 1;
    this.waterNormalReplacements = 0;
    this.disposedWaterNormals = 0;
    this.waterNormals = this.createWaterNormalTexture(waterNormalProfile.quality);
    this.waveSpeed = 0.55;
    this.oceanSwellStrength = DEFAULT_OCEAN_SWELL_STRENGTH;
    this.wind = new CoastalWind();
    this.dayClock = new CoastalClock();
    this.cloudElapsed = 0;
    this.environmentElapsed = 0;
    this.dayStates = Object.fromEntries(Object.entries(PRESETS).map(([key, value]) => [key, createState(value)]));
    this.tideMode = 'auto';
    this.tideLevel = 0;
    this.tideElapsed = 0;
    this.current = createState(PRESETS.day);
    this.target = createState(PRESETS.day);
    this.currentPreset = 'day';
    this.currentWeather = 'clear';
    this.weatherCurrent = createWeatherState(WEATHER_PRESETS.clear);
    this.weatherTarget = createWeatherState(WEATHER_PRESETS.clear);
    this.weatherCloudLight = new THREE.Color();
    this.weatherCloudShadow = new THREE.Color();
    this.sun = new THREE.Vector3();
    this.moonDirection = new THREE.Vector3();
    this.lightDirection = new THREE.Vector3();
    this.environmentRenderTarget = null;
    this.refreshTimer = 0;
    this.disposed = false;

    this.scene.fog = new THREE.FogExp2(
      this.current.fogColor,
      this.current.fogDensity,
    );

    this.ambientLight = new THREE.AmbientLight(
      0xffffff,
      this.current.ambientIntensity,
    );
    this.scene.add(this.ambientLight);

    this.hemisphereLight = new THREE.HemisphereLight(
      this.current.hemiSky,
      this.current.hemiGround,
      this.current.hemiIntensity,
    );
    this.scene.add(this.hemisphereLight);

    this.sunLight = new THREE.DirectionalLight(
      this.current.sunColor,
      this.current.sunIntensity,
    );
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(
      quality === 'high' ? 2048 : 1024,
      quality === 'high' ? 2048 : 1024,
    );
    this.sunLight.shadow.camera.left = -48;
    this.sunLight.shadow.camera.right = 48;
    this.sunLight.shadow.camera.top = 46;
    this.sunLight.shadow.camera.bottom = -30;
    this.sunLight.shadow.camera.near = 1;
    this.sunLight.shadow.camera.far = 170;
    this.sunLight.shadow.bias = -0.00025;
    this.sunLight.shadow.normalBias = 0.035;
    this.sunLight.shadow.radius = quality === 'high' ? 3.2 : 2.2;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);
    this.sunLight.target.position.set(0, 0, 18);

    this.sky = createCoastalSky(skyTexture);
    this.sky.name = 'AtmosphericSky';
    this.sky.scale.setScalar(420);
    this.scene.add(this.sky);

    this.clouds = createCloudLayer(quality);
    this.cloudRevision = 1;
    this.cloudReplacements = 0;
    this.disposedCloudLayers = 0;
    this.scene.add(this.clouds);

    this.environmentScene = new THREE.Scene();
    this.environmentSky = createCoastalSky(skyTexture);
    this.environmentSky.scale.setScalar(420);
    this.environmentScene.add(this.environmentSky);
    this.pmremGenerator = new THREE.PMREMGenerator(renderer);

    const reflectionProfile = getWaterReflectionProfile(quality);
    const reflectionSize = reflectionProfile.size;
    this.waterReflectionTarget = null;
    this.waterReflectionQuality = reflectionProfile.quality;
    this.waterReflectionSize = reflectionSize;
    this.waterReflectionRevision = 1;
    this.waterReflectionResizes = 0;
    this.water = new Water(createOceanGeometry(quality), {
      textureWidth: reflectionSize,
      textureHeight: reflectionSize,
      waterNormals: this.waterNormals,
      sunDirection: new THREE.Vector3(0.4, 0.8, 0.2),
      sunColor: this.current.sunColor,
      waterColor: this.current.waterColor,
      distortionScale: this.current.distortion,
      fog: true,
    });
    this.water.name = 'ReflectiveOcean';
    this.water.material.uniforms.size.value = 1.35;
    this.water.material.uniforms.uHorizonWaterColor = {
      value: this.current.waterHorizon.clone(),
    };
    this.water.material.uniforms.uDeepWaterColor = {
      value: this.current.waterDeep.clone(),
    };
    this.water.material.uniforms.uReflectionStrength = {
      value: this.current.reflectionStrength,
    };
    this.water.material.uniforms.uSunGlintStrength = {
      value: this.current.sunGlintStrength,
    };
    this.water.material.uniforms.uSwellStrength = {
      value: this.oceanSwellStrength,
    };
    // Keep the maintained Water mirror camera; own the complete water shaders.
    this.oceanRefraction = new OceanRefraction(this.water, quality);
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.set(0, 0, -119);
    this.water.receiveShadow = true;
    const renderWaterReflection = this.water.onBeforeRender;
    this.water.onBeforeRender = (activeRenderer, activeScene, activeCamera) => {
      // Only submerged geometry contributes to transmission; preserve the sand depth.
      this.world.beginReflectionPass();
      const beachVisible = this.world.beach.visible;
      this.world.beach.visible = true;
      this.world.seabed.visible = true;
      this.world.coastContinuation.visible = true;
      try {
        this.oceanRefraction.capture(activeRenderer, activeScene, activeCamera,
          [this.sky, this.clouds, this.stars, this.moon, this.moonHalo]);
      } finally {
        this.world.beach.visible = beachVisible;
        this.world.endReflectionPass();
      }
      let originalSetRenderTarget = null;
      if (!this.waterReflectionTarget) {
        originalSetRenderTarget = activeRenderer.setRenderTarget;
        activeRenderer.setRenderTarget = (target, ...args) => {
          if (
            !this.waterReflectionTarget &&
            target?.texture ===
              this.water.material.uniforms.mirrorSampler.value
          ) {
            this.captureWaterReflectionTarget(target);
          }
          return originalSetRenderTarget.call(activeRenderer, target, ...args);
        };
      }
      this.world.beginReflectionPass();
      try {
        renderWaterReflection.call(
          this.water,
          activeRenderer,
          activeScene,
          activeCamera,
        );
      } finally {
        if (originalSetRenderTarget) {
          activeRenderer.setRenderTarget = originalSetRenderTarget;
        }
        this.world.endReflectionPass();
      }
    };
    this.scene.add(this.water);
    this.applyTideState();

    const starProfile = getStarQualityProfile(quality);
    this.starQuality = starProfile.quality;
    this.starRevision = 0;
    this.starReplacements = 0;
    this.disposedStarGeometries = 0;
    this.stars = createStarShell();

    const moonProfile = getMoonQualityProfile(quality);
    this.moonQuality = moonProfile.quality;
    this.moonRevision = 0;
    this.moonReplacements = 0;
    this.disposedMoonTextures = 0;
    this.disposedMoonGeometries = 0;
    this.moon = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: 0xf2f5ff,
        map: null,
        transparent: true,
        opacity: 0,
        fog: false,
      }),
    );
    this.moon.name = 'CelestialMoon';
    this.moon.frustumCulled = false;

    this.moonHalo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        color: 0x9db8e8,
        map: null,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    );
    this.moonHalo.name = 'CelestialMoonHalo';
    this.moonHalo.scale.set(22, 22, 1);
    this.moonHalo.frustumCulled = false;
    this.celestialInitialized = false;
    this.celestialAllocations = 0;

    this.applyCurrentState();
    this.refreshEnvironment(PRESETS.day);
  }

  setTimeOfDay(name, immediate = false) {
    const preset = PRESETS[name];
    if (!preset) return;

    const celestialOpacity = getCelestialOpacityState(preset.night);
    if (celestialOpacity.required) this.ensureCelestialResources();

    this.currentPreset = name;
    this.dayClock.seek(name);
    this.target = createState(preset);

    if (immediate) {
      this.current = createState(preset);
      this.applyCurrentState();
    }

    // PMREM generation is delayed until the visual interpolation is underway.
    // This avoids regenerating an environment map for every animation frame.
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshEnvironment(preset);
    }, immediate ? 0 : 420);
  }

  setWeather(name, immediate = false) {
    const preset = WEATHER_PRESETS[name];
    if (!preset) return this.getWeatherState();

    this.currentWeather = name;
    this.weatherTarget = createWeatherState(preset);
    if (immediate) {
      this.weatherCurrent = createWeatherState(preset);
      this.applyCurrentState();
    }
    return this.getWeatherState();
  }

  getWeatherState() {
    const weather = this.weatherCurrent;
    const state = this.current;
    return {
      mode: this.currentWeather,
      coverage: Number(weather.coverage.toFixed(3)),
      cloudOpacity: Number(
        (this.clouds.material.uniforms.uOpacity.value).toFixed(3),
      ),
      sunIntensity: Number((state.sunIntensity * weather.sunScale).toFixed(3)),
      fogDensity: Number((state.fogDensity * weather.fogScale).toFixed(6)),
      exposure: Number((state.exposure * weather.exposureScale).toFixed(3)),
      reflectionStrength: Number(
        (state.reflectionStrength * weather.reflectionScale).toFixed(3),
      ),
      sunGlintStrength: Number(
        (state.sunGlintStrength * weather.glintScale).toFixed(3),
      ),
    };
  }

  setWaveSpeed(value) {
    this.waveSpeed = value;
  }

  setOceanSwellStrength(value) {
    this.oceanSwellStrength = THREE.MathUtils.clamp(Number(value) || 0, 0, 1);
    if (this.water?.material.uniforms.uSwellStrength) {
      this.water.material.uniforms.uSwellStrength.value =
        this.oceanSwellStrength;
    }
    return this.getOceanSwellState();
  }

  setWindStrength(value, immediate = false) {
    return this.wind.setStrength(value, { immediate });
  }

  getWindState() {
    return this.wind.getDebugState();
  }

  getOceanSwellState() {
    const shader = this.water?.material.vertexShader ?? '';
    return {
      strength: Number(this.oceanSwellStrength.toFixed(2)),
      fadeStartZ: OCEAN_SWELL_FADE_START_Z,
      fadeEndZ: OCEAN_SWELL_FADE_END_Z,
      timeSource: 'water',
      shaderLinked:
        shader.includes('farOceanMask') && shader.includes('uSwellStrength'),
      textureSamplesAdded: 0,
    };
  }

  setTideMode(mode, immediate = false) {
    if (!['low', 'auto', 'high'].includes(mode)) return this.getTideState();
    this.tideMode = mode;

    if (immediate) {
      this.tideLevel = this.getTideTarget();
      this.applyTideState();
    }

    return this.getTideState();
  }

  getTideTarget() {
    if (this.tideMode !== 'auto') return TIDE_LEVELS[this.tideMode];
    const phase = (this.tideElapsed / AUTO_TIDE_CYCLE_SECONDS) * Math.PI * 2;
    return Math.sin(phase);
  }

  getTideState() {
    const level = THREE.MathUtils.clamp(this.tideLevel, -1, 1);
    const shorelineOffset = level * TIDE_SHORE_TRAVEL;
    return {
      mode: this.tideMode,
      level: Number(level.toFixed(3)),
      band: level < -0.34 ? 'low' : level > 0.34 ? 'high' : 'mid',
      shoreline: Number((BASE_SHORELINE_Z + shorelineOffset).toFixed(3)),
      shorelineOffset: Number(shorelineOffset.toFixed(3)),
      waterHeight: Number(
        (BASE_WATER_HEIGHT + level * TIDE_WATER_TRAVEL).toFixed(3),
      ),
      cycleSeconds: AUTO_TIDE_CYCLE_SECONDS,
    };
  }

  applyTideState() {
    if (!this.water) return;
    const level = THREE.MathUtils.clamp(this.tideLevel, -1, 1);
    const shorelineOffset = level * TIDE_SHORE_TRAVEL;
    const waterHeight = BASE_WATER_HEIGHT + level * TIDE_WATER_TRAVEL;
    const band = level < -0.34 ? 'low' : level > 0.34 ? 'high' : 'mid';
    this.water.position.y = waterHeight;
    this.world?.setTideState(
      level,
      shorelineOffset,
      waterHeight,
      this.tideMode,
      band,
    );
  }

  setShadows(enabled) {
    this.sunLight.castShadow = enabled;
  }

  setQuality(quality) {
    const profile = getCloudQualityProfile(quality);
    const changed = profile.quality !== this.quality;
    this.quality = profile.quality;
    const size = profile.quality === 'high' ? 2048 : 768;
    if (this.sunLight.shadow.mapSize.width !== size) {
      this.sunLight.shadow.mapSize.set(size, size);
      this.sunLight.shadow.map?.dispose();
      this.sunLight.shadow.map = null;
    }
    if (changed) {
      const oldOcean = this.water.geometry;
      this.water.geometry = createOceanGeometry(profile.quality);
      oldOcean.dispose();
      this.oceanRefraction.quality = profile.quality;
      this.replaceCloudLayer(profile.quality);
      this.replaceWaterNormalTexture(profile.quality);
      this.setWaterReflectionQuality(profile.quality);
      this.replaceMoonQualityResources(profile.quality);
      this.replaceStarGeometry(profile.quality);
    }
    this.world.setDetailEnabled(profile.quality === 'high');
    return this.getCloudQualityState();
  }

  replaceCloudLayer(quality) {
    const previous = this.clouds;
    const profile = getCloudQualityProfile(quality);
    if (previous?.userData.cloudQuality === profile.quality) return false;

    const next = createCloudLayer(profile.quality);
    if (previous) {
      next.position.copy(previous.position);
      next.quaternion.copy(previous.quaternion);
      next.scale.copy(previous.scale);
      const previousUniforms = previous.material.uniforms;
      const nextUniforms = next.material.uniforms;
      nextUniforms.uTime.value = previousUniforms.uTime.value;
      nextUniforms.uEvolution.value = previousUniforms.uEvolution.value;
      nextUniforms.uCoverage.value = previousUniforms.uCoverage.value;
      nextUniforms.uOpacity.value = previousUniforms.uOpacity.value;
      nextUniforms.uLightColor.value.copy(previousUniforms.uLightColor.value);
      nextUniforms.uShadowColor.value.copy(previousUniforms.uShadowColor.value);
      nextUniforms.uSunDirection.value.copy(previousUniforms.uSunDirection.value);
    }

    this.scene.add(next);
    this.clouds = next;
    this.cloudRevision += 1;
    this.cloudReplacements += 1;

    if (previous) {
      const previousTexture = previous.material.uniforms.uCloudMap.value;
      previous.removeFromParent();
      previous.geometry.dispose();
      previous.material.dispose();
      previousTexture.dispose();
      this.disposedCloudLayers += 1;
    }
    this.renderer.renderLists.dispose();
    return true;
  }

  getCloudQualityState() {
    const profile = getCloudQualityProfile(
      this.clouds?.userData.cloudQuality ?? this.quality,
    );
    const texture = this.clouds?.material.uniforms.uCloudMap.value;
    const geometry = this.clouds?.geometry;
    return {
      quality: profile.quality,
      revision: this.cloudRevision,
      replacements: this.cloudReplacements,
      disposedLayers: this.disposedCloudLayers,
      textureWidth: texture?.image.width ?? 0,
      textureHeight: texture?.image.height ?? 0,
      densityBytes:
        (texture?.image.width ?? 0) * (texture?.image.height ?? 0) * 4,
      octaveCount: profile.octaveCount,
      widthSegments: geometry?.parameters?.widthSegments ?? 0,
      heightSegments: geometry?.parameters?.heightSegments ?? 0,
      triangles: geometry?.index
        ? geometry.index.count / 3
        : getCloudSphereTriangleCount(profile),
      phase: Number(
        (this.clouds?.material.uniforms.uTime.value ?? 0).toFixed(3),
      ),
      rotationY: Number((this.clouds?.rotation.y ?? 0).toFixed(6)),
      shaderLinked: Boolean(
        this.clouds?.material.fragmentShader.includes('uCloudMap'),
      ),
    };
  }

  captureWaterReflectionTarget(target) {
    this.waterReflectionTarget = target;
    target.texture.type = THREE.HalfFloatType;
    if (
      target.width !== this.waterReflectionSize ||
      target.height !== this.waterReflectionSize
    ) {
      target.setSize(this.waterReflectionSize, this.waterReflectionSize);
      this.waterReflectionResizes += 1;
    }
  }

  setWaterReflectionQuality(quality) {
    const profile = getWaterReflectionProfile(quality);
    if (profile.quality === this.waterReflectionQuality) {
      return this.getWaterReflectionQualityState();
    }

    this.waterReflectionQuality = profile.quality;
    this.waterReflectionSize = profile.size;
    this.waterReflectionRevision += 1;
    if (
      this.waterReflectionTarget &&
      (this.waterReflectionTarget.width !== profile.size ||
        this.waterReflectionTarget.height !== profile.size)
    ) {
      this.waterReflectionTarget.setSize(profile.size, profile.size);
      this.waterReflectionResizes += 1;
    }
    return this.getWaterReflectionQualityState();
  }

  getWaterReflectionQualityState() {
    const profile = getWaterReflectionProfile(this.waterReflectionQuality);
    const texture = this.water?.material.uniforms.mirrorSampler.value;
    const width = this.waterReflectionTarget?.width ?? texture?.image.width ?? 0;
    const height =
      this.waterReflectionTarget?.height ?? texture?.image.height ?? 0;
    return {
      quality: profile.quality,
      revision: this.waterReflectionRevision,
      resizes: this.waterReflectionResizes,
      captured: Boolean(this.waterReflectionTarget),
      width,
      height,
      pixelCount: width * height,
      waterUuid: this.water?.uuid ?? null,
      textureUuid: texture?.uuid ?? null,
      profilePixelCount: getWaterReflectionPixelCount(profile),
      linked: Boolean(
        this.waterReflectionTarget?.texture === texture,
      ),
    };
  }

  createWaterNormalTexture(quality) {
    const profile = getWaterNormalProfile(quality);
    const sourceSize = getTextureImageSize(this.waterNormalSource);
    let texture = null;
    let sourceKind = 'procedural';

    if (this.waterNormalSource && sourceSize.width && sourceSize.height) {
      sourceKind = 'image';
      if (sourceSize.width === profile.size && sourceSize.height === profile.size) {
        texture = this.waterNormalSource.clone();
        texture.needsUpdate = true;
      } else {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = profile.size;
          canvas.height = profile.size;
          const context = canvas.getContext('2d', { alpha: false });
          if (!context) throw new Error('Canvas 2D context is unavailable');
          context.imageSmoothingEnabled = true;
          context.imageSmoothingQuality = 'high';
          context.drawImage(
            this.waterNormalSource.image,
            0,
            0,
            profile.size,
            profile.size,
          );
          texture = new THREE.CanvasTexture(canvas);
        } catch (error) {
          console.warn('Water normal resize failed; using procedural fallback.', error);
          texture = createProceduralWaterNormal(profile.size);
          sourceKind = 'procedural-fallback';
        }
      }
    } else {
      texture = createProceduralWaterNormal(profile.size);
    }

    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(6, 6);
    texture.colorSpace = THREE.NoColorSpace;
    texture.anisotropy = Math.min(
      profile.anisotropy,
      this.renderer.capabilities.getMaxAnisotropy(),
    );
    texture.userData.waterNormalQuality = profile.quality;
    texture.userData.waterNormalSource = sourceKind;
    texture.needsUpdate = true;
    return texture;
  }

  replaceWaterNormalTexture(quality) {
    const profile = getWaterNormalProfile(quality);
    const previous = this.waterNormals;
    if (previous?.userData.waterNormalQuality === profile.quality) return false;

    const next = this.createWaterNormalTexture(profile.quality);
    this.water.material.uniforms.normalSampler.value = next;
    this.waterNormals = next;
    this.waterNormalQuality = profile.quality;
    this.waterNormalRevision += 1;
    this.waterNormalReplacements += 1;
    previous?.dispose();
    this.disposedWaterNormals += 1;
    return true;
  }

  getWaterNormalQualityState() {
    const profile = getWaterNormalProfile(this.waterNormalQuality);
    const texture = this.waterNormals;
    const size = getTextureImageSize(texture);
    const sourceSize = getTextureImageSize(this.waterNormalSource);
    return {
      quality: profile.quality,
      revision: this.waterNormalRevision,
      replacements: this.waterNormalReplacements,
      disposedTextures: this.disposedWaterNormals,
      width: size.width,
      height: size.height,
      pixelCount: size.width * size.height,
      profilePixelCount: getWaterNormalPixelCount(profile),
      anisotropy: texture?.anisotropy ?? 1,
      sourceKind: texture?.userData.waterNormalSource ?? null,
      sourceWidth: sourceSize.width,
      sourceHeight: sourceSize.height,
      sourceUuid: this.waterNormalSource?.uuid ?? null,
      textureUuid: texture?.uuid ?? null,
      linked: this.water.material.uniforms.normalSampler.value === texture,
    };
  }

  replaceStarGeometry(quality) {
    const profile = getStarQualityProfile(quality);
    this.starQuality = profile.quality;
    if (!this.celestialInitialized) return false;

    const previous = this.stars.geometry;
    if (previous?.userData.starQuality === profile.quality) return false;

    const next = createStarGeometry(profile.quality);
    this.stars.geometry = next;
    this.starQuality = profile.quality;
    this.starRevision += 1;
    this.starReplacements += 1;
    previous?.dispose();
    this.disposedStarGeometries += 1;
    this.renderer.renderLists.dispose();
    return true;
  }

  getStarQualityState() {
    const profile = getStarQualityProfile(this.starQuality);
    const geometry = this.stars?.geometry;
    const position = geometry?.attributes.position;
    return {
      initialized: this.celestialInitialized,
      quality: profile.quality,
      revision: this.starRevision,
      replacements: this.starReplacements,
      disposedGeometries: this.disposedStarGeometries,
      count: position?.count ?? 0,
      profileCount: profile.count,
      positionFloats: position?.array.length ?? 0,
      profilePositionFloats: getStarPositionFloatCount(profile),
      positionBytes: position?.array.byteLength ?? 0,
      profilePositionBytes: getStarPositionByteCount(profile),
      opacity: Number((this.stars?.material.opacity ?? 0).toFixed(3)),
      visible: Boolean(this.stars?.visible),
      rotationY: Number((this.stars?.rotation.y ?? 0).toFixed(6)),
      geometryUuid: geometry?.uuid ?? null,
      materialUuid: this.stars?.material.uuid ?? null,
      pointsUuid: this.stars?.uuid ?? null,
      linked: Boolean(
        this.stars?.geometry === geometry &&
          geometry?.userData.starQuality === profile.quality,
      ),
    };
  }

  createMoonQualityTexture(quality) {
    const profile = getMoonQualityProfile(quality);
    const texture = createMoonTexture(profile.size);
    texture.userData.moonQuality = profile.quality;
    texture.userData.craterCount = getMoonCraterCount(profile);
    return texture;
  }

  createMoonQualityGeometry(quality) {
    const profile = getMoonQualityProfile(quality);
    const geometry = new THREE.SphereGeometry(
      4.2,
      profile.widthSegments,
      profile.heightSegments,
    );
    geometry.userData.moonQuality = profile.quality;
    return geometry;
  }

  replaceMoonQualityResources(quality) {
    const profile = getMoonQualityProfile(quality);
    this.moonQuality = profile.quality;
    if (!this.celestialInitialized) return false;

    const previousTexture = this.moon.material.map;
    const previousGeometry = this.moon.geometry;
    if (
      previousTexture?.userData.moonQuality === profile.quality &&
      previousGeometry?.userData.moonQuality === profile.quality
    ) {
      return false;
    }

    const nextTexture = this.createMoonQualityTexture(profile.quality);
    const nextGeometry = this.createMoonQualityGeometry(profile.quality);
    this.moon.material.map = nextTexture;
    this.moon.geometry = nextGeometry;
    this.moon.material.needsUpdate = true;
    this.moonQuality = profile.quality;
    this.moonRevision += 1;
    this.moonReplacements += 1;
    previousTexture?.dispose();
    previousGeometry?.dispose();
    this.disposedMoonTextures += 1;
    this.disposedMoonGeometries += 1;
    this.renderer.renderLists.dispose();
    return true;
  }

  getMoonQualityState() {
    const profile = getMoonQualityProfile(this.moonQuality);
    const texture = this.moon?.material.map;
    const geometry = this.moon?.geometry;
    const size = getTextureImageSize(texture);
    return {
      initialized: this.celestialInitialized,
      quality: profile.quality,
      revision: this.moonRevision,
      replacements: this.moonReplacements,
      disposedTextures: this.disposedMoonTextures,
      disposedGeometries: this.disposedMoonGeometries,
      width: size.width,
      height: size.height,
      pixelCount: size.width * size.height,
      profilePixelCount: getMoonPixelCount(profile),
      craterCount: texture?.userData.craterCount ?? 0,
      widthSegments: geometry?.parameters?.widthSegments ?? 0,
      heightSegments: geometry?.parameters?.heightSegments ?? 0,
      vertices: geometry?.attributes.position?.count ?? 0,
      profileVertices: getMoonVertexCount(profile),
      triangles: geometry?.index ? geometry.index.count / 3 : 0,
      profileTriangles: getMoonTriangleCount(profile),
      textureUuid: texture?.uuid ?? null,
      geometryUuid: geometry?.uuid ?? null,
      materialUuid: this.moon?.material.uuid ?? null,
      moonUuid: this.moon?.uuid ?? null,
      linked: Boolean(
        this.moon?.material.map === texture &&
          geometry?.userData.moonQuality === profile.quality,
      ),
    };
  }

  update(delta, elapsed, realDelta = delta) {
    this.dayClock.update(realDelta);
    const sample = this.dayClock.sample();
    this.currentPreset = sample.blend < .5 ? sample.from : sample.to;
    const from = this.dayStates[sample.from], to = this.dayStates[sample.to];
    for (const key of SCALAR_KEYS) {
      this.target[key] = THREE.MathUtils.lerp(from[key], to[key], sample.blend);
    }
    const angle = THREE.MathUtils.euclideanModulo(to.azimuth - from.azimuth + 180, 360) - 180;
    this.target.azimuth = from.azimuth + angle * sample.blend;
    for (const key of COLOR_KEYS) this.target[key].copy(from[key]).lerp(to[key], sample.blend);
    // Keep angular interpolation continuous when crossing the 360-degree boundary.
    this.current.azimuth = this.target.azimuth + THREE.MathUtils.euclideanModulo(this.current.azimuth - this.target.azimuth + 180, 360) - 180;
    const wind = this.wind.update(delta);
    const blend = 1 - Math.exp(-delta * 2.4);
    for (const key of SCALAR_KEYS) {
      this.current[key] = THREE.MathUtils.lerp(
        this.current[key],
        this.target[key],
        blend,
      );
    }
    for (const key of COLOR_KEYS) {
      this.current[key].lerp(this.target[key], blend);
    }
    for (const key of WEATHER_SCALAR_KEYS) {
      this.weatherCurrent[key] = THREE.MathUtils.lerp(
        this.weatherCurrent[key],
        this.weatherTarget[key],
        blend,
      );
    }
    this.weatherCurrent.cloudLight.lerp(this.weatherTarget.cloudLight, blend);
    this.weatherCurrent.cloudShadow.lerp(this.weatherTarget.cloudShadow, blend);

    this.applyCurrentState();
    this.tideElapsed += delta;
    const tideBlend =
      1 - Math.exp(-delta * (this.tideMode === 'auto' ? 1.2 : 2.8));
    this.tideLevel = THREE.MathUtils.lerp(
      this.tideLevel,
      this.getTideTarget(),
      tideBlend,
    );
    this.applyTideState();
    this.water.material.uniforms.time.value += delta * this.waveSpeed;
    this.water.material.uniforms.uWindFactor.value = wind.factor;
    const waterTime = this.water.material.uniforms.time.value;
    this.stars.rotation.y = elapsed * 0.004;
    this.clouds.material.uniforms.uTime.value = wind.phase;
    this.cloudElapsed += realDelta;
    this.clouds.material.uniforms.uEvolution.value = this.cloudElapsed;
    this.clouds.rotation.y += delta * 0.00025 * wind.factor;
    this.environmentElapsed += realDelta;
    if (this.dayClock.running && this.environmentElapsed >= 20) {
      this.environmentElapsed = 0;
      this.refreshEnvironment(this.current);
    }
    this.world.update(
      this.cloudElapsed,
      delta,
      this.current,
      waterTime,
      this.waveSpeed,
      wind,
    );
    return wind;
  }

  applyCurrentState() {
    // Sky lighting and water reflection must share the exact same direction;
    // otherwise highlights visibly disagree during time-of-day transitions.
    const state = this.current;
    const weather = this.weatherCurrent;
    const phi = THREE.MathUtils.degToRad(90 - state.elevation);
    const theta = THREE.MathUtils.degToRad(state.azimuth);
    this.sun.setFromSphericalCoords(1, phi, theta);

    this.moonDirection.copy(this.sun).negate();
    this.lightDirection
      .copy(this.sun)
      .lerp(this.moonDirection, smoothNightBlend(state.night))
      .normalize();

    const skyUniforms = this.sky.material.uniforms;
    skyUniforms.turbidity.value = state.turbidity + weather.turbidityBoost;
    skyUniforms.rayleigh.value = state.rayleigh;
    skyUniforms.mieCoefficient.value = state.mieCoefficient;
    skyUniforms.mieDirectionalG.value = state.mieDirectionalG;
    skyUniforms.sunPosition.value.copy(this.sun);
    skyUniforms.uCoastalDaylight.value = state.daylight * (1 - state.night) * (1 - weather.coverage);
    // Retain HDR illumination for PBR, but no baked clouds in the visible sky.
    skyUniforms.uSkyBlend.value = 0;
    // The HDR sun is at longitude 0.595 rad, elevation 48 degrees; align the key light.
    skyUniforms.uSkyYaw.value = 0.5951845457 - Math.atan2(this.sun.z, this.sun.x);

    this.sunLight.position.copy(this.lightDirection).multiplyScalar(105);
    this.sunLight.color.copy(state.sunColor);
    this.sunLight.intensity = state.sunIntensity * weather.sunScale;
    this.hemisphereLight.color.copy(state.hemiSky);
    this.hemisphereLight.groundColor.copy(state.hemiGround);
    this.hemisphereLight.intensity = state.hemiIntensity * weather.hemiScale;
    this.ambientLight.intensity = state.ambientIntensity * weather.ambientScale;

    this.scene.fog.color.copy(state.fogColor);
    this.scene.fog.density = state.fogDensity * weather.fogScale;
    this.renderer.toneMappingExposure = state.exposure * weather.exposureScale;

    const cloudUniforms = this.clouds.material.uniforms;
    cloudUniforms.uOpacity.value =
      Math.min(.95, .56 + state.cloudOpacity * .8 + weather.coverage * .55) * (1 - state.night * .48);
    cloudUniforms.uCoverage.value = weather.coverage;
    this.weatherCloudLight
      .copy(state.cloudLight)
      .lerp(weather.cloudLight, weather.cloudColorBlend);
    this.weatherCloudShadow
      .copy(state.cloudShadow)
      .lerp(weather.cloudShadow, weather.cloudColorBlend);
    cloudUniforms.uLightColor.value.copy(this.weatherCloudLight);
    cloudUniforms.uShadowColor.value.copy(this.weatherCloudShadow);
    cloudUniforms.uSunDirection.value.copy(this.lightDirection);

    const waterUniforms = this.water.material.uniforms;
    waterUniforms.uDaylight.value = state.daylight;
    waterUniforms.sunDirection.value.copy(this.lightDirection);
    waterUniforms.sunColor.value.copy(state.sunColor);
    waterUniforms.waterColor.value.copy(state.waterColor);
    waterUniforms.uHorizonWaterColor.value.copy(state.waterHorizon);
    waterUniforms.uDeepWaterColor.value.copy(state.waterDeep);
    waterUniforms.uReflectionStrength.value =
      state.reflectionStrength * weather.reflectionScale;
    waterUniforms.uSunGlintStrength.value =
      state.sunGlintStrength * weather.glintScale;
    waterUniforms.distortionScale.value = state.distortion;

    const celestialOpacity = getCelestialOpacityState(state.night);
    if (celestialOpacity.required && !this.celestialInitialized) {
      this.ensureCelestialResources();
    }
    const starOpacity = celestialOpacity.star;
    this.stars.material.opacity = starOpacity;
    this.stars.visible =
      this.celestialInitialized && hasVisibleAtmosphereContribution(starOpacity);
    const moonOpacity = celestialOpacity.moon;
    this.moon.material.opacity = moonOpacity;
    this.moonHalo.material.opacity = moonOpacity * 0.2;
    const moonVisible =
      this.celestialInitialized && hasVisibleAtmosphereContribution(moonOpacity);
    this.moon.visible = moonVisible;
    this.moonHalo.visible = moonVisible;
    this.moon.position.copy(this.moonDirection).multiplyScalar(230);
    this.moonHalo.position.copy(this.moon.position);

    this.world.setTimeColors({
      drySand: state.drySand,
      wetSand: state.wetSand,
      foam: state.foam,
      foamTint: state.foamTint,
    });
  }

  ensureCelestialResources() {
    if (this.celestialInitialized) return false;

    const starGeometry = createStarGeometry(this.starQuality);
    const moonTexture = this.createMoonQualityTexture(this.moonQuality);
    const moonGeometry = this.createMoonQualityGeometry(this.moonQuality);
    const haloTexture = createGlowTexture(CELESTIAL_GLOW_TEXTURE_SIZE);

    this.stars.geometry.dispose();
    this.moon.geometry.dispose();
    this.stars.geometry = starGeometry;
    this.moon.geometry = moonGeometry;
    this.moon.material.map = moonTexture;
    this.moonHalo.material.map = haloTexture;
    this.moon.material.needsUpdate = true;
    this.moonHalo.material.needsUpdate = true;
    this.scene.add(this.stars, this.moon, this.moonHalo);
    this.celestialInitialized = true;
    this.celestialAllocations += 1;
    this.starRevision = 1;
    this.moonRevision = 1;
    this.renderer.renderLists.dispose();
    return true;
  }

  getCelestialResourceState() {
    const profile = getCelestialResourceProfile(this.quality);
    return {
      initialized: this.celestialInitialized,
      allocations: this.celestialAllocations,
      quality: profile.quality,
      residentPayloadBytes: this.celestialInitialized
        ? profile.totalPayloadBytes
        : 0,
      plannedPayloadBytes: profile.totalPayloadBytes,
      moonTextureBytes: profile.moonTextureBytes,
      glowTextureBytes: profile.glowTextureBytes,
      moonGeometryBytes: profile.moonGeometryBytes,
      starPositionBytes: profile.starPositionBytes,
      objectsInScene: [this.stars, this.moon, this.moonHalo].filter(
        (object) => object.parent === this.scene,
      ).length,
      linked: Boolean(
        this.celestialInitialized &&
          this.stars.geometry?.userData.starQuality === this.starQuality &&
          this.moon.geometry?.userData.moonQuality === this.moonQuality &&
          this.moon.material.map?.userData.moonQuality === this.moonQuality &&
          this.moonHalo.material.map,
      ),
    };
  }

  refreshEnvironment(preset) {
    if (this.disposed) return;
    const uniforms = this.environmentSky.material.uniforms;
    uniforms.turbidity.value = preset.turbidity;
    uniforms.rayleigh.value = preset.rayleigh;
    uniforms.mieCoefficient.value = preset.mieCoefficient;
    uniforms.mieDirectionalG.value = preset.mieDirectionalG;
    uniforms.uCoastalDaylight.value = preset.daylight * (1 - preset.night);

    const sun = new THREE.Vector3().setFromSphericalCoords(
      1,
      THREE.MathUtils.degToRad(90 - preset.elevation),
      THREE.MathUtils.degToRad(preset.azimuth),
    );
    uniforms.sunPosition.value.copy(sun);
    uniforms.uSkyBlend.value = this.skyTexture ? THREE.MathUtils.smoothstep(preset.daylight, 0.76, 0.98) * (1 - this.weatherCurrent.coverage) : 0;
    uniforms.uSkyYaw.value = 0.5951845457 - Math.atan2(sun.z, sun.x);

    try {
      // PMREM turns the analytical sky into a filtered reflection source for
      // all PBR materials. Old targets are disposed after the replacement.
      const nextTarget = this.pmremGenerator.fromScene(
        this.environmentScene,
        0,
        0.1,
        500,
      );
      this.environmentRenderTarget?.dispose();
      this.environmentRenderTarget = nextTarget;
      this.scene.environment = nextTarget.texture;
    } catch (error) {
      console.warn('Environment reflection map could not be refreshed:', error);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    window.clearTimeout(this.refreshTimer);
    if (this.scene.environment === this.environmentRenderTarget?.texture) {
      this.scene.environment = null;
    }
    this.environmentRenderTarget?.dispose();
    this.pmremGenerator.dispose();
    this.waterReflectionTarget?.dispose();
    this.waterReflectionTarget = null;

    this.oceanRefraction?.dispose();

    const ownedObjects = [
      this.sky,
      this.clouds,
      this.water,
      this.stars,
      this.moon,
      this.moonHalo,
      this.environmentSky,
    ];
    const textures = new Set([
      this.skyTexture,
      this.waterNormals,
      this.waterNormalSource,
      this.clouds.material.uniforms.uCloudMap.value,
      this.moon.material.map,
      this.moonHalo.material.map,
    ]);
    ownedObjects.forEach((object) => {
      object.removeFromParent();
      object.geometry?.dispose();
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      materials.filter(Boolean).forEach((material) => material.dispose());
    });
    textures.forEach((texture) => texture?.dispose());
    this.waterNormals = null;
    this.waterNormalSource = null;
    this.skyTexture = null;
    this.moon.material.map = null;
    this.moonHalo.material.map = null;
    this.moon.geometry = null;
    this.stars.geometry = null;
    this.celestialInitialized = false;

    this.ambientLight.removeFromParent();
    this.hemisphereLight.removeFromParent();
    this.sunLight.removeFromParent();
    this.sunLight.target.removeFromParent();
    this.environmentScene.clear();
  }
}

function smoothstep01(value) {
  const clamped = THREE.MathUtils.clamp(value, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

function smoothNightBlend(night) {
  return smoothstep01((night - 0.44) / 0.56);
}

function getCelestialOpacityState(night) {
  const star = smoothstep01((night - 0.2) / 0.8) * 0.88;
  const moon = smoothstep01((night - 0.28) / 0.72);
  return {
    star,
    moon,
    required:
      hasVisibleAtmosphereContribution(star) ||
      hasVisibleAtmosphereContribution(moon),
  };
}

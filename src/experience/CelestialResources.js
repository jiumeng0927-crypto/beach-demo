import {
  getMoonPixelCount,
  getMoonQualityProfile,
  getMoonTriangleCount,
  getMoonVertexCount,
} from './MoonQuality.js';
import {
  getStarPositionByteCount,
  getStarQualityProfile,
} from './StarQuality.js';

export const CELESTIAL_GLOW_TEXTURE_SIZE = 128;

const RGBA_BYTES_PER_PIXEL = 4;
const MOON_FLOATS_PER_VERTEX = 8;
const INDEX_BYTES = Uint16Array.BYTES_PER_ELEMENT;

function createProfile(quality) {
  const moon = getMoonQualityProfile(quality);
  const stars = getStarQualityProfile(quality);
  const moonTextureBytes =
    getMoonPixelCount(moon) * RGBA_BYTES_PER_PIXEL;
  const glowTextureBytes =
    CELESTIAL_GLOW_TEXTURE_SIZE ** 2 * RGBA_BYTES_PER_PIXEL;
  const moonGeometryBytes =
    getMoonVertexCount(moon) *
      MOON_FLOATS_PER_VERTEX *
      Float32Array.BYTES_PER_ELEMENT +
    getMoonTriangleCount(moon) * 3 * INDEX_BYTES;
  const starPositionBytes = getStarPositionByteCount(stars);

  return Object.freeze({
    quality: moon.quality,
    moonTextureBytes,
    glowTextureBytes,
    moonGeometryBytes,
    starPositionBytes,
    totalPayloadBytes:
      moonTextureBytes +
      glowTextureBytes +
      moonGeometryBytes +
      starPositionBytes,
  });
}

export const CELESTIAL_RESOURCE_PROFILES = Object.freeze({
  high: createProfile('high'),
  low: createProfile('low'),
});

export function getCelestialResourceProfile(quality) {
  return CELESTIAL_RESOURCE_PROFILES[quality] ?? CELESTIAL_RESOURCE_PROFILES.low;
}

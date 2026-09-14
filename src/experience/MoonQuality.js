const HIGH_PROFILE = Object.freeze({
  quality: 'high',
  size: 256,
  widthSegments: 28,
  heightSegments: 20,
});

const LOW_PROFILE = Object.freeze({
  quality: 'low',
  size: 128,
  widthSegments: 18,
  heightSegments: 12,
});

export const MOON_QUALITY_PROFILES = Object.freeze({
  high: HIGH_PROFILE,
  low: LOW_PROFILE,
});

export function getMoonQualityProfile(quality) {
  return MOON_QUALITY_PROFILES[quality] ?? LOW_PROFILE;
}

export function getMoonPixelCount(profile) {
  return profile.size * profile.size;
}

export function getMoonCraterCount(profile) {
  return Math.round(profile.size * 0.18);
}

export function getMoonVertexCount(profile) {
  return (profile.widthSegments + 1) * (profile.heightSegments + 1);
}

export function getMoonTriangleCount(profile) {
  return profile.widthSegments * (profile.heightSegments - 1) * 2;
}

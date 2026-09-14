const HIGH_PROFILE = Object.freeze({
  quality: 'high',
  size: 1024,
});

const LOW_PROFILE = Object.freeze({
  quality: 'low',
  size: 256,
});

export const WATER_REFLECTION_PROFILES = Object.freeze({
  high: HIGH_PROFILE,
  low: LOW_PROFILE,
});

export function getWaterReflectionProfile(quality) {
  return WATER_REFLECTION_PROFILES[quality] ?? LOW_PROFILE;
}

export function getWaterReflectionPixelCount(profile) {
  return profile.size * profile.size;
}

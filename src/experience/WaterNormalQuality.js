const HIGH_PROFILE = Object.freeze({
  quality: 'high',
  size: 512,
  anisotropy: 8,
});

const LOW_PROFILE = Object.freeze({
  quality: 'low',
  size: 256,
  anisotropy: 4,
});

export const WATER_NORMAL_PROFILES = Object.freeze({
  high: HIGH_PROFILE,
  low: LOW_PROFILE,
});

export function getWaterNormalProfile(quality) {
  return WATER_NORMAL_PROFILES[quality] ?? LOW_PROFILE;
}

export function getWaterNormalPixelCount(profile) {
  return profile.size * profile.size;
}

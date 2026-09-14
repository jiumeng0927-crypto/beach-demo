const HIGH_PROFILE = Object.freeze({
  quality: 'high',
  count: 950,
});

const LOW_PROFILE = Object.freeze({
  quality: 'low',
  count: 480,
});

export const STAR_QUALITY_PROFILES = Object.freeze({
  high: HIGH_PROFILE,
  low: LOW_PROFILE,
});

export function getStarQualityProfile(quality) {
  return STAR_QUALITY_PROFILES[quality] ?? LOW_PROFILE;
}

export function getStarPositionFloatCount(profile) {
  return profile.count * 3;
}

export function getStarPositionByteCount(profile) {
  return getStarPositionFloatCount(profile) * Float32Array.BYTES_PER_ELEMENT;
}

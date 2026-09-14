const HIGH_PROFILE = Object.freeze({
  quality: 'high',
  textureWidth: 512,
  textureHeight: 256,
  octaveCount: 5,
  widthSegments: 48,
  heightSegments: 24,
});

const LOW_PROFILE = Object.freeze({
  quality: 'low',
  textureWidth: 256,
  textureHeight: 128,
  octaveCount: 4,
  widthSegments: 28,
  heightSegments: 14,
});

export const CLOUD_QUALITY_PROFILES = Object.freeze({
  high: HIGH_PROFILE,
  low: LOW_PROFILE,
});

export function getCloudQualityProfile(quality) {
  return CLOUD_QUALITY_PROFILES[quality] ?? LOW_PROFILE;
}

export function getCloudSphereTriangleCount(profile) {
  return profile.widthSegments * 2 * (profile.heightSegments - 1);
}

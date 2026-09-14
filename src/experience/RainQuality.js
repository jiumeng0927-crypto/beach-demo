export const RAIN_VERTICES_PER_DROP = 6;
export const RAIN_SEGMENTS_PER_DROP = RAIN_VERTICES_PER_DROP / 2;
export const RAIN_POSITION_FLOATS_PER_DROP = RAIN_VERTICES_PER_DROP * 3;

const RAIN_RESIDENT_FLOATS_PER_DROP =
  RAIN_POSITION_FLOATS_PER_DROP * 2 + 1 + 1 + 1 + 3;
const RAIN_GPU_FLOATS_PER_DROP = RAIN_POSITION_FLOATS_PER_DROP * 2;
const FLOAT_BYTES = Float32Array.BYTES_PER_ELEMENT;

export const RAIN_QUALITY_PROFILES = Object.freeze({
  high: Object.freeze({
    quality: 'high',
    count: 1100,
    radius: 27,
    splashDuration: 0.21,
    opacity: 0.5,
  }),
  low: Object.freeze({
    quality: 'low',
    count: 520,
    radius: 22,
    splashDuration: 0.16,
    opacity: 0.42,
  }),
});

export function getRainQualityProfile(quality) {
  return RAIN_QUALITY_PROFILES[quality] ?? RAIN_QUALITY_PROFILES.low;
}

function resolveProfile(profileOrQuality) {
  return typeof profileOrQuality === 'string'
    ? getRainQualityProfile(profileOrQuality)
    : profileOrQuality;
}

export function getRainPositionCount(profileOrQuality) {
  return resolveProfile(profileOrQuality).count * RAIN_VERTICES_PER_DROP;
}

export function getRainResidentFloatCount(profileOrQuality) {
  return resolveProfile(profileOrQuality).count * RAIN_RESIDENT_FLOATS_PER_DROP;
}

export function getRainResidentByteCount(profileOrQuality) {
  return getRainResidentFloatCount(profileOrQuality) * FLOAT_BYTES;
}

export function getRainGpuAttributeByteCount(profileOrQuality) {
  return resolveProfile(profileOrQuality).count * RAIN_GPU_FLOATS_PER_DROP * FLOAT_BYTES;
}

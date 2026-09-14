export const DEFAULT_WIND_STRENGTH = 0.6;
export const MAX_WIND_STRENGTH = 1.2;
export const COASTAL_WIND_BASE_DRIFT_X = 1.8;
export const COASTAL_WIND_BASE_DRIFT_Z = -0.55;

const WIND_RESPONSE = 3.6;

function clampStrength(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(MAX_WIND_STRENGTH, Math.max(0, number));
}

/**
 * Produces one allocation-free wind frame shared by every moving subsystem.
 * A strength of 0.6 maps to the scene's original authored motion.
 */
export class CoastalWind {
  constructor(strength = DEFAULT_WIND_STRENGTH) {
    const initial = clampStrength(strength, DEFAULT_WIND_STRENGTH);
    this.targetStrength = initial;
    this.effectiveStrength = initial;
    this.phase = 0;
    this.frame = {
      targetStrength: initial,
      effectiveStrength: initial,
      factor: initial / DEFAULT_WIND_STRENGTH,
      phase: 0,
      driftX: COASTAL_WIND_BASE_DRIFT_X,
      driftZ: COASTAL_WIND_BASE_DRIFT_Z,
    };
    this.refreshFrame();
  }

  setStrength(value, { immediate = false } = {}) {
    this.targetStrength = clampStrength(value, this.targetStrength);
    if (immediate) this.effectiveStrength = this.targetStrength;
    this.refreshFrame();
    return this.getDebugState();
  }

  update(delta = 0) {
    const safeDelta = Number.isFinite(delta) ? Math.max(0, delta) : 0;
    const blend = 1 - Math.exp(-safeDelta * WIND_RESPONSE);
    this.effectiveStrength +=
      (this.targetStrength - this.effectiveStrength) * blend;
    const factor = this.effectiveStrength / DEFAULT_WIND_STRENGTH;
    this.phase += safeDelta * factor;
    this.refreshFrame();
    return this.frame;
  }

  refreshFrame() {
    const factor = this.effectiveStrength / DEFAULT_WIND_STRENGTH;
    this.frame.targetStrength = this.targetStrength;
    this.frame.effectiveStrength = this.effectiveStrength;
    this.frame.factor = factor;
    this.frame.phase = this.phase;
    this.frame.driftX = factor === 0 ? 0 : COASTAL_WIND_BASE_DRIFT_X * factor;
    this.frame.driftZ = factor === 0 ? 0 : COASTAL_WIND_BASE_DRIFT_Z * factor;
  }

  getDebugState() {
    return {
      targetStrength: Number(this.targetStrength.toFixed(3)),
      effectiveStrength: Number(this.effectiveStrength.toFixed(3)),
      factor: Number(this.frame.factor.toFixed(3)),
      phase: Number(this.phase.toFixed(3)),
      driftX: Number(this.frame.driftX.toFixed(3)),
      driftZ: Number(this.frame.driftZ.toFixed(3)),
    };
  }
}

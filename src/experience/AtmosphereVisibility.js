export const ATMOSPHERE_VISIBILITY_THRESHOLD = 0.002;

export function hasVisibleAtmosphereContribution(value) {
  return (
    Number.isFinite(value) && value > ATMOSPHERE_VISIBILITY_THRESHOLD
  );
}

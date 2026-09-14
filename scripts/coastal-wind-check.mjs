import assert from 'node:assert/strict';

import {
  CoastalWind,
  DEFAULT_WIND_STRENGTH,
  MAX_WIND_STRENGTH,
} from '../src/experience/CoastalWind.js';

const wind = new CoastalWind();
const initial = wind.getDebugState();
assert.equal(initial.targetStrength, DEFAULT_WIND_STRENGTH);
assert.equal(initial.effectiveStrength, DEFAULT_WIND_STRENGTH);
assert.equal(initial.factor, 1);
assert.equal(initial.driftX, 1.8);
assert.equal(initial.driftZ, -0.55);

const firstFrame = wind.update(1);
assert.equal(firstFrame, wind.update(0), 'update should reuse one frame object');
assert.equal(wind.getDebugState().phase, 1);

wind.setStrength(0, { immediate: true });
const calmPhase = wind.getDebugState().phase;
const calmFrame = wind.update(1);
assert.equal(calmFrame.factor, 0);
assert.equal(calmFrame.driftX, 0);
assert.equal(calmFrame.driftZ, 0);
assert.equal(wind.getDebugState().phase, calmPhase, 'calm wind should freeze phase');

wind.setStrength(MAX_WIND_STRENGTH, { immediate: true });
const strongStart = wind.getDebugState().phase;
const strongFrame = wind.update(0.5);
assert.equal(strongFrame.factor, 2);
assert.equal(strongFrame.driftX, 3.6);
assert.equal(strongFrame.driftZ, -1.1);
assert.equal(wind.getDebugState().phase, strongStart + 1);

wind.setStrength(0);
const beforeBlend = wind.getDebugState().effectiveStrength;
wind.update(0.1);
const afterBlend = wind.getDebugState().effectiveStrength;
assert.ok(afterBlend > 0 && afterBlend < beforeBlend, 'wind should ease toward target');

wind.setStrength(99, { immediate: true });
assert.equal(wind.getDebugState().targetStrength, MAX_WIND_STRENGTH);
wind.setStrength(-10, { immediate: true });
assert.equal(wind.getDebugState().targetStrength, 0);
wind.setStrength(Number.NaN, { immediate: true });
assert.equal(wind.getDebugState().targetStrength, 0, 'invalid input keeps target');

console.log(
  JSON.stringify(
    {
      ok: true,
      defaultStrength: DEFAULT_WIND_STRENGTH,
      maximumStrength: MAX_WIND_STRENGTH,
      frameReused: true,
      calmPhaseFrozen: true,
      strongFactor: 2,
    },
    null,
    2,
  ),
);

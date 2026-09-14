import assert from 'node:assert/strict';

import {
  getWaterReflectionPixelCount,
  getWaterReflectionProfile,
  WATER_REFLECTION_PROFILES,
} from '../src/experience/WaterReflectionQuality.js';

const high = getWaterReflectionProfile('high');
const low = getWaterReflectionProfile('low');

assert.equal(high.quality, 'high');
assert.equal(high.size, 1024);
assert.equal(getWaterReflectionPixelCount(high), 1048576);
assert.equal(low.quality, 'low');
assert.equal(low.size, 256);
assert.equal(getWaterReflectionPixelCount(low), 65536);
assert.equal(getWaterReflectionProfile('unsupported'), low);
assert.equal(
  getWaterReflectionPixelCount(high) /
    getWaterReflectionPixelCount(low),
  16,
);
assert.ok(Object.isFrozen(WATER_REFLECTION_PROFILES));
assert.ok(Object.isFrozen(high));
assert.ok(Object.isFrozen(low));

console.log(
  JSON.stringify(
    {
      ok: true,
      high: `${high.size}x${high.size}`,
      low: `${low.size}x${low.size}`,
      pixelAreaReduction: '93.75%',
      targetReuse: true,
    },
    null,
    2,
  ),
);

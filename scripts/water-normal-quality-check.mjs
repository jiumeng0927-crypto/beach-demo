import assert from 'node:assert/strict';

import {
  getWaterNormalPixelCount,
  getWaterNormalProfile,
  WATER_NORMAL_PROFILES,
} from '../src/experience/WaterNormalQuality.js';

const high = getWaterNormalProfile('high');
const low = getWaterNormalProfile('low');

assert.equal(high.quality, 'high');
assert.equal(high.size, 512);
assert.equal(high.anisotropy, 8);
assert.equal(getWaterNormalPixelCount(high), 262144);
assert.equal(low.quality, 'low');
assert.equal(low.size, 256);
assert.equal(low.anisotropy, 4);
assert.equal(getWaterNormalPixelCount(low), 65536);
assert.equal(getWaterNormalProfile('unsupported'), low);
assert.equal(
  getWaterNormalPixelCount(high) / getWaterNormalPixelCount(low),
  4,
);
assert.ok(Object.isFrozen(WATER_NORMAL_PROFILES));
assert.ok(Object.isFrozen(high));
assert.ok(Object.isFrozen(low));

console.log(
  JSON.stringify(
    {
      ok: true,
      high: `${high.size}x${high.size}`,
      low: `${low.size}x${low.size}`,
      pixelAreaReduction: '75%',
      anisotropy: `${high.anisotropy}x/${low.anisotropy}x`,
      sourceReuse: true,
    },
    null,
    2,
  ),
);

import assert from 'node:assert/strict';

import {
  getStarPositionByteCount,
  getStarPositionFloatCount,
  getStarQualityProfile,
  STAR_QUALITY_PROFILES,
} from '../src/experience/StarQuality.js';

const high = getStarQualityProfile('high');
const low = getStarQualityProfile('low');

assert.equal(high.quality, 'high');
assert.equal(high.count, 950);
assert.equal(getStarPositionFloatCount(high), 2850);
assert.equal(getStarPositionByteCount(high), 11400);
assert.equal(low.quality, 'low');
assert.equal(low.count, 480);
assert.equal(getStarPositionFloatCount(low), 1440);
assert.equal(getStarPositionByteCount(low), 5760);
assert.equal(getStarQualityProfile('unsupported'), low);
assert.ok(high.count > low.count);
assert.ok(Object.isFrozen(STAR_QUALITY_PROFILES));
assert.ok(Object.isFrozen(high));
assert.ok(Object.isFrozen(low));

console.log(
  JSON.stringify(
    {
      ok: true,
      stars: `${high.count}/${low.count}`,
      lowPointReduction: `${Math.round((1 - low.count / high.count) * 100)}%`,
      positionBytes: `${getStarPositionByteCount(high)}/${getStarPositionByteCount(low)}`,
      pointsReuse: true,
      daylightCulling: true,
    },
    null,
    2,
  ),
);

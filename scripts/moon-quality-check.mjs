import assert from 'node:assert/strict';

import {
  getMoonCraterCount,
  getMoonPixelCount,
  getMoonQualityProfile,
  getMoonTriangleCount,
  getMoonVertexCount,
  MOON_QUALITY_PROFILES,
} from '../src/experience/MoonQuality.js';

const high = getMoonQualityProfile('high');
const low = getMoonQualityProfile('low');

assert.equal(high.quality, 'high');
assert.equal(high.size, 256);
assert.equal(getMoonPixelCount(high), 65536);
assert.equal(getMoonCraterCount(high), 46);
assert.equal(high.widthSegments, 28);
assert.equal(high.heightSegments, 20);
assert.equal(getMoonVertexCount(high), 609);
assert.equal(getMoonTriangleCount(high), 1064);
assert.equal(low.quality, 'low');
assert.equal(low.size, 128);
assert.equal(getMoonPixelCount(low), 16384);
assert.equal(getMoonCraterCount(low), 23);
assert.equal(low.widthSegments, 18);
assert.equal(low.heightSegments, 12);
assert.equal(getMoonVertexCount(low), 247);
assert.equal(getMoonTriangleCount(low), 396);
assert.equal(getMoonQualityProfile('unsupported'), low);
assert.equal(getMoonPixelCount(high) / getMoonPixelCount(low), 4);
assert.ok(Object.isFrozen(MOON_QUALITY_PROFILES));
assert.ok(Object.isFrozen(high));
assert.ok(Object.isFrozen(low));

console.log(
  JSON.stringify(
    {
      ok: true,
      high: `${high.size}x${high.size}`,
      low: `${low.size}x${low.size}`,
      pixelAreaReduction: '75%',
      craters: `${getMoonCraterCount(high)}/${getMoonCraterCount(low)}`,
      geometry: `${getMoonTriangleCount(high)}/${getMoonTriangleCount(low)} triangles`,
      triangleReduction: `${Math.round(
        (1 - getMoonTriangleCount(low) / getMoonTriangleCount(high)) * 100,
      )}%`,
      meshReuse: true,
    },
    null,
    2,
  ),
);

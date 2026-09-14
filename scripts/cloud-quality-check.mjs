import assert from 'node:assert/strict';

import {
  CLOUD_QUALITY_PROFILES,
  getCloudQualityProfile,
  getCloudSphereTriangleCount,
} from '../src/experience/CloudQuality.js';

const high = getCloudQualityProfile('high');
const low = getCloudQualityProfile('low');

assert.equal(high.textureWidth, 512);
assert.equal(high.textureHeight, 256);
assert.equal(high.octaveCount, 5);
assert.equal(high.widthSegments, 48);
assert.equal(high.heightSegments, 24);
assert.equal(getCloudSphereTriangleCount(high), 2208);

assert.equal(low.textureWidth, 256);
assert.equal(low.textureHeight, 128);
assert.equal(low.octaveCount, 4);
assert.equal(low.widthSegments, 28);
assert.equal(low.heightSegments, 14);
assert.equal(getCloudSphereTriangleCount(low), 728);

assert.equal(getCloudQualityProfile('unsupported'), low);
assert.ok(Object.isFrozen(CLOUD_QUALITY_PROFILES));
assert.ok(Object.isFrozen(high));
assert.ok(Object.isFrozen(low));
assert.equal(high.textureWidth / low.textureWidth, 2);
assert.equal(
  (high.textureWidth * high.textureHeight) /
    (low.textureWidth * low.textureHeight),
  4,
);
assert.ok(
  getCloudSphereTriangleCount(high) > getCloudSphereTriangleCount(low) * 3,
);

console.log(
  JSON.stringify(
    {
      ok: true,
      high: {
        texture: `${high.textureWidth}x${high.textureHeight}`,
        triangles: getCloudSphereTriangleCount(high),
      },
      low: {
        texture: `${low.textureWidth}x${low.textureHeight}`,
        triangles: getCloudSphereTriangleCount(low),
      },
      textureAreaReduction: '75%',
      triangleReduction: '67%',
    },
    null,
    2,
  ),
);

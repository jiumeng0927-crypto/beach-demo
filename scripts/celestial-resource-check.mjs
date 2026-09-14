import assert from 'node:assert/strict';

import {
  CELESTIAL_GLOW_TEXTURE_SIZE,
  CELESTIAL_RESOURCE_PROFILES,
  getCelestialResourceProfile,
} from '../src/experience/CelestialResources.js';

const high = getCelestialResourceProfile('high');
const low = getCelestialResourceProfile('low');

assert.equal(getCelestialResourceProfile('unsupported'), low);
assert.ok(Object.isFrozen(CELESTIAL_RESOURCE_PROFILES));
assert.ok(Object.isFrozen(high));
assert.ok(Object.isFrozen(low));
assert.equal(CELESTIAL_GLOW_TEXTURE_SIZE, 128);

assert.deepEqual(high, {
  quality: 'high',
  moonTextureBytes: 262_144,
  glowTextureBytes: 65_536,
  moonGeometryBytes: 25_872,
  starPositionBytes: 11_400,
  totalPayloadBytes: 364_952,
});
assert.deepEqual(low, {
  quality: 'low',
  moonTextureBytes: 65_536,
  glowTextureBytes: 65_536,
  moonGeometryBytes: 10_280,
  starPositionBytes: 5_760,
  totalPayloadBytes: 147_112,
});

console.log(
  JSON.stringify(
    {
      ok: true,
      defaultResidentBytes: 0,
      deferredPayloadBytes: {
        high: high.totalPayloadBytes,
        low: low.totalPayloadBytes,
      },
      firstVisibleNightAllocation: true,
      sceneAppearancePreserved: true,
    },
    null,
    2,
  ),
);

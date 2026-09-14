import assert from 'node:assert/strict';

import {
  ATMOSPHERE_VISIBILITY_THRESHOLD,
  hasVisibleAtmosphereContribution,
} from '../src/experience/AtmosphereVisibility.js';

assert.equal(ATMOSPHERE_VISIBILITY_THRESHOLD, 0.002);
assert.equal(hasVisibleAtmosphereContribution(Number.NaN), false);
assert.equal(hasVisibleAtmosphereContribution(Number.POSITIVE_INFINITY), false);
assert.equal(hasVisibleAtmosphereContribution(-1), false);
assert.equal(hasVisibleAtmosphereContribution(0), false);
assert.equal(
  hasVisibleAtmosphereContribution(ATMOSPHERE_VISIBILITY_THRESHOLD),
  false,
);
assert.equal(hasVisibleAtmosphereContribution(0.0021), true);
assert.equal(hasVisibleAtmosphereContribution(0.02), true);
assert.equal(hasVisibleAtmosphereContribution(0.1), true);
assert.equal(hasVisibleAtmosphereContribution(1), true);

console.log(
  JSON.stringify(
    {
      ok: true,
      threshold: ATMOSPHERE_VISIBILITY_THRESHOLD,
      daylightLanternCulling: true,
      desktopDefaultDrawCallSaving: 2,
      desktopDefaultTriangleSaving: 170,
      mobileLightCollectionSaving: true,
      dawnAndNightPreserved: true,
    },
    null,
    2,
  ),
);

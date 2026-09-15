import assert from 'node:assert/strict';
import { createStreetProfile, streetCenterZ, STREET_HALF_LENGTH, STREET_SHOPS, STREET_WALK_MAX_Z } from '../src/experience/CoastalStreet.js';
import { terrainHeight } from '../src/experience/world.js';
import { coastContinuationHeight } from '../src/experience/CoastBoundary.js';
import { OCEAN_FRAGMENT_SHADER } from '../src/experience/OceanWater.js';

for (const quality of ['high', 'low']) {
  const profile = createStreetProfile(terrainHeight, quality);
  assert.deepEqual(profile.samples, createStreetProfile(terrainHeight, quality).samples);
  assert.ok(profile.samples.length <= 53);
  assert.equal(profile.samples[0].x, -STREET_HALF_LENGTH); assert.equal(profile.samples.at(-1).x, STREET_HALF_LENGTH);
  assert.equal(profile.sampleAt(-STREET_HALF_LENGTH - 1), null); assert.equal(profile.sampleAt(STREET_HALF_LENGTH + 1), null);
  for (let i = 0; i < profile.samples.length; i++) {
    const p = profile.samples[i];
    assert.ok([p.x, p.y, p.z].every(Number.isFinite));
    if (i) assert.ok(p.x > profile.samples[i - 1].x);
    assert.equal(p.z, streetCenterZ(p.x));
    for (let d = -7; d <= 7; d++) assert.ok(p.y >= coastContinuationHeight(p.x, p.z + d, terrainHeight) + 0.1599);
    assert.ok(Math.abs(profile.sampleAt(p.x).y - p.y) < 1e-10);
  }
  for (let x = -45; x <= 45; x += 0.5) {
    const p = profile.sampleAt(x);
    for (let offset = -6; offset <= 6; offset++) assert.ok(p.y > terrainHeight(x, p.z + offset) + 0.10, 'Road cannot intersect undisturbed dunes');
  }
}
assert.equal(STREET_SHOPS.length, 3);
for (const s of STREET_SHOPS) {
  assert.ok(Math.abs(s.x) + s.width / 2 < 45);
  assert.ok(s.z + s.depth / 2 < STREET_WALK_MAX_Z);
  assert.ok(s.z - s.depth / 2 > streetCenterZ(s.x) + 7, 'Shops cannot intrude on the road');
}
assert.ok(coastContinuationHeight(160, 105, terrainHeight) < -3);
assert.ok(coastContinuationHeight(0, 145, terrainHeight) < -3);
const shader = OCEAN_FRAGMENT_SHADER;
assert.ok(shader.lastIndexOf('mix(gl_FragColor.rgb, fogColor') > shader.indexOf('#include <colorspace_fragment>'));
assert.ok(!shader.includes('color = mix(color, fogColor'), 'Output-space haze cannot re-enter linear lighting');
assert.ok(shader.includes('float mediumDetail') && shader.includes('float fineDetail'));
console.log('PASS: street sampling, terrain clearance, reachable shop placement, no road overlap, ocean fog ordering');

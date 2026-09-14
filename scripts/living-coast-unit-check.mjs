import assert from 'node:assert/strict';
import { CoastalClock } from '../src/experience/CoastalClock.js';
import { CollectionCampaign, COLLECTION_SAVE_KEY } from '../src/experience/CollectionCampaign.js';

const clock = new CoastalClock();
clock.update(1800); assert.equal(clock.hour, 12); assert.equal(clock.days, 1);
clock.running = false; clock.update(600); assert.equal(clock.hour, 12);
clock.running = true; clock.update(NaN); clock.update(-1); assert.equal(clock.hour, 12);
for (const period of ['day', 'dawn', 'night', 'sunset']) {
  assert.equal(clock.seek(period), true); assert.ok(Number.isFinite(clock.sample().blend));
}
assert.equal(clock.seek('invalid'), false);
clock.hour = 23.9999; const before = clock.sample(); clock.update(.02);
assert.equal(before.to, 'night'); assert.equal(clock.sample().from, 'night');
const slow = new CoastalClock(), fast = new CoastalClock();
for (let i = 0; i < 600; i++) slow.update(.1);
fast.update(60); assert.ok(Math.abs(slow.hour - fast.hour) < 1e-10, 'Frame-independent clock');

const sites = Array.from({ length: 6 }, (_, i) => ({ id: `glass-${i}`, name: `Glass ${i}` }));
const data = new Map(); const storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
let campaign = new CollectionCampaign(sites, storage);
assert.equal(campaign.next(), false);
assert.equal(campaign.collect(-1, 0), false); assert.equal(campaign.collect(6, 0), false);
for (let i = 0; i < 6; i++) assert.equal(campaign.collect(i, 0), true);
assert.equal(campaign.collect(0, 0), false); assert.equal(campaign.getState().completed, false);
assert.equal(campaign.next(), true);
assert.equal(campaign.collect(0, .3), false);
assert.equal(campaign.collect(0, -.3), true);
campaign = new CollectionCampaign(sites, storage);
assert.equal(campaign.chapter, 1); assert.equal(campaign.getState().overallCollected, 7);
for (let i = 1; i < 6; i++) assert.equal(campaign.collect(i, -.3), true);
assert.equal(campaign.next(), true);
for (let i = 0; i < 6; i++) campaign.collect(i, .8);
assert.equal(campaign.getState().completed, true); assert.equal(campaign.getState().badges.length, 3);
assert.equal(campaign.next(), false);
campaign.reset(); assert.equal(campaign.chapter, 0); assert.equal(campaign.getState().overallCollected, 0);
storage.setItem(COLLECTION_SAVE_KEY, '{broken');
assert.equal(new CollectionCampaign(sites, storage).chapter, 0);
storage.setItem(COLLECTION_SAVE_KEY, JSON.stringify({ version: 1, chapter: 2, found: ['shell-0', 'bottle-0', 'unknown'], rewardClaimed: true }));
const invalid = new CollectionCampaign(sites, storage);
assert.equal(invalid.chapter, 0); assert.equal(invalid.found.size, 0); assert.equal(invalid.rewardClaimed, false);
const denied = new CollectionCampaign(sites, { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } });
assert.equal(denied.collect(0, 0), true); assert.equal(denied.saved, false);
console.log('PASS: continuous clock, 18-site chapters, tide gates, idempotency, save/reload, corrupt/denied storage');

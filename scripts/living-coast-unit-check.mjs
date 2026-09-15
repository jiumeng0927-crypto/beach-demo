import assert from 'node:assert/strict';
import { CoastalClock } from '../src/experience/CoastalClock.js';
import { CollectionCampaign, COLLECTION_SAVE_KEY } from '../src/experience/CollectionCampaign.js';
import { CoastalCommissionBoard, COMMISSION_SAVE_KEY } from '../src/experience/CoastalCommissionBoard.js';
import { CoastalCommunity, COMMUNITY_SAVE_KEY } from '../src/experience/CoastalCommunity.js';

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
assert.equal(campaign.getState().economy.inventory.glass, 6);
assert.deepEqual(campaign.sell('glass'), { sold: { glass: 6 }, earned: 48, coins: 48 });
assert.deepEqual(campaign.buy('tide-map'), { id: 'tide-map', name: '潮汐图谱', price: 16, coins: 32 });
assert.equal(campaign.buy('tide-map'), null); assert.equal(campaign.sell('glass'), null);
assert.equal(campaign.next(), true);
assert.equal(campaign.collect(0, .3), false);
assert.equal(campaign.collect(0, -.3), true);
campaign = new CollectionCampaign(sites, storage);
assert.equal(campaign.chapter, 1); assert.equal(campaign.getState().overallCollected, 7);
assert.equal(campaign.getState().economy.inventory.shell, 1);
assert.equal(campaign.getState().economy.coins, 32);
assert.deepEqual(campaign.getState().economy.purchases, ['tide-map']);
for (let i = 1; i < 6; i++) assert.equal(campaign.collect(i, -.3), true);
assert.equal(campaign.sell('shell').earned, 36); assert.equal(campaign.buy('field-bag').coins, 44);
assert.equal(campaign.next(), true);
for (let i = 0; i < 6; i++) campaign.collect(i, .8);
assert.equal(campaign.getState().completed, true); assert.equal(campaign.getState().badges.length, 3);
assert.deepEqual(campaign.getState().economy.saleValues, { glass: 10, shell: 8, bottle: 6 });
assert.equal(campaign.sell('bottle').earned, 36); assert.equal(campaign.buy('coast-pin').coins, 44);
assert.equal(campaign.next(), false);
campaign.reset(); assert.equal(campaign.chapter, 0); assert.equal(campaign.getState().overallCollected, 0);
assert.deepEqual(campaign.getState().economy, { coins: 0, inventory: { glass: 0, shell: 0, bottle: 0 }, inventoryTotal: 0,
  purchases: [], saleValues: { glass: 8, shell: 6, bottle: 4 }, products: campaign.getState().economy.products });
storage.setItem(COLLECTION_SAVE_KEY, '{broken');
assert.equal(new CollectionCampaign(sites, storage).chapter, 0);
storage.setItem(COLLECTION_SAVE_KEY, JSON.stringify({ version: 1, chapter: 1,
  found: sites.map(site => site.id), rewardClaimed: false }));
const migrated = new CollectionCampaign(sites, storage);
assert.equal(migrated.chapter, 1); assert.equal(migrated.getState().economy.inventory.glass, 6);
storage.setItem(COLLECTION_SAVE_KEY, JSON.stringify({ version: 1, chapter: 2, found: ['shell-0', 'bottle-0', 'unknown'], rewardClaimed: true }));
const invalid = new CollectionCampaign(sites, storage);
assert.equal(invalid.chapter, 0); assert.equal(invalid.found.size, 0); assert.equal(invalid.rewardClaimed, false);
const denied = new CollectionCampaign(sites, { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } });
assert.equal(denied.collect(0, 0), true); assert.equal(denied.saved, false);
const deliveryCampaign = new CollectionCampaign(sites);
assert.equal(deliveryCampaign.collect(0, 0), true); assert.equal(deliveryCampaign.collect(1, 0), true);
assert.deepEqual(deliveryCampaign.deliver('glass', 2, 20, 'test-order'), {
  source: 'test-order', delivered: { glass: 2 }, count: 2, earned: 20, coins: 20,
});
assert.equal(deliveryCampaign.deliver('glass', 1, 8), null);

const rewards = [];
let commissions = new CoastalCommissionBoard({ storage, grantReward: (amount, task) => {
  rewards.push({ amount, id: task.id }); return true;
} });
assert.deepEqual(commissions.getState().tasks.map(task => task.id), ['tide-watch', 'sand-break', 'sunset-frame']);
assert.equal(commissions.record('low-tide'), true);
assert.equal(commissions.record('low-tide'), false);
assert.equal(commissions.record('billiards-shot'), true);
assert.equal(commissions.claim('sand-break'), null);
assert.equal(commissions.record('billiards-shot', 4), true);
assert.equal(commissions.claim('sand-break').reward, 12);
assert.deepEqual(rewards, [{ amount: 12, id: 'sand-break' }]);
assert.equal(commissions.claim('sand-break'), null);
commissions = new CoastalCommissionBoard({ storage, grantReward: () => true });
assert.equal(commissions.getState().tasks.find(task => task.id === 'sand-break').claimed, true);
assert.equal(commissions.syncDay(1), true);
assert.deepEqual(commissions.getState().tasks.map(task => task.id), ['shore-clean', 'market-delivery', 'rain-patrol']);
assert.equal(commissions.record('collect-item', 2), true);
assert.equal(commissions.record('sell-item', 1), true);
assert.equal(commissions.record('rain-walk-second', 15), true);
assert.equal(commissions.getState().completed, 2);
assert.equal(commissions.syncDay(1), false);
assert.equal(commissions.syncDay(2), true);
assert.deepEqual(commissions.getState().tasks.map(task => task.id), ['pocket-practice', 'local-customer', 'tide-watch']);
storage.setItem(COMMISSION_SAVE_KEY, '{broken');
assert.equal(new CoastalCommissionBoard({ storage }).getState().day, 0);
const deniedCommissions = new CoastalCommissionBoard({ storage: { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } } });
assert.equal(deniedCommissions.record('low-tide'), true); assert.equal(deniedCommissions.saved, false);

const deliveries = [];
const npcIds = ['lin', 'ning', 'ran', 'yu', 'qing', 'fan', 'mei', 'hao', 'le'];
let community = new CoastalCommunity({ storage, npcIds, fulfillOrder: order => {
  deliveries.push(order); return { coins: order.reward };
} });
assert.deepEqual(community.getState().orders.map(order => order.id), ['lin-glass', 'ning-shell', 'ran-bottle']);
assert.equal(community.meet('lin'), true); assert.equal(community.meet('lin'), false);
assert.equal(community.meet('unknown'), false); assert.equal(community.getState().reputation, 1);
assert.equal(community.fulfill('lin-glass', { glass: 1 }), null);
assert.equal(community.fulfill('lin-glass', { glass: 2 }).order.reward, 20);
assert.equal(community.fulfill('lin-glass', { glass: 2 }), null);
assert.equal(deliveries.length, 1);
assert.equal(community.getRelationship('lin').affinity, 3);
community = new CoastalCommunity({ storage, npcIds, fulfillOrder: order => ({ coins: order.reward }) });
assert.equal(community.getState().completed, 1); assert.equal(community.getState().reputation, 3);
assert.equal(community.meet('ning'), true); assert.equal(community.getState().level, '熟面孔');
assert.equal(community.getState().orderBonus, 2);
assert.equal(community.getState().orders.find(order => order.id === 'lin-glass').reward, 20);
assert.equal(community.syncDay(1), true); assert.equal(community.getState().completed, 0);
assert.equal(community.getState().reputation, 4); assert.equal(community.getRelationship('lin').affinity, 3);
assert.deepEqual(community.getState().orders.map(order => order.id), ['yu-glass', 'qing-shell', 'fan-bottle']);
assert.equal(community.getState({ glass: 3 }).orders[0].reward, 30);
assert.equal(community.fulfill('yu-glass', { glass: 3 }).order.reward, 30);
assert.equal(community.getState().reputation, 6);
storage.setItem(COMMUNITY_SAVE_KEY, '{broken');
assert.equal(new CoastalCommunity({ storage, npcIds }).getState().reputation, 0);
const deniedCommunity = new CoastalCommunity({ storage: { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } }, npcIds });
assert.equal(deniedCommunity.meet('lin'), true); assert.equal(deniedCommunity.saved, false);
console.log('PASS: continuous clock, collection economy, daily commissions/orders, relationships, save migration, corrupt/denied storage');

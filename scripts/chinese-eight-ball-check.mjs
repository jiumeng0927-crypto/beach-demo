import assert from 'node:assert/strict';
import { ChineseEightBallRules as Rules } from '../src/experience/ChineseEightBallRules.js';

const legal = { first: 1, rails: [1, 2, 3, 4], railAfterContact: true };
const open = () => { const r = new Rules(); r.settle(legal); return r; };
let count = 0;
function test(name, run) { run(); count++; console.log(`PASS ${name}`); }
test('legal empty break changes player, table remains open', () => {
  const r = open(); assert.equal(r.player, 1); assert.deepEqual(r.groups, [null, null]);
});
test('break pot does not assign group; opening eight is respotted', () => {
  const r = new Rules(); assert.deepEqual(r.settle({ ...legal, pocketed: [8, 9] }).respot, [8]);
  assert.equal(r.player, 0); assert.equal(r.down.has(8), false); assert.deepEqual(r.groups, [null, null]);
});
test('first legal post-break pot assigns both groups and continues', () => {
  const r = open(); r.settle({ first: 2, pocketed: [2] });
  assert.deepEqual(r.groups, ['stripe', 'solid']); assert.equal(r.player, 1);
});
test('open-table cross-group combination does not close table', () => {
  const r = open(); r.settle({ first: 2, pocketed: [9] });
  assert.deepEqual(r.groups, [null, null]); assert.equal(r.player, 0); assert.equal(r.fouls, 0);
});
test('mixed legal pots assign first-contact group', () => {
  const r = open(); r.settle({ first: 10, pocketed: [2, 10] }); assert.equal(r.groups[1], 'stripe');
});
for (const [name, shot] of Object.entries({ scratch: { first: 1, pocketed: [0, 1] },
  miss: {}, wrongEight: { first: 8, railAfterContact: true },
  noRail: { first: 1 }, kitchen: { first: 1, railAfterContact: true, kitchenViolation: true },
  offTable: { first: 1, offTable: [3] } })) {
  test(`${name} gives opponent ball in hand`, () => {
    const r = open(); r.settle(shot); assert.equal(r.player, 0); assert.equal(r.hand, 'table'); assert.equal(r.fouls, 1);
  });
}
test('wrong group foul despite own pot', () => {
  const r = open(); r.groups = ['stripe', 'solid']; r.settle({ first: 9, pocketed: [1] });
  assert.equal(r.player, 0); assert.equal(r.hand, 'table');
});
test('legal safety switches, legal own pot continues', () => {
  const r = open(); r.groups = ['stripe', 'solid']; r.settle({ first: 1, pocketed: [1] });
  assert.equal(r.player, 1); r.settle({ first: 2, railAfterContact: true }); assert.equal(r.player, 0);
});
test('early eight and same-shot last ball/eight lose', () => {
  for (const prior of [[], [1, 2, 3, 4, 5, 6]]) {
    const r = open(); r.groups = ['stripe', 'solid']; r.down = new Set(prior);
    r.settle({ first: 7, pocketed: [7, 8] }); assert.equal(r.winner, 0);
  }
});
test('eight wins only after group was cleared on an earlier shot', () => {
  const r = open(); r.groups = ['stripe', 'solid']; r.down = new Set([1, 2, 3, 4, 5, 6, 7]);
  assert.equal(r.legalFirst(8), true); r.settle({ first: 8, pocketed: [8] }); assert.equal(r.winner, 1);
});
test('scratch with eight loses, scratch without eight does not', () => {
  for (const pots of [[0, 8], [0]]) {
    const r = open(); r.groups = ['stripe', 'solid']; r.down = new Set([1, 2, 3, 4, 5, 6, 7]);
    r.settle({ first: 8, pocketed: pots }); assert.equal(r.winner, pots.length === 2 ? 0 : null);
  }
});
test('illegal break has three choices and second warned failure loses', () => {
  for (const choice of ['accept', 'rebreak', 'opponent-rebreak']) {
    const r = new Rules(); r.settle({ first: 1 }); assert.equal(r.pending, 'illegal-break');
    const result = r.choose(choice); assert.equal(result.rerack, choice !== 'accept');
    if (choice === 'accept') assert.equal(r.hand, 'table');
    if (choice === 'opponent-rebreak') { r.settle({ first: 1 }); assert.equal(r.winner, 1); }
  }
});
test('opening scratch is kitchen hand; eight foul can accept or take kitchen hand', () => {
  const r = new Rules(); r.settle({ ...legal, pocketed: [0] }); assert.equal(r.hand, 'kitchen');
  const other = new Rules(); other.settle({ ...legal, pocketed: [8], offTable: [3] });
  assert.equal(other.pending, 'break-eight-foul'); other.choose('kitchen'); assert.equal(other.hand, 'kitchen');
});
console.log(JSON.stringify({ ok: true, cases: count }));

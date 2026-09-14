import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BeachBilliardsGame } from '../src/experience/BeachBilliardsGame.js';
import { RAILS, TABLE, POCKET_GEOMETRY } from '../src/experience/billiardsTable.js';

class Canvas extends EventTarget { classList = { toggle() {}, remove() {} }; }
const game = new BeachBilliardsGame({ scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), domElement: new Canvas() });
await game.setEnabled(true);
assert.equal(game.initialized, true);
const reset = (targets = 0) => {
  game.reset(); game.rules.hand = null; game.rules.breaking = false;
  game.setCueView(true);
  game.setShotSettings({ tipX: 0, tipY: 0, sliding: 0.2, rolling: 0.01 });
  game.balls.slice(targets + 1).forEach((b) => { game.world.removeBody(b.body); b.active = false; });
};
const position = (index, x, z) => {
  const body = game.balls[index].body;
  body.position.set(x, 0, z); body.previousPosition.copy(body.position); body.aabbNeedsUpdate = true;
  return body;
};
const tick = (seconds, fps = 240) => { for (let i = 0; i < seconds * fps; i++) game.update(1 / fps); };

for (const body of game.wallBodies) {
  assert.ok(body.aabb.contains({ lowerBound: body.position, upperBound: body.position }), 'Static AABB must include its actual world position');
  assert.equal(body.shapes.length, 3, 'Every rail needs its two rounded jaw collision shapes');
}
let banks = 0, jaws = 0;
for (const { mouth: [mx, mz], width } of POCKET_GEOMETRY) {
  const nearest = RAILS.flatMap((r) => r.jaws).toSorted((a, b) =>
    Math.hypot(a[0] - mx, a[1] - mz) - Math.hypot(b[0] - mx, b[1] - mz)).slice(0, 2);
  const measured = Math.hypot(nearest[0][0] - nearest[1][0], nearest[0][1] - nearest[1][1]) - 2 * TABLE.jawRadius;
  assert.ok(Math.abs(measured - width) < 1e-10, 'Pocket width must be measured between jaw noses');
}
for (const fps of [20, 30, 60, 120, 240]) {
  for (const rail of RAILS) {
    for (const power of [0.5, 1]) {
    reset();
    const [x, z] = rail.center;
    const nx = rail.size[0] < rail.size[1] ? Math.sign(x) : 0;
    const nz = nx ? 0 : Math.sign(z);
    const cue = position(0, x - nx * 0.65, z - nz * 0.65);
    assert.equal(game.shoot(nx, nz, power), true);
    tick(0.4, fps);
    assert.ok(cue.velocity.x * nx + cue.velocity.z * nz < -0.5, `${fps}fps rail ${x},${z} must rebound`);
    assert.ok(Math.abs(cue.position.x) < TABLE.halfWidth && Math.abs(cue.position.z) < TABLE.halfDepth);
    banks++;
    }
  }
  for (const { normal: [nx, nz], mouth: [mx, mz], width } of POCKET_GEOMETRY) {
    for (const side of [-1, 1]) {
      reset();
      const offset = side * (width / 2 + TABLE.jawRadius);
      const cue = position(0, mx - nx * 0.5 - nz * offset, mz - nz * 0.5 + nx * offset);
      game.shoot(nx, nz, 0.4);
      tick(0.6, fps);
      assert.ok(game.balls[0].active && !game.shot?.pocketed.includes(0), 'Jaw miss must not be swallowed');
      assert.ok(cue.velocity.x * nx + cue.velocity.z * nz < 0, `${fps}fps jaw must reject a wide shot`);
      jaws++;
    }
  }
}

const drawFollow = (tipY) => {
  reset(1); position(0, -0.48, 0); position(1, 0, 0);
  game.setShotSettings({ tipY }); game.shoot(1, 0, 0.45);
  tick(0.4);
  return { velocity: game.balls[0].body.velocity.x, x: game.balls[0].body.position.x, first: game.shot?.first };
};
const draw = drawFollow(-0.85), follow = drawFollow(0.85);
console.log('Draw / follow:', draw, follow);
assert.equal(draw.first, 1); assert.equal(follow.first, 1);
assert.ok(draw.velocity < -0.1 && follow.velocity > 0.1, 'Low cue must draw back; high cue must follow after contact');

const english = (tipX) => {
  reset(); const cue = position(0, -1, 0.8);
  game.setShotSettings({ tipX }); game.shoot(0, 1, 0.45); tick(0.6);
  return { vx: cue.velocity.x, vz: cue.velocity.z, spin: cue.angularVelocity.y };
};
const left = english(-0.8), right = english(0.8), center = english(0);
console.log('Left / right / center bank:', left, right, center);
assert.ok(left.vx * right.vx < 0 && Math.abs(left.vx) > 0.1 && Math.abs(right.vx) > 0.1);
assert.ok(Math.abs(left.vx + right.vx) < 0.03 && Math.abs(center.vx) < 0.01, 'English rebound must be mirror symmetric');

const clothRun = (rolling) => {
  reset(); const cue = position(0, -2, -0.6);
  game.setShotSettings({ rolling }); cue.velocity.set(1, 0, 0);
  cue.angularVelocity.set(0, 0, -1 / TABLE.ballRadius);
  tick(2);
  return cue.position.x + 2;
};
const fastCloth = clothRun(0.006), slowCloth = clothRun(0.02);
assert.ok(fastCloth > slowCloth + 0.4, 'Rolling coefficient must change stopping distance');
reset(); game.setShotSettings({ tipX: 1, tipY: 1 });
assert.equal(game.validCuePosition(TABLE.halfWidth - TABLE.ballRadius,
  TABLE.halfDepth - TABLE.ballRadius), false, 'Ball in hand cannot hover above a pocket shelf');
assert.ok(Math.hypot(game.cueTip.x, game.cueTip.y) <= 1.000001);
assert.equal(game.setShotSettings({ sliding: NaN }), false);
game.shoot(1, 0, 1);
assert.equal(game.setShotSettings({ rolling: 0.02 }), false, 'Do not change the cloth during a shot');
tick(70);
assert.equal(game.shot, null, 'All spin must decay and the turn must finish');
assert.ok(game.balls.every((b) => !b.active || [...b.body.position.toArray(), ...b.body.velocity.toArray()].every(Number.isFinite)));
game.dispose();
console.log(JSON.stringify({ ok: true, banks, jaws, spin: true, cloth: { fastCloth, slowCloth } }));

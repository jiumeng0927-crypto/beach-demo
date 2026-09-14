import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BeachBilliardsGame, BEACH_BILLIARDS_PROFILE as PROFILE } from '../src/experience/BeachBilliardsGame.js';
import './chinese-eight-ball-check.mjs';
import { POCKET_GEOMETRY } from '../src/experience/billiardsTable.js';
import './billiards-physics-check.mjs';

class Canvas extends EventTarget {
  classList = { toggle() {}, remove() {} };
  getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 720 }; }
}
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(47, 16 / 9, 0.1, 200);
camera.position.set(0, 8, 40);
camera.lookAt(0, 2, 31.2);
camera.updateMatrixWorld(true);
const game = new BeachBilliardsGame({ scene, camera, domElement: new Canvas() });
assert.equal(game.initialized, false);
await game.setEnabled(true);
assert.equal(game.initialized, true);
assert.equal(game.world.bodies.length, 22);
assert.equal(game.balls.length, 16);
assert.equal(PROFILE.playingSize[0] / PROFILE.playingSize[1], 2);
assert.ok(Math.abs(PROFILE.ballRadius * 2 / PROFILE.playingSize[0] - 57.15 / 2540) < 1e-10);
assert.equal(game.balls[8].spec.position[1], 0);
assert.equal(game.balls[6].spec.position[0], game.balls[15].spec.position[0]);
const reset = () => { game.reset(); game.setCueView(true); game.rules.hand = null; game.rules.breaking = false; };
const settle = (fps = 60) => {
  for (let i = 0; i < fps * 35 && game.shot; i++) game.update(1 / fps);
  assert.equal(game.shot, null, 'Shot must finish');
};

assert.equal(game.shoot(1, 0, 1), false, 'Observation cannot shoot');
game.setCueView(true); game.shoot(1, 0, 1);
settle();
console.log('Full break:', JSON.stringify(game.rules.snapshot()));
assert.ok(game.balls.slice(1).filter((b) => Math.hypot(b.body.position.x - b.spec.position[0], b.body.position.z - b.spec.position[1]) > 0.1).length >= 8);
assert.equal(game.shoot(NaN, 0, 1), false);
assert.equal(game.shoot(1, 0, Infinity), false);

reset();
const gentleStart = game.balls[0].body.position.x;
assert.equal(game.shoot(1, 0, 0.06), true);
assert.ok(game.balls[0].body.velocity.length() < 0.2, 'Minimum pull must allow a finesse shot');
assert.equal(game.shoot(1, 0, 1), false, 'Reject another shot while the current shot is active');
settle();
const gentleTravel = game.balls[0].body.position.x - gentleStart;
assert.ok(gentleTravel > 0.01 && gentleTravel < 0.4, `Gentle shot traveled ${gentleTravel}`);

// Starting in contact is not a hit when the cue moves away without moving the target.
reset();
game.balls.slice(2).forEach((b) => { game.world.removeBody(b.body); b.active = false; });
game.balls[0].body.position.set(0, 0, 0);
game.balls[1].body.position.set(PROFILE.ballRadius * 2, 0, 0);
game.balls.slice(0, 2).forEach(({ body }) => { body.aabbNeedsUpdate = true; body.previousPosition.copy(body.position); });
game.update(1 / 240);
assert.equal(game.shoot(-1, 0, 0.06), true);
settle();
assert.equal(game.rules.message, '未击中目标球');
assert.equal(game.rules.hand, 'table');
assert.ok(Math.abs(game.balls[1].body.position.x - PROFILE.ballRadius * 2) < 0.0001);

for (const fps of [20, 30, 60, 120, 240]) {
  for (const { center: [px, pz], normal: [dx, dz] } of POCKET_GEOMETRY) {
    reset();
    game.balls.slice(2).forEach((b) => { b.active = false; game.world.removeBody(b.body); });
    for (const [index, distance] of [[0, 1.8], [1, 0.8]]) {
      const b = game.balls[index].body;
      b.position.set(px - dx * distance, 0, pz - dz * distance);
      b.previousPosition.copy(b.position); b.aabbNeedsUpdate = true;
    }
    assert.equal(game.shoot(dx, dz, 0.32), true);
    settle(fps);
    assert.equal(game.balls[1].active, false, `${fps}fps pocket ${px},${pz}`);
    assert.ok(Math.hypot(game.balls[1].body.position.x - px, game.balls[1].body.position.z - pz) < 0.23);
    assert.equal(game.pocketed, 1);
  }
}

reset();
assert.equal(game.shoot(-1, 0, 0.1), true);
settle();
assert.equal(game.rules.hand, 'table');
assert.equal(game.rules.player, 1);
assert.equal(game.placingCue, true);
assert.equal(game.shoot(1, 0), false);
assert.equal(game.placeCue(10, 0), false);
assert.equal(game.placeCue(...game.balls[1].spec.position), false);
assert.equal(game.placeCue(-1, 0.5), true);
assert.equal(game.confirmCuePlacement(), true);
assert.equal(game.canAim(), false, 'Confirming placement does not arm a stroke');
game.setCueView(true);
assert.equal(game.canAim(), true);

reset(); game.shoot(1, 0, 0.2); game.pocketBall(game.balls[0]);
game.balls[1].body.position.set(-2.2, 0, 0);
game.balls[1].body.aabbNeedsUpdate = true;
settle();
assert.equal(game.fouls, 1);
assert.equal(game.balls[0].active, true);
assert.equal(game.placingCue, true);
assert.ok(game.balls[0].body.position.distanceTo(game.balls[1].body.position) >= PROFILE.ballRadius * 2);

game.reset();
game.rules.pending = 'illegal-break'; game.rules.player = 1;
assert.equal(game.chooseBreak('opponent-rebreak'), true);
assert.equal(game.rules.warnedBreaker, 0);
assert.equal(game.rules.player, 0);
assert.equal(game.balls.every((b) => b.active), true);
assert.equal(game.placeCue(0, 0), false);
assert.equal(game.placeCue(-2, 0.5), true);
game.confirmCuePlacement();
game.setCueView(true);
assert.equal(game.shoot(-1, 0), false, 'Kitchen shot must go up-table');

game.reset();
let steps = 0; const originalStep = game.world.step.bind(game.world);
game.world.step = (...args) => { steps++; originalStep(...args); };
game.update(1 / 480); assert.equal(steps, 0);
game.update(1 / 480); assert.equal(steps, 1);
game.update(10); assert.equal(steps, 13);
game.update(NaN); game.update(-1); assert.equal(steps, 13);

const objects = [game.bed, game.frame, game.pockets, game.ballMesh, game.aimLine];
const resources = [...objects.flatMap((o) => [o.geometry, o.material]), game.ballMesh.material.map, game.bed.material.map];
const disposals = new Map(resources.map((r) => [r, 0]));
resources.forEach((r) => r.addEventListener('dispose', () => disposals.set(r, disposals.get(r) + 1)));
const allocations = game.allocations;
await game.setEnabled(false); await game.setEnabled(true);
assert.equal(game.allocations, allocations);
game.dispose(); game.dispose();
assert.equal(game.group.parent, null);
assert.equal([...disposals.values()].every((n) => n === 1), true);
assert.equal(game.world, null);
console.log(JSON.stringify({ ok: true, pocketShots: 30, resourcesDisposed: resources.length }));

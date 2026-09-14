import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';
import { browserOptions } from './browser-options.mjs';
import { PNG } from 'pngjs';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const screenshots = path.join(root, 'screenshots');
await mkdir(screenshots, { recursive: true });
const server = process.env.TIDELINE_URL ? null : await createServer({
  root,
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 4185 },
});
await server?.listen();
const url = process.env.TIDELINE_URL || server.resolvedUrls.local[0];
let browser;

async function cuePosition(page) {
  return page.evaluate(() => {
    const experience = window.__TIDELINE__.experience;
    const game = experience.billiards;
    const point = experience.camera.position.clone().set(
      game.balls[0].body.position.x,
      -game.tablePlane.constant - game.group.position.y,
      game.balls[0].body.position.z,
    );
    game.group.localToWorld(point).project(experience.camera);
    const rect = experience.canvas.getBoundingClientRect();
    return {
      x: rect.left + (point.x + 1) * rect.width / 2,
      y: rect.top + (1 - point.y) * rect.height / 2,
    };
  });
}

async function state(page) {
  return page.evaluate(() => {
    const experience = window.__TIDELINE__.experience;
    return {
      game: experience.billiards.getDebugState(),
      controlsEnabled: experience.controls.enabled,
      camera: experience.camera.position.toArray(),
      status: document.querySelector('#billiards-status').textContent,
      shots: document.querySelector('#billiards-shots').textContent,
      captured: experience.billiards.aimPointerId !== null
        && experience.canvas.hasPointerCapture(experience.billiards.aimPointerId),
    };
  });
}

try {
  browser = await chromium.launch(browserOptions());
  const results = [];
  for (const config of [
    { name: 'desktop', width: 1440, height: 900, touch: false },
    { name: 'mobile', width: 390, height: 844, touch: true },
  ]) {
    const context = await browser.newContext({
      viewport: { width: config.width, height: config.height },
      deviceScaleFactor: 1,
      isMobile: config.touch,
      hasTouch: config.touch,
    });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await page.addInitScript(() => localStorage.setItem('tideline.control-guide.v4', 'seen'));
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__TIDELINE__?.getState().initialized);
      await page.click('#start-button');
      await page.waitForFunction(() => window.__TIDELINE__.experience.billiards.initialized);
      await page.screenshot({ path: path.join(screenshots, `${config.name}-beach-models.png`) });
      await page.click('#billiards-focus');
      await page.waitForFunction(() => !window.__TIDELINE__.experience.cameraTween);
      await page.click('#billiards-settings');
      await page.locator('#pool-tip-y').focus();
      await page.keyboard.press('End');
      await page.locator('#pool-tip-x').focus();
      await page.keyboard.press('End');
      assert.match(await page.locator('#billiards-tip-label').textContent(), /高杆.*右塞/);
      const tip = await page.evaluate(() => window.__TIDELINE__.experience.billiards.cueTip);
      assert.ok(Math.abs(Math.hypot(tip.x, tip.y) - 1) < 0.0001);
      await page.locator('#pool-rolling').focus();
      await page.keyboard.press('End');
      assert.equal(await page.locator('#pool-rolling-output').textContent(), '0.020');
      await page.waitForTimeout(350);
      await page.screenshot({ path: path.join(screenshots, `${config.name}-billiards-settings.png`) });
      await page.click('#pool-center-tip');
      await page.click('#pool-reset-cloth');
      assert.equal(await page.locator('#billiards-tip-label').textContent(), '中杆');
      await page.click('[data-close-panel="billiards-panel"]');
      await page.waitForFunction(() => document.querySelector('#billiards-panel').hidden);
      await page.click('#pool-view-cue');
      await page.waitForFunction(() => !window.__TIDELINE__.experience.cameraTween);
      await page.waitForTimeout(200);
      const session = config.touch ? await context.newCDPSession(page) : null;
      const pointer = async (action, point) => {
        if (session) {
          await session.send('Input.dispatchTouchEvent', {
            type: { down: 'touchStart', move: 'touchMove', up: 'touchEnd', cancel: 'touchCancel' }[action],
            touchPoints: ['up', 'cancel'].includes(action) ? []
              : [{ id: 1, x: point.x, y: point.y, radiusX: 6, radiusY: 6, force: 1 }],
          });
        } else if (action === 'down') {
          await page.mouse.move(point.x, point.y);
          await page.mouse.down();
        } else if (action === 'move') {
          await page.mouse.move(point.x, point.y, { steps: 5 });
        } else if (action === 'up') {
          await page.mouse.up();
        } else {
          await page.evaluate(() => {
            const experience = window.__TIDELINE__.experience;
            experience.canvas.releasePointerCapture(experience.billiards.aimPointerId);
          });
          await page.mouse.move(point.x + 1, point.y);
          await page.mouse.up();
        }
      };
      let cue = await cuePosition(page);
      const before = await state(page);
      await pointer('down', cue);
      assert.equal((await state(page)).game.aimPower, 0, `${config.name}: press power`);
      await pointer('up', cue);
      assert.equal((await state(page)).game.shots, 0, `${config.name}: tap fired a shot`);

      let pulled = { x: cue.x + 20, y: cue.y + 180 };
      await pointer('down', cue);
      await pointer('move', pulled);
      const aiming = await state(page);
      assert.equal(aiming.game.aiming, true);
      assert.ok(aiming.game.aimPower >= 0.06);
      assert.equal(aiming.game.drawObjects, 7);
      assert.equal(aiming.controlsEnabled, false);
      assert.equal(aiming.captured, true);
      assert.ok(Math.hypot(...aiming.camera.map((v, i) => v - before.camera[i])) < 0.001,
        `${config.name}: dragging also moved the camera`);
      const png = PNG.sync.read(await page.screenshot({
        path: path.join(screenshots, `${config.name}-billiards-aim.png`),
      }));
      const colors = new Set();
      for (let i = 0; i < png.data.length; i += 128) {
        colors.add(`${png.data[i] >> 4}:${png.data[i + 1] >> 4}:${png.data[i + 2] >> 4}`);
      }
      assert.ok(colors.size > 40, `${config.name}: blank scene`);
      await pointer('cancel', pulled);
      await page.waitForFunction(() => !window.__TIDELINE__.experience.billiards.aiming);
      const cancelled = await state(page);
      assert.equal(cancelled.game.shots, 0);
      assert.equal(cancelled.controlsEnabled, false, 'Cancelled pull stays in shooting mode');
      assert.equal(cancelled.captured, false);

      await pointer('down', cue);
      await pointer('move', pulled);
      const transitioning = await page.evaluate(() => {
        const experience = window.__TIDELINE__.experience;
        experience.focusBilliards('table');
        return { aiming: experience.billiards.aiming, canAim: experience.billiards.canAim() };
      });
      assert.deepEqual(transitioning, { aiming: false, canAim: false });
      await pointer('up', pulled);
      await page.waitForFunction(() => !window.__TIDELINE__.experience.cameraTween);
      assert.equal((await state(page)).game.shots, 0);

      await page.click('#pool-view-cue');
      await page.waitForFunction(() => !window.__TIDELINE__.experience.cameraTween);
      cue = await cuePosition(page); pulled = { x: cue.x + 20, y: cue.y + 180 };

      await pointer('down', cue);
      await pointer('move', pulled);
      await pointer('up', pulled);
      const fired = await state(page);
      assert.equal(fired.game.shots, 1);
      assert.equal(fired.shots, '1 杆');
      assert.equal(fired.controlsEnabled, true);
      assert.equal(await page.locator('#pool-tip-y').isDisabled(), true);
      await page.waitForFunction((x) =>
        window.__TIDELINE__.experience.billiards.balls[0].body.position.x > x + 0.1,
      before.game.ballPositions[0].position[0]);

      const settled = await page.evaluate(() => {
        const experience = window.__TIDELINE__.experience;
        experience.renderer.setAnimationLoop(null);
        const game = experience.billiards;
        for (let i = 0; i < 3600 && !game.areBallsSettled(); i += 1) game.update(1 / 120);
        experience.renderer.setAnimationLoop(experience.animate);
        return game.areBallsSettled();
      });
      assert.equal(settled, true);
      const afterBreak = await state(page);
      if (afterBreak.game.rules.pending) await page.click('[data-pool-action="accept"]');
      if ((await state(page)).game.placingCue) await page.click('[data-pool-action="confirm"]');
      await page.click('#pool-view-cue');
      await page.waitForFunction(() => !window.__TIDELINE__.experience.cameraTween);
      assert.match((await state(page)).status, /玩家/);
      const nextCue = await cuePosition(page);
      await pointer('down', nextCue);
      const nextPull = { x: nextCue.x + 15, y: nextCue.y + 150 };
      await pointer('move', nextPull);
      await pointer('up', nextPull);
      assert.equal((await state(page)).game.shots, 2, `${config.name}: second shot was unavailable`);

      await page.click('#billiards-reset');
      await page.waitForFunction(() => !window.__TIDELINE__.experience.cameraTween);
      const scratch = await page.evaluate(() => {
        const experience = window.__TIDELINE__.experience;
        experience.renderer.setAnimationLoop(null);
        const game = experience.billiards;
        game.rules.breaking = false;
        game.rules.hand = null;
        game.setCueView(true);
        game.shoot(1, 0, 0.2);
        game.pocketBall(game.balls[0]);
        game.balls[1].body.velocity.set(0.25, 0, 0);
        game.update(0.71);
        const waited = !game.balls[0].active;
        game.balls.slice(1).forEach(({ body }) => {
          body.velocity.setZero();
          body.angularVelocity.setZero();
          body.sleep();
        });
        game.balls[1].body.position.set(-2.1, 0, 0);
        game.balls[1].body.aabbNeedsUpdate = true;
        for (let i = 0; i < 480 && game.shot; i++) game.update(1 / 120);
        const cueBody = game.balls[0].body;
        const clear = game.balls.slice(1).every(({ body }) => cueBody.position.distanceTo(body.position) >= 0.143);
        experience.renderer.setAnimationLoop(experience.animate);
        return { waited, returned: game.balls[0].active, clear };
      });
      assert.deepEqual(scratch, { waited: true, returned: true, clear: true });
      assert.match((await state(page)).status, /自由球 · 摆球中/);
      assert.equal((await state(page)).game.rules.player, 1);
      const placement = await page.evaluate(() => {
        const game = window.__TIDELINE__.experience.billiards;
        return { invalid: game.placeCue(10, 0), valid: game.placeCue(-1, 0.4), canAim: game.canAim() };
      });
      assert.deepEqual(placement, { invalid: false, valid: true, canAim: false });
      await page.click('[data-pool-action="confirm"]');
      assert.equal((await state(page)).game.placingCue, false);
      const layout = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        hud: document.querySelector('#billiards-hud').getBoundingClientRect().toJSON(),
      }));
      assert.equal(layout.overflow, false);
      assert.ok(layout.hud.right <= config.width && layout.hud.bottom < config.height - 70);
      await page.evaluate(() => {
        const game = window.__TIDELINE__.experience.billiards;
        game.rules.groups = ['solid', 'stripe'];
        game.rules.down = new Set([1, 9]);
        game.pocketBall(game.balls[1]); game.pocketBall(game.balls[9]);
        game.syncBallInstances(); game.dispatchProgress();
      });
      assert.equal(await page.locator('.pool-number').count(), 14);
      assert.equal(await page.locator('.pool-number.is-down').count(), 2);
      await page.screenshot({ path: path.join(screenshots, `${config.name}-chinese-eight-ball.png`) });
      await page.click('#billiards-reset');
      assert.equal((await state(page)).status, '玩家 1 · 开球');
      if (!config.touch) {
        const atlas = await page.evaluate(() => {
          const e = window.__TIDELINE__.experience;
          const g = e.billiards;
          e.controls.minDistance = 1.2;
          e.controls.target.set(g.group.position.x + 1.9, g.group.position.y + 1.94, g.group.position.z);
          e.camera.position.copy(e.controls.target).add(e.camera.position.clone().set(0.3, 1.4, 1.6));
          e.controls.update();
          const image = g.ballMesh.material.map.image;
          return { width: image.width, height: image.height, instances: g.ballMesh.count };
        });
        assert.deepEqual(atlas, { width: 1024, height: 1024, instances: 16 });
        await page.waitForTimeout(150);
        await page.screenshot({ path: path.join(screenshots, 'numbered-ball-atlas-closeup.png') });
        for (const name of ['DetailedFishingBoat', 'DetailedCanvasDeckChair', 'WeatheredBeachShade']) {
          await page.evaluate((objectName) => {
            const e = window.__TIDELINE__.experience;
            const object = e.scene.getObjectByName(objectName);
            const target = e.camera.position.clone();
            object.getWorldPosition(target);
            target.y += 0.8;
            e.controls.target.copy(target);
            e.camera.position.copy(target).add(e.camera.position.clone().set(4, 3, 6));
            e.controls.update();
          }, name);
          await page.waitForTimeout(150);
          await page.screenshot({ path: path.join(screenshots, `${name}.png`) });
        }
      }
      assert.deepEqual(errors, []);
      results.push({ viewport: config.name, tap: 'cancelled', drag: 'passed', nextShot: 'passed', scratch: 'recovered', errors: errors.length });
    } finally {
      await context.close();
    }
  }
  console.log(JSON.stringify({ ok: true, results }, null, 2));
} finally {
  await browser?.close();
  await server?.close();
}

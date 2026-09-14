import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { PNG } from 'pngjs';
import { createServer } from 'vite';
import { browserOptions } from './browser-options.mjs';

const root = path.resolve(import.meta.dirname, '..');
await mkdir(path.join(root, 'screenshots'), { recursive: true });
const server = process.env.TIDELINE_URL ? null : await createServer({ root, logLevel: 'error',
  server: { host: '127.0.0.1', port: 4186 } });
await server?.listen();
let browser;
const results = [];
try {
  browser = await chromium.launch(browserOptions());
  for (const mobile of [false, true]) {
    const label = mobile ? 'mobile' : 'desktop';
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      hasTouch: mobile, isMobile: mobile, deviceScaleFactor: 1 });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.addInitScript(() => localStorage.setItem('tideline.control-guide.v4', 'seen'));
    await page.goto(process.env.TIDELINE_URL || server.resolvedUrls.local[0]);
    await page.waitForFunction(() => window.__TIDELINE__?.getState().initialized);
    await page.click('#start-button');
    await page.waitForFunction(() => window.__TIDELINE__.experience.billiards.initialized);
    assert.equal(await page.evaluate(() => window.__TIDELINE__.experience.billiards.audio.getState().state), 'not-created');
    await page.click('#billiards-focus');
    await page.waitForFunction(() => !window.__TIDELINE__.experience.cameraTween);
    assert.equal(await page.evaluate(() => window.__TIDELINE__.experience.billiards.canAim()), false);
    await page.click('#pool-view-cue');
    await page.waitForFunction(() => !window.__TIDELINE__.experience.cameraTween);
    await page.waitForFunction(() => window.__TIDELINE__.experience.billiards.audio.buffers.size === 4);
    await page.waitForTimeout(500);
    const camera = await page.evaluate(() => {
      const e = window.__TIDELINE__.experience, g = e.billiards, pose = g.getCueViewPose();
      return { distance: e.camera.position.distanceTo(pose.target), center: pose.target.clone().project(e.camera).toArray(),
        height: e.camera.position.y - pose.target.y, mode: e.billiardsViewMode, controls: e.controls.enabled,
        cueVisible: g.cueModel.visible, audio: g.audio.getState(),
        overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.equal(camera.mode, 'cue'); assert.equal(camera.controls, false);
    assert.ok(camera.distance < 2.1 && camera.distance > 1.5);
    assert.ok(Math.abs(camera.height - 0.48) < 0.01);
    assert.ok(Math.hypot(...camera.center.slice(0, 2)) < 0.001);
    assert.equal(camera.cueVisible, true); assert.equal(camera.overflow, false);
    assert.equal(await page.evaluate(() => {
      const element = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
      return element === window.__TIDELINE__.experience.canvas;
    }), true, 'HUD must not cover the white ball');
    assert.equal(camera.audio.state, 'running');
    const shot = await page.screenshot({ path: path.join(root, 'screenshots', `billiards-043-${label}-cue.png`) });
    const png = PNG.sync.read(shot), colors = new Set();
    for (let y = Math.floor(png.height * 0.35); y < png.height * 0.65; y += 3) {
      for (let x = Math.floor(png.width * 0.4); x < png.width * 0.6; x += 3) {
        const i = (y * png.width + x) * 4;
        colors.add(`${png.data[i] >> 4},${png.data[i + 1] >> 4},${png.data[i + 2] >> 4}`);
      }
    }
    assert.ok(colors.size > 12, 'Cue view contains real rendered geometry');
    const beforeObserve = await page.evaluate(() => window.__TIDELINE__.experience.camera.position.toArray());
    await page.click('#pool-view-table');
    await page.waitForTimeout(150);
    assert.ok((await page.evaluate(() => window.__TIDELINE__.experience.camera.position.toArray()))
      .every((value, i) => Math.abs(value - beforeObserve[i]) < 1e-8), 'Observation preserves position without minimum-distance snap');
    const centerX = mobile ? 195 : 720, centerY = mobile ? 422 : 450;
    if (mobile) {
      const session = await context.newCDPSession(page);
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: centerX, y: centerY }] });
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: centerX + 60, y: centerY + 20 }] });
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await session.detach();
    } else {
      await page.mouse.move(centerX, centerY); await page.mouse.down();
      await page.mouse.move(centerX + 90, centerY + 30, { steps: 5 }); await page.mouse.up();
    }
    const observed = await page.evaluate(() => {
      const e = window.__TIDELINE__.experience;
      return { shots: e.billiards.shots, aiming: e.billiards.aiming, cue: e.billiards.cueModel.visible,
        position: e.camera.position.toArray(), blocked: e.billiards.shoot(1, 0, 1) === false };
    });
    assert.equal(observed.shots, 0); assert.equal(observed.aiming, false); assert.equal(observed.cue, false);
    assert.equal(observed.blocked, true);
    assert.ok(Math.hypot(...observed.position.map((value, i) => value - beforeObserve[i])) > 0.05, 'Dragging white ball freely orbits in observation');
    await page.click('#pool-view-cue'); await page.waitForFunction(() => !window.__TIDELINE__.experience.cameraTween);
    await page.evaluate(() => { window.__TIDELINE__.experience.billiards.viewYaw = 0; });
    await page.click('#pool-aim-right');
    assert.ok(await page.evaluate(() => window.__TIDELINE__.experience.billiards.viewYaw > 0));
    await page.click('#pool-aim-left');

    // Horizontal movement has no power and must not rotate the camera or aim.
    const x = mobile ? 300 : 850, y = mobile ? 475 : 520;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 24, y);
    await page.mouse.up();
    assert.equal(await page.evaluate(() => window.__TIDELINE__.experience.billiards.shots), 0);
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 40, y + 60);
    await page.evaluate(() => document.querySelector('#pool-view-table').click());
    await page.mouse.up();
    assert.equal(await page.evaluate(() => window.__TIDELINE__.experience.billiards.shots), 0, 'Mode change cancels captured stroke');
    await page.click('#pool-view-cue'); await page.waitForFunction(() => !window.__TIDELINE__.experience.cameraTween);
    await page.evaluate(() => {
      const e = window.__TIDELINE__.experience; e.billiards.viewYaw = 0;
      const analyzer = e.billiards.audio.context.createAnalyser(); analyzer.fftSize = 2048;
      e.billiards.audio.compressor.connect(analyzer); window.__poolAnalyzer = analyzer;
      window.__poolPeak = 0;
      const data = new Float32Array(analyzer.fftSize);
      const measure = () => {
        analyzer.getFloatTimeDomainData(data);
        window.__poolPeak = Math.max(window.__poolPeak, ...data.map(Math.abs));
        window.__poolSample = requestAnimationFrame(measure);
      };
      measure();
    });
    const latch = () => page.evaluate(() => {
      const e = window.__TIDELINE__.experience;
      window.__strokePose = { position: e.camera.position.toArray(), quaternion: e.camera.quaternion.toArray(),
        target: e.controls.target.toArray(), yaw: e.billiards.viewYaw };
    });
    const checkLock = async () => {
      await page.waitForTimeout(350);
      const lock = await page.evaluate(() => {
        const e = window.__TIDELINE__.experience, saved = window.__strokePose;
        return { positionError: Math.hypot(...e.camera.position.toArray().map((v, i) => v - saved.position[i])),
          rotationError: Math.hypot(...e.camera.quaternion.toArray().map((v, i) => v - saved.quaternion[i])),
          targetError: Math.hypot(...e.controls.target.toArray().map((v, i) => v - saved.target[i])),
          yawError: Math.abs(e.billiards.viewYaw - saved.yaw), aiming: e.billiards.aiming,
          fineAimBlocked: !e.billiards.adjustViewAim(0.3), power: e.billiards.aimPower };
      });
      assert.equal(lock.aiming, true); assert.equal(lock.fineAimBlocked, true); assert.ok(lock.power > 0.85);
      for (const key of ['positionError', 'rotationError', 'targetError', 'yawError']) assert.ok(lock[key] < 1e-10, `${label} ${key}: ${lock[key]}`);
      results.push({ label, strokeLock: lock });
      await page.screenshot({ path: path.join(root, 'screenshots', `billiards-043-${label}-pull.png`) });
    };
    if (mobile) {
      const session = await context.newCDPSession(page);
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await latch();
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 55, y: y + 220 }] });
      await checkLock();
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await session.detach();
    } else {
      await page.mouse.move(x, y); await page.mouse.down();
      await latch();
      await page.mouse.move(x + 55, y + 220, { steps: 8 }); await page.mouse.wheel(0, 300);
      await checkLock(); await page.mouse.up();
    }
    const afterShot = await page.evaluate(() => {
      const e = window.__TIDELINE__.experience;
      return { shots: e.billiards.shots, audio: e.billiards.audio.getState(), position: e.camera.position.toArray() };
    });
    assert.equal(afterShot.shots, 1); assert.equal(afterShot.audio.counts.cue, 1);
    await page.waitForTimeout(120);
    assert.equal(await page.locator('#pool-strike').isDisabled(), true);
    const frozen = await page.evaluate(() => window.__TIDELINE__.experience.camera.position.toArray());
    assert.ok(frozen.every((value, index) => Math.abs(value - afterShot.position[index]) < 0.001), 'No fast camera chase during shot');
    await page.waitForFunction(() => window.__TIDELINE__.experience.billiards.audio.counts.ball > 0, { timeout: 15000 });
    await page.waitForFunction(() => window.__TIDELINE__.experience.billiards.audio.counts.rail > 0, { timeout: 15000 });
    assert.ok(await page.evaluate(() => window.__poolPeak > 0.001 && window.__poolPeak < 1), 'Live audio graph has nonzero, unclipped output');
    await page.screenshot({ path: path.join(root, 'screenshots', `billiards-043-${label}-shot.png`) });

    // Decode and render the actual packaged recording, not only event counts.
    const audioPixels = await page.evaluate(async () => {
      const sound = window.__TIDELINE__.experience.billiards.audio;
      const result = {};
      for (const [type, buffer] of sound.buffers) {
        const offline = new OfflineAudioContext(1, buffer.length, buffer.sampleRate);
        const source = offline.createBufferSource(); source.buffer = buffer;
        source.connect(offline.destination); source.start();
        const samples = (await offline.startRendering()).getChannelData(0);
        result[type] = { peak: samples.reduce((a, b) => Math.max(a, Math.abs(b)), 0),
          rms: Math.sqrt(samples.reduce((a, b) => a + b * b, 0) / samples.length) };
      }
      return result;
    });
    await page.evaluate(() => { cancelAnimationFrame(window.__poolSample); window.__poolAnalyzer.disconnect(); });
    for (const sample of Object.values(audioPixels)) { assert.ok(sample.peak < 1 && sample.peak > 0.1); assert.ok(sample.rms > 0.025); }

    await page.evaluate(() => {
      const e = window.__TIDELINE__.experience, g = e.billiards;
      g.reset(); g.rules.hand = null; g.rules.breaking = false;
      g.balls.slice(2).forEach(ball => { ball.active = false; g.world.removeBody(ball.body); });
      for (const [index, z] of [[0, -0.25], [1, 0.95]]) {
        const body = g.balls[index].body;
        body.position.set(0, 0, z); body.previousPosition.copy(body.position); body.aabbNeedsUpdate = true;
      }
      g.viewYaw = Math.PI / 2; g.shotPower = 0.32; g.syncBallInstances();
      window.__pocketBefore = g.audio.counts.pocket;
      e.focusBilliards('cue');
    });
    await page.waitForFunction(() => !window.__TIDELINE__.experience.cameraTween);
    await page.click('#pool-strike');
    await page.waitForFunction(() => window.__TIDELINE__.experience.billiards.audio.counts.pocket > window.__pocketBefore);
    assert.equal(await page.evaluate(() => window.__TIDELINE__.experience.billiards.balls[1].active), false);

    await page.click('#pool-audio');
    assert.equal(await page.getAttribute('#pool-audio', 'aria-checked'), 'false');
    assert.equal(await page.evaluate(() => window.__TIDELINE__.experience.billiards.audio.voices.size), 0);
    await page.evaluate(() => window.__TIDELINE__.experience.billiards.reset());
    await page.click('#billiards-focus');
    await page.waitForFunction(() => !window.__TIDELINE__.experience.cameraTween);
    await page.screenshot({ path: path.join(root, 'screenshots', `billiards-043-${label}-table.png`) });
    const model = await page.evaluate(() => {
      const e = window.__TIDELINE__.experience, g = e.billiards;
      return { state: g.getDebugState(), hardware: g.hardware.geometry.attributes.position.count,
        frame: g.frame.geometry.attributes.position.count, clothTop: g.bed.geometry.boundingBox?.max.y,
        camera: e.camera.position.distanceTo(e.controls.target) };
    });
    assert.ok(model.frame > 24 && model.hardware > 500);
    assert.ok(model.camera > 8); assert.equal(model.state.cueView, false);

    await page.click('#pool-view-cue'); await page.waitForFunction(() => !window.__TIDELINE__.experience.cameraTween);
    await page.evaluate(() => { const g = window.__TIDELINE__.experience.billiards; g.rules.breaking = false; g.rules.hand = null; });
    await page.locator('#pool-shot-power').focus(); await page.keyboard.press('Home');
    await page.click('#pool-strike');
    assert.equal(await page.evaluate(() => window.__TIDELINE__.experience.billiards.shots), 1);
    await page.waitForFunction(() => !window.__TIDELINE__.experience.billiards.shot);
    assert.equal(await page.evaluate(() => window.__TIDELINE__.experience.billiardsViewMode), 'table', 'Scratch/foul opens placement overview');
    await page.waitForFunction(() => !window.__TIDELINE__.experience.cameraTween);
    await page.click('[data-pool-action="confirm"]');
    await page.waitForFunction(() => !window.__TIDELINE__.experience.cameraTween);
    assert.equal(await page.evaluate(() => window.__TIDELINE__.experience.billiardsViewMode), 'observe');
    await page.evaluate(() => window.__TIDELINE__.experience.resetCamera());
    await page.waitForFunction(() => !window.__TIDELINE__.experience.cameraTween);
    assert.equal(await page.evaluate(() => window.__TIDELINE__.experience.controls.enabled), true);
    const disposal = await page.evaluate(async () => {
      const g = window.__TIDELINE__.experience.billiards;
      const resources = [g.hardware, g.leather, g.cueModel].flatMap(mesh => [mesh.geometry, mesh.material]).concat(g.frame.material.map);
      const count = resources.map(() => 0);
      resources.forEach((resource, i) => resource.addEventListener('dispose', () => count[i]++));
      g.dispose(); g.dispose(); await new Promise(resolve => setTimeout(resolve, 30));
      return { count, audio: g.audio.getState() };
    });
    assert.ok(disposal.count.every(value => value === 1));
    assert.equal(disposal.audio.voices, 0); assert.equal(disposal.audio.state, 'closed');
    assert.deepEqual(errors, []);
    results.push({ label, camera, model, audioPixels, colors: colors.size, disposal });
    await context.close();
  }
  console.log(JSON.stringify({ ok: true, results }, null, 2));
} finally { await browser?.close(); await server?.close(); }

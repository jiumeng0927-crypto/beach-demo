import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { PNG } from 'pngjs';
import { browserOptions } from './browser-options.mjs';
import { RENDER_BUDGETS } from './render-budgets.mjs';

const server = process.env.TIDELINE_URL ? null : await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 4197, strictPort: true } });
await server?.listen();
const url = process.env.TIDELINE_URL || server.resolvedUrls.local[0];
const browser = await chromium.launch(browserOptions());
const results = [];
function pixelsChanged(a, b) {
  a = PNG.sync.read(a); b = PNG.sync.read(b);
  let changed = 0;
  for (let i = 0; i < a.data.length; i += 4) if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i+1] - b.data[i+1]) + Math.abs(a.data[i+2] - b.data[i+2]) > 12) changed++;
  return changed / (a.width * a.height);
}
try {
  for (const mobile of [false, true]) {
    const label = mobile ? 'mobile' : 'desktop';
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    await page.addInitScript(() => localStorage.setItem('tideline.control-guide.v4', 'seen'));
    await page.goto(url);
    await page.waitForFunction(() => window.__TIDELINE__?.getState().initialized, null, { timeout: 30000 });
    await page.click('#start-button');
    await page.evaluate(() => window.__TIDELINE__.experience.npcs.ready);
    await page.waitForTimeout(1000);
    assert.deepEqual(errors, []);
    const initial = await page.evaluate(() => window.__TIDELINE__.getState());
    console.log('INITIAL', label, JSON.stringify({ render: initial.render, npc: initial.npcs }));
    assert.ok(initial.render.triangles <= RENDER_BUDGETS[label].triangles, JSON.stringify(initial.render));
    assert.ok(initial.render.calls <= RENDER_BUDGETS[label].calls);
    await page.screenshot({ path: `screenshots/living-coast-041-${label}-overview.png` });
    await page.evaluate(() => {
      const e = window.__TIDELINE__.experience;
      e.renderer.setAnimationLoop(null); e.cameraTween = null;
      e.environment.dayClock.running = false;
      const npc = e.npcs.items[0];
      e.camera.position.copy(npc.root.position).add({ x: 1.3, y: 1.2, z: 3.6 });
      e.controls.target.copy(npc.root.position).add({ x: 0, y: 1, z: 0 }); e.controls.update();
      npc.root.rotation.y = .1; e.npcs.update(.1); e.renderScene(.016);
    });
    await page.screenshot({ path: `screenshots/living-coast-041-${label}-lin.png` });
    await page.evaluate(() => {
      const e = window.__TIDELINE__.experience, npc = e.npcs.items[1];
      e.camera.position.copy(npc.root.position).add({ x: 1.3, y: 1.2, z: 3.6 });
      e.controls.target.copy(npc.root.position).add({ x: 0, y: 1, z: 0 }); e.controls.update();
      npc.root.rotation.y = .1; e.renderScene(.016);
    });
    await page.screenshot({ path: `screenshots/living-coast-041-${label}-chen.png` });
    await page.evaluate(() => {
      const e = window.__TIDELINE__.experience;
      const trunk = e.scene.getObjectByName('InstancedPalmTrunks');
      const p = e.camera.position.clone().setFromMatrixPosition(trunk.matrixWorld);
      const matrix = trunk.matrixWorld.clone(); trunk.getMatrixAt(0, matrix); p.setFromMatrixPosition(matrix);
      e.camera.position.copy(p).add({ x: 9, y: 5, z: 11 });
      e.controls.target.copy(p).add({ x: 0, y: 4, z: 0 }); e.controls.update(); e.renderScene(.016);
    });
    await page.screenshot({ path: `screenshots/living-coast-041-${label}-palm.png` });
    await page.evaluate(() => {
      const e = window.__TIDELINE__.experience, birds = e.scene.getObjectByName('CoastalGulls');
      birds.update(32);
      const bodies = birds.children[0], matrix = bodies.matrixWorld.clone(); bodies.getMatrixAt(0, matrix);
      const p = e.controls.target.clone().setFromMatrixPosition(matrix);
      e.camera.position.copy(p).add({ x: 2.2, y: 1.4, z: 2 }); e.controls.target.copy(p); e.controls.update(); e.renderScene(.016);
    });
    const gullFirst = await page.screenshot({ path: `screenshots/living-coast-041-${label}-gull.png` });
    await page.evaluate(() => { const e = window.__TIDELINE__.experience; e.scene.getObjectByName('CoastalGulls').update(32.6); e.renderScene(.016); });
    assert.ok(pixelsChanged(gullFirst, await page.screenshot()) > .001);
    await page.evaluate(() => {
      const e = window.__TIDELINE__.experience;
      e.camera.position.set(0, 5, 16); e.controls.target.set(0, 45, -80); e.controls.update();
      e.environment.clouds.material.uniforms.uTime.value = 0; e.environment.clouds.material.uniforms.uEvolution.value = 0; e.renderScene(.016);
    });
    const cloudFirst = await page.screenshot({ path: `screenshots/living-coast-041-${label}-cloud-a.png` });
    await page.evaluate(() => { const e = window.__TIDELINE__.experience; e.environment.clouds.material.uniforms.uEvolution.value = 120; e.renderScene(.016); });
    const cloudDelta = pixelsChanged(cloudFirst, await page.screenshot({ path: `screenshots/living-coast-041-${label}-cloud-b.png` }));
    assert.ok(cloudDelta > .005, `Cloud density must evolve independently of wind: ${cloudDelta}`);
    const clock = await page.evaluate(() => {
      const e = window.__TIDELINE__.experience, c = e.environment.dayClock;
      c.seek('day'); c.running = true; c.update(60); const moved = c.hour;
      c.running = false; c.update(60); const paused = c.hour;
      c.seek('day'); e.resetCamera(); e.cameraTween = null;
      e.renderer.setAnimationLoop(e.animate); return { moved, paused };
    });
    assert.equal(clock.moved, 12.8); assert.equal(clock.paused, clock.moved);
    await page.click('#collection-open');
    assert.equal(await page.locator('#collection-dialog').evaluate(d => d.open), true);
    await page.screenshot({ path: `screenshots/living-coast-041-${label}-journal.png` });
    await page.click('#collection-close');
    await page.evaluate(() => { const d = window.__TIDELINE__.experience.discovery; d.items.forEach((_, i) => d.collect(i)); });
    await page.click('#collection-open'); await page.click('#collection-tab-market');
    assert.equal(await page.locator('#market-coins').textContent(), '0');
    assert.match(await page.locator('#market-inventory').textContent(), /海玻璃 × 6/);
    await page.click('#market-sell-all'); assert.equal(await page.locator('#market-coins').textContent(), '48');
    await page.click('[data-market-product="tide-map"]'); assert.equal(await page.locator('#market-coins').textContent(), '32');
    assert.equal(await page.locator('[data-market-product="tide-map"]').textContent(), '已拥有');
    await page.screenshot({ path: `screenshots/living-coast-041-${label}-market.png` });
    await page.click('#collection-tab-journal'); await page.click('#collection-next');
    assert.equal(await page.evaluate(() => window.__TIDELINE__.experience.discovery.campaign.chapter), 1);
    const blocked = await page.evaluate(() => {
      const e = window.__TIDELINE__.experience; e.setTideMode('high'); e.discovery.tideLevel = 1;
      return e.discovery.collect(0);
    });
    assert.equal(blocked, false);
    await page.click('#collection-close');
    await page.evaluate(() => { const e = window.__TIDELINE__.experience; e.setTideMode('low'); });
    await page.waitForFunction(() => window.__TIDELINE__.experience.discovery.tideLevel <= -.22);
    const pickItem = async index => {
      const point = await page.evaluate(index => {
        const e = window.__TIDELINE__.experience, item = e.discovery.items[index];
        const target = item.position.clone().add({ x: 0, y: .32, z: 0 });
        e.cameraTween = null; e.setCameraMode('orbit');
        e.controls.target.copy(target); e.camera.position.copy(target).add({ x: 0, y: 3, z: 4 });
        e.controls.update(); e.camera.updateMatrixWorld(true);
        const p = target.project(e.camera), rect = e.canvas.getBoundingClientRect();
        return { x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2 };
      }, index);
      if (mobile) await page.touchscreen.tap(point.x, point.y); else await page.mouse.click(point.x, point.y);
      await page.waitForFunction(index => window.__TIDELINE__.experience.discovery.items[index].collected, index);
    };
    await pickItem(0);
    const collected = await page.evaluate(() => {
      const d = window.__TIDELINE__.experience.discovery;
      const first = d.items[0].collected; const duplicate = d.collect(0); return { first, duplicate, count: d.campaign.getState().overallCollected };
    });
    assert.deepEqual(collected, { first: true, duplicate: false, count: 7 });
    await page.reload(); await page.waitForFunction(() => window.__TIDELINE__?.getState().initialized); await page.click('#start-button');
    assert.deepEqual(await page.evaluate(() => {
      const state = window.__TIDELINE__.experience.discovery.campaign.getState();
      return { collected: state.overallCollected, coins: state.economy.coins,
        shell: state.economy.inventory.shell, purchases: state.economy.purchases };
    }), { collected: 7, coins: 32, shell: 1, purchases: ['tide-map'] });
    await page.evaluate(() => window.__TIDELINE__.experience.setTideMode('low'));
    await page.waitForFunction(() => window.__TIDELINE__.experience.discovery.tideLevel <= -.22);
    await page.evaluate(() => { const d = window.__TIDELINE__.experience.discovery; d.items.forEach((_, i) => d.collect(i)); });
    await page.click('#collection-open'); await page.click('#collection-next'); await page.click('#collection-close');
    await pickItem(0);
    await page.evaluate(() => { const d = window.__TIDELINE__.experience.discovery; d.items.forEach((_, i) => d.collect(i)); });
    const end = await page.evaluate(() => window.__TIDELINE__.experience.discovery.campaign.getState());
    assert.ok(end.completed); assert.equal(end.badges.length, 3);
    await page.click('#collection-open');
    await page.screenshot({ path: `screenshots/living-coast-041-${label}-complete.png` });
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    const disposed = await page.evaluate(() => {
      const e = window.__TIDELINE__.experience, d = e.discovery;
      const resources = [d.glass.geometry, d.glass.material, d.glows.geometry, d.glowMaterial,
        e.scene.getObjectByName('GullBodies').geometry, e.scene.getObjectByName('GullFeatherWings').geometry,
        e.scene.getObjectByName('GullLeftFeatherWings').geometry];
      const counts = resources.map(() => 0); resources.forEach((r, i) => r.addEventListener('dispose', () => counts[i]++));
      e.dispose(); e.dispose(); return counts;
    });
    assert.deepEqual(disposed, [1, 1, 1, 1, 1, 1, 1]);
    results.push({ label, render: initial.render, cloudDelta, completed: end.completed, savedReload: true, disposed });
    await context.close();
  }
  console.log(JSON.stringify({ ok: true, results }, null, 2));
} finally { await browser.close(); await server?.close(); }

import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { browserOptions } from './browser-options.mjs';
import { PNG } from 'pngjs';
import { createServer } from 'vite';

const reference = process.argv.includes('--reference');
const url = process.env.TIDELINE_URL || (reference ? 'http://127.0.0.1:5175/' : null);
const server = url ? null : await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 4197, strictPort: true } });
await server?.listen();
await mkdir('screenshots', { recursive: true });
const browser = await chromium.launch(browserOptions());
const results = [];
try {
  for (const mobile of [false, true]) {
    const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      isMobile: mobile, hasTouch: mobile });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
    await page.addInitScript(() => localStorage.setItem('tideline.control-guide.v4', 'seen'));
    await page.goto(url || server.resolvedUrls.local[0]);
    await page.waitForFunction(() => window.__TIDELINE__?.getState().initialized);
    await page.click('#start-button');
    await page.waitForTimeout(900);
    await page.addStyleTag({ content: 'body * { visibility:hidden !important; } #scene-canvas { visibility:visible !important; }' });
    await page.evaluate(mobile => {
      const e = window.__TIDELINE__.experience;
      e.setQuality(mobile ? 'low' : 'high');
      e.renderer.setAnimationLoop(null); e.cameraTween = null; e.controls.enabled = false;
      e.environment.setTimeOfDay('day', true); e.setTideMode('low', true);
      e.environment.water.material.uniforms.time.value = 12;
      e.environment.update(0, 12); e.coastalProps.updateTide(e.environment.water.position.y);
    }, mobile);
    const prefix = `screenshots/water-quality-${reference ? 'before' : 'after'}-${mobile ? 'mobile' : 'desktop'}`;
    for (const [view, position, target] of [
      ['overview', null, null], ['shore', [18, 3, 19], [0, 0, -28]],
      ['shore-nofoam', [18, 3, 19], [0, 0, -28]],
      ['sea', [8, 2.6, -34], [-10, 0, -90]], ['rocks', [-15, 4, 15], [-23, 0.35, 7]],
      ['overhead', [10, 65, 32], [0, 0, 25]],
    ]) {
      const stats = await page.evaluate(({ view, position, target }) => {
        const e = window.__TIDELINE__.experience;
        e.world.foam.visible = view !== 'shore-nofoam';
        if (position) { e.camera.position.fromArray(position); e.camera.lookAt(e.camera.position.clone().fromArray(target)); }
        e.camera.updateMatrixWorld(true); e.renderer.info.reset(); e.renderScene(0);
        return e.getDebugState().render;
      }, { view, position, target });
      const png = PNG.sync.read(await page.screenshot({ path: `${prefix}-${view}.png` }));
      const colors = new Set(); let light = 0;
      for (let i = 0; i < png.data.length; i += 64) {
        colors.add(`${png.data[i] >> 4},${png.data[i + 1] >> 4},${png.data[i + 2] >> 4}`);
        light += png.data[i] + png.data[i + 1] + png.data[i + 2];
      }
      assert.ok(colors.size > 25, `${view}: nonblank water and scenery`);
      results.push({ mobile, view, colors: colors.size, light: Math.round(light), render: stats });
    }
    await page.evaluate(() => {
      const e = window.__TIDELINE__.experience;
      e.camera.position.set(18, 3, 19); e.camera.lookAt(0, 0, -28); e.camera.updateMatrixWorld(true); e.renderScene(0);
    });
    const before = PNG.sync.read(await page.screenshot());
    await page.evaluate(() => {
      const e = window.__TIDELINE__.experience;
      e.environment.update(1.8, 13.8); e.renderScene(0);
    });
    const after = PNG.sync.read(await page.screenshot());
    let changed = 0;
    for (let i = 0; i < before.data.length; i += 4) if (Math.abs(before.data[i] - after.data[i]) + Math.abs(before.data[i + 1] - after.data[i + 1]) + Math.abs(before.data[i + 2] - after.data[i + 2]) > 12) changed++;
    assert.ok(changed / (before.width * before.height) > 0.02, 'Waves must move in the actual rendered canvas');
    await page.evaluate(() => { const e = window.__TIDELINE__.experience; e.environment.setTimeOfDay('sunset', true); e.renderScene(0); });
    await page.screenshot({ path: `${prefix}-sunset.png` });
    assert.deepEqual(errors, []);
    await page.evaluate(() => window.__TIDELINE__.experience.dispose());
    await page.close();
  }
  console.log(JSON.stringify({ ok: true, reference, results }, null, 2));
} finally { await browser.close(); await server?.close(); }

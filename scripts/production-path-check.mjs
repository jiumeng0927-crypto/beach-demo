import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright-core';
import { PNG } from 'pngjs';
import { browserOptions } from './browser-options.mjs';
import { verifiedPublicFiles } from './public-assets.mjs';

const root = resolve(import.meta.dirname, '..', 'dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.json': 'application/json' };
const publicFiles = verifiedPublicFiles();
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const relative = pathname.replace(/^\/tideline\//, '/').replace(/^\//, '') || 'index.html';
    const path = resolve(root, relative);
    if (!path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    const data = await readFile(path);
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' }).end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch(browserOptions());
const results = [];
try {
  for (const prefix of ['/', '/tideline/']) {
    for (const name of publicFiles) assert.equal((await fetch(origin + prefix + name)).status, 200, name);
    for (const name of ['characters/hat-guide.glb', 'characters/plush-dreamer-turnaround.png', 'textures/water-normal.jpg']) {
      assert.equal((await fetch(origin + prefix + name)).status, 404, `Private/unknown asset leaked: ${name}`);
    }
    for (const fallback of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      const errors = [], requests = [], failed = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => {
        const url = new URL(request.url());
        if (url.protocol === 'http:' || url.protocol === 'https:') {
          assert.equal(url.origin, origin, 'Production assets must not depend on external hosts');
          requests.push(url.pathname);
        }
      });
      page.on('console', message => {
        if (message.type() === 'error' && !(fallback && message.text().includes('404 (Not Found)'))) errors.push(message.text());
      });
      page.on('response', response => { if (response.status() >= 400) failed.push(response.url()); });
      if (fallback) await page.route('**/coastal-sky-2k.hdr', route => route.fulfill({ status: 404, body: '' }));
      await page.addInitScript(() => localStorage.setItem('tideline.control-guide.v4', 'seen'));
      await page.goto(origin + prefix);
      await page.waitForFunction(() => window.__TIDELINE__?.getState().initialized, null, { timeout: 60000 });
      await page.click('#start-button');
      await page.evaluate(() => window.__TIDELINE__.experience.npcs.ready);
      await page.waitForFunction(() => window.__TIDELINE__.experience.billiards.initialized);
      await page.click('#billiards-focus');
      assert.equal(await page.evaluate(() => window.__TIDELINE__.experience.billiards.audio.unlock()), true);
      assert.equal(await page.evaluate(() => window.__TIDELINE__.experience.billiards.audio.buffers.size), 4);
      assert.equal(requests.filter(path => path.endsWith('/audio/billiards/ball-clack.mp3')).length, 1);
      const state = await page.evaluate(() => {
        const e = window.__TIDELINE__.experience;
        const sky = e.environment.skyTexture;
        let disposals = 0;
        sky?.addEventListener('dispose', () => disposals++);
        for (const quality of ['low', 'high', 'low', 'high']) e.setQuality(quality);
        e.environment.setTimeOfDay('day', true);
        e.renderScene(0);
        window.__SKY_DISPOSALS__ = () => disposals;
        return { loaded: e.npcs.getState().loaded, sky: sky ? [sky.image.width, sky.image.height] : null,
          reused: sky === e.environment.skyTexture, disposals,
          blend: e.environment.sky.material.uniforms.uSkyBlend.value,
          evolvingClouds: Number.isFinite(e.environment.clouds.material.uniforms.uEvolution.value),
          environmentBlend: e.environment.environmentSky.material.uniforms.uSkyBlend.value };
      });
      assert.equal(state.loaded, 2);
      assert.deepEqual(state.sky, fallback ? null : [2048, 1024]);
      assert.equal(state.reused, true); assert.equal(state.disposals, 0);
      assert.equal(state.blend, 0, 'Visible clouds must come from the live layer, not baked HDR clouds');
      assert.equal(state.evolvingClouds, true);
      assert.equal(state.environmentBlend, fallback ? 0 : 1, 'HDR illumination remains available with analytical fallback');
      const png = PNG.sync.read(await page.locator('#scene-canvas').screenshot());
      const colors = new Set();
      for (let i = 0; i < png.data.length; i += 64) colors.add(`${png.data[i] >> 4},${png.data[i + 1] >> 4},${png.data[i + 2] >> 4}`);
      assert.ok(colors.size > 25, 'Production canvas must contain scene pixels');
      assert.deepEqual(errors, []);
      assert.ok(failed.every(url => fallback && url.endsWith('/coastal-sky-2k.hdr')), JSON.stringify(failed));
      assert.ok(requests.every(path => path.startsWith(prefix)), `Asset escaped repository prefix: ${requests}`);
      assert.equal(requests.filter(path => path.endsWith('/coastal-sky-2k.hdr')).length, 1);
      assert.equal(await page.evaluate(() => {
        window.__TIDELINE__.experience.dispose(); window.__TIDELINE__.experience.dispose();
        return window.__SKY_DISPOSALS__();
      }), fallback ? 0 : 1);
      results.push({ prefix, fallback, ...state, colors: colors.size });
      await page.close();
    }
  }
  console.log(JSON.stringify({ ok: true, results }, null, 2));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}

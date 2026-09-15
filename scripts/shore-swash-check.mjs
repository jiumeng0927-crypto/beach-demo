import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { PNG } from 'pngjs';
import { createServer } from 'vite';
import { browserOptions } from './browser-options.mjs';

const reference = process.argv.includes('--reference');
const url = process.env.TIDELINE_URL || (reference ? 'http://127.0.0.1:5175/' : null);
const server = url ? null : await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 4198, strictPort: true } });
await server?.listen();
await mkdir('screenshots', { recursive: true });
const browser = await chromium.launch(browserOptions());
const results = [];
function compare(a, b) {
  let changed = 0, total = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const delta = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
    if (delta > 12) changed++;
    total += delta;
  }
  return { changed: changed / (a.width * a.height), total };
}
try {
  for (const mobile of [false, true]) {
    const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.addInitScript(() => localStorage.setItem('tideline.control-guide.v4', 'seen'));
    await page.goto(url || server.resolvedUrls.local[0]);
    await page.waitForFunction(() => window.__TIDELINE__?.getState().initialized);
    await page.click('#start-button');
    await page.evaluate(async () => {
      const e = window.__TIDELINE__.experience;
      await e.npcs.ready; await e.coastalProps.ready;
      e.renderer.setAnimationLoop(null); e.cameraTween = null; e.controls.enabled = false;
      e.environment.setTimeOfDay('day', true);
    });
    await page.addStyleTag({ content: 'body * { visibility:hidden !important; } #scene-canvas { visibility:visible !important; }' });
    const prefix = `screenshots/shore-swash-040-${reference ? 'before' : 'after'}-${mobile ? 'mobile' : 'desktop'}`;
    const geometry = await page.evaluate(() => {
      const e = window.__TIDELINE__.experience, beach = e.world.beach, foam = e.world.foam;
      const a = beach.geometry.attributes.position, b = foam.geometry.attributes.position;
      let maxPositionError = 0, minGroundGap = Infinity, maxGroundGap = -Infinity;
      const ground = e.camera.position.clone(), surface = ground.clone();
      e.scene.updateMatrixWorld(true);
      for (let i = 0; i < Math.min(a.count, b.count); i++) {
        ground.fromBufferAttribute(a, i).applyMatrix4(beach.matrixWorld);
        surface.fromBufferAttribute(b, i).applyMatrix4(foam.matrixWorld);
        maxPositionError = Math.max(maxPositionError, Math.abs(ground.x - surface.x), Math.abs(ground.z - surface.z));
        minGroundGap = Math.min(minGroundGap, surface.y - ground.y); maxGroundGap = Math.max(maxGroundGap, surface.y - ground.y);
      }
      return { maxPositionError, minGroundGap, maxGroundGap, triangles: foam.geometry.index.count / 3,
        matchingTriangles: [...foam.geometry.index.array].every((v, i) => beach.geometry.index.array[i] === v) };
    });
    if (!reference) {
      assert.ok(geometry.maxPositionError < 1e-5, JSON.stringify(geometry));
      assert.ok(Math.abs(geometry.minGroundGap - 0.025) < 1e-5 && Math.abs(geometry.maxGroundGap - 0.025) < 1e-5);
      assert.equal(geometry.matchingTriangles, true, 'Foam and beach must share triangle diagonals');
    }
    for (const tide of ['low', 'high']) {
      for (const phase of [0, 2.8, 5.6]) {
        await page.evaluate(({ tide, phase }) => {
          const e = window.__TIDELINE__.experience;
          e.setTideMode(tide, true); e.environment.water.material.uniforms.time.value = phase;
          e.environment.update(0, 12);
          e.world.foamMaterial.uniforms.uWavePhase.value = phase;
          e.world.foamMaterial.uniforms.uTime.value = 12;
          e.camera.position.set(18, 3, 19); e.camera.lookAt(0, 0, -28); e.camera.updateMatrixWorld(true);
          e.world.foam.visible = true; e.renderScene(0);
        }, { tide, phase });
        await page.screenshot({ path: `${prefix}-${tide}-${phase}.png` });
      }
    }
    // Render only the foam against black to isolate opacity from HDR water motion.
    await page.evaluate(() => {
      const e = window.__TIDELINE__.experience;
      const scene = new e.scene.constructor(); scene.background = new e.scene.fog.color.constructor(0);
      const mesh = e.world.foam.clone(); scene.add(mesh);
      e.camera.position.set(0, 42, 16); e.camera.lookAt(0, 0, 7); e.camera.updateMatrixWorld(true);
      window.__FOAM_ONLY__ = () => e.renderer.render(scene, e.camera);
      e.world.foamMaterial.uniforms.uWavePhase.value = 0; window.__FOAM_ONLY__();
    });
    const start = PNG.sync.read(await page.locator('#scene-canvas').screenshot({ path: `${prefix}-foam-only.png` }));
    await page.evaluate(() => { window.__TIDELINE__.experience.world.foamMaterial.uniforms.uWavePhase.value = 2.8; window.__FOAM_ONLY__(); });
    const moved = PNG.sync.read(await page.locator('#scene-canvas').screenshot());
    await page.evaluate(() => { window.__TIDELINE__.experience.world.foamMaterial.uniforms.uTime.value += 100; window.__FOAM_ONLY__(); });
    const frozen = PNG.sync.read(await page.locator('#scene-canvas').screenshot());
    const motion = compare(start, moved), pause = compare(moved, frozen);
    assert.deepEqual(errors, []);
    assert.ok(motion.changed > 0.002, `Swash must change actual foam pixels: ${JSON.stringify(motion)}`);
    if (!reference) assert.equal(pause.total, 0, 'Paused water clock must freeze every foam layer');
    const grass = await page.evaluate(() => {
      const e = window.__TIDELINE__.experience, g = e.world.details.grass;
      const center = g.position.clone(), matrix = g.matrix.clone();
      let distance = Infinity;
      for (let i = 0; i < g.count; i++) {
        g.getMatrixAt(i, matrix);
        const p = g.position.clone().setFromMatrixPosition(matrix), d = Math.hypot(p.x - 26, p.z - 40);
        if (d < distance) { distance = d; center.copy(p); }
      }
      e.camera.position.copy(center).add({ x: 1.8, y: 1.1, z: 2.7 });
      e.camera.lookAt(center.x, center.y + 0.5, center.z); e.camera.updateMatrixWorld(true); e.renderer.info.reset(); e.renderScene(0);
      const vertices = g.geometry.attributes.color.array, tints = g.instanceColor.array;
      return { vertices: vertices.length / 3, count: g.count, minTint: Math.min(...tints), maxTint: Math.max(...tints),
        averageGreen: vertices.reduce((sum, value, i) => sum + (i % 3 === 1 ? value : 0), 0) / (vertices.length / 3),
        triangles: e.getDebugState().render.triangles };
    });
    await page.screenshot({ path: `${prefix}-grass.png` });
    if (!reference) assert.ok(grass.minTint > 0.65 && grass.maxTint <= 1, 'Instance tint must not double-darken blade colors');
    assert.equal(grass.count, mobile ? 70 : 300);
    assert.deepEqual(errors, []);
    const disposal = await page.evaluate(() => {
      const e = window.__TIDELINE__.experience;
      const resources = [e.world.foam.geometry, e.world.foam.material, e.world.details.grass.geometry, e.world.details.grass.material, e.world.sandMaterial];
      const counts = resources.map(() => 0);
      resources.forEach((resource, i) => resource.addEventListener('dispose', () => counts[i]++));
      e.setQuality(e.effectiveQuality === 'low' ? 'high' : 'low');
      const afterSwitch = [...counts];
      e.dispose(); e.dispose();
      return { afterSwitch, afterDispose: counts };
    });
    assert.deepEqual(disposal.afterSwitch, [1, 1, 1, 1, 1]);
    assert.deepEqual(disposal.afterDispose, disposal.afterSwitch);
    results.push({ mobile, motion, pause, grass, geometry, disposal });
    await page.close();
  }
  console.log(JSON.stringify({ ok: true, reference, results }, null, 2));
} finally { await browser.close(); await server?.close(); }

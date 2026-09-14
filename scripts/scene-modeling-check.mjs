import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { browserOptions } from './browser-options.mjs';
import { PNG } from 'pngjs';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const screenshots = path.join(root, 'screenshots');
await mkdir(screenshots, { recursive: true });
const server = process.env.TIDELINE_URL ? null : await createServer({ root, logLevel: 'error',
  server: { host: '127.0.0.1', port: 4188, strictPort: true } });
await server?.listen();
const browser = await chromium.launch(browserOptions());
const results = [];
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
    try {
      const page = await context.newPage(), errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
      await page.addInitScript(() => localStorage.setItem('tideline.control-guide.v4', 'seen'));
      await page.goto(process.env.TIDELINE_URL || server.resolvedUrls.local[0]);
      await page.waitForFunction(() => window.__TIDELINE__?.getState().initialized);
      await page.click('#start-button');
      await page.waitForFunction(() => window.__TIDELINE__.experience.billiards.initialized);
      await page.waitForTimeout(500);
      const structure = await page.evaluate(() => {
        const e = window.__TIDELINE__.experience;
        const names = ['LoftedBoatHull', 'BoatGunwaleAndStrakes', 'SupportedBoatSeats', 'BoatCoiledMooringLine',
          'HemmedChairSling', 'InstancedWeatheredBoardwalk', 'InstancedBoardwalkPosts', 'BoardwalkRopes', 'BoardwalkUnderstructure'];
        const meshes = names.map((n) => e.scene.getObjectByName(n));
        window.__MODEL_DISPOSALS__ = new Map();
        const geometry = [...new Set(meshes.filter(Boolean).map((m) => m.geometry))];
        geometry.forEach((g) => { window.__MODEL_DISPOSALS__.set(g.uuid, 0);
          g.addEventListener('dispose', () => window.__MODEL_DISPOSALS__.set(g.uuid, window.__MODEL_DISPOSALS__.get(g.uuid) + 1)); });
        const finite = meshes.every((m) => m && [...m.geometry.attributes.position.array].every(Number.isFinite));
        const boat = e.scene.getObjectByName('DetailedFishingBoat'), chair = e.scene.getObjectByName('DetailedCanvasDeckChair');
        const dryDetails = [chair, e.world.boardwalk.understructure,
          ...boat.children.filter((object) => object.name !== 'LoftedBoatHull')];
        const visibility = dryDetails.map((object) => object.visible);
        e.world.beginReflectionPass();
        const reflectionHidden = dryDetails.every((object) => !object.visible)
          && boat.getObjectByName('LoftedBoatHull').visible;
        e.world.endReflectionPass();
        const reflectionRestored = dryDetails.every((object, i) => object.visible === visibility[i]);
        const planks = e.scene.getObjectByName('InstancedWeatheredBoardwalk');
        const grass = e.scene.getObjectByName('InstancedDuneGrass'), matrix = planks.matrix.clone();
        const point = e.camera.position.clone();
        let grassOnDeck = 0;
        for (let i = 0; i < grass.count; i++) {
          grass.getMatrixAt(i, matrix); point.setFromMatrixPosition(matrix);
          if (e.world.boardwalk.surfaceHeightAt(point.x, point.z) !== null) grassOnDeck++;
        }
        const keel = point.set(0, -0.82, 0).applyMatrix4(boat.matrixWorld);
        const keelGap = keel.y - e.world.getWalkSurfaceHeight(14, 20);
        planks.geometry.computeBoundingBox();
        return { names: meshes.map((m) => m?.name), finite, boat: boat.position.toArray(), chair: chair.position.toArray(),
          boardwalk: { count: planks.count, ...planks.userData,
            depth: planks.geometry.boundingBox.max.z - planks.geometry.boundingBox.min.z },
          grassOnDeck, keelGap, reflectionHidden, reflectionRestored, reflectionDetailCount: dryDetails.length,
          characters: e.getDebugState().characters, render: e.getDebugState().render };
      });
      assert.equal(structure.names.filter(Boolean).length, 9);
      assert.equal(structure.finite, true);
      assert.equal(structure.characters, null);
      assert.equal(structure.grassOnDeck, 0);
      assert.equal(structure.reflectionDetailCount, 8);
      assert.equal(structure.reflectionHidden, true);
      assert.equal(structure.reflectionRestored, true);
      assert.ok(structure.keelGap >= -0.1 && structure.keelGap <= 0.03, 'Hull must meet sand without moving its landmark');
      assert.equal(structure.boat[0], 14); assert.equal(structure.boat[2], 20);
      assert.equal(structure.chair[0], -13); assert.equal(structure.chair[2], 27);
      assert.equal(structure.boardwalk.count, mobile ? 24 : 32);
      assert.ok(Math.abs(structure.boardwalk.depth / structure.boardwalk.plankSpacing - 0.94) < 0.00001);
      const style = await page.addStyleTag({ content: 'body * { visibility:hidden !important; } #scene-canvas { visibility:visible !important; }' });
      for (const [name, offset, height] of [
        ['DetailedFishingBoat', [7, 3.8, 5], 0.1],
        ['DetailedCanvasDeckChair', [2.7, 1.1, 3], 1],
        ['WeatheredBeachShade', [5, 3, 6], 1.4],
        ['InstancedWeatheredBoardwalk', [8, 7, 11], 0.2],
      ]) {
        await page.evaluate(({ name, offset, height, mobile }) => {
          const e = window.__TIDELINE__.experience, object = e.scene.getObjectByName(name);
          const target = e.camera.position.clone();
          if (object.isInstancedMesh) object.boundingBox.getCenter(target).applyMatrix4(object.matrixWorld);
          else object.getWorldPosition(target);
          target.y += height;
          e.controls.minDistance = 1; e.controls.target.copy(target);
          e.camera.position.copy(target).add(e.camera.position.clone().fromArray(offset).multiplyScalar(mobile ? 1.6 : 1));
          e.controls.update();
        }, { name, offset, height, mobile });
        await page.waitForTimeout(200);
        const png = PNG.sync.read(await page.screenshot({ path: path.join(screenshots, `model-${mobile ? 'mobile' : 'desktop'}-${name}.png`) }));
        const colors = new Set();
        for (let i = 0; i < png.data.length; i += 128) colors.add(`${png.data[i] >> 4}:${png.data[i + 1] >> 4}:${png.data[i + 2] >> 4}`);
        assert.ok(colors.size > 30, `${name}: nonblank 3D canvas`);
      }
      await style.evaluate((element) => element.remove());
      const disposed = await page.evaluate(() => {
        window.__TIDELINE__.experience.dispose();
        return [...window.__MODEL_DISPOSALS__.values()];
      });
      assert.ok(disposed.length === 9 && disposed.every((n) => n === 1));
      assert.deepEqual(errors, []);
      results.push({ mobile, ...structure, disposed: disposed.length });
    } finally { await context.close(); }
  }
  console.log(JSON.stringify({ ok: true, results }, null, 2));
} finally { await browser.close(); await server?.close(); }

import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { browserOptions } from './browser-options.mjs';
import { PNG } from 'pngjs';
import { createServer } from 'vite';
import { createSurfboardBody } from '../src/experience/CoastalProps.js';

const board = createSurfboardBody();
board.computeBoundingBox();
assert.ok(Math.abs(board.boundingBox.max.y - board.boundingBox.min.y - 3.3) < 0.00001);
assert.ok(board.boundingBox.max.z - board.boundingBox.min.z > 0.22, 'Board must have a curved deck and rocker');
assert.ok(board.index.count / 3 <= 428, 'Curved board stays below old extruded body triangle count');
assert.ok([...board.attributes.position.array, ...board.attributes.normal.array].every(Number.isFinite));
board.dispose();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(root, 'public/models/coastal/manifest.json'), 'utf8'));
for (const asset of manifest) {
  const data = await readFile(path.join(root, 'public/models/coastal', asset.file));
  assert.equal(createHash('sha256').update(data).digest('hex'), asset.sha256);
  assert.equal(asset.license, 'CC0-1.0');
  assert.ok(asset.triangles <= 4500);
}
await mkdir(path.join(root, 'screenshots'), { recursive: true });
const server = process.env.TIDELINE_URL ? null : await createServer({ root, logLevel: 'error',
  server: { host: '127.0.0.1', port: 4189, strictPort: true } });
await server?.listen();
const url = process.env.TIDELINE_URL || server.resolvedUrls.local[0];
const browser = await chromium.launch(browserOptions());
const results = [];
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
    try {
      const page = await context.newPage(), errors = [], requests = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('request', (r) => { if (r.url().includes('/models/coastal/')) requests.push(r.url()); });
      await page.addInitScript(() => localStorage.setItem('tideline.control-guide.v4', 'seen'));
      await page.goto(url);
      await page.waitForFunction(() => window.__TIDELINE__?.getState().initialized);
      await page.click('#start-button');
      await page.waitForTimeout(700);
      const state = await page.evaluate(() => {
        const e = window.__TIDELINE__.experience, props = e.coastalProps;
        const resources = new Set();
        for (const root of [props.root, props.reflectedRoot, ...props.sourceRoots]) root.traverse((m) => {
          if (m.geometry) resources.add(m.geometry);
          const materials = Array.isArray(m.material) ? m.material : [m.material];
          for (const material of materials.filter(Boolean)) {
            resources.add(material);
            for (const value of Object.values(material)) if (value?.isTexture) resources.add(value);
          }
        });
        window.__COASTAL_DISPOSES__ = new Map([...resources].map((r) => [r.uuid, 0]));
        for (const r of resources) r.addEventListener('dispose', () => window.__COASTAL_DISPOSES__.set(r.uuid, window.__COASTAL_DISPOSES__.get(r.uuid) + 1));
        let textured = 0, finite = true;
        props.root.traverse((m) => { if (m.isInstancedMesh) {
          textured += Boolean(m.material.map && m.material.normalMap && m.material.roughnessMap);
          finite &&= [...m.geometry.attributes.position.array].every(Number.isFinite);
        } });
        const surfaceStyles = new Set();
        props.root.traverse((m) => { if (m.isMesh) surfaceStyles.add(m.material.userData.coastalSurface); });
        const cloth = e.scene.getObjectByName('HemmedChairSling').material;
        const wood = e.scene.getObjectByName('LoftedBoatHull').material;
        const materialStyle = {
          types: [...surfaceStyles].sort(), chair: cloth.userData.coastalSurface,
          clothColor: cloth.color.getHex(), boatColor: wood.userData.uniforms?.uPaintColor.value.getHex(),
          skyLinked: e.environment.sky.material.fragmentShader.includes('uCoastalDaylight')
            && e.environment.environmentSky.material.fragmentShader.includes('uCoastalDaylight'),
        };
        e.world.beginReflectionPass();
        const hidden = !props.root.visible && props.reflectedRoot.visible;
        e.world.endReflectionPass();
        return { ...props.getState(), materialStyle, hidden, restored: props.root.visible, finite, textured,
          grounded: props.placements.every((p) => Math.abs(p.minY - p.ground) < 0.0001), render: e.getDebugState().render };
      });
      assert.equal(state.loaded.length, 6); assert.deepEqual(state.errors, []);
      assert.equal(state.instances, 16); assert.ok(state.textured >= 6);
      assert.equal(state.replacedShoreRocks, 26); assert.equal(state.shoreShaderCompiled, true);
      assert.ok(state.shoreTriangles <= 13000);
      assert.ok(state.finite && state.grounded && state.hidden && state.restored);
      assert.ok(state.triangles <= 55000 && state.batches <= 12);
      assert.equal(requests.length, 6);
      assert.deepEqual(state.materialStyle.types, ['cloth', 'paint', 'scanned-pbr']);
      assert.equal(state.materialStyle.chair, 'cloth');
      assert.equal(state.materialStyle.clothColor, 0xad7066);
      if (!mobile) assert.equal(state.materialStyle.boatColor, 0x588f91);
      assert.equal(state.materialStyle.skyLinked, true);
      const style = await page.addStyleTag({ content: 'body * { visibility:hidden !important; } #scene-canvas { visibility:visible !important; }' });
      for (const [name, target, offset] of [
        ['overview', null, null], ['picnic', [-21, 0, 26], [5, 3.8, 6]],
        ['equipment', [38, 1.1, 25.8], [5.5, 3, 7]], ['shore', [-31, 0.4, 12.5], [6, 3, 7]],
      ]) {
        if (target) await page.evaluate(({ target, offset, mobile }) => {
          const e = window.__TIDELINE__.experience;
          const look = e.camera.position.clone().fromArray(target);
          look.y += e.world.getWalkSurfaceHeight(look.x, look.z);
          e.controls.minDistance = 1; e.controls.target.copy(look);
          e.camera.position.copy(look).add(e.camera.position.clone().fromArray(offset).multiplyScalar(mobile ? 1.35 : 1));
          e.controls.update();
        }, { target, offset, mobile });
        await page.waitForTimeout(250);
        const image = PNG.sync.read(await page.screenshot({ path: path.join(root, 'screenshots', `coastal-${mobile ? 'mobile' : 'desktop'}-${name}.png`) }));
        const colors = new Set();
        for (let i = 0; i < image.data.length; i += 128) colors.add(`${image.data[i] >> 4}:${image.data[i + 1] >> 4}:${image.data[i + 2] >> 4}`);
        assert.ok(colors.size > 50, `${name}: nonblank canvas`);
      }
      await style.evaluate((s) => s.remove());
      const quality = await page.evaluate(() => {
        const e = window.__TIDELINE__.experience, props = e.coastalProps, uuid = props.root.uuid;
        e.setQuality('low'); e.setQuality('high');
        return { same: e.coastalProps === props && uuid === props.root.uuid,
          registered: e.world.cameraColliderCount, colliders: props.colliders.length,
          prematureDisposals: [...window.__COASTAL_DISPOSES__.values()].some((n) => n > 0) };
      });
      assert.ok(quality.same && !quality.prematureDisposals);
      assert.ok(quality.registered > quality.colliders);
      assert.equal(requests.length, 6, 'Quality rebuild must not redownload assets');
      const disposed = await page.evaluate(() => {
        const e = window.__TIDELINE__.experience, root = e.coastalProps.root, reflected = e.coastalProps.reflectedRoot;
        e.dispose();
        return { detached: !root.parent && !reflected.parent, counts: [...window.__COASTAL_DISPOSES__.values()] };
      });
      assert.ok(disposed.detached && disposed.counts.every((n) => n === 1));
      assert.deepEqual(errors, []);
      results.push({ mobile, ...state, resourcesDisposed: disposed.counts.length });
    } finally { await context.close(); }
  }
  const page = await browser.newPage();
  await page.route('**/models/coastal/*.glb', (route) => route.fulfill({ status: 404, body: 'Missing test asset' }));
  await page.goto(url);
  await page.waitForFunction(() => window.__TIDELINE__?.getState().initialized);
  const fallback = await page.evaluate(() => window.__TIDELINE__.getState().coastalProps);
  assert.equal(fallback.errors.length, 6);
  assert.equal(fallback.loaded.length, 0);
  const earlyDispose = await page.evaluate(async () => {
    const e = window.__TIDELINE__.experience;
    const pending = new e.coastalProps.constructor({ scene: e.scene, world: e.world });
    pending.dispose();
    await pending.ready;
    return pending.disposed && !pending.root.parent && !pending.reflectedRoot.parent && pending.sourceRoots.length === 0;
  });
  assert.equal(earlyDispose, true);
  await page.close();
  console.log(JSON.stringify({ ok: true, results, missingAssets: 'base scene stays usable' }, null, 2));
} finally { await browser.close(); await server?.close(); }

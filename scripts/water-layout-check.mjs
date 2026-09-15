import assert from 'node:assert/strict';
import { RENDER_BUDGETS } from './render-budgets.mjs';
import { chromium } from 'playwright-core';
import { browserOptions } from './browser-options.mjs';
import { createServer } from 'vite';
import { PNG } from 'pngjs';
import { BEACH_WALK_ROUTE, distanceToBeachWalk } from '../src/experience/CoastalLayout.js';

for (const [x, z] of BEACH_WALK_ROUTE) assert.equal(distanceToBeachWalk(x, z), 0);
const server = process.env.TIDELINE_URL ? null : await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 4195, strictPort: true } });
await server?.listen();
const browser = await chromium.launch(browserOptions());
const results = [];
try {
  for (const mobile of [false, true]) {
    const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
    await page.addInitScript(() => localStorage.setItem('tideline.control-guide.v4', 'seen'));
    await page.goto(process.env.TIDELINE_URL || server.resolvedUrls.local[0]);
    await page.waitForFunction(() => window.__TIDELINE__?.getState().initialized);
    await page.click('#start-button');
    await page.evaluate(async () => { const e = window.__TIDELINE__.experience; await e.npcs.ready; await e.coastalProps.ready; });
    await page.waitForTimeout(700);
    const prefix = `screenshots/water-layout-${mobile ? 'mobile' : 'desktop'}`;
    const overview = PNG.sync.read(await page.screenshot({ path: `${prefix}-overview.png` }));
    const colors = new Set();
    for (let i = 0; i < overview.data.length; i += 64) colors.add(`${overview.data[i] >> 4},${overview.data[i + 1] >> 4},${overview.data[i + 2] >> 4}`);
    assert.ok(colors.size > 60, 'Nonblank scene');
    const layout = await page.evaluate(() => {
      const e = window.__TIDELINE__.experience, rack = e.coastalProps.colliders.find(c => c.name === 'surfboard-rack');
      const board = e.scene.getObjectByName('SurfboardCollection');
      board.geometry.computeBoundingBox();
      const bounds = board.geometry.boundingBox;
      const center = bounds.getCenter(e.camera.position.clone());
      const collision = e.world.resolveCameraPosition(center.clone(), { previousPosition: center.clone().add({ x: 0, y: 0, z: 2 }), radius: 0.25, eyeHeight: 1.65 });
      const primary = [];
      for (const x of [-3.7, 3.7]) for (const y of [0.5, 2.6]) for (const z of [29.075, 33.325]) primary.push(e.camera.position.clone().set(x, y, z).project(e.camera).toArray());
      const boatBounds = new bounds.constructor().setFromObject(e.scene.getObjectByName('DetailedFishingBoat'), true);
      for (const x of [boatBounds.min.x, boatBounds.max.x]) for (const y of [boatBounds.min.y, boatBounds.max.y]) for (const z of [boatBounds.min.z, boatBounds.max.z]) primary.push(e.camera.position.clone().set(x, y, z).project(e.camera).toArray());
      return { rack, center: center.toArray(), collision: collision?.names,
        framed: primary.every(p => Math.abs(p[0]) < 0.99 && Math.abs(p[1]) < 0.99 && p[2] < 1),
        table: e.billiards.group.position.toArray(), npc: e.npcs.getState().loaded, render: e.getDebugState().render,
        overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.equal(layout.rack.x, 38); assert.equal(layout.rack.z, 24);
    assert.ok(Math.abs(layout.center[0] - layout.rack.x) < 0.5 && Math.abs(layout.center[2] - layout.rack.z) < 0.7);
    assert.ok(layout.collision.includes('surfboard-rack'));
    assert.equal(layout.table[0], 0); assert.equal(layout.table[2], 31.2); assert.equal(layout.npc, 10); assert.equal(layout.overflow, false);
    assert.equal(layout.framed, true, 'The complete boat and table must fit in the entry camera');
    if (mobile) {
      assert.equal(await page.locator('#billiards-details').isVisible(), false);
      await page.click('#billiards-fold');
      assert.equal(await page.locator('#billiards-details').isVisible(), true);
      await page.click('#billiards-fold');
      assert.equal(await page.locator('#billiards-details').isVisible(), false);
    }
    const budget = RENDER_BUDGETS[mobile ? 'mobile' : 'desktop'];
    assert.ok(layout.render.calls <= budget.calls); assert.ok(layout.render.triangles <= budget.triangles);

    const depth = await page.evaluate(() => {
      const e = window.__TIDELINE__.experience, refraction = e.environment.oceanRefraction, renderer = e.renderer;
      renderer.setAnimationLoop(null);
      const sampleScene = new e.scene.constructor(), emptyScene = new e.scene.constructor();
      const target = new refraction.target.constructor(32, 32);
      const material = new e.environment.water.material.constructor({
        uniforms: { depthMap: { value: refraction.target.depthTexture } },
        vertexShader: 'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',
        fragmentShader: 'uniform sampler2D depthMap; void main(){float d=texture2D(depthMap,gl_FragCoord.xy/32.0).x; gl_FragColor=vec4(vec3(1.0-clamp((1.0-d)*300.0,0.0,1.0)),1.0);}',
      });
      const geometry = new e.environment.water.geometry.constructor(2, 2);
      sampleScene.add(new e.world.beach.constructor(geometry, material));
      const pixels = () => {
        const previous = renderer.getRenderTarget(), bytes = new Uint8Array(32 * 32 * 4);
        renderer.setRenderTarget(target); renderer.render(sampleScene, e.camera); renderer.readRenderTargetPixels(target, 0, 0, 32, 32, bytes); renderer.setRenderTarget(previous);
        return Array.from(bytes).filter((_, i) => i % 4 === 0);
      };
      try {
        refraction.capture(renderer, e.scene, e.camera);
        const populated = Math.min(...pixels());
        renderer.state.buffers.depth.setMask(false);
        refraction.capture(renderer, emptyScene, e.camera);
        const cleared = Math.min(...pixels());
        const history = [];
        for (const p of [[10, 65, 32], [17, 3, 18], [-32, 6, 15]]) {
          e.camera.position.fromArray(p); e.camera.lookAt(0, 0, -8); e.camera.updateMatrixWorld(true);
          renderer.state.buffers.depth.setMask(false);
          refraction.capture(renderer, e.scene, e.camera);
          const afterMovement = pixels();
          renderer.state.buffers.depth.setMask(true);
          refraction.capture(renderer, e.scene, e.camera);
          const pixelsFresh = pixels();
          history.push(afterMovement.every((v, i) => v === pixelsFresh[i]));
        }
        return { populated, cleared, history };
      } finally {
        renderer.state.buffers.depth.setMask(true); target.dispose(); material.dispose(); geometry.dispose();
        renderer.setAnimationLoop(e.animate);
      }
    });
    assert.ok(depth.populated < 254); assert.equal(depth.cleared, 255, 'Transparent depthWrite=false must not preserve stale depth');
    assert.ok(depth.history.every(Boolean), 'Depth must not depend on previous camera');
    const tides = [];
    for (const mode of ['low', 'high']) {
      tides.push(await page.evaluate(mode => {
        const e = window.__TIDELINE__.experience;
        e.cameraTween = null; e.controls.minDistance = 1;
        e.controls.target.set(5, 0, 0); e.camera.position.set(18, 4.5, 23); e.controls.update();
        e.setTideMode(mode, true);
        return { mode, water: e.environment.water.position.y, foam: e.world.foamMaterial.uniforms.uWaterHeight.value,
          sand: e.world.sandMaterial.userData.uniforms.uWaterHeight.value, foamZ: e.world.foam.position.z };
      }, mode));
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${prefix}-${mode}-tide.png` });
    }
    assert.ok(tides[1].water - tides[0].water > 0.31);
    assert.ok(tides.every(t => t.foam === t.water && t.sand === t.water));
    assert.equal(tides[0].foamZ, tides[1].foamZ, 'Terrain-attached swash vertices must not slide over a different sand height');
    await page.evaluate(() => {
      const e = window.__TIDELINE__.experience;
      e.controls.target.set(38, 1.3, 25); e.camera.position.set(43, 5, 34); e.controls.update();
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${prefix}-equipment.png` });
    await page.evaluate(() => window.__TIDELINE__.experience.dispose());
    assert.deepEqual(errors, []);
    results.push({ mobile, colors: colors.size, layout, depth, tides });
    await page.close();
  }
  console.log(JSON.stringify({ ok: true, results }, null, 2));
} finally { await browser.close(); await server?.close(); }

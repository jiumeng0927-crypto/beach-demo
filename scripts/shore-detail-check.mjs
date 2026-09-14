import assert from 'node:assert/strict';
import { RENDER_BUDGETS } from './render-budgets.mjs';
import { chromium } from 'playwright-core';
import { browserOptions } from './browser-options.mjs';
import { createServer } from 'vite';
import { PNG } from 'pngjs';

const server = process.env.TIDELINE_URL ? null : await createServer({ logLevel: 'error',
  server: { host: '127.0.0.1', port: 4196, strictPort: true } });
await server?.listen();
const browser = await chromium.launch(browserOptions());
const results = [];
try {
  for (const mobile of [false, true]) {
    const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      isMobile: mobile, hasTouch: mobile });
    const errors = [], requests = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
    page.on('request', r => { if (r.url().includes('/models/coastal/')) requests.push(r.url()); });
    await page.addInitScript(() => localStorage.setItem('tideline.control-guide.v4', 'seen'));
    await page.goto(process.env.TIDELINE_URL || server.resolvedUrls.local[0]);
    await page.waitForFunction(() => window.__TIDELINE__?.getState().initialized);
    await page.click('#start-button');
    await page.waitForTimeout(700);
    await page.evaluate(() => {
      const e = window.__TIDELINE__.experience;
      e.setQuality(innerWidth < 720 ? 'low' : 'high');
      e.renderer.setAnimationLoop(null);
      e.cameraTween = null;
      e.controls.minDistance = 1;
      e.renderScene(0);
    });
    const prefix = `screenshots/shore-detail-${mobile ? 'mobile' : 'desktop'}`;
    await page.screenshot({ path: `${prefix}-overview.png` });
    await page.addStyleTag({ content: 'body * { visibility:hidden !important; } #scene-canvas { visibility:visible !important; }' });
    const clearance = await page.evaluate(() => {
      const e = window.__TIDELINE__.experience, p = e.coastalProps;
      const inspect = () => {
        const g = e.world.details.grass, m = g.matrix.clone(), b = g.geometry.boundingBox.clone();
        let overlaps = 0, onWalkway = 0;
        for (let i = 0; i < g.count; i++) {
          g.getMatrixAt(i, m);
          b.copy(g.geometry.boundingBox).applyMatrix4(m).expandByScalar(0.2);
          if (p.vegetationBounds.some(v => b.max.x >= v.min.x && b.min.x <= v.max.x && b.max.z >= v.min.z && b.min.z <= v.max.z)) overlaps++;
          if (e.world.boardwalk.surfaceHeightAt(m.elements[12], m.elements[14]) !== null) onWalkway++;
        }
        const before = [...g.instanceMatrix.array];
        p.bindWorld(e.world);
        return { overlaps, onWalkway, moved: g.userData.clearanceMoved, count: g.count,
          stable: before.every((v, i) => v === g.instanceMatrix.array[i]),
          finite: [...g.instanceMatrix.array].every(Number.isFinite) };
      };
      const initial = inspect(), root = p.root.uuid, waterUniform = p.waterHeight;
      e.setQuality('low'); const low = inspect();
      e.setQuality('high'); const high = inspect();
      e.setQuality(innerWidth < 720 ? 'low' : 'high');
      return { initial, low, high, retained: root === p.root.uuid && waterUniform === p.waterHeight };
    });
    for (const state of [clearance.initial, clearance.low, clearance.high]) {
      assert.equal(state.overlaps, 0, 'Entire grass clump and wind margin must clear loaded assets');
      assert.equal(state.onWalkway, 0); assert.ok(state.moved > 0 && state.stable && state.finite);
    }
    assert.equal(clearance.low.count, 200); assert.equal(clearance.high.count, 460);
    assert.equal(clearance.retained, true); assert.equal(requests.length, 6);
    await page.evaluate(() => {
      const e = window.__TIDELINE__.experience;
      e.controls.target.set(38, 1.3, 25); e.camera.position.set(43, 5, 34); e.controls.update(); e.renderScene(0);
    });
    await page.screenshot({ path: `${prefix}-equipment.png` });
    const tides = [];
    for (const mode of ['low', 'high']) {
      tides.push(await page.evaluate(mode => {
        const e = window.__TIDELINE__.experience;
        e.environment.setWaveSpeed(0);
        e.setTideMode(mode, true);
        e.environment.update(0, mode === 'high' ? 100 : 7);
        e.coastalProps.updateTide(e.environment.water.position.y);
        e.controls.target.set(-23, 0.35, 7); e.camera.position.set(-15, 4, 15); e.controls.update(); e.renderScene(0);
        const rocks = e.coastalProps.shoreBatch.material, boat = e.scene.getObjectByName('DistantSailboat');
        return { mode, water: e.environment.water.position.y, boat: boat.position.y,
          boatAngle: boat.rotation.toArray(), wet: rocks.userData.tidalWetness.value,
          compiled: rocks.userData.tidalWetnessCompiled, mapped: Boolean(rocks.map && rocks.normalMap && rocks.roughnessMap),
          fallbackLinked: e.world.materials.rock.every(m => m.userData.tidalWetness === e.world.sandMaterial.userData.uniforms.uWaterHeight) };
      }, mode));
      await page.screenshot({ path: `${prefix}-${mode}-tide.png` });
    }
    assert.ok(tides.every(t => t.water === t.wet && t.compiled && t.mapped && t.fallbackLinked));
    assert.ok(Math.abs(tides[1].boat - tides[0].boat - 0.32) < 0.000001);
    assert.deepEqual(tides[0].boatAngle, tides[1].boatAngle, 'Frozen water clock must freeze boat rocking');

    // Freeze everything except the actual PBR wetness uniform; water pixels cannot fake this result.
    await page.evaluate(() => {
      const e = window.__TIDELINE__.experience;
      e.environment.water.visible = false; e.world.foam.visible = false;
      e.coastalProps.updateTide(-0.16); e.renderScene(0);
    });
    const dry = PNG.sync.read(await page.screenshot());
    await page.evaluate(() => { const e = window.__TIDELINE__.experience; e.coastalProps.updateTide(0.16); e.renderScene(0); });
    const wet = PNG.sync.read(await page.screenshot());
    let changed = 0, darkened = 0;
    for (let i = 0; i < dry.data.length; i += 4) {
      const a = dry.data[i] + dry.data[i + 1] + dry.data[i + 2], b = wet.data[i] + wet.data[i + 1] + wet.data[i + 2];
      if (Math.abs(a - b) > 3) changed++;
      if (a - b > 3) darkened++;
    }
    assert.ok(changed > 50 && darkened > changed * 0.55, 'Tide must visibly darken actual scanned PBR rock pixels');
    assert.ok(changed < dry.width * dry.height * 0.08, 'Wetness must not recolor the whole scene');
    const last = await page.evaluate(() => {
      const e = window.__TIDELINE__.experience;
      e.environment.water.visible = true; e.world.foam.visible = true;
      e.controls.target.copy(e.defaultCameraTarget); e.camera.position.copy(e.defaultCameraPosition); e.controls.update();
      e.renderer.info.reset();
      e.renderScene(0);
      const render = e.getDebugState().render;
      e.renderer.setAnimationLoop(e.animate);
      return { render, table: e.billiards.group.position.toArray(), npc: e.npcs.getState().loaded };
    });
    assert.equal(last.table[2], 31.2); assert.equal(last.npc, 2);
    const budget = RENDER_BUDGETS[mobile ? 'mobile' : 'desktop'];
    assert.ok(last.render.calls <= budget.calls && last.render.triangles <= budget.triangles, JSON.stringify(last.render));
    await page.waitForTimeout(300);
    const linked = await page.evaluate(() => {
      const e = window.__TIDELINE__.experience;
      return e.coastalProps.waterHeight.value === e.environment.water.position.y;
    });
    assert.equal(linked, true);
    await page.evaluate(() => window.__TIDELINE__.experience.dispose());
    assert.deepEqual(errors, []);
    results.push({ mobile, clearance, tides, pixels: { changed, darkened }, last });
    await page.close();
  }

  const fallbackPage = await browser.newPage();
  const shaderErrors = [];
  fallbackPage.on('pageerror', e => shaderErrors.push(e.message));
  fallbackPage.on('console', e => { if (/shader error|validate_status/i.test(e.text())) shaderErrors.push(e.text()); });
  await fallbackPage.route('**/models/coastal/*.glb', r => r.fulfill({ status: 404, body: 'Missing test asset' }));
  await fallbackPage.goto(process.env.TIDELINE_URL || server.resolvedUrls.local[0]);
  await fallbackPage.waitForFunction(() => window.__TIDELINE__?.getState().initialized);
  for (const quality of ['high', 'low']) {
    const fallback = await fallbackPage.evaluate(quality => {
      const e = window.__TIDELINE__.experience;
      e.setQuality(quality); e.renderer.setAnimationLoop(null); e.setTideMode('high', true);
      e.renderer.compile(e.scene, e.camera);
      e.renderScene(0);
      return { compiled: e.world.materials.rock.every(m => m.userData.tidalWetnessCompiled),
        quality, materials: e.world.materials.rock.map(m => ({ compiled: m.userData.tidalWetnessCompiled, water: m.userData.tidalWetness?.value })),
        water: e.environment.water.position.y,
        waterLinked: e.world.materials.rock.every(m => m.userData.tidalWetness.value === e.environment.water.position.y),
        visible: e.world.rockClusters.every(m => m.visible) };
    }, quality);
    assert.ok(fallback.compiled && fallback.waterLinked && fallback.visible, JSON.stringify(fallback));
  }
  await fallbackPage.evaluate(() => window.__TIDELINE__.experience.dispose());
  assert.deepEqual(shaderErrors, []);
  await fallbackPage.close();
  console.log(JSON.stringify({ ok: true, results, fallback: 'both quality levels compiled and tide-linked' }, null, 2));
} finally { await browser.close(); await server?.close(); }

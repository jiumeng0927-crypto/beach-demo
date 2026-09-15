import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { PNG } from 'pngjs';
import { browserOptions } from './browser-options.mjs';

const folder = 'screenshots/street';
await mkdir(folder, { recursive: true });
const server = process.env.TIDELINE_URL ? null : await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 4196, strictPort: true } });
await server?.listen();
const browser = await chromium.launch(browserOptions()), results = [];
try {
  for (const mobile of [false, true]) {
    const label = mobile ? 'mobile' : 'desktop';
    const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.addInitScript(() => localStorage.setItem('tideline.control-guide.v4', 'seen'));
    await page.goto(process.env.TIDELINE_URL ?? server.resolvedUrls.local[0]);
    await page.waitForFunction(() => window.__TIDELINE__?.getState().initialized);
    await page.click('#start-button');
    await page.evaluate(async mobile => {
      const e = window.__TIDELINE__.experience;
      await e.coastalProps.ready; await e.npcs.ready;
      e.setQuality(mobile ? 'low' : 'high');
      e.environment.dayClock.running = false; e.environment.setTimeOfDay('day', true);
    }, mobile);
    // Exercise the real UI shortcut, including exiting billiards aim mode.
    await page.click('#settings-button');
    await page.click('#street-view');
    await page.waitForFunction(() => !window.__TIDELINE__.experience.cameraTween);
    const state = await page.evaluate(() => {
      const e = window.__TIDELINE__.experience, street = e.world.street;
      const meshes = [], ray = new e.discovery.raycaster.constructor();
      street.root.updateMatrixWorld(true); street.root.traverse(o => { if (o.isMesh) meshes.push(o); });
      const groundMeshes = [...street.roads, ...street.root.children.filter(m => ['ShopApron', 'StreetBeachAccess'].includes(m.name))];
      let maxSurfaceError = 0;
      const probes = [];
      for (let x = -44; x <= 44; x += 3.3) for (const side of [-5.1, -2, 0, 2, 5.1]) probes.push([x, street.profile.sampleAt(x).z + side]);
      for (let z = 42.1; z < 59.1; z += 0.71) probes.push([-6, z]);
      for (let x = -30; x < -22; x += 0.9) for (let z = 71.1; z < 74.4; z += 0.7) probes.push([x, z]);
      for (const [x, z] of probes) {
        ray.set(e.camera.position.clone().set(x, 100, z), e.camera.position.clone().set(0, -1, 0));
        const hit = ray.intersectObjects(groundMeshes)[0];
        const height = street.surfaceHeightAt(x, z);
        if (!hit || height === null) throw new Error(`Missing street surface at ${x},${z}`);
        maxSurfaceError = Math.max(maxSurfaceError, Math.abs(hit.point.y - height));
      }
      const floor = street.shopFloors[0], position = e.camera.position.clone().set(floor.x, floor.y + 1.68, 76.35);
      const collision = e.world.resolveCameraPosition(position, { previousPosition: position.clone().setZ(75.7), radius: 0.42, eyeHeight: 1.68 });
      const geometry = new Set(meshes.map(m => m.geometry));
      const material = new Set(meshes.map(m => m.material));
      const texture = new Set([...material].flatMap(m => Object.values(m).filter(v => v?.isTexture)));
      window.__STREET_DISPOSES__ = [...geometry, ...material, ...texture].map(resource => {
        const record = { uuid: resource.uuid, count: 0 }; resource.addEventListener('dispose', () => record.count++); return record;
      });
      const shader = e.environment.water.material.fragmentShader;
      const walkers = e.npcs.items.filter(i => i.spec.route);
      const before = walkers.map(i => i.root.position.x);
      for (let i = 0; i < 20; i++) e.npcs.update(0.05);
      const patrol = walkers.every((i, n) => Math.abs(i.root.position.x - before[n]) > 0.3
        && Math.abs(i.collider.x - i.root.position.x) < 1e-8
        && Math.abs(i.root.position.y - e.world.getWalkSurfaceHeight(i.root.position.x, i.root.position.z)) < 1e-8);
      e.npcs.open('fan');
      const stopped = walkers[0].root.position.x;
      e.npcs.update(0.2);
      const conversationPausesPatrol = walkers[0].root.position.x === stopped;
      document.querySelector('#npc-dialog').close(); e.npcs.close();
      return { shops: street.root.children.filter(o => o.name.startsWith('StreetShop-')).length,
        maxSurfaceError, collision: Boolean(collision), collisionZ: position.z, boundsZ: e.freeCamera.bounds.max.z,
        triangles: meshes.reduce((sum, m) => sum + (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3 * (m.isInstancedMesh ? m.count : 1), 0),
        finite: meshes.every(m => [...m.geometry.attributes.position.array, ...m.geometry.attributes.normal.array].every(Number.isFinite)),
        imported: e.coastalProps.getState(), materials: material.size, textures: texture.size,
        fogAfterOutput: shader.lastIndexOf('mix(gl_FragColor.rgb, fogColor') > shader.indexOf('#include <colorspace_fragment>'),
        inlandScrub: e.world.sandMaterial.userData.shader.fragmentShader.includes('float inlandMask'),
        plantingInstances: meshes.filter(m => m.name === 'StreetBacklandPlanting').reduce((sum, m) => sum + m.count, 0),
        roadExtent: street.roads[0].geometry.boundingBox.max.x,
        npcs: e.npcs.getState(), patrol, conversationPausesPatrol,
        aimMode: e.billiardsViewMode, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.equal(state.shops, 3); assert.ok(state.maxSurfaceError < 0.0001, `Walk surface diverges from mesh: ${state.maxSurfaceError}`);
    assert.ok(state.collision && state.collisionZ < 76.35); assert.equal(state.boundsZ, 87);
    assert.ok(state.finite && state.fogAfterOutput); assert.equal(state.overflow, false); assert.equal(state.aimMode, null);
    assert.ok(state.imported.loaded.includes('outdoor_table_chair_set_01') && state.imported.loaded.includes('planter_box_01'));
    assert.deepEqual(state.imported.errors, []);
    assert.equal(state.npcs.loaded, 10); assert.equal(state.npcs.sources, 4);
    assert.ok(!state.inlandScrub && state.patrol && state.conversationPausesPatrol);
    assert.equal(state.plantingInstances, 0); assert.equal(state.roadExtent, 52);
    await page.screenshot({ path: `${folder}/${label}-overview-ui.png` });
    await page.addStyleTag({ content: 'body * { visibility:hidden !important; } #scene-canvas { visibility:visible !important; }' });
    for (const [name, position, target, period] of [
      ['overview', null, null, 'day'], ['cafe', [-24, 6, 64], [-26, 3.5, 80], 'day'],
      ['street', [35, 8, 53], [-14, 3, 73], 'day'], ['night', [-4, 10, 49], [-6, 3.5, 78], 'night'],
    ]) {
      await page.evaluate(({ position, target, period }) => {
        const e = window.__TIDELINE__.experience;
        e.environment.setTimeOfDay(period, true);
        if (position) e.startCameraTween(e.camera.position.clone().fromArray(position), e.controls.target.clone().fromArray(target));
      }, { position, target, period });
      await page.waitForFunction(() => !window.__TIDELINE__.experience.cameraTween);
      await page.waitForTimeout(300);
      const pixels = PNG.sync.read(await page.screenshot({ path: `${folder}/${label}-${name}.png` }));
      const colors = new Set();
      for (let i = 0; i < pixels.data.length; i += 124) colors.add(`${pixels.data[i] >> 3},${pixels.data[i+1] >> 3},${pixels.data[i+2] >> 3}`);
      assert.ok(colors.size > 60, `${label}-${name}: blank/unlit street`);
    }
    const lifecycle = await page.evaluate(() => {
      const e = window.__TIDELINE__.experience;
      const old = e.world.street.root;
      e.setQuality(innerWidth < 720 ? 'high' : 'low');
      const counts = window.__STREET_DISPOSES__.map(r => r.count);
      const rebound = e.world.street.root !== old && !old.parent?.parent;
      e.dispose(); return { counts, rebound };
    });
    assert.ok(lifecycle.rebound && lifecycle.counts.every(n => n === 1), 'Street resources must be released exactly once');
    assert.deepEqual(errors, []); results.push({ label, ...state, disposed: lifecycle.counts.length });
    await page.close();
  }
  await writeFile(`${folder}/results.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ ok: true, results }, null, 2));
} finally { await browser.close(); await server?.close(); }

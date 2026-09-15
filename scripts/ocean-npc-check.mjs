import assert from 'node:assert/strict';
import { RENDER_BUDGETS } from './render-budgets.mjs';
import { chromium } from 'playwright-core';
import { browserOptions } from './browser-options.mjs';
import { createServer } from 'vite';
import { PNG } from 'pngjs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createOceanGeometry } from '../src/experience/OceanWater.js';

for (const asset of JSON.parse(await readFile(new URL('../public/models/npc/manifest.json', import.meta.url), 'utf8'))) {
  const data = await readFile(new URL(`../public/models/npc/${asset.file}`, import.meta.url));
  assert.equal(createHash('sha256').update(data).digest('hex'), asset.sha256);
  assert.equal(asset.license, 'CC0-1.0');
}

for (const quality of ['high', 'low']) {
  const g = createOceanGeometry(quality), p = g.attributes.position, a = g.index.array;
  assert.ok([...p.array, ...g.attributes.oceanSpacing.array].every(Number.isFinite));
  for (let i = 0; i < a.length; i += 3) {
    const [u, v, w] = a.slice(i, i + 3);
    assert.ok((p.getX(v) - p.getX(u)) * (p.getY(w) - p.getY(u))
      - (p.getY(v) - p.getY(u)) * (p.getX(w) - p.getX(u)) > 0, 'Ocean must face up');
  }
  assert.equal(a.length / 3, quality === 'high' ? 24580 : 13828);
  g.dispose();
}
const server = process.env.TIDELINE_URL ? null : await createServer({ logLevel: 'error',
  server: { host: '127.0.0.1', port: 4191, strictPort: true } });
await server?.listen();
const url = process.env.TIDELINE_URL || server.resolvedUrls.local[0];
const browser = await chromium.launch(browserOptions());
const results = [];
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      isMobile: mobile, hasTouch: mobile });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    await page.addInitScript(() => localStorage.setItem('tideline.control-guide.v4', 'seen'));
    await page.goto(url);
    await page.waitForFunction(() => window.__TIDELINE__?.getState().initialized);
    await page.click('#start-button');
    await page.evaluate(async mobile => {
      const e = window.__TIDELINE__.experience;
      await e.npcs.ready;
      // Functional assertions compare one quality profile, not an adaptive
      // profile that may change under headless GPU load during the scenario.
      e.setQuality(mobile ? 'low' : 'high');
    }, mobile);
    await page.waitForTimeout(700);
    const initial = await page.evaluate(() => {
      const e = window.__TIDELINE__.experience;
      return { npcs: e.npcs.getState(), water: e.getDebugState().water, render: e.getDebugState().render,
        colliders: e.world.cameraColliderCount, shots: e.billiards.getDebugState().shots };
    });
    assert.equal(initial.npcs.loaded, 10); assert.deepEqual(initial.npcs.errors, []);
    assert.ok(initial.npcs.items.every(i => i.clips.includes('Idle') && i.animationTime > 0));
    assert.ok(initial.water.refraction.captures > 0 && initial.water.refraction.depth);
    assert.ok(initial.water.refraction.width <= (mobile ? 768 : 1536));
    assert.ok(initial.render.calls < (mobile ? 96 : 180));
    assert.ok(initial.render.triangles < RENDER_BUDGETS[mobile ? 'mobile' : 'desktop'].triangles);
    const depthRange = await page.evaluate(() => {
      const e = window.__TIDELINE__.experience, refraction = e.environment.oceanRefraction;
      const scene = new e.scene.constructor(), target = new refraction.target.constructor(32, 32);
      const material = new e.environment.water.material.constructor({
        uniforms: { depthMap: { value: refraction.target.depthTexture }, near: { value: e.camera.near }, far: { value: e.camera.far } },
        vertexShader: 'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',
        fragmentShader: 'uniform sampler2D depthMap; uniform float near; uniform float far; void main(){float d=texture2D(depthMap,gl_FragCoord.xy/32.0).x; float linear=near*far/(far-(far-near)*d); gl_FragColor=vec4(vec3(clamp(linear/120.0,0.0,1.0)),1.0);}',
      });
      const geometry = new e.environment.water.geometry.constructor(2, 2);
      scene.add(new e.world.beach.constructor(geometry, material));
      const previous = e.renderer.getRenderTarget(), viewport = e.renderer.getViewport(refraction.viewport.clone());
      const pixels = new Uint8Array(32 * 32 * 4);
      try {
        e.renderer.setRenderTarget(target); e.renderer.render(scene, e.camera);
        e.renderer.readRenderTargetPixels(target, 0, 0, 32, 32, pixels);
        const values = [...pixels].filter((_, i) => i % 4 === 0);
        return { min: Math.min(...values), max: Math.max(...values) };
      } finally {
        e.renderer.setRenderTarget(previous); e.renderer.setViewport(viewport);
        target.dispose(); geometry.dispose(); material.dispose();
      }
    });
    assert.ok(depthRange.min < 180 && depthRange.max === 255, JSON.stringify(depthRange));
    await page.screenshot({ path: `screenshots/ocean-npc-${mobile ? 'mobile' : 'desktop'}-overview.png` });
    await page.click('#npc-button');
    await page.click('[data-npc-action="lin"]');
    await page.waitForTimeout(1400);
    assert.equal(await page.locator('#npc-title').textContent(), '小林');
    await page.screenshot({ path: `screenshots/npc-${mobile ? 'mobile' : 'desktop'}-dialog.png` });
    await page.click('[data-npc-action="accept"]');
    assert.equal(await page.evaluate(() => window.__TIDELINE__.experience.npcs.questAccepted), true);
    await page.click('[data-npc-action="hint"]');
    assert.equal(await page.locator('#npc-dialog').evaluate(d => d.open), false);
    await page.waitForTimeout(1400);
    assert.equal(await page.evaluate(() => window.__TIDELINE__.experience.controls.enabled), true);
    await page.evaluate(() => {
      const d = window.__TIDELINE__.experience.discovery;
      for (let chapter = 0; chapter < 3; chapter++) {
        d.tideLevel = -1;
        d.items.forEach((_, i) => d.collect(i, 'test'));
        if (chapter < 2) d.nextChapter();
      }
    });
    await page.click('#npc-button'); await page.click('[data-npc-action="lin"]');
    await page.click('[data-npc-action="claim"]');
    assert.equal(await page.evaluate(() => window.__TIDELINE__.experience.npcs.questClaimed), true);
    await page.click('#npc-close');
    await page.click('#npc-button'); await page.click('[data-npc-action="chen"]');
    await page.click('[data-npc-action="pool"]'); await page.waitForTimeout(1000);
    assert.equal(await page.evaluate(() => window.__TIDELINE__.experience.billiards.getDebugState().shots), initial.shots);
    await page.click('#npc-button'); await page.click('[data-npc-action="yu"]');
    await page.click('[data-npc-action="market"]');
    await page.waitForFunction(() => document.querySelector('#collection-dialog').open);
    assert.equal(await page.locator('#collection-market-panel').isVisible(), true);
    await page.click('#collection-close');

    // Aim directly at the authored mesh and exercise real canvas picking, not only the roster.
    const point = await page.evaluate(() => {
      const e = window.__TIDELINE__.experience, npc = e.npcs.items[0];
      const target = npc.root.position.clone().add({ x: 0, y: 1, z: 0 });
      // Use normal navigation so the white-ball camera relinquishes ownership.
      e.startCameraTween(target.clone().add({ x: 2, y: 1, z: 8 }), target);
      e.updateCameraTween(2); e.controls.update(); e.camera.updateMatrixWorld(true);
      const ndc = target.project(e.camera), rect = e.canvas.getBoundingClientRect();
      return { x: (ndc.x + 1) * rect.width / 2, y: (1 - ndc.y) * rect.height / 2 };
    });
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      window.__POINTER_EVENTS__ = [];
      for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture']) document.addEventListener(type, e => {
        window.__POINTER_EVENTS__.push({ type, target: e.target.id, x: e.clientX, y: e.clientY, id: e.pointerId, button: e.button });
      }, { capture: true });
    });
    console.log('PICK', await page.evaluate(({ x, y }) => {
      const e = window.__TIDELINE__.experience;
      return { pick: e.npcs.pick(x, y)?.spec.id, camera: e.camera.position.toArray(), target: e.controls.target.toArray(),
        element: document.elementFromPoint(x, y)?.id, npc: e.npcs.items[0].root.position.toArray(),
        bounds: new e.environment.water.geometry.boundingBox.constructor().setFromObject(e.npcs.items[0].model, true),
        hits: e.npcs.ray.intersectObject(e.npcs.root, true).map(h => [h.object.name, h.distance]),
        blockers: e.npcs.ray.intersectObject(e.world.root, true).slice(0, 3).map(h => [h.object.name, h.distance]) };
    }, point));
    if (mobile) await page.touchscreen.tap(point.x, point.y); else await page.mouse.click(point.x, point.y);
    console.log('EVENTS', mobile, await page.evaluate(() => ({ events: window.__POINTER_EVENTS__,
      press: window.__TIDELINE__.experience.npcs.press?.id, active: window.__TIDELINE__.experience.npcs.activeId })));
    assert.equal(await page.locator('#npc-dialog').evaluate(d => d.open), true, 'Mesh click must open conversation');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#npc-dialog').evaluate(d => d.open), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    // HTMLDialogElement removes open before its queued close event resets
    // activeId. Wait for that state transition before sending a new E press.
    await page.waitForFunction(() => window.__TIDELINE__.experience.npcs.activeId === null);

    // The same E path supports the existing unlocked movement fallback used in tests.
    await page.evaluate(() => {
      const e = window.__TIDELINE__.experience, p = e.npcs.items[0].root.position;
      e.setCameraMode('walk', { requestPointerLock: false });
      e.camera.position.copy(p).add({ x: 0, y: 1.65, z: 3 });
      e.freeCamera.snapToGround();
      e.camera.lookAt(p.clone().add({ x: 0, y: 1.2, z: 0 })); e.camera.updateMatrixWorld(true);
    });
    await page.keyboard.press('e');
    if (!await page.locator('#npc-dialog').evaluate(d => d.open)) console.log('NEARBY_DIAGNOSTIC', await page.evaluate(() => {
      const e = window.__TIDELINE__.experience, rect = e.canvas.getBoundingClientRect();
      const pick = e.npcs.pick(rect.x + rect.width / 2, rect.y + rect.height / 2, 4.5);
      return { mode: e.cameraMode, free: e.freeCamera.getDebugState(), camera: e.camera.position.toArray(),
        direction: e.camera.getWorldDirection(e.camera.position.clone()).toArray(), npc: e.npcs.items[0].root.position.toArray(),
        pick: pick?.spec.id, active: e.npcs.activeId, focused: document.activeElement.id,
        blockers: e.npcs.ray.intersectObjects([e.world.root, e.coastalProps.root, e.billiards.group], true).map(h => [h.object.name,h.distance]) };
    }));
    assert.equal(await page.locator('#npc-dialog').evaluate(d => d.open), true, 'Nearby E must open NPC');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__TIDELINE__.experience.npcs.activeId === null);
    const reuse = await page.evaluate(async mobile => {
      const e = window.__TIDELINE__.experience, ids = e.npcs.items.map(i => i.root.uuid);
      const colliders = e.world.cameraColliderCount;
      e.setQuality(mobile ? 'high' : 'low'); e.setQuality(mobile ? 'low' : 'high');
      const children = e.scene.children.length;
      const pending = new e.npcs.constructor(e); pending.dispose(); await pending.ready;
      return { same: ids.every((id, i) => id === e.npcs.items[i].root.uuid),
        colliders: e.world.cameraColliderCount === colliders, earlyDispose: e.scene.children.length === children };
    }, mobile);
    assert.ok(reuse.same && reuse.colliders && reuse.earlyDispose, JSON.stringify(reuse));

    const style = await page.addStyleTag({ content: 'body *{visibility:hidden!important} #scene-canvas{visibility:visible!important}' });
    await page.evaluate(() => {
      const e = window.__TIDELINE__.experience;
      e.renderer.setAnimationLoop(null); e.cameraTween = null;
      e.environment.setOceanSwellStrength(1);
      e.camera.position.set(0, 5, -5); e.controls.target.set(0, 0, -65); e.controls.update();
      e.environment.water.material.uniforms.time.value = 0; e.renderer.render(e.scene, e.camera);
    });
    const first = PNG.sync.read(await page.screenshot());
    await page.evaluate(() => {
      const e = window.__TIDELINE__.experience;
      e.environment.water.material.uniforms.time.value = 8; e.renderer.render(e.scene, e.camera);
    });
    const second = PNG.sync.read(await page.screenshot({ path: `screenshots/ocean-${mobile ? 'mobile' : 'desktop'}-waves.png` }));
    let changed = 0;
    for (let i = 0; i < first.data.length; i += 4) {
      if (Math.abs(first.data[i] - second.data[i]) + Math.abs(first.data[i + 1] - second.data[i + 1])
        + Math.abs(first.data[i + 2] - second.data[i + 2]) > 12) changed++;
    }
    console.log('WATER_PIXELS', { mobile, changed, fraction: changed / (first.width * first.height) });
    assert.ok(changed > first.width * first.height * 0.02, 'Rendered water must move across the viewport');
    await style.evaluate(s => s.remove());
    const teardown = await page.evaluate(() => {
      const e = window.__TIDELINE__.experience, tracked = new Map();
      const resources = new Set([e.environment.water.geometry, e.environment.oceanRefraction.target, e.environment.oceanRefraction.target.depthTexture]);
      e.npcs.root.traverse(o => {
        if (o.geometry) resources.add(o.geometry);
        if (o.material) resources.add(o.material);
        if (o.skeleton?.boneTexture) resources.add(o.skeleton.boneTexture);
      });
      for (const resource of resources) {
        tracked.set(resource.uuid, 0);
        resource.addEventListener('dispose', () => tracked.set(resource.uuid, tracked.get(resource.uuid) + 1));
      }
      e.dispose(); e.dispose();
      return { counts: [...tracked.values()], disposed: e.npcs.disposed, detached: !e.npcs.root.parent };
    });
    assert.ok(teardown.counts.every(count => count === 1), JSON.stringify(teardown));
    assert.ok(teardown.disposed && teardown.detached); assert.deepEqual(errors, []);
    results.push({ mobile, initial, depthRange, reuse, changedPixels: changed, teardown });
    await context.close();
  }
  const failedContext = await browser.newContext();
  const failedPage = await failedContext.newPage();
  await failedPage.addInitScript(() => localStorage.setItem('tideline.control-guide.v4', 'seen'));
  await failedPage.route('**/models/npc/*.glb', route => route.fulfill({ status: 404, body: 'unavailable' }));
  await failedPage.goto(url); await failedPage.waitForFunction(() => window.__TIDELINE__?.getState().initialized);
  await failedPage.evaluate(() => window.__TIDELINE__.experience.npcs.ready);
  await failedPage.click('#start-button'); await failedPage.click('#npc-button');
  assert.match(await failedPage.locator('#npc-text').textContent(), /暂时未能到达/);
  assert.deepEqual(await failedPage.evaluate(() => {
    const e = window.__TIDELINE__.experience;
    return { initialized: e.initialized, loaded: e.npcs.items.length, errors: e.npcs.errors.length };
  }), { initialized: true, loaded: 0, errors: 10 });
  await failedContext.close();
  console.log(JSON.stringify({ results, unavailableNpc: 'base scene usable' }, null, 2));
} finally { await browser.close(); await server?.close(); }

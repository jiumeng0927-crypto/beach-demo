import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { PNG } from 'pngjs';
import { writeFile } from 'node:fs/promises';
import { browserOptions } from './browser-options.mjs';

const server = process.env.TIDELINE_URL ? null : await createServer({ logLevel: 'error',
  server: { host: '127.0.0.1', port: 4198, strictPort: true } });
await server?.listen();
const url = process.env.TIDELINE_URL || server.resolvedUrls.local[0];
const browser = await chromium.launch(browserOptions());
try {
  const context = await browser.newContext({ viewport: { width: 320, height: 360 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => localStorage.setItem('tideline.control-guide.v4', 'seen'));
  await page.goto(url);
  await page.waitForFunction(() => window.__TIDELINE__?.getState().initialized, null, { timeout: 30000 });
  await page.click('#start-button');
  await page.evaluate(() => window.__TIDELINE__.experience.npcs.ready);
  await page.addStyleTag({ content: 'body>*:not(#app),#app>*:not(#scene-canvas){display:none!important}' });

  const audit = await page.evaluate(() => {
    const e = window.__TIDELINE__.experience;
    e.renderer.setAnimationLoop(null);
    e.setQuality('high');
    const npcs = e.npcs.items;
    const ignored = new Set(npcs.map(item => item.collider));
    const routeHits = [];
    for (const item of npcs) {
      const { spec } = item, height = spec.height ?? 1.9;
      const xs = spec.route ? Array.from({ length: 33 }, (_, index) =>
        spec.route[0] + (spec.route[1] - spec.route[0]) * index / 32) : [spec.x];
      for (const x of xs) {
        const ground = e.world.getWalkSurfaceHeight(x, spec.z);
        const position = new e.camera.position.constructor(x, ground + height, spec.z);
        const collision = e.world.resolveCameraPosition(position, {
          previousPosition: position.clone(), radius: item.collider.radius + 0.08,
          eyeHeight: height, ignore: ignored,
        });
        if (collision) routeHits.push({ id: spec.id, x, z: spec.z, names: collision.names });
      }
    }
    let minimumClearance = Infinity;
    for (let frame = 0; frame < 300; frame += 1) {
      e.npcs.update(1 / 30);
      for (const item of npcs) minimumClearance = Math.min(minimumClearance, item.groundClearance);
    }
    const signatures = npcs.map(item => {
      let sum = 0, count = 0;
      item.model.traverse(object => {
        const colors = object.geometry?.getAttribute?.('color');
        if (!colors) return;
        for (let index = 0; index < colors.count; index += Math.max(1, Math.floor(colors.count / 97))) {
          sum += colors.getX(index) * 3 + colors.getY(index) * 5 + colors.getZ(index) * 7;
          count += 1;
        }
      });
      const bounds = new e.npcs.poseBox.constructor().setFromObject(item.model, true);
      return { id: item.spec.id, kit: item.appearance.kit, palette: Number((sum / count).toFixed(5)),
        width: Number(bounds.getSize(new e.camera.position.constructor()).x.toFixed(3)) };
    });
    const walker = npcs.find(item => item.spec.id === 'fan');
    walker.routeTime = 0;
    walker.root.position.x = walker.spec.route[0];
    const blocker = { type: 'circle', name: 'npc-test-blocker', x: walker.root.position.x + 0.1,
      z: walker.spec.z, radius: 0.45, minY: -20, maxY: 20 };
    e.world.registerCameraCollider(blocker);
    const before = walker.routeTime;
    e.npcs.update(0.5);
    const avoidance = { paused: walker.routeTime === before, names: [...walker.blockedBy] };
    e.world.unregisterCameraCollider(blocker);
    e.renderScene(0.016);
    return { state: e.npcs.getState(), routeHits, minimumClearance, signatures, avoidance,
      render: e.getDebugState().render };
  });

  assert.equal(audit.state.loaded, 10);
  assert.deepEqual(audit.state.errors, []);
  assert.equal(new Set(audit.state.items.map(item => item.kit)).size, 10);
  assert.ok(audit.state.items.every(item => item.recoloredVertices > 0));
  assert.equal(new Set(audit.signatures.map(item => item.palette)).size, 10);
  assert.ok(new Set(audit.signatures.map(item => item.width)).size >= 6);
  assert.deepEqual(audit.routeHits, []);
  assert.ok(audit.minimumClearance >= 0.024, `Animated sole clearance: ${audit.minimumClearance}`);
  assert.ok(audit.avoidance.paused && audit.avoidance.names.includes('npc-test-blocker'));
  assert.ok(audit.render.calls < 180 && audit.render.triangles < 650000, JSON.stringify(audit.render));

  const shots = [];
  for (let index = 0; index < 10; index += 1) {
    await page.evaluate(index => {
      const e = window.__TIDELINE__.experience, item = e.npcs.items[index];
      e.npcs.items.forEach(candidate => { candidate.root.visible = candidate === item; });
      item.accessory.visible = true;
      item.root.position.set(0, e.world.getWalkSurfaceHeight(0, 18) + item.groundLift, 18);
      item.root.rotation.y = 0.08;
      const target = item.root.position.clone().add({ x: 0, y: 0.95, z: 0 });
      e.camera.position.copy(target).add({ x: 0.5, y: 0.24, z: 2.45 });
      e.camera.lookAt(target); e.camera.updateMatrixWorld(true); e.renderScene(0.016);
    }, index);
    shots.push(PNG.sync.read(await page.screenshot()));
  }
  const sheet = new PNG({ width: 1600, height: 720 });
  shots.forEach((shot, index) => {
    const column = index % 5, row = Math.floor(index / 5);
    PNG.bitblt(shot, sheet, 0, 0, shot.width, shot.height, column * 320, row * 360);
  });
  await writeFile('screenshots/npc-quality-049-roster.png', PNG.sync.write(sheet));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, visitors: 10, uniqueKits: 10,
    uniquePalettes: 10, silhouetteWidths: new Set(audit.signatures.map(item => item.width)).size,
    minimumClearance: audit.minimumClearance, routeHits: audit.routeHits.length,
    avoidance: audit.avoidance, render: audit.render }, null, 2));
  await context.close();
} finally {
  await browser.close();
  await server?.close();
}

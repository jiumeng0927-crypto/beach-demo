import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { PNG } from 'pngjs';
import { browserOptions } from './browser-options.mjs';

const root = path.resolve(import.meta.dirname, '..');
const reference = process.env.BOUNDARY_REFERENCE === '1';
const folder = path.join(root, reference ? 'tmp/boundary-before' : 'screenshots/boundary');
await mkdir(folder, { recursive: true });
const server = process.env.TIDELINE_URL ? null : await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 4187 } });
await server?.listen();
const browser = await chromium.launch(browserOptions());
const results = [];
try {
  for (const mobile of [false, true]) {
    const label = mobile ? 'mobile' : 'desktop';
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.addInitScript(() => localStorage.setItem('tideline.control-guide.v4', 'seen'));
    await page.goto(process.env.TIDELINE_URL ?? server.resolvedUrls.local[0]);
    await page.waitForFunction(() => window.__TIDELINE__?.getState().initialized);
    await page.click('#start-button');
    await page.evaluate(async () => {
      const e = window.__TIDELINE__.experience;
      await e.npcs.ready;
      await e.coastalProps.ready;
      e.environment.dayClock.running = false;
      e.environment.setTimeOfDay('day', true);
      e.environment.setTideMode('high');
      e.setQuality(innerWidth < 720 ? 'low' : 'high');
    });
    if (!reference) {
      const coverage = await page.evaluate(() => {
        const e = window.__TIDELINE__.experience, outer = e.world.coastContinuation;
        const missing = [], ray = new e.discovery.raycaster.constructor();
        e.scene.updateMatrixWorld(true);
        for (const x of [-2200, -600, -130.001, -129.999, 0, 129.999, 130.001, 600, 2200]) {
          for (const z of [-2200, -195.001, -194.999, -15.001, -14.999, 5, 104.999, 105.001, 2200]) {
            ray.set(e.camera.position.clone().set(x, 100, z), e.camera.position.clone().set(0, -1, 0));
            if (!ray.intersectObjects([e.world.beach, e.world.seabed, outer]).length) missing.push([x, z]);
          }
        }
        const sky = e.environment.sky.material;
        let capturedOuter = false;
        const previousDraw = outer.onBeforeRender;
        outer.onBeforeRender = function(renderer, ...args) {
          capturedOuter ||= renderer.getRenderTarget() === e.environment.oceanRefraction.target;
          previousDraw.call(this, renderer, ...args);
        };
        try { e.renderer.render(e.scene, e.camera); } finally { outer.onBeforeRender = previousDraw; }
        return { missing, capturedOuter, haze: sky.fog && Boolean(sky.uniforms.fogColor) && sky.fragmentShader.includes('mix(gl_FragColor.rgb, fogColor, coastHaze)'), extent: outer.geometry.boundingBox.max.x,
          far: e.camera.far, sharedSand: outer.material === e.world.sandMaterial,
          triangles: outer.geometry.index.count / 3 };
      });
      assert.deepEqual(coverage.missing, [], `${label} runtime ground gaps`);
      assert.ok(coverage.haze, 'Horizon uses the renderer-managed fog color space');
      assert.ok(coverage.extent > coverage.far + 200);
      assert.equal(coverage.sharedSand, true);
      assert.equal(coverage.capturedOuter, true, 'Outer seabed must populate actual refraction color/depth');
      results.push({ label, coverage });
      const reconstruction = await page.evaluate(() => {
        const e = window.__TIDELINE__.experience, renderer = e.renderer, water = e.environment.water;
        const refraction = e.environment.oceanRefraction;
        const source = new refraction.target.constructor(8, 8);
        source.depthTexture = new refraction.target.depthTexture.constructor(8, 8, refraction.target.depthTexture.type);
        const output = new refraction.target.constructor(61, 53);
        const scene = new e.scene.constructor();
        const geometry = new water.geometry.constructor(2, 2);
        const ramp = new water.material.constructor({
          vertexShader: 'void main(){gl_Position=vec4(position.xy,position.y*0.8,1.0);}',
          fragmentShader: 'void main(){gl_FragColor=vec4(0.0,0.0,0.0,1.0);}',
        });
        const mesh = new e.world.beach.constructor(geometry, ramp); scene.add(mesh);
        const shader = water.material.fragmentShader;
        const distanceFunction = shader.slice(shader.indexOf('float sceneDistance('), shader.indexOf('vec2 capillarySlope('));
        const sample = new water.material.constructor({
          uniforms: { uRefractionDepth: { value: source.depthTexture }, uRefractionTexelSize: { value: refraction.size.clone().set(1/8, 1/8) },
            uCameraNear: { value: .1 }, uCameraFar: { value: 1800 } },
          vertexShader: 'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',
          fragmentShader: `uniform sampler2D uRefractionDepth; uniform vec2 uRefractionTexelSize;
            uniform float uCameraNear; uniform float uCameraFar;
            #include <packing>
            ${distanceFunction}
            void main(){vec2 uv=gl_FragCoord.xy/vec2(61.0,53.0);
              float actual=viewZToPerspectiveDepth(-sceneDistance(uv),uCameraNear,uCameraFar);
              float nearest=texture2D(uRefractionDepth,uv).x;
              float expected=0.1+0.8*uv.y;
              gl_FragColor=vec4(abs(actual-expected)*100.0,abs(nearest-expected)*100.0,0.0,1.0);}`,
        });
        const previous = renderer.getRenderTarget();
        try {
          renderer.setRenderTarget(source); renderer.state.buffers.depth.setMask(true); renderer.clear(); renderer.render(scene, e.camera);
          mesh.material = sample;
          renderer.setRenderTarget(output); renderer.clear(); renderer.render(scene, e.camera);
          const bytes = new Uint8Array(61 * 53 * 4); renderer.readRenderTargetPixels(output, 0, 0, 61, 53, bytes);
          let reconstructedMax = 0, nearestMax = 0;
          for (let y = 5; y < 48; y++) for (let x = 5; x < 56; x++) {
            const i = (y * 61 + x) * 4;
            reconstructedMax = Math.max(reconstructedMax, bytes[i]); nearestMax = Math.max(nearestMax, bytes[i+1]);
          }
          return { reconstructedMax, nearestMax };
        } finally {
          renderer.setRenderTarget(previous); source.dispose(); output.dispose(); geometry.dispose(); ramp.dispose(); sample.dispose();
        }
      });
      assert.ok(reconstruction.reconstructedMax <= 2, 'Upsampled planar depth must stay continuous');
      assert.ok(reconstruction.nearestMax > 200, 'The depth probe must expose the original nearest-sampling artifact');
      results.push({ label, reconstruction });
    }
    for (const [name, position, target] of [
      ['east', [58, 24, 26], [-5, 1, 18]],
      ['west', [-58, 24, 26], [5, 1, 18]],
      ['inland', [0, 26, -10], [0, 2, 52]],
      ['ocean', [0, 20, 8], [0, 0, -60]],
    ]) {
      await page.evaluate(({ position, target }) => {
        const e = window.__TIDELINE__.experience;
        e.startCameraTween(e.camera.position.clone().fromArray(position), e.controls.target.clone().fromArray(target));
      }, { position, target });
      await page.waitForFunction(() => !window.__TIDELINE__.experience.cameraTween);
      await page.waitForTimeout(180);
      const image = PNG.sync.read(await page.screenshot({ path: path.join(folder, `${label}-${name}.png`) }));
      const hiddenOverlays = await page.addStyleTag({ content: 'body * { visibility:hidden !important; } #scene-canvas { visibility:visible !important; }' });
      const canvas = PNG.sync.read(await page.locator('#scene-canvas').screenshot());
      await hiddenOverlays.evaluate(element => element.remove());
      let lit = 0, samples = 0;
      for (let y = Math.floor(canvas.height * .35); y < canvas.height; y += 4) for (let x = 0; x < canvas.width; x += 4) {
        const i = (y * canvas.width + x) * 4;
        lit += Number(canvas.data[i] + canvas.data[i + 1] + canvas.data[i + 2] > 120); samples++;
      }
      assert.ok(lit / samples > .65, `${label}-${name} day geometry is black or unlit`);
      const colors = new Set();
      for (let i = 0; i < image.data.length; i += 136) colors.add(`${image.data[i] >> 4},${image.data[i + 1] >> 4},${image.data[i + 2] >> 4}`);
      assert.ok(colors.size > 24, `${label}-${name} blank canvas`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      results.push({ label, name, colors: colors.size, state: await page.evaluate(() => {
        const e = window.__TIDELINE__.experience;
        return { camera: e.camera.position.toArray(), target: e.controls.target.toArray(),
          render: { ...e.renderer.info.render }, overflow: document.documentElement.scrollWidth > innerWidth };
      }) });
    }
    if (!reference) {
      const lifecycle = await page.evaluate(() => {
        const e = window.__TIDELINE__.experience, counts = { oldGeometry: 0, oldMaterial: 0, newGeometry: 0, newMaterial: 0 };
        e.world.coastContinuation.geometry.addEventListener('dispose', () => counts.oldGeometry++);
        e.world.sandMaterial.addEventListener('dispose', () => counts.oldMaterial++);
        e.setQuality(innerWidth < 720 ? 'high' : 'low');
        e.world.coastContinuation.geometry.addEventListener('dispose', () => counts.newGeometry++);
        e.world.sandMaterial.addEventListener('dispose', () => counts.newMaterial++);
        e.dispose();
        return counts;
      });
      assert.deepEqual(lifecycle, { oldGeometry: 1, oldMaterial: 1, newGeometry: 1, newMaterial: 1 });
      results.push({ label, lifecycle });
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  await writeFile(path.join(folder, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ ok: true, reference, results }, null, 2));
} finally { await browser.close(); await server?.close(); }

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';
import { RENDER_BUDGETS } from './render-budgets.mjs';
import { browserOptions } from './browser-options.mjs';
import { PNG } from 'pngjs';
import { createServer } from 'vite';

// End-to-end smoke test plus lightweight image heuristics. It intentionally
// uses the system Chrome so CI-like checks exercise the same WebGL path as the
// local presentation browser.
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDirectory, '..');
const screenshotDirectory = path.join(projectRoot, 'screenshots');
const externalUrl = process.env.TIDELINE_URL;
let testServer = null;

await mkdir(screenshotDirectory, { recursive: true });

// Keep the regression command self-contained. A supplied TIDELINE_URL still
// allows the same suite to audit a production build or deployed page.
if (!externalUrl) {
  testServer = await createServer({
    root: projectRoot,
    logLevel: 'error',
    server: {
      host: '127.0.0.1',
      port: 4175,
      strictPort: true,
    },
  });
  await testServer.listen();
}
const baseUrl = externalUrl || 'http://127.0.0.1:4175';

function analyzePng(buffer) {
  // Sparse sampling is enough to reject blank/flat canvases without paying the
  // cost of processing every high-resolution screenshot pixel.
  const image = PNG.sync.read(buffer);
  let samples = 0;
  let sum = 0;
  let sumSquared = 0;
  let redSum = 0;
  let greenSum = 0;
  let blueSum = 0;
  let foregroundSamples = 0;
  const foregroundSum = [0, 0, 0];
  let minimum = 255;
  let maximum = 0;
  const colorBins = new Set();
  const step = Math.max(1, Math.floor(Math.min(image.width, image.height) / 110));

  for (let y = 0; y < image.height; y += step) {
    for (let x = 0; x < image.width; x += step) {
      const offset = (image.width * y + x) * 4;
      const red = image.data[offset];
      const green = image.data[offset + 1];
      const blue = image.data[offset + 2];
      if (y > image.height * 0.65 && y < image.height * 0.88 && x > image.width * 0.25 && x < image.width * 0.72) {
        foregroundSum[0] += red; foregroundSum[1] += green; foregroundSum[2] += blue;
        foregroundSamples++;
      }
      const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      sum += luminance;
      sumSquared += luminance * luminance;
      redSum += red;
      greenSum += green;
      blueSum += blue;
      minimum = Math.min(minimum, luminance);
      maximum = Math.max(maximum, luminance);
      colorBins.add(`${red >> 4}-${green >> 4}-${blue >> 4}`);
      samples += 1;
    }
  }

  const mean = sum / samples;
  const variance = sumSquared / samples - mean * mean;
  return {
    width: image.width,
    height: image.height,
    mean: Number(mean.toFixed(2)),
    foregroundMeanColor: foregroundSum.map(value => value / Math.max(1, foregroundSamples)),
    standardDeviation: Number(Math.sqrt(Math.max(0, variance)).toFixed(2)),
    range: Number((maximum - minimum).toFixed(2)),
    colorBins: colorBins.size,
    meanColor: [
      Number((redSum / samples).toFixed(2)),
      Number((greenSum / samples).toFixed(2)),
      Number((blueSum / samples).toFixed(2)),
    ],
  };
}

function comparePng(firstBuffer, secondBuffer) {
  const first = PNG.sync.read(firstBuffer);
  const second = PNG.sync.read(secondBuffer);
  if (first.width !== second.width || first.height !== second.height) {
    return { changedRatio: 0, meanDifference: 0, maxDifference: 0 };
  }

  const step = Math.max(1, Math.floor(Math.min(first.width, first.height) / 220));
  let samples = 0;
  let changed = 0;
  let differenceTotal = 0;
  let maxDifference = 0;
  for (let y = 0; y < first.height; y += step) {
    for (let x = 0; x < first.width; x += step) {
      const offset = (first.width * y + x) * 4;
      const difference =
        (Math.abs(first.data[offset] - second.data[offset]) +
          Math.abs(first.data[offset + 1] - second.data[offset + 1]) +
          Math.abs(first.data[offset + 2] - second.data[offset + 2])) /
        3;
      differenceTotal += difference;
      maxDifference = Math.max(maxDifference, difference);
      if (difference >= 4) changed += 1;
      samples += 1;
    }
  }
  return {
    changedRatio: Number((changed / samples).toFixed(4)),
    meanDifference: Number((differenceTotal / samples).toFixed(3)),
    maxDifference: Number(maxDifference.toFixed(2)),
  };
}

async function saveScreenshot(page, name, canvasOnly = false) {
  // Locator screenshots still contain overlapping HUDs; hide overlays for pixel-only checks.
  const hiddenOverlays = canvasOnly ? await page.addStyleTag({
    content: 'body * { visibility: hidden !important; } #scene-canvas { visibility: visible !important; }',
  }) : null;
  const buffer = canvasOnly
    ? await page.locator('#scene-canvas').screenshot({ type: 'png' })
    : await page.screenshot({ type: 'png' });
  await hiddenOverlays?.evaluate((style) => style.remove());
  const outputPath = path.join(screenshotDirectory, `${name}.png`);
  await writeFile(outputPath, buffer);
  return { outputPath, stats: analyzePng(buffer) };
}

async function inspectLayout(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0;
    };

    return [...document.querySelectorAll('button')]
      .filter(visible)
      .map((button) => ({
        label: button.getAttribute('aria-label') || button.textContent.trim(),
        widthOverflow: button.scrollWidth > button.clientWidth + 2,
        heightOverflow: button.scrollHeight > button.clientHeight + 2,
      }))
      .filter((result) => result.widthOverflow || result.heightOverflow);
  });
}

async function runViewport(browser, config) {
  const context = await browser.newContext({
    viewport: { width: config.width, height: config.height },
    deviceScaleFactor: 1,
    isMobile: config.mobile,
    hasTouch: config.mobile,
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const bloomModuleRequests = [];

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  page.on('request', (request) => {
    if (/EffectComposer|RenderPass|UnrealBloomPass|OutputPass/.test(request.url())) {
      bloomModuleRequests.push(request.url());
    }
  });

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForFunction(
    () => window.__TIDELINE__?.getState().initialized === true,
    null,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(900);

  const initialRainLifecycle = await page.evaluate(() => {
    const experience = window.__TIDELINE__.experience;
    return {
      state: experience.getDebugState().rain,
      linePresent: Boolean(experience.rain.lines),
      sceneLinePresent: Boolean(experience.scene.getObjectByName('LocalRainVolume')),
      reflectionExclusions: experience.world.reflectionExclusionCount,
    };
  });
  const initialCelestialLifecycle = await page.evaluate(() => {
    const experience = window.__TIDELINE__.experience;
    const state = experience.getDebugState();
    return {
      resources: state.celestialResources,
      stars: state.starQuality,
      moon: state.moonQuality,
      sceneObjects: {
        stars: Boolean(experience.scene.getObjectByName('CelestialStars')),
        moon: Boolean(experience.scene.getObjectByName('CelestialMoon')),
        halo: Boolean(experience.scene.getObjectByName('CelestialMoonHalo')),
      },
    };
  });
  const initialDiscoveryLifecycle = await page.evaluate(() => {
    const experience = window.__TIDELINE__.experience;
    return {
      state: experience.getDebugState().discovery,
      groupInScene: experience.discovery.group.parent === experience.scene,
      glassPresent: Boolean(experience.discovery.glass),
      glowPresent: Boolean(experience.discovery.glows),
      reflectionExclusions: experience.world.reflectionExclusionCount,
    };
  });
  const initialBilliardsLifecycle = await page.evaluate(() => {
    const experience = window.__TIDELINE__.experience;
    return {
      state: experience.getDebugState().billiards,
      groupInScene: experience.billiards.group.parent === experience.scene,
      charactersDisabled:
        experience.getDebugState().characters === null &&
        experience.characters === undefined,
      reflectionExclusions: experience.world.reflectionExclusionCount,
    };
  });
  const intro = await saveScreenshot(page, `${config.name}-intro`);
  const canvasBefore = await saveScreenshot(page, `${config.name}-canvas`, true);
  const waterTimeBefore = await page.evaluate(
    () => window.__TIDELINE__.getState().waterTime,
  );
  await page.waitForTimeout(500);
  const waterTimeAfter = await page.evaluate(
    () => window.__TIDELINE__.getState().waterTime,
  );

  await page.click('#start-button');
  await page.waitForFunction(
    () => document.querySelector('#guide-dialog')?.open === true,
    null,
    { timeout: 5_000 },
  );
  await page.waitForTimeout(320);
  await page.waitForFunction(() => {
    const state = window.__TIDELINE__?.getState().billiards;
    return state?.initialized === true && state.loading === false;
  }, null, { timeout: 15_000 });
  const enteredDiscoveryLifecycle = await page.evaluate(() => {
    const experience = window.__TIDELINE__.experience;
    return {
      state: experience.getDebugState().discovery,
      groupInScene: experience.discovery.group.parent === experience.scene,
      glassPresent: Boolean(experience.discovery.glass),
      glowPresent: Boolean(experience.discovery.glows),
      reflectionExclusions: experience.world.reflectionExclusionCount,
    };
  });
  const enteredBilliardsLifecycle = await page.evaluate(() => {
    const experience = window.__TIDELINE__.experience;
    return {
      state: experience.getDebugState().billiards,
      groupInScene: experience.billiards.group.parent === experience.scene,
      charactersDisabled:
        experience.getDebugState().characters === null &&
        experience.characters === undefined,
      reflectionExclusions: experience.world.reflectionExclusionCount,
    };
  });
  const guide = await saveScreenshot(page, `${config.name}-guide`);
  const guideInitial = await page.evaluate(() => {
    const dialog = document.querySelector('#guide-dialog');
    const freeSection = document.querySelector(
      '.guide-mode[data-free-guide]',
    );
    const walkSection = document.querySelector('#walk-guide-title')?.closest(
      '.guide-mode',
    );
    const dialogRect = dialog.getBoundingClientRect();
    const textOverflow = [...dialog.querySelectorAll('button, dt, dd, h2, h3')]
      .filter((element) => {
        const style = getComputedStyle(element);
        return (
          style.display !== 'none' &&
          (element.scrollWidth > element.clientWidth + 2 ||
            element.scrollHeight > element.clientHeight + 2)
        );
      })
      .map((element) => element.textContent.trim());
    return {
      open: dialog?.open ?? false,
      activeAction: document.activeElement?.dataset.guideAction ?? null,
      freeVisible:
        !freeSection?.hidden && getComputedStyle(freeSection).display !== 'none',
      walkVisible:
        !walkSection?.hidden && getComputedStyle(walkSection).display !== 'none',
      storage: localStorage.getItem('tideline.control-guide.v4'),
      contained:
        dialogRect.left >= 0 &&
        dialogRect.top >= 0 &&
        dialogRect.right <= window.innerWidth &&
        dialogRect.bottom <= window.innerHeight,
      textOverflow,
    };
  });
  let guideWalkEntry = null;
  let walkView = null;
  if (config.mobile) {
    await page.click('[data-guide-action="orbit"]');
  } else {
    await page.click('[data-guide-action="walk"]');
    await page.waitForFunction(
      () => {
        const camera = window.__TIDELINE__.getState().camera;
        return (
          camera.mode === 'walk' &&
          camera.free.movementMode === 'walk' &&
          camera.free.locked &&
          !camera.free.lockPending
        );
      },
      null,
      { timeout: 5_000 },
    );
    const before = await page.evaluate(
      () => window.__TIDELINE__.getState().camera.position,
    );
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(420);
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(320);
    guideWalkEntry = await page.evaluate((start) => {
      const state = window.__TIDELINE__.getState().camera;
      const walkButton = document.querySelector('#walk-mode-button');
      const freeButton = document.querySelector('#camera-mode-button');
      return {
        before: start,
        state,
        dialogOpen: document.querySelector('#guide-dialog')?.open ?? false,
        storage: localStorage.getItem('tideline.control-guide.v4'),
        reticleVisible:
          getComputedStyle(document.querySelector('#free-view-reticle')).opacity ===
          '1',
        hintVisible:
          getComputedStyle(document.querySelector('#free-view-hint')).opacity ===
          '1',
        movementHint: document.querySelector('#movement-hint-label')?.textContent,
        verticalHintHidden: document.querySelector('#vertical-movement-hint')?.hidden,
        walkPressed: walkButton?.getAttribute('aria-pressed'),
        walkLocked: walkButton?.dataset.locked,
        freePressed: freeButton?.getAttribute('aria-pressed'),
      };
    }, before);
    walkView = await saveScreenshot(page, `${config.name}-walk-view`);
    await page.evaluate(() => document.exitPointerLock());
    await page.waitForFunction(
      () => window.__TIDELINE__.getState().camera.mode === 'orbit',
      null,
      { timeout: 5_000 },
    );
  }
  await page.waitForFunction(
    () => document.querySelector('#guide-dialog')?.open === false,
    null,
    { timeout: 5_000 },
  );
  await page.waitForTimeout(160);
  await page.click('#guide-button');
  await page.waitForFunction(
    () => document.querySelector('#guide-dialog')?.open === true,
    null,
    { timeout: 5_000 },
  );
  const guideReopened = await page.evaluate(() => ({
    open: document.querySelector('#guide-dialog')?.open ?? false,
    expanded: document
      .querySelector('#guide-button')
      ?.getAttribute('aria-expanded'),
  }));
  await page.click('#guide-close');
  await page.waitForFunction(
    () => document.querySelector('#guide-dialog')?.open === false,
    null,
    { timeout: 5_000 },
  );
  const guideClosed = await page.evaluate(() => ({
    open: document.querySelector('#guide-dialog')?.open ?? false,
    expanded: document
      .querySelector('#guide-button')
      ?.getAttribute('aria-expanded'),
    focused: document.activeElement?.id ?? null,
    storage: localStorage.getItem('tideline.control-guide.v4'),
  }));
  await page.waitForTimeout(120);
  const day = await saveScreenshot(page, `${config.name}-day`);
  const dayState = await page.evaluate(() => window.__TIDELINE__.getState());
  const billiardsCameraBefore = await page.evaluate(() => {
    const experience = window.__TIDELINE__.experience;
    return {
      position: experience.camera.position.toArray(),
      target: experience.controls.target.toArray(),
    };
  });
  await page.click('#billiards-focus');
  await page.waitForFunction(
    () => window.__TIDELINE__.experience.cameraTween === null,
    null,
    { timeout: 3000 },
  );
  await page.waitForTimeout(120);
  const billiardsFocusState = await page.evaluate(() => {
    const experience = window.__TIDELINE__.experience;
    const table = experience.billiards.group.position;
    const collider = experience.billiards.cameraCollider;
    const mobile = window.innerWidth < 720;
    const expectedPosition = [
      table.x,
      table.y + (mobile ? 11.6 : 7.2),
      table.z + (mobile ? 16.2 : 9.5),
    ];
    const expectedTarget = [table.x, table.y + 1.86, table.z];
    const projectedCorners = [];
    for (const xSign of [-1, 1]) {
      for (const zSign of [-1, 1]) {
        projectedCorners.push(
          experience.camera.position
            .clone()
            .set(
              collider.x + collider.halfX * xSign,
              experience.billiards.groundY + 2.05,
              collider.z + collider.halfZ * zSign,
            )
            .project(experience.camera)
            .toArray(),
        );
      }
    }
    return {
      mode: experience.cameraMode,
      viewMode: mobile ? 'mobile' : 'desktop',
      position: experience.camera.position.toArray(),
      target: experience.controls.target.toArray(),
      expectedPosition,
      expectedTarget,
      controlsEnabled: experience.controls.enabled,
      tweenComplete: experience.cameraTween === null,
      tableVisible: projectedCorners.every(
        ([x, y, z]) => Math.abs(x) <= 0.94 && Math.abs(y) <= 0.94 && z >= -1 && z <= 1,
      ),
      projectedCorners,
      buttonLabel: document.querySelector('#billiards-focus')?.getAttribute('aria-label'),
      toast: document.querySelector('#toast')?.textContent,
    };
  });
  const billiardsScreenshot = await saveScreenshot(
    page,
    `${config.name}-billiards`,
  );
  await page.click('#pool-view-cue');
  await page.waitForFunction(() => !window.__TIDELINE__.experience.cameraTween);
  const billiardsShotAccepted = await page.evaluate(() =>
    window.__TIDELINE__.experience.billiards.shoot(1, 0, 0.42, 'visual-test'),
  );
  await page.waitForTimeout(180);
  const billiardsShotState = await page.evaluate(() =>
    window.__TIDELINE__.experience.billiards.getDebugState(),
  );
  const billiardsPocketState = await page.evaluate(() => {
    const experience = window.__TIDELINE__.experience;
    const target = experience.billiards.balls[1];
    target.body.position.set(-3.175, 0, -1.5875);
    target.body.previousPosition.copy(target.body.position);
    target.body.velocity.setZero();
    experience.billiards.update(1 / 120);
    return {
      state: experience.billiards.getDebugState(),
      score: document.querySelector('#billiards-score')?.textContent,
      shots: document.querySelector('#billiards-shots')?.textContent,
      status: document.querySelector('#billiards-status')?.textContent,
    };
  });
  const billiardsCameraCollision = await page.evaluate(() => {
    const experience = window.__TIDELINE__.experience;
    const collider = experience.billiards.cameraCollider;
    const position = experience.camera.position.clone().set(
      collider.x,
      experience.billiards.groundY + 1.68,
      collider.z,
    );
    const previousPosition = position.clone();
    previousPosition.z += 5;
    const collision = experience.world.resolveCameraPosition(position, {
      previousPosition,
      radius: 0.42,
      eyeHeight: 1.68,
    });
    return {
      names: collision?.names ?? [],
      collided: collision?.collided ?? false,
      position: position.toArray(),
      outside:
        Math.abs(position.x - collider.x) >= collider.halfX + 0.42 - 0.001 ||
        Math.abs(position.z - collider.z) >= collider.halfZ + 0.42 - 0.001,
      colliderCount: experience.world.cameraColliderCount,
    };
  });
  await page.click('#billiards-reset');
  const billiardsResetState = await page.evaluate(() => ({
    state: window.__TIDELINE__.experience.billiards.getDebugState(),
    score: document.querySelector('#billiards-score')?.textContent,
    shots: document.querySelector('#billiards-shots')?.textContent,
  }));
  await page.evaluate((before) => {
    const experience = window.__TIDELINE__.experience;
    // Use normal navigation to cancel the reset overview tween and release pool ownership.
    experience.startCameraTween(experience.camera.position.clone().fromArray(before.position),
      experience.controls.target.clone().fromArray(before.target));
  }, billiardsCameraBefore);
  await page.waitForFunction(() => !window.__TIDELINE__.experience.cameraTween);
  await page.waitForTimeout(120);
  const billiardsInteraction = {
    focus: billiardsFocusState,
    shotAccepted: billiardsShotAccepted,
    shot: billiardsShotState,
    pocket: billiardsPocketState,
    cameraCollision: billiardsCameraCollision,
    reset: billiardsResetState,
  };
  const cullingOverlays = await page.addStyleTag({ content: 'body * { visibility:hidden !important; } #scene-canvas { visibility:visible !important; }' });
  const daylightLegacyState = await page.evaluate(() => {
    const experience = window.__TIDELINE__.experience;
    experience.renderer.setAnimationLoop(null);
    experience.world.lantern.visible = true;
    experience.world.lanternGlow.visible = true;
    experience.world.lanternHalo.visible = true;
    experience.renderer.info.reset();
    experience.renderer.render(experience.scene, experience.camera);
    return experience.getDebugState();
  });
  const daylightLegacyBuffer = await page
    .locator('#scene-canvas')
    .screenshot({ type: 'png' });
  const daylightCulledState = await page.evaluate(() => {
    const experience = window.__TIDELINE__.experience;
    experience.world.lantern.visible = false;
    experience.world.lanternGlow.visible = false;
    experience.world.lanternHalo.visible = false;
    experience.renderer.info.reset();
    experience.renderer.render(experience.scene, experience.camera);
    return experience.getDebugState();
  });
  const daylightCulledBuffer = await page
    .locator('#scene-canvas')
    .screenshot({ type: 'png' });
  const daylightCulling = {
    legacy: daylightLegacyState,
    culled: daylightCulledState,
    pixelDifference: comparePng(daylightLegacyBuffer, daylightCulledBuffer),
  };
  await writeFile(path.join(screenshotDirectory, `${config.name}-lantern-legacy.png`), daylightLegacyBuffer);
  await writeFile(path.join(screenshotDirectory, `${config.name}-lantern-culled.png`), daylightCulledBuffer);
  await cullingOverlays.evaluate(style => style.remove());
  await page.evaluate(() => {
    const experience = window.__TIDELINE__.experience;
    experience.clock.start();
    experience.renderer.setAnimationLoop(experience.animate);
  });
  await page.click('[data-time="dawn"]');
  await page.waitForTimeout(1_350);
  const dawn = await saveScreenshot(page, `${config.name}-dawn`);
  const dawnState = await page.evaluate(() => ({
    ...window.__TIDELINE__.getState(),
    timeControl: {
      label: document.querySelector('#period-label')?.textContent,
      active: document.querySelector('[data-time][aria-pressed="true"]')
        ?.dataset.time,
    },
  }));
  await page.click('[data-time="day"]');
  await page.waitForTimeout(1_150);
  let sunset = null;
  let night = null;
  let sunsetState = null;
  let nightState = null;
  let freeView = null;
  let pointerLockTransition = null;
  let freeCameraTransition = null;
  let walkCameraTransition = null;
  let lockFailureRecovery = null;

  if (!config.mobile) {
    const pointerBefore = await page.evaluate(
      () => window.__TIDELINE__.getState().camera.position,
    );
    await page.click('#camera-mode-button');
    await page.waitForFunction(
      () =>
        document.pointerLockElement?.id === 'scene-canvas' &&
        window.__TIDELINE__.getState().camera.free.locked &&
        document.querySelector('#camera-mode-button')?.dataset.locked ===
          'true',
      null,
      { timeout: 5_000 },
    );
    const pointerLocked = await page.evaluate(() => {
      const button = document.querySelector('#camera-mode-button');
      return {
        pointerElement: document.pointerLockElement?.id ?? null,
        state: window.__TIDELINE__.getState().camera,
        quaternion:
          window.__TIDELINE__.experience.camera.quaternion.toArray(),
        buttonPressed: button?.getAttribute('aria-pressed'),
        buttonLocked: button?.dataset.locked,
      };
    });
    await page.mouse.move(config.width / 2, config.height / 2);
    await page.mouse.move(
      config.width / 2 + 180,
      config.height / 2 - 90,
      { steps: 4 },
    );
    await page.waitForTimeout(100);
    const pointerRotated = await page.evaluate(() => {
      const camera = window.__TIDELINE__.experience.camera;
      return {
        quaternion: camera.quaternion.toArray(),
        forward: camera
          .getWorldDirection(camera.position.clone())
          .toArray(),
      };
    });
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(260);
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(80);
    const pointerMoving = await page.evaluate(
      () => window.__TIDELINE__.getState().camera,
    );

    // Browser-driven unlock follows the same pointerlockchange path as Escape,
    // while remaining deterministic in headless Chrome.
    await page.evaluate(() => document.exitPointerLock());
    await page.waitForFunction(
      () =>
        document.pointerLockElement === null &&
        window.__TIDELINE__.getState().camera.mode === 'orbit' &&
        document.querySelector('#camera-mode-button')?.dataset.locked ===
          'false',
      null,
      { timeout: 5_000 },
    );
    const pointerReleased = await page.evaluate(() => {
      const button = document.querySelector('#camera-mode-button');
      return {
        pointerElement: document.pointerLockElement?.id ?? null,
        state: window.__TIDELINE__.getState().camera,
        buttonPressed: button?.getAttribute('aria-pressed'),
        buttonLocked: button?.dataset.locked,
      };
    });

    // Re-enter once and exercise the application's explicit reset path while
    // locked. This catches pending-lock and duplicate-unlock regressions.
    await page.click('#camera-mode-button');
    await page.waitForFunction(
      () => document.pointerLockElement?.id === 'scene-canvas',
      null,
      { timeout: 5_000 },
    );
    await page.keyboard.press('KeyR');
    await page.waitForFunction(
      () =>
        document.pointerLockElement === null &&
        window.__TIDELINE__.getState().camera.mode === 'orbit' &&
        document.querySelector('#camera-mode-button')?.dataset.locked ===
          'false',
      null,
      { timeout: 5_000 },
    );
    const resetReleased = await page.evaluate(() => {
      const button = document.querySelector('#camera-mode-button');
      return {
        pointerElement: document.pointerLockElement?.id ?? null,
        state: window.__TIDELINE__.getState().camera,
        buttonPressed: button?.getAttribute('aria-pressed'),
        buttonLocked: button?.dataset.locked,
      };
    });
    pointerLockTransition = {
      before: pointerBefore,
      locked: pointerLocked,
      rotated: pointerRotated,
      moving: pointerMoving,
      released: pointerReleased,
      resetReleased,
    };

    await page.waitForTimeout(1_250);
    const targetBeforeFailure = await page.evaluate(
      () => window.__TIDELINE__.getState().camera.target,
    );
    await page.evaluate(() => {
      const canvas = document.querySelector('#scene-canvas');
      canvas.requestPointerLock = () => new Promise(() => {});
    });
    await page.click('#camera-mode-button');
    await page.waitForFunction(
      () => window.__TIDELINE__.getState().camera.free.lockPending === true,
      null,
      { timeout: 2_000 },
    );
    const pendingLock = await page.evaluate(() => ({
      state: window.__TIDELINE__.getState().camera,
      label: document.querySelector('#camera-label')?.textContent,
      reticleVisible:
        getComputedStyle(document.querySelector('#free-view-reticle')).opacity ===
        '1',
    }));
    await page.waitForFunction(
      () => {
        const camera = window.__TIDELINE__.getState().camera;
        return (
          camera.mode === 'orbit' &&
          camera.free.lastActivationError === 'request-timeout'
        );
      },
      null,
      { timeout: 6_000 },
    );
    const timeoutRecovered = await page.evaluate(() => ({
      state: window.__TIDELINE__.getState().camera,
      label: document.querySelector('#camera-label')?.textContent,
      reticleVisible:
        getComputedStyle(document.querySelector('#free-view-reticle')).opacity ===
        '1',
      toast: document.querySelector('#toast')?.textContent,
      toastVisible: document.querySelector('#toast')?.classList.contains(
        'is-visible',
      ),
    }));

    await page.evaluate(() => {
      const canvas = document.querySelector('#scene-canvas');
      canvas.requestPointerLock = () =>
        Promise.reject(new DOMException('blocked', 'NotAllowedError'));
    });
    await page.click('#camera-mode-button');
    await page.waitForFunction(
      () =>
        window.__TIDELINE__.getState().camera.free.lastActivationError ===
          'request-rejected' &&
        window.__TIDELINE__.getState().camera.mode === 'orbit',
      null,
      { timeout: 3_000 },
    );
    const rejectionRecovered = await page.evaluate(() => ({
      state: window.__TIDELINE__.getState().camera,
      toast: document.querySelector('#toast')?.textContent,
    }));
    await page.evaluate(() => {
      delete document.querySelector('#scene-canvas').requestPointerLock;
    });
    await page.waitForFunction(
      () => document.querySelector('#toast')?.hidden === true,
      null,
      { timeout: 5_000 },
    );
    lockFailureRecovery = {
      targetBeforeFailure,
      pending: pendingLock,
      timeout: timeoutRecovered,
      rejection: rejectionRecovered,
    };

    const before = await page.evaluate(
      () => window.__TIDELINE__.getState().camera.position,
    );
    const activatedMode = await page.evaluate(() =>
      window.__TIDELINE__.experience.setCameraMode('free', {
        requestPointerLock: false,
      }),
    );
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(650);
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(160);
    const moving = await page.evaluate(() => {
      const button = document.querySelector('#camera-mode-button');
      const reticle = document.querySelector('#free-view-reticle');
      return {
        state: window.__TIDELINE__.getState().camera,
        buttonPressed: button?.getAttribute('aria-pressed'),
        reticleVisible: getComputedStyle(reticle).opacity === '1',
      };
    });
    freeView = await saveScreenshot(page, `${config.name}-free-view`);

    const collisionBefore = await page.evaluate(() => {
      const experience = window.__TIDELINE__.experience;
      experience.freeCamera.clearMovement();
      const minimumHeight = experience.freeCamera.getMinimumHeight(14, 20);
      experience.camera.position.set(14, minimumHeight, 20);
      experience.camera.lookAt(14, minimumHeight, 12);
      experience.camera.updateMatrix();
      return window.__TIDELINE__.getState().camera.free.collisionEvents;
    });
    await page.waitForTimeout(140);
    const collision = await page.evaluate(() => {
      const state = window.__TIDELINE__.getState();
      const [x, , z] = state.camera.position;
      const cosine = Math.cos(-0.58);
      const sine = Math.sin(-0.58);
      const deltaX = x - 14;
      const deltaZ = z - 20;
      const localX = cosine * deltaX - sine * deltaZ;
      const localZ = sine * deltaX + cosine * deltaZ;
      return {
        state: state.camera,
        colliderCount: state.cameraColliderCount,
        insideBoatVolume:
          Math.abs(localX) < 3.15 + 0.42 &&
          Math.abs(localZ) < 1.2 + 0.42,
      };
    });

    await page.evaluate(() => {
      const experience = window.__TIDELINE__.experience;
      const minimumHeight = experience.freeCamera.getMinimumHeight(44.9, 40);
      experience.camera.position.set(44.9, minimumHeight, 40);
      experience.camera.lookAt(55, minimumHeight, 40);
      experience.camera.updateMatrix();
    });
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(700);
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(40);
    const edgeResponse = await page.evaluate(
      () => window.__TIDELINE__.getState().camera,
    );

    // Force a position outside the authored volume so the frame update must
    // prove that all three axes are clamped before OrbitControls is restored.
    await page.evaluate(() => {
      window.__TIDELINE__.experience.camera.position.set(100, -10, 100);
    });
    await page.waitForTimeout(160);
    const bounded = await page.evaluate(
      () => window.__TIDELINE__.getState().camera,
    );
    const restoredMode = await page.evaluate(() =>
      window.__TIDELINE__.experience.setCameraMode('orbit'),
    );
    await page.waitForTimeout(120);
    const restored = await page.evaluate(() => {
      const button = document.querySelector('#camera-mode-button');
      const reticle = document.querySelector('#free-view-reticle');
      return {
        state: window.__TIDELINE__.getState().camera,
        buttonPressed: button?.getAttribute('aria-pressed'),
        reticleVisible: getComputedStyle(reticle).opacity === '1',
      };
    });
    freeCameraTransition = {
      before,
      activatedMode,
      moving,
      collisionBefore,
      collision,
      edgeResponse,
      bounded,
      restoredMode,
      restored,
    };

    await page.evaluate(() => window.__TIDELINE__.experience.resetCamera());
    await page.waitForTimeout(1_300);
    const walkActivatedMode = await page.evaluate(() =>
      window.__TIDELINE__.experience.setCameraMode('walk', {
        requestPointerLock: false,
      }),
    );
    const prepareWalkRun = () =>
      page.evaluate(() => {
        const experience = window.__TIDELINE__.experience;
        const controller = experience.freeCamera;
        controller.clearMovement();
        experience.camera.position.set(-8, controller.getMinimumHeight(-8, 32), 32);
        experience.camera.lookAt(-8, experience.camera.position.y, 20);
        experience.camera.updateMatrixWorld(true);
        controller.snapToGround();
        return window.__TIDELINE__.getState().camera;
      });
    const walkStart = await prepareWalkRun();
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(560);
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(140);
    const normalWalk = await page.evaluate(
      () => window.__TIDELINE__.getState().camera,
    );

    await prepareWalkRun();
    await page.keyboard.down('Shift');
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(560);
    await page.keyboard.up('KeyW');
    await page.keyboard.up('Shift');
    await page.waitForTimeout(140);
    const sprintWalk = await page.evaluate(
      () => window.__TIDELINE__.getState().camera,
    );

    const spaceBefore = await page.evaluate(
      () => window.__TIDELINE__.getState().camera.position[1],
    );
    await page.keyboard.down('Space');
    await page.waitForTimeout(360);
    await page.keyboard.up('Space');
    await page.waitForTimeout(120);
    const spaceAfter = await page.evaluate(
      () => window.__TIDELINE__.getState().camera.position[1],
    );

    const tableWalkCollision = await page.evaluate(() => {
      const experience = window.__TIDELINE__.experience;
      const controller = experience.freeCamera;
      const collider = experience.billiards.cameraCollider;
      controller.clearMovement();
      experience.camera.position.set(
        collider.x,
        controller.getMinimumHeight(collider.x, collider.z),
        collider.z,
      );
      experience.camera.updateMatrixWorld(true);
      const eventsBefore = controller.collisionEvents;
      controller.update(1 / 60);
      const position = experience.camera.position;
      return {
        eventsBefore,
        eventsAfter: controller.collisionEvents,
        position: position.toArray(),
        outside:
          Math.abs(position.x - collider.x) >= collider.halfX + 0.42 - 0.001 ||
          Math.abs(position.z - collider.z) >= collider.halfZ + 0.42 - 0.001,
      };
    });

    const boardwalkGrounding = await page.evaluate(() => {
      const experience = window.__TIDELINE__.experience;
      const controller = experience.freeCamera;
      controller.clearMovement();
      experience.camera.position.set(43, 1.5, 37);
      experience.camera.lookAt(35, 1.5, 29);
      experience.camera.updateMatrixWorld(true);
      controller.snapToGround();
      return {
        state: window.__TIDELINE__.getState().camera,
        surface: experience.world.boardwalk.surfaceHeightAt(43, 37),
      };
    });
    const shoreBoundary = await page.evaluate(() => {
      const experience = window.__TIDELINE__.experience;
      const controller = experience.freeCamera;
      controller.clearMovement();
      experience.camera.position.set(0, 1.5, -8);
      controller.snapToGround();
      for (let index = 0; index < 36; index += 1) controller.update(1 / 60);
      return window.__TIDELINE__.getState().camera;
    });
    const walkRestoredMode = await page.evaluate(() =>
      window.__TIDELINE__.experience.setCameraMode('orbit'),
    );
    walkCameraTransition = {
      activatedMode: walkActivatedMode,
      start: walkStart,
      normal: normalWalk,
      sprint: sprintWalk,
      spaceBefore,
      spaceAfter,
      tableCollision: tableWalkCollision,
      boardwalk: boardwalkGrounding,
      shore: shoreBoundary,
      restoredMode: walkRestoredMode,
    };

    // Time-of-day captures compare lighting from one authored camera,
    // independent of the movement and boundary stress positions above.
    await page.evaluate(() => window.__TIDELINE__.experience.resetCamera());
    await page.waitForTimeout(1_300);

    await page.click('[data-time="sunset"]');
    await page.waitForTimeout(1_250);
    sunset = await saveScreenshot(page, `${config.name}-sunset`);
    sunsetState = await page.evaluate(() => window.__TIDELINE__.getState());

    await page.click('[data-time="night"]');
    // The exponential lighting blend must settle before the night snapshot.
    await page.waitForFunction(() => {
      const state = window.__TIDELINE__.getState();
      return state.period === 'night'
        && Math.abs(state.starQuality.opacity - 0.88) <= 0.002
        && state.lighting.starsVisible
        && state.lighting.moonVisible
        && state.lighting.moonHaloVisible
        && state.render.points === 1906;
    }, null, { timeout: 10_000 });
    night = await saveScreenshot(page, `${config.name}-night`);
    nightState = await page.evaluate(() => window.__TIDELINE__.getState());
  }

  const discoveryInitial = await page.evaluate(() => {
    const hud = document.querySelector('#discovery-hud');
    const rect = hud.getBoundingClientRect();
    const experience = window.__TIDELINE__.experience;
    const accessibility = experience.discovery.items.map((item) => {
      const position = item.position.clone();
      position.y += 1.25;
      const previousPosition = position.clone();
      const collision = experience.world.resolveCameraPosition(position, {
        previousPosition,
        radius: 0.42,
        eyeHeight: 1.45,
      });
      return {
        id: item.id,
        displacement: position.distanceTo(previousPosition),
        colliders: collision?.names ?? [],
      };
    });
    return {
      state: window.__TIDELINE__.getState().discovery,
      count: document.querySelector('#discovery-count')?.textContent,
      progress: document
        .querySelector('.discovery-progress')
        ?.getAttribute('aria-valuenow'),
      contained:
        rect.left >= 0 &&
        rect.top >= 0 &&
        rect.right <= window.innerWidth &&
        rect.bottom <= window.innerHeight,
      accessibility,
    };
  });
  const firstDiscoveryPoint = await page.evaluate(() => {
    const experience = window.__TIDELINE__.experience;
    const point = experience.discovery.items[0].position.clone();
    point.y += 0.32;
    point.project(experience.camera);
    const rect = experience.canvas.getBoundingClientRect();
    return {
      x: rect.left + ((point.x + 1) * 0.5) * rect.width,
      y: rect.top + ((1 - point.y) * 0.5) * rect.height,
    };
  });
  if (config.mobile) {
    await page.touchscreen.tap(firstDiscoveryPoint.x, firstDiscoveryPoint.y);
  } else {
    await page.mouse.click(firstDiscoveryPoint.x, firstDiscoveryPoint.y);
  }
  await page.waitForFunction(
    () => window.__TIDELINE__.getState().discovery.collected === 1,
    null,
    { timeout: 5_000 },
  );
  const pointerDiscovery = await page.evaluate(() => ({
    state: window.__TIDELINE__.getState().discovery,
    count: document.querySelector('#discovery-count')?.textContent,
    progress: document
      .querySelector('.discovery-progress')
      ?.getAttribute('aria-valuenow'),
    objective: document.querySelector('#discovery-objective')?.textContent,
  }));

  let keyboardDiscovery = null;
  if (!config.mobile) {
    await page.evaluate(() => {
      const experience = window.__TIDELINE__.experience;
      const item = experience.discovery.items[1];
      experience.setCameraMode('free', { requestPointerLock: false });
      experience.camera.position.set(
        item.position.x,
        item.position.y + 1.6,
        item.position.z + 3.2,
      );
      experience.camera.lookAt(
        item.position.x,
        item.position.y + 0.32,
        item.position.z,
      );
      experience.camera.updateMatrixWorld(true);
    });
    await page.waitForFunction(
      () => window.__TIDELINE__.getState().discovery.focusedIndex === 1,
      null,
      { timeout: 5_000 },
    );
    const prompt = await page.evaluate(() => ({
      visible: document
        .querySelector('#discovery-prompt')
        ?.classList.contains('is-visible'),
      keyVisible: !document.querySelector('#discovery-prompt-key')?.hidden,
      label: document.querySelector('#discovery-prompt-label')?.textContent,
      cameraPosition: window.__TIDELINE__.getState().camera.position,
    }));
    await page.keyboard.down('KeyE');
    await page.waitForTimeout(180);
    await page.keyboard.up('KeyE');
    await page.waitForFunction(
      () => window.__TIDELINE__.getState().discovery.collected === 2,
      null,
      { timeout: 5_000 },
    );
    keyboardDiscovery = {
      prompt,
      state: await page.evaluate(
        () => window.__TIDELINE__.getState().discovery,
      ),
      cameraPosition: await page.evaluate(
        () => window.__TIDELINE__.getState().camera.position,
      ),
    };
    await page.evaluate(() => {
      const experience = window.__TIDELINE__.experience;
      experience.setCameraMode('orbit');
      experience.resetCamera();
    });
    await page.waitForTimeout(1_300);
  }

  await page.evaluate(() => {
    const game = window.__TIDELINE__.experience.discovery;
    for (let chapter = 0; chapter < 3; chapter++) {
      game.tideLevel = -1;
      for (const item of game.items) {
        if (!item.collected) game.collect(item.index, 'automation');
      }
      if (chapter < 2) game.nextChapter();
    }
  });
  await page.waitForFunction(
    () =>
      window.__TIDELINE__.getState().discovery.completed &&
      !document.querySelector('#discovery-reset')?.hidden,
    null,
    { timeout: 5_000 },
  );
  const discoveryCompleteScreenshot = await saveScreenshot(
    page,
    `${config.name}-gameplay-complete`,
  );
  const discoveryComplete = await page.evaluate(() => ({
    state: window.__TIDELINE__.getState().discovery,
    count: document.querySelector('#discovery-count')?.textContent,
    progress: document
      .querySelector('.discovery-progress')
      ?.getAttribute('aria-valuenow'),
    objective: document.querySelector('#discovery-objective')?.textContent,
    resetVisible: !document.querySelector('#discovery-reset')?.hidden,
  }));
  await page.click('#discovery-reset');
  await page.waitForFunction(
    () =>
      window.__TIDELINE__.getState().discovery.collected === 0 &&
      document.querySelector('#discovery-reset')?.hidden,
    null,
    { timeout: 5_000 },
  );
  const discoveryReset = await page.evaluate(() => ({
    state: window.__TIDELINE__.getState().discovery,
    count: document.querySelector('#discovery-count')?.textContent,
    progress: document
      .querySelector('.discovery-progress')
      ?.getAttribute('aria-valuenow'),
  }));
  const discovery = {
    initial: discoveryInitial,
    pointer: pointerDiscovery,
    keyboard: keyboardDiscovery,
    complete: discoveryComplete,
    reset: discoveryReset,
  };
  await page.waitForTimeout(1_900);

  await page.click('#settings-button');
  await page.waitForTimeout(350);
  const settings = await saveScreenshot(page, `${config.name}-settings`);
  let qualityTransition = null;
  const periodBeforeWeather = await page.evaluate(
    () => window.__TIDELINE__.getState().period,
  );
  const setPeriodImmediate = (period) =>
    page.evaluate((nextPeriod) => {
      window.__TIDELINE__.experience.environment.setTimeOfDay(nextPeriod, true);
      document.querySelectorAll('[data-time]').forEach((button) => {
        const active = button.dataset.time === nextPeriod;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      document.querySelector('#period-label').textContent = {
        dawn: '清晨',
        day: '日光',
        sunset: '黄昏',
        night: '月夜',
      }[nextPeriod];
    }, period);
  await setPeriodImmediate('day');
  // Immediate time changes schedule one PMREM refresh. Capture the render
  // baseline after that one-off pass so weather presets are compared against
  // a normal frame instead of cumulative environment-generation statistics.
  await page.waitForTimeout(220);
  const readWeatherSnapshot = () =>
    page.evaluate(() => ({
      state: window.__TIDELINE__.getState(),
      output: document.querySelector('#weather-output')?.value,
      activeMode: document.querySelector('[data-weather][aria-pressed="true"]')
        ?.dataset.weather,
    }));
  const clearWeather = await readWeatherSnapshot();
  await page.click('[data-weather="cloudy"]');
  await page.waitForTimeout(1_350);
  const cloudyWeather = await readWeatherSnapshot();
  await page.click('[data-weather="overcast"]');
  await page.waitForTimeout(1_500);
  const overcastWeather = await readWeatherSnapshot();
  await page.click('[data-close-panel="settings-panel"]');
  await page.waitForTimeout(280);
  const overcastScreenshot = await saveScreenshot(page, `${config.name}-overcast`);
  await page.click('#settings-button');
  await page.waitForTimeout(280);
  await page.click('[data-weather="clear"]');
  await page.waitForTimeout(1_350);
  const restoredWeather = await readWeatherSnapshot();
  const weatherTransition = {
    clear: clearWeather,
    cloudy: cloudyWeather,
    overcast: overcastWeather,
    restored: restoredWeather,
  };
  const readWaveSnapshot = () =>
    page.evaluate(() => {
      const experience = window.__TIDELINE__.experience;
      return {
        waterTime: experience.environment.water.material.uniforms.time.value,
        foamUniform:
          experience.world.foamMaterial.userData.uniforms.uWavePhase.value,
        foam: experience.getDebugState().foam,
        input: Number(document.querySelector('#wave-speed')?.value),
        output: document.querySelector('#wave-output')?.value,
      };
    });
  const setWaveSpeed = (value) =>
    page.evaluate((speed) => {
      const input = document.querySelector('#wave-speed');
      input.value = String(speed);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
  const waveStart = await readWaveSnapshot();
  await setWaveSpeed(1.2);
  await page.waitForTimeout(720);
  const waveFast = await readWaveSnapshot();
  await page.click('[data-close-panel="settings-panel"]');
  await page.waitForTimeout(280);
  const waveFoamScreenshot = await saveScreenshot(page, `${config.name}-wave-foam`);
  await page.click('#settings-button');
  await page.waitForTimeout(280);
  await setWaveSpeed(0.2);
  const waveSlowStart = await readWaveSnapshot();
  await page.waitForTimeout(720);
  const waveSlow = await readWaveSnapshot();
  await setWaveSpeed(0.55);
  await page.waitForTimeout(80);
  const waveRestored = await readWaveSnapshot();
  if (periodBeforeWeather !== 'day') {
    await setPeriodImmediate(periodBeforeWeather);
  }
  const waveTransition = {
    start: waveStart,
    fast: waveFast,
    slowStart: waveSlowStart,
    slow: waveSlow,
    restored: waveRestored,
    screenshot: waveFoamScreenshot,
  };
  const setSwellStrength = (value) =>
    page.evaluate((strength) => {
      const input = document.querySelector('#ocean-swell-strength');
      input.value = String(strength);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
  await setSwellStrength(0);
  await page.click('[data-close-panel="settings-panel"]');
  await page.waitForTimeout(320);
  const swellOffState = await page.evaluate(() => {
    const experience = window.__TIDELINE__.experience;
    experience.renderer.setAnimationLoop(null);
    experience.environment.setWaveSpeed(0);
    experience.renderer.info.reset();
    experience.renderer.render(experience.scene, experience.camera);
    return {
      state: experience.getDebugState(),
      input: Number(document.querySelector('#ocean-swell-strength')?.value),
      output: document.querySelector('#ocean-swell-output')?.value,
      uniform: experience.environment.water.material.uniforms.uSwellStrength.value,
    };
  });
  const swellOffScreenshot = await saveScreenshot(
    page,
    `${config.name}-ocean-swell-off`,
    true,
  );
  await setSwellStrength(1);
  const swellStrongState = await page.evaluate(() => {
    const experience = window.__TIDELINE__.experience;
    experience.renderer.info.reset();
    experience.renderer.render(experience.scene, experience.camera);
    return {
      state: experience.getDebugState(),
      input: Number(document.querySelector('#ocean-swell-strength')?.value),
      output: document.querySelector('#ocean-swell-output')?.value,
      uniform: experience.environment.water.material.uniforms.uSwellStrength.value,
    };
  });
  const swellStrongScreenshot = await saveScreenshot(
    page,
    `${config.name}-ocean-swell`,
    true,
  );
  const swellPixelDifference = comparePng(
    await readFile(swellOffScreenshot.outputPath),
    await readFile(swellStrongScreenshot.outputPath),
  );
  await setSwellStrength(0.42);
  const swellRestoredState = await page.evaluate(() => {
    const experience = window.__TIDELINE__.experience;
    experience.environment.setWaveSpeed(0.55);
    experience.renderer.info.reset();
    experience.renderer.render(experience.scene, experience.camera);
    const state = experience.getDebugState();
    experience.clock.start();
    experience.renderer.setAnimationLoop(experience.animate);
    return {
      state,
      input: Number(document.querySelector('#ocean-swell-strength')?.value),
      output: document.querySelector('#ocean-swell-output')?.value,
      uniform: experience.environment.water.material.uniforms.uSwellStrength.value,
    };
  });
  await page.click('#settings-button');
  await page.waitForTimeout(280);
  const oceanSwellTransition = {
    off: swellOffState,
    strong: swellStrongState,
    restored: swellRestoredState,
    pixelDifference: swellPixelDifference,
    screenshots: {
      off: swellOffScreenshot,
      strong: swellStrongScreenshot,
    },
  };
  const settleWindStrength = (value, advance = 0) =>
    page.evaluate(
      ({ strength, advanceSeconds }) => {
        const experience = window.__TIDELINE__.experience;
        const input = document.querySelector('#wind-strength');
        input.value = String(strength);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        experience.setWindStrength(strength, true);
        const before = {
          phase: experience.getDebugState().wind.phase,
          cloudRotation: experience.environment.clouds.rotation.y,
        };
        experience.environment.setWaveSpeed(0);
        experience.environment.update(
          advanceSeconds,
          experience.clock.elapsedTime + advanceSeconds,
        );
        experience.rain.setWindFactor(
          experience.environment.getWindState().factor,
        );
        experience.rain.update(0, experience.environment.water.position.y);
        experience.renderer.info.reset();
        experience.renderer.render(experience.scene, experience.camera);
        return before;
      },
      { strength: value, advanceSeconds: advance },
    );
  const readWindSnapshot = (before) =>
    page.evaluate((starting) => {
      const experience = window.__TIDELINE__.experience;
      const positions = experience.rain.lines.geometry.attributes.position.array;
      return {
        state: experience.getDebugState(),
        input: Number(document.querySelector('#wind-strength')?.value),
        output: document.querySelector('#wind-output')?.value,
        phaseBefore: starting.phase,
        cloudRotationBefore: starting.cloudRotation,
        cloudTime: experience.environment.clouds.material.uniforms.uTime.value,
        cloudRotation: experience.environment.clouds.rotation.y,
        grassTime:
          experience.world.materials.grass.userData.uniforms.uGrassTime.value,
        grassStrength:
          experience.world.materials.grass.userData.uniforms.uWindStrength.value,
        palmMatrix: Array.from(
          experience.world.palmFronds.mesh.instanceMatrix.array.slice(0, 16),
        ),
        rainLeanX: positions[0] - positions[3],
        rainLeanZ: positions[2] - positions[5],
      };
    }, before);

  await page.evaluate(() => {
    const experience = window.__TIDELINE__.experience;
    experience.renderer.setAnimationLoop(null);
    experience.setRainEnabled(true);
  });
  const calmWindPhase = await settleWindStrength(0, 0.5);
  const calmWind = await readWindSnapshot(calmWindPhase);
  await page.click('[data-close-panel="settings-panel"]');
  await page.waitForTimeout(220);
  const calmWindScreenshot = await saveScreenshot(
    page,
    `${config.name}-wind-calm`,
    true,
  );
  await page.click('#settings-button');
  await page.waitForTimeout(220);
  const strongWindPhase = await settleWindStrength(1.2, 0.5);
  const strongWind = await readWindSnapshot(strongWindPhase);
  await page.click('[data-close-panel="settings-panel"]');
  await page.waitForTimeout(220);
  const strongWindScreenshot = await saveScreenshot(
    page,
    `${config.name}-wind-strong`,
    true,
  );
  await page.click('#settings-button');
  await page.waitForTimeout(220);
  await settleWindStrength(0.6, 0);
  const restoredWind = await page.evaluate(() => {
    const experience = window.__TIDELINE__.experience;
    experience.setRainEnabled(false);
    experience.environment.setWaveSpeed(0.55);
    const state = experience.getDebugState();
    experience.clock.start();
    experience.renderer.setAnimationLoop(experience.animate);
    return {
      state,
      input: Number(document.querySelector('#wind-strength')?.value),
      output: document.querySelector('#wind-output')?.value,
      rainChecked: document.querySelector('#rain-toggle')?.checked,
    };
  });
  const windTransition = {
    calm: calmWind,
    strong: strongWind,
    restored: restoredWind,
    screenshots: {
      calm: calmWindScreenshot,
      strong: strongWindScreenshot,
    },
  };
  const periodBeforeBloom = await page.evaluate(
    () => window.__TIDELINE__.getState().period,
  );
  await setPeriodImmediate('night');
  await page.waitForTimeout(320);
  await page.click('[data-close-panel="settings-panel"]');
  await page.waitForTimeout(280);
  const bloomOffState = await page.evaluate(() => {
    const experience = window.__TIDELINE__.experience;
    experience.renderer.setAnimationLoop(null);
    experience.environment.setWaveSpeed(0);
    experience.renderer.info.reset();
    experience.renderScene(0);
    return {
      state: experience.getDebugState(),
      checked: document.querySelector('#bloom-toggle')?.checked,
    };
  });
  const bloomRequestsBeforeEnable = bloomModuleRequests.length;
  const bloomOffScreenshot = await saveScreenshot(
    page,
    `${config.name}-bloom-off`,
    true,
  );
  await page.click('#settings-button');
  await page.waitForTimeout(280);
  await page.click('label[for="bloom-toggle"]');
  await page.waitForFunction(
    () => {
      const bloom = window.__TIDELINE__.getState().bloom;
      return bloom.enabled && bloom.initialized && !bloom.loading;
    },
    null,
    { timeout: 8_000 },
  );
  const bloomRequestsAfterEnable = bloomModuleRequests.length;
  await page.waitForTimeout(220);
  const bloomSettingsScreenshot = await saveScreenshot(
    page,
    `${config.name}-bloom-settings`,
  );
  await page.click('[data-close-panel="settings-panel"]');
  await page.waitForTimeout(280);
  const bloomOnState = await page.evaluate(() => {
    const experience = window.__TIDELINE__.experience;
    experience.renderer.info.reset();
    experience.renderScene(0);
    return {
      state: experience.getDebugState(),
      checked: document.querySelector('#bloom-toggle')?.checked,
    };
  });
  const bloomOnScreenshot = await saveScreenshot(
    page,
    `${config.name}-bloom`,
    true,
  );
  const bloomPixelDifference = comparePng(
    await readFile(bloomOffScreenshot.outputPath),
    await readFile(bloomOnScreenshot.outputPath),
  );
  await page.click('#settings-button');
  await page.waitForTimeout(280);
  await page.click('label[for="bloom-toggle"]');
  await page.waitForFunction(
    () => !window.__TIDELINE__.getState().bloom.enabled,
    null,
    { timeout: 3_000 },
  );
  const bloomRestoredState = await page.evaluate(() => {
    const experience = window.__TIDELINE__.experience;
    experience.environment.setWaveSpeed(0.55);
    experience.renderer.info.reset();
    experience.renderScene(0);
    const state = experience.getDebugState();
    experience.clock.start();
    experience.renderer.setAnimationLoop(experience.animate);
    return {
      state,
      checked: document.querySelector('#bloom-toggle')?.checked,
    };
  });
  if (periodBeforeBloom !== 'night') {
    await setPeriodImmediate(periodBeforeBloom);
    await page.waitForTimeout(80);
  }
  const bloomRequestsAfterDisable = bloomModuleRequests.length;
  const bloomTransition = {
    off: bloomOffState,
    on: bloomOnState,
    restored: bloomRestoredState,
    moduleRequests: {
      beforeEnable: bloomRequestsBeforeEnable,
      afterEnable: bloomRequestsAfterEnable,
      afterDisable: bloomRequestsAfterDisable,
    },
    pixelDifference: bloomPixelDifference,
    screenshots: {
      off: bloomOffScreenshot,
      on: bloomOnScreenshot,
      settings: bloomSettingsScreenshot,
    },
  };
  const readTideSnapshot = () =>
    page.evaluate(() => {
      const experience = window.__TIDELINE__.experience;
      return {
        state: experience.getDebugState().tide,
        foamZ: experience.world.foam.position.z,
        foamWaterHeight: experience.world.foamMaterial.uniforms.uWaterHeight.value,
        sandWaterHeight: experience.world.sandMaterial.userData.uniforms.uWaterHeight.value,
        sandShoreline:
          experience.world.sandMaterial.userData.uniforms.uShoreline.value,
        walkBoundary: experience.world.getWalkBoundaryZ(0),
        waterY: experience.environment.water.position.y,
        output: document.querySelector('#tide-output')?.value,
        label: document.querySelector('#tide-label')?.textContent,
        activeMode: document.querySelector('[data-tide][aria-pressed="true"]')
          ?.dataset.tide,
      };
    });

  await page.click('[data-tide="low"]');
  await page.evaluate(() =>
    window.__TIDELINE__.experience.setTideMode('low', true),
  );
  const lowTide = await readTideSnapshot();
  await page.click('[data-tide="high"]');
  await page.evaluate(() =>
    window.__TIDELINE__.experience.setTideMode('high', true),
  );
  const highTide = await readTideSnapshot();
  await page.click('[data-close-panel="settings-panel"]');
  await page.waitForTimeout(350);
  const highTideScreenshot = await saveScreenshot(
    page,
    `${config.name}-high-tide`,
  );
  await page.click('#settings-button');
  await page.waitForTimeout(350);
  await page.click('[data-tide="auto"]');
  await page.evaluate(() =>
    window.__TIDELINE__.experience.setTideMode('auto', true),
  );
  const automaticTide = await readTideSnapshot();
  const tideTransition = {
    low: lowTide,
    high: highTide,
    automatic: automaticTide,
  };

  const rainBefore = await page.evaluate(() => {
    const experience = window.__TIDELINE__.experience;
    return {
      ...window.__TIDELINE__.getState(),
      lineUuid: experience.rain.lines?.uuid ?? null,
      reflectionExclusions: experience.world.reflectionExclusionCount,
    };
  });
  await page.click('label[for="rain-toggle"]');
  await page.waitForTimeout(520);
  const rainOn = await page.evaluate(() => ({
    state: window.__TIDELINE__.getState(),
    checked: document.querySelector('#rain-toggle')?.checked,
    positionCount:
      window.__TIDELINE__.experience.rain.lines.geometry.attributes.position.count,
    lineUuid: window.__TIDELINE__.experience.rain.lines.uuid,
    reflectionExclusions:
      window.__TIDELINE__.experience.world.reflectionExclusionCount,
  }));
  await page.click('[data-close-panel="settings-panel"]');
  await page.waitForTimeout(280);
  const rainScreenshot = await saveScreenshot(page, `${config.name}-rain`);
  await page.click('#settings-button');
  await page.waitForTimeout(280);
  await page.click('label[for="rain-toggle"]');
  await page.waitForTimeout(220);
  const rainOff = await page.evaluate(() => ({
    state: window.__TIDELINE__.getState(),
    checked: document.querySelector('#rain-toggle')?.checked,
    lineUuid: window.__TIDELINE__.experience.rain.lines?.uuid ?? null,
  }));
  await page.click('label[for="rain-toggle"]');
  await page.waitForTimeout(220);
  const rainReused = await page.evaluate(() => ({
    state: window.__TIDELINE__.getState(),
    checked: document.querySelector('#rain-toggle')?.checked,
    lineUuid: window.__TIDELINE__.experience.rain.lines?.uuid ?? null,
  }));
  await page.click('label[for="rain-toggle"]');
  await page.waitForTimeout(120);
  const rainRestored = await page.evaluate(() => ({
    state: window.__TIDELINE__.getState(),
    checked: document.querySelector('#rain-toggle')?.checked,
    lineUuid: window.__TIDELINE__.experience.rain.lines?.uuid ?? null,
  }));
  const rainTransition = {
    initial: initialRainLifecycle,
    before: rainBefore,
    on: rainOn,
    off: rainOff,
    reused: rainReused,
    restored: rainRestored,
  };

  const footstepBefore = await page.evaluate(() => ({
    state: window.__TIDELINE__.getState().footstepAudio,
    checked: document.querySelector('#footstep-audio-toggle')?.checked,
  }));
  await page.click('label[for="footstep-audio-toggle"]');
  await page.waitForFunction(
    () => window.__TIDELINE__.getState().footstepAudio.initialized,
    null,
    { timeout: 3000 },
  );
  const footstepOn = await page.evaluate(() => {
    const experience = window.__TIDELINE__.experience;
    const audio = experience.footstepAudio;
    const sandSurface = experience.world.getWalkSurfaceType(0, 25);
    const woodSurface = experience.world.getWalkSurfaceType(38, 32);
    audio.resetMotion();
    audio.update({ x: 0, z: 0, walking: true, grounded: true, surface: sandSurface, speed: 4.2 });
    audio.update({ x: 1.1, z: 0, walking: true, grounded: true, surface: sandSurface, speed: 4.2 });
    audio.resetMotion();
    audio.update({ x: 0, z: 0, walking: true, grounded: true, surface: woodSurface, speed: 4.2 });
    audio.update({ x: 1.1, z: 0, walking: true, grounded: true, surface: woodSurface, speed: 4.2 });
    return {
      state: experience.getDebugState().footstepAudio,
      checked: document.querySelector('#footstep-audio-toggle')?.checked,
      sandSurface,
      woodSurface,
    };
  });
  await page.click('label[for="footstep-audio-toggle"]');
  await page.waitForFunction(
    () => !window.__TIDELINE__.getState().footstepAudio.enabled,
  );
  const footstepOff = await page.evaluate(() => ({
    state: window.__TIDELINE__.getState().footstepAudio,
    checked: document.querySelector('#footstep-audio-toggle')?.checked,
  }));
  const footstepAudioTransition = {
    before: footstepBefore,
    on: footstepOn,
    off: footstepOff,
  };

  const bookmarkBefore = await page.evaluate(() => ({
    state: window.__TIDELINE__.getState().cameraBookmarks,
    output: document.querySelector('#bookmark-output')?.value,
    restoreDisabled: document.querySelector('#bookmark-restore')?.disabled,
    deleteDisabled: document.querySelector('#bookmark-delete')?.disabled,
    stored: localStorage.getItem('tideline.camera-bookmarks.v1'),
  }));
  await page.locator('#camera-bookmarks').scrollIntoViewIfNeeded();
  await page.click('#bookmark-save');
  const bookmarkSaved = await page.evaluate(() => ({
    state: window.__TIDELINE__.getState(),
    output: document.querySelector('#bookmark-output')?.value,
    restoreDisabled: document.querySelector('#bookmark-restore')?.disabled,
    deleteDisabled: document.querySelector('#bookmark-delete')?.disabled,
    saveLabel: document.querySelector('#bookmark-save')?.getAttribute('aria-label'),
    stored: JSON.parse(localStorage.getItem('tideline.camera-bookmarks.v1')),
  }));
  const bookmarkMoved = await page.evaluate(() => {
    const experience = window.__TIDELINE__.experience;
    experience.camera.position.set(-18, 12, 42);
    experience.controls.target.set(-4, 2, 12);
    experience.controls.update();
    return experience.getDebugState().camera;
  });
  await page.click('#bookmark-restore');
  await page.waitForFunction(
    () => window.__TIDELINE__.experience.cameraTween === null,
    null,
    { timeout: 3000 },
  );
  await page.waitForTimeout(120);
  const bookmarkRestored = await page.evaluate(() => ({
    state: window.__TIDELINE__.getState(),
    settingsHidden: document.querySelector('#settings-panel')?.hidden,
  }));
  const bookmarkViewScreenshot = await saveScreenshot(
    page,
    `${config.name}-bookmark-view`,
  );
  await page.click('#settings-button');
  await page.waitForTimeout(300);
  await page.locator('#camera-bookmarks').scrollIntoViewIfNeeded();
  const bookmarkPanelScreenshot = await saveScreenshot(
    page,
    `${config.name}-bookmark-settings`,
  );
  await page.click('[data-bookmark-slot="2"]');
  const bookmarkEmptySlot = await page.evaluate(() => ({
    output: document.querySelector('#bookmark-output')?.value,
    active: document.querySelector('[data-bookmark-slot][aria-pressed="true"]')
      ?.dataset.bookmarkSlot,
    restoreDisabled: document.querySelector('#bookmark-restore')?.disabled,
    deleteDisabled: document.querySelector('#bookmark-delete')?.disabled,
  }));
  await page.click('[data-bookmark-slot="1"]');
  await page.click('#bookmark-delete');
  const bookmarkDeleted = await page.evaluate(() => ({
    state: window.__TIDELINE__.getState().cameraBookmarks,
    output: document.querySelector('#bookmark-output')?.value,
    restoreDisabled: document.querySelector('#bookmark-restore')?.disabled,
    deleteDisabled: document.querySelector('#bookmark-delete')?.disabled,
    stored: JSON.parse(localStorage.getItem('tideline.camera-bookmarks.v1')),
  }));
  const bookmarkTransition = {
    before: bookmarkBefore,
    saved: bookmarkSaved,
    moved: bookmarkMoved,
    restored: bookmarkRestored,
    emptySlot: bookmarkEmptySlot,
    deleted: bookmarkDeleted,
    screenshots: {
      view: bookmarkViewScreenshot,
      panel: bookmarkPanelScreenshot,
    },
  };

  const textureImport = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 32;
    const context = canvas.getContext('2d');
    context.fillStyle = '#2b7f82';
    context.fillRect(0, 0, 64, 32);
    context.fillStyle = '#f1b55f';
    context.fillRect(8, 8, 48, 16);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const file = new File([blob], 'visual-check.png', { type: 'image/png' });
    const state = await window.__TIDELINE__.experience.importLocalAsset('texture', file);
    return {
      state,
      output: document.querySelector('#asset-output')?.value,
      removeDisabled: document.querySelector('#remove-asset')?.disabled,
      transformHidden: document.querySelector('#asset-transform-control')?.hidden,
    };
  });

  await page.evaluate(() => {
    const setRange = (selector, value) => {
      const input = document.querySelector(selector);
      input.value = String(value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    setRange('#asset-position-x', -12.5);
    setRange('#asset-position-z', 33);
    setRange('#asset-rotation', 45);
    setRange('#asset-scale', 1.4);
  });
  const textureTransformed = await page.evaluate(() => {
    const manager = window.__TIDELINE__.experience.localAssets;
    return {
      state: manager.getDebugState(),
      rootPosition: manager.current.root.position.toArray(),
      rootScale: manager.current.root.scale.x,
      outputs: {
        x: document.querySelector('#asset-position-x-output')?.value,
        z: document.querySelector('#asset-position-z-output')?.value,
        rotation: document.querySelector('#asset-rotation-output')?.value,
        scale: document.querySelector('#asset-scale-output')?.value,
      },
    };
  });
  await page.click('#asset-transform-reset');
  await page.waitForTimeout(80);
  const textureReset = await page.evaluate(() => ({
    state: window.__TIDELINE__.getState().localAsset,
    transformHidden: document.querySelector('#asset-transform-control')?.hidden,
  }));
  const textureTransform = {
    transformed: textureTransformed,
    reset: textureReset,
  };

  const modelImport = await page.evaluate(async () => {
    const positions = new Float32Array([
      -0.5, 0, 0,
      0.5, 0, 0,
      0, 1, 0,
    ]);
    const times = new Float32Array([0, 1]);
    const halfTurn = Math.sin(Math.PI / 4);
    const turnEnd = Math.cos(Math.PI / 4);
    const rotationsY = new Float32Array([
      0, 0, 0, 1,
      0, halfTurn, 0, turnEnd,
    ]);
    const rotationsX = new Float32Array([
      0, 0, 0, 1,
      halfTurn, 0, 0, turnEnd,
    ]);
    const chunks = [positions, times, rotationsY, rotationsX];
    const offsets = [];
    let byteLength = 0;
    chunks.forEach((chunk) => {
      offsets.push(byteLength);
      byteLength += chunk.byteLength;
    });
    const bytes = new Uint8Array(byteLength);
    chunks.forEach((chunk, index) => {
      bytes.set(new Uint8Array(chunk.buffer), offsets[index]);
    });
    let binary = '';
    bytes.forEach((value) => { binary += String.fromCharCode(value); });
    const gltf = {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0, name: 'VisualCheckModel' }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      buffers: [{
        byteLength: bytes.byteLength,
        uri: `data:application/octet-stream;base64,${btoa(binary)}`,
      }],
      bufferViews: chunks.map((chunk, index) => ({
        buffer: 0,
        byteOffset: offsets[index],
        byteLength: chunk.byteLength,
      })),
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 3,
          type: 'VEC3',
          min: [-0.5, 0, 0],
          max: [0.5, 1, 0],
        },
        {
          bufferView: 1,
          componentType: 5126,
          count: 2,
          type: 'SCALAR',
          min: [0],
          max: [1],
        },
        {
          bufferView: 2,
          componentType: 5126,
          count: 2,
          type: 'VEC4',
        },
        {
          bufferView: 3,
          componentType: 5126,
          count: 2,
          type: 'VEC4',
        },
      ],
      animations: [
        {
          name: '潮风摇摆',
          samplers: [{ input: 1, output: 2, interpolation: 'LINEAR' }],
          channels: [{ sampler: 0, target: { node: 0, path: 'rotation' } }],
        },
        {
          name: '回望岸线',
          samplers: [{ input: 1, output: 3, interpolation: 'LINEAR' }],
          channels: [{ sampler: 0, target: { node: 0, path: 'rotation' } }],
        },
      ],
    };
    const file = new File([JSON.stringify(gltf)], 'visual-check.gltf', {
      type: 'model/gltf+json',
    });
    const state = await window.__TIDELINE__.experience.importLocalAsset('model', file);
    return {
      state,
      output: document.querySelector('#asset-output')?.value,
      removeDisabled: document.querySelector('#remove-asset')?.disabled,
    };
  });

  await page.waitForTimeout(180);
  const animationInitial = await page.evaluate(() => ({
    state: window.__TIDELINE__.getState().localAsset,
    hidden: document.querySelector('#asset-animation-control')?.hidden,
    options: [...document.querySelectorAll('#asset-animation-select option')]
      .map((option) => option.textContent),
    output: document.querySelector('#asset-animation-output')?.value,
    toggleLabel: document.querySelector('#asset-animation-toggle')?.getAttribute('aria-label'),
  }));
  await page.evaluate(() => {
    const values = {
      '#asset-position-x': 9,
      '#asset-position-z': 29,
      '#asset-rotation': -30,
      '#asset-scale': 0.75,
    };
    Object.entries(values).forEach(([selector, value]) => {
      const input = document.querySelector(selector);
      input.value = String(value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });
  const modelTransformBefore = await page.evaluate(() => {
    const manager = window.__TIDELINE__.experience.localAssets;
    return {
      state: manager.getDebugState(),
      rootPosition: manager.current.root.position.toArray(),
      rootScale: manager.current.root.scale.x,
    };
  });
  await page.waitForFunction((startTime) => {
    const currentTime = window.__TIDELINE__.getState().localAsset.animation?.time;
    if (!Number.isFinite(currentTime)) return false;
    return (currentTime - startTime + 1) % 1 >= 0.1;
  }, modelTransformBefore.state.animation.time, { timeout: 3_000 });
  const modelTransformAfter = await page.evaluate(
    () => window.__TIDELINE__.getState().localAsset,
  );
  await page.waitForFunction(() => document.querySelector('#toast')?.hidden, null, {
    timeout: 3000,
  });
  await page.locator('#asset-transform-control').scrollIntoViewIfNeeded();
  const placementScreenshot = await saveScreenshot(page, `${config.name}-placement-settings`);
  const modelTransform = {
    before: modelTransformBefore,
    after: modelTransformAfter,
    screenshot: placementScreenshot,
  };
  await page.selectOption('#asset-animation-select', '1');
  await page.waitForTimeout(460);
  const animationSwitched = await page.evaluate(
    () => window.__TIDELINE__.getState().localAsset.animation,
  );
  await page.click('#asset-animation-toggle');
  await page.waitForTimeout(80);
  const animationPaused = await page.evaluate(
    () => window.__TIDELINE__.getState().localAsset.animation,
  );
  await page.waitForTimeout(180);
  const animationPausedLater = await page.evaluate(
    () => window.__TIDELINE__.getState().localAsset.animation,
  );
  await page.evaluate(() => {
    const input = document.querySelector('#asset-animation-speed');
    input.value = '1.75';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const animationSpeed = await page.evaluate(
    () => window.__TIDELINE__.getState().localAsset.animation,
  );
  await page.click('#asset-animation-toggle');
  await page.waitForTimeout(180);
  const animationResumed = await page.evaluate(
    () => window.__TIDELINE__.getState().localAsset.animation,
  );
  await page.locator('#asset-animation-control').scrollIntoViewIfNeeded();
  const animationScreenshot = await saveScreenshot(page, `${config.name}-animation-settings`);
  await page.click('#asset-animation-restart');
  const animationRestarted = await page.evaluate(
    () => window.__TIDELINE__.getState().localAsset.animation,
  );
  const animationWorkflow = {
    initial: animationInitial,
    switched: animationSwitched,
    paused: animationPaused,
    pausedLater: animationPausedLater,
    speed: animationSpeed,
    resumed: animationResumed,
    restarted: animationRestarted,
    screenshot: animationScreenshot,
  };

  const binaryModelImport = await page.evaluate(async () => {
    const positions = new Float32Array([
      -0.5, 0, 0,
      0.5, 0, 0,
      0, 1, 0,
    ]);
    const binary = new Uint8Array(positions.buffer);
    const gltf = {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      buffers: [{ byteLength: binary.byteLength }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: binary.byteLength }],
      accessors: [{
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [-0.5, 0, 0],
        max: [0.5, 1, 0],
      }],
    };
    const jsonBytes = new TextEncoder().encode(JSON.stringify(gltf));
    const jsonLength = Math.ceil(jsonBytes.length / 4) * 4;
    const binaryLength = Math.ceil(binary.length / 4) * 4;
    const buffer = new ArrayBuffer(12 + 8 + jsonLength + 8 + binaryLength);
    const view = new DataView(buffer);
    view.setUint32(0, 0x46546c67, true);
    view.setUint32(4, 2, true);
    view.setUint32(8, buffer.byteLength, true);
    view.setUint32(12, jsonLength, true);
    view.setUint32(16, 0x4e4f534a, true);
    const output = new Uint8Array(buffer);
    output.fill(0x20, 20, 20 + jsonLength);
    output.set(jsonBytes, 20);
    const binaryHeader = 20 + jsonLength;
    view.setUint32(binaryHeader, binaryLength, true);
    view.setUint32(binaryHeader + 4, 0x004e4942, true);
    output.set(binary, binaryHeader + 8);
    const file = new File([buffer], 'visual-check.glb', {
      type: 'model/gltf-binary',
    });
    const state = await window.__TIDELINE__.experience.importLocalAsset('model', file);
    return {
      state,
      output: document.querySelector('#asset-output')?.value,
      removeDisabled: document.querySelector('#remove-asset')?.disabled,
      animationHidden: document.querySelector('#asset-animation-control')?.hidden,
      transformHidden: document.querySelector('#asset-transform-control')?.hidden,
    };
  });
  await page.click('#remove-asset');
  await page.waitForTimeout(180);
  const assetRemoved = await page.evaluate(() => ({
    state: window.__TIDELINE__.getState().localAsset,
    output: document.querySelector('#asset-output')?.value,
    removeDisabled: document.querySelector('#remove-asset')?.disabled,
    animationHidden: document.querySelector('#asset-animation-control')?.hidden,
    transformHidden: document.querySelector('#asset-transform-control')?.hidden,
  }));
  const assetImport = {
    texture: textureImport,
    textureTransform,
    gltf: modelImport,
    modelTransform,
    animation: animationWorkflow,
    glb: binaryModelImport,
    removed: assetRemoved,
  };

  if (!config.mobile) {
    // Exercise world and cloud resource rebuilding in both directions. Dispose
    // listeners prove that obsolete GPU resources are released, not retained.
    const attachCloudDisposalProbe = () =>
      page.evaluate(() => {
        window.__TIDELINE_CLOUD_DISPOSALS__ ??= {
          geometries: 0,
          materials: 0,
          textures: 0,
        };
        const cloud = window.__TIDELINE__.experience.environment.clouds;
        cloud.geometry.addEventListener(
          'dispose',
          () => { window.__TIDELINE_CLOUD_DISPOSALS__.geometries += 1; },
          { once: true },
        );
        cloud.material.addEventListener(
          'dispose',
          () => { window.__TIDELINE_CLOUD_DISPOSALS__.materials += 1; },
          { once: true },
        );
        cloud.material.uniforms.uCloudMap.value.addEventListener(
          'dispose',
          () => { window.__TIDELINE_CLOUD_DISPOSALS__.textures += 1; },
          { once: true },
        );
      });
    const attachWaterNormalDisposalProbe = () =>
      page.evaluate(() => {
        const texture = window.__TIDELINE__.experience.environment.waterNormals;
        texture.addEventListener('dispose', () => {
          window.__TIDELINE_WATER_NORMAL_DISPOSALS__ += 1;
        });
      });
    const attachMoonDisposalProbe = () =>
      page.evaluate(() => {
        const moon = window.__TIDELINE__.experience.environment.moon;
        const texture = moon.material.map;
        const geometry = moon.geometry;
        texture.addEventListener('dispose', () => {
          window.__TIDELINE_MOON_DISPOSALS__ += 1;
        });
        geometry.addEventListener('dispose', () => {
          window.__TIDELINE_MOON_GEOMETRY_DISPOSALS__ += 1;
        });
      });
    const attachStarDisposalProbe = () =>
      page.evaluate(() => {
        const geometry = window.__TIDELINE__.experience.environment.stars.geometry;
        geometry.addEventListener('dispose', () => {
          window.__TIDELINE_STAR_GEOMETRY_DISPOSALS__ += 1;
        });
      });
    const readQualityState = () =>
      page.evaluate(() => ({
        ...window.__TIDELINE__.getState(),
        cloudDisposals: { ...window.__TIDELINE_CLOUD_DISPOSALS__ },
        waterNormalDisposals:
          window.__TIDELINE_WATER_NORMAL_DISPOSALS__ ?? 0,
        waterNormalSourceSame:
          window.__TIDELINE__.experience.environment.waterNormalSource ===
          window.__TIDELINE_WATER_NORMAL_SOURCE__,
        moonDisposals: window.__TIDELINE_MOON_DISPOSALS__ ?? 0,
        moonGeometryDisposals:
          window.__TIDELINE_MOON_GEOMETRY_DISPOSALS__ ?? 0,
        starGeometryDisposals:
          window.__TIDELINE_STAR_GEOMETRY_DISPOSALS__ ?? 0,
        waterTargetDisposals:
          window.__TIDELINE_WATER_TARGET_DISPOSALS__ ?? 0,
        waterTargetSame:
          window.__TIDELINE__.experience.environment.waterReflectionTarget ===
          window.__TIDELINE_WATER_TARGET__,
      }));
    await page.evaluate(() => { window.__TIDELINE_CLOUD_DISPOSALS__ = null; });
    await page.evaluate(() => {
      const environment = window.__TIDELINE__.experience.environment;
      window.__TIDELINE_WATER_NORMAL_SOURCE__ = environment.waterNormalSource;
      window.__TIDELINE_WATER_NORMAL_DISPOSALS__ = 0;
      window.__TIDELINE_MOON_DISPOSALS__ = 0;
      window.__TIDELINE_MOON_GEOMETRY_DISPOSALS__ = 0;
      window.__TIDELINE_STAR_GEOMETRY_DISPOSALS__ = 0;
      window.__TIDELINE_WATER_TARGET__ = environment.waterReflectionTarget;
      window.__TIDELINE_WATER_TARGET_DISPOSALS__ = 0;
      environment.waterReflectionTarget.addEventListener('dispose', () => {
        window.__TIDELINE_WATER_TARGET_DISPOSALS__ += 1;
      });
    });
    await attachCloudDisposalProbe();
    await attachWaterNormalDisposalProbe();
    await attachMoonDisposalProbe();
    await attachStarDisposalProbe();
    const before = await readQualityState();
    await page.click('[data-quality="low"]');
    await page.waitForFunction((previous) => {
      const state = window.__TIDELINE__.getState();
      return (
        state.effectiveQuality === 'low' &&
        state.worldRevision === previous.worldRevision + 1 &&
        state.starQuality.quality === 'low' &&
        state.starQuality.count === 480 &&
        state.starQuality.revision === previous.starRevision + 1 &&
        state.starQuality.rotationY >= previous.starRotation + 0.001 &&
        state.waterTime >= previous.waterTime + 0.05 &&
        state.cloudQuality.phase >= previous.cloudPhase + 0.01 &&
        state.render.points === 966
      );
    }, {
      worldRevision: before.worldRevision,
      starRevision: before.starQuality.revision,
      starRotation: before.starQuality.rotationY,
      waterTime: before.waterTime,
      cloudPhase: before.cloudQuality.phase,
    }, { timeout: 5_000 }).catch(async (error) => {
      console.error('Low-quality expected baseline:', JSON.stringify({ worldRevision: before.worldRevision,
        starRevision: before.starQuality.revision, starRotation: before.starQuality.rotationY,
        waterTime: before.waterTime, cloudPhase: before.cloudQuality.phase }));
      console.error('Low-quality transition state:', JSON.stringify(await page.evaluate(() => window.__TIDELINE__.getState())));
      throw error;
    });
    const low = await readQualityState();
    await page.click('[data-close-panel="settings-panel"]');
    await page.waitForTimeout(220);
    const lowScreenshot = await saveScreenshot(
      page,
      `${config.name}-quality-low`,
    );
    await page.click('#settings-button');
    await page.waitForTimeout(220);
    await attachCloudDisposalProbe();
    await attachWaterNormalDisposalProbe();
    await attachMoonDisposalProbe();
    await attachStarDisposalProbe();
    await page.click('[data-quality="high"]');
    await page.waitForFunction((previous) => {
      const state = window.__TIDELINE__.getState();
      return (
        state.effectiveQuality === 'high' &&
        state.worldRevision === previous.worldRevision + 1 &&
        state.starQuality.quality === 'high' &&
        state.starQuality.count === 950 &&
        state.starQuality.revision === previous.starRevision + 1 &&
        state.starQuality.rotationY >= previous.starRotation + 0.001 &&
        state.waterTime >= previous.waterTime + 0.05 &&
        state.cloudQuality.phase >= previous.cloudPhase + 0.01 &&
        state.render.points === 1906
      );
    }, {
      worldRevision: low.worldRevision,
      starRevision: low.starQuality.revision,
      starRotation: low.starQuality.rotationY,
      waterTime: low.waterTime,
      cloudPhase: low.cloudQuality.phase,
    }, { timeout: 5_000 });
    const high = await readQualityState();
    await page.click('[data-close-panel="settings-panel"]');
    await page.waitForTimeout(220);
    const highScreenshot = await saveScreenshot(
      page,
      `${config.name}-quality-high`,
    );
    await page.click('#settings-button');
    await page.waitForTimeout(220);
    qualityTransition = {
      before,
      low,
      high,
      screenshots: { low: lowScreenshot, high: highScreenshot },
    };
  }

  const layoutOverflow = await inspectLayout(page);
  const debugState = await page.evaluate(() => window.__TIDELINE__.getState());
  const cameraUi = await page.evaluate(() => {
    const freeButton = document.querySelector('#camera-mode-button');
    const walkButton = document.querySelector('#walk-mode-button');
    const status = document.querySelector('.camera-status');
    return {
      freeButtonDisplay: getComputedStyle(freeButton).display,
      walkButtonDisplay: getComputedStyle(walkButton).display,
      statusDisplay: getComputedStyle(status).display,
    };
  });

  const result = {
    viewport: config,
    consoleErrors,
    layoutOverflow,
    debugState,
    cameraUi,
    guide: {
      initial: guideInitial,
      walkEntry: guideWalkEntry,
      reopened: guideReopened,
      closed: guideClosed,
    },
    pointerLockTransition,
    lockFailureRecovery,
    freeCameraTransition,
    walkCameraTransition,
    discovery,
    billiardsInteraction,
    daylightCulling,
    weatherTransition,
    waveTransition,
    oceanSwellTransition,
    windTransition,
    bloomTransition,
    tideTransition,
    rainTransition,
    footstepAudioTransition,
    bookmarkTransition,
    assetImport,
    qualityTransition,
    celestialLifecycle: {
      initial: initialCelestialLifecycle,
    },
    discoveryLifecycle: {
      initial: initialDiscoveryLifecycle,
      entered: enteredDiscoveryLifecycle,
    },
    billiardsLifecycle: {
      initial: initialBilliardsLifecycle,
      entered: enteredBilliardsLifecycle,
    },
    waterAdvanced: waterTimeAfter > waterTimeBefore,
    canvasStats: canvasBefore.stats,
    periodStats: {
      dawn: dawn.stats,
      day: day.stats,
      sunset: sunset?.stats ?? null,
      night: night?.stats ?? null,
    },
    periodStates: {
      dawn: dawnState,
      day: dayState,
      sunset: sunsetState,
      night: nightState,
    },
    screenshots: {
      intro: intro.outputPath,
      guide: guide.outputPath,
      dawn: dawn.outputPath,
      day: day.outputPath,
      billiards: billiardsScreenshot.outputPath,
      walkView: walkView?.outputPath ?? null,
      freeView: freeView?.outputPath ?? null,
      sunset: sunset?.outputPath ?? null,
      night: night?.outputPath ?? null,
      settings: settings.outputPath,
      overcast: overcastScreenshot.outputPath,
      waveFoam: waveFoamScreenshot.outputPath,
      oceanSwell: swellStrongScreenshot.outputPath,
      bloom: bloomOnScreenshot.outputPath,
      bloomSettings: bloomSettingsScreenshot.outputPath,
      highTide: highTideScreenshot.outputPath,
      rain: rainScreenshot.outputPath,
      bookmarkView: bookmarkViewScreenshot.outputPath,
      bookmarkSettings: bookmarkPanelScreenshot.outputPath,
      gameplayComplete: discoveryCompleteScreenshot.outputPath,
    },
  };

  result.environmentDispose = await page.evaluate(() => {
    const experience = window.__TIDELINE__.experience;
    const normalTexture = experience.environment.waterNormals;
    const normalSource = experience.environment.waterNormalSource;
    const moonTexture = experience.environment.moon.material.map;
    const haloTexture = experience.environment.moonHalo.material.map;
    const moonGeometry = experience.environment.moon.geometry;
    const starGeometry = experience.environment.stars.geometry;
    const target = experience.environment.waterReflectionTarget;
    const discoveryGroup = experience.discovery.group;
    const discoveryGlass = experience.discovery.glass;
    const discoveryGlow = experience.discovery.glows;
    const discoveryGlassGeometry = discoveryGlass.geometry;
    const discoveryGlassMaterial = discoveryGlass.material;
    const discoveryGlowGeometry = discoveryGlow.geometry;
    const discoveryGlowMaterial = discoveryGlow.material;
    const billiardsGroup = experience.billiards.group;
    const billiardsResources = [
      experience.billiards.bed.geometry,
      experience.billiards.bed.material,
      experience.billiards.bed.material.map,
      experience.billiards.frame.geometry,
      experience.billiards.frame.material,
      experience.billiards.pockets.geometry,
      experience.billiards.pockets.material,
      experience.billiards.ballMesh.geometry,
      experience.billiards.ballMesh.material,
      experience.billiards.ballMesh.material.map,
      experience.billiards.aimLine.geometry,
      experience.billiards.aimLine.material,
    ];
    let normalTextureDisposals = 0;
    let normalSourceDisposals = 0;
    let moonTextureDisposals = 0;
    let haloTextureDisposals = 0;
    let moonGeometryDisposals = 0;
    let starGeometryDisposals = 0;
    let targetDisposals = 0;
    let discoveryInstanceDisposals = 0;
    let discoveryGlassGeometryDisposals = 0;
    let discoveryGlassMaterialDisposals = 0;
    let discoveryGlowGeometryDisposals = 0;
    let discoveryGlowMaterialDisposals = 0;
    const billiardsResourceDisposals = new Map(
      billiardsResources.map((resource) => [resource, 0]),
    );
    normalTexture?.addEventListener('dispose', () => {
      normalTextureDisposals += 1;
    });
    normalSource?.addEventListener('dispose', () => {
      normalSourceDisposals += 1;
    });
    moonTexture?.addEventListener('dispose', () => {
      moonTextureDisposals += 1;
    });
    haloTexture?.addEventListener('dispose', () => {
      haloTextureDisposals += 1;
    });
    moonGeometry?.addEventListener('dispose', () => {
      moonGeometryDisposals += 1;
    });
    starGeometry?.addEventListener('dispose', () => {
      starGeometryDisposals += 1;
    });
    target?.addEventListener('dispose', () => {
      targetDisposals += 1;
    });
    discoveryGlass.addEventListener('dispose', () => {
      discoveryInstanceDisposals += 1;
    });
    discoveryGlassGeometry.addEventListener('dispose', () => {
      discoveryGlassGeometryDisposals += 1;
    });
    discoveryGlassMaterial.addEventListener('dispose', () => {
      discoveryGlassMaterialDisposals += 1;
    });
    discoveryGlowGeometry.addEventListener('dispose', () => {
      discoveryGlowGeometryDisposals += 1;
    });
    discoveryGlowMaterial.addEventListener('dispose', () => {
      discoveryGlowMaterialDisposals += 1;
    });
    billiardsResourceDisposals.forEach((_count, resource) => {
      resource.addEventListener('dispose', () => {
        billiardsResourceDisposals.set(
          resource,
          billiardsResourceDisposals.get(resource) + 1,
        );
      });
    });

    experience.dispose();

    return {
      normalTextureDisposals,
      normalSourceDisposals,
      normalTextureCleared: experience.environment.waterNormals === null,
      normalSourceCleared: experience.environment.waterNormalSource === null,
      moonTextureDisposals,
      moonTextureCleared: experience.environment.moon.material.map === null,
      haloTextureDisposals,
      haloTextureCleared: experience.environment.moonHalo.material.map === null,
      moonGeometryDisposals,
      moonGeometryCleared: experience.environment.moon.geometry === null,
      starGeometryDisposals,
      starGeometryCleared: experience.environment.stars.geometry === null,
      targetDisposals,
      targetCleared: experience.environment.waterReflectionTarget === null,
      celestialInitialized: experience.environment.celestialInitialized,
      celestialObjectsDetached: [
        experience.environment.stars,
        experience.environment.moon,
        experience.environment.moonHalo,
      ].every((object) => object.parent === null),
      discoveryInstanceDisposals,
      discoveryGlassGeometryDisposals,
      discoveryGlassMaterialDisposals,
      discoveryGlowGeometryDisposals,
      discoveryGlowMaterialDisposals,
      discoveryReleased:
        !experience.discovery.initialized &&
        experience.discovery.releases === experience.discovery.allocations,
      discoveryResourcesCleared:
        experience.discovery.glass === null &&
        experience.discovery.glows === null &&
        experience.discovery.glowMaterial === null,
      discoveryGroupDetached: discoveryGroup.parent === null,
      billiardsResourceCount: billiardsResources.length,
      billiardsResourcesDisposed: [...billiardsResourceDisposals.values()].every(
        (count) => count === 1,
      ),
      billiardsReleased:
        !experience.billiards.initialized &&
        experience.billiards.releases === 1,
      billiardsGroupDetached: billiardsGroup.parent === null,
    };
  });

  await context.close();
  return result;
}

const browser = await chromium.launch(browserOptions());

try {
  // Desktop captures every time preset; mobile focuses on responsive layout
  // and the low-quality material branch to keep the suite quick.
  const results = [];
  results.push(
    await runViewport(browser, {
      name: 'desktop',
      width: 1440,
      height: 900,
      mobile: false,
    }),
  );
  results.push(
    await runViewport(browser, {
      name: 'mobile',
      width: 390,
      height: 844,
      mobile: true,
    }),
  );

  const failures = [];
  results.forEach((result) => {
    const distance3 = (a, b) =>
      Array.isArray(a) && Array.isArray(b)
        ? Math.hypot(...a.map((value, index) => value - b[index]))
        : Infinity;
    if (result.consoleErrors.length) {
      failures.push(`${result.viewport.name}: console errors`);
    }
    if (result.layoutOverflow.length) {
      failures.push(`${result.viewport.name}: control text overflow`);
    }
    if (!result.waterAdvanced) {
      failures.push(`${result.viewport.name}: water animation did not advance`);
    }
    const gpuTiming = result.debugState.gpuTiming;
    const gpuStateInvalid =
      !gpuTiming ||
      typeof gpuTiming.supported !== 'boolean' ||
      gpuTiming.budgetMs !== 20 ||
      gpuTiming.minimumSamples !== 12 ||
      gpuTiming.pendingQueries < 0 ||
      gpuTiming.pendingQueries > gpuTiming.maxPendingQueries ||
      gpuTiming.disjointEvents < 0 ||
      gpuTiming.droppedQueries < 0 ||
      gpuTiming.skippedFrames < 0 ||
      ![
        'monitoring',
        'within-budget',
        'manual',
        'fps',
        'gpu',
        'fps-and-gpu',
      ].includes(gpuTiming.autoQualityReason) ||
      (gpuTiming.supported
        ? gpuTiming.samples < 1 ||
          !Number.isFinite(gpuTiming.latestMs) ||
          gpuTiming.latestMs < 0 ||
          !Number.isFinite(gpuTiming.smoothedMs) ||
          gpuTiming.smoothedMs < 0 ||
          gpuTiming.unavailableReason !== null
        : gpuTiming.samples !== 0 ||
          gpuTiming.latestMs !== null ||
          gpuTiming.smoothedMs !== null ||
          !['extension-unavailable', 'query-error'].includes(
            gpuTiming.unavailableReason,
          ));
    if (gpuStateInvalid) {
      failures.push(`${result.viewport.name}: GPU frame timing state failed`);
    }
    const dawnState = result.periodStates.dawn;
    const dayState = result.periodStates.day;
    const dawnStats = result.periodStats.dawn;
    // Both entry cameras now include the lantern; the older portrait crop did not.
    const expectedLanternDrawSaving = 2;
    const expectedLanternTriangleSaving = 170;
    const discoveryLifecycle = result.discoveryLifecycle;
    const initialDiscovery = discoveryLifecycle?.initial;
    const enteredDiscovery = discoveryLifecycle?.entered;
    const finalDiscovery = result.debugState.discovery;
    if (
      !initialDiscovery ||
      !enteredDiscovery ||
      initialDiscovery.state.enabled ||
      initialDiscovery.state.initialized ||
      initialDiscovery.state.allocations !== 0 ||
      initialDiscovery.state.releases !== 0 ||
      initialDiscovery.state.residentAttributeBytes !== 0 ||
      initialDiscovery.state.plannedAttributeBytes !== 8328 ||
      initialDiscovery.state.objectsInScene !== 0 ||
      initialDiscovery.state.drawObjects !== 0 ||
      initialDiscovery.state.resourcesLinked ||
      initialDiscovery.state.total !== 6 ||
      !initialDiscovery.state.groupUuid ||
      initialDiscovery.state.glassUuid !== null ||
      initialDiscovery.state.glowUuid !== null ||
      initialDiscovery.groupInScene ||
      initialDiscovery.glassPresent ||
      initialDiscovery.glowPresent ||
      !enteredDiscovery.state.enabled ||
      !enteredDiscovery.state.initialized ||
      enteredDiscovery.state.allocations !== 1 ||
      enteredDiscovery.state.releases !== 0 ||
      enteredDiscovery.state.residentAttributeBytes !== 8328 ||
      enteredDiscovery.state.plannedAttributeBytes !== 8328 ||
      enteredDiscovery.state.glassGeometryBytes !== 7680 ||
      enteredDiscovery.state.instanceMatrixBytes !== 384 ||
      enteredDiscovery.state.instanceColorBytes !== 72 ||
      enteredDiscovery.state.glowAttributeBytes !== 192 ||
      enteredDiscovery.state.objectsInScene !== 3 ||
      enteredDiscovery.state.drawObjects !== 2 ||
      !enteredDiscovery.state.resourcesLinked ||
      !enteredDiscovery.groupInScene ||
      !enteredDiscovery.glassPresent ||
      !enteredDiscovery.glowPresent ||
      enteredDiscovery.state.groupUuid !== initialDiscovery.state.groupUuid ||
      !enteredDiscovery.state.glassUuid ||
      !enteredDiscovery.state.glowUuid ||
      enteredDiscovery.reflectionExclusions !==
        initialDiscovery.reflectionExclusions + 2 ||
      !finalDiscovery.initialized ||
      finalDiscovery.allocations !== 4 ||
      finalDiscovery.releases !== 3 ||
      finalDiscovery.residentAttributeBytes !== 8328 ||
      finalDiscovery.objectsInScene !== 3 ||
      finalDiscovery.drawObjects !== 2 ||
      !finalDiscovery.resourcesLinked ||
      finalDiscovery.groupUuid !== enteredDiscovery.state.groupUuid ||
      finalDiscovery.glassUuid === enteredDiscovery.state.glassUuid ||
      finalDiscovery.glowUuid === enteredDiscovery.state.glowUuid
    ) {
      failures.push(`${result.viewport.name}: discovery resource lifecycle failed`);
    }
    const billiardsLifecycle = result.billiardsLifecycle;
    const initialBilliards = billiardsLifecycle?.initial;
    const enteredBilliards = billiardsLifecycle?.entered;
    const finalBilliards = result.debugState.billiards;
    if (
      !initialBilliards ||
      !enteredBilliards ||
      !initialBilliards.charactersDisabled ||
      initialBilliards.state.enabled ||
      initialBilliards.state.initialized ||
      initialBilliards.state.loading ||
      initialBilliards.state.visible ||
      initialBilliards.state.activeBalls !== 0 ||
      initialBilliards.state.physicsBodies !== 0 ||
      initialBilliards.state.drawObjects !== 0 ||
      initialBilliards.state.residentDrawObjects !== 0 ||
      initialBilliards.state.allocations !== 0 ||
      initialBilliards.state.releases !== 0 ||
      initialBilliards.state.resourcesLinked ||
      initialBilliards.state.groupUuid !== null ||
      initialBilliards.groupInScene ||
      !enteredBilliards.charactersDisabled ||
      !enteredBilliards.state.enabled ||
      !enteredBilliards.state.initialized ||
      enteredBilliards.state.loading ||
      !enteredBilliards.state.visible ||
      enteredBilliards.state.physics !== 'cannon-es' ||
      enteredBilliards.state.targetBalls !== 15 ||
      enteredBilliards.state.totalBalls !== 16 ||
      enteredBilliards.state.activeBalls !== 16 ||
      enteredBilliards.state.pockets !== 6 ||
      enteredBilliards.state.physicsBodies !== 22 ||
      enteredBilliards.state.railBodies !== 6 ||
      enteredBilliards.state.drawObjects !== 6 ||
      enteredBilliards.state.residentDrawObjects !== 8 ||
      enteredBilliards.state.triangles <= 0 ||
      enteredBilliards.state.allocations !== 1 ||
      enteredBilliards.state.releases !== 0 ||
      !enteredBilliards.state.resourcesLinked ||
      !enteredBilliards.groupInScene ||
      enteredBilliards.reflectionExclusions !==
        initialBilliards.reflectionExclusions + 2 ||
      !finalBilliards.enabled ||
      !finalBilliards.initialized ||
      finalBilliards.loading ||
      !finalBilliards.visible ||
      finalBilliards.activeBalls !== 16 ||
      finalBilliards.pocketed !== 0 ||
      finalBilliards.shots !== 0 ||
      finalBilliards.fouls !== 0 ||
      finalBilliards.drawObjects !== enteredBilliards.state.drawObjects ||
      finalBilliards.residentDrawObjects !== 8 ||
      finalBilliards.triangles !== enteredBilliards.state.triangles ||
      finalBilliards.physicsBodies !== 22 ||
      finalBilliards.allocations !== 1 ||
      finalBilliards.releases !== 0 ||
      !finalBilliards.resourcesLinked ||
      finalBilliards.groupUuid !== enteredBilliards.state.groupUuid
    ) {
      failures.push(`${result.viewport.name}: beach billiards lifecycle failed`);
    }
    const billiardsInteraction = result.billiardsInteraction;
    if (
      !billiardsInteraction ||
      billiardsInteraction.focus.mode !== 'orbit' ||
      billiardsInteraction.focus.viewMode !==
        (result.viewport.mobile ? 'mobile' : 'desktop') ||
      distance3(
        billiardsInteraction.focus.position,
        billiardsInteraction.focus.expectedPosition,
      ) > 0.02 ||
      distance3(
        billiardsInteraction.focus.target,
        billiardsInteraction.focus.expectedTarget,
      ) > 0.02 ||
      !billiardsInteraction.focus.controlsEnabled ||
      !billiardsInteraction.focus.tweenComplete ||
      !billiardsInteraction.focus.tableVisible ||
      billiardsInteraction.focus.buttonLabel !== '俯视球桌' ||
      billiardsInteraction.focus.toast !== '已定位沙滩台球' ||
      !billiardsInteraction.shotAccepted ||
      billiardsInteraction.shot.shots !== 1 ||
      billiardsInteraction.pocket.state.pocketed !== 1 ||
      billiardsInteraction.pocket.score !== '1 / 15' ||
      billiardsInteraction.pocket.shots !== '1 杆' ||
      !billiardsInteraction.cameraCollision.collided ||
      !billiardsInteraction.cameraCollision.outside ||
      !billiardsInteraction.cameraCollision.names.includes(
        'beach-billiards-table',
      ) ||
      billiardsInteraction.cameraCollision.colliderCount < 21 ||
      billiardsInteraction.reset.state.pocketed !== 0 ||
      billiardsInteraction.reset.state.shots !== 0 ||
      billiardsInteraction.reset.score !== '0 / 15' ||
      billiardsInteraction.reset.shots !== '0 杆'
    ) {
      failures.push(
        `${result.viewport.name}: beach billiards interaction failed ${JSON.stringify(
          billiardsInteraction,
        )}`,
      );
    }
    const initialCelestial = result.celestialLifecycle?.initial;
    const expectedCelestialPayload = result.viewport.mobile ? 147_112 : 364_952;
    const expectedStarProfile = result.viewport.mobile
      ? { count: 480, floats: 1_440, bytes: 5_760 }
      : { count: 950, floats: 2_850, bytes: 11_400 };
    const expectedMoonProfile = result.viewport.mobile
      ? { pixels: 16_384, vertices: 247, triangles: 396 }
      : { pixels: 65_536, vertices: 609, triangles: 1_064 };
    const uninitializedCelestialPeriods = [
      dayState,
      dawnState,
      ...(result.viewport.mobile ? [] : [result.periodStates.sunset]),
    ];
    if (
      !initialCelestial ||
      initialCelestial.resources.initialized ||
      initialCelestial.resources.allocations !== 0 ||
      initialCelestial.resources.residentPayloadBytes !== 0 ||
      initialCelestial.resources.plannedPayloadBytes !== expectedCelestialPayload ||
      initialCelestial.resources.objectsInScene !== 0 ||
      initialCelestial.resources.linked ||
      initialCelestial.stars.initialized ||
      initialCelestial.stars.revision !== 0 ||
      initialCelestial.stars.count !== 0 ||
      initialCelestial.stars.positionBytes !== 0 ||
      initialCelestial.stars.profileCount !== expectedStarProfile.count ||
      initialCelestial.stars.profilePositionFloats !== expectedStarProfile.floats ||
      initialCelestial.stars.profilePositionBytes !== expectedStarProfile.bytes ||
      initialCelestial.stars.linked ||
      initialCelestial.moon.initialized ||
      initialCelestial.moon.revision !== 0 ||
      initialCelestial.moon.pixelCount !== 0 ||
      initialCelestial.moon.vertices !== 0 ||
      initialCelestial.moon.triangles !== 0 ||
      initialCelestial.moon.profilePixelCount !== expectedMoonProfile.pixels ||
      initialCelestial.moon.profileVertices !== expectedMoonProfile.vertices ||
      initialCelestial.moon.profileTriangles !== expectedMoonProfile.triangles ||
      initialCelestial.moon.linked ||
      Object.values(initialCelestial.sceneObjects).some(Boolean) ||
      uninitializedCelestialPeriods.some(
        (state) =>
          !state ||
          state.celestialResources.initialized ||
          state.celestialResources.allocations !== 0 ||
          state.celestialResources.residentPayloadBytes !== 0 ||
          state.celestialResources.objectsInScene !== 0 ||
          state.starQuality.initialized ||
          state.starQuality.count !== 0 ||
          state.moonQuality.initialized ||
          state.moonQuality.pixelCount !== 0,
      )
    ) {
      failures.push(`${result.viewport.name}: celestial resources were created before night`);
    }
    if (
      !dawnState ||
      dawnState.period !== 'dawn' ||
      dawnState.timeControl?.label !== '清晨' ||
      dawnState.timeControl?.active !== 'dawn' ||
      dawnState.weather.mode !== 'clear' ||
      dawnState.weather.fogDensity < dayState.weather.fogDensity * 2.4 ||
      dawnState.weather.sunIntensity >= dayState.weather.sunIntensity * 0.82 ||
      dawnState.weather.cloudOpacity <= dayState.weather.cloudOpacity + 0.08 ||
      dawnState.lighting.moonOpacity > 0.08 ||
      dawnState.starQuality.visible ||
      dayState.starQuality.visible ||
      dawnState.starQuality.opacity > 0.002 ||
      dayState.starQuality.opacity > 0.002 ||
      dawnState.lighting.starsVisible ||
      dawnState.lighting.moonVisible ||
      dawnState.lighting.moonHaloVisible ||
      dayState.lighting.starsVisible ||
      dayState.lighting.moonVisible ||
      dayState.lighting.moonHaloVisible ||
      dayState.lantern.active ||
      dayState.lantern.flickerActive ||
      dayState.lantern.lightVisible ||
      dayState.lantern.glowVisible ||
      dayState.lantern.haloVisible ||
      dayState.lantern.intensity !== 0 ||
      dayState.lantern.glowOpacity !== 0 ||
      dayState.lantern.haloOpacity !== 0 ||
      dayState.lantern.drawObjects !== 0 ||
      dayState.lantern.threshold !== 0.002 ||
      !dawnState.lantern.active ||
      !dawnState.lantern.flickerActive ||
      !dawnState.lantern.lightVisible ||
      !dawnState.lantern.glowVisible ||
      !dawnState.lantern.haloVisible ||
      dawnState.lantern.intensity <= 0 ||
      dawnState.lantern.glowOpacity <= 0.002 ||
      dawnState.lantern.haloOpacity <= 0 ||
      dawnState.lantern.drawObjects !== 2 ||
      dawnState.render.points !== 6 ||
      dayState.render.points !== 6 ||
      dawnState.lighting.sunColor === dayState.lighting.sunColor ||
      dawnState.lighting.fogColor === dayState.lighting.fogColor ||
      dawnState.water.horizonColor === dayState.water.horizonColor ||
      dawnState.render.calls - dayState.render.calls !==
        expectedLanternDrawSaving ||
      dawnState.render.triangles - dayState.render.triangles !==
        expectedLanternTriangleSaving ||
      dawnStats.standardDeviation < 12 ||
      dawnStats.colorBins < 24
    ) {
      failures.push(`${result.viewport.name}: dawn mist preset failed`);
    }
    const daylightCulling = result.daylightCulling;
    if (
      !daylightCulling ||
      daylightCulling.legacy.lantern.active ||
      !daylightCulling.legacy.lantern.lightVisible ||
      !daylightCulling.legacy.lantern.glowVisible ||
      !daylightCulling.legacy.lantern.haloVisible ||
      daylightCulling.legacy.lantern.intensity !== 0 ||
      daylightCulling.legacy.lantern.glowOpacity !== 0 ||
      daylightCulling.legacy.lantern.haloOpacity !== 0 ||
      daylightCulling.legacy.lantern.drawObjects !== 2 ||
      daylightCulling.culled.lantern.active ||
      daylightCulling.culled.lantern.flickerActive ||
      daylightCulling.culled.lantern.lightVisible ||
      daylightCulling.culled.lantern.glowVisible ||
      daylightCulling.culled.lantern.haloVisible ||
      daylightCulling.culled.lantern.drawObjects !== 0 ||
      daylightCulling.legacy.render.calls -
        daylightCulling.culled.render.calls !==
        expectedLanternDrawSaving ||
      daylightCulling.legacy.render.triangles -
        daylightCulling.culled.render.triangles !==
        expectedLanternTriangleSaving ||
      daylightCulling.legacy.render.points !==
        daylightCulling.culled.render.points ||
      daylightCulling.pixelDifference.changedRatio > 0.005 ||
      daylightCulling.pixelDifference.meanDifference > 0.2 ||
      daylightCulling.pixelDifference.maxDifference > 200
    ) {
      failures.push(
        `${result.viewport.name}: daylight lantern culling failed ${JSON.stringify({
          drawSaving:
            daylightCulling.legacy.render.calls -
            daylightCulling.culled.render.calls,
          triangleSaving:
            daylightCulling.legacy.render.triangles -
            daylightCulling.culled.render.triangles,
          pixelDifference: daylightCulling.pixelDifference,
        })}`,
      );
    }
    const weather = result.weatherTransition;
    if (
      !weather ||
      weather.clear.state.weather.mode !== 'clear' ||
      weather.clear.state.weather.coverage > 0.01 ||
      weather.clear.state.rain.enabled ||
      weather.clear.activeMode !== 'clear' ||
      weather.clear.output !== '晴朗' ||
      weather.cloudy.state.weather.mode !== 'cloudy' ||
      weather.cloudy.state.weather.coverage < 0.28 ||
      weather.cloudy.state.weather.cloudOpacity <=
        weather.clear.state.weather.cloudOpacity + 0.14 ||
      weather.cloudy.state.weather.sunIntensity >=
        weather.clear.state.weather.sunIntensity ||
      weather.cloudy.state.weather.fogDensity <=
        weather.clear.state.weather.fogDensity ||
      weather.cloudy.state.weather.sunGlintStrength >=
        weather.clear.state.weather.sunGlintStrength ||
      weather.cloudy.state.rain.enabled ||
      weather.cloudy.activeMode !== 'cloudy' ||
      weather.cloudy.output !== '多云' ||
      weather.overcast.state.weather.mode !== 'overcast' ||
      weather.overcast.state.weather.coverage <=
        weather.cloudy.state.weather.coverage + 0.2 ||
      weather.overcast.state.weather.sunIntensity >=
        weather.cloudy.state.weather.sunIntensity * 0.72 ||
      weather.overcast.state.weather.fogDensity <=
        weather.cloudy.state.weather.fogDensity * 1.2 ||
      weather.overcast.state.weather.exposure >=
        weather.cloudy.state.weather.exposure ||
      weather.overcast.state.weather.reflectionStrength >=
        weather.cloudy.state.weather.reflectionStrength ||
      weather.overcast.state.rain.enabled ||
      weather.overcast.activeMode !== 'overcast' ||
      weather.overcast.output !== '阴天' ||
      weather.overcast.state.render.calls !== weather.clear.state.render.calls ||
      weather.overcast.state.render.triangles !==
        weather.clear.state.render.triangles ||
      weather.restored.state.weather.mode !== 'clear' ||
      weather.restored.state.weather.coverage > 0.05 ||
      weather.restored.state.rain.enabled ||
      weather.restored.activeMode !== 'clear' ||
      weather.restored.output !== '晴朗'
    ) {
      failures.push(`${result.viewport.name}: independent weather presets failed`);
    }
    const wave = result.waveTransition;
    const fastAdvance = wave
      ? wave.fast.waterTime - wave.start.waterTime
      : 0;
    const slowAdvance = wave
      ? wave.slow.waterTime - wave.slowStart.waterTime
      : Infinity;
    const linkedSnapshots = wave
      ? [wave.start, wave.fast, wave.slowStart, wave.slow, wave.restored].every(
          (snapshot) =>
            snapshot.foam.linkedToWater &&
            snapshot.foam.shaderLinked &&
            Math.abs(snapshot.foam.wavePhase - snapshot.waterTime) < 0.006 &&
            Math.abs(snapshot.foamUniform - snapshot.waterTime) < 0.0001,
        )
      : false;
    if (
      !wave ||
      !linkedSnapshots ||
      wave.start.foam.waveSpeed !== 0.55 ||
      wave.fast.foam.waveSpeed !== 1.2 ||
      wave.fast.input !== 1.2 ||
      wave.fast.output !== '1.20' ||
      wave.slow.foam.waveSpeed !== 0.2 ||
      wave.slow.input !== 0.2 ||
      wave.slow.output !== '0.20' ||
      wave.restored.foam.waveSpeed !== 0.55 ||
      wave.restored.input !== 0.55 ||
      wave.restored.output !== '0.55' ||
      fastAdvance < 0.68 ||
      slowAdvance <= 0.08 ||
      fastAdvance < slowAdvance * 4
    ) {
      failures.push(`${result.viewport.name}: wave-linked shoreline foam failed`);
    }
    const swell = result.oceanSwellTransition;
    if (!swell) {
      failures.push(`${result.viewport.name}: distant ocean swell result missing`);
    } else {
      const swellChecks = [
        ['off state', swell.off.state.oceanSwell.strength === 0],
        ['off control', swell.off.input === 0 && swell.off.output === '0.00'],
        ['off uniform', swell.off.uniform === 0],
        ['strong state', swell.strong.state.oceanSwell.strength === 1],
        ['strong control', swell.strong.input === 1 && swell.strong.output === '1.00'],
        ['strong uniform', swell.strong.uniform === 1],
        ['restored state', swell.restored.state.oceanSwell.strength === 0.42],
        ['restored control', swell.restored.input === 0.42 && swell.restored.output === '0.42'],
        ['restored uniform', swell.restored.uniform === 0.42],
        ['shader link', swell.restored.state.oceanSwell.shaderLinked],
        ['time source', swell.restored.state.oceanSwell.timeSource === 'water'],
        ['distance fade', swell.restored.state.oceanSwell.fadeStartZ === -55 && swell.restored.state.oceanSwell.fadeEndZ === 4],
        ['texture budget', swell.restored.state.oceanSwell.textureSamplesAdded === 0],
        ['frozen water time', swell.off.state.waterTime === swell.strong.state.waterTime],
        ['draw-call budget', swell.off.state.render.calls === swell.strong.state.render.calls],
        ['triangle budget', swell.off.state.render.triangles === swell.strong.state.render.triangles],
        ['changed pixels', swell.pixelDifference.changedRatio >= 0.008],
        ['mean pixel difference', swell.pixelDifference.meanDifference >= 0.35],
        ['peak pixel difference', swell.pixelDifference.maxDifference >= 12],
      ];
      const failedSwellChecks = swellChecks.filter(([, passed]) => !passed).map(([name]) => name);
      if (failedSwellChecks.length) console.log('SWELL_DIAGNOSTIC', result.viewport.name, swell.pixelDifference);
      if (failedSwellChecks.length > 0) {
        failures.push(`${result.viewport.name}: distant ocean swell failed (${failedSwellChecks.join(', ')})`);
      }
    }
    const wind = result.windTransition;
    if (!wind) {
      failures.push(`${result.viewport.name}: coastal wind result missing`);
    } else {
      const expectedGrassStrength = result.viewport.mobile ? 1.24 : 2;
      const palmMatrixDifference = wind.calm.palmMatrix.reduce(
        (total, value, index) =>
          total + Math.abs(value - wind.strong.palmMatrix[index]),
        0,
      );
      const windChecks = [
        ['calm state', wind.calm.state.wind.targetStrength === 0 && wind.calm.state.wind.factor === 0],
        ['calm control', wind.calm.input === 0 && wind.calm.output === '0.00'],
        ['calm phase frozen', wind.calm.state.wind.phase === wind.calm.phaseBefore],
        ['calm cloud phase', Math.abs(wind.calm.cloudTime - wind.calm.state.wind.phase) < 0.001],
        ['calm cloud rotation', Math.abs(wind.calm.cloudRotation - wind.calm.cloudRotationBefore) < 0.000001],
        ['calm grass', wind.calm.grassStrength === 0 && Math.abs(wind.calm.grassTime - wind.calm.state.wind.phase) < 0.001],
        ['calm rain', wind.calm.state.rain.windFactor === 0 && Math.abs(wind.calm.rainLeanX) < 0.000001 && Math.abs(wind.calm.rainLeanZ) < 0.000001],
        ['strong state', wind.strong.state.wind.targetStrength === 1.2 && wind.strong.state.wind.factor === 2],
        ['strong control', wind.strong.input === 1.2 && wind.strong.output === '1.20'],
        ['strong phase', Math.abs(wind.strong.state.wind.phase - wind.strong.phaseBefore - 1) < 0.001],
        ['strong cloud phase', Math.abs(wind.strong.cloudTime - wind.strong.state.wind.phase) < 0.001],
        ['strong cloud rotation', Math.abs(wind.strong.cloudRotation - wind.strong.cloudRotationBefore - 0.00025) < 0.000001],
        ['strong grass', Math.abs(wind.strong.grassStrength - expectedGrassStrength) < 0.001 && Math.abs(wind.strong.grassTime - wind.strong.state.wind.phase) < 0.001],
        ['strong palms', palmMatrixDifference > 0.001],
        ['strong rain', wind.strong.state.rain.windFactor === 2 && wind.strong.rainLeanX > 0.04 && Math.abs(wind.strong.rainLeanZ) > 0.01],
        ['draw-call budget', wind.calm.state.render.calls === wind.strong.state.render.calls],
        ['triangle budget', wind.calm.state.render.triangles === wind.strong.state.render.triangles],
        ['restored state', wind.restored.state.wind.targetStrength === 0.6 && wind.restored.state.wind.factor === 1],
        ['restored control', wind.restored.input === 0.6 && wind.restored.output === '0.60'],
        ['restored rain', !wind.restored.state.rain.enabled && !wind.restored.rainChecked],
      ];
      const failedWindChecks = windChecks
        .filter(([, passed]) => !passed)
        .map(([name]) => name);
      if (failedWindChecks.length > 0) {
        failures.push(`${result.viewport.name}: unified coastal wind failed (${failedWindChecks.join(', ')})`);
      }
    }
    const bloom = result.bloomTransition;
    if (!bloom) {
      failures.push(`${result.viewport.name}: bloom transition result missing`);
    } else {
      const expectedBloom = result.viewport.mobile
        ? { quality: 'low', strength: 0.22, radius: 0.16, threshold: 0.9 }
        : { quality: 'high', strength: 0.32, radius: 0.22, threshold: 0.84 };
      const expectedNightPayload = result.viewport.mobile ? 147_112 : 364_952;
      const bloomChecks = [
        ['default disabled', !bloom.off.state.bloom.enabled && !bloom.off.checked],
        ['default lazy', !bloom.off.state.bloom.initialized && !bloom.off.state.bloom.lazyLoaded],
        ['zero default module requests', bloom.moduleRequests.beforeEnable === 0],
        ['enabled control', bloom.on.state.bloom.enabled && bloom.on.checked],
        ['initialized chain', bloom.on.state.bloom.initialized && bloom.on.state.bloom.passes === 3],
        ['lazy module requests', bloom.moduleRequests.afterEnable >= 4],
        ['quality profile', bloom.on.state.bloom.quality === expectedBloom.quality],
        ['strength profile', bloom.on.state.bloom.strength === expectedBloom.strength],
        ['radius profile', bloom.on.state.bloom.radius === expectedBloom.radius],
        ['threshold profile', bloom.on.state.bloom.threshold === expectedBloom.threshold],
        ['load success', bloom.on.state.bloom.lazyLoaded && !bloom.on.state.bloom.lastError],
        ['frozen water time', bloom.off.state.waterTime === bloom.on.state.waterTime],
        ['post-process calls', bloom.on.state.render.calls > bloom.off.state.render.calls],
        ['post-process triangles', bloom.on.state.render.triangles > bloom.off.state.render.triangles],
        ['scene points stable', bloom.on.state.render.points === bloom.off.state.render.points],
        ['disabled restore', !bloom.restored.state.bloom.enabled && !bloom.restored.checked],
        ['reusable after disable', bloom.restored.state.bloom.initialized],
        ['no duplicate module requests', bloom.moduleRequests.afterDisable === bloom.moduleRequests.afterEnable],
        ['direct calls restored', bloom.restored.state.render.calls === bloom.off.state.render.calls],
        ['direct triangles restored', bloom.restored.state.render.triangles === bloom.off.state.render.triangles],
        [
          'changed pixels',
          // Live cloud cover changes the sky area that passes the bloom threshold.
          // Retain a nontrivial footprint plus independent mean/peak checks.
          bloom.pixelDifference.changedRatio >= (result.viewport.mobile ? 0.05 : 0.1),
        ],
        ['mean pixel difference', bloom.pixelDifference.meanDifference >= 0.5],
        ['peak pixel difference', bloom.pixelDifference.maxDifference >= 20],
        [
          'night celestial allocation',
          bloom.off.state.celestialResources.initialized &&
            bloom.off.state.celestialResources.allocations === 1 &&
            bloom.off.state.celestialResources.residentPayloadBytes ===
              expectedNightPayload &&
            bloom.off.state.celestialResources.objectsInScene === 3 &&
            bloom.off.state.celestialResources.linked,
        ],
        [
          'night celestial reuse',
          bloom.on.state.celestialResources.allocations === 1 &&
            bloom.restored.state.celestialResources.allocations === 1 &&
            bloom.on.state.celestialResources.residentPayloadBytes ===
              expectedNightPayload &&
            bloom.restored.state.celestialResources.residentPayloadBytes ===
              expectedNightPayload,
        ],
      ];
      const failedBloomChecks = bloomChecks.filter(([, passed]) => !passed).map(([name]) => name);
      if (failedBloomChecks.length > 0) {
        failures.push(`${result.viewport.name}: optional bloom failed (${failedBloomChecks.join(', ')})`);
      }
    }
    const rain = result.rainTransition;
    const expectedDrops = result.viewport.mobile ? 520 : 1100;
    const expectedResidentBytes = result.viewport.mobile ? 87_360 : 184_800;
    const expectedGpuAttributeBytes = result.viewport.mobile ? 74_880 : 158_400;
    if (
      !rain ||
      rain.initial.state.enabled ||
      rain.initial.state.initialized ||
      rain.initial.state.allocations !== 0 ||
      rain.initial.state.releases !== 0 ||
      rain.initial.state.residentBytes !== 0 ||
      rain.initial.state.gpuAttributeBytes !== 0 ||
      rain.initial.state.plannedResidentBytes !== expectedResidentBytes ||
      rain.initial.linePresent ||
      rain.initial.sceneLinePresent ||
      rain.before.rain.enabled ||
      !rain.before.rain.initialized ||
      rain.before.rain.allocations !== 1 ||
      rain.before.rain.releases !== 0 ||
      rain.before.rain.residentBytes !== expectedResidentBytes ||
      rain.before.reflectionExclusions !==
        rain.initial.reflectionExclusions + 3 ||
      !rain.on.state.rain.enabled ||
      !rain.on.state.rain.visible ||
      !rain.on.state.rain.initialized ||
      !rain.on.state.rain.resourcesLinked ||
      rain.on.state.rain.allocations !== 1 ||
      rain.on.state.rain.releases !== 0 ||
      rain.on.state.rain.residentBytes !== expectedResidentBytes ||
      rain.on.state.rain.gpuAttributeBytes !== expectedGpuAttributeBytes ||
      rain.on.state.rain.drops !== expectedDrops ||
      rain.on.state.rain.drawObjects !== 1 ||
      rain.on.state.rain.segmentsPerDrop !== 3 ||
      rain.on.state.rain.splashCapacity !== expectedDrops * 2 ||
      rain.on.state.rain.activeSplashes <= 0 ||
      rain.on.state.rain.impacts <= 0 ||
      rain.on.positionCount !== expectedDrops * 6 ||
      rain.on.state.rain.updates <= rain.before.rain.updates ||
      rain.on.state.render.calls < rain.before.render.calls + 1 ||
      rain.on.lineUuid !== rain.before.lineUuid ||
      rain.on.reflectionExclusions !== rain.before.reflectionExclusions ||
      !rain.on.checked ||
      rain.off.state.rain.enabled ||
      rain.off.state.rain.visible ||
      !rain.off.state.rain.initialized ||
      rain.off.state.rain.allocations !== 1 ||
      rain.off.state.rain.residentBytes !== expectedResidentBytes ||
      rain.off.state.rain.activeSplashes !== 0 ||
      rain.off.lineUuid !== rain.on.lineUuid ||
      rain.off.checked ||
      !rain.reused.state.rain.enabled ||
      !rain.reused.state.rain.visible ||
      rain.reused.state.rain.allocations !== 1 ||
      rain.reused.lineUuid !== rain.on.lineUuid ||
      !rain.reused.checked ||
      rain.restored.state.rain.enabled ||
      rain.restored.state.rain.visible ||
      !rain.restored.state.rain.initialized ||
      rain.restored.state.rain.allocations !== 1 ||
      rain.restored.lineUuid !== rain.on.lineUuid ||
      rain.restored.checked
    ) {
      failures.push(`${result.viewport.name}: independent rain system failed`);
    }
    if (
      !result.viewport.mobile &&
      (!result.qualityTransition ||
        !result.qualityTransition.before.rain.initialized ||
        result.qualityTransition.before.rain.allocations !== 1 ||
        result.qualityTransition.low.rain.initialized ||
        result.qualityTransition.low.rain.quality !== 'low' ||
        result.qualityTransition.low.rain.releases !== 1 ||
        result.qualityTransition.low.rain.residentBytes !== 0 ||
        result.qualityTransition.high.rain.initialized ||
        result.qualityTransition.high.rain.quality !== 'high' ||
        result.qualityTransition.high.rain.allocations !== 1 ||
        result.qualityTransition.high.rain.releases !== 1 ||
        result.qualityTransition.high.rain.residentBytes !== 0)
    ) {
      failures.push(`${result.viewport.name}: disabled rain quality lifecycle failed`);
    }
    const footsteps = result.footstepAudioTransition;
    if (
      !footsteps ||
      footsteps.before.state.enabled ||
      footsteps.before.state.initialized ||
      footsteps.before.state.contextState !== 'not-created' ||
      footsteps.before.checked ||
      !footsteps.on.state.enabled ||
      !footsteps.on.state.initialized ||
      footsteps.on.state.contextState !== 'running' ||
      footsteps.on.state.steps !== 2 ||
      footsteps.on.state.sandSteps !== 1 ||
      footsteps.on.state.woodSteps !== 1 ||
      footsteps.on.state.lastSurface !== 'wood' ||
      footsteps.on.sandSurface !== 'sand' ||
      footsteps.on.woodSurface !== 'wood' ||
      !footsteps.on.checked ||
      footsteps.off.state.enabled ||
      !footsteps.off.state.initialized ||
      footsteps.off.state.steps !== 2 ||
      footsteps.off.checked
    ) {
      failures.push(`${result.viewport.name}: optional surface footstep audio failed`);
    }
    const bookmarks = result.bookmarkTransition;
    const savedBookmark = bookmarks?.saved?.state?.cameraBookmarks?.slots?.[0];
    const restoredCamera = bookmarks?.restored?.state?.camera;
    if (
      !bookmarks ||
      bookmarks.before.state.savedCount !== 0 ||
      !bookmarks.before.state.storageAvailable ||
      bookmarks.before.output !== '槽位 1 · 空' ||
      !bookmarks.before.restoreDisabled ||
      !bookmarks.before.deleteDisabled ||
      bookmarks.before.stored !== null ||
      bookmarks.saved.state.cameraBookmarks.savedCount !== 1 ||
      !savedBookmark?.saved ||
      bookmarks.saved.stored?.version !== 1 ||
      bookmarks.saved.stored?.slots?.length !== 1 ||
      bookmarks.saved.stored?.slots?.[0]?.slot !== 1 ||
      bookmarks.saved.output !== '槽位 1 · 已保存' ||
      bookmarks.saved.restoreDisabled ||
      bookmarks.saved.deleteDisabled ||
      bookmarks.saved.saveLabel !== '覆盖当前构图' ||
      distance3(bookmarks.moved.position, savedBookmark.position) < 10 ||
      restoredCamera?.mode !== 'orbit' ||
      distance3(restoredCamera?.position, savedBookmark.position) > 0.03 ||
      distance3(restoredCamera?.target, savedBookmark.target) > 0.03 ||
      !bookmarks.restored.settingsHidden ||
      bookmarks.restored.state.period !== bookmarks.saved.state.period ||
      bookmarks.restored.state.weather.mode !== bookmarks.saved.state.weather.mode ||
      bookmarks.restored.state.tide.mode !== bookmarks.saved.state.tide.mode ||
      bookmarks.restored.state.render.calls !== bookmarks.saved.state.render.calls ||
      bookmarks.restored.state.render.triangles !==
        bookmarks.saved.state.render.triangles ||
      bookmarks.emptySlot.output !== '槽位 2 · 空' ||
      bookmarks.emptySlot.active !== '2' ||
      !bookmarks.emptySlot.restoreDisabled ||
      !bookmarks.emptySlot.deleteDisabled ||
      bookmarks.deleted.state.savedCount !== 0 ||
      bookmarks.deleted.output !== '槽位 1 · 空' ||
      !bookmarks.deleted.restoreDisabled ||
      !bookmarks.deleted.deleteDisabled ||
      bookmarks.deleted.stored?.version !== 1 ||
      bookmarks.deleted.stored?.slots?.length !== 0
    ) {
      failures.push(`${result.viewport.name}: persistent camera bookmarks failed`);
    }
    const imported = result.assetImport;
    if (
      !imported?.texture.state.loaded ||
      imported.texture.state.kind !== 'texture' ||
      imported.texture.state.meshes !== 2 ||
      imported.texture.state.dimensions?.join('x') !== '64x32' ||
      imported.texture.state.transform?.x !== 2 ||
      imported.texture.state.transform?.z !== 25 ||
      imported.texture.transformHidden ||
      !imported.texture.output?.startsWith('贴图 · ') ||
      imported.texture.removeDisabled ||
      !imported.gltf.state.loaded ||
      imported.gltf.state.kind !== 'model' ||
      imported.gltf.state.meshes !== 1 ||
      imported.gltf.state.triangles !== 1 ||
      imported.gltf.state.animations !== 2 ||
      !imported.gltf.state.transform ||
      !imported.gltf.output?.includes('visual-check.gltf') ||
      imported.gltf.removeDisabled ||
      !imported.glb.state.loaded ||
      imported.glb.state.kind !== 'model' ||
      imported.glb.state.meshes !== 1 ||
      imported.glb.state.triangles !== 1 ||
      imported.glb.state.animation !== null ||
      !imported.glb.state.transform ||
      !imported.glb.output?.includes('visual-check.glb') ||
      imported.glb.removeDisabled ||
      !imported.glb.animationHidden ||
      imported.glb.transformHidden ||
      imported.removed.state.loaded ||
      imported.removed.state.transform !== null ||
      imported.removed.output !== '未导入' ||
      !imported.removed.removeDisabled ||
      !imported.removed.animationHidden ||
      !imported.removed.transformHidden
    ) {
      failures.push(`${result.viewport.name}: local texture/model import workflow failed`);
    }
    const texturePlacement = imported?.textureTransform;
    const textureMoved = texturePlacement?.transformed;
    const textureReset = texturePlacement?.reset?.state?.transform;
    const modelPlacement = imported?.modelTransform;
    const modelBefore = modelPlacement?.before;
    const modelAfter = modelPlacement?.after;
    const modelAnimationDelta = modelBefore && modelAfter
      ? (modelAfter.animation.time - modelBefore.state.animation.time + 1) % 1
      : 0;
    if (
      textureMoved?.state?.transform?.x !== -12.5 ||
      textureMoved?.state?.transform?.z !== 33 ||
      textureMoved?.state?.transform?.rotation !== 45 ||
      textureMoved?.state?.transform?.scale !== 1.4 ||
      Math.abs(textureMoved.rootPosition?.[0] + 12.5) > 0.001 ||
      Math.abs(textureMoved.rootPosition?.[1] - textureMoved.state.transform.y) > 0.001 ||
      Math.abs(textureMoved.rootPosition?.[2] - 33) > 0.001 ||
      Math.abs(textureMoved.rootScale - 1.4) > 0.001 ||
      textureMoved.outputs?.x !== '-12.5' ||
      textureMoved.outputs?.z !== '33.0' ||
      textureMoved.outputs?.rotation !== '45°' ||
      textureMoved.outputs?.scale !== '1.40×' ||
      textureReset?.x !== 2 ||
      textureReset?.z !== 25 ||
      textureReset?.rotation !== 0 ||
      textureReset?.scale !== 1 ||
      texturePlacement?.reset?.transformHidden ||
      modelBefore?.state?.transform?.x !== 9 ||
      modelBefore?.state?.transform?.z !== 29 ||
      modelBefore?.state?.transform?.rotation !== -30 ||
      modelBefore?.state?.transform?.scale !== 0.75 ||
      Math.abs(modelBefore.rootPosition?.[0] - 9) > 0.001 ||
      Math.abs(modelBefore.rootPosition?.[2] - 29) > 0.001 ||
      Math.abs(modelBefore.rootScale - 0.75) > 0.001
    ) {
      failures.push(`${result.viewport.name}: imported asset placement controls failed`);
    }
    const animation = imported?.animation;
    if (
      !animation ||
      animation.initial.hidden ||
      animation.initial.state.animation?.clips?.length !== 2 ||
      animation.initial.state.animation.activeIndex !== 0 ||
      !animation.initial.state.animation.playing ||
      animation.initial.options?.join('|') !== '潮风摇摆|回望岸线' ||
      animation.initial.output !== '播放中' ||
      animation.initial.toggleLabel !== '暂停动画' ||
      modelAnimationDelta < 0.08 ||
      animation.switched.activeIndex !== 1 ||
      animation.switched.activeName !== '回望岸线' ||
      !animation.switched.playing ||
      animation.paused.playing ||
      Math.abs(animation.pausedLater.time - animation.paused.time) > 0.02 ||
      animation.speed.speed !== 1.75 ||
      animation.speed.playing ||
      !animation.resumed.playing ||
      animation.resumed.speed !== 1.75 ||
      Math.abs(animation.resumed.time - animation.pausedLater.time) < 0.1 ||
      animation.restarted.time > 0.12
    ) {
      failures.push(`${result.viewport.name}: imported animation controls failed`);
    }
    const tide = result.tideTransition;
    const shorelineTravel = tide
      ? tide.high.state.shoreline - tide.low.state.shoreline
      : 0;
    const foamTravel = tide ? tide.high.foamZ - tide.low.foamZ : 0;
    const sandTravel = tide
      ? tide.high.sandShoreline - tide.low.sandShoreline
      : 0;
    const boundaryTravel = tide
      ? tide.high.walkBoundary - tide.low.walkBoundary
      : 0;
    const waterTravel = tide ? tide.high.waterY - tide.low.waterY : 0;
    if (
      !tide ||
      tide.low.state.mode !== 'low' ||
      tide.low.state.band !== 'low' ||
      tide.high.state.mode !== 'high' ||
      tide.high.state.band !== 'high' ||
      tide.automatic.state.mode !== 'auto' ||
      shorelineTravel < 6.3 ||
      Math.abs(foamTravel) > 0.0001 ||
      [tide.low, tide.high, tide.automatic].some(t => Math.abs(t.foamWaterHeight - t.waterY) > 0.0001 || Math.abs(t.sandWaterHeight - t.waterY) > 0.0001) ||
      sandTravel < 6.3 ||
      boundaryTravel < 6.3 ||
      waterTravel < 0.31 ||
      tide.low.output !== '退潮 · 低潮' ||
      tide.high.output !== '涨潮 · 高潮' ||
      !tide.automatic.output?.startsWith('自动 · ') ||
      tide.automatic.activeMode !== 'auto'
    ) {
      failures.push(`${result.viewport.name}: synchronized tide system failed`);
    }
    if (
      result.canvasStats.standardDeviation < 8 ||
      result.canvasStats.range < 40 ||
      result.canvasStats.colorBins < 24
    ) {
      failures.push(`${result.viewport.name}: canvas appears blank or flat`);
    }
    if (result.debugState.render.calls < 5 || result.debugState.render.triangles < 500) {
      failures.push(`${result.viewport.name}: scene render count is unexpectedly low`);
    }
    const renderBudget = result.viewport.mobile
      ? RENDER_BUDGETS.mobile
      : RENDER_BUDGETS.desktop;
    if (
      result.debugState.render.calls > renderBudget.calls ||
      result.debugState.render.triangles > renderBudget.triangles
    ) {
      failures.push(`${result.viewport.name}: scene exceeded its render budget`);
    }
    const cloudQuality = result.debugState.cloudQuality;
    const expectedCloud = result.viewport.mobile
      ? {
          quality: 'low',
          textureWidth: 256,
          textureHeight: 128,
          densityBytes: 131072,
          widthSegments: 28,
          heightSegments: 14,
          triangles: 728,
          revision: 1,
          replacements: 0,
        }
      : {
          quality: 'high',
          textureWidth: 512,
          textureHeight: 256,
          densityBytes: 524288,
          widthSegments: 48,
          heightSegments: 24,
          triangles: 2208,
          revision: 3,
          replacements: 2,
        };
    if (
      !cloudQuality ||
      cloudQuality.quality !== expectedCloud.quality ||
      cloudQuality.textureWidth !== expectedCloud.textureWidth ||
      cloudQuality.textureHeight !== expectedCloud.textureHeight ||
      cloudQuality.densityBytes !== expectedCloud.densityBytes ||
      cloudQuality.widthSegments !== expectedCloud.widthSegments ||
      cloudQuality.heightSegments !== expectedCloud.heightSegments ||
      cloudQuality.triangles !== expectedCloud.triangles ||
      cloudQuality.revision !== expectedCloud.revision ||
      cloudQuality.replacements !== expectedCloud.replacements ||
      cloudQuality.disposedLayers !== expectedCloud.replacements ||
      !cloudQuality.shaderLinked
    ) {
      failures.push(`${result.viewport.name}: cloud quality profile is incomplete`);
    }
    const waterReflection = result.debugState.waterReflection;
    const expectedReflection = result.viewport.mobile
      ? { quality: 'low', size: 256, pixels: 65536, revision: 1, resizes: 0 }
      : { quality: 'high', size: 1024, pixels: 1048576, revision: 3, resizes: 2 };
    if (
      !waterReflection ||
      waterReflection.quality !== expectedReflection.quality ||
      waterReflection.width !== expectedReflection.size ||
      waterReflection.height !== expectedReflection.size ||
      waterReflection.pixelCount !== expectedReflection.pixels ||
      waterReflection.profilePixelCount !== expectedReflection.pixels ||
      waterReflection.revision !== expectedReflection.revision ||
      waterReflection.resizes !== expectedReflection.resizes ||
      !waterReflection.captured ||
      !waterReflection.linked ||
      !waterReflection.waterUuid ||
      !waterReflection.textureUuid
    ) {
      failures.push(`${result.viewport.name}: Water reflection quality is incomplete`);
    }
    const waterNormal = result.debugState.waterNormal;
    const expectedNormal = result.viewport.mobile
      ? {
          quality: 'low',
          size: 256,
          pixels: 65536,
          anisotropy: 4,
          revision: 1,
          replacements: 0,
        }
      : {
          quality: 'high',
          size: 512,
          pixels: 262144,
          anisotropy: 8,
          revision: 3,
          replacements: 2,
        };
    if (
      !waterNormal ||
      waterNormal.quality !== expectedNormal.quality ||
      waterNormal.width !== expectedNormal.size ||
      waterNormal.height !== expectedNormal.size ||
      waterNormal.pixelCount !== expectedNormal.pixels ||
      waterNormal.profilePixelCount !== expectedNormal.pixels ||
      waterNormal.anisotropy !== expectedNormal.anisotropy ||
      waterNormal.revision !== expectedNormal.revision ||
      waterNormal.replacements !== expectedNormal.replacements ||
      waterNormal.disposedTextures !== expectedNormal.replacements ||
      waterNormal.sourceKind !== 'image' ||
      waterNormal.sourceWidth !== 1024 ||
      waterNormal.sourceHeight !== 1024 ||
      !waterNormal.sourceUuid ||
      !waterNormal.textureUuid ||
      !waterNormal.linked
    ) {
      failures.push(`${result.viewport.name}: Water normal quality is incomplete`);
    }
    const celestialResources = result.debugState.celestialResources;
    const expectedCelestial = result.viewport.mobile
      ? {
          initialized: true,
          allocations: 1,
          quality: 'low',
          resident: 147_112,
          planned: 147_112,
          objects: 3,
          linked: true,
        }
      : {
          initialized: true,
          allocations: 1,
          quality: 'high',
          resident: 364_952,
          planned: 364_952,
          objects: 3,
          linked: true,
        };
    if (
      !celestialResources ||
      celestialResources.initialized !== expectedCelestial.initialized ||
      celestialResources.allocations !== expectedCelestial.allocations ||
      celestialResources.quality !== expectedCelestial.quality ||
      celestialResources.residentPayloadBytes !== expectedCelestial.resident ||
      celestialResources.plannedPayloadBytes !== expectedCelestial.planned ||
      celestialResources.objectsInScene !== expectedCelestial.objects ||
      celestialResources.linked !== expectedCelestial.linked
    ) {
      failures.push(`${result.viewport.name}: celestial resource lifecycle is incomplete`);
    }
    const moonQuality = result.debugState.moonQuality;
    const expectedMoon = result.viewport.mobile
      ? {
          initialized: true,
          quality: 'low',
          size: 128,
          pixels: 16384,
          profilePixels: 16384,
          craters: 23,
          widthSegments: 18,
          heightSegments: 12,
          vertices: 247,
          profileVertices: 247,
          triangles: 396,
          profileTriangles: 396,
          revision: 1,
          replacements: 0,
          texture: true,
          linked: true,
        }
      : {
          initialized: true,
          quality: 'high',
          size: 256,
          pixels: 65536,
          profilePixels: 65536,
          craters: 46,
          widthSegments: 28,
          heightSegments: 20,
          vertices: 609,
          profileVertices: 609,
          triangles: 1064,
          profileTriangles: 1064,
          revision: 3,
          replacements: 2,
          texture: true,
          linked: true,
        };
    if (
      !moonQuality ||
      moonQuality.initialized !== expectedMoon.initialized ||
      moonQuality.quality !== expectedMoon.quality ||
      moonQuality.width !== expectedMoon.size ||
      moonQuality.height !== expectedMoon.size ||
      moonQuality.pixelCount !== expectedMoon.pixels ||
      moonQuality.profilePixelCount !== expectedMoon.profilePixels ||
      moonQuality.craterCount !== expectedMoon.craters ||
      moonQuality.widthSegments !== expectedMoon.widthSegments ||
      moonQuality.heightSegments !== expectedMoon.heightSegments ||
      moonQuality.vertices !== expectedMoon.vertices ||
      moonQuality.profileVertices !== expectedMoon.profileVertices ||
      moonQuality.triangles !== expectedMoon.triangles ||
      moonQuality.profileTriangles !== expectedMoon.profileTriangles ||
      moonQuality.revision !== expectedMoon.revision ||
      moonQuality.replacements !== expectedMoon.replacements ||
      moonQuality.disposedTextures !== expectedMoon.replacements ||
      moonQuality.disposedGeometries !== expectedMoon.replacements ||
      Boolean(moonQuality.textureUuid) !== expectedMoon.texture ||
      !moonQuality.geometryUuid ||
      !moonQuality.materialUuid ||
      !moonQuality.moonUuid ||
      moonQuality.linked !== expectedMoon.linked
    ) {
      failures.push(`${result.viewport.name}: Moon texture quality is incomplete`);
    }
    const starQuality = result.debugState.starQuality;
    const expectedStars = result.viewport.mobile
      ? {
          initialized: true,
          quality: 'low',
          count: 480,
          profileCount: 480,
          floats: 1440,
          profileFloats: 1440,
          bytes: 5760,
          profileBytes: 5760,
          revision: 1,
          replacements: 0,
          visible: false,
          opacity: 0,
          linked: true,
        }
      : {
          initialized: true,
          quality: 'high',
          count: 950,
          profileCount: 950,
          floats: 2850,
          profileFloats: 2850,
          bytes: 11400,
          profileBytes: 11400,
          revision: 3,
          replacements: 2,
          visible: true,
          opacity: 0.88,
          linked: true,
        };
    if (
      !starQuality ||
      starQuality.initialized !== expectedStars.initialized ||
      starQuality.quality !== expectedStars.quality ||
      starQuality.count !== expectedStars.count ||
      starQuality.profileCount !== expectedStars.profileCount ||
      starQuality.positionFloats !== expectedStars.floats ||
      starQuality.profilePositionFloats !== expectedStars.profileFloats ||
      starQuality.positionBytes !== expectedStars.bytes ||
      starQuality.profilePositionBytes !== expectedStars.profileBytes ||
      starQuality.revision !== expectedStars.revision ||
      starQuality.replacements !== expectedStars.replacements ||
      starQuality.disposedGeometries !== expectedStars.replacements ||
      starQuality.visible !== expectedStars.visible ||
      Math.abs(starQuality.opacity - expectedStars.opacity) > 0.002 ||
      !starQuality.geometryUuid ||
      !starQuality.materialUuid ||
      !starQuality.pointsUuid ||
      starQuality.linked !== expectedStars.linked
    ) {
      failures.push(`${result.viewport.name}: Star quality is incomplete`);
    }
    if (
      result.environmentDispose?.normalTextureDisposals !== 1 ||
      result.environmentDispose?.normalSourceDisposals !== 1 ||
      !result.environmentDispose?.normalTextureCleared ||
      !result.environmentDispose?.normalSourceCleared ||
      result.environmentDispose?.moonTextureDisposals !== 1 ||
      !result.environmentDispose?.moonTextureCleared ||
      result.environmentDispose?.haloTextureDisposals !== 1 ||
      !result.environmentDispose?.haloTextureCleared ||
      result.environmentDispose?.moonGeometryDisposals !== 1 ||
      !result.environmentDispose?.moonGeometryCleared ||
      result.environmentDispose?.starGeometryDisposals !== 1 ||
      !result.environmentDispose?.starGeometryCleared ||
      result.environmentDispose?.targetDisposals !== 1 ||
      !result.environmentDispose?.targetCleared ||
      result.environmentDispose?.celestialInitialized ||
      !result.environmentDispose?.celestialObjectsDetached ||
      result.environmentDispose?.discoveryInstanceDisposals !== 1 ||
      result.environmentDispose?.discoveryGlassGeometryDisposals !== 1 ||
      result.environmentDispose?.discoveryGlassMaterialDisposals !== 1 ||
      result.environmentDispose?.discoveryGlowGeometryDisposals !== 1 ||
      result.environmentDispose?.discoveryGlowMaterialDisposals !== 1 ||
      !result.environmentDispose?.discoveryReleased ||
      !result.environmentDispose?.discoveryResourcesCleared ||
      !result.environmentDispose?.discoveryGroupDetached ||
      result.environmentDispose?.billiardsResourceCount !== 12 ||
      !result.environmentDispose?.billiardsResourcesDisposed ||
      !result.environmentDispose?.billiardsReleased ||
      !result.environmentDispose?.billiardsGroupDetached
    ) {
      failures.push(`${result.viewport.name}: environment resources were not disposed`);
    }
    const pipeline = result.debugState.materialPipeline;
    if (
      !pipeline.sandShaderCompiled ||
      !pipeline.shallowWaterShader ||
      !pipeline.layeredWaterShader ||
      pipeline.beachWidth < 260 ||
      pipeline.foamWidth < 250 ||
      !pipeline.contactOcclusion ||
      !pipeline.moonTexture ||
      !pipeline.cloudShader ||
      pipeline.frondBatches !== 1 ||
      pipeline.frondInstances !== 55 ||
      pipeline.trunkBatches !== 1 ||
      pipeline.trunkInstances !== 40 ||
      pipeline.coconutBatches !== 1 ||
      pipeline.coconutInstances !== 20 ||
      !pipeline.grassShaderCompiled ||
      pipeline.grassInstances !== (result.viewport.mobile ? 200 : 460) ||
      pipeline.boardwalkPlanks !== (result.viewport.mobile ? 24 : 32) ||
      pipeline.boardwalkPosts !== (result.viewport.mobile ? 14 : 18) ||
      !pipeline.shadeShelter ||
      pipeline.shadePosts !== 4 ||
      pipeline.footprintInstances !== (result.viewport.mobile ? 0 : 70) ||
      !pipeline.tidePools ||
      pipeline.reflectionExclusions !==
        // Eight dry-land detail objects added in the model refinement pass.
        (result.viewport.mobile ? 30 : 31) +
          (result.debugState.rain.initialized ? 1 : 0)
    ) {
      failures.push(`${result.viewport.name}: shared material pipeline is incomplete`);
      console.log('PIPELINE_DIAGNOSTIC', result.viewport.name, pipeline);
    }
    if (
      !result.viewport.mobile &&
      (
        (!pipeline.rockShaderCompiled && !(result.debugState.coastalProps?.replacedShoreRocks === 26 && result.debugState.coastalProps?.shoreShaderCompiled)) ||
        pipeline.rockBatches !== 3 ||
        pipeline.rockInstances !== 26 ||
        !pipeline.woodShadersCompiled
      )
    ) {
      failures.push(`${result.viewport.name}: desktop material shaders did not compile`);
    }
    if (
      result.viewport.mobile &&
      (pipeline.rockShaderCompiled || pipeline.woodShadersCompiled)
    ) {
      failures.push(`${result.viewport.name}: mobile material shaders were not downgraded`);
    }
    if (result.viewport.mobile === pipeline.sandPhysical) {
      failures.push(`${result.viewport.name}: material quality split is incorrect`);
    }
    const guideState = result.guide;
    const guideCommonFailed =
      !guideState?.initial.open ||
      guideState.initial.activeAction !== 'orbit' ||
      guideState.initial.storage !== null ||
      !guideState.initial.contained ||
      guideState.initial.textOverflow.length > 0 ||
      !guideState.reopened.open ||
      guideState.reopened.expanded !== 'true' ||
      guideState.closed.open ||
      guideState.closed.expanded !== 'false' ||
      guideState.closed.focused !== 'guide-button' ||
      guideState.closed.storage !== 'seen';
    const guideWalkDistance = guideState.walkEntry
      ? Math.hypot(
          guideState.walkEntry.state.position[0] - guideState.walkEntry.before[0],
          guideState.walkEntry.state.position[2] - guideState.walkEntry.before[2],
        )
      : 0;
    const guideViewportFailed = result.viewport.mobile
      ? guideState.initial.freeVisible ||
        guideState.initial.walkVisible ||
        guideState.walkEntry !== null
      : !guideState.initial.freeVisible ||
        !guideState.initial.walkVisible ||
        !guideState.walkEntry ||
        guideState.walkEntry.dialogOpen ||
        guideState.walkEntry.storage !== 'seen' ||
        guideState.walkEntry.state.mode !== 'walk' ||
        guideState.walkEntry.state.free.movementMode !== 'walk' ||
        !guideState.walkEntry.state.free.locked ||
        guideState.walkEntry.state.free.lockPending ||
        !guideState.walkEntry.state.free.grounded ||
        !guideState.walkEntry.reticleVisible ||
        !guideState.walkEntry.hintVisible ||
        guideState.walkEntry.movementHint !== '行走' ||
        !guideState.walkEntry.verticalHintHidden ||
        guideState.walkEntry.walkPressed !== 'true' ||
        guideState.walkEntry.walkLocked !== 'true' ||
        guideState.walkEntry.freePressed !== 'false' ||
        guideWalkDistance < 0.2;
    if (guideCommonFailed || guideViewportFailed) {
      failures.push(`${result.viewport.name}: first-run control guide failed`);
    }
    const discovery = result.discovery;
    const discoveryCommonFailed =
      !discovery ||
      !discovery.initial.contained ||
      discovery.initial.accessibility.some(
        ({ displacement }) => displacement > 0.01,
      ) ||
      discovery.initial.state.total !== 6 ||
      discovery.initial.state.collected !== 0 ||
      discovery.initial.count !== '0 / 6' ||
      discovery.initial.progress !== '0' ||
      discovery.pointer.state.collected !== 1 ||
      discovery.pointer.count !== '1 / 6' ||
      discovery.pointer.progress !== '1' ||
      !discovery.pointer.objective?.includes('5') ||
      !discovery.complete.state.completed ||
      discovery.complete.state.collected !== 6 ||
      discovery.complete.count !== '6 / 6' ||
      discovery.complete.progress !== '6' ||
      !discovery.complete.resetVisible ||
      discovery.reset.state.collected !== 0 ||
      discovery.reset.state.completed ||
      discovery.reset.count !== '0 / 6' ||
      discovery.reset.progress !== '0';
    const interactionMovement = discovery?.keyboard
      ? Math.hypot(
          ...discovery.keyboard.cameraPosition.map(
            (value, index) =>
              value - discovery.keyboard.prompt.cameraPosition[index],
          ),
        )
      : 0;
    const discoveryInputFailed = result.viewport.mobile
      ? discovery?.keyboard !== null
      : !discovery?.keyboard ||
        !discovery.keyboard.prompt.visible ||
        !discovery.keyboard.prompt.keyVisible ||
        !discovery.keyboard.prompt.label?.includes('拾取') ||
        discovery.keyboard.state.collected !== 2 ||
        interactionMovement > 0.03;
    if (discoveryCommonFailed || discoveryInputFailed) {
      failures.push(`${result.viewport.name}: tide-trace discovery loop failed`);
    }
    if (result.debugState.cameraColliderCount < 20) {
      failures.push(`${result.viewport.name}: camera collision map is incomplete`);
    }
    if (result.viewport.mobile) {
      if (
        result.debugState.camera.mode !== 'orbit' ||
        result.cameraUi.freeButtonDisplay !== 'none' ||
        result.cameraUi.walkButtonDisplay !== 'none' ||
        result.cameraUi.statusDisplay !== 'none'
      ) {
        failures.push(`${result.viewport.name}: free camera mobile fallback failed`);
      }
    } else {
      const pointerTransition = result.pointerLockTransition;
      const pointerDistance = pointerTransition
        ? Math.hypot(
            pointerTransition.moving.position[0] -
              pointerTransition.before[0],
            pointerTransition.moving.position[1] -
              pointerTransition.before[1],
            pointerTransition.moving.position[2] -
              pointerTransition.before[2],
          )
        : 0;
      const rotationDistance = pointerTransition
        ? Math.hypot(
            ...pointerTransition.rotated.quaternion.map(
              (value, index) =>
                value - pointerTransition.locked.quaternion[index],
            ),
          )
        : 0;
      const pointerMovement = pointerTransition
        ? [
            pointerTransition.moving.position[0] -
              pointerTransition.locked.state.position[0],
            pointerTransition.moving.position[2] -
              pointerTransition.locked.state.position[2],
          ]
        : [0, 0];
      const pointerForward = pointerTransition
        ? [
            pointerTransition.rotated.forward[0],
            pointerTransition.rotated.forward[2],
          ]
        : [0, 0];
      const movementLength = Math.hypot(...pointerMovement);
      const forwardLength = Math.hypot(...pointerForward);
      const headingAlignment =
        movementLength > 0 && forwardLength > 0
          ? (pointerMovement[0] * pointerForward[0] +
              pointerMovement[1] * pointerForward[1]) /
            (movementLength * forwardLength)
          : 0;
      if (
        !pointerTransition ||
        pointerTransition.locked.pointerElement !== 'scene-canvas' ||
        pointerTransition.locked.state.mode !== 'free' ||
        !pointerTransition.locked.state.free.enabled ||
        !pointerTransition.locked.state.free.locked ||
        pointerTransition.locked.state.free.lockPending ||
        pointerTransition.locked.buttonPressed !== 'true' ||
        pointerTransition.locked.buttonLocked !== 'true' ||
        rotationDistance < 0.01 ||
        pointerDistance < 0.1 ||
        headingAlignment < 0.85 ||
        pointerTransition.released.pointerElement !== null ||
        pointerTransition.released.state.mode !== 'orbit' ||
        pointerTransition.released.state.free.enabled ||
        pointerTransition.released.state.free.locked ||
        pointerTransition.released.state.free.lockPending ||
        pointerTransition.released.buttonPressed !== 'false' ||
        pointerTransition.released.buttonLocked !== 'false' ||
        pointerTransition.resetReleased.pointerElement !== null ||
        pointerTransition.resetReleased.state.mode !== 'orbit' ||
        pointerTransition.resetReleased.state.free.enabled ||
        pointerTransition.resetReleased.state.free.locked ||
        pointerTransition.resetReleased.state.free.lockPending ||
        pointerTransition.resetReleased.buttonPressed !== 'false' ||
        pointerTransition.resetReleased.buttonLocked !== 'false'
      ) {
        failures.push(`${result.viewport.name}: pointer lock lifecycle failed`);
      }

      const recovery = result.lockFailureRecovery;
      const timeoutTargetDistance = recovery
        ? Math.hypot(
            ...recovery.timeout.state.target.map(
              (value, index) => value - recovery.targetBeforeFailure[index],
            ),
          )
        : Infinity;
      const rejectionTargetDistance = recovery
        ? Math.hypot(
            ...recovery.rejection.state.target.map(
              (value, index) => value - recovery.targetBeforeFailure[index],
            ),
          )
        : Infinity;
      if (
        !recovery ||
        recovery.pending.state.mode !== 'free' ||
        !recovery.pending.state.free.lockPending ||
        recovery.pending.state.free.locked ||
        recovery.pending.label !== 'LOCKING' ||
        recovery.pending.reticleVisible ||
        recovery.timeout.state.mode !== 'orbit' ||
        recovery.timeout.state.free.enabled ||
        recovery.timeout.state.free.lockPending ||
        recovery.timeout.state.free.lastActivationError !== 'request-timeout' ||
        recovery.timeout.label !== 'ORBIT' ||
        recovery.timeout.reticleVisible ||
        !recovery.timeout.toastVisible ||
        !recovery.timeout.toast?.includes('超时') ||
        timeoutTargetDistance > 0.001 ||
        recovery.rejection.state.mode !== 'orbit' ||
        recovery.rejection.state.free.enabled ||
        recovery.rejection.state.free.lockPending ||
        recovery.rejection.state.free.lastActivationError !==
          'request-rejected' ||
        !recovery.rejection.toast?.includes('未允许') ||
        rejectionTargetDistance > 0.001
      ) {
        failures.push(`${result.viewport.name}: pointer lock failure recovery failed`);
      }

      const transition = result.freeCameraTransition;
      const distance = transition
        ? Math.hypot(
            transition.moving.state.position[0] - transition.before[0],
            transition.moving.state.position[1] - transition.before[1],
            transition.moving.state.position[2] - transition.before[2],
          )
        : 0;
      const boundedPosition = transition?.bounded.position ?? [];
      const restoredTarget = transition?.restored.state.target ?? [];
      const restoredPosition = transition?.restored.state.position ?? [];
      const collisionEvents =
        transition?.collision?.state?.free?.collisionEvents ?? 0;
      const edgeVelocity = transition?.edgeResponse?.free?.velocity ?? [];
      const exitPositionDistance = transition
        ? Math.hypot(
            ...restoredPosition.map(
              (value, index) => value - boundedPosition[index],
            ),
          )
        : Infinity;
      if (
        !transition ||
        transition.activatedMode !== 'free' ||
        transition.moving.state.mode !== 'free' ||
        !transition.moving.state.free.enabled ||
        transition.moving.buttonPressed !== 'true' ||
        !transition.moving.reticleVisible ||
        distance < 0.4 ||
        !transition.collision ||
        !transition.edgeResponse ||
        transition.collision.colliderCount < 20 ||
        collisionEvents <= transition.collisionBefore ||
        transition.collision.insideBoatVolume ||
        transition.edgeResponse.position[0] !== 45 ||
        Math.hypot(edgeVelocity[0] ?? 1, edgeVelocity[2] ?? 1) > 0.01 ||
        boundedPosition[0] !== 45 ||
        boundedPosition[1] !== transition.bounded.free.minimumHeight ||
        boundedPosition[2] !== 56 ||
        transition.restoredMode !== 'orbit' ||
        transition.restored.state.mode !== 'orbit' ||
        transition.restored.state.free.enabled ||
        transition.restored.buttonPressed !== 'false' ||
        transition.restored.reticleVisible ||
        exitPositionDistance > 0.05 ||
        restoredTarget[0] < -45 ||
        restoredTarget[0] > 45 ||
        restoredTarget[1] < 0.8 ||
        restoredTarget[1] > 16 ||
        restoredTarget[2] < -36 ||
        restoredTarget[2] > 56
      ) {
        failures.push(`${result.viewport.name}: free camera transition failed`);
      }

      const walkTransition = result.walkCameraTransition;
      const normalWalkDistance = walkTransition
        ? Math.hypot(
            walkTransition.normal.position[0] - walkTransition.start.position[0],
            walkTransition.normal.position[2] - walkTransition.start.position[2],
          )
        : 0;
      const sprintWalkDistance = walkTransition
        ? Math.hypot(
            walkTransition.sprint.position[0] - walkTransition.start.position[0],
            walkTransition.sprint.position[2] - walkTransition.start.position[2],
          )
        : 0;
      const boardwalkExpectedY = walkTransition?.boardwalk.surface
        ? walkTransition.boardwalk.surface +
          walkTransition.boardwalk.state.free.walkEyeHeight
        : Infinity;
      if (
        !walkTransition ||
        walkTransition.activatedMode !== 'walk' ||
        walkTransition.start.mode !== 'walk' ||
        walkTransition.start.free.movementMode !== 'walk' ||
        !walkTransition.start.free.grounded ||
        normalWalkDistance < 0.8 ||
        sprintWalkDistance < normalWalkDistance * 1.35 ||
        !walkTransition.normal.free.grounded ||
        !walkTransition.sprint.free.grounded ||
        Math.abs(walkTransition.spaceAfter - walkTransition.spaceBefore) > 0.08 ||
        !walkTransition.tableCollision.outside ||
        walkTransition.tableCollision.eventsAfter <=
          walkTransition.tableCollision.eventsBefore ||
        walkTransition.boardwalk.surface === null ||
        Math.abs(
          walkTransition.boardwalk.state.position[1] - boardwalkExpectedY,
        ) > 0.03 ||
        !walkTransition.boardwalk.state.free.grounded ||
        walkTransition.shore.position[2] <
          walkTransition.shore.free.walkMinimumZ - 0.001 ||
        !walkTransition.shore.free.grounded ||
        walkTransition.restoredMode !== 'orbit'
      ) {
        failures.push(
          `${result.viewport.name}: grounded walk transition failed ${JSON.stringify({
            activatedMode: walkTransition?.activatedMode,
            startMode: walkTransition?.start?.mode,
            startGrounded: walkTransition?.start?.free?.grounded,
            normalWalkDistance,
            sprintWalkDistance,
            normalGrounded: walkTransition?.normal?.free?.grounded,
            sprintGrounded: walkTransition?.sprint?.free?.grounded,
            spaceDelta: walkTransition
              ? walkTransition.spaceAfter - walkTransition.spaceBefore
              : null,
            boardwalkSurface: walkTransition?.boardwalk?.surface,
            boardwalkY: walkTransition?.boardwalk?.state?.position?.[1],
            boardwalkExpectedY,
            boardwalkGrounded: walkTransition?.boardwalk?.state?.free?.grounded,
            shoreZ: walkTransition?.shore?.position?.[2],
            shoreMinimumZ: walkTransition?.shore?.free?.walkMinimumZ,
            shoreGrounded: walkTransition?.shore?.free?.grounded,
            restoredMode: walkTransition?.restoredMode,
          })}`,
        );
      }
    }
    if (!result.viewport.mobile && result.periodStats.night) {
      const qualityTransition = result.qualityTransition;
      const periodStates = result.periodStates;
      const nightState = periodStates.night;
      if (
        !qualityTransition ||
        !nightState.starQuality.visible ||
        Math.abs(nightState.starQuality.opacity - 0.88) > 0.002 ||
        !nightState.lighting.starsVisible ||
        !nightState.lighting.moonVisible ||
        !nightState.lighting.moonHaloVisible ||
        nightState.render.points !== 1906 ||
        !nightState.celestialResources.initialized ||
        nightState.celestialResources.allocations !== 1 ||
        nightState.celestialResources.residentPayloadBytes !== 364952 ||
        nightState.celestialResources.objectsInScene !== 3 ||
        !nightState.celestialResources.linked ||
        !nightState.starQuality.initialized ||
        !nightState.moonQuality.initialized ||
        !qualityTransition.before.celestialResources.initialized ||
        qualityTransition.before.celestialResources.allocations !== 1 ||
        qualityTransition.before.celestialResources.residentPayloadBytes !==
          364952 ||
        qualityTransition.before.cloudQuality.quality !== 'high' ||
        qualityTransition.before.cloudQuality.revision !== 1 ||
        qualityTransition.before.waterReflection.quality !== 'high' ||
        qualityTransition.before.waterReflection.width !== 1024 ||
        qualityTransition.before.waterReflection.height !== 1024 ||
        qualityTransition.before.waterReflection.revision !== 1 ||
        qualityTransition.before.waterReflection.resizes !== 0 ||
        qualityTransition.before.waterNormal.quality !== 'high' ||
        qualityTransition.before.waterNormal.width !== 512 ||
        qualityTransition.before.waterNormal.height !== 512 ||
        qualityTransition.before.waterNormal.revision !== 1 ||
        qualityTransition.before.waterNormal.replacements !== 0 ||
        qualityTransition.before.waterNormalDisposals !== 0 ||
        !qualityTransition.before.waterNormalSourceSame ||
        qualityTransition.before.moonQuality.quality !== 'high' ||
        qualityTransition.before.moonQuality.width !== 256 ||
        qualityTransition.before.moonQuality.height !== 256 ||
        qualityTransition.before.moonQuality.widthSegments !== 28 ||
        qualityTransition.before.moonQuality.heightSegments !== 20 ||
        qualityTransition.before.moonQuality.vertices !== 609 ||
        qualityTransition.before.moonQuality.triangles !== 1064 ||
        qualityTransition.before.moonQuality.revision !== 1 ||
        qualityTransition.before.moonQuality.replacements !== 0 ||
        qualityTransition.before.moonDisposals !== 0 ||
        qualityTransition.before.moonGeometryDisposals !== 0 ||
        qualityTransition.before.starQuality.quality !== 'high' ||
        qualityTransition.before.starQuality.count !== 950 ||
        qualityTransition.before.starQuality.positionBytes !== 11400 ||
        qualityTransition.before.starQuality.revision !== 1 ||
        qualityTransition.before.starQuality.replacements !== 0 ||
        qualityTransition.before.starQuality.disposedGeometries !== 0 ||
        !qualityTransition.before.starQuality.visible ||
        qualityTransition.before.starGeometryDisposals !== 0 ||
        qualityTransition.before.render.points !== 1906 ||
        !qualityTransition.before.waterTargetSame ||
        qualityTransition.low.effectiveQuality !== 'low' ||
        !qualityTransition.low.celestialResources.initialized ||
        qualityTransition.low.celestialResources.allocations !== 1 ||
        qualityTransition.low.celestialResources.residentPayloadBytes !== 147112 ||
        qualityTransition.low.celestialResources.objectsInScene !== 3 ||
        !qualityTransition.low.celestialResources.linked ||
        qualityTransition.low.materialPipeline.sandPhysical ||
        qualityTransition.low.materialPipeline.rockShaderCompiled ||
        qualityTransition.low.materialPipeline.woodShadersCompiled ||
        qualityTransition.low.cloudQuality.quality !== 'low' ||
        qualityTransition.low.cloudQuality.textureWidth !== 256 ||
        qualityTransition.low.cloudQuality.textureHeight !== 128 ||
        qualityTransition.low.cloudQuality.triangles !== 728 ||
        qualityTransition.low.cloudQuality.revision !== 2 ||
        qualityTransition.low.cloudQuality.replacements !== 1 ||
        qualityTransition.low.cloudQuality.disposedLayers !== 1 ||
        qualityTransition.low.cloudDisposals.geometries !== 1 ||
        qualityTransition.low.cloudDisposals.materials !== 1 ||
        qualityTransition.low.cloudDisposals.textures !== 1 ||
        qualityTransition.low.waterReflection.quality !== 'low' ||
        qualityTransition.low.waterReflection.width !== 256 ||
        qualityTransition.low.waterReflection.height !== 256 ||
        qualityTransition.low.waterReflection.pixelCount !== 65536 ||
        qualityTransition.low.waterReflection.revision !== 2 ||
        qualityTransition.low.waterReflection.resizes !== 1 ||
        qualityTransition.low.waterNormal.quality !== 'low' ||
        qualityTransition.low.waterNormal.width !== 256 ||
        qualityTransition.low.waterNormal.height !== 256 ||
        qualityTransition.low.waterNormal.pixelCount !== 65536 ||
        qualityTransition.low.waterNormal.anisotropy !== 4 ||
        qualityTransition.low.waterNormal.revision !== 2 ||
        qualityTransition.low.waterNormal.replacements !== 1 ||
        qualityTransition.low.waterNormal.disposedTextures !== 1 ||
        qualityTransition.low.waterNormalDisposals !== 1 ||
        !qualityTransition.low.waterNormalSourceSame ||
        qualityTransition.low.moonQuality.quality !== 'low' ||
        qualityTransition.low.moonQuality.width !== 128 ||
        qualityTransition.low.moonQuality.height !== 128 ||
        qualityTransition.low.moonQuality.pixelCount !== 16384 ||
        qualityTransition.low.moonQuality.craterCount !== 23 ||
        qualityTransition.low.moonQuality.widthSegments !== 18 ||
        qualityTransition.low.moonQuality.heightSegments !== 12 ||
        qualityTransition.low.moonQuality.vertices !== 247 ||
        qualityTransition.low.moonQuality.triangles !== 396 ||
        qualityTransition.low.moonQuality.revision !== 2 ||
        qualityTransition.low.moonQuality.replacements !== 1 ||
        qualityTransition.low.moonQuality.disposedTextures !== 1 ||
        qualityTransition.low.moonQuality.disposedGeometries !== 1 ||
        qualityTransition.low.moonDisposals !== 1 ||
        qualityTransition.low.moonGeometryDisposals !== 1 ||
        qualityTransition.low.starQuality.quality !== 'low' ||
        qualityTransition.low.starQuality.count !== 480 ||
        qualityTransition.low.starQuality.positionBytes !== 5760 ||
        qualityTransition.low.starQuality.revision !== 2 ||
        qualityTransition.low.starQuality.replacements !== 1 ||
        qualityTransition.low.starQuality.disposedGeometries !== 1 ||
        !qualityTransition.low.starQuality.visible ||
        qualityTransition.low.starGeometryDisposals !== 1 ||
        qualityTransition.low.render.points !== 966 ||
        qualityTransition.low.waterTargetDisposals !== 1 ||
        !qualityTransition.low.waterTargetSame ||
        qualityTransition.high.effectiveQuality !== 'high' ||
        !qualityTransition.high.celestialResources.initialized ||
        qualityTransition.high.celestialResources.allocations !== 1 ||
        qualityTransition.high.celestialResources.residentPayloadBytes !==
          364952 ||
        qualityTransition.high.celestialResources.objectsInScene !== 3 ||
        !qualityTransition.high.celestialResources.linked ||
        !qualityTransition.high.materialPipeline.sandPhysical ||
        qualityTransition.high.cloudQuality.quality !== 'high' ||
        qualityTransition.high.cloudQuality.textureWidth !== 512 ||
        qualityTransition.high.cloudQuality.textureHeight !== 256 ||
        qualityTransition.high.cloudQuality.triangles !== 2208 ||
        qualityTransition.high.cloudQuality.revision !== 3 ||
        qualityTransition.high.cloudQuality.replacements !== 2 ||
        qualityTransition.high.cloudQuality.disposedLayers !== 2 ||
        qualityTransition.high.cloudDisposals.geometries !== 2 ||
        qualityTransition.high.cloudDisposals.materials !== 2 ||
        qualityTransition.high.cloudDisposals.textures !== 2 ||
        qualityTransition.high.waterReflection.quality !== 'high' ||
        qualityTransition.high.waterReflection.width !== 1024 ||
        qualityTransition.high.waterReflection.height !== 1024 ||
        qualityTransition.high.waterReflection.pixelCount !== 1048576 ||
        qualityTransition.high.waterReflection.revision !== 3 ||
        qualityTransition.high.waterReflection.resizes !== 2 ||
        qualityTransition.high.waterNormal.quality !== 'high' ||
        qualityTransition.high.waterNormal.width !== 512 ||
        qualityTransition.high.waterNormal.height !== 512 ||
        qualityTransition.high.waterNormal.pixelCount !== 262144 ||
        qualityTransition.high.waterNormal.anisotropy !== 8 ||
        qualityTransition.high.waterNormal.revision !== 3 ||
        qualityTransition.high.waterNormal.replacements !== 2 ||
        qualityTransition.high.waterNormal.disposedTextures !== 2 ||
        qualityTransition.high.waterNormalDisposals !== 2 ||
        !qualityTransition.high.waterNormalSourceSame ||
        qualityTransition.high.moonQuality.quality !== 'high' ||
        qualityTransition.high.moonQuality.width !== 256 ||
        qualityTransition.high.moonQuality.height !== 256 ||
        qualityTransition.high.moonQuality.pixelCount !== 65536 ||
        qualityTransition.high.moonQuality.craterCount !== 46 ||
        qualityTransition.high.moonQuality.widthSegments !== 28 ||
        qualityTransition.high.moonQuality.heightSegments !== 20 ||
        qualityTransition.high.moonQuality.vertices !== 609 ||
        qualityTransition.high.moonQuality.triangles !== 1064 ||
        qualityTransition.high.moonQuality.revision !== 3 ||
        qualityTransition.high.moonQuality.replacements !== 2 ||
        qualityTransition.high.moonQuality.disposedTextures !== 2 ||
        qualityTransition.high.moonQuality.disposedGeometries !== 2 ||
        qualityTransition.high.moonDisposals !== 2 ||
        qualityTransition.high.moonGeometryDisposals !== 2 ||
        qualityTransition.high.starQuality.quality !== 'high' ||
        qualityTransition.high.starQuality.count !== 950 ||
        qualityTransition.high.starQuality.positionBytes !== 11400 ||
        qualityTransition.high.starQuality.revision !== 3 ||
        qualityTransition.high.starQuality.replacements !== 2 ||
        qualityTransition.high.starQuality.disposedGeometries !== 2 ||
        !qualityTransition.high.starQuality.visible ||
        qualityTransition.high.starGeometryDisposals !== 2 ||
        qualityTransition.high.render.points !== 1906 ||
        qualityTransition.high.waterTargetDisposals !== 2 ||
        !qualityTransition.high.waterTargetSame ||
        qualityTransition.low.waterReflection.waterUuid !==
          qualityTransition.before.waterReflection.waterUuid ||
        qualityTransition.high.waterReflection.waterUuid !==
          qualityTransition.before.waterReflection.waterUuid ||
        qualityTransition.low.waterReflection.textureUuid !==
          qualityTransition.before.waterReflection.textureUuid ||
        qualityTransition.high.waterReflection.textureUuid !==
          qualityTransition.before.waterReflection.textureUuid ||
        qualityTransition.low.waterNormal.sourceUuid !==
          qualityTransition.before.waterNormal.sourceUuid ||
        qualityTransition.high.waterNormal.sourceUuid !==
          qualityTransition.before.waterNormal.sourceUuid ||
        qualityTransition.low.waterNormal.textureUuid ===
          qualityTransition.before.waterNormal.textureUuid ||
        qualityTransition.high.waterNormal.textureUuid ===
          qualityTransition.low.waterNormal.textureUuid ||
        qualityTransition.low.moonQuality.moonUuid !==
          qualityTransition.before.moonQuality.moonUuid ||
        qualityTransition.high.moonQuality.moonUuid !==
          qualityTransition.before.moonQuality.moonUuid ||
        qualityTransition.low.moonQuality.materialUuid !==
          qualityTransition.before.moonQuality.materialUuid ||
        qualityTransition.high.moonQuality.materialUuid !==
          qualityTransition.before.moonQuality.materialUuid ||
        qualityTransition.low.moonQuality.textureUuid ===
          qualityTransition.before.moonQuality.textureUuid ||
        qualityTransition.high.moonQuality.textureUuid ===
          qualityTransition.low.moonQuality.textureUuid ||
        qualityTransition.low.moonQuality.geometryUuid ===
          qualityTransition.before.moonQuality.geometryUuid ||
        qualityTransition.high.moonQuality.geometryUuid ===
          qualityTransition.low.moonQuality.geometryUuid ||
        qualityTransition.low.starQuality.pointsUuid !==
          qualityTransition.before.starQuality.pointsUuid ||
        qualityTransition.high.starQuality.pointsUuid !==
          qualityTransition.before.starQuality.pointsUuid ||
        qualityTransition.low.starQuality.materialUuid !==
          qualityTransition.before.starQuality.materialUuid ||
        qualityTransition.high.starQuality.materialUuid !==
          qualityTransition.before.starQuality.materialUuid ||
        qualityTransition.low.starQuality.geometryUuid ===
          qualityTransition.before.starQuality.geometryUuid ||
        qualityTransition.high.starQuality.geometryUuid ===
          qualityTransition.low.starQuality.geometryUuid ||
        qualityTransition.low.starQuality.rotationY <
          qualityTransition.before.starQuality.rotationY ||
        qualityTransition.high.starQuality.rotationY <
          qualityTransition.low.starQuality.rotationY ||
        qualityTransition.low.waterTime < qualityTransition.before.waterTime ||
        qualityTransition.high.waterTime < qualityTransition.low.waterTime ||
        qualityTransition.low.cloudQuality.phase <
          qualityTransition.before.cloudQuality.phase ||
        qualityTransition.high.cloudQuality.phase <
          qualityTransition.low.cloudQuality.phase ||
        qualityTransition.low.cloudQuality.rotationY <
          qualityTransition.before.cloudQuality.rotationY ||
        qualityTransition.high.cloudQuality.rotationY <
          qualityTransition.low.cloudQuality.rotationY ||
        qualityTransition.low.worldRevision -
          qualityTransition.before.worldRevision !==
          1 ||
        qualityTransition.high.worldRevision -
          qualityTransition.low.worldRevision !==
          1
      ) {
        failures.push(`${result.viewport.name}: runtime quality rebuild failed`);
        console.error(JSON.stringify({ viewport: result.viewport.name, nightState, qualityTransition }, null, 2));
      }
      const luminanceDifference = Math.abs(
        result.periodStats.day.mean - result.periodStats.night.mean,
      );
      if (luminanceDifference < 18) {
        failures.push(`${result.viewport.name}: day and night lighting are too similar`);
      }
      if (
        result.periodStats.night.mean < 24 ||
        result.periodStats.night.standardDeviation < 12
      ) {
        failures.push(`${result.viewport.name}: night foreground is unreadable`);
      }
      if (
        // Judge the sunlit land, not the expanded blue ocean occupying most of the frame.
        result.periodStats.sunset.foregroundMeanColor[0] <
        result.periodStats.sunset.foregroundMeanColor[2] + 8
      ) {
        failures.push(`${result.viewport.name}: sunset lost its warm key-light separation`);
      }
      if (
        !periodStates.day.water.layeredModel ||
        periodStates.day.water.horizonColor === periodStates.day.water.deepColor ||
        periodStates.day.water.normalAnisotropy < 1 ||
        // The HDR daylight preset now has a stronger physical sun glint.
        periodStates.day.water.sunGlintStrength < 1.0 ||
        periodStates.sunset.water.sunGlintStrength < 0.6 ||
        Math.abs(periodStates.sunset.water.sunGlintStrength -
          periodStates.day.water.sunGlintStrength) < 0.1 ||
        periodStates.night.water.reflectionStrength >=
          periodStates.day.water.reflectionStrength
      ) {
        failures.push(`${result.viewport.name}: layered water preset controls are inactive`);
      }
      if (
        result.debugState.lighting.moonOpacity < 0.8 ||
        result.debugState.lighting.lanternIntensity < 8 ||
        !result.debugState.lantern.active ||
        !result.debugState.lantern.flickerActive ||
        !result.debugState.lantern.lightVisible ||
        !result.debugState.lantern.glowVisible ||
        !result.debugState.lantern.haloVisible ||
        result.debugState.lantern.drawObjects !== 2
      ) {
        failures.push(`${result.viewport.name}: night lighting accents are inactive`);
      }
    }
  });

  const summary = results.map((result) => ({
    viewport: result.viewport.name,
    render: result.debugState.render,
    billiards: {
      balls: result.debugState.billiards?.activeBalls ?? 0,
      drawObjects: result.debugState.billiards?.drawObjects ?? 0,
      allocations: result.debugState.billiards?.allocations ?? 0,
      shots: result.debugState.billiards?.shots ?? 0,
    },
    consoleErrors: result.consoleErrors.length,
    layoutOverflow: result.layoutOverflow.length,
    resourcesDisposed: Boolean(
      result.environmentDispose?.billiardsResourcesDisposed &&
      result.environmentDispose?.discoveryReleased,
    ),
  }));
  await writeFile(path.join(screenshotDirectory, 'visual-results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({
    ok: failures.length === 0,
    failures,
    summary,
  }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  await browser.close();
  await testServer?.close();
}

import { createIcons, Maximize, Minimize, Pause, Play } from 'lucide';
import { NpcDialog } from './NpcDialog.js';
import { CollectionJournal } from './CollectionJournal.js';

/**
 * Keeps DOM interaction independent from Three.js. The controller translates
 * UI intent into the small public API exposed by BeachExperience.
 */
export class UIController {
  constructor(root) {
    this.root = root;
    this.experience = null;
    this.intro = root.querySelector('#intro');
    this.hud = root.querySelector('#hud');
    this.startButton = root.querySelector('#start-button');
    this.startLabel = root.querySelector('#start-label');
    this.toast = root.querySelector('#toast');
    this.guideDialog = root.querySelector('#guide-dialog');
    this.guideButton = root.querySelector('#guide-button');
    this.freeViewHint = root.querySelector('#free-view-hint');
    this.discoveryHud = root.querySelector('#discovery-hud');
    this.discoveryCount = root.querySelector('#discovery-count');
    this.discoveryProgress = root.querySelector('.discovery-progress');
    this.discoveryProgressBar = root.querySelector('#discovery-progress-bar');
    this.discoveryObjective = root.querySelector('#discovery-objective');
    this.discoveryPrompt = root.querySelector('#discovery-prompt');
    this.discoveryPromptKey = root.querySelector('#discovery-prompt-key');
    this.discoveryPromptLabel = root.querySelector('#discovery-prompt-label');
    this.discoveryReset = root.querySelector('#discovery-reset');
    this.billiardsHud = root.querySelector('#billiards-hud');
    this.billiardsScore = root.querySelector('#billiards-score');
    this.billiardsShots = root.querySelector('#billiards-shots');
    this.billiardsStatus = root.querySelector('#billiards-status');
    this.billiardsPowerBar = root.querySelector('#billiards-power-bar');
    this.billiardsFocus = root.querySelector('#billiards-focus');
    this.billiardsReset = root.querySelector('#billiards-reset');
    this.billiardsPlayers = root.querySelector('#billiards-players');
    this.billiardsActions = root.querySelector('#billiards-actions');
    this.tideOutput = root.querySelector('#tide-output');
    this.tideLabel = root.querySelector('#tide-label');
    this.rainToggle = root.querySelector('#rain-toggle');
    this.bloomToggle = root.querySelector('#bloom-toggle');
    this.footstepAudioToggle = root.querySelector('#footstep-audio-toggle');
    this.bookmarkOutput = root.querySelector('#bookmark-output');
    this.bookmarkSlotButtons = [...root.querySelectorAll('[data-bookmark-slot]')];
    this.bookmarkSave = root.querySelector('#bookmark-save');
    this.bookmarkRestore = root.querySelector('#bookmark-restore');
    this.bookmarkDelete = root.querySelector('#bookmark-delete');
    this.selectedBookmarkSlot = 1;
    this.bookmarkState = null;
    this.assetImportControl = root.querySelector('#asset-import-control');
    this.assetOutput = root.querySelector('#asset-output');
    this.importModelButton = root.querySelector('#import-model');
    this.importTextureButton = root.querySelector('#import-texture');
    this.removeAssetButton = root.querySelector('#remove-asset');
    this.modelFileInput = root.querySelector('#model-file');
    this.textureFileInput = root.querySelector('#texture-file');
    this.assetTransformControl = root.querySelector('#asset-transform-control');
    this.assetTransformReset = root.querySelector('#asset-transform-reset');
    this.assetTransformInputs = [...root.querySelectorAll('[data-asset-transform]')];
    this.assetAnimationControl = root.querySelector('#asset-animation-control');
    this.assetAnimationOutput = root.querySelector('#asset-animation-output');
    this.assetAnimationSelect = root.querySelector('#asset-animation-select');
    this.assetAnimationToggle = root.querySelector('#asset-animation-toggle');
    this.assetAnimationRestart = root.querySelector('#asset-animation-restart');
    this.assetAnimationSpeed = root.querySelector('#asset-animation-speed');
    this.assetAnimationSpeedOutput = root.querySelector('#asset-animation-speed-output');
    this.animationClipSignature = '';
    this.panels = [...root.querySelectorAll('.side-panel')];
    this.guideSeenKey = 'tideline.control-guide.v4';
    this.guideReturnFocus = null;
    this.freeHintTimer = 0;
    this.cameraWasLocked = false;
    this.lastCameraMode = 'orbit';
    this.toastTimer = 0;
    this.toastHideTimer = 0;
    this.eventController = null;
    this.pendingTimers = new Set();
  }

  connect(experience) {
    this.experience = experience;
    this.eventController?.abort();
    this.eventController = new AbortController();
    const eventOptions = { signal: this.eventController.signal };
    const fold = this.root.querySelector('#billiards-fold');
    const expandPool = (expanded) => {
      this.billiardsHud.classList.toggle('is-expanded', expanded);
      fold.setAttribute('aria-expanded', String(expanded));
      fold.title = expanded ? '收起球局' : '展开球局';
      fold.setAttribute('aria-label', fold.title);
    };
    fold.addEventListener('click', () => expandPool(!this.billiardsHud.classList.contains('is-expanded')), eventOptions);
    experience.addEventListener('billiardsfocus', () => expandPool(true), eventOptions);
    experience.addEventListener('discoveryfocus', () => expandPool(false), eventOptions);
    this.npcDialog = new NpcDialog(experience, this.eventController.signal);
    this.collectionJournal = new CollectionJournal(experience, this.eventController.signal);
    this.root.querySelector('#clock-running').addEventListener('change', event => {
      if (experience.environment) experience.environment.dayClock.running = event.target.checked;
    }, eventOptions);
    experience.addEventListener('clockchange', event => {
      this.root.querySelector('#day-clock').value = event.detail.label;
      this.root.querySelector('#clock-running').checked = event.detail.running;
      const period = experience.environment.currentPreset;
      this.setPressedGroup('[data-time]', this.root.querySelector(`[data-time="${period}"]`));
      this.root.querySelector('#period-label').textContent = { dawn: '清晨', day: '日光', sunset: '黄昏', night: '月夜' }[period];
    }, eventOptions);

    this.startButton.addEventListener(
      'click',
      () => this.enterScene(),
      eventOptions,
    );
    this.root.querySelector('#reset-view').addEventListener('click', () => {
      experience.resetCamera();
      expandPool(false);
      this.showToast('视角已重置');
    }, eventOptions);
    this.root.querySelector('#street-view').addEventListener('click', () => {
      experience.focusStreet();
      this.closeAllPanels();
      expandPool(false);
    }, eventOptions);
    this.discoveryReset.addEventListener(
      'click',
      () => experience.resetDiscovery(),
      eventOptions,
    );
    this.billiardsReset.addEventListener(
      'click',
      () => experience.resetBilliards(),
      eventOptions,
    );
    this.billiardsActions.addEventListener('click', (event) => {
      const action = event.target.closest('[data-pool-action]')?.dataset.poolAction;
      if (action) experience.performBilliardsAction(action);
    }, { signal: this.eventController.signal });
    this.root.querySelector('#billiards-settings').addEventListener('click', () => {
      this.togglePanel('billiards-panel');
    }, eventOptions);
    this.root.querySelectorAll('[data-pool-setting]').forEach((input) => {
      input.addEventListener('input', () => experience.setBilliardsShotSettings({
        [input.dataset.poolSetting]: Number(input.value),
      }), eventOptions);
    });
    this.root.querySelector('#pool-center-tip').addEventListener('click', () =>
      experience.setBilliardsShotSettings({ tipX: 0, tipY: 0 }), eventOptions);
    this.root.querySelector('#pool-reset-cloth').addEventListener('click', () =>
      experience.setBilliardsShotSettings({ sliding: 0.2, rolling: 0.01 }), eventOptions);
    this.billiardsFocus.addEventListener(
      'click',
      () => {
        this.closeAllPanels();
        const result = experience.focusBilliards();
        if (result) this.showToast('已定位沙滩台球');
      },
      eventOptions,
    );
    for (const mode of ['cue', 'table']) {
      this.root.querySelector(`#pool-view-${mode}`).addEventListener('click', () => {
        this.closeAllPanels();
        experience.setBilliardsMode(mode === 'cue' ? 'shoot' : 'observe');
      }, eventOptions);
    }
    experience.addEventListener('billiardsviewchange', ({ detail }) => {
      document.body.classList.toggle('is-cue-view', detail.mode === 'cue');
      document.body.classList.toggle('is-pool-view', ['cue', 'observe'].includes(detail.mode));
      for (const mode of ['cue', 'table']) this.root.querySelector(`#pool-view-${mode}`)
        .setAttribute('aria-pressed', String(mode === 'cue' ? detail.mode === 'cue' : detail.mode !== 'cue'));
      this.root.querySelector('#pool-cue-shot').hidden = detail.mode !== 'cue';
      this.root.querySelector('#pool-cue-shot').disabled = true;
    }, eventOptions);
    for (const [id, direction] of [['left', -1], ['right', 1]]) {
      this.root.querySelector(`#pool-aim-${id}`).addEventListener('click', () => {
        experience.billiards.adjustViewAim(direction * Math.PI / 720);
      }, eventOptions);
    }
    this.root.querySelector('#pool-shot-power').addEventListener('input', (event) => {
      experience.billiards.shotPower = Number(event.target.value) / 100;
      this.root.querySelector('#pool-shot-power-output').textContent = `${event.target.value}%`;
    }, eventOptions);
    this.root.querySelector('#pool-strike').addEventListener('click', () => experience.billiards.shootFromView(), eventOptions);
    this.root.querySelector('#pool-audio').addEventListener('click', () => {
      experience.setBilliardsAudio({ enabled: !experience.billiards.audio.enabled });
    }, eventOptions);
    this.root.querySelector('#pool-audio-volume').addEventListener('input', (event) => {
      experience.setBilliardsAudio({ volume: Number(event.target.value) / 100 });
    }, eventOptions);
    experience.addEventListener('billiardsaudiochange', ({ detail }) => {
      this.root.querySelector('#pool-audio').setAttribute('aria-checked', String(detail.enabled));
      this.root.querySelector('#pool-audio-volume-output').textContent = `${Math.round(detail.volume * 100)}%`;
    }, eventOptions);
    const bindPointerMode = (selector, mode) => {
      this.root.querySelector(selector).addEventListener(
        'click',
        () => {
          if (!experience.supportsFreeCamera()) {
            this.showToast('当前设备保留环绕视角');
            return;
          }
          this.closeAllPanels();
          if (!this.hasSeenGuide()) {
            this.openGuide();
            return;
          }
          experience.toggleCameraMode(mode);
        },
        eventOptions,
      );
    };
    bindPointerMode('#walk-mode-button', 'walk');
    bindPointerMode('#camera-mode-button', 'free');

    this.guideButton.addEventListener(
      'click',
      () => this.openGuide(),
      eventOptions,
    );
    this.root.querySelector('#guide-close').addEventListener(
      'click',
      () => this.closeGuide(),
      eventOptions,
    );
    this.root.querySelectorAll('[data-guide-action]').forEach((button) => {
      button.addEventListener(
        'click',
        () => {
          const action = button.dataset.guideAction;
          this.closeGuide({ restoreFocus: action === 'orbit' });
          if (action !== 'orbit') experience.setCameraMode(action);
        },
        eventOptions,
      );
    });
    this.guideDialog.addEventListener(
      'cancel',
      (event) => {
        event.preventDefault();
        this.closeGuide();
      },
      eventOptions,
    );

    this.root.querySelectorAll('[data-time]').forEach((button) => {
      button.addEventListener(
        'click',
        () => {
          const period = button.dataset.time;
          experience.setTimeOfDay(period);
          this.setPressedGroup('[data-time]', button);
          this.root.querySelector('#period-label').textContent = {
            dawn: '清晨',
            day: '日光',
            sunset: '黄昏',
            night: '月夜',
          }[period];
        },
        eventOptions,
      );
    });

    this.root.querySelectorAll('[data-weather]').forEach((button) => {
      button.addEventListener(
        'click',
        () => {
          const state = experience.setWeather(button.dataset.weather);
          this.setPressedGroup('[data-weather]', button);
          this.root.querySelector('#weather-output').textContent = {
            clear: '晴朗',
            cloudy: '多云',
            overcast: '阴天',
          }[state?.mode] ?? '晴朗';
        },
        eventOptions,
      );
    });

    this.root.querySelectorAll('[data-quality]').forEach((button) => {
      button.addEventListener(
        'click',
        () => {
          const quality = button.dataset.quality;
          const effectiveQuality = experience.setQuality(quality);
          this.setPressedGroup('[data-quality]', button);
          this.updateQualityText(quality, effectiveQuality);
        },
        eventOptions,
      );
    });

    this.root.querySelectorAll('[data-tide]').forEach((button) => {
      button.addEventListener(
        'click',
        () => {
          const tide = experience.setTideMode(button.dataset.tide);
          this.setPressedGroup('[data-tide]', button);
          this.updateTideState(tide);
        },
        eventOptions,
      );
    });

    this.bindRange('#wave-speed', '#wave-output', (value) => {
      experience.setWaveSpeed(value);
    });
    this.bindRange('#ocean-swell-strength', '#ocean-swell-output', (value) => {
      experience.setOceanSwellStrength(value);
    });
    this.bindRange('#wind-strength', '#wind-output', (value) => {
      experience.setWindStrength(value);
    });
    this.bindRange('#foam-strength', '#foam-output', (value) => {
      experience.setFoamStrength(value);
    });

    this.root
      .querySelector('#shadow-toggle')
      .addEventListener(
        'change',
        (event) => {
          experience.setShadows(event.target.checked);
        },
        eventOptions,
      );

    this.rainToggle.addEventListener(
      'change',
      (event) => experience.setRainEnabled(event.target.checked),
      eventOptions,
    );
    experience.addEventListener(
      'rainchange',
      (event) => this.updateRainState(event.detail),
      eventOptions,
    );

    this.bloomToggle.addEventListener(
      'change',
      async (event) => {
        const requested = event.target.checked;
        event.target.disabled = true;
        try {
          const state = await experience.setBloomEnabled(requested);
          this.updateBloomState(state);
          if (requested && !state.enabled) {
            this.showToast('浏览器未能启用柔光泛光', 2800);
          }
        } finally {
          event.target.disabled = false;
        }
      },
      eventOptions,
    );
    experience.addEventListener(
      'bloomchange',
      (event) => this.updateBloomState(event.detail),
      eventOptions,
    );

    this.footstepAudioToggle.addEventListener(
      'change',
      async (event) => {
        const requested = event.target.checked;
        event.target.disabled = true;
        try {
          const state = await experience.setFootstepAudioEnabled(requested);
          this.updateFootstepAudioState(state);
          if (requested && !state.enabled) {
            this.showToast('浏览器未能启用音频输出', 2800);
          }
        } finally {
          event.target.disabled = false;
        }
      },
      eventOptions,
    );
    experience.addEventListener(
      'footstepaudiochange',
      (event) => this.updateFootstepAudioState(event.detail),
      eventOptions,
    );

    this.bookmarkSlotButtons.forEach((button) => {
      button.addEventListener(
        'click',
        () => {
          this.selectedBookmarkSlot = Number(button.dataset.bookmarkSlot);
          this.updateBookmarkState(this.bookmarkState);
        },
        eventOptions,
      );
    });
    this.bookmarkSave.addEventListener(
      'click',
      () => {
        const result = experience.saveCameraBookmark(this.selectedBookmarkSlot);
        if (!result) return;
        this.updateBookmarkState(result.state);
        this.showToast(`构图已保存到槽位 ${this.selectedBookmarkSlot}`);
      },
      eventOptions,
    );
    this.bookmarkRestore.addEventListener(
      'click',
      () => {
        const result = experience.restoreCameraBookmark(this.selectedBookmarkSlot);
        if (!result) {
          this.showToast(`槽位 ${this.selectedBookmarkSlot} 还没有构图`);
          return;
        }
        this.closeAllPanels();
        this.showToast(`正在前往构图 ${this.selectedBookmarkSlot}`);
      },
      eventOptions,
    );
    this.bookmarkDelete.addEventListener(
      'click',
      () => {
        const result = experience.removeCameraBookmark(this.selectedBookmarkSlot);
        if (!result) return;
        this.updateBookmarkState(result.state);
        this.showToast(`已删除构图 ${this.selectedBookmarkSlot}`);
      },
      eventOptions,
    );
    experience.addEventListener(
      'camerabookmarkchange',
      (event) => this.updateBookmarkState(event.detail.state),
      eventOptions,
    );

    this.importModelButton.addEventListener(
      'click',
      () => this.modelFileInput.click(),
      eventOptions,
    );
    this.importTextureButton.addEventListener(
      'click',
      () => this.textureFileInput.click(),
      eventOptions,
    );
    this.bindAssetInput(this.modelFileInput, 'model', eventOptions);
    this.bindAssetInput(this.textureFileInput, 'texture', eventOptions);
    this.removeAssetButton.addEventListener(
      'click',
      () => {
        experience.removeLocalAsset();
        this.showToast('本地导入已移除');
      },
      eventOptions,
    );
    experience.addEventListener(
      'assetimportchange',
      (event) => this.updateAssetState(event.detail),
      eventOptions,
    );
    this.assetTransformInputs.forEach((input) => {
      input.addEventListener(
        'input',
        () => {
          experience.setLocalAssetTransform({
            [input.dataset.assetTransform]: Number(input.value),
          });
        },
        eventOptions,
      );
    });
    this.assetTransformReset.addEventListener(
      'click',
      () => {
        experience.resetLocalAssetTransform();
        this.showToast('导入位置已重置');
      },
      eventOptions,
    );
    experience.addEventListener(
      'assettransformchange',
      (event) => this.updateAssetTransform(event.detail?.transform ?? null),
      eventOptions,
    );
    this.assetAnimationSelect.addEventListener(
      'change',
      () => experience.selectLocalAssetAnimation(Number(this.assetAnimationSelect.value)),
      eventOptions,
    );
    this.assetAnimationToggle.addEventListener(
      'click',
      () => {
        const playing = experience.getDebugState().localAsset?.animation?.playing;
        experience.setLocalAssetAnimationPlaying(!playing);
      },
      eventOptions,
    );
    this.assetAnimationRestart.addEventListener(
      'click',
      () => {
        experience.restartLocalAssetAnimation();
        this.showToast('模型动画已从头播放');
      },
      eventOptions,
    );
    this.assetAnimationSpeed.addEventListener(
      'input',
      () => experience.setLocalAssetAnimationSpeed(Number(this.assetAnimationSpeed.value)),
      eventOptions,
    );
    experience.addEventListener(
      'assetanimationchange',
      (event) => this.updateAssetAnimation(event.detail?.animation ?? null),
      eventOptions,
    );

    this.root
      .querySelector('#settings-button')
      .addEventListener(
        'click',
        () => {
          this.togglePanel('settings-panel');
        },
        eventOptions,
      );
    this.root
      .querySelector('#about-button')
      .addEventListener(
        'click',
        () => {
          this.togglePanel('about-panel');
        },
        eventOptions,
      );

    this.root.querySelectorAll('[data-close-panel]').forEach((button) => {
      button.addEventListener(
        'click',
        () => this.closePanel(button.dataset.closePanel),
        eventOptions,
      );
    });

    this.root
      .querySelector('#fullscreen-button')
      .addEventListener(
        'click',
        () => {
          this.toggleFullscreen();
        },
        eventOptions,
      );

    document.addEventListener(
      'fullscreenchange',
      () => this.updateFullscreenButton(),
      eventOptions,
    );
    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Escape') {
          this.closeAllPanels();
        }
        if (
          event.key.toLowerCase() === 'r' &&
          !this.intro.classList.contains('is-visible') &&
          !this.guideDialog.open &&
          !this.isEditableTarget(event.target)
        ) {
          experience.resetCamera();
        }
      },
      eventOptions,
    );

    experience.addEventListener(
      'qualitychange',
      (event) => {
        const { mode, effective } = event.detail;
        this.updateQualityText(mode, effective);
      },
      eventOptions,
    );
    experience.addEventListener(
      'tidechange',
      (event) => this.updateTideState(event.detail),
      eventOptions,
    );
    experience.addEventListener(
      'cameramodechange',
      (event) => this.updateCameraMode(event.detail),
      eventOptions,
    );
    experience.addEventListener(
      'cameraerror',
      (event) => this.handleCameraError(event.detail),
      eventOptions,
    );
    experience.addEventListener(
      'discoveryprogress',
      (event) => this.updateDiscoveryProgress(event.detail),
      eventOptions,
    );
    experience.addEventListener(
      'discoveryfocus',
      (event) => this.updateDiscoveryFocus(event.detail),
      eventOptions,
    );
    experience.addEventListener(
      'discoveryfound',
      (event) => this.handleDiscoveryFound(event.detail),
      eventOptions,
    );
    experience.addEventListener(
      'discoverycomplete',
      () => this.handleDiscoveryComplete(),
      eventOptions,
    );
    experience.addEventListener(
      'discoveryreset',
      () => this.showToast('潮汐拾光已重新开始'),
      eventOptions,
    );
    experience.addEventListener(
      'billiardsprogress',
      (event) => this.updateBilliardsProgress(event.detail),
      eventOptions,
    );
    experience.addEventListener(
      'billiardspocket',
      (event) => this.handleBilliardsPocket(event.detail),
      eventOptions,
    );
    experience.addEventListener(
      'billiardscomplete',
      (event) => this.handleBilliardsComplete(event.detail),
      eventOptions,
    );
    experience.addEventListener(
      'billiardsreset',
      () => this.showToast('沙滩台球已重新开局'),
      eventOptions,
    );
    experience.addEventListener(
      'billiardsaimchange',
      (event) => this.updateBilliardsAim(event.detail),
      eventOptions,
    );
    this.updateCameraMode({
      mode: 'orbit',
      locked: false,
      pending: false,
      interactive: false,
      supported: experience.supportsFreeCamera(),
    });
    this.updateDiscoveryProgress({
      collected: 0,
      total: 6,
      remaining: 6,
      completed: false,
    });
    this.updateBilliardsProgress({
      pocketed: 0,
      remaining: 15,
      total: 15,
      shots: 0,
      fouls: 0,
      completed: false,
      settled: true,
    });
    this.updateBookmarkState(experience.getCameraBookmarkState());
    this.updateBloomState(experience.getDebugState().bloom);
  }

  bindRange(inputSelector, outputSelector, callback) {
    const input = this.root.querySelector(inputSelector);
    const output = this.root.querySelector(outputSelector);
    input.addEventListener(
      'input',
      () => {
        const value = Number(input.value);
        output.value = value.toFixed(2);
        callback(value);
      },
      { signal: this.eventController.signal },
    );
  }

  schedule(callback, delay) {
    const timer = window.setTimeout(() => {
      this.pendingTimers.delete(timer);
      callback();
    }, delay);
    this.pendingTimers.add(timer);
    return timer;
  }

  isEditableTarget(target) {
    return (
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(target.tagName))
    );
  }

  hasSeenGuide() {
    try {
      return window.localStorage.getItem(this.guideSeenKey) === 'seen';
    } catch {
      return false;
    }
  }

  markGuideSeen() {
    try {
      window.localStorage.setItem(this.guideSeenKey, 'seen');
    } catch {
      // Storage can be unavailable in strict privacy or embedded contexts.
    }
  }

  openGuide() {
    if (this.guideDialog.open) return;
    if (this.experience.getDebugState().camera.mode !== 'orbit') {
      this.experience.setCameraMode('orbit');
    }
    this.closeAllPanels();
    this.discoveryPrompt.classList.remove('is-visible');
    this.discoveryPrompt.setAttribute('aria-hidden', 'true');
    this.guideReturnFocus = document.activeElement;
    const supportsFreeCamera = this.experience.supportsFreeCamera();
    this.root.querySelectorAll('[data-pointer-guide]').forEach((element) => {
      element.hidden = !supportsFreeCamera;
    });
    this.guideButton.setAttribute('aria-expanded', 'true');
    this.guideDialog.showModal();
    requestAnimationFrame(() => {
      this.guideDialog
        .querySelector('[data-guide-action="orbit"]')
        ?.focus({ preventScroll: true });
    });
  }

  closeGuide({ restoreFocus = true } = {}) {
    this.markGuideSeen();
    if (this.guideDialog.open) this.guideDialog.close();
    this.guideButton.setAttribute('aria-expanded', 'false');
    if (!restoreFocus) return;

    const focusTarget =
      this.guideReturnFocus instanceof HTMLElement &&
      this.guideReturnFocus.isConnected &&
      !this.guideReturnFocus.closest('[hidden]')
        ? this.guideReturnFocus
        : this.root.querySelector('#scene-canvas');
    focusTarget?.focus({ preventScroll: true });
  }

  handleCameraError({ reason }) {
    const message =
      reason === 'request-timeout'
        ? '鼠标锁定超时，已返回环绕视角'
        : '浏览器未允许鼠标锁定，已返回环绕视角';
    this.showToast(message, 2600);
  }

  showFreeViewHint(mode) {
    window.clearTimeout(this.freeHintTimer);
    this.root.querySelector('#movement-hint-label').textContent =
      mode === 'walk' ? '行走' : '移动';
    this.root.querySelector('#vertical-movement-hint').hidden = mode === 'walk';
    this.freeViewHint.classList.add('is-visible');
    this.freeHintTimer = window.setTimeout(() => {
      this.freeViewHint.classList.remove('is-visible');
    }, 5200);
  }

  updateDiscoveryProgress({ collected, total, remaining, completed, chapterComplete, chapterTitle }) {
    this.discoveryCount.textContent = `${collected} / ${total}`;
    this.discoveryProgress.setAttribute('aria-valuemax', String(total));
    this.discoveryProgress.setAttribute('aria-valuenow', String(collected));
    this.discoveryProgressBar.style.transform = `scaleX(${
      total > 0 ? collected / total : 0
    })`;
    this.discoveryObjective.textContent = completed
      ? '潮汐图鉴已完成'
      : chapterComplete ? `${chapterTitle}已完成 · 图鉴中解锁下一章`
      : collected > 0
        ? `${chapterTitle} · 还剩 ${remaining} 处`
        : `${chapterTitle} · 0 / 6`;
    this.discoveryHud.classList.toggle('is-complete', completed);
    this.discoveryReset.hidden = !completed;
  }

  updateDiscoveryFocus({ focused, name, input }) {
    this.discoveryPrompt.classList.toggle('is-visible', focused);
    this.discoveryPrompt.setAttribute('aria-hidden', String(!focused));
    if (!focused) return;

    const isKeyboard = input === 'keyboard';
    this.discoveryPromptKey.hidden = !isKeyboard;
    this.discoveryPromptLabel.textContent = isKeyboard
      ? `拾取 ${name}`
      : `${window.matchMedia('(pointer: coarse)').matches ? '轻触' : '点击'}拾取 ${name}`;
  }

  handleDiscoveryFound({ name, collected, total }) {
    this.showToast(`${name} · ${collected} / ${total}`, 1800);
  }

  handleDiscoveryComplete() {
    this.discoveryPrompt.classList.remove('is-visible');
    this.discoveryPrompt.setAttribute('aria-hidden', 'true');
    this.showToast('潮汐拾光完成 · 海岸记忆已收集', 3000);
  }

  updateBilliardsProgress({
    pocketed,
    total,
    shots,
    fouls,
    completed,
    settled,
    player = 0, players = [], groups = [null, null], down = [], winner = null,
    hand = null, placingCue = false, pending = null, message = '待击球', breaking = false,
    cueTip = { x: 0, y: 0 }, cloth = { sliding: 0.2, rolling: 0.01 },
    canShoot = false, shotPower = 0.55,
  }) {
    this.root.querySelector('#pool-cue-shot').disabled = !canShoot || this.experience?.billiards?.aiming;
    this.root.querySelector('#pool-view-cue').disabled = !settled || placingCue || Boolean(pending) || completed;
    if (!this.experience?.billiards?.aiming) {
      this.root.querySelector('#pool-shot-power').value = Math.round(shotPower * 100);
      this.root.querySelector('#pool-shot-power-output').textContent = `${Math.round(shotPower * 100)}%`;
    }
    const tipLabel = `${cueTip.y > 0.02 ? '高杆' : cueTip.y < -0.02 ? '低杆' : '中杆'}${cueTip.x > 0.02 ? ' · 右塞' : cueTip.x < -0.02 ? ' · 左塞' : ''}`;
    this.root.querySelector('#billiards-tip-label').textContent = tipLabel;
    this.root.querySelector('#pool-tip-description').textContent = tipLabel;
    this.root.querySelector('#billiards-shot-controls').disabled = !settled;
    for (const [id, value, text] of [
      ['pool-tip-x', cueTip.x, `${Math.round(cueTip.x * 100)}%`],
      ['pool-tip-y', cueTip.y, `${Math.round(cueTip.y * 100)}%`],
      ['pool-sliding', cloth.sliding, cloth.sliding.toFixed(3)],
      ['pool-rolling', cloth.rolling, cloth.rolling.toFixed(3)],
    ]) {
      this.root.querySelector(`#${id}`).value = value;
      this.root.querySelector(`#${id}-output`).textContent = text;
    }
    const dot = this.root.querySelector('#pool-tip-dot');
    dot.style.left = `${50 + cueTip.x * 35}%`;
    dot.style.top = `${50 - cueTip.y * 35}%`;
    this.billiardsScore.textContent = `${pocketed} / ${total}`;
    this.billiardsShots.textContent = `${shots} 杆`;
    this.billiardsStatus.textContent = completed ? `玩家 ${winner + 1} 获胜 · ${message}`
      : !settled ? '球在移动'
        : placingCue ? (hand === 'kitchen' ? '线后自由球 · 摆球中' : '全台自由球 · 摆球中')
          : pending ? `玩家 ${player + 1} 选择 · ${message}`
            : `玩家 ${player + 1} · ${breaking ? '开球' : message}`;
    this.billiardsPlayers.replaceChildren(...[0, 1].map((index) => {
      const row = document.createElement('div');
      row.className = `billiards-player${player === index ? ' is-current' : ''}`;
      const label = document.createElement('span');
      label.textContent = `P${index + 1} ${groups[index] === 'solid' ? '全色' : groups[index] === 'stripe' ? '花色' : '开放'}`;
      row.append(label);
      const balls = document.createElement('span');
      balls.className = 'billiards-player__balls';
      const numbers = groups[index] ? (!players[index]?.remaining.length ? [8]
        : Array.from({ length: 7 }, (_, i) => i + (groups[index] === 'solid' ? 1 : 9))) : [];
      numbers.forEach((n) => {
        const ball = document.createElement('span');
        ball.textContent = n;
        ball.className = `pool-number${down.includes(n) ? ' is-down' : ''}${n > 8 ? ' is-stripe' : ''}`;
        ball.style.setProperty('--ball-color', ['#171d24', '#bd9100', '#3062b4', '#bd383a', '#754199', '#c4601b', '#217448', '#813546'][n % 8]);
        ball.title = `${n} 号${down.includes(n) ? '已进袋' : '待击打'}`;
        balls.append(ball);
      });
      row.append(balls);
      return row;
    }));
    const visible = pending === 'illegal-break' ? ['accept', 'rebreak', 'opponent-rebreak']
      : pending === 'break-eight-foul' ? ['accept', 'kitchen']
        : hand && settled && !completed ? [placingCue ? 'confirm' : 'place'] : [];
    this.billiardsActions.querySelectorAll('button').forEach((button) => {
      button.hidden = !visible.includes(button.dataset.poolAction);
    });
    this.billiardsHud.classList.toggle('is-complete', completed);
  }

  updateBilliardsAim({ aiming = false, power = 0 } = {}) {
    const displayedPower = aiming ? power : (this.experience?.billiards?.shotPower ?? 0.55);
    this.root.querySelector('#pool-shot-power').value = Math.round(displayedPower * 100);
    this.root.querySelector('#pool-shot-power-output').textContent = `${Math.round(displayedPower * 100)}%`;
    if (aiming) this.root.querySelector('#pool-cue-shot').disabled = true;
    else this.root.querySelector('#pool-cue-shot').disabled = !this.experience?.billiards?.canAim();
    this.billiardsHud.classList.toggle('is-aiming', aiming);
    this.billiardsPowerBar.style.transform = `scaleX(${Math.max(
      0,
      Math.min(1, power),
    )})`;
  }

  handleBilliardsPocket({ cue, pocketed, total }) {
    this.showToast(
      cue ? '母球落袋 · 等待本杆结算' : `目标球进袋 · ${pocketed} / ${total}`,
      1800,
    );
  }

  handleBilliardsComplete({ shots, winner, message }) {
    this.showToast(`玩家 ${winner + 1} 获胜 · ${message} · 共 ${shots} 杆`, 3000);
  }

  setLoadingProgress(progress) {
    const normalized = Math.max(0, Math.min(1, progress));
    this.startLabel.textContent = `LOADING ${Math.round(normalized * 100)}%`;
  }

  setReady() {
    this.startButton.disabled = false;
    this.startLabel.textContent = 'ENTER';
    this.intro.classList.add('is-visible');
    this.experience.startPreview();
    this.updateQualityText('auto', this.experience.getEffectiveQuality());
    this.updateCameraMode({
      mode: 'orbit',
      locked: false,
      pending: false,
      interactive: false,
      supported: this.experience.supportsFreeCamera(),
    });
  }

  enterScene() {
    this.startButton.disabled = true;
    this.intro.classList.add('is-leaving');
    this.hud.classList.add('is-visible');
    this.hud.setAttribute('aria-hidden', 'false');
    this.experience.enter();

    this.schedule(() => {
      this.intro.hidden = true;
      this.intro.classList.remove('is-visible');
    }, 900);
    if (!this.hasSeenGuide()) {
      this.schedule(() => {
        if (!this.hasSeenGuide() && !this.guideDialog.open) this.openGuide();
      }, 960);
    }
  }

  setPressedGroup(selector, activeButton) {
    this.root.querySelectorAll(selector).forEach((button) => {
      const isActive = button === activeButton;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    });
  }

  updateQualityText(mode, effective) {
    const output = this.root.querySelector('#quality-output');
    const label = this.root.querySelector('#quality-label');
    const modeNames = { auto: '自动', high: '高', low: '低' };
    output.value = mode === 'auto' ? `自动 · ${modeNames[effective]}` : modeNames[mode];
    label.textContent = mode === 'auto' ? `AUTO / ${effective.toUpperCase()}` : mode.toUpperCase();
  }

  updateTideState(tide) {
    if (!tide) return;
    const modeNames = { low: '退潮', auto: '自动', high: '涨潮' };
    const bandNames = { low: '低潮', mid: '中潮', high: '高潮' };
    this.tideOutput.value = `${modeNames[tide.mode]} · ${bandNames[tide.band]}`;
    this.tideLabel.textContent = bandNames[tide.band];
  }

  updateRainState(state) {
    this.rainToggle.checked = Boolean(state?.enabled);
  }

  updateBloomState(state) {
    this.bloomToggle.checked = Boolean(state?.enabled);
  }

  updateFootstepAudioState(state) {
    this.footstepAudioToggle.checked = Boolean(state?.enabled);
  }

  updateBookmarkState(state) {
    if (!state) return;
    this.bookmarkState = state;
    const selected = state.slots?.find(
      (entry) => entry.slot === this.selectedBookmarkSlot,
    );
    const saved = Boolean(selected?.saved);
    this.bookmarkSlotButtons.forEach((button) => {
      const active = Number(button.dataset.bookmarkSlot) === this.selectedBookmarkSlot;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    this.bookmarkOutput.value = `槽位 ${this.selectedBookmarkSlot} · ${saved ? '已保存' : '空'}`;
    this.bookmarkRestore.disabled = !saved;
    this.bookmarkDelete.disabled = !saved;
    const saveLabel = saved ? '覆盖当前构图' : '保存当前构图';
    this.bookmarkSave.setAttribute('aria-label', saveLabel);
    this.bookmarkSave.title = saveLabel;
  }

  bindAssetInput(input, kind, eventOptions) {
    input.addEventListener(
      'change',
      async () => {
        const file = input.files?.[0];
        if (!file) return;
        this.setAssetBusy(true);
        try {
          const state = await this.experience.importLocalAsset(kind, file);
          this.showToast(`${kind === 'model' ? '模型' : '贴图'}已导入 · ${state.name}`, 2400);
        } catch (error) {
          this.showToast(`导入失败 · ${error.message ?? '文件无法读取'}`, 3200);
        } finally {
          input.value = '';
          this.setAssetBusy(false);
        }
      },
      eventOptions,
    );
  }

  setAssetBusy(busy) {
    this.assetImportControl.setAttribute('aria-busy', String(busy));
    this.importModelButton.disabled = busy;
    this.importTextureButton.disabled = busy;
    this.removeAssetButton.disabled = busy || !this.experience?.getDebugState().localAsset?.loaded;
    this.assetTransformReset.disabled = busy;
    this.assetTransformInputs.forEach((input) => {
      input.disabled = busy;
    });
    this.assetAnimationSelect.disabled = busy;
    this.assetAnimationToggle.disabled = busy;
    this.assetAnimationRestart.disabled = busy;
    this.assetAnimationSpeed.disabled = busy;
    if (busy) this.assetOutput.value = '处理中';
  }

  updateAssetState(state) {
    const loaded = Boolean(state?.loaded);
    this.assetOutput.value = loaded
      ? `${state.kind === 'model' ? '模型' : '贴图'} · ${state.name}`
      : '未导入';
    this.assetOutput.title = loaded ? state.name : '';
    this.removeAssetButton.disabled = !loaded;
    this.updateAssetTransform(state?.transform ?? null);
    this.updateAssetAnimation(state?.animation ?? null);
  }

  updateAssetTransform(transform) {
    const available = Boolean(transform);
    this.assetTransformControl.hidden = !available;
    if (!available) return;

    const formatters = {
      x: (value) => value.toFixed(1),
      z: (value) => value.toFixed(1),
      rotation: (value) => `${Math.round(value)}°`,
      scale: (value) => `${value.toFixed(2)}×`,
    };
    this.assetTransformInputs.forEach((input) => {
      const key = input.dataset.assetTransform;
      const value = transform[key];
      input.value = String(value);
      const output = this.root.querySelector(`#${input.dataset.output}`);
      if (output) output.value = formatters[key](value);
    });
  }

  updateAssetAnimation(animation) {
    const available = Boolean(animation?.clips?.length);
    this.assetAnimationControl.hidden = !available;
    if (!available) {
      this.animationClipSignature = '';
      this.assetAnimationSelect.replaceChildren();
      return;
    }

    const signature = animation.clips
      .map((clip) => `${clip.index}:${clip.name}:${clip.duration}`)
      .join('|');
    if (signature !== this.animationClipSignature) {
      this.assetAnimationSelect.replaceChildren(
        ...animation.clips.map((clip) => new Option(clip.name, String(clip.index))),
      );
      this.animationClipSignature = signature;
    }
    this.assetAnimationSelect.value = String(animation.activeIndex);
    this.assetAnimationOutput.value = animation.playing ? '播放中' : '已暂停';
    this.assetAnimationSpeed.value = String(animation.speed);
    this.assetAnimationSpeedOutput.value = `${animation.speed.toFixed(2)}×`;

    const label = animation.playing ? '暂停动画' : '播放动画';
    this.assetAnimationToggle.setAttribute('aria-label', label);
    this.assetAnimationToggle.title = label;
    const icon = this.assetAnimationToggle.querySelector('svg, i');
    if (icon) {
      icon.outerHTML = animation.playing
        ? '<i data-lucide="pause" aria-hidden="true"></i>'
        : '<i data-lucide="play" aria-hidden="true"></i>';
      createIcons({ icons: { Pause, Play } });
    }
  }

  updateCameraMode({
    mode,
    locked,
    pending = false,
    interactive = locked,
    supported,
  }) {
    const freeButton = this.root.querySelector('#camera-mode-button');
    const walkButton = this.root.querySelector('#walk-mode-button');
    const isFree = mode === 'free';
    const isWalk = mode === 'walk';
    const isPointerMode = isFree || isWalk;
    const isInteractive = isPointerMode && Boolean(interactive);
    const configureButton = (button, active, label) => {
      const activePending = active && pending;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
      button.setAttribute(
        'aria-label',
        activePending ? `取消${label}` : active ? `退出${label}` : label,
      );
      button.title = activePending ? `取消${label}` : active ? `退出${label}` : label;
      button.dataset.locked = String(active && Boolean(locked));
      button.dataset.pending = String(activePending);
      button.disabled = !supported;
    };
    configureButton(freeButton, isFree, '自由视角');
    configureButton(walkButton, isWalk, '第一视角漫步');
    this.hud.classList.toggle('is-free-view', isInteractive);
    this.hud.classList.toggle('is-walk-view', isInteractive && isWalk);
    this.hud.classList.toggle('is-free-pending', isPointerMode && pending);
    this.root.querySelector('#camera-label').textContent = pending
      ? 'LOCKING'
      : isWalk
        ? 'WALK'
        : isFree
          ? 'FREE'
          : 'ORBIT';

    if (locked && (!this.cameraWasLocked || this.lastCameraMode !== mode)) {
      this.showFreeViewHint(mode);
    }
    if (!isInteractive) {
      window.clearTimeout(this.freeHintTimer);
      this.freeViewHint.classList.remove('is-visible');
    }
    this.cameraWasLocked = Boolean(locked);
    this.lastCameraMode = mode;
  }

  togglePanel(id) {
    const target = this.root.querySelector(`#${id}`);
    const shouldOpen = target.hidden;
    this.closeAllPanels();
    if (!shouldOpen) return;

    target.hidden = false;
    requestAnimationFrame(() => target.classList.add('is-open'));
    const trigger = this.root.querySelector(`[aria-controls="${id}"]`);
    trigger?.setAttribute('aria-expanded', 'true');
    target.querySelector('button, input')?.focus({ preventScroll: true });
  }

  closePanel(id) {
    const panel = this.root.querySelector(`#${id}`);
    if (!panel || panel.hidden) return;

    panel.classList.remove('is-open');
    this.root.querySelector(`[aria-controls="${id}"]`)?.setAttribute('aria-expanded', 'false');
    this.schedule(() => {
      if (!panel.classList.contains('is-open')) panel.hidden = true;
    }, 280);
  }

  closeAllPanels() {
    this.panels.forEach((panel) => this.closePanel(panel.id));
  }

  async toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      this.showToast('当前浏览器未允许全屏');
    }
  }

  updateFullscreenButton() {
    const button = this.root.querySelector('#fullscreen-button');
    const icon = button.querySelector('svg');
    const isFullscreen = Boolean(document.fullscreenElement);
    button.setAttribute('aria-label', isFullscreen ? '退出全屏' : '进入全屏');
    button.title = isFullscreen ? '退出全屏' : '进入全屏';
    if (icon) {
      icon.outerHTML = isFullscreen
        ? '<i data-lucide="minimize" aria-hidden="true"></i>'
        : '<i data-lucide="maximize" aria-hidden="true"></i>';
      createIcons({ icons: { Maximize, Minimize } });
    }
  }

  showToast(message, duration = 1600) {
    window.clearTimeout(this.toastTimer);
    window.clearTimeout(this.toastHideTimer);
    this.pendingTimers.delete(this.toastTimer);
    this.pendingTimers.delete(this.toastHideTimer);
    this.toast.textContent = message;
    this.toast.hidden = false;
    requestAnimationFrame(() => this.toast.classList.add('is-visible'));
    this.toastTimer = this.schedule(() => {
      this.toast.classList.remove('is-visible');
      this.toastHideTimer = this.schedule(() => {
        this.toast.hidden = true;
      }, 220);
    }, duration);
  }

  showFallback() {
    if (this.guideDialog.open) this.guideDialog.close();
    this.intro.hidden = true;
    this.hud.hidden = true;
    this.root.querySelector('#fallback').hidden = false;
  }

  dispose() {
    this.eventController?.abort();
    this.pendingTimers.forEach((timer) => window.clearTimeout(timer));
    this.pendingTimers.clear();
    window.clearTimeout(this.toastTimer);
    window.clearTimeout(this.toastHideTimer);
    window.clearTimeout(this.freeHintTimer);
  }
}

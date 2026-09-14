import { COLLECTION_CHAPTERS } from '../experience/CollectionCampaign.js';

export class CollectionJournal {
  constructor(experience, signal) {
    this.experience = experience;
    this.dialog = document.querySelector('#collection-dialog');
    this.button = document.querySelector('#collection-open');
    this.select = document.querySelector('#collection-chapter');
    const options = { signal };
    this.button.addEventListener('click', () => {
      if (!experience.discovery) return;
      this.returnFocus = document.activeElement;
      experience.setCameraMode('orbit'); experience.billiards?.cancelAim();
      experience.controls.enabled = false;
      this.select.value = String(experience.discovery.campaign.chapter);
      this.render(); this.dialog.showModal();
      this.button.setAttribute('aria-expanded', 'true');
    }, options);
    this.select.addEventListener('change', () => this.render(), options);
    document.querySelector('#collection-close').addEventListener('click', () => this.dialog.close(), options);
    document.querySelector('#collection-next').addEventListener('click', () => {
      if (experience.discovery.nextChapter()) this.select.value = String(experience.discovery.campaign.chapter);
      this.render();
    }, options);
    document.querySelector('#collection-hint').addEventListener('click', () => {
      const item = experience.discovery.items.find(item => experience.discovery.isAvailable(item));
      if (!item) return;
      this.dialog.close();
      experience.startCameraTween(item.position.clone().add({ x: 3, y: 3, z: 5 }), item.position);
    }, options);
    this.dialog.addEventListener('close', () => {
      experience.controls.enabled = experience.entered && !experience.cameraTween && experience.cameraMode === 'orbit';
      this.button.setAttribute('aria-expanded', 'false');
      (this.returnFocus?.isConnected ? this.returnFocus : this.button).focus({ preventScroll: true });
    }, options);
    experience.addEventListener('discoveryprogress', () => { if (this.dialog.open) this.render(); }, options);
  }

  render() {
    const game = this.experience.discovery, campaign = game.campaign, state = campaign.getState();
    const chapter = Number(this.select.value), spec = COLLECTION_CHAPTERS[chapter];
    document.querySelector('#collection-summary').textContent = `${state.overallCollected} / 18 · ${state.saved ? '已保存在本机' : '本次探索'}`;
    document.querySelector('#collection-description').textContent = spec.description;
    document.querySelector('#collection-badges').textContent = state.badges.length ? state.badges.join(' · ') : '海岸手记';
    const list = document.querySelector('#collection-items'); list.replaceChildren();
    for (const site of campaign.sites[chapter]) {
      const row = document.createElement('li'), name = document.createElement('strong'), detail = document.createElement('span');
      const found = campaign.found.has(site.id);
      name.textContent = site.name;
      detail.textContent = found ? '已记录' : chapter > campaign.chapter ? '前一章完成后解锁' : site.lowTide && (game.tideLevel ?? 0) > -.22 ? '等待低潮 · 潮沟' : site.clue;
      row.classList.toggle('is-found', found); row.append(name, detail); list.append(row);
    }
    const next = document.querySelector('#collection-next');
    next.hidden = !state.chapterComplete || state.completed;
    next.textContent = state.chapter < 2 ? `开始：${COLLECTION_CHAPTERS[state.chapter + 1].title}` : '记录完成';
    const hint = document.querySelector('#collection-hint');
    hint.disabled = !game.items.some(item => game.isAvailable(item));
    hint.hidden = state.chapterComplete;
  }
}

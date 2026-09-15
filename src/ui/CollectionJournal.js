import { COLLECTION_CHAPTERS } from '../experience/CollectionCampaign.js';

export class CollectionJournal {
  constructor(experience, signal) {
    this.experience = experience;
    this.dialog = document.querySelector('#collection-dialog');
    this.button = document.querySelector('#collection-open');
    this.select = document.querySelector('#collection-chapter');
    this.tabs = [...document.querySelectorAll('.collection-tabs [role="tab"]')];
    this.journalPanel = document.querySelector('#collection-journal-panel');
    this.marketPanel = document.querySelector('#collection-market-panel');
    this.marketInventory = document.querySelector('#market-inventory');
    this.marketProducts = document.querySelector('#market-products');
    const options = { signal };
    this.button.addEventListener('click', () => this.open('journal'), options);
    this.tabs.forEach(tab => tab.addEventListener('click', () => this.setTab(tab.id.endsWith('market') ? 'market' : 'journal'), options));
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
    document.querySelector('#market-sell-all').addEventListener('click', () => {
      experience.discovery.sellItems(); this.render();
    }, options);
    this.marketProducts.addEventListener('click', event => {
      const button = event.target.closest('[data-market-product]');
      if (!button) return;
      experience.discovery.buyProduct(button.dataset.marketProduct); this.render();
    }, options);
    this.dialog.addEventListener('close', () => {
      experience.controls.enabled = experience.entered && !experience.cameraTween && experience.cameraMode === 'orbit';
      this.button.setAttribute('aria-expanded', 'false');
      (this.returnFocus?.isConnected ? this.returnFocus : this.button).focus({ preventScroll: true });
    }, options);
    experience.addEventListener('discoveryprogress', () => { if (this.dialog.open) this.render(); }, options);
    experience.addEventListener('marketopen', () => this.open('market'), options);
  }

  open(tab = 'journal') {
    if (!this.experience.discovery) return;
    this.returnFocus = document.activeElement;
    this.experience.setCameraMode('orbit'); this.experience.billiards?.cancelAim();
    this.experience.controls.enabled = false;
    this.select.value = String(this.experience.discovery.campaign.chapter);
    this.setTab(tab); this.render();
    if (!this.dialog.open) this.dialog.showModal();
    this.button.setAttribute('aria-expanded', 'true');
  }

  setTab(tab) {
    const market = tab === 'market';
    this.tabs[0].setAttribute('aria-selected', String(!market));
    this.tabs[1].setAttribute('aria-selected', String(market));
    this.journalPanel.hidden = market; this.marketPanel.hidden = !market;
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
      const mapped = campaign.purchases.has('tide-map')
        ? `距当前位置约 ${Math.round(Math.hypot(this.experience.camera.position.x - site.x, this.experience.camera.position.z - site.z))} 米`
        : site.clue;
      detail.textContent = found ? '已记录' : chapter > campaign.chapter ? '前一章完成后解锁' : site.lowTide && (game.tideLevel ?? 0) > -.22 ? '等待低潮 · 潮沟' : mapped;
      row.classList.toggle('is-found', found); row.append(name, detail); list.append(row);
    }
    const next = document.querySelector('#collection-next');
    next.hidden = !state.chapterComplete || state.completed;
    next.textContent = state.chapter < 2 ? `开始：${COLLECTION_CHAPTERS[state.chapter + 1].title}` : '记录完成';
    const hint = document.querySelector('#collection-hint');
    hint.disabled = !game.items.some(item => game.isAvailable(item));
    hint.hidden = state.chapterComplete;
    this.renderMarket(state.economy);
  }

  renderMarket(economy) {
    document.querySelector('#market-coins').textContent = String(economy.coins);
    const names = { glass: '海玻璃', shell: '空贝壳', bottle: '瓶罐' };
    this.marketInventory.replaceChildren();
    for (const kind of Object.keys(names)) {
      const row = document.createElement('li'), name = document.createElement('strong'), detail = document.createElement('span');
      name.textContent = `${names[kind]} × ${economy.inventory[kind]}`;
      detail.textContent = `每件 ${economy.saleValues[kind]} 枚潮贝`;
      row.append(name, detail); this.marketInventory.append(row);
    }
    document.querySelector('#market-sell-all').disabled = economy.inventoryTotal === 0;
    this.marketProducts.replaceChildren();
    for (const product of economy.products) {
      const row = document.createElement('li'), name = document.createElement('strong'), detail = document.createElement('span'), button = document.createElement('button');
      name.textContent = product.name; detail.textContent = product.description;
      button.type = 'button'; button.dataset.marketProduct = product.id;
      button.textContent = product.purchased ? '已拥有' : `${product.price} 潮贝`;
      button.disabled = product.purchased || !product.affordable;
      row.append(name, detail, button); this.marketProducts.append(row);
    }
  }
}

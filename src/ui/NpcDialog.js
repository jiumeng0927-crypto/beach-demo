export class NpcDialog {
  constructor(experience, signal) {
    this.experience = experience;
    this.dialog = document.querySelector('#npc-dialog');
    this.title = document.querySelector('#npc-title');
    this.role = document.querySelector('#npc-role');
    this.text = document.querySelector('#npc-text');
    this.actions = document.querySelector('#npc-actions');
    this.button = document.querySelector('#npc-button');
    this.signal = signal;
    this.rosterRevision = 0;
    const options = { signal };
    this.button.addEventListener('click', () => this.showRoster(), options);
    document.querySelector('#npc-close').addEventListener('click', () => this.dialog.close(), options);
    this.dialog.addEventListener('close', () => {
      this.rosterRevision++;
      experience.npcs?.close();
      this.button.setAttribute('aria-expanded', 'false');
      (this.returnFocus?.isConnected ? this.returnFocus : this.button).focus({ preventScroll: true });
    }, options);
    // A touch opens the dialog on pointerup; its synthetic click must not close it.
    this.dialog.addEventListener('pointerdown', event => {
      const box = this.dialog.getBoundingClientRect();
      this.backdropPressed = event.target === this.dialog &&
        (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom);
    }, options);
    this.dialog.addEventListener('click', event => {
      if (event.target === this.dialog && this.backdropPressed) this.dialog.close();
      this.backdropPressed = false;
    }, options);
    experience.addEventListener('npcdialogchange', () => this.showConversation(), options);
    experience.addEventListener('discoveryfound', () => {
      if (this.dialog.open && experience.npcs?.activeId) this.showConversation();
    }, options);
  }

  open() {
    if (this.dialog.open) return;
    this.returnFocus = document.activeElement;
    this.experience.setCameraMode('orbit');
    this.experience.billiards?.cancelAim();
    this.experience.controls.enabled = false;
    this.button.setAttribute('aria-expanded', 'true');
    this.dialog.showModal();
  }

  buttons(actions, handler) {
    const restoreActionFocus = this.actions.contains(document.activeElement);
    this.actions.replaceChildren();
    for (const action of actions) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'npc-action';
      button.textContent = action.text; button.dataset.npcAction = action.id;
      button.addEventListener('click', () => handler(action.id));
      this.actions.append(button);
    }
    if (restoreActionFocus) this.actions.firstElementChild?.focus({ preventScroll: true });
  }

  async showRoster() {
    const revision = ++this.rosterRevision;
    this.open();
    this.title.textContent = '海滨相遇'; this.role.textContent = '沿岸';
    this.text.textContent = '正在等待海边的朋友…';
    this.actions.replaceChildren();
    await this.experience.npcs?.ready;
    if (!this.dialog.open || revision !== this.rosterRevision || this.signal.aborted) return;
    const items = this.experience.npcs?.items ?? [];
    this.text.textContent = items.length ? '今天想和谁聊聊？' : '游客暂时未能到达。请刷新后再试。';
    this.buttons(items.map(i => {
      const relationship = this.experience.community?.getRelationship(i.spec.id);
      return { id: i.spec.id, text: `${i.spec.name} · ${i.spec.role} · ${relationship?.label ?? '初次相遇'}` };
    }), id => {
      const npc = items.find(i => i.spec.id === id);
      const target = npc.root.position.clone().add({ x: 0, y: 1, z: 0 });
      this.experience.startCameraTween(target.clone().add({ x: 3.8, y: 2, z: 6.8 }), target);
      this.experience.npcs.open(id);
    });
  }

  showConversation() {
    this.rosterRevision++;
    const conversation = this.experience.npcs?.getConversation();
    if (!conversation) return;
    this.open();
    this.title.textContent = conversation.name; this.role.textContent = conversation.role;
    this.text.textContent = conversation.text;
    this.buttons(conversation.actions, action => {
      const result = this.experience.npcs.perform(action);
      if (result === 'close') this.dialog.close();
      else if (result === 'market') {
        this.dialog.close();
        setTimeout(() => this.experience.dispatchEvent(new Event('marketopen')), 0);
      }
      else if (result === 'commissions') {
        this.dialog.close();
        setTimeout(() => this.experience.dispatchEvent(new Event('commissionopen')), 0);
      }
      else if (result) this.text.textContent = result;
    });
  }
}

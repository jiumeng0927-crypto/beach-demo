export const COMMISSION_SAVE_KEY = 'tideline.commissions.v1';

export const COASTAL_COMMISSIONS = Object.freeze([
  Object.freeze({ id: 'tide-watch', title: '低潮巡查', description: '等潮位进入低潮带，记录一次岸线变化。', trigger: 'low-tide', target: 1, reward: 10 }),
  Object.freeze({ id: 'sand-break', title: '沙滩热身', description: '在中式八球桌完成两次有效击球。', trigger: 'billiards-shot', target: 2, reward: 12 }),
  Object.freeze({ id: 'sunset-frame', title: '暮色构图', description: '黄昏时保存一个相机收藏机位。', trigger: 'sunset-bookmark', target: 1, reward: 14 }),
  Object.freeze({ id: 'shore-clean', title: '潮线拾遗', description: '拾取两件海岸标本或废弃物。', trigger: 'collect-item', target: 2, reward: 12 }),
  Object.freeze({ id: 'market-delivery', title: '小铺交付', description: '向潮岸小铺出售两件拾取物。', trigger: 'sell-item', target: 2, reward: 14 }),
  Object.freeze({ id: 'rain-patrol', title: '雨中巡岸', description: '下雨时以漫步视角移动十五秒。', trigger: 'rain-walk-second', target: 15, reward: 16 }),
  Object.freeze({ id: 'pocket-practice', title: '落袋练习', description: '在球局中打进一颗目标球。', trigger: 'billiards-pocket', target: 1, reward: 18 }),
  Object.freeze({ id: 'local-customer', title: '海滨来客', description: '从潮岸小铺兑换一件海岸用品。', trigger: 'buy-item', target: 1, reward: 10 }),
]);

const DAILY_ROTATIONS = Object.freeze([
  Object.freeze(['tide-watch', 'sand-break', 'sunset-frame']),
  Object.freeze(['shore-clean', 'market-delivery', 'rain-patrol']),
  Object.freeze(['pocket-practice', 'local-customer', 'tide-watch']),
]);

const DEFINITIONS = new Map(COASTAL_COMMISSIONS.map(task => [task.id, task]));

function normalizeDay(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

export class CoastalCommissionBoard extends EventTarget {
  constructor({ storage = null, grantReward = () => true } = {}) {
    super();
    this.storage = storage;
    this.grantReward = grantReward;
    this.day = 0;
    this.progress = new Map();
    this.claimed = new Set();
    this.saved = false;
    this.restore();
  }

  getTaskIds(day = this.day) {
    return DAILY_ROTATIONS[normalizeDay(day) % DAILY_ROTATIONS.length];
  }

  restore() {
    try {
      const save = JSON.parse(this.storage?.getItem(COMMISSION_SAVE_KEY) ?? 'null');
      if (save?.version !== 1 || !Number.isInteger(save.day) || save.day < 0) return;
      this.day = save.day;
      const active = new Set(this.getTaskIds());
      const savedClaims = Array.isArray(save.claimed) ? save.claimed : [];
      for (const id of active) {
        const task = DEFINITIONS.get(id);
        const value = Number(save.progress?.[id]);
        if (Number.isFinite(value) && value > 0) {
          this.progress.set(id, Math.min(task.target, Math.floor(value)));
        }
        if (savedClaims.includes(id) && this.progress.get(id) === task.target) {
          this.claimed.add(id);
        }
      }
      this.saved = true;
    } catch { /* Invalid or unavailable local storage must not block the scene. */ }
  }

  syncDay(day) {
    const nextDay = normalizeDay(day);
    if (nextDay === this.day) return false;
    this.day = nextDay;
    this.progress.clear();
    this.claimed.clear();
    this.persist();
    this.dispatchChange('rotate');
    return true;
  }

  record(trigger, amount = 1) {
    const increment = Math.max(0, Math.floor(Number(amount) || 0));
    if (!increment) return false;
    let changed = false;
    for (const id of this.getTaskIds()) {
      const task = DEFINITIONS.get(id);
      if (task.trigger !== trigger || this.claimed.has(id)) continue;
      const current = this.progress.get(id) ?? 0;
      const next = Math.min(task.target, current + increment);
      if (next === current) continue;
      this.progress.set(id, next);
      changed = true;
    }
    if (!changed) return false;
    this.persist();
    this.dispatchChange('progress');
    return true;
  }

  claim(id) {
    const task = DEFINITIONS.get(id);
    if (!task || !this.getTaskIds().includes(id) || this.claimed.has(id)
      || (this.progress.get(id) ?? 0) < task.target) return null;
    const reward = this.grantReward(task.reward, task);
    if (reward === false || reward == null) return null;
    this.claimed.add(id);
    this.persist();
    const detail = { id, reward: task.reward, state: this.getState() };
    this.dispatchEvent(new CustomEvent('reward', { detail }));
    this.dispatchChange('claim');
    return detail;
  }

  persist() {
    try {
      this.storage?.setItem(COMMISSION_SAVE_KEY, JSON.stringify({
        version: 1,
        day: this.day,
        progress: Object.fromEntries(this.progress),
        claimed: [...this.claimed],
      }));
      this.saved = Boolean(this.storage);
    } catch { this.saved = false; }
  }

  dispatchChange(reason) {
    this.dispatchEvent(new CustomEvent('change', {
      detail: { reason, ...this.getState() },
    }));
  }

  getState() {
    const tasks = this.getTaskIds().map(id => {
      const task = DEFINITIONS.get(id);
      const progress = this.progress.get(id) ?? 0;
      return { ...task, progress, complete: progress >= task.target, claimed: this.claimed.has(id) };
    });
    return {
      day: this.day,
      rotation: this.day % DAILY_ROTATIONS.length,
      tasks,
      completed: tasks.filter(task => task.complete).length,
      claimed: tasks.filter(task => task.claimed).length,
      total: tasks.length,
      saved: this.saved,
    };
  }
}

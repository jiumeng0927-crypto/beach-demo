export const COMMUNITY_SAVE_KEY = 'tideline.community.v1';

export const COMMUNITY_LEVELS = Object.freeze([
  Object.freeze({ min: 0, title: '初来海岸', orderBonus: 0 }),
  Object.freeze({ min: 4, title: '熟面孔', orderBonus: 2 }),
  Object.freeze({ min: 10, title: '海岸帮手', orderBonus: 4 }),
  Object.freeze({ min: 18, title: '潮岸伙伴', orderBonus: 6 }),
]);

const KIND_NAMES = Object.freeze({ glass: '海玻璃', shell: '空贝壳', bottle: '瓶罐' });
const ORDERS = Object.freeze([
  Object.freeze({ id: 'lin-glass', npcId: 'lin', npcName: '小林', kind: 'glass', count: 2, reward: 20, title: '拾光配色' }),
  Object.freeze({ id: 'ning-shell', npcId: 'ning', npcName: '宁宁', kind: 'shell', count: 2, reward: 16, title: '潮池陈列' }),
  Object.freeze({ id: 'ran-bottle', npcId: 'ran', npcName: '阿冉', kind: 'bottle', count: 3, reward: 16, title: '净滩清点' }),
  Object.freeze({ id: 'yu-glass', npcId: 'yu', npcName: '小屿', kind: 'glass', count: 3, reward: 28, title: '小铺橱窗' }),
  Object.freeze({ id: 'qing-shell', npcId: 'qing', npcName: '青青', kind: 'shell', count: 1, reward: 9, title: '咖啡桌摆件' }),
  Object.freeze({ id: 'fan-bottle', npcId: 'fan', npcName: '小帆', kind: 'bottle', count: 2, reward: 12, title: '步道回收' }),
  Object.freeze({ id: 'mei-glass', npcId: 'mei', npcName: '阿梅', kind: 'glass', count: 1, reward: 11, title: '杯畔拾光' }),
  Object.freeze({ id: 'hao-shell', npcId: 'hao', npcName: '阿浩', kind: 'shell', count: 3, reward: 22, title: '冲浪架装饰' }),
  Object.freeze({ id: 'le-bottle', npcId: 'le', npcName: '小乐', kind: 'bottle', count: 1, reward: 7, title: '旅途轻装' }),
]);

const DAILY_ORDERS = Object.freeze([
  Object.freeze(['lin-glass', 'ning-shell', 'ran-bottle']),
  Object.freeze(['yu-glass', 'qing-shell', 'fan-bottle']),
  Object.freeze(['mei-glass', 'hao-shell', 'le-bottle']),
]);
const ORDER_MAP = new Map(ORDERS.map(order => [order.id, order]));

function safeDay(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

export class CoastalCommunity extends EventTarget {
  constructor({ storage = null, npcIds = [], fulfillOrder = () => null } = {}) {
    super();
    this.storage = storage;
    this.npcIds = new Set(npcIds);
    this.fulfillOrder = fulfillOrder;
    this.day = 0;
    this.relationships = new Map();
    this.greetedToday = new Set();
    this.fulfilled = new Map();
    this.saved = false;
    this.restore();
  }

  restore() {
    try {
      const save = JSON.parse(this.storage?.getItem(COMMUNITY_SAVE_KEY) ?? 'null');
      if (save?.version !== 1 || !Number.isInteger(save.day) || save.day < 0) return;
      this.day = save.day;
      if (save.relationships && typeof save.relationships === 'object') {
        for (const [id, value] of Object.entries(save.relationships)) {
          if (!this.npcIds.has(id)) continue;
          const affinity = Math.max(0, Math.min(12, Math.floor(Number(value) || 0)));
          if (affinity) this.relationships.set(id, affinity);
        }
      }
      const activeOrders = new Set(this.getOrderIds());
      if (Array.isArray(save.greetedToday)) {
        save.greetedToday.forEach(id => { if (this.npcIds.has(id)) this.greetedToday.add(id); });
      }
      if (save.fulfilled && typeof save.fulfilled === 'object') {
        for (const [id, reward] of Object.entries(save.fulfilled)) {
          if (!activeOrders.has(id)) continue;
          const value = Number(reward);
          if (Number.isFinite(value) && value >= 0) this.fulfilled.set(id, Math.floor(value));
        }
      }
      this.saved = true;
    } catch { /* Community progress is optional when storage is unavailable. */ }
  }

  getOrderIds(day = this.day) {
    return DAILY_ORDERS[safeDay(day) % DAILY_ORDERS.length];
  }

  syncDay(day) {
    const next = safeDay(day);
    if (next === this.day) return false;
    this.day = next;
    this.greetedToday.clear();
    this.fulfilled.clear();
    this.persist();
    this.dispatchChange('rotate');
    return true;
  }

  meet(npcId) {
    if (!this.npcIds.has(npcId) || this.greetedToday.has(npcId)) return false;
    this.greetedToday.add(npcId);
    this.addAffinity(npcId, 1);
    this.persist();
    this.dispatchChange('meet');
    return true;
  }

  fulfill(id, inventory = {}) {
    const order = ORDER_MAP.get(id);
    if (!order || !this.getOrderIds().includes(id) || this.fulfilled.has(id)
      || (Number(inventory[order.kind]) || 0) < order.count) return null;
    const reward = order.reward + this.getLevel().orderBonus;
    const transaction = this.fulfillOrder({ ...order, reward });
    if (!transaction) return null;
    const paid = Number.isFinite(transaction.earned)
      ? Math.max(0, Math.floor(transaction.earned))
      : reward;
    this.fulfilled.set(id, paid);
    this.addAffinity(order.npcId, 2);
    this.persist();
    const detail = { order: { ...order, reward }, transaction, state: this.getState(inventory) };
    this.dispatchEvent(new CustomEvent('fulfilled', { detail }));
    this.dispatchChange('fulfill');
    return detail;
  }

  addAffinity(npcId, amount) {
    const current = this.relationships.get(npcId) ?? 0;
    this.relationships.set(npcId, Math.min(12, current + amount));
  }

  getReputation() {
    return [...this.relationships.values()].reduce((total, value) => total + value, 0);
  }

  getLevel() {
    const reputation = this.getReputation();
    return [...COMMUNITY_LEVELS].reverse().find(level => reputation >= level.min);
  }

  getRelationship(npcId) {
    const affinity = this.relationships.get(npcId) ?? 0;
    const label = affinity >= 8 ? '亲近伙伴' : affinity >= 4 ? '熟悉朋友' : affinity >= 1 ? '见过几面' : '初次相遇';
    return { affinity, label, greetedToday: this.greetedToday.has(npcId) };
  }

  getOrderForNpc(npcId, inventory = {}) {
    return this.getState(inventory).orders.find(order => order.npcId === npcId) ?? null;
  }

  persist() {
    try {
      this.storage?.setItem(COMMUNITY_SAVE_KEY, JSON.stringify({
        version: 1,
        day: this.day,
        relationships: Object.fromEntries(this.relationships),
        greetedToday: [...this.greetedToday],
        fulfilled: Object.fromEntries(this.fulfilled),
      }));
      this.saved = Boolean(this.storage);
    } catch { this.saved = false; }
  }

  dispatchChange(reason) {
    this.dispatchEvent(new CustomEvent('change', { detail: { reason, ...this.getState() } }));
  }

  getState(inventory = {}) {
    const reputation = this.getReputation();
    const level = this.getLevel();
    const nextLevel = COMMUNITY_LEVELS.find(item => item.min > reputation) ?? null;
    const orders = this.getOrderIds().map(id => {
      const order = ORDER_MAP.get(id);
      const fulfilled = this.fulfilled.has(id);
      return {
        ...order,
        kindName: KIND_NAMES[order.kind],
        reward: this.fulfilled.get(id) ?? order.reward + level.orderBonus,
        available: !fulfilled && (Number(inventory[order.kind]) || 0) >= order.count,
        fulfilled,
      };
    });
    return {
      day: this.day,
      reputation,
      level: level.title,
      orderBonus: level.orderBonus,
      nextLevelAt: nextLevel?.min ?? null,
      orders,
      completed: orders.filter(order => order.fulfilled).length,
      total: orders.length,
      relationships: Object.fromEntries([...this.npcIds].map(id => [id, this.getRelationship(id)])),
      saved: this.saved,
    };
  }
}

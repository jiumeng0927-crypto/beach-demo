export const COLLECTION_SAVE_KEY = 'tideline.collection.v1';
export const COLLECTION_CHAPTERS = Object.freeze([
  { id: 'glass', title: '海玻璃标本', badge: '潮纹记录员', description: '六枚被海浪磨圆的海玻璃，记录不同的岸线。' },
  { id: 'shell', title: '退潮贝壳', badge: '潮间带观察者', description: '收集空贝壳标本。靠近潮沟的三枚只有退潮后才会露出。' },
  { id: 'bottle', title: '海岸清理', badge: '净滩守护者', description: '带走六只废弃瓶罐，让潮水只带回海岸的记忆。' },
]);
const ADDITIONAL_SITES = [
  [[-13, 10], [-24, 9], [14, 9.5], [23, 20], [-17, 23], [28, 34]],
  [[3, 17], [-4, 24], [23, 28], [-25, 20], [31, 31], [-12, 32]],
];
const NAMES = [['扇贝壳', '月牙贝壳', '潮沟贝壳', '船旁贝壳', '礁岸贝壳', '沙丘贝壳'],
  ['潮线塑料瓶', '步道饮料罐', '球场塑料瓶', '礁岸空罐', '沙丘饮料瓶', '休息区空罐']];
const CLUES = ['近岸的潮纹之间', '西侧漂木附近', '西侧礁石的内侧', '西侧休息区', '东侧小船附近', '东侧沙丘'];

export class CollectionCampaign {
  constructor(glassSites, storage = null) {
    this.storage = storage;
    this.chapter = 0; this.found = new Set(); this.rewardClaimed = false; this.saved = false;
    this.sites = [glassSites.map((site, i) => ({ ...site, kind: 'glass', clue: CLUES[i] })),
      ...ADDITIONAL_SITES.map((positions, chapter) => positions.map(([x, z], i) => ({
        id: `${COLLECTION_CHAPTERS[chapter + 1].id}-${i}`, kind: COLLECTION_CHAPTERS[chapter + 1].id,
        name: NAMES[chapter][i], x, z, lowTide: chapter === 0 && i < 3,
        color: chapter === 0 ? ['#e7c9b8', '#d9ded6', '#bf9f90'][i % 3] : ['#9bbdb3', '#acb8b7', '#c88776'][i % 3],
        scale: [1, 1, 1], clue: chapter === 0 && i < 3 ? '低潮露出的近岸潮沟' : (x < 0 ? '西侧干沙与休息区' : '东侧船区与沙丘'),
      })))];
    try {
      const save = JSON.parse(storage?.getItem(COLLECTION_SAVE_KEY) ?? 'null');
      if (save?.version === 1 && Array.isArray(save.found)) {
        // Reject unknown ids and impossible progress across locked chapters.
        for (let chapter = 0; chapter < this.sites.length; chapter++) {
          if (chapter && !this.sites[chapter - 1].every(site => this.found.has(site.id))) break;
          this.sites[chapter].forEach(site => { if (save.found.includes(site.id)) this.found.add(site.id); });
        }
        this.chapter = Number.isInteger(save.chapter) ? Math.max(0, Math.min(2, save.chapter)) : 0;
        while (this.chapter && !this.sites[this.chapter - 1].every(site => this.found.has(site.id))) this.chapter--;
        this.rewardClaimed = this.found.size === 18 && save.rewardClaimed === true;
        this.saved = true;
      }
    } catch { /* Private browsing or an invalid save must not block the beach. */ }
  }
  collect(index, tideLevel) {
    const site = this.sites[this.chapter][index];
    if (!site || this.found.has(site.id) || (site.lowTide && (!Number.isFinite(tideLevel) || tideLevel > -.22))) return false;
    this.found.add(site.id); this.persist(); return true;
  }
  next() {
    if (this.chapter === 2 || !this.sites[this.chapter].every(site => this.found.has(site.id))) return false;
    this.chapter++; this.persist(); return true;
  }
  reset() { this.chapter = 0; this.found.clear(); this.rewardClaimed = false; this.persist(); }
  persist() {
    try {
      this.storage?.setItem(COLLECTION_SAVE_KEY, JSON.stringify({ version: 1, chapter: this.chapter,
        found: [...this.found], rewardClaimed: this.rewardClaimed }));
      this.saved = Boolean(this.storage);
    } catch { this.saved = false; }
  }
  getState() {
    const collected = this.sites[this.chapter].filter(site => this.found.has(site.id)).length;
    return { chapter: this.chapter, chapterTitle: COLLECTION_CHAPTERS[this.chapter].title,
      collected, total: 6, remaining: 6 - collected, chapterComplete: collected === 6,
      completed: this.found.size === 18, overallCollected: this.found.size, overallTotal: 18,
      badges: COLLECTION_CHAPTERS.filter((_, i) => this.sites[i].every(site => this.found.has(site.id))).map(c => c.badge),
      saved: this.saved };
  }
}

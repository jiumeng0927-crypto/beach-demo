export const ballGroup = (number) => number >= 1 && number <= 7
  ? 'solid' : number >= 9 && number <= 15 ? 'stripe' : null;

// Rule state consumes one settled shot, independent of the rendering/physics engine.
export class ChineseEightBallRules {
  constructor() { this.reset(); }

  reset(breaker = 0, warnedBreaker = null) {
    this.player = breaker;
    this.breaker = breaker;
    this.warnedBreaker = warnedBreaker;
    this.groups = [null, null];
    this.down = new Set();
    this.breaking = true;
    this.hand = 'kitchen';
    this.pending = null;
    this.winner = null;
    this.fouls = 0;
    this.message = `玩家 ${breaker + 1} 开球`;
  }

  remaining(player = this.player) {
    const group = this.groups[player];
    if (!group) return [];
    return Array.from({ length: 15 }, (_, i) => i + 1)
      .filter((n) => ballGroup(n) === group && !this.down.has(n));
  }

  legalFirst(number) {
    if (this.breaking) return number > 0;
    if (!this.groups[this.player]) return Boolean(ballGroup(number));
    return this.remaining().length === 0 ? number === 8
      : ballGroup(number) === this.groups[this.player];
  }

  settle({ first = null, pocketed = [], rails = [], railAfterContact = false,
    kitchenViolation = false, offTable = [] }) {
    if (this.winner !== null || this.pending) return { respot: [] };
    const shooter = this.player;
    const opponent = 1 - shooter;
    const couldPlayEight = Boolean(this.groups[shooter]) && this.remaining().length === 0;
    const firstLegal = this.legalFirst(first);
    const wasBreak = this.breaking;
    const eight = pocketed.includes(8) || offTable.includes(8);
    const targets = pocketed.filter((n) => n > 0);
    let reason = pocketed.includes(0) ? '母球落袋'
      : offTable.length ? '球离开台面'
        : !firstLegal ? (first === null ? '未击中目标球' : '首碰球错误')
          : kitchenViolation ? '线后自由球越线前击球' : null;
    if (!wasBreak && !reason && !targets.length && !railAfterContact) reason = '击球后无进球且未碰库';
    const weakBreak = wasBreak && !targets.length && new Set(rails.filter((n) => n > 0)).size < 4;
    if (weakBreak && !reason) reason = '开球不足四颗目标球碰库';
    [...targets, ...offTable].filter((n) => n > 0).forEach((n) => this.down.add(n));
    this.hand = null;
    this.breaking = false;
    this.message = reason || '待击球';
    if (reason) this.fouls += 1;

    if ((!wasBreak && eight) || offTable.includes(8)) {
      this.winner = !reason && couldPlayEight && !offTable.includes(8) ? shooter : opponent;
      this.message = this.winner === shooter ? '合法打进黑八' : reason || '提前打进黑八';
      return { respot: [] };
    }

    const respot = wasBreak && eight ? [8] : [];
    respot.forEach((n) => this.down.delete(n));
    if (wasBreak && reason) {
      this.player = opponent;
      if (weakBreak && this.warnedBreaker === shooter) {
        this.winner = opponent;
        this.message = '受警告后再次开球不足四球碰库';
      } else if (weakBreak) {
        this.pending = 'illegal-break';
      } else if (eight) {
        this.pending = pocketed.includes(0) || offTable.includes(0) ? null : 'break-eight-foul';
        this.hand = this.pending ? null : 'kitchen';
      } else this.hand = 'kitchen';
    } else if (reason) {
      this.player = opponent;
      this.hand = 'table';
    } else if (wasBreak) {
      if (!targets.length) this.player = opponent;
      this.message = '开放球局';
    } else if (!this.groups[shooter]) {
      const firstGroup = ballGroup(first);
      if (targets.some((n) => ballGroup(n) === firstGroup)) {
        this.groups[shooter] = firstGroup;
        this.groups[opponent] = firstGroup === 'solid' ? 'stripe' : 'solid';
        this.message = '球组已确定';
      } else {
        this.player = opponent;
        this.message = '开放球局';
      }
    } else if (!targets.some((n) => ballGroup(n) === this.groups[shooter])) {
      this.player = opponent;
    }
    return { respot };
  }

  choose(action) {
    if (this.pending === 'illegal-break') {
      if (action === 'accept') {
        this.pending = null;
        this.hand = 'table';
      } else if (action === 'rebreak' || action === 'opponent-rebreak') {
        const breaker = action === 'rebreak' ? this.player : this.breaker;
        const warned = action === 'opponent-rebreak' ? this.breaker : null;
        this.reset(breaker, warned);
        return { rerack: true };
      } else return null;
    } else if (this.pending === 'break-eight-foul') {
      if (!['accept', 'kitchen'].includes(action)) return null;
      this.pending = null;
      this.hand = action === 'kitchen' ? 'kitchen' : null;
    } else return null;
    this.message = this.hand ? '自由球' : '待击球';
    return { rerack: false };
  }

  snapshot() {
    return {
      player: this.player, groups: [...this.groups], down: [...this.down],
      breaking: this.breaking, hand: this.hand, pending: this.pending,
      winner: this.winner, message: this.message,
      players: [0, 1].map((p) => ({ group: this.groups[p], remaining: this.remaining(p) })),
    };
  }
}

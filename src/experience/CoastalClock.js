export const PERIOD_HOURS = Object.freeze({ dawn: 6, day: 12, sunset: 18, night: 21 });
export const DAY_CYCLE_SECONDS = 1800;
const KEYS = [[0, 'night'], [6, 'dawn'], [12, 'day'], [18, 'sunset'], [21, 'night'], [24, 'night']];

export class CoastalClock {
  constructor() { this.hour = 12; this.running = true; this.days = 0; }
  seek(period) {
    if (!(period in PERIOD_HOURS)) return false;
    this.hour = PERIOD_HOURS[period]; return true;
  }
  update(seconds) {
    if (!this.running || !Number.isFinite(seconds) || seconds <= 0) return;
    const next = this.hour + seconds * 24 / DAY_CYCLE_SECONDS;
    this.days += Math.floor(next / 24); this.hour = next % 24;
  }
  sample() {
    const i = KEYS.findIndex((key, index) => index < KEYS.length - 1 && this.hour >= key[0] && this.hour < KEYS[index + 1][0]);
    const [start, from] = KEYS[i], [end, to] = KEYS[i + 1];
    const t = (this.hour - start) / (end - start);
    return { from, to, blend: t * t * (3 - 2 * t) };
  }
  getState() {
    const minutes = Math.floor(this.hour * 60);
    return { running: this.running, hour: this.hour, days: this.days, cycleSeconds: DAY_CYCLE_SECONDS,
      label: `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}` };
  }
}

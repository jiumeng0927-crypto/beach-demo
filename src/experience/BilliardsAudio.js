import { assetUrl } from './assetUrl.js';

export const IMPACT_PROFILES = Object.freeze({
  cue: { duration: 0.10, cutoff: 3800, decay: 20, gain: 0.76 },
  ball: { duration: 0.16, cutoff: 14000, decay: 5, gain: 0.90 },
  rail: { duration: 0.12, cutoff: 650, decay: 24, gain: 0.48 },
  pocket: { duration: 0.23, cutoff: 1400, decay: 12, gain: 0.60 },
});

// Derivatives of the credited ball recording, not four separate field recordings.
export function createImpactSamples(type, sampleRate, recording) {
  const profile = IMPACT_PROFILES[type];
  if (!profile || !Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000
    || !recording?.length || !recording.every(Number.isFinite)) return new Float32Array();
  let peak = 0;
  for (const sample of recording) peak = Math.max(peak, Math.abs(sample));
  if (peak < 0.0001) return new Float32Array();
  const onset = Math.max(0, recording.findIndex(sample => Math.abs(sample) > peak * 0.02) - Math.floor(sampleRate * 0.001));
  const samples = new Float32Array(Math.ceil(sampleRate * profile.duration));
  const alpha = 1 - Math.exp(-2 * Math.PI * profile.cutoff / sampleRate);
  let low = 0, dc = 0, outputPeak = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    low += alpha * ((recording[onset + i] ?? 0) - low);
    dc += (1 - Math.exp(-2 * Math.PI * 60 / sampleRate)) * (low - dc);
    samples[i] = (low - dc) * Math.exp(-t * profile.decay)
      * Math.min(1, t / 0.0005) * Math.min(1, (profile.duration - t) / 0.012);
    outputPeak = Math.max(outputPeak, Math.abs(samples[i]));
  }
  if (outputPeak > 0) for (let i = 0; i < samples.length; i++) samples[i] *= profile.gain / outputPeak;
  return samples;
}

export class BilliardsAudio {
  constructor({ contextFactory = () => {
    const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    return Context ? new Context({ latencyHint: 'interactive' }) : null;
  }, fetchAudio = (...args) => fetch(...args) } = {}) {
    this.contextFactory = contextFactory;
    this.fetchAudio = fetchAudio;
    this.loading = null;
    this.loadController = null;
    this.context = null;
    this.master = null;
    this.compressor = null;
    this.buffers = new Map();
    this.voices = new Set();
    this.enabled = true;
    this.volume = 0.65;
    this.disposed = false;
    this.hidden = false;
    this.counts = { cue: 0, ball: 0, rail: 0, pocket: 0 };
    this.skipped = 0;
    this.lastError = null;
  }

  async unlock() {
    if (this.disposed || !this.enabled || this.hidden) return false;
    try {
      if (!this.context) {
        this.context = this.contextFactory();
        if (!this.context) return false;
        this.master = this.context.createGain();
        this.master.gain.value = this.volume * 0.45;
        this.compressor = this.context.createDynamicsCompressor();
        this.compressor.threshold.value = -12; this.compressor.knee.value = 6;
        this.compressor.ratio.value = 12; this.compressor.attack.value = 0.001;
        this.compressor.release.value = 0.08;
        this.master.connect(this.compressor); this.compressor.connect(this.context.destination);
      }
      if (this.context.state === 'suspended') await this.context.resume();
      if (this.disposed) return false;
      if (!this.buffers.size) {
        this.loading ??= this.loadRecording().finally(() => { this.loading = null; });
        await this.loading;
      }
      this.lastError = null;
      return !this.disposed && this.enabled && !this.hidden && this.context.state === 'running';
    } catch (error) {
      this.lastError = error?.message ?? error?.name ?? 'audio-unavailable';
      return false;
    }
  }

  async loadRecording() {
    const context = this.context, controller = new AbortController();
    this.loadController = controller;
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await this.fetchAudio(assetUrl('audio/billiards/ball-clack.mp3'), { signal: controller.signal });
      if (!response.ok) throw new Error(`audio-http-${response.status}`);
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > 256000) throw new Error('audio-too-large');
      const recording = await context.decodeAudioData(bytes);
      if (this.disposed) return;
      if (controller.signal.aborted) throw new Error('audio-timeout');
      const prepared = new Map();
      for (const type of Object.keys(IMPACT_PROFILES)) {
        const data = createImpactSamples(type, context.sampleRate, recording.getChannelData(0));
        if (!data.length) throw new Error('audio-empty');
        const buffer = context.createBuffer(1, data.length, context.sampleRate);
        buffer.getChannelData(0).set(data);
        prepared.set(type, buffer);
      }
      this.buffers = prepared;
    } finally {
      clearTimeout(timeout);
      if (this.loadController === controller) this.loadController = null;
    }
  }

  setSettings({ enabled = this.enabled, volume = this.volume } = {}) {
    if (this.disposed) return this.getState();
    this.enabled = Boolean(enabled);
    if (Number.isFinite(volume)) this.volume = Math.max(0, Math.min(1, volume));
    if (this.master && this.context.state !== 'closed') {
      this.master.gain.setValueAtTime(this.enabled ? this.volume * 0.45 : 0, this.context.currentTime);
    }
    if (!this.enabled || !this.volume) this.stopVoices();
    return this.getState();
  }

  play(type, { speed = 1, pan = 0, distance = 0 } = {}) {
    if (!IMPACT_PROFILES[type] || !Number.isFinite(speed) || speed < 0.035
      || !this.enabled || !this.volume || this.hidden || this.disposed
      || this.context?.state !== 'running' || !this.buffers.has(type) || this.voices.size >= 12) {
      this.skipped++;
      return false;
    }
    const context = this.context, source = context.createBufferSource();
    const gain = context.createGain(), panner = context.createStereoPanner();
    const attenuation = 1 / (1 + Math.max(0, Number.isFinite(distance) ? distance - 3 : 0) * 0.12);
    gain.gain.value = Math.min(0.9, 0.12 + Math.sqrt(speed / 9) * 0.78) * attenuation;
    panner.pan.value = Math.max(-0.85, Math.min(0.85, Number.isFinite(pan) ? pan : 0));
    source.buffer = this.buffers.get(type);
    source.playbackRate.value = type === 'rail' ? 0.82 : type === 'pocket' ? 0.78 : 1;
    source.connect(gain); gain.connect(panner); panner.connect(this.master);
    const voice = { source, gain, panner };
    this.voices.add(voice);
    source.onended = () => {
      source.disconnect(); gain.disconnect(); panner.disconnect();
      this.voices.delete(voice);
    };
    source.start();
    this.counts[type]++;
    return true;
  }

  stopVoices() {
    for (const { source, gain, panner } of this.voices) {
      source.onended = null;
      try { source.stop(); } catch { /* Already ended. */ }
      source.disconnect(); gain.disconnect(); panner.disconnect();
    }
    this.voices.clear();
  }

  setHidden(hidden) {
    this.hidden = Boolean(hidden);
    if (this.hidden) this.stopVoices();
  }

  getState() {
    return { enabled: this.enabled, volume: this.volume, state: this.context?.state ?? 'not-created',
      voices: this.voices.size, buffers: this.buffers.size, counts: { ...this.counts },
      skipped: this.skipped, lastError: this.lastError, loading: Boolean(this.loading),
      source: 'cc0-recording', disposed: this.disposed };
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.loadController?.abort();
    this.enabled = false;
    this.stopVoices(); this.master?.disconnect(); this.compressor?.disconnect(); this.buffers.clear();
    try { if (this.context?.state !== 'closed') await this.context?.close(); } catch { /* Document teardown. */ }
  }
}

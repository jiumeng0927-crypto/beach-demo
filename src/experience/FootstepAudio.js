const DEFAULT_STRIDE = 1.05;
const SPRINT_STRIDE = 1.3;
const TELEPORT_DISTANCE = 2.5;

function createDefaultContext() {
  const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  return AudioContextClass ? new AudioContextClass({ latencyHint: 'interactive' }) : null;
}

function setParam(param, value, time) {
  if (typeof param?.setValueAtTime === 'function') {
    param.setValueAtTime(value, time);
  } else if (param) {
    param.value = value;
  }
}

function rampParam(param, value, time) {
  if (typeof param?.exponentialRampToValueAtTime === 'function') {
    param.exponentialRampToValueAtTime(Math.max(0.0001, value), time);
  } else {
    setParam(param, value, time);
  }
}

/**
 * Synthesizes short sand and timber footsteps after the user opts in.
 * No AudioContext, buffers, or nodes exist while the default setting is off.
 */
export class FootstepAudio {
  constructor({ contextFactory = createDefaultContext } = {}) {
    this.contextFactory = contextFactory;
    this.context = null;
    this.masterGain = null;
    this.noiseBuffer = null;
    this.enabled = false;
    this.disposed = false;
    this.lastX = null;
    this.lastZ = null;
    this.distanceAccumulator = 0;
    this.currentStride = DEFAULT_STRIDE;
    this.steps = 0;
    this.sandSteps = 0;
    this.woodSteps = 0;
    this.skippedSteps = 0;
    this.resumeFailures = 0;
    this.lastSurface = null;
    this.lastError = null;
    this.randomState = 0x7f4a7c15;
  }

  random() {
    this.randomState = (1664525 * this.randomState + 1013904223) >>> 0;
    return this.randomState / 0x100000000;
  }

  ensureContext() {
    if (this.context) return true;
    this.context = this.contextFactory?.() ?? null;
    if (!this.context) {
      this.lastError = 'audio-context-unavailable';
      return false;
    }

    this.masterGain = this.context.createGain();
    setParam(this.masterGain.gain, 0, this.context.currentTime);
    this.masterGain.connect(this.context.destination);
    this.noiseBuffer = this.createNoiseBuffer();
    return true;
  }

  createNoiseBuffer() {
    const duration = 0.14;
    const length = Math.max(1, Math.round(this.context.sampleRate * duration));
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const samples = buffer.getChannelData(0);
    let previous = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const white = this.random() * 2 - 1;
      previous = previous * 0.42 + white * 0.58;
      samples[index] = previous * (1 - index / samples.length);
    }
    return buffer;
  }

  async setEnabled(enabled) {
    if (this.disposed) return this.getDebugState();
    const nextEnabled = Boolean(enabled);
    this.resetMotion();

    if (!nextEnabled) {
      this.enabled = false;
      if (this.masterGain && this.context?.state !== 'closed') {
        setParam(this.masterGain.gain, 0, this.context.currentTime);
      }
      return this.getDebugState();
    }

    if (!this.ensureContext()) {
      this.enabled = false;
      return this.getDebugState();
    }

    this.enabled = true;
    this.lastError = null;
    setParam(this.masterGain.gain, 0.2, this.context.currentTime);
    if (this.context.state === 'suspended' && typeof this.context.resume === 'function') {
      try {
        await this.context.resume();
      } catch (error) {
        this.resumeFailures += 1;
        this.lastError = error?.name ?? 'resume-failed';
        this.enabled = false;
        setParam(this.masterGain.gain, 0, this.context.currentTime);
      }
    }
    return this.getDebugState();
  }

  resetMotion() {
    this.lastX = null;
    this.lastZ = null;
    this.distanceAccumulator = 0;
  }

  update({ x, z, walking, grounded, surface = 'sand', speed = 0 }) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    if (this.lastX === null || this.lastZ === null) {
      this.lastX = x;
      this.lastZ = z;
      return false;
    }

    const distance = Math.hypot(x - this.lastX, z - this.lastZ);
    this.lastX = x;
    this.lastZ = z;

    if (!this.enabled || !walking || !grounded) {
      this.distanceAccumulator = 0;
      return false;
    }
    if (distance > TELEPORT_DISTANCE) {
      this.distanceAccumulator = 0;
      return false;
    }

    this.currentStride = speed > 5.5 ? SPRINT_STRIDE : DEFAULT_STRIDE;
    this.distanceAccumulator += distance;
    if (this.distanceAccumulator < this.currentStride) return false;
    this.distanceAccumulator %= this.currentStride;
    return this.play(surface === 'wood' ? 'wood' : 'sand', speed);
  }

  play(surface, speed) {
    if (!this.context || this.context.state !== 'running') {
      this.skippedSteps += 1;
      return false;
    }

    const now = this.context.currentTime;
    const intensity = Math.min(1.18, Math.max(0.72, speed / 4.2));
    this.playNoise(surface, now, intensity);
    if (surface === 'wood') this.playWoodTone(now, intensity);

    this.steps += 1;
    this.lastSurface = surface;
    if (surface === 'wood') this.woodSteps += 1;
    else this.sandSteps += 1;
    return true;
  }

  playNoise(surface, now, intensity) {
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    const duration = surface === 'wood' ? 0.075 : 0.13;

    source.buffer = this.noiseBuffer;
    setParam(source.playbackRate, 0.88 + this.random() * 0.22, now);
    filter.type = surface === 'wood' ? 'bandpass' : 'lowpass';
    setParam(
      filter.frequency,
      surface === 'wood' ? 1250 + this.random() * 350 : 720 + this.random() * 260,
      now,
    );
    setParam(filter.Q, surface === 'wood' ? 1.8 : 0.72, now);
    setParam(gain.gain, 0.0001, now);
    rampParam(gain.gain, (surface === 'wood' ? 0.09 : 0.17) * intensity, now + 0.008);
    rampParam(gain.gain, 0.0001, now + duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    source.start(now);
    source.stop(now + duration + 0.015);
  }

  playWoodTone(now, intensity) {
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = 'triangle';
    setParam(oscillator.frequency, 145 + this.random() * 35, now);
    setParam(gain.gain, 0.0001, now);
    rampParam(gain.gain, 0.085 * intensity, now + 0.004);
    rampParam(gain.gain, 0.0001, now + 0.072);
    oscillator.connect(gain);
    gain.connect(this.masterGain);
    oscillator.start(now);
    oscillator.stop(now + 0.08);
  }

  getDebugState() {
    return {
      enabled: this.enabled,
      initialized: Boolean(this.context),
      contextState: this.context?.state ?? 'not-created',
      steps: this.steps,
      sandSteps: this.sandSteps,
      woodSteps: this.woodSteps,
      skippedSteps: this.skippedSteps,
      resumeFailures: this.resumeFailures,
      lastSurface: this.lastSurface,
      stride: Number(this.currentStride.toFixed(2)),
      pendingDistance: Number(this.distanceAccumulator.toFixed(3)),
      lastError: this.lastError,
    };
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.enabled = false;
    this.resetMotion();
    this.masterGain?.disconnect?.();
    if (this.context && this.context.state !== 'closed') {
      try {
        await this.context.close?.();
      } catch {
        // The document may already be tearing down its audio device.
      }
    }
  }
}

const TIMER_EXTENSION = 'EXT_disjoint_timer_query_webgl2';

/**
 * Collects whole-frame GPU timings without synchronously waiting for results.
 * Query results are read only after the browser reports them as available.
 */
export class GpuFrameTimer {
  constructor(
    gl,
    { maxPending = 4, maxQueryAge = 120, smoothing = 0.18 } = {},
  ) {
    this.gl = gl;
    this.maxPending = maxPending;
    this.maxQueryAge = maxQueryAge;
    this.smoothing = smoothing;
    this.pending = [];
    this.activeQuery = null;
    this.pollCount = 0;
    this.samples = 0;
    this.latestMs = null;
    this.smoothedMs = null;
    this.disjointEvents = 0;
    this.droppedQueries = 0;
    this.skippedFrames = 0;
    this.contextRestores = 0;
    this.disposed = false;
    this.extension = null;
    this.supported = false;
    this.unavailableReason = 'extension-unavailable';
    this.refreshSupport();
  }

  refreshSupport({ resetSamples = false } = {}) {
    if (this.disposed) return false;

    this.extension = this.gl?.getExtension?.(TIMER_EXTENSION) ?? null;
    this.supported = Boolean(
      this.extension &&
        this.gl?.createQuery &&
        this.gl?.beginQuery &&
        this.gl?.endQuery &&
        this.gl?.getQueryParameter,
    );
    this.unavailableReason = this.supported ? null : 'extension-unavailable';

    if (resetSamples) {
      this.samples = 0;
      this.latestMs = null;
      this.smoothedMs = null;
    }
    return this.supported;
  }

  begin() {
    if (!this.supported || this.disposed || this.activeQuery) return false;
    if (this.pending.length >= this.maxPending) {
      this.skippedFrames += 1;
      return false;
    }

    const query = this.gl.createQuery();
    if (!query) {
      this.skippedFrames += 1;
      return false;
    }

    try {
      this.gl.beginQuery(this.extension.TIME_ELAPSED_EXT, query);
      this.activeQuery = query;
      return true;
    } catch {
      this.gl.deleteQuery?.(query);
      this.droppedQueries += 1;
      return false;
    }
  }

  end() {
    if (!this.activeQuery || !this.supported || this.disposed) return false;

    const query = this.activeQuery;
    this.activeQuery = null;
    try {
      this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
      this.pending.push({ query, submittedAt: this.pollCount });
      return true;
    } catch {
      this.gl.deleteQuery?.(query);
      this.droppedQueries += 1;
      return false;
    }
  }

  poll() {
    this.pollCount += 1;
    if (!this.supported || this.disposed || this.pending.length === 0) {
      return this.smoothedMs;
    }

    let disjoint = false;
    try {
      disjoint = Boolean(
        this.gl.getParameter(this.extension.GPU_DISJOINT_EXT),
      );
    } catch {
      this.markUnavailable('query-error');
      return this.smoothedMs;
    }

    if (disjoint) {
      this.disjointEvents += 1;
      this.clearPending(true);
      this.samples = 0;
      this.latestMs = null;
      this.smoothedMs = null;
      return null;
    }

    while (this.pending.length > 0) {
      const entry = this.pending[0];
      if (this.pollCount - entry.submittedAt > this.maxQueryAge) {
        this.gl.deleteQuery?.(entry.query);
        this.pending.shift();
        this.droppedQueries += 1;
        continue;
      }

      let available = false;
      try {
        available = Boolean(
          this.gl.getQueryParameter(
            entry.query,
            this.gl.QUERY_RESULT_AVAILABLE,
          ),
        );
      } catch {
        this.markUnavailable('query-error');
        return this.smoothedMs;
      }
      if (!available) break;

      let nanoseconds = null;
      try {
        nanoseconds = this.gl.getQueryParameter(
          entry.query,
          this.gl.QUERY_RESULT,
        );
      } catch {
        this.droppedQueries += 1;
      }
      this.gl.deleteQuery?.(entry.query);
      this.pending.shift();

      const milliseconds = Number(nanoseconds) / 1_000_000;
      if (!Number.isFinite(milliseconds) || milliseconds < 0) {
        this.droppedQueries += 1;
        continue;
      }

      this.latestMs = milliseconds;
      this.smoothedMs =
        this.smoothedMs === null
          ? milliseconds
          : this.smoothedMs +
            (milliseconds - this.smoothedMs) * this.smoothing;
      this.samples += 1;
    }

    return this.smoothedMs;
  }

  markUnavailable(reason) {
    this.clearPending(true);
    this.activeQuery = null;
    this.extension = null;
    this.supported = false;
    this.unavailableReason = reason;
    this.samples = 0;
    this.latestMs = null;
    this.smoothedMs = null;
  }

  handleContextLost() {
    this.pending.length = 0;
    this.activeQuery = null;
    this.extension = null;
    this.supported = false;
    this.unavailableReason = 'context-lost';
    this.samples = 0;
    this.latestMs = null;
    this.smoothedMs = null;
  }

  handleContextRestored() {
    this.pending.length = 0;
    this.activeQuery = null;
    this.contextRestores += 1;
    return this.refreshSupport({ resetSamples: true });
  }

  clearPending(deleteQueries) {
    if (deleteQueries) {
      for (const { query } of this.pending) {
        this.gl?.deleteQuery?.(query);
      }
    }
    this.pending.length = 0;
  }

  getDebugState() {
    return {
      supported: this.supported,
      unavailableReason: this.unavailableReason,
      samples: this.samples,
      latestMs:
        this.latestMs === null ? null : Number(this.latestMs.toFixed(2)),
      smoothedMs:
        this.smoothedMs === null ? null : Number(this.smoothedMs.toFixed(2)),
      pendingQueries: this.pending.length,
      maxPendingQueries: this.maxPending,
      disjointEvents: this.disjointEvents,
      droppedQueries: this.droppedQueries,
      skippedFrames: this.skippedFrames,
      contextRestores: this.contextRestores,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;

    if (this.activeQuery && this.supported) {
      try {
        this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
      } catch {
        // The context may already be unavailable during application teardown.
      }
      this.gl.deleteQuery?.(this.activeQuery);
      this.activeQuery = null;
    }
    this.clearPending(true);
    this.extension = null;
    this.supported = false;
    this.unavailableReason = 'disposed';
  }
}

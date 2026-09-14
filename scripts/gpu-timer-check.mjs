import assert from 'node:assert/strict';

import { GpuFrameTimer } from '../src/experience/GpuFrameTimer.js';

class FakeWebGL2Context {
  constructor() {
    this.QUERY_RESULT_AVAILABLE = 0x8867;
    this.QUERY_RESULT = 0x8866;
    this.extension = {
      TIME_ELAPSED_EXT: 0x88bf,
      GPU_DISJOINT_EXT: 0x8fbb,
    };
    this.nextId = 1;
    this.active = null;
    this.available = true;
    this.disjoint = false;
    this.resultNanoseconds = 8_000_000;
    this.deleted = new Set();
  }

  getExtension(name) {
    return name === 'EXT_disjoint_timer_query_webgl2'
      ? this.extension
      : null;
  }

  createQuery() {
    return { id: this.nextId += 1 };
  }

  beginQuery(target, query) {
    assert.equal(target, this.extension.TIME_ELAPSED_EXT);
    assert.equal(this.active, null);
    this.active = query;
  }

  endQuery(target) {
    assert.equal(target, this.extension.TIME_ELAPSED_EXT);
    assert.notEqual(this.active, null);
    this.active = null;
  }

  getParameter(parameter) {
    assert.equal(parameter, this.extension.GPU_DISJOINT_EXT);
    return this.disjoint;
  }

  getQueryParameter(query, parameter) {
    assert.ok(query);
    if (parameter === this.QUERY_RESULT_AVAILABLE) return this.available;
    if (parameter === this.QUERY_RESULT) return this.resultNanoseconds;
    throw new Error('Unexpected query parameter.');
  }

  deleteQuery(query) {
    this.deleted.add(query.id);
  }
}

const gl = new FakeWebGL2Context();
const timer = new GpuFrameTimer(gl, {
  maxPending: 2,
  maxQueryAge: 2,
  smoothing: 0.5,
});

assert.equal(timer.getDebugState().supported, true);
assert.equal(timer.begin(), true);
assert.equal(timer.end(), true);
timer.poll();
assert.equal(timer.getDebugState().latestMs, 8);
assert.equal(timer.getDebugState().smoothedMs, 8);

gl.resultNanoseconds = 12_000_000;
assert.equal(timer.begin(), true);
assert.equal(timer.end(), true);
timer.poll();
assert.equal(timer.getDebugState().latestMs, 12);
assert.equal(timer.getDebugState().smoothedMs, 10);
assert.equal(timer.getDebugState().samples, 2);

gl.available = false;
assert.equal(timer.begin(), true);
assert.equal(timer.end(), true);
assert.equal(timer.begin(), true);
assert.equal(timer.end(), true);
assert.equal(timer.begin(), false);
assert.equal(timer.getDebugState().pendingQueries, 2);
assert.equal(timer.getDebugState().skippedFrames, 1);
timer.poll();
timer.poll();
timer.poll();
assert.equal(timer.getDebugState().pendingQueries, 0);
assert.equal(timer.getDebugState().droppedQueries, 2);

gl.available = true;
assert.equal(timer.begin(), true);
assert.equal(timer.end(), true);
gl.disjoint = true;
timer.poll();
assert.equal(timer.getDebugState().disjointEvents, 1);
assert.equal(timer.getDebugState().samples, 0);
assert.equal(timer.getDebugState().smoothedMs, null);

gl.disjoint = false;
timer.handleContextLost();
assert.equal(timer.getDebugState().unavailableReason, 'context-lost');
assert.equal(timer.handleContextRestored(), true);
assert.equal(timer.getDebugState().contextRestores, 1);
assert.equal(timer.getDebugState().supported, true);

timer.dispose();
assert.equal(timer.getDebugState().unavailableReason, 'disposed');
assert.equal(timer.begin(), false);

const unsupported = new GpuFrameTimer({ getExtension: () => null });
assert.equal(unsupported.getDebugState().supported, false);
assert.equal(unsupported.begin(), false);
unsupported.dispose();

console.log('GPU frame timer lifecycle checks passed.');

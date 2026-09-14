import assert from 'node:assert/strict';

import { CameraBookmarks } from '../src/experience/CameraBookmarks.js';

class MemoryStorage {
  constructor() {
    this.values = new Map();
    this.failWrites = false;
  }

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    if (this.failWrites) throw new DOMException('Storage denied', 'QuotaExceededError');
    this.values.set(key, String(value));
  }
}

const storage = new MemoryStorage();
let now = 1000;
const bookmarks = new CameraBookmarks({ storage, now: () => now });
let state = bookmarks.getDebugState();
assert.equal(state.storageAvailable, true);
assert.equal(state.savedCount, 0);
assert.deepEqual(state.slots.map((slot) => slot.saved), [false, false, false]);

assert.equal(bookmarks.save(0, { position: [1, 2, 3], target: [4, 5, 6] }), null);
assert.equal(bookmarks.save(1, { position: [1, 2], target: [4, 5, 6] }), null);
assert.equal(bookmarks.save(1, { position: [1, 2, Infinity], target: [4, 5, 6] }), null);

const position = [28, 8.6, 38];
const target = [5, 2.1, 5];
const saved = bookmarks.save(1, { position, target });
position[0] = 999;
target[0] = 999;
assert.deepEqual(saved.position, [28, 8.6, 38]);
assert.deepEqual(saved.target, [5, 2.1, 5]);
assert.equal(saved.savedAt, 1000);

const readCopy = bookmarks.get(1);
readCopy.position[0] = -999;
assert.deepEqual(bookmarks.get(1).position, [28, 8.6, 38]);

now = 2000;
bookmarks.save(1, { position: [22, 7, 31], target: [2, 2, 4] });
bookmarks.save(3, { position: [-10, 5, 26], target: [0, 1, 8] });
state = bookmarks.getDebugState();
assert.equal(state.savedCount, 2);
assert.equal(state.slots[0].savedAt, 2000);
assert.equal(state.slots[1].saved, false);
assert.equal(state.slots[2].saved, true);

const payload = JSON.parse(storage.getItem(state.storageKey));
assert.equal(payload.version, 1);
assert.deepEqual(payload.slots.map((entry) => entry.slot), [1, 3]);

const reloaded = new CameraBookmarks({ storage, now: () => 3000 });
assert.equal(reloaded.getDebugState().savedCount, 2);
assert.deepEqual(reloaded.get(1).position, [22, 7, 31]);
assert.equal(reloaded.remove(2), false);
assert.equal(reloaded.remove(1), true);
assert.equal(reloaded.get(1), null);
assert.equal(reloaded.getDebugState().savedCount, 1);

const malformedStorage = new MemoryStorage();
malformedStorage.setItem('tideline.camera-bookmarks.v1', '{broken');
const malformed = new CameraBookmarks({ storage: malformedStorage });
assert.equal(malformed.getDebugState().savedCount, 0);
assert.notEqual(malformed.getDebugState().lastError, null);

storage.failWrites = true;
now = 4000;
const memorySaved = bookmarks.save(2, {
  position: [12, 4, 18],
  target: [0, 1, 0],
});
assert.ok(memorySaved);
assert.equal(bookmarks.getDebugState().savedCount, 3);
assert.equal(bookmarks.getDebugState().lastError, 'QuotaExceededError');

console.log('Camera bookmark persistence and validation checks passed.');

const STORAGE_VERSION = 1;
const SLOT_COUNT = 3;
const COORDINATE_LIMIT = 1000;

function normalizeVector(value) {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    value.some(
      (component) =>
        !Number.isFinite(component) || Math.abs(component) > COORDINATE_LIMIT,
    )
  ) {
    return null;
  }
  return value.map((component) => Number(component.toFixed(6)));
}

function normalizeBookmark(value, fallbackSavedAt) {
  if (!value || typeof value !== 'object') return null;
  const position = normalizeVector(value.position);
  const target = normalizeVector(value.target);
  if (!position || !target) return null;
  return {
    position,
    target,
    savedAt: Number.isFinite(value.savedAt) ? value.savedAt : fallbackSavedAt,
  };
}

function normalizeSlot(slot) {
  const value = Number(slot);
  return Number.isInteger(value) && value >= 1 && value <= SLOT_COUNT
    ? value
    : null;
}

/** Stores three validated camera compositions without owning camera controls. */
export class CameraBookmarks {
  constructor({ storage, storageKey = 'tideline.camera-bookmarks.v1', now = Date.now } = {}) {
    this.storageKey = storageKey;
    this.now = now;
    this.slots = new Map();
    this.storage = storage;
    this.lastError = null;

    if (storage === undefined) {
      try {
        this.storage = globalThis.localStorage ?? null;
      } catch (error) {
        this.storage = null;
        this.lastError = error?.name ?? 'storage-unavailable';
      }
    }
    this.load();
  }

  load() {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(this.storageKey);
      if (!raw) return;
      const payload = JSON.parse(raw);
      if (payload?.version !== STORAGE_VERSION || !Array.isArray(payload.slots)) {
        throw new Error('invalid-bookmark-payload');
      }
      payload.slots.forEach((entry) => {
        const slot = normalizeSlot(entry?.slot);
        const bookmark = normalizeBookmark(entry, this.now());
        if (slot && bookmark) this.slots.set(slot, bookmark);
      });
    } catch (error) {
      this.slots.clear();
      this.lastError = error?.message ?? error?.name ?? 'storage-read-failed';
    }
  }

  persist() {
    if (!this.storage) return false;
    try {
      this.storage.setItem(
        this.storageKey,
        JSON.stringify({
          version: STORAGE_VERSION,
          slots: [...this.slots.entries()].map(([slot, bookmark]) => ({
            slot,
            ...bookmark,
          })),
        }),
      );
      this.lastError = null;
      return true;
    } catch (error) {
      this.lastError = error?.name ?? 'storage-write-failed';
      return false;
    }
  }

  save(slot, composition) {
    const normalizedSlot = normalizeSlot(slot);
    const bookmark = normalizeBookmark(composition, this.now());
    if (!normalizedSlot || !bookmark) return null;
    bookmark.savedAt = this.now();
    this.slots.set(normalizedSlot, bookmark);
    this.persist();
    return this.get(normalizedSlot);
  }

  remove(slot) {
    const normalizedSlot = normalizeSlot(slot);
    if (!normalizedSlot) return false;
    const removed = this.slots.delete(normalizedSlot);
    if (removed) this.persist();
    return removed;
  }

  get(slot) {
    const bookmark = this.slots.get(normalizeSlot(slot));
    return bookmark
      ? {
          position: [...bookmark.position],
          target: [...bookmark.target],
          savedAt: bookmark.savedAt,
        }
      : null;
  }

  getDebugState() {
    return {
      storageAvailable: Boolean(this.storage),
      storageKey: this.storageKey,
      savedCount: this.slots.size,
      lastError: this.lastError,
      slots: Array.from({ length: SLOT_COUNT }, (_, index) => {
        const slot = index + 1;
        const bookmark = this.get(slot);
        return {
          slot,
          saved: Boolean(bookmark),
          ...bookmark,
        };
      }),
    };
  }
}

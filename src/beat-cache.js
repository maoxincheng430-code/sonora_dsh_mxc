// 节拍分析缓存：结果按曲目存 IndexedDB（数据库 sonora-beats），
// 再次播放同一首歌直接读缓存，不再重复分析。
// 无 IndexedDB 的环境（Node 单测）退化为内存 Map。

const DB_NAME = 'sonora-beats';
const DB_VERSION = 1;
const STORE = 'beats';
const CACHE_VERSION = 1;
const MAX_BEATS = 4000;

/** 曲目缓存键：优先用曲库 id，其次文件名+大小+修改时间。 */
export function beatCacheKey(track) {
  if (!track) return '';
  if (track.id) return String(track.id);
  return `${track.name ?? ''}|${track.size ?? 0}|${track.lastModified ?? 0}`;
}

/** 校验并规整一份节拍网格（从缓存读回时防止脏数据）。 */
export function normalizeBeatGrid(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const beats = Array.isArray(raw.beats)
    ? raw.beats.map(Number).filter((time) => Number.isFinite(time) && time >= 0).sort((a, b) => a - b).slice(0, MAX_BEATS)
    : [];
  const downbeats = Array.isArray(raw.downbeats)
    ? raw.downbeats.map(Number).filter((time) => Number.isFinite(time) && time >= 0).sort((a, b) => a - b).slice(0, MAX_BEATS)
    : [];
  if (beats.length < 2) return null;
  return {
    bpm: Number(raw.bpm) || 0,
    beats,
    downbeats,
    duration: Number(raw.duration) || 0,
    confidence: Number(raw.confidence) || 0,
    version: CACHE_VERSION,
  };
}

export function createBeatCache(options = {}) {
  const indexedDB = options.indexedDB ?? (typeof globalThis !== 'undefined' ? globalThis.indexedDB : undefined);
  const dbName = options.dbName ?? DB_NAME;
  const memory = new Map();
  let dbPromise = null;

  function openDb() {
    if (!indexedDB || typeof indexedDB.open !== 'function') return Promise.resolve(null);
    if (!dbPromise) {
      dbPromise = new Promise((resolve) => {
        try {
          const request = indexedDB.open(dbName, DB_VERSION);
          request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
          };
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(null);
          request.onblocked = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    }
    return dbPromise;
  }

  function readFromDb(db, key) {
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readonly');
        const request = tx.objectStore(STORE).get(key);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  function writeToDb(db, key, value) {
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }

  return {
    async get(trackOrKey) {
      const key = typeof trackOrKey === 'string' ? trackOrKey : beatCacheKey(trackOrKey);
      if (!key) return null;
      if (memory.has(key)) return memory.get(key);
      const db = await openDb();
      if (!db) return null;
      const raw = await readFromDb(db, key);
      const grid = normalizeBeatGrid(raw);
      if (!grid || grid.version !== CACHE_VERSION) return null;
      memory.set(key, grid);
      return grid;
    },

    async set(trackOrKey, grid) {
      const key = typeof trackOrKey === 'string' ? trackOrKey : beatCacheKey(trackOrKey);
      const normalized = normalizeBeatGrid(grid);
      if (!key || !normalized) return false;
      memory.set(key, normalized);
      const db = await openDb();
      if (!db) return false;
      return writeToDb(db, key, normalized);
    },

    async remove(trackOrKey) {
      const key = typeof trackOrKey === 'string' ? trackOrKey : beatCacheKey(trackOrKey);
      if (!key) return false;
      memory.delete(key);
      const db = await openDb();
      if (!db) return false;
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).delete(key);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        } catch {
          resolve(false);
        }
      });
    },

    async clear() {
      memory.clear();
      const db = await openDb();
      if (!db) return false;
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).clear();
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        } catch {
          resolve(false);
        }
      });
    },

    get size() {
      return memory.size;
    },
  };
}

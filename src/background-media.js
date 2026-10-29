// 自定义背景媒体工具：文件类型判定 + 背景文件持久化（IndexedDB 单文件）。
//
// 该模块完全独立于 DOM：Node / 无 indexedDB 环境下也不会抛错。
// 约定：
//   - classifyBackgroundFile(file) 只认图片 / 视频，其余一律 null。
//     判定顺序为「file.type 优先，扩展名兜底」：浏览器给出的 MIME 可信时（image/*、video/*）直接采用；
//     MIME 缺失或浏览器只给 application/octet-stream 时按文件名扩展名判断。
//   - createBackgroundStore() 在 IndexedDB 里只保存「当前一张背景」（db: sonora-background，
//     store: background，key: current），方便刷新后恢复用户上次选的图片/视频。
//     没有 indexedDB、数据库被禁用（隐私模式）、配额不足等任何异常都静默降级：
//     save -> false、load -> null、clear/close 不抛错，调用方无需 try/catch。

const DB_NAME = 'sonora-background';
const STORE_NAME = 'background';
const RECORD_KEY = 'current';
const DB_VERSION = 1;

const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'jfif', 'gif', 'webp', 'avif', 'bmp', 'svg',
]);

const VIDEO_EXTENSIONS = new Set([
  'mp4', 'm4v', 'webm', 'ogv', 'mov', 'mkv', 'mpeg', 'mpg',
]);

function extensionOf(name) {
  if (typeof name !== 'string') return '';
  const match = /\.([a-z0-9]+)$/i.exec(name.trim());
  return match ? match[1].toLowerCase() : '';
}

// 判定背景文件类型：'image' | 'video' | null。
// 仅接受浏览器可直接渲染的图片 / 视频类型；音频、文档、未知格式一律 null。
export function classifyBackgroundFile(file) {
  if (!file || typeof file !== 'object') return null;
  const type = typeof file.type === 'string' ? file.type.trim().toLowerCase() : '';
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  // MIME 缺失或为通用二进制（不同浏览器对 .mov/.mkv 等常给 application/octet-stream）
  // 时退回扩展名判断。
  const ext = extensionOf(file.name);
  if (!ext) return null;
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  return null;
}

function isBlobLike(value) {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof value.size === 'number' &&
    typeof value.type === 'string'
  );
}

// 把存储里的记录规整为 { file, name, type }。兼容旧格式（直接存 Blob）。
function normalizeRecord(record) {
  if (!record) return null;
  if (isBlobLike(record)) {
    return {
      file: record,
      name: typeof record.name === 'string' ? record.name : '',
      type: record.type || '',
    };
  }
  const file = record.file && isBlobLike(record.file) ? record.file : null;
  if (!file) return null;
  return {
    file,
    name: typeof record.name === 'string' && record.name ? record.name : file.name || '',
    type: typeof record.type === 'string' && record.type ? record.type : file.type || '',
  };
}

// 创建背景文件存储。
// options:
//   - indexedDB：注入 IndexedDB 实现（默认 globalThis.indexedDB），传 null 可强制降级；
//   - dbName / storeName / version：测试或扩展用，默认 sonora-background / background / 1。
// 返回 { save(file), load(), clear(), close() }，全部 async 且永不 reject。
export function createBackgroundStore(options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  const idb =
    opts.indexedDB !== undefined
      ? opts.indexedDB
      : typeof globalThis !== 'undefined'
        ? globalThis.indexedDB
        : null;
  const dbName = typeof opts.dbName === 'string' && opts.dbName ? opts.dbName : DB_NAME;
  const storeName =
    typeof opts.storeName === 'string' && opts.storeName ? opts.storeName : STORE_NAME;
  const version =
    Number.isInteger(opts.version) && opts.version > 0 ? opts.version : DB_VERSION;

  let dbPromise = null;
  let closed = false;

  function openDb() {
    if (closed || !idb || typeof idb.open !== 'function') return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(resolve => {
      let request;
      try {
        request = idb.open(dbName, version);
        if (!request) {
          resolve(null);
          return;
        }
      } catch (_e) {
        resolve(null);
        return;
      }
      request.onupgradeneeded = () => {
        try {
          const db = request.result;
          if (db && db.objectStoreNames && !db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName);
          }
        } catch (_e) {}
      };
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
    return dbPromise;
  }

  async function save(file) {
    try {
      if (closed) return false;
      // 保存前先校验：只允许图片 / 视频，拒绝音频、文档等。
      if (!classifyBackgroundFile(file)) return false;
      const db = await openDb();
      if (!db) return false;
      const record = {
        file,
        name: typeof file.name === 'string' && file.name ? file.name : '',
        type: typeof file.type === 'string' ? file.type : '',
        savedAt: Date.now(),
      };
      return await new Promise(resolve => {
        let done = false;
        const finish = value => {
          if (!done) {
            done = true;
            resolve(value);
          }
        };
        try {
          const tx = db.transaction(storeName, 'readwrite');
          const store = tx.objectStore(storeName);
          const request = store.put(record, RECORD_KEY);
          if (request) request.onsuccess = () => finish(true);
          if (request) request.onerror = () => finish(false);
          if (tx) {
            tx.onabort = () => finish(false);
            tx.onerror = () => finish(false);
            tx.oncomplete = () => finish(true);
          }
        } catch (_e) {
          finish(false);
        }
      });
    } catch (_e) {
      return false;
    }
  }

  async function load() {
    try {
      if (closed) return null;
      const db = await openDb();
      if (!db) return null;
      return await new Promise(resolve => {
        let done = false;
        const finish = value => {
          if (!done) {
            done = true;
            resolve(value);
          }
        };
        try {
          const tx = db.transaction(storeName, 'readonly');
          const store = tx.objectStore(storeName);
          const request = store.get(RECORD_KEY);
          if (request) {
            request.onsuccess = () => finish(normalizeRecord(request.result));
            request.onerror = () => finish(null);
          } else {
            finish(null);
          }
          if (tx) tx.onabort = () => finish(null);
        } catch (_e) {
          finish(null);
        }
      });
    } catch (_e) {
      return null;
    }
  }

  async function clear() {
    try {
      if (closed) return false;
      const db = await openDb();
      if (!db) return false;
      return await new Promise(resolve => {
        let done = false;
        const finish = value => {
          if (!done) {
            done = true;
            resolve(value);
          }
        };
        try {
          const tx = db.transaction(storeName, 'readwrite');
          const store = tx.objectStore(storeName);
          const request = store.delete(RECORD_KEY);
          if (request) request.onsuccess = () => finish(true);
          if (request) request.onerror = () => finish(false);
          if (tx) {
            tx.onabort = () => finish(false);
            tx.onerror = () => finish(false);
            tx.oncomplete = () => finish(true);
          }
        } catch (_e) {
          finish(false);
        }
      });
    } catch (_e) {
      return false;
    }
  }

  async function close() {
    closed = true;
    const pending = dbPromise;
    dbPromise = null;
    if (!pending) return;
    try {
      const db = await pending;
      if (db && typeof db.close === 'function') db.close();
    } catch (_e) {
      // 关闭失败不影响调用方。
    }
  }

  // 显式吞掉潜在的 Promise 拒绝，保证调用方无需 catch。
  return { save, load, clear, close };
}

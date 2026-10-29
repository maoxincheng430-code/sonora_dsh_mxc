import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyBackgroundFile,
  createBackgroundStore,
} from '../src/background-media.js';

// ---------- 测试辅助 ----------
// Node 24 有全局 File；没有时退回等价的鸭子类型对象（store 只依赖 Blob 形状）。
function makeFile(name, type, content = 'fake-bytes') {
  if (typeof File === 'function') return new File([content], name, { type });
  return { name, type, size: content.length };
}

// 最小假 IndexedDB：只实现本项目用到的 open / onupgradeneeded / transaction / put / get / delete。
// 全部回调异步派发（queueMicrotask），与真实 IndexedDB 的异步语义一致。
function makeFakeIndexedDB() {
  const databases = new Map();
  const stats = { openCalls: 0, transactions: 0, puts: 0, gets: 0, deletes: 0, closes: 0 };

  const idb = {
    open(name, version = 1) {
      stats.openCalls += 1;
      const request = {
        result: undefined,
        error: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
      };
      queueMicrotask(() => {
        let record = databases.get(name);
        const created = !record;
        if (!record) {
          record = { stores: new Map(), version };
          databases.set(name, record);
        }
        const db = {
          name,
          version,
          objectStoreNames: {
            contains: storeName => record.stores.has(storeName),
          },
          createObjectStore(storeName) {
            if (!record.stores.has(storeName)) record.stores.set(storeName, new Map());
            return { name: storeName };
          },
          transaction(storeName) {
            stats.transactions += 1;
            const store = record.stores.get(storeName);
            if (!store) throw new Error(`缺少 object store: ${storeName}`);
            const schedule = work => {
              const req = { result: undefined, error: null, onsuccess: null, onerror: null };
              queueMicrotask(() => {
                try {
                  req.result = work();
                  if (req.onsuccess) req.onsuccess();
                  if (tx.oncomplete) tx.oncomplete();
                } catch (error) {
                  req.error = error;
                  if (req.onerror) req.onerror();
                  if (tx.onerror) tx.onerror();
                }
              });
              return req;
            };
            const tx = {
              oncomplete: null,
              onerror: null,
              onabort: null,
              objectStore() {
                return {
                  put(value, key) {
                    stats.puts += 1;
                    return schedule(() => {
                      store.set(key, value);
                      return key;
                    });
                  },
                  get(key) {
                    stats.gets += 1;
                    return schedule(() => store.get(key));
                  },
                  delete(key) {
                    stats.deletes += 1;
                    return schedule(() => {
                      store.delete(key);
                      return undefined;
                    });
                  },
                };
              },
            };
            return tx;
          },
          close() {
            stats.closes += 1;
          },
        };
        request.result = db;
        if (created && request.onupgradeneeded) request.onupgradeneeded();
        if (request.onsuccess) request.onsuccess();
      });
      return request;
    },
  };

  return { idb, stats, databases };
}

// ---------- classifyBackgroundFile ----------
test('classifyBackgroundFile：MIME 类型优先于扩展名', () => {
  assert.equal(classifyBackgroundFile({ type: 'image/png', name: 'x.mp4' }), 'image');
  assert.equal(classifyBackgroundFile({ type: 'video/mp4', name: 'x.png' }), 'video');
  assert.equal(classifyBackgroundFile({ type: 'IMAGE/JPEG', name: 'x.png' }), 'image');
  assert.equal(classifyBackgroundFile({ type: ' video/webm ' }), 'video');
});

test('classifyBackgroundFile：MIME 缺失/通用二进制时按扩展名兜底', () => {
  for (const name of ['a.png', 'a.JPG', 'a.jpeg', 'a.webp', 'a.avif', 'a.gif', 'a.bmp', 'a.svg']) {
    assert.equal(classifyBackgroundFile({ name }), 'image', `${name} 应判定为图片`);
    assert.equal(
      classifyBackgroundFile({ name, type: 'application/octet-stream' }),
      'image',
      `${name} + octet-stream 应回退扩展名`,
    );
  }
  for (const name of ['a.mp4', 'a.M4V', 'a.webm', 'a.mov', 'a.mkv', 'a.ogv']) {
    assert.equal(classifyBackgroundFile({ name }), 'video', `${name} 应判定为视频`);
    assert.equal(
      classifyBackgroundFile({ name, type: 'application/octet-stream' }),
      'video',
      `${name} + octet-stream 应回退扩展名`,
    );
  }
});

test('classifyBackgroundFile：拒绝非图片/视频、空输入与未知扩展名', () => {
  assert.equal(classifyBackgroundFile(null), null);
  assert.equal(classifyBackgroundFile(undefined), null);
  assert.equal(classifyBackgroundFile('a.png'), null);
  assert.equal(classifyBackgroundFile({}), null);
  assert.equal(classifyBackgroundFile({ name: '' }), null);
  assert.equal(classifyBackgroundFile({ name: 'no-extension' }), null);
  assert.equal(classifyBackgroundFile({ name: 'song.mp3', type: 'audio/mpeg' }), null);
  assert.equal(classifyBackgroundFile({ name: 'doc.pdf', type: 'application/pdf' }), null);
  assert.equal(classifyBackgroundFile({ name: 'a.txt' }), null);
  assert.equal(classifyBackgroundFile({ name: 'archive.tar.gz' }), null);
});

// ---------- 无 indexedDB / 异常：安全降级 ----------
test('无 indexedDB：save=false、load=null、clear/close 不抛错', async () => {
  const store = createBackgroundStore({ indexedDB: null });
  assert.equal(await store.save(makeFile('bg.png', 'image/png')), false);
  assert.equal(await store.load(), null);
  assert.equal(await store.clear(), false);
  await assert.doesNotReject(() => store.close());
});

test('默认读取 globalThis.indexedDB：Node 下无该 API 也安全降级', async () => {
  const store = createBackgroundStore();
  assert.equal(typeof store.save, 'function');
  assert.equal(typeof store.close, 'function');
  assert.equal(await store.load(), null);
  await assert.doesNotReject(() => store.close());
});

test('indexedDB.open 抛异常时全部安全降级', async () => {
  const store = createBackgroundStore({
    indexedDB: {
      open() {
        throw new Error('SecurityError: IndexedDB blocked');
      },
    },
  });
  assert.equal(await store.save(makeFile('bg.png', 'image/png')), false);
  assert.equal(await store.load(), null);
  assert.equal(await store.clear(), false);
  await assert.doesNotReject(() => store.close());
});

test('store 拒绝不支持的文件类型，且不打开事务', async () => {
  const { idb, stats } = makeFakeIndexedDB();
  const store = createBackgroundStore({ indexedDB: idb });
  assert.equal(await store.save({ name: 'song.mp3', type: 'audio/mpeg' }), false);
  assert.equal(await store.save(null), false);
  assert.equal(await store.save({ name: 'readme.txt' }), false);
  assert.equal(stats.transactions, 0, '校验失败不应产生读写事务');
  assert.equal(stats.puts, 0);
  await store.close();
});

// ---------- 正向路径（假 IndexedDB） ----------
test('store：save / load / 覆盖 / clear / close 生命周期', async () => {
  const { idb, stats } = makeFakeIndexedDB();
  const store = createBackgroundStore({ indexedDB: idb });

  assert.equal(await store.load(), null, '空库 load 返回 null');

  const imageFile = makeFile('wallpaper.png', 'image/png');
  assert.equal(await store.save(imageFile), true);
  const first = await store.load();
  assert.ok(first, '保存后应能读回');
  assert.equal(first.name, 'wallpaper.png');
  assert.equal(first.type, 'image/png');
  assert.equal(first.file, imageFile, 'fake IDB 不做结构化克隆，读回同一引用');

  // 覆盖：只保留最新一张背景
  const videoFile = makeFile('aurora.mp4', 'video/mp4');
  assert.equal(await store.save(videoFile), true);
  const second = await store.load();
  assert.equal(second.name, 'aurora.mp4');
  assert.equal(second.type, 'video/mp4');
  assert.equal(second.file, videoFile);

  assert.equal(await store.clear(), true);
  assert.equal(await store.load(), null, 'clear 后 load 返回 null');

  await store.close();
  assert.equal(stats.closes, 1, 'close 关闭底层数据库连接');
  assert.equal(await store.save(videoFile), false, 'close 后 save 降级为 false');
  assert.equal(await store.load(), null);
});

test('store：可注入 dbName / storeName 且按默认 key=current 单条存取', async () => {
  const { idb, stats, databases } = makeFakeIndexedDB();
  const store = createBackgroundStore({
    indexedDB: idb,
    dbName: 'custom-bg',
    storeName: 'media',
  });
  assert.equal(await store.save(makeFile('x.webm', 'video/webm')), true);
  const database = databases.get('custom-bg');
  assert.ok(database, '使用注入的数据库名');
  assert.ok(database.stores.has('media'), '使用注入的 store 名');
  const keys = [...database.stores.get('media').keys()];
  assert.deepEqual(keys, ['current'], '固定 key current，只存一张背景');
  assert.equal(stats.puts, 1);
  await store.close();
});

// 纯 Node 单测：通过 mock globalThis.fetch 验证 src/library-api.js 的 HTTP 契约。
// 运行：node --test tests/library-api.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

import { createRemoteLibrary, probeServer, DEFAULT_BASE_URL } from '../src/library-api.js';

const ORIGINAL_FETCH = globalThis.fetch;

const jsonResponse = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const audioResponse = (bytes, headers = {}) =>
  new Response(Uint8Array.from(bytes), {
    status: 206,
    headers: { 'Content-Type': 'audio/mpeg', ...headers },
  });

// 安装 fetch mock，返回调用记录；测试结束自动还原。
function mockFetch(t, handler) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const entry = { url: String(url), init };
    calls.push(entry);
    return handler(entry);
  };
  t.after(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });
  return calls;
}

function makeFile(name = 'A-Lin - 给我一个理由忘记.mp3', type = 'audio/mpeg') {
  return new File([Uint8Array.from([1, 2, 3, 4])], name, {
    type,
    lastModified: 1700000000000,
  });
}

const sampleTrack = {
  id: '9f2c1d',
  name: 'A-Lin - 给我一个理由忘记.mp3',
  title: '给我一个理由忘记',
  artist: 'A-Lin',
  duration: 242.5,
  size: 4,
  type: 'audio/mpeg',
  lastModified: 1700000000000,
  addedAt: 1700000005000,
  playCount: 0,
  lastPlayedAt: 0,
};

test('probeServer 对健康服务返回 true，并请求 /api/health', async (t) => {
  const calls = mockFetch(t, () => jsonResponse({ ok: true, db: true, count: 3 }));
  assert.equal(await probeServer('http://127.0.0.1:8787'), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:8787/api/health');
});

test('probeServer 在网络错误、db:false、非 2xx 时返回 false 而不抛错', async (t) => {
  mockFetch(t, () => {
    throw new TypeError('fetch failed');
  });
  assert.equal(await probeServer('http://127.0.0.1:8787'), false);
});

test('probeServer 在 db 不可用时返回 false', async (t) => {
  mockFetch(t, () => jsonResponse({ ok: false, db: false, error: '数据库连接失败' }, 503));
  assert.equal(await probeServer('http://127.0.0.1:8787'), false);
});

test('probeServer 超时后返回 false（AbortController）', async (t) => {
  mockFetch(t, (entry) => new Promise((resolve, reject) => {
    entry.init.signal.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    });
  }));
  const started = Date.now();
  assert.equal(await probeServer('http://127.0.0.1:8787', 25), false);
  assert.ok(Date.now() - started < 5000, '应快速超时返回');
});

test('open() 探测成功返回 true；失败抛中文错误', async (t) => {
  const calls = mockFetch(t, () => jsonResponse({ ok: true, db: true, count: 0 }));
  const library = createRemoteLibrary();
  assert.equal(await library.open(), true);
  assert.equal(await library.open(), true);
  assert.equal(calls.length, 1, 'open() 结果应缓存');
  library.close();

  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };
  const broken = createRemoteLibrary();
  await assert.rejects(() => broken.open(), /无法连接 Sonora 数据库服务/);
});

test('save() 发送 multipart，带 audio/duration/lastModified 并返回 track', async (t) => {
  const calls = mockFetch(t, () => jsonResponse(sampleTrack, 201));
  const library = createRemoteLibrary({ baseUrl: DEFAULT_BASE_URL + '/' });
  const file = makeFile();
  const track = await library.save(file, 242.5);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:8787/api/tracks');
  assert.equal(calls[0].init.method, 'POST');
  assert.ok(calls[0].init.body instanceof FormData);
  const sent = calls[0].init.body.get('audio');
  assert.ok(sent instanceof File);
  assert.equal(sent.name, file.name);
  assert.equal(sent.size, file.size);
  assert.equal(calls[0].init.body.get('duration'), '242.5');
  assert.equal(calls[0].init.body.get('lastModified'), '1700000000000');
  assert.equal(track.id, sampleTrack.id);
  assert.equal(track.title, sampleTrack.title);
  assert.equal(track.playCount, 0);
  assert.ok(Number.isFinite(track.importedAt), '保存后应补齐 importedAt');
});

test('save() 携带内嵌标签的 title/artist（来自 ID3 / MP4 ilst）', async (t) => {
  const calls = mockFetch(t, () => jsonResponse(sampleTrack, 201));
  const library = createRemoteLibrary({ baseUrl: DEFAULT_BASE_URL + '/' });
  await library.save(makeFile('未知文件名.mp4', 'video/mp4'), 12, { title: 'Midnight Rain', artist: 'Blue Harbor' });
  const form = calls[0].init.body;
  assert.equal(form.get('title'), 'Midnight Rain');
  assert.equal(form.get('artist'), 'Blue Harbor');
});

test('save() 没有内嵌标签时不发送 title/artist（保持按文件名解析）', async (t) => {
  const calls = mockFetch(t, () => jsonResponse(sampleTrack, 201));
  const library = createRemoteLibrary({ baseUrl: DEFAULT_BASE_URL + '/' });
  await library.save(makeFile(), 242.5);
  const form = calls[0].init.body;
  assert.equal(form.get('title'), null);
  assert.equal(form.get('artist'), null);
});

test('save() 去重时服务端返回 200 已有记录，客户端照常返回该 track', async (t) => {
  mockFetch(t, () => jsonResponse({ ...sampleTrack, playCount: 7 }, 200));
  const library = createRemoteLibrary();
  const track = await library.save(makeFile(), 242.5);
  assert.equal(track.playCount, 7);
});

test('list() 请求 /api/tracks 并按 addedAt 倒序返回归一化数据', async (t) => {
  const calls = mockFetch(t, () => jsonResponse([
    { ...sampleTrack, id: 'old', addedAt: 1000, title: 'Old' },
    { ...sampleTrack, id: 'new', addedAt: 9000, title: 'New', artist: '' },
  ]));
  const library = createRemoteLibrary();
  const tracks = await library.list();
  assert.equal(calls[0].url, 'http://127.0.0.1:8787/api/tracks');
  assert.deepEqual(tracks.map((track) => track.id), ['new', 'old']);
  assert.equal(tracks[0].type, 'audio/mpeg');
  assert.equal(tracks[0].lastModified, 1700000000000);
  assert.equal(tracks[0].playCount, 0);
});

test('read() 用 Range 响应构造 File，并带上名称/MIME/修改时间', async (t) => {
  const calls = mockFetch(t, () =>
    audioResponse([1, 2, 3, 4, 5], {
      'Content-Range': 'bytes 0-4/5',
      'X-Track-Name': encodeURIComponent('A-Lin - 给我一个理由忘记.mp3'),
      'X-Track-Type': encodeURIComponent('audio/mpeg'),
      'X-Track-Last-Modified': '1700000000000',
    }),
  );
  const library = createRemoteLibrary();
  const file = await library.read('abc/123');
  assert.equal(calls[0].url, 'http://127.0.0.1:8787/api/tracks/abc%2F123/audio');
  assert.ok(file instanceof File);
  assert.equal(file.name, 'A-Lin - 给我一个理由忘记.mp3');
  assert.equal(file.type, 'audio/mpeg');
  assert.equal(file.size, 5);
  assert.equal(file.lastModified, 1700000000000);
});

test('read() 无响应头时回退到列表缓存元数据，404 时抛服务端中文信息', async (t) => {
  const calls = mockFetch(t, (entry) => {
    if (entry.url.endsWith('/api/tracks')) return jsonResponse([sampleTrack]);
    return audioResponse([7, 8, 9], {});
  });
  const library = createRemoteLibrary();
  await library.list();
  const file = await library.read(sampleTrack.id);
  assert.equal(file.name, sampleTrack.name);
  assert.equal(file.type, 'audio/mpeg');
  assert.equal(file.lastModified, sampleTrack.lastModified);
  assert.equal(calls.length, 2);

  mockFetch(t, () => jsonResponse({ error: '歌曲不存在或已删除，请重新导入。' }, 404));
  await assert.rejects(
    () => library.read('missing'),
    /歌曲不存在或已删除/,
  );
});

test('update() 以 JSON 发送 PATCH，并裁剪空白', async (t) => {
  const calls = mockFetch(t, () => jsonResponse({ ...sampleTrack, title: '新标题', artist: '新歌手' }));
  const library = createRemoteLibrary();
  const track = await library.update('9f2c1d', { title: '  新标题  ', artist: ' 新歌手 ' });
  assert.equal(calls[0].init.method, 'PATCH');
  assert.equal(calls[0].url, 'http://127.0.0.1:8787/api/tracks/9f2c1d');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].init.body), { title: '新标题', artist: '新歌手' });
  assert.equal(track.title, '新标题');
});

test('update() 没有字段时返回缓存记录，不发 PATCH', async (t) => {
  const calls = mockFetch(t, () => jsonResponse([sampleTrack]));
  const library = createRemoteLibrary();
  const [track] = await library.list();
  const same = await library.update(track.id, {});
  assert.equal(same.id, sampleTrack.id);
  assert.equal(calls.length, 1);
});

test('touch() POST /play 并返回新的 playCount/lastPlayedAt', async (t) => {
  const calls = mockFetch(t, () =>
    jsonResponse({ ...sampleTrack, playCount: 4, lastPlayedAt: 1770000000000 }),
  );
  const library = createRemoteLibrary();
  const track = await library.touch('9f2c1d');
  assert.equal(calls[0].url, 'http://127.0.0.1:8787/api/tracks/9f2c1d/play');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(track.playCount, 4);
  assert.equal(track.lastPlayedAt, 1770000000000);
});

test('remove() DELETE 成功；404 视为已删除不抛错', async (t) => {
  mockFetch(t, () => jsonResponse({ ok: true }));
  const library = createRemoteLibrary();
  assert.equal(await library.remove('9f2c1d'), undefined);

  mockFetch(t, () => jsonResponse({ error: '歌曲不存在或已删除，请重新导入。' }, 404));
  assert.equal(await library.remove('missing'), undefined);
});

test('服务端 JSON 错误信息会作为异常抛出', async (t) => {
  mockFetch(t, () => jsonResponse({ error: '数据库连接失败，请先运行 npm run db:setup / npm run db:start 后再试。' }, 503));
  const library = createRemoteLibrary();
  await assert.rejects(() => library.list(), /数据库连接失败/);
});

test('网络失败时抛出可操作的中文错误', async (t) => {
  mockFetch(t, () => {
    throw new TypeError('fetch failed');
  });
  const library = createRemoteLibrary();
  await assert.rejects(() => library.list(), /无法连接 Sonora 数据库服务/);
});

test('close() 清空缓存，之后 list() 重新请求', async (t) => {
  const calls = mockFetch(t, () => jsonResponse([sampleTrack]));
  const library = createRemoteLibrary();
  await library.list();
  await library.list();
  assert.equal(calls.length, 2, '列表不缓存');
  library.close();
  await library.list();
  assert.equal(calls.length, 3);
});

test('支持注入自定义 fetch 实现（不触碰 globalThis.fetch）', async (t) => {
  mockFetch(t, () => {
    throw new Error('不应调用全局 fetch');
  });
  const fakeFetch = async (url) => {
    assert.equal(url, 'http://example.test/api/tracks');
    return jsonResponse([{ ...sampleTrack, id: 'custom' }]);
  };
  const library = createRemoteLibrary({ baseUrl: 'http://example.test', fetch: fakeFetch });
  const tracks = await library.list();
  assert.equal(tracks[0].id, 'custom');
});

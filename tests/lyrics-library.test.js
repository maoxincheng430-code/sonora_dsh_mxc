import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLyricsLibrary,
  matchLyricEntry,
  normalizeName,
  scoreLyricEntry,
} from '../src/lyrics-library.js';

const ENTRIES = [
  {
    file: 'Aurora - Luna、Star.lrc',
    title: 'Aurora',
    artist: 'Luna / Star',
    aliases: ['a winter aurora'],
  },
  { file: 'other.lrc', title: 'Comet', artist: 'Nova' },
];

test('normalizeName strips extensions, brackets, punctuation and case', () => {
  assert.equal(normalizeName('Aurora（Live）.wav'), 'aurora');
  assert.equal(normalizeName('01. Luna - Aurora (a winter aurora).mp3'), '01lunaaurora');
  assert.equal(normalizeName('  A - B  '), 'ab');
  assert.equal(normalizeName(''), '');
  assert.equal(normalizeName(null), '');
});

test('scoreLyricEntry prefers exact title, then substring, then aliases and artist', () => {
  const exact = scoreLyricEntry(ENTRIES[0], { title: 'Aurora', name: 'Aurora.wav', artist: 'Luna' });
  const byAlias = scoreLyricEntry(ENTRIES[0], { title: 'a winter aurora', name: 'x.mp3' });
  const byName = scoreLyricEntry(ENTRIES[0], { name: 'Luna_Star - Aurora（Live）.wav' });
  const unrelated = scoreLyricEntry(ENTRIES[0], { title: 'Comet', name: 'Comet.mp3', artist: 'Nova' });
  assert.ok(exact > byName, `exact ${exact} > byName ${byName}`);
  assert.ok(byAlias > 0);
  assert.ok(byName > 0);
  assert.equal(unrelated, 0);
});

test('matchLyricEntry picks the best entry and ignores zero scores', () => {
  const hit = matchLyricEntry(ENTRIES, { name: 'Luna_Star - Aurora（Live）.wav' });
  assert.equal(hit.entry.file, 'Aurora - Luna、Star.lrc');
  assert.ok(hit.score > 0);
  assert.equal(matchLyricEntry(ENTRIES, { name: '完全无关的歌.mp3' }), null);
  assert.equal(matchLyricEntry([], { name: 'Aurora.mp3' }), null);
});

test('同名不同版本靠时长区分（132s 与 210s 剪辑）', () => {
  const VERSIONS = [
    { file: 'Aurora-210.lrc', title: 'Aurora', artist: 'Luna', duration: 210 },
    { file: 'Aurora-132.lrc', title: 'Aurora (a winter aurora)', artist: 'Luna', duration: 132 },
  ];
  const short = matchLyricEntry(VERSIONS, { title: 'Aurora', name: 'Aurora.wav', artist: 'Luna', duration: 132 });
  const long = matchLyricEntry(VERSIONS, { title: 'Aurora', name: 'Aurora.wav', artist: 'Luna', duration: 210 });
  assert.equal(short.entry.file, 'Aurora-132.lrc');
  assert.equal(long.entry.file, 'Aurora-210.lrc');
  // 时长完全对不上时宁可不返回（交给在线兜底），也不要拿错版本糊弄
  const odd = matchLyricEntry(VERSIONS, { title: 'Aurora', artist: 'Luna', duration: 60 });
  assert.equal(odd, null);
});

test('createLyricsLibrary loads index, matches and fetches LRC text', async () => {
  const requested = [];
  const fakeFetch = async (url) => {
    requested.push(url);
    if (String(url).endsWith('index.json')) {
      return { ok: true, json: async () => ({ tracks: ENTRIES }) };
    }
    return {
      ok: true,
      text: async () => '[00:00.00] 示例歌词\n[00:02.00] 第二行',
    };
  };
  const library = createLyricsLibrary({
    baseUrl: 'lyrics/',
    fetch: fakeFetch,
    document: { baseURI: 'http://127.0.0.1:5173/' },
  });
  await library.ready();
  assert.equal(library.size, 2);
  const entry = await library.match({ name: 'Aurora.mp3' });
  assert.equal(entry.file, 'Aurora - Luna、Star.lrc');
  const text = await library.get(entry);
  assert.match(text, /\[00:02\.00\]/);
  assert.ok(requested.some((url) => String(url).includes('index.json')));
  assert.ok(requested.some((url) => decodeURI(String(url)).includes('Aurora')));
});

test('createLyricsLibrary degrades quietly when index is missing or broken', async () => {
  const missing = createLyricsLibrary({
    fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }),
    document: { baseURI: 'http://localhost/' },
  });
  await missing.ready();
  assert.equal(missing.size, 0);
  assert.equal(await missing.match({ name: 'Aurora.mp3' }), null);
  assert.equal(await missing.get({ file: 'x.lrc' }), '');

  const broken = createLyricsLibrary({
    fetch: async () => { throw new Error('network'); },
    document: { baseURI: 'http://localhost/' },
  });
  await broken.ready();
  assert.equal(broken.size, 0);
});

test('createLyricsLibrary rejects non-LRC payloads (e.g. HTML error pages)', async () => {
  const library = createLyricsLibrary({
    fetch: async (url) => {
      if (String(url).endsWith('index.json')) {
        return { ok: true, json: async () => ({ tracks: ENTRIES }) };
      }
      return { ok: true, text: async () => '<!doctype html><html>404</html>' };
    },
    document: { baseURI: 'http://localhost/' },
  });
  await library.ready();
  const entry = await library.match({ name: 'Aurora.mp3' });
  assert.equal(await library.get(entry), '');
});

test('resolve falls back to backend auto search and caches the result', async () => {
  const calls = [];
  let apiHits = 0;
  const store = new Map();
  const fakeStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
  };
  const fakeFetch = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith('index.json')) return { ok: true, json: async () => ({ tracks: [] }) };
    if (String(url).includes('/api/lyrics/search')) {
      apiHits += 1;
      return { ok: true, json: async () => ({ text: '[00:01.00]自动抓到的歌词\n[00:02.00]第二句', source: 'kugou' }) };
    }
    return { ok: false, status: 404 };
  };
  const library = createLyricsLibrary({
    fetch: fakeFetch,
    storage: fakeStorage,
    apiBase: 'http://127.0.0.1:8787',
    document: { baseURI: 'http://localhost/' },
  });
  await library.ready();
  const track = { id: 'abc123', title: '未知歌', artist: '未知人', name: '未知歌.mp3' };
  const first = await library.resolve(track);
  assert.equal(first.source, 'api');
  assert.match(first.text, /自动抓到的歌词/);
  assert.equal(apiHits, 1);
  assert.ok(calls.some((url) => url.includes('title=') && url.includes('%E6%9C%AA%E7%9F%A5%E6%AD%8C')));
  // 带曲目 id 时请求应包含 trackId，让后端能写回数据库
  assert.ok(calls.some((url) => url.includes('trackId=abc123')));
  // 第二次应命中 localStorage 缓存，不再请求后端
  const second = await library.resolve(track);
  assert.equal(second.source, 'api');
  assert.equal(apiHits, 1);
});

test('resolve prefers the local lyrics library over backend search', async () => {
  let apiHits = 0;
  const library = createLyricsLibrary({
    fetch: async (url) => {
      if (String(url).endsWith('index.json')) return { ok: true, json: async () => ({ tracks: ENTRIES }) };
      if (String(url).includes('/api/lyrics/search')) { apiHits += 1; return { ok: true, json: async () => ({ text: '' }) }; }
      return { ok: true, text: async () => '[00:01.00]本地歌词\n[00:02.00]第二句' };
    },
    storage: { getItem: () => null, setItem: () => {} },
    apiBase: 'http://127.0.0.1:8787',
    document: { baseURI: 'http://localhost/' },
  });
  await library.ready();
  const result = await library.resolve({ name: 'Aurora.mp3' });
  assert.equal(result.source, 'local');
  assert.match(result.text, /本地歌词/);
  assert.equal(apiHits, 0);
});

test('resolve returns null when neither local nor backend has lyrics', async () => {
  const library = createLyricsLibrary({
    fetch: async (url) => {
      if (String(url).endsWith('index.json')) return { ok: true, json: async () => ({ tracks: [] }) };
      return { ok: false, status: 404 };
    },
    storage: { getItem: () => null, setItem: () => {} },
    apiBase: 'http://127.0.0.1:8787',
    document: { baseURI: 'http://localhost/' },
  });
  await library.ready();
  assert.equal(await library.resolve({ name: '没有歌词的歌.mp3' }), null);
});

test('setApiBase enables or disables backend auto search at runtime', async () => {
  let apiHits = 0;
  const library = createLyricsLibrary({
    fetch: async (url) => {
      if (String(url).endsWith('index.json')) return { ok: true, json: async () => ({ tracks: [] }) };
      apiHits += 1;
      return { ok: true, json: async () => ({ text: '[00:01.00]歌词\n[00:02.00]第二句' }) };
    },
    storage: { getItem: () => null, setItem: () => {} },
    document: { baseURI: 'http://localhost/' },
  });
  await library.ready();
  assert.equal(await library.resolve({ name: '无.mp3' }), null);
  library.setApiBase('http://127.0.0.1:8787/');
  assert.equal(library.apiBase, 'http://127.0.0.1:8787');
  const result = await library.resolve({ name: '无.mp3' });
  assert.equal(result.source, 'api');
  assert.ok(apiHits > 0);
});
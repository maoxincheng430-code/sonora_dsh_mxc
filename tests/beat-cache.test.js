import test from 'node:test';
import assert from 'node:assert/strict';
import { beatCacheKey, createBeatCache, normalizeBeatGrid } from '../src/beat-cache.js';

test('beatCacheKey 优先曲目 id，否则文件名+大小+修改时间', () => {
  assert.equal(beatCacheKey({ id: 'abc' }), 'abc');
  assert.equal(beatCacheKey({ name: 'a.mp3', size: 12, lastModified: 34 }), 'a.mp3|12|34');
  assert.equal(beatCacheKey(null), '');
});

test('normalizeBeatGrid 过滤脏数据并排序', () => {
  const grid = normalizeBeatGrid({
    bpm: 120,
    beats: [2, 1, NaN, -1, '3'],
    downbeats: [1, 'x', 2],
    duration: 10,
    confidence: 0.5,
  });
  assert.deepEqual(grid.beats, [1, 2, 3]);
  assert.deepEqual(grid.downbeats, [1, 2]);
  assert.equal(grid.bpm, 120);
  assert.equal(normalizeBeatGrid(null), null);
  assert.equal(normalizeBeatGrid({ beats: [1] }), null);
  assert.equal(normalizeBeatGrid({ beats: [] }), null);
});

test('createBeatCache 使用内存兜底（无 IndexedDB）', async () => {
  const cache = createBeatCache({ indexedDB: undefined });
  assert.equal(await cache.get({ id: 't1' }), null);
  const ok = await cache.set({ id: 't1' }, { bpm: 120, beats: [0.5, 1, 1.5], downbeats: [0.5], duration: 2 });
  assert.equal(ok, false, '无 IndexedDB 时写库失败但内存可用');
  const grid = await cache.get({ id: 't1' });
  assert.equal(grid.bpm, 120);
  assert.deepEqual(grid.beats, [0.5, 1, 1.5]);
  assert.equal(cache.size, 1);
  await cache.remove({ id: 't1' });
  assert.equal(await cache.get({ id: 't1' }), null);
  await cache.clear();
  assert.equal(cache.size, 0);
});

test('createBeatCache 遇到损坏缓存返回 null', async () => {
  const cache = createBeatCache({ indexedDB: undefined });
  // 直接塞一条脏数据到内存（模拟历史版本写坏）
  await cache.set('broken', { bpm: 0, beats: [], downbeats: [] });
  assert.equal(await cache.get('broken'), null);
});

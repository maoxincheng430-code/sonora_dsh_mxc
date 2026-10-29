import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHEER_INTERVAL_SECONDS,
  CHEER_TEXTS,
  COMPLETE_CHEER,
  cheerBucket,
  cheerForBucket,
  encouragementFor,
} from '../src/encouragement.js';

test('cheerBucket：未开始返回 -1，按 3 分钟分桶', () => {
  assert.equal(CHEER_INTERVAL_SECONDS, 180);
  assert.equal(cheerBucket(-1), -1);
  assert.equal(cheerBucket(NaN), -1);
  assert.equal(cheerBucket(0), 0);
  assert.equal(cheerBucket(179), 0);
  assert.equal(cheerBucket(180), 1);
  assert.equal(cheerBucket(540), 3);
  assert.equal(cheerBucket(360, 60), 6);
});

test('cheerForBucket：按桶轮换文案，函数型文案会带上分钟数', () => {
  const first = cheerForBucket(0);
  assert.equal(first.bucket, 0);
  assert.equal(typeof first.text, 'string');
  assert.ok(first.text.length > 0);
  const second = cheerForBucket(1);
  assert.notEqual(second.text, first.text);
  // 超过文案池长度后从头循环
  const wrapped = cheerForBucket(CHEER_TEXTS.length);
  assert.equal(wrapped.index, 0);
  const dynamicIndex = CHEER_TEXTS.findIndex((item) => typeof item === 'function');
  const dynamic = cheerForBucket(dynamicIndex, CHEER_TEXTS, 605);
  assert.match(dynamic.text, /10 分钟/);
});

test('encouragementFor：0 秒给第一条，未开始给 null', () => {
  assert.equal(encouragementFor(-5), null);
  const cheer = encouragementFor(185);
  assert.equal(cheer.bucket, 1);
  assert.ok(cheer.text.length > 0);
  assert.ok(CHEER_TEXTS.length >= 15, '鼓励语文案要够轮换');
  assert.ok(COMPLETE_CHEER.includes('完成'));
});

test('encouragementFor：文案池轮换一圈内不重复', () => {
  const seen = new Set();
  for (let bucket = 0; bucket < CHEER_TEXTS.length; bucket += 1) {
    const cheer = cheerForBucket(bucket);
    assert.ok(!seen.has(cheer.text), `第 ${bucket} 条重复`);
    seen.add(cheer.text);
  }
  assert.equal(seen.size, CHEER_TEXTS.length);
});

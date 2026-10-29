import test from 'node:test';
import assert from 'node:assert/strict';
import { clampToViewport } from '../src/free-mascot.js';

// 桌宠拖动相关的核心约束：拖动后的位置必须始终完整落在视口内。
const VIEWPORT = { width: 1440, height: 900 };
const SIZE = { width: 76, height: 88 };

test('拖动位置：正常范围内不变', () => {
  const point = { x: 600, y: 400 };
  const safe = clampToViewport(point, SIZE, VIEWPORT);
  assert.deepEqual(safe, { x: 600, y: 400 });
});

test('拖动位置：拖出左上角时被夹住', () => {
  const safe = clampToViewport({ x: -500, y: -300 }, SIZE, VIEWPORT);
  assert.ok(safe.x >= 0, 'x 不应为负');
  assert.ok(safe.y >= 0, 'y 不应为负');
});

test('拖动位置：拖出右下角时被夹住，保证整只桌宠可见', () => {
  const safe = clampToViewport({ x: 99999, y: 99999 }, SIZE, VIEWPORT);
  assert.ok(safe.x + SIZE.width <= VIEWPORT.width, '右边缘不应超出视口');
  assert.ok(safe.y + SIZE.height <= VIEWPORT.height, '下边缘不应超出视口');
});

test('拖动位置：大肥鱼（93×107）在同样位置也不越界', () => {
  const big = { width: 93, height: 107 };
  const safe = clampToViewport({ x: 99999, y: 99999 }, big, VIEWPORT);
  assert.ok(safe.x + big.width <= VIEWPORT.width);
  assert.ok(safe.y + big.height <= VIEWPORT.height);
});

test('拖动位置：小窗口下也能得到合法坐标', () => {
  const small = { width: 400, height: 300 };
  const safe = clampToViewport({ x: 9999, y: 9999 }, SIZE, small);
  assert.ok(Number.isFinite(safe.x) && Number.isFinite(safe.y));
  assert.ok(safe.x >= 0 && safe.y >= 0);
});
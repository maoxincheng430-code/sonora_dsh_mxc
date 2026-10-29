import test from 'node:test';
import assert from 'node:assert/strict';
import { PET_SIZE_OPTIONS, PET_BASE_SIZE, PET_SIZE_SCALE, petSizeFor } from '../src/free-mascot.js';

test('桌宠字号三档：标签与歌词面板一致', () => {
  assert.deepEqual(
    PET_SIZE_OPTIONS.map((item) => item.id),
    ['small', 'medium', 'large'],
  );
  assert.deepEqual(
    PET_SIZE_OPTIONS.map((item) => item.label),
    ['小肥鱼', '肥鱼', '大肥鱼'],
  );
});

test('petSizeFor：三档尺寸递增，且 medium 等于基准尺寸', () => {
  const small = petSizeFor('small');
  const medium = petSizeFor('medium');
  const large = petSizeFor('large');

  assert.ok(small.width < medium.width, '小肥鱼应比肥鱼小');
  assert.ok(medium.width < large.width, '大肥鱼应比肥鱼大');
  assert.ok(small.height < medium.height);
  assert.ok(medium.height < large.height);

  // medium 就是基准尺寸（歌词面板里 scale=1 的那档）
  assert.equal(medium.width, PET_BASE_SIZE.width);
  assert.equal(medium.height, PET_BASE_SIZE.height);
});

test('petSizeFor：与歌词面板的 scale 系数保持一致', () => {
  const small = petSizeFor('small');
  const large = petSizeFor('large');
  assert.equal(small.width, Math.round(PET_BASE_SIZE.width * PET_SIZE_SCALE.small));
  assert.equal(large.width, Math.round(PET_BASE_SIZE.width * PET_SIZE_SCALE.large));
  assert.equal(PET_SIZE_SCALE.medium, 1);
});

test('petSizeFor：未知档位回退 medium', () => {
  assert.deepEqual(petSizeFor('nope'), petSizeFor('medium'));
  assert.deepEqual(petSizeFor(undefined), petSizeFor('medium'));
  assert.deepEqual(petSizeFor(null), petSizeFor('medium'));
});

test('petSizeFor：返回值是整数像素', () => {
  for (const level of ['small', 'medium', 'large']) {
    const size = petSizeFor(level);
    assert.ok(Number.isInteger(size.width), `${level} width 应为整数`);
    assert.ok(Number.isInteger(size.height), `${level} height 应为整数`);
    assert.ok(size.width > 0 && size.height > 0);
  }
});
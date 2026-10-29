import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  SCENE_OPTIONS,
  PRESET_BACKGROUNDS,
  findPreset,
  presetUrl,
} from '../src/background-presets.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('氛围场景：默认 + 四种场景', () => {
  assert.equal(SCENE_OPTIONS[0].id, 'none');
  assert.equal(SCENE_OPTIONS[0].name, '默认');
  assert.deepEqual(
    SCENE_OPTIONS.map((item) => item.id),
    ['none', 'rain', 'thunder', 'beach', 'library'],
  );
  for (const item of SCENE_OPTIONS) {
    assert.ok(item.name && item.desc, `${item.id} 缺少名称/描述`);
  }
});

test('内置背景：id 唯一、图片文件真实存在', () => {
  const ids = new Set();
  for (const item of PRESET_BACKGROUNDS) {
    assert.ok(item.id && item.name, '背景缺少 id / 名称');
    assert.ok(!ids.has(item.id), `重复 id: ${item.id}`);
    ids.add(item.id);
    const file = path.join(root, 'public', item.file);
    assert.ok(existsSync(file), `缺少图片文件：${item.file}`);
  }
  assert.ok(PRESET_BACKGROUNDS.length >= 6);
});

test('findPreset 与 presetUrl', () => {
  assert.equal(findPreset('sunset')?.name, '暮光');
  assert.equal(findPreset('not-exist'), null);
  const item = findPreset('aurora');
  assert.equal(presetUrl(item, 'http://example.com/app/'), 'http://example.com/app/backgrounds/aurora.jpg');
});

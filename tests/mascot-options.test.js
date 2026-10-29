import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MASCOT_OPTIONS, DEFAULT_MASCOT_ID, findMascot } from '../src/mascot-options.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const assetExists = (rel) => existsSync(path.join(root, 'public', rel));

test('桌宠选项：id 唯一、默认项存在、素材文件真实存在', () => {
  const ids = new Set();
  for (const item of MASCOT_OPTIONS) {
    assert.ok(item.id && item.name && item.src, '桌宠缺少字段');
    assert.ok(!ids.has(item.id), `重复 id: ${item.id}`);
    ids.add(item.id);
    assert.ok(assetExists(item.src), `缺少素材：${item.src}`);
    if (item.states) {
      for (const [state, file] of Object.entries(item.states)) {
        assert.ok(assetExists(file), `${item.id}.${state} 缺少素材：${file}`);
      }
    }
  }
  assert.ok(MASCOT_OPTIONS.length >= 5);
  assert.ok(findMascot(DEFAULT_MASCOT_ID), '默认桌宠应在列表里');
});

test('findMascot 未命中返回 null', () => {
  assert.equal(findMascot('nope'), null);
  assert.equal(findMascot('cat')?.name, '小猫');
});

test('packs.json 合法：结构、唯一 id、素材存在', () => {
  const file = path.join(root, 'public', 'mascot', 'packs.json');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  assert.ok(Array.isArray(data.packs));
  const ids = new Set();
  for (const pack of data.packs) {
    assert.ok(pack.id && pack.name && pack.states, 'pack 缺少字段');
    assert.ok(!ids.has(pack.id), `重复 pack id: ${pack.id}`);
    ids.add(pack.id);
    for (const rel of Object.values(pack.states)) {
      assert.ok(assetExists(rel), `pack ${pack.id} 缺少素材：${rel}`);
    }
  }
});

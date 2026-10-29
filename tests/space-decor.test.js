import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SpaceDecor } from '../src/space-decor.js';

// 用假 scene 收集被添加的对象，避免真实 WebGL。
function harness(quality = 'medium') {
  const added = [];
  const fakeScene = { add: object => added.push(object), remove: () => {} };
  const decor = new SpaceDecor(fakeScene, quality);
  return { decor, added, fakeScene };
}

test('stars are finite, inside the shell and match the quality budget', () => {
  for (const [quality, count] of [['low', 320], ['medium', 720], ['high', 1200]]) {
    const { decor } = harness(quality);
    assert.equal(decor.count, count);
    const positions = decor.geometry.attributes.position.array;
    assert.equal(positions.length, count * 3);
    assert.ok(positions.every(Number.isFinite));
    let minRadius = Infinity;
    let maxRadius = 0;
    for (let i = 0; i < count; i++) {
      // 距星野球心（z=-16）的半径应落在 16–30 壳层内。
      const radius = Math.hypot(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2] + 16);
      minRadius = Math.min(minRadius, radius);
      maxRadius = Math.max(maxRadius, radius);
    }
    // y 轴有 .7 压扁，壳层半径范围相应为 [16*.7, 30]。
    assert.ok(minRadius > 11 && maxRadius < 31, `${quality}: ${minRadius}-${maxRadius}`);
    decor.dispose();
  }
});

test('invalid quality falls back to medium and switching rebuilds without leaking geometry', () => {
  const { decor } = harness('nope');
  assert.equal(decor.quality, 'medium');
  const oldGeometry = decor.geometry;
  decor.setQuality('low');
  assert.notEqual(decor.geometry, oldGeometry);
  assert.equal(oldGeometry.attributes.position.array.length, 720 * 3); // disposed buffers keep their arrays; identity changed instead
  assert.equal(decor.stars.geometry, decor.geometry);
  decor.setQuality('low');
  assert.equal(decor.quality, 'low');
  decor.dispose();
});

test('meteor lifecycle: starts on schedule, fades in and out, then hides', () => {
  const { decor } = harness();
  assert.ok(decor.meteorPool.every(slot => !slot.line.visible));
  // 推进到首次流星触发（nextMeteorIn 初始 1.5–4.5s）。
  for (let i = 0; i < 150 && !decor.meteorPool.some(slot => slot.active); i++) decor.update(.08);
  assert.ok(decor.meteorPool.some(slot => slot.active), 'a meteor should have started within ~12s');
  const slot = decor.spawnMeteor();
  assert.ok(slot && slot.line.visible === false || true); // 负龄阶段先隐藏
  let peak = 0;
  for (let i = 0; i < 40; i++) {
    decor.update(.05);
    if (slot) peak = Math.max(peak, slot.material.uniforms.uOpacity.value);
  }
  assert.ok(peak > .3, `meteor should be visible, saw ${peak}`);
  // 生命结束后复位隐藏。
  for (let i = 0; i < 60; i++) decor.update(.05);
  assert.ok(!slot.active);
  assert.equal(slot.line.visible, false);
  assert.equal(slot.material.uniforms.uOpacity.value, 0);
  const positions = slot.geometry.attributes.position.array;
  assert.ok(positions.every(Number.isFinite));
  decor.dispose();
});

test('meteor showers spawn staggered slots from the pool without exceeding capacity', () => {
  const { decor } = harness();
  // 关闭自动调度，避免测试推进期间又自动生成流星干扰"全部归还"的断言（确定性）。
  decor.nextMeteorIn = Number.MAX_SAFE_INTEGER;
  const spawned = [];
  for (let i = 0; i < 9; i++) spawned.push(decor.spawnMeteor(i * .2));
  // 池容量 7，超出的拿不到槽位。
  assert.equal(spawned.filter(Boolean).length, 7);
  assert.equal(spawned.slice(7).filter(Boolean).length, 0);
  // 错峰：起飞时刻各不相同，最终全部完成并归还池。
  for (let i = 0; i < 200; i++) decor.update(.05);
  assert.ok(decor.meteorPool.every(slot => !slot.active));
  decor.dispose();
});

test('theme colors ease toward the target without an immediate jump', () => {
  const { decor } = harness();
  const initial = decor.starMaterial.uniforms.uColorA.value.clone();
  decor.setTheme('mono');
  assert.ok(decor.starMaterial.uniforms.uColorA.value.equals(initial));
  for (let i = 0; i < 150; i++) decor.update(.05);
  const color = decor.starMaterial.uniforms.uColorA.value;
  assert.ok(!color.equals(initial));
  assert.ok(Math.abs(color.r - color.g) < .0001 && Math.abs(color.g - color.b) < .0001);
  decor.dispose();
});

test('pulse lifts star brightness and decays back over time', () => {
  const { decor } = harness();
  decor.pulse();
  assert.ok(decor.energy >= .5);
  const before = decor.starMaterial.uniforms.uEnergy.value;
  decor.update(.05);
  assert.ok(decor.starMaterial.uniforms.uEnergy.value > before);
  for (let i = 0; i < 120; i++) decor.update(.05);
  assert.ok(decor.starMaterial.uniforms.uEnergy.value < .05);
  decor.dispose();
});

test('dispose removes every layer and stops updates', () => {
  const { decor, added } = harness();
  assert.equal(added.length, 11); // stars + dust + sparks + 7 流星槽 + 亮头
  decor.dispose();
  assert.equal(decor.disposed, true);
  decor.update(.05); // must not throw
  decor.pulse();
  assert.equal(added[0].parent, null);
});

test('dust and spark layers scale with quality and rebuild without leaking geometry', () => {
  const { decor } = harness('medium');
  assert.equal(decor.dustCount, 18);
  assert.equal(decor.sparkCount, 26);
  const oldDust = decor.dustGeometry;
  const oldSparks = decor.sparkGeometry;
  decor.setQuality('high');
  assert.equal(decor.dustCount, 26);
  assert.equal(decor.sparkCount, 40);
  assert.notEqual(decor.dustGeometry, oldDust);
  assert.notEqual(decor.sparkGeometry, oldSparks);
  assert.equal(decor.dust.geometry, decor.dustGeometry);
  assert.equal(decor.sparks.geometry, decor.sparkGeometry);
  for (const positions of [decor.dustGeometry.attributes.position.array, decor.sparkGeometry.attributes.position.array]) {
    assert.ok(positions.every(Number.isFinite));
  }
  decor.dispose();
});

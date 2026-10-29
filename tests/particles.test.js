import test from 'node:test';
import assert from 'node:assert/strict';
import { ParticleScene, isVideoFile } from '../src/particles.js';
import * as THREE from 'three';

function animatedScene() {
  const scene = Object.create(ParticleScene.prototype);
  Object.assign(scene, {
    time: 0, energy: 0, bass: 0, mid: 0, treble: 0, punch: 0, lastBeat: 0,
    activity: 1, wavePhase: 0, fill: 0, lyricFocus: 0, lyricDim: 0, hue: 0, shakeAmp: 0,
    targetHue: 252, sensitivity: 1, type: 'wave', quality: 'medium', bandGains: { bass: 1, mid: 1, treble: 1 },
    drag: { active: false, lastX: 0, lastY: 0, vx: 0, vy: 0, manualY: 0, manualX: 0 },
    group: new THREE.Group(), core: new THREE.Group(), renderer: { render() {} },
    camera: { fov: 43, position: { z: 9.6, x: 0, y: 0.12 }, updateProjectionMatrix() {} },
  });
  scene.material = { uniforms: {
    uTime: {}, uPhase: {}, uActivity: {}, uFill: {}, uEnergy: {}, uBass: {}, uMid: {}, uTreble: {},
    uPulse: {}, uWave: {}, uMode: { value: 3 }, uLyricFocus: {}, uLyricDim: {}, uHue: {}, uPixelRatio: {},
    uColorA: { value: new THREE.Color('#8b75ff') }, uColorB: { value: new THREE.Color('#4dc8ff') }, uColorC: { value: new THREE.Color('#f5dbff') },
  } };
  scene.coreMaterial = { uniforms: { uOpacity: {}, uColor: { value: new THREE.Color('#4dc8ff') } } };
  scene.targetColors = [new THREE.Color('#8b75ff'), new THREE.Color('#4dc8ff'), new THREE.Color('#f5dbff')];
  return scene;
}

test('default scene is the layered wave mode and reports mode 3', () => {
  const scene = animatedScene();
  assert.equal(scene.type, 'wave');
  assert.equal(scene.material.uniforms.uMode.value, 3);
});

test('粒子总开关：关闭后 update 不再推进动画，重新开启后恢复', () => {
  const scene = animatedScene();
  scene.enabled = true;
  scene.renderer = { render() {}, domElement: { style: {} } };
  scene.update(.02, { volume: .5, beat: 0 }, true);
  const timeAfterFirst = scene.time;
  assert.ok(timeAfterFirst > 0);

  scene.setEnabled(false);
  assert.equal(scene.enabled, false);
  assert.equal(scene.renderer.domElement.style.visibility, 'hidden');
  scene.update(.02, { volume: .9, beat: 1 }, true);
  assert.equal(scene.time, timeAfterFirst, '关闭后不再推进时间/渲染');

  scene.setEnabled(true);
  assert.equal(scene.enabled, true);
  assert.equal(scene.renderer.domElement.style.visibility, '');
  scene.update(.02, { volume: .5, beat: 0 }, true);
  assert.ok(scene.time > timeAfterFirst, '重新开启后继续推进');
});

test('nebula positions cluster around four coherent spiral arms', () => {
  const scene = Object.create(ParticleScene.prototype);
  scene.count = 500;
  const positions = scene.createShape('nebula');
  let coherence = 0;
  for (let i = 0; i < scene.count; i++) {
    // 主层带 1.08 均匀放大，角度不变，这里归一化回来再验证四臂一致性。
    const x = positions[i * 3] / 1.08;
    const z = positions[i * 3 + 2] / .65 / 1.08;
    const radius = Math.hypot(x, z);
    coherence += Math.cos(4 * (Math.atan2(z, x) - radius * 1.7));
  }
  assert.ok(coherence / scene.count > .7);
});

test('repeated numeric impulses keep punching without retriggering on the decay tail', () => {
  const scene = animatedScene();
  scene.update(.02, { beat: 1 }, true);
  assert.equal(scene.punch, 1);
  let previous = scene.punch;
  for (const beat of [.8, .6, .4, .3, .2, .1]) {
    scene.update(.05, { beat }, true);
    assert.ok(scene.punch <= previous + 1e-9);
    previous = scene.punch;
  }
  // 尾音衰减到阈值以下后，新重拍再次打满。
  scene.update(.02, { beat: 1 }, true);
  assert.equal(scene.punch, 1);
});
test('three layers are built with distinct geometries and layer attributes', () => {
  const scene = Object.create(ParticleScene.prototype);
  scene.quality = 'low';
  scene.type = 'wave';
  scene.material = { uniforms: { uMode: { value: 3 } } };
  scene.core = { visible: false };
  scene.group = new THREE.Group();
  scene.renderer = { render() {} };
  scene.buildParticles();
  assert.equal(scene.layers.length, 3);
  const counts = scene.layers.map(points => points.geometry.attributes.position.count);
  assert.deepEqual(counts, [1200, 1600, 800]);
  scene.layers.forEach((points, layer) => {
    const attr = points.geometry.attributes.aLayer.array;
    assert.ok(attr.every(v => v === layer));
  });
});

test('theme colors ease toward neutral mono without an immediate jump', () => {
  const scene = animatedScene();
  const initial = scene.material.uniforms.uColorA.value.clone();
  scene.setTheme('mono');
  assert.ok(scene.material.uniforms.uColorA.value.equals(initial));
  scene.update(.05);
  assert.ok(!scene.material.uniforms.uColorA.value.equals(initial));
  assert.ok(!scene.material.uniforms.uColorA.value.equals(scene.targetColors[0]));
  for (let i = 0; i < 150; i++) scene.update(.05);
  const color = scene.material.uniforms.uColorA.value;
  assert.ok(Math.abs(color.r - color.g) < .00001);
  assert.ok(Math.abs(color.g - color.b) < .00001);
});

test('band gains clamp and scale each band independently', () => {
  const scene = animatedScene();
  scene.setBandGains({ bass: 5, mid: -3, treble: 0.5 });
  assert.deepEqual(scene.bandGains, { bass: 3, mid: 0, treble: 0.5 });
  const settled = animatedScene();
  for (let i = 0; i < 40; i++) settled.update(.05, { bass: 1, mid: 1, treble: 1 }, true);
  const flatBass = settled.bass;
  const boosted = animatedScene();
  boosted.setBandGains({ bass: 2, mid: 1, treble: 1 });
  for (let i = 0; i < 40; i++) boosted.update(.05, { bass: 1, mid: 1, treble: 1 }, true);
  assert.ok(boosted.bass > flatBass + .5);
});

test('lyric focus clamps and flows to the shader uniform', () => {
  const scene = animatedScene();
  scene.setLyricFocus(.8, true);
  assert.equal(scene.lyricFocus, .8);
  scene.update(.05, {}, true);
  assert.ok(scene.material.uniforms.uLyricFocus.value > .7);
  scene.setLyricFocus(.8, false);
  assert.equal(scene.lyricFocus, 0);
});

test('beat onset spikes punch, pushes the camera, then decays without retriggering', () => {
  const scene = animatedScene();
  scene.update(.02, { beat: 1 }, true);
  assert.equal(scene.punch, 1);
  assert.ok(scene.material.uniforms.uPulse.value > .9);
  assert.ok(scene.camera.fov > 43.5);
  let previous = scene.punch;
  for (let i = 0; i < 24; i++) {
    scene.update(.05, { beat: .4 }, true);
    assert.ok(scene.punch <= previous + 1e-9);
    previous = scene.punch;
  }
  assert.ok(scene.punch < .02);
  assert.ok(scene.material.uniforms.uPulse.value < .05);
  // 镜头从 resize 基准值回弹，不会漂移。
  assert.ok(Math.abs(scene.camera.fov - 43) < .01);
  // 衰减尾段之后的新重拍仍会立刻打满。
  scene.update(.02, { beat: 1 }, true);
  assert.equal(scene.punch, 1);
});

test('wave phase follows playback time and eases back after a seek', () => {
  const scene = animatedScene();
  for (let i = 0; i < 40; i++) scene.update(.05, { time: 10 }, true);
  assert.ok(Math.abs(scene.wavePhase - 10) < .1);
  // 突然 seek 到 3s：相位平滑追过去而不是瞬间跳变
  scene.wavePhase = 9;
  scene.update(.016, { time: 3 }, true);
  assert.ok(scene.wavePhase > 4 && scene.wavePhase < 9);
  for (let i = 0; i < 12; i++) scene.update(.08, { time: 3 }, true);
  assert.ok(Math.abs(scene.wavePhase - 3) < .5);
});

test('pausing eases activity down instead of hard-cutting the wave', () => {
  const scene = animatedScene();
  for (let i = 0; i < 20; i++) scene.update(.05, { volume: 1 }, true);
  assert.ok(scene.activity > .95);
  const snapshot = scene.activity;
  scene.update(.05, { volume: 1 }, false);
  assert.ok(scene.activity < snapshot);
  scene.update(.05, { volume: 1 }, false);
  scene.update(.05, { volume: 1 }, false);
  assert.ok(scene.activity > .2, `activity should decay gradually, got ${scene.activity}`);
});

test('mid and treble energy drive shader uniforms', () => {
  const scene = animatedScene();
  for (let i = 0; i < 20; i++) scene.update(.05, {}, true);
  const calmMid = scene.material.uniforms.uMid.value;
  const calmTreble = scene.material.uniforms.uTreble.value;
  for (let i = 0; i < 20; i++) scene.update(.05, { mid: 1, treble: 1 }, true);
  assert.ok(scene.material.uniforms.uMid.value > calmMid + .4);
  assert.ok(scene.material.uniforms.uTreble.value > calmTreble + .4);
});

test('prefers-reduced-motion weakens the camera push but keeps the particle pulse', () => {
  const normal = animatedScene();
  const reduced = animatedScene();
  reduced.reducedMotion = true;
  normal.update(.02, { beat: 1 }, true);
  reduced.update(.02, { beat: 1 }, true);
  const normalPush = normal.camera.fov - 43;
  const reducedPush = reduced.camera.fov - 43;
  assert.ok(normalPush > 2);
  assert.ok(reducedPush > 0 && reducedPush < normalPush * .6);
  assert.ok(reduced.material.uniforms.uPulse.value > .9);
});

test('low, mid and high energy yield finite yet distinct scene parameters', () => {
  const settle = features => {
    const scene = animatedScene();
    for (let i = 0; i < 30; i++) scene.update(.05, features, true);
    return scene;
  };
  const low = settle({ volume: .05, bass: .05, mid: .05, treble: .05 });
  const high = settle({ volume: 1, bass: 1, mid: 1, treble: 1 });
  assert.ok(high.energy > low.energy + .5);
  assert.ok(high.material.uniforms.uEnergy.value > low.material.uniforms.uEnergy.value);
  assert.ok(high.material.uniforms.uBass.value > low.material.uniforms.uBass.value + .5);
  assert.ok(high.material.uniforms.uMid.value > low.material.uniforms.uMid.value + .5);
  assert.ok(high.material.uniforms.uTreble.value > low.material.uniforms.uTreble.value + .5);
  for (const scene of [low, high]) {
    for (const key of ['uTime', 'uEnergy', 'uBass', 'uMid', 'uTreble', 'uPulse', 'uPhase', 'uFill', 'uActivity', 'uLyricFocus', 'uLyricDim', 'uHue']) {
      assert.ok(Number.isFinite(scene.material.uniforms[key].value), key);
    }
    assert.ok(Number.isFinite(scene.group.rotation.x) && Number.isFinite(scene.group.rotation.y));
    assert.ok(Number.isFinite(scene.camera.fov));
  }
});

test('all four shapes generate finite and distinct positions for layer zero', () => {
  const scene = Object.create(ParticleScene.prototype);
  scene.count = 100;
  scene.quality = 'low';
  const signatures = new Set();
  for (const type of ['sphere', 'nebula', 'rings', 'wave']) {
    const target = scene.createShape(type);
    assert.equal(target.length, 300);
    assert.ok(target.every(Number.isFinite));
    signatures.add(target.slice(0, 12).join(','));
  }
  assert.equal(signatures.size, 4);
});

test('invalid shape defaults safely to wave mode', () => {
  const scene = animatedScene();
  scene.setType('invalid');
  assert.equal(scene.type, 'wave');
  scene.setType('sphere');
  assert.equal(scene.type, 'sphere');
  assert.equal(scene.material.uniforms.uMode.value, 0);
  scene.setType('rings');
  assert.equal(scene.material.uniforms.uMode.value, 2);
});

test('sensitivity is clamped and invalid input safely resets to one', () => {
  const scene = animatedScene();
  scene.setSensitivity(-4);
  assert.equal(scene.sensitivity, 0);
  scene.setSensitivity(100);
  assert.equal(scene.sensitivity, 3);
  scene.setSensitivity(NaN);
  assert.equal(scene.sensitivity, 1);
});

test('isVideoFile 判断视频文件与图片文件', () => {
  assert.equal(isVideoFile({ name: 'a.mp4', type: 'video/mp4' }), true);
  assert.equal(isVideoFile({ name: 'a.webm', type: '' }), true);
  assert.equal(isVideoFile({ name: 'a.png', type: 'image/png' }), false);
  assert.equal(isVideoFile(null), false);
});

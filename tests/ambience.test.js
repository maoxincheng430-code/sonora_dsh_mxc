import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCENES,
  DEFAULT_VOLUME,
  createAmbience,
  rainParticles,
  waveBands,
  whiteNoiseValues,
  brownNoiseValues,
  mulberry32,
} from '../src/ambience.js';

// ---------- 最小 fake DOM（仅覆盖 ambience 用到的方法） ----------
function makeFakeEl(tag) {
  const children = [];
  const classes = new Set();
  const attrs = {};
  const el = {
    tagName: String(tag).toUpperCase(),
    className: '',
    style: {},
    children,
    parentNode: null,
    dataset: {},
    classList: {
      add(...names) {
        for (const n of names) classes.add(n);
      },
      remove(...names) {
        for (const n of names) classes.delete(n);
      },
      contains(name) {
        return classes.has(name);
      },
      toggle(name, force) {
        const on = force === undefined ? !classes.has(name) : Boolean(force);
        if (on) classes.add(name);
        else classes.delete(name);
        return on;
      },
    },
    appendChild(child) {
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parentNode = el;
      children.push(child);
      return child;
    },
    insertBefore(child, ref) {
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parentNode = el;
      const index = ref ? children.indexOf(ref) : -1;
      if (index >= 0) children.splice(index, 0, child);
      else children.push(child);
      return child;
    },
    removeChild(child) {
      const index = children.indexOf(child);
      if (index >= 0) {
        children.splice(index, 1);
        child.parentNode = null;
      }
      return child;
    },
    append(...nodes) {
      for (const n of nodes) el.appendChild(n);
    },
    remove() {
      if (el.parentNode) el.parentNode.removeChild(el);
    },
    setAttribute(name, value) {
      attrs[name] = String(value);
      if (name === 'class') el.className = String(value);
    },
    getAttribute(name) {
      return name in attrs ? attrs[name] : null;
    },
    addEventListener() {},
    removeEventListener() {},
    getContext() {
      return fakeCtx;
    },
    querySelector(selector) {
      return findChild(el, selector);
    },
    clientWidth: 0,
    clientHeight: 0,
  };
  return el;
}

function matches(el, selector) {
  if (selector.startsWith('.')) return el.classList.contains(selector.slice(1));
  return (el.tagName || '').toLowerCase() === selector.toLowerCase();
}

function findChild(el, selector) {
  if (matches(el, selector)) return el;
  for (const child of el.children) {
    const hit = findChild(child, selector);
    if (hit) return hit;
  }
  return null;
}

const fakeCtx = {
  clearRect() {},
  beginPath() {},
  moveTo() {},
  lineTo() {},
  stroke() {},
  fillRect() {},
  save() {},
  restore() {},
  scale() {},
  translate() {},
  fill() {},
  closePath() {},
  arc() {},
  rect() {},
  createLinearGradient() {
    return { addColorStop() {} };
  },
  createRadialGradient() {
    return { addColorStop() {} };
  },
};
for (const prop of ['fillStyle', 'strokeStyle', 'lineWidth', 'globalAlpha']) {
  Object.defineProperty(fakeCtx, prop, {
    set() {},
    get() {
      return undefined;
    },
    configurable: true,
  });
}

function fakeDom() {
  const body = makeFakeEl('body');
  const revoked = [];
  const doc = {
    body,
    documentElement: body,
    defaultView: { innerWidth: 1280, innerHeight: 720 },
    createElement: tag => {
      const el = makeFakeEl(tag);
      // <video> 的最小行为：记录 play/pause/load 调用，便于断言清理与自动播放。
      if (String(tag).toLowerCase() === 'video') {
        el.playCalls = 0;
        el.pauseCalls = 0;
        el.loadCalls = 0;
        el.play = () => {
          el.playCalls += 1;
          el.paused = false;
          return Promise.resolve();
        };
        el.pause = () => {
          el.pauseCalls += 1;
          el.paused = true;
        };
        el.load = () => {
          el.loadCalls += 1;
        };
      }
      return el;
    },
    createElementNS: (_ns, tag) => makeFakeEl(tag),
    createObjectURL: file => `blob:mock-${file.name}`,
    revokeObjectURL: url => revoked.push(url),
  };
  return { doc, body, revoked };
}

// ---------- fake WebAudio ----------
class FakeAudioParam {
  constructor(value = 0) {
    this.value = value;
    this.events = [];
  }
  cancelScheduledValues() { this.events.push(['cancel']); }
  setValueAtTime(value) { this.events.push(['set', value]); this.value = value; }
  exponentialRampToValueAtTime(value) { this.events.push(['exp', value]); this.value = value; }
  linearRampToValueAtTime(value) { this.events.push(['linear', value]); this.value = value; }
}

class FakeAudioNode {
  constructor(ctx, kind) {
    this.ctx = ctx;
    this.kind = kind;
    this.connections = [];
    this.started = false;
    this.stopped = false;
    if (kind === 'gain') this.gain = new FakeAudioParam(1);
    if (kind === 'filter') {
      this.type = '';
      this.frequency = new FakeAudioParam();
      this.Q = new FakeAudioParam();
    }
    if (kind === 'delay') this.delayTime = new FakeAudioParam();
    if (kind === 'osc') {
      this.type = 'sine';
      this.frequency = new FakeAudioParam();
    }
    if (kind === 'source') {
      this.buffer = null;
      this.loop = false;
    }
  }
  connect(target) {
    this.connections.push(target);
    return target;
  }
  disconnect() {}
  start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
  }
}

class FakeAudioContext {
  constructor() {
    this.currentTime = 0;
    this.state = 'suspended';
    this.destination = {};
    this.nodes = [];
    this.closed = false;
    this.resumed = 0;
    FakeAudioContext.instances.push(this);
  }
  createGain() {
    return this._node('gain');
  }
  createBufferSource() {
    return this._node('source');
  }
  createBiquadFilter() {
    return this._node('filter');
  }
  createDelay() {
    return this._node('delay');
  }
  createOscillator() {
    return this._node('osc');
  }
  createBuffer(channels, length, sampleRate) {
    return {
      numberOfChannels: channels,
      length,
      sampleRate,
      getChannelData: () => new Float32Array(length),
    };
  }
  resume() {
    this.resumed += 1;
    this.state = 'running';
    return Promise.resolve();
  }
  close() {
    this.closed = true;
    return Promise.resolve();
  }
  _node(kind) {
    const n = new FakeAudioNode(this, kind);
    this.nodes.push(n);
    return n;
  }
}
FakeAudioContext.instances = [];

// ---------- 纯函数 ----------
test('SCENES 定义完整', () => {
  assert.deepEqual(SCENES, ['none', 'rain', 'thunder', 'beach', 'library', 'image']);
  assert.equal(DEFAULT_VOLUME, 0.6);
});

test('mulberry32 同种子可复现且落在 [0,1)', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  for (const v of [a(), b()]) assert.ok(v >= 0 && v < 1);
});

test('rainParticles 数量、数值范围与可复现性', () => {
  const drops = rainParticles(40, 7);
  assert.equal(drops.length, 40);
  for (const d of drops) {
    for (const k of ['x', 'y', 'len', 'speed', 'alpha', 'sway']) {
      assert.ok(Number.isFinite(d[k]), `${k} 应为有限数值`);
    }
    assert.ok(d.x >= 0 && d.x < 1 && d.y >= 0 && d.y <= 1);
    assert.ok(d.len > 0 && d.speed > 0 && d.alpha > 0 && d.alpha <= 1);
  }
  assert.deepEqual(drops, rainParticles(40, 7));
});

test('waveBands 与噪声生成数值合法', () => {
  const bands = waveBands(5, 3);
  assert.equal(bands.length, 5);
  for (const b of bands) {
    assert.ok(Number.isFinite(b.y) && Number.isFinite(b.amp));
    assert.ok(Number.isFinite(b.speed) && Number.isFinite(b.phase));
  }
  for (const values of [whiteNoiseValues(128, 1), brownNoiseValues(128, 2)]) {
    assert.equal(values.length, 128);
    assert.ok(values.every(v => Number.isFinite(v) && v >= -1 && v <= 1));
  }
});

// ---------- 无 DOM / 无 WebAudio：静默降级 ----------
test('无 DOM 且无 AudioContext 环境不崩、可切场景与 update', () => {
  for (const scene of SCENES) {
    const amb = createAmbience({ document: null, audio: true });
    amb.setScene(scene);
    amb.setVolume(0.3);
    assert.equal(amb.getScene(), scene);
    assert.equal(amb.getState().volume, 0.3);
    assert.equal(amb.getState().audioReady, false, '无 AudioContext 时 audioReady 恒为 false');
    assert.doesNotThrow(() => amb.update(0.016));
    amb.dispose();
  }
});

// ---------- DOM 行为（fake document） ----------
test('切换场景会更新 ambience-scene-* class 且 root 前置挂载', () => {
  const { doc, body } = fakeDom();
  const amb = createAmbience({ document: doc, audio: false });
  amb.setScene('rain');
  const root = body.children[0];
  assert.ok(root, '氛围根节点应插入 body');
  assert.ok(root.classList.contains('ambience'));
  assert.ok(root.classList.contains('ambience-scene-rain'));
  assert.equal(root.dataset.scene, 'rain');
  assert.equal(root.style.zIndex, '-1', '默认 z-index:-1（body 渐变之上、内容之下）');
  amb.setScene('beach');
  assert.ok(root.classList.contains('ambience-scene-beach'));
  assert.ok(!root.classList.contains('ambience-scene-rain'));
  // zIndex 可注入，便于 Lead 调层级
  const amb2 = createAmbience({ document: doc, host: body, zIndex: 0, audio: false });
  amb2.setScene('rain');
  assert.equal(body.children[1].style.zIndex, '0');
  amb.dispose();
  amb2.dispose();
  assert.equal(body.children.length, 0, 'dispose 移除所有根节点');
});

test('image 场景：file 生成 objectURL、imageUrl 替换时回收旧 URL', () => {
  const { doc, body, revoked } = fakeDom();
  const amb = createAmbience({ document: doc, host: body, audio: false });
  amb.setScene('image', { file: { name: 'wallpaper.png' } });
  const img = findChild(body, 'img');
  assert.ok(img, 'host 内应有 <img>');
  assert.equal(img.getAttribute('src'), 'blob:mock-wallpaper.png');
  assert.ok(findChild(body, '.ambience-image'));
  // 换成 imageUrl：旧 blob 被回收
  amb.setScene('image', { imageUrl: 'https://example.test/sea.jpg' });
  assert.equal(img.getAttribute('src'), 'https://example.test/sea.jpg');
  assert.deepEqual(revoked, ['blob:mock-wallpaper.png']);
  amb.setScene('none');
  assert.ok(findChild(body, '.ambience').classList.contains('ambience-scene-none'));
  amb.dispose();
});

// ---------- 用户视频背景 ----------
test('image 场景：video 文件创建静音自动循环的 <video>，且不加 Ken Burns', () => {
  const { doc, body, revoked } = fakeDom();
  const amb = createAmbience({ document: doc, host: body, audio: false });
  amb.setScene('image', { file: { name: 'aurora.mp4', type: 'video/mp4' } });
  const video = findChild(body, 'video');
  assert.ok(video, '应创建 <video>');
  assert.ok(video.classList.contains('ambience-image-video'), '视频带 ambience-image-video class');
  assert.equal(video.getAttribute('src'), 'blob:mock-aurora.mp4', '用 objectURL 播放本地文件');
  for (const attr of ['autoplay', 'muted', 'loop', 'playsinline']) {
    assert.ok(video.getAttribute(attr) !== null, `<video> 应有 ${attr} 属性`);
  }
  assert.equal(video.muted, true, '背景视频必须静音');
  assert.equal(video.autoplay, true);
  assert.equal(video.loop, true);
  assert.equal(video.playsInline, true);
  assert.equal(video.playCalls, 1, '已尝试自动播放');
  assert.ok(!video.classList.contains('ambience-ken-burns'), '视频不能加 Ken Burns（会露边）');
  assert.equal(findChild(body, 'img'), null, '不应同时存在 <img>');
  assert.equal(amb.getState().mediaType, 'video');
  amb.dispose();
  assert.equal(revoked.length, 1, 'dispose 回收视频 objectURL');
});

test('视频 <-> 图片来回切换：旧节点移除、旧 objectURL 回收、mediaType 同步', () => {
  const { doc, body, revoked } = fakeDom();
  const amb = createAmbience({ document: doc, host: body, audio: false });
  amb.setScene('image', { file: { name: 'clip.webm', type: 'video/webm' } });
  const video = findChild(body, 'video');
  assert.equal(amb.getState().mediaType, 'video');

  // 视频 -> 图片
  amb.setScene('image', { file: { name: 'mountain.jpg', type: 'image/jpeg' } });
  const img = findChild(body, 'img');
  assert.ok(img, '切换后应有 <img>');
  assert.equal(img.getAttribute('src'), 'blob:mock-mountain.jpg');
  assert.ok(img.classList.contains('ambience-ken-burns'), '图片保留 Ken Burns');
  assert.equal(findChild(body, 'video'), null, '旧 <video> 已移除');
  assert.ok(video.pauseCalls >= 1, '旧视频已暂停');
  assert.deepEqual(revoked, ['blob:mock-clip.webm']);
  assert.equal(amb.getState().mediaType, 'image');

  // 图片 -> 视频：图片 URL 回收、图片节点移除
  amb.setScene('image', { file: { name: 'clip2.mp4', type: 'video/mp4' } });
  assert.equal(findChild(body, 'img'), null, '旧 <img> 已移除');
  assert.ok(findChild(body, 'video'));
  assert.deepEqual(revoked, ['blob:mock-clip.webm', 'blob:mock-mountain.jpg']);
  assert.equal(amb.getState().mediaType, 'video');

  amb.dispose();
  assert.equal(findChild(body, 'video'), null, 'dispose 后视频节点移除');
  assert.deepEqual(revoked, [
    'blob:mock-clip.webm',
    'blob:mock-mountain.jpg',
    'blob:mock-clip2.mp4',
  ]);
  assert.equal(amb.getState().mediaType, null);
});

test('视频场景切到 rain/none：视频节点移除、objectURL 回收、mediaType 归零', () => {
  const { doc, body, revoked } = fakeDom();
  const amb = createAmbience({ document: doc, host: body, audio: false });
  amb.setScene('image', { file: { name: 'bg.mp4', type: 'video/mp4' } });
  const video = findChild(body, 'video');
  amb.setScene('rain');
  assert.equal(findChild(body, 'video'), null, '切到 rain 后不残留视频节点');
  assert.equal(video.pauseCalls, 1, '视频已暂停');
  assert.deepEqual(revoked, ['blob:mock-bg.mp4']);
  assert.equal(amb.getState().mediaType, null);
  amb.setScene('none');
  assert.equal(findChild(body, 'video'), null);
  amb.dispose();
});

test('image 场景收到不支持的文件类型时不创建媒体节点', () => {
  const { doc, body, revoked } = fakeDom();
  const amb = createAmbience({ document: doc, host: body, audio: false });
  amb.setScene('image', { file: { name: 'song.mp3', type: 'audio/mpeg' } });
  assert.equal(findChild(body, 'img'), null);
  assert.equal(findChild(body, 'video'), null);
  assert.equal(amb.getState().mediaType, null);
  assert.deepEqual(revoked, []);
  amb.dispose();
});

test('重复 setScene 同一图片文件不重建 URL（避免 blob 泄漏）', () => {
  const { doc, body, revoked } = fakeDom();
  const amb = createAmbience({ document: doc, host: body, audio: false });
  const file = { name: 'same.png', type: 'image/png' };
  amb.setScene('image', { file });
  const img = findChild(body, 'img');
  amb.setScene('image', { file });
  assert.equal(findChild(body, 'img'), img, '复用同一个 <img> 节点');
  assert.deepEqual(revoked, [], '同一文件不重复创建/回收 URL');
  amb.dispose();
  assert.deepEqual(revoked, ['blob:mock-same.png']);
});

test('无 DOM 环境注入视频文件安全降级、不抛错', () => {
  const amb = createAmbience({ document: null, audio: false });
  assert.doesNotThrow(() => {
    amb.setScene('image', { file: { name: 'clip.mp4', type: 'video/mp4' } });
  });
  assert.equal(amb.getState().mediaType, null, '无 DOM 时不创建媒体但状态安全');
  assert.doesNotThrow(() => amb.update(0.016));
  amb.dispose();
});

test('update() 在真实 DOM 结构下逐帧不抛错（含海滩/雷声分帧）', () => {
  const { doc, body } = fakeDom();
  const amb = createAmbience({ document: doc, host: body, audio: false });
  amb.setScene('rain');
  assert.doesNotThrow(() => amb.update(0.016));
  amb.setScene('thunder');
  assert.doesNotThrow(() => amb.update(0.5));
  amb.setScene('beach');
  assert.doesNotThrow(() => amb.update(0.5));
  amb.dispose();
});

test('切换场景：新旧声音交叉淡化，旧流淡出、新流立即淡入', async () => {
  const OriginalAudioContext = globalThis.AudioContext;
  globalThis.AudioContext = FakeAudioContext;
  FakeAudioContext.instances.length = 0;
  try {
    const { doc, body } = fakeDom();
    const amb = createAmbience({ document: doc, host: body, audio: true });
    amb.setScene('rain');
    const ctx = FakeAudioContext.instances[0];
    assert.ok(ctx, '首次有声场景应创建 AudioContext');
    const startedSources = () => ctx.nodes.filter((node) => node.kind === 'source' && node.started).length;
    const before = startedSources();
    assert.ok(before > 0, '雨声应已开始播放');

    amb.setScene('beach');
    // 新声音立即起播（不再延迟 200ms），旧声音在自己的增益上淡出
    assert.ok(startedSources() > before, '新场景应立即开始播放');
    const gains = ctx.nodes.filter((node) => node.kind === 'gain');
    const rampTo = (value) => gains.some((node) => node.gain.events.some(([kind, v]) => kind === 'exp' && v === value));
    assert.ok(rampTo(1), '新流应淡入到 1');
    assert.ok(rampTo(0.0001), '旧流应淡出到 0.0001（各自独立，不再切总线）');

    // 旧流在 240ms 后被断开；新流保持
    await new Promise((resolve) => setTimeout(resolve, 300));
    amb.dispose();
  } finally {
    globalThis.AudioContext = OriginalAudioContext;
  }
});

// ---------- 音频：懒创建 + 音量 + dispose ----------
test('AudioContext 延迟到首次有声场景才创建，setVolume 控制主增益，dispose 全关', async () => {
  const OriginalAudioContext = globalThis.AudioContext;
  globalThis.AudioContext = FakeAudioContext;
  FakeAudioContext.instances.length = 0;
  try {
    const { doc, body } = fakeDom();
    const amb = createAmbience({ document: doc, host: body, audio: true });
    assert.equal(FakeAudioContext.instances.length, 0, '创建时绝不初始化音频');
    amb.setScene('none');
    assert.equal(FakeAudioContext.instances.length, 0, 'none 不创建音频');
    amb.setScene('image', { imageUrl: 'https://example.test/a.jpg' });
    assert.equal(FakeAudioContext.instances.length, 0, 'image 不创建音频');
    amb.setScene('rain');
    assert.equal(FakeAudioContext.instances.length, 1, '首次有声场景才创建 AudioContext');
    const ctx = FakeAudioContext.instances[0];
    assert.ok(ctx.nodes.length > 0);
    assert.equal(ctx.resumed, 1, '创建时顺手 resume（用户手势内）');
    assert.ok(ctx.nodes.some(n => n.kind === 'source' && n.started), '雨声源已 start');
    amb.setVolume(0.25);
    const masterGain = ctx.nodes.find(n => n.kind === 'gain');
    assert.equal(masterGain.gain.value, 0.25);
    amb.setVolume(5); // 越界钳制
    assert.equal(masterGain.gain.value, 1);
    amb.setVolume(0);
    assert.equal(masterGain.gain.value, 0, 'setVolume(0) 静音');
    // 切到 thunder：含振荡器（低频脉冲）与延迟，雷声链存在
    amb.setScene('thunder');
    // 切场景会先让旧声音淡出，新场景延迟 200ms 起播
    await new Promise((resolve) => setTimeout(resolve, 260));
    assert.ok(ctx.nodes.some(n => n.kind === 'osc' && n.started), '低频余弦脉冲振荡器已 start');
    assert.ok(ctx.nodes.some(n => n.kind === 'delay'), '抽头延迟节点存在');
    amb.dispose();
    assert.equal(ctx.closed, true, 'dispose 关闭 AudioContext');
    assert.equal(body.children.length, 0, 'dispose 移除 DOM');
    amb.setScene('rain'); // dispose 后全部 no-op
    amb.update(0.016);
    assert.equal(FakeAudioContext.instances.length, 1, '不再新建 AudioContext');
  } finally {
    if (OriginalAudioContext === undefined) delete globalThis.AudioContext;
    else globalThis.AudioContext = OriginalAudioContext;
  }
});

test('audio=false 时任何场景都不创建音频', () => {
  const OriginalAudioContext = globalThis.AudioContext;
  globalThis.AudioContext = FakeAudioContext;
  FakeAudioContext.instances.length = 0;
  try {
    const { doc, body } = fakeDom();
    const amb = createAmbience({ document: doc, host: body, audio: false });
    amb.setScene('rain');
    amb.setScene('thunder');
    amb.setScene('beach');
    assert.equal(FakeAudioContext.instances.length, 0);
    assert.equal(amb.getState().audioReady, false);
    amb.dispose();
  } finally {
    if (OriginalAudioContext === undefined) delete globalThis.AudioContext;
    else globalThis.AudioContext = OriginalAudioContext;
  }
});

test('onSceneChange 回调在场景变化时触发且可事后赋值', () => {
  const { doc, body } = fakeDom();
  const seen = [];
  const amb = createAmbience({ document: doc, host: body, audio: false });
  amb.onSceneChange = (name, options) => seen.push([name, options]);
  amb.setScene('rain', { intensity: 2 });
  amb.setScene('rain'); // 相同场景不重复回调
  amb.setScene('beach');
  assert.deepEqual(seen, [['rain', { intensity: 2 }], ['beach', {}]]);
  amb.dispose();
});
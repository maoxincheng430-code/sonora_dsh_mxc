// 光标光影跟随测试：createCursorTrail 的开关行为（enabled 初始值、setEnabled 清屏与停循环、
// 关闭后 pointermove 不再产生轨迹、prefers-reduced-motion 降级）。
// 全部基于 Node（node:test + assert/strict）+ 手动注入的最小 DOM/窗口桩，
// 不依赖真实 canvas 绘制：getContext 返回记录调用的假 2D 上下文。

import test from 'node:test';
import assert from 'node:assert/strict';
import { createCursorTrail } from '../src/cursor-trail.js';

// 最小 canvas 2D 上下文：只记录是否被清屏，绘制调用一律 no-op。
function fakeContext() {
  return {
    cleared: 0,
    clearRect() {
      this.cleared += 1;
    },
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    arc() {},
    fill() {},
    createRadialGradient() {
      return { addColorStop() {} };
    },
    set globalAlpha(value) {
      this._alpha = value;
    },
    get globalAlpha() {
      return this._alpha ?? 1;
    },
    set lineWidth(value) {
      this._lw = value;
    },
    get lineWidth() {
      return this._lw ?? 1;
    },
    set strokeStyle(value) {
      this._stroke = value;
    },
    get strokeStyle() {
      return this._stroke ?? '';
    },
    set fillStyle(value) {
      this._fill = value;
    },
    get fillStyle() {
      return this._fill ?? '';
    },
    set lineCap(value) {
      this._cap = value;
    },
    set lineJoin(value) {
      this._join = value;
    },
  };
}

// 安装最小 window/document/matchMedia/requestAnimationFrame 桩，返回可断言的句柄。
function installDom(options = {}) {
  const listeners = new Map();
  const context = fakeContext();
  const canvas = {
    className: '',
    width: 0,
    height: 0,
    style: {},
    removed: false,
    getContext: () => context,
    setAttribute() {},
    remove() {
      this.removed = true;
    },
  };
  const rafCalls = [];
  globalThis.document = {
    body: { append() {} },
    createElement: () => canvas,
  };
  globalThis.window = {
    innerWidth: 1280,
    innerHeight: 720,
    addEventListener(event, handler) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(handler);
    },
    removeEventListener(event, handler) {
      const list = listeners.get(event) ?? [];
      const index = list.indexOf(handler);
      if (index >= 0) list.splice(index, 1);
    },
  };
  globalThis.devicePixelRatio = 1;
  globalThis.requestAnimationFrame = (fn) => {
    rafCalls.push(fn);
    return rafCalls.length;
  };
  globalThis.cancelAnimationFrame = () => {};
  globalThis.matchMedia = () => ({ matches: Boolean(options.reduceMotion), addEventListener() {} });

  const fire = (event, payload) => {
    for (const handler of [...(listeners.get(event) ?? [])]) handler(payload);
  };
  return { canvas, context, fire, rafCalls, listenerCount: (event) => (listeners.get(event) ?? []).length };
}

function cleanupDom() {
  delete globalThis.document;
  delete globalThis.window;
  delete globalThis.devicePixelRatio;
  delete globalThis.requestAnimationFrame;
  delete globalThis.cancelAnimationFrame;
  delete globalThis.matchMedia;
}

test('光标光影跟随：默认开启，isEnabled 为 true', () => {
  const dom = installDom();
  try {
    const trail = createCursorTrail();
    assert.equal(trail.isEnabled(), true);
    trail.dispose();
  } finally {
    cleanupDom();
  }
});

test('光标光影跟随：enabled=false 时不启动动画循环，也不清屏', () => {
  const dom = installDom();
  try {
    const trail = createCursorTrail({ enabled: false });
    assert.equal(trail.isEnabled(), false);
    assert.equal(dom.rafCalls.length, 0, '关闭状态不请求动画帧');
    trail.dispose();
  } finally {
    cleanupDom();
  }
});

test('光标光影跟随：setEnabled(false) 清空画面并停止循环，鼠标移动不再触发', () => {
  const dom = installDom();
  try {
    const trail = createCursorTrail();
    dom.fire('pointermove', { clientX: 100, clientY: 120 });
    assert.ok(dom.rafCalls.length > 0, '移动会唤醒动画循环');

    const clearedBefore = dom.context.cleared;
    trail.setEnabled(false);
    assert.equal(trail.isEnabled(), false);
    assert.ok(dom.context.cleared > clearedBefore, '关闭时清空画布');

    const framesAfterOff = dom.rafCalls.length;
    dom.fire('pointermove', { clientX: 300, clientY: 300 });
    assert.equal(dom.rafCalls.length, framesAfterOff, '关闭后 pointermove 不再产生动画帧');
  } finally {
    cleanupDom();
  }
});

test('光标光影跟随：重新开启后恢复响应，幂等设置不重复触发副作用', () => {
  const dom = installDom();
  try {
    const trail = createCursorTrail({ enabled: false });
    trail.setEnabled(true);
    assert.equal(trail.isEnabled(), true);
    dom.fire('pointermove', { clientX: 50, clientY: 60 });
    assert.ok(dom.rafCalls.length > 0, '重新开启后鼠标移动生效');

    // 再次 setEnabled(true) 属于无变化，不应产生额外副作用。
    const frames = dom.rafCalls.length;
    trail.setEnabled(true);
    assert.equal(dom.rafCalls.length, frames);
    trail.dispose();
  } finally {
    cleanupDom();
  }
});

test('光标光影跟随：prefers-reduced-motion 下降级为 no-op', () => {
  const dom = installDom({ reduceMotion: true });
  try {
    const trail = createCursorTrail();
    assert.equal(trail.isEnabled(), false, '减少动态效果时视为关闭');
    trail.setEnabled(true);
    assert.equal(trail.isEnabled(), false, 'no-op 实现下强制开启也保持关闭');
    dom.fire('pointermove', { clientX: 10, clientY: 10 });
    assert.equal(dom.rafCalls.length, 0, '不产生任何动画帧');
    trail.dispose();
  } finally {
    cleanupDom();
  }
});

test('光标光影跟随：dispose 后 setEnabled 安全且不再监听', () => {
  const dom = installDom();
  try {
    const trail = createCursorTrail();
    trail.dispose();
    assert.equal(dom.canvas.removed, true, '画布被移除');
    assert.equal(dom.listenerCount('pointermove'), 0, '事件监听已解除');
    trail.setEnabled(false);
    assert.equal(trail.isEnabled(), true, 'dispose 后的 setEnabled 不改变状态');
  } finally {
    cleanupDom();
  }
});
// 「逃出升天」独立桌宠测试：纯函数（clampToViewport / driftOffset）+ 组件行为
// （打开 / 关闭、右键菜单、设置同步、无 DOM no-op）。
// 用最小假 DOM，不依赖浏览器。

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PET_POSITION_OPTIONS,
  PET_SIZE_OPTIONS,
  clampToViewport,
  createFreeMascot,
  driftOffset,
} from '../src/free-mascot.js';

// ---------- 纯函数 ----------

test('clampToViewport 把位置限制在视口内并留出边距', () => {
  const size = { width: 76, height: 88 };
  const viewport = { width: 1280, height: 720 };

  // 负坐标 → 贴左上边距
  assert.deepEqual(clampToViewport({ x: -50, y: -99 }, size, viewport), { x: 8, y: 8 });
  // 超出右下 → 贴右下边距
  assert.deepEqual(clampToViewport({ x: 9999, y: 9999 }, size, viewport), {
    x: 1280 - 76 - 8,
    y: 720 - 88 - 8,
  });
  // 合法值原样返回
  assert.deepEqual(clampToViewport({ x: 100, y: 200 }, size, viewport), { x: 100, y: 200 });
  // NaN 回退到边距
  const nan = clampToViewport({ x: NaN, y: NaN }, size, viewport);
  assert.equal(Number.isFinite(nan.x), true);
  assert.equal(Number.isFinite(nan.y), true);
});

test('clampToViewport 在视口极小的情况下也不会返回负值', () => {
  const result = clampToViewport({ x: 50, y: 50 }, { width: 200, height: 200 }, { width: 100, height: 100 });
  assert.ok(result.x >= 8);
  assert.ok(result.y >= 8);
});

test('driftOffset 围绕原点做有界漂移', () => {
  const origin = { x: 500, y: 400 };
  const radius = 26;
  for (const t of [0, 500, 2000, 7000, 15000]) {
    const point = driftOffset(t, origin, radius);
    assert.ok(Math.abs(point.x - origin.x) <= radius + 0.001, 'x 不超过漂移半径');
    assert.ok(Math.abs(point.y - origin.y) <= radius * 0.55 + 0.001, 'y 不超过纵向半径');
  }
  // 不同时刻应有不同位置（确实在动）
  assert.notDeepEqual(driftOffset(0, origin, radius), driftOffset(1200, origin, radius));
  // 非法时间按 0 处理
  assert.deepEqual(driftOffset(NaN, origin, radius), driftOffset(0, origin, radius));
});

test('菜单选项：三档字号与三个位置齐全', () => {
  assert.deepEqual(PET_SIZE_OPTIONS.map((item) => item.id), ['small', 'medium', 'large']);
  assert.deepEqual(PET_SIZE_OPTIONS.map((item) => item.label), ['小肥鱼', '肥鱼', '大肥鱼']);
  assert.deepEqual(PET_POSITION_OPTIONS.map((item) => item.id), ['left', 'center', 'right']);
});

// ---------- 假 DOM ----------

function fakeDom() {
  const created = [];
  const element = (tag) => {
    const attrs = {};
    const el = {
      tagName: String(tag).toUpperCase(),
      className: '',
      textContent: '',
      children: [],
      parent: null,
      hidden: false,
      dataset: {},
      style: {
        _props: {},
        setProperty(name, value) {
          this._props[name] = String(value);
        },
        getPropertyValue(name) {
          return this._props[name] ?? '';
        },
      },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 76, height: 88 }),
      setAttribute(name, value) {
        attrs[name] = String(value);
      },
      getAttribute(name) {
        return attrs[name] ?? null;
      },
      removeAttribute(name) {
        delete attrs[name];
      },
      append(...nodes) {
        for (const node of nodes) {
          if (!node) continue;
          node.parent = el;
          el.children.push(node);
        }
      },
      remove() {
        if (!el.parent) return;
        const siblings = el.parent.children;
        const index = siblings.indexOf(el);
        if (index >= 0) siblings.splice(index, 1);
        el.parent = null;
      },
      addEventListener() {},
      removeEventListener() {},
      contains(node) {
        return node === el || el.children.some((child) => child.contains?.(node));
      },
      setPointerCapture() {},
      querySelectorAll(selector) {
        // 只支持本组件用到的 `[data-xxx]` 选择器
        const match = selector.match(/^\[data-([a-z-]+)\]$/i);
        if (!match) return [];
        const key = match[1];
        const out = [];
        const walk = (node) => {
          for (const child of node.children) {
            if (child.dataset && Object.hasOwn(child.dataset, key)) out.push(child);
            walk(child);
          }
        };
        walk(el);
        return out;
      },
      classList: {
        _set: new Set(),
        add(name) {
          this._set.add(name);
          el.className = [...this._set].join(' ');
        },
        remove(name) {
          this._set.delete(name);
          el.className = [...this._set].join(' ');
        },
        toggle(name, force) {
          const should = force === undefined ? !this._set.has(name) : Boolean(force);
          if (should) this.add(name);
          else this.remove(name);
          return should;
        },
        contains(name) {
          return this._set.has(name);
        },
      },
    };
    created.push(el);
    return el;
  };
  return { doc: { createElement: element }, created };
}

// ---------- 组件 ----------

test('桌宠组件：默认关闭，open/close 切换可见性', () => {
  const fake = fakeDom();
  const pet = createFreeMascot({ document: fake.doc });
  assert.ok(pet.el, '根节点存在');
  assert.equal(pet.isOpen(), false);
  assert.equal(pet.el.hidden, true, '默认隐藏');

  pet.open();
  assert.equal(pet.isOpen(), true);
  assert.equal(pet.el.hidden, false);
  assert.equal(pet.el.getAttribute('aria-hidden'), 'false');

  pet.close();
  assert.equal(pet.isOpen(), false);
  assert.equal(pet.el.hidden, true);
  pet.dispose();
});

test('桌宠组件：右键菜单默认隐藏，setMenuState 同步选中态', () => {
  const fake = fakeDom();
  const pet = createFreeMascot({ document: fake.doc });
  const menu = fake.created.find((el) => el.className.includes('free-mascot-menu'));
  assert.ok(menu, '菜单存在');
  assert.equal(menu.hidden, true, '菜单默认隐藏');

  pet.setMenuState({ size: 'large', position: 'left' });
  const sizeButtons = fake.created.filter((el) => el.dataset?.size);
  const large = sizeButtons.find((el) => el.dataset.size === 'large');
  const small = sizeButtons.find((el) => el.dataset.size === 'small');
  assert.ok(large.classList.contains('is-active'), '大肥鱼按钮高亮');
  assert.ok(!small.classList.contains('is-active'));

  const posButtons = fake.created.filter((el) => el.dataset?.position);
  const left = posButtons.find((el) => el.dataset.position === 'left');
  assert.ok(left.classList.contains('is-active'), '居左按钮高亮');
  pet.dispose();
});

test('桌宠组件：菜单包含字号 / 位置 / 颜色 / 动作项', () => {
  const fake = fakeDom();
  const pet = createFreeMascot({ document: fake.doc });
  const sizes = fake.created.filter((el) => el.dataset?.size).map((el) => el.dataset.size);
  const positions = fake.created.filter((el) => el.dataset?.position).map((el) => el.dataset.position);
  const colors = fake.created.filter((el) => el.dataset?.color);
  const actions = fake.created
    .filter((el) => el.className.includes('free-mascot-menu-action'))
    .map((el) => el.textContent);

  assert.deepEqual(sizes, ['small', 'medium', 'large']);
  assert.deepEqual(positions, ['left', 'center', 'right']);
  assert.ok(colors.length >= 5, '至少 5 个预设颜色');
  assert.ok(actions.includes('说一句话'));
  assert.ok(actions.includes('跟随曲风配色'));
  assert.ok(actions.includes('收回面板'));
  pet.dispose();
});

test('桌宠组件：say / nextScene 更新气泡文字', () => {
  const fake = fakeDom();
  const pet = createFreeMascot({ document: fake.doc });
  const bubbleText = fake.created.find((el) => el.className.includes('free-mascot-bubble-text'));
  pet.say('测试台词');
  assert.equal(bubbleText.textContent, '测试台词');

  const line = pet.nextScene();
  assert.ok(line.includes('——'), '情景台词含分隔符');
  assert.equal(bubbleText.textContent, line);
  pet.dispose();
});

test('桌宠组件：dispose 之后 el 为 null 且调用安全', () => {
  const fake = fakeDom();
  const pet = createFreeMascot({ document: fake.doc });
  pet.open();
  pet.dispose();
  assert.equal(pet.el, null);
  pet.say('x');
  pet.close();
  pet.dispose();
});

test('桌宠组件：无 document 时返回 no-op API', () => {
  const pet = createFreeMascot({ document: null });
  assert.equal(pet.el, null);
  assert.equal(pet.isOpen(), false);
  pet.open();
  assert.equal(pet.isOpen(), true);
  pet.close();
  assert.equal(pet.isOpen(), false);
  pet.setMenuState({ size: 'small' });
  assert.equal(pet.getMenuState().size, 'small');
  pet.dispose();
});
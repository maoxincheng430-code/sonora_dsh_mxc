// 歌词颜色调色盘测试：纯颜色工具（normalizeHexColor / hslToHex / colorAtPalettePoint /
// palettePointForColor / gradientFromColor / 已保存色列表工具）+ createColorPalette 组件
// （注入假 document：结构、点击 / 拖动取色、多色保存上限、色块应用与删除、dispose、无 DOM no-op）。
// 全部基于纯 Node（node:test + assert/strict），不依赖浏览器。

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MAX_COLORS,
  DEFAULT_PALETTE_COLOR,
  colorAtPalettePoint,
  colorAtWheelPoint,
  createColorPalette,
  gradientFromColor,
  hexToHsl,
  hslToHex,
  normalizeHexColor,
  normalizeSavedColors,
  palettePointForColor,
  rememberSavedColor,
  wheelPointForColor,
} from '../src/color-palette.js';

// ---------- normalizeHexColor ----------

test('normalizeHexColor 归一化 #RRGGBB / #RGB，可省略 #', () => {
  assert.equal(normalizeHexColor('#a8dcff'), '#a8dcff');
  assert.equal(normalizeHexColor('A8DCFF'), '#a8dcff');
  assert.equal(normalizeHexColor('#A8DcFf'), '#a8dcff');
  assert.equal(normalizeHexColor('a8dcff'), '#a8dcff');
  assert.equal(normalizeHexColor('#fff'), '#ffffff');
  assert.equal(normalizeHexColor('0Af'), '#00aaff');
  assert.equal(normalizeHexColor('   #0a0a0a   '), '#0a0a0a');
});

test('normalizeHexColor 非法输入返回 null', () => {
  for (const value of [
    '',
    '   ',
    '#12345',
    '#1234567',
    '#gggggg',
    '#12zz34',
    'red',
    'rgb(1,2,3)',
    null,
    undefined,
    42,
    {},
    [],
  ]) {
    assert.equal(normalizeHexColor(value), null, `${String(value)} 应被判定为非法颜色`);
  }
});

// ---------- hslToHex ----------

test('hslToHex 基础色与角度回绕', () => {
  assert.equal(hslToHex(0, 100, 50), '#ff0000');
  assert.equal(hslToHex(60, 100, 50), '#ffff00');
  assert.equal(hslToHex(120, 100, 50), '#00ff00');
  assert.equal(hslToHex(180, 100, 50), '#00ffff');
  assert.equal(hslToHex(240, 100, 50), '#0000ff');
  assert.equal(hslToHex(300, 100, 50), '#ff00ff');
  assert.equal(hslToHex(360, 100, 50), '#ff0000');
  assert.equal(hslToHex(480, 100, 50), '#00ff00');
  assert.equal(hslToHex(-120, 100, 50), '#0000ff');
});

test('hslToHex 饱和度 / 亮度裁剪与灰阶', () => {
  assert.equal(hslToHex(0, 0, 50), '#808080');
  assert.equal(hslToHex(0, 0, 100), '#ffffff');
  assert.equal(hslToHex(0, 0, 0), '#000000');
  assert.equal(hslToHex(0, 150, 50), '#ff0000'); // s 超界裁剪
  assert.equal(hslToHex(0, 100, 150), '#ffffff'); // l 超界裁剪
  assert.equal(hslToHex(0, 100, -20), '#000000');
  assert.equal(hslToHex(NaN, NaN, NaN), '#000000');
});

// ---------- hexToHsl ----------

test('hexToHsl 与 hslToHex 往返近似一致', () => {
  for (const [hue, saturation, lightness] of [
    [0, 100, 50],
    [120, 100, 50],
    [210, 80, 60],
    [300, 65, 45],
    [45, 90, 78],
  ]) {
    const hex = hslToHex(hue, saturation, lightness);
    const back = hexToHsl(hex);
    assert.ok(Math.abs(back.h - hue) <= 1.5, `${hex} 的色相误差 ${back.h} vs ${hue}`);
    assert.ok(Math.abs(back.s - saturation) <= 1.5, `${hex} 的饱和度误差 ${back.s}`);
    assert.ok(Math.abs(back.l - lightness) <= 1, `${hex} 的亮度误差 ${back.l}`);
  }
  // 非法输入按黑色处理，不抛错。
  assert.deepEqual(hexToHsl('nope'), { h: 0, s: 0, l: 0 });
});

// ---------- colorAtPalettePoint ----------

test('colorAtPalettePoint 把 x 映射色相、y 映射亮度（78% → 38%，饱和度 85%）', () => {
  assert.equal(colorAtPalettePoint(0, 0), hslToHex(0, 85, 78));
  assert.equal(colorAtPalettePoint(0.5, 0.5), hslToHex(180, 85, 58));
  assert.equal(colorAtPalettePoint(1 / 6, 0), hslToHex(60, 85, 78));
  assert.equal(colorAtPalettePoint(1, 1), hslToHex(360, 85, 38));
  // 越界坐标裁剪；NaN 按 0 处理。
  assert.equal(colorAtPalettePoint(-1, 2), colorAtPalettePoint(0, 1));
  assert.equal(colorAtPalettePoint(2, -1), colorAtPalettePoint(1, 0));
  assert.equal(colorAtPalettePoint(NaN, NaN), colorAtPalettePoint(0, 0));
  // 板面不同位置的色相 / 亮度确实不同（x 在 0~1 之间取，0 与 1 色相首尾相接）。
  assert.notEqual(colorAtPalettePoint(0, 0), colorAtPalettePoint(0.5, 0));
  assert.notEqual(colorAtPalettePoint(0, 0), colorAtPalettePoint(0, 1));
});

test('colorAtPalettePoint 返回合法 #rrggbb', () => {
  for (const [x, y] of [
    [0, 0],
    [0.25, 0.75],
    [0.5, 0.1],
    [0.87, 0.42],
    [1, 1],
  ]) {
    const hex = colorAtPalettePoint(x, y);
    assert.equal(normalizeHexColor(hex), hex);
  }
});

// ---------- palettePointForColor ----------

test('palettePointForColor 反查色相 / 亮度坐标，非法颜色返回 null', () => {
  const red = palettePointForColor('#ff0000');
  assert.ok(red);
  assert.ok(Math.abs(red.x - 0) < 1e-6);
  assert.ok(Math.abs(red.y - 0.7) < 0.02); // 亮度 50% → (78-50)/40 = 0.7
  assert.equal(palettePointForColor('nope'), null);
  assert.equal(palettePointForColor(null), null);

  // 板面点 → 颜色 → 板面点：色相 / 亮度基本可逆。
  for (const [x, y] of [
    [0.2, 0.25],
    [0.45, 0.5],
    [0.8, 0.75],
  ]) {
    const point = palettePointForColor(colorAtPalettePoint(x, y));
    assert.ok(Math.abs(point.x - x) < 0.02, `x 反查误差 ${point.x} vs ${x}`);
    assert.ok(Math.abs(point.y - y) < 0.02, `y 反查误差 ${point.y} vs ${y}`);
  }
});

// ---------- gradientFromColor ----------

test('gradientFromColor 生成同色系三段渐变', () => {
  const gradient = gradientFromColor('#ff0000');
  assert.ok(gradient.startsWith('linear-gradient(115deg,'));
  assert.ok(gradient.endsWith('100%)'));
  const stops = gradient.match(/#[0-9a-f]{6}/g);
  assert.equal(stops.length, 3, '三段渐变');
  assert.equal(stops[1], '#ff0000', '中间段就是所选颜色');
  assert.notEqual(stops[0], stops[2], '亮端 / 暗端有层次');

  // 相同色相：亮端更亮、暗端更暗。
  const light = hexToHsl(stops[0]).l;
  const base = hexToHsl(stops[1]).l;
  const deep = hexToHsl(stops[2]).l;
  assert.ok(light > base && deep < base);

  assert.equal(gradientFromColor('nope'), null);
  assert.equal(gradientFromColor(null), null);
});

// ---------- 已保存颜色列表 ----------

test('normalizeSavedColors 去重、过滤非法值、受上限约束', () => {
  assert.deepEqual(
    normalizeSavedColors(['#fff', '#FFFFFF', '#abc', 'nope', null, 42, '#123456']),
    ['#ffffff', '#aabbcc', '#123456'],
  );
  // 'bad' 的 b / a / d 都是十六进制字符，是合法的 3 位缩写（#bbaadd）。
  assert.equal(normalizeHexColor('bad'), '#bbaadd');
  assert.deepEqual(normalizeSavedColors(['#abc', 'bad']), ['#aabbcc', '#bbaadd']);
  // 默认上限 8 个。
  const many = Array.from({ length: 12 }, (_, index) => `#${index.toString(16).padStart(6, '0')}`);
  assert.equal(normalizeSavedColors(many).length, DEFAULT_MAX_COLORS);
  // 自定义上限。
  assert.deepEqual(normalizeSavedColors(many, 3), many.slice(0, 3));
  // 非法 maxColors 回退默认上限；非数组返回空数组。
  assert.equal(normalizeSavedColors(many, 0).length, DEFAULT_MAX_COLORS);
  assert.deepEqual(normalizeSavedColors(null), []);
  assert.deepEqual(normalizeSavedColors('不是数组'), []);
});

test('rememberSavedColor 最新在前、重复选中提前、超出上限截断', () => {
  assert.deepEqual(rememberSavedColor([], '#ff0000'), ['#ff0000']);
  assert.deepEqual(rememberSavedColor(['#111111', '#222222'], '#333333'), [
    '#333333',
    '#111111',
    '#222222',
  ]);
  // 重复选中已有颜色：去重并移到最前。
  assert.deepEqual(rememberSavedColor(['#333333', '#111111', '#222222'], '#111111'), [
    '#111111',
    '#333333',
    '#222222',
  ]);
  // 大小写 / 长度归一化后同样去重。
  assert.deepEqual(rememberSavedColor(['#aabbcc'], '#ABC'), ['#aabbcc']);
  // 上限：只保留最新的 maxColors 个。
  assert.deepEqual(rememberSavedColor(['#111111', '#222222', '#333333'], '#444444', 3), [
    '#444444',
    '#111111',
    '#222222',
  ]);
  // 非法颜色不改变列表（但仍做归一化）。
  assert.deepEqual(rememberSavedColor(['nope', '#ABCDEF'], null), ['#abcdef']);
});

// ---------- createColorPalette：无 DOM 安全 no-op ----------

test('createColorPalette 无 document 时返回安全 no-op API', () => {
  const palette = createColorPalette();
  assert.equal(palette.el, null);
  assert.equal(palette.getColor(), DEFAULT_PALETTE_COLOR);
  assert.deepEqual(palette.getSavedColors(), []);
  palette.setColor('#FF8800');
  assert.equal(palette.getColor(), '#ff8800');
  palette.setColor('not-a-color');
  assert.equal(palette.getColor(), null);
  palette.setSavedColors(['#fff', '#000', '#fff', 'nope']);
  assert.deepEqual(palette.getSavedColors(), ['#ffffff', '#000000']);
  // 返回的列表是副本，外部修改不影响内部。
  palette.getSavedColors().push('#123456');
  assert.deepEqual(palette.getSavedColors(), ['#ffffff', '#000000']);
  palette.dispose();
  palette.dispose();
});

// ---------- createColorPalette：DOM 结构与默认态 ----------

test('组件 DOM：圆角板 + 点阵 + 标记 + 已保存色块结构齐全', () => {
  const fake = fakeDocument();
  const palette = createColorPalette({
    document: fake.doc,
    color: '#ff3366',
    savedColors: ['#ff0000', '#00ff00'],
    onPick: () => {},
  });
  fake.doc.body.append(palette.el);

  const root = fake.doc.querySelector('.color-palette');
  assert.ok(root);
  assert.ok(root.classList.contains('color-palette'));
  const board = fake.doc.querySelector('.color-palette-board');
  assert.ok(board, '彩虹渐变板');
  assert.equal(board.getAttribute('role'), 'slider');
  assert.ok(fake.doc.querySelector('.color-palette-dots'), '点阵覆盖层');
  const marker = fake.doc.querySelector('.color-palette-marker');
  assert.ok(marker, '白色圆环标记');
  assert.equal(marker.style._props['--color-palette-marker'], '#ff3366');

  const point = palettePointForColor('#ff3366');
  assert.equal(marker.style.left, `${(point.x * 100).toFixed(2)}%`);
  assert.equal(marker.style.top, `${(point.y * 100).toFixed(2)}%`);

  const swatches = fake.doc.querySelectorAll('.color-palette-swatch');
  assert.equal(swatches.length, 2);
  assert.deepEqual(
    swatches.map((swatch) => swatch.dataset.color),
    ['#ff0000', '#00ff00'],
  );
  assert.equal(swatches[0].style.backgroundColor, '#ff0000');
  assert.ok(swatches[0].classList.contains('color-palette-swatch'));
  assert.ok(!swatches[0].classList.contains('is-active'));
  palette.dispose();
});

// ---------- 点击选色 ----------

test('组件 DOM：点击板面选色 → onPick + 自动保存 + 标记移动', () => {
  const fake = fakeDocument();
  const picked = [];
  const savedChanges = [];
  const palette = createColorPalette({
    document: fake.doc,
    onPick: (hex) => picked.push(hex),
    onSavedColorsChange: (list) => savedChanges.push(list),
  });
  fake.doc.body.append(palette.el);
  const board = fake.doc.querySelector('.color-palette-board');

  board.dispatchEvent({ type: 'click', clientX: 100, clientY: 25 }); // rect 200x100 → x .5, y .25
  const expected = colorAtPalettePoint(0.5, 0.25);
  assert.equal(palette.getColor(), expected);
  assert.deepEqual(picked, [expected]);
  assert.deepEqual(palette.getSavedColors(), [expected]);
  assert.deepEqual(savedChanges, [[expected]]);
  assert.equal(fake.doc.querySelectorAll('.color-palette-swatch').length, 1);

  const marker = fake.doc.querySelector('.color-palette-marker');
  const markerPoint = palettePointForColor(expected);
  assert.equal(marker.style.left, `${(markerPoint.x * 100).toFixed(2)}%`);
  assert.equal(marker.style.top, `${(markerPoint.y * 100).toFixed(2)}%`);
  assert.equal(marker.style._props['--color-palette-marker'], expected);
  assert.equal(fake.doc.querySelector('.color-palette').dataset.empty, 'false');
  palette.dispose();
});

test('组件 DOM：拖动板面连续取色，松手后保存最终色（不灌满已保存列表）', () => {
  const fake = fakeDocument();
  const picked = [];
  const palette = createColorPalette({
    document: fake.doc,
    onPick: (hex) => picked.push(hex),
  });
  fake.doc.body.append(palette.el);
  const board = fake.doc.querySelector('.color-palette-board');

  board.dispatchEvent({ type: 'pointerdown', clientX: 10, clientY: 10 });
  assert.ok(fake.doc.querySelector('.color-palette').classList.contains('is-dragging'));
  fake.doc.dispatchEvent({ type: 'pointermove', clientX: 60, clientY: 20 });
  fake.doc.dispatchEvent({ type: 'pointermove', clientX: 120, clientY: 40 });
  fake.doc.dispatchEvent({ type: 'pointermove', clientX: 180, clientY: 60 });
  fake.doc.dispatchEvent({ type: 'pointerup' });

  const finalHex = colorAtPalettePoint(0.9, 0.6);
  assert.equal(palette.getColor(), finalHex);
  assert.equal(picked.at(-1), finalHex);
  assert.ok(picked.length >= 4, '按下 + 每次移动都实时预览');
  assert.deepEqual(palette.getSavedColors(), [finalHex], '松手只保存最终颜色');
  assert.ok(!fake.doc.querySelector('.color-palette').classList.contains('is-dragging'));

  // 指针事件刚处理过，随后的 click 兜底不会重复取色。
  const before = picked.length;
  board.dispatchEvent({ type: 'click', clientX: 20, clientY: 80 });
  assert.equal(picked.length, before, '点击兜底被去重');
  palette.dispose();
});

test('组件 DOM：多次点选自动保存，最多 8 个且最新的在前', () => {
  const fake = fakeDocument();
  const savedChanges = [];
  const palette = createColorPalette({
    document: fake.doc,
    onSavedColorsChange: (list) => savedChanges.push(list),
  });
  fake.doc.body.append(palette.el);
  const board = fake.doc.querySelector('.color-palette-board');

  const clicked = [];
  for (let index = 0; index < 10; index += 1) {
    const clientX = 10 + index * 18;
    board.dispatchEvent({ type: 'click', clientX, clientY: 50 });
    clicked.push(colorAtPalettePoint(clientX / 200, 0.5));
  }

  const saved = palette.getSavedColors();
  assert.equal(saved.length, DEFAULT_MAX_COLORS);
  assert.equal(saved[0], clicked.at(-1), '最新选的颜色在最前');
  assert.equal(new Set(saved).size, saved.length, '没有重复颜色');
  assert.equal(savedChanges.length, 10, '每次点选都触发列表回调');
  assert.deepEqual(savedChanges.at(-1), saved);
  palette.dispose();
});

// ---------- 已保存色块：应用 / 删除 ----------

test('组件 DOM：点已保存色块直接应用；点 × 删除并触发回调', () => {
  const fake = fakeDocument();
  const picked = [];
  const savedChanges = [];
  const removed = [];
  const palette = createColorPalette({
    document: fake.doc,
    color: '#ff0000',
    savedColors: ['#ff0000', '#00ff00', '#0000ff'],
    onPick: (hex) => picked.push(hex),
    onSavedColorsChange: (list) => savedChanges.push(list),
    onRemove: (hex) => removed.push(hex),
  });
  fake.doc.body.append(palette.el);

  let swatches = fake.doc.querySelectorAll('.color-palette-swatch');
  assert.ok(swatches[0].classList.contains('is-active'), '当前色块高亮');

  // 点色块 → 直接应用，并把它提到最前（最新选中）。
  swatches[1].click();
  assert.equal(palette.getColor(), '#00ff00');
  assert.deepEqual(picked, ['#00ff00']);
  assert.deepEqual(palette.getSavedColors(), ['#00ff00', '#ff0000', '#0000ff']);
  assert.deepEqual(savedChanges.at(-1), ['#00ff00', '#ff0000', '#0000ff']);

  // 点 × 删除色块：不改当前颜色，列表回调 + onRemove。
  swatches = fake.doc.querySelectorAll('.color-palette-swatch');
  const removeTarget = swatches[0].querySelector('.color-palette-swatch-remove');
  assert.ok(removeTarget, '色块带删除按钮');
  removeTarget.dispatchEvent({ type: 'click' });
  assert.deepEqual(palette.getSavedColors(), ['#ff0000', '#0000ff']);
  assert.deepEqual(removed, ['#00ff00']);
  assert.equal(palette.getColor(), '#00ff00', '删除色块不改变当前颜色');
  assert.equal(fake.doc.querySelectorAll('.color-palette-swatch').length, 2);
  palette.dispose();
});

// ---------- setter 不回触发回调 / 上限 / dispose ----------

test('组件 DOM：setColor/setSavedColors 只同步 UI，不触发回调', () => {
  const fake = fakeDocument();
  let picks = 0;
  let savedCalls = 0;
  const palette = createColorPalette({
    document: fake.doc,
    onPick: () => {
      picks += 1;
    },
    onSavedColorsChange: () => {
      savedCalls += 1;
    },
  });
  fake.doc.body.append(palette.el);

  palette.setColor('#123456');
  assert.equal(palette.getColor(), '#123456');
  assert.equal(fake.doc.querySelector('.color-palette-marker').style._props['--color-palette-marker'], '#123456');
  palette.setSavedColors(['#fff', '#000000', '#fff', 'nope']);
  assert.deepEqual(palette.getSavedColors(), ['#ffffff', '#000000']);
  assert.equal(fake.doc.querySelectorAll('.color-palette-swatch').length, 2);

  palette.setColor(null);
  assert.equal(palette.getColor(), null);
  assert.equal(fake.doc.querySelector('.color-palette').dataset.empty, 'true');

  assert.equal(picks, 0);
  assert.equal(savedCalls, 0);
  palette.dispose();
});

test('组件 DOM：options.maxColors 限制初始与新增色块数量', () => {
  const fake = fakeDocument();
  const palette = createColorPalette({
    document: fake.doc,
    maxColors: 3,
    savedColors: ['#111111', '#222222', '#333333', '#444444'],
  });
  fake.doc.body.append(palette.el);
  assert.deepEqual(palette.getSavedColors(), ['#111111', '#222222', '#333333']);

  const board = fake.doc.querySelector('.color-palette-board');
  board.dispatchEvent({ type: 'click', clientX: 150, clientY: 50 });
  const saved = palette.getSavedColors();
  assert.equal(saved.length, 3);
  assert.equal(saved[0], colorAtPalettePoint(0.75, 0.5));
  palette.dispose();
});

test('组件 DOM：dispose 移除节点与监听，之后调用安全', () => {
  const fake = fakeDocument();
  let picks = 0;
  const palette = createColorPalette({
    document: fake.doc,
    onPick: () => {
      picks += 1;
    },
  });
  fake.doc.body.append(palette.el);
  const board = fake.doc.querySelector('.color-palette-board');

  palette.dispose();
  assert.equal(fake.doc.querySelector('.color-palette'), null, 'dispose 后从 DOM 移除');
  board.dispatchEvent({ type: 'click', clientX: 10, clientY: 10 });
  assert.equal(picks, 0, 'dispose 后不再触发回调');
  // 之后调用不抛错，但状态不再变化（默认色 #a8dcff 保持不变）。
  palette.setColor('#ffffff');
  palette.setSavedColors(['#ffffff']);
  palette.dispose();
  assert.equal(palette.getColor(), DEFAULT_PALETTE_COLOR, 'dispose 后 setColor 不再生效');
  assert.deepEqual(palette.getSavedColors(), [], 'dispose 后 setSavedColors 不再生效');
});

test('组件 DOM：键盘方向键移动标记并预览，Enter 存入已保存列表', () => {
  const fake = fakeDocument();
  const picked = [];
  const palette = createColorPalette({
    document: fake.doc,
    color: '#ff0000',
    onPick: (hex) => picked.push(hex),
  });
  fake.doc.body.append(palette.el);
  const board = fake.doc.querySelector('.color-palette-board');

  const start = palettePointForColor('#ff0000');
  board.dispatchEvent({ type: 'keydown', key: 'ArrowRight' });
  const expected = colorAtPalettePoint(start.x + 0.02, start.y);
  assert.equal(palette.getColor(), expected);
  assert.deepEqual(picked, [expected]);
  assert.deepEqual(palette.getSavedColors(), [], '方向键只预览，不自动保存');

  board.dispatchEvent({ type: 'keydown', key: 'Enter' });
  assert.deepEqual(palette.getSavedColors(), [expected]);
  palette.dispose();
});

// ---------- 假 document / 假元素（轻量实现，仅供调色盘组件冒烟测试） ----------

function fakeDocument() {
  const createElement = (tagName = 'div') => {
    const element = {
      tagName: String(tagName).toUpperCase(),
      className: '',
      textContent: '',
      value: '',
      type: '',
      title: '',
      hidden: false,
      parent: null,
      isConnected: false,
      children: [],
      dataset: {},
      _attrs: {},
      _listeners: new Map(),
      _rect: { left: 0, top: 0, width: 200, height: 100 },
      style: {
        _props: {},
        setProperty(key, value) {
          this._props[key] = value;
        },
        removeProperty(key) {
          delete this._props[key];
        },
      },
      setAttribute(name, value) {
        this._attrs[name] = String(value);
      },
      getAttribute(name) {
        return Object.hasOwn(this._attrs, name) ? this._attrs[name] : null;
      },
      getBoundingClientRect() {
        return { ...this._rect };
      },
      append(...nodes) {
        for (const node of nodes) {
          node.parent = this;
          node.isConnected = true;
          this.children.push(node);
        }
      },
      replaceChildren(...nodes) {
        for (const child of this.children) {
          child.parent = null;
          child.isConnected = false;
        }
        this.children = [...nodes];
        for (const node of nodes) {
          node.parent = this;
          node.isConnected = true;
        }
      },
      remove() {
        if (!this.parent) return;
        this.parent.children = this.parent.children.filter((child) => child !== this);
        this.parent = null;
        this.isConnected = false;
      },
      addEventListener(event, handler) {
        if (!this._listeners.has(event)) this._listeners.set(event, new Set());
        this._listeners.get(event).add(handler);
      },
      removeEventListener(event, handler) {
        this._listeners.get(event)?.delete(handler);
      },
      dispatchEvent(rawEvent) {
        const event = rawEvent || {};
        if (!event.type) return true;
        if (!event.target) event.target = this;
        if (typeof event.preventDefault !== 'function') {
          event.preventDefault = () => {
            event.defaultPrevented = true;
          };
        }
        if (typeof event.stopPropagation !== 'function') {
          event.stopPropagation = () => {
            event.propagationStopped = true;
          };
        }
        let node = this;
        while (node && !event.propagationStopped) {
          const handlers = node._listeners.get(event.type);
          if (handlers) {
            for (const handler of [...handlers]) handler(event);
          }
          node = node.parent;
        }
        return !event.defaultPrevented;
      },
      click() {
        return this.dispatchEvent({ type: 'click' });
      },
      focus() {},
      querySelector(selector) {
        return queryWithin(this, selector);
      },
      querySelectorAll(selector) {
        return queryAllWithin(this, selector);
      },
    };
    // classList 与 className 共享同一份集合（与真实 DOM 一致）。
    const sync = () => new Set(element.className.split(/\s+/).filter(Boolean));
    const commit = (set) => {
      element.className = [...set].join(' ');
    };
    element.classList = {
      add(...names) {
        const set = sync();
        for (const name of names) set.add(name);
        commit(set);
      },
      remove(...names) {
        const set = sync();
        for (const name of names) set.delete(name);
        commit(set);
      },
      toggle(name, force) {
        const set = sync();
        const should = force === undefined ? !set.has(name) : Boolean(force);
        if (should) set.add(name);
        else set.delete(name);
        commit(set);
        return should;
      },
      contains(name) {
        return sync().has(name);
      },
    };
    return element;
  };

  const matches = (element, selector) => {
    const classes = selector
      .trim()
      .split('.')
      .filter(Boolean);
    if (classes.length === 0) return false;
    return classes.every((cls) => element.classList.contains(cls));
  };

  const queryWithin = (element, selector) => {
    for (const child of element.children) {
      if (matches(child, selector)) return child;
      const found = queryWithin(child, selector);
      if (found) return found;
    }
    return null;
  };

  const queryAllWithin = (element, selector) => {
    const found = [];
    for (const child of element.children) {
      if (matches(child, selector)) found.push(child);
      found.push(...queryAllWithin(child, selector));
    }
    return found;
  };

  const body = createElement('body');
  body.isConnected = true;

  const docListeners = new Map();
  const doc = {
    body,
    activeElement: body,
    createElement,
    querySelector: (selector) => queryWithin(body, selector),
    querySelectorAll: (selector) => queryAllWithin(body, selector),
    addEventListener(event, handler) {
      if (!docListeners.has(event)) docListeners.set(event, new Set());
      docListeners.get(event).add(handler);
    },
    removeEventListener(event, handler) {
      docListeners.get(event)?.delete(handler);
    },
    dispatchEvent(rawEvent) {
      const event = rawEvent || {};
      if (!event.type) return true;
      if (!event.target) event.target = body;
      for (const handler of [...(docListeners.get(event.type) || [])]) handler(event);
      return true;
    },
  };

  return { doc, body };
}

// ---------- 圆形调色盘（氛围色彩用）：colorAtWheelPoint / wheelPointForColor ----------

test('colorAtWheelPoint 圆心最亮、外圈更暗，角度决定色相', () => {
  const center = colorAtWheelPoint(0, 0);
  const edge = colorAtWheelPoint(0, 1);
  // 圆心（半径 0）应比边缘（半径 1）亮。
  assert.ok(hexToHsl(center).l > hexToHsl(edge).l, '圆心比边缘亮');

  // 正上方 = 0°（红），正右 = 90°，正下 = 180°，正左 = 270°。
  const top = hexToHsl(colorAtWheelPoint(0, -1)).h;
  const right = hexToHsl(colorAtWheelPoint(1, 0)).h;
  const bottom = hexToHsl(colorAtWheelPoint(0, 1)).h;
  const left = hexToHsl(colorAtWheelPoint(-1, 0)).h;
  assert.ok(Math.abs(top - 0) < 2 || Math.abs(top - 360) < 2, `正上方应接近 0°，实际 ${top}`);
  assert.ok(Math.abs(right - 90) < 2, `正右方应接近 90°，实际 ${right}`);
  assert.ok(Math.abs(bottom - 180) < 2, `正下方应接近 180°，实际 ${bottom}`);
  assert.ok(Math.abs(left - 270) < 2, `正左方应接近 270°，实际 ${left}`);
});

test('colorAtWheelPoint 越界坐标裁剪到圆内，非法值按圆心处理', () => {
  // 越界只裁剪“半径”，方向保持不变：所以 (3,4) 与同方向的 (0.6,0.8) 等价。
  assert.equal(colorAtWheelPoint(3, 4), colorAtWheelPoint(0.6, 0.8), '超出半径按同方向边缘处理');
  assert.equal(
    hexToHsl(colorAtWheelPoint(0, 9)).l,
    hexToHsl(colorAtWheelPoint(0, 1)).l,
    '越界后亮度等于边缘亮度',
  );
  assert.equal(colorAtWheelPoint(NaN, 0), colorAtWheelPoint(0, 0), 'NaN 按圆心处理');
});

test('wheelPointForColor 与 colorAtWheelPoint 互为反函数（色相 / 亮度近似往返）', () => {
  for (const hex of ['#7e48f0', '#4dc8ff', '#ffb347']) {
    const point = wheelPointForColor(hex);
    assert.ok(point, `${hex} 应能反查坐标`);
    assert.ok(Math.hypot(point.dx, point.dy) <= 1.0001, '反查结果落在单位圆内');
    const back = colorAtWheelPoint(point.dx, point.dy);
    const before = hexToHsl(hex);
    const after = hexToHsl(back);
    assert.ok(Math.abs(before.h - after.h) < 6, `${hex} 色相往返误差应较小`);
    assert.ok(Math.abs(before.l - after.l) < 8, `${hex} 亮度往返误差应较小`);
  }
  assert.equal(wheelPointForColor('nope'), null);
  assert.equal(wheelPointForColor(null), null);
});

test('圆形调色盘：shape=circle 时点选走色轮映射，标记落在圆内', () => {
  const fake = fakeDocument();
  const picked = [];
  const palette = createColorPalette({
    document: fake.doc,
    shape: 'circle',
    color: '#7e48f0',
    onPick: (hex) => picked.push(hex),
  });
  fake.doc.body.append(palette.el);
  const root = fake.doc.querySelector('.color-palette');
  assert.ok(root.className.includes('color-palette--circle'), '根节点带圆形修饰类');
  const board = fake.doc.querySelector('.color-palette-board');
  assert.equal(board.getAttribute('aria-label'), '圆形调色盘（点击或拖动选色）');

  // 板面 100x100，圆心 (50,50)：点正上方 30px 处 → 半径 0.4 → 色相 0（红）。
  board.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 });
  board.dispatchEvent({ type: 'pointerdown', clientX: 50, clientY: 20, button: 0, pointerId: 1 });
  assert.equal(picked.length, 1, 'pointerdown 触发一次选色');
  const hue = hexToHsl(picked[0]).h;
  assert.ok(Math.abs(hue) < 6 || Math.abs(hue - 360) < 6, `正上方应接近红色，实际色相 ${hue}`);

  // 标记位置应落在单位圆内（圆形盘用 dx/dy 定位）。
  const marker = fake.doc.querySelector('.color-palette-marker');
  const left = Number.parseFloat(marker.style.left);
  const top = Number.parseFloat(marker.style.top);
  assert.ok(Math.hypot(left - 50, top - 50) <= 50.001, '标记落在圆内');
  palette.dispose();
});

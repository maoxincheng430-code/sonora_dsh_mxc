// 歌词面板组件测试：open/close 状态、setText/getText、onApply 触发、示例 / 导入 / 清空流程、
// Esc 与遮罩关闭、拖动、dispose。全部基于 Node（node:test + assert/strict）+ 注入的假 document。

import test from 'node:test';
import assert from 'node:assert/strict';
import { createLyricsPanel } from '../src/lyrics-panel.js';
import { DEMO_LYRICS, demoLyricLines } from '../src/lyrics.js';
import { colorAtPalettePoint } from '../src/color-palette.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function openPanel(options = {}) {
  const fake = fakeDocument();
  const applied = [];
  const panel = createLyricsPanel({
    document: fake.doc,
    onApply: (text) => applied.push(text),
    ...options,
  });
  panel.attach(fake.body);
  const root = fake.doc.querySelector('.lyrics-panel');
  return { ...fake, panel, applied, root };
}

// ---------- 显示 / 关闭状态 ----------

test('面板：创建后默认隐藏，attach 后挂载到宿主', () => {
  const { panel, root, doc, body } = openPanel();
  assert.ok(root, '面板已挂载');
  assert.equal(root.parent, body);
  assert.equal(root.getAttribute('aria-hidden'), 'true');
  assert.equal(root.hidden, true, '默认用 hidden 兜底隐藏（即使 CSS 未加载）');
  assert.ok(!root.classList.contains('lyrics-panel-open'));
  assert.equal(panel.isOpen(), false);
  panel.dispose();
});

test('面板：open/close 切换可见状态且幂等', () => {
  const { panel, root } = openPanel();
  panel.open();
  assert.equal(panel.isOpen(), true);
  assert.ok(root.classList.contains('lyrics-panel-open'));
  assert.equal(root.getAttribute('aria-hidden'), 'false');
  assert.equal(root.hidden, false);

  // 重复 open / close 不抛错也不改变最终状态。
  panel.open();
  assert.equal(panel.isOpen(), true);
  panel.close();
  panel.close();
  assert.equal(panel.isOpen(), false);
  assert.ok(!root.classList.contains('lyrics-panel-open'));
  assert.equal(root.getAttribute('aria-hidden'), 'true');
  assert.equal(root.hidden, true);

  // 关闭后可以再次打开。
  panel.open();
  assert.equal(panel.isOpen(), true);
  panel.dispose();
});

test('面板：Esc 关闭，点击遮罩关闭，点击卡片本身不关闭', () => {
  const { panel, doc, root } = openPanel();

  panel.open();
  doc.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert.equal(panel.isOpen(), false, 'Esc 关闭面板');

  // 面板已关闭时按 Esc 无副作用。
  doc.dispatchEvent({ type: 'keydown', key: 'Enter' });
  assert.equal(panel.isOpen(), false);

  panel.open();
  doc.querySelector('.lyrics-panel-backdrop').dispatchEvent({ type: 'click' });
  assert.equal(panel.isOpen(), false, '点击遮罩关闭面板');

  panel.open();
  doc.querySelector('.lyrics-panel-card').dispatchEvent({ type: 'click' });
  assert.equal(panel.isOpen(), true, '点击卡片本身不关闭');

  // 右上角关闭按钮。
  doc.querySelector('.lyrics-panel-close').click();
  assert.equal(panel.isOpen(), false, '关闭按钮关闭面板');
  assert.ok(root.classList.contains('lyrics-panel'));
  panel.dispose();
});

// ---------- setText / getText / setStatus ----------

test('面板：setText/getText 往返保留换行，空值安全', () => {
  const { panel } = openPanel();
  const lrc = '[00:01.00]第一句\n[00:05.50]第二句';
  panel.setText(lrc);
  assert.equal(panel.getText(), lrc);

  panel.setText('');
  assert.equal(panel.getText(), '');
  panel.setText(null);
  assert.equal(panel.getText(), '');
  panel.setText(undefined);
  assert.equal(panel.getText(), '');
  panel.setText('[00:01.00]数字转字符串');
  assert.equal(panel.getText(), '[00:01.00]数字转字符串');
  panel.dispose();
});

test('面板：setStatus 写入文案与语气，空文案隐藏', () => {
  const { panel, doc } = openPanel();
  const status = doc.querySelector('.lyrics-panel-status');

  panel.setStatus('已应用 3 行歌词。', 'success');
  assert.equal(status.textContent, '已应用 3 行歌词。');
  assert.equal(status.dataset.tone, 'success');
  assert.equal(status.hidden, false);
  assert.ok(status.classList.contains('is-success'));

  panel.setStatus('出错了', 'error');
  assert.equal(status.dataset.tone, 'error');
  assert.ok(status.classList.contains('is-error'));

  panel.setStatus('普通提示');
  assert.equal(status.dataset.tone, 'info');
  assert.ok(!status.classList.contains('is-error'));

  panel.setStatus('');
  assert.equal(status.hidden, true);
  panel.dispose();
});

// ---------- 载入示例 + 应用 ----------

test('面板：载入示例歌词后应用，onApply 收到完整示例 LRC 并自动关闭', () => {
  const { panel, doc, applied } = openPanel();
  panel.open();
  doc.querySelector('.lyrics-panel-demo').click();

  assert.equal(panel.getText(), DEMO_LYRICS);
  const status = doc.querySelector('.lyrics-panel-status');
  assert.ok(status.textContent.includes(String(demoLyricLines().length)), '状态提示示例行数');

  doc.querySelector('.lyrics-panel-apply').click();
  assert.equal(applied.length, 1);
  assert.equal(applied[0], DEMO_LYRICS, '合法 LRC 原样交给 onApply');
  assert.equal(panel.isOpen(), false, '应用后关闭面板，露出歌词舞台');
  panel.dispose();
});

// ---------- 纯文本粘贴：自动补时间轴 ----------

test('面板：粘贴纯文本也能应用（自动补齐时间轴）', () => {
  const { panel, doc, applied } = openPanel();
  panel.open();
  panel.setText('夜色缓缓落下\n\n星光在指尖融化');

  doc.querySelector('.lyrics-panel-apply').click();
  assert.equal(applied.length, 1);
  assert.equal(applied[0], '[00:00.00]夜色缓缓落下\n[00:04.00]星光在指尖融化');
  assert.equal(panel.getText(), applied[0], 'textarea 同步显示补齐后的 LRC');
  assert.ok(doc.querySelector('.lyrics-panel-status').textContent.includes('自动补齐'));
  panel.dispose();
});

test('面板：空内容不触发 onApply，并给出错误提示', () => {
  const { panel, doc, applied } = openPanel();
  panel.open();
  panel.setText('   \n  ');

  doc.querySelector('.lyrics-panel-apply').click();
  assert.equal(applied.length, 0, '空歌词不应用');
  assert.equal(panel.isOpen(), true, '出错时面板保持打开');
  const status = doc.querySelector('.lyrics-panel-status');
  assert.equal(status.dataset.tone, 'error');
  assert.ok(status.textContent.includes('还没有歌词内容'));
  panel.dispose();
});

// ---------- 导入 .lrc 文件 ----------

test('面板：导入文件读取文本填入 textarea（异步 file.text）', async () => {
  const { panel, doc, applied } = openPanel();
  panel.open();

  const fileInput = doc.querySelector('.lyrics-panel-file');
  assert.equal(fileInput.type, 'file');
  assert.equal(fileInput.getAttribute('accept'), '.lrc,.txt,text/plain');

  // 点击「导入 .lrc 文件」按钮不应抛错（真实浏览器里会弹出文件选择框）。
  doc.querySelector('.lyrics-panel-import').click();

  fileInput.files = [
    {
      name: '夜航.lrc',
      text: async () => '[00:01.00]起航\n[00:05.00]星光',
    },
  ];
  fileInput.dispatchEvent({ type: 'change' });
  await tick();

  assert.equal(panel.getText(), '[00:01.00]起航\n[00:05.00]星光');
  assert.ok(doc.querySelector('.lyrics-panel-status').textContent.includes('2 行'));
  assert.equal(fileInput.value, '', '读取后清空 input，便于再次导入同一个文件');

  doc.querySelector('.lyrics-panel-apply').click();
  assert.equal(applied.at(-1), '[00:01.00]起航\n[00:05.00]星光');
  panel.dispose();
});

test('面板：导入没有时间轴的纯文本文件，提示会自动补时间轴', async () => {
  const { panel, doc } = openPanel();
  panel.open();
  const fileInput = doc.querySelector('.lyrics-panel-file');
  fileInput.files = [{ name: '歌词.txt', text: async () => '第一句\n第二句' }];
  fileInput.dispatchEvent({ type: 'change' });
  await tick();

  const status = doc.querySelector('.lyrics-panel-status');
  assert.ok(status.textContent.includes('没有找到时间标签'));
  assert.equal(panel.getText(), '第一句\n第二句');
  panel.dispose();
});

test('面板：导入读取失败时显示错误且不崩溃', async () => {
  const { panel, doc } = openPanel();
  panel.open();
  const fileInput = doc.querySelector('.lyrics-panel-file');
  fileInput.files = [
    {
      name: '坏文件.lrc',
      text: async () => {
        throw new Error('读取失败');
      },
    },
  ];
  fileInput.dispatchEvent({ type: 'change' });
  await tick();

  const status = doc.querySelector('.lyrics-panel-status');
  assert.equal(status.dataset.tone, 'error');
  assert.ok(status.textContent.includes('读取失败'));
  assert.equal(panel.getText(), '');
  panel.dispose();
});

// ---------- 清空 ----------

test('面板：清空按钮清空文本并回调 onApply("")', () => {
  const { panel, doc, applied } = openPanel();
  panel.open();
  panel.setText(DEMO_LYRICS);

  doc.querySelector('.lyrics-panel-clear').click();
  assert.equal(panel.getText(), '');
  assert.deepEqual(applied, ['']);
  assert.ok(doc.querySelector('.lyrics-panel-status').textContent.includes('已清空'));
  panel.dispose();
});

// ---------- 拖动 ----------

test('面板：拖动头部移动卡片，松手后停止跟随', () => {
  const { panel, doc } = openPanel();
  panel.open();
  const header = doc.querySelector('.lyrics-panel-header');
  const card = doc.querySelector('.lyrics-panel-card');

  header.dispatchEvent({ type: 'pointerdown', clientX: 100, clientY: 100 });
  doc.dispatchEvent({ type: 'pointermove', clientX: 130, clientY: 90 });
  assert.equal(card.style.transform, 'translate(30px, -10px)');
  assert.ok(card.classList.contains('lyrics-panel-dragging'));

  doc.dispatchEvent({ type: 'pointerup' });
  assert.ok(!card.classList.contains('lyrics-panel-dragging'));
  // 松手后再移动不再改变位置（拖动监听已移除）。
  doc.dispatchEvent({ type: 'pointermove', clientX: 400, clientY: 400 });
  assert.equal(card.style.transform, 'translate(30px, -10px)');
  panel.dispose();
});

// ---------- dispose / 无 DOM 环境 ----------

test('面板：dispose 移除节点与监听，之后调用安全', () => {
  const { panel, doc, root } = openPanel();
  panel.open();
  panel.dispose();
  assert.equal(panel.isOpen(), false);
  assert.equal(doc.body.children.includes(root), false, 'dispose 后从 DOM 移除');
  // 之后的方法调用不应抛错。
  panel.open();
  panel.close();
  panel.setText('x');
  assert.equal(panel.getText(), '');
  panel.setStatus('提示');
  panel.attach(doc.body);
  panel.dispose();
});

test('面板：无 document 环境（Node 直接创建）安全 no-op', () => {
  const panel = createLyricsPanel({ onApply: () => {} });
  assert.equal(panel.isOpen(), false);
  panel.open();
  panel.close();
  panel.setText('[00:01.00]无 DOM');
  assert.equal(panel.getText(), '');
  panel.setStatus('无 DOM 提示');
  panel.attach();
  panel.dispose();
});

// ---------- 歌词显示设置（模式 / 位置） ----------

test('面板：默认经典 + 居中，按钮状态与 aria 同步', () => {
  const { panel, doc } = openPanel();
  const modeButtons = doc.querySelectorAll('.lyrics-panel-mode-button');
  const positionButtons = doc.querySelectorAll('.lyrics-panel-position-button');
  assert.equal(modeButtons.length, 20);
  assert.equal(positionButtons.length, 3);

  assert.deepEqual(
    modeButtons.map((button) => button.dataset.mode),
    [
      'classic',
      'tilt3d',
      'karaoke',
      'apple',
      'typewriter',
      'glow',
      'cinema',
      'bounce',
      'outline',
      'island',
      'focus',
      'duet',
      'drift',
      'swing',
      'vertical',
      'kinetic',
      'glitch',
      'scatter',
      'pulse',
      'chat',
    ],
  );
  assert.deepEqual(
    positionButtons.map((button) => button.dataset.position),
    ['left', 'center', 'right'],
  );

  assert.deepEqual(panel.getDisplay(), { mode: 'classic', position: 'center' });
  const classic = modeButtons[0];
  const center = positionButtons[1];
  assert.ok(classic.classList.contains('is-active'));
  assert.equal(classic.getAttribute('aria-pressed'), 'true');
  assert.ok(center.classList.contains('is-active'));
  assert.equal(center.getAttribute('aria-pressed'), 'true');
  assert.ok(!modeButtons[1].classList.contains('is-active'));
  panel.dispose();
});

test('面板：点击切换模式 / 位置会回调并同步选中态', () => {
  const fake = fakeDocument();
  const modes = [];
  const positions = [];
  const panel = createLyricsPanel({
    document: fake.doc,
    onModeChange: (mode) => modes.push(mode),
    onPositionChange: (position) => positions.push(position),
  });
  panel.attach(fake.body);

  const modeButtons = fake.doc.querySelectorAll('.lyrics-panel-mode-button');
  const positionButtons = fake.doc.querySelectorAll('.lyrics-panel-position-button');

  modeButtons[1].click();
  assert.deepEqual(modes, ['tilt3d']);
  assert.equal(panel.getDisplay().mode, 'tilt3d');
  assert.ok(modeButtons[1].classList.contains('is-active'));
  assert.ok(!modeButtons[0].classList.contains('is-active'));
  assert.equal(modeButtons[1].getAttribute('aria-pressed'), 'true');

  // 重复点当前模式不重复回调。
  modeButtons[1].click();
  assert.deepEqual(modes, ['tilt3d']);

  positionButtons[2].click();
  assert.deepEqual(positions, ['right']);
  assert.equal(panel.getDisplay().position, 'right');
  assert.ok(positionButtons[2].classList.contains('is-active'));
  assert.ok(!positionButtons[1].classList.contains('is-active'));

  positionButtons[0].click();
  assert.deepEqual(positions, ['right', 'left']);
  panel.dispose();
});

test('面板：options.mode/position 作为初始值，setDisplay 只同步 UI 不回调', () => {
  const fake = fakeDocument();
  const modes = [];
  const positions = [];
  const panel = createLyricsPanel({
    document: fake.doc,
    mode: 'tilt3d',
    position: 'right',
    onModeChange: (mode) => modes.push(mode),
    onPositionChange: (position) => positions.push(position),
  });
  panel.attach(fake.body);

  assert.deepEqual(panel.getDisplay(), { mode: 'tilt3d', position: 'right' });
  const modeButtons = fake.doc.querySelectorAll('.lyrics-panel-mode-button');
  assert.ok(modeButtons[1].classList.contains('is-active'));

  panel.setDisplay({ mode: 'classic', position: 'left' });
  assert.deepEqual(panel.getDisplay(), { mode: 'classic', position: 'left' });
  assert.ok(modeButtons[0].classList.contains('is-active'));
  assert.deepEqual(modes, [], 'setDisplay 不回触发 onModeChange');
  assert.deepEqual(positions, [], 'setDisplay 不回触发 onPositionChange');

  // 非法值回退默认。
  panel.setDisplay({ mode: 'nope', position: 'top' });
  assert.deepEqual(panel.getDisplay(), { mode: 'classic', position: 'center' });
  panel.dispose();
});

test('面板：无 document 环境下 setDisplay/getDisplay 安全可用', () => {
  const panel = createLyricsPanel({ mode: 'tilt3d' });
  assert.equal(panel.getDisplay().mode, 'tilt3d');
  assert.equal(panel.getDisplay().position, 'center');
  panel.setDisplay({ position: 'left' });
  assert.equal(panel.getDisplay().position, 'left');
  panel.setDisplay();
  assert.deepEqual(panel.getDisplay(), { mode: 'tilt3d', position: 'left' });
  panel.dispose();
});

// ---------- 歌词颜色（调色盘 + 多色保存 + 跟随曲风） ----------

test('面板：颜色行默认跟随曲风，调色盘 / 重置按钮 / 空已保存区就绪', () => {
  const { panel, doc } = openPanel();
  const row = doc.querySelector('.lyrics-panel-color-row');
  assert.ok(row, '「歌词显示」区有颜色行');
  assert.ok(doc.querySelector('.color-palette'), '调色盘组件已渲染');
  assert.ok(doc.querySelector('.color-palette-board'));
  assert.ok(doc.querySelector('.color-palette-marker'));

  assert.equal(panel.getColor(), null);
  assert.deepEqual(panel.getSavedColors(), []);
  assert.equal(doc.querySelector('.lyrics-panel-color-value').textContent, '跟随曲风');
  const reset = doc.querySelector('.lyrics-panel-color-reset');
  assert.equal(reset.textContent, '跟随曲风');
  assert.equal(reset.getAttribute('aria-pressed'), 'true');
  assert.equal(doc.querySelectorAll('.color-palette-swatch').length, 0);
  assert.equal(doc.querySelector('.color-palette').dataset.empty, 'true', '无自定义色时标记隐藏');
  panel.dispose();
});

test('面板：options.color / savedColors 作为初始值渲染预览与色块（归一化 + 上限）', () => {
  const fake = fakeDocument();
  const panel = createLyricsPanel({
    document: fake.doc,
    color: '#FF8800',
    savedColors: ['#ff0000', '#00FF00', 'bad', '#ff0000'],
    maxColors: 2,
  });
  panel.attach(fake.body);

  assert.equal(panel.getColor(), '#ff8800');
  assert.deepEqual(panel.getSavedColors(), ['#ff0000', '#00ff00']);
  assert.equal(fake.doc.querySelector('.lyrics-panel-color-value').textContent, '#ff8800');
  const swatches = fake.doc.querySelectorAll('.color-palette-swatch');
  assert.equal(swatches.length, 2);
  assert.deepEqual(
    swatches.map((swatch) => swatch.dataset.color),
    ['#ff0000', '#00ff00'],
  );
  const marker = fake.doc.querySelector('.color-palette-marker');
  assert.equal(marker.style._props['--color-palette-marker'], '#ff8800');
  assert.ok(marker.style.left.endsWith('%'));
  panel.dispose();
});

test('面板：点击调色盘选色 → onColorChange + 自动保存色块 + 预览更新', () => {
  const fake = fakeDocument();
  const colors = [];
  const savedLists = [];
  const panel = createLyricsPanel({
    document: fake.doc,
    onColorChange: (color) => colors.push(color),
    onSavedColorsChange: (list) => savedLists.push(list),
  });
  panel.attach(fake.body);

  const board = fake.doc.querySelector('.color-palette-board');
  board.dispatchEvent({ type: 'click', clientX: 60, clientY: 30 }); // rect 240x120
  const expected = colorAtPalettePoint(60 / 240, 30 / 120);

  assert.deepEqual(colors, [expected]);
  assert.equal(panel.getColor(), expected);
  assert.equal(fake.doc.querySelector('.lyrics-panel-color-value').textContent, expected);
  assert.equal(fake.doc.querySelector('.lyrics-panel-color-preview').style.background, expected);
  assert.deepEqual(panel.getSavedColors(), [expected]);
  assert.deepEqual(savedLists.at(-1), [expected]);
  assert.equal(fake.doc.querySelectorAll('.color-palette-swatch').length, 1);
  assert.equal(fake.doc.querySelector('.color-palette').dataset.empty, 'false');
  panel.dispose();
});

test('面板：点已保存色块直接应用并置顶；点 × 删除只更新列表不改颜色', () => {
  const fake = fakeDocument();
  const colors = [];
  const savedLists = [];
  const panel = createLyricsPanel({
    document: fake.doc,
    savedColors: ['#ff0000', '#00ff00', '#0000ff'],
    onColorChange: (color) => colors.push(color),
    onSavedColorsChange: (list) => savedLists.push(list),
  });
  panel.attach(fake.body);

  fake.doc.querySelectorAll('.color-palette-swatch')[1].click();
  assert.deepEqual(colors, ['#00ff00']);
  assert.equal(panel.getColor(), '#00ff00');
  assert.deepEqual(panel.getSavedColors(), ['#00ff00', '#ff0000', '#0000ff'], '最新选中置顶');
  assert.deepEqual(savedLists.at(-1), ['#00ff00', '#ff0000', '#0000ff']);

  const swatches = fake.doc.querySelectorAll('.color-palette-swatch');
  const removeTarget = swatches[0].querySelector('.color-palette-swatch-remove');
  assert.ok(removeTarget);
  removeTarget.dispatchEvent({ type: 'click' });
  assert.deepEqual(panel.getSavedColors(), ['#ff0000', '#0000ff']);
  assert.deepEqual(savedLists.at(-1), ['#ff0000', '#0000ff']);
  assert.equal(panel.getColor(), '#00ff00', '删除色块不改变当前颜色');
  assert.equal(fake.doc.querySelectorAll('.color-palette-swatch').length, 2);
  panel.dispose();
});

test('面板：「跟随曲风」重置颜色为 null、恢复渐变预览，已保存色块保留', () => {
  const fake = fakeDocument();
  const colors = [];
  const panel = createLyricsPanel({
    document: fake.doc,
    color: '#ff8800',
    savedColors: ['#ff8800'],
    onColorChange: (color) => colors.push(color),
  });
  panel.attach(fake.body);
  assert.equal(panel.getColor(), '#ff8800');

  fake.doc.querySelector('.lyrics-panel-color-reset').click();
  assert.deepEqual(colors, [null]);
  assert.equal(panel.getColor(), null);
  assert.equal(fake.doc.querySelector('.lyrics-panel-color-value').textContent, '跟随曲风');
  assert.equal(fake.doc.querySelector('.lyrics-panel-color-reset').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(panel.getSavedColors(), ['#ff8800'], '重置只清当前色，不清已保存色');
  assert.equal(fake.doc.querySelector('.color-palette').dataset.empty, 'true');
  assert.ok(fake.doc.querySelector('.lyrics-panel-color-preview').style.background.includes('gradient'));
  panel.dispose();
});

test('面板：setColor / setSavedColors 只同步 UI，不触发任何回调', () => {
  const fake = fakeDocument();
  const colors = [];
  const savedLists = [];
  const panel = createLyricsPanel({
    document: fake.doc,
    onColorChange: (color) => colors.push(color),
    onSavedColorsChange: (list) => savedLists.push(list),
  });
  panel.attach(fake.body);

  panel.setColor('#123456');
  assert.equal(panel.getColor(), '#123456');
  assert.equal(fake.doc.querySelector('.lyrics-panel-color-value').textContent, '#123456');
  assert.equal(fake.doc.querySelector('.lyrics-panel-color-preview').style.background, '#123456');
  assert.equal(fake.doc.querySelector('.color-palette').dataset.empty, 'false');
  assert.equal(fake.doc.querySelector('.color-palette-marker').style._props['--color-palette-marker'], '#123456');

  panel.setSavedColors(['#fff', '#000000', '#fff', 'nope']);
  assert.deepEqual(panel.getSavedColors(), ['#ffffff', '#000000']);
  assert.equal(fake.doc.querySelectorAll('.color-palette-swatch').length, 2);

  panel.setColor('不是颜色');
  assert.equal(panel.getColor(), null);
  assert.deepEqual(colors, []);
  assert.deepEqual(savedLists, []);
  panel.dispose();
});

test('面板：无 document 环境颜色 API 安全（颜色 / 已保存色都可读写）', () => {
  const panel = createLyricsPanel({ color: '#ABCDEF', savedColors: ['#fff', 'nope', '#000'] });
  assert.equal(panel.getColor(), '#abcdef');
  assert.deepEqual(panel.getSavedColors(), ['#ffffff', '#000000']);

  panel.setColor(null);
  assert.equal(panel.getColor(), null);
  panel.setColor('#00ff00');
  assert.equal(panel.getColor(), '#00ff00');
  panel.setSavedColors(['#111111']);
  assert.deepEqual(panel.getSavedColors(), ['#111111']);
  panel.setColor('bad'); // 合法 3 位缩写 → #bbaadd
  assert.equal(panel.getColor(), '#bbaadd');
  panel.dispose();
});

test('面板：dispose 同时释放调色盘节点与监听', () => {
  const { panel, doc } = openPanel({ color: '#ff8800', savedColors: ['#ff8800'] });
  assert.ok(doc.querySelector('.color-palette'));
  panel.dispose();
  assert.equal(doc.querySelector('.color-palette'), null);
  // dispose 后颜色接口仍安全。
  panel.setColor('#ffffff');
  assert.equal(panel.getColor(), '#ff8800', 'dispose 后 setColor 不再生效');
  panel.setColor(null);
  panel.setSavedColors([]);
  panel.dispose();
});

// ---------- 假 document / 假元素（仅面板测试使用的轻量实现） ----------

function fakeDocument() {
  const createElement = (tagName = 'div') => {
    const element = {
      tagName: String(tagName).toUpperCase(),
      className: '',
      value: '',
      hidden: false,
      files: null,
      parent: null,
      isConnected: false,
      children: [],
      dataset: {},
      _attrs: {},
      _listeners: new Map(),
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
      // 调色盘按 clientX/clientY + 板面 rect 映射选色；这里给所有假元素一个固定尺寸。
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 240, height: 120 };
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
test('歌词显示右上角预览：跟随曲风 / 自定义颜色 / 3D 倾斜同步', () => {
  const { panel, doc } = openPanel();
  panel.open();
  const preview = doc.querySelector('.lyrics-panel-display-preview');
  assert.ok(preview, '预览块应存在');
  assert.ok(preview.querySelector('.lyrics-panel-preview-line').textContent.includes('夜色'), '预览含示例歌词');
  const value = preview.querySelector('.lyrics-panel-preview-value');
  // 预览文本带上当前字号档位（默认「肥鱼」）。
  assert.equal(value.textContent, '跟随曲风 · 肥鱼');

  panel.setColor('#ec135b');
  assert.ok(value.textContent.startsWith('#ec135b'), '选色后显示色值');
  assert.ok(
    String(preview.style._props['--lyrics-preview-gradient']).includes('#ec135b'),
    '预览渐变使用所选颜色',
  );

  panel.setColor(null);
  assert.equal(value.textContent, '跟随曲风 · 肥鱼');

  panel.setDisplay({ mode: 'tilt3d' });
  assert.ok(preview.classList.contains('is-tilt3d'), '3D 倾斜时预览同步倾斜');
  panel.setDisplay({ mode: 'classic' });
  assert.ok(!preview.classList.contains('is-tilt3d'));

  // 预览跟随「模式」与「字号」：data 属性 + 文字标签同步更新。
  panel.setDisplay({ mode: 'bounce' });
  assert.equal(preview.dataset.previewMode, 'bounce', '预览反映当前样式');
  panel.setDisplay({ size: 'large' });
  assert.equal(preview.dataset.previewSize, 'large', '预览反映当前字号档位');
  assert.equal(value.textContent, '跟随曲风 · 大肥鱼');
  panel.setDisplay({ size: 'small' });
  assert.equal(value.textContent, '跟随曲风 · 小肥鱼');
  panel.dispose();
});
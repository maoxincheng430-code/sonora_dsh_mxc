// 歌词面板（独立浮层组件）：粘贴 LRC / 导入 .lrc 文件 / 载入内置示例 / 应用 / 清空。
// 调用时才显示，默认隐藏；Esc 或点击遮罩关闭；头部可拖动。移动端全宽。
//
// 用法（Lead 在 main.js 接线）：
//   import './lyrics-panel.css';                       // 组件不自带 CSS import，保证 Node 下可测试
//   const panel = createLyricsPanel({
//     onApply(text) { text ? lyricsOverlay.setLyrics(text) : lyricsOverlay.setDemo(); },
//   });
//   panel.attach(document.body);
//   // 导航栏“歌词”按钮 / 任意入口：panel.open()
//
// 可注入 options.document（Node 测试用）；无 document 时所有方法安全 no-op。

import {
  DEMO_LYRICS,
  LYRIC_MODES,
  LYRIC_POSITIONS,
  LYRIC_SIZES,
  demoLyricLines,
  ensureTimedLyrics,
  normalizeLyricMode,
  normalizeLyricPosition,
  normalizeLyricSize,
  normalizeChatProfile,
  parseLRC,
} from './lyrics.js';
import {
  createColorPalette,
  gradientFromColor,
  normalizeHexColor,
  normalizeSavedColors,
} from './color-palette.js';
import { createMascotPet } from './mascot-pet.js';

const TEXT_PLACEHOLDER = '[00:00.00]夜色缓缓落下\n[00:05.50]像一层温柔的纱\n\n也可以直接粘贴没有时间轴的歌词，应用时会自动按 4 秒一行补齐。';

const h = (doc, tag, className, text) => {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
};

const setAttr = (element, name, value) => {
  if (element && typeof element.setAttribute === 'function') element.setAttribute(name, value);
};

/**
 * 创建歌词面板。
 * @param {object} [options]
 * @param {(text: string) => void} [options.onApply] 点击「应用歌词」/「清空歌词」时回调：
 *   应用传补齐时间轴后的 LRC 文本，清空传 ''（建议 Lead 对空串回退到 overlay.setDemo()）
 * @param {string} [options.mode='classic'] 初始歌词模式：'classic' | 'tilt3d'（3D 倾斜，独立于粒子特效）
 * @param {string} [options.position='center'] 初始歌词位置：'left' | 'center' | 'right'
 * @param {(mode: string) => void} [options.onModeChange] 用户在面板里切换歌词模式时回调
 * @param {(position: string) => void} [options.onPositionChange] 用户在面板里切换歌词位置时回调
 * @param {string|null} [options.color=null] 初始歌词颜色（'#rrggbb'）；null = 跟随曲风
 * @param {string[]} [options.savedColors=[]] 初始已保存颜色（最多 8 个，最新的在前）
 * @param {number} [options.maxColors=8] 已保存颜色上限
 * @param {(color: string|null) => void} [options.onColorChange] 用户在面板里选色 / 点「跟随曲风」时回调
 * @param {(list: string[]) => void} [options.onSavedColorsChange] 已保存颜色列表变化时回调（供 main.js 持久化）
 * @param {Document} [options.document] 注入 document（Node 测试用）
 * @returns {{
 *   attach(host?: Element|string): void,
 *   open(): void,
 *   close(): void,
 *   isOpen(): boolean,
 *   setText(text: string): void,
 *   getText(): string,
 *   setDisplay(patch?: {mode?: string, position?: string, size?: string}): void, // 同步模式/位置/字号按钮（不触发回调）
 *   getDisplay(): {mode: string, position: string},
 *   setColor(color: string|null): void,   // 同步调色盘 / 预览（不回触发回调）
 *   getColor(): string | null,
 *   setSavedColors(list: string[]): void, // 同步已保存色块（不回触发回调）
 *   getSavedColors(): string[],
 *   setStatus(message: string, tone?: 'info'|'success'|'error'): void,
 *   dispose(): void,
 * }}
 */
export function createLyricsPanel(options = {}) {
  const doc = options.document || (typeof document !== 'undefined' ? document : null);
  const onApply = typeof options.onApply === 'function' ? options.onApply : null;
  const onModeChange = typeof options.onModeChange === 'function' ? options.onModeChange : null;
  const onPositionChange = typeof options.onPositionChange === 'function' ? options.onPositionChange : null;
  const onSizeChange = typeof options.onSizeChange === 'function' ? options.onSizeChange : null;
  // 「逃出升天」：把吉祥物放出来成为独立桌宠。
  const onEscape = typeof options.onEscape === 'function' ? options.onEscape : null;
  const onColorChange = typeof options.onColorChange === 'function' ? options.onColorChange : null;
  const onSavedColorsChange =
    typeof options.onSavedColorsChange === 'function' ? options.onSavedColorsChange : null;
  const onChatProfileChange =
    typeof options.onChatProfileChange === 'function' ? options.onChatProfileChange : null;

  const listeners = [];
  let root = null;
  let backdrop = null;
  let card = null;
  let header = null;
  let mascotSlot = null;
  let mascotPet = null;
  let mascotMore = null;
  let mascotEscape = null;
  let closeButton = null;
  let textarea = null;
  let fileInput = null;
  let importButton = null;
  let demoButton = null;
  let applyButton = null;
  let clearButton = null;
  let statusEl = null;
  let colorPreview = null;
  let displayPreview = null;
  let displayPreviewValue = null;
  let colorValueEl = null;
  let colorResetButton = null;
  let palette = null;

  // 显示设置（歌词模式 / 位置 / 字号）：只更新按钮状态 + 回调，具体渲染由歌词层负责。
  const display = {
    mode: normalizeLyricMode(options.mode),
    position: normalizeLyricPosition(options.position),
    size: normalizeLyricSize(options.size),
  };
  const modeButtons = new Map();
  const positionButtons = new Map();
  const sizeButtons = new Map();
  let chatState = normalizeChatProfile(options.chatProfile);
  let chatSection = null;
  let chatBody = null;
  let chatToggle = null;
  let chatSummary = null;
  let chatBiasButtons = null;
  let chatOpen = false;
  let chatNameInputs = null;
  let chatAvatarPreviews = null;

  // 歌词颜色（调色盘）：value = 当前自定义色（null = 跟随曲风），saved = 已保存多色。
  const colorState = {
    value: normalizeHexColor(options.color),
    saved: normalizeSavedColors(options.savedColors, options.maxColors),
  };

  let attached = false;
  let openState = false;
  let disposed = false;
  let dragState = null;
  let dragRemove = [];
  let offsetX = 0;
  let offsetY = 0;
  let lastFocus = null;

  const on = (target, event, handler, opts) => {
    if (!target || typeof target.addEventListener !== 'function') return () => {};
    target.addEventListener(event, handler, opts);
    const remove = () => target.removeEventListener?.(event, handler, opts);
    listeners.push(remove);
    return remove;
  };

  if (doc) build();

  function build() {
    root = h(doc, 'section', 'lyrics-panel');
    setAttr(root, 'role', 'dialog');
    setAttr(root, 'aria-modal', 'true');
    setAttr(root, 'aria-label', '歌词面板');
    setAttr(root, 'aria-hidden', 'true');

    backdrop = h(doc, 'div', 'lyrics-panel-backdrop');
    setAttr(backdrop, 'aria-hidden', 'true');

    card = h(doc, 'div', 'lyrics-panel-card');

    // ---- 顶部：大肥鱼互动吉祥物（坐在卡片上沿）----
    mascotSlot = h(doc, 'div', 'mascot-pet-slot');
    setAttr(mascotSlot, 'aria-hidden', 'false');

    // ---- 头部（拖动把手 + 关闭）----
    header = h(doc, 'header', 'lyrics-panel-header');
    const heading = h(doc, 'div', 'lyrics-panel-heading');
    heading.append(
      h(doc, 'span', 'lyrics-panel-kicker', 'SONORA · 歌词'),
      h(doc, 'h2', 'lyrics-panel-title', '让歌词成为主角'),
      h(doc, 'p', 'lyrics-panel-subtitle', '粘贴 LRC、导入文件，或载入内置示例'),
    );
    closeButton = h(doc, 'button', 'lyrics-panel-close', '×');
    closeButton.type = 'button';
    setAttr(closeButton, 'aria-label', '关闭歌词面板');
    setAttr(closeButton, 'title', '关闭（Esc）');
    header.append(heading, closeButton);

    // ---- 编辑区 ----
    const body = h(doc, 'div', 'lyrics-panel-body');
    const label = h(doc, 'label', 'lyrics-panel-label', '歌词内容（LRC 时间轴）');
    textarea = h(doc, 'textarea', 'lyrics-panel-textarea');
    textarea.value = '';
    setAttr(textarea, 'placeholder', TEXT_PLACEHOLDER);
    setAttr(textarea, 'spellcheck', 'false');
    setAttr(textarea, 'aria-label', '歌词 LRC 文本');
    setAttr(label, 'for', 'lyrics-panel-textarea');
    setAttr(textarea, 'id', 'lyrics-panel-textarea');
    const hint = h(
      doc,
      'p',
      'lyrics-panel-hint',
      '支持 [mm:ss.xx] 时间标签；纯文本会自动按 4 秒一行补齐时间轴。',
    );
    body.append(label, textarea, hint);
    // 聊天身份放在歌词输入下方，选中「聊天」模式时无需滚动就能看到
    chatSection = buildChatSection();
    body.append(chatSection);

    // ---- 歌词显示：模式（经典 / 3D 倾斜）与位置（左 / 中 / 右）----
    // 独立于粒子特效：只切换歌词层自己的排版，不动粒子 / 主题 / 频段等设置。
    const displaySection = h(doc, 'section', 'lyrics-panel-display');
    setAttr(displaySection, 'aria-label', '歌词显示设置');
    const displayHead = h(doc, 'div', 'lyrics-panel-display-head');
    // 右上角：当前颜色 / 模式下的歌词排版小预览（实时跟随色盘与 3D 倾斜切换）
    displayPreview = h(doc, 'div', 'lyrics-panel-display-preview');
    setAttr(displayPreview, 'aria-hidden', 'true');
    displayPreview.append(
      h(doc, 'span', 'lyrics-panel-preview-line', '夜色缓缓落下'),
      h(doc, 'span', 'lyrics-panel-preview-line is-sub', '星光在指尖融化'),
    );
    displayPreviewValue = h(doc, 'span', 'lyrics-panel-preview-value', '跟随曲风');
    displayPreview.append(displayPreviewValue);
    const displayAside = h(doc, 'div', 'lyrics-panel-display-aside');
    displayAside.append(
      displayPreview,
      h(doc, 'span', 'lyrics-panel-display-note', '独立于粒子特效 · 立即生效'),
    );
    displayHead.append(h(doc, 'h3', 'lyrics-panel-display-title', '歌词显示'), displayAside);
    const displayRows = h(doc, 'div', 'lyrics-panel-display-rows');
    displayRows.append(
      buildDisplayRow('模式', 'mode', LYRIC_MODES),
      buildDisplayRow('位置', 'position', LYRIC_POSITIONS),
      buildDisplayRow('字号', 'size', LYRIC_SIZES),
      buildColorRow(),
    );
    const displayHint = h(
      doc,
      'p',
      'lyrics-panel-display-hint',
      '3D 倾斜：同一时间戳的两行会显示成「主歌词 + 译文」；选居左/居右时左侧介绍文案自动淡出。',
    );
    displaySection.append(displayHead, displayRows, displayHint);

    syncDisplay();

    // ---- 快捷操作：示例 / 导入文件 ----
    const actions = h(doc, 'div', 'lyrics-panel-actions');
    demoButton = h(doc, 'button', 'lyrics-panel-demo');
    demoButton.type = 'button';
    demoButton.append(
      h(doc, 'span', 'lyrics-panel-button-icon', '♪'),
      h(doc, 'span', null, '载入示例歌词'),
    );
    importButton = h(doc, 'button', 'lyrics-panel-import');
    importButton.type = 'button';
    importButton.append(
      h(doc, 'span', 'lyrics-panel-button-icon', '↥'),
      h(doc, 'span', null, '导入 .lrc 文件'),
    );
    fileInput = h(doc, 'input', 'lyrics-panel-file');
    fileInput.type = 'file';
    setAttr(fileInput, 'accept', '.lrc,.txt,text/plain');
    setAttr(fileInput, 'aria-label', '导入歌词文件');
    fileInput.value = '';
    actions.append(demoButton, importButton, fileInput);

    // ---- 底部：状态 + 清空 / 应用 ----
    const footer = h(doc, 'footer', 'lyrics-panel-footer');
    statusEl = h(doc, 'p', 'lyrics-panel-status', '');
    setAttr(statusEl, 'role', 'status');
    setAttr(statusEl, 'aria-live', 'polite');
    statusEl.dataset.tone = 'info';
    statusEl.hidden = true;
    const footerActions = h(doc, 'div', 'lyrics-panel-footer-actions');
    clearButton = h(doc, 'button', 'lyrics-panel-clear', '清空歌词');
    clearButton.type = 'button';
    applyButton = h(doc, 'button', 'lyrics-panel-apply lyrics-panel-apply--primary', '应用歌词');
    applyButton.type = 'button';
    footerActions.append(clearButton, applyButton);
    footer.append(statusEl, footerActions);

    const meta = h(doc, 'p', 'lyrics-panel-meta', 'Esc 关闭 · 也可点击遮罩关闭 · 播放不会中断');
    card.append(mascotSlot, header, body, displaySection, actions, footer, meta);
    root.append(backdrop, card);
    // 即使使用方忘了 import './lyrics-panel.css'，hidden 属性也能保证面板默认不可见。
    root.hidden = true;

    // ---- 大肥鱼互动吉祥物 ----
    if (mascotSlot) {
      try {
        mascotPet = createMascotPet({
          document: doc,
          src: options.mascotSrc || 'mascot/dafeiyu-cut.png',
          name: '大肥鱼',
          size: display.size,
        });
        if (mascotPet.el) mascotSlot.append(mascotPet.el);
        // 「换一句」：让大肥鱼念一段情景对话，不打断歌词编辑。
        mascotMore = h(doc, 'button', 'mascot-pet-more', '换一句');
        mascotMore.type = 'button';
        setAttr(mascotMore, 'aria-label', '让大肥鱼说一句话');
        setAttr(mascotMore, 'title', '让大肥鱼说一句话');
        on(mascotMore, 'click', () => {
          mascotPet?.nextScene?.();
        });
        mascotSlot.append(mascotMore);

        // 「逃出升天」：把大肥鱼放出来变成独立桌宠，在页面上自由活动。
        mascotEscape = h(doc, 'button', 'mascot-pet-escape', '逃出升天');
        mascotEscape.type = 'button';
        setAttr(mascotEscape, 'aria-label', '让大肥鱼成为独立桌宠');
        setAttr(mascotEscape, 'title', '逃出升天：变成桌宠，在桌面上自由活动');
        on(mascotEscape, 'click', () => {
          onEscape?.();
        });
        mascotSlot.append(mascotEscape);
      } catch {
        // 吉祥物只是锦上添花，失败不影响面板
        mascotPet = null;
      }
    }

    // ---- 事件 ----
    on(closeButton, 'click', close);
    on(backdrop, 'click', (event) => {
      if (!event || event.target === backdrop) close();
    });
    on(demoButton, 'click', handleDemo);
    on(importButton, 'click', () => fileInput?.click?.());
    on(fileInput, 'change', handleFileChange);
    on(applyButton, 'click', handleApply);
    on(clearButton, 'click', handleClear);
    on(header, 'pointerdown', startDrag);
  }

  // 一行「标签 + 分段按钮」；mode / position 共用同一套按钮样式与 aria 状态。
  function buildDisplayRow(label, group, table) {
    const row = h(doc, 'div', 'lyrics-panel-display-row');
    const name = h(doc, 'span', 'lyrics-panel-display-label', label);
    const segmented = h(doc, 'div', `lyrics-panel-segmented lyrics-panel-segmented-${group}`);
    setAttr(segmented, 'role', 'group');
    setAttr(segmented, 'aria-label', label);
    const buttons =
      group === 'mode' ? modeButtons : group === 'position' ? positionButtons : sizeButtons;
    for (const [id, meta] of Object.entries(table)) {
      const button = h(doc, 'button', `lyrics-panel-segmented-button lyrics-panel-${group}-button`);
      button.type = 'button';
      button.dataset[group] = id;
      button.textContent = meta.label;
      setAttr(button, 'aria-pressed', 'false');
      setAttr(button, 'title', meta.description);
      buttons.set(id, button);
      segmented.append(button);
      on(button, 'click', () => {
        if (group === 'mode') chooseMode(id);
        else if (group === 'position') choosePosition(id);
        else chooseSize(id);
      });
    }
    row.append(name, segmented);
    return row;
  }

  // 颜色行：调色盘（彩虹渐变板 + 圆点阵 + 圆环标记）+ 当前色预览 / hex + 「跟随曲风」重置。
  // 已保存色块由调色盘组件自己渲染，面板只负责把变化转成回调（main.js 负责持久化）。
  function buildColorRow() {
    const row = h(doc, 'div', 'lyrics-panel-display-row lyrics-panel-color-row');
    const name = h(doc, 'span', 'lyrics-panel-display-label', '颜色');
    const block = h(doc, 'div', 'lyrics-panel-color');
    const head = h(doc, 'div', 'lyrics-panel-color-head');

    colorPreview = h(doc, 'span', 'lyrics-panel-color-preview');
    setAttr(colorPreview, 'aria-hidden', 'true');
    colorValueEl = h(doc, 'span', 'lyrics-panel-color-value');
    setAttr(colorValueEl, 'aria-live', 'polite');
    colorResetButton = h(doc, 'button', 'lyrics-panel-color-reset', '跟随曲风');
    colorResetButton.type = 'button';
    setAttr(colorResetButton, 'title', '清除自定义颜色，恢复随曲风变化的默认渐变');
    head.append(colorPreview, colorValueEl, colorResetButton);
    on(colorResetButton, 'click', () => chooseColor(null, { notify: true }));

    palette = createColorPalette({
      document: doc,
      color: colorState.value,
      savedColors: colorState.saved,
      maxColors: options.maxColors,
      onPick: (hex) => {
        const value = normalizeHexColor(hex);
        if (!value) return;
        colorState.value = value;
        syncColor();
        try {
          onColorChange?.(value);
        } catch {
          // 使用方回调异常不影响面板自身状态
        }
      },
      onSavedColorsChange: (list) => {
        colorState.saved = normalizeSavedColors(list, options.maxColors);
        try {
          onSavedColorsChange?.(colorState.saved.slice());
        } catch {
          // 同上
        }
      },
    });

    block.append(head);
    if (palette && palette.el) block.append(palette.el);
    row.append(name, block);
    syncColor();
    return row;
  }

  function syncColor() {
    if (!colorValueEl || !colorPreview) return;
    const value = colorState.value;
    if (value) {
      colorValueEl.textContent = value;
      colorValueEl.classList.remove('is-mood');
      colorPreview.style.background = value;
      colorPreview.classList.add('has-color');
    } else {
      colorValueEl.textContent = '跟随曲风';
      colorValueEl.classList.add('is-mood');
      colorPreview.style.background = 'linear-gradient(115deg, #f4f8ff 0%, #c3dcff 52%, #8fd0f2 100%)';
      colorPreview.classList.remove('has-color');
    }
    colorResetButton?.classList?.toggle('is-active', !value);
    if (colorResetButton) setAttr(colorResetButton, 'aria-pressed', String(!value));
    syncPreview();
  }

  // 内部选色入口：value 归一化后同步调色盘 + 预览；notify=true 时通知使用方（用户操作）。
  function chooseColor(value, { notify = false } = {}) {
    if (disposed) return;
    const next = normalizeHexColor(value);
    colorState.value = next;
    palette?.setColor(next);
    syncColor();
    if (!notify) return;
    try {
      onColorChange?.(next);
    } catch {
      // 使用方回调异常不影响面板自身状态
    }
  }

  function setColor(value) {
    chooseColor(value, { notify: false });
  }

  function getColor() {
    return colorState.value;
  }

  function setSavedColors(list) {
    if (disposed) return;
    colorState.saved = normalizeSavedColors(list, options.maxColors);
    palette?.setSavedColors(colorState.saved);
  }

  function getSavedColors() {
    return colorState.saved.slice();
  }

  function syncDisplay() {
    if (chatSection) chatSection.hidden = display.mode !== 'chat';
    syncChatProfile();
    for (const [mode, button] of modeButtons) {
      const active = mode === display.mode;
      button.classList.toggle('is-active', active);
      setAttr(button, 'aria-pressed', String(active));
    }
    for (const [position, button] of positionButtons) {
      const active = position === display.position;
      button.classList.toggle('is-active', active);
      setAttr(button, 'aria-pressed', String(active));
    }
    for (const [size, button] of sizeButtons) {
      const active = size === display.size;
      button.classList.toggle('is-active', active);
      setAttr(button, 'aria-pressed', String(active));
    }
    syncPreview();
  }

  // 右上角小预览：用当前颜色 / 模式渲染两行示例歌词（只影响面板展示，不碰真实歌词层）
  function syncPreview() {
    if (!displayPreview) return;
    const gradient = colorState.value
      ? gradientFromColor(colorState.value)
      : 'linear-gradient(115deg, #f4f8ff 0%, #c3dcff 52%, #8fd0f2 100%)';
    displayPreview.style.setProperty('--lyrics-preview-gradient', gradient);
    displayPreview.classList.toggle('is-tilt3d', display.mode === 'tilt3d');
    displayPreview.classList.toggle('is-follow', !colorState.value);
    // 预览跟随当前样式（打字机 / 弹跳 / 故障…）与字号档位一起变。
    displayPreview.dataset.previewMode = display.mode;
    displayPreview.dataset.previewSize = display.size;
    if (displayPreviewValue) {
      const sizeLabel = LYRIC_SIZES[display.size]?.label ?? '';
      const source = colorState.value || '跟随曲风';
      displayPreviewValue.textContent = sizeLabel ? `${source} · ${sizeLabel}` : source;
    }
  }

  function chooseMode(mode) {
    const next = normalizeLyricMode(mode);
    if (next === display.mode) return;
    display.mode = next;
    syncDisplay();
    try {
      onModeChange?.(next);
    } catch {
      // 使用方回调异常不影响面板自身状态
    }
  }

  function choosePosition(position) {
    const next = normalizeLyricPosition(position);
    if (next === display.position) return;
    display.position = next;
    syncDisplay();
    try {
      onPositionChange?.(next);
    } catch {
      // 同上
    }
  }

  // 字号三档：小肥鱼 / 肥鱼 / 大肥鱼。吉祥物的体型也跟着一起变。
  function chooseSize(size) {
    const next = normalizeLyricSize(size);
    if (next === display.size) return;
    display.size = next;
    syncDisplay();
    // 大肥鱼跟着字号一起「变大变小」，并冒一句对应台词。
    try {
      mascotPet?.setSize?.(next);
    } catch {
      // 吉祥物异常不影响字号切换
    }
    try {
      onSizeChange?.(next);
    } catch {
      // 回调异常不影响面板自身状态
    }
  }

  function setDisplay(patch = {}) {
    if (disposed) return;
    if (patch && patch.mode != null) display.mode = normalizeLyricMode(patch.mode);
    if (patch && patch.position != null) display.position = normalizeLyricPosition(patch.position);
    if (patch && patch.size != null) {
      display.size = normalizeLyricSize(patch.size);
      try {
        mascotPet?.setSize?.(display.size);
      } catch {
        // 忽略
      }
    }
    syncDisplay();
  }

  function syncChatProfile() {
    if (!chatNameInputs || !chatAvatarPreviews) return;
    if (chatBody) chatBody.hidden = !chatOpen;
    if (chatToggle) chatToggle.setAttribute('aria-expanded', String(chatOpen));
    if (chatSummary) {
      const label =
        chatState.bias === 'random'
          ? '随机'
          : chatState.bias === 'ta'
            ? 'TA 更多'
            : chatState.bias === 'me'
              ? '我更多'
              : '均衡';
      chatSummary.textContent = `${chatState.taName} / ${chatState.meName} · ${label}`;
    }
    if (chatBiasButtons) {
      for (const [bias, button] of chatBiasButtons) {
        const active = bias === chatState.bias;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
      }
    }
    for (const side of ['ta', 'me']) {
      const input = chatNameInputs[side];
      if (input && doc.activeElement !== input) input.value = chatState[side + 'Name'];
      const preview = chatAvatarPreviews[side];
      if (!preview || !preview.style) continue;
      const avatar = chatState[side + 'Avatar'];
      preview.classList.toggle('has-image', Boolean(avatar));
      preview.style.backgroundImage = avatar ? `url("${avatar}")` : '';
      preview.textContent = avatar ? '' : Array.from(chatState[side + 'Name'] || '?')[0];
    }
  }

  function emitChatProfile() {
    const profile = normalizeChatProfile(chatState);
    try {
      onChatProfileChange?.(profile);
    } catch {
      // 使用方回调异常不影响面板
    }
    return profile;
  }

  function readAvatarFile(file) {
    return new Promise((resolve) => {
      try {
        const reader = new FileReader();
        reader.onload = () => {
          const image = new Image();
          image.onload = () => {
            try {
              const canvas = document.createElement('canvas');
              canvas.width = 64;
              canvas.height = 64;
              const context = canvas.getContext('2d');
              const size = Math.min(image.width, image.height);
              context.drawImage(
                image,
                (image.width - size) / 2,
                (image.height - size) / 2,
                size,
                size,
                0,
                0,
                64,
                64,
              );
              resolve(canvas.toDataURL('image/jpeg', 0.82));
            } catch {
              resolve('');
            }
          };
          image.onerror = () => resolve('');
          image.src = reader.result;
        };
        reader.onerror = () => resolve('');
        reader.readAsDataURL(file);
      } catch {
        resolve('');
      }
    });
  }

  function buildChatSection() {
    const section = h(doc, 'section', 'lyrics-panel-chat');
    setAttr(section, 'aria-label', '聊天身份');
    section.hidden = true;
    // 聊天设置收成一个按钮，点开再展开头像 / 名字 / 说话比例
    chatToggle = h(doc, 'button', 'lyrics-panel-chat-toggle');
    chatToggle.type = 'button';
    setAttr(chatToggle, 'data-chat-toggle', '');
    setAttr(chatToggle, 'aria-expanded', 'false');
    setAttr(chatToggle, 'aria-controls', 'lyrics-panel-chat-body');
    const toggleTitle = h(doc, 'span', 'lyrics-panel-chat-title', '聊天设置');
    chatSummary = h(doc, 'span', 'lyrics-panel-chat-summary', 'TA / 我 · 均衡');
    const caret = h(doc, 'span', 'lyrics-panel-chat-caret', '⌄');
    setAttr(caret, 'aria-hidden', 'true');
    chatToggle.append(toggleTitle, chatSummary, caret);
    chatBody = h(doc, 'div', 'lyrics-panel-chat-body');
    chatBody.hidden = true;
    setAttr(chatBody, 'id', 'lyrics-panel-chat-body');
    const rows = h(doc, 'div', 'lyrics-panel-chat-rows');
    chatNameInputs = {};
    chatAvatarPreviews = {};

    for (const [side, fallback] of [['ta', 'TA'], ['me', '我']]) {
      const row = h(doc, 'div', 'lyrics-panel-chat-row');
      const avatarButton = h(doc, 'button', 'lyrics-panel-chat-avatar');
      avatarButton.type = 'button';
      setAttr(avatarButton, 'aria-label', `更换 ${fallback} 头像`);
      setAttr(avatarButton, 'title', `更换 ${fallback} 头像`);
      const preview = h(doc, 'span', 'lyrics-panel-chat-avatar-preview');
      setAttr(avatarButton, 'data-chat-avatar', side);
      setAttr(preview, 'data-chat-avatar-preview', side);
      setAttr(preview, 'aria-hidden', 'true');
      avatarButton.append(preview);
      chatAvatarPreviews[side] = preview;

      const field = h(doc, 'label', 'lyrics-panel-chat-field');
      const label = h(doc, 'span', 'lyrics-panel-chat-label', `${fallback} 名字`);
      const input = h(doc, 'input', 'lyrics-panel-chat-name');
      input.type = 'text';
      setAttr(input, 'maxlength', '8');
      setAttr(input, 'placeholder', fallback);
      input.value = chatState[side + 'Name'];
      setAttr(input, 'data-chat-name', side);
      chatNameInputs[side] = input;
      field.append(label, input);

      const file = h(doc, 'input', 'lyrics-panel-chat-file');
      file.type = 'file';
      setAttr(file, 'accept', 'image/*');
      setAttr(file, 'data-chat-file', side);
      setAttr(file, 'aria-label', `选择 ${fallback} 头像图片`);
      file.hidden = true;

      on(avatarButton, 'click', () => file.click());
      on(input, 'input', () => {
        chatState[side + 'Name'] = input.value.replace(/\s+/g, ' ').trim();
        syncChatProfile();
        emitChatProfile();
      });
      on(file, 'change', async () => {
        const chosen = file.files?.[0];
        if (!chosen) return;
        const avatar = await readAvatarFile(chosen);
        file.value = '';
        if (!avatar) return;
        chatState[side + 'Avatar'] = avatar;
        syncChatProfile();
        emitChatProfile();
      });

      row.append(avatarButton, field, file);
      rows.append(row);
    }

    const ratioRow = h(doc, 'div', 'lyrics-panel-chat-ratio');
    ratioRow.append(h(doc, 'span', 'lyrics-panel-chat-ratio-label', '说话比例'));
    const ratioButtons = h(doc, 'div', 'lyrics-panel-chat-ratio-buttons');
    chatBiasButtons = new Map();
    for (const [bias, label] of [
      ['random', '随机'],
      ['even', '均衡'],
      ['ta', 'TA 更多'],
      ['me', '我更多'],
    ]) {
      const button = h(doc, 'button', 'lyrics-panel-chat-bias', label);
      button.type = 'button';
      setAttr(button, 'data-chat-bias', bias);
      setAttr(button, 'aria-pressed', 'false');
      on(button, 'click', () => {
        chatState.bias = bias;
        syncChatProfile();
        emitChatProfile();
      });
      chatBiasButtons.set(bias, button);
      ratioButtons.append(button);
    }
    ratioRow.append(ratioButtons);

    const hint = h(
      doc,
      'p',
      'lyrics-panel-chat-hint',
      '头像支持 PNG / JPG，自动裁成 64×64；名字最多 8 个字。',
    );
    const resetButton = h(doc, 'button', 'lyrics-panel-chat-reset', '恢复默认身份');
    resetButton.type = 'button';
    on(resetButton, 'click', () => {
      chatState = normalizeChatProfile({});
      syncChatProfile();
      emitChatProfile();
    });
    on(chatToggle, 'click', () => {
      chatOpen = !chatOpen;
      syncChatProfile();
    });
    section.append(chatToggle, chatBody);
    chatBody.append(rows, ratioRow, hint, resetButton);
    syncChatProfile();
    return section;
  }

  function getDisplay() {
    return { mode: display.mode, position: display.position };
  }

  function applyCardTransform() {
    if (!card || !card.style) return;
    card.style.transform = offsetX || offsetY ? `translate(${offsetX}px, ${offsetY}px)` : '';
  }

  function startDrag(event) {
    if (disposed || !card) return;
    if (event && event.button != null && event.button !== 0) return;
    if (event && event.target === closeButton) return;
    dragState = {
      startX: Number(event?.clientX) || 0,
      startY: Number(event?.clientY) || 0,
      originX: offsetX,
      originY: offsetY,
    };
    card.classList.add('lyrics-panel-dragging');
    const move = (moveEvent) => {
      if (!dragState) return;
      offsetX = dragState.originX + ((Number(moveEvent?.clientX) || 0) - dragState.startX);
      offsetY = dragState.originY + ((Number(moveEvent?.clientY) || 0) - dragState.startY);
      applyCardTransform();
    };
    const end = () => stopDrag();
    dragRemove = [];
    if (doc && typeof doc.addEventListener === 'function') {
      doc.addEventListener('pointermove', move);
      doc.addEventListener('pointerup', end);
      doc.addEventListener('pointercancel', end);
      dragRemove = [
        () => doc.removeEventListener?.('pointermove', move),
        () => doc.removeEventListener?.('pointerup', end),
        () => doc.removeEventListener?.('pointercancel', end),
      ];
    }
  }

  function stopDrag() {
    dragState = null;
    if (card) card.classList.remove('lyrics-panel-dragging');
    for (const remove of dragRemove.splice(0)) remove();
  }

  function handleDemo() {
    setText(DEMO_LYRICS);
    const count = demoLyricLines().length;
    setStatus(`已载入内置示例歌词（${count} 行），点「应用歌词」显示。`, 'success');
    if (textarea && typeof textarea.focus === 'function') textarea.focus({ preventScroll: true });
  }

  function readFileText(file) {
    if (file && typeof file.text === 'function') return file.text();
    if (typeof FileReader === 'undefined') {
      return Promise.reject(new Error('当前环境不支持读取文件，请直接粘贴歌词。'));
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('读取歌词文件失败，请重试。'));
      reader.readAsText(file);
    });
  }

  async function handleFileChange() {
    const files = fileInput && fileInput.files ? Array.from(fileInput.files) : [];
    const file = files[0];
    if (!file) return;
    try {
      const text = await readFileText(file);
      if (disposed) return;
      setText(text);
      const count = parseLRC(text).length;
      const name = file.name || '歌词文件';
      if (count > 0) {
        setStatus(`已读取「${name}」，共 ${count} 行，点「应用歌词」显示。`, 'success');
      } else {
        setStatus(`已读取「${name}」，但没有找到时间标签；应用时会自动补齐时间轴。`, 'info');
      }
    } catch (error) {
      setStatus(error?.message || '读取歌词文件失败，请重试。', 'error');
    } finally {
      if (fileInput) fileInput.value = '';
    }
  }

  function handleApply() {
    const raw = getText().trim();
    if (!raw) {
      setStatus('还没有歌词内容：先粘贴 LRC，或点「载入示例歌词」。', 'error');
      if (textarea && typeof textarea.focus === 'function') textarea.focus({ preventScroll: true });
      return;
    }
    const hadTimeTags = parseLRC(raw).length > 0;
    const timed = ensureTimedLyrics(raw);
    if (!timed) {
      setStatus('这段内容里没有可用的歌词行，请检查后再试。', 'error');
      return;
    }
    const count = parseLRC(timed).length;
    if (!hadTimeTags) setText(timed);
    try {
      onApply?.(timed);
    } catch (error) {
      setStatus(error?.message || '应用歌词失败，请重试。', 'error');
      return;
    }
    setStatus(`已应用 ${count} 行歌词${hadTimeTags ? '' : '（已自动补齐时间轴）'}。`, 'success');
    close();
  }

  function handleClear() {
    setText('');
    try {
      onApply?.('');
    } catch (error) {
      setStatus(error?.message || '清空歌词失败，请重试。', 'error');
      return;
    }
    setStatus('已清空歌词。点「载入示例歌词」可以随时找回示例。', 'info');
    if (textarea && typeof textarea.focus === 'function') textarea.focus({ preventScroll: true });
  }

  function handleKeydown(event) {
    if (!openState) return;
    if (event && event.key === 'Escape') {
      event.preventDefault?.();
      event.stopPropagation?.();
      close();
    }
  }

  function attach(host) {
    if (!root || disposed || attached) return;
    const hostElement =
      typeof host === 'string'
        ? doc?.querySelector?.(host)
        : host ?? doc?.body;
    if (!hostElement || typeof hostElement.append !== 'function') return;
    hostElement.append(root);
    attached = true;
    if (doc && typeof doc.addEventListener === 'function') doc.addEventListener('keydown', handleKeydown);
    listeners.push(() => doc?.removeEventListener?.('keydown', handleKeydown));
  }

  function open() {
    if (!root || disposed) return;
    if (!attached) attach();
    if (openState) return;
    openState = true;
    lastFocus = doc?.activeElement ?? null;
    root.hidden = false;
    root.classList.add('lyrics-panel-open');
    setAttr(root, 'aria-hidden', 'false');
    if (textarea && typeof textarea.focus === 'function') {
      try {
        textarea.focus({ preventScroll: true });
      } catch {
        textarea.focus();
      }
    }
  }

  function close() {
    if (!root || disposed || !openState) return;
    openState = false;
    stopDrag();
    root.hidden = true;
    root.classList.remove('lyrics-panel-open');
    setAttr(root, 'aria-hidden', 'true');
    const restore = lastFocus;
    lastFocus = null;
    if (restore && typeof restore.focus === 'function' && doc && restore !== doc.body) {
      try {
        restore.focus({ preventScroll: true });
      } catch {
        // 焦点恢复失败不影响关闭
      }
    }
  }

  function setText(text) {
    if (!textarea || disposed) return;
    textarea.value = String(text ?? '');
  }

  function getText() {
    if (!textarea || disposed) return '';
    return String(textarea.value ?? '');
  }

  function setStatus(message, tone = 'info') {
    if (!statusEl || disposed) return;
    const text = String(message ?? '');
    const nextTone = tone === 'success' || tone === 'error' ? tone : 'info';
    statusEl.textContent = text;
    statusEl.dataset.tone = nextTone;
    statusEl.hidden = text.length === 0;
    statusEl.classList.toggle('is-error', nextTone === 'error');
    statusEl.classList.toggle('is-success', nextTone === 'success');
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    openState = false;
    stopDrag();
    palette?.dispose();
    palette = null;
    mascotPet?.dispose?.();
    mascotPet = null;
    listeners.splice(0).forEach((remove) => remove());
    if (root) root.hidden = true;
    root?.remove();
    attached = false;
  }

  return {
    attach,
    open,
    close,
    isOpen: () => openState,
    setText,
    getText,
    setDisplay,
    getDisplay,
    setColor,
    getColor,
    setSavedColors,
    getSavedColors,
    setChatProfile(profile) {
      chatState = normalizeChatProfile(profile);
      syncChatProfile();
    },
    getChatProfile() {
      return normalizeChatProfile(chatState);
    },
    setStatus,
    dispose,
  };
}

// 歌词颜色调色盘：纯颜色工具在前（Node 下可直接测试），DOM 组件在后。
// 视觉参考用户截图：圆角长方形彩虹渐变板 + 点阵覆盖 + 白色圆环标记；
// 点击 / 拖动板面即选色，选中颜色自动去重加入已保存色列表（默认最多 8 个，最新的在前），
// 点击已保存色块可直接应用该颜色。颜色只是“歌词显示”的一部分，不碰粒子 / 主题设置。
//
// 组件支持 options.document 注入（单测用假 document）；无 document 时返回安全的 no-op API
// （getColor / getSavedColors 仍可用），便于 Node 单测与面板在无 DOM 环境下创建。

/** 默认歌词颜色（与 MOOD_STYLES.calm.accent 一致；刷新后没有保存值时使用）。 */
export const DEFAULT_PALETTE_COLOR = '#a8dcff';

/** 已保存颜色的默认上限。 */
export const DEFAULT_MAX_COLORS = 8;

/** 调色盘板面 / 歌词渐变共用的角度，保证“选到的色 ≈ 唱到的色”。 */
const GRADIENT_ANGLE = '115deg';

/** 亮度映射区间：板面顶部 78% → 底部 38%（y ∈ [0,1]）。 */
const LIGHTNESS_TOP = 78;
const LIGHTNESS_RANGE = 40;

/** 调色盘饱和度（相对固定，色相 + 亮度负责表现力）。 */
const PALETTE_SATURATION = 85;

const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);
const clamp01 = (value) => clamp(value, 0, 1);
const toRatio = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? clamp01(number) : 0;
};

const HEX_FULL = /^#?([0-9a-f]{6})$/i;
const HEX_SHORT = /^#?([0-9a-f]{3})$/i;

/**
 * 归一化十六进制颜色：'#RGB' / '#RRGGBB'（可省略 #）→ '#rrggbb'。
 * 非法输入（空串、数字、颜色名、长度不对等）返回 null。
 * @param {unknown} value
 * @returns {string | null}
 */
export function normalizeHexColor(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  const full = trimmed.match(HEX_FULL);
  if (full) return `#${full[1]}`;
  const short = trimmed.match(HEX_SHORT);
  if (short) {
    const [red, green, blue] = short[1].split('');
    return `#${red}${red}${green}${green}${blue}${blue}`;
  }
  return null;
}

/**
 * HSL → 十六进制颜色。
 * @param {number} hue 色相角度（自动取模 360，负数回绕）
 * @param {number} saturation 饱和度 0~100（越界裁剪）
 * @param {number} lightness 亮度 0~100（越界裁剪）
 * @returns {string} '#rrggbb'
 */
export function hslToHex(hue, saturation, lightness) {
  const rawHue = Number(hue);
  const h = (((Number.isFinite(rawHue) ? rawHue : 0) % 360) + 360) % 360;
  const rawSaturation = Number(saturation);
  const rawLightness = Number(lightness);
  const s = clamp(Number.isFinite(rawSaturation) ? rawSaturation : 0, 0, 100) / 100;
  const l = clamp(Number.isFinite(rawLightness) ? rawLightness : 0, 0, 100) / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const second = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const match = l - chroma / 2;
  let rgb;
  if (h < 60) rgb = [chroma, second, 0];
  else if (h < 120) rgb = [second, chroma, 0];
  else if (h < 180) rgb = [0, chroma, second];
  else if (h < 240) rgb = [0, second, chroma];
  else if (h < 300) rgb = [second, 0, chroma];
  else rgb = [chroma, 0, second];
  const channel = (value) =>
    Math.round(clamp(value + match, 0, 1) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(rgb[0])}${channel(rgb[1])}${channel(rgb[2])}`;
}

/**
 * 十六进制颜色 → HSL（h 0~360，s / l 0~100）。非法输入按纯黑处理，保证纯函数不抛错。
 * @param {unknown} value
 * @returns {{h: number, s: number, l: number}}
 */
export function hexToHsl(value) {
  const hex = normalizeHexColor(value) || '#000000';
  const red = parseInt(hex.slice(1, 3), 16) / 255;
  const green = parseInt(hex.slice(3, 5), 16) / 255;
  const blue = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const lightness = (max + min) / 2;
  let hue = 0;
  if (delta > 0) {
    if (max === red) hue = ((green - blue) / delta) % 6;
    else if (max === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  return { h: hue, s: saturation * 100, l: lightness * 100 };
}

/**
 * 调色盘板面坐标 → 颜色（点击 / 拖动都走这里）。
 * x ∈ [0,1] 映射色相 0°→360°，y ∈ [0,1] 映射亮度 78%→38%，饱和度固定 85%。
 * 越界坐标会被裁剪，NaN 按 0 处理。
 * @param {number} x
 * @param {number} y
 * @returns {string} '#rrggbb'
 */
export function colorAtPalettePoint(x, y) {
  const ratioX = toRatio(x);
  const ratioY = toRatio(y);
  return hslToHex(ratioX * 360, PALETTE_SATURATION, LIGHTNESS_TOP - ratioY * LIGHTNESS_RANGE);
}

/**
 * 颜色 → 板面坐标（色相 / 亮度反查），用于把初始色、已保存色摆到圆环标记位置。
 * 非法颜色返回 null。
 * @param {unknown} value
 * @returns {{x: number, y: number} | null}
 */
export function palettePointForColor(value) {
  const hex = normalizeHexColor(value);
  if (!hex) return null;
  const { h, l } = hexToHsl(hex);
  return {
    x: clamp01(h / 360),
    y: clamp01((LIGHTNESS_TOP - l) / LIGHTNESS_RANGE),
  };
}

/**
 * 圆形调色盘：板面坐标（-1..1，原点在圆心）→ 颜色。
 * 角度 → 色相（0° 在正上方，顺时针递增），半径 → 亮度（圆心最亮 78%，边缘最暗 38%）。
 * 越界坐标会被裁剪到圆内。
 * @param {number} dx 相对圆心的横向偏移，单位 = 半径
 * @param {number} dy 相对圆心的纵向偏移，单位 = 半径
 * @returns {string} '#rrggbb'
 */
export function colorAtWheelPoint(dx, dy) {
  const rawX = Number(dx);
  const rawY = Number(dy);
  const x = Number.isFinite(rawX) ? rawX : 0;
  const y = Number.isFinite(rawY) ? rawY : 0;
  const distance = Math.hypot(x, y);
  // 越界时按「同方向、半径 1」处理：不能分别裁剪 x / y，否则方向会被扭曲。
  const scale = distance > 1 ? 1 / distance : 1;
  const nx = x * scale;
  const ny = y * scale;
  const radius = Math.min(1, distance);
  // atan2 以正右方为 0°，这里挪到正上方并保持顺时针，更符合圆形取色盘的手感。
  const angle = (Math.atan2(nx, -ny) * 180) / Math.PI;
  const hue = ((angle % 360) + 360) % 360;
  return hslToHex(hue, PALETTE_SATURATION, LIGHTNESS_TOP - radius * LIGHTNESS_RANGE);
}

/**
 * 颜色 → 圆形调色盘坐标（colorAtWheelPoint 的反函数），用于摆放圆环标记。
 * @param {unknown} value
 * @returns {{dx: number, dy: number} | null} 单位圆坐标；非法颜色返回 null
 */
export function wheelPointForColor(value) {
  const hex = normalizeHexColor(value);
  if (!hex) return null;
  const { h, l } = hexToHsl(hex);
  const radius = clamp01((LIGHTNESS_TOP - l) / LIGHTNESS_RANGE);
  const angle = ((h % 360) + 360) % 360;
  const radians = (angle * Math.PI) / 180;
  return {
    dx: Math.sin(radians) * radius,
    dy: -Math.cos(radians) * radius,
  };
}

/**
 * 由选中颜色生成同色系三段渐变（歌词层覆盖 --lyrics-gradient 用）。
 * 亮端提亮、暗端略加深，保持同一色相；暗端只轻微压暗，避免用户选到中/深色时
 * 歌词在深色背景上太暗看不清。
 * @param {unknown} value
 * @returns {string | null} CSS linear-gradient 值；非法颜色返回 null
 */
export function gradientFromColor(value) {
  const base = normalizeHexColor(value);
  if (!base) return null;
  const { h, s, l } = hexToHsl(base);
  const light = hslToHex(h, clamp(s * 0.85 + 10, 0, 100), clamp(l + 26, 0, 96));
  const deep = hslToHex(h, clamp(s + 8, 0, 100), clamp(l - 10, 18, 92));
  return `linear-gradient(${GRADIENT_ANGLE}, ${light} 0%, ${base} 52%, ${deep} 100%)`;
}

function resolveMaxColors(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 ? Math.floor(number) : DEFAULT_MAX_COLORS;
}

/**
 * 归一化已保存颜色列表：过滤非法值、去重、最多 maxColors 个，保持输入顺序。
 * @param {unknown} list
 * @param {number} [maxColors]
 * @returns {string[]}
 */
export function normalizeSavedColors(list, maxColors = DEFAULT_MAX_COLORS) {
  const limit = resolveMaxColors(maxColors);
  const out = [];
  for (const entry of Array.isArray(list) ? list : []) {
    const hex = normalizeHexColor(entry);
    if (!hex || out.includes(hex)) continue;
    out.push(hex);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * 把一个颜色记入已保存列表：去重并放到最前（“最新的在前”），超出上限截断。
 * @param {unknown} list
 * @param {unknown} value
 * @param {number} [maxColors]
 * @returns {string[]}
 */
export function rememberSavedColor(list, value, maxColors = DEFAULT_MAX_COLORS) {
  const limit = resolveMaxColors(maxColors);
  const current = normalizeSavedColors(list, limit);
  const hex = normalizeHexColor(value);
  if (!hex) return current;
  return [hex, ...current.filter((entry) => entry !== hex)].slice(0, limit);
}

function savedColorsEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

const h = (doc, tag, className, text) => {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
};

const setAttr = (element, name, value) => {
  if (element && typeof element.setAttribute === 'function') element.setAttribute(name, value);
};

function clearChildren(element) {
  if (!element) return;
  if (typeof element.replaceChildren === 'function') {
    element.replaceChildren();
    return;
  }
  while (element.children.length > 0) {
    const child = element.children.pop();
    if (child) {
      child.parent = null;
      child.isConnected = false;
    }
  }
}

const safeCall = (callback, payload) => {
  if (typeof callback !== 'function') return;
  try {
    callback(payload);
  } catch {
    // 使用方回调异常不影响调色盘自身状态
  }
};

/**
 * 创建调色盘（歌词颜色 / 氛围色彩共用同一套逻辑，只是板面形状不同）。
 * @param {object} [options]
 * @param {Document} [options.document] 注入 document（Node 测试用）
 * @param {string|null} [options.color='#a8dcff'] 初始颜色；传 null 表示“跟随曲风”（不显示标记）
 * @param {string[]} [options.savedColors=[]] 初始已保存颜色
 * @param {number} [options.maxColors=8] 已保存颜色上限
 * @param {'rect'|'circle'} [options.shape='rect'] 板面形状：rect=圆角矩形（歌词），circle=圆形（氛围）
 * @param {string} [options.ariaLabel] 板面无障碍名称（缺省按形状给默认文案）
 * @param {(hex: string) => void} [options.onPick] 用户选色（点击 / 拖动 / 点色块）时回调
 * @param {(list: string[]) => void} [options.onSavedColorsChange] 已保存颜色列表变化时回调
 * @param {(hex: string) => void} [options.onRemove] 从已保存颜色里删除某项时回调
 * @returns {{
 *   el: Element | null,
 *   getColor(): string | null,
 *   setColor(color: string | null): void,       // 只同步 UI，不触发回调
 *   getSavedColors(): string[],
 *   setSavedColors(list: string[]): void,       // 只同步 UI，不触发回调
 *   dispose(): void,
 * }}
 */
export function createColorPalette(options = {}) {
  const doc = options.document || (typeof document !== 'undefined' ? document : null);
  const maxColors = resolveMaxColors(options.maxColors);
  // 圆形板面：坐标按外接正方形归一化，圆心 → 色相，半径 → 亮度。
  const shape = options.shape === 'circle' ? 'circle' : 'rect';
  const ariaLabel =
    typeof options.ariaLabel === 'string' && options.ariaLabel
      ? options.ariaLabel
      : shape === 'circle'
        ? '圆形调色盘（点击或拖动选色）'
        : '歌词颜色调色盘（点击或拖动选色）';
  const callbacks = {
    onPick: typeof options.onPick === 'function' ? options.onPick : null,
    onSavedColorsChange:
      typeof options.onSavedColorsChange === 'function' ? options.onSavedColorsChange : null,
    onRemove: typeof options.onRemove === 'function' ? options.onRemove : null,
  };

  const state = {
    color: options.color === undefined ? DEFAULT_PALETTE_COLOR : normalizeHexColor(options.color),
    savedColors: normalizeSavedColors(options.savedColors, maxColors),
    dragging: false,
    lastPointerAt: 0,
    disposed: false,
  };

  const listeners = [];
  let root = null;
  let board = null;
  let marker = null;
  let savedList = null;
  let dragListeners = [];

  const on = (target, event, handler, opts) => {
    if (!target || typeof target.addEventListener !== 'function') return () => {};
    target.addEventListener(event, handler, opts);
    const remove = () => target.removeEventListener?.(event, handler, opts);
    listeners.push(remove);
    return remove;
  };

  // 无 DOM 环境：返回结构一致的 no-op API（数据仍可读写，便于 Node 测试）。
  if (!doc || typeof doc.createElement !== 'function') {
    return {
      el: null,
      getColor: () => state.color,
      setColor,
      getSavedColors: () => state.savedColors.slice(),
      setSavedColors,
      dispose,
    };
  }

  build();
  return {
    el: root,
    getColor: () => state.color,
    setColor,
    getSavedColors: () => state.savedColors.slice(),
    setSavedColors,
    dispose,
  };

  function build() {
    root = h(doc, 'div', `color-palette color-palette--${shape}`);
    board = h(doc, 'div', 'color-palette-board');
    setAttr(board, 'role', 'slider');
    setAttr(board, 'tabindex', '0');
    setAttr(board, 'aria-label', ariaLabel);
    setAttr(board, 'aria-valuemin', '0');
    setAttr(board, 'aria-valuemax', '100');
    const dots = h(doc, 'span', 'color-palette-dots');
    setAttr(dots, 'aria-hidden', 'true');
    marker = h(doc, 'span', 'color-palette-marker');
    setAttr(marker, 'aria-hidden', 'true');
    board.append(dots, marker);
    savedList = h(doc, 'div', 'color-palette-saved');
    setAttr(savedList, 'role', 'group');
    setAttr(savedList, 'aria-label', '已保存颜色');
    root.append(board, savedList);
    on(board, 'pointerdown', handlePointerDown);
    on(board, 'click', handleClick);
    on(board, 'keydown', handleKeydown);
    syncVisualState();
    renderSavedColors();
  }

  function syncVisualState() {
    if (!root) return;
    root.dataset.empty = state.color ? 'false' : 'true';
    if (marker) {
      if (shape === 'circle') {
        const wheel = state.color ? wheelPointForColor(state.color) : null;
        if (wheel) {
          // 圆心在 50%/50%，位移用外接正方形的一半作为半径。
          marker.style.left = `${(50 + wheel.dx * 50).toFixed(2)}%`;
          marker.style.top = `${(50 + wheel.dy * 50).toFixed(2)}%`;
          marker.style.setProperty?.('--color-palette-marker', state.color);
        } else {
          marker.style.setProperty?.('--color-palette-marker', 'transparent');
        }
      } else {
        const point = state.color ? palettePointForColor(state.color) : null;
        if (point) {
          marker.style.left = `${(point.x * 100).toFixed(2)}%`;
          marker.style.top = `${(point.y * 100).toFixed(2)}%`;
          marker.style.setProperty?.('--color-palette-marker', state.color);
        } else {
          marker.style.setProperty?.('--color-palette-marker', 'transparent');
        }
      }
    }
    if (board) {
      const ratio =
        state.color === null || state.color === undefined
          ? null
          : shape === 'circle'
            ? wheelPointForColor(state.color)
            : palettePointForColor(state.color);
      const ratioX = ratio ? (shape === 'circle' ? 0.5 + ratio.dx * 0.5 : ratio.x) : null;
      setAttr(board, 'aria-valuenow', ratioX === null ? '' : String(Math.round(ratioX * 100)));
      setAttr(board, 'aria-valuetext', state.color || '跟随曲风');
    }
    syncSavedActive();
  }

  function syncSavedActive() {
    if (!savedList) return;
    for (const child of savedList.children) {
      const hex = child?.dataset?.color;
      child.classList?.toggle('is-active', Boolean(hex && hex === state.color));
      setAttr(child, 'aria-pressed', String(Boolean(hex && hex === state.color)));
    }
  }

  function renderSavedColors() {
    if (!savedList) return;
    clearChildren(savedList);
    savedList.dataset.empty = state.savedColors.length === 0 ? 'true' : 'false';
    const swatches = state.savedColors.map((hex) => buildSwatch(hex));
    savedList.append(...swatches);
  }

  function buildSwatch(hex) {
    const swatch = h(doc, 'button', 'color-palette-swatch');
    swatch.type = 'button';
    swatch.dataset.color = hex;
    swatch.style.backgroundColor = hex;
    setAttr(swatch, 'aria-label', `使用颜色 ${hex}`);
    setAttr(swatch, 'title', `${hex} · 点击应用，点 × 删除`);
    const remove = h(doc, 'span', 'color-palette-swatch-remove', '×');
    remove.dataset.action = 'remove';
    setAttr(remove, 'aria-hidden', 'true');
    swatch.append(remove);
    swatch.classList.toggle('is-active', hex === state.color);
    setAttr(swatch, 'aria-pressed', String(hex === state.color));
    on(swatch, 'click', (event) => {
      if (state.disposed) return;
      const target = event?.target;
      if (target && target !== swatch && target.dataset?.action === 'remove') {
        removeSavedColor(hex);
        return;
      }
      applyPick(hex, { commit: true });
    });
    return swatch;
  }

  function removeSavedColor(hex) {
    const next = state.savedColors.filter((entry) => entry !== hex);
    if (next.length === state.savedColors.length) return;
    state.savedColors = next;
    renderSavedColors();
    syncVisualState();
    safeCall(callbacks.onRemove, hex);
    safeCall(callbacks.onSavedColorsChange, state.savedColors.slice());
  }

  function commitSavedColor(hex) {
    const next = rememberSavedColor(state.savedColors, hex, maxColors);
    if (savedColorsEqual(next, state.savedColors)) return next;
    state.savedColors = next;
    renderSavedColors();
    safeCall(callbacks.onSavedColorsChange, state.savedColors.slice());
    return next;
  }

  function applyPick(hex, { commit = false } = {}) {
    if (state.disposed) return null;
    const value = normalizeHexColor(hex);
    if (!value) return null;
    state.color = value;
    syncVisualState();
    safeCall(callbacks.onPick, value);
    if (commit) commitSavedColor(value);
    return value;
  }

  function setColor(value) {
    if (state.disposed) return;
    state.color = normalizeHexColor(value);
    syncVisualState();
  }

  function setSavedColors(list) {
    if (state.disposed) return;
    state.savedColors = normalizeSavedColors(list, maxColors);
    renderSavedColors();
    syncVisualState();
  }

  function pointFromEvent(event) {
    if (!board) return null;
    const rect =
      typeof board.getBoundingClientRect === 'function' ? board.getBoundingClientRect() : null;
    const width = Number(rect?.width);
    const height = Number(rect?.height);
    if (!(width > 0) || !(height > 0)) return null;
    const left = Number(rect?.left) || 0;
    const top = Number(rect?.top) || 0;
    const clientX = Number(event?.clientX);
    const clientY = Number(event?.clientY);
    if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
      return { x: clamp01((clientX - left) / width), y: clamp01((clientY - top) / height) };
    }
    const offsetX = Number(event?.offsetX);
    const offsetY = Number(event?.offsetY);
    if (Number.isFinite(offsetX) && Number.isFinite(offsetY)) {
      return { x: clamp01(offsetX / width), y: clamp01(offsetY / height) };
    }
    return null;
  }

  // 归一化坐标（0..1）→ 当前形状对应的颜色。
  function colorFromPoint(point) {
    if (!point) return null;
    if (shape === 'circle') {
      // 圆心在 (0.5, 0.5)；宽度 / 高度可能不等，用外接正方形的较小边作半径。
      return colorAtWheelPoint((point.x - 0.5) * 2, (point.y - 0.5) * 2);
    }
    return colorAtPalettePoint(point.x, point.y);
  }

  function pickAtEvent(event) {
    const point = pointFromEvent(event);
    if (!point) return null;
    const hex = colorFromPoint(point);
    applyPick(hex);
    return hex;
  }

  function handlePointerDown(event) {
    if (state.disposed) return;
    const button = Number(event?.button);
    if (event?.type === 'pointerdown' && Number.isFinite(button) && button > 0) return;
    state.lastPointerAt = Date.now();
    state.dragging = true;
    root?.classList?.add('is-dragging');
    event?.preventDefault?.();
    board?.setPointerCapture?.(event?.pointerId);
    pickAtEvent(event);
    startDragListeners();
  }

  function startDragListeners() {
    stopDragListeners();
    if (!doc || typeof doc.addEventListener !== 'function') return;
    const move = (event) => {
      if (!state.dragging || state.disposed) return;
      event?.preventDefault?.();
      pickAtEvent(event);
    };
    const end = () => {
      if (!state.dragging || state.disposed) return;
      finishDrag();
    };
    doc.addEventListener('pointermove', move);
    doc.addEventListener('pointerup', end);
    doc.addEventListener('pointercancel', end);
    dragListeners = [
      () => doc.removeEventListener?.('pointermove', move),
      () => doc.removeEventListener?.('pointerup', end),
      () => doc.removeEventListener?.('pointercancel', end),
    ];
  }

  function stopDragListeners() {
    for (const remove of dragListeners.splice(0)) remove();
  }

  function finishDrag() {
    state.dragging = false;
    root?.classList?.remove('is-dragging');
    stopDragListeners();
    if (state.color) commitSavedColor(state.color);
  }

  // 兜底 click：指针事件不可用（或被取消）时仍能点选；指针刚处理过则跳过，避免重复。
  function handleClick(event) {
    if (state.disposed) return;
    if (Date.now() - state.lastPointerAt < 500) return;
    const point = pointFromEvent(event);
    if (!point) return;
    applyPick(colorFromPoint(point), { commit: true });
  }

  // 键盘可访问性：方向键移动标记并实时预览，Enter / 空格把当前颜色存入已保存列表。
  function handleKeydown(event) {
    if (state.disposed) return;
    const key = event?.key;
    if (key === 'Enter' || key === ' ') {
      event?.preventDefault?.();
      if (state.color) commitSavedColor(state.color);
      return;
    }
    const step = event?.shiftKey ? 0.1 : 0.02;
    // 圆形盘用“色相 / 半径”连续量操作，比在 x/y 上逐像素挪动更好调。
    if (shape === 'circle') {
      const wheel = state.color ? wheelPointForColor(state.color) : { dx: 0, dy: 0 };
      const radius = Math.min(1, Math.hypot(wheel.dx, wheel.dy));
      const angle = Math.atan2(wheel.dx, -wheel.dy);
      let nextRadius = radius;
      let nextAngle = angle;
      if (key === 'ArrowLeft') nextAngle = angle - step;
      else if (key === 'ArrowRight') nextAngle = angle + step;
      else if (key === 'ArrowUp') nextRadius = clamp01(radius - step);
      else if (key === 'ArrowDown') nextRadius = clamp01(radius + step);
      else return;
      event?.preventDefault?.();
      applyPick(
        colorAtWheelPoint(Math.sin(nextAngle) * nextRadius, -Math.cos(nextAngle) * nextRadius),
      );
      return;
    }
    const point = state.color ? palettePointForColor(state.color) : { x: 0.5, y: 0.5 };
    let next = null;
    if (key === 'ArrowLeft') next = { x: clamp01(point.x - step), y: point.y };
    else if (key === 'ArrowRight') next = { x: clamp01(point.x + step), y: point.y };
    else if (key === 'ArrowUp') next = { x: point.x, y: clamp01(point.y - step) };
    else if (key === 'ArrowDown') next = { x: point.x, y: clamp01(point.y + step) };
    if (!next) return;
    event?.preventDefault?.();
    applyPick(colorAtPalettePoint(next.x, next.y));
  }

  function dispose() {
    if (state.disposed) return;
    state.disposed = true;
    state.dragging = false;
    stopDragListeners();
    for (const remove of listeners.splice(0)) remove();
    root?.remove?.();
    root = null;
    board = null;
    marker = null;
    savedList = null;
  }
}

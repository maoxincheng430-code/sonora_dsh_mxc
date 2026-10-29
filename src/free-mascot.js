// 「逃出升天」：把歌词面板里的大肥鱼放出来，变成可以在页面上自由活动的独立桌宠。
//
// 参考 dsh-pet（https://github.com/PC2005-cloud/dsh-pet）的桌宠思路：
// - 角色可以用鼠标拖着走，松手后自己慢慢「游」回原位（带弹性的漂浮感）
// - 右键弹出功能菜单：调歌词字号 / 模式 / 位置 / 颜色，以及念台词、收回面板
// - 双击让它说一句话；空闲时它在桌面上慢悠悠地漂
//
// 与面板内的吉祥物共用同一套台词库（mascot-pet.js）与图片素材。
// 组件支持 options.document 注入（Node 单测用假 document），无 document 时返回 no-op。

import { MASCOT_QUIPS, MASCOT_SCENES, pickQuip } from './mascot-pet.js';

/** 桌宠可拖动的边界留白（像素）。 */
const EDGE_PADDING = 8;
/** 松手后回到初始位置的阻尼。 */
const HOME_EASE = 0.06;
/** 空闲漂移的最大偏移与速度。 */
const DRIFT_RADIUS = 26;
const DRIFT_SPEED = 0.00035;
/** 右键菜单里可选的歌词字号（与歌词面板保持一致）。 */
export const PET_SIZE_OPTIONS = [
  { id: 'small', label: '小肥鱼' },
  { id: 'medium', label: '肥鱼' },
  { id: 'large', label: '大肥鱼' },
];

/**
 * 三档字号对应的桌宠本体尺寸（px）。
 * 与歌词面板里吉祥物的 scale 一致：small 0.82 / medium 1 / large 1.22。
 * 基准 76×88 是「肥鱼」档。
 */
export const PET_BASE_SIZE = { width: 76, height: 88 };
export const PET_SIZE_SCALE = { small: 0.82, medium: 1, large: 1.22 };

/** 把字号档位换算成桌宠像素尺寸（未知档位回退 medium）。 */
export function petSizeFor(level) {
  const scale = PET_SIZE_SCALE[level] ?? PET_SIZE_SCALE.medium;
  return {
    width: Math.round(PET_BASE_SIZE.width * scale),
    height: Math.round(PET_BASE_SIZE.height * scale),
  };
}

/** 菜单里可选的歌词位置。 */
export const PET_POSITION_OPTIONS = [
  { id: 'left', label: '居左' },
  { id: 'center', label: '居中' },
  { id: 'right', label: '居右' },
];

const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);

/**
 * 把目标位置限制在视口内（考虑角色尺寸与留白）。
 * 纯函数，便于单测。
 * @param {{x: number, y: number}} point 期望位置（左上角）
 * @param {{width: number, height: number}} size 角色尺寸
 * @param {{width: number, height: number}} viewport 视口尺寸
 * @param {number} [padding=8]
 * @returns {{x: number, y: number}} 裁剪后的位置
 */
export function clampToViewport(point, size, viewport, padding = EDGE_PADDING) {
  const maxX = Math.max(padding, Number(viewport?.width ?? 0) - Number(size?.width ?? 0) - padding);
  const maxY = Math.max(padding, Number(viewport?.height ?? 0) - Number(size?.height ?? 0) - padding);
  const rawX = Number(point?.x);
  const rawY = Number(point?.y);
  return {
    x: clamp(Number.isFinite(rawX) ? rawX : padding, padding, maxX),
    y: clamp(Number.isFinite(rawY) ? rawY : padding, padding, maxY),
  };
}

/**
 * 空闲漂移的目标位置：绕原点做缓慢的圆周漂移。
 * @param {number} elapsed 经过的毫秒数
 * @param {{x: number, y: number}} origin 漂移圆心
 * @param {number} [radius=DRIFT_RADIUS]
 * @returns {{x: number, y: number}}
 */
export function driftOffset(elapsed, origin, radius = DRIFT_RADIUS) {
  const t = Number(elapsed) || 0;
  const baseX = Number(origin?.x) || 0;
  const baseY = Number(origin?.y) || 0;
  const phase = t * DRIFT_SPEED;
  return {
    x: baseX + Math.sin(phase) * radius,
    // 纵向用两倍频率，形成扁椭圆的「游动」轨迹
    y: baseY + Math.sin(phase * 2 + 1.2) * radius * 0.55,
  };
}

/**
 * 创建独立桌宠。
 * @param {object} [options]
 * @param {Document} [options.document]
 * @param {string} [options.src='mascot/dafeiyu-cut.png']
 * @param {string} [options.name='大肥鱼']
 * @param {number} [options.startX] 初始 x（默认右下角）
 * @param {number} [options.startY]
 * @param {string[]} [options.quips]
 * @param {(action: string, payload?: any) => void} [options.onAction]
 *   菜单动作回调：'size' | 'position' | 'mode' | 'color' | 'reset-color' | 'recall' | 'say'
 * @param {(color: string) => void} [options.onColorPick] 自定义颜色回调
 * @returns {{
 *   el: Element | null,
 *   open(): void,
 *   close(): void,
 *   isOpen(): boolean,
 *   say(text?: string): void,
 *   nextScene(): string,
 *   getMenuState(): object,
 *   setMenuState(patch: object): void,
 *   dispose(): void,
 * }}
 */
export function createFreeMascot(options = {}) {
  const doc = options.document || (typeof document !== 'undefined' ? document : null);
  const src = String(options.src || 'mascot/dafeiyu-cut.png');
  const name = String(options.name || '大肥鱼');
  const quips = Array.isArray(options.quips) && options.quips.length ? options.quips : MASCOT_QUIPS;
  const onAction = typeof options.onAction === 'function' ? options.onAction : null;
  const onColorPick = typeof options.onColorPick === 'function' ? options.onColorPick : null;

  const state = {
    open: false,
    disposed: false,
    lastQuip: '',
    sceneIndex: 0,
    // 菜单里显示的当前歌词设置（由外部同步）
    size: 'medium',
    position: 'center',
    mode: 'classic',
    color: null,
  };

  // 无 DOM：返回结构一致的 no-op
  if (!doc || typeof doc.createElement !== 'function') {
    return {
      el: null,
      open() {
        state.open = true;
      },
      close() {
        state.open = false;
      },
      isOpen: () => state.open,
      say(text) {
        if (typeof text === 'string' && text) state.lastQuip = text;
      },
      nextScene() {
        const line = MASCOT_SCENES[state.sceneIndex % MASCOT_SCENES.length];
        state.sceneIndex += 1;
        state.lastQuip = line;
        return line;
      },
      getMenuState: () => ({ ...state }),
      setMenuState(patch) {
        Object.assign(state, patch && typeof patch === 'object' ? patch : {});
      },
      dispose() {
        state.disposed = true;
      },
    };
  }

  let root = null;
  let bodyEl = null;
  let bubble = null;
  let bubbleText = null;
  let menu = null;
  let quipTimer = 0;
  let frame = 0;
  let disposed = false;
  const listeners = [];

  // 位置与拖动状态
  const position = { x: 0, y: 0 };
  let homeX = 0;
  let homeY = 0;
  // 是否已经确定过初始位置（默认右下角，或外部传入的 startX/startY）
  let hasPositioned = false;
  let dragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let driftClock = 0;

  const on = (target, event, handler, opts) => {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(event, handler, opts);
    listeners.push(() => target.removeEventListener?.(event, handler, opts));
  };

  build();

  return {
    get el() {
      return root;
    },
    open,
    close,
    isOpen: () => state.open,
    say,
    nextScene,
    getMenuState: () => ({ ...state }),
    setMenuState,
    dispose,
  };

  function win() {
    return typeof globalThis.window !== 'undefined' ? globalThis.window : null;
  }

  function viewportSize() {
    const w = win();
    return {
      width: Number(w?.innerWidth) || 1280,
      height: Number(w?.innerHeight) || 720,
    };
  }

  function bodySize() {
    const el = bodyEl?.getBoundingClientRect?.();
    return { width: el?.width || 76, height: el?.height || 88 };
  }

  /**
   * 把当前字号档位写进 CSS 变量，让桌宠本身跟着「小肥鱼 / 肥鱼 / 大肥鱼」变大变小。
   * 尺寸变化后重新夹进视口，避免大号时半个身子跑到屏幕外。
   */
  function applySize() {
    if (!root?.style) return;
    const size = petSizeFor(state.size);
    root.style.setProperty('--pet-w', `${size.width}px`);
    root.style.setProperty('--pet-h', `${size.height}px`);
    // 直接用新尺寸夹紧当前位置：放大后贴边不会溢出，缩小后也不会跳走
    const safe = clampToViewport(position, size, viewportSize());
    position.x = safe.x;
    position.y = safe.y;
    applyPosition();
  }

  function build() {
    root = h(doc, 'div', 'free-mascot');
    setAttr(root, 'aria-hidden', 'true');
    root.hidden = true;

    bodyEl = h(doc, 'div', 'free-mascot-body');
    setAttr(bodyEl, 'role', 'button');
    setAttr(bodyEl, 'tabindex', '0');
    setAttr(bodyEl, 'aria-label', `${name}（拖动移动，右键打开菜单，双击说话）`);
    setAttr(bodyEl, 'title', `${name} · 拖动移动 / 右键菜单 / 双击说话`);

    const img = h(doc, 'img', 'free-mascot-img');
    img.src = src;
    img.alt = name;
    img.draggable = false;
    img.addEventListener('error', () => {
      bodyEl.classList.add('is-fallback');
      img.removeAttribute('src');
    });
    bodyEl.append(img);

    bubble = h(doc, 'div', 'free-mascot-bubble');
    setAttr(bubble, 'aria-live', 'polite');
    bubbleText = h(doc, 'span', 'free-mascot-bubble-text', '');
    bubble.append(bubbleText);

    menu = buildMenu();
    // 菜单不放进 root：它是 position: fixed，挂到 body 上更稳妥（打开时才插入）。
    root.append(bodyEl, bubble);

    // 位置：有 startX/startY 就用它（上次拖到的位置），否则默认右下角
    applySize(); // 先把 --pet-w/--pet-h 写上，后续 bodySize() 才能读到正确尺寸
    const vw = viewportSize();
    const size = bodySize();
    const hasStart = Number.isFinite(options.startX) && Number.isFinite(options.startY);
    homeX = hasStart ? options.startX : vw.width - size.width - 40;
    homeY = hasStart ? options.startY : vw.height - size.height - 150;
    // 夹进可视区域，避免上次在更小的窗口里拖的位置现在跑到屏幕外
    const safeHome = clampToViewport({ x: homeX, y: homeY }, size, vw);
    homeX = safeHome.x;
    homeY = safeHome.y;
    hasPositioned = true;
    position.x = homeX;
    position.y = homeY;
    applyPosition();

    // ---- 交互 ----
    on(bodyEl, 'pointerdown', onPointerDown);
    on(bodyEl, 'dblclick', () => {
      say();
      startDrift();
    });
    on(bodyEl, 'keydown', (event) => {
      if (event?.key === 'Enter' || event?.key === ' ') {
        event?.preventDefault?.();
        say();
      }
    });
    on(bodyEl, 'contextmenu', (event) => {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      toggleMenu();
    });
    // 点击空白处收起菜单
    on(win(), 'pointerdown', (event) => {
      if (!state.open || !menu) return;
      if (menu.hidden) return;
      const target = event?.target;
      if (target === bodyEl || bodyEl?.contains?.(target)) return;
      if (menu.contains?.(target)) return;
      hideMenu();
    });
    on(win(), 'resize', onResize);
    // Esc 收起菜单（不关闭整个桌宠，方便继续玩）
    on(win(), 'keydown', (event) => {
      if (event?.key === 'Escape' && menu && !menu.hidden) {
        event?.stopPropagation?.();
        hideMenu();
      }
    });
  }

  function buildMenu() {
    const el = h(doc, 'div', 'free-mascot-menu');
    setAttr(el, 'role', 'menu');
    setAttr(el, 'aria-label', `${name} 菜单`);
    el.hidden = true;

    const title = h(doc, 'div', 'free-mascot-menu-title', name);
    el.append(title);

    // 歌词字号
    el.append(buildMenuGroup('歌词字号', PET_SIZE_OPTIONS, 'size'));
    // 歌词位置
    el.append(buildMenuGroup('歌词位置', PET_POSITION_OPTIONS, 'position'));

    // 更多动作
    const actions = h(doc, 'div', 'free-mascot-menu-actions');
    const makeAction = (label, action) => {
      const button = h(doc, 'button', 'free-mascot-menu-action', label);
      button.type = 'button';
      setAttr(button, 'role', 'menuitem');
      on(button, 'click', () => {
        hideMenu();
        if (action === 'say') {
          say();
          return;
        }
        emit(action);
      });
      return button;
    };
    actions.append(
      makeAction('说一句话', 'say'),
      makeAction('跟随曲风配色', 'reset-color'),
      makeAction('打开歌词面板', 'open-panel'),
      makeAction('收回面板', 'recall'),
    );
    el.append(actions);

    // 自定义颜色（直接嵌一个色块调色盘）
    const colorGroup = h(doc, 'div', 'free-mascot-menu-group');
    colorGroup.append(h(doc, 'span', 'free-mascot-menu-label', '歌词颜色'));
    const swatches = h(doc, 'div', 'free-mascot-colors');
    const COLORS = ['#a8dcff', '#8b75ff', '#4dc8ff', '#ff8fb1', '#ffd36e', '#8cdbc9'];
    for (const color of COLORS) {
      const swatch = h(doc, 'button', 'free-mascot-color');
      swatch.type = 'button';
      swatch.style.background = color;
      swatch.dataset.color = color;
      setAttr(swatch, 'aria-label', `歌词颜色 ${color}`);
      on(swatch, 'click', () => {
        hideMenu();
        state.color = color;
        onColorPick?.(color);
      });
      swatches.append(swatch);
    }
    colorGroup.append(swatches);
    el.append(colorGroup);

    return el;
  }

  function buildMenuGroup(label, items, action) {
    const group = h(doc, 'div', 'free-mascot-menu-group');
    group.append(h(doc, 'span', 'free-mascot-menu-label', label));
    const row = h(doc, 'div', 'free-mascot-menu-row');
    const buttons = new Map();
    for (const item of items) {
      const button = h(doc, 'button', 'free-mascot-menu-choice', item.label);
      button.type = 'button';
      setAttr(button, 'role', 'menuitemradio');
      button.dataset[action] = item.id;
      on(button, 'click', () => {
        hideMenu();
        state[action] = item.id;
        // 切字号时，桌宠本身体型跟着一起变
        if (action === 'size') applySize();
        syncMenuSelection();
        emit(action, item.id);
      });
      buttons.set(item.id, button);
      row.append(button);
    }
    group.dataset.action = action;
    group.append(row);
    return group;
  }

  function syncMenuSelection() {
    if (!menu) return;
    menu.querySelectorAll?.('[data-size]').forEach((button) => {
      const active = button.dataset.size === state.size;
      button.classList.toggle('is-active', active);
      setAttr(button, 'aria-checked', String(active));
    });
    menu.querySelectorAll?.('[data-position]').forEach((button) => {
      const active = button.dataset.position === state.position;
      button.classList.toggle('is-active', active);
      setAttr(button, 'aria-checked', String(active));
    });
  }

  function setMenuState(patch) {
    if (!patch || typeof patch !== 'object') return;
    const sizeChanged = Object.prototype.hasOwnProperty.call(patch, 'size');
    Object.assign(state, patch);
    // 外部（歌词面板）同步字号时，桌宠也要跟着变大变小
    if (sizeChanged) applySize();
    syncMenuSelection();
  }

  function emit(action, payload) {
    try {
      onAction?.(action, payload);
    } catch {
      // 使用方回调异常不影响桌宠
    }
  }

  // ---- 打开 / 关闭 ----

  function open() {
    if (disposed || !root) return;
    state.open = true;
    root.hidden = false;
    root.setAttribute('aria-hidden', 'false');
    root.classList.add('is-open');
    // 重新打开时按当前字号档位还原体型
    applySize();
    // 位置：只在「第一次打开且没有指定 startX/startY」时才贴右下角默认位；
    // 之后的每次打开都停在用户上次拖到的地方（homeX/homeY 已由拖动结束更新）。
    if (!hasPositioned) {
      const vw = viewportSize();
      const size = bodySize();
      homeX = Number.isFinite(options.startX) ? options.startX : vw.width - size.width - 40;
      homeY = Number.isFinite(options.startY) ? options.startY : vw.height - size.height - 150;
      hasPositioned = true;
    }
    const clamped = clampToViewport({ x: homeX, y: homeY }, bodySize(), viewportSize());
    homeX = clamped.x;
    homeY = clamped.y;
    position.x = homeX;
    position.y = homeY;
    applyPosition();
    syncMenuSelection();
    // 出场台词
    say('终于、终于出来了……才不是特意跑出来找你的。');
    startDrift();
  }

  function close() {
    if (disposed) return;
    state.open = false;
    hideMenu();
    stopDrift();
    if (root) {
      root.classList.remove('is-open');
      root.hidden = true;
      root.setAttribute('aria-hidden', 'true');
    }
  }

  function onResize() {
    if (!state.open) return;
    const vw = viewportSize();
    const size = bodySize();
    homeX = vw.width - size.width - 40;
    homeY = vw.height - size.height - 150;
    const safe = clampToViewport(position, size, vw);
    position.x = safe.x;
    position.y = safe.y;
    applyPosition();
  }

  // ---- 拖动 ----

  function onPointerDown(event) {
    if (disposed) return;
    // 右键交给 contextmenu 处理
    if (Number(event?.button) > 0) return;
    dragging = true;
    hideMenu();
    stopDrift();
    const rect = bodyEl.getBoundingClientRect();
    dragOffsetX = Number(event.clientX) - rect.left;
    dragOffsetY = Number(event.clientY) - rect.top;
    bodyEl.classList.add('is-dragging');
    bodyEl.setPointerCapture?.(event.pointerId);
    const winEl = win();
    const move = (e) => {
      if (!dragging) return;
      const size = bodySize();
      const next = clampToViewport(
        { x: Number(e.clientX) - dragOffsetX, y: Number(e.clientY) - dragOffsetY },
        size,
        viewportSize(),
      );
      position.x = next.x;
      position.y = next.y;
      applyPosition();
    };
    const end = () => {
      if (!dragging) return;
      dragging = false;
      bodyEl?.classList.remove('is-dragging');
      winEl?.removeEventListener('pointermove', move);
      winEl?.removeEventListener('pointerup', end);
      winEl?.removeEventListener('pointercancel', end);
      // 关键：把新位置设为「家」，否则空闲漂移会把桌宠拉回原来的 homeX/homeY。
      const size = bodySize();
      const safe = clampToViewport(position, size, viewportSize());
      homeX = safe.x;
      homeY = safe.y;
      position.x = safe.x;
      position.y = safe.y;
      applyPosition();
      emit('move', { x: Math.round(position.x), y: Math.round(position.y) });
    };
    winEl?.addEventListener('pointermove', move, { passive: true });
    winEl?.addEventListener('pointerup', end);
    winEl?.addEventListener('pointercancel', end);
  }

  function applyPosition() {
    if (!root) return;
    root.style.setProperty('--free-x', `${Math.round(position.x)}px`);
    root.style.setProperty('--free-y', `${Math.round(position.y)}px`);
  }

  // ---- 空闲漂移 ----

  function startDrift() {
    if (disposed || frame) return;
    const raf = win()?.requestAnimationFrame?.bind(win());
    if (!raf) return;
    const step = (now) => {
      if (disposed || !state.open) {
        frame = 0;
        return;
      }
      if (dragging) {
        frame = raf(step);
        return;
      }
      driftClock = now;
      const size = bodySize();
      const drift = driftOffset(now, { x: homeX, y: homeY });
      const safe = clampToViewport(drift, size, viewportSize());
      // 平滑靠近漂移目标
      position.x += (safe.x - position.x) * HOME_EASE;
      position.y += (safe.y - position.y) * HOME_EASE;
      applyPosition();
      frame = raf(step);
    };
    frame = raf(step);
    const cancel = win()?.cancelAnimationFrame?.bind(win());
    if (cancel) listeners.push(() => cancel(frame));
  }

  function stopDrift() {
    const cancel = win()?.cancelAnimationFrame?.bind(win());
    if (frame && cancel) cancel(frame);
    frame = 0;
  }

  // ---- 菜单 ----

  function toggleMenu() {
    if (!menu) return;
    if (menu.hidden) showMenu();
    else hideMenu();
  }

  function showMenu() {
    if (!menu || !root) return;
    syncMenuSelection();
    menu.hidden = false;
    // 菜单用 position: fixed 相对视口定位；挂到 body 上避免被父级 transform 影响。
    if (menu.parentElement !== doc.body) doc.body.append(menu);
    const rect = bodyEl.getBoundingClientRect();
    // 先量出真实尺寸（刚显示时可能为 0，这里读一次布局）
    const menuRect = menu.getBoundingClientRect();
    const menuW = menuRect.width || menu.offsetWidth || 200;
    const menuH = menuRect.height || menu.offsetHeight || 240;
    const vw = viewportSize();
    const vh = viewportSize();
    // 水平：优先居中在角色上方，超出则贴边
    const left = clamp(
      rect.left + rect.width / 2 - menuW / 2,
      8,
      Math.max(8, vw.width - menuW - 8),
    );
    // 垂直：优先放在角色上方，放不下就放到下方
    let top = rect.top - menuH - 12;
    if (top < 8) top = Math.min(rect.bottom + 12, Math.max(8, vh.height - menuH - 8));
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(clamp(top, 8, Math.max(8, vh.height - menuH - 8)))}px`;
  }

  function hideMenu() {
    if (menu) menu.hidden = true;
  }

  // ---- 说话 ----

  function say(text) {
    if (disposed || !bubble) return;
    const message = typeof text === 'string' && text ? text : pickQuip(quips, state.lastQuip);
    if (!message) return;
    state.lastQuip = message;
    bubbleText.textContent = message;
    bubble.classList.add('is-visible');
    if (quipTimer) clearTimeout(quipTimer);
    const hold = Math.max(2600, Math.min(9000, message.length * 110));
    quipTimer = setTimeout(() => {
      bubble?.classList.remove('is-visible');
      quipTimer = 0;
    }, hold);
  }

  function nextScene() {
    if (disposed) return '';
    const line = MASCOT_SCENES[state.sceneIndex % MASCOT_SCENES.length];
    state.sceneIndex += 1;
    say(line);
    return line;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    state.disposed = true;
    if (quipTimer) clearTimeout(quipTimer);
    quipTimer = 0;
    stopDrift();
    for (const remove of listeners.splice(0)) remove();
    root?.remove?.();
    menu?.remove?.();
    root = null;
    bodyEl = null;
    bubble = null;
    bubbleText = null;
    menu = null;
  }
}

const h = (doc, tag, className, text) => {
  const el = doc.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
};

const setAttr = (el, key, value) => {
  if (el && typeof el.setAttribute === 'function') el.setAttribute(key, value);
};
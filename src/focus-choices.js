// 专注模式的「可选交互」入口：模式 / 场景 / 标签。
// 三个胶囊按钮常驻在计时器下方，点击后从底部浮出选择面板（sheet），
// 选中立即生效（模式写回 pomodoro、场景写回 ambience、标签写回本地记录）。
import './focus-choices.css';
import { MASCOT_OPTIONS, findMascot } from './mascot-options.js';

export const FOCUS_MODE_OPTIONS = [
  { id: 'pomodoro', name: '番茄钟', desc: '25 分钟专注 · 5 分钟休息（每 4 个长休息）' },
  { id: 'countdown', name: '倒计时', desc: '设定一个时长，到点停下' },
  { id: 'stopwatch', name: '正计时', desc: '从零开始，随用随记' },
];

export const FOCUS_SCENE_OPTIONS = [
  { id: 'none', name: '无背景', desc: '只留粒子宇宙' },
  { id: 'rain', name: '雨', desc: '雨声 · 雨幕' },
  { id: 'thunder', name: '雷雨', desc: '雨声 · 雷声' },
  { id: 'beach', name: '海滩', desc: '浪潮 · 晚风' },
  { id: 'library', name: '图书馆', desc: '纸笔 · 翻书声' },
  { id: 'image', name: '自定义', desc: '背景图片 / 视频' },
];

export const FOCUS_TAGS = [
  { id: 'focus', name: '专注', color: '#ff8a7a' },
  { id: 'work', name: '工作', color: '#ffa06b' },
  { id: 'study', name: '学习', color: '#ffc65c' },
  { id: 'read', name: '阅读', color: '#ff6b6b' },
  { id: 'meditate', name: '冥想', color: '#58a6ff' },
  { id: 'exercise', name: '运动', color: '#39d98a' },
];

const STORE_KEY = 'sonora-focus-choices';
const MIN_COUNTDOWN = 5;
const MAX_COUNTDOWN = 120;
const COUNTDOWN_STEP = 5;

const ICONS = {
  pomodoro: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="7"/><path d="M12 9.5V13l2.4 1.8"/><path d="M9.5 3.5h5"/></svg>`,
  countdown: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.5h10M7 20.5h10M8.2 3.5c0 4.6 7.6 4.6 7.6 8.5s-7.6 3.9-7.6 8.5M15.8 3.5c0 4.6-7.6 4.6-7.6 8.5s7.6 3.9 7.6 8.5"/></svg>`,
  stopwatch: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="7"/><path d="M12 9.5V13h3"/><path d="M9.5 3.5h5"/><path d="M17.8 6.2l1.4 1.4"/></svg>`,
  scene: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="12" rx="2"/><path d="M3.5 14l4.2-3.8 3.4 3 3-2.6 4.4 3.4"/><circle cx="8.2" cy="8.4" r="1.2"/></svg>`,
  tag: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11.4V4.6h6.8l8.6 8.6-6.8 6.8L4 11.4z"/><circle cx="8.2" cy="8.2" r="1.1"/></svg>`,
};

function loadSaved() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// options: { pomodoro, getScene, setScene, onTag }
export function createFocusChoices(options = {}) {
  const {
    pomodoro,
    getScene = () => 'none',
    setScene = () => {},
    onTag = null,
    getMascots = () => MASCOT_OPTIONS,
    getPet = () => ({ id: 'dafeiyu', src: 'mascot/dafeiyu-cut.png', name: '大肥鱼' }),
    onPet = () => {},
    onPetUpload = () => {},
  } = options;
  if (!pomodoro) throw new TypeError('createFocusChoices 需要 pomodoro 实例');

  const saved = loadSaved();
  let tagId = FOCUS_TAGS.some((item) => item.id === saved.tag) ? saved.tag : 'focus';
  let countdownMinutes = clamp(
    Math.round(Number(saved.countdown) || 25),
    MIN_COUNTDOWN,
    MAX_COUNTDOWN,
  );

  // 恢复上次选择的计时模式
  if (FOCUS_MODE_OPTIONS.some((item) => item.id === saved.mode)) {
    pomodoro.setMode(saved.mode);
  }
  pomodoro.setCountdown(countdownMinutes);

  // ---------- 三个入口胶囊 ----------
  const root = document.createElement('div');
  root.className = 'focus-choices';
  root.innerHTML = `
    <button type="button" class="focus-choice focus-choice-mode" data-kind="mode">
      <span class="focus-choice-icon">${ICONS.pomodoro}</span>
      <span class="focus-choice-text"><b data-choice-mode>番茄钟</b><small data-choice-mode-sub>25 分钟专注 · 5 分钟休息</small></span>
      <span class="focus-choice-arrow" aria-hidden="true">›</span>
    </button>
    <div class="focus-choice-pair">
      <button type="button" class="focus-choice" data-kind="scene">
        <span class="focus-choice-icon">${ICONS.scene}</span>
        <span class="focus-choice-text"><b data-choice-scene>无背景</b><small>专注场景</small></span>
        <span class="focus-choice-arrow" aria-hidden="true">›</span>
      </button>
      <button type="button" class="focus-choice" data-kind="tag">
        <span class="focus-choice-icon"><span class="focus-choice-dot" data-choice-dot></span></span>
        <span class="focus-choice-text"><b data-choice-tag>专注</b><small>本次标签</small></span>
        <span class="focus-choice-arrow" aria-hidden="true">›</span>
      </button>
    </div>
    <button type="button" class="focus-choice focus-choice-mode" data-kind="pet">
      <span class="focus-choice-icon"><img class="focus-choice-pet" data-pet-preview alt="" /></span>
      <span class="focus-choice-text"><b data-choice-pet>大肥鱼</b><small>桌宠 · 点击切换</small></span>
      <span class="focus-choice-arrow" aria-hidden="true">›</span>
    </button>`;

  // ---------- 选择面板 ----------
  const sheet = document.createElement('div');
  sheet.className = 'focus-sheet';
  sheet.hidden = true;
  sheet.innerHTML = `
    <div class="focus-sheet-mask" data-sheet-close></div>
    <section class="focus-sheet-card" role="dialog" aria-modal="true" aria-labelledby="focus-sheet-title">
      <header class="focus-sheet-head">
        <button type="button" class="focus-sheet-back" data-sheet-close aria-label="返回">‹</button>
        <h3 id="focus-sheet-title" data-sheet-title>专注模式</h3>
        <button type="button" class="focus-sheet-x" data-sheet-close aria-label="关闭">×</button>
      </header>
      <div class="focus-sheet-body" data-sheet-body></div>
    </section>`;

  const titleEl = sheet.querySelector('[data-sheet-title]');
  const bodyEl = sheet.querySelector('[data-sheet-body]');
  const modeNameEl = root.querySelector('[data-choice-mode]');
  const modeSubEl = root.querySelector('[data-choice-mode-sub]');
  const sceneNameEl = root.querySelector('[data-choice-scene]');
  const tagNameEl = root.querySelector('[data-choice-tag]');
  const tagDotEl = root.querySelector('[data-choice-dot]');
  const petNameEl = root.querySelector('[data-choice-pet]');
  const petPreviewEl = root.querySelector('[data-pet-preview]');

  let currentKind = null;
  let closeTimer = 0;

  const sceneName = (id) =>
    (FOCUS_SCENE_OPTIONS.find((item) => item.id === id) || FOCUS_SCENE_OPTIONS[0]).name;
  const currentTag = () => FOCUS_TAGS.find((item) => item.id === tagId) || FOCUS_TAGS[0];

  function persist() {
    try {
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({ mode: pomodoro.getState().mode, countdown: countdownMinutes, tag: tagId }),
      );
    } catch {
      /* 隐私模式 / 配额不足时忽略 */
    }
  }

  function sync() {
    const state = pomodoro.getState();
    modeNameEl.textContent = state.modeLabel;
    if (modeSubEl) {
      modeSubEl.textContent =
        state.mode === 'pomodoro'
          ? '25 分钟专注 · 5 分钟休息'
          : state.mode === 'countdown'
            ? `${state.countdown} 分钟 · 倒着数`
            : '从零开始 · 随用随记';
    }
    // 图标跟着模式换
    const iconHost = root.querySelector('.focus-choice-mode .focus-choice-icon');
    if (iconHost) iconHost.innerHTML = ICONS[state.mode] || ICONS.pomodoro;
    sceneNameEl.textContent = sceneName(getScene());
    tagNameEl.textContent = currentTag().name;
    if (tagDotEl) tagDotEl.style.background = currentTag().color;
    const pet = getPet?.() || null;
    if (petNameEl) petNameEl.textContent = pet?.name || '不显示';
    if (petPreviewEl) {
      if (pet?.src) {
        if (petPreviewEl.getAttribute('src') !== pet.src) petPreviewEl.setAttribute('src', pet.src);
        petPreviewEl.style.display = '';
      } else {
        petPreviewEl.removeAttribute('src');
        petPreviewEl.style.display = 'none';
      }
    }
    root.dataset.mode = state.mode;
  }

  // ---------- 各面板内容 ----------
  function renderModeSheet() {
    const state = pomodoro.getState();
    titleEl.textContent = '专注模式';
    bodyEl.innerHTML = `
      <div class="fc-options">
        ${FOCUS_MODE_OPTIONS.map(
          (item) => `
          <button type="button" class="fc-option${item.id === state.mode ? ' is-active' : ''}" data-mode="${item.id}">
            <span class="fc-option-icon">${ICONS[item.id]}</span>
            <span class="fc-option-text"><b>${item.name}</b><small>${item.desc}</small></span>
            <span class="fc-check" aria-hidden="true"></span>
          </button>`,
        ).join('')}
      </div>
      <div class="fc-extra${state.mode === 'countdown' ? '' : ' is-hidden'}" data-countdown-extra>
        <span class="fc-extra-label">专注时长</span>
        <div class="fc-stepper">
          <button type="button" class="fc-step" data-step="-${COUNTDOWN_STEP}" aria-label="减少时长">−</button>
          <b data-countdown-value>${countdownMinutes}</b>
          <span class="fc-unit">分钟</span>
          <button type="button" class="fc-step" data-step="${COUNTDOWN_STEP}" aria-label="增加时长">+</button>
        </div>
      </div>
      <div class="fc-extra${state.mode === 'pomodoro' ? '' : ' is-hidden'}" data-autonext-extra>
        <span class="fc-extra-label">阶段结束自动开始下一段</span>
        <button type="button" class="fc-switch${state.autoNext ? ' is-on' : ''}" data-autonext
          role="switch" aria-checked="${state.autoNext}"><i></i></button>
      </div>`;
  }

  function renderSceneSheet() {
    const current = getScene();
    titleEl.textContent = '专注场景';
    bodyEl.innerHTML = `
      <p class="fc-hint">选中后立刻切换背景与声音，计时不会中断。</p>
      <div class="fc-scenes">
        ${FOCUS_SCENE_OPTIONS.map(
          (item) => `
          <button type="button" class="fc-scene${item.id === current ? ' is-active' : ''}" data-scene="${item.id}">
            <span class="fc-scene-thumb" data-thumb="${item.id}"></span>
            <span class="fc-scene-name">${item.name}</span>
            <span class="fc-check" aria-hidden="true"></span>
          </button>`,
        ).join('')}
      </div>`;
  }

  function renderPetSheet() {
    titleEl.textContent = '桌宠';
    const pet = getPet?.() || {};
    const mascots = getMascots();
    bodyEl.innerHTML = `
      <p class="fc-hint">选一个跟着计时环跑的桌宠，也可以上传自己的图片 / GIF。</p>
      <div class="fc-pets">
        ${mascots.map(
          (item) => `
          <button type="button" class="fc-pet${pet.id === item.id ? ' is-active' : ''}" data-pet-id="${item.id}">
            <span class="fc-pet-thumb"><img alt="" src="${item.src}" /></span>
            <span class="fc-pet-name">${item.name}</span>
            <span class="fc-check" aria-hidden="true"></span>
          </button>`,
        ).join('')}
        <button type="button" class="fc-pet fc-pet-none${pet.id === 'none' ? ' is-active' : ''}" data-pet-id="none">
          <span class="fc-pet-thumb fc-pet-thumb-none">无</span>
          <span class="fc-pet-name">不显示</span>
          <span class="fc-check" aria-hidden="true"></span>
        </button>
      </div>
      <button type="button" class="fc-upload" data-pet-upload>上传自己的图片 / GIF 当桌宠</button>
      <input class="sr-only" type="file" accept="image/*,.gif" data-pet-file aria-label="上传桌宠图片" />`;
  }

  function renderTagSheet() {
    titleEl.textContent = '本次标签';
    bodyEl.innerHTML = `
      <p class="fc-hint">给这一段专注贴个标签，方便回看今天在为什么花时间。</p>
      <div class="fc-tags">
        ${FOCUS_TAGS.map(
          (item) => `
          <button type="button" class="fc-tag${item.id === tagId ? ' is-active' : ''}" data-tag="${item.id}">
            <i class="fc-tag-dot" style="--dot:${item.color}"></i>
            <span>${item.name}</span>
            <span class="fc-check" aria-hidden="true"></span>
          </button>`,
        ).join('')}
      </div>`;
  }

  // ---------- 打开 / 关闭 ----------
  function open(kind) {
    if (!sheet.hidden) return;
    currentKind = kind;
    if (kind === 'mode') renderModeSheet();
    else if (kind === 'scene') renderSceneSheet();
    else if (kind === 'pet') renderPetSheet();
    else renderTagSheet();
    clearTimeout(closeTimer);
    sheet.hidden = false;
    root.classList.add('is-open');
    requestAnimationFrame(() => sheet.classList.add('is-shown'));
    const first = bodyEl.querySelector('button');
    if (first && first.focus) first.focus({ preventScroll: true });
  }

  function close() {
    if (sheet.hidden) return;
    sheet.classList.remove('is-shown');
    root.classList.remove('is-open');
    closeTimer = setTimeout(() => {
      if (!sheet.classList.contains('is-shown')) sheet.hidden = true;
    }, 240);
  }

  function closeSoon(delay = 170) {
    setTimeout(close, delay);
  }

  // ---------- 选择逻辑 ----------
  function chooseMode(id) {
    if (!FOCUS_MODE_OPTIONS.some((item) => item.id === id)) return;
    pomodoro.setMode(id);
    if (id === 'countdown') pomodoro.setCountdown(countdownMinutes);
    persist();
    sync();
    if (id === 'countdown') {
      renderModeSheet(); // 留在面板里调时长
    } else {
      renderModeSheet();
      closeSoon();
    }
  }

  function setCountdown(minutes) {
    countdownMinutes = clamp(minutes, MIN_COUNTDOWN, MAX_COUNTDOWN);
    pomodoro.setCountdown(countdownMinutes);
    persist();
    sync();
    const valueEl = bodyEl.querySelector('[data-countdown-value]');
    if (valueEl) valueEl.textContent = String(countdownMinutes);
  }

  function chooseScene(id) {
    setScene(id);
    sync();
    closeSoon(120);
  }

  function chooseTag(id) {
    if (!FOCUS_TAGS.some((item) => item.id === id)) return;
    tagId = id;
    persist();
    sync();
    if (typeof onTag === 'function') onTag(currentTag());
    closeSoon(120);
  }

  // ---------- 事件 ----------
  function onRootClick(event) {
    const button = event.target.closest?.('.focus-choice');
    if (!button) return;
    open(button.dataset.kind);
  }

  function onSheetClick(event) {
    if (event.target.closest?.('[data-sheet-close]')) {
      close();
      return;
    }
    const modeBtn = event.target.closest?.('[data-mode]');
    if (modeBtn) {
      chooseMode(modeBtn.dataset.mode);
      return;
    }
    const stepBtn = event.target.closest?.('[data-step]');
    if (stepBtn) {
      setCountdown(countdownMinutes + Number(stepBtn.dataset.step));
      return;
    }
    if (event.target.closest?.('[data-autonext]')) {
      const next = !pomodoro.getState().autoNext;
      pomodoro.setAutoNext(next);
      persist();
      const btn = bodyEl.querySelector('[data-autonext]');
      if (btn) {
        btn.classList.toggle('is-on', next);
        btn.setAttribute('aria-checked', String(next));
      }
      return;
    }
    const sceneBtn = event.target.closest?.('[data-scene]');
    if (sceneBtn) {
      chooseScene(sceneBtn.dataset.scene);
      return;
    }
    const tagBtn = event.target.closest?.('[data-tag]');
    if (tagBtn) {
      chooseTag(tagBtn.dataset.tag);
      return;
    }
    const petBtn = event.target.closest?.('[data-pet-id]');
    if (petBtn) {
      choosePet(petBtn.dataset.petId);
      return;
    }
    if (event.target.closest?.('[data-pet-upload]')) {
      const input = bodyEl.querySelector('[data-pet-file]');
      input?.click?.();
    }
  }

  function choosePet(id) {
    if (id === 'none') {
      onPet('', 'none', '不显示');
      sync();
      closeSoon(120);
      return;
    }
    const item = getMascots().find((entry) => entry.id === id);
    if (!item) return;
    onPet(item.src, item.id, item.name, item.states);
    sync();
    closeSoon(120);
  }

  function onSheetChange(event) {
    const input = event.target?.closest?.('[data-pet-file]');
    const file = input?.files?.[0];
    if (!input || !file) return;
    input.value = '';
    onPetUpload(file);
    sync();
    closeSoon(150);
  }

  function onKeyDown(event) {
    if (sheet.hidden) return;
    if (event.key === 'Escape') {
      // 优先关闭面板，不要连带退出专注模式
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }

  function attach(host) {
    if (!host) return api;
    // 入口放在计时卡片里（开始/重置按钮上方），像参考图里的「专注 ›」和两张卡片
    const controls = host.querySelector('.pomodoro-controls');
    if (controls && root.parentNode !== host) host.insertBefore(root, controls);
    else if (!controls && root.parentNode !== host) host.appendChild(root);
    // 面板用 position:fixed，挂到 body 避免被卡片的 backdrop-filter 影响
    if (!sheet.parentNode) document.body.appendChild(sheet);
    sync();
    return api;
  }

  function dispose() {
    root.removeEventListener('click', onRootClick);
    sheet.removeEventListener('click', onSheetClick);
    document.removeEventListener('keydown', onKeyDown, true);
    root.remove();
    sheet.remove();
  }

  root.addEventListener('click', onRootClick);
  sheet.addEventListener('change', onSheetChange);
  sheet.addEventListener('click', onSheetClick);
  document.addEventListener('keydown', onKeyDown, true);

  const api = { attach, sync, open, close, dispose, getTag: currentTag };
  sync();
  return api;
}

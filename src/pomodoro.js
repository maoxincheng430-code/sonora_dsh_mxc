// 番茄钟：纯 JS 计时（Date.now() 差值防漂移，now 可注入便于测试）。
// 三种模式：
//   pomodoro  番茄钟 —— 专注/休息循环（默认，行为与旧版一致）
//   countdown 倒计时 —— 固定时长，到点停止
//   stopwatch 正计时 —— 秒表，从 0 往上走
// 环形进度（SVG stroke-dasharray）+ 剩余时间 mm:ss + 阶段标签 + 开始/暂停/重置按钮。
// 阶段完成时触发 onPhaseComplete({ phase, nextPhase })，由 Lead 接声音提示。
export const PHASES = ['work', 'rest'];

export const PHASE_LABELS = { work: '专注', rest: '休息' };

export const POMODORO_MODES = ['pomodoro', 'countdown', 'stopwatch'];

export const MODE_LABELS = { pomodoro: '番茄钟', countdown: '倒计时', stopwatch: '正计时' };

const RING_RADIUS = 52;
export const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS; // ≈326.7
const MIN_MINUTES = 0.05;
const MAX_MINUTES = 180;
const COUNTDOWN_MAX = 240;
// 正计时模式下圆环转满一圈代表 60 分钟
const STOPWATCH_RING_MS = 60 * 60000;
const TICK_MS = 250;
export const DEFAULT_MASCOT_SRC = 'mascot/dafeiyu-cut.png';

/**
 * 吉祥物在圆环上的位置（纯函数，便于测试）。
 * 进度 0 在正上方，顺时针增长；返回相对表盘的百分比坐标与朝向。
 * @param {number} progress 0..1
 * @param {number} radiusPercent 半径占表盘宽度的百分比（默认 43.3 ≈ 52/120）
 */
export function mascotPosition(progress, radiusPercent = 43.3) {
  const ratio = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  const angle = ratio * 360 - 90; // -90° 在正上方
  const radians = (angle * Math.PI) / 180;
  return {
    // x 方向速度 dx/dp = -sin(angle)：大于 0 说明顺时针往右跑
    x: 50 + radiusPercent * Math.cos(radians),
    y: 50 + radiusPercent * Math.sin(radians),
    facing: -Math.sin(radians) >= 0 ? 'right' : 'left',
    angleDeg: angle,
  };
}


// 纯函数：毫秒 → "mm:ss"
export function formatPomodoroTime(ms) {
  const total = Math.max(0, Math.round((Number.isFinite(ms) ? ms : 0) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// 创建番茄钟控制器。
// options: {
//   work=25, rest=5, autoNext=true,
//   mode='pomodoro', countdown=25,
//   onPhaseComplete, now, setInterval, clearInterval, document
// }
// 返回: { start, pause, reset, setPhase, setMinutes, setMode, setCountdown,
//         setAutoNext, getState, attach, dispose, onPhaseComplete }
export function createPomodoro(options = {}) {
  const {
    work = 25,
    rest = 5,
    longRest = 15,
    autoNext = true,
    mode: initialMode = 'pomodoro',
    countdown = 25,
    onPhaseComplete = null,
    // 吉祥物（沿进度环奔跑的“大肥鱼”）：传空字符串可关闭
    mascotSrc: mascotSrcOption = DEFAULT_MASCOT_SRC,
    now = () => Date.now(),
    setInterval =
      (typeof globalThis !== 'undefined' && globalThis.setInterval && globalThis.setInterval.bind(globalThis)) || null,
    clearInterval =
      (typeof globalThis !== 'undefined' && globalThis.clearInterval && globalThis.clearInterval.bind(globalThis)) ||
      null,
    document: doc = (typeof globalThis !== 'undefined' && globalThis.document) || null,
  } = options;

  // 桌宠图可以用 setMascot() 运行中替换，所以单独用 let 保存
  let mascotSrc = mascotSrcOption;
  // 可选的多状态图：{ idle, running, celebrate, rest }，没配的状态回退到 mascotSrc
  let mascotStates = null;
  let mascotImgEl = null;

  const clampMinutes = (value, fallback = work, max = MAX_MINUTES) => {
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(MIN_MINUTES, value));
  };

  let workMinutes = clampMinutes(work);
  let restMinutes = clampMinutes(rest);
  let longRestMinutes = clampMinutes(longRest, 15);
  let longBreak = false;
  let workCompleted = 0; // 已完成的工作阶段数（每 4 个进入长休息）
  let countdownMinutes = clampMinutes(countdown, workMinutes, COUNTDOWN_MAX);
  let mode = POMODORO_MODES.includes(initialMode) ? initialMode : 'pomodoro';
  let autoNextEnabled = autoNext !== false;
  let phase = 'work';
  let minutes = workMinutes;
  let remainingMs = mode === 'countdown' ? countdownMinutes * 60000 : workMinutes * 60000;
  let elapsedMs = 0; // 正计时累计
  let startedAt = 0;
  let running = false;
  let timerId = null;
  let endAt = 0;
  let disposed = false;
  let phaseCallback = typeof onPhaseComplete === 'function' ? onPhaseComplete : null;

  let rootNode = null;
  let timeEl = null;
  let labelEl = null;
  let ringEl = null;
  let startBtn = null;
  let resetBtn = null;
  let mascotEl = null;
  let celebrateUntil = 0;
  let celebrateTimer = null;

  function currentMinutes() {
    if (phase === 'work') return workMinutes;
    return longBreak ? longRestMinutes : restMinutes;
  }

  function stopTimer() {
    if (timerId != null && clearInterval) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  function phaseTotalMs() {
    if (mode === 'countdown') return countdownMinutes * 60000;
    if (mode === 'stopwatch') return STOPWATCH_RING_MS;
    return currentMinutes() * 60000;
  }

  function readRemaining() {
    if (mode === 'stopwatch') {
      return Math.max(0, running ? now() - startedAt : elapsedMs);
    }
    return running ? Math.max(0, endAt - now()) : remainingMs;
  }

  function readLabel() {
    if (mode === 'stopwatch') return MODE_LABELS.stopwatch;
    if (mode === 'countdown') return MODE_LABELS.countdown;
    if (mode === 'pomodoro' && phase === 'rest' && longBreak) return '长休息';
    return PHASE_LABELS[phase];
  }

  function tick() {
    if (!running || disposed) return;
    if (mode === 'stopwatch') {
      elapsedMs = Math.max(0, now() - startedAt);
      render();
      return;
    }
    const left = endAt - now();
    if (left <= 0) {
      completePhase();
      return;
    }
    remainingMs = left;
    render();
  }

  function completePhase() {
    stopTimer();
    running = false;
    remainingMs = 0;
    const finished = phase;
    const next = phase === 'work' ? 'rest' : 'work';
    if (mode === 'pomodoro' && finished === 'work') workCompleted += 1;
    // 完成一个阶段：大肥鱼原地蹦一下庆祝
    celebrateUntil = now() + 1800;
    if (celebrateTimer != null && typeof clearTimeout === 'function') clearTimeout(celebrateTimer);
    if (typeof setTimeout === 'function') {
      celebrateTimer = setTimeout(() => {
        celebrateTimer = null;
        render();
      }, 1900);
    }
    if (phaseCallback) {
      try {
        phaseCallback({ phase: finished, nextPhase: next });
      } catch (_e) {}
    }
    if (mode === 'countdown') {
      // 倒计时到点就停在 00:00，不进入休息
      render();
      return;
    }
    if (autoNextEnabled) {
      switchTo(next);
      start();
    } else {
      render();
    }
  }

  function switchTo(nextPhase) {
    phase = nextPhase;
    if (nextPhase === 'rest') {
      longBreak = mode === 'pomodoro' && workCompleted > 0 && workCompleted % 4 === 0;
    } else {
      longBreak = false;
    }
    minutes = currentMinutes();
    remainingMs = minutes * 60000;
  }

  function start() {
    if (disposed || running || !setInterval) return api;
    if (mode === 'stopwatch') {
      startedAt = now() - elapsedMs;
      running = true;
      timerId = setInterval(tick, TICK_MS);
      render();
      return api;
    }
    if (remainingMs <= 0) remainingMs = phaseTotalMs();
    endAt = now() + remainingMs;
    running = true;
    timerId = setInterval(tick, TICK_MS);
    render();
    return api;
  }

  function pause() {
    if (disposed || !running) return api;
    if (mode === 'stopwatch') elapsedMs = Math.max(0, now() - startedAt);
    else remainingMs = Math.max(0, endAt - now());
    stopTimer();
    running = false;
    render();
    return api;
  }

  function reset() {
    if (disposed) return api;
    stopTimer();
    running = false;
    workCompleted = 0;
    longBreak = false;
    if (mode === 'stopwatch') {
      elapsedMs = 0;
      render();
      return api;
    }
    minutes = mode === 'countdown' ? countdownMinutes : currentMinutes();
    remainingMs = minutes * 60000;
    render();
    return api;
  }

  function setPhase(nextPhase) {
    if (disposed) return api;
    if (nextPhase !== 'work' && nextPhase !== 'rest') {
      throw new TypeError('番茄钟阶段只能是 work 或 rest');
    }
    // 倒计时 / 正计时没有休息阶段，忽略切阶段
    if (mode !== 'pomodoro') return api;
    if (running) pause();
    phase = nextPhase;
    longBreak = false;
    minutes = currentMinutes();
    remainingMs = minutes * 60000;
    render();
    return api;
  }

  function setMinutes(value) {
    if (disposed) return api;
    const v = clampMinutes(value, workMinutes, MAX_MINUTES);
    if (mode === 'countdown') {
      countdownMinutes = clampMinutes(v, 25, COUNTDOWN_MAX);
      if (running) pause();
      remainingMs = countdownMinutes * 60000;
      minutes = countdownMinutes;
      render();
      return api;
    }
    if (phase === 'work') workMinutes = v;
    else restMinutes = v;
    minutes = v;
    if (running) pause(); // 改时长视为重新配置，倒计时同步复位
    remainingMs = v * 60000;
    render();
    return api;
  }

  // 倒计时模式的时长（分钟）
  function setCountdown(value) {
    if (disposed) return api;
    countdownMinutes = clampMinutes(value, 25, COUNTDOWN_MAX);
    if (mode === 'countdown') {
      if (running) pause();
      remainingMs = countdownMinutes * 60000;
      minutes = countdownMinutes;
      render();
    }
    return api;
  }

  function setMode(nextMode) {
    if (disposed) return api;
    if (!POMODORO_MODES.includes(nextMode)) {
      throw new TypeError('未知的计时模式');
    }
    if (running) pause();
    mode = nextMode;
    phase = 'work';
    longBreak = false;
    workCompleted = 0;
    elapsedMs = 0;
    if (mode === 'countdown') {
      minutes = countdownMinutes;
      remainingMs = countdownMinutes * 60000;
    } else {
      minutes = workMinutes;
      remainingMs = workMinutes * 60000;
    }
    render();
    return api;
  }

  function setAutoNext(value) {
    if (disposed) return api;
    autoNextEnabled = Boolean(value);
    render();
    return api;
  }

  function getState() {
    const rem = readRemaining();
    return {
      mode,
      modeLabel: MODE_LABELS[mode],
      autoNext: autoNextEnabled,
      phase,
      minutes,
      remainingMs: rem,
      running,
      label: readLabel(),
      remainingText: formatPomodoroTime(rem),
      totalMs: phaseTotalMs(),
      countdown: countdownMinutes,
      longBreak,
      workCompleted,
      longRestMinutes,
    };
  }

  // ---------- DOM ----------
  function createMascotNode() {
    const node = doc.createElement('div');
    node.className = 'pomodoro-mascot';
    if (node.setAttribute) node.setAttribute('aria-hidden', 'true');
    const img = doc.createElement('img');
    img.className = 'pomodoro-mascot-img';
    if (img.setAttribute) {
      img.setAttribute('src', mascotSrc);
      img.setAttribute('alt', '');
      img.setAttribute('draggable', 'false');
    }
    node.appendChild(img);
    return node;
  }

  // 挂载 / 更新 / 移除吉祥物（传空字符串即隐藏）
  function mountMascot() {
    if (!rootNode || !doc) return;
    const dial = typeof rootNode.querySelector === 'function' ? rootNode.querySelector('.pomodoro-dial') : null;
    if (!dial) return;
    if (!mascotSrc) {
      if (mascotEl && mascotEl.parentNode) {
        try {
          mascotEl.parentNode.removeChild(mascotEl);
        } catch (_e) {}
      }
      mascotEl = null;
      return;
    }
    if (!mascotEl) {
      mascotEl = createMascotNode();
      mascotImgEl = typeof mascotEl.querySelector === 'function' ? mascotEl.querySelector('img') : null;
      dial.appendChild(mascotEl);
    } else {
      const img = typeof mascotEl.querySelector === 'function' ? mascotEl.querySelector('img') : null;
      mascotImgEl = img || mascotImgEl;
      if (img) img.setAttribute('src', mascotSrc);
    }
    render();
  }

  // 切换桌宠（内置 SVG / PNG 或上传图片的 dataURL），空字符串 = 不显示。
  // states 可选：{ running, celebrate, rest } 给不同计时状态换图。
  function setMascot(src, states) {
    if (disposed) return api;
    mascotSrc = typeof src === 'string' ? src : '';
    mascotStates = states && typeof states === 'object' ? states : null;
    mountMascot();
    return api;
  }

  // 吉祥物跟着进度环跑：位置用百分比定位，img 的翻转方向随 x 轴速度切换。
  function updateMascot(progress, state) {
    if (!mascotEl || !mascotEl.style) return;
    const pos = mascotPosition(progress);
    mascotEl.style.setProperty('--mascot-x', `${pos.x.toFixed(2)}%`);
    mascotEl.style.setProperty('--mascot-y', `${pos.y.toFixed(2)}%`);
    mascotEl.style.setProperty('--mascot-face', pos.facing === 'left' ? '-1' : '1');
    if (mascotEl.classList) {
      const resting = state.mode === 'pomodoro' && state.phase === 'rest';
      const celebrating = now() < celebrateUntil;
      const runningNow = Boolean(state.running) && !resting;
      mascotEl.classList.toggle('is-running', runningNow);
      mascotEl.classList.toggle('is-resting', resting);
      mascotEl.classList.toggle('is-celebrate', celebrating);
      // 多状态桌宠：按当前状态切换图片（没配的状态回退到基础图）
      if (mascotStates && mascotImgEl) {
        const want =
          (celebrating && mascotStates.celebrate) ||
          (runningNow && mascotStates.running) ||
          (resting && mascotStates.rest) ||
          mascotStates.idle ||
          mascotSrc;
        if (want && mascotImgEl.getAttribute('src') !== want) mascotImgEl.setAttribute('src', want);
      }
    }
  }

  function render() {
    if (!rootNode) return;
    const state = getState();
    const total = state.totalMs;
    const used = state.mode === 'stopwatch' ? state.remainingMs : total - state.remainingMs;
    const progress = total > 0 ? Math.max(0, Math.min(1, used / total)) : 0;
    if (ringEl && ringEl.style) {
      ringEl.style.strokeDasharray = `${(progress * RING_CIRCUMFERENCE).toFixed(2)} ${RING_CIRCUMFERENCE.toFixed(2)}`;
    }
    updateMascot(progress, state);
    if (timeEl) timeEl.textContent = state.remainingText;
    if (labelEl) labelEl.textContent = state.label;
    if (startBtn) startBtn.textContent = state.running ? '暂停' : '开始';
    if (rootNode.classList) {
      rootNode.classList.toggle('pomodoro-phase-work', state.phase === 'work');
      rootNode.classList.toggle('pomodoro-phase-rest', state.phase === 'rest');
      rootNode.classList.toggle('pomodoro-mode-countdown', state.mode === 'countdown');
      rootNode.classList.toggle('pomodoro-mode-stopwatch', state.mode === 'stopwatch');
    }
    if (rootNode.dataset) rootNode.dataset.mode = state.mode;
  }

  function buildDom(target) {
    if (!doc || typeof doc.createElement !== 'function') return;
    rootNode = doc.createElement('div');
    rootNode.className = 'pomodoro';

    const dial = doc.createElement('div');
    dial.className = 'pomodoro-dial';
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 120 120');
    svg.setAttribute('class', 'pomodoro-ring');
    const track = doc.createElementNS('http://www.w3.org/2000/svg', 'circle');
    track.setAttribute('class', 'pomodoro-track');
    track.setAttribute('cx', '60');
    track.setAttribute('cy', '60');
    track.setAttribute('r', String(RING_RADIUS));
    ringEl = doc.createElementNS('http://www.w3.org/2000/svg', 'circle');
    ringEl.setAttribute('class', 'pomodoro-progress');
    ringEl.setAttribute('cx', '60');
    ringEl.setAttribute('cy', '60');
    ringEl.setAttribute('r', String(RING_RADIUS));
    ringEl.setAttribute('transform', 'rotate(-90 60 60)');
    svg.appendChild(track);
    svg.appendChild(ringEl);
    dial.appendChild(svg);

    timeEl = doc.createElement('div');
    timeEl.className = 'pomodoro-time';
    labelEl = doc.createElement('div');
    labelEl.className = 'pomodoro-label';
    dial.appendChild(timeEl);
    dial.appendChild(labelEl);

    rootNode.appendChild(dial);
    mountMascot();

    const controls = doc.createElement('div');
    controls.className = 'pomodoro-controls';
    startBtn = doc.createElement('button');
    startBtn.className = 'pomodoro-start';
    startBtn.setAttribute('type', 'button');
    resetBtn = doc.createElement('button');
    resetBtn.className = 'pomodoro-reset';
    resetBtn.setAttribute('type', 'button');
    resetBtn.textContent = '重置';
    controls.appendChild(startBtn);
    controls.appendChild(resetBtn);
    rootNode.appendChild(controls);

    if (startBtn.addEventListener) {
      startBtn.addEventListener('click', () => (running ? pause() : start()));
    }
    if (resetBtn.addEventListener) {
      resetBtn.addEventListener('click', () => reset());
    }
    target.appendChild(rootNode);
    render();
  }

  function attach(hostEl) {
    if (disposed || !doc) return api;
    const target = hostEl || doc.body || doc.documentElement;
    if (!target) return api;
    if (rootNode) {
      target.appendChild(rootNode); // 已存在则重新挂载
      render();
      return api;
    }
    buildDom(target);
    return api;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    stopTimer();
    running = false;
    if (celebrateTimer != null && typeof clearTimeout === 'function') {
      clearTimeout(celebrateTimer);
      celebrateTimer = null;
    }
    if (rootNode && rootNode.parentNode && rootNode.parentNode.removeChild) {
      try {
        rootNode.parentNode.removeChild(rootNode);
      } catch (_e) {}
    }
    rootNode = null;
    timeEl = null;
    labelEl = null;
    ringEl = null;
    startBtn = null;
    resetBtn = null;
    mascotEl = null;
  }

  const api = {
    start,
    pause,
    reset,
    setPhase,
    setMinutes,
    setMode,
    setCountdown,
    setMascot,
    setAutoNext,
    getState,
    attach,
    dispose,
    get onPhaseComplete() {
      return phaseCallback;
    },
    set onPhaseComplete(fn) {
      phaseCallback = typeof fn === 'function' ? fn : null;
    },
  };
  return api;
}

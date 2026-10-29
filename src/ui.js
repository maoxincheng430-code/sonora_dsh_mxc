import { CURSOR_TRAIL_STYLES } from './cursor-trail.js';
const icons = {
  mark: '<path d="M4 14v-4m5 10V4m6 19V1m5 18V5m5 10v-6"/>',
  fullscreen: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  settings: '<path d="M4 7h16M4 17h16M8 4v6m8 4v6"/>',
  sphere:
    '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 7h14M5 17h14"/>',
  nebula:
    '<path d="M3 15c4-10 12-13 16-8s-1 13-7 13-7-8-2-12 13-2 11 5-11 7-16 3"/><circle cx="12" cy="12" r="2"/>',
  rings:
    '<ellipse cx="12" cy="12" rx="11" ry="4" transform="rotate(-27 12 12)"/><circle cx="12" cy="12" r="6"/>',
  image:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="M4 17l4.5-4.5L12 16l3.5-3L20 17"/>',
  wave: '<path d="M2 12c3-12 5 12 8 0s5 12 8 0 3 0 4 0M2 18h20"/>',
  echo: '<path d="M3 17 12 6l9 11-9 7Z"/><path d="M7 13h10M7 19h10M12 6v17"/>',
  lock: '<rect x="6" y="10" width="12" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  music:
    '<path d="M9 18V5l11-2v13M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  play: '<path d="m8 4 12 8-12 8Z"/>',
  pause: '<path d="M6 4h4v16H6zm8 0h4v16h-4z"/>',
  heart: '<path d="M12 20c-1.2-.9-7-5-7-9.4C5 7.5 7 5.5 9.6 5.5c1.6 0 2.9.8 3.9 2.1 1-1.3 2.3-2.1 3.9-2.1C20 5.5 22 7.5 22 10.6 22 15 16.2 19.1 12 20Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  repeat: '<path d="M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3"/>',
  shuffle: '<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
  prev: '<path d="M19 20 9 12l10-8ZM5 4v16"/>',
  next: '<path d="M5 4l10 8-10 8ZM19 4v16"/>',
  queue: '<path d="M4 6h16M4 12h16M4 18h9"/><path d="m17 15 4 3-4 3"/>',
  eq: '<path d="M4 18V9m5 9V5m5 13v-7m5 7V7"/>',
  volume:
    '<path d="m11 4-6 5H2v6h3l6 5ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  volumeOff:
    '<path d="m11 4-6 5H2v6h3l6 5ZM16 9l6 6m0-6-6 6"/>',
};
const svg = (name, cls = "") =>
  `<svg class="${cls}" viewBox="0 0 ${name === "mark" ? "29 24" : "24 24"}" aria-hidden="true">${icons[name]}</svg>`;
const time = (value) => {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};
const hashHue = (value) => {
  let hash = 0;
  for (const char of String(value || "")) hash = (hash * 31 + char.codePointAt(0)) % 360;
  return 220 + (hash % 120);
};

export function createUI(callbacks = {}) {
  const root = document.querySelector("#app");
  root.innerHTML = `
    <header class="topbar"><div class="brand">${svg("mark", "brand-mark")}<span class="brand-name">SONORA</span><span class="brand-cn">声境</span></div><div class="top-actions"><span class="status"><i class="status-dot"></i><span data-status>等待音乐入场</span></span><button class="icon-button mute-button" data-mute type="button" aria-label="静音" aria-pressed="false" title="静音 / 取消静音"><span class="mute-icon-on">${svg("volume")}</span><span class="mute-icon-off">${svg("volumeOff")}</span></button><button class="icon-button" data-effects-toggle type="button" aria-label="展开视觉设置" aria-controls="effects-panel" aria-expanded="false" title="视觉设置">${svg("settings")}</button><button class="icon-button" data-fullscreen aria-label="切换全屏" title="切换全屏">${svg("fullscreen")}</button></div></header>
    <main class="experience">
    <aside class="effects" id="effects-panel" aria-label="视觉效果设置"><div class="panel-heading"><h2>雕刻你的声境</h2><button class="panel-close" data-effects-close type="button" aria-label="收起视觉设置" title="收起视觉设置">×</button></div><section class="control-section effect-section"><h3 class="panel-label">效果</h3><div class="effect-row effect-row-toggle"><span class="effect-name">粒子特效</span><button class="effect-switch active" data-particles type="button" role="switch" aria-checked="true" aria-label="粒子特效开关" title="开启 / 关闭粒子特效"><i></i></button></div><div class="effect-row effect-row-toggle"><span class="effect-name">鼠标光影</span><span class="effect-trail-actions"><button class="effect-color-button" data-trail-color type="button" aria-label="鼠标光影颜色" title="自定义鼠标光影颜色" aria-expanded="false"><i></i></button><button class="effect-switch active" data-cursor-trail type="button" role="switch" aria-checked="true" aria-label="鼠标光影跟随开关" title="开启 / 关闭鼠标光影"><i></i></button></span></div><div class="effect-trail-color-popover" data-trail-color-popover hidden><div class="theme-picker-head"><span class="theme-picker-title">鼠标光影颜色</span><button class="theme-picker-close" data-trail-color-close type="button" aria-label="关闭调色盘">×</button></div><div class="theme-picker-preview"><span class="theme-picker-dot" data-trail-color-dot></span><span class="theme-picker-hex" data-trail-color-hex>跟随氛围</span></div><div class="theme-picker-mount" data-trail-color-mount></div></div><div class="effect-row effect-row-scene-offset"><span class="effect-name">粒子画面位置</span><div class="scene-offset-control"><div class="scene-offset-pad" role="group" aria-label="粒子画面位置微调"><button type="button" class="scene-offset-button" data-scene-offset-btn="up" aria-label="粒子画面上移" title="上移">↑</button><button type="button" class="scene-offset-button" data-scene-offset-btn="left" aria-label="粒子画面左移" title="左移">←</button><button type="button" class="scene-offset-button is-center" data-scene-offset-btn="center" aria-label="粒子画面复位" title="复位">◎</button><button type="button" class="scene-offset-button" data-scene-offset-btn="right" aria-label="粒子画面右移" title="右移">→</button><button type="button" class="scene-offset-button" data-scene-offset-btn="down" aria-label="粒子画面下移" title="下移">↓</button></div><span class="scene-offset-value" data-scene-offset-value>0.0 / 0.0</span></div></div><div class="effect-row effect-row-trail-style"><span class="effect-name">光影样式</span><select class="effect-select" data-trail-style aria-label="鼠标光影样式">${CURSOR_TRAIL_STYLES.map((style) => `<option value="${style.id}"${callbacks.cursorTrailStyle === style.id ? " selected" : ""}>${style.label}</option>`).join("")}</select></div><div class="effect-row"><span class="effect-name">背景画面</span><span class="effect-bg-name" data-bg-name>无</span></div><div class="effect-scenes">${[
      ["none", "默认"],
      ["rain", "雨"],
      ["thunder", "雷"],
      ["beach", "海滩"],
      ["library", "图书馆"],
    ]
      .map(
        ([id, label]) =>
          `<button type="button" data-ambience="${id}" class="${id === "none" ? "active" : ""}" aria-pressed="${id === "none"}">${label}</button>`,
      )
      .join("")}</div><div class="effect-media"><button type="button" class="effect-upload" data-bg-upload>上传图片 / 视频</button><button type="button" class="effect-clear" data-bg-clear title="清除自定义背景">清除</button></div><input class="sr-only" data-bg-file type="file" accept="image/*,video/*" aria-label="选择背景图片或视频" tabindex="-1"></section><section class="shape-section"><h3 class="panel-label">粒子形态</h3><div class="type-grid">${[
      ["wave", "声浪"],
      ["echo", "音域回响"],
      ["sphere", "星球"],
      ["nebula", "星云"],
      ["rings", "星环"],
      ["image", "图片"],
    ]
      .map(
        ([id, label]) =>
          `<button class="type-button ${id === "wave" ? "active" : ""}" data-type="${id}" aria-pressed="${id === "wave"}">${svg(id)}<span>${label}</span></button>`,
      )
      .join("")}</div><div class="shape-image-bar" data-shape-image-bar hidden><button type="button" class="effect-upload" data-shape-upload>上传图片 / 视频</button><button type="button" class="effect-clear" data-shape-clear>清除</button></div><input class="sr-only" data-shape-file type="file" accept="image/*,video/*" aria-label="选择要生成粒子的图片或视频" tabindex="-1"><div class="shape-image-tune" data-shape-tune hidden><label class="band-row"><span>粒子密度</span><input class="range" data-shape-density type="range" min="0.2" max="1.5" step="0.05" value="1" aria-label="粒子密度"><output data-shape-density-value>1.0</output></label><label class="band-row"><span>轮廓强度</span><input class="range" data-shape-edge type="range" min="0" max="2" step="0.1" value="1" aria-label="轮廓强度"><output data-shape-edge-value>1.0</output></label><label class="band-row"><span>颜色饱和</span><input class="range" data-shape-saturation type="range" min="0.4" max="2" step="0.1" value="1.2" aria-label="颜色饱和"><output data-shape-saturation-value>1.2</output></label><label class="band-row"><span>扣背景容差</span><input class="range" data-shape-tolerance type="range" min="0.05" max="0.5" step="0.01" value="0.2" aria-label="扣背景容差"><output data-shape-tolerance-value>0.20</output></label><label class="shape-toggle-row"><span>自动扣背景</span><button type="button" class="effect-switch active" data-shape-bg role="switch" aria-checked="true"><i></i></button></label><label class="shape-toggle-row"><span>只取轮廓</span><button type="button" class="effect-switch" data-shape-outline role="switch" aria-checked="false"><i></i></button></label><label class="shape-toggle-row"><span>白底也抠</span><button type="button" class="effect-switch" data-shape-lightbg role="switch" aria-checked="false"><i></i></button></label><p class="shape-hint">浅色背景默认不抠（白底主体容易被一起扣掉）；白底 logo 想抠就打开「白底也抠」。上传视频会循环播放并实时转成粒子（刷新后需重新上传）。</p></div></section>
    <section class="control-section"><h3 class="panel-label">氛围色彩</h3><div class="themes">${[
      ["cosmic", "星际漫游"],
      ["fire", "日落余温"],
      ["mono", "月光银白"],
    ]
      .map(
        ([id, label]) =>
          `<button class="theme-button ${id === "cosmic" ? "active" : ""}" data-theme="${id}" aria-label="${label}" title="${label}" aria-pressed="${id === "cosmic"}"><span></span></button>`,
      )
      .join("")}<button class="theme-button theme-picker-button" data-theme-picker type="button" aria-label="自定义氛围色彩" title="自定义氛围色彩" aria-pressed="false" aria-expanded="false"><span></span></button><span class="theme-name">星际</span></div><div class="theme-picker-popover" data-theme-popover hidden><div class="theme-picker-head"><span class="theme-picker-title">自定义氛围色彩</span><button class="theme-picker-close" data-theme-picker-close type="button" aria-label="关闭调色盘">×</button></div><div class="theme-picker-preview"><span class="theme-picker-dot" data-theme-picker-dot></span><span class="theme-picker-hex" data-theme-picker-hex>未选择</span></div><div class="theme-picker-mount" data-theme-picker-mount></div></div></section>
    <section class="control-section"><label class="panel-label" for="sensitivity">律动强度<output data-sensitivity-value>1.0 ×</output></label><input id="sensitivity" class="range" data-sensitivity type="range" min="0.3" max="2" value="1" step="0.1" aria-label="律动强度"><div class="range-ends"><span>轻柔</span><span>澎湃</span></div></section>
    <section class="control-section bands-section"><h3 class="panel-label">频段敏感度</h3>${[
      ["bass", "低频"],
      ["mid", "人声"],
      ["treble", "高频"],
    ]
      .map(
        ([id, label]) =>
          `<label class="band-row"><span>${label}</span><input class="range" data-band="${id}" type="range" min="0.3" max="2.5" value="1" step="0.1" aria-label="${label}敏感度"><output data-band-value="${id}">1.0</output></label>`,
      )
      .join("")}</section>
    <section class="control-section quality-section"><h3 class="panel-label">渲染精度</h3><div class="quality" aria-label="渲染精度">${[
      ["low", "流畅"],
      ["medium", "均衡"],
      ["high", "细腻"],
    ]
      .map(
        ([id, label]) =>
          `<button data-quality="${id}" class="${id === "medium" ? "active" : ""}" aria-pressed="${id === "medium"}">${label}</button>`,
      )
      .join(
        "",
      )}</div></section><div class="panel-foot"><span>REAL-TIME AUDIO REACTIVE</span><span class="signal" aria-hidden="true">${[4, 8, 5, 10, 6].map((h) => `<i style="--h:${h}px"></i>`).join("")}</span></div></aside></main>
    
    <div class="bottom"><button class="player-collapse-handle" data-player-collapse type="button" aria-expanded="true" aria-controls="player-panel" title="收起播放器"><i></i></button><section class="player" id="player-panel" aria-label="音乐播放器">
      <div class="player-progress"><input class="range player-seek" data-seek type="range" min="0" max="1" value="0" step="0.1" aria-label="播放进度" disabled><span class="player-progress-dot" data-progress-dot aria-hidden="true"></span></div>
      <div class="player-main">
        <div class="track"><div class="cover" data-cover>${svg("music")}<span class="cover-letter" data-cover-letter aria-hidden="true"></span></div>
          <div class="track-text"><h2 class="track-name" data-track>还没有音乐</h2><p class="track-sub" data-track-sub>选择本地音频开始</p>
            <div class="track-meta"><span class="track-badge" data-badge-format>LOCAL</span><span class="track-badge is-lossless" data-badge-lossless hidden>无损</span><button class="upload-link" data-upload>${svg("upload")}<span data-upload-text>导入</span></button></div>
          </div>
        </div>
        <div class="transport">
          <button class="player-tool" data-like type="button" aria-label="收藏" aria-pressed="false" title="收藏">${svg("heart")}</button>
          <button class="player-tool" data-import type="button" aria-label="添加音乐" title="添加音乐">${svg("plus")}</button>
          <button class="player-tool" data-shuffle type="button" aria-label="随机播放" aria-pressed="false" title="随机播放">${svg("shuffle")}</button>
          <button class="player-tool" data-repeat type="button" aria-label="循环模式" aria-pressed="true" title="循环：列表循环">${svg("repeat")}<span class="tool-indicator" data-repeat-indicator aria-hidden="true"></span></button>
          <button class="player-tool" data-prev type="button" aria-label="上一首" title="上一首">${svg("prev")}</button>
          <button class="play-button" data-play aria-label="播放" title="播放" disabled>${svg("play")}</button>
          <button class="player-tool" data-next type="button" aria-label="下一首" title="下一首">${svg("next")}</button>
          <button class="player-tool" data-queue type="button" aria-label="音乐库" title="打开我的曲库">${svg("queue")}</button>
          <button class="player-text-button" data-player-lyrics type="button" aria-label="打开歌词" title="打开歌词">词</button>
          <div class="volume"><span class="volume-icon" aria-hidden="true">${svg("volume")}</span><input class="range" data-volume type="range" min="0" max="1" value="0.7" step="0.01" aria-label="音量"></div>
          <button class="player-tool" data-player-eq type="button" aria-label="音频视觉设置" title="音频视觉设置">${svg("eq")}</button>
          <button class="player-tool" data-player-fullscreen type="button" aria-label="全屏" title="全屏">${svg("fullscreen")}</button>
        </div>
        <div class="player-time"><span data-current>0:00</span><span class="time-divider">/</span><span data-duration>0:00</span></div>
      </div>
    </section><footer class="footer"><span>声音无界，想象有形。</span><span>MP3 / WAV / OGG / FLAC / M4A / MP4 · 支持拖放上传</span></footer></div>
    <input class="sr-only" data-file type="file" accept="audio/*,video/mp4,video/quicktime,video/webm,.mp3,.wav,.ogg,.flac,.m4a,.m4b,.aac,.mp4,.m4v,.mov,.webm" aria-label="选择音频或视频文件（取音轨）" tabindex="-1"><div class="toast" role="alert" hidden></div><div class="drop-overlay" hidden>${svg("upload")}<span>把音乐交给这片宇宙</span><small>松开鼠标，即刻载入本地音频</small></div>`;
  const $ = (selector) => root.querySelector(selector);
  const file = $("[data-file]"),
    seek = $("[data-seek]"),
    play = $("[data-play]");
  const listeners = [];
  let dragging = false,
    dragDepth = 0,
    errorTimer,
    previousPlaying = false;
  let shapeHasImage = Boolean(callbacks.shapeHasImage);
  let shapeType = "wave";
  let shapeOptions = { density: 1, edge: 1, saturation: 1.18, background: "auto" };
  const shapeBar = $("[data-shape-image-bar]");
  const shapeTune = $("[data-shape-tune]");
  const shapeFile = $("[data-shape-file]");
  const shapeUpload = $("[data-shape-upload]");
  const shapeClear = $("[data-shape-clear]");
  const on = (target, event, handler) => {
    target.addEventListener(event, handler);
    listeners.push(() => target.removeEventListener(event, handler));
  };
  const call = (key, ...args) => callbacks[key]?.(...args);
  const fill = (element) =>
    element.style.setProperty(
      "--fill",
      `${((Number(element.value) - Number(element.min)) / (Number(element.max) - Number(element.min))) * 100}%`,
    );
  root.querySelectorAll(".range").forEach(fill);
  on($("[data-upload]"), "click", () => file.click());
  on(file, "change", () => {
    if (file.files?.[0]) call("onFile", file.files[0]);
    file.value = "";
  });
  on(play, "click", () => call("onTogglePlay"));
  on($("[data-fullscreen]"), "click", () => call("onFullscreen"));
  on(seek, "pointerdown", () => {
    dragging = true;
  });
  on(window, "pointerup", () => {
    dragging = false;
  });
  on(seek, "input", () => {
    fill(seek);
    $("[data-current]").textContent = time(seek.value);
  });
  on(seek, "change", () => {
    call("onSeek", Number(seek.value));
    dragging = false;
  });
  on($("[data-volume]"), "input", (event) => {
    fill(event.target);
    call("onVolume", Number(event.target.value));
  });
  const onPlayerButton = (selector, key) => {
    const button = $(selector);
    if (button) on(button, "click", () => call(key));
  };
  onPlayerButton("[data-like]", "onLike");
  onPlayerButton("[data-import]", "onImport");
  onPlayerButton("[data-shuffle]", "onShuffle");
  onPlayerButton("[data-repeat]", "onRepeat");
  onPlayerButton("[data-prev]", "onPrev");
  onPlayerButton("[data-next]", "onNext");
  onPlayerButton("[data-queue]", "onQueue");
  onPlayerButton("[data-player-lyrics]", "onLyrics");
  onPlayerButton("[data-player-eq]", "onEffectsPanel");
  onPlayerButton("[data-player-fullscreen]", "onFullscreen");
  on($("[data-sensitivity]"), "input", (event) => {
    fill(event.target);
    $("[data-sensitivity-value]").textContent =
      `${Number(event.target.value).toFixed(1)} ×`;
    call("onSensitivity", Number(event.target.value));
  });
  const bands = {};
  root.querySelectorAll("[data-band]").forEach((input) => {
    const id = input.dataset.band;
    bands[id] = Number(input.value);
    on(input, "input", (event) => {
      fill(event.target);
      bands[id] = Number(event.target.value);
      $(
        `[data-band-value="${id}"]`,
      ).textContent = `${Number(event.target.value).toFixed(1)}`;
      call("onBandGains", { ...bands });
    });
  });
  // ---- 设置侧边栏：默认收起，点顶部齿轮展开/收起，状态记在 localStorage ----
  const effectsPanel = $(".effects");
  const effectsToggle = $("[data-effects-toggle]");
  const effectsClose = $("[data-effects-close]");
  const EFFECTS_KEY = "sonora-effects-open";
  const readFlag = (key, fallback) => {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  };
  const writeFlag = (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // 隐私模式忽略
    }
  };
  function applyEffectsOpen(open, { persist = true } = {}) {
    const isOpen = Boolean(open);
    document.body.classList.toggle("effects-open", isOpen);
    if (effectsToggle) {
      effectsToggle.setAttribute("aria-expanded", String(isOpen));
      effectsToggle.setAttribute("aria-label", isOpen ? "收起视觉设置" : "展开视觉设置");
      effectsToggle.title = isOpen ? "收起视觉设置" : "视觉设置";
      effectsToggle.classList.toggle("active", isOpen);
    }
    if (effectsPanel) effectsPanel.setAttribute("aria-hidden", String(!isOpen));
    if (persist) writeFlag(EFFECTS_KEY, isOpen ? "1" : "0");
  }
  applyEffectsOpen(readFlag(EFFECTS_KEY, "0") === "1", { persist: false });
  if (effectsToggle) {
    on(effectsToggle, "click", () => applyEffectsOpen(!document.body.classList.contains("effects-open")));
  }
  if (effectsClose) on(effectsClose, "click", () => applyEffectsOpen(false));
  on(window, "keydown", (event) => {
    if (event.key === "Escape" && document.body.classList.contains("effects-open")) applyEffectsOpen(false);
  });

  // ---- 播放器下拉收起 ----
  const PLAYER_KEY = "sonora-player-collapsed";
  const bottomBar = $(".bottom");
  const playerCollapse = $("[data-player-collapse]");

  function applyPlayerCollapsed(collapsed, { persist = true } = {}) {
    const isCollapsed = Boolean(collapsed);
    bottomBar?.classList.toggle("is-collapsed", isCollapsed);
    if (playerCollapse) {
      playerCollapse.setAttribute("aria-expanded", String(!isCollapsed));
      playerCollapse.setAttribute("aria-label", isCollapsed ? "展开播放器" : "收起播放器");
      playerCollapse.title = isCollapsed ? "展开播放器" : "收起播放器";
    }
    if (persist) writeFlag(PLAYER_KEY, isCollapsed ? "1" : "0");
  }

  // 记住上次的收起状态，刷新后保持。
  applyPlayerCollapsed(readFlag(PLAYER_KEY, "0") === "1", { persist: false });
  if (playerCollapse) {
    on(playerCollapse, "click", () =>
      applyPlayerCollapsed(!bottomBar?.classList.contains("is-collapsed")),
    );
  }


  const particlesToggle = $("[data-particles]");
  const cursorTrailToggle = $("[data-cursor-trail]");
  const cursorTrailStyleSelect = $("[data-trail-style]");
  const sceneOffsetButtons = root.querySelectorAll("[data-scene-offset-btn]");
  const sceneOffsetValue = $("[data-scene-offset-value]");
  const cursorTrailStyleRow = $(".effect-row-trail-style");
  const bgFile = $("[data-bg-file]");
  const bgUpload = $("[data-bg-upload]");
  const bgClear = $("[data-bg-clear]");
  const bgName = $("[data-bg-name]");
  const AMBIENCE_SCENES = ["none", "rain", "thunder", "beach", "library", "image"];
  let particlesOn = callbacks.particles !== false;
  let cursorTrailOn = callbacks.cursorTrail !== false;
  let cursorTrailStyle = CURSOR_TRAIL_STYLES.some((style) => style.id === callbacks.cursorTrailStyle) ? callbacks.cursorTrailStyle : 'comet';
  let ambienceScene = AMBIENCE_SCENES.includes(callbacks.ambience) ? callbacks.ambience : "none";

  function syncParticles() {
    particlesToggle.classList.toggle("active", particlesOn);
    particlesToggle.setAttribute("aria-checked", String(particlesOn));
  }

  // 鼠标光影跟随开关：与粒子开关共用同一套 switch 样式与 aria 状态。
  function syncCursorTrail() {
    if (!cursorTrailToggle) return;
    cursorTrailToggle.classList.toggle("active", cursorTrailOn);
    cursorTrailToggle.setAttribute("aria-checked", String(cursorTrailOn));
    if (cursorTrailStyleSelect) cursorTrailStyleSelect.value = cursorTrailStyle;
    if (cursorTrailStyleRow) cursorTrailStyleRow.hidden = !cursorTrailOn;
  }

  function syncAmbience() {
    sceneOffsetButtons.forEach((button) => {
    on(button, "click", () => call("onSceneOffset", button.dataset.sceneOffsetBtn));
  });

  root.querySelectorAll("[data-ambience]").forEach((button) => {
      const active = button.dataset.ambience === ambienceScene;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    bgUpload.classList.toggle("active", ambienceScene === "image");
    bgUpload.setAttribute("aria-pressed", String(ambienceScene === "image"));
  }

  if (particlesToggle) {
    on(particlesToggle, "click", () => {
      particlesOn = !particlesOn;
      syncParticles();
      call("onParticles", particlesOn);
    });
    syncParticles();
  }

  if (cursorTrailToggle) {
    on(cursorTrailToggle, "click", () => {
      cursorTrailOn = !cursorTrailOn;
      syncCursorTrail();
      call("onCursorTrail", cursorTrailOn);
    });
    syncCursorTrail();
  }

  if (cursorTrailStyleSelect) {
    on(cursorTrailStyleSelect, "change", () => {
      cursorTrailStyle = CURSOR_TRAIL_STYLES.some((style) => style.id === cursorTrailStyleSelect.value)
        ? cursorTrailStyleSelect.value
        : "comet";
      syncCursorTrail();
      call("onCursorTrailStyle", cursorTrailStyle);
    });
  }

  // ---- 鼠标光影颜色：方形调色盘按钮 + 展开浮层 ----
  const trailColorButton = $("[data-trail-color]");
  const trailColorPopover = $("[data-trail-color-popover]");
  const trailColorMount = $("[data-trail-color-mount]");
  const trailColorClose = $("[data-trail-color-close]");
  let trailColor = typeof callbacks.cursorTrailColor === 'string' ? callbacks.cursorTrailColor : null;

  /** 同步按钮上的小色块与浮层里的色值预览（null = 跟随氛围主题）。 */
  function syncTrailColorPreview() {
    const dot = $("[data-trail-color-dot]");
    const hexLabel = $("[data-trail-color-hex]");
    const swatch = trailColorButton?.querySelector("i");
    const value = trailColor || null;
    if (dot) dot.style.background = value ?? "transparent";
    if (hexLabel) hexLabel.textContent = value ? value.toUpperCase() : "跟随氛围";
    if (swatch) {
      // 按钮原本显示当前色；未自定义时用主题渐变表示「跟随氛围」。
      swatch.style.background = value ?? "linear-gradient(135deg, #8b75ff, #4dc8ff)";
    }
    trailColorButton?.classList.toggle("is-custom", Boolean(value));
  }

  function openTrailColorPopover(open) {
    const isOpen = Boolean(open);
    if (!trailColorPopover) return;
    trailColorPopover.hidden = !isOpen;
    trailColorButton?.setAttribute("aria-expanded", String(isOpen));
  }

  if (trailColorButton) {
    on(trailColorButton, "click", () => {
      const currentlyOpen = trailColorPopover ? trailColorPopover.hidden === false : false;
      const nextOpen = !currentlyOpen;
      openTrailColorPopover(nextOpen);
      if (nextOpen) call("onTrailColorPickerOpen");
    });
  }
  if (trailColorClose) on(trailColorClose, "click", () => openTrailColorPopover(false));

  root.querySelectorAll("[data-ambience]").forEach((button) => {
    on(button, "click", () => {
      ambienceScene = button.dataset.ambience;
      syncAmbience();
      call("onAmbience", ambienceScene);
    });
  });

  if (bgUpload && bgFile) on(bgUpload, "click", () => bgFile.click());
  if (bgFile) {
    on(bgFile, "change", () => {
      const chosen = bgFile.files?.[0];
      bgFile.value = "";
      if (chosen) call("onBackgroundFile", chosen);
    });
  }
  if (bgClear) on(bgClear, "click", () => call("onBackgroundClear"));
  if (bgName && typeof callbacks.backgroundName === "string") {
    bgName.textContent = callbacks.backgroundName || "无";
  }
  syncAmbience();

  function select(group, value) {
    root.querySelectorAll(`[data-${group}]`).forEach((button) => {
      const active = button.dataset[group] === value;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }
  function syncShapeBar() {
    const active = shapeType === "image";
    if (shapeBar) shapeBar.hidden = !active;
    if (shapeTune) shapeTune.hidden = !active;
  }

  function selectType(type) {
    shapeType = type;
    select("type", type);
    syncShapeBar();
  }

  // 图片形态：还没有图片时先弹文件选择；有图片才真正切换形态
  const imageTypeButton = root.querySelector('[data-type="image"]');
  if (imageTypeButton)
    on(imageTypeButton, "click", () => {
      if (!shapeHasImage) {
        shapeFile?.click?.();
        return;
      }
      selectType("image");
      call("onType", "image");
    });

  if (shapeUpload && shapeFile)
    on(shapeUpload, "click", () => shapeFile.click());
  if (shapeFile)
    on(shapeFile, "change", () => {
      const chosen = shapeFile.files?.[0];
      shapeFile.value = "";
      if (chosen) call("onShapeFile", chosen);
    });
  if (shapeClear) on(shapeClear, "click", () => call("onShapeClear"));

  const shapeDensity = $("[data-shape-density]");
  const shapeEdge = $("[data-shape-edge]");
  const shapeSat = $("[data-shape-saturation]");
  const shapeTolerance = $("[data-shape-tolerance]");
  const shapeBg = $("[data-shape-bg]");
  const shapeOutline = $("[data-shape-outline]");
  const shapeLightBg = $("[data-shape-lightbg]");
  const pushShapeOptions = () => {
    shapeOptions = {
      density: Number(shapeDensity?.value ?? 1),
      edge: Number(shapeEdge?.value ?? 1),
      saturation: Number(shapeSat?.value ?? 1.2),
      backgroundTolerance: Number(shapeTolerance?.value ?? 0.2),
      background: shapeBg?.classList.contains("active") ? "auto" : "keep",
      outlineOnly: shapeOutline?.classList.contains("active") === true,
      keepLightBackground: shapeLightBg?.classList.contains("active") !== true,
    };
    call("onShapeOptions", { ...shapeOptions });
  };
  if (shapeDensity)
    on(shapeDensity, "input", () => {
      fill(shapeDensity);
      $("[data-shape-density-value]").textContent = Number(shapeDensity.value).toFixed(1);
      pushShapeOptions();
    });
  if (shapeEdge)
    on(shapeEdge, "input", () => {
      fill(shapeEdge);
      $("[data-shape-edge-value]").textContent = Number(shapeEdge.value).toFixed(1);
      pushShapeOptions();
    });
  if (shapeSat)
    on(shapeSat, "input", () => {
      fill(shapeSat);
      $("[data-shape-saturation-value]").textContent = Number(shapeSat.value).toFixed(1);
      pushShapeOptions();
    });
  if (shapeTolerance)
    on(shapeTolerance, "input", () => {
      fill(shapeTolerance);
      $("[data-shape-tolerance-value]").textContent = Number(shapeTolerance.value).toFixed(2);
      pushShapeOptions();
    });
  if (shapeLightBg)
    on(shapeLightBg, "click", () => {
      const active = !shapeLightBg.classList.contains("active");
      shapeLightBg.classList.toggle("active", active);
      shapeLightBg.setAttribute("aria-checked", String(active));
      pushShapeOptions();
    });
  if (shapeOutline)
    on(shapeOutline, "click", () => {
      const active = !shapeOutline.classList.contains("active");
      shapeOutline.classList.toggle("active", active);
      shapeOutline.setAttribute("aria-checked", String(active));
      pushShapeOptions();
    });
  if (shapeBg)
    on(shapeBg, "click", () => {
      const active = !shapeBg.classList.contains("active");
      shapeBg.classList.toggle("active", active);
      shapeBg.setAttribute("aria-checked", String(active));
      pushShapeOptions();
    });
  syncShapeBar();

  for (const group of ["type", "theme", "quality"])
    root.querySelectorAll(`[data-${group}]`).forEach((button) =>
      on(button, "click", () => {
        // 图片按钮有独立逻辑（需要先选图），这里跳过
        if (group === "type" && button.dataset.type === "image") return;
        select(group, button.dataset[group]);
        if (group === "type") {
          shapeType = button.dataset.type;
          syncShapeBar();
        }
        call(
          `on${group[0].toUpperCase() + group.slice(1)}`,
          button.dataset[group],
        );
        if (group === "theme") {
          $(".theme-name").textContent = {
            cosmic: "星际",
            fire: "日落",
            mono: "月光",
          }[button.dataset[group]];
          // 选回预设主题时，自定义调色盘按钮取消高亮（颜色已由 onTheme 覆盖）。
          applyCustomTheme(null);
        }
      }),
    );

  // ---- 氛围色彩自定义：圆形调色盘按钮 + 点击展开的浮层 ----
  const themePickerButton = $("[data-theme-picker]");
  const themePickerPopover = $("[data-theme-popover]");
  const themePickerMount = $("[data-theme-picker-mount]");
  let customThemeColor = callbacks.customTheme ?? null;

  function syncThemePicker() {
    if (!themePickerButton) return;
    const isCustom = Boolean(customThemeColor);
    themePickerButton.classList.toggle("active", isCustom);
    themePickerButton.setAttribute("aria-pressed", String(isCustom));
    themePickerButton.setAttribute(
      "title",
      isCustom ? `自定义色彩 ${customThemeColor}` : "自定义氛围色彩",
    );
    // 圆形色轮预览 + 中心小圆点显示当前选中的颜色。
    const swatch = themePickerButton.querySelector("span");
    if (swatch) {
      swatch.style.setProperty("--picked", isCustom ? customThemeColor : "transparent");
    }
    if (isCustom) {
      $(".theme-name").textContent = "自定义";
    } else {
      const active = root.querySelector(".theme-button[data-theme].active");
      const labels = { cosmic: "星际", fire: "日落", mono: "月光" };
      $(".theme-name").textContent = labels[active?.dataset?.theme] ?? "星际";
    }
  }

  // 外部（main.js）恢复上次的自定义色时调用；传 null 表示回到预设主题。
  function applyCustomTheme(color) {
    const next = typeof color === "string" && color.trim() ? color.trim() : null;
    customThemeColor = next;
    syncThemePicker();
  }

  function openThemePicker(open) {
    const isOpen = Boolean(open);
    if (!themePickerPopover) return;
    themePickerPopover.hidden = !isOpen;
    themePickerButton?.setAttribute("aria-expanded", String(isOpen));
    document.body.classList.toggle("theme-picker-open", isOpen);
  }

  /** 把调色盘组件挂进浮层，并把选色结果同步给预览、按钮与回调。 */
  function mountThemePicker(palette) {
    if (!themePickerMount || !palette?.el) return;
    themePickerMount.replaceChildren(palette.el);
  }

  function syncThemePickerPreview(color) {
    const dot = $("[data-theme-picker-dot]");
    const hex = $("[data-theme-picker-hex]");
    const value = typeof color === "string" && color ? color : null;
    if (dot) dot.style.background = value ?? "transparent";
    if (hex) hex.textContent = value ? value.toUpperCase() : "未选择";
  }

  const themePickerClose = $("[data-theme-picker-close]");
  if (themePickerClose) on(themePickerClose, "click", () => openThemePicker(false));
  if (themePickerButton) {
    on(themePickerButton, "click", () => {
      // 当前是展开状态 → 收起；当前收起 → 展开。
      const currentlyOpen = themePickerPopover ? themePickerPopover.hidden === false : false;
      const nextOpen = !currentlyOpen;
      openThemePicker(nextOpen);
      if (nextOpen) call("onThemePickerOpen");
    });
  }
  on(window, "keydown", (event) => {
    if (event.key !== "Escape") return;
    // 先收最上层的浮层，避免一次 Esc 把整个面板也关掉。
    if (trailColorPopover && !trailColorPopover.hidden) {
      openTrailColorPopover(false);
      return;
    }
    if (themePickerPopover && !themePickerPopover.hidden) openThemePicker(false);
  });
  const isFileDrag = (event) =>
    Array.from(event.dataTransfer?.types || []).includes("Files");
  on(window, "dragenter", (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragDepth++;
    $(".drop-overlay").hidden = false;
  });
  on(window, "dragover", (event) => {
    if (isFileDrag(event)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }
  });
  on(window, "dragleave", (event) => {
    if (!isFileDrag(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) $(".drop-overlay").hidden = true;
  });
  on(window, "drop", (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragDepth = 0;
    $(".drop-overlay").hidden = true;
    const dropped = event.dataTransfer?.files?.[0];
    if (dropped) call("onFile", dropped);
  });
  return {
    /** 收起 / 展开底部播放器（下拉隐藏）。 */
    setPlayerCollapsed(collapsed) {
      applyPlayerCollapsed(collapsed, { persist: false });
    },
    update(state = {}, features = {}) {
      const duration = Number(state.duration) || 0,
        current = Number(state.currentTime ?? state.time) || 0;
      const loaded = Boolean(state.loaded ?? state.hasTrack ?? duration > 0);
      const playing = Boolean(state.playing ?? state.isPlaying);
      const name = state.displayName ?? state.trackName ?? state.fileName ?? state.name;
      if (name && $("[data-track]").textContent !== name) {
        $("[data-track]").textContent = name;
        $("[data-track]").title = state.fullName ?? name;
      }
      play.disabled = !loaded;
      seek.disabled = !loaded || duration <= 0;
      if (playing !== previousPlaying) {
        play.innerHTML = svg(playing ? "pause" : "play");
        play.setAttribute("aria-label", playing ? "暂停" : "播放");
        play.title = playing ? "暂停" : "播放";
        previousPlaying = playing;
      }
      if (!dragging) {
        seek.max = String(duration || 1);
        seek.value = String(current);
        fill(seek);
        $("[data-current]").textContent = time(current);
      }
      $("[data-duration]").textContent = time(duration);
      // 艺术家 / 格式徽标 / 收藏 / 循环 / 随机 / 封面首字
      const artist = state.artist || (loaded ? "未知歌手" : "选择本地音频开始");
      const sub = $("[data-track-sub]");
      if (sub && sub.textContent !== artist) sub.textContent = artist;
      const fileRef = String(state.fullName || state.name || "");
      const ext = (fileRef.match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase();
      const formatBadge = $("[data-badge-format]");
      if (formatBadge) formatBadge.textContent = loaded ? (ext ? ext.toUpperCase() : "LOCAL") : "LOCAL";
      const losslessBadge = $("[data-badge-lossless]");
      if (losslessBadge) losslessBadge.hidden = !(loaded && ["flac", "wav", "aiff", "alac"].includes(ext));
      const likeButton = $("[data-like]");
      if (likeButton) {
        const liked = state.liked === true;
        likeButton.classList.toggle("is-active", liked);
        likeButton.setAttribute("aria-pressed", String(liked));
        likeButton.setAttribute("aria-label", liked ? "取消收藏" : "收藏");
        likeButton.title = liked ? "取消收藏" : "收藏";
      }
      const repeatButton = $("[data-repeat]");
      const repeatMode = state.repeatMode || "all";
      if (repeatButton) {
        repeatButton.classList.toggle("is-active", repeatMode !== "off");
        repeatButton.classList.toggle("is-one", repeatMode === "one");
        repeatButton.setAttribute("aria-pressed", String(repeatMode !== "off"));
        const indicator = $("[data-repeat-indicator]");
        if (indicator) indicator.textContent = repeatMode === "one" ? "1" : "";
        repeatButton.title =
          repeatMode === "one" ? "循环：单曲循环" : repeatMode === "off" ? "循环：关闭" : "循环：列表循环";
      }
      const shuffleButton = $("[data-shuffle]");
      if (shuffleButton) {
        const shuffleOn = state.shuffle === true;
        shuffleButton.classList.toggle("is-active", shuffleOn);
        shuffleButton.setAttribute("aria-pressed", String(shuffleOn));
        shuffleButton.title = shuffleOn ? "随机播放：开" : "随机播放：关";
      }
      const cover = $("[data-cover]");
      const coverLetter = $("[data-cover-letter]");
      if (cover && coverLetter) {
        const letter = loaded ? String(name || "").trim().charAt(0) || "♪" : "";
        coverLetter.textContent = letter;
        cover.classList.toggle("has-track", Boolean(letter));
        cover.style.setProperty("--cover-hue", String(hashHue(String(name || ""))));

        // 在线音乐带专辑封面（QQ / 网易云）：有地址就显示图片，取不到则回退到首字。
        const coverUrl = loaded ? String(state.cover || state.coverUrl || "").trim() : "";
        let coverImg = cover.querySelector(".cover-image");
        if (coverUrl) {
          if (!coverImg) {
            coverImg = document.createElement("img");
            coverImg.className = "cover-image";
            coverImg.alt = "";
            coverImg.loading = "lazy";
            coverImg.decoding = "async";
            coverImg.addEventListener("error", () => {
              // 加载失败（防盗链 / 404）时安静回退到首字，不打扰用户。
              coverImg.dataset.failed = "1";
              cover.classList.remove("has-cover");
            });
            coverImg.addEventListener("load", () => {
              if (coverImg.dataset.failed === "1") return;
              cover.classList.add("has-cover");
            });
            cover.append(coverImg);
          }
          // 换歌时才换 src，避免同一首歌反复重载图片。
          if (coverImg.dataset.src !== coverUrl) {
            coverImg.dataset.src = coverUrl;
            coverImg.dataset.failed = "";
            cover.classList.remove("has-cover");
            coverImg.src = coverUrl;
          }
          // 浏览器缓存命中时 load 可能早于监听，这里补一次判断。
          if (coverImg.complete && coverImg.naturalWidth > 0 && coverImg.dataset.failed !== "1") {
            cover.classList.add("has-cover");
          }
        } else {
          cover.classList.remove("has-cover");
          if (coverImg) {
            coverImg.removeAttribute("src");
            coverImg.dataset.src = "";
          }
        }
      }
      const progressBar = $(".player-progress");
      if (progressBar) progressBar.style.setProperty("--progress", duration > 0 ? String(Math.min(1, current / duration)) : "0");
      if (!root.classList.contains("loading"))
        $("[data-status]").textContent = playing
          ? "正在聆听你的宇宙"
          : loaded
            ? "音乐已就绪"
            : "等待音乐入场";
      $("[data-upload-text]").textContent = loaded
        ? "更换音乐"
        : "选择本地音频";
      const energy = Number(
        features.energy ??
          features.overall ??
          features.rms ??
          features.volume ??
          0,
      );
      root
        .querySelectorAll(".signal i")
        .forEach((bar, index) =>
          bar.style.setProperty(
            "--h",
            `${Math.max(2, Math.min(12, 3 + energy * 20 * (0.5 + Math.sin(index + current) * 0.5)))}px`,
          ),
        );
    },
    showError(message) {
      clearTimeout(errorTimer);
      $(".toast").textContent = message;
      $(".toast").hidden = false;
      errorTimer = setTimeout(() => ($(".toast").hidden = true), 6500);
    },
    showLoading(value, message = '正在解码音乐…') {
      root.classList.toggle('loading', Boolean(value));
      root.setAttribute('aria-busy', String(Boolean(value)));
      if (value) $("[data-status]").textContent = message;
    },
    // ---- 效果栏外部同步（main.js 在恢复设置/上传后调用，不触发回调）----
    setShape(type) {
      if (type === "image" && !shapeHasImage) return;
      selectType(type);
    },
    setShapeOptions(options = {}) {
      shapeOptions = { ...shapeOptions, ...options };
      if (shapeDensity) {
        shapeDensity.value = String(shapeOptions.density ?? 1);
        fill(shapeDensity);
        $("[data-shape-density-value]").textContent = Number(shapeDensity.value).toFixed(1);
      }
      if (shapeEdge) {
        shapeEdge.value = String(shapeOptions.edge ?? 1);
        fill(shapeEdge);
        $("[data-shape-edge-value]").textContent = Number(shapeEdge.value).toFixed(1);
      }
      if (shapeSat) {
        shapeSat.value = String(shapeOptions.saturation ?? 1.2);
        fill(shapeSat);
        $("[data-shape-saturation-value]").textContent = Number(shapeSat.value).toFixed(1);
      }
      if (shapeTolerance) {
        shapeTolerance.value = String(shapeOptions.backgroundTolerance ?? 0.2);
        fill(shapeTolerance);
        $("[data-shape-tolerance-value]").textContent = Number(shapeTolerance.value).toFixed(2);
      }
      if (shapeLightBg) {
        const lightKeep = shapeOptions.keepLightBackground !== false;
        shapeLightBg.classList.toggle("active", !lightKeep);
        shapeLightBg.setAttribute("aria-checked", String(!lightKeep));
      }
      if (shapeOutline) {
        const outline = shapeOptions.outlineOnly === true;
        shapeOutline.classList.toggle("active", outline);
        shapeOutline.setAttribute("aria-checked", String(outline));
      }
      if (shapeBg) {
        const auto = shapeOptions.background !== "keep";
        shapeBg.classList.toggle("active", auto);
        shapeBg.setAttribute("aria-checked", String(auto));
      }
    },
    setShapeHasImage(has) {
      shapeHasImage = Boolean(has);
      if (!shapeHasImage && shapeType === "image") selectType("wave");
      else syncShapeBar();
    },
    setEffectsOpen(open) {
      applyEffectsOpen(open);
    },
    isEffectsOpen() {
      return document.body.classList.contains('effects-open');
    },
    setParticlesEnabled(enabled) {
      particlesOn = Boolean(enabled);
      syncParticles();
    },
    setCursorTrailEnabled(enabled) {
      cursorTrailOn = Boolean(enabled);
      syncCursorTrail();
    },
    setCursorTrailStyle(style) {
      cursorTrailStyle = CURSOR_TRAIL_STYLES.some((item) => item.id === style) ? style : 'comet';
      syncCursorTrail();
    },
    // ---- 鼠标光影颜色调色盘 ----
    /** 挂载光影颜色调色盘组件（square 形状），并同步预览。 */
    mountTrailPalette(palette) {
      if (!trailColorMount || !palette?.el) return;
      trailColorMount.replaceChildren(palette.el);
      syncTrailColorPreview();
    },
    /** 外部同步光影自定义色（null = 跟随氛围主题），不触发回调。 */
    setCursorTrailColor(color) {
      trailColor = typeof color === 'string' && color ? color : null;
      syncTrailColorPreview();
    },
    /** 调色盘选色回调：更新按钮色块与预览。 */
    handleTrailColorPick(color) {
      trailColor = typeof color === 'string' && color ? color : null;
      syncTrailColorPreview();
    },
    openTrailColorPicker(open) {
      openTrailColorPopover(open);
    },
    // ---- 氛围色彩自定义调色盘 ----
    /** 挂载调色盘组件（main.js 创建后传入），并把当前色同步到预览。 */
    mountThemePalette(palette) {
      mountThemePicker(palette);
      syncThemePickerPreview(customThemeColor);
      syncThemePicker();
    },
    /** 外部同步“当前是否为自定义色”（传 null 回到预设主题），不触发回调。 */
    setCustomTheme(color) {
      applyCustomTheme(color);
      syncThemePickerPreview(customThemeColor);
    },
    openThemePicker(open) {
      openThemePicker(open);
    },
    /** 调色盘选色时由 main.js 调用：更新按钮高亮、名字与色值预览。 */
    handleThemePick(color) {
      applyCustomTheme(color ?? null);
      syncThemePickerPreview(customThemeColor);
    },
    setSceneOffset(offset = {}) {
      if (!sceneOffsetValue) return;
      const x = Number(offset.x) || 0;
      const y = Number(offset.y) || 0;
      sceneOffsetValue.textContent = `${x.toFixed(1)} / ${y.toFixed(1)}`;
      sceneOffsetButtons.forEach((button) => {
        button.classList.toggle("is-active", button.dataset.sceneOffsetBtn === "center" && x === 0 && y === 0);
      });
    },
    setAmbience(scene) {
      if (AMBIENCE_SCENES.includes(scene)) {
        ambienceScene = scene;
        syncAmbience();
      }
    },
    setBackgroundName(name) {
      if (bgName) bgName.textContent = String(name ?? '').trim() || '默认';
    },
    pickBackgroundFile() {
      bgFile?.click?.();
    },
    dispose() {
      listeners.forEach((remove) => remove());
      clearTimeout(errorTimer);
      root.innerHTML = "";
    },
  };
}

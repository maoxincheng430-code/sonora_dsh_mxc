import './style.css';
import './lyrics.css';
import './lyrics-panel.css';
import './free-mascot.css';
import './ambience.css';
import './pomodoro.css';
import './navbar.css';
import './qq-panel.css';
import { AudioEngine } from './audio.js';
import { ParticleScene, isVideoFile } from './particles.js';
import { imageToCanvas } from './image-particles.js';
import { createBackgroundPicker, PRESET_BACKGROUNDS, findPreset, presetUrl } from './background-picker.js';
import { SpaceDecor } from './space-decor.js';
import { createCursorTrail, CURSOR_TRAIL_STYLES } from './cursor-trail.js';
import { createFreeMascot } from './free-mascot.js';
import {
  createColorPalette,
  hexToHsl,
  hslToHex,
  normalizeHexColor,
} from './color-palette.js';
import { createLyricsOverlay, normalizeChatProfile } from './lyrics.js';
import { createLyricsPanel } from './lyrics-panel.js';
import { createLyricsLibrary } from './lyrics-library.js';
import { createAmbience } from './ambience.js';
import { createBackgroundStore, classifyBackgroundFile } from './background-media.js';
import { createPomodoro, DEFAULT_MASCOT_SRC } from './pomodoro.js';
import { COMPLETE_CHEER, CHEER_INTERVAL_SECONDS, encouragementFor } from './encouragement.js';
import { MASCOT_OPTIONS, findMascot } from './mascot-options.js';
import { createFocusChoices } from './focus-choices.js';
import { createNavbar } from './navbar.js';
import { createUI } from './ui.js';
import { MusicLibrary } from './library.js';
import { createRemoteLibrary, probeServer } from './library-api.js';
import { createLibraryUI } from './library-ui.js';
import { createOnlinePanel } from './online-panel.js';
import { isValidEmbeddedLyrics, readMediaMetadata } from './media-metadata.js';
import { analyzeAudioBuffer, sampleBeat } from './beat-analysis.js';
import { beatCacheKey, createBeatCache } from './beat-cache.js';
import { filesFromDesktopPayload, isDesktop } from './desktop.js';
import {
  addCompletedSession,
  addStudySeconds,
  formatStudyDuration,
  loadFocusStats,
  saveFocusStats,
  loadFocusHistory,
  saveFocusHistory,
  recordFocusDay,
  focusStreak,
  dailyGoalProgress,
  todayKey,
} from './study-stats.js';

const audio = new AudioEngine();

// 节拍分析：解码后按曲目分析一次，结果缓存到 IndexedDB
const beatCache = createBeatCache();
let beatGrid = null;
let beatTaskId = 0;

function scheduleBeatAnalysis(track) {
  const token = ++beatTaskId;
  beatGrid = null;
  if (!track) return;
  const run = async () => {
    try {
      const cached = await beatCache.get(track);
      if (token !== beatTaskId) return;
      if (cached) {
        beatGrid = cached;
        return;
      }
      const buffer = audio.getBuffer();
      if (!buffer) return;
      // 放到下一个宏任务里算，避免解码完成的那一帧卡住
      setTimeout(() => {
        if (token !== beatTaskId) return;
        const grid = analyzeAudioBuffer(buffer);
        if (grid) {
          beatGrid = grid;
          beatCache.set(track, grid).catch(() => {});
        }
      }, 0);
    } catch {
      // 分析失败不影响播放
    }
  };
  run();
}

// 曲库双存储：后端 API 可用时歌曲写入 MySQL，否则回退浏览器 IndexedDB。
const localLibrary = new MusicLibrary();
let library = localLibrary;
let storageMode = 'local';
const API_BASE = 'http://127.0.0.1:8787';
const PARTICLES_KEY = 'sonora-particles';
// 图片形态：保存当前形态与压缩后的图片 dataURL，刷新后还能恢复
const SHAPE_KEY = 'sonora-shape';
const SHAPE_IMAGE_KEY = 'sonora-shape-image';
const SHAPE_OPTIONS_KEY = 'sonora-shape-options';
const CURSOR_TRAIL_KEY = 'sonora-cursor-trail';
const CURSOR_TRAIL_STYLE_KEY = 'sonora-cursor-trail-style';
const TRAIL_COLOR_KEY = 'sonora-cursor-trail-color';
const SCENE_OFFSET_KEY = 'sonora-scene-offset';
// 预设档位（点方向键走的是连续微调，这里只用于旧版/快捷值）。
const SCENE_OFFSET_PRESETS = {
  center: { x: 0, y: 0 },
  up: { x: 0, y: 1.4 },
  down: { x: 0, y: -1.4 },
  left: { x: -1.9, y: 0 },
  right: { x: 1.9, y: 0 },
};
// 单次点击的步进（越大一次挪得越多）。
const SCENE_OFFSET_STEP = 0.32;
// 可移动范围上限：相机在 z=9.6、fov≈45°，可视半宽约 3.5，
// 这里给到 ±2.6 / ±2.0，既能明显平移画面，又不会把粒子完全推出视野。
const SCENE_OFFSET_LIMIT = { x: 2.6, y: 2.0 };
const AMBIENCE_KEY = 'sonora-ambience';
const CUSTOM_THEME_KEY = 'sonora-custom-theme';
const AMBIENCE_SCENES = ['none', 'rain', 'thunder', 'beach', 'library', 'image'];
const readStored = (key, fallback = '') => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};
const writeStored = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 隐私模式 / 配额不足时忽略
  }
};
// 粒子特效开关与背景场景都从上次选择恢复；自定义背景文件单独存 IndexedDB。
const initialParticlesEnabled = readStored(PARTICLES_KEY, 'on') !== 'off';
// 鼠标光影跟随：默认开启（沿用原有行为），可在右侧「效果」栏关闭。
const initialCursorTrailEnabled = readStored(CURSOR_TRAIL_KEY, 'on') !== 'off';
const storedTrailStyle = readStored(CURSOR_TRAIL_STYLE_KEY, 'comet');
const initialCursorTrailStyle = CURSOR_TRAIL_STYLES.some((style) => style.id === storedTrailStyle) ? storedTrailStyle : 'comet';
// 鼠标光影自定义色：空字符串表示跟随氛围主题。
const initialTrailColor = normalizeHexColor(readStored(TRAIL_COLOR_KEY, ''));
function clampSceneOffset(offset = {}) {
  const limit = SCENE_OFFSET_LIMIT;
  return {
    x: Math.max(-limit.x, Math.min(limit.x, Number(offset.x) || 0)),
    y: Math.max(-limit.y, Math.min(limit.y, Number(offset.y) || 0)),
  };
}

function loadSceneOffset() {
  const raw = readStored(SCENE_OFFSET_KEY, '');
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return clampSceneOffset(parsed);
  } catch {
    // 旧格式：center / up / down / left / right
  }
  return clampSceneOffset(SCENE_OFFSET_PRESETS[raw] ?? SCENE_OFFSET_PRESETS.center);
}

const initialSceneOffset = loadSceneOffset();
let sceneOffset = { ...initialSceneOffset };
// 自定义氛围色彩：空字符串表示沿用预设主题。存的是最近一次选中的自定义色。
const storedCustomTheme = readStored(CUSTOM_THEME_KEY, '').trim();
const initialCustomTheme = {
 color: /^#[0-9a-f]{6}$/i.test(storedCustomTheme)
   ? storedCustomTheme.toLowerCase()
   : null,
};
const storedAmbience = readStored(AMBIENCE_KEY, 'none');
const initialAmbienceScene = AMBIENCE_SCENES.includes(storedAmbience) ? storedAmbience : 'none';
let scene;
let decor;
let particlesEnabled = initialParticlesEnabled;
let cursorTrailEnabled = initialCursorTrailEnabled;
let cursorTrailColor = initialTrailColor;
let loadId = 0;
let importId = 0;
let tracks = [];
let activeTrack = null;
let libraryError = '';
let listRevision = 0;

// ---- 底部播放器：收藏 / 循环 / 随机 / 自动下一首 ----
const FAVORITES_KEY = 'sonora-favorites';
function loadFavorites() {
  try {
    const raw = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
    return new Set(Array.isArray(raw) ? raw.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}
let favoriteIds = loadFavorites();
let repeatMode = 'all'; // 'off' | 'all' | 'one'
let shuffleOn = false;
let wasPlayingLastFrame = false;

// 效果栏回调：粒子特效开关 / 鼠标光影跟随 / 背景场景（自定义图片·视频由 upload 回调处理）。
function setParticlesEnabled(enabled, { persist = true } = {}) {
  particlesEnabled = Boolean(enabled);
  ui.setParticlesEnabled(particlesEnabled);
  scene?.setEnabled(particlesEnabled);
  document.querySelector('#scene')?.classList.toggle('scene-off', !particlesEnabled);
  if (persist) writeStored(PARTICLES_KEY, particlesEnabled ? 'on' : 'off');
}

// 鼠标光影粒子追踪开关：关闭后立即清掉画面并停止 rAF，鼠标事件也不再产生轨迹。
function setSceneOffset(offset, { persist = true } = {}) {
  const next = clampSceneOffset(offset);
  scene?.setViewOffset?.(next.x, next.y);
  ui.setSceneOffset?.(next);
  if (persist) writeStored(SCENE_OFFSET_KEY, JSON.stringify(next));
}

function nudgeSceneOffset(direction) {
  const step = SCENE_OFFSET_STEP;
  let { x, y } = sceneOffset;
  if (direction === 'up') y += step;
  else if (direction === 'down') y -= step;
  else if (direction === 'left') x -= step;
  else if (direction === 'right') x += step;
  else if (direction === 'center') {
    x = 0;
    y = 0;
  }
  sceneOffset = clampSceneOffset({ x, y });
  setSceneOffset(sceneOffset);
}

function setCursorTrailStyle(style, { persist = true } = {}) {
  if (!CURSOR_TRAIL_STYLES.some((item) => item.id === style)) return;
  cursorTrail?.setStyle?.(style);
  ui.setCursorTrailStyle?.(style);
  if (persist) writeStored(CURSOR_TRAIL_STYLE_KEY, style);
}

// ---- 鼠标光影颜色：独立于氛围色彩的自定义色 ----
// 传 null 表示「跟随氛围主题」（回到 TRAIL_COLORS 的预设三色）。
function setCursorTrailColor(color, { persist = true } = {}) {
  const hex = normalizeHexColor(color);
  cursorTrailColor = hex;
  if (hex) {
    // 由单一颜色推导同色系三色，让彗星/星尘等渐变样式仍有层次。
    const { h, s, l } = hexToHsl(hex);
    cursorTrail?.setColors?.([
      hslToHex(h, Math.min(100, s + 6), Math.min(94, l + 14)),
      hex,
      hslToHex(h, Math.min(100, s + 4), Math.max(16, l - 12)),
    ]);
  } else {
    // 回到氛围主题色
    cursorTrail?.setColors?.(TRAIL_COLORS[currentTheme] ?? TRAIL_COLORS.cosmic);
  }
  ui.handleTrailColorPick?.(hex);
  if (persist) writeStored(TRAIL_COLOR_KEY, hex ?? '');
}

function setCursorTrailEnabled(enabled, { persist = true } = {}) {
  cursorTrailEnabled = Boolean(enabled);
  ui.setCursorTrailEnabled(cursorTrailEnabled);
  cursorTrail?.setEnabled(cursorTrailEnabled);
  if (persist) writeStored(CURSOR_TRAIL_KEY, cursorTrailEnabled ? 'on' : 'off');
}

function setAmbienceScene(sceneName, { persist = true } = {}) {
  const next = AMBIENCE_SCENES.includes(sceneName) ? sceneName : 'none';
  // 自定义图片/视频由上传按钮选择文件，这里只切内置场景。
  ambience?.setScene(next);
  ui.setAmbience(next);
  ui.setBackgroundName('');
  if (persist) writeStored(AMBIENCE_KEY, next);
}

const ui = createUI({
  particles: initialParticlesEnabled,
  ambience: initialAmbienceScene,
  backgroundName: '',
  cursorTrail: initialCursorTrailEnabled,
  cursorTrailStyle: initialCursorTrailStyle,
  cursorTrailColor: initialTrailColor,
  onTrailColorPickerOpen: () => syncTrailPalette(),
  sceneOffset: initialSceneOffset,
  customTheme: initialCustomTheme.color,
  onParticles: (enabled) => setParticlesEnabled(enabled),
  onCursorTrail: (enabled) => setCursorTrailEnabled(enabled),
  onCursorTrailStyle: (style) => setCursorTrailStyle(style),
  onCursorTrailColor: (color) => setCursorTrailColor(color),
  onSceneOffset: (direction) => nudgeSceneOffset(direction),
  onThemePickerOpen: () => syncThemePalette(),
  onAmbience: (scene) => selectAmbienceScene(scene),
  onBackgroundFile: (file) => applyBackgroundFile(file),
  onBackgroundClear: () => clearBackground(),
  async onFile(file) {
    await importFile(file);
  },
  async onTogglePlay() {
    try {
      if (audio.getState().playing) {
        audio.pause();
        renderLibrary();
        return;
      }
      await audio.play();
      await markPlayed();
      renderLibrary();
    } catch (error) {
      ui.showError(error.message || '无法开始播放，请重新选择音乐。');
    }
  },
  onSeek: (seconds) => audio.seek(seconds),
  onVolume: (value) => audio.setVolume(value),
  onPrev: () => playRelativeTrack(-1),
  onNext: () => playRelativeTrack(1),
  onShuffle: () => {
    shuffleOn = !shuffleOn;
    ui.showError(shuffleOn ? '随机播放：开' : '随机播放：关');
  },
  onRepeat: () => {
    repeatMode = repeatMode === 'all' ? 'one' : repeatMode === 'one' ? 'off' : 'all';
    ui.showError(repeatMode === 'one' ? '单曲循环' : repeatMode === 'off' ? '循环关闭' : '列表循环');
  },
  onLike: () => toggleFavorite(),
  onQueue: () => document.querySelector('[data-library-open]')?.click(),
  onLyrics: () => lyricsPanel.open(),
  onEffectsPanel: () => document.querySelector('[data-effects-toggle]')?.click(),
  onImport: () => document.querySelector('[data-file]')?.click(),
  onSensitivity: (value) => scene?.setSensitivity(value),
  onBandGains: (gains) => scene?.setBandGains(gains),
  onType: (type) => {
    scene?.setType(type);
    writeStored(SHAPE_KEY, type);
  },
  onShapeFile: (file) => (isVideoFile(file) ? applyShapeVideo(file) : applyShapeImage(file)),
  onShapeClear: () => clearShapeImage(),
  onShapeOptions: (options) => applyShapeOptions(options),

  onTheme: (theme) => {
    // 选预设主题即退出自定义色彩：记住该预设，并清掉自定义色存储。
    currentTheme = theme;
    customThemeColor = null;
    applyPresetTheme(theme);
    writeStored(CUSTOM_THEME_KEY, '');
  },
  onQuality: (quality) => { scene?.setQuality(quality); if (decor) { decor.setQuality(quality); decor.setPixelRatio(scene.renderer.getPixelRatio()); } },
  async onFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      ui.showError('当前浏览器暂不支持全屏模式。');
    }
  },
});

const libraryUI = createLibraryUI({
  onSelect: (trackId) => selectTrack(trackId),
  onDelete: (trackId) => deleteTrack(trackId),
  onRename: (trackId, patch) => renameTrack(trackId, patch),
  onImport: (files) => importFiles(files),
});

function renderLibrary() {
  libraryUI.render(tracks, activeTrack?.id ?? null, libraryError);
}

async function refreshLibrary() {
  const revision = ++listRevision;
  try {
    const result = await library.list();
    if (revision !== listRevision) return;
    tracks = result;
    libraryError = '';
    if (activeTrack) {
      activeTrack = tracks.find((track) => track.id === activeTrack.id) ?? activeTrack;
    }
  } catch {
    if (revision !== listRevision) return;
    libraryError = '曲库暂时不可用，仍可导入音乐临时播放。';
  }
  renderLibrary();
}

function displayNameFor(state) {
  return activeTrack?.title || activeTrack?.name || state.name;
}

// 读取文件内嵌标签（ID3 / MP4 ilst 的标题、歌手、内嵌歌词），失败时静默返回 null。
async function readTagsFor(file) {
  try {
    return await readMediaMetadata(file);
  } catch {
    return null;
  }
}

// 若音视频文件自带 LRC 歌词（MP4 ©lyr / ID3 USLT），按文件名主干缓存，优先于在线匹配。
function cacheEmbeddedLyrics(fileName, meta) {
  if (!isValidEmbeddedLyrics(meta?.lyrics)) return false;
  const stem = String(fileName || '').replace(/\.[^.]+$/, '');
  if (stem) lyricCache.set(stem, meta.lyrics);
  return true;
}

async function importFile(file) {
  const id = ++loadId;
  audio.cancelPendingLoad();
  ui.showLoading(true);
  try {
    await audio.load(file);
    if (id !== loadId) return;
    const meta = await readTagsFor(file);
    cacheEmbeddedLyrics(file.name, meta);
    activeTrack = null;
    renderLibrary();
    try {
      const track = await library.save(file, audio.getState().duration, meta);
      if (id === loadId) {
        activeTrack = track;
        await refreshLibrary();
        await applyLyricsForTrack(track);
        scheduleBeatAnalysis(track);
      }
    } catch {
      if (id === loadId) ui.showError('音乐可正常播放，但本次未保存：存储空间不足或数据库不可用。');
    }
  } catch (error) {
    if (id === loadId) ui.showError(error.message || '音乐加载失败，请尝试其他文件。');
  } finally {
    if (id === loadId) ui.showLoading(false);
  }
}

async function importFiles(files) {
  const items = Array.from(files || []).filter((file) => file && file.size);
  if (!items.length) {
    ui.showError('没有可导入的音频文件。');
    return { added: 0, skipped: 0, failed: 0 };
  }
  // 同批导入的 .lrc/.txt 歌词文件：按"音频文件名主干"与曲目配对并缓存。
  const lyricFiles = items.filter((file) => /\.(lrc|txt)$/i.test(file.name || ''));
  for (const lyric of lyricFiles) {
    try {
      const stem = (lyric.name || '').replace(/\.[^.]+$/, '');
      const text = await lyric.text();
      lyricCache.set(stem, text);
    } catch {
      // 歌词读取失败不阻塞音频导入
    }
  }
  const audioItems = items.filter((file) => !/\.(lrc|txt)$/i.test(file.name || ''));
  if (!audioItems.length) {
    ui.showError('没有可导入的音频文件。');
    return { added: 0, skipped: 0, failed: 0 };
  }
  const id = ++importId;
  const probe = new AudioEngine();
  let saved = 0;
  let failed = 0;
  let firstTrack = null;
  try {
    for (const file of audioItems) {
      if (id !== importId) break;
      try {
        await probe.load(file);
        const meta = await readTagsFor(file);
        cacheEmbeddedLyrics(file.name, meta);
        const track = await library.save(file, probe.getState().duration, meta);
        firstTrack ??= track;
        saved += 1;
      } catch {
        failed += 1;
      }
    }
  } finally {
    probe.dispose();
  }
  if (id !== importId) return { added: 0, skipped: 0, failed: 0 };
  const before = tracks.length;
  await refreshLibrary();
  if (libraryError) {
    ui.showError('曲库暂时不可用，本次导入的歌曲可能未保存。');
    return { added: 0, skipped: 0, failed };
  }
  const added = Math.max(0, tracks.length - before);
  const skipped = Math.max(0, saved - added);
  if (firstTrack && !audio.getState().playing) {
    const savedTrack = tracks.find((track) => track.id === firstTrack.id);
    if (savedTrack) await selectTrack(savedTrack.id);
  }
  return { added, skipped, failed };
}

function trackIdAtOffset(offset) {
  if (!tracks.length) return null;
  const currentIndex = tracks.findIndex((track) => track.id === activeTrack?.id);
  if (currentIndex < 0) return tracks[0].id;
  const nextIndex = currentIndex + offset;
  if (repeatMode === 'off' && !shuffleOn && (nextIndex < 0 || nextIndex >= tracks.length)) return null;
  if (shuffleOn && tracks.length > 1) {
    let candidate = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      candidate = tracks[Math.floor(Math.random() * tracks.length)];
      if (candidate.id !== activeTrack?.id) break;
    }
    return candidate?.id ?? tracks[0].id;
  }
  return tracks[(nextIndex + tracks.length) % tracks.length].id;
}

async function playRelativeTrack(offset) {
  const trackId = trackIdAtOffset(offset);
  if (!trackId) return;
  await selectTrack(trackId);
  try {
    await audio.play();
    await markPlayed();
  } catch (error) {
    ui.showError(error.message || '无法开始播放，请重新选择音乐。');
  }
  renderLibrary();
}

function toggleFavorite() {
  if (!activeTrack?.id) return;
  if (favoriteIds.has(activeTrack.id)) favoriteIds.delete(activeTrack.id);
  else favoriteIds.add(activeTrack.id);
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favoriteIds]));
  } catch {
    /* 隐私模式下只保留本次会话 */
  }
}

// 自然播完：单曲循环 / 自动下一首；暂停不会触发（currentTime 还没到结尾）
function handleTrackEnd(state) {
  const ended =
    wasPlayingLastFrame &&
    !state.playing &&
    state.loaded &&
    state.duration > 0 &&
    state.currentTime >= state.duration - 0.2;
  wasPlayingLastFrame = Boolean(state.playing);
  if (!ended) return;
  if (repeatMode === 'one') {
    audio.seek(0);
    audio.play().catch(() => {});
    return;
  }
  if (!tracks.length || (repeatMode === 'off' && !shuffleOn)) return;
  const trackId = trackIdAtOffset(1);
  if (!trackId) return;
  selectTrack(trackId)
    .then(() => audio.play())
    .then(() => markPlayed())
    .then(() => renderLibrary())
    .catch(() => {});
}

async function selectTrack(trackId) {
  const id = ++loadId;
  const track = tracks.find((item) => item.id === trackId) ?? null;
  audio.cancelPendingLoad();
  ui.showLoading(true);
  try {
    const file = await library.read(trackId);
    if (id !== loadId) return;
    await audio.load(file);
    if (id !== loadId) return;
    activeTrack = track;
    await applyLyricsForTrack(track);
    scheduleBeatAnalysis(track);
    renderLibrary();
  } catch (error) {
    if (id === loadId) ui.showError(error.message || '读取歌曲失败，请重新导入。');
  } finally {
    if (id === loadId) ui.showLoading(false);
  }
}

async function deleteTrack(trackId) {
  try {
    await library.remove(trackId);
    if (activeTrack?.id === trackId) activeTrack = null;
    await refreshLibrary();
  } catch {
    ui.showError('删除失败，曲库暂时不可用，请稍后重试。');
  }
}

async function renameTrack(trackId, patch) {
  try {
    const updated = await library.update(trackId, patch);
    if (activeTrack?.id === trackId && updated) activeTrack = { ...activeTrack, ...updated };
    await refreshLibrary();
    return updated;
  } catch {
    ui.showError('重命名失败，曲库暂时不可用，请稍后重试。');
    return null;
  }
}

async function markPlayed() {
  if (!activeTrack) return;
  const track = tracks.find((item) => item.id === activeTrack.id);
  if (track) {
    track.playCount = (track.playCount || 0) + 1;
    track.lastPlayedAt = Date.now();
  }
  try {
    await library.touch(activeTrack.id);
  } catch {
    // 播放本身不受曲库影响，播放次数只是锦上添花。
  }
}

// 选择存储后端。
// 默认纯前端：曲库存在浏览器 IndexedDB，**完全不请求本地 API**（新用户 clone 下来
// 直接 npm run dev 就能用，控制台也不会出现"连不上 8787"的红色报错）。
// 想用 MySQL 时：启动 npm run server 后，在页面上开启，或手动执行
//   localStorage.setItem('sonora-storage', 'server')
// 或访问带 ?server=1 的地址强制探测一次。
function wantsServerStorage() {
  try {
    if (new URLSearchParams(location.search).get('server') === '1') return true;
    return localStorage.getItem('sonora-storage') === 'server';
  } catch {
    return false;
  }
}

async function chooseStorage() {
  if (!wantsServerStorage()) {
    storageMode = 'local';
    return;
  }
  try {
    const alive = await probeServer();
    if (!alive) {
      // 探测失败：静默回退 IndexedDB，并把偏好重置回 local，避免每次刷新都白试一次
      try {
        localStorage.setItem('sonora-storage', 'local');
      } catch {}
      storageMode = 'local';
      return;
    }
    const remote = createRemoteLibrary();
    await remote.open();
    library = remote;
    storageMode = 'server';
    const note = document.querySelector('.local-note');
    if (note) note.lastChild.textContent = ' 已连接服务器数据库 · 歌曲存入 MySQL';
  } catch {
    library = localLibrary;
    storageMode = 'local';
  }
}

// 启动流程：先探测存储后端（MySQL / IndexedDB），再拉曲库列表。
// storageReady 供后面的「歌词自动识别」等待探测结果，避免抢跑。
const storageReady = (async () => {
  await chooseStorage();
  await refreshLibrary();
})();

try {
  scene = new ParticleScene(document.querySelector('#scene'));
  scene.setViewOffset?.(initialSceneOffset.x, initialSceneOffset.y);
  ui.setSceneOffset?.(initialSceneOffset);
  decor = new SpaceDecor(scene.scene, scene.quality);
  decor.setPixelRatio(scene.renderer.getPixelRatio());
} catch (error) {
  console.error('WebGL 初始化失败', error);
  ui.showError('无法启用立体粒子，请使用支持 WebGL 的浏览器并开启硬件加速。音乐播放仍可使用。');
}

// ---- 图片粒子形态：上传图片 → 采样成点云 ----
function readShapeOptions() {
  try {
    const raw = JSON.parse(localStorage.getItem(SHAPE_OPTIONS_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

let shapeOptions = {
  density: 1,
  edge: 1,
  saturation: 1.18,
  background: 'auto',
  backgroundTolerance: 0.2,
  outlineOnly: false,
  keepLightBackground: true,
  ...readShapeOptions(),
};
let shapeTuneTimer = 0;

// 滑杆连动时重新采样有成本，做个 90ms 防抖
function applyShapeOptions(options) {
  shapeOptions = { ...shapeOptions, ...(options || {}) };
  clearTimeout(shapeTuneTimer);
  shapeTuneTimer = setTimeout(() => {
    scene?.setShapeOptions(shapeOptions);
    try {
      localStorage.setItem(SHAPE_OPTIONS_KEY, JSON.stringify(shapeOptions));
    } catch {
      /* ignore */
    }
  }, 90);
}

async function applyShapeImage(file) {
  if (!scene) return;
  try {
    const count = await scene.setShapeImage(file, shapeOptions);
    if (!count) {
      ui.showError('没有从这张图片里识别到可用的粒子，换一张对比度更高的试试。');
      return;
    }
    ui.setShapeHasImage(true);
    scene.setType('image');
    ui.setShape('image');
    writeStored(SHAPE_KEY, 'image');
    // 存一份压缩图（最长边 640），刷新后恢复；配额不足就算了
    try {
      const canvas = await imageToCanvas(file, 640);
      localStorage.setItem(SHAPE_IMAGE_KEY, canvas.toDataURL('image/jpeg', 0.82));
    } catch {
      /* 隐私模式 / 配额不足：不持久化图片 */
    }
  } catch {
    ui.showError('图片解析失败，换一张（PNG / JPG / WebP）试试。');
  }
}

async function applyShapeVideo(file) {
  if (!scene) return;
  ui.showLoading(true, '正在解析视频…');
  try {
    const count = await scene.setShapeVideo(file, shapeOptions);
    if (!count) {
      ui.showError('没有从视频里识别到可用的粒子，换一段对比度更高的视频试试。');
      return;
    }
    ui.setShapeHasImage(true);
    scene.setType('image');
    ui.setShape('image');
    writeStored(SHAPE_KEY, 'image');
    // 视频体积大，不写入 localStorage；刷新后需要重新上传
    try {
      localStorage.removeItem(SHAPE_IMAGE_KEY);
    } catch {
      /* ignore */
    }
    ui.showError('视频粒子已开启；视频不持久化，刷新后需要重新上传。');
  } catch {
    ui.showError('视频解析失败，换一段 MP4 / WebM / MOV 试试。');
  } finally {
    ui.showLoading(false);
  }
}

function clearShapeImage() {
  scene?.clearShapeImage();
  ui.setShapeHasImage(false);
  ui.setShape('wave');
  writeStored(SHAPE_KEY, 'wave');
  try {
    localStorage.removeItem(SHAPE_IMAGE_KEY);
  } catch {
    /* ignore */
  }
}

// 恢复上次的形态（如果存储里有图片，先加载图片再切形态）
(async () => {
  if (!scene) return;
  let storedImage = '';
  try {
    storedImage = localStorage.getItem(SHAPE_IMAGE_KEY) || '';
  } catch {
    storedImage = '';
  }
  const savedShape = readStored(SHAPE_KEY, 'wave');
  ui.setShapeOptions(shapeOptions);
  scene.shapeOptions = { ...scene.shapeOptions, ...shapeOptions };
  if (storedImage) {
    try {
      const count = await scene.setShapeImage(storedImage, shapeOptions);
      if (count) ui.setShapeHasImage(true);
    } catch {
      /* 恢复失败就当没有图片 */
    }
  }
  const type = savedShape === 'image' && !scene.hasShapeImage ? 'wave' : savedShape;
  if (type && type !== 'wave') {
    scene.setType(type);
    ui.setShape(type);
  }
})();

const reduceMotion = typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
// 星云薄雾：两层极淡的主题色光晕，叠在粒子后面、CSS 渐变前面。
const sceneHost = document.querySelector('#scene');
const nebulaVeil = document.createElement('div');
nebulaVeil.setAttribute('aria-hidden', 'true');
nebulaVeil.className = 'nebula-veil';
sceneHost?.append(nebulaVeil);
const THEME_VEILS = {
  cosmic: ['rgba(139, 117, 255, 0.14)', 'rgba(77, 200, 255, 0.1)'],
  fire: ['rgba(255, 140, 80, 0.12)', 'rgba(255, 79, 52, 0.09)'],
  mono: ['rgba(160, 170, 190, 0.1)', 'rgba(214, 214, 214, 0.07)'],
};
function setNebulaTheme(theme) {
  const [a, b] = THEME_VEILS[theme] ?? THEME_VEILS.cosmic;
  nebulaVeil.style.setProperty('--veil-a', a);
  nebulaVeil.style.setProperty('--veil-b', b);
}
setNebulaTheme('cosmic');

// ---- 自定义氛围色彩：由圆形调色盘选出的颜色驱动整套配色 ----
// 与三个预设主题走同一条链路（粒子 / 太空装饰 / 星云薄雾 / 光标拖尾 / CSS 主题变量），
// 只是颜色来源换成了由单一颜色推导出的同色系三段渐变。
// 当前激活的预设主题（自定义色生效时仍记住它，取消自定义时用来回退）。
let currentTheme = 'cosmic';
let customThemeColor = initialCustomTheme.color;

/** rgba 字符串：把 HSL 三元组转成可直接塞进 CSS 的颜色。 */
function hsla(h, s, l, alpha) {
  const hue = (((Number(h) || 0) % 360) + 360) % 360;
  const sat = Math.min(100, Math.max(0, Number(s) || 0));
  const light = Math.min(100, Math.max(0, Number(l) || 0));
  const a = Math.min(1, Math.max(0, Number(alpha) || 0));
  return `hsla(${hue.toFixed(1)}, ${sat.toFixed(1)}%, ${light.toFixed(1)}%, ${a})`;
}

/** 基于一个颜色生成主题所需的所有派生色。非法颜色返回 null。 */
function deriveCustomTheme(hex) {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return null;
  const { h, s, l } = hexToHsl(normalized);
  return {
    hex: normalized,
    colors: [hslToHex(h, Math.min(100, s + 8), Math.min(94, l + 16)), normalized, hslToHex(h, Math.min(100, s + 6), Math.max(14, l - 14))],
    veil: [hsla(h, s, Math.min(92, l + 12), 0.16), hsla(h, s, Math.min(92, l + 4), 0.1)],
  };
}

/** 重新应用某个预设主题（取消自定义色时回退用）。 */
function applyPresetTheme(theme) {
  scene?.setTheme(theme);
  decor?.setTheme(theme);
  setNebulaTheme(theme);
  cursorTrail?.setColors(TRAIL_COLORS[theme] ?? TRAIL_COLORS.cosmic);
  document.documentElement.style.removeProperty('--accent');
  document.documentElement.style.removeProperty('--mint');
}

/** 把派生配色同步到各渲染层；传 null / 非法值时回到当前预设主题。 */
function applyCustomTheme(hex, { persist = true } = {}) {
  const theme = deriveCustomTheme(hex);
  if (!theme) {
    customThemeColor = null;
    applyPresetTheme(currentTheme);
    ui.setCustomTheme(null);
    if (persist) writeStored(CUSTOM_THEME_KEY, '');
    return false;
  }
  customThemeColor = theme.hex;
  const colors = theme.colors;
  scene?.setColors(colors);
  decor?.setColors(colors);
  cursorTrail?.setColors(colors);
  nebulaVeil.style.setProperty('--veil-a', theme.veil[0]);
  nebulaVeil.style.setProperty('--veil-b', theme.veil[1]);
  // 页面级主题变量跟着走，让强调色、按钮高亮等也一起变色。
  document.documentElement.style.setProperty('--accent', colors[0]);
  document.documentElement.style.setProperty('--mint', colors[1]);
  ui.handleThemePick(theme.hex);
  if (persist) writeStored(CUSTOM_THEME_KEY, theme.hex);
  return true;
}

// 光标星尘拖尾：主题色跟随氛围色彩切换。
const TRAIL_COLORS = {
  cosmic: ['#8b75ff', '#4dc8ff', '#f5dbff'],
  fire: ['#ff4f34', '#ffb347', '#fff2ce'],
  mono: ['#909090', '#d6d6d6', '#ffffff'],
};
let cursorTrail;
try {
  cursorTrail = createCursorTrail({ enabled: initialCursorTrailEnabled, style: initialCursorTrailStyle });
} catch {
  cursorTrail = null;
}
// 与上次保存的开关保持一致。注意系统开启「减少动态效果」时模块会返回 no-op
// （isEnabled() 恒为 false），此时把开关显示成关闭状态，避免 UI 与实际效果不一致。
setCursorTrailEnabled(cursorTrail ? cursorTrail.isEnabled() : false, { persist: false });

// ---- 鼠标光影颜色：方形调色盘（点击「鼠标光影」行的色块按钮展开）----
// 与氛围/歌词调色盘共用 createColorPalette；默认 shape='rect' 即方形调色盘。
const trailPalette = createColorPalette({
  ariaLabel: '鼠标光影颜色调色盘（点击或拖动选色）',
  // 没自定义过时，用当前主题的主色作为调色盘起点。
  color: initialTrailColor ?? TRAIL_COLORS[currentTheme]?.[0] ?? null,
  savedColors: [],
  maxColors: 8,
  onPick: (hex) => setCursorTrailColor(hex),
  onSavedColorsChange: () => {},
});
ui.mountTrailPalette(trailPalette);
// 恢复上次保存的光影自定义色（没有则跟随氛围主题）。
if (initialTrailColor) setCursorTrailColor(initialTrailColor, { persist: false });

/** 展开光影调色盘时，把组件颜色对齐当前状态（自定义色 / 当前主题主色）。 */
function syncTrailPalette() {
  if (!trailPalette?.el) return;
  const next = cursorTrailColor ?? TRAIL_COLORS[currentTheme]?.[0] ?? null;
  trailPalette.setColor(next);
}

// ---- 氛围色彩：圆形调色盘（点击主题旁的色轮按钮展开）----
// 与歌词颜色调色盘共用 createColorPalette，只是 shape='circle'。
const themePalette = createColorPalette({
  shape: 'circle',
  ariaLabel: '氛围色彩圆形调色盘（点击或拖动选色）',
  color: customThemeColor,
  savedColors: [],
  maxColors: 8,
  onPick: (hex) => applyCustomTheme(hex),
  onSavedColorsChange: () => {},
});
ui.mountThemePalette(themePalette);
// 恢复上次保存的自定义色（没有则保持预设主题）。
if (customThemeColor) applyCustomTheme(customThemeColor, { persist: false });

/** 展开调色盘浮层时把组件里的颜色对齐当前状态（自定义色 / 预设主题主色）。 */
function syncThemePalette() {
  if (!themePalette?.el) return;
  const next = customThemeColor ?? TRAIL_COLORS[currentTheme]?.[0] ?? null;
  themePalette.setColor(next);
}

// 氛围背景系统（雨/雷/海滩/图片）：默认 none，通过右侧「效果」栏或导航栏切换。
const ambience = createAmbience({ audio: true });

// ---- 静音开关（顶部喇叭）----
// 只做输出静音：不中断播放、不影响分析，粒子/歌词照常走；状态记在 localStorage。
const MUTE_STORAGE_KEY = 'sonora-muted';
const AMBIENCE_VOLUME = 0.6;
const muteButton = document.querySelector('[data-mute]');
let muted = false;
try {
  muted = localStorage.getItem(MUTE_STORAGE_KEY) === '1';
} catch {
  // 隐私模式下忽略
}

function applyMuted(next, { persist = true } = {}) {
  muted = Boolean(next);
  audio.setMuted(muted);
  ambience.setVolume(muted ? 0 : AMBIENCE_VOLUME);
  if (muteButton) {
    muteButton.classList.toggle('is-muted', muted);
    muteButton.setAttribute('aria-pressed', String(muted));
    muteButton.setAttribute('aria-label', muted ? '取消静音' : '静音');
    muteButton.title = muted ? '取消静音' : '静音 / 取消静音';
  }
  if (persist) {
    try {
      localStorage.setItem(MUTE_STORAGE_KEY, muted ? '1' : '0');
    } catch {
      // 忽略存储失败
    }
  }
  return muted;
}

if (muteButton) {
  muteButton.addEventListener('click', () => applyMuted(!muted));
  applyMuted(muted, { persist: false });
}
ambience.attach(document.body);

// 恢复上次的粒子开关与内置氛围场景（自定义图片/视频要等背景文件从 IndexedDB 读回后再恢复）。
setParticlesEnabled(initialParticlesEnabled, { persist: false });
if (initialAmbienceScene !== 'none' && initialAmbienceScene !== 'image') {
  ambience.setScene(initialAmbienceScene);
  ui.setAmbience(initialAmbienceScene);
}

// 背景系统：氛围场景 / 内置背景图库 / 本地自定义背景。
// 内置图库是脚本生成的抽象渐变图（public/backgrounds/*.jpg）；
// 自定义图片/视频存在 IndexedDB（单张），刷新后自动恢复；「默认」= 粒子宇宙背景。
const backgroundStore = createBackgroundStore();
const BACKGROUND_PRESET_KEY = 'sonora-background-preset';
let currentPreset = '';
let customBackground = null; // { file, name, thumbUrl }
let customThumbUrl = '';

function revokeCustomThumb() {
  if (!customThumbUrl) return;
  try {
    URL.revokeObjectURL(customThumbUrl);
  } catch (_e) {}
  customThumbUrl = '';
}

function setCustomBackground(file, name) {
  revokeCustomThumb();
  if (classifyBackgroundFile(file) === 'image') {
    try {
      customThumbUrl = URL.createObjectURL(file);
    } catch (_e) {
      customThumbUrl = '';
    }
  }
  customBackground = { file, name: name || file?.name || '自定义背景', thumbUrl: customThumbUrl };
}

// 切到内置场景 / 默认背景：清掉背景图预设，但保留「我的背景」文件供下次使用
function selectAmbienceScene(scene) {
  currentPreset = '';
  writeStored(BACKGROUND_PRESET_KEY, '');
  setAmbienceScene(scene);
  backgroundPicker?.sync();
}

function applyPresetBackground(id) {
  const item = findPreset(id);
  if (!item) return;
  currentPreset = id;
  writeStored(BACKGROUND_PRESET_KEY, id);
  writeStored(AMBIENCE_KEY, 'image');
  ambience.setScene('image', { imageUrl: presetUrl(item) });
  ui.setAmbience('image');
  ui.setBackgroundName(item.name);
  backgroundPicker?.sync();
}

async function applyBackgroundFile(file) {
  const kind = classifyBackgroundFile(file);
  if (!kind) {
    ui.showError('背景只支持图片或视频文件（如 jpg / png / mp4 / webm）。');
    return;
  }
  currentPreset = '';
  writeStored(BACKGROUND_PRESET_KEY, '');
  setCustomBackground(file, file.name);
  ambience.setScene('image', { file });
  ui.setAmbience('image');
  ui.setBackgroundName(file.name || (kind === 'video' ? '自定义视频' : '自定义图片'));
  writeStored(AMBIENCE_KEY, 'image');
  const saved = await backgroundStore.save(file);
  if (!saved) ui.showError('背景已应用，但本机浏览器没能保存，刷新后需要重新选择。');
  backgroundPicker?.sync();
}

async function clearBackground() {
  await backgroundStore.clear();
  currentPreset = '';
  writeStored(BACKGROUND_PRESET_KEY, '');
  revokeCustomThumb();
  customBackground = null;
  ambience.setScene('none');
  ui.setAmbience('none');
  ui.setBackgroundName('');
  writeStored(AMBIENCE_KEY, 'none');
  backgroundPicker?.sync();
}

const backgroundPicker = createBackgroundPicker({
  getScene: () => ambience.getScene(),
  getPreset: () => currentPreset,
  getCustom: () => customBackground,
  onScene: (scene) => {
    if (scene === 'image') {
      const saved = customBackground?.file;
      if (!saved) return;
      currentPreset = '';
      writeStored(BACKGROUND_PRESET_KEY, '');
      ambience.setScene('image', { file: saved });
      ui.setAmbience('image');
      ui.setBackgroundName(customBackground.name);
      writeStored(AMBIENCE_KEY, 'image');
      return;
    }
    selectAmbienceScene(scene);
  },
  onPreset: (id) => applyPresetBackground(id),
  onUpload: (file) => applyBackgroundFile(file),
  onClear: () => clearBackground(),
});
backgroundPicker.attach(document.body);

// 恢复上次的背景：优先内置图，其次自定义图；「我的背景」无论当前场景都保留在面板里
(async () => {
  const saved = await backgroundStore.load();
  if (saved?.file) setCustomBackground(saved.file, saved.name);
  const preset = findPreset(readStored(BACKGROUND_PRESET_KEY, ''));
  if (initialAmbienceScene !== 'image') {
    backgroundPicker.sync();
    return;
  }
  if (preset) {
    applyPresetBackground(preset.id);
    return;
  }
  if (!saved?.file) {
    writeStored(AMBIENCE_KEY, 'none');
    ui.setAmbience('none');
    backgroundPicker.sync();
    return;
  }
  ambience.setScene('image', { file: saved.file });
  ui.setAmbience('image');
  ui.setBackgroundName(saved.name || '自定义背景');
  backgroundPicker.sync();
})();

// 专注模式：点导航栏「番茄钟」进入独立页面 —— 大号计时器 + 粒子音乐视觉同屏。
const focusView = document.createElement('section');
focusView.className = 'focus-view';
focusView.hidden = true;
focusView.setAttribute('aria-label', '专注模式');
focusView.innerHTML = `
  <div class="focus-backdrop" aria-hidden="true"></div>
  <header class="focus-header">
    <button type="button" class="focus-exit" aria-label="退出专注模式">← 返回</button>
    <div class="focus-heading"><strong>专注模式</strong><span>番茄钟 · 粒子声境</span></div>
    <span class="focus-hint">按 Esc 退出</span>
  </header>
  <div class="focus-main">
    <div class="focus-timer" data-focus-timer></div>
    <aside class="focus-side">
      <p class="focus-phrase" data-focus-phrase>让声音陪你专注，25 分钟后见。</p>
      <p class="focus-cheer" data-focus-cheer role="status" hidden></p>
      <p class="focus-stat focus-stat-total" data-study-total>今日总学习时长 <strong>0 分钟</strong></p>
      <p class="focus-stat" data-focus-stat>今日专注 0 分钟 · 0 个番茄</p>
      <p class="focus-streak" data-focus-streak>连续打卡 0 天 · 今日目标 0%</p>
      <div class="focus-goal" aria-hidden="true"><i data-focus-goal-fill></i></div>
      <p class="focus-track" data-focus-track>未载入音乐</p>
    </aside>
  </div>`;
document.body.append(focusView);
const focusTimerStage = focusView.querySelector('[data-focus-timer]');
const focusStatEl = focusView.querySelector('[data-focus-stat]');
const focusTrackEl = focusView.querySelector('[data-focus-track]');
const focusPhraseEl = focusView.querySelector('[data-focus-phrase]');
const focusCheerEl = focusView.querySelector('[data-focus-cheer]');
const focusStreakEl = focusView.querySelector('[data-focus-streak]');
const focusGoalFillEl = focusView.querySelector('[data-focus-goal-fill]');

// 今日专注统计（localStorage 持久化，见 src/study-stats.js）
const focusStatsEl = focusView.querySelector('[data-study-total]');
let focusStats = loadFocusStats(localStorage);
let focusHistory = loadFocusHistory(localStorage);
let studyPending = 0;
let studySaveAt = 0;
function renderFocusStat() {
  focusStatEl.textContent = `今日专注 ${focusStats.sessions} 个番茄`;
  if (focusStatsEl) {
    focusStatsEl.innerHTML = `今日总学习时长 <strong>${formatStudyDuration(focusStats.seconds)}</strong>`;
  }
  focusTrackEl.textContent = activeTrack?.title || activeTrack?.name || '未载入音乐';
  // 连续打卡 + 今日目标
  const streak = focusStreak(focusHistory, todayKey());
  const goal = dailyGoalProgress(focusStats.seconds);
  if (focusStreakEl) {
    focusStreakEl.textContent = goal.reached
      ? `连续打卡 ${streak.days} 天 · 今日目标已完成 🎉`
      : `连续打卡 ${streak.days} 天 · 今日目标 ${goal.percent}%`;
    focusStreakEl.classList.toggle('is-reached', goal.reached);
  }
  if (focusGoalFillEl) {
    focusGoalFillEl.style.width = `${goal.percent}%`;
    focusGoalFillEl.parentElement?.classList.toggle('is-reached', goal.reached);
  }
}

// 番茄钟运行中（工作 / 倒计时 / 正计时）按真实流逝秒数累计今日学习时长。
// 每帧由 animate() 调用，攒够整秒才写存储，避免每秒刷 localStorage。
function accumulateStudyTime(dt) {
  const p = pomodoro.getState();
  const studying = p.running && (p.mode !== 'pomodoro' || p.phase === 'work');
  if (!studying) {
    studyPending = 0;
    return;
  }
  studyPending += dt;
  if (studyPending < 1) return;
  const whole = Math.floor(studyPending);
  studyPending -= whole;
  // 跨天：先把昨天的秒数写进历史，再把今日统计归零
  const today = todayKey();
  if (focusStats.date !== today) {
    focusHistory = recordFocusDay(focusHistory, focusStats.date, focusStats.seconds);
    saveFocusHistory(localStorage, focusHistory);
    focusStats = loadFocusStats(localStorage);
  }
  focusStats = addStudySeconds(focusStats, whole);
  const nowMs = Date.now();
  if (nowMs - studySaveAt > 4000) {
    studySaveAt = nowMs;
    saveFocusStats(localStorage, focusStats);
    focusHistory = recordFocusDay(focusHistory, todayKey(), focusStats.seconds);
    saveFocusHistory(localStorage, focusHistory);
    if (focusOpen) renderFocusStat();
  }
}

// ---- 专注鼓励：每 3 分钟给一句话，阶段完成时给一句总结 ----
let cheerState = { bucket: -1, phase: null, maxElapsed: 0 };
let cheerHideTimer = null;

function showCheer(text, tone = 'cheer') {
  if (!focusCheerEl || !text) return;
  focusCheerEl.hidden = false;
  focusCheerEl.textContent = text;
  focusCheerEl.dataset.tone = tone;
  focusView.classList.remove('is-cheering');
  void focusView.offsetWidth;
  focusView.classList.add('is-cheering');
  if (cheerHideTimer) clearTimeout(cheerHideTimer);
  cheerHideTimer = setTimeout(() => focusView.classList.remove('is-cheering'), 1800);
}

function resetCheerSession() {
  cheerState = { bucket: -1, phase: null, maxElapsed: 0 };
}

function updateEncouragement() {
  if (!focusOpen) return;
  const p = pomodoro.getState();
  const isWork = p.mode !== 'pomodoro' || p.phase === 'work';
  if (!p.running || !isWork) return;
  const elapsedSeconds = p.mode === 'stopwatch' ? p.remainingMs / 1000 : (p.totalMs - p.remainingMs) / 1000;
  if (elapsedSeconds + 2 < cheerState.maxElapsed) resetCheerSession();
  cheerState.maxElapsed = Math.max(cheerState.maxElapsed, elapsedSeconds);
  const bucket = Math.floor(elapsedSeconds / CHEER_INTERVAL_SECONDS);
  if (bucket > cheerState.bucket && bucket >= 1) {
    cheerState.bucket = bucket;
    const cheer = encouragementFor(elapsedSeconds);
    if (cheer) showCheer(cheer.text);
  }
  cheerState.phase = p.phase;
}

// 阶段完成的柔和提示音（WebAudio 合成，无外部资源）
let chimeContext = null;
function playFocusChime(kind = 'work') {
  try {
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctx) return;
    chimeContext ||= new Ctx();
    const ctx = chimeContext;
    const notes = kind === 'work' ? [659.25, 880, 1318.5] : [880, 659.25, 440];
    const now = ctx.currentTime;
    notes.forEach((frequency, index) => {
      const at = now + index * 0.18;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.linearRampToValueAtTime(0.11, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.65);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.7);
    });
  } catch { /* 音频不可用时静默 */ }
}

const pomodoro = createPomodoro({
  work: 25,
  rest: 5,
  onPhaseComplete: ({ phase }) => {
    playFocusChime(phase === 'work' ? 'rest' : 'work');
    if (phase === 'work') {
      focusStats = addCompletedSession(focusStats);
      saveFocusStats(localStorage, focusStats);
      renderFocusStat();
    }
    focusPhraseEl.textContent = phase === 'work'
      ? '专注完成，起身活动一下，喝口水。'
      : '休息结束，回来继续吧。';
    if (phase === 'work') {
      showCheer(COMPLETE_CHEER, 'complete');
    } else {
      showCheer('休息结束，回来继续吧。你刚才做得很好。', 'cheer');
    }
    resetCheerSession();
  },
});

// 桌宠：可以换内置吉祥物，也可以上传自己的图片 / GIF；选择记在 localStorage。
const MASCOT_KEY = 'sonora-mascot';
let mascotState = { id: 'dafeiyu', src: DEFAULT_MASCOT_SRC, name: '大肥鱼', states: null };
// 内置桌宠 + 从 public/mascot/packs.json 加载的扩展角色包（多状态 GIF / 图片）
let mascotPacks = MASCOT_OPTIONS.slice();

async function loadMascotPacks() {
  try {
    const res = await fetch(new URL('mascot/packs.json', document.baseURI));
    if (!res.ok) return;
    const data = await res.json();
    const extras = Array.isArray(data?.packs) ? data.packs : [];
    for (const pack of extras) {
      if (!pack?.id || !pack?.name || !pack?.states) continue;
      if (mascotPacks.some((entry) => entry.id === pack.id)) continue;
      const states = pack.states;
      const src = states.idle || pack.thumb || Object.values(states)[0];
      if (!src) continue;
      mascotPacks.push({ id: pack.id, name: pack.name, desc: pack.desc || '', src, states });
    }
    focusChoices?.sync();
  } catch {
    /* 没有 packs.json / 离线时忽略 */
  }
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('读取失败'));
    reader.readAsDataURL(file);
  });
}

function applyMascot(src, id, name, states, { persist = true } = {}) {
  mascotState = {
    id: id || 'custom',
    src: src || '',
    name: name || '桌宠',
    states: states && typeof states === 'object' ? states : null,
  };
  pomodoro.setMascot(mascotState.src, mascotState.states);
  focusChoices?.sync();
  if (!persist) return;
  try {
    const payload = { id: mascotState.id, name: mascotState.name };
    // 内置桌宠只存 id；自定义图片存 dataURL（体积较大，存不下就只在本会话生效）
    if (mascotState.id === 'custom') payload.src = mascotState.src;
    localStorage.setItem(MASCOT_KEY, JSON.stringify(payload));
  } catch {
    ui.showError('桌宠已切换，但图片太大没能保存，刷新后会恢复默认桌宠。');
  }
}

async function applyMascotUpload(file) {
  if (!file) return;
  if (classifyBackgroundFile(file) !== 'image') {
    ui.showError('桌宠只支持图片（png / jpg / webp / gif）。');
    return;
  }
  if (file.size > 800 * 1024) {
    ui.showError('桌宠图片建议小于 800KB，否则可能存不进浏览器。');
    return;
  }
  try {
    const dataUrl = await readAsDataUrl(file);
    applyMascot(dataUrl, 'custom', file.name.replace(/\.[^.]+$/, '') || '自定义桌宠');
  } catch {
    ui.showError('读取图片失败，换一张试试。');
  }
}

function restoreMascot() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(MASCOT_KEY) || 'null');
  } catch {
    saved = null;
  }
  if (saved?.id === 'custom' && saved.src) {
    applyMascot(saved.src, 'custom', saved.name || '自定义桌宠', { persist: false });
    return;
  }
  const item = mascotPacks.find((entry) => entry.id === saved?.id) || findMascot(saved?.id);
  if (item) applyMascot(item.src, item.id, item.name, item.states, { persist: false });
}

// 专注模式的可选交互：计时模式 / 专注场景 / 本次标签 / 桌宠。
const focusChoices = createFocusChoices({
  pomodoro,
  getScene: () => ambience.getScene(),
  setScene: (scene) => {
    if (scene === 'image') ui.pickBackgroundFile();
    else selectAmbienceScene(scene);
  },
  onTag: (tag) => {
    focusPhraseEl.textContent = `本次专注标签：${tag.name}。`;
  },
  getMascots: () => mascotPacks,
  getPet: () => mascotState,
  onPet: (src, id, name, states) => applyMascot(src, id, name, states),
  onPetUpload: (file) => applyMascotUpload(file),
});

(async () => {
  await loadMascotPacks();
  restoreMascot();
})();

let focusOpen = false;
function enterFocusMode({ updateHash = true } = {}) {
  if (focusOpen) return;
  focusOpen = true;
  focusView.hidden = false;
  document.body.classList.add('focus-mode');
  // 把番茄钟移入专注页舞台（组件本身不销毁，计时状态延续）
  pomodoro.attach(focusTimerStage);
  const pomodoroCard = focusTimerStage.querySelector('.pomodoro');
  if (pomodoroCard) focusChoices.attach(pomodoroCard);
  focusChoices.sync();
  renderFocusStat();
  focusPhraseEl.textContent = '让声音陪你专注，25 分钟后见。';
  if (navbar) navbar.active = 'pomodoro';
  if (updateHash && location.hash !== '#focus') history.pushState(null, '', '#focus');
}
function exitFocusMode({ updateHash = true } = {}) {
  if (!focusOpen) return;
  focusOpen = false;
  focusView.hidden = true;
  document.body.classList.remove('focus-mode');
  if (navbar) navbar.active = '';
  if (updateHash && location.hash === '#focus') history.pushState(null, '', location.pathname + location.search);
}
focusView.querySelector('.focus-exit').addEventListener('click', () => exitFocusMode());
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && focusOpen) exitFocusMode();
});
window.addEventListener('popstate', () => {
  if (location.hash === '#focus') enterFocusMode({ updateHash: false });
  else exitFocusMode({ updateHash: false });
});

if (isDesktop()) {
  // 点「选择本地音频」时改用原生多选对话框（拿到真实本地路径）// 点「选择本地音频」时改用原生多选对话框（拿到真实本地路径）
  document.querySelector('[data-upload]')?.addEventListener(
    'click',
    async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        const payload = await window.sonoraDesktop.pickAudioFiles();
        const files = filesFromDesktopPayload(payload);
        if (files.length) await importFiles(files);
      } catch (error) {
        ui.showError(`选择文件失败：${error.message || error}`);
      }
    },
    true,
  );
}

// 顶部导航栏：曲库 / 氛围 / 歌词 / 番茄钟入口。
const navbar = createNavbar({
  items: [
    { id: 'library', label: '曲库' },
    { id: 'ambience', label: '氛围' },
    { id: 'lyrics', label: '歌词' },
    { id: 'qq', label: '在线音乐' },
    { id: 'pomodoro', label: '番茄钟' },
  ],
  variant: 'pill',
  visible: true,
  onSelect: (id) => {
    if (id === 'library') document.querySelector('.library-open')?.click();
    else if (id === 'qq') onlinePanel.open();
    else if (id === 'ambience') {
      // 导航栏「氛围」：打开背景与氛围选择器（场景 / 内置背景图 / 我的背景）
      backgroundPicker.open();
    }
    else if (id === 'lyrics') {
      // 打开歌词面板（粘贴 / 导入 / 示例）
      lyricsPanel.open();
    }
    else if (id === 'pomodoro') {
      enterFocusMode();
    }
  },
});
navbar.attach(document.body);

// 直接打开 #focus 链接时进入专注模式（等 navbar 初始化完成再进，避免访问未初始化的 navbar）
if (location.hash === '#focus') enterFocusMode({ updateHash: false });

let lastPunch = 0;
let lastTime = performance.now();
let frame;
const baseTitle = document.title;
let lastFocusTrack = '';

// 歌词显示设置（经典 / 3D 倾斜 + 左/中/右位置）：独立于粒子特效，记在 localStorage。
const LYRICS_DISPLAY_KEY = 'sonora-lyrics-display';
function loadLyricsDisplay() {
  try {
    const raw = JSON.parse(localStorage.getItem(LYRICS_DISPLAY_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}
function saveLyricsDisplay() {
  try {
    localStorage.setItem(
      LYRICS_DISPLAY_KEY,
      JSON.stringify({
        mode: lyricsOverlay.getMode(),
        position: lyricsOverlay.getPosition(),
        // 字号三档：small（小肥鱼）/ medium（肥鱼）/ large（大肥鱼）
        size: lyricsOverlay.getSize(),
      }),
    );
  } catch {
    // 隐私模式 / 配额不足时忽略，显示设置不持久化也不影响播放
  }
}

// 聊天歌词身份：TA / 我 的名字与头像（dataURL，面板上传时压到 64×64）。
const CHAT_PROFILE_KEY = 'sonora-chat-profile';
function loadChatProfile() {
  try {
    const raw = JSON.parse(localStorage.getItem(CHAT_PROFILE_KEY) || '{}');
    return normalizeChatProfile(raw && typeof raw === 'object' ? raw : {});
  } catch {
    return normalizeChatProfile();
  }
}

// 歌词颜色设置：自定义颜色 + 多色保存（color=null 表示跟随曲风）。
const LYRICS_COLOR_KEY = 'sonora-lyrics-color';
function loadLyricsColor() {
  try {
    const raw = JSON.parse(localStorage.getItem(LYRICS_COLOR_KEY) || '{}');
    return {
      color: typeof raw?.color === 'string' ? raw.color : null,
      saved: Array.isArray(raw?.saved) ? raw.saved : [],
    };
  } catch {
    return { color: null, saved: [] };
  }
}
function saveLyricsColor(color, saved) {
  const previous = loadLyricsColor();
  writeStored(
    LYRICS_COLOR_KEY,
    JSON.stringify({
      color: color ?? null,
      saved: Array.isArray(saved) ? saved : previous.saved,
    }),
  );
}

// 歌词系统：挂到 body，显示在粒子层之上；当前行进度驱动粒子聚拢。
const savedLyricsDisplay = loadLyricsDisplay();
const savedLyricsColor = loadLyricsColor();
let chatProfile = loadChatProfile();
const lyricsOverlay = createLyricsOverlay({
  containerClass: 'lyrics-overlay',
  mode: savedLyricsDisplay.mode,
  position: savedLyricsDisplay.position,
  // 字号三档（小肥鱼 / 肥鱼 / 大肥鱼），未知值自动回退 medium。
  size: savedLyricsDisplay.size,
  color: savedLyricsColor.color,
  onLineChange: (line) => {
    scene?.setLyricFocus(line ? line.progress : 0, Boolean(line));
  },
});
lyricsOverlay.attach(document.body);
lyricsOverlay.setChatProfile?.(chatProfile);

// 歌词面板：粘贴 / 导入 .lrc / 载入示例 / 显示模式·位置·颜色，导航栏「歌词」打开。
const lyricsPanel = createLyricsPanel({
  mode: lyricsOverlay.getMode(),
  position: lyricsOverlay.getPosition(),
  size: lyricsOverlay.getSize(),
  color: savedLyricsColor.color,
  savedColors: savedLyricsColor.saved,
  chatProfile,
  onChatProfileChange: (profile) => {
    chatProfile = normalizeChatProfile(profile);
    lyricsOverlay.setChatProfile?.(chatProfile);
    writeStored(CHAT_PROFILE_KEY, JSON.stringify(chatProfile));
  },
  onModeChange: (mode) => {
    lyricsOverlay.setMode(mode);
    saveLyricsDisplay();
  },
  onPositionChange: (position) => {
    lyricsOverlay.setPosition(position);
    saveLyricsDisplay();
  },
  onSizeChange: (size) => {
    lyricsOverlay.setSize(size);
    saveLyricsDisplay();
    freeMascot?.setMenuState?.({ size });
  },
  // 「逃出升天」：把大肥鱼放出来成为独立桌宠，同时收起歌词面板让出空间。
  onEscape: () => {
    lyricsPanel.close();
    freeMascot?.open?.();
  },
  onColorChange: (color) => {
    lyricsOverlay.setColor(color);
    saveLyricsColor(lyricsOverlay.getColor());
  },
  onSavedColorsChange: (saved) => {
    saveLyricsColor(lyricsOverlay.getColor(), saved);
  },
  onApply: (text) => {
    if (typeof text === 'string' && text.trim()) {
      lyricsOverlay.setEnabled(true);
      lyricsOverlay.setLyrics(text);
    } else {
      // 清空后回退到内置示例，避免又回到"没有歌词"
      lyricsOverlay.setEnabled(true);
      lyricsOverlay.setDemo?.();
    }
  },
});
lyricsPanel.attach(document.body);

// ---- 「逃出升天」桌宠：从歌词面板放出来，在桌面上自由活动 ----
// 右键菜单直接调歌词的基础功能（字号 / 位置 / 颜色），并支持收回面板。
// 桌宠被拖到哪儿，下次再放出来就还在那儿（存 localStorage）。
const FREE_MASCOT_POS_KEY = 'sonora-free-mascot-pos';

function readFreeMascotPos() {
  try {
    const raw = JSON.parse(localStorage.getItem(FREE_MASCOT_POS_KEY) || 'null');
    if (raw && Number.isFinite(raw.x) && Number.isFinite(raw.y)) {
      return { x: raw.x, y: raw.y };
    }
  } catch {
    /* 隐私模式 / 数据损坏：用默认位置 */
  }
  return null;
}

function saveFreeMascotPos(pos) {
  if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return;
  try {
    localStorage.setItem(FREE_MASCOT_POS_KEY, JSON.stringify({ x: Math.round(pos.x), y: Math.round(pos.y) }));
  } catch {
    /* 配额不足忽略 */
  }
}

let freeMascot = null;
try {
  const savedPos = readFreeMascotPos();
  freeMascot = createFreeMascot({
    document,
    src: 'mascot/dafeiyu-cut.png',
    name: '大肥鱼',
    // 恢复上次拖到的位置（没有就用默认右下角）
    startX: savedPos?.x,
    startY: savedPos?.y,
    onColorPick: (color) => {
      lyricsOverlay.setColor(color);
      lyricsPanel.setColor(color);
      lyricsPanel.setDisplay({});
      saveLyricsColor(lyricsOverlay.getColor());
      freeMascot?.setMenuState?.({ color });
    },
    onAction: (action, payload) => {
      if (action === 'size') {
        lyricsOverlay.setSize(payload);
        lyricsPanel.setDisplay({ size: payload });
        saveLyricsDisplay();
        freeMascot?.setMenuState?.({ size: payload });
        return;
      }
      if (action === 'position') {
        lyricsOverlay.setPosition(payload);
        lyricsPanel.setDisplay({ position: payload });
        saveLyricsDisplay();
        freeMascot?.setMenuState?.({ position: payload });
        return;
      }
      if (action === 'reset-color') {
        lyricsOverlay.setColor(null);
        lyricsPanel.setColor(null);
        saveLyricsColor(lyricsOverlay.getColor());
        freeMascot?.setMenuState?.({ color: null });
        return;
      }
      if (action === 'move') {
        // 拖动结束后记住新位置，刷新/重新放出时还原
        saveFreeMascotPos(payload);
        return;
      }
      if (action === 'open-panel') {
        freeMascot?.close?.();
        lyricsPanel.open();
        return;
      }
      if (action === 'recall') {
        freeMascot?.close?.();
        lyricsPanel.open();
      }
    },
  });
  freeMascot.el && document.body.append(freeMascot.el);
  freeMascot.setMenuState?.({
    size: lyricsOverlay.getSize(),
    position: lyricsOverlay.getPosition(),
    mode: lyricsOverlay.getMode(),
    color: lyricsOverlay.getColor(),
  });
} catch (error) {
  // 桌宠只是锦上添花，失败不影响主流程
  console.warn('桌宠初始化失败', error);
  freeMascot = null;
}

// 传入的歌词文本（优先：伴唱 .lrc/.txt 文件导入后缓存于曲目 id）。
const lyricCache = new Map();
// 歌词库：public/lyrics/ 下放 LRC + index.json，按歌名/别名/歌手自动匹配。
const lyricsLibrary = createLyricsLibrary({ baseUrl: 'lyrics/' });
const lyricsLibraryReady = lyricsLibrary.ready().catch(() => null);

// 后端在线时启用「歌词自动识别」：本地歌词库没命中，就调后端 /api/lyrics/search
// 抓取并缓存。必须等 chooseStorage() 探测完成后再设置 apiBase——之前把这段放在
// 模块顶部的初始化 IIFE 里，既早于 const lyricsLibrary 声明（TDZ 抛错），又早于
// 探测结果，apiBase 一直是空串，导致自动识别静默失效。
const lyricsApiReady = (async () => {
  await storageReady;
  if (storageMode !== 'server') return false;
  lyricsLibrary.setApiBase(API_BASE);
  return true;
})().catch(() => false);

/** 为某首歌曲决定显示哪份歌词：同批导入的 .lrc → 本地歌词库 → 后端自动抓取 → 内置示例。 */
async function applyLyricsForTrack(track) {
  if (!track) {
    lyricsOverlay.setDemo?.();
    return;
  }
  const stem = (track.name || '').replace(/\.[^.]+$/, '');
  const cached = lyricCache.get(stem) ?? lyricCache.get(stem.split(' - ').pop());
  if (cached) {
    lyricsOverlay.setLyrics(cached);
    return;
  }
  try {
    // 等本地歌词索引 + 后端探测结果都就绪，再决定走本地匹配还是在线自动识别。
    await Promise.all([lyricsLibraryReady, lyricsApiReady]);
    const resolved = await lyricsLibrary.resolve({
      id: track.id,
      title: track.title,
      name: track.name,
      artist: track.artist,
      duration: track.duration,
    });
    if (resolved?.text) {
      lyricsOverlay.setLyrics(resolved.text);
      return;
    }
  } catch {
    // 歌词库 / 后端不可用时静默回退
  }
  lyricsOverlay.setDemo?.();
}

// ---- 在线音乐：QQ 音乐 / 网易云音乐 / 酷狗音乐三个音源 ----
const PROVIDER_LABELS = { qq: 'QQ 音乐', netease: '网易云音乐', kugou: '酷狗音乐' };

async function playOnlineSong(song) {
  // 在用户手势内先恢复 AudioContext，避免异步拉流后自动播放被浏览器拦截
  try {
    const context = audio.ensureContext();
    context.resume?.();
  } catch {
    // 无 WebAudio 时交给后续错误提示
  }
  const provider = song.provider;
  const label = PROVIDER_LABELS[provider] || '在线音乐';
  const idParam = provider === 'qq' ? 'mid' : provider === 'netease' ? 'id' : 'hash';
  ui.showLoading(true, `正在加载：${song.name}`);
  try {
    const response = await fetch(`${API_BASE}/api/${provider}/stream?${idParam}=${encodeURIComponent(song.id)}`);
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `获取播放地址失败（${response.status}）`);
    }
    const blob = await response.blob();
    if (!blob.size) throw new Error('音频流为空，请重试。');
    const fileName = `${song.name}${song.singer ? ` - ${song.singer}` : ''}.mp3`;
    const file = new File([blob], fileName, { type: 'audio/mpeg' });
    audio.cancelPendingLoad();
    await audio.load(file);
    activeTrack = {
      id: `${provider}:${song.id}`,
      name: fileName,
      title: `${song.name}${song.singer ? ` - ${song.singer}` : ''}`,
      artist: song.singer || '',
      // 专辑封面地址（QQ 音乐由专辑 mid 推导，网易云直接取 picUrl）；取不到则为空。
      cover: song.cover || '',
      duration: audio.getState().duration,
      type: 'audio/mpeg',
    };
    scheduleBeatAnalysis(activeTrack);
    // 歌词：优先平台官方歌词，失败时回退到本地歌词库
    try {
      const params = new URLSearchParams({ [idParam]: song.id, name: song.name, artist: song.singer || '' });
      const lyricResponse = await fetch(`${API_BASE}/api/${provider}/lyric?${params.toString()}`);
      if (lyricResponse.ok) {
        const data = await lyricResponse.json();
        if (data?.text) {
          lyricCache.set(fileName.replace(/\.[^.]+$/, ''), data.text);
          lyricsOverlay.setLyrics(data.text);
        }
      }
    } catch {
      lyricsOverlay.setDemo?.();
    }
    if (!particlesEnabled) {
      setParticlesEnabled(true);
      ui.showError('粒子特效之前是关闭状态，已自动重新开启以便渲染。');
    }
    await audio.play();
    if (!audio.getState().playing) {
      throw new Error('音频已载入，但浏览器拦截了自动播放：请点播放器的播放按钮。');
    }
  } catch (error) {
    ui.showError(`${label}播放失败：${error.message || '未知错误'}`);
    throw error;
  } finally {
    ui.showLoading(false);
  }
}

const onlinePanel = createOnlinePanel({
  apiBase: API_BASE,
  onPlaySong: playOnlineSong,
  onPickLocalFile: () => {
    document.querySelector('[data-file]')?.click();
  },
});
onlinePanel.attach();

let lastStudyTick = 0;
function animate(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  const state = audio.getState();
  handleTrackEnd(state);
  const features = audio.sample(dt);
  // 只有律动样式需要每帧写能量变量，其它样式不触发额外样式计算
  if (lyricsOverlay.getMode?.() === 'pulse') lyricsOverlay.setAudioLevels?.(features);
  // time 透传给粒子：波形相位随播放时间走，seek 后平滑回退。
  // 粒子特效关闭时跳过粒子与太空装饰更新（省电、也不渲染），歌词/背景/UI 照常。
  // 节拍网格（分析+缓存）：给粒子提供精确的卡点包络，优先级高于频段起音
  const beatSample = beatGrid && state.loaded
    ? sampleBeat(beatGrid.beats, beatGrid.downbeats, state.currentTime)
    : null;
  const sceneFeatures = beatSample
    ? { ...features, beatImpact: beatSample.impact, downbeatImpact: beatSample.downbeat }
    : features;
  if (particlesEnabled) scene?.update(dt, { ...sceneFeatures, time: state.currentTime }, state.playing);
const lyricLine = lyricsOverlay.update(state.currentTime);
  // 加载了歌曲且有当前歌词时：压暗左侧介绍、给歌词垫暗底（暂停也保持，避免叠字）
  document.body.classList.toggle('lyrics-live', Boolean(state.loaded && lyricLine));
  document.body.classList.toggle('lyrics-playing', Boolean(state.loaded && state.playing && lyricLine));
  ambience.update(dt);
  // 今日总学习时长：用真实墙上时间累计（dt 被钳制过，低帧率时会少算）
  const studyDt = lastStudyTick ? Math.min(2, (now - lastStudyTick) / 1000) : 0;
  lastStudyTick = now;
  accumulateStudyTime(studyDt);
  // 专注模式：标题栏显示倒计时，侧栏同步当前曲目
  if (focusOpen) {
    const p = pomodoro.getState();
    const title = `${p.remainingText} · ${p.label} · 声境`;
    if (document.title !== title) document.title = title;
    updateEncouragement();
    const trackName = activeTrack?.title || activeTrack?.name || '未载入音乐';
    if (trackName !== lastFocusTrack) {
      lastFocusTrack = trackName;
      focusTrackEl.textContent = trackName;
    }
  } else if (document.title !== baseTitle) {
    document.title = baseTitle;
  }
  if (particlesEnabled && decor) {
    decor.energy = Math.max(decor.energy * 0.98, Math.min(1, features.volume ?? 0));
    if (!reduceMotion && features.beat > .5 && lastPunch <= .5) decor.pulse();
    lastPunch = features.beat ?? 0;
    decor.update(dt);
  }
  ui.update(
    {
      ...state,
      displayName: displayNameFor(state),
      fullName: activeTrack?.name || state.name,
      artist: activeTrack?.artist || '',
      // 在线音乐有专辑封面时传给播放器显示；本地文件没有封面则回退首字。
      cover: activeTrack?.cover || '',
      liked: Boolean(activeTrack?.id && favoriteIds.has(activeTrack.id)),
      repeatMode,
      shuffle: shuffleOn,
    },
    features,
  );
  frame = requestAnimationFrame(animate);
}
frame = requestAnimationFrame(animate);
const resize = () => {
  scene?.resize();
  if (scene && decor) decor.setPixelRatio(scene.renderer.getPixelRatio());
};
window.addEventListener('resize', resize);
window.addEventListener('pagehide', (event) => {
  if (event.persisted) return;
  cancelAnimationFrame(frame);
  window.removeEventListener('resize', resize);
  saveFocusStats(localStorage, focusStats);
  cursorTrail?.dispose();
  themePalette?.dispose();
  trailPalette?.dispose();
  lyricsOverlay.dispose();
  lyricsPanel.dispose();
  freeMascot?.dispose?.();
  onlinePanel.dispose();
  ambience.dispose();
  focusChoices.dispose();
  pomodoro.dispose();
  navbar.dispose();
  libraryUI.dispose();
  library.close();
  ui.dispose();
  decor?.dispose();
  scene?.dispose();
  audio.dispose();
});

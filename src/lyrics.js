// 歌词系统：LRC 解析、曲风分类、内置示例歌词、歌词渲染组件（SONORA 声境）。
// 纯函数在前（Node 下可直接测试），DOM 组件在后（组件支持 options.document 注入，
// 也守卫 typeof document —— Node 下只走数据路径，不触碰 DOM）。
// 组件通过 onLineChange 把“当前行信息”交给 Lead，驱动粒子引擎的歌词聚拢（setLyricFocus）。
// 没有用户歌词时组件默认载入 DEMO_LYRICS，保证“打开页面就有歌词可看”。

import { gradientFromColor, normalizeHexColor } from './color-palette.js';
import { getLyricStyle, hasLyricStyle, lyricStyleTable } from './lyrics-styles.js';
import { attachWordTimings, parseLyricsWithWords, wordProgressAt } from './lyrics-words.js';

const CHAT_PROFILE_DEFAULT = { taName: 'TA', meName: '我', taAvatar: '', meAvatar: '', bias: 'random' };

/** 归一化聊天身份：名字最多 8 个字符，头像只接受 data:image 或空。 */
export function normalizeChatProfile(profile = {}) {
  const cleanName = (value, fallback) => {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    return (text || fallback).slice(0, 8);
  };
  const cleanAvatar = (value) => {
    const text = String(value ?? '').trim();
    return /^data:image\//i.test(text) && text.length < 400000 ? text : '';
  };
  const bias = ['random', 'even', 'ta', 'me'].includes(profile.bias) ? profile.bias : 'random';
  return {
    taName: cleanName(profile.taName, CHAT_PROFILE_DEFAULT.taName),
    meName: cleanName(profile.meName, CHAT_PROFILE_DEFAULT.meName),
    taAvatar: cleanAvatar(profile.taAvatar),
    meAvatar: cleanAvatar(profile.meAvatar),
    bias,
  };
}


// 时间标签：分钟 1-3 位，秒 1-2 位，小数 1-3 位（网易云会返回 [00:29.190] 这种毫秒精度）。
const TIME_TAG_SOURCE = '(\\d{1,3}):(\\d{1,2})(?:\\.(\\d{1,3}))?';
const TIME_TAG = new RegExp(`\\[${TIME_TAG_SOURCE}\\]`, 'g'); // 提取时间标签
const TIME_TAG_STRIP = new RegExp(`\\[${TIME_TAG_SOURCE}\\]`, 'g'); // 从行内容中剥离时间标签
const META_TAG = /^\[([a-z]+):([^\]]*)\]$/i; // 整行元数据标签
const META_KEYS = ['ti', 'ar', 'al', 'by', 'offset', 're', 've', 'length'];

// 曲风关键词：每个词命中一次计 1 分（“命中数加权”）。
const MOOD_KEYWORDS = {
  sad: ['难过', '眼泪', '泪', '离开', '再见', '孤独', '思念', '寂寞', '忘记', '心痛', '夜晚', '雨', '哭', '悲伤', '遗憾', '回忆', '等待', '离别', '怀念', '凋零', '落叶', 'lonely', 'cry', 'tear', 'rain'],
  epic: ['燃烧', '呐喊', '梦想', '热血', '飞翔', '战斗', '命运', '光芒', '力量', '奔跑', '狂', '勇敢', '崛起', '爆发', '自由', '守护', '征途', '荣耀', '疯狂', '梦', 'dream', 'fight', 'fire', 'brave', 'run'],
  calm: ['月光', '微风', '宁静', '温柔', '缓缓', '呼吸', '微笑', '晚安', '星空', '云', '海', '清晨', '安静', '星光', '涟漪', '午后', '柔', '轻', 'calm', 'moon', 'soft', 'peace'],
};
// 标点信号也会参与加权：感叹号偏激昂，省略号/问号偏忧伤。
const PUNCTUATION_SIGNALS = [
  { mood: 'epic', pattern: /[！!]/g, weight: 1 },
  { mood: 'sad', pattern: /…|\.{3,}/g, weight: 1 },
  { mood: 'sad', pattern: /[？?]/g, weight: 0.5 },
];

/**
 * 解析 LRC 文本。
 * 支持 [mm:ss.xx] 与 [mm:ss] 两种时间标签、一行多个时间标签（展开成多条）、
 * [ti:][ar:][al:][offset:] 等元数据标签。
 * 非法时间标签与无标签杂行会被忽略，不抛错；结果按时间升序排序。
 * 当文本中存在元数据标签时，每条歌词都挂一个共享的 meta 对象（与歌词顺序无关）。
 * @param {string} text
 * @returns {Array<{time: number, text: string, meta?: object}>}
 */
export function parseLRC(text) {
  if (typeof text !== 'string' || !text) return [];
  const lines = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const meta = {};
  const out = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const times = [];
    let match;
    TIME_TAG.lastIndex = 0;
    while ((match = TIME_TAG.exec(line)) !== null) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      if (seconds > 59) continue; // 秒数越界视为非法标签
      // 小数位数可能是 1~3 位（.5 / .19 / .190），统一按十进制换算
      const fraction = match[3] ? Number(`0.${match[3]}`) : 0;
      times.push(minutes * 60 + seconds + fraction);
    }
    if (times.length > 0) {
      const content = line.replace(TIME_TAG_STRIP, '').trim();
      for (const time of times) out.push({ time, text: content });
      continue;
    }
    const metaMatch = line.match(META_TAG);
    if (metaMatch && META_KEYS.includes(metaMatch[1].toLowerCase())) {
      const key = metaMatch[1].toLowerCase();
      const value = metaMatch[2].trim();
      meta[key] = key === 'offset' ? (parseInt(value, 10) || 0) : value;
      continue;
    }
    // 无有效时间标签的普通行：过滤（容错，不抛错）。
  }
  out.sort((a, b) => a.time - b.time);
  if (Object.keys(meta).length > 0) {
    for (const entry of out) entry.meta = meta;
  }
  return out;
}

/**
 * 秒数格式化为 LRC 时间标签 'mm:ss.xx'（与 parseLRC 互逆）。
 * @param {number} seconds
 * @returns {string}
 */
export function formatLRCTime(seconds) {
  if (!Number.isFinite(seconds)) return '00:00.00';
  const total = Math.max(0, Math.round(seconds * 100));
  const minutes = Math.floor(total / 6000);
  const secs = Math.floor((total % 6000) / 100);
  const cs = total % 100;
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

// 内置示例歌词：原创中文 LRC（主题：声境 / 星空 / 夜），27 行，时间轴 00:00.00 → 02:23.00。
// 用户没有导入歌词时，overlay 默认载入它 —— 打开页面就能看到歌词在画面中央流动，
// 而不是等一个永远不存在的同名 .lrc 文件。
export const DEMO_LYRICS = `[ti:星海回声]
[ar:SONORA 声境]
[al:夜航手记]
[by:内置示例]
[00:00.00]夜色缓缓落下
[00:05.50]像一层温柔的纱
[00:11.00]星光在指尖融化
[00:16.50]我把呼吸放慢
[00:22.00]风穿过安静的窗
[00:27.50]捎来远方的回答
[00:33.00]每一次心跳落下
[00:38.50]都点亮一颗星啊
[00:44.00]沿着月光的曲线
[00:49.50]驶向没有名字的海
[00:55.00]那里云很低
[01:00.50]梦很轻
[01:06.00]时间也停下来
[01:11.50]让声音有了形状
[01:17.00]在你的眼里盛开
[01:22.50]星海在回声里
[01:28.00]慢慢铺开
[01:33.50]我们不必说话
[01:39.00]让夜替我们表达
[01:44.50]所有未说出口的
[01:50.00]都化作微光落下
[01:55.50]如果黎明太远
[02:01.00]就再听一会儿吧
[02:06.50]风会替我记得
[02:12.00]这一夜的星光
[02:17.50]晚安，声境
[02:23.00]晚安，还未睡去的你`;

/**
 * 内置示例歌词的解析结果（每次调用返回新数组，调用方可安全修改）。
 * @returns {Array<{time: number, text: string, meta?: object}>}
 */
export function demoLyricLines() {
  return parseLRC(DEMO_LYRICS);
}

/**
 * 保证任意粘贴/导入的文本都能被歌词层显示。
 * - 已经是合法 LRC（至少有一行带 [mm:ss.xx] 时间标签）→ 原样返回；
 * - 纯文本 → 丢弃空行与元数据行，按固定间隔（默认 4 秒）自动补 [mm:ss.xx] 时间轴；
 * - 空文本 → 返回 ''（调用方据此清空歌词）。
 * 这样用户即使只粘贴一段没有时间轴的歌词，也能立刻看到逐行推进的效果。
 * @param {string} text
 * @param {{interval?: number}} [options]
 * @returns {string}
 */
export function ensureTimedLyrics(text, options = {}) {
  const source = typeof text === 'string' ? text : '';
  if (!source.trim()) return '';
  if (parseLRC(source).length > 0) return source;
  const requested = Number(options.interval);
  const interval = Number.isFinite(requested) && requested > 0 ? requested : 4;
  const lines = source
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      // 纯文本里残留的 [ti:...] 之类元数据不当作歌词行显示。
      const metaMatch = line.match(META_TAG);
      if (metaMatch && META_KEYS.includes(metaMatch[1].toLowerCase())) return false;
      return !/^\[[a-z]+:[^\]]*\]$/i.test(line);
    });
  if (lines.length === 0) return '';
  return lines.map((line, index) => `[${formatLRCTime(index * interval)}]${line}`).join('\n');
}

/**
 * 曲风启发式分类：按关键词 + 标点信号统计命中数，取加权得分最大者。
 * 并列时按优先级 sad > epic > calm 取舍；完全无命中默认 'calm'。
 * @param {string} text
 * @returns {'calm' | 'epic' | 'sad'}
 */
export function classifyLyrics(text) {
  const source = String(text ?? '').toLowerCase();
  const scores = { calm: 0, epic: 0, sad: 0 };
  for (const mood of Object.keys(MOOD_KEYWORDS)) {
    for (const keyword of MOOD_KEYWORDS[mood]) {
      const count = source.split(keyword).length - 1;
      if (count > 0) scores[mood] += count;
    }
  }
  for (const signal of PUNCTUATION_SIGNALS) {
    const count = (source.match(signal.pattern) || []).length;
    if (count > 0) scores[signal.mood] += count * signal.weight;
  }
  // 完全无命中：默认舒缓。
  if (scores.calm + scores.epic + scores.sad <= 0) return 'calm';
  let best = 'calm';
  let bestScore = scores.calm;
  for (const mood of ['epic', 'sad']) {
    // >= 让并列时后出现的曲风取胜：sad > epic > calm。
    if (scores[mood] >= bestScore) {
      best = mood;
      bestScore = scores[mood];
    }
  }
  return best;
}

/**
 * 三套曲风显示风格：每项定义字体栈 font、文字渐变 gradient（background-image 值）、
 * 背景叠加 background（低透明度渐变，叠在歌词区后方不干扰粒子）、
 * 文字动效 class effect（配合歌词 CSS 的关键帧动画）、光效主色 accent，
 * 以及排版质感 weight（字重）/ tracking（字距，CSS 里配合“字距呼吸”关键帧微调）。
 * 切换曲风时这五项一起通过 CSS 变量注入，字体/渐变/背景/动效/排版整套切换。
 */
export const MOOD_STYLES = {
  calm: {
    font: '"Noto Serif SC", "Songti SC", "SimSun", serif',
    gradient: 'linear-gradient(115deg, #f4f8ff 0%, #c3dcff 52%, #8fd0f2 100%)',
    background: 'radial-gradient(58% 90% at 50% 42%, rgba(140, 190, 255, 0.16), transparent 72%)',
    effect: 'lyrics-motion-glow',
    accent: '#a8dcff',
    weight: 600,
    tracking: '0.08em',
  },
  epic: {
    font: '"Noto Sans SC", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif',
    gradient: 'linear-gradient(115deg, #fff3d6 0%, #ffd19c 28%, #ff9e6d 60%, #c9b3ff 100%)',
    background: 'radial-gradient(64% 92% at 50% 44%, rgba(255, 170, 96, 0.15), transparent 74%)',
    effect: 'lyrics-motion-pulse',
    accent: '#ffc489',
    weight: 800,
    tracking: '0.12em',
  },
  sad: {
    font: '"Noto Serif SC", "KaiTi", "STKaiti", "SimSun", serif',
    gradient: 'linear-gradient(115deg, #e6ecff 0%, #b3c2e6 55%, #8f9cc4 100%)',
    background: 'radial-gradient(60% 90% at 50% 44%, rgba(122, 143, 214, 0.16), transparent 74%)',
    effect: 'lyrics-motion-blur',
    accent: '#b6c4e8',
    weight: 500,
    tracking: '0.16em',
  },
};

/**
 * 歌词显示模式（独立于粒子特效，只影响歌词层）：
 * - classic：经典 Folia 风格，平面逐行推进；
 * - tilt3d：3D 倾斜，歌词层带透视纵深，当前行前移、前后行后退，形成倾斜歌词墙。
 * label / description 供歌词面板直接渲染选项。
 */
// 模式表来自样式注册表：加一个新样式只要 registerLyricStyle()，面板会自动出现。
export const LYRIC_MODES = lyricStyleTable();

/** 歌词位置：左 / 中 / 右（经典与 3D 倾斜两种模式都生效）。 */
export const LYRIC_POSITIONS = {
  left: { label: '居左', description: '歌词靠左，右侧留给粒子画面' },
  center: { label: '居中', description: '歌词居中，画面左右平衡' },
  right: { label: '居右', description: '歌词靠右，左侧留给粒子画面' },
};

/**
 * 歌词字号三档（对应大肥鱼体型）：小肥鱼 / 肥鱼 / 大肥鱼。
 * scale 会写进 --lyrics-scale，经典与 3D 倾斜两种模式统一缩放。
 */
export const LYRIC_SIZES = {
  small: { label: '小肥鱼', scale: 0.82, description: '字号偏小，留白更多' },
  medium: { label: '肥鱼', scale: 1, description: '默认字号，大小均衡' },
  large: { label: '大肥鱼', scale: 1.22, description: '字号最大，适合远看' },
};

/** 归一化歌词显示模式：未知值回退 classic。 */
export function normalizeLyricMode(mode) {
  return hasLyricStyle(mode) ? mode : 'classic';
}

/** 归一化歌词位置：未知值回退 center。 */
export function normalizeLyricPosition(position) {
  return Object.hasOwn(LYRIC_POSITIONS, position) ? position : 'center';
}

/** 归一化歌词字号：未知值回退 medium（肥鱼）。 */
export function normalizeLyricSize(size) {
  return Object.hasOwn(LYRIC_SIZES, size) ? size : 'medium';
}

// ---------- 以下是 DOM 组件（浏览器环境）；纯函数测试到此为止 ----------

function buildOverlay(rootDocument, containerClass) {
  const overlay = rootDocument.createElement('div');
  overlay.className = `lyrics-overlay${containerClass ? ` ${containerClass}` : ''}`;
  overlay.setAttribute('aria-hidden', 'true');
  const backdrop = rootDocument.createElement('div');
  backdrop.className = 'lyrics-backdrop';
  backdrop.setAttribute('aria-hidden', 'true');
  const stage = rootDocument.createElement('div');
  stage.className = 'lyrics-stage';
  const list = rootDocument.createElement('ol');
  list.className = 'lyrics-list';
  stage.append(list);
  overlay.append(backdrop, stage);
  return overlay;
}

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);

function findActiveIndex(lines, t) {
  let low = 0;
  let high = lines.length - 1;
  let answer = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid].time <= t) {
      answer = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return answer;
}

function lineProgress(t, start, nextTime) {
  if (nextTime == null) {
    // 最后一行没有后一行作区间，用一个兜底窗口（不小于 8 秒）估算进度。
    const window = Math.max(8, start * 0.25);
    return clamp01((t - start) / window);
  }
  const span = nextTime - start;
  return span > 0 ? clamp01((t - start) / span) : 1;
}

// QQ 音乐官方歌词开头常带「词：/曲：/编曲：/制作人：…」制作名单。
// 只剔除开头连续的这类行，正文里的同类词不受影响。
// 关键词 + 最多 4 个字的后缀（师/工程/助理/编写/后期…），避免逐个枚举
const CREDIT_LINE = /^(作词|作曲|编曲|词|曲|制作人|出品人|出品|发行|监制|录音|混音|母带|吉他|贝斯|鼓|和声|合声|合音|弦乐|OP|SP|统筹|企划|封面|文案|宣发|配唱|人声|音频编辑|后期|音乐总监|版权|经纪|宣传|视觉|设计|导演|摄影|剪辑|字幕|翻译|校对|收录|专辑|单曲|演唱|原唱|翻唱|演奏|钢琴|小提琴|大提琴|长笛|萨克斯|合成器|编程|打击乐|制作|执行)[\u4e00-\u9fa5A-Za-z]{0,4}\s*[：:]/i;
// 部分 QQ 歌词第一行是「歌名 - 歌手 (英文名)」，同属制作信息，一并去掉（只限开头几秒）。
const TITLE_LINE = /^.+[ \t]+-[ \t]+.+/;
const TITLE_DROP_WINDOW = 3;

/**
 * 去掉版权/制作信息行（词：/曲：/编曲：/制作人：…）。
 * 只匹配“冒号紧跟在关键词后”的格式，正文里的“曲终人散”“词不达意”不受影响；
 * 不限开头是因为 QQ 官方歌词常在歌名行之后才列制作名单。
 */
export function stripLeadingCredits(lines) {
  const list = Array.isArray(lines) ? lines : [];
  return list.filter((line) => {
    const text = String(line?.text ?? '').trim();
    if (!text) return false;
    if (CREDIT_LINE.test(text)) return false;
    const time = Number(line?.time);
    // 开头几秒的「歌名 - 歌手」标题行
    if (Number.isFinite(time) && time <= TITLE_DROP_WINDOW && TITLE_LINE.test(text)) return false;
    return true;
  });
}
function normalizeLine(line) {
  const words = Array.isArray(line?.words)
    ? line.words
        .map((word) => ({ text: String(word?.text ?? ''), time: Number(word?.time), endTime: Number(word?.endTime) }))
        .filter((word) => word.text && Number.isFinite(word.time))
    : undefined;
  return {
    time: Number(line?.time),
    ...(Number.isFinite(line?.endTime) ? { endTime: Number(line.endTime) } : {}),
    text: String(line?.text ?? ''),
    ...(words?.length ? { words } : {}),
    ...(line?.meta ? { meta: line.meta } : {}),
  };
}

/**
 * 生成“显示行”（歌词层真正渲染的行）。
 * - classic：一行歌词一行，与 parseLRC 结果一一对应；
 * - tilt3d：相邻且时间戳相同（±0.05s）的两行合并为一行，第二行作为译文 ——
 *   这是双语 LRC 的常见写法，排版参考稿就是「主歌词 + 小字译文」上下排布。
 *   三行及以上同一时间戳时，后续行用空格拼进译文。
 * @param {Array<{time:number,text:string,meta?:object}>} lines
 * @param {string} [mode]
 * @returns {Array<{time:number,text:string,translation:string,meta?:object}>}
 */
export function buildLyricRows(lines, mode = 'classic') {
  const source = Array.isArray(lines) ? lines : [];
  const bilingual = normalizeLyricMode(mode) === 'tilt3d';
  const rows = [];
  for (const raw of source) {
    const line = normalizeLine(raw);
    const last = rows[rows.length - 1];
    if (bilingual && last && Math.abs(line.time - last.time) <= 0.05) {
      last.translation = last.translation ? `${last.translation}  ${line.text}` : line.text;
      continue;
    }
    rows.push({ ...line, translation: '' });
  }
  return rows;
}

/**
 * 歌词渲染组件。
 * @param {object} options
 * @param {(line: object|null) => void} [options.onLineChange] 当前行变化/进度回调
 * @param {string} [options.containerClass] 追加到歌词区根元素的额外 class
 * @param {Document} [options.document] 注入 document（Node 测试用）
 * @param {boolean} [options.demo=true] 是否在创建时默认载入内置示例歌词（保证一打开就有歌词可看）；
 *   传 false 可得到空歌词层，之后仍可用 setDemo() 手动载入
 * @param {string} [options.mode='classic'] 显示模式：'classic' | 'tilt3d'（3D 倾斜，独立于粒子特效）
 * @param {string} [options.position='center'] 歌词位置：'left' | 'center' | 'right'
 * @param {string|null} [options.color=null] 自定义歌词颜色（'#rrggbb'）；null 表示跟随曲风
 * @returns {{
 *   setLyrics(lines: Array|string): void,  // 歌词数组（parseLRC 结果）或原始 LRC 文本，自动分类曲风
 *   setDemo(): number,                     // 载入内置示例歌词，返回行数
 *   update(currentSeconds: number): object|null, // 推进到某秒：高亮 + 返回当前行信息并触发 onLineChange
 *   setMood(mood: string): void,           // 手动切换 MOOD_STYLES
 *   setMode(mode: string): void,           // 切换显示模式（classic / tilt3d）
 *   setPosition(position: string): void,   // 切换歌词位置（left / center / right）
 *   setColor(color: string|null): void,    // 自定义颜色覆盖曲风渐变 / accent；null 恢复跟随曲风
 *   setEnabled(enabled: boolean): void,    // 显示/隐藏歌词区
 *   attach(host?: Element|string): void,   // 挂载（默认 body）
 *   dispose(): void,                       // 移除与清理
 *   getMood(): string,                     // 当前生效曲风
 *   getMode(): string,                     // 当前显示模式
 *   getPosition(): string,                 // 当前歌词位置
 *   getColor(): string|null,               // 当前自定义颜色（null = 跟随曲风）
 * }}
 */
export function createLyricsOverlay(options = {}) {
  const rootDocument = options.document || (typeof document !== 'undefined' ? document : null);
  const onLineChange = typeof options.onLineChange === 'function' ? options.onLineChange : null;
  const containerClass = String(options.containerClass ?? '').trim();
  const demoEnabled = options.demo !== false;

  const overlay = rootDocument ? buildOverlay(rootDocument, containerClass) : null;
  const list = overlay ? overlay.querySelector('.lyrics-list') : null;

  const state = {
    chatBias: 'random',
    chatSides: [],
    lines: [],
    rows: [], // 显示行：tilt3d 下会把同时间戳的相邻两行合并成「主歌词 + 译文」
    mood: 'calm',
    mode: normalizeLyricMode(options.mode),
    position: normalizeLyricPosition(options.position),
    // 字号档位：small=小肥鱼 / medium=肥鱼 / large=大肥鱼
    size: normalizeLyricSize(options.size),
    color: normalizeHexColor(options.color), // 自定义歌词颜色；null = 跟随曲风
    tiltShift: 0, // 3D 倾斜模式下让当前行居中的纵向位移（行高不等时用实测值）
    enabled: true,
    currentIndex: -1,
    lastEmitted: undefined, // undefined | null | 上一个回调行对象
    attached: false,
    disposed: false,
  };

  // 位置 / 模式除了落在歌词根节点上，还同步到 body 上的提示 class：
  // 选左侧时左侧介绍文案会淡出，避免与歌词叠在一起（纯视觉配合，不改布局）。
  function syncBodyHints() {
    const body = rootDocument?.body;
    if (!body?.classList) return;
    body.classList.toggle('lyrics-mode-tilt3d', state.mode === 'tilt3d');
    body.classList.toggle('lyrics-position-left', state.position === 'left');
    body.classList.toggle('lyrics-position-right', state.position === 'right');
  }

  if (overlay) {
    overlay.dataset.mode = state.mode;
    overlay.dataset.position = state.position;
    // 字号档位：首帧就挂上，避免加载瞬间字号跳一下。
    overlay.dataset.size = state.size;
    overlay.style.setProperty('--lyrics-scale', String(LYRIC_SIZES[state.size]?.scale ?? 1));
    syncBodyHints();
    // options.color：即使还没载入歌词（demo:false），也先把颜色变量挂上，避免首帧闪默认色。
    if (state.color) applyCustomColor();
  }

  function refreshActiveEffect() {
    if (!overlay) return;
    const active = overlay.querySelector('.lyrics-line.lyrics-active');
    if (!active) return;
    for (const effectClass of new Set(Object.values(MOOD_STYLES).map((style) => style.effect))) {
      active.classList.remove(effectClass);
    }
    active.classList.add(MOOD_STYLES[state.mood].effect);
  }

  function setLineDepth(element, rel) {
    // 3D 倾斜模式消费这两个变量：--lyrics-rel 决定每行的倾斜方向，
    // --lyrics-depth 决定纵深（越远越暗、越模糊、越往后退）。
    if (!element?.style?.setProperty) return;
    element.style.setProperty('--lyrics-rel', String(rel));
    element.style.setProperty('--lyrics-depth', String(Math.min(Math.abs(rel), 3)));
  }

  // 3D 倾斜模式允许主歌词 / 译文换行，行高不再固定：用实测的行位置把当前行
  // 顶到走廊正中（经典模式仍由 CSS 用 --lyrics-index 平移，逻辑更轻）。
  function syncTiltShift(index) {
    if (state.mode !== 'tilt3d' || !list || index < 0) return;
    const element = list.children[index];
    const stageHeight = Number(list.parentElement?.clientHeight) || 0;
    if (!element || !stageHeight) return;
    if (typeof element.offsetTop !== 'number' || typeof element.offsetHeight !== 'number') return;
    const shift = element.offsetTop + element.offsetHeight / 2 - stageHeight / 2;
    if (Math.abs(shift - state.tiltShift) < 0.5) return;
    state.tiltShift = shift;
    list.style.setProperty('--lyrics-shift', `${shift}px`);
  }

  function refreshActive(index) {
    if (!overlay || !list) return;
    const elements = list.children;
    if (index < 0) {
      list.style.setProperty('--lyrics-index', '0');
      list.style.setProperty('--lyrics-shift', '0px');
      state.tiltShift = 0;
      for (let i = 0; i < elements.length; i++) {
        elements[i].classList.remove('lyrics-active', 'lyrics-prev', 'lyrics-next', 'lyrics-away');
        setLineDepth(elements[i], 0);
      }
      return;
    }
    list.style.setProperty('--lyrics-index', String(index));
    for (let i = 0; i < elements.length; i++) {
      const rel = i - index;
      elements[i].classList.toggle('lyrics-active', rel === 0);
      elements[i].classList.toggle('lyrics-prev', rel === -1);
      elements[i].classList.toggle('lyrics-next', rel === 1);
      elements[i].classList.toggle('lyrics-away', rel < -1 || rel > 1);
      setLineDepth(elements[i], rel);
    }
    refreshActiveEffect();
  }

  // 逐字样式的逐字点亮：每帧只改 CSS 变量与 class，不触发重排。
  function updateWordHighlights(index, time) {
    if (!list) return;
    const row = state.rows[index];
    if (!row?.words?.length) return;
    const item = list.children[index];
    if (!item || typeof item.querySelectorAll !== 'function') return;
    const spans = item.querySelectorAll('.lyrics-word');
    for (let i = 0; i < spans.length && i < row.words.length; i += 1) {
      const word = row.words[i];
      const end = word.endTime ?? row.words[i + 1]?.time ?? row.endTime ?? word.time + 0.4;
      const progress = Math.max(0, Math.min(1, (time - word.time) / Math.max(0.05, end - word.time)));
      spans[i].style?.setProperty?.('--word-progress', progress.toFixed(3));
      spans[i].classList?.toggle?.('is-sung', progress >= 1);
      spans[i].classList?.toggle?.('is-current', progress > 0 && progress < 1);
    }
  }

  // 聊天左右序列：
  // random = 随机连续说 1~3 句再换人（每位歌手的行数由随机决定，不会固定成「我我他」）
  // even / ta / me 保留为可控模式。
  function buildChatSides(count) {
    const bias = state.chatBias;
    if (bias === 'even') return Array.from({ length: count }, (_, index) => (index % 2 === 0 ? 'left' : 'right'));
    if (bias === 'ta' || bias === 'me') {
      const many = bias === 'ta' ? 'left' : 'right';
      const few = bias === 'ta' ? 'right' : 'left';
      return Array.from({ length: count }, (_, index) => (index % 3 === 2 ? few : many));
    }
    // 随机：用歌词内容做种子，刷新 / 重渲染时保持同一首歌的聊天气泡顺序稳定
    let seed = 2166136261;
    for (const row of state.rows) {
      const text = `${row.time}:${row.text}`;
      for (let i = 0; i < text.length; i += 1) {
        seed ^= text.charCodeAt(i);
        seed = Math.imul(seed, 16777619);
      }
    }
    seed ^= count;
    seed = Math.imul(seed, 16777619);
    const random = () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const sides = [];
    let side = random() < 0.5 ? 'left' : 'right';
    let run = 1 + Math.floor(random() * 3); // 连续 1~3 句
    for (let i = 0; i < count; i += 1) {
      if (run <= 0) {
        side = side === 'left' ? 'right' : 'left';
        run = 1 + Math.floor(random() * 3);
      }
      sides.push(side);
      run -= 1;
    }
    return sides;
  }

  function renderList() {
    if (!overlay || !list) return;
    const wordTiming = getLyricStyle(state.mode).wordTiming;
    const items = state.rows.map((row, rowIndex) => {
      const item = rootDocument.createElement('li');
      item.className = 'lyrics-line';
      // 对唱 / 聊天样式按行序分配左右（data-side），其它样式不影响
      if (item.dataset) item.dataset.side = state.chatSides[rowIndex] ?? (rowIndex % 2 === 0 ? 'left' : 'right');
      const span = rootDocument.createElement('span');
      span.className = 'lyrics-text';
      // 逐字样式：把当前行拆成字/词 span，用 --word-progress 逐字点亮
      if (wordTiming && row.words?.length) {
        row.words.forEach((word, wordIndex) => {
          const wordEl = rootDocument.createElement('span');
          wordEl.className = 'lyrics-word';
          if (typeof wordEl.setAttribute === 'function') wordEl.setAttribute('data-text', word.text);
          // 弹跳等样式用 --word-index 做逐字延迟
          wordEl.style?.setProperty?.('--word-index', String(wordIndex));
          wordEl.textContent = word.text;
          span.append(wordEl);
        });
      } else {
        span.textContent = row.text || '♪';
      }
      item.append(span);
      // tilt3d 模式的「主歌词 + 译文」：同时间戳的相邻第二行作小字译文。
      if (row.translation) {
        const translation = rootDocument.createElement('span');
        translation.className = 'lyrics-translation';
        translation.textContent = row.translation;
        item.append(translation);
      }
      return item;
    });
    list.replaceChildren(...items);
    refreshActive(-1);
  }

  // 模式切换会改变“显示行”的合并方式（tilt3d 才合并双语行），需要重建列表。
  function rebuildRows() {
    state.rows = buildLyricRows(state.lines, state.mode);
    state.chatSides = buildChatSides(state.rows.length);
    renderList();
    state.currentIndex = -1;
    state.lastEmitted = undefined;
  }

  function applyMode(mode) {
    state.mode = normalizeLyricMode(mode);
    if (overlay) overlay.dataset.mode = state.mode;
    syncBodyHints();
    rebuildRows();
  }

  function applyPosition(position) {
    state.position = normalizeLyricPosition(position);
    if (overlay) overlay.dataset.position = state.position;
    syncBodyHints();
  }

  // 字号档位：写 data-size 供 CSS 选 --lyrics-scale；3D 模式下需重算当前行位移。
  function applySize(size) {
    state.size = normalizeLyricSize(size);
    if (overlay) {
      overlay.dataset.size = state.size;
      const scale = LYRIC_SIZES[state.size]?.scale ?? 1;
      overlay.style.setProperty('--lyrics-scale', String(scale));
    }
    // 行高变大后，3D 倾斜的居中位移要按新行高重算。
    if (state.mode === 'tilt3d') syncTiltShift?.(state.currentIndex);
  }

  function applyCustomColor() {
    // 自定义颜色：用同色系三段渐变覆盖曲风渐变，accent 同步成同一主色；
    // 根节点打 data-color="custom"，CSS 可据此微调光带 / 光晕（曲风动效、字体不受影响）。
    if (!overlay) return;
    if (!state.color) {
      if (overlay.dataset) delete overlay.dataset.color;
      return;
    }
    const gradient = gradientFromColor(state.color);
    if (overlay.dataset) overlay.dataset.color = 'custom';
    if (gradient) overlay.style.setProperty('--lyrics-gradient', gradient);
    overlay.style.setProperty('--lyrics-accent', state.color);
  }

  function applyMood(mood) {
    state.mood = Object.hasOwn(MOOD_STYLES, mood) ? mood : 'calm';
    if (!overlay) return;
    const style = MOOD_STYLES[state.mood];
    overlay.dataset.mood = state.mood;
    overlay.style.setProperty('--lyrics-font', style.font);
    overlay.style.setProperty('--lyrics-background', style.background);
    overlay.style.setProperty('--lyrics-weight', String(style.weight));
    overlay.style.setProperty('--lyrics-tracking', style.tracking);
    if (state.color) {
      // 有自定义颜色时，切曲风只换字体 / 背景 / 动效 / 排版质感，
      // 渐变与 accent 保持用户选的颜色（由 applyCustomColor 覆盖）。
      applyCustomColor();
    } else {
      if (overlay.dataset) delete overlay.dataset.color;
      overlay.style.setProperty('--lyrics-gradient', style.gradient);
      overlay.style.setProperty('--lyrics-accent', style.accent);
    }
    refreshActiveEffect();
  }

  function setLyrics(lines) {
    if (state.disposed) return;
    state.currentIndex = -1;
    state.lastEmitted = undefined;
    const source = Array.isArray(lines) ? attachWordTimings(lines.map(normalizeLine)) : parseLyricsWithWords(lines);
    state.lines = stripLeadingCredits(
      source
        .filter((line) => Number.isFinite(line.time))
        .sort((a, b) => a.time - b.time),
    );
    rebuildRows();
    if (state.lines.length > 0) {
      applyMood(classifyLyrics(state.lines.map((line) => line.text).join('\n')));
    } else {
      applyMood('calm');
    }
    if (overlay) overlay.classList.toggle('lyrics-hidden', !state.enabled || state.lines.length === 0);
  }

  // 载入内置示例歌词（没有用户歌词时的默认内容），返回行数。
  function setDemo() {
    if (state.disposed) return 0;
    setLyrics(demoLyricLines());
    return state.lines.length;
  }

  function measureAnchor(index) {
    // 返回当前行中心相对视口的归一化坐标（0..1），供 Lead 映射到粒子世界坐标。
    if (!overlay || typeof window === 'undefined' || !overlay.isConnected || !list) {
      return { x: 0.5, y: 0.26 };
    }
    const element = list.children[index];
    if (!element || typeof element.getBoundingClientRect !== 'function') return { x: 0.5, y: 0.26 };
    const rect = element.getBoundingClientRect();
    const width = window.innerWidth || 1;
    const height = window.innerHeight || 1;
    return {
      x: (rect.left + rect.width / 2) / width,
      y: (rect.top + rect.height / 2) / height,
    };
  }

  function emit(payload) {
    const last = state.lastEmitted;
    if (
      last &&
      last.index === payload.index &&
      last.text === payload.text &&
      Math.abs(last.progress - payload.progress) < 0.003 &&
      Math.abs(last.x - payload.x) < 0.001 &&
      Math.abs(last.y - payload.y) < 0.001
    ) {
      return; // 同位置、进度几乎没动时去重，避免每帧重复回调
    }
    state.lastEmitted = payload;
    onLineChange?.(payload);
  }

  function emitNullOnce() {
    if (state.lastEmitted !== null) {
      state.lastEmitted = null;
      onLineChange?.(null);
    }
  }

  function update(currentSeconds) {
    if (state.disposed || !state.enabled || state.rows.length === 0) {
      emitNullOnce();
      return null;
    }
    const seconds = Number(currentSeconds);
    const t = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
    if (t < state.rows[0].time) {
      emitNullOnce(); // 还没唱到第一句
      return null;
    }
    const index = findActiveIndex(state.rows, t);
    const line = state.rows[index];
    const nextTime = index + 1 < state.rows.length ? state.rows[index + 1].time : null;
    const progress = lineProgress(t, line.time, nextTime);
    const anchor = measureAnchor(index);
    const payload = {
      index,
      text: line.text,
      time: line.time,
      nextTime,
      progress,
      x: anchor.x,
      y: anchor.y,
    };
    if (line.translation) payload.translation = line.translation;
    if (line.meta) payload.meta = line.meta;
    if (index !== state.currentIndex) {
      state.currentIndex = index;
      refreshActive(index);
    }
    if (getLyricStyle(state.mode).wordTiming) updateWordHighlights(index, t);
    syncTiltShift(index);
    emit(payload);
    return payload;
  }

  function setMood(mood) {
    if (state.disposed) return;
    applyMood(mood);
  }

  function setMode(mode) {
    if (state.disposed) return;
    applyMode(mode);
  }

  function setPosition(position) {
    if (state.disposed) return;
    applyPosition(position);
  }

  // 字号档位：small=小肥鱼 / medium=肥鱼 / large=大肥鱼。
  function setSize(size) {
    if (state.disposed) return state.size;
    applySize(size);
    return state.size;
  }

  // 自定义歌词颜色：设置后覆盖当前曲风的文字渐变与 accent；传 null / 非法值恢复跟随曲风。
  function setColor(color) {
    if (state.disposed) return null;
    state.color = normalizeHexColor(color);
    applyMood(state.mood); // 统一入口：有自定义色则重挂自定义渐变，否则恢复当前曲风色
    return state.color;
  }

  function getColor() {
    return state.color;
  }

  // 音频能量 → CSS 变量：'pulse' 等模式可以直接用 --lyrics-bass / --lyrics-beat 驱动运镜。
  function setAudioLevels(levels = {}) {
    if (!overlay || state.disposed) return;
    const clamp01 = (value) => Math.min(1, Math.max(0, Number(value) || 0));
    overlay.style.setProperty('--lyrics-bass', String(clamp01(levels.bass)));
    overlay.style.setProperty('--lyrics-beat', String(clamp01(levels.beat)));
    overlay.style.setProperty('--lyrics-treble', String(clamp01(levels.treble)));
  }

  function setChatProfile(profile = {}) {
    const next = normalizeChatProfile(profile);
    state.chatBias = next.bias;
    state.chatSides = buildChatSides(state.rows.length);
    if (!overlay) return next;
    const quote = (value) => `"${String(value).replace(/["\\]/g, '\\  function setEnabled(enabled) {')}"`;
    const initial = (value) => Array.from(String(value || '').trim())[0] || 'TA';
    overlay.style.setProperty('--chat-ta-name', quote(next.taName));
    overlay.style.setProperty('--chat-me-name', quote(next.meName));
    overlay.style.setProperty('--chat-ta-initial', quote(initial(next.taName)));
    overlay.style.setProperty('--chat-me-initial', quote(initial(next.meName)));
    overlay.classList.toggle('chat-ta-image', Boolean(next.taAvatar));
    overlay.classList.toggle('chat-me-image', Boolean(next.meAvatar));
    if (next.taAvatar) overlay.style.setProperty('--chat-ta-avatar', `url("${next.taAvatar.replace(/"/g, '%22')}")`);
    else overlay.style.removeProperty('--chat-ta-avatar');
    if (next.meAvatar) overlay.style.setProperty('--chat-me-avatar', `url("${next.meAvatar.replace(/"/g, '%22')}")`);
    else overlay.style.removeProperty('--chat-me-avatar');
    // 比例改变时，实时重排已有气泡的左右
    overlay.querySelectorAll('.lyrics-line').forEach((line, index) => {
      if (line.dataset) line.dataset.side = state.chatSides[index] ?? (index % 2 === 0 ? 'left' : 'right');
    });
    return next;
  }

  function setEnabled(enabled) {
    state.enabled = Boolean(enabled);
    if (overlay) overlay.classList.toggle('lyrics-hidden', !state.enabled || state.lines.length === 0);
    if (!state.enabled) emitNullOnce();
  }

  function attach(host) {
    if (!overlay || state.attached || state.disposed) return;
    const hostElement = typeof host === 'string' ? rootDocument.querySelector(host) : host ?? rootDocument.body;
    if (hostElement) {
      hostElement.append(overlay);
      state.attached = true;
    }
  }

  function dispose() {
    state.disposed = true;
    overlay?.remove();
    const body = rootDocument?.body;
    if (body?.classList) {
      body.classList.remove('lyrics-mode-tilt3d', 'lyrics-position-left', 'lyrics-position-right');
    }
    state.attached = false;
    state.lines = [];
    state.rows = [];
    state.currentIndex = -1;
    state.lastEmitted = undefined;
  }

  // 默认载入内置示例：即使曲库、用户都没有提供歌词，打开页面也能看到歌词在流动。
  // Lead 需要在“当前曲目没有歌词”时再次调用 setDemo()（见集成说明）。
  if (demoEnabled) setDemo();

  return {
    setLyrics,
    setDemo,
    update,
    setMood,
    setMode,
    setPosition,
    setSize,
    setColor,
    setEnabled,
    setChatProfile,
    setAudioLevels,
    attach,
    dispose,
    getMood: () => state.mood,
    getMode: () => state.mode,
    getPosition: () => state.position,
    getSize: () => state.size,
    getColor,
  };
}
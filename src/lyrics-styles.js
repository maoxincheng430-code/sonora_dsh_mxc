// 歌词动画样式注册表：内置样式在这里登记，外部也可以 registerLyricStyle() 追加。
// 每个样式声明 id / label / description / className / wordTiming，渲染逻辑由歌词层统一实现。
// 这样「加一种歌词样式」只需要注册一条，不需要改面板和渲染分支。

const registry = new Map();

const builtin = [
  {
    id: 'classic',
    label: '经典',
    description: '平面逐行推进，居中大字歌词',
    className: 'lyrics-style-classic',
    wordTiming: false,
  },
  {
    id: 'tilt3d',
    label: '3D 倾斜',
    description: '歌词带透视纵深，可贴在左 / 中 / 右，与粒子特效互不影响',
    className: 'lyrics-style-tilt3d',
    wordTiming: false,
  },
  {
    id: 'karaoke',
    label: '逐字',
    description: '当前句按字/词逐个点亮，未唱到的字保持暗色，对照最清楚',
    className: 'lyrics-style-karaoke',
    wordTiming: true,
  },
  {
    id: 'apple',
    label: '苹果景深',
    description: '参考 Apple Music：当前句最大最清晰，前后句失焦后退，逐字扫亮',
    className: 'lyrics-style-apple',
    wordTiming: true,
  },
  {
    id: 'typewriter',
    label: '打字机',
    description: '当前句按字逐个浮现，句尾有光标闪烁，适合安静的段落',
    className: 'lyrics-style-typewriter',
    wordTiming: true,
  },
  {
    id: 'glow',
    label: '霓虹',
    description: '逐字点亮并带霓虹光晕，重拍时整句呼吸，适合电子 / 摇滚',
    className: 'lyrics-style-glow',
    wordTiming: true,
  },
  {
    id: 'cinema',
    label: '电影字幕',
    description: '沉到底部的小号字幕，安静克制，适合投屏 / 看 MV 时用',
    className: 'lyrics-style-cinema',
    wordTiming: false,
  },
  {
    id: 'bounce',
    label: '弹跳',
    description: '每个字依次弹出来，活泼有节奏，适合轻快 / 日系曲',
    className: 'lyrics-style-bounce',
    wordTiming: true,
  },
  {
    id: 'outline',
    label: '描边',
    description: '空心描边字，唱到的字逐个填色，清爽有设计感',
    className: 'lyrics-style-outline',
    wordTiming: true,
  },
  {
    id: 'island',
    label: '词岛',
    description: '当前句装进毛玻璃胶囊，参考 Lyricify 灵动词岛，桌面悬浮感强',
    className: 'lyrics-style-island',
    wordTiming: false,
  },
  {
    id: 'focus',
    label: '单行聚焦',
    description: '只显示当前这一句，超大字号极简呈现，适合投屏与暗场景',
    className: 'lyrics-style-focus',
    wordTiming: false,
  },
  {
    id: 'duet',
    label: '对唱',
    description: '歌词左右交替排布，像两个人的对唱 / 对话',
    className: 'lyrics-style-duet',
    wordTiming: false,
  },
  {
    id: 'drift',
    label: '漂浮',
    description: '整块歌词在画面里缓慢漂浮、轻微旋转，每一行还有错落的上下起伏',
    className: 'lyrics-style-drift',
    wordTiming: false,
  },
  {
    id: 'swing',
    label: '摆荡',
    description: '3D 透视下整块歌词左右摆荡，像镜头跟着节奏摇，适合慢摇 / R&B',
    className: 'lyrics-style-swing',
    wordTiming: false,
  },
  {
    id: 'vertical',
    label: '竖排',
    description: '中文 / 日文竖排，一列列从右向左推进，适合古风、City Pop',
    className: 'lyrics-style-vertical',
    wordTiming: false,
  },
  {
    id: 'kinetic',
    label: '弹跳字',
    description: '当前句每个字依次弹入、旋转、回弹，整块轻微摇摆，节奏感强',
    className: 'lyrics-style-kinetic',
    wordTiming: true,
  },
  {
    id: 'glitch',
    label: '故障',
    description: 'RGB 分离、随机抖动和扫描线，适合电子 / 摇滚 / 赛博氛围',
    className: 'lyrics-style-glitch',
    wordTiming: true,
  },
  {
    id: 'scatter',
    label: '散点',
    description: '每个字从不同方向飞入聚拢，当前句像在画面里炸开再归位',
    className: 'lyrics-style-scatter',
    wordTiming: true,
  },
  {
    id: 'pulse',
    label: '律动',
    description: '歌词跟着音乐低频缩放、轻转，鼓点越强摆动越大（实时音频驱动）',
    className: 'lyrics-style-pulse',
    wordTiming: false,
  },
  {
    id: 'chat',
    label: '聊天',
    description: '像微信聊天一样，一句一句左右弹出气泡，当前句会轻轻弹一下',
    className: 'lyrics-style-chat',
    wordTiming: false,
  },
];

for (const style of builtin) registerLyricStyle(style);

/** 注册（或覆盖）一个歌词样式。返回归一化后的样式对象。 */
export function registerLyricStyle(definition) {
  if (!definition || typeof definition !== 'object') throw new TypeError('歌词样式必须是对象');
  const id = String(definition.id ?? '').trim();
  if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new TypeError(`非法歌词样式 id：${id}`);
  const style = {
    id,
    label: String(definition.label ?? id),
    description: String(definition.description ?? ''),
    className: String(definition.className ?? `lyrics-style-${id}`),
    wordTiming: Boolean(definition.wordTiming),
    order: Number.isFinite(definition.order) ? definition.order : registry.size,
  };
  registry.set(id, style);
  return style;
}

/** 取样式；未知 id 回退 classic。 */
export function getLyricStyle(id) {
  return registry.get(String(id)) ?? registry.get('classic');
}

/** 是否已注册。 */
export function hasLyricStyle(id) {
  return registry.has(String(id));
}

/** 列出全部样式（按登记顺序）。 */
export function listLyricStyles() {
  return [...registry.values()].sort((a, b) => a.order - b.order);
}

/** 样式 id → { label, description } 表（歌词面板直接用）。 */
export function lyricStyleTable() {
  return Object.fromEntries(listLyricStyles().map((style) => [style.id, { label: style.label, description: style.description }]));
}

/** 测试用：恢复内置样式。 */
export function resetLyricStyles() {
  registry.clear();
  for (const style of builtin) registerLyricStyle(style);
}

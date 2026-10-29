// 歌词系统测试：parseLRC / formatLRCTime / classifyLyrics / MOOD_STYLES / 内置示例 /
// ensureTimedLyrics / createLyricsOverlay。
// 全部基于纯 Node（node:test + assert/strict），组件走“无 DOM 数据路径”或注入假 document。

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseLRC,
  formatLRCTime,
  classifyLyrics,
  MOOD_STYLES,
  LYRIC_MODES,
  LYRIC_POSITIONS,
  buildLyricRows,
  stripLeadingCredits,
  normalizeLyricMode,
  normalizeLyricPosition,
  createLyricsOverlay,
  DEMO_LYRICS,
  demoLyricLines,
  ensureTimedLyrics,
} from '../src/lyrics.js';

// ---------- parseLRC ----------

test('parseLRC 解析标准 [mm:ss.xx] 时间标签', () => {
  const lines = parseLRC('[00:01.50]第一句\n[00:03.25]第二句\n[00:05.00]第三句');
  assert.deepEqual(lines, [
    { time: 1.5, text: '第一句' },
    { time: 3.25, text: '第二句' },
    { time: 5, text: '第三句' },
  ]);
});

test('parseLRC 支持无毫秒的 [mm:ss] 标签', () => {
  assert.deepEqual(parseLRC('[01:05]你好'), [{ time: 65, text: '你好' }]);
  assert.deepEqual(parseLRC('[0:5]短标签'), [{ time: 5, text: '短标签' }]);
});

test('parseLRC 支持 1~3 位小数（网易云毫秒精度 [mm:ss.xxx]）', () => {
  // 网易云实际返回：三位毫秒
  const milliseconds = parseLRC('[00:29.190]对这个世界如果\n[00:30.893]你有太多的抱怨');
  assert.deepEqual(milliseconds.map((line) => line.time), [29.19, 30.893]);
  assert.equal(milliseconds[0].text, '对这个世界如果');
  // 一位 / 两位小数也兼容
  assert.deepEqual(parseLRC('[00:01.5]一位'), [{ time: 1.5, text: '一位' }]);
  assert.deepEqual(parseLRC('[00:01.25]两位'), [{ time: 1.25, text: '两位' }]);
});

test('parseLRC 一行多个时间标签展开为多条', () => {
  const lines = parseLRC('[00:01.00][00:02.50][00:04.00]副歌');
  assert.deepEqual(lines.map((line) => line.time), [1, 2.5, 4]);
  assert.ok(lines.every((line) => line.text === '副歌'));
});

test('parseLRC 提取元数据并挂到每条歌词', () => {
  const lines = parseLRC('[ti:夜航]\n[ar:声境]\n[al:远行]\n[offset:-500]\n[00:10.00]起航');
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0].meta, { ti: '夜航', ar: '声境', al: '远行', offset: -500 });
  assert.equal(lines[0].time, 10);
  assert.equal(lines[0].text, '起航');
  // 只有元数据、没有任何歌词行时返回空数组。
  assert.deepEqual(parseLRC('[ti:空歌]'), []);
});

test('parseLRC 结果按时间升序排序，同时间保持原顺序', () => {
  const lines = parseLRC('[00:30.00]后来\n[00:10.00]开头\n[00:20.00]中间\n[00:20.00]中间2');
  assert.deepEqual(lines.map((line) => line.text), ['开头', '中间', '中间2', '后来']);
});

test('parseLRC 容错：非法标签与杂行被忽略且不抛错', () => {
  assert.deepEqual(parseLRC('[abc]非法\n[12:99]秒数越界\n[00:01]正常'), [{ time: 1, text: '正常' }]);
  assert.deepEqual(parseLRC('没有时间标签的纯文本行'), []);
  assert.deepEqual(parseLRC(''), []);
  assert.deepEqual(parseLRC('\n\n  \n'), []);
  assert.equal(parseLRC(null).length, 0);
  assert.equal(parseLRC(undefined).length, 0);
  assert.equal(parseLRC(42).length, 0);
  assert.deepEqual(parseLRC('\uFEFF[00:01.00]带BOM'), [{ time: 1, text: '带BOM' }]);
  assert.deepEqual(parseLRC('\r\n[00:02.00]带CRLF\r\n'), [{ time: 2, text: '带CRLF' }]);
});

// ---------- formatLRCTime ----------

test('formatLRCTime 基础格式化', () => {
  assert.equal(formatLRCTime(0), '00:00.00');
  assert.equal(formatLRCTime(65), '01:05.00');
  assert.equal(formatLRCTime(1.234), '00:01.23');
  assert.equal(formatLRCTime(599.999), '10:00.00');
  assert.equal(formatLRCTime(-3), '00:00.00');
  assert.equal(formatLRCTime(NaN), '00:00.00');
});

test('formatLRCTime 与 parseLRC 互逆（往返一致）', () => {
  for (const tag of ['00:01.50', '03:07.25', '12:34.56', '65:00.00']) {
    const time = parseLRC(`[${tag}]回声`)[0].time;
    assert.equal(formatLRCTime(time), tag);
  }
});

// ---------- classifyLyrics ----------

test('classifyLyrics 忧伤关键词命中 sad', () => {
  assert.equal(classifyLyrics('难过的时候眼泪总会落下'), 'sad');
  assert.equal(classifyLyrics('你说再见，我独自一人思念雨夜'), 'sad');
});

test('classifyLyrics 激昂关键词命中 epic', () => {
  assert.equal(classifyLyrics('燃烧吧，在光芒中奔跑，为梦想呐喊！'), 'epic');
  assert.equal(classifyLyrics('热血战斗，命运由力量改写'), 'epic');
});

test('classifyLyrics 舒缓关键词命中 calm', () => {
  assert.equal(classifyLyrics('月光下微风轻拂，宁静的夜晚'), 'calm');
  assert.equal(classifyLyrics('温柔地呼吸，看星空与流云'), 'calm');
});

test('classifyLyrics 空文本默认 calm', () => {
  assert.equal(classifyLyrics(''), 'calm');
  assert.equal(classifyLyrics('   \n  '), 'calm');
  assert.equal(classifyLyrics(null), 'calm');
  assert.equal(classifyLyrics(undefined), 'calm');
});

test('classifyLyrics 混合命中时取命中数最多的一方', () => {
  assert.equal(classifyLyrics('难过 难过 燃烧吧'), 'sad'); // 2 sad vs 1 epic
  assert.equal(classifyLyrics('燃烧吧 燃烧吧 难过'), 'epic'); // 2 epic vs 1 sad
});

test('classifyLyrics 并列时按 sad > epic > calm 优先级', () => {
  assert.equal(classifyLyrics('月光 燃烧'), 'epic'); // calm 1 vs epic 1
  assert.equal(classifyLyrics('月光 雨'), 'sad'); // calm 1 vs sad 1
  assert.equal(classifyLyrics('燃烧 雨'), 'sad'); // epic 1 vs sad 1
});

test('classifyLyrics 标点信号参与加权', () => {
  assert.equal(classifyLyrics('追啊！追啊！！'), 'epic'); // 感叹号 ×3
  assert.equal(classifyLyrics('风… 云… 渐渐远去'), 'sad'); // 省略号 ×2 > 云 ×1
  assert.equal(classifyLyrics('为什么要这样？为什么？'), 'sad'); // 问号
});

// ---------- MOOD_STYLES ----------

test('MOOD_STYLES 三套曲风齐全且字段完整', () => {
  assert.deepEqual(Object.keys(MOOD_STYLES).sort(), ['calm', 'epic', 'sad']);
  for (const [mood, style] of Object.entries(MOOD_STYLES)) {
    assert.equal(typeof style.font, 'string', `${mood}.font`);
    assert.ok(style.font.length > 0, `${mood}.font 非空`);
    assert.equal(typeof style.gradient, 'string', `${mood}.gradient`);
    assert.ok(style.gradient.includes('gradient'), `${mood}.gradient 是渐变值`);
    assert.equal(typeof style.background, 'string', `${mood}.background`);
    assert.ok(style.background.includes('gradient'), `${mood}.background 是渐变叠加`);
    assert.equal(typeof style.effect, 'string', `${mood}.effect`);
    assert.match(style.effect, /^lyrics-motion-/, `${mood}.effect 是动效 class`);
    assert.equal(typeof style.accent, 'string', `${mood}.accent`);
    assert.ok(style.accent.startsWith('#'), `${mood}.accent 是颜色值`);
    // 排版质感：字重 + 字距（Folia 风格的“整套切换”）。
    assert.equal(typeof style.weight, 'number', `${mood}.weight`);
    assert.ok(style.weight >= 300 && style.weight <= 900, `${mood}.weight 是合法字重`);
    assert.equal(typeof style.tracking, 'string', `${mood}.tracking`);
    assert.match(style.tracking, /^\d*\.?\d+em$/, `${mood}.tracking 是 em 字距`);
  }
  // 三套动效各不相同。
  const effects = Object.values(MOOD_STYLES).map((style) => style.effect);
  assert.equal(new Set(effects).size, 3);
  // 三套字重/字距也要有区分度，切换曲风才看得出来。
  assert.equal(new Set(Object.values(MOOD_STYLES).map((style) => style.weight)).size, 3);
  assert.equal(new Set(Object.values(MOOD_STYLES).map((style) => style.tracking)).size, 3);
});

// ---------- 内置示例歌词 DEMO_LYRICS / demoLyricLines ----------

test('DEMO_LYRICS 是 20~30 行、时间轴完整的中文 LRC', () => {
  assert.equal(typeof DEMO_LYRICS, 'string');
  assert.ok(DEMO_LYRICS.trim().length > 0);

  const lines = parseLRC(DEMO_LYRICS);
  assert.ok(lines.length >= 20 && lines.length <= 30, `示例歌词行数 ${lines.length} 应在 20~30 之间`);
  // 每行都有文字、时间有限、按时间升序。
  for (const line of lines) {
    assert.equal(typeof line.text, 'string');
    assert.ok(line.text.trim().length > 0, '示例歌词每行都有文字');
    assert.ok(Number.isFinite(line.time) && line.time >= 0, '示例歌词时间合法');
  }
  for (let i = 1; i < lines.length; i += 1) {
    assert.ok(lines[i].time >= lines[i - 1].time, '示例歌词按时间升序');
  }

  // 从 0 秒开始，时间轴总长在 1~3 分钟之间（足够看完整段逐行推进）。
  assert.equal(lines[0].time, 0);
  const duration = lines.at(-1).time;
  assert.ok(duration >= 60 && duration <= 180, `示例歌词时长 ${duration}s 应在 60~180s`);
  assert.equal(duration, 143); // 02:23.00 —— 汇报里给出这个数字

  // 作品信息元数据可用于面板/未来展示。
  assert.equal(lines[0].meta.ti, '星海回声');
  assert.equal(lines[0].meta.ar, 'SONORA 声境');

  // 主题应该被分类为舒缓曲风（不出现 sad/epic 关键词误判）。
  assert.equal(classifyLyrics(lines.map((line) => line.text).join('\n')), 'calm');
});

test('demoLyricLines 每次返回新数组且与 parseLRC(DEMO_LYRICS) 等价', () => {
  const first = demoLyricLines();
  const second = demoLyricLines();
  assert.deepEqual(first, parseLRC(DEMO_LYRICS));
  assert.notEqual(first, second, '避免调用方修改缓存数组');
  assert.notEqual(first[0], second[0]);
  // 修改返回数组不影响下一次解析。
  first.length = 0;
  assert.equal(demoLyricLines().length, second.length);
});

// ---------- ensureTimedLyrics（粘贴纯文本也能显示） ----------

test('ensureTimedLyrics 对合法 LRC 原样返回', () => {
  const lrc = '[00:01.00]第一句\n[00:05.50]第二句';
  assert.equal(ensureTimedLyrics(lrc), lrc);
  assert.equal(ensureTimedLyrics('[ti:夜]\n[00:03.00]一句'), '[ti:夜]\n[00:03.00]一句');
});

test('ensureTimedLyrics 为纯文本按间隔自动补时间轴', () => {
  const timed = ensureTimedLyrics('第一行\n\n第二行\n第三行');
  assert.equal(timed, '[00:00.00]第一行\n[00:04.00]第二行\n[00:08.00]第三行');
  const lines = parseLRC(timed);
  assert.deepEqual(lines.map((line) => line.time), [0, 4, 8]);
  assert.deepEqual(lines.map((line) => line.text), ['第一行', '第二行', '第三行']);

  // 自定义间隔。
  assert.deepEqual(
    parseLRC(ensureTimedLyrics('甲\n乙', { interval: 2.5 })).map((line) => line.time),
    [0, 2.5],
  );
  // 非法间隔回退默认 4 秒。
  assert.deepEqual(
    parseLRC(ensureTimedLyrics('甲\n乙', { interval: -1 })).map((line) => line.time),
    [0, 4],
  );
});

test('ensureTimedLyrics 过滤元数据行并容错空输入', () => {
  assert.equal(ensureTimedLyrics('[ti:夜航]\n[ar:声境]\n第一句'), '[00:00.00]第一句');
  assert.equal(ensureTimedLyrics('   \n\t\n'), '');
  assert.equal(ensureTimedLyrics(''), '');
  assert.equal(ensureTimedLyrics(null), '');
  assert.equal(ensureTimedLyrics(undefined), '');
  assert.equal(ensureTimedLyrics(42), '');
  assert.equal(ensureTimedLyrics('\uFEFF第一句\r\n第二句'), '[00:00.00]第一句\n[00:04.00]第二句');
});

// ---------- createLyricsOverlay（默认载入示例） ----------

test('组件默认载入内置示例歌词，打开页面就有歌词可看', () => {
  const demo = demoLyricLines();
  const overlay = createLyricsOverlay({});
  // 0 秒即可命中示例第一行（无需音频、无需导入歌词文件）。
  const first = overlay.update(0);
  assert.ok(first, '默认示例应在 0 秒立即给出当前行');
  assert.equal(first.index, 0);
  assert.equal(first.text, demo[0].text);
  assert.equal(overlay.getMood(), 'calm');

  // 随着秒数推进到示例时间轴中段，当前行跟着推进。
  const middle = overlay.update(demo[3].time + 0.1);
  assert.equal(middle.index, 3);
  assert.equal(middle.text, demo[3].text);

  overlay.dispose();
});

test('options.demo=false 可得到空歌词层，setDemo 可随时载入示例', () => {
  const overlay = createLyricsOverlay({ demo: false });
  assert.equal(overlay.update(0), null);
  assert.equal(typeof overlay.setDemo, 'function');

  const count = overlay.setDemo();
  assert.equal(count, demoLyricLines().length);
  assert.equal(overlay.update(0).text, demoLyricLines()[0].text);
  assert.equal(overlay.update(0).index, 0);

  // 用户歌词覆盖后，再 setDemo 又回到示例。
  overlay.setLyrics('[00:01.00]眼泪\n[00:02.00]孤独');
  assert.equal(overlay.getMood(), 'sad');
  overlay.setDemo();
  assert.equal(overlay.getMood(), 'calm');
  overlay.dispose();
});

// ---------- createLyricsOverlay（无 DOM 数据路径） ----------

test('组件在无 DOM 环境下可安全创建，update 走数据路径并触发 onLineChange', () => {
  const events = [];
  const overlay = createLyricsOverlay({ onLineChange: (line) => events.push(line) });
  for (const method of ['setLyrics', 'update', 'setMood', 'setEnabled', 'attach', 'dispose', 'getMood']) {
    assert.equal(typeof overlay[method], 'function', method);
  }
  overlay.setLyrics(parseLRC('[00:05.00]开头\n[00:10.00]中间\n[00:15.00]结尾'));
  assert.equal(overlay.getMood(), 'calm'); // 无情绪关键词 → 自动 calm

  assert.equal(overlay.update(0.5), null); // 首行之前没有当前行
  assert.deepEqual(events, [null]);
  assert.equal(overlay.update(4.9), null);
  assert.equal(events.length, 1); // 未开始阶段只发一次 null

  const line = overlay.update(6.0);
  assert.equal(line.index, 0);
  assert.equal(line.text, '开头');
  assert.equal(line.time, 5);
  assert.equal(line.nextTime, 10);
  assert.ok(line.progress >= 0.19 && line.progress <= 0.21); // (6-5)/(10-5) = 0.2
  assert.equal(line.x, 0.5); // 无 DOM → 回退锚点在水平中央
  assert.equal(line.y, 0.26); // 无 DOM → 回退锚点对应 top 26% 布局
  assert.equal(events.length, 2);
  assert.equal(events[1].index, 0);

  // 同一行内 progress 持续变化 → 持续回调（供粒子聚拢强度使用）。
  const later = overlay.update(8.0);
  assert.ok(Math.abs(later.progress - 0.6) < 1e-9);
  assert.ok(events.length >= 3);

  // 换行。
  const next = overlay.update(10.0);
  assert.equal(next.index, 1);
  assert.equal(next.text, '中间');
  assert.equal(next.nextTime, 15);
  assert.equal(events[events.length - 1], next);

  // 最后一行：nextTime 为 null，progress 按兜底窗口推进。
  const last = overlay.update(20.0);
  assert.equal(last.index, 2);
  assert.equal(last.nextTime, null);
  assert.ok(last.progress > 0 && last.progress <= 1);

  // 同时间重复 update 被去重，不重复回调。
  const count = events.length;
  overlay.update(20.0);
  overlay.update(20.0001);
  assert.equal(events.length, count);

  // 禁用后 update 不再回调。
  overlay.setEnabled(false);
  const silent = events.length;
  assert.equal(overlay.update(21), null);
  assert.equal(events.length, silent);
});

test('组件 setLyrics 接受原始 LRC 文本并自动分类曲风', () => {
  const overlay = createLyricsOverlay({});
  overlay.setLyrics('[00:01.00]眼泪\n[00:02.00]孤独');
  assert.equal(overlay.getMood(), 'sad');
  assert.equal(overlay.update(1.5).index, 0);
  overlay.setMood('epic');
  assert.equal(overlay.getMood(), 'epic');
  overlay.setMood('不存在的曲风');
  assert.equal(overlay.getMood(), 'calm'); // 非法曲风回退 calm
});

test('组件行对象透传 parseLRC 的 meta 元数据', () => {
  const overlay = createLyricsOverlay({});
  const lines = parseLRC('[ti:夜航]\n[ar:远行]\n[00:03.00]出海');
  assert.deepEqual(lines[0].meta, { ti: '夜航', ar: '远行' });
  overlay.setLyrics(lines);
  assert.equal(overlay.update(3).meta.ti, '夜航');
  assert.equal(overlay.update(3).meta.ar, '远行');
});

// ---------- createLyricsOverlay（注入假 document 的 DOM 路径） ----------

test('组件 DOM 路径：注入假 document 后可挂载、渲染、切换曲风并释放', () => {
  const doc = fakeDocument();
  const events = [];
  const overlay = createLyricsOverlay({
    document: doc,
    containerClass: 'lyrics-anchored',
    onLineChange: (line) => events.push(line),
  });
  overlay.attach(doc.body);

  const root = doc.querySelector('.lyrics-overlay.lyrics-anchored');
  assert.ok(root, 'containerClass 生效且已挂载');

  overlay.setLyrics(parseLRC('[00:05.00]开头\n[00:10.00]中间\n[00:15.00]结尾'));
  const listEl = doc.querySelector('.lyrics-list');
  assert.equal(listEl.children.length, 3);
  assert.equal(overlay.getMood(), 'calm');

  overlay.update(6.0);
  let active = doc.querySelector('.lyrics-line.lyrics-active');
  assert.ok(active);
  assert.equal(listEl.style._props['--lyrics-index'], '0');
  assert.ok(active.classList.contains(MOOD_STYLES.calm.effect));
  assert.equal(root.dataset.mood, 'calm');
  assert.equal(root.style._props['--lyrics-accent'], MOOD_STYLES.calm.accent);

  overlay.setMood('sad');
  assert.equal(root.dataset.mood, 'sad');
  assert.equal(root.style._props['--lyrics-gradient'], MOOD_STYLES.sad.gradient);
  assert.ok(active.classList.contains('lyrics-motion-blur'));

  overlay.update(11.0);
  assert.equal(listEl.style._props['--lyrics-index'], '1');
  active = doc.querySelector('.lyrics-line.lyrics-active');
  assert.equal(active.children[0].textContent, '中间');

  overlay.setEnabled(false);
  assert.ok(root.classList.contains('lyrics-hidden'));
  const silent = events.length;
  overlay.update(12);
  assert.equal(events.length, silent);

  overlay.dispose();
  assert.equal(doc.querySelector('.lyrics-overlay'), null, 'dispose 后从 DOM 移除');
});

test('组件 DOM 路径：默认示例已渲染，曲风变量包含字重/字距', () => {
  const doc = fakeDocument();
  const overlay = createLyricsOverlay({ document: doc });
  overlay.attach(doc.body);
  const root = doc.querySelector('.lyrics-overlay');
  const listEl = doc.querySelector('.lyrics-list');
  assert.ok(root, '歌词根节点已创建');
  assert.equal(listEl.children.length, demoLyricLines().length, '创建即渲染内置示例');
  assert.ok(!root.classList.contains('lyrics-hidden'), '有示例歌词时默认可见');
  assert.equal(root.dataset.mood, 'calm');
  // Folia 风格的整套曲风切换：字重 / 字距也由 MOOD_STYLES 注入 CSS 变量。
  assert.equal(root.style._props['--lyrics-weight'], String(MOOD_STYLES.calm.weight));
  assert.equal(root.style._props['--lyrics-tracking'], MOOD_STYLES.calm.tracking);

  const line = overlay.update(0);
  assert.equal(line.index, 0);
  const active = doc.querySelector('.lyrics-line.lyrics-active');
  assert.ok(active, '0 秒即高亮示例第一行');
  assert.equal(active.children[0].textContent, demoLyricLines()[0].text);

  // 重新载入示例后行数一致，且能覆盖用户歌词。
  overlay.setLyrics('[00:01.00]难过\n[00:02.00]眼泪');
  assert.equal(root.dataset.mood, 'sad');
  assert.equal(root.style._props['--lyrics-weight'], String(MOOD_STYLES.sad.weight));
  assert.equal(overlay.setDemo(), demoLyricLines().length);
  assert.equal(root.dataset.mood, 'calm');
  overlay.dispose();
});

// ---------- 显示模式 / 位置（3D 倾斜，独立于粒子特效） ----------

test('LYRIC_MODES / LYRIC_POSITIONS 选项齐全，normalize 对非法值回退', () => {
  assert.deepEqual(Object.keys(LYRIC_MODES), ['classic', 'tilt3d', 'karaoke', 'apple', 'typewriter', 'glow', 'cinema', 'bounce', 'outline', 'island', 'focus', 'duet', 'drift', 'swing', 'vertical', 'kinetic', 'glitch', 'scatter', 'pulse', 'chat']);
  assert.deepEqual(Object.keys(LYRIC_POSITIONS), ['left', 'center', 'right']);
  for (const [mode, meta] of Object.entries(LYRIC_MODES)) {
    assert.equal(typeof meta.label, 'string', `${mode}.label`);
    assert.ok(meta.label.length > 0);
    assert.equal(typeof meta.description, 'string');
  }
  for (const [position, meta] of Object.entries(LYRIC_POSITIONS)) {
    assert.equal(typeof meta.label, 'string', `${position}.label`);
    assert.ok(meta.label.length > 0);
  }

  assert.equal(normalizeLyricMode('tilt3d'), 'tilt3d');
  assert.equal(normalizeLyricMode('classic'), 'classic');
  assert.equal(normalizeLyricMode('不存在'), 'classic');
  assert.equal(normalizeLyricMode(undefined), 'classic');
  assert.equal(normalizeLyricMode(null), 'classic');

  assert.equal(normalizeLyricPosition('left'), 'left');
  assert.equal(normalizeLyricPosition('right'), 'right');
  assert.equal(normalizeLyricPosition('center'), 'center');
  assert.equal(normalizeLyricPosition('top'), 'center');
  assert.equal(normalizeLyricPosition(42), 'center');
});

test('buildLyricRows：经典模式一行一行，3D 倾斜模式合并同时间戳的双语行', () => {
  const lines = parseLRC('[00:10.00]Hello\n[00:10.00]你好\n[00:12.50]World\n[00:15.00]世界');
  assert.equal(lines.length, 4);

  // 经典模式：保持 4 行，译文为空。
  const classic = buildLyricRows(lines, 'classic');
  assert.equal(classic.length, 4);
  assert.deepEqual(
    classic.map((row) => [row.text, row.translation]),
    [
      ['Hello', ''],
      ['你好', ''],
      ['World', ''],
      ['世界', ''],
    ],
  );

  // 3D 倾斜：同一时间戳的相邻两行合并成「主歌词 + 译文」。
  const tilt = buildLyricRows(lines, 'tilt3d');
  assert.equal(tilt.length, 3);
  assert.equal(tilt[0].text, 'Hello');
  assert.equal(tilt[0].translation, '你好');
  assert.equal(tilt[0].time, 10);
  assert.equal(tilt[1].text, 'World');
  assert.equal(tilt[1].translation, '');
  assert.equal(tilt[2].text, '世界');

  // 容错：非法模式回退经典；空输入返回空数组。
  assert.equal(buildLyricRows(lines, 'nope').length, 4);
  assert.deepEqual(buildLyricRows(null, 'tilt3d'), []);
  assert.deepEqual(buildLyricRows(undefined), []);
});

test('组件：默认经典 + 居中，setMode/setPosition 可切换且非法值回退', () => {
  const overlay = createLyricsOverlay({});
  assert.equal(overlay.getMode(), 'classic');
  assert.equal(overlay.getPosition(), 'center');

  overlay.setMode('tilt3d');
  assert.equal(overlay.getMode(), 'tilt3d');
  overlay.setMode('乱写');
  assert.equal(overlay.getMode(), 'classic');

  overlay.setPosition('right');
  assert.equal(overlay.getPosition(), 'right');
  overlay.setPosition('乱写');
  assert.equal(overlay.getPosition(), 'center');

  // options 支持初始值（刷新后恢复上次选择）。
  const restored = createLyricsOverlay({ mode: 'tilt3d', position: 'left' });
  assert.equal(restored.getMode(), 'tilt3d');
  assert.equal(restored.getPosition(), 'left');
  overlay.dispose();
  restored.dispose();
});

test('组件 DOM 路径：模式/位置落到 data 属性、body 提示 class 与每行纵深变量', () => {
  const doc = fakeDocument();
  const overlay = createLyricsOverlay({ document: doc, mode: 'tilt3d', position: 'left' });
  overlay.attach(doc.body);
  const root = doc.querySelector('.lyrics-overlay');
  assert.equal(root.dataset.mode, 'tilt3d');
  assert.equal(root.dataset.position, 'left');
  assert.ok(doc.body.classList.contains('lyrics-mode-tilt3d'));
  assert.ok(doc.body.classList.contains('lyrics-position-left'));
  assert.ok(!doc.body.classList.contains('lyrics-position-right'));

  overlay.setPosition('right');
  assert.equal(root.dataset.position, 'right');
  assert.ok(doc.body.classList.contains('lyrics-position-right'));
  assert.ok(!doc.body.classList.contains('lyrics-position-left'));

  overlay.setLyrics(parseLRC('[00:05.00]开头\n[00:10.00]中间\n[00:15.00]结尾'));
  overlay.update(11.0);
  const listEl = doc.querySelector('.lyrics-list');
  const activeIndex = 1;
  assert.equal(listEl.style._props['--lyrics-index'], String(activeIndex));
  assert.equal(listEl.children[activeIndex].classList.contains('lyrics-active'), true);
  // 当前行深度 0，前后行各 1、更远 2/3。
  assert.equal(listEl.children[activeIndex].style._props['--lyrics-rel'], '0');
  assert.equal(listEl.children[activeIndex].style._props['--lyrics-depth'], '0');
  assert.equal(listEl.children[activeIndex - 1].style._props['--lyrics-depth'], '1');
  assert.equal(listEl.children[activeIndex + 1].style._props['--lyrics-rel'], '1');

  overlay.dispose();
  assert.ok(!doc.body.classList.contains('lyrics-mode-tilt3d'), 'dispose 后清理 body class');
  assert.ok(!doc.body.classList.contains('lyrics-position-right'));
});

test('组件 DOM 路径：3D 倾斜模式渲染「主歌词 + 译文」，切回经典恢复一行一行', () => {
  const doc = fakeDocument();
  const overlay = createLyricsOverlay({ document: doc, demo: false });
  overlay.attach(doc.body);

  overlay.setLyrics('[00:05.00]I wish I could go back\n[00:05.00]我希望时光能够倒流\n[00:12.00]Why do the stars shine\n[00:12.00]星星为何闪耀');
  const listEl = doc.querySelector('.lyrics-list');
  assert.equal(listEl.children.length, 4, '经典模式一行一行');

  overlay.setMode('tilt3d');
  assert.equal(listEl.children.length, 2, '3D 倾斜合并同时间戳的双语行');
  const first = listEl.children[0];
  assert.equal(first.children[0].textContent, 'I wish I could go back');
  assert.equal(first.children[1].className, 'lyrics-translation');
  assert.equal(first.children[1].textContent, '我希望时光能够倒流');

  const line = overlay.update(5.2);
  assert.equal(line.index, 0);
  assert.equal(line.text, 'I wish I could go back');
  assert.equal(line.translation, '我希望时光能够倒流');
  assert.equal(line.nextTime, 12);

  overlay.setMode('classic');
  assert.equal(listEl.children.length, 4, '切回经典恢复逐行');
  assert.equal(doc.querySelector('.lyrics-translation'), null, '经典模式不再渲染译文节点');

  overlay.dispose();
});

// ---------- 自定义歌词颜色（调色盘选色） ----------

test('组件：options.color 覆盖曲风渐变 / accent，并打 data-color="custom"', () => {
  const doc = fakeDocument();
  const overlay = createLyricsOverlay({ document: doc, color: '#ff3366' });
  overlay.attach(doc.body);
  const root = doc.querySelector('.lyrics-overlay');

  assert.equal(overlay.getColor(), '#ff3366');
  assert.equal(root.dataset.color, 'custom');
  assert.equal(root.style._props['--lyrics-accent'], '#ff3366');
  assert.match(root.style._props['--lyrics-gradient'], /^linear-gradient\(115deg, #[0-9a-f]{6} 0%/);
  assert.ok(root.style._props['--lyrics-gradient'].includes('#ff3366'));
  assert.equal(root.dataset.mood, 'calm', '曲风仍是自动识别的 calm');
  overlay.dispose();
});

test('组件：setColor 覆盖 / 清空恢复当前曲风，setMood 不吞掉自定义色', () => {
  const doc = fakeDocument();
  const overlay = createLyricsOverlay({ document: doc });
  overlay.attach(doc.body);
  const root = doc.querySelector('.lyrics-overlay');

  // 默认跟随曲风：没有自定义色标记。
  assert.equal(overlay.getColor(), null);
  assert.equal(root.dataset.color, undefined);
  assert.equal(root.style._props['--lyrics-accent'], MOOD_STYLES.calm.accent);

  overlay.setColor('#33cc99');
  assert.equal(overlay.getColor(), '#33cc99');
  assert.equal(root.dataset.color, 'custom');
  assert.equal(root.style._props['--lyrics-accent'], '#33cc99');
  const customGradient = root.style._props['--lyrics-gradient'];
  assert.ok(customGradient.includes('#33cc99'));

  // 切曲风：字体 / 背景 / 排版变，自定义渐变与 accent 不变。
  overlay.setMood('epic');
  assert.equal(root.dataset.mood, 'epic');
  assert.equal(root.dataset.color, 'custom');
  assert.equal(root.style._props['--lyrics-gradient'], customGradient);
  assert.equal(root.style._props['--lyrics-accent'], '#33cc99');
  assert.equal(root.style._props['--lyrics-font'], MOOD_STYLES.epic.font);
  assert.equal(root.style._props['--lyrics-background'], MOOD_STYLES.epic.background);
  assert.equal(root.style._props['--lyrics-weight'], String(MOOD_STYLES.epic.weight));
  assert.equal(root.style._props['--lyrics-tracking'], MOOD_STYLES.epic.tracking);

  // 清空 → 立刻恢复“当前曲风”（epic）的颜色。
  overlay.setColor(null);
  assert.equal(overlay.getColor(), null);
  assert.equal(root.dataset.color, undefined);
  assert.equal(root.style._props['--lyrics-gradient'], MOOD_STYLES.epic.gradient);
  assert.equal(root.style._props['--lyrics-accent'], MOOD_STYLES.epic.accent);

  // 非法颜色等同清空（不会留下坏值）。
  overlay.setColor('#123456');
  assert.equal(overlay.getColor(), '#123456');
  assert.equal(overlay.setColor('不是颜色'), null);
  assert.equal(overlay.getColor(), null);
  assert.equal(root.style._props['--lyrics-gradient'], MOOD_STYLES.epic.gradient);
  overlay.dispose();
});

test('组件：自定义色在 setLyrics 自动分类曲风后仍保留', () => {
  const doc = fakeDocument();
  const overlay = createLyricsOverlay({ document: doc, color: '#AABBCC' });
  overlay.attach(doc.body);
  overlay.setLyrics('[00:01.00]眼泪\n[00:02.00]孤独'); // 自动分类 → sad

  const root = doc.querySelector('.lyrics-overlay');
  assert.equal(root.dataset.mood, 'sad');
  assert.equal(overlay.getColor(), '#aabbcc', '归一化为小写');
  assert.equal(root.dataset.color, 'custom');
  assert.equal(root.style._props['--lyrics-accent'], '#aabbcc');
  assert.ok(root.style._props['--lyrics-gradient'].includes('#aabbcc'));
  assert.notEqual(root.style._props['--lyrics-gradient'], MOOD_STYLES.sad.gradient);

  // 再次 setDemo 也保留用户颜色。
  overlay.setDemo();
  assert.equal(root.dataset.mood, 'calm');
  assert.equal(root.dataset.color, 'custom');
  assert.equal(root.style._props['--lyrics-accent'], '#aabbcc');
  overlay.dispose();
});

test('组件：颜色 API 在无 DOM 环境安全，update / onLineChange 不受影响', () => {
  const overlay = createLyricsOverlay({ color: '#ABCDEF', demo: false });
  assert.equal(overlay.getColor(), '#abcdef');
  assert.equal(overlay.setColor('#112233'), '#112233');
  assert.equal(overlay.getColor(), '#112233');
  assert.equal(overlay.setColor(null), null);
  assert.equal(overlay.getColor(), null);
  overlay.dispose();

  const events = [];
  const tracked = createLyricsOverlay({
    demo: false,
    color: '#ff8800',
    onLineChange: (line) => events.push(line),
  });
  tracked.setLyrics('[00:05.00]开头\n[00:10.00]中间');
  const line = tracked.update(6);
  assert.equal(line.text, '开头');
  assert.equal(tracked.getColor(), '#ff8800');
  assert.equal(events.at(-1).text, '开头');
  tracked.dispose();
});

// ---------- 假 document（仅用于组件 DOM 路径的轻量冒烟测试） ----------

function fakeDocument() {
  const queryWithin = (element, selector) => {
    for (const child of element.children) {
      if (matches(child, selector)) return child;
      const found = queryWithin(child, selector);
      if (found) return found;
    }
    return null;
  };

  const createElement = () => {
    const element = {
      tagName: 'div',
      className: '',
      children: [],
      parent: null,
      isConnected: false,
      dataset: {},
      textContent: '',
      style: {
        _props: {},
        setProperty(key, value) {
          this._props[key] = value;
        },
      },
      setAttribute() {},
      append(...nodes) {
        for (const node of nodes) {
          node.parent = this;
          node.isConnected = this.isConnected;
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
          node.isConnected = this.isConnected;
        }
      },
      remove() {
        if (!this.parent) return;
        this.parent.children = this.parent.children.filter((child) => child !== this);
        this.parent = null;
        this.isConnected = false;
      },
      querySelector(selector) {
        return queryWithin(this, selector);
      },
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 100, height: 24 };
      },
    };
    // 与真实 DOM 一致：classList 与 className 共享同一份集合。
    const sync = () => new Set(element.className.split(/\s+/).filter(Boolean));
    element.classList = {
      add(...names) {
        const set = sync();
        for (const name of names) set.add(name);
        element.className = [...set].join(' ');
      },
      remove(...names) {
        const set = sync();
        for (const name of names) set.delete(name);
        element.className = [...set].join(' ');
      },
      toggle(name, force) {
        const set = sync();
        const current = set.has(name);
        const should = force === undefined ? !current : Boolean(force);
        if (should) set.add(name);
        else set.delete(name);
        element.className = [...set].join(' ');
        return should;
      },
      contains(name) {
        return sync().has(name);
      },
    };
    return element;
  };

  const matches = (element, selector) => {
    const classes = selector.replace(/^\s*\./, '').replace(/\s+$/, '').split('.');
    if (classes.length === 0) return false;
    return classes.every((cls) => element.classList.contains(cls));
  };

  const body = createElement();
  body.tagName = 'body';
  body.isConnected = true;
  return { createElement, body, querySelector: (selector) => queryWithin(body, selector) };
}
test('stripLeadingCredits 去掉开头制作名单，正文同类词保留', () => {
  const lines = [
    { time: 0, text: 'Aurora - Luna (Jay Chou)' },
    { time: 0, text: '词：Luna' },
    { time: 0, text: '曲：Luna' },
    { time: 0, text: '合声：Luna' },
    { time: 0, text: '录音助理：刘勇志' },
    { time: 3, text: '示例歌词第一句' },
    { time: 4, text: '曲终人散' },
    { time: 5, text: '他说：走吧' },
  ];
  const kept = stripLeadingCredits(lines);
  assert.deepEqual(kept.map((line) => line.text), ['示例歌词第一句', '曲终人散', '他说：走吧']);
  assert.equal(stripLeadingCredits([]).length, 0);
  assert.equal(stripLeadingCredits([{ text: '第一句' }])[0].text, '第一句');
});
// 逐字歌词：解析增强 LRC 的行内逐字时间标签（<mm:ss.xx>），
// 没有逐字数据时按整行时长把文字均分到字/词上，保证「逐字样式」永远有进度可播。
//
// 产出结构（lines）：
//   { time, endTime, text, words: [{ text, time, endTime }], meta? }
// words 的时间单调递增，最后一个词的 endTime = 下一行开始（或本行 + 4s）。

const LINE_TAG_SOURCE = '(\\d{1,3}):(\\d{1,2})(?:\\.(\\d{1,3}))?';
const LINE_TAG = new RegExp(`\\[${LINE_TAG_SOURCE}\\]`, 'g');
const WORD_TAG = new RegExp(`<${LINE_TAG_SOURCE}>`, 'g');
const META_TAG = /^\[([a-z]+):([^\]]*)\]$/i;
const META_KEYS = ['ti', 'ar', 'al', 'by', 'offset', 're', 've', 'length'];
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/;
const PUNCT = /[，。！？、；：,.!?;:…—～~"'“”‘’（）()《》【】\[\]]/;

function toTime(minutes, seconds, fraction) {
  const fractionValue = fraction ? Number(`0.${fraction}`) : 0;
  return Number(minutes) * 60 + Number(seconds) + fractionValue;
}

/** 把一行文字切成「字 / 词」：CJK 单字，拉丁按词，标点粘到前一个 token。 */
export function tokenizeText(text) {
  const tokens = [];
  const source = String(text ?? '');
  let current = '';
  let currentKind = '';
  const flush = () => {
    if (current) tokens.push({ text: current });
    current = '';
    currentKind = '';
  };
  for (const char of source) {
    if (/\s/.test(char)) {
      flush();
      // 空格并入前一个 token，避免逐字时单词被拆开
      if (tokens.length) tokens[tokens.length - 1].text += ' ';
      continue;
    }
    if (PUNCT.test(char)) {
      flush();
      if (tokens.length) tokens[tokens.length - 1].text += char;
      else tokens.push({ text: char });
      continue;
    }
    // 中日韩字符逐字成 token（karaoke 逐字点亮），拉丁字母按单词聚合
    if (CJK.test(char)) {
      flush();
      tokens.push({ text: char });
      currentKind = '';
      continue;
    }
    if (currentKind !== 'latin') {
      flush();
      currentKind = 'latin';
    }
    current += char;
  }
  flush();
  return tokens.filter((token) => token.text.trim());
}

/** 从行内容里拆出行内 `<mm:ss.xx>` 逐字时间（没有则返回空数组）。 */
function extractInlineWords(content, lineTime) {
  WORD_TAG.lastIndex = 0;
  const matches = [...content.matchAll(WORD_TAG)];
  if (!matches.length) return [];
  const words = [];
  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];
    const start = match.index + match[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : content.length;
    const text = content.slice(start, end);
    if (!text) continue;
    words.push({ text, time: toTime(match[1], match[2], match[3]) });
  }
  if (!words.length) return [];
  // 第一个词之前如果还有文字，挂到行首
  if (matches[0].index > 0) {
    const leading = content.slice(0, matches[0].index);
    if (leading.trim()) words.unshift({ text: leading, time: lineTime });
  }
  return words;
}

/**
 * 解析 LRC（含逐字标签），并给每行补齐 endTime / words。
 * 与 parseLRC 的区别：不丢弃行内 `<mm:ss>` 信息，且输出会带 words 字段。
 */
export function parseLyricsWithWords(text) {
  if (typeof text !== 'string' || !text) return [];
  const rawLines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const meta = {};
  const out = [];
  for (const rawLine of rawLines) {
    const line = rawLine.trim();
    if (!line) continue;
    const times = [];
    LINE_TAG.lastIndex = 0;
    let match;
    while ((match = LINE_TAG.exec(line)) !== null) {
      if (Number(match[2]) > 59) continue;
      times.push(toTime(match[1], match[2], match[3]));
    }
    if (times.length > 0) {
      const content = line.replace(LINE_TAG, '').trim();
      const words = extractInlineWords(content, times[0]);
      const plain = words.length ? words.map((word) => word.text).join('') : content;
      for (const time of times) out.push({ time, text: plain, words: words.length ? words : undefined });
      continue;
    }
    const metaMatch = line.match(META_TAG);
    if (metaMatch && META_KEYS.includes(metaMatch[1].toLowerCase())) {
      meta[metaMatch[1].toLowerCase()] = metaMatch[2].trim();
    }
  }
  out.sort((a, b) => a.time - b.time);
  if (Object.keys(meta).length) for (const entry of out) entry.meta = meta;
  return attachWordTimings(out);
}

/**
 * 补全每行的 endTime 与 words（原地修改并返回同一数组）。
 * 有逐字标签时保留；没有时把整行时长按字/词数量均分。
 */
export function attachWordTimings(lines, { defaultLineMs = 4000 } = {}) {
  if (!Array.isArray(lines)) return [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const next = lines[i + 1];
    const endTime = Number.isFinite(line.endTime)
      ? line.endTime
      : next?.time ?? line.time + defaultLineMs / 1000;
    line.endTime = endTime;
    if (Array.isArray(line.words) && line.words.length) {
      for (let w = 0; w < line.words.length; w += 1) {
        const word = line.words[w];
        word.endTime = line.words[w + 1]?.time ?? endTime;
      }
      continue;
    }
    const tokens = tokenizeText(line.text);
    if (!tokens.length) {
      line.words = [];
      continue;
    }
    const span = Math.max(0.12, endTime - line.time);
    const totalChars = tokens.reduce((sum, token) => sum + Math.max(1, token.text.length), 0);
    let cursor = line.time;
    line.words = tokens.map((token) => {
      const weight = Math.max(1, token.text.length) / totalChars;
      const duration = Math.max(0.06, span * weight);
      const word = { text: token.text, time: Number(cursor.toFixed(3)) };
      cursor += duration;
      return word;
    });
    for (let w = 0; w < line.words.length; w += 1) {
      line.words[w].endTime = line.words[w + 1]?.time ?? Number(endTime.toFixed(3));
    }
  }
  return lines;
}

/** 当前时刻某行的逐字进度（0..1），用于渲染高亮。 */
export function wordProgressAt(line, currentTime) {
  const words = line?.words;
  if (!words?.length) return 0;
  const t = Number(currentTime);
  if (!Number.isFinite(t) || t < words[0].time) return 0;
  const last = words[words.length - 1];
  if (t >= (last.endTime ?? last.time)) return 1;
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    const end = word.endTime ?? words[i + 1]?.time ?? line.endTime ?? word.time + 0.5;
    if (t < word.time) return i / words.length;
    if (t < end) {
      const local = (t - word.time) / Math.max(0.05, end - word.time);
      return (i + Math.max(0, Math.min(1, local))) / words.length;
    }
  }
  return 1;
}

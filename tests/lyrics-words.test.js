import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attachWordTimings,
  parseLyricsWithWords,
  tokenizeText,
  wordProgressAt,
} from '../src/lyrics-words.js';
import {
  getLyricStyle,
  hasLyricStyle,
  listLyricStyles,
  lyricStyleTable,
  registerLyricStyle,
  resetLyricStyles,
} from '../src/lyrics-styles.js';

test('tokenizeText：中文按字、英文按词、标点粘到前一个', () => {
  assert.deepEqual(tokenizeText('夜色缓缓落下').map((t) => t.text), ['夜', '色', '缓', '缓', '落', '下']);
  assert.deepEqual(tokenizeText('Hold on my temperature').map((t) => t.text.trim()), ['Hold', 'on', 'my', 'temperature']);
  const mixed = tokenizeText('我爱你，baby!').map((t) => t.text);
  assert.deepEqual(mixed, ['我', '爱', '你，', 'baby!']);
  assert.deepEqual(tokenizeText(''), []);
  assert.deepEqual(tokenizeText('   '), []);
});

test('parseLyricsWithWords：增强 LRC 逐字标签优先', () => {
  const text = '[00:10.00]<00:10.00>你<00:10.50>的<00:11.00>温柔\n[00:12.00]整行没有逐字';
  const lines = parseLyricsWithWords(text);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].text, '你的温柔');
  assert.deepEqual(lines[0].words.map((w) => w.text), ['你', '的', '温柔']);
  assert.deepEqual(lines[0].words.map((w) => w.time), [10, 10.5, 11]);
  assert.equal(lines[0].endTime, 12);
  assert.equal(lines[0].words[2].endTime, 12);
  // 第二行没有逐字标签 → 按字数均分 [12, 16]
  assert.equal(lines[1].endTime, 16);
  assert.ok(lines[1].words.length > 0);
  assert.ok(lines[1].words[0].time >= 12);
});

test('attachWordTimings：给普通行补 words/endTime，并保持时间单调', () => {
  const lines = [
    { time: 0, text: '第一句歌词' },
    { time: 4, text: '第二句' },
  ];
  attachWordTimings(lines);
  assert.equal(lines[0].endTime, 4);
  assert.equal(lines[1].endTime, 8, '最后一行默认 +4s');
  for (const line of lines) {
    assert.ok(line.words.length > 0);
    for (let i = 1; i < line.words.length; i += 1) {
      assert.ok(line.words[i].time >= line.words[i - 1].time);
    }
    assert.equal(line.words[line.words.length - 1].endTime, line.endTime);
  }
});

test('parseLyricsWithWords 容错：空文本、元数据、多时间标签', () => {
  assert.deepEqual(parseLyricsWithWords(''), []);
  assert.deepEqual(parseLyricsWithWords(null), []);
  const lines = parseLyricsWithWords('[ti:测试]\n[00:01.00][00:03.00]重复句');
  assert.equal(lines.length, 2);
  assert.equal(lines[0].meta.ti, '测试');
  assert.equal(lines[1].time, 3);
});

test('wordProgressAt：按词时间给出 0..1 进度', () => {
  const line = {
    time: 0,
    endTime: 2,
    words: [
      { text: 'a', time: 0, endTime: 1 },
      { text: 'b', time: 1, endTime: 2 },
    ],
  };
  assert.equal(wordProgressAt(line, -1), 0);
  assert.equal(wordProgressAt(line, 0.5), 0.25);
  assert.equal(wordProgressAt(line, 1), 0.5);
  assert.equal(wordProgressAt(line, 2), 1);
  assert.equal(wordProgressAt({ words: [] }, 1), 0);
});

test('歌词样式注册表：内置二十种，可注册自定义，未知回退 classic', () => {
  resetLyricStyles();
  assert.equal(listLyricStyles().length, 20);
  assert.ok(hasLyricStyle('karaoke'));
  assert.equal(getLyricStyle('karaoke').wordTiming, true);
  assert.equal(getLyricStyle('nope').id, 'classic');
  for (const id of ['apple', 'typewriter', 'glow', 'cinema', 'bounce', 'outline', 'island', 'focus', 'duet', 'drift', 'swing', 'vertical', 'kinetic', 'glitch', 'scatter', 'pulse', 'chat']) assert.ok(hasLyricStyle(id), `${id} 应内置`);
  assert.equal(lyricStyleTable().karaoke.label, '逐字');

  const custom = registerLyricStyle({ id: 'neon', label: '霓虹', wordTiming: true });
  assert.equal(custom.id, 'neon');
  assert.ok(hasLyricStyle('neon'));
  assert.equal(listLyricStyles().at(-1).id, 'neon');
  assert.equal(lyricStyleTable().neon.label, '霓虹');

  assert.throws(() => registerLyricStyle({ id: 'Bad Id' }), /非法歌词样式 id/);
  assert.throws(() => registerLyricStyle(null), /必须是对象/);
  resetLyricStyles();
  assert.equal(listLyricStyles().length, 20);
});

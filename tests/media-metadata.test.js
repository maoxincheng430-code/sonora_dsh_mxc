import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidEmbeddedLyrics, readMediaMetadata } from '../src/media-metadata.js';

// ---------- 构造 MP4 测试文件（ftyp + mdat + moov/udta/meta/ilst） ----------
function u32(value) {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}
function concat(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
function boxRaw(typeBytes, payload = new Uint8Array(0)) {
  return concat([new Uint8Array(u32(8 + payload.length)), new Uint8Array(typeBytes), payload]);
}
function box(type, payload = new Uint8Array(0)) {
  return boxRaw(new TextEncoder().encode(type), payload);
}
// MP4 ilst 的键是 4 字节 atom，其中 © 是单字节 0xA9（不是 UTF-8 的 C2 A9）
const ILST = {
  title: [0xa9, 0x6e, 0x61, 0x6d],
  artist: [0xa9, 0x41, 0x52, 0x54],
  album: [0xa9, 0x61, 0x6c, 0x62],
  lyrics: [0xa9, 0x6c, 0x79, 0x72],
};
function ilstEntry(typeBytes, text) {
  // data box: 4 字节类型(1) + 4 字节 locale + UTF-8 文本
  const data = box(
    'data',
    concat([new Uint8Array([0, 0, 0, 1]), new Uint8Array([0, 0, 0, 0]), new TextEncoder().encode(text)]),
  );
  return boxRaw(typeBytes, data);
}
function mp4File({ title, artist, album, lyrics, name = 'song.mp4' } = {}) {
  const entries = [];
  if (title) entries.push(ilstEntry(ILST.title, title));
  if (artist) entries.push(ilstEntry(ILST.artist, artist));
  if (album) entries.push(ilstEntry(ILST.album, album));
  if (lyrics) entries.push(ilstEntry(ILST.lyrics, lyrics));
  const ilst = box('ilst', concat(entries));
  const meta = box('meta', concat([new Uint8Array([0, 0, 0, 0]), ilst])); // full box: version/flags
  const udta = box('udta', meta);
  const moov = box('moov', udta);
  const ftyp = box('ftyp', new TextEncoder().encode('isomisom'));
  const mdat = box('mdat', new Uint8Array(64).fill(7));
  return new File([ftyp, mdat, moov], name, { type: 'video/mp4' });
}

// ---------- 构造 ID3v2.3 MP3 测试文件 ----------
function syncsafe(value) {
  return [(value >>> 21) & 0x7f, (value >>> 14) & 0x7f, (value >>> 7) & 0x7f, value & 0x7f];
}
function id3TextFrame(id, text) {
  const payload = concat([new Uint8Array([3]), new TextEncoder().encode(text)]); // 3 = UTF-8
  return concat([new TextEncoder().encode(id), new Uint8Array(u32(payload.length)), new Uint8Array([0, 0]), payload]);
}
function id3Uslt(lyrics) {
  const payload = concat([
    new Uint8Array([3]), // UTF-8
    new TextEncoder().encode('eng'),
    new Uint8Array([0]), // 空描述
    new TextEncoder().encode(lyrics),
  ]);
  return concat([new TextEncoder().encode('USLT'), new Uint8Array(u32(payload.length)), new Uint8Array([0, 0]), payload]);
}
function mp3File({ title, artist, lyrics } = {}) {
  const frames = [];
  if (title) frames.push(id3TextFrame('TIT2', title));
  if (artist) frames.push(id3TextFrame('TPE1', artist));
  if (lyrics) frames.push(id3Uslt(lyrics));
  const body = concat(frames);
  const tag = concat([new TextEncoder().encode('ID3'), new Uint8Array([3, 0, 0]), new Uint8Array(syncsafe(body.length))]);
  return new File([tag, body, new Uint8Array(128)], 'song.mp3', { type: 'audio/mpeg' });
}

const LRC = '[00:01.00]第一句歌词\n[00:03.50]第二句歌词';

test('readMediaMetadata reads MP4 ilst tags including embedded lyrics', async () => {
  const tags = await readMediaMetadata(mp4File({ title: 'Midnight Rain', artist: 'Blue Harbor', album: 'Grey Album', lyrics: LRC }));
  assert.ok(tags, 'should return tags');
  assert.equal(tags.title, 'Midnight Rain');
  assert.equal(tags.artist, 'Blue Harbor');
  assert.equal(tags.album, 'Grey Album');
  assert.equal(tags.lyrics, LRC);
});

test('readMediaMetadata finds moov even when it sits after a large mdat', async () => {
  const tags = await readMediaMetadata(mp4File({ title: 'Aurora', artist: 'Luna' }));
  assert.equal(tags.title, 'Aurora');
  assert.equal(tags.artist, 'Luna');
});

test('readMediaMetadata reads MP3 ID3v2 tags and USLT lyrics', async () => {
  const tags = await readMediaMetadata(mp3File({ title: 'Comet', artist: 'Nova', lyrics: LRC }));
  assert.ok(tags);
  assert.equal(tags.title, 'Comet');
  assert.equal(tags.artist, 'Nova');
  assert.equal(tags.lyrics, LRC);
});

test('readMediaMetadata returns null for unknown or broken files', async () => {
  assert.equal(await readMediaMetadata(new File([new Uint8Array(200).fill(9)], 'unknown.bin')), null);
  assert.equal(await readMediaMetadata(new File([], 'empty.mp4', { type: 'video/mp4' })), null);
  assert.equal(await readMediaMetadata(null), null);
  assert.equal(await readMediaMetadata({ size: 1 }), null); // 没有 slice
});

test('readMediaMetadata ignores files without tags', async () => {
  assert.equal(await readMediaMetadata(mp4File({})), null);
});

test('isValidEmbeddedLyrics requires at least two timestamped lines', () => {
  assert.equal(isValidEmbeddedLyrics(LRC), true);
  assert.equal(isValidEmbeddedLyrics('[00:01.00]只有一句'), false);
  assert.equal(isValidEmbeddedLyrics('没有时间轴的纯文本\n第二行'), false);
  assert.equal(isValidEmbeddedLyrics(''), false);
  assert.equal(isValidEmbeddedLyrics(undefined), false);
});

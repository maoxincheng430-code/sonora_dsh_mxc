import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterTracks,
  formatAddedAt,
  formatBytes,
  formatDate,
  formatDuration,
  needsBackfill,
  normalizeTrack,
  parseTrackName,
  sortTracks,
  summarizeTracks,
} from '../src/library-model.js';

test('parseTrackName reads "歌手 - 歌名" and trims spaces around the separator', () => {
  assert.deepEqual(parseTrackName('Luna - Aurora.mp3'), { title: 'Aurora', artist: 'Luna' });
  assert.deepEqual(parseTrackName('  Luna   -   Aurora  .mp3'), { title: 'Aurora', artist: 'Luna' });
  assert.deepEqual(parseTrackName('Adele - Rolling in the Deep.flac'), {
    title: 'Rolling in the Deep',
    artist: 'Adele',
  });
  // 分隔符 - – — 都支持，两侧空格可有可无（ASCII 连字符必须带空格，见下一条用例）
  assert.deepEqual(parseTrackName('Jay Chou – Aurora.wav'), { title: 'Aurora', artist: 'Jay Chou' });
  assert.deepEqual(parseTrackName('Luna—Aurora.wav'), { title: 'Aurora', artist: 'Luna' });
  // 文件名里只有第一个分隔符切分歌手 / 歌名
  assert.deepEqual(parseTrackName('Luna - Aurora - Live.mp3'), { title: 'Aurora - Live', artist: 'Luna' });
});

test('parseTrackName keeps an unspaced ASCII hyphen inside the name', () => {
  assert.deepEqual(parseTrackName('A-Lin.mp3'), { title: 'A-Lin', artist: '' });
  assert.deepEqual(parseTrackName('Hip-Hop 精选.mp3'), { title: 'Hip-Hop 精选', artist: '' });
  assert.deepEqual(parseTrackName('A-Lin - 给我一个理由忘记.mp3'), {
    title: '给我一个理由忘记',
    artist: 'A-Lin',
  });
});

test('parseTrackName falls back to the bare filename and strips extensions', () => {
  assert.deepEqual(parseTrackName('Aurora.mp3'), { title: 'Aurora', artist: '' });
  assert.deepEqual(parseTrackName('Aurora.MP3'), { title: 'Aurora', artist: '' });
  assert.deepEqual(parseTrackName('night drive.flac'), { title: 'night drive', artist: '' });
  assert.deepEqual(parseTrackName('').title, '');
  assert.deepEqual(parseTrackName('').artist, '');
  assert.deepEqual(parseTrackName('.mp3'), { title: '', artist: '' });
  assert.deepEqual(parseTrackName(null), { title: '', artist: '' });
  assert.deepEqual(parseTrackName(undefined), { title: '', artist: '' });
});

test('parseTrackName removes leading track numbers', () => {
  assert.deepEqual(parseTrackName('01. Luna - Aurora.mp3'), { title: 'Aurora', artist: 'Luna' });
  assert.deepEqual(parseTrackName('02 - Luna - Aurora.mp3'), { title: 'Aurora', artist: 'Luna' });
  assert.deepEqual(parseTrackName('03、夜曲.flac'), { title: '夜曲', artist: '' });
  assert.deepEqual(parseTrackName('01.Aurora.wav'), { title: 'Aurora', artist: '' });
  assert.deepEqual(parseTrackName('07) Aurora.ogg'), { title: 'Aurora', artist: '' });
  // 小数点开头的曲名不应被误当成序号
  assert.deepEqual(parseTrackName('99.9 电台.mp3'), { title: '99.9 电台', artist: '' });
});

test('normalizeTrack backfills a v1 record without losing or inventing data', () => {
  const old = {
    id: '["Luna - Aurora.mp3",2048,42]',
    name: 'Luna - Aurora.mp3',
    type: 'audio/mpeg',
    duration: 269.5,
    size: 2048,
    lastModified: 42,
    importedAt: 1700000000000,
  };
  const track = normalizeTrack(old);
  assert.equal(track.title, 'Aurora');
  assert.equal(track.artist, 'Luna');
  assert.equal(track.addedAt, 1700000000000);
  assert.equal(track.importedAt, 1700000000000);
  assert.equal(track.playCount, 0);
  assert.equal(track.lastPlayedAt, 0);
  assert.equal(track.duration, 269.5);
  assert.equal(track.size, 2048);
  assert.equal(track.name, 'Luna - Aurora.mp3');
  assert.ok(!('blob' in track));
  assert.equal(needsBackfill(old), true);
  assert.equal(needsBackfill(track), false);
  // 补全后的记录再次规范化应保持不变（幂等）
  assert.deepEqual(normalizeTrack(track), track);
});

test('normalizeTrack keeps user edits, drops blobs and sanitizes bad values', () => {
  const renamed = normalizeTrack({
    name: 'Luna - Aurora.mp3',
    title: 'Aurora（现场版）',
    artist: 'Luna',
    duration: '60',
    importedAt: 100,
    addedAt: 120,
    playCount: 4,
    lastPlayedAt: 456,
    blob: new Uint8Array([1, 2, 3]),
  });
  assert.equal(renamed.title, 'Aurora（现场版）');
  assert.equal(renamed.artist, 'Luna');
  assert.equal(renamed.duration, 60);
  assert.equal(renamed.playCount, 4);
  assert.equal(renamed.lastPlayedAt, 456);
  assert.ok(!('blob' in renamed));
  assert.equal(needsBackfill(renamed), false);

  const broken = normalizeTrack({ name: 'x.mp3', duration: 'oops', playCount: -3, lastPlayedAt: 'bad', size: -1 });
  assert.equal(broken.duration, 0);
  assert.equal(broken.playCount, 0);
  assert.equal(broken.lastPlayedAt, 0);
  assert.equal(broken.size, 0);
  assert.equal(broken.addedAt, 0);
  assert.equal(needsBackfill(broken), true);
  assert.equal(needsBackfill(null), false);
});

test('sortTracks orders by added / title / duration / play count without mutating input', () => {
  const tracks = [
    { id: 'a', title: 'Alpha', addedAt: 100, duration: 60, playCount: 2 },
    { id: 'b', title: 'Bravo', addedAt: 300, duration: 30, playCount: 5 },
    { id: 'c', title: 'Charlie', addedAt: 200, duration: 90, playCount: 0 },
  ];
  assert.deepEqual(sortTracks(tracks, 'added').map((track) => track.id), ['b', 'c', 'a']);
  assert.deepEqual(sortTracks(tracks, 'title').map((track) => track.id), ['a', 'b', 'c']);
  assert.deepEqual(sortTracks(tracks, 'duration').map((track) => track.id), ['c', 'a', 'b']);
  assert.deepEqual(sortTracks(tracks, 'plays').map((track) => track.id), ['b', 'a', 'c']);
  assert.deepEqual(tracks.map((track) => track.id), ['a', 'b', 'c']);
  // 默认与未知排序键都按最近添加倒序
  assert.deepEqual(sortTracks(tracks).map((track) => track.id), ['b', 'c', 'a']);
  assert.deepEqual(sortTracks(tracks, 'unknown').map((track) => track.id), ['b', 'c', 'a']);
  // 旧记录没有 addedAt 时回退到 importedAt
  assert.deepEqual(
    sortTracks([{ id: 'x', importedAt: 10 }, { id: 'y', importedAt: 20 }], 'added').map((track) => track.id),
    ['y', 'x'],
  );
  assert.deepEqual(sortTracks(null, 'added'), []);
});

test('filterTracks matches title, artist and filename case-insensitively', () => {
  const tracks = [
    { title: 'Aurora', artist: 'Luna', name: 'Luna - Aurora.mp3' },
    { title: '夜曲', artist: 'Luna', name: 'Luna - 夜曲.mp3' },
    { title: 'Rolling in the Deep', artist: 'Adele', name: 'Adele - Rolling in the Deep.mp3' },
  ];
  assert.equal(filterTracks(tracks, 'Luna').length, 2);
  assert.equal(filterTracks(tracks, 'Luna')[0].title, 'Aurora');
  assert.equal(filterTracks(tracks, 'deep').length, 1);
  assert.equal(filterTracks(tracks, '  ADELE  ').length, 1);
  assert.equal(filterTracks(tracks, '.mp3').length, 3);
  assert.equal(filterTracks(tracks, '夜曲').length, 1);
  assert.equal(filterTracks(tracks, '不存在的歌').length, 0);
  assert.equal(filterTracks(tracks, '').length, 3);
  assert.equal(filterTracks(tracks, null).length, 3);
  const copy = filterTracks(tracks, '');
  assert.deepEqual(copy.map((track) => track.title), tracks.map((track) => track.title));
  assert.notEqual(copy, tracks);
  assert.deepEqual(filterTracks(null, 'x'), []);
});

test('formatDuration renders minutes, hours and invalid values', () => {
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(59.9), '0:59');
  assert.equal(formatDuration(65), '1:05');
  assert.equal(formatDuration(600), '10:00');
  assert.equal(formatDuration(3723), '1:02:03');
  assert.equal(formatDuration(-5), '0:00');
  assert.equal(formatDuration('bad'), '0:00');
  assert.equal(formatDuration(undefined), '0:00');
  assert.equal(formatDuration(null), '0:00');
});

test('formatBytes renders readable units and clamps invalid values', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(-1), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1023), '1023 B');
  assert.equal(formatBytes(1024), '1 KB');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(1048576), '1 MB');
  assert.equal(formatBytes(5.5 * 1048576), '5.5 MB');
  assert.equal(formatBytes(150 * 1024 * 1024), '150 MB');
  assert.equal(formatBytes(2 * 1024 ** 3), '2 GB');
  assert.equal(formatBytes('bad'), '0 B');
  assert.equal(formatBytes(undefined), '0 B');
});

test('formatAddedAt renders Chinese relative dates and falls back to an ISO date', () => {
  const now = new Date(2026, 9, 26, 12, 0, 0).getTime();
  assert.equal(formatAddedAt(new Date(2026, 9, 26, 8, 0, 0).getTime(), now), '今天');
  assert.equal(formatAddedAt(new Date(2026, 9, 25, 23, 0, 0).getTime(), now), '昨天');
  assert.equal(formatAddedAt(new Date(2026, 9, 23, 12, 0, 0).getTime(), now), '3 天前');
  assert.equal(formatAddedAt(new Date(2026, 9, 1, 12, 0, 0).getTime(), now), '2026-10-01');
  assert.equal(formatAddedAt(0, now), '');
  assert.equal(formatAddedAt('bad', now), '');
  assert.equal(formatDate(new Date(2026, 0, 5, 12, 0, 0).getTime()), '2026-01-05');
  assert.equal(formatDate(0), '');
});

test('summarizeTracks totals count, duration, size and play count', () => {
  assert.deepEqual(
    summarizeTracks([
      { duration: 60, size: 1024, playCount: 2 },
      { duration: 30.5, size: 2048, playCount: 3 },
    ]),
    { count: 2, duration: 90.5, size: 3072, plays: 5 },
  );
  assert.deepEqual(summarizeTracks([]), { count: 0, duration: 0, size: 0, plays: 0 });
  assert.deepEqual(summarizeTracks(null), { count: 0, duration: 0, size: 0, plays: 0 });
  assert.deepEqual(summarizeTracks([{ duration: 'bad', size: 'bad', playCount: -2 }]), {
    count: 1,
    duration: 0,
    size: 0,
    plays: 0,
  });
});

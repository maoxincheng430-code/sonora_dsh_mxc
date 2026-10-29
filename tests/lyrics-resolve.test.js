import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildQueries,
  decodeKugouContent,
  fetchKugouLrc,
  isValidLrc,
  normalizeKey,
  orientCandidate,
  pickBestCandidate,
  resolveLyrics,
  scoreCandidate,
  searchKugou,
} from '../server/lyrics.js';

const LRC = '[00:01.00]第一句\n[00:03.50]第二句';

function b64(text) {
  return Buffer.from(text, 'utf8').toString('base64');
}

test('normalizeKey strips brackets, punctuation and case', () => {
  assert.equal(normalizeKey('Aurora（Live）.mp3'), 'aurora');
  assert.equal(normalizeKey('Luna_Star - Aurora（a winter aurora）.wav'), 'lunastaraurora');
  assert.equal(normalizeKey(''), '');
  assert.equal(normalizeKey(undefined), '');
});

test('isValidLrc needs at least two timestamp lines', () => {
  assert.equal(isValidLrc(LRC), true);
  assert.equal(isValidLrc('[00:01.00]只有一句'), false);
  assert.equal(isValidLrc('纯文本没有时间轴\n第二行'), false);
  assert.equal(isValidLrc(''), false);
});

test('decodeKugouContent decodes base64 and passes plain text through', () => {
  assert.equal(decodeKugouContent(b64(LRC)), LRC);
  assert.equal(decodeKugouContent(LRC), LRC);
  assert.equal(decodeKugouContent(''), '');
});

test('scoreCandidate ranks exact title + artist + duration highest', () => {
  const query = { title: 'Aurora', artist: 'Luna / Star', duration: 203 };
  const exact = scoreCandidate({ song: 'Aurora', singer: 'Luna、Star', duration: 203000 }, query);
  const wrongArtist = scoreCandidate({ song: 'Aurora', singer: '别的歌手', duration: 203000 }, query);
  const wrongTitle = scoreCandidate({ song: 'Comet', singer: 'Luna', duration: 203000 }, query);
  const wrongLength = scoreCandidate({ song: 'Aurora', singer: 'Luna、Star', duration: 30000 }, query);
  assert.ok(exact > wrongArtist, 'exact should beat wrong artist');
  assert.ok(exact > wrongLength, 'exact should beat wrong duration');
  // 歌名不匹配时即使歌手命中，也只有歌手分（低于 20 的选取阈值）
  assert.ok(wrongTitle < exact);
  assert.ok(wrongTitle < 20);
});

test('scoreCandidate tolerates swapped song/singer fields from Kugou', () => {
  const query = { title: 'Riverside', artist: 'Blue Harbor', duration: 205 };
  const normal = scoreCandidate({ song: 'Riverside', singer: 'Blue Harbor', duration: 205000 }, query);
  const swapped = scoreCandidate({ song: 'Blue Harbor', singer: 'Riverside', duration: 205000 }, query);
  const wrong = scoreCandidate({ song: 'Riverside', singer: '别的歌手', duration: 205000 }, query);
  assert.ok(swapped >= normal - 14, `swapped ${swapped} should still be high`);
  assert.ok(swapped > wrong, 'swapped title should beat an unrelated singer');
  assert.equal(orientCandidate({ song: 'Blue Harbor', singer: 'Riverside' }, query).title, 'Riverside');
  assert.equal(orientCandidate({ song: 'Blue Harbor', singer: 'Riverside' }, query).artist, 'Blue Harbor');
  assert.equal(orientCandidate({ song: 'Riverside', singer: 'Blue Harbor' }, query).title, 'Riverside');
});

test('pickBestCandidate ignores low scores and empty lists', () => {
  const query = { title: 'Aurora', artist: 'Luna' };
  const candidates = [
    { id: 1, song: 'Comet', singer: 'Nova', duration: 200000 },
    { id: 2, song: 'Aurora', singer: 'Luna', duration: 203000 },
  ];
  assert.equal(pickBestCandidate(candidates, query).candidate.id, 2);
  assert.equal(pickBestCandidate([], query), null);
  assert.equal(pickBestCandidate([{ id: 9, song: '别的歌', singer: '别人' }], query), null);
});

test('buildQueries prioritizes title+artist then falls back, no duplicates', () => {
  const queries = buildQueries({ title: 'Aurora', artist: 'Luna', name: 'Aurora.wav' });
  assert.equal(queries[0], 'Aurora Luna');
  assert.ok(queries.includes('Aurora'));
  assert.equal(new Set(queries).size, queries.length);
  assert.ok(queries.length <= 3);
  assert.deepEqual(buildQueries({}), []);
});

test('searchKugou and fetchKugouLrc work against a fake fetch', async () => {
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('/search')) {
      return { ok: true, json: async () => ({ candidates: [{ id: 42, accesskey: 'ak', song: 'Aurora', singer: 'Luna', duration: 203000 }] }) };
    }
    return { ok: true, json: async () => ({ content: b64(LRC) }) };
  };
  const candidates = await searchKugou('Aurora', fakeFetch);
  assert.equal(candidates.length, 1);
  const text = await fetchKugouLrc(candidates[0], fakeFetch);
  assert.equal(text, LRC);
  assert.ok(calls.every((url) => url.startsWith('https://krcs.kugou.com/')));
});

test('resolveLyrics finds lyrics through kugou and reports source', async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes('/search')) {
      return {
        ok: true,
        json: async () => ({
          candidates: [
            { id: 7, accesskey: 'k7', song: 'Aurora', singer: 'Luna、Star', duration: 203000 },
            { id: 8, accesskey: 'k8', song: 'Aurora（伴奏）', singer: 'Luna', duration: 203000 },
          ],
        }),
      };
    }
    return { ok: true, json: async () => ({ content: b64(LRC) }) };
  };
  const result = await resolveLyrics(
    { title: 'Aurora', artist: 'Luna / Star', name: 'Aurora.mp3', duration: 203 },
    { fetch: fetchImpl, netease: false },
  );
  assert.ok(result, 'should resolve lyrics');
  assert.equal(result.source, 'kugou');
  assert.equal(result.text, LRC);
  assert.equal(result.matched.title, 'Aurora');
});

test('resolveLyrics returns null when nothing matches', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ candidates: [] }) });
  const result = await resolveLyrics(
    { title: '不存在的歌', artist: '不存在的人', name: 'x.mp3', duration: 100 },
    { fetch: fetchImpl, netease: false },
  );
  assert.equal(result, null);
});

test('resolveLyrics tolerates network failures without throwing', async () => {
  const fetchImpl = async () => { throw new Error('offline'); };
  const result = await resolveLyrics(
    { title: 'Aurora', artist: 'Luna', name: 'Aurora.mp3' },
    { fetch: fetchImpl, netease: false },
  );
  assert.equal(result, null);
});
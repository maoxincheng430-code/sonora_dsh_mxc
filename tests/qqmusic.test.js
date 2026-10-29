import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeHtmlEntities,
  fetchQQMusicLyric,
  resolveQQMusic,
  searchQQMusic,
} from '../server/qqmusic.js';

const LRC = '[ti:Aurora]\n[ar:Luna]\n[00:01.00]示例歌词第一句\n[00:03.00]示例歌词第二句';

function jsonResponse(body) {
  return { ok: true, text: async () => JSON.stringify(body) };
}

test('decodeHtmlEntities restores QQ Music escaped lyrics', () => {
  assert.equal(decodeHtmlEntities('A&#58; B&#39;s &amp; C'), "A: B's & C");
  assert.equal(decodeHtmlEntities('&quot;hi&quot; &lt;x&gt;'), '"hi" <x>');
  assert.equal(decodeHtmlEntities(''), '');
  assert.equal(decodeHtmlEntities(undefined), '');
});

test('searchQQMusic maps smartbox results to candidates', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return jsonResponse({
      code: 0,
      data: {
        song: {
          itemlist: [
            { mid: '0000000000', name: 'Aurora', singer: 'Luna' },
            { mid: '0001', name: 'Aurora (Live)', singer: 'Luna' },
            { mid: '', name: '缺 mid' },
          ],
        },
      },
    });
  };
  const candidates = await searchQQMusic('Aurora Luna', fetchImpl);
  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates[0], { mid: '0000000000', song: 'Aurora', singer: 'Luna', duration: 0 });
  assert.ok(calls[0].includes('smartbox_new.fcg'));
  assert.ok(calls[0].includes(encodeURIComponent('Aurora Luna')));
});

test('fetchQQMusicLyric decodes the lyric payload and rejects junk', async () => {
  const good = async () => jsonResponse({ retcode: 0, lyric: LRC.replace('\n', '&#10;') });
  const text = await fetchQQMusicLyric('0000000000', good);
  assert.match(text, /示例歌词第一句/);

  const junk = async () => jsonResponse({ retcode: 0, lyric: '暂无歌词' });
  assert.equal(await fetchQQMusicLyric('x', junk), '');
  assert.equal(await fetchQQMusicLyric('', good), '');
});

test('resolveQQMusic matches the right song and returns LRC', async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes('smartbox_new.fcg')) {
      return jsonResponse({
        data: {
          song: {
            itemlist: [
              { mid: 'wrong', name: 'Aurora (伴奏)', singer: '别人的' },
              { mid: 'right', name: 'Aurora', singer: 'Luna' },
            ],
          },
        },
      });
    }
    return jsonResponse({ retcode: 0, lyric: LRC });
  };
  const result = await resolveQQMusic({ title: 'Aurora', artist: 'Luna', name: 'Aurora.mp3' }, fetchImpl);
  assert.ok(result);
  assert.equal(result.source, 'qqmusic');
  assert.equal(result.matched.title, 'Aurora');
  assert.equal(result.matched.artist, 'Luna');
  assert.match(result.text, /示例歌词第一句/);
});

test('resolveQQMusic returns null when nothing matches', async () => {
  const empty = async () => jsonResponse({ data: { song: { itemlist: [] } } });
  assert.equal(await resolveQQMusic({ title: '不存在', artist: '无' }, empty), null);
  const failing = async () => { throw new Error('offline'); };
  assert.equal(await resolveQQMusic({ title: 'Aurora', artist: 'Luna' }, failing), null);
  assert.equal(await resolveQQMusic({}, empty), null);
});

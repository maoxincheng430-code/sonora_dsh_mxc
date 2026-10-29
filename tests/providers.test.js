import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getLyric as getNeteaseLyric,
  getPlayUrl as getNeteasePlayUrl,
  getStatus as getNeteaseStatus,
  searchSongs as searchNeteaseSongs,
} from '../server/netease.js';
import {
  getLyric as getKugouLyric,
  getPlayUrl as getKugouPlayUrl,
  searchSongs as searchKugouSongs,
} from '../server/kugou.js';

function fakeFetch(routes) {
  const calls = [];
  const impl = async (url) => {
    const parsed = new URL(String(url));
    calls.push({ url: parsed, pathname: parsed.pathname });
    for (const [prefix, body] of Object.entries(routes)) {
      if (parsed.pathname.startsWith(prefix)) {
        return {
          ok: true,
          status: 200,
          text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
          headers: new Headers(),
        };
      }
    }
    return { ok: true, status: 200, text: async () => '{}', headers: new Headers() };
  };
  impl.calls = calls;
  return impl;
}

test('网易云：搜索字段归一化', async () => {
  const fetchImpl = fakeFetch({
    '/cloudsearch': {
      result: {
        songs: [
          { id: 1, name: 'Aurora', ar: [{ name: 'Luna' }], al: { name: 'Silver Album', picUrl: 'https://p1.music.126.net/a.jpg' }, dt: 269000 },
          { id: 2, name: '小星星', ar: [{ name: '儿歌多多' }, { name: '合唱' }], al: { name: '' }, dt: 120000 },
        ],
      },
    },
  });
  const songs = await searchNeteaseSongs('Aurora', { limit: 2 }, fetchImpl);
  assert.deepEqual(songs, [
    // 有 picUrl 时带上封面；没有则为空串（前端回退到首字封面）。
    { id: '1', name: 'Aurora', singer: 'Luna', album: 'Silver Album', cover: 'https://p1.music.126.net/a.jpg', duration: 269 },
    { id: '2', name: '小星星', singer: '儿歌多多 / 合唱', album: '', cover: '', duration: 120 },
  ]);
});

test('网易云：播放地址缺失时给出 VIP/版权提示', async () => {
  const miss = fakeFetch({ '/song/url/v1': { data: [{ id: 1, url: null }] } });
  await assert.rejects(() => getNeteasePlayUrl('1', miss), /VIP|版权/);
  const ok = fakeFetch({ '/song/url/v1': { data: [{ id: 1, url: 'http://cdn/a.mp3' }] } });
  assert.deepEqual(await getNeteasePlayUrl('1', ok), { url: 'http://cdn/a.mp3', restriction: 0 });
});

test('网易云：歌词与登录状态', async () => {
  const lyricFetch = fakeFetch({ '/lyric': { lrc: { lyric: '[00:01]你好' }, tlyric: { lyric: '[00:01]hello' } } });
  assert.deepEqual(await getNeteaseLyric('1', lyricFetch), { text: '[00:01]你好', trans: '[00:01]hello' });

  const anonymous = fakeFetch({ '/login/status': { data: { profile: null } } });
  assert.deepEqual(await getNeteaseStatus(anonymous), { loggedIn: false, profile: null, nickname: '', uin: '' });
  const logged = fakeFetch({ '/login/status': { data: { profile: { userId: 42, nickname: '云村村民' } } } });
  assert.deepEqual(await getNeteaseStatus(logged), {
    loggedIn: true,
    profile: { userId: 42, nickname: '云村村民' },
    nickname: '云村村民',
    uin: '42',
  });
});

test('酷狗：搜索字段归一化', async () => {
  const fetchImpl = fakeFetch({
    '/api/v3/search/song': {
      data: { info: [{ hash: 'ABC', songname: '无名小路', singername: '张迈', album_name: '专辑', duration: 200 }] },
    },
  });
  assert.deepEqual(await searchKugouSongs('无名小路', { limit: 1 }, fetchImpl), [
    { id: 'ABC', name: '无名小路', singer: '张迈', album: '专辑', duration: 200 },
  ]);
});

test('酷狗：播放地址缺失提示、歌词解码', async () => {
  const missing = fakeFetch({ '/app/i/getSongInfo.php': { songName: 'x', url: '' } });
  await assert.rejects(() => getKugouPlayUrl('ABC', missing), /登录|客户端/);
  const ok = fakeFetch({ '/app/i/getSongInfo.php': { url: 'https://cdn/x.mp3', pay_type: 0 } });
  assert.deepEqual(await getKugouPlayUrl('ABC', ok), { url: 'https://cdn/x.mp3', restriction: 0 });

  const lyricFetch = fakeFetch({
    '/search': { candidates: [{ id: 7, accesskey: 'KEY' }] },
    '/download': { content: Buffer.from('[00:01]你好', 'utf8').toString('base64') },
  });
  assert.deepEqual(await getKugouLyric('ABC', { name: '无名小路', artist: '张迈' }, lyricFetch), {
    text: '[00:01]你好',
    trans: '',
  });
  const none = fakeFetch({ '/search': { candidates: [] } });
  assert.deepEqual(await getKugouLyric('ABC', { name: 'x' }, none), { text: '', trans: '' });
});


test('网易云：cookie 净化只保留 name=value，去掉 Set-Cookie 属性', async () => {
  const { sanitizeCookie } = await import('../server/netease.js');
  assert.equal(
    sanitizeCookie(
      'MUSIC_U=abc==; Max-Age=315360000; Expires=Fri, 24 Oct 2036 13:50:31 GMT; Path=/; __csrf=xyz; Domain=.music.163.com; HttpOnly; SameSite=Lax',
    ),
    'MUSIC_U=abc==; __csrf=xyz',
  );
  assert.equal(sanitizeCookie(''), '');
  assert.equal(sanitizeCookie('Path=/; Secure'), '');
});

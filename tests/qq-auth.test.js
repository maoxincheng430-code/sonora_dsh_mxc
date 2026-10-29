import test from 'node:test';
import assert from 'node:assert/strict';
import {
  albumCoverUrl,
  ensureQQApi,
  getChannels,
  getLyric,
  getPlayUrl,
  logout,
  getStatus,
  hasSessionCookie,
  isQQApiInstalled,
  proxyStream,
  qrCancel,
  qrCheck,
  qrCreate,
  qrKey,
  searchSongs,
  stopQQApi,
} from '../server/qq-auth.js';

// 这些单测只验证「代理层」的请求组装与响应映射，不启动真实 qq-api 子进程。
process.env.QQ_API_AUTOSTART = 'false';

function response(body, status = 200, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (name) => headers[String(name).toLowerCase()] ?? null,
      getSetCookie: () => headers['set-cookie'] ?? [],
    },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function recordingFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
  return { calls, fetchImpl };
}

test('isQQApiInstalled 检测 tools/qq-api 是否装了包', () => {
  assert.equal(typeof isQQApiInstalled(), 'boolean');
});

test('ensureQQApi 在探活成功时复用已有服务', async () => {
  const { fetchImpl } = recordingFetch(() => response('{"code":200,"data":{}}'));
  const result = await ensureQQApi({ fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.started, false);
  stopQQApi();
});

test('getStatus 把空资料视为未登录，有资料视为已登录', async () => {
  const anonymous = recordingFetch(() => response('{"code":200,"data":{}}'));
  assert.deepEqual(await getStatus(anonymous.fetchImpl), { loggedIn: false, profile: {}, nickname: '', uin: '' });

  const logged = recordingFetch(() => response('{"code":200,"data":{"nickname":"阿声","uin":"10086"}}'));
  const status = await getStatus(logged.fetchImpl);
  assert.equal(status.loggedIn, true);
  assert.equal(status.profile.nickname, '阿声');
});

test('getChannels 读取可用登录通道', async () => {
  const { fetchImpl } = recordingFetch(() =>
    response('{"code":200,"data":{"channels":["qq","wechat","qqmusic"],"configured":true}}'),
  );
  const channels = await getChannels(fetchImpl);
  assert.deepEqual(channels.channels, ['qq', 'wechat', 'qqmusic']);
  assert.equal(channels.configured, true);
});

test('扫码三步：key → create → check 映射状态码', async () => {
  const keyCall = recordingFetch(() => response('{"code":200,"data":{"unikey":"K1"}}'));
  assert.deepEqual(await qrKey('wechat', keyCall.fetchImpl), { key: 'K1', channel: 'wechat' });
  assert.ok(keyCall.calls[0].url.includes('/login/qr/key'));
  assert.ok(keyCall.calls[0].url.includes('channel=wechat'));

  const createCall = recordingFetch(() => response('{"code":200,"data":{"qrimg":"data:image/png;base64,AAA"}}'));
  assert.deepEqual(await qrCreate('K1', createCall.fetchImpl), { image: 'data:image/png;base64,AAA' });

  const states = [
    ['800', 'expired'],
    ['801', 'waiting'],
    ['802', 'scanned'],
    ['803', 'ok'],
  ];
  for (const [code, expected] of states) {
    const checkCall = recordingFetch(() => response(JSON.stringify({ code: Number(code), message: 'x' })));
    const result = await qrCheck('K1', checkCall.fetchImpl);
    assert.equal(result.state, expected, `code ${code}`);
    assert.ok(checkCall.calls[0].url.includes('/login/qr/check'));
  }

  const cancelCall = recordingFetch(() => response('{"code":200}'));
  assert.deepEqual(await qrCancel('K1', cancelCall.fetchImpl), { ok: true });
  assert.ok(cancelCall.calls[0].url.includes('/login/qr/cancel'));
});

test('qrKey 在服务返回非 200 时抛出带状态码的错误', async () => {
  const { fetchImpl } = recordingFetch(() => response('{"code":400,"message":"bad"}', 400));
  await assert.rejects(() => qrKey('qq', fetchImpl), /bad/);
});

test('searchSongs 精简上游字段', async () => {
  const { fetchImpl } = recordingFetch(() =>
    response({
      code: 200,
      items: [
        { mid: 'M1', name: 'Aurora', singer: [{ name: 'Luna' }], album: { name: 'Silver Album' }, interval: 269 },
        { mid: '', name: '缺 mid' },
      ],
    }),
  );
  const songs = await searchSongs('Aurora', {}, fetchImpl);
  assert.deepEqual(songs, [
    { mid: 'M1', name: 'Aurora', singer: 'Luna', album: 'Silver Album', cover: '', duration: 269 },
  ]);
});

test('searchSongs 由专辑 mid 推导封面地址；albumCoverUrl 处理非法 mid', async () => {
  const { fetchImpl } = recordingFetch(() =>
    response({
      code: 200,
      items: [
        {
          mid: 'M1',
          name: 'Aurora',
          singer: [{ name: 'Luna' }],
          album: { mid: '000MkMni19ClKG', name: 'Silver Album' },
          interval: 269,
        },
      ],
    }),
  );
  const songs = await searchSongs('Aurora', {}, fetchImpl);
  assert.equal(
    songs[0].cover,
    'https://y.gtimg.cn/music/photo_new/T002R500x500M000000MkMni19ClKG.jpg',
  );

  // 尺寸可选，非法尺寸回退 500。
  assert.match(albumCoverUrl('000MkMni19ClKG', 300), /T002R300x300M000000MkMni19ClKG\.jpg$/);
  assert.match(albumCoverUrl('000MkMni19ClKG', 999), /T002R500x500M/);
  // mid 缺失或非法 → 空串（前端据此回退到首字封面）。
  assert.equal(albumCoverUrl(''), '');
  assert.equal(albumCoverUrl(null), '');
  assert.equal(albumCoverUrl('ab'), '');
  assert.equal(albumCoverUrl('!!!'), '');
});

test('getLyric 兼容 response.lyric 与直接 lyric 两种形状', async () => {
  const nested = recordingFetch(() =>
    response('{"response":{"lyric":{"lyric":"[00:01.00]第一句\\n[00:02.00]第二句","trans":""}}}'),
  );
  const a = await getLyric('M1', nested.fetchImpl);
  assert.match(a.text, /第一句/);

  const flat = recordingFetch(() => response('{"lyric":"[00:01.00]x\\n[00:02.00]y"}'));
  const b = await getLyric('M1', flat.fetchImpl);
  assert.match(b.text, /\[00:01\.00\]x/);
});

test('getPlayUrl 取 url，无权限时抛出 404 错误；proxyStream 转发 Range', async () => {
  const ok = recordingFetch((url) => {
    if (url.includes('/getMusicPlay/')) {
      return response('{"data":{"playUrl":{"M1":{"url":"https://cdn.example/song.mp3"}}}}');
    }
    return response('', 206, { 'content-type': 'audio/mpeg', 'content-range': 'bytes 0-99/100' });
  });
  const play = await getPlayUrl('M1', ok.fetchImpl);
  assert.equal(play.url, 'https://cdn.example/song.mp3');

  const upstream = await proxyStream('M1', 'bytes=0-99', ok.fetchImpl);
  assert.equal(upstream.status, 206);
  const cdnCall = ok.calls.find((call) => call.url.includes('cdn.example'));
  assert.equal(cdnCall.init.headers.Range, 'bytes=0-99');

  const denied = recordingFetch(() =>
    response(
      '{"data":{"playUrl":{"M1":{"url":"","error":"暂无播放链接","restriction":{"hint":{"message":"restricted"}}}}}',
    ),
  );
  await assert.rejects(() => getPlayUrl('M1', denied.fetchImpl), /暂无播放链接|restricted/);
});
test('扫码成功后代理保存会话 Cookie，后续请求自动带上，退出时清空', async (t) => {
  t.after(() => logout(async () => response('{}')));
  await logout(async () => response('{}'));
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const target = String(url);
    if (target.includes('/login/qr/check')) {
      return response({ code: 803, cookie: 'qqmusic_session=TOK123; Path=/; HttpOnly' });
    }
    if (target.includes('/login/status')) {
      return response({
        code: 200,
        data: { profile: { musicid: '999', info: { nick: '阿声' } } },
      });
    }
    return response({ code: 200 });
  };
  const check = await qrCheck('K1', fetchImpl);
  assert.equal(check.state, 'ok');
  assert.equal(hasSessionCookie(), true);
  const status = await getStatus(fetchImpl);
  assert.equal(status.loggedIn, true);
  assert.equal(status.nickname, '阿声');
  assert.equal(status.uin, '999');
  const statusCall = calls.find((call) => call.url.includes('/login/status'));
  assert.match(statusCall.init.headers.Cookie, /qqmusic_session=TOK123/);
  await logout(fetchImpl);
  assert.equal(hasSessionCookie(), false);
});

test('Set-Cookie 响应头里的会话 token 也会被吸收', async (t) => {
  t.after(() => logout(async () => response('{}')));
  await logout(async () => response('{}'));
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) {
      return response({ code: 200, data: {} }, 200, { 'set-cookie': ['qqmusic_session=HDR456; Path=/; HttpOnly'] });
    }
    return response({ code: 200, data: {} });
  };
  await getStatus(fetchImpl);
  await getStatus(fetchImpl);
  const second = calls[1];
  assert.match(second.init.headers.Cookie, /qqmusic_session=HDR456/);
});
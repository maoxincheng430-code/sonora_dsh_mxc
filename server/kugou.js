// 酷狗音乐 provider：免登录搜索 / 歌词 / 播放地址（部分歌曲受版权/付费限制）。
// 接口来自酷狗网页与移动端公开接口，不需要额外服务进程。
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function getJson(url, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json, text/plain, */*',
      Referer: 'https://www.kugou.com/',
    },
  });
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw httpError(502, '酷狗接口返回了无法解析的内容。');
  }
}

/** 搜索歌曲：统一成 {id,name,singer,album,duration}。 */
export async function searchSongs(keyword, { limit = 20, page = 1 } = {}, fetchImpl = globalThis.fetch) {
  const url = new URL('https://mobileservice.kugou.com/api/v3/search/song');
  url.searchParams.set('format', 'json');
  url.searchParams.set('keyword', keyword);
  url.searchParams.set('page', String(page));
  url.searchParams.set('pagesize', String(Math.min(50, Math.max(1, limit))));
  const data = await getJson(url, fetchImpl);
  const info = data?.data?.info ?? [];
  return info.map((song) => ({
    id: String(song.hash || ''),
    name: String(song.songname || ''),
    singer: String(song.singername || ''),
    album: String(song.album_name || ''),
    duration: Number(song.duration) || 0,
  }));
}

/** 播放地址：部分歌曲（VIP/版权）返回空，前端会提示换歌。 */
export async function getPlayUrl(hash, fetchImpl = globalThis.fetch) {
  const url = `https://m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash=${encodeURIComponent(hash)}`;
  const data = await getJson(url, fetchImpl);
  if (!data?.url) throw httpError(404, '酷狗这首歌曲需要登录或客户端才能播放，换一首试试。');
  return { url: data.url, restriction: Number(data.pay_type) > 0 ? 1 : 0 };
}

/** 歌词：先按「歌手 - 歌名」找到匹配歌词，再下载 LRC。 */
export async function getLyric(hash, { name = '', artist = '' } = {}, fetchImpl = globalThis.fetch) {
  const keyword = [artist, name].filter(Boolean).join(' - ') || name;
  const searchUrl = new URL('https://krcs.kugou.com/search');
  searchUrl.searchParams.set('ver', '1');
  searchUrl.searchParams.set('man', 'yes');
  searchUrl.searchParams.set('client', 'mobi');
  searchUrl.searchParams.set('keyword', keyword);
  searchUrl.searchParams.set('hash', hash);
  const searched = await getJson(searchUrl, fetchImpl);
  const candidate = searched?.candidates?.[0];
  if (!candidate) return { text: '', trans: '' };
  const downloadUrl = new URL('https://lyrics.kugou.com/download');
  downloadUrl.searchParams.set('ver', '1');
  downloadUrl.searchParams.set('client', 'pc');
  downloadUrl.searchParams.set('id', String(candidate.id));
  downloadUrl.searchParams.set('accesskey', String(candidate.accesskey));
  downloadUrl.searchParams.set('fmt', 'lrc');
  downloadUrl.searchParams.set('charset', 'utf8');
  const downloaded = await getJson(downloadUrl, fetchImpl);
  const text = downloaded?.content
    ? Buffer.from(String(downloaded.content), 'base64').toString('utf8')
    : '';
  return { text, trans: '' };
}

export async function proxyStream(hash, range, fetchImpl = globalThis.fetch) {
  const { url } = await getPlayUrl(hash, fetchImpl);
  return fetchImpl(url, {
    headers: {
      ...(range ? { Range: range } : {}),
      'User-Agent': UA,
      Referer: 'https://www.kugou.com/',
    },
  });
}

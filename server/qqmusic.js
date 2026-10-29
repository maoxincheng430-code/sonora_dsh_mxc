// QQ 音乐歌词源（免登录）：
//   · 搜索：c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg（联想搜索，返回 songmid）
//   · 歌词：c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=...&format=json&nobase64=1
// 两个接口都要求 Referer 为 y.qq.com，否则返回空。无需扫码登录，公开歌词即可取到。

// 与 lyrics.js 共享的打分逻辑在这里做一份轻量实现，避免两个模块循环依赖。

/** 归一化歌名：去扩展名、括号内容、标点空白，转小写。 */
export function normalizeQQKey(value) {
  return String(value ?? '')
    .replace(/\.[a-z0-9]{1,8}$/i, '')
    .replace(/[（(【\[][^）)】\]]*[）)】\]]/g, '')
    .replace(/[\s\-_·・.,，。!！?？:：;；'"“”‘’/\\|+&@#$%^*=~`]/g, '')
    .toLowerCase();
}

/** 至少两行时间轴才算可用歌词。 */
export function isValidQQBrc(text) {
  if (typeof text !== 'string' || text.length < 8) return false;
  const hits = text.match(/\[\d{1,3}:\d{1,2}([.:]\d{1,3})?\]/g);
  return Boolean(hits && hits.length >= 2);
}

function scoreQQCandidate(candidate, query = {}) {
  const titleKeys = [query.title, query.name].map(normalizeQQKey).filter(Boolean);
  const songKey = normalizeQQKey(candidate?.song);
  const singerKey = normalizeQQKey(candidate?.singer);
  if (!songKey && !singerKey) return 0;
  let score = 0;
  for (const titleKey of titleKeys) {
    if (!titleKey) continue;
    if (songKey === titleKey) { score = 40; break; }
    if (songKey.includes(titleKey) || titleKey.includes(songKey)) { score = 24; break; }
  }
  if (!score) return 0;
  const artistParts = String(query.artist ?? '')
    .split(/[/、,&，]|\bfeat\.?\b|\bft\.?\b/i)
    .map(normalizeQQKey)
    .filter((part) => part.length >= 2);
  for (const part of artistParts) {
    if (singerKey.includes(part)) score += 14;
  }
  return score;
}

function pickQQCandidate(candidates, query, minScore = 20) {
  let best = null;
  let bestScore = 0;
  for (const candidate of candidates ?? []) {
    const score = scoreQQCandidate(candidate, query);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best && bestScore >= minScore ? { candidate: best, score: bestScore } : null;
}
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const SEARCH_URL = 'https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg';
const LYRIC_URL = 'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg';

/** QQ 音乐返回的歌词里常有 HTML 实体（&#58; / &apos; / &amp; 等），统一解码。 */
export function decodeHtmlEntities(text) {
  if (typeof text !== 'string' || !text) return '';
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

async function fetchJson(fetchImpl, url, referer) {
  const response = await fetchImpl(url, {
    headers: { 'User-Agent': UA, Referer: referer, Accept: 'application/json, text/plain, */*' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  // 偶发 JSONP/前缀垃圾，尽量裁出 JSON 主体
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  const body = start >= 0 && end > start ? text.slice(start, end + 1) : text;
  return JSON.parse(body);
}

/** 搜索 QQ 音乐，返回 [{mid, song, singer, duration}]。 */
export async function searchQQMusic(keyword, fetchImpl = globalThis.fetch) {
  const url = `${SEARCH_URL}?is_xml=0&format=json&key=${encodeURIComponent(keyword)}`;
  const data = await fetchJson(fetchImpl, url, 'https://y.qq.com/');
  const items = data?.data?.song?.itemlist ?? [];
  return items.map((item) => ({
    mid: String(item.mid ?? item.docid ?? ''),
    song: String(item.name ?? ''),
    singer: String(item.singer ?? ''),
    duration: 0,
  })).filter((item) => item.mid && item.song);
}

/** 按 songmid 取歌词（LRC 文本）。 */
export async function fetchQQMusicLyric(mid, fetchImpl = globalThis.fetch) {
  if (!mid) return '';
  const url = `${LYRIC_URL}?songmid=${encodeURIComponent(mid)}&format=json&nobase64=1&g_tk=5381&loginUin=0&hostUin=0&platform=yqq&needNewCode=0`;
  const data = await fetchJson(fetchImpl, url, 'https://y.qq.com/portal/player.html');
  const text = decodeHtmlEntities(data?.lyric ?? '');
  return isValidQQBrc(text) ? text : '';
}

/**
 * 解析一首歌的 QQ 音乐歌词。
 * @returns {Promise<{text: string, source: 'qqmusic', matched: {title: string, artist: string}, score: number}|null>}
 */
export async function resolveQQMusic(track = {}, fetchImpl = globalThis.fetch) {
  const title = String(track.title ?? '').trim();
  const artist = String(track.artist ?? '').trim();
  const rawName = String(track.name ?? '').replace(/\.[^.]+$/, '').trim();
  const keywords = [];
  const push = (value) => {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text && !keywords.includes(text)) keywords.push(text);
  };
  if (title && artist) push(`${title} ${artist}`);
  if (title) push(title);
  if (rawName) push(rawName);
  if (!keywords.length) return null;

  for (const keyword of keywords) {
    try {
      const candidates = await searchQQMusic(keyword, fetchImpl);
      const best = pickQQCandidate(candidates, track);
      if (!best) continue;
      const text = await fetchQQMusicLyric(best.candidate.mid, fetchImpl);
      if (text) {
        return {
          text,
          source: 'qqmusic',
          matched: { title: best.candidate.song, artist: best.candidate.singer },
          score: best.score,
        };
      }
    } catch {
      // 换下一个关键词
    }
  }
  return null;
}


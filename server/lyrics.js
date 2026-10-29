// 歌词自动解析：按「歌名 / 歌手 / 时长」在歌词库中搜索、打分、下载 LRC。
// 主源：酷狗歌词库（krcs.kugou.com，免登录、覆盖中文歌好）；
// 备源：可选网易云（若 tools/netease 里装了 NeteaseCloudMusicApi）。
// 所有网络函数都可注入 fetch，便于 Node 单测。

import { createRequire } from 'node:module';
import { resolveQQMusic } from './qqmusic.js';

const KUGOU_SEARCH = 'https://krcs.kugou.com/search';
const KUGOU_DOWNLOAD = 'https://krcs.kugou.com/download';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** 归一化歌名：去扩展名、括号内容、标点空白，转小写。 */
export function normalizeKey(value) {
  return String(value ?? '')
    .replace(/\.[a-z0-9]{1,8}$/i, '')
    .replace(/[（(【\[][^）)】\]]*[）)】\]]/g, '')
    .replace(/[\s\-_·・.,，。!！?？:：;；'"“”‘’/\\|+&@#$%^*=~`]/g, '')
    .toLowerCase();
}

/** 判断一段文本是否是带时间轴的 LRC。 */
export function isValidLrc(text) {
  if (typeof text !== 'string' || text.length < 8) return false;
  const hits = text.match(/\[\d{1,3}:\d{2}([.:]\d{1,3})?\]/g);
  return Boolean(hits && hits.length >= 2);
}

/** 酷狗返回的歌词是 base64，偶尔是明文。 */
export function decodeKugouContent(content) {
  if (typeof content !== 'string' || !content) return '';
  const looksBase64 = /^[A-Za-z0-9+/=\r\n]+$/.test(content) && content.length % 4 === 0;
  if (!looksBase64) return content;
  try {
    const decoded = Buffer.from(content, 'base64').toString('utf8');
    return decoded.includes('[') ? decoded : content;
  } catch {
    return content;
  }
}

function splitArtist(value) {
  return String(value ?? '')
    .split(/[/、,&，]|\bfeat\.?\b|\bft\.?\b/i)
    .map((part) => normalizeKey(part))
    .filter((part) => part.length >= 2);
}

function titleMatchScore(titleKeys, valueKey) {
  if (!valueKey) return 0;
  for (const titleKey of titleKeys) {
    if (!titleKey) continue;
    if (valueKey === titleKey) return 40;
    if (titleKey.includes(valueKey) || valueKey.includes(titleKey)) return 24;
  }
  return 0;
}

function artistMatchScore(artistParts, valueKey) {
  if (!valueKey || !artistParts.length) return 0;
  let score = 0;
  for (const part of artistParts) {
    if (valueKey.includes(part)) score += 14;
  }
  return Math.min(28, score);
}

/**
 * 给歌词候选打分：歌名完全匹配最高，其次包含；歌手命中加分；时长接近加分。
 * 酷狗部分结果会把 song / singer 写反（如 song=Blue Harbor, singer=Midnight Rain），
 * 因此同时评估"正序"和"反序"两种字段解释，取较高分。
 * @param {{song?: string, singer?: string, duration?: number}} candidate 酷狗候选（duration 为毫秒）
 * @param {{title?: string, artist?: string, name?: string, duration?: number}} query 曲目信息（duration 秒）
 */
export function scoreCandidate(candidate, query = {}) {
  const titleKeys = [query.title, query.name].map(normalizeKey).filter(Boolean);
  const songKey = normalizeKey(candidate?.song);
  const singerKey = normalizeKey(candidate?.singer);
  if (!songKey && !singerKey) return 0;

  const artistParts = splitArtist(query.artist);
  const direct = titleMatchScore(titleKeys, songKey) + artistMatchScore(artistParts, singerKey);
  const swapped = titleMatchScore(titleKeys, singerKey) + artistMatchScore(artistParts, songKey);
  let score = Math.max(direct, swapped);
  if (!score) return 0;

  // 没有歌名匹配时只保留歌手分，不再叠加时长，避免"同名长度撞车"的误配。
  const hasTitleMatch =
    titleMatchScore(titleKeys, songKey) > 0 || titleMatchScore(titleKeys, singerKey) > 0;
  if (!hasTitleMatch) return score;

  // 时长：酷狗返回毫秒，曲库为秒
  const candidateSeconds = Number(candidate?.duration) / 1000;
  const trackSeconds = Number(query.duration);
  if (Number.isFinite(candidateSeconds) && candidateSeconds > 0 && trackSeconds > 0) {
    const diff = Math.abs(candidateSeconds - trackSeconds);
    if (diff <= 3) score += 12;
    else if (diff <= 8) score += 6;
    else if (diff <= 20) score += 2;
    else if (diff > 90) score -= 6;
  }
  return score;
}

/** 选出得分最高的候选（需达到最低分阈值）。 */
export function pickBestCandidate(candidates, query, minScore = 20) {
  let best = null;
  let bestScore = 0;
  for (const candidate of candidates ?? []) {
    const score = scoreCandidate(candidate, query);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best && bestScore >= minScore ? { candidate: best, score: bestScore } : null;
}

/** 识别酷狗候选的字段方向（少数结果的 song/singer 是反的），返回正确的歌名/歌手。 */
export function orientCandidate(candidate, query = {}) {
  const titleKeys = [query.title, query.name].map(normalizeKey).filter(Boolean);
  const songKey = normalizeKey(candidate?.song);
  const singerKey = normalizeKey(candidate?.singer);
  const artistParts = splitArtist(query.artist);
  const direct = titleMatchScore(titleKeys, songKey) + artistMatchScore(artistParts, singerKey);
  const swapped = titleMatchScore(titleKeys, singerKey) + artistMatchScore(artistParts, songKey);
  if (swapped > direct) {
    return { title: String(candidate?.singer ?? ''), artist: String(candidate?.song ?? '') };
  }
  return { title: String(candidate?.song ?? ''), artist: String(candidate?.singer ?? '') };
}

/** 组合搜索关键词：歌名+歌手优先，再退化为单独歌名/歌手。 */
export function buildQueries({ title, artist, name } = {}) {
  const cleanTitle = String(title || '').trim();
  const cleanArtist = String(artist || '').trim();
  const cleanName = String(name || '').replace(/\.[^.]+$/, '').trim();
  const queries = [];
  const push = (value) => {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text && !queries.includes(text)) queries.push(text);
  };
  if (cleanTitle && cleanArtist) push(`${cleanTitle} ${cleanArtist}`);
  if (cleanTitle) push(cleanTitle);
  if (cleanArtist) push(`${cleanArtist} ${cleanTitle}`);
  if (cleanName) push(cleanName);
  return queries.slice(0, 3);
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url, { headers: { 'User-Agent': UA } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/** 酷狗搜索候选。 */
export async function searchKugou(keyword, fetchImpl = globalThis.fetch) {
  const url = `${KUGOU_SEARCH}?ver=1&man=yes&client=mobi&keyword=${encodeURIComponent(keyword)}`;
  const data = await fetchJson(fetchImpl, url);
  return Array.isArray(data?.candidates) ? data.candidates : [];
}

/** 下载酷狗歌词正文（已解码 + 校验）。 */
export async function fetchKugouLrc(candidate, fetchImpl = globalThis.fetch) {
  if (!candidate?.id || !candidate?.accesskey) return '';
  const url = `${KUGOU_DOWNLOAD}?ver=1&client=mobi&id=${encodeURIComponent(candidate.id)}&accesskey=${encodeURIComponent(candidate.accesskey)}&fmt=lrc&charset=utf8`;
  const data = await fetchJson(fetchImpl, url);
  const text = decodeKugouContent(data?.content ?? '');
  return isValidLrc(text) ? text : '';
}

let neteaseModule;
/** 尝试加载 tools/netease 里的 NeteaseCloudMusicApi（未安装则返回 null）。 */
function loadNetease() {
  if (neteaseModule !== undefined) return neteaseModule;
  try {
    const require = createRequire(import.meta.url);
    neteaseModule = require('../tools/netease/node_modules/NeteaseCloudMusicApi');
  } catch {
    neteaseModule = null;
  }
  return neteaseModule;
}

/** 网易云备源：按歌名+歌手搜歌，取第一条的 LRC。 */
export async function resolveNetease({ title, artist } = {}) {
  const api = loadNetease();
  if (!api?.search || !api?.lyric) return null;
  const keyword = [title, artist].filter(Boolean).join(' ').trim();
  if (!keyword) return null;
  try {
    const searchBody = (await api.search({ keywords: keyword, type: 1, limit: 10 })).body ?? {};
    const songs = searchBody?.result?.songs ?? [];
    const normalizedTitle = normalizeKey(title);
    const hit = songs.find((song) => normalizeKey(song.name) === normalizedTitle) ?? songs[0];
    if (!hit) return null;
    const lyricBody = (await api.lyric({ id: hit.id })).body ?? {};
    const text = lyricBody?.lrc?.lyric ?? '';
    if (!isValidLrc(text)) return null;
    return {
      text,
      source: 'netease',
      matched: { title: hit.name, artist: (hit.artists ?? []).map((a) => a.name).join(' / ') },
    };
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 歌词正文长度（去掉时间标签与元数据），用于多源结果择优。 */
export function lyricBodyLength(text) {
  if (typeof text !== 'string') return 0;
  return text
    .split('\n')
    .map((line) => line.replace(/\[[^\]]*\]/g, '').trim())
    .filter((line) => line && !/[:：]/.test(line.slice(0, 8)))
    .join('')
    .length;
}

/**
 * 解析一首歌的歌词。先酷狗（多关键词、按分数选，空结果重试一次），
 * 置信度不足时依次用网易云、QQ 音乐交叉补位，最后按歌词正文长度择优。
 * @returns {Promise<{text: string, source: string, matched: {title: string, artist: string}}|null>}
 */
export async function resolveLyrics(track = {}, options = {}) {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const queries = buildQueries(track);
  const tried = [];
  let best = null;
  for (const keyword of queries) {
    try {
      let candidates = await searchKugou(keyword, fetchImpl);
      // 酷狗偶尔限流返回空列表：稍等再试一次
      if (!candidates.length) {
        await sleep(350);
        candidates = await searchKugou(keyword, fetchImpl);
      }
      tried.push({ keyword, count: candidates.length });
      const picked = pickBestCandidate(candidates, track);
      if (!picked) continue;
      const text = await fetchKugouLrc(picked.candidate, fetchImpl);
      if (text) {
        const matched = orientCandidate(picked.candidate, track);
        best = { text, source: 'kugou', matched, score: picked.score, tried };
        // 高置信（歌名+歌手都对上）直接采用，避免多余请求
        if (picked.score >= 60) return best;
        break;
      }
    } catch {
      // 单个关键词失败继续下一个
    }
  }

  // 低置信或无结果时，用网易云再核一次（它的元数据更规范）
  const results = best ? [best] : [];
  if (options.netease !== false) {
    const fallback = await resolveNetease(track);
    if (fallback) results.push({ ...fallback, tried });
  }

  // 仍没有足够好的：QQ 音乐（免登录），覆盖酷狗/网易云缺的曲目
  if (options.qqmusic !== false) {
    const qq = await resolveQQMusic(track, fetchImpl);
    if (qq) results.push({ ...qq, tried });
  }

  if (!results.length) return null;
  // 择优：正文越长越可能是完整歌词（避免"纯音乐/暂无歌词"占位词胜出）；
  // 长度接近时偏向先返回的源（酷狗 > 网易云 > QQ）。
  return results.reduce((chosen, item) =>
    lyricBodyLength(item.text) > lyricBodyLength(chosen.text) + 12 ? item : chosen,
  );
}

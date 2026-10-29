// 本地歌词库：读取 public/lyrics/index.json，按「歌名 / 别名 / 歌手」自动匹配 LRC。
// 纯函数（normalizeName / scoreLyricEntry / matchLyricEntry）可单测，网络部分可注入 fetch。

/** 归一化：去扩展名、括号内容、标点与空白，转小写，便于宽松匹配。 */
export function normalizeName(value) {
  return String(value ?? '')
    .replace(/\.[a-z0-9]{1,8}$/i, '')
    .replace(/[（(【\[][^）)】\]]*[）)】\]]/g, '')
    .replace(/[\s\-_·・.,，。!！?？:：;；'"“”‘’/\\|+&@#$%^*=~`]/g, '')
    .toLowerCase();
}

/**
 * 给一个歌词条目与一个曲目打分：
 * 歌名命中 10 分、别名命中 8 分、歌手命中 4 分；歌名完全相等额外 +4。
 */
export function scoreLyricEntry(entry, track = {}) {
  const title = normalizeName(entry?.title);
  const aliases = (entry?.aliases ?? []).map(normalizeName).filter(Boolean);
  const artistKeys = normalizeName(entry?.artist);
  const trackTitle = normalizeName(track.title ?? '');
  const trackName = normalizeName(track.name ?? '');
  const trackArtist = normalizeName(track.artist ?? '');
  const haystack = `${trackTitle}${trackName}${trackArtist}`;
  if (!haystack) return 0;

  let score = 0;
  if (title) {
    if (trackTitle && trackTitle === title) score += 14;
    else if (haystack.includes(title)) score += 10;
  }
  for (const alias of aliases) {
    if (alias && haystack.includes(alias)) score += 8;
  }
  if (artistKeys && trackArtist) {
    // 歌手可能写成「A / B」，拆开逐个比对，命中任一个即算
    const parts = String(entry.artist ?? '').split(/[/、,&]/).map(normalizeName).filter(Boolean);
    if (parts.some((part) => trackArtist.includes(part))) score += 4;
  }
  // 同名不同版本（如 132s / 210s 两个剪辑）靠时长区分：接近的加分，差太多的直接压下去
  const entryDuration = Number(entry?.duration) || 0;
  const trackDuration = Number(track?.duration) || 0;
  if (entryDuration > 0 && trackDuration > 0) {
    const diff = Math.abs(entryDuration - trackDuration);
    if (diff <= 4) score += 12;
    else if (diff <= 10) score += 6;
    else if (diff <= 20) score += 2;
    else score -= 20;
  }
  return score;
}

/** 从条目数组中挑出得分最高的一个（分数为 0 视为不匹配）。 */
export function matchLyricEntry(entries, track = {}) {
  let best = null;
  let bestScore = 0;
  for (const entry of entries ?? []) {
    const score = scoreLyricEntry(entry, track);
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  return best ? { entry: best, score: bestScore } : null;
}

/**
 * 创建歌词库客户端。
 * @param {{ baseUrl?: string, fetch?: typeof fetch }} options
 *   baseUrl 为相对页面地址的目录，默认 'lyrics/'（对应 public/lyrics/）。
 */
export function createLyricsLibrary(options = {}) {
  const doc = options.document ?? (typeof document !== 'undefined' ? document : null);
  const baseUrl = options.baseUrl ?? 'lyrics/';
  const fetchImpl = options.fetch ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  // 自动抓取的歌词用 localStorage 缓存，第二次播放就不用再联网
  const storage = options.storage
    ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  const cachePrefix = options.cachePrefix ?? 'sonora-auto-lyrics:';
  let apiBase = options.apiBase ?? '';
  let entries = null;
  let failed = false;

  function resolve(relative) {
    const base = doc?.baseURI ?? (typeof location !== 'undefined' ? location.href : 'http://localhost/');
    return new URL(relative, base).href;
  }

  function autoCacheKey(track = {}) {
    return `${normalizeName(track.title || track.name)}|${normalizeName(track.artist)}`;
  }

  function readAutoCache(track) {
    try {
      return storage?.getItem(cachePrefix + autoCacheKey(track)) || '';
    } catch {
      return '';
    }
  }

  function writeAutoCache(track, text) {
    try {
      storage?.setItem(cachePrefix + autoCacheKey(track), text);
    } catch {
      // 隐私模式或超出配额时忽略
    }
  }

  async function loadIndex() {
    if (entries || failed || !fetchImpl) return entries;
    try {
      const response = await fetchImpl(new URL('index.json', resolve(baseUrl)).href, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`index ${response.status}`);
      const data = await response.json();
      entries = Array.isArray(data) ? data : (data?.tracks ?? []);
      return entries;
    } catch {
      failed = true;
      entries = null;
      return null;
    }
  }

  async function match(track) {
    const list = await loadIndex();
    if (!list || !list.length) return null;
    const result = matchLyricEntry(list, track);
    return result ? result.entry : null;
  }

  async function get(entry) {
    if (!entry?.file || !fetchImpl) return '';
    try {
      const response = await fetchImpl(new URL(encodeURI(entry.file), resolve(baseUrl)).href, { cache: 'force-cache' });
      if (!response.ok) return '';
      const text = await response.text();
      // 至少要有一行合法时间轴，避免把 HTML 错误页当歌词
      return /\[\d{1,2}:\d{2}([.:]\d{1,3})?\]/.test(text) ? text : '';
    } catch {
      return '';
    }
  }

  /** 本地缓存 → 后端在线搜索（/api/lyrics/search） */
  async function fetchRemote(track) {
    const cached = readAutoCache(track);
    if (cached && /\[\d{1,2}:\d{2}/.test(cached)) return cached;
    if (!apiBase || !fetchImpl) return '';
    const params = new URLSearchParams({
      title: String(track?.title ?? ''),
      artist: String(track?.artist ?? ''),
      name: String(track?.name ?? ''),
      duration: String(Number(track?.duration) || 0),
    });
    // 曲目在 MySQL 库里时带上 id：后端会先读缓存，抓取成功后写回数据库
    if (track?.id) params.set('trackId', String(track.id));
    try {
      const response = await fetchImpl(`${apiBase}/api/lyrics/search?${params.toString()}`, { cache: 'no-store' });
      if (!response.ok) return '';
      const data = await response.json();
      const text = typeof data?.text === 'string' ? data.text : '';
      if (!/\[\d{1,2}:\d{2}([.:]\d{1,3})?\]/.test(text)) return '';
      writeAutoCache(track, text);
      return text;
    } catch {
      return '';
    }
  }

  /**
   * 统一的歌词解析入口：本地歌词库优先，其次自动抓取（有后端时）。
   * @returns {Promise<{text: string, source: 'local'|'api', entry?: object}|null>}
   */
  async function resolveTrack(track) {
    const entry = await match(track);
    if (entry) {
      const text = await get(entry);
      if (text) return { text, source: 'local', entry };
    }
    const text = await fetchRemote(track);
    return text ? { text, source: 'api' } : null;
  }

  return {
    baseUrl,
    async ready() {
      await loadIndex();
      return this;
    },
    match,
    get,
    fetchRemote,
    resolve: resolveTrack,
    setApiBase(url) {
      apiBase = String(url || '').replace(/\/$/, '');
    },
    get apiBase() {
      return apiBase;
    },
    get size() {
      return entries?.length ?? 0;
    },
  };
}

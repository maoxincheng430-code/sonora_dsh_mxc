// 数据库版曲库客户端（与 src/library.js 的 MusicLibrary 同形，便于无缝替换）。
//
//   import { createRemoteLibrary } from './library-api.js';
//   const library = createRemoteLibrary();          // 默认 http://127.0.0.1:8787
//   await library.open();                           // 探测 /api/health，失败抛错
//   const track = await library.save(file, duration);
//   const tracks = await library.list();
//   const file2 = await library.read(track.id);     // File
//   await library.update(track.id, { title, artist });
//   await library.touch(track.id);                  // playCount + 1
//   await library.remove(track.id);
//   library.close();
//
// 该模块不依赖 DOM/CSS，Node 24 与浏览器均可运行（需要 fetch / FormData / File）。
import { normalizeTrack, sortTracks } from './library-model.js';

export const DEFAULT_BASE_URL = 'http://127.0.0.1:8787';

const HEALTH_TIMEOUT_MS = 2500;
const REQUEST_TIMEOUT_MS = 30000;
const AUDIO_TIMEOUT_MS = 180000;
const CONNECT_ERROR = '无法连接 Sonora 数据库服务，请先运行 npm run db:start 与 npm run server 后重试。';

const trimBaseUrl = (value) => String(value || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');

const resolveFetch = (preferred) => {
  if (typeof preferred === 'function') return preferred;
  if (typeof globalThis.fetch === 'function') return globalThis.fetch.bind(globalThis);
  throw new Error('当前环境不支持 fetch，无法连接数据库服务。');
};

const createAbort = (timeoutMs) => {
  if (typeof AbortController !== 'function') return { signal: undefined, clear: () => {} };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, Number(timeoutMs) || 1));
  if (timer && typeof timer.unref === 'function') timer.unref();
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
};

const decodeHeader = (value) => {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

// 探测服务是否可用；任何失败（网络/超时/非 2xx/ok:false）都返回 false，不抛错。
// 后端可能处于三种状态：
//   storage: 'mysql'       → 数据库可用，走服务端曲库
//   storage: 'none'        → 后端未配置数据库（200，db:false），走浏览器 IndexedDB
//   storage: 'unavailable' → 配了数据库但连不上（503），同样回退 IndexedDB
// 三种都要安静处理，不要在控制台留下 503 报错噪音。
export async function probeServer(baseUrl = DEFAULT_BASE_URL, timeoutMs = 1200) {
  try {
    const fetchImpl = resolveFetch();
    const abort = createAbort(timeoutMs);
    try {
      const response = await fetchImpl(`${trimBaseUrl(baseUrl)}/api/health`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: abort.signal,
      });
      if (!response) return false;
      const data = await response.json().catch(() => null);
      // 数据库连不上时后端返回 503 + { db:false }：这属于“预期内的不可用”，不算服务故障
      if (!response.ok && data && data.db === false) return false;
      if (!response.ok) return false;
      return Boolean(data && data.ok === true && data.db === true);
    } finally {
      abort.clear();
    }
  } catch {
    return false;
  }
}

export function createRemoteLibrary({ baseUrl = DEFAULT_BASE_URL, fetch: fetchOption, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const root = trimBaseUrl(baseUrl);
  const cache = new Map();
  let opened = null;

  const request = async (path, options = {}) => {
    const { timeoutMs: perRequestTimeout, ...init } = options;
    const fetchImpl = resolveFetch(fetchOption);
    const abort = createAbort(perRequestTimeout || timeoutMs);
    try {
      return await fetchImpl(`${root}${path}`, {
        ...init,
        signal: init.signal || abort.signal,
        headers: { Accept: 'application/json', ...(init.headers || {}) },
      });
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error('数据库服务响应超时，请稍后重试。');
      if (error && typeof error.message === 'string' && error.message === CONNECT_ERROR) throw error;
      throw new Error(CONNECT_ERROR);
    } finally {
      abort.clear();
    }
  };

  const readJson = async (response) => {
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (!response.ok) {
      const message = data && typeof data.error === 'string' && data.error
        ? data.error
        : `数据库服务返回错误（HTTP ${response.status}）。`;
      throw new Error(message);
    }
    if (!data || typeof data !== 'object') throw new Error('数据库服务返回了无法解析的数据。');
    return data;
  };

  const remember = (track) => {
    if (track && track.id) cache.set(track.id, track);
    return track;
  };

  const encodeId = (id) => encodeURIComponent(String(id ?? ''));

  const list = async () => {
    const response = await request('/api/tracks');
    const data = await readJson(response);
    const tracks = Array.isArray(data) ? data : Array.isArray(data.tracks) ? data.tracks : [];
    const normalized = tracks.map((track) => remember(normalizeTrack(track)));
    return sortTracks(normalized, 'added');
  };

  const findCached = async (id) => {
    if (cache.has(id)) return cache.get(id);
    const tracks = await list();
    return tracks.find((track) => track.id === id) || null;
  };

  return {
    // 探测服务；成功后缓存结果，失败时清空以便下次重试。
    open() {
      if (!opened) {
        opened = probeServer(root, HEALTH_TIMEOUT_MS).then((alive) => {
          if (!alive) throw new Error(CONNECT_ERROR);
          return true;
        }).catch((error) => {
          opened = null;
          throw error;
        });
      }
      return opened;
    },

    async save(file, duration, meta = null) {
      if (!file || typeof file.name !== 'string' || !file.name) {
        throw new Error('请选择要导入的音频文件。');
      }
      const form = new FormData();
      form.append('audio', file, file.name);
      const seconds = Number(duration);
      if (Number.isFinite(seconds) && seconds > 0) form.append('duration', String(seconds));
      const lastModified = Number(file.lastModified);
      if (Number.isFinite(lastModified) && lastModified > 0) {
        form.append('lastModified', String(Math.floor(lastModified)));
      }
      // 文件内嵌的标题 / 歌手（ID3、MP4 ilst）优先于文件名解析
      const metaTitle = String(meta?.title ?? '').trim();
      const metaArtist = String(meta?.artist ?? '').trim();
      if (metaTitle) form.append('title', metaTitle.slice(0, 255));
      if (metaArtist) form.append('artist', metaArtist.slice(0, 255));
      const response = await request('/api/tracks', { method: 'POST', body: form });
      const data = await readJson(response);
      return remember(normalizeTrack(data));
    },

    list,

    async read(id) {
      const response = await request(`/api/tracks/${encodeId(id)}/audio`, {
        timeoutMs: AUDIO_TIMEOUT_MS,
        headers: { Accept: '*/*' },
      });
      if (!response.ok) await readJson(response); // 404 等错误统一抛出服务端中文信息
      const blob = await response.blob();
      if (!blob || !blob.size) throw new Error('歌曲不存在或已删除，请重新导入。');
      const known = cache.get(String(id)) || null;
      const headers = response.headers;
      const headerName = headers && typeof headers.get === 'function'
        ? decodeHeader(headers.get('x-track-name'))
        : '';
      const headerType = headers && typeof headers.get === 'function'
        ? decodeHeader(headers.get('x-track-type'))
        : '';
      const headerModified = headers && typeof headers.get === 'function'
        ? Number(headers.get('x-track-last-modified'))
        : 0;
      const name = headerName || known?.name || `track-${id}.bin`;
      const type = headerType || known?.type || blob.type || '';
      const lastModified = Number.isFinite(headerModified) && headerModified > 0
        ? headerModified
        : known?.lastModified || Date.now();
      return new File([blob], name, { type, lastModified });
    },

    async update(id, changes = {}) {
      const source = changes && typeof changes === 'object' ? changes : {};
      const body = {};
      if (Object.prototype.hasOwnProperty.call(source, 'title')) {
        body.title = String(source.title ?? '').trim().slice(0, 255);
      }
      if (Object.prototype.hasOwnProperty.call(source, 'artist')) {
        body.artist = String(source.artist ?? '').trim().slice(0, 255);
      }
      if (!Object.keys(body).length) {
        // 与 IndexedDB 版同形：没有字段时返回当前记录。
        const current = await findCached(String(id));
        if (!current) throw new Error('歌曲不存在或已删除，请重新导入。');
        return current;
      }
      const response = await request(`/api/tracks/${encodeId(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await readJson(response);
      return remember(normalizeTrack(data));
    },

    async touch(id) {
      const response = await request(`/api/tracks/${encodeId(id)}/play`, { method: 'POST' });
      const data = await readJson(response);
      return remember(normalizeTrack(data));
    },

    async remove(id) {
      const response = await request(`/api/tracks/${encodeId(id)}`, { method: 'DELETE' });
      cache.delete(String(id));
      if (response.status === 404) return; // 与 IndexedDB delete 一致：不存在也算成功
      await readJson(response);
    },

    close() {
      cache.clear();
      opened = null;
    },
  };
}

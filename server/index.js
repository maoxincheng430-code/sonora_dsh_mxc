// Sonora 曲库 REST API。
// 启动：node server/index.js（或 npm run server）
// 默认 http://127.0.0.1:8787 ，数据库 127.0.0.1:3307/sonora（见 MYSQL.md）。
import { createHash } from 'node:crypto';
import express from 'express';
import cors from 'cors';
import multer from 'multer';

import {
  query,
  ping,
  countTracks,
  closePool,
  dbConfig,
  dbEnabled,
  DB_DISABLED_CODE,
  ensureLyricsTable,
} from './db.js';
import { parseTrackName } from '../src/library-model.js';
import { resolveLyrics, isValidLrc } from './lyrics.js';
import {
  ensureQQApi,
  getStatus,
  getChannels,
  qrKey,
  qrCreate,
  qrCheck,
  qrCancel,
  logout,
  searchSongs,
  getLyric,
  getPlayUrl,
  proxyStream,
  stopQQApi,
} from './qq-auth.js';
import {
  ensureNeteaseApi,
  getLyric as getNeteaseLyric,
  getPlayUrl as getNeteasePlayUrl,
  getStatus as getNeteaseStatus,
  getDebugInfo as getNeteaseDebugInfo,
  proxyStream as proxyNeteaseStream,
  qrCheck as neteaseQrCheck,
  qrCreate as neteaseQrCreate,
  qrKey as neteaseQrKey,
  logout as neteaseLogout,
  setUserCookie as setNeteaseCookie,
  sendCaptcha as sendNeteaseCaptcha,
  loginWithCaptcha as loginNeteaseWithCaptcha,
  searchSongs as searchNeteaseSongs,
  stopNeteaseApi,
} from './netease.js';
import {
  getLyric as getKugouLyric,
  getPlayUrl as getKugouPlayUrl,
  proxyStream as proxyKugouStream,
  searchSongs as searchKugouSongs,
} from './kugou.js';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.SONORA_API_HOST || '127.0.0.1';
const MAX_AUDIO_BYTES = Number(process.env.SONORA_MAX_AUDIO_BYTES || 128 * 1024 * 1024);

// 只有本机前端能访问（CORS 白名单）。逗号分隔可追加来源。
const DEFAULT_ORIGINS = [
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'http://127.0.0.1:4173',
  'http://localhost:4173',
];
const ALLOWED_ORIGINS = new Set(
  DEFAULT_ORIGINS.concat(
    String(process.env.SONORA_CORS_ORIGINS || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  ),
);

const TRACK_COLUMNS =
  'id, name, title, artist, duration, size, mime, last_modified, added_at, play_count, last_played_at';

const number = (value) => {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
};

// 数据库行 → API 的 camelCase track 对象（不含 audio）。
function toTrack(row) {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    title: row.title == null ? '' : String(row.title),
    artist: row.artist == null ? '' : String(row.artist),
    duration: Math.max(0, number(row.duration)),
    size: Math.max(0, number(row.size)),
    type: row.mime == null ? '' : String(row.mime),
    lastModified: Math.max(0, number(row.last_modified)),
    addedAt: Math.max(0, number(row.added_at)),
    playCount: Math.max(0, Math.floor(number(row.play_count))),
    lastPlayedAt: Math.max(0, number(row.last_played_at)),
  };
}

// 与 IndexedDB 版一致的 id 规则（name+size+lastModified），但哈希成 64 位 hex
// 以适配 VARCHAR(64) 主键；同一文件重复上传得到同一 id，用于去重。
function trackId(name, size, lastModified) {
  return createHash('sha256')
    .update(JSON.stringify([name, size, lastModified]))
    .digest('hex');
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function findTrack(id) {
  const rows = await query(`SELECT ${TRACK_COLUMNS} FROM tracks WHERE id = ? LIMIT 1`, [id]);
  return rows[0] ? toTrack(rows[0]) : null;
}

// 解析单段 Range 头；返回 { start, end } / 'invalid'（忽略）/ 'unsatisfiable'（416）。
function parseRange(header, total) {
  if (typeof header !== 'string' || !header.trim()) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return 'invalid';
  const startRaw = match[1];
  const endRaw = match[2];
  if (!startRaw && !endRaw) return 'invalid';
  if (!startRaw) {
    const suffix = Number(endRaw);
    if (!Number.isFinite(suffix) || suffix <= 0) return 'unsatisfiable';
    return { start: Math.max(0, total - suffix), end: total - 1 };
  }
  const start = Number(startRaw);
  const end = endRaw === '' ? total - 1 : Math.min(Number(endRaw), total - 1);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'invalid';
  if (start >= total || end < start) return 'unsatisfiable';
  return { start, end };
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AUDIO_BYTES, files: 1, fields: 6 },
  // busboy 默认按 latin1 解码 multipart 头里的 filename，中文/emoji 文件名会变成乱码。
  // 浏览器与 Node 的 FormData 都按 UTF-8 发送文件名，这里显式按 UTF-8 解码。
  defParamCharset: 'utf8',
});

const app = express();
app.disable('x-powered-by');

app.use(
  cors({
    origin(origin, callback) {
      // 非浏览器请求（curl / 测试脚本）没有 Origin，直接放行。
      if (!origin || ALLOWED_ORIGINS.has(origin)) return callback(null, true);
      return callback(null, false);
    },
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Range', 'If-Range'],
    exposedHeaders: [
      'Content-Range',
      'Accept-Ranges',
      'Content-Length',
      'X-Track-Id',
      'X-Track-Name',
      'X-Track-Type',
      'X-Track-Last-Modified',
    ],
    maxAge: 86400,
  }),
);
app.use(express.json({ limit: '1mb' }));

// ---------- 路由 ----------

app.get('/api/health', async (req, res, next) => {
  // 数据库是可选依赖：未启用时返回 200，让前端可以安心退回 IndexedDB。
  if (!dbEnabled) {
    return res.json({
      ok: true,
      db: false,
      storage: 'none',
      reason: 'SONORA_DB_HOST 未设置，曲库走浏览器 IndexedDB。',
    });
  }
  try {
    await ping();
    const count = await countTracks();
    res.json({ ok: true, db: true, storage: 'mysql', count });
  } catch (error) {
    res.status(503).json({
      ok: false,
      db: false,
      storage: 'unavailable',
      code: String(error?.code || ''),
      error: '数据库连接失败，请检查 SONORA_DB_* 环境变量，或先运行 npm run db:setup / npm run db:start。',
      detail: String(error?.code || error?.message || error),
    });
  }
});

app.get('/api/tracks', async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT ${TRACK_COLUMNS} FROM tracks ORDER BY added_at DESC, title ASC`,
    );
    res.json(rows.map(toTrack));
  } catch (error) {
    next(error);
  }
});

// 上传/导入：multipart/form-data，字段 audio = 文件，可选 duration（秒）、lastModified（epoch ms）
app.post('/api/tracks', upload.single('audio'), async (req, res, next) => {
  try {
    if (!req.file) throw httpError(400, '缺少音频文件，请使用字段名 audio 上传。');
    const file = req.file;
    const name = String(file.originalname || '').slice(0, 512);
    if (!name) throw httpError(400, '文件名不能为空。');
    const size = Number(file.size) || file.buffer.length;
    const rawModified = Number(req.body?.lastModified);
    const lastModified =
      Number.isFinite(rawModified) && rawModified > 0 ? Math.floor(rawModified) : Date.now();
    const rawDuration = Number(req.body?.duration);
    const duration =
      Number.isFinite(rawDuration) && rawDuration > 0 ? Math.round(rawDuration * 1000) / 1000 : 0;
    const mime = String(file.mimetype || 'application/octet-stream').slice(0, 128);
    const id = trackId(name, size, lastModified);

    const existing = await findTrack(id);
    if (existing) {
      // 同名同大小同修改时间：视为重复导入，直接返回已有记录。
      return res.status(200).json(existing);
    }

    // 文件内嵌标签（ID3 / MP4 ilst）优先，其次按文件名解析
    const parsed = parseTrackName(name);
    const bodyTitle = String(req.body?.title ?? '').trim().slice(0, 255);
    const bodyArtist = String(req.body?.artist ?? '').trim().slice(0, 255);
    const title = bodyTitle || parsed.title;
    const artist = bodyArtist || parsed.artist;
    try {
      await query(
        `INSERT INTO tracks
           (id, name, title, artist, duration, size, mime, last_modified, added_at, play_count, last_played_at, audio)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`,
        [id, name, title, artist, duration, size, mime, lastModified, Date.now(), file.buffer],
      );
    } catch (error) {
      // 并发上传同一文件时另一请求已插入：返回已有记录。
      if (error?.code === 'ER_DUP_ENTRY') {
        const raced = await findTrack(id);
        if (raced) return res.status(200).json(raced);
      }
      throw error;
    }
    const created = await findTrack(id);
    if (!created) throw httpError(500, '歌曲已写入但读取失败，请刷新列表重试。');
    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
});

// 音频流：支持 Range（206）。客户端缓存会带回名字/MIME/修改时间，供 File 构造。
app.get('/api/tracks/:id/audio', async (req, res, next) => {
  try {
    const rows = await query(
      'SELECT id, name, mime, last_modified, audio FROM tracks WHERE id = ? LIMIT 1',
      [req.params.id],
    );
    const row = rows[0];
    if (!row) throw httpError(404, '歌曲不存在或已删除，请重新导入。');
    const buffer = Buffer.isBuffer(row.audio) ? row.audio : Buffer.from(row.audio ?? []);
    const total = buffer.length;
    const mime = String(row.mime || 'application/octet-stream');

    res.set({
      'Content-Type': mime,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=3600',
      'X-Track-Id': String(row.id),
      'X-Track-Name': encodeURIComponent(String(row.name ?? '')),
      'X-Track-Type': encodeURIComponent(mime),
      'X-Track-Last-Modified': String(number(row.last_modified)),
    });

    const range = parseRange(req.headers.range, total);
    if (range === 'invalid') {
      // 无法解析的 Range 按 RFC 9110 忽略，返回完整内容。
      res.set('Content-Length', String(total));
      res.end(buffer);
      return;
    }
    if (range === 'unsatisfiable') {
      res.status(416).set('Content-Range', `bytes */${total}`);
      res.end();
      return;
    }
    if (!range) {
      res.set('Content-Length', String(total));
      res.end(buffer);
      return;
    }
    res.status(206);
    res.set({
      'Content-Range': `bytes ${range.start}-${range.end}/${total}`,
      'Content-Length': String(range.end - range.start + 1),
    });
    res.end(buffer.subarray(range.start, range.end + 1));
  } catch (error) {
    next(error);
  }
});

app.patch('/api/tracks/:id', async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const hasTitle = Object.prototype.hasOwnProperty.call(body, 'title');
    const hasArtist = Object.prototype.hasOwnProperty.call(body, 'artist');
    if (!hasTitle && !hasArtist) throw httpError(400, '请至少提供 title 或 artist 字段。');

    const rows = await query('SELECT id, name FROM tracks WHERE id = ? LIMIT 1', [req.params.id]);
    const current = rows[0];
    if (!current) throw httpError(404, '歌曲不存在或已删除，请重新导入。');

    const fields = [];
    const params = [];
    if (hasTitle) {
      const raw = String(body.title ?? '').trim().slice(0, 255);
      // 与 IndexedDB 版一致：标题留空时回退到文件名解析出的标题/文件名。
      const fallback = parseTrackName(current.name).title || String(current.name ?? '');
      fields.push('title = ?');
      params.push(raw || fallback);
    }
    if (hasArtist) {
      fields.push('artist = ?');
      params.push(String(body.artist ?? '').trim().slice(0, 255));
    }
    params.push(req.params.id);
    await query(`UPDATE tracks SET ${fields.join(', ')} WHERE id = ?`, params);
    const updated = await findTrack(req.params.id);
    if (!updated) throw httpError(404, '歌曲不存在或已删除，请重新导入。');
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

app.post('/api/tracks/:id/play', async (req, res, next) => {
  try {
    const result = await query(
      'UPDATE tracks SET play_count = play_count + 1, last_played_at = ? WHERE id = ?',
      [Date.now(), req.params.id],
    );
    if (!result.affectedRows) throw httpError(404, '歌曲不存在或已删除，请重新导入。');
    const track = await findTrack(req.params.id);
    res.json(track);
  } catch (error) {
    next(error);
  }
});

// ---------- 歌词（自动识别） ----------

async function readCachedLyrics(trackId) {
  const rows = await query(
    'SELECT source, lrc, matched_title, matched_artist, fetched_at FROM track_lyrics WHERE track_id = ? LIMIT 1',
    [trackId],
  );
  const row = rows[0];
  if (!row || !row.lrc) return null;
  return {
    text: String(row.lrc),
    source: String(row.source || ''),
    matched: { title: String(row.matched_title || ''), artist: String(row.matched_artist || '') },
    fetchedAt: Number(row.fetched_at) || 0,
  };
}

async function saveCachedLyrics(trackId, result) {
  await query(
    `INSERT INTO track_lyrics (track_id, source, lrc, matched_title, matched_artist, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       source = VALUES(source), lrc = VALUES(lrc),
       matched_title = VALUES(matched_title), matched_artist = VALUES(matched_artist),
       fetched_at = VALUES(fetched_at)`,
    [
      trackId,
      String(result.source || ''),
      String(result.text || ''),
      String(result.matched?.title || '').slice(0, 255),
      String(result.matched?.artist || '').slice(0, 255),
      Date.now(),
    ],
  );
}

// 读取某首歌已缓存的歌词（没有则 404，由前端决定是否触发自动抓取）。
app.get('/api/tracks/:id/lyrics', async (req, res, next) => {
  try {
    const cached = await readCachedLyrics(req.params.id);
    if (!cached) throw httpError(404, '这首歌还没有歌词。');
    res.json(cached);
  } catch (error) {
    next(error);
  }
});

// 为某首歌自动搜索并缓存歌词（已缓存则直接返回）。
app.post('/api/tracks/:id/lyrics/auto', async (req, res, next) => {
  try {
    const track = await findTrack(req.params.id);
    if (!track) throw httpError(404, '歌曲不存在或已删除，请重新导入。');
    const cached = await readCachedLyrics(track.id);
    if (cached) return res.json({ ...cached, cached: true });
    const resolved = await resolveLyrics({
      title: track.title,
      artist: track.artist,
      name: track.name,
      duration: track.duration,
    });
    if (!resolved) throw httpError(404, '没有找到匹配的歌词，可在歌词面板手动导入。');
    await saveCachedLyrics(track.id, resolved);
    res.json({ ...resolved, cached: false });
  } catch (error) {
    next(error);
  }
});

// 按歌名/歌手直接搜索歌词：不要求曲目在库里，浏览器 IndexedDB 模式也能用。
// 附带 trackId 时：先查数据库缓存；抓取成功后写回 track_lyrics（实现"载入歌曲即自动识别并保存"）。
app.get('/api/lyrics/search', async (req, res, next) => {
  try {
    const title = String(req.query.title || '').slice(0, 255);
    const artist = String(req.query.artist || '').slice(0, 255);
    const name = String(req.query.name || '').slice(0, 512);
    const duration = Number(req.query.duration) || 0;
    const trackId = String(req.query.trackId || '').slice(0, 64);
    if (!title && !name) throw httpError(400, '请至少提供 title 或 name 参数。');

    // 曲目确实在 MySQL 库里时：优先用已缓存的歌词，避免重复联网
    let targetTrack = null;
    if (trackId) {
      targetTrack = await findTrack(trackId).catch(() => null);
      if (targetTrack) {
        const cached = await readCachedLyrics(targetTrack.id);
        if (cached) return res.json({ ...cached, cached: true });
      }
    }

    const resolved = await resolveLyrics({ title, artist, name, duration });
    if (!resolved) throw httpError(404, '没有找到匹配的歌词。');
    if (targetTrack) {
      await saveCachedLyrics(targetTrack.id, resolved).catch(() => {});
    }
    res.json({ ...resolved, cached: false });
  } catch (error) {
    next(error);
  }
});

// 批量补齐：给库里所有还没有歌词的歌自动抓一遍（单次最多 limit 首，默认 20）。
app.post('/api/lyrics/auto-all', async (req, res, next) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.body?.limit) || 20));
    const rows = await query(
      `SELECT t.id, t.name, t.title, t.artist, t.duration
         FROM tracks t LEFT JOIN track_lyrics l ON l.track_id = t.id
        WHERE l.track_id IS NULL
        ORDER BY t.added_at DESC
        LIMIT ?`,
      [limit],
    );
    const summary = { total: rows.length, found: 0, missing: 0, failed: 0, results: [] };
    for (const row of rows) {
      try {
        const resolved = await resolveLyrics({
          title: row.title,
          artist: row.artist,
          name: row.name,
          duration: Number(row.duration) || 0,
        });
        if (resolved) {
          await saveCachedLyrics(row.id, resolved);
          summary.found += 1;
          summary.results.push({ id: row.id, name: row.name, ok: true, source: resolved.source });
        } else {
          summary.missing += 1;
          summary.results.push({ id: row.id, name: row.name, ok: false });
        }
      } catch (error) {
        summary.failed += 1;
        summary.results.push({ id: row.id, name: row.name, ok: false, error: error.message });
      }
    }
    res.json(summary);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/tracks/:id', async (req, res, next) => {
  try {
    const result = await query('DELETE FROM tracks WHERE id = ?', [req.params.id]);
    if (!result.affectedRows) throw httpError(404, '歌曲不存在或已删除，请重新导入。');
    // 顺带清掉歌词缓存（表可能尚未创建，失败忽略）。
    await query('DELETE FROM track_lyrics WHERE track_id = ?', [req.params.id]).catch(() => {});
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// ---------- QQ 音乐（Folia 同款后端：tools/qq-api + @yakult-green-tea/qq-music-api） ----------
// 扫码/登录/搜索/歌词/播放地址由本地 3200 端口的 qq-api 服务完成，这里只做同源转发与精简。

// QQ 服务可用性（前端据此决定是否显示入口）
app.get('/api/qq/status', async (req, res, next) => {
  try {
    const ensured = await ensureQQApi();
    if (!ensured.ok) {
      return res.json({ available: false, reason: ensured.error || 'QQ 音乐服务不可用', loggedIn: false });
    }
    const status = await getStatus();
    const channels = await getChannels().catch(() => ({ channels: [] }));
    res.json({
      available: true,
      loggedIn: status.loggedIn,
      profile: status.profile,
      nickname: status.nickname || '',
      uin: status.uin || '',
      channels: channels.channels ?? [],
      configured: channels.configured !== false,
    });
  } catch (error) {
    next(error);
  }
});

// 扫码登录：key → create(二维码) → check(800 过期 / 801 等待 / 802 已扫码 / 803 成功)
app.get('/api/qq/qr/key', async (req, res, next) => {
  try {
    res.json(await qrKey(String(req.query.channel || 'qq')));
  } catch (error) {
    next(error);
  }
});

app.get('/api/qq/qr/create', async (req, res, next) => {
  try {
    const key = String(req.query.key || '');
    if (!key) throw httpError(400, '缺少二维码 key。');
    res.json(await qrCreate(key));
  } catch (error) {
    next(error);
  }
});

app.get('/api/qq/qr/check', async (req, res, next) => {
  try {
    const key = String(req.query.key || '');
    if (!key) throw httpError(400, '缺少二维码 key。');
    res.json(await qrCheck(key));
  } catch (error) {
    next(error);
  }
});

app.get('/api/qq/qr/cancel', async (req, res, next) => {
  try {
    res.json(await qrCancel(String(req.query.key || '')));
  } catch (error) {
    next(error);
  }
});

app.post('/api/qq/logout', async (req, res, next) => {
  try {
    res.json(await logout());
  } catch (error) {
    next(error);
  }
});

// 搜索 / 歌词 / 播放地址
app.get('/api/qq/search', async (req, res, next) => {
  try {
    const keyword = String(req.query.keyword || req.query.kw || '').trim();
    if (!keyword) throw httpError(400, '请输入搜索关键词。');
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    res.json({ songs: await searchSongs(keyword, { limit, page: Number(req.query.page) || 1 }) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/qq/lyric', async (req, res, next) => {
  try {
    const mid = String(req.query.mid || '');
    const name = String(req.query.name || '');
    const artist = String(req.query.artist || '');
    let text = '';
    let trans = '';
    if (mid) {
      const lyric = await getLyric(mid).catch(() => ({ text: '', trans: '' }));
      text = lyric.text;
      trans = lyric.trans;
    }
    // QQ 没有歌词时回落到酷狗/网易云在线匹配
    if (!isValidLrc(text) && name) {
      const resolved = await resolveLyrics({ title: name, artist, name: `${name}.mp3` });
      if (resolved) text = resolved.text;
    }
    if (!isValidLrc(text)) throw httpError(404, '没有找到这首歌的歌词。');
    res.json({ text, trans });
  } catch (error) {
    next(error);
  }
});

app.get('/api/qq/play', async (req, res, next) => {
  try {
    const mid = String(req.query.mid || '');
    if (!mid) throw httpError(400, '缺少歌曲 mid。');
    const result = await getPlayUrl(mid);
    res.json({ url: result.url, restriction: result.restriction });
  } catch (error) {
    next(error);
  }
});

// 音频流代理（CDN 带鉴权链接，浏览器直连会被 CORS/防盗链挡住）
app.get('/api/qq/stream', async (req, res, next) => {
  try {
    const mid = String(req.query.mid || '');
    if (!mid) throw httpError(400, '缺少歌曲 mid。');
    const upstream = await proxyStream(mid, req.headers.range);
    res.status(upstream.status === 206 ? 206 : 200);
    for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const value = upstream.headers.get(header);
      if (value) res.setHeader(header, value);
    }
    res.setHeader('Cache-Control', 'no-store');
    if (!upstream.body) throw httpError(502, '音频流为空。');
    const reader = upstream.body.getReader();
    const pump = async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    };
    pump().catch(() => res.end());
  } catch (error) {
    next(error);
  }
});

// ---------- 网易云音乐 ----------
app.get('/api/netease/status', async (req, res, next) => {
  try {
    const ensured = await ensureNeteaseApi();
    if (!ensured.ok) {
      return res.json({ available: false, reason: ensured.error || '网易云服务不可用', loggedIn: false });
    }
    const status = await getNeteaseStatus();
    res.json({
      available: true,
      loggedIn: status.loggedIn,
      nickname: status.nickname || '',
      uin: status.uin || '',
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/netease/debug', async (req, res, next) => {
  try {
    await ensureNeteaseApi();
    res.json(await getNeteaseDebugInfo());
  } catch (error) {
    next(error);
  }
});
app.get('/api/netease/qr/key', async (req, res, next) => {
  try {
    await ensureNeteaseApi();
    res.json(await neteaseQrKey());
  } catch (error) {
    next(error);
  }
});

app.get('/api/netease/qr/create', async (req, res, next) => {
  try {
    const key = String(req.query.key || '');
    if (!key) throw httpError(400, '缺少二维码 key。');
    res.json(await neteaseQrCreate(key));
  } catch (error) {
    next(error);
  }
});

app.get('/api/netease/qr/check', async (req, res, next) => {
  try {
    const key = String(req.query.key || '');
    if (!key) throw httpError(400, '缺少二维码 key。');
    res.json(await neteaseQrCheck(key));
  } catch (error) {
    next(error);
  }
});

app.post('/api/netease/captcha/sent', async (req, res, next) => {
  try {
    await ensureNeteaseApi();
    const phone = String(req.body?.phone || '').trim();
    res.json(await sendNeteaseCaptcha(phone));
  } catch (error) {
    next(error);
  }
});

app.post('/api/netease/login/captcha', async (req, res, next) => {
  try {
    await ensureNeteaseApi();
    const phone = String(req.body?.phone || '').trim();
    const captcha = String(req.body?.captcha || '').trim();
    res.json(await loginNeteaseWithCaptcha(phone, captcha));
  } catch (error) {
    next(error);
  }
});

app.post('/api/netease/cookie', async (req, res, next) => {
  try {
    const raw = String(req.body?.cookie || '').trim();
    if (!raw) throw httpError(400, '请粘贴网易云 Cookie。');
    await ensureNeteaseApi();
    res.json(await setNeteaseCookie(raw));
  } catch (error) {
    next(error);
  }
});
app.post('/api/netease/logout', async (req, res, next) => {
  try {
    res.json(await neteaseLogout());
  } catch (error) {
    next(error);
  }
});

app.get('/api/netease/search', async (req, res, next) => {
  try {
    const keyword = String(req.query.keyword || req.query.kw || '').trim();
    if (!keyword) throw httpError(400, '请输入搜索关键词。');
    await ensureNeteaseApi();
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    res.json({ songs: await searchNeteaseSongs(keyword, { limit }) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/netease/lyric', async (req, res, next) => {
  try {
    const id = String(req.query.id || '');
    const name = String(req.query.name || '');
    const artist = String(req.query.artist || '');
    if (!id) throw httpError(400, '缺少歌曲 id。');
    await ensureNeteaseApi();
    const lyric = await getNeteaseLyric(id).catch(() => ({ text: '', trans: '' }));
    let text = lyric.text;
    if (!isValidLrc(text) && name) {
      const resolved = await resolveLyrics({ title: name, artist, name: `${name}.mp3` });
      if (resolved) text = resolved.text;
    }
    if (!isValidLrc(text)) throw httpError(404, '没有找到这首歌的歌词。');
    res.json({ text, trans: lyric.trans || '' });
  } catch (error) {
    next(error);
  }
});

app.get('/api/netease/play', async (req, res, next) => {
  try {
    const id = String(req.query.id || '');
    if (!id) throw httpError(400, '缺少歌曲 id。');
    await ensureNeteaseApi();
    res.json(await getNeteasePlayUrl(id));
  } catch (error) {
    next(error);
  }
});

app.get('/api/netease/stream', async (req, res, next) => {
  try {
    const id = String(req.query.id || '');
    if (!id) throw httpError(400, '缺少歌曲 id。');
    await ensureNeteaseApi();
    const upstream = await proxyNeteaseStream(id, req.headers.range);
    res.status(upstream.status === 206 ? 206 : 200);
    for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const value = upstream.headers.get(header);
      if (value) res.setHeader(header, value);
    }
    res.setHeader('Cache-Control', 'no-store');
    if (!upstream.body) throw httpError(502, '音频流为空。');
    const reader = upstream.body.getReader();
    const pump = async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    };
    pump().catch(() => res.end());
  } catch (error) {
    next(error);
  }
});

// ---------- 酷狗音乐（免登录） ----------
app.get('/api/kugou/search', async (req, res, next) => {
  try {
    const keyword = String(req.query.keyword || req.query.kw || '').trim();
    if (!keyword) throw httpError(400, '请输入搜索关键词。');
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    res.json({ songs: await searchKugouSongs(keyword, { limit }) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/kugou/lyric', async (req, res, next) => {
  try {
    const hash = String(req.query.hash || '');
    const name = String(req.query.name || '');
    const artist = String(req.query.artist || '');
    if (!hash) throw httpError(400, '缺少歌曲 hash。');
    const lyric = await getKugouLyric(hash, { name, artist }).catch(() => ({ text: '', trans: '' }));
    let text = lyric.text;
    if (!isValidLrc(text) && name) {
      const resolved = await resolveLyrics({ title: name, artist, name: `${name}.mp3` });
      if (resolved) text = resolved.text;
    }
    if (!isValidLrc(text)) throw httpError(404, '没有找到这首歌的歌词。');
    res.json({ text, trans: lyric.trans || '' });
  } catch (error) {
    next(error);
  }
});

app.get('/api/kugou/play', async (req, res, next) => {
  try {
    const hash = String(req.query.hash || '');
    if (!hash) throw httpError(400, '缺少歌曲 hash。');
    res.json(await getKugouPlayUrl(hash));
  } catch (error) {
    next(error);
  }
});

app.get('/api/kugou/stream', async (req, res, next) => {
  try {
    const hash = String(req.query.hash || '');
    if (!hash) throw httpError(400, '缺少歌曲 hash。');
    const upstream = await proxyKugouStream(hash, req.headers.range);
    res.status(upstream.status === 206 ? 206 : 200);
    for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const value = upstream.headers.get(header);
      if (value) res.setHeader(header, value);
    }
    res.setHeader('Cache-Control', 'no-store');
    if (!upstream.body) throw httpError(502, '音频流为空。');
    const reader = upstream.body.getReader();
    const pump = async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    };
    pump().catch(() => res.end());
  } catch (error) {
    next(error);
  }
});

app.use((req, res) => {
  res.status(404).json({ error: `接口不存在：${req.method} ${req.originalUrl}` });
});

// 统一错误出口：JSON + 中文信息 + 正确状态码。
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      const limitMb = Math.round(MAX_AUDIO_BYTES / 1024 / 1024);
      return res.status(400).json({ error: `音频文件过大，单曲最大支持 ${limitMb} MB。` });
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ error: '只接受字段名 audio 的单个音频文件。' });
    }
    return res.status(400).json({ error: `上传失败：${error.message}` });
  }
  if (error?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: '请求体不是合法的 JSON。' });
  }
  // 数据库未启用：曲库相关接口返回 503，前端会据此退回浏览器 IndexedDB。
  if (error?.code === DB_DISABLED_CODE) {
    return res.status(503).json({
      error: '该功能需要数据库（曲库 / 歌词缓存 / 播放统计）。',
      code: DB_DISABLED_CODE,
      storage: 'none',
      hint: '设置 SONORA_DB_HOST 后重启 API 即可启用 MySQL，或直接使用浏览器内置的 IndexedDB 曲库。',
    });
  }
  const status = Number(error?.status) || 500;
  if (status >= 500) {
    console.error('[sonora-api]', error);
    return res.status(500).json({ error: '服务器内部错误，请查看 API 控制台输出。' });
  }
  return res.status(status).json({ error: error.message || '请求处理失败。' });
});

// 启动前幂等补齐歌词表；数据库没起时不阻塞 API 启动（曲库接口会返回 503）。
if (!dbEnabled) {
  console.log('[sonora-api] 数据库未启用（未设置 SONORA_DB_HOST）：曲库走浏览器 IndexedDB。');
} else {
  try {
    await ensureLyricsTable();
  } catch (error) {
    console.warn('[sonora-api] 歌词表初始化跳过：', error?.code || error?.message || error);
  }
}

const server = app.listen(PORT, HOST, () => {
  console.log(`[sonora-api] http://${HOST}:${PORT}`);
  if (dbEnabled) {
    console.log(
      `[sonora-api] db ${dbConfig.host}:${dbConfig.port}/${dbConfig.database} (user ${dbConfig.user})`,
    );
  } else {
    console.log('[sonora-api] storage: 浏览器 IndexedDB（未配置 MySQL）');
  }
  // 预热 QQ 音乐服务（Folia 同款：tools/qq-api），失败不影响主 API
  ensureQQApi()
    .then((result) => {
      if (result.ok) console.log(`[sonora-api] qq-api ready on :${result.port}${result.started ? ' (started)' : ''}`);
      else console.warn(`[sonora-api] qq-api 不可用：${result.error}`);
    })
    .catch((error) => console.warn('[sonora-api] qq-api 启动异常：', error.message));
  // 预热网易云 API（tools/netease/NeteaseCloudMusicApi，端口 3202）
  ensureNeteaseApi()
    .then((result) => {
      if (result.ok) console.log('[sonora-api] netease-api ready on :3202');
      else console.warn(`[sonora-api] netease-api 不可用：${result.error}`);
    })
    .catch((error) => console.warn('[sonora-api] netease-api 启动异常：', error.message));
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`[sonora-api] 端口 ${PORT} 已被占用，请先停止占用进程或设置 PORT 环境变量。`);
  } else {
    console.error('[sonora-api] 启动失败：', error);
  }
  process.exit(1);
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[sonora-api] ${signal} 收到，正在关闭...`);
  server.close(() => {
    stopQQApi();
    stopNeteaseApi();
    closePool().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 4000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// QQ 音乐后端代理（参考 Folia 的做法）：
//   实际登录/扫码/搜索/歌词/播放地址由 `tools/qq-api` 里的
//   @yakult-green-tea/qq-music-api（Rain120/qq-music-api 的增强 fork，MIT）提供，
//   它负责 QQ 音乐要求的设备身份（QIMEI）注册 —— 这也是手搓 ptlogin 会被风控的原因。
//
// 本模块做三件事：
//   1. 需要时自动拉起 qq-api 子进程（端口 3200），并提供探活；
//   2. 把 qq-api 的接口转成前端友好的精简 JSON（/api/qq/*）；
//   3. 代理音频流（CDN 链接带鉴权参数，浏览器直连会被 CORS 挡住）。

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG_ENTRY = path.join(
  ROOT,
  'tools',
  'qq-api',
  'node_modules',
  '@yakult-green-tea',
  'qq-music-api',
  'dist',
  'src',
  'app.js',
);
const STATE_DIR = path.join(ROOT, 'tools', 'qq-api', '.auth-state');
const SESSION_STORE_PATH = path.join(STATE_DIR, 'qq-session.enc');
const SECRET_FILE_PATH = path.join(STATE_DIR, 'session-secret.txt');
const AUTH_COOKIE_NAME = 'qqmusic_session';

// qq-api 在扫码成功（803）后会用 Cookie 下发会话 token（qqmusic_session），
// 之后所有需要登录的接口都靠它识别会话。我们是同源代理，必须自己维护这个 Cookie，
// 否则「登录成功」只发生在 qq-api 内部，我们后续请求全是未登录状态。
const sessionCookies = new Map();

function absorbSetCookie(response) {
  const list = typeof response?.headers?.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  for (const raw of list) {
    const pair = String(raw).split(';')[0];
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!value || /max-age=0/i.test(String(raw)) || /expires=thu, 01 jan 1970/i.test(String(raw))) sessionCookies.delete(name);
    else sessionCookies.set(name, value);
  }
}

/** 从响应体里也能拿到 cookie（qr/check 803 会带 result.cookie），兜底再捞一次 token。 */
function absorbTokenFromBody(data) {
  const cookieString = typeof data?.cookie === 'string' ? data.cookie : typeof data?.data?.cookie === 'string' ? data.data.cookie : '';
  if (!cookieString) return;
  for (const entry of cookieString.split(';')) {
    const eq = entry.indexOf('=');
    if (eq <= 0) continue;
    const name = entry.slice(0, eq).trim();
    const value = entry.slice(eq + 1).trim();
    if (name === AUTH_COOKIE_NAME && value) sessionCookies.set(AUTH_COOKIE_NAME, value);
  }
}

function cookieHeader() {
  return [...sessionCookies.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
}

function readSessionSecret() {
  if (process.env.QQ_SESSION_SECRET) return process.env.QQ_SESSION_SECRET.trim();
  try {
    return fs.readFileSync(SECRET_FILE_PATH, 'utf8').trim();
  } catch {
    return '';
  }
}

/**
 * 已保存的登录态恢复：qq-api 的加密会话文件里存着 token，
 * 启动时解出最新一条塞进 Cookie jar —— 这样重启服务后不用重新扫码。
 */
function restoreSessionTokenFromDisk() {
  try {
    if (!fs.existsSync(SESSION_STORE_PATH)) return false;
    const secret = readSessionSecret();
    if (!secret) return false;
    const require = createRequire(import.meta.url);
    const authDir = path.join(ROOT, 'tools', 'qq-api', 'node_modules', '@yakult-green-tea', 'qq-music-api', 'dist', 'src', 'services', 'auth');
    const { openJson, AUTH_SESSION_STORE_PURPOSE } = require(path.join(authDir, 'sessionCrypto.js'));
    const sessions = openJson(fs.readFileSync(SESSION_STORE_PATH, 'utf8'), secret, AUTH_SESSION_STORE_PURPOSE);
    if (!Array.isArray(sessions)) return false;
    const now = Date.now();
    const valid = sessions
      .filter((item) => item && item.token && (!item.expiresAt || Number(item.expiresAt) > now))
      .sort((a, b) => Number(b.expiresAt || 0) - Number(a.expiresAt || 0));
    if (!valid.length) return false;
    sessionCookies.set(AUTH_COOKIE_NAME, valid[0].token);
    return true;
  } catch {
    return false;
  }
}

restoreSessionTokenFromDisk();
const PORT = Number(process.env.QQ_API_PORT || 3200);
const BASE = `http://127.0.0.1:${PORT}`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const AUTOSTART = process.env.QQ_API_AUTOSTART !== 'false';

let child = null;
let starting = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function isQQApiInstalled() {
  return fs.existsSync(PKG_ENTRY);
}

async function ping(fetchImpl = globalThis.fetch) {
  try {
    const response = await fetchImpl(`${BASE}/login/status`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

function startChild() {
  if (child || !AUTOSTART) return;
  if (!isQQApiInstalled()) {
    throw Object.assign(new Error('QQ 音乐服务未安装，请先在 tools/qq-api 执行 npm install。'), { status: 503 });
  }
  fs.mkdirSync(STATE_DIR, { recursive: true });
  // 登录态加密持久化：自动生成一次随机密钥，重启服务后无需重新扫码。
  const secretFile = path.join(STATE_DIR, 'session-secret.txt');
  let sessionSecret = process.env.QQ_SESSION_SECRET || '';
  if (!sessionSecret) {
    try {
      sessionSecret = fs.readFileSync(secretFile, 'utf8').trim();
    } catch {
      sessionSecret = '';
    }
    if (sessionSecret.length < 32) {
      sessionSecret = [...crypto.randomBytes(32)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      fs.writeFileSync(secretFile, sessionSecret, { encoding: 'utf8', mode: 0o600 });
    }
  }
  child = spawn(process.execPath, [PKG_ENTRY], {
    env: {
      ...process.env,
      PORT: String(PORT),
      QQ_AUTH_STATE_PATH: path.join(STATE_DIR, 'qq-device.json'),
      QQ_AUTH_SESSION_PATH: path.join(STATE_DIR, 'qq-session.enc'),
      QQ_SESSION_SECRET: sessionSecret,
      QQ_DISABLE_UPDATE_CHECK: 'true',
      AUTO_OPEN_EXPLORER: 'false',
      LOG_LEVEL: process.env.QQ_API_LOG_LEVEL || 'warn',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const forward = (stream) => {
    stream?.setEncoding?.('utf8');
    stream?.on?.('data', (chunk) => {
      const text = String(chunk).trim();
      if (text) console.log('[qq-api]', text);
    });
  };
  forward(child.stdout);
  forward(child.stderr);
  child.on('exit', (code) => {
    if (code !== 0) console.warn(`[qq-api] 子进程退出（code=${code}）`);
    child = null;
  });
}

/** 确保 qq-api 可用：已在跑就直接复用，否则拉起并等待就绪。 */
export async function ensureQQApi({ fetchImpl = globalThis.fetch } = {}) {
  if (await ping(fetchImpl)) return { ok: true, started: false, port: PORT };
  if (!isQQApiInstalled()) return { ok: false, error: 'QQ 音乐服务未安装（tools/qq-api）' };
  try {
    if (!starting) {
      startChild();
      starting = (async () => {
        for (let i = 0; i < 60; i += 1) {
          if (await ping(fetchImpl)) return true;
          await sleep(250);
        }
        return false;
      })().finally(() => {
        starting = null;
      });
    }
    const ok = await starting;
    return ok ? { ok: true, started: true, port: PORT } : { ok: false, error: 'QQ 音乐服务启动超时' };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export function stopQQApi() {
  if (child) {
    child.kill();
    child = null;
  }
}

/** 转发请求到 qq-api 并解析 JSON。 */
export async function qqRequest(pathname, { query, method = 'GET', body } = {}, fetchImpl = globalThis.fetch) {
  const url = new URL(pathname, BASE);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const cookie = cookieHeader();
  const response = await fetchImpl(url, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  absorbSetCookie(response);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  absorbTokenFromBody(data);
  return { status: response.status, ok: response.ok, data };
}

/** 当前是否持有会话 Cookie（调试/测试用）。 */
export function hasSessionCookie() {
  return sessionCookies.has(AUTH_COOKIE_NAME);
}

// ---------- 登录 ----------

export async function getStatus(fetchImpl) {
  const { data } = await qqRequest('/login/status', {}, fetchImpl);
  // qq-api 未登录时 data 为空对象；已登录时带用户资料（嵌套在 profile.profile.info 里）
  const profile = data?.data ?? {};
  const loggedIn = Boolean(profile && Object.keys(profile).length);
  const nickname = profile?.profile?.info?.nick || profile?.nickname || profile?.name || '';
  const uin = profile?.profile?.musicid || profile?.uin || profile?.uid || '';
  return { loggedIn, profile, nickname: String(nickname || ''), uin: String(uin || '') };
}

export async function getChannels(fetchImpl) {
  const { data } = await qqRequest('/login/channels', {}, fetchImpl);
  return data?.data ?? { channels: [], configured: false };
}

export async function qrKey(channel = 'qq', fetchImpl) {
  const { data, status } = await qqRequest('/login/qr/key', { query: { channel } }, fetchImpl);
  if (!data?.data?.unikey) {
    throw Object.assign(new Error(data?.message || '获取二维码失败'), { status: status === 200 ? 502 : status });
  }
  return { key: data.data.unikey, channel };
}

export async function qrCreate(key, fetchImpl) {
  const { data, status } = await qqRequest('/login/qr/create', { query: { key } }, fetchImpl);
  if (!data?.data?.qrimg) {
    throw Object.assign(new Error(data?.message || '二维码生成失败'), { status: status === 200 ? 502 : status });
  }
  return { image: data.data.qrimg };
}

export async function qrCheck(key, fetchImpl) {
  const { data } = await qqRequest('/login/qr/check', { query: { key } }, fetchImpl);
  const code = Number(data?.code ?? 0);
  const state = { 800: 'expired', 801: 'waiting', 802: 'scanned', 803: 'ok' }[code] || 'error';
  return { code, state, message: data?.message || '', data: data?.data ?? null };
}

export async function qrCancel(key, fetchImpl) {
  await qqRequest('/login/qr/cancel', { query: { key } }, fetchImpl).catch(() => {});
  return { ok: true };
}

export async function logout(fetchImpl) {
  const { status } = await qqRequest('/logout', { method: 'POST' }, fetchImpl);
  sessionCookies.clear();
  return { ok: status < 400 };
}

// ---------- 内容 ----------

/**
 * 由专辑 mid 拼出 QQ 音乐封面地址。
 * 搜索接口本身不返回图片 URL，只给专辑 mid；QQ 的封面 CDN 规则是固定的：
 * https://y.gtimg.cn/music/photo_new/T002R<尺寸>x<尺寸>M000<专辑mid>.jpg
 * @param {string} albumMid
 * @param {number} [size] 150 / 300 / 500
 * @returns {string} mid 非法时返回空串
 */
export function albumCoverUrl(albumMid, size = 500) {
  const mid = String(albumMid ?? '').trim();
  if (!/^[0-9A-Za-z]{5,}$/.test(mid)) return '';
  const px = [150, 300, 500].includes(Number(size)) ? Number(size) : 500;
  return `https://y.gtimg.cn/music/photo_new/T002R${px}x${px}M000${mid}.jpg`;
}

export async function searchSongs(keyword, { page = 1, limit = 20, type = 'song' } = {}, fetchImpl) {
  const { data } = await qqRequest('/search', { query: { keyword, type, page, limit } }, fetchImpl);
  const items = Array.isArray(data?.items) ? data.items : [];
  return items.map((item) => ({
    mid: String(item.mid ?? ''),
    name: String(item.name ?? item.title ?? ''),
    singer: (Array.isArray(item.singer) ? item.singer : []).map((one) => one?.name).filter(Boolean).join(' / '),
    album: String(item.album?.name ?? ''),
    // 专辑封面：搜索只给专辑 mid，这里按 CDN 规则拼出图片地址（取不到时为空串）。
    cover: albumCoverUrl(item.album?.mid),
    duration: Number(item.interval) || 0,
  })).filter((song) => song.mid && song.name);
}

export async function getLyric(mid, fetchImpl) {
  const { data } = await qqRequest('/getLyric', { query: { songmid: mid, isFormat: '1', trans: '1' } }, fetchImpl);
  const lyric = data?.response?.lyric ?? data?.lyric ?? null;
  const text = typeof lyric === 'string' ? lyric : String(lyric?.lyric ?? '');
  const trans = typeof lyric === 'string' ? '' : String(lyric?.trans ?? '');
  return { text, trans };
}

/** 取播放地址；无权限时抛 404。 */
export async function getPlayUrl(mid, fetchImpl) {
  const { data } = await qqRequest(`/getMusicPlay/${encodeURIComponent(mid)}`, {}, fetchImpl);
  const entry = data?.data?.playUrl?.[mid] ?? Object.values(data?.data?.playUrl ?? {})[0];
  const url = entry?.url || '';
  if (!url) {
    const reason = entry?.error || entry?.restriction?.hint?.message || '暂无播放链接';
    throw Object.assign(new Error(reason), { status: 404 });
  }
  return { url, restriction: entry?.restriction ?? null };
}

/** 代理音频流（支持 Range）。 */
export async function proxyStream(mid, rangeHeader, fetchImpl = globalThis.fetch) {
  const { url } = await getPlayUrl(mid, fetchImpl);
  const upstream = await fetchImpl(url, {
    headers: {
      'User-Agent': UA,
      // QQ 音乐 CDN 对来源敏感的曲目会校验 Referer / Origin，带上更不容易 403
      Referer: 'https://y.qq.com/',
      Origin: 'https://y.qq.com',
      ...(rangeHeader ? { Range: rangeHeader } : {}),
    },
  });
  if (!upstream.ok && upstream.status !== 206) {
    throw Object.assign(new Error(`音频流拉取失败（${upstream.status}）`), { status: 502 });
  }
  return upstream;
}

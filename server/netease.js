// 网易云音乐 provider：复用 tools/netease 里已安装的 NeteaseCloudMusicApi（MIT）。
// 该服务默认监听 3202；登录态是一段 cookie 字符串，通过 ?cookie= 参数传递，
// 所以这里维护一份磁盘持久化的 cookie，扫码成功后自动带上。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = path.join(ROOT, 'tools', 'netease', 'node_modules', 'NeteaseCloudMusicApi', 'app.js');
const STATE_DIR = path.join(ROOT, 'tools', 'netease', '.auth-state');
const COOKIE_FILE = path.join(STATE_DIR, 'netease-cookie.txt');
const PORT = Number(process.env.NETEASE_PORT || 3202);
const BASE = `http://127.0.0.1:${PORT}`;

let child = null;
let starting = false;
let cookie = loadCookie();

const COOKIE_ATTRIBUTES = new Set(['max-age', 'expires', 'path', 'domain', 'secure', 'httponly', 'samesite', 'version', 'priority']);

/** 把 Set-Cookie 风格的字符串净化成 "a=b; c=d"。 */
export function sanitizeCookie(raw) {
  const pairs = new Map();
  for (const part of String(raw || '').split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!name || !value) continue;
    if (COOKIE_ATTRIBUTES.has(name.toLowerCase())) continue;
    if (!/^[\w.~-]+$/.test(name)) continue;
    pairs.set(name, value);
  }
  return [...pairs.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

function loadCookie() {
  try {
    return sanitizeCookie(fs.readFileSync(COOKIE_FILE, 'utf8'));
  } catch {
    return '';
  }
}

function saveCookie(value) {
  cookie = sanitizeCookie(value);
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    if (cookie) fs.writeFileSync(COOKIE_FILE, cookie, { encoding: 'utf8', mode: 0o600 });
    else fs.rmSync(COOKIE_FILE, { force: true });
  } catch {
    // 写盘失败不影响本次会话
  }
}

export function hasLoginCookie() {
  return Boolean(cookie);
}

async function ping(fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(`${BASE}/login/status`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

/** 确保 3202 的网易云服务在跑；返回 {ok,error?}。 */
export async function ensureNeteaseApi(fetchImpl = globalThis.fetch) {
  if (await ping(fetchImpl)) return { ok: true };
  if (!fs.existsSync(ENTRY)) {
    return { ok: false, error: '没有安装网易云 API（tools/netease）。' };
  }
  if (!child && !starting) {
    starting = true;
    try {
      child = spawn(process.execPath, [ENTRY], {
        cwd: path.dirname(ENTRY),
        env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      child.stdout?.on('data', (chunk) => process.stdout.write(`[netease-api] ${chunk}`));
      child.stderr?.on('data', (chunk) => process.stderr.write(`[netease-api] ${chunk}`));
      child.on('exit', () => {
        child = null;
      });
    } catch (error) {
      child = null;
      return { ok: false, error: error.message };
    } finally {
      starting = false;
    }
  }
  for (let i = 0; i < 40; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (await ping(fetchImpl)) return { ok: true };
  }
  return { ok: false, error: '网易云服务启动超时。' };
}

export function stopNeteaseApi() {
  if (!child) return;
  try {
    child.kill();
  } catch {
    // 忽略
  }
  child = null;
}

async function request(pathname, { query = {}, method = 'GET' } = {}, fetchImpl = globalThis.fetch) {
  const url = new URL(pathname, BASE);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  if (cookie) url.searchParams.set('cookie', cookie);
  const response = await fetchImpl(url, { method });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { status: response.status, ok: response.ok, data };
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export async function getStatus(fetchImpl = globalThis.fetch) {
  const { data } = await request('/login/status', {}, fetchImpl);
  const profile = data?.data?.profile ?? null;
  return {
    loggedIn: Boolean(profile && profile.userId),
    profile,
    nickname: String(profile?.nickname || ''),
    uin: String(profile?.userId || ''),
  };
}

/** 调试用：当前 cookie 概况 + 登录状态原始数据（不含 cookie 本身）。 */
export async function getDebugInfo(fetchImpl = globalThis.fetch) {
  const { data } = await request('/login/status', {}, fetchImpl);
  return {
    hasCookie: Boolean(cookie),
    cookieLength: cookie.length,
    cookieNames: cookie
      .split(';')
      .map((part) => part.split('=')[0].trim())
      .filter(Boolean),
    status: data,
  };
}

export async function qrKey(fetchImpl = globalThis.fetch) {
  const { data } = await request('/login/qr/key', {}, fetchImpl);
  const key = data?.data?.unikey;
  if (!key) throw httpError(502, '网易云二维码 key 获取失败。');
  return { key };
}

export async function qrCreate(key, fetchImpl = globalThis.fetch) {
  const { data } = await request('/login/qr/create', { query: { key, qrimg: 'true' } }, fetchImpl);
  const payload = data?.data ?? {};
  return { key, qrurl: payload.qrurl || '', qrimg: payload.qrimg || '' };
}

export async function qrCheck(key, fetchImpl = globalThis.fetch) {
  const { data } = await request('/login/qr/check', { query: { key } }, fetchImpl);
  const code = Number(data?.code);
  const cookieString = typeof data?.cookie === 'string' ? data.cookie : '';
  const hasMusicU = cookieString.includes('MUSIC_U=');
  if (hasMusicU) saveCookie(cookieString);
  if (code === 803 || hasMusicU) {
    console.log('[netease] qr check', { code, hasCookie: Boolean(cookieString), hasMusicU, saved: hasMusicU && Boolean(cookie) });
  }
  const state = code === 803 ? 'ok' : code === 802 ? 'scanned' : code === 800 ? 'expired' : 'waiting';
  return { code, state, message: data?.message || '' };
}

/** 发送手机验证码。 */
export async function sendCaptcha(phone, ctcode = '86', fetchImpl = globalThis.fetch) {
  const number = String(phone || '').replace(/\D/g, '');
  if (number.length < 6) throw httpError(400, '请输入有效手机号。');
  const { data } = await request('/captcha/sent', { query: { phone: number, ctcode: String(ctcode || '86') } }, fetchImpl);
  const code = Number(data?.code);
  if (code !== 200) throw httpError(400, data?.message || data?.msg || '验证码发送失败，请稍后再试。');
  return { ok: true, message: '验证码已发送，请查看手机短信。' };
}

/** 手机号 + 验证码登录。 */
export async function loginWithCaptcha(phone, captcha, countrycode = '86', fetchImpl = globalThis.fetch) {
  const number = String(phone || '').replace(/\D/g, '');
  const code = String(captcha || '').replace(/\D/g, '');
  if (number.length < 6) throw httpError(400, '请输入有效手机号。');
  if (code.length < 4) throw httpError(400, '请输入短信验证码。');
  const { data } = await request('/login/cellphone', {
    query: { phone: number, captcha: code, countrycode: String(countrycode || '86') },
  }, fetchImpl);
  const responseCode = Number(data?.code);
  const cookieString = typeof data?.cookie === 'string' ? data.cookie : '';
  if (cookieString.includes('MUSIC_U=')) saveCookie(cookieString);
  const status = await getStatus(fetchImpl).catch(() => null);
  if (!status?.loggedIn) {
    throw httpError(400, data?.message || data?.msg || '验证码登录失败，请检查手机号 / 验证码。');
  }
  return { ok: true, ...status };
}

/** 用户手动粘贴的 Cookie（扫码失败时的兜底）：净化后校验并保存。 */
export async function setUserCookie(raw, fetchImpl = globalThis.fetch) {
  const clean = sanitizeCookie(raw);
  if (!clean.includes('MUSIC_U=')) {
    throw httpError(400, 'Cookie 里没有 MUSIC_U，请复制完整的网易云 Cookie（至少包含 MUSIC_U 和 __csrf）。');
  }
  saveCookie(clean);
  const status = await getStatus(fetchImpl).catch(() => null);
  if (!status?.loggedIn) {
    saveCookie('');
    throw httpError(401, 'Cookie 无效或已过期，请重新从 music.163.com 复制。');
  }
  return { ok: true, ...status };
}
export async function logout(fetchImpl = globalThis.fetch) {
  await request('/logout', { method: 'POST' }, fetchImpl).catch(() => null);
  saveCookie('');
  return { ok: true };
}

export async function searchSongs(keyword, { limit = 20 } = {}, fetchImpl = globalThis.fetch) {
  const { data } = await request('/cloudsearch', { query: { keywords: keyword, limit, type: 1 } }, fetchImpl);
  const songs = data?.result?.songs ?? [];
  return songs.map((song) => ({
    id: String(song.id),
    name: String(song.name || ''),
    singer: (song.ar ?? []).map((artist) => artist.name).filter(Boolean).join(' / '),
    album: String(song.al?.name || ''),
    // 网易云搜索结果的 al 里自带封面地址（取不到时为空串）。
    cover: String(song.al?.picUrl || ''),
    duration: Math.round(Number(song.dt || 0) / 1000),
  }));
}

export async function getPlayUrl(id, fetchImpl = globalThis.fetch) {
  const { data } = await request('/song/url/v1', { query: { id, level: 'standard' } }, fetchImpl);
  const item = data?.data?.[0];
  if (!item?.url) throw httpError(404, '网易云这首歌曲需要 VIP 或受版权限制，暂时拿不到播放地址。');
  return { url: item.url, restriction: 0 };
}

export async function getLyric(id, fetchImpl = globalThis.fetch) {
  const { data } = await request('/lyric', { query: { id } }, fetchImpl);
  return { text: String(data?.lrc?.lyric || ''), trans: String(data?.tlyric?.lyric || '') };
}

export async function proxyStream(id, range, fetchImpl = globalThis.fetch) {
  const { url } = await getPlayUrl(id, fetchImpl);
  return fetchImpl(url, {
    headers: {
      ...(range ? { Range: range } : {}),
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      Referer: 'https://music.163.com/',
    },
  });
}

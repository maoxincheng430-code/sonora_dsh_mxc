// MySQL/MariaDB 连接池与查询封装。
// 连接参数可用环境变量覆盖（见 MYSQL.md）：
//   SONORA_DB_HOST / SONORA_DB_PORT / SONORA_DB_USER / SONORA_DB_PASSWORD / SONORA_DB_NAME
//
// 数据库是「可选」的：只有设置了 SONORA_DB_HOST 才会创建连接池。
// 不设置时整个 API 仍可启动（在线音乐、歌词搜索等不依赖 DB 的功能照常工作），
// 曲库相关接口返回 503 并带 code=DB_DISABLED，前端据此退回浏览器 IndexedDB。
import mysql from 'mysql2/promise';

const env = (key, fallback) => {
  const value = process.env[key];
  return value === undefined || value === '' ? fallback : value;
};

const toInt = (value, fallback) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
};

// 显式设置 SONORA_DB_HOST 才启用数据库；设为 "off"/"none"/"0" 可强制关闭。
const rawHost = process.env.SONORA_DB_HOST;
const hostDisabled = ['off', 'none', 'false', '0'].includes(
  String(rawHost ?? '').trim().toLowerCase(),
);
export const dbEnabled = Boolean(rawHost) && !hostDisabled;

export const DB_DISABLED_CODE = 'DB_DISABLED';

export const dbConfig = {
  host: env('SONORA_DB_HOST', '127.0.0.1'),
  port: toInt(env('SONORA_DB_PORT', ''), 3307),
  user: env('SONORA_DB_USER', 'root'),
  password: env('SONORA_DB_PASSWORD', ''),
  database: env('SONORA_DB_NAME', 'sonora'),
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: toInt(env('SONORA_DB_POOL', ''), 8),
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  supportBigNumbers: true,
  bigNumberStrings: false,
};

// 未启用数据库时不创建连接池（mysql2 的 createPool 是惰性的，但也没必要创建）。
export const pool = dbEnabled ? mysql.createPool(dbConfig) : null;

export function dbDisabledError() {
  const error = new Error('数据库未启用：设置 SONORA_DB_HOST 后重启 API 即可接入 MySQL。');
  error.code = DB_DISABLED_CODE;
  error.status = 503;
  return error;
}

let closing = null;

// 返回 SELECT 结果行；写操作用它也能拿到 ResultSetHeader（affectedRows 等）。
export async function query(sql, params = []) {
  if (!pool) throw dbDisabledError();
  const [rows] = await pool.query(sql, params);
  return rows;
}

export async function ping() {
  if (!pool) throw dbDisabledError();
  await pool.query('SELECT 1');
  return true;
}

// 曲库可用时返回曲目总数，失败时抛出（由调用方转成 503）。
export async function countTracks() {
  if (!pool) throw dbDisabledError();
  const rows = await pool.query('SELECT COUNT(*) AS count FROM tracks');
  return Number(rows[0][0]?.count ?? 0);
}

// 幂等补齐歌词缓存表（老数据库无需重新 setup）。
export async function ensureLyricsTable() {
  if (!pool) throw dbDisabledError();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`track_lyrics\` (
      \`track_id\`   VARCHAR(64)  NOT NULL,
      \`source\`     VARCHAR(32)  NOT NULL DEFAULT '',
      \`lrc\`        MEDIUMTEXT   NOT NULL,
      \`matched_title\`  VARCHAR(255) NOT NULL DEFAULT '',
      \`matched_artist\` VARCHAR(255) NOT NULL DEFAULT '',
      \`fetched_at\` BIGINT       NOT NULL DEFAULT 0,
      PRIMARY KEY (\`track_id\`),
      KEY \`idx_track_lyrics_fetched\` (\`fetched_at\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export function closePool() {
  if (!pool) return Promise.resolve();
  if (!closing) closing = pool.end().catch(() => {});
  return closing;
}

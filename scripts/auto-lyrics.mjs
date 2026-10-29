// 自动补歌词：扫描「音乐文件夹」或「MySQL 曲库」，按歌名/歌手搜歌词并写入 public/lyrics/。
//
// 用法：
//   npm run lyrics:auto                          # 处理 MySQL 曲库里还没有歌词的歌
//   npm run lyrics:auto -- --dir "C:/Users/you/Music"      # 递归扫描一个音乐文件夹
//   npm run lyrics:auto -- --dir "C:/Users/you/Music" --force   # 已有歌词也重新抓
//   npm run lyrics:auto -- --dry-run             # 只看会做什么，不写文件
//   npm run lyrics:auto -- --limit 50            # 限制处理数量
//
// 输出：public/lyrics/<歌名> - <歌手>.lrc + 更新 public/lyrics/index.json
// 说明：歌词源为酷狗（免登录），网易云作为备源（需 tools/netease 里已装包）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTrackName } from '../src/library-model.js';
import { resolveLyrics } from '../server/lyrics.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LYRICS_DIR = path.join(ROOT, 'public', 'lyrics');
const INDEX_FILE = path.join(LYRICS_DIR, 'index.json');
const AUDIO_EXT = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|webm|aif|aiff|wma)$/i;

function parseArgs(argv) {
  const args = { dir: '', limit: 0, force: false, dryRun: false, db: false };
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (item === '--dir') args.dir = argv[++i] || '';
    else if (item === '--limit') args.limit = Number(argv[++i]) || 0;
    else if (item === '--force') args.force = true;
    else if (item === '--dry-run') args.dryRun = true;
    else if (item === '--db') args.db = true;
  }
  return args;
}

function safeFileName(title, artist) {
  const base = [title, artist].filter(Boolean).join(' - ') || '未命名';
  return base.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
}

function loadIndex() {
  try {
    const data = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
    const tracks = Array.isArray(data) ? data : (data?.tracks ?? []);
    return tracks.filter((item) => item && typeof item.file === 'string');
  } catch {
    return [];
  }
}

function saveIndex(tracks) {
  const merged = [...tracks].sort((a, b) => String(a.title).localeCompare(String(b.title), 'zh-CN'));
  fs.writeFileSync(INDEX_FILE, `${JSON.stringify({ version: 1, tracks: merged }, null, 2)}\n`, 'utf8');
}

function upsertIndex(tracks, entry) {
  const key = `${entry.title}|${entry.artist}`.toLowerCase();
  const index = tracks.findIndex(
    (item) => `${item.title}|${item.artist}`.toLowerCase() === key || item.file === entry.file,
  );
  if (index >= 0) tracks[index] = { ...tracks[index], ...entry };
  else tracks.push(entry);
}

function walkAudioFiles(dir, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (/^(node_modules|\.git|\.mysql|dist|test-results|\.verify|\.tmp)/i.test(entry.name)) continue;
      walkAudioFiles(full, out);
    } else if (AUDIO_EXT.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

async function collectFromDir(dir, limit) {
  const files = walkAudioFiles(dir);
  const tracks = files.map((full) => {
    const name = path.basename(full);
    const { title, artist } = parseTrackName(name);
    return { name, title, artist, duration: 0, file: full };
  });
  return limit > 0 ? tracks.slice(0, limit) : tracks;
}

async function collectFromDatabase(limit) {
  let mysql;
  try {
    mysql = await import('mysql2/promise');
  } catch {
    console.error('未安装 mysql2，无法读取数据库。可改用 --dir 扫描文件夹。');
    return [];
  }
  const env = (key, fallback) => (process.env[key] === undefined || process.env[key] === '' ? fallback : process.env[key]);
  const connection = await mysql.createConnection({
    host: env('SONORA_DB_HOST', '127.0.0.1'),
    port: Number(env('SONORA_DB_PORT', '3307')),
    user: env('SONORA_DB_USER', 'root'),
    password: env('SONORA_DB_PASSWORD', ''),
    database: env('SONORA_DB_NAME', 'sonora'),
    charset: 'utf8mb4',
  });
  try {
    const [rows] = await connection.query(
      `SELECT t.id, t.name, t.title, t.artist, t.duration
         FROM tracks t LEFT JOIN track_lyrics l ON l.track_id = t.id
        WHERE l.track_id IS NULL
        ORDER BY t.added_at DESC
        ${limit > 0 ? 'LIMIT ?' : ''}`,
      limit > 0 ? [limit] : [],
    );
    return rows.map((row) => ({
      name: String(row.name ?? ''),
      title: String(row.title ?? ''),
      artist: String(row.artist ?? ''),
      duration: Number(row.duration) || 0,
      trackId: row.id,
    }));
  } finally {
    await connection.end().catch(() => {});
  }
}

const args = parseArgs(process.argv.slice(2));
const hasDir = Boolean(args.dir);
if (!hasDir && !fs.existsSync(path.join(ROOT, '.mysql'))) {
  console.log('提示：本机还没有初始化数据库。若只想处理某个音乐文件夹，请用：');
  console.log('  npm run lyrics:auto -- --dir "C:/Users/you/Music"');
}

fs.mkdirSync(LYRICS_DIR, { recursive: true });
const indexTracks = loadIndex();
const tracks = hasDir ? await collectFromDir(args.dir, args.limit) : await collectFromDatabase(args.limit);

console.log(`待处理曲目：${tracks.length} 首${hasDir ? `（文件夹：${args.dir}）` : '（来自 MySQL 曲库）'}`);
if (!tracks.length) {
  console.log('没有需要补歌词的歌曲。');
  process.exit(0);
}

let saved = 0;
let skipped = 0;
let missing = 0;
let failed = 0;

for (const track of tracks) {
  const label = `${track.title || track.name}${track.artist ? ` — ${track.artist}` : ''}`;
  try {
    const fileName = `${safeFileName(track.title || parseTrackName(track.name).title, track.artist)}.lrc`;
    const target = path.join(LYRICS_DIR, fileName);
    if (!args.force && fs.existsSync(target)) {
      skipped += 1;
      console.log(`⏭  已存在，跳过：${label}`);
      continue;
    }
    const resolved = await resolveLyrics(track);
    if (!resolved) {
      missing += 1;
      console.log(`✖  未找到歌词：${label}`);
      continue;
    }
    if (args.dryRun) {
      console.log(`⋯  [dry-run] 将写入 ${fileName}（来源 ${resolved.source}，${resolved.text.length} 字符）`);
      saved += 1;
      continue;
    }
    fs.writeFileSync(target, resolved.text, 'utf8');
    upsertIndex(indexTracks, {
      file: fileName,
      title: parseTrackName(track.name).title || track.title || '',
      artist: track.artist || '',
      source: resolved.source,
      aliases: [resolved.matched?.title, resolved.matched?.artist].filter(Boolean),
    });
    saved += 1;
    console.log(`✔  ${label} → ${fileName}（${resolved.source}，${resolved.text.length} 字符）`);
  } catch (error) {
    failed += 1;
    console.log(`✖  失败：${label}：${error.message}`);
  }
}

if (!args.dryRun && saved > 0) {
  saveIndex(indexTracks);
  console.log(`\n歌词索引已更新：${INDEX_FILE}`);
}
console.log(
  `\n完成：成功 ${saved}，已存在跳过 ${skipped}，未找到 ${missing}，失败 ${failed}` +
    `${args.dryRun ? '（dry-run，未写入文件）' : ''}`,
);

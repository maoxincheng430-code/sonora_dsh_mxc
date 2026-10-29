# Sonora 曲库数据库（便携 MariaDB + Express API）

> **数据库是可选的。** 不装数据库也能完整使用：曲库默认存在浏览器 IndexedDB 里。
> 只有想让曲库"跨浏览器共享 / 换电脑不丢"时才需要这一章。
>
> 只需要三步就能跑起来的零配置版本，见 [README 快速开始](./README.md#快速开始30-秒)。

本项目在 Windows（无管理员权限）上用**便携版 MariaDB 11.4**替代浏览器 IndexedDB：歌曲元数据存 MySQL 表，音频作为 `LONGBLOB` 存在同一张表里，由本地 Express API 提供 REST 接口，前端通过 `src/library-api.js` 访问。

```
浏览器 (Vite)  ──HTTP──>  server/index.js (Express, 127.0.0.1:8787)
                              │ mysql2 连接池
                              ▼
                     MariaDB 11.4 (127.0.0.1:3307, 数据库 sonora)
                       数据目录 .mysql/data（gitignore）
```

> API 在没有配置 `SONORA_DB_HOST` 时会以"无数据库模式"启动：在线音乐、歌词搜索等功能照常，
> 曲库相关接口返回 `503 { code: "DB_DISABLED" }`，前端自动回退 IndexedDB。

- 数据库：`127.0.0.1:3307`，只监听本机回环地址，**不是系统服务**，不写注册表，不需要管理员权限。
- 用户：`root`，**空密码**（仅本机监听，切勿把 3307 暴露到公网）。
- 字符集：`utf8mb4` / `utf8mb4_unicode_ci`。
- 所有便携二进制与数据都在项目的 `.mysql/` 目录（已 gitignore），删除该目录即可彻底清除。

## 快速开始

```powershell
# 1) 首次准备：下载/解压便携 MariaDB → 初始化数据目录 → 启动 → 建库建表
npm run db:setup          # 幂等；已下载/已初始化则直接跳过对应步骤

# 2) 后续每次开机（db:setup 也可重复执行）
npm run db:start

# 3) 启动 API（另开一个终端，保持运行）
npm run server            # http://127.0.0.1:8787

# 4) 前端（原有命令不变）
npm run dev               # http://127.0.0.1:5173

# 停止
npm run db:stop           # 优雅关闭 mysqld（保留数据）
```

等价的原始命令（不依赖 npm）：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/db-setup.ps1
powershell -ExecutionPolicy Bypass -File scripts/db-start.ps1
powershell -ExecutionPolicy Bypass -File scripts/db-stop.ps1
node server/index.js
```

脚本同时兼容 Windows PowerShell 5.1 与 PowerShell 7，路径含空格/中文时会正确加引号；重复执行不会重复下载、不会重复初始化、不会清库。

### 下载与目录

- 下载源：`https://archive.mariadb.org/mariadb-11.4.5/winx64-packages/mariadb-11.4.5-winx64.zip`（约 87 MB）
- 缓存：`.mysql/cache/mariadb-11.4.5-winx64.zip`（完整文件会跳过下载）
- 服务端：`.mysql/mariadb-11.4.5-winx64/`
- 数据：`.mysql/data/`；配置：`.mysql/my.ini`；临时目录：`.mysql/tmp/`；日志：`.mysql/data/error.log`

> 说明：MariaDB 的 Windows 包没有 MySQL 的 `--initialize-insecure`，初始化实际调用 `mysql_install_db.exe --password=`（root 空密码等价效果）。`my.ini` 中所有 Windows 路径均写成正斜杠形式，避免 option file 把 `\t` 之类的反斜杠转义解析成控制字符；同时显式设置 `tmpdir` 到项目内 `.mysql/tmp`（Windows 下 InnoDB 启动需要可写的临时目录）。`db-start` 通过 WMI `Win32_Process.Create` 分离启动 mysqld，不会让调用方（npm/CI/管道）一直等待进程输出结束。

## 连接参数

| 项 | 值 |
| --- | --- |
| host / port | `127.0.0.1` / `3307`（只监听回环） |
| user / password | `root` / 空密码 |
| database | `sonora` |
| charset | `utf8mb4` |

用 mysql 客户端连接：

```powershell
.mysql\mariadb-11.4.5-winx64\bin\mysql.exe --defaults-file=.mysql\my.ini -u root
# 或
.mysql\mariadb-11.4.5-winx64\bin\mysql.exe --host=127.0.0.1 --port=3307 --user=root
```

`server/db.js` 支持环境变量覆盖：`SONORA_DB_HOST`、`SONORA_DB_PORT`、`SONORA_DB_USER`、`SONORA_DB_PASSWORD`、`SONORA_DB_NAME`、`SONORA_DB_POOL`；API 端口用 `PORT`（默认 8787），上传上限用 `SONORA_MAX_AUDIO_BYTES`（默认 134217728 = 128 MB）。

## 表结构（`server/schema.sql`）

数据库 `sonora`，表 `tracks`（utf8mb4）：

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `VARCHAR(64)` PK | 见下方 id 规则 |
| `name` | `VARCHAR(512) NOT NULL` | 原始文件名 |
| `title` | `VARCHAR(255)` | 显示标题（默认从文件名解析 `歌手 - 歌名`） |
| `artist` | `VARCHAR(255)` | 歌手 |
| `duration` | `DOUBLE` | 时长（秒） |
| `size` | `BIGINT` | 文件字节数 |
| `mime` | `VARCHAR(128)` | MIME，如 `audio/mpeg` |
| `last_modified` | `BIGINT` | `File.lastModified`（epoch ms） |
| `added_at` | `BIGINT` | 导入时间（epoch ms），有索引 `idx_tracks_added_at` |
| `play_count` | `INT DEFAULT 0` | 播放次数 |
| `last_played_at` | `BIGINT DEFAULT 0` | 最近播放时间（epoch ms） |
| `audio` | `LONGBLOB NOT NULL` | 原始音频二进制 |
| `created_at` | `TIMESTAMP DEFAULT CURRENT_TIMESTAMP` | 入库时间 |

### id 规则

与前端 IndexedDB 版相同的去重键（文件名 + 大小 + 修改时间），但为了适配 `VARCHAR(64)` 主键，取 **SHA-256 十六进制**（正好 64 字符）：

```
id = sha256(JSON.stringify([name, size, lastModified]))   // 64 位 hex
```

同一个文件重复导入得到同一个 id，服务端据此去重；不同文件碰撞概率可忽略。`lastModified` 由前端在 multipart 中作为可选字段 `lastModified` 传递，缺省用服务端当前时间。

## REST API

Base URL：`http://127.0.0.1:8787`。所有响应为 JSON（音频接口除外）；错误统一为 `{ "error": "中文错误信息" }`，状态码 400 / 404 / 416 / 500 / 503。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | `{ ok: true, db: true, count: n }`；数据库不可用时 503 + `{ ok:false, db:false, error }` |
| GET | `/api/tracks` | 元数据数组（不含 audio），按 `added_at` 倒序；字段 camelCase：`id,name,title,artist,duration,size,type,lastModified,addedAt,playCount,lastPlayedAt` |
| POST | `/api/tracks` | `multipart/form-data`：`audio`=文件，可选 `duration`（秒）、`lastModified`（ms）。新建返回 201；同名同大小同修改时间返回已有记录 200 |
| GET | `/api/tracks/:id/audio` | 音频流；支持单段 `Range`，返回 206 + `Content-Range`；`Content-Type` 用记录中的 mime |
| PATCH | `/api/tracks/:id` | JSON `{ title?, artist? }` → 更新后的 track；两个字段都缺省返回 400 |
| POST | `/api/tracks/:id/play` | `play_count + 1`、`last_played_at = now` → 更新后的 track |
| DELETE | `/api/tracks/:id` | 删除（含音频）→ `{ ok: true }`；不存在返回 404 |

示例：

```powershell
$base = 'http://127.0.0.1:8787'
Invoke-RestMethod "$base/api/health"
Invoke-RestMethod -Method Post -Form @{ audio = Get-Item .\demo.wav; duration = '3.2' } "$base/api/tracks"
Invoke-RestMethod "$base/api/tracks"
# Range 请求（PowerShell 需要显式取回响应对象）
$resp = Invoke-WebRequest -Headers @{ Range = 'bytes=0-99' } "$base/api/tracks/<id>/audio"
$resp.StatusCode  # 206
Invoke-RestMethod -Method Patch -ContentType 'application/json' -Body (@{ title = '新标题'; artist = '新歌手' } | ConvertTo-Json) "$base/api/tracks/<id>"
Invoke-RestMethod -Method Post "$base/api/tracks/<id>/play"
Invoke-RestMethod -Method Delete "$base/api/tracks/<id>"
```

CORS 白名单：`http://127.0.0.1:5173`、`http://localhost:5173`、`http://127.0.0.1:4173`、`http://localhost:4173`。可用 `SONORA_CORS_ORIGINS`（逗号分隔）追加。

## 前端接入方式

`src/library-api.js` 与现有 `MusicLibrary`（`src/library.js`）**同形**，可直接替换：

```js
import { createRemoteLibrary, probeServer } from './library-api.js';

const library = createRemoteLibrary();       // 默认 http://127.0.0.1:8787
await library.open();                         // 探测 /api/health，连不上抛中文错误
const track  = await library.save(file, duration);
const tracks = await library.list();
const file2  = await library.read(track.id);  // 返回 File（name/type/lastModified 从响应头带回）
await library.update(track.id, { title, artist });
await library.touch(track.id);                // 播放计数
await library.remove(track.id);
library.close();
```

- `probeServer(baseUrl, timeoutMs = 1200)` 返回 `boolean`，内部用 `AbortController` 超时，不会抛错。
- 方法直接可用，不强制先调用 `open()`（`main.js` 目前是直接 `list()`），`open()` 只是显式健康检查。
- 建议的过渡策略：启动时 `if (await probeServer())` 用 `createRemoteLibrary()`，否则回退到现有 `MusicLibrary`（IndexedDB）。两者返回的 track 字段一致，UI 层无需改动。
- `remove()` 对 404 做幂等处理（与 IndexedDB `delete` 一致），不会因为重复删除报错。
- `read()` 优先使用音频响应头 `X-Track-Name` / `X-Track-Type` / `X-Track-Last-Modified`，其次使用列表缓存，最后回退默认名。

## 运维与排障

- **查看是否在运行**：`Get-NetTCPConnection -LocalPort 3307` 或用 mysqladmin ping。
- **状态**：`Invoke-RestMethod http://127.0.0.1:8787/api/health`。
- **日志**：`.mysql/data/error.log`；API 输出在运行 `node server/index.js` 的终端。mysqld 的 PID 记录在 `.mysql/mysqld.pid`。
- **端口冲突**：5173 是 Vite，别动；3307/8787 若被占用，脚本会明确报错。API 可用 `PORT` 环境变量改端口。
- **重置数据库**：`npm run db:stop` 后删除 `.mysql/data/`，再 `npm run db:setup`（会重新初始化，曲库清空）。
- **彻底重装**：删除 `.mysql/` 后重新 `npm run db:setup`（会重新下载约 87 MB）。
- **备份**：数据都在 `.mysql/data/`；也可用 `mysqldump --defaults-file=.mysql/my.ini -u root sonora > sonora.sql`。
- **PowerShell 执行策略**：脚本通过 `-ExecutionPolicy Bypass` 调用，不需要改系统策略。
- **路径**：项目路径含空格/中文已做引号处理；但 MariaDB 的 `my.ini` 基于系统 ANSI 读取，极端情况下中文路径可能不被识别，建议项目路径保持 ASCII。

## 已知限制

- 音频以 `LONGBLOB` 存表：单曲 10 MB 级没问题；整库很大时 InnoDB 表空间与备份文件同步膨胀，列表接口已刻意不查 `audio` 列。
- 上传使用 `multer.memoryStorage()`（整个文件进内存），默认上限 128 MB；大文件并发上传会占内存，可按需调 `SONORA_MAX_AUDIO_BYTES`。
- `GET /audio` 支持单段 Range（浏览器 `<audio>` 拖动进度所需），不支持 multipart Range。
- 没有用户认证/多用户隔离，只适合本机单用户；仅监听 127.0.0.1。
- 去重键 = 文件名 + 大小 + 修改时间；改名后重新导入会被视为新歌（与 IndexedDB 版行为一致）。
- 上传的 multipart 文件名按 UTF-8 解码（busboy `defParamCharset: 'utf8'`），中文/emoji 文件名可正常入库；只支持 UTF-8 文件名，不支持 GBK 文件名。
- 无全文搜索接口，列表全量返回元数据（前端现有 `filterTracks` 在内存过滤）。
- 便携 MariaDB 不会被注册为系统服务：重启电脑后需要 `npm run db:start`（或重新 `npm run db:setup`）。
- `npm install` 后 Node 版本需 ≥ 20（项目使用 Node 24；`File`/`FormData`/`fetch` 为内置）。

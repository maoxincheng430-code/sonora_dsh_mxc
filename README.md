# SONORA · 声境

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.19-339933?logo=node.js)](https://nodejs.org/)
[![Tests](https://github.com/maoxincheng430-code/sonora_dsh_mxc/actions/workflows/test.yml/badge.svg)](https://github.com/maoxincheng430-code/sonora_dsh_mxc/actions/workflows/test.yml)

本地音乐驱动的 3D 粒子网站，使用 JavaScript、Three.js、Web Audio API 和 Vite。
自带可选后端：便携 MariaDB（MySQL 兼容）+ Express API，歌曲可存入真正的 MySQL 数据库。

> **许可证与免责**：代码以 [MIT](./LICENSE) 发布，可自由使用、修改、分发。但**本项目不包含任何音频文件** —— 通过在线平台获取的歌曲、歌词、封面版权归对应权利人所有，请自行遵守各平台用户协议。详见 [NOTICE.md](./NOTICE.md)。

## 快速开始（30 秒）

```sh
npm install
npm run dev
```

打开终端显示的地址（默认 <http://127.0.0.1:5173/>）即可使用：点击选择音乐或拖入 MP3、WAV、OGG、FLAC、M4A、MP4（只取音轨）等文件，再点击播放。

> **零配置**：不需要数据库、不需要账号、不需要联网。
>
> **曲库是空的，属于你自己**：仓库里不包含任何歌曲、歌词或用户数据。你导入的音乐只保存在**你自己这台机器的浏览器 IndexedDB** 里（或用 MySQL 时存在本机数据库），不会上传、不会同步到别人那儿。换浏览器或清缓存会丢，需要跨设备就接 MySQL。

Windows 用户也可以双击 `点这里启动喵/启动网站.cmd`：会自动安装依赖（首次）、按需启动本地数据库与 API、再启动网站并打开浏览器；如果网站已经在运行，则直接打开浏览器，不会报端口占用。保留终端窗口即可持续使用（关掉窗口服务就停了）。

### 可选：接入 MySQL 曲库

默认**不启用**，也不会有任何请求发往本地 API——开箱即用的就是纯前端 IndexedDB 模式。
想让曲库跨浏览器 / 跨设备共享时再启用（启动 `npm run server` 后打开 `http://127.0.0.1:5173/?server=1`，或在控制台执行 `localStorage.setItem('sonora-storage','server')` 后刷新）：

**方式 A：便携版（Windows，无需自己装数据库）**

```sh
npm run db:setup   # 首次：下载便携 MariaDB、初始化数据目录、建库建表（约 90MB，需联网）
npm run db:start   # 启动数据库（127.0.0.1:3307）
npm run server     # 启动 API 服务（http://127.0.0.1:8787）
```

**方式 B：Docker（任意系统）**

```sh
docker compose up -d          # 起 MySQL（127.0.0.1:3307）
npm run server                # 启动 API
```

**方式 C：已有 MySQL / MariaDB**

```sh
# 先建库建表（任选其一）
mysql -u root -p < server/schema.sql
# 再启动 API，用环境变量指向你的数据库
set SONORA_DB_HOST=127.0.0.1
set SONORA_DB_PORT=3306
set SONORA_DB_USER=root
set SONORA_DB_PASSWORD=你的密码
set SONORA_DB_NAME=sonora
npm run server
```

停止数据库：`npm run db:stop`（便携版）或 `docker compose down`（Docker）。

前端会自动探测 `127.0.0.1:8787`：连上且数据库可用时页面提示“已连接服务器数据库 · 歌曲存入 MySQL”，连不上则自动回退 IndexedDB，**不会报错、不影响使用**。
连接参数、API 列表与排错见 [MYSQL.md](MYSQL.md)。数据库文件位于 `.mysql/`（已 gitignore，不随源码分发）。

### 歌词自动识别（自动补歌词）

```sh
npm run lyrics:auto                        # 处理 MySQL 曲库里还没有歌词的歌
npm run lyrics:auto -- --dir "/path/to/Music"    # 递归扫描一个音乐文件夹
npm run lyrics:auto -- --dir "/path/to/Music" --dry-run   # 只预览，不写文件
npm run lyrics:auto -- --dir "/path/to/Music" --force     # 已有歌词也重新抓
```

- 按「歌名 / 歌手 / 时长」自动搜索歌词（酷狗主源 → 网易云 → QQ 音乐免登录接口），匹配后写入 `public/lyrics/<歌名> - <歌手>.lrc` 并登记到 `public/lyrics/index.json`
- 后端运行时（`npm run server`），播放或导入没有歌词的歌会**自动在线搜索并缓存**（数据库 `track_lyrics` 表 + 浏览器 localStorage），第二次播放无需联网
- 文件自带的歌词优先：MP4 的 ©lyr、MP3 的 ID3 USLT 会被直接读取；MP4/MP3 内嵌的标题、歌手也优先于文件名
- 多源结果按「歌词正文长度」择优，避免"纯音乐 / 暂无歌词"占位词盖过完整歌词
- 抓取工具代码在 `tools/netease/`，歌词解析逻辑在 `server/lyrics.js`、`server/qqmusic.js`

### 在线音乐（QQ 音乐 / 网易云音乐 / 酷狗音乐）

> **需要额外一步**：在线音乐依赖 `tools/` 下的两个独立小服务，主项目的 `npm install` **不会**带上它们。
> 不装的话，点开「在线音乐」只会看到 `Failed to fetch`。
>
> **Windows 用户**：双击 `点这里启动喵/安装在线音乐依赖.cmd` 一次即可。
>
> **命令行用户**：
> ```sh
> npm run qq:setup        # 安装 QQ 音乐服务依赖（tools/qq-api）
> npm run netease:setup   # 安装网易云服务依赖（tools/netease）
> npm run server          # 启动主 API 时自动拉起这两个服务，无需单独开
> ```
>
> 纯前端功能（粒子、歌词、番茄钟、桌宠、氛围场景、本地曲库）**不需要**这步。

装好之后点顶部导航栏「在线音乐」打开面板，顶部切换三个音源：

- **QQ 音乐**：沿用 Folia 同款方案（[Folia](https://github.com/chthollyphile/folia-major)），用 [`@yakult-green-tea/qq-music-api`](https://www.npmjs.com/package/@yakult-green-tea/qq-music-api)（MIT）处理设备身份与扫码登录，服务在 `tools/qq-api/`（端口 3200）。
- **网易云音乐**：复用 [NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi)（MIT，装在 `tools/netease/`，端口 3202），支持扫码登录与**手机号验证码登录**；不登录也能搜索、试听一部分歌。
- **酷狗音乐**：免登录，直接调用酷狗移动端公开接口（搜索 / 播放 / 歌词），部分 VIP / 版权歌曲可能拿不到播放地址。

QQ 与网易云的登录态都会持久化（QQ 用加密文件，网易云存 cookie 文件，均在各自 `.auth-state/` 下、已 gitignore），重启服务不用重新登录。播放链接统一由服务端代理成本地流（`/api/<provider>/stream`），支持 Range 拖动；歌词优先取平台官方歌词，没有时回落到本地多源歌词库。

**登录用的是你自己的账号**：仓库里不含任何人的登录凭据，需要各自扫码。登录态只存在本机，不会上传。

相关接口（都只监听 127.0.0.1）：

```text
GET  /api/qq/status                       QQ 服务可用性 + 登录状态
GET  /api/qq/qr/key|create|check          扫码登录（channel 固定 qqmusic）
POST /api/qq/logout                       退出登录
GET  /api/qq/search?keyword=              搜索歌曲
GET  /api/qq/lyric?mid=                   取歌词
GET  /api/qq/play?mid=                    取播放地址
GET  /api/qq/stream?mid=                  音频流代理（支持 Range）

GET  /api/netease/status                  网易云登录状态
GET  /api/netease/qr/key|create|check     网易云扫码登录
POST /api/netease/captcha/sent          发送短信验证码
POST /api/netease/login/captcha         手机号 + 验证码登录
POST /api/netease/logout                  退出登录
GET  /api/netease/search?keyword=         搜索歌曲
GET  /api/netease/lyric?id=               取歌词
GET  /api/netease/play?id=                取播放地址
GET  /api/netease/stream?id=              音频流代理

GET  /api/kugou/search?keyword=           搜索歌曲（免登录）
GET  /api/kugou/lyric?hash=&name=&artist= 取歌词
GET  /api/kugou/play?hash=                取播放地址
GET  /api/kugou/stream?hash=              音频流代理
```

限制：三个平台的 VIP / 付费 / 版权受限歌曲都可能拿不到播放地址（面板会显示具体原因，并提供「用本地文件渲染同一首歌」兜底）；这类歌可用本地文件导入播放。
- 网易云扫码若显示「登录未同步」，面板里提供**手动粘贴 Cookie**兜底：先登录 `music.163.com`，F12 → Application → Cookies → `music.163.com`，复制 `MUSIC_U` 和 `__csrf` 两段（`MUSIC_U=...; __csrf=...`）粘进面板保存即可；也可以直接用面板里的 **手机号验证码登录**。

### 在线音乐播放排查

- **本页只能渲染"本页面自己加载的音频"**：在 QQ 音乐 / 网易云客户端里播放的歌，浏览器无法读取其他应用的声音，所以不会在本站出现粒子或歌词。正确用法是在面板里搜索、点歌（或导入本地文件）。
- 点歌后若自动播放被浏览器拦截，页面会明确提示「请点播放器的播放按钮」。
- 面板里播放失败会显示红色原因条（VIP/版权、登录态过期、无播放地址），旁边有「用本地文件渲染同一首歌」兜底按钮。
- 若音频在播但**没有粒子画面**：多半是粒子特效被关过或 WebGL 上下文丢失；在线播放时会自动重新开启粒子并给出提示。
- 服务端音频流会带对应的 Referer / UA 直连 CDN，减少因来源校验导致的 403。

- **本页只能渲染"本页面自己加载的音频"**：在 QQ 音乐 App / 网页里播放的歌，浏览器无法读取其他应用的声音，所以不会在本站出现粒子或歌词。正确用法是登录后在本站面板里搜索、点歌。
- 点歌后若自动播放被浏览器拦截，页面会明确提示「请点播放器的播放按钮」。
- 面板里播放失败会显示红色原因条（VIP/版权、登录态过期、无播放地址），旁边有「用本地文件渲染同一首歌」兜底按钮。
- 若音频在播但**没有粒子画面**：多半是粒子特效被关过或 WebGL 上下文丢失；QQ 播放时会自动重新开启粒子并给出提示。
- 服务端音频流已带 `Referer/Origin` 请求头直连 QQ CDN，减少因来源校验导致的 403。

```sh
npm test
npm run build
npm run preview
```

浏览器自动化测试：先运行 `npx playwright install chromium`，再运行 `npm run test:e2e`。测试默认生成节拍音频；设置 `TEST_AUDIO` 环境变量可以使用自己的音乐文件。

`dist/` 为构建后的静态网站，可部署到静态托管服务。开发服务器与预览服务器按 Ctrl+C 停止。不建议双击 index.html，模块需要通过本地服务器加载。首次安装依赖需要联网，运行时不调用远程音频或上传服务。

## 使用

### 曲库目录

- 播放器左侧的「曲库」按钮打开「我的曲库」目录，曲目、歌手、时长、文件大小、播放次数和添加时间一览无余。
- 目录内可 **批量导入**（一次选择多首）、**搜索**歌名或歌手、按最近添加 / 标题 / 时长 / 播放次数 **排序**，也可以给歌曲 **重命名**（只改显示名，不动原文件）或删除。
- 点击目录中的歌曲即可载入，再点播放器播放；当前歌曲会高亮。播放次数和最近播放时间会自动累计。
- **底部播放器重做（悬浮胶囊）**：左侧封面 + 歌名/歌手 + `LOCAL / MP3 / 无损` 徽标；中间是收藏、添加、随机、循环、上一首、播放、下一首、队列、歌词、音量、音频视觉设置、全屏；右侧 `0:00 / 0:00` 时间；顶部一条细进度线。收藏会存进 `localStorage`（`sonora-favorites`），循环支持列表 / 单曲 / 关闭，播完自动续播下一首；移动端固定在屏幕底部，避免被内容顶出视口。
- 存储后端二选一：**MySQL 后端可用时写入数据库**（音频存 `tracks.audio` LONGBLOB，元数据同表，支持 Range 流式播放）；否则退回浏览器的 IndexedDB（库名 `sonora-library`，版本 2，元数据与音频分开存储）。旧版浏览器数据库会自动升级，已保存的歌曲不会丢失。
- 歌名与歌手默认从文件名解析：`歌手 - 歌名.mp3` 会拆成歌手和歌名，开头的 `01.` 序号会被去掉；解析不准时用「重命名」修正。
- 刷新后曲库仍保留，但不会自动播放。相同文件名、大小及修改时间的歌曲不会重复保存。存储失败会提示"本次未保存"，仍可临时播放。
- 使用 IndexedDB 时曲库仅属于当前浏览器和网站地址（含端口）；改用 MySQL 后由数据库统一保存。清除网站数据或浏览器回收存储可能删除本地歌曲，请始终保留原始文件。
- 开发服务器固定为 `http://127.0.0.1:5173/`，端口占用时会报错，不会自动切换地址。已有网站运行时请直接打开该地址；需要重启时先在原终端按 Ctrl+C。

### 多层波形粒子引擎

- 默认形态为**多层流动光带**：低频粗波（下方厚实的主光带）、中高频细波纹（骑在其上的高频细波）、上升光尘与背景星云散点。三层独立响应音频不同频段，形成通透的"星尘河流"而不是单薄的虚线。
- **通透质感**：细密小光点 + 锐利芯 + 层相关柔光晕；主光带沿 x 由主题紫渐变到青，统一配色而不是随机杂色。
- **粒子差异化**：主线粒子更大更亮，背景粒子更小更暗；音量高时拉开景深差距，安静段落趋于柔和。
- **流动拖尾**：粒子沿光带方向持续流动（出界回绕），并有一段缓慢行进的明暗波包，不是原地上下抖动。
- **形态随段落变化**：副歌阶段光带扭转卷曲（curl 随能量增大），舒缓段落变回平缓长波。
- **留白控制**：安静时大面积深色背景只留一条柔光带，高潮时背景星云逐渐填充——有收有放，避免全程同等视觉强度。
- **频段敏感度分离**：右侧面板低频 / 人声 / 高频三个独立滑块（0.3–2.5×），鼓点和人声的波形变化各有区分度。
- **可收起的设置侧边栏**：右侧「雕刻你的声境」默认收起（不占画面），点右上角滑杆图标滑出，再点面板 × 或按 Esc 收回；展开状态记在 `localStorage`（`sonora-effects-open`）。桌面端从右侧滑入，手机端为全宽抽屉。
- **柔和色彩联动**：色相随频段缓慢微调（±7° 级别）——低频偏紫，人声偏青，节奏慢不刺眼。
- **交互平滑**：拖动进度条时光带相位平滑回退（不瞬间跳变）；暂停时波浪慢慢摊平、粒子缓缓停下。
- **歌词区可读性**：有歌词时光带在文字带内自动降低亮度，防止粒子糊掉文字。
- **粒子特效总开关**：右侧「效果」栏里可以一键**开启 / 关闭粒子特效**。关闭后隐藏整个 3D 粒子层（含星云薄雾、太空装饰），动画循环跳过粒子与装饰更新以省电；歌词、背景画面、播放器照常工作。开关状态记在 `localStorage`（`sonora-particles`），刷新后保持。
- **粒子画面位置**：效果栏用 **↑ / ↓ / ← / →** 方向键微调粒子画面位置，**◎** 一键复位（移动相机而非改粒子数据），旁边显示当前偏移；偏移以 JSON 存 localStorage（sonora-scene-offset），刷新保留。
- 其他形态（星球 / 星云 / 星环）保留，同样受益于粒子差异化、色彩联动和留白控制。
- 鼠标拖拽可旋转非波形形态的粒子（带惯性），屏幕随低音震动。

### 图片 / 视频粒子形态（上传图片或视频 → 点云）

- 「粒子形态」新增第五种 **图片**：选一张本地图片（PNG / JPG / WebP），先把图片缩到 200px 内采样像素，再为每个像素生成一个粒子——颜色还原原图色相，亮度转成轻微 z 轴浮雕。
- 用 **Sobel 边缘检测**给轮廓加权：边缘附近的粒子更大更亮；透明像素与过暗像素会被过滤；点数上限约 2.6 万，超出时按确定性 hash 抽稀（边缘像素优先保留）。
- 切换时粒子从随机球壳飞入，约 1.8 秒组装成图片；之后随低音/高频/节拍做呼吸、缩放和闪动，并跟随主题色叠一层很淡的辉光。
- 上传的图片会压成 640px JPEG 存进 `localStorage`（`sonora-shape-image`），刷新后自动恢复；当前形态记在 `sonora-shape`。选「图片」时自动切换，点「清除」回到声浪。
- **视频粒子（新增）**：上传 MP4 / WebM / MOV 后循环播放，按最长边 150px 的固定网格逐帧采样；每帧只平滑更新颜色/大小/高度，不重建 geometry，所以播放稳定不闪。视频体积大，不写入 localStorage，刷新后需要重新上传。参考：[particular-drift](https://github.com/collidingScopes/particular-drift)、[ParticleViz](https://github.com/Rezar/ParticleViz)、[three.ws video capture](https://github.com/nirholas/three.ws/blob/main/docs/capture.md)。

### 音域回响（3D 网格地形）
- 「粒子形态」新增第六种 **音域回响**：一张倾斜的 3D 网格地形，中心是下凹的回声坑、外圈隆起；低频叠成同心声波，中频抬起丘陵，高频加细纹，鼓点给整块地形一次脉冲。
- 实现：顶点位移 GLSL + 半透明面 + 网格线 + 背光；颜色跟随主题 / 自定义色，播放时低频驱动起伏，暂停时缓慢呼吸。整块地形还会缓慢自转，并支持拖拽旋转。
- 参考开源项目：[JIZURA](https://github.com/852wa/JIZURA)（文字 PV 运镜）、[3D-Spectrogram](https://github.com/conwayjw97/3D-Spectrogram)（Three.js + GLSL 音频频谱）、[voxel-beat-planet](https://github.com/EverettFish/voxel-beat-planet)（voxel 音频星球）、[Sonic-Topography-Wallpaper](https://github.com/hgbhh258-spec/Sonic-Topography-Wallpaper)（音乐驱动的地形波）。
- **自动扣背景（已升级）**：从图片四边**泛洪**标记背景，能扣掉渐变 / 暗色 / 轻微噪点的背景（旧的全局中位色只能处理纯色背景）；透明 PNG 直接按 alpha 遮罩，半透明边缘不会残留。
- **扣背景容差**：图片形态下方新增滑杆，背景扣不干净时调大、扣过头（人物细节被删）时调小。
- **只取轮廓**：打开后只用边缘像素生成粒子，人物内部与背景颜色接近时最干净（类似线稿/点阵头像效果）。
- **白底默认不抠**：检测到浅色/白色背景时默认保留原背景，避免白毛/白衣服角色被一起扣掉；白底 logo 想抠图时打开「白底也抠」开关即可。
- **三个调参滑杆**：粒子密度（0.2–1.5×）、轮廓强度（0–2×）、颜色饱和（0.4–2×），拖动时 90ms 防抖重新采样，效果与参数都记在 `localStorage`（`sonora-shape-options`）。
- 实现：`src/image-particles.js`（采样纯函数 + 点云着色器层）、`src/particles.js` 的 `setShapeImage / clearShapeImage`、`src/ui.js` 的图片按钮与上传栏。

### 歌词系统

- **打开即有歌词**：内置 27 行原创示例歌词（2 分 23 秒，舒缓曲风），首屏就能看到动态高亮演出的效果；换成没有歌词的歌曲时也会回退到示例，不会“空白”。
- 顶部导航栏「歌词」打开**歌词面板**：粘贴 LRC 歌词、导入 `.lrc` / `.txt` 文件、一键载入示例、应用或清空；纯文本会自动按 4 秒/行补齐时间轴。
- 支持 LRC 格式解析（`[mm:ss.xx]` 和 `[mm:ss]` 两种时间标签、一行多标签展开、元数据标签）。
- 导入歌曲时若同批包含同名 `.lrc` / `.txt` 歌词文件，自动配对缓存；选中歌曲时自动加载。
- **本地歌词库自动匹配**：把 `歌名 - 歌手.lrc` 放进 `public/lyrics/`，并在 `public/lyrics/index.json` 登记（title / artist / aliases / duration），播放对应歌曲时会按歌名、别名、歌手、**时长**自动匹配加载，无需手动导入。同名不同长度的版本（例如同一首歌有 132s 与 210s 两个剪辑）会按音频时长选对应时间轴的那份，避免整首错位。仓库不内置任何版权歌词，需要自己准备。
- **歌词自动识别**：没歌词的歌不用手动准备——有后端时播放/导入会自动在线搜索并缓存；也可以 `npm run lyrics:auto` 批量把整个曲库/文件夹的歌词补齐（详见上文「歌词自动识别」）。
- 动态逐行高亮：Folia 风格大字居中、上下留白渐隐、逐行推进，入场淡入上移 + 模糊转清晰，退场淡出。
- **3D 倾斜歌词（独立于粒子特效）**：歌词面板里可切到「3D 倾斜」模式——整层交给 CSS 3D，歌词像一面倾斜的歌词墙，当前行向前弹出、前后行按距离后退并轻微旋转、越远越暗越模糊；长句自动换行，不再截断。它是歌词层自己的显示模式，和粒子形态、律动强度、频段敏感度、氛围色彩等粒子设置完全互不影响。
- **歌词显示选项**：歌词面板新增「歌词显示」设置——模式（经典 / 3D 倾斜）+ 位置（居左 / 居中 / 居右），点击立即生效，选择会记在 `localStorage`（`sonora-lyrics-display`），刷新后自动恢复。
- **歌词字号三档**：面板「字号」行可切 **小肥鱼 / 肥鱼 / 大肥鱼**（0.82× / 1× / 1.22×），经典与 3D 倾斜模式统一缩放，3D 下同时调整行高避免大字挤在一起；选择存在 `sonora-lyrics-display.size`，刷新后恢复。
- **右上角实时预览**：「歌词显示」卡片右上角有一小块歌词小样（两行示例 + 当前色值），用当前颜色渐变渲染、随「3D 倾斜」模式一起倾斜，选色/切模式/恢复跟随曲风都会即时更新，方便调色时不用盯主画面。
- **歌词颜色调色盘（多色保存）**：面板「颜色」行是一块彩虹调色盘（点阵覆盖 + 白色圆环标记，点击 / 拖动取色），旁边显示当前颜色与 hex；选中的颜色会覆盖当前曲风的文字渐变、光带与光晕（暗色会自动提亮，保证深色背景上可读）。选过的颜色去重后自动保存最多 8 个色块（最新在前，点击快速切换，× 删除），「跟随曲风」可恢复默认渐变。当前颜色与已保存色板存在 `localStorage`（`sonora-lyrics-color`），刷新后恢复。
- **双语歌词**：3D 倾斜模式下，同一时间戳相邻的两行会自动合并为「主歌词 + 小字译文」，直接兼容常见的中英对照 LRC 写法（例如英文原文与中文翻译各占一行、时间标签相同）。
- **曲风自动分类**：根据歌词关键词分为舒缓（calm）/ 激昂（epic）/ 忧伤（sad），每套对应不同字体、字距、文字渐变、背景叠加和动效（柔光呼吸 / 缩放光影 / 流转动态模糊）。
- **歌词与粒子绑定**：当前演唱分句的粒子在波形峰值附近聚拢成光团，退场时消散融入粒子流——歌词和特效是一体的。
- **逐字歌词（karaoke）**：当前句按字/词逐个点亮（中文字字分开、英文按词），已唱部分走上色渐变、未唱部分保持亮一点的灰白；修复了父级渐变与逐字渐变叠成「双影」的问题，播放时还会给歌词区垫暗底、压暗左侧介绍，避免叠字看不清。优先解析增强 LRC 的行内逐字标签（`<mm:ss.xx>`），没有逐字数据时按整句时长与字数自动分配时间，所以普通 LRC 也能看到逐字推进。
- **共 20 种歌词样式**（参考 [AMLL](https://github.com/amll-dev/applemusic-like-lyrics) 的景深/逐字、[Lyricify](https://github.com/WXRIW/Lyricify-App) 的词岛/高亮，以及 [JIZURA](https://github.com/852wa/JIZURA) 的文字 PV 运镜思路）：
  - **苹果景深**：当前句最大最清晰，前后句失焦后退，逐字扫亮；
  - **打字机**：等宽字体逐字浮现，句尾光标闪烁；
  - **霓虹**：逐字点亮 + 光晕，当前句呼吸；
  - **电影字幕**：沉到底部的小号字幕，安静克制，适合投屏；
  - **弹跳**：每个字依次弹出，活泼有节奏；
  - **描边**：空心描边字，唱到的字逐个填色；
  - **词岛**：当前句装进毛玻璃胶囊（Lyricify 灵动词岛风）；
  - **单行聚焦**：只显示当前一句，超大字号极简；
  - **对唱**：歌词左右交替排布，像两个人的对唱。
  - **漂浮**：整块歌词在画面里缓慢漂浮、轻微旋转，每一行还有错落起伏。
  - **摆荡**：3D 透视下整块歌词左右摆荡，像镜头跟着节奏摇。
  - **竖排**：中文 / 日文竖排，一列列从右向左推进（适合古风 / City Pop）。
  - **弹跳字**：当前句每个字依次弹入、旋转、回弹，整块轻微摇摆。
  - **故障**：RGB 分离、随机抖动和扫描线（电子 / 摇滚 / 赛博氛围）。
  - **散点**：每个字从不同方向飞入聚拢，当前句像在画面里炸开再归位。
  - **律动**：实时音频低频驱动整块歌词缩放 / 轻转，鼓点越强摆动越大（由主循环把 bass/beat/treble 写进 CSS 变量）。
  - **聊天**：像微信一样，一句一句左右交替弹出气泡，带头像/气泡小尾巴，当前句轻轻弹一下；歌词面板里可直接编辑 **TA / 我** 的名字与头像（上传图片自动裁成 64×64，存 localStorage 的 sonora-chat-profile）；「聊天设置」默认收起，点开可改双方头像/名字，并可选 **随机（默认，连续 1–3 句后换人）/ 均衡 / TA 更多 / 我更多**；参考 [ai-chat-ui](https://github.com/thakurcoderz/ai-chat-ui) 与 [message-bubble](https://github.com/starc007/beui-native/tree/main/src/components/message-bubble) 的聊天气泡思路。
  所有样式统一走 `src/lyrics-styles.js` 注册表，面板里点一下立即切换。
- **歌词样式注册表**：内置 19 种样式登记在 `src/lyrics-styles.js`，面板的模式按钮直接读注册表；外部只要 `registerLyricStyle({ id, label, wordTiming })` 就能加新样式，不用改面板或渲染分支。

### 氛围背景与自定义背景

- 右侧「效果」栏可切换六种氛围场景：**无 / 雨天 / 雷声 / 海滩 / 图书馆 / 自定义图片·视频**（顶部导航栏「氛围」也保留快捷入口）。
- 雨/雷/海滩/图书馆的环境声优先使用 **真实录音**（`public/audio/*.mp3`）：从素材视频中提取、剪成可循环片段（首尾等功率交叉淡化）、响度归一化后由 WebAudio 循环播放；录音缺失或解码失败时自动退回原来的程序合成音（白噪+高通 / 布朗噪声 / 低频脉冲+延迟），因此离线也不会没声音。
- 雷声场景额外准备了三段真实炸雷（`thunder-1/2/3.mp3`），每次闪电随机挑一段、随机音高与延迟播放；录音还没就绪时才用合成雷。
- 视觉层独立于 Three.js 场景：雨丝 canvas 粒子、雷击周期性闪光、海滩暮色渐变+推移浪线、图书馆暖色纸感底色、图片 Ken Burns 缓慢缩放漂移。
- **自定义背景**：点「上传图片 / 视频」选择本机文件即可作为全屏背景——图片带缓慢 Ken Burns 漂移；视频静音循环播放、`object-fit: cover` 铺满且不加位移缩放（避免露边）。背景上会压一层极淡的暗色渐变，保证标题与歌词可读。
- 自定义背景文件保存在浏览器 **IndexedDB**（数据库 `sonora-background`，只保留最近一张），刷新后自动恢复；点「清除」移除。文件只在本地读取，不上传服务器。
- 音量可调（初始 0.6），`setVolume(0)` 静音；dispose 时全部断开关闭。

### 桌宠（专注模式吉祥物）

- 专注页计时卡片里新增「桌宠」入口，点开面板可选：**大肥鱼**（原有 DeepSeek 吉祥物）、**小猫**、**小机器人**、**小幽灵**、**小星星**、**Q版小鲸鱼 / Q版小机器人 / Q版小月亮 / Q版小云朵**、以及「不显示」；也可以**上传自己的图片 / GIF 当桌宠**。
- 内置的小猫 / 机器人 / 幽灵是项目内自绘 SVG（`public/mascot/*.svg`，无第三方版权问题），大肥鱼沿用原有 PNG；桌宠会沿着进度环奔跑，开始/休息/完成阶段有对应的小动作。
- **多状态**：猫 / 机器人 / 幽灵 / 星星带 `running` 与 `celebrate` 两套图——开始计时自动切「奔跑图」，阶段完成切「庆祝图」，暂停 / 休息回待机图（借鉴 Anthropic 官方 claude-desktop-buddy 的角色包状态设计）。
- **角色包系统**：把图片放进 `public/mascot/`，在 `public/mascot/packs.json` 里登记 `{ id, name, states: { idle, running, celebrate } }`，刷新页面就会出现在桌宠面板里，**不用改代码、数量不限**（详见 `public/mascot/README.md`）。
- 选择记在 `localStorage`（`sonora-mascot`）；自定义图片会转成 dataURL 一并保存，建议小于 800KB（太大时会提示只在本次会话生效）。
- 想加自己的角色：把图片放进 `public/mascot/`，在 `src/mascot-options.js` 的 `MASCOT_OPTIONS` 里加一行即可。
- **Q版 AI 娘**（4 个）：Q版肥鱼·才不肥 / 好困 / 星星眼、Q版白龙娘，来自 [蓝色大肥鱼](https://xn--pssy23gqgbz2d718b.com/) 的 AI 娘二创档案；背景已处理成透明或圆形贴纸。**这些是同人二创素材，版权归原作者，仅作功能演示，可自行替换。**
- **AI 娘扩展包**（9 个）：GPT / Claude / DeepSeek / Gemini / 豆包 / GLM / Kimi / Qwen / Grok，放在 `public/mascot/ai/`，通过 `packs.json` 加载。素材来自 [ShokouP/dsh-tea-party-mode](https://github.com/ShokouP/dsh-tea-party-mode) 的社区头像，**版权归原作者，仅作功能演示**，来源与授权说明见 `public/mascot/ai/NOTICE.md`。不希望包含这些素材的话，直接删除 `public/mascot/ai/` 和 `public/mascot/ai-q/` 两个目录即可，其余功能不受影响。
- 说明：GitHub 上的动漫桌宠大多使用同人图或 Live2D 官方示例模型，**授权不适合直接打包进项目**；所以这里只内置自绘角色 + 支持用户上传。若以后要做 Live2D / VRM 动态角色，可以接 `pixi-live2d-display`（MIT）或 `three-vrm`（MIT），模型授权需自行确认。

### 背景与氛围选择器

- 点顶部导航栏「**氛围**」打开「背景与氛围」面板（不再用浏览器 prompt），一屏可以选：
  - **氛围场景**：默认（粒子宇宙）/ 雨 / 雷雨 / 海滩 / 图书馆；
  - **背景图库**：6 张内置抽象渐变背景（极光 / 星云 / 暮光 / 深海 / 森林 / 墨色），脚本生成、无版权问题，单张 17~40KB，放在 `public/backgrounds/`；
  - **我的背景**：本地上传图片或视频（`jpg/png/webp/mp4/webm` 等），缩略图预览、随时使用 / 删除。
- 自定义背景存在浏览器 IndexedDB（`sonora-background`，只保留一张），内置背景记住 id（`sonora-background-preset`），刷新后自动恢复；「默认」= 不带背景图，只留粒子。
- 背景图按 `object-fit: cover` 铺满 + 缓慢 Ken Burns 漂移；视频静音循环、不加位移缩放避免露边。背景层独立于 Three.js 粒子层，切换不影响音乐与计时。
- 想换成自己的图库：把图片放进 `public/backgrounds/`，在 `src/background-presets.js` 的 `PRESET_BACKGROUNDS` 里加一行即可。

### 番茄钟 · 专注模式

- 点击顶部导航栏「番茄钟」进入**专注模式页面**（`#focus`）：大号环形计时器 + 粒子光带 + 歌词同屏，主界面的介绍/面板自动淡出，音乐与视觉继续运行。
- 计时卡片内有三个可选交互入口，点开是从底部滑出的选择面板：
  - **专注模式**：番茄钟（25 分钟专注 / 5 分钟休息，每 4 个番茄自动长休息 15 分钟，可开「阶段结束自动开始下一段」）、倒计时（5~120 分钟，到点停在 00:00）、正计时（秒表）；
  - **专注场景**：无背景 / 雨 / 雷雨 / 海滩 / 图书馆 / 自定义（会直接切换真实录音与背景海报图，计时不中断）；
  - **本次标签**：专注 / 工作 / 学习 / 阅读 / 冥想 / 运动（带颜色，记在本地）。
- 三个阶段都带环形进度与 mm:ss；阶段完成播放柔和提示音（WebAudio 合成）；按 Esc 或「← 返回」退出，浏览器前进/后退同样生效。
- **鼓励语（新增）**：专注过程中每 3 分钟弹一句鼓励（“这一小段专注，已经真正属于你”这类文案轮换，不重复）；完成一个番茄时给一句完成鼓励，吉祥物同步亮一下。文案池在 `src/encouragement.js`，可自行增删。
- **连续打卡 + 今日目标（新增）**：专注页显示「连续打卡 N 天 · 今日目标 X%」并带进度条（默认每天 60 分钟），历史按天存在 `localStorage`（`sonora-focus-history`），跨天自动续算/中断。
- **长休息（新增）**：每完成 4 个番茄自动进入 15 分钟长休息（标签显示「长休息」），避免连续高强度专注。
- **吉祥物陪跑**：进度点上坐着一只「大肥鱼」（`public/mascot/dafeiyu-cut.png`，已抠掉原图底色），计时运行时它会沿着圆环小跑（上下轻跳、按行进方向左右翻转），休息阶段改为慢呼吸，阶段完成原地蹦三下庆祝；追求省电/晕动症友好的系统会跟随 `prefers-reduced-motion` 自动静止。
- **今日总学习时长**：专注页侧栏实时显示「今日总学习时长 X 分钟 / X 小时 Y 分钟」，按真实流逝时间累计（番茄钟专注段、倒计时、正计时都算，休息不算），每 4 秒落盘到 `localStorage`（`sonora-focus-stats`），跨天自动归零；同时保留「今日专注 N 个番茄」。统计逻辑在 `src/study-stats.js`。
- 选择记录存在 `sonora-focus-choices`。

### 顶部导航栏

- 毛玻璃 pill 横排样式（也可切 icon 居中式），固定顶部 z-index 60。
- 入口：曲库 / 氛围 / 歌词 / 在线音乐 / 番茄钟，点击即触发对应功能。
- 「氛围」是右侧「效果」栏的快捷入口：内置场景直接切换，选 `image` 会打开本机图片/视频选择框。

### 视听动感

- 自由组合粒子球、星云漩涡、爆炸光环、粒子波浪与三种颜色主题。
- **圆形调色盘自定义氛围色彩**：右侧「氛围色彩」在三个预设圆外多了一个圆形色轮按钮，点击展开圆形调色盘（色相环绕一圈、圆心最亮、越靠边缘越深），点击或拖动即选色，白色圆环标记当前位置，浮层顶部实时显示色值与圆点预览。自定义色会一次性驱动整套配色——粒子、太空装饰、星云薄雾、光标拖尾以及页面强调色，和预设主题走同一条链路；选中后主题名显示「自定义」。选择记在 `localStorage`（`sonora-custom-theme`），刷新后自动恢复；点任意预设主题即退出自定义。浮层里的「×」或 `Esc` 可收起。
- 低音重拍会触发粒子径向爆散并带切向螺旋甩动、镜头轻推与微漂移、核心光晕闪烁和整体颜色脉冲；低频还会驱动整个形态的噪声扭曲摆动，中频按上下分层反向卷动形成涡流，高频驱动粒子闪烁——不再只是"上下嘭"。安静时画面偏冷，能量升高时整体色温向高光色偏移。
- 背景有独立的太空装饰层：远景星野缓慢呼吸闪烁，近景星尘光斑漂移，少量亮星带十字光芒；流星平均每 5–9 秒一颗，约三成概率升级为 3–6 颗错峰划过的流星雨，每颗都有柔光亮头，另有两层极淡的星云薄雾跟随主题变色。星野与光斑数量跟随渲染精度档位。
- 鼠标移动会拖出星尘轨迹，点击炸开一小簇彩色粒子余烬；颜色跟随氛围主题，系统开启"减少动态效果"时自动关闭。触屏同样生效，且完全不拦截页面交互。
- **鼠标光影跟随即开即关**：右侧「效果」栏有独立开关，关闭后立即清空画布并停掉逐帧绘制，鼠标事件也不再产生轨迹，纯省电、不影响其它效果。状态记在 `localStorage`（`sonora-cursor-trail`），刷新后保持；系统开启"减少动态效果"时该开关显示为关闭（模块降级为 no-op）。
- **鼠标光影 10 种样式**：效果栏「光影样式」可切 **彗星拖尾 / 流体烟墨 / 星尘 / 霓虹 / 双丝带 / 像素方块 / 字符流 / 涟漪波纹 / 丝绸弹簧 / 轨道粒子**，选择记在 localStorage（`sonora-cursor-trail-style`）。实现均为独立编写，样式灵感参考 [cursor-ripple](https://github.com/iamanduru/cursor-ripple)、[ascii-cursor-trail](https://github.com/f1shlalala/ascii-cursor-trail)、[SilkCursor](https://github.com/Mani821/SilkCusror)、[cursify fluid cursor](https://github.com/ui-layouts/cursify) 与 [WebGL-Fluid-Simulation](https://github.com/PavelDoGreat/WebGL-Fluid-Simulation)。
- **鼠标光影独立调色盘（方形）**：「鼠标光影」行左侧的方形色块按钮点击展开方形调色盘，可为光影单独选色，不影响粒子/歌词/氛围色。未自定义时按钮显示主题渐变、色值标为「跟随氛围」；选色后按同色系推导三段渐变，彗星/星尘等渐变样式仍有层次。颜色记在 `localStorage`（`sonora-cursor-trail-color`），刷新后恢复。
- 「律动强度」滑块调低后画面更克制，调高后鼓点爆发更明显；系统开启"减少动态效果"时会自动削弱镜头运动并停掉流星。
- 播放暂停、拖动进度、调整音量、灵敏度和粒子数量、进入全屏。
- **播放器下拉收起**：底部播放器上沿有个小把手，点一下整体下滑收起（只留把手），再点展开；收起状态记在 `localStorage`（`sonora-player-collapsed`），刷新后保持。适合纯看粒子画面的场景。
- 首次导入不自动播放。音乐只在浏览器内读取与分析，不发送到服务器。
- 分析发生在音量控制前，静音后动画仍能跟随音乐。
- 暂停后粒子逐渐回落到待机状态，但仍保留轻微旋转与呼吸。强烈段落通过音量、低频能量和瞬时起音近似响应，并非歌曲语义层面的高潮识别。
- 手机或较弱设备可选择较低粒子数量。若无画面，请使用新版 Chrome/Edge 并启用硬件加速。
### 节拍分析与卡点

- **离线节拍分析**：导入/切换歌曲后，在浏览器里对解码后的波形做一次轻量分析（分帧 RMS → 起音强度 → 60–200 BPM 自相关 + 120 BPM 先验防倍频 → 起音峰最小二乘拟合周期/相位 → 拍点吸附），得到 `{ bpm, beats, downbeats, confidence }`，一首 3 分钟的歌通常几十毫秒。
- **按曲目缓存**：结果写进 IndexedDB `sonora-beats`（键为曲库 id 或 文件名+大小+修改时间），同一次会话/下次打开直接读缓存，不重复分析；损坏或旧版本缓存会被校验丢弃。
- **卡点特效**：拍点/重拍包络与频段起音取较大值驱动粒子 punch——重拍有更强的一下，鼓点不再只靠瞬时音量碰运气。分析失败或无节奏（纯人声/环境声）时自动退回原来的频段响应。
- 模块：`src/beat-analysis.js`（纯算法，可单测）、`src/beat-cache.js`（IndexedDB/内存兜底）、`src/main.js` 负责调度。

### 桌面版（Electron）

桌面版是同一套页面的 Electron 外壳：窗口更干净、启动更快，导入本地音频时改用系统原生多选对话框，也可以作为后续壁纸模式 / 本地曲库的底座。

```sh
npm run build     # 先生成 dist/
npm run desktop   # 构建后用 Electron 打开
npm run desktop:dev   # 开发模式：先 npm run dev，再跑这个
npm run desktop:setup # 只补下 Electron 二进制（网络差时用，走 npmmirror 镜像）
```

Windows 也可以直接双击 **`点这里启动喵/启动桌面版.cmd`**：自动安装依赖 → 缺 Electron 二进制时走镜像下载 → 构建前端 → 启动桌面版。

- 顶部右侧的**喇叭按钮是静音开关**（所有页面里都有）：点一下把播放器 + 氛围音效一起静音，图标变红、提示「取消静音」；再点恢复。静音不会中断播放/分析，粒子与歌词照常走；状态记在 `localStorage`（`sonora-muted`），刷新后保持。
- 桌面版「选择本地音频」会改用**原生多选文件对话框**，选中的文件直接进入现有导入流程。
- 主进程还预留了 `preload` 桥（`window.sonoraDesktop`），后续可加壁纸模式、文件夹扫描、ffmpeg 转码等桌面专属能力。
- 如果 `npm install` 没下到 Electron 二进制（部分 npm 配置会跳过 install 脚本），运行 `npm run desktop:setup`，或设置镜像后重装：`$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'; npm install`。
- 桌面版启动脚本会清掉 `ELECTRON_RUN_AS_NODE`（有些终端/工具会设置它，导致 Electron 退化成纯 Node、窗口起不来）。
- 无图形会话/远程环境里 Electron 窗口可能起不来（本项目自动化测试环境就是如此，所以用 mock 主进程做了运行级验证）；正常桌面环境双击 launcher 即可。

## 代码分工

- `src/beat-analysis.js`：轻量节拍检测（包络/起音/自相关/最小二乘拟合拍网格）与拍点包络采样。
- `src/beat-cache.js`：节拍结果 IndexedDB 缓存（按曲目 id 或文件名+大小+修改时间），无 IDB 时内存兜底。
- `src/lyrics-words.js`：增强 LRC 行内逐字标签解析、逐字均分、逐字进度计算。
- `src/lyrics-styles.js`：歌词动画样式注册表（classic / tilt3d / karaoke，可外部注册）。
- `src/desktop.js`：桌面版桥接（是否 Electron、原生文件选择结果转 File）。
- `electron/main.cjs`、`electron/preload.cjs`：Electron 主进程（窗口、原生文件选择 IPC）与 preload 桥。
- `src/audio.js`：解码、播放、进度、音量，以及低/中/高频段与节拍起音分析。
- `src/particles.js`：Three.js 三层波形粒子引擎（低频粗波/中高频细纹/背景星云）、节拍冲击、频段分层、色彩联动、拖拽旋转、屏幕震动、粒子总开关。
- `src/image-particles.js`：图片 → 粒子点云（像素采样 + Sobel 边缘加权 + sRGB→线性颜色 + 组装动画 + 音频律动着色器）。
- `src/mascot-options.js`：桌宠（吉祥物）内置选项数据；`public/mascot/` 下是自绘 SVG 与原有 PNG。
- `src/space-decor.js`：太空装饰层——远景星野、近景星尘、亮星十字光芒、流星雨群发，跟随主题与画质档位。
- `src/cursor-trail.js`：鼠标/触摸光影跟随（独立 2D canvas，不占用 WebGL），10 种样式，支持随时开启 / 关闭与独立配色。
- `src/lyrics.js`、`src/lyrics.css`：LRC 解析、示例歌词、曲风分类、Folia 风格动态歌词渲染、3D 倾斜歌词与左/中/右位置、竖排/漂浮/摆荡/弹跳字/故障/散点/律动等运镜样式、音频能量 CSS 变量、双语歌词合并、自定义歌词颜色、歌词-粒子锚点联动。
- `src/lyrics-panel.js`、`src/lyrics-panel.css`：歌词面板（粘贴 / 导入 .lrc / 示例 / 清空 / 显示模式·位置·字号三档 / 颜色调色盘与多色保存 / 顶部大肥鱼互动形象）。
- `src/mascot-pet.js`：「大肥鱼」互动吉祥物（参考 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 桌宠思路）：漂浮待机、指针靠近会看向指针、点击蹦一下并说话、跟随歌词字号变大变小、久置会趴下睡觉；**傲娇台词库 103 条**（金句 64 / 连击 11 / 情景 16 / 体型 12），含连击递进、情景切换与定时自言自语。
- `src/free-mascot.js`、`src/free-mascot.css`：「逃出升天」独立桌宠——点歌词面板里的「逃出升天」把大肥鱼放出来，在页面上**自由拖动**（自动限制在视口内、松手后缓慢漂移游回原位）；**右键菜单**直接调歌词基础功能（字号 小肥鱼/肥鱼/大肥鱼、位置 居左/中/右、6 种预设配色、跟随曲风），另有「说一句话」「打开歌词面板」「收回面板」；双击说话、`Esc` 收菜单。
- `src/color-palette.js`：调色盘（彩虹板 + 点阵 + 圆环标记、点击/拖动取色、已保存多色列表、颜色工具纯函数）；`shape: 'circle'` 时改成圆形色轮（角度→色相、半径→亮度），供氛围色彩使用。
- `src/lyrics-library.js`：本地歌词库匹配 + 后端在线自动抓取（带 localStorage 缓存）。
- `server/lyrics.js`：歌词搜索/打分/下载（酷狗主源、网易云备源、按正文长度择优）。
- `server/qqmusic.js`：QQ 音乐歌词源（smartbox 搜索 + lyric 接口，免登录）。
- `src/media-metadata.js`：读取 MP4/MP3 内嵌标签与歌词（MP4 ©lyr / MP3 ID3 USLT）。
- `scripts/auto-lyrics.mjs`：批量自动补歌词命令行（扫描 MySQL 曲库或音乐文件夹）。
- `public/lyrics/`：歌词文件与 `index.json` 索引（仓库默认空，自己放 `.lrc` 并登记即可）。
- `src/ambience.js`、`src/ambience.css`：氛围背景系统（雨/雷/海滩/图书馆/图片/视频）。优先播放 `public/audio/` 里的真实录音（无缝循环 + 场景淡入淡出 + 闪电随机炸雷），录音缺失时退回 WebAudio 程序合成音。
- `src/background-media.js`：自定义背景文件类型判定 + IndexedDB 单文件存储（刷新后恢复图片/视频背景）。
- `src/background-picker.js`、`src/background-presets.js`：背景与氛围选择器（场景 / 内置图库 / 我的背景）+ 预设数据。
- `src/pomodoro.js`、`src/pomodoro.css`：番茄钟组件（环形进度、阶段管理、可注入计时器、沿环奔跑的吉祥物）。
- `src/study-stats.js`：今日总学习时长统计（本地日期、跨天归零、格式化、持久化）。
- `public/mascot/`：番茄钟吉祥物图片（用户自备，可替换同名文件）。
- `src/navbar.js`、`src/navbar.css`：顶部导航栏（pill/icon 双形态）。
- `src/ui.js`、`src/style.css`：界面交互、右侧「效果」栏（粒子特效开关 / 背景画面 / 自定义图片视频）、频段敏感度滑块和响应式布局（含专注模式布局）。
- `src/main.js`：模块连接、动画循环、存储后端选择（MySQL/IndexedDB）、曲库/歌词/颜色/氛围/自定义背景/专注模式接线、显示设置持久化和资源清理。
- `src/library.js`：IndexedDB 存储（元数据 + 音频分离存储、v1→v2 升级与回填）。
- `src/library-api.js`：MySQL 后端的浏览器客户端（与 MusicLibrary 同接口，含 `probeServer` 探测）。
- `src/library-model.js`：文件名解析、排序、搜索、统计与格式化等纯函数。
- `src/library-ui.js`、`src/library.css`：曲库目录抽屉与播放器入口。
- `src/online-panel.js`、`src/qq-panel.css`：在线音乐面板（QQ / 网易云 / 酷狗三音源、扫码登录、搜索播放）。`src/qq-panel.js` 为旧版单平台面板，保留兼容测试。
- `server/netease.js`：网易云音乐 provider（复用 NeteaseCloudMusicApi，端口 3202；扫码登录 / 搜索 / 播放 / 歌词 / 流代理）。
- `server/kugou.js`：酷狗音乐 provider（免登录搜索 / 播放 / 歌词 / 流代理）。
- `server/qq-auth.js`：QQ 音乐服务代理（自动拉起 qq-api、扫码/搜索/歌词/播放地址/音频流）。
- `server/`：Express API（health / 列表 / 上传 / Range 音频流 / 改名 / 播放计数 / 删除 / 歌词自动识别 / QQ 音乐）+ mysql2 连接池。
- `scripts/`：便携 MariaDB 的下载初始化、启停脚本。
- `MYSQL.md`：数据库连接参数、API 列表、常见问题。

## 测试

- `tests/`：音频分析、粒子行为（含总开关）、太空装饰层、歌词解析/曲风分类/3D 倾斜与位置/双语/歌词颜色调色盘与圆形色轮/歌词面板/歌词自动识别/MP4 与 ID3 标签、QQ 音乐源与登录会话、氛围背景（含视频与背景存储）、光标光影跟随开关、番茄钟、MySQL 客户端与曲库纯逻辑的 Node 单元测试（348 项）；`npm test` 全部执行。
- `e2e/`：Playwright 浏览器端流程（曲库增删改查、批量导入、搜索排序、播放、资源回收、响应式布局、QQ 音乐面板、专注页吉祥物、歌词预览、逐字歌词、桌面按钮降级，21 项）；e2e 固定走 IndexedDB，不受本机 MySQL 状态影响。
- 后端接口可用 `npm run server` 后访问 `http://127.0.0.1:8787/api/health` 自检。
- 测试音乐由使用者本地选择，项目不附带个人歌曲文件。

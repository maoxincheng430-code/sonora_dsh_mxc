# 参与贡献

首先感谢你有兴趣参与！无论是提 Issue、修 Bug 还是加功能，都很欢迎。

## 快速上手

```sh
git clone https://github.com/<你的用户名>/sonora.git
cd sonora
npm install
npm run dev          # 打开 http://127.0.0.1:5173/
```

不需要数据库也能跑：曲库默认存在浏览器 IndexedDB 里。想接入 MySQL 见 [MYSQL.md](./MYSQL.md)。

## 开发命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动 Vite 开发服务器（热更新） |
| `npm test` | 跑全部单元测试（Node 内置 test runner） |
| `npm run build` | 生产构建（桌面版也用这份产物） |
| `npm run server` | 启动本地 API（可选，8787 端口） |
| `npm run desktop` | 构建并启动 Electron 桌面版 |

## 代码结构

```
src/           前端源码（Three.js 粒子、歌词、播放器、UI）
server/        Express API（曲库、歌词抓取、在线音乐代理）
electron/      桌面版外壳（原生文件选择、系统声音采集）
public/        静态资源（音频、歌词、背景图、桌宠素材）
tests/         单元测试（node --test）
docs/          设计文档与实现笔记
```

关键模块：

- `src/particles.js` — 粒子引擎（自定义 GLSL，多形态）
- `src/lyrics*.js` — 歌词解析、渲染、同步
- `src/audio.js` — 音频解码与频谱分析
- `src/pomodoro.js` / `src/focus-choices.js` — 番茄钟与专注模式

## 提交前请确认

```sh
npm test        # 必须全绿
npm run build   # 必须能构建
```

## 提交信息规范

建议用 [Conventional Commits](https://www.conventionalcommits.org/) 风格：

```
feat: 图片粒子支持自动扣背景
fix: 桌宠拖动后位置被打回原点
docs: 更新 MySQL 可选模式的说明
refactor: 抽出音频分析模块
style: 调整图片形态面板的排版
```

## 新增功能时

1. 纯逻辑尽量写成**可测的纯函数**，放到能独立 import 的模块里（不要直接塞进 DOM 代码）
2. 在 `tests/` 下补对应单测
3. 涉及 UI 的改动，附上截图或录屏
4. 需要持久化的配置，用 `localStorage` 的 `sonora-` 前缀，并在 README 里说明

## 素材与版权

- **不要提交**你无权分发的第三方图片、音频、同人图
- 音频文件请勿提交到仓库（`.gitignore` 已排除常见格式）
- 社区二创桌宠素材请放在对应目录并注明来源，见 [public/mascot/README.md](./public/mascot/README.md)

## 提 Issue 前

- 先搜索是否已有相同 Issue
- Bug 请附上：复现步骤、浏览器版本、控制台报错
- 用仓库自带的 Issue 模板填写会更省事

## 行为准则

参与本项目即表示你同意遵守 [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)。
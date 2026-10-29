# 桌宠素材目录

这里放番茄钟 / 专注模式的桌宠图片。**只放你有权使用的素材**。

## 内置角色（项目自带，自绘 SVG / 原有 PNG）

| 文件 | 用途 |
| --- | --- |
| `dafeiyu-cut.png` | 原有 DeepSeek 大肥鱼 |
| `cat.svg` / `cat-run.svg` / `cat-party.svg` | 小猫：待机 / 奔跑 / 庆祝 |
| `robot.svg` / `robot-run.svg` / `robot-party.svg` | 小机器人：待机 / 奔跑 / 庆祝 |
| `ghost.svg` / `ghost-party.svg` | 小幽灵：待机 / 庆祝 |
| `star.svg` / `star-party.svg` | 小星星：待机 / 庆祝 |

图片建议：正方形、透明背景、内容占满画面（系统会按圆环上的尺寸自动缩放）。

## 追加自己的角色

1. 把图片（PNG / GIF / WebP / SVG）放进本目录；
2. 编辑 `packs.json`，在 `packs` 数组里加一项：

```json
{
  "id": "my-pet",
  "name": "我的桌宠",
  "desc": "可选说明",
  "states": {
    "idle": "mascot/my-pet.png",
    "running": "mascot/my-pet-run.gif",
    "celebrate": "mascot/my-pet-party.gif"
  }
}
```

- `id` 必须唯一；`states.idle` 是默认图，`running` / `celebrate` / `rest` 可选，没配就沿用 `idle`；
- 刷新页面后，新角色会自动出现在专注页「桌宠」面板里（不需要改代码）；
- 单张建议 < 500KB，整个仓库别塞太多大 GIF。

## 版权提醒

- **原神 / 崩坏等 miHoYo 角色、塔菲等 VTuber、以及 Gemini / GPT / Claude / Grok 等 AI 品牌的同人图，都不能随项目分发**；
- GitHub 上很多“动漫桌宠”仓库没有 LICENSE 或素材另有版权（例如 Anthropic 官方 claude-desktop-buddy 的 GIF 素材就明确标注为第三方 bufo 表情、不在 MIT 范围内）；
- 自己的本地使用可以随便传（走「上传自己的图片 / GIF」或放本目录），但**不要提交到公开仓库**；
- 想要完全干净的角色：用本项目自绘的 SVG，或 OpenGameArt / Kenney / itch.io 上标注 CC0 的素材，或自己画 / 约稿（确认授权）。

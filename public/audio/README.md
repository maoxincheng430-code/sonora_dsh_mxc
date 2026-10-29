# 氛围录音素材（public/audio）

这个目录用于放置 `src/ambience.js` 场景音频层播放的环境声。

## 仓库里不放音频

**本仓库不包含任何音频文件**（`.gitignore` 已排除 `public/audio/*.mp3`）。原因：

- 环境声、音乐都涉及第三方版权，不适合随源码分发；
- 音频体积大，会拖慢 clone。

缺省情况下，氛围场景会退回 **WebAudio 程序合成音**（雨声、雷声、海浪、翻书声都由代码实时合成），功能完整可用。

## 想换成真实录音

自己准备**无版权风险**的素材（自己录的、CC0 授权的、或明确允许商用的），按下面的文件名放进来即可，代码会自动优先播放：

| 文件 | 用途 | 建议时长 |
| --- | --- | --- |
| `rain.mp3` | 雨天场景底噪 | 20–60s，循环 |
| `beach.mp3` | 海滩场景底噪 | 30–60s，循环 |
| `library.mp3` | 图书馆场景底噪 | 30–60s，循环 |
| `thunder.mp3` | 雷雨场景底噪 | 30–60s，循环 |
| `thunder-1.mp3` / `thunder-2.mp3` / `thunder-3.mp3` | 闪电触发的炸雷 | 5–15s |

## 制作要点

- **循环文件**：首尾各留 1–4 秒做等功率交叉淡化（`acrossfade`），避免接缝出现「咔哒」；
- **采样格式**：44.1kHz、单声道或双声道、64–128kbps mp3，浏览器兼容性最好；
- **响度**：底噪约 −20 LUFS，炸雷约 −15 LUFS，真峰值上限 −2 dBTP；
- **炸雷单独切片**：闪电触发时才播放，不要混在循环底噪里；
- `ambience.js` 里会串一个 8–12.5kHz 低通，把录音压到"背景"位置，避免盖过人声。

### 循环片段的参考命令

以「起点 S、段长 L、淡化 F」为例（ffmpeg）：

```bash
ffmpeg -i source.wav -ss 120 -t 56 -vn -filter_complex "
[0:a]asetpts=PTS-STARTPTS,asplit=3[h][t][m];
[h]atrim=0:4,asetpts=PTS-STARTPTS[head];
[t]atrim=52:56,asetpts=PTS-STARTPTS[tail];
[m]atrim=4:52,asetpts=PTS-STARTPTS[mid];
[tail][head]acrossfade=d=4:c1=tri:c2=tri[st];
[st][mid]concat=n=2:v=0:a=1[cat];
[cat]loudnorm=I=-20:TP=-2:LRA=11,aresample=44100[out]" \
-map "[out]" -ar 44100 -ac 2 -c:a pcm_s16le tmp.wav

ffmpeg -i tmp.wav -c:a libmp3lame -b:a 128k beach.mp3
```

### 炸雷片段

```bash
ffmpeg -ss 16 -t 11 -i source.wav -vn -af \
"afade=t=in:st=0:d=0.25,afade=t=out:st=8.8:d=2.2,loudnorm=I=-15:TP=-1.5:LRA=9,aresample=44100" \
-ar 44100 -ac 2 -c:a libmp3lame -b:a 128k thunder-1.mp3
```

## 版权提醒

不要提交来源不明的录音。如果素材来自第三方视频 / 音乐平台，请勿放入仓库或公开发布的项目中。
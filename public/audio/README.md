# 氛围录音素材（public/audio）

`src/ambience.js` 的场景音频层播放的环境声，**随仓库一起提供**，clone 下来就能听到真实录音。

## 包含的文件

| 文件 | 用途 | 时长 | 大小 |
| --- | --- | --- | --- |
| `rain.mp3` | 雨天场景底噪 | 24s | 375KB |
| `thunder.mp3` | 雷雨场景底噪（雨 + 远雷） | 52s | 813KB |
| `thunder-1.mp3` / `thunder-2.mp3` / `thunder-3.mp3` | 闪电触发的炸雷 | 各 11s | 各 173KB |
| `beach.mp3` | 海滩场景底噪（海浪） | 52s | 813KB |
| `library.mp3` | 图书馆场景底噪（翻书 / 写字 / 自习） | 52s | 813KB |

合计约 3.3MB，全部 44.1kHz / 双声道 / 128kbps mp3。

播放逻辑：优先用这些录音；**缺失或解码失败时自动退回 WebAudio 程序合成音**（白噪声 + 布朗噪声 + 低频脉冲），所以删掉文件也不会没声音，只是不如真实录音自然。

## 换 / 加自己的录音

按上表的文件名替换或新增即可，代码会自动优先播放。建议：

- **循环文件**：首尾各留 1–4 秒做等功率交叉淡化（`acrossfade`），避免接缝出现「咔哒」；
- **格式**：44.1kHz、单声道或双声道、64–128kbps mp3，浏览器兼容性最好；
- **响度**：底噪约 −20 LUFS，炸雷约 −15 LUFS，真峰值上限 −2 dBTP；
- **炸雷单独切片**：闪电触发时才播放，不要混在循环底噪里；
- `ambience.js` 里会串一个 8–12.5kHz 低通，把录音压到「背景」位置，避免盖过人声。

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

## 素材说明

这些环境声是项目作者自行剪辑、做循环处理后的素材，随本项目一起分发，用于氛围场景演示。

如果你想替换成自己的录音，直接按上面的文件名覆盖即可；如果不想保留这些素材，删掉本目录下的 mp3 也能正常运行（会自动用程序合成音）。
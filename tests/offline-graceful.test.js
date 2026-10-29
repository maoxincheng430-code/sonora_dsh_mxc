import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 线上同事（第一次 clone 的人）最容易踩的两个坑，用静态检查锁住：
//   1. tools/ 下的在线音乐服务依赖没装 → 面板只显示英文的 Failed to fetch
//   2. public/audio/*.mp3 不进仓库 → 解码失败在控制台刷 EncodingError
// 这两种情况都应该安静降级 + 给人看得懂的提示。

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('QQ 面板把 Failed to fetch 翻译成可照做的提示', () => {
  const src = read('src/qq-panel.js');
  assert.match(src, /failed to fetch/i, '应识别 fetch 失败');
  assert.match(src, /本地服务/, '应提示是本地服务的问题');
  assert.match(src, /qq:setup/, '应给出安装依赖的命令');
  // 离线分支必须存在，并且有一个针对它的专用提示文案
  assert.match(src, /if \(offline\)/, '应有离线的单独分支');
  assert.match(src, /连不上本地服务|本地服务未启动/, '应给出中文说明而不是裸的 fetch 报错');
});

test('在线音乐总面板对离线状态给出同样清楚的引导', () => {
  const src = read('src/online-panel.js');
  assert.match(src, /failed to fetch/i);
  assert.match(src, /本地服务未启动/);
  assert.match(src, /安装在线音乐依赖\.cmd|netease:setup/);
});

test('录音缺失时不抛 EncodingError（先按 content-type 拦掉非音频响应）', () => {
  const src = read('src/ambience.js');
  // dev server 对缺失静态资源会返回 200 + text/html，直接 decodeAudioData 会抛 EncodingError
  assert.match(src, /content-type/i, '应先检查 content-type');
  assert.match(src, /not audio/, '非音频响应应主动 throw 走 catch');
  // decodeAudioData 的错误回调不能把原始 error 往外抛（会在控制台刷红字）
  assert.match(src, /decodeAudioData\(/, '应调用 decodeAudioData');
  assert.match(src, /decode failed/, '解码失败应折叠成普通 null，而不是抛出原始错误');
});

test('录音缺失时仍能退回合成音（startSynthFallback 在 loadSample 之前）', () => {
  const src = read('src/ambience.js');
  const fallbackIndex = src.indexOf('startSynthFallback()');
  const loadIndex = src.indexOf('loadSample(scene).then');
  assert.ok(fallbackIndex > -1, '应保留合成音兜底');
  assert.ok(loadIndex > -1, '应尝试加载录音');
  assert.ok(
    fallbackIndex < loadIndex,
    '先起合成音、录音到位再交叉淡化，缺录音时就一直是合成音',
  );
});
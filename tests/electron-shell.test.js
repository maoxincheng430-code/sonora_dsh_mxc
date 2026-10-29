import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = new URL('..', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

// Electron 需要图形会话才能启动，CI/无桌面环境跑不起来；
// 这里做结构级契约测试，保证壳的关键能力（原生文件选择、preload 桥）不被改坏。
test('Electron 主进程提供原生文件选择 IPC', () => {
  const main = read('electron/main.cjs');
  assert.match(main, /ipcMain\.handle\(\s*'audio:pickFiles'/);
  assert.match(main, /dialog\.showOpenDialog/);
  assert.match(main, /data\.buffer\.slice\(/);
});

test('preload 只暴露只读桥接（contextIsolation 友好）', () => {
  const preload = read('electron/preload.cjs');
  assert.match(preload, /contextBridge\.exposeInMainWorld\('sonoraDesktop'/);
  assert.match(preload, /isElectron:\s*true/);
  assert.match(preload, /ipcRenderer\.invoke\('audio:pickFiles'\)/);
  assert.doesNotMatch(preload, /nodeIntegration:\s*true/);
});

test('窗口配置开启 contextIsolation 且关闭 nodeIntegration', () => {
  const main = read('electron/main.cjs');
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /preload:\s*path\.join/);
});

test('audioMime：扩展名映射与未知回退', () => {
  const { AUDIO_EXTENSIONS, guessMime } = require('../electron/audioMime.cjs');
  assert.equal(guessMime('a.mp3'), 'audio/mpeg');
  assert.equal(guessMime('b.WAV'), 'audio/wav');
  assert.equal(guessMime('c.flac'), 'audio/flac');
  assert.equal(guessMime('d.mp4'), 'video/mp4');
  assert.equal(guessMime('noext'), 'application/octet-stream');
  assert.ok(AUDIO_EXTENSIONS.includes('mp3'));
  assert.ok(AUDIO_EXTENSIONS.includes('mp4'));
});

test('package.json 指向 Electron 入口并带桌面脚本', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.main, 'electron/main.cjs');
  assert.ok(pkg.scripts.desktop);
  assert.ok(pkg.scripts['desktop:dev']);
  assert.ok(pkg.devDependencies.electron);
});

test('渲染层桌面桥接：非 Electron 时安全降级', async () => {
  const { isDesktop } = await import('../src/desktop.js');
  assert.equal(isDesktop({}), false);
});

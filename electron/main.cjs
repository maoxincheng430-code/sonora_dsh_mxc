// Electron 主进程：桌面版壳。
//   1. 打开渲染进程（开发时连 Vite，生产时加载 dist/index.html）
//   3. 提供原生文件选择（本地曲库导入）
const { app, BrowserWindow, ipcMain, dialog } = require('electron');

const path = require('node:path');
const fs = require('node:fs/promises');
const { AUDIO_EXTENSIONS, guessMime } = require('./audioMime.cjs');

const DEV = process.env.ELECTRON_DEV === 'true';
const DEV_URL = process.env.ELECTRON_DEV_URL || 'http://127.0.0.1:5173/';

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#05060a',
    autoHideMenuBar: true,
    title: 'SONORA 声境',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (DEV) win.loadURL(DEV_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  return win;
}

app.whenReady().then(() => {
    // 原生文件选择：一次选多首本地音视频，直接把字节带回渲染进程。
  ipcMain.handle('audio:pickFiles', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择本地音乐 / 视频（只取音轨）',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '音频 / 视频', extensions: AUDIO_EXTENSIONS }],
    });
    if (result.canceled || !result.filePaths.length) return [];
    const files = [];
    for (const filePath of result.filePaths) {
      try {
        const stat = await fs.stat(filePath);
        const data = await fs.readFile(filePath);
        files.push({
          name: path.basename(filePath),
          type: guessMime(filePath),
          size: stat.size,
          lastModified: stat.mtimeMs,
          data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
        });
      } catch (error) {
        console.warn(`[electron] 读取失败 ${filePath}`, error?.message || error);
      }
    }
    return files;
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

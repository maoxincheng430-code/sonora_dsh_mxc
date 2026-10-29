// Electron preload：只暴露必要能力（contextIsolation 开启，无 nodeIntegration）。
//   渲染进程通过 window.sonoraDesktop 判断是否在桌面版，并调用原生文件选择。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sonoraDesktop', {
  isElectron: true,
  platform: process.platform,
  version: process.env.npm_package_version || '',
  /** 原生多选文件，返回 [{ name, type, size, lastModified, data: ArrayBuffer }] */
  pickAudioFiles: () => ipcRenderer.invoke('audio:pickFiles'),
});

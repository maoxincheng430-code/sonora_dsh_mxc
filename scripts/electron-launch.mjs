// Electron 桌面壳启动器。
// Electron 在某些 Windows 11 / 远程桌面环境会直接崩溃（0xc0000005），
// 这时自动降级为 Chromium 应用窗口，保证双击桌面版一定有画面。
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const startedAt = Date.now();

function findElectron() {
  try {
    const electronPath = require('electron');
    return typeof electronPath === 'string' ? electronPath : null;
  } catch {
    return null;
  }
}

async function ensureVite() {
  const url = 'http://127.0.0.1:5173/';
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1200) });
    if (response.ok) return url;
  } catch {
    // 未启动
  }
  console.log('[desktop] 正在启动本地网站服务…');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  const webTemp = path.join(root, '.tmp-build', 'web');
  mkdirSync(webTemp, { recursive: true });
  env.TEMP = webTemp;
  env.TMP = webTemp;
  const command = process.platform === 'win32' ? 'cmd.exe' : 'npm';
  const commandArgs = process.platform === 'win32' ? ['/c', 'npm', 'run', 'dev'] : ['run', 'dev'];
  spawn(command, commandArgs, {
    cwd: root,
    env,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
  for (let i = 0; i < 40; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return url;
    } catch {
      // 继续等
    }
  }
  return null;
}

function openAppWindow(url) {
  const candidates = [
    path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.ProgramFiles || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.ProgramFiles || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ];
  const browser = candidates.find((candidate) => candidate && existsSync(candidate));
  if (browser) {
    spawn(browser, [`--app=${url}`, '--start-maximized', '--no-first-run'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    }).unref();
    console.log(`[desktop] 已用应用窗口打开：${browser}`);
    return true;
  }
  spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  console.log('[desktop] 没找到 Edge/Chrome，已用默认浏览器打开。');
  return false;
}

async function fallbackToWeb() {
  console.log('[desktop] Electron 无法在当前环境启动，自动切换为网页应用窗口。');
  const url = await ensureVite();
  if (!url) {
    console.error('[desktop] 本地网站服务启动失败，请先运行 npm run dev。');
    process.exit(1);
  }
  openAppWindow(url);
  process.exit(0);
}

const electronPath = findElectron();
if (!electronPath) {
  console.error('[desktop] 没有找到 electron，将使用网页应用窗口。');
  await fallbackToWeb();
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_NO_ATTACH_CONSOLE;

const args = ['.', ...process.argv.slice(2)];
console.log(`[desktop] 启动 Electron: ${electronPath} ${args.join(' ')}`);

const child = spawn(electronPath, args, { stdio: 'inherit', env, windowsHide: false });
let exited = false;
child.on('error', async (error) => {
  console.error('[desktop] Electron 启动失败：', error.message);
  if (!exited) {
    exited = true;
    await fallbackToWeb();
  }
});
child.on('exit', async (code) => {
  if (exited) return;
  exited = true;
  const elapsed = Date.now() - startedAt;
  if (code !== 0 && elapsed < 20000) {
    await fallbackToWeb();
    return;
  }
  process.exit(code ?? 0);
});
